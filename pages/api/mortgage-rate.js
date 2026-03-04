/**
 * GET /api/mortgage-rate
 * ─────────────────────────────────────────────────────────────────────────────
 * Legacy compatibility endpoint — now a thin wrapper around /api/market-data.
 * Returns just the 30yr rate in the original response shape for backward compat.
 * New code should call /api/market-data instead (all rates + full market data).
 *
 * Response: { rate, source, asOf, cached }
 */

import { getMarketData } from '../../lib/marketData.js';
import { rateLimit } from '../../lib/rateLimit.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!rateLimit(req, { max: 30, windowMs: 60_000 })) return res.status(429).json({ error: 'Too many requests. Please wait a minute.' });


  try {
    const md = await getMarketData();
    const { rate30yr, asOf, source } = md.mortgageRates ?? {};
    return res.status(200).json({
      rate:   rate30yr ?? 6.87,
      source: source   ?? 'baseline',
      asOf:   asOf     ?? '2026-02-20',
      cached: md.source === 'supabase_cache',
    });
  } catch (err) {
    return res.status(200).json({ rate: 6.87, source: 'fallback', asOf: '2026-02-20', cached: false });
  }
}
