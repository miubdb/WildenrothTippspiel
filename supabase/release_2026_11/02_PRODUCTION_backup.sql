-- PRODUCTION (mpyqtymkdhxuannqhtvp): frischer Tabellen-Snapshot unmittelbar VOR den Migrationen.
-- Legt NUR ein neues, für App-Nutzer gesperrtes Schema an; an public.* wird nichts verändert.
-- Bricht ab, wenn das Schema schon existiert (nie überschreiben). Ergebnis: eine Zeile mit den Kontrollzahlen.
BEGIN;
DO $b$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'release_backup_20261114_premigration') THEN
    RAISE EXCEPTION 'ABBRUCH: Backup-Schema existiert bereits';
  END IF;
END $b$;
CREATE SCHEMA release_backup_20261114_premigration;
REVOKE ALL ON SCHEMA release_backup_20261114_premigration FROM PUBLIC, anon, authenticated;
CREATE TABLE release_backup_20261114_premigration.bets             AS TABLE public.bets;
CREATE TABLE release_backup_20261114_premigration.combo_bets       AS TABLE public.combo_bets;
CREATE TABLE release_backup_20261114_premigration.profiles         AS TABLE public.profiles;
CREATE TABLE release_backup_20261114_premigration.push_reminders   AS TABLE public.push_reminders;
CREATE TABLE release_backup_20261114_premigration.matches          AS TABLE public.matches;
CREATE TABLE release_backup_20261114_premigration.match_goalscorers AS TABLE public.match_goalscorers;
CREATE TABLE release_backup_20261114_premigration.matchday_specials AS TABLE public.matchday_specials;
CREATE TABLE release_backup_20261114_premigration.survey_responses AS TABLE public.survey_responses;
CREATE TABLE release_backup_20261114_premigration.user_awards      AS TABLE public.user_awards;
CREATE TABLE release_backup_20261114_premigration.app_settings     AS TABLE public.app_settings;
CREATE TABLE release_backup_20261114_premigration.audit_log        AS TABLE public.audit_log;
-- Funktionsdefinitionen, die die Migration ersetzt (für ein exaktes Zurücksetzen):
CREATE TABLE release_backup_20261114_premigration.function_defs AS
  SELECT p.proname, pg_get_functiondef(p.oid) AS definition
  FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('finalize_bet_placement', 'increment_balance', 'apply_penalty', 'deduct_balance');
CREATE TABLE release_backup_20261114_premigration.backup_manifest AS
  SELECT now() AS captured_at,
    (SELECT count(*) FROM public.bets) AS bets, (SELECT max(id) FROM public.bets) AS max_bet_id,
    (SELECT count(*) FROM public.combo_bets) AS combo_bets, (SELECT count(*) FROM public.profiles) AS profiles,
    (SELECT sum(balance) FROM public.profiles) AS total_balance, (SELECT count(*) FROM public.survey_responses) AS survey_responses,
    (SELECT count(*) FROM public.push_reminders) AS push_reminders;
REVOKE ALL ON ALL TABLES IN SCHEMA release_backup_20261114_premigration FROM PUBLIC, anon, authenticated;
COMMIT;
SELECT m.*,
  (SELECT count(*) FROM release_backup_20261114_premigration.bets) = m.bets AS bets_ok,
  (SELECT sum(balance) FROM release_backup_20261114_premigration.profiles) = m.total_balance AS balance_ok,
  (SELECT count(*) FROM release_backup_20261114_premigration.function_defs) AS functions_saved
FROM release_backup_20261114_premigration.backup_manifest m;
