-- Helper functions used by RLS policies, plus the profile-bootstrap trigger.
--
-- All of these are SECURITY DEFINER + STABLE so they can read `memberships`
-- from inside a policy without the policy needing direct SELECT grants on it
-- (which would otherwise be circular: a policy on `memberships` gating reads
-- of `memberships`). They take auth.uid() implicitly, never a caller-supplied
-- user id, so a client can never ask "am I an admin for someone else".

create or replace function public.is_org_member(target_org uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from memberships
    where org_id = target_org and profile_id = auth.uid()
  );
$$;

create or replace function public.has_org_role(target_org uuid, roles member_role[])
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from memberships
    where org_id = target_org and profile_id = auth.uid() and role = any(roles)
  );
$$;

-- True if the caller is an org-wide admin, OR holds one of `roles` scoped to
-- `target_squad` specifically. Used for the "trainer sees only their squads"
-- restriction alongside the "admin sees everything in their org" rule.
create or replace function public.has_squad_role(target_org uuid, target_squad uuid, roles member_role[])
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from memberships
    where org_id = target_org
      and profile_id = auth.uid()
      and role = any(roles)
      and (squad_id is null or squad_id = target_squad)
  );
$$;

create or replace function public.is_admin(target_org uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select public.has_org_role(target_org, array['admin']::member_role[]);
$$;

-- Trainer or admin, scoped to the squad (admins are org-wide by having
-- squad_id null in their membership row).
create or replace function public.can_edit_squad(target_org uuid, target_squad uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select public.has_squad_role(target_org, target_squad, array['admin', 'trainer']::member_role[]);
$$;

create or replace function public.can_view_squad(target_org uuid, target_squad uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select public.has_squad_role(target_org, target_squad, array['admin', 'trainer', 'viewer']::member_role[]);
$$;

-- Bootstraps a `profiles` row whenever a new auth.users row appears, so the
-- app never has to handle "authenticated but no profile yet".
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger matches_set_updated_at
  before update on matches
  for each row execute function public.set_updated_at();

create trigger scenes_set_updated_at
  before update on scenes
  for each row execute function public.set_updated_at();
