# Zist — Feel better. Know why.

## Overview

Zist is a personalized health assessment platform. Users complete short,
evidence-informed assessments (starting with Sleep & Recovery), see their
results, and can create an account to save results, track progress over
time, and receive a personalized health plan.

## Project structure

```
index.html          Landing page
assessment.html      Sleep & Recovery assessment flow
register.html        Sign up / sign in (Supabase Auth)
dashboard.html       Personal health dashboard (saved results)
vercel.json          Vercel route rewrites
api/
  auth-config.js     Returns public Supabase URL + anon key
  signup.js          Landing page email signup → sends assessment link
  link-assessment.js Links an assessment to the authenticated user
  dashboard.js       Returns the user's saved assessment history
  assessment/
    create.js        Admin: create assessment instance (gated)
    get.js           Load assessment by access token
    submit.js        Submit answers, compute scores, save results
  _lib/
    supabase.js      Supabase REST helpers (server-side, service role)
    utils.js         Shared utilities
assets/              Hero + closing lifestyle images (webp + jpg)
supabase/
  migration_user_accounts.sql  SQL: user_id column + RLS policies
```

## Deployment (Vercel)

### Environment variables

Set these in the Vercel project settings → Environment Variables:

| Variable                    | Where used              | Notes                                  |
| --------------------------- | ----------------------- | -------------------------------------- |
| `SUPABASE_URL`              | All API routes          | Supabase project URL                   |
| `SUPABASE_ANON_KEY`         | `/api/auth-config`      | Public anon key (safe for frontend)    |
| `SUPABASE_SECRET_KEY`       | Server-side API routes  | Service role key (NEVER in frontend)   |
| `RESEND_API_KEY`            | `/api/signup`           | Resend.com API key for transactional email |
| `ASSESSMENT_FROM_EMAIL`     | `/api/signup`            | From: address for assessment emails     |
| `SITE_URL`                  | `/api/signup`            | e.g. `https://zisthealth.com`           |
| `ZIST_ADMIN_KEY`            | `/api/assessment/create`| Admin secret for creating assessments   |

### Supabase setup

1. Create a Supabase project (or use existing one).
2. Run `supabase/migration_user_accounts.sql` in the Supabase SQL Editor.
   This adds a `user_id` column to `participants` and enables RLS policies
   so users can only access their own data.
3. Enable Email auth in Supabase → Authentication → Providers → Email.
4. Add your production URL (e.g. `https://zisthealth.com`) to Supabase →
   Authentication → URL Configuration → Site URL, and add `/register` to
   the allowed redirect URLs.

### Deploy

```bash
vercel --prod
```

## Security notes

- The Supabase **anon key** is exposed to the frontend via `/api/auth-config`.
  This is safe — it's designed for client-side use and is gated by RLS policies.
- The **service role key** (`SUPABASE_SECRET_KEY`) is ONLY used in server-side
  API routes and is NEVER returned to the frontend.
- All health data tables have RLS enabled: users can only SELECT their own
  rows (via `participants.user_id = auth.uid()`).
- Assessment linking verifies that the authenticated user's email matches
  the email the assessment was sent to — no cross-account linking.
