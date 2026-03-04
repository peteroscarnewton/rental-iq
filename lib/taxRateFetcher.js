/**
 * lib/taxRateFetcher.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Live property tax rate fetcher using Census ACS 5-Year Estimates.
 *
 * Sources (all free, no API key required):
 *
 *   Primary: Census ACS 5-Year — Table B25103 + B25077
 *     - B25103_001E: Aggregate real estate taxes paid (annual, owner-occupied)
 *     - B25025_002E: Total owner-occupied housing units
 *     - B25077_001E: Median value of owner-occupied units
 *     - Endpoint: https://api.census.gov/data/{year}/acs/acs5
 *     - Updated annually (~December for prior year)
 *     - Formula: effective_rate = (B25103_001E / B25025_002E) / B25077_001E * 100
 *
 *   Fallback: Tax Foundation 2024 calibrated table (never breaks)
 *
 * Why not Tax Foundation CSV?
 *   Their CSV URL changes annually (date-stamped). Census ACS has a stable
 *   endpoint that works every year — just increment the year parameter.
 *
 * Cache key: state_tax_rates
 * TTL: 365 days (ACS is annual)
 *
 * @module taxRateFetcher
 */

// ─── Calibrated static fallback (Tax Foundation 2024 + Lincoln Institute) ─────
export const TAX_RATE_BASELINE = {
  AL:0.41,AK:1.04,AZ:0.63,AR:0.64,CA:0.75,CO:0.51,CT:1.79,DE:0.57,FL:0.91,GA:0.91,
  HI:0.30,ID:0.47,IL:2.08,IN:0.85,IA:1.57,KS:1.41,KY:0.86,LA:0.56,ME:1.09,MD:1.09,
  MA:1.17,MI:1.32,MN:1.12,MS:0.78,MO:1.01,MT:0.74,NE:1.73,NV:0.55,NH:1.89,NJ:2.23,
  NM:0.80,NY:1.73,NC:0.82,ND:0.98,OH:1.56,OK:0.90,OR:0.97,PA:1.49,RI:1.53,SC:0.57,
  SD:1.14,TN:0.67,TX:1.63,UT:0.58,VT:1.83,VA:0.82,WA:0.98,WV:0.59,WI:1.61,WY:0.61,DC:0.55,
  _asOf: '2024',
  _source: 'Tax Foundation 2024 + Lincoln Institute (baseline)',
};

// Census FIPS state codes → 2-letter abbreviations
const FIPS_TO_STATE = {
  '01':'AL','02':'AK','04':'AZ','05':'AR','06':'CA','08':'CO','09':'CT','10':'DE',
  '11':'DC','12':'FL','13':'GA','15':'HI','16':'ID','17':'IL','18':'IN','19':'IA',
  '20':'KS','21':'KY','22':'LA','23':'ME','24':'MD','25':'MA','26':'MI','27':'MN',
  '28':'MS','29':'MO','30':'MT','31':'NE','32':'NV','33':'NH','34':'NJ','35':'NM',
  '36':'NY','37':'NC','38':'ND','39':'OH','40':'OK','41':'OR','42':'PA','44':'RI',
  '45':'SC','46':'SD','47':'TN','48':'TX','49':'UT','50':'VT','51':'VA','53':'WA',
  '54':'WV','55':'WI','56':'WY',
};

/**
 * Fetches the most recent Census ACS 5-year property tax rates for all states.
 * Tries the most recent 3 years in descending order (ACS releases ~Dec each year).
 *
 * @returns {Promise<Object|null>} State tax rates keyed by state code, or null on failure
 */
export async function fetchStateTaxRates() {
  // Try the last 3 years of ACS — whichever is available
  const currentYear = new Date().getFullYear();
  const yearsToTry = [currentYear - 1, currentYear - 2, currentYear - 3];

  for (const year of yearsToTry) {
    try {
      const url = `https://api.census.gov/data/${year}/acs/acs5?get=NAME,B25103_001E,B25025_002E,B25077_001E&for=state:*`;
      const r = await fetch(url, {
        headers: { 'User-Agent': 'RentalIQ/1.0 (investment analysis research)' },
        signal: AbortSignal.timeout(12000),
      });
      if (!r.ok) continue;

      const rows = await r.json();
      if (!Array.isArray(rows) || rows.length < 10) continue;

      // First row is headers: [NAME, B25103_001E, B25025_002E, B25077_001E, state]
      const header = rows[0];
      const aggTaxIdx   = header.indexOf('B25103_001E');
      const unitCountIdx= header.indexOf('B25025_002E');
      const medValueIdx = header.indexOf('B25077_001E');
      const stateIdx    = header.indexOf('state');

      if (aggTaxIdx < 0 || unitCountIdx < 0 || medValueIdx < 0 || stateIdx < 0) continue;

      const rates = {};
      let parsed = 0;

      for (const row of rows.slice(1)) {
        const fips      = row[stateIdx];
        const stateCode = FIPS_TO_STATE[fips];
        if (!stateCode) continue;

        const aggTax   = parseFloat(row[aggTaxIdx]);
        const units    = parseFloat(row[unitCountIdx]);
        const medValue = parseFloat(row[medValueIdx]);

        if (isNaN(aggTax) || isNaN(units) || isNaN(medValue)) continue;
        if (units < 1 || medValue < 1) continue;

        // Effective rate = (average annual tax) / (median home value) * 100
        const avgAnnualTax = aggTax / units;
        const effectiveRate = (avgAnnualTax / medValue) * 100;

        // Sanity check: effective rate should be 0.2% – 4.0%
        if (effectiveRate < 0.2 || effectiveRate > 4.0) continue;

        rates[stateCode] = Math.round(effectiveRate * 100) / 100; // round to 0.01%
        parsed++;
      }

      // Need at least 45 states to trust this
      if (parsed < 45) continue;

      console.log(`[taxRateFetcher] Fetched ${parsed} state tax rates from Census ACS ${year}`);
      return {
        ...rates,
        _asOf: String(year),
        _source: `Census ACS 5-Year ${year} (B25103/B25077)`,
        _fetchedAt: new Date().toISOString(),
      };

    } catch (err) {
      console.warn(`[taxRateFetcher] Census ACS ${year} failed:`, err.message);
    }
  }

  console.warn('[taxRateFetcher] All Census ACS years failed — will use baseline');
  return null;
}
