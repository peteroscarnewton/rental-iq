import { useState, useEffect } from 'react';
import { C, clamp, scoreColor } from '../tokens';
import { Label, Card, Pill, AnimatedBar } from '../InputComponents';

export function ClimateRiskCard({data: climateData, loading}) {
  if (loading) {
    return (
      <Card style={{marginBottom: 14}}>
        <Label>Climate Risk</Label>
        <div style={{fontSize: 13, color: C.muted, textAlign: 'center', padding: '10px 0'}}>Loading FEMA risk data…</div>
      </Card>
    );
  }
  if (!climateData) return null;

  const score  = climateData.riskScore;
  const rating = climateData.riskRating;

  const ratingColor = {
    'Very High':           C.red,
    'Relatively High':     C.amber,
    'Relatively Moderate': C.blue,
    'Relatively Low':      C.green,
    'Very Low':            C.green,
  }[rating] || C.muted;

  return (
    <Card style={{marginBottom: 14}}>
      <Label>Climate Risk — FEMA National Risk Index</Label>
      <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12}} className="riq-g2">
        <div style={{background: C.soft, borderRadius: 12, padding: '16px 18px'}}>
          <div style={{fontSize: 10, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.10em', marginBottom: 8}}>
            Composite Risk Score
          </div>
          <div style={{display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6}}>
            {score !== null && (
              <span style={{fontFamily: "'Instrument Serif',Georgia,serif", fontSize: 32, fontWeight: 800, color: ratingColor, lineHeight: 1}}>
                {score}
              </span>
            )}
            <span style={{fontSize: 12, color: C.muted}}>/100</span>
          </div>
          {rating && (
            <span style={{
              display: 'inline-block',
              fontSize: 11, fontWeight: 700,
              background: ratingColor + '20', color: ratingColor,
              border: `1px solid ${ratingColor}40`,
              borderRadius: 100, padding: '2px 10px',
              textTransform: 'capitalize',
            }}>
              {rating}
            </span>
          )}
          <div style={{fontSize: 11, color: C.muted, marginTop: 8}}>
            {climateData.countyName}{climateData.stateName ? `, ${climateData.stateName}` : ''}
          </div>
          <div style={{fontSize: 10, color: C.muted, marginTop: 2}}>FEMA NRI v2 · {climateData.asOf}</div>
        </div>

        {climateData.topHazards?.length > 0 && (
          <div style={{background: C.soft, borderRadius: 12, padding: '16px 18px'}}>
            <div style={{fontSize: 10, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.10em', marginBottom: 8}}>
              Elevated Hazards
            </div>
            <div style={{display: 'flex', flexDirection: 'column', gap: 6}}>
              {climateData.topHazards.map((h, i) => (
                <div key={i} style={{display: 'flex', alignItems: 'center', gap: 8}}>
                  <span style={{
                    fontSize: 10, fontWeight: 700,
                    background: (h.rating === 'Very High' ? C.red : C.amber) + '20',
                    color: h.rating === 'Very High' ? C.red : C.amber,
                    border: `1px solid ${(h.rating === 'Very High' ? C.red : C.amber)}40`,
                    borderRadius: 6, padding: '1px 7px', whiteSpace: 'nowrap',
                  }}>
                    {h.rating === 'Very High' ? '🔴' : '🟡'} {h.label}
                  </span>
                </div>
              ))}
            </div>
            {(climateData.riskRating === 'Very High' || climateData.riskRating === 'Relatively High') && (
              <div style={{fontSize: 11.5, color: C.amber, marginTop: 10, lineHeight: 1.5}}>
                Elevated risk may affect insurance availability and long-term property value.
              </div>
            )}
          </div>
        )}
      </div>

      {climateData.note && (
        <div style={{fontSize: 12, color: C.textBody, lineHeight: 1.6, marginTop: 10, padding: '10px 14px', background: C.soft, borderRadius: 8}}>
          {climateData.note}
        </div>
      )}
    </Card>
  );
}

// --- STR Data Card (Phase 8) --------------------------------------------------
// Shows real STR income potential from Inside Airbnb + regulatory context.
// Fetched client-side via /api/str-data.
