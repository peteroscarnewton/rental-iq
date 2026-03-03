import { getServerSession } from 'next-auth/next';
import { authOptions } from '../auth/[...nextauth]';
import { getSupabaseAdmin } from '../../../lib/supabase';
import { rateLimitWithAuth } from '../../../lib/rateLimit.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.id) return res.status(401).json({ error: 'Not authenticated' });

  if (!rateLimitWithAuth(req, true, { authedMax: 30, windowMs: 60_000 })) {
    return res.status(429).json({ error: 'Too many requests. Please wait a minute.' });
  }

  try {
    const db = getSupabaseAdmin();

    const { data: deals, error } = await db
      .from('deals')
      .select('id, address, city, verdict, score, price, rent, cashflow, coc, dscr, cap_rate, created_at')
      .eq('user_id', session.user.id)
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) throw error;

    return res.status(200).json({ deals: deals || [] });
  } catch (err) {
    console.error('List deals error:', err);
    return res.status(500).json({ error: 'Failed to load deals' });
  }
}
