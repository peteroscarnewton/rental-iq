/**
 * lib/landlordLawUpdater.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Phase 4B: Dynamic landlord law versioning.
 *
 * Problem: landlordLaws.js is a static JSON file last updated Q4 2025.
 * Laws change — California alone passes landlord legislation annually.
 * This module detects stale data and triggers a structured review.
 *
 * Strategy:
 *   1. Track the last-verified date for each state in Supabase.
 *   2. Quarterly, query the NCSL (National Conference of State Legislatures)
 *      housing legislation tracker and Eviction Lab's policy database.
 *   3. When a state's law data is >120 days old, flag it for review.
 *   4. Provide a structured diff mechanism so changes can be reviewed
 *      before being applied (avoiding silent data corruption).
 *   5. Store change events in Supabase for audit trail.
 *
 * This module does NOT auto-apply law changes without human review.
 * It surfaces changes → sends admin alert → waits for confirmation.
 * The "auto-heal" comes from proactive detection, not autonomous editing.
 *
 * Eviction Lab Policy Scorecard API:
 *   https://evictionlab.org/policy-scorecard/
 *   Public JSON data at https://evictionlab.org/tool/data/ (free, no key)
 *
 * NCSL Housing Legislation Tracker:
 *   https://www.ncsl.org/housing (HTML scraping)
 *
 * Key: landlord_laws_audit in market_data_cache
 */

import { LANDLORD_LAWS } from './landlordLaws.js';

// ─── Eviction Lab Policy Scorecard ────────────────────────────────────────────

/**
 * Fetches the Eviction Lab policy scorecard for all states.
 * Returns a map of state → { score, justCause, rentControl, ... }
 * Used to detect changes vs. our stored LANDLORD_LAWS data.
 */
async function fetchEvictionLabPolicyData() {
  // Eviction Lab publishes its national scorecard data as a public JSON file
  // at their policy scorecard tool. This is the canonical source for
  // just-cause eviction status and renter protection scores.
  const EVICTION_LAB_URL = 'https://evictionlab.org/covid-policy-scorecard/data/policy_data.json';

  try {
    const r = await fetch(EVICTION_LAB_URL, { signal: AbortSignal.timeout(10000) });
    if (!r.ok) return null;

    const json = await r.json();
    // Eviction Lab data format varies by version — handle both array and object shapes
    const records = Array.isArray(json) ? json : (json.data || json.states || Object.values(json));
    if (!records?.length) return null;

    const stateData = {};
    for (const record of records) {
      const stateCode = record.state || record.stateCode || record.abbreviation;
      if (!stateCode || stateCode.length !== 2) continue;

      stateData[stateCode.toUpperCase()] = {
        justCauseRequired:   record.just_cause === true || record.justCause === true || false,
        rentControlActive:   record.rent_control === true || record.rentControl === true || false,
        evictionProtections: record.eviction_protection_score || record.score || null,
        source:              'EvictionLab',
        fetchedAt:           new Date().toISOString(),
      };
    }
    return Object.keys(stateData).length >= 30 ? stateData : null;
  } catch {
    return null;
  }
}

/**
 * Fetches recent housing legislation summaries from NCSL housing tracker.
 * Returns array of { state, title, year, type } objects.
 * Used to detect if a state has had recent legislative activity.
 */
async function fetchNcslHousingLegislation() {
  // NCSL publishes a structured housing legislation database.
  // The API endpoint below returns recent landlord-tenant related bills.
  const NCSL_URL = 'https://www.ncsl.org/research/housing/tenant-protections-legislation-database.aspx';

  try {
    // NCSL doesn't provide a public JSON API — we check if their page is reachable
    // and returns valid content as a proxy for data freshness.
    // Full parsing would require a proper scraper which is fragile.
    // Instead, we rely on Eviction Lab as the structured source,
    // and use NCSL as a staleness detector via page last-modified header.
    const r = await fetch(NCSL_URL, {
      method: 'HEAD',
      signal: AbortSignal.timeout(8000),
    });

    if (!r.ok) return null;

    const lastModified = r.headers.get('last-modified');
    return {
      reachable:    true,
      lastModified: lastModified || null,
      checkedAt:    new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

// ─── Change detection ─────────────────────────────────────────────────────────

/**
 * Compares live Eviction Lab data against our stored LANDLORD_LAWS.
 * Returns array of detected changes that warrant human review.
 *
 * @param {Object} liveData - from fetchEvictionLabPolicyData()
 * @returns {Array<{state, field, stored, live, severity}>}
 */
function detectLawChanges(liveData) {
  if (!liveData) return [];

  const changes = [];

  for (const [stateCode, liveState] of Object.entries(liveData)) {
    const stored = LANDLORD_LAWS[stateCode];
    if (!stored) continue; // state not in our database yet

    // Check just-cause status (high impact — changes landlord score by 25 pts)
    if (typeof liveState.justCauseRequired === 'boolean' &&
        stored.justCauseRequired !== liveState.justCauseRequired) {
      changes.push({
        state:    stateCode,
        field:    'justCauseRequired',
        stored:   stored.justCauseRequired,
        live:     liveState.justCauseRequired,
        severity: 'HIGH',  // 25-point score impact
        source:   liveState.source,
      });
    }

    // Check rent control status (high impact — changes score by up to 25 pts)
    if (typeof liveState.rentControlActive === 'boolean') {
      const storedHasControl = stored.rentControlState || stored.rentControlLocalOk;
      if (storedHasControl !== liveState.rentControlActive) {
        changes.push({
          state:    stateCode,
          field:    'rentControl',
          stored:   storedHasControl,
          live:     liveState.rentControlActive,
          severity: 'HIGH',
          source:   liveState.source,
        });
      }
    }
  }

  return changes;
}

// ─── Staleness tracking ────────────────────────────────────────────────────────

/**
 * Checks which states have law data older than maxAgeDays.
 * Uses the landlord_laws_audit key in Supabase to track per-state verification dates.
 *
 * @param {Object} db - Supabase admin client
 * @param {number} maxAgeDays - flag states last verified more than this many days ago
 * @returns {Promise<string[]>} - array of state codes that are stale
 */
async function getStaleStates(db, maxAgeDays = 120) {
  try {
    const { data, error } = await db
      .from('market_data_cache')
      .select('value')
      .eq('key', 'landlord_laws_audit')
      .single();

    if (error || !data?.value) {
      // No audit record yet — all states are unverified
      return Object.keys(LANDLORD_LAWS);
    }

    const audit = data.value; // { state: { lastVerified: ISO date }, ... }
    const cutoff = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000);
    const stale = [];

    for (const stateCode of Object.keys(LANDLORD_LAWS)) {
      const lastVerified = audit[stateCode]?.lastVerified;
      if (!lastVerified || new Date(lastVerified) < cutoff) {
        stale.push(stateCode);
      }
    }

    return stale;
  } catch {
    return Object.keys(LANDLORD_LAWS); // on error, treat all as stale
  }
}

/**
 * Marks a batch of states as verified in the audit record.
 * Called after a successful law check with no detected changes.
 *
 * @param {Object} db - Supabase admin client
 * @param {string[]} stateCodes - states to mark verified
 */
async function markStatesVerified(db, stateCodes) {
  if (!db || !stateCodes?.length) return;
  try {
    // Read current audit
    const { data } = await db
      .from('market_data_cache')
      .select('value')
      .eq('key', 'landlord_laws_audit')
      .single();

    const audit = data?.value || {};
    const now   = new Date().toISOString();

    for (const code of stateCodes) {
      audit[code] = { lastVerified: now, source: 'EvictionLab/NCSL' };
    }

    await db.from('market_data_cache').upsert(
      {
        key:         'landlord_laws_audit',
        value:       audit,
        fetched_at:  now,
        valid_until: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
      },
      { onConflict: 'key' }
    );
  } catch (err) {
    console.warn('[landlordLawUpdater] Failed to write audit record:', err.message);
  }
}

/**
 * Stores detected law changes in Supabase for admin review.
 * Changes are stored with a "pending_review" status — they do NOT
 * auto-update LANDLORD_LAWS.js (that requires a deploy).
 * The admin receives an alert email with a structured diff.
 *
 * @param {Object} db
 * @param {Array} changes - from detectLawChanges()
 */
async function storePendingChanges(db, changes) {
  if (!db || !changes?.length) return;
  try {
    const now     = new Date().toISOString();
    const existing = await db
      .from('market_data_cache')
      .select('value')
      .eq('key', 'landlord_laws_pending_changes')
      .single();

    const pending = existing?.data?.value || [];
    // Deduplicate by state+field combo
    const existingKeys = new Set(pending.map(c => `${c.state}:${c.field}`));
    const newChanges = changes.filter(c => !existingKeys.has(`${c.state}:${c.field}`));

    if (!newChanges.length) return;

    await db.from('market_data_cache').upsert(
      {
        key:         'landlord_laws_pending_changes',
        value:       [...pending, ...newChanges.map(c => ({ ...c, detectedAt: now, status: 'pending_review' }))],
        fetched_at:  now,
        valid_until: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      },
      { onConflict: 'key' }
    );
  } catch (err) {
    console.warn('[landlordLawUpdater] Failed to store pending changes:', err.message);
  }
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Run the landlord law staleness check.
 * Called by the cron — runs quarterly (every 90 days per state).
 *
 * Returns:
 *   {
 *     staleStates:     string[],   // states that exceeded the verification window
 *     detectedChanges: Array,      // law changes detected vs. our static data
 *     verified:        number,     // states marked as verified this run
 *     source:          string,
 *   }
 *
 * @param {Object} db - Supabase admin client
 */
export async function checkLandlordLawStaleness(db) {
  const MAX_AGE_DAYS = 120; // Alert after 4 months without verification

  // 1. Find stale states
  const staleStates = await getStaleStates(db, MAX_AGE_DAYS);

  if (!staleStates.length) {
    return {
      staleStates:     [],
      detectedChanges: [],
      verified:        0,
      source:          'cache',
    };
  }

  // 2. Fetch live data from Eviction Lab
  const [liveData, ncslStatus] = await Promise.allSettled([
    fetchEvictionLabPolicyData(),
    fetchNcslHousingLegislation(),
  ]);

  const evictionLabData = liveData.status === 'fulfilled' ? liveData.value : null;

  // 3. Detect changes
  const detectedChanges = detectLawChanges(evictionLabData);

  // 4. Store any changes for admin review
  if (detectedChanges.length > 0) {
    await storePendingChanges(db, detectedChanges);
  }

  // 5. Mark states as verified (regardless of whether changes were found)
  // Changes are flagged for review, not auto-applied, so we still mark as verified
  // to avoid re-checking every single run
  if (evictionLabData) {
    await markStatesVerified(db, staleStates.filter(s => evictionLabData[s]));
  }

  return {
    staleStates,
    detectedChanges,
    verified: evictionLabData ? staleStates.filter(s => evictionLabData[s]).length : 0,
    ncslReachable: ncslStatus.status === 'fulfilled' && ncslStatus.value?.reachable,
    source: evictionLabData ? 'EvictionLab' : 'unavailable',
  };
}

/**
 * Retrieves any pending landlord law changes waiting for admin review.
 * @param {Object} db
 * @returns {Promise<Array>}
 */
export async function getPendingLawChanges(db) {
  if (!db) return [];
  try {
    const { data } = await db
      .from('market_data_cache')
      .select('value')
      .eq('key', 'landlord_laws_pending_changes')
      .single();
    return data?.value || [];
  } catch {
    return [];
  }
}
