import { rateLimitWithAuth }   from '../../lib/rateLimit.js';
import { fetchSafmrRent }      from '../../lib/marketBenchmarkFetcher.js';
import { getSupabaseAdmin }    from '../../lib/supabase.js';
import { fetchListingViaAI }   from '../../lib/aiListingFetcher.js';
import crypto                  from 'crypto';

// /api/fetch-listing  —  v36
//
// ═══════════════════════════════════════════════════════════════════════════
// ARCHITECTURE: AI-FIRST LISTING EXTRACTION
// ═══════════════════════════════════════════════════════════════════════════
//
// Layer 0 — URL address extraction          (free, instant, no network call)
//           Parses address from Zillow/Redfin/Realtor/Homes/Trulia slugs.
//
// Layer 1 — Supabase listing cache          (free, 7-day TTL per unique URL)
//           Same URL pasted by 1000 users = 1 AI call, 999 cache hits.
//           This is what makes the AI approach economical at scale.
//
// Layer 2 — Gemini 2.5 Flash + Google Search grounding  (PRIMARY)
//           ─────────────────────────────────────────────────────
//           Gemini searches Google for the listing the same way a human
//           researcher would. Returns ALL fields including year_built,
//           taxAnnual, hoaMonthly — fields og:meta never carries.
//           No IP blocking. No bot detection. No proxy needed.
//           Cost: ~$0.0035/unique URL. Free tier: 1,500 grounded queries/day.
//           With 7-day cache, effective cost at scale is fractions of a cent.
//
// Layer 2b — og:meta + JSON-LD fallback     (fills AI gaps, very new listings)
//            Fast <head> fetch with social bot UA. Gets price/beds/baths/sqft
//            reliably. Covers brand-new listings not yet indexed by Google.
//
// Layer 3 — OSM Nominatim zip fill          (free, no API key)
//
// Layer 4 — HUD SAFMR rent estimate         (free, official gov API)
//

// ── Constants (defined before handler — const is not hoisted) ────────────────
const GOOGLEBOT_UA   = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';
const BINGBOT_UA     = 'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)';
const FACEBOOKBOT_UA = 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)';
const TWITTERBOT_UA  = 'Twitterbot/1.0';
// Googlebot first — Zillow/Redfin MUST whitelist it for SEO indexing
const FETCH_UAS      = [GOOGLEBOT_UA, BINGBOT_UA, FACEBOOKBOT_UA, TWITTERBOT_UA];
let _uaIdx = 0;
function nextSocialUA() { return FETCH_UAS[(_uaIdx++) % FETCH_UAS.length]; }

const CORE_FIELDS    = ['price', 'beds', 'baths', 'sqft', 'year', 'city'];
const ALL_FIELDS     = ['price', 'rent', 'beds', 'baths', 'sqft', 'year', 'city', 'taxAnnual', 'hoaMonthly'];
const NUMERIC_FIELDS = ['price', 'rent', 'beds', 'baths', 'sqft', 'year', 'taxAnnual', 'hoaMonthly'];

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  if (!rateLimitWithAuth(req, false, { anonMax: 20, authedMax: 20, windowMs: 60_000 })) {
    return res.status(429).json({ error: 'Too many requests. Please wait a minute and try again.' });
  }

  const { url } = req.body;
  if (!url || typeof url !== 'string') return res.status(400).json({ error: 'url required' });

  // ── SSRF protection: only allow known real-estate listing hostnames ────────
  // Prevents attackers from using this endpoint to probe internal infrastructure
  // (AWS metadata, internal services, localhost, etc.)
  const ALLOWED_LISTING_HOSTS = new Set([
    'www.zillow.com', 'zillow.com', 'www.redfin.com', 'redfin.com',
    'www.realtor.com', 'realtor.com', 'www.trulia.com', 'trulia.com',
    'www.homes.com', 'homes.com', 'www.movoto.com', 'movoto.com',
    'www.coldwellbanker.com', 'coldwellbanker.com',
    'www.century21.com', 'century21.com', 'www.remax.com', 'remax.com',
    'www.kw.com', 'kw.com', 'www.compass.com', 'compass.com',
    'www.bhhs.com', 'bhhs.com', 'www.sothebysrealty.com', 'sothebysrealty.com',
    'www.loopnet.com', 'loopnet.com', 'www.crexi.com', 'crexi.com',
    'www.apartments.com', 'apartments.com', 'www.rentals.com', 'rentals.com',
    'www.rent.com', 'rent.com', 'www.zumper.com', 'zumper.com',
    'www.estately.com', 'estately.com', 'www.point2homes.com', 'point2homes.com',
    'www.mlslistings.com', 'mlslistings.com',
  ]);
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return res.status(400).json({ error: 'Only http/https URLs are accepted.' });
    }
    if (!ALLOWED_LISTING_HOSTS.has(parsed.hostname)) {
      return res.status(400).json({ error: 'Unsupported listing source. Paste a URL from Zillow, Redfin, Realtor.com, or another supported site.' });
    }
  } catch (_) {
    return res.status(400).json({ error: 'Invalid URL.' });
  }

  // ── Layer 0: Resolve redirects + extract address from slug ────────────────
  let resolvedUrl = url;
  try {
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 4000);
    const r = await fetch(url, {
      method: 'HEAD',
      headers: { 'User-Agent': GOOGLEBOT_UA },
      signal: ctrl.signal,
      redirect: 'follow',
    });
    resolvedUrl = r.url || url;
    // Re-validate post-redirect hostname to prevent SSRF via open redirects
    // on allowlisted domains (e.g. zillow.com redirect to 169.254.169.254).
    try {
      const rParsed = new URL(resolvedUrl);
      if (!ALLOWED_LISTING_HOSTS.has(rParsed.hostname)) resolvedUrl = url;
    } catch (_) { resolvedUrl = url; }
  } catch (_) {}

  const address = extractAddressFromUrl(resolvedUrl) || extractAddressFromUrl(url);

  // ── Layer 1: Supabase cache lookup ────────────────────────────────────────
  // Cache key versioned with 'v2' so pre-v53 entries (without listingDescription)
  // are automatically bypassed. Users will re-fetch once; new results include description.
  const cacheKey = 'listing:v2:' + crypto.createHash('sha256')
    .update(normalizeUrl(resolvedUrl)).digest('hex').slice(0, 32);

  let supabase = null;
  try {
    supabase = getSupabaseAdmin();
    const { data: cached } = await supabase
      .from('market_data_cache')
      .select('value, fetched_at')
      .eq('key', cacheKey)
      .single();

    if (cached?.value) {
      const age       = Date.now() - new Date(cached.fetched_at).getTime();
      const TTL_7DAYS = 7 * 24 * 60 * 60 * 1000;
      if (age < TTL_7DAYS) {
        const parsed = JSON.parse(cached.value);
        if (address && !parsed.city) parsed.city = `${address.city}, ${address.state}`;
        return res.status(200).json({ ...parsed, _source: 'cache' });
      }
    }
  } catch (_) {}

  // ── Set up result object ───────────────────────────────────────────────────
  let result  = emptyResult();
  let confMap = {};

  if (address) {
    result.city  = `${address.city}, ${address.state}`;
    confMap.city = 'high';
  }

  // ── Layer 2: AI extraction (Gemini + Google Search grounding) ───────────────
  //
  // Primary path: ask Gemini to find the listing via Google Search and return
  // structured JSON. Gets ALL fields including year_built, taxAnnual, hoaMonthly
  // which og:meta never carries. Gemini searches Google the way a human would —
  // no IP blocking, no bot detection.
  //
  // Fallback: og:meta fills any gaps AI left null, and covers cases where
  // Gemini can't find the listing (very new listings, private URLs, etc).

  let aiSucceeded = false;

  try {
    const aiData = await withTimeout(fetchListingViaAI(resolvedUrl), 16_000, null);

    if (aiData) {
      aiSucceeded = true;

      // Map AI result directly into result + confMap
      // AI results get 'high' confidence — Gemini found them via real search
      const AI_FIELDS = ['price', 'rent', 'beds', 'baths', 'sqft', 'year', 'taxAnnual', 'hoaMonthly'];
      for (const f of AI_FIELDS) {
        if (aiData[f] != null) {
          result[f]  = aiData[f];
          confMap[f] = 'high';
        }
      }
      if (aiData.city && !result.city) {
        result.city  = aiData.city;
        confMap.city = 'high';
      }
      // Pass through non-numeric fields from AI
      if (aiData.listingDescription && !result.listingDescription) {
        result.listingDescription = aiData.listingDescription;
      }
      if (Array.isArray(aiData.unitRents) && !result.unitRents) {
        result.unitRents = aiData.unitRents;
      }
    }
  } catch (_) {
    // AI call failed — og:meta fallback below will handle it
  }

  // ── Layer 2b: og:meta fallback — fills any fields AI left null ────────────
  // Also serves as full fallback if AI call failed entirely.
  // og:meta reliably gets price/beds/baths/sqft/city even when AI can't find
  // the listing (e.g. brand-new listing not yet indexed).
  try {
    const ogResult = await fetchOgMeta(resolvedUrl);
    if (ogResult) resolveAllFields(result, confMap, [ogResult]);

    // If still missing price, try mobile variant
    if (result.price == null) {
      const mobileUrl = toMobileUrl(resolvedUrl);
      if (mobileUrl) {
        const mobileResult = await fetchOgMeta(mobileUrl);
        if (mobileResult) resolveAllFields(result, confMap, [mobileResult]);
      }
    }
  } catch (_) {}

  // ── Layer 3: OSM Nominatim zip fill ────────────────────────────────────────
  if (address && !address.zipcode) {
    try {
      const q    = `${address.street}, ${address.city}, ${address.state}`;
      const osmR = await withTimeout(
        fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1&addressdetails=1`, {
          headers: { 'User-Agent': 'RentalIQ/1.0 (rentaliq.com — property analysis)' },
        }).then(r => r.ok ? r.json() : null),
        3000, null
      );
      if (osmR?.[0]?.address?.postcode) {
        address.zipcode = osmR[0].address.postcode.replace(/\D/g, '').slice(0, 5);
      }
    } catch (_) {}
  }

  // ── Layer 4: HUD SAFMR rent estimate ──────────────────────────────────────
  if (result.rent == null && address?.zipcode) {
    try {
      const bedsForHud = result.beds != null ? Math.round(Number(result.beds)) : 2;
      const safmr = await withTimeout(fetchSafmrRent(address.zipcode, bedsForHud), 5000, null);
      if (safmr?.rent) {
        result.rent  = safmr.rent;
        confMap.rent = 'low'; // HUD FMR is a market proxy, not actual rent — amber badge
      }
    } catch (_) {}
  }

  // ── Normalize + finalize ───────────────────────────────────────────────────
  for (const f of NUMERIC_FIELDS) {
    if (result[f] != null) result[f] = String(result[f]);
  }

  const populated = ALL_FIELDS.filter(f => result[f] != null);
  const failed    = ALL_FIELDS.filter(f => result[f] == null);

  let warning = null;
  if (populated.length === 0) {
    warning = 'Could not read this listing automatically. Please enter details manually.';
  } else if (result.price == null) {
    warning = 'Got some details but price is missing — please fill it in.';
  } else if (populated.length < 4) {
    warning = `Filled ${populated.length} field${populated.length > 1 ? 's' : ''} — please complete the rest.`;
  }

  // Pass non-numeric fields through separately (they're not in populated/failed tracking)
  const payload = { ...result, populated, failed, confidence: confMap, blocked: false, warning, _aiUsed: aiSucceeded };

  // ── Write to cache (fire-and-forget, don't block response) ────────────────
  if (supabase && populated.length >= 3) {
    supabase.from('market_data_cache').upsert(
      { key: cacheKey, value: JSON.stringify(payload), fetched_at: new Date().toISOString(), valid_until: new Date(Date.now() + 7*24*60*60*1000).toISOString() },
      { onConflict: 'key' }
    ).then(() => {}).catch(() => {});
  }

  return res.status(200).json(payload);
}

// ══════════════════════════════════════════════════════════════════════════════
// HELPERS + FIELD RULES
// ══════════════════════════════════════════════════════════════════════════════

const FIELD_RULES = {
  price:      { min: 10_000,  max: 50_000_000, allowRegex: true,  tolerance: 0.05 },
  beds:       { min: 0,       max: 20,         allowRegex: true,  tolerance: 0,   exact: true },
  baths:      { min: 0,       max: 20,         allowRegex: true,  tolerance: 0.25 },
  sqft:       { min: 100,     max: 30_000,     allowRegex: true,  tolerance: 0.10 },
  year:       { min: 1800,    max: new Date().getFullYear() + 1, allowRegex: false, tolerance: 0, exact: true },
  city:       { allowRegex: true, tolerance: 0 },
  rent:       { min: 100,     max: 50_000,     allowRegex: true,  tolerance: 0.10 },
  taxAnnual:  { min: 0,       max: 200_000,    allowRegex: false, tolerance: 0.15 },
  hoaMonthly: { min: 0,       max: 10_000,     allowRegex: false, tolerance: 0.15 },
};

const STREET_SUFFIXES = [
  'Ave','Avenue','St','Street','Blvd','Boulevard','Dr','Drive','Rd','Road',
  'Ln','Lane','Ct','Court','Pl','Place','Way','Cir','Circle','Pkwy','Parkway',
  'Ter','Terrace','Trl','Trail','Hwy','Highway','Fwy','Freeway','Sq','Square',
  'Loop','Run','Pass','Bend','Ridge','Glen','Hill','Bay','Pt','Point',
  'Xing','Crossing','Aly','Alley','Brk','Brook',
];

function emptyResult() {
  return { price:null, rent:null, beds:null, baths:null, sqft:null, year:null,
           city:null, taxAnnual:null, hoaMonthly:null,
           listingDescription:null, unitRents:null };
}

const jld  = v => ({ value: v, tier: 'jsonld' });
const strd = v => ({ value: v, tier: 'structured' });
const rgx  = v => ({ value: v, tier: 'regex' });

function withTimeout(promise, ms, fallback = null) {
  return Promise.race([promise, new Promise(r => setTimeout(() => r(fallback), ms))]);
}

function normalizeUrl(url) {
  try {
    const u = new URL(url);
    return `${u.hostname}${u.pathname}`.toLowerCase().replace(/\/$/, '');
  } catch (_) { return url.toLowerCase(); }
}

// ══════════════════════════════════════════════════════════════════════════════
// LAYER 0: Address extraction from URL slug
// ══════════════════════════════════════════════════════════════════════════════

function extractAddressFromUrl(url) {
  try {
    const u    = new URL(url);
    const path = u.pathname;

    if (url.includes('zillow.com')) {
      const m = path.match(/\/(?:homedetails(?:\/new-construction)?|b)\/([^/]+)/i);
      if (m) return parseSlug(m[1].replace(/_\d+_?zpid\/?$/, '').replace(/-\d+_zpid$/, ''));
    }

    if (url.includes('redfin.com')) {
      const m = path.match(/\/(?:us\/)?([A-Z]{2})\/([^/]+)\/([^/]+)\/(?:home|condo|townhouse|multifamily|land)\//i);
      if (m) {
        const state   = m[1].toUpperCase();
        const city    = m[2].replace(/-/g, ' ');
        const slug    = m[3];
        const zipM    = slug.match(/-(\d{5})$/);
        const street  = slug.replace(/-\d{5}$/, '').replace(/-/g, ' ');
        return { street: toTitleCase(street), city: toTitleCase(city), state, zipcode: zipM?.[1] || '' };
      }
    }

    if (url.includes('realtor.com')) {
      const m = path.match(/\/realestateandhomes-detail\/([^/?]+)/i);
      if (m) {
        const clean = m[1].replace(/_M\d+$/, '');
        const parts = clean.split('_');
        if (parts.length >= 4 && /^\d{5}$/.test(parts[3]) && /^[A-Z]{2}$/.test(parts[2]))
          return { street: toTitleCase(parts[0].replace(/-/g, ' ')),
                   city:   toTitleCase(parts[1].replace(/-/g, ' ')),
                   state:  parts[2].toUpperCase(), zipcode: parts[3] };
        return parseSlug(clean.replace(/_/g, '-'));
      }
    }

    if (url.includes('homes.com')) {
      const m = path.match(/\/([a-z]{2})\/([^/]+)\/([^/]+)\//i);
      if (m) {
        const state  = m[1].toUpperCase();
        const city   = m[2].replace(/-/g, ' ');
        const slug   = m[3];
        const zipM   = slug.match(/-(\d{5})$/);
        const street = slug.replace(/-\d{5}$/, '').replace(/-/g, ' ');
        return { street: toTitleCase(street), city: toTitleCase(city), state, zipcode: zipM?.[1] || '' };
      }
    }

    if (url.includes('trulia.com')) {
      const m = path.match(/\/(?:homes\/for_sale|property)\/([^/?]+)/i);
      if (m) return parseSlug(m[1].replace(/_\d+p$/, ''));
    }

    const gm = path.match(/\/([^/]*\d{5}[^/]*)\/?(?:$|\?)/);
    if (gm) return parseSlug(gm[1]);

    return null;
  } catch (_) { return null; }
}

function parseSlug(slug) {
  if (!slug) return null;
  const parts  = slug.split(/[-_]+/);
  const zipIdx = parts.findIndex(p => /^\d{5}$/.test(p));

  if (zipIdx >= 2) {
    const zipcode  = parts[zipIdx];
    const state    = parts[zipIdx - 1].toUpperCase();
    if (!/^[A-Z]{2}$/.test(state)) return null;
    const preState = parts.slice(0, zipIdx - 1);
    let si = -1;
    for (let i = preState.length - 1; i >= 0; i--) {
      if (STREET_SUFFIXES.some(s => s.toLowerCase() === preState[i].toLowerCase())) { si = i; break; }
    }
    if (si < 0) si = Math.min(4, preState.length - 2);
    const street = toTitleCase(preState.slice(0, si + 1).join(' '));
    const city   = toTitleCase(preState.slice(si + 1).join(' '));
    if (!street || !city || city.length < 2) return null;
    return { street, city, state, zipcode };
  }

  // No zip — state-only fallback
  const si2 = parts.findIndex((p, i) => i > 0 && /^[A-Z]{2}$/i.test(p) && i === parts.length - 1);
  if (si2 > 1) {
    const state    = parts[si2].toUpperCase();
    const preState = parts.slice(0, si2);
    let si = -1;
    for (let i = preState.length - 1; i >= 0; i--) {
      if (STREET_SUFFIXES.some(s => s.toLowerCase() === preState[i].toLowerCase())) { si = i; break; }
    }
    if (si < 0) si = Math.min(4, preState.length - 2);
    const street = toTitleCase(preState.slice(0, si + 1).join(' '));
    const city   = toTitleCase(preState.slice(si + 1).join(' '));
    if (!street || !city || city.length < 2) return null;
    return { street, city, state, zipcode: '' };
  }

  return null;
}

function toTitleCase(s) { return s.replace(/\b\w/g, c => c.toUpperCase()); }

// ══════════════════════════════════════════════════════════════════════════════
// LAYER 2: og:meta + JSON-LD from listing URL
// ══════════════════════════════════════════════════════════════════════════════

async function fetchOgMeta(url) {
  if (!url) return null;

  try {
    const ctrl    = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 7000);
    let   html    = '';

    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': nextSocialUA(),
          'Accept':     'text/html,application/xhtml+xml',
        },
        signal:   ctrl.signal,
        redirect: 'follow',
      });

      if (!res.ok) return null;

      // Stream-read only the <head> — abort once we see <body to save bandwidth
      const reader  = res.body.getReader();
      const decoder = new TextDecoder();

      while (html.length < 80_000) {
        const { value, done } = await reader.read();
        if (done) break;
        html += decoder.decode(value, { stream: true });
        if (html.includes('__NEXT_DATA__') && html.length > 20_000) break; // got the data script
      }
      reader.cancel().catch(() => {});
    } finally {
      clearTimeout(timeout);
    }

    if (!html || html.length < 200) return null;
    return parseHead(html);
  } catch (_) { return null; }
}

function parseHead(html) {
  const r = emptyResult();

  // ── __NEXT_DATA__ (Zillow + Redfin server-rendered React data) ──────────────
  // Next.js sites embed all page props in a <script id="__NEXT_DATA__"> tag.
  // This is the most reliable source — full structured data, not just og:meta.
  const ndMatch = html.match(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (ndMatch) {
    try {
      const nd = JSON.parse(ndMatch[1]);
      // Zillow: props.pageProps.componentProps or .gdpClientCache
      const zp = nd?.props?.pageProps;
      const zdp = zp?.componentProps?.gdpClientCache
        ? Object.values(zp.componentProps.gdpClientCache)[0]?.property
        : zp?.componentProps?.initialReduxState?.gdp?.fullPageData?.property
          || zp?.componentProps;
      if (zdp) {
        if (zdp.price && !r.price)       r.price = jld(parseInt(zdp.price));
        if (zdp.bedrooms && !r.beds)     r.beds  = jld(parseFloat(zdp.bedrooms));
        if (zdp.bathrooms && !r.baths)   r.baths = jld(parseFloat(zdp.bathrooms));
        if (zdp.livingArea && !r.sqft)   r.sqft  = jld(parseInt(zdp.livingArea));
        if (zdp.yearBuilt && !r.year)    r.year  = jld(parseInt(zdp.yearBuilt));
        if (zdp.taxAnnualAmount && !r.taxAnnual) r.taxAnnual = jld(parseFloat(zdp.taxAnnualAmount));
        if (zdp.monthlyHoaFee != null && !r.hoaMonthly) r.hoaMonthly = jld(parseFloat(zdp.monthlyHoaFee));
        if (zdp.address?.city && zdp.address?.state && !r.city)
          r.city = jld(\`\${zdp.address.city}, \${zdp.address.state}\`);
      }
      // Redfin: props.pageProps.reduxStore or .serverSideData
      const rfp = nd?.props?.pageProps?.reduxStore?.mediaData
        || nd?.props?.pageProps?.serverSideData?.listingData;
      if (rfp) {
        if (rfp.listingPrice?.amount && !r.price)  r.price = jld(parseInt(rfp.listingPrice.amount));
        if (rfp.beds && !r.beds)                   r.beds  = jld(parseFloat(rfp.beds));
        if (rfp.baths && !r.baths)                 r.baths = jld(parseFloat(rfp.baths));
        if (rfp.sqFt?.value && !r.sqft)            r.sqft  = jld(parseInt(rfp.sqFt.value));
        if (rfp.yearBuilt?.value && !r.year)        r.year  = jld(parseInt(rfp.yearBuilt.value));
      }
    } catch (_) {}
  }

  // ── JSON-LD structured data (highest quality) ─────────────────────────────
  // All three sites include schema.org/SingleFamilyResidence or /Apartment JSON-LD
  // in <head> for Google rich snippets — this is their best structured data
  for (const m of html.matchAll(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const ld    = JSON.parse(m[1]);
      const items = Array.isArray(ld) ? ld : [ld];
      for (const item of items) {
        if (!item) continue;
        if (item?.offers?.price && !r.price)
          r.price = jld(parseInt(String(item.offers.price).replace(/\D/g, '')));
        if (item?.numberOfBedrooms && !r.beds)
          r.beds = jld(parseFloat(item.numberOfBedrooms));
        if (item?.numberOfBathroomsTotal && !r.baths)
          r.baths = jld(parseFloat(item.numberOfBathroomsTotal));
        if (!r.baths && item?.numberOfBathrooms)
          r.baths = jld(parseFloat(item.numberOfBathrooms));
        if (item?.floorSize?.value && !r.sqft)
          r.sqft = jld(parseInt(item.floorSize.value));
        if (item?.yearBuilt && !r.year)
          r.year = jld(parseInt(item.yearBuilt));
        if (item?.address?.addressLocality && item?.address?.addressRegion && !r.city)
          r.city = jld(`${item.address.addressLocality}, ${item.address.addressRegion}`);
        if (item?.address?.postalCode && !item?.address?.postalCode?.includes('{'))
          r._zipcode = item.address.postalCode?.replace(/\D/g, '').slice(0, 5);
      }
    } catch (_) {}
  }

  // ── og:description — the richest og tag ───────────────────────────────────
  // Zillow:   "3 bds · 2 ba · 1,432 sqft house. Listed for $285,000."
  // Redfin:   "1,432 sq ft house with 3 beds and 2 baths. Listed at $285,000."
  // Realtor:  "3 bedrooms, 2 bathrooms, 1,432 sq ft. List price $285,000."
  const desc = getMetaContent(html, ['og:description', 'twitter:description', 'description']);
  if (desc) {
    if (!r.price) {
      const v = regexPriceVal(desc, /(?:listed?\s*(?:for|at)|list(?:ing)?\s*price|asking)[^$]{0,30}\$([0-9,]+)/i)
             || regexPriceVal(desc, /\$([0-9,]+)/);
      if (v) r.price = strd(v);
    }
    // "3 bds · 2 ba" or "3 bedrooms and 2 bathrooms"
    if (!r.beds || !r.baths) {
      const bb = desc.match(/(\d+)\s*(?:bd|bed(?:room)?s?)\s*[·•|,\s]\s*(\d+(?:\.\d+)?)\s*(?:ba(?:th)?(?:s|room)?)/i);
      if (bb) {
        if (!r.beds)  r.beds  = strd(parseFloat(bb[1]));
        if (!r.baths) r.baths = strd(parseFloat(bb[2]));
      }
    }
    if (!r.beds) {
      const v = regexFloatVal(desc, /(\d+)\s*(?:bd|bed(?:room)?s?)(?:\s|·|•|,|$)/i);
      if (v !== null && v >= 0 && v <= 20) r.beds = strd(v);
    }
    if (!r.baths) {
      const v = regexFloatVal(desc, /(\d+(?:\.\d+)?)\s*(?:ba(?:th)?(?:s|room)?)(?:\s|·|•|,|$)/i);
      if (v !== null && v >= 0 && v <= 20) r.baths = strd(v);
    }
    if (!r.sqft) {
      const v = regexIntVal(desc, /([0-9,]+)\s*sq(?:\.?\s*ft|uare\s*f)/i);
      if (v && v >= 100 && v <= 30_000) r.sqft = strd(v);
    }
    if (!r.year) {
      const v = regexIntVal(desc, /(?:built|year\s*built|built\s*in)[^\d]{0,10}(\d{4})/i);
      if (v && v >= 1800 && v <= new Date().getFullYear()) r.year = strd(v);
    }
    if (!r.hoaMonthly) {
      const v = regexIntVal(desc, /hoa[^$]{0,15}\$([0-9,]+)\/mo/i)
             || regexIntVal(desc, /\$([0-9,]+)\/mo\s*hoa/i);
      if (v && v >= 0 && v <= 10_000) r.hoaMonthly = strd(v);
    }
  }

  // ── og:title — beds/baths/price last resort ───────────────────────────────
  const title = getMetaContent(html, ['og:title', 'twitter:title']);
  if (title) {
    if (!r.beds) {
      const v = regexFloatVal(title, /(\d+)\s*(?:bd|bed(?:s)?|BR)(?:\s|,|·|$)/i);
      if (v !== null && v >= 0 && v <= 20) r.beds = rgx(v);
    }
    if (!r.baths) {
      const v = regexFloatVal(title, /(\d+(?:\.\d+)?)\s*(?:ba(?:th)?(?:s)?|BA)(?:\s|,|·|$)/i);
      if (v !== null && v >= 0 && v <= 20) r.baths = rgx(v);
    }
    if (!r.price) {
      const v = regexPriceVal(title, /\$([0-9,]+)/);
      if (v) r.price = rgx(v);
    }
    if (!r.city) {
      const cm = title.match(/,\s*([A-Za-z][\w\s]+?),\s*([A-Z]{2})(?:\s+\d{5})?(?:\s*[-|]|$)/);
      if (cm) r.city = strd(`${cm[1].trim()}, ${cm[2]}`);
    }
  }

  if (!hasAnyValue(r)) return null;
  return r;
}

function getMetaContent(html, names) {
  for (const name of names) {
    for (const pat of [
      new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]+content=["']([^"']{5,800})["']`, 'i'),
      new RegExp(`<meta[^>]+content=["']([^"']{5,800})["'][^>]+(?:property|name)=["']${name}["']`, 'i'),
    ]) {
      const m = html.match(pat);
      if (m?.[1]) return htmlDecode(m[1]);
    }
  }
  return null;
}

function htmlDecode(s) {
  return s
    .replace(/&amp;/g,  '&').replace(/&lt;/g,   '<').replace(/&gt;/g,  '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g,  "'").replace(/&nbsp;/g, ' ')
    .replace(/&#x27;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
}

function toMobileUrl(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.hostname === 'www.zillow.com')  return url.replace('www.zillow.com',  'm.zillow.com');
    if (u.hostname === 'www.redfin.com')  return url.replace('www.redfin.com',  'm.redfin.com');
  } catch (_) {}
  return null;
}

// ══════════════════════════════════════════════════════════════════════════════
// CONFLICT RESOLUTION (unchanged — same multi-source logic)
// ══════════════════════════════════════════════════════════════════════════════

const TIER_WEIGHT = { jsonld: 3, structured: 2, regex: 1 };

function resolveAllFields(result, confMap, candidates) {
  for (const field of ALL_FIELDS) {
    if (field === 'city') continue;
    if (result[field] != null) continue;
    const rules = FIELD_RULES[field];
    if (!rules) continue;

    const seen = new Set(), readings = [];
    for (const cand of candidates) {
      if (!cand) continue;
      const raw    = cand[field];
      if (raw == null) continue;
      const tagged = (raw && typeof raw === 'object' && 'value' in raw) ? raw : { value: raw, tier: 'regex' };
      const { value, tier } = tagged;
      if (!rules.allowRegex && tier === 'regex') continue;
      if (rules.min !== undefined && value < rules.min) continue;
      if (rules.max !== undefined && value > rules.max) continue;
      const key = `${tier}:${value}`;
      if (seen.has(key)) continue;
      seen.add(key);
      readings.push({ value, tier, ...(field === 'year' ? { possiblyRemodel: value > (new Date().getFullYear() - 10) } : {}) });
    }

    if (!readings.length) continue;
    let winner = null, conf = 'low';
    if      (field === 'beds') ({ winner, conf } = resolveBeds(readings));
    else if (field === 'sqft') ({ winner, conf } = resolveSqft(readings));
    else if (field === 'year') ({ winner, conf } = resolveYear(readings));
    else                       ({ winner, conf } = resolveDefault(readings, rules.tolerance || 0));
    if (!winner) continue;
    result[field]  = winner.value;
    confMap[field] = conf;
  }
}

function resolveBeds(readings) {
  const rounded = readings.map(r => ({ ...r, value: Math.round(r.value) })).filter(r => r.value >= 0 && r.value <= 12);
  if (!rounded.length) return { winner: null, conf: 'low' };
  const freq = {};
  for (const r of rounded) freq[r.value] = (freq[r.value] || 0) + (TIER_WEIGHT[r.tier] || 1);
  const bestVal = Object.entries(freq).sort((a, b) => b[1] - a[1])[0][0];
  const winners = rounded.filter(r => String(r.value) === String(bestVal))
    .sort((a, b) => (TIER_WEIGHT[b.tier] || 1) - (TIER_WEIGHT[a.tier] || 1));
  const winner = winners[0];
  const hasConflict = Object.keys(freq).length > 1 &&
    rounded.some(r => String(r.value) !== String(bestVal) && (r.tier === 'jsonld' || r.tier === 'structured'));
  const conf = hasConflict ? 'low' : freq[bestVal] >= 5 ? 'high'
    : (winner.tier === 'jsonld' || winner.tier === 'structured') ? 'medium' : 'low';
  return { winner, conf };
}

function resolveSqft(readings) {
  if (!readings.length) return { winner: null, conf: 'low' };
  const groups = groupByTolerance(readings, 0.10);
  let bestGroup = null, bestScore = -1;
  for (const g of groups) {
    const s = g.reduce((a, r) => a + (TIER_WEIGHT[r.tier] || 1), 0);
    if (s > bestScore) { bestScore = s; bestGroup = g; }
  }
  if (!bestGroup) return { winner: null, conf: 'low' };
  const sorted   = [...bestGroup].sort((a, b) => a.value - b.value);
  const medianR  = sorted[Math.floor(sorted.length / 2)];
  const allVals  = readings.map(r => r.value).sort((a, b) => a - b);
  const conflict = groups.length > 1 && (allVals[allVals.length-1] - allVals[0]) / allVals[0] > 0.20;
  const conf = conflict ? 'low' : bestScore >= 5 ? 'high'
    : (medianR.tier === 'jsonld' || medianR.tier === 'structured') ? 'medium' : 'low';
  return { winner: medianR, conf };
}

function resolveYear(readings) {
  const pool  = readings.filter(r => !r.possiblyRemodel).length > 0
    ? readings.filter(r => !r.possiblyRemodel) : readings;
  const freq  = {};
  for (const r of pool) {
    if (!freq[r.value]) freq[r.value] = { count: 0, weight: 0, best: r };
    freq[r.value].count++;
    freq[r.value].weight += (TIER_WEIGHT[r.tier] || 1);
    if ((TIER_WEIGHT[r.tier] || 1) > (TIER_WEIGHT[freq[r.value].best.tier] || 1))
      freq[r.value].best = r;
  }
  const sorted = Object.entries(freq).sort((a, b) =>
    b[1].weight !== a[1].weight ? b[1].weight - a[1].weight : Number(a[0]) - Number(b[0]));
  if (!sorted.length) return { winner: null, conf: 'low' };
  const [, meta] = sorted[0];
  const conf = meta.weight >= 5 && meta.count >= 2 ? 'high'
    : (meta.best.tier === 'jsonld' || meta.best.tier === 'structured') ? 'medium' : 'low';
  return { winner: meta.best, conf: pool.every(r => r.possiblyRemodel) ? 'low' : conf };
}

function resolveDefault(readings, tolerance) {
  const groups = groupByTolerance(readings, tolerance);
  let bestGroup = null, bestScore = -1;
  for (const g of groups) {
    const s = g.reduce((a, r) => a + (TIER_WEIGHT[r.tier] || 1), 0);
    if (s > bestScore) { bestScore = s; bestGroup = g; }
  }
  if (!bestGroup) return { winner: null, conf: 'low' };
  bestGroup.sort((a, b) => (TIER_WEIGHT[b.tier] || 1) - (TIER_WEIGHT[a.tier] || 1));
  const winner = bestGroup[0];
  const conf = bestScore >= 5 && bestGroup.length >= 2 ? 'high'
    : (winner.tier === 'jsonld' || winner.tier === 'structured') ? 'medium' : 'low';
  return { winner, conf };
}

function groupByTolerance(readings, tolerance) {
  const groups = [];
  for (const r of readings) {
    let placed = false;
    for (const g of groups) {
      const ref  = g[0].value;
      const diff = typeof ref === 'number' && tolerance > 0
        ? Math.abs(r.value - ref) / (Math.abs(ref) || 1) : (r.value === g[0].value ? 0 : 1);
      if (diff <= tolerance) { g.push(r); placed = true; break; }
    }
    if (!placed) groups.push([r]);
  }
  return groups;
}

// ── Utility ───────────────────────────────────────────────────────────────────

function hasAnyValue(r) { return CORE_FIELDS.some(f => r[f] != null); }

function regexIntVal(text, pattern) {
  const m = text.match(pattern);
  return m ? parseInt(String(m[1]).replace(/,/g, '')) : null;
}

function regexFloatVal(text, pattern) {
  const m = text.match(pattern);
  return m ? parseFloat(m[1]) : null;
}

function regexPriceVal(text, pattern) {
  const m = text.match(pattern);
  if (!m) return null;
  const raw = String(m[1]).replace(/,/g, '');
  const v   = raw.toUpperCase().endsWith('M') ? parseFloat(raw) * 1_000_000
            : raw.toUpperCase().endsWith('K') ? parseFloat(raw) * 1_000
            : parseInt(raw);
  return (v > 10_000 && v < 50_000_000) ? v : null;
}

export const config = { maxDuration: 45 };
