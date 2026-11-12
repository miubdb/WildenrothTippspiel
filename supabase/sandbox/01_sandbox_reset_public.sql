-- ============================================================================================
-- NUR IN DER SANDBOX (aspbgawbqwfntvlqtcvl) AUSFÜHREN – NIEMALS in Production (mpyqtymkdhxuannqhtvp)!
-- Leert das Schema `public` der Sandbox, damit anschließend Schema + Daten sauber aus Production (nur gelesen) kopiert
-- werden können. Zerstört alle Sandbox-Daten im Schema public. Auth-Nutzer der Sandbox bleiben unberührt.
-- ============================================================================================
do $$
begin
  if current_setting('app.sandbox_ack', true) is distinct from 'ja-nur-sandbox' then
    raise exception 'Abbruch: erst  set app.sandbox_ack = ''ja-nur-sandbox'';  in derselben Sitzung ausführen und prüfen, dass du in der SANDBOX bist.';
  end if;
end $$;

drop schema if exists public cascade;
create schema public;
grant usage on schema public to postgres, anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to postgres, anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to postgres, anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to postgres, anon, authenticated, service_role;
