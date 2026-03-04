/**
 * lib/strRegFetcher.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Live STR regulation fetcher using NMHC preemption tracker + city gov pages.
 *
 * Sources (all free, no API key required):
 *
 *   Primary: NMHC STR Legislative Tracker
 *     - URL: https://www.nmhc.org/research-insight/legislative-tracker/str-policy-tracker/
 *     - Covers all states with preemption laws or active STR regulation
 *     - Updated by NMHC as bills pass (research team monitors continuously)
 *
 *   Secondary: Airbnb Newsroom / city licensing pages
 *     - Several cities publish their current STR permit status publicly
 *
 *   Fallback: STR_REGULATIONS static table from strDataFetcher.js
 *
 * Cache key: str_regulations (single JSON object keyed by city_state slug)
 * TTL: 90 days (STR laws change frequently — quarterly check is reasonable)
 *
 * @module strRegFetcher
 */

import { STR_REGULATIONS } from './strDataFetcher.js';

const NMHC_STR_URL = 'https://www.nmhc.org/research-insight/legislative-tracker/str-policy-tracker/';

// Known city/state government STR regulation pages — these are stable endpoints
// that cities maintain for permit compliance. Parsed for key status signals.
const CITY_STR_PAGES = [
  {
    key: 'new_york_ny',
    url: 'https://www.nyc.gov/site/specialenforcement/local-law-18/local-law-18.page',
    bannedSignals: ['Local Law 18', 'not allowed', 'prohibited', 'ban'],
    permitSignals: ['permit', 'registration', 'license'],
  },
  {
    key: 'san_francisco_ca',
    url: 'https://www.sf.gov/topics/short-term-rentals',
    bannedSignals: ['banned', 'prohibited', 'not permitted'],
    permitSignals: ['permit', 'registration', 'certificate'],
  },
  {
    key: 'los_angeles_ca',
    url: 'https://www.lamayor.org/home-sharing',
    bannedSignals: ['banned', 'prohibited'],
    permitSignals: ['registration', 'permit', 'home-sharing registration'],
  },
  {
    key: 'new_orleans_la',
    url: 'https://www.nola.gov/short-term-rentals/',
    bannedSignals: ['prohibited', 'not permitted', 'banned'],
    permitSignals: ['license', 'permit', 'registration'],
  },
  {
    key: 'miami_beach_fl',
    url: 'https://www.miamibeachfl.gov/city-hall/code-compliance/short-term-rentals/',
    bannedSignals: ['prohibited', 'illegal', 'banned'],
    permitSignals: ['license', 'permit'],
  },
];

/**
 * Fetch NMHC STR preemption tracker for state-level preemption updates.
 * Returns a Map<stateCode, { preempted: boolean, statewide: boolean }> or null.
 */
async function fetchNmhcStrStatus() {
  try {
    const r = await fetch(NMHC_STR_URL, {
      headers: { 'User-Agent': 'RentalIQ/1.0', 'Accept': 'text/html' },
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) return null;
    const html = await r.text();

    const preemptedStates = new Set();
    const bannedStates = new Set();

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

    for (const [name, code] of Object.entries(stateNameToCode)) {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const preemptPattern = new RegExp(`${escaped}.{0,200}preempt`, 'i');
      const banPattern = new RegExp(`${escaped}.{0,200}ban`, 'i');

      if (preemptPattern.test(html)) preemptedStates.add(code);
      if (banPattern.test(html)) bannedStates.add(code);
    }

    if (preemptedStates.size === 0 && bannedStates.size === 0) return null;

    return {
      preemptedStates,
      bannedStates,
      asOf: new Date().toISOString().slice(0, 7),
    };
  } catch (err) {
    console.warn('[strRegFetcher] NMHC fetch failed:', err.message);
    return null;
  }
}

/**
 * Check a single city's official STR page for current status.
 * Returns { status: 'banned'|'restricted'|'permissive', permitRequired: boolean } or null.
 */
async function fetchCityStrStatus(cityConfig) {
  try {
    const r = await fetch(cityConfig.url, {
      headers: { 'User-Agent': 'RentalIQ/1.0', 'Accept': 'text/html' },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return null;
    const html = await r.text().then(t => t.slice(0, 50000)); // first 50k chars only

    const hasBan = cityConfig.bannedSignals.some(s =>
      html.toLowerCase().includes(s.toLowerCase())
    );
    const hasPermit = cityConfig.permitSignals.some(s =>
      html.toLowerCase().includes(s.toLowerCase())
    );

    if (hasBan) return { status: 'banned', permitRequired: false, source: cityConfig.url };
    if (hasPermit) return { status: 'restricted', permitRequired: true, source: cityConfig.url };

    return null; // couldn't determine
  } catch {
    return null;
  }
}

/**
 * Fetches updated STR regulation data.
 * Merges live NMHC state preemption data + city gov page checks
 * with the existing static STR_REGULATIONS baseline.
 *
 * @returns {Promise<Object|null>} Updated STR regulations keyed by city_state slug, or null
 */
export async function fetchStrRegulations() {
  try {
    const updated = { ...STR_REGULATIONS };
    let liveUpdates = 0;

    // 1. Check NMHC for state-level preemption changes
    const nmhcData = await fetchNmhcStrStatus();
    if (nmhcData) {
      // If a state is now preempted, mark all its cities as permissive
      for (const [key, reg] of Object.entries(updated)) {
        const stateCode = key.split('_').pop().toUpperCase().slice(0, 2);
        if (nmhcData.preemptedStates.has(stateCode) && reg.status !== 'banned') {
          updated[key] = {
            ...reg,
            status: 'permissive',
            _source: 'NMHC STR Tracker',
            _asOf: nmhcData.asOf,
          };
          liveUpdates++;
        }
      }
    }

    // 2. Check individual city pages for high-change cities
    const cityResults = await Promise.allSettled(
      CITY_STR_PAGES.map(async (cityConfig) => {
        const status = await fetchCityStrStatus(cityConfig);
        return { key: cityConfig.key, status };
      })
    );

    for (const result of cityResults) {
      if (result.status !== 'fulfilled' || !result.value.status) continue;
      const { key, status } = result.value;
      if (!updated[key]) continue;

      // Only update if there's a material change (e.g. went from restricted to banned)
      if (updated[key].status !== status.status) {
        updated[key] = {
          ...updated[key],
          status: status.status,
          permitRequired: status.permitRequired,
          _source: status.source,
          _asOf: new Date().toISOString().slice(0, 7),
        };
        liveUpdates++;
      }
    }

    console.log(`[strRegFetcher] Made ${liveUpdates} live updates to STR regulations`);

    return {
      ...updated,
      _fetchedAt: new Date().toISOString(),
      _source: `Static baseline + NMHC + city pages (${liveUpdates} live updates)`,
    };

  } catch (err) {
    console.warn('[strRegFetcher] Fatal error:', err.message);
    return null;
  }
}

// Re-export the static baseline for use as fallback
export { STR_REGULATIONS };
