// /share/[token] - public read-only view of a shared analysis
// No authentication required

import { useState, useEffect } from 'react';
import Head from 'next/head';
import Link from 'next/link';

// -- jsPDF loader (same as main page) ----------------------------------------
async function loadJsPDF() {
  if (typeof window === 'undefined') return null;
  if (window._jsPDFClass) return window._jsPDFClass;
  await new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
    s.onload  = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
  window._jsPDFClass = window.jspdf?.jsPDF || window.jsPDF || null;
  if (!window._jsPDFClass) throw new Error('jsPDF failed to load.');
  return window._jsPDFClass;
}

async function generateSharePDF(data, address) {
  const jsPDF = await loadJsPDF();
  if (!jsPDF) throw new Error('Could not load PDF library.');

  const doc  = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter' });
  const W = 612, H = 792, PAD = 48;
  const GREEN = [22,102,56], DARK = [13,15,15], MUTED = [114,114,122];
  const SOFT  = [234,234,239], WHITE = [255,255,255];
  const RED   = [166,38,38],   AMBER = [138,88,0];

  const verdict  = data.verdict === 'YES' ? 'BUY' : data.verdict === 'NO' ? 'PASS' : 'CAUTION';
  const vColor   = data.verdict === 'YES' ? GREEN : data.verdict === 'NO' ? RED : AMBER;
  const score    = data.overallScore ?? 0;
  const addr     = address || data.address || 'Property Analysis';
  const addrShort= addr.split(',')[0];

  function setFill(rgb)   { doc.setFillColor(rgb[0],rgb[1],rgb[2]); }
  function setStroke(rgb) { doc.setDrawColor(rgb[0],rgb[1],rgb[2]); }
  function setTxt(rgb)    { doc.setTextColor(rgb[0],rgb[1],rgb[2]); }

  // Cover page
  setFill(GREEN); doc.rect(0,0,W,H,'F');
  setFill([28,115,65]); doc.circle(W/2,260,200,'F');
  setFill([12,45,25]); doc.rect(0,0,W,52,'F');
  setFill([96,204,141]); doc.circle(PAD+5,26,5,'F');
  doc.setFont('helvetica','bold'); doc.setFontSize(13); setTxt(WHITE);
  doc.text('RentalIQ', PAD+16, 30.5);
  doc.setFont('helvetica','normal'); doc.setFontSize(10); setTxt([150,200,170]);
  doc.text('Shared Deal Memo', W-PAD, 30.5, { align:'right' });

  // Score ring
  const cx=W/2, cy=230, r=72;
  doc.setLineWidth(10); setStroke([12,45,25]); doc.circle(cx,cy,r);
  const steps=Math.max(1,Math.round((score/100)*60)), start=-Math.PI/2;
  doc.setLineWidth(10); setStroke([96,204,141]);
  for(let i=0;i<steps;i++){
    const a1=start+(i/60)*2*Math.PI, a2=start+((i+1)/60)*2*Math.PI;
    doc.line(cx+r*Math.cos(a1),cy+r*Math.sin(a1),cx+r*Math.cos(a2),cy+r*Math.sin(a2));
  }
  doc.setFont('helvetica','bold'); doc.setFontSize(44); setTxt(WHITE);
  doc.text(String(score),cx,cy+14,{align:'center'});
  doc.setFontSize(12); setTxt([150,200,170]);
  doc.text('/ 100',cx,cy+32,{align:'center'});

  // Verdict pill
  setFill(vColor); doc.roundedRect(cx-50,cy+50,100,28,6,6,'F');
  doc.setFont('helvetica','bold'); doc.setFontSize(13); setTxt(WHITE);
  doc.text(verdict,cx,cy+68.5,{align:'center'});

  // Address
  doc.setFont('helvetica','bold'); doc.setFontSize(20); setTxt(WHITE);
  doc.text(addrShort,cx,cy+108,{align:'center',maxWidth:W-PAD*2});
  const cityLine=addr.includes(',') ? addr.split(',').slice(1).join(',').trim() : '';
  if(cityLine){ doc.setFont('helvetica','normal'); doc.setFontSize(12); setTxt([150,200,170]); doc.text(cityLine,cx,cy+127,{align:'center',maxWidth:W-PAD*2}); }
  if(data.verdictSummary){
    doc.setFont('helvetica','italic'); doc.setFontSize(11.5); setTxt([180,220,195]);
    doc.text(doc.splitTextToSize(data.verdictSummary,W-120),cx,cy+152,{align:'center'});
  }

  // Stat bar
  setFill([12,45,25]); doc.rect(0,H-90,W,90,'F');
  const cf=(data.keyMetrics||[]).find(m=>m.label==='Monthly Cash Flow');
  const coc=(data.keyMetrics||[]).find(m=>m.label==='Cash-on-Cash');
  const cap=(data.keyMetrics||[]).find(m=>m.label==='Cap Rate');
  [{ label:'Price',value:data.assumedPrice||'-' },{ label:'Rent/mo',value:data.assumedRent||'-' },
   { label:'Cash Flow',value:cf?.value||'-' },{ label:'CoC',value:coc?.value||'-' },{ label:'Cap Rate',value:cap?.value||'-' }
  ].forEach((st,i)=>{
    const x=(W/5)*i+(W/10);
    doc.setFont('helvetica','normal'); doc.setFontSize(9.5); setTxt([120,170,140]); doc.text(st.label,x,H-68,{align:'center'});
    doc.setFont('helvetica','bold'); doc.setFontSize(13.5); setTxt(WHITE); doc.text(st.value,x,H-48,{align:'center'});
  });
  doc.setFont('helvetica','normal'); doc.setFontSize(8.5); setTxt([80,120,96]);
  doc.text(`Generated ${new Date().toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'})} · rentaliq.app`,cx,H-14,{align:'center'});

  // Analysis page
  doc.addPage(); let y=PAD;
  setFill(WHITE); doc.rect(0,0,W,H,'F');
  setFill(GREEN); doc.rect(0,0,W,48,'F');
  doc.setFont('helvetica','bold'); doc.setFontSize(12); setTxt(WHITE); doc.text('RentalIQ',PAD,30);
  doc.setFont('helvetica','normal'); doc.setFontSize(10); setTxt([180,220,195]); doc.text('Full Analysis Report',W-PAD,30,{align:'right'});
  y=68;

  function sectionTitle(label){ doc.setFont('helvetica','bold'); doc.setFontSize(9); setTxt(MUTED); doc.text(label.toUpperCase(),PAD,y); setFill(SOFT); doc.rect(PAD,y+3,W-PAD*2,1,'F'); y+=14; }

  const bannerBg=data.verdict==='YES'?[236,246,241]:data.verdict==='NO'?[253,240,240]:[253,244,232];
  const bannerBdr=data.verdict==='YES'?[150,204,176]:data.verdict==='NO'?[224,170,170]:[223,192,112];
  setFill(bannerBg); setStroke(bannerBdr); doc.setLineWidth(1); doc.roundedRect(PAD,y,W-PAD*2,54,8,8,'FD');
  setFill(vColor); doc.roundedRect(PAD+12,y+12,44,30,6,6,'F');
  doc.setFont('helvetica','bold'); doc.setFontSize(16); setTxt(WHITE); doc.text(String(score),PAD+34,y+31,{align:'center'});
  doc.setFont('helvetica','bold'); doc.setFontSize(13); setTxt(DARK); doc.text(verdict,PAD+70,y+24);
  if(data.verdictSummary){ doc.setFont('helvetica','normal'); doc.setFontSize(9.5); setTxt(MUTED); doc.text(doc.splitTextToSize(data.verdictSummary,W-PAD*2-80),PAD+70,y+38,{maxWidth:W-PAD*2-80}); }
  y+=68;

  sectionTitle('Key Metrics');
  const metrics=data.keyMetrics||[]; const mCols=4, mW=(W-PAD*2-(mCols-1)*8)/mCols;
  for(let row=0;row<Math.ceil(metrics.length/mCols);row++){
    for(let col=0;col<mCols;col++){
      const idx=row*mCols+col; if(idx>=metrics.length) continue;
      const m=metrics[idx], mx=PAD+col*(mW+8), my=y;
      const mBg=m.status==='good'?[236,246,241]:m.status==='bad'?[253,240,240]:[250,250,252];
      const mBdr=m.status==='good'?[150,204,176]:m.status==='bad'?[224,170,170]:[221,221,228];
      const mValC=m.status==='good'?GREEN:m.status==='bad'?RED:DARK;
      setFill(mBg); setStroke(mBdr); doc.setLineWidth(0.75); doc.roundedRect(mx,my,mW,50,5,5,'FD');
      doc.setFont('helvetica','normal'); doc.setFontSize(8); setTxt(MUTED); doc.text(m.label,mx+8,my+14);
      doc.setFont('helvetica','bold'); doc.setFontSize(14.5); setTxt(mValC); doc.text(m.value,mx+8,my+33);
      if(m.note){ doc.setFont('helvetica','normal'); doc.setFontSize(7.5); setTxt(MUTED); doc.text(m.note,mx+8,my+44,{maxWidth:mW-16}); }
    }
    y+=58;
  }
  y+=4;

  sectionTitle('Score Breakdown');
  const scoreData=data.scoreBreakdown||[], expData=data.expenseBreakdown||[];
  const leftW=(W-PAD*2-16)*0.52, rightW=(W-PAD*2-16)*0.48;
  let ly=y;
  scoreData.forEach(item=>{
    const sc=item.score??0, bc=sc>=70?GREEN:sc>=40?AMBER:RED;
    doc.setFont('helvetica','normal'); doc.setFontSize(9); setTxt(DARK); doc.text(item.name,PAD,ly+10);
    doc.setFont('helvetica','bold'); doc.setFontSize(9); setTxt(bc); doc.text(String(sc),PAD+leftW-20,ly+10,{align:'right'});
    setFill(SOFT); doc.roundedRect(PAD,ly+13,leftW-24,6,3,3,'F');
    if(sc>0){ setFill(bc); doc.roundedRect(PAD,ly+13,(leftW-24)*(sc/100),6,3,3,'F'); }
    ly+=26;
  });
  const rx=PAD+leftW+16; let ry=y;
  expData.forEach((exp,i)=>{
    const isTotal=exp.label==='Total Expenses';
    setFill(isTotal?SOFT:(i%2===0?WHITE:[248,248,251])); doc.rect(rx,ry,rightW,15,'F');
    doc.setFont('helvetica',isTotal?'bold':'normal'); doc.setFontSize(isTotal?9:8.5); setTxt(isTotal?DARK:MUTED); doc.text(exp.label,rx+6,ry+10);
    setTxt(isTotal?RED:DARK); doc.text(exp.monthly,rx+rightW-6,ry+10,{align:'right'});
    ry+=15;
  });
  y=Math.max(ly,ry)+12;

  if(data.narrative && y<H-80){
    sectionTitle('Investment Analysis');
    setFill([248,252,250]); setStroke([200,228,210]); doc.setLineWidth(1);
    const narLines=doc.splitTextToSize(data.narrative,W-PAD*2-24);
    const maxNarH=(H-42)-y, rawNarH=narLines.length*13+20, narH=Math.min(rawNarH,maxNarH);
    doc.roundedRect(PAD,y,W-PAD*2,narH,6,6,'FD');
    doc.setFont('helvetica','normal'); doc.setFontSize(9.5); setTxt(DARK);
    doc.text(narLines.slice(0,Math.floor((narH-20)/13)),PAD+12,y+14);
  }

  doc.setFont('helvetica','normal'); doc.setFontSize(8); setTxt(MUTED);
  doc.text('rentaliq.app',W-PAD,H-28,{align:'right'});
  setFill(SOFT); doc.rect(PAD,H-38,W-PAD*2,1,'F');

  const slug=addrShort.replace(/[^a-z0-9]/gi,'_').replace(/__+/g,'_').slice(0,40);
  doc.save(`RentalIQ_${slug}.pdf`);
}

const C = {
  bg:'#f5f5f8', white:'#ffffff', border:'#dddde4', text:'#0d0d0f', muted:'#72727a', soft:'#eaeaef',
  green:'#166638', greenBg:'#ecf6f1', greenBorder:'#96ccb0',
  red:'#a62626',   redBg:'#fdf0f0',   redBorder:'#e0aaaa',
  amber:'#8a5800', amberBg:'#fdf4e8', amberBorder:'#dfc070',
  shadow:'0 1px 2px rgba(0,0,0,0.05), 0 2px 12px rgba(0,0,0,0.06)',
  shadowLg:'0 12px 48px rgba(0,0,0,0.11), 0 2px 8px rgba(0,0,0,0.05)',
};

const VERDICT_CFG = {
  YES:   { color:C.green, bg:C.greenBg, border:C.greenBorder, label:'BUY',     sub:'Meets return thresholds.' },
  NO:    { color:C.red,   bg:C.redBg,   border:C.redBorder,   label:'PASS',    sub:'Does not meet return thresholds.' },
  MAYBE: { color:C.amber, bg:C.amberBg, border:C.amberBorder, label:'CAUTION', sub:'Marginal deal. Review carefully.' },
};

function Card({ children, style }) {
  return (
    <div style={{ background:C.white, border:`1px solid ${C.border}`, borderRadius:14,
      boxShadow:C.shadow, padding:28, marginBottom:14, ...style }}>
      {children}
    </div>
  );
}

function ScoreRing({ score, size=120 }) {
  const color = score>=70?C.green:score>=50?C.amber:C.red;
  const r = (size-8)/2, circ = 2*Math.PI*r;
  const dash = (score/100)*circ;
  return (
    <svg width={size} height={size} style={{transform:'rotate(-90deg)'}}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={C.soft} strokeWidth={7}/>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={7}
        strokeDasharray={`${dash} ${circ-dash}`} strokeLinecap="round"/>
      <text x={size/2} y={size/2} textAnchor="middle" dominantBaseline="central"
        style={{transform:`rotate(90deg) translate(0,-${size}px)`,transformOrigin:`${size/2}px ${size/2}px`}}
        fill={color} fontSize={size*0.22} fontWeight={700} fontFamily="'DM Sans',sans-serif">
        {score}
      </text>
    </svg>
  );
}

export default function SharePage({ initialDeal, initialError }) {
  const [deal,       setDeal]       = useState(initialDeal || null);
  const [loading,    setLoading]    = useState(!initialDeal && !initialError);
  const [error,      setError]      = useState(initialError || '');
  const [copied,     setCopied]     = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);

  useEffect(() => {
    // Only fetch client-side if SSR didn't provide the deal (e.g. error or missing)
    if (initialDeal || initialError) return;
    const token = window.location.pathname.split('/').pop();
    if (!token) { setError('Invalid share link.'); setLoading(false); return; }

    fetch(`/api/deals/public?token=${token}`)
      .then(r => r.json())
      .then(({ deal, error }) => {
        if (error || !deal) setError(error || 'Deal not found.');
        else setDeal(deal);
        setLoading(false);
      })
      .catch(() => { setError('Could not load analysis.'); setLoading(false); });
  }, [initialDeal, initialError]);

  function copyLink() {
    navigator.clipboard.writeText(window.location.href).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  const data = deal?.data || {};
  const verdict = (data.verdict || 'MAYBE').toUpperCase();
  const vc = VERDICT_CFG[verdict] || VERDICT_CFG.MAYBE;
  const score = parseInt(data.overallScore, 10) || 0;
  const s = data._settings || {};
  const keyMetrics = data.keyMetrics || [];

  if (loading) return (
    <div style={{minHeight:'100vh',background:C.bg,display:'flex',alignItems:'center',justifyContent:'center',fontFamily:"'DM Sans',sans-serif"}}>
      <div style={{textAlign:'center'}}>
        <div style={{width:32,height:32,border:`3px solid ${C.border}`,borderTopColor:C.green,borderRadius:'50%',animation:'spin 0.8s linear infinite',margin:'0 auto 16px'}}/>
        <div style={{fontSize:14,color:C.muted}}>Loading analysis...</div>
      </div>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );

  if (error) return (
    <div style={{minHeight:'100vh',background:C.bg,display:'flex',alignItems:'center',justifyContent:'center',fontFamily:"'DM Sans',sans-serif"}}>
      <div style={{textAlign:'center',maxWidth:400,padding:32}}>
        <div style={{fontSize:32,marginBottom:12}}>🔒</div>
        <div style={{fontSize:18,fontWeight:700,color:C.text,marginBottom:8}}>Deal not found</div>
        <div style={{fontSize:14,color:C.muted,marginBottom:24}}>{error}</div>
        <Link href="/analyze" style={{background:C.green,color:'#fff',textDecoration:'none',borderRadius:10,padding:'10px 24px',fontSize:14,fontWeight:700,display:'inline-block'}}>
          Analyze a Property →
        </Link>
      </div>
    </div>
  );

  return (
    <>
      <Head>
        <title>{deal ? `${vc.label}: ${deal.address || 'Property Analysis'} - RentalIQ` : 'Shared Analysis - RentalIQ'}</title>
        <meta name="description" content={deal ? `RentalIQ Score ${score}/100 · ${deal.city || ''} · ${verdict}` : 'Rental property analysis shared via RentalIQ'}/>
        <meta property="og:title" content={deal ? `${vc.label}: ${deal.address || 'Property'} - RentalIQ` : 'RentalIQ Analysis'}/>
        <meta property="og:description" content={deal ? `Score ${score}/100 · ${keyMetrics[0]?.value || ''} cash flow · ${deal.city || ''}` : 'View rental property analysis'}/>
        <meta property="og:type" content="article"/>
        <meta name="twitter:card" content="summary_large_image"/>
        <meta name="twitter:title" content={deal ? `${vc.label}: ${deal.address || 'Property'} - RentalIQ` : 'RentalIQ Analysis'}/>
        <meta name="twitter:description" content={deal ? `Score ${score}/100 · ${verdict} verdict · ${deal.city || ''}` : 'View rental property analysis'}/>
        <meta name="twitter:image" content="https://rentaliq.app/og-image.png"/>
        <meta name="viewport" content="width=device-width,initial-scale=1"/>
        {/* Fonts loaded via _app.js */}
      </Head>

      <style>{`
        *{box-sizing:border-box}
        @keyframes fadeup{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}
        @media print{
          .no-print{display:none!important}
          body{background:#fff!important}
          .print-card{box-shadow:none!important;border:1px solid #ddd!important}
        }
      `}</style>

      <div style={{background:C.bg,minHeight:'100vh',fontFamily:"'DM Sans',system-ui,sans-serif"}}>

        {/* Sticky nav */}
        <nav className="no-print" style={{position:'sticky',top:0,zIndex:100,background:'rgba(245,245,248,0.88)',backdropFilter:'blur(12px)',borderBottom:`1px solid ${C.border}`,padding:'0 32px'}}>
          <div style={{maxWidth:720,margin:'0 auto',display:'flex',alignItems:'center',justifyContent:'space-between',height:52}}>
            <Link href="/" style={{display:'flex',alignItems:'center',gap:8,textDecoration:'none'}}>
              <div style={{width:8,height:8,background:C.green,borderRadius:'50%'}}/>
              <span style={{fontSize:13,fontWeight:700,color:C.text}}>RentalIQ</span>
            </Link>
            <div style={{display:'flex',gap:8}}>
              <button onClick={copyLink}
                style={{fontSize:12.5,fontWeight:600,color:copied?C.green:C.muted,background:copied?C.greenBg:C.white,
                  border:`1px solid ${copied?C.greenBorder:C.border}`,borderRadius:8,padding:'5px 14px',cursor:'pointer',fontFamily:'inherit',transition:'all 0.2s'}}>
                {copied ? '✓ Copied' : 'Copy Link'}
              </button>
              <button onClick={async()=>{
                if(pdfLoading)return;
                setPdfLoading(true);
                try{ await generateSharePDF(deal?.data||{}, deal?.address); }
                catch(e){ alert(e.message||'Could not generate PDF.'); }
                finally{ setPdfLoading(false); }
              }} disabled={pdfLoading}
                style={{fontSize:12.5,fontWeight:600,color:C.text,background:C.white,border:`1px solid ${C.border}`,borderRadius:8,padding:'5px 14px',cursor:pdfLoading?'not-allowed':'pointer',fontFamily:'inherit',opacity:pdfLoading?0.6:1,display:'flex',alignItems:'center',gap:5}}>
                {pdfLoading
                  ? <><span style={{width:10,height:10,border:`2px solid ${C.border}`,borderTopColor:C.green,borderRadius:'50%',animation:'spin 0.6s linear infinite',flexShrink:0}}/>{' '}Generating...</>
                  : 'Save PDF'}
              </button>
              <Link href="/analyze" style={{fontSize:12.5,fontWeight:700,color:'#fff',background:C.green,textDecoration:'none',borderRadius:8,padding:'5px 14px',display:'inline-flex',alignItems:'center'}}>
                Try RentalIQ →
              </Link>
            </div>
          </div>
        </nav>

        <div style={{maxWidth:720,margin:'0 auto',padding:'32px 20px 80px',animation:'fadeup 0.4s ease both'}}>

          {/* Shared by banner */}
          <div className="no-print" style={{background:C.soft,border:`1px solid ${C.border}`,borderRadius:12,padding:'10px 16px',marginBottom:20,fontSize:12.5,color:C.muted,display:'flex',alignItems:'center',gap:8}}>
            <div style={{width:6,height:6,background:C.green,borderRadius:'50%',flexShrink:0}}/>
            Shared analysis · Read-only · {new Date(deal.created_at).toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'})}
          </div>

          {/* CommandCenter-style header */}
          <div className="print-card" style={{background:C.white,border:`1px solid ${C.border}`,borderRadius:14,
            padding:'28px 24px',marginBottom:14,boxShadow:C.shadow,borderLeft:`4px solid ${vc.color}`}}>
            <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:16,marginBottom:20,flexWrap:'wrap'}}>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:54,fontWeight:800,letterSpacing:'-0.04em',color:vc.color,lineHeight:1,marginBottom:8,fontFamily:"'DM Sans',sans-serif"}}>{vc.label}</div>
                <div style={{fontSize:14,color:C.muted,lineHeight:1.5,maxWidth:360}}>{data.verdictSummary || vc.sub}</div>
                {(deal.address || deal.city) && (
                  <div style={{fontSize:13,color:C.text,fontWeight:600,marginTop:10}}>
                    {deal.address}{deal.city && deal.address ? ' · ' : ''}{deal.city}
                  </div>
                )}
              </div>
              <ScoreRing score={score}/>
            </div>

            {/* Key metrics grid */}
            {keyMetrics.length > 0 && (
              <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:10,marginBottom:20}} className="riq-g3">
                {keyMetrics.slice(0,3).map((m,i) => {
                  const c = m.status==='good'?C.green:m.status==='bad'?C.red:C.amber;
                  return (
                    <div key={i} style={{background:C.soft,borderRadius:12,padding:'12px 14px'}}>
                      <div style={{fontSize:9.5,fontWeight:600,letterSpacing:'0.09em',textTransform:'uppercase',color:C.muted,marginBottom:5}}>{m.label}</div>
                      <div style={{fontFamily:"'Libre Baskerville',Georgia,serif",fontSize:i===0?26:20,color:c,lineHeight:1}}>{m.value}</div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Settings used */}
            <div style={{borderTop:`1px solid ${C.border}`,paddingTop:12,fontSize:12,color:C.muted,display:'flex',gap:16,flexWrap:'wrap'}}>
              <span>{s.cashPurchase ? 'Cash purchase' : `${s.downPaymentPct||20}% down · ${s.interestRate||7.25}% rate`}</span>
              {s.hoaMonthly > 0 && <span> · HOA ${s.hoaMonthly}/mo</span>}
              {s.taxAnnualAmount > 0 && <span> · Tax ${s.taxAnnualAmount}/yr</span>}
              {s.selfManage !== undefined && <span>{s.selfManage ? 'Self-managed' : 'With PM'}</span>}
              {s.investorGoal && <span>Goal: {s.investorGoal}</span>}
              {deal.price && <span>Price: {deal.price}</span>}
              {deal.rent && <span>Rent: {deal.rent}/mo</span>}
            </div>
          </div>

          {/* All metrics */}
          {keyMetrics.length > 3 && (
            <Card style={{padding:'20px 24px'}} className="print-card">
              <div style={{fontSize:10,fontWeight:700,letterSpacing:'0.1em',textTransform:'uppercase',color:C.muted,marginBottom:14}}>All Metrics</div>
              <div style={{display:'grid',gridTemplateColumns:'repeat(2,1fr)',gap:8}}>
                {keyMetrics.slice(3).map((m,i) => {
                  const c = m.status==='good'?C.green:m.status==='bad'?C.red:C.amber;
                  return (
                    <div key={i} style={{background:C.soft,borderRadius:10,padding:'10px 12px'}}>
                      <div style={{fontSize:9.5,color:C.muted,textTransform:'uppercase',letterSpacing:'0.08em',marginBottom:3}}>{m.label}</div>
                      <div style={{fontSize:13.5,fontWeight:600,color:c}}>{m.value}</div>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}

          {/* Narrative */}
          {data.narrative && (
            <Card className="print-card">
              <div style={{fontSize:10,fontWeight:700,letterSpacing:'0.1em',textTransform:'uppercase',color:C.muted,marginBottom:12}}>AI Analysis</div>
              <p style={{fontSize:14,color:C.text,lineHeight:1.75,margin:0}}>{data.narrative}</p>
            </Card>
          )}

          {/* Neighborhood */}
          {data.neighborhood && (() => {
            const nb      = data.neighborhood;
            const fmt     = n => n != null ? '$' + n.toLocaleString() : '-';
            const fmtK    = n => n != null ? (n >= 1000 ? (n/1000).toFixed(0)+'k' : n.toLocaleString()) : '-';
            const fmtPct  = n => n != null ? `${n > 0 ? '+' : ''}${n.toFixed(1)}%` : null;
            const sc      = nb.amenityScore;
            const scColor = sc == null ? C.muted : sc >= 7 ? C.green : sc >= 4 ? C.amber : C.red;
            const pulse   = nb.marketPulse  || null;
            const history = nb.priceHistory || null;
            const vacancy = nb.vacancyRate  || null;
            const ptr     = nb.priceToRentRatio;
            const tempColor = t => t==='hot'?C.red:t==='warm'?C.amber:t==='cool'?C.blue:C.muted;
            const tempLabel = t => ({hot:'🔥 Hot',warm:'📈 Warm',neutral:'➡️ Neutral',cool:'📉 Cool',cold:'❄️ Cold'})[t]||t;
            const trendArrow = t => t==='accelerating'?'↗':t==='decelerating'?'↘':'→';
            const trendColor = t => t==='accelerating'?C.green:t==='decelerating'?C.amber:C.muted;
            return (
              <div style={{background:C.white,border:`1px solid ${C.border}`,borderRadius:14,padding:'22px',marginBottom:14}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14,flexWrap:'wrap',gap:8}}>
                  <div style={{fontSize:10,fontWeight:700,letterSpacing:'0.10em',textTransform:'uppercase',color:C.muted}}>Neighborhood</div>
                  <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                    {nb.zip && <span style={{fontSize:11,background:C.soft,border:`1px solid ${C.border}`,borderRadius:6,padding:'3px 8px',color:C.muted,fontWeight:600}}>{nb.zip}</span>}
                    {nb.walkability && nb.walkability !== 'Unknown' && <span style={{fontSize:11,background:C.soft,border:`1px solid ${C.border}`,borderRadius:6,padding:'3px 8px',color:C.muted,fontWeight:600}}>{nb.walkability}</span>}
                    {pulse?.marketTemp && <span style={{fontSize:11,borderRadius:6,padding:'3px 8px',fontWeight:600,background: pulse.marketTemp==='hot'?C.redBg:pulse.marketTemp==='warm'?C.amberBg:C.soft, color:tempColor(pulse.marketTemp), border:`1px solid ${pulse.marketTemp==='hot'?C.redBorder:pulse.marketTemp==='warm'?C.amberBorder:C.border}`}}>{tempLabel(pulse.marketTemp)}</span>}
                  </div>
                </div>
                {/* Demographics */}
                <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:8,marginBottom:12}}>
                  {[
                    {label:'Median Income', val:fmt(nb.medianIncome), sub:'household/yr'},
                    {label:'Median Rent',   val:fmt(nb.medianRent),   sub:'per month'},
                    {label:'Population',    val:fmtK(nb.population),  sub:'ZIP code'},
                  ].map(item=>(
                    <div key={item.label} style={{background:C.soft,borderRadius:8,padding:'10px 12px'}}>
                      <div style={{fontSize:9,fontWeight:700,letterSpacing:'0.08em',textTransform:'uppercase',color:C.muted,marginBottom:3}}>{item.label}</div>
                      <div style={{fontSize:17,fontWeight:800,color:C.text,letterSpacing:'-0.02em',lineHeight:1}}>{item.val}</div>
                      <div style={{fontSize:10,color:C.muted,marginTop:2}}>{item.sub}</div>
                    </div>
                  ))}
                </div>
                {/* Market Pulse */}
                {pulse && (
                  <div style={{background:C.soft,borderRadius:8,padding:'12px 14px',marginBottom:10}}>
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
                      <div style={{fontSize:11,fontWeight:700,color:C.text}}>📊 Market Pulse</div>
                      <div style={{fontSize:9,color:C.muted}}>Redfin · {pulse.asOf||'weekly'}</div>
                    </div>
                    <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:6,textAlign:'center'}}>
                      {pulse.dom!=null&&<div><div style={{fontSize:16,fontWeight:800,color:pulse.dom<=14?C.red:pulse.dom<=30?C.amber:C.blue}}>{pulse.dom}</div><div style={{fontSize:9,color:C.muted}}>Days on Market</div></div>}
                      {pulse.saleToList!=null&&<div><div style={{fontSize:16,fontWeight:800,color:pulse.saleToList>=1.02?C.red:pulse.saleToList>=0.99?C.amber:C.blue}}>{(pulse.saleToList*100).toFixed(1)}%</div><div style={{fontSize:9,color:C.muted}}>Sale-to-List</div></div>}
                      {pulse.inventory!=null&&<div><div style={{fontSize:16,fontWeight:800,color:C.text}}>{pulse.inventory}</div><div style={{fontSize:9,color:C.muted}}>Active Listings</div></div>}
                    </div>
                  </div>
                )}
                {/* Price History */}
                {history && (
                  <div style={{background:C.soft,borderRadius:8,padding:'12px 14px',marginBottom:10}}>
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
                      <div style={{fontSize:11,fontWeight:700,color:C.text}}>🏠 Home Price Trend</div>
                      <div style={{fontSize:9,color:C.muted}}>Case-Shiller{history.metro?` · ${history.metro}`:''}</div>
                    </div>
                    <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:6,textAlign:'center'}}>
                      {history.yoyPct!=null&&<div><div style={{fontSize:16,fontWeight:800,color:history.yoyPct>=0?C.green:C.red}}>{fmtPct(history.yoyPct)}</div><div style={{fontSize:9,color:C.muted}}>1-Year</div></div>}
                      {history.cagr3yr!=null&&<div><div style={{fontSize:16,fontWeight:800,color:history.cagr3yr>=0?C.green:C.red}}>{fmtPct(history.cagr3yr)}/yr</div><div style={{fontSize:9,color:C.muted}}>3yr CAGR</div></div>}
                      {history.cagr5yr!=null&&<div><div style={{fontSize:16,fontWeight:800,color:history.cagr5yr>=0?C.green:C.red}}>{fmtPct(history.cagr5yr)}/yr</div><div style={{fontSize:9,color:C.muted}}>5yr CAGR</div></div>}
                    </div>
                    {history.trend&&<div style={{marginTop:6,textAlign:'center',fontSize:10,fontWeight:600,color:trendColor(history.trend)}}>{trendArrow(history.trend)} {history.trend.charAt(0).toUpperCase()+history.trend.slice(1)}</div>}
                  </div>
                )}
                {/* Vacancy + P/R */}
                {(vacancy||ptr!=null)&&(
                  <div style={{display:'grid',gridTemplateColumns:vacancy&&ptr!=null?'1fr 1fr':'1fr',gap:8,marginBottom:10}}>
                    {vacancy&&<div style={{background:C.soft,borderRadius:8,padding:'10px 12px'}}>
                      <div style={{fontSize:9,fontWeight:700,letterSpacing:'0.08em',textTransform:'uppercase',color:C.muted,marginBottom:3}}>Vacancy Rate</div>
                      <div style={{fontSize:17,fontWeight:800,color:vacancy.rate<=5?C.green:vacancy.rate<=10?C.amber:C.red}}>{vacancy.rate?.toFixed(1)}%</div>
                      <div style={{fontSize:10,color:C.muted,marginTop:2}}>Census ACS {vacancy.asOf||''}</div>
                    </div>}
                    {ptr!=null&&<div style={{background:C.soft,borderRadius:8,padding:'10px 12px'}}>
                      <div style={{fontSize:9,fontWeight:700,letterSpacing:'0.08em',textTransform:'uppercase',color:C.muted,marginBottom:3}}>Price-to-Rent</div>
                      <div style={{fontSize:17,fontWeight:800,color:ptr<=15?C.green:ptr<=25?C.amber:C.red}}>{ptr}x</div>
                      <div style={{fontSize:10,color:C.muted,marginTop:2}}>{ptr<=15?'Cash flow market':ptr<=25?'Balanced':'Appreciation play'}</div>
                    </div>}
                  </div>
                )}
                {/* Amenity Score */}
                {sc!=null&&<div style={{display:'flex',alignItems:'center',justifyContent:'space-between',background:C.soft,borderRadius:8,padding:'10px 14px',marginBottom:10}}>
                  <div style={{fontSize:12,fontWeight:600,color:C.text}}>Amenity Score (0.5 mi)</div>
                  <div style={{fontSize:22,fontWeight:800,color:scColor}}>{sc}<span style={{fontSize:12,color:C.muted,fontWeight:400}}>/10</span></div>
                </div>}
                {/* Amenities */}
                {nb.amenities && (
                  <div style={{display:'grid',gridTemplateColumns:'repeat(5,1fr)',gap:6}}>
                    {[
                      {icon:'🛒',label:'Grocery',  val:nb.amenities.grocery},
                      {icon:'🚌',label:'Transit',  val:nb.amenities.transit},
                      {icon:'🍽',label:'Dining',   val:nb.amenities.restaurants},
                      {icon:'🌳',label:'Parks',    val:nb.amenities.parks},
                      {icon:'🏫',label:'Schools',  val:nb.amenities.schools},
                    ].map(a=>(
                      <div key={a.label} style={{background:C.white,border:`1px solid ${C.border}`,borderRadius:6,padding:'6px 4px',textAlign:'center'}}>
                        <div style={{fontSize:14,marginBottom:2}}>{a.icon}</div>
                        <div style={{fontSize:12,fontWeight:700,color:a.val>0?C.text:C.muted}}>{a.val??'-'}</div>
                        <div style={{fontSize:9,color:C.muted}}>{a.label}</div>
                      </div>
                    ))}
                  </div>
                )}
                <div style={{fontSize:10,color:C.muted,marginTop:10,textAlign:'center'}}>
                  Census ACS {nb.censusYear||'2023'}{pulse?' · Redfin':''}{history?' · S&P Case-Shiller':''} · OpenStreetMap
                </div>
              </div>
            );
          })()}

          {/* Pros & Cons */}
          {(data.pros?.length || data.cons?.length) && (
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:14}}>
              {data.pros?.length > 0 && (
                <div style={{background:C.greenBg,border:`1px solid ${C.greenBorder}`,borderRadius:14,padding:'18px 20px'}}>
                  <div style={{fontSize:10,fontWeight:700,letterSpacing:'0.1em',textTransform:'uppercase',color:C.green,marginBottom:10}}>Pros</div>
                  {data.pros.map((p,i) => (
                    <div key={i} style={{fontSize:13,color:C.text,marginBottom:6,paddingLeft:14,position:'relative'}}>
                      <span style={{position:'absolute',left:0,color:C.green}}>✓</span>{p}
                    </div>
                  ))}
                </div>
              )}
              {data.cons?.length > 0 && (
                <div style={{background:C.redBg,border:`1px solid ${C.redBorder}`,borderRadius:14,padding:'18px 20px'}}>
                  <div style={{fontSize:10,fontWeight:700,letterSpacing:'0.1em',textTransform:'uppercase',color:C.red,marginBottom:10}}>Cons</div>
                  {data.cons.map((c,i) => (
                    <div key={i} style={{fontSize:13,color:C.text,marginBottom:6,paddingLeft:14,position:'relative'}}>
                      <span style={{position:'absolute',left:0,color:C.red}}>✗</span>{c}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Disclaimer */}
          <div style={{background:C.amberBg,border:`1px solid ${C.amberBorder}`,borderRadius:12,padding:'12px 16px',fontSize:12.5,color:C.amber,lineHeight:1.6}}>
            Not financial advice. Verify with a licensed property manager and lender before investing.
          </div>

          {/* CTA */}
          <div className="no-print" style={{marginTop:24,background:C.white,border:`1.5px solid ${C.border}`,borderRadius:14,padding:'20px 24px',display:'flex',alignItems:'center',justifyContent:'space-between',gap:16,flexWrap:'wrap'}}>
            <div>
              <div style={{fontSize:14,fontWeight:600,color:C.text,marginBottom:3}}>Analyze your own property</div>
              <div style={{fontSize:12.5,color:C.muted}}>Free to start · 1 token included · No credit card required</div>
            </div>
            <Link href="/analyze" style={{background:C.green,color:'#fff',textDecoration:'none',borderRadius:10,padding:'11px 22px',fontSize:13.5,fontWeight:700,whiteSpace:'nowrap',display:'inline-block'}}>
              Try RentalIQ Free →
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}

// -- SSR for OG crawlers ------------------------------------------------------
export async function getServerSideProps({ params }) {
  const { token } = params;

  try {
    const { getSupabaseAdmin } = await import('../../lib/supabase.js');
    const db = getSupabaseAdmin();
    const { data: deal } = await db
      .from('deals')
      .select('id, address, city, verdict, score, price, rent, cashflow, coc, data, created_at')
      .eq('share_token', token)
      .eq('is_public', true)
      .single();

    if (!deal) return { props: { initialDeal: null, initialError: 'Deal not found or no longer shared.' } };
    return { props: { initialDeal: deal, initialError: null } };
  } catch (_) {
    // If Supabase not configured, fall back to client-side fetch
    return { props: { initialDeal: null, initialError: null } };
  }
}
