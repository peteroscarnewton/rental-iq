/**
 * lib/rentControlFetcher.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Live rent control database fetcher using NLIHC + Eviction Lab policy APIs.
 *
 * Sources (all free, no API key required):
 *
 *   Primary: NLIHC Renter Protections Database
 *     - URL: https://nlihc.org/research/renter-protections-database
 *     - Covers all cities/counties with active rent stabilization ordinances
 *     - Updated by NLIHC researchers as laws change
 *
 *   Secondary: Eviction Lab Policy Scorecard
 *     - URL: https://evictionlab.org/policy-scorecard/
 *     - Structured data on renter protections including rent stabilization
 *
 *   Fallback: Static cityRentControlDb.js (never breaks)
 *
 * Cache key: rent_control_db (full object keyed by city slug)
 * TTL: 30 days (rent control laws can change quickly)
 *
 * @module rentControlFetcher
 */

import { CITY_RENT_CONTROL } from './cityRentControlDb.js';

const NLIHC_URL = 'https://nlihc.org/research/renter-protections-database';
const EVICTION_LAB_SCORECARD_URL = 'https://evictionlab.org/policy-scorecard/';

/**
 * Parse NLIHC renter protections page for active rent control cities.
 * Returns Map<city_slug, { active: boolean, cap: number|null }> or null.
 */
async function fetchNlihcRentControl() {
  try {
    const r = await fetch(NLIHC_URL, {
      headers: { 'User-Agent': 'RentalIQ/1.0', 'Accept': 'text/html' },
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) return null;
    const html = await r.text();

    // NLIHC typically lists cities with active protections in a table or list
    // Look for patterns: city name near "rent control" or "rent stabilization"
    const controlMap = new Map();

    // Cities we track — check if each appears near rent control language
    const trackedCities = Object.keys(CITY_RENT_CONTROL);
    for (const slug of trackedCities) {
      const { city, state } = CITY_RENT_CONTROL[slug] || {};
      if (!city) continue;

      const escaped = city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // Look for the city name within 300 chars of rent control/stabilization terms
      const activePattern = new RegExp(
        `${escaped}.{0,300}(rent.{0,20}(control|stabiliz)|stabiliz.{0,20}rent)|` +
        `(rent.{0,20}(control|stabiliz)|stabiliz.{0,20}rent).{0,300}${escaped}`,
        'i'
      );
      // Look for repeal/ended patterns
      const repealPattern = new RegExp(`${escaped}.{0,200}(repeal|ended|expired|eliminated)`, 'i');

      if (activePattern.test(html)) {
        controlMap.set(slug, { active: true, source: 'NLIHC' });
      }
      if (repealPattern.test(html)) {
        controlMap.set(slug, { active: false, source: 'NLIHC' });
      }
    }

    if (controlMap.size === 0) return null;
    return { controlMap, asOf: new Date().toISOString().slice(0, 7) };
  } catch (err) {
    console.warn('[rentControlFetcher] NLIHC fetch failed:', err.message);
    return null;
  }
}

/**
 * Fetch Eviction Lab policy scorecard for cities.
 * Returns structured protection data or null.
 */
async function fetchEvictionLabScorecard() {
  try {
    const r = await fetch(EVICTION_LAB_SCORECARD_URL, {
      headers: { 'User-Agent': 'RentalIQ/1.0', 'Accept': 'text/html' },
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) return null;
    const html = await r.text();

    // Look for JSON-LD or embedded data objects in the page
    const jsonMatch = html.match(/<script[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/i)
      || html.match(/window\.__NEXT_DATA__\s*=\s*(\{[\s\S]*?\});\s*<\/script>/i);

    if (!jsonMatch) return null;

    try {
      const data = JSON.parse(jsonMatch[1]);
      // Flatten the data structure to find rent stabilization policies
      const flat = JSON.stringify(data);
      const rentControlCities = new Set();
      const trackedCities = Object.keys(CITY_RENT_CONTROL);

      for (const slug of trackedCities) {
        const { city } = CITY_RENT_CONTROL[slug] || {};
        if (!city) continue;
        if (flat.toLowerCase().includes(city.toLowerCase()) &&
            (flat.includes('rent_stabilization') || flat.includes('rent_control'))) {
          rentControlCities.add(slug);
        }
      }
      if (rentControlCities.size > 0) {
        return { rentControlCities, asOf: new Date().toISOString().slice(0, 7) };
      }
    } catch {}

    return null;
  } catch (err) {
    console.warn('[rentControlFetcher] Eviction Lab scorecard failed:', err.message);
    return null;
  }
}

/**
 * Fetches updated rent control database.
 * Merges live NLIHC + Eviction Lab data with the static baseline.
 *
 * @returns {Promise<Object|null>} Updated rent control data keyed by city slug, or null
 */
export async function fetchRentControlData() {
  try {
    const updated = {};
    // Deep-clone the static baseline
    for (const [key, val] of Object.entries(CITY_RENT_CONTROL)) {
      updated[key] = { ...val };
    }

    let liveUpdates = 0;

    // Fetch from both sources in parallel
    const [nlihcData, evictionLabData] = await Promise.allSettled([
      fetchNlihcRentControl(),
      fetchEvictionLabScorecard(),
    ]);

    // Apply NLIHC updates
    if (nlihcData.status === 'fulfilled' && nlihcData.value?.controlMap) {
      for (const [slug, update] of nlihcData.value.controlMap) {
        if (!updated[slug]) continue;
        if (update.active === false && updated[slug].status === 'active') {
          // Rent control was repealed
          updated[slug] = {
            ...updated[slug],
            status: 'repealed',
            _source: 'NLIHC (live)',
            _asOf: nlihcData.value.asOf,
          };
          liveUpdates++;
        } else if (update.active === true) {
          updated[slug]._confirmedActive = nlihcData.value.asOf;
          updated[slug]._source = 'NLIHC (live)';
        }
      }
    }

    // Apply Eviction Lab updates (lower weight — just confirms existence)
    if (evictionLabData.status === 'fulfilled' && evictionLabData.value?.rentControlCities) {
      for (const slug of evictionLabData.value.rentControlCities) {
        if (updated[slug]) {
          updated[slug]._confirmedByEvictionLab = evictionLabData.value.asOf;
        }
      }
    }

    console.log(`[rentControlFetcher] ${liveUpdates} rent control status updates`);

    return {
      ...updated,
      _fetchedAt: new Date().toISOString(),
      _source: `Static baseline + NLIHC + Eviction Lab (${liveUpdates} live updates)`,
    };
  } catch (err) {
    console.warn('[rentControlFetcher] Fatal error:', err.message);
    return null;
  }
}
