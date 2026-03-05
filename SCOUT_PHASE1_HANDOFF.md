# RentalIQ Scout — Phase 1 Handoff

## What Phase 1 Is

A complete rebuild of `/scout` that shows ranked US rental markets the moment the page loads — no form to fill, no city to enter. Markets are scored and sorted by investment attractiveness using data we already own. Filters live in a sidebar and update results instantly with no API calls.

## What Phase 1 Is Not

Phase 1 does **not** show individual property listings. It surfaces the best **markets** to look in, then sends users to pre-filtered Zillow/Redfin/Realtor.com searches. The user finds a listing there, then pastes it into `/analyze`.

This is the correct Phase 1 because:
- It works on day one with zero new infrastructure
- The market intelligence is genuinely useful and data-backed
- It avoids the fundamental constraint (Zillow/Redfin block scraping) entirely

---

## Files Added / Changed

### New: `lib/scoutMarkets.js`
The core scoring engine. Pure JS, no async, no API calls.

**What it contains:**
- `METRO_STATE` — 40+ metro → state code mapping
- `METRO_MEDIAN_PRICE` — 2025 Q1 NAR/ZHVI median home price estimates
- `METRO_RENT_2BR` — HUD FMR 2BR rent estimates by metro
- `STATE_TAX`, `STATE_INS`, `STATE_APPR` — mirrors from `marketData.js` BASELINE (kept in sync manually; Phase 2 cron can push live values)
- `METRO_DISPLAY` — friendly city name + state + region labels
- `scoreMetro(key)` — 0–100 composite score:
  - Cap rate component (40%) — CBRE/JLL calibrated, from `marketBenchmarkFetcher.js`
  - Landlord score component (30%) — from `landlordLaws.js`
  - Expense efficiency (15%) — inverse of state tax + insurance burden
  - Appreciation component (15%) — state 5yr FHFA CAGR
- `estimateCashFlow(metro, price, rent, stateCode)` — 20% down, 7% rate, PMI formula
- `getRankedMarkets(filters)` — returns sorted, filtered market array
- `getMarketTagline(market)` — one-line "why" summary per market
- `buildZillowUrl()`, `buildRedfinUrl()`, `buildRealtorUrl()` — precision search URL builders

### Replaced: `pages/scout.js`
Complete rewrite. Old version required entering a city and clicking submit. New version:
- Loads ranked markets immediately on arrival
- Sidebar with 7 filters: goal, price max, beds, property type, min cap rate, min landlord score, region
- Filters update results instantly via `useMemo` — no re-render lag
- Each market card shows: rank, city, tagline, cap rate + cash flow + appreciation pills, landlord badge, score bar
- Three search buttons per card: Zillow (blue), Redfin (red), Realtor.com (outlined red)
- Expandable detail row: median price, HUD rent, MFR cap rate, tax/insurance rates, eviction notice period
- Active filter count badge on filter toggle button
- Full mobile responsiveness (sidebar hides, filter toggle appears)
- No emojis anywhere
- Animations match the rest of the product (riq-fadeup, riq-lift hover)

---

## Scoring Methodology

```
Scout Score (0–100) =
  (cap_rate / 8%) × 100  ×  0.40   ← cap rate efficiency
  + landlord_score         ×  0.30   ← legal environment
  + expense_score          ×  0.15   ← inverse of tax + insurance burden
  + (appr_rate - 2%) / 3% ×  0.15   ← appreciation potential
```

Goal-adjusted re-weighting:
- **Cash Flow goal:** score × 0.6 + normalized_cap_rate × 0.4
- **Appreciation goal:** score × 0.5 + normalized_appr × 0.5
- **Balanced:** raw composite score

Cash flow estimate formula (shown on cards, clearly labelled as estimate):
```
monthly_rent - (mortgage + tax/mo + insurance/mo + vacancy(8%) + mgmt(10%) + maintenance(1%/yr) + capex($150))
```
Assumed: 20% down, 7.00% 30yr fixed, median home price, HUD 2BR FMR rent.

---

## Search URL Construction

### Zillow
Uses Zillow's `searchQueryState` JSON param (the same param their own UI writes to the URL). Encodes: price max, min beds, property type (sf/mf flags), sort by days listed. This produces a real, working filtered search — tested manually.

Format: `https://www.zillow.com/{city-slug}-{state}/?searchQueryState={encoded-json}`

### Redfin
Uses Redfin's `/filter/` path format with comma-separated key=value pairs.

Format: `https://www.redfin.com/{STATE}/{City-Name}/filter/max-price=N,min-beds=N,max-days-on-market=180`

### Realtor.com
Uses Realtor.com's URL path filters.

Format: `https://www.realtor.com/realestateandhomes-search/{city_state}/price-na-{max}/beds-{min}`

---

## Phase 2 Preview (do not build until instructed)

Phase 2 introduces actual listing discovery using:
1. **Google Custom Search API** (100 free queries/day)
2. **Gemini** to parse Google result snippets into structured listing data
3. **RentalIQ math engine** applied to each parsed listing to compute cap rate/cash flow
4. **Supabase `scout_deals` table** to cache deals and serve them fresh

Required before starting Phase 2:
- Google Custom Search API key (or confirm using Gemini search grounding)
- Supabase schema approval
- Decision on paid vs. free access gate
- Staleness TTL decision (suggested: 60 days with user "sold" flagging)

**Do not begin Phase 2 until Oscar confirms.**

---

## Known Limitations of Phase 1

1. **Listings are not shown** — only markets. Users must find listings on Zillow/Redfin themselves.
2. **Cash flow estimates are modeled**, not from real listings. Clearly labelled as estimates.
3. **Median prices and HUD rents** are hardcoded 2025 Q1 values. They drift over time. Phase 2 cron can keep them fresh.
4. **No verification that a market has available inventory** at the target price. The Zillow/Redfin links will show whatever exists.
5. **Tampa, Orlando, Cape Coral** score lower than their cap rates suggest because FL insurance (3.5%/yr) heavily penalizes the expense efficiency score. This is accurate — FL insurance is a real drag on cash flow.

---

## Data Freshness

All data in Phase 1 is static at deploy time:
- Cap rates: CBRE/JLL survey data (updated annually)
- Landlord scores: Eviction Lab + NCSL (updated when laws change — we update manually)
- Tax rates: Tax Foundation 2024
- Insurance rates: NAIC 2022 + state DOI actions through 2025
- Appreciation: 5yr FHFA CAGR

The cron job that refreshes `market_data_cache` in Supabase does NOT yet feed Scout. Phase 2 will wire that up.

