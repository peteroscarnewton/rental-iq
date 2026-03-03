/**
 * lib/censusFetcher.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Fetches per-ZIP neighborhood data from the Census Bureau ACS 5-Year estimates.
 * No API key required for the public Census Data API.
 *
 * Functions exported:
 *   fetchVacancyRate(zip)     → { rate, total, vacant, asOf } | null
 *   fetchMedianHomeValue(zip) → { value, asOf } | null
 *   fetchZipEnrichment(zip)   → { vacancyRate, medianHomeValue, asOf } | null
 *
 * ACS tables used:
 *   B25004_001E — Total vacant housing units
 *   B25001_001E — Total housing units (occupied + vacant)
 *   B25077_001E — Median value of owner-occupied housing units
 *
 * The ACS 5-year estimates are the most stable and ZIP-complete dataset
 * available from Census. The current vintage is 2023 (covers 2019–2023).
 *
 * Error philosophy:
 *   - All functions return null on any failure (never throw to callers).
 *   - Negative Census values (-666666666, etc.) indicate suppressed data
 *     for small populations — treated as null.
 *   - Results are not cached here; caching is handled at the API route level
 *     via the 7-day Cache-Control header in neighborhood.js.
 */

const CENSUS_ACS_BASE = 'https://api.census.gov/data/2023/acs/acs5';

// Census uses large negative sentinels for suppressed/missing data
const CENSUS_MISSING_THRESHOLD = -1;

// Sanity bounds — rejects values that are statistically implausible
const BOUNDS = {
  vacancyRate:      { min: 0.0,     max: 60.0   }, // % — Detroit metro peaks ~25%
  totalUnits:       { min: 1,       max: 500000 },  // units
  medianHomeValue:  { min: 10000,   max: 5000000 }, // $ — rejects obvious errors
};

/**
 * Fetches multiple ACS variables for a single ZIP code in one API call.
 * Returns the raw row array (row[0] = headers, row[1] = values) or null.
 *
 * @param {string} zip   - 5-digit ZIP code
 * @param {string[]} vars - ACS variable codes e.g. ['B25001_001E', 'B25004_001E']
 */
async function fetchAcsZip(zip, vars) {
  if (!/^\d{5}$/.test(zip)) return null;

  const varList = vars.join(',');
  const url = `${CENSUS_ACS_BASE}?get=${varList}&for=zip+code+tabulation+area:${zip}`;

  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) {
      // 204 / 404 = ZIP not in ACS (rural or PO Box only ZIPs)
      if (r.status !== 404 && r.status !== 204) {
        console.warn(`[censusFetcher] ACS HTTP ${r.status} for ZIP ${zip}`);
      }
      return null;
    }
    const rows = await r.json();
    // rows[0] = header labels, rows[1] = data values
    // If Census returns only the header (no match), rows.length === 1
    if (!Array.isArray(rows) || rows.length < 2) return null;
    return rows;
  } catch (err) {
    console.warn(`[censusFetcher] Fetch error for ZIP ${zip}:`, err.message);
    return null;
  }
}

/**
 * Safely parses a Census integer value, returning null for sentinels or NaN.
 */
function parseCensusInt(raw) {
  const n = parseInt(raw, 10);
  if (isNaN(n) || n <= CENSUS_MISSING_THRESHOLD) return null;
  return n;
}

// ─── Public functions ─────────────────────────────────────────────────────────

/**
 * Fetches the vacancy rate for a ZIP code from Census ACS B25004 (vacant
 * housing units) and B25001 (total housing units).
 *
 * Returns:
 *   {
 *     rate: 7.4,       // vacancy rate as percentage (e.g. 7.4 = 7.4%)
 *     total: 4820,     // total housing units in ZIP
 *     vacant: 357,     // total vacant units
 *     asOf: "2023",    // ACS vintage year
 *   }
 *   or null if data is unavailable or suppressed.
 *
 * Note: ACS B25004 counts ALL vacant units including seasonal/recreational.
 * This tends to overstate rental vacancy in resort markets (FL Keys, etc.).
 * The caller should be aware of this limitation and document it in the UI.
 */
export async function fetchVacancyRate(zip) {
  const rows = await fetchAcsZip(zip, ['B25001_001E', 'B25004_001E']);
  if (!rows) return null;

  const headers = rows[0];
  const values  = rows[1];

  const totalIdx  = headers.indexOf('B25001_001E');
  const vacantIdx = headers.indexOf('B25004_001E');

  if (totalIdx === -1 || vacantIdx === -1) {
    console.warn('[censusFetcher] Unexpected ACS response format — variable index not found');
    return null;
  }

  const total  = parseCensusInt(values[totalIdx]);
  const vacant = parseCensusInt(values[vacantIdx]);

  if (total === null || vacant === null) return null;
  if (total < BOUNDS.vacancyRate.min || total > BOUNDS.totalUnits.max) return null;
  if (vacant < 0 || vacant > total) return null;

  const rate = (vacant / total) * 100;

  if (rate < BOUNDS.vacancyRate.min || rate > BOUNDS.vacancyRate.max) {
    console.warn(`[censusFetcher] Vacancy rate ${rate.toFixed(1)}% out of bounds for ZIP ${zip}`);
    return null;
  }

  return {
    rate:   Math.round(rate * 10) / 10, // 1 decimal place
    total,
    vacant,
    asOf:   '2023', // ACS 5-year vintage
  };
}

/**
 * Fetches the median owner-occupied home value for a ZIP from ACS B25077.
 *
 * Returns:
 *   {
 *     value: 385000,  // median home value in dollars
 *     asOf: "2023",
 *   }
 *   or null if data is unavailable or suppressed.
 */
export async function fetchMedianHomeValue(zip) {
  const rows = await fetchAcsZip(zip, ['B25077_001E']);
  if (!rows) return null;

  const headers = rows[0];
  const values  = rows[1];

  const valueIdx = headers.indexOf('B25077_001E');
  if (valueIdx === -1) return null;

  const homeValue = parseCensusInt(values[valueIdx]);
  if (homeValue === null) return null;

  if (homeValue < BOUNDS.medianHomeValue.min || homeValue > BOUNDS.medianHomeValue.max) {
    console.warn(`[censusFetcher] Median home value $${homeValue} out of bounds for ZIP ${zip}`);
    return null;
  }

  return {
    value: homeValue,
    asOf:  '2023',
  };
}

/**
 * Convenience function: fetches vacancy rate and median home value in a single
 * parallel request batch (2 ACS calls run concurrently).
 *
 * Returns:
 *   {
 *     vacancyRate:     { rate, total, vacant, asOf } | null,
 *     medianHomeValue: { value, asOf }               | null,
 *   }
 *
 * Both fields are independently nullable. A null result for one does not
 * prevent the other from being returned. The caller is responsible for
 * handling partial results.
 */
export async function fetchZipEnrichment(zip) {
  if (!zip || !/^\d{5}$/.test(zip)) {
    return { vacancyRate: null, medianHomeValue: null };
  }

  // Batch both variables into a single Census API call to minimize latency
  const rows = await fetchAcsZip(zip, ['B25001_001E', 'B25004_001E', 'B25077_001E']);

  if (!rows) {
    return { vacancyRate: null, medianHomeValue: null };
  }

  const headers = rows[0];
  const values  = rows[1];

  // ── Vacancy rate ──────────────────────────────────────────────────────────
  let vacancyRate = null;
  const totalIdx  = headers.indexOf('B25001_001E');
  const vacantIdx = headers.indexOf('B25004_001E');

  if (totalIdx !== -1 && vacantIdx !== -1) {
    const total  = parseCensusInt(values[totalIdx]);
    const vacant = parseCensusInt(values[vacantIdx]);

    if (
      total !== null && vacant !== null &&
      total >= 1 && total <= BOUNDS.totalUnits.max &&
      vacant >= 0 && vacant <= total
    ) {
      const rate = (vacant / total) * 100;
      if (rate >= BOUNDS.vacancyRate.min && rate <= BOUNDS.vacancyRate.max) {
        vacancyRate = {
          rate:   Math.round(rate * 10) / 10,
          total,
          vacant,
          asOf:   '2023',
        };
      }
    }
  }

  // ── Median home value ─────────────────────────────────────────────────────
  let medianHomeValue = null;
  const homeValIdx = headers.indexOf('B25077_001E');

  if (homeValIdx !== -1) {
    const homeValue = parseCensusInt(values[homeValIdx]);
    if (
      homeValue !== null &&
      homeValue >= BOUNDS.medianHomeValue.min &&
      homeValue <= BOUNDS.medianHomeValue.max
    ) {
      medianHomeValue = {
        value: homeValue,
        asOf:  '2023',
      };
    }
  }

  return { vacancyRate, medianHomeValue };
}
