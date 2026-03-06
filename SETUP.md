# RentalIQ — Setup Guide

This is the only thing you need to do manually to get Scout working.
Everything else runs automatically once you deploy to Vercel.

---

## One-time database setup (5 minutes)

You only do this once. After that, the app handles everything itself.

### Step 1 — Open Supabase

1. Go to [supabase.com](https://supabase.com) and sign in
2. Click on your RentalIQ project
3. In the left sidebar, click **SQL Editor**
4. Click **New query** (the + button at the top)

### Step 2 — Run the setup script

1. Open the file called `SETUP_DATABASE.sql` (it's in this zip)
2. Select all the text inside it (Ctrl+A or Cmd+A)
3. Copy it
4. Paste it into the Supabase SQL editor
5. Click the green **Run** button

You'll see a success message at the bottom. That's it — database is ready.

### What this does

It creates four new tables in your database:
- **scout_deals** — stores AI-discovered rental listings
- **guest_usage** — tracks who has used their free trial
- **guest_ip_usage** — prevents abuse by tracking usage per IP address
- **scout_search_history** — remembers which markets were recently searched

---

## After deploying to Vercel

Nothing else to do. The app will:
- Automatically search for new deals every morning at 5am
- Automatically verify that older listings are still active
- Automatically clean up sold or expired listings
- Give each new user 2 free tokens when they sign up

---

## Environment variables (already set if your app was working before)

If you're deploying for the first time, you need these in your Vercel project settings under **Environment Variables**:

| Variable | Where to get it |
|----------|----------------|
| `GEMINI_API_KEY` | Google AI Studio → API Keys |
| `NEXTAUTH_SECRET` | Any random string (generate one at randomkeygen.com) |
| `NEXTAUTH_URL` | Your Vercel app URL, e.g. `https://rentaliq.vercel.app` |
| `SUPABASE_URL` | Supabase → Settings → API → Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API → service_role key |
| `NEXT_PUBLIC_SUPABASE_URL` | Same as SUPABASE_URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Settings → API → anon key |
| `CRON_SECRET` | Any random string — protects the daily background jobs |

---

## If something isn't working

**Scout page shows no deals** — The daily job hasn't run yet. Wait until 5am UTC, or trigger it manually by visiting:
`https://your-app.vercel.app/api/cron/scout-deals` with the Authorization header set to your CRON_SECRET. (You can ask me to do this for you.)

**"Database error" on Scout** — The SETUP_DATABASE.sql hasn't been run yet. Follow Step 2 above.

**Listings say "Verify before acting"** — Normal for newly discovered listings. Confidence upgrades after the daily verification job runs and confirms them as still active.

