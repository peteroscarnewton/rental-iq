/**
 * lib/caseShillerFetcher.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Fetches S&P CoreLogic Case-Shiller Home Price Index data for major metros
 * from FRED. Computes YoY, 3yr CAGR, and 5yr CAGR, and classifies the trend
 * direction (accelerating / stable / decelerating).
 *
 * Case-Shiller vs FHFA:
 *   - FHFA (Phase 2) covers conforming loans only — more complete ZIP coverage
 *   - Case-Shiller covers repeat-sale all-transactions — better for high-end
 *     and investor-relevant markets; more widely cited by analysts
 *   Both are stored. The UI uses Case-Shiller for trend visualization and
 *   FHFA for appreciation rate assumptions (more granular geographically).
 *
 * FRED series naming:
 *   All metro Case-Shiller series follow the pattern: {METRO_CODE}RNSA or {METRO_CODE}RSA
 *   (non-seasonally-adjusted / seasonally-adjusted). We prefer NSA since
 *   investors compare raw index levels across time.
 *
 *   National composite: CSUSHPINSA (20-city composite)
 *
 * Release schedule: Monthly, approx 60-day lag.
 * TTL: 30 days (monthly data — no value in refreshing more often).
 *
 * market_data_cache key: `case_shiller:{metro_key}` (e.g. case_shiller:miami)
 * Value shape:
 *   {
 *     metro:       "Miami",
 *     fredSeries:  "MIAMRNSA",
 *     current:     385.2,       // latest index value
 *     prev1yr:     362.4,       // index 12 months prior
 *     prev3yr:     298.1,       // index ~36 months prior
 *     prev5yr:     241.0,       // index ~60 months prior
 *     yoyPct:      6.3,         // 1yr % change
 *     cagr3yr:     8.9,         // 3yr annualized
 *     cagr5yr:     9.8,         // 5yr annualized
 *     trend:       "decelerating", // vs prior 12mo momentum
 *     asOf:        "2025-12",   // YYYY-MM of latest data point
 *     source:      "FRED/Case-Shiller",
 *   }
 *
 * Error philosophy: Returns null per metro on failure. The caller skips
 * storage for null results — existing cached data is retained.
 */

const FRED_CSV_BASE = 'https://fred.stlouisfed.org/graph/fredgraph.csv';

// ─── Metro → FRED series mapping ─────────────────────────────────────────────
// NSA (non-seasonally adjusted) series used for investor-relevant raw index levels.
// SA (seasonally adjusted) exists for most but NSA is more commonly cited.
// Source: https://fred.stlouisfed.org/categories/32261
//
// Key: our internal city/metro key (matches city_appreciation keys)
// fredSeries: FRED series ID for the NSA index
// displayName: human-readable metro name for UI display
export const CASE_SHILLER_METROS = {
  // National composite
  national: {
    fredSeries:  'CSUSHPINSA',
    displayName: 'National (20-city)',
  },
  // Individual metros — sorted by investor relevance
  miami: {
    fredSeries:  'MIAMRNSA',
    displayName: 'Miami-Fort Lauderdale',
  },
  'fort lauderdale': {
    fredSeries:  'MIAMRNSA',  // Same MSA composite
    displayName: 'Miami-Fort Lauderdale',
  },
  tampa: {
    fredSeries:  'TAMPRNSA',
    displayName: 'Tampa-St. Petersburg',
  },
  phoenix: {
    fredSeries:  'PHXRNSA',
    displayName: 'Phoenix',
  },
  dallas: {
    fredSeries:  'DALRNSA',
    displayName: 'Dallas',
  },
  seattle: {
    fredSeries:  'SEXRNSA',
    displayName: 'Seattle',
  },
  denver: {
    fredSeries:  'DNVRNSA',
    displayName: 'Denver',
  },
  charlotte: {
    fredSeries:  'CHARNSA',
    displayName: 'Charlotte',
  },
  'las vegas': {
    fredSeries:  'LVXRNSA',
    displayName: 'Las Vegas',
  },
  'los angeles': {
    fredSeries:  'LXXRNSA',
    displayName: 'Los Angeles',
  },
  'san diego': {
    fredSeries:  'SDXRNSA',
    displayName: 'San Diego',
  },
  'san francisco': {
    fredSeries:  'SFXRNSA',
    displayName: 'San Francisco',
  },
  portland: {
    fredSeries:  'POXRNSA',
    displayName: 'Portland',
  },
  minneapolis: {
    fredSeries:  'MNMRNSA',
    displayName: 'Minneapolis',
  },
  chicago: {
    fredSeries:  'CHXRNSA',
    displayName: 'Chicago',
  },
  boston: {
    fredSeries:  'BOXRNSA',
    displayName: 'Boston',
  },
  'new york': {
    fredSeries:  'NYXRNSA',
    displayName: 'New York',
  },
  washington: {
    fredSeries:  'WDXRNSA',
    displayName: 'Washington DC',
  },
  atlanta: {
    fredSeries:  'ATXRNSA',
    displayName: 'Atlanta',
  },
  cleveland: {
    fredSeries:  'CEXRNSA',
    displayName: 'Cleveland',
  },
  detroit: {
    fredSeries:  'DEXRNSA',
    displayName: 'Detroit',
  },
};

// ─── Sanity bounds ────────────────────────────────────────────────────────────
const INDEX_MIN = 50.0;    // Case-Shiller index started around 100 in 2000
const INDEX_MAX = 600.0;   // Extreme upper bound
const YOY_MIN   = -20.0;   // -20%/yr — worst crash in series history
const YOY_MAX   = 30.0;    // +30%/yr — peak 2021 readings in some metros

// ─── Core fetch ───────────────────────────────────────────────────────────────

/**
 * Fetches a single FRED Case-Shiller series and returns parsed monthly observations.
 * Returns array of { date: 'YYYY-MM-DD', yearMonth: 'YYYY-MM', value: number }
 * sorted oldest to newest, or null on failure.
 */
async function fetchCsSeriesObservations(fredSeries) {
  const url = `${FRED_CSV_BASE}?id=${fredSeries}`;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;

    const csv = await r.text();
    const observations = csv
      .trim()
      .split('\n')
      .filter(l => l && !l.startsWith('DATE'))
      .map(l => {
        const parts = l.split(',');
        const date  = parts[0]?.trim();
        const val   = parseFloat(parts[1]);
        if (!date || isNaN(val) || val < INDEX_MIN || val > INDEX_MAX) return null;
        return {
          date,
          yearMonth: date.substring(0, 7), // YYYY-MM
          value: val,
        };
      })
      .filter(Boolean);

    return observations.length >= 13 ? observations : null;
  } catch (err) {
    console.warn(`[caseShillerFetcher] Fetch error for ${fredSeries}:`, err.message);
    return null;
  }
}

/**
 * Finds the observation closest to `targetMonthsBack` from the end of the array.
 * Accepts up to ±3 months tolerance to handle release lag and missing values.
 * Returns the observation or null.
 */
function findObservationNMonthsAgo(observations, targetMonthsBack) {
  if (!observations || observations.length === 0) return null;
  const latestIdx = observations.length - 1;
  const targetIdx = latestIdx - targetMonthsBack;
  const searchStart = Math.max(0, targetIdx - 3);
  const searchEnd   = Math.min(latestIdx - 1, targetIdx + 3);

  let best = null;
  let bestDist = Infinity;
  for (let i = searchStart; i <= searchEnd; i++) {
    const dist = Math.abs(i - targetIdx);
    if (dist < bestDist) {
      bestDist = dist;
      best = observations[i];
    }
  }
  return best;
}

/**
 * Computes a CAGR between two observations.
 * yearsElapsed is computed from their actual positions in the monthly series.
 * Returns null if either observation is missing or the CAGR is out of bounds.
 */
function computeCagr(fromObs, toObs, nominalYears) {
  if (!fromObs || !toObs) return null;
  if (fromObs.value <= 0 || toObs.value <= 0) return null;

  // Use nominal years for simplicity — the ±3-month tolerance in findObservationNMonthsAgo
  // means actual elapsed time is close enough to the nominal for 1 decimal precision
  const cagr = (Math.pow(toObs.value / fromObs.value, 1 / nominalYears) - 1) * 100;

  if (cagr < YOY_MIN || cagr > YOY_MAX) return null;
  return Math.round(cagr * 10) / 10;
}

/**
 * Classifies the price trend direction by comparing recent momentum.
 * Uses 12-month change ending at the latest date vs 12-month change ending 12 months prior.
 * This avoids overfitting to single-month noise.
 *
 * Returns: 'accelerating' | 'stable' | 'decelerating'
 */
function classifyTrend(observations) {
  const latest = observations[observations.length - 1];
  const prev12 = findObservationNMonthsAgo(observations, 12);
  const prev24 = findObservationNMonthsAgo(observations, 24);

  if (!prev12 || !prev24) return 'stable';

  const recentYoy   = ((latest.value - prev12.value) / prev12.value) * 100;
  const priorYoy    = ((prev12.value - prev24.value) / prev24.value) * 100;
  const momentumDelta = recentYoy - priorYoy;

  // Only classify as accelerating/decelerating if the delta is meaningful (>1.5 pp)
  if (momentumDelta > 1.5)  return 'accelerating';
  if (momentumDelta < -1.5) return 'decelerating';
  return 'stable';
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Fetches Case-Shiller data for a single metro key.
 *
 * @param {string} metroKey - key from CASE_SHILLER_METROS (e.g. 'miami', 'national')
 * @returns {Object|null} - formatted cache value or null on failure
 */
export async function fetchCaseShillerMetro(metroKey) {
  const mapping = CASE_SHILLER_METROS[metroKey];
  if (!mapping) return null;

  const observations = await fetchCsSeriesObservations(mapping.fredSeries);
  if (!observations || observations.length < 13) return null;

  const latest = observations[observations.length - 1];
  const prev1yr = findObservationNMonthsAgo(observations, 12);
  const prev3yr = findObservationNMonthsAgo(observations, 36);
  const prev5yr = findObservationNMonthsAgo(observations, 60);

  if (!prev1yr) return null; // 1yr YoY is the minimum we need

  const yoyPct  = ((latest.value - prev1yr.value) / prev1yr.value) * 100;
  if (yoyPct < YOY_MIN || yoyPct > YOY_MAX) return null;

  const cagr3yr = computeCagr(prev3yr, latest, 3);
  const cagr5yr = computeCagr(prev5yr, latest, 5);
  const trend   = classifyTrend(observations);

  return {
    metro:      mapping.displayName,
    fredSeries: mapping.fredSeries,
    current:    Math.round(latest.value * 10) / 10,
    prev1yr:    prev1yr  ? Math.round(prev1yr.value * 10)  / 10 : null,
    prev3yr:    prev3yr  ? Math.round(prev3yr.value * 10)  / 10 : null,
    prev5yr:    prev5yr  ? Math.round(prev5yr.value * 10)  / 10 : null,
    yoyPct:     Math.round(yoyPct * 10) / 10,
    cagr3yr,
    cagr5yr,
    trend,
    asOf:       latest.yearMonth,
    source:     'FRED/Case-Shiller',
  };
}

/**
 * Fetches Case-Shiller data for all configured metros in parallel.
 * Returns a map of metroKey → result (null values are filtered out before storage).
 *
 * Designed for the weekly cron refresh — fetches all metros in one pass.
 * Each fetch is independent; failure of one does not affect others.
 */
export async function fetchAllCaseShillerMetros() {
  const metroKeys = Object.keys(CASE_SHILLER_METROS);

  // Deduplicate by FRED series — some city keys share a series (e.g. miami + fort lauderdale)
  const seriesSeen = new Set();
  const uniqueMetros = metroKeys.filter(key => {
    const series = CASE_SHILLER_METROS[key].fredSeries;
    if (seriesSeen.has(series)) return false;
    seriesSeen.add(series);
    return true;
  });

  const results = await Promise.allSettled(
    uniqueMetros.map(async key => ({
      key,
      data: await fetchCaseShillerMetro(key),
    }))
  );

  // Assemble results; share data for metros that alias the same FRED series
  const byFredSeries = {};
  const output = {};

  for (const r of results) {
    if (r.status !== 'fulfilled' || !r.value.data) continue;
    const { key, data } = r.value;
    byFredSeries[data.fredSeries] = data;
    output[key] = data;
  }

  // Propagate shared series results to aliased city keys
  for (const key of metroKeys) {
    if (output[key]) continue; // already set
    const series = CASE_SHILLER_METROS[key].fredSeries;
    if (byFredSeries[series]) {
      output[key] = byFredSeries[series];
    }
  }

  const successCount = Object.keys(output).length;
  console.log(`[caseShillerFetcher] Fetched ${successCount}/${metroKeys.length} metros`);

  return output; // { miami: {...}, dallas: {...}, ... }
}

/**
 * Returns the Case-Shiller metro key for a given city string.
 * City string format: "Austin, TX" or just "Austin".
 * Returns null if no Case-Shiller coverage for this city.
 */
export function getCaseShillerKey(cityString) {
  if (!cityString) return null;
  const cityName = cityString.split(',')[0].trim().toLowerCase();

  // Direct match first
  if (CASE_SHILLER_METROS[cityName]) return cityName;

  // Partial match — covers "fort lauderdale" → miami series, etc.
  for (const key of Object.keys(CASE_SHILLER_METROS)) {
    if (cityName.includes(key) || key.includes(cityName)) return key;
  }

  return null;
}
