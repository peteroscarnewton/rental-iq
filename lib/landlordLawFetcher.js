/**
 * lib/landlordLawFetcher.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Live landlord law fetcher using the Eviction Lab Policy Search API.
 *
 * Sources (all free, no API key required):
 *
 *   Primary: Eviction Lab Policy Search API (Princeton University)
 *     - URL: https://evictionlab.org/api/v2/policies
 *     - Returns: eviction notice periods, just cause requirements, ERAP status
 *     - Updated: whenever state or local laws change (real-time research team)
 *     - Filter: type=eviction_notice, state=[2-letter code]
 *
 *   Secondary: NCSL (National Conference of State Legislatures)
 *     - URL: https://www.ncsl.org/research/housing/rent-control-overview.aspx
 *     - Structured HTML — parse for rent control preemption status by state
 *
 *   Fallback: Static LANDLORD_LAWS table from landlordLaws.js (never breaks)
 *
 * Cache key: landlord_laws (single JSON object keyed by state code)
 * TTL: 30 days
 *
 * Error philosophy:
 *   Return null on any failure — caller uses static baseline.
 *   Never throws, never crashes the cron.
 *
 * @module landlordLawFetcher
 */

import { LANDLORD_LAWS } from './landlordLaws.js';

// ─── Eviction Lab state → FIPS and slug mapping ──────────────────────────────
// Eviction Lab uses state FIPS codes in their API
const STATE_TO_FIPS = {
  AL:'01',AK:'02',AZ:'04',AR:'05',CA:'06',CO:'08',CT:'09',DE:'10',DC:'11',FL:'12',
  GA:'13',HI:'15',ID:'16',IL:'17',IN:'18',IA:'19',KS:'20',KY:'21',LA:'22',ME:'23',
  MD:'24',MA:'25',MI:'26',MN:'27',MS:'28',MO:'29',MT:'30',NE:'31',NV:'32',NH:'33',
  NJ:'34',NM:'35',NY:'36',NC:'37',ND:'38',OH:'39',OK:'40',OR:'41',PA:'42',RI:'44',
  SC:'45',SD:'46',TN:'47',TX:'48',UT:'49',VT:'50',VA:'51',WA:'53',WV:'54',WI:'55',WY:'56',
};

// NCSL rent control preemption page — maps state name to preemption status
// We parse this page to get the most current preemption status
const NCSL_RENT_CONTROL_URL = 'https://www.ncsl.org/research/housing/rent-control-overview.aspx';

/**
 * Fetch eviction notice period for a single state from Eviction Lab.
 * Returns notice days or null on failure.
 */
async function fetchEvictionNoticeForState(stateCode) {
  try {
    const fips = STATE_TO_FIPS[stateCode];
    if (!fips) return null;

    // Eviction Lab policy search API
    const url = `https://evictionlab.org/api/v2/policies?geo_type=state&geo_id=${fips}&type=eviction_notice`;
    const r = await fetch(url, {
      headers: {
        'User-Agent': 'RentalIQ/1.0 (investment analysis research)',
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return null;

    const data = await r.json();
    // Eviction Lab returns array of policy objects
    const policies = Array.isArray(data) ? data : (data?.policies || data?.results || []);
    if (!policies.length) return null;

    // Find non-payment of rent notice — most relevant for investors
    const nonPayment = policies.find(p =>
      p.type === 'eviction_notice' &&
      (p.subtype === 'non_payment' || p.reason === 'non_payment' || p.category === 'nonpayment')
    ) || policies[0];

    const days = parseInt(nonPayment?.days || nonPayment?.notice_days || nonPayment?.value);
    if (isNaN(days) || days < 1 || days > 90) return null;

    return { days, source: 'Eviction Lab', asOf: nonPayment?.effective_date || new Date().toISOString().slice(0, 10) };
  } catch {
    return null;
  }
}

/**
 * Parse NCSL rent control overview page for preemption status.
 * Returns Map<stateCode, { preempted: boolean, statewide: boolean }>
 */
async function fetchNcslRentControlStatus() {
  try {
    const r = await fetch(NCSL_RENT_CONTROL_URL, {
      headers: { 'User-Agent': 'RentalIQ/1.0', 'Accept': 'text/html' },
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) return null;

    const html = await r.text();

    // NCSL typically has a table or list of states with preemption/control status
    // Look for patterns like "Texas — Preempted" or state names near "preempt" keyword
    const preemptedStates = new Set();
    const statewideControlStates = new Set();

    const stateNameToCode = {
      'Alabama':'AL','Alaska':'AK','Arizona':'AZ','Arkansas':'AR','California':'CA',
      'Colorado':'CO','Connecticut':'CT','Delaware':'DE','Florida':'FL','Georgia':'GA',
      'Hawaii':'HI','Idaho':'ID','Illinois':'IL','Indiana':'IN','Iowa':'IA','Kansas':'KS',
      'Kentucky':'KY','Louisiana':'LA','Maine':'ME','Maryland':'MD','Massachusetts':'MA',
      'Michigan':'MI','Minnesota':'MN','Mississippi':'MS','Missouri':'MO','Montana':'MT',
      'Nebraska':'NE','Nevada':'NV','New Hampshire':'NH','New Jersey':'NJ','New Mexico':'NM',
      'New York':'NY','North Carolina':'NC','North Dakota':'ND','Ohio':'OH','Oklahoma':'OK',
      'Oregon':'OR','Pennsylvania':'PA','Rhode Island':'RI','South Carolina':'SC',
      'South Dakota':'SD','Tennessee':'TN','Texas':'TX','Utah':'UT','Vermont':'VT',
      'Virginia':'VA','Washington':'WA','West Virginia':'WV','Wisconsin':'WI','Wyoming':'WY',
    };

    // Parse for preemption mentions — look for state names within 100 chars of "preempt"
    for (const [name, code] of Object.entries(stateNameToCode)) {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const preemptPattern = new RegExp(`${escaped}.{0,150}preempt|preempt.{0,150}${escaped}`, 'i');
      const statewidePattern = new RegExp(`${escaped}.{0,150}statewide.{0,50}rent.{0,50}control|statewide.{0,50}rent.{0,50}control.{0,150}${escaped}`, 'i');

      if (preemptPattern.test(html)) preemptedStates.add(code);
      if (statewidePattern.test(html)) statewideControlStates.add(code);
    }

    if (preemptedStates.size < 5) return null; // didn't extract enough to trust

    return { preemptedStates, statewideControlStates, asOf: new Date().toISOString().slice(0, 7) };
  } catch (err) {
    console.warn('[landlordLawFetcher] NCSL fetch failed:', err.message);
    return null;
  }
}

/**
 * Fetches updated landlord law data for all states.
 * Merges live eviction notice data with existing static baseline,
 * updating only the fields that the live API can provide.
 *
 * @returns {Promise<Object|null>} Updated landlord laws keyed by state code, or null on full failure
 */
export async function fetchLandlordLaws() {
  try {
    const updated = {};
    let evictionLabSuccesses = 0;

    // Fetch eviction notice periods for all states in parallel (batched to avoid hammering)
    const states = Object.keys(LANDLORD_LAWS);
    const BATCH_SIZE = 5;

    for (let i = 0; i < states.length; i += BATCH_SIZE) {
      const batch = states.slice(i, i + BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map(async (stateCode) => {
          const liveNotice = await fetchEvictionNoticeForState(stateCode);
          return { stateCode, liveNotice };
        })
      );

      for (const result of results) {
        if (result.status === 'fulfilled') {
          const { stateCode, liveNotice } = result.value;
          const baseline = LANDLORD_LAWS[stateCode];
          if (!baseline) continue;

          // Start with baseline — only override eviction days if we got a live value
          updated[stateCode] = { ...baseline };
          if (liveNotice && liveNotice.days) {
            updated[stateCode].evictionNoticeDays = liveNotice.days;
            updated[stateCode]._evictionSource = liveNotice.source;
            updated[stateCode]._evictionAsOf = liveNotice.asOf;
            evictionLabSuccesses++;
          }
        }
      }

      // Brief pause between batches to be respectful
      if (i + BATCH_SIZE < states.length) {
        await new Promise(r => setTimeout(r, 300));
      }
    }

    // Fetch NCSL rent control status to update preemption flags
    const ncslData = await fetchNcslRentControlStatus();
    if (ncslData) {
      for (const stateCode of Object.keys(updated)) {
        if (ncslData.preemptedStates.has(stateCode)) {
          updated[stateCode].rentControlPreempted = true;
          updated[stateCode].rentControlLocalOk = false;
          updated[stateCode]._rentControlSource = 'NCSL';
          updated[stateCode]._rentControlAsOf = ncslData.asOf;
        }
        if (ncslData.statewideControlStates.has(stateCode)) {
          updated[stateCode].rentControlState = true;
          updated[stateCode]._rentControlSource = 'NCSL';
          updated[stateCode]._rentControlAsOf = ncslData.asOf;
        }
      }
    }

    // Need at least 40 states to trust this
    if (Object.keys(updated).length < 40) return null;

    // Recalculate scores where eviction days changed
    for (const [stateCode, law] of Object.entries(updated)) {
      const baseline = LANDLORD_LAWS[stateCode];
      if (!baseline) continue;
      if (law.evictionNoticeDays !== baseline.evictionNoticeDays) {
        // Recalculate just the eviction days component of the score
        const evictionPts = law.evictionNoticeDays <= 3 ? 30
          : law.evictionNoticeDays <= 7  ? 20
          : law.evictionNoticeDays <= 14 ? 10 : 0;
        const oldEvictionPts = baseline.evictionNoticeDays <= 3 ? 30
          : baseline.evictionNoticeDays <= 7  ? 20
          : baseline.evictionNoticeDays <= 14 ? 10 : 0;
        law.score = Math.max(0, Math.min(100, baseline.score - oldEvictionPts + evictionPts));
      }
    }

    console.log(`[landlordLawFetcher] Updated ${evictionLabSuccesses} eviction notice periods from Eviction Lab`);

    return {
      ...updated,
      _fetchedAt: new Date().toISOString(),
      _source: `Eviction Lab + NCSL (${evictionLabSuccesses} states live)`,
    };

  } catch (err) {
    console.warn('[landlordLawFetcher] Fatal error:', err.message);
    return null;
  }
}
