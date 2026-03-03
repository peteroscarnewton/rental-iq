import { useState, useEffect } from 'react';
import { C, clamp, scoreColor } from '../tokens';
import { Label, Card, Pill, AnimatedBar } from '../InputComponents';
import { generateDealMemo } from '../../../lib/pdfExport';
import { getMarketData } from '../marketHelpers';
const verdictColor = v => v === 'YES' ? C.green : v === 'NO' ? C.red : C.amber;

export function ProsAndCons({data}) {
  const _MD = getMarketData();
  const confidence = data.dataConfidence || 'Medium';
  const isLowConf = confidence === 'Low';
  const isMedConf = confidence === 'Medium';
  const showHedge = isLowConf || isMedConf;
  return (
    <div className="riq-g2" style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:14}}>
      {[{title:'Why It Works',items:data.pros||[],color:C.green,marker:'✓'},{title:'Red Flags',items:data.cons||[],color:C.red,marker:'✕'}].map(({title,items,color,marker})=>(
        <Card key={title} style={{padding:22}}>
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:14}}>
            <div style={{fontSize:11,fontWeight:700,letterSpacing:'0.1em',textTransform:'uppercase',color}}>{title}</div>
            {showHedge && (
              <span style={{fontSize:9.5,fontWeight:600,letterSpacing:'0.07em',textTransform:'uppercase',
                background:isLowConf?C.redBg:C.amberBg,
                color:isLowConf?C.red:C.amber,
                border:`1px solid ${isLowConf?C.redBorder:C.amberBorder}`,
                borderRadius:100,padding:'2px 7px',flexShrink:0}}>
                {isLowConf?'Low data':'Estimated'}
              </span>
            )}
          </div>
          {showHedge && (
            <p style={{fontSize:11.5,color:isLowConf?C.red:C.amber,background:isLowConf?C.redBg:C.amberBg,borderRadius:8,padding:'8px 10px',marginBottom:12,lineHeight:1.5}}>
              {isLowConf
                ? 'Limited data for this location - AI estimates based on regional benchmarks. Verify before acting.'
                : 'Rent estimated from comps. Re-run with actual rent for higher precision.'}
            </p>
          )}
          <ul style={{listStyle:'none',display:'flex',flexDirection:'column',gap:10,padding:0,margin:0}}>
            {items.map((text,i)=>(
              <li key={i} style={{display:'flex',gap:9,alignItems:'flex-start'}}>
                <span style={{color,fontSize:11,marginTop:3,flexShrink:0,fontWeight:700}}>{marker}</span>
                <span style={{fontSize:13.5,lineHeight:1.55,color:C.textSecondary}}>{text}</span>
              </li>
            ))}
          </ul>
        </Card>
      ))}
    </div>
  );
}

