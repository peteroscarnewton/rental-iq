/**
 * GET /api/cron/health-check
 * ─────────────────────────────────────────────────────────────────────────────
 * Monitors data freshness and upstream API availability.
 * Runs daily. Sends an alert email if anything is stale or broken.
 *
 * Checks:
 *   1. market_data_cache freshness — each key within expected TTL?
 *   2. FRED CSV endpoint — does it respond and return a sane mortgage rate?
 *   3. Census ACS API — does it respond?
 *   4. HUD FMR API — does it respond?
 *   5. OSM Overpass — does it respond?
 *
 * Response: { ok, checks: [...], staleCacheKeys: [...], downstreams: [...] }
 */

import { getSupabaseAdmin } from '../../../lib/supabase.js';

// Max age in hours before a cache key is considered "stale for alert"
const ALERT_AGE_HOURS = {
  mortgage_rates:              48,       // FRED is weekly — alert after 2 days of failure
  rent_growth_default:         14 * 24,  // Monthly data — alert after 2 weeks
  state_tax_rates:             60 * 24,  // Annual — alert after 60 days
  state_appreciation:          95 * 24,  // FHFA quarterly — alert after 95 days
  city_appreciation:           95 * 24,
  capex_ppi_multiplier:        35 * 24,  // BLS PPI monthly — alert after 35 days
  // Phase 4 additions
  'market_snapshot:current':   10 * 24, // Weekly digest snapshot — alert after 10 days
  // Phase 9 — auto-heal keys
  'state_tax_rates':           400 * 24, // Census ACS annual — alert after 400 days
  'landlord_laws':              45 * 24, // Eviction Lab monthly — alert after 45 days
  'str_regulations':           120 * 24, // NMHC quarterly — alert after 120 days
  'market_cap_rates':          120 * 24, // Computed quarterly — alert after 120 days
  'rent_control_db':            45 * 24, // NLIHC monthly — alert after 45 days
  'mgmt_fee_rates':            400 * 24, // NARPM annual — alert after 400 days
  landlord_laws_audit:        130 * 24, // Quarterly law check — alert after 130 days
  // Phase 6 additions
  building_permits_sentinel:   45 * 24, // Monthly Census BPS — alert after 45 days
  metro_growth_sentinel:      400 * 24, // Annual ACS — alert after 400 days
  // Phase 7
  hvs_vacancy:                100 * 24, // Quarterly HVS — alert after 100 days
  market_cap_rates:           190 * 24, // Semi-annual CBRE survey — alert after 190 days
  mgmt_fee_rates:             380 * 24, // Annual NARPM survey — alert after 380 days
  safmr_sentinel:             380 * 24, // Annual HUD SAFMR — alert after 380 days
  // Phase 8
  state_ins_rates:            380 * 24, // Annual NAIC/III live fetch — alert after 380 days
  str_data_sentinel:          100 * 24, // Quarterly STR batch — alert after 100 days
  climate_risk_sentinel:      380 * 24, // Annual FEMA NRI — alert after 380 days
};

export const config = { api: { bodyParser: false }, maxDuration: 20 };

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const authHeader = req.headers.authorization;
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const checks  = [];
  const alerts  = [];
  const now     = Date.now();

  // ── 1. Check market_data_cache freshness ──────────────────────────────────
  try {
    const db = getSupabaseAdmin();
    const { data: rows } = await db
      .from('market_data_cache')
      .select('key, fetched_at, valid_until');

    const rowsByKey = Object.fromEntries((rows || []).map(r => [r.key, r]));

    for (const [key, maxAgeHours] of Object.entries(ALERT_AGE_HOURS)) {
      const row = rowsByKey[key];
      if (!row) {
        alerts.push({ type: 'missing_cache_key', key, message: `Cache key "${key}" has never been seeded.` });
        checks.push({ key, status: 'missing' });
        continue;
      }
      const ageMs = now - new Date(row.fetched_at).getTime();
      const ageHours = ageMs / (1000 * 60 * 60);
      if (ageHours > maxAgeHours) {
        alerts.push({ type: 'stale_cache', key, ageHours: Math.round(ageHours), maxAgeHours,
          message: `Cache key "${key}" is ${Math.round(ageHours)}h old (max ${maxAgeHours}h).` });
        checks.push({ key, status: 'stale', ageHours: Math.round(ageHours) });
      } else {
        checks.push({ key, status: 'ok', ageHours: Math.round(ageHours) });
      }
    }
  } catch (err) {
    alerts.push({ type: 'supabase_error', message: `Supabase unavailable: ${err.message}` });
    checks.push({ key: 'supabase', status: 'error', message: err.message });
  }

  // ── 2. Upstream: FRED ─────────────────────────────────────────────────────
  try {
    const r = await fetch('https://fred.stlouisfed.org/graph/fredgraph.csv?id=MORTGAGE30US',
      { signal: AbortSignal.timeout(5000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const csv = await r.text();
    const lastLine = csv.trim().split('\n').pop() || '';
    const rate = parseFloat(lastLine.split(',')[1]);
    if (isNaN(rate) || rate < 2 || rate > 15) throw new Error(`Bad rate value: ${rate}`);
    checks.push({ api: 'FRED', status: 'ok', rate });
  } catch (err) {
    alerts.push({ type: 'upstream_down', api: 'FRED', message: err.message });
    checks.push({ api: 'FRED', status: 'error', message: err.message });
  }

  // ── 3. Upstream: Census ACS ───────────────────────────────────────────────
  try {
    const r = await fetch(
      'https://api.census.gov/data/2023/acs/acs5?get=B25058_001E&for=state:06', // CA median rent
      { signal: AbortSignal.timeout(6000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    checks.push({ api: 'Census ACS', status: 'ok' });
  } catch (err) {
    alerts.push({ type: 'upstream_down', api: 'Census ACS', message: err.message });
    checks.push({ api: 'Census ACS', status: 'error', message: err.message });
  }

  // ── 4. Upstream: HUD FMR ─────────────────────────────────────────────────
  try {
    const r = await fetch('https://www.huduser.gov/hudapi/public/fmr/statedata/TX',
      { signal: AbortSignal.timeout(6000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    checks.push({ api: 'HUD FMR', status: 'ok' });
  } catch (err) {
    alerts.push({ type: 'upstream_down', api: 'HUD FMR', message: err.message });
    checks.push({ api: 'HUD FMR', status: 'error', message: err.message });
  }

  // ── 5. Upstream: OSM Overpass ─────────────────────────────────────────────
  try {
    const r = await fetch('https://overpass-api.de/api/status', { signal: AbortSignal.timeout(5000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    checks.push({ api: 'OSM Overpass', status: 'ok' });
  } catch (err) {
    // OSM Overpass is less critical — log but don't escalate
    checks.push({ api: 'OSM Overpass', status: 'warn', message: err.message });
  }

  // ── 6. Upstream: FHFA HPI ────────────────────────────────────────────────
  try {
    const r = await fetch('https://www.fhfa.gov/DataTools/Downloads/Documents/HPI/HPI_AT_state.csv',
      { method: 'HEAD', signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    checks.push({ api: 'FHFA HPI', status: 'ok' });
  } catch (err) {
    alerts.push({ type: 'upstream_down', api: 'FHFA HPI', message: err.message });
    checks.push({ api: 'FHFA HPI', status: 'error', message: err.message });
  }

  // ── 7. Upstream: Redfin S3 ───────────────────────────────────────────────
  try {
    const r = await fetch(
      'https://redfin-public-data.s3.us-west-2.amazonaws.com/redfin_market_tracker/zip_code_market_tracker.tsv000.gz',
      { method: 'HEAD', signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    checks.push({ api: 'Redfin S3', status: 'ok' });
  } catch (err) {
    // Redfin S3 down = market pulse data won't refresh but existing cache still serves
    checks.push({ api: 'Redfin S3', status: 'warn', message: err.message });
  }

  // ── 8. Upstream: FRED Case-Shiller ───────────────────────────────────────
  try {
    const r = await fetch('https://fred.stlouisfed.org/graph/fredgraph.csv?id=CSUSHPINSA',
      { signal: AbortSignal.timeout(5000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const csv = await r.text();
    if (csv.length < 100) throw new Error('Response too short');
    checks.push({ api: 'FRED Case-Shiller', status: 'ok' });
  } catch (err) {
    alerts.push({ type: 'upstream_down', api: 'FRED Case-Shiller', message: err.message });
    checks.push({ api: 'FRED Case-Shiller', status: 'error', message: err.message });
  }

  // ── 9. Check for pending landlord law changes (Phase 4B) ─────────────────
  // If law changes have been detected but not reviewed, alert the admin.
  try {
    const db = getSupabaseAdmin();
    const { data } = await db
      .from('market_data_cache')
      .select('value')
      .eq('key', 'landlord_laws_pending_changes')
      .single();
    const pendingChanges = data?.value || [];
    const unreviewed = pendingChanges.filter(c => c.status === 'pending_review');
    if (unreviewed.length > 0) {
      // Warn only — law changes need human review before applying
      checks.push({
        key:      'landlord_laws_pending_changes',
        status:   'warn',
        count:    unreviewed.length,
        message:  `${unreviewed.length} landlord law change(s) detected and awaiting human review`,
      });
      // Only alert if HIGH severity changes exist
      const highPriority = unreviewed.filter(c => c.severity === 'HIGH');
      if (highPriority.length > 0) {
        alerts.push({
          type:    'law_change_pending',
          message: `${highPriority.length} HIGH severity landlord law change(s) need review: ${highPriority.map(c => `${c.state} ${c.field}`).join(', ')}`,
        });
      }
    } else {
      checks.push({ key: 'landlord_laws_pending_changes', status: 'ok', message: 'No unreviewed law changes' });
    }
  } catch {
    // Non-critical — law audit table may not exist yet
    checks.push({ key: 'landlord_laws_pending_changes', status: 'unknown', message: 'Could not read audit table' });
  }

  // ── Send alert email if anything is broken ────────────────────────────────
  if (alerts.length > 0) {
    try {
      const adminEmail = process.env.ADMIN_EMAIL;
      if (adminEmail) {
        const { default: nodemailer } = await import('nodemailer');
        const transporter = nodemailer.createTransport({
          host:   process.env.SMTP_HOST,
          port:   parseInt(process.env.SMTP_PORT) || 587,
          secure: false,
          auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
        });

        const alertLines = alerts.map(a => `• [${a.type}] ${a.message}`).join('\n');
        await transporter.sendMail({
          from:    `RentalIQ Monitor <${process.env.SMTP_USER}>`,
          to:      adminEmail,
          subject: `⚠️ RentalIQ: ${alerts.length} data alert${alerts.length > 1 ? 's' : ''} — action may be needed`,
          text: `RentalIQ data health check found ${alerts.length} issue${alerts.length > 1 ? 's' : ''}:\n\n${alertLines}\n\nTimestamp: ${new Date().toISOString()}\n\nAll checks:\n${JSON.stringify(checks, null, 2)}`,
        });
      }
    } catch (emailErr) {
      console.error('[health-check] alert email failed:', emailErr.message);
    }
  }

  const ok = alerts.filter(a => a.type !== 'upstream_down' || !['OSM Overpass', 'Redfin S3'].includes(a.api)).length === 0;
  console.log(`[cron/health-check] ok=${ok} alerts=${alerts.length}`);

  return res.status(200).json({
    ok,
    checks,
    alerts,
    timestamp: new Date().toISOString(),
  });
}
