import { useState, useEffect } from 'react';
import { C, clamp, scoreColor } from '../tokens';
import { Label, Card, Pill, AnimatedBar } from '../InputComponents';
import { STRRegBadge } from './STRRegBadge';

export function STRDataCard({data: strData, loading, analysisData}) {
  // Only show for SFR/condo
  const propertyType = analysisData?._settings?.propertyType;
  if (propertyType && propertyType !== 'sfr' && propertyType !== 'condo') return null;

  if (loading) {
    return (
      <Card style={{marginBottom: 14}}>
        <Label>STR Income Potential</Label>
        <div style={{fontSize: 13, color: C.muted, textAlign: 'center', padding: '10px 0'}}>Loading STR data…</div>
      </Card>
    );
  }
  if (!strData) return null;

  const reg           = strData.regulation || analysisData?._strReg;
  const isBanned      = reg?.status === 'banned';
  const monthlyRevenue = strData.annualRevenue ? Math.round(strData.annualRevenue / 12) : null;
  const ltrRent        = analysisData?.assumedRent ? parseFloat(String(analysisData.assumedRent).replace(/[^0-9.]/g,'')) : null;
  const strPremium     = (monthlyRevenue && ltrRent && monthlyRevenue > ltrRent)
    ? Math.round(((monthlyRevenue - ltrRent) / ltrRent) * 100)
    : null;

  return (
    <Card style={{marginBottom: 14}}>
      <Label>STR Income Potential</Label>

      {isBanned ? (
        <div style={{background: C.redBg, border: `1px solid ${C.redBorder}`, borderRadius: 10, padding: '12px 16px', fontSize: 13, color: C.red}}>
          <strong>STR not permitted</strong> — {reg.detail}
        </div>
      ) : (
        <div style={{display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginBottom: strData.estimated ? 10 : 0}} className="riq-g3">
          {[
            { label: 'Nightly Rate', value: strData.nightlyRate ? `$${strData.nightlyRate}` : '—', sub: 'median (entire home)' },
            { label: 'Occupancy', value: strData.occupancyRate ? `${Math.round(strData.occupancyRate * 100)}%` : '—', sub: 'estimated annual' },
            { label: 'Gross Revenue', value: strData.annualRevenue ? `$${strData.annualRevenue.toLocaleString()}` : '—',
              sub: monthlyRevenue ? `~$${monthlyRevenue.toLocaleString()}/mo` : 'annual' },
          ].map((item, i) => (
            <div key={i} style={{background: C.soft, borderRadius: 10, padding: '12px 14px'}}>
              <div style={{fontSize: 10, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 5}}>{item.label}</div>
              <div style={{fontFamily: "'Instrument Serif',Georgia,serif", fontSize: 22, color: C.text, lineHeight: 1, marginBottom: 3}}>{item.value}</div>
              <div style={{fontSize: 11, color: C.muted}}>{item.sub}</div>
            </div>
          ))}
        </div>
      )}

      {!isBanned && strPremium !== null && strPremium > 5 && (
        <div style={{background: C.greenBg, border: `1px solid ${C.greenBorder}`, borderRadius: 10, padding: '10px 14px', fontSize: 12.5, color: C.green, marginBottom: 8}}>
          ✓ STR could generate <strong>{strPremium}% more</strong> per month than LTR rent — worth evaluating with a local STR operator.
        </div>
      )}

      {!isBanned && reg && reg.status !== 'permissive' && <STRRegBadge data={{_strReg: reg}}/>}

      <div style={{fontSize: 11, color: C.muted, marginTop: 8}}>
        {strData.source} · {strData.asOf}
        {strData.estimated ? ' · Estimate only — verify with local AirDNA/Rabbu data' : ` · ${strData.listingCount} listings analyzed`}
      </div>
    </Card>
  );
}

