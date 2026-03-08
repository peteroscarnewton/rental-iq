/**
 * lib/scoutMarkets.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Phase 1: Market Intelligence Scoring Engine for Scout page.
 *
 * Scores and ranks US rental markets using only data we already own:
 *   - Cap rates from marketBenchmarkFetcher.js (CBRE/JLL calibrated)
 *   - Landlord-friendliness scores from landlordLaws.js
 *   - State property tax rates from marketData.js BASELINE
 *   - State insurance rates from insuranceRateFetcher.js
 *   - State appreciation from marketData.js BASELINE
 *
 * Ranking formula (composite Scout Score, 0–100):
 *   - Cap rate component (40%): scaled from 0–10% cap rate range
 *   - Landlord score component (30%): directly from LANDLORD_LAWS
 *   - Expense efficiency (15%): inverse of tax + insurance burden
 *   - Appreciation component (15%): forward-looking equity growth
 *
 * Each market also carries:
 *   - estimatedCashFlow: rough monthly P&I cash flow on a $200k 3BR at median cap rate
 *     using 7% rate, 20% down, 8% vacancy, 10% mgmt, 1% maint, state tax/ins
 *   - Zillow / Redfin / Realtor.com search URLs generated from filter params
 *
 * This module runs entirely client-side from static data — no API calls needed.
 * It is the canonical source of truth for which markets Scout displays.
 *
 * @module scoutMarkets
 */

import { CAP_RATES_BY_METRO } from './marketBenchmarkFetcher.js';
import { LANDLORD_LAWS }       from './landlordLaws.js';

// ─── Metro → State mapping ────────────────────────────────────────────────────
const METRO_STATE = {
  'memphis':         'TN', 'detroit':        'MI', 'cleveland':      'OH',
  'birmingham':      'AL', 'jackson':        'MS', 'little rock':    'AR',
  'oklahoma city':   'OK', 'tulsa':          'OK', 'kansas city':    'MO',
  'st. louis':       'MO', 'pittsburgh':     'PA', 'indianapolis':   'IN',
  'columbus':        'OH', 'cincinnati':     'OH', 'louisville':     'KY',
  'buffalo':         'NY', 'jacksonville':   'FL', 'tampa':          'FL',
  'orlando':         'FL', 'cape coral':     'FL', 'fort myers':     'FL',
  'charlotte':       'NC', 'raleigh':        'NC', 'atlanta':        'GA',
  'nashville':       'TN', 'houston':        'TX', 'dallas':         'TX',
  'san antonio':     'TX', 'el paso':        'TX', 'albuquerque':    'NM',
  'phoenix':         'AZ', 'tucson':         'AZ', 'las vegas':      'NV',
  'chicago':         'IL', 'minneapolis':    'MN', 'milwaukee':      'WI',
  'omaha':           'NE', 'richmond':       'VA', 'baltimore':      'MD',
  'miami':           'FL', 'fort lauderdale':'FL', 'austin':         'TX',
  'denver':          'CO', 'salt lake city': 'UT', 'boise':          'ID',
  'portland':        'OR', 'seattle':        'WA', 'washington':     'DC',
  'boston':          'MA', 'new york':       'NY', 'los angeles':    'CA',
  'san diego':       'CA', 'san francisco':  'CA', 'san jose':       'CA',
  'honolulu':        'HI',
};

// ─── Median home price estimates by metro (2025 Q1) ───────────────────────────
// Source: NAR Median Existing Home Sales Price by Metro + Zillow ZHVI
// Used only for estimated cash flow calculation — not presented as fact.
const METRO_MEDIAN_PRICE = {
  'memphis': 185000,   'detroit': 175000,    'cleveland': 195000,
  'birmingham': 210000,'jackson': 155000,    'little rock': 195000,
  'oklahoma city': 225000, 'tulsa': 215000,  'kansas city': 260000,
  'st. louis': 235000, 'pittsburgh': 215000, 'indianapolis': 255000,
  'columbus': 265000,  'cincinnati': 240000, 'louisville': 240000,
  'buffalo': 225000,   'jacksonville': 300000,'tampa': 355000,
  'orlando': 340000,   'cape coral': 305000, 'fort myers': 320000,
  'charlotte': 365000, 'raleigh': 395000,    'atlanta': 355000,
  'nashville': 415000, 'houston': 295000,    'dallas': 355000,
  'san antonio': 270000,'el paso': 220000,   'albuquerque': 295000,
  'phoenix': 395000,   'tucson': 295000,     'las vegas': 390000,
  'chicago': 310000,   'minneapolis': 335000,'milwaukee': 265000,
  'omaha': 270000,     'richmond': 355000,   'baltimore': 350000,
  'miami': 625000,     'fort lauderdale': 485000,'austin': 455000,
  'denver': 545000,    'salt lake city': 475000,'boise': 415000,
  'portland': 465000,  'seattle': 695000,    'washington': 555000,
  'boston': 645000,    'new york': 535000,   'los angeles': 795000,
  'san diego': 825000, 'san francisco': 1050000,'san jose': 1150000,
  'honolulu': 795000,
};

// ─── HUD FMR 2BR rent estimates by metro (2025) ───────────────────────────────
// Source: HUD FMR / SAFMR metro area estimates — used only for cash flow calc.
const METRO_RENT_2BR = {
  'memphis': 1185,    'detroit': 1095,     'cleveland': 1140,
  'birmingham': 1150, 'jackson': 890,      'little rock': 1050,
  'oklahoma city': 1145, 'tulsa': 1095,   'kansas city': 1290,
  'st. louis': 1245,  'pittsburgh': 1375,  'indianapolis': 1195,
  'columbus': 1295,   'cincinnati': 1215,  'louisville': 1145,
  'buffalo': 1175,    'jacksonville': 1485,'tampa': 1775,
  'orlando': 1745,    'cape coral': 1540,  'fort myers': 1595,
  'charlotte': 1635,  'raleigh': 1695,     'atlanta': 1645,
  'nashville': 1745,  'houston': 1395,     'dallas': 1595,
  'san antonio': 1285,'el paso': 1125,     'albuquerque': 1295,
  'phoenix': 1645,    'tucson': 1295,      'las vegas': 1545,
  'chicago': 1545,    'minneapolis': 1495, 'milwaukee': 1295,
  'omaha': 1145,      'richmond': 1545,    'baltimore': 1645,
  'miami': 2145,      'fort lauderdale': 1995,'austin': 1845,
  'denver': 1895,     'salt lake city': 1595,'boise': 1395,
  'portland': 1695,   'seattle': 2095,     'washington': 2145,
  'boston': 2295,     'new york': 2245,    'los angeles': 2295,
  'san diego': 2345,  'san francisco': 2795,'san jose': 2895,
  'honolulu': 2295,
};

// ─── State tax + insurance baselines (mirrored from marketData.js BASELINE) ──
const STATE_TAX = {
  AL:0.41,AK:1.04,AZ:0.63,AR:0.64,CA:0.75,CO:0.51,CT:1.79,DE:0.57,FL:0.91,GA:0.91,
  HI:0.30,ID:0.47,IL:2.08,IN:0.85,IA:1.57,KS:1.41,KY:0.86,LA:0.56,ME:1.09,MD:1.09,
  MA:1.17,MI:1.32,MN:1.12,MS:0.78,MO:1.01,MT:0.74,NE:1.73,NV:0.55,NH:1.89,NJ:2.23,
  NM:0.80,NY:1.73,NC:0.82,ND:0.98,OH:1.56,OK:0.90,OR:0.97,PA:1.49,RI:1.53,SC:0.57,
  SD:1.14,TN:0.67,TX:1.63,UT:0.58,VT:1.83,VA:0.82,WA:0.98,WV:0.59,WI:1.61,WY:0.61,DC:0.55,
};
const STATE_INS = {
  AL:1.65,AK:0.85,AZ:0.78,AR:1.45,CA:0.80,CO:0.95,CT:1.25,DE:0.80,FL:3.50,GA:1.45,
  HI:0.35,ID:0.68,IL:1.15,IN:0.95,IA:0.95,KS:1.55,KY:1.25,LA:3.20,ME:0.78,MD:0.92,
  MA:1.10,MI:1.35,MN:1.15,MS:1.95,MO:1.45,MT:0.85,NE:1.55,NV:0.65,NH:0.75,NJ:1.05,
  NM:0.85,NY:1.15,NC:1.15,ND:0.95,OH:0.88,OK:2.35,OR:0.62,PA:0.85,RI:1.35,SC:1.55,
  SD:1.15,TN:1.25,TX:2.20,UT:0.62,VT:0.72,VA:0.78,WA:0.68,WV:0.82,WI:0.92,WY:0.75,DC:0.72,
};
const STATE_APPR = {
  FL:4.5,TX:4.2,CA:3.8,AZ:3.8,CO:3.5,WA:4.5,OR:3.2,ID:3.2,NV:4.0,
  NC:4.5,GA:4.5,TN:4.0,SC:4.2,VA:3.8,MD:3.8,MA:4.5,NY:3.5,NJ:3.8,
  IL:2.5,OH:3.2,MI:3.5,PA:3.0,IN:3.2,MO:3.0,WI:3.5,MN:3.8,IA:2.8,
  KS:2.5,NE:3.0,SD:3.2,ND:2.8,MT:3.8,WY:3.0,UT:3.8,NM:3.5,AK:2.0,
  HI:4.2,KY:2.8,WV:2.0,AR:3.0,AL:3.0,MS:2.5,LA:2.2,OK:2.8,
};

// ─── Friendly display city names + state labels ───────────────────────────────
const METRO_DISPLAY = {
  'memphis':        { city: 'Memphis',        state: 'TN', region: 'Southeast' },
  'detroit':        { city: 'Detroit',         state: 'MI', region: 'Midwest'   },
  'cleveland':      { city: 'Cleveland',       state: 'OH', region: 'Midwest'   },
  'birmingham':     { city: 'Birmingham',      state: 'AL', region: 'Southeast' },
  'jackson':        { city: 'Jackson',         state: 'MS', region: 'Southeast' },
  'little rock':    { city: 'Little Rock',     state: 'AR', region: 'South'     },
  'oklahoma city':  { city: 'Oklahoma City',   state: 'OK', region: 'South'     },
  'tulsa':          { city: 'Tulsa',           state: 'OK', region: 'South'     },
  'kansas city':    { city: 'Kansas City',     state: 'MO', region: 'Midwest'   },
  'st. louis':      { city: 'St. Louis',       state: 'MO', region: 'Midwest'   },
  'pittsburgh':     { city: 'Pittsburgh',      state: 'PA', region: 'Northeast' },
  'indianapolis':   { city: 'Indianapolis',    state: 'IN', region: 'Midwest'   },
  'columbus':       { city: 'Columbus',        state: 'OH', region: 'Midwest'   },
  'cincinnati':     { city: 'Cincinnati',      state: 'OH', region: 'Midwest'   },
  'louisville':     { city: 'Louisville',      state: 'KY', region: 'Midwest'   },
  'buffalo':        { city: 'Buffalo',         state: 'NY', region: 'Northeast' },
  'jacksonville':   { city: 'Jacksonville',    state: 'FL', region: 'Southeast' },
  'cape coral':     { city: 'Cape Coral',      state: 'FL', region: 'Southeast' },
  'charlotte':      { city: 'Charlotte',       state: 'NC', region: 'Southeast' },
  'raleigh':        { city: 'Raleigh',         state: 'NC', region: 'Southeast' },
  'atlanta':        { city: 'Atlanta',         state: 'GA', region: 'Southeast' },
  'nashville':      { city: 'Nashville',       state: 'TN', region: 'Southeast' },
  'houston':        { city: 'Houston',         state: 'TX', region: 'South'     },
  'dallas':         { city: 'Dallas',          state: 'TX', region: 'South'     },
  'san antonio':    { city: 'San Antonio',     state: 'TX', region: 'South'     },
  'el paso':        { city: 'El Paso',         state: 'TX', region: 'South'     },
  'albuquerque':    { city: 'Albuquerque',     state: 'NM', region: 'Southwest' },
  'phoenix':        { city: 'Phoenix',         state: 'AZ', region: 'Southwest' },
  'tucson':         { city: 'Tucson',          state: 'AZ', region: 'Southwest' },
  'las vegas':      { city: 'Las Vegas',       state: 'NV', region: 'West'      },
  'chicago':        { city: 'Chicago',         state: 'IL', region: 'Midwest'   },
  'minneapolis':    { city: 'Minneapolis',     state: 'MN', region: 'Midwest'   },
  'milwaukee':      { city: 'Milwaukee',       state: 'WI', region: 'Midwest'   },
  'omaha':          { city: 'Omaha',           state: 'NE', region: 'Midwest'   },
  'richmond':       { city: 'Richmond',        state: 'VA', region: 'Southeast' },
  'baltimore':      { city: 'Baltimore',       state: 'MD', region: 'Northeast' },
  'tampa':          { city: 'Tampa',           state: 'FL', region: 'Southeast' },
  'orlando':        { city: 'Orlando',         state: 'FL', region: 'Southeast' },
  'austin':         { city: 'Austin',          state: 'TX', region: 'South'     },
  'denver':         { city: 'Denver',          state: 'CO', region: 'West'      },
  'salt lake city': { city: 'Salt Lake City',  state: 'UT', region: 'West'      },
  'boise':          { city: 'Boise',           state: 'ID', region: 'West'      },
};

// Only score metros that have all required data (exclude coastal/low-cap markets from top list)
const SCORED_METROS = Object.keys(METRO_DISPLAY);

/**
 * Compute estimated monthly P&I cash flow for a market.
 * Assumptions: median price, 2BR HUD FMR rent, 20% down, 7% 30yr fixed,
 * 8% vacancy, 10% mgmt, 1%/yr maintenance, state tax, state insurance.
 * Returns monthly cash flow (can be negative).
 */
function estimateCashFlow(metro, price, rent, stateCode) {
  // Use cap-rate-based NOI: NOI = price × capRate (this is the definition of cap rate).
  // Cap rate already bakes in vacancy, management, maintenance, taxes, insurance.
  // Then subtract debt service (20% down, 7.25% 30yr fixed) to get levered CF.
  const capData = CAP_RATES_BY_METRO[metro];
  if (!capData || !price) return null;
  const capRate    = capData.sfr || 5.0;
  const noi        = price * (capRate / 100);          // annual NOI
  const principal  = price * 0.80;
  const r          = 0.0725 / 12;
  const n          = 360;
  const mortgageAn = principal * (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1) * 12;
  return Math.round((noi - mortgageAn) / 12);
}

/**
 * Score a single metro 0–100 for rental investment attractiveness.
 * Higher = better for investors.
 */
function scoreMetro(metroKey) {
  const capData    = CAP_RATES_BY_METRO[metroKey];
  if (!capData) return null;

  const stateCode  = METRO_STATE[metroKey];
  if (!stateCode) return null;

  const lawData    = LANDLORD_LAWS[stateCode];
  const capRate    = capData.sfr || 5.0;
  const landlord   = lawData?.score || 60;
  const taxRate    = STATE_TAX[stateCode] || 1.0;
  const insRate    = STATE_INS[stateCode] || 1.0;
  const apprRate   = STATE_APPR[stateCode] || 3.0;

  // Cap rate component: 0–10% range → 0–100
  // 8%+ = 100, 4% = 40, linear in between
  const capScore   = Math.min(100, Math.max(0, (capRate / 8.0) * 100));

  // Expense efficiency: lower tax+insurance = better. Scale: 0.5% total = 100, 4% total = 0
  const expBurden  = taxRate + insRate;  // combined annual %
  const expScore   = Math.max(0, Math.min(100, 100 - ((expBurden - 0.5) / 3.5) * 100));

  // Appreciation component: 2–5% range
  const apprScore  = Math.min(100, Math.max(0, ((apprRate - 2.0) / 3.0) * 100));

  // Composite
  const composite  = (
    capScore   * 0.40 +
    landlord   * 0.30 +
    expScore   * 0.15 +
    apprScore  * 0.15
  );

  return Math.round(composite);
}

/**
 * Build Zillow search URL for a metro with given filters.
 */
export function buildZillowUrl(cityDisplay, stateCode, filters = {}) {
  const { priceMax = 400000, beds = 3, propType = 'sfr' } = filters;
  const citySlug = cityDisplay.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  const state    = stateCode.toLowerCase();
  const base     = `https://www.zillow.com/${citySlug}-${state}/`;
  const fs = {
    price: { min: undefined, max: priceMax },
    beds:  { min: beds },
    sf:    { value: propType === 'sfr' || propType === 'any' },
    mf:    { value: propType === 'mfr' },
    sort:  { value: 'days' },
  };
  // Remove undefined
  if (!fs.price.min) delete fs.price.min;
  const sqs = encodeURIComponent(JSON.stringify({ pagination:{}, isMapVisible:false, filterState:fs }));
  return `${base}?searchQueryState=${sqs}`;
}

/**
 * Build Redfin search URL.
 */
export function buildRedfinUrl(cityDisplay, stateCode, filters = {}) {
  const { priceMax = 400000, beds = 3 } = filters;
  const state    = stateCode;
  const citySlug = cityDisplay.replace(/\s+/g, '-');
  const base     = `https://www.redfin.com/${state}/${citySlug}/filter/`;
  const parts    = [`max-price=${priceMax}`, `min-beds=${beds}`, 'max-days-on-market=180'];
  return base + parts.join(',');
}

/**
 * Build Realtor.com search URL.
 */
export function buildRealtorUrl(cityDisplay, stateCode, filters = {}) {
  const { priceMax = 400000, beds = 3 } = filters;
  const citySlug = cityDisplay.toLowerCase().replace(/\s+/g, '_');
  const state    = stateCode.toLowerCase();
  return `https://www.realtor.com/realestateandhomes-search/${citySlug}_${state}/price-na-${priceMax}/beds-${beds}`;
}

/**
 * Rank and return scored markets, filtered by user preferences.
 *
 * @param {object} filters
 * @param {number} [filters.priceMax=400000]
 * @param {number} [filters.beds=3]
 * @param {number} [filters.minCapRate=0]      — filter: only show cap rate >= this
 * @param {number} [filters.minLandlord=0]     — filter: only landlord score >= this
 * @param {string} [filters.region='all']      — filter by region
 * @param {string} [filters.propType='sfr']    — 'sfr' | 'mfr' | 'any'
 * @param {string} [filters.goal='cashflow']   — 'cashflow' | 'appreciation' | 'balanced'
 * @returns {Array} sorted market objects
 */
export function getRankedMarkets(filters = {}) {
  const {
    priceMax    = 400000,
    beds        = 3,
    minCapRate  = 0,
    minLandlord = 0,
    region      = 'all',
    propType    = 'sfr',
    goal        = 'cashflow',
  } = filters;

  const results = [];

  for (const metroKey of SCORED_METROS) {
    const capData   = CAP_RATES_BY_METRO[metroKey];
    const display   = METRO_DISPLAY[metroKey];
    const stateCode = METRO_STATE[metroKey];
    if (!capData || !display || !stateCode) continue;

    const capRate    = propType === 'mfr' ? (capData.mfr || capData.sfr) : capData.sfr;
    const lawData    = LANDLORD_LAWS[stateCode];
    const landlord   = lawData?.score || 60;
    const price      = METRO_MEDIAN_PRICE[metroKey];
    const rent       = METRO_RENT_2BR[metroKey];
    const cashFlow   = estimateCashFlow(metroKey, price, rent, stateCode);
    const score      = scoreMetro(metroKey);
    const apprRate   = STATE_APPR[stateCode] || 3.0;

    if (score === null) continue;
    if (capRate < minCapRate) continue;
    if (landlord < minLandlord) continue;
    if (region !== 'all' && display.region !== region) continue;
    if (price && price > priceMax * 1.5) continue; // exclude if median far above budget

    // Re-weight score based on investor goal
    let goalScore = score;
    if (goal === 'cashflow')     goalScore = score * 0.6 + (Math.min(100, Math.max(0, (capRate / 8) * 100))) * 0.4;
    if (goal === 'appreciation') goalScore = score * 0.5 + (Math.min(100, apprRate / 5 * 100)) * 0.5;
    if (goal === 'balanced')     goalScore = score;

    results.push({
      key:          metroKey,
      city:         display.city,
      state:        stateCode,
      region:       display.region,
      capRate,
      capRateMfr:   capData.mfr,
      landlordScore: landlord,
      landlordLaw:  lawData,
      medianPrice:  price,
      rent2br:      rent,
      cashFlow,
      appreciationRate: apprRate,
      taxRate:      STATE_TAX[stateCode] || 1.0,
      insRate:      STATE_INS[stateCode] || 1.0,
      score:        Math.round(goalScore),
      capSource:    capData.source,
      zillowUrl:    buildZillowUrl(display.city, stateCode, { priceMax, beds, propType }),
      redfinUrl:    buildRedfinUrl(display.city, stateCode, { priceMax, beds }),
      realtorUrl:   buildRealtorUrl(display.city, stateCode, { priceMax, beds }),
    });
  }

  // Sort by goal-adjusted score descending
  results.sort((a, b) => b.score - a.score);
  return results;
}

/**
 * Return a short human-readable reason why this market ranks well.
 * Used as the "why" tagline on each market card.
 */
export function getMarketTagline(market) {
  const { capRate, landlordScore, cashFlow, appreciationRate, state } = market;
  if (capRate >= 7.5)   return `High-yield market — ${capRate}% cap rate ranks in top tier nationally`;
  if (landlordScore >= 85 && capRate >= 6) return `Landlord-friendly state (${landlordScore}/100) with solid ${capRate}% cap rates`;
  if (cashFlow && cashFlow > 200) return `Strong cash flow potential — estimated +$${cashFlow}/mo at market rent`;
  if (capRate >= 6 && appreciationRate >= 4) return `Balanced: ${capRate}% cap rate with ${appreciationRate}%/yr appreciation`;
  if (appreciationRate >= 4.5) return `High appreciation market — ${appreciationRate}%/yr equity growth`;
  return `${capRate}% cap rate · ${landlordScore}/100 landlord score`;
}
