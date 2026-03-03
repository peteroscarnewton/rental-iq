/**
 * pages/api/flood-risk.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Phase 6 — On-demand FEMA flood risk lookup for a lat/lng coordinate.
 *
 * Called after a successful analysis when the property has been geocoded.
 * Results are cached in market_data_cache to avoid re-querying FEMA for the
 * same coordinate on subsequent loads/share views.
 *
 * GET /api/flood-risk?lat={lat}&lng={lng}&address={optional_for_geocoding}
 *
 * Returns:
 *  { zone, baseZone, riskLevel, label, description, requiresInsurance,
 *    bfe, annualInsEst, monthlyInsEst, note, source, cached }
 *
 * Cache TTL: 180 days (flood maps rarely change except after major disaster events).
 */

import { fetchFloodRisk } from '../../lib/addressIntelFetcher.js';
import { getSupabaseAdmin } from '../../lib/supabase.js';

export const config = { api: { bodyParser: false }, maxDuration: 15 };

const CACHE_TTL_DAYS = 180;

function latLngKey(lat, lng) {
  // Round to ~100m precision for cache key (4 decimal places = ~11m)
  const rLat = Math.round(parseFloat(lat) * 1000) / 1000;
  const rLng = Math.round(parseFloat(lng) * 1000) / 1000;
  return `flood_risk:${rLat}_${rLng}`;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const { lat, lng, address } = req.query;
  let resolvedLat = parseFloat(lat);
  let resolvedLng = parseFloat(lng);

  // If no lat/lng but address provided, geocode via Census
  if ((isNaN(resolvedLat) || isNaN(resolvedLng)) && address) {
    try {
      const geoUrl = `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=${encodeURIComponent(address)}&benchmark=Public_AR_Current&format=json`;
      const gr = await fetch(geoUrl, { signal: AbortSignal.timeout(6000) });
      if (gr.ok) {
        const gb = await gr.json();
        const match = gb?.result?.addressMatches?.[0];
        if (match) {
          resolvedLat = parseFloat(match.coordinates.y);
          resolvedLng = parseFloat(match.coordinates.x);
        }
      }
    } catch { /* geocode failed — fall through */ }
  }

  if (isNaN(resolvedLat) || isNaN(resolvedLng)) {
    return res.status(400).json({ error: 'lat and lng are required (or a geocodable address)' });
  }

  const cacheKey = latLngKey(resolvedLat, resolvedLng);
  const db = getSupabaseAdmin();

  // ── 1. Try cache first ──────────────────────────────────────────────────────
  try {
    const { data: row } = await db
      .from('market_data_cache')
      .select('value, fetched_at, valid_until')
      .eq('key', cacheKey)
      .single();

    if (row?.value && row.valid_until) {
      const validUntil = new Date(row.valid_until).getTime();
      if (Date.now() < validUntil) {
        const cached = typeof row.value === 'string' ? JSON.parse(row.value) : row.value;
        return res.status(200).json({ ...cached, cached: true, cachedAt: row.fetched_at });
      }
    }
  } catch { /* cache miss — proceed to fetch */ }

  // ── 2. Fetch from FEMA ────────────────────────────────────────────────────
  const result = await fetchFloodRisk(resolvedLat, resolvedLng);

  if (!result) {
    return res.status(200).json({
      zone:        'unknown',
      riskLevel:   'unknown',
      label:       'Data unavailable',
      note:        'FEMA flood data could not be retrieved for this location.',
      source:      'FEMA NFHL',
      cached:      false,
    });
  }

  // ── 3. Write to cache ─────────────────────────────────────────────────────
  try {
    const validUntil = new Date(Date.now() + CACHE_TTL_DAYS * 86400 * 1000).toISOString();
    await db.from('market_data_cache').upsert({
      key:         cacheKey,
      value:       JSON.stringify(result),
      fetched_at:  new Date().toISOString(),
      valid_until: validUntil,
    }, { onConflict: 'key' });
  } catch (e) {
    console.warn('[flood-risk] Cache write failed (non-fatal):', e.message);
  }

  return res.status(200).json({ ...result, cached: false });
}
