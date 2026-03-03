/** @type {import('next').NextConfig} */
module.exports = {
  // Security headers on every response
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options',          value: 'DENY' },
          { key: 'X-Content-Type-Options',   value: 'nosniff' },
          { key: 'Referrer-Policy',           value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy',        value: 'camera=(), microphone=(), geolocation=()' },
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://js.stripe.com https://cdnjs.cloudflare.com",  // cdnjs: jsPDF; unsafe-eval: Next.js dev
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
              "font-src 'self' https://fonts.gstatic.com",
              "img-src 'self' data: https:",
              "connect-src 'self' https://*.supabase.co https://generativelanguage.googleapis.com https://api.resend.com https://api.stripe.com https://js.stripe.com https://overpass-api.de https://geocoding.geo.census.gov https://api.census.gov https://www2.census.gov https://www.huduser.gov https://www.freddiemac.com https://www.consumerfinance.gov https://api.bls.gov https://fred.stlouisfed.org https://files.zillowstatic.com https://hazards.fema.gov http://data.insideairbnb.com https://evictionlab.org https://www.ncsl.org https://redfin-public-data.s3.us-west-2.amazonaws.com",
              "frame-src https://js.stripe.com",
              "frame-ancestors 'none'",
            ].join('; '),
          },
        ],
      },
      // Cache static assets aggressively
      {
        source: '/_next/static/(.*)',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
      // API routes - no cache
      {
        source: '/api/(.*)',
        headers: [
          { key: 'Cache-Control', value: 'no-store, no-cache, must-revalidate' },
        ],
      },
    ];
  },

  // Compress responses
  compress: true,

  // Image optimisation - remotePatterns (replaces deprecated domains in Next 14)
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'lh3.googleusercontent.com' },
      { protocol: 'https', hostname: 'avatars.githubusercontent.com' },
    ],
  },

  // Strict mode catches subtle React bugs
  reactStrictMode: true,

  // Silence noisy powered-by header
  poweredByHeader: false,
};
