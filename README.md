# RentalIQ — What's New in This Release

## For setup instructions, see SETUP.md

---

## Scout — AI Rental Deal Discovery

The Scout page is rebuilt from the ground up. Here's what it does now:

### Phase 1 — Market Intelligence (no AI needed)
The moment you open Scout, you see a ranked list of the best US rental markets — no form to fill in. Every market is scored using cap rates, landlord-friendliness laws, property tax burden, insurance rates, and appreciation history.

Each market card shows:
- The investment score (0–100)
- Estimated cap rate and monthly cash flow
- Landlord-friendliness rating for the state
- Three buttons that open pre-filtered searches on Zillow, Redfin, and Realtor.com — all the filters (price, beds, property type) are already set when you click

Filters on the left sidebar update everything instantly — no page reload.

### Phase 2 — AI Deal Discovery
The "AI Deal Discovery" tab uses Gemini AI + live Google search to find actual active listings on Zillow/Redfin/Realtor.com. Results are real listing URLs — not invented.

Each discovered deal shows:
- Address, price, beds/baths
- Estimated cap rate and cash flow (modelled at 20% down, 7% rate)
- A "View Listing" button that opens the original listing
- An "Full Analysis →" button that pre-loads the listing into RentalIQ's analyzer
- A "Sold?" button — if you click through and the property is already sold, report it and it disappears for everyone

**Who gets to search:**
- New users: 2 free tokens on signup (1 for Scout AI search + 1 for a full property analysis)
- Returning users: 1 token per search
- Visitors without an account: 1 free AI search per device, then prompted to sign up

### Phase 3 — Confidence Scoring + Verification
Every deal now shows how trustworthy it is:
- **Green / "Verified active"** — Gemini re-checked this listing recently and confirmed it's still for sale
- **Green / "High confidence"** — Brand new listing, low days on market
- **Amber / "Medium confidence"** — Less than 2 weeks old, not yet re-verified
- **Grey / "Verify before acting"** — Getting older or has received user reports — click through to check

The daily background job (runs at 5am UTC) does two things:
1. Re-checks flagged or aging listings by asking Gemini to search for them again
2. Searches a fresh batch of markets for new listings — covers all 40+ markets on a weekly rolling cycle, not just the same top 10 every day

Listings with shorter days-on-market when discovered expire faster (a listing already sitting on market for 60 days gets a shorter shelf life than a brand-new listing).

---

## Other improvements in this release

- **CommandCenter mortgage field** — Monthly mortgage payment is now editable directly in the analysis editor. Change it and the implied interest rate updates automatically.
- **Auto-filled form fields** — After pasting a Zillow/Redfin URL, fields that were successfully pulled from the listing are hidden. You only see what needs your attention.
- **Grid layout fixed** — No more half-empty boxes on the results page.
- **No emojis** — Removed throughout for a cleaner, more professional look.
- **Larger URL bar** — The main URL input on the Analyze page is bigger and more prominent.

---

## How the daily background job works

Vercel runs `/api/cron/scout-deals` every morning at 5am UTC automatically. It:
1. Deletes listings older than 30 days, or that users have flagged as sold 3+ times
2. Re-verifies up to 5 aging or flagged listings by asking Gemini to search for them
3. Searches 6 new markets for fresh listings (rotating through all 40+ markets across the week)

No action needed from you. It just runs.

---

## Phase 1 Bug Fixes (Functional Audit)

### Auth page — email sign-in removed
The magic link / email sign-in form was visible but broken (the backend was already removed). The sign-in page now shows only Google sign-in, which is the only method that works. Copy updated: "2 free tokens — 1 analysis + 1 Scout search."

### Scout — returning guest UX fixed
Guests who already used their free AI search now see the sign-up CTA immediately when they open the Scout AI tab — instead of a grey disabled button with no explanation. The tab subtitle also updates from "1 free search" to "Free search used" once consumed.

### Schema — default tokens corrected
The Supabase schema default for new users was `tokens = 1` but the app creates accounts with `tokens = 2`. Schema now matches.

---

## Phase 2 Bug Fixes (Logical Audit)

### scout-deals.js — state-specific expense rates
Cap rate and cash flow calculations for AI-discovered deals were using a hardcoded 1% for both property tax and insurance regardless of state. For Florida (3.5% insurance) and Texas (2.2% insurance), this produced significantly overstated cap rates. Now uses the same state-specific rate tables as the rest of the app.

### Scout market cards — "Cap Rate" relabeled
The "Cap Rate" pill on market cards showed the CBRE market benchmark (what investors in that market achieve), not the cap rate of a specific deal. Relabeled to "Mkt Cap Rate" to avoid confusion with the deal-level cap rate shown on AI-discovered listings.

---

## Phase 3 Bug Fixes (Syntax Audit)

### .env.example — email section corrected
`EMAIL_SERVER` and `EMAIL_FROM` were listed as required for "magic-link sign-in" — a feature that was already removed. Both variables are now commented out and the section is marked OPTIONAL, describing them as reserved for future email features only.

### No breaking syntax errors found
Full scan of all 50+ JS/JSX files across pages, API routes, lib, and components. All component references resolved, all imports valid, all API routes have `export default` and proper error handling. Silent `.catch(() => {})` calls reviewed — all are intentional fallbacks for optional enrichment data.
