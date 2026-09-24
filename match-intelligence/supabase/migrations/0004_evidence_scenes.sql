-- THE core model of this project: Evidence First.
--
-- Every tactical statement the platform ever shows must trace back to a
-- `scenes` row with a verification status, and every AI-authored claim about
-- that scene must trace back to an `evidence_items` row with an explicit
-- level (fact / observation / inference / hypothesis) and a video time range.
-- A hypothesis must never be presentable as a fact — that distinction is
-- enforced here (check constraints) and again in application code
-- (lib/evidence), never only in the UI.

create type scene_status as enum ('candidate', 'ai_observed', 'needs_review', 'trainer_verified', 'trainer_corrected', 'rejected');
create type scene_source as enum ('ai_detection', 'trainer_note', 'manual', 'match_event_anchor');

create table trainer_notes (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references matches(id) on delete cascade,
  author_id uuid not null references profiles(id) on delete restrict,
  minute int not null,
  second int,
  category text, -- free text, e.g. 'Umschalten', 'Standard' — trainer's own words, not a fixed taxonomy
  note_text text not null,
  linked_scene_id uuid, -- FK added below once scenes exists
  created_at timestamptz not null default now()
);

create index trainer_notes_match_idx on trainer_notes(match_id, minute);

-- A candidate time window, before any judgement about what's in it.
create table scene_candidates (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references matches(id) on delete cascade,
  recording_id uuid references recordings(id) on delete set null,
  start_second int not null,
  end_second int not null,
  source scene_source not null,
  detection_type text, -- e.g. 'goal', 'shot', 'set_piece', 'transition' — the Stage 1 detector's own label
  trainer_note_id uuid references trainer_notes(id) on delete set null,
  match_event_id uuid references match_events(id) on delete set null,
  created_at timestamptz not null default now(),
  check (end_second > start_second)
);

create index scene_candidates_match_idx on scene_candidates(match_id);

-- A promoted candidate that has (or is getting) an actual analysis attached.
create table scenes (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references matches(id) on delete cascade,
  recording_id uuid references recordings(id) on delete set null,
  scene_candidate_id uuid references scene_candidates(id) on delete set null,
  start_second int not null,
  end_second int not null,
  status scene_status not null default 'candidate',
  created_by uuid references profiles(id) on delete set null, -- null for pure AI creation
  reviewed_by uuid references profiles(id) on delete set null,
  reviewed_at timestamptz,
  review_comment text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_second > start_second)
);

create index scenes_match_idx on scenes(match_id);
create index scenes_status_idx on scenes(status);

alter table trainer_notes
  add constraint trainer_notes_linked_scene_fk
  foreign key (linked_scene_id) references scenes(id) on delete set null;

create table scene_tags (
  id uuid primary key default gen_random_uuid(),
  scene_id uuid not null references scenes(id) on delete cascade,
  tag text not null, -- e.g. 'fehlender_druck_auf_ballfuehrer', 'tiefe_schnittstelle_offen'
  applied_by uuid references profiles(id) on delete set null, -- null = AI-applied
  created_at timestamptz not null default now(),
  unique (scene_id, tag)
);

create index scene_tags_tag_idx on scene_tags(tag);

create type identification_status as enum ('confirmed', 'probable', 'unknown');

-- A player appearing in a scene. Never auto-promoted to "confirmed" from a
-- single frame — see lib/evidence's identification rules.
create table scene_participants (
  id uuid primary key default gen_random_uuid(),
  scene_id uuid not null references scenes(id) on delete cascade,
  player_id uuid references players(id) on delete set null,
  jersey_number int,
  team_side match_lineup_side not null,
  identification_status identification_status not null default 'unknown',
  identification_confidence numeric(3,2) check (identification_confidence between 0 and 1),
  confirmed_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index scene_participants_scene_idx on scene_participants(scene_id);
create index scene_participants_player_idx on scene_participants(player_id) where player_id is not null;

create type evidence_level as enum ('fact', 'observation', 'inference', 'hypothesis');

-- The atomic unit of truth. Every evidence_items row anchors to a concrete
-- scene (and therefore a concrete video time range via that scene), and
-- carries the level it was made at. `created_by_ai` + a null `confirmed_by`
-- means "AI said this, nobody has verified it yet" — such a row must never
-- be surfaced in a verified-only aggregate (enforced in lib/evidence and the
-- season-trend queries, which join through scenes.status).
create table evidence_items (
  id uuid primary key default gen_random_uuid(),
  scene_id uuid not null references scenes(id) on delete cascade,
  level evidence_level not null,
  text text not null,
  confidence numeric(3,2) check (confidence between 0 and 1),
  created_by_ai boolean not null default false,
  analysis_job_id uuid, -- FK added in 0005 once analysis_jobs exists
  structured_data jsonb not null default '{}'::jsonb, -- Stage 2 JSON: ballLocation, players, uncertainties, ...
  confirmed_by uuid references profiles(id) on delete set null,
  confirmed_at timestamptz,
  corrected_from_text text, -- previous text, set when a trainer edits an AI-authored item (audit trail)
  created_at timestamptz not null default now()
);

create index evidence_items_scene_idx on evidence_items(scene_id);
create index evidence_items_level_idx on evidence_items(level);
