// /compare - side-by-side comparison of 2-3 saved deals
// URL: /compare?ids=uuid1,uuid2,uuid3
// Fetches full deal data blobs from /api/deals/[id] in parallel

import { useState, useEffect } from 'react';
import { useSession }          from 'next-auth/react';
import { useRouter }           from 'next/router';
import Head                    from 'next/head';
import Link                    from 'next/link';

const C = {
  bg:'#f5f5f8', white:'#ffffff', border:'#dddde4', text:'#0d0d0f', muted:'#72727a',
  soft:'#eaeaef', textBody:'#2d2d35',
  green:'#166638', greenBg:'#ecf6f1', greenBorder:'#96ccb0',
  red:'#a62626', redBg:'#fdf0f0', redBorder:'#e0aaaa',
  amber:'#8a5800', amberBg:'#fdf4e8', amberBorder:'#dfc070',
  shadow:'0 1px 2px rgba(0,0,0,0.05), 0 2px 12px rgba(0,0,0,0.06)',
  shadowSm:'0 1px 3px rgba(0,0,0,0.04)',
};

const VERDICT_CFG = {
  YES:   { color: C.green, label: 'BUY',     bg: C.greenBg,  border: C.greenBorder },
  NO:    { color: C.red,   label: 'PASS',    bg: C.redBg,    border: C.redBorder   },
  MAYBE: { color: C.amber, label: 'CAUTION', bg: C.amberBg,  border: C.amberBorder },
};
function vc(v) { return VERDICT_CFG[(v||'MAYBE').toUpperCase()] || VERDICT_CFG.MAYBE; }

// Metrics to compare, in display order
const COMPARE_METRICS = [
  { label: 'Monthly Cash Flow',    key: 'Monthly Cash Flow',    higherBetter: true  },
  { label: 'Cash-on-Cash Return',  key: 'Cash-on-Cash',         higherBetter: true  },
  { label: 'Cap Rate',             key: 'Cap Rate',              higherBetter: true  },
  { label: '1% Rule',              key: '1% Rule',               higherBetter: true  },
  { label: 'DSCR',                 key: 'DSCR',                  higherBetter: true  },
  { label: 'GRM',                  key: 'GRM',                   higherBetter: false },
  { label: 'Total Return',         key: 'Total Return',          higherBetter: true  }, // partial matches "X-Yr Total Return"
  { label: 'Location Score',       key: 'Location Score',        higherBetter: true  },
];

const SCORE_METRICS = [
  { label: 'Cash Flow',            scoreKey: 'Cash Flow' },
  { label: 'Location',             scoreKey: 'Location'  },
  { label: 'Market Growth',        scoreKey: 'Market Growth' },
  { label: '1% Rule',              scoreKey: '1%'        },
  { label: 'Landlord Laws',        scoreKey: 'Landlord'  },
];

function parseNum(str) {
  if (!str || str === 'N/A' || str === '-') return null;
  const n = parseFloat(String(str).replace(/[^0-9.\-]/g, ''));
  return isNaN(n) ? null : n;
}

// Given values from N deals, returns index of best, index of worst (or null if tie)
function rankValues(values, higherBetter) {
  const nums = values.map(v => parseNum(v));
  const valid = nums.filter(n => n !== null);
  if (valid.length < 2) return { best: null, worst: null };
  const maxV = Math.max(...valid);
  const minV = Math.min(...valid);
  if (maxV === minV) return { best: null, worst: null };
  return {
    best:  nums.indexOf(higherBetter ? maxV : minV),
    worst: nums.indexOf(higherBetter ? minV : maxV),
  };
}

function ScoreBar({ score, color }) {
  const s = parseInt(score) || 0;
  const c = s >= 68 ? C.green : s >= 45 ? C.amber : C.red;
  const fc = color || c;
  return (
    <div style={{display:'flex',alignItems:'center',gap:8}}>
      <div style={{flex:1,height:6,background:C.soft,borderRadius:3,overflow:'hidden'}}>
        <div style={{width:`${s}%`,height:'100%',background:fc,borderRadius:3,transition:'width 0.6s ease'}}/>
      </div>
      <span style={{fontSize:12,fontWeight:700,color:fc,minWidth:28,textAlign:'right'}}>{s}</span>
    </div>
  );
}

function MetricRow({ label, values, higherBetter }) {
  const { best, worst } = rankValues(values, higherBetter);
  return (
    <tr>
      <td style={{padding:'10px 14px',fontSize:12.5,color:C.muted,fontWeight:500,borderBottom:`1px solid ${C.soft}`,whiteSpace:'nowrap',background:C.white}}>
        {label}
      </td>
      {values.map((v, i) => {
        const isBest  = best  === i;
        const isWorst = worst === i;
        const bg = isBest ? C.greenBg : isWorst ? C.redBg : C.white;
        const col= isBest ? C.green   : isWorst ? C.red   : C.text;
        return (
          <td key={i} style={{padding:'10px 14px',fontSize:13,fontWeight:isBest||isWorst?700:400,color:col,background:bg,borderBottom:`1px solid ${C.soft}`,textAlign:'center',position:'relative'}}>
            {v || '-'}
            {isBest  && <span style={{position:'absolute',top:4,right:6,fontSize:9,color:C.green,fontWeight:700,letterSpacing:'0.05em'}}>BEST</span>}
            {isWorst && <span style={{position:'absolute',top:4,right:6,fontSize:9,color:C.red,fontWeight:700,letterSpacing:'0.05em'}}>WORST</span>}
          </td>
        );
      })}
    </tr>
  );
}

export default function ComparePage() {
  const { data: session, status } = useSession();
  const router  = useRouter();
  const [deals,   setDeals]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

  useEffect(() => {
    if (status === 'unauthenticated') { router.replace('/auth'); return; }
    if (status !== 'authenticated') return;
    if (!router.isReady) return;

    const rawIds = (router.query.ids || '').split(',').map(s => s.trim()).filter(Boolean);
    const ids    = rawIds.slice(0, 3); // max 3
    if (ids.length < 2) { setError('Select at least 2 deals from your dashboard to compare.'); setLoading(false); return; }

    Promise.all(
      ids.map(id =>
        fetch(`/api/deals/${id}`)
          .then(r => r.json())
          .then(({ deal }) => deal)
      )
    )
    .then(results => {
      const valid = results.filter(d => d?.data);
      if (valid.length < 2) { setError('Could not load deal data. Try again from your dashboard.'); return; }
      setDeals(valid);
    })
    .catch(() => setError('Failed to load deals.'))
    .finally(() => setLoading(false));
  }, [status, router.isReady, router.query.ids]);

  // Per-deal helpers
  function getMetric(deal, key) {
    if (!deal?.data) return null;
    const m = (deal.data.keyMetrics || []).find(m => m.label === key || m.label?.includes(key));
    return m?.value || null;
  }
  function getScoreSection(deal, key) {
    if (!deal?.data) return null;
    const s = (deal.data.scoreBreakdown || []).find(s => s.name?.includes(key));
    return s?.score ?? null;
  }

  const n = deals.length;

  return (
    <>
      <Head>
        <title>Compare Deals - RentalIQ</title>
        <meta name="robots" content="noindex"/>
        <meta name="viewport" content="width=device-width, initial-scale=1"/>
      </Head>
      <style>{`
        body{background:${C.bg};font-family:'DM Sans',system-ui,sans-serif;margin:0}
        @keyframes fadeup{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
        @keyframes spin{to{transform:rotate(360deg)}}
        table{border-collapse:collapse;width:100%}
        @media(max-width:700px){
          .compare-header-grid{grid-template-columns:1fr!important}
          .sticky-col{position:relative!important;left:auto!important}
        }
      `}</style>

      {/* Nav */}
      <nav style={{background:'rgba(245,245,248,0.88)',backdropFilter:'blur(12px)',WebkitBackdropFilter:'blur(12px)',borderBottom:`1px solid ${C.border}`,padding:'0 32px',position:'sticky',top:0,zIndex:100}}>
        <div style={{maxWidth:1200,margin:'0 auto',height:52,display:'flex',alignItems:'center',justifyContent:'space-between'}}>
          <div style={{display:'flex',alignItems:'center',gap:8}}>
            <Link href="/" style={{display:'flex',alignItems:'center',gap:8,textDecoration:'none'}}>
              <div style={{width:8,height:8,background:C.green,borderRadius:'50%'}}/>
              <span style={{fontSize:13,fontWeight:700,color:C.text,letterSpacing:'-0.01em'}}>RentalIQ</span>
            </Link>
            <div style={{display:'inline-flex',background:C.soft,borderRadius:10,padding:3,gap:3,marginLeft:8}}>
              <Link href="/analyze" style={{display:'block',padding:'5px 14px',borderRadius:8,fontSize:12.5,fontWeight:600,color:C.muted,textDecoration:'none'}}>Analyze a Listing</Link>
              <Link href="/scout" style={{display:'block',padding:'5px 14px',borderRadius:8,fontSize:12.5,fontWeight:600,color:C.muted,textDecoration:'none'}}>Find My Market</Link>
              <Link href="/dashboard" style={{display:'block',padding:'5px 14px',borderRadius:8,background:C.white,fontSize:12.5,fontWeight:700,color:C.text,textDecoration:'none',boxShadow:C.shadowSm}}>My Deals</Link>
            </div>
          </div>
          <span style={{fontSize:12,color:C.muted}}>{n > 0 ? `Comparing ${n} deal${n>1?'s':''}` : 'Compare'}</span>
        </div>
      </nav>

      <div style={{maxWidth:1200,margin:'0 auto',padding:'28px 20px 80px'}}>

        {/* Loading */}
        {loading && (
          <div style={{display:'flex',alignItems:'center',gap:12,color:C.muted,fontSize:14,marginTop:40}}>
            <div style={{width:20,height:20,border:`2px solid ${C.border}`,borderTopColor:C.green,borderRadius:'50%',animation:'spin 0.7s linear infinite'}}/>
            Loading deals...
          </div>
        )}

        {/* Error */}
        {!loading && error && (
          <div style={{marginTop:40,background:C.amberBg,border:`1px solid ${C.amberBorder}`,borderRadius:14,padding:'20px 24px',color:C.amber,fontSize:14}}>
            {error}
            <div style={{marginTop:12}}>
              <Link href="/dashboard" style={{fontSize:13,fontWeight:600,color:C.green,textDecoration:'none'}}>← Go to My Deals</Link>
            </div>
          </div>
        )}

        {/* Comparison */}
        {!loading && deals.length >= 2 && (
          <div style={{animation:'fadeup 0.3s ease both'}}>

            {/* -- Header cards per deal -- */}
            <div className="compare-header-grid" style={{display:'grid',gridTemplateColumns:`repeat(${n}, 1fr)`,gap:14,marginBottom:24}}>
              {deals.map((deal, i) => {
                const cfg = vc(deal.data.verdict);
                const score = deal.data.overallScore || 0;
                const scoreColor = score >= 68 ? C.green : score >= 45 ? C.amber : C.red;
                return (
                  <div key={i} style={{background:C.white,border:`2px solid ${cfg.border}`,borderRadius:14,padding:'20px 22px',boxShadow:C.shadow}}>
                    {/* Verdict */}
                    <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:12}}>
                      <span style={{fontSize:22,fontWeight:800,color:cfg.color,letterSpacing:'-0.03em'}}>{cfg.label}</span>
                      <div style={{textAlign:'right'}}>
                        <div style={{fontSize:10,color:C.muted,textTransform:'uppercase',letterSpacing:'0.08em'}}>Score</div>
                        <div style={{fontSize:22,fontWeight:700,color:scoreColor,lineHeight:1}}>{score}<span style={{fontSize:11,color:C.muted}}>/100</span></div>
                      </div>
                    </div>
                    {/* Address */}
                    <div style={{fontSize:14,fontWeight:600,color:C.text,marginBottom:4,lineHeight:1.3,overflow:'hidden',display:'-webkit-box',WebkitLineClamp:2,WebkitBoxOrient:'vertical'}}>
                      {deal.data.address || deal.data.assumedPrice || `Deal ${i+1}`}
                    </div>
                    {deal.data.propertyDetails && (
                      <div style={{fontSize:12,color:C.muted,marginBottom:12}}>{deal.data.propertyDetails}</div>
                    )}
                    {/* Key trio */}
                    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
                      {[
                        { l:'Price',    v: deal.data.assumedPrice },
                        { l:'Rent',     v: deal.data.assumedRent  },
                        { l:'Cash Flow',v: getMetric(deal, 'Monthly Cash Flow') },
                        { l:'CoC',      v: getMetric(deal, 'Cash-on-Cash') },
                      ].map(({ l, v }) => v && (
                        <div key={l} style={{background:C.soft,borderRadius:8,padding:'8px 10px'}}>
                          <div style={{fontSize:9.5,color:C.muted,fontWeight:600,textTransform:'uppercase',letterSpacing:'0.07em',marginBottom:2}}>{l}</div>
                          <div style={{fontSize:13.5,fontWeight:700,color:C.text}}>{v}</div>
                        </div>
                      ))}
                    </div>
                    {/* Verdict summary */}
                    {deal.data.verdictSummary && (
                      <div style={{fontSize:11.5,color:C.muted,lineHeight:1.5,marginTop:10,paddingTop:10,borderTop:`1px solid ${C.border}`}}>
                        {deal.data.verdictSummary}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* -- Key metrics comparison table -- */}
            <div style={{background:C.white,border:`1px solid ${C.border}`,borderRadius:14,overflow:'hidden',boxShadow:C.shadow,marginBottom:20}}>
              <div style={{padding:'16px 20px',borderBottom:`1px solid ${C.border}`,display:'flex',alignItems:'center',justifyContent:'space-between'}}>
                <div style={{fontSize:11,fontWeight:700,letterSpacing:'0.09em',textTransform:'uppercase',color:C.muted}}>Key Metrics</div>
                <div style={{fontSize:11,color:C.muted}}>
                  <span style={{display:'inline-block',width:8,height:8,background:C.green,borderRadius:2,marginRight:4}}/>best
                  <span style={{display:'inline-block',width:8,height:8,background:C.red,borderRadius:2,margin:'0 4px 0 10px'}}/>worst
                </div>
              </div>
              <div style={{overflowX:'auto'}}>
                <table>
                  <thead>
                    <tr style={{background:C.soft}}>
                      <th style={{padding:'8px 14px',textAlign:'left',fontSize:11,fontWeight:600,color:C.muted,textTransform:'uppercase',letterSpacing:'0.06em',width:'28%'}}>Metric</th>
                      {deals.map((deal, i) => (
                        <th key={i} style={{padding:'8px 14px',textAlign:'center',fontSize:11.5,fontWeight:700,color:C.text,minWidth:140}}>
                          {deal.data?.address?.split(',')[0] || `Deal ${i+1}`}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {/* Overall score row */}
                    <tr>
                      <td style={{padding:'10px 14px',fontSize:12.5,color:C.muted,fontWeight:500,borderBottom:`1px solid ${C.soft}`,background:C.white}}>Overall Score</td>
                      {(() => {
                        const vals = deals.map(d => String(d.data.overallScore ?? ''));
                        const { best, worst } = rankValues(vals, true);
                        return deals.map((deal, i) => {
                          const s = deal.data.overallScore || 0;
                          const isBest = best === i;
                          const isWorst = worst === i;
                          const sc = s >= 68 ? C.green : s >= 45 ? C.amber : C.red;
                          return (
                            <td key={i} style={{padding:'10px 14px',textAlign:'center',borderBottom:`1px solid ${C.soft}`,background:isBest?C.greenBg:isWorst?C.redBg:C.white,position:'relative'}}>
                              <ScoreBar score={s} color={sc}/>
                              {isBest  && <span style={{position:'absolute',top:4,right:6,fontSize:9,color:C.green,fontWeight:700}}>BEST</span>}
                              {isWorst && <span style={{position:'absolute',top:4,right:6,fontSize:9,color:C.red,  fontWeight:700}}>WORST</span>}
                            </td>
                          );
                        });
                      })()}
                    </tr>
                    {COMPARE_METRICS.map(m => (
                      <MetricRow
                        key={m.key}
                        label={m.label}
                        values={deals.map(d => getMetric(d, m.key))}
                        higherBetter={m.higherBetter}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* -- Score breakdown comparison -- */}
            <div style={{background:C.white,border:`1px solid ${C.border}`,borderRadius:14,overflow:'hidden',boxShadow:C.shadow,marginBottom:20}}>
              <div style={{padding:'16px 20px',borderBottom:`1px solid ${C.border}`}}>
                <div style={{fontSize:11,fontWeight:700,letterSpacing:'0.09em',textTransform:'uppercase',color:C.muted}}>Score Breakdown</div>
              </div>
              <div style={{padding:'16px 20px'}}>
                {SCORE_METRICS.map(sm => {
                  const vals = deals.map(d => getScoreSection(d, sm.scoreKey));
                  const { best, worst } = rankValues(vals.map(String), true);
                  return (
                    <div key={sm.label} style={{marginBottom:14}}>
                      <div style={{fontSize:11.5,color:C.muted,fontWeight:500,marginBottom:6}}>{sm.label}</div>
                      <div style={{display:'grid',gridTemplateColumns:`repeat(${n},1fr)`,gap:10}}>
                        {vals.map((v, i) => {
                          const s = parseInt(v) || 0;
                          const isBest = best === i;
                          const isWorst = worst === i;
                          const fc = isBest ? C.green : isWorst ? C.red : (s>=68?C.green:s>=45?C.amber:C.red);
                          return (
                            <div key={i} style={{background:isBest?C.greenBg:isWorst?C.redBg:C.soft,borderRadius:8,padding:'6px 10px',border:`1px solid ${isBest?C.greenBorder:isWorst?C.redBorder:C.border}`}}>
                              <div style={{fontSize:9.5,color:C.muted,marginBottom:3,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                                {deals[i]?.address?.split(',')[0] || `Deal ${i+1}`}
                              </div>
                              <ScoreBar score={s} color={fc}/>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* -- Pros & cons side by side -- */}
            <div style={{background:C.white,border:`1px solid ${C.border}`,borderRadius:14,overflow:'hidden',boxShadow:C.shadow,marginBottom:20}}>
              <div style={{padding:'16px 20px',borderBottom:`1px solid ${C.border}`}}>
                <div style={{fontSize:11,fontWeight:700,letterSpacing:'0.09em',textTransform:'uppercase',color:C.muted}}>Strengths & Risks</div>
              </div>
              <div style={{display:'grid',gridTemplateColumns:`repeat(${n},1fr)`,gap:0}}>
                {deals.map((deal, i) => (
                  <div key={i} style={{padding:'16px 20px',borderRight:i<n-1?`1px solid ${C.border}`:'none'}}>
                    <div style={{fontSize:11.5,fontWeight:700,color:C.text,marginBottom:8,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                      {deal.data.address?.split(',')[0] || `Deal ${i+1}`}
                    </div>
                    <div style={{marginBottom:12}}>
                      {(deal.data.pros || []).slice(0,3).map((p, j) => (
                        <div key={j} style={{fontSize:12,color:C.text,lineHeight:1.5,marginBottom:5,display:'flex',gap:6}}>
                          <span style={{color:C.green,fontWeight:700,flexShrink:0}}>+</span>
                          <span>{p}</span>
                        </div>
                      ))}
                    </div>
                    <div>
                      {(deal.data.cons || []).slice(0,3).map((c, j) => (
                        <div key={j} style={{fontSize:12,color:C.text,lineHeight:1.5,marginBottom:5,display:'flex',gap:6}}>
                          <span style={{color:C.red,fontWeight:700,flexShrink:0}}>−</span>
                          <span>{c}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* -- Projection comparison -- */}
            {deals.some(d => d.data.projection) && (
              <div style={{background:C.white,border:`1px solid ${C.border}`,borderRadius:14,overflow:'hidden',boxShadow:C.shadow,marginBottom:20}}>
                <div style={{padding:'16px 20px',borderBottom:`1px solid ${C.border}`}}>
                  <div style={{fontSize:11,fontWeight:700,letterSpacing:'0.09em',textTransform:'uppercase',color:C.muted}}>Wealth Projection</div>
                </div>
                <div style={{overflowX:'auto'}}>
                  <table>
                    <thead>
                      <tr style={{background:C.soft}}>
                        <th style={{padding:'8px 14px',textAlign:'left',fontSize:11,fontWeight:600,color:C.muted,textTransform:'uppercase',letterSpacing:'0.06em'}}>Item</th>
                        {deals.map((d,i) => {
                          const holdYrs = d.data._settings?.holdingYears || 5;
                          return (
                            <th key={i} style={{padding:'8px 14px',textAlign:'center',fontSize:11.5,fontWeight:700,color:C.text,minWidth:130}}>
                              {d.data.address?.split(',')[0] || `Deal ${i+1}`}
                              {holdYrs !== 5 && <span style={{display:'block',fontSize:10,color:C.muted,fontWeight:400}}>{holdYrs}yr hold</span>}
                            </th>
                          );
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        { l:'Total Return',      fn:(d)=>{ const h=d.data._settings?.holdingYears||5; return d.data.projection?.[`totalReturn${h}yr`]||d.data.projection?.totalReturn5yr||null; }, hi:true  },
                        { l:'Cash Flow (hold)',  fn:(d)=>{ const h=d.data._settings?.holdingYears||5; return d.data.projection?.[`cashflow${h}yr`]||d.data.projection?.cashflow5yr||null; },      hi:true  },
                        { l:'Appreciation',      fn:(d)=>{ const h=d.data._settings?.holdingYears||5; return d.data.projection?.[`appreciation${h}yr`]||d.data.projection?.appreciation5yr||null; }, hi:true },
                        { l:'Loan Pay-Down',     fn:(d)=>{ const h=d.data._settings?.holdingYears||5; return d.data.projection?.[`loanPaydown${h}yr`]||d.data.projection?.loanPaydown5yr||null; }, hi:true  },
                        { l:'Cash Invested',     fn:(d)=>d.data.projection?.cashInvested||null,        hi:false },
                        { l:'IRR / Ann. Return', fn:(d)=>d.data.projection?.annualizedReturnPct||null, hi:true  },
                      ].map(({ l, fn, hi }) => (
                        <MetricRow
                          key={l}
                          label={l}
                          values={deals.map(d => fn(d))}
                          higherBetter={hi}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* -- Bottom actions -- */}
            <div style={{display:'flex',gap:12,flexWrap:'wrap'}}>
              <Link href="/dashboard"
                style={{fontSize:13.5,fontWeight:600,color:C.text,background:C.white,border:`1px solid ${C.border}`,borderRadius:10,padding:'10px 20px',textDecoration:'none'}}>
                ← Back to Dashboard
              </Link>
              <Link href="/"
                style={{fontSize:13.5,fontWeight:600,color:'#fff',background:C.green,border:'none',borderRadius:10,padding:'10px 20px',textDecoration:'none'}}>
                Analyze Another Property →
              </Link>
            </div>

          </div>
        )}
      </div>
    </>
  );
}
