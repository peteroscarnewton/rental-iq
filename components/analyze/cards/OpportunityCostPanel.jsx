import { useState, useEffect } from 'react';
import { C, clamp, scoreColor } from '../tokens';
import { Label, Card, Pill, AnimatedBar } from '../InputComponents';
import { getTreasuryRate, getSP500Return } from '../marketHelpers';

export function OpportunityCostPanel({data, benchmarks}) {
  const p = data.projection;
  const s = data._settings || {};
  if (!p?.annualizedReturnPct) return null;

  const holdYrs  = s.holdingYears || 5;
  const irrStr   = p.annualizedReturnPct || '';
  const dealIRR  = parseFloat(irrStr.replace('%',''));
  if (isNaN(dealIRR)) return null;

  // Use React state benchmarks prop (live, re-renders on fetch) rather than _MD global
  const b        = benchmarks || {};
  const treasury = b.treasuryYield ?? getTreasuryRate();
  const sp10yr   = b.sp500_10yr   ?? getSP500Return(10);
  const sp5yr    = b.sp500_5yr    ?? getSP500Return(5);

  const spread    = Math.round((dealIRR - treasury) * 10) / 10;
  const vsSP10yr  = Math.round((dealIRR - sp10yr) * 10) / 10;

  const beatsIndex = dealIRR >= sp10yr;
  const beatsTreasury = dealIRR >= treasury;

  // Color the deal IRR relative to benchmarks
  const irrColor = beatsIndex ? C.green : (beatsTreasury ? C.amber : C.red);

  return (
    <Card style={{border:`1px solid ${C.border}`,marginBottom:14}}>
      <Label>Opportunity Cost Comparison</Label>
      <div style={{fontSize:12.5,color:C.muted,marginBottom:14,lineHeight:1.5}}>
        Your ${s.cashPurchase ? 'purchase price' : `${s.downPaymentPct}% down payment`} could alternatively be invested in:
      </div>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:10,marginBottom:14}} className="riq-g3">
        {[
          {label:'This Deal (IRR)', value:`${dealIRR.toFixed(1)}%/yr`, color:irrColor, note:`${holdYrs}-yr hold IRR`, hero:true},
          {label:'S&P 500 / SPY', value:`${sp10yr}%/yr`, color:C.blue, note:'10-yr trailing CAGR (FRED)'},
          {label:'10-Yr Treasury', value:`${treasury}%/yr`, color:C.muted, note:'Risk-free rate (FRED DGS10)'},
        ].map((item, i) => (
          <div key={i} style={{background:item.hero?irrColor+'12':C.soft,borderRadius:12,padding:'14px 16px',border:item.hero?`2px solid ${irrColor}30`:'1px solid '+C.border}}>
            <div style={{fontSize:10,color:C.muted,textTransform:'uppercase',letterSpacing:'0.08em',marginBottom:6}}>{item.label}</div>
            <div style={{fontFamily:"'Instrument Serif',Georgia,serif",fontSize:22,fontWeight:700,color:item.color,lineHeight:1}}>{item.value}</div>
            <div style={{fontSize:11,color:C.muted,marginTop:5}}>{item.note}</div>
          </div>
        ))}
      </div>
      <div style={{fontSize:12.5,color:C.textBody,lineHeight:1.7,background:C.soft,borderRadius:10,padding:'12px 14px'}}>
        {beatsIndex
          ? <>✅ This deal <strong style={{color:C.green}}>{vsSP10yr > 0 ? 'outperforms' : 'matches'} the S&P 500 by {Math.abs(vsSP10yr).toFixed(1)}pp</strong> per year on IRR. Real estate premium vs Treasury: <strong style={{color:C.green}}>{spread > 0 ? '+':''}{spread}pp</strong>.</>
          : beatsTreasury
          ? <>⚠️ This deal <strong style={{color:C.amber}}>beats the risk-free rate (+{spread}pp)</strong> but trails the S&P 500 by {Math.abs(vsSP10yr).toFixed(1)}pp/yr. Consider if leverage, depreciation, or appreciation gap closes this. </>
          : <>🔴 This deal trails <strong style={{color:C.red}}>both the Treasury ({spread}pp below) and the S&P 500</strong>. The spreadsheet only makes sense if appreciation assumptions are conservative or you expect rent growth to improve returns significantly.</>
        }
      </div>
      <div style={{marginTop:10,fontSize:11,color:C.muted}}>
        S&amp;P 500 returns are trailing realized CAGRs from FRED, not forward projections. Past performance does not guarantee future results.{' '}
        Treasury yield is the 10yr constant maturity rate from FRED/DGS10.
        {(b.treasuryAsOf || b.sp500AsOf) &&
          <> Data as of: {b.treasuryAsOf || b.sp500AsOf}.</>}
      </div>
    </Card>
  );
}

// --- Flood Risk Card (Phase 6) -------------------------------------------------
// Shows FEMA flood zone, insurance requirement, and estimated cost impact.
// Fetched asynchronously after analysis via /api/flood-risk.
