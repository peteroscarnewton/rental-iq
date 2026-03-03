import { useState, useEffect } from 'react';
import { C, clamp, scoreColor } from '../tokens';
import { Label, Card, Pill, AnimatedBar } from '../InputComponents';

export function DataConfidenceBanner({data}) {
  const level=data.dataConfidence||'Medium';
  const note=data.dataConfidenceNote||'';
  const color=level==='High'?C.green:level==='Low'?C.red:C.amber;
  const dots = level==='High'?[1,1,1]:level==='Low'?[1,0,0]:[1,1,0];
  return (
    <div style={{display:'flex',alignItems:'center',gap:10,padding:'11px 16px',background:color+'12',border:`1px solid ${color}40`,borderRadius:12,marginBottom:14}}>
      <div style={{display:'flex',gap:3,flexShrink:0}}>
        {dots.map((on,i)=><div key={i} style={{width:8,height:8,borderRadius:'50%',background:on?color:color+'35',border:`1.5px solid ${on?color:color+'50'}`}}/>)}
      </div>
      <div><span style={{fontSize:12.5,fontWeight:700,color}}>Confidence: {level}</span>{note&&<span style={{fontSize:12.5,color:C.muted,marginLeft:6}}>- {note}</span>}</div>
    </div>
  );
}

// --- Market Benchmark Card (Phase 7) -----------------------------------------
// Shows cap rate benchmark, HVS vacancy, management fee comparison, and SAFMR rent.
// Data comes from analysis response (_marketCapRate, _hvsVacancy, _mgmtFeeData)
// and from client-side /api/safmr-rent fetch (safmrData prop).
