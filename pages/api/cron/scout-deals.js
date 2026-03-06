/**
 * GET /api/cron/scout-deals
 * ─────────────────────────────────────────────────────────────────────────────
 * Phase 3: Daily cron for Scout deal discovery + listing verification.
 *
 * Schedule: daily at 5am UTC
 * Protected by CRON_SECRET header.
 *
 * Phase 3 improvements over Phase 2:
 *   1. Rolling market coverage — all 40 markets covered weekly (~6/day)
 *      instead of always hitting the same top 10
 *   2. Smart TTL — listings with DOM > 30 expire faster (14 days vs 30 days)
 *   3. Verification pass — re-asks Gemini about flagged/aging listings
 *      to confirm still active before they expire
 *   4. status + confidence fields — 'active'|'likely_sold'|'unverified'
 *   5. search_history tracking — records when each market was last searched
 *
 * Run budget: ~10 Gemini calls for discovery + ~5 for verification = 15 total
 * Runtime: ~90-120 seconds. Vercel maxDuration = 300s.
 *
 * Manual trigger:
 *   curl -H "Authorization: Bearer $CRON_SECRET" https://yourapp.vercel.app/api/cron/scout-deals
 */

import { getSupabaseAdmin }    from '../../../lib/supabase.js';
import { getRankedMarkets }    from '../../../lib/scoutMarkets.js';
import {
  computeConfidence,
  computeExpiry,
  verifyListingWithGemini,
  selectDealsToVerify,
}                               from '../../../lib/scoutVerify.js';

export const config = { maxDuration: 300 };

const GEMINI_API_KEY      = process.env.GEMINI_API_KEY;
const GEMINI_BASE         = 'https://generativelanguage.googleapis.com/v1beta/models';
const GEMINI_MODEL        = 'gemini-2.5-flash';

// How many markets to search per daily cron run
// 40 total markets / 7 days = ~6/day to cover all weekly
const MARKETS_PER_RUN      = 6;
// Max listings per market stored in Supabase
const MAX_PER_MARKET       = 8;
// Max listings to verify per run (Gemini quota protection)
const MAX_VERIFY_PER_RUN   = 5;
// Don't re-search a market more than once every 5 days
const MIN_SEARCH_INTERVAL_DAYS = 5;

// ─── Gemini search ────────────────────────────────────────────────────────────
async function searchMarket(city, state, priceMax, beds) {
  const prompt = `Search Google for active for-sale residential investment properties in ${city}, ${state}. Find real, current listings on Zillow, Redfin, or Realtor.com that are actively for sale right now — NOT sold, NOT pending.

Criteria:
- Location: ${city}, ${state}
- Price: under $${Math.round(priceMax / 1000)}k
- Bedrooms: ${beds}+ beds
- Single family homes or small multi-family (duplex, triplex)
- Status: for sale — active only

Find up to 6 specific listings and return ONLY a JSON array, no explanation:
[{
  "address": "full street address",
  "price": 185000,
  "beds": 3,
  "baths": 2,
  "sqft": 1450,
  "listing_url": "https://www.zillow.com/homedetails/...",
  "source": "zillow",
  "days_on_market": 14,
  "year_built": 1987
}]

Only include listings with a real, complete URL on zillow.com, redfin.com, or realtor.com.
Return [] if no verified listings found. Never invent addresses or prices.`;

  const payload = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    tools: [{ google_search: {} }],
    generationConfig: { temperature: 0.05, maxOutputTokens: 3000 },
  };

  const res = await fetch(`${GEMINI_BASE}/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(35000),
  });

  if (!res.ok) throw new Error(`Gemini ${res.status}`);
  const data  = await res.json();
  const parts = data?.candidates?.[0]?.content?.parts || [];
  return parts.filter(p => !p.thought && p.text).map(p => p.text).join('');
}

// ─── Parse + validate ─────────────────────────────────────────────────────────
function parseListings(rawText, priceMax) {
  const clean = rawText.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  const match = clean.match(/\[[\s\S]*\]/);
  if (!match) return [];
  let arr;
  try { arr = JSON.parse(match[0]); } catch { return []; }
  if (!Array.isArray(arr)) return [];

  const validDomains = ['zillow.com', 'redfin.com', 'realtor.com'];
  return arr.filter(item =>
    item.address && item.price &&
    typeof item.price === 'number' &&
    item.price >= 30000 && item.price <= priceMax * 1.1 &&
    item.listing_url?.startsWith('https://') &&
    validDomains.some(d => item.listing_url.includes(d))
  ).slice(0, MAX_PER_MARKET).map(item => ({
    address:       String(item.address).slice(0, 200),
    price:         Math.round(item.price),
    beds:          Math.max(1, Math.min(20, Math.round(item.beds || 3))),
    baths:         Math.max(1, Math.min(20, parseFloat(item.baths || 1))),
    sqft:          item.sqft ? Math.min(50000, Math.max(100, Math.round(item.sqft))) : null,
    listing_url:   item.listing_url,
    source:        ['zillow', 'redfin', 'realtor'].find(s => item.listing_url.includes(s + '.com')) || 'zillow',
    days_on_market: item.days_on_market ? Math.min(3650, Math.round(item.days_on_market)) : null,
    year_built:    item.year_built ? Math.min(2025, Math.max(1800, Math.round(item.year_built))) : null,
  }));
}

// ─── Metrics ──────────────────────────────────────────────────────────────────
function computeMetrics(price, beds, market) {
  const rent2br  = market?.rent2br || Math.round(price / 150 / 12);
  const rentEst  = Math.max(600, Math.round(rent2br + (beds - 2) * 150));
  const vacMo    = rentEst * 0.08;
  const mgmtMo   = (rentEst - vacMo) * 0.10;
  const taxMo    = price * (market?.taxRate || 1.0) / 100 / 12;
  const insMo    = price * (market?.insRate  || 1.0) / 100 / 12;
  const maintMo  = price * 0.01 / 12;
  const capexMo  = 150;
  const noiMo    = rentEst - vacMo - mgmtMo - taxMo - insMo - maintMo - capexMo;
  const capRate  = Math.max(0, Math.round((noiMo * 12 / price) * 10) / 10);
  const principal = price * 0.80;
  const r        = 0.07 / 12;
  const n        = 360;
  const mortgage = principal * (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
  return {
    estimated_rent: rentEst,
    cap_rate:       capRate,
    cash_flow:      Math.round(noiMo - mortgage),
  };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── Select which markets to search today ─────────────────────────────────────
async function selectMarketsForToday(db, allMarkets) {
  const cutoff = new Date(Date.now() - MIN_SEARCH_INTERVAL_DAYS * 24 * 60 * 60 * 1000).toISOString();

  // Get recently searched markets
  const { data: recentSearches } = await db
    .from('scout_search_history')
    .select('city, state, searched_at')
    .gt('searched_at', cutoff)
    .order('searched_at', { ascending: false });

  const recentKeys = new Set(
    (recentSearches || []).map(r => `${r.city.toLowerCase()}-${r.state}`)
  );

  // Prioritise: not recently searched, higher score
  const eligible = allMarkets.filter(m =>
    !recentKeys.has(`${m.city.toLowerCase()}-${m.state}`)
  );

  // If all markets searched recently, fall back to least-recently-searched
  if (eligible.length === 0) {
    const lastSearchedMap = {};
    (recentSearches || []).forEach(r => {
      const key = `${r.city.toLowerCase()}-${r.state}`;
      if (!lastSearchedMap[key]) lastSearchedMap[key] = r.searched_at;
    });
    return allMarkets
      .sort((a, b) => {
        const ka = `${a.city.toLowerCase()}-${a.state}`;
        const kb = `${b.city.toLowerCase()}-${b.state}`;
        return (lastSearchedMap[ka] || '0') < (lastSearchedMap[kb] || '0') ? -1 : 1;
      })
      .slice(0, MARKETS_PER_RUN);
  }

  return eligible.slice(0, MARKETS_PER_RUN);
}

// ─── Handler ──────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    if (req.headers['authorization'] !== `Bearer ${secret}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }
  if (!GEMINI_API_KEY) return res.status(500).json({ error: 'GEMINI_API_KEY not set' });

  const db      = getSupabaseAdmin();
  const now     = new Date();
  const results = { discovery: [], verification: [], cleanup: {} };

  // ── Step 1: Cleanup — expired + heavily flagged ────────────────────────────
  const { count: expiredCount } = await db
    .from('scout_deals')
    .delete()
    .or(`expires_at.lt.${now.toISOString()},flagged_sold.gte.3`)
    .select('id', { count: 'exact' })
    .catch(() => ({ count: 0 }));
  results.cleanup.expired = expiredCount || 0;

  // Also update likely_sold listings that are 3+ days old with that status → reduce TTL
  await db
    .from('scout_deals')
    .update({ expires_at: new Date(now.getTime() + 3 * 86400000).toISOString() })
    .eq('status', 'likely_sold')
    .gt('expires_at', new Date(now.getTime() + 3 * 86400000).toISOString())
    .catch(() => {});

  // ── Step 2: Verification pass — check aging/flagged listings ──────────────
  const { data: verifyQueue } = await db
    .from('scout_deals')
    .select('*')
    .gt('expires_at', now.toISOString())
    .lt('flagged_sold', 3)
    .neq('status', 'likely_sold')
    .order('flagged_sold', { ascending: false })
    .order('first_seen', { ascending: true })
    .limit(50);

  const toVerify = selectDealsToVerify(verifyQueue || [], MAX_VERIFY_PER_RUN);

  for (const deal of toVerify) {
    try {
      const result = await verifyListingWithGemini(deal);
      const newConfidence = result.status === 'active' ? 'high'
        : result.status === 'likely_sold' ? 'low'
        : computeConfidence({ ...deal, last_verified: now.toISOString() });

      await db.from('scout_deals').update({
        status:        result.status === 'unknown' ? 'unverified' : result.status,
        confidence:    newConfidence,
        last_verified: now.toISOString(),
        verify_count:  (deal.verify_count || 0) + 1,
        // If Gemini confirms sold, accelerate expiry to 3 days
        ...(result.status === 'likely_sold' ? {
          expires_at: new Date(now.getTime() + 3 * 86400000).toISOString(),
        } : {}),
        // Update DOM if Gemini found fresh info
        ...(result.daysOnMarket ? { days_on_market: result.daysOnMarket } : {}),
      }).eq('id', deal.id);

      results.verification.push({
        address: deal.address,
        city: deal.city,
        status: result.status,
        reason: result.reason,
      });

      await sleep(2000); // pace Gemini calls
    } catch (err) {
      console.error(`[scout-cron verify] ${deal.address}:`, err.message);
      results.verification.push({ address: deal.address, error: err.message });
      await sleep(3000);
    }
  }

  // ── Step 3: Discovery — search markets not recently covered ───────────────
  const allMarkets  = getRankedMarkets({ goal: 'cashflow', priceMax: 400000, beds: 3 });
  const todayMarkets = await selectMarketsForToday(db, allMarkets);

  for (const market of todayMarkets) {
    const marketResult = { market: market.city, state: market.state };
    try {
      // Check fresh inventory already in DB
      const { count: existing } = await db
        .from('scout_deals')
        .select('id', { count: 'exact', head: true })
        .ilike('city', `%${market.city}%`)
        .eq('state', market.state)
        .gt('expires_at', now.toISOString())
        .neq('status', 'likely_sold');

      if ((existing || 0) >= MAX_PER_MARKET) {
        marketResult.skipped = true;
        marketResult.reason  = `${existing} fresh deals already in DB`;
        results.discovery.push(marketResult);
        continue;
      }

      const rawText  = await searchMarket(market.city, market.state, 350000, 3);
      const listings = parseListings(rawText, 400000);
      marketResult.found = listings.length;

      if (listings.length > 0) {
        const expiresAt = computeExpiry(now, null); // default: 30 days (DOM not known yet)
        const rows = listings.map(l => {
          const metrics  = computeMetrics(l.price, l.beds, market);
          const initConf = computeConfidence({ first_seen: now, days_on_market: l.days_on_market, flagged_sold: 0, last_verified: null });
          const smartExpiry = computeExpiry(now, l.days_on_market);
          return {
            ...l,
            city:           market.city,
            state:          market.state,
            ...metrics,
            status:         'unverified',
            confidence:     initConf,
            last_verified:  null,
            verify_count:   0,
            first_seen:     now.toISOString(),
            expires_at:     smartExpiry.toISOString(),
            flagged_sold:   0,
            search_query:   `cron-p3: ${market.city} ${market.state} under $350k 3BR`,
          };
        });

        const { data: inserted } = await db
          .from('scout_deals')
          .upsert(rows, { onConflict: 'listing_url', ignoreDuplicates: true })
          .select('id');

        marketResult.stored = (inserted || []).length;
      }

      // Record search history
      await db.from('scout_search_history').insert({
        city:        market.city,
        state:       market.state,
        searched_at: now.toISOString(),
        found_count: listings.length,
        query:       `${market.city} ${market.state} SFR under $350k 3BR`,
      }).catch(() => {});

      results.discovery.push(marketResult);
      await sleep(2000);

    } catch (err) {
      console.error(`[scout-cron] ${market.city}:`, err.message);
      results.discovery.push({ ...marketResult, error: err.message });
      await sleep(3000);
    }
  }

  return res.json({
    ok:           true,
    ran:          now.toISOString(),
    marketsSearched: todayMarkets.length,
    verified:     toVerify.length,
    ...results,
  });
}
