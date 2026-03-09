// lib/aiListingFetcher.js  —  v36
import { callGemini } from './geminiClient.js';
//
// Uses Gemini 2.5 Flash + Google Search grounding to extract complete property
// data from any listing URL. Replaces the og:meta Layer 2 in fetch-listing.js
// as the primary data source, falling back to og:meta for resilience.
//
// HOW IT WORKS:
// ─────────────
// Gemini's Google Search grounding tool lets the model search Google as part
// of the API call — same way a human would look up "123 Main St Zillow taxes
// year built HOA". No raw HTTP requests to Zillow, no IP blocking, no bot
// detection. Google's crawler already has all this data indexed.
//
// COST (Gemini 2.5 Flash, grounding enabled):
// ────────────────────────────────────────────
// Gemini 2.5 Flash with grounding: ~$0.0035 per request (input + output tokens)
// Google Search grounding: free up to 1,500 grounded queries/day via free tier,
// then $35/1,000 queries on paid tier.
// With Supabase 7-day cache: popular listings served from cache at $0.
// Effective cost at scale with 60% cache hit rate: ~$0.0014/request served.
//
// Free tier covers 1,500 unique URL lookups/day before any search cost kicks in.
// That's substantial traffic before you pay a cent for grounding.

// Model selection handled by geminiClient.js

const SYSTEM_PROMPT = `You are a real estate data extraction assistant. Your only job is to find property listing data and return it as clean JSON.

RULES:
- Always use Google Search to find the listing and verify data
- Return ONLY a raw JSON object — no markdown, no backticks, no explanation
- Use null for any field you cannot find with confidence
- Never fabricate or estimate values — only return data you actually found
- For taxAnnual: return annual property tax in dollars (not monthly, not a rate)
- For hoaMonthly: return monthly HOA fee in dollars (0 if no HOA, null if unknown)
- For year: return the original year built (not renovation year)
- For city: return "City, ST" format (e.g. "Austin, TX")
- For propertyType: classify as one of exactly: "sfr" (single-family), "sfr_adu" (SFR with ADU/guest house/in-law suite), "duplex" (2-unit), "triplex" (3-unit), "fourplex" (4-unit), "condo" (condo/townhouse with HOA), "mfr" (5+ units). Use listing title, description, unit count, and property type labels to classify. Default "sfr" only if clearly single-family with no ADU.
- For listingDescription: return the full listing agent description text verbatim. This is critical — look for the "About this home", "Description", or "Remarks" section. Include renovation details, finishes, condition, unit details for multi-family, and any special features. Max 1500 characters.
- For unitRents: if this is a multi-unit property (duplex/triplex/fourplex/sfr_adu), return an array of per-unit monthly rents in dollars if found (e.g. [1200, 950] for a duplex). Return null if not found or single-family.`;

function buildPrompt(url, address) {
  // Build an address string from the parsed URL slug when available.
  // Searching Google for "1209 Dobie Dr Austin TX 78753 zillow" hits Google's
  // index of Zillow — which is crawled every few minutes — rather than Zillow's
  // server directly. This works even for listings that went live minutes ago.
  const addrStr = address
    ? `${address.street}, ${address.city}, ${address.state}${address.zipcode ? ' ' + address.zipcode : ''}`
    : null;

  let siteHint = '';
  if (url.includes('zillow.com'))      siteHint = 'Zillow';
  else if (url.includes('redfin.com')) siteHint = 'Redfin';
  else if (url.includes('realtor.com'))siteHint = 'Realtor.com';
  const siteName = siteHint || 'the listing site';

  // Lead with address search — this is the key insight for new listings.
  // Google indexes Zillow/Redfin pages within minutes; searching by address
  // finds the listing even if the URL itself isn't indexed yet.
  const searchInstruction = addrStr
    ? `Search Google for this property using TWO searches:
1. "${addrStr} ${siteHint || 'for sale'}" — this finds the listing page directly
2. "${addrStr} property tax assessed value HOA" — this finds tax/HOA records
Also check the listing URL for any additional details: ${url}`
    : `Search Google for this listing: "${url}"
Also search the property address directly for tax and HOA records.`;

  return `${searchInstruction}

Extract ALL of the following fields. Return ONLY this JSON object, no other text:
{
  "price": <integer: list price in dollars — the asking/purchase price, NOT rent>,
  "rent": <integer: monthly rent if this is a rental listing, null if for-sale>,
  "beds": <integer: number of bedrooms>,
  "baths": <number: total bathrooms, count half-baths as 0.5>,
  "sqft": <integer: interior living area in square feet>,
  "year": <integer: year the home was originally built>,
  "city": <string: "City, ST" format e.g. "Memphis, TN">,
  "taxAnnual": <integer: annual property tax in dollars — look in "property taxes", "tax history", or county assessor records>,
  "hoaMonthly": <integer: monthly HOA fee in dollars, 0 if explicitly no HOA, null if unknown>,
  "propertyType": <string: one of "sfr"|"sfr_adu"|"duplex"|"triplex"|"fourplex"|"condo"|"mfr" — classify from listing title, description, and unit count. "sfr_adu" means SFR with ADU/guest house/in-law suite. "condo" for condos and townhouses with HOA. "mfr" for 5+ unit properties. Default "sfr" only if clearly single-family>,
  "listingDescription": <string: full listing agent description — look for "About this home", "Description", "Public remarks". Include renovation details, unit details for multi-family, condition notes. Max 1500 chars. null if not found>,
  "unitRents": <array of integers or null: monthly rent per unit for multi-unit properties e.g. [1200, 950] for duplex. Include ADU rent for sfr_adu. null if single-family or rents not found>
}

URL: ${url}`;
}


// Second-pass targeted gap-fill — covers taxAnnual, hoaMonthly, year, sqft.
// County assessor records (always publicly indexed) have year built + sqft + tax.
// HOA disclosures appear on listing pages indexed within minutes of going live.
// This fires only when those fields are still null after the first AI + og:meta passes.
function buildGapFillPrompt(address, missingFields) {
  const addrStr  = `${address.street}, ${address.city}, ${address.state}${address.zipcode ? ' ' + address.zipcode : ''}`;
  const needsTax  = missingFields.includes('taxAnnual');
  const needsHoa  = missingFields.includes('hoaMonthly');
  const needsYear = missingFields.includes('year');
  const needsSqft = missingFields.includes('sqft');

  // County assessor search covers year, sqft, and tax in one query.
  const searches = [];
  if (needsTax || needsYear || needsSqft) {
    searches.push(`"${addrStr}" site:assessor OR county records OR property tax — find year built, square footage, annual tax`);
    searches.push(`"${addrStr}" zillow OR redfin OR realtor.com — year built square feet`);
  }
  if (needsHoa) {
    searches.push(`"${addrStr}" HOA monthly fee homeowners association`);
  }

  const fields = [];
  if (needsTax)  fields.push(`  "taxAnnual": <integer: annual property tax in dollars from assessor/tax records. null if not found>`);
  if (needsYear) fields.push(`  "year": <integer: year originally built from assessor records. null if not found>`);
  if (needsSqft) fields.push(`  "sqft": <integer: interior living area sq ft from assessor/MLS. null if not found>`);
  if (needsHoa)  fields.push(`  "hoaMonthly": <integer: monthly HOA fee. Use 0 if records confirm NO HOA exists. null only if completely unknown>`);
  fields.push(`  "confidence": <string: "high" if from official records, "medium" if from listing, "low" if inferred>`);

  return `You are researching public property records for: ${addrStr}

Search Google using these queries:
${searches.map((s, i) => `${i + 1}. ${s}`).join('\n')}

Return ONLY this JSON object. Use null only if genuinely not findable after searching:
{
${fields.join(',\n')}
}`;
}

export async function fetchListingViaAI(url, address) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not set');

  const payload = {
    system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{ role: 'user', parts: [{ text: buildPrompt(url, address) }] }],
    tools: [{ google_search: {} }],
    generationConfig: {
      temperature: 0,
      maxOutputTokens: 2048,
      thinkingConfig: { thinkingBudget: 0 },
    },
  };

  let res;
  try {
    ({ res } = await callGemini(apiKey, payload, { timeoutMs: 15_000, retries: 1 }));
  } catch (e) {
    throw new Error(`Gemini unavailable: ${e.message}`);
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Gemini ${res.status}: ${err?.error?.message || 'unknown error'}`);
  }

  const body  = await res.json();
  const parts = body?.candidates?.[0]?.content?.parts ?? [];
  const text  = [...parts].reverse().find(p => p.text)?.text ?? '';

  return sanitize(parseJSON(text));
}

// Gap-fill: second focused Gemini call for missing public-record fields.
// Covers taxAnnual, hoaMonthly, year built, sqft — all in county assessor records.
// Only fires for listings where first pass left these null. Small fraction of total
// calls, well within the 1,500 free grounded queries/day.
export async function gapFillViaAI(address, missingFields) {
  if (!address?.street || !missingFields?.length) return null;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  const GAP_FIELDS = ['taxAnnual', 'hoaMonthly', 'year', 'sqft'];
  const relevantMissing = missingFields.filter(f => GAP_FIELDS.includes(f));
  if (!relevantMissing.length) return null;

  const payload = {
    system_instruction: { parts: [{ text: 'You are a property records research assistant. Search county assessor and public records. Return only confirmed data as JSON. Never fabricate or estimate — use null if not found.' }] },
    contents: [{ role: 'user', parts: [{ text: buildGapFillPrompt(address, relevantMissing) }] }],
    tools: [{ google_search: {} }],
    generationConfig: { temperature: 0, maxOutputTokens: 512 },
  };

  try {
    const { res } = await callGemini(apiKey, payload, { timeoutMs: 12_000, retries: 1 });
    if (!res.ok) return null;
    const body  = await res.json();
    const parts = body?.candidates?.[0]?.content?.parts ?? [];
    const text  = [...parts].reverse().find(p => p.text)?.text ?? '';
    const raw   = parseJSON(text);
    if (!raw) return null;

    const result = {};
    const BOUNDS = { taxAnnual:[0,500_000], hoaMonthly:[0,10_000], year:[1800,2026], sqft:[100,30_000] };
    for (const f of relevantMissing) {
      if (raw[f] == null) continue;
      const n = parseFloat(String(raw[f]).replace(/[$,]/g, ''));
      const [lo, hi] = BOUNDS[f];
      if (isFinite(n) && n >= lo && n <= hi) {
        result[f] = (f === 'year' || f === 'sqft') ? Math.round(n) : n;
      }
    }
    result._gapFillConfidence = raw.confidence || 'medium';
    // Return only if we found at least one real field (not just confidence)
    return Object.keys(result).filter(k => k !== '_gapFillConfidence').length > 0 ? result : null;
  } catch (_) { return null; }
}
const FIELD_BOUNDS = {
  price:      { min: 10_000,    max: 50_000_000 },
  rent:       { min: 100,       max: 50_000     },
  beds:       { min: 0,         max: 20         },
  baths:      { min: 0,         max: 20         },
  sqft:       { min: 100,       max: 30_000     },
  year:       { min: 1800,      max: new Date().getFullYear() + 1 },
  taxAnnual:  { min: 0,         max: 500_000    },
  hoaMonthly: { min: 0,         max: 10_000     },
};

// Unit rent bounds for multi-unit properties
const UNIT_RENT_BOUNDS = { min: 100, max: 30_000 };

function sanitize(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const result = {};

  for (const [field, bounds] of Object.entries(FIELD_BOUNDS)) {
    const val = raw[field];
    if (val == null) { result[field] = null; continue; }
    const n = parseFloat(String(val).replace(/[$,]/g, ''));
    if (!isFinite(n))           { result[field] = null; continue; }
    if (n < bounds.min || n > bounds.max) { result[field] = null; continue; }
    // Round beds/year to integer
    result[field] = (field === 'beds' || field === 'year') ? Math.round(n) : n;
  }

  // propertyType: validate against known enum values
  const VALID_PROPERTY_TYPES = new Set(['sfr','sfr_adu','duplex','triplex','fourplex','condo','mfr']);
  if (typeof raw.propertyType === 'string' && VALID_PROPERTY_TYPES.has(raw.propertyType.trim().toLowerCase())) {
    result.propertyType = raw.propertyType.trim().toLowerCase();
  } else {
    result.propertyType = null; // null = AI couldn't classify; frontend falls back to user selection
  }

  // City: must be "Word(s), XX" format
  if (typeof raw.city === 'string') {
    const m = raw.city.match(/^([A-Za-z\s\-\.]+),\s*([A-Z]{2})$/);
    result.city = m ? `${m[1].trim()}, ${m[2]}` : null;
  } else {
    result.city = null;
  }

  // listingDescription: pass through as-is, trim to 1500 chars
  if (typeof raw.listingDescription === 'string' && raw.listingDescription.trim().length > 20) {
    result.listingDescription = raw.listingDescription.trim().slice(0, 1500);
  } else {
    result.listingDescription = null;
  }

  // unitRents: validate each element is a reasonable rent figure
  if (Array.isArray(raw.unitRents) && raw.unitRents.length >= 2 && raw.unitRents.length <= 4) {
    const validated = raw.unitRents.map(v => {
      const n = parseFloat(String(v).replace(/[$,]/g, ''));
      return (isFinite(n) && n >= UNIT_RENT_BOUNDS.min && n <= UNIT_RENT_BOUNDS.max) ? Math.round(n) : null;
    });
    result.unitRents = validated.some(v => v !== null) ? validated : null;
  } else {
    result.unitRents = null;
  }

  // Return partial data even without price/rent — og:meta fallback will fill price.
  // Discarding beds/baths/year/sqft/taxAnnual just because price is null throws
  // away the fields AI is best at finding (taxes, HOA, year built).
  const hasAnyData = Object.values(result).some(v => v != null) || result.city != null;
  if (!hasAnyData) return null;

  return result;
}

function parseJSON(text) {
  if (!text) return null;
  // Strip markdown fences if present
  const clean = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
  try {
    return JSON.parse(clean);
  } catch (_) {
    // Try extracting the first {...} block
    const m = clean.match(/\{[\s\S]*\}/);
    if (m) {
      try { return JSON.parse(m[0]); } catch (_) {}
    }
    return null;
  }
}


