import { useState, useEffect } from 'react';
import { C, clamp, scoreColor } from '../tokens';
import { Label, Card, Pill, AnimatedBar } from '../InputComponents';

export function STRRegBadge({data}) {
  const reg = data._strReg;
  if (!reg || reg.status === 'permissive' || reg.status === 'licensed') return null;

  const isBanned     = reg.status === 'banned';
  const color        = isBanned ? C.red : C.amber;
  const bg           = isBanned ? C.redBg : C.amberBg;
  const border       = isBanned ? C.redBorder : C.amberBorder;
  const icon         = isBanned ? '🚫' : '⚠️';

  return (
    <div style={{
      background: bg,
      border: `1.5px solid ${border}`,
      borderRadius: 10,
      padding: '10px 14px',
      marginTop: 8,
      display: 'flex',
      alignItems: 'flex-start',
      gap: 10,
    }}>
      <span style={{fontSize: 16, flexShrink: 0, marginTop: 1}}>{icon}</span>
      <div style={{flex: 1, minWidth: 0}}>
        <div style={{fontSize: 11, fontWeight: 700, color, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 3}}>
          STR {isBanned ? 'Banned' : 'Restricted'} — {reg.source?.split('(')[0]?.trim() || 'local ordinance'}
        </div>
        <div style={{fontSize: 12.5, color: C.textBody, lineHeight: 1.55}}>{reg.detail}</div>
        <div style={{fontSize: 10.5, color: C.muted, marginTop: 4}}>Data as of 2025-Q1 · Verify with local municipality before purchasing</div>
      </div>
    </div>
  );
}

// --- Climate Risk Card (Phase 8) ----------------------------------------------
// Shows FEMA NRI composite risk score + top hazards.
// Fetched client-side via /api/climate-risk after geocoding.
