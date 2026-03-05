/**
 * GET /api/cron/scout-deals
 * ─────────────────────────────────────────────────────────────────────────────
 * Daily cron job — populates scout_deals with AI-discovered active listings.
 *
 * Schedule: daily at 5am UTC (before market opens, fresh data by morning)
 * Protected by CRON_SECRET header (set in Vercel environment).
 *
 * What it does:
 *   1. Takes the top 10 ranked markets from scoutMarkets.js
 *   2. For each market, fires a Gemini search-grounded query asking for
 *      active listings on Zillow/Redfin/Realtor.com
 *   3. Parses the JSON response, validates URLs and prices
 *   4. Runs RentalIQ math (cap rate, cash flow) on each listing
 *   5. Upserts into scout_deals, ignoring duplicates by listing_url
 *   6. Deletes expired deals (expires_at < now) and heavily flagged ones
 *
 * Rate: ~10 Gemini calls/day (one per market). Within free tier.
 * Runtime: ~60-90 seconds total. Vercel maxDuration = 300s.
 *
 * To run manually:
 *   curl -H "Authorization: Bearer $CRON_SECRET" https://yourapp.vercel.app/api/cron/scout-deals
 */

import { getSupabaseAdmin }  from '../../../lib/supabase.js';
import { getRankedMarkets }  from '../../../lib/scoutMarkets.js';

export const config = { maxDuration: 300 };

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_BASE    = 'https://generativelanguage.googleapis.com/v1beta/models';
const GEMINI_MODEL   = 'gemini-2.5-flash';

// Markets to crawl per cron run — top 10 by cash flow score
const MARKETS_PER_RUN = 10;
// Max listings to keep per market in Supabase
const MAX_PER_MARKET  = 8;

async function searchMarket(city, state, priceMax, beds) {
  const prompt = `Search Google for active for-sale residential investment properties in ${city}, ${state} right now. Find real, current listings on Zillow, Redfin, or Realtor.com that are NOT sold and NOT pending.

Search criteria:
- Location: ${city}, ${state}
- Price: under $${Math.round(priceMax / 1000)}k
- Bedrooms: ${beds}+ beds
- Property type: single family homes or small multi-family (duplex, triplex)
- Status: for sale, active listings only

Find up to 6 specific active listings. Return ONLY a JSON array, no explanation:
[{
  "address": "full street address including city and state",
  "price": 185000,
  "beds": 3,
  "baths": 2,
  "sqft": 1450,
  "listing_url": "https://www.zillow.com/homedetails/...",
  "source": "zillow",
  "days_on_market": 14,
  "year_built": 1987
}]

Only include listings where you can provide a real, complete URL on zillow.com, redfin.com, or realtor.com. Return [] if none found. Do not invent addresses or prices.`;

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

  const data = await res.json();
  const parts = data?.candidates?.[0]?.content?.parts || [];
  return parts.filter(p => !p.thought && p.text).map(p => p.text).join('');
}

function parseAndValidate(rawText, city, state, priceMax) {
  const clean = rawText.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  const match = clean.match(/\[[\s\S]*\]/);
  if (!match) return [];

  let arr;
  try { arr = JSON.parse(match[0]); } catch { return []; }
  if (!Array.isArray(arr)) return [];

  const validDomains = ['zillow.com', 'redfin.com', 'realtor.com'];

  return arr.filter(item => {
    if (!item.address || !item.price || !item.listing_url) return false;
    if (typeof item.price !== 'number' || item.price < 30000 || item.price > priceMax * 1.1) return false;
    if (!item.listing_url.startsWith('https://')) return false;
    if (!validDomains.some(d => item.listing_url.includes(d))) return false;
    return true;
  }).slice(0, MAX_PER_MARKET).map(item => ({
    address:        String(item.address).slice(0, 200),
    city,
    state,
    price:          Math.round(item.price),
    beds:           Math.max(1, Math.min(20, Math.round(item.beds || 3))),
    baths:          Math.max(1, Math.min(20, parseFloat(item.baths || 1))),
    sqft:           item.sqft ? Math.min(50000, Math.max(100, Math.round(item.sqft))) : null,
    listing_url:    item.listing_url,
    source:         ['zillow', 'redfin', 'realtor'].find(s => item.listing_url.includes(s + '.com')) || 'zillow',
    days_on_market: item.days_on_market ? Math.min(3650, Math.round(item.days_on_market)) : null,
    year_built:     item.year_built ? Math.min(2025, Math.max(1800, Math.round(item.year_built))) : null,
  }));
}

function computeListingMetrics(price, beds, market) {
  const rent2br   = market?.rent2br || Math.round(price / 150 / 12);
  const rentEst   = Math.max(600, Math.round(rent2br + (beds - 2) * 150));

  const vacMo     = rentEst * 0.08;
  const mgmtMo    = (rentEst - vacMo) * 0.10;
  const taxMo     = price * (market?.taxRate || 1.0) / 100 / 12;
  const insMo     = price * (market?.insRate || 1.0) / 100 / 12;
  const maintMo   = price * 0.01 / 12;
  const capexMo   = 150;
  const noiMo     = rentEst - vacMo - mgmtMo - taxMo - insMo - maintMo - capexMo;
  const capRate   = Math.max(0, Math.round((noiMo * 12 / price) * 10) / 10);

  const principal = price * 0.80;
  const r         = 0.07 / 12;
  const n         = 360;
  const mortgage  = principal * (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
  const cashFlow  = Math.round(noiMo - mortgage);

  return { estimated_rent: rentEst, cap_rate: capRate, cash_flow: cashFlow };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

export default async function handler(req, res) {
  // Auth: must have CRON_SECRET header or be called by Vercel cron
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers['authorization'] || '';
    if (auth !== `Bearer ${secret}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  if (!GEMINI_API_KEY) {
    return res.status(500).json({ error: 'GEMINI_API_KEY not configured' });
  }

  const db = getSupabaseAdmin();

  // ── Step 1: Clean up expired / flagged deals ──────────────────────────────
  const { count: deleted } = await db
    .from('scout_deals')
    .delete()
    .or(`expires_at.lt.${new Date().toISOString()},flagged_sold.gte.3`)
    .select('id', { count: 'exact' })
    .catch(() => ({ count: 0 }));

  // ── Step 2: Get top markets to search ─────────────────────────────────────
  const markets = getRankedMarkets({ goal: 'cashflow', priceMax: 400000, beds: 3 })
    .slice(0, MARKETS_PER_RUN);

  const results  = [];
  const errors   = [];
  let totalFound = 0;

  for (const market of markets) {
    try {
      // Check how many fresh deals we already have for this market
      const { count: existing } = await db
        .from('scout_deals')
        .select('id', { count: 'exact' })
        .eq('state', market.state)
        .ilike('city', `%${market.city}%`)
        .gt('expires_at', new Date().toISOString())
        .single()
        .catch(() => ({ count: 0 }));

      // Skip if we already have plenty of fresh deals for this market
      if ((existing || 0) >= MAX_PER_MARKET) {
        results.push({ market: market.city, skipped: true, reason: 'sufficient_deals' });
        continue;
      }

      const rawText  = await searchMarket(market.city, market.state, 350000, 3);
      const listings = parseAndValidate(rawText, market.city, market.state, 400000);

      if (listings.length === 0) {
        results.push({ market: market.city, found: 0 });
        await sleep(2000); // be gentle with Gemini quota
        continue;
      }

      // Compute metrics and prepare rows
      const now       = new Date();
      const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
      const rows = listings.map(l => ({
        ...l,
        ...computeListingMetrics(l.price, l.beds, market),
        first_seen:   now.toISOString(),
        expires_at:   expiresAt.toISOString(),
        flagged_sold: 0,
        search_query: `cron: ${market.city} ${market.state} under $350k 3BR`,
      }));

      const { data: inserted, error: insertErr } = await db
        .from('scout_deals')
        .upsert(rows, { onConflict: 'listing_url', ignoreDuplicates: true })
        .select('id');

      if (insertErr) {
        errors.push({ market: market.city, error: insertErr.message });
      } else {
        const count = (inserted || []).length;
        totalFound += count;
        results.push({ market: market.city, found: listings.length, stored: count });
      }

      // Respect Gemini rate limits — 2s between calls
      await sleep(2000);

    } catch (err) {
      console.error(`[scout-cron] ${market.city}:`, err.message);
      errors.push({ market: market.city, error: err.message });
      await sleep(3000); // longer pause after error
    }
  }

  return res.json({
    ok: true,
    ran: new Date().toISOString(),
    marketsSearched: markets.length,
    totalFound,
    expired: deleted || 0,
    results,
    errors,
  });
}
