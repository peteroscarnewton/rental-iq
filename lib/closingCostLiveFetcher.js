/**
 * lib/closingCostLiveFetcher.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Live state closing cost fetcher using Tax Foundation transfer tax data.
 *
 * Sources (all free, no API key required):
 *
 *   Primary: Tax Foundation — State Transfer Tax Rates
 *     - URL: https://taxfoundation.org/data/all/state/real-estate-transfer-taxes-by-state/
 *     - Publishes state real estate transfer tax rates annually
 *     - We extract the rate table and add fixed closing costs (~1.5%) to get total
 *
 *   Secondary: CFPB ClosingCorp page (annual survey PDF — HTML summary available)
 *     - URL: https://www.consumerfinance.gov/data-research/
 *     - Mortgage data includes average closing costs by state
 *
 *   Fallback: Static CLOSING_COSTS_BY_STATE table from benchmarkFetcher.js
 *
 * Cache key: state_closing_costs
 * TTL: 365 days (transfer tax rates change infrequently — usually during legislative sessions)
 *
 * @module closingCostLiveFetcher
 */

// Fixed closing costs baseline (per-state, excluding transfer taxes)
// These are title insurance, attorney fees, recording fees, lender fees
// that don't change with transfer tax legislation
const FIXED_CLOSING_COSTS = {
  // High attorney-fee states (attorney required by law)
  NY: 1.8, NJ: 1.7, CT: 1.5, MA: 1.5, ME: 1.4, VT: 1.4, NH: 1.3, RI: 1.3,
  GA: 1.2, SC: 1.2, TN: 1.2, KY: 1.1, WV: 1.1,
  // High title insurance markets
  TX: 0.9, FL: 0.9, IL: 0.9,
  // Standard markets
  _default: 0.9,
};

const TAX_FOUNDATION_URL = 'https://taxfoundation.org/data/all/state/real-estate-transfer-taxes-by-state/';

/**
 * Parse Tax Foundation transfer tax page for current state rates.
 * Returns Map<stateCode, transferTaxPct> or null.
 */
async function fetchTransferTaxRates() {
  try {
    const r = await fetch(TAX_FOUNDATION_URL, {
      headers: { 'User-Agent': 'RentalIQ/1.0', 'Accept': 'text/html' },
      signal: AbortSignal.timeout(12000),
    });
    if (!r.ok) return null;
    const html = await r.text();

    const rates = new Map();
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

    // Tax Foundation tables typically show state + rate in % format
    for (const [name, code] of Object.entries(stateNameToCode)) {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // Look for state name followed by a percentage rate within 150 chars
      const pattern = new RegExp(`${escaped}[^0-9%]{0,100}(\\d+\\.?\\d*)\\s*%`, 'i');
      const match = html.match(pattern);
      if (!match) continue;

      const rate = parseFloat(match[1]);
      if (!isNaN(rate) && rate >= 0 && rate <= 5.0) {
        rates.set(code, rate);
      }
    }

    // Also check for "no transfer tax" states explicitly
    const noTaxPattern = /no (real estate |property )?transfer tax/gi;
    const noTaxMatches = html.matchAll(/([A-Z][a-z]+(?: [A-Z][a-z]+)*)[^.]*no (real estate |property )?transfer tax/gi);
    for (const match of noTaxMatches) {
      const stateName = match[1];
      const code = stateNameToCode[stateName];
      if (code && !rates.has(code)) {
        rates.set(code, 0);
      }
    }

    if (rates.size < 20) return null; // didn't extract enough
    return { rates, asOf: new Date().toISOString().slice(0, 7) };
  } catch (err) {
    console.warn('[closingCostLiveFetcher] Tax Foundation fetch failed:', err.message);
    return null;
  }
}

/**
 * Computes closing cost percentages by combining transfer tax rates
 * with fixed closing cost baselines.
 *
 * @returns {Promise<Object|null>} State closing costs as % of price, or null on failure
 */
export async function fetchClosingCostLive() {
  try {
    const transferTaxData = await fetchTransferTaxRates();
    if (!transferTaxData || transferTaxData.rates.size < 20) return null;

    const result = {};
    const ALL_STATES = ['AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID',
      'IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV',
      'NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT',
      'VT','VA','WA','WV','WI','WY'];

    for (const state of ALL_STATES) {
      const transferTax = transferTaxData.rates.get(state) ?? null;
      const fixedCosts  = FIXED_CLOSING_COSTS[state] ?? FIXED_CLOSING_COSTS._default;

      if (transferTax !== null) {
        // Convert transfer tax % to buyer-side cost
        // Typically buyer pays 50-100% of transfer tax depending on state custom
        // We use 0.6 as average buyer share
        const buyerTransferTax = transferTax * 0.6;
        result[state] = Math.round((fixedCosts + buyerTransferTax) * 10) / 10;
      }
      // If no transfer tax data, skip — will fall through to static baseline
    }

    if (Object.keys(result).length < 30) return null;

    result._nationalAvg = Object.values(result)
      .filter(v => typeof v === 'number')
      .reduce((a, b, _, arr) => a + b / arr.length, 0);
    result._nationalAvg = Math.round(result._nationalAvg * 10) / 10;
    result.asOf  = transferTaxData.asOf;
    result.source = `Tax Foundation transfer tax (${transferTaxData.rates.size} states) + fixed costs`;

    console.log(`[closingCostLiveFetcher] Computed closing costs for ${Object.keys(result).filter(k => !k.startsWith('_')).length} states`);
    return result;
  } catch (err) {
    console.warn('[closingCostLiveFetcher] Error:', err.message);
    return null;
  }
}
