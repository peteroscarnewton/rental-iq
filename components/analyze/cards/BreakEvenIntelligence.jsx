import { C } from '../tokens';
import { Label, Card } from '../InputComponents';

export function BreakEvenIntelligence({data}) {
  const bi = data.breakEvenIntelligence;
  const verdict = (data.verdict||'').toUpperCase();
  if (!bi) return null;

  const cfStr  = data.keyMetrics?.find(m => m.label === 'Monthly Cash Flow')?.value || '';
  const cocStr = data.keyMetrics?.find(m => m.label === 'Cash-on-Cash')?.value || '';
  const cf  = bi.currentCF  != null ? parseFloat(bi.currentCF)
    : parseFloat(cfStr.replace(/[^\-0-9.]/g, '')) || 0;
  const coc = bi.currentCoC != null ? parseFloat(bi.currentCoC)
    : parseFloat(cocStr.replace(/[^\-0-9.]/g, '')) || 0;

  if (verdict === 'YES' && cf > 500 && coc >= 12 && !bi.rentGapToPositive && !bi.rentGapTo10CoC) return null;

  const isYes = verdict === 'YES';

  const items = [];
  if (bi.rentGapToPositive) items.push({
    label: 'Rent needed for positive cash flow',
    sub: bi.rentGapToPositive,
    value: bi.breakEvenRentForPositiveCF,
    accent: C.amber, accentBg: C.amberBg, accentBorder: C.amberBorder,
  });
  if (bi.rentGapTo10CoC) items.push({
    label: 'Rent for 10% CoC (Kiyosaki target)',
    sub: bi.rentGapTo10CoC,
    value: bi.breakEvenRentFor10CoC,
    accent: C.green, accentBg: C.greenBg, accentBorder: C.greenBorder,
  });
  if (bi.priceGapToPositive) items.push({
    label: 'Negotiate price to break even',
    sub: bi.priceGapToPositive,
    value: bi.breakEvenPrice,
    accent: C.blue, accentBg: C.blueBg, accentBorder: C.blueBorder,
  });

  if (!items.length) return null;

  return (
    <Card style={{marginBottom:14}}>
      <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:16}}>
        <div style={{width:32,height:32,borderRadius:10,background:isYes?C.amberBg:C.redBg,
          border:`1px solid ${isYes?C.amberBorder:C.redBorder}`,
          display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,fontSize:16}}>
          isYes ? '!' : '→'
        </div>
        <div>
          <Label style={{marginBottom:0}}>
            {isYes ? 'Know Your Downside' : 'What Would Make This a YES?'}
          </Label>
          <div style={{fontSize:11,color:C.muted,marginTop:2}}>
            {isYes
              ? 'This deal works — know the thresholds that would flip it.'
              : 'This deal needs one of these changes to hit your targets:'}
          </div>
        </div>
      </div>

      <div style={{display:'flex',flexDirection:'column',gap:10}}>
        {items.map((item,i) => (
          <div key={i} style={{
            background:item.accentBg,
            border:`1px solid ${item.accentBorder}`,
            borderRadius:12,padding:'14px 16px',
            display:'flex',alignItems:'center',
            justifyContent:'space-between',gap:16,flexWrap:'wrap',
          }}>
            <div style={{display:'flex',alignItems:'center',gap:0,flex:1,minWidth:0}}>
              <div style={{minWidth:0}}>
                <div style={{fontSize:12.5,fontWeight:600,color:C.text,marginBottom:2}}>{item.label}</div>
                <div style={{fontSize:11.5,color:C.muted,lineHeight:1.4}}>{item.sub}</div>
              </div>
            </div>
            <div style={{
              fontFamily:"'Instrument Serif',Georgia,serif",
              fontSize:22,fontWeight:700,color:item.accent,
              flexShrink:0,textAlign:'right',whiteSpace:'nowrap',
            }}>
              {item.value}
            </div>
          </div>
        ))}
      </div>

      <div style={{marginTop:14,fontSize:12,color:C.muted,lineHeight:1.6,borderTop:`1px solid ${C.border}`,paddingTop:12}}>
        Use the price and rent editors above to model any of these scenarios instantly — numbers update live.
      </div>
    </Card>
  );
}
