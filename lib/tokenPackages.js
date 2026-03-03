// Token package definitions - no server dependencies
// Imported by both dashboard.js (client) and api/tokens/purchase.js (server)

export const TOKEN_PACKAGES = [
  {
    id:       'tokens_1',
    tokens:   1,
    price:    500,   // cents
    label:    '1 Token',
    sublabel: '$5.00 - single analysis',
    badge:    null,
  },
  {
    id:       'tokens_10',
    tokens:   10,
    price:    2000,  // cents
    label:    '10 Tokens',
    sublabel: '$20.00 - $2 per analysis',
    badge:    'Most Popular',
  },
  {
    id:       'tokens_100',
    tokens:   100,
    price:    5000,  // cents
    label:    '100 Tokens',
    sublabel: '$50.00 - $0.50 per analysis',
    badge:    'Best Value',
  },
];
