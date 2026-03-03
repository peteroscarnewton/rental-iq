import { useState, useEffect } from 'react';
import { useSession }          from 'next-auth/react';
import { useRouter }           from 'next/router';
import Head                    from 'next/head';
import Link                    from 'next/link';

const C = {
  bg:'#f5f5f8', white:'#ffffff', border:'#dddde4', text:'#0d0d0f', muted:'#72727a', soft:'#eaeaef',
  green:'#166638', greenBg:'#ecf6f1', greenBorder:'#96ccb0',
  red:'#a62626', redBg:'#fdf0f0', redBorder:'#e0aaaa',
  amber:'#8a5800', amberBg:'#fdf4e8', amberBorder:'#dfc070',
  blue:'#1649a0', blueBg:'#edf1fc', blueBorder:'#a0beed',
  shadow:'0 1px 2px rgba(0,0,0,0.05), 0 2px 12px rgba(0,0,0,0.06)',
  shadowLg:'0 12px 48px rgba(0,0,0,0.11), 0 2px 8px rgba(0,0,0,0.05)',
};

function fmt$(cents) {
  if (cents >= 100000) return `$${(cents/100000).toFixed(1)}k`;
  return `$${(cents/100).toFixed(2)}`;
}
function fmtDate(iso) {
  if (!iso) return '-';
  return new Date(iso).toLocaleDateString('en-US', { month:'short', day:'numeric' });
}
function fmtDateFull(iso) {
  if (!iso) return '-';
  return new Date(iso).toLocaleDateString('en-US', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' });
}

// -- Micro sparkline bar chart -------------------------------------------------
function Sparkline({ data, color = C.green, label }) {
  if (!data?.length) return null;
  const max  = Math.max(...data.map(d => d.count), 1);
  const last7 = data.slice(-7);
  const total = data.reduce((s, d) => s + d.count, 0);

  return (
    <div>
      <div style={{display:'flex',alignItems:'flex-end',gap:3,height:48,marginBottom:6}}>
        {data.map((d, i) => {
          const h = Math.max(2, Math.round((d.count / max) * 48));
          const isLast7 = i >= data.length - 7;
          return (
            <div key={d.date} title={`${fmtDate(d.date)}: ${d.count}`}
              style={{
                flex:1, height:h, borderRadius:2,
                background: isLast7 ? color : color + '44',
                transition:'height 0.3s ease',
                cursor:'default',
              }}
            />
          );
        })}
      </div>
      <div style={{display:'flex',justifyContent:'space-between',fontSize:10,color:C.muted}}>
        <span>{fmtDate(data[0]?.date)}</span>
        <span style={{fontWeight:600,color:C.text}}>{total} total · {last7.reduce((s,d)=>s+d.count,0)} last 7d</span>
        <span>{fmtDate(data[data.length-1]?.date)}</span>
      </div>
    </div>
  );
}

// -- Stat card -----------------------------------------------------------------
function StatCard({ label, value, sub, color, trend }) {
  return (
    <div style={{background:C.white,border:`1px solid ${C.border}`,borderRadius:14,padding:'20px 22px',boxShadow:C.shadow,borderLeft:`3px solid ${color||C.border}`}}>
      <div style={{fontSize:11,fontWeight:600,letterSpacing:'0.09em',textTransform:'uppercase',color:C.muted,marginBottom:8}}>{label}</div>
      <div style={{fontSize:28,fontWeight:700,color:color||C.text,lineHeight:1,marginBottom:4}}>{value ?? '-'}</div>
      {sub && <div style={{fontSize:12,color:C.muted,lineHeight:1.4}}>{sub}</div>}
      {trend != null && (
        <div style={{fontSize:11,color:trend>0?C.green:C.red,marginTop:6,fontWeight:600}}>
          {trend>0?'↑':'↓'} {Math.abs(trend)}% vs prev period
        </div>
      )}
    </div>
  );
}

// -- Verdict donut (pure SVG) --------------------------------------------------
function VerdictDonut({ verdicts }) {
  const total = (verdicts.YES||0) + (verdicts.NO||0) + (verdicts.MAYBE||0);
  if (!total) return <div style={{color:C.muted,fontSize:13}}>No data yet</div>;

  const slices = [
    { label:'BUY',     value:verdicts.YES||0,   color:C.green },
    { label:'CAUTION', value:verdicts.MAYBE||0, color:C.amber },
    { label:'PASS',    value:verdicts.NO||0,    color:C.red   },
  ];

  const SIZE = 120, r = 44, cx = 60, cy = 60;
  const circumference = 2 * Math.PI * r;
  let offset = 0;
  const arcs = slices.map(s => {
    const pct   = s.value / total;
    const dash  = pct * circumference;
    const arc   = { ...s, dash, offset, pct };
    offset += dash;
    return arc;
  });

  return (
    <div style={{display:'flex',alignItems:'center',gap:20}}>
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} style={{transform:'rotate(-90deg)',flexShrink:0}}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={C.soft} strokeWidth={14}/>
        {arcs.map((arc, i) => (
          <circle key={i} cx={cx} cy={cy} r={r} fill="none"
            stroke={arc.color} strokeWidth={14}
            strokeDasharray={`${arc.dash} ${circumference}`}
            strokeDashoffset={-arc.offset}
            strokeLinecap="butt"
          />
        ))}
        <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle"
          transform={`rotate(90, ${cx}, ${cy})`}
          style={{fontSize:14,fontWeight:700,fill:C.text}}>
          {total}
        </text>
      </svg>
      <div style={{display:'flex',flexDirection:'column',gap:6}}>
        {slices.map(s => (
          <div key={s.label} style={{display:'flex',alignItems:'center',gap:8}}>
            <div style={{width:8,height:8,borderRadius:2,background:s.color,flexShrink:0}}/>
            <span style={{fontSize:12,color:C.muted,minWidth:56}}>{s.label}</span>
            <span style={{fontSize:12,fontWeight:700,color:C.text}}>{s.value}</span>
            <span style={{fontSize:11,color:C.muted}}>({Math.round(s.value/total*100)}%)</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// -- Token bucket bar ----------------------------------------------------------
function TokenBuckets({ buckets, total }) {
  if (!total) return null;
  const items = [
    { label:'0 tokens (churned)',  value:buckets.zero, color:C.red   },
    { label:'1 token (new)',       value:buckets.one,  color:C.amber },
    { label:'2-5 tokens',          value:buckets.few,  color:C.blue  },
    { label:'6+ tokens (loyal)',   value:buckets.many, color:C.green },
  ];
  return (
    <div style={{display:'flex',flexDirection:'column',gap:8}}>
      {items.map(item => {
        const pct = Math.round((item.value / total) * 100);
        return (
          <div key={item.label}>
            <div style={{display:'flex',justifyContent:'space-between',marginBottom:3}}>
              <span style={{fontSize:11.5,color:C.muted}}>{item.label}</span>
              <span style={{fontSize:11.5,fontWeight:600,color:C.text}}>{item.value} ({pct}%)</span>
            </div>
            <div style={{background:C.soft,borderRadius:4,height:6,overflow:'hidden'}}>
              <div style={{width:`${pct}%`,height:'100%',background:item.color,borderRadius:4,transition:'width 0.6s ease'}}/>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// -- Main admin page -----------------------------------------------------------
export default function AdminPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [stats,   setStats]   = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

  useEffect(() => {
    if (status === 'unauthenticated') { router.replace('/auth'); return; }
    if (status !== 'authenticated') return;

    fetch('/api/admin/stats')
      .then(r => r.json())
      .then(data => {
        if (data.error) setError(data.error);
        else setStats(data);
      })
      .catch(() => setError('Failed to load stats'))
      .finally(() => setLoading(false));
  }, [status]);

  return (
    <>
      <Head>
        <title>RentalIQ Admin</title>
        <meta name="robots" content="noindex,nofollow"/>
        <meta name="viewport" content="width=device-width, initial-scale=1"/>
        <link rel="preconnect" href="https://fonts.googleapis.com"/>
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous"/>
        <link href="https://fonts.googleapis.com/css2?family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700&display=swap" rel="stylesheet"/>
      </Head>
      <style>{`
        body{background:${C.bg};font-family:'DM Sans',system-ui,sans-serif;margin:0}
        @keyframes fadeup{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
        @keyframes spin{to{transform:rotate(360deg)}}
        .anim{animation:fadeup 0.3s ease both}
        @media(max-width:640px){.stat-grid{grid-template-columns:1fr 1fr!important}.two-col{grid-template-columns:1fr!important}}
      `}</style>

      {/* Nav */}
      <div style={{background:C.white,borderBottom:`1px solid ${C.border}`,padding:'0 24px',display:'flex',alignItems:'center',justifyContent:'space-between',height:52,position:'sticky',top:0,zIndex:10}}>
        <div style={{display:'flex',alignItems:'center',gap:20}}>
          <div style={{display:'flex',alignItems:'center',gap:8}}>
            <div style={{width:8,height:8,borderRadius:'50%',background:C.green}}/>
            <span style={{fontWeight:700,fontSize:14,color:C.text}}>RentalIQ</span>
            <span style={{fontSize:11,background:C.redBg,color:C.red,border:`1px solid ${C.redBorder}`,borderRadius:5,padding:'2px 7px',fontWeight:600,letterSpacing:'0.05em'}}>ADMIN</span>
          </div>
          <Link href="/dashboard" style={{fontSize:13,color:C.muted,textDecoration:'none'}}>← Dashboard</Link>
        </div>
        <div style={{fontSize:12,color:C.muted}}>{session?.user?.email}</div>
      </div>

      <div style={{maxWidth:1100,margin:'0 auto',padding:'28px 24px 60px'}}>
        <div style={{marginBottom:24}} className="anim">
          <h1 style={{fontSize:22,fontWeight:700,color:C.text,marginBottom:4,letterSpacing:'-0.02em'}}>Analytics</h1>
          <div style={{fontSize:13,color:C.muted}}>Last refreshed {new Date().toLocaleTimeString()}</div>
        </div>

        {/* Loading */}
        {loading && (
          <div style={{display:'flex',alignItems:'center',gap:12,color:C.muted,fontSize:14}}>
            <div style={{width:18,height:18,border:`2px solid ${C.border}`,borderTopColor:C.green,borderRadius:'50%',animation:'spin 0.7s linear infinite'}}/>
            Loading stats...
          </div>
        )}

        {/* Error */}
        {!loading && error && (
          <div style={{background:C.redBg,border:`1px solid ${C.redBorder}`,borderRadius:12,padding:'16px 20px',color:C.red,fontSize:14}}>
            {error === 'Admin only' ? 'Access denied. Add your email to ADMIN_EMAILS in environment variables.' : error}
          </div>
        )}

        {/* Stats */}
        {stats && (
          <div style={{animation:'fadeup 0.3s ease both'}}>

            {/* -- Row 1: top KPIs -- */}
            <div className="stat-grid" style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:14,marginBottom:20}}>
              <StatCard label="Total Users"      value={stats.users.total.toLocaleString()}  color={C.blue}  sub={`${stats.users.activationRate}% activated`}/>
              <StatCard label="Total Analyses"   value={stats.deals.total.toLocaleString()}  color={C.green} sub={`Avg score: ${stats.deals.avgScore ?? '-'}/100`}/>
              <StatCard label="Total Revenue"    value={fmt$(stats.revenue.totalCents)}       color={C.green} sub={`${fmt$(stats.revenue.last30DayCents)} last 30d`}/>
              <StatCard label="Tokens Sold"      value={stats.revenue.totalTokensSold.toLocaleString()} color={C.amber} sub={`${stats.revenue.totalPurchases} purchases`}/>
            </div>

            {/* -- Row 2: time-series -- */}
            <div className="two-col" style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:14,marginBottom:20}}>
              <div style={{background:C.white,border:`1px solid ${C.border}`,borderRadius:14,padding:'20px 22px',boxShadow:C.shadow}}>
                <div style={{fontSize:11,fontWeight:600,letterSpacing:'0.09em',textTransform:'uppercase',color:C.muted,marginBottom:14}}>Daily Signups - 30d</div>
                <Sparkline data={stats.timeseries.dailySignups} color={C.blue}/>
              </div>
              <div style={{background:C.white,border:`1px solid ${C.border}`,borderRadius:14,padding:'20px 22px',boxShadow:C.shadow}}>
                <div style={{fontSize:11,fontWeight:600,letterSpacing:'0.09em',textTransform:'uppercase',color:C.muted,marginBottom:14}}>Daily Analyses - 30d</div>
                <Sparkline data={stats.timeseries.dailyAnalyses} color={C.green}/>
              </div>
            </div>

            {/* -- Row 3: verdict dist + token health + top cities -- */}
            <div className="two-col" style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:14,marginBottom:20}}>

              <div style={{display:'flex',flexDirection:'column',gap:14}}>
                {/* Verdict distribution */}
                <div style={{background:C.white,border:`1px solid ${C.border}`,borderRadius:14,padding:'20px 22px',boxShadow:C.shadow}}>
                  <div style={{fontSize:11,fontWeight:600,letterSpacing:'0.09em',textTransform:'uppercase',color:C.muted,marginBottom:14}}>Verdict Distribution</div>
                  <VerdictDonut verdicts={stats.deals.verdicts}/>
                </div>

                {/* Token economy */}
                <div style={{background:C.white,border:`1px solid ${C.border}`,borderRadius:14,padding:'20px 22px',boxShadow:C.shadow}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14}}>
                    <div style={{fontSize:11,fontWeight:600,letterSpacing:'0.09em',textTransform:'uppercase',color:C.muted}}>Token Economy</div>
                    <div style={{fontSize:12,color:C.muted}}>{stats.users.totalTokensHeld.toLocaleString()} tokens held</div>
                  </div>
                  <TokenBuckets buckets={stats.users.tokenBuckets} total={stats.users.total}/>
                </div>
              </div>

              {/* Top cities */}
              <div style={{background:C.white,border:`1px solid ${C.border}`,borderRadius:14,padding:'20px 22px',boxShadow:C.shadow}}>
                <div style={{fontSize:11,fontWeight:600,letterSpacing:'0.09em',textTransform:'uppercase',color:C.muted,marginBottom:14}}>Top Markets Analyzed</div>
                {stats.deals.topCities.length === 0
                  ? <div style={{fontSize:13,color:C.muted}}>No city data yet</div>
                  : (
                    <div style={{display:'flex',flexDirection:'column',gap:0}}>
                      {stats.deals.topCities.map((item, i) => {
                        const max = stats.deals.topCities[0].count;
                        const pct = Math.round((item.count / max) * 100);
                        return (
                          <div key={item.city} style={{display:'flex',alignItems:'center',gap:10,padding:'7px 0',borderBottom:i<stats.deals.topCities.length-1?`1px solid ${C.soft}`:'none'}}>
                            <span style={{fontSize:11,fontWeight:700,color:C.muted,minWidth:18,textAlign:'right'}}>{i+1}</span>
                            <div style={{flex:1}}>
                              <div style={{display:'flex',justifyContent:'space-between',marginBottom:3}}>
                                <span style={{fontSize:13,color:C.text,fontWeight:500}}>{item.city}</span>
                                <span style={{fontSize:12,fontWeight:700,color:C.text}}>{item.count}</span>
                              </div>
                              <div style={{background:C.soft,borderRadius:3,height:4}}>
                                <div style={{width:`${pct}%`,height:'100%',background:C.green,borderRadius:3,transition:'width 0.6s ease'}}/>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )
                }
              </div>
            </div>

            {/* -- Row 4: recent users -- */}
            <div style={{background:C.white,border:`1px solid ${C.border}`,borderRadius:14,padding:'20px 22px',boxShadow:C.shadow}}>
              <div style={{fontSize:11,fontWeight:600,letterSpacing:'0.09em',textTransform:'uppercase',color:C.muted,marginBottom:14}}>Recent Sign-ups</div>
              <div style={{overflowX:'auto'}}>
                <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
                  <thead>
                    <tr style={{borderBottom:`1px solid ${C.border}`}}>
                      {['Email','Tokens','Joined'].map(h => (
                        <th key={h} style={{textAlign:'left',padding:'6px 12px',fontSize:11,fontWeight:600,color:C.muted,textTransform:'uppercase',letterSpacing:'0.07em'}}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(stats.users.recent || []).map((u, i) => (
                      <tr key={i} style={{borderBottom:`1px solid ${C.soft}`}}>
                        <td style={{padding:'8px 12px',color:C.text}}>{u.email}</td>
                        <td style={{padding:'8px 12px'}}>
                          <span style={{
                            fontSize:11,fontWeight:700,
                            color: u.tokens===0?C.red:u.tokens>=5?C.green:C.amber,
                            background: u.tokens===0?C.redBg:u.tokens>=5?C.greenBg:C.amberBg,
                            padding:'2px 8px',borderRadius:5,
                          }}>{u.tokens}</span>
                        </td>
                        <td style={{padding:'8px 12px',color:C.muted,fontSize:12}}>{fmtDateFull(u.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

          </div>
        )}
      </div>
    </>
  );
}
