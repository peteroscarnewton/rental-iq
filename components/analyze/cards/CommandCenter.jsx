import { useState, useEffect } from 'react';
import { C, clamp, scoreColor } from '../tokens';
import { Label, Card, Pill, AnimatedBar } from '../InputComponents';
import { InlineEdit } from '../InputComponents';

export function CommandCenter({data, onRecalc, onReset, onRerunAI, isEdited}) {
  const freshness = data._marketFreshness || {};
  const ratesDate = freshness.mortgageRates ? new Date(freshness.mortgageRates).toLocaleDateString('en-US',{month:'short',day:'numeric'}) : null;
  const v  = (data.verdict||'MAYBE').toUpperCase();
  const vc = VERDICT_CFG[v]||VERDICT_CFG.MAYBE;
  const s  = data._settings||{};
  const score = parseInt(data.overallScore,10)||0;
  const cf = data.keyMetrics?.find(m=>m.label==='Monthly Cash Flow');
  const coc= data.keyMetrics?.find(m=>m.label==='Cash-on-Cash');
  const ret= data.keyMetrics?.find(m=>m.label?.includes('Total Return'));
  const holdYrs = s.holdingYears || 5;

  const price = (data.assumedPrice||'').replace(/[^0-9.]/g,'');
  const rent  = (data.assumedRent||'').replace(/[^0-9.]/g,'');

  function edit(key,val) { onRecalc({[key]:val}); }

  const scoreColor = score>=70?C.green:score>=50?C.amber:C.red;

  return (
    <div style={{background:C.white,border:`1px solid ${C.border}`,borderRadius:14,padding:'32px 28px 24px',marginBottom:14,boxShadow:C.shadow,borderLeft:`4px solid ${vc.color}`}}>

      {/* VERDICT - dominant, full-width statement */}
      <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',marginBottom:28}}>
        <div>
          {/* The verdict word - biggest thing on screen */}
          <div className="riq-verdict" style={{fontSize:54,fontWeight:800,letterSpacing:'-0.04em',color:vc.color,lineHeight:1,marginBottom:8,fontFamily:"'DM Sans',system-ui,sans-serif"}}>{vc.label}</div>
          <div style={{fontSize:14,color:C.muted,lineHeight:1.5,maxWidth:380}}>
            {isEdited ? (
              <span style={{fontSize:13,color:C.amber,fontStyle:'italic'}}>Re-run the AI to get an updated verdict summary →</span>
            ) : (data.verdictSummary||vc.sub)}
          </div>
        </div>
        <div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:6,flexShrink:0}}>
          {isEdited ? (
            <NewAnalysisBtn onReset={onReset} />
          ) : (
            <button onClick={onReset} style={{fontSize:12,color:C.muted,background:'none',border:`1px solid ${C.border}`,borderRadius:8,padding:'6px 14px',cursor:'pointer',fontFamily:'inherit',whiteSpace:'nowrap'}}>New Analysis</button>
          )}
          {/* Score - secondary, below the reset */}
          <div style={{textAlign:'right'}}>
            <div style={{fontSize:10,color:C.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:2}}>RentalIQ Score</div>
            <div style={{fontSize:30,fontWeight:700,color:scoreColor,lineHeight:1}}>{score}<span style={{fontSize:14,color:C.muted,fontWeight:400}}>/100</span></div>
          </div>
        </div>
      </div>

      {/* Market data freshness badge */}
      {ratesDate && (
        <div style={{marginBottom:14,display:'flex',alignItems:'center',gap:6}}>
          <div style={{width:6,height:6,borderRadius:'50%',background:C.green,flexShrink:0}}/>
          <span style={{fontSize:11,color:C.muted}}>
            Rates as of {ratesDate} · HUD · FRED · BLS
          </span>
        </div>
      )}

      {/* 3 headline metrics */}
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:10,marginBottom:20}} className="riq-g3">
        {[
          {label:'Cash Flow/mo',   metric:cf,  big:true},
          {label:'Cash-on-Cash',   metric:coc, big:false},
          {label:`${holdYrs}-Yr Return`,  metric:ret, big:false},
        ].map(({label,metric,big},i)=>{
          if(!metric) return null;
          const c=metric.status==='good'?C.green:metric.status==='bad'?C.red:C.amber;
          return (
            <div key={i} style={{background:C.soft,borderRadius:12,padding:'14px 16px'}}>
              <div style={{fontSize:10,fontWeight:600,letterSpacing:'0.09em',textTransform:'uppercase',color:C.muted,marginBottom:6}}>{label}</div>
              <div style={{fontFamily:"'Instrument Serif',Georgia,serif",fontSize:big?28:21,color:c,lineHeight:1}}>{metric.value}</div>
            </div>
          );
        })}
      </div>

      {/* Inline edit controls */}
      <div style={{borderTop:`1px solid ${C.border}`,paddingTop:16}}>
        <div style={{fontSize:10,fontWeight:600,letterSpacing:'0.09em',textTransform:'uppercase',color:C.muted,marginBottom:12}}>
          Edit inputs - results update instantly
        </div>
        <div style={{display:'flex',flexWrap:'wrap',gap:16,alignItems:'flex-end'}}>
          <div>
            <div style={{fontSize:10,color:C.muted,marginBottom:4,textTransform:'uppercase',letterSpacing:'0.08em'}}>Price</div>
            <div style={{color:C.text}}><InlineEdit value={price} onChange={v=>edit('price',v)} prefix="$" large={false}/></div>
          </div>
          <div>
            <div style={{fontSize:10,color:C.muted,marginBottom:4,textTransform:'uppercase',letterSpacing:'0.08em'}}>Rent/mo</div>
            <div style={{color:C.text}}><InlineEdit value={rent} onChange={v=>edit('rent',v)} prefix="$" large={false}/></div>
          </div>
          {!s.cashPurchase&&(
            <>
              <div>
                <div style={{fontSize:10,color:C.muted,marginBottom:4,textTransform:'uppercase',letterSpacing:'0.08em'}}>Down</div>
                <div style={{color:C.text}}><InlineEdit value={String(s.downPaymentPct||20)} onChange={v=>edit('downPaymentPct',v)} suffix="%" large={false}/></div>
              </div>
              <div>
                <div style={{fontSize:10,color:C.muted,marginBottom:4,textTransform:'uppercase',letterSpacing:'0.08em'}}>Rate</div>
                <div style={{color:C.text}}><InlineEdit value={String(s.interestRate||6.99)} onChange={v=>edit('interestRate',v)} suffix="%" large={false}/></div>
              </div>
            </>
          )}
          <div>
            <div style={{fontSize:10,color:C.muted,marginBottom:4,textTransform:'uppercase',letterSpacing:'0.08em'}}>Tax rate</div>
            <div style={{color:C.text}}><InlineEdit value={String((s.taxRate||1.1).toFixed(2))} onChange={v=>edit('taxRate',v)} suffix="%/yr" large={false}/></div>
          </div>
        </div>

        {/* Stale analysis banner - prominent CTA after any edit */}
        {isEdited && (
          <div style={{marginTop:16,background:'linear-gradient(135deg,#fffbeb 0%,#fef3c7 100%)',border:`2px solid ${C.amberBorder}`,borderRadius:12,padding:'14px 16px'}}>
            <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:12,flexWrap:'wrap'}}>
              <div>
                <div style={{fontSize:12,fontWeight:700,color:C.amber,marginBottom:4,display:'flex',alignItems:'center',gap:6}}>
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <circle cx="7" cy="7" r="6" stroke="#92400e" strokeWidth="1.4"/>
                    <path d="M7 4v3.5M7 9.5v.5" stroke="#92400e" strokeWidth="1.4" strokeLinecap="round"/>
                  </svg>
                  Numbers edited — verdict &amp; narrative are from the original scenario
                </div>
                <div style={{fontSize:11.5,color:'#92400e',lineHeight:1.5}}>
                  The financials above are live. Re-run the AI to get an updated verdict, narrative, and pros/cons for this exact scenario.
                </div>
              </div>
              <button onClick={onRerunAI}
                style={{fontSize:13,fontWeight:700,color:'#fff',background:C.amber,border:'none',borderRadius:10,padding:'10px 18px',cursor:'pointer',fontFamily:'inherit',whiteSpace:'nowrap',flexShrink:0,boxShadow:'0 2px 8px rgba(180,83,9,0.3)'}}>
                ↻ Re-run AI analysis
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

