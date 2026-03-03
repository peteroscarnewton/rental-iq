import { useState, useEffect, useRef, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import Head from 'next/head';
import Link from 'next/link';

// --- Design tokens ------------------------------------------------------------
const C = {
  bg:'#f5f5f8', white:'#ffffff', border:'#dddde4', text:'#0d0d0f', muted:'#72727a', soft:'#eaeaef',
  green:'#166638', greenBg:'#ecf6f1', greenBorder:'#96ccb0',
  red:'#a62626', redBg:'#fdf0f0', redBorder:'#e0aaaa',
  amber:'#8a5800', amberBg:'#fdf4e8', amberBorder:'#dfc070',
  blue:'#1649a0', blueBg:'#edf1fc', blueBorder:'#a0beed',
  shadow:'0 1px 2px rgba(0,0,0,0.05), 0 2px 12px rgba(0,0,0,0.06)',
  shadowSm:'0 1px 2px rgba(0,0,0,0.04)',
};

const inputBase = {
  background:C.white, border:`1.5px solid ${C.border}`, borderRadius:10,
  padding:'11px 14px', fontSize:14, fontFamily:"'DM Sans',system-ui,sans-serif",
  color:C.text, outline:'none', width:'100%',
  transition:'border-color 0.2s', WebkitAppearance:'none', boxSizing:'border-box',
};

// --- Sub-components -----------------------------------------------------------

function Label({ children, style }) {
  return <div style={{ fontSize:10, fontWeight:600, letterSpacing:'0.1em', textTransform:'uppercase', color:C.muted, marginBottom:8, ...style }}>{children}</div>;
}

function Card({ children, style }) {
  return <div style={{ background:C.white, border:`1px solid ${C.border}`, borderRadius:14, boxShadow:C.shadow, padding:24, ...style }}>{children}</div>;
}

// --- Rent Stats Component -----------------------------------------------------
function RentStats({ city, beds }) {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(false);
  const lastKey = useRef('');

  useEffect(() => {
    if (!city) return;
    const key = `${city}:${beds}`;
    if (key === lastKey.current) return;
    lastKey.current = key;
    setLoading(true); setError(false); setData(null);
    fetch('/api/rent-estimate', {
      method:'POST', headers:{'content-type':'application/json'},
      body: JSON.stringify({ city, beds }),
    })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => { setError(true); setLoading(false); });
  }, [city, beds]);

  if (!city) return null;

  if (loading) return (
    <div style={{ padding:'14px 18px', background:C.soft, borderRadius:12, fontSize:13, color:C.muted, display:'flex', alignItems:'center', gap:10 }}>
      <div style={{ width:14, height:14, borderRadius:'50%', border:`2px solid ${C.border}`, borderTopColor:C.green, animation:'spin 0.8s linear infinite', flexShrink:0 }}/>
      Loading market rent data...
    </div>
  );

  if (error || !data?.mid) return null;

  const confColor = data.confidence === 'High' ? C.green : data.confidence === 'Medium' ? C.amber : C.muted;

  return (
    <div style={{ background:C.greenBg, border:`1.5px solid ${C.greenBorder}`, borderRadius:14, padding:'16px 20px', animation:'fadeup 0.3s ease both' }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
        <div style={{ fontSize:11, fontWeight:700, letterSpacing:'0.1em', textTransform:'uppercase', color:C.green }}>
          Market Rent - {beds}BR in {city.split(',')[0]}
        </div>
        <span style={{ fontSize:10, fontWeight:600, color:confColor, background:`${confColor}18`, border:`1px solid ${confColor}35`, borderRadius:100, padding:'2px 9px' }}>
          {data.confidence} confidence
        </span>
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:10, marginBottom:12 }}>
        {[
          { label:'Rent Low',  value:`$${data.low?.toLocaleString()}`,  color:C.muted },
          { label:'Rent Mid',  value:`$${data.mid?.toLocaleString()}`,  color:C.green },
          { label:'Rent High', value:`$${data.high?.toLocaleString()}`, color:C.muted },
        ].map((s,i) => (
          <div key={i} style={{ background:i===1?'rgba(22,102,56,0.08)':C.white, border:`1px solid ${i===1?C.greenBorder:C.border}`, borderRadius:10, padding:'10px 14px', textAlign:'center' }}>
            <div style={{ fontSize:9.5, fontWeight:600, letterSpacing:'0.1em', textTransform:'uppercase', color:i===1?C.green:C.muted, marginBottom:4 }}>{s.label}</div>
            <div style={{ fontSize:17, fontWeight:700, color:s.color, fontFamily:"'Libre Baskerville',Georgia,serif" }}>{s.value}</div>
          </div>
        ))}
      </div>
      <div style={{ fontSize:11.5, color:'#3a6e50', lineHeight:1.5 }}>
        📊 {data.sources?.join(' · ')} · {data.note}
      </div>
    </div>
  );
}

// --- Live Market Intel Component (Phase 4C) -----------------------------------
// Calls /api/scout-market to get AI insights grounded in live market data
function LiveMarketIntel({ city, state, goal, budget }) {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);
  const lastCity = useRef('');

  useEffect(() => {
    if (!city || city === lastCity.current) return;
    lastCity.current = city;
    setLoading(true); setError(null); setData(null);
    fetch('/api/scout-market', {
      method:  'POST',
      headers: { 'content-type': 'application/json' },
      body:    JSON.stringify({ city, state, goal: goal || 'balanced', budget }),
    })
      .then(r => r.ok ? r.json() : r.json().then(e => Promise.reject(e.error || 'Error')))
      .then(d => { setData(d); setLoading(false); })
      .catch(e => { setError(typeof e === 'string' ? e : 'Could not load market intel'); setLoading(false); });
  }, [city, state, goal, budget]);

  if (!city) return null;

  const tempColors = {
    hot:     { bg:'#fdf4f4', border:'#e0aaaa', text:'#a62626', pill:'#a62626' },
    warm:    { bg:'#fdf4e8', border:'#dfc070', text:'#8a5800', pill:'#8a5800' },
    neutral: { bg:C.soft,   border:C.border,  text:C.muted,   pill:C.muted   },
    cool:    { bg:C.blueBg, border:C.blueBorder, text:C.blue, pill:C.blue    },
    cold:    { bg:C.blueBg, border:C.blueBorder, text:C.blue, pill:C.blue    },
  };

  if (loading) return (
    <div style={{ background:C.soft, border:`1px solid ${C.border}`, borderRadius:14, padding:'20px 24px', marginBottom:16 }}>
      <div style={{ display:'flex', alignItems:'center', gap:10, fontSize:13, color:C.muted }}>
        <div style={{ width:14, height:14, borderRadius:'50%', border:`2px solid ${C.border}`, borderTopColor:C.green, animation:'spin 0.8s linear infinite', flexShrink:0 }}/>
        Loading live market intelligence for {city.split(',')[0]}...
      </div>
    </div>
  );

  if (error) return (
    <div style={{ background:C.soft, border:`1px solid ${C.border}`, borderRadius:14, padding:'16px 20px', marginBottom:16, fontSize:13, color:C.muted }}>
      {error.includes('token') ? (
        <span>📊 <strong>Market Intel</strong> requires 1 token. <a href="/analyze" style={{ color:C.green }}>Get tokens →</a></span>
      ) : (
        <span>Market intelligence unavailable for this city right now.</span>
      )}
    </div>
  );

  if (!data) return null;

  const ctx   = data.marketContext || {};
  const temp  = ctx.marketTemp || 'neutral';
  const tc    = tempColors[temp] || tempColors.neutral;

  return (
    <div style={{ background:C.white, border:`1.5px solid ${C.greenBorder}`, borderRadius:14, padding:'20px 24px', marginBottom:16, animation:'fadeup 0.35s ease both' }}>
      {/* Header */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:16, gap:12 }}>
        <div>
          <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:4 }}>
            <div style={{ width:7, height:7, background:C.green, borderRadius:'50%' }}/>
            <span style={{ fontSize:11, fontWeight:700, letterSpacing:'0.1em', textTransform:'uppercase', color:C.green }}>Live Market Intel · {city.split(',')[0]}</span>
          </div>
          <div style={{ fontSize:13, color:C.muted }}>Powered by live FHFA, Redfin, and BLS data · Not AI training data</div>
        </div>
        {ctx.marketTemp && (
          <span style={{ fontSize:11, fontWeight:700, letterSpacing:'0.06em', textTransform:'uppercase', color:tc.pill, background:tc.bg, border:`1.5px solid ${tc.border}`, borderRadius:100, padding:'4px 12px', flexShrink:0 }}>
            {temp.charAt(0).toUpperCase() + temp.slice(1)} Market
          </span>
        )}
      </div>

      {/* Live data pills row */}
      <div style={{ display:'flex', flexWrap:'wrap', gap:8, marginBottom:16 }}>
        {[
          ctx.mortgageRate       ? { label:'30yr Rate',    value:`${ctx.mortgageRate}%`,          color:C.muted }   : null,
          ctx.appreciationRate5yr? { label:'5yr CAGR',     value:`${ctx.appreciationRate5yr}%/yr`, color:C.green }   : null,
          ctx.daysOnMarket       ? { label:'Median DOM',   value:`${ctx.daysOnMarket} days`,       color:C.text }    : null,
          ctx.saleToList         ? { label:'Sale/List',    value:`${(ctx.saleToList*100).toFixed(1)}%`, color:ctx.saleToList>=1.0?C.red:C.blue } : null,
          ctx.unemploymentRate   ? { label:'Unemployment', value:`${ctx.unemploymentRate}%`,       color:C.muted }   : null,
          ctx.landlordScore      ? { label:'Landlord Score', value:`${ctx.landlordScore}/100`,     color:ctx.landlordScore>=70?C.green:ctx.landlordScore>=50?C.amber:C.red } : null,
        ].filter(Boolean).map((pill,i) => (
          <div key={i} style={{ display:'inline-flex', flexDirection:'column', background:C.soft, border:`1px solid ${C.border}`, borderRadius:10, padding:'7px 12px', minWidth:80 }}>
            <span style={{ fontSize:9.5, fontWeight:600, letterSpacing:'0.08em', textTransform:'uppercase', color:C.muted, marginBottom:2 }}>{pill.label}</span>
            <span style={{ fontSize:15, fontWeight:700, color:pill.color, fontFamily:"'Libre Baskerville',Georgia,serif" }}>{pill.value}</span>
          </div>
        ))}
      </div>

      {/* AI Verdict */}
      {data.verdict && (
        <div style={{ background:C.greenBg, border:`1px solid ${C.greenBorder}`, borderRadius:10, padding:'14px 16px', marginBottom:14 }}>
          <div style={{ fontSize:10, fontWeight:700, letterSpacing:'0.1em', textTransform:'uppercase', color:C.green, marginBottom:6 }}>Market Verdict</div>
          <div style={{ fontSize:13.5, color:'#1c3d29', lineHeight:1.6 }}>{data.verdict}</div>
        </div>
      )}

      {/* Two-column signals + risks */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:14 }} className="scout-mg">
        {data.signals?.length > 0 && (
          <div style={{ background:C.soft, borderRadius:10, padding:'14px 16px' }}>
            <div style={{ fontSize:10, fontWeight:700, letterSpacing:'0.1em', textTransform:'uppercase', color:C.text, marginBottom:8 }}>Key Signals</div>
            {data.signals.map((s,i) => (
              <div key={i} style={{ fontSize:12.5, color:C.text, lineHeight:1.5, marginBottom:i < data.signals.length-1 ? 7 : 0, paddingLeft:12, borderLeft:`2px solid ${C.green}` }}>{s}</div>
            ))}
          </div>
        )}
        {data.risks?.length > 0 && (
          <div style={{ background:C.redBg, border:`1px solid ${C.redBorder}`, borderRadius:10, padding:'14px 16px' }}>
            <div style={{ fontSize:10, fontWeight:700, letterSpacing:'0.1em', textTransform:'uppercase', color:C.red, marginBottom:8 }}>Risks</div>
            {data.risks.map((r,i) => (
              <div key={i} style={{ fontSize:12.5, color:'#5a1a1a', lineHeight:1.5, marginBottom:i < data.risks.length-1 ? 7 : 0, paddingLeft:12, borderLeft:`2px solid ${C.red}` }}>{r}</div>
            ))}
          </div>
        )}
      </div>

      {/* Strategy */}
      {data.strategy && (
        <div style={{ fontSize:13, color:C.muted, lineHeight:1.6, borderTop:`1px solid ${C.border}`, paddingTop:12, marginTop:4 }}>
          <strong style={{ color:C.text }}>Strategy: </strong>{data.strategy}
        </div>
      )}

      {/* Data freshness footer */}
      {data.dataNote && (
        <div style={{ fontSize:11, color:C.muted, marginTop:10 }}>{data.dataNote}</div>
      )}
    </div>
  );
}

// --- Results Panel ------------------------------------------------------------
function ResultsPanel({ filters, onBack }) {
  const ref = useRef(null);
  useEffect(() => { ref.current?.scrollIntoView({ behavior:'smooth', block:'start' }); }, []);

  const { city, priceMin, priceMax, bedsMin, bedsMax, baths, propTypes, daysOnMarket, sortBy } = filters;

  // Build Zillow URL
  function buildZillow() {
    const stateMatch = city.match(/,\s*([A-Z]{2})$/i);
    const state      = stateMatch ? stateMatch[1].toLowerCase() : '';
    const citySlug   = city.split(',')[0].trim().toLowerCase().replace(/\s+/g,'-').replace(/[^a-z0-9-]/g,'');
    const base       = `https://www.zillow.com/${citySlug}-${state}/`;
    const fs = {};
    if (priceMin || priceMax) fs.price = { min: parseInt(priceMin)||undefined, max: parseInt(priceMax)||undefined };
    if (bedsMin)  fs.beds  = { min: parseInt(bedsMin) };
    if (bedsMax)  fs.beds  = { ...fs.beds, max: parseInt(bedsMax) };
    if (baths)    fs.baths = { min: parseFloat(baths) };
    if (daysOnMarket !== 'any') fs.doz = { value: String(daysOnMarket) };
    fs.sf  = { value: propTypes.includes('sfr') };
    fs.mf  = { value: propTypes.includes('mfr') };
    fs.con = { value: propTypes.includes('condo') };
    fs.tow = { value: propTypes.includes('townhouse') };
    // clean undefined
    Object.keys(fs).forEach(k => { if (fs[k]===undefined) delete fs[k]; });
    const sortMap = { newest:'days', price_asc:'priced', price_desc:'pricea' };
    fs.sort = { value: sortMap[sortBy] || 'days' };
    const sqs = encodeURIComponent(JSON.stringify({ pagination:{}, isMapVisible:false, filterState:fs }));
    return `${base}?searchQueryState=${sqs}`;
  }

  // Build Redfin URL
  function buildRedfin() {
    const stateMatch = city.match(/,\s*([A-Z]{2})$/i);
    const state    = stateMatch ? stateMatch[1] : '';
    const citySlug = city.split(',')[0].trim().replace(/\s+/g,'-');
    const base     = `https://www.redfin.com/${state}/${citySlug}/filter/`;
    const parts    = [];
    if (priceMin)                    parts.push(`min-price=${priceMin}`);
    if (priceMax)                    parts.push(`max-price=${priceMax}`);
    if (bedsMin)                     parts.push(`min-beds=${bedsMin}`);
    if (baths)                       parts.push(`min-baths=${baths}`);
    if (daysOnMarket !== 'any')      parts.push(`max-days-on-market=${daysOnMarket}`);
    return parts.length ? base + parts.join(',') : base;
  }

  const filterLabels = [
    priceMin || priceMax ? `$${(parseInt(priceMin)||0).toLocaleString()}-$${(parseInt(priceMax)||0).toLocaleString()}` : null,
    bedsMin  ? `${bedsMin}${bedsMax&&bedsMax!==bedsMin?`-${bedsMax}`:'+'}BR` : null,
    baths    ? `${baths}+ bath` : null,
    propTypes.length ? propTypes.map(t=>({sfr:'SFR',mfr:'Multi-family',condo:'Condo',townhouse:'Townhouse'})[t]).filter(Boolean).join(', ') : null,
    daysOnMarket !== 'any' ? `${daysOnMarket}+ DOM` : null,
  ].filter(Boolean);

  const tips = [
    daysOnMarket !== 'any' && parseInt(daysOnMarket) >= 30
      ? '⚡ Filtering for 30+ days on market targets motivated sellers - more negotiating leverage.'
      : null,
    propTypes.includes('mfr')
      ? '🏘️ Multi-family (2-4 units) gives built-in rent diversification and house-hack potential.'
      : null,
    priceMax && parseInt(priceMax) <= 150000
      ? '💵 At this price point, the 1% rule is achievable in many Midwest and Southeast markets.'
      : null,
    '🔍 Open both Zillow and Redfin - listings sometimes appear on one but not the other.',
    '📋 Found a deal? Paste the URL into RentalIQ for cap rate, cash flow, wealth projection, and a buy/pass verdict.',
  ].filter(Boolean);

  return (
    <div ref={ref} style={{ animation:'fadeup 0.35s ease both' }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:20, gap:12 }}>
        <div>
          <div style={{ fontFamily:"'Libre Baskerville',Georgia,serif", fontSize:22, color:C.text, marginBottom:4 }}>
            Properties in {city.split(',')[0]}
          </div>
          <div style={{ fontSize:12.5, color:C.muted }}>{filterLabels.join(' · ')}</div>
        </div>
        <button onClick={onBack}
          style={{ fontSize:12, color:C.muted, background:'none', border:`1px solid ${C.border}`, borderRadius:8, padding:'7px 14px', cursor:'pointer', fontFamily:'inherit', whiteSpace:'nowrap', flexShrink:0 }}>
          ← Edit Search
        </button>
      </div>

      {/* Live Market Intelligence (Phase 4C) — AI grounded in live data */}
      <div style={{ marginBottom:4 }}>
        <LiveMarketIntel
          city={city.split(',')[0].trim()}
          state={city.match(/,\s*([A-Z]{2})$/i)?.[1] || ''}
          goal={filters.goal || 'balanced'}
          budget={priceMax || ''}
        />
      </div>

      {/* Real rent data */}
      <div style={{ marginBottom:16 }}>
        <RentStats city={city} beds={parseInt(bedsMin)||2} />
      </div>

      {/* Open Zillow / Redfin */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:16 }} className="scout-mg">
        <a href={buildZillow()} target="_blank" rel="noopener noreferrer"
          style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:10, background:'#006AFF', color:'#fff', borderRadius:14, padding:'18px 20px', textDecoration:'none', fontWeight:700, fontSize:15, boxShadow:'0 4px 16px rgba(0,106,255,0.25)' }}>
          <svg width="22" height="22" viewBox="0 0 40 40" fill="none">
            <path d="M20 4L36 18V36H26V26H14V36H4V18L20 4Z" fill="white"/>
          </svg>
          Open in Zillow ↗
        </a>
        <a href={buildRedfin()} target="_blank" rel="noopener noreferrer"
          style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:10, background:'#CC0000', color:'#fff', borderRadius:14, padding:'18px 20px', textDecoration:'none', fontWeight:700, fontSize:15, boxShadow:'0 4px 16px rgba(204,0,0,0.22)' }}>
          <svg width="20" height="20" viewBox="0 0 40 40" fill="none">
            <circle cx="20" cy="20" r="16" fill="white"/>
            <path d="M20 10C14.48 10 10 14.48 10 20s4.48 10 10 10 10-4.48 10-10S25.52 10 20 10zm0 17c-3.87 0-7-3.13-7-7s3.13-7 7-7 7 3.13 7 7-3.13 7-7 7z" fill="#CC0000"/>
          </svg>
          Open in Redfin ↗
        </a>
      </div>

      {/* Filter summary */}
      <Card style={{ marginBottom:14 }}>
        <Label>Applied Investor Filters</Label>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(2,1fr)', gap:12 }} className="scout-mg">
          {[
            { l:'City / Market',   v: city },
            { l:'Price Range',     v: priceMin||priceMax ? `$${(parseInt(priceMin)||0).toLocaleString()} - $${(parseInt(priceMax)||0).toLocaleString()}` : 'Any' },
            { l:'Bedrooms',        v: bedsMin ? `${bedsMin}${bedsMax&&bedsMax!==bedsMin?` - ${bedsMax}`:'+'}` : 'Any' },
            { l:'Bathrooms',       v: baths ? `${baths}+` : 'Any' },
            { l:'Property Type',   v: propTypes.length ? propTypes.map(t=>({sfr:'Single Family',mfr:'Multi-Family',condo:'Condo',townhouse:'Townhouse'})[t]).filter(Boolean).join(', ') : 'Any' },
            { l:'Days on Market',  v: daysOnMarket==='any' ? 'Any' : `${daysOnMarket}+ days` },
            { l:'Sort By',         v: ({newest:'Newest first',price_asc:'Price: Low → High',price_desc:'Price: High → Low'})[sortBy]||sortBy },
          ].map((item,i) => (
            <div key={i}>
              <div style={{ fontSize:10, fontWeight:600, letterSpacing:'0.08em', textTransform:'uppercase', color:C.muted, marginBottom:3 }}>{item.l}</div>
              <div style={{ fontSize:13.5, fontWeight:600, color:C.text }}>{item.v}</div>
            </div>
          ))}
        </div>
      </Card>

      {/* CTA - shown early so mobile users don't miss it */}
      <Card style={{ background:C.greenBg, border:`1.5px solid ${C.greenBorder}`, marginBottom:14, padding:'20px 24px' }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:16, flexWrap:'wrap' }}>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontFamily:"'Libre Baskerville',Georgia,serif", fontSize:17, color:C.text, marginBottom:4 }}>Found a listing you like?</div>
            <div style={{ fontSize:13, color:'#3a6e50', lineHeight:1.5 }}>Paste the URL into RentalIQ for cap rate, cash flow, wealth projection, and a buy/pass verdict in 30 sec.</div>
          </div>
          <Link href="/analyze"
            style={{ display:'inline-block', background:C.green, color:'#fff', borderRadius:10, padding:'11px 22px', fontSize:13.5, fontWeight:700, textDecoration:'none', letterSpacing:'-0.01em', flexShrink:0 }}>
            Analyze a Listing →
          </Link>
        </div>
      </Card>

      {/* Tips */}
      <div style={{ background:C.amberBg, border:`1px solid ${C.amberBorder}`, borderRadius:14, padding:'16px 20px', marginBottom:14 }}>
        <Label style={{ color:C.amber }}>Investor Tips for This Search</Label>
        <div style={{ display:'flex', flexDirection:'column', gap:9 }}>
          {tips.map((tip,i) => (
            <div key={i} style={{ fontSize:13, color:'#5a3d00', lineHeight:1.55 }}>{tip}</div>
          ))}
        </div>
      </div>

      {/* CTA (full version, bottom) */}
      <Card style={{ background:C.greenBg, border:`1.5px solid ${C.greenBorder}`, textAlign:'center', padding:'28px 24px' }}>
        <div style={{ fontFamily:"'Libre Baskerville',Georgia,serif", fontSize:20, marginBottom:8, color:C.text }}>
          Found a listing you like?
        </div>
        <p style={{ fontSize:14, color:'#3a6e50', marginBottom:20, lineHeight:1.65 }}>
          Paste the Zillow or Redfin URL into RentalIQ for cap rate, cash flow,
          wealth projection, AI narrative, and a buy/pass verdict in 30 seconds.
          The market rent data above automatically anchors the AI's estimate.
        </p>
        <Link href="/analyze"
          style={{ display:'inline-block', background:C.green, color:'#fff', borderRadius:10, padding:'13px 28px', fontSize:14.5, fontWeight:700, textDecoration:'none', letterSpacing:'-0.01em' }}>
          Analyze a Specific Listing →
        </Link>
      </Card>
    </div>
  );
}

// --- Search Form --------------------------------------------------------------
function SearchForm({ onSubmit, prefilledCity }) {
  const [city,         setCity]         = useState(prefilledCity || '');
  const [priceMin,     setPriceMin]     = useState('');
  const [priceMax,     setPriceMax]     = useState('');
  const [bedsMin,      setBedsMin]      = useState('2');
  const [bedsMax,      setBedsMax]      = useState('');
  const [baths,        setBaths]        = useState('1');
  const [propTypes,    setPropTypes]    = useState(['sfr']);
  const [daysOnMarket, setDaysOnMarket] = useState('any');
  const [sortBy,       setSortBy]       = useState('newest');
  const [goal,         setGoal]         = useState('balanced');
  const [cityErr,      setCityErr]      = useState('');
  const [rentCity,     setRentCity]     = useState('');
  const debounce = useRef(null);

  const handleCityChange = useCallback((val) => {
    setCity(val);
    clearTimeout(debounce.current);
    debounce.current = setTimeout(() => {
      if (val.trim().length >= 4) setRentCity(val.trim());
    }, 900);
  }, []);

  function togglePropType(key) {
    setPropTypes(p => p.includes(key) ? p.filter(x => x !== key) : [...p, key]);
  }

  function handleSubmit() {
    if (!city.trim()) { setCityErr('City is required'); return; }
    setCityErr('');
    onSubmit({ city:city.trim(), priceMin, priceMax, bedsMin, bedsMax, baths, propTypes, daysOnMarket, sortBy, goal });
  }

  const propTypeOpts = [
    { key:'sfr',       label:'Single Family',     icon:'🏠' },
    { key:'mfr',       label:'Multi-Family (2-4)', icon:'🏘️' },
    { key:'condo',     label:'Condo',              icon:'🏢' },
    { key:'townhouse', label:'Townhouse',           icon:'🏡' },
  ];

  const domOpts = [
    { v:'any', l:'Any' },
    { v:'1',   l:'1+ day' },
    { v:'7',   l:'7+ days' },
    { v:'14',  l:'14+ days' },
    { v:'30',  l:'30+ days (motivated sellers)' },
    { v:'60',  l:'60+ days (stale listings)' },
    { v:'90',  l:'90+ days (best leverage)' },
  ];

  return (
    <Card>
      <div style={{ marginBottom:22 }}>
        <div style={{ fontFamily:"'Libre Baskerville',Georgia,serif", fontSize:20, color:C.text, marginBottom:5 }}>
          Set your investor filters
        </div>
        <div style={{ fontSize:13.5, color:C.muted, lineHeight:1.5 }}>
          Set your investor filters, then open a pre-filtered Zillow or Redfin search in one click. We'll also pull real HUD + Census rent data for your target market so you know what to expect before you analyze a listing.
        </div>
      </div>

      <div style={{ display:'flex', flexDirection:'column', gap:20 }}>

        {/* City */}
        <div>
          <label style={{ fontSize:11, fontWeight:600, letterSpacing:'0.08em', textTransform:'uppercase', color:cityErr?C.red:C.muted, display:'block', marginBottom:7 }}>
            Target City / Market <span style={{ color:C.red }}>*</span>
          </label>
          <input type="text" value={city} onChange={e => handleCityChange(e.target.value)}
            placeholder="e.g. Memphis, TN or Cleveland, OH" autoComplete="off"
            style={{ ...inputBase, borderColor:cityErr?C.red:C.border, background:cityErr?C.redBg:C.white }}/>
          {cityErr && <p style={{ fontSize:11, color:C.red, margin:'4px 0 0' }}>{cityErr}</p>}
          <p style={{ fontSize:11, color:C.muted, margin:'5px 0 0', lineHeight:1.4 }}>Include state abbreviation for best results - e.g. "Kansas City, MO"</p>
        </div>

        {/* Live rent preview */}
        {rentCity && <RentStats city={rentCity} beds={parseInt(bedsMin)||2} />}

        {/* Price Range */}
        <div>
          <Label>Price Range</Label>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
            {[
              { lbl:'Min Price', val:priceMin, set:setPriceMin, ph:'50,000' },
              { lbl:'Max Price', val:priceMax, set:setPriceMax, ph:'300,000' },
            ].map(({lbl,val,set,ph}) => (
              <div key={lbl}>
                <div style={{ fontSize:10, color:C.muted, marginBottom:5, textTransform:'uppercase', letterSpacing:'0.08em', fontWeight:600 }}>{lbl}</div>
                <div style={{ position:'relative' }}>
                  <span style={{ position:'absolute', left:12, top:'50%', transform:'translateY(-50%)', fontSize:14, color:C.muted }}>$</span>
                  <input type="text" value={val} onChange={e=>set(e.target.value.replace(/[^0-9]/g,''))}
                    placeholder={ph} style={{ ...inputBase, paddingLeft:26 }}/>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Beds & Baths */}
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }} className="scout-mg">
          {[
            { label:'Bedrooms (min)', opts:['Any','1','2','3','4'], val:bedsMin, set:setBedsMin },
            { label:'Bathrooms (min)', opts:['Any','1','1.5','2','3'], val:baths, set:setBaths },
          ].map(({label,opts,val,set},j) => (
            <div key={j}>
              <Label>{label}</Label>
              <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
                {opts.map(v => {
                  const a = val === (v==='Any'?'':v);
                  return (
                    <button key={v} onClick={() => set(v==='Any'?'':v)}
                      style={{ flex:'1 1 auto', minWidth:42, padding:'9px 6px', borderRadius:10,
                        border:`1.5px solid ${a?C.green:C.border}`, background:a?C.greenBg:C.white,
                        color:a?C.green:C.text, fontWeight:a?700:400, fontSize:13,
                        cursor:'pointer', fontFamily:'inherit', transition:'all 0.15s' }}>
                      {v}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Property Type */}
        <div>
          <Label>Property Type</Label>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
            {propTypeOpts.map(p => {
              const a = propTypes.includes(p.key);
              return (
                <button key={p.key} onClick={() => togglePropType(p.key)}
                  style={{ display:'flex', alignItems:'center', gap:10, padding:'11px 14px', borderRadius:10,
                    border:`1.5px solid ${a?C.green:C.border}`, background:a?C.greenBg:C.white,
                    cursor:'pointer', fontFamily:'inherit', textAlign:'left', transition:'all 0.15s' }}>
                  <span style={{ fontSize:18 }}>{p.icon}</span>
                  <span style={{ fontSize:13, fontWeight:a?700:400, color:a?C.green:C.text }}>{p.label}</span>
                  {a && <span style={{ marginLeft:'auto', color:C.green, fontSize:12 }}>✓</span>}
                </button>
              );
            })}
          </div>
        </div>

        {/* Days on Market */}
        <div>
          <Label>Days on Market
            <span style={{ fontWeight:400, textTransform:'none', letterSpacing:0, fontSize:10, color:C.muted }}> - longer = more motivated sellers</span>
          </Label>
          <select value={daysOnMarket} onChange={e=>setDaysOnMarket(e.target.value)}
            style={{ ...inputBase, cursor:'pointer' }}>
            {domOpts.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
          </select>
        </div>

        {/* Investor Goal — feeds Live Market Intel */}
        <div>
          <Label>Investor Goal
            <span style={{ fontWeight:400, textTransform:'none', letterSpacing:0, fontSize:10, color:C.muted }}> — used to personalize market intelligence</span>
          </Label>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
            {[
              { v:'cashflow',     l:'Cash Flow',     icon:'💰', desc:'Max monthly income' },
              { v:'appreciation', l:'Appreciation',  icon:'📈', desc:'Long-term equity' },
              { v:'balanced',     l:'Balanced',      icon:'⚖️',  desc:'Both cash & growth' },
              { v:'tax',          l:'Tax Advantage', icon:'🧾', desc:'Depreciation & 1031' },
            ].map(o => {
              const a = goal === o.v;
              return (
                <button key={o.v} onClick={() => setGoal(o.v)}
                  style={{ display:'flex', alignItems:'center', gap:8, padding:'10px 14px', borderRadius:10,
                    border:`1.5px solid ${a?C.green:C.border}`, background:a?C.greenBg:C.white,
                    cursor:'pointer', fontFamily:'inherit', textAlign:'left', transition:'all 0.15s' }}>
                  <span style={{ fontSize:16 }}>{o.icon}</span>
                  <div>
                    <div style={{ fontSize:12.5, fontWeight:a?700:500, color:a?C.green:C.text }}>{o.l}</div>
                    <div style={{ fontSize:10.5, color:C.muted }}>{o.desc}</div>
                  </div>
                  {a && <span style={{ marginLeft:'auto', color:C.green, fontSize:12 }}>✓</span>}
                </button>
              );
            })}
          </div>
        </div>

        {/* Sort */}
        <div>
          <Label>Sort Results By</Label>
          <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
            {[{v:'newest',l:'Newest'},{v:'price_asc',l:'Price ↑'},{v:'price_desc',l:'Price ↓'}].map(o => (
              <button key={o.v} onClick={() => setSortBy(o.v)}
                style={{ padding:'8px 16px', borderRadius:100,
                  border:`1.5px solid ${sortBy===o.v?C.text:C.border}`,
                  background:sortBy===o.v?C.text:C.white, color:sortBy===o.v?'#fff':C.text,
                  fontWeight:sortBy===o.v?600:400, fontSize:12.5,
                  cursor:'pointer', fontFamily:'inherit', transition:'all 0.15s' }}>
                {o.l}
              </button>
            ))}
          </div>
        </div>

        <button onClick={handleSubmit}
          style={{ background:C.green, border:'none', borderRadius:12, padding:'14px', fontSize:14.5, fontWeight:700,
            color:'#fff', cursor:'pointer', fontFamily:'inherit', width:'100%', letterSpacing:'-0.01em', marginTop:4 }}>
          Find Investment Properties →
        </button>
      </div>
    </Card>
  );
}

// --- Main ---------------------------------------------------------------------
export default function Scout() {
  const [stage,   setStage]   = useState('form');
  const [filters, setFilters] = useState(null);
  const [prefilledCity, setPrefilledCity] = useState('');
  const { data: session, status: authStatus } = useSession();
  const tokens = session?.user?.tokens ?? 0;

  const handleSubmitFilters = useCallback((f) => {
    setFilters(f);
    setStage('results');
  }, []);

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const city = p.get('city');
    if (city) setPrefilledCity(city);
    if (p.get('goal') || p.get('budget') || city) window.history.replaceState({}, '', '/scout');
  }, []);

  return (
    <>
      <Head>
        <title>RentalIQ Market Search - Find Rental Properties</title>
        <meta name="description" content="Search for investment properties with investor-grade filters. Get real HUD + Census rent data for your target market, then open targeted searches on Zillow and Redfin."/>
        <meta property="og:title" content="RentalIQ Market Search - Find Rental Properties"/>
        <meta property="og:type" content="website"/>
        <meta name="twitter:card" content="summary"/>
        <meta name="viewport" content="width=device-width, initial-scale=1"/>
      </Head>
      <style>{`
        @keyframes spin   { to { transform:rotate(360deg) } }
        @keyframes fadeup { from { opacity:0;transform:translateY(12px) } to { opacity:1;transform:translateY(0) } }
        * { box-sizing:border-box }
        input:focus, select:focus { border-color:#2d7a4f!important; outline:none!important }
        @media(max-width:600px) { .scout-mg { grid-template-columns:1fr!important } }
      `}</style>

      <div style={{ background:C.bg, minHeight:'100vh', fontFamily:"'DM Sans',system-ui,sans-serif" }}>

        {/* Nav — full-width, outside content wrapper */}
        <nav style={{ position:'sticky', top:0, zIndex:100, background:'rgba(245,245,248,0.88)', backdropFilter:'blur(12px)', WebkitBackdropFilter:'blur(12px)', borderBottom:`1px solid ${C.border}`, padding:'0 32px' }}>
          <div style={{ maxWidth:1080, margin:'0 auto', display:'flex', alignItems:'center', justifyContent:'space-between', height:52 }}>
            <div style={{ display:'flex', alignItems:'center', gap:8 }}>
              <Link href="/analyze" style={{ display:'flex', alignItems:'center', gap:8, textDecoration:'none' }}>
                <div style={{ width:8, height:8, background:C.green, borderRadius:'50%' }}/>
                <span style={{ fontSize:13, fontWeight:700, letterSpacing:'-0.01em', color:C.text }}>RentalIQ</span>
              </Link>
              <div style={{ display:'inline-flex', background:C.soft, borderRadius:10, padding:3, gap:3, marginLeft:8 }}>
                <Link href="/analyze" style={{ display:'block', padding:'5px 14px', borderRadius:8, fontSize:12.5, fontWeight:600, color:C.muted, textDecoration:'none' }}>
                  Analyze a Listing
                </Link>
                <span style={{ display:'block', padding:'5px 14px', borderRadius:8, background:C.white, fontSize:12.5, fontWeight:700, color:C.text, boxShadow:C.shadowSm }}>
                  Market Search
                </span>
              </div>
            </div>
            <div style={{ display:'flex', alignItems:'center', gap:8 }}>
              {authStatus === 'authenticated' ? (
                <>
                  <Link href="/dashboard" style={{ fontSize:12, color:C.muted, textDecoration:'none', padding:'5px 12px', border:`1px solid ${C.border}`, borderRadius:8, fontWeight:600, transition:'border-color 0.15s' }}>My Deals</Link>
                  <a href="/analyze" style={{ fontSize:12, fontWeight:700, color:tokens<=0?C.red:tokens<=2?C.amber:C.green, padding:'5px 12px', border:`1px solid ${tokens<=0?C.red:tokens<=2?C.amber:C.green}`, borderRadius:8, background:C.white, textDecoration:'none', cursor:'pointer' }} title="Buy more tokens">
                    {tokens} token{tokens!==1?'s':''}
                  </a>
                </>
              ) : (
                <Link href="/auth" style={{ padding:'5px 14px', borderRadius:8, fontSize:12.5, fontWeight:600, color:'#fff', background:C.green, textDecoration:'none' }}>
                  Sign In
                </Link>
              )}
            </div>
          </div>
        </nav>

        <div style={{ maxWidth:720, margin:'0 auto', padding:'0 20px 80px' }}>

          {/* Header */}
          <header style={{ textAlign:'center', padding:'52px 0 36px' }}>
            <div style={{ display:'inline-flex', alignItems:'center', gap:8, marginBottom:14, fontSize:11, fontWeight:600, letterSpacing:'0.12em', color:C.muted, textTransform:'uppercase' }}>
              <div style={{ width:7, height:7, background:C.green, borderRadius:'50%' }}/>
              RentalIQ Scout
            </div>
            <h1 style={{ fontFamily:"'Libre Baskerville',Georgia,serif", fontSize:'clamp(28px,5vw,48px)', fontWeight:700, letterSpacing:'-0.03em', lineHeight:1.1, marginBottom:12, color:C.text }}>
              Find your next{' '}
              <em style={{ fontStyle:'italic', color:C.green, fontWeight:400 }}>rental property</em>
            </h1>
            <p style={{ fontSize:15.5, color:C.muted, lineHeight:1.65, maxWidth:500, margin:'0 auto' }}>
              Set investor-grade filters and get real HUD + Census rent data for your market.
              We open a targeted search on Zillow and Redfin — then you paste the listing into RentalIQ to run the full analysis.
            </p>
          </header>

          {stage === 'form' && (
            <SearchForm onSubmit={handleSubmitFilters} prefilledCity={prefilledCity} />
          )}
          {stage === 'results' && filters && (
            <ResultsPanel filters={filters} onBack={() => setStage('form')} />
          )}
        </div>

        <footer style={{ textAlign:'center', padding:'16px 0 32px', fontSize:12, color:C.muted, borderTop:`1px solid ${C.border}` }}>
          RentalIQ Scout · Rent data: HUD FMR + Census ACS · Not financial advice
        </footer>
      </div>
    </>
  );
}
