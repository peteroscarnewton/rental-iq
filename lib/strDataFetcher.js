/**
 * lib/strDataFetcher.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Phase 8 — Item 16: Short-Term Rental (STR) income potential by city.
 *
 * Source: Inside Airbnb (http://insideairbnb.com/get-the-data/)
 *   - Publishes city-level summary CSV files derived from Airbnb listings
 *   - Free for non-commercial use; research/analysis use permitted
 *   - Updated 1-4x per year per city
 *
 * We use the public city summary data to derive:
 *   - Estimated annual STR revenue for a given bedroom count
 *   - Average nightly rate
 *   - Estimated annual occupancy rate
 *   - STR vs LTR income comparison
 *   - Regulatory risk flag (cities with known STR bans/restrictions)
 *
 * Data flow:
 *   1. fetchStrData(city) fetches the city's listings CSV from Inside Airbnb CDN
 *   2. Processes the CSV to compute median revenue/occupancy/nightly rate by bedrooms
 *   3. Results cached in Supabase for 90 days (str_data:{city_slug})
 *
 * STR regulatory context (static, updated when laws change):
 *   Many cities restrict or ban STRs. This is critical investor context.
 *   Source: National Multifamily Housing Council STR preemption tracker + city codes.
 *
 * @module strDataFetcher
 */

// ─── City slug mapping (Inside Airbnb uses specific city slugs in URLs) ───────
// Format: city_state → Inside Airbnb slug (used in URL construction)
const CITY_SLUGS = {
  'new_york_ny':          'new-york-city',
  'los_angeles_ca':       'los-angeles',
  'san_francisco_ca':     'san-francisco',
  'seattle_wa':           'seattle',
  'chicago_il':           'chicago',
  'boston_ma':            'boston',
  'washington_dc':        'washington-dc',
  'austin_tx':            'austin',
  'denver_co':            'denver',
  'portland_or':          'portland',
  'nashville_tn':         'nashville',
  'miami_fl':             'miami',
  'orlando_fl':           'orlando',
  'new_orleans_la':       'new-orleans',
  'san_diego_ca':         'san-diego',
  'oakland_ca':           'oakland',
  'santa_cruz_ca':        'santa-cruz-county',
  'asheville_nc':         'asheville',
  'hawaii_hi':            'hawaii',
  'jersey_city_nj':       'jersey-city',
  'cambridge_ma':         'cambridge',
  'broward_county_fl':    'broward-county',
  'twin_cities_mn':       'twin-cities-msa',
  'columbus_oh':          'columbus',
  'fort_worth_tx':        'fort-worth',
};

// ─── STR Regulatory Risk Database ─────────────────────────────────────────────
// Cities with significant STR restrictions that affect investor viability.
// Source: NMHC STR preemption tracker + city code research, 2025-Q1.
// Status: 'banned' | 'restricted' | 'licensed' | 'permissive'
const STR_REGULATIONS = {
  'new_york_ny': {
    status: 'banned',
    detail: 'Local Law 18 (eff. Sep 2023): No STR allowed without host present. Effectively bans Airbnb-style investment STRs.',
    permitRequired: true,
    ownerOccupied: true, // must be present during stay
    maxGuests: 2,
    source: 'NYC Local Law 18 (2023)',
  },
  'san_francisco_ca': {
    status: 'restricted',
    detail: 'Host must be primary resident. 90-night cap for unhosted (whole-home) rentals. Permit required.',
    permitRequired: true,
    ownerOccupied: true,
    nightCap: 90,
    source: 'SF Planning Code §41A',
  },
  'los_angeles_ca': {
    status: 'restricted',
    detail: 'Host registration required. Primary residence only (>6 months/yr occupancy). 120-night unhosted cap.',
    permitRequired: true,
    ownerOccupied: true,
    nightCap: 120,
    source: 'LA Home-Sharing Ordinance (2019)',
  },
  'boston_ma': {
    status: 'restricted',
    detail: 'Primary/limited-share registration. No investment units allowed. Owner-occupancy required.',
    permitRequired: true,
    ownerOccupied: true,
    source: 'Boston STR Ordinance (2019)',
  },
  'chicago_il': {
    status: 'licensed',
    detail: 'Shared housing license required. Investment units allowed. Annual renewal. Some zoning restrictions.',
    permitRequired: true,
    ownerOccupied: false,
    source: 'Chicago Shared Housing Ordinance',
  },
  'seattle_wa': {
    status: 'licensed',
    detail: 'Operator license required. Up to 2 STRs per operator (1 must be primary residence). Inspections required.',
    permitRequired: true,
    ownerOccupied: false, // second unit allowed
    maxUnits: 2,
    source: 'Seattle STR Licensing (2018)',
  },
  'denver_co': {
    status: 'licensed',
    detail: 'License required. Primary residence only for most zones. Investment STRs restricted to commercial zones.',
    permitRequired: true,
    ownerOccupied: true,
    source: 'Denver STR License (2016)',
  },
  'miami_fl': {
    status: 'permissive',
    detail: 'Miami-Dade allows STRs with license. No owner-occupancy requirement in most areas. Miami Beach more restrictive.',
    permitRequired: true,
    ownerOccupied: false,
    source: 'Miami-Dade STR Ordinance',
  },
  'orlando_fl': {
    status: 'permissive',
    detail: 'STR allowed with license. Major tourist market. Investor-friendly — no primary residence requirement.',
    permitRequired: true,
    ownerOccupied: false,
    source: 'Orlando STR Ordinance',
  },
  'nashville_tn': {
    status: 'restricted',
    detail: 'Non-owner-occupied permits frozen since 2021. Owner-occupied (Type 2) permits still available with restrictions.',
    permitRequired: true,
    ownerOccupied: true, // investment permits frozen
    source: 'Nashville STR Ordinance + 2021 freeze on non-owner permits',
  },
  'austin_tx': {
    status: 'licensed',
    detail: 'Type 1 (owner-occupied) and Type 2 (investor) licenses available. Annual renewal. Some zoning caps.',
    permitRequired: true,
    ownerOccupied: false,
    source: 'Austin Land Development Code §25-2-788',
  },
  'new_orleans_la': {
    status: 'restricted',
    detail: 'Homestead exemption required for residential STRs. Commercial STRs phased out. Very limited permits.',
    permitRequired: true,
    ownerOccupied: true,
    source: "New Orleans STR Ordinance (Revised 2019)",
  },
};

/**
 * Normalizes a city string to a regulatory lookup key.
 * @param {string} city - "Austin, TX"
 * @returns {string} key like "austin_tx"
 */
function cityToRegKey(city) {
  if (!city) return '';
  const cityName = city.split(',')[0].trim().toLowerCase().replace(/\s+/g, '_');
  const stateMatch = city.toUpperCase().match(/,\s*([A-Z]{2})$/);
  const state = stateMatch ? stateMatch[1].toLowerCase() : '';
  return state ? `${cityName}_${state}` : cityName;
}

/**
 * Returns STR regulatory status for a city.
 * @param {string} city - "Austin, TX"
 * @returns {Object|null}
 */
export function getStrRegulation(city) {
  const key = cityToRegKey(city);
  if (!key) return null;
  // Try exact match, then city-only match
  if (STR_REGULATIONS[key]) return STR_REGULATIONS[key];
  for (const [k, v] of Object.entries(STR_REGULATIONS)) {
    if (k.startsWith(key.split('_')[0])) return v;
  }
  return null;
}

/**
 * Resolves the Inside Airbnb city slug for a given city string.
 * @param {string} city - "Austin, TX"
 * @returns {string|null} slug or null if not covered
 */
function getCitySlug(city) {
  const key = cityToRegKey(city);
  return CITY_SLUGS[key] || null;
}

// ─── Known-good Inside Airbnb date slugs (fallback if discovery fails) ─────────
// Inside Airbnb publishes new snapshots roughly quarterly per city.
// These are the last known dates as of early 2025; discovery below finds newer ones.
// Format: YYYY-MM-DD matching Inside Airbnb's CDN path segment.
const KNOWN_DATE_SLUGS = [
  '2025-03-14', '2025-01-06', '2024-12-16', '2024-09-13', '2024-06-05', '2024-03-23',
];

/**
 * Discovers the latest available Inside Airbnb date slug for a city by fetching
 * the city's index page and scraping available dataset links.
 *
 * Inside Airbnb hosts an HTML index at:
 *   http://data.insideairbnb.com/united-states/{state}/{city}/
 * which lists all available snapshot dates as links.
 *
 * Falls back to KNOWN_DATE_SLUGS if discovery fails or times out.
 *
 * @param {string} baseUrl - e.g. "http://data.insideairbnb.com/united-states"
 * @param {string} stateSlug - e.g. "texas"
 * @param {string} citySlug  - e.g. "austin"
 * @returns {Promise<string[]>} date slugs to try, most recent first
 */
async function discoverDateSlugs(baseUrl, stateSlug, citySlug) {
  try {
    const indexUrl = `${baseUrl}/${stateSlug}/${citySlug}/`;
    const r = await fetch(indexUrl, {
      headers: { 'User-Agent': 'RentalIQ/1.0 (investment research)' },
      signal: AbortSignal.timeout(6000),
    });
    if (!r.ok) return KNOWN_DATE_SLUGS;

    const html = await r.text();
    // Extract date slugs from href links: href="2025-03-14/" or href="/.../.../2025-03-14/"
    const matches = [...html.matchAll(/href="(?:[^"]*\/)?(20\d\d-\d\d-\d\d)\/?"/g)];
    if (!matches.length) return KNOWN_DATE_SLUGS;

    // De-dup, sort descending (most recent first), merge with known list
    const discovered = [...new Set(matches.map(m => m[1]))].sort().reverse();
    // Prepend discovered dates before the known fallbacks (de-duped)
    const merged = [...new Set([...discovered, ...KNOWN_DATE_SLUGS])];
    return merged.length ? merged : KNOWN_DATE_SLUGS;
  } catch {
    return KNOWN_DATE_SLUGS;
  }
}

/**
 * Fetches STR market data for a city from Inside Airbnb.
 * Parses the listings summary CSV to compute revenue / occupancy estimates.
 *
 * Date discovery: fetches the city's Inside Airbnb index page to find the
 * latest available snapshot date dynamically, so data stays current as
 * Inside Airbnb publishes new quarterly datasets.
 *
 * @param {string} city - "Austin, TX"
 * @param {number} beds - bedroom count (1-4)
 * @returns {Promise<StrDataResult|null>}
 */
export async function fetchStrData(city, beds = 2) {
  const slug = getCitySlug(city);
  if (!slug) return buildStrEstimate(city, beds, null);

  const bedsNum = Math.min(Math.max(parseInt(beds) || 2, 1), 5);

  try {
    // Inside Airbnb CDN structure:
    //   http://data.insideairbnb.com/{country}/{state}/{city}/{date}/visualisations/listings.csv
    // The listings.csv (visualisations version) is ~500KB and has the fields we need.
    const baseUrl = `http://data.insideairbnb.com/united-states`;

    // State slug from city
    const stateMatch = city.toUpperCase().match(/,\s*([A-Z]{2})$/);
    const stateCode = stateMatch?.[1]?.toLowerCase() || '';
    const stateSlugMap = {
      ny:'new-york', ca:'california', il:'illinois', wa:'washington', ma:'massachusetts',
      dc:'district-of-columbia', tx:'texas', co:'colorado', or:'oregon', tn:'tennessee',
      fl:'florida', la:'louisiana', oh:'ohio', nc:'north-carolina', mn:'minnesota',
    };
    const stateSlug = stateSlugMap[stateCode];
    if (!stateSlug) return buildStrEstimate(city, bedsNum, null);

    // Discover available dates dynamically (falls back to KNOWN_DATE_SLUGS on failure)
    const dateSuffixes = await discoverDateSlugs(baseUrl, stateSlug, slug);

    let csv = null;
    let usedDate = null;
    for (const dateSuffix of dateSuffixes) {
      const url = `${baseUrl}/${stateSlug}/${slug}/${dateSuffix}/visualisations/listings.csv`;
      try {
        const r = await fetch(url, {
          headers: { 'User-Agent': 'RentalIQ/1.0 (investment research)' },
          signal: AbortSignal.timeout(10000),
        });
        if (r.ok) { csv = await r.text(); usedDate = dateSuffix; break; }
      } catch { continue; }
    }

    if (!csv) return buildStrEstimate(city, bedsNum, null);

    return parseInsideAirbnbCsv(csv, city, bedsNum, usedDate);
  } catch (err) {
    console.warn(`[strDataFetcher] Inside Airbnb fetch failed for ${city}:`, err.message);
    return buildStrEstimate(city, bedsNum, null);
  }
}

/**
 * Minimal RFC 4180-compliant CSV row parser that correctly handles quoted fields
 * containing commas, escaped quotes, and dollar amounts like "$1,500".
 * @param {string} line - a single CSV row
 * @returns {string[]} array of field values with surrounding quotes stripped
 */
function parseCsvRow(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { current += '"'; i++; } // escaped quote
        else inQuotes = false;
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') { inQuotes = true; }
      else if (ch === ',') { fields.push(current); current = ''; }
      else { current += ch; }
    }
  }
  fields.push(current);
  return fields;
}

/**
 * Parses Inside Airbnb listings CSV to extract per-bedroom revenue estimates.
 * @param {string} usedDate - the date slug that was successfully fetched (e.g. "2025-03-14")
 */
function parseInsideAirbnbCsv(csv, city, beds, usedDate) {
  try {
    const lines = csv.trim().split('\n');
    if (lines.length < 10) return buildStrEstimate(city, beds, null);

    const headers = parseCsvRow(lines[0]).map(h => h.trim().toLowerCase());
    const priceIdx    = headers.indexOf('price');
    const bedsIdx     = headers.indexOf('bedrooms');
    const availIdx    = headers.indexOf('availability_365');
    const reviewsIdx  = headers.indexOf('reviews_per_month');
    const roomTypeIdx = headers.indexOf('room_type');

    if (priceIdx < 0 || bedsIdx < 0) return buildStrEstimate(city, beds, null);

    const matchingListings = [];

    for (let i = 1; i < Math.min(lines.length, 5000); i++) {
      const cols = parseCsvRow(lines[i]);
      if (cols.length <= Math.max(priceIdx, bedsIdx)) continue;

      const bedsVal = parseInt(cols[bedsIdx]);
      if (isNaN(bedsVal) || bedsVal !== beds) continue;

      const roomType = (cols[roomTypeIdx] || '').toLowerCase();
      // Only "Entire home/apt" for investment analysis
      if (!roomType.includes('entire')) continue;

      // Strip currency symbols and commas (handles "$1,500" format correctly)
      const rawPrice = cols[priceIdx].replace(/[^0-9.]/g, '');
      const price = parseFloat(rawPrice);
      if (isNaN(price) || price < 30 || price > 2000) continue;

      const avail   = availIdx >= 0   ? parseInt(cols[availIdx])       : null;
      const reviews = reviewsIdx >= 0 ? parseFloat(cols[reviewsIdx])   : null;

      matchingListings.push({ price, avail, reviews });
    }

    if (matchingListings.length < 5) return buildStrEstimate(city, beds, null);

    // Sort and remove outliers (p10–p90)
    const prices = matchingListings.map(l => l.price).sort((a, b) => a - b);
    const p10 = prices[Math.floor(prices.length * 0.10)];
    const p90 = prices[Math.floor(prices.length * 0.90)];
    const filtered = matchingListings.filter(l => l.price >= p10 && l.price <= p90);

    const medianPrice = filtered[Math.floor(filtered.length / 2)]?.price
      || prices[Math.floor(prices.length / 2)];

    // Estimate occupancy from reviews_per_month * conversion factor.
    // Industry standard: ~1 review per 3-5 stays; avg 3-night stay.
    // Base rates by bedroom: 1BR ~58%, 2BR ~52%, 3BR+ ~46%.
    const baseOccupancy = beds <= 1 ? 0.58 : beds <= 2 ? 0.52 : 0.46;
    const reviewBasedOcc = filtered.reduce((sum, l) => {
      if (l.reviews && l.reviews > 0) {
        // reviews/mo × 4 nights avg × 12 months / 365 ≈ fraction occupied
        return sum + Math.min((l.reviews * 4 * 12) / 365, 0.85);
      }
      return sum + baseOccupancy;
    }, 0) / filtered.length;

    // occupancy is a decimal fraction (0.0–1.0)
    const occupancy = Math.round(Math.min(Math.max(reviewBasedOcc, 0.30), 0.80) * 100) / 100;
    const nightlyRate = Math.round(medianPrice);
    // annualRevenue: nightly × days × occupancy_fraction — occupancy is already decimal, no /100
    const annualRevenue = Math.round((nightlyRate * 365 * occupancy) / 100) * 100;

    return {
      city,
      beds,
      nightlyRate,
      occupancyRate: occupancy,
      annualRevenue,
      listingCount: matchingListings.length,
      source: 'Inside Airbnb (computed from listings data)',
      asOf: usedDate || new Date().toISOString().slice(0, 7),
      note: `Median nightly rate $${nightlyRate}/night at ${Math.round(occupancy * 100)}% occupancy = ~$${annualRevenue.toLocaleString()}/yr gross STR revenue for ${beds}BR.`,
    };
  } catch (err) {
    console.warn('[strDataFetcher] CSV parse error:', err.message);
    return buildStrEstimate(city, beds, null);
  }
}

// ── STR Fallback by Metro (when Inside Airbnb data unavailable) ──────────────
// Based on AirDNA/Mashvisor published market averages for 2024.
// These are rough benchmarks, not precise forecasts.
const STR_FALLBACK_BY_METRO = {
  // High-demand tourist/urban markets
  'new york':      { nightly: 185, occupancy: 0.62 },
  'san francisco': { nightly: 195, occupancy: 0.58 },
  'los angeles':   { nightly: 175, occupancy: 0.60 },
  'miami':         { nightly: 195, occupancy: 0.65 },
  'new orleans':   { nightly: 175, occupancy: 0.68 },
  'nashville':     { nightly: 195, occupancy: 0.70 },
  'austin':        { nightly: 165, occupancy: 0.62 },
  'chicago':       { nightly: 145, occupancy: 0.58 },
  'boston':        { nightly: 185, occupancy: 0.62 },
  'washington':    { nightly: 165, occupancy: 0.62 },
  'seattle':       { nightly: 155, occupancy: 0.58 },
  'denver':        { nightly: 145, occupancy: 0.60 },
  'portland':      { nightly: 135, occupancy: 0.58 },
  'san diego':     { nightly: 185, occupancy: 0.65 },
  'orlando':       { nightly: 195, occupancy: 0.72 },
  'phoenix':       { nightly: 145, occupancy: 0.58 },
  'las vegas':     { nightly: 145, occupancy: 0.60 },
  // Beach / resort markets
  'honolulu':      { nightly: 245, occupancy: 0.70 },
  // National average fallback
  '_national':     { nightly: 135, occupancy: 0.55 },
};

/**
 * Builds an STR estimate from fallback data when live data is unavailable.
 */
function buildStrEstimate(city, beds, _liveData) {
  const cityName = (city || '').split(',')[0].trim().toLowerCase();
  let match = STR_FALLBACK_BY_METRO[cityName];
  if (!match) {
    for (const [key, val] of Object.entries(STR_FALLBACK_BY_METRO)) {
      if (key !== '_national' && (cityName.includes(key) || key.includes(cityName.split(' ')[0]))) {
        match = val; break;
      }
    }
  }
  if (!match) match = STR_FALLBACK_BY_METRO._national;

  // Bedroom multiplier: 1BR = 0.75x, 2BR = 1.0x, 3BR = 1.4x, 4BR = 1.8x
  const bedsNum = Math.min(Math.max(parseInt(beds) || 2, 1), 4);
  const bedsMultiplier = [0, 0.75, 1.0, 1.4, 1.8][bedsNum] || 1.0;

  const nightlyRate = Math.round(match.nightly * bedsMultiplier / 5) * 5;
  const occupancy   = match.occupancy;
  // annualRevenue: nightly × days × occupancy_fraction — occupancy is already decimal, no /100
  const annualRevenue = Math.round((nightlyRate * 365 * occupancy) / 100) * 100;

  return {
    city,
    beds: bedsNum,
    nightlyRate,
    occupancyRate: occupancy,
    annualRevenue,
    listingCount: null,
    source: 'Market estimate (AirDNA/Mashvisor 2024 benchmarks)',
    asOf: '2024',
    estimated: true,
    note: `Estimated ${bedsNum}BR STR: ~$${nightlyRate}/night at ${Math.round(occupancy*100)}% occupancy = ~$${annualRevenue.toLocaleString()}/yr gross revenue. Verify with local AirDNA/Rabbu data.`,
  };
}
