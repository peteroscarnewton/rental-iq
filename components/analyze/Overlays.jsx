import { useState, useRef, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { C } from './tokens';
import { generateDealMemo } from '../../lib/pdfExport';

export function ShareToolbar({data, dealId}) {
  const [shareUrl,      setShareUrl]      = useState(null);
  const [shareLoading,  setShareLoading]  = useState(false);
  const [shareErr,      setShareErr]      = useState('');
  const [copied,        setCopied]        = useState(false);
  const [emailSending,  setEmailSending]  = useState(false);
  const [emailSent,     setEmailSent]     = useState(false);
  const [emailErr,      setEmailErr]      = useState('');
  const [pdfLoading,    setPdfLoading]    = useState(false);
  const [pdfErr,        setPdfErr]        = useState('');
  const { data: session } = useSession();

  async function handleShare() {
    if (shareUrl) {
      navigator.clipboard.writeText(shareUrl).then(() => { setCopied(true); setTimeout(()=>setCopied(false), 2000); });
      return;
    }
    if (!dealId) { setShareErr('Sign in to enable sharing.'); setTimeout(()=>setShareErr(''),3000); return; }
    setShareLoading(true); setShareErr('');
    try {
      const res  = await fetch('/api/deals/share', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ dealId }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      setShareUrl(body.shareUrl);
      navigator.clipboard.writeText(body.shareUrl).then(() => { setCopied(true); setTimeout(()=>setCopied(false), 2000); });
    } catch(e) {
      setShareErr(e.message || 'Could not create share link.');
      setTimeout(()=>setShareErr(''),4000);
    } finally { setShareLoading(false); }
  }

  async function handleRevoke() {
    if (!dealId) return;
    try {
      await fetch('/api/deals/unshare', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ dealId }) });
      setShareUrl(null);
    } catch(_) {}
  }

  async function handleEmail() {
    if (!session?.user) { setEmailErr('Sign in to email yourself this report.'); setTimeout(()=>setEmailErr(''),3000); return; }
    setEmailSending(true); setEmailErr('');
    try {
      let resolvedShareUrl = shareUrl;
      if (!resolvedShareUrl && dealId) {
        try {
          const sr = await fetch('/api/deals/share', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ dealId }) });
          const sb = await sr.json();
          if (sr.ok && sb.shareUrl) { resolvedShareUrl = sb.shareUrl; setShareUrl(sb.shareUrl); }
        } catch(_) {}
      }
      const res  = await fetch('/api/deals/email', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ analysisData: data, shareUrl: resolvedShareUrl }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      setEmailSent(true);
      setTimeout(() => setEmailSent(false), 4000);
    } catch(e) {
      setEmailErr(e.message || 'Could not send email.');
      setTimeout(() => setEmailErr(''), 4000);
    } finally { setEmailSending(false); }
  }

  const btnBase = {
    display:'flex', alignItems:'center', gap:6, fontSize:12.5, fontWeight:600,
    borderRadius:9, padding:'8px 14px', cursor:'pointer', fontFamily:'inherit',
    border:`1px solid ${C.border}`, background:C.white, color:C.text,
    transition:'background 0.15s',
  };

  return (
    <div style={{marginBottom:14,background:C.white,border:`1px solid ${C.border}`,borderRadius:14,padding:'16px 20px'}}>
      <div style={{fontSize:11,fontWeight:600,letterSpacing:'0.1em',textTransform:'uppercase',color:C.muted,marginBottom:12}}>Share &amp; Export</div>
      <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>

        {/* Share link */}
        <button onClick={handleShare} disabled={shareLoading}
          style={{...btnBase, ...(shareUrl ? {color:C.green,background:C.greenBg,borderColor:C.greenBorder} : shareErr ? {color:C.red,background:C.redBg,borderColor:C.redBorder} : {})}}>
          {shareLoading
            ? <><span style={{width:10,height:10,border:`2px solid ${C.border}`,borderTopColor:C.green,borderRadius:'50%',animation:'riq-spin 0.6s linear infinite',flexShrink:0}}/> Sharing...</>
            : copied
            ? <>✓ Link copied</>
            : shareErr
            ? <>{shareErr}</>
            : shareUrl
            ? <>Copy link</>
            : <>Share</>}
        </button>

        {/* Revoke link - shown once share is active */}
        {shareUrl && (
          <button onClick={handleRevoke} style={{...btnBase, color:C.muted, fontSize:12}}>
            Revoke link
          </button>
        )}

        {/* Save PDF */}
        <button onClick={async()=>{
          if(pdfLoading)return;
          setPdfLoading(true); setPdfErr('');
          try{ await generateDealMemo(data); }
          catch(e){ setPdfErr(e.message||'Could not generate PDF.'); setTimeout(()=>setPdfErr(''),4000); }
          finally{ setPdfLoading(false); }
        }} disabled={pdfLoading} style={{...btnBase,...(pdfLoading?{opacity:0.6,cursor:'not-allowed'}:pdfErr?{color:C.red,background:C.redBg,borderColor:C.redBorder}:{})}}>
          {pdfLoading
            ? <><span style={{width:10,height:10,border:`2px solid ${C.border}`,borderTopColor:C.green,borderRadius:'50%',animation:'riq-spin 0.6s linear infinite',flexShrink:0}}/> Generating...</>
            : pdfErr ? <>{pdfErr}</>
            : <>↓ Save PDF</>}
        </button>

        {/* Email report */}
        <button onClick={handleEmail} disabled={emailSending}
          style={{...btnBase, ...(emailSent ? {color:C.green,background:C.greenBg,borderColor:C.greenBorder} : emailErr ? {color:C.red,background:C.redBg,borderColor:C.redBorder} : {})}}>
          {emailSending ? 'Sending...' : emailSent ? '✓ Sent to your email' : emailErr ? emailErr : '✉ Email report'}
        </button>

      </div>
    </div>
  );
}

export function FloatingChat({data,investorProfile,onUpdateAnalysis,openRef}) {
  const [open,setOpen]           = useState(false);
  const [input,setInput]         = useState('');
  const [history,setHistory]     = useState([]);
  const [loading,setLoading]     = useState(false);
  const [error,setError]         = useState('');
  const [showSuggestions,setShowSuggestions] = useState(false);
  const endRef   = useRef(null);
  const inputRef = useRef(null);

  // Register open callback so parent can trigger without DOM queries
  useEffect(() => { if (openRef) openRef.current = () => setOpen(true); }, [openRef]);

  useEffect(()=>{ endRef.current?.scrollIntoView({behavior:'smooth'}); },[history,loading]);
  useEffect(()=>{ if(open) setTimeout(()=>inputRef.current?.focus(),120); },[open]);

  const SUGGESTED = [
    'What if I paid all cash?',
    'What if I put 10% down?',
    'What if I self-managed?',
    'Is this good for appreciation?',
    'What rent do I need to cash flow?',
  ];

  async function sendMessage(msg) {
    const text=(msg||input).trim();
    if (!text) return;
    setInput('');setError('');
    const next=[...history,{role:'user',content:text}];
    setHistory(next);setLoading(true);
    try {
      const res=await fetch('/api/chat',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({message:text,history,currentAnalysis:data,investorProfile})});
      const body=await res.json();
      if (!res.ok) throw new Error(body?.error||`Error ${res.status}`);
      setHistory(h=>[...h,{role:'assistant',content:body.reply,scenarioLabel:body.scenarioLabel}]);
      if (body.updatedAnalysis) onUpdateAnalysis(body.updatedAnalysis,body.scenarioLabel);
    } catch(e) {
      setError(e.message||'Something went wrong.');
    } finally { setLoading(false); }
  }

  return (
    <div style={{position:'fixed',bottom:24,right:24,zIndex:1000,display:'flex',flexDirection:'column',alignItems:'flex-end',gap:10}}>
      {open&&(
        <div className="riq-chat-panel" style={{width:360,height:520,background:C.white,borderRadius:20,boxShadow:C.shadowLg,border:`1px solid ${C.border}`,display:'flex',flexDirection:'column',animation:'riq-fadeup 0.25s ease both',overflow:'hidden'}}>
          <div style={{padding:'14px 18px',borderBottom:`1px solid ${C.border}`,display:'flex',alignItems:'center',justifyContent:'space-between',background:C.green}}>
            <div>
              <div style={{fontSize:14,fontWeight:700,color:'#fff'}}>Ask anything</div>
              <div style={{fontSize:11,color:'rgba(255,255,255,0.75)'}}>Scenario changes update the page live</div>
            </div>
            <button onClick={()=>setOpen(false)} style={{background:'rgba(255,255,255,0.2)',border:'none',borderRadius:8,width:28,height:28,cursor:'pointer',color:'#fff',fontSize:14,display:'flex',alignItems:'center',justifyContent:'center'}}>✕</button>
          </div>
          <div style={{flex:1,overflowY:'auto',padding:'14px',display:'flex',flexDirection:'column',gap:10}}>
            {history.length===0&&(
              <div style={{display:'flex',flexDirection:'column',gap:8}}>
                <p style={{fontSize:13,color:C.muted,margin:0,lineHeight:1.6}}>I know this deal. Ask me anything - I'll update the numbers live when the scenario changes.</p>
                {SUGGESTED.map((q,i)=>(
                  <button key={i} onClick={()=>sendMessage(q)}
                    style={{background:C.soft,border:`1px solid ${C.border}`,borderRadius:10,padding:'8px 12px',cursor:'pointer',fontFamily:'inherit',textAlign:'left',fontSize:12.5,color:C.text,transition:'background 0.15s'}}
                    onMouseEnter={e=>e.currentTarget.style.background=C.greenBg}
                    onMouseLeave={e=>e.currentTarget.style.background=C.soft}>
                    {q}
                  </button>
                ))}
              </div>
            )}
            {history.map((m,i)=>(
              <div key={i} style={{display:'flex',flexDirection:'column',gap:4,alignItems:m.role==='user'?'flex-end':'flex-start'}}>
                {m.scenarioLabel&&<div style={{fontSize:10,fontWeight:700,color:C.green,background:C.greenBg,borderRadius:100,padding:'2px 10px'}}>↻ Updated: {m.scenarioLabel}</div>}
                <div style={{maxWidth:'85%',padding:'10px 13px',borderRadius:m.role==='user'?'14px 14px 4px 14px':'14px 14px 14px 4px',background:m.role==='user'?C.green:C.soft,color:m.role==='user'?'#fff':C.text,fontSize:13.5,lineHeight:1.6}}>{m.content}</div>
              </div>
            ))}
            {/* After conversation started, offer suggestion chips via toggle */}
            {history.length > 0 && !loading && (
              <div style={{display:'flex',flexDirection:'column',gap:6}}>
                <button onClick={()=>setShowSuggestions(s=>!s)}
                  style={{alignSelf:'flex-start',background:'none',border:`1px solid ${C.border}`,borderRadius:100,padding:'3px 10px',fontSize:11,color:C.muted,cursor:'pointer',fontFamily:'inherit'}}>
                  {showSuggestions ? 'Hide suggestions ▲' : 'Suggestions ▼'}
                </button>
                {showSuggestions && SUGGESTED.map((q,i)=>(
                  <button key={i} onClick={()=>{sendMessage(q);setShowSuggestions(false);}}
                    style={{background:C.soft,border:`1px solid ${C.border}`,borderRadius:10,padding:'7px 11px',cursor:'pointer',fontFamily:'inherit',textAlign:'left',fontSize:12,color:C.text,transition:'background 0.15s'}}
                    onMouseEnter={e=>e.currentTarget.style.background=C.greenBg}
                    onMouseLeave={e=>e.currentTarget.style.background=C.soft}>
                    {q}
                  </button>
                ))}
              </div>
            )}
            {loading&&(
              <div style={{display:'flex',alignItems:'center',gap:8,padding:'10px 13px',background:C.soft,borderRadius:'14px 14px 14px 4px',width:'fit-content'}}>
                {[0,1,2].map(i=><div key={i} style={{width:6,height:6,borderRadius:'50%',background:C.muted,animation:`riq-bounce 1.2s ${i*0.15}s infinite`}}/>)}
              </div>
            )}
            {error&&<div style={{fontSize:12.5,color:C.red,background:C.redBg,border:`1px solid ${C.redBorder}`,borderRadius:10,padding:'8px 12px'}}>{error}</div>}
            <div ref={endRef}/>
          </div>
          <div style={{padding:'10px 14px',borderTop:`1px solid ${C.border}`,display:'flex',gap:8}}>
            <input ref={inputRef} value={input} onChange={e=>setInput(e.target.value)}
              onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendMessage();}}}
              placeholder="e.g. What if I paid cash?"
              style={{...inputBase,flex:1,padding:'9px 13px',fontSize:13,borderRadius:10}}/>
            <button onClick={()=>sendMessage()} disabled={!input.trim()||loading}
              style={{background:C.green,border:'none',borderRadius:10,width:38,height:38,cursor:input.trim()&&!loading?'pointer':'default',opacity:input.trim()&&!loading?1:0.4,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M2 8L14 2L8 14L7 9L2 8Z" fill="white" stroke="white" strokeWidth="0.5" strokeLinejoin="round"/></svg>
            </button>
          </div>
        </div>
      )}
      {/* Bubble - no spurious badge */}
      <button data-chat-bubble onClick={()=>setOpen(o=>!o)}
        style={{width:56,height:56,borderRadius:'50%',background:C.green,border:'none',cursor:'pointer',boxShadow:C.shadowLg,display:'flex',alignItems:'center',justifyContent:'center',transition:'transform 0.2s',animation:'riq-popin 0.4s cubic-bezier(0.34,1.56,0.64,1) both'}}
        onMouseEnter={e=>e.currentTarget.style.transform='scale(1.1)'}
        onMouseLeave={e=>e.currentTarget.style.transform='scale(1)'}>
        {open
          ? <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M4 4L16 16M16 4L4 16" stroke="white" strokeWidth="2.2" strokeLinecap="round"/></svg>
          : <svg width="22" height="22" viewBox="0 0 22 22" fill="none"><path d="M4 6h14M4 10h10M4 14h8" stroke="white" strokeWidth="2" strokeLinecap="round"/></svg>
        }
      </button>
    </div>
  );
}

// --- Results page --------------------------------------------------------------

// -- NeighborhoodCard ---------------------------------------------------------
