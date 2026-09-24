-- Data sources, provenance and video recording references.
-- Nothing here stores full match video — only a reference to where it lives
-- (Veo) plus small derived assets (thumbnails/frames), per the free-first
-- storage principle.

create table data_sources (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  source_type text not null check (source_type in ('bfv', 'fupa', 'wildenroth_tippspiel', 'veo', 'trainer', 'manual', 'video_analysis', 'computed_statistic')),
  name text not null,
  config jsonb not null default '{}'::jsonb, -- e.g. base URLs, feed identifiers — never credentials
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- One row per imported/derived datum, so every fact/observation can point at
-- exactly where it came from. `entity_type`/`entity_id` reference whichever
-- table the import landed in (matches, match_events, lineup_players, ...) —
-- deliberately not a typed FK, since it must span many target tables.
create table source_imports (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  data_source_id uuid not null references data_sources(id) on delete cascade,
  entity_type text not null,
  entity_id uuid not null,
  source_identifier text, -- external id/URL for this specific record
  confidence numeric(3,2) check (confidence between 0 and 1),
  raw_payload jsonb,
  imported_at timestamptz not null default now(),
  last_synced_at timestamptz
);

create index source_imports_entity_idx on source_imports(entity_type, entity_id);
create index source_imports_org_idx on source_imports(org_id);

alter table match_events
  add constraint match_events_source_import_fk
  foreign key (source_import_id) references source_imports(id) on delete set null;

-- Marks that two sources disagree on the same fact — surfaced in the UI
-- rather than silently resolved (spec section 9).
create table data_conflicts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  entity_type text not null,
  entity_id uuid not null,
  field_name text not null,
  conflicting_values jsonb not null, -- [{ source_import_id, value }, ...]
  resolved_at timestamptz,
  resolved_by uuid references profiles(id) on delete set null,
  resolution_value jsonb,
  created_at timestamptz not null default now()
);

create index data_conflicts_entity_idx on data_conflicts(entity_type, entity_id) where resolved_at is null;

-- Veo (or other) recording reference. The original video stays with the
-- provider; we only ever store a URL/ID + light metadata.
create table recordings (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references matches(id) on delete cascade,
  provider text not null check (provider in ('veo', 'manual', 'external')),
  external_url text,
  provider_recording_id text, -- extracted Veo recording id, when parseable from the URL
  title text,
  recorded_at timestamptz,
  duration_seconds int,
  sync_status text not null default 'linked' check (sync_status in ('linked', 'processing', 'ready', 'failed', 'waiting_for_worker')),
  added_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (match_id, provider, external_url)
);

create index recordings_match_idx on recordings(match_id);
