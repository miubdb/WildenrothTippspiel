-- ============================================================================================
-- NUR IN DER SANDBOX (aspbgawbqwfntvlqtcvl). Schema und Auth bleiben unverändert (am 12.11.2026 geprüft: alle 35 Tabellen
-- haben identische Spalten-Signaturen wie Production, 87 Policies, alle Auth-Nutzer vorhanden, E-Mails = *@sandbox.invalid).
-- Leert nur die DATEN im Schema public, damit sie danach frisch aus Production (nur gelesen) eingespielt werden können.
-- app_settings und die Marker-Tabelle bleiben stehen.
--
-- Sicherung: das Skript bricht ab, wenn die Tabelle public.__sandbox_marker nicht existiert oder nicht 'sandbox' enthält.
-- Production hat diese Tabelle nicht → dort schlägt das Skript sofort fehl, bevor irgendetwas gelöscht wird.
-- ============================================================================================
do $$
declare marker text; t text;
begin
  if to_regclass('public.__sandbox_marker') is null then raise exception 'Abbruch: keine Sandbox (Marker-Tabelle fehlt).'; end if;
  execute 'select value from public.__sandbox_marker order by id limit 1' into marker;
  if marker is distinct from 'sandbox' then raise exception 'Abbruch: Marker ist nicht "sandbox".'; end if;
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind = 'r' and c.relname not in ('__sandbox_marker', 'app_settings') loop
    execute format('truncate table public.%I restart identity cascade', t);
  end loop;
  raise notice 'Sandbox-Daten geleert (Schema + Auth unverändert).';
end $$;
