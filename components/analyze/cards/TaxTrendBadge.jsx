import { useState, useEffect } from 'react';
import { C, clamp, scoreColor } from '../tokens';
import { Label, Card, Pill, AnimatedBar } from '../InputComponents';

export function TaxTrendBadge({data}) {
  const tt = data._taxTrend;
  if (!tt) return null;
  // Only surface rising trend or meaningful caps — stable/declining needs no callout
  if (tt.trend !== 'rising' && !tt.cap) return null;

  const isRising = tt.trend === 'rising';
  const color    = isRising ? C.amber : C.blue;
  const bg       = isRising ? C.amberBg : C.blueBg;
  const border   = isRising ? C.amberBorder : C.blueBorder;

  return (
    <div style={{
      background: bg,
      border: `1px solid ${border}`,
      borderRadius: 10,
      padding: '10px 14px',
      marginBottom: 8,
      display: 'flex',
      alignItems: 'flex-start',
      gap: 10,
    }}>
      <span style={{fontSize: 16, flexShrink: 0, marginTop: 1}}>{isRising ? '📈' : '🔒'}</span>
      <div style={{flex: 1, minWidth: 0}}>
        <div style={{fontSize: 11, fontWeight: 700, color, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 3}}>
          Property Tax — {tt.stateCode} {isRising ? 'Rising Trend' : 'Assessment Cap'}
        </div>
        <div style={{fontSize: 12.5, color: C.textBody, lineHeight: 1.55}}>
          {isRising
            ? `Effective rate trending up in ${tt.stateCode} — budget for higher taxes in years 3–10 of hold.`
            : null}
          {tt.cap && <span style={{marginLeft: isRising ? 6 : 0, color: C.blue}}>{tt.cap}</span>}
        </div>
        <div style={{fontSize: 11, color: C.muted, marginTop: 3}}>{tt.note}</div>
      </div>
    </div>
  );
}

// --- STR Regulation Badge (Phase 8) -------------------------------------------
// Shown when the city has a notable STR restriction. Data from _strReg.
