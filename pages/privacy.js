import Head from 'next/head';
import Link from 'next/link';

const C = {
  bg:'#f5f5f8', white:'#ffffff', border:'#dddde4',
  text:'#0d0d0f', muted:'#72727a', green:'#166638',
};

export default function Privacy() {
  return (
    <>
      <Head>
        <title>Privacy Policy - RentalIQ</title>
        <meta name="viewport" content="width=device-width, initial-scale=1"/>
      </Head>
      <style>{`*{box-sizing:border-box;margin:0;padding:0} body{background:${C.bg};font-family:'DM Sans',system-ui,sans-serif}`}</style>

      <nav style={{position:'sticky',top:0,background:'rgba(245,245,248,0.88)',backdropFilter:'blur(12px)',borderBottom:`1px solid ${C.border}`,padding:'0 32px',zIndex:100}}>
        <div style={{maxWidth:720,margin:'0 auto',height:52,display:'flex',alignItems:'center',justifyContent:'space-between'}}>
          <Link href="/" style={{display:'flex',alignItems:'center',gap:8,textDecoration:'none'}}>
            <div style={{width:8,height:8,background:C.green,borderRadius:'50%'}}/>
            <span style={{fontSize:13,fontWeight:700,color:C.text}}>RentalIQ</span>
          </Link>
          <Link href="/analyze" style={{fontSize:13,color:C.muted,textDecoration:'none'}}>← Back to app</Link>
        </div>
      </nav>

      <div style={{maxWidth:680,margin:'0 auto',padding:'56px 24px 80px'}}>
        <h1 style={{fontFamily:"'Libre Baskerville',Georgia,serif",fontSize:36,fontWeight:700,color:C.text,marginBottom:8,letterSpacing:'-0.025em'}}>Privacy Policy</h1>
        <p style={{fontSize:13,color:C.muted,marginBottom:40}}>Last updated: January 2025</p>

        {[
          {h:'What We Collect', body:'When you use RentalIQ, we collect: your email address (for account creation and magic link auth), property data you submit for analysis (listing URLs, price, rent, location), your analysis history and results, and basic usage metadata (timestamps, analysis count). We do not collect payment card details - those go directly to Stripe.'},
          {h:'How We Use Your Data', body:'We use your data to: provide the analysis service, save your deal history to your account, send you analysis reports you request, process token purchases via Stripe, and improve our models and service quality using aggregated anonymized data. We never sell your personal data.'},
          {h:'Data Storage', body:'Your account data and deal history are stored in Supabase (a PostgreSQL-based database hosted on AWS). Stripe handles all payment processing and stores payment method data under their own privacy policy. We store the minimum data needed to provide the service.'},
          {h:'Third-Party Services', body:'We use: Google OAuth for sign-in (governed by Google\'s Privacy Policy), Stripe for payments, Supabase for database, Resend for transactional email, Google Gemini API for AI analysis (prompts sent include property data you provide - no personal identifiers). We do not use advertising trackers or analytics beyond basic server logs.'},
          {h:'Your Rights', body:'You can request deletion of your account and all associated data at any time by emailing privacy@rentaliq.app. You can also export your deal history from your dashboard. We will respond to deletion requests within 30 days.'},
          {h:'Cookies', body:'We use a single session cookie to keep you signed in (via NextAuth.js). We do not use advertising cookies, tracking pixels, or cross-site trackers.'},
          {h:'Security', body:'We use HTTPS everywhere, store passwords as salted hashes (we use magic links and Google OAuth - no passwords are stored), and apply the principle of least privilege to database access. We cannot guarantee perfect security, but we take reasonable measures to protect your data.'},
          {h:'Contact', body:'Privacy questions? Email privacy@rentaliq.app. We aim to respond within 5 business days.'},
        ].map((s, i) => (
          <div key={i} style={{marginBottom:32}}>
            <h2 style={{fontSize:17,fontWeight:700,color:C.text,marginBottom:10}}>{s.h}</h2>
            <p style={{fontSize:14.5,color:C.text,lineHeight:1.75}}>{s.body}</p>
          </div>
        ))}

        <div style={{borderTop:`1px solid ${C.border}`,paddingTop:24,marginTop:8,display:'flex',gap:20}}>
          <Link href="/terms" style={{fontSize:13,color:C.green,textDecoration:'none',fontWeight:500}}>Terms of Service →</Link>
          <Link href="/analyze" style={{fontSize:13,color:C.muted,textDecoration:'none'}}>Back to RentalIQ →</Link>
        </div>
      </div>
    </>
  );
}
