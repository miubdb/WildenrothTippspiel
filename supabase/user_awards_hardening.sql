-- OPTIONAL Defense-in-Depth für public.user_awards – NICHT Teil der PR-29-Migration, NICHT in Production ausgeführt.
-- Befund (read-only geprüft): anon UND authenticated besitzen INSERT/UPDATE/DELETE/SELECT-Tabellenrechte; RLS ist aktiv und es
-- gibt nur die Policy user_awards_select_all (SELECT, public, using true). Schreibzugriffe sind damit durch RLS blockiert
-- (kein akutes Risiko), hängen aber an genau EINER Sicherung. Alle Schreibzugriffe der App laufen über den service_role-Client.
-- Lesen ist für alle (auch nicht eingeloggte) Besucher offen: gewollt für Pokalschrank/Rangliste, aber ohne Login nicht nötig.
begin;
revoke insert, update, delete, truncate, references, trigger on public.user_awards from anon, authenticated;
-- Optional, falls Awards ohne Login nicht sichtbar sein sollen:
-- revoke select on public.user_awards from anon;
commit;
-- Rollback: grant insert, update, delete on public.user_awards to anon, authenticated;
