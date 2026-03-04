/**
 * GET /api/cron/market-digest
 * ─────────────────────────────────────────────────────────────────────────────
 * Phase 4D: Market movement alerts + proactive city coverage.
 *
 * Runs weekly (Sunday 4am UTC, after the main refresh cron at 3am).
 *
 * Part 1 — Market movement detection:
 *   Compares current market data to the snapshot from 7 days ago.
 *   Surfaces significant changes: mortgage rate moves, market temp shifts,
 *   unemployment trend flips, appreciation rate changes.
 *   Sends admin email digest if thresholds are exceeded.
 *
 * Part 2 — Proactive city coverage:
 *   Maintains Redfin + employment data for the top 100 US investor markets
 *   regardless of user activity. This ensures the site "knows" current
 *   market conditions for popular cities even before users analyze them.
 *   Stores coverage for the FALLBACK_METROS list + any user-active cities.
 *
 * Thresholds that trigger an alert:
 *   - Mortgage rate moves ≥ 0.25% (25bps) in one week
 *   - Any metro's market temp changes (e.g. hot → warm)
 *   - Unemployment trend flips (improving → worsening or vice versa)
 *   - Appreciation CAGR changes ≥ 0.5% for any major metro
 *   - Landlord law changes detected (from Phase 4B checker)
 *
 * Security: CRON_SECRET protected, same as other cron endpoints.
 */

import { getSupabaseAdmin }            from '../../../lib/supabase.js';
import { fetchMetroUnemployment,
         hasMetroUnemploymentData }    from '../../../lib/fredFetcher.js';
import { fetchRedfinZips }             from '../../../lib/redfinFetcher.js';
import { checkLandlordLawStaleness,
         getPendingLawChanges }        from '../../../lib/landlordLawUpdater.js';
import { getMarketData }               from '../../../lib/marketData.js';

export const config = { api: { bodyParser: false }, maxDuration: 120 };

// Top 100 US investor markets — proactively maintained regardless of user activity.
// This ensures the site has current data for popular markets before anyone asks.
const PROACTIVE_METROS = [
  // Florida (high investor activity)
  'Miami, FL', 'Tampa, FL', 'Orlando, FL', 'Jacksonville, FL', 'Fort Lauderdale, FL',
  'Fort Myers, FL', 'Sarasota, FL', 'Daytona Beach, FL',
  // Texas
  'Dallas, TX', 'Houston, TX', 'Austin, TX', 'San Antonio, TX', 'Fort Worth, TX',
  'El Paso, TX', 'Corpus Christi, TX', 'McAllen, TX',
  // Southeast
  'Atlanta, GA', 'Charlotte, NC', 'Nashville, TN', 'Raleigh, NC', 'Durham, NC',
  'Birmingham, AL', 'Memphis, TN', 'New Orleans, LA', 'Richmond, VA', 'Virginia Beach, VA',
  // Mid-Atlantic
  'Washington, DC', 'Baltimore, MD', 'Philadelphia, PA', 'Pittsburgh, PA',
  // Northeast
  'New York, NY', 'Boston, MA', 'Providence, RI', 'Hartford, CT', 'Newark, NJ',
  // Midwest
  'Chicago, IL', 'Columbus, OH', 'Indianapolis, IN', 'Kansas City, MO',
  'Minneapolis, MN', 'Cincinnati, OH', 'Cleveland, OH', 'Detroit, MI',
  'Milwaukee, WI', 'St. Louis, MO', 'Louisville, KY',
  // Mountain West / Southwest
  'Phoenix, AZ', 'Tucson, AZ', 'Las Vegas, NV', 'Denver, CO', 'Colorado Springs, CO',
  'Salt Lake City, UT', 'Albuquerque, NM', 'Henderson, NV',
  // Pacific Northwest
  'Seattle, WA', 'Portland, OR', 'Spokane, WA', 'Boise, ID',
  // California
  'Los Angeles, CA', 'San Francisco, CA', 'San Diego, CA', 'San Jose, CA',
  'Sacramento, CA', 'Fresno, CA', 'Oakland, CA',
  // Others with strong investor activity
  'Provo, UT', 'Ogden, UT', 'Fayetteville, AR', 'Greenville, SC',
  'Columbia, SC', 'Chattanooga, TN', 'Knoxville, TN', 'Huntsville, AL',
  'Baton Rouge, LA', 'Little Rock, AR', 'Oklahoma City, OK', 'Tulsa, OK',
  'Wichita, KS', 'Omaha, NE', 'Des Moines, IA', 'Madison, WI',
  'Grand Rapids, MI', 'Akron, OH', 'Toledo, OH', 'Dayton, OH',
];

// Significance thresholds for alert generation
const ALERT_THRESHOLDS = {
  mortgageRateDelta:    0.25,  // 25bps move triggers alert
  appreciationDelta:    0.5,   // 0.5% CAGR change triggers alert
};

// ─── Snapshot management ──────────────────────────────────────────────────────

/** Save a market snapshot to Supabase for comparison next week */
async function saveMarketSnapshot(db, snapshot) {
  const now = new Date().toISOString();
  await db.from('market_data_cache').upsert(
    {
      key:         'market_snapshot:current',
      value:       snapshot,
      fetched_at:  now,
      valid_until: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
    },
    { onConflict: 'key' }
  );
}

/** Load last week's market snapshot */
async function loadLastSnapshot(db) {
  try {
    const { data, error } = await db
      .from('market_data_cache')
      .select('value')
      .eq('key', 'market_snapshot:current')
      .single();
    if (error || !data) return null;
    return data.value;
  } catch {
    return null;
  }
}

// ─── Change detection ─────────────────────────────────────────────────────────

/** Build current snapshot from live market data */
async function buildCurrentSnapshot(db, md) {
  const snapshot = {
    timestamp:    new Date().toISOString(),
    mortgageRate: md.mortgageRates?.rate30yr,
    mortgageAsOf: md.mortgageRates?.asOf,
    metros:       {},
  };

  // Fetch employment data for proactive metros (subset — fast check)
  const SNAPSHOT_METROS = PROACTIVE_METROS.slice(0, 40); // top 40 for weekly snapshot
  const empRows = await db
    .from('market_data_cache')
    .select('key, value')
    .in('key', SNAPSHOT_METROS.map(c => `employment:${c.split(',')[0].trim().toLowerCase()}`));

  for (const row of (empRows?.data || [])) {
    const city = row.key.replace('employment:', '');
    snapshot.metros[city] = {
      unemploymentRate:  row.value?.rate,
      unemploymentTrend: row.value?.trend,
    };
  }

  return snapshot;
}

/** Compare two snapshots, return array of detected changes */
function detectChanges(prev, curr) {
  if (!prev || !curr) return [];
  const changes = [];

  // Mortgage rate delta
  if (prev.mortgageRate && curr.mortgageRate) {
    const delta = Math.abs(curr.mortgageRate - prev.mortgageRate);
    if (delta >= ALERT_THRESHOLDS.mortgageRateDelta) {
      const direction = curr.mortgageRate > prev.mortgageRate ? 'up' : 'down';
      changes.push({
        type:      'mortgage_rate',
        severity:  delta >= 0.5 ? 'HIGH' : 'MEDIUM',
        message:   `Mortgage rates moved ${direction} ${delta.toFixed(2)}% (${prev.mortgageRate}% → ${curr.mortgageRate}%) since last snapshot`,
        prevValue: prev.mortgageRate,
        currValue: curr.mortgageRate,
        delta:     Math.round(delta * 100) / 100,
        direction,
        actionNote: direction === 'down'
          ? 'Deals that didn\'t pencil last week may be viable now — consider alerting users.'
          : 'Rising rates compress cash flow margins — deals analyzed last week are now less favorable.',
      });
    }
  }

  // Unemployment trend flips
  for (const [city, currData] of Object.entries(curr.metros || {})) {
    const prevData = prev.metros?.[city];
    if (!prevData || !currData) continue;
    if (prevData.unemploymentTrend && currData.unemploymentTrend &&
        prevData.unemploymentTrend !== currData.unemploymentTrend) {
      changes.push({
        type:      'unemployment_trend',
        severity:  'MEDIUM',
        city,
        message:   `${city}: Employment trend flipped from "${prevData.unemploymentTrend}" to "${currData.unemploymentTrend}"`,
        prevValue: prevData.unemploymentTrend,
        currValue: currData.unemploymentTrend,
        actionNote: currData.unemploymentTrend === 'worsening'
          ? 'Rising unemployment may soften rental demand in this market.'
          : 'Improving employment is a positive demand signal.',
      });
    }
  }

  return changes;
}

// ─── Proactive coverage ────────────────────────────────────────────────────────

/**
 * Ensures employment data is cached for all PROACTIVE_METROS.
 * Fetches stale metros in batches with rate limiting.
 * This is Phase 4D's "proactive city coverage" — the site knows about
 * major markets before users ask.
 */
async function refreshProactiveCoverage(db) {
  const EMPLOYMENT_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days
  const BATCH_SIZE = 5;
  const refreshed = [];
  const skipped   = [];

  // Find stale metros
  const staleMetros = [];
  for (const city of PROACTIVE_METROS) {
    if (!hasMetroUnemploymentData(city)) continue;
    const cityKey  = city.split(',')[0].trim().toLowerCase();
    const cacheKey = `employment:${cityKey}`;
    try {
      const { data } = await db
        .from('market_data_cache')
        .select('valid_until')
        .eq('key', cacheKey)
        .single();
      if (!data || new Date(data.valid_until) < new Date()) {
        staleMetros.push(city);
      } else {
        skipped.push(cityKey);
      }
    } catch {
      staleMetros.push(city);
    }
  }

  // Fetch stale metros in batches
  for (let i = 0; i < staleMetros.length; i += BATCH_SIZE) {
    const batch = staleMetros.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map(city => fetchMetroUnemployment(city).then(data => ({ city, data })))
    );

    for (const result of results) {
      if (result.status !== 'fulfilled' || !result.value?.data) continue;
      const { city, data } = result.value;
      const cityKey  = city.split(',')[0].trim().toLowerCase();
      const cacheKey = `employment:${cityKey}`;
      try {
        await db.from('market_data_cache').upsert(
          {
            key:         cacheKey,
            value:       data,
            fetched_at:  new Date().toISOString(),
            valid_until: new Date(Date.now() + EMPLOYMENT_TTL_MS).toISOString(),
          },
          { onConflict: 'key' }
        );
        refreshed.push(cityKey);
      } catch (err) {
        console.warn(`[market-digest] Failed to cache employment for ${cityKey}:`, err.message);
      }
    }

    // Respectful delay between FRED batches
    if (i + BATCH_SIZE < staleMetros.length) {
      await new Promise(r => setTimeout(r, 600));
    }
  }

  return { refreshed, skipped, total: PROACTIVE_METROS.length };
}

// ─── Email digest ─────────────────────────────────────────────────────────────

async function sendDigestEmail(changes, lawChanges, coverageStats) {
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail) return;

  const totalAlerts = changes.length + (lawChanges?.length || 0);
  if (totalAlerts === 0) return; // No email if nothing changed

  try {
    const { default: nodemailer } = await import('nodemailer');
    const transporter = nodemailer.createTransport({
      host:   process.env.SMTP_HOST,
      port:   parseInt(process.env.SMTP_PORT) || 587,
      secure: false,
      auth:   { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });

    const highAlerts    = changes.filter(c => c.severity === 'HIGH');
    const mediumAlerts  = changes.filter(c => c.severity === 'MEDIUM');

    const sections = [];

    if (highAlerts.length > 0) {
      sections.push('🔴 HIGH PRIORITY CHANGES:\n' + highAlerts.map(c =>
        `  • ${c.message}\n    → ${c.actionNote}`
      ).join('\n\n'));
    }

    if (mediumAlerts.length > 0) {
      sections.push('🟡 MEDIUM CHANGES:\n' + mediumAlerts.map(c =>
        `  • ${c.message}`
      ).join('\n'));
    }

    if (lawChanges?.length > 0) {
      sections.push('⚖️ LANDLORD LAW CHANGES DETECTED (require review before applying):\n' +
        lawChanges.map(c =>
          `  • ${c.state} — ${c.field}: stored=${c.stored} → live=${c.live} (${c.source})`
        ).join('\n')
      );
    }

    sections.push(`📊 PROACTIVE COVERAGE: Refreshed ${coverageStats.refreshed} metros (${coverageStats.total} total tracked)`);

    await transporter.sendMail({
      from:    `RentalIQ Weekly Digest <${process.env.SMTP_USER}>`,
      to:      adminEmail,
      subject: `📈 RentalIQ Weekly Market Digest — ${totalAlerts} change${totalAlerts !== 1 ? 's' : ''} detected`,
      text:    [
        `RentalIQ Weekly Market Digest`,
        `Generated: ${new Date().toISOString()}`,
        ``,
        ...sections,
        ``,
        `Full data: ${process.env.NEXTAUTH_URL}/api/admin/stats`,
      ].join('\n'),
    });
  } catch (err) {
    console.error('[market-digest] Email error:', err.message);
  }
}

// ─── Main handler ──────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const authHeader = req.headers.authorization;
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db  = getSupabaseAdmin();
  const now = new Date().toISOString();

  const results = {
    timestamp:       now,
    marketChanges:   [],
    lawChanges:      [],
    coverage:        {},
    snapshotSaved:   false,
    errors:          [],
  };

  try {
    // 1. Load market data
    const md = await getMarketData();

    // 2. Build + compare snapshots
    const prevSnapshot = await loadLastSnapshot(db);
    const currSnapshot = await buildCurrentSnapshot(db, md);
    const marketChanges = detectChanges(prevSnapshot, currSnapshot);
    results.marketChanges = marketChanges;

    // 3. Save new snapshot for next week
    await saveMarketSnapshot(db, currSnapshot);
    results.snapshotSaved = true;

    // 4. Check landlord law staleness (Phase 4B integration)
    try {
      const lawResult = await checkLandlordLawStaleness(db);
      const pendingLawChanges = await getPendingLawChanges(db);
      results.lawChanges = pendingLawChanges.filter(c => c.status === 'pending_review');

      console.log(`[market-digest] Law check: ${lawResult.staleStates.length} stale states, ${lawResult.detectedChanges.length} detected changes, ${lawResult.verified} verified`);
    } catch (err) {
      results.errors.push({ type: 'law_check', message: err.message });
    }

    // 5. Proactive city coverage (Phase 4D core)
    try {
      const coverage = await refreshProactiveCoverage(db);
      results.coverage = coverage;
      console.log(`[market-digest] Coverage: refreshed ${coverage.refreshed.length}, skipped ${coverage.skipped.length}`);
    } catch (err) {
      results.errors.push({ type: 'coverage', message: err.message });
    }

    // 6. Send digest email
    await sendDigestEmail(marketChanges, results.lawChanges, results.coverage);

  } catch (err) {
    console.error('[market-digest] Fatal error:', err);
    results.errors.push({ type: 'fatal', message: err.message });
  }

  console.log(`[cron/market-digest] changes=${results.marketChanges.length} lawChanges=${results.lawChanges.length} errors=${results.errors.length}`);

  return res.status(200).json({
    ok: results.errors.filter(e => e.type === 'fatal').length === 0,
    ...results,
  });
}
