import Link from 'next/link';
import Head from 'next/head';

const C = {
  bg:'#f5f5f8', white:'#ffffff', border:'#dddde4',
  text:'#0d0d0f', muted:'#72727a', red:'#a62626', redBg:'#fdf0f0', redBorder:'#e0aaaa',
};

export default function ServerError() {
  return (
    <>
      <Head>
        <title>Server Error - RentalIQ</title>
        <meta name="robots" content="noindex"/>
      </Head>
      <div style={{minHeight:'100vh',background:C.bg,display:'flex',alignItems:'center',
        justifyContent:'center',fontFamily:"'DM Sans',system-ui,sans-serif",padding:'20px'}}>
        <div style={{textAlign:'center',maxWidth:400}}>
          <div style={{fontSize:72,fontWeight:800,color:C.red,letterSpacing:'-0.05em',lineHeight:1}}>500</div>
          <div style={{fontFamily:"'Libre Baskerville',Georgia,serif",fontSize:24,fontWeight:700,
            color:C.text,margin:'16px 0 10px',letterSpacing:'-0.02em'}}>
            Something went wrong
          </div>
          <div style={{fontSize:14,color:C.muted,lineHeight:1.65,marginBottom:28}}>
            An unexpected error occurred on our end. It's been logged. Try again in a moment.
          </div>
          <Link href="/analyze" style={{background:C.red,color:'#fff',textDecoration:'none',
            borderRadius:10,padding:'11px 24px',fontSize:14,fontWeight:700,display:'inline-block'}}>
            Back to RentalIQ
          </Link>
        </div>
      </div>
    </>
  );
}
