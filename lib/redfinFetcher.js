/**
 * lib/redfinFetcher.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Fetches ZIP-level market pulse data from Redfin's public weekly data download.
 *
 * Source:
 *   https://redfin-public-data.s3.us-west-2.amazonaws.com/redfin_market_tracker/zip_code_market_tracker.tsv000.gz
 *
 * This file is publicly available, no API key required. It is updated weekly
 * (typically Friday) and covers ~30,000 US ZIP codes.
 *
 * File size: ~180–220MB compressed (.gz), ~1.4GB uncompressed TSV.
 * Strategy: Stream and parse line-by-line rather than loading into memory.
 *           Only keep rows matching ZIP codes in our target set.
 *           This keeps peak memory well under Vercel's 1GB serverless limit.
 *
 * Fields extracted per ZIP:
 *   - median_dom:           Median days on market (how fast homes sell)
 *   - sale_to_list:         Sale price / list price ratio (>1.0 = sellers market)
 *   - median_sale_price:    Median sale price (cross-check against ask price)
 *   - homes_sold:           Volume — thin markets get flagged
 *   - inventory:            Active listings count
 *   - period_end:           Data period end date (YYYY-MM-DD)
 *
 * market_data_cache key: `redfin:{zip}` (e.g. `redfin:78701`)
 * Value shape:
 *   {
 *     dom:           18,           // median days on market
 *     saleToList:    1.02,         // 1.02 = selling 2% over list
 *     medianSalePrice: 485000,     // median sale price
 *     homesSold:     42,           // volume in period
 *     inventory:     45,           // active listings
 *     marketTemp:    "hot",        // "hot" | "warm" | "neutral" | "cool" | "cold"
 *     asOf:          "2026-02-21", // period_end date from Redfin
 *     source:        "Redfin",
 *   }
 *
 * Usage in cron (refresh-market-data.js):
 *   This fetcher is called from the weekly cron with a list of ZIPs to refresh.
 *   The ZIP list is derived from recent deals in the database — we only cache
 *   ZIPs that users have actually analyzed, keeping storage bounded.
 *
 * Error philosophy:
 *   Returns a Map of zip → data for successful parses.
 *   ZIPs not found in the Redfin file return no entry (null is not stored).
 *   The entire fetch can return an empty Map on failure — callers handle this gracefully.
 */

import { createGunzip } from 'zlib';
import { Readable }     from 'stream';

const REDFIN_URL =
  'https://redfin-public-data.s3.us-west-2.amazonaws.com/redfin_market_tracker/zip_code_market_tracker.tsv000.gz';

// ─── Field indices (resolved dynamically from the header row) ─────────────────
// Redfin has changed column order across releases — we resolve indices from
// the actual header rather than hardcoding positions.
const REQUIRED_FIELDS = [
  'period_end',
  'region_type',
  'region',         // ZIP code (for zip_code_market_tracker, this is the ZIP)
  'state',
  'median_dom',
  'sale_to_list',
  'median_sale_price',
  'homes_sold',
  'inventory',
];

// ─── Sanity bounds ────────────────────────────────────────────────────────────
const BOUNDS = {
  dom:             { min: 1,    max: 730  }, // 1 day to 2 years
  saleToList:      { min: 0.50, max: 1.50 }, // 50% to 150% of list
  medianSalePrice: { min: 10000, max: 20000000 },
  homesSold:       { min: 0,    max: 10000 },
  inventory:       { min: 0,    max: 50000 },
};

// ─── Market temperature classification ───────────────────────────────────────
/**
 * Classifies market temperature from days-on-market and sale-to-list ratio.
 * Combined signal is more reliable than either metric alone.
 *
 * Thresholds based on NAR and Redfin research definitions:
 *   Hot:     DOM ≤14 AND sale/list ≥1.01
 *   Warm:    DOM ≤30 AND sale/list ≥0.99
 *   Neutral: DOM ≤60 AND sale/list ≥0.97
 *   Cool:    DOM ≤90
 *   Cold:    DOM >90
 */
function classifyMarketTemp(dom, saleToList) {
  if (dom === null || saleToList === null) return 'unknown';
  if (dom <= 14 && saleToList >= 1.01) return 'hot';
  if (dom <= 30 && saleToList >= 0.99) return 'warm';
  if (dom <= 60 && saleToList >= 0.97) return 'neutral';
  if (dom <= 90)                        return 'cool';
  return 'cold';
}

// ─── Streaming TSV parser ─────────────────────────────────────────────────────

/**
 * Streams and decompresses the Redfin gzipped TSV, parsing only rows matching
 * the requested ZIP codes. Uses Node.js streams to avoid loading the full
 * ~1.4GB uncompressed file into memory.
 *
 * @param {Set<string>} targetZips - Set of 5-digit ZIP codes to extract
 * @param {number} timeoutMs       - Abort timeout in milliseconds (default: 90s)
 * @returns {Promise<Map<string, Object>>} - Map of zip → raw field values
 */
async function streamRedfinData(targetZips, timeoutMs = 90000) {
  if (!targetZips || targetZips.size === 0) {
    return new Map();
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const r = await fetch(REDFIN_URL, {
      signal: controller.signal,
      headers: {
        // Some S3 buckets 403 on missing user-agent
        'User-Agent': 'RentalIQ-DataRefresh/1.0',
      },
    });

    if (!r.ok) {
      console.warn(`[redfinFetcher] HTTP ${r.status} from Redfin S3`);
      return new Map();
    }

    if (!r.body) {
      console.warn('[redfinFetcher] Response has no body');
      return new Map();
    }

    // Convert web ReadableStream to Node.js Readable for stream piping
    const nodeReadable = Readable.fromWeb(r.body);
    const gunzip = createGunzip();
    nodeReadable.pipe(gunzip);

    const results = new Map();
    let headerIndices = null;
    let buffer = '';
    let rowsProcessed = 0;
    let rowsMatched = 0;

    await new Promise((resolve, reject) => {
      gunzip.on('error', reject);

      gunzip.on('data', (chunk) => {
        buffer += chunk.toString('utf8');

        // Process complete lines
        const lines = buffer.split('\n');
        // Keep the last (possibly incomplete) line in the buffer
        buffer = lines.pop();

        for (const line of lines) {
          if (!line.trim()) continue;

          // Parse header on first line
          if (headerIndices === null) {
            const headers = line.split('\t').map(h => h.trim().toLowerCase());
            headerIndices = {};
            for (const field of REQUIRED_FIELDS) {
              const idx = headers.indexOf(field);
              if (idx === -1) {
                console.warn(`[redfinFetcher] Required field "${field}" not found in header`);
              }
              headerIndices[field] = idx;
            }
            continue;
          }

          rowsProcessed++;

          // Quick ZIP pre-filter before full split — avoids splitting 30k+ rows
          // Each ZIP appears as a standalone token in the TSV row
          let matchedZip = null;
          for (const zip of targetZips) {
            if (line.includes(zip)) {
              matchedZip = zip;
              break;
            }
          }
          if (!matchedZip) continue;

          const cols = line.split('\t');

          // Verify region_type is zip_code (not city/state/county)
          const regionType = cols[headerIndices['region_type']]?.trim();
          if (regionType !== 'zip code' && regionType !== 'zip_code') continue;

          // Verify region (ZIP code) matches
          const region = cols[headerIndices['region']]?.trim();
          if (!targetZips.has(region)) continue;

          rowsMatched++;

          // Extract fields — Redfin uses empty string for missing values
          const get = (field) => {
            const idx = headerIndices[field];
            if (idx === undefined || idx === -1) return null;
            const val = cols[idx]?.trim();
            return val === '' || val === undefined ? null : val;
          };

          results.set(region, {
            period_end:        get('period_end'),
            median_dom:        get('median_dom'),
            sale_to_list:      get('sale_to_list'),
            median_sale_price: get('median_sale_price'),
            homes_sold:        get('homes_sold'),
            inventory:         get('inventory'),
          });

          // Stop early if we've found all requested ZIPs
          if (results.size >= targetZips.size) {
            gunzip.destroy();
            resolve();
            return;
          }
        }
      });

      gunzip.on('end', () => {
        console.log(`[redfinFetcher] Processed ${rowsProcessed.toLocaleString()} rows, matched ${rowsMatched} ZIPs`);
        resolve();
      });

      nodeReadable.on('error', reject);
    });

    return results;

  } catch (err) {
    if (err.name === 'AbortError') {
      console.warn('[redfinFetcher] Stream timed out after', timeoutMs, 'ms');
    } else {
      console.warn('[redfinFetcher] Stream error:', err.message);
    }
    return new Map();
  } finally {
    clearTimeout(timeout);
  }
}

// ─── Value parsers ────────────────────────────────────────────────────────────

function parseRedfinFloat(raw, bounds) {
  if (raw === null) return null;
  // Redfin sometimes includes % signs or $ in values
  const cleaned = String(raw).replace(/[$%,]/g, '');
  const val = parseFloat(cleaned);
  if (isNaN(val)) return null;
  if (val < bounds.min || val > bounds.max) return null;
  return val;
}

function parseRedfinInt(raw, bounds) {
  if (raw === null) return null;
  const cleaned = String(raw).replace(/[$%,]/g, '');
  const val = parseInt(cleaned, 10);
  if (isNaN(val)) return null;
  if (val < bounds.min || val > bounds.max) return null;
  return val;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Fetches and parses Redfin market data for a set of ZIP codes.
 *
 * This is the primary export used by the weekly cron job. It streams the
 * ~200MB gzipped file, extracts rows for the requested ZIPs, parses and
 * validates all values, and returns a ready-to-store Map.
 *
 * @param {string[]} zips - Array of 5-digit ZIP code strings
 * @returns {Promise<Map<string, Object>>} - Map of zip → validated market data object
 *                                          Empty Map on total failure (never throws)
 */
export async function fetchRedfinZips(zips) {
  if (!zips || zips.length === 0) return new Map();

  // Deduplicate and validate ZIP format
  const validZips = [...new Set(zips.filter(z => /^\d{5}$/.test(z)))];
  if (validZips.length === 0) return new Map();

  const targetSet = new Set(validZips);
  const rawResults = await streamRedfinData(targetSet);

  const output = new Map();

  for (const [zip, raw] of rawResults) {
    const dom            = parseRedfinFloat(raw.median_dom,        BOUNDS.dom);
    const saleToList     = parseRedfinFloat(raw.sale_to_list,      BOUNDS.saleToList);
    const medianSalePrice = parseRedfinInt(raw.median_sale_price,  BOUNDS.medianSalePrice);
    const homesSold      = parseRedfinInt(raw.homes_sold,          BOUNDS.homesSold);
    const inventory      = parseRedfinInt(raw.inventory,           BOUNDS.inventory);
    const asOf           = raw.period_end?.substring(0, 10) ?? null; // YYYY-MM-DD

    // DOM is the minimum required field — without it the market temp is meaningless
    if (dom === null) {
      console.warn(`[redfinFetcher] ZIP ${zip}: median_dom missing or invalid — skipping`);
      continue;
    }

    const marketTemp = classifyMarketTemp(dom, saleToList);

    output.set(zip, {
      dom,
      saleToList,
      medianSalePrice,
      homesSold,
      inventory,
      marketTemp,
      asOf,
      source: 'Redfin',
    });
  }

  console.log(`[redfinFetcher] Returning valid data for ${output.size}/${validZips.length} requested ZIPs`);
  return output;
}

/**
 * Fetches Redfin data for a single ZIP code.
 * Convenience wrapper around fetchRedfinZips for on-demand use.
 *
 * Note: This still streams the full Redfin file — it is NOT efficient for
 * single-ZIP lookups at request time. Use only in the cron job context where
 * multiple ZIPs can be batched. The neighborhood API reads from the cache
 * populated by the cron, not from this function directly.
 *
 * @param {string} zip
 * @returns {Promise<Object|null>}
 */
export async function fetchRedfinZip(zip) {
  const results = await fetchRedfinZips([zip]);
  return results.get(zip) ?? null;
}

/**
 * Returns the market temperature label with a human-readable description.
 * Used by the UI to display the market pulse classification.
 */
export function describeMarketTemp(temp) {
  const descriptions = {
    hot:     'Hot — homes selling fast, above list price',
    warm:    'Warm — seller\'s market, moderate competition',
    neutral: 'Neutral — balanced supply and demand',
    cool:    'Cool — buyer\'s market, homes sitting longer',
    cold:    'Cold — slow market, significant price flexibility',
    unknown: 'Market data unavailable',
  };
  return descriptions[temp] ?? descriptions.unknown;
}
