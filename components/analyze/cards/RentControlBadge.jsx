import { useState, useEffect } from 'react';
import { C, clamp, scoreColor } from '../tokens';
import { Label, Card, Pill, AnimatedBar } from '../InputComponents';

export function RentControlBadge({data}) {
  const rc = data._cityRentCtrl;
  if (!rc || rc.status !== 'active') return null;

  const capLine = rc.annualCap
    ? `${rc.annualCap}% annual cap${rc.cpiTied ? ' (or CPI)' : ''}`
    : rc.cpiTied
      ? 'CPI-tied annual cap'
      : 'Board-set annual cap';

  return (
    <div style={{
      background:C.amberBg,
      border:`1.5px solid ${C.amberBorder}`,
      borderRadius:12,
      padding:'14px 18px',
      marginBottom:14,
      display:'flex',
      alignItems:'flex-start',
      gap:12,
    }}>
      <div style={{flex:1,minWidth:0}}>
        <div style={{fontSize:12,fontWeight:700,color:C.amber,textTransform:'uppercase',letterSpacing:'0.09em',marginBottom:4}}>
          Rent Control Active — {rc.city}, {rc.state}
        </div>
        <div style={{fontSize:13,color:C.textBody,lineHeight:1.6,marginBottom:6}}>
          <strong>{rc.ordinanceName}</strong> — {capLine}
          {rc.justCauseEviction && <span style={{marginLeft:6,fontSize:12,color:C.amber,fontWeight:600}}>· Just cause eviction required</span>}
        </div>
        <div style={{fontSize:12,color:C.muted,lineHeight:1.5,marginBottom:4}}>{rc.exemptions}</div>
        <div style={{fontSize:11,color:C.muted}}>Source: {rc.source} · Data as of 2025-Q1 · Verify with local housing authority</div>
      </div>
    </div>
  );
}

// --- Tax Trend Badge (Phase 8) ------------------------------------------------
// Shown inline as a small badge when tax trend is rising or a notable cap exists.
// Data comes from analysis response (_taxTrend). Static — always available.
