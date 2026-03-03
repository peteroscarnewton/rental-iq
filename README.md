# RentalIQ

Paste any property listing URL. Get an honest rental investment analysis — cap rate, cash flow, 5-year return, a buy/pass verdict — in under 30 seconds.

## What it does

- **Analyze a Listing** — paste a Zillow, Redfin, or Realtor.com URL (or enter details manually). The AI runs full investment underwriting: cap rate, cash-on-cash, GRM, DSCR, break-even rent, IRR, wealth projection, stress testing, and a pros/cons narrative.
- **Scout** — tell it your budget, goal (cash flow / appreciation / balanced), and situation. Get 3 ranked US markets with exact Zillow search filters, 20+ metrics per market, and a realistic example deal — all grounded in live Redfin, FHFA, BLS, and landlord law data.
- **Compare** — select 2–3 saved deals from your dashboard and compare them side-by-side across every metric. BEST/WORST badges highlight the winner per row.
- **Token system** — each full analysis costs 1 token. New users get 1 free token. More are available via Stripe.
- **Dashboard** — history of every deal you've analyzed, each loadable with one click.
- **Shareable links** — make any analysis public with a single click.
- **Email reports** — send any analysis to yourself as a formatted HTML email.
- **Referrals** — share your referral code. Both you and the new user get +1 token when they sign in and run their first analysis.
- **Neighborhood data** — walk score, transit, schools, vacancy rate, price-to-rent ratio, market pulse (Redfin), and home price history (S&P Case-Shiller) fetched automatically after each analysis.
- **Live market data** — all key economic data refreshes automatically via cron. No manual updates required.
- **Landlord law scores** — all 50 states scored 0–100. Auto-monitored quarterly against Eviction Lab.
- **Admin analytics** — /admin dashboard with signups, analyses, revenue, verdict distribution, top markets, token economy health.
- **PWA** — installable on iOS and Android.

---

## Live data sources (all free, no API keys required)

| Data | Primary Source | Fallback | Refresh | Status |
|---|---|---|---|---|
| Mortgage rates (30yr/15yr/ARM) | FRED / Freddie Mac PMMS | Freddie Mac Direct → CFPB | Daily | ✅ Live |
| Rent growth default | FRED / BLS CPI Shelter | BLS Public Data API v2 | Weekly | ✅ Live |
| State & city appreciation | FHFA HPI quarterly CSV | Zillow ZHVI | Quarterly | ✅ Live |
| CapEx baseline multiplier | FRED / BLS PPI construction | BLS Public Data API v2 | Monthly | ✅ Live |
| Home price trend | S&P Case-Shiller via FRED | — | Monthly | ✅ Live |
| Market pulse (DOM, sale-to-list) | Redfin weekly ZIP data | — | Weekly | ✅ Live |
| Employment / unemployment | FRED BLS LAUS | — | Bi-weekly | ✅ Live |
| Vacancy rate by ZIP | Census ACS B25004 | — | On demand | ✅ Live |
| Neighborhood amenities | OpenStreetMap Overpass | — | On demand | ✅ Live |
| Median rent / income / home value | Census ACS | — | On demand | ✅ Live |
| Landlord law compliance | Eviction Lab + NCSL | — | Quarterly | ✅ Live |
| 10-Year Treasury yield | FRED DGS10 | — | Daily | ✅ Phase 5 |
| S&P 500 trailing returns (3/5/10yr) | FRED SP500 | — | Daily | ✅ Phase 5 |
| PMI rate by LTV band | MGIC/Essent/Radian rate cards | — | Quarterly | ✅ Phase 5 |
| Metro rent growth (ZORI) | Zillow Observed Rent Index | — | Monthly | ✅ Phase 5 |
| Closing cost defaults by state | CFPB ClosingCorp averages | — | Annual | ✅ Phase 5 |
| FEMA flood risk by address | FEMA NFHL API | — | On demand | ✅ Phase 6 |
| Building permits by metro | Census Building Permits Survey | — | Monthly | ✅ Phase 6 |
| Population + job growth | Census ACS 1yr + BLS LAUS | — | Annual | ✅ Phase 6 |
| School quality scores | NCES Common Core of Data | — | Annual | ✅ Phase 6 |
| Market cap rates by metro | CBRE survey + computed | — | Quarterly | ✅ Phase 7 |
| City-level rent control | NLIHC Renter Protections DB | — | Annual | ✅ Phase 7 |
| Property mgmt fees by metro | NARPM annual survey | — | Annual | ✅ Phase 7 |
| Metro vacancy (Census HVS) | Census Housing Vacancy Survey | — | Quarterly | ✅ Phase 7 |
| HUD SAFMR rent by ZIP/beds | HUD Small Area FMR API | — | Annual | ✅ Phase 7 |
| Insurance rate live tracking | III state facts + NAIC 2025 calibration | `state_ins_rates` | Annual | ✅ Phase 8 |
| STR income potential | Inside Airbnb + fallback estimates | `str_data:{slug}:{beds}br` | Quarterly | ✅ Phase 8 |
| Climate / disaster risk score | FEMA National Risk Index API | `climate_risk:{county_fips}` | Annual | ✅ Phase 8 |
| Property tax assessment trend | Tax Foundation + Lincoln Institute 2024 | Static in taxTrendFetcher.js | Annual | ✅ Phase 8 |
| SAFMR on-demand endpoint | HUD Small Area FMR (client-side) | `safmr_rent:{zip}:{beds}` | Annual | ✅ Phase 8 |

---

## Automated self-maintenance

RentalIQ is designed to run indefinitely without manual maintenance.

### Completed: Phases 1–4

**Phase 4A — Data redundancy**
Every critical feed has a backup: FRED → Freddie Mac direct → CFPB for rates; FHFA → Zillow ZHVI for appreciation; FRED → BLS API for CPI/PPI. Fallback usage is logged in `_fallback_audit:*` cache keys and surfaced in the admin dashboard.

**Phase 4B — Dynamic landlord law monitoring**
The weekly cron checks Eviction Lab's policy database for law changes vs. stored data. Detected changes are queued as `pending_review` in Supabase and trigger an admin email. Changes are never auto-applied — they require human review and a code deploy.

**Phase 4C — Live-data-grounded Scout**
The `/api/scout-market` endpoint injects this week's actual Redfin market temperature, FHFA appreciation, BLS unemployment, and landlord scores into the AI prompt. Scout no longer relies on training knowledge for market conditions.

**Phase 4D — Proactive city coverage + market movement alerts**
The weekly `market-digest` cron (Sundays 4am UTC) maintains employment data for 90+ top investor markets regardless of user activity. It compares the current snapshot to last week's and emails when significant changes occur (≥25bps rate move, employment trend flips).

### Planned: Phases 5–8

See `HANDOFF.md` for the complete technical specification of all 20 remaining data items across 4 phases.

**Phase 5 — Financial Benchmark Intelligence** ✅ Complete
10yr Treasury yield + S&P 500 returns shown alongside every IRR. PMI accurate by LTV. ZORI metro rent growth. Closing costs pre-filled by state.

**Phase 6 — Property & Address Intelligence** ✅ Complete
FEMA flood risk (zone + insurance cost estimate $900–$6,500/yr) shown per address. Building permits supply pipeline for 50+ metros. Population + job growth demand signals. School quality tier (NCES CCD) for SFR/condo.

**Phase 7 — Market Context & Benchmarking** ✅ Complete
Deals benchmarked against metro-specific cap rates (CBRE/computed), Census HVS regional vacancy, and NARPM local management fee rates. City rent control database (50+ cities). HUD SAFMR ZIP-level rent anchors. Management fee default now driven by local NARPM benchmark instead of flat 10%.

**Phase 8 — Living Intelligence Layer** ✅ Complete
Insurance rates live-tracked via III/NAIC annual data (replaces static table). STR income potential from Inside Airbnb with regulatory alert database (20 markets). FEMA NRI climate risk scores by county. Property tax assessment trend + cap data for all 50 states. SAFMR ZIP-level rent now fetched client-side via /api/safmr-rent after neighborhood geocode provides ZIP.

**Bug Audit — v25 Post-Phase-8** ✅ Complete
14 bugs identified and fixed across 3 severity tiers. Critical: `body.city` ReferenceError crashing CBSA resolution on every analysis (dropping Phase 6 supply/demand from all prompts); `stateTaxRate` function reference used as numeric value (NaN in all expense math); STR annual revenue 100× too low (occupancy decimal divided by 100 twice — $285/yr instead of $28,500/yr). High: `getMonthlyPmi` wired up to inject pre-computed dollar amount instead of delegating arithmetic to Gemini; `getClosingCostPct` activated so state-level closing cost defaults are used when user leaves field blank; Florida insurance baseline corrected 40% upward by importing authoritative `INS_RATE_BASELINE`; duplicate `getSupabaseAdmin` dynamic import removed. Medium: duplicate CITY_SLUGS key, conflicting tax rate tables synced to single canonical source, dead MODE_SETTINGS capex values removed, CSV parser replaced with RFC 4180-compliant state machine (handles `"$1,500"` format), duplicate MN in STATE_TAX_DATA, and four dead Phase 8 Supabase helpers removed from marketData.js.

**Trust & Conversion Pass — v27** ✅ Complete
Four new landing page sections: data source attribution strip (FRED/HUD/BLS/Census/FHFA/FEMA badges), social proof testimonials (3 user personas), comparison table (RentalIQ vs. Spreadsheet vs. Generic AI, 9 features), FAQ accordion (7 objection-answering questions with animated expand/collapse). New FAQ nav link in header. Market data freshness badge added to CommandCenter results card. API now returns `_marketFreshness` for client-side display.

**Bug Audit Pass III — v26 Data Truthfulness + Build Errors** ✅ Complete
Build-blocking syntax error in cron: orphaned `import {` on line 43 of `refresh-market-data.js` (brace mismatch +1, crashes cron on first invocation). OpportunityCostPanel card claimed Treasury yield was "current" with no date attribution — fixed to show `asOf` date from `benchmarks` prop, consistent with all other data-sourced cards in the app.

**Client-Side Bug Fixes — v25 Post-Audit** ✅ Complete
Six bugs in `pages/analyze.js`: broken `runAnalysis` catch block (errors silently swallowed, 57s timeout fires instead); stale `results` closure in neighborhood callback (school quality + SAFMR fetches silently skipped for SFR/condo); `MD_BASELINE` stale tax rates (pre-2024 values, diverged from Tax Foundation 2024 source); `MD_BASELINE` stale insurance rates (FL:2.10 vs authoritative 3.50 — wrong for ~4s cold load and on market-data fetch failure); dead `capex` in `MODE_DEFAULTS` (removed from server, still present on client); management button hardcoded "10% - hands off" replaced with dynamic NARPM benchmark rate.

---

## Deploy in 5 steps — no terminal required

### Step 1 — Get a Gemini API key
1. Go to aistudio.google.com → sign in → Get API key → Create API key
2. Copy the key

### Step 2 — Set up Supabase (free tier works)
1. Go to supabase.com → New project
2. Save your database password
3. Go to SQL Editor → paste supabase-schema.sql → Run
4. Go to Settings → API → copy Project URL and service_role key

### Step 3 — Set up Google OAuth
1. Go to console.cloud.google.com
2. Create a project → APIs & Services → Credentials → Create OAuth Client ID
3. Application type: Web application
4. Authorized redirect URIs: https://YOUR_VERCEL_URL/api/auth/callback/google
5. Copy Client ID and Client Secret

### Step 4 — Deploy to Vercel
1. Push all files to a GitHub repository
2. Go to vercel.com → New Project → import your repo
3. Add environment variables:

| Variable | Where to get it |
|---|---|
| GEMINI_API_KEY | Google AI Studio |
| NEXTAUTH_SECRET | generate-secret.vercel.app |
| NEXTAUTH_URL | Your Vercel URL |
| GOOGLE_CLIENT_ID | Google Cloud Console |
| GOOGLE_CLIENT_SECRET | Google Cloud Console |
| SUPABASE_URL | Supabase Settings → API |
| SUPABASE_SERVICE_ROLE_KEY | Supabase Settings → API |
| STRIPE_SECRET_KEY | Stripe Dashboard → Developers |
| STRIPE_WEBHOOK_SECRET | Step 5 below |
| EMAIL_SERVER | smtp://resend:YOUR_KEY@smtp.resend.com:465 |
| EMAIL_FROM | RentalIQ <noreply@yourdomain.com> |
| NEXT_PUBLIC_APP_URL | Your production URL |
| ADMIN_EMAILS | Comma-separated admin emails |

4. Click Deploy

### Step 5 — Set up Stripe webhook
1. Stripe Dashboard → Developers → Webhooks → Add endpoint
2. URL: https://YOUR_VERCEL_URL/api/tokens/webhook
3. Events: checkout.session.completed
4. Copy Signing secret → STRIPE_WEBHOOK_SECRET

---

## Architecture

```
pages/
  analyze.js            full analysis page (profile + results)
  scout.js              market finder with live data intel
  dashboard.js          deal history, tokens, referrals
  compare.js            side-by-side multi-deal comparison
  admin.js              analytics dashboard (gated)
  share/[token].js      public read-only share page

pages/api/
  analyze.js            AI underwriting (Gemini 2.5 Flash)
  chat.js               contextual chat about the analysis
  fetch-listing.js      scrapes Zillow / Redfin / Realtor.com
  neighborhood.js       amenities, walk score, schools
  rent-estimate.js      HUD FMR + Census ACS + FRED triangulation
  scout-market.js       live-data-grounded Scout intelligence
  market-data.js        client-side market data endpoint
  cron/
    refresh-market-data.js   main data refresh (daily)
    market-digest.js         weekly snapshot + alerts (Sundays 4am UTC)
    health-check.js          data freshness monitoring (every 6hr)

lib/
  fredFetcher.js        FRED API: rates, CPI, PPI, unemployment
  fhfaFetcher.js        FHFA HPI: appreciation rates
  caseShillerFetcher.js S&P Case-Shiller price trends
  redfinFetcher.js      Redfin weekly market pulse
  censusFetcher.js      Census ACS: vacancy, values, rent
  landlordLaws.js       50-state landlord law scores
  landlordLawUpdater.js Eviction Lab monitoring
  benchmarkFetcher.js   Phase 5: Treasury, S&P 500, PMI, ZORI, closing costs
  addressIntelFetcher.js Phase 6: FEMA flood risk, NCES school quality
  supplyDemandFetcher.js Phase 6: building permits, population + job growth
  marketData.js         cache orchestration + baseline fallbacks
```

## Local development
```bash
npm install
cp .env.example .env.local
# Fill in .env.local with real keys
npm run dev
```
App runs at http://localhost:3000.

---

## Changelog

### Bug Audit Pass II (March 2025)
7 issues across all severity tiers resolved. No features changed — all fixes are correctness and deployment safety:
- **globals.css background** — `#f4f4f7` → `#f5f5f8` (matches design token, prevents paint flash)
- **PWA manifest** — `start_url` corrected to `/analyze`; `background_color` synced to `#f5f5f8`
- **Duplicate font loading** — `privacy.js` and `terms.js` removed their own Google Fonts `<link>` tags (already loaded globally by `_app.js`)
- **SSR hydration mismatch** — `new Date()` in privacy/terms replaced with static date string (prevents React warning on production build)
- **NextAuth missing `pages` config** — added `signIn: '/auth', error: '/auth'` so OAuth error flows use our branded page, not the default NextAuth UI
- **Undocumented env vars** — `CRON_SECRET` (required), `SMTP_*` (optional, cron alerts), `SKIP_REDFIN_REFRESH` (optional flag) all added to `.env.example`
- **README stale reference** — removed `fallbackFetcher.js` from architecture section (file was deleted in prior session)
