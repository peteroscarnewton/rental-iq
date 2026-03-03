/**
 * Lightweight in-memory rate limiter.
 * Works per-instance on Vercel (no Redis needed for basic abuse prevention).
 * NOTE: On Vercel, each serverless function instance has its own memory, so this
 * limiter is per-instance, not global. This is intentional — it still meaningfully
 * throttles rapid requests from a single IP hitting the same warm instance.
 * For strict global rate limiting, replace this with an Upstash Redis-backed limiter.
 *
 * Usage:
 *   const allowed = rateLimit(req, { max: 10, windowMs: 60_000 });
 *   if (!allowed) return res.status(429).json({ error: 'Too many requests. Try again in a minute.' });
 */

const store = new Map(); // key → [timestamps]

/**
 * @param {import('next').NextApiRequest} req
 * @param {{ max: number, windowMs: number }} opts
 * @returns {boolean} true = allowed, false = blocked
 */
export function rateLimit(req, { max = 20, windowMs = 60_000 } = {}) {
  // Key: IP address (Vercel sets x-forwarded-for)
  const ip =
    (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    req.socket?.remoteAddress ||
    'unknown';

  const key = ip;
  const now = Date.now();
  const cutoff = now - windowMs;

  // Prune old entries and update
  const hits = (store.get(key) || []).filter(t => t > cutoff);
  hits.push(now);
  store.set(key, hits);

  // Prune the whole store occasionally to avoid memory leak
  if (store.size > 5000) {
    for (const [k, ts] of store) {
      if (!ts.some(t => t > cutoff)) store.delete(k);
    }
  }

  return hits.length <= max;
}

/**
 * Higher limit for authenticated users.
 * Pass authedMax to give logged-in users more headroom.
 */
export function rateLimitWithAuth(req, isAuthed, {
  anonMax   = 5,
  authedMax = 20,
  windowMs  = 60_000,
} = {}) {
  return rateLimit(req, { max: isAuthed ? authedMax : anonMax, windowMs });
}
