import { getServerSession } from 'next-auth/next';
import { authOptions } from '../auth/[...nextauth]';
import { getSupabaseAdmin } from '../../../lib/supabase';
import { rateLimitWithAuth } from '../../../lib/rateLimit.js';

export default async function handler(req, res) {
  if (!['GET','DELETE','PATCH'].includes(req.method)) return res.status(405).json({ error: 'Method not allowed' });

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.id) return res.status(401).json({ error: 'Not authenticated' });

  if (!rateLimitWithAuth(req, true, { authedMax: 30, windowMs: 60_000 })) {
    return res.status(429).json({ error: 'Too many requests. Please wait a minute.' });
  }

  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'Missing deal id' });

  // -- DELETE ----------------------------------------------------------------
  if (req.method === 'DELETE') {
    try {
      const db = getSupabaseAdmin();
      const { error } = await db
        .from('deals')
        .delete()
        .eq('id', id)
        .eq('user_id', session.user.id);   // ownership check
      if (error) throw error;
      return res.status(200).json({ success: true });
    } catch (err) {
      console.error('Delete deal error:', err);
      return res.status(500).json({ error: 'Failed to delete deal' });
    }
  }
  // -- PATCH - merge neighborhood data into deal.data blob ---------------------
  if (req.method === 'PATCH') {
    const { neighborhood } = req.body || {};
    if (!neighborhood) return res.status(400).json({ error: 'neighborhood required' });
    try {
      const db = getSupabaseAdmin();
      const { data: row } = await db.from('deals').select('data').eq('id', id).eq('user_id', session.user.id).single();
      if (!row) return res.status(404).json({ error: 'Deal not found' });
      const updated = { ...(row.data || {}), neighborhood };
      const { error } = await db.from('deals').update({ data: updated }).eq('id', id).eq('user_id', session.user.id);
      if (error) throw error;
      return res.status(200).json({ success: true });
    } catch (err) {
      console.error('Neighborhood patch error:', err);
      return res.status(500).json({ error: 'Failed to update deal' });
    }
  }

  try {
    const db = getSupabaseAdmin();

    const { data: deal, error } = await db
      .from('deals')
      .select('*')
      .eq('id', id)
      .eq('user_id', session.user.id)  // ownership check
      .single();

    if (error || !deal) return res.status(404).json({ error: 'Deal not found' });

    return res.status(200).json({ deal });
  } catch (err) {
    console.error('Load deal error:', err);
    return res.status(500).json({ error: 'Failed to load deal' });
  }
}
