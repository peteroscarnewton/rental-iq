// /api/referral/claim - claims a referral code, gives both parties +1 token
// POST { code } → { success, message }

import { getServerSession } from 'next-auth/next';
import { authOptions }      from '../auth/[...nextauth]';
import { getSupabaseAdmin } from '../../../lib/supabase';
import { rateLimitWithAuth } from '../../../lib/rateLimit.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) return res.status(401).json({ error: 'Sign in to claim a referral.' });

  // Rate limit - prevents brute-forcing referral codes
  if (!rateLimitWithAuth(req, true, { authedMax: 10, windowMs: 60_000 })) {
    return res.status(429).json({ error: 'Too many requests. Please wait a minute.' });
  }

  const { code } = req.body;
  if (!code || typeof code !== 'string') return res.status(400).json({ error: 'Referral code required.' });

  // Referral codes are 8-char uppercase hex — reject anything else before hitting DB
  const normalised = code.trim().toUpperCase();
  if (!/^[0-9A-F]{8}$/.test(normalised)) return res.status(400).json({ error: 'Invalid referral code format.' });

  try {
    const db = getSupabaseAdmin();
    const { data, error } = await db.rpc('claim_referral', {
      p_new_user_email: session.user.email,
      p_referral_code:  normalised,
    });

    if (error) throw error;

    if (!data?.success) {
      return res.status(400).json({ error: data?.error || 'Could not claim referral.' });
    }

    return res.status(200).json({ success: true, message: 'Referral claimed! You and your referrer each got +1 token.' });
  } catch (err) {
    console.error('Referral claim error:', err);
    return res.status(500).json({ error: 'Failed to claim referral.' });
  }
}
