/**
 * lib/climateRiskFetcher.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Phase 8 — Item 17: FEMA National Risk Index (NRI) climate risk score.
 *
 * The NRI provides composite risk scores for every US county covering 18
 * natural hazards (hurricane, tornado, flood, wildfire, drought, earthquake,
 * lightning, hail, strong wind, winter storm, ice storm, coastal flooding,
 * heat wave, landslide, tsunami, volcanic activity, avalanche, cold wave).
 *
 * Source: FEMA National Risk Index API
 *   - Base URL: https://hazards.fema.gov/nri/api/v1/
 *   - Endpoint: /counties?countyFips={fips5}
 *   - Free, no authentication required
 *   - Updated annually (last update: Nov 2023 for NRI v2)
 *
 * Data returned per county:
 *   - RISK_SCORE:        composite 0-100 (100 = highest risk nationally)
 *   - RISK_RATNG:        'Very High' | 'Relatively High' | 'Relatively Moderate' | 'Relatively Low' | 'Very Low'
 *   - SOVI_SCORE:        social vulnerability score
 *   - RESL_SCORE:        community resilience score
 *   - Per-hazard scores: HRCN_RISKR (hurricane), TRND_RISKR (tornado), WFIR_RISKR (wildfire), etc.
 *
 * Cache key: climate_risk:{county_fips}
 * TTL: 365 days (NRI updates annually)
 *
 * @module climateRiskFetcher
 */

const FEMA_NRI_BASE = 'https://hazards.fema.gov/nri/api/v1';

// ─── Hazard display names (from FEMA NRI field suffix → readable label) ────────
const HAZARD_LABELS = {
  HRCN: 'Hurricane',
  TRND: 'Tornado',
  RFLD: 'Riverine Flooding',
  CFLD: 'Coastal Flooding',
  WFIR: 'Wildfire',
  DRGT: 'Drought',
  ERQK: 'Earthquake',
  HAIL: 'Hail',
  LTNG: 'Lightning',
  SWND: 'Strong Wind',
  WNTW: 'Winter Weather',
  ISTM: 'Ice Storm',
  HWAV: 'Heat Wave',
  LNDS: 'Landslide',
  TSUN: 'Tsunami',
  VLCN: 'Volcanic Activity',
  AVLN: 'Avalanche',
  CWAV: 'Cold Wave',
};

/**
 * Fetches FEMA NRI climate risk data for a county FIPS code.
 *
 * @param {string} countyFips - 5-digit FIPS code (e.g. '12086' for Miami-Dade)
 * @returns {Promise<ClimateRiskResult|null>}
 */
export async function fetchClimateRisk(countyFips) {
  if (!countyFips || !/^\d{5}$/.test(countyFips)) return null;

  try {
    const url = `${FEMA_NRI_BASE}/counties?countyFips=${countyFips}`;
    const r = await fetch(url, {
      headers: { 'User-Agent': 'RentalIQ/1.0 (investment research)' },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) throw new Error(`FEMA NRI API ${r.status}`);

    const body = await r.json();
    const county = body?.items?.[0] || body?.data?.[0] || body?.[0];
    if (!county) return null;

    // Extract composite risk score + rating
    const score  = county.RISK_SCORE ?? county.riskScore ?? null;
    const rating = county.RISK_RATNG ?? county.riskRating ?? null;

    // Extract top hazards (those rated 'Very High' or 'Relatively High')
    const topHazards = [];
    for (const [code, label] of Object.entries(HAZARD_LABELS)) {
      const hazRating = county[`${code}_RISKR`] ?? county[`${code}_riskr`];
      if (hazRating === 'Very High' || hazRating === 'Relatively High') {
        topHazards.push({ code, label, rating: hazRating });
      }
    }

    // Social vulnerability and resilience
    const soviScore  = county.SOVI_SCORE ?? county.soviScore ?? null;
    const reslScore  = county.RESL_SCORE ?? county.reslScore ?? null;
    const countyName = county.COUNTY    ?? county.countyName ?? countyFips;
    const stateName  = county.STATE     ?? county.stateName  ?? '';

    return {
      countyFips,
      countyName,
      stateName,
      riskScore:      score !== null ? Math.round(parseFloat(score) * 10) / 10 : null,
      riskRating:     normalizeRating(rating),
      topHazards:     topHazards.slice(0, 5), // top 5 elevated hazards
      soviScore:      soviScore !== null ? Math.round(parseFloat(soviScore) * 10) / 10 : null,
      reslScore:      reslScore !== null ? Math.round(parseFloat(reslScore) * 10) / 10 : null,
      source: 'FEMA National Risk Index v2 (Nov 2023)',
      asOf: '2023-11',
      note: buildRiskNote(score, rating, topHazards, countyName),
    };
  } catch (err) {
    console.warn(`[climateRiskFetcher] FEMA NRI failed for FIPS ${countyFips}:`, err.message);
    return null;
  }
}

function normalizeRating(raw) {
  if (!raw) return null;
  const r = raw.toString().toLowerCase();
  if (r.includes('very high'))             return 'Very High';
  if (r.includes('relatively high'))       return 'Relatively High';
  if (r.includes('relatively moderate'))   return 'Relatively Moderate';
  if (r.includes('relatively low'))        return 'Relatively Low';
  if (r.includes('very low'))              return 'Very Low';
  return raw;
}

function buildRiskNote(score, rating, topHazards, countyName) {
  const s = score !== null ? Math.round(parseFloat(score)) : null;
  const ratingStr = normalizeRating(rating) || 'unknown';
  const hazardStr = topHazards.length > 0
    ? ` Primary hazards: ${topHazards.map(h => h.label).join(', ')}.`
    : '';
  const prefix = s !== null
    ? `${countyName} risk score: ${s}/100 (${ratingStr}).`
    : `${countyName} climate risk: ${ratingStr}.`;
  const impact = ratingStr === 'Very High' || ratingStr === 'Relatively High'
    ? ' Elevated climate risk affects insurance costs and long-term property values.'
    : ratingStr === 'Very Low' || ratingStr === 'Relatively Low'
      ? ' Low climate risk supports stable insurance costs.'
      : '';
  return prefix + hazardStr + impact;
}

/**
 * Geocodes a city string to county FIPS using Census geocoder.
 * Returns null if geocoding fails.
 *
 * @param {string} city - "Miami, FL" format
 * @returns {Promise<string|null>} 5-digit FIPS or null
 */
export async function geocodeToCountyFips(city) {
  if (!city) return null;
  try {
    const url = `https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress?address=${encodeURIComponent(city)}&benchmark=Public_AR_Current&vintage=Census2020_Current&format=json`;
    const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!r.ok) return null;
    const body = await r.json();
    const match = body?.result?.addressMatches?.[0];
    if (!match) return null;
    const stateFips  = match.geographies?.['Counties']?.[0]?.STATE  ?? match.geographies?.['Census Tracts']?.[0]?.STATE;
    const countyFips = match.geographies?.['Counties']?.[0]?.COUNTY ?? match.geographies?.['Census Tracts']?.[0]?.COUNTY;
    if (!stateFips || !countyFips) return null;
    return `${stateFips.padStart(2,'0')}${countyFips.padStart(3,'0')}`;
  } catch { return null; }
}

// ─── State-level FIPS codes for county-FIPS lookup by state ───────────────────
// Used when address geocoding fails — fall back to most-populous county FIPS per state
const STATE_PRIMARY_FIPS = {
  AL:'01073', AK:'02020', AZ:'04013', AR:'05119', CA:'06037', CO:'08031', CT:'09003',
  DE:'10003', DC:'11001', FL:'12086', GA:'13121', HI:'15003', ID:'16001', IL:'17031',
  IN:'18097', IA:'19153', KS:'20091', KY:'21111', LA:'22071', ME:'23005', MD:'24033',
  MA:'25025', MI:'26163', MN:'27053', MS:'28049', MO:'29189', MT:'30049', NE:'31055',
  NV:'32003', NH:'33011', NJ:'34013', NM:'35001', NY:'36061', NC:'37119', ND:'38017',
  OH:'39049', OK:'40109', OR:'41051', PA:'42101', RI:'44007', SC:'45045', SD:'46099',
  TN:'47157', TX:'48201', UT:'49035', VT:'50007', VA:'51760', WA:'53033', WV:'54039',
  WI:'55079', WY:'56021',
};

/**
 * Returns the primary county FIPS for a state code (most-populous county).
 * Used as a fallback when precise geocoding fails.
 */
export function getPrimaryCountyFips(stateCode) {
  return stateCode ? (STATE_PRIMARY_FIPS[stateCode.toUpperCase()] ?? null) : null;
}
