-- ============================================================================================
-- NUR IN DER SANDBOX. Richtet EIN Test-Login ein (Admin-Konto, damit /recap/hinrunde samt Admin-Ansicht testbar ist).
-- Das Passwort denkst du dir selbst aus und trägst es unten NUR im SQL-Editor der Sandbox ein (nicht ins Repo, nicht in
-- den Chat!). Es hat nichts mit dem Production-Passwort zu tun.
-- ============================================================================================
-- 1. E-Mail für das Login festlegen (kann eine echte oder erfundene Adresse sein; Bestätigung ist automatisch gesetzt):
--    Ersetze  ANZEIGENAME  durch den Anzeigenamen deines Admin-Profils (in Production: „Jani“).
update auth.users u
set email = 'sandbox-admin@sandbox.invalid',
    encrypted_password = extensions.crypt('HIER-DEIN-NEUES-SANDBOX-PASSWORT', extensions.gen_salt('bf')),
    email_confirmed_at = now()
where u.id = (select id from public.profiles where display_name = 'ANZEIGENAME' and is_admin limit 1);

update public.profiles set email = 'sandbox-admin@sandbox.invalid'
where display_name = 'ANZEIGENAME' and is_admin;

-- 2. Kontrolle (muss genau 1 Zeile liefern):
select u.email, p.display_name, p.is_admin from auth.users u join public.profiles p on p.id = u.id where u.email = 'sandbox-admin@sandbox.invalid';
