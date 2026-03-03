import { useState, useEffect } from 'react';
import { C, clamp, scoreColor } from '../tokens';
import { Label, Card, Pill, AnimatedBar } from '../InputComponents';

export function KeyMetrics({data}) {
  return (
    <div className="riq-metrics" style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:10,marginBottom:14}}>
      {(data.keyMetrics||[]).map((m,i)=>{
        const c=m.status==='good'?C.green:m.status==='bad'?C.red:C.amber;
        return (
          <div key={i} style={{background:C.white,border:`1px solid ${C.border}`,borderRadius:14,padding:'16px 14px',boxShadow:C.shadowSm}}>
            <div className="riq-m-label" style={{fontSize:9.5,fontWeight:600,letterSpacing:'0.1em',textTransform:'uppercase',color:C.muted,marginBottom:8}}>{m.label}</div>
            <div className="riq-m-value" style={{fontFamily:"'Instrument Serif',Georgia,serif",fontSize:22,lineHeight:1,color:c,marginBottom:5}}>{m.value}</div>
            <div className="riq-m-note" style={{fontSize:10.5,color:C.muted,lineHeight:1.4}}>{m.note}</div>
          </div>
        );
      })}
    </div>
  );
}

