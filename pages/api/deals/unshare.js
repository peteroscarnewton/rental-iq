// /api/deals/unshare - revokes public access to a deal
// POST { dealId } → { success }

import { getServerSession } from 'next-auth/next';
import { authOptions }      from '../auth/[...nextauth]';
import { getSupabaseAdmin } from '../../../lib/supabase';
import { rateLimitWithAuth } from '../../../lib/rateLimit.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.id) return res.status(401).json({ error: 'Not authenticated' });

  if (!rateLimitWithAuth(req, true, { authedMax: 20, windowMs: 60_000 })) {
    return res.status(429).json({ error: 'Too many requests. Please wait a minute.' });
  }

  const { dealId } = req.body;
  if (!dealId) return res.status(400).json({ error: 'dealId required' });

  try {
    const db = getSupabaseAdmin();
    const { error } = await db
      .from('deals')
      .update({ is_public: false, share_token: null })
      .eq('id', dealId)
      .eq('user_id', session.user.id);

    if (error) throw error;
    return res.status(200).json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to unshare' });
  }
}
