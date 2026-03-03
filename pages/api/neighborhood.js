// /api/neighborhood - enriches a property address with real neighborhood data
// Sources: Census Geocoder (geocoding), Census ACS 5yr (demographics), OSM Overpass (amenities),
//          Redfin weekly ZIP tracker (market pulse), FRED Case-Shiller (price trends)
// All primary sources are free, no API keys required.
// POST { address, city, state?, zip? } → { lat, lng, zip, medianIncome, population,
//   medianRent, medianHomeValue, vacancyRate, priceToRentRatio,
//   marketPulse, priceHistory,
//   amenities, amenityScore, walkability, censusYear }

import { rateLimitWithAuth }                          from '../../lib/rateLimit.js';
import { fetchZipEnrichment }                          from '../../lib/censusFetcher.js';
import { getRedfinData, getCaseShillerData }           from '../../lib/marketData.js';
import { getCaseShillerKey }                           from '../../lib/caseShillerFetcher.js';
import { getSupabaseAdmin }                            from '../../lib/supabase.js';

export const config = { api: { bodyParser: true }, maxDuration: 20 };

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const CENSUS_GEO   = 'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress';
const CENSUS_ACS   = 'https://api.census.gov/data/2023/acs/acs5';

// -- Helpers --------------------------------------------------------------------

async function geocode(addressStr) {
  const url = `${CENSUS_GEO}?address=${encodeURIComponent(addressStr)}&benchmark=Public_AR_Current&format=json`;
  const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
  if (!r.ok) return null;
  const body = await r.json();
  const match = body?.result?.addressMatches?.[0];
  if (!match) return null;
  return {
    lat: parseFloat(match.coordinates.y),
    lng: parseFloat(match.coordinates.x),
    zip: match.addressComponents?.zip || null,
    state: match.addressComponents?.state || null,
  };
}

async function getCensusData(zip) {
  if (!zip) return null;
  // B19013_001E = median household income
  // B01003_001E = total population
  // B25058_001E = median contract rent
  // B25077_001E = median value of owner-occupied housing units (for P/R ratio)
  const url = `${CENSUS_ACS}?get=B19013_001E,B01003_001E,B25058_001E,B25077_001E&for=zip+code+tabulation+area:${zip}`;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!r.ok) return null;
    const rows = await r.json();
    if (!rows?.[1]) return null;
    const [income, pop, rent, homeValue] = rows[1];
    return {
      medianIncome:    parseInt(income)    > 0 ? parseInt(income)    : null,
      population:      parseInt(pop)       > 0 ? parseInt(pop)       : null,
      medianRent:      parseInt(rent)      > 0 ? parseInt(rent)      : null,
      medianHomeValue: parseInt(homeValue) > 0 ? parseInt(homeValue) : null,
    };
  } catch { return null; }
}

async function getOSMAmenities(lat, lng) {
  // 0.5 mile ≈ 800m radius
  const r = 800;

  // Single query - return all matching nodes with tags, count by category in JS.
  // Capped at 300 nodes (out tags qt 300) to bound response size in dense cities.
  const query = `
[out:json][timeout:12];
(
  node["shop"~"supermarket|grocery|convenience"](around:${r},${lat},${lng});
  node["amenity"~"subway_entrance|restaurant|cafe|fast_food|school"](around:${r},${lat},${lng});
  node["highway"="bus_stop"](around:${r},${lat},${lng});
  node["railway"~"station|halt"](around:${r},${lat},${lng});
  node["leisure"="park"](around:${r},${lat},${lng});
);
out tags qt 300;`;

  try {
    const res = await fetch(OVERPASS_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    `data=${encodeURIComponent(query)}`,
      signal:  AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const body = await res.json();
    const elements = body?.elements || [];

    // Count by category using tag values
    const grocery     = elements.filter(e => /supermarket|grocery/.test(e.tags?.shop || '')).length;
    const transit     = elements.filter(e =>
      e.tags?.highway === 'bus_stop' ||
      /station|halt/.test(e.tags?.railway || '') ||
      e.tags?.amenity === 'subway_entrance'
    ).length;
    const restaurants = elements.filter(e => /restaurant|cafe|fast_food/.test(e.tags?.amenity || '')).length;
    const parks       = elements.filter(e => e.tags?.leisure === 'park').length;
    const schools     = elements.filter(e => e.tags?.amenity === 'school').length;
    const total       = elements.length;

    return { total, grocery, transit, restaurants, parks, schools };
  } catch { return null; }
}

function computeAmenityScore(amenities) {
  if (!amenities) return null;
  // Weighted scoring out of 10
  const g = Math.min(amenities.grocery     || 0, 5)  * 0.8;   // grocery: up to 4 pts
  const t = Math.min(amenities.transit     || 0, 10) * 0.2;   // transit: up to 2 pts
  const f = Math.min(amenities.restaurants || 0, 15) * 0.13;  // food: up to ~2 pts
  const p = Math.min(amenities.parks       || 0, 5)  * 0.2;   // parks: up to 1 pt
  const s = Math.min(amenities.schools     || 0, 5)  * 0.2;   // schools: up to 1 pt
  return Math.min(Math.round((g + t + f + p + s) * 10) / 10, 10);
}

function classifyWalkability(amenities, population) {
  if (!amenities) return 'Unknown';
  const total = amenities.total || 0;
  const popDensity = population ? population / 10 : 0; // rough proxy
  if (total >= 30 || popDensity > 5000) return 'Urban';
  if (total >= 10 || popDensity > 1000) return 'Suburban';
  return 'Rural / Car-dependent';
}

// -- Main handler ---------------------------------------------------------------

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  // Rate limit - prevents hammering Census/OSM with automated requests
  if (!rateLimitWithAuth(req, false, { anonMax: 20, authedMax: 40, windowMs: 60_000 })) {
    return res.status(429).json({ error: 'Too many requests. Please wait a minute.' });
  }

  const { address, city, state, zip } = req.body || {};
  const db = getSupabaseAdmin();
  if (!address && !zip) return res.status(400).json({ error: 'address or zip required' });

  const addressStr = [address, city, state, zip].filter(Boolean).join(', ');

  try {
    // Step 1: Geocode - get lat/lng/zip
    let geo = null;
    if (addressStr) {
      geo = await geocode(addressStr);
    }

    // If geocode failed but we have a zip, still try census
    const resolvedZip = geo?.zip || zip || null;

    // Case-Shiller metro key for this city (null if no CS coverage)
    const csMetroKey = city ? getCaseShillerKey(city) : null;

    // Steps 2–6: run all data sources in parallel
    const [censusData, osmAmenities, zipEnrichment, redfinCache, caseShillerCache] =
      await Promise.allSettled([
        getCensusData(resolvedZip),
        geo ? getOSMAmenities(geo.lat, geo.lng) : Promise.resolve(null),
        resolvedZip ? fetchZipEnrichment(resolvedZip) : Promise.resolve(null),
        // Redfin and Case-Shiller are read from Supabase cache (populated by cron)
        // They are never fetched live here — fast cache reads only
        resolvedZip ? getRedfinData(db, resolvedZip) : Promise.resolve(null),
        csMetroKey  ? getCaseShillerData(db, csMetroKey) : Promise.resolve(null),
      ]);

    const census       = censusData.status      === 'fulfilled' ? censusData.value      : null;
    const amenities    = osmAmenities.status    === 'fulfilled' ? osmAmenities.value    : null;
    const enrichment   = zipEnrichment.status   === 'fulfilled' ? zipEnrichment.value   : null;
    const redfinData   = redfinCache.status     === 'fulfilled' ? redfinCache.value     : null;
    const caseShiller  = caseShillerCache.status === 'fulfilled' ? caseShillerCache.value : null;

    const amenityScore = computeAmenityScore(amenities);
    const walkability  = classifyWalkability(amenities, census?.population);

    // Median home value: prefer getCensusData result (same ACS vintage);
    // enrichment.medianHomeValue is a fallback if getCensusData didn't return it.
    const medianHomeValue =
      census?.medianHomeValue ??
      enrichment?.medianHomeValue?.value ??
      null;

    // Vacancy rate from ACS B25004/B25001 via censusFetcher (batched ZIP call)
    const vacancyRateData = enrichment?.vacancyRate ?? null;

    // Price-to-rent ratio: medianHomeValue / (medianRent * 12)
    // National average P/R is ~20–25. Below 15 = cash flow market. Above 30 = appreciation play.
    const priceToRentRatio =
      medianHomeValue && census?.medianRent && census.medianRent > 0
        ? Math.round(medianHomeValue / (census.medianRent * 12))
        : null;

    const result = {
      lat:          geo?.lat  ?? null,
      lng:          geo?.lng  ?? null,
      zip:          resolvedZip,
      state:        geo?.state ?? null,
      medianIncome: census?.medianIncome ?? null,
      population:   census?.population  ?? null,
      medianRent:   census?.medianRent  ?? null,

      // Phase 2 additions ──────────────────────────────────────────────────────
      // Median owner-occupied home value (ACS B25077) — used for P/R ratio
      medianHomeValue,

      // Vacancy rate (ACS B25004/B25001) — replaces hardcoded mode defaults
      // null = data suppressed for this ZIP (too few units) or Census unavailable
      vacancyRate: vacancyRateData
        ? {
            rate:   vacancyRateData.rate,   // percentage e.g. 7.4
            total:  vacancyRateData.total,  // total housing units
            vacant: vacancyRateData.vacant, // vacant units
            asOf:   vacancyRateData.asOf,   // ACS vintage year
          }
        : null,

      // Price-to-rent ratio — computed from ACS data, no additional API call
      priceToRentRatio,
      // ────────────────────────────────────────────────────────────────────────

      // Phase 3 additions ──────────────────────────────────────────────────────

      // Redfin market pulse (from cache — populated by weekly cron)
      // null = ZIP not yet cached (cron hasn't run for this ZIP, or ZIP not in Redfin data)
      marketPulse: redfinData
        ? {
            dom:            redfinData.dom,           // median days on market
            saleToList:     redfinData.saleToList,    // e.g. 1.02 = 2% over list
            medianSalePrice: redfinData.medianSalePrice,
            homesSold:      redfinData.homesSold,
            inventory:      redfinData.inventory,
            marketTemp:     redfinData.marketTemp,    // "hot"|"warm"|"neutral"|"cool"|"cold"
            asOf:           redfinData.asOf,
          }
        : null,

      // Case-Shiller price trend history (from cache — populated by monthly cron)
      // null = metro not covered or not yet cached
      priceHistory: caseShiller
        ? {
            metro:    caseShiller.metro,
            yoyPct:   caseShiller.yoyPct,
            cagr3yr:  caseShiller.cagr3yr,
            cagr5yr:  caseShiller.cagr5yr,
            trend:    caseShiller.trend,      // "accelerating"|"stable"|"decelerating"
            current:  caseShiller.current,    // latest index value
            prev1yr:  caseShiller.prev1yr,
            asOf:     caseShiller.asOf,
          }
        : null,
      // ────────────────────────────────────────────────────────────────────────

      amenities,
      amenityScore,
      walkability,
      censusYear: 2023,
      partial: !geo || !census || !amenities, // true if any primary source failed
    };

    // Cache for 7 days - neighborhood data doesn't change often
    res.setHeader('Cache-Control', 'public, max-age=604800, s-maxage=604800');
    return res.status(200).json(result);

  } catch (err) {
    console.error('Neighborhood API error:', err);
    return res.status(500).json({ error: 'Could not fetch neighborhood data.' });
  }
}

