/**
 * pages/scout.js — RentalIQ Scout (redesigned)
 *
 * Single unified page:
 *   - Goal selector at top (Cash Flow / Appreciation / Balanced)
 *   - Ranked market cards load immediately from static data
 *   - Each card has "Find Deals" that fetches real listings for that market
 *   - No tabs, no messy sidebar filter panel
 *   - Clean price + beds filter bar at top
 */

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useSession }       from 'next-auth/react';
import Head                 from 'next/head';
import Link                 from 'next/link';
import { getRankedMarkets, getMarketTagline } from '../lib/scoutMarkets.js';
import { getDeviceFingerprint }               from '../lib/fingerprint.js';

const C = {
  bg:'#f5f5f8', white:'#ffffff', border:'#dddde4', text:'#0d0d0f', muted:'#72727a', soft:'#eaeaef',
  green:'#166638', greenBg:'#ecf6f1', greenBorder:'#96ccb0',
  red:'#a62626', redBg:'#fdf0f0', redBorder:'#e0aaaa',
  amber:'#8a5800', amberBg:'#fdf4e8', amberBorder:'#dfc070',
  blue:'#1649a0', blueBg:'#edf1fc', blueBorder:'#a0beed',
  shadow:'0 1px 2px rgba(0,0,0,0.05), 0 2px 12px rgba(0,0,0,0.06)',
  shadowSm:'0 1px 2px rgba(0,0,0,0.04)',
};

function Pill({ label, value, color = C.text, bg = C.soft, border = C.border }) {
  return (
    <div style={{ background: bg, border: `1px solid ${border}`, borderRadius: 10, padding: '8px 12px' }}>
      <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.10em', textTransform: 'uppercase', color: C.muted, marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 700, color, fontFamily: "'Libre Baskerville',Georgia,serif", lineHeight: 1 }}>{value}</div>
    </div>
  );
}

function LandlordBadge({ score }) {
  const color  = score >= 80 ? C.green  : score >= 60 ? C.amber  : C.red;
  const bg     = score >= 80 ? C.greenBg : score >= 60 ? C.amberBg : C.redBg;
  const border = score >= 80 ? C.greenBorder : score >= 60 ? C.amberBorder : C.redBorder;
  const label  = score >= 80 ? 'Landlord Friendly' : score >= 60 ? 'Moderate Laws' : 'Tenant Favorable';
  return (
    <span style={{ fontSize: 10.5, fontWeight: 700, color, background: bg, border: `1px solid ${border}`, borderRadius: 100, padding: '3px 10px', whiteSpace: 'nowrap' }}>
      {label} · {score}/100
    </span>
  );
}

// ─── Inline deal card ─────────────────────────────────────────────────────────
function DealCard({ deal, onFlagSold }) {
  const [flagging, setFlagging] = useState(false);
  const [flagged,  setFlagged]  = useState(false);
  const cf      = deal.cash_flow;
  const cfColor = cf >= 200 ? C.green : cf >= 0 ? C.amber : C.red;
  const cfLabel = cf >= 0 ? `+$${cf.toLocaleString()}/mo` : `-$${Math.abs(cf).toLocaleString()}/mo`;

  async function handleFlagSold() {
    if (flagged || flagging) return;
    setFlagging(true);
    try {
      await fetch('/api/scout-deals/flag', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({id:deal.id}) });
      setFlagged(true); onFlagSold?.(deal.id);
    } catch {}
    setFlagging(false);
  }

  const sourceColor = { zillow:'#006AFF', redfin:'#CC0000', realtor:'#D9232D' }[deal.source] || C.muted;
  const sourceLabel = { zillow:'Zillow', redfin:'Redfin', realtor:'Realtor' }[deal.source] || deal.source;

  return (
    <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 14, overflow:'hidden', opacity: flagged ? 0.4 : 1, transition:'opacity 0.3s' }}>
      <div style={{ padding:'16px 18px 12px' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:10, marginBottom:10 }}>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ display:'flex', gap:6, marginBottom:5, flexWrap:'wrap', alignItems:'center' }}>
              <span style={{ fontSize:10, fontWeight:700, color: sourceColor, background:`${sourceColor}12`, border:`1px solid ${sourceColor}30`, borderRadius:6, padding:'2px 7px' }}>{sourceLabel}</span>
              {deal.days_on_market !== null && <span style={{ fontSize:10.5, color:C.muted }}>{deal.days_on_market}d listed</span>}
            </div>
            <div style={{ fontFamily:"'Libre Baskerville',Georgia,serif", fontSize:15, fontWeight:700, color:C.text, lineHeight:1.2, marginBottom:2 }}>{deal.address}</div>
            <div style={{ fontSize:12, color:C.muted }}>{deal.beds}BR · {deal.baths}BA{deal.sqft ? ` · ${deal.sqft.toLocaleString()} sqft` : ''}</div>
          </div>
          <div style={{ flexShrink:0, textAlign:'right' }}>
            <div style={{ fontFamily:"'Libre Baskerville',Georgia,serif", fontSize:20, fontWeight:700, color:C.text }}>${deal.price.toLocaleString()}</div>
          </div>
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:6, marginBottom:10 }}>
          <Pill label="Cap Rate" value={`${deal.cap_rate}%`} color={deal.cap_rate >= 7 ? C.green : deal.cap_rate >= 5.5 ? C.amber : C.text}/>
          <Pill label="Cash Flow" value={cfLabel} color={cfColor}/>
          <Pill label="Est. Rent" value={`$${deal.estimated_rent?.toLocaleString()}/mo`} color={C.blue}/>
        </div>
        <div style={{ fontSize:10, color:C.muted, lineHeight:1.4 }}>20% down · 7% rate · HUD FMR rent · estimates only — verify with full analysis</div>
      </div>
      <div style={{ padding:'10px 18px 14px', display:'flex', gap:7, borderTop:`1px solid ${C.border}` }}>
        <a href={deal.listing_url} target="_blank" rel="noopener noreferrer"
          style={{ flex:'1 1 auto', display:'flex', alignItems:'center', justifyContent:'center', gap:5, background:C.green, color:'#fff', borderRadius:9, padding:'9px 12px', textDecoration:'none', fontWeight:700, fontSize:12.5, fontFamily:"'DM Sans',system-ui,sans-serif" }}>
          View Listing <svg width="9" height="9" viewBox="0 0 10 10" fill="none"><path d="M2 8L8 2M8 2H4M8 2V6" stroke="white" strokeWidth="1.5" strokeLinecap="round"/></svg>
        </a>
        <Link href={`/analyze?url=${encodeURIComponent(deal.listing_url)}`}
          style={{ flex:'1 1 auto', display:'flex', alignItems:'center', justifyContent:'center', gap:5, background:C.white, color:C.green, border:`1.5px solid ${C.green}`, borderRadius:9, padding:'9px 12px', textDecoration:'none', fontWeight:700, fontSize:12.5, fontFamily:"'DM Sans',system-ui,sans-serif" }}>
          Full Analysis →
        </Link>
        <button onClick={handleFlagSold} disabled={flagging||flagged} title="Mark as sold"
          style={{ padding:'9px 11px', border:`1px solid ${C.border}`, borderRadius:9, background:'none', cursor:flagged?'default':'pointer', color:flagged?C.green:C.muted, fontSize:11.5, fontWeight:500, fontFamily:"'DM Sans',system-ui,sans-serif" }}>
          {flagged ? '✓' : flagging ? '…' : 'Sold?'}
        </button>
      </div>
    </div>
  );
}

// ─── Market card with inline deal discovery ───────────────────────────────────
function MarketCard({ market, rank, filters, session, guestStatus, fpRef, onGuestUsed }) {
  const [open,        setOpen]        = useState(false);
  const [dealState,   setDealState]   = useState('idle'); // idle | loading | done | error | gate
  const [deals,       setDeals]       = useState(null);
  const [flaggedIds,  setFlaggedIds]  = useState(new Set());
  const [dealErr,     setDealErr]     = useState(null);

  const cf      = market.cashFlow;
  const cfColor = cf === null ? C.muted : cf >= 200 ? C.green : cf >= 0 ? C.amber : C.red;
  const cfLabel = cf === null ? 'N/A' : cf >= 0 ? `+$${cf.toLocaleString()}/mo` : `-$${Math.abs(cf).toLocaleString()}/mo`;
  const tagline = getMarketTagline(market);
  const rankColor = rank <= 3 ? C.green : rank <= 8 ? C.amber : C.muted;
  const rankBg    = rank <= 3 ? C.greenBg : rank <= 8 ? C.amberBg : C.soft;

  const tokens    = session?.user?.tokens ?? 0;
  const isAuthed  = !!session?.user?.id;
  const canSearch = isAuthed ? tokens >= 1 : (guestStatus?.allowed !== false);

  async function findDeals() {
    if (dealState === 'loading') return;

    // Gate check
    if (!canSearch) { setDealState('gate'); return; }

    setDealState('loading'); setDealErr(null); setDeals(null);

    // First try the cached GET
    try {
      const r = await fetch(`/api/scout-deals?city=${encodeURIComponent(market.city)}&state=${market.state}&priceMax=${filters.priceMax}&beds=${filters.beds}`);
      const d = await r.json();
      if (d.deals?.length > 0) {
        setDeals(d.deals); setDealState('done'); return;
      }
    } catch {}

    // No cache hit — call AI (costs 1 token / guest use)
    const body = { city: market.city, state: market.state, priceMax: filters.priceMax, beds: filters.beds, propType: 'sfr', goal: filters.goal };
    if (!isAuthed && fpRef.current) body.fp = fpRef.current;

    try {
      const res  = await fetch('/api/scout-deals', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) {
        if (data.code === 'NO_TOKENS' || data.code === 'GUEST_USED') { setDealState('gate'); return; }
        setDealErr(data.error || 'Search failed. Try again.'); setDealState('error'); return;
      }
      setDeals(data.deals || []);
      setDealState('done');
      if (!isAuthed) onGuestUsed?.();
    } catch {
      setDealErr('Search temporarily unavailable.'); setDealState('error');
    }
  }

  const visibleDeals = (deals || []).filter(d => !flaggedIds.has(d.id));

  return (
    <div className="riq-lift" style={{ background:C.white, border:`1px solid ${C.border}`, borderRadius:16, overflow:'hidden', animation:'riq-fadeup 0.4s ease both' }}>
      {/* Card header */}
      <div style={{ padding:'18px 20px 0' }}>
        <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:12, marginBottom:12 }}>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:5 }}>
              <span style={{ fontSize:11, fontWeight:800, color:rankColor, background:rankBg, border:`1px solid ${rankColor}30`, borderRadius:7, padding:'2px 8px', flexShrink:0 }}>#{rank}</span>
              <h2 style={{ margin:0, fontFamily:"'Libre Baskerville',Georgia,serif", fontSize:19, fontWeight:700, color:C.text, letterSpacing:'-0.02em', lineHeight:1.1 }}>
                {market.city}<span style={{ fontFamily:"'DM Sans',system-ui,sans-serif", fontWeight:500, fontSize:13, color:C.muted, marginLeft:6 }}>{market.state}</span>
              </h2>
            </div>
            <div style={{ fontSize:12, color:C.muted, lineHeight:1.4 }}>{tagline}</div>
          </div>
          <div style={{ flexShrink:0, textAlign:'center' }}>
            <div style={{ fontSize:24, fontWeight:800, color:C.green, lineHeight:1 }}>{market.score}</div>
            <div style={{ fontSize:9, fontWeight:600, letterSpacing:'0.08em', textTransform:'uppercase', color:C.muted, marginTop:2 }}>Score</div>
          </div>
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:7, marginBottom:12 }}>
          <Pill label="Cap Rate" value={`${market.capRate}%`} color={market.capRate >= 7 ? C.green : market.capRate >= 5.5 ? C.amber : C.text}/>
          <Pill label="Est. Cash Flow" value={cfLabel} color={cfColor}/>
          <Pill label="Appreciation" value={`${market.appreciationRate}%/yr`} color={C.blue}/>
        </div>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12, gap:8 }}>
          <LandlordBadge score={market.landlordScore}/>
          <span style={{ fontSize:11, color:C.muted }}>{market.region}</span>
        </div>
        {/* Score bar */}
        <div style={{ height:4, background:C.soft, borderRadius:2, overflow:'hidden', marginBottom:14 }}>
          <div style={{ height:'100%', width:`${Math.min(100,market.score)}%`, background:C.green, borderRadius:2, transition:'width 0.5s ease' }}/>
        </div>
      </div>

      {/* Browse + Find deals row */}
      <div style={{ padding:'12px 20px', display:'flex', gap:7, flexWrap:'wrap', borderTop:`1px solid ${C.border}` }}>
        {[
          { href:market.zillowUrl,  label:'Zillow',      bg:'#006AFF', shadow:'rgba(0,106,255,0.25)' },
          { href:market.redfinUrl,  label:'Redfin',      bg:'#CC0000', shadow:'rgba(204,0,0,0.22)' },
          { href:market.realtorUrl, label:'Realtor.com', bg:C.white, color:'#D9232D', border:'1.5px solid #D9232D' },
        ].map(btn => (
          <a key={btn.label} href={btn.href} target="_blank" rel="noopener noreferrer"
            style={{ flex:'1 1 auto', display:'flex', alignItems:'center', justifyContent:'center', gap:5, background:btn.bg, color:btn.color||'#fff', border:btn.border||'none', borderRadius:9, padding:'9px 10px', textDecoration:'none', fontWeight:700, fontSize:11.5, fontFamily:"'DM Sans',system-ui,sans-serif", boxShadow:btn.shadow?`0 2px 8px ${btn.shadow}`:'none' }}>
            {btn.label}
            <svg width="9" height="9" viewBox="0 0 10 10" fill="none"><path d="M2 8L8 2M8 2H4M8 2V6" stroke={btn.color||'white'} strokeWidth="1.5" strokeLinecap="round"/></svg>
          </a>
        ))}
      </div>

      {/* Find Deals button */}
      <div style={{ padding:'0 20px 16px' }}>
        {dealState === 'idle' && (
          <button onClick={findDeals}
            style={{ width:'100%', padding:'12px', border:`1.5px solid ${canSearch ? C.green : C.border}`, borderRadius:11, background:canSearch?C.greenBg:C.soft, color:canSearch?C.green:C.muted, fontFamily:"'DM Sans',system-ui,sans-serif", fontSize:13.5, fontWeight:700, cursor:'pointer', transition:'all 0.15s', display:'flex', alignItems:'center', justifyContent:'center', gap:8 }}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" strokeWidth="1.6"/><path d="M10 10l3.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>
            Find deals here{!isAuthed && canSearch ? ' (free)' : isAuthed ? ' · 1 token' : ''}
          </button>
        )}
        {dealState === 'loading' && (
          <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:10, padding:'14px', color:C.muted, fontSize:13 }}>
            <div style={{ width:14, height:14, border:`2px solid ${C.border}`, borderTopColor:C.green, borderRadius:'50%', animation:'riq-spin 0.7s linear infinite', flexShrink:0 }}/>
            Searching for active listings…
          </div>
        )}
        {dealState === 'error' && (
          <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
            <div style={{ fontSize:12.5, color:C.red, padding:'10px 14px', background:C.redBg, border:`1px solid ${C.redBorder}`, borderRadius:10 }}>{dealErr}</div>
            <button onClick={() => { setDealState('idle'); }} style={{ fontSize:12, color:C.muted, background:'none', border:'none', cursor:'pointer', textDecoration:'underline' }}>Try again</button>
          </div>
        )}
        {dealState === 'gate' && (
          <div style={{ background:C.amberBg, border:`1px solid ${C.amberBorder}`, borderRadius:11, padding:'14px 16px' }}>
            <div style={{ fontWeight:700, fontSize:13.5, color:C.amber, marginBottom:5 }}>{isAuthed ? 'Out of tokens' : 'Free search used'}</div>
            <div style={{ fontSize:12, color:'#5a3d00', marginBottom:12, lineHeight:1.55 }}>
              {isAuthed ? 'Buy more tokens to search more markets.' : 'Sign up free for 2 tokens — 1 Scout search + 1 full analysis.'}
            </div>
            <Link href={isAuthed ? '/dashboard' : '/auth'}
              style={{ display:'inline-block', padding:'8px 18px', borderRadius:9, background:C.green, color:'#fff', textDecoration:'none', fontWeight:700, fontSize:12.5, fontFamily:"'DM Sans',system-ui,sans-serif" }}>
              {isAuthed ? 'Buy tokens →' : 'Sign up free →'}
            </Link>
          </div>
        )}
        {dealState === 'done' && (
          <div>
            {/* Collapse/expand toggle */}
            <button onClick={() => setOpen(o => !o)}
              style={{ width:'100%', display:'flex', alignItems:'center', justifyContent:'space-between', padding:'10px 0 8px', background:'none', border:'none', cursor:'pointer', fontFamily:"'DM Sans',system-ui,sans-serif", fontSize:12.5, fontWeight:600, color:C.green }}>
              <span>{visibleDeals.length > 0 ? `${visibleDeals.length} listing${visibleDeals.length !== 1 ? 's' : ''} found` : 'No listings found'}</span>
              <svg width="13" height="13" viewBox="0 0 14 14" fill="none" style={{ transform: open ? 'rotate(180deg)' : 'none', transition:'transform 0.2s' }}>
                <path d="M3 5l4 4 4-4" stroke={C.green} strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </button>
            {open && (
              <div style={{ display:'flex', flexDirection:'column', gap:10, paddingTop:4 }}>
                {visibleDeals.length === 0 ? (
                  <div style={{ padding:'18px', background:C.soft, borderRadius:12, textAlign:'center', fontSize:13, color:C.muted }}>
                    No verified listings found right now. Try the Zillow/Redfin links above to search manually.
                  </div>
                ) : (
                  visibleDeals.map(deal => (
                    <DealCard key={deal.id || deal.listing_url} deal={deal} onFlagSold={id => setFlaggedIds(prev => new Set([...prev, id]))}/>
                  ))
                )}
                <div style={{ fontSize:10.5, color:C.muted, textAlign:'center', lineHeight:1.5 }}>
                  Listings valid up to 30 days · Prices may have changed · Always verify before acting
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Market details collapsible — only used when deals aren't shown */}
      <div style={{ borderTop:`1px solid ${C.border}` }}>
        <button onClick={() => { if (dealState !== 'done') setOpen(o => !o); }}
          style={{ width:'100%', padding:'9px 20px', background:'none', border:'none', cursor:'pointer', fontFamily:"'DM Sans',system-ui,sans-serif", fontSize:11.5, fontWeight:600, color:C.muted, display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          Market details
          <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M3 5l4 4 4-4" stroke={C.muted} strokeWidth="1.5" strokeLinecap="round"/></svg>
        </button>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function Scout() {
  const { data: session, status: authStatus } = useSession();
  const tokens   = session?.user?.tokens ?? 0;
  const isAuthed = !!session?.user?.id;

  const [goal,      setGoal]      = useState('cashflow');
  const [priceMax,  setPriceMax]  = useState(350000);
  const [beds,      setBeds]      = useState(3);
  const [guestStatus, setGuestStatus] = useState(null);
  const fpRef = useRef(null);

  const filters = useMemo(() => ({ goal, priceMax, beds, region:'all', minCapRate:0, minLandlord:0, propType:'sfr' }), [goal, priceMax, beds]);
  const markets = useMemo(() => getRankedMarkets(filters), [filters]);

  useEffect(() => {
    if (isAuthed) return;
    const fp = getDeviceFingerprint();
    fpRef.current = fp;
    fetch(`/api/guest-usage?action=check&type=scout&fp=${fp}`)
      .then(r => r.json())
      .then(d => setGuestStatus(d))
      .catch(() => setGuestStatus({ allowed: true }));
  }, [isAuthed]);

  const GOALS = [
    { v:'cashflow',    l:'Max Cash Flow',  sub:'Highest cap rates now' },
    { v:'appreciation',l:'Appreciation',   sub:'Long-term equity growth' },
    { v:'balanced',    l:'Balanced',       sub:'Cash flow + growth' },
  ];

  return (
    <>
      <Head>
        <title>RentalIQ Scout — Best Rental Markets & Deals</title>
        <meta name="description" content="Discover the best US rental investment markets ranked by cap rate, cash flow, and landlord laws. Find real active listings in any market instantly."/>
        <meta name="viewport" content="width=device-width, initial-scale=1"/>
      </Head>
      <style>{`
        @keyframes riq-fadeup { from{opacity:0;transform:translateY(18px)} to{opacity:1;transform:translateY(0)} }
        @keyframes riq-spin   { to{transform:rotate(360deg)} }
        *{box-sizing:border-box}
        .riq-lift{transition:transform 0.22s ease,box-shadow 0.22s ease;box-shadow:0 1px 2px rgba(0,0,0,0.05),0 2px 12px rgba(0,0,0,0.06)}
        .riq-lift:hover{transform:translateY(-2px);box-shadow:0 8px 32px rgba(0,0,0,0.09)!important}
        @media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
      `}</style>

      <div style={{ background:C.bg, minHeight:'100vh', fontFamily:"'DM Sans',system-ui,sans-serif" }}>

        {/* Nav */}
        <nav style={{ position:'sticky', top:0, zIndex:100, background:'rgba(245,245,248,0.9)', backdropFilter:'blur(12px)', WebkitBackdropFilter:'blur(12px)', borderBottom:`1px solid ${C.border}`, padding:'0 28px' }}>
          <div style={{ maxWidth:880, margin:'0 auto', display:'flex', alignItems:'center', justifyContent:'space-between', height:52 }}>
            <Link href="/" style={{ display:'flex', alignItems:'center', textDecoration:'none' }}>
              <span style={{ fontSize:16, fontWeight:700, letterSpacing:'-0.01em', color:C.text }}>RentalIQ</span>
            </Link>
            <div style={{ display:'flex', alignItems:'center', gap:12 }}>
              <div style={{ display:'inline-flex', background:C.soft, borderRadius:10, padding:3, gap:3 }}>
                <Link href="/analyze" style={{ display:'block', padding:'5px 14px', borderRadius:8, fontSize:12.5, fontWeight:500, color:C.muted, textDecoration:'none' }}>Analyze</Link>
                <span style={{ display:'block', padding:'5px 14px', borderRadius:8, background:C.white, fontSize:12.5, fontWeight:700, color:C.text, boxShadow:C.shadowSm }}>Scout</span>
              </div>
              {isAuthed ? (
                <div style={{ display:'flex', gap:8 }}>
                  <Link href="/dashboard" style={{ fontSize:12, color:C.muted, textDecoration:'none', padding:'5px 12px', border:`1px solid ${C.border}`, borderRadius:8 }}>My Deals</Link>
                  <span style={{ fontSize:12, color:tokens<=0?C.red:tokens<=2?C.amber:C.green, padding:'5px 12px', border:`1px solid ${tokens<=0?C.redBorder:tokens<=2?C.amberBorder:C.greenBorder}`, borderRadius:8, background:C.white, fontWeight:700 }}>
                    {tokens} token{tokens!==1?'s':''}
                  </span>
                </div>
              ) : (
                <Link href="/auth" style={{ padding:'6px 16px', borderRadius:9, fontSize:12.5, fontWeight:600, color:'#fff', background:C.green, textDecoration:'none' }}>Sign In</Link>
              )}
            </div>
          </div>
        </nav>

        {/* Hero */}
        <header style={{ padding:'44px 28px 32px', background:`radial-gradient(ellipse 900px 400px at 50% 0%, rgba(22,102,56,0.07) 0%, transparent 70%), ${C.bg}`, borderBottom:`1px solid ${C.border}`, animation:'riq-fadeup 0.5s ease both' }}>
          <div style={{ maxWidth:880, margin:'0 auto' }}>
            <div style={{ display:'inline-flex', alignItems:'center', gap:6, marginBottom:14, padding:'4px 12px', background:C.white, border:`1px solid ${C.border}`, borderRadius:100, boxShadow:C.shadowSm }}>
              <div style={{ width:6, height:6, background:C.green, borderRadius:'50%' }}/>
              <span style={{ fontSize:10.5, fontWeight:600, letterSpacing:'0.10em', color:C.muted, textTransform:'uppercase' }}>Ranked · Scored · Live deal discovery</span>
            </div>
            <h1 style={{ margin:'0 0 10px', fontFamily:"'Libre Baskerville',Georgia,serif", fontSize:'clamp(26px,4vw,46px)', fontWeight:700, letterSpacing:'-0.03em', lineHeight:1.05, color:C.text }}>
              Where are the <em style={{ fontStyle:'italic', color:C.green, fontWeight:400 }}>best rental deals</em> right now?
            </h1>
            <p style={{ margin:'0 0 28px', fontSize:15, color:C.muted, lineHeight:1.65, maxWidth:540 }}>
              Markets ranked by cap rate, cash flow, and landlord laws. Click "Find deals" on any market to surface real active listings.
            </p>

            {/* Goal selector */}
            <div style={{ marginBottom:20 }}>
              <div style={{ fontSize:10, fontWeight:700, letterSpacing:'0.10em', textTransform:'uppercase', color:C.muted, marginBottom:9 }}>Your goal</div>
              <div style={{ display:'inline-flex', background:C.soft, borderRadius:11, padding:4, gap:3 }}>
                {GOALS.map(g => {
                  const active = goal === g.v;
                  return (
                    <button key={g.v} onClick={() => setGoal(g.v)}
                      style={{ display:'flex', flexDirection:'column', alignItems:'flex-start', padding:'9px 18px', borderRadius:8, background:active?C.white:'none', border:'none', cursor:'pointer', fontFamily:"'DM Sans',system-ui,sans-serif", boxShadow:active?C.shadowSm:'none', transition:'all 0.15s', minWidth:110 }}>
                      <span style={{ fontSize:13, fontWeight:active?700:500, color:active?C.text:C.muted }}>{g.l}</span>
                      <span style={{ fontSize:10.5, color:active?C.green:C.muted, fontWeight:600 }}>{g.sub}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Price + Beds */}
            <div style={{ display:'flex', gap:20, flexWrap:'wrap', alignItems:'center' }}>
              <div>
                <div style={{ fontSize:10, fontWeight:700, letterSpacing:'0.10em', textTransform:'uppercase', color:C.muted, marginBottom:7 }}>Max price</div>
                <div style={{ display:'flex', gap:5 }}>
                  {[150000,250000,350000,500000].map(v => {
                    const a = priceMax === v;
                    return <button key={v} onClick={() => setPriceMax(v)} style={{ padding:'7px 12px', borderRadius:8, border:`1.5px solid ${a?C.green:C.border}`, background:a?C.greenBg:C.white, color:a?C.green:C.muted, fontWeight:a?700:400, fontSize:12, cursor:'pointer', fontFamily:"'DM Sans',system-ui,sans-serif", transition:'all 0.15s' }}>${v/1000}k</button>;
                  })}
                </div>
              </div>
              <div>
                <div style={{ fontSize:10, fontWeight:700, letterSpacing:'0.10em', textTransform:'uppercase', color:C.muted, marginBottom:7 }}>Bedrooms</div>
                <div style={{ display:'flex', gap:5 }}>
                  {[2,3,4].map(v => {
                    const a = beds === v;
                    return <button key={v} onClick={() => setBeds(v)} style={{ padding:'7px 14px', borderRadius:8, border:`1.5px solid ${a?C.green:C.border}`, background:a?C.greenBg:C.white, color:a?C.green:C.muted, fontWeight:a?700:400, fontSize:12.5, cursor:'pointer', fontFamily:"'DM Sans',system-ui,sans-serif", transition:'all 0.15s' }}>{v}BR</button>;
                  })}
                </div>
              </div>
            </div>
          </div>
        </header>

        {/* Market list */}
        <div style={{ maxWidth:880, margin:'0 auto', padding:'28px 28px 80px' }}>
          {/* Disclaimer */}
          <div style={{ background:C.amberBg, border:`1px solid ${C.amberBorder}`, borderRadius:12, padding:'11px 15px', display:'flex', alignItems:'flex-start', gap:9, marginBottom:20 }}>
            <svg width="14" height="14" viewBox="0 0 15 15" fill="none" style={{ flexShrink:0, marginTop:1 }}>
              <path d="M7.5 1.5L13.5 13H1.5L7.5 1.5Z" stroke={C.amber} strokeWidth="1.4" fill="none"/>
              <path d="M7.5 6v3M7.5 10.5v.5" stroke={C.amber} strokeWidth="1.4" strokeLinecap="round"/>
            </svg>
            <div style={{ fontSize:11.5, color:C.amber, lineHeight:1.55 }}>
              <strong>Investor estimates.</strong> Cap rates and cash flow are modeled at 20% down, 7% rate, market-average expenses. Always analyze specific listings before investing.
            </div>
          </div>

          {/* Cards */}
          <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
            {markets.length === 0 ? (
              <div style={{ background:C.white, border:`1px solid ${C.border}`, borderRadius:16, padding:'36px 24px', textAlign:'center' }}>
                <div style={{ fontSize:15, fontWeight:700, color:C.text, marginBottom:8 }}>No markets match these filters</div>
                <button onClick={() => { setGoal('cashflow'); setPriceMax(350000); setBeds(3); }}
                  style={{ padding:'10px 22px', border:'none', borderRadius:10, background:C.green, color:'#fff', fontWeight:700, fontSize:13, cursor:'pointer', fontFamily:"'DM Sans',system-ui,sans-serif" }}>
                  Reset filters
                </button>
              </div>
            ) : markets.map((m, i) => (
              <MarketCard
                key={m.key}
                market={m}
                rank={i + 1}
                filters={filters}
                session={session}
                guestStatus={guestStatus}
                fpRef={fpRef}
                onGuestUsed={() => setGuestStatus(prev => ({ ...prev, allowed: false, usedScout: true }))}
              />
            ))}
          </div>

          {/* Bottom CTA */}
          {markets.length > 0 && (
            <div style={{ marginTop:24, background:C.greenBg, border:`1.5px solid ${C.greenBorder}`, borderRadius:16, padding:'24px', textAlign:'center' }}>
              <div style={{ fontFamily:"'Libre Baskerville',Georgia,serif", fontSize:20, fontWeight:700, color:C.text, marginBottom:8 }}>Found a listing you like?</div>
              <div style={{ fontSize:13.5, color:'#3a6e50', marginBottom:18, lineHeight:1.65 }}>
                Paste any Zillow or Redfin URL for a full cap rate, cash flow, IRR, and buy/pass verdict in under 30 seconds.
              </div>
              <Link href="/analyze" style={{ display:'inline-block', background:C.green, color:'#fff', borderRadius:10, padding:'12px 28px', fontSize:14, fontWeight:700, textDecoration:'none', boxShadow:'0 4px 16px rgba(22,102,56,0.3)' }}>
                Analyze a listing →
              </Link>
            </div>
          )}

          {/* Data sources */}
          <div style={{ marginTop:16, padding:'12px 16px', background:C.soft, borderRadius:12, border:`1px solid ${C.border}` }}>
            <div style={{ fontSize:10, fontWeight:700, letterSpacing:'0.08em', textTransform:'uppercase', color:C.muted, marginBottom:5 }}>Data sources</div>
            <div style={{ fontSize:11, color:C.muted, lineHeight:1.7 }}>
              Cap rates: CBRE/JLL via HUD SAFMR + Census ACS · Landlord scores: Eviction Lab + NCSL · Tax: Tax Foundation 2024 · Appreciation: 5yr FHFA CAGR · Deals: Gemini AI + live Google Search
            </div>
          </div>
        </div>

        <footer style={{ textAlign:'center', padding:'16px 0 32px', fontSize:11.5, color:C.muted, borderTop:`1px solid ${C.border}` }}>
          RentalIQ Scout · Not financial advice
        </footer>
      </div>
    </>
  );
}
