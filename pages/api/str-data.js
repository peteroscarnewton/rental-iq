/**
 * pages/api/str-data.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Phase 8 — On-demand STR income data + regulatory status for a city.
 *
 * Called client-side after analysis to surface STR income potential.
 * First checks Supabase cache (populated by cron for top 20 cities),
 * then falls back to live Inside Airbnb fetch, then to fallback estimates.
 * Results cached 90 days.
 *
 * GET /api/str-data?city={city}&beds={1-4}
 *
 * Returns:
 *  { nightlyRate, occupancyRate, annualRevenue, beds, regulation, estimated, source }
 */

import { fetchStrData, getStrRegulation } from '../../lib/strDataFetcher.js';
import { rateLimit } from '../../lib/rateLimit.js';
import { getSupabaseAdmin }               from '../../lib/supabase.js';

export const config = { api: { bodyParser: false }, maxDuration: 20 };

const CACHE_TTL_MS = 90 * 24 * 60 * 60 * 1000;

function cityToSlug(city, beds) {
  const slug = city.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/_+$/, '');
  return `str_data:${slug}:${beds}br`;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  if (!rateLimit(req, { max: 30, windowMs: 60_000 })) return res.status(429).json({ error: 'Too many requests. Please wait a minute.' });


  const { city, beds } = req.query;
  if (!city) return res.status(400).json({ error: 'city required' });
  const bedsNum = Math.min(Math.max(parseInt(beds) || 2, 1), 4);

  // Always include regulatory status — it's static/instant
  const regulation = getStrRegulation(city);

  const cacheKey = cityToSlug(city, bedsNum);

  try {
    const db = getSupabaseAdmin();

    // 1. Check Supabase cache
    const { data: cached } = await db
      .from('market_data_cache')
      .select('value, valid_until')
      .eq('key', cacheKey)
      .single();

    if (cached && new Date(cached.valid_until) > new Date()) {
      const val = typeof cached.value === 'string' ? JSON.parse(cached.value) : cached.value;
      res.setHeader('Cache-Control', 'public, s-maxage=3600');
      return res.status(200).json({ ...val, regulation, cached: true });
    }

    // 2. Fetch live (Inside Airbnb or fallback estimate)
    const result = await fetchStrData(city, bedsNum);
    if (!result) return res.status(200).json({ regulation });

    // 3. Cache result
    const validUntil = new Date(Date.now() + CACHE_TTL_MS).toISOString();
    await db.from('market_data_cache').upsert({
      key: cacheKey,
      value: result,
      fetched_at: new Date().toISOString(),
      valid_until: validUntil,
    }, { onConflict: 'key' });

    res.setHeader('Cache-Control', 'public, s-maxage=3600');
    return res.status(200).json({ ...result, regulation, cached: false });

  } catch (err) {
    console.error('[str-data] error:', err.message);
    // Non-fatal — return regulation even if income data fails
    return res.status(200).json({ regulation });
  }
}
