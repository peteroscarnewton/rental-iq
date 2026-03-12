/**
 * /api/scout-markets
 * ─────────────────────────────────────────────────────────────────────────────
 * GET — Returns live market signals from Supabase cache for all Scout metros.
 *
 * Reads (all from market_data_cache, populated by cron jobs):
 *   - market_cap_rates        → computed cap rates from Census ACS + HUD SAFMR
 *   - employment:{city}       → BLS LAUS unemployment rate + trend
 *   - zori_rent_growth:{city} → Zillow rent index growth rate
 *   - case_shiller:{metro}    → S&P/Case-Shiller price trend
 *
 * Falls back gracefully — if a key isn't in cache, that market just shows
 * static data. No market is hidden or broken by missing cache.
 *
 * Response: { markets: { [metroKey]: LiveSignals }, asOf: ISO string }
 *
 * LiveSignals:
 *   capRate?         number   — live computed cap rate (replaces static if present)
 *   unemploymentRate? number  — metro unemployment %
 *   unemploymentNational? number
 *   unemploymentTrend? string — 'improving' | 'worsening' | 'stable'
 *   employmentAsOf?  string
 *   rentGrowthPct?   number   — ZORI annual rent growth %
 *   rentGrowthAsOf?  string
 *   priceYoY?        number   — Case-Shiller 1yr %
 *   priceTrend?      string   — 'accelerating' | 'decelerating' | 'stable'
 *   csAsOf?          string
 */

import { getSupabaseAdmin } from '../../lib/supabase.js';
import { rateLimit }        from '../../lib/rateLimit.js';

export const config = { maxDuration: 15 };

// All metro keys Scout uses (mirrors METRO_STATE in scoutMarkets.js)
const SCOUT_METROS = [
  'memphis','detroit','cleveland','birmingham','jackson','little rock',
  'oklahoma city','tulsa','kansas city','st. louis','pittsburgh','indianapolis',
  'columbus','cincinnati','louisville','buffalo','jacksonville','tampa',
  'orlando','cape coral','fort myers','charlotte','raleigh','atlanta',
  'nashville','houston','dallas','san antonio','el paso','albuquerque',
  'phoenix','tucson','las vegas','chicago','minneapolis','milwaukee',
  'omaha','richmond','baltimore','miami','fort lauderdale','austin',
  'denver','salt lake city','boise','portland','seattle','washington',
  'boston','new york','los angeles','san diego','san francisco','san jose',
  'honolulu',
];

// Case-Shiller metro keys that map to Scout metro keys
const METRO_TO_CS_KEY = {
  'miami':          'miami',
  'fort lauderdale':'fort lauderdale',
  'tampa':          'tampa',
  'phoenix':        'phoenix',
  'dallas':         'dallas',
  'seattle':        'seattle',
  'denver':         'denver',
  'charlotte':      'charlotte',
  'las vegas':      'las vegas',
  'los angeles':    'los angeles',
  'san diego':      'san diego',
  'san francisco':  'san francisco',
  'boston':         'boston',
  'chicago':        'chicago',
  'new york':       'new york',
  'washington':     'washington',
  'atlanta':        'atlanta',
  'minneapolis':    'minneapolis',
  'portland':       'portland',
  'cleveland':      'cleveland',
  'detroit':        'detroit',
};

function safeJson(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return null; }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  // 60 req/min per IP — generous for a cached endpoint but prevents hammering
  if (!rateLimit(req, { max: 60, windowMs: 60_000 })) {
    return res.status(429).json({ error: 'Too many requests.' });
  }

  // Cache response for 1 hour at CDN level — data only updates via cron anyway
  res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');

  let db;
  try { db = getSupabaseAdmin(); } catch {
    // Supabase not configured — return empty so Scout falls back to static
    return res.status(200).json({ markets: {}, asOf: new Date().toISOString(), source: 'static_fallback' });
  }

  try {
    // ── 1. Computed cap rates (single row, all metros) ────────────────────────
    let liveCapRates = null;
    try {
      const { data } = await db
        .from('market_data_cache')
        .select('value, fetched_at, valid_until')
        .eq('key', 'market_cap_rates')
        .single();
      if (data && new Date(data.valid_until) > new Date()) {
        const parsed = safeJson(data.value);
        // Structure: { byMetro: { memphis: { sfr: 8.2, mfr: 9.1 }, ... }, asOf }
        liveCapRates = parsed?.byMetro || parsed || null;
      }
    } catch { /* non-fatal */ }

    // ── 2. Employment data — bulk fetch all matching keys ─────────────────────
    const empKeys = SCOUT_METROS.map(m => `employment:${m}`);
    const { data: empRows } = await db
      .from('market_data_cache')
      .select('key, value, valid_until')
      .in('key', empKeys)
      .catch(() => ({ data: [] }));

    const empByMetro = {};
    for (const row of (empRows || [])) {
      if (new Date(row.valid_until) < new Date()) continue;
      const metro = row.key.replace('employment:', '');
      const val   = safeJson(row.value);
      if (val) empByMetro[metro] = val;
    }

    // ── 3. ZORI rent growth — bulk fetch ──────────────────────────────────────
    const zoriKeys = SCOUT_METROS.map(m => `zori_rent_growth:${m}`);
    const { data: zoriRows } = await db
      .from('market_data_cache')
      .select('key, value, valid_until')
      .in('key', zoriKeys)
      .catch(() => ({ data: [] }));

    const zoriByMetro = {};
    for (const row of (zoriRows || [])) {
      if (new Date(row.valid_until) < new Date()) continue;
      const metro = row.key.replace('zori_rent_growth:', '');
      const val   = safeJson(row.value);
      if (val) zoriByMetro[metro] = val;
    }

    // ── 4. Case-Shiller — fetch keys that exist ───────────────────────────────
    const csKeys = [...new Set(Object.values(METRO_TO_CS_KEY).map(k => `case_shiller:${k}`))];
    const { data: csRows } = await db
      .from('market_data_cache')
      .select('key, value, valid_until')
      .in('key', csKeys)
      .catch(() => ({ data: [] }));

    const csByKey = {};
    for (const row of (csRows || [])) {
      if (new Date(row.valid_until) < new Date()) continue;
      const key = row.key.replace('case_shiller:', '');
      const val = safeJson(row.value);
      if (val) csByKey[key] = val;
    }

    // ── 5. Redfin city market data — listing counts + price signals ──────────
    const redfinCityKeys = SCOUT_METROS.map(m => `redfin_city:${m}`);
    const { data: redfinCityRows } = await db
      .from('market_data_cache')
      .select('key, value, valid_until')
      .in('key', redfinCityKeys)
      .catch(() => ({ data: [] }));

    const redfinCityByMetro = {};
    for (const row of (redfinCityRows || [])) {
      if (new Date(row.valid_until) < new Date()) continue;
      const metro = row.key.replace('redfin_city:', '');
      const val   = safeJson(row.value);
      if (val) redfinCityByMetro[metro] = val;
    }


    const markets = {};

    for (const metro of SCOUT_METROS) {
      const signals = {};

      // Live cap rate
      if (liveCapRates) {
        const capData = liveCapRates[metro];
        if (capData?.sfr) {
          signals.capRate    = parseFloat(capData.sfr.toFixed(1));
          signals.capRateMfr = capData.mfr ? parseFloat(capData.mfr.toFixed(1)) : null;
          signals.capRateSource = 'Census ACS + HUD SAFMR';
          signals.capRateLive = true;
        }
      }

      // Employment
      const emp = empByMetro[metro];
      if (emp) {
        signals.unemploymentRate     = emp.rate ?? null;
        signals.unemploymentNational = emp.nationalRate ?? null;
        signals.unemploymentTrend    = emp.trend ?? null;
        signals.employmentAsOf       = emp.asOf ?? null;
      }

      // ZORI rent growth
      const zori = zoriByMetro[metro];
      if (zori) {
        signals.rentGrowthPct  = zori.annualGrowthPct ?? null;
        signals.rentGrowthAsOf = zori.asOf ?? null;
      }

      // Case-Shiller
      const csKey = METRO_TO_CS_KEY[metro];
      if (csKey && csByKey[csKey]) {
        const cs = csByKey[csKey];
        signals.priceYoY   = cs.yoyPct   ?? null;
        signals.priceTrend = cs.trend     ?? null;
        signals.priceCagr3yr = cs.cagr3yr ?? null;
        signals.priceCagr5yr = cs.cagr5yr ?? null;
        signals.csAsOf     = cs.asOf      ?? null;
      }

      // Redfin city: listing count, price drops, market temp, DOM
      const rc = redfinCityByMetro[metro];
      if (rc) {
        signals.listingCount   = rc.inventory      ?? null;  // active listings
        signals.newListings    = rc.newListings     ?? null;
        signals.priceDropsPct  = rc.priceDropsPct  ?? null;  // % of listings with a price cut
        signals.marketTemp     = rc.marketTemp      ?? null;  // hot/warm/neutral/cool/cold
        signals.marketBias     = rc.marketBias      ?? null;  // buyers/sellers/neutral
        signals.dom            = rc.dom             ?? null;  // median days on market
        signals.saleToList     = rc.saleToList      ?? null;
        signals.medianListPrice = rc.medianListPrice ?? null;
        signals.redfinAsOf     = rc.asOf            ?? null;
      }

      // Only include metros that have at least one live signal
      if (Object.keys(signals).length > 0) {
        markets[metro] = signals;
      }
    }

    return res.status(200).json({
      markets,
      asOf: new Date().toISOString(),
      coverage: {
        capRates:    liveCapRates ? Object.keys(liveCapRates).length : 0,
        employment:  Object.keys(empByMetro).length,
        zori:        Object.keys(zoriByMetro).length,
        caseShiller: Object.keys(csByKey).length,
        redfinCity:  Object.keys(redfinCityByMetro).length,
      },
    });

  } catch (err) {
    console.error('[scout-markets] error:', err.message);
    return res.status(200).json({ markets: {}, asOf: new Date().toISOString(), error: err.message });
  }
}
