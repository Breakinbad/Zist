-- Zist: Add user account linking + RLS policies
-- Run this in the Supabase SQL Editor after deploying the app.
--
-- This migration:
--   1. Adds a user_id column to participants (links to auth.users)
--   2. Enables RLS on all health-data tables
--   3. Creates policies so users can only see their own data
--   4. Creates a dashboard view for convenient querying

-- ─────────────────────────────────────────────
-- 1. Link participants to auth users
-- ─────────────────────────────────────────────

-- Add user_id column if it doesn't exist
alter table participants
  add column if not exists user_id uuid references auth.users(id) on delete set null;

create index if not exists idx_participants_user_id
  on participants(user_id);

-- ─────────────────────────────────────────────
-- 2. Row Level Security
-- ─────────────────────────────────────────────

-- participants: users can see their own row
alter table participants enable row level security;

drop policy if exists "Users can view own participant record" on participants;
create policy "Users can view own participant record"
  on participants for select
  using (user_id = auth.uid());

drop policy if exists "Users can update own participant record" on participants;
create policy "Users can update own participant record"
  on participants for update
  using (user_id = auth.uid());

-- assessment_instances: users can see assessments linked to their participant
alter table assessment_instances enable row level security;

drop policy if exists "Users can view own assessments" on assessment_instances;
create policy "Users can view own assessments"
  on assessment_instances for select
  using (
    participant_id in (
      select id from participants where user_id = auth.uid()
    )
  );

-- assessment_domain_scores: users can see scores for their own assessments
alter table assessment_domain_scores enable row level security;

drop policy if exists "Users can view own domain scores" on assessment_domain_scores;
create policy "Users can view own domain scores"
  on assessment_domain_scores for select
  using (
    assessment_instance_id in (
      select ai.id from assessment_instances ai
      join participants p on p.id = ai.participant_id
      where p.user_id = auth.uid()
    )
  );

-- assessment_responses: users can see responses for their own assessments
alter table assessment_responses enable row level security;

drop policy if exists "Users can view own responses" on assessment_responses;
create policy "Users can view own responses"
  on assessment_responses for select
  using (
    assessment_instance_id in (
      select ai.id from assessment_instances ai
      join participants p on p.id = ai.participant_id
      where p.user_id = auth.uid()
    )
  );

-- assessment_types: publicly readable (they're just metadata)
alter table assessment_types enable row level security;

drop policy if exists "Assessment types are publicly readable" on assessment_types;
create policy "Assessment types are publicly readable"
  on assessment_types for select using (true);

-- ─────────────────────────────────────────────
-- 3. Dashboard view (optional convenience)
-- ─────────────────────────────────────────────

create or replace view user_assessments as
  select
    ai.id,
    ai.status,
    ai.overall_score,
    ai.result_summary,
    ai.started_at,
    ai.completed_at,
    at.slug as assessment_slug,
    at.name as assessment_name,
    at.version as assessment_version,
    p.user_id
  from assessment_instances ai
  join participants p on p.id = ai.participant_id
  join assessment_types at on at.id = ai.assessment_type_id;
