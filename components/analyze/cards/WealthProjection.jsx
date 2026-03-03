import { useState, useEffect } from 'react';
import { C, clamp, scoreColor } from '../tokens';
import { Label, Card, Pill, AnimatedBar } from '../InputComponents';

export function WealthProjection({data}) {
  const p = data.projection;
  if (!p) return null;
  const s = data._settings||{}; 
  const holdYrs = s.holdingYears || 5;
  const holdLabel = `${holdYrs}-Year`;
  // Try dynamic key first, fall back to legacy 5yr keys
  const totalReturn    = p[`totalReturn${holdYrs}yr`]    || p.totalReturn5yr;
  const cfReturn       = p[`cashflow${holdYrs}yr`]       || p.cashflow5yr;
  const apprecReturn   = p[`appreciation${holdYrs}yr`]   || p.appreciation5yr;
  const loanPayReturn  = p[`loanPaydown${holdYrs}yr`]    || p.loanPaydown5yr;
  const isGood = totalReturn && !totalReturn.startsWith('-');
  const hasRentGrowthIRR = p.rentGrowthIRR && p.rentGrowthIRR !== p.annualizedReturnPct;

  return (
    <Card style={{border:`1px solid ${isGood?C.greenBorder:C.border}`,background:isGood?C.greenBg:C.white}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:16}}>
        <div>
          <Label>{holdLabel} Wealth Projection</Label>
          <div style={{fontFamily:"'Instrument Serif',Georgia,serif",fontSize:42,fontWeight:800,letterSpacing:'-0.04em',color:isGood?C.green:C.red,lineHeight:1}}>{totalReturn}</div>
          <div style={{fontSize:13,color:C.muted,marginTop:4}}>
            total return on {p.cashInvested} invested
            {p.annualizedReturnPct && (
              <span style={{marginLeft:6,background:isGood?C.greenBorder:C.border,borderRadius:6,padding:'2px 7px',fontSize:11,fontWeight:700,color:isGood?C.green:C.text}}
                title="Conservative IRR - assumes flat rent, no growth">
                {p.annualizedReturnPct}
              </span>
            )}
            {hasRentGrowthIRR && (
              <span style={{marginLeft:5,background:C.blueBg,borderRadius:6,padding:'2px 7px',fontSize:11,fontWeight:700,color:C.blue,border:`1px solid ${C.blueBorder}`}}
                title={`IRR with ${s.rentGrowthRate != null ? s.rentGrowthRate : 2.5}%/yr rent growth${s.rentGrowthRate != null ? ' (your assumption)' : ' - historically conservative'}`}>
                {p.rentGrowthIRR} w/ rent growth
              </span>
            )}
          </div>
        </div>
        {data.appreciationRate&&(
          <div style={{textAlign:'right',flexShrink:0}}>
            <div style={{fontSize:10,color:C.muted,textTransform:'uppercase',letterSpacing:'0.08em'}}>Mkt. appreciation</div>
            <div style={{fontSize:18,fontWeight:700,color:C.text}}>{data.appreciationRate}%/yr</div>
          </div>
        )}
      </div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:10}} className="riq-g3">
        {[
          {label:'Appreciation', value:apprecReturn,  color:C.green},
          {label:'Loan paydown', value:loanPayReturn,  color:C.blue},
          {label:'Cash flow',    value:cfReturn,       color:s.cashPurchase?C.green:undefined},
        ].map((item,i)=>(
          <div key={i} style={{background:'rgba(255,255,255,0.7)',borderRadius:12,padding:'12px 14px'}}>
            <div style={{fontSize:10,color:C.muted,textTransform:'uppercase',letterSpacing:'0.08em',marginBottom:5}}>{item.label}</div>
            <div style={{fontFamily:"'Instrument Serif',Georgia,serif",fontSize:20,color:item.color||C.text}}>{item.value}</div>
          </div>
        ))}
      </div>
      {!s.cashPurchase&&(
        <div style={{marginTop:12,fontSize:12,color:isGood?C.green:C.muted,lineHeight:1.6}}>
          Leverage: you control {data.assumedPrice} of asset with only {p.cashInvested}. Market appreciation applies to the <em>full</em> value - not just your down payment.
        </div>
      )}
      <div style={{marginTop:8,fontSize:11,color:C.muted,lineHeight:1.5,borderTop:`1px solid ${C.border}`,paddingTop:8}}>
        Base IRR assumes flat rent. The <span style={{color:C.blue,fontWeight:600}}>rent growth IRR</span> models {s.rentGrowthRate != null ? `${s.rentGrowthRate}` : '2.5'}%/yr increases - {s.rentGrowthRate != null ? 'your assumption' : 'historically conservative for most US markets'}.
      </div>

    </Card>
  );
}


// --- Opportunity Cost Panel (Phase 5) -----------------------------------------
// Compares this deal's IRR to live Treasury yield and S&P 500 trailing returns.
// Uses _MD global which is updated by the market-data fetch on mount.
