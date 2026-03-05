import { useState, useEffect } from 'react';
import { C, clamp, scoreColor } from '../tokens';
import { Label, Card, AnimatedBar } from '../InputComponents';
import { ScoreRing } from './ScoreRing';

export function ScoreBreakdown({data, isEdited}) {
  const score      = clamp(parseInt(data.overallScore, 10) || 0, 0, 100);
  const s          = data._settings || {};

  const frozenFactors = new Set(['Location', 'Market', 'Landlord']);
  const frozenCount   = (data.scoreBreakdown || []).filter(m => frozenFactors.has(m.name.split(' (')[0])).length;

  return (
    <Card>
      {/* Header: label + frozen indicator, ring pinned right */}
      <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:16,marginBottom:18}}>
        <div style={{flex:1,minWidth:0}}>
          <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:4,flexWrap:'wrap'}}>
            <Label style={{marginBottom:0}}>Investment Score</Label>
            {isEdited && (
              <div style={{fontSize:10.5,color:C.muted,background:C.soft,border:`1px solid ${C.border}`,borderRadius:100,padding:'2px 10px',whiteSpace:'nowrap',display:'flex',alignItems:'center',gap:4}}>
                <svg width="9" height="9" viewBox="0 0 10 10" fill="none">
                  <rect x="1" y="4" width="8" height="6" rx="1.5" fill="none" stroke={C.muted} strokeWidth="1.1"/>
                  <path d="M3 4V3a2 2 0 114 0v1" stroke={C.muted} strokeWidth="1.1" fill="none"/>
                </svg>
                {frozenCount} frozen — re-run AI to update
              </div>
            )}
          </div>
          <div style={{fontSize:11,color:C.muted}}>
            Weighted for: <strong style={{color:C.text}}>{s.investorGoal || 'balanced'}</strong>
          </div>
        </div>
        <div style={{flexShrink:0}}>
          <ScoreRing score={score}/>
        </div>
      </div>

      {/* Score bars — full-width, ring is not a sibling so they never compete */}
      <div style={{display:'flex',flexDirection:'column',gap:13,marginBottom:18}}>
        {(data.scoreBreakdown || []).map((m, i) => {
          const baseName = m.name.split(' (')[0];
          const isFrozen = isEdited && frozenFactors.has(baseName);
          return (
            <div key={i} className="riq-sr" style={{display:'grid',gridTemplateColumns:'140px 1fr 32px',alignItems:'center',gap:10}}>
              <span style={{fontSize:12,color:isFrozen ? C.muted : C.text,display:'flex',alignItems:'center',gap:4}}>
                {isFrozen && (
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{flexShrink:0}}>
                    <rect x="1" y="4" width="8" height="6" rx="1.5" fill="none" stroke={C.muted} strokeWidth="1.1"/>
                    <path d="M3 4V3a2 2 0 114 0v1" stroke={C.muted} strokeWidth="1.1" fill="none"/>
                  </svg>
                )}
                {m.name}
              </span>
              <AnimatedBar score={m.score} delay={i * 90}/>
              <span style={{fontSize:11.5,fontWeight:700,textAlign:'right',color:scoreColor(m.score)}}>{m.score}</span>
            </div>
          );
        })}
      </div>

      <div style={{fontSize:11.5,color:C.muted,background:C.soft,borderRadius:10,padding:'10px 14px',lineHeight:1.6}}>
        {data.assumedPrice} · {data.assumedRent} · {s.cashPurchase ? 'cash' : `${s.downPaymentPct}% down @ ${s.interestRate}%`}
      </div>
    </Card>
  );
}
