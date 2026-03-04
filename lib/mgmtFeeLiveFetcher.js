/**
 * lib/mgmtFeeLiveFetcher.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Live property management fee fetcher using FRED services CPI + NARPM data.
 *
 * Sources (all free, no API key required):
 *
 *   Primary: FRED CPI for Shelter/Housing Services
 *     - Series: CUUR0000SAH   (CPI Housing — all urban consumers)
 *     - Series: CUUR0000SAH2  (CPI Shelter — rent of primary residence)
 *     - Management fees track roughly with housing services inflation
 *     - We use YoY % change to adjust the NARPM 2024 baseline forward
 *
 *   Secondary: NARPM annual survey (scraped from narpm.org)
 *     - URL: https://www.narpm.org/research/
 *     - Annual publication — we parse for the "national average" headline figure
 *
 *   Fallback: NARPM 2024 static table
 *
 * Cache key: mgmt_fee_rates
 * TTL: 365 days (fees change slowly with overall housing market)
 *
 * @module mgmtFeeLiveFetcher
 */

const FRED_CSV_BASE = 'https://fred.stlouisfed.org/graph/fredgraph.csv';
const NARPM_URL = 'https://www.narpm.org/research/';

// Base national management fee rate from NARPM 2024
const NARPM_2024_NATIONAL = 8.9; // % of monthly collected rent

/**
 * Fetches housing services CPI YoY change from FRED.
 * Used to adjust the management fee baseline forward.
 */
async function fetchHousingServicesCpiChange() {
  try {
    const url = `${FRED_CSV_BASE}?id=CUUR0000SAH`;
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;

    const csv = await r.text();
    const lines = csv.trim().split('\n').filter(l => l && !l.startsWith('DATE'));
    if (lines.length < 14) return null;

    // Get last 13 months to compute YoY change
    const recent = lines.slice(-13).map(l => {
      const [date, val] = l.split(',');
      return { date: date?.trim(), value: parseFloat(val) };
    }).filter(r => !isNaN(r.value));

    if (recent.length < 13) return null;

    const latest = recent[recent.length - 1].value;
    const yearAgo = recent[0].value;
    const yoyChange = ((latest - yearAgo) / yearAgo) * 100;

    if (Math.abs(yoyChange) > 20) return null; // sanity check

    return {
      yoyChange: Math.round(yoyChange * 10) / 10,
      asOf: recent[recent.length - 1].date,
    };
  } catch {
    return null;
  }
}

/**
 * Attempt to scrape NARPM research page for latest national average fee.
 */
async function fetchNarpmNationalRate() {
  try {
    const r = await fetch(NARPM_URL, {
      headers: { 'User-Agent': 'RentalIQ/1.0', 'Accept': 'text/html' },
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) return null;
    const html = await r.text();

    // Look for patterns like "X% of monthly rent" or "national average: X%"
    const avgPattern = /national\s+average[^0-9]{0,50}(\d+\.?\d*)\s*%/i;
    const feePattern = /management\s+fee[^0-9]{0,100}(\d+\.?\d*)\s*%/i;

    const avgMatch = html.match(avgPattern) || html.match(feePattern);
    if (!avgMatch) return null;

    const rate = parseFloat(avgMatch[1]);
    if (isNaN(rate) || rate < 4 || rate > 20) return null; // sanity check

    return { rate, source: 'NARPM (live)', asOf: new Date().toISOString().slice(0, 7) };
  } catch {
    return null;
  }
}

/**
 * Fetches live management fee rate estimates.
 * Uses NARPM live data if available, otherwise adjusts the 2024 baseline
 * using housing services CPI inflation.
 *
 * @returns {Promise<Object>} Management fee data: { national, byMetro, source, asOf }
 */
export async function fetchMgmtFeeLive() {
  try {
    const [narpmData, cpiData] = await Promise.allSettled([
      fetchNarpmNationalRate(),
      fetchHousingServicesCpiChange(),
    ]);

    let nationalRate = NARPM_2024_NATIONAL;
    let source = 'NARPM 2024 baseline';
    let asOf = '2024';

    // Prefer live NARPM rate if available
    if (narpmData.status === 'fulfilled' && narpmData.value) {
      nationalRate = narpmData.value.rate;
      source = narpmData.value.source;
      asOf = narpmData.value.asOf;
    }
    // Otherwise apply CPI adjustment to bring 2024 baseline forward
    else if (cpiData.status === 'fulfilled' && cpiData.value) {
      const { yoyChange, asOf: cpiAsOf } = cpiData.value;
      // Apply partial pass-through (management fees track ~40% of housing CPI changes)
      const adjustment = (yoyChange / 100) * 0.4;
      nationalRate = Math.round(NARPM_2024_NATIONAL * (1 + adjustment) * 10) / 10;
      source = `NARPM 2024 baseline + CPI-H adjustment (${yoyChange > 0 ? '+' : ''}${yoyChange}% YoY)`;
      asOf = cpiAsOf;
    }

    // Metro adjustments — high/low-cost markets relative to national
    const METRO_ADJUSTMENTS = {
      // Below national average — competitive markets with lots of management companies
      'dallas':        -1.5, 'houston':       -1.2, 'phoenix':       -1.0,
      'las vegas':     -0.8, 'orlando':       -0.8, 'tampa':         -0.8,
      'jacksonville':  -0.8, 'columbus':      -0.5, 'indianapolis':  -0.5,
      'oklahoma city': -1.0, 'tulsa':         -1.0, 'memphis':       -0.5,
      // Above national average — tight markets, higher property values
      'san francisco':  2.0, 'san jose':       1.8, 'new york':       2.0,
      'boston':         1.5, 'seattle':        1.5, 'los angeles':    1.5,
      'san diego':      1.2, 'denver':         0.8, 'washington':     1.0,
      'miami':          0.5, 'portland':       0.5, 'austin':         0.3,
    };

    const byMetro = {};
    for (const [metro, adj] of Object.entries(METRO_ADJUSTMENTS)) {
      const rate = Math.round((nationalRate + adj) * 10) / 10;
      byMetro[metro] = { rate: Math.max(4.0, Math.min(15.0, rate)), source };
    }

    console.log(`[mgmtFeeLiveFetcher] National rate: ${nationalRate}% (${source})`);

    return {
      national: nationalRate,
      byMetro,
      source,
      asOf,
      _fetchedAt: new Date().toISOString(),
    };
  } catch (err) {
    console.warn('[mgmtFeeLiveFetcher] Error:', err.message);
    return null;
  }
}
