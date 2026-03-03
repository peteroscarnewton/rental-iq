import { useState, useEffect } from 'react';
import { C, clamp, scoreColor } from '../tokens';
import { Label, Card, Pill, AnimatedBar } from '../InputComponents';

export function AssumptionsBadge({settings}) {
  if (!settings) return null;
  const mc=settings.mode==='conservative'?C.amber:settings.mode==='aggressive'?C.green:C.blue;
  return (
    <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:14}}>
      <Pill color={mc}>{(settings.mode||'moderate')[0].toUpperCase()+(settings.mode||'moderate').slice(1)}</Pill>
      <Pill>Tax {settings.taxRate?.toFixed(2)}%{settings.stateCode?` (${settings.stateCode})`:''}{settings.taxUserProvided?' ✓':''}</Pill>
      <Pill>Ins {settings.insRate?.toFixed(2)}%</Pill>
      <Pill>Vac {settings.vacancy}%</Pill>
      <Pill>{settings.selfManage?'Self-managed':'Managed '+settings.mgmtRate+'%'}</Pill>
      <Pill>{settings.cashPurchase?'All Cash':`${settings.downPaymentPct}% @ ${settings.interestRate}% (${({
        '30yr_fixed':'30yr','15yr_fixed':'15yr','5_1_arm':'ARM','interest_only':'IO',
      }[settings.loanType]||'30yr')})`}</Pill>
      {settings.holdingYears && <Pill>{settings.holdingYears}yr hold</Pill>}
      {settings.hoaMonthly>0 && <Pill>HOA ${settings.hoaMonthly}/mo</Pill>}
      {!settings.cashPurchase && (parseFloat(settings.downPaymentPct)||20)<20 && <Pill style={{background:'#fff8ed',color:'#b45309',border:'1px solid #fde68a'}}>PMI {(settings.pmiAnnualRate ?? getPmiRateForDown(parseFloat(settings.downPaymentPct)||20)).toFixed(2)}%/yr</Pill>}
    </div>
  );
}

