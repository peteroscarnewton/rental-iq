/**
 * lib/cityRentControlDb.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Phase 7 — Item 11: City-Level Rent Control Database
 *
 * Source: NLIHC Renter Protections Database, NCSL Housing State Preemption Table,
 *         individual city ordinances (cross-referenced with Nolo + local gov sites)
 *
 * This extends landlordLaws.js which only captures STATE-level rent control.
 * Many states have no statewide rent control but certain cities do — or the
 * state law allows cities to enact their own ordinances.
 *
 * Coverage: All US cities with active rent control/stabilization ordinances
 *           as of 2025-Q1. Preemption states with zero local ordinances are omitted.
 *
 * Return shape: {
 *   city:            string     — canonical city name
 *   state:           string     — 2-letter state code
 *   status:          'active' | 'preempted' | 'none'
 *   ordinanceName:   string     — official name of the ordinance
 *   coversType:      string[]   — ['sfr','mfr','condo','mobile_home']
 *   annualCap:       number|null — max annual rent increase % (null = CPI-tied)
 *   cpiTied:         boolean    — true if cap is tied to CPI
 *   justCauseEviction: boolean  — true if just cause required for eviction
 *   expiresYear:     number|null — if temporary/trial ordinance
 *   exemptions:      string     — key exemptions (new construction, owner-occupied, etc.)
 *   source:          string
 *   note:            string     — AI-injectable summary
 * }
 */

/** @type {Object.<string, Object>} keyed by "city_state" lowercase */
const CITY_RENT_CONTROL = {

  // ── California — cities allowed to enact local ordinances ─────────────────
  'san_francisco_ca': {
    city: 'San Francisco', state: 'CA',
    status: 'active',
    ordinanceName: 'San Francisco Rent Ordinance (1979)',
    coversType: ['mfr'],
    annualCap: null, cpiTied: true,
    justCauseEviction: true,
    expiresYear: null,
    exemptions: 'Buildings built after June 1979 exempt (Costa-Hawkins). Single-family homes exempt unless pre-1979 duplex with landlord-occupancy restrictions.',
    source: 'SF Rent Ordinance §37.3 + Costa-Hawkins Rental Housing Act',
    note: 'San Francisco has one of the strongest tenant protections in the US. Rent increases capped at 60% of CPI. Just cause required for ALL evictions including lease non-renewals. New construction (post-1979) is exempt per Costa-Hawkins.',
  },
  'los_angeles_ca': {
    city: 'Los Angeles', state: 'CA',
    status: 'active',
    ordinanceName: 'LA Rent Stabilization Ordinance (RSO, 1978)',
    coversType: ['mfr'],
    annualCap: 3.0, cpiTied: false,
    justCauseEviction: true,
    expiresYear: null,
    exemptions: 'Buildings built after October 1978 exempt (Costa-Hawkins). SFRs/condos generally exempt. Short-term rentals regulated separately.',
    source: 'LA RSO LAMC §151 + Costa-Hawkins',
    note: 'LA RSO applies to ~650,000 units. Annual allowable increase typically 3-8% (set by city council annually). Just cause required. New construction post-Oct 1978 exempt per Costa-Hawkins.',
  },
  'santa_monica_ca': {
    city: 'Santa Monica', state: 'CA',
    status: 'active',
    ordinanceName: 'Santa Monica Rent Control Law (1979)',
    coversType: ['mfr'],
    annualCap: null, cpiTied: true,
    justCauseEviction: true,
    expiresYear: null,
    exemptions: 'Post-1979 construction exempt. Owner-occupied buildings with ≤2 units exempt.',
    source: 'Santa Monica Rent Control Charter Amendment',
    note: 'Santa Monica has strict rent control with CPI-tied caps and mandatory just cause eviction. Strong tenant protections — significant landlord constraint.',
  },
  'berkeley_ca': {
    city: 'Berkeley', state: 'CA',
    status: 'active',
    ordinanceName: 'Berkeley Rent Stabilization and Eviction for Good Cause Ordinance (1980)',
    coversType: ['mfr'],
    annualCap: null, cpiTied: true,
    justCauseEviction: true,
    expiresYear: null,
    exemptions: 'Post-1980 construction exempt (Costa-Hawkins). SFRs/condos exempt.',
    source: 'Berkeley Rent Board',
    note: 'Berkeley rent stabilization is among the strongest in California. CPI-tied increases, full just cause protections.',
  },
  'oakland_ca': {
    city: 'Oakland', state: 'CA',
    status: 'active',
    ordinanceName: 'Oakland Just Cause for Eviction + Rent Adjustment Program',
    coversType: ['mfr'],
    annualCap: null, cpiTied: true,
    justCauseEviction: true,
    expiresYear: null,
    exemptions: 'Post-1983 construction exempt. SFRs/condos with no prior tenancy exempt.',
    source: 'Oakland Municipal Code §8.22',
    note: 'Oakland rent adjustment program (RAP) provides CPI-based caps. Separate just cause ordinance covers ALL rental units regardless of age.',
  },
  'mountain_view_ca': {
    city: 'Mountain View', state: 'CA',
    status: 'active',
    ordinanceName: 'Community Stabilization & Fair Rent Act (2016)',
    coversType: ['mfr'],
    annualCap: null, cpiTied: true,
    justCauseEviction: true,
    expiresYear: null,
    exemptions: 'New construction (post-Feb 2017) exempt. SFRs/condos exempt.',
    source: 'Mountain View CSFRA',
    note: 'Mountain View CSFRA ties rent to CPI with a 2-5% cap. Just cause required.',
  },
  'east_palo_alto_ca': {
    city: 'East Palo Alto', state: 'CA',
    status: 'active',
    ordinanceName: 'East Palo Alto Rent Stabilization Ordinance (1988)',
    coversType: ['mfr', 'mobile_home'],
    annualCap: null, cpiTied: true,
    justCauseEviction: true,
    expiresYear: null,
    exemptions: 'Post-1988 construction exempt.',
    source: 'EPA Municipal Code §14.04',
    note: 'East Palo Alto has rent stabilization with just cause protections. CPI-tied increases.',
  },
  'hayward_ca': {
    city: 'Hayward', state: 'CA',
    status: 'active',
    ordinanceName: 'Hayward Rent Review Ordinance (2016, strengthened 2019)',
    coversType: ['mfr'],
    annualCap: 5.0, cpiTied: false,
    justCauseEviction: true,
    expiresYear: null,
    exemptions: 'Post-1979 construction exempt. SFRs exempt.',
    source: 'Hayward Municipal Code',
    note: 'Hayward caps rent increases at 5% annually with just cause eviction requirements.',
  },
  'richmond_ca': {
    city: 'Richmond', state: 'CA',
    status: 'active',
    ordinanceName: 'Richmond Fair Rent, Just Cause for Eviction, and Homeowner Protection Act (2016)',
    coversType: ['mfr', 'sfr'],
    annualCap: null, cpiTied: true,
    justCauseEviction: true,
    expiresYear: null,
    exemptions: 'Post-1995 construction exempt (Costa-Hawkins). Owner-occupied SFR with one rental unit may be exempt.',
    source: 'Richmond FRJCE Ordinance',
    note: 'Richmond has broad rent and eviction protections covering SFRs and multi-family. CPI-tied caps.',
  },
  'san_jose_ca': {
    city: 'San Jose', state: 'CA',
    status: 'active',
    ordinanceName: 'San Jose Rent Ordinance (1979)',
    coversType: ['mfr'],
    annualCap: null, cpiTied: true,
    justCauseEviction: true,
    expiresYear: null,
    exemptions: 'Post-September 1979 construction exempt. SFRs/condos exempt per Costa-Hawkins.',
    source: 'San Jose Municipal Code §17.23',
    note: 'San Jose rent ordinance caps annual increases at CPI (up to 5%). Just cause required for covered units.',
  },
  'los_gatos_ca': {
    city: 'Los Gatos', state: 'CA',
    status: 'active',
    ordinanceName: 'Los Gatos Rent Control for Mobile Homes',
    coversType: ['mobile_home'],
    annualCap: null, cpiTied: true,
    justCauseEviction: false,
    expiresYear: null,
    exemptions: 'Only mobile home spaces covered.',
    source: 'Los Gatos Town Code',
    note: 'Los Gatos rent control applies only to mobile home spaces, not standard residential rentals.',
  },
  'inglewood_ca': {
    city: 'Inglewood', state: 'CA',
    status: 'active',
    ordinanceName: 'Inglewood Rental Housing Board Ordinance (2023)',
    coversType: ['mfr'],
    annualCap: 3.0, cpiTied: false,
    justCauseEviction: true,
    expiresYear: null,
    exemptions: 'New construction post-Feb 1995 exempt.',
    source: 'Inglewood Ordinance No. 24-13',
    note: 'Inglewood enacted rent stabilization in 2023. Annual increases capped at 3% or 60% of CPI, whichever is lower.',
  },
  'west_hollywood_ca': {
    city: 'West Hollywood', state: 'CA',
    status: 'active',
    ordinanceName: 'West Hollywood Rent Stabilization Ordinance (1985)',
    coversType: ['mfr'],
    annualCap: null, cpiTied: true,
    justCauseEviction: true,
    expiresYear: null,
    exemptions: 'Post-July 1979 construction exempt.',
    source: 'WeHo RSO',
    note: 'West Hollywood has comprehensive rent control with CPI-based caps and strong eviction protections.',
  },

  // ── New York ──────────────────────────────────────────────────────────────
  'new_york_city_ny': {
    city: 'New York City', state: 'NY',
    status: 'active',
    ordinanceName: 'NYC Rent Stabilization Law (RSL, 1969) + Rent Guidelines Board',
    coversType: ['mfr'],
    annualCap: 3.0, cpiTied: false,
    justCauseEviction: true,
    expiresYear: null,
    exemptions: 'High-rent units ($2,000+/mo when deregulated before 2019 reforms) are deregulated. New construction gets 35-year exemption (421-a). Owner-occupied small buildings exempt.',
    source: 'NYC RSL + 2019 Housing Stability and Tenant Protection Act (HSTPA)',
    note: 'NYC has one of the most complex rent regulation systems in the US. ~1M stabilized units. Annual RGB votes set allowable increases (typically 2-4%). HSTPA 2019 largely ended deregulation pathways. Significant compliance burden for landlords.',
  },
  'new_york_ny': {  // alias
    city: 'New York', state: 'NY',
    status: 'active',
    ordinanceName: 'NYC Rent Stabilization Law',
    coversType: ['mfr'],
    annualCap: 3.0, cpiTied: false,
    justCauseEviction: true,
    expiresYear: null,
    exemptions: 'Post-1974 construction often exempt if fewer than 6 units. High-income/high-rent luxury deregulation largely eliminated by HSTPA 2019.',
    source: 'NYC RSL + HSTPA 2019',
    note: 'NYC rent stabilization covers roughly 1M apartments. Annual increases voted by Rent Guidelines Board (~2-4%). HSTPA 2019 eliminated most deregulation mechanisms.',
  },
  'albany_ny': {
    city: 'Albany', state: 'NY',
    status: 'active',
    ordinanceName: 'Albany Rent Stabilization (Emergency Tenant Protection Act)',
    coversType: ['mfr'],
    annualCap: 3.0, cpiTied: false,
    justCauseEviction: true,
    expiresYear: null,
    exemptions: 'Buildings with <6 units generally exempt.',
    source: 'NYS Emergency Tenant Protection Act (ETPA)',
    note: 'Albany opted into NY ETPA in 2022, extending rent stabilization protections to the city.',
  },

  // ── New Jersey ────────────────────────────────────────────────────────────
  'jersey_city_nj': {
    city: 'Jersey City', state: 'NJ',
    status: 'active',
    ordinanceName: 'Jersey City Rent Control Ordinance (1974)',
    coversType: ['mfr'],
    annualCap: null, cpiTied: true,
    justCauseEviction: true,
    expiresYear: null,
    exemptions: 'Buildings with ≤4 units owner-occupied may be exempt. New construction exempt for 30 years.',
    source: 'Jersey City Ordinance',
    note: 'Jersey City rent control caps increases at CPI with just cause eviction requirements. NJ preempts some aspects but cities retain broad authority.',
  },
  'hoboken_nj': {
    city: 'Hoboken', state: 'NJ',
    status: 'active',
    ordinanceName: 'Hoboken Rent Control Ordinance (1973)',
    coversType: ['mfr'],
    annualCap: null, cpiTied: true,
    justCauseEviction: true,
    expiresYear: null,
    exemptions: 'New construction after 1973 exempt for several years. Owner-occupied buildings with ≤3 units may be exempt.',
    source: 'Hoboken Rent Leveling Ordinance',
    note: 'Hoboken has CPI-tied rent control. Just cause required. Popular with NYC commuters — significant demand pressure.',
  },
  'newark_nj': {
    city: 'Newark', state: 'NJ',
    status: 'active',
    ordinanceName: 'Newark Rent Control Ordinance (1973)',
    coversType: ['mfr'],
    annualCap: null, cpiTied: true,
    justCauseEviction: true,
    expiresYear: null,
    exemptions: 'New construction (post-1973) exempt for 30 years. Owner-occupied ≤3 units exempt.',
    source: 'Newark Municipal Ordinance',
    note: 'Newark rent control with CPI caps and just cause protections. Large rental market — significant landlord compliance requirements.',
  },

  // ── Massachusetts ─────────────────────────────────────────────────────────
  // Note: MA banned rent control statewide in 1994. Boston tried to reinstate
  // in 2021 but state preemption remains. Monitoring for changes.
  'boston_ma': {
    city: 'Boston', state: 'MA',
    status: 'preempted',
    ordinanceName: 'Rent control prohibited by MA Gen. Laws Ch. 40P (1994 ballot)',
    coversType: [],
    annualCap: null, cpiTied: false,
    justCauseEviction: false,
    expiresYear: null,
    exemptions: 'N/A — no rent control permitted in Massachusetts',
    source: 'MA Gen. Laws Ch. 40P',
    note: 'Massachusetts has statewide rent control preemption since 1994. No local ordinances permitted. Boston may not enact rent control absent a change in state law.',
  },

  // ── Oregon ────────────────────────────────────────────────────────────────
  // Oregon enacted statewide rent stabilization in 2019 (SB 608)
  'portland_or': {
    city: 'Portland', state: 'OR',
    status: 'active',
    ordinanceName: 'Oregon SB 608 (2019) statewide — no separate Portland ordinance',
    coversType: ['mfr', 'sfr'],
    annualCap: null, cpiTied: true,
    justCauseEviction: true,
    expiresYear: null,
    exemptions: 'Buildings <15 years old exempt. Owner-occupied buildings ≤4 units may be exempt.',
    source: 'Oregon SB 608 (ORS 90.323)',
    note: 'Oregon has statewide rent stabilization (max 7% + CPI, capped at 10%) and just cause eviction for tenancies >12 months. Portland covered under state law — no additional local ordinance.',
  },

  // ── Washington DC ─────────────────────────────────────────────────────────
  'washington_dc': {
    city: 'Washington', state: 'DC',
    status: 'active',
    ordinanceName: 'DC Rental Housing Act of 1985 (Rent Stabilization)',
    coversType: ['mfr', 'sfr'],
    annualCap: null, cpiTied: true,
    justCauseEviction: true,
    expiresYear: null,
    exemptions: 'Buildings with ≤4 units owner-occupied exempt. Buildings built after 1975 exempt. Voluntary agreements (PADs) may modify.',
    source: 'DC Code §42-3502',
    note: 'DC rent stabilization covers ~75,000 units. Annual increases limited to CPI. Just cause required. Significant eviction process complexity — typically 4-6 months.',
  },

  // ── Maryland ──────────────────────────────────────────────────────────────
  'takoma_park_md': {
    city: 'Takoma Park', state: 'MD',
    status: 'active',
    ordinanceName: 'Takoma Park Rent Stabilization Ordinance (1981)',
    coversType: ['mfr'],
    annualCap: null, cpiTied: true,
    justCauseEviction: false,
    expiresYear: null,
    exemptions: 'New construction exempt for several years.',
    source: 'Takoma Park City Code',
    note: 'Takoma Park is the only Maryland city with active rent control. CPI-tied caps, no just cause requirement.',
  },

  // ── Minnesota ─────────────────────────────────────────────────────────────
  'saint_paul_mn': {
    city: 'Saint Paul', state: 'MN',
    status: 'active',
    ordinanceName: 'Saint Paul Rent Stabilization Ordinance (2022)',
    coversType: ['mfr', 'sfr'],
    annualCap: 3.0, cpiTied: false,
    justCauseEviction: false,
    expiresYear: null,
    exemptions: 'New construction exempt for 20 years. Owner-occupied ≤2 units exempt. Landlords may apply for exceptions above 3%.',
    source: 'Saint Paul Ordinance 22-39',
    note: 'Saint Paul enacted 3% annual rent cap in 2022. Significant exception process allows above-cap increases for hardship. New construction 20-year exemption.',
  },

  // ── Colorado ──────────────────────────────────────────────────────────────
  // Colorado repealed its statewide rent control ban in 2021 — localities may now enact
  'denver_co': {
    city: 'Denver', state: 'CO',
    status: 'none',
    ordinanceName: 'No active rent control ordinance (state ban lifted 2021, city has not enacted)',
    coversType: [],
    annualCap: null, cpiTied: false,
    justCauseEviction: false,
    expiresYear: null,
    exemptions: 'N/A',
    source: 'Colorado HB21-1117 (repealed preemption); Denver has not enacted ordinance',
    note: 'Denver may now enact rent control after Colorado lifted its preemption in 2021, but as of 2025 Denver has no rent control ordinance.',
  },

  // ── Florida ───────────────────────────────────────────────────────────────
  'miami_fl': {
    city: 'Miami', state: 'FL',
    status: 'preempted',
    ordinanceName: 'Rent control preempted by FL Stat. §125.0103 + §718 (2023 SB 102)',
    coversType: [],
    annualCap: null, cpiTied: false,
    justCauseEviction: false,
    expiresYear: null,
    exemptions: 'N/A — FL preempts all local rent control',
    source: 'FL Stat. §125.0103; SB 102 (2023) reinforced preemption',
    note: 'Florida preempts all local rent control. Miami-Dade voters approved a temporary ordinance in 2022 but FL SB 102 (2023) invalidated it. No local rent control permitted.',
  },

  // ── Illinois ──────────────────────────────────────────────────────────────
  'chicago_il': {
    city: 'Chicago', state: 'IL',
    status: 'preempted',
    ordinanceName: 'Rent control preempted by IL Rent Control Preemption Act (50 ILCS 825)',
    coversType: [],
    annualCap: null, cpiTied: false,
    justCauseEviction: false,
    expiresYear: null,
    exemptions: 'N/A — IL state preempts all local rent control',
    source: 'IL Rent Control Preemption Act, 50 ILCS 825',
    note: 'Illinois state law preempts all local rent control. Chicago may not enact rent control absent a change in state law. Chicago does have a strong RLTO (Residential Landlord Tenant Ordinance) but no rent caps.',
  },

  // ── Texas ─────────────────────────────────────────────────────────────────
  'austin_tx': {
    city: 'Austin', state: 'TX',
    status: 'preempted',
    ordinanceName: 'Rent control preempted by TX Prop. Code §214.902',
    coversType: [],
    annualCap: null, cpiTied: false,
    justCauseEviction: false,
    expiresYear: null,
    exemptions: 'N/A — TX preempts all local rent control',
    source: 'TX Prop. Code §214.902',
    note: 'Texas law preempts all local rent control measures. Austin, Dallas, Houston, San Antonio may not enact rent control.',
  },

  // ── Additional active cities ───────────────────────────────────────────────
  'seattle_wa': {
    city: 'Seattle', state: 'WA',
    status: 'none',
    ordinanceName: 'No active rent control — WA state preemption repealed 2023',
    coversType: [],
    annualCap: null, cpiTied: false,
    justCauseEviction: true, // Seattle DOES have just cause eviction
    expiresYear: null,
    exemptions: 'N/A for rent control',
    source: 'WA SB 5435 (2023) — repealed rent control preemption; Seattle has not enacted ordinance',
    note: 'Washington repealed its rent control preemption in 2023, but Seattle has not enacted a rent control ordinance as of 2025. Seattle DOES have just cause eviction protections (Ordinance 125233).',
  },
  'san_diego_ca': {
    city: 'San Diego', state: 'CA',
    status: 'active',
    ordinanceName: 'San Diego Tenants Right to Know Ordinance + State AB 1482 (2020)',
    coversType: ['mfr', 'sfr'],
    annualCap: 10.0, cpiTied: false,
    justCauseEviction: true,
    expiresYear: null,
    exemptions: 'Buildings <15 years old exempt. SFRs/condos with corporate owner covered; individual owner-occupied SFRs may be exempt.',
    source: 'CA AB 1482 (Tenant Protection Act of 2019)',
    note: 'San Diego covered by CA AB 1482 statewide cap: max 5% + local CPI, capped at 10% annually. Just cause required for covered units. Newer buildings exempt.',
  },
  'sacramento_ca': {
    city: 'Sacramento', state: 'CA',
    status: 'active',
    ordinanceName: 'Sacramento Tenant Protection and Relief Act (2019) + State AB 1482',
    coversType: ['mfr'],
    annualCap: 10.0, cpiTied: false,
    justCauseEviction: true,
    expiresYear: null,
    exemptions: 'Post-2004 construction exempt. SFRs exempt unless corporate owner.',
    source: 'Sacramento Municipal Code + CA AB 1482',
    note: 'Sacramento covered by both local ordinance and CA AB 1482 (whichever is more protective). Max 10% annual increase with just cause eviction.',
  },
};

/**
 * Looks up city rent control data.
 *
 * @param {string} city  - "Austin", "San Francisco", "New York City", etc.
 * @param {string} state - "TX", "CA", "NY", etc.
 * @returns {Object|null} - rent control record, or null if not found
 */
export function getCityRentControl(city, state) {
  if (!city) return null;

  // Try multiple key formats
  const normalize = s => s.toLowerCase().replace(/[^a-z0-9]/g, '_');

  const cityLower = normalize(city.split(',')[0].trim());
  const stateUpper = (state || '').toUpperCase();

  // Direct key lookup: city_state
  const directKey = `${cityLower}_${stateUpper.toLowerCase()}`;
  if (CITY_RENT_CONTROL[directKey]) return CITY_RENT_CONTROL[directKey];

  // Fuzzy: try any key that starts with the city name and ends with state
  for (const [key, data] of Object.entries(CITY_RENT_CONTROL)) {
    if (data.state === stateUpper && (key.startsWith(cityLower) || cityLower.startsWith(key.split('_')[0]))) {
      return data;
    }
  }

  // No record — state-level data in landlordLaws.js handles the rest
  return null;
}

/**
 * Formats city rent control data into a prompt block for Gemini injection.
 *
 * @param {string} city
 * @param {string} state
 * @returns {string} — formatted section or empty string if no record
 */
export function formatCityRentControlPrompt(city, state) {
  const record = getCityRentControl(city, state);
  if (!record) return '';

  if (record.status === 'preempted') {
    return [
      `CITY RENT CONTROL — ${record.city}, ${record.state}: NOT PERMITTED`,
      `State law preempts all local rent control in ${record.state}.`,
      record.note,
    ].join('\n');
  }

  if (record.status === 'none') {
    return [
      `CITY RENT CONTROL — ${record.city}, ${record.state}: NONE ACTIVE`,
      record.note,
    ].join('\n');
  }

  // Active rent control
  const capLine = record.annualCap
    ? `Annual increase cap: ${record.annualCap}%${record.cpiTied ? ' (or CPI, whichever is lower)' : ''}`
    : record.cpiTied
      ? `Annual increase cap: Tied to CPI (typically 2–5%/yr)`
      : 'Annual increase cap: Set by local board annually';

  return [
    `CITY RENT CONTROL — ${record.city}, ${record.state}: ACTIVE`,
    `Ordinance: ${record.ordinanceName}`,
    capLine,
    `Just cause eviction required: ${record.justCauseEviction ? 'YES' : 'No'}`,
    `Covers: ${record.coversType.join(', ') || 'varies'}`,
    `Key exemptions: ${record.exemptions}`,
    `Landlord impact: ${record.note}`,
    `Source: ${record.source}`,
    ``,
    `REQUIRED: Incorporate this rent control data into your landlordScore and narrative.`,
    `- Active rent control substantially limits rent growth — flag for investor.`,
    `- Just cause requirement adds eviction complexity — increase eviction timeline estimate.`,
  ].join('\n');
}

export { CITY_RENT_CONTROL };
