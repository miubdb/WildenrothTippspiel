-- Row Level Security — the real access boundary (see CLAUDE.md convention
-- from the sibling Tippspiel project, applied here too). Every table that is
-- reachable from the browser client is locked down here; nothing relies on
-- API-route checks alone. The service-role client (lib/supabase/admin.ts)
-- bypasses all of this and is used only for actions that must cross a
-- boundary a normal user session cannot (e.g. an admin editing another
-- squad's data during a migration) — never exposed to client code.

alter table organizations enable row level security;
alter table squads enable row level security;
alter table profiles enable row level security;
alter table memberships enable row level security;
alter table seasons enable row level security;
alter table competitions enable row level security;
alter table teams enable row level security;
alter table players enable row level security;
alter table player_squad_memberships enable row level security;
alter table matches enable row level security;
alter table match_lineups enable row level security;
alter table lineup_players enable row level security;
alter table match_events enable row level security;
alter table data_sources enable row level security;
alter table source_imports enable row level security;
alter table data_conflicts enable row level security;
alter table recordings enable row level security;
alter table trainer_notes enable row level security;
alter table scene_candidates enable row level security;
alter table scenes enable row level security;
alter table scene_tags enable row level security;
alter table scene_participants enable row level security;
alter table evidence_items enable row level security;
alter table analysis_jobs enable row level security;
alter table ai_usage enable row level security;
alter table training_recommendations enable row level security;
alter table reports enable row level security;
alter table report_versions enable row level security;
alter table audit_logs enable row level security;

-- organizations: any member can read their org's row; nothing else client-side.
create policy organizations_select on organizations for select
  using (public.is_org_member(id));

-- squads: readable by anyone with a role scoped to it (or org-wide); writable by admins only.
create policy squads_select on squads for select
  using (public.can_view_squad(org_id, id));
create policy squads_write on squads for all
  using (public.is_admin(org_id)) with check (public.is_admin(org_id));

-- profiles: read your own row, and the row of anyone sharing an org with you
-- (needed to show trainer/author names). Only your own row is writable, and
-- only the display fields — is_admin-equivalent data lives in `memberships`,
-- never here, so there is nothing privilege-bearing to protect on this table.
create policy profiles_select_self on profiles for select
  using (id = auth.uid());
create policy profiles_select_org_peers on profiles for select
  using (exists (
    select 1 from memberships m1
    join memberships m2 on m1.org_id = m2.org_id
    where m1.profile_id = auth.uid() and m2.profile_id = profiles.id
  ));
create policy profiles_update_self on profiles for update
  using (id = auth.uid()) with check (id = auth.uid());

-- memberships: see your own memberships, and (if admin) every membership in
-- your org. Writes go through the service-role client from an admin-only API
-- route (app/api/admin/memberships) rather than direct client writes, so
-- promoting someone to admin can be validated server-side; no client INSERT/
-- UPDATE/DELETE policy exists here on purpose.
create policy memberships_select_self on memberships for select
  using (profile_id = auth.uid());
create policy memberships_select_admin on memberships for select
  using (public.is_admin(org_id));

-- seasons / competitions / teams / players: org-wide reference data.
-- Readable by any org member, writable by admins (roster/opponent upkeep is
-- an admin task per spec section 4).
create policy seasons_select on seasons for select using (public.is_org_member(org_id));
create policy seasons_write on seasons for all
  using (public.is_admin(org_id)) with check (public.is_admin(org_id));

create policy competitions_select on competitions for select using (public.is_org_member(org_id));
create policy competitions_write on competitions for all
  using (public.is_admin(org_id)) with check (public.is_admin(org_id));

create policy teams_select on teams for select using (public.is_org_member(org_id));
create policy teams_write on teams for all
  using (public.is_admin(org_id)) with check (public.is_admin(org_id));

create policy players_select on players for select using (public.is_org_member(org_id));
create policy players_write on players for all
  using (public.is_admin(org_id)) with check (public.is_admin(org_id));

create policy player_squad_memberships_select on player_squad_memberships for select
  using (public.can_view_squad(
    (select org_id from squads where squads.id = player_squad_memberships.squad_id), squad_id
  ));
create policy player_squad_memberships_write on player_squad_memberships for all
  using (public.can_edit_squad(
    (select org_id from squads where squads.id = player_squad_memberships.squad_id), squad_id
  ))
  with check (public.can_edit_squad(
    (select org_id from squads where squads.id = player_squad_memberships.squad_id), squad_id
  ));

-- matches: squad-scoped read/write.
create policy matches_select on matches for select
  using (public.can_view_squad(org_id, squad_id));
create policy matches_write on matches for all
  using (public.can_edit_squad(org_id, squad_id))
  with check (public.can_edit_squad(org_id, squad_id));

-- match_lineups / lineup_players / match_events: scoped through their match.
create policy match_lineups_select on match_lineups for select
  using (exists (
    select 1 from matches m where m.id = match_lineups.match_id and public.can_view_squad(m.org_id, m.squad_id)
  ));
create policy match_lineups_write on match_lineups for all
  using (exists (
    select 1 from matches m where m.id = match_lineups.match_id and public.can_edit_squad(m.org_id, m.squad_id)
  ))
  with check (exists (
    select 1 from matches m where m.id = match_lineups.match_id and public.can_edit_squad(m.org_id, m.squad_id)
  ));

create policy lineup_players_select on lineup_players for select
  using (exists (
    select 1 from match_lineups ml join matches m on m.id = ml.match_id
    where ml.id = lineup_players.lineup_id and public.can_view_squad(m.org_id, m.squad_id)
  ));
create policy lineup_players_write on lineup_players for all
  using (exists (
    select 1 from match_lineups ml join matches m on m.id = ml.match_id
    where ml.id = lineup_players.lineup_id and public.can_edit_squad(m.org_id, m.squad_id)
  ))
  with check (exists (
    select 1 from match_lineups ml join matches m on m.id = ml.match_id
    where ml.id = lineup_players.lineup_id and public.can_edit_squad(m.org_id, m.squad_id)
  ));

create policy match_events_select on match_events for select
  using (exists (
    select 1 from matches m where m.id = match_events.match_id and public.can_view_squad(m.org_id, m.squad_id)
  ));
create policy match_events_write on match_events for all
  using (exists (
    select 1 from matches m where m.id = match_events.match_id and public.can_edit_squad(m.org_id, m.squad_id)
  ))
  with check (exists (
    select 1 from matches m where m.id = match_events.match_id and public.can_edit_squad(m.org_id, m.squad_id)
  ));

-- data_sources: admin-managed (spec section 4: only Admin configures data sources).
create policy data_sources_select on data_sources for select using (public.is_org_member(org_id));
create policy data_sources_write on data_sources for all
  using (public.is_admin(org_id)) with check (public.is_admin(org_id));

create policy source_imports_select on source_imports for select using (public.is_org_member(org_id));
create policy source_imports_write on source_imports for all
  using (public.is_admin(org_id)) with check (public.is_admin(org_id));

create policy data_conflicts_select on data_conflicts for select using (public.is_org_member(org_id));
create policy data_conflicts_write on data_conflicts for all
  using (public.is_admin(org_id)) with check (public.is_admin(org_id));

-- recordings: scoped through match.
create policy recordings_select on recordings for select
  using (exists (
    select 1 from matches m where m.id = recordings.match_id and public.can_view_squad(m.org_id, m.squad_id)
  ));
create policy recordings_write on recordings for all
  using (exists (
    select 1 from matches m where m.id = recordings.match_id and public.can_edit_squad(m.org_id, m.squad_id)
  ))
  with check (exists (
    select 1 from matches m where m.id = recordings.match_id and public.can_edit_squad(m.org_id, m.squad_id)
  ));

-- trainer_notes: visible to anyone who can view the match's squad; only
-- trainers/admins can write, and only their own notes (author_id = self) —
-- notes are attributed, not editable by a different trainer.
create policy trainer_notes_select on trainer_notes for select
  using (exists (
    select 1 from matches m where m.id = trainer_notes.match_id and public.can_view_squad(m.org_id, m.squad_id)
  ));
create policy trainer_notes_insert on trainer_notes for insert
  with check (
    author_id = auth.uid()
    and exists (select 1 from matches m where m.id = trainer_notes.match_id and public.can_edit_squad(m.org_id, m.squad_id))
  );
create policy trainer_notes_update on trainer_notes for update
  using (author_id = auth.uid())
  with check (author_id = auth.uid());
create policy trainer_notes_delete on trainer_notes for delete
  using (author_id = auth.uid());

-- scene_candidates / scenes / scene_tags / scene_participants / evidence_items:
-- viewable by anyone with squad view access; the review actions (confirm/
-- correct/reject → status changes, evidence confirmation) require edit access
-- (trainer or admin) per spec section 7.
create policy scene_candidates_select on scene_candidates for select
  using (exists (
    select 1 from matches m where m.id = scene_candidates.match_id and public.can_view_squad(m.org_id, m.squad_id)
  ));
create policy scene_candidates_write on scene_candidates for all
  using (exists (
    select 1 from matches m where m.id = scene_candidates.match_id and public.can_edit_squad(m.org_id, m.squad_id)
  ))
  with check (exists (
    select 1 from matches m where m.id = scene_candidates.match_id and public.can_edit_squad(m.org_id, m.squad_id)
  ));

create policy scenes_select on scenes for select
  using (exists (
    select 1 from matches m where m.id = scenes.match_id and public.can_view_squad(m.org_id, m.squad_id)
  ));
create policy scenes_write on scenes for all
  using (exists (
    select 1 from matches m where m.id = scenes.match_id and public.can_edit_squad(m.org_id, m.squad_id)
  ))
  with check (exists (
    select 1 from matches m where m.id = scenes.match_id and public.can_edit_squad(m.org_id, m.squad_id)
  ));

create policy scene_tags_select on scene_tags for select
  using (exists (
    select 1 from scenes s join matches m on m.id = s.match_id
    where s.id = scene_tags.scene_id and public.can_view_squad(m.org_id, m.squad_id)
  ));
create policy scene_tags_write on scene_tags for all
  using (exists (
    select 1 from scenes s join matches m on m.id = s.match_id
    where s.id = scene_tags.scene_id and public.can_edit_squad(m.org_id, m.squad_id)
  ))
  with check (exists (
    select 1 from scenes s join matches m on m.id = s.match_id
    where s.id = scene_tags.scene_id and public.can_edit_squad(m.org_id, m.squad_id)
  ));

create policy scene_participants_select on scene_participants for select
  using (exists (
    select 1 from scenes s join matches m on m.id = s.match_id
    where s.id = scene_participants.scene_id and public.can_view_squad(m.org_id, m.squad_id)
  ));
create policy scene_participants_write on scene_participants for all
  using (exists (
    select 1 from scenes s join matches m on m.id = s.match_id
    where s.id = scene_participants.scene_id and public.can_edit_squad(m.org_id, m.squad_id)
  ))
  with check (exists (
    select 1 from scenes s join matches m on m.id = s.match_id
    where s.id = scene_participants.scene_id and public.can_edit_squad(m.org_id, m.squad_id)
  ));

create policy evidence_items_select on evidence_items for select
  using (exists (
    select 1 from scenes s join matches m on m.id = s.match_id
    where s.id = evidence_items.scene_id and public.can_view_squad(m.org_id, m.squad_id)
  ));
create policy evidence_items_write on evidence_items for all
  using (exists (
    select 1 from scenes s join matches m on m.id = s.match_id
    where s.id = evidence_items.scene_id and public.can_edit_squad(m.org_id, m.squad_id)
  ))
  with check (exists (
    select 1 from scenes s join matches m on m.id = s.match_id
    where s.id = evidence_items.scene_id and public.can_edit_squad(m.org_id, m.squad_id)
  ));

-- analysis_jobs / ai_usage: admins/trainers of the squad can see + start
-- jobs; ai_usage (cost data) is admin-only since it's org billing-adjacent.
create policy analysis_jobs_select on analysis_jobs for select
  using (exists (
    select 1 from matches m where m.id = analysis_jobs.match_id and public.can_view_squad(m.org_id, m.squad_id)
  ));
create policy analysis_jobs_write on analysis_jobs for all
  using (exists (
    select 1 from matches m where m.id = analysis_jobs.match_id and public.can_edit_squad(m.org_id, m.squad_id)
  ))
  with check (exists (
    select 1 from matches m where m.id = analysis_jobs.match_id and public.can_edit_squad(m.org_id, m.squad_id)
  ));

create policy ai_usage_select on ai_usage for select
  using (exists (
    select 1 from analysis_jobs j join matches m on m.id = j.match_id
    where j.id = ai_usage.analysis_job_id and public.is_admin(m.org_id)
  ));

-- training_recommendations / reports / report_versions: squad-scoped read,
-- trainer/admin write.
create policy training_recommendations_select on training_recommendations for select
  using (public.can_view_squad(org_id, squad_id));
create policy training_recommendations_write on training_recommendations for all
  using (public.can_edit_squad(org_id, squad_id))
  with check (public.can_edit_squad(org_id, squad_id));

create policy reports_select on reports for select
  using (public.can_view_squad(org_id, squad_id));
create policy reports_write on reports for all
  using (public.can_edit_squad(org_id, squad_id))
  with check (public.can_edit_squad(org_id, squad_id));

create policy report_versions_select on report_versions for select
  using (exists (
    select 1 from reports r where r.id = report_versions.report_id and public.can_view_squad(r.org_id, r.squad_id)
  ));
create policy report_versions_write on report_versions for all
  using (exists (
    select 1 from reports r where r.id = report_versions.report_id and public.can_edit_squad(r.org_id, r.squad_id)
  ))
  with check (exists (
    select 1 from reports r where r.id = report_versions.report_id and public.can_edit_squad(r.org_id, r.squad_id)
  ));

-- audit_logs: admin-only read; never client-writable — every write to this
-- table goes through server-side code using the service-role client at the
-- point a correction happens, so the log itself cannot be tampered with by
-- the same session that made the change.
create policy audit_logs_select on audit_logs for select
  using (public.is_admin(org_id));
