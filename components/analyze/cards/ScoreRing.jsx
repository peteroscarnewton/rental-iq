import { useState, useEffect } from 'react';
import { C, clamp, scoreColor } from '../tokens';
import { Label, Card, Pill, AnimatedBar } from '../InputComponents';

export function ScoreRing({score}) {
  const [animScore, setAnimScore] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setAnimScore(score), 80);
    return () => clearTimeout(t);
  }, [score]);

  const color = scoreColor(score);
  const SIZE = 148;
  const STROKE = 11;
  const R_OUTER = (SIZE / 2) - STROKE;       // outer track radius
  const R_INNER = R_OUTER - STROKE - 4;       // inner track radius
  const cx = SIZE / 2, cy = SIZE / 2;

  // Outer arc - overall score
  const circOuter = 2 * Math.PI * R_OUTER;
  const dashOuter = circOuter * clamp(animScore,0,100) / 100;

  // Inner arc - a softer echo at 60% opacity, slightly delayed visual
  const circInner = 2 * Math.PI * R_INNER;
  const dashInner = circInner * clamp(animScore,0,100) / 100;

  const grade = score >= 80 ? 'Exceptional' : score >= 68 ? 'Strong' : score >= 53 ? 'Decent' : score >= 36 ? 'Marginal' : 'Weak';

  return (
    <div className="riq-score-ring" style={{position:'relative',width:SIZE,height:SIZE,flexShrink:0}}>
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} style={{transform:'rotate(-90deg)'}}>
        {/* Outer track */}
        <circle cx={cx} cy={cy} r={R_OUTER} fill="none" stroke="rgba(0,0,0,0.07)" strokeWidth={STROKE}/>
        {/* Outer arc - score */}
        <circle
          cx={cx} cy={cy} r={R_OUTER}
          fill="none"
          stroke={color}
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={`${dashOuter} ${circOuter}`}
          style={{transition:'stroke-dasharray 1.1s cubic-bezier(0.4,0,0.2,1)'}}
        />
        {/* Inner track */}
        <circle cx={cx} cy={cy} r={R_INNER} fill="none" stroke="rgba(0,0,0,0.04)" strokeWidth={STROKE-2}/>
        {/* Inner arc - softer echo */}
        <circle
          cx={cx} cy={cy} r={R_INNER}
          fill="none"
          stroke={color}
          strokeWidth={STROKE-2}
          strokeLinecap="round"
          strokeDasharray={`${dashInner * 0.55} ${circInner}`}
          style={{transition:'stroke-dasharray 1.3s cubic-bezier(0.4,0,0.2,1) 0.15s',opacity:0.35}}
        />
      </svg>
      {/* Center label - absolutely positioned over SVG */}
      <div style={{
        position:'absolute', inset:0, display:'flex', flexDirection:'column',
        alignItems:'center', justifyContent:'center', pointerEvents:'none',
      }}>
        <div style={{
          fontSize:36, fontWeight:800, lineHeight:1,
          color, letterSpacing:'-0.04em',
          fontFamily:"'DM Sans',system-ui,sans-serif",
        }}>{score}</div>
        <div style={{fontSize:10, fontWeight:600, letterSpacing:'0.08em', textTransform:'uppercase', color:C.muted, marginTop:3}}>{grade}</div>
      </div>
    </div>
  );
}

