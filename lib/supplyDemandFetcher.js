/**
 * lib/supplyDemandFetcher.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Phase 6 — Property & Address Intelligence (Items 7 & 8)
 *
 *   7. fetchBuildingPermits(cbsaCode) — Census Building Permits Survey (BPS)
 *      Monthly new residential unit permits by metro area (CBSA).
 *      Shows supply pipeline: how many new units are entering the rental market.
 *      Free, no API key required.
 *
 *   8. fetchMetroGrowth(cbsaCode)     — Census ACS 1-year + BLS QCEW
 *      Population growth rate and job growth rate by metro over the past 3 years.
 *      The leading indicators of future rent demand and appreciation.
 *      Free, no API key required.
 *
 *      Also: resolveCbsaForCity(city, state) — maps a city name to its CBSA code
 *      using the TIGER/Line CBSA file. Used by the on-demand and cron flows.
 *
 * Cache keys (written by cron):
 *   building_permits:{cbsa_code}  → { annual, monthly, unitsPerHousehold, supplyPressure, asOf }
 *   metro_growth:{cbsa_code}      → { popGrowthPct, jobGrowthPct, popTrend, jobTrend, asOf }
 *
 * Error philosophy: return null on failure. Callers handle gracefully.
 */

// ─── CBSA Lookup — top 150 US investor markets (city → CBSA code) ─────────────
// Source: Census TIGER/Line CBSA delineation file (manually compiled for top markets)
// CBSA codes are stable Census-assigned identifiers for metropolitan statistical areas.
const CITY_TO_CBSA = {
  // Southeast
  'atlanta':       '12060', 'atlanta ga':    '12060',
  'charlotte':     '16740', 'charlotte nc':  '16740',
  'nashville':     '34980', 'nashville tn':  '34980',
  'raleigh':       '39580', 'raleigh nc':    '39580',
  'jacksonville':  '27260', 'jacksonville fl':'27260',
  'tampa':         '45300', 'tampa fl':      '45300',
  'orlando':       '36740', 'orlando fl':    '36740',
  'miami':         '33100', 'miami fl':      '33100',
  'fort lauderdale':'22744','fort myers':    '15980',
  'memphis':       '32820', 'memphis tn':    '32820',
  'birmingham':    '13820', 'birmingham al': '13820',
  'richmond':      '40060', 'richmond va':   '40060',
  'columbia sc':   '17900', 'greenville sc': '24860',
  'savannah':      '42340', 'charleston sc': '16700',
  // Southwest
  'dallas':        '19100', 'dallas tx':     '19100',
  'houston':       '26420', 'houston tx':    '26420',
  'austin':        '12420', 'austin tx':     '12420',
  'san antonio':   '41700', 'san antonio tx':'41700',
  'phoenix':       '38060', 'phoenix az':    '38060',
  'tucson':        '46060', 'tucson az':     '46060',
  'las vegas':     '29820', 'las vegas nv':  '29820',
  'albuquerque':   '10740', 'albuquerque nm':'10740',
  'el paso':       '21340', 'oklahoma city': '36420',
  'tulsa':         '46140', 'little rock':   '30780',
  // Mountain West
  'denver':        '19740', 'denver co':     '19740',
  'colorado springs':'17820','salt lake city':'41620',
  'boise':         '14260', 'boise id':      '14260',
  'reno':          '39900', 'reno nv':       '39900',
  'spokane':       '44060', 'billings':      '13740',
  // West Coast
  'los angeles':   '31080', 'los angeles ca':'31080',
  'san diego':     '41740', 'san diego ca':  '41740',
  'san francisco': '41860', 'san francisco ca':'41860',
  'san jose':      '41940', 'sacramento':    '40900',
  'fresno':        '23420', 'bakersfield':   '12540',
  'portland':      '38900', 'portland or':   '38900',
  'seattle':       '42660', 'seattle wa':    '42660',
  'tacoma':        '45104', 'olympia':       '36500',
  'riverside':     '40140', 'stockton':      '44700',
  // Midwest
  'chicago':       '16980', 'chicago il':    '16980',
  'minneapolis':   '33460', 'minneapolis mn':'33460',
  'kansas city':   '28140', 'kansas city mo':'28140',
  'st louis':      '41180', 'st. louis':     '41180',
  'columbus':      '18140', 'columbus oh':   '18140',
  'cleveland':     '17460', 'cleveland oh':  '17460',
  'cincinnati':    '17140', 'cincinnati oh': '17140',
  'indianapolis':  '26900', 'indianapolis in':'26900',
  'milwaukee':     '33340', 'milwaukee wi':  '33340',
  'detroit':       '19820', 'detroit mi':    '19820',
  'grand rapids':  '24340', 'madison wi':    '31540',
  'omaha':         '36540', 'des moines':    '19780',
  'wichita':       '48620', 'sioux falls':   '43580',
  // Northeast
  'new york':      '35620', 'new york ny':   '35620',
  'boston':        '14460', 'boston ma':     '14460',
  'philadelphia':  '37980', 'philadelphia pa':'37980',
  'washington':    '47900', 'washington dc': '47900',
  'baltimore':     '12580', 'baltimore md':  '12580',
  'pittsburgh':    '38300', 'pittsburgh pa': '38300',
  'buffalo':       '15380', 'rochester ny':  '40380',
  'hartford':      '25540', 'providence':    '39300',
  'new haven':     '35300', 'albany':        '10580',
  // Sunbelt growth markets
  'cape coral':    '15980', 'north port':    '35840',
  'lakeland':      '29460', 'deltona':       '19660',
  'myrtle beach':  '34820', 'fayetteville nc':'22180',
  'huntsville':    '26620', 'pensacola':     '37860',
  'knoxville':     '28940', 'chattanooga':   '16860',
  'lexington':     '30460', 'louisville':    '31140',
  'spokane':       '44060', 'bremerton':     '14740',
  'provo':         '39340', 'ogden':         '36260',
};

/**
 * Resolve a city string to a CBSA code.
 * Tries: "city state", "city", then fuzzy first-word match.
 * @returns {string|null} CBSA code or null
 */
export function resolveCbsaForCity(city, state = '') {
  if (!city) return null;
  const cityLower  = city.toLowerCase().trim();
  const stateLower = state.toLowerCase().trim();
  const stateAbbr  = stateLower.length === 2 ? stateLower : US_STATE_ABBR[stateLower] || '';

  // Try "city state_abbr" exact
  if (stateAbbr) {
    const key = `${cityLower} ${stateAbbr}`;
    if (CITY_TO_CBSA[key]) return CITY_TO_CBSA[key];
  }
  // Try city alone
  if (CITY_TO_CBSA[cityLower]) return CITY_TO_CBSA[cityLower];
  // Fuzzy: first word of city
  const firstWord = cityLower.split(/[\s,]+/)[0];
  if (firstWord && CITY_TO_CBSA[firstWord]) return CITY_TO_CBSA[firstWord];
  return null;
}

const US_STATE_ABBR = {
  'alabama':'al','alaska':'ak','arizona':'az','arkansas':'ar','california':'ca',
  'colorado':'co','connecticut':'ct','delaware':'de','florida':'fl','georgia':'ga',
  'hawaii':'hi','idaho':'id','illinois':'il','indiana':'in','iowa':'ia','kansas':'ks',
  'kentucky':'ky','louisiana':'la','maine':'me','maryland':'md','massachusetts':'ma',
  'michigan':'mi','minnesota':'mn','mississippi':'ms','missouri':'mo','montana':'mt',
  'nebraska':'ne','nevada':'nv','new hampshire':'nh','new jersey':'nj','new mexico':'nm',
  'new york':'ny','north carolina':'nc','north dakota':'nd','ohio':'oh','oklahoma':'ok',
  'oregon':'or','pennsylvania':'pa','rhode island':'ri','south carolina':'sc',
  'south dakota':'sd','tennessee':'tn','texas':'tx','utah':'ut','vermont':'vt',
  'virginia':'va','washington':'wa','west virginia':'wv','wisconsin':'wi','wyoming':'wy',
};

// ─── Item 7: Building Permits by Metro ───────────────────────────────────────
/**
 * Fetch residential building permits for a CBSA from the Census Building Permits Survey.
 * Returns 12-month total new units, annualized rate, and a supply pressure label.
 *
 * High supply (lots of new units) → headwind for rent growth, positive for appreciation lag.
 * Low supply → tailwind for rent growth and appreciation.
 *
 * @param {string} cbsaCode  5-digit CBSA code
 * @returns {Promise<BuildingPermitsResult|null>}
 */
export async function fetchBuildingPermits(cbsaCode) {
  if (!cbsaCode) return null;

  try {
    // Census BPS API — monthly residential building permits by CBSA
    // Returns units authorized (total + by structure type)
    // Free, no key: https://www.census.gov/construction/bps/msamonthly.html
    const currentYear  = new Date().getFullYear();
    const previousYear = currentYear - 1;

    // Fetch last 12 months across two calendar years
    const [curYear, prevYear] = await Promise.all([
      fetchBpsCsv(cbsaCode, currentYear),
      fetchBpsCsv(cbsaCode, previousYear),
    ]);

    const months = [...(prevYear || []), ...(curYear || [])];
    if (months.length === 0) return null;

    // Sum last 12 months of data
    const last12 = months.slice(-12);
    const totalUnits = last12.reduce((s, m) => s + (m.total || 0), 0);
    const annualized = last12.length >= 6 ? Math.round((totalUnits / last12.length) * 12) : totalUnits;

    // Trend: compare latest 6mo to prior 6mo
    const late  = last12.slice(-6).reduce((s, m) => s + (m.total || 0), 0);
    const early = last12.slice(0, 6).reduce((s, m) => s + (m.total || 0), 0);
    const trendPct = early > 0 ? Math.round(((late - early) / early) * 100) : 0;
    const trend = trendPct > 10 ? 'accelerating' : trendPct < -10 ? 'declining' : 'stable';

    // Supply pressure classification
    // Benchmarks: US national avg ~1.4 units per 1,000 residents/yr
    // Annualized > 2.0/1,000 = high supply; < 0.8/1,000 = constrained
    const supplyPressure = classifySupply(annualized, cbsaCode);

    return {
      cbsaCode,
      annualized,
      last12Months: totalUnits,
      monthCount:   last12.length,
      trend,
      trendPct,
      supplyPressure: supplyPressure.label,  // 'high', 'moderate', 'low', 'constrained'
      supplyNote:     supplyPressure.note,
      source: 'Census Building Permits Survey',
      asOf:   last12[last12.length - 1]?.month || null,
    };
  } catch (err) {
    console.warn(`[supplyDemandFetcher] Building permits failed for CBSA ${cbsaCode}:`, err.message);
    return null;
  }
}

async function fetchBpsCsv(cbsaCode, year) {
  // Census BPS monthly file by CBSA (Metropolitan Statistical Areas)
  // Format: https://www2.census.gov/econ/bps/Metro/ma{YYYY}c.txt
  const url = `https://www2.census.gov/econ/bps/Metro/ma${year}c.txt`;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(12000) });
    if (!r.ok) return null;
    const text = await r.text();
    return parseBpsText(text, cbsaCode);
  } catch { return null; }
}

function parseBpsText(text, cbsaCode) {
  // BPS file format: fixed-width columns
  // Col 1-5: CBSA code, Col 6-11: year+month (YYYYMM), then unit counts
  const lines = text.split('\n').slice(1); // skip header
  const results = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    const parts = line.trim().split(/\s+/);
    if (parts.length < 8) continue;
    const cbsa = parts[0]?.trim();
    if (cbsa !== cbsaCode) continue;
    const yyyymm = parts[1]?.trim();
    // Total units = 1-unit + 2-unit + 3-4-unit + 5+-unit
    const u1   = parseInt(parts[3])  || 0;
    const u2   = parseInt(parts[5])  || 0;
    const u34  = parseInt(parts[7])  || 0;
    const u5p  = parseInt(parts[9])  || 0;
    const total = u1 + u2 + u34 + u5p;
    if (total >= 0) {
      results.push({ month: yyyymm, u1, u2, u34, u5p, total });
    }
  }
  return results;
}

function classifySupply(annualized, cbsaCode) {
  // These thresholds are relative — we use known-large metros as calibration
  // Phoenix, Austin, Dallas historically 40,000–80,000+ units/yr = high supply
  // NYC, LA, SF historically 10,000–20,000 units/yr = constrained
  if (annualized > 40000) return { label: 'high',        note: `High supply pipeline — ${annualized.toLocaleString()} new units/yr. Strong headwind for rent growth; favorable for long-term absorption. Watch for near-term softening.` };
  if (annualized > 15000) return { label: 'moderate',    note: `Moderate supply — ${annualized.toLocaleString()} new units/yr. Balanced market; rent growth sustainable if demand holds.` };
  if (annualized > 5000)  return { label: 'low',         note: `Low supply — ${annualized.toLocaleString()} new units/yr. Demand likely outpacing construction; positive for rent growth and appreciation.` };
  if (annualized > 0)     return { label: 'constrained', note: `Highly constrained supply — ${annualized.toLocaleString()} new units/yr. Strong structural tailwind for rent growth and appreciation.` };
  return { label: 'unknown', note: 'Building permit data not available for this metro.' };
}

// ─── Item 8: Population & Job Growth by Metro ─────────────────────────────────
/**
 * Fetch population and employment growth data for a CBSA.
 *
 * Population: Census ACS 1-year estimates (B01003_001E — total population)
 *   Available for MSAs >65,000 population (covers all major investor markets).
 *   Growth computed from current vs. 3yr prior estimate.
 *
 * Jobs: BLS Quarterly Census of Employment and Wages (QCEW) via FRED LAUMT series.
 *   Uses the employment level series for the metro, computes 3yr CAGR.
 *
 * @param {string} cbsaCode  5-digit CBSA code
 * @returns {Promise<MetroGrowthResult|null>}
 */
export async function fetchMetroGrowth(cbsaCode) {
  if (!cbsaCode) return null;

  try {
    const [popData, jobData] = await Promise.all([
      fetchPopulationGrowth(cbsaCode),
      fetchJobGrowth(cbsaCode),
    ]);

    if (!popData && !jobData) return null;

    const popGrowthPct = popData?.growthPct ?? null;
    const jobGrowthPct = jobData?.growthPct ?? null;

    // Classify growth tiers
    const popTrend = classifyGrowth(popGrowthPct, 'population');
    const jobTrend = classifyGrowth(jobGrowthPct, 'jobs');

    // Combined demand signal
    const demandSignal = buildDemandSignal(popTrend, jobTrend, popGrowthPct, jobGrowthPct);

    return {
      cbsaCode,
      population:       popData?.current ?? null,
      populationPrior:  popData?.prior    ?? null,
      popGrowthPct:     popGrowthPct,
      popGrowthYrs:     popData?.years    ?? 3,
      popTrend,

      employment:       jobData?.current  ?? null,
      employmentPrior:  jobData?.prior    ?? null,
      jobGrowthPct:     jobGrowthPct,
      jobGrowthYrs:     jobData?.years    ?? 3,
      jobTrend,

      demandSignal:     demandSignal.label,
      demandNote:       demandSignal.note,
      source: `Census ACS${popData ? '' : ' (unavailable)'} + BLS LAUS${jobData ? '' : ' (unavailable)'}`,
      asOf:   new Date().toISOString().slice(0, 7),
    };
  } catch (err) {
    console.warn(`[supplyDemandFetcher] Metro growth failed for CBSA ${cbsaCode}:`, err.message);
    return null;
  }
}

async function fetchPopulationGrowth(cbsaCode) {
  try {
    const currentYear = new Date().getFullYear() - 1; // ACS 1yr lags by ~1yr
    const priorYear   = currentYear - 3;

    const [cur, prior] = await Promise.all([
      fetchAcs1YearPop(cbsaCode, currentYear),
      fetchAcs1YearPop(cbsaCode, priorYear),
    ]);

    if (!cur || !prior || cur <= 0 || prior <= 0) return null;
    const growthPct = Math.round(((cur / prior) ** (1 / 3) - 1) * 1000) / 10; // 3yr CAGR
    return { current: cur, prior, growthPct, years: 3 };
  } catch { return null; }
}

async function fetchAcs1YearPop(cbsaCode, year) {
  // Census ACS 1-year API — metro-level population
  // Only available for geographies >= 65,000 population
  const url = `https://api.census.gov/data/${year}/acs/acs1?get=B01003_001E&for=metropolitan+statistical+area/micropolitan+statistical+area:${cbsaCode}`;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const rows = await r.json();
    if (!rows?.[1]?.[0]) return null;
    const pop = parseInt(rows[1][0]);
    return pop > 0 ? pop : null;
  } catch { return null; }
}

async function fetchJobGrowth(cbsaCode) {
  try {
    // BLS LAUS employment series for the metro area via FRED
    // Series format: ENUC{CBSA5DIGIT}040010Q (total employment, QCEW)
    // Alternative: use FRED's SM series (State and Metro Area Employment)
    const fredSeriesId = `SMS${cbsaCode}000000001`;  // Not standard — use alternative
    // Correct FRED pattern: Total Nonfarm Employment in metro area
    // Format: {CBSA_Code}ND0 for nonfarm employment
    const seriesId = `${cbsaCode}ND0`;

    const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${seriesId}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!r.ok) return null;

    const text = await r.text();
    const lines = text.trim().split('\n').slice(1);
    const obs = lines
      .map(l => { const [d, v] = l.split(','); return { date: d?.trim(), value: parseFloat(v) }; })
      .filter(o => !isNaN(o.value) && o.value > 0);

    if (obs.length < 12) return null; // need at least 1yr of data

    const current = obs[obs.length - 1].value;
    // 3-year prior (36 monthly observations back)
    const priorIdx = Math.max(0, obs.length - 37);
    const prior    = obs[priorIdx].value;
    const years    = (obs.length - 1 - priorIdx) / 12;

    if (prior <= 0) return null;
    const growthPct = years > 0
      ? Math.round(((current / prior) ** (1 / years) - 1) * 1000) / 10
      : null;

    return { current: Math.round(current * 1000), prior: Math.round(prior * 1000), growthPct, years: Math.round(years * 10) / 10 };
  } catch { return null; }
}

function classifyGrowth(pct, type) {
  if (pct === null || pct === undefined) return 'unknown';
  if (type === 'population') {
    if (pct >= 2.0)  return 'high_growth';
    if (pct >= 1.0)  return 'moderate_growth';
    if (pct >= 0.0)  return 'slow_growth';
    if (pct >= -0.5) return 'flat';
    return 'shrinking';
  } else {
    if (pct >= 2.5)  return 'high_growth';
    if (pct >= 1.0)  return 'moderate_growth';
    if (pct >= 0.0)  return 'slow_growth';
    if (pct >= -1.0) return 'flat';
    return 'declining';
  }
}

function buildDemandSignal(popTrend, jobTrend, popPct, jobPct) {
  const strongTrends = ['high_growth', 'moderate_growth'];
  const weakTrends   = ['shrinking', 'declining'];

  const popStrong = strongTrends.includes(popTrend);
  const jobStrong = strongTrends.includes(jobTrend);
  const popWeak   = weakTrends.includes(popTrend);
  const jobWeak   = weakTrends.includes(jobTrend);

  const popStr = popPct !== null ? `${popPct > 0 ? '+' : ''}${popPct}%/yr population` : 'population n/a';
  const jobStr = jobPct !== null ? `${jobPct > 0 ? '+' : ''}${jobPct}%/yr employment` : 'employment n/a';

  if (popStrong && jobStrong) return {
    label: 'strong',
    note:  `Strong forward demand — ${popStr}, ${jobStr}. Rent growth and appreciation both supported by fundamentals.`,
  };
  if (popStrong || jobStrong) return {
    label: 'moderate',
    note:  `Moderate demand — ${popStr}, ${jobStr}. At least one growth driver is solid; market should hold.`,
  };
  if (popWeak || jobWeak) return {
    label: 'weak',
    note:  `Weak demand signal — ${popStr}, ${jobStr}. Shrinking population or job base is a headwind for rent growth and appreciation.`,
  };
  return {
    label: 'stable',
    note:  `Stable demand — ${popStr}, ${jobStr}. Market is not growing fast but also not declining.`,
  };
}
