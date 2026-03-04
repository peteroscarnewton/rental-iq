import { getStripe } from '../../../lib/stripe';
import { getSupabaseAdmin } from '../../../lib/supabase';

// Stripe requires raw body for signature verification
export const config = { api: { bodyParser: false }, maxDuration: 15 };

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end',  () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const sig         = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!sig || !webhookSecret) return res.status(400).json({ error: 'Missing signature or secret' });

  let event;
  try {
    const rawBody = await getRawBody(req);
    event = getStripe().webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err) {
    console.error('Webhook signature failed:', err.message);
    return res.status(400).json({ error: `Webhook error: ${err.message}` });
  }

  if (event.type === 'checkout.session.completed') {
    const session    = event.data.object;
    const email      = session.metadata?.user_email;
    const tokensToAdd = parseInt(session.metadata?.tokens || '0', 10);
    const amountCents = session.amount_total;
    const stripeSessionId = session.id;

    if (!email || tokensToAdd <= 0) {
      console.error('Webhook: missing metadata', session.metadata);
      return res.status(400).json({ error: 'Missing metadata' });
    }

    const db = getSupabaseAdmin();

    // Single atomic RPC: inserts the purchase record AND credits tokens in one transaction.
    // Returns: 'ok' | 'duplicate' | 'no_user'
    // If the DB goes down mid-call, Postgres rolls back both writes automatically.
    // No orphaned state, no double-credit possible on retry.
    const { data: result, error: rpcError } = await db.rpc('process_purchase', {
      p_email:             email,
      p_stripe_session_id: stripeSessionId,
      p_tokens:            tokensToAdd,
      p_amount_cents:      amountCents,
    });

    if (rpcError) {
      console.error('process_purchase RPC error:', rpcError);
      return res.status(500).json({ error: 'Payment processing error' });
    }

    if (result === 'duplicate') {
      // Already processed — idempotent replay from Stripe. Nothing to do.
      return res.status(200).json({ received: true });
    }

    if (result === 'no_user') {
      // User deleted their account between purchase and webhook delivery.
      // Log for manual review but acknowledge to Stripe (retrying won't help).
      console.error('process_purchase: user not found for email', email, '— manual refund may be needed');
      return res.status(200).json({ received: true });
    }

    // result === 'ok' — store Stripe customer ID for billing portal (non-critical, best-effort)
    const customerId = session.customer;
    if (customerId) {
      await db.from('users').update({ stripe_customer_id: customerId }).eq('email', email);
    }

  }

  return res.status(200).json({ received: true });
}

