-- Admin 3.0, Punkt 9: Änderungshistorie / Admin-Audit-Log.
--
-- STATUS: vorbereitet, aber in dieser Umgebung NICHT ausgeführt — diese Sitzung hatte keinen
-- schreibenden Supabase-Zugriff (weder auf das Sandbox-Projekt aspbgawbqwfntvlqtcvl noch auf
-- Produktion), nur ein rein lesendes MCP-Tool auf einem anderen Projekt. lib/auditLog.ts
-- schreibt bereits dorthin — bis diese Migration angewendet ist, loggt jeder Aufruf nur einen
-- console.error ("relation does not exist"), blockiert aber NIE die eigentliche Admin-Aktion
-- (siehe dort).
--
-- Anwendung (beide Umgebungen identisch):
--   1. Zuerst in der Sandbox (aspbgawbqwfntvlqtcvl) ausführen und mit echten Admin-Aktionen in
--      der Sandbox-Preview verifizieren (siehe Abschlussbericht, Abschnitt "Tests").
--   2. Erst nach ausdrücklicher Freigabe durch den Nutzer in Produktion anwenden (Supabase-
--      SQL-Editor oder CLI-Migration, je nach dort etabliertem Vorgehen).
--
-- Sicherheitsmodell — identisch zu jeder anderen Admin-Mutation in diesem Projekt (siehe
-- CLAUDE.md "RLS is the real security boundary"): nur der Service-Role-Client
-- (lib/supabase/admin.ts, hier über lib/auditLog.ts) darf schreiben; `authenticated` darf
-- ausschließlich lesen, und nur wenn `profiles.is_admin = true` — keine INSERT/UPDATE/DELETE-
-- Policy für `authenticated` oder `anon` bedeutet: ohne eine solche Policy verweigert RLS jeden
-- Schreibversuch einer Nicht-Service-Role-Verbindung, auch von einem Admin-Account aus.

begin;

create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  actor_id uuid references auth.users(id) on delete set null,
  actor_name text not null,
  action text not null,
  object_type text not null,
  object_id text,
  old_value jsonb,
  new_value jsonb,
  success boolean not null default true,
  error_message text
);

comment on table public.audit_log is 'Admin 3.0: Protokoll sicherheitsrelevanter Admin-Aktionen. Nur Service-Role schreibt (lib/auditLog.ts), nur Admins lesen (RLS unten). Keine Zugangsdaten/Geheimnisse hier ablegen.';

create index if not exists audit_log_created_at_idx on public.audit_log (created_at desc);
create index if not exists audit_log_action_idx on public.audit_log (action);
create index if not exists audit_log_actor_id_idx on public.audit_log (actor_id);

alter table public.audit_log enable row level security;

-- Nur Admins dürfen lesen (passend zur Oberfläche unter Mehr → System & Wartung →
-- Änderungshistorie, die ohnehin nur im admin-gated /admin-Bereich erreichbar ist).
drop policy if exists audit_log_admin_read on public.audit_log;
create policy audit_log_admin_read on public.audit_log
  for select
  to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true));

-- Bewusst KEINE insert/update/delete-Policy für authenticated/anon — nur der Service-Role-Client
-- (RLS-Bypass) kann schreiben, exakt wie bei jeder anderen Admin-Mutation in diesem Projekt.

-- Explicit permissions: JWT authenticated users can only SELECT (and only admins via RLS).
revoke all on table public.audit_log from anon, authenticated;
grant select on table public.audit_log to authenticated;
grant select, insert on table public.audit_log to service_role;
grant usage, select on sequence public.audit_log_id_seq to service_role;
notify pgrst, 'reload schema';

commit;
