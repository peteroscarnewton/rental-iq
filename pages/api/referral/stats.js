// /api/referral/stats - returns how many people used the current user's referral code
// GET → { claimCount: number, tokensEarned: number }
// We derive this from counting users whose referred_by = current user's referral_code

import { getServerSession } from 'next-auth/next';
import { authOptions }      from '../auth/[...nextauth]';
import { getSupabaseAdmin } from '../../../lib/supabase';
import { rateLimitWithAuth } from '../../../lib/rateLimit.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.id) return res.status(401).json({ error: 'Not authenticated' });

  if (!rateLimitWithAuth(req, true, { authedMax: 30, windowMs: 60_000 })) {
    return res.status(429).json({ error: 'Too many requests.' });
  }

  try {
    const db = getSupabaseAdmin();

    // Get current user's referral_code
    const { data: user, error: userErr } = await db
      .from('users')
      .select('referral_code')
      .eq('id', session.user.id)
      .single();

    if (userErr || !user?.referral_code) {
      return res.status(200).json({ claimCount: 0, tokensEarned: 0 });
    }

    // Count how many users have been referred by this code
    const { count, error: countErr } = await db
      .from('users')
      .select('id', { count: 'exact', head: true })
      .eq('referred_by', user.referral_code);

    if (countErr) throw countErr;

    const claimCount = count || 0;
    return res.status(200).json({
      claimCount,
      tokensEarned: claimCount, // 1 token per successful referral
    });
  } catch (err) {
    console.error('[referral/stats] error:', err);
    return res.status(500).json({ error: 'Failed to load referral stats' });
  }
}
