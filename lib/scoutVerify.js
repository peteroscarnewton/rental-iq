/**
 * lib/scoutVerify.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Phase 3: Listing verification and confidence scoring for Scout deals.
 *
 * Since we cannot fetch Zillow/Redfin pages server-side (cloud IP blocks),
 * verification is done by asking Gemini to search for the specific address
 * and report whether it is still listed for sale.
 *
 * Confidence scoring:
 *   HIGH   — verified active within 7 days, DOM < 14 at discovery, 0 flags
 *   MEDIUM — unverified but < 14 days old, OR verified within 14 days
 *   LOW    — 14–30 days old and unverified, or DOM > 45 at discovery
 *
 * Smart expiry:
 *   DOM < 7 at discovery  → full 30-day TTL (fresh listing)
 *   DOM 7–30              → 21-day TTL
 *   DOM > 30              → 14-day TTL (already somewhat stale)
 *   DOM > 60              → 7-day TTL
 *
 * @module scoutVerify
 */

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_BASE    = 'https://generativelanguage.googleapis.com/v1beta/models';
const GEMINI_MODEL   = 'gemini-2.5-flash';

/**
 * Compute confidence level for a deal based on age and verification status.
 *
 * @param {object} deal - scout_deals row
 * @returns {'high'|'medium'|'low'}
 */
export function computeConfidence(deal) {
  const now     = Date.now();
  const age     = deal.first_seen ? Math.round((now - new Date(deal.first_seen).getTime()) / 86400000) : 999;
  const lastVer = deal.last_verified ? Math.round((now - new Date(deal.last_verified).getTime()) / 86400000) : null;
  const dom     = deal.days_on_market ?? null;
  const flags   = deal.flagged_sold ?? 0;

  // Any flags → downgrade
  if (flags >= 2) return 'low';

  // Recently verified
  if (lastVer !== null && lastVer <= 7 && flags === 0) return 'high';
  if (lastVer !== null && lastVer <= 14) return 'medium';

  // No verification yet — score by age and DOM at discovery
  if (age <= 3 && (dom === null || dom < 30)) return 'high';
  if (age <= 14 && (dom === null || dom < 45)) return 'medium';
  return 'low';
}

/**
 * Compute smart TTL (days) based on DOM at discovery.
 * Returns the Date object for expires_at.
 */
export function computeExpiry(firstSeen, daysOnMarket) {
  const base = new Date(firstSeen);
  let ttlDays;
  const dom = daysOnMarket ?? 0;

  if (dom > 60)      ttlDays = 7;
  else if (dom > 30) ttlDays = 14;
  else if (dom > 7)  ttlDays = 21;
  else               ttlDays = 30;

  return new Date(base.getTime() + ttlDays * 24 * 60 * 60 * 1000);
}

/**
 * Ask Gemini to verify whether a specific listing is still active.
 * Uses google_search grounding to find current listing status.
 *
 * Returns:
 *   { status: 'active'|'likely_sold'|'unknown', confidence: 'high'|'medium'|'low' }
 */
export async function verifyListingWithGemini(deal) {
  if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not set');

  const { address, city, state, price, listing_url, source } = deal;
  const priceK = Math.round(price / 1000);

  const prompt = `I need to verify if a specific real estate listing is still active (for sale, not sold or pending).

Property details:
- Address: ${address}, ${city}, ${state}
- Listed price: ~$${priceK}k
- Platform: ${source} (${listing_url})

Please search for this specific property right now. Check if it is:
1. Still listed as "For Sale" and active on ${source} or other platforms
2. Marked as "Sold", "Pending", "Off Market", or removed
3. Price changed significantly (might indicate it was relisted)

Respond ONLY with this JSON (no explanation):
{
  "status": "active" | "likely_sold" | "unknown",
  "reason": "one sentence explaining what you found",
  "current_price": number or null,
  "days_on_market": number or null
}

"active" = currently listed for sale
"likely_sold" = sold, pending, off market, or listing removed
"unknown" = could not find information about this specific property`;

  const payload = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    tools: [{ google_search: {} }],
    generationConfig: { temperature: 0.05, maxOutputTokens: 512 },
  };

  const res = await fetch(`${GEMINI_BASE}/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) throw new Error(`Gemini verify failed: ${res.status}`);

  const data  = await res.json();
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const text  = parts.filter(p => !p.thought && p.text).map(p => p.text).join('');

  // Parse JSON from response
  const clean = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  const match = clean.match(/\{[\s\S]*\}/);
  if (!match) return { status: 'unknown', reason: 'Could not parse response' };

  try {
    const parsed = JSON.parse(match[0]);
    const status = ['active', 'likely_sold', 'unknown'].includes(parsed.status)
      ? parsed.status
      : 'unknown';
    return {
      status,
      reason:        parsed.reason || '',
      currentPrice:  parsed.current_price || null,
      daysOnMarket:  parsed.days_on_market || null,
    };
  } catch {
    return { status: 'unknown', reason: 'Parse error' };
  }
}

/**
 * Determine which deals are due for re-verification.
 * Priority order:
 *   1. Deals with 1–2 flags (user-reported potentially sold)
 *   2. Deals older than 14 days with no verification
 *   3. Deals last verified > 7 days ago
 *
 * @param {Array} deals - array of scout_deals rows
 * @param {number} maxCount - max deals to verify in this run
 * @returns {Array} deals to verify
 */
export function selectDealsToVerify(deals, maxCount = 5) {
  const now = Date.now();

  const scored = deals.map(deal => {
    const age     = deal.first_seen ? (now - new Date(deal.first_seen).getTime()) / 86400000 : 0;
    const lastVer = deal.last_verified ? (now - new Date(deal.last_verified).getTime()) / 86400000 : 999;
    const flags   = deal.flagged_sold ?? 0;

    // Priority score — higher = more urgent to verify
    let priority = 0;
    if (flags >= 1)     priority += 100;   // flagged by users
    if (flags >= 2)     priority += 100;   // multiple flags, very urgent
    if (age > 20)       priority += 50;    // approaching expiry
    if (age > 14 && lastVer > 13) priority += 40; // old + unverified
    if (lastVer > 7)    priority += 20;    // been a while since last check

    return { deal, priority };
  });

  return scored
    .filter(s => s.priority > 0)
    .sort((a, b) => b.priority - a.priority)
    .slice(0, maxCount)
    .map(s => s.deal);
}
