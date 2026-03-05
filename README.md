# RentalIQ v40 — Release Notes

## What's New in v40

### Scout Page — Phase 1 (Complete Rebuild)
The Scout page is rebuilt from the ground up. It no longer requires users to enter a city and submit a form. Instead:

- **Ranked market cards load immediately** on page arrival, sorted by investment attractiveness
- **Sidebar filters** (goal, price max, beds, property type, min cap rate, min landlord score, region) update results instantly via client-side scoring — no API calls
- **Each market card** shows: rank badge, city, investment tagline, cap rate + estimated cash flow + appreciation pills, landlord-friendliness badge, composite score bar
- **Three search buttons per card** open pre-built, investor-filtered searches on Zillow, Redfin, and Realtor.com — all filters (price, beds, property type, days on market) are baked into the URL
- **Expandable detail row** per card: median home price, HUD 2BR FMR rent, multi-family cap rate, state tax/insurance rates, eviction notice period, data source
- **New `lib/scoutMarkets.js`** scoring engine: 0–100 composite score from cap rate (40%), landlord score (30%), expense efficiency (15%), appreciation (15%)
- No emojis, no loading states (all data is static), full mobile responsiveness

### Results Page — v40 Fixes (from previous session)
- Grid layout: `OpportunityCostPanel` and `ScoreBreakdown` are now separate full-width rows — eliminates half-empty grid when OpportunityCost returns null (cash purchase / missing IRR)
- ScoreBreakdown: ScoreRing moved to header row so bars always have full card width; ring never overflows or pushes layout
- CommandCenter: Monthly mortgage payment added as an editable field in the edit row. Computed from the same PMT formula as the analysis engine. Editing it back-solves for the implied interest rate via bisection (60 iterations, <0.01 precision)
- Zero emojis remaining across all components (verified with grep)
- InputForm: auto-filled fields (status === 'success') collapse after URL fetch; unfilled/failed/unverified fields remain visible. Auto-filled summary chip row shows what was pulled from the URL
- Hero URL bar: enlarged to 16px font, 15px input padding, wider bar, larger h1

---

## Architecture

```
pages/
  analyze.js          — Main analysis page (input → results)
  scout.js            — Market discovery (Phase 1: ranked markets, Phase 2: listings)
  api/
    analyze.js        — Core analysis engine (Gemini + RentalIQ math)
    fetch-listing.js  — URL → structured listing data pipeline
    scout-market.js   — AI market intelligence (token-gated)
    ...

lib/
  scoutMarkets.js     — NEW: Market scoring/ranking engine for Scout Phase 1
  marketData.js       — Market data cache + baselines
  marketBenchmarkFetcher.js — Cap rates by metro (CBRE/JLL calibrated)
  landlordLaws.js     — Landlord-friendliness scores by state
  geminiClient.js     — Gemini API with model fallback chain
  ...

components/analyze/
  Results.jsx         — Results page layout (3-zone: verdict, proof, due diligence)
  cards/
    CommandCenter.jsx — Hero verdict card with inline editors (incl. mortgage field)
    ScoreBreakdown.jsx — Score ring + bars (fixed layout)
    ...
```

---

## Environment Variables Required

```
GEMINI_API_KEY          — Google AI Studio key (gemini-2.5-flash)
NEXTAUTH_SECRET         — NextAuth session secret
NEXTAUTH_URL            — Full URL of deployment (https://yourapp.vercel.app)
SUPABASE_URL            — Supabase project URL
SUPABASE_SERVICE_ROLE_KEY — Supabase service role key (server-only)
NEXT_PUBLIC_SUPABASE_URL  — Same URL, public
NEXT_PUBLIC_SUPABASE_ANON_KEY — Supabase anon key
```

---

## Scout Roadmap

### Phase 1 — COMPLETE (this release)
Market intelligence engine. Scored/ranked markets. Pre-built platform search URLs. No new infrastructure.

### Phase 2 — AWAITING APPROVAL
Google Custom Search + Gemini listing discovery. Daily cron populates Supabase `scout_deals` table with real listing URLs parsed from Google search snippets. RentalIQ math applied to each. Paid-tier gated.

**Required before Phase 2:**
- Google Custom Search API key
- Supabase `scout_deals` schema approval
- Access tier decision (paid vs. all signed-in users)
- Staleness TTL decision

### Phase 3 — FUTURE
Active listing verification, "report as sold" flagging, confidence scoring by listing age.

---

## Data Sources

| Data | Source | Freshness |
|------|--------|-----------|
| Cap rates | CBRE/JLL (calibrated from HUD SAFMR + Census ACS) | Annual |
| Landlord scores | Eviction Lab + NCSL state law analysis | When laws change |
| State tax rates | Tax Foundation 2024 | Annual |
| Insurance rates | NAIC 2022 + state DOI 2025 | Annual |
| Appreciation | 5yr FHFA CAGR by state | Quarterly |
| Mortgage rate | FRED PMMS (live via cron) | Weekly |
| HUD rent estimates | HUD SAFMR 2025 | Annual |
| Median home prices | NAR + Zillow ZHVI Q1 2025 | Quarterly |

---

## Scout Phase 2 — AI Deal Discovery

### New Files

| File | Purpose |
|------|---------|
| `lib/fingerprint.js` | Client-side device fingerprinting (canvas + hardware signals) for guest free trial |
| `pages/api/guest-usage.js` | Check/consume guest free trial — GET to check, POST to consume |
| `pages/api/scout-deals.js` | Serve cached deals (GET) or trigger live Gemini search (POST) |
| `pages/api/scout-deals/flag.js` | POST to flag a deal as sold (3 flags → hidden) |
| `pages/api/cron/scout-deals.js` | Daily cron (5am UTC) — searches top 10 markets, stores in Supabase |
| `SUPABASE_PHASE2_SCHEMA.sql` | All CREATE TABLE statements — run in Supabase SQL editor |

### Supabase Setup Required

**Run `SUPABASE_PHASE2_SCHEMA.sql` in your Supabase SQL Editor before deploying.**

Creates 3 new tables:
- `scout_deals` — AI-discovered listings with cap rate/cash flow metrics
- `guest_usage` — device fingerprint → free trial tracking
- `guest_ip_usage` — IP-level daily cap (8 uses/IP/day)

### Token Changes

- **New users**: 2 tokens on signup (was 1). 1 for Analyze + 1 for Scout AI search.
- **Existing users**: unaffected.
- **Guests**: 1 free Scout AI search per device (fingerprint-gated).

### Free Trial Anti-Abuse Stack

1. **Device fingerprint** (canvas + screen + timezone + hardware) — survives incognito
2. **IP hash daily cap** — 8 free uses per IP per day (stops VPN cycling)
3. **Rate limiting** — 3 POST/minute on `/api/scout-deals`
4. **Fingerprint validation** — 32-char hex format enforced server-side

### Cron Schedule

`/api/cron/scout-deals` runs daily at 5am UTC. Searches top 10 markets by cash flow score. Skips markets that already have 8+ fresh deals. Removes deals expired > 30 days.

Protect with `CRON_SECRET` env var in Vercel dashboard.

### Deal Freshness

- Deals live for 30 days from `first_seen`
- "Sold?" button on each card → increments `flagged_sold`  
- Deals with `flagged_sold >= 3` are hidden immediately
- Confidence indicator: "Found today" (green) → "Found 14d ago" (amber) → "Found 30d ago" (muted)
