/**
 * lib/fredFetcher.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Fetches live market data from the St. Louis Fed FRED public CSV endpoint.
 * No API key required — uses the public fredgraph.csv endpoint.
 *
 * FRED series used:
 *   MORTGAGE30US  — Freddie Mac PMMS 30-yr fixed (weekly)
 *   MORTGAGE15US  — Freddie Mac PMMS 15-yr fixed (weekly)
 *   MORTGAGE5US   — Freddie Mac PMMS 5/1 ARM (weekly)
 *   CUSR0000SAH1  — BLS CPI Shelter (monthly, 12-mo % change proxy)
 *
 * All fetches use AbortSignal.timeout(5000) and return null on failure.
 * Callers should always have a fallback ready.
 */

const FRED_CSV_BASE = 'https://fred.stlouisfed.org/graph/fredgraph.csv';

// Sanity bounds for each series — rejects obviously bad values
const BOUNDS = {
  MORTGAGE30US: { min: 2.0, max: 15.0 },
  MORTGAGE15US: { min: 1.5, max: 14.0 },
  MORTGAGE5US:  { min: 1.5, max: 14.0 },
  CUSR0000SAH1: { min: 0.0, max: 20.0 },  // CPI level, not % change
};

/**
 * Fetches the latest non-null value from a FRED CSV series.
 * Returns { value, date } or null on failure.
 */
async function fetchFredSeries(seriesId) {
  const url = `${FRED_CSV_BASE}?id=${seriesId}`;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) return null;

    const csv = await r.text();
    const lines = csv.trim().split('\n').filter(l => l && !l.startsWith('DATE'));
    const bounds = BOUNDS[seriesId] || { min: -Infinity, max: Infinity };

    // Walk from newest to oldest — return first valid value
    for (let i = lines.length - 1; i >= 0; i--) {
      const parts = lines[i].split(',');
      if (parts.length < 2) continue;
      const date = parts[0]?.trim();
      const val  = parseFloat(parts[1]);
      if (!isNaN(val) && val >= bounds.min && val <= bounds.max) {
        return { value: val, date };
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Fetches all three mortgage rates simultaneously.
 * Returns { rate30yr, rate15yr, rate5arm, asOf, source }
 * Falls back gracefully — if 15yr or ARM fails, uses derived estimates.
 */
export async function fetchMortgageRates() {
  const [r30, r15, r5] = await Promise.all([
    fetchFredSeries('MORTGAGE30US'),
    fetchFredSeries('MORTGAGE15US'),
    fetchFredSeries('MORTGAGE5US'),
  ]);

  if (!r30) return null; // 30yr is the critical one — abort if unavailable

  const rate30yr = r30.value;
  // If 15yr fetch failed, estimate: historically ~0.65-0.75% below 30yr
  const rate15yr = r15?.value ?? Math.round((rate30yr - 0.70) * 100) / 100;
  // If ARM fetch failed, estimate: historically ~0.50-0.65% below 30yr
  const rate5arm = r5?.value  ?? Math.round((rate30yr - 0.60) * 100) / 100;

  return {
    rate30yr,
    rate15yr,
    rate5arm,
    asOf:   r30.date,
    source: 'FRED/PMMS',
  };
}

/**
 * Fetches BLS CPI Shelter index from FRED (series CUSR0000SAH1).
 * Calculates the 12-month percentage change from the last two annual readings.
 * This is used as the rent growth default assumption.
 *
 * Returns { rate, asOf, source } or null on failure.
 */
export async function fetchCpiShelter() {
  const url = `${FRED_CSV_BASE}?id=CUSR0000SAH1`;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) return null;

    const csv = await r.text();
    const lines = csv.trim().split('\n')
      .filter(l => l && !l.startsWith('DATE'))
      .map(l => {
        const [date, val] = l.split(',');
        return { date: date?.trim(), value: parseFloat(val) };
      })
      .filter(l => !isNaN(l.value) && l.value > 50); // CPI Shelter base ~100+, sanity floor

    if (lines.length < 13) return null; // Need at least 13 months for YoY

    // Most recent value and the value from 12 months prior
    const latest   = lines[lines.length - 1];
    const yearAgo  = lines[lines.length - 13];

    const yoyChange = ((latest.value - yearAgo.value) / yearAgo.value) * 100;

    // Sanity check: CPI shelter rarely moves more than 10%/yr
    if (yoyChange < 0 || yoyChange > 12) return null;

    return {
      rate:   Math.round(yoyChange * 10) / 10, // 1 decimal place
      asOf:   latest.date,
      source: 'FRED/BLS-CPI-Shelter',
    };
  } catch {
    return null;
  }
}

/**
 * Fetches the BLS Producer Price Index for residential construction
 * (FRED series PCU2361--2361--) and computes a cost multiplier relative
 * to a 2019 baseline.
 *
 * This multiplier is applied to the hardcoded base CapEx amounts:
 *   SFR:    $150/mo baseline (2019 dollars) × multiplier
 *   Duplex: $240/mo baseline × multiplier
 *   MFR:    $300/mo baseline × multiplier
 *
 * FRED series: PCU2361--2361--
 *   "Producer Price Index by Industry: New Single-Family Housing Construction"
 *   Monthly, not seasonally adjusted. Base year = 2019 (index ≈ 100).
 *   Source: BLS via FRED.
 *
 * Returns:
 *   {
 *     multiplier: 1.38,       // apply to 2019-baseline CapEx amounts
 *     baseYear: 2019,
 *     currentIndex: 138.2,    // raw PPI index value
 *     baseIndex: 100.0,       // index value at baseYear (normalized)
 *     asOf: "2026-01",        // YYYY-MM of the latest data point
 *     source: "FRED/BLS-PPI-Construction",
 *   }
 *   or null on failure.
 *
 * Design note: The series is normalized so that the average of all months in
 * the base year equals 100.0. We compute this dynamically from the data rather
 * than hard-coding 100.0, so the calculation remains accurate if FRED ever
 * re-bases the series.
 */
export async function fetchConstructionPPI() {
  const BASE_YEAR = 2019;
  const SERIES_ID = 'PCU2361--2361--';

  // Sanity bounds for the PPI index level
  const PPI_MIN = 50.0;   // Would represent a 50% decline from 2019 — never seen
  const PPI_MAX = 400.0;  // 4× 2019 cost — extreme upper bound

  const url = `${FRED_CSV_BASE}?id=${SERIES_ID}`;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;

    const csv = await r.text();
    const lines = csv.trim().split('\n')
      .filter(l => l && !l.startsWith('DATE'))
      .map(l => {
        const [date, val] = l.split(',');
        const dateStr = date?.trim();
        const value   = parseFloat(val);
        if (!dateStr || isNaN(value) || value === '.') return null;
        // Extract year from YYYY-MM-DD
        const year = parseInt(dateStr.substring(0, 4));
        return { date: dateStr, year, value };
      })
      .filter(Boolean)
      .filter(p => p.value >= PPI_MIN && p.value <= PPI_MAX);

    if (lines.length < 12) {
      console.warn('[fredFetcher] Insufficient PPI data points');
      return null;
    }

    // Compute base year average (normalize against actual 2019 data in the series)
    const baseYearObs = lines.filter(p => p.year === BASE_YEAR);
    if (baseYearObs.length < 6) {
      // Fewer than 6 months of base year data is suspicious — bail
      console.warn(`[fredFetcher] Only ${baseYearObs.length} months of ${BASE_YEAR} PPI data`);
      return null;
    }
    const baseIndex = baseYearObs.reduce((sum, p) => sum + p.value, 0) / baseYearObs.length;

    // Latest valid reading
    const latest = lines[lines.length - 1];
    const multiplier = latest.value / baseIndex;

    // Sanity check on multiplier — construction costs can't have tripled in 5 years
    if (multiplier < 0.5 || multiplier > 3.0) {
      console.warn(`[fredFetcher] PPI multiplier ${multiplier.toFixed(3)} out of expected range`);
      return null;
    }

    return {
      multiplier:    Math.round(multiplier * 1000) / 1000, // 3 decimal places
      baseYear:      BASE_YEAR,
      currentIndex:  Math.round(latest.value * 10) / 10,
      baseIndex:     Math.round(baseIndex * 10) / 10,
      asOf:          latest.date.substring(0, 7), // YYYY-MM
      source:        'FRED/BLS-PPI-Construction',
    };
  } catch (err) {
    console.warn('[fredFetcher] PPI construction fetch error:', err.message);
    return null;
  }
}


// ─── Metro unemployment (3C) ──────────────────────────────────────────────────

/**
 * FRED series IDs for metro-level unemployment rates.
 * Source: BLS Local Area Unemployment Statistics (LAUS) via FRED.
 * Format: {METRO_CODE}UR — e.g. AUST448UR for Austin metro.
 *
 * These are seasonally-adjusted monthly unemployment rates (percentage).
 * National comparison series: UNRATE (civilian unemployment rate, SA).
 *
 * Coverage: ~45 major metros matching our city_appreciation keys.
 * Series IDs verified against FRED as of 2026-Q1.
 */
const CITY_TO_FRED_UNEMPLOYMENT = {
  // Texas
  austin:             'AUST448UR',
  dallas:             'DALL748UR',
  houston:            'HOUN448UR',
  'san antonio':      'SANTAN548UR',
  'fort worth':       'DALL748UR',    // Dallas-Fort Worth MSA composite
  'el paso':          'ELPAN448UR',
  // Florida
  miami:              'MIAM448UR',
  tampa:              'TAMP848UR',
  orlando:            'ORLA448UR',
  jacksonville:       'JACK448UR',
  'fort lauderdale':  'MIAM448UR',    // Miami-Fort Lauderdale MSA
  // Pacific Northwest
  seattle:            'SEAT748UR',
  bellevue:           'SEAT748UR',    // Seattle MSA
  portland:           'PORT648UR',
  spokane:            'SPOK448UR',
  // Mountain West
  denver:             'DENV748UR',
  'colorado springs': 'COLO448UR',
  boise:              'BOIS448UR',
  'salt lake city':   'SALT448UR',
  provo:              'PROV448UR',
  // California
  'san francisco':    'SANF448UR',
  'san jose':         'SANJ448UR',
  oakland:            'OAKL448UR',
  'los angeles':      'LOSA448UR',
  'san diego':        'SAND448UR',
  sacramento:         'SACR448UR',
  // Northeast
  'new york':         'NEWY636UR',
  boston:             'BOST748UR',
  philadelphia:       'PHIL748UR',
  pittsburgh:         'PITT448UR',
  // Mid-Atlantic
  washington:         'WASH448UR',
  baltimore:          'BALT448UR',
  richmond:           'RICH448UR',
  'virginia beach':   'VIRG448UR',
  // Midwest
  chicago:            'CHIC917UR',
  minneapolis:        'MINN448UR',
  'kansas city':      'KANS748UR',
  columbus:           'COLU448UR',
  indianapolis:       'INDI448UR',
  cincinnati:         'CINC748UR',
  cleveland:          'CLEV448UR',
  detroit:            'DETR748UR',
  milwaukee:          'MILW448UR',
  'st. louis':        'STLO748UR',
  memphis:            'MEMP448UR',
  louisville:         'LOUI448UR',
  // Southeast
  atlanta:            'ATLA748UR',
  charlotte:          'CHAR748UR',
  nashville:          'NASH448UR',
  raleigh:            'RALE448UR',
  durham:             'DURHUR',       // Durham-Chapel Hill MSA
  birmingham:         'BIRM448UR',
  'new orleans':      'NEWO448UR',
  // Southwest
  phoenix:            'PHOE748UR',
  tucson:             'TUCS448UR',
  'las vegas':        'LASV448UR',
  henderson:          'LASV448UR',    // Las Vegas MSA
  albuquerque:        'ALBU448UR',
};

// National unemployment reference series
const NATIONAL_UNEMPLOYMENT_SERIES = 'UNRATE';

/**
 * Fetches the metro unemployment rate for a given city.
 *
 * Returns:
 *   {
 *     rate:          3.2,     // current unemployment rate (%)
 *     nationalRate:  4.1,     // national rate for comparison
 *     yoyChange:    -0.4,     // change vs 12 months prior (pp)
 *     trend:         "improving", // "improving" | "worsening" | "stable"
 *     asOf:          "2026-01",   // YYYY-MM of latest data
 *     source:        "FRED/BLS-LAUS",
 *   }
 *   or null if data unavailable.
 *
 * @param {string} cityString - e.g. "Austin, TX" or "austin"
 */
export async function fetchMetroUnemployment(cityString) {
  if (!cityString) return null;

  const cityKey = cityString.split(',')[0].trim().toLowerCase();
  const seriesId = CITY_TO_FRED_UNEMPLOYMENT[cityKey];

  if (!seriesId) return null; // Metro not in our coverage list

  // Fetch metro + national in parallel
  const [metroResult, nationalResult] = await Promise.allSettled([
    fetchFredSeries(seriesId),
    fetchFredSeries(NATIONAL_UNEMPLOYMENT_SERIES),
  ]);

  const metroLatest = metroResult.status === 'fulfilled' ? metroResult.value : null;
  const nationalLatest = nationalResult.status === 'fulfilled' ? nationalResult.value : null;

  if (!metroLatest) return null;

  // Validate unemployment rate bounds (0–25% is the plausible range)
  if (metroLatest.value < 0 || metroLatest.value > 25) return null;

  // Fetch the full series to compute YoY change
  // We need at least 13 months of history
  const url = `${FRED_CSV_BASE}?id=${seriesId}`;
  let yoyChange = null;
  let trend = 'stable';

  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (r.ok) {
      const csv = await r.text();
      const observations = csv.trim().split('\n')
        .filter(l => l && !l.startsWith('DATE'))
        .map(l => {
          const [date, val] = l.split(',');
          const value = parseFloat(val);
          return (isNaN(value) || value < 0 || value > 25) ? null : { date: date?.trim(), value };
        })
        .filter(Boolean);

      if (observations.length >= 13) {
        const latest  = observations[observations.length - 1];
        const yearAgo = observations[observations.length - 13];
        yoyChange = Math.round((latest.value - yearAgo.value) * 10) / 10;

        // Classify trend: >0.3pp worsening, <-0.3pp improving, else stable
        if (yoyChange < -0.3)      trend = 'improving'; // falling unemployment = improving
        else if (yoyChange > 0.3)  trend = 'worsening';
        else                       trend = 'stable';
      }
    }
  } catch { /* non-fatal — yoyChange stays null */ }

  return {
    rate:         Math.round(metroLatest.value * 10) / 10,
    nationalRate: nationalLatest ? Math.round(nationalLatest.value * 10) / 10 : null,
    yoyChange,
    trend,
    asOf:         metroLatest.date?.substring(0, 7) ?? null, // YYYY-MM
    source:       'FRED/BLS-LAUS',
  };
}

/**
 * Returns true if we have a FRED unemployment series for the given city string.
 * Used by the cron to avoid storing null entries for unsupported metros.
 */
export function hasMetroUnemploymentData(cityString) {
  if (!cityString) return false;
  const cityKey = cityString.split(',')[0].trim().toLowerCase();
  return cityKey in CITY_TO_FRED_UNEMPLOYMENT;
}
/**
 * Convenience: fetch everything in parallel.
 * Returns { mortgageRates, cpiShelter, constructionPpi } — any can be null on failure.
 * Note: fetchMetroUnemployment is NOT included here — it is city-specific and
 * fetched separately by the cron per city key, not as a global batch.
 */
export async function fetchAllFredData() {
  const [mortgageRates, cpiShelter, constructionPpi] = await Promise.all([
    fetchMortgageRates(),
    fetchCpiShelter(),
    fetchConstructionPPI(),
  ]);
  return { mortgageRates, cpiShelter, constructionPpi };
}
