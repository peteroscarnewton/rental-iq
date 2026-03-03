/**
 * GET /api/zori-for-city?city=Austin%2C+TX
 * ─────────────────────────────────────────────────────────────────────────────
 * Returns Zillow ZORI metro rent growth data for a given city string.
 * Reads from market_data_cache (key: zori_rent_growth:{metro_key}).
 * Populated by the cron job (Phase 5D).
 *
 * Response:
 *   { found: true, metro, annualGrowthPct, growth2yr, growth3yr, asOf, source }
 *   { found: false }  — if no ZORI data for this metro
 *
 * Used by the analyze UI to auto-fill the rent growth field with
 * metro-specific ZORI data instead of the national CPI Shelter default.
 */

import { getSupabaseAdmin } from '../../lib/supabase.js';

export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const city = req.query.city?.trim();
  if (!city || city.length < 3) {
    return res.status(400).json({ error: 'city param required' });
  }

  // Cache-control: client can cache 30 min; same metro won't change within a session
  res.setHeader('Cache-Control', 'public, s-maxage=1800, stale-while-revalidate=3600');

  try {
    const db = getSupabaseAdmin();
    const cityKey = city.split(',')[0].trim().toLowerCase();

    // Try exact match and a few common variations
    const keysToTry = [
      cityKey,
      cityKey.replace(/\s+/g, '-'),
      // Handle "Fort Worth" → "fort worth" already handled by toLowerCase
    ];

    for (const key of keysToTry) {
      const { data, error } = await db
        .from('market_data_cache')
        .select('value, fetched_at, valid_until')
        .eq('key', `zori_rent_growth:${key}`)
        .single();

      if (!error && data && new Date(data.valid_until) > new Date()) {
        return res.status(200).json({
          found: true,
          ...data.value,
        });
      }
    }

    // Not found in cache
    return res.status(200).json({ found: false });

  } catch (err) {
    console.warn('[zori-for-city] error:', err.message);
    return res.status(200).json({ found: false }); // non-fatal
  }
}
