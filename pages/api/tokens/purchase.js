import { getStripe, TOKEN_PACKAGES } from '../../../lib/stripe';
import { getServerSession }           from 'next-auth/next';
import { authOptions }                from '../auth/[...nextauth]';
import { rateLimitWithAuth }          from '../../../lib/rateLimit.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) return res.status(401).json({ error: 'Sign in to purchase tokens' });

  // Rate limit - prevents automated Stripe session creation
  if (!rateLimitWithAuth(req, true, { authedMax: 10, windowMs: 60_000 })) {
    return res.status(429).json({ error: 'Too many requests. Please wait a minute.' });
  }

  const { packageId, returnPath } = req.body;
  const pkg = TOKEN_PACKAGES.find(p => p.id === packageId);
  if (!pkg) return res.status(400).json({ error: 'Invalid package' });

  // Sanitize returnPath - only allow internal paths, never external redirects
  const safePath = (typeof returnPath === 'string' && returnPath.startsWith('/') && !returnPath.includes('//'))
    ? returnPath
    : '/';

  try {
    const stripe = getStripe();
    const origin = process.env.NEXTAUTH_URL || `https://${req.headers.host}`;

    const checkout = await stripe.checkout.sessions.create({
      mode:                'payment',
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency:     'usd',
          unit_amount:  pkg.price,
          product_data: {
            name:        pkg.label,
            description: `${pkg.tokens} RentalIQ analysis token${pkg.tokens > 1 ? 's' : ''}`,
          },
        },
        quantity: 1,
      }],
      metadata: {
        user_email: session.user.email,
        package_id: pkg.id,
        tokens:     String(pkg.tokens),
      },
      customer_email:     session.user.email,
      success_url:        `${origin}${safePath}?purchase=success&tokens=${pkg.tokens}`,
      cancel_url:         `${origin}${safePath}?purchase=cancelled`,
      allow_promotion_codes: true,
    });

    return res.status(200).json({ url: checkout.url });
  } catch (err) {
    console.error('Stripe checkout error:', err);
    return res.status(500).json({ error: 'Failed to create checkout session' });
  }
}

export const config = { maxDuration: 15 };
