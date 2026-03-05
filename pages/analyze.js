import { useState, useRef, useEffect, useCallback } from 'react';
import { useSession, signIn, signOut } from 'next-auth/react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import { TOKEN_PACKAGES } from '../lib/tokenPackages';

import { C, MODES, EMPTY_FIELDS, EMPTY_ADV, EMPTY_PROFILE, SAMPLE_DEAL, LOADING_STEPS, LOAN_TYPES } from '../components/analyze/tokens';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://rentaliq.app';
import { MD_BASELINE } from '../components/analyze/marketData';
import { setMarketData, recalcFromEdits, getMgmtRateBenchmark, getClosingCostForState } from '../components/analyze/marketHelpers';
import { InputForm, ConfirmCard, LoadingSpinner, Card, Label } from '../components/analyze/InputComponents';
import { Results } from '../components/analyze/Results';
import { FloatingChat } from '../components/analyze/Overlays';

const PROFILE_STORAGE_KEY = 'riq-investor-profile-v2';

function loadSavedProfile() {
  try {
    const raw = localStorage.getItem(PROFILE_STORAGE_KEY);
    if (!raw) return EMPTY_PROFILE;
    const saved = JSON.parse(raw);
    // Merge with EMPTY_PROFILE to handle new fields added in future versions
    return { ...EMPTY_PROFILE, ...saved };
  } catch (_) { return EMPTY_PROFILE; }
}

function saveProfile(profile) {
  try { localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profile)); } catch (_) {}
}

export default function Home() {
  const [fields,      setFields]      = useState(EMPTY_FIELDS);
  const [adv,         setAdv]         = useState(EMPTY_ADV);
  const [mode,        setMode]        = useState('moderate');
  const [profile,     setProfileRaw]  = useState(EMPTY_PROFILE);
  const [errors,      setErrors]      = useState({});
  const [stage,       setStage]       = useState('input');
  const [results,     setResults]     = useState(null);
  const [origResults, setOrigResults] = useState(null);
  const [scenario,    setScenario]    = useState('');
  const [isEdited,    setIsEdited]    = useState(false);
  const [errMsg,      setErrMsg]      = useState('');
  const [step,        setStep]        = useState(0);
  const confirmRef = useRef(null);
  const formRef    = useRef(null);   // scroll target for form/content area
  const loadingRef = useRef(null);   // scroll target so loading spinner is visible on mobile
  const stepTimer  = useRef(null);
  const chatOpenRef = useRef(null);  // callback ref to open FloatingChat from Results card

  // -- Profile persistence - load from localStorage on mount, auto-save on change --
  useEffect(() => {
    const saved = loadSavedProfile();
    setProfileRaw(saved);

    // ── Fetch all live market data from /api/market-data ─────────────────────
    // This single call replaces the old individual mortgage-rate fetch.
    // It loads: mortgage rates (all 3 types), CPI rent growth, tax/ins/appreciation
    // tables from Supabase cache — all refreshed automatically by cron.
    const defaultRate = EMPTY_PROFILE.interestRate;
    const userCustomizedRate = saved.interestRate && saved.interestRate !== defaultRate;

    fetch('/api/market-data', { signal: AbortSignal.timeout(4000) })
      .then(r => r.ok ? r.json() : null)
      .then(md => {
        if (!md) return;

        // Update the shared market data store so all lookup functions
        // (getInsRate, getStateTaxRate, etc.) immediately use live data
        setMarketData({
          ...MD_BASELINE, ...md,
          treasuryYield:     md.treasuryYield     ?? MD_BASELINE.treasuryYield,
          sp500Returns:      md.sp500Returns      ?? MD_BASELINE.sp500Returns,
          pmiRates:          md.pmiRates          ?? MD_BASELINE.pmiRates,
          stateClosingCosts: md.stateClosingCosts ?? MD_BASELINE.stateClosingCosts,
        });
        // Update React state so OpportunityCostPanel and closing cost hints re-render with live values
        setLiveBenchmarks({
          treasuryYield: md.treasuryYield?.rate ?? 4.62,
          treasuryAsOf:  md.treasuryYield?.asOf ?? null,
          sp500_10yr: md.sp500Returns?.return10yr ?? 12.4,
          sp500_5yr:  md.sp500Returns?.return5yr  ?? 13.8,
          sp500_3yr:  md.sp500Returns?.return3yr  ?? 8.7,
          sp500AsOf:  md.sp500Returns?.asOf ?? null,
          pmiRates:   md.pmiRates ?? null,
          stateClosingCosts: md.stateClosingCosts ?? null,
          source: md.source ?? 'supabase_cache',
        });

        // Update mortgage rate defaults — only for the loan type that hasn't been customized
        const { rate30yr, rate15yr, rate5arm } = md.mortgageRates || {};
        setProfileRaw(p => {
          let updated = { ...p };
          let changed = false;
          // 30yr: only update if user hasn't customized
          if (!userCustomizedRate && rate30yr && rate30yr > 3 && rate30yr < 12) {
            updated.interestRate = String(rate30yr.toFixed(2));
            changed = true;
          }
          // Store all three rates for loan-type switching
          if (rate15yr) { updated._rate15yr = String(rate15yr.toFixed(2)); changed = true; }
          if (rate5arm)  { updated._rate5arm  = String(rate5arm.toFixed(2));  changed = true; }
          // Store live rent growth default for the advanced panel
          if (md.rentGrowthDefault) { updated._rentGrowthDefault = String(md.rentGrowthDefault); changed = true; }
          // Phase 5: store treasury/S&P for display in benchmark panel
          if (md.treasuryYield?.rate)     { updated._treasuryRate = String(md.treasuryYield.rate); changed = true; }
          if (md.sp500Returns?.return10yr) { updated._sp500_10yr   = String(md.sp500Returns.return10yr); changed = true; }
          if (changed) { saveProfile(updated); return updated; }
          return p;
        });
      })
      .catch(() => { /* silently use MD_BASELINE already set as _MD default */ });
  }, []);

  function setProfile(updater) {
    setProfileRaw(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      saveProfile(next);
      return next;
    });
  }

  // -- Auth + token state ----------------------------------------------------
  const router     = useRouter();
  const { data: session, status: authStatus, update: updateSession } = useSession();
  const isAuthed   = authStatus === 'authenticated';
  const tokens     = session?.user?.tokens ?? null;
  const [showTokenModal, setShowTokenModal] = useState(false);
  const [purchaseToast,  setPurchaseToast]  = useState(null); // 'success' | 'cancelled' | null
  const [savedDealId,  setSavedDealId]  = useState(null);
  const [neighborhood, setNeighborhood] = useState(null);
  // Phase 5: live benchmark data in React state (not _MD global) so panel re-renders on fetch
  const [liveBenchmarks, setLiveBenchmarks] = useState({
    treasuryYield: 4.62,
    sp500_10yr: 12.4,
    sp500_5yr: 13.8,
    sp500_3yr: 8.7,
    pmiRates: { ltv95_97:0.95, ltv90_95:0.68, ltv85_90:0.45, ltv80_85:0.24 },
    stateClosingCosts: null,
    source: 'baseline',
  });
  const [neighborhoodLoading, setNeighborhoodLoading] = useState(false);
  // Phase 6: flood risk and school quality state
  const [floodData,     setFloodData]     = useState(null);
  const [floodLoading,  setFloodLoading]  = useState(false);
  const [schoolData,    setSchoolData]    = useState(null);
  // Phase 8: climate risk and STR data state
  const [climateData,   setClimateData]   = useState(null);
  const [climateLoading,setClimateLoading]= useState(false);
  const [strData,       setStrData]       = useState(null);
  const [strLoading,    setStrLoading]    = useState(false);
  const [safmrData,     setSafmrData]     = useState(null);
  const [showMobileNav,  setShowMobileNav]  = useState(false);
  const [showWelcome,    setShowWelcome]    = useState(false);
  const [authPrompt,     setAuthPrompt]     = useState(false); // show sign-in nudge
  const [demoUsed,       setDemoUsed]       = useState(false);
  const [showDemoGate,   setShowDemoGate]   = useState(false);

  // -- URL extraction state (lifted from StepProperty so hero can access it) -
  const [fetchStatus,  setFetchStatus]  = useState(null); // null|'loading'|'done'|'error'
  const [fetchMsg,     setFetchMsg]     = useState('');
  const [fieldStatus,  setFieldStatus]  = useState({});
  const urlDebounceRef = useRef(null);
  const fetchAbortRef  = useRef(null);  // AbortController for in-flight fetch-listing requests
  const lastFetchedUrl = useRef('');
  const savedDealIdRef = useRef(null);  // ref so async closures always read current value
  const _phase6ZipRef  = useRef(null);  // Phase 6: ZIP for school fetch, set by neighborhood callback

  useEffect(() => {
    if (stage !== 'input') return; // don't fetch when not on input screen
    const url = (fields.url||'').trim();
    if (!url || !url.startsWith('http')) { setFetchStatus(null); setFieldStatus({}); return; }
    if (url === lastFetchedUrl.current) return;
    clearTimeout(urlDebounceRef.current);
    // Abort any in-flight request from a previous URL
    if (fetchAbortRef.current) { fetchAbortRef.current.abort(); fetchAbortRef.current = null; }
    urlDebounceRef.current = setTimeout(async () => {
      if (!url.startsWith('http')) return;

      // Detect search/homepage URLs before wasting an API call
      const isZillow  = url.includes('zillow.com');
      const isRedfin  = url.includes('redfin.com');
      const isRealtor = url.includes('realtor.com');
      const isKnownSite = isZillow || isRedfin || isRealtor;
      if (isKnownSite) {
        const nonListingPatterns = [
          /zillow\.com\/(homes|search|browse|mortgage|rent|agents|profile|blog)\//i,
          /zillow\.com\/?$/, /zillow\.com\/\?/,
          /redfin\.com\/(city|zip|school|news|buy-a-home|sell-a-home|agents|mortgage)\/?/i,
          /redfin\.com\/?$/, /redfin\.com\/\?/,
          /realtor\.com\/(realestateandhomes-search|find-realtor|news|advice)\//i,
          /realtor\.com\/?$/, /realtor\.com\/\?/,
        ];
        if (nonListingPatterns.some(p => p.test(url))) {
          setFetchStatus('error');
          setFetchMsg('That looks like a search page, not a listing. Open a specific property and copy that URL.');
          return;
        }
      }
      setFetchStatus('loading'); setFetchMsg('Searching listing...'); setFieldStatus({});
      lastFetchedUrl.current = url;
      const controller = new AbortController();
      fetchAbortRef.current = controller;

      // Progressive feedback — AI grounding takes 10-15s, users need to know it's working
      const msgTimer1 = setTimeout(() => {
        if (fetchAbortRef.current === controller) setFetchMsg('Looking up property data...');
      }, 4000);
      const msgTimer2 = setTimeout(() => {
        if (fetchAbortRef.current === controller) setFetchMsg('Almost there — fetching taxes & details...');
      }, 10000);
      // Hard frontend timeout — if Vercel 504s or AI stalls, fail gracefully after 38s
      const hardTimeout = setTimeout(() => {
        if (fetchAbortRef.current === controller) {
          controller.abort();
        }
      }, 38000);
      // Snapshot fields BEFORE async fetch so autofill won't overwrite manually typed values
      let fieldsAtFetchStart = {};
      setFields(cur => { fieldsAtFetchStart = cur; return cur; });
      try {
        const res = await fetch('/api/fetch-listing', {
          method:'POST', headers:{'content-type':'application/json'},
          body: JSON.stringify({url}),
          signal: controller.signal,
        });
        const data = await res.json();
        if (!res.ok || data.error) {
          setFetchStatus('error');
          setFetchMsg(data.error || 'Could not read listing - fill in fields manually.');
          setFieldStatus({price:'fail',rent:'fail',beds:'fail',baths:'fail',sqft:'fail',year:'fail',city:'fail',taxAnnual:'fail',hoaMonthly:'fail'});
          return;
        }

        // Apply whatever fields we got (works for both full and blocked/partial)
        // Only overwrite fields that were EMPTY when the fetch started - never clobber manual entries
        const FIELD_MAP = {price:'price',rent:'rent',beds:'beds',baths:'baths',sqft:'sqft',year:'year',city:'city',taxAnnual:'taxAnnual',hoaMonthly:'hoaMonthly'};
        const confMap   = data.confidence || {};  // { field: 'high' | 'medium' | 'low' }
        const newStatus = {};
        for (const [key, fieldKey] of Object.entries(FIELD_MAP)) {
          const alreadyFilled = fieldsAtFetchStart[fieldKey] && String(fieldsAtFetchStart[fieldKey]).trim() !== '';
          if (data[key] !== null && data[key] !== undefined && data[key] !== '') {
            if (!alreadyFilled) setField(fieldKey)(String(data[key]));
            // Map confidence level to badge state:
            // high/medium → 'success' (green ✓ auto-filled)
            // low         → 'unverified' (amber, verify badge — persists until user edits)
            const conf = confMap[key];
            newStatus[fieldKey] = alreadyFilled ? 'success' : (conf === 'low' ? 'unverified' : 'success');
          } else {
            newStatus[fieldKey] = alreadyFilled ? 'success' : 'fail';
          }
        }
        setFieldStatus(newStatus);

        const popCount      = data.populated?.length || 0;
        const failCount     = data.failed?.length || 0;
        const unverifiedCount = Object.values(newStatus).filter(v => v === 'unverified').length;
        const isPartial     = failCount > 0 || data.warning;

        // If any fields failed to fill, scroll down to the form so user sees what needs attention
        if (failCount > 0) {
          setTimeout(() => formRef.current?.scrollIntoView({behavior:'smooth', block:'start'}), 300);
        }

        if (data.blocked) {
          // Blocked by the site — tell user clearly, surface any partial data
          setFetchStatus('error');
          setFetchMsg(data.warning || 'Site blocked this request — please enter details manually.');
        } else if (isPartial) {
          // Partial extraction — got something but not everything
          // Use 'partial' so the hero bar turns amber instead of green,
          // and the 'Analyze →' button only shows when all required fields are actually filled
          setFetchStatus('partial');
          setFetchMsg(data.warning || (popCount > 0
            ? `Filled ${popCount} field${popCount>1?'s':''}${unverifiedCount>0?` · ${unverifiedCount} need verification`:''}${failCount>0?` · ${failCount} still missing`:''}`
            : 'Could not read listing — fill in manually.'));
        } else {
          setFetchStatus('done');
          setFetchMsg(unverifiedCount > 0
            ? `Auto-filled ${popCount} field${popCount>1?'s':''} · ${unverifiedCount} flagged for verification`
            : `Auto-filled ${popCount} field${popCount>1?'s':''} · all set!`);
        }

        // Clear SUCCESS badges after 4s (their purpose is served).
        // UNVERIFIED (amber) badges persist like FAIL — until user edits the field.
        // This ensures low-confidence values are never silently accepted.
        setTimeout(() => setFieldStatus(prev => {
          const next = {};
          for (const [k,v] of Object.entries(prev)) {
            if (v === 'fail' || v === 'unverified') next[k] = v; // persist both
          }
          return next;
        }), 4000);
      } catch(err) {
        if (err.name === 'AbortError') return; // stale request cancelled or timed out
        setFetchStatus('error');
        setFetchMsg('Network error - fill in manually.');
      } finally {
        clearTimeout(msgTimer1);
        clearTimeout(msgTimer2);
        clearTimeout(hardTimeout);
        if (fetchAbortRef.current === controller) fetchAbortRef.current = null;
      }
    }, 500);
    return () => { clearTimeout(urlDebounceRef.current); };
  }, [fields.url, stage]);

  function setField(key){
    return val => {
      setFields(p=>({...p,[key]:val}));
      setErrors(p=>({...p,[key]:''}));
      setFieldStatus(p=>({...p,[key]:undefined}));
      // Phase 5: when city changes, auto-fill closing cost + fetch ZORI rent growth
      if (key === 'city' && val && val.length > 4) {
        // Closing cost: auto-fill from state table if not already set by user
        const suggested = getClosingCostForState(val);
        setAdv(a => a.closingCostPct ? a : { ...a, closingCostPct: String(suggested.toFixed(1)) });

        // ZORI: fetch metro rent growth in background, store in profile for label + analyze payload
        // Debounce: only fetch when city looks complete (has comma = "City, ST")
        if (val.includes(',')) {
          fetch(`/api/zori-for-city?city=${encodeURIComponent(val)}`, { signal: AbortSignal.timeout(4000) })
            .then(r => r.ok ? r.json() : null)
            .then(zori => {
              if (zori?.found && zori.annualGrowthPct != null) {
                setProfileRaw(p => {
                  const updated = { ...p, _zoriGrowth: String(zori.annualGrowthPct), _zoriMetro: zori.metro || val };
                  saveProfile(updated);
                  return updated;
                });
              } else {
                // Clear stale ZORI from previous city
                setProfileRaw(p => {
                  if (!p._zoriGrowth) return p;
                  const updated = { ...p, _zoriGrowth: '', _zoriMetro: '' };
                  saveProfile(updated);
                  return updated;
                });
              }
            })
            .catch(() => {}); // silently fail — national CPI is the fallback
        }
      }
    };
  }

  // Computed in Home scope so hero bars can gate the Analyze → button correctly
  const allRequiredFilled = !!(
    fields.price?.trim() && fields.city?.trim() &&
    fields.beds?.toString().trim() && fields.baths?.toString().trim() &&
    fields.sqft?.toString().trim() && fields.year?.toString().trim() &&
    fields.taxAnnual?.toString().trim() && fields.hoaMonthly?.toString().trim() !== ''
  );

  function validate(){
    const e={};
    if(!fields.price.trim())e.price='Required';
    if(!fields.city.trim())e.city='Required';
    if(!fields.beds.toString().trim())e.beds='Required';
    if(!fields.baths.toString().trim())e.baths='Required';
    if(!fields.sqft.toString().trim())e.sqft='Required';
    if(!fields.year.toString().trim())e.year='Required';
    if(!fields.taxAnnual.toString().trim())e.taxAnnual='Required';
    if(fields.hoaMonthly.toString().trim()==='')e.hoaMonthly='Required (enter 0 if none)';
    return e;
  }

  function handleSubmit(){const e=validate();if(Object.keys(e).length){setErrors(e);return;}
    // Abort any in-flight URL fetch so it can't overwrite fields after analysis starts
    if (fetchAbortRef.current) { fetchAbortRef.current.abort(); fetchAbortRef.current = null; }
    // Unauthed users have no profile to confirm - skip straight to analysis
    if (!isAuthed) { runAnalysis(); return; }
    setStage('confirm');setTimeout(()=>confirmRef.current?.scrollIntoView({behavior:'smooth',block:'start'}),50);}

  const startSteps=useCallback(()=>{setStep(0);let s=0;stepTimer.current=setInterval(()=>{s=Math.min(s+1,LOADING_STEPS.length-1);setStep(s);},2400);},[]);
  const stopSteps =useCallback(()=>{clearInterval(stepTimer.current);stepTimer.current=null;},[]);
  useEffect(()=>()=>clearInterval(stepTimer.current),[]);

  async function fetchAnalysis(overrides={}) {
    const _headers = {'content-type':'application/json'};
    if (!isAuthed) _headers['x-demo'] = '1';
    // When overrides are present (re-run AI), use them; otherwise fall back to current form state
    const res=await fetch('/api/analyze',{method:'POST',headers:_headers,body:JSON.stringify({
      listingUrl:          fields.url    ||undefined,
      price:               overrides.price          ||fields.price,
      rent:                overrides.rent           ||fields.rent||undefined,
      beds:                fields.beds    ||undefined,
      baths:               fields.baths   ||undefined,
      sqft:                fields.sqft    ||undefined,
      year:                fields.year    ||undefined,
      city:                fields.city,
      mode:                overrides.mode           || mode,
      selfManage:          overrides.selfManage      != null ? overrides.selfManage      : adv.selfManage,
      mgmtRate:            overrides.mgmtRate        != null ? overrides.mgmtRate        : (adv.selfManage ? 0 : (parseFloat(adv.mgmtRateOverride) || getMgmtRateBenchmark(fields.city))),
      taxAnnualAmount:     fields.taxAnnual||null,
      vacancyOverride:     overrides.vacancyOverride  != null ? overrides.vacancyOverride  : (adv.vacancyOverride    ||null),
      capexOverride:       overrides.capexOverride    != null ? overrides.capexOverride    : (adv.capexOverride       ||null),
      maintenanceOverride: overrides.maintenanceOverride != null ? overrides.maintenanceOverride : (adv.maintenanceOverride ||null),
      cashPurchase:        overrides.cashPurchase   != null ? overrides.cashPurchase   : profile.cashPurchase,
      downPaymentPct:      overrides.downPaymentPct != null ? overrides.downPaymentPct : profile.downPaymentPct,
      interestRate:        overrides.interestRate   != null ? overrides.interestRate   : profile.interestRate,
      loanTermYears:       overrides.loanTermYears  != null ? overrides.loanTermYears  : ((LOAN_TYPES.find(lt=>lt.key===(profile.loanType||'30yr_fixed'))?.years)||30),
      loanType:            overrides.loanType        || profile.loanType || '30yr_fixed',
      holdingYears:        overrides.holdingYears   != null ? overrides.holdingYears   : (parseFloat(profile.holdingYears) || 5),
      investorGoal:        overrides.investorGoal    || profile.goal,
      appreciationOverride:overrides.appreciationOverride != null ? overrides.appreciationOverride : (adv.appreciationOverride ? parseFloat(adv.appreciationOverride) : undefined),
      // rentGrowthOverride priority: explicit override > adv field > ZORI from profile > undefined (server uses CPI)
      rentGrowthOverride:  overrides.rentGrowthOverride  != null
        ? overrides.rentGrowthOverride
        : (adv.rentGrowthOverride
          ? parseFloat(adv.rentGrowthOverride)
          : (profile._zoriGrowth ? parseFloat(profile._zoriGrowth) : undefined)),
      hoaMonthly:          overrides.hoaMonthly     != null ? overrides.hoaMonthly     : (fields.hoaMonthly ? parseFloat(fields.hoaMonthly) : undefined),
      closingCostPct:      overrides.closingCostPct != null ? overrides.closingCostPct : (adv.closingCostPct ? parseFloat(adv.closingCostPct) : undefined),
      propertyType:        overrides.propertyType    || fields.propertyType || 'sfr',
    })});
    const data=await res.json();
    if (res.status === 401) { setAuthPrompt(true); throw new Error('__silent__'); }
    if (res.status === 402) { setShowTokenModal(true); throw new Error('__silent__'); }
    if (res.status === 429) throw new Error('AI is rate-limited right now - wait 60 seconds and try again.');
    if (res.status === 504) throw new Error('Analysis timed out - this sometimes happens on complex properties. Try again.');
    if (!res.ok) throw new Error(data?.error||`Unexpected error (${res.status}). Please try again.`);
    if (!data.verdict||data.overallScore===undefined) throw new Error('Incomplete response from AI. Please try again.');
    return data;
  }

  const runAnalysis=useCallback(async()=>{
    // Auth gate - authed users need tokens; unauthed get 1 free demo
    if (isAuthed && tokens !== null && tokens <= 0) { setShowTokenModal(true); return; }
    if (!isAuthed && demoUsed) { setAuthPrompt(true); return; }
    try { localStorage.setItem('riq-welcome-seen','1'); } catch(_) {}
      setShowWelcome(false);
      setStage('loading');startSteps();
      // Scroll loading spinner into view immediately on mobile — prevents double-tap
      setTimeout(()=>loadingRef.current?.scrollIntoView({behavior:'smooth',block:'start'}),30);
    const tid=setTimeout(()=>{stopSteps();setErrMsg('Timed out - please try again.');setStage('error');},57000);
    try {
      const data=await fetchAnalysis();
      clearTimeout(tid);stopSteps();
      setResults(data);setOrigResults(data);setScenario('');setStage('results');setIsEdited(false);
      setTimeout(()=>window.scrollTo({top:0,behavior:'smooth'}),50);
      if (!isAuthed) setDemoUsed(true);
      // Update session token count from response
      if (typeof data.tokensRemaining === 'number') {
        updateSession({ tokens: data.tokensRemaining });
      }
      // Auto-save deal to history - only for authenticated users
      if (isAuthed) {
        fetch('/api/deals/save', {
          method:'POST', headers:{'content-type':'application/json'},
          body: JSON.stringify({ analysisData: data }),
        }).then(r => r.ok ? r.json() : null)
          .then(saved => { if (saved?.id) { setSavedDealId(saved.id); savedDealIdRef.current = saved.id; } })
          .catch(err => console.warn('Deal save failed (non-fatal):', err));
      }

      // Async neighborhood enrichment - fire and forget, non-blocking (authed only - saves quota)
      const neighborhoodAddress = data.address || '';
      const neighborhoodCity    = data.city    || fields.city    || '';
      if (isAuthed && (neighborhoodAddress || neighborhoodCity)) {
        setNeighborhoodLoading(true);
        fetch('/api/neighborhood', {
          method:  'POST',
          headers: { 'content-type': 'application/json' },
          body:    JSON.stringify({ address: neighborhoodAddress, city: neighborhoodCity }),
        })
          .then(r => r.ok ? r.json() : null)
          .then(nb => {
            setNeighborhood(nb);
            setNeighborhoodLoading(false);
            // Wire vacancy rate from Census ACS into advanced settings (only if user hasn't overridden)
            if (nb?.vacancyRate?.rate != null) {
              setAdv(prev => {
                // Only apply if user hasn't manually set a vacancy override
                if (prev.vacancyOverride) return prev;
                return { ...prev, _marketVacancy: nb.vacancyRate.rate.toFixed(1) };
              });
            }
            // Patch saved deal with neighborhood data so share page shows it
            if (nb && savedDealIdRef.current) {
              fetch(`/api/deals/${savedDealIdRef.current}`, {
                method:  'PATCH',
                headers: { 'content-type': 'application/json' },
                body:    JSON.stringify({ neighborhood: nb }),
              }).catch(() => {});
            }
            // Phase 6B: Trigger school quality fetch using ZIP from neighborhood geocode
            // Only for SFR/condo where school quality meaningfully impacts the deal
            // Use data._settings (fresh analysis object in scope), not results state (stale closure)
            const propType = data._settings?.propertyType || 'sfr';
            if (nb?.zip && (propType === 'sfr' || propType === 'condo')) {
              fetch(`/api/school-rating?zip=${nb.zip}`)
                .then(r => r.ok ? r.json() : null)
                .then(sd => { if (sd && sd.count > 0) setSchoolData(sd); })
                .catch(() => {});
            }

            // Phase 8C: SAFMR fetch using ZIP from neighborhood geocode
            if (nb?.zip) {
              const beds = data._settings?.beds || fields.beds || 2;
              fetch(`/api/safmr-rent?zip=${nb.zip}&beds=${beds}`)
                .then(r => r.ok ? r.json() : null)
                .then(sd => { if (sd?.rent) setSafmrData(sd); })
                .catch(() => {});
            }
          })
          .catch(() => setNeighborhoodLoading(false));
      }

      // Phase 6A: Flood risk — async, fire and forget, uses geocoded lat/lng
      // The neighborhood fetch geocodes the address; we pass the full address string
      // and let /api/flood-risk geocode it independently (same Census geocoder).
      const addressForFlood = data.address || neighborhoodAddress || '';
      if (isAuthed && addressForFlood) {
        setFloodLoading(true);
        setFloodData(null);
        const floodParams = new URLSearchParams({ address: addressForFlood });
        fetch(`/api/flood-risk?${floodParams}`)
          .then(r => r.ok ? r.json() : null)
          .then(fd => { setFloodData(fd); setFloodLoading(false); })
          .catch(() => setFloodLoading(false));
      }

      // Phase 8A: Climate risk — async, fire and forget, geocodes city to county FIPS
      const cityForClimate = data._settings?.city || fields.city || '';
      const stateForClimate = data._settings?.stateCode || '';
      if (isAuthed && cityForClimate) {
        setClimateLoading(true);
        setClimateData(null);
        const climateParams = new URLSearchParams({ city: cityForClimate, state: stateForClimate });
        fetch(`/api/climate-risk?${climateParams}`)
          .then(r => r.ok ? r.json() : null)
          .then(cd => { setClimateData(cd); setClimateLoading(false); })
          .catch(() => setClimateLoading(false));
      }

      // Phase 8B: STR data — only for SFR/condo, fetch market data for city + beds
      const propTypeForStr = data._settings?.propertyType || 'sfr';
      if (isAuthed && (propTypeForStr === 'sfr' || propTypeForStr === 'condo') && fields.city) {
        setStrLoading(true);
        setStrData(null);
        const strParams = new URLSearchParams({
          city: fields.city,
          beds: data._settings?.beds || fields.beds || '2',
        });
        fetch(`/api/str-data?${strParams}`)
          .then(r => r.ok ? r.json() : null)
          .then(sd => { setStrData(sd); setStrLoading(false); })
          .catch(() => setStrLoading(false));
      }

      // Phase 6B: School quality — fired from the neighborhood callback above
      // once nb.zip is available. _phase6ZipRef is not used here; see nb callback.
      _phase6ZipRef.current = null;
    } catch(e) {
      clearTimeout(tid);stopSteps();
      if (e.message === '__silent__') return;
      setErrMsg(e.message||'Something went wrong.');setStage('error');
    }
  },[fields,adv,mode,profile,startSteps,stopSteps]);

  function handleRecalc(edits){if(results){setResults(prev=>recalcFromEdits(prev,edits));setIsEdited(true);}}

  async function handleRerunAI(){
    if(!results)return;
    if (!isAuthed && demoUsed) { setAuthPrompt(true); setShowDemoGate(true); return; }
    setStage('loading');startSteps();
    setTimeout(()=>loadingRef.current?.scrollIntoView({behavior:'smooth',block:'start'}),30);
    const s=results._settings||{};
    try {
      // Pass ALL original _settings as explicit overrides - ensures re-run uses the exact
      // same financing, property type, HOA, closing costs, holding period as original analysis,
      // even if the user has since changed their profile/adv state in the form.
      const data=await fetchAnalysis({
        price:               results.assumedPrice,
        rent:                results.assumedRent,
        cashPurchase:        s.cashPurchase,
        downPaymentPct:      s.downPaymentPct,
        interestRate:        s.interestRate,
        loanType:            s.loanType            || '30yr_fixed',
        loanTermYears:       s.loanTermYears        || 30,
        holdingYears:        s.holdingYears         || 5,
        propertyType:        s.propertyType         || 'sfr',
        hoaMonthly:          s.hoaMonthly           || undefined,
        closingCostPct:      s.closingCostPct       || undefined,
        selfManage:          s.selfManage,
        mgmtRate:            s.mgmtRate,
        mode:                s.mode                 || 'moderate',
        vacancyOverride:     s.vacancy,
        capexOverride:       s.capex,
        maintenanceOverride: s.maintenance,
        appreciationOverride:s.appreciationRate,
        rentGrowthOverride:  s.rentGrowthRate,
        investorGoal:        s.investorGoal,
      });
      stopSteps();setResults(data);setOrigResults(data);setScenario('');setStage('results');setIsEdited(false);
    } catch(e){stopSteps();setErrMsg(e.message||'Something went wrong.');setStage('error');}
  }

  function handleChatUpdate(updated,label){setOrigResults(p=>p||results);setResults(updated);setScenario(label||'Updated');}
  function reset(){setStage('input');setResults(null);setOrigResults(null);setScenario('');setIsEdited(false);setErrMsg('');setErrors({});setFields(EMPTY_FIELDS);setAdv(EMPTY_ADV);setMode('moderate');setProfileRaw(loadSavedProfile());setSavedDealId(null);
    setNeighborhood(null);setNeighborhoodLoading(false);savedDealIdRef.current=null;setFetchStatus(null);setFetchMsg('');setFieldStatus({});lastFetchedUrl.current='';setShowDemoGate(false);setAuthPrompt(false);
    // Phase 6 reset
    setFloodData(null);setFloodLoading(false);setSchoolData(null);_phase6ZipRef.current=null;
    // Phase 8 reset
    setClimateData(null);setClimateLoading(false);setStrData(null);setStrLoading(false);setSafmrData(null);
  }

  const investorProfile={cashPurchase:profile.cashPurchase,downPaymentPct:profile.downPaymentPct,interestRate:profile.interestRate,loanType:profile.loanType||'30yr_fixed',holdingYears:profile.holdingYears||5,goal:profile.goal,propertyType:fields.propertyType||'sfr',hoaMonthly:fields.hoaMonthly||0,closingCostPct:adv.closingCostPct||0};

  // -- Sample deal loader ----------------------------------------------------
  function loadSampleDeal() {
    setFields(SAMPLE_DEAL);
    setFetchStatus(null);
    setFetchMsg('');
    lastFetchedUrl.current = ''; // reset so the same URL can be re-fetched later
    setFieldStatus({
      price:'success', rent:'success', beds:'success', baths:'success',
      sqft:'success', year:'success', city:'success', taxAnnual:'success', hoaMonthly:'success',
    });
    // Clear field status after animation
    setTimeout(() => setFieldStatus({}), 3000);
    // Scroll to form area
    setTimeout(() => formRef.current?.scrollIntoView?.({behavior:'smooth', block:'start'}), 80);
  }

  // -- Load saved deal by ID from URL param ---------------------------------
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    // Capture referral code and store for sign-in redirect
    const ref = params.get('ref');
    if (ref) sessionStorage.setItem('pendingRef', ref);
    const dealId = params.get('deal');
    if (!dealId) return;
    // Clean URL immediately
    window.history.replaceState({}, '', '/analyze');
    fetch(`/api/deals/${dealId}`)
      .then(r => r.json())
      .then(({ deal }) => {
        if (deal?.data) {
          setResults(deal.data);
          setOrigResults(deal.data);
          setStage('results');
          // Restore neighborhood data if it was saved with the deal
          if (deal.data.neighborhood) setNeighborhood(deal.data.neighborhood);
          // Phase 6: restore supply/demand from deal data (already embedded in _buildingPermits/_metroGrowth)
          // Flood and school need fresh API calls — they're address-specific and not saved with deal
        }
      })
      .catch(err => console.warn('Could not load saved deal:', err));
  }, []);

  // Handle Stripe return - refresh session to get updated token count
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const purchase = params.get('purchase');
    if (!purchase) return;
    window.history.replaceState({}, '', '/analyze');
    if (purchase === 'success') {
      // Force session refresh so token count updates immediately
      updateSession();
      setShowTokenModal(false);
      setPurchaseToast('success');
      setTimeout(() => setPurchaseToast(null), 5000);
    } else if (purchase === 'cancelled') {
      setPurchaseToast('cancelled');
      setTimeout(() => setPurchaseToast(null), 4000);
    }
  }, []);

  // Show welcome banner for first-time users (≤1 token, never dismissed)
  useEffect(() => {
    if (!isAuthed || tokens === null) return;
    if (stage !== 'input') return;
    try {
      if (!localStorage.getItem('riq-welcome-seen') && tokens <= 1) {
        setShowWelcome(true);
      }
    } catch (_) {}
  }, [isAuthed, tokens, stage]);

  // If user came from landing pricing CTA (e.g. /auth?plan=bundle), open token modal after login
  useEffect(() => {
    if (!isAuthed) return;
    try {
      const plan = sessionStorage.getItem('riq-pending-plan');
      if (plan) {
        sessionStorage.removeItem('riq-pending-plan');
        // Small delay so the page settles before showing modal
        setTimeout(() => setShowTokenModal(true), 600);
      }
    } catch (_) {}
  }, [isAuthed]);

  return (
    <>
      <Head>
        <title>RentalIQ - Instant Rental Property Analysis</title>
        <meta name="description" content="Paste any Zillow, Redfin, or Realtor.com listing URL. Get cap rate, cash flow, wealth projection, and a buy/pass verdict in seconds."/>
        <meta property="og:title" content="RentalIQ - Instant Rental Property Analysis"/>
        <meta property="og:description" content="Paste any listing URL. Get cap rate, cash flow, wealth projection, and an AI buy/pass verdict instantly."/>
        <meta property="og:type" content="website"/>
        <meta property="og:url" content={`${APP_URL}/analyze`}/>
        <meta property="og:image" content={`${APP_URL}/og-image.png`}/>
        <meta property="og:image:width" content="1200"/>
        <meta property="og:image:height" content="630"/>
        <meta name="twitter:card" content="summary_large_image"/>
        <meta name="twitter:site" content="@rentaliq"/>
        <meta name="twitter:image" content={`${APP_URL}/og-image.png`}/>
        <link rel="canonical" href={`${APP_URL}/analyze`}/>
        <meta name="viewport" content="width=device-width, initial-scale=1"/>
      </Head>
      <style>{`
        @keyframes riq-spin      {to{transform:rotate(360deg)}}
        @keyframes riq-fadeup    {from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
        @keyframes riq-pulse     {0%,100%{opacity:1;transform:scale(1)}50%{opacity:0.45;transform:scale(0.65)}}
        @keyframes riq-pulse-glow{0%,100%{opacity:1;box-shadow:0 0 8px #4ade80}50%{opacity:0.7;box-shadow:0 0 16px #4ade80,0 0 32px rgba(74,222,128,0.3)}}
        .riq-reveal{opacity:0;transform:translateY(28px);transition:opacity .6s ease,transform .6s ease}
        .riq-reveal.riq-up{opacity:1;transform:none}
        .riq-reveal.riq-d1{transition-delay:.07s}
        .riq-reveal.riq-d2{transition-delay:.15s}
        .riq-reveal.riq-d3{transition-delay:.23s}
        .riq-reveal.riq-d4{transition-delay:.31s}
        .riq-lift{transition:transform .22s ease,box-shadow .22s ease}
        .riq-lift:hover{transform:translateY(-4px);box-shadow:0 12px 40px rgba(0,0,0,0.09)!important}
        /* Landing page mobile */
        @media(max-width:640px){
          .riq-proof-grid{grid-template-columns:1fr!important}
          .riq-landing h1{font-size:42px!important}
        }
        @keyframes riq-slideup  {from{opacity:0;transform:translateY(100%)}to{opacity:1;transform:translateY(0)}}
        @keyframes riq-popin  {from{opacity:0;transform:scale(0.4)}to{opacity:1;transform:scale(1)}}
        @keyframes riq-bounce {0%,80%,100%{transform:translateY(0)}40%{transform:translateY(-5px)}}
        @keyframes jiggle-green {
          0%,100%{transform:translateX(0) scale(1)} 15%{transform:translateX(-4px) scale(1.02)}
          30%{transform:translateX(4px) scale(1.02)} 45%{transform:translateX(-3px)}
          60%{transform:translateX(3px)} 75%{transform:translateX(-1px)}
        }
        @keyframes jiggle-red {
          0%,100%{transform:translateX(0)} 15%{transform:translateX(-5px)} 30%{transform:translateX(5px)}
          45%{transform:translateX(-4px)} 60%{transform:translateX(4px)} 75%{transform:translateX(-2px)}
        }
        @keyframes jiggle-amber {
          0%,100%{transform:translateX(0) scale(1)} 20%{transform:translateX(-3px) scale(1.01)}
          40%{transform:translateX(3px) scale(1.01)} 60%{transform:translateX(-2px)}
          80%{transform:translateX(2px)}
        }
        @keyframes flash-green {
          0%{box-shadow:0 0 0 0 rgba(45,122,79,0);background:transparent}
          30%{box-shadow:0 0 0 4px rgba(45,122,79,0.25);background:#eef7f2}
          100%{box-shadow:0 0 0 0 rgba(45,122,79,0);background:transparent}
        }
        @keyframes flash-red {
          0%{box-shadow:0 0 0 0 rgba(184,50,50,0);background:transparent}
          30%{box-shadow:0 0 0 4px rgba(184,50,50,0.20);background:#fdf0f0}
          100%{box-shadow:0 0 0 0 rgba(184,50,50,0);background:transparent}
        }
        @keyframes flash-amber {
          0%{box-shadow:0 0 0 0 rgba(138,88,0,0);background:transparent}
          30%{box-shadow:0 0 0 4px rgba(138,88,0,0.18);background:#fdf4e8}
          100%{box-shadow:0 0 0 0 rgba(138,88,0,0);background:transparent}
        }
        *{box-sizing:border-box}
        input:focus{border-color:#166638!important;background:#fff!important;outline:none!important;box-shadow:0 0 0 3px rgba(22,102,56,0.10)!important}
        /* -- Mobile -- */
        @media(max-width:600px){
          /* Grid collapses */
          .riq-g2{grid-template-columns:1fr!important}
          .riq-g3{grid-template-columns:1fr 1fr!important}
          .riq-metrics{grid-template-columns:1fr 1fr!important}
          .riq-metrics .riq-m-label{font-size:8.5px!important;letter-spacing:0.06em!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important}
          .riq-metrics .riq-m-value{font-size:18px!important}
          .riq-metrics .riq-m-note{font-size:9.5px!important}
          .riq-sr{grid-template-columns:100px 1fr 30px!important}
          /* Hero */
          .riq-hero-h1{font-size:32px!important;line-height:1.1!important}
          .riq-hero-sub{font-size:15px!important}
          .riq-hero-bar{flex-wrap:wrap!important;padding:8px!important;gap:8px!important;border-radius:14px!important}
          .riq-hero-bar input{font-size:14px!important;min-width:0!important}
          .riq-hero-bar-cta{width:100%!important;text-align:center!important;padding:12px!important}
          /* Nav */
          .riq-nav{padding:0 16px!important}
          .riq-nav-links{display:none!important}
          .riq-hamburger{display:flex!important}
          .riq-nav-tokens{font-size:11px!important;padding:4px 8px!important}
          /* Score ring - smaller on mobile */
          .riq-score-ring{width:110px!important;height:110px!important}
          /* Command center */
          .riq-verdict{font-size:40px!important}
          /* Padding */
          .riq-page{padding:0 12px 80px!important}
          .riq-card{padding:18px 16px!important}
          /* Hero header */
          .riq-hero-header{padding:56px 16px 48px!important}
        }
        @media(prefers-reduced-motion:reduce){
          .riq-reveal{opacity:1!important;transform:none!important;transition:none!important}
          .riq-lift:hover{transform:none!important}
        }
        @media(max-width:400px){
          .riq-g3{grid-template-columns:1fr!important}
          .riq-metrics{grid-template-columns:1fr!important}
          .riq-hero-h1{font-size:28px!important}
        }
        /* Chat panel: full-screen on mobile so it's actually usable */
        @media(max-width:480px){
          .riq-chat-panel{position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;border-radius:0!important;}
        }
      `}</style>

      <div style={{background:C.bg,minHeight:'100vh',fontFamily:"'DM Sans',system-ui,sans-serif"}}>

        {/* -- NAV BAR ------------------------------------------------------- */}
        <nav className="riq-nav" style={{position:'sticky',top:0,zIndex:100,
          background:'rgba(245,245,248,0.88)',
          backdropFilter:'blur(12px)',WebkitBackdropFilter:'blur(12px)',
          borderBottom:`1px solid ${C.border}`,
          padding:'0 32px'}}>
          <div style={{maxWidth:1080,margin:'0 auto',display:'flex',alignItems:'center',justifyContent:'space-between',height:52}}>
            <Link href="/" style={{display:'flex',alignItems:'center',gap:8,textDecoration:'none'}}>
              <div style={{width:8,height:8,background:C.green,borderRadius:'50%'}}/>
              <span style={{fontSize:13,fontWeight:700,letterSpacing:'-0.01em',color:C.text}}>RentalIQ</span>
            </Link>
            <div className="riq-nav-links" style={{display:'flex',alignItems:'center',gap:16}}>
              <div style={{display:'inline-flex',background:C.soft,borderRadius:10,padding:3,gap:3}}>
                <Link href="/analyze" style={{display:'block',padding:'5px 14px',borderRadius:8,background:C.white,fontSize:12.5,fontWeight:700,color:C.text,boxShadow:C.shadowSm,textDecoration:'none',whiteSpace:'nowrap'}}>
                  Analyze a Listing
                </Link>
                <Link href="/scout" style={{display:'block',padding:'5px 14px',borderRadius:8,fontSize:12.5,fontWeight:700,color:C.muted,textDecoration:'none',whiteSpace:'nowrap'}}>
                  Market Search
                </Link>
              </div>
              {isAuthed ? (
                <div style={{display:'flex',alignItems:'center',gap:6,marginLeft:4}}>
                  {/* Token counter */}
                  <button onClick={()=>setShowTokenModal(true)}
                    style={{display:'flex',alignItems:'center',gap:5,background:C.white,border:`1px solid ${C.border}`,borderRadius:8,padding:'5px 11px',cursor:'pointer',fontFamily:'inherit',fontSize:12,transition:'border-color 0.15s'}}
                    onMouseEnter={e=>e.currentTarget.style.borderColor=C.text}
                    onMouseLeave={e=>e.currentTarget.style.borderColor=C.border}>
                    <span style={{width:7,height:7,borderRadius:'50%',background:tokens===0?C.red:tokens<=2?C.amber:C.green,display:'inline-block',flexShrink:0}}/>
                    <span style={{fontWeight:700,color:tokens===0?C.red:tokens<=2?C.amber:C.green}}>{tokens??'...'}</span>
                    <span style={{color:C.muted}}>token{tokens!==1?'s':''}</span>
                  </button>
                  <Link href="/dashboard" style={{padding:'5px 12px',borderRadius:8,fontSize:12,fontWeight:500,color:C.muted,textDecoration:'none',border:`1px solid ${C.border}`,transition:'border-color 0.15s'}}
                    onMouseEnter={e=>e.currentTarget.style.borderColor=C.text}
                    onMouseLeave={e=>e.currentTarget.style.borderColor=C.border}>
                    My Deals
                  </Link>
                </div>
              ) : (
                <button onClick={()=>router.push('/auth')} style={{padding:'5px 14px',borderRadius:8,fontSize:12.5,fontWeight:600,color:'#fff',background:C.green,border:'none',cursor:'pointer',fontFamily:'inherit',marginLeft:4}}>
                  Sign In
                </button>
              )}
            </div>

            {/* Hamburger - mobile only (nav-links are hidden at ≤600px) */}
            {(()=>{return(<button className="riq-hamburger"
              onClick={()=>setShowMobileNav(v=>!v)}
              aria-label="Menu"
              style={{display:'none',background:'none',border:`1px solid ${C.border}`,borderRadius:8,
                padding:'6px 10px',cursor:'pointer',flexDirection:'column',gap:4,alignItems:'center',justifyContent:'center'}}>
              <span style={{display:'block',width:16,height:1.5,background:C.text,borderRadius:2}}/>
              <span style={{display:'block',width:16,height:1.5,background:C.text,borderRadius:2}}/>
              <span style={{display:'block',width:16,height:1.5,background:C.text,borderRadius:2}}/>
            </button>);})()}

          </div>
        </nav>

        {/* -- Mobile nav drawer --------------------------------------------- */}
        {showMobileNav && (
          <>
            <div onClick={()=>setShowMobileNav(false)}
              style={{position:'fixed',inset:0,zIndex:150,background:'rgba(0,0,0,0.3)',backdropFilter:'blur(2px)'}}/>
            <div style={{position:'fixed',bottom:0,left:0,right:0,zIndex:160,
              background:C.white,borderTop:`1px solid ${C.border}`,borderRadius:'18px 18px 0 0',
              padding:'20px 20px 40px',animation:'riq-slideup 0.22s ease both'}}>
              <div style={{width:36,height:4,background:C.soft,borderRadius:2,margin:'0 auto 20px'}}/>
              <div style={{display:'flex',flexDirection:'column',gap:6}}>
                <Link href="/analyze" onClick={()=>{setShowMobileNav(false);window.scrollTo({top:0,behavior:'smooth'});}}
                  style={{padding:'12px 16px',borderRadius:10,fontSize:14,fontWeight:600,color:C.text,background:C.soft,textDecoration:'none',display:'block'}}>
                  Analyze a Listing
                </Link>
                <Link href="/scout" onClick={()=>setShowMobileNav(false)}
                  style={{padding:'12px 16px',borderRadius:10,fontSize:14,fontWeight:500,color:C.text,textDecoration:'none',border:`1px solid ${C.border}`,display:'block'}}>
                  Market Search
                </Link>
                {isAuthed && <>
                  <Link href="/dashboard" onClick={()=>setShowMobileNav(false)}
                    style={{padding:'12px 16px',borderRadius:10,fontSize:14,fontWeight:500,color:C.text,textDecoration:'none',border:`1px solid ${C.border}`,display:'block'}}>
                    My Deals
                  </Link>
                  <button onClick={()=>{setShowMobileNav(false);setShowTokenModal(true);}}
                    style={{padding:'12px 16px',borderRadius:10,fontSize:14,fontWeight:600,
                      color:tokens===0?C.red:tokens<=2?C.amber:C.green,
                      background:tokens===0?C.redBg:tokens<=2?C.amberBg:C.greenBg,
                      border:`1px solid ${tokens===0?C.redBorder:tokens<=2?C.amberBorder:C.greenBorder}`,
                      cursor:'pointer',fontFamily:'inherit',textAlign:'left',display:'flex',alignItems:'center',gap:8}}>
                    <span style={{width:8,height:8,borderRadius:'50%',flexShrink:0,background:tokens===0?C.red:tokens<=2?C.amber:C.green}}/>
                    {tokens??'...'} token{tokens!==1?'s':''} remaining
                  </button>
                  <button onClick={()=>{setShowMobileNav(false);signOut();}}
                    style={{padding:'12px 16px',borderRadius:10,fontSize:13.5,color:C.muted,background:'none',border:`1px solid ${C.border}`,cursor:'pointer',fontFamily:'inherit',textAlign:'left'}}>
                    Sign out
                  </button>
                </>}
                {!isAuthed && (
                  <button onClick={()=>{setShowMobileNav(false);router.push('/auth');}}
                    style={{padding:'12px 16px',borderRadius:10,fontSize:14,fontWeight:700,color:'#fff',background:C.green,border:'none',cursor:'pointer',fontFamily:'inherit'}}>
                    Sign In →
                  </button>
                )}
              </div>
            </div>
          </>
        )}

        {/* -- HERO ---------------------------------------------------------- */}
        {stage!=='results' && !isAuthed && stage === 'input' ? (
          /* ══ LIGHT HERO - matches scout.js theme ══════════════════════════ */
          <header style={{
            textAlign:'center',
            padding:'64px 24px 52px',
            background:`radial-gradient(ellipse 900px 500px at 50% 0%, rgba(22,102,56,0.07) 0%, transparent 70%), ${C.bg}`,
            borderBottom:`1px solid ${C.border}`,
            marginBottom:40,
          }}>
          <div style={{maxWidth:680,margin:'0 auto'}}>
            <div style={{display:'inline-flex',alignItems:'center',gap:8,marginBottom:20,padding:'5px 14px',background:C.white,border:`1px solid ${C.border}`,borderRadius:100,boxShadow:C.shadowSm,animation:'riq-fadeup 0.5s ease both'}}>
              <div style={{width:6,height:6,background:C.green,borderRadius:'50%'}}/>
              <span style={{fontSize:11,fontWeight:600,letterSpacing:'0.10em',color:C.muted,textTransform:'uppercase'}}>Free Analysis · No Sign-up Required</span>
            </div>
            <h1 className="riq-hero-h1" style={{fontFamily:"'Libre Baskerville',Georgia,serif",fontSize:'clamp(40px,5.5vw,68px)',fontWeight:700,letterSpacing:'-0.03em',lineHeight:1.05,color:C.text,marginBottom:20,animation:'riq-fadeup 0.6s ease 0.05s both'}}>
              Does the deal{' '}
              <em style={{fontStyle:'italic',color:C.green,fontWeight:400}}>cash flow?</em>
            </h1>
            <p className="riq-hero-sub" style={{fontSize:17,color:C.muted,lineHeight:1.65,maxWidth:460,margin:'0 auto 36px',fontWeight:400,animation:'riq-fadeup 0.6s ease 0.1s both'}}>
              Paste any listing URL. Get cap rate, cash flow, wealth projection, and a buy/pass verdict in seconds.
            </p>
            <div className="riq-hero-bar" style={{maxWidth:640,margin:'0 auto',background:C.white,border:`1.5px solid ${fetchStatus==='loading'?C.blue:fetchStatus==='done'?C.green:fetchStatus==='partial'?C.amber:fetchStatus==='error'?C.red:C.border}`,borderRadius:18,boxShadow:fetchStatus==='loading'?`0 0 0 4px rgba(22,73,160,0.10), ${C.shadowLg}`:fetchStatus==='done'?`0 0 0 4px rgba(22,102,56,0.12), ${C.shadowLg}`:fetchStatus==='partial'?`0 0 0 4px rgba(138,88,0,0.10), ${C.shadowLg}`:C.shadowLg,padding:'8px 8px 8px 22px',display:'flex',gap:12,alignItems:'center',transition:'border-color 0.3s, box-shadow 0.3s',animation:'riq-fadeup 0.6s ease 0.15s both'}}>
              <div style={{flexShrink:0,width:18,height:18,display:'flex',alignItems:'center',justifyContent:'center'}}>
                {fetchStatus==='loading'&&<div style={{width:14,height:14,border:`2px solid ${C.blue}`,borderTopColor:'transparent',borderRadius:'50%',animation:'riq-spin 0.75s linear infinite'}}/>}
                {fetchStatus==='done'&&<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 8l3.5 3.5L13 5" stroke={C.green} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                {fetchStatus==='partial'&&<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 5v4M8 11v.5" stroke={C.amber} strokeWidth="1.8" strokeLinecap="round"/><circle cx="8" cy="8" r="6.5" stroke={C.amber} strokeWidth="1.4"/></svg>}
                {fetchStatus==='error'&&<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 5v4M8 11v.5" stroke={C.red} strokeWidth="1.8" strokeLinecap="round"/><circle cx="8" cy="8" r="6.5" stroke={C.red} strokeWidth="1.4"/></svg>}
                {!fetchStatus&&<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="7" cy="7" r="4.5" stroke={C.muted} strokeWidth="1.5"/><path d="M10.5 10.5L13 13" stroke={C.muted} strokeWidth="1.5" strokeLinecap="round"/></svg>}
              </div>
              <input type="url" value={fields.url} onChange={e=>setField('url')(e.target.value)} placeholder="Paste a Zillow, Redfin, or Realtor.com link to auto-fill..." style={{flex:1,border:'none',outline:'none',fontSize:16,padding:'15px 0',background:'transparent',color:C.text,fontFamily:"'DM Sans',system-ui,sans-serif",minWidth:0}}/>
              {(fetchStatus==='done'||fetchStatus==='partial')&&allRequiredFilled&&<button className="riq-hero-bar-cta" onClick={handleSubmit} disabled={stage==='loading'} style={{background:fetchStatus==='done'?C.green:C.amber,color:'#fff',border:'none',borderRadius:11,padding:'12px 22px',fontSize:13.5,fontWeight:700,cursor:stage==='loading'?'not-allowed':'pointer',fontFamily:"'DM Sans',system-ui,sans-serif",letterSpacing:'-0.01em',whiteSpace:'nowrap',transition:'opacity 0.15s',animation:'riq-fadeup 0.3s ease',display:'flex',alignItems:'center',gap:6,opacity:stage==='loading'?0.7:1}}>{stage==='loading'?<><div style={{width:12,height:12,border:'2px solid rgba(255,255,255,0.4)',borderTopColor:'#fff',borderRadius:'50%',animation:'riq-spin 0.7s linear infinite'}}/>Analyzing...</>:'Analyze →'}</button>}              {(fetchStatus==='done'||fetchStatus==='partial')&&!allRequiredFilled&&<div style={{background:C.soft,borderRadius:11,padding:'12px 20px',fontSize:13,color:C.muted,whiteSpace:'nowrap',flexShrink:0,fontFamily:"'DM Sans',system-ui,sans-serif"}}>fill remaining fields ↓</div>}
              {fetchStatus!=='done'&&fetchStatus!=='partial'&&<div style={{background:C.soft,borderRadius:11,padding:'12px 20px',fontSize:13,color:C.muted,whiteSpace:'nowrap',flexShrink:0,fontFamily:"'DM Sans',system-ui,sans-serif"}}>{fields.price?'fill remaining fields ↓':'or enter manually ↓'}</div>}
            </div>
            {fetchMsg&&<div style={{marginTop:12,fontSize:12.5,textAlign:'center',color:fetchStatus==='error'?C.red:fetchStatus==='partial'?C.amber:fetchStatus==='done'?C.green:C.blue,fontWeight:600,animation:'riq-fadeup 0.2s ease'}}>{fetchMsg}</div>}
            {(!fields.url||fetchStatus==='error')&&(fetchStatus===null||fetchStatus==='error')&&(
              <div style={{marginTop:16,textAlign:'center',animation:'riq-fadeup 0.6s ease 0.3s both'}}>
                <span style={{fontSize:12.5,color:C.muted}}>No listing URL? </span>
                <button onClick={loadSampleDeal} style={{fontSize:12.5,color:C.green,background:'none',border:'none',cursor:'pointer',fontFamily:'inherit',fontWeight:600,textDecoration:'underline',padding:0}}>Try a sample deal →</button>
              </div>
            )}
            {fetchStatus==='error'&&(
              <div style={{marginTop:10,textAlign:'center'}}>
                <button onClick={loadSampleDeal} style={{fontSize:12,color:C.green,background:'none',border:'none',cursor:'pointer',fontFamily:'inherit',fontWeight:600,textDecoration:'underline',padding:0}}>or try a sample deal instead →</button>
              </div>
            )}
            <div style={{marginTop:24,display:'flex',alignItems:'center',justifyContent:'center',gap:16,flexWrap:'wrap',animation:'riq-fadeup 0.6s ease 0.35s both'}}>
              {[
                {label:'Cap Rate'},
                {label:'Cash Flow'},
                {label:'Wealth Projection'},
                {label:'AI Verdict'},
              ].map(f=>(
                <div key={f.label} style={{display:'flex',alignItems:'center',gap:5,fontSize:12,color:C.muted}}>
                  <div style={{width:5,height:5,borderRadius:'50%',background:C.green,flexShrink:0}}/>
                  <span>{f.label}</span>
                </div>
              ))}
            </div>
          </div>
          </header>
        ) : stage!=='results' && !isAuthed ? (
          /* ══ LIGHT MINIMAL WRAPPER - unauthed during loading/error ═ */
          <div style={{background:C.bg,minHeight:'40vh'}}/>
        ) : stage!=='results' && (
          /* ══ STANDARD HERO - shown to logged-in users ══════════════════════ */
          <header className="riq-hero-header" style={{
            padding:'88px 24px 72px',
            textAlign:'center',
            background:`radial-gradient(ellipse 900px 500px at 50% 0%, rgba(22,102,56,0.07) 0%, transparent 70%), ${C.bg}`,
            borderBottom:`1px solid ${C.border}`,
            marginBottom:40,
          }}>
          <div style={{maxWidth:680,margin:'0 auto'}}>
            <div style={{display:'inline-flex',alignItems:'center',gap:7,marginBottom:24,padding:'5px 14px',background:C.white,border:`1px solid ${C.border}`,borderRadius:100,boxShadow:C.shadowSm}}>
              <div style={{width:6,height:6,background:C.green,borderRadius:'50%'}}/>
              <span style={{fontSize:11,fontWeight:600,letterSpacing:'0.10em',color:C.muted,textTransform:'uppercase'}}>Rental Underwriting Engine</span>
            </div>
            <h1 className="riq-hero-h1" style={{fontFamily:"'Libre Baskerville',Georgia,serif",fontSize:'clamp(36px,5vw,58px)',fontWeight:700,letterSpacing:'-0.025em',lineHeight:1.05,color:C.text,marginBottom:20}}>
              Does it <em style={{fontStyle:'italic',color:C.green,fontWeight:400}}>cash flow?</em><br/>Find out instantly.
            </h1>
            <p className="riq-hero-sub" style={{fontSize:17,color:C.muted,lineHeight:1.6,maxWidth:420,margin:'0 auto 36px',fontWeight:400}}>Real underwriting. Your financing. Your capital at stake.</p>
            <div className="riq-hero-bar" style={{maxWidth:600,margin:'0 auto',background:C.white,border:`1.5px solid ${fetchStatus==='loading'?C.blue:fetchStatus==='done'?C.green:fetchStatus==='partial'?C.amber:fetchStatus==='error'?C.red:C.border}`,borderRadius:16,boxShadow:fetchStatus==='loading'?`0 0 0 4px rgba(22,73,160,0.10), ${C.shadowLg}`:fetchStatus==='done'?`0 0 0 4px rgba(22,102,56,0.12), ${C.shadowLg}`:fetchStatus==='partial'?`0 0 0 4px rgba(138,88,0,0.10), ${C.shadowLg}`:C.shadowLg,padding:'6px 6px 6px 18px',display:'flex',gap:10,alignItems:'center',transition:'border-color 0.3s, box-shadow 0.3s'}}>
              <div style={{flexShrink:0,width:18,height:18,display:'flex',alignItems:'center',justifyContent:'center'}}>
                {fetchStatus==='loading'&&<div style={{width:14,height:14,border:`2px solid ${C.blue}`,borderTopColor:'transparent',borderRadius:'50%',animation:'riq-spin 0.75s linear infinite'}}/>}
                {fetchStatus==='done'&&<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 8l3.5 3.5L13 5" stroke={C.green} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                {fetchStatus==='partial'&&<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 5v4M8 11v.5" stroke={C.amber} strokeWidth="1.8" strokeLinecap="round"/><circle cx="8" cy="8" r="6.5" stroke={C.amber} strokeWidth="1.4"/></svg>}
                {fetchStatus==='error'&&<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 5v4M8 11v.5" stroke={C.red} strokeWidth="1.8" strokeLinecap="round"/><circle cx="8" cy="8" r="6.5" stroke={C.red} strokeWidth="1.4"/></svg>}
                {!fetchStatus&&<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="7" cy="7" r="4.5" stroke={C.muted} strokeWidth="1.5"/><path d="M10.5 10.5L13 13" stroke={C.muted} strokeWidth="1.5" strokeLinecap="round"/></svg>}
              </div>
              <input type="url" value={fields.url} onChange={e=>setField('url')(e.target.value)} placeholder="Paste a Zillow, Redfin, or Realtor link to auto-fill..." style={{flex:1,border:'none',outline:'none',fontSize:16,padding:'14px 0',background:'transparent',color:C.text,fontFamily:"'DM Sans',system-ui,sans-serif",minWidth:0}}/>
              {(fetchStatus==='done'||fetchStatus==='partial')&&allRequiredFilled&&<button className="riq-hero-bar-cta" onClick={handleSubmit} disabled={stage==='loading'} style={{background:fetchStatus==='done'?C.green:C.amber,color:'#fff',border:'none',borderRadius:11,padding:'11px 20px',fontSize:13.5,fontWeight:700,cursor:stage==='loading'?'not-allowed':'pointer',fontFamily:"'DM Sans',system-ui,sans-serif",letterSpacing:'-0.01em',whiteSpace:'nowrap',transition:'opacity 0.15s',animation:'riq-fadeup 0.3s ease',display:'flex',alignItems:'center',gap:6,opacity:stage==='loading'?0.7:1}}>{stage==='loading'?<><div style={{width:12,height:12,border:'2px solid rgba(255,255,255,0.4)',borderTopColor:'#fff',borderRadius:'50%',animation:'riq-spin 0.7s linear infinite'}}/>Analyzing...</>:'Analyze →'}</button>}
              {(fetchStatus==='done'||fetchStatus==='partial')&&!allRequiredFilled&&<div style={{background:C.soft,borderRadius:11,padding:'11px 20px',fontSize:13,color:C.muted,whiteSpace:'nowrap',flexShrink:0,fontFamily:"'DM Sans',system-ui,sans-serif"}}>fill remaining fields ↓</div>}
              {fetchStatus!=='done'&&fetchStatus!=='partial'&&<div style={{background:C.soft,borderRadius:11,padding:'11px 20px',fontSize:13,color:C.muted,whiteSpace:'nowrap',flexShrink:0,fontFamily:"'DM Sans',system-ui,sans-serif"}}>{fields.price?'fill remaining fields ↓':'or fill manually below ↓'}</div>}
            </div>
            {fetchMsg&&<div style={{marginTop:12,fontSize:12.5,textAlign:'center',color:fetchStatus==='error'?C.red:fetchStatus==='partial'?C.amber:fetchStatus==='done'?C.green:C.blue,fontWeight:600,animation:'riq-fadeup 0.2s ease'}}>{fetchMsg}</div>}
            {(!fields.url||fetchStatus==='error')&&(fetchStatus===null||fetchStatus==='error')&&stage==='input'&&(<div style={{marginTop:14,textAlign:'center',animation:'riq-fadeup 0.3s ease 0.2s both'}}><span style={{fontSize:12.5,color:C.muted}}>No listing URL? </span><button onClick={loadSampleDeal} style={{fontSize:12.5,color:C.green,background:'none',border:'none',cursor:'pointer',fontFamily:'inherit',fontWeight:600,textDecoration:'underline',padding:0}}>Try a sample deal →</button></div>)}
          </div>
          </header>
        )}

        <div ref={formRef} className="riq-page" style={{maxWidth:720,margin:'0 auto',padding:'0 20px 80px',animation:'riq-fadeup 0.5s ease both'}}>

          {/* -- Welcome banner (first-time signed-in users) ------------- */}
          {showWelcome && stage==='input' && isAuthed && (
            <div style={{background:C.white,border:`1.5px solid ${C.greenBorder}`,borderRadius:14,
              padding:'20px 22px',marginBottom:16,animation:'riq-fadeup 0.3s ease both',
              display:'flex',alignItems:'flex-start',gap:14}}>
              <div style={{width:36,height:36,borderRadius:10,background:C.greenBg,border:`1px solid ${C.greenBorder}`,
                flexShrink:0,display:'flex',alignItems:'center',justifyContent:'center'}}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 2a6 6 0 100 12A6 6 0 008 2z" stroke={C.green} strokeWidth="1.5"/><path d="M8 5.5v3.5M8 10.5v.5" stroke={C.green} strokeWidth="1.4" strokeLinecap="round"/></svg>
              </div>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:14,fontWeight:700,color:C.text,marginBottom:4}}>
                  Welcome to RentalIQ - you have 1 free analysis token
                </div>
                <div style={{fontSize:13,color:C.muted,lineHeight:1.6,marginBottom:12}}>
                  Paste a Zillow, Redfin, or Realtor.com URL above to get cap rate, cash flow, a wealth projection,
                  and an AI buy/pass verdict. Or try a sample deal to see what you get.
                </div>
                <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                  <button onClick={loadSampleDeal}
                    style={{fontSize:12.5,fontWeight:600,color:C.green,background:C.greenBg,
                      border:`1px solid ${C.greenBorder}`,borderRadius:8,padding:'6px 14px',
                      cursor:'pointer',fontFamily:'inherit'}}>
                    Try a sample deal →
                  </button>
                  <button onClick={()=>{
                    try { localStorage.setItem('riq-welcome-seen','1'); } catch(_){}
                    setShowWelcome(false);
                  }} style={{fontSize:12.5,color:C.muted,background:'none',border:'none',
                    cursor:'pointer',fontFamily:'inherit',padding:'6px 8px'}}>
                    Dismiss
                  </button>
                </div>
              </div>
            </div>
          )}

          {(stage==='input'||stage==='confirm')&&isAuthed&&(
            stage==='confirm'
              ? null  /* InputForm hidden during confirm - only ConfirmCard shows */
              : <InputForm fields={fields} setField={setField} errors={errors}
                  adv={adv} setAdv={setAdv} mode={mode} setMode={setMode}
                  profile={profile} setProfile={setProfile} onSubmit={handleSubmit}
                  fetchStatus={fetchStatus} fetchMsg={fetchMsg} fieldStatus={fieldStatus}
                  stage={stage}/>
          )}

          {/* Unauthed manual entry form - shown below hero for users without a listing URL */}
          {stage==='input' && !isAuthed && fetchStatus!=='done' && (
            <div style={{marginTop:8,marginBottom:24,animation:'riq-fadeup 0.4s ease 0.2s both'}}>
              <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:16}}>
                <div style={{flex:1,height:1,background:C.border}}/>
                <span style={{fontSize:11.5,color:C.muted,fontWeight:600,letterSpacing:'0.08em',textTransform:'uppercase',flexShrink:0}}>or enter manually</span>
                <div style={{flex:1,height:1,background:C.border}}/>
              </div>
              <div style={{background:C.white,border:`1px solid ${C.border}`,borderRadius:14,boxShadow:C.shadow,padding:'20px 24px'}}>
                {(()=>{
                  const unauthAllFilled = fields.price.trim()&&fields.city.trim()&&
                    fields.beds.toString().trim()&&fields.baths.toString().trim()&&
                    fields.sqft.toString().trim()&&fields.year.toString().trim()&&
                    fields.taxAnnual.toString().trim()&&fields.hoaMonthly.toString().trim()!=='';
                  return (<>
                    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(140px,1fr))',gap:12,marginBottom:12}}>
                      {[
                        {key:'price',     label:'List Price *',       placeholder:'$350,000'},
                        {key:'city',      label:'City, State *',      placeholder:'Cleveland, OH'},
                        {key:'beds',      label:'Bedrooms *',         placeholder:'3'},
                        {key:'baths',     label:'Bathrooms *',        placeholder:'2'},
                        {key:'sqft',      label:'Sq Footage *',       placeholder:'1,200'},
                        {key:'year',      label:'Year Built *',       placeholder:'1987'},
                        {key:'taxAnnual', label:'Annual Tax * ($)',   placeholder:'3,200'},
                        {key:'hoaMonthly',label:'HOA/mo * (0=none)', placeholder:'0'},
                        {key:'rent',      label:'Monthly Rent',       placeholder:'$1,800 (optional)'},
                      ].map(f=>(
                        <div key={f.key}>
                          <div style={{fontSize:10,fontWeight:600,letterSpacing:'0.1em',textTransform:'uppercase',color:C.muted,marginBottom:5}}>{f.label}</div>
                          <input type="text" placeholder={f.placeholder} value={fields[f.key]||''} onChange={e=>setField(f.key)(e.target.value)}
                            style={{width:'100%',background:C.bg,border:`1.5px solid ${C.border}`,borderRadius:9,padding:'10px 12px',fontSize:14,fontFamily:"'DM Sans',system-ui,sans-serif",color:C.text,outline:'none',boxSizing:'border-box'}}
                            onFocus={e=>e.target.style.borderColor=C.green} onBlur={e=>e.target.style.borderColor=C.border}/>
                        </div>
                      ))}
                    </div>
                    {!unauthAllFilled&&<p style={{fontSize:11.5,color:C.muted,marginBottom:10,textAlign:'center'}}>Fill in all * fields to unlock analysis</p>}
                    <button onClick={handleSubmit} disabled={!unauthAllFilled||stage==='loading'}
                      style={{width:'100%',background:unauthAllFilled&&stage!=='loading'?C.green:'#ccc',color:'#fff',border:'none',borderRadius:10,padding:'12px',fontSize:14,fontWeight:700,cursor:unauthAllFilled&&stage!=='loading'?'pointer':'not-allowed',fontFamily:'inherit',letterSpacing:'-0.01em',transition:'background 0.2s',display:'flex',alignItems:'center',justifyContent:'center',gap:8}}>
                      {stage==='loading'
                        ? <><div style={{width:14,height:14,border:'2px solid rgba(255,255,255,0.4)',borderTopColor:'#fff',borderRadius:'50%',animation:'riq-spin 0.7s linear infinite'}}/>Analyzing...</>
                        : 'Analyze →'}
                    </button>
                    <div style={{marginTop:10,textAlign:'center'}}>
                      <span style={{fontSize:12,color:C.muted}}>* required · </span>
                      <button onClick={loadSampleDeal} style={{fontSize:12,color:C.green,background:'none',border:'none',cursor:'pointer',fontFamily:'inherit',fontWeight:600,textDecoration:'underline',padding:0}}>try a sample deal instead →</button>
                    </div>
                  </>);
                })()}
              </div>
            </div>
          )}

          {stage==='confirm'&&(
            <div ref={confirmRef}>
              <ConfirmCard fields={fields} adv={adv} mode={mode} profile={profile} onConfirm={runAnalysis} onBack={()=>setStage('input')}/>
            </div>
          )}

          {stage==='loading'&&<div ref={loadingRef} style={{minHeight:'80vh'}}><LoadingSpinner step={step}/></div>}

          {stage==='error'&&(
            <div style={{background:C.redBg,border:`1px solid ${C.redBorder}`,borderRadius:18,padding:20,fontSize:14,color:C.red,lineHeight:1.6}}>
              <strong>Something went wrong. </strong>{errMsg}
              {(errMsg?.includes('GEMINI_API_KEY') || errMsg?.includes('API key') || errMsg?.includes('AI error') || errMsg?.includes('quota') || errMsg?.includes('not configured')) && (
                <div style={{marginTop:8,fontSize:12.5,color:'#7a3030',lineHeight:1.7}}>
                  <strong>Fix:</strong> Add <code>GEMINI_API_KEY</code> to your Vercel project environment variables.<br/>
                  1. Get a free key at <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer" style={{color:'inherit',fontWeight:600}}>aistudio.google.com</a><br/>
                  2. In Vercel → your project → Settings → Environment Variables → add <code>GEMINI_API_KEY</code><br/>
                  3. Redeploy (Vercel → Deployments → Redeploy latest)
                </div>
              )}
              <div style={{marginTop:12,display:'flex',gap:8}}>
                <button onClick={()=>isAuthed ? setStage('confirm') : runAnalysis()} style={{fontSize:13,color:C.red,background:'none',border:`1px solid ${C.redBorder}`,borderRadius:8,padding:'6px 14px',cursor:'pointer',fontFamily:'inherit'}}>Try again</button>
                <button onClick={reset} style={{fontSize:13,color:C.muted,background:'none',border:`1px solid ${C.border}`,borderRadius:8,padding:'6px 14px',cursor:'pointer',fontFamily:'inherit'}}>Start over</button>
              </div>
            </div>
          )}

          {stage==='results'&&results&&(
            <Results data={results} originalData={origResults} scenarioLabel={scenario}
              neighborhood={neighborhood} neighborhoodLoading={neighborhoodLoading}
              floodData={floodData} floodLoading={floodLoading} schoolData={schoolData}
              liveBenchmarks={liveBenchmarks}
              climateData={climateData} climateLoading={climateLoading}
              strData={strData} strLoading={strLoading}
              safmrData={safmrData}
              onReset={reset} onRecalc={handleRecalc} onRerunAI={handleRerunAI}
              investorProfile={investorProfile} onUpdateAnalysis={handleChatUpdate}
              savedDealId={savedDealId} isEdited={isEdited}
              isAuthed={isAuthed} demoUsed={demoUsed}
              onDemoGate={()=>{setAuthPrompt(true);setShowDemoGate(true);}}
              onOpenChat={()=>{ if(chatOpenRef.current) chatOpenRef.current(); }}/>
          )}

        </div>
        <footer style={{textAlign:'center',padding:'20px 0 36px',fontSize:11.5,color:C.muted,borderTop:`1px solid ${C.border}`,letterSpacing:'0.02em'}}>
          RentalIQ &nbsp;·&nbsp; Not financial advice &nbsp;·&nbsp; Verify with a licensed professional before investing
          &nbsp;·&nbsp; <Link href="/privacy" style={{color:C.muted,textDecoration:'none',borderBottom:`1px solid ${C.border}`}}>Privacy</Link>
          &nbsp;·&nbsp; <Link href="/terms" style={{color:C.muted,textDecoration:'none',borderBottom:`1px solid ${C.border}`}}>Terms</Link>
        </footer>
      </div>

      {stage==='results'&&results&&isAuthed&&(
        <FloatingChat data={results} investorProfile={investorProfile} onUpdateAnalysis={handleChatUpdate} openRef={chatOpenRef}/>
      )}

      {/* -- Premium auth/demo gate modal ---------------------------------- */}
      {(authPrompt || showDemoGate) && (
        <div style={{position:'fixed',inset:0,zIndex:200,display:'flex',alignItems:'center',justifyContent:'center',padding:24,background:'rgba(0,0,0,0.7)',backdropFilter:'blur(16px)'}}
          onClick={()=>{setAuthPrompt(false);setShowDemoGate(false);}}>
          <div onClick={e=>e.stopPropagation()}
            style={{position:'relative',background:'#0d1512',border:'1px solid rgba(22,102,56,0.4)',borderRadius:24,boxShadow:'0 40px 100px rgba(0,0,0,0.8), 0 0 0 1px rgba(255,255,255,0.04)',padding:'44px 40px',maxWidth:420,width:'100%',animation:'riq-fadeup 0.3s cubic-bezier(0.34,1.56,0.64,1) both',textAlign:'center',overflow:'hidden'}}>
            <div style={{position:'absolute',top:-60,left:'50%',transform:'translateX(-50%)',width:300,height:300,background:'radial-gradient(ellipse,rgba(22,102,56,0.25) 0%,transparent 70%)',pointerEvents:'none'}}/>
            <div style={{position:'relative',zIndex:1}}>
              <div style={{width:60,height:60,borderRadius:18,background:'linear-gradient(135deg,rgba(22,102,56,0.3) 0%,rgba(22,102,56,0.1) 100%)',border:'1px solid rgba(22,102,56,0.5)',display:'flex',alignItems:'center',justifyContent:'center',margin:'0 auto 24px',boxShadow:'0 8px 24px rgba(22,102,56,0.2)'}}>
                <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
                  <path d="M14 3L25 9V19L14 25L3 19V9L14 3Z" stroke="#4ade80" strokeWidth="1.5" strokeLinejoin="round"/>
                  <circle cx="14" cy="14" r="4" fill="#4ade80" fillOpacity="0.3" stroke="#4ade80" strokeWidth="1.5"/>
                </svg>
              </div>
              <h2 style={{fontFamily:"'Libre Baskerville',Georgia,serif",fontSize:24,fontWeight:700,color:'#fff',marginBottom:10,letterSpacing:'-0.03em',lineHeight:1.2}}>
                {showDemoGate ? 'Save this analysis' : 'Your first token is free'}
              </h2>
              <p style={{fontSize:14,color:'rgba(255,255,255,0.45)',lineHeight:1.65,marginBottom:28}}>
                {showDemoGate
                  ? 'Create a free account to save deals, export PDFs, run the AI chat, and share with partners.'
                  : "You've seen what RentalIQ can do. Sign up and your first full analysis is on us."}
              </p>
              <div style={{display:'flex',flexDirection:'column',gap:8,marginBottom:28,textAlign:'left'}}>
                {[
                  {icon:'🔐', text:'Deal history - every analysis auto-saved'},
                  {icon:'📄', text:'PDF export - professional investor memo'},
                  {text:'AI chat — ask anything about the deal'},
                  {text:'Share links — send deals to partners'},
                ].map((p,i)=>(
                  <div key={i} style={{display:'flex',alignItems:'center',gap:10,padding:'8px 12px',background:'rgba(255,255,255,0.03)',border:'1px solid rgba(255,255,255,0.06)',borderRadius:10}}>
                    <span style={{fontSize:15,flexShrink:0}}>{p.icon}</span>
                    <span style={{fontSize:13,color:'rgba(255,255,255,0.6)'}}>{p.text}</span>
                  </div>
                ))}
              </div>
              <button onClick={()=>router.push('/auth')}
                style={{width:'100%',background:'linear-gradient(135deg,#1a7a40 0%,#166638 100%)',color:'#fff',border:'none',borderRadius:14,padding:'15px',fontSize:15,fontWeight:700,cursor:'pointer',fontFamily:'inherit',letterSpacing:'-0.01em',marginBottom:12,boxShadow:'0 8px 28px rgba(22,102,56,0.5)',transition:'transform 0.15s,box-shadow 0.15s'}}
                onMouseEnter={e=>{e.currentTarget.style.transform='translateY(-1px)';e.currentTarget.style.boxShadow='0 12px 36px rgba(22,102,56,0.6)';}}
                onMouseLeave={e=>{e.currentTarget.style.transform='';e.currentTarget.style.boxShadow='0 8px 28px rgba(22,102,56,0.5)';}}>
                Create Free Account →
              </button>
              <button onClick={()=>{setAuthPrompt(false);setShowDemoGate(false);}}
                style={{fontSize:13,color:'rgba(255,255,255,0.3)',background:'none',border:'none',cursor:'pointer',fontFamily:'inherit',transition:'color 0.15s'}}
                onMouseEnter={e=>e.currentTarget.style.color='rgba(255,255,255,0.6)'}
                onMouseLeave={e=>e.currentTarget.style.color='rgba(255,255,255,0.3)'}>
                {showDemoGate ? 'Maybe later' : 'Not now'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* -- Token purchase modal -------------------------------------------- */}
      {/* -- Purchase result toast --------------------------------------- */}
      {purchaseToast && (
        <div style={{position:'fixed',bottom:24,left:'50%',transform:'translateX(-50%)',zIndex:300,
          background: purchaseToast==='success' ? C.green : C.amber,
          color:'#fff',borderRadius:12,padding:'13px 22px',fontSize:14,fontWeight:600,
          boxShadow:'0 8px 32px rgba(0,0,0,0.22)',display:'flex',alignItems:'center',gap:10,
          animation:'riq-fadeup 0.3s ease both',whiteSpace:'nowrap'}}>
          {purchaseToast==='success'
            ? <><span>✓</span> Tokens added - ready to analyze!</>
            : <><span>✕</span> Purchase cancelled - tokens unchanged.</>
          }
          <button onClick={()=>setPurchaseToast(null)} style={{background:'rgba(255,255,255,0.2)',border:'none',borderRadius:6,padding:'3px 8px',cursor:'pointer',color:'#fff',fontSize:13,marginLeft:4}}>✕</button>
        </div>
      )}

      {showTokenModal && (
        <div style={{position:'fixed',inset:0,zIndex:200,display:'flex',alignItems:'center',justifyContent:'center',padding:24,background:'rgba(0,0,0,0.45)',backdropFilter:'blur(4px)'}} onClick={()=>setShowTokenModal(false)}>
          <div onClick={e=>e.stopPropagation()} style={{background:C.white,borderRadius:20,boxShadow:C.shadowLg,padding:'36px 32px',maxWidth:440,width:'100%',animation:'riq-fadeup 0.25s ease both'}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:6}}>
              <h2 style={{fontSize:19,fontWeight:700,color:C.text,letterSpacing:'-0.02em'}}>Buy Analysis Tokens</h2>
              <button onClick={()=>setShowTokenModal(false)} style={{background:'none',border:'none',cursor:'pointer',color:C.muted,fontSize:18,padding:4}}>✕</button>
            </div>
            <p style={{fontSize:13,color:C.muted,marginBottom:24}}>Each token runs one full AI analysis. Tokens never expire.</p>
            <div style={{display:'flex',flexDirection:'column',gap:10,marginBottom:16}}>
              {TOKEN_PACKAGES.map(pkg=>(
                <button key={pkg.id}
                  onClick={async(e)=>{
                    const btn=e.currentTarget;btn.disabled=true;btn.style.opacity='0.7';
                    try{const res=await fetch('/api/tokens/purchase',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({packageId:pkg.id,returnPath:'/analyze'})});const data=await res.json();if(data.url)window.location.href=data.url;else{btn.disabled=false;btn.style.opacity='1';}}
                    catch{btn.disabled=false;btn.style.opacity='1';}
                  }}
                  style={{display:'flex',alignItems:'center',justifyContent:'space-between',background:C.white,border:`1.5px solid ${C.border}`,borderRadius:13,padding:'15px 18px',cursor:'pointer',fontFamily:'inherit',transition:'all 0.15s',position:'relative',overflow:'hidden',textAlign:'left'}}
                  onMouseEnter={e=>{if(!e.currentTarget.disabled){e.currentTarget.style.borderColor=C.green;e.currentTarget.style.background=C.greenBg;}}}
                  onMouseLeave={e=>{if(!e.currentTarget.disabled){e.currentTarget.style.borderColor=C.border;e.currentTarget.style.background=C.white;}}}>
                  {pkg.badge&&<span style={{position:'absolute',top:0,right:0,background:C.green,color:'#fff',fontSize:9,fontWeight:700,padding:'3px 10px',borderRadius:'0 13px 0 8px',letterSpacing:'0.06em'}}>{pkg.badge}</span>}
                  <div>
                    <div style={{fontSize:14,fontWeight:700,color:C.text,marginBottom:2}}>{pkg.label}</div>
                    <div style={{fontSize:12,color:C.muted}}>{pkg.sublabel}</div>
                  </div>
                  <span style={{fontSize:16,fontWeight:700,color:C.green,flexShrink:0}}>${pkg.price/100}</span>
                </button>
              ))}
            </div>
            <p style={{fontSize:11.5,color:C.muted,textAlign:'center'}}>Secure checkout via Stripe.</p>
          </div>
        </div>
      )}
    </>
  );
}
