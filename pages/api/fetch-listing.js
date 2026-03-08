import { rateLimitWithAuth }   from '../../lib/rateLimit.js';
import { fetchSafmrRent, getMgmtFeeForCity } from '../../lib/marketBenchmarkFetcher.js';
import { getSupabaseAdmin }    from '../../lib/supabase.js';
import { fetchListingViaAI, gapFillViaAI } from '../../lib/aiListingFetcher.js';
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
// UA rotation is per-request, not global, to avoid shared-state interference
// between concurrent requests in the same warm function container.
function makeSocialUARotator() {
  let idx = 0;
  return () => FETCH_UAS[idx++ % FETCH_UAS.length];
}

const CORE_FIELDS    = ['price', 'beds', 'baths', 'sqft', 'year', 'city'];
const ALL_FIELDS     = ['price', 'rent', 'beds', 'baths', 'sqft', 'year', 'city', 'taxAnnual', 'hoaMonthly'];
const NUMERIC_FIELDS = ['price', 'rent', 'beds', 'baths', 'sqft', 'year', 'taxAnnual', 'hoaMonthly'];

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  if (!rateLimitWithAuth(req, false, { anonMax: 20, authedMax: 20, windowMs: 60_000 })) {
    return res.status(429).json({ error: 'Too many requests. Please wait a minute and try again.' });
  }

  // Per-request UA rotator — avoids shared mutable state across concurrent requests
  const nextSocialUA = makeSocialUARotator();

  const { url } = req.body;
  if (!url || typeof url !== 'string') return res.status(400).json({ error: 'url required' });

  // ── SSRF protection: only allow known real-estate listing hostnames ────────
  // Prevents attackers from using this endpoint to probe internal infrastructure
  // (AWS metadata, internal services, localhost, etc.)
  const ALLOWED_LISTING_HOSTS = new Set([
    'www.zillow.com', 'zillow.com', 'm.zillow.com',
    'www.redfin.com', 'redfin.com', 'm.redfin.com',
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
    // Redfin URL paths embed property type (/multifamily/, /condo/, etc.)
    // Use as a low-confidence seed — AI classification will override if confident
    if (address.urlPropertyType && !result.propertyType) {
      result.propertyType  = address.urlPropertyType;
      confMap.propertyType = 'low';
    }
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
    const aiData = await withTimeout(fetchListingViaAI(resolvedUrl, address), 16_000, null);

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
      // propertyType from AI — set only if AI returned a valid classification
      if (aiData.propertyType && !result.propertyType) {
        result.propertyType  = aiData.propertyType;
        confMap.propertyType = 'high';
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

  // ── Layers 2b + 2c: og:meta fallback AND targeted gap-fill — run in PARALLEL ─
  //
  // 2b: og:meta — fills price/beds/baths/sqft from the listing's <head> tags.
  //     Works even for brand-new listings since it hits the actual page.
  //     Social bots (Googlebot UA) are always served full og:meta for SEO.
  //
  // 2c: Gemini gap-fill — targeted county assessor searches for any fields
  //     still null after the first AI pass: taxAnnual, hoaMonthly, year, sqft.
  //     County assessor records are permanently indexed and never bot-blocked.
  //     Running this in parallel with og:meta keeps total latency the same.

  // Identify what's missing before launching parallel fetch
  const missingAfterAI = [];
  if (result.taxAnnual  == null) missingAfterAI.push('taxAnnual');
  if (result.hoaMonthly == null) missingAfterAI.push('hoaMonthly');
  if (result.year       == null) missingAfterAI.push('year');
  if (result.sqft       == null) missingAfterAI.push('sqft');

  const hasFullAddress = address?.street && address?.city && address?.state;
  const shouldGapFill  = missingAfterAI.length > 0 && hasFullAddress;

  const [ogResult, gapData] = await Promise.allSettled([
    // 2b: og:meta
    (async () => {
      const og = await fetchOgMeta(resolvedUrl);
      if (og) resolveAllFields(result, confMap, [og]);
      // If still missing price, try mobile variant
      if (result.price == null) {
        const mUrl = toMobileUrl(resolvedUrl);
        if (mUrl) {
          const ogM = await fetchOgMeta(mUrl);
          if (ogM) resolveAllFields(result, confMap, [ogM]);
        }
      }
      return null;
    })(),
    // 2c: gap-fill (or immediate null if not needed)
    shouldGapFill
      ? withTimeout(gapFillViaAI(address, missingAfterAI), 12_000, null)
      : Promise.resolve(null),
  ]);

  // Apply gap-fill results for any fields still null after og:meta
  const gapResult = gapData.status === 'fulfilled' ? gapData.value : null;
  if (gapResult) {
    const gapConf = gapResult._gapFillConfidence === 'high' ? 'high' : 'medium';
    for (const f of missingAfterAI) {
      if (gapResult[f] != null && result[f] == null) {
        result[f]  = gapResult[f];
        confMap[f] = gapConf;
      }
    }
  }

  // ── HOA default for non-HOA property types ────────────────────────────────
  // SFR and SFR+ADU properties almost never have an HOA. If hoaMonthly is still
  // null after all layers, and propertyType is sfr/sfr_adu, default to 0 (no HOA).
  // This eliminates the most common null — most SFRs don't have HOAs.
  // Condos and mfr properties stay null (unknown, not zero) because they commonly do.
  if (result.hoaMonthly == null) {
    const pt = result.propertyType || 'sfr';
    if (pt === 'sfr' || pt === 'sfr_adu') {
      result.hoaMonthly  = 0;
      confMap.hoaMonthly = 'medium'; // reasonable default, user can override
    }
  }

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

  // ── Layer 4: Rent estimate — full triangulation (HUD SAFMR + Census ACS + state FMR) ──
  // For for-sale listings rent is never listed, so we always need to estimate it.
  // The existing /api/rent-estimate endpoint triangulates 3 real data sources —
  // we call its logic directly here to avoid an extra HTTP round-trip.
  if (result.rent == null && (address?.zipcode || result.city)) {
    try {
      const bedsForRent = result.beds != null ? Math.round(Number(result.beds)) : 2;
      const zipForRent  = address?.zipcode || null;
      const cityForRent = result.city || null;
      const stateCode   = cityForRent?.toUpperCase().match(/,\s*([A-Z]{2})$/)?.[1] || null;

      // Run all three sources in parallel — same triangulation as /api/rent-estimate
      const [safmrRes, censusRes, hudRes] = await Promise.allSettled([
        zipForRent ? fetchSafmrRent(zipForRent, bedsForRent) : Promise.resolve(null),
        zipForRent ? fetchCensusRent(zipForRent, bedsForRent) : Promise.resolve(null),
        stateCode  ? fetchHudStateFmr(stateCode, bedsForRent) : Promise.resolve(null),
      ]);

      const safmr  = safmrRes.status  === 'fulfilled' ? safmrRes.value  : null;
      const census = censusRes.status === 'fulfilled' ? censusRes.value : null;
      const hud    = hudRes.status    === 'fulfilled' ? hudRes.value    : null;

      const triangulated = triangulateRent({ safmr, census, hud, cityForRent, bedsForRent });
      if (triangulated) {
        result.rent  = triangulated.mid;
        // High confidence if 2+ real sources agreed; low if state-level fallback only
        confMap.rent = triangulated.sources >= 2 ? 'medium' : 'low';
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
           propertyType:null, listingDescription:null, unitRents:null };
}

const jld  = v => ({ value: v, tier: 'jsonld' });
const strd = v => ({ value: v, tier: 'structured' });
const rgx  = v => ({ value: v, tier: 'regex' });

// withTimeout: races the promise against a deadline and returns the fallback on timeout.
// Passes an AbortSignal into the promise factory so the underlying fetch (Gemini, OSM, etc.)
// is actually cancelled — not just abandoned. Abandoned promises keep consuming network I/O
// and API quota even after the caller has moved on.
//
// Usage: withTimeout(signal => fetchSomething(url, signal), 10_000, null)
// For backwards compat with 0-arg callsites: if promiseOrFactory is already a Promise
// (not a function), we race it without cancellation (same as old behaviour).
function withTimeout(promiseOrFactory, ms, fallback = null) {
  if (typeof promiseOrFactory === 'function') {
    // Preferred: factory receives signal so it can pass it to fetch()
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    return promiseOrFactory(controller.signal)
      .then(v  => { clearTimeout(timer); return v; })
      .catch(e => {
        clearTimeout(timer);
        if (e?.name === 'AbortError') return fallback;
        throw e;
      });
  }
  // Legacy: plain promise — race without cancellation (no regression for callers
  // that don't yet pass a factory; they should be migrated over time)
  let timer;
  const deadline = new Promise(resolve => { timer = setTimeout(() => resolve(fallback), ms); });
  return Promise.race([promiseOrFactory, deadline]).finally(() => clearTimeout(timer));
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
      // /homedetails/<slug>/<zpid>_zpid/ — standard listing URL
      // /b/<slug>/ — shortened listing URL
      // /homes/for_sale/<zpid>_zpid/ or /homes/for_sale/<address>_rb/ — alternate listing URL
      const m = path.match(/\/(?:homedetails(?:\/new-construction)?|b)\/([^/]+)/i)
             || path.match(/\/homes\/(?:for_sale|for_rent)\/([^/]+)/i);
      if (m) return parseSlug(m[1].replace(/_\d+_?zpid\/?$/, '').replace(/-\d+_zpid$/, '').replace(/_rb\/?$/, ''));
    }

    if (url.includes('redfin.com')) {
      const m = path.match(/\/(?:us\/)?([A-Z]{2})\/([^/]+)\/([^/]+)\/(home|condo|townhouse|multifamily|land)\//i);
      if (m) {
        const state    = m[1].toUpperCase();
        const city     = m[2].replace(/-/g, ' ');
        const slug     = m[3];
        const pathType = m[4].toLowerCase(); // 'home'|'condo'|'townhouse'|'multifamily'|'land'
        const zipM     = slug.match(/-(\d{5})$/);
        const street   = slug.replace(/-\d{5}$/, '').replace(/-/g, ' ');
        const urlPropertyType = pathType === 'multifamily' ? 'duplex'
          : (pathType === 'condo' || pathType === 'townhouse') ? 'condo'
          : null; // 'home' and 'land' don't tell us enough
        return { street: toTitleCase(street), city: toTitleCase(city), state, zipcode: zipM?.[1] || '', urlPropertyType };
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
      // Zillow: gdpClientCache lives at pageProps level (modern, 2024+)
      // OR under componentProps.gdpClientCache (older builds).
      // Also falls back to initialReduxState path (pre-2023 builds).
      const zp = nd?.props?.pageProps;
      const zdp = (zp?.gdpClientCache
          ? Object.values(zp.gdpClientCache)[0]?.property
          : null)
        || (zp?.componentProps?.gdpClientCache
          ? Object.values(zp.componentProps.gdpClientCache)[0]?.property
          : null)
        || zp?.componentProps?.initialReduxState?.gdp?.fullPageData?.property;
      if (zdp) {
        if (zdp.price && !r.price)       r.price = jld(parseInt(zdp.price));
        if (zdp.bedrooms && !r.beds)     r.beds  = jld(parseFloat(zdp.bedrooms));
        if (zdp.bathrooms && !r.baths)   r.baths = jld(parseFloat(zdp.bathrooms));
        if (zdp.livingArea && !r.sqft)   r.sqft  = jld(parseInt(zdp.livingArea));
        if (zdp.yearBuilt && !r.year)    r.year  = jld(parseInt(zdp.yearBuilt));
        if (zdp.taxAnnualAmount && !r.taxAnnual) r.taxAnnual = jld(parseFloat(zdp.taxAnnualAmount));
        if (zdp.monthlyHoaFee != null && !r.hoaMonthly) r.hoaMonthly = jld(parseFloat(zdp.monthlyHoaFee));
        if (zdp.address?.city && zdp.address?.state && !r.city)
          r.city = jld(`${zdp.address.city}, ${zdp.address.state}`);
        // homeType: "SINGLE_FAMILY" | "CONDO" | "TOWNHOUSE" | "MULTI_FAMILY" | "APARTMENT" | "MANUFACTURED"
        if (zdp.homeType && !r.propertyType) {
          const ht = zdp.homeType.toUpperCase();
          r.propertyType =
            ht === 'CONDO'         ? 'condo'
            : ht === 'TOWNHOUSE'   ? 'condo'
            : ht === 'MULTI_FAMILY'? 'duplex'  // floor count/unit count unknown; AI will refine
            : ht === 'APARTMENT'   ? 'mfr'
            : 'sfr';
        }
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

// ══════════════════════════════════════════════════════════════════════════════
// RENT TRIANGULATION — same logic as /api/rent-estimate but inlined to avoid
// an extra HTTP round-trip. Pulls from 3 free government data sources in parallel.
// ══════════════════════════════════════════════════════════════════════════════

// Bedroom ratio multipliers relative to 2BR (HUD-derived)
const BR_RATIOS = { 0:0.74, 1:0.85, 2:1.00, 3:1.24, 4:1.47 };

// State median 2BR rent — HUD FY2025 FMR documentation
const STATE_MEDIAN_2BR = {
  AL:880,AK:1320,AZ:1280,AR:820,CA:1980,CO:1560,CT:1560,DE:1380,DC:2210,FL:1560,
  GA:1180,HI:2180,ID:1120,IL:1180,IN:900,IA:920,KS:920,KY:880,LA:980,ME:1280,
  MD:1620,MA:1880,MI:1020,MN:1180,MS:820,MO:920,MT:1120,NE:1020,NV:1320,NH:1520,
  NJ:1780,NM:980,NY:1580,NC:1120,ND:880,OH:920,OK:880,OR:1380,PA:1120,RI:1480,
  SC:1120,SD:880,TN:1080,TX:1180,UT:1320,VT:1380,VA:1380,WA:1580,WV:780,WI:980,WY:980,
};

// Metro-tier multipliers relative to state median
const METRO_MULT = {
  'new york':1.55,'los angeles':1.50,'san francisco':1.60,'san jose':1.55,'seattle':1.35,
  'boston':1.40,'washington':1.35,'miami':1.25,'denver':1.20,'austin':1.15,'nashville':1.10,
  'portland':1.15,'san diego':1.30,'oakland':1.40,'chicago':1.15,'dallas':1.05,
  'cleveland':0.75,'detroit':0.72,'memphis':0.75,'birmingham':0.78,'indianapolis':0.82,
  'columbus':0.85,'cincinnati':0.82,'st. louis':0.80,'kansas city':0.85,'louisville':0.82,
};

async function fetchCensusRent(zip, beds) {
  if (!zip) return null;
  try {
    const url = `https://api.census.gov/data/2023/acs/acs5?get=B25058_001E,B25031_003E,B25031_004E,B25031_005E&for=zip+code+tabulation+area:${zip}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!r.ok) return null;
    const rows = await r.json();
    if (!rows?.[1]) return null;
    const [medianAll, br1, br2, br3] = rows[1].map(v => parseInt(v) > 0 ? parseInt(v) : null);
    const bedsNum = Math.min(Math.max(parseInt(beds) || 2, 0), 3);
    const byBeds = [null, br1, br2, br3][bedsNum];
    return byBeds && byBeds > 300 ? byBeds : (medianAll && medianAll > 300 ? Math.round(medianAll * (BR_RATIOS[bedsNum] || 1)) : null);
  } catch { return null; }
}

async function fetchHudStateFmr(stateCode, beds) {
  if (!stateCode) return null;
  try {
    const url = `https://www.huduser.gov/hudapi/public/fmr/statedata/${stateCode}`;
    const r = await fetch(url, { headers: { 'User-Agent': 'RentalIQ/1.0' }, signal: AbortSignal.timeout(6000) });
    if (!r.ok) return null;
    const body = await r.json();
    const counties = body?.data?.counties || [];
    if (!counties.length) return null;
    const bedsNum = Math.min(Math.max(parseInt(beds) || 2, 0), 4);
    const field = ['Efficiency','One-Bedroom','Two-Bedroom','Three-Bedroom','Four-Bedroom'][bedsNum];
    const vals = counties.map(c => parseFloat(c[field])).filter(v => v > 200);
    return vals.length ? Math.round(vals.reduce((a,b)=>a+b,0)/vals.length) : null;
  } catch { return null; }
}

function triangulateRent({ safmr, census, hud, cityForRent, bedsForRent }) {
  const bedsNum   = Math.min(Math.max(parseInt(bedsForRent) || 2, 0), 4);
  const brRatio   = BR_RATIOS[bedsNum] ?? 1.0;
  const cityLower = (cityForRent || '').split(',')[0].trim().toLowerCase();
  const metroMult = Object.entries(METRO_MULT).find(([k]) => cityLower.includes(k))?.[1] ?? 1.0;
  const stateCode = cityForRent?.toUpperCase().match(/,\s*([A-Z]{2})$/)?.[1] || null;

  const estimates = [];

  // Source 1: HUD SAFMR — ZIP-level, highest precision
  if (safmr?.rent && safmr.rent > 300) estimates.push({ v: safmr.rent, w: 5 });

  // Source 2: Census ACS — actual observed rents in that ZIP
  if (census && census > 300) estimates.push({ v: census, w: 3 });

  // Source 3: HUD state FMR — metro-adjusted
  if (hud && hud > 300) estimates.push({ v: Math.round(hud * metroMult), w: 2 });

  // Source 4: State median baseline — always available
  const stateBase = stateCode ? STATE_MEDIAN_2BR[stateCode] : null;
  if (stateBase) estimates.push({ v: Math.round(stateBase * brRatio * metroMult), w: 1 });

  if (!estimates.length) return null;

  const totalW = estimates.reduce((s, e) => s + e.w, 0);
  const mid    = Math.round(estimates.reduce((s, e) => s + e.v * e.w, 0) / totalW / 25) * 25;

  return { mid, sources: estimates.length };
}
