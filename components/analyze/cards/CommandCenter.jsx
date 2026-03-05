import { useState, useEffect, useRef } from 'react';
import { C, clamp, scoreColor, VERDICT_CFG } from '../tokens';
import { Label, Card, AnimatedBar, InlineEdit, NewAnalysisBtn } from '../InputComponents';

function Counter({ to, duration = 1200 }) {
  const [val, setVal] = useState(0);
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const start = performance.now();
    const tick = (now) => {
      const p = Math.min((now - start) / duration, 1);
      const ease = 1 - Math.pow(1 - p, 3);
      setVal(Math.round(ease * to));
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, [to, duration]);
  return <span>{val}</span>;
}

export function CommandCenter({ data, onRecalc, onReset, onRerunAI, isEdited }) {
  const freshness = data._marketFreshness || {};
  const ratesDate = freshness.mortgageRates
    ? new Date(freshness.mortgageRates).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : null;

  const v        = (data.verdict || 'MAYBE').toUpperCase();
  const vc       = VERDICT_CFG[v] || VERDICT_CFG.MAYBE;
  const s        = data._settings || {};
  const score    = clamp(parseInt(data.overallScore, 10) || 0, 0, 100);
  const scoreCol = scoreColor(score);
  const holdYrs  = s.holdingYears || 5;

  const cf  = data.keyMetrics?.find(m => m.label === 'Monthly Cash Flow');
  const coc = data.keyMetrics?.find(m => m.label === 'Cash-on-Cash');
  const ret = data.keyMetrics?.find(m => m.label?.includes('Total Return'));

  const price = (data.assumedPrice || '').replace(/[^0-9.]/g, '');
  const rent  = (data.assumedRent  || '').replace(/[^0-9.]/g, '');
  function edit(key, val) { onRecalc({ [key]: val }); }

  const glowColor = v === 'YES' ? 'rgba(22,102,56,0.08)'
    : v === 'NO' ? 'rgba(166,38,38,0.07)'
    : 'rgba(138,88,0,0.07)';

  return (
    <div style={{
      position: 'relative', background: C.white,
      border: `1px solid ${C.border}`, borderRadius: 20,
      overflow: 'hidden', marginBottom: 14,
      boxShadow: '0 4px 24px rgba(0,0,0,0.06), 0 1px 3px rgba(0,0,0,0.04)',
    }}>
      {/* Verdict accent bar */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: vc.color }} />
      {/* Radial glow */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 220,
        background: `radial-gradient(ellipse 90% 140px at 25% 0%, ${glowColor} 0%, transparent 70%)`,
        pointerEvents: 'none',
      }} />

      <div style={{ position: 'relative', padding: '38px 32px 30px' }}>

        {/* Top row: verdict + score */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 6, gap: 20 }}>
          <div style={{ animation: 'riq-fadeup 0.45s ease both' }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: C.muted, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 7 }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: vc.color, flexShrink: 0, animation: 'riq-pulse 2.4s ease-in-out infinite' }} />
              AI Verdict
            </div>
            <div style={{ fontFamily: "'Libre Baskerville', Georgia, serif", fontSize: 'clamp(54px, 8vw, 74px)', fontWeight: 700, letterSpacing: '-0.04em', lineHeight: 1, color: vc.color, marginBottom: 14 }}>
              {vc.label}
            </div>
            <div style={{ fontSize: 14.5, color: C.muted, lineHeight: 1.65, maxWidth: 360 }}>
              {isEdited
                ? <em style={{ color: C.amber }}>Numbers edited — re-run AI for updated verdict →</em>
                : (data.verdictSummary || vc.sub)}
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 14, flexShrink: 0, animation: 'riq-fadeup 0.45s ease 0.1s both' }}>
            {isEdited ? <NewAnalysisBtn onReset={onReset} /> : (
              <button onClick={onReset} style={{ fontSize: 12, color: C.muted, background: 'none', border: `1px solid ${C.border}`, borderRadius: 8, padding: '6px 14px', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap', transition: 'border-color 0.15s' }}
                onMouseEnter={e => e.currentTarget.style.borderColor = C.text}
                onMouseLeave={e => e.currentTarget.style.borderColor = C.border}>
                New Analysis
              </button>
            )}
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 10, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.10em', marginBottom: 5 }}>RentalIQ Score</div>
              <div style={{ fontFamily: "'Libre Baskerville', Georgia, serif", fontSize: 44, fontWeight: 700, color: scoreCol, letterSpacing: '-0.05em', lineHeight: 1 }}>
                <Counter to={score} /><span style={{ fontSize: 16, color: C.muted, fontWeight: 400 }}>/100</span>
              </div>
            </div>
          </div>
        </div>

        {/* Freshness badge */}
        {ratesDate && (
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 28, padding: '4px 12px 4px 9px', background: C.greenBg, border: `1px solid ${C.greenBorder}`, borderRadius: 100, animation: 'riq-fadeup 0.45s ease 0.12s both' }}>
            <div style={{ width: 5, height: 5, borderRadius: '50%', background: C.green }} />
            <span style={{ fontSize: 11, color: C.green, fontWeight: 600 }}>Rates as of {ratesDate} · HUD · FRED · BLS</span>
          </div>
        )}

        {/* 3 headline metrics */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginBottom: 28, animation: 'riq-fadeup 0.45s ease 0.14s both' }} className="riq-g3">
          {[
            { label: 'Cash Flow / mo', metric: cf,  large: true },
            { label: 'Cash-on-Cash',   metric: coc, large: false },
            { label: `${holdYrs}-Yr Return`, metric: ret, large: false },
          ].map(({ label, metric, large }, i) => {
            if (!metric) return null;
            const col = metric.status === 'good' ? C.green : metric.status === 'bad' ? C.red : C.amber;
            return (
              <div key={i} style={{ background: C.soft, borderRadius: 14, padding: '16px 18px', transition: 'transform 0.2s ease, box-shadow 0.2s ease', cursor: 'default' }}
                onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.boxShadow = '0 8px 24px rgba(0,0,0,0.09)'; }}
                onMouseLeave={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = ''; }}>
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.10em', textTransform: 'uppercase', color: C.muted, marginBottom: 8 }}>{label}</div>
                <div style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontSize: large ? 30 : 22, color: col, lineHeight: 1 }}>{metric.value}</div>
              </div>
            );
          })}
        </div>

        {/* Inline editor */}
        <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 22, animation: 'riq-fadeup 0.45s ease 0.18s both' }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.10em', textTransform: 'uppercase', color: C.muted, marginBottom: 16 }}>
            Edit inputs — results update instantly
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'flex-end' }}>
            {[
              { label: 'Price',     val: price,                              onChange: v => edit('price', v),           prefix: '$' },
              { label: 'Rent / mo', val: rent,                               onChange: v => edit('rent', v),            prefix: '$' },
              ...(!s.cashPurchase ? [
                { label: 'Down',   val: String(s.downPaymentPct || 20),      onChange: v => edit('downPaymentPct', v),  suffix: '%' },
                { label: 'Rate',   val: String(s.interestRate   || 6.99),    onChange: v => edit('interestRate', v),    suffix: '%' },
              ] : []),
              { label: 'Tax rate',  val: String((s.taxRate || 1.1).toFixed(2)), onChange: v => edit('taxRate', v),    suffix: '%/yr' },
            ].map(({ label, val, onChange, prefix, suffix }) => (
              <div key={label}>
                <div style={{ fontSize: 10, color: C.muted, marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</div>
                <InlineEdit value={val} onChange={onChange} prefix={prefix} suffix={suffix} large={false} />
              </div>
            ))}
          </div>

          {isEdited && (
            <div style={{ marginTop: 20, background: 'linear-gradient(135deg,#fffbeb 0%,#fef3c7 100%)', border: `1.5px solid ${C.amberBorder}`, borderRadius: 14, padding: '16px 20px' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: C.amber, marginBottom: 5, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="6" stroke="#92400e" strokeWidth="1.4" /><path d="M7 4v3.5M7 9.5v.5" stroke="#92400e" strokeWidth="1.4" strokeLinecap="round" /></svg>
                    Numbers edited — verdict from original scenario
                  </div>
                  <div style={{ fontSize: 12, color: '#92400e', lineHeight: 1.5 }}>Financials are live. Re-run AI to refresh verdict, narrative, and pros/cons.</div>
                </div>
                <button onClick={onRerunAI} style={{ fontSize: 13, fontWeight: 700, color: '#fff', background: C.amber, border: 'none', borderRadius: 10, padding: '11px 20px', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap', flexShrink: 0, boxShadow: '0 2px 10px rgba(180,83,9,0.3)', transition: 'transform 0.15s' }}
                  onMouseEnter={e => e.currentTarget.style.transform = 'translateY(-1px)'}
                  onMouseLeave={e => e.currentTarget.style.transform = ''}>
                  ↻ Re-run AI
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
