-- ============================================================================================
-- NUR IN DER SANDBOX, DIREKT NACH dem Einspielen von Schema + Daten aus Production.
-- Entfernt alles, was in einer Kopie nichts verloren hat (Push-/Cron-Anbindung an die App, private Daten) und richtet
-- die Test-Authentifizierung ein. Es werden KEINE Passwörter, Tokens oder Schlüssel aus Production übernommen.
-- ============================================================================================

-- 1) Automatische Jobs abschalten (Production hat einen pg_cron-Job „push-reminders“; eine Kopie darf nichts senden).
do $$ begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.unschedule(jobid) from cron.job;
  end if;
end $$;

-- 2) Die einzige Funktion mit HTTP-Aufruf nach außen (trigger_push_reminders ruft die App-URL auf) wirkungslos machen.
create or replace function public.trigger_push_reminders() returns void language sql as $$ select; $$;

-- 3) Private/irrelevante Tabellen sicher leeren (falls sie versehentlich mitkopiert wurden).
do $$ declare t text; begin
  foreach t in array array['push_subscriptions','notification_log','notification_preferences','push_reminders','survey_responses','audit_log','bet_comments'] loop
    if to_regclass('public.' || t) is not null then execute format('truncate table public.%I', t); end if;
  end loop;
end $$;

-- 4) E-Mail-Adressen anonymisieren (Namen/Spitznamen bleiben echt, E-Mails nie).
update public.profiles set email = 'u' || substr(id::text, 1, 8) || '@sandbox.invalid';

-- 5) Auth-Nutzer für ALLE Profile anlegen – gleiche UUIDs, damit Wetten/Profile zusammenpassen. Ohne Passwort: niemand
--    kann sich damit anmelden. Anmelden kann sich nur das eine Konto aus Schritt 03.
insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_sso_user, is_anonymous)
select '00000000-0000-0000-0000-000000000000', p.id, 'authenticated', 'authenticated', p.email, now(), now(), now(),
       '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false, false
from public.profiles p
on conflict (id) do nothing;

-- 6) Nur lesende Kontrolle
select 'matches' t, count(*) from public.matches
union all select 'bets', count(*) from public.bets
union all select 'combo_bets', count(*) from public.combo_bets
union all select 'profiles', count(*) from public.profiles
union all select 'auth.users', count(*) from auth.users
union all select 'cron-jobs', count(*) from cron.job;
