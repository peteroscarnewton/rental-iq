/**
 * pages/api/safmr-rent.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Phase 7 fix — On-demand HUD Small Area Fair Market Rent lookup by ZIP + beds.
 *
 * Called client-side after neighborhood enrichment provides a ZIP code.
 * Results cached in market_data_cache (365-day TTL — HUD SAFMR updates annually).
 *
 * GET /api/safmr-rent?zip={zip}&beds={0-4}
 *
 * Returns:
 *  { rent, zip, beds, metro, year, source, cached }
 *
 * If SAFMR API is unavailable, returns null (not an error) — caller handles gracefully.
 */

import { fetchSafmrRent }  from '../../lib/marketBenchmarkFetcher.js';
import { rateLimit } from '../../lib/rateLimit.js';
import { getSupabaseAdmin } from '../../lib/supabase.js';

export const config = { api: { bodyParser: false }, maxDuration: 10 };

const CACHE_TTL_MS = 365 * 24 * 60 * 60 * 1000; // 365 days — HUD SAFMR annual release

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  if (!rateLimit(req, { max: 30, windowMs: 60_000 })) return res.status(429).json({ error: 'Too many requests. Please wait a minute.' });


  const { zip, beds } = req.query;
  if (!zip || !/^\d{5}$/.test(zip)) return res.status(400).json({ error: 'valid 5-digit zip required' });
  const bedsNum = Math.min(Math.max(parseInt(beds) || 2, 0), 4);

  // 1. Check Supabase cache
  try {
    const db = getSupabaseAdmin();
    const cacheKey = `safmr_rent:${zip}:${bedsNum}`;
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

    // 2. Fetch live from HUD SAFMR API
    const result = await fetchSafmrRent(zip, bedsNum);
    if (!result) return res.status(200).json(null);

    // 3. Write to cache
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
    console.error('[safmr-rent] error:', err.message);
    // Non-fatal — return null, not 500
    return res.status(200).json(null);
  }
}
