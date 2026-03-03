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

    // Idempotency - check if we've already processed this session
    const { data: existing } = await db
      .from('purchases')
      .select('id')
      .eq('stripe_session_id', stripeSessionId)
      .single();

    if (existing) {
      return res.status(200).json({ received: true });
    }

    // Credit tokens using atomic RPC to avoid race conditions
    const { error: rpcError } = await db.rpc('add_tokens', {
      p_email:  email,
      p_tokens: tokensToAdd,
    });

    if (rpcError) {
      console.error('Failed to add tokens:', rpcError);
      return res.status(500).json({ error: 'Failed to credit tokens' });
    }

    // Store Stripe customer ID for billing portal access
    const customerId = session.customer;
    if (customerId) {
      await db.from('users').update({ stripe_customer_id: customerId }).eq('email', email);
    }

    // Record purchase for audit trail
    await db.from('purchases').insert({
      user_email:        email,
      stripe_session_id: stripeSessionId,
      tokens_added:      tokensToAdd,
      amount_cents:      amountCents,
    });

  }

  return res.status(200).json({ received: true });
}

