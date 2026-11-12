-- ============================================================================================
-- NUR IN DER SANDBOX, direkt nach dem Einspielen der Production-Daten (siehe docs/sandbox-recap-preview.md).
-- Hält die Sandbox bereinigt: keine echten E-Mail-Adressen, Auth-Nutzer für jedes Profil, keine privaten Tabellen.
-- Es werden keine Passwörter/Tokens aus Production übernommen; bestehende Sandbox-Logins (z. B. Admin „Jani“) bleiben gültig.
-- ============================================================================================
do $$ begin
  if to_regclass('public.__sandbox_marker') is null or (select value from public.__sandbox_marker limit 1) is distinct from 'sandbox' then
    raise exception 'Abbruch: keine Sandbox.';
  end if;
end $$;

-- 1) Private/irrelevante Tabellen leer (falls versehentlich mitkopiert)
do $$ declare t text; begin
  foreach t in array array['push_subscriptions','notification_log','notification_preferences','push_reminders','survey_responses','audit_log','bet_comments'] loop
    if to_regclass('public.' || t) is not null then execute format('truncate table public.%I', t); end if;
  end loop;
end $$;

-- 2) Für neue Profile (die es in der alten Sandbox nicht gab) einen Auth-Nutzer ohne Passwort anlegen – gleiche UUID.
insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_sso_user, is_anonymous)
select '00000000-0000-0000-0000-000000000000', p.id, 'authenticated', 'authenticated', 'u' || substr(p.id::text, 1, 8) || '@sandbox.invalid', now(), now(), now(),
       '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false, false
from public.profiles p where not exists (select 1 from auth.users u where u.id = p.id);

-- 3) Profil-E-Mails = Sandbox-Auth-E-Mails (überschreibt die aus Production kopierten echten Adressen)
update public.profiles p set email = u.email from auth.users u where u.id = p.id;

-- 4) Kontrolle (nur lesend)
select 'profiles mit echter E-Mail-Domain' k, count(*)::text v from public.profiles where split_part(email, '@', 2) <> 'sandbox.invalid'
union all select 'profiles ohne Auth-Nutzer', count(*)::text from public.profiles p where not exists (select 1 from auth.users u where u.id = p.id)
union all select 'Auth-Nutzer ohne sandbox.invalid', count(*)::text from auth.users where split_part(email, '@', 2) <> 'sandbox.invalid'
union all select 'matches', count(*)::text from public.matches
union all select 'bets 26/27', count(*)::text from public.bets where season = '26/27'
union all select 'combo_bets 26/27', count(*)::text from public.combo_bets where season = '26/27';
