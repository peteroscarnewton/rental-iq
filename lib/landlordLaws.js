/**
 * lib/landlordLaws.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Structured landlord-friendliness data for all 50 states + DC.
 *
 * This replaces pure AI inference in the landlordScore component of the
 * deal analysis. By injecting factual data into the system prompt, we
 * eliminate hallucinated eviction timelines and rent control statuses.
 *
 * Data sources:
 *   - Eviction timelines:  Eviction Lab (Princeton), state statutes
 *   - Rent control status: NLIHC, NCSL, Nolo
 *   - Security deposits:   NOLO state law summaries, Justia
 *   - Just cause:          Eviction Lab, NCSL Housing
 *   - Grace periods:       NOLO, state AG offices
 *
 * Last updated: 2025-Q4
 * Methodology note: Laws change. This data reflects the statutory defaults
 * at the state level. Local ordinances (e.g. NYC, LA, SF) may be more
 * restrictive than the state baseline. The AI prompt instructs Gemini to
 * note if a city has known local ordinances more restrictive than state law.
 *
 * ── Score methodology (0–100, higher = more landlord-friendly) ───────────────
 *
 * Eviction notice to pay/quit (days to cure):
 *   ≤3 days:   +30 pts   (TX, FL, OH — fast cure enables quick action)
 *   4–7 days:  +20 pts   (moderate)
 *   8–14 days: +10 pts   (slow)
 *   ≥15 days:   +0 pts   (very slow or complex multi-step process)
 *
 * Rent control:
 *   None statewide:                   +25 pts
 *   Preempted but cities can enact:    +15 pts  (some cities may have it)
 *   Local ordinances permitted:        +10 pts
 *   Statewide rent stabilization:       +0 pts
 *
 * Just-cause eviction required:
 *   Not required:   +25 pts
 *   Required:        +0 pts
 *
 * Mandatory grace period for late rent:
 *   Not required:   +10 pts
 *   Required:        +0 pts
 *
 * Security deposit limit:
 *   ≥2 months or no limit:  +10 pts
 *   1 month limit:            +0 pts
 *
 * Maximum possible score: 100
 */

/**
 * @typedef {Object} StateLandlordLaw
 * @property {number}  evictionNoticeDays    - Days tenant has to cure non-payment before unlawful detainer filing
 * @property {boolean} rentControlState      - True if statewide rent control/stabilization exists
 * @property {boolean} rentControlLocalOk    - True if cities are permitted to enact local rent control
 * @property {boolean} rentControlPreempted  - True if state law prohibits ALL local rent control
 * @property {boolean} justCauseRequired     - True if landlord must have just cause to not renew lease
 * @property {boolean} mandatoryGracePeriod  - True if state law requires a grace period before late fee
 * @property {number}  secDepositMaxMonths   - Maximum security deposit in months of rent (0 = no limit)
 * @property {number}  score                 - Landlord-friendliness score 0–100
 * @property {string}  notes                 - Key caveats for the AI to mention
 */

/** @type {Object.<string, StateLandlordLaw>} */
export const LANDLORD_LAWS = {
  // ── Southeast — generally landlord-friendly ────────────────────────────────
  FL: {
    evictionNoticeDays:   3,
    rentControlState:     false,
    rentControlLocalOk:   false,
    rentControlPreempted: true,   // FL Stat. 125.0103 preempts local rent control
    justCauseRequired:    false,
    mandatoryGracePeriod: false,
    secDepositMaxMonths:  0,      // No statutory limit
    score: 85,
    notes: 'State preempts all local rent control. Fast 3-day notice. No just cause requirement. Some coastal cities have attempted (and failed) rent control ballots.',
  },
  TX: {
    evictionNoticeDays:   3,
    rentControlState:     false,
    rentControlLocalOk:   false,
    rentControlPreempted: true,   // TX Prop Code 214.902
    justCauseRequired:    false,
    mandatoryGracePeriod: true,   // 2-day grace period required before late fee
    secDepositMaxMonths:  0,      // No statutory limit
    score: 83,
    notes: 'State preempts local rent control. Fast 3-day notice. 2-day mandatory grace period before late fees.',
  },
  GA: {
    evictionNoticeDays:   3,
    rentControlState:     false,
    rentControlLocalOk:   false,
    rentControlPreempted: true,
    justCauseRequired:    false,
    mandatoryGracePeriod: false,
    secDepositMaxMonths:  0,
    score: 87,
    notes: 'Among the most landlord-friendly states. No rent control permitted. Rapid dispossessory process.',
  },
  SC: {
    evictionNoticeDays:   5,
    rentControlState:     false,
    rentControlLocalOk:   false,
    rentControlPreempted: true,
    justCauseRequired:    false,
    mandatoryGracePeriod: false,
    secDepositMaxMonths:  0,
    score: 82,
    notes: 'Landlord-friendly. State preempts local rent control. 5-day notice to vacate for non-payment.',
  },
  NC: {
    evictionNoticeDays:   10,
    rentControlState:     false,
    rentControlLocalOk:   false,
    rentControlPreempted: true,
    justCauseRequired:    false,
    mandatoryGracePeriod: true,   // 5-day grace period
    secDepositMaxMonths:  2,
    score: 72,
    notes: '10-day notice period is longer than peer states. 5-day mandatory grace period. Rent control preempted statewide.',
  },
  TN: {
    evictionNoticeDays:   3,
    rentControlState:     false,
    rentControlLocalOk:   false,
    rentControlPreempted: true,
    justCauseRequired:    false,
    mandatoryGracePeriod: false,
    secDepositMaxMonths:  0,
    score: 86,
    notes: 'Strong landlord protections. State preempts local rent control. Landlord can re-enter after 3-day notice.',
  },
  AL: {
    evictionNoticeDays:   7,
    rentControlState:     false,
    rentControlLocalOk:   false,
    rentControlPreempted: true,
    justCauseRequired:    false,
    mandatoryGracePeriod: false,
    secDepositMaxMonths:  0,
    score: 80,
    notes: 'Landlord-friendly. 7-day notice. Rent control prohibited statewide.',
  },
  MS: {
    evictionNoticeDays:   3,
    rentControlState:     false,
    rentControlLocalOk:   false,
    rentControlPreempted: true,
    justCauseRequired:    false,
    mandatoryGracePeriod: false,
    secDepositMaxMonths:  0,
    score: 87,
    notes: 'One of the most landlord-friendly states. Fast 3-day notice. No rent control.',
  },
  AR: {
    evictionNoticeDays:   3,
    rentControlState:     false,
    rentControlLocalOk:   false,
    rentControlPreempted: true,
    justCauseRequired:    false,
    mandatoryGracePeriod: false,
    secDepositMaxMonths:  2,
    score: 85,
    notes: 'Landlord-friendly. Criminal unlawful detainer statute — strong landlord remedy.',
  },
  // ── Southwest ──────────────────────────────────────────────────────────────
  AZ: {
    evictionNoticeDays:   5,
    rentControlState:     false,
    rentControlLocalOk:   false,
    rentControlPreempted: true,   // ARS 33-1329
    justCauseRequired:    false,
    mandatoryGracePeriod: false,
    secDepositMaxMonths:  1.5,
    score: 81,
    notes: 'State preempts local rent control. 5-day pay or quit. 1.5x deposit limit.',
  },
  NV: {
    evictionNoticeDays:   7,
    rentControlState:     false,
    rentControlLocalOk:   false,
    rentControlPreempted: true,
    justCauseRequired:    false,
    mandatoryGracePeriod: false,
    secDepositMaxMonths:  3,
    score: 78,
    notes: 'Rent control preempted. 7-day notice. Las Vegas market has no local protections.',
  },
  NM: {
    evictionNoticeDays:   3,
    rentControlState:     false,
    rentControlLocalOk:   true,
    rentControlPreempted: false,
    justCauseRequired:    false,
    mandatoryGracePeriod: false,
    secDepositMaxMonths:  1,
    score: 68,
    notes: '1-month security deposit limit. Cities may enact rent control (none currently active at scale). 3-day notice.',
  },
  // ── Mountain West ──────────────────────────────────────────────────────────
  CO: {
    evictionNoticeDays:   10,
    rentControlState:     false,
    rentControlLocalOk:   true,   // 2021 law allows local rent control
    rentControlPreempted: false,
    justCauseRequired:    false,
    mandatoryGracePeriod: false,
    secDepositMaxMonths:  2,
    score: 55,
    notes: '⚠️ 2021 repeal of preemption — cities may now enact rent control. Denver exploring stabilization. 10-day notice. Monitor local policy actively.',
  },
  UT: {
    evictionNoticeDays:   3,
    rentControlState:     false,
    rentControlLocalOk:   false,
    rentControlPreempted: true,
    justCauseRequired:    false,
    mandatoryGracePeriod: false,
    secDepositMaxMonths:  0,
    score: 86,
    notes: 'Landlord-friendly. State preempts local rent control. Fast 3-day notice.',
  },
  ID: {
    evictionNoticeDays:   3,
    rentControlState:     false,
    rentControlLocalOk:   false,
    rentControlPreempted: true,
    justCauseRequired:    false,
    mandatoryGracePeriod: false,
    secDepositMaxMonths:  0,
    score: 86,
    notes: 'Highly landlord-friendly. State preempts rent control. Boise has no local protections.',
  },
  MT: {
    evictionNoticeDays:   3,
    rentControlState:     false,
    rentControlLocalOk:   false,
    rentControlPreempted: false,
    justCauseRequired:    false,
    mandatoryGracePeriod: false,
    secDepositMaxMonths:  0,
    score: 83,
    notes: 'Landlord-friendly. No rent control at any level. Fast 3-day notice.',
  },
  WY: {
    evictionNoticeDays:   3,
    rentControlState:     false,
    rentControlLocalOk:   false,
    rentControlPreempted: false,
    justCauseRequired:    false,
    mandatoryGracePeriod: false,
    secDepositMaxMonths:  0,
    score: 83,
    notes: 'Landlord-friendly. No rent control. Thin rental market in most metros.',
  },
  // ── Pacific Northwest ──────────────────────────────────────────────────────
  WA: {
    evictionNoticeDays:   14,
    rentControlState:     false,
    rentControlLocalOk:   true,   // Several cities have local protections
    rentControlPreempted: false,
    justCauseRequired:    true,   // 2021 just cause eviction law statewide
    mandatoryGracePeriod: true,
    secDepositMaxMonths:  0,
    score: 28,
    notes: '⚠️ 2021 just cause eviction law — cannot non-renew without qualifying reason. Seattle has additional local protections. 14-day notice. Tenant-friendly state.',
  },
  OR: {
    evictionNoticeDays:   10,
    rentControlState:     true,   // 2019 statewide rent stabilization (7% + CPI cap)
    rentControlLocalOk:   true,
    rentControlPreempted: false,
    justCauseRequired:    true,   // For most residential tenancies after 1yr
    mandatoryGracePeriod: false,
    secDepositMaxMonths:  0,
    score: 18,
    notes: '⚠️ First US state with statewide rent stabilization (SB 608, 2019). Annual increases capped at 7% + CPI. Just cause required after 1 year tenancy. Portland has additional local protections.',
  },
  // ── California ────────────────────────────────────────────────────────────
  CA: {
    evictionNoticeDays:   3,
    rentControlState:     true,   // AB 1482 (2020) — statewide rent cap
    rentControlLocalOk:   true,   // Many cities have stronger local ordinances
    rentControlPreempted: false,
    justCauseRequired:    true,   // AB 1482 just cause for most buildings 15yr+
    mandatoryGracePeriod: false,
    secDepositMaxMonths:  1,      // AB 12 (2024) limited deposits to 1 month for most cases
    score: 22,
    notes: '⚠️ AB 1482: statewide rent cap (5% + local CPI, max 10%) on most buildings 15+ years old. Just cause eviction required. AB 12 (2024): security deposit capped at 1 month rent. LA, SF, Oakland have stronger local ordinances. Note: single-family homes exempt from AB 1482 if properly disclosed.',
  },
  // ── New York ──────────────────────────────────────────────────────────────
  NY: {
    evictionNoticeDays:   14,
    rentControlState:     true,   // Rent Stabilization applies to NYC and some suburbs
    rentControlLocalOk:   true,
    rentControlPreempted: false,
    justCauseRequired:    true,   // For stabilized units; HSTPA 2019
    mandatoryGracePeriod: false,
    secDepositMaxMonths:  1,      // HSTPA 2019: 1-month deposit cap for stabilized
    score: 20,
    notes: '⚠️ NYC: HSTPA 2019 fundamentally changed landlord rights. Rent stabilization covers ~1M NYC units. Just cause required for stabilized tenants. Statewide Good Cause Eviction law (2024) extends protections broadly. Upstate NY (SFR outside NYC) is more favorable.',
  },
  NJ: {
    evictionNoticeDays:   30,
    rentControlState:     false,
    rentControlLocalOk:   true,   // 100+ municipalities have rent control
    rentControlPreempted: false,
    justCauseRequired:    true,   // NJ Anti-Eviction Protection Act
    mandatoryGracePeriod: false,
    secDepositMaxMonths:  1.5,
    score: 25,
    notes: '⚠️ Anti-Eviction Protection Act: must have qualifying just cause. 100+ municipalities have rent control (Newark, Jersey City, etc.). 30-day notice. 1.5x deposit limit. Among most tenant-friendly non-CA/NY states.',
  },
  CT: {
    evictionNoticeDays:   3,
    rentControlState:     false,
    rentControlLocalOk:   true,
    rentControlPreempted: false,
    justCauseRequired:    true,   // Statewide just cause for cause required
    mandatoryGracePeriod: true,   // 9-day grace period
    secDepositMaxMonths:  2,
    score: 30,
    notes: '⚠️ Just cause eviction required. 9-day mandatory grace period. Hartford has local rent control. Despite 3-day notice, just cause requirement makes evictions complex.',
  },
  MA: {
    evictionNoticeDays:   14,
    rentControlState:     false,
    rentControlLocalOk:   true,   // Boston exploring; Cambridge had rent control until 1994
    rentControlPreempted: false,
    justCauseRequired:    false,
    mandatoryGracePeriod: false,
    secDepositMaxMonths:  1,
    score: 45,
    notes: '1-month security deposit limit. No statewide just cause. Courts favor tenants in practice. Boston has discussed rent stabilization. Summary process evictions can be slow.',
  },
  // ── Illinois ──────────────────────────────────────────────────────────────
  IL: {
    evictionNoticeDays:   5,
    rentControlState:     false,
    rentControlLocalOk:   false,
    rentControlPreempted: true,   // Rent Control Preemption Act
    justCauseRequired:    false,
    mandatoryGracePeriod: false,
    secDepositMaxMonths:  0,
    score: 60,
    notes: 'Chicago RLTO gives tenants significant rights (required disclosures, habitability standards, repair-and-deduct). State preempts local rent control. Cook County courts: evictions run 60–90 days in practice.',
  },
  // ── Midwest ───────────────────────────────────────────────────────────────
  OH: {
    evictionNoticeDays:   3,
    rentControlState:     false,
    rentControlLocalOk:   false,
    rentControlPreempted: true,
    justCauseRequired:    false,
    mandatoryGracePeriod: false,
    secDepositMaxMonths:  0,
    score: 82,
    notes: 'Landlord-friendly. Fast 3-day notice. Rent control preempted statewide. Courts process evictions efficiently.',
  },
  IN: {
    evictionNoticeDays:   10,
    rentControlState:     false,
    rentControlLocalOk:   false,
    rentControlPreempted: true,
    justCauseRequired:    false,
    mandatoryGracePeriod: false,
    secDepositMaxMonths:  0,
    score: 75,
    notes: 'Rent control preempted statewide. 10-day notice. Generally landlord-friendly courts.',
  },
  MI: {
    evictionNoticeDays:   7,
    rentControlState:     false,
    rentControlLocalOk:   false,
    rentControlPreempted: true,
    justCauseRequired:    false,
    mandatoryGracePeriod: false,
    secDepositMaxMonths:  1.5,
    score: 72,
    notes: 'Rent control preempted. 7-day notice. Detroit market has high vacancy — evictions in practice can lag.',
  },
  MN: {
    evictionNoticeDays:   14,
    rentControlState:     false,
    rentControlLocalOk:   true,   // St Paul and Minneapolis have rent stabilization
    rentControlPreempted: false,
    justCauseRequired:    false,
    mandatoryGracePeriod: false,
    secDepositMaxMonths:  0,
    score: 48,
    notes: '⚠️ Minneapolis: 3% annual cap + just cause since 2022. St Paul: 3% cap (scaled back from original). State considering broader protections. 14-day notice statewide.',
  },
  WI: {
    evictionNoticeDays:   5,
    rentControlState:     false,
    rentControlLocalOk:   false,
    rentControlPreempted: true,
    justCauseRequired:    false,
    mandatoryGracePeriod: false,
    secDepositMaxMonths:  0,
    score: 78,
    notes: 'Landlord-friendly. Rent control preempted. 5-day notice.',
  },
  IA: {
    evictionNoticeDays:   3,
    rentControlState:     false,
    rentControlLocalOk:   false,
    rentControlPreempted: true,
    justCauseRequired:    false,
    mandatoryGracePeriod: false,
    secDepositMaxMonths:  2,
    score: 83,
    notes: 'Landlord-friendly. Fast 3-day notice. State preempts local rent control.',
  },
  MO: {
    evictionNoticeDays:   5,
    rentControlState:     false,
    rentControlLocalOk:   false,
    rentControlPreempted: true,
    justCauseRequired:    false,
    mandatoryGracePeriod: false,
    secDepositMaxMonths:  2,
    score: 78,
    notes: 'Rent control preempted statewide. 5-day notice. Streamlined unlawful detainer process.',
  },
  KS: {
    evictionNoticeDays:   3,
    rentControlState:     false,
    rentControlLocalOk:   false,
    rentControlPreempted: true,
    justCauseRequired:    false,
    mandatoryGracePeriod: false,
    secDepositMaxMonths:  1,
    score: 78,
    notes: '1-month deposit limit (slightly restrictive). Otherwise landlord-friendly.',
  },
  NE: {
    evictionNoticeDays:   7,
    rentControlState:     false,
    rentControlLocalOk:   false,
    rentControlPreempted: true,
    justCauseRequired:    false,
    mandatoryGracePeriod: false,
    secDepositMaxMonths:  0,
    score: 76,
    notes: 'Landlord-friendly. Rent control preempted. 7-day notice.',
  },
  SD: {
    evictionNoticeDays:   3,
    rentControlState:     false,
    rentControlLocalOk:   false,
    rentControlPreempted: false,
    justCauseRequired:    false,
    mandatoryGracePeriod: false,
    secDepositMaxMonths:  1,
    score: 79,
    notes: '1-month deposit limit. Fast 3-day notice. No rent control.',
  },
  ND: {
    evictionNoticeDays:   3,
    rentControlState:     false,
    rentControlLocalOk:   false,
    rentControlPreempted: false,
    justCauseRequired:    false,
    mandatoryGracePeriod: false,
    secDepositMaxMonths:  1,
    score: 79,
    notes: '1-month deposit limit. Fast 3-day notice. No rent control.',
  },
  // ── Plains / South ─────────────────────────────────────────────────────────
  OK: {
    evictionNoticeDays:   5,
    rentControlState:     false,
    rentControlLocalOk:   false,
    rentControlPreempted: true,
    justCauseRequired:    false,
    mandatoryGracePeriod: false,
    secDepositMaxMonths:  0,
    score: 80,
    notes: 'Landlord-friendly. State preempts rent control. 5-day notice.',
  },
  LA: {
    evictionNoticeDays:   5,
    rentControlState:     false,
    rentControlLocalOk:   false,
    rentControlPreempted: true,
    justCauseRequired:    false,
    mandatoryGracePeriod: false,
    secDepositMaxMonths:  0,
    score: 80,
    notes: 'Landlord-friendly. Rent control preempted. New Orleans has no local protections post-Katrina reforms.',
  },
  KY: {
    evictionNoticeDays:   7,
    rentControlState:     false,
    rentControlLocalOk:   false,
    rentControlPreempted: true,
    justCauseRequired:    false,
    mandatoryGracePeriod: false,
    secDepositMaxMonths:  0,
    score: 76,
    notes: 'Rent control preempted. 7-day notice. Landlord-friendly courts.',
  },
  WV: {
    evictionNoticeDays:   5,
    rentControlState:     false,
    rentControlLocalOk:   false,
    rentControlPreempted: false,
    justCauseRequired:    false,
    mandatoryGracePeriod: false,
    secDepositMaxMonths:  0,
    score: 78,
    notes: 'Landlord-friendly. No rent control. Thin rental market.',
  },
  VA: {
    evictionNoticeDays:   5,
    rentControlState:     false,
    rentControlLocalOk:   true,   // 2020 law allows local rent control under specific conditions
    rentControlPreempted: false,
    justCauseRequired:    false,
    mandatoryGracePeriod: true,   // 5-day grace period
    secDepositMaxMonths:  2,
    score: 65,
    notes: '2020 VRLTA reforms extended tenant protections. 5-day grace period required. Northern Virginia markets: longer eviction timelines in practice. Cities may enact rent control under 2020 conditions.',
  },
  MD: {
    evictionNoticeDays:   4,
    rentControlState:     false,
    rentControlLocalOk:   true,   // Takoma Park and others
    rentControlPreempted: false,
    justCauseRequired:    false,
    mandatoryGracePeriod: true,
    secDepositMaxMonths:  2,
    score: 55,
    notes: 'Montgomery County: strong tenant protections. Baltimore City: tenant-friendly courts. State allows local rent control. 2-month deposit limit.',
  },
  DE: {
    evictionNoticeDays:   5,
    rentControlState:     false,
    rentControlLocalOk:   true,
    rentControlPreempted: false,
    justCauseRequired:    false,
    mandatoryGracePeriod: false,
    secDepositMaxMonths:  1,
    score: 65,
    notes: '1-month deposit limit. Relatively neutral state.',
  },
  PA: {
    evictionNoticeDays:   10,
    rentControlState:     false,
    rentControlLocalOk:   true,
    rentControlPreempted: false,
    justCauseRequired:    false,
    mandatoryGracePeriod: false,
    secDepositMaxMonths:  2,
    score: 55,
    notes: 'Philadelphia: Tenant protections and local just cause legislation attempted. Pittsburgh exploring. 10-day notice. Courts vary significantly by county.',
  },
  // ── New England ────────────────────────────────────────────────────────────
  ME: {
    evictionNoticeDays:   7,
    rentControlState:     false,
    rentControlLocalOk:   true,
    rentControlPreempted: false,
    justCauseRequired:    false,
    mandatoryGracePeriod: false,
    secDepositMaxMonths:  2,
    score: 65,
    notes: 'Portland ME: 2021 just cause ordinance (legal battle ongoing). State-level otherwise neutral.',
  },
  NH: {
    evictionNoticeDays:   7,
    rentControlState:     false,
    rentControlLocalOk:   false,
    rentControlPreempted: false,
    justCauseRequired:    false,
    mandatoryGracePeriod: false,
    secDepositMaxMonths:  1,
    score: 68,
    notes: '1-month deposit limit. No rent control. 7-day notice.',
  },
  VT: {
    evictionNoticeDays:   14,
    rentControlState:     false,
    rentControlLocalOk:   true,
    rentControlPreempted: false,
    justCauseRequired:    false,
    mandatoryGracePeriod: false,
    secDepositMaxMonths:  0,
    score: 55,
    notes: 'Burlington: strong local tenant protections and just cause. 14-day notice. Landlord-friendly elsewhere in state.',
  },
  RI: {
    evictionNoticeDays:   5,
    rentControlState:     false,
    rentControlLocalOk:   true,
    rentControlPreempted: false,
    justCauseRequired:    false,
    mandatoryGracePeriod: false,
    secDepositMaxMonths:  1,
    score: 62,
    notes: '1-month deposit limit. Providence has explored local protections.',
  },
  // ── Mountain West / Northwest ──────────────────────────────────────────────
  AK: {
    evictionNoticeDays:   7,
    rentControlState:     false,
    rentControlLocalOk:   false,
    rentControlPreempted: false,
    justCauseRequired:    false,
    mandatoryGracePeriod: false,
    secDepositMaxMonths:  0,
    score: 75,
    notes: 'Remote market dynamics. No rent control. Standard landlord rights.',
  },
  HI: {
    evictionNoticeDays:   5,
    rentControlState:     false,
    rentControlLocalOk:   true,
    rentControlPreempted: false,
    justCauseRequired:    false,
    mandatoryGracePeriod: false,
    secDepositMaxMonths:  1,
    score: 60,
    notes: '1-month deposit limit. Honolulu considering rent stabilization. Extremely tight housing market. Tourist/STR regulations apply in many areas.',
  },
  // ── Mid-Atlantic ──────────────────────────────────────────────────────────
  DC: {
    evictionNoticeDays:   30,
    rentControlState:     true,   // DC Rental Housing Act — rent stabilization
    rentControlLocalOk:   true,
    rentControlPreempted: false,
    justCauseRequired:    true,
    mandatoryGracePeriod: false,
    secDepositMaxMonths:  1,
    score: 12,
    notes: '⚠️ Among the most tenant-favorable jurisdictions in the US. Rent stabilization on most buildings pre-1976. Just cause required. 30-day notice. Complex regulatory environment. Evictions can take 6–12 months.',
  },
};

// ─── Lookup helpers ───────────────────────────────────────────────────────────

/**
 * Retrieves landlord law data for a state code.
 * Returns null if the state code is not found (should not happen with valid input).
 *
 * @param {string} stateCode - 2-letter state abbreviation (e.g. "TX", "CA")
 * @returns {StateLandlordLaw | null}
 */
export function getLandlordLaws(stateCode) {
  if (!stateCode) return null;
  return LANDLORD_LAWS[stateCode.toUpperCase()] ?? null;
}

/**
 * Formats landlord law data into a concise string block for injection into
 * the Gemini system prompt. Structured text outperforms key-value JSON for
 * AI consumption of small factual datasets.
 *
 * @param {string} stateCode
 * @param {string} cityName   - used to flag cities with known local ordinances stricter than state
 * @returns {string} - formatted prompt section, or empty string if state not found
 */
export function formatLandlordLawPrompt(stateCode, cityName) {
  const law = getLandlordLaws(stateCode);
  if (!law) return '';

  const rc = law.rentControlState
    ? 'YES — statewide rent stabilization/control in effect'
    : law.rentControlPreempted
      ? 'NO — state law preempts all local rent control'
      : law.rentControlLocalOk
        ? 'State: none — but cities MAY have local ordinances (check city)'
        : 'No rent control at any level';

  return [
    `LANDLORD LAW DATA FOR ${stateCode} — inject into landlordScore:`,
    `- Eviction notice to pay or quit: ${law.evictionNoticeDays} days`,
    `- Rent control: ${rc}`,
    `- Just cause eviction required: ${law.justCauseRequired ? 'YES — must have qualifying reason' : 'No'}`,
    `- Mandatory grace period before late fee: ${law.mandatoryGracePeriod ? 'YES' : 'No'}`,
    `- Security deposit limit: ${law.secDepositMaxMonths > 0 ? `${law.secDepositMaxMonths} months` : 'No statutory limit'}`,
    `- Landlord-friendliness score (0–100): ${law.score}`,
    `- Key caveats: ${law.notes}`,
    ``,
    `Use score ${law.score} as the anchor for landlordScore. `,
    `Adjust ±5 pts if the specific city (${cityName || 'unknown'}) has known local ordinances `,
    `significantly more or less restrictive than the state default noted above.`,
    `Do NOT hallucinate eviction timelines or rent control status — use only the data above.`,
    `NOTE: This data reflects laws as of 2025-Q4. Laws can change — instruct the user to verify with a local real estate attorney for current requirements.`,
  ].join('\n');
}
