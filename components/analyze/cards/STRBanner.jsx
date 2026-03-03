import { useState, useEffect } from 'react';
import { C, clamp, scoreColor } from '../tokens';
import { Label, Card, Pill, AnimatedBar } from '../InputComponents';

export function STRBanner({data}) {
  if (!data.strPotential||!data.strNote) return null;
  return (
    <div style={{background:C.blueBg,border:`1.5px solid ${C.blueBorder}`,borderRadius:14,padding:'14px 18px',marginBottom:14,display:'flex',gap:12,alignItems:'flex-start'}}>
      <span style={{fontSize:20,flexShrink:0,marginTop:1}}>⚡</span>
      <div>
        <div style={{fontSize:11,fontWeight:600,letterSpacing:'0.1em',textTransform:'uppercase',color:C.blue,marginBottom:4}}>STR Potential</div>
        <p style={{fontSize:13.5,color:C.blue,lineHeight:1.6,margin:0}}>{data.strNote}</p>
      </div>
    </div>
  );
}

