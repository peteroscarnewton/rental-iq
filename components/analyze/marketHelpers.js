// Market data store and lookup helpers.
//
// This module has two responsibilities:
//   1. The _MD singleton — mutable market data store, starts from MD_BASELINE
//      and is updated once by fetchMarketData() on page load.
//   2. State/metro lookup functions that read from _MD.
//
// NOTE: recalcFromEdits lives here because it reads _MD.capexPpiMultiplier.
// If that dependency is ever removed, recalcFromEdits belongs in its own
// lib/dealCalc.js — it is financial math, not market data infrastructure.

import { MD_BASELINE, GOAL_WEIGHTS } from './marketData';

// The live market data object — starts from baseline, updated by setMarketData()
let _MD = MD_BASELINE;

// Called once from the main page after /api/market-data responds
export function setMarketData(data) {
  _MD = data;
}

// Expose a readonly snapshot for components that need to pass _MD as a prop
export function getMarketData() {
  return _MD;
}

// ── State-level lookup helpers ─────────────────────────────────────────────

export function getInsRate(city) {
  if (!city) return 0.80;
  const m = city.toUpperCase().match(/,\s*([A-Z]{2})$/);
  return m && _MD.stateInsRates[m[1]] ? _MD.stateInsRates[m[1]] : 0.80;
}

export function getStateTaxRate(city) {
  if (!city) return 1.10;
  const m = city.toUpperCase().match(/,\s*([A-Z]{2})$/);
  return m && _MD.stateTaxRates[m[1]] ? _MD.stateTaxRates[m[1]] : 1.10;
}

export function getStateAppreciation(city) {
  if (!city) return 3.5;
  const cityName = city.split(',')[0].trim().toLowerCase();
  if (_MD.cityAppreciation[cityName] !== undefined) return _MD.cityAppreciation[cityName];
  const m = city.toUpperCase().match(/,\s*([A-Z]{2})$/);
  return m && _MD.stateAppreciation[m[1]] ? _MD.stateAppreciation[m[1]] : 3.5;
}

export function getPmiRateForDown(downPct) {
  if (downPct >= 20) return 0;
  const r = _MD.pmiRates || { ltv95_97:0.95, ltv90_95:0.68, ltv85_90:0.45, ltv80_85:0.24 };
  if (downPct >= 15) return r.ltv80_85 ?? 0.24;
  if (downPct >= 10) return r.ltv85_90 ?? 0.45;
  if (downPct >= 5)  return r.ltv90_95 ?? 0.68;
  return r.ltv95_97 ?? 0.95;
}

export function getClosingCostForState(city) {
  const costs = _MD.stateClosingCosts || {};
  if (!city) return costs._nationalAvg ?? 2.1;
  const m = city.toUpperCase().match(/,\s*([A-Z]{2})$/);
  if (!m) return costs._nationalAvg ?? 2.1;
  return costs[m[1]] ?? costs._nationalAvg ?? 2.1;
}

export function getTreasuryRate() {
  return _MD.treasuryYield?.rate ?? 4.62;
}

export function getSP500Return(years) {
  const r = _MD.sp500Returns || {};
  if (years === 10) return r.return10yr ?? 12.4;
  if (years === 5)  return r.return5yr  ?? 13.8;
  return r.return3yr ?? 8.7;
}

// ── NARPM 2024 management fee benchmarks by metro ──────────────────────────

const MGMT_FEE_BENCHMARKS = {
  'san francisco':8.5,'san jose':8.5,'oakland':8.5,'los angeles':8.0,'san diego':8.0,
  'new york':8.0,'brooklyn':8.0,'manhattan':8.0,'boston':8.5,'seattle':8.5,
  'washington':8.0,'miami':9.0,'fort lauderdale':9.0,'denver':8.5,'austin':9.0,
  'dallas':9.0,'houston':9.0,'phoenix':9.0,'scottsdale':9.0,'las vegas':8.5,'chicago':8.5,
  'nashville':9.5,'charlotte':9.5,'raleigh':9.5,'atlanta':9.5,'salt lake city':9.0,
  'portland':9.0,'minneapolis':9.0,'kansas city':9.5,'st. louis':9.5,'columbus':9.5,
  'cleveland':9.5,'cincinnati':9.5,'indianapolis':9.5,'louisville':9.5,'richmond':9.5,
  'memphis':10.0,'birmingham':10.0,'oklahoma city':10.0,'jacksonville':9.5,'tampa':9.5,
  'orlando':9.5,'boise':9.5,'reno':9.5,'tucson':9.5,'san antonio':9.5,'el paso':10.0,
};

export function getMgmtRateBenchmark(city) {
  if (!city) return 8.9;
  const cn = city.split(',')[0].trim().toLowerCase();
  for (const [key, rate] of Object.entries(MGMT_FEE_BENCHMARKS)) {
    if (cn === key || cn.startsWith(key) || key.startsWith(cn.split(' ')[0])) return rate;
  }
  return 8.9;
}

// ── Client-side deal recalculation ────────────────────────────────────────
//
// Mirrors the server-side underwriting in pages/api/analyze.js.
// Called when the user tweaks price/rent/assumptions on the results page.

export function recalcFromEdits(data, edits) {
  const price    = parseFloat(String(edits.price || data.assumedPrice  || '0').replace(/[^0-9.]/g,'')) || 0;
  const rent     = parseFloat(String(edits.rent  || data.assumedRent   || '0').replace(/[^0-9.]/g,'')) || 0;
  const s        = data._settings || {};
  const downPct  = s.cashPurchase ? 100 : (parseFloat(edits.downPaymentPct != null ? edits.downPaymentPct : s.downPaymentPct) || 20);
  const rate     = s.cashPurchase ? 0   : (parseFloat(edits.interestRate   != null ? edits.interestRate   : s.interestRate)   || 6.99);
  const loanType = s.loanType || '30yr_fixed';
  const termYrs  = s.loanTermYears || 30;
  const holdYrs  = s.holdingYears || 5;
  const holdMos  = holdYrs * 12;

  const _tax    = parseFloat(edits.taxRate ?? s.taxRate);
  const taxRate = isNaN(_tax) ? 1.1 : _tax;
  const insRate = parseFloat(s.insRate) || 0.80;

  const propType       = s.propertyType || 'sfr';
  const defaultVacancy = propType === 'sfr' || propType === 'condo' ? 8 : 5;
  const ppiMult        = _MD.capexPpiMultiplier ?? 1.38;
  const defaultCapex   = Math.round((propType === 'mfr' ? 300 : propType === 'duplex' ? 240 : 150) * ppiMult);

  const _vac   = parseFloat(edits.vacancy   ?? s.vacancy);   const vacancy = isNaN(_vac)  ? defaultVacancy : _vac;
  const mgmtPct = s.selfManage ? 0 : (parseFloat(s.mgmtRate) || 10);
  const _maint  = parseFloat(s.maintenance);                 const maint   = isNaN(_maint) ? 1.0 : _maint;
  const _capex  = parseFloat(s.capex);                       const capex   = isNaN(_capex) ? defaultCapex : _capex;
  const appRate = parseFloat(s.appreciationRate) || 3.5;
  const rentGrowthRate = (s.rentGrowthRate != null ? parseFloat(s.rentGrowthRate) : 2.5) / 100;
  const goal   = s.investorGoal || 'balanced';
  const hoa    = parseFloat(s.hoaMonthly) || 0;
  const closingPct = parseFloat(s.closingCostPct) || 0;

  const pmiRate = getPmiRateForDown(downPct) / 100;
  const pmi = (!s.cashPurchase && downPct < 20) ? (price * (1 - downPct / 100)) * pmiRate / 12 : 0;

  let mortgage = 0;
  if (!s.cashPurchase && price > 0) {
    const principal = price * (1 - downPct / 100);
    const r = rate / 12 / 100;
    const n = termYrs * 12;
    if (loanType === 'interest_only') {
      mortgage = principal * (rate / 100 / 12);
    } else {
      mortgage = r > 0 ? principal * (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1) : principal / n;
    }
  }

  const taxMo         = price * (taxRate / 100) / 12;
  const insMo         = price * (insRate / 100) / 12;
  const vacMo         = rent * (vacancy / 100);
  const effectiveRent = rent - vacMo;
  const mgmtMo        = effectiveRent * (mgmtPct / 100);
  const maintMo       = price * (maint / 100) / 12;
  const total         = mortgage + taxMo + insMo + vacMo + mgmtMo + maintMo + capex + hoa + pmi;
  const cf            = rent - total;

  const downAmt      = s.cashPurchase ? price : price * (downPct / 100);
  const closingAmt   = price * (closingPct / 100);
  const cashInvested = downAmt + closingAmt;
  const coc          = cashInvested > 0 ? (cf * 12 / cashInvested) * 100 : 0;

  const noi         = rent - vacMo - taxMo - insMo - mgmtMo - maintMo - capex - hoa;
  const noiAnnual   = noi * 12;
  const capRate     = price > 0 ? (noiAnnual / price) * 100 : 0;
  const oneRule     = price > 0 ? (rent / price) * 100 : 0;
  const grm         = rent > 0 ? price / (rent * 12) : 0;
  const annualDebtService = mortgage * 12;
  const dscr        = s.cashPurchase ? null : (annualDebtService > 0 ? noiAnnual / annualDebtService : 0);

  const apprecAmt = price * (Math.pow(1 + appRate / 100, holdYrs) - 1);
  let loanPaydown = 0;
  if (!s.cashPurchase && mortgage > 0 && loanType !== 'interest_only') {
    const principal = price * (1 - downPct / 100);
    const r = rate / 12 / 100;
    let bal = principal;
    for (let i = 0; i < holdMos; i++) {
      const interest = bal * r;
      const principalPaid = mortgage - interest;
      bal -= Math.max(0, principalPaid);
      loanPaydown += Math.max(0, principalPaid);
    }
  }
  const cfHold   = cf * holdMos;
  const totalHold = cfHold + apprecAmt + loanPaydown;

  function calcIRR(initialInvestment, monthlyCFs, terminalValue) {
    if (initialInvestment <= 0) return 0;
    const months = monthlyCFs.length;
    let lo = -0.99 / 12, hi = 2.0 / 12;
    for (let iter = 0; iter < 100; iter++) {
      const mid = (lo + hi) / 2;
      let npv = -initialInvestment;
      for (let t = 0; t < months; t++) {
        npv += monthlyCFs[t] / Math.pow(1 + mid, t + 1);
      }
      npv += terminalValue / Math.pow(1 + mid, months);
      if (npv > 0) lo = mid; else hi = mid;
      if (Math.abs(hi - lo) < 1e-8) break;
    }
    const monthlyIRR = (lo + hi) / 2;
    return (Math.pow(1 + monthlyIRR, 12) - 1) * 100;
  }

  const goingInCapRate           = price > 0 ? Math.max(noiAnnual / price, 0.03) : 0.05;
  const terminalNOI              = noiAnnual * Math.pow(1 + rentGrowthRate, holdYrs);
  const terminalPropertyValue    = goingInCapRate > 0
    ? terminalNOI / goingInCapRate
    : price * Math.pow(1 + appRate / 100, holdYrs);

  let remainingLoanBal = 0;
  if (!s.cashPurchase && mortgage > 0 && loanType !== 'interest_only') {
    const principal0 = price * (1 - downPct / 100);
    const r0 = rate / 12 / 100;
    let bal0 = principal0;
    for (let i = 0; i < holdMos; i++) {
      const interest0 = bal0 * r0;
      bal0 -= Math.max(0, mortgage - interest0);
    }
    remainingLoanBal = Math.max(0, bal0);
  }
  const terminalEquity = s.cashPurchase
    ? terminalPropertyValue
    : Math.max(0, terminalPropertyValue - remainingLoanBal);

  const flatCFs           = Array(holdMos).fill(cf);
  const irrFlat           = cashInvested > 0 ? calcIRR(cashInvested, flatCFs, terminalEquity) : 0;
  const RENT_GROWTH_RATE  = rentGrowthRate;
  const rentGrowthCFs     = Array.from({ length: holdMos }, (_, i) => {
    const yearFrac  = i / 12;
    const grownRent = rent * Math.pow(1 + RENT_GROWTH_RATE, yearFrac);
    const grownVac  = grownRent * (vacancy / 100);
    const grownMgmt = (grownRent - grownVac) * (mgmtPct / 100);
    return grownRent - mortgage - taxMo - insMo - grownVac - grownMgmt - maintMo - capex - hoa - pmi;
  });
  const rentGrowthTotalCF    = rentGrowthCFs.reduce((a, b) => a + b, 0);
  const irrWithRentGrowth    = cashInvested > 0 ? calcIRR(cashInvested, rentGrowthCFs, terminalEquity) : 0;
  const annReturn            = isFinite(irrFlat) ? irrFlat : (cashInvested > 0 ? (totalHold / cashInvested / holdYrs) * 100 : 0);
  const annReturnWithGrowth  = isFinite(irrWithRentGrowth) ? irrWithRentGrowth : null;

  const fixedCosts  = mortgage + taxMo + insMo + maintMo + capex + hoa + pmi;
  const rentMultiplier          = (1 - vacancy / 100) * (1 - mgmtPct / 100);
  const breakEvenRentNeeded     = rentMultiplier > 0 ? fixedCosts / rentMultiplier : fixedCosts;

  function cfAtPrice(p) {
    const prin = s.cashPurchase ? 0 : p * (1 - downPct / 100);
    const r = rate / 12 / 100;
    const n = termYrs * 12;
    const mort = s.cashPurchase ? 0 : (loanType === 'interest_only'
      ? prin * (rate / 100 / 12)
      : (r > 0 ? prin * (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1) : prin / n));
    const pmiP = (!s.cashPurchase && downPct < 20) ? (p * (1 - downPct / 100)) * (getPmiRateForDown(downPct) / 100) / 12 : 0;
    return rent - mort - p * (taxRate / 100) / 12 - p * (insRate / 100) / 12 - vacMo - mgmtMo - p * (maint / 100) / 12 - capex - hoa - pmiP;
  }
  let breakEvenPrice = null;
  if (cf < 0 && price > 0) {
    let lo2 = price * 0.1, hi2 = price;
    for (let i = 0; i < 60; i++) {
      const mid = (lo2 + hi2) / 2;
      if (cfAtPrice(mid) > 0) hi2 = mid; else lo2 = mid;
      if (hi2 - lo2 < 100) break;
    }
    breakEvenPrice = Math.round((lo2 + hi2) / 2 / 1000) * 1000;
  }
  const targetCF                 = cashInvested * 10 / 100 / 12;
  const breakEvenRentFor10CoC    = Math.round((total + targetCF) / 25) * 25;
  const fmtMo                    = n => `$${Math.round(Math.abs(n)).toLocaleString()}`;
  const holdLabel                = `${holdYrs}-Yr`;

  const newBreakdown = (data.expenseBreakdown || []).map(row => {
    if (row.label?.includes('Mortgage'))    return { ...row, monthly: fmtMo(mortgage) };
    if (row.label?.includes('Tax'))         return { ...row, monthly: fmtMo(taxMo) };
    if (row.label?.includes('Insurance'))   return { ...row, monthly: fmtMo(insMo) };
    if (row.label?.includes('Vacancy'))     return { ...row, label: `Vacancy (${vacancy}% = ${fmtMo(vacMo)}/mo)`, monthly: fmtMo(vacMo) };
    if (row.label?.includes('Management'))  return { ...row, monthly: s.selfManage ? '$0' : fmtMo(mgmtMo) };
    if (row.label?.includes('Maintenance')) return { ...row, monthly: fmtMo(maintMo) };
    if (row.label?.includes('CapEx'))       return { ...row, monthly: fmtMo(capex) };
    if (row.label?.includes('HOA'))         return { ...row, monthly: hoa > 0 ? fmtMo(hoa) : '$0' };
    if (row.label?.includes('PMI'))         return { ...row, monthly: pmi > 0 ? fmtMo(pmi) : '$0' };
    if (row.label?.includes('Total'))       return { ...row, monthly: fmtMo(total) };
    return row;
  });
  const hasHoa  = newBreakdown.some(r => r.label?.includes('HOA'));
  const hasPmi  = newBreakdown.some(r => r.label?.includes('PMI'));
  const totalIdx = newBreakdown.findIndex(r => r.label?.includes('Total'));
  const extraRows = [];
  if (!hasHoa && hoa > 0) extraRows.push({ label: 'HOA', monthly: fmtMo(hoa) });
  if (!hasPmi && pmi > 0) extraRows.push({ label: `PMI (${downPct.toFixed(0)}% down)`, monthly: fmtMo(pmi) });
  if (extraRows.length && totalIdx >= 0) newBreakdown.splice(totalIdx, 0, ...extraRows);

  const stCf   = cf > 100 ? 'good' : cf < -50 ? 'bad' : 'neutral';
  const stCoc  = coc >= 10 ? 'good' : coc >= 5 ? 'neutral' : 'bad';
  const stCap  = capRate >= 5 ? 'good' : capRate >= 3 ? 'neutral' : 'bad';
  const stOr   = oneRule >= 1 ? 'good' : oneRule >= 0.8 ? 'neutral' : 'bad';
  const stGrm  = grm <= 12 ? 'good' : grm <= 16 ? 'neutral' : 'bad';
  const stDscr = s.cashPurchase ? 'neutral' : dscr >= 1.25 ? 'good' : dscr >= 1.00 ? 'neutral' : 'bad';
  const stHold = totalHold > 0 ? 'good' : 'bad';

  const newMetrics = (data.keyMetrics || []).map(m => {
    if (m.label === 'Monthly Cash Flow')     return { ...m, value: `${cf >= 0 ? '+' : ''}$${Math.round(cf).toLocaleString()}`,    status: stCf };
    if (m.label === 'Cash-on-Cash')          return { ...m, value: `${coc >= 0 ? '+' : ''}${coc.toFixed(1)}%`,                    status: stCoc };
    if (m.label === 'Cap Rate')              return { ...m, value: `${capRate.toFixed(1)}%`,                                      status: stCap };
    if (m.label?.includes('Total Return'))   return { ...m, label: `${holdLabel} Total Return`, value: `$${Math.round(totalHold / 1000)}k`, status: stHold };
    if (m.label === '1% Rule')               return { ...m, value: `${oneRule.toFixed(2)}%`,                                      status: stOr };
    if (m.label === 'DSCR')                  return { ...m, value: s.cashPurchase ? 'N/A' : dscr.toFixed(2),                      status: stDscr };
    if (m.label === 'GRM')                   return { ...m, value: `${grm.toFixed(1)}x`,                                          status: stGrm };
    return m;
  });

  const newScenarios = [0.85, 1.00, 1.15].map(mult => {
    const r   = Math.round(rent * mult / 25) * 25;
    const v2  = r * (vacancy / 100);
    const m2  = (r - v2) * (mgmtPct / 100);
    const cfS = r - mortgage - taxMo - insMo - v2 - m2 - maintMo - capex - hoa - pmi;
    const cS  = cashInvested > 0 ? (cfS * 12 / cashInvested) * 100 : 0;
    return {
      rent: `$${r.toLocaleString()}/mo`,
      cashflow: `${cfS >= 0 ? '+' : '-'}$${Math.round(Math.abs(cfS)).toLocaleString()}/mo`,
      coc: `${cS >= 0 ? '+' : ''}${cS.toFixed(2)}%`,
      verdict: cfS > 100 ? 'YES' : cfS < -100 ? 'NO' : 'MAYBE',
    };
  });

  const w        = GOAL_WEIGHTS[goal] || GOAL_WEIGHTS.balanced;
  const cfScore  = cf >= 500 ? 92 : cf >= 300 ? 80 : cf >= 100 ? 65 : cf >= 0 ? 50 : cf >= -100 ? 38 : cf >= -300 ? 25 : 10;
  const orScore  = oneRule >= 1.3 ? 92 : oneRule >= 1.1 ? 78 : oneRule >= 1.0 ? 65 : oneRule >= 0.85 ? 48 : oneRule >= 0.7 ? 32 : 15;
  const locScore = (data.scoreBreakdown?.find(s => s.name.includes('Location'))?.score) || 50;
  const mktScore = (data.scoreBreakdown?.find(s => s.name.includes('Market'))?.score)   || 50;
  const llScore  = (data.scoreBreakdown?.find(s => s.name.includes('Landlord'))?.score) || 50;
  const overall  = Math.round(cfScore * w.cashflow + locScore * w.location + orScore * w.onePercent + mktScore * w.market + llScore * w.landlord);
  const verdict  = overall >= 60 ? 'YES' : overall <= 38 ? 'NO' : 'MAYBE';

  return {
    ...data,
    assumedPrice: `$${price.toLocaleString()}`,
    assumedRent:  `$${rent.toLocaleString()}/mo`,
    noi:          `${noi >= 0 ? '+' : '-'}$${Math.round(Math.abs(noi)).toLocaleString()}/mo`,
    noiStatus:    noi > 0 ? 'good' : 'bad',
    breakEvenRent:`$${Math.round(total).toLocaleString()}/mo`,
    dscr:         s.cashPurchase ? 'N/A' : dscr.toFixed(2),
    dscrStatus:   stDscr,
    projection: {
      [`appreciation${holdYrs}yr`]:  `$${Math.round(apprecAmt / 1000)}k`,
      [`loanPaydown${holdYrs}yr`]:    s.cashPurchase ? 'N/A' : `$${Math.round(loanPaydown / 1000)}k`,
      [`cashflow${holdYrs}yr`]:       `${cfHold >= 0 ? '+' : '-'}$${Math.round(Math.abs(cfHold) / 1000)}k`,
      [`totalReturn${holdYrs}yr`]:    `$${Math.round(totalHold / 1000)}k`,
      annualizedReturnPct:            `${annReturn.toFixed(1)}% IRR`,
      rentGrowthIRR:                  annReturnWithGrowth !== null ? `${annReturnWithGrowth.toFixed(1)}% IRR` : null,
      rentGrowthTotalCF:              `${rentGrowthTotalCF >= 0 ? '+' : '-'}$${Math.round(Math.abs(rentGrowthTotalCF) / 1000)}k`,
      cashInvested:                   closingAmt > 0 ? `$${Math.round(cashInvested / 1000)}k (incl. closing)` : `$${Math.round(downAmt / 1000)}k`,
      // Legacy keys — some AI results may still reference these
      appreciation5yr: `$${Math.round(apprecAmt / 1000)}k`,
      loanPaydown5yr:  s.cashPurchase ? 'N/A' : `$${Math.round(loanPaydown / 1000)}k`,
      cashflow5yr:     `${cfHold >= 0 ? '+' : '-'}$${Math.round(Math.abs(cfHold) / 1000)}k`,
      totalReturn5yr:  `$${Math.round(totalHold / 1000)}k`,
    },
    breakEvenIntelligence: {
      currentCF:                    cf,
      currentCoC:                   coc,
      breakEvenRentForPositiveCF:   `$${Math.round(breakEvenRentNeeded).toLocaleString()}/mo`,
      breakEvenRentFor10CoC:        `$${breakEvenRentFor10CoC.toLocaleString()}/mo`,
      breakEvenPrice:               breakEvenPrice ? `$${Math.round(breakEvenPrice / 1000)}k` : null,
      currentRent:                  rent,
      currentPrice:                 price,
      rentGapToPositive:            breakEvenRentNeeded > rent ? `+$${Math.round(breakEvenRentNeeded - rent).toLocaleString()}/mo needed` : null,
      rentGapTo10CoC:               breakEvenRentFor10CoC > rent ? `+$${Math.round(breakEvenRentFor10CoC - rent).toLocaleString()}/mo needed` : null,
      priceGapToPositive:           breakEvenPrice && breakEvenPrice < price ? `-$${Math.round((price - breakEvenPrice) / 1000)}k off ask` : null,
    },
    expenseBreakdown: newBreakdown,
    keyMetrics:       newMetrics,
    rentScenarios:    newScenarios,
    overallScore:     overall,
    verdict,
    verdictSummary:   null,
    narrative:        null,
    _settings: { ...s, downPaymentPct: downPct, interestRate: rate, taxRate, vacancy },
  };
}
