import Head from 'next/head';
import Link from 'next/link';

const C = {
  bg:'#f5f5f8', white:'#ffffff', border:'#dddde4',
  text:'#0d0d0f', muted:'#72727a', green:'#166638',
  shadow:'0 1px 2px rgba(0,0,0,0.05), 0 2px 12px rgba(0,0,0,0.06)',
};

export default function Terms() {
  return (
    <>
      <Head>
        <title>Terms of Service - RentalIQ</title>
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
        <h1 style={{fontFamily:"'Libre Baskerville',Georgia,serif",fontSize:36,fontWeight:700,color:C.text,marginBottom:8,letterSpacing:'-0.025em'}}>Terms of Service</h1>
        <p style={{fontSize:13,color:C.muted,marginBottom:40}}>Last updated: January 2025</p>

        {[
          {h:'1. Acceptance of Terms', body:'By accessing or using RentalIQ, you agree to be bound by these Terms of Service. If you do not agree, do not use the service.'},
          {h:'2. Not Financial Advice', body:'RentalIQ provides real estate investment analysis tools for informational purposes only. Nothing on this platform constitutes financial, investment, tax, or legal advice. Always consult a licensed professional before making investment decisions. You are solely responsible for any investment decisions you make.'},
          {h:'3. Analysis Accuracy', body:'Our analyses are based on the data you provide and publicly available market data. We cannot guarantee the accuracy, completeness, or timeliness of any analysis. Property values, rents, interest rates, and market conditions change continuously. Results are estimates only. Financial data (mortgage rates, HUD rents, appreciation rates) is refreshed automatically from public sources. Legal data (landlord laws, rent control, STR regulations) is automatically refreshed from the Eviction Lab, NLIHC, and NMHC preemption tracker — sources maintained by housing policy researchers. While we update this data regularly, local ordinance changes can occur between refresh cycles. Always verify with a qualified real estate attorney before making investment decisions.'},
          {h:'4. Account & Tokens', body:'You are responsible for maintaining the security of your account. Analysis tokens are non-refundable once used. Tokens do not expire. We reserve the right to suspend accounts that violate these terms.'},
          {h:'5. Acceptable Use', body:'You may not use RentalIQ to: (a) violate any applicable law; (b) scrape or automate requests beyond normal usage; (c) attempt to circumvent rate limits or access controls; (d) reverse engineer the service; (e) resell access without authorization.'},
          {h:'6. Intellectual Property', body:'RentalIQ and its content are owned by us and protected by intellectual property laws. You retain ownership of any data you input. We may use aggregated, anonymized data to improve our service.'},
          {h:'7. Limitation of Liability', body:'To the maximum extent permitted by law, RentalIQ shall not be liable for any indirect, incidental, special, consequential, or punitive damages, including loss of profits, arising from your use of the service.'},
          {h:'8. Changes to Terms', body:'We may update these terms at any time. Continued use of the service after changes constitutes acceptance of the new terms.'},
          {h:'9. Contact', body:'Questions about these terms? Email us at legal@rentaliq.app.'},
        ].map((s, i) => (
          <div key={i} style={{marginBottom:32}}>
            <h2 style={{fontSize:17,fontWeight:700,color:C.text,marginBottom:10}}>{s.h}</h2>
            <p style={{fontSize:14.5,color:C.text,lineHeight:1.75}}>{s.body}</p>
          </div>
        ))}

        <div style={{borderTop:`1px solid ${C.border}`,paddingTop:24,marginTop:8,display:'flex',gap:20}}>
          <Link href="/privacy" style={{fontSize:13,color:C.green,textDecoration:'none',fontWeight:500}}>Privacy Policy →</Link>
          <Link href="/analyze" style={{fontSize:13,color:C.muted,textDecoration:'none'}}>Back to RentalIQ →</Link>
        </div>
      </div>
    </>
  );
}
