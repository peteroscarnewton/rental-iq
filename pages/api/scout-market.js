/**
 * /api/scout-market
 * ─────────────────────────────────────────────────────────────────────────────
 * Phase 4C: AI-powered market intelligence grounded in live data.
 *
 * The original Scout page (pages/scout.js) sends users to Zillow/Redfin with
 * filters. This endpoint enhances it by providing AI-generated market insights
 * that are grounded in THIS WEEK'S actual data from our live data sources,
 * not Gemini's training knowledge.
 *
 * What gets injected into the AI prompt before generating recommendations:
 *   - Redfin market temperature + days on market + sale-to-list (from our cache)
 *   - FHFA / Case-Shiller 5yr appreciation CAGR (from our cache)
 *   - Metro unemployment rate + trend (from our cache)
 *   - Current 30yr mortgage rate (from our live feed)
 *   - Landlord-friendliness score for the target state
 *
 * POST { city, state, beds, budget, goal }
 * → { marketContext, insights, verdict, dataSources, freshness }
 *
 * Rate-limited: same as other AI endpoints. Requires a token.
 */

import { rateLimitWithAuth }       from '../../lib/rateLimit.js';
import { getMarketData, cityAppreciation, rate30yr,
         getCaseShillerData, getRedfinData }  from '../../lib/marketData.js';
import { getCaseShillerKey }       from '../../lib/caseShillerFetcher.js';
import { getSupabaseAdmin }        from '../../lib/supabase.js';
import { getServerSession }        from 'next-auth/next';
import { authOptions }             from './auth/[...nextauth].js';
import { getLandlordLaws, formatLandlordLawPrompt } from '../../lib/landlordLaws.js';

export const config = { api: { bodyParser: true }, maxDuration: 30 };

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Fetch employment data from cache for a given city */
async function getEmploymentForCity(db, city) {
  if (!city || !db) return null;
  const cityKey = city.split(',')[0].trim().toLowerCase();
  try {
    const { data, error } = await db
      .from('market_data_cache')
      .select('value, valid_until')
      .eq('key', `employment:${cityKey}`)
      .single();
    if (error || !data) return null;
    if (new Date(data.valid_until) < new Date()) return null;
    return data.value;
  } catch {
    return null;
  }
}

/** Fetch Redfin market data for a city — tries to find any cached ZIP for that city */
async function getRedfinForCity(db, city) {
  if (!city || !db) return null;
  const cityName = city.split(',')[0].trim().toLowerCase();

  // We don't store Redfin by city, only by ZIP — this looks up the city's
  // most recently cached ZIP to get a market pulse proxy.
  // This is approximate but far better than no data.
  try {
    const { data: rows } = await db
      .from('market_data_cache')
      .select('key, value, fetched_at')
      .like('key', 'redfin:%')
      .order('fetched_at', { ascending: false })
      .limit(100);

    // Find a ZIP that has city metadata matching our target
    // Redfin data includes city field from the original fetch
    for (const row of (rows || [])) {
      const val = row.value;
      if (val?.city && val.city.toLowerCase().includes(cityName.split(' ')[0])) {
        return val;
      }
    }
    return null;
  } catch {
    return null;
  }
}

/** Build a structured market context object for prompt injection */
async function buildMarketContext(city, state, db, md) {
  const cityFull = state ? `${city}, ${state}` : city;
  const csMetroKey = getCaseShillerKey(cityFull);

  // Fetch all data sources in parallel — none are blocking
  const [empData, csData, redfinData] = await Promise.allSettled([
    getEmploymentForCity(db, cityFull),
    csMetroKey ? getCaseShillerData(db, csMetroKey) : Promise.resolve(null),
    getRedfinForCity(db, cityFull),
  ]);

  const employment = empData.status === 'fulfilled'  ? empData.value  : null;
  const caseShiller = csData.status === 'fulfilled'  ? csData.value   : null;
  const redfin = redfinData.status === 'fulfilled'   ? redfinData.value : null;

  const appreciationRate = cityAppreciation(md, cityFull);
  const mortgageRate     = rate30yr(md);

  // Landlord law data for the state
  const stateCode = state?.toUpperCase() || cityFull.match(/,\s*([A-Z]{2})$/i)?.[1]?.toUpperCase();
  const landlordLaw = stateCode ? getLandlordLaws(stateCode) : null;

  return {
    city: cityFull,
    stateCode,
    mortgageRate,
    mortgageAsOf: md.mortgageRates?.asOf,
    appreciationRate5yr: appreciationRate,
    appreciationSource: md.source,

    // Redfin market pulse
    marketTemp:   redfin?.marketTemp || null,
    daysOnMarket: redfin?.dom || null,
    saleToList:   redfin?.saleToList || null,
    inventory:    redfin?.inventory || null,
    redfinAsOf:   redfin?.asOf || null,

    // Case-Shiller price trend
    priceYoY:     caseShiller?.yoyPct || null,
    priceCagr3yr: caseShiller?.cagr3yr || null,
    priceCagr5yr: caseShiller?.cagr5yr || null,
    priceTrend:   caseShiller?.trend || null,
    csAsOf:       caseShiller?.asOf || null,

    // Employment
    unemploymentRate:   employment?.rate || null,
    unemploymentNational: employment?.nationalRate || null,
    unemploymentTrend:  employment?.trend || null,
    employmentAsOf:     employment?.asOf || null,

    // Landlord climate
    landlordScore:    landlordLaw?.score || null,
    justCause:        landlordLaw?.justCauseRequired || false,
    rentControl:      landlordLaw?.rentControlState || landlordLaw?.rentControlLocalOk || false,
    rentControlPreempted: landlordLaw?.rentControlPreempted || false,
    landlordNotes:    landlordLaw?.notes || null,

    // What data sources we actually have (so AI knows what's live vs inferred)
    dataCoverage: {
      hasLiveMarketPulse: !!redfin,
      hasLivePriceHistory: !!caseShiller,
      hasLiveEmployment: !!employment,
      hasMortgageRate: true, // always have this
      hasLandlordLaw: !!landlordLaw,
    },
  };
}

/** Build the market-data-grounded prompt section */
function buildMarketContextPrompt(ctx) {
  const lines = [];

  lines.push(`TARGET MARKET: ${ctx.city}`);
  lines.push(`CURRENT MORTGAGE RATE: ${ctx.mortgageRate}% (30yr fixed${ctx.mortgageAsOf ? `, as of ${ctx.mortgageAsOf}` : ''}) — USE THIS EXACT RATE for any financing math`);
  lines.push('');

  // Appreciation
  lines.push(`PRICE APPRECIATION (live FHFA/Zillow data, ${ctx.appreciationSource}):`);
  lines.push(`  5yr CAGR: ${ctx.appreciationRate5yr}%/yr`);
  if (ctx.priceCagr3yr !== null) lines.push(`  Case-Shiller 3yr CAGR: ${ctx.priceCagr3yr}% (as of ${ctx.csAsOf || 'recent'})`);
  if (ctx.priceYoY     !== null) lines.push(`  Case-Shiller YoY: ${ctx.priceYoY}% (trend: ${ctx.priceTrend})`);
  lines.push('');

  // Market pulse
  if (ctx.dataCoverage.hasLiveMarketPulse) {
    lines.push(`LIVE MARKET CONDITIONS (Redfin, as of ${ctx.redfinAsOf || 'this week'}):`);
    lines.push(`  Market temperature: ${ctx.marketTemp?.toUpperCase()}`);
    lines.push(`  Median days on market: ${ctx.daysOnMarket} days`);
    lines.push(`  Sale-to-list ratio: ${ctx.saleToList !== null ? (ctx.saleToList * 100).toFixed(1) + '%' : 'N/A'} ${ctx.saleToList >= 1.0 ? '(sellers market)' : '(buyers market)'}`);
    if (ctx.inventory !== null) lines.push(`  Active inventory: ${ctx.inventory.toLocaleString()} listings`);
  } else {
    lines.push(`MARKET CONDITIONS: No live Redfin data cached for ${ctx.city} — use your training knowledge with caveat`);
  }
  lines.push('');

  // Employment
  if (ctx.dataCoverage.hasLiveEmployment) {
    lines.push(`METRO EMPLOYMENT (BLS LAUS via FRED, as of ${ctx.employmentAsOf || 'recent'}):`);
    lines.push(`  Unemployment rate: ${ctx.unemploymentRate}% (national: ${ctx.unemploymentNational}%)`);
    lines.push(`  Year-over-year trend: ${ctx.unemploymentTrend} (${ctx.unemploymentTrend === 'improving' ? 'falling unemployment = positive demand signal' : ctx.unemploymentTrend === 'worsening' ? 'rising unemployment = demand risk' : 'stable labor market'})`);
  } else {
    lines.push(`EMPLOYMENT: No live BLS data cached for ${ctx.city} — infer from your training knowledge`);
  }
  lines.push('');

  // Landlord climate
  if (ctx.dataCoverage.hasLandlordLaw) {
    lines.push(`LANDLORD CLIMATE (${ctx.stateCode}, score ${ctx.landlordScore}/100):`);
    lines.push(`  Just-cause eviction required: ${ctx.justCause ? 'YES — increases eviction risk/cost' : 'NO — landlord-friendly'}`);
    lines.push(`  Rent control: ${ctx.rentControlPreempted ? 'PREEMPTED — cities cannot enact it (very landlord-friendly)' : ctx.rentControl ? 'YES — exists at state or local level' : 'NO statewide control (check local ordinances)'}`);
    if (ctx.landlordNotes) lines.push(`  Notes: ${ctx.landlordNotes}`);
  }

  return lines.join('\n');
}

// ─── Main handler ──────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  if (!rateLimitWithAuth(req, false, { anonMax: 5, authedMax: 20, windowMs: 60_000 })) {
    return res.status(429).json({ error: 'Too many requests.' });
  }

  const { city, state, beds, budget, goal, targetYield } = req.body || {};
  if (!city) return res.status(400).json({ error: 'city is required' });

  const session = await getServerSession(req, res, authOptions);
  const db = getSupabaseAdmin();

  // Token check — Scout market insights cost 1 token
  if (session?.user?.id) {
    const { data: user } = await db
      .from('users')
      .select('tokens')
      .eq('id', session.user.id)
      .single();

    if (!user || user.tokens < 1) {
      return res.status(402).json({ error: 'Insufficient tokens. This feature requires 1 token.' });
    }
  }

  try {
    // 1. Load market data + build live context
    const md         = await getMarketData();
    const marketCtx  = await buildMarketContext(city, state, db, md);
    const ctxPrompt  = buildMarketContextPrompt(marketCtx);

    // 2. Build the full prompt
    const goalLabels = {
      cashflow:     'maximize monthly cash flow and passive income',
      appreciation: 'maximize long-term wealth via equity growth',
      balanced:     'balance cash flow and appreciation',
      tax:          'maximize tax advantages (depreciation, 1031 exchange)',
    };
    const goalLabel = goalLabels[goal] || goalLabels.balanced;

    const bedsLabel = beds ? `${beds}-bedroom` : '';
    const budgetLabel = budget ? `budget under $${parseInt(budget).toLocaleString()}` : '';
    const targetLabel = targetYield ? `, targeting ${targetYield}% CoC return` : '';
    const filtersLabel = [bedsLabel, budgetLabel].filter(Boolean).join(', ');

    const prompt = `You are a real estate investment analyst. A user wants to invest in ${city}${state ? ', ' + state : ''}.
    
INVESTOR PROFILE:
- Goal: ${goalLabel}
- Filters: ${filtersLabel || 'open to any property type/size'}${targetLabel}

=== LIVE MARKET DATA (use this — do NOT substitute your training knowledge for these numbers) ===
${ctxPrompt}
=== END LIVE DATA ===

Based ONLY on the live data above combined with your broader market knowledge, provide:

1. MARKET VERDICT (2-3 sentences): Is ${city} a good market RIGHT NOW for this investor's goal? Reference the specific live data points — don't give generic analysis.

2. KEY SIGNALS (3 bullet points): The 3 most important data points from the live data that determine the investment thesis. Be specific (e.g. "DOM is ${marketCtx.daysOnMarket} days — ${marketCtx.daysOnMarket > 30 ? 'slower market gives negotiating leverage' : 'fast market means less room to negotiate'}").

3. RISKS (2 bullet points): The 2 biggest risks for THIS SPECIFIC MARKET right now based on the live data. Reference actual numbers.

4. STRATEGY (1-2 sentences): Given the current market conditions, what's the optimal investment strategy and property type for this investor?

5. DATA FRESHNESS NOTE: List which data points are live (cite their as-of dates) vs. estimated.

Format as JSON:
{
  "verdict": "...",
  "signals": ["...", "...", "..."],
  "risks": ["...", "..."],
  "strategy": "...",
  "dataNote": "..."
}`;

    // 3. Call Gemini
    const geminiKey = process.env.GEMINI_API_KEY;
    if (!geminiKey) {
      return res.status(503).json({ error: 'AI service not configured.' });
    }

    const aiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-001:generateContent?key=${geminiKey}`,
      {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: {
            temperature:     0.3, // lower = more factual, less creative
            maxOutputTokens: 800,
            responseMimeType: 'application/json',
          },
        }),
        signal: AbortSignal.timeout(25000),
      }
    );

    if (!aiRes.ok) {
      const err = await aiRes.text().catch(() => '');
      console.error('[scout-market] Gemini error:', err);
      return res.status(502).json({ error: 'AI service error. Please try again.' });
    }

    const aiJson = await aiRes.json();
    const rawText = aiJson?.candidates?.[0]?.content?.parts?.[0]?.text || '';

    let parsed;
    try {
      parsed = JSON.parse(rawText.replace(/```json|```/g, '').trim());
    } catch {
      // Gemini didn't return clean JSON — extract what we can
      parsed = {
        verdict:  rawText.substring(0, 300),
        signals:  [],
        risks:    [],
        strategy: '',
        dataNote: 'AI response parsing error',
      };
    }

    // 4. Deduct token if authenticated
    if (session?.user?.id) {
      // Use decrement RPC if available, otherwise manual fallback
      await db.rpc('decrement_tokens', { user_id: session.user.id, amount: 1 }).catch(async () => {
        const { data: u } = await db.from('users').select('tokens').eq('id', session.user.id).single();
        if (u) await db.from('users').update({ tokens: Math.max(0, u.tokens - 1) }).eq('id', session.user.id);
      });
    }

    // 5. Return enriched response
    return res.status(200).json({
      city:          marketCtx.city,
      verdict:       parsed.verdict || '',
      signals:       Array.isArray(parsed.signals) ? parsed.signals : [],
      risks:         Array.isArray(parsed.risks)   ? parsed.risks   : [],
      strategy:      parsed.strategy || '',
      dataNote:      parsed.dataNote || '',

      // Raw market context for UI display
      marketContext: {
        mortgageRate:        marketCtx.mortgageRate,
        appreciationRate5yr: marketCtx.appreciationRate5yr,
        marketTemp:          marketCtx.marketTemp,
        daysOnMarket:        marketCtx.daysOnMarket,
        saleToList:          marketCtx.saleToList,
        unemploymentRate:    marketCtx.unemploymentRate,
        unemploymentTrend:   marketCtx.unemploymentTrend,
        landlordScore:       marketCtx.landlordScore,
        priceYoY:            marketCtx.priceYoY,
        priceTrend:          marketCtx.priceTrend,
        redfinAsOf:          marketCtx.redfinAsOf,
        employmentAsOf:      marketCtx.employmentAsOf,
        csAsOf:              marketCtx.csAsOf,
      },
      dataCoverage: marketCtx.dataCoverage,
    });

  } catch (err) {
    console.error('[scout-market] handler error:', err);
    return res.status(500).json({ error: 'Internal error. Please try again.' });
  }
}
