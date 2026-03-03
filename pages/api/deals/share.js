// /api/deals/share - makes a deal publicly shareable, returns share URL
// POST { dealId } → { shareUrl }

import { getServerSession } from 'next-auth/next';
import { authOptions }      from '../auth/[...nextauth]';
import { getSupabaseAdmin } from '../../../lib/supabase';
import { rateLimitWithAuth } from '../../../lib/rateLimit.js';

import crypto from 'crypto';

function makeShareToken() {
  // 10-char URL-safe token using cryptographically secure random bytes
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from(crypto.randomBytes(10))
    .map(b => chars[b % chars.length])
    .join('');
}

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

    // Verify ownership
    const { data: deal, error: fetchErr } = await db
      .from('deals')
      .select('id, share_token, is_public')
      .eq('id', dealId)
      .eq('user_id', session.user.id)
      .single();

    if (fetchErr || !deal) return res.status(404).json({ error: 'Deal not found' });

    // If already shared, return existing token
    if (deal.is_public && deal.share_token) {
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || `https://${req.headers.host}`;
      return res.status(200).json({ shareUrl: `${baseUrl}/share/${deal.share_token}` });
    }

    // Generate new share token and make public
    const token = makeShareToken();
    const { error: updateErr } = await db
      .from('deals')
      .update({ is_public: true, share_token: token })
      .eq('id', dealId);

    if (updateErr) throw updateErr;

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || `https://${req.headers.host}`;
    return res.status(200).json({ shareUrl: `${baseUrl}/share/${token}` });
  } catch (err) {
    console.error('Share deal error:', err);
    return res.status(500).json({ error: 'Failed to share deal' });
  }
}

export const config = { maxDuration: 15 };
