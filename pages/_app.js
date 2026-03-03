import { SessionProvider } from 'next-auth/react';
import { Component, useEffect } from 'react';
import Head from 'next/head';
import '../styles/globals.css';

// Register service worker once on first client load
function usePWA() {
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker
        .register('/sw.js', { scope: '/' })
        .catch(err => console.warn('[PWA] SW registration failed:', err));
    }
  }, []);
}

// Global error boundary - catches unhandled React render errors
class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { hasError: false, error: null }; }

  static getDerivedStateFromError(error) { return { hasError: true, error }; }

  componentDidCatch(error, info) {
    console.error('Unhandled render error:', error, info);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div style={{minHeight:'100vh',background:'#f5f5f8',display:'flex',alignItems:'center',
        justifyContent:'center',fontFamily:'system-ui,sans-serif',padding:20}}>
        <div style={{textAlign:'center',maxWidth:400}}>
          <div style={{fontSize:48,marginBottom:12}}>⚠️</div>
          <div style={{fontSize:20,fontWeight:700,color:'#0d0d0f',marginBottom:8}}>Something went wrong</div>
          <div style={{fontSize:14,color:'#72727a',marginBottom:24,lineHeight:1.6}}>
            An unexpected error occurred. Reload the page to continue.
          </div>
          <button onClick={()=>window.location.reload()}
            style={{background:'#166638',color:'#fff',border:'none',borderRadius:10,
              padding:'11px 24px',fontSize:14,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>
            Reload
          </button>
        </div>
      </div>
    );
  }
}

export default function App({ Component, pageProps: { session, ...pageProps } }) {
  usePWA();
  return (
    <ErrorBoundary>
      <SessionProvider session={session}>
        {/* PWA meta tags - applied to every page */}
        <Head>
          <meta name="application-name"    content="RentalIQ"/>
          <meta name="apple-mobile-web-app-capable"         content="yes"/>
          <meta name="apple-mobile-web-app-status-bar-style" content="default"/>
          <meta name="apple-mobile-web-app-title"           content="RentalIQ"/>
          <meta name="mobile-web-app-capable"               content="yes"/>
          <meta name="theme-color"         content="#166638"/>
          <meta name="msapplication-TileColor" content="#166638"/>
          <link rel="manifest"             href="/manifest.json"/>
          <link rel="apple-touch-icon"     href="/icon-192.png"/>
          <link rel="icon" type="image/svg+xml" href="/icon.svg"/>
          <link rel="icon" type="image/png" sizes="192x192" href="/icon-192.png"/>
          {/* Global fonts - loaded once here so 404/500/index don't each duplicate them */}
          <link rel="preconnect" href="https://fonts.googleapis.com"/>
          <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous"/>
          <link href="https://fonts.googleapis.com/css2?family=Instrument+Serif&family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600;9..40,700&display=swap" rel="stylesheet"/>
        </Head>
        <Component {...pageProps} />
      </SessionProvider>
    </ErrorBoundary>
  );
}
