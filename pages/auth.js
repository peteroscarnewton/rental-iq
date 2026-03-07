import { useState, useEffect } from 'react';
import { signIn, useSession } from 'next-auth/react';
import { useRouter } from 'next/router';
import Head from 'next/head';

const C = {
  bg:'#f5f5f8', white:'#ffffff', border:'#dddde4', text:'#0d0d0f', muted:'#72727a', soft:'#eaeaef',
  green:'#166638', greenBg:'#ecf6f1', greenBorder:'#96ccb0',
  red:'#a62626', redBg:'#fdf0f0', redBorder:'#e0aaaa',
  blue:'#1649a0', blueBg:'#edf1fc',
  shadow:'0 1px 2px rgba(0,0,0,0.05), 0 2px 12px rgba(0,0,0,0.06)',
  shadowLg:'0 12px 48px rgba(0,0,0,0.11), 0 2px 8px rgba(0,0,0,0.05)',
};

export default function AuthPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const { callbackUrl = '/analyze', error, ref } = router.query;

  // Persist ?plan= param so analyze.js can open token purchase after login
  useEffect(() => {
    if (router.query.plan) {
      sessionStorage.setItem('riq-pending-plan', router.query.plan);
    }
  }, [router.query.plan]);

  const [googleLoading,setGoogleLoading]= useState(false);

  // Redirect if already signed in - claim referral first if present
  useEffect(() => {
    if (status !== 'authenticated') return;
    // ref from query param OR from sessionStorage (set when user came via /?ref=CODE)
    const refCode = ref || (typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('pendingRef') : null);
    if (refCode) {
      if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem('pendingRef');
      // Attempt to claim referral (fire and forget - don't block redirect)
      fetch('/api/referral/claim', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: refCode }),
      }).catch(() => {});
    }
    router.replace(callbackUrl);
  }, [status, callbackUrl, ref, router]);

  const errorMessages = {
    OAuthSignin:        'Problem starting sign in. Try again.',
    OAuthCallback:      'Problem completing sign in. Try again.',
    OAuthCreateAccount: 'Could not create account. Try again.',
    EmailCreateAccount: 'Could not create account. Try again.',
    Callback:           'Sign in callback failed. Try again.',
    EmailSignin:        'Could not send email. Check the address.',
    CredentialsSignin:  'Invalid credentials.',
    default:            'Something went wrong. Try again.',
  };
  const errorMsg = error ? (errorMessages[error] || errorMessages.default) : '';

  async function handleGoogle() {
    setGoogleLoading(true);
    await signIn('google', { callbackUrl });
  }

  if (status === 'loading' || status === 'authenticated') {
    return (
      <div style={{display:'flex',alignItems:'center',justifyContent:'center',minHeight:'100vh',background:C.bg}}>
        <div style={{width:36,height:36,borderRadius:'50%',border:`3px solid ${C.border}`,borderTopColor:C.green,animation:'spin 0.8s linear infinite'}}/>
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      </div>
    );
  }

  return (
    <>
      <Head>
        <title>Sign In - RentalIQ</title>
        <meta name="viewport" content="width=device-width, initial-scale=1"/>
      </Head>
      <style>{`
        *{box-sizing:border-box;margin:0;padding:0}
        body{background:${C.bg};font-family:'DM Sans',system-ui,sans-serif}
        @keyframes fadeup{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
        @keyframes spin{to{transform:rotate(360deg)}}
      `}</style>

      <div style={{minHeight:'100vh',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',padding:'24px',background:`radial-gradient(ellipse 800px 400px at 50% 0%, rgba(22,102,56,0.06) 0%, transparent 70%), ${C.bg}`}}>

        {/* Logo */}
        <a href="/" style={{display:'flex',alignItems:'center',gap:8,marginBottom:40,textDecoration:'none'}}>
          <div style={{width:8,height:8,background:C.green,borderRadius:'50%'}}/>
          <span style={{fontSize:13,fontWeight:700,letterSpacing:'-0.01em',color:C.text}}>RentalIQ</span>
        </a>

        <div style={{width:'100%',maxWidth:400,animation:'fadeup 0.4s ease both'}}>

          {/* Card */}
          <div style={{background:C.white,border:`1px solid ${C.border}`,borderRadius:20,boxShadow:C.shadowLg,padding:'36px 32px'}}>

            <h1 style={{fontFamily:"'Libre Baskerville',Georgia,serif",fontSize:24,fontWeight:700,color:C.text,marginBottom:8,letterSpacing:'-0.02em'}}>
              Sign in to RentalIQ
            </h1>
            <p style={{fontSize:13.5,color:C.muted,marginBottom:28,lineHeight:1.5}}>
              Your deal history and token balance are tied to your account.
            </p>

            {/* Error banner */}
            {errorMsg && (
              <div style={{background:C.redBg,border:`1px solid ${C.redBorder}`,borderRadius:10,padding:'10px 14px',marginBottom:20,fontSize:13,color:C.red}}>
                {errorMsg}
              </div>
            )}

            {/* Google sign in */}
            <button
              onClick={handleGoogle}
              disabled={googleLoading}
              style={{width:'100%',display:'flex',alignItems:'center',justifyContent:'center',gap:10,background:C.white,border:`1.5px solid ${C.border}`,borderRadius:12,padding:'13px',fontSize:14,fontWeight:600,color:C.text,cursor:'pointer',fontFamily:'inherit',transition:'border-color 0.15s, box-shadow 0.15s',opacity:googleLoading?0.6:1}}
              onMouseEnter={e=>{e.currentTarget.style.borderColor=C.text;e.currentTarget.style.boxShadow=C.shadow;}}
              onMouseLeave={e=>{e.currentTarget.style.borderColor=C.border;e.currentTarget.style.boxShadow='none';}}
            >
              {googleLoading
                ? <div style={{width:18,height:18,border:`2px solid ${C.border}`,borderTopColor:C.text,borderRadius:'50%',animation:'spin 0.7s linear infinite'}}/>
                : <svg width="18" height="18" viewBox="0 0 18 18"><path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z" fill="#4285F4"/><path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.909-2.259c-.806.54-1.837.86-3.047.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z" fill="#34A853"/><path d="M3.964 10.71c-.18-.54-.282-1.117-.282-1.71s.102-1.17.282-1.71V4.958H.957C.347 6.173 0 7.548 0 9s.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/><path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/></svg>
              }
              {googleLoading ? 'Signing in...' : 'Continue with Google'}
            </button>
          </div>

          <p style={{textAlign:'center',fontSize:12,color:C.muted,marginTop:20,lineHeight:1.6}}>
            By signing in you agree to our{' '}
            <a href="/terms" style={{color:C.muted,textDecoration:'underline'}}>Terms</a>
            {' '}and{' '}
            <a href="/privacy" style={{color:C.muted,textDecoration:'underline'}}>Privacy Policy</a>.
            <br/>New accounts receive 2 free tokens — 1 analysis + 1 Scout search.
          </p>
        </div>
      </div>
    </>
  );
}
