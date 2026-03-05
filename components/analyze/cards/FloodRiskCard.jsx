import { useState, useEffect } from 'react';
import { C, clamp, scoreColor } from '../tokens';
import { Label, Card, Pill, AnimatedBar } from '../InputComponents';

export function FloodRiskCard({data: floodData, loading}) {
  if (loading) {
    return (
      <Card style={{padding:'18px 22px',marginBottom:14}}>
        <Label>Flood Risk</Label>
        <div style={{fontSize:13,color:C.muted}}>Looking up FEMA flood zone…</div>
      </Card>
    );
  }
  if (!floodData) return null;

  const riskColors = {
    very_high:     C.red,
    high:          C.red,
    moderate:      C.amber,
    low:           C.green,
    undetermined:  C.muted,
    unknown:       C.muted,
  };

  const color     = riskColors[floodData.riskLevel] || C.muted;
  const isHighRisk = floodData.riskLevel === 'high' || floodData.riskLevel === 'very_high';
  const bgColor    = isHighRisk ? C.red + '10' : floodData.riskLevel === 'moderate' ? C.amber + '10' : C.soft;
  const borderColor = isHighRisk ? C.red + '40' : floodData.riskLevel === 'moderate' ? C.amber + '40' : C.border;

  return (
    <Card style={{border:`1px solid ${borderColor}`,background:bgColor,marginBottom:14}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:10}}>
        <Label style={{marginBottom:0}}>Flood Risk</Label>
        <span style={{fontSize:11,color:C.muted}}>{floodData.source}</span>
      </div>
      <div style={{display:'flex',alignItems:'flex-start',gap:14}}>
        <div style={{flex:1}}>
          <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:4}}>
            <span style={{fontSize:17,fontWeight:800,color,letterSpacing:'-0.02em'}}>{floodData.label}</span>
            {floodData.requiresInsurance && (
              <span style={{fontSize:10,fontWeight:700,background:C.red+'20',color:C.red,border:`1px solid ${C.red}40`,borderRadius:100,padding:'2px 8px',letterSpacing:'0.06em'}}>
                INSURANCE REQUIRED
              </span>
            )}
          </div>
          <div style={{fontSize:13,color:C.textBody,lineHeight:1.6,marginBottom:isHighRisk || floodData.riskLevel === 'moderate' ? 10 : 0}}>
            {floodData.description}
          </div>

          {/* Insurance cost impact — only show for zones with meaningful cost */}
          {floodData.annualInsEst?.mid > 0 && (
            <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:8,marginTop:10}}>
              {[
                {label:'Low estimate', value:`$${floodData.annualInsEst.low.toLocaleString()}/yr`, sub:`$${floodData.monthlyInsEst.low}/mo`},
                {label:'Mid estimate', value:`$${floodData.annualInsEst.mid.toLocaleString()}/yr`, sub:`$${floodData.monthlyInsEst.mid}/mo`, hero:true},
                {label:'High estimate', value:`$${floodData.annualInsEst.high.toLocaleString()}/yr`, sub:`$${floodData.monthlyInsEst.high}/mo`},
              ].map((item,i) => (
                <div key={i} style={{background:'rgba(255,255,255,0.7)',borderRadius:10,padding:'10px 12px',border:item.hero?`2px solid ${color}40`:`1px solid ${C.border}`}}>
                  <div style={{fontSize:10,color:C.muted,textTransform:'uppercase',letterSpacing:'0.08em',marginBottom:4}}>{item.label}</div>
                  <div style={{fontSize:15,fontWeight:700,color:item.hero ? color : C.text,fontFamily:"'Instrument Serif',Georgia,serif"}}>{item.value}</div>
                  <div style={{fontSize:11,color:C.muted,marginTop:2}}>{item.sub}</div>
                </div>
              ))}
            </div>
          )}

          {/* BFE note */}
          {floodData.bfe != null && (
            <div style={{fontSize:12,color:C.muted,marginTop:8}}>
              Base Flood Elevation: {floodData.bfe} ft above sea level
            </div>
          )}

          {/* Actionable note */}
          {isHighRisk && (
            <div style={{marginTop:10,background:'rgba(255,255,255,0.7)',borderRadius:10,padding:'10px 12px',border:`1px solid ${C.border}`,fontSize:12.5,color:C.textBody,lineHeight:1.6}}>
              <strong>Cash flow impact:</strong> Budget ${floodData.monthlyInsEst.mid}/mo (${floodData.annualInsEst.mid.toLocaleString()}/yr) for flood insurance.
              {' '}This is not included in the analysis above — re-run with this as an HOA/additional expense to see true cash flow.
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

// --- Supply & Demand Card (Phase 6) -------------------------------------------
// Shows building permits (supply pipeline) and population/job growth (demand signal).
// Data comes from the analysis response (_buildingPermits, _metroGrowth).
