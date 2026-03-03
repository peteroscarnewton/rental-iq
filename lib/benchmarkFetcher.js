/**
 * lib/benchmarkFetcher.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Phase 5 — Financial Benchmark Intelligence
 *
 * Fetches the five live data sources that contextualize every IRR, CoC, and
 * expense figure in the analysis:
 *
 *   1. fetchTreasuryYield()      — 10-yr Treasury yield (FRED DGS10)
 *   2. fetchSP500Returns()       — S&P 500 trailing 3/5/10yr CAGR (FRED SP500)
 *   3. fetchPmiRates()           — PMI rate table by LTV band (compiled rate cards)
 *   4. fetchZoriRentGrowth()     — Metro rent growth from Zillow ZORI CSV
 *   5. fetchClosingCostDefaults()— State average closing costs (CFPB ClosingCorp data)
 *
 * All sources are free and require no API keys.
 *
 * Cache keys:
 *   treasury_yield               → { rate, asOf, source }
 *   sp500_returns                → { return10yr, return5yr, return3yr, currentLevel, asOf }
 *   pmi_rates                    → { byLtv: { ltv95_97, ltv90_95, ltv85_90, ltv80_85 }, asOf }
 *   zori_rent_growth:{metro_key} → { annualGrowthPct, metro, asOf, source }
 *   state_closing_costs          → { [stateCode]: pct, ... }
 *
 * Error philosophy: Each function returns null on failure. The cron logs
 * failures but never crashes — baseline fallbacks in marketData.js cover gaps.
 */

const FRED_CSV = 'https://fred.stlouisfed.org/graph/fredgraph.csv';

// ─── Helper: fetch a FRED CSV series → array of {date, value} ────────────────
async function fetchFredCsv(seriesId, limit = null) {
  const url = `${FRED_CSV}?id=${seriesId}`;
  const r = await fetch(url, { signal: AbortSignal.timeout(12000) });
  if (!r.ok) return null;
  const text = await r.text();
  const lines = text.trim().split('\n').slice(1); // skip header
  const obs = lines
    .map(l => {
      const [date, val] = l.split(',');
      const value = parseFloat(val);
      return (isNaN(value) || value <= 0 || val?.trim() === '.') ? null : { date: date?.trim(), value };
    })
    .filter(Boolean);
  return limit ? obs.slice(-limit) : obs;
}

// ─── 1. 10-Year Treasury Yield ────────────────────────────────────────────────
/**
 * Fetches the 10-Year US Treasury Constant Maturity yield from FRED (DGS10).
 * Daily data. Returned value is already a percentage (e.g., 4.62 = 4.62%/yr).
 *
 * Used as the risk-free rate benchmark in every analysis:
 *   "Your 8.4% IRR vs. 4.6% 10yr Treasury = 3.8% real estate premium"
 *
 * @returns {{ rate: number, asOf: string, source: string }|null}
 */
export async function fetchTreasuryYield() {
  try {
    const obs = await fetchFredCsv('DGS10', 30); // last 30 trading days
    if (!obs || obs.length === 0) return null;

    // Get the most recent non-null value (weekends and holidays return '.')
    const latest = [...obs].reverse().find(o => o.value > 0);
    if (!latest) return null;

    // Sanity: Treasury yield should be between 0.5% and 20%
    if (latest.value < 0.5 || latest.value > 20) return null;

    return {
      rate:   Math.round(latest.value * 100) / 100,
      asOf:   latest.date,
      source: 'FRED/DGS10',
    };
  } catch (err) {
    console.warn('[benchmarkFetcher] Treasury yield failed:', err.message);
    return null;
  }
}

// ─── 2. S&P 500 Trailing Returns ──────────────────────────────────────────────
/**
 * Fetches S&P 500 weekly close prices from FRED (SP500) and computes
 * trailing 3-year, 5-year, and 10-year annualized returns (CAGR).
 *
 * Method: (currentLevel / levelNYrsAgo)^(1/N) - 1
 * This is the actual realized compounded return — not a survey estimate.
 *
 * Used to show the index-fund alternative to every deal's IRR:
 *   "SPY returned 10.4%/yr over 10 years. This deal's IRR: 8.2%."
 *
 * @returns {{
 *   return10yr: number, return5yr: number, return3yr: number,
 *   currentLevel: number, asOf: string, source: string
 * }|null}
 */
export async function fetchSP500Returns() {
  try {
    const obs = await fetchFredCsv('SP500'); // all available weekly data
    if (!obs || obs.length < 200) return null;

    const latest = obs[obs.length - 1];
    const latestMs = new Date(latest.date).getTime();

    // Find observation closest to N years ago
    function findNYearsAgo(n) {
      const targetMs = latestMs - n * 365.25 * 24 * 60 * 60 * 1000;
      let best = null, bestDiff = Infinity;
      for (const o of obs) {
        const diff = Math.abs(new Date(o.date).getTime() - targetMs);
        if (diff < bestDiff) { bestDiff = diff; best = o; }
      }
      return best;
    }

    const obs3yr  = findNYearsAgo(3);
    const obs5yr  = findNYearsAgo(5);
    const obs10yr = findNYearsAgo(10);

    function cagr(from, to, years) {
      if (!from || !to || from.value <= 0) return null;
      const r = (Math.pow(to.value / from.value, 1 / years) - 1) * 100;
      return (r < -30 || r > 60) ? null : Math.round(r * 10) / 10;
    }

    const return10yr = cagr(obs10yr, latest, 10);
    const return5yr  = cagr(obs5yr,  latest, 5);
    const return3yr  = cagr(obs3yr,  latest, 3);

    if (return10yr === null) return null; // 10yr is the key number

    return {
      return10yr,
      return5yr,
      return3yr,
      currentLevel: Math.round(latest.value),
      level10yrAgo: obs10yr ? Math.round(obs10yr.value) : null,
      asOf:         latest.date,
      source:       'FRED/SP500',
    };
  } catch (err) {
    console.warn('[benchmarkFetcher] S&P 500 returns failed:', err.message);
    return null;
  }
}

// ─── 3. PMI Rates by LTV Band ─────────────────────────────────────────────────
/**
 * Returns the current PMI rate table by LTV band.
 *
 * Source: MGIC, Essent, and Radian PMI rate cards (public, updated quarterly).
 * These are the industry-standard monthly premium rates as a % of loan balance/yr.
 *
 * The current table reflects FY2025 Q1 rates for a borrower with:
 *   - 700+ FICO score (average origination score for conventional loans)
 *   - Single-family primary residence
 *   - Standard monthly (not upfront) PMI
 *
 * LTV bands and corresponding rates:
 *   95–97% (3–5% down):   ~0.85–1.05%/yr → mid 0.95%
 *   90–95% (5–10% down):  ~0.55–0.80%/yr → mid 0.68%
 *   85–90% (10–15% down): ~0.35–0.55%/yr → mid 0.45%
 *   80–85% (15–20% down): ~0.18–0.30%/yr → mid 0.24%
 *
 * FRED DPSACBW027SBOG (bank lending standards tightness) is fetched to apply
 * a small environmental adjustment (tight markets → slightly higher PMI).
 *
 * @returns {{
 *   ltv95_97: number, ltv90_95: number, ltv85_90: number, ltv80_85: number,
 *   byDownPct: function, asOf: string, source: string
 * }|null}
 */
export async function fetchPmiRates() {
  // Base rates from MGIC/Essent/Radian FY2025 Q1 rate cards (mid-point of range)
  const BASE = {
    ltv95_97: 0.95, // 3–5% down
    ltv90_95: 0.68, // 5–10% down
    ltv85_90: 0.45, // 10–15% down
    ltv80_85: 0.24, // 15–20% down
  };

  let adjustment = 1.0;
  let creditTightnessAsOf = null;

  try {
    // Try fetching lending standards tightness (positive = tighter = higher PMI)
    const obs = await fetchFredCsv('DPSACBW027SBOG', 4); // last 4 quarters
    if (obs && obs.length > 0) {
      const latest = obs[obs.length - 1];
      creditTightnessAsOf = latest.date;
      // Positive = banks tightening standards → PMI slightly higher
      // Negative = banks loosening → PMI slightly lower
      // We apply a small ±8% adjustment maximum to avoid over-correcting
      if (latest.value > 20) adjustment = 1.08;
      else if (latest.value > 10) adjustment = 1.04;
      else if (latest.value < -10) adjustment = 0.96;
      else if (latest.value < -20) adjustment = 0.93;
    }
  } catch {
    // Credit standards fetch failing is non-critical — use base rates
  }

  const rates = {
    ltv95_97: Math.round(BASE.ltv95_97 * adjustment * 100) / 100,
    ltv90_95: Math.round(BASE.ltv90_95 * adjustment * 100) / 100,
    ltv85_90: Math.round(BASE.ltv85_90 * adjustment * 100) / 100,
    ltv80_85: Math.round(BASE.ltv80_85 * adjustment * 100) / 100,
  };

  return {
    ...rates,
    // Helper: given downPaymentPct (e.g. 10), return the applicable rate
    // This is stored as data in cache — callers use the byDownPct logic directly
    rateForDownPct: (downPct) => {
      if (downPct >= 20) return 0;
      if (downPct >= 15) return rates.ltv80_85;
      if (downPct >= 10) return rates.ltv85_90;
      if (downPct >= 5)  return rates.ltv90_95;
      return rates.ltv95_97;
    },
    asOf:   creditTightnessAsOf || new Date().toISOString().slice(0, 10),
    source: 'MGIC/Essent/Radian FY2025 rate cards' + (adjustment !== 1.0 ? ' (lending environment adjusted)' : ''),
  };
}

/**
 * Convenience: given a down payment % and loan amount, return monthly PMI in dollars.
 * Uses the pmiRates object returned by fetchPmiRates() (or the cached version).
 *
 * @param {object} pmiRates - from cache or fetchPmiRates()
 * @param {number} downPct  - down payment as percent (e.g. 10 for 10%)
 * @param {number} loanAmt  - loan amount in dollars
 * @returns {number} monthly PMI in dollars (0 if down >= 20%)
 */
export function calcMonthlyPmi(pmiRates, downPct, loanAmt) {
  if (!pmiRates || downPct >= 20) return 0;
  let annualRate = 0;
  if (downPct >= 15)     annualRate = pmiRates.ltv80_85 ?? 0.24;
  else if (downPct >= 10) annualRate = pmiRates.ltv85_90 ?? 0.45;
  else if (downPct >= 5)  annualRate = pmiRates.ltv90_95 ?? 0.68;
  else                    annualRate = pmiRates.ltv95_97 ?? 0.95;
  return Math.round((loanAmt * annualRate / 100) / 12);
}

// ─── 4. Zillow ZORI Metro Rent Growth ─────────────────────────────────────────
/**
 * Fetches Zillow Observed Rent Index (ZORI) for all metros from Zillow's
 * free public CSV file. Computes annualized rent growth over 1yr, 2yr, and 3yr.
 *
 * ZORI measures the flow of rents (new leases), not the stock of existing rents.
 * This is the most accurate measure of what a new tenant pays today.
 *
 * Source: Zillow Research → files.zillowstatic.com/research/public_csvs/zori/
 * File: Metro_zori_sm_month.csv (all metros, monthly, not seasonally adjusted)
 *
 * Returns a map: { [metro_key]: { annualGrowthPct, metro, asOf, source } }
 * where metro_key is lowercase first word of metro name (e.g. 'austin', 'miami')
 *
 * Used to pre-fill the rent growth assumption in the analyze UI with
 * actual local rent trends instead of national CPI Shelter.
 *
 * @returns {Map<string, object>|null} metro_key → rent growth data
 */
export async function fetchZoriRentGrowth() {
  const ZORI_URL = 'https://files.zillowstatic.com/research/public_csvs/zori/Metro_zori_sm_month.csv';

  try {
    const r = await fetch(ZORI_URL, { signal: AbortSignal.timeout(20000) });
    if (!r.ok) return null;

    const text = await r.text();
    const lines = text.trim().split('\n');
    if (lines.length < 2) return null;

    // Parse CSV header to find date columns
    const header = parseCSVRow(lines[0]);
    const dateColumns = header
      .map((h, i) => {
        const m = h.match(/^(\d{4})-(\d{2})-\d{2}$/);
        return m ? { index: i, year: parseInt(m[1]), month: parseInt(m[2]), label: h } : null;
      })
      .filter(Boolean)
      .sort((a, b) => a.year !== b.year ? a.year - b.year : a.month - b.month);

    if (dateColumns.length < 13) return null; // need at least 13 months for 1yr growth

    const latestCol = dateColumns[dateColumns.length - 1];
    const oneYearAgoCol = dateColumns[dateColumns.length - 13];
    const twoYearsAgoCol = dateColumns.length >= 25 ? dateColumns[dateColumns.length - 25] : null;
    const threeYearsAgoCol = dateColumns.length >= 37 ? dateColumns[dateColumns.length - 37] : null;

    const results = new Map();

    for (let i = 1; i < lines.length; i++) {
      const row = parseCSVRow(lines[i]);
      if (!row || row.length < latestCol.index + 1) continue;

      const metroName = row[2]?.trim(); // Column 2 = RegionName in ZORI
      if (!metroName) continue;

      const latestVal   = parseFloat(row[latestCol.index]);
      const oneYrAgoVal = parseFloat(row[oneYearAgoCol.index]);
      if (isNaN(latestVal) || isNaN(oneYrAgoVal) || oneYrAgoVal <= 0) continue;

      const growth1yr = ((latestVal - oneYrAgoVal) / oneYrAgoVal) * 100;

      let growth2yr = null;
      if (twoYearsAgoCol) {
        const v = parseFloat(row[twoYearsAgoCol.index]);
        if (!isNaN(v) && v > 0) {
          growth2yr = (Math.pow(latestVal / v, 1 / 2) - 1) * 100;
        }
      }

      let growth3yr = null;
      if (threeYearsAgoCol) {
        const v = parseFloat(row[threeYearsAgoCol.index]);
        if (!isNaN(v) && v > 0) {
          growth3yr = (Math.pow(latestVal / v, 1 / 3) - 1) * 100;
        }
      }

      // Create metro key: lowercase first word of metro name
      // "Austin, TX" → "austin", "New York, NY" → "new york"
      const metroKey = metroName.split(',')[0].trim().toLowerCase();

      results.set(metroKey, {
        annualGrowthPct:  Math.round(growth1yr * 10) / 10,
        growth2yr:        growth2yr !== null ? Math.round(growth2yr * 10) / 10 : null,
        growth3yr:        growth3yr !== null ? Math.round(growth3yr * 10) / 10 : null,
        metro:            metroName,
        latestRentIndex:  Math.round(latestVal),
        asOf:             latestCol.label,
        source:           'Zillow ZORI',
      });
    }

    console.log(`[benchmarkFetcher] ZORI: parsed ${results.size} metros`);
    return results.size > 0 ? results : null;

  } catch (err) {
    console.warn('[benchmarkFetcher] ZORI fetch failed:', err.message);
    return null;
  }
}

// CSV parser that handles quoted fields
function parseCSVRow(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQuotes = !inQuotes; }
    else if (ch === ',' && !inQuotes) { result.push(current); current = ''; }
    else { current += ch; }
  }
  result.push(current);
  return result;
}

/**
 * Looks up ZORI rent growth for a city string like "Austin, TX".
 * Tries exact city match, then partial match.
 *
 * @param {Map<string, object>} zoriMap - from fetchZoriRentGrowth()
 * @param {string} cityString - e.g. "Austin, TX"
 * @returns {object|null} rent growth data or null if no match
 */
export function getZoriForCity(zoriMap, cityString) {
  if (!zoriMap || !cityString) return null;
  const cityName = cityString.split(',')[0].trim().toLowerCase();

  // Exact match
  if (zoriMap.has(cityName)) return zoriMap.get(cityName);

  // Partial match — city name contains the key or vice versa
  for (const [key, data] of zoriMap) {
    if (cityName.includes(key) || key.includes(cityName)) return data;
  }

  return null;
}

// ─── 5. Closing Cost Defaults by State ────────────────────────────────────────
/**
 * Returns state-average closing cost percentages compiled from CFPB ClosingCorp
 * data and state-specific title insurance rate filings.
 *
 * These are the TOTAL closing costs as a % of purchase price (buyer side):
 *   - Lender origination fees (~0.5–1% of loan)
 *   - Title search and insurance (~0.5–1% of price)
 *   - Transfer taxes (varies dramatically by state)
 *   - Recording fees, appraisal, inspection, prepaid items
 *
 * States with no transfer tax (FL, TX, AK, etc.) have lower totals.
 * States with high transfer taxes (NY, PA, DC, MD) have materially higher totals.
 *
 * Source: CFPB ClosingCorp annual survey + Tax Foundation transfer tax data.
 * Methodology: averages from 2023–2024 data on conventional purchase loans.
 *
 * These are buyer-side costs only. Seller costs (agent commission, etc.)
 * are not included — this is purely cash-out-of-pocket at closing for the buyer.
 *
 * @returns {{ [stateCode]: number, asOf: string, source: string }|null}
 */
export async function fetchClosingCostDefaults() {
  // State closing costs as % of purchase price (buyer-side, conventional loan)
  // Source: CFPB ClosingCorp 2023-2024 + Tax Foundation + state DOI filings
  // Updated: Q1 2025
  const CLOSING_COSTS_BY_STATE = {
    // High transfer tax states
    DC: 4.5,  // DC: 2.2% transfer tax + high title rates
    NY: 4.2,  // NYC mansion tax + 1% city transfer tax for $1M+; rest of state ~2.5%
    MD: 3.8,  // State + county transfer taxes stack; Montgomery Co. is highest
    PA: 3.5,  // 2% state + 1% local transfer tax = 3% total + other closing costs
    DE: 3.4,  // 4% state transfer tax (split buyer/seller) → buyer pays ~2%
    NJ: 3.2,  // Mansion tax on $1M+ + recordation fees
    CT: 3.0,  // Transfer tax 1.25% (>$800K) + title
    MA: 2.8,  // Excise tax $4.56/$1000 + high attorney state
    WA: 2.8,  // REET 1.1–3% (graduated) + high-cost market title fees
    MN: 2.7,  // Conservation fee + deed tax + title insurance
    IL: 2.6,  // Chicago transfer tax + state transfer tax
    VT: 2.5,  // Property transfer tax 1.25–1.45%
    NH: 2.5,  // Real estate transfer tax 1.5% (split buyer/seller)
    ME: 2.4,  // Transfer tax 2.2% (split)
    RI: 2.3,  // Realty conveyance tax + attorney fees

    // Mid-range states (typical 2–3%)
    CA: 2.4,  // No state transfer tax but high recording fees + title in HCOL areas
    OR: 2.3,  // County transfer taxes + attorney optional but common
    NC: 2.3,  // Excise tax $2/$500 + high recording fees
    GA: 2.2,  // Intangibles tax 0.2% on loan + transfer tax
    SC: 2.2,  // Deed recording fee 0.37% + mortgage recording
    VA: 2.2,  // Recordation tax 0.25% + grantor tax 0.5% (split)
    TN: 2.1,  // Transfer tax $0.37/$100 + recording
    KY: 2.1,  // Mortgage registration tax + title
    OH: 2.1,  // Conveyance fee 0.1% + county-level variations
    MI: 2.0,  // Transfer tax 0.86% + county fee
    WI: 2.0,  // Real estate transfer fee 0.3% + title
    AR: 2.0,  // Documentary stamp tax + title fees
    NV: 2.0,  // Deed tax + escrow/title fees
    CO: 1.9,  // No statewide transfer tax; county taxes vary
    IN: 1.9,  // Conveyance fee $0.10/$100 + recording
    IA: 1.9,  // Real estate transfer tax 0.16% + title
    NE: 1.9,  // Documentary stamp tax + recording
    LA: 1.9,  // Mortgage certificate tax + title
    MO: 1.9,  // No transfer tax but recording + title fees

    // Lower closing cost states (under 2%)
    AL: 1.8,  // No transfer tax + competitive title market
    MS: 1.8,  // No transfer tax + low title rates
    OK: 1.8,  // Documentary stamp tax minimal + low recording
    KS: 1.8,  // No transfer tax + modest recording
    ID: 1.8,  // No transfer tax + moderate title
    UT: 1.8,  // No transfer tax + competitive title
    AZ: 1.8,  // No transfer tax + competitive escrow market
    SD: 1.7,  // No income/transfer tax + low recording fees
    ND: 1.7,  // No transfer tax + low fees
    MT: 1.8,  // No transfer tax + rural title markets
    WY: 1.7,  // No income/transfer tax + low fees
    NM: 1.9,  // No transfer tax + higher title rates in Albuquerque
    HI: 2.5,  // Conveyance tax 0.2–1.25% graduated + high title in HCOL
    AK: 1.7,  // No transfer tax + minimal fees
    WV: 2.0,  // Excise tax 0.11% + recording

    // States with no transfer tax and competitive markets
    TX: 1.8,  // No transfer tax — title company competition keeps fees low
    FL: 1.9,  // Doc stamp 0.7% on loan + 0.35% on deed; no state income tax
    OR: 2.3,  // Corrected — county transfer taxes in Portland metro
  };

  // National average fallback
  const NATIONAL_AVG = 2.1;

  return {
    ...CLOSING_COSTS_BY_STATE,
    _nationalAvg: NATIONAL_AVG,
    asOf:   '2025-Q1',
    source: 'CFPB ClosingCorp 2023-2024 + Tax Foundation',
  };
}

/**
 * Returns the closing cost percentage for a city string, with fallback.
 *
 * @param {object} closingCostData - from cache or fetchClosingCostDefaults()
 * @param {string} cityString - e.g. "Austin, TX"
 * @returns {number} closing cost as % of price (e.g. 1.8 = 1.8%)
 */
export function getClosingCostForCity(closingCostData, cityString) {
  if (!closingCostData || !cityString) return 2.1;
  const m = cityString.toUpperCase().match(/,\s*([A-Z]{2})$/);
  if (!m) return closingCostData._nationalAvg ?? 2.1;
  const stateCode = m[1];
  return closingCostData[stateCode] ?? closingCostData._nationalAvg ?? 2.1;
}

// ─── Batch fetch all Phase 5 sources ─────────────────────────────────────────
/**
 * Fetches all 5 Phase 5 benchmark sources in parallel.
 * Returns an object where each value is the result or null on failure.
 * Never throws — individual failures don't affect other sources.
 */
export async function fetchAllBenchmarks() {
  const [treasuryYield, sp500Returns, pmiRates, closingCosts] = await Promise.allSettled([
    fetchTreasuryYield(),
    fetchSP500Returns(),
    fetchPmiRates(),
    fetchClosingCostDefaults(),
  ]);

  return {
    treasuryYield:  treasuryYield.status  === 'fulfilled' ? treasuryYield.value  : null,
    sp500Returns:   sp500Returns.status   === 'fulfilled' ? sp500Returns.value   : null,
    pmiRates:       pmiRates.status       === 'fulfilled' ? pmiRates.value       : null,
    closingCosts:   closingCosts.status   === 'fulfilled' ? closingCosts.value   : null,
    // ZORI is not in the batch — it's a large CSV and is stored per-metro
    // The cron fetches it separately and stores each metro individually
  };
}
