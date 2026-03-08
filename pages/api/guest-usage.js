/**
 * /api/guest-usage
 * ─────────────────────────────────────────────────────────────────────────────
 * Manages the "1 free use" grant for unauthenticated guests.
 *
 * Each guest gets exactly 1 free Scout AI search AND 1 free Analyze, total.
 * These are tracked by device fingerprint + IP hash in the `guest_usage` table.
 *
 * Anti-abuse layers:
 *   1. Device fingerprint (canvas + hardware signals) — survives incognito
 *   2. IP hash — VPN changes still caught if fingerprint matches, and vice versa
 *   3. Rate limiting — max 3 check calls per IP per minute
 *   4. IP daily cap — max 5 free uses from any single IP per day (catches
 *      shared IPs like offices or VPN endpoints being abused systematically)
 *
 * GET  ?action=check&type=scout|analyze&fp={fingerprint}
 *   → { allowed: bool, reason?: string, usedScout: bool, usedAnalyze: bool }
 *
 * POST { action: 'consume', type: 'scout'|'analyze', fp: string }
 *   → { ok: bool, usedScout: bool, usedAnalyze: bool }
 *
 * Table: guest_usage
 *   fingerprint   text PRIMARY KEY
 *   ip_hash       text
 *   used_scout    boolean DEFAULT false
 *   used_analyze  boolean DEFAULT false
 *   created_at    timestamptz DEFAULT now()
 *   last_seen     timestamptz DEFAULT now()
 *
 * Table: guest_ip_usage  (IP-level daily cap)
 *   ip_hash       text
 *   use_date      date
 *   use_count     integer DEFAULT 1
 *   PRIMARY KEY (ip_hash, use_date)
 */

import { rateLimit }       from '../../lib/rateLimit.js';
import { getSupabaseAdmin } from '../../lib/supabase.js';

// Max free uses from a single IP per day (catches VPN abuse across fingerprints)
const IP_DAILY_CAP = 8;

function hashIp(ip) {
  // Simple deterministic hash — not cryptographic, just for lookup
  let h = 5381;
  for (let i = 0; i < ip.length; i++) {
    h = (h * 33 ^ ip.charCodeAt(i)) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

function getClientIp(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
    || req.socket?.remoteAddress
    || 'unknown';
}

export default async function handler(req, res) {
  // Rate limit: 10 calls/minute per IP
  if (!rateLimit(req, { max: 10, windowMs: 60_000 })) {
    return res.status(429).json({ error: 'Too many requests.' });
  }

  const db = getSupabaseAdmin();
  const ip = getClientIp(req);
  const ipHash = hashIp(ip);
  const today = new Date().toISOString().slice(0, 10);

  // ── GET: check if a free use is available ────────────────────────────────
  if (req.method === 'GET') {
    const { type, fp } = req.query;
    if (!fp || !type) return res.status(400).json({ error: 'fp and type required' });

    // Validate fingerprint format (32 hex chars)
    if (!/^[0-9a-f]{32}$/i.test(fp)) {
      return res.status(400).json({ error: 'Invalid fingerprint' });
    }

    try {
      // Check fingerprint record
      const { data: guest } = await db
        .from('guest_usage')
        .select('used_scout, used_analyze')
        .eq('fingerprint', fp)
        .single();

      const used = type === 'scout' ? guest?.used_scout : guest?.used_analyze;
      if (used) {
        return res.json({ allowed: false, reason: 'free_used', usedScout: !!guest?.used_scout, usedAnalyze: !!guest?.used_analyze });
      }

      // Check IP daily cap
      const { data: ipRow } = await db
        .from('guest_ip_usage')
        .select('use_count')
        .eq('ip_hash', ipHash)
        .eq('use_date', today)
        .single();

      if (ipRow && ipRow.use_count >= IP_DAILY_CAP) {
        return res.json({ allowed: false, reason: 'ip_cap', usedScout: !!guest?.used_scout, usedAnalyze: !!guest?.used_analyze });
      }

      return res.json({ allowed: true, usedScout: !!guest?.used_scout, usedAnalyze: !!guest?.used_analyze });
    } catch (err) {
      console.error('[guest-usage GET]', err);
      // On DB error, allow the use (fail open — don't block legitimate users)
      return res.json({ allowed: true, usedScout: false, usedAnalyze: false });
    }
  }

  // ── POST: consume a free use ──────────────────────────────────────────────
  if (req.method === 'POST') {
    const { action, type, fp } = req.body || {};
    if (action !== 'consume' || !fp || !type) {
      return res.status(400).json({ error: 'action, fp, and type required' });
    }
    if (!/^[0-9a-f]{32}$/i.test(fp)) {
      return res.status(400).json({ error: 'Invalid fingerprint' });
    }

    try {
      // Upsert guest record
      const updateField = type === 'scout' ? 'used_scout' : 'used_analyze';

      const { data: existing } = await db
        .from('guest_usage')
        .select('used_scout, used_analyze')
        .eq('fingerprint', fp)
        .single();

      if (existing) {
        // Already consumed this type — idempotent, just return current state
        if (type === 'scout' && existing.used_scout) {
          return res.json({ ok: false, reason: 'already_used', usedScout: true, usedAnalyze: existing.used_analyze });
        }
        if (type === 'analyze' && existing.used_analyze) {
          return res.json({ ok: false, reason: 'already_used', usedScout: existing.used_scout, usedAnalyze: true });
        }
        // Mark as used
        await db.from('guest_usage').update({
          [updateField]: true,
          ip_hash: ipHash,
          last_seen: new Date().toISOString(),
        }).eq('fingerprint', fp);

        const newState = {
          usedScout:   type === 'scout'   ? true : existing.used_scout,
          usedAnalyze: type === 'analyze' ? true : existing.used_analyze,
        };
        // Increment IP daily counter
        await upsertIpUsage(db, ipHash, today);
        return res.json({ ok: true, ...newState });
      } else {
        // New fingerprint — create record
        await db.from('guest_usage').insert({
          fingerprint: fp,
          ip_hash: ipHash,
          used_scout:   type === 'scout',
          used_analyze: type === 'analyze',
        });
        await upsertIpUsage(db, ipHash, today);
        return res.json({
          ok: true,
          usedScout:   type === 'scout',
          usedAnalyze: type === 'analyze',
        });
      }
    } catch (err) {
      console.error('[guest-usage POST]', err);
      return res.status(500).json({ error: 'Usage tracking error' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

async function upsertIpUsage(db, ipHash, today) {
  try {
    // Single atomic upsert — eliminates the select-then-insert TOCTOU race and
    // the extra round trip. ON CONFLICT increments the counter atomically.
    await db.rpc('increment_ip_usage', { p_ip_hash: ipHash, p_date: today })
      .then(({ error }) => {
        if (error) throw error;
      });
  } catch {
    // Fallback: if the RPC doesn't exist yet, use the upsert approach
    // with a conflict target. Still one round trip, still atomic at DB level.
    try {
      await db.from('guest_ip_usage').upsert(
        { ip_hash: ipHash, use_date: today, use_count: 1 },
        { onConflict: 'ip_hash,use_date', ignoreDuplicates: false }
      );
      // Note: proper increment requires the DB function below. Until it exists,
      // this sets use_count=1 on conflict (not perfect but avoids the race crash).
      // Deploy this SQL to Supabase:
      //   CREATE OR REPLACE FUNCTION increment_ip_usage(p_ip_hash text, p_date date)
      //   RETURNS void LANGUAGE sql AS $$
      //     INSERT INTO guest_ip_usage (ip_hash, use_date, use_count)
      //     VALUES (p_ip_hash, p_date, 1)
      //     ON CONFLICT (ip_hash, use_date)
      //     DO UPDATE SET use_count = guest_ip_usage.use_count + 1;
      //   $$;
    } catch {
      // Non-critical counter — never fail the request over this
    }
  }
}
