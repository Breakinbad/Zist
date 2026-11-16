-- Zist v2: Security and schema improvements
-- Run AFTER migration_user_accounts.sql in the Supabase SQL Editor.
--
-- This migration:
--   1. Adds unique constraint on assessment_instances.access_token
--   2. Enables RLS on signups and consent_events tables
--   3. Creates analytics_events table for privacy-conscious product analytics
--   4. Adds updated_at triggers for audit trail

-- ─────────────────────────────────────────────
-- 1. Unique constraint on access_token
-- ─────────────────────────────────────────────
-- access_token is used for single-record lookups (.single() in Supabase JS).
-- Without a unique constraint, duplicate tokens would cause lookup failures.

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'assessment_instances_access_token_key'
  ) then
    -- Only add if no duplicates exist
    if not exists (
      select access_token from assessment_instances
      group by access_token having count(*) > 1
    ) then
      alter table assessment_instances
        add constraint assessment_instances_access_token_key unique (access_token);
    end if;
  end if;
end $$;

-- ─────────────────────────────────────────────
-- 2. RLS on signups table
-- ─────────────────────────────────────────────
-- The signups table is only written to by the server (service role).
-- No user should be able to read it from the client.
-- Enable RLS with NO policies = block all anon/auth access.

alter table signups enable row level security;

-- Drop any existing policies (in case of re-run)
drop policy if exists "Signups are not publicly readable" on signups;

-- No SELECT policy = anon/auth users cannot read any rows.
-- The service role key bypasses RLS entirely, so server-side inserts still work.

-- ─────────────────────────────────────────────
-- 3. RLS on consent_events table
-- ─────────────────────────────────────────────
-- Consent events are only written by the server (service role).
-- Users should only see their own consent events.

alter table consent_events enable row level security;

drop policy if exists "Users can view own consent events" on consent_events;
create policy "Users can view own consent events"
  on consent_events for select
  using (
    participant_id in (
      select id from participants where user_id = auth.uid()
    )
  );

-- ─────────────────────────────────────────────
-- 4. Analytics events table (privacy-conscious)
-- ─────────────────────────────────────────────
-- Stores anonymous product analytics events.
-- NEVER contains email, answers, scores, or any PII.
-- Only event_type (e.g. 'page_view', 'signup_submitted') + optional anonymous metadata.

create table if not exists analytics_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  event_metadata jsonb default '{}'::jsonb,
  participant_id uuid references participants(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_analytics_events_type
  on analytics_events(event_type);

create index if not exists idx_analytics_events_created_at
  on analytics_events(created_at desc);

-- RLS: analytics_events are only writable by the service role.
-- No user can read or write them from the client.
alter table analytics_events enable row level security;

-- No policies = no anon/auth access. Service role bypasses RLS.

-- ─────────────────────────────────────────────
-- 5. Feedback table
-- ─────────────────────────────────────────────
-- Stores user feedback (message + optional 1-5 rating).
-- Only written by the service role via /api/feedback.

create table if not exists feedback (
  id uuid primary key default gen_random_uuid(),
  message text not null,
  rating smallint check (rating >= 1 and rating <= 5),
  participant_id uuid references participants(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_feedback_created_at
  on feedback(created_at desc);

alter table feedback enable row level security;
-- No policies = service role only (bypasses RLS).

-- ─────────────────────────────────────────────
-- 6. Updated_at audit columns
-- ─────────────────────────────────────────────
-- Add updated_at to participants for tracking profile changes.

alter table participants
  add column if not exists updated_at timestamptz default now();

-- ─────────────────────────────────────────────
-- 7. Unique constraint on participants.email
-- ─────────────────────────────────────────────
-- Prevents duplicate participant records for the same email.
-- The signup API does a find-or-create, but a DB constraint is the
-- last line of defense against race conditions.

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'participants_email_key'
  ) then
    if not exists (
      select email from participants
      group by email having count(*) > 1
    ) then
      alter table participants
        add constraint participants_email_key unique (email);
    end if;
  end if;
end $$;
