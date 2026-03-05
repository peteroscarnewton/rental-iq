-- ─────────────────────────────────────────────────────────────────────────────
-- RentalIQ Phase 2: Scout Deals + Guest Usage
-- Run this in your Supabase SQL editor (Settings → SQL Editor → New query)
-- ─────────────────────────────────────────────────────────────────────────────

-- ── scout_deals ──────────────────────────────────────────────────────────────
-- Stores AI-discovered active listings from Zillow/Redfin/Realtor.com.
-- Populated by /api/cron/scout-deals (daily 5am UTC) and on-demand by
-- /api/scout-deals POST (user-triggered live search, costs 1 token).
-- Deals expire after 30 days. Heavily flagged deals are hidden immediately.

CREATE TABLE IF NOT EXISTS scout_deals (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  city            text NOT NULL,
  state           text NOT NULL,
  address         text NOT NULL,
  price           integer NOT NULL,
  beds            integer NOT NULL,
  baths           numeric NOT NULL DEFAULT 1,
  sqft            integer,
  estimated_rent  integer,
  cap_rate        numeric,
  cash_flow       integer,
  listing_url     text NOT NULL UNIQUE,  -- unique constraint for upsert dedup
  source          text NOT NULL DEFAULT 'zillow',  -- zillow | redfin | realtor
  days_on_market  integer,
  year_built      integer,
  first_seen      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL,
  flagged_sold    integer NOT NULL DEFAULT 0,
  search_query    text
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_scout_deals_state     ON scout_deals(state);
CREATE INDEX IF NOT EXISTS idx_scout_deals_city      ON scout_deals(city);
CREATE INDEX IF NOT EXISTS idx_scout_deals_expires   ON scout_deals(expires_at);
CREATE INDEX IF NOT EXISTS idx_scout_deals_cap_rate  ON scout_deals(cap_rate DESC);
CREATE INDEX IF NOT EXISTS idx_scout_deals_price     ON scout_deals(price);
CREATE INDEX IF NOT EXISTS idx_scout_deals_flagged   ON scout_deals(flagged_sold);

-- ── guest_usage ───────────────────────────────────────────────────────────────
-- Tracks which device fingerprints have used their free trial.
-- Fingerprint is computed from browser signals (canvas, screen, timezone, etc.)
-- and survives incognito / cookie clearing / page refresh.
-- One row per device. Used by /api/guest-usage.

CREATE TABLE IF NOT EXISTS guest_usage (
  fingerprint     text PRIMARY KEY,  -- 32-char hex from lib/fingerprint.js
  ip_hash         text,              -- hashed IP at time of first use
  used_scout      boolean NOT NULL DEFAULT false,
  used_analyze    boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_seen       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_guest_usage_ip ON guest_usage(ip_hash);

-- ── guest_ip_usage ────────────────────────────────────────────────────────────
-- IP-level daily cap to catch VPN abuse (users swapping IPs across fingerprints).
-- Max 8 free uses per IP per day (generous enough for shared office/school IPs).
-- Rows are naturally pruned when old dates are no longer queried.

CREATE TABLE IF NOT EXISTS guest_ip_usage (
  ip_hash         text NOT NULL,
  use_date        date NOT NULL,
  use_count       integer NOT NULL DEFAULT 1,
  PRIMARY KEY (ip_hash, use_date)
);

-- Optional: auto-delete old IP usage rows (keeps table small)
-- You can run this as a periodic job or cron in Supabase:
-- DELETE FROM guest_ip_usage WHERE use_date < CURRENT_DATE - INTERVAL '7 days';

-- ── Update users table: bump new user token grant to 2 ────────────────────────
-- The application code (pages/api/auth/[...nextauth].js) already inserts
-- new users with tokens: 2. This comment is for reference only.
-- Existing users with 1 token are NOT automatically upgraded (intentional).
-- New signups from this point forward will receive 2 tokens.

-- ── Row Level Security ────────────────────────────────────────────────────────
-- scout_deals: public read (no auth needed to view deals), service role for writes
ALTER TABLE scout_deals  ENABLE ROW LEVEL SECURITY;
ALTER TABLE guest_usage  ENABLE ROW LEVEL SECURITY;
ALTER TABLE guest_ip_usage ENABLE ROW LEVEL SECURITY;

-- Allow public SELECT on scout_deals (anyone can view deals)
CREATE POLICY "scout_deals_public_read"
  ON scout_deals FOR SELECT
  USING (flagged_sold < 3 AND expires_at > now());

-- All writes go through service role key (API routes only)
-- guest_usage and guest_ip_usage: no public access (service role only)

-- ── Verification query ────────────────────────────────────────────────────────
-- Run after creating tables to confirm structure:
-- SELECT table_name, column_name, data_type FROM information_schema.columns
-- WHERE table_name IN ('scout_deals', 'guest_usage', 'guest_ip_usage')
-- ORDER BY table_name, ordinal_position;
