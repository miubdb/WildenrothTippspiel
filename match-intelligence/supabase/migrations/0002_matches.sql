-- Matches, lineups, events — the factual (FACT-level) match record.

create type match_status as enum ('scheduled', 'live', 'finished', 'postponed', 'cancelled');
create type home_away as enum ('home', 'away');

create table matches (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  squad_id uuid not null references squads(id) on delete cascade,
  season_id uuid not null references seasons(id) on delete cascade,
  competition_id uuid references competitions(id) on delete set null,
  opponent_team_id uuid not null references teams(id) on delete restrict,
  matchday int, -- nullable: friendlies/cup rounds have none
  home_away home_away not null,
  kickoff_at timestamptz not null,
  status match_status not null default 'scheduled',
  our_score int,
  opponent_score int,
  ht_our_score int,
  ht_opponent_score int,
  venue text,
  goalscorer_squad_confirmed_at timestamptz, -- optional: admin confirms matchday squad is final
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index matches_squad_season_idx on matches(squad_id, season_id);
create index matches_kickoff_idx on matches(kickoff_at);

create type match_lineup_side as enum ('own', 'opponent');

create table match_lineups (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references matches(id) on delete cascade,
  side match_lineup_side not null,
  formation text, -- e.g. '4-4-2'; only ever set when a source actually states it (see CLAUDE-level rule: never guess formation)
  formation_source text, -- data_sources.id as text, or 'trainer' — free text provenance tag
  created_at timestamptz not null default now(),
  unique (match_id, side)
);

create table lineup_players (
  id uuid primary key default gen_random_uuid(),
  lineup_id uuid not null references match_lineups(id) on delete cascade,
  -- Own-side rows reference a real player; opponent-side rows may only have a
  -- name + jersey number (we don't maintain opponent squads as `players` rows).
  player_id uuid references players(id) on delete set null,
  opponent_player_name text,
  jersey_number int,
  is_starting boolean not null default false,
  minutes_played int,
  sub_in_minute int,
  sub_out_minute int,
  created_at timestamptz not null default now(),
  check (player_id is not null or opponent_player_name is not null)
);

create index lineup_players_lineup_idx on lineup_players(lineup_id);

create type match_event_type as enum ('goal', 'own_goal', 'yellow_card', 'second_yellow', 'red_card', 'substitution', 'penalty_scored', 'penalty_missed', 'halftime', 'fulltime');

create table match_events (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references matches(id) on delete cascade,
  event_type match_event_type not null,
  side match_lineup_side, -- null for halftime/fulltime markers
  minute int,
  stoppage_minute int,
  player_id uuid references players(id) on delete set null,
  opponent_player_name text,
  related_player_id uuid references players(id) on delete set null, -- assist / sub-off partner
  detail jsonb not null default '{}'::jsonb,
  source_import_id uuid, -- FK added in 0004 after source_imports exists
  created_at timestamptz not null default now()
);

create index match_events_match_idx on match_events(match_id, minute);
