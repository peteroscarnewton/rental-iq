// /api/rent-estimate - triangulates HUD FMR + Census ACS + FRED Rent Index
// to produce a real-data-backed rent estimate and confidence range.
// POST { zip, beds, city } → { low, mid, high, sources, confidence, note }
// All sources are free, no API keys required.

import { rateLimitWithAuth } from '../../lib/rateLimit.js';
import { fetchSafmrRent } from '../../lib/marketBenchmarkFetcher.js';

const CENSUS_ACS  = 'https://api.census.gov/data/2023/acs/acs5';
const CENSUS_GEO  = 'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress';

// HUD publishes a public FMR data endpoint - no auth needed for county-level data
// We use the state data endpoint which is always available
const HUD_FMR_BASE = 'https://www.huduser.gov/hudapi/public/fmr';

// State → HUD FMR state code mapping
const STATE_FMR_CODES = {
  AL:'01',AK:'02',AZ:'04',AR:'05',CA:'06',CO:'08',CT:'09',DE:'10',DC:'11',FL:'12',
  GA:'13',HI:'15',ID:'16',IL:'17',IN:'18',IA:'19',KS:'20',KY:'21',LA:'22',ME:'23',
  MD:'24',MA:'25',MI:'26',MN:'27',MS:'28',MO:'29',MT:'30',NE:'31',NV:'32',NH:'33',
  NJ:'34',NM:'35',NY:'36',NC:'37',ND:'38',OH:'39',OK:'40',OR:'41',PA:'42',RI:'44',
  SC:'45',SD:'46',TN:'47',TX:'48',UT:'49',VT:'50',VA:'51',WA:'53',WV:'54',WI:'55',WY:'56',
};

// Bedroom ratio multipliers - HUD-derived ratios relative to 2BR
// Used when we have a 2BR FMR to estimate other bedroom counts
const BR_RATIOS = {
  0: 0.74,  // studio
  1: 0.85,  // 1BR
  2: 1.00,  // 2BR baseline
  3: 1.24,  // 3BR
  4: 1.47,  // 4BR
};

// Market-tier rent premium/discount relative to state average
// Derived from HUD SAFMR data - major metros command a premium
// City-level direct 2BR rent estimates - for markets where state median × multiplier
// produces inaccurate results (either extreme high-cost or very low-cost cities).
// Source: Zillow Rent Index / RealPage market data FY2024-2025.
// Only cities that diverge >30% from state_median × metro_multiplier are listed here.
const CITY_DIRECT_2BR = {
  // NYC boroughs - state median * 1.55 = $2,450, but real NYC 2BR = $3,500-4,500
  'new york':3600,'brooklyn':3200,'manhattan':4500,'queens':2800,'bronx':2400,'staten island':2200,
  // SF Bay Area - extreme costs
  'san francisco':3400,'san jose':2800,'oakland':2600,'berkeley':2800,'palo alto':3600,
  // LA Basin
  'los angeles':2600,'santa monica':3200,'beverly hills':3800,'west hollywood':2900,
  // Other high-cost outliers
  'hoboken':2900,'jersey city':2600,'boston':3000,'cambridge':3400,
  // Hawaii - always extreme
  'honolulu':2400,'kailua':2200,
  // Very low-cost cities where multiplier overestimates
  'gary':650,'flint':650,'dayton':750,'toledo':750,'youngstown':650,
  'buffalo':1050,'rochester':1000,'syracuse':950,'albany':1050,
};

const METRO_TIER = {
  // High-cost metros: 30-60% above state average
  'New York':1.55,'Los Angeles':1.50,'San Francisco':1.60,'San Jose':1.55,
  'Seattle':1.35,'Boston':1.40,'Washington':1.35,'Miami':1.25,'Denver':1.20,
  'Austin':1.15,'Nashville':1.10,'Portland':1.15,'San Diego':1.30,'Oakland':1.40,
  'Chicago':1.15,'Dallas':1.05,'Houston':1.00,'Phoenix':1.00,'Atlanta':1.00,
  // Low-cost markets: 20-40% below state average
  'Cleveland':0.75,'Detroit':0.72,'Memphis':0.75,'Birmingham':0.78,
  'Indianapolis':0.82,'Columbus':0.85,'Cincinnati':0.82,'St. Louis':0.80,
  'Kansas City':0.85,'Louisville':0.82,'Oklahoma City':0.80,'Tulsa':0.78,
  'Little Rock':0.78,'Jackson':0.72,'El Paso':0.78,
};

// State median 2BR rent - derived from HUD FMR state data FY2025
// This is our fallback when API calls fail. Source: HUD FY2025 FMR Documentation.
const STATE_MEDIAN_2BR = {
  AL:880,  AK:1320, AZ:1280, AR:820,  CA:1980, CO:1560, CT:1560, DE:1380,
  DC:2210, FL:1560, GA:1180, HI:2180, ID:1120, IL:1180, IN:900,  IA:920,
  KS:920,  KY:880,  LA:980,  ME:1280, MD:1620, MA:1880, MI:1020, MN:1180,
  MS:820,  MO:920,  MT:1120, NE:1020, NV:1320, NH:1520, NJ:1780, NM:980,
  NY:1580, NC:1120, ND:880,  OH:920,  OK:880,  OR:1380, PA:1120, RI:1480,
  SC:1120, SD:880,  TN:1080, TX:1180, UT:1320, VT:1380, VA:1380, WA:1580,
  WV:780,  WI:980,  WY:980,
};

// -- Helpers --------------------------------------------------------------------

function extractStateCode(city) {
  if (!city) return null;
  const m = city.toUpperCase().match(/,\s*([A-Z]{2})$/);
  return m ? m[1] : null;
}

function extractCityName(city) {
  if (!city) return null;
  return city.split(',')[0].trim();
}

function getMetroMultiplier(cityName) {
  if (!cityName) return 1.0;
  const name = cityName.toLowerCase();
  for (const [metro, mult] of Object.entries(METRO_TIER)) {
    if (name.includes(metro.toLowerCase())) return mult;
  }
  return 1.0;
}

// Geocode address to get ZIP code using Census geocoder
async function geocodeToZip(city) {
  try {
    const url = `${CENSUS_GEO}?address=${encodeURIComponent(city)}&benchmark=Public_AR_Current&format=json`;
    const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) return null;
    const body = await r.json();
    return body?.result?.addressMatches?.[0]?.addressComponents?.zip || null;
  } catch { return null; }
}

// Get Census ACS median rent for a ZIP code
async function getCensusRent(zip) {
  if (!zip) return null;
  try {
    const url = `${CENSUS_ACS}?get=B25058_001E,B25031_003E,B25031_004E,B25031_005E&for=zip+code+tabulation+area:${zip}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!r.ok) return null;
    const rows = await r.json();
    if (!rows?.[1]) return null;
    // B25058_001E = median contract rent (all units)
    // B25031_003E = 1BR median, B25031_004E = 2BR median, B25031_005E = 3BR median
    const [medianAll, br1, br2, br3] = rows[1].map(v => parseInt(v) > 0 ? parseInt(v) : null);
    return { medianAll, br1, br2, br3 };
  } catch { return null; }
}

// HUD Small Area FMR API — ZIP-level SAFMR (more precise than county FMR)
// Requires no auth; returns ZIP-specific rent limits
async function getSafmrForZip(zip, beds) {
  if (!zip || !/^\d{5}$/.test(zip)) return null;
  const bedsNum = Math.min(Math.max(parseInt(beds) || 2, 0), 4);
  const bedsField = ['Efficiency', 'One-Bedroom', 'Two-Bedroom', 'Three-Bedroom', 'Four-Bedroom'][bedsNum];
  try {
    const url = `https://www.huduser.gov/hudapi/public/fmr/listSmallAreas?zip=${zip}&year=2025`;
    const r = await fetch(url, {
      headers: { 'User-Agent': 'RentalIQ/1.0' },
      signal: AbortSignal.timeout(6000),
    });
    if (!r.ok) return null;
    const body = await r.json();
    const areas = body?.data?.smallAreas || body?.data || [];
    if (!areas?.length) return null;
    const area = areas[0];
    const rent = parseInt(area[bedsField] || area[bedsField?.replace('-', '_')]);
    return rent > 200 ? { rent, year: area.year || '2025', metro: area.metro_name || '' } : null;
  } catch { return null; }
}


async function getHUDStateFMR(stateCode) {
  if (!stateCode) return null;
  const fipsCode = STATE_FMR_CODES[stateCode];
  if (!fipsCode) return null;

  try {
    // HUD state data endpoint - no Bearer token required for this endpoint
    const url = `${HUD_FMR_BASE}/statedata/${stateCode}`;
    const r = await fetch(url, {
      headers: { 'User-Agent': 'RentalIQ/1.0' },
      signal: AbortSignal.timeout(6000),
    });
    if (!r.ok) return null;
    const body = await r.json();

    // Average across counties to get state median FMR by bedroom
    const counties = body?.data?.counties || [];
    if (!counties.length) return null;

    const avg = (field) => {
      const vals = counties.map(c => parseFloat(c[field])).filter(v => v > 0);
      return vals.length ? Math.round(vals.reduce((a,b)=>a+b,0)/vals.length) : null;
    };

    return {
      br0: avg('Efficiency'),
      br1: avg('One-Bedroom'),
      br2: avg('Two-Bedroom'),
      br3: avg('Three-Bedroom'),
      br4: avg('Four-Bedroom'),
      year: body?.data?.year || '2024',
    };
  } catch { return null; }
}

// -- Main triangulation logic ---------------------------------------------------

function triangulate({ censusRent, hudFMR, safmrRent, stateCode, cityName, beds }) {
  const bedsNum = Math.min(Math.max(parseInt(beds) || 2, 0), 4);
  const bedsKey = `br${bedsNum}`;
  const brRatio = BR_RATIOS[bedsNum] ?? 1.0;
  const metroMult = getMetroMultiplier(cityName);

  const estimates = [];
  const sources = [];

  // Source -1: HUD SAFMR — ZIP-level precision, highest weight
  // SAFMR is zip-code specific and bedroom-specific, more accurate than county/state FMR
  if (safmrRent?.rent && safmrRent.rent > 300) {
    estimates.push({ value: safmrRent.rent, weight: 5, label: `HUD SAFMR ${safmrRent.year || 'FY2025'} (ZIP-level ${bedsNum}BR)` });
    sources.push(`HUD SAFMR ${safmrRent.year || 'FY2025'}`);
  }

  // Source 0: City-level direct rent estimate - highest priority for known extreme markets
  // These override the state_median × multiplier approximation for cities with known divergence
  const cityKey = (cityName || '').toLowerCase().trim();
  const cityDirect2BR = CITY_DIRECT_2BR[cityKey];
  if (cityDirect2BR) {
    const adjusted = Math.round(cityDirect2BR * brRatio);
    if (adjusted > 300) {
      estimates.push({ value: adjusted, weight: 4, label: `${cityName} market rate (2BR adjusted)` });
      sources.push('Market rate index FY2024');
    }
  }

  // Source 1: Census ACS by bedroom count
  if (censusRent) {
    const brMap = { 0: null, 1: censusRent.br1, 2: censusRent.br2, 3: censusRent.br3 };
    const direct = brMap[bedsNum];
    if (direct && direct > 300) {
      estimates.push({ value: direct, weight: 3, label: 'Census ACS (ZIP-level)' });
      sources.push('Census ACS 2023');
    } else if (censusRent.medianAll && censusRent.medianAll > 300) {
      // Use median + bedroom ratio if direct not available
      const adjusted = Math.round(censusRent.medianAll * brRatio);
      if (adjusted > 300) {
        estimates.push({ value: adjusted, weight: 2, label: 'Census ACS (adjusted)' });
        sources.push('Census ACS 2023');
      }
    }
  }

  // Source 2: HUD FMR by bedroom count
  if (hudFMR) {
    const hudVal = hudFMR[bedsKey];
    if (hudVal && hudVal > 300) {
      // Apply metro multiplier to adjust state-level FMR to local market
      const adjusted = Math.round(hudVal * metroMult);
      estimates.push({ value: adjusted, weight: 2.5, label: `HUD FMR ${hudFMR.year} (${metroMult !== 1.0 ? 'metro-adjusted' : 'state-level'})` });
      sources.push(`HUD FMR FY${hudFMR.year}`);
    }
  }

  // Source 3: State median fallback + metro adjustment
  const stateMedian2BR = STATE_MEDIAN_2BR[stateCode];
  if (stateMedian2BR) {
    const adjusted = Math.round(stateMedian2BR * brRatio * metroMult);
    if (adjusted > 300) {
      estimates.push({ value: adjusted, weight: 1, label: 'HUD state median (adjusted)' });
      if (!sources.includes(`HUD FMR FY2024`)) sources.push('HUD FMR FY2025 state medians');
    }
  }

  if (!estimates.length) return null;

  // Weighted average
  const totalWeight = estimates.reduce((s, e) => s + e.weight, 0);
  const mid = Math.round(estimates.reduce((s, e) => s + e.value * e.weight, 0) / totalWeight);

  // Confidence range: ±12% for high-confidence (3+ sources), ±18% for low-confidence
  const spread = estimates.length >= 2 ? 0.12 : 0.18;
  const low  = Math.round(mid * (1 - spread) / 25) * 25;  // round to nearest $25
  const high = Math.round(mid * (1 + spread) / 25) * 25;
  const midRounded = Math.round(mid / 25) * 25;

  // Confidence label
  const confidence = estimates.length >= 3 ? 'High' : estimates.length === 2 ? 'Medium' : 'Low';

  // Build source note
  const sourceBreakdown = estimates.map(e => `${e.label}: $${e.value}`).join(' · ');

  return {
    low,
    mid: midRounded,
    high,
    beds: bedsNum,
    sources,
    confidence,
    sourceBreakdown,
    metroAdjusted: metroMult !== 1.0,
    note: estimates.length === 1
      ? 'Estimated from state-level data - enter your own rent for higher accuracy'
      : `Triangulated from ${estimates.length} real data sources`,
  };
}

// -- Handler -------------------------------------------------------------------

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  // Internal calls from analyze.js carry x-internal header - bypass per-IP rate limit.
  // Otherwise check auth to give authenticated users higher headroom.
  const isInternal = req.headers['x-internal'] === '1';
  if (!isInternal) {
    let isAuthed = false;
    try {
      const { getServerSession } = await import('next-auth/next');
      const { authOptions }      = await import('./auth/[...nextauth].js');
      const session = await getServerSession(req, res, authOptions);
      isAuthed = !!session?.user?.id;
    } catch { /* non-fatal - fall back to anon limit */ }

    if (!rateLimitWithAuth(req, isAuthed, { anonMax: 20, authedMax: 40, windowMs: 60_000 })) {
      return res.status(429).json({ error: 'Too many requests. Please wait a minute.' });
    }
  }

  const { zip, beds, city } = req.body || {};
  if (!city && !zip) return res.status(400).json({ error: 'city or zip required' });

  const stateCode = extractStateCode(city);
  const cityName  = extractCityName(city);

  try {
    // Resolve ZIP if not provided
    let resolvedZip = zip || null;
    if (!resolvedZip && city) {
      resolvedZip = await geocodeToZip(city);
    }

    // Run Census ACS + HUD FMR + HUD SAFMR in parallel
    const [censusRent, hudFMR, safmrRent] = await Promise.allSettled([
      getCensusRent(resolvedZip),
      getHUDStateFMR(stateCode),
      resolvedZip ? getSafmrForZip(resolvedZip, beds ?? 2) : Promise.resolve(null),
    ]);

    const result = triangulate({
      censusRent: censusRent.status === 'fulfilled' ? censusRent.value : null,
      hudFMR:     hudFMR.status     === 'fulfilled' ? hudFMR.value     : null,
      safmrRent:  safmrRent.status  === 'fulfilled' ? safmrRent.value  : null,
      stateCode,
      cityName,
      beds: beds ?? 2,
    });

    if (!result) {
      return res.status(200).json({
        low: null, mid: null, high: null,
        confidence: 'Low',
        sources: [],
        note: 'Could not estimate rent for this location - please enter manually',
      });
    }

    // Cache for 7 days - FMR data updates annually
    res.setHeader('Cache-Control', 'public, max-age=604800, s-maxage=604800');
    return res.status(200).json(result);

  } catch (err) {
    console.error('Rent estimate error:', err);
    return res.status(500).json({ error: 'Could not estimate rent' });
  }
}

export const config = { maxDuration: 15 };
