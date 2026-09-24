-- Wildenroth Match Intelligence — core schema (organizations, squads, people, seasons)
-- Multi-team from day one: every entity that varies per team hangs off `squads`,
-- every entity that varies per club hangs off `organizations`. V1 seeds exactly
-- one organization (SpVgg Wildenroth) and one squad (1. Mannschaft), but nothing
-- here assumes that stays true.

create extension if not exists "pgcrypto";

create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_at timestamptz not null default now()
);

create table squads (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  slug text not null,
  level text, -- e.g. 'Kreisliga', 'B-Klasse' — free text, not an enum: leagues change name/tier across seasons
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (org_id, slug)
);

-- One row per authenticated user, mirroring auth.users. Created by a trigger
-- (see 0006_functions_triggers.sql) so it always exists once a user signs up.
-- No role column here on purpose: authorization must never be read from a
-- field the user's own client could plausibly influence. Roles live in
-- `memberships`, written only by an admin through server-side/service-role code.
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  avatar_url text,
  created_at timestamptz not null default now()
);

create type member_role as enum ('admin', 'trainer', 'viewer');

-- Authorization source of truth. A row with squad_id = null means "org-wide"
-- (used for admins); a row with a squad_id scopes a trainer/viewer to that
-- squad only, per spec ("Trainer darf nur Daten der zugeordneten Squads sehen").
create table memberships (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  squad_id uuid references squads(id) on delete cascade,
  role member_role not null,
  created_at timestamptz not null default now(),
  unique (org_id, profile_id, squad_id)
);

create index memberships_profile_idx on memberships(profile_id);
create index memberships_org_idx on memberships(org_id);
create index memberships_squad_idx on memberships(squad_id) where squad_id is not null;

create table seasons (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  name text not null, -- e.g. '2026/2027'
  start_date date not null,
  end_date date,
  is_current boolean not null default false,
  created_at timestamptz not null default now(),
  unique (org_id, name)
);

create table competitions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  name text not null, -- e.g. 'Kreisliga 1', 'Kreispokal'
  competition_type text not null default 'league' check (competition_type in ('league', 'cup', 'friendly')),
  created_at timestamptz not null default now()
);

-- Opponent / own-club teams. `is_own_club` distinguishes "our" teams (which
-- map 1:1 to a squad via squads.name matching, kept loose deliberately —
-- a team can exist here before a squad object is created for it) from
-- scouted opponents.
create table teams (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  short_name text,
  is_own_club boolean not null default false,
  external_ref jsonb, -- e.g. { "bfv_team_id": "...", "fupa_slug": "..." }
  created_at timestamptz not null default now(),
  unique (org_id, name)
);

-- Identity only. Everything that can legitimately differ season to season
-- (jersey number, which squad, roster status) lives on
-- player_squad_memberships instead — a player who wore #8 for the 1.
-- Mannschaft in 2026/2027 and moves to the 2. Mannschaft with #14 in
-- 2027/2028 must keep BOTH historical rows intact, not have the earlier one
-- overwritten in place.
create table players (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  first_name text not null,
  last_name text not null,
  is_goalkeeper boolean not null default false,
  birth_year int,
  is_active boolean not null default true,
  -- Structured external identifiers for future BFV/FuPa matching (spec
  -- section 2/23) — e.g. { "bfv_player_id": "...", "fupa_id": "..." }. Never
  -- populated by guessing; only ever written once a real, confirmed source
  -- supplies it.
  external_ids jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table player_squad_memberships (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references players(id) on delete cascade,
  squad_id uuid not null references squads(id) on delete cascade,
  season_id uuid not null references seasons(id) on delete cascade,
  -- Free text, deliberately not an enum: the source data (Tippspiel import)
  -- uses German position groups ('Torwart'/'Abwehr'/'Mittelfeld'/'Angriff')
  -- that don't map cleanly onto a fixed set without inventing distinctions
  -- the source doesn't make.
  position text,
  jersey_number int,
  status text not null default 'active' check (status in ('active', 'injured', 'transferred_out', 'retired', 'guest')),
  created_at timestamptz not null default now(),
  unique (player_id, squad_id, season_id),
  -- Two different players on the same squad/season can't legitimately share
  -- a jersey number. Standard Postgres NULL semantics apply here (each NULL
  -- is distinct from every other), so any number of players may still have
  -- no jersey number assigned yet.
  unique (squad_id, season_id, jersey_number)
);

create index player_squad_memberships_squad_idx on player_squad_memberships(squad_id, season_id);
