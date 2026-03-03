import Stripe from 'stripe';
import { TOKEN_PACKAGES } from './tokenPackages.js';

// Re-export for any server-side code that imports both from stripe.js
export { TOKEN_PACKAGES };

let _stripe = null;
export function getStripe() {
  if (_stripe) return _stripe;
  if (!process.env.STRIPE_SECRET_KEY) throw new Error('Missing STRIPE_SECRET_KEY');
  _stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-04-10' });
  return _stripe;
}
