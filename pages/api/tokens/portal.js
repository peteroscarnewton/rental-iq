// /api/tokens/portal - creates a Stripe customer portal session
// Returns { url } to redirect user to their billing portal (invoices, receipts, payment methods)
// POST → { url }

import { getStripe }       from '../../../lib/stripe';
import { getServerSession } from 'next-auth/next';
import { authOptions }       from '../auth/[...nextauth]';
import { getSupabaseAdmin }  from '../../../lib/supabase';
import { rateLimitWithAuth } from '../../../lib/rateLimit.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) return res.status(401).json({ error: 'Not authenticated' });

  // Rate limit - prevents hammering Stripe portal session creation
  if (!rateLimitWithAuth(req, true, { authedMax: 10, windowMs: 60_000 })) {
    return res.status(429).json({ error: 'Too many requests. Please wait a minute.' });
  }

  try {
    const db     = getSupabaseAdmin();
    const stripe = getStripe();
    const origin = process.env.NEXTAUTH_URL || `https://${req.headers.host}`;

    // Get user's Stripe customer ID
    const { data: user } = await db
      .from('users')
      .select('stripe_customer_id')
      .eq('email', session.user.email)
      .single();

    let customerId = user?.stripe_customer_id;

    // If no customer ID yet - create one in Stripe so portal can be accessed
    // (happens if user has tokens from referral/free but never purchased)
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: session.user.email,
        metadata: { source: 'rentaliq_portal_creation' },
      });
      customerId = customer.id;
      await db.from('users').update({ stripe_customer_id: customerId }).eq('email', session.user.email);
    }

    const portalSession = await stripe.billingPortal.sessions.create({
      customer:   customerId,
      return_url: `${origin}/dashboard`,
    });

    return res.status(200).json({ url: portalSession.url });
  } catch (err) {
    console.error('Billing portal error:', err);
    // If portal not configured in Stripe dashboard
    if (err?.message?.includes('No configuration')) {
      return res.status(503).json({
        error: 'Billing portal not configured. Enable it at dashboard.stripe.com → Settings → Billing → Customer portal.',
      });
    }
    return res.status(500).json({ error: 'Could not open billing portal.' });
  }
}

export const config = { maxDuration: 15 };
