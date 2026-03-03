/**
 * pages/api/school-rating.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Phase 6 — On-demand school quality lookup for a ZIP code.
 *
 * Called after analysis for SFR/condo properties where school quality
 * significantly impacts tenant demand and appreciation.
 *
 * GET /api/school-rating?zip={zip}
 *
 * Returns:
 *  { count, elementary, middle, high, score, tier, tierLabel,
 *    avgStudentTeacherRatio, titleIPct, overall, note, source, cached }
 *
 * Cache TTL: 365 days (NCES CCD data is annual).
 */

import { fetchSchoolRating } from '../../lib/addressIntelFetcher.js';
import { getSupabaseAdmin }   from '../../lib/supabase.js';

export const config = { api: { bodyParser: false }, maxDuration: 12 };

const CACHE_TTL_DAYS = 365;

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const { zip } = req.query;
  if (!zip || !/^\d{5}$/.test(zip)) {
    return res.status(400).json({ error: 'Valid 5-digit ZIP required' });
  }

  const cacheKey = `school_rating:${zip}`;
  const db = getSupabaseAdmin();

  // ── 1. Try cache first ──────────────────────────────────────────────────────
  try {
    const { data: row } = await db
      .from('market_data_cache')
      .select('value, fetched_at, valid_until')
      .eq('key', cacheKey)
      .single();

    if (row?.value && row.valid_until) {
      if (Date.now() < new Date(row.valid_until).getTime()) {
        const cached = typeof row.value === 'string' ? JSON.parse(row.value) : row.value;
        return res.status(200).json({ ...cached, cached: true, cachedAt: row.fetched_at });
      }
    }
  } catch { /* cache miss */ }

  // ── 2. Fetch from NCES ──────────────────────────────────────────────────────
  const result = await fetchSchoolRating(zip);

  if (!result) {
    return res.status(200).json({
      count:   0,
      overall: 'no_data',
      note:    'School data could not be retrieved for this ZIP code.',
      source:  'NCES CCD',
      cached:  false,
    });
  }

  // ── 3. Write to cache ───────────────────────────────────────────────────────
  try {
    const validUntil = new Date(Date.now() + CACHE_TTL_DAYS * 86400 * 1000).toISOString();
    await db.from('market_data_cache').upsert({
      key:         cacheKey,
      value:       JSON.stringify(result),
      fetched_at:  new Date().toISOString(),
      valid_until: validUntil,
    }, { onConflict: 'key' });
  } catch (e) {
    console.warn('[school-rating] Cache write failed (non-fatal):', e.message);
  }

  return res.status(200).json({ ...result, cached: false });
}
