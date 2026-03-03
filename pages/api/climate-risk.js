/**
 * pages/api/climate-risk.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Phase 8 — On-demand FEMA NRI climate risk lookup by county FIPS or city.
 *
 * Called client-side after analysis when a city/stateCode is known.
 * First checks the pre-populated cron cache, then falls back to live fetch.
 * Results cached 365 days (FEMA NRI updates annually).
 *
 * GET /api/climate-risk?fips={5digitFips}
 * GET /api/climate-risk?city={city}&state={stateCode}
 */

import { fetchClimateRisk,
         geocodeToCountyFips,
         getPrimaryCountyFips }  from '../../lib/climateRiskFetcher.js';
import { getSupabaseAdmin }      from '../../lib/supabase.js';

export const config = { api: { bodyParser: false }, maxDuration: 15 };

const CACHE_TTL_MS = 365 * 24 * 60 * 60 * 1000;

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const { fips, city, state } = req.query;

  // Resolve FIPS
  let countyFips = fips;
  if (!countyFips || !/^\d{5}$/.test(countyFips)) {
    if (city) {
      // Try geocoding first, fall back to primary county for the state
      countyFips = await geocodeToCountyFips(city + (state ? `, ${state}` : ''));
    }
    if ((!countyFips || !/^\d{5}$/.test(countyFips)) && state) {
      countyFips = getPrimaryCountyFips(state);
    }
  }

  if (!countyFips || !/^\d{5}$/.test(countyFips)) {
    return res.status(400).json({ error: 'county_fips or city+state required' });
  }

  const cacheKey = `climate_risk:${countyFips}`;

  try {
    const db = getSupabaseAdmin();

    // 1. Check Supabase cache (cron pre-populates top metros)
    const { data: cached } = await db
      .from('market_data_cache')
      .select('value, valid_until')
      .eq('key', cacheKey)
      .single();

    if (cached && new Date(cached.valid_until) > new Date()) {
      const val = typeof cached.value === 'string' ? JSON.parse(cached.value) : cached.value;
      res.setHeader('Cache-Control', 'public, s-maxage=86400');
      return res.status(200).json({ ...val, cached: true });
    }

    // 2. Live fetch from FEMA NRI API
    const result = await fetchClimateRisk(countyFips);
    if (!result) return res.status(200).json(null);

    // 3. Cache result
    const validUntil = new Date(Date.now() + CACHE_TTL_MS).toISOString();
    await db.from('market_data_cache').upsert({
      key: cacheKey,
      value: result,
      fetched_at: new Date().toISOString(),
      valid_until: validUntil,
    }, { onConflict: 'key' });

    res.setHeader('Cache-Control', 'public, s-maxage=86400');
    return res.status(200).json({ ...result, cached: false });

  } catch (err) {
    console.error('[climate-risk] error:', err.message);
    return res.status(200).json(null);
  }
}
