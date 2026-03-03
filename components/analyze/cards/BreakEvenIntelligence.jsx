import { useState, useEffect } from 'react';
import { C, clamp, scoreColor } from '../tokens';
import { Label, Card, Pill, AnimatedBar } from '../InputComponents';

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

  // For YES deals: always show the downside buffer - strong deals should know their margin
  if (verdict === 'YES' && cf > 500 && coc >= 12 && !bi.rentGapToPositive && !bi.rentGapTo10CoC) return null;

  const isYes = verdict === 'YES';

  const items = [];
  if (bi.rentGapToPositive) items.push({
    icon: '🏠',
    label: 'Rent needed for positive cash flow',
    value: bi.breakEvenRentForPositiveCF,
    sub: bi.rentGapToPositive,
    color: C.amber,
  });
  if (bi.rentGapTo10CoC) items.push({
    icon: '🎯',
    label: 'Rent for 10% CoC (Kiyosaki target)',
    value: bi.breakEvenRentFor10CoC,
    sub: bi.rentGapTo10CoC,
    color: C.green,
  });
  if (bi.priceGapToPositive) items.push({
    icon: '🤝',
    label: 'Negotiate price to break even',
    value: bi.breakEvenPrice,
    sub: bi.priceGapToPositive,
    color: C.blue,
  });

  if (!items.length) return null;

  return (
    <div style={{background:'#0d1512',border:`1.5px solid ${isYes?'rgba(74,222,128,0.35)':'rgba(74,222,128,0.2)'}`,borderRadius:16,padding:'20px 22px',marginBottom:14}}>
      <div style={{fontSize:11,fontWeight:700,letterSpacing:'0.12em',textTransform:'uppercase',color:'rgba(74,222,128,0.6)',marginBottom:4}}>
        {isYes ? 'Know Your Downside' : 'What Would Make This a YES?'}
      </div>
      <div style={{fontSize:13,color:'rgba(255,255,255,0.45)',marginBottom:16,lineHeight:1.5}}>
        {isYes
          ? 'This deal works - but know the thresholds that would flip it. Use these as your risk guardrails.'
          : 'This deal needs one of these changes to hit your targets:'}
      </div>
      <div style={{display:'flex',flexDirection:'column',gap:10}}>
        {items.map((item,i) => (
          <div key={i} style={{background:'rgba(255,255,255,0.05)',borderRadius:12,padding:'14px 16px',display:'flex',alignItems:'center',justifyContent:'space-between',gap:12,flexWrap:'wrap'}}>
            <div style={{display:'flex',alignItems:'center',gap:10}}>
              <span style={{fontSize:18,flexShrink:0}}>{item.icon}</span>
              <div>
                <div style={{fontSize:12,color:'rgba(255,255,255,0.5)',marginBottom:2}}>{item.label}</div>
                <div style={{fontSize:11.5,color:'rgba(255,255,255,0.35)'}}>{item.sub}</div>
              </div>
            </div>
            <div style={{fontFamily:"'Instrument Serif',Georgia,serif",fontSize:22,color:item.color,flexShrink:0,textAlign:'right'}}>
              {item.value}
            </div>
          </div>
        ))}
      </div>
      <div style={{marginTop:14,fontSize:11.5,color:'rgba(255,255,255,0.3)',lineHeight:1.6}}>
        Use the price and rent editors above to model any of these scenarios instantly - numbers update live.
      </div>
    </div>
  );
}

