import { useState, useEffect } from 'react';
import { C, clamp, scoreColor } from '../tokens';
import { Label, Card, Pill, AnimatedBar } from '../InputComponents';

export function SchoolQualityBadge({schoolData}) {
  if (!schoolData || schoolData.overall === 'no_data') return null;
  const tierColors = {
    strong:        C.green,
    average:       C.blue,
    below_average: C.amber,
    weak:          C.red,
    no_data:       C.muted,
  };
  const tierIcons = { strong:'★', average:'◆', below_average:'▲', weak:'▼' };
  const color = tierColors[schoolData.tier || 'average'] || C.muted;
  const icon  = tierIcons[schoolData.tier || 'average'] || '◆';

  return (
    <div style={{background:C.soft,borderRadius:12,padding:'12px 14px',marginTop:10}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:6}}>
        <div style={{fontSize:10,color:C.muted,textTransform:'uppercase',letterSpacing:'0.1em'}}>School Quality</div>
        <span style={{fontSize:11,fontWeight:700,color,background:color+'15',border:`1px solid ${color}40`,borderRadius:100,padding:'2px 8px'}}>
          {icon} {schoolData.tierLabel || schoolData.tier}
        </span>
      </div>
      <div style={{display:'flex',gap:12}}>
        {schoolData.count > 0 && <div style={{fontSize:13,color:C.text}}><strong>{schoolData.count}</strong> <span style={{color:C.muted,fontSize:12}}>public schools</span></div>}
        {schoolData.avgStudentTeacherRatio && <div style={{fontSize:12,color:C.muted}}>Ratio: {schoolData.avgStudentTeacherRatio}:1</div>}
        {schoolData.titleIPct > 0 && <div style={{fontSize:12,color:C.muted}}>Title I: {schoolData.titleIPct}%</div>}
      </div>
      {schoolData.note && <div style={{fontSize:12,color:C.textBody,lineHeight:1.5,marginTop:6}}>{schoolData.note}</div>}
      <div style={{fontSize:11,color:C.muted,marginTop:4}}>NCES Common Core of Data</div>
    </div>
  );
}

