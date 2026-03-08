import { useState, useEffect } from 'react';
import { useSession, signOut } from 'next-auth/react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import { TOKEN_PACKAGES } from '../lib/tokenPackages';

const C = {
  bg:'#f5f5f8', white:'#ffffff', border:'#dddde4', text:'#0d0d0f', muted:'#72727a', soft:'#eaeaef',
  green:'#166638', greenBg:'#ecf6f1', greenBorder:'#96ccb0',
  red:'#a62626', redBg:'#fdf0f0', redBorder:'#e0aaaa',
  amber:'#8a5800', amberBg:'#fdf4e8', amberBorder:'#dfc070',
  blue:'#1649a0', blueBg:'#edf1fc', blueBorder:'#a0beed',
  shadow:'0 1px 2px rgba(0,0,0,0.05), 0 2px 12px rgba(0,0,0,0.06)',
  shadowSm:'0 1px 2px rgba(0,0,0,0.04)',
  shadowLg:'0 12px 48px rgba(0,0,0,0.11), 0 2px 8px rgba(0,0,0,0.05)',
};

const VERDICT_CFG = {
  YES:   { color: C.green, label: 'BUY',     bg: C.greenBg,  border: C.greenBorder  },
  NO:    { color: C.red,   label: 'PASS',    bg: C.redBg,    border: C.redBorder    },
  MAYBE: { color: C.amber, label: 'CAUTION', bg: C.amberBg,  border: C.amberBorder  },
};

function VerdictBadge({ verdict }) {
  const cfg = VERDICT_CFG[verdict?.toUpperCase()] || VERDICT_CFG.MAYBE;
  return (
    <span style={{
      display:'inline-block', padding:'3px 10px', borderRadius:100,
      fontSize:10, fontWeight:700, letterSpacing:'0.08em',
      color:cfg.color, background:cfg.bg, border:`1px solid ${cfg.border}`,
    }}>
      {cfg.label}
    </span>
  );
}

function ScoreDot({ score }) {
  const color = score >= 68 ? C.green : score >= 45 ? C.amber : C.red;
  return (
    <div style={{display:'flex',alignItems:'center',gap:6}}>
      <div style={{width:8,height:8,borderRadius:'50%',background:color,flexShrink:0}}/>
      <span style={{fontSize:13,fontWeight:700,color}}>{score}</span>
    </div>
  );
}

function TokenPurchaseModal({ onClose, onSuccess }) {
  const [purchasing, setPurchasing] = useState(null);
  const [error, setError] = useState('');

  async function handlePurchase(pkg) {
    setPurchasing(pkg.id);
    setError('');
    try {
      const res  = await fetch('/api/tokens/purchase', {
        method:  'POST',
        headers: { 'content-type': 'application/json' },
        body:    JSON.stringify({ packageId: pkg.id, returnPath: '/dashboard' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Purchase failed');
      // Redirect to Stripe checkout
      window.location.href = data.url;
    } catch (err) {
      setError(err.message);
      setPurchasing(null);
    }
  }

  return (
    <div style={{position:'fixed',inset:0,zIndex:200,display:'flex',alignItems:'center',justifyContent:'center',padding:24,background:'rgba(0,0,0,0.4)',backdropFilter:'blur(4px)'}}>
      <div style={{background:C.white,borderRadius:20,boxShadow:C.shadowLg,padding:'36px 32px',maxWidth:480,width:'100%',animation:'fadeup 0.25s ease both'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:24}}>
          <div>
            <h2 style={{fontSize:20,fontWeight:700,color:C.text,marginBottom:4,letterSpacing:'-0.02em'}}>Buy Analysis Tokens</h2>
            <p style={{fontSize:13,color:C.muted}}>Each token runs one full AI analysis.</p>
          </div>
          <button onClick={onClose} style={{background:'none',border:'none',cursor:'pointer',color:C.muted,fontSize:18,lineHeight:1,padding:4}}>✕</button>
        </div>

        {error && (
          <div style={{background:C.redBg,border:`1px solid ${C.redBorder}`,borderRadius:10,padding:'10px 14px',marginBottom:16,fontSize:13,color:C.red}}>
            {error}
          </div>
        )}

        <div style={{display:'flex',flexDirection:'column',gap:10}}>
          {TOKEN_PACKAGES.map(pkg => (
            <button
              key={pkg.id}
              onClick={() => handlePurchase(pkg)}
              disabled={!!purchasing}
              style={{
                display:'flex', alignItems:'center', justifyContent:'space-between',
                background: purchasing === pkg.id ? C.greenBg : C.white,
                border: `1.5px solid ${purchasing === pkg.id ? C.green : C.border}`,
                borderRadius:14, padding:'16px 18px', cursor:purchasing?'default':'pointer',
                fontFamily:'inherit', transition:'all 0.15s', opacity:purchasing&&purchasing!==pkg.id?0.5:1,
                position:'relative', overflow:'hidden',
              }}
              onMouseEnter={e=>{ if(!purchasing){ e.currentTarget.style.borderColor=C.green; e.currentTarget.style.background=C.greenBg; }}}
              onMouseLeave={e=>{ if(!purchasing){ e.currentTarget.style.borderColor=C.border; e.currentTarget.style.background=C.white; }}}
            >
              {pkg.badge && (
                <span style={{position:'absolute',top:0,right:0,background:C.green,color:'#fff',fontSize:9,fontWeight:700,padding:'3px 10px',borderRadius:'0 14px 0 8px',letterSpacing:'0.06em'}}>
                  {pkg.badge}
                </span>
              )}
              <div style={{textAlign:'left'}}>
                <div style={{fontSize:15,fontWeight:700,color:C.text,marginBottom:2}}>{pkg.label}</div>
                <div style={{fontSize:12,color:C.muted}}>{pkg.sublabel}</div>
              </div>
              <div style={{display:'flex',alignItems:'center',gap:8,flexShrink:0}}>
                {purchasing === pkg.id
                  ? <div style={{width:18,height:18,border:`2px solid ${C.green}`,borderTopColor:'transparent',borderRadius:'50%',animation:'spin 0.7s linear infinite'}}/>
                  : <span style={{fontSize:16,fontWeight:700,color:C.green}}>${(pkg.price/100).toFixed(0)}</span>
                }
              </div>
            </button>
          ))}
        </div>

        <p style={{fontSize:11.5,color:C.muted,marginTop:16,textAlign:'center',lineHeight:1.5}}>
          Secure payment via Stripe. Tokens never expire.
        </p>
      </div>
    </div>
  );
}

function EmptyDeals() {
  return (
    <div style={{textAlign:'center',padding:'60px 24px',background:C.white,border:`1px solid ${C.border}`,borderRadius:14,boxShadow:C.shadowSm}}>
      <div style={{width:56,height:56,borderRadius:'50%',background:C.soft,display:'flex',alignItems:'center',justifyContent:'center',margin:'0 auto 16px'}}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
          <path d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" stroke={C.muted} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </div>
      <div style={{fontSize:15,fontWeight:700,color:C.text,marginBottom:8}}>No deals analyzed yet</div>
      <div style={{fontSize:13,color:C.muted,marginBottom:20,lineHeight:1.6}}>
        Run your first analysis on a property to see it saved here.
      </div>
      <Link href="/analyze" style={{display:'inline-block',background:C.green,color:'#fff',borderRadius:10,padding:'11px 22px',fontSize:13.5,fontWeight:600,textDecoration:'none',letterSpacing:'-0.01em'}}>
        Analyze a Property →
      </Link>
    </div>
  );
}

export default function Dashboard() {
  const { data: session, status, update: updateSession } = useSession();
  const router = useRouter();

  const [deals,      setDeals]      = useState([]);
  const [dealsLoading, setDealsLoading] = useState(true);
  const [showPurchase, setShowPurchase] = useState(false);
  const [toast,        setToast]        = useState(null);
  const [refCode,    setRefCode]    = useState('');
  const [refInput,   setRefInput]   = useState('');
  const [refMsg,     setRefMsg]     = useState('');
  const [refLoading, setRefLoading] = useState(false);
  const [copied,     setCopied]     = useState(false);
  const [refStats,   setRefStats]   = useState(null); // { claimCount, tokensEarned }
  const [selectedDeals, setSelectedDeals] = useState(new Set());
  const [deletingId, setDeletingId] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [shareLinks, setShareLinks] = useState({});   // dealId → shareUrl
  const [sharingId,  setSharingId]  = useState(null);
  const [copiedId,   setCopiedId]   = useState(null);
  const [savedProfile, setSavedProfile] = useState(null);

  function toggleSelect(id) {
    setSelectedDeals(prev => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); }
      else if (next.size < 3) { next.add(id); }
      return next;
    });
  }

  // Load investor profile from localStorage
  useEffect(() => {
    try {
      const raw = localStorage.getItem('riq-investor-profile-v2');
      if (raw) setSavedProfile(JSON.parse(raw));
    } catch (_) {}
  }, []);

  // Redirect if not authenticated
  useEffect(() => {
    if (status === 'unauthenticated') router.replace('/auth?callbackUrl=/dashboard');
  }, [status, router]);

  // Show success toast after Stripe redirect
  useEffect(() => {
    const { purchase, tokens } = router.query;
    if (purchase === 'success' && tokens) {
      setToast(`${tokens} token${tokens > 1 ? 's' : ''} added to your account!`);
      updateSession(); // refresh session to get new token count
      router.replace('/dashboard', undefined, { shallow: true });
      setTimeout(() => setToast(null), 5000);
    } else if (purchase === 'cancelled') {
      setToast('Purchase cancelled.');
      router.replace('/dashboard', undefined, { shallow: true });
      setTimeout(() => setToast(null), 3000);
    }
  }, [router.query]);

  // Load deal history
  useEffect(() => {
    if (status !== 'authenticated') return;
    fetch('/api/deals/list')
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(d => { setDeals(d.deals || []); setDealsLoading(false); })
      .catch(status => { setDeals([]); setDealsLoading(false); if (status === 401) router.replace('/auth'); });

    // Fetch referral code + stats in parallel
    fetch('/api/user/profile')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.referral_code) setRefCode(d.referral_code); })
      .catch(() => {});
    fetch('/api/referral/stats')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d && typeof d.claimCount === 'number') setRefStats(d); })
      .catch(() => {});
  }, [status]);

  if (status === 'loading' || status === 'unauthenticated') {
    return (
      <div style={{display:'flex',alignItems:'center',justifyContent:'center',minHeight:'100vh',background:C.bg}}>
        <div style={{width:36,height:36,borderRadius:'50%',border:`3px solid ${C.border}`,borderTopColor:C.green,animation:'spin 0.8s linear infinite'}}/>
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      </div>
    );
  }

  async function handleDelete(dealId) {
    if (confirmDeleteId !== dealId) { setConfirmDeleteId(dealId); return; }
    setConfirmDeleteId(null);
    setDeletingId(dealId);
    try {
      await fetch(`/api/deals/${dealId}`, { method: 'DELETE' });
      setDeals(prev => prev.filter(d => d.id !== dealId));
      setSelectedDeals(prev => { const n = new Set(prev); n.delete(dealId); return n; });
    } catch (_) {}
    setDeletingId(null);
  }

  async function handleShareDeal(dealId) {
    if (shareLinks[dealId]) {
      navigator.clipboard.writeText(shareLinks[dealId]).then(() => {
        setCopiedId(dealId); setTimeout(() => setCopiedId(null), 2000);
      });
      return;
    }
    setSharingId(dealId);
    try {
      const res  = await fetch('/api/deals/share', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ dealId }) });
      const data = await res.json();
      if (res.ok && data.shareUrl) {
        setShareLinks(prev => ({ ...prev, [dealId]: data.shareUrl }));
        navigator.clipboard.writeText(data.shareUrl).then(() => {
          setCopiedId(dealId); setTimeout(() => setCopiedId(null), 2000);
        });
      }
    } catch (_) {}
    setSharingId(null);
  }

  function copyRefLink() {
    const link = (typeof window !== 'undefined' ? window.location.origin : '') + '?ref=' + refCode;
    navigator.clipboard.writeText(link).then(() => { setCopied(true); setTimeout(()=>setCopied(false), 2000); });
  }

  async function handleClaim() {
    if (!refInput.trim()) return;
    setRefLoading(true); setRefMsg('');
    try {
      const res  = await fetch('/api/referral/claim', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ code: refInput.trim() }) });
      const data = await res.json();
      if (!res.ok) { setRefMsg(data.error || 'Could not claim.'); return; }
      setRefMsg(data.message || 'Claimed! +1 token added.');
      setRefInput('');
    } catch { setRefMsg('Something went wrong.'); }
    finally { setRefLoading(false); }
  }


  async function handlePortal() {
    try {
      const res  = await fetch('/api/tokens/portal', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not open billing portal.');
      window.location.href = data.url;
    } catch (err) {
      setToast(err.message);
      setTimeout(() => setToast(null), 4000);
    }
  }

  const tokens      = session?.user?.tokens ?? 0;
  const tokenColor  = tokens === 0 ? C.red : tokens <= 2 ? C.amber : C.green;

  return (
    <>
      <Head>
        <title>Dashboard - RentalIQ</title>
        <meta name="viewport" content="width=device-width, initial-scale=1"/>
      </Head>
      <style>{`
        *{box-sizing:border-box;margin:0;padding:0}
        body{background:${C.bg};font-family:'DM Sans',system-ui,sans-serif}
        @keyframes fadeup{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes slidein{from{opacity:0;transform:translateY(-16px)}to{opacity:1;transform:translateY(0)}}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.45}}
        a{color:inherit;text-decoration:none}
        @media(max-width:600px){
          .dash-grid{grid-template-columns:1fr!important}
          .dash-deal-grid{grid-template-columns:1fr 1fr!important}
        }
      `}</style>

      {/* Toast */}
      {toast && (
        <div style={{position:'fixed',top:20,left:'50%',transform:'translateX(-50%)',zIndex:300,background:C.text,color:'#fff',borderRadius:10,padding:'12px 20px',fontSize:13.5,fontWeight:600,boxShadow:C.shadowLg,animation:'slidein 0.3s ease',whiteSpace:'nowrap'}}>
          {toast}
        </div>
      )}

      {showPurchase && (
        <TokenPurchaseModal onClose={() => setShowPurchase(false)} onSuccess={() => { setShowPurchase(false); updateSession(); }}/>
      )}

      <div style={{background:C.bg,minHeight:'100vh'}}>

        {/* Nav */}
        <nav style={{position:'sticky',top:0,zIndex:100,background:'rgba(245,245,248,0.88)',backdropFilter:'blur(12px)',borderBottom:`1px solid ${C.border}`,padding:'0 32px'}}>
          <div style={{maxWidth:1080,margin:'0 auto',display:'flex',alignItems:'center',justifyContent:'space-between',height:52}}>
            <div style={{display:'flex',alignItems:'center',gap:16}}>
              <Link href="/" style={{display:'flex',alignItems:'center',textDecoration:'none'}}>
                
                <span style={{fontSize:16,fontWeight:700,letterSpacing:'-0.01em',color:C.text}}>RentalIQ</span>
              </Link>
              <div style={{display:'inline-flex',background:C.soft,borderRadius:10,padding:3,gap:3}}>
                <Link href="/analyze" style={{display:'block',padding:'5px 14px',borderRadius:8,fontSize:12.5,fontWeight:600,color:C.muted,textDecoration:'none',transition:'color 0.15s'}}>
                  Analyze
                </Link>
                <Link href="/scout" style={{display:'block',padding:'5px 14px',borderRadius:8,fontSize:12.5,fontWeight:600,color:C.muted,textDecoration:'none',transition:'color 0.15s'}}>
                  Scout
                </Link>
                <span style={{display:'block',padding:'5px 14px',borderRadius:8,background:C.white,fontSize:12.5,fontWeight:700,color:C.text,boxShadow:C.shadowSm}}>
                  My Deals
                </span>
              </div>
            </div>
            <div style={{display:'flex',alignItems:'center',gap:10}}>
              {/* Token badge */}
              <button onClick={() => setShowPurchase(true)} style={{display:'flex',alignItems:'center',gap:6,background:C.white,border:`1px solid ${C.border}`,borderRadius:8,padding:'6px 12px',cursor:'pointer',fontFamily:'inherit',transition:'border-color 0.15s'}}
                onMouseEnter={e=>e.currentTarget.style.borderColor=C.text}
                onMouseLeave={e=>e.currentTarget.style.borderColor=C.border}>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <circle cx="7" cy="7" r="6" stroke={tokenColor} strokeWidth="1.5"/>
                  <path d="M7 4v3l2 1.5" stroke={tokenColor} strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
                <span style={{fontSize:12.5,fontWeight:700,color:tokenColor}}>{tokens}</span>
                <span style={{fontSize:11,color:C.muted}}>token{tokens !== 1 ? 's' : ''}</span>
                <span style={{fontSize:10,color:C.muted,marginLeft:2}}>+ Add</span>
              </button>
              {/* User menu */}
              <button onClick={() => signOut({ callbackUrl: '/' })} style={{fontSize:12,color:C.muted,background:'none',border:`1px solid ${C.border}`,borderRadius:8,padding:'6px 12px',cursor:'pointer',fontFamily:'inherit'}}>
                Sign out
              </button>
            </div>
          </div>
        </nav>

        <div style={{maxWidth:720,margin:'0 auto',padding:'40px 20px 80px'}}>

          {/* Header */}
          <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',marginBottom:32,gap:16,flexWrap:'wrap'}}>
            <div>
              <h1 style={{fontFamily:"'Libre Baskerville',Georgia,serif",fontSize:28,fontWeight:700,color:C.text,marginBottom:6,letterSpacing:'-0.02em'}}>
                My Deals
              </h1>
              <p style={{fontSize:13.5,color:C.muted}}>
                {session.user.name || session.user.email}
                {' · '}
                <span style={{color:tokenColor,fontWeight:600}}>{tokens} token{tokens !== 1 ? 's' : ''} remaining</span>
              </p>
            </div>
            <div style={{display:'flex',gap:10}}>
              <button onClick={() => setShowPurchase(true)} style={{background:C.green,color:'#fff',border:'none',borderRadius:10,padding:'11px 20px',fontSize:13.5,fontWeight:700,cursor:'pointer',fontFamily:'inherit',letterSpacing:'-0.01em'}}>
                Buy Tokens
              </button>
              <Link href="/analyze" style={{display:'inline-flex',alignItems:'center',background:C.white,color:C.text,border:`1.5px solid ${C.border}`,borderRadius:10,padding:'11px 20px',fontSize:13.5,fontWeight:600,letterSpacing:'-0.01em'}}>
                + New Analysis
              </Link>
            </div>
          </div>

          {/* Token banner when empty */}
          {tokens === 0 && (
            <div style={{background:C.redBg,border:`1.5px solid ${C.redBorder}`,borderRadius:14,padding:'16px 20px',marginBottom:24,display:'flex',alignItems:'center',justifyContent:'space-between',gap:16,flexWrap:'wrap'}}>
              <div>
                <div style={{fontSize:14,fontWeight:700,color:C.red,marginBottom:2}}>You're out of tokens</div>
                <div style={{fontSize:13,color:C.red,opacity:0.8}}>Purchase tokens to run more analyses.</div>
              </div>
              <button onClick={() => setShowPurchase(true)} style={{background:C.red,color:'#fff',border:'none',borderRadius:10,padding:'10px 18px',fontSize:13,fontWeight:700,cursor:'pointer',fontFamily:'inherit',whiteSpace:'nowrap',flexShrink:0}}>
                Buy Tokens →
              </button>
            </div>
          )}

          {/* Low token nudge */}
          {tokens > 0 && tokens <= 2 && (
            <div style={{background:C.amberBg,border:`1px solid ${C.amberBorder}`,borderRadius:12,padding:'13px 18px',marginBottom:20,display:'flex',alignItems:'center',justifyContent:'space-between',gap:12,flexWrap:'wrap'}}>
              <div style={{fontSize:13,color:C.amber,fontWeight:600}}>
                {tokens === 1 ? 'Last token remaining' : `Only ${tokens} tokens left`} - stock up to keep analyzing.
              </div>
              <button onClick={() => setShowPurchase(true)} style={{background:'none',border:`1px solid ${C.amberBorder}`,borderRadius:8,padding:'7px 14px',fontSize:12.5,fontWeight:600,color:C.amber,cursor:'pointer',fontFamily:'inherit',whiteSpace:'nowrap',flexShrink:0}}>
                Buy Tokens
              </button>
            </div>
          )}

          {/* Investor profile summary - shows saved preferences */}
          {savedProfile && (
            <div style={{background:C.white,border:`1px solid ${C.border}`,borderRadius:14,padding:'16px 20px',marginBottom:20,boxShadow:C.shadowSm}}>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:10}}>
                <div style={{fontSize:10,fontWeight:700,letterSpacing:'0.12em',textTransform:'uppercase',color:C.muted}}>Your Investor Profile</div>
                <Link href="/analyze" style={{fontSize:11.5,color:C.green,fontWeight:600,textDecoration:'none'}}>
                  Edit profile →
                </Link>
              </div>
              <div style={{display:'flex',flexWrap:'wrap',gap:6}}>
                {[
                  savedProfile.cashPurchase ? 'All Cash' : `${savedProfile.downPaymentPct||20}% down @ ${savedProfile.interestRate||7.25}%`,
                  savedProfile.cashPurchase ? null : ({
                    '30yr_fixed':'30yr Fixed','15yr_fixed':'15yr Fixed',
                    '5_1_arm':'5/1 ARM','interest_only':'Interest-Only',
                  }[savedProfile.loanType||'30yr_fixed']),
                  `${savedProfile.holdingYears||5}yr hold`,
                  {cashflow:'Income-Focused',appreciation:'Appreciation',balanced:'Balanced Return',tax:'Tax & Equity'}[savedProfile.goal]||savedProfile.goal,
                ].filter(Boolean).map((tag,i)=>(
                  <span key={i} style={{fontSize:11.5,fontWeight:500,color:C.text,background:C.soft,border:`1px solid ${C.border}`,borderRadius:100,padding:'3px 10px'}}>
                    {tag}
                  </span>
                ))}
              </div>
              <p style={{fontSize:11.5,color:C.muted,margin:'10px 0 0',lineHeight:1.5}}>
                These settings pre-fill every new analysis. All your deal scores reflect this profile.
              </p>
            </div>
          )}

          {/* Deals grid */}
          {dealsLoading ? (
            <div style={{display:'flex',flexDirection:'column',gap:10}}>
              {[0,1,2].map(i=>(
                <div key={i} style={{background:C.white,border:`1px solid ${C.border}`,borderRadius:14,padding:'18px 20px',
                  opacity:1-i*0.25,animation:'pulse 1.5s ease-in-out infinite',animationDelay:`${i*0.18}s`}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14}}>
                    <div>
                      <div style={{height:13,width:200,background:C.soft,borderRadius:6,marginBottom:6}}/>
                      <div style={{height:10,width:120,background:C.soft,borderRadius:5}}/>
                    </div>
                    <div style={{width:36,height:20,background:C.soft,borderRadius:6}}/>
                  </div>
                  <div className="dash-deal-grid" style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:8}}>
                    {[0,1,2,3,4,5].map(j=>(
                      <div key={j} style={{background:C.soft,borderRadius:8,padding:'10px 12px'}}>
                        <div style={{height:8,width:'60%',background:C.border,borderRadius:4,marginBottom:6}}/>
                        <div style={{height:16,width:'80%',background:C.border,borderRadius:4}}/>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : deals.length === 0 ? (
            <EmptyDeals/>
          ) : (
            <>
            {deals.length >= 2 && selectedDeals.size < 2 && (
              <div style={{fontSize:12.5,color:C.muted,marginBottom:10,display:'flex',alignItems:'center',gap:6}}>
                <span style={{fontSize:14}}>⊞</span> Tip: select 2+ deals to <strong style={{color:C.text}}>compare side-by-side</strong>
              </div>
            )}
            {selectedDeals.size >= 2 && (
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',background:C.greenBg,border:`1px solid ${C.greenBorder}`,borderRadius:12,padding:'12px 16px',marginBottom:10,gap:12,flexWrap:'wrap'}}>
                <span style={{fontSize:13.5,fontWeight:600,color:C.green}}>{selectedDeals.size} deals selected</span>
                <div style={{display:'flex',gap:8}}>
                  <button
                    onClick={() => router.push('/compare?ids=' + Array.from(selectedDeals).join(','))}
                    style={{fontSize:13,fontWeight:700,color:'#fff',background:C.green,border:'none',borderRadius:8,padding:'8px 18px',cursor:'pointer',fontFamily:'inherit'}}>
                    Compare Side-by-Side →
                  </button>
                  <button
                    onClick={() => setSelectedDeals(new Set())}
                    style={{fontSize:12,color:C.muted,background:'none',border:`1px solid ${C.border}`,borderRadius:8,padding:'8px 12px',cursor:'pointer',fontFamily:'inherit'}}>
                    Clear
                  </button>
                </div>
              </div>
            )}
            <div style={{display:'flex',flexDirection:'column',gap:10}}>
              {deals.map(deal => {
                const vc = VERDICT_CFG[deal.verdict?.toUpperCase()] || VERDICT_CFG.MAYBE;
                const date = new Date(deal.created_at).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' });
                return (
                  <div key={deal.id} style={{position:'relative'}}>
                  {/* Select checkbox - top-left corner */}
                  <button
                    onClick={() => toggleSelect(deal.id)}
                    title={selectedDeals.has(deal.id) ? 'Deselect' : 'Select for comparison'}
                    style={{
                      position:'absolute',top:10,left:10,zIndex:2,
                      width:22,height:22,borderRadius:6,border:`2px solid ${selectedDeals.has(deal.id)?C.green:C.border}`,
                      background:selectedDeals.has(deal.id)?C.green:C.white,
                      cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',
                      transition:'all 0.15s',flexShrink:0,
                    }}>
                    {selectedDeals.has(deal.id) && (
                      <svg width="11" height="9" viewBox="0 0 11 9" fill="none">
                        <path d="M1 4.5L4 7.5L10 1" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    )}
                  </button>
                  <Link
                    href={`/analyze?deal=${deal.id}`}
                    style={{display:'block',background:C.white,border:`1px solid ${selectedDeals.has(deal.id)?C.green:C.border}`,borderRadius:14,padding:'18px 20px 16px 40px',boxShadow:selectedDeals.has(deal.id)?`0 0 0 3px ${C.greenBg}`:C.shadowSm,transition:'border-color 0.15s, box-shadow 0.15s',borderLeft:`4px solid ${vc.color}`}}
                    onMouseEnter={e=>{if(!selectedDeals.has(deal.id)){e.currentTarget.style.borderColor=vc.color;e.currentTarget.style.boxShadow=C.shadow;}}}
                    onMouseLeave={e=>{if(!selectedDeals.has(deal.id)){e.currentTarget.style.borderColor=C.border;e.currentTarget.style.boxShadow=C.shadowSm;}}}>

                    {/* Top row: verdict badge + address + score */}
                    <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:12,marginBottom:12}}>
                      <div style={{minWidth:0,flex:1}}>
                        <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:4,flexWrap:'wrap'}}>
                          <VerdictBadge verdict={deal.verdict}/>
                          <span style={{fontSize:13.5,fontWeight:600,color:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{deal.address}</span>
                        </div>
                        <div style={{fontSize:11.5,color:C.muted}}>{date}</div>
                      </div>
                      <ScoreDot score={deal.score}/>
                    </div>

                    {/* Headline metrics grid */}
                    <div className="dash-deal-grid" style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:8}}>
                      {[
                        {label:'Price',    value:deal.price,    highlight:false},
                        {label:'Cash Flow',value:deal.cashflow ? deal.cashflow+'/mo' : null, highlight:true,
                          color: deal.cashflow ? (deal.cashflow.startsWith('-')?C.red:C.green) : C.muted},
                        {label:'CoC',      value:deal.coc,      highlight:true,
                          color: deal.coc ? (deal.coc.startsWith('-')?C.red:parseFloat(deal.coc)>=10?C.green:C.amber) : C.muted},
                        {label:'Rent',     value:deal.rent,     highlight:false},
                        {label:'Cap Rate', value:deal.cap_rate, highlight:false},
                        {label:'DSCR',     value:deal.dscr,     highlight:false,
                          color: deal.dscr && deal.dscr!=='N/A' ? (parseFloat(deal.dscr)>=1.25?C.green:parseFloat(deal.dscr)>=1.0?C.amber:C.red) : C.muted},
                      ].map((m,i)=>(
                        <div key={i} style={{background:C.soft,borderRadius:8,padding:'8px 10px'}}>
                          <div style={{fontSize:9.5,fontWeight:600,letterSpacing:'0.08em',textTransform:'uppercase',color:C.muted,marginBottom:3}}>{m.label}</div>
                          <div style={{fontSize:m.highlight?15:13,fontWeight:m.highlight?700:500,color:m.color||C.text,fontFamily:m.highlight?"'Instrument Serif',Georgia,serif":'inherit',lineHeight:1}}>
                            {m.value || <span style={{color:C.border}}>-</span>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </Link>
                  <div style={{display:'flex',gap:6,marginTop:6}}>
                    <button onClick={()=>handleShareDeal(deal.id)}
                      style={{flex:1,fontSize:11.5,fontWeight:600,color:copiedId===deal.id?C.green:C.muted,background:copiedId===deal.id?C.greenBg:C.soft,border:`1px solid ${copiedId===deal.id?C.greenBorder:C.border}`,borderRadius:8,padding:'6px 0',cursor:'pointer',fontFamily:'inherit',transition:'all 0.15s'}}>
                      {sharingId===deal.id?'...':copiedId===deal.id?'✓ Copied':'🔗 Share'}
                    </button>
                    <button onClick={()=>handleDelete(deal.id)}
                      onBlur={()=>{ if(confirmDeleteId===deal.id) setTimeout(()=>setConfirmDeleteId(null),200); }}
                      style={{flex:1,fontSize:11.5,fontWeight:600,
                        color:deletingId===deal.id?C.muted:confirmDeleteId===deal.id?C.red:C.muted,
                        background:deletingId===deal.id?C.redBg:confirmDeleteId===deal.id?C.redBg:C.soft,
                        border:`1px solid ${deletingId===deal.id||confirmDeleteId===deal.id?C.redBorder:C.border}`,
                        borderRadius:8,padding:'6px 0',cursor:'pointer',fontFamily:'inherit',transition:'all 0.15s'}}>
                      {deletingId===deal.id?'Removing...':confirmDeleteId===deal.id?'Confirm remove':'✕ Remove'}
                    </button>
                  </div>
                  </div>
                );
              })}
            </div>
            </>
          )}

          {/* -- Billing portal ------------------------------------------------- */}
          <div style={{marginTop:32,display:'flex',justifyContent:'flex-end'}}>
            <button onClick={handlePortal}
              style={{fontSize:12,color:C.muted,background:'none',border:`1px solid ${C.border}`,
                borderRadius:8,padding:'6px 14px',cursor:'pointer',fontFamily:'inherit',
                transition:'border-color 0.15s,color 0.15s'}}
              onMouseEnter={e=>{e.currentTarget.style.borderColor=C.text;e.currentTarget.style.color=C.text;}}
              onMouseLeave={e=>{e.currentTarget.style.borderColor=C.border;e.currentTarget.style.color=C.muted;}}>
              Manage billing &amp; receipts →
            </button>
          </div>

          {/* -- Referral section ------------------------------------------------ */}
          <div style={{marginTop:32}}>
            <div style={{fontSize:10,fontWeight:700,letterSpacing:'0.12em',textTransform:'uppercase',color:C.muted,marginBottom:16}}>Refer a Friend</div>

          {/* My referral link + live stats */}
          {refCode && (
            <div style={{background:C.white,border:`1px solid ${C.border}`,borderRadius:14,padding:'20px 22px',marginBottom:12,boxShadow:C.shadow}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:12,flexWrap:'wrap',marginBottom:4}}>
                <div style={{fontSize:13.5,fontWeight:600,color:C.text}}>Your referral link</div>
                {/* Live claim counter - gives users the feedback loop they need */}
                {refStats !== null && (
                  <div style={{display:'flex',gap:8,flexShrink:0}}>
                    <div style={{textAlign:'center',background:refStats.claimCount>0?C.greenBg:C.soft,border:`1px solid ${refStats.claimCount>0?C.greenBorder:C.border}`,borderRadius:9,padding:'6px 14px'}}>
                      <div style={{fontSize:18,fontWeight:700,color:refStats.claimCount>0?C.green:C.muted,lineHeight:1}}>{refStats.claimCount}</div>
                      <div style={{fontSize:9,fontWeight:600,letterSpacing:'0.08em',textTransform:'uppercase',color:C.muted,marginTop:2}}>
                        {refStats.claimCount === 1 ? 'person referred' : 'people referred'}
                      </div>
                    </div>
                    <div style={{textAlign:'center',background:refStats.tokensEarned>0?C.greenBg:C.soft,border:`1px solid ${refStats.tokensEarned>0?C.greenBorder:C.border}`,borderRadius:9,padding:'6px 14px'}}>
                      <div style={{fontSize:18,fontWeight:700,color:refStats.tokensEarned>0?C.green:C.muted,lineHeight:1}}>+{refStats.tokensEarned}</div>
                      <div style={{fontSize:9,fontWeight:600,letterSpacing:'0.08em',textTransform:'uppercase',color:C.muted,marginTop:2}}>tokens earned</div>
                    </div>
                  </div>
                )}
              </div>
              <div style={{fontSize:12.5,color:C.muted,marginBottom:14,lineHeight:1.5}}>
                Share this link. When someone signs up and runs their first analysis, you both get +1 free token.
              </div>
              <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
                <div style={{flex:1,background:C.soft,borderRadius:9,padding:'9px 14px',fontSize:12.5,color:C.text,fontFamily:'monospace',minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                  {(typeof window !== 'undefined' ? window.location.origin : '') + '?ref=' + refCode}
                </div>
                <button onClick={copyRefLink}
                  style={{fontSize:12.5,fontWeight:700,color:copied?C.green:C.text,background:copied?C.greenBg:C.white,border:`1px solid ${copied?C.greenBorder:C.border}`,borderRadius:9,padding:'9px 16px',cursor:'pointer',fontFamily:'inherit',flexShrink:0,transition:'all 0.2s'}}>
                  {copied ? '✓ Copied' : 'Copy Link'}
                </button>
              </div>
              <div style={{marginTop:10,fontSize:12,color:C.muted}}>
                Your code: <strong style={{color:C.text,letterSpacing:'0.08em'}}>{refCode}</strong>
                {refStats?.claimCount === 0 && (
                  <span style={{marginLeft:8,color:C.muted,fontStyle:'italic'}}>No claims yet — share to earn tokens</span>
                )}
              </div>
            </div>
          )}

          {/* Claim someone else's code */}
          <div style={{background:C.white,border:`1px solid ${C.border}`,borderRadius:14,padding:'20px 22px',boxShadow:C.shadow}}>
            <div style={{fontSize:13.5,fontWeight:600,color:C.text,marginBottom:4}}>Have a referral code?</div>
            <div style={{fontSize:12.5,color:C.muted,marginBottom:14}}>Enter it below and you'll both get +1 token.</div>
            <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
              <input
                value={refInput}
                onChange={e => setRefInput(e.target.value.toUpperCase())}
                placeholder="ENTER CODE"
                maxLength={8}
                style={{flex:1,background:C.soft,border:`1.5px solid ${C.border}`,borderRadius:9,padding:'9px 14px',fontSize:14,fontFamily:'monospace',letterSpacing:'0.1em',color:C.text,outline:'none',minWidth:120}}
              />
              <button onClick={handleClaim} disabled={refLoading || !refInput.trim()}
                style={{background:refLoading||!refInput.trim()?C.soft:C.green,color:refLoading||!refInput.trim()?C.muted:'#fff',border:'none',borderRadius:9,padding:'9px 20px',fontSize:13.5,fontWeight:700,cursor:refLoading||!refInput.trim()?'default':'pointer',fontFamily:'inherit',flexShrink:0,transition:'all 0.2s'}}>
                {refLoading ? 'Claiming...' : 'Claim +1 Token'}
              </button>
            </div>
            {refMsg && (
              <div style={{marginTop:10,fontSize:12.5,color:refMsg.includes('Claimed')||refMsg.includes('token')?C.green:C.red,fontWeight:500}}>
                {refMsg}
              </div>
            )}
          </div>
          </div>

        </div>
      </div>
    </>
  );
}
