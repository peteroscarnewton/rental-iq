/**
 * /api/scout-deals
 * ─────────────────────────────────────────────────────────────────────────────
 * Serves AI-discovered rental deals from the scout_deals Supabase table.
 *
 * Two modes:
 *   1. GET ?city=Memphis&state=TN&priceMax=350000&beds=3
 *      Returns cached deals matching filters. No token cost. Shows what we have.
 *
 *   2. POST { city, state, priceMax, beds, propType, goal, fp }
 *      Triggers a LIVE Gemini search for this market. Costs 1 token (or 1 free use).
 *      Results are stored in scout_deals and returned immediately.
 *      - Authenticated users: 1 token deducted
 *      - Unauthenticated guests: fingerprint-checked via /api/guest-usage
 *
 * Token gate:
 *   - Signed-in users: 1 token per POST (same pool as /api/analyze)
 *   - New users: 2 tokens on signup (1 analyze + 1 scout)
 *   - Guests: 1 free POST per device fingerprint, tracked in guest_usage table
 *
 * Gemini search grounding:
 *   Sends a structured prompt with google_search tool enabled.
 *   Gemini searches for active Zillow/Redfin/Realtor listings and returns JSON.
 *   We validate URLs, compute cap rate / cash flow, store in scout_deals.
 *
 * Rate limits:
 *   - 3 POST/minute per IP (prevents rapid hammering)
 *   - 20 GET/minute per IP
 */

import { getSupabaseAdmin }     from '../../lib/supabase.js';
import { getServerSession }     from 'next-auth/next';
import { authOptions }          from './auth/[...nextauth].js';
import { rateLimitWithAuth, rateLimit } from '../../lib/rateLimit.js';
import { getRankedMarkets }     from '../../lib/scoutMarkets.js';
import { computeConfidence, computeExpiry } from '../../lib/scoutVerify.js';

export const config = { api: { bodyParser: true }, maxDuration: 45 };

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_BASE    = 'https://generativelanguage.googleapis.com/v1beta/models';
const GEMINI_MODEL   = 'gemini-2.5-flash';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function hashIp(ip) {
  let h = 5381;
  for (let i = 0; i < ip.length; i++) h = (h * 33 ^ ip.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, '0');
}

function getClientIp(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
    || req.socket?.remoteAddress || 'unknown';
}

/**
 * Run Gemini with google_search grounding to find active listings.
 * Returns raw Gemini response text.
 */
async function searchListingsWithGemini(city, state, priceMax, beds, propType) {
  const propLabel = propType === 'mfr' ? 'multi-family duplex triplex or small apartment' : 'single family home';
  const priceK    = Math.round(priceMax / 1000);
  const maxCapex  = priceMax;

  const prompt = `Search for active for-sale residential investment properties in ${city}, ${state} right now on Zillow, Redfin, or Realtor.com. I need real, active listings — not sold, not pending.

Criteria:
- Location: ${city}, ${state}
- Property type: ${propLabel}
- Price: under $${priceK}k (max $${maxCapex})
- Bedrooms: ${beds}+ bedrooms
- Listed for sale (active listings only, not rentals)

Search Zillow, Redfin, and Realtor.com for matching properties. Find up to 8 specific active listings.

Return ONLY a JSON array (no markdown, no explanation, just the array). Each item must have:
{
  "address": "full street address",
  "city": "${city}",
  "state": "${state}",
  "price": integer (number only, no $),
  "beds": integer,
  "baths": number,
  "sqft": integer or null,
  "listing_url": "full https URL to the listing on zillow.com, redfin.com, or realtor.com",
  "source": "zillow" | "redfin" | "realtor",
  "days_on_market": integer or null,
  "year_built": integer or null
}

Only include listings where you found a real URL on one of those three platforms. Do not fabricate addresses or prices. If you cannot find enough real listings, return fewer items. Return [] if none found.`;

  const payload = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    tools: [{ google_search: {} }],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 4096,
    },
  };

  const res = await fetch(`${GEMINI_BASE}/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(40000),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => res.status);
    throw new Error(`Gemini search failed: ${err}`);
  }

  const data = await res.json();
  const parts = data?.candidates?.[0]?.content?.parts || [];
  // Get the last text part (thinking models may prefix with thought blocks)
  const text = parts.filter(p => !p.thought && p.text).map(p => p.text).join('');
  return text;
}

/**
 * Parse Gemini's JSON response into validated listing objects.
 */
function parseListings(rawText) {
  // Strip markdown code blocks if present
  const clean = rawText.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  // Find JSON array
  const arrayMatch = clean.match(/\[[\s\S]*\]/);
  if (!arrayMatch) return [];

  let arr;
  try { arr = JSON.parse(arrayMatch[0]); } catch { return []; }
  if (!Array.isArray(arr)) return [];

  const validSources = ['zillow', 'redfin', 'realtor'];
  const validDomains = ['zillow.com', 'redfin.com', 'realtor.com'];

  return arr.filter(item => {
    if (!item.address || !item.price || !item.listing_url) return false;
    if (typeof item.price !== 'number' || item.price < 50000 || item.price > 5000000) return false;
    if (!item.listing_url.startsWith('https://')) return false;
    // Validate URL is from a trusted platform
    const domain = validDomains.find(d => item.listing_url.includes(d));
    if (!domain) return false;
    if (!item.beds || item.beds < 1) return false;
    return true;
  }).map(item => ({
    address:      String(item.address).slice(0, 200),
    city:         String(item.city || '').slice(0, 100),
    state:        String(item.state || '').slice(0, 2).toUpperCase(),
    price:        Math.round(item.price),
    beds:         Math.min(20, Math.max(1, Math.round(item.beds))),
    baths:        Math.min(20, Math.max(1, parseFloat(item.baths) || 1)),
    sqft:         item.sqft ? Math.min(50000, Math.max(100, Math.round(item.sqft))) : null,
    listing_url:  item.listing_url,
    source:       validSources.find(s => item.listing_url.includes(s + '.com')) || 'zillow',
    days_on_market: item.days_on_market ? Math.min(3650, Math.max(0, Math.round(item.days_on_market))) : null,
    year_built:   item.year_built ? Math.min(2025, Math.max(1800, Math.round(item.year_built))) : null,
  }));
}

/**
 * Estimate monthly rent for a city/beds combo using HUD FMR from scoutMarkets.
 * Falls back to a rough price/160 estimate if market not in our table.
 */
function estimateRent(city, beds, price) {
  // Pull from our metro rent table via getRankedMarkets
  const markets = getRankedMarkets({ beds, priceMax: price * 2, minCapRate: 0, minLandlord: 0 });
  const match   = markets.find(m => m.city.toLowerCase() === city.toLowerCase());
  if (match?.rent2br) {
    // Adjust for bed count (rough: each bed ~$150/mo)
    const adj = Math.round(match.rent2br + (beds - 2) * 150);
    return Math.max(600, adj);
  }
  // Fallback: gross rent multiplier ~150 (conservative)
  return Math.round(price / 150 / 12);
}

// State-specific annual rates (%) for accurate cap rate / cash flow estimation
const STATE_TAX_RATES = {
  AL:0.41,AK:1.04,AZ:0.63,AR:0.64,CA:0.75,CO:0.51,CT:1.79,DE:0.57,FL:0.91,GA:0.91,
  HI:0.30,ID:0.47,IL:2.08,IN:0.85,IA:1.57,KS:1.41,KY:0.86,LA:0.56,ME:1.09,MD:1.09,
  MA:1.17,MI:1.32,MN:1.12,MS:0.78,MO:1.01,MT:0.74,NE:1.73,NV:0.55,NH:1.89,NJ:2.23,
  NM:0.80,NY:1.73,NC:0.82,ND:0.98,OH:1.56,OK:0.90,OR:0.97,PA:1.49,RI:1.53,SC:0.57,
  SD:1.14,TN:0.67,TX:1.63,UT:0.58,VT:1.83,VA:0.82,WA:0.98,WV:0.59,WI:1.61,WY:0.61,DC:0.55,
};
const STATE_INS_RATES = {
  AL:1.65,AK:0.85,AZ:0.78,AR:1.45,CA:0.80,CO:0.95,CT:1.25,DE:0.80,FL:3.50,GA:1.45,
  HI:0.35,ID:0.68,IL:1.15,IN:0.95,IA:0.95,KS:1.55,KY:1.25,LA:3.20,ME:0.78,MD:0.92,
  MA:1.10,MI:1.35,MN:1.15,MS:1.95,MO:1.45,MT:0.85,NE:1.55,NV:0.65,NH:0.75,NJ:1.05,
  NM:0.85,NY:1.15,NC:1.15,ND:0.95,OH:0.88,OK:2.35,OR:0.62,PA:0.85,RI:1.35,SC:1.55,
  SD:1.15,TN:1.25,TX:2.20,UT:0.62,VT:0.72,VA:0.78,WA:0.68,WV:0.82,WI:0.92,WY:0.75,DC:0.72,
};

/**
 * Compute estimated cap rate and cash flow for a listing.
 */
function computeMetrics(listing, estimatedRent) {
  const { price, state } = listing;
  const rent = estimatedRent;
  const st = (state || '').toUpperCase();

  // Cap rate: NOI / price — use state-specific rates for accuracy
  const vacancyAmt  = rent * 0.08;
  const mgmtAmt     = (rent - vacancyAmt) * 0.10;
  const taxAmt      = price * ((STATE_TAX_RATES[st] || 1.0) / 100) / 12;
  const insAmt      = price * ((STATE_INS_RATES[st] || 1.0) / 100) / 12;
  const maintAmt    = price * 0.01 / 12;
  const capexAmt    = 150;
  const noiMo       = rent - vacancyAmt - mgmtAmt - taxAmt - insAmt - maintAmt - capexAmt;
  const capRate     = Math.round((noiMo * 12 / price) * 1000) / 10; // one decimal

  // Cash flow: NOI minus mortgage
  const principal   = price * 0.80;
  const r           = 0.07 / 12;
  const n           = 360;
  const mortgage    = principal * (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
  const cashFlow    = Math.round(noiMo - mortgage);

  return { capRate: Math.max(0, capRate), cashFlow, estimatedRent: rent };
}

/**
 * Store validated listings in scout_deals, skipping duplicates by URL.
 */
async function storeDeals(db, listings, city, state, searchQuery) {
  const now       = new Date();
  const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 days

  const rows = listings.map(l => {
    const estimatedRent = estimateRent(l.city || city, l.beds, l.price);
    const metrics       = computeMetrics(l, estimatedRent);
    const smartExpiry   = computeExpiry(now, l.days_on_market);
    const initConf      = computeConfidence({ first_seen: now, days_on_market: l.days_on_market, flagged_sold: 0, last_verified: null });
    return {
      city:            l.city || city,
      state:           l.state || state,
      address:         l.address,
      price:           l.price,
      beds:            l.beds,
      baths:           l.baths,
      sqft:            l.sqft,
      estimated_rent:  estimatedRent,
      cap_rate:        metrics.capRate,
      cash_flow:       metrics.cashFlow,
      listing_url:     l.listing_url,
      source:          l.source,
      days_on_market:  l.days_on_market,
      year_built:      l.year_built,
      status:          'unverified',
      confidence:      initConf,
      last_verified:   null,
      verify_count:    0,
      first_seen:      now.toISOString(),
      expires_at:      smartExpiry.toISOString(),
      flagged_sold:    0,
      search_query:    searchQuery,
    };
  });

  if (!rows.length) return [];

  // Upsert — on conflict (listing_url), update first_seen only if it was null
  const { data, error } = await db
    .from('scout_deals')
    .upsert(rows, { onConflict: 'listing_url', ignoreDuplicates: true })
    .select();

  if (error) {
    console.error('[scout-deals] store error:', error);
    return [];
  }
  return data || rows;
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export default async function handler(req, res) {

  // ── GET: serve cached deals ───────────────────────────────────────────────
  if (req.method === 'GET') {
    if (!rateLimit(req, { max: 20, windowMs: 60_000 })) {
      return res.status(429).json({ error: 'Too many requests.' });
    }

    const { city, state, priceMax = 350000, beds = 3 } = req.query;

    try {
      const db = getSupabaseAdmin();
      let query = db
        .from('scout_deals')
        .select('*')
        .gt('expires_at', new Date().toISOString())
        .lt('flagged_sold', 3)
        .neq('status', 'likely_sold')
        .order('cap_rate', { ascending: false })
        .limit(20);

      if (city)     query = query.ilike('city', `%${city}%`);
      if (state)    query = query.eq('state', state.toUpperCase());
      if (priceMax) query = query.lte('price', parseInt(priceMax));
      if (beds)     query = query.gte('beds', parseInt(beds));

      const { data, error } = await query;
      if (error) throw error;

      return res.json({ deals: data || [], count: (data || []).length });
    } catch (err) {
      console.error('[scout-deals GET]', err);
      return res.status(500).json({ error: 'Could not fetch deals.' });
    }
  }

  // ── POST: trigger live AI search ──────────────────────────────────────────
  if (req.method === 'POST') {
    // Strict rate limit on live searches (expensive)
    if (!rateLimit(req, { max: 3, windowMs: 60_000 })) {
      return res.status(429).json({ error: 'Too many requests. Wait a moment.' });
    }

    const { city, state, priceMax = 350000, beds = 3, propType = 'sfr', goal = 'cashflow', fp } = req.body || {};
    if (!city || !state) return res.status(400).json({ error: 'city and state are required.' });

    const db = getSupabaseAdmin();

    // ── Auth / token gate ──────────────────────────────────────────────────
    let isAuthed     = false;
    let userId       = null;
    let tokenBalance = 0;
    let isGuestFree  = false;

    try {
      const session = await getServerSession(req, res, authOptions);
      if (session?.user?.id) {
        isAuthed = true;
        userId   = session.user.id;
        const { data: user } = await db.from('users').select('tokens').eq('id', userId).single();
        tokenBalance = user?.tokens || 0;
      }
    } catch {}

    if (isAuthed) {
      // Authenticated user: check token balance
      if (tokenBalance < 1) {
        return res.status(402).json({
          error: 'No tokens remaining.',
          code: 'NO_TOKENS',
          tokens: 0,
        });
      }
    } else {
      // Guest: check fingerprint-based free use
      if (!fp || !/^[0-9a-f]{32}$/i.test(fp)) {
        return res.status(401).json({ error: 'Sign in to search for deals.', code: 'UNAUTHENTICATED' });
      }

      // Check if guest has used their free scout search
      const { data: guestRow } = await db
        .from('guest_usage')
        .select('used_scout')
        .eq('fingerprint', fp)
        .single();

      if (guestRow?.used_scout) {
        return res.status(402).json({
          error: 'You have used your free AI search. Sign in for more.',
          code: 'GUEST_USED',
        });
      }

      // Check IP daily cap
      const ip     = getClientIp(req);
      const ipHash = hashIp(ip);
      const today  = new Date().toISOString().slice(0, 10);
      const { data: ipRow } = await db.from('guest_ip_usage').select('use_count').eq('ip_hash', ipHash).eq('use_date', today).single();
      if (ipRow && ipRow.use_count >= 8) {
        return res.status(402).json({ error: 'Daily limit reached. Sign in to continue.', code: 'IP_CAP' });
      }

      isGuestFree = true;
    }

    // ── Run Gemini search ──────────────────────────────────────────────────
    const searchQuery = `${beds}BR ${propType === 'mfr' ? 'multifamily' : 'SFR'} for sale in ${city} ${state} under $${priceMax}`;

    let rawText = '';
    try {
      rawText = await searchListingsWithGemini(city, state, priceMax, beds, propType);
    } catch (err) {
      console.error('[scout-deals] Gemini search error:', err.message);
      return res.status(500).json({ error: 'AI search temporarily unavailable. Try again in a moment.' });
    }

    // Parse and validate listings
    const listings = parseListings(rawText);

    // Store in Supabase (even if 0 results, so we know we searched)
    let stored = [];
    if (listings.length > 0) {
      stored = await storeDeals(db, listings, city, state, searchQuery);
    }

    // ── Deduct token / consume free use AFTER successful search ────────────
    if (isAuthed && userId) {
      await db.rpc('deduct_token', { p_user_id: userId }).catch(async () => {
        const { data: u } = await db.from('users').select('tokens').eq('id', userId).single();
        if (u) await db.from('users').update({ tokens: Math.max(0, u.tokens - 1) }).eq('id', userId);
      });
    } else if (isGuestFree && fp) {
      const ip     = getClientIp(req);
      const ipHash = hashIp(ip);
      const today  = new Date().toISOString().slice(0, 10);
      // Mark fingerprint as used
      const { data: existing } = await db.from('guest_usage').select('id').eq('fingerprint', fp).single();
      if (existing) {
        await db.from('guest_usage').update({ used_scout: true, last_seen: new Date().toISOString() }).eq('fingerprint', fp);
      } else {
        await db.from('guest_usage').insert({ fingerprint: fp, ip_hash: ipHash, used_scout: true });
      }
      // Increment IP counter
      const { data: ipRow } = await db.from('guest_ip_usage').select('use_count').eq('ip_hash', ipHash).eq('use_date', today).single();
      if (ipRow) {
        await db.from('guest_ip_usage').update({ use_count: ipRow.use_count + 1 }).eq('ip_hash', ipHash).eq('use_date', today);
      } else {
        await db.from('guest_ip_usage').insert({ ip_hash: ipHash, use_date: today, use_count: 1 });
      }
    }

    // Return results
    const deals = stored.length > 0 ? stored : listings.map(l => ({
      ...l,
      estimated_rent: estimateRent(l.city || city, l.beds, l.price),
      ...computeMetrics(l, estimateRent(l.city || city, l.beds, l.price)),
    }));

    return res.json({
      deals,
      count: deals.length,
      searchQuery,
      tokensRemaining: isAuthed ? Math.max(0, tokenBalance - 1) : null,
      isGuestFree,
    });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
