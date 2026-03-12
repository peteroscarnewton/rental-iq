/**
 * pages/scout.js — RentalIQ Scout
 * Fully centered. Fetches live market signals from /api/scout-markets on load.
 * Live cap rates (Census ACS + HUD SAFMR), employment, ZORI rent growth,
 * and Case-Shiller price trends are merged into rankings in real time.
 * Static data is the fallback when live data is unavailable.
 */

import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useSession }       from 'next-auth/react';
import Head                 from 'next/head';
import Link                 from 'next/link';
import { getRankedMarkets, getMarketTagline } from '../lib/scoutMarkets.js';
import { getDeviceFingerprint }               from '../lib/fingerprint.js';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://rentaliq.app';

const C = {
  bg:'#f7f7f9', white:'#ffffff', border:'#e2e2e8', text:'#0d0d0f', muted:'#6b6b74', soft:'#ebebf0',
  green:'#166638', greenBg:'#edf6f1', greenBorder:'#8ecfaa',
  red:'#a62626', redBg:'#fdf0f0', redBorder:'#e0aaaa',
  amber:'#7a4f00', amberBg:'#fdf3e4', amberBorder:'#dab96a',
  blue:'#1649a0', blueBg:'#edf1fc', blueBorder:'#a8c0e8',
  teal:'#0e6b6b', tealBg:'#e8f5f5', tealBorder:'#7ecfcf',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function Stat({ label, value, color = C.text, sub }) {
  return (
    <div style={{ flex:'1 1 0', textAlign:'center', padding:'13px 8px 11px', background:C.soft, borderRadius:12 }}>
      <div style={{ fontSize:9, fontWeight:700, letterSpacing:'0.12em', textTransform:'uppercase', color:C.muted, marginBottom:4 }}>{label}</div>
      <div style={{ fontSize:17, fontWeight:700, color, fontFamily:"'Libre Baskerville',Georgia,serif", lineHeight:1 }}>{value}</div>
      {sub && <div style={{ fontSize:9.5, color:C.muted, marginTop:3, lineHeight:1.2 }}>{sub}</div>}
    </div>
  );
}

function SignalBadge({ icon, label, color, bg, border }) {
  return (
    <span style={{ display:'inline-flex', alignItems:'center', gap:4, fontSize:10.5, fontWeight:600, color, background:bg, border:`1px solid ${border}`, borderRadius:100, padding:'3px 9px', whiteSpace:'nowrap' }}>
      {icon && <span style={{ fontSize:9 }}>{icon}</span>}
      {label}
    </span>
  );
}

function LiveDot({ title }) {
  return (
    <span title={title} style={{ display:'inline-flex', alignItems:'center', gap:4, fontSize:10, color:C.green, fontWeight:600 }}>
      <span style={{ display:'inline-block', width:5, height:5, background:C.green, borderRadius:'50%', boxShadow:`0 0 0 2px rgba(22,102,56,0.25)` }}/>
      live
    </span>
  );
}

// ── Merge live signals into a static market object ────────────────────────────
function mergeSignals(staticMarket, live) {
  if (!live) return { ...staticMarket, _live: false };
  const merged = { ...staticMarket, _live: true };

  // Upgrade cap rate if live data available
  if (live.capRate) {
    merged.capRate    = live.capRate;
    merged.capRateMfr = live.capRateMfr ?? merged.capRateMfr;
    merged.capSource  = live.capRateSource || merged.capSource;
    merged.capRateLive = true;
  }

  // Attach live signals (shown as badges/indicators on card)
  if (live.unemploymentRate !== undefined) merged.unemploymentRate     = live.unemploymentRate;
  if (live.unemploymentNational !== undefined) merged.unemploymentNational = live.unemploymentNational;
  if (live.unemploymentTrend) merged.unemploymentTrend = live.unemploymentTrend;
  if (live.employmentAsOf)    merged.employmentAsOf    = live.employmentAsOf;
  if (live.rentGrowthPct !== undefined) merged.rentGrowthPct  = live.rentGrowthPct;
  if (live.rentGrowthAsOf)    merged.rentGrowthAsOf   = live.rentGrowthAsOf;
  if (live.priceYoY !== undefined)     merged.priceYoY        = live.priceYoY;
  if (live.priceTrend)        merged.priceTrend       = live.priceTrend;
  if (live.priceCagr3yr !== undefined) merged.priceCagr3yr   = live.priceCagr3yr;
  if (live.priceCagr5yr !== undefined) merged.priceCagr5yr   = live.priceCagr5yr;
  if (live.csAsOf)            merged.csAsOf           = live.csAsOf;

  // Redfin city: listing count, price reduction signal, market temp
  if (live.listingCount  !== undefined) merged.listingCount   = live.listingCount;
  if (live.newListings   !== undefined) merged.newListings    = live.newListings;
  if (live.priceDropsPct !== undefined) merged.priceDropsPct  = live.priceDropsPct;
  if (live.marketTemp)                  merged.marketTemp     = live.marketTemp;
  if (live.marketBias)                  merged.marketBias     = live.marketBias;
  if (live.dom           !== undefined) merged.dom            = live.dom;
  if (live.saleToList    !== undefined) merged.saleToList     = live.saleToList;
  if (live.medianListPrice !== undefined) merged.medianListPrice = live.medianListPrice;
  if (live.redfinAsOf)                  merged.redfinAsOf     = live.redfinAsOf;

  return merged;
}

// Re-score a market that has a live cap rate so rankings reflect real data
function reScore(market, goal) {
  const capRate   = market.capRate || 5.0;
  const landlord  = market.landlordScore || 60;
  const taxRate   = market.taxRate || 1.0;
  const insRate   = market.insRate || 1.0;
  const apprRate  = market.appreciationRate || 3.0;

  const capScore  = Math.min(100, Math.max(0, (capRate / 8.0) * 100));
  const expBurden = taxRate + insRate;
  const expScore  = Math.max(0, Math.min(100, 100 - ((expBurden - 0.5) / 3.5) * 100));
  const apprScore = Math.min(100, Math.max(0, ((apprRate - 2.0) / 3.0) * 100));
  const composite = capScore * 0.40 + landlord * 0.30 + expScore * 0.15 + apprScore * 0.15;

  let goalScore = composite;
  if (goal === 'cashflow')     goalScore = composite * 0.6 + capScore * 0.4;
  if (goal === 'appreciation') goalScore = composite * 0.5 + Math.min(100, apprRate / 5 * 100) * 0.5;

  return Math.round(goalScore);
}

// ── Deal card ─────────────────────────────────────────────────────────────────
function DealCard({ deal, onFlagSold }) {
  const [flagging, setFlagging] = useState(false);
  const [flagged,  setFlagged]  = useState(false);
  const cf = deal.cash_flow;
  const cfColor = cf >= 200 ? C.green : cf >= 0 ? C.amber : C.red;
  const cfLabel = cf >= 0 ? `+$${cf.toLocaleString()}/mo` : `-$${Math.abs(cf).toLocaleString()}/mo`;
  const srcColor = { zillow:'#006AFF', redfin:'#CC0000', realtor:'#D9232D' }[deal.source] || C.muted;
  const srcLabel = { zillow:'Zillow', redfin:'Redfin', realtor:'Realtor' }[deal.source] || deal.source;

  async function flag() {
    if (flagged || flagging) return;
    setFlagging(true);
    try {
      await fetch('/api/scout-deals/flag', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({ id:deal.id }) });
      setFlagged(true); onFlagSold?.(deal.id);
    } catch {}
    setFlagging(false);
  }

  return (
    <div style={{ background:C.white, border:`1px solid ${C.border}`, borderRadius:14, overflow:'hidden', opacity:flagged?0.4:1, transition:'opacity 0.3s' }}>
      <div style={{ padding:'15px 18px 12px' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:12, marginBottom:11 }}>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ display:'flex', gap:6, marginBottom:5, alignItems:'center', flexWrap:'wrap' }}>
              <span style={{ fontSize:10, fontWeight:700, color:srcColor, background:`${srcColor}15`, border:`1px solid ${srcColor}30`, borderRadius:6, padding:'2px 8px' }}>{srcLabel}</span>
              {deal.days_on_market !== null && <span style={{ fontSize:10.5, color:C.muted }}>{deal.days_on_market}d listed</span>}
            </div>
            <div style={{ fontFamily:"'Libre Baskerville',Georgia,serif", fontSize:15, fontWeight:700, color:C.text, lineHeight:1.25, marginBottom:3 }}>{deal.address}</div>
            <div style={{ fontSize:12, color:C.muted }}>{deal.beds}BR · {deal.baths}BA{deal.sqft ? ` · ${deal.sqft.toLocaleString()} sqft` : ''}</div>
          </div>
          <div style={{ textAlign:'right', flexShrink:0 }}>
            <div style={{ fontFamily:"'Libre Baskerville',Georgia,serif", fontSize:20, fontWeight:700, color:C.text }}>${deal.price.toLocaleString()}</div>
          </div>
        </div>
        <div style={{ display:'flex', gap:8, marginBottom:9 }}>
          <Stat label="Cap Rate"  value={`${deal.cap_rate}%`} color={deal.cap_rate>=7?C.green:deal.cap_rate>=5.5?C.amber:C.text}/>
          <Stat label="Cash Flow" value={cfLabel} color={cfColor}/>
          <Stat label="Est. Rent" value={`$${deal.estimated_rent?.toLocaleString()}/mo`} color={C.blue}/>
        </div>
        <p style={{ margin:0, fontSize:10, color:C.muted, lineHeight:1.5 }}>20% down · 7% rate · HUD FMR rent · estimates only</p>
      </div>
      <div style={{ padding:'10px 18px 13px', display:'flex', gap:8, borderTop:`1px solid ${C.border}` }}>
        <a href={deal.listing_url} target="_blank" rel="noopener noreferrer"
          style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', gap:6, background:C.green, color:'#fff', borderRadius:9, padding:'10px', textDecoration:'none', fontWeight:700, fontSize:12.5, fontFamily:"'DM Sans',system-ui,sans-serif" }}>
          View Listing <svg width="9" height="9" viewBox="0 0 10 10" fill="none"><path d="M2 8L8 2M8 2H4M8 2V6" stroke="white" strokeWidth="1.5" strokeLinecap="round"/></svg>
        </a>
        <Link href={`/analyze?url=${encodeURIComponent(deal.listing_url)}`}
          style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', background:C.white, color:C.green, border:`1.5px solid ${C.green}`, borderRadius:9, padding:'10px', textDecoration:'none', fontWeight:700, fontSize:12.5, fontFamily:"'DM Sans',system-ui,sans-serif" }}>
          Full Analysis →
        </Link>
        <button onClick={flag} disabled={flagging||flagged}
          style={{ padding:'10px 12px', border:`1px solid ${C.border}`, borderRadius:9, background:'none', cursor:flagged?'default':'pointer', color:flagged?C.green:C.muted, fontSize:11.5, fontFamily:"'DM Sans',system-ui,sans-serif" }}>
          {flagged?'✓':flagging?'…':'Sold?'}
        </button>
      </div>
    </div>
  );
}

// ── Market card ───────────────────────────────────────────────────────────────
function MarketCard({ market, rank, goal, session, guestStatus, fpRef, onGuestUsed }) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [dealState,   setDealState]   = useState('idle');
  const [deals,       setDeals]       = useState(null);
  const [dealErr,     setDealErr]     = useState(null);
  const [dealsOpen,   setDealsOpen]   = useState(true);
  const [flaggedIds,  setFlaggedIds]  = useState(new Set());

  const isAuthed  = !!session?.user?.id;
  const tokens    = session?.user?.tokens ?? 0;
  const canSearch = isAuthed ? tokens >= 1 : (guestStatus?.allowed !== false);

  const cf      = market.cashFlow;
  const cfColor = cf===null ? C.muted : cf>=200 ? C.green : cf>=0 ? C.amber : C.red;
  const cfLabel = cf===null ? 'N/A' : cf>=0 ? `+$${cf.toLocaleString()}/mo` : `-$${Math.abs(cf).toLocaleString()}/mo`;
  const rankColor = rank<=3 ? C.green : rank<=8 ? C.amber : C.muted;

  // Employment signals
  const hasEmp = market.unemploymentRate !== undefined && market.unemploymentRate !== null;
  const empVsNational = hasEmp && market.unemploymentNational
    ? market.unemploymentRate - market.unemploymentNational
    : null;
  const empColor  = !hasEmp ? C.muted : market.unemploymentTrend === 'improving' ? C.green : market.unemploymentTrend === 'worsening' ? C.red : C.muted;
  const empBg     = !hasEmp ? C.soft  : market.unemploymentTrend === 'improving' ? C.greenBg : market.unemploymentTrend === 'worsening' ? C.redBg : C.soft;
  const empBorder = !hasEmp ? C.border: market.unemploymentTrend === 'improving' ? C.greenBorder : market.unemploymentTrend === 'worsening' ? C.redBorder : C.border;

  // Rent growth signal
  const hasRent = market.rentGrowthPct !== undefined && market.rentGrowthPct !== null;
  const rentColor  = !hasRent ? C.muted : market.rentGrowthPct >= 4 ? C.green : market.rentGrowthPct >= 1 ? C.blue : market.rentGrowthPct < 0 ? C.red : C.muted;
  const rentBg     = !hasRent ? C.soft  : market.rentGrowthPct >= 4 ? C.greenBg : market.rentGrowthPct >= 1 ? C.blueBg : market.rentGrowthPct < 0 ? C.redBg : C.soft;
  const rentBorder = !hasRent ? C.border: market.rentGrowthPct >= 4 ? C.greenBorder : market.rentGrowthPct >= 1 ? C.blueBorder : market.rentGrowthPct < 0 ? C.redBorder : C.border;

  // Price trend (Case-Shiller YoY)
  const hasPriceYoY = market.priceYoY !== undefined && market.priceYoY !== null;

  // Redfin city: listing count + price reduction signals
  const hasListings     = market.listingCount !== undefined && market.listingCount !== null;
  const hasPriceDrops   = market.priceDropsPct !== undefined && market.priceDropsPct !== null;
  const isBuyerMarket   = market.marketBias === 'buyers' || market.marketBias === 'leaning_buyers';
  const priceDropColor  = !hasPriceDrops ? C.muted : market.priceDropsPct >= 25 ? C.green : market.priceDropsPct >= 15 ? C.blue : C.muted;
  const priceDropBg     = !hasPriceDrops ? C.soft  : market.priceDropsPct >= 25 ? C.greenBg : market.priceDropsPct >= 15 ? C.blueBg : C.soft;
  const priceDropBorder = !hasPriceDrops ? C.border: market.priceDropsPct >= 25 ? C.greenBorder : market.priceDropsPct >= 15 ? C.blueBorder : C.border;
  const tempMeta = {
    hot:     { label:"Hot market",  color:C.red,   bg:C.redBg,   border:C.redBorder },
    warm:    { label:"Warm market", color:C.amber, bg:C.amberBg, border:C.amberBorder },
    neutral: { label:"Balanced",    color:C.muted, bg:C.soft,    border:C.border },
    cool:    { label:"Cool market", color:C.blue,  bg:C.blueBg,  border:C.blueBorder },
    cold:    { label:"Cold market", color:C.blue,  bg:C.blueBg,  border:C.blueBorder },
  };
  const temp = tempMeta[market.marketTemp] || null;

  // Landlord
  const llScore  = market.landlordScore;
  const llColor  = llScore>=80 ? C.green  : llScore>=60 ? C.amber  : C.red;
  const llBg     = llScore>=80 ? C.greenBg : llScore>=60 ? C.amberBg : C.redBg;
  const llBorder = llScore>=80 ? C.greenBorder : llScore>=60 ? C.amberBorder : C.redBorder;
  const llLabel  = llScore>=80 ? 'Landlord Friendly' : llScore>=60 ? 'Moderate Laws' : 'Tenant Favorable';

  async function findDeals() {
    if (dealState === 'loading') return;
    if (!canSearch) { setDealState('gate'); return; }
    setDealState('loading'); setDealErr(null); setDeals(null);
    try {
      const r = await fetch(`/api/scout-deals?city=${encodeURIComponent(market.city)}&state=${market.state}&priceMax=400000&beds=3`);
      const d = await r.json();
      if (d.deals?.length > 0) { setDeals(d.deals); setDealState('done'); return; }
    } catch {}
    const body = { city:market.city, state:market.state, priceMax:400000, beds:3, propType:'sfr', goal };
    if (!isAuthed && fpRef.current) body.fp = fpRef.current;
    try {
      const res  = await fetch('/api/scout-deals', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) {
        if (data.code==='NO_TOKENS'||data.code==='GUEST_USED') { setDealState('gate'); return; }
        setDealErr(data.error||'Search failed.'); setDealState('error'); return;
      }
      setDeals(data.deals||[]); setDealState('done'); setDealsOpen(true);
      if (!isAuthed) onGuestUsed?.();
    } catch { setDealErr('Temporarily unavailable.'); setDealState('error'); }
  }

  const visibleDeals = (deals||[]).filter(d => !flaggedIds.has(d.id));

  return (
    <div style={{ background:C.white, border:`1px solid ${C.border}`, borderRadius:20, overflow:'hidden', boxShadow:'0 1px 3px rgba(0,0,0,0.04),0 4px 16px rgba(0,0,0,0.05)', animation:'fadeup 0.4s ease both' }}>

      {/* Header */}
      <div style={{ padding:'22px 24px 0' }}>
        <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:16, marginBottom:12 }}>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:6, flexWrap:'wrap' }}>
              <span style={{ fontSize:11, fontWeight:800, color:rankColor, background:`${rankColor}15`, border:`1px solid ${rankColor}40`, borderRadius:8, padding:'3px 10px', flexShrink:0 }}>#{rank}</span>
              <h2 style={{ margin:0, fontFamily:"'Libre Baskerville',Georgia,serif", fontSize:22, fontWeight:700, color:C.text, letterSpacing:'-0.02em', lineHeight:1 }}>
                {market.city}
              </h2>
              <span style={{ fontSize:14, fontWeight:500, color:C.muted }}>{market.state}</span>
              {market.capRateLive && <LiveDot title="Cap rate from live Census ACS + HUD data"/>}
            </div>
            <p style={{ margin:0, fontSize:13, color:C.muted, lineHeight:1.45 }}>{getMarketTagline(market)}</p>
          </div>
          <div style={{ textAlign:'center', flexShrink:0 }}>
            <div style={{ fontSize:34, fontWeight:800, color:C.green, lineHeight:1, fontFamily:"'Libre Baskerville',Georgia,serif" }}>{market.score}</div>
            <div style={{ fontSize:9.5, fontWeight:600, letterSpacing:'0.10em', textTransform:'uppercase', color:C.muted }}>Score</div>
          </div>
        </div>

        {/* Core stats row — listing count replaces appreciation when live data available */}
        <div style={{ display:'flex', gap:8, marginBottom:13 }}>
          <Stat label="Cap Rate" value={`${market.capRate}%`}
            color={market.capRate>=7?C.green:market.capRate>=5.5?C.amber:C.text}
            sub={market.capRateLive ? 'live data' : 'est.'}/>
          <Stat label="Est. Cash Flow" value={cfLabel} color={cfColor}/>
          {hasListings ? (
            <Stat label="Active Listings"
              value={market.listingCount >= 1000
                ? `${(market.listingCount/1000).toFixed(1)}k`
                : market.listingCount.toLocaleString()}
              color={market.listingCount >= 500 ? C.green : market.listingCount >= 100 ? C.blue : C.amber}
              sub={`Redfin${market.redfinAsOf ? ' · ' + market.redfinAsOf : ''}`}/>
          ) : (
            <Stat label="Appreciation" value={`${market.appreciationRate}%/yr`} color={C.blue}/>
          )}
        </div>

        {/* Live signal badges */}
        {(hasPriceDrops || temp || hasEmp || hasRent || hasPriceYoY) && (
          <div style={{ display:'flex', gap:6, flexWrap:'wrap', marginBottom:13 }}>
            {hasPriceDrops && (
              <SignalBadge
                icon={market.priceDropsPct >= 20 ? '✂' : ''}
                label={`${market.priceDropsPct?.toFixed(0)}% price cuts${isBuyerMarket ? " · buyer's mkt" : ''}`}
                color={priceDropColor} bg={priceDropBg} border={priceDropBorder}/>
            )}
            {temp && market.dom !== null && (
              <SignalBadge label={`${temp.label} · ${market.dom}d avg`}
                color={temp.color} bg={temp.bg} border={temp.border}/>
            )}
            {hasEmp && (
              <SignalBadge
                icon={market.unemploymentTrend==='improving'?'↓':market.unemploymentTrend==='worsening'?'↑':'→'}
                label={`Unemp ${market.unemploymentRate}%${empVsNational!==null ? ` (${empVsNational>0?'+':''}${empVsNational.toFixed(1)} vs natl)` : ''}`}
                color={empColor} bg={empBg} border={empBorder}/>
            )}
            {hasRent && (
              <SignalBadge
                icon={market.rentGrowthPct>=2?'↑':market.rentGrowthPct<0?'↓':'→'}
                label={`Rents ${market.rentGrowthPct>=0?'+':''}${market.rentGrowthPct?.toFixed(1)}%/yr`}
                color={rentColor} bg={rentBg} border={rentBorder}/>
            )}
            {hasPriceYoY && (
              <SignalBadge
                icon={market.priceTrend==='accelerating'?'↑↑':market.priceTrend==='decelerating'?'↓':'→'}
                label={`Prices ${market.priceYoY>=0?'+':''}${market.priceYoY?.toFixed(1)}% YoY`}
                color={market.priceYoY>=3?C.green:market.priceYoY>=0?C.blue:C.red}
                bg={market.priceYoY>=3?C.greenBg:market.priceYoY>=0?C.blueBg:C.redBg}
                border={market.priceYoY>=3?C.greenBorder:market.priceYoY>=0?C.blueBorder:C.redBorder}/>
            )}
          </div>
        )}

        {/* Landlord badge + region */}
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:16, gap:8, flexWrap:'wrap' }}>
          <span style={{ fontSize:11, fontWeight:700, color:llColor, background:llBg, border:`1px solid ${llBorder}`, borderRadius:100, padding:'4px 12px' }}>{llLabel} · {llScore}/100</span>
          <span style={{ fontSize:11.5, color:C.muted }}>{market.region}</span>
        </div>

        {/* Score bar */}
        <div style={{ height:3, background:C.soft, borderRadius:2, overflow:'hidden' }}>
          <div style={{ height:'100%', width:`${Math.min(100,market.score)}%`, background:C.green, borderRadius:2 }}/>
        </div>
      </div>

      {/* Browse links */}
      <div style={{ padding:'13px 24px', display:'flex', gap:8, borderTop:`1px solid ${C.border}`, marginTop:14 }}>
        {[
          { href:market.zillowUrl,  label:'Zillow',      bg:'#006AFF' },
          { href:market.redfinUrl,  label:'Redfin',      bg:'#CC0000' },
          { href:market.realtorUrl, label:'Realtor.com', bg:C.white, color:'#D9232D', border:'1.5px solid #D9232D' },
        ].map(btn => (
          <a key={btn.label} href={btn.href} target="_blank" rel="noopener noreferrer"
            style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', gap:5, background:btn.bg, color:btn.color||'#fff', border:btn.border||'none', borderRadius:9, padding:'9px 6px', textDecoration:'none', fontWeight:700, fontSize:12, fontFamily:"'DM Sans',system-ui,sans-serif" }}>
            {btn.label}
            <svg width="8" height="8" viewBox="0 0 10 10" fill="none"><path d="M2 8L8 2M8 2H4M8 2V6" stroke={btn.color||'white'} strokeWidth="1.5" strokeLinecap="round"/></svg>
          </a>
        ))}
      </div>

      {/* Find Deals */}
      <div style={{ padding:'0 24px 22px', borderTop:`1px solid ${C.border}` }}>
        {dealState==='idle' && (
          <button onClick={findDeals}
            style={{ marginTop:14, width:'100%', padding:'13px', border:`1.5px solid ${canSearch?C.green:C.border}`, borderRadius:12, background:canSearch?C.greenBg:C.soft, color:canSearch?C.green:C.muted, fontFamily:"'DM Sans',system-ui,sans-serif", fontSize:14, fontWeight:700, cursor:canSearch?'pointer':'default', display:'flex', alignItems:'center', justifyContent:'center', gap:8, transition:'all 0.15s' }}>
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" strokeWidth="1.6"/><path d="M10 10l3.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>
            Find deals here{!isAuthed&&canSearch?' · free':isAuthed?' · 1 token':''}
          </button>
        )}
        {dealState==='loading' && (
          <div style={{ marginTop:14, display:'flex', alignItems:'center', justifyContent:'center', gap:10, padding:'16px', color:C.muted, fontSize:13 }}>
            <div style={{ width:15, height:15, border:`2px solid ${C.border}`, borderTopColor:C.green, borderRadius:'50%', animation:'spin 0.7s linear infinite', flexShrink:0 }}/>
            Searching for active listings…
          </div>
        )}
        {dealState==='error' && (
          <div style={{ marginTop:14 }}>
            <div style={{ fontSize:12.5, color:C.red, padding:'10px 14px', background:C.redBg, border:`1px solid ${C.redBorder}`, borderRadius:10, marginBottom:8 }}>{dealErr}</div>
            <button onClick={()=>setDealState('idle')} style={{ fontSize:12, color:C.muted, background:'none', border:'none', cursor:'pointer', textDecoration:'underline' }}>Try again</button>
          </div>
        )}
        {dealState==='gate' && (
          <div style={{ marginTop:14, background:C.amberBg, border:`1px solid ${C.amberBorder}`, borderRadius:12, padding:'16px 18px' }}>
            <div style={{ fontWeight:700, fontSize:13.5, color:C.amber, marginBottom:5 }}>{isAuthed?'Out of tokens':'Free search used'}</div>
            <p style={{ fontSize:12.5, color:'#5a3d00', marginBottom:14, lineHeight:1.6 }}>
              {isAuthed?'Buy more tokens to search additional markets.':'Sign up free for 2 tokens — 1 Scout search + 1 full analysis.'}
            </p>
            <Link href={isAuthed?'/dashboard':'/auth'}
              style={{ display:'inline-block', padding:'9px 20px', borderRadius:9, background:C.green, color:'#fff', textDecoration:'none', fontWeight:700, fontSize:13, fontFamily:"'DM Sans',system-ui,sans-serif" }}>
              {isAuthed?'Buy tokens →':'Sign up free →'}
            </Link>
          </div>
        )}
        {dealState==='done' && (
          <div style={{ marginTop:14 }}>
            <button onClick={()=>setDealsOpen(o=>!o)}
              style={{ width:'100%', display:'flex', alignItems:'center', justifyContent:'space-between', padding:'0 0 12px', background:'none', border:'none', borderBottom:`1px solid ${C.border}`, cursor:'pointer', fontFamily:"'DM Sans',system-ui,sans-serif", fontSize:13, fontWeight:700, color:visibleDeals.length>0?C.green:C.muted, marginBottom:12 }}>
              <span>{visibleDeals.length>0?`${visibleDeals.length} listing${visibleDeals.length!==1?'s':''} found`:'No listings found right now'}</span>
              <svg width="13" height="13" viewBox="0 0 14 14" fill="none" style={{ transform:dealsOpen?'rotate(180deg)':'none', transition:'transform 0.2s' }}>
                <path d="M3 5l4 4 4-4" stroke={C.green} strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </button>
            {dealsOpen && (
              visibleDeals.length===0 ? (
                <p style={{ margin:0, fontSize:13, color:C.muted, textAlign:'center', padding:'12px 0', lineHeight:1.6 }}>
                  No verified listings matched. Try Zillow/Redfin above.
                </p>
              ) : (
                <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
                  {visibleDeals.map(deal => (
                    <DealCard key={deal.id||deal.listing_url} deal={deal} onFlagSold={id=>setFlaggedIds(prev=>new Set([...prev,id]))}/>
                  ))}
                  <p style={{ margin:0, fontSize:10.5, color:C.muted, textAlign:'center', lineHeight:1.5 }}>
                    Valid up to 30 days · Prices may have changed · Always verify before acting
                  </p>
                </div>
              )
            )}
          </div>
        )}
      </div>

      {/* Market details collapsible */}
      <div style={{ borderTop:`1px solid ${C.border}` }}>
        <button onClick={()=>setDetailsOpen(o=>!o)}
          style={{ width:'100%', padding:'11px 24px', background:'none', border:'none', cursor:'pointer', fontFamily:"'DM Sans',system-ui,sans-serif", fontSize:12, fontWeight:600, color:C.muted, display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          Market details
          <svg width="12" height="12" viewBox="0 0 14 14" fill="none" style={{ transform:detailsOpen?'rotate(180deg)':'none', transition:'transform 0.2s' }}>
            <path d="M3 5l4 4 4-4" stroke={C.muted} strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </button>
        {detailsOpen && (
          <div style={{ padding:'0 24px 18px' }}>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'8px 24px', marginBottom:12 }}>
              {[
                { l:'Median Price',    v:market.medianPrice?`$${market.medianPrice.toLocaleString()}`:'N/A' },
                { l:'HUD 2BR Rent',    v:market.rent2br?`$${market.rent2br.toLocaleString()}/mo`:'N/A' },
                { l:'Property Tax',    v:`${market.taxRate}%/yr` },
                { l:'Insurance',       v:`${market.insRate}%/yr` },
                { l:'Multi-fam Cap',  v:market.capRateMfr?`${market.capRateMfr}%`:'N/A' },
                { l:'Cap Rate Source', v:market.capSource || 'CBRE/JLL' },
              ].map((row,i) => (
                <div key={i} style={{ display:'flex', justifyContent:'space-between', gap:8, fontSize:12, borderBottom:`1px solid ${C.border}`, paddingBottom:7 }}>
                  <span style={{ color:C.muted }}>{row.l}</span>
                  <span style={{ fontWeight:600, color:C.text, textAlign:'right' }}>{row.v}</span>
                </div>
              ))}
            </div>
            {/* Redfin city market data */}
            {(market.listingCount !== null && market.listingCount !== undefined) && (
              <div style={{ borderTop:`1px solid ${C.border}`, paddingTop:10, marginTop:4 }}>
                <div style={{ fontSize:10, fontWeight:700, color:C.muted, letterSpacing:'0.08em', textTransform:'uppercase', marginBottom:7 }}>Live market activity · Redfin{market.redfinAsOf ? ` (${market.redfinAsOf})` : ''}</div>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'6px 24px' }}>
                  {market.listingCount !== null && (
                    <div style={{ display:'flex', justifyContent:'space-between', gap:8, fontSize:12, borderBottom:`1px solid ${C.border}`, paddingBottom:6 }}>
                      <span style={{ color:C.muted }}>Active listings</span>
                      <span style={{ fontWeight:700, color:C.green }}>{market.listingCount.toLocaleString()}</span>
                    </div>
                  )}
                  {market.newListings !== null && market.newListings !== undefined && (
                    <div style={{ display:'flex', justifyContent:'space-between', gap:8, fontSize:12, borderBottom:`1px solid ${C.border}`, paddingBottom:6 }}>
                      <span style={{ color:C.muted }}>New this week</span>
                      <span style={{ fontWeight:600, color:C.text }}>{market.newListings.toLocaleString()}</span>
                    </div>
                  )}
                  {market.priceDropsPct !== null && market.priceDropsPct !== undefined && (
                    <div style={{ display:'flex', justifyContent:'space-between', gap:8, fontSize:12, borderBottom:`1px solid ${C.border}`, paddingBottom:6 }}>
                      <span style={{ color:C.muted }}>Price cuts</span>
                      <span style={{ fontWeight:700, color:market.priceDropsPct>=20?C.green:C.text }}>{market.priceDropsPct?.toFixed(0)}% of listings</span>
                    </div>
                  )}
                  {market.dom !== null && market.dom !== undefined && (
                    <div style={{ display:'flex', justifyContent:'space-between', gap:8, fontSize:12, borderBottom:`1px solid ${C.border}`, paddingBottom:6 }}>
                      <span style={{ color:C.muted }}>Median DOM</span>
                      <span style={{ fontWeight:600, color:C.text }}>{market.dom} days</span>
                    </div>
                  )}
                  {market.saleToList !== null && market.saleToList !== undefined && (
                    <div style={{ display:'flex', justifyContent:'space-between', gap:8, fontSize:12, borderBottom:`1px solid ${C.border}`, paddingBottom:6 }}>
                      <span style={{ color:C.muted }}>Sale-to-list</span>
                      <span style={{ fontWeight:600, color:market.saleToList>=1?C.red:C.green }}>{(market.saleToList*100).toFixed(1)}%</span>
                    </div>
                  )}
                  {market.medianListPrice !== null && market.medianListPrice !== undefined && (
                    <div style={{ display:'flex', justifyContent:'space-between', gap:8, fontSize:12, borderBottom:`1px solid ${C.border}`, paddingBottom:6 }}>
                      <span style={{ color:C.muted }}>Median ask price</span>
                      <span style={{ fontWeight:600, color:C.text }}>${market.medianListPrice.toLocaleString()}</span>
                    </div>
                  )}
                </div>
              </div>
            )}
            {/* Live data freshness */}
            {(market.employmentAsOf || market.rentGrowthAsOf || market.csAsOf) && (
              <div style={{ borderTop:`1px solid ${C.border}`, paddingTop:10, marginTop:4 }}>
                <div style={{ fontSize:10, fontWeight:700, color:C.muted, letterSpacing:'0.08em', textTransform:'uppercase', marginBottom:6 }}>Other data freshness</div>
                {market.employmentAsOf && <div style={{ fontSize:11, color:C.muted, marginBottom:3 }}>Employment (BLS): {market.employmentAsOf}</div>}
                {market.rentGrowthAsOf && <div style={{ fontSize:11, color:C.muted, marginBottom:3 }}>Rent growth (ZORI): {market.rentGrowthAsOf}</div>}
                {market.csAsOf        && <div style={{ fontSize:11, color:C.muted, marginBottom:3 }}>Home prices (Case-Shiller): {market.csAsOf}</div>}
                {market.priceCagr3yr  && <div style={{ fontSize:11, color:C.muted }}>3yr price CAGR: +{market.priceCagr3yr}%/yr</div>}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function Scout() {
  const { data: session } = useSession();
  const isAuthed = !!session?.user?.id;
  const tokens   = session?.user?.tokens ?? 0;

  const [goal,        setGoal]        = useState('cashflow');
  const [guestStatus, setGuestStatus] = useState(null);
  const [liveData,    setLiveData]    = useState(null);   // { markets: {...}, asOf, coverage }
  const [liveLoading, setLiveLoading] = useState(true);
  const fpRef = useRef(null);

  // Fetch live market signals once on mount
  useEffect(() => {
    fetch('/api/scout-markets')
      .then(r => r.ok ? r.json() : null)
      .then(d => { setLiveData(d || null); setLiveLoading(false); })
      .catch(() => setLiveLoading(false));
  }, []);

  // Guest usage check
  useEffect(() => {
    if (isAuthed) return;
    const fp = getDeviceFingerprint();
    fpRef.current = fp;
    fetch(`/api/guest-usage?action=check&type=scout&fp=${fp}`)
      .then(r => r.json()).then(d => setGuestStatus(d)).catch(() => setGuestStatus({ allowed:true }));
  }, [isAuthed]);

  // Compute enriched, ranked markets — re-runs when goal or liveData changes
  const markets = useMemo(() => {
    const staticFilters = { goal, priceMax:400000, beds:3, region:'all', minCapRate:0, minLandlord:0, propType:'sfr' };
    const staticMarkets = getRankedMarkets(staticFilters);
    const signals = liveData?.markets || {};

    if (Object.keys(signals).length === 0) return staticMarkets;

    // Merge live signals in, re-score if cap rate changed, re-sort
    const enriched = staticMarkets.map(m => {
      const live   = signals[m.key];
      const merged = mergeSignals(m, live);
      // Re-score with live cap rate so ranking is accurate
      if (live?.capRate && live.capRate !== m.capRate) {
        merged.score = reScore(merged, goal);
      }
      return merged;
    });

    enriched.sort((a, b) => b.score - a.score);
    return enriched;
  }, [goal, liveData]);

  // Count how many markets have live signals
  const liveCount = liveData ? Object.keys(liveData.markets || {}).length : 0;
  const hasLive   = liveCount > 0;

  const GOALS = [
    { v:'cashflow',     icon:'↑', l:'Max Cash Flow',  sub:'Best cap rates & monthly returns' },
    { v:'appreciation', icon:'◆', l:'Appreciation',   sub:'Strong long-term equity growth'   },
    { v:'balanced',     icon:'⊙', l:'Balanced',       sub:'Cash flow and growth together'    },
  ];

  return (
    <>
      <Head>
        <title>RentalIQ Scout — Best Rental Markets & Deals</title>
        <meta name="description" content="Discover the best US rental investment markets. Real listings surfaced by AI, ranked by cap rate, cash flow, and landlord laws."/>
        <meta name="viewport" content="width=device-width, initial-scale=1"/>
        <meta property="og:title"       content="RentalIQ Scout — Best Rental Markets Right Now"/>
        <meta property="og:description" content="Markets ranked by cap rate, cash flow, and landlord laws. Live employment, rent growth, and listing data. Hit Find Deals to surface real active listings."/>
        <meta property="og:image"       content={`${APP_URL}/og-image.png`}/>
        <meta property="og:url"         content={`${APP_URL}/scout`}/>
        <meta property="og:type"        content="website"/>
        <meta name="twitter:card"       content="summary_large_image"/>
        <meta name="twitter:title"      content="RentalIQ Scout — Best Rental Markets Right Now"/>
        <meta name="twitter:description" content="Markets ranked by cap rate, cash flow, and landlord laws. Live data. Real active listings."/>
        <meta name="twitter:image"      content={`${APP_URL}/og-image.png`}/>
      </Head>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700;9..40,800&display=swap');
        @keyframes fadeup { from{opacity:0;transform:translateY(16px)} to{opacity:1;transform:translateY(0)} }
        @keyframes spin   { to{transform:rotate(360deg)} }
        @keyframes pulse  { 0%,100%{opacity:1} 50%{opacity:0.4} }
        *, *::before, *::after { box-sizing:border-box; margin:0; padding:0; }
        body { background:#f7f7f9; }
        .lift { transition:transform 0.2s ease,box-shadow 0.2s ease; }
        .lift:hover { transform:translateY(-2px); box-shadow:0 8px 32px rgba(0,0,0,0.09) !important; }
        @media (max-width:600px) { .goal-grid { flex-direction:column !important; } }
        @media (prefers-reduced-motion:reduce) { *,*::before,*::after { animation:none !important; transition:none !important; } }
      `}</style>

      <div style={{ background:C.bg, minHeight:'100vh', fontFamily:"'DM Sans',system-ui,sans-serif" }}>

        {/* Nav */}
        <nav style={{ position:'sticky', top:0, zIndex:100, background:'rgba(247,247,249,0.9)', backdropFilter:'blur(14px)', WebkitBackdropFilter:'blur(14px)', borderBottom:`1px solid ${C.border}` }}>
          <div style={{ maxWidth:760, margin:'0 auto', padding:'0 24px', display:'flex', alignItems:'center', justifyContent:'space-between', height:54 }}>
            <Link href="/" style={{ fontFamily:"'Libre Baskerville',Georgia,serif", fontSize:17, fontWeight:700, color:C.text, textDecoration:'none', letterSpacing:'-0.02em' }}>RentalIQ</Link>
            <div style={{ display:'flex', alignItems:'center', gap:8 }}>
              <div style={{ display:'inline-flex', background:C.soft, borderRadius:10, padding:3, gap:2 }}>
                <Link href="/analyze" style={{ padding:'5px 14px', borderRadius:8, fontSize:13, fontWeight:500, color:C.muted, textDecoration:'none' }}>Analyze</Link>
                <span style={{ padding:'5px 14px', borderRadius:8, background:C.white, fontSize:13, fontWeight:700, color:C.text, boxShadow:'0 1px 2px rgba(0,0,0,0.06)' }}>Scout</span>
              </div>
              {isAuthed ? (
                <>
                  <Link href="/dashboard" style={{ fontSize:12.5, color:C.muted, textDecoration:'none', padding:'5px 12px', border:`1px solid ${C.border}`, borderRadius:8 }}>My Deals</Link>
                  <span style={{ fontSize:12.5, fontWeight:700, color:tokens<=0?C.red:tokens<=2?C.amber:C.green, padding:'5px 12px', border:`1px solid ${tokens<=0?C.redBorder:tokens<=2?C.amberBorder:C.greenBorder}`, borderRadius:8, background:C.white }}>
                    {tokens} token{tokens!==1?'s':''}
                  </span>
                </>
              ) : (
                <Link href="/auth" style={{ padding:'7px 18px', borderRadius:9, fontSize:13, fontWeight:700, color:'#fff', background:C.green, textDecoration:'none' }}>Sign In</Link>
              )}
            </div>
          </div>
        </nav>

        {/* Hero */}
        <header style={{ padding:'60px 24px 52px', textAlign:'center', background:`radial-gradient(ellipse 800px 360px at 50% 0%, rgba(22,102,56,0.08) 0%, transparent 65%)`, borderBottom:`1px solid ${C.border}` }}>
          <div style={{ maxWidth:600, margin:'0 auto' }}>

            {/* Live status pill */}
            <div style={{ display:'inline-flex', alignItems:'center', gap:7, marginBottom:22, padding:'5px 14px', background:C.white, border:`1px solid ${C.border}`, borderRadius:100, boxShadow:'0 1px 3px rgba(0,0,0,0.05)' }}>
              {liveLoading ? (
                <>
                  <div style={{ width:6, height:6, background:C.border, borderRadius:'50%', animation:'pulse 1.2s ease infinite' }}/>
                  <span style={{ fontSize:10.5, fontWeight:700, letterSpacing:'0.12em', color:C.muted, textTransform:'uppercase' }}>Loading live data…</span>
                </>
              ) : hasLive ? (
                <>
                  <div style={{ width:6, height:6, background:C.green, borderRadius:'50%', boxShadow:`0 0 0 2px rgba(22,102,56,0.2)` }}/>
                  <span style={{ fontSize:10.5, fontWeight:700, letterSpacing:'0.12em', color:C.muted, textTransform:'uppercase' }}>
                    Live data · {liveCount} markets updated
                  </span>
                </>
              ) : (
                <>
                  <div style={{ width:6, height:6, background:C.amber, borderRadius:'50%' }}/>
                  <span style={{ fontSize:10.5, fontWeight:700, letterSpacing:'0.12em', color:C.muted, textTransform:'uppercase' }}>Ranked · Scored · Deal Discovery</span>
                </>
              )}
            </div>

            <h1 style={{ fontFamily:"'Libre Baskerville',Georgia,serif", fontSize:'clamp(30px,5vw,52px)', fontWeight:700, letterSpacing:'-0.03em', lineHeight:1.08, color:C.text, marginBottom:18 }}>
              Where are the{' '}
              <em style={{ fontStyle:'italic', color:C.green, fontWeight:400 }}>best rental deals</em>{' '}
              right now?
            </h1>

            <p style={{ fontSize:16, color:C.muted, lineHeight:1.7, marginBottom:38, maxWidth:460, margin:'0 auto 38px' }}>
              Markets ranked by cap rate, cash flow, and landlord laws. Rankings update from live Census, BLS, and Zillow data.
            </p>

            {/* Goal selector */}
            <p style={{ fontSize:10.5, fontWeight:700, letterSpacing:'0.12em', textTransform:'uppercase', color:C.muted, marginBottom:14 }}>What's your goal?</p>
            <div className="goal-grid" style={{ display:'flex', gap:10, justifyContent:'center' }}>
              {GOALS.map(g => {
                const active = goal === g.v;
                return (
                  <button key={g.v} onClick={()=>setGoal(g.v)}
                    style={{ flex:'1 1 0', maxWidth:200, padding:'16px 14px', borderRadius:14, border:`2px solid ${active?C.green:C.border}`, background:active?C.greenBg:C.white, cursor:'pointer', fontFamily:"'DM Sans',system-ui,sans-serif", textAlign:'center', transition:'all 0.17s', boxShadow:active?'0 0 0 3px rgba(22,102,56,0.10)':'none' }}>
                    <div style={{ fontSize:18, marginBottom:7, color:active?C.green:C.muted }}>{g.icon}</div>
                    <div style={{ fontSize:13.5, fontWeight:active?700:600, color:active?C.green:C.text, marginBottom:4 }}>{g.l}</div>
                    <div style={{ fontSize:11, color:C.muted, lineHeight:1.4 }}>{g.sub}</div>
                  </button>
                );
              })}
            </div>
          </div>
        </header>

        {/* Market list */}
        <main style={{ maxWidth:760, margin:'0 auto', padding:'32px 24px 80px' }}>

          {/* Disclaimer */}
          <div style={{ display:'flex', alignItems:'flex-start', gap:10, padding:'12px 16px', background:C.amberBg, border:`1px solid ${C.amberBorder}`, borderRadius:12, marginBottom:16 }}>
            <svg width="14" height="14" viewBox="0 0 15 15" fill="none" style={{ flexShrink:0, marginTop:1 }}>
              <path d="M7.5 1.5L13.5 13H1.5L7.5 1.5Z" stroke={C.amber} strokeWidth="1.4" fill="none"/>
              <path d="M7.5 6v3M7.5 10.5v.5" stroke={C.amber} strokeWidth="1.4" strokeLinecap="round"/>
            </svg>
            <p style={{ fontSize:12, color:C.amber, lineHeight:1.6, margin:0 }}>
              <strong>Investor estimates.</strong> Cash flow uses 20% down, 7% rate, market-average expenses. Cap rates from live Census ACS + HUD SAFMR where available, otherwise CBRE/JLL. Always analyze specific listings before investing.
            </p>
          </div>

          {/* Live data coverage bar */}
          {hasLive && liveData?.coverage && (
            <div style={{ display:'flex', gap:12, padding:'10px 16px', background:C.greenBg, border:`1px solid ${C.greenBorder}`, borderRadius:12, marginBottom:20, flexWrap:'wrap', alignItems:'center' }}>
              <div style={{ display:'flex', alignItems:'center', gap:5 }}>
                <div style={{ width:5, height:5, background:C.green, borderRadius:'50%' }}/>
                <span style={{ fontSize:11, fontWeight:700, color:C.green }}>Live data active</span>
              </div>
              {liveData.coverage.capRates > 0    && <span style={{ fontSize:11, color:'#3a6e50' }}>Cap rates: {liveData.coverage.capRates} markets</span>}
              {liveData.coverage.employment > 0  && <span style={{ fontSize:11, color:'#3a6e50' }}>Employment: {liveData.coverage.employment} markets</span>}
              {liveData.coverage.zori > 0        && <span style={{ fontSize:11, color:'#3a6e50' }}>Rent growth: {liveData.coverage.zori} markets</span>}
              {liveData.coverage.caseShiller > 0 && <span style={{ fontSize:11, color:'#3a6e50' }}>Home prices: {liveData.coverage.caseShiller} metros</span>}
              {liveData.coverage.redfinCity > 0   && <span style={{ fontSize:11, color:'#3a6e50' }}>Listing counts: {liveData.coverage.redfinCity} markets</span>}
            </div>
          )}

          {/* Cards */}
          <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
            {markets.map((m, i) => (
              <div key={m.key} className="lift">
                <MarketCard market={m} rank={i+1} goal={goal} session={session} guestStatus={guestStatus} fpRef={fpRef}
                  onGuestUsed={()=>setGuestStatus(prev=>({...prev,allowed:false,usedScout:true}))}/>
              </div>
            ))}
          </div>

          {/* Bottom CTA */}
          <div style={{ marginTop:32, padding:'28px', background:C.greenBg, border:`1.5px solid ${C.greenBorder}`, borderRadius:20, textAlign:'center' }}>
            <h3 style={{ fontFamily:"'Libre Baskerville',Georgia,serif", fontSize:20, fontWeight:700, color:C.text, marginBottom:10 }}>Found a listing you like?</h3>
            <p style={{ fontSize:14, color:'#3a6e50', marginBottom:20, lineHeight:1.65 }}>Paste any Zillow or Redfin URL for a full cap rate, cash flow, IRR, and buy/pass verdict.</p>
            <Link href="/analyze" style={{ display:'inline-block', background:C.green, color:'#fff', borderRadius:11, padding:'13px 32px', fontSize:14.5, fontWeight:700, textDecoration:'none', boxShadow:'0 4px 18px rgba(22,102,56,0.3)' }}>
              Analyze a listing →
            </Link>
          </div>

          {/* Data sources */}
          <p style={{ marginTop:20, fontSize:11, color:C.muted, textAlign:'center', lineHeight:1.7 }}>
            Cap rates: Census ACS + HUD SAFMR · Employment: BLS LAUS/FRED · Rent: Zillow ZORI · Prices: S&P/Case-Shiller · Listings & price cuts: Redfin city tracker (weekly) · Landlord scores: Eviction Lab + NCSL · Deals: Gemini AI + Google Search
          </p>
        </main>

        <footer style={{ textAlign:'center', padding:'16px 0 28px', fontSize:12, color:C.muted, borderTop:`1px solid ${C.border}` }}>
          RentalIQ Scout · Not financial advice
        </footer>
      </div>
    </>
  );
}
