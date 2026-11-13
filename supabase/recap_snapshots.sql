-- Freeze the published Winter recap exactly once. The whole report AND each
-- user's personal view are stored, so late makeup games cannot retroactively
-- change Tipper-IQ, awards, rankings, best tips or bankroll stories.
--
-- Safe to run before go-live: creates structures ONLY; does NOT publish,
-- insert any snapshot or touch existing matches/bets/awards/balances.
create table if not exists public.recap_snapshots (
  season text not null,
  recap_key text not null,
  report jsonb not null check (jsonb_typeof(report) = 'object'),
  personal_by_user jsonb not null check (jsonb_typeof(personal_by_user) = 'object'),
  readiness jsonb not null check (jsonb_typeof(readiness) = 'object'),
  award_rows jsonb not null check (jsonb_typeof(award_rows) = 'array'),
  created_at timestamptz not null default now(),
  primary key (season, recap_key)
);

-- Deliberately private. Admin app uses createAdminClient() / service_role.
alter table public.recap_snapshots enable row level security;
revoke all on public.recap_snapshots from public, anon, authenticated;
grant select, insert on public.recap_snapshots to service_role;

-- Database-level protection against accidental modification after publication,
-- including via future incorrect .upsert()/.delete() API code.
create or replace function public.prevent_recap_snapshot_mutation()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  raise exception 'Published recap snapshots are immutable. Publish a new recap version instead.'
    using errcode = '23514';
end;
$$;

drop trigger if exists recap_snapshot_immutable on public.recap_snapshots;
create trigger recap_snapshot_immutable
before update or delete on public.recap_snapshots
for each row execute function public.prevent_recap_snapshot_mutation();

revoke all on function public.prevent_recap_snapshot_mutation() from public, anon, authenticated;

-- Atomic publication: first writer establishes the immutable snapshot;
-- subsequent calls ALWAYS reuse its award_rows. Replacing winter awards and
-- switching the visibility bit happen in the same DB transaction.
-- No SECURITY DEFINER, EXECUTE granted only to service_role.
create or replace function public.publish_frozen_winter_recap(
  p_season text,
  p_recap text,
  p_report jsonb default null,
  p_personal jsonb default null,
  p_readiness jsonb default null,
  p_awards jsonb default null
)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_awards jsonb;
  v_rows integer;
begin
  if p_season <> '26/27' or p_recap <> 'hinrunde' then
    raise exception 'Unsupported winter recap';
  end if;

  -- For the very first publication all four payloads must be complete.
  -- A withdrawn/re-published snapshot never accepts a replacement payload.
  if p_report is not null and p_personal is not null and p_readiness is not null and p_awards is not null then
    if jsonb_typeof(p_report) <> 'object'
       or p_report #>> '{version}' <> '1'
       or p_report #>> '{range,from}' <> '1'
       or p_report #>> '{range,to}' <> '16'
       or jsonb_typeof(p_personal) <> 'object'
       or jsonb_typeof(p_readiness) <> 'object'
       or p_readiness ->> 'ready' <> 'true'
       or jsonb_typeof(p_awards) <> 'array'
    then
      raise exception 'Incomplete or non-final winter recap payload';
    end if;
    insert into public.recap_snapshots (season, recap_key, report, personal_by_user, readiness, award_rows)
    values (p_season, p_recap, p_report, p_personal, p_readiness, p_awards)
    on conflict (season, recap_key) do nothing;
  end if;

  select award_rows into v_awards from public.recap_snapshots
  where season = p_season and recap_key = p_recap;
  if not found then
    raise exception 'No frozen winter recap exists. Publish with a validated final payload first.';
  end if;

  v_rows := public.replace_winter_awards(p_season, p_recap, v_awards);
  insert into public.app_settings (key, value, updated_at)
  values ('recap_published_hinrunde', 'true', now())
  on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at;
  return v_rows;
end;
$$;

revoke all on function public.publish_frozen_winter_recap(text, text, jsonb, jsonb, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.publish_frozen_winter_recap(text, text, jsonb, jsonb, jsonb, jsonb)
  to service_role;
