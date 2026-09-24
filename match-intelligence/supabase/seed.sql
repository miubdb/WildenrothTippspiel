-- Local development seed data.
--
-- Auth users are NOT created here (Supabase auth.users needs real sign-up /
-- the Auth admin API) — after running `supabase start` and this seed, sign up
-- normally at /login with any email, then run the membership INSERT at the
-- bottom (with your new user's id) to make yourself an admin.

insert into organizations (id, name, slug) values
  ('00000000-0000-0000-0000-000000000001', 'SpVgg Wildenroth', 'spvgg-wildenroth');

insert into squads (id, org_id, name, slug, level) values
  ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000001', '1. Mannschaft', '1-mannschaft', 'Kreisliga');

insert into seasons (id, org_id, name, start_date, is_current) values
  ('00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000001', '2026/2027', '2026-08-01', true);

insert into competitions (id, org_id, name, competition_type) values
  ('00000000-0000-0000-0000-000000000030', '00000000-0000-0000-0000-000000000001', 'Kreisliga', 'league');

insert into teams (id, org_id, name, short_name, is_own_club) values
  ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000001', 'SpVgg Wildenroth', 'Wildenroth', true),
  ('00000000-0000-0000-0000-000000000040', '00000000-0000-0000-0000-000000000001', 'FC Musterhausen', 'Musterhausen', false);

insert into players (id, org_id, name, jersey_number, position) values
  ('00000000-0000-0000-0000-000000000050', '00000000-0000-0000-0000-000000000001', 'Max Mustermann', 8, 'Mittelfeld'),
  ('00000000-0000-0000-0000-000000000051', '00000000-0000-0000-0000-000000000001', 'Michael Torwart', 1, 'Torwart');

insert into player_squad_memberships (player_id, squad_id, season_id, status) values
  ('00000000-0000-0000-0000-000000000050', '00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000020', 'active'),
  ('00000000-0000-0000-0000-000000000051', '00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000020', 'active');

insert into matches (id, org_id, squad_id, season_id, competition_id, opponent_team_id, matchday, home_away, kickoff_at, status, our_score, opponent_score)
values
  ('00000000-0000-0000-0000-000000000060', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000030', '00000000-0000-0000-0000-000000000040', 1, 'home', '2026-08-30 14:00:00+02', 'finished', 2, 1),
  ('00000000-0000-0000-0000-000000000061', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000030', '00000000-0000-0000-0000-000000000040', 2, 'away', '2026-09-06 15:00:00+02', 'scheduled', null, null);

insert into data_sources (org_id, source_type, name, config) values
  ('00000000-0000-0000-0000-000000000001', 'manual', 'Manuelle Eingabe', '{}');

-- After signing up locally, run this with your real auth user id to become
-- org admin (replace <YOUR_USER_ID>):
-- insert into memberships (org_id, profile_id, squad_id, role)
-- values ('00000000-0000-0000-0000-000000000001', '<YOUR_USER_ID>', null, 'admin');
