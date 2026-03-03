import { useState, useEffect } from 'react';
import { C, clamp, scoreColor } from '../tokens';
import { Label, Card, Pill, AnimatedBar } from '../InputComponents';

export function SupplyDemandCard({data}) {
  const permits = data._buildingPermits;
  const growth  = data._metroGrowth;
  if (!permits && !growth) return null;

  const demandColors = {
    strong:   C.green,
    moderate: C.blue,
    stable:   C.muted,
    weak:     C.amber,
    unknown:  C.muted,
  };

  const supplyColors = {
    high:        C.amber,
    moderate:    C.blue,
    low:         C.green,
    constrained: C.green,
    unknown:     C.muted,
  };

  const demandColor = demandColors[growth?.demandSignal] || C.muted;
  const supplyColor = supplyColors[permits?.supplyPressure] || C.muted;

  return (
    <Card style={{marginBottom:14}}>
      <Label>Supply &amp; Demand Fundamentals</Label>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}} className="riq-g2">

        {/* Supply side */}
        {permits && (
          <div style={{background:C.soft,borderRadius:12,padding:'16px 18px'}}>
            <div style={{fontSize:10,color:C.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:8}}>Supply Pipeline</div>
            <div style={{display:'flex',alignItems:'baseline',gap:6,marginBottom:6}}>
              <span style={{fontFamily:"'Instrument Serif',Georgia,serif",fontSize:28,fontWeight:800,color:supplyColor,lineHeight:1}}>
                {permits.annualized.toLocaleString()}
              </span>
              <span style={{fontSize:12,color:C.muted}}>new units/yr</span>
            </div>
            <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:8}}>
              <span style={{
                fontSize:11,fontWeight:700,
                background:supplyColor+'20',color:supplyColor,
                border:`1px solid ${supplyColor}40`,
                borderRadius:100,padding:'2px 10px',letterSpacing:'0.06em',
                textTransform:'capitalize'
              }}>
                {permits.supplyPressure} supply
              </span>
              <span style={{fontSize:11,color:C.muted}}>
                {permits.trend === 'accelerating' ? '↑ accelerating' : permits.trend === 'declining' ? '↓ declining' : '→ stable'}
              </span>
            </div>
            <div style={{fontSize:12,color:C.textBody,lineHeight:1.6}}>{permits.supplyNote}</div>
            <div style={{fontSize:11,color:C.muted,marginTop:6}}>Census BPS · {permits.asOf || 'recent'}</div>
          </div>
        )}

        {/* Demand side */}
        {growth && (
          <div style={{background:C.soft,borderRadius:12,padding:'16px 18px'}}>
            <div style={{fontSize:10,color:C.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:8}}>Demand Drivers</div>
            <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:10}}>
              <span style={{
                fontSize:11,fontWeight:700,
                background:demandColor+'20',color:demandColor,
                border:`1px solid ${demandColor}40`,
                borderRadius:100,padding:'3px 12px',letterSpacing:'0.06em',
                textTransform:'capitalize'
              }}>
                {growth.demandSignal.replace('_',' ')} demand
              </span>
            </div>

            {/* Population & jobs in a compact 2-col grid */}
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:8}}>
              {growth.popGrowthPct !== null && (
                <div>
                  <div style={{fontSize:10,color:C.muted,marginBottom:2}}>Population/yr</div>
                  <div style={{fontSize:18,fontWeight:700,color:growth.popGrowthPct >= 1 ? C.green : growth.popGrowthPct < 0 ? C.red : C.muted}}>
                    {growth.popGrowthPct > 0 ? '+' : ''}{growth.popGrowthPct}%
                  </div>
                  <div style={{fontSize:11,color:C.muted}}>{growth.popTrend.replace(/_/g,' ')}</div>
                </div>
              )}
              {growth.jobGrowthPct !== null && (
                <div>
                  <div style={{fontSize:10,color:C.muted,marginBottom:2}}>Jobs/yr</div>
                  <div style={{fontSize:18,fontWeight:700,color:growth.jobGrowthPct >= 1 ? C.green : growth.jobGrowthPct < 0 ? C.red : C.muted}}>
                    {growth.jobGrowthPct > 0 ? '+' : ''}{growth.jobGrowthPct}%
                  </div>
                  <div style={{fontSize:11,color:C.muted}}>{growth.jobTrend.replace(/_/g,' ')}</div>
                </div>
              )}
            </div>

            <div style={{fontSize:12,color:C.textBody,lineHeight:1.6}}>{growth.demandNote}</div>
            <div style={{fontSize:11,color:C.muted,marginTop:6}}>Census ACS + BLS LAUS · {growth.asOf || 'recent'}</div>
          </div>
        )}
      </div>
    </Card>
  );
}

// --- School Quality Badge (Phase 6) -------------------------------------------
// Shown inside NeighborhoodCard as a compact badge — school count +
// quality tier from NCES CCD, replacing the raw school count.
// The standalone card is not needed — this integrates into the existing neighborhood section.
