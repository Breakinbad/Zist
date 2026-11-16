# Zist — Know what to change. See how you improve.

## Overview

Zist is a personalized health assessment platform. Users complete short,
evidence-informed assessments (starting with Sleep & Recovery), see their
results, and can create an account to save results, track progress over
time, and receive a personalized health plan.

**Tagline:** Know what to change. See how you improve.

## Project structure

```
index.html          Landing page (email signup → assessment link)
assessment.html      Sleep & Recovery assessment flow (auto-saves progress)
register.html        Sign up / sign in (Supabase Auth)
dashboard.html       "Your Zist" dashboard (results, progress, action plan)
vercel.json          Vercel route rewrites
api/
  auth-config.js     Returns public Supabase URL + anon key
  signup.js          Landing page email signup → sends assessment link
  link-assessment.js Links an assessment to the authenticated user
  dashboard.js       GET: user's assessment history; POST: create reassessment
  track.js            Privacy-conscious analytics (no PII)
  feedback.js         User feedback collection
  assessment/
    create.js        Admin: create assessment instance (gated)
    get.js           Load assessment by access token (with saved responses)
    submit.js        Submit answers, compute scores, save results
    save.js          Auto-save partial answers (for resume)
  _lib/               (legacy — not currently imported by routes)
assets/              Hero + closing lifestyle images (webp + jpg)
supabase/
  migration_user_accounts.sql  SQL: user_id column + RLS policies
  migration_v2_security.sql    SQL: v2 security improvements + analytics
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
| `ASSESSMENT_FROM_EMAIL`     | `/api/signup`           | From: address for assessment emails     |
| `SITE_URL`                  | `/api/signup`           | e.g. `https://zisthealth.com`           |
| `ZIST_ADMIN_KEY`            | `/api/assessment/create`| Admin secret for creating assessments   |

### Supabase setup

1. Create a Supabase project (or use existing one).
2. Run `supabase/migration_user_accounts.sql` in the Supabase SQL Editor.
   This adds a `user_id` column to `participants` and enables RLS policies
   so users can only access their own data.
3. Run `supabase/migration_v2_security.sql` in the Supabase SQL Editor.
   This adds:
   - Unique constraint on `assessment_instances.access_token`
   - RLS on `signups` and `consent_events` tables
   - `analytics_events` table for privacy-conscious product analytics
   - `feedback` table for user feedback
   - Unique constraint on `participants.email`
   - `updated_at` column on `participants`
4. Enable Email auth in Supabase → Authentication → Providers → Email.
   - For pilot: consider disabling email confirmation to reduce friction.
5. Add your production URL (e.g. `https://zisthealth.com`) to Supabase →
   Authentication → URL Configuration → Site URL, and add `/register` to
   the allowed redirect URLs.

### Deploy

```bash
vercel --prod
```

## Local development

```bash
# Install dependencies
npm install

# Run a local dev server (any static server works)
npx serve .
# Or use Vercel CLI:
npx vercel dev
```

Set the environment variables in a `.env` file or in your Vercel dev config.

## Security notes

- The Supabase **anon key** is exposed to the frontend via `/api/auth-config`.
  This is safe — it's designed for client-side use and is gated by RLS policies.
- The **service role key** (`SUPABASE_SECRET_KEY`) is ONLY used in server-side
  API routes and is NEVER returned to the frontend.
- All health data tables have RLS enabled: users can only SELECT their own
  rows (via `participants.user_id = auth.uid()`).
- `signups` and `analytics_events` tables have RLS enabled with NO user
  policies — only the service role can read/write them.
- `consent_events` RLS allows users to see only their own consent records.
- Assessment linking verifies that the authenticated user's email matches
  the email the assessment was sent to — no cross-account linking.
- The `analytics_events` table stores only event type + timestamp + optional
  anonymous metadata — never email, answers, or health scores.
- The `feedback` table stores only the message text + optional rating —
  no PII or health data.

## Sleep & Recovery scoring

The Sleep & Recovery assessment produces a 0–100 overall score across six
domains (each scored 0–100, averaged equally):

1. **Sleep Duration** — total sleep time per night
2. **Sleep Regularity** — consistency of sleep/wake timing
3. **Sleep Satisfaction** — subjective sleep quality
4. **Sleep Continuity** — nighttime awakenings, latency
5. **Daytime Alertness & Recovery** — daytime sleepiness, energy
6. **Sleep Timing & Alignment** — alignment with natural circadian rhythm

The score is an evidence-informed wellness measure, not a clinical diagnosis.
It draws on concepts from validated instruments including PSQI, Sleep
Regularity Index, and Epworth Sleepiness Scale, adapted for a consumer
wellness context.

Recommendations are generated based on the user's specific answers (not just
the overall score), prioritizing the three most relevant actions for each
user's pattern. Concerning symptoms are flagged for professional evaluation
rather than diagnosed.

## User journey

1. **Landing page** → user enters email → `/api/signup` sends assessment link
2. **Assessment** (`/a/:token`) → user answers questions → auto-saved →
   submitted → scores + recommendations displayed
3. **Register** (`/register?token=...`) → user creates account → assessment
   linked to their account
4. **Dashboard** (`/dashboard`) → saved results, progress chart, action plan
   with tracking checkboxes, reassessment button

## Testing

Run the site locally and test:

- Signup flow (email → assessment email)
- Assessment completion (all 36 questions → results)
- Assessment resume (close tab mid-assessment → reopen → answers restored)
- Account creation (register → link assessment → dashboard)
- Returning user (sign in → dashboard with previous results)
- Reassessment (dashboard → retake → new results → progress comparison)
- Mobile layout (all pages responsive)
