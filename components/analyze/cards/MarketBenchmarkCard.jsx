import { useState, useEffect } from 'react';
import { C, clamp, scoreColor } from '../tokens';
import { Label, Card, Pill, AnimatedBar } from '../InputComponents';

export function MarketBenchmarkCard({data, safmrData}) {
  const capRate  = data._marketCapRate;
  const hvs      = data._hvsVacancy;
  const mgmt     = data._mgmtFeeData;
  // safmrData prop (client-side fetch) takes priority; fall back to any server-side value
  const safmr    = safmrData || data._safmrRent;
  if (!capRate && !hvs && !mgmt && !safmr) return null;

  // Cap rate comparison helpers
  const dealCapRate = (() => {
    const m = data.keyMetrics?.find(m => m.label === 'Cap Rate');
    if (!m?.value) return null;
    return parseFloat(m.value);
  })();

  const capDelta = (dealCapRate != null && capRate?.capRate)
    ? Math.round((dealCapRate - capRate.capRate) * 10) / 10
    : null;

  const capColor = capDelta === null ? C.muted : capDelta >= 0.5 ? C.green : capDelta <= -0.5 ? C.red : C.amber;

  // Vacancy benchmark
  const stateCode = data._settings?.stateCode || '';
  const regionMap = {
    CT:'northeast',MA:'northeast',ME:'northeast',NH:'northeast',NJ:'northeast',
    NY:'northeast',PA:'northeast',RI:'northeast',VT:'northeast',
    IL:'midwest',IN:'midwest',IA:'midwest',KS:'midwest',MI:'midwest',
    MN:'midwest',MO:'midwest',NE:'midwest',ND:'midwest',OH:'midwest',SD:'midwest',WI:'midwest',
    AL:'south',AR:'south',DE:'south',DC:'south',FL:'south',GA:'south',KY:'south',
    LA:'south',MD:'south',MS:'south',NC:'south',OK:'south',SC:'south',TN:'south',
    TX:'south',VA:'south',WV:'south',
    AK:'west',AZ:'west',CA:'west',CO:'west',HI:'west',ID:'west',MT:'west',
    NV:'west',NM:'west',OR:'west',UT:'west',WA:'west',WY:'west',
  };
  const region = stateCode ? (regionMap[stateCode.toUpperCase()] ?? 'national') : 'national';
  const benchmarkVacancy = hvs
    ? (region !== 'national' && hvs.byRegion?.[region] ? hvs.byRegion[region] : hvs.national)
    : null;
  const userVacancy = data._settings?.vacancy ?? null;
  const vacancyDelta = (benchmarkVacancy != null && userVacancy != null)
    ? Math.round((userVacancy - benchmarkVacancy) * 10) / 10
    : null;
  const vacancyColor = vacancyDelta === null ? C.muted : Math.abs(vacancyDelta) < 1.5 ? C.green : vacancyDelta < 0 ? C.amber : C.blue;

  // Mgmt fee comparison
  const userMgmt  = data._settings?.mgmtRate ?? null;
  const mgmtBench = mgmt?.rate ?? null;
  const mgmtDelta = (userMgmt != null && mgmtBench != null && !data._settings?.selfManage)
    ? Math.round((userMgmt - mgmtBench) * 10) / 10
    : null;
  const mgmtColor = mgmtDelta === null ? C.muted : Math.abs(mgmtDelta) < 1 ? C.green : mgmtDelta > 0 ? C.blue : C.amber;

  return (
    <Card style={{marginBottom:14}}>
      <Label>Market Benchmarks</Label>
      <div style={{display:'grid',gridTemplateColumns:'repeat(2,1fr)',gap:10}} className="riq-g2">

        {/* Cap Rate Benchmark */}
        {capRate && (
          <div style={{background:C.soft,borderRadius:12,padding:'16px 18px'}}>
            <div style={{fontSize:10,color:C.muted,textTransform:'uppercase',letterSpacing:'0.10em',marginBottom:8}}>
              Market Cap Rate
            </div>
            <div style={{display:'flex',alignItems:'baseline',gap:6,marginBottom:4}}>
              <span style={{fontFamily:"'Instrument Serif',Georgia,serif",fontSize:28,fontWeight:800,color:C.text,lineHeight:1}}>
                {capRate.capRate}%
              </span>
              <span style={{fontSize:12,color:C.muted}}>local benchmark</span>
            </div>
            {dealCapRate != null && capDelta !== null && (
              <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:6}}>
                <span style={{
                  fontSize:11,fontWeight:700,
                  background:capColor+'20',color:capColor,
                  border:`1px solid ${capColor}40`,
                  borderRadius:100,padding:'2px 10px',
                }}>
                  {capDelta >= 0 ? `+${capDelta}pp` : `${capDelta}pp`} vs market
                </span>
                <span style={{fontSize:11,color:C.muted}}>
                  {capDelta >= 0.5 ? 'above-market yield ✓' : capDelta <= -0.5 ? 'below-market yield' : 'at market'}
                </span>
              </div>
            )}
            <div style={{fontSize:11,color:C.muted,marginTop:4}}>
              {capRate.source} · {capRate.metro}
            </div>
          </div>
        )}

        {/* HVS Vacancy Benchmark */}
        {hvs && (
          <div style={{background:C.soft,borderRadius:12,padding:'16px 18px'}}>
            <div style={{fontSize:10,color:C.muted,textTransform:'uppercase',letterSpacing:'0.10em',marginBottom:8}}>
              Regional Vacancy Rate
            </div>
            <div style={{display:'flex',alignItems:'baseline',gap:6,marginBottom:4}}>
              <span style={{fontFamily:"'Instrument Serif',Georgia,serif",fontSize:28,fontWeight:800,color:C.text,lineHeight:1}}>
                {benchmarkVacancy ?? hvs.national}%
              </span>
              <span style={{fontSize:12,color:C.muted}}>{region !== 'national' ? region : 'national'} avg</span>
            </div>
            {vacancyDelta !== null && (
              <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:6}}>
                <span style={{
                  fontSize:11,fontWeight:700,
                  background:vacancyColor+'20',color:vacancyColor,
                  border:`1px solid ${vacancyColor}40`,
                  borderRadius:100,padding:'2px 10px',
                }}>
                  Your: {userVacancy}%
                </span>
                <span style={{fontSize:11,color:C.muted}}>
                  {Math.abs(vacancyDelta) < 1.5
                    ? 'aligned with region'
                    : vacancyDelta < 0
                      ? 'optimistic vs region'
                      : 'conservative vs region'}
                </span>
              </div>
            )}
            <div style={{fontSize:11,color:C.muted,marginTop:4}}>
              Census HVS · {hvs.asOf}
            </div>
          </div>
        )}

        {/* Management Fee Benchmark */}
        {mgmt && !data._settings?.selfManage && (
          <div style={{background:C.soft,borderRadius:12,padding:'16px 18px'}}>
            <div style={{fontSize:10,color:C.muted,textTransform:'uppercase',letterSpacing:'0.10em',marginBottom:8}}>
              Mgmt Fee Benchmark
            </div>
            <div style={{display:'flex',alignItems:'baseline',gap:6,marginBottom:4}}>
              <span style={{fontFamily:"'Instrument Serif',Georgia,serif",fontSize:28,fontWeight:800,color:C.text,lineHeight:1}}>
                {mgmt.rate}%
              </span>
              <span style={{fontSize:12,color:C.muted}}>local avg</span>
            </div>
            {mgmtDelta !== null && (
              <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:6}}>
                <span style={{
                  fontSize:11,fontWeight:700,
                  background:mgmtColor+'20',color:mgmtColor,
                  border:`1px solid ${mgmtColor}40`,
                  borderRadius:100,padding:'2px 10px',
                }}>
                  Your: {userMgmt}%
                </span>
                <span style={{fontSize:11,color:C.muted}}>
                  {Math.abs(mgmtDelta) < 1
                    ? 'matches local rate'
                    : mgmtDelta > 0
                      ? 'above local avg'
                      : 'below local avg — verify'}
                </span>
              </div>
            )}
            <div style={{fontSize:11,color:C.muted,marginTop:4}}>
              NARPM 2024 survey · {mgmt.metro}
            </div>
          </div>
        )}

        {/* HUD SAFMR Rent Anchor */}
        {safmr?.rent && (
          <div style={{background:C.soft,borderRadius:12,padding:'16px 18px'}}>
            <div style={{fontSize:10,color:C.muted,textTransform:'uppercase',letterSpacing:'0.10em',marginBottom:8}}>
              HUD Fair Market Rent
            </div>
            <div style={{display:'flex',alignItems:'baseline',gap:6,marginBottom:4}}>
              <span style={{fontFamily:"'Instrument Serif',Georgia,serif",fontSize:28,fontWeight:800,color:C.text,lineHeight:1}}>
                ${safmr.rent.toLocaleString()}
              </span>
              <span style={{fontSize:12,color:C.muted}}>/mo · {safmr.beds}BR</span>
            </div>
            <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:6}}>
              <span style={{
                fontSize:11,fontWeight:700,
                background:C.blue+'20',color:C.blue,
                border:`1px solid ${C.blue}40`,
                borderRadius:100,padding:'2px 10px',
              }}>
                ZIP {safmr.zip}
              </span>
              <span style={{fontSize:11,color:C.muted}}>voucher-eligible floor</span>
            </div>
            <div style={{fontSize:11,color:C.muted,marginTop:4}}>
              HUD SAFMR {safmr.year} · {safmr.metro}
            </div>
          </div>
        )}

      </div>
    </Card>
  );
}

// --- Rent Control Badge (Phase 7) ---------------------------------------------
// Shown inline inside LandlordScore card or as a standalone warning when active.
// Data comes from analysis response (_cityRentCtrl).
