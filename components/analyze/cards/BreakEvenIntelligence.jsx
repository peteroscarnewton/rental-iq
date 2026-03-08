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

  // Strip any math explanation bleed from AI responses
  const cleanVal = v => (v || '').split(/[\s(]/)[0].trim() || v;

  const items = [];
  if (bi.rentGapToPositive) items.push({
    label: 'Rent for positive cash flow',
    sub: bi.rentGapToPositive,
    value: cleanVal(bi.breakEvenRentForPositiveCF),
    accent: C.amber, accentBg: C.amberBg, accentBorder: C.amberBorder,
  });
  if (bi.rentGapTo10CoC) items.push({
    label: 'Rent for 10% CoC',
    sub: bi.rentGapTo10CoC,
    value: cleanVal(bi.breakEvenRentFor10CoC),
    accent: C.green, accentBg: C.greenBg, accentBorder: C.greenBorder,
  });
  if (bi.priceGapToPositive) items.push({
    label: 'Price to break even',
    sub: bi.priceGapToPositive,
    value: cleanVal(bi.breakEvenPrice),
    accent: C.blue, accentBg: C.blueBg, accentBorder: C.blueBorder,
  });

  if (!items.length) return null;

  return (
    <Card style={{marginBottom:14}}>
      <Label style={{marginBottom:4}}>
        {isYes ? 'Know Your Downside' : 'What Would Make This a YES?'}
      </Label>
      <div style={{fontSize:11,color:C.muted,marginBottom:16}}>
        {isYes
          ? 'This deal works — know the thresholds that would flip it.'
          : 'This deal needs one of these changes to hit your targets:'}
      </div>

      <div style={{display:'flex',flexDirection:'column',gap:10}}>
        {items.map((item,i) => (
          <div key={i} style={{
            background:item.accentBg,
            border:`1px solid ${item.accentBorder}`,
            borderRadius:12,
            padding:'14px 16px',
          }}>
            <div style={{fontSize:9.5,fontWeight:600,letterSpacing:'0.08em',textTransform:'uppercase',color:item.accent,marginBottom:4}}>{item.label}</div>
            <div style={{fontFamily:"'Instrument Serif',Georgia,serif",fontSize:24,lineHeight:1,color:item.accent,marginBottom:4}}>{item.value}</div>
            <div style={{fontSize:11.5,color:C.muted}}>{item.sub}</div>
          </div>
        ))}
      </div>

      <div style={{marginTop:14,fontSize:11.5,color:C.muted,lineHeight:1.6,borderTop:`1px solid ${C.border}`,paddingTop:12}}>
        Use the price and rent editors above to model any of these scenarios instantly — numbers update live.
      </div>
    </Card>
  );
}
