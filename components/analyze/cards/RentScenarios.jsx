import { useState, useEffect } from 'react';
import { C, clamp, scoreColor } from '../tokens';
const verdictColor = v => v === 'YES' ? C.green : v === 'NO' ? C.red : C.amber;
import { Label, Card, Pill, AnimatedBar } from '../InputComponents';
import { getMarketData } from '../marketHelpers';
const normalizeRent = s => (s || '').replace(/\\s+/g, '').toLowerCase();

export function RentScenarios({data}) {
  if (!data.rentScenarios?.length) return null;
  const norm=normalizeRent(data.assumedRent);
  return (
    <Card>
      <Label>Rent Sensitivity</Label>
      <div className="riq-g3" style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:10}}>
        {data.rentScenarios.map((s,i)=>{
          const isBase=normalizeRent(s.rent)===norm;
          const vc=verdictColor(s.verdict||'MAYBE');
          const isPos=s.cashflow?.startsWith('+');
          const isNeg=s.cashflow?.startsWith('-');
          return (
            <div key={i} style={{background:isBase?C.soft:C.white,border:`${isBase?'2px':'1px'} solid ${isBase?C.green:C.border}`,borderRadius:14,padding:'16px 12px',textAlign:'center',position:'relative'}}>
              {isBase&&<div style={{position:'absolute',top:-10,left:'50%',transform:'translateX(-50%)',background:C.green,color:'#fff',fontSize:9,fontWeight:700,borderRadius:100,padding:'3px 9px',whiteSpace:'nowrap'}}>Base</div>}
              <div style={{fontSize:12,color:C.muted,marginBottom:5}}>{s.rent}</div>
              <div style={{fontFamily:"'Instrument Serif',Georgia,serif",fontSize:22,lineHeight:1,marginBottom:4,color:isNeg?C.red:isPos?C.green:C.amber}}>{s.cashflow}</div>
              <div style={{fontSize:11,color:C.muted,marginBottom:8}}>CoC: {s.coc}</div>
              <div style={{display:'inline-block',background:vc+'18',borderRadius:100,padding:'2px 10px',fontSize:10,fontWeight:700,color:vc}}>{s.verdict}</div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

