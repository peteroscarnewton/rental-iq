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
- For listingDescription: return the full listing agent description text verbatim. This is critical — look for the "About this home", "Description", or "Remarks" section. Include renovation details, finishes, condition, and any special features. Max 1500 characters.
- For unitRents: if this is a multi-unit property (duplex/triplex/fourplex), return an array of per-unit monthly rents in dollars if found. Return null if not found or single-family.`;

function buildPrompt(url) {
  // Detect the source site for targeted search instruction
  let siteHint = '';
  if (url.includes('zillow.com'))   siteHint = 'Zillow';
  else if (url.includes('redfin.com')) siteHint = 'Redfin';
  else if (url.includes('realtor.com')) siteHint = 'Realtor.com';

  const searchInstruction = siteHint
    ? `Search Google for this ${siteHint} listing. Try searching: "${url}" and also the street address + "${siteHint}" to find all available property data including taxes and HOA.`
    : `Search Google for this listing: "${url}". Also search the property address directly to find all available data.`;

  return `${searchInstruction}

Extract ALL of the following fields from the listing. Return ONLY this JSON object, no other text:
{
  "price": <integer: list price in dollars — the asking/purchase price, NOT rent>,
  "rent": <integer: monthly rent if this is a rental listing, null if for-sale>,
  "beds": <integer: number of bedrooms>,
  "baths": <number: total bathrooms, count half-baths as 0.5>,
  "sqft": <integer: interior living area in square feet>,
  "year": <integer: year the home was originally built>,
  "city": <string: "City, ST" format e.g. "Memphis, TN">,
  "taxAnnual": <integer: annual property tax in dollars — look for "property taxes" or "tax history">,
  "hoaMonthly": <integer: monthly HOA fee in dollars, 0 if explicitly no HOA, null if unknown>,
  "listingDescription": <string: full listing agent description text — look for "About this home", "Description", "Public remarks". Include renovation details and condition notes. Max 1500 chars. null if not found>,
  "unitRents": <array of integers or null: monthly rent per unit for multi-unit properties e.g. [1200, 950, 1100]. null if single-family or not found>
}

URL: ${url}`;
}

// Numeric fields with sanity bounds — rejects hallucinated values
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

export async function fetchListingViaAI(url) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not set');

  // NOTE: responseMimeType:'application/json' is INCOMPATIBLE with tool use.
  // When tools: [{ google_search }] is present, Gemini does a multi-turn
  // search→answer cycle internally and returns free-form text. Forcing JSON
  // mode here causes a 400 "tool use and json mode are mutually exclusive" error.
  // We parse the JSON out of the text response manually in parseJSON() instead.
  const payload = {
    system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{ role: 'user', parts: [{ text: buildPrompt(url) }] }],
    tools: [{ google_search: {} }],  // Google Search grounding — requires free-form response
    generationConfig: {
      temperature: 0,        // deterministic — facts only
      maxOutputTokens: 1024, // bumped from 512: search grounding adds overhead tokens
    },
  };

  // Single attempt with a hard 15s timeout. No retries — the caller (withTimeout
  // in fetch-listing.js) enforces an outer 16s deadline. Retrying inside that
  // window would mean the outer deadline fires mid-retry anyway, leaving orphaned
  // fetches. Better to fail fast and let og:meta fallback handle it.
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

  const body = await res.json();

  // Gemini with tools returns multiple parts: tool_use parts + a final text part.
  // We want the last text part which contains the model's answer after searching.
  const parts = body?.candidates?.[0]?.content?.parts ?? [];
  const text  = [...parts].reverse().find(p => p.text)?.text ?? '';

  const parsed    = parseJSON(text);
  const sanitized = sanitize(parsed);

  return sanitized; // null if extraction failed or values out of bounds
}
