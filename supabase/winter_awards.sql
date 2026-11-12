-- Winter-Auszeichnungen („Hinrunde 2026/27“) für den Pokalschrank.
-- VORBEREITET, NICHT in Production ausgeführt – nur nach ausdrücklicher Freigabe.
-- Idempotent (mehrfach ausführbar). Nur die Tabelle/Funktion werden angelegt; bestehende Tabellen (user_awards, …) bleiben unberührt.
--
-- Zugriff: RLS ist aktiv, es gibt bewusst KEINE Policy für anon/authenticated – gelesen und geschrieben wird ausschließlich
-- serverseitig mit dem Service-Role-Client (lib/recap/winterAwardsStore.ts). Die Sichtbarkeit steuert der Winter-Recap-Schalter
-- app_settings.recap_published_hinrunde (Zurückziehen blendet die Pokale aus, ohne Zeilen zu löschen).

create table if not exists public.winter_awards (
  id bigserial primary key,
  season text not null,
  recap_key text not null,
  award_key text not null check (award_key in ('wildi_magnet','hall_der_ehre','hall_der_schande','gegenwetten','senkrechtstarter','aussenseiter_jaeger','kombi_pech','quotenfluesterer')),
  user_id uuid not null references public.profiles(id) on delete cascade,
  award_title text not null,
  award_icon text not null,
  award_description text not null,
  value_text text,
  created_at timestamptz not null default now(),
  unique (season, recap_key, award_key, user_id)
);

create index if not exists winter_awards_user_idx on public.winter_awards (user_id, season, recap_key);

alter table public.winter_awards enable row level security;
revoke all on public.winter_awards from anon, authenticated;
revoke all on sequence public.winter_awards_id_seq from anon, authenticated;

-- Ersetzt ALLE Winter-Auszeichnungen einer Saison/eines Recaps in EINER Transaktion (löschen + einfügen):
-- wiederholtes Veröffentlichen erzeugt nie Duplikate, ein Fehler lässt den alten Stand unverändert.
create or replace function public.replace_winter_awards(p_season text, p_recap text, p_rows jsonb)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare n integer;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'p_rows must be a JSON array';
  end if;
  delete from public.winter_awards where season = p_season and recap_key = p_recap;
  insert into public.winter_awards (season, recap_key, award_key, user_id, award_title, award_icon, award_description, value_text)
  select p_season, p_recap, r.award_key, r.user_id, r.award_title, r.award_icon, r.award_description, r.value_text
  from jsonb_to_recordset(p_rows) as r(award_key text, user_id uuid, award_title text, award_icon text, award_description text, value_text text)
  on conflict (season, recap_key, award_key, user_id) do nothing;
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.replace_winter_awards(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.replace_winter_awards(text, text, jsonb) to service_role;
