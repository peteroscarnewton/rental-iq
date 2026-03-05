import { useState, useRef, useEffect, useCallback } from 'react';

// ── Scroll-reveal hook — same pattern as landing page ──────────────────────────
// Returns [ref, isVisible]. Once visible, stays visible (disconnect after trigger).
export function useReveal(threshold = 0.08) {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Already in viewport on mount (e.g. top of results)
    const rect = el.getBoundingClientRect();
    if (rect.top < window.innerHeight - 40) { setVisible(true); return; }
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setVisible(true); obs.disconnect(); } },
      { threshold, rootMargin: '0px 0px -40px 0px' }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [threshold]);
  return [ref, visible];
}
import { C, MODES, MODE_DEFAULTS, LOADING_STEPS, LOAN_TYPES, PROPERTY_TYPES, EMPTY_PROFILE, inputBase, clamp, scoreColor } from './tokens';
import { getStateTaxRate, getInsRate, getStateAppreciation, getMgmtRateBenchmark, getClosingCostForState, getPmiRateForDown, getMarketData } from './marketHelpers';

// ── Inline-editable numeric value ─────────────────────────────────────────────

export function InlineEdit({ value, onChange, suffix, prefix, large }) {
  const [editing, setEditing] = useState(false);
  const [local, setLocal]     = useState(value);
  const ref = useRef(null);
  useEffect(() => { setLocal(value); }, [value]);
  useEffect(() => { if (editing) ref.current?.select(); }, [editing]);
  function commit() { setEditing(false); if (local !== value) onChange(local); }
  const fs = large ? 28 : 18;
  if (editing) return (
    <div style={{ display:'inline-flex', alignItems:'center', gap:4 }}>
      {prefix && <span style={{ fontSize:fs*0.6, color:C.muted }}>{prefix}</span>}
      <input ref={ref} value={local} onChange={e => setLocal(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key==='Enter') commit(); if (e.key==='Escape') { setEditing(false); setLocal(value); } }}
        style={{ ...inputBase, padding:'4px 8px', fontSize:fs*0.85, width:Math.max(80,value.length*12), display:'inline', borderColor:C.blue, background:'#fff' }}/>
      {suffix && <span style={{ fontSize:fs*0.6, color:C.muted }}>{suffix}</span>}
    </div>
  );
  return (
    <button onClick={() => setEditing(true)}
      style={{ background:'none', border:'none', cursor:'text', fontFamily:"'Instrument Serif',Georgia,serif", fontSize:fs, color:'inherit', padding:0, display:'inline-flex', alignItems:'baseline', gap:3, borderBottom:`1px dashed ${C.border}`, transition:'border-color 0.15s' }}
      onMouseEnter={e => e.currentTarget.style.borderColor = C.blue}
      onMouseLeave={e => e.currentTarget.style.borderColor = C.border}
      title="Click to edit">
      {prefix}<span>{value}</span>{suffix}
    </button>
  );
}

// ── Micro-components ──────────────────────────────────────────────────────────

export function Label({ children, style }) {
  return <div style={{ fontSize:10, fontWeight:600, letterSpacing:'0.1em', textTransform:'uppercase', color:C.muted, marginBottom:10, ...style }}>{children}</div>;
}

export function Card({ children, style }) {
  return <div className="riq-card" style={{ background:C.white, border:`1px solid ${C.border}`, borderRadius:14, boxShadow:C.shadow, padding:28, marginBottom:14, ...style }}>{children}</div>;
}

export function Pill({ children, color, style }) {
  return <span style={{ display:'inline-flex', alignItems:'center', gap:6, background:color ? color+'15' : C.white, border:`1px solid ${color ? color+'40' : C.border}`, borderRadius:100, padding:'5px 12px', fontSize:12, color:color||C.muted, fontWeight:color?600:400, ...style }}>{children}</span>;
}

export function AnimatedBar({ score, delay=0 }) {
  const [w, setW] = useState(0);
  const safe = clamp(score, 0, 100);
  useEffect(() => {
    const t = setTimeout(() => setW(safe), delay + 120);
    return () => clearTimeout(t);
  }, [safe, delay]);
  return (
    <div style={{ height:6, background:C.soft, borderRadius:3, overflow:'hidden', flex:1 }}>
      <div style={{ height:'100%', width:`${w}%`, background:scoreColor(safe), borderRadius:3, transition:'width 1s cubic-bezier(0.4,0,0.2,1)' }}/>
    </div>
  );
}

export function LoadingSpinner({ step }) {
  return (
    <div style={{
      position:'fixed', inset:0, zIndex:50,
      display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
      background:'rgba(245,245,248,0.96)', backdropFilter:'blur(8px)',
      gap:28, animation:'riq-fadeup 0.3s ease both',
    }}>
      {/* Double-ring spinner */}
      <div style={{ position:'relative', width:56, height:56 }}>
        <div style={{ position:'absolute', inset:0, borderRadius:'50%', border:`3px solid ${C.border}` }}/>
        <div style={{ position:'absolute', inset:0, borderRadius:'50%', border:'3px solid transparent', borderTopColor:C.green, animation:'riq-spin 0.8s linear infinite' }}/>
        <div style={{ position:'absolute', inset:6, borderRadius:'50%', border:'2px solid transparent', borderTopColor:C.greenBorder, animation:'riq-spin 1.2s linear infinite reverse' }}/>
      </div>
      {/* Step list */}
      <div style={{ textAlign:'center', maxWidth:360, padding:'0 24px' }}>
        {LOADING_STEPS.map((s, i) => (
          <div key={i} style={{
            fontSize:13.5,
            color: i < step ? C.muted : i === step ? C.text : C.border,
            transition:'color 0.5s ease',
            padding:'5px 0',
            fontWeight: i === step ? 700 : 400,
            lineHeight:1.5,
          }}>
            {i < step ? <span style={{color:C.green,marginRight:6}}>✓</span> : i === step ? <span style={{marginRight:6}}>›</span> : <span style={{marginRight:6,opacity:0.3}}>·</span>}
            {s}
          </div>
        ))}
      </div>
    </div>
  );
}

export function Toggle({ value, onChange, label, sub }) {
  return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:12 }}>
      <div>
        <div style={{ fontSize:13, fontWeight:600, color:C.text }}>{label}</div>
        {sub && <div style={{ fontSize:11.5, color:C.muted, marginTop:2 }}>{sub}</div>}
      </div>
      <button onClick={() => onChange(!value)}
        style={{ width:44, height:24, borderRadius:100, background:value ? C.green : '#ccc', border:'none', cursor:'pointer', position:'relative', transition:'background 0.2s', flexShrink:0 }}>
        <span style={{ position:'absolute', top:3, left:value ? 22 : 3, width:18, height:18, borderRadius:'50%', background:'#fff', transition:'left 0.2s', boxShadow:'0 1px 3px rgba(0,0,0,0.2)' }}/>
      </button>
    </div>
  );
}

// ── AutoField — labeled text input with autofill status indicator ──────────────

export function AutoField({ id, label, required, optional, value, onChange, placeholder, hint, errMsg, status }) {
  const animStyle = status === 'success'
    ? { animation:'jiggle-green 0.45s ease, flash-green 0.6s ease', borderColor:C.green, borderWidth:2 }
    : status === 'unverified'
    ? { animation:'jiggle-amber 0.45s ease, flash-amber 0.6s ease', borderColor:C.amber, borderWidth:2 }
    : status === 'fail'
    ? { animation:'jiggle-red 0.45s ease, flash-red 0.6s ease', borderColor:C.red, borderWidth:2 }
    : {};
  const indicator = status === 'success'
    ? <span style={{ fontSize:10, fontWeight:700, color:C.green, background:C.greenBg, border:`1px solid ${C.greenBorder}`, borderRadius:100, padding:'1px 7px', marginLeft:4 }}>✓ auto-filled</span>
    : status === 'unverified'
    ? <span style={{ fontSize:10, fontWeight:700, color:C.amber, background:C.amberBg, border:`1px solid ${C.amberBorder}`, borderRadius:100, padding:'1px 7px', marginLeft:4 }}>verify</span>
    : status === 'fail'
    ? <span style={{ fontSize:10, fontWeight:700, color:C.red, background:C.redBg, border:`1px solid ${C.redBorder}`, borderRadius:100, padding:'1px 7px', marginLeft:4 }}>fill in manually</span>
    : null;
  return (
    <div>
      <label htmlFor={id} style={{ fontSize:11, fontWeight:600, letterSpacing:'0.08em', textTransform:'uppercase', color:C.muted, display:'flex', alignItems:'center', marginBottom:7, flexWrap:'wrap', gap:2 }}>
        {label}
        {required && <span style={{ color:C.red, marginLeft:2 }}>*</span>}
        {optional && <span style={{ fontWeight:400, textTransform:'none', letterSpacing:0, fontSize:10, marginLeft:4 }}>(optional)</span>}
        {indicator}
      </label>
      <input id={id} type="text" value={value} onChange={e => onChange(e.target.value)}
        placeholder={placeholder} autoComplete="off"
        style={{ ...inputBase, width:'100%', boxSizing:'border-box', ...animStyle, transition:'border-color 0.3s' }}/>
      {hint && !errMsg && <p style={{ fontSize:11, color:C.muted, margin:'4px 0 0', lineHeight:1.5 }}>{hint}</p>}
      {errMsg && <p style={{ fontSize:11, color:C.red, margin:'4px 0 0' }}>{errMsg}</p>}
    </div>
  );
}

// ── Step 1: Investor Situation ────────────────────────────────────────────────

export function StepSituation({ profile, onChange, selfManage, onSelfManage, isProfileSaved }) {
  const _MD = getMarketData();
  const goals = [
    { key:'cashflow',     label:'Income-Focused',  desc:'Prioritize monthly cash flow' },
    { key:'appreciation', label:'Appreciation',     desc:'Long-term equity growth' },
    { key:'balanced',     label:'Balanced Return',  desc:'Cash flow + appreciation' },
    { key:'tax',          label:'Tax & Equity',     desc:'Build equity, minimize taxes' },
  ];
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:20 }}>
      {/* Goal */}
      <div>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:7 }}>
          <Label style={{ marginBottom:0 }}>What's your primary goal?</Label>
          {isProfileSaved && (
            <span style={{ fontSize:10, color:C.green, background:C.greenBg, border:`1px solid ${C.greenBorder}`, borderRadius:100, padding:'2px 8px', fontWeight:600, letterSpacing:'0.06em' }}>
              ✓ Profile remembered
            </span>
          )}
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
          {goals.map(g => {
            const active = profile.goal === g.key;
            return (
              <button key={g.key} onClick={() => onChange({ ...profile, goal:g.key })}
                style={{ background:active ? C.green : C.white, border:`1.5px solid ${active ? C.green : C.border}`, borderRadius:10, padding:'12px 14px', cursor:'pointer', fontFamily:'inherit', textAlign:'left', transition:'all 0.15s', boxShadow:active ? '0 2px 8px rgba(22,102,56,0.20)' : 'none' }}>
                <div style={{ fontSize:13, fontWeight:700, color:active ? '#fff' : C.text, marginBottom:2 }}>{g.label}</div>
                <div style={{ fontSize:11, color:active ? 'rgba(255,255,255,0.75)' : C.muted, lineHeight:1.4 }}>{g.desc}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Financing */}
      <div style={{ background:C.soft, borderRadius:14, padding:'16px 18px', display:'flex', flexDirection:'column', gap:14 }}>
        <Toggle value={profile.cashPurchase} onChange={v => onChange({ ...profile, cashPurchase:v })}
          label="All-cash purchase"
          sub={profile.cashPurchase ? 'No mortgage. Full asset control.' : 'Using a mortgage loan'}/>
        {!profile.cashPurchase && (
          <>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
              <div>
                <label style={{ fontSize:10, fontWeight:600, letterSpacing:'0.08em', textTransform:'uppercase', color:C.muted, display:'block', marginBottom:6 }}>Down Payment</label>
                <div style={{ position:'relative' }}>
                  <input type="text" value={profile.downPaymentPct} onChange={e => onChange({ ...profile, downPaymentPct:e.target.value })}
                    placeholder="20" style={{ ...inputBase, paddingRight:28 }}/>
                  <span style={{ position:'absolute', right:12, top:'50%', transform:'translateY(-50%)', fontSize:12, color:C.muted }}>%</span>
                </div>
                {(parseFloat(profile.downPaymentPct) || 20) < 20 && (
                  <p style={{ fontSize:10, color:C.amber, margin:'4px 0 0' }}>PMI applies (&lt;20% down) — {getPmiRateForDown(parseFloat(profile.downPaymentPct || 20)).toFixed(2)}%/yr for this LTV (live rate)</p>
                )}
              </div>
              <div>
                <label style={{ fontSize:10, fontWeight:600, letterSpacing:'0.08em', textTransform:'uppercase', color:C.muted, display:'block', marginBottom:6 }}>
                  Interest Rate
                  <span style={{ fontSize:9, fontWeight:500, color:C.blue, background:C.blueBg, border:`1px solid ${C.blueBorder}`, borderRadius:4, padding:'1px 5px', marginLeft:6, letterSpacing:'0.04em', textTransform:'none' }}>live · FRED/PMMS</span>
                  {_MD.mortgageRates?.asOf && <span style={{ fontSize:9, color:C.muted, marginLeft:4, textTransform:'none', letterSpacing:0 }}>as of {_MD.mortgageRates.asOf}</span>}
                </label>
                <div style={{ position:'relative' }}>
                  <input type="text" value={profile.interestRate} onChange={e => onChange({ ...profile, interestRate:e.target.value })}
                    placeholder="6.87" style={{ ...inputBase, paddingRight:28 }}/>
                  <span style={{ position:'absolute', right:12, top:'50%', transform:'translateY(-50%)', fontSize:12, color:C.muted }}>%</span>
                </div>
              </div>
            </div>
            {/* Loan Type */}
            <div>
              <label style={{ fontSize:10, fontWeight:600, letterSpacing:'0.08em', textTransform:'uppercase', color:C.muted, display:'block', marginBottom:6 }}>Loan Type</label>
              <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:6 }}>
                {LOAN_TYPES.map(lt => {
                  const active = (profile.loanType || '30yr_fixed') === lt.key;
                  return (
                    <button key={lt.key} onClick={() => {
                      const defaultRate = EMPTY_PROFILE.interestRate;
                      const userCustomized = profile.interestRate && profile.interestRate !== defaultRate
                        && profile.interestRate !== profile._rate15yr && profile.interestRate !== profile._rate5arm;
                      let newRate = profile.interestRate;
                      if (!userCustomized) {
                        if (lt.key === '30yr_fixed' && _MD.mortgageRates?.rate30yr) newRate = String(_MD.mortgageRates.rate30yr.toFixed(2));
                        if (lt.key === '15yr_fixed' && profile._rate15yr) newRate = profile._rate15yr;
                        if (lt.key === '5_1_arm'    && profile._rate5arm)  newRate = profile._rate5arm;
                      }
                      onChange({ ...profile, loanType:lt.key, interestRate:newRate });
                    }}
                      style={{ background:active ? C.blue : '#fff', border:`1.5px solid ${active ? C.blue : C.border}`, borderRadius:8, padding:'8px 4px', cursor:'pointer', fontFamily:'inherit', textAlign:'center', transition:'all 0.15s' }}>
                      <div style={{ fontSize:11, fontWeight:700, color:active ? '#fff' : C.text }}>{lt.label}</div>
                    </button>
                  );
                })}
              </div>
              {profile.loanType === '5_1_arm'       && <p style={{ fontSize:10, color:C.amber, margin:'4px 0 0' }}>ARM rate shown is fixed for 5 years - factor in rate risk after year 5</p>}
              {profile.loanType === 'interest_only'  && <p style={{ fontSize:10, color:C.amber, margin:'4px 0 0' }}>Interest-only: no principal paydown - cash flow is higher, equity build is zero</p>}
            </div>
          </>
        )}
      </div>

      {/* Holding Period */}
      <div>
        <Label>Holding period</Label>
        <div style={{ display:'flex', gap:8 }}>
          {[3,5,7,10,20].map(y => {
            const active = parseInt(profile.holdingYears) === y;
            return (
              <button key={y} onClick={() => onChange({ ...profile, holdingYears:String(y) })}
                style={{ flex:1, background:active ? C.text : C.white, border:`1.5px solid ${active ? C.text : C.border}`, borderRadius:8, padding:'9px 4px', cursor:'pointer', fontFamily:'inherit', fontSize:12, fontWeight:active ? 700 : 500, color:active ? '#fff' : C.muted, transition:'all 0.15s' }}>
                {y}yr
              </button>
            );
          })}
        </div>
      </div>

      {/* Self-manage */}
      <div style={{ background:C.soft, borderRadius:14, padding:'14px 18px' }}>
        <Toggle value={selfManage} onChange={onSelfManage}
          label="Self-manage property"
          sub={selfManage ? 'No management fee applied.' : 'Management fee applied (local rate).'}/>
      </div>
    </div>
  );
}

// ── Step 2: Property Details ──────────────────────────────────────────────────

export function StepProperty({ fields, setField, errors, adv, setAdv, mode, setMode, fetchStatus, fetchMsg, fieldStatus, profile }) {
  const stateTax = getStateTaxRate(fields.city);
  const stateIns = getInsRate(fields.city);
  const m = fields.city.toUpperCase().match(/,\s*([A-Z]{2})$/);
  const sc = m ? m[1] : null;
  const defaults = MODE_DEFAULTS[mode] || MODE_DEFAULTS.moderate;
  const [advOpen, setAdvOpen] = useState(false);
  const hasCustom = adv.vacancyOverride || adv.capexOverride || adv.maintenanceOverride || adv.appreciationOverride || adv.mgmtRateOverride || adv.closingCostPct || adv.rentGrowthOverride;

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
      {/* Property Type */}
      <div>
        <Label>Property type</Label>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:6 }}>
          {PROPERTY_TYPES.map(pt => {
            const active = (fields.propertyType || 'sfr') === pt.key;
            return (
              <button key={pt.key} onClick={() => setField('propertyType')(pt.key)}
                style={{ background:active ? C.green : C.white, border:`1.5px solid ${active ? C.green : C.border}`, borderRadius:8, padding:'10px 4px', cursor:'pointer', fontFamily:'inherit', textAlign:'center', transition:'all 0.15s' }}>
                <div style={{ fontSize:12, fontWeight:700, color:active ? '#fff' : C.text }}>{pt.label}</div>
                <div style={{ fontSize:10, color:active ? 'rgba(255,255,255,0.7)' : C.muted }}>{pt.desc}</div>
              </button>
            );
          })}
        </div>
        {fields.propertyType === 'condo' && !fields.hoaMonthly && (
          <p style={{ fontSize:10, color:C.amber, margin:'4px 0 0' }}>Condos usually have HOA fees - enter monthly amount below</p>
        )}
        {(fields.propertyType === 'duplex' || fields.propertyType === 'mfr') && (
          <p style={{ fontSize:10, color:C.green, margin:'4px 0 0' }}>Multi-unit: enter combined rent from all units</p>
        )}
      </div>

      {/* URL */}
      {!fields.url && (
        <div>
          <label style={{ fontSize:11, fontWeight:600, letterSpacing:'0.08em', textTransform:'uppercase', color:C.muted, display:'block', marginBottom:7 }}>
            Listing URL <span style={{ fontWeight:400, textTransform:'none', letterSpacing:0, fontSize:10, color:C.muted }}>(or paste above in the search bar)</span>
          </label>
          <input type="url" value={fields.url} onChange={e => setField('url')(e.target.value)}
            placeholder="https://zillow.com/homedetails/..." autoComplete="off"
            style={{ ...inputBase, width:'100%', boxSizing:'border-box' }}/>
          <p style={{ fontSize:11, color:C.muted, marginTop:5, lineHeight:1.5 }}>Paste a listing URL to auto-fill fields below. Or enter manually.</p>
        </div>
      )}
      {fields.url && fetchStatus && (
        <div style={{ padding:'9px 13px', background:fetchStatus==='done' ? C.greenBg : fetchStatus==='partial' ? C.amberBg : fetchStatus==='error' ? C.redBg : C.blueBg, border:`1px solid ${fetchStatus==='done' ? C.greenBorder : fetchStatus==='partial' ? C.amberBorder : fetchStatus==='error' ? C.redBorder : C.blueBorder}`, borderRadius:10, fontSize:12, color:fetchStatus==='done' ? C.green : fetchStatus==='partial' ? C.amber : fetchStatus==='error' ? C.red : C.blue, fontWeight:600, display:'flex', alignItems:'center', gap:8 }}>
          {fetchStatus === 'loading' && <span style={{ display:'inline-block', width:10, height:10, border:`2px solid ${C.blue}`, borderTopColor:'transparent', borderRadius:'50%', animation:'riq-spin 0.7s linear infinite' }}/>}
          {fetchMsg}
        </div>
      )}

      {/* Price + Rent */}
      <div className="riq-g2" style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
        <AutoField id="price" label="Purchase Price" required value={fields.price} onChange={setField('price')} placeholder="$145,000" errMsg={errors.price} status={fieldStatus.price}/>
        <AutoField id="rent"  label="Monthly Rent"   optional value={fields.rent}  onChange={setField('rent')}  placeholder="$1,200/mo" hint="Blank = AI estimates" status={fieldStatus.rent}/>
      </div>

      {/* Property details */}
      <div className="riq-g2" style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
        <AutoField id="beds"  label="Bedrooms"   required value={fields.beds}  onChange={setField('beds')}  placeholder="3"     errMsg={errors.beds}  status={fieldStatus.beds}/>
        <AutoField id="baths" label="Bathrooms"  required value={fields.baths} onChange={setField('baths')} placeholder="2"     errMsg={errors.baths} status={fieldStatus.baths}/>
        <AutoField id="sqft"  label="Sq Footage" required value={fields.sqft}  onChange={setField('sqft')}  placeholder="1,200" errMsg={errors.sqft}  status={fieldStatus.sqft}/>
        <AutoField id="year"  label="Year Built" required value={fields.year}  onChange={setField('year')}  placeholder="1987"  errMsg={errors.year}  status={fieldStatus.year}/>
      </div>

      {/* City */}
      <AutoField id="city" label="City / State" required value={fields.city} onChange={setField('city')}
        placeholder="Austin, TX" hint="Sets state-specific tax & insurance rates" errMsg={errors.city} status={fieldStatus.city}/>

      {/* Tax */}
      <div>
        <label style={{ fontSize:11, fontWeight:600, letterSpacing:'0.08em', textTransform:'uppercase', color:C.muted, display:'flex', alignItems:'center', gap:6, marginBottom:7, flexWrap:'wrap' }}>
          Annual Property Tax
          <span style={{ fontWeight:400, textTransform:'none', letterSpacing:0, fontSize:10 }}>(from listing)</span>
          {fieldStatus.taxAnnual === 'success'    && <span style={{ fontSize:10, fontWeight:700, color:C.green, background:C.greenBg, border:`1px solid ${C.greenBorder}`, borderRadius:100, padding:'1px 7px' }}>✓ auto-filled</span>}
          {fieldStatus.taxAnnual === 'unverified' && <span style={{ fontSize:10, fontWeight:700, color:C.amber, background:C.amberBg, border:`1px solid ${C.amberBorder}`, borderRadius:100, padding:'1px 7px' }}>verify</span>}
          {fieldStatus.taxAnnual === 'fail'       && <span style={{ fontSize:10, fontWeight:700, color:C.red,   background:C.redBg,   border:`1px solid ${C.redBorder}`,   borderRadius:100, padding:'1px 7px' }}>fill in manually</span>}
        </label>
        <div style={{ position:'relative', animation:fieldStatus.taxAnnual==='success' ? 'jiggle-green 0.45s ease, flash-green 0.6s ease' : fieldStatus.taxAnnual==='unverified' ? 'jiggle-amber 0.45s ease, flash-amber 0.6s ease' : fieldStatus.taxAnnual==='fail' ? 'jiggle-red 0.45s ease, flash-red 0.6s ease' : undefined }}>
          <span style={{ position:'absolute', left:12, top:'50%', transform:'translateY(-50%)', fontSize:14, color:C.muted }}>$</span>
          <input type="text" value={fields.taxAnnual} onChange={e => setField('taxAnnual')(e.target.value)}
            placeholder="e.g. 3,200" style={{ ...inputBase, paddingLeft:24, borderColor:errors.taxAnnual ? C.red : fieldStatus.taxAnnual==='success' ? C.green : fieldStatus.taxAnnual==='unverified' ? C.amber : fieldStatus.taxAnnual==='fail' ? C.red : undefined, transition:'border-color 0.3s' }}/>
          {errors.taxAnnual && <p style={{ fontSize:11, color:C.red, margin:'4px 0 0' }}>{errors.taxAnnual}</p>}
        </div>
        <p style={{ fontSize:11, color:C.muted, margin:'5px 0 0', lineHeight:1.5 }}>
          {sc && <span>{sc} fallback: <strong>{stateTax}%/yr tax</strong> · <strong>{stateIns}%/yr insurance</strong>.</span>}
        </p>
      </div>

      {/* HOA */}
      <div>
        <label style={{ fontSize:11, fontWeight:600, letterSpacing:'0.08em', textTransform:'uppercase', color:C.muted, display:'flex', alignItems:'center', gap:6, marginBottom:7, flexWrap:'wrap' }}>
          HOA Fee
          <span style={{ fontWeight:400, textTransform:'none', letterSpacing:0, fontSize:10 }}>(monthly · enter 0 if none)</span>
          {fieldStatus.hoaMonthly === 'success'    && <span style={{ fontSize:10, fontWeight:700, color:C.green, background:C.greenBg, border:`1px solid ${C.greenBorder}`, borderRadius:100, padding:'1px 7px' }}>✓ auto-filled</span>}
          {fieldStatus.hoaMonthly === 'unverified' && <span style={{ fontSize:10, fontWeight:700, color:C.amber, background:C.amberBg, border:`1px solid ${C.amberBorder}`, borderRadius:100, padding:'1px 7px' }}>verify</span>}
        </label>
        <div style={{ position:'relative', animation:fieldStatus.hoaMonthly==='success' ? 'jiggle-green 0.45s ease, flash-green 0.6s ease' : fieldStatus.hoaMonthly==='unverified' ? 'jiggle-amber 0.45s ease, flash-amber 0.6s ease' : undefined }}>
          <span style={{ position:'absolute', left:12, top:'50%', transform:'translateY(-50%)', fontSize:14, color:C.muted }}>$</span>
          <input type="text" value={fields.hoaMonthly} onChange={e => setField('hoaMonthly')(e.target.value)}
            placeholder="e.g. 250 or 0" style={{ ...inputBase, paddingLeft:24, borderColor:errors.hoaMonthly ? C.red : fieldStatus.hoaMonthly==='success' ? C.green : fieldStatus.hoaMonthly==='unverified' ? C.amber : undefined, transition:'border-color 0.3s' }}/>
          {errors.hoaMonthly && <p style={{ fontSize:11, color:C.red, margin:'4px 0 0' }}>{errors.hoaMonthly}</p>}
        </div>
        <p style={{ fontSize:11, color:C.muted, margin:'5px 0 0', lineHeight:1.5 }}>Enter 0 if this property has no HOA.</p>
      </div>

      {/* Mode */}
      <div>
        <Label>Assumptions</Label>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:8 }}>
          {Object.entries(MODES).map(([key, cfg]) => {
            const active = mode === key;
            return (
              <button key={key} onClick={() => { setMode(key); setAdv(p => ({ ...p, vacancyOverride:'', capexOverride:'', maintenanceOverride:'' })); }}
                style={{ background:active ? cfg.color : C.white, border:`1.5px solid ${active ? cfg.color : C.border}`, borderRadius:10, padding:'10px 8px', cursor:'pointer', fontFamily:'inherit', textAlign:'center', transition:'all 0.15s', boxShadow:active ? `0 2px 8px ${cfg.color}40` : 'none' }}>
                <div style={{ fontSize:13, fontWeight:700, color:active ? '#fff' : C.text, marginBottom:3 }}>{cfg.label}</div>
                <div style={{ fontSize:10.5, color:active ? 'rgba(255,255,255,0.75)' : C.muted }}>{cfg.desc}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Advanced overrides */}
      <div>
        <button onClick={() => setAdvOpen(o => !o)}
          style={{ background:'none', border:'none', cursor:'pointer', fontFamily:'inherit', fontSize:12.5, color:C.muted, display:'flex', alignItems:'center', gap:6, padding:0 }}>
          <span style={{ display:'inline-block', transform:advOpen ? 'rotate(90deg)' : 'rotate(0deg)', transition:'transform 0.2s', fontSize:10 }}>▶</span>
          Advanced overrides
          {hasCustom && <span style={{ background:C.green, color:'#fff', borderRadius:100, fontSize:9, padding:'1px 7px', fontWeight:700 }}>CUSTOM</span>}
        </button>
        {advOpen && (
          <div style={{ marginTop:12, display:'flex', flexDirection:'column', gap:12, padding:'14px', background:C.soft, borderRadius:12, border:`1px solid ${C.border}` }}>
            {[
              { key:'vacancyOverride',     label:`Vacancy % (default ${adv._marketVacancy ? `${adv._marketVacancy}% market` : `${defaults.vacancy}%`})`, suffix:'%' },
              { key:'capexOverride',       label:`CapEx $/mo (default $${defaults.capex})`, prefix:'$' },
              { key:'maintenanceOverride', label:`Maintenance %/yr (default ${defaults.maintenance}%)`, suffix:'%' },
              { key:'appreciationOverride',label:`Appreciation %/yr (state avg: ${getStateAppreciation(fields.city).toFixed(1)}%)`, suffix:'%' },
              { key:'rentGrowthOverride',  label:`Rent Growth %/yr (default ${profile?._zoriGrowth ? `${profile._zoriGrowth}% ZORI${profile._zoriMetro ? ` — ${profile._zoriMetro}` : ' metro'}` : `${profile?._rentGrowthDefault ?? '3.2'}% BLS CPI Shelter`} — for IRR projection)`, suffix:'%' },
              ...(!adv.selfManage ? [{ key:'mgmtRateOverride', label:`Management % (local avg: ${getMgmtRateBenchmark(fields.city)}% NARPM 2024${fields.city ? ` — ${fields.city.split(',')[0].trim()}` : ''})`, suffix:'%' }] : []),
              { key:'closingCostPct', label:`Closing Costs % (${fields.city ? `${getClosingCostForState(fields.city).toFixed(1)}% avg in ${fields.city.split(',').pop()?.trim() || 'your state'}` : 'state avg auto-fills when city entered'} — adds to cash invested)`, suffix:'%' },
            ].map(f => (
              <div key={f.key} style={{ display:'flex', gap:8, alignItems:'center' }}>
                <span style={{ fontSize:12, color:C.muted, flex:1 }}>{f.label}</span>
                <div style={{ position:'relative', width:120 }}>
                  {f.prefix && <span style={{ position:'absolute', left:8, top:'50%', transform:'translateY(-50%)', fontSize:12, color:C.muted }}>{f.prefix}</span>}
                  <input type="text" value={adv[f.key] || ''} onChange={e => setAdv(p => ({ ...p, [f.key]:e.target.value }))}
                    style={{ ...inputBase, padding:'7px 10px', paddingLeft:f.prefix ? 20 : undefined, paddingRight:f.suffix ? 20 : undefined, fontSize:13 }}/>
                  {f.suffix && <span style={{ position:'absolute', right:8, top:'50%', transform:'translateY(-50%)', fontSize:12, color:C.muted }}>{f.suffix}</span>}
                </div>
                {adv[f.key] && <button onClick={() => setAdv(p => ({ ...p, [f.key]:'' }))} style={{ fontSize:11, color:C.muted, background:'none', border:`1px solid ${C.border}`, borderRadius:6, padding:'4px 8px', cursor:'pointer', fontFamily:'inherit' }}>✕</button>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Multi-step form ───────────────────────────────────────────────────────────

export function InputForm({ fields, setField, errors, adv, setAdv, mode, setMode, profile, setProfile, onSubmit, fetchStatus, fetchMsg, fieldStatus, stage }) {
  const [formStep, setFormStep] = useState(fields.price ? 1 : 0);
  useEffect(() => { if (fetchStatus === 'done' || fields.price) setFormStep(1); }, [fetchStatus, fields.price]);

  const rentProvided = Boolean(fields.rent.trim());
  const allRequiredFilled = fields.price.trim() && fields.city.trim() && fields.beds.toString().trim() &&
    fields.baths.toString().trim() && fields.sqft.toString().trim() && fields.year.toString().trim() &&
    fields.taxAnnual.toString().trim() && fields.hoaMonthly.toString().trim() !== '';
  const filled = [fields.price, fields.beds, fields.baths, fields.sqft, fields.year, fields.city].filter(Boolean).length;

  let confColor = C.red, confText = 'Fill in all required fields above before analyzing.';
  if (allRequiredFilled && rentProvided)  { confColor = C.green; confText = 'All fields complete - analysis will be precise.'; }
  else if (allRequiredFilled)             { confColor = C.amber; confText = 'Ready to analyze. Rent will be estimated by AI.'; }
  else if (rentProvided || filled >= 4)   { confColor = C.amber; confText = 'Almost there - fill in remaining fields to unlock analysis.'; }

  return (
    <Card>
      {/* Step tabs */}
      <div style={{ display:'flex', gap:0, marginBottom:24, background:C.soft, borderRadius:12, padding:4 }}>
        {['Your Situation', 'Property Details'].map((label, i) => (
          <button key={i} onClick={() => setFormStep(i)}
            style={{ flex:1, background:formStep===i ? C.white : 'transparent', border:'none', borderRadius:9, padding:'9px 0', cursor:'pointer', fontFamily:'inherit', fontSize:13, fontWeight:formStep===i ? 700 : 500, color:formStep===i ? C.text : C.muted, transition:'all 0.15s', boxShadow:formStep===i ? C.shadowSm : 'none' }}>
            {label}
          </button>
        ))}
      </div>

      {formStep === 0 && <StepSituation profile={profile} onChange={setProfile} selfManage={adv.selfManage} onSelfManage={v => setAdv(p => ({ ...p, selfManage:v }))} isProfileSaved={JSON.stringify(profile) !== JSON.stringify(EMPTY_PROFILE)}/>}
      {formStep === 1 && <StepProperty  fields={fields} setField={setField} errors={errors} adv={adv} setAdv={setAdv} mode={mode} setMode={setMode} fetchStatus={fetchStatus} fetchMsg={fetchMsg} fieldStatus={fieldStatus} profile={profile}/>}

      {/* Confidence + CTA */}
      <div style={{ marginTop:20, display:'flex', flexDirection:'column', gap:10 }}>
        {formStep === 1 && (
          <div style={{ display:'flex', alignItems:'center', gap:8, padding:'9px 13px', background:confColor+'12', border:`1px solid ${confColor}40`, borderRadius:10 }}>
            <div style={{ width:8, height:8, borderRadius:'50%', background:confColor, flexShrink:0 }}/>
            <span style={{ fontSize:12, color:confColor, fontWeight:600 }}>{confText}</span>
          </div>
        )}
        <div style={{ display:'flex', gap:8 }}>
          {formStep === 1 && <button onClick={() => setFormStep(0)} style={{ flex:1, background:C.soft, border:`1px solid ${C.border}`, borderRadius:12, padding:'13px', fontSize:14, fontWeight:600, color:C.muted, cursor:'pointer', fontFamily:'inherit' }}>← Back</button>}
          {formStep === 0
            ? <button onClick={() => setFormStep(1)} style={{ flex:1, background:C.text, border:'none', borderRadius:10, padding:'13px', fontSize:14, fontWeight:600, color:'#fff', cursor:'pointer', fontFamily:'inherit', letterSpacing:'-0.01em' }}>Continue →</button>
            : <button onClick={onSubmit} disabled={!allRequiredFilled || stage === 'loading'} style={{ flex:2, background:allRequiredFilled && stage !== 'loading' ? C.green : '#ccc', border:'none', borderRadius:10, padding:'13px', fontSize:14, fontWeight:600, color:'#fff', cursor:allRequiredFilled && stage !== 'loading' ? 'pointer' : 'not-allowed', fontFamily:'inherit', letterSpacing:'-0.01em', transition:'background 0.2s', display:'flex', alignItems:'center', justifyContent:'center', gap:8 }}>
                {stage === 'loading' ? <><div style={{ width:14, height:14, border:'2px solid rgba(255,255,255,0.4)', borderTopColor:'#fff', borderRadius:'50%', animation:'riq-spin 0.7s linear infinite' }}/>Analyzing...</> : 'Run Analysis →'}
              </button>
          }
        </div>
      </div>
    </Card>
  );
}

// ── Confirm card ──────────────────────────────────────────────────────────────

export function ConfirmCard({ fields, adv, mode, profile, onConfirm, onBack }) {
  const loanTypeLabel = LOAN_TYPES.find(lt => lt.key === (profile.loanType || '30yr_fixed'))?.label || '30yr Fixed';
  const financing     = profile.cashPurchase ? 'All Cash' : `${profile.downPaymentPct || 20}% down @ ${profile.interestRate || 6.99}% (${loanTypeLabel})`;
  const goal          = { cashflow:'Income-Focused', appreciation:'Appreciation', balanced:'Balanced Return', tax:'Tax & Equity' }[profile.goal] || profile.goal;
  const holdYrs       = profile.holdingYears || '5';
  const propTypeLabel = PROPERTY_TYPES.find(pt => pt.key === (fields.propertyType || 'sfr'))?.label || 'SFR';
  const extras        = [
    fields.hoaMonthly ? `HOA $${fields.hoaMonthly}/mo` : '',
    adv.closingCostPct ? `Closing ${adv.closingCostPct}%` : '',
    (parseFloat(profile.downPaymentPct) || 20) < 20 && !profile.cashPurchase ? 'PMI applies' : '',
  ].filter(Boolean).join(' · ');

  return (
    <Card style={{ border:`1.5px solid ${C.border}`, background:C.white }}>
      <Label>Confirm your analysis inputs</Label>
      <div style={{ display:'flex', flexDirection:'column', gap:0, marginBottom:16 }}>
        {[
          { label:'Price',     value:fields.price, big:true },
          { label:'Financing', value:financing,     big:false },
          { label:'Goal',      value:goal,          big:false },
        ].map((row, i) => (
          <div key={i} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'12px 0', borderBottom:i < 2 ? `1px solid ${C.greenBorder}` : 'none' }}>
            <span style={{ fontSize:14, color:C.green }}>{row.label}</span>
            <span style={{ fontSize:row.big ? 22 : 14, fontWeight:row.big ? 700 : 600, color:C.text, letterSpacing:row.big ? '-0.02em' : '0' }}>{row.value}</span>
          </div>
        ))}
      </div>
      <div style={{ display:'flex', flexWrap:'wrap', gap:6, marginBottom:16 }}>
        {[
          { icon:'🏠', label:propTypeLabel },
          { icon:'📅', label:`${holdYrs}-yr hold` },
          { icon:'⚖️', label:`${MODES[mode]?.label || mode} mode` },
          { icon:'🔧', label:adv.selfManage ? 'Self-managed' : 'Pro-managed' },
          fields.beds  ? { icon:'🛏',  label:`${fields.beds}bd/${fields.baths}ba` } : null,
          fields.sqft  ? { icon:'📐', label:`${fields.sqft} sqft` }               : null,
          fields.year  ? { icon:'🗓', label:`Built ${fields.year}` }               : null,
          fields.rent  ? { icon:'💵', label:`Rent ${fields.rent}` }               : { icon:'💵', label:'AI estimates rent' },
          fields.taxAnnual ? { icon:'🏛', label:`Tax $${fields.taxAnnual}/yr` }   : null,
        ].filter(Boolean).map((item, i) => (
          <span key={i} style={{ display:'inline-flex', alignItems:'center', gap:4, background:C.soft, border:`1px solid ${C.border}`, borderRadius:8, padding:'4px 10px', fontSize:12, color:C.text, fontWeight:500 }}>
            <span style={{ fontSize:11 }}>{item.icon}</span>{item.label}
          </span>
        ))}
      </div>
      {extras && <p style={{ fontSize:11, color:C.amber, marginBottom:16, lineHeight:1.5 }}>⚠ {extras}</p>}
      <div style={{ display:'flex', gap:10 }}>
        <button onClick={onBack}    style={{ flex:1, background:'transparent', border:`1.5px solid ${C.greenBorder}`, borderRadius:12, padding:'12px', fontSize:14, fontWeight:600, color:C.green, cursor:'pointer', fontFamily:'inherit' }}>← Edit</button>
        <button onClick={onConfirm} style={{ flex:2, background:C.text, border:'none', borderRadius:10, padding:'12px', fontSize:13.5, fontWeight:600, color:'#fff', cursor:'pointer', fontFamily:'inherit', letterSpacing:'-0.01em' }}>
          Confirm & Analyze →
          <span style={{ fontSize:10.5, fontWeight:400, opacity:0.55, marginLeft:6 }}>(1 token)</span>
        </button>
      </div>
    </Card>
  );
}

// NewAnalysisBtn — two-step confirm before discarding edits.
// Lives here (not in Results.jsx) to avoid circular import:
//   Results → cards/index → CommandCenter → Results (would create a cycle).
export function NewAnalysisBtn({ onReset }) {
  const [confirm, setConfirm] = useState(false);
  if (confirm) {
    return (
      <div style={{display:'flex',gap:6,alignItems:'center',animation:'riq-fadeup 0.15s ease'}}>
        <span style={{fontSize:11,color:C.amber,fontWeight:600,whiteSpace:'nowrap'}}>Discard edits?</span>
        <button onClick={onReset}
          style={{fontSize:12,color:'#fff',background:C.amber,border:'none',borderRadius:7,padding:'5px 10px',cursor:'pointer',fontFamily:'inherit',fontWeight:700}}>
          Yes
        </button>
        <button onClick={()=>setConfirm(false)}
          style={{fontSize:12,color:C.muted,background:'none',border:`1px solid ${C.border}`,borderRadius:7,padding:'5px 10px',cursor:'pointer',fontFamily:'inherit'}}>
          No
        </button>
      </div>
    );
  }
  return (
    <button onClick={()=>setConfirm(true)}
      style={{fontSize:12,color:C.muted,background:'none',border:`1px solid ${C.border}`,borderRadius:8,padding:'6px 14px',cursor:'pointer',fontFamily:'inherit',whiteSpace:'nowrap'}}>
      New Analysis
    </button>
  );
}
