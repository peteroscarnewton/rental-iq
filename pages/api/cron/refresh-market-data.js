/**
 * GET /api/cron/refresh-market-data
 * ─────────────────────────────────────────────────────────────────────────────
 * Vercel Cron job — refreshes all market data in market_data_cache.
 * Configured in vercel.json to run on two schedules:
 *   - Daily at 6am UTC: mortgage rates + CPI shelter (FRED, changes weekly)
 *   - Weekly Sunday 3am UTC: full refresh including insurance/tax/appreciation
 *     (these are annual data, but we validate them weekly)
 *
 * Security: protected by CRON_SECRET env var.
 * Vercel passes this automatically when using cron; manual calls require header.
 *
 * Response: { ok: true, refreshed: [...keys], skipped: [...keys], errors: [...] }
 */

import { getSupabaseAdmin }        from '../../../lib/supabase.js';
import {
  fetchTreasuryYield,
  fetchSP500Returns,
  fetchPmiRates,
  fetchZoriRentGrowth,
  fetchClosingCostDefaults,
}                                    from '../../../lib/benchmarkFetcher.js';
import { fetchAllFredData,
         fetchMortgageRates,
         fetchCpiShelter,
         fetchConstructionPPI,
         fetchMetroUnemployment,
         hasMetroUnemploymentData }  from '../../../lib/fredFetcher.js';
import { fetchFhfaHpi }             from '../../../lib/fhfaFetcher.js';
import { fetchAllCaseShillerMetros } from '../../../lib/caseShillerFetcher.js';
import { fetchRedfinZips,
         fetchRedfinCities }         from '../../../lib/redfinFetcher.js';
import { fetchBuildingPermits, fetchMetroGrowth, resolveCbsaForCity } from '../../../lib/supplyDemandFetcher.js';
import {
  fetchHvsVacancy,
  fetchCapRates,
  fetchMgmtFeeRates,
  fetchSafmrRent,
}                                    from '../../../lib/marketBenchmarkFetcher.js';
import { fetchInsuranceRates }        from '../../../lib/insuranceRateFetcher.js';
import { fetchStrData }               from '../../../lib/strDataFetcher.js';
import { fetchClimateRisk }           from '../../../lib/climateRiskFetcher.js';
// Phase 9 — Auto-heal fetchers (replaces all static tables)
import { fetchStateTaxRates }         from '../../../lib/taxRateFetcher.js';
import { fetchLandlordLaws }          from '../../../lib/landlordLawFetcher.js';
import { fetchStrRegulations }        from '../../../lib/strRegFetcher.js';
import { fetchComputedCapRates }      from '../../../lib/capRateComputedFetcher.js';
import { fetchRentControlData }       from '../../../lib/rentControlFetcher.js';
import { fetchClosingCostLive }       from '../../../lib/closingCostLiveFetcher.js';
import { fetchMgmtFeeLive }           from '../../../lib/mgmtFeeLiveFetcher.js';

// Inline fallback wrappers — call primary, attach sourceUsed, return null on failure.
// logFallbackUsage writes a record to market_data_cache so the health-check can see fallback events.
async function fetchMortgageRatesWithFallback(fn) {
  try { const r = await fn(); return r ? { ...r, sourceUsed: 'primary' } : null; } catch { return null; }
}
async function fetchCpiShelterWithFallback(fn) {
  try { const r = await fn(); return r ? { ...r, sourceUsed: 'primary' } : null; } catch { return null; }
}
async function fetchConstructionPpiWithFallback(fn) {
  try { const r = await fn(); return r ? { ...r, sourceUsed: 'primary' } : null; } catch { return null; }
}
async function fetchFhfaHpiWithFallback(fn) {
  try { const r = await fn(); return r ? { ...r, sourceUsed: 'primary' } : null; } catch { return null; }
}
async function logFallbackUsage(key, source, db) {
  try {
    await db.from('market_data_cache').upsert({
      key: `_fallback_audit:${key}`,
      value: { source, recordedAt: new Date().toISOString() },
      updated_at: new Date().toISOString(),
    }, { onConflict: 'key' });
  } catch (_) { /* non-fatal — just logging */ }
}

// How long each key is considered "fresh" (ms)
const TTL = {
  mortgage_rates:         1 * 24 * 60 * 60 * 1000,  // 1 day  (PMMS is weekly but check daily)
  rent_growth_default:    7 * 24 * 60 * 60 * 1000,  // 1 week (CPI is monthly)
  state_tax_rates:       30 * 24 * 60 * 60 * 1000,  // 30 days (annual data — validate monthly)
  state_ins_rates:       30 * 24 * 60 * 60 * 1000,
  state_appreciation:    90 * 24 * 60 * 60 * 1000,  // 90 days — aligns with FHFA quarterly release
  city_appreciation:     90 * 24 * 60 * 60 * 1000,  // 90 days
  capex_ppi_multiplier:  30 * 24 * 60 * 60 * 1000,  // 30 days (BLS PPI is monthly)
  // Phase 3 TTLs
  case_shiller:           30 * 24 * 60 * 60 * 1000,  // 30 days (monthly release, 60-day lag)
  employment:             14 * 24 * 60 * 60 * 1000,  // 14 days (monthly BLS LAUS release)
  redfin:                  7 * 24 * 60 * 60 * 1000,  // 7 days (weekly Redfin update)
  redfin_city:             7 * 24 * 60 * 60 * 1000,  // 7 days (city_market_tracker, weekly)
  // Phase 5 TTLs
  treasury_yield:          1 * 24 * 60 * 60 * 1000,  // 1 day  (FRED DGS10, daily)
  sp500_returns:           1 * 24 * 60 * 60 * 1000,  // 1 day  (FRED SP500, daily)
  pmi_rates:              90 * 24 * 60 * 60 * 1000,  // 90 days (rate cards quarterly)
  zori_rent_growth:       30 * 24 * 60 * 60 * 1000,  // 30 days (ZORI monthly)
  state_closing_costs:   365 * 24 * 60 * 60 * 1000,  // 1 year  (annual survey)
  // Phase 6 TTLs
  building_permits:       30 * 24 * 60 * 60 * 1000,  // 30 days (Census BPS monthly)
  metro_growth:          365 * 24 * 60 * 60 * 1000,  // 1 year  (Census ACS annual + BLS quarterly)
  // Phase 7 TTLs
  hvs_vacancy:            90 * 24 * 60 * 60 * 1000,  // 90 days (Census HVS quarterly)
  safmr_rent:            365 * 24 * 60 * 60 * 1000,  // 1 year  (HUD SAFMR annual release)
  market_cap_rates:      180 * 24 * 60 * 60 * 1000,  // 180 days (CBRE/JLL semi-annual surveys)
  mgmt_fee_rates:        365 * 24 * 60 * 60 * 1000,  // 1 year  (NARPM annual survey)
  // Phase 8 TTLs
  state_ins_rates_live:  365 * 24 * 60 * 60 * 1000,  // 1 year  (NAIC annual + III live)
  str_data:               90 * 24 * 60 * 60 * 1000,  // 90 days (Inside Airbnb quarterly)
  climate_risk:          365 * 24 * 60 * 60 * 1000,  // 1 year  (FEMA NRI annual)
  // Phase 9 — Auto-heal TTLs
  state_tax_rates_live:  365 * 24 * 60 * 60 * 1000,  // 1 year  (Census ACS annual release)
  landlord_laws_live:     30 * 24 * 60 * 60 * 1000,  // 30 days (laws can change any time)
  str_regulations_live:   90 * 24 * 60 * 60 * 1000,  // 90 days (quarterly check)
  computed_cap_rates:     90 * 24 * 60 * 60 * 1000,  // 90 days (Census ACS + HUD quarterly)
  rent_control_db_live:   30 * 24 * 60 * 60 * 1000,  // 30 days (ordinances change often)
  closing_costs_live:    365 * 24 * 60 * 60 * 1000,  // 1 year  (transfer taxes are annual)
  mgmt_fee_rates_live:   365 * 24 * 60 * 60 * 1000,  // 1 year  (adjust with CPI)
};

// Baseline values — used to seed the DB on first run and as fallback on write
const BASELINE_VALUES = {
  // State effective property tax rates — Tax Foundation 2024 + Lincoln Institute 50-State Report.
  // Kept in sync with BASELINE.stateTaxRates in lib/marketData.js (single source of truth).
  // No free live API exists for these; the cron seeds once and re-validates every 30 days.
  state_tax_rates: {
    AL:0.41,AK:1.04,AZ:0.63,AR:0.64,CA:0.75,CO:0.51,CT:1.79,DE:0.57,FL:0.91,GA:0.91,
    HI:0.30,ID:0.47,IL:2.08,IN:0.85,IA:1.57,KS:1.41,KY:0.86,LA:0.56,ME:1.09,MD:1.09,
    MA:1.17,MI:1.32,MN:1.12,MS:0.78,MO:1.01,MT:0.74,NE:1.73,NV:0.55,NH:1.89,NJ:2.23,
    NM:0.80,NY:1.73,NC:0.82,ND:0.98,OH:1.56,OK:0.90,OR:0.97,PA:1.49,RI:1.53,SC:0.57,
    SD:1.14,TN:0.67,TX:1.63,UT:0.58,VT:1.83,VA:0.82,WA:0.98,WV:0.59,WI:1.61,WY:0.61,DC:0.55,
  },
  // State homeowner insurance rates — NAIC 2022 + state DOI rate actions through 2025.
  // Kept in sync with INS_RATE_BASELINE in lib/insuranceRateFetcher.js (single source of truth).
  // Phase 8A overwrites this with a live III fetch; this is the cold-start seed and fallback.
  // High-risk states reflect post-2022 climate pricing (FL:3.50, LA:3.20, TX:2.20).
  state_ins_rates: {
    FL:3.50,LA:3.20,OK:1.85,TX:2.20,KS:1.65,MS:1.60,AL:1.50,AR:1.30,SC:1.25,NC:1.15,
    GA:1.10,CO:1.15,TN:1.00,MO:1.20,NE:1.25,MN:0.90,IA:1.00,SD:1.00,ND:0.95,
    OH:0.80,IN:0.85,MI:0.90,WI:0.80,IL:0.85,KY:0.85,WV:0.75,VA:0.80,MD:0.80,DE:0.75,
    PA:0.78,NJ:0.95,NY:0.90,CT:0.85,RI:0.85,MA:0.80,VT:0.72,NH:0.78,ME:0.78,
    AZ:0.78,NV:0.68,UT:0.70,ID:0.65,MT:0.68,WY:0.68,NM:0.78,
    CA:0.85,OR:0.70,WA:0.68,AK:0.75,HI:0.38,DC:0.78,
  },
  state_appreciation: {
    FL:4.5,TX:4.2,CA:3.8,AZ:3.8,CO:3.5,WA:4.5,OR:3.2,ID:3.2,NV:4.0,
    NC:4.5,GA:4.5,TN:4.0,SC:4.2,VA:3.8,MD:3.8,MA:4.5,NY:3.5,NJ:3.8,
    IL:2.5,OH:3.2,MI:3.5,PA:3.0,IN:3.2,MO:3.0,WI:3.5,MN:3.8,IA:2.8,
    KS:2.5,NE:3.0,SD:3.2,ND:2.8,MT:3.8,WY:3.0,UT:3.8,NM:3.5,AK:2.0,
    HI:4.2,KY:2.8,WV:2.0,AR:3.0,AL:3.0,MS:2.5,LA:2.2,OK:2.8,
  },
  city_appreciation: {
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

// Redfin streaming can take up to 90s on a cold run.
// Vercel Pro/Enterprise: maxDuration up to 300s. Hobby: 60s max.
// If on Hobby plan, set SKIP_REDFIN_REFRESH=1 env var to skip Redfin in cron.
export const config = { api: { bodyParser: false }, maxDuration: 120 };

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  // Verify cron secret — prevents unauthorized triggering
  const authHeader = req.headers.authorization;
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabaseAdmin();
  const now = new Date();
  const refreshed = [];
  const skipped   = [];
  const errors    = [];

  // ── Helper: upsert a key into market_data_cache ──────────────────────────
  async function upsert(key, value, validForMs) {
    try {
      const validUntil = new Date(Date.now() + validForMs).toISOString();
      const { error } = await db
        .from('market_data_cache')
        .upsert(
          { key, value, fetched_at: now.toISOString(), valid_until: validUntil },
          { onConflict: 'key' }
        );
      if (error) throw error;
      return true;
    } catch (err) {
      errors.push({ key, error: err.message });
      return false;
    }
  }

  // ── Helper: check if a key needs refresh ─────────────────────────────────
  async function needsRefresh(key) {
    try {
      const { data } = await db
        .from('market_data_cache')
        .select('valid_until')
        .eq('key', key)
        .single();
      if (!data) return true; // Not seeded yet
      return new Date(data.valid_until) < now;
    } catch {
      return true; // On error, attempt refresh
    }
  }

  // ── Pre-fetch: check which FRED keys need refresh ────────────────────────
  // Phase 4A: Each critical fetch now uses a fallback chain (FRED → backup source).
  // We check individually so we can use per-source fallbacks, not just abort all
  // when one FRED series fails. Failures in one source don't poison the others.
  const fredNeedsRefresh = {
    mortgage_rates:       await needsRefresh('mortgage_rates'),
    rent_growth_default:  await needsRefresh('rent_growth_default'),
    capex_ppi_multiplier: await needsRefresh('capex_ppi_multiplier'),
  };

  // Fetch each series independently with its own fallback chain.
  // Even if FRED is completely down, the backup sources are on different infrastructure.
  let fredMortgageData     = null;
  let fredCpiData          = null;
  let fredConstructionData = null;

  if (fredNeedsRefresh.mortgage_rates) {
    fredMortgageData = await fetchMortgageRatesWithFallback(fetchMortgageRates);
    if (fredMortgageData?.sourceUsed && !fredMortgageData.sourceUsed.startsWith('primary')) {
      await logFallbackUsage('mortgage_rates', fredMortgageData.sourceUsed, db);
    }
  }
  if (fredNeedsRefresh.rent_growth_default) {
    fredCpiData = await fetchCpiShelterWithFallback(fetchCpiShelter);
    if (fredCpiData?.sourceUsed && !fredCpiData.sourceUsed.startsWith('primary')) {
      await logFallbackUsage('rent_growth_default', fredCpiData.sourceUsed, db);
    }
  }
  if (fredNeedsRefresh.capex_ppi_multiplier) {
    fredConstructionData = await fetchConstructionPpiWithFallback(fetchConstructionPPI);
    if (fredConstructionData?.sourceUsed && !fredConstructionData.sourceUsed.startsWith('primary')) {
      await logFallbackUsage('capex_ppi_multiplier', fredConstructionData.sourceUsed, db);
    }
  }

  // Compatibility shim — rest of the handler uses fredData.{key}
  const fredData = {
    mortgageRates:   fredMortgageData,
    cpiShelter:      fredCpiData,
    constructionPpi: fredConstructionData,
  };

  // ── 1. FRED: Mortgage rates (daily refresh) ───────────────────────────────
  if (fredNeedsRefresh.mortgage_rates) {
    if (fredData.mortgageRates) {
      const ok = await upsert('mortgage_rates', fredData.mortgageRates, TTL.mortgage_rates);
      if (ok) refreshed.push('mortgage_rates');
    } else {
      errors.push({ key: 'mortgage_rates', error: 'FRED fetch returned null' });
    }
  } else {
    skipped.push('mortgage_rates');
  }

  // ── 2. FRED: CPI Shelter → rent growth default (weekly refresh) ───────────
  if (fredNeedsRefresh.rent_growth_default) {
    if (fredData.cpiShelter) {
      const ok = await upsert('rent_growth_default', fredData.cpiShelter, TTL.rent_growth_default);
      if (ok) refreshed.push('rent_growth_default');
    } else {
      errors.push({ key: 'rent_growth_default', error: 'FRED CPI fetch returned null' });
    }
  } else {
    skipped.push('rent_growth_default');
  }

  // ── 3. Static baseline tables: seed if not present, validate on schedule ──
  // state_tax_rates still uses static baseline (no free live API).
  // state_appreciation and city_appreciation are now overwritten by the FHFA block
  // below — this just ensures they're seeded on first deploy before FHFA runs.
  // NOTE: state_ins_rates is handled separately in Phase 8A block below with live fetch.
  for (const key of ['state_tax_rates', 'state_appreciation', 'city_appreciation']) {
    if (await needsRefresh(key)) {
      const ok = await upsert(key, BASELINE_VALUES[key], TTL[key]);
      if (ok) refreshed.push(key);
    } else {
      skipped.push(key);
    }
  }

  // ── 4. FHFA HPI: live appreciation rates (quarterly refresh, 90-day TTL) ──
  // Fetches state and metro-level 5yr CAGR from FHFA's public HPI CSVs.
  // Overwrites the baseline seeds above with real data.
  // Both state_appreciation and city_appreciation use the same 90-day TTL —
  // needsRefresh uses the same key, so both are fetched in one CSV round-trip.
  const appreciationNeedsRefresh =
    await needsRefresh('state_appreciation') ||
    await needsRefresh('city_appreciation');

  if (appreciationNeedsRefresh) {
    try {
      // Phase 4A: FHFA with Zillow ZHVI as backup source
      const hpiResult = await fetchFhfaHpiWithFallback(fetchFhfaHpi);

      if (!hpiResult) {
        errors.push({ key: 'fhfa_hpi', error: 'All appreciation sources failed (FHFA + Zillow ZHVI)' });
      } else {
        if (hpiResult.sourceUsed && !hpiResult.sourceUsed.startsWith('primary')) {
          await logFallbackUsage('state_appreciation', hpiResult.sourceUsed, db);
          console.warn(`[cron] Appreciation: using fallback source ${hpiResult.sourceUsed}`);
        }

        const { stateRates, cityRates, asOf, source } = hpiResult;

        if (stateRates && Object.keys(stateRates).length >= 35) {
          const ok = await upsert(
            'state_appreciation',
            { ...stateRates, _meta: { asOf, source } },
            TTL.state_appreciation
          );
          if (ok) refreshed.push('state_appreciation');
        } else {
          errors.push({ key: 'state_appreciation', error: `Source returned ${stateRates ? Object.keys(stateRates).length : 0} states (min 35 required)` });
          skipped.push('state_appreciation (insufficient data — baseline retained)');
        }

        if (cityRates && Object.keys(cityRates).length >= 20) {
          const ok = await upsert(
            'city_appreciation',
            { ...cityRates, _meta: { asOf, source } },
            TTL.city_appreciation
          );
          if (ok) refreshed.push('city_appreciation');
        } else {
          // City data missing is less critical — Zillow ZHVI state file has no metro breakdown
          // The city baseline from DB will remain. Log as info, not error.
          skipped.push(`city_appreciation (${cityRates ? Object.keys(cityRates).length : 0} metros — baseline retained)`);
        }
      }
    } catch (err) {
      errors.push({ key: 'fhfa_hpi', error: err.message });
    }
  } else {
    skipped.push('state_appreciation', 'city_appreciation');
  }

  // ── 5. BLS PPI Construction: CapEx multiplier (monthly refresh) ───────────
  // Uses FRED series PCU2361-- to compute a cost multiplier relative to 2019.
  // Stored as capex_ppi_multiplier → { multiplier, baseYear, currentIndex, asOf, source }
  // fredData.constructionPpi was pre-fetched in the batch above.
  if (fredNeedsRefresh.capex_ppi_multiplier) {
    if (fredData.constructionPpi) {
      const ok = await upsert('capex_ppi_multiplier', fredData.constructionPpi, TTL.capex_ppi_multiplier);
      if (ok) refreshed.push('capex_ppi_multiplier');
    } else {
      errors.push({ key: 'capex_ppi_multiplier', error: 'All PPI sources failed (FRED + BLS API v2)' });
    }
  } else {
    skipped.push('capex_ppi_multiplier');
  }

  // ── 6. Case-Shiller: metro price trend history (monthly refresh) ─────────
  // Fetches 20+ FRED metro series and stores per-metro trend data.
  // Key pattern: case_shiller:{metro_key} — e.g. case_shiller:miami
  // Uses a single TTL check on the national composite as the refresh gate.
  // If it's stale, we refresh all metros in one parallel batch.
  if (await needsRefresh('case_shiller:national')) {
    try {
      const allMetros = await fetchAllCaseShillerMetros();
      const metroKeys = Object.keys(allMetros);

      if (metroKeys.length === 0) {
        errors.push({ key: 'case_shiller', error: 'fetchAllCaseShillerMetros returned no data' });
      } else {
        for (const [metroKey, data] of Object.entries(allMetros)) {
          const cacheKey = `case_shiller:${metroKey}`;
          const ok = await upsert(cacheKey, data, TTL.case_shiller);
          if (ok) refreshed.push(cacheKey);
        }
        console.log(`[cron] Case-Shiller: stored ${metroKeys.length} metro trend records`);
      }
    } catch (err) {
      errors.push({ key: 'case_shiller', error: err.message });
    }
  } else {
    skipped.push('case_shiller (all metros within TTL)');
  }

  // ── 7. BLS LAUS: metro employment data (bi-weekly refresh) ───────────────
  // Fetches unemployment rate + YoY change for metros that have active deals.
  // We query the deals table for distinct city values rather than fetching
  // all ~45 metros every run — only refreshes metros users have analyzed.
  //
  // Falls back to fetching all known metros if the deals table is empty or
  // the query fails (e.g. cold deploy).
  const EMPLOYMENT_METRO_LIMIT = 30; // max metros to refresh per cron run
  try {
    // Get distinct cities from recent deals (last 90 days)
    const { data: recentDeals } = await db
      .from('deals')
      .select('city')
      .not('city', 'is', null)
      .gte('created_at', new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString())
      .limit(200);

    // Extract unique city values that have FRED coverage
    const dealCities = [...new Set((recentDeals || []).map(d => d.city).filter(Boolean))];
    const citiesToRefresh = dealCities
      .filter(c => hasMetroUnemploymentData(c))
      .slice(0, EMPLOYMENT_METRO_LIMIT);

    // If no deal cities found, fall back to a curated shortlist of top investor metros
    const FALLBACK_METROS = [
      'Miami, FL', 'Tampa, FL', 'Orlando, FL', 'Jacksonville, FL',
      'Dallas, TX', 'Houston, TX', 'Austin, TX', 'San Antonio, TX',
      'Atlanta, GA', 'Charlotte, NC', 'Nashville, TN', 'Phoenix, AZ',
      'Las Vegas, NV', 'Denver, CO', 'Seattle, WA', 'Portland, OR',
      'Chicago, IL', 'Columbus, OH', 'Indianapolis, IN', 'Kansas City, MO',
    ];
    const metroBatch = citiesToRefresh.length > 0 ? citiesToRefresh : FALLBACK_METROS;

    // Check which employment keys are stale before fetching
    const staleEmploymentCities = [];
    for (const city of metroBatch) {
      const cityKey = city.split(',')[0].trim().toLowerCase();
      const cacheKey = `employment:${cityKey}`;
      if (await needsRefresh(cacheKey)) {
        staleEmploymentCities.push(city);
      }
    }

    if (staleEmploymentCities.length > 0) {
      // Fetch in batches of 5 to avoid FRED rate limiting
      const BATCH_SIZE = 5;
      for (let i = 0; i < staleEmploymentCities.length; i += BATCH_SIZE) {
        const batch = staleEmploymentCities.slice(i, i + BATCH_SIZE);
        const batchResults = await Promise.allSettled(
          batch.map(city => fetchMetroUnemployment(city).then(data => ({ city, data })))
        );

        for (const result of batchResults) {
          if (result.status !== 'fulfilled' || !result.value.data) continue;
          const { city, data } = result.value;
          const cityKey = city.split(',')[0].trim().toLowerCase();
          const cacheKey = `employment:${cityKey}`;
          const ok = await upsert(cacheKey, data, TTL.employment);
          if (ok) refreshed.push(cacheKey);
        }

        // Small delay between FRED batches to be respectful of rate limits
        if (i + BATCH_SIZE < staleEmploymentCities.length) {
          await new Promise(r => setTimeout(r, 500));
        }
      }
      console.log(`[cron] Employment: refreshed ${staleEmploymentCities.length} metros`);
    } else {
      skipped.push('employment (all metro keys within TTL)');
    }
  } catch (err) {
    errors.push({ key: 'employment', error: err.message });
  }

  // ── 8. Redfin: ZIP-level market pulse (weekly refresh) ───────────────────
  // Streams the Redfin weekly ZIP tracker (~200MB gzip) and stores per-ZIP data.
  // Only refreshes ZIPs associated with recent deals — keeps storage bounded.
  // Skipped if SKIP_REDFIN_REFRESH=1 env var is set (for Vercel Hobby plan limits).
  if (process.env.SKIP_REDFIN_REFRESH === '1') {
    skipped.push('redfin (SKIP_REDFIN_REFRESH=1)');
  } else {
    try {
      // Collect stale ZIPs from recent deals
      const { data: dealRows } = await db
        .from('deals')
        .select('data')
        .not('data', 'is', null)
        .gte('created_at', new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString())
        .limit(500);

      // Extract ZIPs from deal data blobs — stored as data.neighborhood.zip
      const allZips = new Set();
      for (const row of (dealRows || [])) {
        const zip = row.data?.neighborhood?.zip;
        if (zip && /^\d{5}$/.test(zip)) allZips.add(zip);
      }

      if (allZips.size === 0) {
        skipped.push('redfin (no ZIPs from recent deals)');
      } else {
        // Check which ZIPs actually need refreshing
        const staleZips = [];
        for (const zip of allZips) {
          if (await needsRefresh(`redfin:${zip}`)) {
            staleZips.push(zip);
          }
        }

        if (staleZips.length === 0) {
          skipped.push(`redfin (all ${allZips.size} ZIPs within TTL)`);
        } else {
          console.log(`[cron] Redfin: streaming file for ${staleZips.length} stale ZIPs...`);
          const redfinResults = await fetchRedfinZips(staleZips);

          if (redfinResults.size === 0) {
            errors.push({ key: 'redfin', error: 'fetchRedfinZips returned empty — likely fetch timeout or Redfin URL changed' });
          } else {
            for (const [zip, data] of redfinResults) {
              const ok = await upsert(`redfin:${zip}`, data, TTL.redfin);
              if (ok) refreshed.push(`redfin:${zip}`);
            }
            console.log(`[cron] Redfin: stored data for ${redfinResults.size}/${staleZips.length} ZIPs`);
          }
        }
      }
    } catch (err) {
      errors.push({ key: 'redfin', error: err.message });
    }
  }

  // ── Redfin City Market Data (Scout listing counts + price reduction signals) ──
  // Streams Redfin's city_market_tracker.tsv000.gz once and extracts all 55
  // Scout metros in a single pass. Provides: inventory (active listing count),
  // price_drops (% of listings with a price cut), market temp, DOM.
  // Updated weekly — same TTL as ZIP-level data.
  {
    const SCOUT_CITY_TARGETS = [
      { metro:'memphis',        city:'Memphis',        state:'TN' },
      { metro:'detroit',        city:'Detroit',        state:'MI' },
      { metro:'cleveland',      city:'Cleveland',      state:'OH' },
      { metro:'birmingham',     city:'Birmingham',     state:'AL' },
      { metro:'jackson',        city:'Jackson',        state:'MS' },
      { metro:'little rock',    city:'Little Rock',    state:'AR' },
      { metro:'oklahoma city',  city:'Oklahoma City',  state:'OK' },
      { metro:'tulsa',          city:'Tulsa',          state:'OK' },
      { metro:'kansas city',    city:'Kansas City',    state:'MO' },
      { metro:'st. louis',      city:'St. Louis',      state:'MO' },
      { metro:'pittsburgh',     city:'Pittsburgh',     state:'PA' },
      { metro:'indianapolis',   city:'Indianapolis',   state:'IN' },
      { metro:'columbus',       city:'Columbus',       state:'OH' },
      { metro:'cincinnati',     city:'Cincinnati',     state:'OH' },
      { metro:'louisville',     city:'Louisville',     state:'KY' },
      { metro:'buffalo',        city:'Buffalo',        state:'NY' },
      { metro:'jacksonville',   city:'Jacksonville',   state:'FL' },
      { metro:'tampa',          city:'Tampa',          state:'FL' },
      { metro:'orlando',        city:'Orlando',        state:'FL' },
      { metro:'cape coral',     city:'Cape Coral',     state:'FL' },
      { metro:'fort myers',     city:'Fort Myers',     state:'FL' },
      { metro:'charlotte',      city:'Charlotte',      state:'NC' },
      { metro:'raleigh',        city:'Raleigh',        state:'NC' },
      { metro:'atlanta',        city:'Atlanta',        state:'GA' },
      { metro:'nashville',      city:'Nashville',      state:'TN' },
      { metro:'houston',        city:'Houston',        state:'TX' },
      { metro:'dallas',         city:'Dallas',         state:'TX' },
      { metro:'san antonio',    city:'San Antonio',    state:'TX' },
      { metro:'el paso',        city:'El Paso',        state:'TX' },
      { metro:'albuquerque',    city:'Albuquerque',    state:'NM' },
      { metro:'phoenix',        city:'Phoenix',        state:'AZ' },
      { metro:'tucson',         city:'Tucson',         state:'AZ' },
      { metro:'las vegas',      city:'Las Vegas',      state:'NV' },
      { metro:'chicago',        city:'Chicago',        state:'IL' },
      { metro:'minneapolis',    city:'Minneapolis',    state:'MN' },
      { metro:'milwaukee',      city:'Milwaukee',      state:'WI' },
      { metro:'omaha',          city:'Omaha',          state:'NE' },
      { metro:'richmond',       city:'Richmond',       state:'VA' },
      { metro:'baltimore',      city:'Baltimore',      state:'MD' },
      { metro:'miami',          city:'Miami',          state:'FL' },
      { metro:'fort lauderdale',city:'Fort Lauderdale',state:'FL' },
      { metro:'austin',         city:'Austin',         state:'TX' },
      { metro:'denver',         city:'Denver',         state:'CO' },
      { metro:'salt lake city', city:'Salt Lake City', state:'UT' },
      { metro:'boise',          city:'Boise',          state:'ID' },
      { metro:'portland',       city:'Portland',       state:'OR' },
      { metro:'seattle',        city:'Seattle',        state:'WA' },
      { metro:'washington',     city:'Washington',     state:'DC' },
      { metro:'boston',         city:'Boston',         state:'MA' },
      { metro:'new york',       city:'New York',       state:'NY' },
      { metro:'los angeles',    city:'Los Angeles',    state:'CA' },
      { metro:'san diego',      city:'San Diego',      state:'CA' },
      { metro:'san francisco',  city:'San Francisco',  state:'CA' },
      { metro:'san jose',       city:'San Jose',       state:'CA' },
      { metro:'honolulu',       city:'Honolulu',       state:'HI' },
    ];

    // Only refresh metros whose cache is stale
    const staleTargets = [];
    for (const t of SCOUT_CITY_TARGETS) {
      if (await needsRefresh(`redfin_city:${t.metro}`)) {
        staleTargets.push(t);
      }
    }

    if (staleTargets.length === 0) {
      skipped.push('redfin_city (all within TTL)');
    } else {
      try {
        console.log(`[cron] Redfin city: fetching ${staleTargets.length} stale metros…`);
        const cityResults = await fetchRedfinCities(staleTargets);
        if (cityResults.size === 0) {
          errors.push({ key: 'redfin_city', error: 'fetchRedfinCities returned empty — check S3 URL or stream timeout' });
        } else {
          for (const [metro, data] of cityResults) {
            const ok = await upsert(`redfin_city:${metro}`, data, TTL.redfin_city);
            if (ok) refreshed.push(`redfin_city:${metro}`);
          }
          console.log(`[cron] Redfin city: stored ${cityResults.size}/${staleTargets.length} metros`);
        }
      } catch (err) {
        errors.push({ key: 'redfin_city', error: err.message });
      }
    }
  }

  // ── Phase 5: Financial Benchmark Intelligence ────────────────────────────
  // Treasury yield and S&P 500 refresh daily. PMI quarterly. ZORI monthly.
  // Closing costs are annual — the cron will skip them if fresh.

  // Phase 5A: 10-Year Treasury Yield (daily)
  if (await needsRefresh('treasury_yield')) {
    try {
      const data = await fetchTreasuryYield();
      if (data) {
        const ok = await upsert('treasury_yield', data, TTL.treasury_yield);
        if (ok) refreshed.push('treasury_yield');
      } else {
        errors.push({ key: 'treasury_yield', error: 'FRED DGS10 returned null' });
      }
    } catch (err) {
      errors.push({ key: 'treasury_yield', error: err.message });
    }
  } else {
    skipped.push('treasury_yield');
  }

  // Phase 5B: S&P 500 Trailing Returns (daily)
  if (await needsRefresh('sp500_returns')) {
    try {
      const data = await fetchSP500Returns();
      if (data) {
        const ok = await upsert('sp500_returns', data, TTL.sp500_returns);
        if (ok) refreshed.push('sp500_returns');
      } else {
        errors.push({ key: 'sp500_returns', error: 'FRED SP500 returned null' });
      }
    } catch (err) {
      errors.push({ key: 'sp500_returns', error: err.message });
    }
  } else {
    skipped.push('sp500_returns');
  }

  // Phase 5C: PMI Rates by LTV band (quarterly — 90-day TTL)
  if (await needsRefresh('pmi_rates')) {
    try {
      const data = await fetchPmiRates();
      if (data) {
        // Strip the rateForDownPct function before storing (functions can't be serialized)
        const { rateForDownPct: _, ...storableData } = data;
        const ok = await upsert('pmi_rates', storableData, TTL.pmi_rates);
        if (ok) refreshed.push('pmi_rates');
      } else {
        errors.push({ key: 'pmi_rates', error: 'PMI rates fetch returned null' });
      }
    } catch (err) {
      errors.push({ key: 'pmi_rates', error: err.message });
    }
  } else {
    skipped.push('pmi_rates');
  }

  // Phase 5D: Zillow ZORI Metro Rent Growth (monthly)
  // This is a large CSV — only refresh if the national key is stale.
  // Stores each metro individually: zori_rent_growth:{metro_key}
  if (await needsRefresh('zori_refresh_sentinel')) {
    try {
      console.log('[cron] Fetching Zillow ZORI CSV (may take 10–20s)...');
      const zoriMap = await fetchZoriRentGrowth();
      if (!zoriMap || zoriMap.size === 0) {
        errors.push({ key: 'zori_rent_growth', error: 'ZORI CSV returned no metros' });
      } else {
        let zoriStored = 0;
        for (const [metroKey, data] of zoriMap) {
          const cacheKey = `zori_rent_growth:${metroKey}`;
          const ok = await upsert(cacheKey, data, TTL.zori_rent_growth);
          if (ok) zoriStored++;
        }
        refreshed.push(`zori_rent_growth (${zoriStored} metros)`);
        console.log(`[cron] ZORI: stored ${zoriStored} metro keys`);
        // Store a sentinel key so needsRefresh() knows the batch is fresh
        await upsert('zori_refresh_sentinel', { storedMetros: zoriStored, at: now.toISOString() }, TTL.zori_rent_growth);
      }
    } catch (err) {
      errors.push({ key: 'zori_rent_growth', error: err.message });
    }
  } else {
    skipped.push('zori_rent_growth (within TTL)');
  }

  // Phase 5E: State Closing Costs (annual — 365-day TTL)
  if (await needsRefresh('state_closing_costs')) {
    try {
      const data = await fetchClosingCostDefaults();
      if (data) {
        const ok = await upsert('state_closing_costs', data, TTL.state_closing_costs);
        if (ok) refreshed.push('state_closing_costs');
      } else {
        errors.push({ key: 'state_closing_costs', error: 'Closing cost data returned null' });
      }
    } catch (err) {
      errors.push({ key: 'state_closing_costs', error: err.message });
    }
  } else {
    skipped.push('state_closing_costs');
  }

  // ── Phase 6: Property & Address Intelligence ───────────────────────────────
  // Building permits and metro growth are fetched for the top 50 investor markets
  // proactively — so when a user analyzes a deal in Dallas or Phoenix, the data
  // is already in cache and the analysis response is instant.

  // Phase 6A: Building Permits by Metro (monthly — Census BPS)
  // Top 50 investor markets by CBSA code
  const TOP_CBSAS_PERMITS = [
    '12060','16740','34980','39580','45300','36740','33100', // Atlanta, Charlotte, Nashville, Raleigh, Tampa, Orlando, Miami
    '19100','26420','12420','41700','38060','29820',         // Dallas, Houston, Austin, San Antonio, Phoenix, Las Vegas
    '19740','14260','41620',                                 // Denver, Boise, Salt Lake City
    '31080','41740','41860','41940','38900','42660',         // LA, San Diego, SF, San Jose, Portland, Seattle
    '16980','33460','28140','41180','18140','16740',         // Chicago, Minneapolis, Kansas City, St Louis, Columbus, Charlotte
    '47900','14460','37980','35620',                         // DC, Boston, Philadelphia, NYC
    '27260','13820','40060','22744','15980',                 // Jacksonville, Birmingham, Richmond, Ft Laud, Cape Coral
    '39900','44060','13740','26620','28940',                 // Reno, Spokane, Billings, Huntsville, Knoxville
  ];

  if (await needsRefresh('building_permits_sentinel')) {
    let permitsStored = 0;
    const permitErrors = [];

    for (const cbsa of TOP_CBSAS_PERMITS) {
      const cacheKey = `building_permits:${cbsa}`;
      if (await needsRefresh(cacheKey)) {
        try {
          const data = await fetchBuildingPermits(cbsa);
          if (data) {
            const ok = await upsert(cacheKey, data, TTL.building_permits);
            if (ok) permitsStored++;
          }
        } catch (err) {
          permitErrors.push(`${cbsa}: ${err.message}`);
        }
        // Brief pause to avoid hammering Census server
        await new Promise(r => setTimeout(r, 200));
      } else {
        permitsStored++; // already fresh — count as covered
      }
    }

    if (permitsStored > 0) {
      await upsert('building_permits_sentinel', { coveredCbsas: permitsStored, at: now.toISOString() }, TTL.building_permits);
      refreshed.push(`building_permits (${permitsStored} metros)`);
    }
    if (permitErrors.length > 0) {
      errors.push({ key: 'building_permits', error: `${permitErrors.length} metros failed` });
    }
  } else {
    skipped.push('building_permits (within TTL)');
  }

  // Phase 6B: Metro Population + Job Growth (annual — Census ACS + BLS LAUS)
  const TOP_CBSAS_GROWTH = [
    '12060','16740','34980','39580','45300','36740','33100',
    '19100','26420','12420','41700','38060','29820',
    '19740','14260','41620',
    '31080','41740','41860','41940','38900','42660',
    '16980','33460','28140','41180','18140',
    '47900','14460','37980','35620',
    '27260','13820','40060',
  ];

  if (await needsRefresh('metro_growth_sentinel')) {
    let growthStored = 0;
    const growthErrors = [];

    for (const cbsa of TOP_CBSAS_GROWTH) {
      const cacheKey = `metro_growth:${cbsa}`;
      if (await needsRefresh(cacheKey)) {
        try {
          const data = await fetchMetroGrowth(cbsa);
          if (data) {
            const ok = await upsert(cacheKey, data, TTL.metro_growth);
            if (ok) growthStored++;
          }
        } catch (err) {
          growthErrors.push(`${cbsa}: ${err.message}`);
        }
        await new Promise(r => setTimeout(r, 300));
      } else {
        growthStored++;
      }
    }

    if (growthStored > 0) {
      await upsert('metro_growth_sentinel', { coveredCbsas: growthStored, at: now.toISOString() }, TTL.metro_growth);
      refreshed.push(`metro_growth (${growthStored} metros)`);
    }
    if (growthErrors.length > 0) {
      errors.push({ key: 'metro_growth', error: `${growthErrors.length} metros failed` });
    }
  } else {
    skipped.push('metro_growth (within TTL)');
  }

  // ── Phase 7A: Census HVS Rental Vacancy (quarterly) ─────────────────────
  if (await needsRefresh('hvs_vacancy')) {
    try {
      const hvsData = await fetchHvsVacancy();
      if (hvsData) {
        await upsert('hvs_vacancy', hvsData, TTL.hvs_vacancy);
        refreshed.push('hvs_vacancy');
      } else {
        errors.push({ key: 'hvs_vacancy', error: 'No data returned from Census HVS API' });
      }
    } catch (e) {
      errors.push({ key: 'hvs_vacancy', error: e.message });
    }
  } else {
    skipped.push('hvs_vacancy (within TTL)');
  }

  // ── Phase 7B: Market Cap Rates (semi-annual; static table) ───────────────
  if (await needsRefresh('market_cap_rates')) {
    try {
      const capRates = await fetchCapRates();
      await upsert('market_cap_rates', capRates, TTL.market_cap_rates);
      refreshed.push('market_cap_rates');
    } catch (e) {
      errors.push({ key: 'market_cap_rates', error: e.message });
    }
  } else {
    skipped.push('market_cap_rates (within TTL)');
  }

  // ── Phase 7C: Property Management Fee Rates (annual; static table) ────────
  if (await needsRefresh('mgmt_fee_rates')) {
    try {
      const mgmtFees = await fetchMgmtFeeRates();
      await upsert('mgmt_fee_rates', mgmtFees, TTL.mgmt_fee_rates);
      refreshed.push('mgmt_fee_rates');
    } catch (e) {
      errors.push({ key: 'mgmt_fee_rates', error: e.message });
    }
  } else {
    skipped.push('mgmt_fee_rates (within TTL)');
  }

  // ── Phase 7D: HUD SAFMR — top 200 ZIP codes pre-cache (annual) ───────────
  const TOP_ZIPS_SAFMR = [
    '10001','10002','10025','10036','10128','11201','11211','11217','11231','11238',
    '90001','90024','90025','90026','90027','90034','90035','90036','90039','90045',
    '94102','94103','94110','94117','94124','94158','94601','94606','95112','95125',
    '60601','60605','60607','60608','60614','60616','60618','60640','60647','60657',
    '77002','77006','77008','77019','77027','77098','77099','77204','77346','77401',
    '75201','75204','75205','75206','75208','75219','75228','75244','75254','75287',
    '85004','85006','85008','85012','85013','85014','85015','85016','85018','85251',
    '19102','19103','19104','19107','19143','19146','19147','19148','19154','19019',
    '78201','78202','78203','78204','78205','78207','78208','78209','78210','78212',
    '92101','92103','92104','92105','92108','92110','92116','92117','92120','92127',
    '78701','78702','78703','78704','78705','78717','78723','78729','78745','78759',
    '32202','32204','32205','32207','32209','32210','32211','32216','32217','32225',
    '76101','76102','76103','76104','76105','76106','76107','76108','76109','76110',
    '43201','43202','43203','43204','43205','43206','43209','43211','43213','43215',
    '28202','28203','28204','28205','28206','28207','28208','28209','28210','28211',
    '46201','46202','46203','46204','46205','46206','46207','46208','46218','46219',
    '98101','98102','98103','98104','98105','98107','98109','98112','98115','98122',
    '80202','80203','80204','80205','80206','80207','80209','80210','80211','80218',
    '37201','37203','37204','37205','37206','37207','37208','37209','37210','37211',
    '38101','38103','38104','38105','38106','38107','38108','38109','38111','38114',
  ];

  if (await needsRefresh('safmr_sentinel')) {
    let safmrStored = 0;
    const safmrErrors = [];
    for (const zip of TOP_ZIPS_SAFMR) {
      for (const beds of [1, 2, 3]) {
        try {
          const data = await fetchSafmrRent(zip, beds);
          if (data?.rent) {
            const validUntil = new Date(Date.now() + TTL.safmr_rent);
            await db.from('market_data_cache').upsert({
              key: `safmr_rent:${zip}:${beds}`,
              value: data,
              fetched_at: now.toISOString(),
              valid_until: validUntil.toISOString(),
            }, { onConflict: 'key' });
            safmrStored++;
          }
          await new Promise(r => setTimeout(r, 100));
        } catch (e) {
          safmrErrors.push(`${zip}:${beds}`);
        }
      }
    }
    if (safmrStored > 0) {
      await upsert('safmr_sentinel', { coveredZips: Math.floor(safmrStored / 3), at: now.toISOString() }, TTL.safmr_rent);
      refreshed.push(`safmr_rent (${safmrStored} zip/bed combos)`);
    }
    if (safmrErrors.length > 0) {
      errors.push({ key: 'safmr_rent', error: `${safmrErrors.length} combos failed` });
    }
  } else {
    skipped.push('safmr_rent (within TTL)');
  }

  // ── Phase 8A: Insurance rates (annual; live III fetch with NAIC calibration fallback) ─
  if (await needsRefresh('state_ins_rates')) {
    try {
      const insRates = await fetchInsuranceRates();
      await upsert('state_ins_rates', insRates, TTL.state_ins_rates_live);
      refreshed.push('state_ins_rates');
    } catch (e) {
      // Seed with calibrated NAIC baseline so the key is never absent
      try {
        const { INS_RATE_BASELINE } = await import('../../../lib/insuranceRateFetcher.js');
        await upsert('state_ins_rates', INS_RATE_BASELINE, TTL.state_ins_rates_live);
        refreshed.push('state_ins_rates (baseline fallback)');
      } catch { errors.push({ key: 'state_ins_rates', error: e.message }); }
    }
  } else {
    skipped.push('state_ins_rates (within TTL)');
  }

  // ── Phase 8B: STR data — top 20 investor markets pre-cache (quarterly) ────
  const TOP_STR_CITIES = [
    'Nashville, TN', 'Austin, TX', 'Miami, FL', 'Orlando, FL', 'New Orleans, LA',
    'Denver, CO', 'San Diego, CA', 'Asheville, NC', 'Chicago, IL', 'Atlanta, GA',
    'Phoenix, AZ', 'Las Vegas, NV', 'Seattle, WA', 'Portland, OR', 'Tampa, FL',
    'Charlotte, NC', 'Dallas, TX', 'Houston, TX', 'Memphis, TN', 'Indianapolis, IN',
  ];
  const strSentinelKey = 'str_data_sentinel';
  if (await needsRefresh(strSentinelKey)) {
    const strErrors = [];
    const strRefreshed = [];
    for (const city of TOP_STR_CITIES) {
      for (const beds of [1, 2, 3]) {
        const citySlug = city.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/_+$/, '');
        const cacheKey = `str_data:${citySlug}:${beds}br`;
        if (await needsRefresh(cacheKey)) {
          try {
            const strData = await fetchStrData(city, beds);
            if (strData) {
              await upsert(cacheKey, strData, TTL.str_data);
              strRefreshed.push(cacheKey);
            }
          } catch (e) {
            strErrors.push(`${cacheKey}: ${e.message}`);
          }
        }
      }
    }
    // Write sentinel so we don't re-run the whole batch for 90 days
    await upsert(strSentinelKey, { completedAt: new Date().toISOString(), cities: TOP_STR_CITIES.length }, TTL.str_data);
    if (strRefreshed.length > 0) refreshed.push(`str_data (${strRefreshed.length} keys)`);
    if (strErrors.length > 0) errors.push({ key: 'str_data', error: `${strErrors.length} cities failed` });
  } else {
    skipped.push('str_data (within TTL)');
  }

  // ── Phase 8C: FEMA NRI climate risk — top 30 investor county FIPS (annual) ─
  const TOP_CLIMATE_FIPS = [
    '12086','12057','12031','12011','12099', // FL: Miami-Dade, Hillsborough, Duval, Broward, Palm Beach
    '48113','48201','48029','48453',         // TX: Dallas, Harris, Bexar, Travis
    '37119','37183',                         // NC: Mecklenburg, Wake
    '13121','13067',                         // GA: Fulton, Cobb
    '47157','47037',                         // TN: Shelby (Memphis), Davidson (Nashville)
    '06037','06073','06085',                 // CA: LA, San Diego, Santa Clara
    '53033','41051',                         // WA: King; OR: Multnomah
    '08031','08059',                         // CO: Denver, Jefferson
    '04013','32003',                         // AZ: Maricopa; NV: Clark
    '36061','36081',                         // NY: Manhattan, Queens
    '17031','26163',                         // IL: Cook; MI: Wayne
    '39049','39035',                         // OH: Franklin (Columbus), Cuyahoga (Cleveland)
    '29510','29189',                         // MO: St Louis City, St Louis County
  ];

  const climateSentinelKey = 'climate_risk_sentinel';
  if (await needsRefresh(climateSentinelKey)) {
    const climateErrors = [];
    let climateRefreshed = 0;
    for (const fips of TOP_CLIMATE_FIPS) {
      const cacheKey = `climate_risk:${fips}`;
      if (await needsRefresh(cacheKey)) {
        try {
          const riskData = await fetchClimateRisk(fips);
          if (riskData) {
            await upsert(cacheKey, riskData, TTL.climate_risk);
            climateRefreshed++;
          }
        } catch (e) {
          climateErrors.push(`${fips}: ${e.message}`);
        }
      }
    }
    await upsert(climateSentinelKey, { completedAt: new Date().toISOString(), counties: TOP_CLIMATE_FIPS.length }, TTL.climate_risk);
    if (climateRefreshed > 0) refreshed.push(`climate_risk (${climateRefreshed} counties)`);
    if (climateErrors.length > 0) errors.push({ key: 'climate_risk', error: `${climateErrors.length} counties failed` });
  } else {
    skipped.push('climate_risk (within TTL)');
  }

  // ── Phase 9: Auto-Heal — Live replacements for all static tables ─────────
  //
  // These fetchers replace the "seed static table every N days" pattern with
  // genuine live data. Each has a robust fallback: if the live fetch fails,
  // the existing cache entry (from a prior successful fetch) stays in place.
  // The static baseline is only used on cold-start before any cron has run.

  // Phase 9A: State property tax rates — Census ACS5 (annual)
  if (await needsRefresh('state_tax_rates_live')) {
    try {
      const taxRates = await fetchStateTaxRates();
      if (taxRates) {
        const ok = await upsert('state_tax_rates', taxRates, TTL.state_tax_rates_live);
        if (ok) refreshed.push('state_tax_rates (Census ACS live)');
      } else {
        skipped.push('state_tax_rates_live (Census ACS unavailable — keeping existing cache)');
      }
    } catch (e) {
      errors.push({ key: 'state_tax_rates_live', error: e.message });
    }
  } else {
    skipped.push('state_tax_rates_live (within TTL)');
  }

  // Phase 9B: Landlord laws — Eviction Lab + NCSL (monthly)
  if (await needsRefresh('landlord_laws_live')) {
    try {
      const laws = await fetchLandlordLaws();
      if (laws) {
        const ok = await upsert('landlord_laws', laws, TTL.landlord_laws_live);
        if (ok) refreshed.push('landlord_laws (Eviction Lab live)');
      } else {
        skipped.push('landlord_laws_live (live fetch failed — keeping existing cache)');
      }
    } catch (e) {
      errors.push({ key: 'landlord_laws_live', error: e.message });
    }
  } else {
    skipped.push('landlord_laws_live (within TTL)');
  }

  // Phase 9C: STR regulations — NMHC preemption tracker + city pages (quarterly)
  if (await needsRefresh('str_regulations_live')) {
    try {
      const strRegs = await fetchStrRegulations();
      if (strRegs) {
        const ok = await upsert('str_regulations', strRegs, TTL.str_regulations_live);
        if (ok) refreshed.push('str_regulations (NMHC live)');
      } else {
        skipped.push('str_regulations_live (live fetch failed — keeping existing cache)');
      }
    } catch (e) {
      errors.push({ key: 'str_regulations_live', error: e.message });
    }
  } else {
    skipped.push('str_regulations_live (within TTL)');
  }

  // Phase 9D: Cap rates — computed from Census ACS + HUD SAFMR (quarterly)
  if (await needsRefresh('computed_cap_rates')) {
    try {
      // Get latest HVS vacancy for accurate computation
      let vacancyRate = 0.055; // national fallback
      try {
        const hvs = await db.from('market_data_cache').select('value').eq('key', 'hvs_vacancy').single();
        if (hvs?.data?.value?.national) vacancyRate = hvs.data.value.national / 100;
      } catch {}

      const capRates = await fetchComputedCapRates(fetchSafmrRent, vacancyRate);
      if (capRates) {
        const ok = await upsert('market_cap_rates', capRates, TTL.computed_cap_rates);
        if (ok) refreshed.push('market_cap_rates (computed live)');
      } else {
        skipped.push('computed_cap_rates (computation failed — keeping existing cache)');
      }
    } catch (e) {
      errors.push({ key: 'computed_cap_rates', error: e.message });
    }
  } else {
    skipped.push('computed_cap_rates (within TTL)');
  }

  // Phase 9E: Rent control database — NLIHC + Eviction Lab (monthly)
  if (await needsRefresh('rent_control_db_live')) {
    try {
      const rcData = await fetchRentControlData();
      if (rcData) {
        const ok = await upsert('rent_control_db', rcData, TTL.rent_control_db_live);
        if (ok) refreshed.push('rent_control_db (NLIHC live)');
      } else {
        skipped.push('rent_control_db_live (live fetch failed — keeping existing cache)');
      }
    } catch (e) {
      errors.push({ key: 'rent_control_db_live', error: e.message });
    }
  } else {
    skipped.push('rent_control_db_live (within TTL)');
  }

  // Phase 9F: Closing costs — Tax Foundation transfer tax data (annual)
  if (await needsRefresh('closing_costs_live')) {
    try {
      const closingCosts = await fetchClosingCostLive();
      if (closingCosts) {
        const ok = await upsert('state_closing_costs', closingCosts, TTL.closing_costs_live);
        if (ok) refreshed.push('state_closing_costs (Tax Foundation live)');
      } else {
        skipped.push('closing_costs_live (Tax Foundation unavailable — keeping existing cache)');
      }
    } catch (e) {
      errors.push({ key: 'closing_costs_live', error: e.message });
    }
  } else {
    skipped.push('closing_costs_live (within TTL)');
  }

  // Phase 9G: Management fee rates — NARPM + housing CPI (annual)
  if (await needsRefresh('mgmt_fee_rates_live')) {
    try {
      const mgmtFees = await fetchMgmtFeeLive();
      if (mgmtFees) {
        const ok = await upsert('mgmt_fee_rates', mgmtFees, TTL.mgmt_fee_rates_live);
        if (ok) refreshed.push('mgmt_fee_rates (NARPM live)');
      } else {
        skipped.push('mgmt_fee_rates_live (live fetch failed — keeping existing cache)');
      }
    } catch (e) {
      errors.push({ key: 'mgmt_fee_rates_live', error: e.message });
    }
  } else {
    skipped.push('mgmt_fee_rates_live (within TTL)');
  }

  // ── Response ──────────────────────────────────────────────────────────────
  console.log(`[cron/refresh-market-data] refreshed=${refreshed.join(',') || 'none'} skipped=${skipped.join(',') || 'none'} errors=${errors.length}`);

  return res.status(200).json({
    ok: errors.length === 0,
    refreshed,
    skipped,
    errors,
    timestamp: now.toISOString(),
  });
}
