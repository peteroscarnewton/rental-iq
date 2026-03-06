-- ─────────────────────────────────────────────────────────────────────────────
-- RentalIQ — One-time database setup
-- Run this ONCE in your Supabase SQL Editor (see plain-English instructions in SETUP.md)
-- Every line is safe to run multiple times — nothing will break if run again.
-- ─────────────────────────────────────────────────────────────────────────────

-- Scout deals table (stores AI-discovered listings)
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
  listing_url     text NOT NULL UNIQUE,
  source          text NOT NULL DEFAULT 'zillow',
  days_on_market  integer,
  year_built      integer,
  status          text NOT NULL DEFAULT 'unverified',
  confidence      text NOT NULL DEFAULT 'medium',
  last_verified   timestamptz,
  verify_count    integer NOT NULL DEFAULT 0,
  first_seen      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL,
  flagged_sold    integer NOT NULL DEFAULT 0,
  search_query    text
);

CREATE INDEX IF NOT EXISTS idx_scout_deals_state    ON scout_deals(state);
CREATE INDEX IF NOT EXISTS idx_scout_deals_city     ON scout_deals(city);
CREATE INDEX IF NOT EXISTS idx_scout_deals_expires  ON scout_deals(expires_at);
CREATE INDEX IF NOT EXISTS idx_scout_deals_cap_rate ON scout_deals(cap_rate DESC);
CREATE INDEX IF NOT EXISTS idx_scout_deals_price    ON scout_deals(price);
CREATE INDEX IF NOT EXISTS idx_scout_deals_flagged  ON scout_deals(flagged_sold);
CREATE INDEX IF NOT EXISTS idx_scout_deals_status   ON scout_deals(status);

-- Add new columns if they don't exist yet (safe to run even after first setup)
ALTER TABLE scout_deals ADD COLUMN IF NOT EXISTS status        text NOT NULL DEFAULT 'unverified';
ALTER TABLE scout_deals ADD COLUMN IF NOT EXISTS confidence    text NOT NULL DEFAULT 'medium';
ALTER TABLE scout_deals ADD COLUMN IF NOT EXISTS last_verified timestamptz;
ALTER TABLE scout_deals ADD COLUMN IF NOT EXISTS verify_count  integer NOT NULL DEFAULT 0;

-- Guest usage tables (tracks free trial usage per device)
CREATE TABLE IF NOT EXISTS guest_usage (
  fingerprint   text PRIMARY KEY,
  ip_hash       text,
  used_scout    boolean NOT NULL DEFAULT false,
  used_analyze  boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS guest_ip_usage (
  ip_hash    text NOT NULL,
  use_date   date NOT NULL,
  use_count  integer NOT NULL DEFAULT 1,
  PRIMARY KEY (ip_hash, use_date)
);

-- Search history table (tracks which markets the daily job has already searched)
CREATE TABLE IF NOT EXISTS scout_search_history (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  city        text NOT NULL,
  state       text NOT NULL,
  searched_at timestamptz NOT NULL DEFAULT now(),
  found_count integer NOT NULL DEFAULT 0,
  query       text
);

CREATE INDEX IF NOT EXISTS idx_search_history_city ON scout_search_history(city, state);
CREATE INDEX IF NOT EXISTS idx_search_history_date ON scout_search_history(searched_at DESC);

-- Security: control who can read/write each table
ALTER TABLE scout_deals          ENABLE ROW LEVEL SECURITY;
ALTER TABLE guest_usage          ENABLE ROW LEVEL SECURITY;
ALTER TABLE guest_ip_usage       ENABLE ROW LEVEL SECURITY;
ALTER TABLE scout_search_history ENABLE ROW LEVEL SECURITY;

-- Allow anyone to view active deals (the public Scout page)
DROP POLICY IF EXISTS "scout_deals_public_read" ON scout_deals;
CREATE POLICY "scout_deals_public_read"
  ON scout_deals FOR SELECT
  USING (flagged_sold < 3 AND expires_at > now() AND status != 'likely_sold');

-- Done. You can close this window.
