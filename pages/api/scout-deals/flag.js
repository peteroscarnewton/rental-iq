/**
 * POST /api/scout-deals/flag
 * Increments flagged_sold on a deal. Deals with 3+ flags are hidden.
 * Rate limited to prevent abuse.
 */
import { rateLimit }       from '../../../lib/rateLimit.js';
import { getSupabaseAdmin } from '../../../lib/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!rateLimit(req, { max: 5, windowMs: 60_000 })) return res.status(429).json({ error: 'Too many requests.' });

  const { id } = req.body || {};
  if (!id) return res.status(400).json({ error: 'id required' });

  // Validate UUID format — prevents injection and enumeration of non-UUID IDs
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!UUID_RE.test(id)) return res.status(400).json({ error: 'Invalid id format' });

  try {
    const db = getSupabaseAdmin();
    const { data: deal } = await db.from('scout_deals').select('flagged_sold').eq('id', id).single();
    if (!deal) return res.status(404).json({ error: 'Deal not found' });

    await db.from('scout_deals').update({ flagged_sold: (deal.flagged_sold || 0) + 1 }).eq('id', id);
    return res.json({ ok: true });
  } catch (err) {
    console.error('[flag]', err);
    return res.status(500).json({ error: 'Failed to flag' });
  }
}
