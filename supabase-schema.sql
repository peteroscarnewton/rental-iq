-- ============================================================
-- RentalIQ — Supabase Schema
-- Run this entire file in your Supabase SQL Editor
-- Dashboard > SQL Editor > New Query > Paste > Run
--
-- Phase 4 migration (existing deployments): run these ALTER statements
-- if you already have the deals table:
--   ALTER TABLE deals ADD COLUMN IF NOT EXISTS dscr TEXT;
--   ALTER TABLE deals ADD COLUMN IF NOT EXISTS cap_rate TEXT;
-- ============================================================

-- ── Users table ──────────────────────────────────────────────
-- We manage users ourselves (not using Supabase Auth)
-- NextAuth handles auth, we store user data here

CREATE TABLE IF NOT EXISTS users (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  email       TEXT        UNIQUE NOT NULL,
  name        TEXT,
  image       TEXT,
  tokens      INTEGER     NOT NULL DEFAULT 1,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for fast email lookups (NextAuth uses email as key)
CREATE INDEX IF NOT EXISTS users_email_idx ON users (email);

-- ── Deals table ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS deals (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  address     TEXT,
  city        TEXT,
  verdict     TEXT        CHECK (verdict IN ('YES','NO','MAYBE')),
  score       INTEGER,
  price       TEXT,
  rent        TEXT,
  cashflow    TEXT,
  coc         TEXT,
  dscr        TEXT,
  cap_rate    TEXT,
  data        JSONB       NOT NULL,  -- full analysis blob
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS deals_user_id_idx    ON deals (user_id);
CREATE INDEX IF NOT EXISTS deals_created_at_idx ON deals (created_at DESC);

-- ── Purchases table (audit trail) ────────────────────────────
CREATE TABLE IF NOT EXISTS purchases (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email        TEXT        NOT NULL,
  stripe_session_id TEXT        UNIQUE NOT NULL,
  tokens_added      INTEGER     NOT NULL,
  amount_cents      INTEGER     NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS purchases_user_email_idx ON purchases (user_email);
CREATE INDEX IF NOT EXISTS purchases_stripe_sid_idx ON purchases (stripe_session_id);

-- ── RPC: deduct_token ─────────────────────────────────────────
-- Atomically checks and deducts 1 token from a user.
-- Returns the new token count (integer) if successful,
-- or NULL if the user has no tokens.
-- Called by analyze.js before running the Gemini API.

CREATE OR REPLACE FUNCTION deduct_token(p_user_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  current_tokens INTEGER;
  new_tokens     INTEGER;
BEGIN
  -- Lock the row for this transaction
  SELECT tokens INTO current_tokens
  FROM users
  WHERE id = p_user_id
  FOR UPDATE;

  IF current_tokens IS NULL THEN
    RETURN NULL;  -- user not found
  END IF;

  IF current_tokens <= 0 THEN
    RETURN NULL;  -- no tokens
  END IF;

  new_tokens := current_tokens - 1;

  UPDATE users
  SET tokens     = new_tokens,
      updated_at = NOW()
  WHERE id = p_user_id;

  RETURN new_tokens;
END;
$$;

-- ── RPC: add_tokens ───────────────────────────────────────────
-- Atomically adds tokens to a user after Stripe payment.
-- Called by the Stripe webhook.

CREATE OR REPLACE FUNCTION add_tokens(p_email TEXT, p_tokens INTEGER)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE users
  SET tokens     = tokens + p_tokens,
      updated_at = NOW()
  WHERE email = p_email;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found: %', p_email;
  END IF;
END;
$$;

-- ── RLS: Row Level Security ───────────────────────────────────
-- We use the service role key in API routes (bypasses RLS).
-- Enable RLS anyway as a safety net.

ALTER TABLE users     ENABLE ROW LEVEL SECURITY;
ALTER TABLE deals     ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchases ENABLE ROW LEVEL SECURITY;

-- Service role bypasses RLS automatically.
-- No policies needed for anon/authenticated roles
-- since all DB access goes through server-side API routes.

-- ── Trigger: updated_at ──────────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ── Phase 6: Stripe customer portal ──────────────────────────────────────────
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT UNIQUE;

-- ── Phase 4 additions ──────────────────────────────────────────────────────────
-- Run these in Supabase SQL Editor if upgrading from a previous version

ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS is_public    BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS share_token  TEXT    UNIQUE;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS referral_code TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS referred_by  TEXT;

-- Auto-generate referral codes for existing users
UPDATE users SET referral_code = UPPER(SUBSTRING(MD5(id::text), 1, 8)) WHERE referral_code IS NULL;

-- Function: generate referral code on new user insert
CREATE OR REPLACE FUNCTION generate_referral_code()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.referral_code IS NULL THEN
    NEW.referral_code := UPPER(SUBSTRING(MD5(NEW.id::text), 1, 8));
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_referral_code ON users;
CREATE TRIGGER set_referral_code
  BEFORE INSERT ON users
  FOR EACH ROW EXECUTE FUNCTION generate_referral_code();

-- Function: credit referral bonus (1 token each)
CREATE OR REPLACE FUNCTION claim_referral(p_new_user_email TEXT, p_referral_code TEXT)
RETURNS JSONB AS $$
DECLARE
  v_referrer_id   UUID;
  v_new_user_id   UUID;
  v_already_used  BOOLEAN;
BEGIN
  -- Find referrer
  SELECT id INTO v_referrer_id FROM users WHERE referral_code = p_referral_code;
  IF v_referrer_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid referral code');
  END IF;

  -- Find new user
  SELECT id, referred_by IS NOT NULL INTO v_new_user_id, v_already_used
    FROM users WHERE email = p_new_user_email;
  IF v_new_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'User not found');
  END IF;
  IF v_already_used THEN
    RETURN jsonb_build_object('success', false, 'error', 'Referral already claimed');
  END IF;
  -- Prevent self-referral
  IF v_new_user_id = v_referrer_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cannot refer yourself');
  END IF;

  -- Credit both parties
  UPDATE users SET tokens = tokens + 1 WHERE id = v_referrer_id;
  UPDATE users SET tokens = tokens + 1, referred_by = p_referral_code WHERE id = v_new_user_id;

  RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── Market Data Cache ─────────────────────────────────────────────────────────
-- Single source of truth for all market data used in RentalIQ.
-- Populated by /api/cron/refresh-market-data. Read by /api/market-data and
-- lib/marketData.js. Eliminates all hardcoded static tables across the codebase.
--
-- Keys used:
--   mortgage_rates         { rate30yr, rate15yr, rate5arm, asOf, source }
--   rent_growth_default    { rate, asOf, source }
--   state_tax_rates        { AL: 0.41, TX: 1.80, ... }
--   state_ins_rates        { FL: 2.10, TX: 1.80, ... }
--   state_appreciation     { FL: 4.5, TX: 4.2, ... }
--   city_appreciation      { austin: 3.2, miami: 5.0, ... }
--
CREATE TABLE IF NOT EXISTS market_data_cache (
  key         TEXT        PRIMARY KEY,
  value       JSONB       NOT NULL,
  source      TEXT,                          -- e.g. "FRED/PMMS", "baseline", "FHFA"
  fetched_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  valid_until TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
  fetch_count INTEGER     NOT NULL DEFAULT 1
);

-- Index for freshness checks in the cron job
CREATE INDEX IF NOT EXISTS market_data_cache_valid_until_idx ON market_data_cache (valid_until);

-- RLS: readable by all (no user data), writable only by service role (cron)
ALTER TABLE market_data_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read market_data_cache"
  ON market_data_cache FOR SELECT
  USING (true);

-- ── Seed baseline values ──────────────────────────────────────────────────────
-- These are the starting values. The cron job will overwrite them with live
-- FRED data within 24 hours of first deploy.
-- Run this block once after creating the table.

INSERT INTO market_data_cache (key, value, source, valid_until) VALUES
(
  'mortgage_rates',
  '{"rate30yr": 6.87, "rate15yr": 6.14, "rate5arm": 6.25, "asOf": "2026-02-20", "source": "baseline"}',
  'baseline',
  NOW() + INTERVAL '1 day'  -- will be refreshed by cron immediately
),
(
  'rent_growth_default',
  '{"rate": 3.2, "asOf": "2026-01", "source": "baseline"}',
  'baseline',
  NOW() + INTERVAL '1 day'
),
(
  'state_tax_rates',
  '{"AL":0.41,"AK":1.19,"AZ":0.62,"AR":0.62,"CA":0.75,"CO":0.51,"CT":1.79,"DE":0.57,"FL":0.89,"GA":0.92,"HI":0.29,"ID":0.69,"IL":2.27,"IN":0.85,"IA":1.57,"KS":1.41,"KY":0.86,"LA":0.55,"ME":1.36,"MD":1.09,"MA":1.23,"MI":1.54,"MN":1.12,"MS":0.65,"MO":1.01,"MT":0.84,"NE":1.73,"NV":0.60,"NH":2.18,"NJ":2.49,"NM":0.80,"NY":1.72,"NC":0.82,"ND":0.98,"OH":1.59,"OK":0.90,"OR":0.97,"PA":1.58,"RI":1.63,"SC":0.57,"SD":1.31,"TN":0.71,"TX":1.80,"UT":0.58,"VT":1.90,"VA":0.82,"WA":1.03,"WV":0.59,"WI":1.85,"WY":0.61,"DC":0.56}',
  'baseline',
  NOW() + INTERVAL '30 days'
),
(
  'state_ins_rates',
  '{"FL":2.10,"TX":1.80,"LA":2.40,"OK":1.60,"KS":1.50,"MS":1.40,"AL":1.30,"AR":1.20,"SC":1.10,"NC":1.00,"GA":0.95,"TN":0.90,"MO":1.10,"CO":0.85,"AZ":0.75,"NV":0.65,"CA":0.75,"NY":0.85,"NJ":0.90,"IL":0.80,"OH":0.75,"PA":0.75,"MI":0.85,"IN":0.75,"WA":0.65,"OR":0.65,"MN":0.80,"WI":0.75,"IA":0.85,"NE":1.00,"SD":0.90,"ND":0.85,"MT":0.65,"ID":0.60,"UT":0.65,"WY":0.65,"NM":0.75,"VA":0.75,"MD":0.75,"DE":0.70,"CT":0.80,"RI":0.80,"MA":0.80,"VT":0.70,"NH":0.75,"ME":0.75,"AK":0.70,"HI":0.35,"KY":0.80,"WV":0.70,"DC":0.75}',
  'baseline',
  NOW() + INTERVAL '30 days'
),
(
  'state_appreciation',
  '{"FL":4.5,"TX":4.2,"CA":3.8,"AZ":3.8,"CO":3.5,"WA":4.5,"OR":3.2,"ID":3.2,"NV":4.0,"NC":4.5,"GA":4.5,"TN":4.0,"SC":4.2,"VA":3.8,"MD":3.8,"MA":4.5,"NY":3.5,"NJ":3.8,"IL":2.5,"OH":3.2,"MI":3.5,"PA":3.0,"IN":3.2,"MO":3.0,"WI":3.5,"MN":3.8,"IA":2.8,"KS":2.5,"NE":3.0,"SD":3.2,"ND":2.8,"MT":3.8,"WY":3.0,"UT":3.8,"NM":3.5,"AK":2.0,"HI":4.2,"KY":2.8,"WV":2.0,"AR":3.0,"AL":3.0,"MS":2.5,"LA":2.2,"OK":2.8}',
  'baseline',
  NOW() + INTERVAL '30 days'
),
(
  'city_appreciation',
  '{"san francisco":4.2,"san jose":4.5,"oakland":3.8,"los angeles":4.5,"san diego":4.8,"sacramento":3.5,"fresno":3.2,"bakersfield":3.0,"austin":3.2,"dallas":4.5,"houston":4.0,"san antonio":4.0,"fort worth":4.5,"el paso":3.5,"miami":5.0,"tampa":3.5,"orlando":4.0,"jacksonville":4.2,"fort lauderdale":5.0,"seattle":4.8,"bellevue":5.0,"portland":3.2,"spokane":3.5,"denver":3.5,"colorado springs":3.8,"boise":3.2,"salt lake city":3.8,"provo":3.5,"new york":4.0,"brooklyn":4.5,"manhattan":3.5,"boston":4.8,"providence":4.2,"philadelphia":3.5,"pittsburgh":2.8,"newark":3.8,"chicago":2.8,"minneapolis":3.8,"kansas city":3.2,"columbus":3.8,"indianapolis":3.0,"cincinnati":2.8,"cleveland":2.2,"detroit":2.5,"milwaukee":3.0,"st. louis":2.5,"memphis":2.2,"louisville":2.8,"atlanta":4.5,"charlotte":4.5,"nashville":4.0,"raleigh":4.5,"durham":4.2,"birmingham":2.8,"new orleans":2.5,"phoenix":4.0,"tucson":3.8,"las vegas":4.0,"albuquerque":3.5,"henderson":4.0,"washington":4.0,"baltimore":3.5,"richmond":3.8,"virginia beach":3.5}',
  'baseline',
  NOW() + INTERVAL '30 days'
)
ON CONFLICT (key) DO NOTHING;  -- safe to re-run: won't overwrite live data

-- ── Phase 2 additions ─────────────────────────────────────────────────────────
-- Run this block after upgrading from Phase 1 to Phase 2, or include in a fresh deploy.

-- capex_ppi_multiplier: BLS PPI residential construction cost index vs 2019 baseline.
-- The cron job (refresh-market-data) will overwrite this with live FRED data within 24hrs.
-- Multiplier of 1.38 = construction 38% more expensive than 2019 (as of early 2026).
INSERT INTO market_data_cache (key, value, source, valid_until) VALUES
(
  'capex_ppi_multiplier',
  '{"multiplier": 1.38, "baseYear": 2019, "currentIndex": 138.0, "baseIndex": 100.0, "asOf": "2026-01", "source": "baseline"}',
  'baseline',
  NOW() + INTERVAL '1 day'  -- will be refreshed by cron immediately
)
ON CONFLICT (key) DO NOTHING;

-- ── Comments update ───────────────────────────────────────────────────────────
-- market_data_cache keys added in Phase 2:
--   capex_ppi_multiplier   { multiplier, baseYear, currentIndex, baseIndex, asOf, source }
--   (state_appreciation and city_appreciation are now live FHFA data, not just baseline)
--   (vacancy and medianHomeValue are fetched per-ZIP on-demand, not stored in market_data_cache)

-- ── Phase 3 additions ─────────────────────────────────────────────────────────
-- These keys are dynamically created by the weekly/monthly cron. No manual seeding needed.
-- They accumulate as users analyze properties in different markets.
--
-- market_data_cache keys added in Phase 3:
--   case_shiller:{metro_key}  e.g. case_shiller:miami
--     { metro, fredSeries, current, prev1yr, prev3yr, prev5yr,
--       yoyPct, cagr3yr, cagr5yr, trend, asOf, source }
--
--   employment:{city_key}     e.g. employment:austin
--     { rate, nationalRate, yoyChange, trend, asOf, source }
--
--   redfin:{zip}              e.g. redfin:78701
--     { dom, saleToList, medianSalePrice, homesSold, inventory,
--       marketTemp, asOf, source }
--
-- These keys use the same market_data_cache table structure as existing keys.
-- No schema changes required for Phase 3.
--
-- Recommended index addition for prefix queries (case_shiller:*, employment:*, redfin:*):
-- The existing market_data_cache_valid_until_idx covers TTL checks.
-- For production scale with many ZIPs, add:
CREATE INDEX IF NOT EXISTS market_data_cache_key_prefix_idx
  ON market_data_cache (LEFT(key, 12));
-- This speeds up queries like: SELECT * FROM market_data_cache WHERE key LIKE 'redfin:%'
