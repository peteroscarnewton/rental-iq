// /api/scout - DEPRECATED in v2.0. Returns 410 Gone.
// The Scout feature is now a client-side property browser (pages/scout.js)
// that calls /api/rent-estimate for market data and deep-links to Zillow/Redfin.
// This endpoint is no longer called by any page. Safe to ignore — kept for
// graceful handling of any cached/bookmarked API calls.

export default function handler(req, res) {
  return res.status(410).json({
    error: 'This endpoint has been deprecated. Use the Scout page at /scout.',
  });
}
