/**
 * lib/marketData.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Single source of truth for all market data used in RentalIQ.
 *
 * Architecture:
 *   1. Read from Supabase market_data_cache (fast, fresh, auto-refreshed by cron)
 *   2. If cache miss or stale → return hardcoded baseline (never breaks the product)
 *   3. Cron job at /api/cron/refresh-market-data populates/updates the cache
 *
 * This replaces all static tables that previously lived duplicated inside
 * pages/analyze.js (client) and pages/api/analyze.js (server).
 *
 * Usage (server-side API routes only):
 *   import { getMarketData } from '../../lib/marketData.js';
 *   const md = await getMarketData();
 *   const taxRate = md.stateTaxRates['TX'];
 *   const rate30yr = md.mortgageRates.rate30yr;
 *   const rentGrowth = md.rentGrowthDefault; // CPI Shelter
 */

import { getSupabaseAdmin } from './supabase.js';
import { INS_RATE_BASELINE } from './insuranceRateFetcher.js';

// ─── Hardcoded baselines ──────────────────────────────────────────────────────
// These are the fallback values used when Supabase is unavailable or the cache
// is cold. They mirror the previous static tables exactly.
// The cron job will overwrite them with live values within 24hrs of first deploy.

const BASELINE = {
  fetchedAt: null,
  source: 'baseline',

  mortgageRates: {
    rate30yr:   6.87,
    rate15yr:   6.14,
    rate5arm:   6.25,
    asOf:       '2026-02-20',
    source:     'baseline',
  },

  // BLS CPI Shelter rate — used as default rent growth assumption
  // Series CUSR0000SAH1, 12-month % change
  rentGrowthDefault: 3.2,
  rentGrowthAsOf:    '2026-01',

  // State effective property tax rates (Tax Foundation 2024 + Lincoln Institute 50-State Report)
  // Kept in sync with STATE_TAX_DATA in lib/taxTrendFetcher.js — same source, same values.
  // The cron overwrites these with live data; this is the cold-start fallback only.
  stateTaxRates: {
    AL:0.41,AK:1.04,AZ:0.63,AR:0.64,CA:0.75,CO:0.51,CT:1.79,DE:0.57,FL:0.91,GA:0.91,
    HI:0.30,ID:0.47,IL:2.08,IN:0.85,IA:1.57,KS:1.41,KY:0.86,LA:0.56,ME:1.09,MD:1.09,
    MA:1.17,MI:1.32,MN:1.12,MS:0.78,MO:1.01,MT:0.74,NE:1.73,NV:0.55,NH:1.89,NJ:2.23,
    NM:0.80,NY:1.73,NC:0.82,ND:0.98,OH:1.56,OK:0.90,OR:0.97,PA:1.49,RI:1.53,SC:0.57,
    SD:1.14,TN:0.67,TX:1.63,UT:0.58,VT:1.83,VA:0.82,WA:0.98,WV:0.59,WI:1.61,WY:0.61,DC:0.55,
  },

  // State homeowner insurance rates — authoritative calibrated table from insuranceRateFetcher.js
  // (NAIC 2022 + state DOI rate actions through 2025). This is the single source of truth for
  // cold-start fallback. The cron overwrites it with live III data within 24hrs of first deploy.
  // High-risk states (FL:3.50, LA:3.20, TX:2.20) reflect post-2022 climate pricing.
  stateInsRates: INS_RATE_BASELINE,

  // State appreciation — 5yr blended forward estimate, post-correction (updated 2025)
  stateAppreciation: {
    FL:4.5,TX:4.2,CA:3.8,AZ:3.8,CO:3.5,WA:4.5,OR:3.2,ID:3.2,NV:4.0,
    NC:4.5,GA:4.5,TN:4.0,SC:4.2,VA:3.8,MD:3.8,MA:4.5,NY:3.5,NJ:3.8,
    IL:2.5,OH:3.2,MI:3.5,PA:3.0,IN:3.2,MO:3.0,WI:3.5,MN:3.8,IA:2.8,
    KS:2.5,NE:3.0,SD:3.2,ND:2.8,MT:3.8,WY:3.0,UT:3.8,NM:3.5,AK:2.0,
    HI:4.2,KY:2.8,WV:2.0,AR:3.0,AL:3.0,MS:2.5,LA:2.2,OK:2.8,
  },

  // CapEx PPI multiplier — BLS residential construction cost index vs 2019 baseline
  // Updated monthly by cron. 1.38 = 38% more expensive to repair/replace than 2019.
  capexPpiMultiplier: 1.38,
  capexPpiAsOf: '2026-01',

  // ── Phase 5: Financial Benchmark Intelligence ───────────────────────────
  // 10-Year Treasury yield — risk-free rate baseline for IRR comparison.
  treasuryYield: { rate: 4.62, asOf: '2026-02-20', source: 'baseline' },

  // S&P 500 trailing returns — index-fund alternative to every deal's IRR.
  sp500Returns: { return10yr: 12.4, return5yr: 13.8, return3yr: 8.7, currentLevel: 5870, asOf: '2026-02-20', source: 'baseline' },

  // PMI rates by LTV band — replaces hardcoded 0.75%/yr assumption.
  pmiRates: {
    ltv95_97: 0.95,  // 3–5% down
    ltv90_95: 0.68,  // 5–10% down
    ltv85_90: 0.45,  // 10–15% down
    ltv80_85: 0.24,  // 15–20% down
    asOf: '2025-Q1', source: 'baseline',
  },

  // State closing cost defaults — pre-fills the closing cost field.
  // Values are buyer-side % of purchase price.
  stateClosingCosts: {
    DC:4.5, NY:4.2, MD:3.8, PA:3.5, DE:3.4, NJ:3.2, CT:3.0, MA:2.8, WA:2.8, MN:2.7,
    IL:2.6, VT:2.5, NH:2.5, ME:2.4, RI:2.3, CA:2.4, NC:2.3, GA:2.2, SC:2.2, VA:2.2,
    TN:2.1, KY:2.1, OH:2.1, MI:2.0, WI:2.0, AR:2.0, NV:2.0, CO:1.9, IN:1.9, IA:1.9,
    NE:1.9, LA:1.9, MO:1.9, AL:1.8, MS:1.8, OK:1.8, KS:1.8, ID:1.8, UT:1.8, AZ:1.8,
    SD:1.7, ND:1.7, MT:1.8, WY:1.7, NM:1.9, HI:2.5, AK:1.7, WV:2.0, TX:1.8, FL:1.9,
    OR:2.3, _nationalAvg: 2.1, asOf: '2025-Q1', source: 'baseline',
  },

  // Case-Shiller national composite baseline (used when FRED is unavailable)
  // Shape mirrors the fetchCaseShillerMetro return value
  caseShillerNational: null,  // populated by cron — no sensible static baseline for trend data

  // Employment data baselines — keyed by city name (lowercase)
  // null = not fetched yet; cron populates per-city keys in cache
  // No static baseline here — missing = omit from prompt, AI uses its training knowledge
  employmentData: null,

  // City appreciation overrides — post-correction 2025 estimates
  cityAppreciation: {
    'san francisco':4.2,'san jose':4.5,'oakland':3.8,'los angeles':4.5,'san diego':4.8,
    'sacramento':3.5,'fresno':3.2,'bakersfield':3.0,
    'austin':3.2,'dallas':4.5,'houston':4.0,'san antonio':4.0,'fort worth':4.5,'el paso':3.5,
    'miami':5.0,'tampa':3.5,'orlando':4.0,'jacksonville':4.2,'fort lauderdale':5.0,
    'seattle':4.8,'bellevue':5.0,'portland':3.2,'spokane':3.5,
    'denver':3.5,'colorado springs':3.8,'boise':3.2,'salt lake city':3.8,'provo':3.5,
    'new york':4.0,'brooklyn':4.5,'manhattan':3.5,'boston':4.8,'providence':4.2,
    'philadelphia':3.5,'pittsburgh':2.8,'newark':3.8,
    'chicago':2.8,'minneapolis':3.8,'kansas city':3.2,'columbus':3.8,'indianapolis':3.0,
    'cincinnati':2.8,'cleveland':2.2,'detroit':2.5,'milwaukee':3.0,'st. louis':2.5,
    'memphis':2.2,'louisville':2.8,
    'atlanta':4.5,'charlotte':4.5,'nashville':4.0,'raleigh':4.5,'durham':4.2,
    'birmingham':2.8,'new orleans':2.5,
    'phoenix':4.0,'tucson':3.8,'las vegas':4.0,'albuquerque':3.5,'henderson':4.0,
    'washington':4.0,'baltimore':3.5,'richmond':3.8,'virginia beach':3.5,
  },
};

// ─── Cache layer ──────────────────────────────────────────────────────────────
// In-memory cache to avoid hitting Supabase on every request within the same
// serverless function instance. TTL: 10 minutes (Vercel functions can be warm
// for hours — this prevents serving data that's hours stale in memory).

let _memCache = null;
let _memCacheAt = 0;
const MEM_TTL = 10 * 60 * 1000; // 10 minutes

/**
 * Returns a fully assembled market data object.
 * Server-side only (reads from Supabase).
 *
 * All values fall back to BASELINE if the cache is unavailable.
 * Callers never need to handle null — this always returns a complete object.
 */
export async function getMarketData() {
  // 1. Serve from in-memory cache if fresh
  if (_memCache && Date.now() - _memCacheAt < MEM_TTL) {
    return _memCache;
  }

  // 2. Try Supabase cache
  try {
    const db = getSupabaseAdmin();
    const { data: rows, error } = await db
      .from('market_data_cache')
      .select('key, value, fetched_at, valid_until')
      .in('key', [
        'mortgage_rates',
        'rent_growth_default',
        'state_tax_rates',
        'state_ins_rates',
        'state_appreciation',
        'city_appreciation',
        'capex_ppi_multiplier',
        // Phase 5
        'treasury_yield',
        'sp500_returns',
        'pmi_rates',
        'state_closing_costs',
      ]);

    if (!error && rows?.length) {
      const byKey = Object.fromEntries(rows.map(r => [r.key, r]));

      const assembled = {
        fetchedAt: new Date().toISOString(),
        source: 'supabase_cache',

        mortgageRates: byKey.mortgage_rates?.value ?? BASELINE.mortgageRates,
        rentGrowthDefault: byKey.rent_growth_default?.value?.rate ?? BASELINE.rentGrowthDefault,
        rentGrowthAsOf:    byKey.rent_growth_default?.value?.asOf ?? BASELINE.rentGrowthAsOf,
        stateTaxRates:     byKey.state_tax_rates?.value   ?? BASELINE.stateTaxRates,
        stateInsRates:     byKey.state_ins_rates?.value   ?? BASELINE.stateInsRates,
        stateAppreciation: byKey.state_appreciation?.value ?? BASELINE.stateAppreciation,
        cityAppreciation:  byKey.city_appreciation?.value  ?? BASELINE.cityAppreciation,

        // CapEx PPI multiplier (BLS construction cost index vs 2019)
        capexPpiMultiplier: byKey.capex_ppi_multiplier?.value?.multiplier ?? BASELINE.capexPpiMultiplier,
        capexPpiAsOf:       byKey.capex_ppi_multiplier?.value?.asOf       ?? BASELINE.capexPpiAsOf,

        // Phase 5: Financial Benchmark Intelligence
        treasuryYield:    byKey.treasury_yield?.value    ?? BASELINE.treasuryYield,
        sp500Returns:     byKey.sp500_returns?.value     ?? BASELINE.sp500Returns,
        pmiRates:         byKey.pmi_rates?.value         ?? BASELINE.pmiRates,
        stateClosingCosts: byKey.state_closing_costs?.value ?? BASELINE.stateClosingCosts,

        // Per-key freshness for the data freshness indicator in the UI
        freshness: {
          mortgageRates:     byKey.mortgage_rates?.fetched_at ?? null,
          rentGrowth:        byKey.rent_growth_default?.fetched_at ?? null,
          taxRates:          byKey.state_tax_rates?.fetched_at ?? null,
          insRates:          byKey.state_ins_rates?.fetched_at ?? null,
          appreciation:      byKey.state_appreciation?.fetched_at ?? null,
          capexPpi:          byKey.capex_ppi_multiplier?.fetched_at ?? null,
          // Phase 5
          treasuryYield:     byKey.treasury_yield?.fetched_at ?? null,
          sp500Returns:      byKey.sp500_returns?.fetched_at ?? null,
          pmiRates:          byKey.pmi_rates?.fetched_at ?? null,
          closingCosts:      byKey.state_closing_costs?.fetched_at ?? null,
        },
      };

      _memCache = assembled;
      _memCacheAt = Date.now();
      return assembled;
    }
  } catch (err) {
    console.warn('[marketData] Supabase unavailable, using baseline:', err.message);
  }

  // 3. Fall back to baseline — product never breaks
  return { ...BASELINE, fetchedAt: null, source: 'baseline' };
}

// ─── Lookup helpers (same API as the old static table functions) ──────────────

/**
 * Returns state tax rate for a city string like "Austin, TX"
 */
export function stateTaxRate(md, city) {
  if (!city) return 1.10;
  const m = city.toUpperCase().match(/,\s*([A-Z]{2})$/);
  if (m && md.stateTaxRates[m[1]]) return md.stateTaxRates[m[1]];
  return 1.10;
}

/**
 * Returns state insurance rate for a city string
 */
export function stateInsRate(md, city) {
  if (!city) return 0.80;
  const m = city.toUpperCase().match(/,\s*([A-Z]{2})$/);
  if (m && md.stateInsRates[m[1]]) return md.stateInsRates[m[1]];
  return 0.80;
}

/**
 * Returns appreciation rate for a city string — city override first, state fallback
 */
export function cityAppreciation(md, city) {
  if (!city) return 3.5;
  const cityName = city.split(',')[0].trim().toLowerCase();
  if (md.cityAppreciation[cityName] !== undefined) return md.cityAppreciation[cityName];
  const m = city.toUpperCase().match(/,\s*([A-Z]{2})$/);
  if (m && md.stateAppreciation[m[1]]) return md.stateAppreciation[m[1]];
  return 3.5;
}

/**
 * Returns the live 30yr mortgage rate, with fallback
 */
export function rate30yr(md) {
  return md.mortgageRates?.rate30yr ?? 6.87;
}

/**
 * Returns the live 15yr mortgage rate, with fallback
 */
export function rate15yr(md) {
  return md.mortgageRates?.rate15yr ?? 6.14;
}

/**
 * Returns the live 5/1 ARM rate, with fallback
 */
export function rate5arm(md) {
  return md.mortgageRates?.rate5arm ?? 6.25;
}

/**
 * Returns the rent growth default (CPI Shelter), with fallback
 */
export function rentGrowthDefault(md) {
  return md.rentGrowthDefault ?? 2.5;
}

// ─── Phase 3 per-city/metro lookups ──────────────────────────────────────────
// These bypass the global md object and go directly to Supabase because the
// data is keyed per city (e.g. employment:austin) rather than globally.
// They are only called server-side in analyze.js when enriching an analysis.

/**
 * Fetches employment data for a city from the market_data_cache.
 * Key pattern: `employment:{cityKey}` where cityKey is lowercase city name.
 *
 * @param {import('./supabase.js').SupabaseClient} db - Supabase admin client
 * @param {string} cityString - e.g. "Austin, TX"
 * @returns {Promise<Object|null>}
 */
export async function getEmploymentData(db, cityString) {
  if (!db || !cityString) return null;
  const cityKey = cityString.split(',')[0].trim().toLowerCase();
  try {
    const { data, error } = await db
      .from('market_data_cache')
      .select('value, fetched_at, valid_until')
      .eq('key', `employment:${cityKey}`)
      .single();
    if (error || !data) return null;
    // Return null if stale (past valid_until) — cron may not have run yet for this city
    if (new Date(data.valid_until) < new Date()) return null;
    return data.value;
  } catch {
    return null;
  }
}

/**
 * Fetches Case-Shiller trend data for a metro from the market_data_cache.
 * Key pattern: `case_shiller:{metroKey}`.
 *
 * @param {import('./supabase.js').SupabaseClient} db
 * @param {string} metroKey - e.g. 'miami', 'national'
 * @returns {Promise<Object|null>}
 */
export async function getCaseShillerData(db, metroKey) {
  if (!db || !metroKey) return null;
  try {
    const { data, error } = await db
      .from('market_data_cache')
      .select('value, fetched_at, valid_until')
      .eq('key', `case_shiller:${metroKey}`)
      .single();
    if (error || !data) return null;
    if (new Date(data.valid_until) < new Date()) return null;
    return data.value;
  } catch {
    return null;
  }
}

/**
 * Fetches Redfin market pulse data for a ZIP from the market_data_cache.
 * Key pattern: `redfin:{zip}`.
 *
 * @param {import('./supabase.js').SupabaseClient} db
 * @param {string} zip - 5-digit ZIP code
 * @returns {Promise<Object|null>}
 */
export async function getRedfinData(db, zip) {
  if (!db || !zip) return null;
  if (!/^\d{5}$/.test(zip)) return null;
  try {
    const { data, error } = await db
      .from('market_data_cache')
      .select('value, fetched_at, valid_until')
      .eq('key', `redfin:${zip}`)
      .single();
    if (error || !data) return null;
    if (new Date(data.valid_until) < new Date()) return null;
    return data.value;
  } catch {
    return null;
  }
}

// ─── Phase 5 lookup helpers ───────────────────────────────────────────────────

/**
 * Returns the live 10-yr Treasury yield (%), with fallback.
 */
export function getTreasuryYield(md) {
  return md.treasuryYield?.rate ?? 4.62;
}

/**
 * Returns S&P 500 trailing return for N years. N must be 3, 5, or 10.
 */
export function getSP500Return(md, years = 10) {
  const r = md.sp500Returns;
  if (!r) return years === 10 ? 12.4 : years === 5 ? 13.8 : 8.7;
  if (years === 10) return r.return10yr ?? 12.4;
  if (years === 5)  return r.return5yr  ?? 13.8;
  return r.return3yr ?? 8.7;
}

/**
 * Returns the accurate monthly PMI in dollars for a given LTV.
 * @param {object} md - market data from getMarketData()
 * @param {number} downPct - down payment % (e.g. 10 for 10%)
 * @param {number} loanAmt - loan amount in dollars
 */
export function getMonthlyPmi(md, downPct, loanAmt) {
  if (downPct >= 20 || !loanAmt) return 0;
  const rates = md.pmiRates ?? BASELINE.pmiRates;
  let annualRate = 0;
  if (downPct >= 15)      annualRate = rates.ltv80_85 ?? 0.24;
  else if (downPct >= 10) annualRate = rates.ltv85_90 ?? 0.45;
  else if (downPct >= 5)  annualRate = rates.ltv90_95 ?? 0.68;
  else                    annualRate = rates.ltv95_97 ?? 0.95;
  return Math.round((loanAmt * annualRate / 100) / 12);
}

/**
 * Returns the PMI annual rate % for a given down payment %.
 * Used in the AI prompt so it can compute PMI in its math.
 */
export function getPmiRate(md, downPct) {
  if (downPct >= 20) return 0;
  const rates = md.pmiRates ?? BASELINE.pmiRates;
  if (downPct >= 15)      return rates.ltv80_85 ?? 0.24;
  if (downPct >= 10)      return rates.ltv85_90 ?? 0.45;
  if (downPct >= 5)       return rates.ltv90_95 ?? 0.68;
  return rates.ltv95_97 ?? 0.95;
}

/**
 * Returns the closing cost % for a given city string like "Austin, TX".
 * @param {object} md - market data from getMarketData()
 * @param {string} city - e.g. "Austin, TX"
 */
export function getClosingCostPct(md, city) {
  const costs = md.stateClosingCosts ?? BASELINE.stateClosingCosts;
  if (!city) return costs._nationalAvg ?? 2.1;
  const m = city.toUpperCase().match(/,\s*([A-Z]{2})$/);
  if (!m) return costs._nationalAvg ?? 2.1;
  return costs[m[1]] ?? costs._nationalAvg ?? 2.1;
}

/**
 * Fetches ZORI metro rent growth from Supabase cache for a given city string.
 * Key pattern: zori_rent_growth:{metro_key}
 * @param {import('./supabase.js').SupabaseClient} db
 * @param {string} cityString - e.g. "Austin, TX"
 * @returns {Promise<object|null>}
 */
export async function getZoriForCity(db, cityString) {
  if (!db || !cityString) return null;
  const cityName = cityString.split(',')[0].trim().toLowerCase();
  // Try exact city key first, then a few common variations
  const keysToTry = [cityName, cityName.replace(/\s+/g, '-')];
  for (const key of keysToTry) {
    try {
      const { data, error } = await db
        .from('market_data_cache')
        .select('value, fetched_at, valid_until')
        .eq('key', `zori_rent_growth:${key}`)
        .single();
      if (!error && data) {
        if (new Date(data.valid_until) > new Date()) return data.value;
      }
    } catch { /* try next key */ }
  }
  return null;
}

// ── Phase 6: Property & Address Intelligence helpers ─────────────────────────

/**
 * Fetches pre-cached building permits data for a CBSA code.
 * Returns null if not in cache (on-demand fetch will fire from the UI).
 * @param {import('./supabase.js').SupabaseClient} db
 * @param {string} cbsaCode
 */
export async function getBuildingPermits(db, cbsaCode) {
  if (!db || !cbsaCode) return null;
  try {
    const { data, error } = await db
      .from('market_data_cache')
      .select('value, valid_until')
      .eq('key', `building_permits:${cbsaCode}`)
      .single();
    if (error || !data) return null;
    if (new Date(data.valid_until) < new Date()) return null;
    return typeof data.value === 'string' ? JSON.parse(data.value) : data.value;
  } catch { return null; }
}

/**
 * Fetches pre-cached metro growth data for a CBSA code.
 * @param {import('./supabase.js').SupabaseClient} db
 * @param {string} cbsaCode
 */
export async function getMetroGrowth(db, cbsaCode) {
  if (!db || !cbsaCode) return null;
  try {
    const { data, error } = await db
      .from('market_data_cache')
      .select('value, valid_until')
      .eq('key', `metro_growth:${cbsaCode}`)
      .single();
    if (error || !data) return null;
    if (new Date(data.valid_until) < new Date()) return null;
    return typeof data.value === 'string' ? JSON.parse(data.value) : data.value;
  } catch { return null; }
}

// ── Phase 7: Market Context & Benchmarking helpers ───────────────────────────

/**
 * Fetches pre-cached HVS vacancy data from Supabase.
 * Key: hvs_vacancy (single global record refreshed quarterly)
 * @param {import('./supabase.js').SupabaseClient} db
 */
export async function getHvsVacancy(db) {
  if (!db) return null;
  try {
    const { data, error } = await db
      .from('market_data_cache')
      .select('value, valid_until')
      .eq('key', 'hvs_vacancy')
      .single();
    if (error || !data) return null;
    if (new Date(data.valid_until) < new Date()) return null;
    return typeof data.value === 'string' ? JSON.parse(data.value) : data.value;
  } catch { return null; }
}

// ── Phase 9: Auto-Heal Cache Readers ─────────────────────────────────────────
// These read the live-refreshed data from market_data_cache.
// Falls back to the static module exports when cache is cold or unavailable.

import { LANDLORD_LAWS }       from './landlordLaws.js';
import { CITY_RENT_CONTROL }   from './cityRentControlDb.js';
import { STR_REGULATIONS }     from './strDataFetcher.js';
import { TAX_RATE_BASELINE }   from './taxRateFetcher.js';

/**
 * Returns landlord law data for a state, preferring the live-cached version.
 * Falls back to the static LANDLORD_LAWS table.
 * @param {import('./supabase.js').SupabaseClient} db
 * @param {string} stateCode - 2-letter state code
 */
export async function getLandlordLawLive(db, stateCode) {
  if (!stateCode) return LANDLORD_LAWS[stateCode] || null;
  try {
    const { data, error } = await db
      .from('market_data_cache')
      .select('value, valid_until')
      .eq('key', 'landlord_laws')
      .single();
    if (!error && data && new Date(data.valid_until) > new Date()) {
      const laws = typeof data.value === 'string' ? JSON.parse(data.value) : data.value;
      if (laws[stateCode]) return laws[stateCode];
    }
  } catch {}
  return LANDLORD_LAWS[stateCode] || null;
}

/**
 * Returns rent control data for a city, preferring the live-cached version.
 * Falls back to the static CITY_RENT_CONTROL table.
 * @param {import('./supabase.js').SupabaseClient} db
 * @param {string} citySlug - e.g. 'san_francisco_ca'
 */
export async function getCityRentControlLive(db, citySlug) {
  if (!citySlug) return null;
  try {
    const { data, error } = await db
      .from('market_data_cache')
      .select('value, valid_until')
      .eq('key', 'rent_control_db')
      .single();
    if (!error && data && new Date(data.valid_until) > new Date()) {
      const rcDb = typeof data.value === 'string' ? JSON.parse(data.value) : data.value;
      if (rcDb[citySlug]) return rcDb[citySlug];
    }
  } catch {}
  return CITY_RENT_CONTROL[citySlug] || null;
}

/**
 * Returns STR regulation data for a city, preferring the live-cached version.
 * Falls back to the static STR_REGULATIONS table.
 * @param {import('./supabase.js').SupabaseClient} db
 * @param {string} citySlug - e.g. 'new_york_ny'
 */
export async function getStrRegulationLive(db, citySlug) {
  if (!citySlug) return null;
  try {
    const { data, error } = await db
      .from('market_data_cache')
      .select('value, valid_until')
      .eq('key', 'str_regulations')
      .single();
    if (!error && data && new Date(data.valid_until) > new Date()) {
      const strDb = typeof data.value === 'string' ? JSON.parse(data.value) : data.value;
      if (strDb[citySlug]) return strDb[citySlug];
    }
  } catch {}
  return STR_REGULATIONS[citySlug] || null;
}

/**
 * Returns live state property tax rates, preferring Census ACS data.
 * Falls back to the static Tax Foundation 2024 baseline.
 * @param {import('./supabase.js').SupabaseClient} db
 * @param {string} stateCode
 */
export async function getStateTaxRateLive(db, stateCode) {
  if (!stateCode) return null;
  try {
    const { data, error } = await db
      .from('market_data_cache')
      .select('value, valid_until')
      .eq('key', 'state_tax_rates')
      .single();
    if (!error && data && new Date(data.valid_until) > new Date()) {
      const rates = typeof data.value === 'string' ? JSON.parse(data.value) : data.value;
      if (rates[stateCode]) return rates[stateCode];
    }
  } catch {}
  return TAX_RATE_BASELINE[stateCode] || null;
}
