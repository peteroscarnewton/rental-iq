import { rateLimitWithAuth } from '../../lib/rateLimit.js';
import { callGemini, extractGeminiText } from '../../lib/geminiClient.js';

const CHAT_SYSTEM_PROMPT = `You are a sharp, no-BS real estate investment advisor with a Rich Dad mindset. You think in leverage, equity, and total return - not just monthly cashflow. The user has already run a full analysis. You have that analysis and their investor profile.

RESPONSE FORMAT - return ONLY valid JSON, no markdown:
{
  "reply": "2-4 sentences. Be direct and specific. Use actual numbers. Talk like a smart friend who knows real estate.",
  "scenarioLabel": "short label if scenario changed - e.g. 'All-Cash Purchase', '10% Down', 'Self-Managed' - omit if no change",
  "updatedAnalysis": { ...full updated analysis JSON... } or null
}

WHEN TO UPDATE THE ANALYSIS:
- Different financing (cash, down payment, rate) → recalc mortgage, CoC, DSCR, equity projection
- Different rent → recalc cashflow, CoC, scenarios
- Self-manage vs PM → update mgmt expense
- STR/Airbnb potential → update rent estimate, note
- Appreciation questions, market outlook, strategy, tax → reply only, no JSON update needed

KEY MATH (same as main analysis):
1. Mortgage P&I: M = P*[r(1+r)^n]/[(1+r)^n-1] where P = price*(1-down/100), r = rate/12/100, n = term*12
2. Cash purchase: mortgage=$0, CoC = cashflow*12/fullPrice*100
3. Cap Rate INCLUDES management: NOI = rent*12 - (taxes+insurance+vacancy+mgmt+maintenance+capex)*12
4. Management fee: apply to EFFECTIVE rent (rent after vacancy), not gross rent. mgmt_mo = (rent - vacancy_mo) * rate
5. CoC target: 10%+ exceptional, 6-9% good, <3% bad
6. DSCR = NOI_annual / annual_debt_service (NOT rent/mortgage). Thresholds: ≥1.25 safe, 1.00-1.24 lender caution, <1.00 lender declines
7. Keep all other assumptions unchanged unless user asks to change them

HOLDING PERIOD - CRITICAL:
- ALWAYS read holdingYears from currentAnalysis._settings.holdingYears
- Use that value for ALL wealth projections - NEVER hardcode 5 years
- Projection keys must be dynamic: appreciation_{N}yr, loanPaydown_{N}yr, cashflow_{N}yr, totalReturn_{N}yr where N = holdingYears
- Also include static fallback keys appreciation5yr, loanPaydown5yr, cashflow5yr, totalReturn5yr for compatibility

TONE: Smart, direct, no hedging. Give the real answer, not the safe answer.`;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Auth check - chat requires a session (protects Gemini quota)
  const { getServerSession } = await import('next-auth/next');
  const { authOptions }      = await import('./auth/[...nextauth].js');
  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.id) return res.status(401).json({ error: 'Sign in to use the AI chat.' });

  // Rate limit - 30 messages/min per authenticated user
  if (!rateLimitWithAuth(req, true, { authedMax: 30, windowMs: 60_000 })) {
    return res.status(429).json({ error: 'Too many messages. Please wait a moment.' });
  }

  const { message, history = [], currentAnalysis, investorProfile } = req.body || {};

  if (!message)         return res.status(400).json({ error: 'Message is required.' });
  if (!currentAnalysis) return res.status(400).json({ error: 'No analysis context provided.' });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key not configured on server.' });

  const contextMsg = [
    '=== CURRENT PROPERTY ANALYSIS ===',
    JSON.stringify(currentAnalysis, null, 2),
    '',
    '=== INVESTOR PROFILE ===',
    investorProfile ? JSON.stringify(investorProfile, null, 2) : 'Not provided',
    '',
    '=== CONVERSATION HISTORY ===',
    history.length
      ? history.map(m => `${m.role==='user'?'Investor':'Advisor'}: ${m.content}`).join('\n')
      : 'First message.',
    '',
    '=== NEW QUESTION ===',
    message,
  ].join('\n');

  const geminiPayload = {
    system_instruction: { parts: [{ text: CHAT_SYSTEM_PROMPT }] },
    contents: [{ role: 'user', parts: [{ text: contextMsg }] }],
    generationConfig: { temperature: 0.3, maxOutputTokens: 4096, thinkingConfig: { thinkingBudget: 0 } },
  };

  let geminiRes;
  try {
    ({ res: geminiRes } = await callGemini(apiKey, geminiPayload, { timeoutMs: 25000 }));
  } catch (e) {
    return res.status(504).json({ error: 'Request timed out or all models unavailable. Please try again.' });
  }

  if (!geminiRes.ok) {
    const errBody = await geminiRes.json().catch(()=>({}));
    const msg = errBody?.error?.message || `Gemini error ${geminiRes.status}`;
    if (geminiRes.status === 429) return res.status(429).json({ error: 'Rate limit - wait 60 seconds.' });
    return res.status(502).json({ error: msg });
  }

  const geminiBody = await geminiRes.json();
  const rawText = extractGeminiText(geminiBody);
  const jsonMatch = rawText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return res.status(502).json({ error: 'Could not parse response.' });

  let data;
  try { data = JSON.parse(jsonMatch[0]); }
  catch { return res.status(502).json({ error: 'Could not parse response.' }); }

  if (!data.reply) return res.status(502).json({ error: 'Incomplete response.' });

  if (data.updatedAnalysis && currentAnalysis._settings) {
    data.updatedAnalysis._settings = {
      ...currentAnalysis._settings,
      ...(data.updatedAnalysis._settings || {}),
    };
  }

  return res.status(200).json(data);
}

export const config = { maxDuration: 30 };
