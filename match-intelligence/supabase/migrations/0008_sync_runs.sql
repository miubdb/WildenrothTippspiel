-- Records one execution of "Datenquellen → <Provider> → Synchronisieren"
-- (spec: admin sync workflow). Gives the admin UI something concrete to show
-- ("12 neu, 3 aktualisiert, 40 unverändert, 1 Konflikt, zuletzt: ...") and a
-- history of past syncs, rather than only a live in-request result that's
-- gone once the page reloads.

create type sync_run_status as enum ('running', 'completed', 'failed');

create table sync_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  data_source_id uuid not null references data_sources(id) on delete cascade,
  squad_id uuid not null references squads(id) on delete cascade,
  status sync_run_status not null default 'running',
  matches_created int not null default 0,
  matches_updated int not null default 0,
  matches_unchanged int not null default 0,
  conflicts_created int not null default 0,
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  started_by uuid references profiles(id) on delete set null
);

create index sync_runs_data_source_idx on sync_runs(data_source_id, started_at desc);

alter table sync_runs enable row level security;

create policy sync_runs_select on sync_runs for select using (public.is_org_member(org_id));
create policy sync_runs_write on sync_runs for all
  using (public.is_admin(org_id)) with check (public.is_admin(org_id));
