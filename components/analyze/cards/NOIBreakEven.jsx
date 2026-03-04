import { useState, useEffect } from 'react';
import { C, clamp, scoreColor } from '../tokens';
import { Label, Card, Pill, AnimatedBar } from '../InputComponents';

export function NOIBreakEven({data}) {
  if (!data.noi&&!data.breakEvenRent) return null;
  return (
    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:14}} className="riq-g2">
      {data.noi&&(
        <div style={{background:C.white,border:`1px solid ${data.noiStatus==='good'?C.greenBorder:C.redBorder}`,borderRadius:14,padding:'18px 16px',boxShadow:C.shadowSm}}>
          <div style={{fontSize:9.5,fontWeight:600,letterSpacing:'0.1em',textTransform:'uppercase',color:C.muted,marginBottom:8}}>Net Operating Income</div>
          <div style={{fontFamily:"'Instrument Serif',Georgia,serif",fontSize:26,lineHeight:1,color:data.noiStatus==='good'?C.green:C.red,marginBottom:5}}>{data.noi}</div>
          <div style={{fontSize:11,color:C.muted}}>Before debt service</div>
        </div>
      )}
      {data.breakEvenRent&&(
        <div style={{background:C.white,border:`1px solid ${C.border}`,borderRadius:14,padding:'18px 16px',boxShadow:C.shadowSm}}>
          <div style={{fontSize:9.5,fontWeight:600,letterSpacing:'0.1em',textTransform:'uppercase',color:C.muted,marginBottom:8}}>Break-Even Rent</div>
          <div style={{fontFamily:"'Instrument Serif',Georgia,serif",fontSize:26,lineHeight:1,color:C.amber,marginBottom:5}}>{data.breakEvenRent}</div>
          <div style={{fontSize:11,color:C.muted}}>Min rent for $0 cash flow</div>
        </div>
      )}
    </div>
  );
}

