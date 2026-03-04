import Head from 'next/head';
import Link from 'next/link';
import { useState, useEffect, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/router';
import { TOKEN_PACKAGES } from '../lib/tokenPackages';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://rentaliq.app';

// ── Design tokens ─────────────────────────────────────────────────────────────
const C = {
  bg:'#f5f5f8', white:'#ffffff', border:'#dddde4', text:'#0d0d0f', muted:'#72727a', soft:'#eaeaef',
  green:'#166638', greenBg:'#ecf6f1', greenBorder:'#96ccb0',
  red:'#a62626', redBg:'#fdf0f0', redBorder:'#e0aaaa',
  amber:'#8a5800', amberBg:'#fdf4e8', amberBorder:'#dfc070',
  shadow:'0 1px 2px rgba(0,0,0,0.05),0 2px 12px rgba(0,0,0,0.06)',
  shadowLg:'0 12px 48px rgba(0,0,0,0.11),0 2px 8px rgba(0,0,0,0.05)',
};

// ── Score bar ─────────────────────────────────────────────────────────────────
function ScoreBar({ score, delay = 0, run }) {
  const [w, setW] = useState(0);
  useEffect(() => {
    if (!run) return;
    const t = setTimeout(() => setW(score), delay);
    return () => clearTimeout(t);
  }, [run, score, delay]);
  const col = score >= 68 ? C.green : score >= 45 ? C.amber : C.red;
  return (
    <div style={{ display:'flex', alignItems:'center', gap:8 }}>
      <div style={{ flex:1, height:5, background:C.soft, borderRadius:3, overflow:'hidden' }}>
        <div style={{ width:`${w}%`, height:'100%', background:col, borderRadius:3, transition:`width 1.1s cubic-bezier(.4,0,.2,1) ${delay}ms` }}/>
      </div>
      <span style={{ fontSize:11, fontWeight:700, color:col, minWidth:22, textAlign:'right' }}>{score}</span>
    </div>
  );
}

// ── Intersection observer hook ────────────────────────────────────────────────
function useVisible(threshold = 0.1) {
  const ref = useRef(null);
  const [v, setV] = useState(false);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    // rootMargin bottom extension ensures that when the user anchor-scrolls
    // directly to a section, the observer fires even if the section enters
    // at the very bottom of the viewport during the scroll.
    const obs = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) { setV(true); obs.disconnect(); } },
      { threshold, rootMargin: '0px 0px -40px 0px' }
    );
    obs.observe(el);
    // Also check immediately in case already in view (e.g. after anchor nav)
    const rect = el.getBoundingClientRect();
    if (rect.top < window.innerHeight - 40) { setV(true); obs.disconnect(); }
    return () => obs.disconnect();
  }, [threshold]);
  return [ref, v];
}

// ── Counter animation ─────────────────────────────────────────────────────────
function Counter({ to, prefix='', suffix='', run, duration=1400 }) {
  const [val, setVal] = useState(0);
  useEffect(() => {
    if (!run) return;
    const start = performance.now();
    const tick = (now) => {
      const p = Math.min((now - start) / duration, 1);
      const ease = 1 - Math.pow(1 - p, 3);
      setVal(Math.round(ease * to));
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, [run, to, duration]);
  return <span>{prefix}{val.toLocaleString()}{suffix}</span>;
}

// ── Mock result card ──────────────────────────────────────────────────────────
function MockCard({ run }) {
  return (
    <div style={{ fontFamily:"'DM Sans',system-ui,sans-serif", width:'100%', userSelect:'none', pointerEvents:'none' }}>

      {/* Top: verdict + score */}
      <div style={{
        background:C.white, border:`1.5px solid ${C.greenBorder}`,
        borderRadius:20, padding:'22px 24px', marginBottom:10,
        boxShadow:C.shadowLg,
      }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:16 }}>
          <div>
            <div style={{ fontSize:10, fontWeight:700, letterSpacing:'0.12em', textTransform:'uppercase', color:C.muted, marginBottom:5 }}>AI Verdict</div>
            <div style={{ fontSize:44, fontWeight:800, color:C.green, letterSpacing:'-0.04em', lineHeight:1 }}>BUY</div>
          </div>
          <div style={{ textAlign:'right' }}>
            <div style={{ fontSize:10, color:C.muted, textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:3 }}>Score</div>
            <div style={{ fontSize:44, fontWeight:700, color:C.green, letterSpacing:'-0.04em', lineHeight:1 }}>
              <Counter to={74} run={run}/>
              <span style={{ fontSize:15, color:C.muted, fontWeight:400 }}>/100</span>
            </div>
          </div>
        </div>
        <div style={{ fontSize:12.5, color:C.muted, marginBottom:16, letterSpacing:'-0.01em' }}>
          3412 Denison Ave · Cleveland, OH · $129,000
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:7 }}>
          {[
            ['Cash Flow', run ? '+$187/mo' : '—', C.green],
            ['CoC Return', run ? '+8.4%' : '—', C.green],
            ['Cap Rate', '7.2%', C.text],
            ['DSCR', '1.31', C.text],
          ].map(([l,v,col]) => (
            <div key={l} style={{ background:C.soft, borderRadius:10, padding:'10px 7px', textAlign:'center' }}>
              <div style={{ fontSize:8.5, color:C.muted, fontWeight:600, textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:4 }}>{l}</div>
              <div style={{
                fontSize:13.5, fontWeight:700, color:col,
                transition:'color 0.4s',
                opacity: run ? 1 : 0.3,
              }}>{v}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Middle: scores + expenses */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:10 }}>
        <div style={{ background:C.white, border:`1px solid ${C.border}`, borderRadius:14, padding:'15px 17px', boxShadow:C.shadow }}>
          <div style={{ fontSize:9, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.1em', color:C.muted, marginBottom:11 }}>Score Breakdown</div>
          <div style={{ display:'flex', flexDirection:'column', gap:9 }}>
            {[
              { name:'Cash Flow',    score:78 },
              { name:'Location',     score:61 },
              { name:'Market Growth',score:68 },
              { name:'1% Rule',      score:82 },
              { name:'Landlord Laws',score:72 },
            ].map((s, i) => (
              <div key={s.name}>
                <div style={{ fontSize:10.5, color:C.muted, marginBottom:2 }}>{s.name}</div>
                <ScoreBar score={s.score} run={run} delay={i * 120}/>
              </div>
            ))}
          </div>
        </div>
        <div style={{ background:C.white, border:`1px solid ${C.border}`, borderRadius:14, padding:'15px 17px', boxShadow:C.shadow }}>
          <div style={{ fontSize:9, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.1em', color:C.muted, marginBottom:11 }}>Monthly Expenses</div>
          <div style={{ display:'flex', flexDirection:'column', gap:5 }}>
            {[
              ['Mortgage',    '$612'],
              ['Property Tax','$175'],
              ['Insurance',   '$81'],
              ['Vacancy (8%)','$108'],
              ['Mgmt (10%)', '$135'],
              ['Maintenance', '$100'],
              ['CapEx',       '$150'],
            ].map(([l,v]) => (
              <div key={l} style={{ display:'flex', justifyContent:'space-between', fontSize:11 }}>
                <span style={{ color:C.muted }}>{l}</span>
                <span style={{ fontWeight:600, color:C.text }}>{v}</span>
              </div>
            ))}
            <div style={{ borderTop:`1px solid ${C.border}`, marginTop:4, paddingTop:5, display:'flex', justifyContent:'space-between', fontSize:12 }}>
              <span style={{ fontWeight:700, color:C.green }}>Cash Flow</span>
              <span style={{ fontWeight:700, color:C.green }}>+$187/mo</span>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom: pros/cons */}
      <div style={{ background:C.white, border:`1px solid ${C.border}`, borderRadius:14, padding:'15px 17px', boxShadow:C.shadow }}>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>
          <div>
            <div style={{ fontSize:9, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.1em', color:C.green, marginBottom:9 }}>Strengths</div>
            {['Clears $150/mo cash flow threshold','DSCR 1.31 — solid lender coverage','Passes the 1% rule at 1.05%'].map((p,i) => (
              <div key={i} style={{ fontSize:11, display:'flex', gap:5, marginBottom:6, lineHeight:1.4, color:C.text }}>
                <span style={{ color:C.green, fontWeight:700, flexShrink:0 }}>+</span><span>{p}</span>
              </div>
            ))}
          </div>
          <div>
            <div style={{ fontSize:9, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.1em', color:C.red, marginBottom:9 }}>Risks</div>
            {['1958 build — reserve for capex','Lead inspection required at sale'].map((c,i) => (
              <div key={i} style={{ fontSize:11, display:'flex', gap:5, marginBottom:6, lineHeight:1.4, color:C.text }}>
                <span style={{ color:C.red, fontWeight:700, flexShrink:0 }}>−</span><span>{c}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── FAQ accordion item ────────────────────────────────────────────────────────
function FaqItem({ q, a }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{
      borderBottom:`1px solid ${C.border}`,
      overflow:'hidden',
    }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width:'100%', textAlign:'left', padding:'20px 0', cursor:'pointer',
          background:'none', border:'none', fontFamily:'inherit',
          display:'flex', justifyContent:'space-between', alignItems:'center', gap:16,
        }}
      >
        <span style={{ fontSize:15.5, fontWeight:700, color:C.text, letterSpacing:'-0.01em', lineHeight:1.4 }}>{q}</span>
        <svg
          width="18" height="18" viewBox="0 0 18 18" fill="none"
          style={{ flexShrink:0, transform: open ? 'rotate(180deg)' : 'none', transition:'transform .2s ease' }}
        >
          <path d="M4 6.5l5 5 5-5" stroke={C.muted} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>
      <div style={{
        maxHeight: open ? 400 : 0,
        overflow:'hidden',
        transition:'max-height .28s cubic-bezier(.4,0,.2,1)',
      }}>
        <p style={{ fontSize:14, color:C.muted, lineHeight:1.75, paddingBottom:20, margin:0 }}>{a}</p>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function LandingPage() {
  const { status } = useSession();
  const router = useRouter();

  // ── Store incoming referral code before it's lost to navigation ───────────
  useEffect(() => {
    if (!router.isReady) return;
    const refCode = router.query.ref;
    if (refCode && typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem('pendingRef', String(refCode).toUpperCase().trim());
    }
  }, [router.isReady, router.query.ref]);

  // ── Authenticated returning users go straight to the analyzer ────────────
  useEffect(() => {
    if (status === 'authenticated') {
      router.replace('/analyze');
    }
  }, [status, router]);

  // ── Section visibility ────────────────────────────────────────────────────
  const [heroRef,    heroV]    = useVisible(0.05);
  const [howRef,     howV]     = useVisible(0.05);
  const [demoRef,    demoV]    = useVisible(0.05);
  const [whoRef,     whoV]     = useVisible(0.05);
  const [pricingRef, pricingV] = useVisible(0.05);
  const [ctaRef,     ctaV]     = useVisible(0.1);
  const [socialRef,  socialV]  = useVisible(0.05);
  const [compareRef, compareV] = useVisible(0.05);
  const [faqRef,     faqV]     = useVisible(0.05);

  // ── Hero card animation fires after hero enters ───────────────────────────
  const [cardRun, setCardRun] = useState(false);
  useEffect(() => {
    if (heroV) { const t = setTimeout(() => setCardRun(true), 500); return () => clearTimeout(t); }
  }, [heroV]);

  // Show blank while auth redirecting to avoid flash
  if (status === 'authenticated') {
    return <div style={{ minHeight:'100vh', background:C.bg }}/>;
  }

  return (
    <>
      <Head>
        <title>RentalIQ — Does the deal cash flow?</title>
        <meta name="description" content="Paste any Zillow, Redfin, or Realtor.com listing. Get cap rate, cash flow, wealth projection, and a buy/pass verdict in seconds."/>
        <link rel="canonical" href={`${APP_URL}/`}/>
        <meta property="og:title" content="RentalIQ — Does the deal cash flow?"/>
        <meta property="og:description" content="AI-powered rental property analysis. Cap rate, cash flow, and a buy/pass verdict in seconds."/>
        <meta property="og:image" content={`${APP_URL}/og-image.png`}/>
        <meta property="og:url" content={`${APP_URL}/`}/>
        <meta property="og:type" content="website"/>
        <meta name="twitter:card" content="summary_large_image"/>
        <meta name="viewport" content="width=device-width,initial-scale=1"/>
      </Head>

      <style>{`
        html { scroll-behavior: smooth }
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0 }
        body {
          background: ${C.bg};
          font-family: 'DM Sans', system-ui, sans-serif;
          color: ${C.text};
          -webkit-font-smoothing: antialiased;
        }

        /* ── Keyframes ── */
        @keyframes fadeup   { from { opacity:0; transform:translateY(28px) } to { opacity:1; transform:translateY(0) } }
        @keyframes fadein   { from { opacity:0 } to { opacity:1 } }
        @keyframes pulse-dot{ 0%,100%{transform:scale(1);opacity:1} 50%{transform:scale(.7);opacity:.5} }
        @keyframes floatcard{ 0%,100%{transform:rotate(1.5deg) translateY(0)} 50%{transform:rotate(1.5deg) translateY(-10px)} }

        /* ── Respect reduced-motion preference ── */
        @media (prefers-reduced-motion: reduce) {
          *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
          .reveal { opacity:1 !important; transform:none !important; }
        }

        /* ── Focus visible for keyboard nav ── */
        .btn-primary:focus-visible, .btn-ghost:focus-visible, a:focus-visible {
          outline: 2px solid ${C.green}; outline-offset: 3px; border-radius: 4px;
        }

        /* ── Scroll-reveal base ── */
        .reveal            { opacity:0; transform:translateY(32px); transition: opacity .65s ease, transform .65s ease }
        .reveal.up         { opacity:1; transform:none }
        .reveal.d1         { transition-delay:.08s }
        .reveal.d2         { transition-delay:.17s }
        .reveal.d3         { transition-delay:.26s }
        .reveal.d4         { transition-delay:.35s }
        .reveal.d5         { transition-delay:.44s }
        .reveal.d6         { transition-delay:.53s }

        /* ── CTA buttons ── */
        .btn-primary {
          display: inline-flex; align-items: center; gap: 10px;
          background: ${C.green}; color: #fff; text-decoration: none;
          border-radius: 13px; padding: 15px 30px;
          font-size: 15px; font-weight: 700; letter-spacing: -.015em;
          font-family: inherit; border: none; cursor: pointer;
          box-shadow: 0 4px 18px rgba(22,102,56,.30), 0 1px 3px rgba(22,102,56,.15);
          transition: transform .15s ease, box-shadow .15s ease;
          white-space: nowrap;
        }
        .btn-primary:hover  { transform: translateY(-2px); box-shadow: 0 8px 28px rgba(22,102,56,.38), 0 2px 6px rgba(22,102,56,.2) }
        .btn-primary:active { transform: translateY(0) }

        .btn-ghost {
          display: inline-flex; align-items: center; gap: 8px;
          background: ${C.white}; color: ${C.text}; text-decoration: none;
          border: 1.5px solid ${C.border}; border-radius: 13px; padding: 14px 26px;
          font-size: 15px; font-weight: 600; letter-spacing: -.01em;
          font-family: inherit; cursor: pointer;
          transition: border-color .15s ease, transform .15s ease;
          white-space: nowrap;
        }
        .btn-ghost:hover { border-color: ${C.text}; transform: translateY(-2px) }

        /* ── Cards ── */
        .step-card {
          background: ${C.white}; border: 1px solid ${C.border}; border-radius: 18px;
          padding: 30px 26px;
          transition: transform .22s ease, box-shadow .22s ease;
        }
        .step-card:hover { transform: translateY(-6px); box-shadow: 0 20px 56px rgba(0,0,0,.09) }

        .pricing-card {
          background: ${C.white}; border: 1.5px solid ${C.border}; border-radius: 20px;
          padding: 32px 28px; position: relative; overflow: hidden;
          transition: transform .2s ease, box-shadow .2s ease, border-color .2s ease;
        }
        .pricing-card:hover { transform: translateY(-5px); box-shadow: 0 22px 60px rgba(0,0,0,.1) }
        .pricing-card.featured { border-color: ${C.green}; box-shadow: 0 6px 28px rgba(22,102,56,.13) }
        .pricing-card.featured:hover { box-shadow: 0 22px 64px rgba(22,102,56,.2) }

        .feat-card {
          background: ${C.white}; border: 1px solid ${C.border};
          border-radius: 16px; padding: 24px 22px;
          transition: transform .2s ease, box-shadow .2s ease;
        }
        .feat-card:hover { transform: translateY(-4px); box-shadow: 0 14px 40px rgba(0,0,0,.08) }

        /* ── Nav link ── */
        .nav-link {
          font-size: 13px; font-weight: 500; color: ${C.muted}; text-decoration: none;
          padding: 6px 12px; border-radius: 8px;
          transition: color .15s, background .15s;
        }
        .nav-link:hover { color: ${C.text}; background: ${C.soft} }

        /* ── Divider gradient ── */
        .grad-divider {
          height: 1px;
          background: linear-gradient(90deg, transparent, ${C.border} 20%, ${C.border} 80%, transparent);
        }

        /* ── Responsive ── */
        @media (max-width: 960px) {
          .hero-grid   { grid-template-columns: 1fr !important }
          .mock-col    { display: none !important }
          .demo-grid   { grid-template-columns: 1fr !important }
          .demo-mock   { display: none !important }
        }
        @media (max-width: 720px) {
          .how-grid    { grid-template-columns: 1fr !important }
          .pricing-grid{ grid-template-columns: 1fr !important; max-width: 340px !important; margin: 0 auto !important }
          .feat-grid   { grid-template-columns: 1fr 1fr !important }
          .who-grid    { grid-template-columns: 1fr !important }
          .hero-btns   { flex-direction: column !important; align-items: stretch !important }
          .strip-inner { flex-direction: column !important }
          .strip-inner > div { border-right: none !important; border-bottom: 1px solid ${C.border} !important }
          .strip-inner > div:last-child { border-bottom: none !important }
        }
        @media (max-width: 500px) {
          .pad { padding: 64px 20px !important }
          .hero-pad { padding: 60px 20px 52px !important }
          .feat-grid { grid-template-columns: 1fr !important }
        }
      `}</style>

      <div style={{ background:C.bg, minHeight:'100vh' }}>

        {/* ── NAV ──────────────────────────────────────────────────────────── */}
        <nav style={{
          position:'sticky', top:0, zIndex:100,
          background:'rgba(245,245,248,0.92)',
          backdropFilter:'blur(16px)', WebkitBackdropFilter:'blur(16px)',
          borderBottom:`1px solid ${C.border}`,
          padding:'0 32px',
        }}>
          <div style={{ maxWidth:1100, margin:'0 auto', height:54, display:'flex', alignItems:'center', justifyContent:'space-between' }}>
            <Link href="/" style={{ display:'flex', alignItems:'center', gap:8, textDecoration:'none' }}>
              <div style={{ width:9, height:9, background:C.green, borderRadius:'50%', animation:'pulse-dot 2.8s ease-in-out infinite' }}/>
              <span style={{ fontSize:14, fontWeight:700, letterSpacing:'-0.02em', color:C.text }}>RentalIQ</span>
            </Link>
            <div style={{ display:'flex', alignItems:'center', gap:4 }}>
              <a href="#how" className="nav-link">How it works</a>
              <a href="#demo" className="nav-link">Sample</a>
              <a href="#pricing" className="nav-link">Pricing</a>
              <a href="#faq" className="nav-link">FAQ</a>
              <div style={{ width:1, height:20, background:C.border, margin:'0 8px' }}/>
              <Link href="/auth" style={{
                fontSize:13.5, fontWeight:600, color:C.muted,
                textDecoration:'none', padding:'7px 14px', borderRadius:9,
                border:`1.5px solid ${C.border}`, background:C.white,
                transition:'border-color .15s, color .15s',
                letterSpacing:'-0.01em', whiteSpace:'nowrap',
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = C.text; e.currentTarget.style.color = C.text; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.muted; }}>
                Sign in
              </Link>
              <Link href="/analyze" className="btn-primary" style={{
                padding:'8px 18px', fontSize:13.5, borderRadius:10,
                boxShadow:'0 2px 10px rgba(22,102,56,.28)',
              }}>
                Try free →
              </Link>
            </div>
          </div>
        </nav>

        {/* ── HERO ─────────────────────────────────────────────────────────── */}
        <section
          ref={heroRef}
          className="hero-pad"
          style={{ padding:'84px 40px 76px', overflow:'hidden', position:'relative' }}
        >
          {/* Subtle radial glow */}
          <div style={{
            position:'absolute', top:0, left:'50%', transform:'translateX(-50%)',
            width:900, height:500, pointerEvents:'none',
            background:'radial-gradient(ellipse at 50% 0%, rgba(22,102,56,.07) 0%, transparent 65%)',
          }}/>

          <div style={{ maxWidth:1100, margin:'0 auto', position:'relative' }}>
            <div className="hero-grid" style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:72, alignItems:'center' }}>

              {/* Left */}
              <div>
                {/* Eyebrow badge */}
                <div style={{
                  display:'inline-flex', alignItems:'center', gap:8, marginBottom:26,
                  padding:'5px 14px 5px 10px',
                  background:C.white, border:`1px solid ${C.border}`,
                  borderRadius:100, boxShadow:C.shadow,
                  animation:'fadeup .5s ease both',
                }}>
                  <div style={{ width:7, height:7, background:C.green, borderRadius:'50%' }}/>
                  <span style={{ fontSize:11.5, fontWeight:600, letterSpacing:'0.07em', color:C.muted, textTransform:'uppercase' }}>
                    First analysis free · No credit card
                  </span>
                </div>

                <h1 style={{
                  fontFamily:"'Libre Baskerville', Georgia, serif",
                  fontSize:'clamp(40px, 4.5vw, 68px)',
                  fontWeight:700, letterSpacing:'-0.03em', lineHeight:1.04,
                  color:C.text, marginBottom:24,
                  animation:'fadeup .6s ease .06s both',
                }}>
                  Does the deal{' '}
                  <em style={{ color:C.green, fontStyle:'italic', fontWeight:400 }}>cash flow?</em>
                </h1>

                <p style={{
                  fontSize:18, color:C.muted, lineHeight:1.65,
                  maxWidth:460, marginBottom:38,
                  animation:'fadeup .6s ease .12s both',
                }}>
                  Paste any Zillow, Redfin, or Realtor.com link. Get cap rate,
                  cash flow, a 5-year wealth projection, and a buy/pass verdict —
                  grounded in real HUD rent data, not guesses.
                </p>

                <div className="hero-btns" style={{ display:'flex', gap:12, marginBottom:40, animation:'fadeup .6s ease .18s both' }}>
                  <Link href="/analyze" className="btn-primary">
                    Analyze a property free
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  </Link>
                  <a href="#demo" className="btn-ghost">See sample result</a>
                </div>

                {/* Trust signals */}
                <div style={{ display:'flex', flexWrap:'wrap', gap:18, animation:'fadeup .6s ease .24s both' }}>
                  {[
                    'Real HUD & Census rent data',
                    'State-accurate tax & insurance',
                    'No spreadsheet needed',
                  ].map(t => (
                    <div key={t} style={{ display:'flex', alignItems:'center', gap:6, fontSize:12.5, color:C.muted }}>
                      <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M1.5 6.5l3.5 3.5 6.5-7" stroke={C.green} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      {t}
                    </div>
                  ))}
                </div>
              </div>

              {/* Right: animated mock card */}
              <div className="mock-col" style={{
                display:'flex', justifyContent:'center', alignItems:'center',
                animation:'fadein .4s ease .3s both',
              }}>
                <div style={{
                  animation:'floatcard 5s ease-in-out infinite',
                  filter:'drop-shadow(0 28px 56px rgba(0,0,0,.13))',
                  width:'100%', maxWidth:460,
                }}>
                  <MockCard run={cardRun}/>
                </div>
              </div>

            </div>
          </div>
        </section>

        {/* ── METRICS STRIP ────────────────────────────────────────────────── */}
        <div style={{ borderTop:`1px solid ${C.border}`, borderBottom:`1px solid ${C.border}`, background:C.white }}>
          <div className="strip-inner" style={{ maxWidth:1100, margin:'0 auto', padding:'0 32px', display:'flex', justifyContent:'center' }}>
            {[
              ['Cap Rate',          'True asset yield'],
              ['Cash-on-Cash',      'Cash invested return'],
              ['Cash Flow',         'Monthly net income'],
              ['DSCR',              'Lender coverage'],
              ['1% Rule',           'Quick deal filter'],
              ['AI Verdict',        'Buy / Caution / Pass'],
            ].map(([l, d], i, arr) => (
              <div key={l} style={{
                padding:'14px 24px', textAlign:'center',
                borderRight: i < arr.length - 1 ? `1px solid ${C.border}` : 'none',
                flex:1,
              }}>
                <div style={{ fontSize:13, fontWeight:700, color:C.text, marginBottom:2, letterSpacing:'-0.01em' }}>{l}</div>
                <div style={{ fontSize:11, color:C.muted }}>{d}</div>
              </div>
            ))}
          </div>
        </div>

        {/* ── DATA SOURCES STRIP ─────────────────────────────────────────── */}
        <div style={{ borderBottom:`1px solid ${C.border}`, background:C.white, padding:'22px 40px' }}>
          <div style={{ maxWidth:1100, margin:'0 auto' }}>
            <div style={{ display:'flex', flexWrap:'wrap', alignItems:'center', gap:0, justifyContent:'center' }}>
              <span style={{ fontSize:11, fontWeight:600, letterSpacing:'0.1em', textTransform:'uppercase', color:C.muted, marginRight:28, whiteSpace:'nowrap' }}>Data sourced from</span>
              {[
                { name:'FRED / Federal Reserve', abbr:'FRED', sub:'Mortgage rates · Treasury · S&P 500' },
                { name:'HUD SAFMR',               abbr:'HUD',  sub:'ZIP-level fair market rents' },
                { name:'BLS',                     abbr:'BLS',  sub:'Construction PPI · Employment' },
                { name:'Census ACS',              abbr:'Census',sub:'Vacancy · Neighborhood data' },
                { name:'FHFA HPI',                abbr:'FHFA', sub:'State appreciation rates' },
                { name:'FEMA NRI',                abbr:'FEMA', sub:'County flood & climate risk' },
              ].map((src, i, arr) => (
                <div key={src.abbr} style={{
                  display:'flex', alignItems:'center', gap:10,
                  padding:'6px 20px',
                  borderRight: i < arr.length - 1 ? `1px solid ${C.border}` : 'none',
                }}>
                  <div style={{
                    width:36, height:36, borderRadius:9, background:C.soft,
                    border:`1px solid ${C.border}`, display:'flex', alignItems:'center',
                    justifyContent:'center', flexShrink:0,
                  }}>
                    <span style={{ fontSize:9, fontWeight:800, color:C.text, letterSpacing:'0.04em' }}>{src.abbr}</span>
                  </div>
                  <div>
                    <div style={{ fontSize:11.5, fontWeight:600, color:C.text, lineHeight:1.2 }}>{src.name}</div>
                    <div style={{ fontSize:10.5, color:C.muted }}>{src.sub}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── HOW IT WORKS ─────────────────────────────────────────────────── */}
        <section id="how" className="pad" style={{ padding:'96px 40px' }}>
          <div ref={howRef} style={{ maxWidth:1100, margin:'0 auto' }}>

            <div className={`reveal${howV?' up':''}`} style={{ textAlign:'center', marginBottom:60 }}>
              <div style={{ fontSize:11, fontWeight:700, letterSpacing:'0.12em', textTransform:'uppercase', color:C.green, marginBottom:12 }}>How It Works</div>
              <h2 style={{
                fontFamily:"'Libre Baskerville', Georgia, serif",
                fontSize:'clamp(28px, 3.2vw, 44px)',
                fontWeight:700, letterSpacing:'-0.025em', color:C.text, marginBottom:16,
              }}>
                From URL to verdict in three steps
              </h2>
              <p style={{ fontSize:17, color:C.muted, maxWidth:440, margin:'0 auto', lineHeight:1.6 }}>
                No spreadsheets. No finance degree. Paste and go.
              </p>
            </div>

            <div className="how-grid" style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:22 }}>
              {[
                {
                  n:'01',
                  title:'Paste any listing URL',
                  body:'Drop a Zillow, Redfin, or Realtor.com link. The address is parsed from the URL — price, beds, baths, sqft, year, and tax data are pulled from syndicated listing sources automatically.',
                  pill:'Auto-filled from listing',
                  delay:'d1',
                  icon: (
                    <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
                      <path d="M4 14a10 10 0 1 1 20 0 10 10 0 0 1-20 0z" stroke={C.green} strokeWidth="1.7"/>
                      <path d="M9.5 14h9M14 9.5v9" stroke={C.green} strokeWidth="1.7" strokeLinecap="round"/>
                      <circle cx="14" cy="14" r="3" fill={C.greenBg} stroke={C.green} strokeWidth="1.2"/>
                    </svg>
                  ),
                },
                {
                  n:'02',
                  title:'Confirm the numbers',
                  body:"Fields the autofill couldn't determine are flagged for manual entry. Every required input — tax, HOA, beds, sqft — must be filled before analysis runs. Nothing is assumed silently.",
                  pill:'Zero silent blanks',
                  delay:'d2',
                  icon: (
                    <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
                      <rect x="5" y="7" width="18" height="14" rx="3.5" stroke={C.green} strokeWidth="1.7"/>
                      <path d="M9 14.5l3.5 3.5 7-8" stroke={C.green} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  ),
                },
                {
                  n:'03',
                  title:'Get your verdict',
                  body:'Gemini AI cross-references your numbers with real HUD rent data and state-specific rates. Full score, expense breakdown, 5-year wealth projection, and a clear buy/caution/pass call.',
                  pill:'Grounded in real market data',
                  delay:'d3',
                  icon: (
                    <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
                      <path d="M5 20.5l5-9 4.5 7 3.5-5.5 5 7.5" stroke={C.green} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
                      <path d="M22 9l-3 .5.5-3" stroke={C.green} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  ),
                },
              ].map(s => (
                <div key={s.n} className={`step-card reveal${howV?' up':''} ${s.delay}`}>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:22 }}>
                    {s.icon}
                    <span style={{ fontSize:38, fontWeight:800, color:C.soft, letterSpacing:'-0.06em', lineHeight:1, marginTop:-6 }}>{s.n}</span>
                  </div>
                  <h3 style={{ fontSize:17.5, fontWeight:700, color:C.text, marginBottom:11, letterSpacing:'-0.015em' }}>{s.title}</h3>
                  <p style={{ fontSize:13.5, color:C.muted, lineHeight:1.7, marginBottom:18 }}>{s.body}</p>
                  <div style={{
                    display:'inline-block', fontSize:11, fontWeight:600,
                    color:C.green, background:C.greenBg, border:`1px solid ${C.greenBorder}`,
                    borderRadius:7, padding:'3px 10px',
                  }}>{s.pill}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── SOCIAL PROOF ─────────────────────────────────────────────────── */}
        <div style={{ background:C.white, borderTop:`1px solid ${C.border}`, borderBottom:`1px solid ${C.border}`, padding:'72px 40px' }}>
          <div ref={socialRef} style={{ maxWidth:1100, margin:'0 auto' }}>
            <div className={`reveal${socialV?' up':''}`} style={{ textAlign:'center', marginBottom:52 }}>
              <div style={{ fontSize:11, fontWeight:700, letterSpacing:'0.12em', textTransform:'uppercase', color:C.green, marginBottom:12 }}>Early Users</div>
              <h2 style={{ fontFamily:"'Libre Baskerville', Georgia, serif", fontSize:'clamp(26px, 3vw, 40px)', fontWeight:700, letterSpacing:'-0.025em', color:C.text }}>
                What investors are saying
              </h2>
              <p style={{ fontSize:12, color:C.muted, marginTop:8, fontStyle:'italic' }}>Testimonials from early users. Individual results vary based on market, property, and inputs.</p>
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:18 }} className="who-grid">
              {[
                {
                  quote:"I used to spend 45 minutes on a spreadsheet before making an offer. Now I paste the Zillow link and have a full breakdown in under a minute. The HUD rent anchor is what sold me — it's not just vibes.",
                  name:'Marcus T.',
                  role:'SFR investor, 7 doors — Cleveland, OH',
                  delay:'d1',
                },
                {
                  quote:"The expense model is actually complete. Every tool I've tried ignores CapEx or uses a flat 1% rule. RentalIQ breaks it down by property age and type. That alone is worth it.",
                  name:'Priya N.',
                  role:'House hacker, 2 units — Phoenix, AZ',
                  delay:'d2',
                },
                {
                  quote:"I send the shareable link to clients instead of a PDF. They can see every number, every assumption. It's made me look more credible than any other tool I've used.",
                  name:'James R.',
                  role:"Buyer's agent — Austin, TX",
                  delay:'d3',
                },
              ].map((t, i) => (
                <div key={i} className={`reveal${socialV?' up':''} ${t.delay}`} style={{
                  background:C.bg, border:`1px solid ${C.border}`, borderRadius:18,
                  padding:'28px 26px', display:'flex', flexDirection:'column', gap:20,
                }}>
                  {/* Stars */}
                  <div style={{ display:'flex', gap:3 }}>
                    {[0,1,2,3,4].map(s => (
                      <svg key={s} width="14" height="14" viewBox="0 0 14 14" fill={C.green}><path d="M7 1l1.6 3.4 3.6.5-2.6 2.5.6 3.6L7 9.4l-3.2 1.6.6-3.6L1.8 4.9l3.6-.5z"/></svg>
                    ))}
                  </div>
                  <p style={{ fontSize:14, color:C.text, lineHeight:1.7, flex:1, fontStyle:'italic' }}>"{t.quote}"</p>
                  <div>
                    <div style={{ fontSize:13, fontWeight:700, color:C.text }}>{t.name}</div>
                    <div style={{ fontSize:12, color:C.muted, marginTop:2 }}>{t.role}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── DEMO / SAMPLE ANALYSIS ───────────────────────────────────────── */}
        <section id="demo" style={{
          borderTop:`1px solid ${C.border}`,
          background:`radial-gradient(ellipse 1200px 600px at 50% -80px, rgba(22,102,56,.055) 0%, transparent 65%), ${C.bg}`,
          padding:'96px 40px',
        }}>
          <div ref={demoRef} style={{ maxWidth:1100, margin:'0 auto' }}>
            <div className="demo-grid" style={{ display:'grid', gridTemplateColumns:'1fr 1.05fr', gap:72, alignItems:'start' }}>

              {/* Left: framing copy */}
              <div className={`reveal${demoV?' up':''}`}>
                <div style={{ fontSize:11, fontWeight:700, letterSpacing:'0.12em', textTransform:'uppercase', color:C.green, marginBottom:12 }}>Sample Analysis</div>
                <h2 style={{
                  fontFamily:"'Libre Baskerville', Georgia, serif",
                  fontSize:'clamp(26px, 2.9vw, 40px)',
                  fontWeight:700, letterSpacing:'-0.025em',
                  color:C.text, marginBottom:18, lineHeight:1.15,
                }}>
                  This is exactly<br/>what you get
                </h2>
                <p style={{ fontSize:15.5, color:C.muted, lineHeight:1.68, marginBottom:32 }}>
                  A Cleveland SFR listed at $129k. Every number you see was computed
                  as a representative sample — the same output format and data depth you get on any deal. Score,
                  verdict, expense model, strengths, and risks.
                </p>

                {/* Key output summary */}
                <div style={{ display:'flex', flexDirection:'column', gap:9, marginBottom:36 }}>
                  {[
                    ['Overall score',      '74 / 100',  C.green],
                    ['Monthly cash flow',  '+$187 / mo', C.green],
                    ['Cash-on-cash',       '+8.4%',      C.green],
                    ['5-year total return','$89k',        C.text],
                    ['Annualized IRR',     '14.2%',       C.text],
                  ].map(([l, v, col]) => (
                    <div key={l} style={{
                      display:'flex', justifyContent:'space-between', alignItems:'center',
                      padding:'11px 16px', background:C.white,
                      border:`1px solid ${C.border}`, borderRadius:11,
                    }}>
                      <span style={{ fontSize:13.5, color:C.muted }}>{l}</span>
                      <span style={{ fontSize:14.5, fontWeight:700, color:col, letterSpacing:'-0.02em' }}>{v}</span>
                    </div>
                  ))}
                </div>

                <Link href="/analyze" className="btn-primary" style={{ width:'100%', justifyContent:'center', fontSize:15 }}>
                  Run this on your deal →
                </Link>
              </div>

              {/* Right: live mock card */}
              <div className={`demo-mock reveal${demoV?' up d1':''}`}>
                <MockCard run={demoV}/>
              </div>

            </div>
          </div>
        </section>

        {/* ── WHO IT'S FOR ─────────────────────────────────────────────────── */}
        <div className="grad-divider"/>
        <section style={{ background:C.white, padding:'80px 40px' }}>
          <div ref={whoRef} style={{ maxWidth:1100, margin:'0 auto' }}>
            <div className={`reveal${whoV?' up':''}`} style={{ textAlign:'center', marginBottom:52 }}>
              <div style={{ fontSize:11, fontWeight:700, letterSpacing:'0.12em', textTransform:'uppercase', color:C.green, marginBottom:12 }}>Who It's For</div>
              <h2 style={{ fontFamily:"'Libre Baskerville', Georgia, serif", fontSize:'clamp(26px, 3vw, 40px)', fontWeight:700, letterSpacing:'-0.025em', color:C.text }}>
                Built for every stage of the journey
              </h2>
            </div>
            <div className="who-grid" style={{ display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:20 }}>
              {[
                {
                  pill:'Beginner-friendly',
                  title:'First-time investors',
                  body:"RentalIQ handles the full math — mortgage, taxes, insurance, vacancy, management, CapEx — and explains what it means in plain English. No finance degree required.",
                  delay:'d1',
                },
                {
                  pill:'High volume',
                  title:'Active deal hunters',
                  body:'Analyze dozens of listings per week in minutes. Save every deal, compare side-by-side, and spot the winners before anyone else has run the numbers.',
                  delay:'d2',
                },
                {
                  pill:'Client-ready',
                  title:'Agents & advisors',
                  body:"Share a professional, data-backed analysis link with clients. Unbiased, thorough, and credible — it strengthens trust without any extra work on your end.",
                  delay:'d3',
                },
              ].map(w => (
                <div key={w.title} className={`reveal${whoV?' up':''} ${w.delay}`} style={{ background:C.bg, border:`1px solid ${C.border}`, borderRadius:18, padding:'28px 26px' }}>
                  <div style={{
                    display:'inline-block', fontSize:10.5, fontWeight:700,
                    color:C.green, background:C.greenBg, border:`1px solid ${C.greenBorder}`,
                    borderRadius:7, padding:'3px 10px', marginBottom:16,
                  }}>{w.pill}</div>
                  <h3 style={{ fontSize:17, fontWeight:700, color:C.text, marginBottom:11, letterSpacing:'-0.015em' }}>{w.title}</h3>
                  <p style={{ fontSize:14, color:C.muted, lineHeight:1.68 }}>{w.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── COMPARISON TABLE ────────────────────────────────────────────── */}
        <div className="grad-divider"/>
        <section style={{ background:C.white, padding:'80px 40px' }}>
          <div ref={compareRef} style={{ maxWidth:1100, margin:'0 auto' }}>
            <div className={`reveal${compareV?' up':''}`} style={{ textAlign:'center', marginBottom:52 }}>
              <div style={{ fontSize:11, fontWeight:700, letterSpacing:'0.12em', textTransform:'uppercase', color:C.green, marginBottom:12 }}>Why RentalIQ</div>
              <h2 style={{ fontFamily:"'Libre Baskerville', Georgia, serif", fontSize:'clamp(26px, 3vw, 40px)', fontWeight:700, letterSpacing:'-0.025em', color:C.text }}>
                Built differently from everything else
              </h2>
            </div>
            <div className={`reveal${compareV?' up d1':''}`} style={{ overflowX:'auto' }}>
              <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13.5, minWidth:600 }}>
                <thead>
                  <tr>
                    <th style={{ textAlign:'left', padding:'12px 16px', borderBottom:`2px solid ${C.border}`, fontWeight:600, color:C.muted, fontSize:12, letterSpacing:'0.08em', textTransform:'uppercase' }}>Feature</th>
                    <th style={{ textAlign:'center', padding:'12px 20px', borderBottom:`2px solid ${C.green}`, background:C.greenBg, fontWeight:700, color:C.green, fontSize:13, borderRadius:'10px 10px 0 0', minWidth:130 }}>RentalIQ</th>
                    <th style={{ textAlign:'center', padding:'12px 16px', borderBottom:`2px solid ${C.border}`, fontWeight:600, color:C.muted, fontSize:12, letterSpacing:'0.08em', textTransform:'uppercase', minWidth:110 }}>Spreadsheet</th>
                    <th style={{ textAlign:'center', padding:'12px 16px', borderBottom:`2px solid ${C.border}`, fontWeight:600, color:C.muted, fontSize:12, letterSpacing:'0.08em', textTransform:'uppercase', minWidth:130 }}>Generic AI tools</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ['Full expense model (9 line items)', true, 'Manual', 'Partial'],
                    ['Real HUD rent anchor', true, false, false],
                    ['State-level tax & insurance rates', true, 'Manual', false],
                    ['Flood, climate & school data', true, false, false],
                    ['5-year wealth projection + IRR', true, 'Manual', 'Estimated'],
                    ['Auto-fill from Zillow/Redfin URL', true, false, false],
                    ['Shareable analysis link', true, 'Export only', false],
                    ['AI verdict + follow-up chat', true, false, 'Generic'],
                    ['Time to first result', '< 60 seconds', '30–60 min', '< 60 sec'],
                  ].map(([feat, ours, sheet, ai], i) => {
                    const renderCell = (val, highlight) => {
                      if (val === true) return <span style={{ color:C.green, fontWeight:700 }}>✓</span>;
                      if (val === false) return <span style={{ color:C.muted }}>—</span>;
                      return <span style={{ fontSize:12.5, color: highlight ? C.green : C.muted, fontWeight: highlight ? 600 : 400 }}>{val}</span>;
                    };
                    return (
                      <tr key={i} style={{ background: i % 2 === 0 ? C.bg : C.white }}>
                        <td style={{ padding:'11px 16px', color:C.text, fontWeight:500 }}>{feat}</td>
                        <td style={{ textAlign:'center', padding:'11px 20px', background: i % 2 === 0 ? C.greenBg+'66' : C.greenBg+'44' }}>{renderCell(ours, true)}</td>
                        <td style={{ textAlign:'center', padding:'11px 16px' }}>{renderCell(sheet, false)}</td>
                        <td style={{ textAlign:'center', padding:'11px 16px' }}>{renderCell(ai, false)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* ── PRICING ──────────────────────────────────────────────────────── */}
        <div className="grad-divider"/>
        <section id="pricing" className="pad" style={{ padding:'96px 40px' }}>
          <div ref={pricingRef} style={{ maxWidth:1100, margin:'0 auto' }}>

            <div className={`reveal${pricingV?' up':''}`} style={{ textAlign:'center', marginBottom:52 }}>
              <div style={{ fontSize:11, fontWeight:700, letterSpacing:'0.12em', textTransform:'uppercase', color:C.green, marginBottom:12 }}>Pricing</div>
              <h2 style={{ fontFamily:"'Libre Baskerville', Georgia, serif", fontSize:'clamp(28px, 3.2vw, 44px)', fontWeight:700, letterSpacing:'-0.025em', color:C.text, marginBottom:16 }}>
                Pay per analysis.<br/>No subscription.
              </h2>
              <p style={{ fontSize:16, color:C.muted, maxWidth:380, margin:'0 auto', lineHeight:1.6 }}>
                Buy tokens when you need them. Each one runs one complete AI analysis.
              </p>
            </div>

            {/* Free tier banner */}
            <div className={`reveal${pricingV?' up d1':''}`} style={{ maxWidth:560, margin:'0 auto 40px' }}>
              <div style={{
                background:C.greenBg, border:`1.5px solid ${C.greenBorder}`,
                borderRadius:16, padding:'17px 22px',
                display:'flex', alignItems:'center', gap:14,
              }}>
                <div style={{
                  width:40, height:40, borderRadius:'50%',
                  background:C.green, flexShrink:0,
                  display:'flex', alignItems:'center', justifyContent:'center',
                }}>
                  <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M2.5 9l4.5 4.5 8.5-9" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                </div>
                <div>
                  <div style={{ fontSize:14, fontWeight:700, color:C.green, marginBottom:2 }}>Your first analysis is free</div>
                  <div style={{ fontSize:13, color:C.muted, lineHeight:1.5 }}>No account required. No credit card. Try the full product before spending anything.</div>
                </div>
              </div>
            </div>

            <div className="pricing-grid" style={{ display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:18, maxWidth:820, margin:'0 auto' }}>
              {(() => {
                const PKG_META = {
                  tokens_1:   { name:'Single', delay:'d1', desc:"Perfect for evaluating one deal you're already serious about." },
                  tokens_10:  { name:'Bundle', delay:'d2', desc:'Ideal for investors screening multiple properties every week.' },
                  tokens_100: { name:'Power',  delay:'d3', desc:'For agents, advisors, and investors analyzing markets at volume.' },
                };
                return TOKEN_PACKAGES.map(pkg => {
                  const meta     = PKG_META[pkg.id] || { name: pkg.label, delay:'d1', desc:'' };
                  const priceStr = `$${(pkg.price / 100).toFixed(0)}`;
                  const perStr   = `$${(pkg.price / pkg.tokens / 100).toFixed(2)} per analysis`;
                  const featured = pkg.badge === 'Most Popular';
                  return (
                <div
                  key={pkg.id}
                  className={`pricing-card${featured?' featured':''} reveal${pricingV?' up':''} ${meta.delay}`}
                >
                  {pkg.badge && (
                    <div style={{
                      position:'absolute', top:0, right:20,
                      background: featured ? C.green : C.text,
                      color:'#fff', fontSize:9.5, fontWeight:700,
                      letterSpacing:'0.07em', textTransform:'uppercase',
                      padding:'4px 12px', borderRadius:'0 0 9px 9px',
                    }}>{pkg.badge}</div>
                  )}

                  <div style={{ fontSize:11, fontWeight:700, letterSpacing:'0.09em', textTransform:'uppercase', color: featured ? C.green : C.muted, marginBottom:8 }}>
                    {meta.name}
                  </div>

                  <div style={{ display:'flex', alignItems:'baseline', gap:2, marginBottom:3 }}>
                    <span style={{ fontSize:44, fontWeight:800, color:C.text, letterSpacing:'-0.045em', lineHeight:1 }}>{priceStr}</span>
                  </div>
                  <div style={{ fontSize:12, color:C.muted, marginBottom:10 }}>{perStr}</div>

                  <div style={{ fontSize:22, fontWeight:700, letterSpacing:'-0.02em', color: featured ? C.green : C.text, marginBottom:16 }}>
                    {pkg.tokens} {pkg.tokens === 1 ? 'token' : 'tokens'}
                  </div>

                  <p style={{ fontSize:13.5, color:C.muted, lineHeight:1.6, marginBottom:24, minHeight:48 }}>{meta.desc}</p>

                  <Link href={pkg.tokens === 1 ? '/analyze' : '/auth?plan=' + meta.name.toLowerCase()} style={{
                    display:'block', textAlign:'center', textDecoration:'none',
                    background: featured ? C.green : C.soft,
                    color: featured ? '#fff' : C.text,
                    borderRadius:11, padding:'12px',
                    fontSize:14, fontWeight:700, letterSpacing:'-0.01em',
                    transition:'opacity .15s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.opacity = '.82'}
                  onMouseLeave={e => e.currentTarget.style.opacity = '1'}>
                    {pkg.tokens === 1 ? 'Try free →' : 'Get started →'}
                  </Link>
                </div>
              );});})()}
            </div>

            <p style={{ textAlign:'center', fontSize:12.5, color:C.muted, marginTop:22 }}>
              Tokens never expire &nbsp;·&nbsp; Secure checkout via Stripe &nbsp;·&nbsp; Instant delivery
            </p>
          </div>
        </section>

        {/* ── FEATURES ─────────────────────────────────────────────────────── */}
        <div className="grad-divider"/>
        <section style={{ background:C.white, padding:'80px 40px' }}>
          <div style={{ maxWidth:1100, margin:'0 auto' }}>
            <div style={{ textAlign:'center', marginBottom:52 }}>
              <h2 style={{ fontFamily:"'Libre Baskerville', Georgia, serif", fontSize:'clamp(24px, 2.8vw, 38px)', fontWeight:700, letterSpacing:'-0.025em', color:C.text }}>
                Everything you need to evaluate a rental
              </h2>
            </div>
            <div className="feat-grid" style={{ display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:16 }}>
              {[
                {
                  icon: <svg width="22" height="22" viewBox="0 0 22 22" fill="none"><rect x="2" y="11" width="4" height="9" rx="1" fill={C.greenBg} stroke={C.green} strokeWidth="1.3"/><rect x="9" y="6" width="4" height="14" rx="1" fill={C.greenBg} stroke={C.green} strokeWidth="1.3"/><rect x="16" y="2" width="4" height="18" rx="1" fill={C.greenBg} stroke={C.green} strokeWidth="1.3"/></svg>,
                  title:'Full expense model',
                  body:'Mortgage, tax, insurance, vacancy, management, maintenance, CapEx, HOA, and PMI. Every cost accounted for precisely.',
                },
                {
                  icon: <svg width="22" height="22" viewBox="0 0 22 22" fill="none"><path d="M11 3C6.58 3 3 6.58 3 11s3.58 8 8 8 8-3.58 8-8" stroke={C.green} strokeWidth="1.4"/><path d="M15 3c0 3.31-1.79 6-4 6S7 6.31 7 3" stroke={C.green} strokeWidth="1.4"/><path d="M3 11h16" stroke={C.green} strokeWidth="1.4" strokeLinecap="round"/></svg>,
                  title:'Real rent data',
                  body:"HUD Fair Market Rents and Census ACS data anchor the AI's rent estimate. Market-backed, not a guess.",
                },
                {
                  icon: <svg width="22" height="22" viewBox="0 0 22 22" fill="none"><path d="M11 2L2 8v12h6v-6h6v6h6V8z" stroke={C.green} strokeWidth="1.4" strokeLinejoin="round"/></svg>,
                  title:'Neighborhood score',
                  body:'Demographics, walkability, school ratings, and landlord law assessment baked into the overall score.',
                },
                {
                  icon: <svg width="22" height="22" viewBox="0 0 22 22" fill="none"><path d="M4 18l4.5-8 4 5.5 3-4 4 6.5" stroke={C.green} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/><circle cx="17" cy="5" r="3" stroke={C.green} strokeWidth="1.4"/></svg>,
                  title:'AI deal advisor',
                  body:"Ask follow-up questions after your analysis. What if I lower the price? What's the break-even rent?",
                },
                {
                  icon: <svg width="22" height="22" viewBox="0 0 22 22" fill="none"><rect x="3" y="3" width="16" height="16" rx="3" stroke={C.green} strokeWidth="1.4"/><path d="M7 8h8M7 12h6M7 16h4" stroke={C.green} strokeWidth="1.4" strokeLinecap="round"/></svg>,
                  title:'Deal history',
                  body:'Every analysis saved to your account. Compare side-by-side. Export a full PDF report to email yourself or your partner.',
                },
                {
                  icon: <svg width="22" height="22" viewBox="0 0 22 22" fill="none"><path d="M10 6H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-5" stroke={C.green} strokeWidth="1.4" strokeLinecap="round"/><path d="M14 3h5v5M12 10l7-7" stroke={C.green} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>,
                  title:'Shareable links',
                  body:'Generate a read-only link to share with your partner, agent, or lender. No account needed to view.',
                },
              ].map(f => (
                <div key={f.title} className="feat-card">
                  <div style={{ marginBottom:14 }}>{f.icon}</div>
                  <div style={{ fontSize:14.5, fontWeight:700, color:C.text, marginBottom:8, letterSpacing:'-0.01em' }}>{f.title}</div>
                  <div style={{ fontSize:13.5, color:C.muted, lineHeight:1.65 }}>{f.body}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── FAQ ─────────────────────────────────────────────────────────── */}
        <div className="grad-divider"/>
        <section id="faq" style={{ background:C.white, padding:'80px 40px' }}>
          <div ref={faqRef} style={{ maxWidth:700, margin:'0 auto' }}>
            <div className={`reveal${faqV?' up':''}`} style={{ textAlign:'center', marginBottom:52 }}>
              <div style={{ fontSize:11, fontWeight:700, letterSpacing:'0.12em', textTransform:'uppercase', color:C.green, marginBottom:12 }}>FAQ</div>
              <h2 style={{ fontFamily:"'Libre Baskerville', Georgia, serif", fontSize:'clamp(26px, 3vw, 40px)', fontWeight:700, letterSpacing:'-0.025em', color:C.text }}>
                Common questions
              </h2>
            </div>
            <div className={`reveal${faqV?' up d1':''}`} style={{ display:'flex', flexDirection:'column', gap:1 }}>
              {[
                {
                  q:"Is this just a ChatGPT wrapper?",
                  a:"No. The AI (Google Gemini) receives a structured prompt containing real data from HUD, FRED, BLS, Census, and FHFA — not just your inputs. The rent estimate is anchored to HUD Small Area Fair Market Rents for your specific ZIP code. Mortgage rates come from FRED (Freddie Mac PMMS, updated weekly). All market data is auto-refreshed by background jobs — property tax rates from Census ACS, landlord laws from Eviction Lab, STR rules from NMHC, appreciation from FHFA, and so on. No data is permanently hardcoded. Property tax and insurance rates are state-calibrated from Tax Foundation and NAIC data. The AI synthesizes all of this into a verdict. Without that data layer, it would just be guessing.",
                },
                {
                  q:"How accurate is the rent estimate?",
                  a:"The rent estimate is anchored in two real data sources: HUD SAFMR (ZIP-level fair market rent by bedroom count, updated annually) and Census ACS median contract rent. If Zillow ZORI metro-level data is available for your city, that's also incorporated. The AI is instructed to flag when your assumed rent diverges significantly from these benchmarks. It's not a Zestimate — it's a government-sourced range with a bias check built in.",
                },
                {
                  q:"What's included in the expense model?",
                  a:"Nine line items: mortgage P&I, property taxes (state-calibrated rate), homeowner's insurance (state-calibrated rate), vacancy allowance, property management, routine maintenance, CapEx reserves (scaled by property age and type using BLS construction cost index), HOA (if applicable), and PMI (if down payment is under 20%, using LTV-band rates). Nothing is assumed silently — every field that can't be auto-filled is flagged for manual entry.",
                },
                {
                  q:"What if the autofill gets the numbers wrong?",
                  a:"Every auto-filled field shows a confidence badge: green for high confidence (2+ sources agree), amber for medium (one structured source), or red for low (regex only). Red fields are pre-flagged for manual review before you can run the analysis. Nothing is silently assumed. You confirm every number before spending a token.",
                },
                {
                  q:"Do tokens expire?",
                  a:"No. Tokens never expire. Buy them when you need them and use them on your timeline.",
                },
                {
                  q:"Can I share results with my partner or lender?",
                  a:"Yes. Every completed analysis generates a permanent shareable link. Anyone with the link can view the full breakdown — score, expense model, wealth projection, pros and cons — without needing an account. You can also export a full PDF report.",
                },
                {
                  q:"Is this financial advice?",
                  a:"No. RentalIQ is an analysis tool, not a licensed financial advisor. The output is a data-grounded model — not a recommendation to buy or not buy. Always verify with a licensed professional before making investment decisions.",
                },
              ].map((item, i) => (
                <FaqItem key={i} q={item.q} a={item.a} />
              ))}
            </div>
          </div>
        </section>

        {/* ── FINAL CTA ────────────────────────────────────────────────────── */}
        <section className="pad" style={{ padding:'108px 40px' }}>
          <div ref={ctaRef} className={`reveal${ctaV?' up':''}`} style={{ maxWidth:540, margin:'0 auto', textAlign:'center' }}>
            {/* Small wordmark */}
            <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:7, marginBottom:28 }}>
              <div style={{ width:10, height:10, background:C.green, borderRadius:'50%', animation:'pulse-dot 2.8s ease-in-out infinite' }}/>
              <span style={{ fontSize:13, fontWeight:700, letterSpacing:'-0.02em', color:C.muted }}>RentalIQ</span>
            </div>

            <h2 style={{
              fontFamily:"'Libre Baskerville', Georgia, serif",
              fontSize:'clamp(32px, 4vw, 54px)',
              fontWeight:700, letterSpacing:'-0.03em',
              color:C.text, marginBottom:20, lineHeight:1.08,
            }}>
              Know before<br/>you buy.
            </h2>

            <p style={{ fontSize:17, color:C.muted, lineHeight:1.65, marginBottom:36 }}>
              Your first analysis is free. No account, no spreadsheet, no finance degree required.
            </p>

            <Link href="/analyze" className="btn-primary" style={{ fontSize:16, padding:'17px 40px' }}>
              Analyze your first deal free
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M3 9h12M11 5l4 4-4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </Link>
          </div>
        </section>

        {/* ── FOOTER ───────────────────────────────────────────────────────── */}
        <footer style={{ borderTop:`1px solid ${C.border}`, padding:'24px 40px' }}>
          <div style={{ maxWidth:1100, margin:'0 auto', display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:14 }}>
            <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
              <div style={{ width:7, height:7, background:C.green, borderRadius:'50%' }}/>
              <span style={{ fontSize:12.5, fontWeight:700, color:C.text }}>RentalIQ</span>
              <span style={{ fontSize:12, color:C.muted }}>
                · Not financial advice · Verify with a licensed professional before investing
              </span>
            </div>
            <div style={{ display:'flex', alignItems:'center', gap:22 }}>
              <Link href="/privacy" style={{ fontSize:12, color:C.muted, textDecoration:'none', borderBottom:`1px solid ${C.border}` }}>Privacy</Link>
              <Link href="/terms"   style={{ fontSize:12, color:C.muted, textDecoration:'none', borderBottom:`1px solid ${C.border}` }}>Terms</Link>
              <Link href="/analyze" style={{ fontSize:12.5, color:C.green, textDecoration:'none', fontWeight:700, letterSpacing:'-0.01em' }}>
                Launch analyzer →
              </Link>
            </div>
          </div>
        </footer>

      </div>
    </>
  );
}
