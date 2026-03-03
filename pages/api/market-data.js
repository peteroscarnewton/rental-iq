/**
 * GET /api/market-data
 * Returns the full cached market data object for client-side consumption.
 * The heavy lifting (Supabase reads, FRED fetches) happens in the cron job.
 * This endpoint is a lightweight cache reader only — always fast, never fails.
 *
 * Response shape:
 * {
 *   mortgageRates: { rate30yr, rate15yr, rate5arm, asOf, source },
 *   rentGrowthDefault: 3.2,
 *   rentGrowthAsOf: "2026-01",
 *   stateTaxRates: { TX: 1.80, ... },
 *   stateInsRates: { FL: 2.10, ... },
 *   stateAppreciation: { TX: 4.2, ... },
 *   cityAppreciation: { austin: 3.2, ... },
 *   freshness: { mortgageRates: "2026-02-27T...", ... },
 *   source: "supabase_cache" | "baseline"
 * }
 */

import { getMarketData } from '../../lib/marketData.js';

export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  try {
    const md = await getMarketData();
    // Cache-control: clients can cache for 1 hour; CDN can cache for 30 min
    res.setHeader('Cache-Control', 'public, s-maxage=1800, stale-while-revalidate=3600');
    return res.status(200).json(md);
  } catch (err) {
    console.error('[market-data] error:', err.message);
    return res.status(500).json({ error: 'Failed to load market data' });
  }
}
