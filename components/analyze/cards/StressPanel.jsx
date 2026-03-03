import { useState, useEffect } from 'react';
import { C, clamp, scoreColor } from '../tokens';
import { Label, Card, Pill, AnimatedBar } from '../InputComponents';
import { getPmiRateForDown, getMarketData } from '../marketHelpers';

// Helper — normalize rent strings for comparison
const normalizeRent = s => (s || '').replace(/\s+/g, '').toLowerCase();

function computeStress(data) {
  const _MD = getMarketData();
  const s = data._settings || {};
  const price = parseFloat((data.assumedPrice||'').replace(/[^0-9.]/g,'')) || 0;
  const rent  = parseFloat((data.assumedRent||'').replace(/[^0-9.]/g,''))  || 0;

  // Determine sensitivity level from independently-recalculated DSCR
  // Do NOT use the AI's returned DSCR string — compute it fresh from current settings
  // so stress test thresholds are always consistent with the actual numbers shown
  const _stressDownPct = s.cashPurchase ? 100 : (parseFloat(s.downPaymentPct) || 20);
  const _stressRate    = s.cashPurchase ? 0   : (parseFloat(s.interestRate) || 6.99);
  const _stressTerm    = parseFloat(s.loanTermYears) || 30;
  const _stressMr      = _stressRate / 12 / 100;
  const _stressN       = _stressTerm * 12;
  const _stressPrin    = price * (1 - _stressDownPct / 100);
  const _stressMortgage = s.cashPurchase || price === 0 ? 0
    : (s.loanType === 'interest_only'
      ? _stressPrin * (_stressRate / 100 / 12)
      : (_stressMr > 0 ? _stressPrin * _stressMr / (1 - Math.pow(1 + _stressMr, -_stressN)) : 0));
  const _stressVac    = (parseFloat(s.vacancy) || 8) / 100;
  const _stressTaxR   = (parseFloat(s.taxRate) || 1.1) / 100;
  const _stressInsR   = (parseFloat(s.insRate) || 0.80) / 100;
  const _stressMaint  = (parseFloat(s.maintenance) || 1.0) / 100;
  const _stressCapex  = parseFloat(s.capex) || Math.round(150 * (_MD.capexPpiMultiplier ?? 1.38));
  const _stressMgmt   = s.selfManage ? 0 : (parseFloat(s.mgmtRate) || 10) / 100;
  const _stressHoa    = parseFloat(s.hoaMonthly) || 0;
  const _stressNOI    = (rent * (1 - _stressVac))
    - (price * _stressTaxR / 12) - (price * _stressInsR / 12)
    - (price * _stressMaint / 12) - _stressCapex
    - ((rent * (1 - _stressVac)) * _stressMgmt) - _stressHoa;
  const _stressAnnualDebt = _stressMortgage * 12;
  const baseDSCR = (s.cashPurchase || _stressAnnualDebt === 0)
    ? 99  // cash purchase: no debt service, treat as very low sensitivity
    : (_stressNOI * 12) / _stressAnnualDebt;
  const sensitivity = baseDSCR >= 1.3 ? 'low' : baseDSCR >= 1.1 ? 'moderate' : 'elevated';
  const rateShock = sensitivity === 'low' ? 0.5 : sensitivity === 'elevated' ? 1.5 : 1.0;
  const rentShock = sensitivity === 'low' ? 3   : sensitivity === 'elevated' ? 8   : 5;

  // Quick cash flow recalc for stress scenarios
  function quickCF(overrides = {}) {
    const p = overrides.price ?? price;
    const r = overrides.rent  ?? rent;
    const downPct = s.cashPurchase ? 100 : ((overrides.downPct ?? parseFloat(s.downPaymentPct)) || 20);
    const rate    = s.cashPurchase ? 0   : ((overrides.rate   ?? parseFloat(s.interestRate)) || 6.99);
    const loanType = s.loanType || '30yr_fixed';
    const termYrs = parseFloat(s.loanTermYears) || 30;
    const _stPropType  = s.propertyType || 'sfr';
    const _stDefVac    = (_stPropType === 'sfr' || _stPropType === 'condo') ? 8 : 5;
    const _stDefCapex  = _stPropType === 'mfr' ? 300 : _stPropType === 'duplex' ? 240 : 150;
    const vac     = (parseFloat(s.vacancy) || _stDefVac) / 100;
    const maint   = (parseFloat(s.maintenance) || 1.0) / 100;
    const capex   = parseFloat(s.capex) || _stDefCapex;
    const taxR    = (parseFloat(s.taxRate) || 1.1) / 100;
    const insR    = (parseFloat(s.insRate) || 0.80) / 100;
    const mgmtPct = s.selfManage ? 0 : (parseFloat(s.mgmtRate) || 10) / 100;
    const hoa     = parseFloat(s.hoaMonthly) || 0;
    const pmi     = (!s.cashPurchase && downPct < 20) ? (p * (1 - downPct/100)) * (getPmiRateForDown(downPct)/100) / 12 : 0;

    const effectiveRent = r * (1 - vac);
    const propTax    = (p * taxR) / 12;
    const ins        = (p * insR) / 12;
    const maintAmt   = p * maint / 12;  // % of price annualized, not % of rent
    const mgmt       = effectiveRent * mgmtPct;
    const opex       = propTax + ins + maintAmt + capex + mgmt + hoa;

    let mortgage = 0;
    if (!s.cashPurchase && p > 0) {
      const principal = p * (1 - downPct/100);
      const mr = rate/12/100;
      const n  = termYrs * 12;
      if (loanType === 'interest_only') {
        mortgage = principal * (rate/100/12);
      } else {
        mortgage = mr > 0 ? (principal * mr) / (1 - Math.pow(1+mr,-n)) : 0;
      }
    }
    return Math.round(effectiveRent - opex - mortgage - pmi);
  }

  const baseCF   = quickCF();
  const rateCF   = quickCF({rate: (parseFloat(s.interestRate)||6.99) + rateShock});
  const rentCF   = quickCF({rent: rent * (1 - rentShock/100)});

  return { baseCF, rateCF, rentCF, rateShock, rentShock, sensitivity };
}

// --- Stress Panel -------------------------------------------------------------

import { useState, useEffect } from 'react';
import { C, VERDICT_CFG, clamp, scoreColor } from './tokens';
import { getTreasuryRate, getSP500Return, getMarketData, getPmiRateForDown } from './marketHelpers';
import { InlineEdit, Label, Card, Pill, AnimatedBar } from './InputComponents';

// Helper — verdictColor used by ProsAndCons
const verdictColor = v => v === 'YES' ? C.green : v === 'NO' ? C.red : C.amber;

// Helper — normalize rent strings for comparison
const normalizeRent = s => (s || '').replace(/\s+/g, '').toLowerCase();

function computeStress(data) {
  const _MD = getMarketData();
  const s = data._settings || {};
  const price = parseFloat((data.assumedPrice||'').replace(/[^0-9.]/g,'')) || 0;
  const rent  = parseFloat((data.assumedRent||'').replace(/[^0-9.]/g,''))  || 0;

  // Determine sensitivity level from independently-recalculated DSCR
  // Do NOT use the AI's returned DSCR string — compute it fresh from current settings
  // so stress test thresholds are always consistent with the actual numbers shown
  const _stressDownPct = s.cashPurchase ? 100 : (parseFloat(s.downPaymentPct) || 20);
  const _stressRate    = s.cashPurchase ? 0   : (parseFloat(s.interestRate) || 6.99);
  const _stressTerm    = parseFloat(s.loanTermYears) || 30;
  const _stressMr      = _stressRate / 12 / 100;
  const _stressN       = _stressTerm * 12;
  const _stressPrin    = price * (1 - _stressDownPct / 100);
  const _stressMortgage = s.cashPurchase || price === 0 ? 0
    : (s.loanType === 'interest_only'
      ? _stressPrin * (_stressRate / 100 / 12)
      : (_stressMr > 0 ? _stressPrin * _stressMr / (1 - Math.pow(1 + _stressMr, -_stressN)) : 0));
  const _stressVac    = (parseFloat(s.vacancy) || 8) / 100;
  const _stressTaxR   = (parseFloat(s.taxRate) || 1.1) / 100;
  const _stressInsR   = (parseFloat(s.insRate) || 0.80) / 100;
  const _stressMaint  = (parseFloat(s.maintenance) || 1.0) / 100;
  const _stressCapex  = parseFloat(s.capex) || Math.round(150 * (_MD.capexPpiMultiplier ?? 1.38));
  const _stressMgmt   = s.selfManage ? 0 : (parseFloat(s.mgmtRate) || 10) / 100;
  const _stressHoa    = parseFloat(s.hoaMonthly) || 0;
  const _stressNOI    = (rent * (1 - _stressVac))
    - (price * _stressTaxR / 12) - (price * _stressInsR / 12)
    - (price * _stressMaint / 12) - _stressCapex
    - ((rent * (1 - _stressVac)) * _stressMgmt) - _stressHoa;
  const _stressAnnualDebt = _stressMortgage * 12;
  const baseDSCR = (s.cashPurchase || _stressAnnualDebt === 0)
    ? 99  // cash purchase: no debt service, treat as very low sensitivity
    : (_stressNOI * 12) / _stressAnnualDebt;
  const sensitivity = baseDSCR >= 1.3 ? 'low' : baseDSCR >= 1.1 ? 'moderate' : 'elevated';
  const rateShock = sensitivity === 'low' ? 0.5 : sensitivity === 'elevated' ? 1.5 : 1.0;
  const rentShock = sensitivity === 'low' ? 3   : sensitivity === 'elevated' ? 8   : 5;

  // Quick cash flow recalc for stress scenarios
  function quickCF(overrides = {}) {
    const p = overrides.price ?? price;
    const r = overrides.rent  ?? rent;
    const downPct = s.cashPurchase ? 100 : ((overrides.downPct ?? parseFloat(s.downPaymentPct)) || 20);
    const rate    = s.cashPurchase ? 0   : ((overrides.rate   ?? parseFloat(s.interestRate)) || 6.99);
    const loanType = s.loanType || '30yr_fixed';
    const termYrs = parseFloat(s.loanTermYears) || 30;
    const _stPropType  = s.propertyType || 'sfr';
    const _stDefVac    = (_stPropType === 'sfr' || _stPropType === 'condo') ? 8 : 5;
    const _stDefCapex  = _stPropType === 'mfr' ? 300 : _stPropType === 'duplex' ? 240 : 150;
    const vac     = (parseFloat(s.vacancy) || _stDefVac) / 100;
    const maint   = (parseFloat(s.maintenance) || 1.0) / 100;
    const capex   = parseFloat(s.capex) || _stDefCapex;
    const taxR    = (parseFloat(s.taxRate) || 1.1) / 100;
    const insR    = (parseFloat(s.insRate) || 0.80) / 100;
    const mgmtPct = s.selfManage ? 0 : (parseFloat(s.mgmtRate) || 10) / 100;
    const hoa     = parseFloat(s.hoaMonthly) || 0;
    const pmi     = (!s.cashPurchase && downPct < 20) ? (p * (1 - downPct/100)) * (getPmiRateForDown(downPct)/100) / 12 : 0;

    const effectiveRent = r * (1 - vac);
    const propTax    = (p * taxR) / 12;
    const ins        = (p * insR) / 12;
    const maintAmt   = p * maint / 12;  // % of price annualized, not % of rent
    const mgmt       = effectiveRent * mgmtPct;
    const opex       = propTax + ins + maintAmt + capex + mgmt + hoa;

    let mortgage = 0;
    if (!s.cashPurchase && p > 0) {
      const principal = p * (1 - downPct/100);
      const mr = rate/12/100;
      const n  = termYrs * 12;
      if (loanType === 'interest_only') {
        mortgage = principal * (rate/100/12);
      } else {
        mortgage = mr > 0 ? (principal * mr) / (1 - Math.pow(1+mr,-n)) : 0;
      }
    }
    return Math.round(effectiveRent - opex - mortgage - pmi);
  }

  const baseCF   = quickCF();
  const rateCF   = quickCF({rate: (parseFloat(s.interestRate)||6.99) + rateShock});
  const rentCF   = quickCF({rent: rent * (1 - rentShock/100)});

  return { baseCF, rateCF, rentCF, rateShock, rentShock, sensitivity };
}

// --- Stress Panel -------------------------------------------------------------
export function StressPanel({data}) {
  const stress = computeStress(data);
  const fmt = n => (n >= 0 ? '+' : '') + '$' + Math.abs(n).toLocaleString() + '/mo';
  const clr = n => n >= 200 ? C.green : n >= 0 ? C.amber : C.red;
  const sensitivity = {low:'Low',moderate:'Moderate',elevated:'Elevated'}[stress.sensitivity];
  const sensitivityColor = {low:C.green,moderate:C.amber,elevated:C.red}[stress.sensitivity];

  const holdYrsStress = data._settings?.holdingYears || 5;
  const holdMosStress = holdYrsStress * 12;
  const baseCFNum = stress.baseCF;
  const scenarios = [
    {label:'Base Case',          value:stress.baseCF,  desc:'Current assumptions', cumulative: null},
    {label:`+${stress.rateShock}% Rate Shock`,  value:stress.rateCF,  desc:`${(parseFloat(data._settings?.interestRate)||6.99)+stress.rateShock}% interest rate`,
      cumulative: Math.round((stress.rateCF - baseCFNum) * holdMosStress)},
    {label:`-${stress.rentShock}% Rent Drop`,   value:stress.rentCF,  desc:`$${Math.round((parseFloat((data.assumedRent||'').replace(/[^0-9.]/g,''))||0)*(1-stress.rentShock/100))}/mo`,
      cumulative: Math.round((stress.rentCF - baseCFNum) * holdMosStress)},
  ];

  return (
    <Card style={{marginBottom:14}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:18}}>
        <div>
          <Label>Stress Test</Label>
          <div style={{fontSize:11,color:C.muted,marginTop:2}}>How this deal holds under pressure</div>
        </div>
        <div style={{textAlign:'right'}}>
          <div style={{fontSize:10,color:C.muted,textTransform:'uppercase',letterSpacing:'0.08em',marginBottom:2}}>Sensitivity</div>
          <div style={{fontSize:13,fontWeight:700,color:sensitivityColor}}>{sensitivity}</div>
        </div>
      </div>
      <div style={{display:'flex',flexDirection:'column',gap:10}}>
        {scenarios.map((sc,i)=>{
          const c = clr(sc.value);
          const pct = Math.max(0, Math.min(100, (sc.value + 800) / 13));
          return (
            <div key={i} style={{background:C.soft,borderRadius:10,padding:'12px 16px'}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:6}}>
                <div>
                  <span style={{fontSize:12.5,fontWeight:600,color:C.text}}>{sc.label}</span>
                  <span style={{fontSize:11,color:C.muted,marginLeft:8}}>{sc.desc}</span>
                </div>
                <div style={{textAlign:'right'}}>
                  <span style={{fontSize:15,fontWeight:700,color:c,fontVariantNumeric:'tabular-nums'}}>{fmt(sc.value)}</span>
                  {sc.cumulative != null && (
                    <div style={{fontSize:10,color:sc.cumulative < 0 ? C.red : C.muted,marginTop:1}}>
                      {sc.cumulative < 0 ? '-' : '+'}${Math.abs(sc.cumulative).toLocaleString()} over {holdYrsStress}yr
                    </div>
                  )}
                </div>
              </div>
              <div style={{height:4,background:C.border,borderRadius:2,overflow:'hidden'}}>
                <div style={{height:'100%',width:`${pct}%`,background:c,borderRadius:2,transition:'width 1s ease'}}/>
              </div>
            </div>
          );
        })}
      </div>
      {stress.rateCF < 0 && (
        <div style={{marginTop:12,padding:'9px 13px',background:C.redBg,border:`1px solid ${C.redBorder}`,borderRadius:8,fontSize:11.5,color:C.red,lineHeight:1.5}}>
          ⚠ Cash flow turns negative with a {stress.rateShock}% rate increase. Review leverage before committing.
        </div>
      )}
      {stress.rentCF < 0 && (
        <div style={{marginTop:8,padding:'9px 13px',background:C.amberBg,border:`1px solid ${C.amberBorder}`,borderRadius:8,fontSize:11.5,color:C.amber,lineHeight:1.5}}>
          ⚠ A {stress.rentShock}% rent decline would flip this deal negative. Ensure rent assumptions are conservative.
        </div>
      )}
    </Card>
  );
}

// --- NewAnalysisBtn - two-step confirm to avoid native confirm() dialog -------
function NewAnalysisBtn({onReset}) {
  const [confirming, setConfirming] = useState(false);
  if (confirming) {
    return (
      <div style={{display:'flex',gap:6,alignItems:'center'}}>
        <span style={{fontSize:11.5,color:C.amber,fontWeight:600}}>Discard edits?</span>
        <button onClick={onReset} style={{fontSize:12,color:'#fff',background:C.amber,border:'none',borderRadius:8,padding:'6px 12px',cursor:'pointer',fontFamily:'inherit'}}>Yes</button>
        <button onClick={()=>setConfirming(false)} style={{fontSize:12,color:C.muted,background:'none',border:`1px solid ${C.border}`,borderRadius:8,padding:'6px 10px',cursor:'pointer',fontFamily:'inherit'}}>Cancel</button>
      </div>
    );
  }
  return (
    <button onClick={()=>setConfirming(true)} style={{fontSize:12,color:C.muted,background:'none',border:`1px solid ${C.border}`,borderRadius:8,padding:'6px 14px',cursor:'pointer',fontFamily:'inherit',whiteSpace:'nowrap'}}>New Analysis</button>
  );
}

