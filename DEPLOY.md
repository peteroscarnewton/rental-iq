# RentalIQ — Deployment Checklist

Follow these steps in order. Each section has a checkbox. Don't skip steps.

---

## 1. Supabase Database

1. Go to [supabase.com](https://supabase.com) → your project → **SQL Editor**
2. Click **New Query**, paste the entire contents of `supabase-schema.sql`, click **Run**
3. Verify in **Table Editor** that you see: `users`, `deals`, `purchases`, `market_data_cache`
4. Go to **Settings → API** — copy your **Project URL** and **service_role** key

> Safe to re-run on an existing database — all statements are idempotent.

---

## 2. Google OAuth

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create a project (or use existing) → **APIs & Services → Credentials**
3. **Create Credentials → OAuth 2.0 Client ID** → Web application
4. Add Authorized redirect URI: `https://yourdomain.com/api/auth/callback/google`
5. Copy **Client ID** and **Client Secret**

---

## 3. Stripe

1. Go to [dashboard.stripe.com](https://dashboard.stripe.com) → **Developers → API Keys**
2. Copy **Secret key** (`sk_live_...`)
3. Go to **Developers → Webhooks → Add endpoint**
   - URL: `https://yourdomain.com/api/tokens/webhook`
   - Event: `checkout.session.completed`
4. Copy **Signing secret** (`whsec_...`)

---

## 4. Resend (Email)

1. Go to [resend.com](https://resend.com) → **API Keys** → create key → copy it
2. Go to **Domains** → add and verify your domain (e.g. `rentaliq.app`)
3. SMTP password = your API key, username = `resend`

---

## 5. Gemini API

1. Go to [aistudio.google.com](https://aistudio.google.com) → **Get API Key** → copy it
2. **Important:** In [Google Cloud Console](https://console.cloud.google.com), make sure **billing is enabled** on the project that owns the API key. Google Search grounding requires billing to be set up (free tier still works, but billing must be configured).

---

## 6. Vercel — Environment Variables

Go to your Vercel project → **Settings → Environment Variables** and add:

| Variable | Where to get it |
|---|---|
| `NEXTAUTH_SECRET` | `openssl rand -base64 32` |
| `NEXTAUTH_URL` | `https://yourdomain.com` |
| `GOOGLE_CLIENT_ID` | Step 2 |
| `GOOGLE_CLIENT_SECRET` | Step 2 |
| `SUPABASE_URL` | Step 1 |
| `SUPABASE_SERVICE_ROLE_KEY` | Step 1 |
| `GEMINI_API_KEY` | Step 5 |
| `STRIPE_SECRET_KEY` | Step 3 |
| `STRIPE_WEBHOOK_SECRET` | Step 3 |
| `RESEND_API_KEY` | Step 4 |
| `EMAIL_FROM_DOMAIN` | your verified domain e.g. `rentaliq.app` |
| `EMAIL_SERVER` | `smtp://resend:YOUR_RESEND_KEY@smtp.resend.com:587` |
| `EMAIL_FROM` | `RentalIQ <noreply@yourdomain.com>` |
| `NEXT_PUBLIC_APP_URL` | `https://yourdomain.com` |
| `ADMIN_EMAILS` | your email address |
| `ADMIN_EMAIL` | your email address |
| `CRON_SECRET` | `openssl rand -base64 32` |

---

## 7. Deploy

```bash
# Push to GitHub and connect to Vercel, or:
vercel --prod
```

---

## 8. Post-Deploy Checks

After deploying, verify these work:

- [ ] `/` — landing page loads
- [ ] Sign in with Google works
- [ ] Sign in with email magic link works (check inbox)
- [ ] Paste a Zillow URL → fields auto-fill (may take 10-15s on first load)
- [ ] Run Analysis → analysis result shows
- [ ] `/admin` accessible with your email
- [ ] Manually trigger cron: `curl -H "Authorization: Bearer $CRON_SECRET" https://yourdomain.com/api/cron/health-check`

---

## Common Issues

**"GEMINI_API_KEY not set"** — add the key in Vercel env vars, redeploy.

**Google Search grounding fails / listing fields missing** — enable billing on your Google Cloud project (aistudio.google.com → API key → associated project).

**Magic link emails not arriving** — check `EMAIL_SERVER` format exactly matches: `smtp://resend:YOUR_KEY@smtp.resend.com:587`. Verify domain in Resend dashboard.

**Stripe webhook not firing** — confirm webhook URL is `https://yourdomain.com/api/tokens/webhook` (not `/api/webhook` or similar), and event is `checkout.session.completed`.

**`/admin` shows 401** — add your email to `ADMIN_EMAILS` env var (comma-separated, no spaces).

**Cron jobs not running** — Vercel crons require a Pro plan. On Hobby plan, trigger them manually via curl.
