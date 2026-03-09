import { rateLimitWithAuth }  from "../../lib/rateLimit.js";
import { authOptions }        from './auth/[...nextauth]';
import { callGemini, extractGeminiText } from "../../lib/geminiClient.js";
import { getMarketData, stateTaxRate, stateInsRate, cityAppreciation,
         getEmploymentData, getCaseShillerData,
         getTreasuryYield, getSP500Return, getPmiRate, getMonthlyPmi, getClosingCostPct, getZoriForCity,
         getBuildingPermits, getMetroGrowth,
         getHvsVacancy,
       } from "../../lib/marketData.js";
import { formatLandlordLawPrompt }    from "../../lib/landlordLaws.js";
// Phase 9: live cache readers for auto-healing data
import { getLandlordLawLive, getCityRentControlLive, getStrRegulationLive, getStateTaxRateLive } from "../../lib/marketData.js";
import { formatCityRentControlPrompt, getCityRentControl } from "../../lib/cityRentControlDb.js";
import { getCapRateForCity, getMgmtFeeForCity } from "../../lib/marketBenchmarkFetcher.js";
import { getTaxTrendForState, formatTaxTrendPrompt } from "../../lib/taxTrendFetcher.js";
import { getStrRegulation }           from "../../lib/strDataFetcher.js";
import { getCaseShillerKey }          from "../../lib/caseShillerFetcher.js";
import { getSupabaseAdmin }           from "../../lib/supabase.js";
import { resolveCbsaForCity }         from "../../lib/supplyDemandFetcher.js";
// Auth + DB imports are loaded dynamically inside the handler.
// This prevents a module-load crash if packages aren't installed yet.

// NOTE: Static tables (STATE_TAX_RATES, STATE_INS_RATES, STATE_APPRECIATION,
// CITY_APPRECIATION) have been removed. All market data now comes from
// lib/marketData.js which reads from Supabase market_data_cache (with
// hardcoded baseline fallbacks). The cron at /api/cron/refresh-market-data
// keeps the cache fresh automatically. This eliminates the client/server
// duplication and means we never need to manually update these numbers again.

const MODE_SETTINGS = {
  conservative: { vacancy: 10, maintenance: 1.5 },
  moderate:     { vacancy: 8,  maintenance: 1.0 },
  aggressive:   { vacancy: 5,  maintenance: 0.5 },
};

// Dynamic score weights by investor goal - Kiyosaki fix
const GOAL_WEIGHTS = {
  cashflow:     { cashflow: 0.40, location: 0.20, onePercent: 0.20, market: 0.10, landlord: 0.10 },
  appreciation: { cashflow: 0.10, location: 0.30, onePercent: 0.05, market: 0.40, landlord: 0.15 },
  balanced:     { cashflow: 0.25, location: 0.25, onePercent: 0.15, market: 0.25, landlord: 0.10 },
  tax:          { cashflow: 0.20, location: 0.25, onePercent: 0.10, market: 0.30, landlord: 0.15 },
};

// ─── Deterministic sub-score computation ────────────────────────────────────
// These are computed server-side from exact numeric inputs so the same inputs
// always produce the same sub-scores — eliminating LLM sampling variance.
//
// cashflowScore and onePercentScore are pure math.
// landlordScore comes from our LANDLORD_LAWS database (already fetched).
// locationScore and marketScore are left to the LLM (genuinely judgment-based)
// but the final overallScore is RECOMPUTED server-side using those two LLM values
// plus our three deterministic values, so LLM variance only affects 2 of 5 inputs.

function computeCashflowScore(coc) {
  // CoC → 0-100 score. Calibrated to SCORE_CALIBRATION in prompt.
  // ≥12% CoC → 100, 10% → 85, 8% → 72, 6% → 58, 3% → 40, 0% → 28, -5% → 12, ≤-12% → 0
  if (coc >= 12)  return 100;
  if (coc >= 10)  return Math.round(85 + (coc - 10) / 2 * 15);
  if (coc >=  8)  return Math.round(72 + (coc -  8) / 2 * 13);
  if (coc >=  6)  return Math.round(58 + (coc -  6) / 2 * 14);
  if (coc >=  3)  return Math.round(40 + (coc -  3) / 3 * 18);
  if (coc >=  0)  return Math.round(28 + (coc /  3) * 12);
  if (coc >= -5)  return Math.round(12 + ((coc + 5) / 5) * 16);
  if (coc >= -12) return Math.round(0  + ((coc + 12) / 7) * 12);
  return 0;
}

function computeOnePercentScore(rentPct) {
  // rent/price*100 → 0-100 score
  if (rentPct >= 1.5) return 100;
  if (rentPct >= 1.0) return Math.round(70 + (rentPct - 1.0) / 0.5 * 30);
  if (rentPct >= 0.7) return Math.round(40 + (rentPct - 0.7) / 0.3 * 30);
  if (rentPct >= 0.5) return Math.round(15 + (rentPct - 0.5) / 0.2 * 25);
  return Math.round(Math.max(0, rentPct / 0.5 * 15));
}

function computeServerSideMetrics(p, r, s) {
  // p = numeric price, r = numeric rent (may be null), s = settings object
  // Returns { coc, rentPct, cashflowScore, onePercentScore, landlordScore } or partial if rent unknown
  if (!p || p <= 0) return null;

  const result = { hasRent: r != null && r > 0 };

  if (result.hasRent) {
    const principal  = p * (1 - s.downPaymentPct / 100);
    const r_rate     = s.cashPurchase ? 0 : s.interestRate / 1200;
    const n          = s.cashPurchase ? 0 : s.loanTermYears * 12;
    const mortgage   = s.cashPurchase ? 0
      : s.loanType === 'interest_only' ? principal * r_rate
      : n > 0 && r_rate > 0 ? principal * (r_rate * Math.pow(1 + r_rate, n)) / (Math.pow(1 + r_rate, n) - 1)
      : 0;

    const taxMo      = p * (s.taxRate / 100) / 12;
    const insMo      = p * (s.insRate / 100) / 12;
    const vacMo      = r * (s.vacancy / 100);
    const mgmtMo     = s.selfManage ? 0 : (r - vacMo) * (s.mgmtRate / 100);
    const maintMo    = p * (s.maintenance / 100) / 12;
    const capexMo    = s.capex;
    const hoaMo      = s.hoaMonthly || 0;
    const pmiMo      = s.pmiMonthly || 0;
    const totalExp   = mortgage + taxMo + insMo + vacMo + mgmtMo + maintMo + capexMo + hoaMo + pmiMo;
    const cashflow   = r - totalExp;

    const closingPct    = s.closingCostPct || 0;
    const cashInvested  = s.cashPurchase
      ? p
      : p * (s.downPaymentPct / 100) * (1 + closingPct / 100);
    const coc        = cashInvested > 0 ? (cashflow * 12 / cashInvested) * 100 : 0;
    const rentPct    = (r / p) * 100;

    result.cashflow        = Math.round(cashflow);
    result.coc             = Math.round(coc * 10) / 10;
    result.rentPct         = Math.round(rentPct * 100) / 100;
    result.cashflowScore   = computeCashflowScore(coc);
    result.onePercentScore = computeOnePercentScore(rentPct);
  }

  return result;
}



const SYSTEM_PROMPT_TEMPLATE = (s) => {
  const holdYrs = s.holdingYears || 5;
  const pmiMo = (!s.cashPurchase && s.downPaymentPct < 20)
    ? `$${s.pmiMonthly}/mo (pre-computed for ${s.downPaymentPct}% down)`
    : '$0';
  const closingAmt = s.closingCostPct > 0 ? ` + ${s.closingCostPct}% closing costs` : '';
  const loanTypeLabel = {
    '30yr_fixed':'30-year fixed','15yr_fixed':'15-year fixed',
    '5_1_arm':'5/1 ARM (fixed 5yr, then adjusts)','interest_only':'Interest-only (no principal paydown)',
  }[s.loanType] || '30-year fixed';
  const propTypeNote = {
    sfr:      'Single-family home — single rentable unit, standard assumptions',
    sfr_adu:  `SFR with ADU/guest house — TWO separate structures. Primary unit rent: $${s.perUnitRent||'(estimated)'}/mo. ADU rent: $${s.aduRentNum||'(estimated)'}/mo. ADU has higher vacancy (typically 10-15%) than the main house (5-8%) because ADUs turn over more frequently. Apply vacancy to each structure independently. Combined effective income: $${s.effectiveRent||'(estimated)'}/mo.${s.houseHack ? ' HOUSE HACK: Owner occupies the MAIN HOUSE — only ADU rent counts as income.' : ''}`,
    duplex:   `Duplex — 2 investment units. ${s.unitRentsList ? `Unit rents: ${s.unitRentsList.map((r,i)=>'Unit '+(i+1)+': $'+Math.round(r)+'/mo').join(', ')}. Total: $${Math.round(s.grossRent||0)}/mo gross.` : `Per-unit rent: $${s.perUnitRent||'(estimated)'}/mo × 2 = $${s.grossRent||'(estimated)'}/mo gross.`} Apply vacancy independently per unit (losing one tenant = losing 50% income). Mention this binary vacancy risk.${s.houseHack ? ' HOUSE HACK: Owner occupies one unit — income is only 1 unit\u2019s rent.' : ''}`,
    triplex:  `Triplex — 3 units. ${s.unitRentsList ? `Unit rents: ${s.unitRentsList.map((r,i)=>'Unit '+(i+1)+': $'+Math.round(r)+'/mo').join(', ')}. Total: $${Math.round(s.grossRent||0)}/mo gross.` : `Per-unit rent: $${s.perUnitRent||'(estimated)'}/mo × 3 = $${s.grossRent||'(estimated)'}/mo gross.`} Per-unit vacancy is independent but diversified risk (losing one tenant = losing 33% income). Slightly lower effective vacancy than duplex due to tenant diversification.${s.houseHack ? ' HOUSE HACK: Owner occupies one unit — income is only 2 units\u2019 rent.' : ''}`,
    fourplex: `Fourplex — 4 units. ${s.unitRentsList ? `Unit rents: ${s.unitRentsList.map((r,i)=>'Unit '+(i+1)+': $'+Math.round(r)+'/mo').join(', ')}. Total: $${Math.round(s.grossRent||0)}/mo gross.` : `Per-unit rent: $${s.perUnitRent||'(estimated)'}/mo × 4 = $${s.grossRent||'(estimated)'}/mo gross.`} Best tenant diversification in this class (losing one tenant = losing 25% income). Apply lower effective vacancy rate (~6-7%) versus SFR.${s.houseHack ? ' HOUSE HACK: Owner occupies one unit — income is only 3 units\u2019 rent.' : ''}`,
    condo:    'Condo — single unit, HOA required. Factor HOA into expense breakdown.',
    mfr:      'Multi-family (3-4 units) — lower effective vacancy due to tenant diversification',
  }[s.propertyType] || 'Single-family home';
  return `You are a blunt, experienced real estate investment analyst with a Rich Dad mindset. You think about TOTAL return - cash flow, appreciation, equity, and leverage - not just monthly income. Use ONLY the exact numbers provided.

FINANCING:
- Down payment: ${s.cashPurchase ? 'CASH PURCHASE - no mortgage' : `${s.downPaymentPct}% = $[calc from price]. Loan = ${100-s.downPaymentPct}% of price.`}
- ${s.cashPurchase ? 'No debt service.' : `Rate: ${s.interestRate}% - Loan type: ${loanTypeLabel}, ${s.loanTermYears} years`}
- Cash invested: ${s.cashPurchase ? 'full price' : `${s.downPaymentPct}% of price${closingAmt}`}
- Leverage ratio: ${s.cashPurchase ? '1:1 (no leverage)' : `${(100/s.downPaymentPct).toFixed(1)}:1`}
${!s.cashPurchase && s.downPaymentPct < 20 ? `- PMI: $${s.pmiMonthly}/mo (pre-computed: ${(s.pmiAnnualRate ?? 0.75).toFixed(2)}%/yr × loan balance ÷ 12, LTV-accurate for ${s.downPaymentPct}% down). Use this exact dollar amount. PMI drops when LTV reaches 80%.` : ''}
${s.closingCostPct > 0 ? `- Closing costs: ${s.closingCostPct}% of price - ADD to cash invested for CoC and IRR basis` : ''}

INVESTOR PROFILE:
- Goal: ${s.investorGoal} - ${s.goalLabel}
- Holding period: ${holdYrs} years - use this for ALL projections, not a hardcoded 5yr
- Score weights reflect this goal: ${JSON.stringify(GOAL_WEIGHTS[s.investorGoal] || GOAL_WEIGHTS.balanced)}

PROPERTY TYPE: ${propTypeNote}
${s.houseHack ? `
HOUSE HACK FRAMING — apply to ALL calculations and narrative:
- Owner occupies one unit. Income = ${s.unitCount - 1} of ${s.unitCount} units' rent only.
- Monthly housing cost offset = (rented units' rent − mortgage − all expenses). If positive, owner lives "for free" + earns cashflow. If negative, owner pays the difference to live there.
- CoC return: cash_invested = down payment; income = rented units only. Frame CoC as "investor return on capital deployed."
- Note in verdict: owner-occupied financing (FHA 3.5% down, conventional 5% down) may be available, reducing cash required vs pure investment financing.
- Do NOT count the owner's unit as vacancy or as income.
` : ''}
EXPENSES (use exactly):
- Property taxes: ${s.taxRate.toFixed(2)}%/yr${s.taxUserProvided ? ' ✓ from listing' : ` (${s.stateCode||'state'} estimate)`}
- Insurance: ${s.insRate.toFixed(2)}%/yr (${s.stateCode||'state'}-specific rate - post-2023)
- Vacancy: ${s.vacancy}%
- Management: ${s.selfManage ? '0% (self-managed)' : `${s.mgmtRate}% of effective rent (rent after vacancy deduction - manager earns on collected rent only)`}
- Maintenance: ${s.maintenance}%/yr of price
- CapEx: $${s.capex}/mo
${s.hoaMonthly > 0 ? `- HOA: $${s.hoaMonthly}/mo - include in expense breakdown and total` : '- HOA: none'}
${!s.cashPurchase && s.downPaymentPct < 20 ? `- PMI: $${s.pmiMonthly}/mo (pre-computed LTV-accurate amount for ${s.downPaymentPct}% down — use this exact figure in expense breakdown)` : ''}

RENT:
- If provided: use exactly, rentConfidence = "user-provided"
- If not: estimate from market comps, rentConfidence = "estimated"

MATH - follow exactly:
1. ${s.cashPurchase ? 'mortgage = $0' : s.loanType === 'interest_only' ? `Mortgage (interest-only): M = P * (${s.interestRate}/100/12) where P=price*(${(100-s.downPaymentPct)/100})` : `Mortgage P&I: M = P*[r(1+r)^n]/[(1+r)^n-1] where P=price*(${(100-s.downPaymentPct)/100}), r=${s.interestRate}/1200, n=${s.loanTermYears*12}`}
2. Monthly expenses = mortgage + taxes_mo + insurance_mo + vacancy_mo + mgmt_mo + maint_mo + capex${s.hoaMonthly>0?' + hoa_mo':''}${!s.cashPurchase&&s.downPaymentPct<20?' + pmi_mo':''}
   where: mgmt_mo = (rent − vacancy_mo) × ${s.selfManage ? '0' : s.mgmtRate/100} (management on effective/collected rent only)
3. Monthly cashflow = rent − total expenses
4. CoC = (cashflow*12 / cash_invested) * 100. cash_invested = ${s.cashPurchase ? 'price' : `price * ${s.downPaymentPct/100}${s.closingCostPct>0?` + price * ${s.closingCostPct/100} (closing costs)`:''}`}
5. 1% Rule = (effectiveRent/price)*100 where effectiveRent = income-generating rent only.
   For SFR+ADU: (primaryRent + aduRent)/price*100. For duplex/triplex/fourplex: use gross rent (all units).
   For house hack: use incomeRent (rented units only) — owner's unit is not investable income.
6. Cap Rate (correct formula - includes management as expense): NOI = rent*12 − (taxes_annual + insurance_annual + vacancy_annual + mgmt_annual + maint_annual + capex*12${s.hoaMonthly>0?` + hoa*12`:''}). Cap Rate = NOI/price*100. This reflects true asset value.
7. GRM = price/(rent*12)
8. ${s.cashPurchase ? 'DSCR = "N/A"' : 'DSCR = NOI_annual / (mortgage*12). This is the CORRECT lender formula. NOI_annual = (rent - vacancy_mo - taxes_mo - insurance_mo - mgmt_mo - maint_mo - capex'+(s.hoaMonthly>0?' - hoa_mo':'')+`)*12. Do NOT use rent/mortgage - that overstates coverage. Green ≥1.25, yellow 1.00-1.24, red <1.00`}
9. Break-even rent = total monthly expenses (rule 2)
10. NOI_monthly = rent − vacancy_mo − taxes_mo − insurance_mo − mgmt_mo − maint_mo − capex${s.hoaMonthly>0?' − hoa_mo':''}
11. Score = round(cashflowScore*${(GOAL_WEIGHTS[s.investorGoal]||GOAL_WEIGHTS.balanced).cashflow} + locationScore*${(GOAL_WEIGHTS[s.investorGoal]||GOAL_WEIGHTS.balanced).location} + onePercentScore*${(GOAL_WEIGHTS[s.investorGoal]||GOAL_WEIGHTS.balanced).onePercent} + marketScore*${(GOAL_WEIGHTS[s.investorGoal]||GOAL_WEIGHTS.balanced).market} + landlordScore*${(GOAL_WEIGHTS[s.investorGoal]||GOAL_WEIGHTS.balanced).landlord})

${holdYrs}-YEAR WEALTH PROJECTION (use ${holdYrs} years, NOT 5):
- appreciation_${holdYrs}yr: price * (1 + ${s.appreciationRate/100})^${holdYrs} − price (use ${s.appreciationRate}% annual appreciation)
- loan_paydown_${holdYrs}yr: ${s.cashPurchase ? 'N/A - cash' : s.loanType==='interest_only'?'$0 (interest-only - no principal paydown)':'calculate principal paid in first '+holdYrs*12+' payments'}
- total_return_${holdYrs}yr: (cashflow*${holdYrs*12}) + appreciation_${holdYrs}yr + loan_paydown_${holdYrs}yr
- annualized_return_pct: calculate TRUE IRR (internal rate of return). Cash flows: -cash_invested at t=0, +monthly_cashflow each month for ${holdYrs*12} months, +(appreciation_${holdYrs}yr + loan_paydown_${holdYrs}yr) at end. Solve for annual rate r: NPV = 0. Format as "X.X% IRR". If IRR calculation is not possible, use simple annualized: (total_return_${holdYrs}yr / cash_invested / ${holdYrs}) * 100
- rentGrowthIRR: ALSO compute a second IRR assuming ${s.rentGrowthRate}%\/yr annual rent growth (investor's assumption). Model rent compounding at ${s.rentGrowthRate}%\/yr monthly over hold period. Include in projection JSON as rentGrowthIRR field. Format: "X.X% IRR". Label it in the narrative with the rate.

LEVERAGE INSIGHT (for financed deals): If appreciating ${s.appreciationRate}%/yr, the year-1 appreciation on the full asset = price * ${s.appreciationRate/100}. Return on just your down payment from appreciation alone = (price * ${s.appreciationRate/100}) / (price * ${s.downPaymentPct/100}) * 100. Include this in the narrative.

COC THRESHOLDS: ≥10% = good, 5-9.9% = neutral, <5% = bad. (Kiyosaki minimum is 10% - below that, index funds beat you.)
SCORE CALIBRATION: <20 = disaster, 20-35 = bad, 36-52 = break-even, 53-67 = decent, 68-80 = strong, 81-100 = exceptional.
VERDICT for appreciation-focused investors: if cashflow is negative but market score ≥70 and total_return_${holdYrs}yr is strongly positive, verdict can be MAYBE not NO.

FINAL CHECK: cashflow in keyMetrics must match mid rent scenario.

Return ONLY valid JSON:
{
  "address": "string",
  "propertyDetails": "XBR/YBA, sqft, type, year",
  "assumedPrice": "$X",
  "assumedRent": "$X/mo",
  "rentConfidence": "user-provided|estimated",
  "rentRangeLow": "$X", "rentRangeHigh": "$X",
  "rentRangeNote": "string",
  "strPotential": true|false,
  "strNote": "string or omit if false",
  "verdict": "YES|NO|MAYBE",
  "verdictSummary": "One blunt, conditional sentence naming city and deciding factor. For YES: why it works and the key strength. For MAYBE: 'YES if X, watch Y' format - give the one thing that would flip it. For NO: what it would take to change the verdict (price reduction, rent increase). Never generic - always specific numbers.",
  "overallScore": 0-100,
  "confidenceRange": "omit if rent user-provided",
  "dataConfidence": "High|Medium|Low",
  "dataConfidenceNote": "string",
  "noi": "$X/mo",
  "noiStatus": "good|bad",
  "breakEvenRent": "$X/mo",
  "dscr": "${s.cashPurchase ? 'N/A' : 'X.XX'}",
  "dscrStatus": "${s.cashPurchase ? 'neutral' : 'good|neutral|bad'}",
  "leverageMultiplier": "${s.cashPurchase ? 'N/A' : 'X.Xx'}",
  "appreciationRate": ${s.appreciationRate},
  "projection": {
    "appreciation${holdYrs}yr": "$X",
    "loanPaydown${holdYrs}yr": "${s.cashPurchase ? 'N/A' : '$X'}",
    "cashflow${holdYrs}yr": "+/-$X",
    "totalReturn${holdYrs}yr": "$X",
    "annualizedReturnPct": "X.X% IRR",
    "cashInvested": "$X${s.closingCostPct>0?' (incl. closing)':''}", 
    "appreciation5yr": "$X",
    "loanPaydown5yr": "${s.cashPurchase ? 'N/A' : '$X'}",
    "cashflow5yr": "+/-$X",
    "totalReturn5yr": "$X"
  },
  "expenseBreakdown": [
    {"label": "Mortgage (P&I)", "monthly": "${s.cashPurchase ? '"$0"' : '"$X"'}"},
    {"label": "Property Taxes (${s.taxRate.toFixed(2)}%/yr)", "monthly": "$X"},
    {"label": "Insurance (${s.insRate.toFixed(2)}%/yr)", "monthly": "$X"},
    {"label": "Vacancy (${s.vacancy}%)", "monthly": "$X"},
    {"label": "${s.selfManage ? 'Management (self)' : `Management (${s.mgmtRate}%)`}", "monthly": "${s.selfManage ? '"$0"' : '"$X"'}"},
    {"label": "Maintenance (${s.maintenance}%/yr)", "monthly": "$X"},
    {"label": "CapEx Reserve", "monthly": "$${s.capex}"},
    ${s.hoaMonthly > 0 ? `{"label": "HOA", "monthly": "$${s.hoaMonthly}"},` : ''}
    ${!s.cashPurchase && s.downPaymentPct < 20 ? `{"label": "PMI (${s.downPaymentPct.toFixed(0)}% down)", "monthly": "$${s.pmiMonthly}"},` : ''}
    {"label": "Total Expenses", "monthly": "$X"}
  ],
  "rentScenarios": [
    {"rent": "$X/mo", "cashflow": "+/-$X/mo", "coc": "+/-X.XX%", "verdict": "YES|NO|MAYBE"},
    {"rent": "$X/mo", "cashflow": "+/-$X/mo", "coc": "+/-X.XX%", "verdict": "YES|NO|MAYBE"},
    {"rent": "$X/mo", "cashflow": "+/-$X/mo", "coc": "+/-X.XX%", "verdict": "YES|NO|MAYBE"}
  ],
  "keyMetrics": [
    {"label": "Monthly Cash Flow", "value": "+/-$X",   "note": "After all expenses",         "status": "good|bad|neutral"},
    {"label": "Cash-on-Cash",      "value": "+/-X.X%", "note": "${s.cashPurchase ? 'Cash purchase' : `${s.downPaymentPct}% down${s.closingCostPct>0?'+closing':''}`}. Target 10%+", "status": "good|bad|neutral"},
    {"label": "Cap Rate",          "value": "X.X%",    "note": "True yield incl. mgmt",      "status": "good|bad|neutral"},
    {"label": "${holdYrs}-Yr Total Return", "value": "$X",      "note": "Cash flow + equity + appre.", "status": "good|bad|neutral"},
    {"label": "1% Rule",           "value": "X.XX%",   "note": "Quick filter, not gospel",   "status": "good|bad|neutral"},
    {"label": "DSCR",              "value": "${s.cashPurchase ? '"N/A"' : '"X.XX"'}",   "note": "${s.cashPurchase ? '"No debt"' : '"NOI÷debt svc. ≥1.25 safe"'}",       "status": "${s.cashPurchase ? '"neutral"' : '"good|neutral|bad"'}"},
    {"label": "Location Score",    "value": "X/10",    "note": "Laws, demand, growth",       "status": "good|bad|neutral"},
    {"label": "GRM",               "value": "X.Xx",    "note": "Target ≤12x",                "status": "good|bad|neutral"}
  ],
  "scoreBreakdown": [
    {"name": "Cash Flow (${Math.round((GOAL_WEIGHTS[s.investorGoal]||GOAL_WEIGHTS.balanced).cashflow*100)}%)", "score": 0-100},
    {"name": "Location (${Math.round((GOAL_WEIGHTS[s.investorGoal]||GOAL_WEIGHTS.balanced).location*100)}%)",  "score": 0-100},
    {"name": "Market Growth (${Math.round((GOAL_WEIGHTS[s.investorGoal]||GOAL_WEIGHTS.balanced).market*100)}%)","score": 0-100},
    {"name": "1% Rule (${Math.round((GOAL_WEIGHTS[s.investorGoal]||GOAL_WEIGHTS.balanced).onePercent*100)}%)",  "score": 0-100},
    {"name": "Landlord Laws (${Math.round((GOAL_WEIGHTS[s.investorGoal]||GOAL_WEIGHTS.balanced).landlord*100)}%)","score": 0-100}
  ],
  "pros": ["4 items with specific numbers"],
  "cons": ["3 items with specific numbers - if HOA or PMI materially affects cash flow, mention it"],
  "breakEvenIntelligence": {
    "breakEvenRentForPositiveCF": "$X,XXX/mo",
    "breakEvenRentFor10CoC": "$X,XXX/mo",
    "breakEvenPrice": "$Xk or null (max price for positive cashflow at current rent)",
    "rentGapToPositive": "+$X/mo needed or null if already positive",
    "rentGapTo10CoC": "+$X/mo needed or null if already at 10%+",
    "priceGapToPositive": "-$Xk off ask or null if already positive"
  },
  "narrative": "4-5 sentences. Name city. Use real numbers. Address the investor's goal (${s.investorGoal}). Include leverage angle if financed. Total-return framing, not just monthly cash flow. Who this works for and why. If holding ${holdYrs} years (not 5), name the ${holdYrs}-year outcome specifically."
}`;};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Startup diagnostic — logs to Vercel function console so missing env vars are obvious
  if (!process.env.GEMINI_API_KEY)               console.error('[analyze] MISSING: GEMINI_API_KEY');
  if (!process.env.NEXTAUTH_SECRET)              console.warn('[analyze] MISSING: NEXTAUTH_SECRET (auth disabled)');
  if (!process.env.SUPABASE_URL)                 console.warn('[analyze] MISSING: SUPABASE_URL (token gate disabled)');
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY)    console.warn('[analyze] MISSING: SUPABASE_SERVICE_ROLE_KEY (token gate disabled)');

  // -- Auth + token gate ------------------------------------------------------
  // Three possible callers:
  //   A. Authenticated user with tokens  → deduct 1 token, proceed
  //   B. Authenticated user, no tokens   → 402
  //   C. Unauthenticated guest           → 1 free use per device fingerprint
  //                                        tracked in guest_usage table
  //                                        (same system used for Scout free use)
  let tokensRemaining = null;
  let guestFp = null; // fingerprint from request body, consumed after analysis

  if (process.env.NEXTAUTH_SECRET && process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      const { getServerSession } = await import('next-auth/next');
      const session = await getServerSession(req, res, authOptions);
      const isAuthed = !!session?.user?.id;

      // Rate limiting — higher limit for authed users, tighter for anon
      if (!rateLimitWithAuth(req, isAuthed, { anonMax: 10, authedMax: 30, windowMs: 60_000 })) {
        return res.status(429).json({ error: 'Too many requests. Please wait a minute and try again.' });
      }

      if (isAuthed) {
        // Path A/B — authenticated: deduct token
        // Fail-open if Supabase is unavailable — a missing token deduction is
        // better than blocking every analysis when DB is down or misconfigured.
        // The deduct_token RPC is idempotent; missed deductions can be audited.
        let db = null;
        try { db = getSupabaseAdmin(); } catch (e) {
          console.warn('[analyze] getSupabaseAdmin failed, skipping token deduction:', e.message);
        }
        if (db) {
          try {
            const { data: tokenResult, error: tokenError } = await db.rpc('deduct_token', { p_user_id: session.user.id });
            if (tokenError) {
              // RPC missing or DB error — log but don't block
              console.warn('[analyze] deduct_token error (non-fatal):', tokenError.message || tokenError);
            } else if (tokenResult === false || tokenResult === null) {
              return res.status(402).json({ error: 'No tokens remaining.', code: 'NO_TOKENS', tokens: 0 });
            } else {
              tokensRemaining = typeof tokenResult === 'number' ? tokenResult : 0;
            }
          } catch (rpcErr) {
            console.warn('[analyze] deduct_token threw (non-fatal):', rpcErr.message);
          }
        }

      } else {
        // Path C — unauthenticated guest: check fingerprint-based free use
        // fp is passed from the client in the request body alongside other fields
        const fp = req.body?.guestFp;
        const FP_RE = /^[0-9a-f]{32}$/i;
        if (!fp || !FP_RE.test(fp)) {
          // No valid fingerprint → treat as already-used (force sign-in)
          return res.status(401).json({ error: 'Sign in to run an analysis.', code: 'UNAUTHENTICATED' });
        }

        let db;
        try { db = getSupabaseAdmin(); } catch (e) {
          // Supabase down — fail open for guests so they aren't blocked
          console.warn('[analyze] Supabase unavailable for guest check, allowing:', e.message);
          guestFp = null; // skip consume step
        }

        if (db) {
          // Check if this fingerprint has already used their free analyze
          const { data: guest } = await db.from('guest_usage').select('used_analyze').eq('fingerprint', fp).single().catch(() => ({ data: null }));
          if (guest?.used_analyze) {
            return res.status(401).json({ error: 'Sign in to run more analyses.', code: 'GUEST_USED' });
          }
          guestFp = fp; // mark for consumption after successful analysis
        }
      }
    } catch (authErr) {
      // Auth system error (NextAuth misconfigured, NEXTAUTH_SECRET missing, etc.)
      // Log it but don't block the analysis — a misconfigured auth env should
      // surface in logs, not silently break every user's analysis.
      console.error('Auth/token gate error (non-fatal, analysis proceeding):', authErr.message);
    }
  }
  // --------------------------------------------------------------------------

  const {
    listingUrl, price, rent, beds, baths, sqft, year, city,
    mode = 'moderate',
    selfManage = false,
    mgmtRate = 10,
    taxAnnualAmount = null,
    taxOverride = null,
    vacancyOverride = null,
    capexOverride = null,
    maintenanceOverride = null,
    cashPurchase = false,
    downPaymentPct = 20,
    interestRate = 7.25,
    loanTermYears = 30,
    loanType = '30yr_fixed',
    holdingYears = 5,
    propertyType = 'sfr',
    hoaMonthly = null,
    closingCostPct = null,
    investorGoal = 'balanced',
    goalDetails = '',
    experience = '',
    appreciationOverride = null,
    rentGrowthOverride = null,
    // Multi-unit fields
    aduRent = null,          // ADU / guest house monthly rent (sfr_adu only)
    houseHack = false,       // owner occupies one unit
    perUnitRent = false,     // rent field is per-unit (duplex/triplex/fourplex)
    unitRents = null,        // array of per-unit rents [1200, 950, 1100] for mixed multifamily
    listingDescription = '', // full listing description text for rent calibration
  } = req.body || {};

  if (!price) return res.status(400).json({ error: 'Purchase price is required.' });
  if (!city)  return res.status(400).json({ error: 'City/location is required.' });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key not configured on server.' });

  const modeDefaults  = MODE_SETTINGS[mode] || MODE_SETTINGS.moderate;
  const stateMatch    = city.toUpperCase().match(/,\s*([A-Z]{2})$/);
  const stateCode     = stateMatch ? stateMatch[1] : null;

  // Load all market data from cache (Supabase → baseline fallback)
  // This replaces the old static STATE_TAX_RATES / STATE_INS_RATES / CITY_APPRECIATION tables
  const md = await getMarketData();

  // CapEx PPI adjustment — scale 2019-baseline CapEx amounts by BLS construction cost index.
  // Baseline amounts: SFR $150/mo, Duplex $240/mo, MFR $300/mo (all in 2019 dollars).
  // md.capexPpiMultiplier is refreshed monthly from FRED series PCU2361--2361--.
  // User override (capexOverride) always wins and bypasses PPI adjustment entirely.
  const ppiMultiplier = md.capexPpiMultiplier ?? 1.38;
  const CAPEX_BASELINE_2019 = {
    // Per-property monthly capex in 2019 dollars, scaled by PPI multiplier
    // sfr_adu: two separate structures → higher than pure sfr
    // triplex/fourplex: more units, more systems
    conservative: { sfr: 200, sfr_adu: 280, duplex: 320, triplex: 450, fourplex: 560, mfr: 400 },
    moderate:     { sfr: 150, sfr_adu: 210, duplex: 240, triplex: 330, fourplex: 420, mfr: 300 },
    aggressive:   { sfr: 100, sfr_adu: 140, duplex: 160, triplex: 220, fourplex: 280, mfr: 200 },
  };
  const capexBaseline = CAPEX_BASELINE_2019[mode] || CAPEX_BASELINE_2019.moderate;
  // Map new property types to capex bucket (condo → sfr bucket, legacy mfr stays)
  const propTypeBucket = (['sfr_adu','duplex','triplex','fourplex','mfr'].includes(propertyType))
    ? (propertyType === 'mfr' ? 'mfr' : propertyType)  // keep legacy mfr working
    : 'sfr';
  const ppiAdjustedCapex = Math.round((capexBaseline[propTypeBucket] ?? capexBaseline.sfr) * ppiMultiplier);

  // Phase 3: fetch per-city intelligence from cache (non-blocking — all null on miss)
  // These are populated by the weekly/monthly cron and read here for AI prompt enrichment.
  // We initialize a db client here specifically for these lookups.
  let employmentData = null;
  let caseShillerData = null;
  let zoriData = null;
  try {
    const analysisDb = getSupabaseAdmin();
    const csMetroKey = getCaseShillerKey(city);
    const [empResult, csResult, zoriResult] = await Promise.allSettled([
      getEmploymentData(analysisDb, city),
      csMetroKey ? getCaseShillerData(analysisDb, csMetroKey) : Promise.resolve(null),
      getZoriForCity(analysisDb, city),
    ]);
    employmentData   = empResult.status  === 'fulfilled' ? empResult.value  : null;
    caseShillerData  = csResult.status   === 'fulfilled' ? csResult.value   : null;
    zoriData         = zoriResult.status === 'fulfilled' ? zoriResult.value : null;
  } catch (err) {
    // Non-fatal — analysis proceeds without this enrichment
    console.warn('[analyze] Phase 3 data fetch failed (non-fatal):', err.message);
  }

  const stateTaxRateVal  = stateTaxRate(md, city);
  const stateInsRateVal  = stateInsRate(md, city);
  const appreciationRateState = cityAppreciation(md, city);
  const appreciationRate = (appreciationOverride !== null && !isNaN(parseFloat(appreciationOverride)))
    ? parseFloat(appreciationOverride)
    : appreciationRateState;

  // Live rent growth default from BLS CPI Shelter (replaces hardcoded 2.5%)
  const liveRentGrowthDefault = md.rentGrowthDefault ?? 2.5;

  let taxRate, taxUserProvided = false;
  if (taxAnnualAmount) {
    const priceNum = parseFloat(String(price).replace(/[^0-9.]/g, ''));
    const taxNum   = parseFloat(String(taxAnnualAmount).replace(/[^0-9.]/g, ''));
    taxRate = priceNum > 0 ? (taxNum / priceNum) * 100 : stateTaxRateVal;
    taxUserProvided = true;
  } else if (taxOverride) {
    taxRate = parseFloat(taxOverride);
  } else {
    taxRate = stateTaxRateVal;
  }

  const goalLabel = {
    cashflow:     'Monthly cash flow - income now',
    appreciation: 'Long-term appreciation - wealth building',
    balanced:     'Balanced - cash flow + appreciation',
    tax:          'Tax benefits & equity building',
  }[investorGoal] || investorGoal;

  const settings = {
    mode, taxRate, taxOverride: Boolean(taxOverride), taxUserProvided, stateCode,
    city,  // saved so share/email/scout features can reference location without re-parsing
    insRate: stateInsRateVal,
    appreciationRate,
    rentGrowthRate: rentGrowthOverride != null && !isNaN(parseFloat(rentGrowthOverride))
      ? parseFloat(rentGrowthOverride)
      : liveRentGrowthDefault,  // live BLS CPI Shelter rate from FRED
    vacancy:     vacancyOverride     ? parseFloat(vacancyOverride)     : modeDefaults.vacancy,
    maintenance: maintenanceOverride ? parseFloat(maintenanceOverride) : modeDefaults.maintenance,
    // capexOverride (user input) always wins. If not provided, use PPI-adjusted amount
    // computed above. This replaces the flat MODE_SETTINGS.capex hardcode with a
    // value that reflects current construction cost inflation vs 2019 baseline.
    capex:       capexOverride       ? parseFloat(capexOverride)       : ppiAdjustedCapex,
    selfManage:  Boolean(selfManage),
    mgmtRate:    selfManage ? 0 : parseFloat(mgmtRate) || 10,
    cashPurchase:   Boolean(cashPurchase),
    downPaymentPct: cashPurchase ? 100 : parseFloat(downPaymentPct) || 20,
    // Use live 30yr rate from market data cache as fallback when user hasn't entered a rate.
    // Prevents stale hardcoded 7.25% from being silently applied to every analysis.
    interestRate:   parseFloat(interestRate) || md.mortgageRates?.rate30yr || 6.87,
    loanTermYears:  parseInt(loanTermYears)  || 30,
    loanType:       loanType || '30yr_fixed',
    holdingYears:   parseInt(holdingYears)   || 5,
    propertyType:   propertyType || 'sfr',
    houseHack:      Boolean(houseHack),
    // unitCount / effectiveRent / grossRent populated after multi-unit computation below
    hoaMonthly:     hoaMonthly ? parseFloat(hoaMonthly) : 0,
    closingCostPct: closingCostPct ? parseFloat(closingCostPct) : getClosingCostPct(md, city),
    investorGoal,
    goalLabel,
    goalDetails,
    experience,
    // Phase 5: accurate PMI rate and pre-computed monthly dollar amount for this LTV band.
    // pmiAnnualRate: injected into prompt for context / expense label.
    // pmiMonthly: pre-computed dollar figure injected directly so Gemini uses an exact number,
    //   not its own arithmetic on a rate × loan balance it must estimate.
    pmiAnnualRate:  !cashPurchase && (parseFloat(downPaymentPct)||20) < 20
      ? getPmiRate(md, parseFloat(downPaymentPct)||20)
      : 0,
    pmiMonthly:     !cashPurchase && (parseFloat(downPaymentPct)||20) < 20
      ? getMonthlyPmi(
          md,
          parseFloat(downPaymentPct)||20,
          parseFloat(String(price).replace(/[^0-9.]/g, '')) * (1 - (parseFloat(downPaymentPct)||20) / 100)
        )
      : 0,
    // Phase 5: rent growth source label (ZORI metro vs CPI national)
    rentGrowthSource: null, // filled below after ZORI lookup
  };

  // ── Multi-unit income computation ────────────────────────────────────────
  // Resolve the effective gross rent that the engine and AI use for all calculations.
  // This is where per-unit rents, ADU rents, and house-hack adjustments are applied
  // so the rest of the code just sees a single clean "effectiveRent" value.

  const UNIT_COUNT_MAP = { sfr:1, sfr_adu:2, duplex:2, triplex:3, fourplex:4, condo:1, mfr:2 };
  const unitCount = UNIT_COUNT_MAP[propertyType] ?? 1;

  // For duplex/triplex/fourplex the UI sends per-unit rent; multiply to get total
  const rawRentNum   = rent ? parseFloat(String(rent).replace(/[^0-9.]/g,'')) : null;
  const rawAduRentNum = aduRent ? parseFloat(String(aduRent).replace(/[^0-9.]/g,'')) : null;

  // Total gross rent from ALL units (before vacancy, before house-hack deduction)
  let grossRent = null;
  let unitRentsList = null; // resolved per-unit rent array for AI context

  if (propertyType === 'sfr_adu') {
    // Primary unit + ADU rent separately provided
    const primaryRent = rawRentNum ?? 0;
    const aduRentNum2  = rawAduRentNum ?? 0;
    grossRent = (primaryRent + aduRentNum2) || null;
  } else if (['duplex','triplex','fourplex'].includes(propertyType)) {
    if (Array.isArray(unitRents) && unitRents.length === unitCount && unitRents.some(v => v > 0)) {
      // Individual per-unit rents provided (mixed bedroom configuration)
      unitRentsList = unitRents.map(v => parseFloat(v) || 0);
      grossRent = unitRentsList.reduce((s, v) => s + v, 0) || null;
    } else if (rawRentNum) {
      // Rent sent as combined total (SFR-style entry for multi-unit)
      grossRent = rawRentNum;
    }
  } else {
    // SFR, condo, or combined rent already entered — use as-is
    grossRent = rawRentNum;
  }

  // House hack: owner occupies Unit 1, income = remaining units only
  // When per-unit rents are known, sum units 2+ exactly (not proportional math).
  // Proportional math is wrong when units have different rents (2BR vs 1BR etc).
  let incomeRent = grossRent;
  if (houseHack && unitCount > 1) {
    if (propertyType === 'sfr_adu') {
      // Owner in main house → ADU rent only
      incomeRent = rawAduRentNum || (grossRent ? grossRent / 2 : null);
    } else if (unitRentsList && unitRentsList.length === unitCount) {
      // Mixed-unit: sum all units except Unit 1 (owner-occupied)
      incomeRent = unitRentsList.slice(1).reduce((s, v) => s + v, 0) || null;
    } else {
      // Uniform rent: (n-1)/n of gross
      incomeRent = grossRent ? grossRent * (unitCount - 1) / unitCount : null;
    }
  }

  // Effective rent to send to the AI and use in deterministic scoring
  // incomeRent is what generates cashflow; grossRent is the property's total potential
  const effectiveRent = incomeRent;

  // Store on settings for downstream use (deterministic scoring, prompt construction)
  settings.unitCount      = unitCount;
  settings.grossRent      = grossRent;
  settings.effectiveRent  = effectiveRent;
  settings.houseHack      = Boolean(houseHack);
  settings.aduRentNum     = rawAduRentNum;
  settings.perUnitRent    = rawRentNum;  // the per-unit figure (for duplex/triplex/fourplex display)
  settings.unitRentsList  = unitRentsList; // individual per-unit rents (mixed multifamily)
  settings.listingDescription = listingDescription?.trim() || null;

  // Phase 5: Override rent growth with ZORI metro data if available and user hasn't overridden
  if (zoriData && rentGrowthOverride == null) {
    const zoRiGrowth = zoriData.annualGrowthPct;
    if (zoRiGrowth !== null && !isNaN(zoRiGrowth) && zoRiGrowth > -10 && zoRiGrowth < 25) {
      settings.rentGrowthRate = zoRiGrowth;
      settings.rentGrowthSource = `Zillow ZORI ${zoriData.metro} (${zoriData.asOf})`;
    }
  } else if (!rentGrowthOverride) {
    settings.rentGrowthSource = 'BLS CPI Shelter national';
  }

  // Phase 5: read benchmark values from md (already fetched above)
  const benchmarks = {
    treasuryYield: getTreasuryYield(md),
    treasuryAsOf:  md.treasuryYield?.asOf ?? null,
    sp500_10yr:    getSP500Return(md, 10),
    sp500_5yr:     getSP500Return(md, 5),
    sp500_3yr:     getSP500Return(md, 3),
    sp500AsOf:     md.sp500Returns?.asOf ?? null,
  };

  // Phase 6: resolve CBSA for this city and fetch building permits + metro growth
  const cityForCbsa = settings.city || city || '';
  const stateForCbsa = settings.stateCode || stateCode || '';
  const cbsaCode = resolveCbsaForCity(cityForCbsa, stateForCbsa);
  let db = null;
  try { db = getSupabaseAdmin(); } catch (e) {
    console.warn("[analyze] Supabase unavailable, skipping live enrichment:", e.message);
  }

  // ── Parallel enrichment with hard 10s deadline ───────────────────────────
  // All pre-Gemini DB/network fetches run in parallel so slow Supabase connections
  // can't serially stack and eat the entire 60s Vercel budget.
  // Every fetch is null-safe — a timeout or error just means that block is omitted
  // from the AI prompt; the analysis still runs with static fallbacks.
  const marketCapRate = getCapRateForCity(city, propertyType || 'sfr');
  const mgmtFeeData   = getMgmtFeeForCity(city);
  const taxTrend      = getTaxTrendForState(stateCode);
  const _rcCity       = city?.split(',')[0]?.trim() || '';
  const _rcSlug       = `${_rcCity.toLowerCase().replace(/[^a-z0-9]+/g,'_')}_${(stateCode||'').toLowerCase()}`;
  const safmrData     = null;

  const deadline = (ms) => new Promise(r => setTimeout(r, ms, null));

  const [
    buildingPermits,
    metroGrowth,
    hvsData,
    cityRentCtrl,
    strReg,
    marketRentData,
    landlordLawRaw,
  ] = await Promise.all([
    // Building permits + metro growth (CBSA-gated)
    cbsaCode && db ? getBuildingPermits(db, cbsaCode).catch(() => null) : Promise.resolve(null),
    cbsaCode && db ? getMetroGrowth(db, cbsaCode).catch(() => null)    : Promise.resolve(null),

    // HVS vacancy
    db ? Promise.race([getHvsVacancy(db).catch(() => null), deadline(4000)]) : Promise.resolve(null),

    // City rent control (live preferred, static fallback)
    db
      ? Promise.race([getCityRentControlLive(db, _rcSlug).catch(() => null), deadline(4000)])
          .then(live => live || getCityRentControl(_rcCity, stateCode || ''))
      : Promise.resolve(getCityRentControl(_rcCity, stateCode || '')),

    // STR regulation
    (propertyType === 'sfr' || propertyType === 'sfr_adu' || propertyType === 'condo' || !propertyType) && db
      ? Promise.race([
          getStrRegulationLive(db, city?.toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/_+$/, '')).catch(() => null),
          deadline(4000),
        ]).then(live => live || getStrRegulation(city))
      : Promise.resolve(
          (propertyType === 'sfr' || propertyType === 'sfr_adu' || propertyType === 'condo' || !propertyType)
            ? getStrRegulation(city)
            : null
        ),

    // Internal rent-estimate fetch (skipped if rent is user-provided)
    !rent ? (() => {
      const vercelUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null;
      const baseUrl   = process.env.NEXTAUTH_URL || vercelUrl || 'http://localhost:3000';
      return fetch(`${baseUrl}/api/rent-estimate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-internal': '1' },
        body: JSON.stringify({ city, beds: beds || 2, zip: null }),
        signal: AbortSignal.timeout(6000),
      }).then(r => r.ok ? r.json() : null).catch(() => null);
    })() : Promise.resolve(null),

    // Landlord law (live preferred, static fallback)
    stateCode && db
      ? Promise.race([getLandlordLawLive(db, stateCode).catch(() => null), deadline(4000)])
      : Promise.resolve(null),
  ]);

  if (marketRentData?.mid) settings.marketRent = marketRentData;

  const rentAnchorLines = marketRentData?.mid ? [
    '',
    '=== REAL MARKET RENT DATA - use as anchor for your estimate ===',
    `Source: ${marketRentData.sources?.join(', ') || 'HUD FMR + Census ACS'} - ${marketRentData.confidence} confidence`,
    `Market rent range for ${beds || 2}BR in ${city}: $${marketRentData.low}-$${marketRentData.high}/mo`,
    `Midpoint: $${marketRentData.mid}/mo`,
    `Anchor assumedRent and rentRangeLow/High to this real data range.`,
    `rentConfidence = "${marketRentData.confidence === 'High' ? 'market-data-backed' : 'market-data-estimated'}"`,
    '===',
  ] : [];

  // ── Landlord law block — built from parallel-fetched landlordLawRaw ────────
  let landlordLawBlock = '';
  if (stateCode) {
    const liveLaw = landlordLawRaw;
    if (liveLaw) {
      const rc = liveLaw.rentControlState
        ? 'YES — statewide rent stabilization/control in effect'
        : liveLaw.rentControlPreempted
          ? 'NO — state law preempts all local rent control'
          : liveLaw.rentControlLocalOk
            ? 'State: none — but cities MAY have local ordinances (check city)'
            : 'No rent control at any level';
      landlordLawBlock = [
        `LANDLORD LAW DATA FOR ${stateCode} — inject into landlordScore:`,
        `- Eviction notice to pay or quit: ${liveLaw.evictionNoticeDays} days${liveLaw._evictionSource ? ` (${liveLaw._evictionSource}, ${liveLaw._evictionAsOf})` : ''}`,
        `- Rent control: ${rc}`,
        `- Just cause eviction required: ${liveLaw.justCauseRequired ? 'YES — must have qualifying reason' : 'No'}`,
        `- Mandatory grace period before late fee: ${liveLaw.mandatoryGracePeriod ? 'YES' : 'No'}`,
        `- Security deposit limit: ${liveLaw.secDepositMaxMonths > 0 ? `${liveLaw.secDepositMaxMonths} months` : 'No statutory limit'}`,
        `- Landlord-friendliness score (0–100): ${liveLaw.score}`,
        `- Key caveats: ${liveLaw.notes}`,
        ``,
        `Use score ${liveLaw.score} as the anchor for landlordScore.`,
        `Adjust ±5 pts if the specific city (${city || 'unknown'}) has known local ordinances`,
        `significantly more or less restrictive than the state default noted above.`,
        `Do NOT hallucinate eviction timelines or rent control status — use only the data above.`,
        `NOTE: This data reflects laws as of ${liveLaw._evictionAsOf || '2025'}. Laws can change — instruct the user to verify with a local real estate attorney.`,
      ].join('\n');
    } else {
      landlordLawBlock = formatLandlordLawPrompt(stateCode, city);
    }
  }

  // ── Employment data block (Phase 3C) ─────────────────────────────────────
  // Injects real BLS LAUS metro unemployment data into the market score guidance.
  // Null-safe: if data unavailable, the block is empty and AI uses training knowledge.
  const employmentBlock = employmentData ? [
    '',
    '=== EMPLOYMENT DATA FOR MARKET SCORE (BLS LAUS via FRED) ===',
    `Metro: ${city}`,
    `Current unemployment: ${employmentData.rate}%${employmentData.nationalRate ? ` (national: ${employmentData.nationalRate}%)` : ''}`,
    employmentData.yoyChange !== null
      ? `YoY change: ${employmentData.yoyChange > 0 ? '+' : ''}${employmentData.yoyChange}pp (${employmentData.trend})`
      : '',
    `Data as of: ${employmentData.asOf}`,
    `Use to calibrate marketScore — below-national unemployment with improving trend → higher market score.`,
    `Above-national unemployment with worsening trend → lower market score.`,
    '===',
  ].filter(Boolean).join('\n') : '';

  // ── Case-Shiller price trend block (Phase 3B) ────────────────────────────
  // Gives the AI real historical price momentum context for the market score
  // and appreciation assumptions. Null-safe.
  const caseShillerBlock = caseShillerData ? [
    '',
    `=== HOME PRICE TREND DATA — ${caseShillerData.metro} (S&P/Case-Shiller via FRED) ===`,
    `1yr appreciation: ${caseShillerData.yoyPct !== null ? `+${caseShillerData.yoyPct}%` : 'n/a'}`,
    caseShillerData.cagr3yr !== null ? `3yr CAGR: +${caseShillerData.cagr3yr}%/yr` : '',
    caseShillerData.cagr5yr !== null ? `5yr CAGR: +${caseShillerData.cagr5yr}%/yr` : '',
    `Trend direction: ${caseShillerData.trend} (vs prior 12 months)`,
    `Data as of: ${caseShillerData.asOf}`,
    `Context for marketScore and appreciation discussion:`,
    `- If user's appreciation assumption is below the 3yr/5yr CAGR, note it is conservative.`,
    `- If the trend is decelerating, note the market is cooling from peak.`,
    `- If the trend is accelerating, note improving momentum.`,
    `- Do NOT override the user's appreciationOverride with this data — use it as context only.`,
    '===',
  ].filter(Boolean).join('\n') : '';

  // ── Phase 5: Financial benchmark context block ──────────────────────────────
  // Gives the AI live risk-free rate + index fund returns so every IRR statement
  // has a real comparison point: "8.4% vs 4.6% Treasury = 3.8% real estate premium"
  const benchmarkBlock = (benchmarks.treasuryYield && benchmarks.sp500_10yr) ? [
    '',
    '=== INVESTMENT BENCHMARK CONTEXT (live rates — use in narrative) ===',
    `Risk-free rate: 10-Year Treasury yield = ${benchmarks.treasuryYield}%${benchmarks.treasuryAsOf ? ` (as of ${benchmarks.treasuryAsOf})` : ''}`,
    `Index fund alternative: S&P 500 trailing returns:`,
    `  - 10-year CAGR: ${benchmarks.sp500_10yr}%/yr`,
    `  - 5-year CAGR:  ${benchmarks.sp500_5yr}%/yr`,
    `  - 3-year CAGR:  ${benchmarks.sp500_3yr}%/yr`,
    `${benchmarks.sp500AsOf ? `  (data as of ${benchmarks.sp500AsOf})` : ''}`,
    `REQUIRED narrative context (include in EVERY analysis):`,
    `1. Compare deal IRR to Treasury yield: "X% IRR vs ${benchmarks.treasuryYield}% 10yr Treasury = ${Math.round(((settings.holdingYears||5) > 0 ? 1 : 0) * 10) / 10}pp real estate premium" — calculate the actual spread from the computed IRR.`,
    `2. Compare to S&P 500: if IRR > ${benchmarks.sp500_10yr}% → "beats index funds over 10yr". If IRR < ${benchmarks.sp500_10yr}% → "underperforms passive index over 10yr — mention in verdict".`,
    `3. PMI note (if applicable): PMI = $${settings.pmiMonthly}/mo (pre-computed LTV-accurate amount for ${settings.downPaymentPct}% down — not the generic 0.75% estimate). Reflect this exact dollar amount in the expense breakdown.`,
    '===',
  ].filter(Boolean).join('\n') : '';

  // ── Pre-compute deterministic sub-scores server-side ─────────────────────
  // These are mathematically exact from the user's inputs and will be injected
  // into the prompt and then used to OVERRIDE the final overallScore after parsing.
  // This ensures identical inputs always produce identical scores.
  const priceNum = parseFloat(String(price).replace(/[^0-9.]/g, '')) || 0;
  // Use effectiveRent (already accounting for ADU, per-unit multiplication, house hack)
  // for all deterministic scoring — not the raw rent field from the request body.
  const serverMetrics = computeServerSideMetrics(priceNum, settings.effectiveRent ?? null, settings);

  // landlordScore: extract from the landlordLawBlock we already built
  let serverLandlordScore = null;
  const lsMatch = landlordLawBlock.match(/Landlord-friendliness score \(0[–-]100\):\s*(\d+)/);
  if (lsMatch) serverLandlordScore = parseInt(lsMatch[1]);

  // Build the deterministic scores injection block
  const deterministicScoreBlock = [
    '',
    '=== PRE-COMPUTED SCORES (server-calculated from exact inputs — USE THESE EXACT VALUES) ===',
    ...(serverMetrics?.hasRent ? [
      `cashflowScore: ${serverMetrics.cashflowScore} — derived from CoC of ${serverMetrics.coc}%`,
      `onePercentScore: ${serverMetrics.onePercentScore} — derived from rent/price of ${serverMetrics.rentPct}%`,
      `Server-verified cashflow: $${serverMetrics.cashflow}/mo — your cashflow calculation must match this within $5`,
    ] : [
      'cashflowScore: compute from your estimated rent (no pre-computed value — rent not provided)',
      'onePercentScore: compute from your estimated rent (no pre-computed value — rent not provided)',
    ]),
    serverLandlordScore !== null
      ? `landlordScore: ${serverLandlordScore} — from live LANDLORD_LAWS database. Use this exact value. Adjust ±3 pts maximum for city-specific factors only.`
      : 'landlordScore: compute from landlord law data above',
    'locationScore: your judgment (0-100) — based on location quality, infrastructure, job market',
    'marketScore: your judgment (0-100) — based on all market data above',
    'CRITICAL: Copy the pre-computed scores above verbatim into scoreBreakdown. Do NOT recalculate them.',
    '===',
  ].join('\n');

  const userMsg = [
    listingUrl ? `Listing URL: ${listingUrl}` : '',
    `Purchase price: ${price}`,
    // Rent context depends on property structure
    (() => {
      const s = settings;
      if (s.propertyType === 'sfr_adu') {
        const primary = s.perUnitRent ? `$${s.perUnitRent}/mo` : 'not provided';
        const adu     = s.aduRentNum  ? `$${s.aduRentNum}/mo`  : 'not provided — estimate from local ADU comps';
        const income  = s.effectiveRent ? `$${Math.round(s.effectiveRent)}/mo` : 'estimate both';
        return `SFR+ADU rent breakdown: Primary unit = ${primary} | ADU = ${adu} | Effective income = ${income}${s.houseHack ? ' (house hack: ADU income only)' : ''}`;
      }
      if (['duplex','triplex','fourplex'].includes(s.propertyType)) {
        const perUnit = s.perUnitRent ? `$${s.perUnitRent}/unit/mo` : 'not provided — estimate from local comps';
        const gross   = s.grossRent   ? `$${Math.round(s.grossRent)}/mo` : 'estimate';
        const income  = s.effectiveRent ? `$${Math.round(s.effectiveRent)}/mo` : gross;
        return `${s.propertyType.charAt(0).toUpperCase()+s.propertyType.slice(1)} rent: ${perUnit} × ${s.unitCount} units = ${gross} gross${s.houseHack ? ` | House hack: ${income} net income (${s.unitCount-1} rented units)` : ''}`;
      }
      if (s.effectiveRent) return `Monthly rent (confirmed): $${Math.round(s.effectiveRent)}/mo`;
      return 'Monthly rent: NOT PROVIDED - estimate from comps.';
    })(),
    beds  ? `Bedrooms: ${beds}`   : '',
    baths ? `Bathrooms: ${baths}` : '',
    sqft  ? `Sq ft: ${sqft}`      : '',
    year  ? `Year built: ${year}` : '',
    `City/location: ${city}`,
    `Analysis mode: ${mode}`,
    cashPurchase ? 'FINANCING: All cash - no mortgage.' : `FINANCING: ${settings.downPaymentPct}% down, ${settings.interestRate}% rate, ${settings.loanTermYears}yr - ${({
      '30yr_fixed':'30-year fixed','15yr_fixed':'15-year fixed',
      '5_1_arm':'5/1 ARM','interest_only':'Interest-only',
    }[settings.loanType]||'30-year fixed')}`,
    settings.hoaMonthly > 0 ? `HOA fee: $${settings.hoaMonthly}/mo - include in expense breakdown` : '',
    settings.closingCostPct > 0 ? `Closing costs: ${settings.closingCostPct}% of price - add to cash invested for CoC calc` : '',
    !cashPurchase && settings.downPaymentPct < 20 ? `PMI: $${settings.pmiMonthly}/mo (pre-computed for ${settings.downPaymentPct}% down — include this exact amount in expense breakdown)` : '',
    `Property type: ${({sfr:'Single-family home',sfr_adu:'SFR with ADU/Guest House',duplex:'Duplex (2 units)',triplex:'Triplex (3 units)',fourplex:'Fourplex (4 units)',condo:'Condo',mfr:'Multi-family 3-4 units'}[settings.propertyType]||'Single-family home')}`,
    settings.houseHack ? `House hack strategy: YES — owner occupies one unit. Income = ${settings.unitCount-1} of ${settings.unitCount} units. Frame CoC as housing cost offset vs pure investment return. Note FHA/conventional owner-occupied financing may be available.` : '',
    `Holding period: ${settings.holdingYears} years`,
    taxUserProvided
      ? `Property tax (from listing): $${String(taxAnnualAmount).replace(/[^0-9.]/g,'')} annually = ${taxRate.toFixed(3)}% of price`
      : `Property tax: ${taxRate.toFixed(2)}%/yr (${stateCode||'state'} estimate)`,
    `Insurance: ${stateInsRateVal.toFixed(2)}%/yr (${stateCode||'state'} post-2023 rate)`,
    `Vacancy: ${settings.vacancy}% - show dollar amount in expense breakdown label`,
    `Maintenance: ${settings.maintenance}%/yr`,
    `CapEx: $${settings.capex}/mo`,
    `Management: ${selfManage ? 'self (0%)' : `${settings.mgmtRate}%`}`,
    `Investor goal: ${goalLabel}`,
    `Market appreciation benchmark: ${appreciationRate}%/yr`,
    `Rent growth assumption: ${settings.rentGrowthRate}%/yr${settings.rentGrowthSource ? ` (source: ${settings.rentGrowthSource})` : ''} - use this for the rentGrowthIRR projection`,
    goalDetails ? `Additional context: ${goalDetails}` : '',
    ...rentAnchorLines,
    landlordLawBlock,
    employmentBlock,
    caseShillerBlock,
    benchmarkBlock,
    // Phase 6: Supply & demand context block
    (() => {
      const lines = [];
      if (buildingPermits || metroGrowth) {
        lines.push('', '=== MARKET SUPPLY & DEMAND CONTEXT (live data — use in narrative) ===');
        if (buildingPermits) {
          lines.push(`New construction supply: ${buildingPermits.annualized.toLocaleString()} new residential units/yr in this metro (${buildingPermits.source})`);
          lines.push(`Supply trend: ${buildingPermits.trend} (${buildingPermits.trendPct > 0 ? '+' : ''}${buildingPermits.trendPct}% vs prior period)`);
          lines.push(`Supply pressure: ${buildingPermits.supplyPressure} — ${buildingPermits.supplyNote}`);
        }
        if (metroGrowth) {
          if (metroGrowth.popGrowthPct !== null) {
            lines.push(`Population growth: ${metroGrowth.popGrowthPct > 0 ? '+' : ''}${metroGrowth.popGrowthPct}%/yr (${metroGrowth.popTrend.replace('_', ' ')})`);
          }
          if (metroGrowth.jobGrowthPct !== null) {
            lines.push(`Job/employment growth: ${metroGrowth.jobGrowthPct > 0 ? '+' : ''}${metroGrowth.jobGrowthPct}%/yr (${metroGrowth.jobTrend.replace('_', ' ')})`);
          }
          lines.push(`Demand signal: ${metroGrowth.demandSignal} — ${metroGrowth.demandNote}`);
        }
        lines.push(`REQUIRED: mention supply pipeline and demand direction when discussing rent growth sustainability and ${settings.holdingYears}-year appreciation outlook. These are forward-looking fundamentals, not historical.`);
        lines.push('===');
      }
      return lines.join('\n');
    })(),

    // ── Phase 7: Market Context & Benchmarking ────────────────────────────
    // Item 10: Market cap rate benchmark
    (() => {
      if (!marketCapRate?.capRate) return '';
      const propLabel = (propertyType || 'sfr').toUpperCase();
      const delta = marketCapRate.vsNational;
      const deltaStr = delta > 0 ? `+${delta}pp above` : delta < 0 ? `${Math.abs(delta)}pp below` : 'at';
      return [
        '',
        `=== MARKET CAP RATE BENCHMARK — ${city || 'this market'} (${propLabel}) ===`,
        `Market cap rate: ${marketCapRate.capRate}% (${deltaStr} national average of ${delta >= 0 ? marketCapRate.capRate - delta : marketCapRate.capRate + Math.abs(delta)}%)`,
        `Metro: ${marketCapRate.metro}  |  Source: ${marketCapRate.source}`,
        `Use market cap rate to calibrate capRate score:`,
        `- Deal cap rate ABOVE market → above-market yield, positive for investment`,
        `- Deal cap rate BELOW market → below-market yield, may indicate overpricing`,
        `- Include this comparison in the capRate metric note.`,
        '===',
      ].join('\n');
    })(),

    // Item 11: City rent control
    (() => {
      const block = formatCityRentControlPrompt(city?.split(',')[0]?.trim() || '', stateCode || '');
      if (!block) return '';
      return '\n' + block + '\n';
    })(),

    // Item 12: Property management fee benchmark
    (() => {
      if (!mgmtFeeData || settings.selfManage) return '';
      const national = 8.9;
      const diff = Math.round((mgmtFeeData.rate - national) * 10) / 10;
      const diffStr = diff > 0 ? `${diff}pp above` : diff < 0 ? `${Math.abs(diff)}pp below` : 'at';
      return [
        '',
        `=== PROPERTY MANAGEMENT FEE BENCHMARK — ${city || 'this market'} ===`,
        `Local mgmt fee rate: ${mgmtFeeData.rate}% of collected rent (${diffStr} national avg of ${national}%)`,
        `Source: ${mgmtFeeData.source}  |  Metro: ${mgmtFeeData.metro}`,
        `Management fee assumption in this analysis: ${settings.mgmtRate}%`,
        `${Math.abs(mgmtFeeData.rate - settings.mgmtRate) > 1.5
          ? `NOTE: User's mgmt rate (${settings.mgmtRate}%) differs from local benchmark (${mgmtFeeData.rate}%). Mention this in your management note.`
          : `User's mgmt rate is consistent with local benchmarks.`}`,
        '===',
      ].join('\n');
    })(),

    // Item 13: HVS vacancy benchmark
    (() => {
      if (!hvsData) return '';
      const state = stateCode || city?.toUpperCase().match(/,\s*([A-Z]{2})$/)?.[1];
      const regionMap = {
        CT:'northeast',MA:'northeast',ME:'northeast',NH:'northeast',NJ:'northeast',
        NY:'northeast',PA:'northeast',RI:'northeast',VT:'northeast',
        IL:'midwest',IN:'midwest',IA:'midwest',KS:'midwest',MI:'midwest',
        MN:'midwest',MO:'midwest',NE:'midwest',ND:'midwest',OH:'midwest',SD:'midwest',WI:'midwest',
        AL:'south',AR:'south',DE:'south',DC:'south',FL:'south',GA:'south',KY:'south',
        LA:'south',MD:'south',MS:'south',NC:'south',OK:'south',SC:'south',TN:'south',
        TX:'south',VA:'south',WV:'south',
        AK:'west',AZ:'west',CA:'west',CO:'west',HI:'west',ID:'west',MT:'west',
        NV:'west',NM:'west',OR:'west',UT:'west',WA:'west',WY:'west',
      };
      const region = state ? (regionMap[state.toUpperCase()] ?? 'national') : 'national';
      const vacancy = region !== 'national' && hvsData.byRegion?.[region]
        ? hvsData.byRegion[region]
        : hvsData.national;
      const vacStr = vacancy < 5 ? 'tight (supports rent growth)' : vacancy > 8 ? 'loose (supply pressure, rent headwind)' : 'balanced';
      return [
        '',
        `=== REGIONAL RENTAL VACANCY — Census HVS ${hvsData.asOf} ===`,
        `${region.charAt(0).toUpperCase() + region.slice(1)} regional vacancy rate: ${vacancy}% — ${vacStr}`,
        `National avg: ${hvsData.national}%`,
        `Analysis vacancy assumption: ${settings.vacancy}%`,
        `Use regional vacancy as context for rent growth sustainability and occupancy assumptions.`,
        `${vacancy < 5 ? 'Low vacancy → upward rent pressure, conservative vacancy assumption warranted.' : vacancy > 8 ? 'High vacancy → rent competition, consider if user vacancy assumption is too optimistic.' : 'Balanced vacancy — current assumption is reasonable.'}`,
        '===',
      ].join('\n');
    })(),

    // Item 14: SAFMR rent anchor (ZIP-level HUD data)
    (() => {
      if (!safmrData?.rent) return '';
      return [
        '',
        `=== HUD SMALL AREA FAIR MARKET RENT — ZIP ${safmrData.zip} (${safmrData.beds}BR) ===`,
        `SAFMR: $${safmrData.rent}/mo  |  Metro: ${safmrData.metro}  |  Year: ${safmrData.year}`,
        `Source: HUD Small Area FMR (ZIP-level — more precise than county FMR)`,
        `Use SAFMR as a real-data anchor for the rent estimate. This is the HUD-defined fair market rent`,
        `for this specific ZIP code — a strong signal for realistic market rent for voucher-eligible tenants`,
        `and a useful lower-bound for market rent analysis.`,
        `If assumedRent is significantly above SAFMR, flag as potentially optimistic.`,
        '===',
      ].join('\n');
    })(),

    // Phase 8: Tax trend
    (() => {
      const block = formatTaxTrendPrompt(stateCode, city);
      if (!block) return '';
      return '\n' + block + '\n';
    })(),

    // Phase 8: STR regulation alert (SFR/condo only)
    (() => {
      if (!strReg) return '';
      const isBanned     = strReg.status === 'banned';
      const isRestricted = strReg.status === 'restricted';
      if (!isBanned && !isRestricted) return '';
      return [
        '',
        `=== STR REGULATORY ALERT — ${city} ===`,
        `Status: ${strReg.status.toUpperCase()} — ${strReg.detail}`,
        `Permit required: ${strReg.permitRequired ? 'Yes' : 'No'}`,
        strReg.ownerOccupied ? 'Owner-occupancy required: YES — investment STRs not permitted' : '',
        strReg.nightCap ? `Night cap: ${strReg.nightCap} nights/yr unhosted` : '',
        `Source: ${strReg.source}`,
        isBanned
          ? 'REQUIRED: Flag STR as NOT viable for this property. Do not include STR income in any scenario.'
          : 'REQUIRED: If STR potential is mentioned, note the regulatory restrictions prominently.',
        '===',
      ].filter(Boolean).join('\n');
    })(),

    deterministicScoreBlock,

    // Listing description — highest-priority rent calibration signal
    settings.listingDescription ? [
      '',
      '=== LISTING DESCRIPTION (agent-provided — read carefully for rent calibration) ===',
      settings.listingDescription,
      '',
      'REQUIRED: Identify any renovation mentions (kitchen, bath, HVAC, roof, flooring, windows)',
      'and premium features (hardwood, granite, stainless, pool, garage, views, permits).',
      'Adjust rent estimate UP or DOWN based on condition and finishes vs market baseline.',
      'Quantify the adjustment: "Kitchen renovation adds $75-125/mo to market rent for this unit size."',
      'If the listing mentions deferred maintenance, cosmetic issues, or dated finishes, note rent drag.',
      '===',
    ].join('\n') : '',

    // Unit-by-unit rent breakdown for mixed multifamily
    settings.unitRentsList ? [
      '',
      `=== UNIT-BY-UNIT RENT BREAKDOWN (${settings.propertyType}) ===`,
      ...settings.unitRentsList.map((r, i) => `Unit ${i+1}: $${Math.round(r)}/mo`),
      `Total gross rent: $${Math.round(settings.grossRent || 0)}/mo`,
      settings.houseHack ? `House hack: Unit 1 owner-occupied. Income from Units 2-${settings.unitCount}: $${Math.round(settings.effectiveRent || 0)}/mo` : '',
      "REQUIRED: Analyze each unit's rent relative to local market for that bedroom count.",
      'If per-unit rents differ significantly, explain why (sq ft, condition, floor level, etc.).',
      '===',
    ].filter(Boolean).join('\n') : '',

    '',
    'Use these numbers exactly.',
  ].filter(Boolean).join('\n');

  const geminiPayload = {
    system_instruction: { parts: [{ text: SYSTEM_PROMPT_TEMPLATE(settings) }] },
    contents: [{ role: 'user', parts: [{ text: userMsg }] }],
    generationConfig: { temperature: 0, maxOutputTokens: 16000 },
  };

  let geminiRes, modelUsed;
  try {
    ({ res: geminiRes, modelUsed } = await callGemini(apiKey, geminiPayload));
  } catch (e) {
    const isTimeout = e?.name === 'TimeoutError' || e?.message?.includes('timed out') || e?.message?.includes('abort');
    return res.status(504).json({ error: isTimeout
      ? 'Analysis timed out - this sometimes happens on large properties. Please try again.'
      : `Could not reach AI service: ${e.message}` });
  }

  if (!geminiRes.ok) {
    const errBody = await geminiRes.json().catch(() => ({}));
    const msg = errBody?.error?.message || `Gemini API error ${geminiRes.status}`;
    if (geminiRes.status === 429) return res.status(429).json({ error: 'Rate limit hit - wait 60 seconds.' });
    if (geminiRes.status === 401 || geminiRes.status === 403) return res.status(401).json({ error: 'Invalid API key.' });
    return res.status(502).json({ error: msg });
  }

  const geminiBody = await geminiRes.json().catch(() => null);
  if (!geminiBody) return res.status(502).json({ error: 'AI returned an unreadable response. Please try again.' });

  // Detect quota / safety / no-candidate responses before attempting to parse
  if (!geminiBody?.candidates || geminiBody.candidates.length === 0) {
    const blockReason = geminiBody?.promptFeedback?.blockReason;
    const finishReason = geminiBody?.candidates?.[0]?.finishReason;
    if (blockReason === 'SAFETY' || finishReason === 'SAFETY') {
      return res.status(502).json({ error: 'AI safety filter triggered. Rephrase your input and try again.' });
    }
    if (geminiBody?.error?.code === 429 || geminiBody?.error?.status === 'RESOURCE_EXHAUSTED') {
      return res.status(429).json({ error: 'AI quota exceeded - wait 60 seconds and try again.' });
    }
    const apiErrMsg = geminiBody?.error?.message;
    return res.status(502).json({ error: apiErrMsg ? `AI error: ${apiErrMsg}` : 'AI returned no response. Check that GEMINI_API_KEY is valid and has quota.' });
  }

  const rawText = extractGeminiText(geminiBody);
  // If Gemini hit the token limit, the JSON will be truncated and unparseable
  const finishReasonFinal = geminiBody?.candidates?.[0]?.finishReason;
  if (finishReasonFinal === 'MAX_TOKENS' && !rawText.includes('}')) {
    return res.status(502).json({ error: 'AI response was cut off. Please try again.' });
  }

  const jsonMatch  = rawText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return res.status(502).json({ error: 'Could not parse AI response. Please try again.' });

  let data;
  try { data = JSON.parse(jsonMatch[0]); }
  catch { return res.status(502).json({ error: 'Could not parse AI response. Please try again.' }); }

  if (!data.verdict || data.overallScore === undefined) {
    return res.status(502).json({ error: 'Incomplete response. Please try again.' });
  }

  data._settings = settings;

  // ── Deterministic score override ──────────────────────────────────────────
  // Recompute overallScore server-side from sub-scores so identical inputs
  // always produce an identical final score regardless of LLM sampling variance.
  //
  // Strategy:
  // - cashflowScore, onePercentScore: use server-computed values if rent was known,
  //   otherwise use whatever Gemini returned (rent had to be estimated)
  // - landlordScore: use server-computed value from LANDLORD_LAWS if available,
  //   otherwise cap Gemini's value to ±3 pts of the database value
  // - locationScore, marketScore: keep Gemini's values (genuinely judgment-based)
  //   but clamp to valid range
  //
  // The final overallScore is ALWAYS recomputed from the sub-scores here,
  // never taken raw from Gemini's output.
  (() => {
    try {
      const weights = GOAL_WEIGHTS[settings.investorGoal] || GOAL_WEIGHTS.balanced;

      // Parse Gemini's scoreBreakdown into a map by name prefix
      const sb = Array.isArray(data.scoreBreakdown) ? data.scoreBreakdown : [];
      const findScore = (prefix) => {
        const entry = sb.find(e => e?.name?.toLowerCase().startsWith(prefix.toLowerCase()));
        return entry?.score != null ? Math.min(100, Math.max(0, Math.round(Number(entry.score)))) : null;
      };

      // Get Gemini's sub-scores for judgment-based dimensions
      const aiLocationScore = findScore('Location') ?? 60;
      const aiMarketScore   = findScore('Market')   ?? 60;

      // Get Gemini's cashflow/onePercent scores — used only if server couldn't compute them
      const aiCashflowScore    = findScore('Cash') ?? 50;
      const aiOnePercentScore  = findScore('1%')   ?? 50;

      // Determine final sub-scores
      const finalCashflowScore    = (serverMetrics?.hasRent)     ? serverMetrics.cashflowScore   : aiCashflowScore;
      const finalOnePercentScore  = (serverMetrics?.hasRent)     ? serverMetrics.onePercentScore : aiOnePercentScore;
      const finalLandlordScore    = serverLandlordScore !== null  ? serverLandlordScore           : (findScore('Landlord') ?? 60);
      const finalLocationScore    = Math.min(100, Math.max(0, aiLocationScore));
      const finalMarketScore      = Math.min(100, Math.max(0, aiMarketScore));

      // Recompute overallScore with exact weights
      const recomputed = Math.round(
        finalCashflowScore   * weights.cashflow   +
        finalLocationScore   * weights.location   +
        finalOnePercentScore * weights.onePercent +
        finalMarketScore     * weights.market     +
        finalLandlordScore   * weights.landlord
      );

      // Override scoreBreakdown with the deterministic values
      const nameMap = {
        cashflow:   `Cash Flow (${Math.round(weights.cashflow * 100)}%)`,
        location:   `Location (${Math.round(weights.location * 100)}%)`,
        onePercent: `1% Rule (${Math.round(weights.onePercent * 100)}%)`,
        market:     `Market Growth (${Math.round(weights.market * 100)}%)`,
        landlord:   `Landlord Laws (${Math.round(weights.landlord * 100)}%)`,
      };
      data.scoreBreakdown = [
        { name: nameMap.cashflow,   score: finalCashflowScore   },
        { name: nameMap.location,   score: finalLocationScore   },
        { name: nameMap.market,     score: finalMarketScore     },
        { name: nameMap.onePercent, score: finalOnePercentScore },
        { name: nameMap.landlord,   score: finalLandlordScore   },
      ];
      data.overallScore = recomputed;

      // Tag the response so client can confirm deterministic scoring was applied
      data._scoreDeterministic = true;
      data._scoreDebug = {
        cashflowScore: finalCashflowScore,
        locationScore: finalLocationScore,
        marketScore:   finalMarketScore,
        onePercentScore: finalOnePercentScore,
        landlordScore: finalLandlordScore,
        serverMetricsUsed: serverMetrics?.hasRent ?? false,
        serverLandlordUsed: serverLandlordScore !== null,
      };
    } catch (scoreErr) {
      // Never crash the response over scoring — just log and continue with AI's score
      console.error('Score override error:', scoreErr?.message);
    }
  })();

  // Phase 6: attach supply/demand data to response so UI can show new cards
  // without needing a separate API call
  if (cbsaCode) data._cbsaCode = cbsaCode;
  if (buildingPermits) data._buildingPermits = buildingPermits;
  if (metroGrowth)     data._metroGrowth     = metroGrowth;

  // Phase 7: attach market context data to response
  if (marketCapRate)   data._marketCapRate   = marketCapRate;
  if (mgmtFeeData)     data._mgmtFeeData     = mgmtFeeData;
  if (hvsData)         data._hvsVacancy      = hvsData;
  if (cityRentCtrl)    data._cityRentCtrl    = cityRentCtrl;
  if (safmrData)       data._safmrRent       = safmrData;

  // Phase 8: attach tax trend and STR regulation to response
  if (taxTrend)        data._taxTrend        = taxTrend;
  if (strReg)          data._strReg          = strReg;

  // Attach market data freshness so UI can show "rates as of X" badge
  if (md?.freshness)   data._marketFreshness = md.freshness;
  if (md?.source)      data._marketSource    = md.source;

  // Consume guest free use AFTER successful analysis — fire and forget
  if (guestFp) {
    try {
      const db = getSupabaseAdmin();
      const { data: existing } = await db.from('guest_usage').select('id').eq('fingerprint', guestFp).single().catch(() => ({ data: null }));
      if (existing) {
        db.from('guest_usage').update({ used_analyze: true, last_seen: new Date().toISOString() }).eq('fingerprint', guestFp).catch(() => {});
      } else {
        db.from('guest_usage').insert({ fingerprint: guestFp, used_analyze: true }).catch(() => {});
      }
    } catch (_) { /* non-critical */ }
  }

  const responsePayload = tokensRemaining !== null
    ? { ...data, tokensRemaining }
    : data;
  return res.status(200).json(responsePayload);
}

export const config = { maxDuration: 90 };
