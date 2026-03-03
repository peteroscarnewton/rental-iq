import { useState, useEffect, useRef } from 'react';
import { C, VERDICT_CFG, clamp } from './tokens';
import { Label, Card, Pill, AnimatedBar } from './InputComponents';
import {
  StressPanel, CommandCenter, WealthProjection, OpportunityCostPanel,
  FloodRiskCard, SupplyDemandCard, SchoolQualityBadge, AssumptionsBadge,
  DataConfidenceBanner, MarketBenchmarkCard, RentControlBadge, TaxTrendBadge,
  STRRegBadge, ClimateRiskCard, STRDataCard, RentContextCard, STRBanner,
  KeyMetrics, NOIBreakEven, ExpenseBreakdown, RentScenarios, ScoreRing,
  ScoreBreakdown, BreakEvenIntelligence, ProsAndCons,
} from './cards/index';
import { ShareToolbar, FloatingChat } from './Overlays';

export function NeighborhoodCard({ data, loading, schoolData }) {
  if (!loading && !data) return null;

  const fmt  = n => n != null ? '$' + n.toLocaleString() : '-';
  const fmtK = n => n != null ? (n >= 1000 ? (n/1000).toFixed(0) + 'k' : n.toLocaleString()) : '-';
  const fmtPct = n => n != null ? `${n > 0 ? '+' : ''}${n.toFixed(1)}%` : null;

  const scoreColor = s => s === null ? C.muted : s >= 7 ? C.green : s >= 4 ? C.amber : C.red;
  const scoreLabel = s => s === null ? '-' : s >= 7 ? 'High' : s >= 4 ? 'Moderate' : 'Low';

  const tempColor = t => t === 'hot' ? C.red : t === 'warm' ? C.amber : t === 'cool' ? C.blue : t === 'cold' ? C.blue : C.muted;
  const tempLabel = t => ({ hot:'🔥 Hot', warm:'📈 Warm', neutral:'➡️ Neutral', cool:'📉 Cool', cold:'❄️ Cold' })[t] || t;

  const trendColor = t => t === 'accelerating' ? C.green : t === 'decelerating' ? C.amber : C.muted;
  const trendArrow = t => t === 'accelerating' ? '↗' : t === 'decelerating' ? '↘' : '→';

  if (loading) {
    return (
      <Card>
        <Label>Neighborhood</Label>
        <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:10,marginTop:8}}>
          {[1,2,3,4,5,6,7,8].map(i=>(
            <div key={i} style={{height:48,background:C.soft,borderRadius:8,
              animation:'riq-pulse 1.4s ease-in-out infinite',animationDelay:`${i*0.1}s`}}/>
          ))}
        </div>
        <style>{`@keyframes riq-pulse{0%,100%{opacity:1}50%{opacity:0.4}}`}</style>
      </Card>
    );
  }

  const amenities   = data.amenities   || {};
  const score       = data.amenityScore;
  const pulse       = data.marketPulse  || null;
  const history     = data.priceHistory || null;
  const vacancy     = data.vacancyRate  || null;
  const ptr         = data.priceToRentRatio;

  return (
    <Card>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:14,flexWrap:'wrap',gap:8}}>
        <Label>Neighborhood</Label>
        <div style={{display:'flex',gap:6,alignItems:'center',flexWrap:'wrap'}}>
          {data.zip   && <Pill>{data.zip}</Pill>}
          {data.state && <Pill>{data.state}</Pill>}
          {data.walkability && data.walkability !== 'Unknown' && (
            <Pill style={{background: data.walkability==='Urban'?C.greenBg:data.walkability==='Suburban'?C.blueBg:C.soft,
              color: data.walkability==='Urban'?C.green:data.walkability==='Suburban'?C.blue:C.muted,
              border:`1px solid ${data.walkability==='Urban'?C.greenBorder:data.walkability==='Suburban'?C.blueBorder:C.border}`}}>
              {data.walkability}
            </Pill>
          )}
          {pulse?.marketTemp && (
            <Pill style={{background: pulse.marketTemp==='hot'?C.redBg : pulse.marketTemp==='warm'?C.amberBg : C.soft,
              color: tempColor(pulse.marketTemp),
              border:`1px solid ${pulse.marketTemp==='hot'?C.redBorder : pulse.marketTemp==='warm'?C.amberBorder : C.border}`}}>
              {tempLabel(pulse.marketTemp)}
            </Pill>
          )}
        </div>
      </div>

      {/* Demographics row */}
      <div className="riq-g3" style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:10,marginBottom:12}}>
        <div style={{background:C.soft,borderRadius:10,padding:'12px 14px'}}>
          <div style={{fontSize:10,fontWeight:700,letterSpacing:'0.08em',textTransform:'uppercase',color:C.muted,marginBottom:4}}>Median Income</div>
          <div style={{fontSize:20,fontWeight:800,color:C.text,letterSpacing:'-0.03em',lineHeight:1}}>{fmt(data.medianIncome)}</div>
          <div style={{fontSize:11,color:C.muted,marginTop:2}}>household / yr</div>
        </div>
        <div style={{background:C.soft,borderRadius:10,padding:'12px 14px'}}>
          <div style={{fontSize:10,fontWeight:700,letterSpacing:'0.08em',textTransform:'uppercase',color:C.muted,marginBottom:4}}>Median Rent</div>
          <div style={{fontSize:20,fontWeight:800,color:C.text,letterSpacing:'-0.03em',lineHeight:1}}>{fmt(data.medianRent)}</div>
          <div style={{fontSize:11,color:C.muted,marginTop:2}}>per month</div>
        </div>
        <div style={{background:C.soft,borderRadius:10,padding:'12px 14px'}}>
          <div style={{fontSize:10,fontWeight:700,letterSpacing:'0.08em',textTransform:'uppercase',color:C.muted,marginBottom:4}}>Population</div>
          <div style={{fontSize:20,fontWeight:800,color:C.text,letterSpacing:'-0.03em',lineHeight:1}}>{fmtK(data.population)}</div>
          <div style={{fontSize:11,color:C.muted,marginTop:2}}>ZIP code</div>
        </div>
      </div>

      {/* Market Pulse — Redfin weekly data */}
      {pulse && (
        <div style={{background:C.soft,borderRadius:10,padding:'14px 16px',marginBottom:12}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
            <div style={{fontSize:12,fontWeight:700,color:C.text}}>📊 Market Pulse</div>
            <div style={{fontSize:10,color:C.muted}}>Redfin · {pulse.asOf || 'weekly'}</div>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:8}}>
            {pulse.dom != null && (
              <div style={{textAlign:'center'}}>
                <div style={{fontSize:18,fontWeight:800,color:pulse.dom<=14?C.red:pulse.dom<=30?C.amber:C.blue,letterSpacing:'-0.02em'}}>{pulse.dom}</div>
                <div style={{fontSize:10,color:C.muted,marginTop:2}}>Days on Market</div>
              </div>
            )}
            {pulse.saleToList != null && (
              <div style={{textAlign:'center'}}>
                <div style={{fontSize:18,fontWeight:800,color:pulse.saleToList>=1.02?C.red:pulse.saleToList>=0.99?C.amber:C.blue,letterSpacing:'-0.02em'}}>
                  {(pulse.saleToList * 100).toFixed(1)}%
                </div>
                <div style={{fontSize:10,color:C.muted,marginTop:2}}>Sale-to-List</div>
              </div>
            )}
            {pulse.inventory != null && (
              <div style={{textAlign:'center'}}>
                <div style={{fontSize:18,fontWeight:800,color:C.text,letterSpacing:'-0.02em'}}>{pulse.inventory}</div>
                <div style={{fontSize:10,color:C.muted,marginTop:2}}>Active Listings</div>
              </div>
            )}
          </div>
          {pulse.medianSalePrice != null && (
            <div style={{marginTop:8,fontSize:11,color:C.muted,textAlign:'center'}}>
              Median sale price: <span style={{fontWeight:700,color:C.text}}>{fmt(pulse.medianSalePrice)}</span>
              {pulse.homesSold != null && <span> · {pulse.homesSold} homes sold this period</span>}
            </div>
          )}
        </div>
      )}

      {/* Price History — Case-Shiller */}
      {history && (
        <div style={{background:C.soft,borderRadius:10,padding:'14px 16px',marginBottom:12}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
            <div style={{fontSize:12,fontWeight:700,color:C.text}}>🏠 Home Price Trend</div>
            <div style={{fontSize:10,color:C.muted}}>Case-Shiller{history.metro ? ` · ${history.metro}` : ''}</div>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:8}}>
            {history.yoyPct != null && (
              <div style={{textAlign:'center'}}>
                <div style={{fontSize:18,fontWeight:800,color:history.yoyPct>=0?C.green:C.red,letterSpacing:'-0.02em'}}>
                  {fmtPct(history.yoyPct)}
                </div>
                <div style={{fontSize:10,color:C.muted,marginTop:2}}>1-Year</div>
              </div>
            )}
            {history.cagr3yr != null && (
              <div style={{textAlign:'center'}}>
                <div style={{fontSize:18,fontWeight:800,color:history.cagr3yr>=0?C.green:C.red,letterSpacing:'-0.02em'}}>
                  {fmtPct(history.cagr3yr)}/yr
                </div>
                <div style={{fontSize:10,color:C.muted,marginTop:2}}>3-Year CAGR</div>
              </div>
            )}
            {history.cagr5yr != null && (
              <div style={{textAlign:'center'}}>
                <div style={{fontSize:18,fontWeight:800,color:history.cagr5yr>=0?C.green:C.red,letterSpacing:'-0.02em'}}>
                  {fmtPct(history.cagr5yr)}/yr
                </div>
                <div style={{fontSize:10,color:C.muted,marginTop:2}}>5-Year CAGR</div>
              </div>
            )}
          </div>
          {history.trend && (
            <div style={{marginTop:8,textAlign:'center',fontSize:11,fontWeight:600,color:trendColor(history.trend)}}>
              {trendArrow(history.trend)} {history.trend.charAt(0).toUpperCase() + history.trend.slice(1)}
              {history.asOf && <span style={{fontWeight:400,color:C.muted}}> · as of {history.asOf}</span>}
            </div>
          )}
        </div>
      )}

      {/* Vacancy Rate + Price-to-Rent Ratio row */}
      {(vacancy || ptr != null) && (
        <div style={{display:'grid',gridTemplateColumns: vacancy && ptr!=null ? '1fr 1fr' : '1fr',gap:10,marginBottom:12}}>
          {vacancy && (
            <div style={{background:C.soft,borderRadius:10,padding:'12px 14px'}}>
              <div style={{fontSize:10,fontWeight:700,letterSpacing:'0.08em',textTransform:'uppercase',color:C.muted,marginBottom:4}}>Vacancy Rate</div>
              <div style={{fontSize:20,fontWeight:800,color:vacancy.rate<=5?C.green:vacancy.rate<=10?C.amber:C.red,letterSpacing:'-0.03em',lineHeight:1}}>
                {vacancy.rate?.toFixed(1)}%
              </div>
              <div style={{fontSize:11,color:C.muted,marginTop:2}}>Census ACS {vacancy.asOf || ''}</div>
            </div>
          )}
          {ptr != null && (
            <div style={{background:C.soft,borderRadius:10,padding:'12px 14px'}}>
              <div style={{fontSize:10,fontWeight:700,letterSpacing:'0.08em',textTransform:'uppercase',color:C.muted,marginBottom:4}}>Price-to-Rent</div>
              <div style={{fontSize:20,fontWeight:800,color:ptr<=15?C.green:ptr<=25?C.amber:C.red,letterSpacing:'-0.03em',lineHeight:1}}>
                {ptr}x
              </div>
              <div style={{fontSize:11,color:C.muted,marginTop:2}}>{ptr<=15?'Strong cash flow market':ptr<=25?'Balanced market':'Appreciation play'}</div>
            </div>
          )}
        </div>
      )}

      {/* Amenity score */}
      {score !== null && score !== undefined && (
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',
          background:C.soft,borderRadius:10,padding:'12px 16px',marginBottom:12}}>
          <div>
            <div style={{fontSize:12,fontWeight:700,color:C.text}}>Amenity Score</div>
            <div style={{fontSize:11,color:C.muted,marginTop:2}}>Within 0.5 mi · OpenStreetMap</div>
          </div>
          <div style={{textAlign:'right'}}>
            <div style={{fontSize:28,fontWeight:800,color:scoreColor(score),letterSpacing:'-0.04em',lineHeight:1}}>{score}<span style={{fontSize:14,fontWeight:500,color:C.muted}}>/10</span></div>
            <div style={{fontSize:11,fontWeight:600,color:scoreColor(score)}}>{scoreLabel(score)}</div>
          </div>
        </div>
      )}

      {/* Amenity breakdown */}
      {amenities && amenities.total !== undefined && (
        <div style={{display:'grid',gridTemplateColumns:'repeat(5,1fr)',gap:8}}>
          {[
            { label: 'Grocery',  val: amenities.grocery,     icon: '🛒' },
            { label: 'Transit',  val: amenities.transit,     icon: '🚌' },
            { label: 'Dining',   val: amenities.restaurants, icon: '🍽' },
            { label: 'Parks',    val: amenities.parks,       icon: '🌳' },
            { label: 'Schools',  val: amenities.schools,     icon: '🏫' },
          ].map(({ label, val, icon }) => (
            <div key={label} style={{background:C.white,border:`1px solid ${C.border}`,borderRadius:8,padding:'8px 6px',textAlign:'center'}}>
              <div style={{fontSize:16,marginBottom:3}}>{icon}</div>
              <div style={{fontSize:13,fontWeight:700,color:val>0?C.text:C.muted}}>{val ?? '-'}</div>
              <div style={{fontSize:10,color:C.muted,lineHeight:1.3}}>{label}</div>
            </div>
          ))}
        </div>
      )}

      {/* School Quality (Phase 6 — from NCES CCD) */}
      {schoolData && <SchoolQualityBadge schoolData={schoolData}/>}

      <div style={{fontSize:11,color:C.muted,marginTop:10,textAlign:'center'}}>
        Census ACS {data.censusYear || '2023'}{pulse ? ' · Redfin' : ''}{history ? ' · S&P Case-Shiller' : ''}{schoolData ? ' · NCES CCD' : ''} · OpenStreetMap
      </div>
    </Card>
  );
}

export function Results({data,originalData,scenarioLabel,onReset,onRecalc,onRerunAI,investorProfile,onUpdateAnalysis,savedDealId,neighborhood,neighborhoodLoading,isEdited,isAuthed,demoUsed,onDemoGate,onOpenChat,floodData,floodLoading,schoolData,liveBenchmarks,climateData,climateLoading,strData,strLoading,safmrData}) {
  const ref=useRef(null);
  const [origOpen,setOrigOpen]=useState(false);
  useEffect(()=>{ ref.current?.scrollIntoView({behavior:'smooth',block:'start'}); },[]);
  const isScenario=scenarioLabel&&originalData&&data!==originalData;

  return (
    <div ref={ref} style={{animation:'riq-fadeup 0.4s ease both'}}>
      {/* Property chips */}
      <div style={{display:'flex',flexWrap:'wrap',gap:8,marginBottom:14}}>
        {[{t:data.address,label:'Address'},{t:data.propertyDetails,label:'Property'}].filter(x=>x.t).map((x,i)=>(
          <span key={i} style={{display:'inline-flex',alignItems:'center',gap:6,background:C.white,border:`1px solid ${C.border}`,borderRadius:100,padding:'6px 14px',fontSize:12.5,color:C.muted}}>
            <span style={{fontSize:10,fontWeight:600,letterSpacing:'0.08em',textTransform:'uppercase',color:C.muted,opacity:0.7}}>{x.label}</span>
            {x.t}
          </span>
        ))}
      </div>

      {/* Scenario banner */}
      {isScenario&&(
        <div style={{background:C.blueBg,border:`1.5px solid ${C.blueBorder}`,borderRadius:14,padding:'12px 18px',marginBottom:14,display:'flex',alignItems:'center',justifyContent:'space-between',gap:12}}>
          <div style={{display:'flex',alignItems:'center',gap:8}}>
            <span style={{fontSize:13,fontWeight:700,color:C.blue}}>↻ Viewing: {scenarioLabel}</span>
            <span style={{fontSize:12,color:C.muted}}>- updated live</span>
          </div>
          <button onClick={()=>setOrigOpen(o=>!o)} style={{fontSize:12,color:C.blue,background:'none',border:`1px solid ${C.blueBorder}`,borderRadius:8,padding:'5px 12px',cursor:'pointer',fontFamily:'inherit',whiteSpace:'nowrap'}}>
            {origOpen?'Hide':'Show'} Original
          </button>
        </div>
      )}

      {/* Collapsible original */}
      {isScenario&&origOpen&&(
        <div style={{background:C.soft,border:`1px solid ${C.border}`,borderRadius:14,padding:'18px 22px',marginBottom:14,opacity:0.85}}>
          <div style={{fontSize:10,fontWeight:600,letterSpacing:'0.1em',textTransform:'uppercase',color:C.muted,marginBottom:10}}>Original Analysis</div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:8}}>
            {(originalData.keyMetrics||[]).slice(0,8).map((m,i)=>{
              const c=m.status==='good'?C.green:m.status==='bad'?C.red:C.amber;
              return <div key={i} style={{background:C.white,borderRadius:10,padding:'10px 12px'}}><div style={{fontSize:9.5,color:C.muted,textTransform:'uppercase',marginBottom:3}}>{m.label}</div><div style={{fontFamily:"'Instrument Serif',Georgia,serif",fontSize:16,color:c}}>{m.value}</div></div>;
            })}
          </div>
        </div>
      )}

      {/* COMMAND CENTER - dominant */}
      <CommandCenter data={data} onRecalc={onRecalc} onReset={onReset} onRerunAI={onRerunAI} isEdited={isEdited}/>

      {/* WHAT WOULD MAKE THIS A YES - only for MAYBE/NO */}
      <BreakEvenIntelligence data={data}/>

      <AssumptionsBadge settings={data._settings}/>
      <DataConfidenceBanner data={data}/>

      {/* WEALTH PROJECTION - second most important for Kiyosaki */}
      <WealthProjection data={data}/>
      <OpportunityCostPanel data={data} benchmarks={liveBenchmarks}/>

      <ScoreBreakdown data={data} isEdited={isEdited}/>
      <ProsAndCons data={data}/>
      <StressPanel data={data}/>
      <RentControlBadge data={data}/>
      <NeighborhoodCard data={neighborhood} loading={neighborhoodLoading} schoolData={schoolData}/>
      <FloodRiskCard data={floodData} loading={floodLoading}/>
      <ClimateRiskCard data={climateData} loading={climateLoading}/>
      <SupplyDemandCard data={data}/>
      <MarketBenchmarkCard data={data} safmrData={safmrData}/>
      <TaxTrendBadge data={data}/>
      <STRDataCard data={strData} loading={strLoading} analysisData={data}/>
      <RentContextCard data={data}/>
      <STRBanner data={data}/>
      <KeyMetrics data={data}/>
      <NOIBreakEven data={data}/>
      <RentScenarios data={data}/>
      <ExpenseBreakdown data={data}/>

      {data.narrative && (
        <div style={{background:'linear-gradient(135deg,#f0fdf4 0%,#f7fbff 100%)',border:`1px solid ${C.greenBorder}`,borderRadius:16,padding:'24px 26px',marginBottom:14}}>
          <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:16}}>
            <div style={{width:32,height:32,borderRadius:10,background:C.greenBg,border:`1px solid ${C.greenBorder}`,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M2 4h12M2 8h8M2 12h10" stroke={C.green} strokeWidth="1.6" strokeLinecap="round"/>
              </svg>
            </div>
            <div>
              <div style={{fontSize:11,fontWeight:700,letterSpacing:'0.10em',textTransform:'uppercase',color:C.green}}>Investment Analysis</div>
              <div style={{fontSize:10.5,color:C.muted,marginTop:1}}>AI-generated · full context</div>
            </div>
          </div>
          <p style={{fontSize:14.5,lineHeight:1.9,color:C.textBody,margin:0}}>{data.narrative}</p>
        </div>
      )}

      {/* -- Demo gate - premium features banner for unauthed users -- */}
      {!isAuthed && demoUsed && (
        <div style={{background:'linear-gradient(135deg,#0d1512 0%,#0a1520 100%)',border:'1px solid rgba(74,222,128,0.2)',borderRadius:18,padding:'22px 24px',marginBottom:14,display:'flex',alignItems:'center',justifyContent:'space-between',gap:16,flexWrap:'wrap',position:'relative',overflow:'hidden'}}>
          <div style={{position:'absolute',inset:0,backgroundImage:'linear-gradient(rgba(74,222,128,0.03) 1px,transparent 1px),linear-gradient(90deg,rgba(74,222,128,0.03) 1px,transparent 1px)',backgroundSize:'30px 30px',pointerEvents:'none'}}/>
          <div style={{position:'relative',flex:1,minWidth:0}}>
            <div style={{fontSize:10,fontWeight:700,letterSpacing:'0.12em',textTransform:'uppercase',color:'rgba(74,222,128,0.6)',marginBottom:5}}>Unlock premium features</div>
            <div style={{fontSize:14.5,fontWeight:700,color:'#fff',marginBottom:8,lineHeight:1.3}}>Save, export, and dig deeper into this deal</div>
            <div style={{display:'flex',flexWrap:'wrap',gap:8,marginBottom:8}}>
              {[
                {icon:'↓', label:'PDF Export'},
                {icon:'🔗', label:'Share Link'},
                {icon:'💬', label:'AI Chat'},
                {icon:'📁', label:'Deal History'},
              ].map(({icon, label}) => (
                <span key={label} style={{display:'inline-flex',alignItems:'center',gap:5,background:'rgba(74,222,128,0.08)',border:'1px solid rgba(74,222,128,0.2)',borderRadius:8,padding:'4px 10px',fontSize:12,color:'rgba(74,222,128,0.8)',fontWeight:600}}>
                  {icon} {label}
                </span>
              ))}
            </div>
            <div style={{fontSize:12,color:'rgba(255,255,255,0.35)',lineHeight:1.5}}>Free account. Your first analysis token is included.</div>
          </div>
          <button onClick={onDemoGate}
            style={{position:'relative',background:'linear-gradient(135deg,#1a7a40 0%,#166638 100%)',border:'none',borderRadius:12,padding:'12px 22px',fontSize:13.5,fontWeight:700,color:'#fff',cursor:'pointer',fontFamily:'inherit',whiteSpace:'nowrap',flexShrink:0,boxShadow:'0 4px 20px rgba(22,102,56,0.5)',transition:'transform 0.15s'}}
            onMouseEnter={e=>e.currentTarget.style.transform='translateY(-1px)'}
            onMouseLeave={e=>e.currentTarget.style.transform=''}>
            Create Free Account →
          </button>
        </div>
      )}

      {/* -- Share / Export toolbar - only for authed users -- */}
      {isAuthed && <ShareToolbar data={data} dealId={savedDealId}/>}

      {/* -- Chat prompt card - surfaces the FloatingChat (authed only) ---- */}
      {isAuthed ? (
        <div style={{background:C.green,borderRadius:16,padding:'20px 22px',marginBottom:14,display:'flex',alignItems:'center',justifyContent:'space-between',gap:16,flexWrap:'wrap'}}>
          <div>
            <div style={{fontSize:14,fontWeight:700,color:'#fff',marginBottom:3}}>Have questions about this deal?</div>
            <div style={{fontSize:12.5,color:'rgba(255,255,255,0.75)',lineHeight:1.5}}>
              Ask the AI anything - "What if I paid cash?", "What rent do I need?", "Is this good for appreciation?" - numbers update live.
            </div>
          </div>
          <button
            onClick={onOpenChat}
            style={{background:'rgba(255,255,255,0.15)',border:'1.5px solid rgba(255,255,255,0.35)',borderRadius:10,padding:'11px 20px',fontSize:13.5,fontWeight:700,color:'#fff',cursor:'pointer',fontFamily:'inherit',whiteSpace:'nowrap',flexShrink:0,transition:'background 0.15s'}}
            onMouseEnter={e=>e.currentTarget.style.background='rgba(255,255,255,0.25)'}
            onMouseLeave={e=>e.currentTarget.style.background='rgba(255,255,255,0.15)'}>
            Ask the AI →
          </button>
        </div>
      ) : demoUsed && (
        <div style={{background:'rgba(22,102,56,0.08)',border:`1px solid ${C.greenBorder}`,borderRadius:16,padding:'20px 22px',marginBottom:14,display:'flex',alignItems:'center',justifyContent:'space-between',gap:16,flexWrap:'wrap'}}>
          <div>
            <div style={{fontSize:14,fontWeight:700,color:C.green,marginBottom:3}}>AI chat is a premium feature</div>
            <div style={{fontSize:12.5,color:C.muted,lineHeight:1.5}}>
              Sign up free to ask the AI anything about this deal - financing scenarios, rent sensitivity, market outlook.
            </div>
          </div>
          <button
            onClick={onDemoGate}
            style={{background:C.green,border:'none',borderRadius:10,padding:'11px 20px',fontSize:13.5,fontWeight:700,color:'#fff',cursor:'pointer',fontFamily:'inherit',whiteSpace:'nowrap',flexShrink:0}}>
            Unlock →
          </button>
        </div>
      )}

      {/* -- Re-run AI -------------------------------------------------------- */}
      {isAuthed ? (
        <div style={{marginBottom:14,textAlign:'center'}}>
          <button onClick={onRerunAI}
            style={{background:C.white,border:`1.5px solid ${C.border}`,borderRadius:10,padding:'11px 22px',fontSize:13,fontWeight:600,color:C.text,cursor:'pointer',fontFamily:'inherit',transition:'border-color 0.15s',letterSpacing:'-0.01em'}}
            onMouseEnter={e=>e.currentTarget.style.borderColor=C.text}
            onMouseLeave={e=>e.currentTarget.style.borderColor=C.border}>
            ↻ Re-run AI analysis with current numbers
          </button>
        </div>
      ) : isEdited && (
        <div style={{marginBottom:14,textAlign:'center'}}>
          <span style={{fontSize:12.5,color:C.muted}}>Edited the numbers? </span>
          <button onClick={onDemoGate} style={{fontSize:12.5,color:C.green,background:'none',border:'none',cursor:'pointer',fontFamily:'inherit',fontWeight:600,textDecoration:'underline',padding:0}}>
            Sign up free to re-run the AI with your changes →
          </button>
        </div>
      )}

      {/* -- Scout upsell - contextual, uses analysis data ------------------- */}
      <div style={{background:'linear-gradient(135deg, #0d1f3c 0%, #1649a0 100%)',borderRadius:16,padding:'22px 24px',marginBottom:14,display:'flex',alignItems:'center',justifyContent:'space-between',gap:16,flexWrap:'wrap'}}>
        <div style={{flex:1,minWidth:0}}>
          <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:6}}>
            <span style={{fontSize:10,fontWeight:700,letterSpacing:'0.1em',textTransform:'uppercase',color:'rgba(255,255,255,0.5)'}}>RentalIQ Scout</span>
          </div>
          <div style={{fontSize:14.5,fontWeight:700,color:'#fff',marginBottom:4,lineHeight:1.3}}>
            {data.verdict==='NO'
              ? "This one didn't work - find a market where the numbers do"
              : data.verdict==='YES'
              ? `More deals like this exist in ${data.address?.split(',').slice(-2).join(',').trim() || 'your market'}`
              : 'Not sure about this market? Scout finds better ones'}
          </div>
          <div style={{fontSize:12.5,color:'rgba(255,255,255,0.65)',lineHeight:1.5}}>
            Set your price range, property type, and filters. We'll pull real HUD + Census rent data and open targeted searches in Zillow and Redfin instantly.
          </div>
        </div>
        <a
          href={`/scout?city=${encodeURIComponent(data._settings?.city||'')}`}
          style={{display:'inline-block',background:'rgba(255,255,255,0.12)',border:'1.5px solid rgba(255,255,255,0.25)',borderRadius:10,padding:'12px 22px',fontSize:13.5,fontWeight:700,color:'#fff',textDecoration:'none',whiteSpace:'nowrap',flexShrink:0,transition:'background 0.15s'}}
          onMouseEnter={e=>e.currentTarget.style.background='rgba(255,255,255,0.22)'}
          onMouseLeave={e=>e.currentTarget.style.background='rgba(255,255,255,0.12)'}
        >
          Search This Market →
        </a>
      </div>

      {/* -- Analyze another deal CTA ----------------------------------------- */}
      <div style={{background:C.white,border:`1.5px solid ${C.border}`,borderRadius:16,padding:'20px 22px',marginBottom:14,display:'flex',alignItems:'center',justifyContent:'space-between',gap:16,flexWrap:'wrap'}}>
        <div>
          <div style={{fontSize:14,fontWeight:600,color:C.text,marginBottom:2}}>Analyze another property</div>
          <div style={{fontSize:12.5,color:C.muted}}>Start fresh with a new listing or address.</div>
        </div>
        {isEdited
          ? <NewAnalysisBtn onReset={onReset}/>
          : <button onClick={onReset}
              style={{background:C.text,border:'none',borderRadius:10,padding:'11px 22px',fontSize:13.5,fontWeight:700,color:'#fff',cursor:'pointer',fontFamily:'inherit',whiteSpace:'nowrap',flexShrink:0,letterSpacing:'-0.01em'}}>
              New Analysis →
            </button>
        }
      </div>

      <div style={{background:C.amberBg,border:`1px solid ${C.amberBorder}`,borderRadius:12,padding:'12px 16px',fontSize:12.5,color:C.amber,lineHeight:1.6,marginBottom:80}}>
        Not financial advice. Verify with a licensed property manager and lender before investing.
      </div>
    </div>
  );
}

// --- Main ----------------------------------------------------------------------

