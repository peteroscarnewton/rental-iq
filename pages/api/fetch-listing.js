import { rateLimitWithAuth } from "../../lib/rateLimit.js";
// /api/fetch-listing
// Strategy:
//   1. Extract full street address from the listing URL slug (free, instant)
//   2. In parallel, fetch 3 syndicated listing sites that carry MLS data without blocking
//   3. Merge with confidence-aware logic:
//        - Each value tagged by source tier: jsonld > structured > regex
//        - Per-field sanity bounds applied before any value is accepted
//        - Confidence: 'high'   = 2+ sources agree within tolerance
//                      'medium' = 1 high-tier (jsonld/structured) source
//                      'low'    = 1 regex-only source (amber badge, "verify")
//        - taxAnnual / hoaMonthly: never accepted from regex — structured only
//   4. Fall back to directly fetching the original URL if syndicated sites have gaps
//
// Returns: { price, rent, beds, baths, sqft, year, city, taxAnnual, hoaMonthly,
//            populated, failed, confidence: {field: 'high'|'medium'|'low'},
//            blocked, warning }

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  if (!rateLimitWithAuth(req, false, { anonMax: 20, authedMax: 20, windowMs: 60_000 })) {
    return res.status(429).json({ error: 'Too many requests. Please wait a minute and try again.' });
  }

  const { url } = req.body;
  if (!url || typeof url !== 'string') return res.status(400).json({ error: 'url required' });

  // ── Step 1: Extract address from URL slug ─────────────────────────────────
  const address = extractAddressFromUrl(url);

  // ── Step 2: Fetch syndicated sites in parallel if we got an address ───────
  let result    = emptyResult();
  let confMap   = {};  // { field: 'high' | 'medium' | 'low' }

  if (address) {
    result.city = `${address.city}, ${address.state}`;
    confMap.city = 'high'; // parsed from URL slug — always trustworthy
    const candidates = await fetchSyndicatedSites(address);
    mergeWithConfidence(result, confMap, candidates);
  }

  // ── Step 3: Fill gaps via direct URL fetch ────────────────────────────────
  // Always check ALL_FIELDS for gaps — not just CORE_FIELDS.
  // Critically: taxAnnual and hoaMonthly are never returned by syndicated parsers
  // (Highrises, Homes.com, Point2 don't carry tax/HOA data), so without this
  // always-run check those fields would only ever come back null.
  const stillMissing = ALL_FIELDS.filter(f => result[f] === null || result[f] === undefined);
  if (stillMissing.length > 0) {
    const { result: directResult, confMap: directConf } = await fetchDirectUrl(url);
    for (const f of stillMissing) {
      if (directResult[f] !== null && directResult[f] !== undefined) {
        result[f]  = directResult[f];
        confMap[f] = directConf[f] || 'medium';
      }
    }
  }

  // ── Tally & respond ────────────────────────────────────────────────────────
  const populated = ALL_FIELDS.filter(f => result[f] !== null && result[f] !== undefined);
  const failed    = ALL_FIELDS.filter(f => result[f] === null || result[f] === undefined);

  // Stringify all numeric fields for form inputs
  for (const f of NUMERIC_FIELDS) {
    if (result[f] !== null && result[f] !== undefined) result[f] = String(result[f]);
  }

  let warning = null;
  if (populated.length === 0) {
    warning = 'Could not extract data from this listing. Please enter details manually.';
  } else if (failed.includes('price')) {
    warning = 'Got some details but price is missing — please fill it in.';
  } else if (populated.length < 3) {
    warning = `Got ${populated.length} field${populated.length !== 1 ? 's' : ''} — fill in the rest manually.`;
  }

  return res.status(200).json({ ...result, populated, failed, confidence: confMap, blocked: false, warning });
}

// ── Constants ─────────────────────────────────────────────────────────────────
const CORE_FIELDS    = ['price', 'beds', 'baths', 'sqft', 'year', 'city'];
const ALL_FIELDS     = ['price', 'rent', 'beds', 'baths', 'sqft', 'year', 'city', 'taxAnnual', 'hoaMonthly'];
const NUMERIC_FIELDS = ['price', 'rent', 'beds', 'baths', 'sqft', 'year', 'taxAnnual', 'hoaMonthly'];

// Per-field rules: sanity bounds + whether regex is acceptable as a source
const FIELD_RULES = {
  price:      { min: 10_000,                    max: 50_000_000, allowRegex: true,  tolerance: 0.05 },
  beds:       { min: 0,                         max: 20,         allowRegex: true,  tolerance: 0,    exact: true },
  baths:      { min: 0,                         max: 20,         allowRegex: true,  tolerance: 0.25, exact: false },
  sqft:       { min: 100,                       max: 30_000,     allowRegex: true,  tolerance: 0.10 },
  year:       { min: 1800, max: new Date().getFullYear() + 1,    allowRegex: false, tolerance: 0,    exact: true },
  city:       { allowRegex: true,  tolerance: 0 },
  rent:       { min: 100,                       max: 50_000,     allowRegex: true,  tolerance: 0.10 },
  taxAnnual:  { min: 0,                         max: 200_000,    allowRegex: false, tolerance: 0.15 },
  hoaMonthly: { min: 0,                         max: 10_000,     allowRegex: false, tolerance: 0.15 },
};

const STREET_SUFFIXES = [
  'Ave','Avenue','St','Street','Blvd','Boulevard','Dr','Drive','Rd','Road',
  'Ln','Lane','Ct','Court','Pl','Place','Way','Cir','Circle','Pkwy','Parkway',
  'Ter','Terrace','Trl','Trail','Hwy','Highway','Fwy','Freeway','Sq','Square',
  'Loop','Run','Pass','Bend','Ridge','Glen','Hill','Bay','Pt','Point',
];

function emptyResult() {
  return { price:null, rent:null, beds:null, baths:null, sqft:null, year:null, city:null, taxAnnual:null, hoaMonthly:null };
}

// ── Confidence-aware merge ────────────────────────────────────────────────────
// Each candidate is { price, beds, ... } where each field value is either:
//   a raw number/string, OR a tagged object { value, tier: 'jsonld'|'structured'|'regex' }
// mergeWithConfidence resolves conflicts and writes into result + confMap.

function mergeWithConfidence(result, confMap, candidates) {
  for (const field of ALL_FIELDS) {
    if (field === 'city') continue; // already set from URL slug
    if (result[field] !== null && result[field] !== undefined) continue; // already resolved

    const rules = FIELD_RULES[field];
    if (!rules) continue;

    // Collect all tagged readings for this field across candidates
    const readings = [];
    for (const cand of candidates) {
      if (!cand) continue;
      const raw = cand[field];
      if (raw === null || raw === undefined) continue;

      // Candidates may return plain values or tagged objects
      const tagged = (raw && typeof raw === 'object' && 'value' in raw) ? raw : { value: raw, tier: 'regex' };
      const { value, tier } = tagged;

      // Skip regex readings for fields that don't allow it
      if (!rules.allowRegex && tier === 'regex') continue;

      // Apply sanity bounds
      if (rules.min !== undefined && value < rules.min) continue;
      if (rules.max !== undefined && value > rules.max) continue;

      // For year: never accept a year that looks like a renovation date
      // (year must be the most common structural year, not a remodel year)
      if (field === 'year') {
        // Extra check: if the value is within the last 10 years, it might be a remodel.
        // We keep it but only at 'low' confidence unless 2+ sources agree.
        readings.push({ value, tier, possiblyRemodel: value > (new Date().getFullYear() - 10) });
      } else {
        readings.push({ value, tier });
      }
    }

    if (readings.length === 0) continue;

    // Tier weights: jsonld=3, structured=2, regex=1
    const tierWeight = { jsonld: 3, structured: 2, regex: 1 };

    // Group readings that agree within tolerance
    const groups = groupByTolerance(readings, rules.tolerance || 0);

    // Score each group: sum of tier weights
    let bestGroup = null;
    let bestScore = -1;
    for (const group of groups) {
      const score = group.reduce((s, r) => s + (tierWeight[r.tier] || 1), 0);
      if (score > bestScore) { bestScore = score; bestGroup = group; }
    }

    if (!bestGroup || bestGroup.length === 0) continue;

    // Pick the representative value: highest-tier reading in the winning group
    bestGroup.sort((a, b) => (tierWeight[b.tier] || 1) - (tierWeight[a.tier] || 1));
    const winner = bestGroup[0];

    // Determine confidence
    const totalWeight = bestGroup.reduce((s, r) => s + (tierWeight[r.tier] || 1), 0);
    let conf;
    if (bestGroup.length >= 2 && totalWeight >= 4) {
      conf = 'high';   // 2+ sources with at least one jsonld/structured
    } else if (winner.tier === 'jsonld' || winner.tier === 'structured') {
      conf = 'medium'; // single trustworthy structured source
    } else {
      conf = 'low';    // regex only
    }

    // Remodel-year penalty: if all readings look like renovation years, drop to low
    if (field === 'year' && bestGroup.every(r => r.possiblyRemodel)) {
      conf = 'low';
    }

    result[field]  = winner.value;
    confMap[field] = conf;
  }
}

// Group an array of readings where values agree within `tolerance` (fraction, 0 = exact)
function groupByTolerance(readings, tolerance) {
  const groups = [];
  for (const r of readings) {
    let placed = false;
    for (const g of groups) {
      const ref = g[0].value;
      const diff = typeof ref === 'number' && tolerance > 0
        ? Math.abs(r.value - ref) / (Math.abs(ref) || 1)
        : (r.value === g[0].value ? 0 : 1);
      if (diff <= tolerance) { g.push(r); placed = true; break; }
    }
    if (!placed) groups.push([r]);
  }
  return groups;
}

// ── Address extraction from URL slug ─────────────────────────────────────────
function extractAddressFromUrl(url) {
  try {
    const u = new URL(url);
    const path = u.pathname;
    let slug = null;

    // Zillow: /homedetails/3803-W-San-Miguel-Ave-Phoenix-AZ-85019/12345_zpid
    const zillowM = path.match(/\/homedetails\/([^/]+)\//i);
    if (zillowM && url.includes('zillow.com')) slug = zillowM[1];

    // Redfin: /AZ/Phoenix/3803-W-San-Miguel-Ave-85019/home/...
    const redfinM = path.match(/\/([A-Z]{2})\/([^/]+)\/([^/]+)\/home\//i);
    if (redfinM && url.includes('redfin.com')) {
      const state    = redfinM[1].toUpperCase();
      const cityRaw  = redfinM[2].replace(/-/g, ' ');
      const streetSlug = redfinM[3];
      const zipM     = streetSlug.match(/-(\d{5})$/);
      const zipcode  = zipM ? zipM[1] : '';
      const streetRaw = streetSlug.replace(/-\d{5}$/, '').replace(/-/g, ' ');
      return { street: toTitleCase(streetRaw), city: toTitleCase(cityRaw), state, zipcode };
    }

    // Realtor.com: /realestateandhomes-detail/3803-W-San-Miguel-Ave_Phoenix_AZ_85019_M12345
    const realtorM = path.match(/\/realestateandhomes-detail\/([^/]+)/i);
    if (realtorM && url.includes('realtor.com')) slug = realtorM[1].replace(/_M\d+$/, '').replace(/_/g, '-');

    if (!slug) return null;

    const parts  = slug.split('-');
    const zipIdx = parts.findIndex(p => /^\d{5}$/.test(p));
    if (zipIdx < 3) return null;

    const zipcode  = parts[zipIdx];
    const state    = parts[zipIdx - 1].toUpperCase();
    const preState = parts.slice(0, zipIdx - 1);

    let suffixIdx = -1;
    for (let i = preState.length - 1; i >= 0; i--) {
      if (STREET_SUFFIXES.some(s => s.toLowerCase() === preState[i].toLowerCase())) {
        suffixIdx = i; break;
      }
    }
    if (suffixIdx < 0) return null;

    const street = toTitleCase(preState.slice(0, suffixIdx + 1).join(' '));
    const city   = toTitleCase(preState.slice(suffixIdx + 1).join(' '));
    if (!street || !city || !state) return null;
    return { street, city, state, zipcode };
  } catch (_) { return null; }
}

function toTitleCase(str) {
  return str.replace(/\b\w/g, c => c.toUpperCase());
}

// ── Fetch syndicated sites in parallel ───────────────────────────────────────
async function fetchSyndicatedSites(address) {
  const { street, city, state, zipcode } = address;
  const citySlug  = city.replace(/\s+/g, '-');
  const stateLC   = state.toLowerCase();
  const streetSlug = street.replace(/\s+/g, '-').toLowerCase();

  const targets = [
    {
      url: `https://www.highrises.com/${citySlug.toLowerCase()}-${stateLC}/${streetSlug}-${zipcode}/`,
      parser: parseHighrises,
    },
    {
      url: `https://www.homes.com/${stateLC}/${citySlug.toLowerCase()}/${streetSlug}-${zipcode}/`,
      parser: parseHomescom,
    },
    {
      url: `https://www.point2homes.com/US/Real-Estate/${state}/${city.replace(/\s+/g, '-')}/${street.replace(/\s+/g, '-')}-${zipcode}.html`,
      parser: parsePoint2,
    },
  ];

  const fetched = await Promise.allSettled(
    targets.map(({ url, parser }) => fetchAndParse(url, parser))
  );

  return fetched
    .filter(r => r.status === 'fulfilled' && r.value)
    .map(r => r.value);
}

async function fetchAndParse(url, parser) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: controller.signal,
      redirect: 'follow',
    });
    if (!res.ok) return null;
    const html = await res.text();
    return parser(html);
  } catch (_) { return null; }
  finally { clearTimeout(timeout); }
}

// ── Helpers: tagged value constructors ───────────────────────────────────────
const jld  = v => ({ value: v, tier: 'jsonld' });
const strd = v => ({ value: v, tier: 'structured' });
const rgx  = v => ({ value: v, tier: 'regex' });

// ── Site-specific parsers (return tagged values) ──────────────────────────────

function parseHighrises(html) {
  const r = emptyResult();
  for (const m of html.matchAll(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) {
    try {
      const ld   = JSON.parse(m[1]);
      const item = Array.isArray(ld) ? ld[0] : ld;
      if (item?.offers?.price)            r.price = jld(parseInt(String(item.offers.price).replace(/[^0-9]/g,'')));
      if (item?.numberOfBedrooms)         r.beds  = jld(parseFloat(item.numberOfBedrooms));
      if (item?.numberOfBathroomsTotal)   r.baths = jld(parseFloat(item.numberOfBathroomsTotal));
      if (item?.floorSize?.value)         r.sqft  = jld(parseInt(item.floorSize.value));
      if (item?.yearBuilt)                r.year  = jld(parseInt(item.yearBuilt));
      if (item?.address?.addressLocality && item?.address?.addressRegion)
        r.city = jld(`${item.address.addressLocality}, ${item.address.addressRegion}`);
    } catch (_) {}
  }
  // Regex fallbacks only for fields that allow it
  // Price regex: require list/sale/asking/price context to avoid matching fee amounts
  if (!r.price) { const v = regexPriceVal(html, /(?:list|sale|asking|price)[^$]{0,30}\$([\d,]+)/i) || regexPriceVal(html, /\$([\d,]+)\s*(?:list price|asking price|sale price)/i); if (v) r.price = rgx(v); }
  if (!r.beds)  { const v = regexFloatVal(html, /(\d+)\s*(?:bed|BR|bedroom)/i);             if (v !== null) r.beds  = rgx(v); }
  if (!r.baths) { const v = regexFloatVal(html, /(\d+(?:\.\d+)?)\s*(?:bath|BA)/i);          if (v !== null) r.baths = rgx(v); }
  if (!r.sqft)  { const v = regexIntVal(html, /([\d,]+)\s*(?:sq\s*ft|sqft)/i);              if (v) r.sqft  = rgx(v); }
  // No regex for year — too risky (remodel years)
  return hasAnyTaggedValue(r) ? r : null;
}

function parseHomescom(html) {
  const r = emptyResult();
  for (const m of html.matchAll(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) {
    try {
      const ld   = JSON.parse(m[1]);
      const item = Array.isArray(ld) ? ld[0] : ld;
      if (item?.['@type'] === 'SingleFamilyResidence' || item?.['@type'] === 'House' || item?.offers) {
        if (item?.offers?.price)            r.price = jld(parseInt(String(item.offers.price).replace(/[^0-9]/g,'')));
        if (item?.numberOfBedrooms)         r.beds  = jld(parseFloat(item.numberOfBedrooms));
        const bathVal = item?.numberOfBathroomsTotal || item?.numberOfBathrooms;
        if (bathVal)                        r.baths = jld(parseFloat(bathVal));
        if (item?.floorSize?.value)         r.sqft  = jld(parseInt(item.floorSize.value));
        if (item?.yearBuilt)                r.year  = jld(parseInt(item.yearBuilt));
        if (item?.address?.addressLocality && item?.address?.addressRegion)
          r.city = jld(`${item.address.addressLocality}, ${item.address.addressRegion}`);
      }
    } catch (_) {}
  }
  // __NEXT_DATA__ as structured fallback
  if (!r.price || !r.beds) {
    const nd = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (nd) {
      try {
        const data = JSON.parse(nd[1]);
        const prop = deepFind(data?.props, obj => obj?.listPrice && obj?.beds);
        if (prop) {
          if (!r.price && prop.listPrice) r.price = strd(parseInt(prop.listPrice));
          if (!r.beds  && prop.beds)      r.beds  = strd(parseFloat(prop.beds));
          if (!r.baths && prop.baths)     r.baths = strd(parseFloat(prop.baths));
          if (!r.sqft  && prop.sqft)      r.sqft  = strd(parseInt(prop.sqft));
          if (!r.year  && prop.yearBuilt) r.year  = strd(parseInt(prop.yearBuilt));
        }
      } catch (_) {}
    }
  }
  if (!r.beds)  { const v = regexFloatVal(html, /(\d+)\s*(?:bed|BR|bedroom)/i);    if (v !== null) r.beds  = rgx(v); }
  if (!r.baths) { const v = regexFloatVal(html, /(\d+(?:\.\d+)?)\s*(?:bath|BA)/i); if (v !== null) r.baths = rgx(v); }
  if (!r.sqft)  { const v = regexIntVal(html, /([\d,]+)\s*(?:sq\s*ft|sqft)/i);     if (v) r.sqft  = rgx(v); }
  return hasAnyTaggedValue(r) ? r : null;
}

function parsePoint2(html) {
  const r = emptyResult();
  for (const m of html.matchAll(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) {
    try {
      const ld   = JSON.parse(m[1]);
      const item = Array.isArray(ld) ? ld[0] : ld;
      if (item?.offers?.price)            r.price = jld(parseInt(String(item.offers.price).replace(/[^0-9]/g,'')));
      if (item?.numberOfBedrooms)         r.beds  = jld(parseFloat(item.numberOfBedrooms));
      if (item?.numberOfBathroomsTotal)   r.baths = jld(parseFloat(item.numberOfBathroomsTotal));
      if (item?.floorSize?.value)         r.sqft  = jld(parseInt(item.floorSize.value));
      if (item?.yearBuilt)                r.year  = jld(parseInt(item.yearBuilt));
      if (item?.address?.addressLocality && item?.address?.addressRegion)
        r.city = jld(`${item.address.addressLocality}, ${item.address.addressRegion}`);
    } catch (_) {}
  }
  if (!r.price) { const v = regexPriceVal(html, /(?:list|sale|asking|price)[^$]{0,30}\$([\d,]+)/i) || regexPriceVal(html, /\$([\d,]+)\s*(?:list price|asking price|sale price)/i); if (v) r.price = rgx(v); }
  if (!r.beds)  { const v = regexFloatVal(html, /(\d+)\s*(?:bed|BR|bedroom)/i);    if (v !== null) r.beds  = rgx(v); }
  if (!r.baths) { const v = regexFloatVal(html, /(\d+(?:\.\d+)?)\s*(?:bath|BA)/i); if (v !== null) r.baths = rgx(v); }
  if (!r.sqft)  { const v = regexIntVal(html, /([\d,]+)\s*(?:sq\s*ft|sqft)/i);     if (v) r.sqft  = rgx(v); }
  return hasAnyTaggedValue(r) ? r : null;
}

// ── Direct URL fallback ───────────────────────────────────────────────────────
async function fetchDirectUrl(url) {
  const r    = emptyResult();
  const conf = {};
  const isZillow  = url.includes('zillow.com');
  const isRedfin  = url.includes('redfin.com');
  const isRealtor = url.includes('realtor.com');

  const headerSets = [
    {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Sec-Fetch-Dest': 'document', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Site': 'none',
    },
    {
      'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
      'Accept': 'text/html',
    },
  ];

  let html = '';
  for (const headers of headerSets) {
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 12000);
      try {
        const res = await fetch(url, { headers, signal: controller.signal, redirect: 'follow' });
        if (res.ok) { html = await res.text(); }
      } finally { clearTimeout(t); }
      if (html) break;
    } catch (_) {}
  }

  if (!html) return { result: r, confMap: conf };

  if (isZillow)  extractZillow(html, r, conf);
  if (isRedfin)  extractRedfin(html, r, conf);
  if (isRealtor) extractRealtor(html, r, conf);
  extractUniversal(html, r, conf, url);
  return { result: r, confMap: conf };
}

// ── Zillow direct extractor ───────────────────────────────────────────────────
function extractZillow(html, result, conf) {
  const ndMatch = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (ndMatch) {
    try {
      const nd    = JSON.parse(ndMatch[1]);
      const zprop = deepFind(nd?.props, obj =>
        obj && typeof obj === 'object' && (obj.price || obj.listingPrice) &&
        (obj.bedrooms !== undefined || obj.beds !== undefined)
      );
      if (zprop) {
        const set = (f, v) => {
          if (v === undefined || v === null) return;
          const rules = FIELD_RULES[f];
          if (rules) {
            if (rules.min !== undefined && v < rules.min) return;
            if (rules.max !== undefined && v > rules.max) return;
          }
          result[f] = v; conf[f] = 'medium';
        };
        set('price',      zprop.price || zprop.listingPrice);
        set('beds',       zprop.bedrooms ?? zprop.beds);
        set('baths',      zprop.bathrooms ?? zprop.baths);
        set('sqft',       zprop.livingArea ?? zprop.sqft);
        set('year',       zprop.yearBuilt);
        set('taxAnnual',  zprop.taxAnnualAmount);
        set('hoaMonthly', zprop.monthlyHoaFee ?? zprop.hoaFee);
        set('rent',       zprop.rentZestimate);
        const a = zprop.address;
        if (a?.city && (a.state || a.regionCode)) { result.city = `${a.city}, ${a.state||a.regionCode}`; conf.city = 'medium'; }
      }
    } catch (_) {}
  }
  // JSON key regex fallbacks — structured-ish, but single source
  const setIfMissing = (f, v, c = 'low') => { if (result[f] === null || result[f] === undefined) { result[f] = v; conf[f] = c; } };
  const ruleOk = (f, v) => {
    const rules = FIELD_RULES[f];
    if (!rules) return true;
    if (rules.min !== undefined && v < rules.min) return false;
    if (rules.max !== undefined && v > rules.max) return false;
    return true;
  };

  const pi = regexIntVal(html, /"price"\s*:\s*(\d+)/);              if (pi && ruleOk('price', pi))     setIfMissing('price',     pi,  'low');
  const be = regexFloatVal(html, /"bedrooms"\s*:\s*(\d+(?:\.\d+)?)/); if (be !== null && ruleOk('beds', be)) setIfMissing('beds',  be, 'low');
  const ba = regexFloatVal(html, /"bathrooms"\s*:\s*(\d+(?:\.\d+)?)/);if (ba !== null && ruleOk('baths',ba)) setIfMissing('baths', ba, 'low');
  const sq = regexIntVal(html, /"livingArea"\s*:\s*(\d+)/);           if (sq && ruleOk('sqft', sq))     setIfMissing('sqft',      sq,  'low');
  const yr = regexIntVal(html, /"yearBuilt"\s*:\s*(\d{4})/);          if (yr && ruleOk('year', yr))     setIfMissing('year',      yr,  'low');
  // tax/HOA from JSON keys is considered structured — acceptable
  const tx = regexIntVal(html, /"taxAnnualAmount"\s*:\s*([\d.]+)/);   if (tx && ruleOk('taxAnnual', tx))   setIfMissing('taxAnnual',  tx, 'medium');
  const ho = regexIntVal(html, /"monthlyHoaFee"\s*:\s*([\d.]+)/)
          || regexIntVal(html, /"hoaFee"\s*:\s*([\d.]+)/);            if (ho !== null && ruleOk('hoaMonthly', ho)) setIfMissing('hoaMonthly', ho, 'medium');
  if (!result.city) {
    const m = html.match(/"city"\s*:\s*"([^"]+)".*?"state"\s*:\s*"([A-Z]{2})"/);
    if (m) { result.city = `${m[1]}, ${m[2]}`; conf.city = 'low'; }
  }
}

// ── Redfin direct extractor ───────────────────────────────────────────────────
function extractRedfin(html, result, conf) {
  const setIfMissing = (f, v, c = 'low') => {
    if (result[f] !== null && result[f] !== undefined) return;
    if (v === null || v === undefined) return;
    const rules = FIELD_RULES[f];
    if (rules) {
      if (rules.min !== undefined && v < rules.min) return;
      if (rules.max !== undefined && v > rules.max) return;
    }
    result[f] = v; conf[f] = c;
  };
  const m = html.match(/(?:"listingPrice"|"price")\s*[":>]+\s*\$?([\d,]+)/);
  if (m) setIfMissing('price', parseInt(m[1].replace(/,/g, '')));
  const be = regexFloatVal(html, /(\d+)\s*Bed/i);                  if (be !== null) setIfMissing('beds',  be);
  const ba = regexFloatVal(html, /(\d+(?:\.\d+)?)\s*Bath/i);       if (ba !== null) setIfMissing('baths', ba);
  const sq = regexIntVal(html, /([\d,]+)\s*Sq[\.\s]?Ft/i);         if (sq)          setIfMissing('sqft',  sq);
  const yr = regexIntVal(html, /Year\s*Built\D*(\d{4})/i);         if (yr)          setIfMissing('year',  yr);
  if (!result.city) {
    const t = html.match(/<title>([^<]+)<\/title>/);
    if (t) { const c = t[1].match(/,\s*([A-Za-z\s]+),\s*([A-Z]{2})\s*\d/); if (c) { result.city = `${c[1].trim()}, ${c[2]}`; conf.city = 'low'; } }
  }
}

// ── Realtor direct extractor ──────────────────────────────────────────────────
function extractRealtor(html, result, conf) {
  const setIfMissing = (f, v, c = 'medium') => { if ((result[f] === null || result[f] === undefined) && v !== null && v !== undefined) { result[f] = v; conf[f] = c; } };
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try {
      const ld   = JSON.parse(m[1]);
      const item = Array.isArray(ld) ? ld[0] : ld;
      if (item?.offers?.price)       setIfMissing('price', parseInt(item.offers.price), 'medium');
      if (item?.floorSize?.value)    setIfMissing('sqft',  parseInt(item.floorSize.value), 'medium');
      if (item?.yearBuilt)           setIfMissing('year',  parseInt(item.yearBuilt), 'medium');
      if (item?.address?.addressLocality && item?.address?.addressRegion)
        setIfMissing('city', `${item.address.addressLocality}, ${item.address.addressRegion}`, 'medium');
    } catch (_) {}
  }
  const nd = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (nd) {
    try {
      const data = JSON.parse(nd[1]);
      const prop = deepFind(data?.props, obj => obj?.list_price && obj?.description);
      if (prop) {
        if (prop.list_price)          setIfMissing('price',      prop.list_price,         'medium');
        const desc = prop.description || {};
        if (desc.beds)                setIfMissing('beds',        desc.beds,               'medium');
        if (desc.baths)               setIfMissing('baths',       desc.baths,              'medium');
        if (desc.sqft)                setIfMissing('sqft',        desc.sqft,               'medium');
        if (desc.year_built)          setIfMissing('year',        desc.year_built,         'medium');
        if (prop.hoa?.fee !== undefined) setIfMissing('hoaMonthly', prop.hoa.fee,          'medium');
        if (!result.city) {
          const loc = prop.location?.address;
          if (loc?.city && loc?.state_code) setIfMissing('city', `${loc.city}, ${loc.state_code}`, 'medium');
        }
        // Tax from Realtor NEXT_DATA
        const taxV = prop.tax_history?.[0]?.tax || prop.taxAnnual;
        if (taxV) setIfMissing('taxAnnual', parseInt(taxV), 'medium');
      }
    } catch (_) {}
  }
}

// ── Universal HTML fallback (city only) ───────────────────────────────────────
function extractUniversal(html, result, conf, url) {
  if (!result.city) {
    const og = html.match(/og:title.*?content="([^"]+)"/i) || html.match(/<title>([^<]+)<\/title>/);
    if (og) { const c = og[1].match(/([A-Za-z\s]{3,}),\s*([A-Z]{2})/); if (c) { result.city = `${c[1].trim()}, ${c[2]}`; conf.city = 'low'; } }
  }
  if (!result.city) {
    const addr = extractAddressFromUrl(url);
    if (addr) { result.city = `${addr.city}, ${addr.state}`; conf.city = 'high'; }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function hasAnyTaggedValue(r) {
  return CORE_FIELDS.some(f => r[f] !== null && r[f] !== undefined);
}

// Return raw number or null (for use in direct extractors, not tagged)
function regexIntVal(html, pattern) {
  const m = html.match(pattern);
  return m ? parseInt(String(m[1]).replace(/,/g,'')) : null;
}
function regexFloatVal(html, pattern) {
  const m = html.match(pattern);
  return m ? parseFloat(m[1]) : null;
}
function regexPriceVal(html, pattern) {
  const m = html.match(pattern);
  if (!m) return null;
  const v = parseInt(String(m[1]).replace(/,/g,''));
  return (v > 10000 && v < 50000000) ? v : null;
}

function deepFind(obj, predicate, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 10) return null;
  if (predicate(obj)) return obj;
  for (const v of Object.values(obj)) {
    const r = deepFind(v, predicate, depth + 1);
    if (r) return r;
  }
  return null;
}

export const config = { maxDuration: 20 };
