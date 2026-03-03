import Link from 'next/link';
import Head from 'next/head';

const C = {
  bg:'#f5f5f8', white:'#ffffff', border:'#dddde4',
  text:'#0d0d0f', muted:'#72727a', green:'#166638',
};

export default function NotFound() {
  return (
    <>
      <Head>
        <title>Page Not Found - RentalIQ</title>
        <meta name="robots" content="noindex"/>
      </Head>
      <div style={{minHeight:'100vh',background:C.bg,display:'flex',alignItems:'center',
        justifyContent:'center',fontFamily:"'DM Sans',system-ui,sans-serif",padding:'20px'}}>
        <div style={{textAlign:'center',maxWidth:400}}>
          <div style={{fontSize:72,fontWeight:800,color:C.green,letterSpacing:'-0.05em',lineHeight:1}}>404</div>
          <div style={{fontFamily:"'Libre Baskerville',Georgia,serif",fontSize:24,fontWeight:700,
            color:C.text,margin:'16px 0 10px',letterSpacing:'-0.02em'}}>
            Page not found
          </div>
          <div style={{fontSize:14,color:C.muted,lineHeight:1.65,marginBottom:28}}>
            The page you're looking for doesn't exist - it may have been moved, or the link might be wrong.
          </div>
          <div style={{display:'flex',gap:10,justifyContent:'center',flexWrap:'wrap'}}>
            <Link href="/analyze" style={{background:C.green,color:'#fff',textDecoration:'none',
              borderRadius:10,padding:'11px 24px',fontSize:14,fontWeight:700,display:'inline-block'}}>
              Analyze a Property →
            </Link>
            <Link href="/scout" style={{background:C.white,color:C.text,textDecoration:'none',
              border:`1px solid ${C.border}`,borderRadius:10,padding:'11px 24px',fontSize:14,fontWeight:600,display:'inline-block'}}>
              Find My Market
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}
