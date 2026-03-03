// /api/deals/public/[token] - fetch a publicly shared deal by share_token (no auth needed)
// GET /api/deals/public?token=abc123 → { deal }

import { getSupabaseAdmin }   from '../../../lib/supabase';
import { rateLimitWithAuth }  from '../../../lib/rateLimit.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  // Light rate limit - prevents token enumeration/scraping
  if (!rateLimitWithAuth(req, false, { anonMax: 60, authedMax: 60, windowMs: 60_000 })) {
    return res.status(429).json({ error: 'Too many requests.' });
  }

  const { token } = req.query;
  if (!token) return res.status(400).json({ error: 'token required' });

  try {
    const db = getSupabaseAdmin();
    const { data: deal, error } = await db
      .from('deals')
      .select('id, address, city, verdict, score, price, rent, cashflow, coc, data, created_at')
      .eq('share_token', token)
      .eq('is_public', true)
      .single();

    if (error || !deal) return res.status(404).json({ error: 'Deal not found or no longer shared' });

    return res.status(200).json({ deal });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to load deal' });
  }
}
