/**
 * pages/scout.js — RentalIQ Scout (Phase 1 + Phase 2)
 *
 * Phase 1: Ranked market intelligence cards — loads immediately, no AI needed.
 * Phase 2: AI deal discovery — 1 token per search. Guests get 1 free search.
 *          Real listings from Zillow/Redfin/Realtor.com discovered via Gemini
 *          search grounding, scored by the RentalIQ engine, cached 30 days.
 *
 * Token gate:
 *   - Signed-in users: 1 token per live AI search (same pool as Analyze)
 *   - New users: 2 tokens on signup (1 analyze + 1 scout)
 *   - Guests: 1 free AI search per device (fingerprint anti-abuse)
 *
 * Design: premium-minimalist. Libre Baskerville headings. No emojis.
 */

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useSession }       from 'next-auth/react';
import Head                 from 'next/head';
import Link                 from 'next/link';
import { getRankedMarkets, getMarketTagline } from '../lib/scoutMarkets.js';
import { getDeviceFingerprint }               from '../lib/fingerprint.js';

// ─── Design tokens ────────────────────────────────────────────────────────────
const C = {
  bg:'#f5f5f8', white:'#ffffff', border:'#dddde4', text:'#0d0d0f', muted:'#72727a', soft:'#eaeaef',
  green:'#166638', greenBg:'#ecf6f1', greenBorder:'#96ccb0',
  red:'#a62626', redBg:'#fdf0f0', redBorder:'#e0aaaa',
  amber:'#8a5800', amberBg:'#fdf4e8', amberBorder:'#dfc070',
  blue:'#1649a0', blueBg:'#edf1fc', blueBorder:'#a0beed',
  shadow:'0 1px 2px rgba(0,0,0,0.05), 0 2px 12px rgba(0,0,0,0.06)',
  shadowSm:'0 1px 2px rgba(0,0,0,0.04)',
};

// ─── Shared micro-components ──────────────────────────────────────────────────
function Pill({ label, value, color = C.text, bg = C.soft, border = C.border }) {
  return (
    <div style={{ background: bg, border: `1px solid ${border}`, borderRadius: 10, padding: '8px 12px' }}>
      <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.10em', textTransform: 'uppercase', color: C.muted, marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 700, color, fontFamily: "'Libre Baskerville',Georgia,serif", lineHeight: 1 }}>{value}</div>
    </div>
  );
}

function ScoreBar({ value }) {
  return (
    <div style={{ height: 4, background: C.soft, borderRadius: 2, overflow: 'hidden' }}>
      <div style={{ height: '100%', width: `${Math.min(100, value)}%`, background: C.green, borderRadius: 2, transition: 'width 0.5s ease' }}/>
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

// ─── Confidence badge ─────────────────────────────────────────────────────────
function ConfidenceBadge({ deal }) {
  const conf    = deal.confidence || 'medium';
  const status  = deal.status || 'unverified';
  const daysAgo = deal.first_seen
    ? Math.round((Date.now() - new Date(deal.first_seen).getTime()) / 86400000)
    : null;
  const lastVer = deal.last_verified
    ? Math.round((Date.now() - new Date(deal.last_verified).getTime()) / 86400000)
    : null;

  if (status === 'active' && lastVer !== null && lastVer <= 7) {
    return (
      <span style={{ fontSize: 10, fontWeight: 700, color: C.green, background: C.greenBg, border: `1px solid ${C.greenBorder}`, borderRadius: 6, padding: '2px 8px', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <svg width="8" height="8" viewBox="0 0 8 8" fill="none"><circle cx="4" cy="4" r="3" fill={C.green}/></svg>
        Verified active · {lastVer === 0 ? 'today' : `${lastVer}d ago`}
      </span>
    );
  }
  if (conf === 'high') return (
    <span style={{ fontSize: 10, fontWeight: 700, color: C.green, background: C.greenBg, border: `1px solid ${C.greenBorder}`, borderRadius: 6, padding: '2px 8px' }}>
      High confidence
    </span>
  );
  if (conf === 'medium') return (
    <span style={{ fontSize: 10, fontWeight: 700, color: C.amber, background: C.amberBg, border: `1px solid ${C.amberBorder}`, borderRadius: 6, padding: '2px 8px' }}>
      Medium confidence
    </span>
  );
  return (
    <span style={{ fontSize: 10, fontWeight: 700, color: C.muted, background: C.soft, border: `1px solid ${C.border}`, borderRadius: 6, padding: '2px 8px' }}>
      Verify before acting
    </span>
  );
}

// ─── Source badge ─────────────────────────────────────────────────────────────
function SourceBadge({ source }) {
  const map = {
    zillow:  { color: '#006AFF', label: 'Zillow' },
    redfin:  { color: '#CC0000', label: 'Redfin' },
    realtor: { color: '#D9232D', label: 'Realtor' },
  };
  const s = map[source] || map.zillow;
  return (
    <span style={{ fontSize: 10, fontWeight: 700, color: s.color, background: `${s.color}12`, border: `1px solid ${s.color}30`, borderRadius: 6, padding: '2px 8px' }}>
      {s.label}
    </span>
  );
}

// ─── Real deal card (Phase 2) ─────────────────────────────────────────────────
function DealCard({ deal, onFlagSold }) {
  const [flagging, setFlagging] = useState(false);
  const [flagged,  setFlagged]  = useState(false);

  const cf      = deal.cash_flow;
  const cfColor = cf >= 200 ? C.green : cf >= 0 ? C.amber : C.red;
  const cfLabel = cf >= 0 ? `+$${cf.toLocaleString()}/mo` : `-$${Math.abs(cf).toLocaleString()}/mo`;
  const daysAgo = deal.first_seen ? Math.round((Date.now() - new Date(deal.first_seen).getTime()) / 86400000) : null;

  async function handleFlagSold() {
    if (flagged || flagging) return;
    setFlagging(true);
    try {
      await fetch('/api/scout-deals/flag', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: deal.id }),
      });
      setFlagged(true);
      onFlagSold?.(deal.id);
    } catch {}
    setFlagging(false);
  }

  return (
    <div className="riq-lift" style={{
      background: C.white, border: `1px solid ${C.border}`, borderRadius: 16,
      overflow: 'hidden', animation: 'riq-fadeup 0.4s ease both',
      opacity: flagged ? 0.4 : 1, transition: 'opacity 0.3s ease',
    }}>
      {/* Header */}
      <div style={{ padding: '18px 20px 0' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5, flexWrap: 'wrap' }}>
              <SourceBadge source={deal.source}/>
              <ConfidenceBadge deal={deal}/>
              {daysAgo !== null && (
                <span style={{ fontSize: 10.5, color: daysAgo <= 3 ? C.green : daysAgo <= 14 ? C.amber : C.muted, fontWeight: 600 }}>
                  Found {daysAgo === 0 ? 'today' : `${daysAgo}d ago`}
                </span>
              )}
              {deal.days_on_market !== null && (
                <span style={{ fontSize: 10.5, color: C.muted }}>· {deal.days_on_market} days listed</span>
              )}
            </div>
            <div style={{ fontFamily: "'Libre Baskerville',Georgia,serif", fontSize: 17, fontWeight: 700, color: C.text, lineHeight: 1.2, marginBottom: 3 }}>
              {deal.address}
            </div>
            <div style={{ fontSize: 13, color: C.muted }}>{deal.city}, {deal.state}</div>
          </div>
          <div style={{ flexShrink: 0, textAlign: 'right' }}>
            <div style={{ fontFamily: "'Libre Baskerville',Georgia,serif", fontSize: 22, fontWeight: 700, color: C.text, lineHeight: 1 }}>
              ${deal.price.toLocaleString()}
            </div>
            <div style={{ fontSize: 10.5, color: C.muted, marginTop: 2 }}>{deal.beds}BR · {deal.baths}BA{deal.sqft ? ` · ${deal.sqft.toLocaleString()} sqft` : ''}</div>
          </div>
        </div>

        {/* Metrics */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginBottom: 14 }}>
          <Pill label="Cap Rate" value={`${deal.cap_rate}%`} color={deal.cap_rate >= 7 ? C.green : deal.cap_rate >= 5.5 ? C.amber : C.text}/>
          <Pill label="Est. Cash Flow" value={cfLabel} color={cfColor}/>
          <Pill label="Est. Rent" value={`$${deal.estimated_rent?.toLocaleString()}/mo`} color={C.blue}/>
        </div>

        {/* Caveat */}
        <div style={{ fontSize: 10.5, color: C.muted, marginBottom: 14, lineHeight: 1.4 }}>
          Estimates: 20% down · 7% rate · HUD FMR rent · 8% vacancy · 10% mgmt. Verify with full analysis.
        </div>
      </div>

      {/* Actions */}
      <div style={{ padding: '12px 20px 16px', display: 'flex', gap: 8, flexWrap: 'wrap', borderTop: `1px solid ${C.border}` }}>
        <a href={deal.listing_url} target="_blank" rel="noopener noreferrer"
          style={{ flex: '1 1 auto', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            background: C.green, color: '#fff', borderRadius: 10, padding: '10px 14px',
            textDecoration: 'none', fontWeight: 700, fontSize: 13,
            fontFamily: "'DM Sans',system-ui,sans-serif",
            boxShadow: '0 2px 8px rgba(22,102,56,0.25)' }}>
          View Listing
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 8L8 2M8 2H4M8 2V6" stroke="white" strokeWidth="1.5" strokeLinecap="round"/></svg>
        </a>
        <Link href={`/analyze?url=${encodeURIComponent(deal.listing_url)}`}
          style={{ flex: '1 1 auto', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            background: C.white, color: C.green, border: `1.5px solid ${C.green}`, borderRadius: 10, padding: '10px 14px',
            textDecoration: 'none', fontWeight: 700, fontSize: 13,
            fontFamily: "'DM Sans',system-ui,sans-serif" }}>
          Full Analysis →
        </Link>
        <button onClick={handleFlagSold} disabled={flagging || flagged}
          title="Report this listing as sold or no longer active"
          style={{ padding: '10px 12px', border: `1px solid ${C.border}`, borderRadius: 10, background: 'none',
            cursor: flagged ? 'default' : 'pointer', color: flagged ? C.green : C.muted,
            fontFamily: "'DM Sans',system-ui,sans-serif", fontSize: 12, fontWeight: 500,
            display: 'flex', alignItems: 'center', gap: 5 }}>
          {flagged ? '✓ Reported' : flagging ? '...' : 'Sold?'}
        </button>
      </div>
    </div>
  );
}

// ─── Deal search panel (Phase 2) ──────────────────────────────────────────────
function DealSearchPanel({ session, filters, onDealsLoaded }) {
  const [loading,     setLoading]     = useState(false);
  const [autoLoading, setAutoLoading] = useState(true);   // true while mount fetch is in-flight
  const [deals,       setDeals]       = useState(null);   // null = not searched yet
  const [error,       setError]       = useState(null);
  const [guestStatus, setGuestStatus] = useState(null);   // { allowed, usedScout }
  const [tokensLeft,  setTokensLeft]  = useState(null);
  const [flaggedIds,  setFlaggedIds]  = useState(new Set());
  const fpRef = useRef(null);
  const tokens = session?.user?.tokens ?? 0;
  const isAuthed = !!session?.user?.id;

  // Get fingerprint and guest status on mount
  useEffect(() => {
    if (isAuthed) return;
    const fp = getDeviceFingerprint();
    fpRef.current = fp;
    fetch(`/api/guest-usage?action=check&type=scout&fp=${fp}`)
      .then(r => r.json())
      .then(d => setGuestStatus(d))
      .catch(() => setGuestStatus({ allowed: true }));
  }, [isAuthed]);

  // Auto-load cached deals for the top market on mount
  useEffect(() => {
    const top = getRankedMarkets(filters)[0];
    if (!top) { setAutoLoading(false); return; }
    fetch(`/api/scout-deals?city=${encodeURIComponent(top.city)}&state=${top.state}&priceMax=${filters.priceMax}&beds=${filters.beds}`)
      .then(r => r.json())
      .then(d => {
        if (d.deals?.length > 0) {
          setDeals(d.deals);
          onDealsLoaded?.(d.deals);
        }
      })
      .catch(() => {})
      .finally(() => setAutoLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function runSearch() {
    setLoading(true);
    setError(null);
    setDeals(null);

    const top = getRankedMarkets(filters)[0];
    if (!top) { setError('No markets match your filters.'); setLoading(false); return; }

    const body = {
      city:     top.city,
      state:    top.state,
      priceMax: filters.priceMax,
      beds:     filters.beds,
      propType: filters.propType,
      goal:     filters.goal,
    };
    if (!isAuthed && fpRef.current) body.fp = fpRef.current;

    try {
      const res = await fetch('/api/scout-deals', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();

      if (!res.ok) {
        if (data.code === 'NO_TOKENS' || data.code === 'GUEST_USED') {
          setError('token_used');
        } else if (data.code === 'UNAUTHENTICATED') {
          setError('sign_in');
        } else {
          setError(data.error || 'Search failed. Try again.');
        }
        setLoading(false);
        return;
      }

      setDeals(data.deals || []);
      if (data.tokensRemaining !== null) setTokensLeft(data.tokensRemaining);
      if (!isAuthed) setGuestStatus(prev => ({ ...prev, usedScout: true, allowed: false }));
      onDealsLoaded?.(data.deals || []);
    } catch {
      setError('AI search temporarily unavailable. Try again in a moment.');
    }
    setLoading(false);
  }

  const canSearch = isAuthed
    ? tokens >= 1
    : (guestStatus?.allowed !== false);

  const visibleDeals = deals?.filter(d => !flaggedIds.has(d.id)) || [];

  return (
    <div style={{ marginBottom: 24 }}>
      {/* Phase 2 header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, gap: 10, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontFamily: "'Libre Baskerville',Georgia,serif", fontSize: 20, fontWeight: 700, color: C.text, marginBottom: 3 }}>
            AI Deal Discovery
          </div>
          <div style={{ fontSize: 12.5, color: C.muted, lineHeight: 1.5 }}>
            Search for active listings in the top-ranked market using Gemini AI + live search.
            Results are real listings on Zillow, Redfin, or Realtor.com — not generated.
          </div>
        </div>
        {isAuthed && (
          <div style={{ fontSize: 12, color: tokens <= 0 ? C.red : tokens <= 2 ? C.amber : C.green, fontWeight: 700, background: C.soft, border: `1px solid ${C.border}`, borderRadius: 8, padding: '5px 12px', flexShrink: 0 }}>
            {tokensLeft ?? tokens} token{(tokensLeft ?? tokens) !== 1 ? 's' : ''} remaining
          </div>
        )}
      </div>

      {/* Search button or gate */}
      {(error === 'token_used' || (isAuthed && tokens === 0) || (!isAuthed && guestStatus?.usedScout && error !== 'sign_in')) ? (
        <div style={{ background: C.amberBg, border: `1px solid ${C.amberBorder}`, borderRadius: 14, padding: '20px 22px', marginBottom: 14 }}>
          <div style={{ fontWeight: 700, fontSize: 14.5, color: C.amber, marginBottom: 6 }}>
            {isAuthed ? 'Out of tokens' : 'Free search used'}
          </div>
          <div style={{ fontSize: 13, color: '#5a3d00', marginBottom: 14, lineHeight: 1.55 }}>
            {isAuthed
              ? 'Purchase more tokens to run additional AI searches and analyses.'
              : 'Create a free account for 2 tokens — 1 Scout search + 1 full property analysis.'}
          </div>
          <Link href={isAuthed ? '/dashboard' : '/auth'}
            style={{ display: 'inline-block', padding: '10px 22px', borderRadius: 10, background: C.green, color: '#fff', textDecoration: 'none', fontWeight: 700, fontSize: 13, fontFamily: "'DM Sans',system-ui,sans-serif" }}>
            {isAuthed ? 'Buy tokens →' : 'Sign up free →'}
          </Link>
        </div>
      ) : error === 'sign_in' ? (
        <div style={{ background: C.soft, border: `1px solid ${C.border}`, borderRadius: 14, padding: '20px 22px', marginBottom: 14 }}>
          <div style={{ fontWeight: 700, fontSize: 14.5, color: C.text, marginBottom: 6 }}>Sign in to search</div>
          <div style={{ fontSize: 13, color: C.muted, marginBottom: 14 }}>Create a free account for 2 tokens to start finding deals.</div>
          <Link href="/auth" style={{ display: 'inline-block', padding: '10px 22px', borderRadius: 10, background: C.green, color: '#fff', textDecoration: 'none', fontWeight: 700, fontSize: 13, fontFamily: "'DM Sans',system-ui,sans-serif" }}>
            Sign up free →
          </Link>
        </div>
      ) : (
        <div style={{ marginBottom: 14 }}>
          {!isAuthed && guestStatus && !guestStatus.usedScout && (
            <div style={{ background: C.greenBg, border: `1px solid ${C.greenBorder}`, borderRadius: 12, padding: '10px 16px', marginBottom: 10, fontSize: 12.5, color: '#3a6e50', display: 'flex', alignItems: 'center', gap: 8 }}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zm0 2.5v3.5M7 9.5v.5" stroke={C.green} strokeWidth="1.4" strokeLinecap="round"/></svg>
              You have <strong>1 free AI search</strong> available — no account needed.
            </div>
          )}
          <button onClick={runSearch} disabled={loading || !canSearch}
            style={{ width: '100%', padding: '15px', border: 'none', borderRadius: 13,
              background: canSearch ? C.green : C.soft,
              color: canSearch ? '#fff' : C.muted,
              fontFamily: "'DM Sans',system-ui,sans-serif", fontSize: 14.5, fontWeight: 700,
              cursor: canSearch ? 'pointer' : 'not-allowed',
              boxShadow: canSearch ? '0 4px 16px rgba(22,102,56,0.3)' : 'none',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
              transition: 'all 0.2s' }}>
            {loading ? (
              <>
                <div style={{ width: 16, height: 16, border: '2.5px solid rgba(255,255,255,0.35)', borderTopColor: '#fff', borderRadius: '50%', animation: 'riq-spin 0.7s linear infinite' }}/>
                Searching for active listings...
              </>
            ) : (
              <>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" strokeWidth="1.6"/>
                  <path d="M10 10l3.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
                </svg>
                {canSearch
                  ? `Search for deals in top market${isAuthed ? ` · 1 token` : ` (free)`}`
                  : 'No searches remaining'}
              </>
            )}
          </button>
          {typeof error === 'string' && error !== 'token_used' && error !== 'sign_in' && (
            <div style={{ marginTop: 10, fontSize: 12.5, color: C.red, padding: '10px 14px', background: C.redBg, border: `1px solid ${C.redBorder}`, borderRadius: 10 }}>
              {error}
            </div>
          )}
        </div>
      )}

      {/* Results */}
      {autoLoading && deals === null && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '18px 0', color: C.muted, fontSize: 13 }}>
          <div style={{ width: 14, height: 14, border: '2px solid ' + C.border, borderTopColor: C.green, borderRadius: '50%', animation: 'riq-spin 0.7s linear infinite', flexShrink: 0 }}/>
          Checking for recent deals in top market…
        </div>
      )}
      {deals !== null && (
        visibleDeals.length === 0 ? (
          <div style={{ background: C.soft, border: `1px solid ${C.border}`, borderRadius: 14, padding: '28px 22px', textAlign: 'center' }}>
            <div style={{ fontSize: 14.5, fontWeight: 700, color: C.text, marginBottom: 6 }}>No active listings found right now</div>
            <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.55 }}>
              The AI searched for active listings on Zillow, Redfin, and Realtor.com but couldn't find verified results matching your criteria. Try adjusting your price or beds, or use the platform search links in the market cards below.
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ fontSize: 12, color: C.muted, display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ width: 7, height: 7, background: C.green, borderRadius: '50%' }}/>
              {visibleDeals.length} active listing{visibleDeals.length !== 1 ? 's' : ''} found · Valid for 30 days · Prices may have changed
            </div>
            {visibleDeals.map((deal, i) => (
              <DealCard
                key={deal.id || deal.listing_url}
                deal={deal}
                onFlagSold={id => setFlaggedIds(prev => new Set([...prev, id]))}
              />
            ))}
          </div>
        )
      )}
    </div>
  );
}

// ─── Market card (Phase 1) ────────────────────────────────────────────────────
function MarketCard({ market, rank }) {
  const [open, setOpen] = useState(false);
  const cf      = market.cashFlow;
  const cfColor = cf === null ? C.muted : cf >= 200 ? C.green : cf >= 0 ? C.amber : C.red;
  const cfLabel = cf === null ? 'N/A' : cf >= 0 ? `+$${cf.toLocaleString()}/mo` : `-$${Math.abs(cf).toLocaleString()}/mo`;
  const tagline = getMarketTagline(market);
  const rankColor = rank <= 3 ? C.green : rank <= 8 ? C.amber : C.muted;
  const rankBg    = rank <= 3 ? C.greenBg : rank <= 8 ? C.amberBg : C.soft;

  return (
    <div className="riq-lift" style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 16, overflow: 'hidden', animation: 'riq-fadeup 0.4s ease both' }}>
      <div style={{ padding: '18px 20px 0' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
              <span style={{ fontSize: 11, fontWeight: 800, color: rankColor, background: rankBg, border: `1px solid ${rankColor}30`, borderRadius: 7, padding: '2px 8px', flexShrink: 0 }}>#{rank}</span>
              <h2 style={{ margin: 0, fontFamily: "'Libre Baskerville',Georgia,serif", fontSize: 19, fontWeight: 700, color: C.text, letterSpacing: '-0.02em', lineHeight: 1.1 }}>
                {market.city}
                <span style={{ fontFamily: "'DM Sans',system-ui,sans-serif", fontWeight: 500, fontSize: 13, color: C.muted, marginLeft: 6 }}>{market.state}</span>
              </h2>
            </div>
            <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.4 }}>{tagline}</div>
          </div>
          <div style={{ flexShrink: 0, textAlign: 'center' }}>
            <div style={{ fontSize: 24, fontWeight: 800, color: C.green, lineHeight: 1 }}>{market.score}</div>
            <div style={{ fontSize: 9, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: C.muted, marginTop: 2 }}>Score</div>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 7, marginBottom: 12 }}>
          <Pill label="Mkt Cap Rate" value={`${market.capRate}%`} color={market.capRate >= 7 ? C.green : market.capRate >= 5.5 ? C.amber : C.text}/>
          <Pill label="Est. Cash Flow" value={cfLabel} color={cfColor}/>
          <Pill label="Appreciation" value={`${market.appreciationRate}%/yr`} color={C.blue}/>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, gap: 8 }}>
          <LandlordBadge score={market.landlordScore}/>
          <span style={{ fontSize: 11, color: C.muted }}>{market.region}</span>
        </div>
        <ScoreBar value={market.score}/>
      </div>
      <div style={{ padding: '12px 20px', display: 'flex', gap: 7, flexWrap: 'wrap', borderTop: `1px solid ${C.border}`, marginTop: 12 }}>
        {[
          { href: market.zillowUrl, label: 'Zillow', bg: '#006AFF', shadow: 'rgba(0,106,255,0.25)' },
          { href: market.redfinUrl, label: 'Redfin', bg: '#CC0000', shadow: 'rgba(204,0,0,0.22)' },
          { href: market.realtorUrl, label: 'Realtor.com', bg: C.white, color: '#D9232D', border: '1.5px solid #D9232D' },
        ].map(btn => (
          <a key={btn.label} href={btn.href} target="_blank" rel="noopener noreferrer"
            style={{ flex: '1 1 auto', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
              background: btn.bg, color: btn.color || '#fff', border: btn.border || 'none', borderRadius: 9,
              padding: '9px 10px', textDecoration: 'none', fontWeight: 700, fontSize: 12,
              fontFamily: "'DM Sans',system-ui,sans-serif",
              boxShadow: btn.shadow ? `0 2px 8px ${btn.shadow}` : 'none', transition: 'opacity 0.15s' }}
            onMouseEnter={e => e.currentTarget.style.opacity = '0.82'}
            onMouseLeave={e => e.currentTarget.style.opacity = '1'}>
            {btn.label}
            <svg width="9" height="9" viewBox="0 0 10 10" fill="none"><path d="M2 8L8 2M8 2H4M8 2V6" stroke={btn.color || 'white'} strokeWidth="1.5" strokeLinecap="round"/></svg>
          </a>
        ))}
      </div>
      <div style={{ borderTop: `1px solid ${C.border}` }}>
        <button onClick={() => setOpen(o => !o)}
          style={{ width: '100%', padding: '10px 20px', background: 'none', border: 'none', cursor: 'pointer', fontFamily: "'DM Sans',system-ui,sans-serif", fontSize: 12, fontWeight: 600, color: C.muted, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          Market details
          <svg width="13" height="13" viewBox="0 0 14 14" fill="none" style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
            <path d="M3 5l4 4 4-4" stroke={C.muted} strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </button>
        <div style={{ maxHeight: open ? 360 : 0, overflow: 'hidden', transition: 'max-height 0.35s cubic-bezier(0.4,0,0.2,1)' }}>
          <div style={{ padding: '4px 20px 16px', display: 'flex', flexDirection: 'column', gap: 9 }}>
            {[
              { l: 'Median Price',    v: market.medianPrice ? `$${market.medianPrice.toLocaleString()}` : 'N/A' },
              { l: 'HUD 2BR Rent',    v: market.rent2br ? `$${market.rent2br.toLocaleString()}/mo` : 'N/A' },
              { l: 'Multi-fam Cap',   v: market.capRateMfr ? `${market.capRateMfr}%` : 'N/A' },
              { l: 'Property Tax',    v: `${market.taxRate}%/yr` },
              { l: 'Insurance Rate',  v: `${market.insRate}%/yr` },
              { l: 'Cap Rate Source', v: market.capSource },
            ].map((row, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ fontSize: 11.5, color: C.muted }}>{row.l}</span>
                <span style={{ fontSize: 12.5, fontWeight: 600, color: C.text, textAlign: 'right' }}>{row.v}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Filter panel ─────────────────────────────────────────────────────────────
function FilterPanel({ filters, onChange }) {
  function set(k, v) { onChange({ ...filters, [k]: v }); }
  const goalOpts = [
    { v: 'cashflow', l: 'Max Cash Flow', sub: 'Highest cap rates now' },
    { v: 'appreciation', l: 'Appreciation', sub: 'Long-term equity' },
    { v: 'balanced', l: 'Balanced', sub: 'Cash flow + growth' },
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.10em', textTransform: 'uppercase', color: C.muted, marginBottom: 9 }}>Goal</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {goalOpts.map(o => {
            const active = filters.goal === o.v;
            return (
              <button key={o.v} onClick={() => set('goal', o.v)}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 10,
                  border: `1.5px solid ${active ? C.green : C.border}`, background: active ? C.greenBg : C.white,
                  cursor: 'pointer', fontFamily: "'DM Sans',system-ui,sans-serif", textAlign: 'left', transition: 'all 0.15s' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12.5, fontWeight: active ? 700 : 500, color: active ? C.green : C.text }}>{o.l}</div>
                  <div style={{ fontSize: 10.5, color: C.muted }}>{o.sub}</div>
                </div>
                {active && <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M2.5 7l3.5 3.5 6-6" stroke={C.green} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>}
              </button>
            );
          })}
        </div>
      </div>
      <div>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.10em', textTransform: 'uppercase', color: C.muted, marginBottom: 9 }}>Max price</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {[150000, 250000, 350000, 500000].map(v => {
            const a = filters.priceMax === v;
            return (
              <button key={v} onClick={() => set('priceMax', v)}
                style={{ flex: '1 1 auto', padding: '8px 6px', borderRadius: 9, border: `1.5px solid ${a ? C.green : C.border}`,
                  background: a ? C.greenBg : C.white, color: a ? C.green : C.muted, fontWeight: a ? 700 : 400,
                  fontSize: 12, cursor: 'pointer', fontFamily: "'DM Sans',system-ui,sans-serif", transition: 'all 0.15s' }}>
                ${v / 1000}k
              </button>
            );
          })}
        </div>
      </div>
      <div>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.10em', textTransform: 'uppercase', color: C.muted, marginBottom: 9 }}>Bedrooms</div>
        <div style={{ display: 'flex', gap: 6 }}>
          {[2, 3, 4].map(v => {
            const a = filters.beds === v;
            return (
              <button key={v} onClick={() => set('beds', v)}
                style={{ flex: 1, padding: '9px 6px', borderRadius: 9, border: `1.5px solid ${a ? C.green : C.border}`,
                  background: a ? C.greenBg : C.white, color: a ? C.green : C.muted, fontWeight: a ? 700 : 400,
                  fontSize: 13, cursor: 'pointer', fontFamily: "'DM Sans',system-ui,sans-serif", transition: 'all 0.15s' }}>
                {v}BR
              </button>
            );
          })}
        </div>
      </div>
      <div>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.10em', textTransform: 'uppercase', color: C.muted, marginBottom: 9 }}>Property type</div>
        <div style={{ display: 'flex', gap: 6 }}>
          {[{ v: 'sfr', l: 'SFR' }, { v: 'mfr', l: 'Multi' }, { v: 'any', l: 'Any' }].map(o => {
            const a = filters.propType === o.v;
            return (
              <button key={o.v} onClick={() => set('propType', o.v)}
                style={{ flex: 1, padding: '8px 6px', borderRadius: 9, border: `1.5px solid ${a ? C.green : C.border}`,
                  background: a ? C.greenBg : C.white, color: a ? C.green : C.muted, fontWeight: a ? 700 : 400,
                  fontSize: 12, cursor: 'pointer', fontFamily: "'DM Sans',system-ui,sans-serif", transition: 'all 0.15s' }}>
                {o.l}
              </button>
            );
          })}
        </div>
      </div>
      <div>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.10em', textTransform: 'uppercase', color: C.muted, marginBottom: 6 }}>
          Min cap rate <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>({filters.minCapRate}%+)</span>
        </div>
        <input type="range" min="0" max="8" step="0.5" value={filters.minCapRate}
          onChange={e => set('minCapRate', parseFloat(e.target.value))}
          style={{ width: '100%', accentColor: C.green }}/>
      </div>
      <div>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.10em', textTransform: 'uppercase', color: C.muted, marginBottom: 6 }}>
          Min landlord score <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>({filters.minLandlord}+)</span>
        </div>
        <input type="range" min="0" max="90" step="10" value={filters.minLandlord}
          onChange={e => set('minLandlord', parseInt(e.target.value))}
          style={{ width: '100%', accentColor: C.green }}/>
      </div>
      <div>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.10em', textTransform: 'uppercase', color: C.muted, marginBottom: 8 }}>Region</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
          {['all', 'Southeast', 'South', 'Midwest', 'Northeast', 'West', 'Southwest'].map(r => {
            const a = filters.region === r;
            return (
              <button key={r} onClick={() => set('region', r)}
                style={{ padding: '5px 10px', borderRadius: 100, border: `1.5px solid ${a ? C.text : C.border}`,
                  background: a ? C.text : C.white, color: a ? '#fff' : C.muted, fontWeight: a ? 600 : 400,
                  fontSize: 11, cursor: 'pointer', fontFamily: "'DM Sans',system-ui,sans-serif", transition: 'all 0.15s' }}>
                {r === 'all' ? 'All' : r}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function Scout() {
  const { data: session, status: authStatus } = useSession();
  const tokens = session?.user?.tokens ?? 0;

  const [filters, setFilters] = useState({
    priceMax: 350000, beds: 3, goal: 'cashflow',
    region: 'all', minCapRate: 0, minLandlord: 0, propType: 'sfr',
  });
  const [activeTab,   setActiveTab]   = useState('markets'); // 'markets' | 'deals'
  const [dealsCount,  setDealsCount]  = useState(0);

  const markets = useMemo(() => getRankedMarkets(filters), [filters]);

  const activeFilterCount = [
    filters.priceMax !== 350000, filters.beds !== 3, filters.goal !== 'cashflow',
    filters.region !== 'all', filters.minCapRate > 0, filters.minLandlord > 0, filters.propType !== 'sfr',
  ].filter(Boolean).length;

  return (
    <>
      <Head>
        <title>RentalIQ Scout — Find Rental Investment Deals</title>
        <meta name="description" content="Discover the best US rental investment markets. AI-powered deal discovery finds active listings on Zillow, Redfin, and Realtor.com — ranked by cap rate, cash flow, and landlord-friendliness."/>
        <meta name="viewport" content="width=device-width, initial-scale=1"/>
      </Head>
      <style>{`
        @keyframes riq-fadeup { from{opacity:0;transform:translateY(18px)} to{opacity:1;transform:translateY(0)} }
        @keyframes riq-spin   { to{transform:rotate(360deg)} }
        *{box-sizing:border-box}
        .riq-lift{transition:transform 0.22s ease,box-shadow 0.22s ease;box-shadow:0 1px 2px rgba(0,0,0,0.05),0 2px 12px rgba(0,0,0,0.06)}
        .riq-lift:hover{transform:translateY(-2px);box-shadow:0 8px 32px rgba(0,0,0,0.09)!important}
        input[type=range]{-webkit-appearance:none;height:4px;border-radius:2px;background:#eaeaef;outline:none;width:100%}
        input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:18px;height:18px;border-radius:50%;background:#166638;cursor:pointer}
        input[type=range]::-moz-range-thumb{width:18px;height:18px;border-radius:50%;background:#166638;cursor:pointer;border:none}
        @media(max-width:900px){.scout-layout{grid-template-columns:1fr!important}.scout-aside{display:none!important}}
        @media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
      `}</style>

      <div style={{ background: C.bg, minHeight: '100vh', fontFamily: "'DM Sans',system-ui,sans-serif" }}>

        {/* Nav */}
        <nav style={{ position: 'sticky', top: 0, zIndex: 100, background: 'rgba(245,245,248,0.9)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', borderBottom: `1px solid ${C.border}`, padding: '0 28px' }}>
          <div style={{ maxWidth: 1160, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 52 }}>
            <Link href="/" style={{ display: 'flex', alignItems: 'center', textDecoration: 'none' }}>
              
              <span style={{ fontSize: 16, fontWeight: 700, letterSpacing: '-0.01em', color: C.text }}>RentalIQ</span>
            </Link>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ display: 'inline-flex', background: C.soft, borderRadius: 10, padding: 3, gap: 3 }}>
                <Link href="/analyze" style={{ display: 'block', padding: '5px 14px', borderRadius: 8, fontSize: 12.5, fontWeight: 500, color: C.muted, textDecoration: 'none' }}>Analyze</Link>
                <span style={{ display: 'block', padding: '5px 14px', borderRadius: 8, background: C.white, fontSize: 12.5, fontWeight: 700, color: C.text, boxShadow: C.shadowSm }}>Scout</span>
              </div>
              {authStatus === 'authenticated' ? (
                <div style={{ display: 'flex', gap: 8 }}>
                  <Link href="/dashboard" style={{ fontSize: 12, color: C.muted, textDecoration: 'none', padding: '5px 12px', border: `1px solid ${C.border}`, borderRadius: 8 }}>My Deals</Link>
                  <span style={{ fontSize: 12, color: tokens <= 0 ? C.red : tokens <= 2 ? C.amber : C.green, padding: '5px 12px', border: `1px solid ${tokens <= 0 ? C.redBorder : tokens <= 2 ? C.amberBorder : C.greenBorder}`, borderRadius: 8, background: C.white, fontWeight: 700 }}>
                    {tokens} token{tokens !== 1 ? 's' : ''}
                  </span>
                </div>
              ) : (
                <Link href="/auth" style={{ padding: '6px 16px', borderRadius: 9, fontSize: 12.5, fontWeight: 600, color: '#fff', background: C.green, textDecoration: 'none' }}>Sign In</Link>
              )}
            </div>
          </div>
        </nav>

        {/* Hero */}
        <header style={{ padding: '44px 28px 32px', background: `radial-gradient(ellipse 900px 400px at 50% 0%, rgba(22,102,56,0.07) 0%, transparent 70%), ${C.bg}`, borderBottom: `1px solid ${C.border}`, animation: 'riq-fadeup 0.5s ease both' }}>
          <div style={{ maxWidth: 1160, margin: '0 auto' }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 14, padding: '4px 12px', background: C.white, border: `1px solid ${C.border}`, borderRadius: 100, boxShadow: C.shadowSm }}>
              <div style={{ width: 6, height: 6, background: C.green, borderRadius: '50%' }}/>
              <span style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '0.10em', color: C.muted, textTransform: 'uppercase' }}>Ranked · Scored · Live deal discovery</span>
            </div>
            <h1 style={{ margin: '0 0 12px', fontFamily: "'Libre Baskerville',Georgia,serif", fontSize: 'clamp(26px,4vw,50px)', fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1.05, color: C.text }}>
              Where are the <em style={{ fontStyle: 'italic', color: C.green, fontWeight: 400 }}>best rental deals</em> right now?
            </h1>
            <p style={{ margin: '0 0 22px', fontSize: 15.5, color: C.muted, lineHeight: 1.65, maxWidth: 560 }}>
              Market intelligence from HUD, CBRE, and Eviction Lab data. AI-powered deal discovery finds real active listings.
              Find a deal, then run the full RentalIQ analysis in one click.
            </p>
            {/* Tab switcher */}
            <div style={{ display: 'inline-flex', background: C.soft, borderRadius: 11, padding: 4, gap: 4 }}>
              {[
                { v: 'markets', l: `Market Intelligence`, sub: `${markets.length} markets` },
                { v: 'deals',   l: 'AI Deal Discovery',  sub: dealsCount > 0 ? `${dealsCount} deals found` : '1 free search' },
              ].map(tab => {
                const active = activeTab === tab.v;
                return (
                  <button key={tab.v} onClick={() => setActiveTab(tab.v)}
                    style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', padding: '9px 18px', borderRadius: 8,
                      background: active ? C.white : 'none', border: 'none',
                      cursor: 'pointer', fontFamily: "'DM Sans',system-ui,sans-serif",
                      boxShadow: active ? C.shadowSm : 'none', transition: 'all 0.15s' }}>
                    <span style={{ fontSize: 13, fontWeight: active ? 700 : 500, color: active ? C.text : C.muted }}>{tab.l}</span>
                    <span style={{ fontSize: 10.5, color: active ? C.green : C.muted, fontWeight: 600 }}>{tab.sub}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </header>

        {/* Body */}
        <div style={{ maxWidth: 1160, margin: '0 auto', padding: '28px 28px 80px' }}>
          <div className="scout-layout" style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: 24, alignItems: 'start' }}>

            {/* Sidebar */}
            <aside className="scout-aside" style={{ position: 'sticky', top: 68 }}>
              <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 16, padding: '20px 18px', boxShadow: C.shadowSm }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.10em', textTransform: 'uppercase', color: C.muted }}>Refine markets</div>
                  {activeFilterCount > 0 && (
                    <button onClick={() => setFilters({ priceMax: 350000, beds: 3, goal: 'cashflow', region: 'all', minCapRate: 0, minLandlord: 0, propType: 'sfr' })}
                      style={{ fontSize: 11, color: C.muted, background: 'none', border: 'none', cursor: 'pointer', fontFamily: "'DM Sans',system-ui,sans-serif", textDecoration: 'underline' }}>
                      Reset ({activeFilterCount})
                    </button>
                  )}
                </div>
                <FilterPanel filters={filters} onChange={setFilters}/>
              </div>
              <div style={{ marginTop: 12, padding: '12px 14px', background: C.soft, borderRadius: 12, border: `1px solid ${C.border}` }}>
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: C.muted, marginBottom: 5 }}>Data sources</div>
                <div style={{ fontSize: 11, color: C.muted, lineHeight: 1.6 }}>
                  Cap rates: CBRE/JLL via HUD SAFMR + Census ACS<br/>
                  Landlord scores: Eviction Lab + NCSL<br/>
                  Tax: Tax Foundation 2024<br/>
                  Appreciation: 5yr FHFA CAGR<br/>
                  Deals: Gemini AI + live Google search
                </div>
              </div>
            </aside>

            {/* Main content */}
            <div>
              {activeTab === 'deals' && (
                <DealSearchPanel
                  session={session}
                  filters={filters}
                  onDealsLoaded={d => setDealsCount(d.length)}
                />
              )}

              {/* Market cards — always shown under deals tab too */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {activeTab === 'markets' && (
                  <div style={{ background: C.amberBg, border: `1px solid ${C.amberBorder}`, borderRadius: 12, padding: '11px 15px', display: 'flex', alignItems: 'flex-start', gap: 9 }}>
                    <svg width="14" height="14" viewBox="0 0 15 15" fill="none" style={{ flexShrink: 0, marginTop: 1 }}>
                      <path d="M7.5 1.5L13.5 13H1.5L7.5 1.5Z" stroke={C.amber} strokeWidth="1.4" fill="none"/>
                      <path d="M7.5 6v3M7.5 10.5v.5" stroke={C.amber} strokeWidth="1.4" strokeLinecap="round"/>
                    </svg>
                    <div style={{ fontSize: 11.5, color: C.amber, lineHeight: 1.55 }}>
                      <strong>Investor estimates.</strong> Cap rates and cash flow are modeled from public data at 20% down, 7% rate, market-average expenses.
                      Always analyze specific listings before investing.
                    </div>
                  </div>
                )}
                {activeTab === 'markets' && markets.length === 0 && (
                  <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 16, padding: '36px 24px', textAlign: 'center' }}>
                    <div style={{ fontSize: 15, fontWeight: 700, color: C.text, marginBottom: 8 }}>No markets match these filters</div>
                    <button onClick={() => setFilters({ priceMax: 350000, beds: 3, goal: 'cashflow', region: 'all', minCapRate: 0, minLandlord: 0, propType: 'sfr' })}
                      style={{ padding: '10px 22px', border: 'none', borderRadius: 10, background: C.green, color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: "'DM Sans',system-ui,sans-serif" }}>
                      Reset filters
                    </button>
                  </div>
                )}
                {activeTab === 'markets' && markets.map((m, i) => (
                  <MarketCard key={m.key} market={m} rank={i + 1}/>
                ))}
                {activeTab === 'deals' && markets.length > 0 && (
                  <div style={{ marginTop: 8 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.10em', textTransform: 'uppercase', color: C.muted, marginBottom: 12 }}>
                      Top markets to search manually
                    </div>
                    {markets.slice(0, 5).map((m, i) => (
                      <div key={m.key} style={{ marginBottom: 12 }}>
                        <MarketCard market={m} rank={i + 1}/>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Bottom CTA */}
              {activeTab === 'markets' && markets.length > 0 && (
                <div style={{ marginTop: 20, background: C.greenBg, border: `1.5px solid ${C.greenBorder}`, borderRadius: 16, padding: '24px', textAlign: 'center' }}>
                  <div style={{ fontFamily: "'Libre Baskerville',Georgia,serif", fontSize: 20, fontWeight: 700, color: C.text, marginBottom: 8 }}>Found a listing you like?</div>
                  <div style={{ fontSize: 13.5, color: '#3a6e50', marginBottom: 18, lineHeight: 1.65 }}>
                    Paste any Zillow or Redfin URL into RentalIQ for a full cap rate, cash flow, IRR, and buy/pass verdict in 30 seconds.
                  </div>
                  <Link href="/analyze" style={{ display: 'inline-block', background: C.green, color: '#fff', borderRadius: 10, padding: '12px 28px', fontSize: 14, fontWeight: 700, textDecoration: 'none', boxShadow: '0 4px 16px rgba(22,102,56,0.3)' }}>
                    Analyze →
                  </Link>
                </div>
              )}
            </div>
          </div>
        </div>

        <footer style={{ textAlign: 'center', padding: '16px 0 32px', fontSize: 11.5, color: C.muted, borderTop: `1px solid ${C.border}` }}>
          RentalIQ Scout · Cap rates: CBRE/JLL · Landlord scores: Eviction Lab · Deals: Gemini AI search grounding · Not financial advice
        </footer>
      </div>
    </>
  );
}
