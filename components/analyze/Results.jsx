import { useState, useEffect, useRef } from 'react';
import { C, VERDICT_CFG, clamp } from './tokens';
import { Label, Card, Pill, AnimatedBar, NewAnalysisBtn, useReveal } from './InputComponents';
import {
  StressPanel, CommandCenter, WealthProjection, OpportunityCostPanel,
  FloodRiskCard, SupplyDemandCard, SchoolQualityBadge, AssumptionsBadge,
  DataConfidenceBanner, MarketBenchmarkCard, RentControlBadge, TaxTrendBadge,
  STRRegBadge, ClimateRiskCard, STRDataCard, RentContextCard, STRBanner,
  KeyMetrics, NOIBreakEven, ExpenseBreakdown, RentScenarios, ScoreRing,
  ScoreBreakdown, BreakEvenIntelligence, ProsAndCons,
} from './cards/index';
import { ShareToolbar } from './Overlays';

// ── Reveal wrapper — scroll-triggered fade-up ─────────────────────────────────
function Reveal({ children, delay = '', className = '' }) {
  const [ref, visible] = useReveal();
  return (
    <div ref={ref} className={`riq-reveal${visible ? ' riq-up' : ''}${delay ? ` ${delay}` : ''} ${className}`}>
      {children}
    </div>
  );
}

// ── Section divider with label ────────────────────────────────────────────────
function SectionLabel({ children }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      marginBottom: 16, marginTop: 8,
    }}>
      <div style={{ flex: 1, height: 1, background: `linear-gradient(90deg, ${C.border}, transparent)` }} />
      <div style={{
        fontSize: 10, fontWeight: 700, letterSpacing: '0.14em',
        textTransform: 'uppercase', color: C.muted, whiteSpace: 'nowrap',
      }}>{children}</div>
      <div style={{ flex: 1, height: 1, background: `linear-gradient(90deg, transparent, ${C.border})` }} />
    </div>
  );
}

// ── NeighborhoodCard (kept here for co-location) ──────────────────────────────
export function NeighborhoodCard({ data, loading, schoolData }) {
  if (!loading && !data) return null;

  const fmt    = n => n != null ? '$' + n.toLocaleString() : '-';
  const fmtK   = n => n != null ? (n >= 1000 ? (n / 1000).toFixed(0) + 'k' : n.toLocaleString()) : '-';
  const fmtPct = n => n != null ? `${n > 0 ? '+' : ''}${n.toFixed(1)}%` : null;

  const scoreColor = s => s === null ? C.muted : s >= 7 ? C.green : s >= 4 ? C.amber : C.red;
  const scoreLabel = s => s === null ? '-' : s >= 7 ? 'High' : s >= 4 ? 'Moderate' : 'Low';
  const tempColor  = t => t === 'hot' ? C.red : t === 'warm' ? C.amber : t === 'cool' ? C.blue : t === 'cold' ? C.blue : C.muted;
  const tempLabel  = t => ({ hot: 'Hot', warm: 'Warm', neutral: 'Neutral', cool: 'Cool', cold: 'Cold' })[t] || t;
  const trendColor = t => t === 'accelerating' ? C.green : t === 'decelerating' ? C.amber : C.muted;
  const trendArrow = t => t === 'accelerating' ? '↗' : t === 'decelerating' ? '↘' : '→';

  if (loading) {
    return (
      <Card>
        <Label>Neighborhood</Label>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginTop: 8 }}>
          {[1, 2, 3, 4, 5, 6].map(i => (
            <div key={i} style={{ height: 48, background: C.soft, borderRadius: 8, animation: 'riq-pulse 1.4s ease-in-out infinite', animationDelay: `${i * 0.1}s` }} />
          ))}
        </div>
        <style>{`@keyframes riq-pulse{0%,100%{opacity:1}50%{opacity:0.4}}`}</style>
      </Card>
    );
  }

  const amenities = data.amenities   || {};
  const score     = data.amenityScore;
  const pulse     = data.marketPulse  || null;
  const history   = data.priceHistory || null;
  const vacancy   = data.vacancyRate  || null;
  const ptr       = data.priceToRentRatio;

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
        <Label>Neighborhood</Label>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          {data.zip   && <Pill>{data.zip}</Pill>}
          {data.state && <Pill>{data.state}</Pill>}
          {data.walkability && data.walkability !== 'Unknown' && (
            <Pill style={{ background: data.walkability === 'Urban' ? C.greenBg : data.walkability === 'Suburban' ? C.blueBg : C.soft, color: data.walkability === 'Urban' ? C.green : data.walkability === 'Suburban' ? C.blue : C.muted, border: `1px solid ${data.walkability === 'Urban' ? C.greenBorder : data.walkability === 'Suburban' ? C.blueBorder : C.border}` }}>
              {data.walkability}
            </Pill>
          )}
          {pulse?.marketTemp && (
            <Pill style={{ background: pulse.marketTemp === 'hot' ? C.redBg : pulse.marketTemp === 'warm' ? C.amberBg : C.soft, color: tempColor(pulse.marketTemp), border: `1px solid ${pulse.marketTemp === 'hot' ? C.redBorder : pulse.marketTemp === 'warm' ? C.amberBorder : C.border}` }}>
              {tempLabel(pulse.marketTemp)}
            </Pill>
          )}
        </div>
      </div>

      <div className="riq-g3" style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginBottom: 12 }}>
        {[
          { label: 'Median Income', value: fmt(data.medianIncome), sub: 'household / yr' },
          { label: 'Median Rent',   value: fmt(data.medianRent),   sub: 'per month' },
          { label: 'Population',    value: fmtK(data.population),  sub: 'ZIP code' },
        ].map(({ label, value, sub }) => (
          <div key={label} style={{ background: C.soft, borderRadius: 10, padding: '12px 14px' }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: C.muted, marginBottom: 4 }}>{label}</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: C.text, letterSpacing: '-0.03em', lineHeight: 1 }}>{value}</div>
            <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{sub}</div>
          </div>
        ))}
      </div>

      {pulse && (
        <div style={{ background: C.soft, borderRadius: 10, padding: '14px 16px', marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.text }}>Market Pulse</div>
            <div style={{ fontSize: 10, color: C.muted }}>Redfin · {pulse.asOf || 'weekly'}</div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
            {pulse.dom != null && <div style={{ textAlign: 'center' }}><div style={{ fontSize: 18, fontWeight: 800, color: pulse.dom <= 14 ? C.red : pulse.dom <= 30 ? C.amber : C.blue, letterSpacing: '-0.02em' }}>{pulse.dom}</div><div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>Days on Market</div></div>}
            {pulse.saleToList != null && <div style={{ textAlign: 'center' }}><div style={{ fontSize: 18, fontWeight: 800, color: pulse.saleToList >= 1.02 ? C.red : pulse.saleToList >= 0.99 ? C.amber : C.blue, letterSpacing: '-0.02em' }}>{(pulse.saleToList * 100).toFixed(1)}%</div><div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>Sale-to-List</div></div>}
            {pulse.inventory != null && <div style={{ textAlign: 'center' }}><div style={{ fontSize: 18, fontWeight: 800, color: C.text, letterSpacing: '-0.02em' }}>{pulse.inventory}</div><div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>Active Listings</div></div>}
          </div>
          {pulse.medianSalePrice != null && <div style={{ marginTop: 8, fontSize: 11, color: C.muted, textAlign: 'center' }}>Median sale price: <span style={{ fontWeight: 700, color: C.text }}>{fmt(pulse.medianSalePrice)}</span>{pulse.homesSold != null && <span> · {pulse.homesSold} homes sold</span>}</div>}
        </div>
      )}

      {history && (
        <div style={{ background: C.soft, borderRadius: 10, padding: '14px 16px', marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.text }}>Home Price Trend</div>
            <div style={{ fontSize: 10, color: C.muted }}>Case-Shiller{history.metro ? ` · ${history.metro}` : ''}</div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
            {history.yoyPct   != null && <div style={{ textAlign: 'center' }}><div style={{ fontSize: 18, fontWeight: 800, color: history.yoyPct   >= 0 ? C.green : C.red, letterSpacing: '-0.02em' }}>{fmtPct(history.yoyPct)}</div><div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>1-Year</div></div>}
            {history.cagr3yr  != null && <div style={{ textAlign: 'center' }}><div style={{ fontSize: 18, fontWeight: 800, color: history.cagr3yr  >= 0 ? C.green : C.red, letterSpacing: '-0.02em' }}>{fmtPct(history.cagr3yr)}/yr</div><div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>3-Year CAGR</div></div>}
            {history.cagr5yr  != null && <div style={{ textAlign: 'center' }}><div style={{ fontSize: 18, fontWeight: 800, color: history.cagr5yr  >= 0 ? C.green : C.red, letterSpacing: '-0.02em' }}>{fmtPct(history.cagr5yr)}/yr</div><div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>5-Year CAGR</div></div>}
          </div>
          {history.trend && <div style={{ marginTop: 8, textAlign: 'center', fontSize: 11, fontWeight: 600, color: trendColor(history.trend) }}>{trendArrow(history.trend)} {history.trend.charAt(0).toUpperCase() + history.trend.slice(1)}{history.asOf && <span style={{ fontWeight: 400, color: C.muted }}> · as of {history.asOf}</span>}</div>}
        </div>
      )}

      {(vacancy || ptr != null) && (
        <div style={{ display: 'grid', gridTemplateColumns: vacancy && ptr != null ? '1fr 1fr' : '1fr', gap: 10, marginBottom: 12 }}>
          {vacancy && <div style={{ background: C.soft, borderRadius: 10, padding: '12px 14px' }}><div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: C.muted, marginBottom: 4 }}>Vacancy Rate</div><div style={{ fontSize: 20, fontWeight: 800, color: vacancy.rate <= 5 ? C.green : vacancy.rate <= 10 ? C.amber : C.red, letterSpacing: '-0.03em', lineHeight: 1 }}>{vacancy.rate?.toFixed(1)}%</div><div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>Census ACS {vacancy.asOf || ''}</div></div>}
          {ptr != null && <div style={{ background: C.soft, borderRadius: 10, padding: '12px 14px' }}><div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: C.muted, marginBottom: 4 }}>Price-to-Rent</div><div style={{ fontSize: 20, fontWeight: 800, color: ptr <= 15 ? C.green : ptr <= 25 ? C.amber : C.red, letterSpacing: '-0.03em', lineHeight: 1 }}>{ptr}x</div><div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{ptr <= 15 ? 'Strong cash flow market' : ptr <= 25 ? 'Balanced market' : 'Appreciation play'}</div></div>}
        </div>
      )}

      {score !== null && score !== undefined && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: C.soft, borderRadius: 10, padding: '12px 16px', marginBottom: 12 }}>
          <div><div style={{ fontSize: 12, fontWeight: 700, color: C.text }}>Amenity Score</div><div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>Within 0.5 mi · OpenStreetMap</div></div>
          <div style={{ textAlign: 'right' }}><div style={{ fontSize: 28, fontWeight: 800, color: scoreColor(score), letterSpacing: '-0.04em', lineHeight: 1 }}>{score}<span style={{ fontSize: 14, fontWeight: 500, color: C.muted }}>/10</span></div><div style={{ fontSize: 11, fontWeight: 600, color: scoreColor(score) }}>{scoreLabel(score)}</div></div>
        </div>
      )}

      {amenities && amenities.total !== undefined && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 8 }}>
          {[{ label: 'Grocery', val: amenities.grocery, icon: 'G' }, { label: 'Transit', val: amenities.transit, icon: 'T' }, { label: 'Dining', val: amenities.restaurants, icon: 'D' }, { label: 'Parks', val: amenities.parks, icon: 'P' }, { label: 'Schools', val: amenities.schools, icon: 'S' }].map(({ label, val, icon }) => (
            <div key={label} style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 8, padding: '8px 6px', textAlign: 'center' }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, marginBottom: 3 }}>{icon}</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: val > 0 ? C.text : C.muted }}>{val ?? '-'}</div>
              <div style={{ fontSize: 10, color: C.muted, lineHeight: 1.3 }}>{label}</div>
            </div>
          ))}
        </div>
      )}

      {schoolData && <SchoolQualityBadge schoolData={schoolData} />}

      <div style={{ fontSize: 11, color: C.muted, marginTop: 10, textAlign: 'center' }}>
        Census ACS {data.censusYear || '2023'}{pulse ? ' · Redfin' : ''}{history ? ' · S&P Case-Shiller' : ''}{schoolData ? ' · NCES CCD' : ''} · OpenStreetMap
      </div>
    </Card>
  );
}

// ── Main Results component ─────────────────────────────────────────────────────
export function Results({
  data, originalData, scenarioLabel, onReset, onRecalc, onRerunAI,
  investorProfile, onUpdateAnalysis, savedDealId,
  neighborhood, neighborhoodLoading, isEdited, isAuthed, demoUsed,
  onDemoGate, onOpenChat,
  floodData, floodLoading, schoolData, liveBenchmarks,
  climateData, climateLoading, strData, strLoading, safmrData,
}) {
  const ref = useRef(null);
  const [origOpen, setOrigOpen]         = useState(false);
  const [ddOpen, setDdOpen]             = useState(false);    // due-diligence toggle

  useEffect(() => { ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, []);

  const isScenario = scenarioLabel && originalData && data !== originalData;
  const v          = (data.verdict || 'MAYBE').toUpperCase();
  const vc         = VERDICT_CFG[v] || VERDICT_CFG.MAYBE;

  return (
    <div ref={ref}>

      {/* ── Property breadcrumb chips ── */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 18, animation: 'riq-fadeup 0.4s ease both' }}>
        {[{ t: data.address, label: 'Address' }, { t: data.propertyDetails, label: 'Property' }].filter(x => x.t).map((x, i) => (
          <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: C.white, border: `1px solid ${C.border}`, borderRadius: 100, padding: '6px 16px', fontSize: 12.5, color: C.muted }}>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: C.muted, opacity: 0.6 }}>{x.label}</span>
            {x.t}
          </span>
        ))}
      </div>

      {/* ── Scenario banner ── */}
      {isScenario && (
        <div style={{ background: C.blueBg, border: `1.5px solid ${C.blueBorder}`, borderRadius: 14, padding: '12px 18px', marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, animation: 'riq-fadeup 0.4s ease both' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: C.blue }}>↻ Viewing: {scenarioLabel}</span>
            <span style={{ fontSize: 12, color: C.muted }}>— updated live</span>
          </div>
          <button onClick={() => setOrigOpen(o => !o)} style={{ fontSize: 12, color: C.blue, background: 'none', border: `1px solid ${C.blueBorder}`, borderRadius: 8, padding: '5px 12px', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
            {origOpen ? 'Hide' : 'Show'} Original
          </button>
        </div>
      )}
      {isScenario && origOpen && (
        <div style={{ background: C.soft, border: `1px solid ${C.border}`, borderRadius: 14, padding: '18px 22px', marginBottom: 16, opacity: 0.85 }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: C.muted, marginBottom: 10 }}>Original Analysis</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8 }}>
            {(originalData.keyMetrics || []).slice(0, 8).map((m, i) => {
              const c = m.status === 'good' ? C.green : m.status === 'bad' ? C.red : C.amber;
              return <div key={i} style={{ background: C.white, borderRadius: 10, padding: '10px 12px' }}><div style={{ fontSize: 9.5, color: C.muted, textTransform: 'uppercase', marginBottom: 3 }}>{m.label}</div><div style={{ fontFamily: "'Instrument Serif',Georgia,serif", fontSize: 16, color: c }}>{m.value}</div></div>;
            })}
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════
          ZONE 1 — THE VERDICT
          ════════════════════════════════════════════════ */}

      {/* CommandCenter hero */}
      <div style={{ animation: 'riq-fadeup 0.45s ease 0.05s both' }}>
        <CommandCenter data={data} onRecalc={onRecalc} onReset={onReset} onRerunAI={onRerunAI} isEdited={isEdited} />
      </div>

      {/* Investment Analysis narrative */}
      {data.narrative && (
        <Reveal>
          <div style={{
            background: 'linear-gradient(135deg, #f0fdf4 0%, #f7fbff 100%)',
            border: `1px solid ${C.greenBorder}`,
            borderRadius: 18, padding: '28px 30px', marginBottom: 14,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
              <div style={{ width: 36, height: 36, borderRadius: 11, background: C.greenBg, border: `1px solid ${C.greenBorder}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M2 4h12M2 8h8M2 12h10" stroke={C.green} strokeWidth="1.6" strokeLinecap="round" />
                </svg>
              </div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: C.green }}>Investment Analysis</div>
                <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>AI-generated · full context</div>
              </div>
            </div>
            <p style={{ fontSize: 15, lineHeight: 1.85, color: C.textBody, margin: 0, fontWeight: 400 }}>{data.narrative}</p>
          </div>
        </Reveal>
      )}

      {/* What Would Make This a YES */}
      <Reveal><BreakEvenIntelligence data={data} /></Reveal>

      {/* Assumptions + confidence — small metadata row */}
      <Reveal>
        <AssumptionsBadge settings={data._settings} />
        <DataConfidenceBanner data={data} />
      </Reveal>

      {/* ════════════════════════════════════════════════════
          ZONE 2 — THE PROOF (2-col dashboard grid)
          ════════════════════════════════════════════════ */}
      <SectionLabel>Financial Proof</SectionLabel>

      {/* Row 1: Wealth Projection (full width — headline number) */}
      <Reveal>
        <div className="riq-lift"><WealthProjection data={data} /></div>
      </Reveal>

      {/* Row 2: Opportunity Cost — full width (may return null; must not share grid with ScoreBreakdown) */}
      <Reveal>
        <div className="riq-lift"><OpportunityCostPanel data={data} benchmarks={liveBenchmarks} /></div>
      </Reveal>

      {/* Row 3a: Score Breakdown — full width so ring never overflows and bars always have room */}
      <Reveal>
        <div className="riq-lift"><ScoreBreakdown data={data} isEdited={isEdited} /></div>
      </Reveal>

      {/* Row 4: Pros/Cons (already side-by-side internally) */}
      <Reveal delay="riq-d1"><ProsAndCons data={data} /></Reveal>

      {/* Row 5: Expense Breakdown + NOI side-by-side */}
      <Reveal delay="riq-d1">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }} className="riq-g2">
          <div className="riq-lift"><ExpenseBreakdown data={data} /></div>
          <div className="riq-lift"><NOIBreakEven data={data} /></div>
        </div>
      </Reveal>

      {/* Row 6: Key Metrics grid */}
      <Reveal delay="riq-d2"><KeyMetrics data={data} /></Reveal>

      {/* Row 7: Rent Scenarios + Stress Panel side-by-side */}
      <Reveal delay="riq-d2">
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 14 }} className="riq-g2">
          <div className="riq-lift" style={{ minWidth: 0, overflow: 'hidden' }}><RentScenarios data={data} /></div>
          <div className="riq-lift" style={{ minWidth: 0, overflow: 'hidden' }}><StressPanel data={data} /></div>
        </div>
      </Reveal>

      {/* Rent Control badge — contextual, inline */}
      <Reveal delay="riq-d3"><RentControlBadge data={data} /></Reveal>

      {/* ════════════════════════════════════════════════════
          ZONE 3 — DUE DILIGENCE (collapsed by default)
          ════════════════════════════════════════════════ */}
      <div style={{ marginTop: 8, marginBottom: 14 }}>
        <button
          onClick={() => setDdOpen(o => !o)}
          style={{
            width: '100%', background: C.white, border: `1.5px solid ${C.border}`,
            borderRadius: 14, padding: '16px 22px', cursor: 'pointer',
            fontFamily: 'inherit', display: 'flex', alignItems: 'center',
            justifyContent: 'space-between', gap: 16,
            transition: 'border-color 0.2s, box-shadow 0.2s',
            boxShadow: ddOpen ? '0 4px 16px rgba(0,0,0,0.06)' : 'none',
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = C.text; e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,0.06)'; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = ddOpen ? C.text : C.border; if (!ddOpen) e.currentTarget.style.boxShadow = 'none'; }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 32, height: 32, borderRadius: 9, background: C.soft, border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5.5" stroke={C.muted} strokeWidth="1.4"/><path d="M7 4.5v3M7 9.5v.5" stroke={C.muted} strokeWidth="1.4" strokeLinecap="round"/></svg></div>
            <div style={{ textAlign: 'left' }}>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: C.text }}>Full Due Diligence</div>
              <div style={{ fontSize: 12, color: C.muted, marginTop: 1 }}>Neighborhood · Flood · Climate · STR · Market benchmarks · Tax trends</div>
            </div>
          </div>
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" style={{ flexShrink: 0, transform: ddOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.25s ease' }}>
            <path d="M4 6.5l5 5 5-5" stroke={C.muted} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        {/* Collapsible panel — CSS max-height transition like landing page FAQ */}
        <div style={{
          maxHeight: ddOpen ? 9999 : 0,
          overflow: 'hidden',
          transition: 'max-height 0.45s cubic-bezier(.4,0,.2,1)',
        }}>
          <div style={{ paddingTop: 14, display: 'flex', flexDirection: 'column', gap: 0 }}>
            <NeighborhoodCard data={neighborhood} loading={neighborhoodLoading} schoolData={schoolData} />
            <FloodRiskCard    data={floodData}   loading={floodLoading} />
            <ClimateRiskCard  data={climateData} loading={climateLoading} />
            <SupplyDemandCard data={data} />
            <MarketBenchmarkCard data={data} safmrData={safmrData} />
            <TaxTrendBadge    data={data} />
            <STRDataCard      data={strData} loading={strLoading} analysisData={data} />
            <RentContextCard  data={data} />
            <STRBanner        data={data} />
          </div>
        </div>
      </div>

      {/* ════════════════════════════════════════════════════
          ACTIONS — Share, Chat, Scout, New Analysis
          ════════════════════════════════════════════════ */}

      {/* Demo gate */}
      {!isAuthed && demoUsed && (
        <Reveal>
          <div style={{ background: 'linear-gradient(135deg,#0d1512 0%,#0a1520 100%)', border: '1px solid rgba(74,222,128,0.2)', borderRadius: 18, padding: '24px 26px', marginBottom: 14, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', position: 'relative', overflow: 'hidden' }}>
            <div style={{ position: 'absolute', inset: 0, backgroundImage: 'linear-gradient(rgba(74,222,128,0.03) 1px,transparent 1px),linear-gradient(90deg,rgba(74,222,128,0.03) 1px,transparent 1px)', backgroundSize: '32px 32px', pointerEvents: 'none' }} />
            <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(74,222,128,0.6)', marginBottom: 6 }}>Unlock premium features</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#fff', marginBottom: 10, lineHeight: 1.3 }}>Save, export, and dig deeper into this deal</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {[{ label: 'PDF Export' }, { label: 'Share Link' }, { label: 'AI Chat' }, { label: 'Deal History' }].map(({ icon, label }) => (
                  <span key={label} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: 'rgba(74,222,128,0.08)', border: '1px solid rgba(74,222,128,0.2)', borderRadius: 8, padding: '4px 11px', fontSize: 12, color: 'rgba(74,222,128,0.8)', fontWeight: 600 }}>{label}</span>
                ))}
              </div>
            </div>
            <button onClick={onDemoGate} style={{ position: 'relative', background: 'linear-gradient(135deg,#1a7a40 0%,#166638 100%)', border: 'none', borderRadius: 12, padding: '13px 24px', fontSize: 14, fontWeight: 700, color: '#fff', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap', flexShrink: 0, boxShadow: '0 4px 20px rgba(22,102,56,0.5)', transition: 'transform 0.15s' }}
              onMouseEnter={e => e.currentTarget.style.transform = 'translateY(-2px)'}
              onMouseLeave={e => e.currentTarget.style.transform = ''}>
              Create Free Account →
            </button>
          </div>
        </Reveal>
      )}

      {isAuthed && <ShareToolbar data={data} dealId={savedDealId} />}

      {/* AI Chat CTA */}
      {isAuthed ? (
        <Reveal>
          <div style={{ background: C.green, borderRadius: 16, padding: '22px 24px', marginBottom: 14, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 14.5, fontWeight: 700, color: '#fff', marginBottom: 4 }}>Have questions about this deal?</div>
              <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.75)', lineHeight: 1.55 }}>Ask the AI anything — "What if I paid cash?", "What rent do I need?", "Is this good for appreciation?"</div>
            </div>
            <button onClick={onOpenChat} style={{ background: 'rgba(255,255,255,0.15)', border: '1.5px solid rgba(255,255,255,0.35)', borderRadius: 10, padding: '11px 22px', fontSize: 13.5, fontWeight: 700, color: '#fff', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap', flexShrink: 0, transition: 'background 0.15s' }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.25)'}
              onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.15)'}>
              Ask the AI →
            </button>
          </div>
        </Reveal>
      ) : demoUsed && (
        <Reveal>
          <div style={{ background: 'rgba(22,102,56,0.08)', border: `1px solid ${C.greenBorder}`, borderRadius: 16, padding: '20px 24px', marginBottom: 14, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: C.green, marginBottom: 3 }}>AI chat is a premium feature</div>
              <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.5 }}>Sign up free to ask the AI anything — financing scenarios, rent sensitivity, market outlook.</div>
            </div>
            <button onClick={onDemoGate} style={{ background: C.green, border: 'none', borderRadius: 10, padding: '11px 22px', fontSize: 13.5, fontWeight: 700, color: '#fff', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap', flexShrink: 0 }}>Unlock →</button>
          </div>
        </Reveal>
      )}

      {/* Re-run AI */}
      {isAuthed ? (
        <div style={{ marginBottom: 14, textAlign: 'center' }}>
          <button onClick={onRerunAI} style={{ background: C.white, border: `1.5px solid ${C.border}`, borderRadius: 10, padding: '11px 24px', fontSize: 13, fontWeight: 600, color: C.text, cursor: 'pointer', fontFamily: 'inherit', transition: 'border-color 0.15s, transform 0.15s', letterSpacing: '-0.01em' }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = C.text; e.currentTarget.style.transform = 'translateY(-1px)'; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.transform = ''; }}>
            ↻ Re-run AI analysis with current numbers
          </button>
        </div>
      ) : isEdited && (
        <div style={{ marginBottom: 14, textAlign: 'center' }}>
          <span style={{ fontSize: 12.5, color: C.muted }}>Edited the numbers? </span>
          <button onClick={onDemoGate} style={{ fontSize: 12.5, color: C.green, background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600, textDecoration: 'underline', padding: 0 }}>
            Sign up free to re-run the AI →
          </button>
        </div>
      )}

      {/* Scout upsell */}
      <Reveal>
        <div style={{ background: 'linear-gradient(135deg,#0d1f3c 0%,#1649a0 100%)', borderRadius: 16, padding: '24px 26px', marginBottom: 14, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.45)', marginBottom: 6 }}>RentalIQ Scout</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#fff', marginBottom: 5, lineHeight: 1.3 }}>
              {data.verdict === 'NO' ? "This one didn't work — find a market where the numbers do"
                : data.verdict === 'YES' ? `More deals like this exist in ${data.address?.split(',').slice(-2).join(',').trim() || 'your market'}`
                : 'Not sure about this market? Scout finds better ones'}
            </div>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)', lineHeight: 1.55 }}>Set your price range and filters. We pull real HUD + Census rent data and open targeted searches on Zillow and Redfin instantly.</div>
          </div>
          <a href={`/scout?city=${encodeURIComponent(data._settings?.city || '')}`} style={{ display: 'inline-block', background: 'rgba(255,255,255,0.12)', border: '1.5px solid rgba(255,255,255,0.25)', borderRadius: 10, padding: '13px 24px', fontSize: 13.5, fontWeight: 700, color: '#fff', textDecoration: 'none', whiteSpace: 'nowrap', flexShrink: 0, transition: 'background 0.15s, transform 0.15s' }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.22)'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.12)'; e.currentTarget.style.transform = ''; }}>
            Search This Market →
          </a>
        </div>
      </Reveal>

      {/* New analysis */}
      <Reveal>
        <div style={{ background: C.white, border: `1.5px solid ${C.border}`, borderRadius: 16, padding: '20px 24px', marginBottom: 14, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: C.text, marginBottom: 2 }}>Analyze another property</div>
            <div style={{ fontSize: 12.5, color: C.muted }}>Start fresh with a new listing or address.</div>
          </div>
          {isEdited ? <NewAnalysisBtn onReset={onReset} /> : (
            <button onClick={onReset} style={{ background: C.text, border: 'none', borderRadius: 10, padding: '11px 24px', fontSize: 13.5, fontWeight: 700, color: '#fff', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap', flexShrink: 0, transition: 'opacity 0.15s, transform 0.15s' }}
              onMouseEnter={e => { e.currentTarget.style.opacity = '0.85'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
              onMouseLeave={e => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.transform = ''; }}>
              New Analysis →
            </button>
          )}
        </div>
      </Reveal>

      {/* Disclaimer */}
      <div style={{ background: C.amberBg, border: `1px solid ${C.amberBorder}`, borderRadius: 12, padding: '13px 18px', fontSize: 12.5, color: C.amber, lineHeight: 1.6, marginBottom: 80 }}>
        Not financial advice. Verify with a licensed property manager and lender before investing.
      </div>
    </div>
  );
}
