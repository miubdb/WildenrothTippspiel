-- Analysis pipeline jobs, training recommendations, reports, AI usage, audit log.

create type analysis_stage as enum ('candidate_detection', 'scene_observation', 'tactical_inference', 'report_generation');
create type analysis_job_status as enum ('queued', 'waiting_for_worker', 'processing', 'requires_review', 'completed', 'failed');

create table analysis_jobs (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references matches(id) on delete cascade,
  stage analysis_stage not null,
  status analysis_job_status not null default 'queued',
  provider text not null, -- 'none' | 'local_vision' | 'anthropic' | ...
  model text,
  input_ref jsonb not null default '{}'::jsonb, -- e.g. { sceneId } or { recordingId }
  error text,
  retry_count int not null default 0,
  started_at timestamptz,
  completed_at timestamptz,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index analysis_jobs_match_idx on analysis_jobs(match_id);
create index analysis_jobs_status_idx on analysis_jobs(status);

alter table evidence_items
  add constraint evidence_items_analysis_job_fk
  foreign key (analysis_job_id) references analysis_jobs(id) on delete set null;

create table ai_usage (
  id uuid primary key default gen_random_uuid(),
  analysis_job_id uuid not null references analysis_jobs(id) on delete cascade,
  provider text not null,
  model text,
  input_tokens int,
  output_tokens int,
  cost_estimate_usd numeric(10,4),
  created_at timestamptz not null default now()
);

-- A training recommendation must be able to name the scenes it came from.
-- Enforced structurally (not null, non-empty checked in app code) rather than
-- letting a recommendation exist that no scene backs.
create table training_recommendations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  squad_id uuid not null references squads(id) on delete cascade,
  title text not null,
  rationale text not null, -- "Anlass" — must reference the supporting scenes in prose
  training_goal text not null,
  organization_form jsonb not null default '{}'::jsonb, -- { playerCount, fieldSize, goals, rules }
  coaching_points text[] not null default '{}',
  progression text,
  regression text,
  supporting_scene_ids uuid[] not null default '{}',
  created_by uuid references profiles(id) on delete set null, -- null = derived automatically from analysis
  created_at timestamptz not null default now()
);

create type report_type as enum ('post_match', 'scouting');
create type report_status as enum ('draft', 'published');

create table reports (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  squad_id uuid not null references squads(id) on delete cascade,
  match_id uuid references matches(id) on delete cascade, -- null for a pure scouting report on a future opponent not yet a scheduled match
  report_type report_type not null,
  status report_status not null default 'draft',
  created_by uuid references profiles(id) on delete set null,
  published_at timestamptz,
  created_at timestamptz not null default now()
);

create index reports_squad_idx on reports(squad_id);

create table report_versions (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references reports(id) on delete cascade,
  version int not null,
  content jsonb not null, -- structured sections, each carrying its own evidence refs (see lib/reports)
  pdf_path text, -- Supabase Storage path, generated on demand and cached
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (report_id, version)
);

create table audit_logs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  actor_id uuid references profiles(id) on delete set null,
  entity_type text not null,
  entity_id uuid not null,
  action text not null, -- e.g. 'scene.corrected', 'scene.rejected', 'evidence.confirmed'
  before_value jsonb,
  after_value jsonb,
  comment text,
  created_at timestamptz not null default now()
);

create index audit_logs_entity_idx on audit_logs(entity_type, entity_id);
create index audit_logs_org_idx on audit_logs(org_id, created_at desc);
