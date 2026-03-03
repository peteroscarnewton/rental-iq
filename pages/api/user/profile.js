// /api/user/profile - returns current user's profile including referral_code
import { getServerSession } from 'next-auth/next';
import { authOptions }      from '../auth/[...nextauth]';
import { getSupabaseAdmin } from '../../../lib/supabase';
import { rateLimitWithAuth } from '../../../lib/rateLimit.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.id) return res.status(401).json({ error: 'Not authenticated' });

  if (!rateLimitWithAuth(req, true, { authedMax: 30, windowMs: 60_000 })) {
    return res.status(429).json({ error: 'Too many requests. Please wait a minute.' });
  }

  try {
    const db = getSupabaseAdmin();
    const { data: user, error } = await db
      .from('users')
      .select('id, email, name, tokens, referral_code, created_at')
      .eq('id', session.user.id)
      .single();

    if (error || !user) return res.status(404).json({ error: 'User not found' });
    return res.status(200).json(user);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to load profile' });
  }
}
