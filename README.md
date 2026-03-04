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

### Phase 6 — UI/UX & Component Bugs (v39) ✅ Complete

**6 bugs found and fixed.**

| # | File | Bug | Severity | Fix |
|---|---|---|---|---|
| 1 | `components/analyze/cards/CommandCenter.jsx` | **`VERDICT_CFG` not imported.** Used on every render (`VERDICT_CFG[v]`) but only `C, clamp, scoreColor` imported from tokens. `ReferenceError: VERDICT_CFG is not defined` thrown on every analysis results render — the entire CommandCenter (verdict word, score, cash flow metrics) was dead for all users. | **Critical** | Added `VERDICT_CFG` to import from `../tokens`. |
| 2 | `components/analyze/cards/CommandCenter.jsx` + `components/analyze/Results.jsx` | **`NewAnalysisBtn` undefined.** Referenced in CommandCenter (header area when `isEdited`) and in Results (bottom CTA when `isEdited`). Never defined or imported in either file. `ReferenceError` thrown every time a user edited any inline input (price, rent, down, rate, tax). | **Critical** | Defined `NewAnalysisBtn` as a named export in `Results.jsx` with a two-step confirm-before-discard UX (prevents accidental loss of edits). Imported into `CommandCenter.jsx` from `../Results`. |
| 3 | `pages/analyze.js` | **`LOAN_TYPES` not imported.** Used in `fetchAnalysis()` to compute `loanTermYears` via `LOAN_TYPES.find(...)`. `LOAN_TYPES` was undefined — the find always returned `undefined`, and the `|| 30` fallback silently masked the bug. Every analysis submitted with 30-year term regardless of user's actual loan type selection. | **High** | Added `LOAN_TYPES` to the named import from `../components/analyze/tokens`. |
| 4 | `pages/analyze.js` | **`getClosingCostForState` not imported.** Called in the city field change handler to auto-suggest closing costs. Throwing `ReferenceError` every time a user typed a city name — the closing cost auto-fill was completely broken. | **High** | Added `getClosingCostForState` to the named import from `../components/analyze/marketHelpers`. |
| 5 | `components/analyze/cards/ProsAndCons.jsx` | **Dead imports crash potential.** `generateDealMemo` (from `lib/pdfExport`) and `getMarketData` (from `marketHelpers`) imported but never used. `getMarketData()` was called on every render (`const _MD = getMarketData()`) and the result was immediately discarded — unnecessary function call on every render. `generateDealMemo` is an async PDF function that pulls in the jsPDF CDN loader at import time. | **Medium** | Removed both dead imports. Removed the unused `_MD` assignment. |
| 6 | `pages/dashboard.js` | **No `r.ok` guard on `deals/list` fetch.** If the session expires mid-session, the API returns a 401 (or HTML error page). `r.json()` on a non-JSON 401 response throws; the catch sets `dealsLoading=false` but `deals` stays `[]`. User sees a blank "No deals yet" state with no explanation. | **Medium** | Added `r.ok ? r.json() : Promise.reject(r.status)` guard. On 401, redirects to `/auth` immediately. |

**Also fixed:** `scoreColor` was both imported from `tokens` AND re-declared locally in `CommandCenter.jsx`, shadowing the import with a different threshold scale (≥70/50 vs the canonical ≥68/45). Local redeclaration removed — now uses the single canonical `scoreColor` from tokens, consistent with all other cards.

**Phase 6 scope audited:** All 25 card components, `Results.jsx`, `InputComponents.jsx`, `Overlays.jsx`, all 7 pages (`analyze.js`, `dashboard.js`, `share/[token].js`, `compare.js`, `scout.js`, `auth.js`, `index.js`), and all import chains. No UI loading states were missing (all async cards have loading skeletons). No error states were missing (all fetch-backed components handle `null`). No user-facing stale data issues (all data-sourced cards show `asOf` dates).


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

---

## Debug Phase Log

### Phase 1 — Functional Bugs (v39) ✅ Complete

**4 bugs found and fixed. All root-cause fixes — no workarounds.**

| # | File | Bug | Impact |
|---|---|---|---|
| 1 | `pages/api/auth/[...nextauth].js` | Duplicate `pages:` key in `authOptions` object literal. JS last-write-wins — first block's `signOut: '/auth'` was silently overwritten by the second block which lacked it. Sign-out redirected users to NextAuth's default unstyled page. | **Critical** — every sign-out broken |
| 2 | `pages/api/deals/[id].js` | `if (!id)` guard was placed after the GET query block executed, not before. A request with no `id` would run a DB query against `undefined` before the guard fired. | Medium — wrong execution order |
| 3 | `next.config.js` | CSP `connect-src` listed `http://data.insideairbnb.com` (HTTP). Modern browsers and strict CSP enforcement reject mixed-content connect attempts. Should be `https://`. | Medium — CSP violation in strict browsers |
| 4 | `lib/strDataFetcher.js` | `baseUrl` hardcoded as `http://data.insideairbnb.com/...`. All outbound fetches initiated with HTTP. While Node.js follows the 301 redirect to HTTPS, this relies on redirect behavior and wastes a round-trip on every cold fetch. Changed to `https://` directly. | Low-Medium — unnecessary redirect on every STR fetch |

### Phase 2 — Logical Bugs (v39) ✅ Complete

**5 bugs found and fixed. All root-cause fixes — no workarounds.**

| # | File | Bug | Impact |
|---|---|---|---|
| 1 | `pages/analyze.js` | `getMgmtRateBenchmark` called on line 395 but missing from import. `ReferenceError` thrown every time `buildPayload()` ran — the analysis form could never submit with a NARPM-derived mgmt rate. | **Critical** — every analysis submission broke mgmt rate defaulting |
| 2 | `components/analyze/marketHelpers.js` | `breakEvenRentFor10CoC` computed as `(total + targetCF) / 25`, where `total` included vacancy and mgmt calculated at current rent. Break-even rent changes those variable costs — the formula understated the required rent. Correct: `(fixedCosts + targetCF) / rentMultiplier`. | **High** — wrong number shown to every user on the analysis card |
| 3 | `pages/api/analyze.js` | AI prompt schema described `breakEvenRentForPositiveCF` and `breakEvenRentFor10CoC` with no math formulas. Gemini was left to infer the algebra, producing inconsistent or incorrect values depending on prompt interpretation. | **High** — AI-generated break-even values may be wrong |
| 4 | `lib/pdfExport.js` | Used `_MD.rentGrowthDefault` where `_MD` was never imported or defined. PDF export threw `ReferenceError: _MD is not defined` on every download. Fixed to use `data._settings.rentGrowthRate` (already in the analysis object). | **Critical** — PDF export completely broken |
| 5 | `components/analyze/cards/NOIBreakEven.jsx` | NOI sublabel read "Excl. mortgage only" — imprecise and confusing. NOI excludes all debt service (mortgage + PMI), not just mortgage. Changed to industry-standard "Before debt service". | **Low** — misleading label for users |

### Phase 3 — Syntax Errors (v39) ✅ Complete

**ZERO syntax bugs found. Full structural audit confirmed codebase is syntactically clean.**

Audit scope:
- All 104 JS/JSX files checked for delimiter balance using a state-machine parser (handles strings, template literals, comments)
- Raw character-count cross-check confirmed every file: all braces, parens, brackets balanced to zero
- All API route files verified: exactly one `export default` each, none missing, no duplicates
- `cards/index.js` barrel exports verified against all 25 card file actual exports — all names match
- Template literals: `analyze.js` AI prompt verified properly closed (270 backticks, even count)
- Config files: `vercel.json` and `package.json` are valid JSON
- Duplicate declaration scan run against all API files — all flagged cases confirmed to be in different function scopes (false positives)
- Regex literal patterns in `fetch-listing.js` confirmed balanced by raw count after parser false-positive investigation

### Phase 4 — Security Vulnerabilities (v39) ✅ Complete

**4 security bugs found and fixed.**

| # | File | Vulnerability | Severity | Fix |
|---|---|---|---|---|
| 1 | `pages/api/fetch-listing.js` | **SSRF** — user-supplied URL fetched with no hostname validation. Attacker could probe AWS metadata (169.254.169.254), localhost, or internal Vercel infrastructure. No auth required (rate limit 20/min). | **High** | Added `ALLOWED_LISTING_HOSTS` allowlist of 20+ real-estate domains. Protocol checked (`http:`/`https:` only). URL parsed and hostname validated before any fetch call. |
| 2 | `pages/api/cron/refresh-market-data.js`, `health-check.js`, `market-digest.js` | **Auth bypass** — cron check was `if (cronSecret && ...)`. When `CRON_SECRET` env var is unset (common in dev/staging), the entire auth check is skipped. Anyone can trigger expensive data refresh jobs. | **High** | Changed to `if (!cronSecret \|\| ...)` — fails **closed**. Missing env var now returns 401 rather than allowing access. |
| 3 | `pages/api/flood-risk.js`, `climate-risk.js`, `school-rating.js`, `str-data.js`, `safmr-rent.js`, `zori-for-city.js`, `market-data.js`, `mortgage-rate.js` | **No rate limiting** — 8 public data enrichment routes had zero rate limiting. An attacker could hammer third-party APIs (FEMA, Census, HUD, FRED, Inside Airbnb) via the server indefinitely. | **Medium** | Added `rateLimit(req, { max: 30, windowMs: 60_000 })` to all 8 routes. |
| 4 | `pages/api/deals/email.js` | **HTML injection in email** — `address`, `city`, and `narrative` fields inserted directly into email HTML template without escaping. Attacker sends `<script>` or `<img onerror>` to their own inbox. | **Low** | Added `esc()` helper that escapes `&`, `<`, `>`, `"`. Applied to all user-controlled fields in template. |

**Areas confirmed clean:** All deals routes enforce ownership via `user_id` (no IDOR). Admin route requires email in `ADMIN_EMAILS`. Stripe webhook uses `constructEvent` signature verification. Share tokens use `crypto.randomBytes` (36^10 ≈ 3.6T combinations). Referral uses DB RPC idempotency. Stripe `returnPath` sanitized against open redirect. No server secrets in client bundle. `sitemap.xml.js` uses `getServerSideProps` (server-only). Cron now fail-closed on missing secret.

### Phase 5 — Performance & Reliability (v39) ✅ Complete

**1 bug found and fixed.**

| # | File | Issue | Severity | Fix |
|---|---|----|---|---|
| 1 | `pages/api/analyze.js` | **Unguarded `geminiRes.json()`** — after confirming `geminiRes.ok === true`, the next line calls `.json()` outside any try/catch. If Gemini returns a 200 with a non-JSON body (HTML error page, CDN gateway response, network garbling), this throws an unhandled `SyntaxError`. Next.js catches it and returns a 500 with a stack trace exposed to the client. | **Medium** | Changed to `geminiRes.json().catch(() => null)` + explicit null guard returning 502 with clean message. |

**Audit items confirmed clean:** All 40+ server-side `fetch()` calls have `AbortSignal.timeout()` (three apparent positives were false — signal was set on nearby lines). In-memory rate limiter has `store.size > 5000` pruning guard. All `Promise.all()` calls are safe — Supabase client never throws (returns `{data, error}`), and helper functions (`getBuildingPermits`, `getMetroGrowth`, `getHvsVacancy`) all catch internally. Cache TTLs correct across all 12 routes. `maxDuration` set on all heavy routes (analyze=60s, fetch-listing=45s, crons=120s, etc.). `Promise.allSettled` used in cron batch refresh and neighborhood parallel enrichment. No infinite loops or unbounded retry logic. Gemini retry capped at 2 attempts. `JSON.parse()` of Gemini text response already wrapped in try/catch.

### Phase 7 — Regression Audit (v39) ✅ Complete

**2 regressions found and fixed. All prior fixes verified intact.**

| # | File(s) | Regression | Severity | Fix |
|---|---|---|---|---|
| 1 | `components/analyze/Results.jsx` → `cards/CommandCenter.jsx` | **Circular import causing `NewAnalysisBtn` to be `undefined` at runtime.** Phase 6 defined `NewAnalysisBtn` in `Results.jsx` and imported it into `CommandCenter.jsx`. But `Results.jsx` imports `CommandCenter` via `cards/index`. Cycle: `Results → cards/index → CommandCenter → Results`. In webpack/Next.js module initialization, whichever module is evaluated first sees the other as `{}`. `NewAnalysisBtn` would be `undefined` in `CommandCenter` at mount time — restoring exactly the crash that Phase 6 fixed. | **Critical** | Moved `NewAnalysisBtn` to `InputComponents.jsx` (a leaf module with no upstream dependencies). `Results.jsx` and `CommandCenter.jsx` both import it from `InputComponents`. Circular dependency eliminated — import chain is now a clean DAG: `tokens → marketHelpers → InputComponents → cards/* → Results → pages`. |
| 2 | `components/analyze/Results.jsx` | **Dead `FloatingChat` import.** `Results.jsx` imported `{ ShareToolbar, FloatingChat }` from `Overlays`. `FloatingChat` is rendered once in `pages/analyze.js` (outside `Results`). It is not rendered anywhere in `Results.jsx`. Dead import carried across all phases undetected. | **Low** | Removed `FloatingChat` from the import — `import { ShareToolbar } from './Overlays'`. |

**All prior fixes confirmed intact across all phases (1–6):** Phase 1 auth/CSP/HTTPS fixes, Phase 2 `getMgmtRateBenchmark`/break-even formula/PDF export fixes, Phase 4 SSRF allowlist/cron fail-closed/rate limiting/email escaping, Phase 5 unguarded `geminiRes.json()`, Phase 6 `VERDICT_CFG`/`NewAnalysisBtn`/`LOAN_TYPES`/`getClosingCostForState`/dead-imports/dashboard guard.

**All user journeys traced end-to-end:**
- URL paste → debounced fetch → field autofill → validate → confirm → `runAnalysis` → AI prompt → `fetchAnalysis` → `setResults` → Results render → inline edit → `recalcFromEdits` → `isEdited=true` → `NewAnalysisBtn` → confirm discard ✅
- Deal save → `savedDealId` → neighborhood enrichment → school/SAFMR/flood/climate/STR async fires → PATCH deal with neighborhood → Results props updated ✅
- Auth → session → token check → analysis → `updateSession` → token count refreshed in nav ✅
- Dashboard load → deals/list (with `r.ok` guard) → deal card → click → `/analyze?deal=id` → `setResults` → results stage ✅
- Share → `crypto.randomBytes` token → public URL → SSR `getServerSideProps` → public read-only view ✅
- Token purchase → Stripe → webhook → DB atomic RPC → session refresh → toast → modal dismissed ✅

**All 25 card barrel exports verified:** Every name in `cards/index.js` resolves to an actual named export in its corresponding `.jsx` file.
