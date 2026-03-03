import { useState, useEffect } from 'react';
import { C, clamp, scoreColor } from '../tokens';
import { Label, Card, Pill, AnimatedBar } from '../InputComponents';

export function RentContextCard({data}) {
  if (!data.assumedRent) return null;
  const isUser=data.rentConfidence==='user-provided';
  return (
    <Card style={{padding:'20px 24px'}}>
      <Label>{isUser?'Rent - Confirmed':'Rent - AI Estimate'}</Label>
      <div style={{display:'flex',alignItems:'baseline',gap:10,marginBottom:8}}>
        <span style={{fontFamily:"'Instrument Serif',Georgia,serif",fontSize:30,color:C.text,lineHeight:1}}>{data.assumedRent}</span>
        {data.rentRangeLow&&data.rentRangeHigh&&<span style={{fontSize:13,color:C.muted}}>Range: {data.rentRangeLow}-{data.rentRangeHigh}</span>}
      </div>
      {data.rentRangeNote&&<p style={{fontSize:13.5,color:C.textBody,lineHeight:1.65,margin:0}}>{data.rentRangeNote}</p>}
      {!isUser&&<div style={{marginTop:10,background:C.amberBg,border:`1px solid ${C.amberBorder}`,borderRadius:10,padding:'9px 13px',fontSize:12.5,color:C.amber,display:'flex',alignItems:'flex-start',gap:8}}><svg width="14" height="14" viewBox="0 0 16 16" fill="none" style={{flexShrink:0,marginTop:1}}><circle cx="8" cy="8" r="6.5" stroke={C.amber} strokeWidth="1.4"/><path d="M8 7v4" stroke={C.amber} strokeWidth="1.5" strokeLinecap="round"/><circle cx="8" cy="5" r="0.8" fill={C.amber}/></svg><span>Have the actual rent? Re-run with it entered for a tighter analysis.</span></div>}
      {data.confidenceRange&&<p style={{fontSize:12.5,color:C.amber,marginTop:8,marginBottom:0}}>Score range with rent uncertainty: <strong>{data.confidenceRange}/100</strong></p>}
    </Card>
  );
}

