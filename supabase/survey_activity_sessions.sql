-- Active time is the cumulative foreground / recently-interacted survey time.
-- Each browser tab has a unique session_id; cumulative reports are idempotent
-- (GREATEST), protecting against retries and out-of-order beacon/fetch requests.
-- Leaving the survey and coming back adds a NEW session, not the gap in-between.
-- This is private operational analytics, not exposed by client RLS.
create table if not exists public.survey_activity_sessions (
  user_id uuid not null,
  survey_version text not null,
  session_id uuid not null,
  active_ms bigint not null default 0 check (active_ms >= 0 and active_ms <= 86400000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, survey_version, session_id),
  constraint survey_activity_response_fk
    foreign key (user_id, survey_version)
    references public.survey_responses (user_id, survey_version)
    on delete cascade
);
create index if not exists survey_activity_version_idx
  on public.survey_activity_sessions (survey_version);

alter table public.survey_activity_sessions enable row level security;
revoke all on public.survey_activity_sessions from public, anon, authenticated;
grant select, insert, update on public.survey_activity_sessions to service_role;

-- Caller identity and environment are determined in /api/survey/activity,
-- not supplied as trusted values by the browser. The function is invoker-only;
-- permissions below make it inaccessible to unprivileged clients.
create or replace function public.record_survey_activity(
  p_user_id uuid, p_survey_version text, p_session_id uuid, p_active_ms bigint
) returns bigint
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_active_ms bigint;
begin
  if p_user_id is null or p_survey_version is null or p_session_id is null
     or p_active_ms is null or p_active_ms < 0 or p_active_ms > 86400000
  then
    raise exception 'Invalid survey activity payload';
  end if;

  insert into public.survey_activity_sessions
    (user_id, survey_version, session_id, active_ms)
  values (p_user_id, p_survey_version, p_session_id, p_active_ms)
  on conflict (user_id, survey_version, session_id) do update
    set active_ms = greatest(public.survey_activity_sessions.active_ms, excluded.active_ms),
        updated_at = now()
  returning active_ms into v_active_ms;

  return v_active_ms;
end;
$$;
revoke all on function public.record_survey_activity(uuid,text,uuid,bigint) from public, anon, authenticated;
grant execute on function public.record_survey_activity(uuid,text,uuid,bigint) to service_role;
