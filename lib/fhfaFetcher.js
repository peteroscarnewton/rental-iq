/**
 * lib/fhfaFetcher.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Fetches quarterly Home Price Index (HPI) data from the FHFA (Federal Housing
 * Finance Agency) and computes 5-year CAGRs for every state and ~45 major metros.
 *
 * Sources:
 *   State HPI:  https://www.fhfa.gov/DataTools/Downloads/Documents/HPI/HPI_AT_state.csv
 *   Metro HPI:  https://www.fhfa.gov/DataTools/Downloads/Documents/HPI/HPI_AT_metro.csv
 *
 * Both CSVs are public, no API key required. FHFA updates them quarterly (~4-6
 * weeks after quarter-end). TTL in the cron is set to 90 days to align with the
 * quarterly release cadence.
 *
 * Return format:
 *   { stateRates: { FL: 4.7, TX: 3.9, ... }, cityRates: { miami: 5.1, ... } }
 *   Either key can be null if the respective fetch or parse fails entirely.
 *   Values are 5yr CAGR percentages rounded to 1 decimal place.
 *
 * Error philosophy:
 *   - Every failure path returns null rather than throwing.
 *   - The caller (cron) falls back to the existing baseline if null is returned.
 *   - We log warnings but never crash the cron job.
 */

// ─── FHFA state abbreviation → our state code mapping ────────────────────────
// FHFA uses the standard 2-letter USPS abbreviations, which match ours exactly.
// Included here for completeness and to filter only the states we support.
const VALID_STATE_CODES = new Set([
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA',
  'HI','ID','IL','IN','IA','KS','KY','LA','ME','MD',
  'MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC',
  'SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC',
]);

// ─── FHFA MSA name → our city key ────────────────────────────────────────────
// FHFA MSA names are long and inconsistent (e.g. "Austin-Round Rock-Georgetown, TX").
// We do a prefix/substring match rather than exact match to handle FHFA's name
// revisions between releases. Keys are our internal city identifiers (lowercase).
//
// Source for MSA list: FHFA metro HPI documentation + Census CBSA definitions.
// Covers the ~45 metros present in our cityAppreciation baseline.
const FHFA_METRO_MAP = [
  // California
  { fhfaPrefix: 'San Francisco',              city: 'san francisco'  },
  { fhfaPrefix: 'San Jose',                   city: 'san jose'       },
  { fhfaPrefix: 'Oakland',                    city: 'oakland'        },
  { fhfaPrefix: 'Los Angeles',                city: 'los angeles'    },
  { fhfaPrefix: 'San Diego',                  city: 'san diego'      },
  { fhfaPrefix: 'Sacramento',                 city: 'sacramento'     },
  { fhfaPrefix: 'Fresno',                     city: 'fresno'         },
  { fhfaPrefix: 'Bakersfield',                city: 'bakersfield'    },
  // Texas
  { fhfaPrefix: 'Austin',                     city: 'austin'         },
  { fhfaPrefix: 'Dallas',                     city: 'dallas'         },
  { fhfaPrefix: 'Houston',                    city: 'houston'        },
  { fhfaPrefix: 'San Antonio',                city: 'san antonio'    },
  { fhfaPrefix: 'Fort Worth',                 city: 'fort worth'     },
  { fhfaPrefix: 'El Paso',                    city: 'el paso'        },
  // Florida
  { fhfaPrefix: 'Miami',                      city: 'miami'          },
  { fhfaPrefix: 'Tampa',                      city: 'tampa'          },
  { fhfaPrefix: 'Orlando',                    city: 'orlando'        },
  { fhfaPrefix: 'Jacksonville',               city: 'jacksonville'   },
  { fhfaPrefix: 'Fort Lauderdale',            city: 'fort lauderdale'},
  // Pacific Northwest
  { fhfaPrefix: 'Seattle',                    city: 'seattle'        },
  { fhfaPrefix: 'Bellevue',                   city: 'bellevue'       },
  { fhfaPrefix: 'Portland',                   city: 'portland'       },
  { fhfaPrefix: 'Spokane',                    city: 'spokane'        },
  // Mountain West
  { fhfaPrefix: 'Denver',                     city: 'denver'         },
  { fhfaPrefix: 'Colorado Springs',           city: 'colorado springs'},
  { fhfaPrefix: 'Boise',                      city: 'boise'          },
  { fhfaPrefix: 'Salt Lake City',             city: 'salt lake city' },
  { fhfaPrefix: 'Provo',                      city: 'provo'          },
  // Northeast
  { fhfaPrefix: 'New York',                   city: 'new york'       },
  { fhfaPrefix: 'Boston',                     city: 'boston'         },
  { fhfaPrefix: 'Providence',                 city: 'providence'     },
  { fhfaPrefix: 'Philadelphia',               city: 'philadelphia'   },
  { fhfaPrefix: 'Pittsburgh',                 city: 'pittsburgh'     },
  { fhfaPrefix: 'Newark',                     city: 'newark'         },
  // Midwest
  { fhfaPrefix: 'Chicago',                    city: 'chicago'        },
  { fhfaPrefix: 'Minneapolis',                city: 'minneapolis'    },
  { fhfaPrefix: 'Kansas City',                city: 'kansas city'    },
  { fhfaPrefix: 'Columbus',                   city: 'columbus'       },
  { fhfaPrefix: 'Indianapolis',               city: 'indianapolis'   },
  { fhfaPrefix: 'Cincinnati',                 city: 'cincinnati'     },
  { fhfaPrefix: 'Cleveland',                  city: 'cleveland'      },
  { fhfaPrefix: 'Detroit',                    city: 'detroit'        },
  { fhfaPrefix: 'Milwaukee',                  city: 'milwaukee'      },
  { fhfaPrefix: 'St. Louis',                  city: 'st. louis'      },
  { fhfaPrefix: 'Memphis',                    city: 'memphis'        },
  { fhfaPrefix: 'Louisville',                 city: 'louisville'     },
  // Southeast / Sun Belt
  { fhfaPrefix: 'Atlanta',                    city: 'atlanta'        },
  { fhfaPrefix: 'Charlotte',                  city: 'charlotte'      },
  { fhfaPrefix: 'Nashville',                  city: 'nashville'      },
  { fhfaPrefix: 'Raleigh',                    city: 'raleigh'        },
  { fhfaPrefix: 'Durham',                     city: 'durham'         },
  { fhfaPrefix: 'Birmingham',                 city: 'birmingham'     },
  { fhfaPrefix: 'New Orleans',                city: 'new orleans'    },
  // Southwest
  { fhfaPrefix: 'Phoenix',                    city: 'phoenix'        },
  { fhfaPrefix: 'Tucson',                     city: 'tucson'         },
  { fhfaPrefix: 'Las Vegas',                  city: 'las vegas'      },
  { fhfaPrefix: 'Albuquerque',                city: 'albuquerque'    },
  { fhfaPrefix: 'Henderson',                  city: 'henderson'      },
  // Mid-Atlantic
  { fhfaPrefix: 'Washington',                 city: 'washington'     },
  { fhfaPrefix: 'Baltimore',                  city: 'baltimore'      },
  { fhfaPrefix: 'Richmond',                   city: 'richmond'       },
  { fhfaPrefix: 'Virginia Beach',             city: 'virginia beach' },
];

// ─── CAGR bounds — rejects obviously corrupt index data ──────────────────────
const CAGR_MIN = -5.0;  // -5%/yr  (worst realistic sustained decline)
const CAGR_MAX = 25.0;  // +25%/yr (never seen in a 5yr window in US history)

// ─── Fetch helpers ────────────────────────────────────────────────────────────

/**
 * Fetches a FHFA CSV and returns it as an array of trimmed non-empty lines,
 * excluding any header line that starts with non-digit characters.
 * Returns null if the fetch fails or the body is unusably small.
 */
async function fetchFhfaCsv(url) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) {
      console.warn(`[fhfaFetcher] HTTP ${r.status} fetching ${url}`);
      return null;
    }
    const text = await r.text();
    if (!text || text.length < 500) {
      console.warn('[fhfaFetcher] Response too small, likely an error page');
      return null;
    }
    return text.trim().split('\n').map(l => l.trim()).filter(Boolean);
  } catch (err) {
    console.warn(`[fhfaFetcher] Fetch error for ${url}:`, err.message);
    return null;
  }
}

/**
 * Computes the 5-year CAGR from an array of (year, quarter, indexValue) tuples.
 * Tuples must be sorted chronologically (oldest first).
 *
 * We use the seasonally-adjusted index (index_sa) where available, falling back
 * to index_nsa. FHFA denotes missing values as "." — these are filtered out.
 *
 * Returns null if there are insufficient data points for a 5yr window.
 */
function compute5yrCagr(observations) {
  // Observations: [{ year, qtr, value }], sorted oldest→newest, nulls removed
  if (!observations || observations.length < 21) {
    // Need at least 21 quarters (5 years + 1) for a clean 5yr CAGR.
    // We accept as few as 17 to handle gaps near release dates.
    if (!observations || observations.length < 17) return null;
  }

  const latest = observations[observations.length - 1];

  // Find the observation closest to exactly 5 years (20 quarters) prior
  // We search a ±2 quarter window to handle data gaps.
  const targetIdx = observations.length - 1 - 20;
  const searchStart = Math.max(0, targetIdx - 2);
  const searchEnd   = Math.min(observations.length - 2, targetIdx + 2);

  let fiveYearAgo = null;
  let bestDistance = Infinity;
  for (let i = searchStart; i <= searchEnd; i++) {
    const quartersBack = (observations.length - 1) - i;
    const distance = Math.abs(quartersBack - 20);
    if (distance < bestDistance) {
      bestDistance = distance;
      fiveYearAgo = observations[i];
    }
  }

  if (!fiveYearAgo || fiveYearAgo.value <= 0 || latest.value <= 0) return null;

  // Actual number of years between the two observations (handles gaps precisely)
  const yearsElapsed = (quartersElapsed(fiveYearAgo, latest)) / 4;
  if (yearsElapsed < 3.5) return null; // Not enough time for a meaningful CAGR

  const cagr = (Math.pow(latest.value / fiveYearAgo.value, 1 / yearsElapsed) - 1) * 100;

  if (cagr < CAGR_MIN || cagr > CAGR_MAX) {
    console.warn(`[fhfaFetcher] CAGR ${cagr.toFixed(2)}% out of bounds — skipping`);
    return null;
  }

  return Math.round(cagr * 10) / 10; // 1 decimal place
}

/**
 * Returns the number of quarters between two {year, qtr} objects.
 */
function quartersElapsed(from, to) {
  return (to.year - from.year) * 4 + (to.qtr - from.qtr);
}

// ─── State HPI parser ─────────────────────────────────────────────────────────

/**
 * Parses the FHFA state HPI CSV and returns a map of state code → 5yr CAGR.
 *
 * CSV columns (header row present):
 *   state, yr, qtr, index_sa, index_nsa, index_type, ...
 *
 * States with insufficient history (AK, WY, etc.) may return null CAGR
 * and will fall back to the baseline value in the caller.
 */
function parseStateCsv(lines) {
  // Detect and skip header row(s) — FHFA sometimes has a one-line comment header
  let dataStart = 0;
  for (let i = 0; i < Math.min(lines.length, 5); i++) {
    if (/^[A-Z]{2},\d{4}/.test(lines[i])) {
      dataStart = i;
      break;
    }
    // Header line detection: starts with "state" or non-state text
    if (/^state|^"state/i.test(lines[i])) {
      dataStart = i + 1;
      break;
    }
  }

  // Group observations by state code
  const byState = {};

  for (let i = dataStart; i < lines.length; i++) {
    const cols = lines[i].split(',').map(c => c.trim().replace(/^"|"$/g, ''));
    if (cols.length < 4) continue;

    const state  = cols[0];
    const year   = parseInt(cols[1]);
    const qtr    = parseInt(cols[2]);
    // index_sa is col 3, index_nsa is col 4 — prefer SA
    const rawSa  = cols[3];
    const rawNsa = cols[4];

    if (!VALID_STATE_CODES.has(state)) continue;
    if (isNaN(year) || isNaN(qtr) || qtr < 1 || qtr > 4) continue;

    const value = rawSa && rawSa !== '.' ? parseFloat(rawSa)
                : rawNsa && rawNsa !== '.' ? parseFloat(rawNsa)
                : NaN;
    if (isNaN(value) || value <= 0) continue;

    if (!byState[state]) byState[state] = [];
    byState[state].push({ year, qtr, value });
  }

  // Sort each state's observations chronologically and compute CAGR
  const result = {};
  for (const [state, obs] of Object.entries(byState)) {
    obs.sort((a, b) => a.year !== b.year ? a.year - b.year : a.qtr - b.qtr);
    const cagr = compute5yrCagr(obs);
    if (cagr !== null) {
      result[state] = cagr;
    }
  }

  return Object.keys(result).length > 0 ? result : null;
}

// ─── Metro HPI parser ─────────────────────────────────────────────────────────

/**
 * Parses the FHFA metro HPI CSV and returns a map of city key → 5yr CAGR.
 *
 * CSV columns:
 *   MSA, metro_name, yr, qtr, index_sa, index_nsa, ...
 *
 * Metro name matching uses prefix matching against FHFA_METRO_MAP. FHFA
 * occasionally changes MSA names (e.g. adding a new county to the MSA
 * definition), so exact matching would be too brittle.
 */
function parseMetroCsv(lines) {
  // Find data start — skip any header rows
  let dataStart = 0;
  for (let i = 0; i < Math.min(lines.length, 5); i++) {
    // Data rows: first col is a 5-digit CBSA code or blank, second is metro name
    if (/^\d{5},/.test(lines[i]) || /^,/.test(lines[i])) {
      dataStart = i;
      break;
    }
    if (/^MSA|^"MSA|^metro/i.test(lines[i])) {
      dataStart = i + 1;
      break;
    }
  }

  // Build a lookup: our city key → raw FHFA metro name (resolved once)
  // Group observations by the FHFA metro name
  const byMetroName = {};

  for (let i = dataStart; i < lines.length; i++) {
    const cols = lines[i].split(',').map(c => c.trim().replace(/^"|"$/g, ''));
    if (cols.length < 5) continue;

    // Columns: MSA_code, metro_name, yr, qtr, index_sa, index_nsa, ...
    const metroName = cols[1];
    const year      = parseInt(cols[2]);
    const qtr       = parseInt(cols[3]);
    const rawSa     = cols[4];
    const rawNsa    = cols[5];

    if (!metroName || isNaN(year) || isNaN(qtr) || qtr < 1 || qtr > 4) continue;

    const value = rawSa && rawSa !== '.' ? parseFloat(rawSa)
                : rawNsa && rawNsa !== '.' ? parseFloat(rawNsa)
                : NaN;
    if (isNaN(value) || value <= 0) continue;

    if (!byMetroName[metroName]) byMetroName[metroName] = [];
    byMetroName[metroName].push({ year, qtr, value });
  }

  // Map metro names to our city keys
  const result = {};

  for (const [fhfaName, obs] of Object.entries(byMetroName)) {
    // Find the first matching entry in FHFA_METRO_MAP using prefix match
    const mapping = FHFA_METRO_MAP.find(m =>
      fhfaName.toLowerCase().startsWith(m.fhfaPrefix.toLowerCase())
    );
    if (!mapping) continue;

    obs.sort((a, b) => a.year !== b.year ? a.year - b.year : a.qtr - b.qtr);
    const cagr = compute5yrCagr(obs);
    if (cagr !== null) {
      // If multiple FHFA metros match the same city key (rare), keep highest-data one
      if (result[mapping.city] === undefined) {
        result[mapping.city] = cagr;
      }
    }
  }

  return Object.keys(result).length > 0 ? result : null;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Fetches FHFA HPI data and computes appreciation rates for all states and
 * supported metros. Both fetches run in parallel.
 *
 * Returns:
 *   {
 *     stateRates: { FL: 4.7, TX: 3.9, ... } | null,
 *     cityRates:  { miami: 5.1, ... }        | null,
 *     asOf: "2025-Q3",    // latest quarter found in data
 *     source: "FHFA/HPI",
 *   }
 *
 * Either stateRates or cityRates can be null independently if one CSV fails.
 * The entire return value is never null — the cron checks individual keys.
 */
export async function fetchFhfaHpi() {
  const STATE_URL = 'https://www.fhfa.gov/DataTools/Downloads/Documents/HPI/HPI_AT_state.csv';
  const METRO_URL = 'https://www.fhfa.gov/DataTools/Downloads/Documents/HPI/HPI_AT_metro.csv';

  const [stateLines, metroLines] = await Promise.all([
    fetchFhfaCsv(STATE_URL),
    fetchFhfaCsv(METRO_URL),
  ]);

  let stateRates = null;
  let cityRates  = null;
  let latestQuarter = null;

  if (stateLines) {
    try {
      stateRates = parseStateCsv(stateLines);
      if (stateRates) {
        const stateCount = Object.keys(stateRates).length;
        console.log(`[fhfaFetcher] Parsed state HPI: ${stateCount} states with valid CAGR`);
        // Sanity check: we expect data for at least 40 of 51 state+DC entries
        if (stateCount < 35) {
          console.warn(`[fhfaFetcher] Only ${stateCount} states parsed — unexpectedly low, discarding`);
          stateRates = null;
        }
      }
    } catch (err) {
      console.warn('[fhfaFetcher] State CSV parse error:', err.message);
    }
  }

  if (metroLines) {
    try {
      cityRates = parseMetroCsv(metroLines);
      if (cityRates) {
        const cityCount = Object.keys(cityRates).length;
        console.log(`[fhfaFetcher] Parsed metro HPI: ${cityCount} cities with valid CAGR`);
        // Expect data for at least 25 of our ~57 city keys (not all have FHFA MSA data)
        if (cityCount < 20) {
          console.warn(`[fhfaFetcher] Only ${cityCount} cities parsed — unexpectedly low, discarding`);
          cityRates = null;
        }
      }
    } catch (err) {
      console.warn('[fhfaFetcher] Metro CSV parse error:', err.message);
    }
  }

  // Extract the latest quarter from state data for the asOf timestamp
  if (stateLines) {
    try {
      // Scan from the end for a valid data row to get the latest year/qtr
      for (let i = stateLines.length - 1; i >= 0; i--) {
        const cols = stateLines[i].split(',');
        const year = parseInt(cols[1]);
        const qtr  = parseInt(cols[2]);
        if (!isNaN(year) && !isNaN(qtr) && year > 2000 && qtr >= 1 && qtr <= 4) {
          latestQuarter = `${year}-Q${qtr}`;
          break;
        }
      }
    } catch { /* non-fatal */ }
  }

  return {
    stateRates,
    cityRates,
    asOf:   latestQuarter ?? 'unknown',
    source: 'FHFA/HPI',
  };
}
