-- Admin dashboard: a real, database-enforced admin role plus read-only
-- oversight RPCs. Authorization lives HERE (RLS + SECURITY DEFINER guards), not
-- in the client — the web app's admin check only shows/hides UI.
--
-- Idempotent: safe to re-run. Apply in the Supabase SQL editor (or via
-- `supabase db push`). After applying, mark yourself an admin with:
--   update public.users set is_admin = true where discord_id = '<your snowflake>';
--   -- or, if you signed in with email: where id = '<your auth uid>';

-- 1. The admin flag on the users table -------------------------------------
alter table public.users
  add column if not exists is_admin boolean not null default false;

-- 2. is_admin() — true when the current auth user is a flagged admin. --------
--    SECURITY DEFINER so it can read users.is_admin regardless of RLS, and
--    usable inside other policies/RPCs. STABLE: one value per statement.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.users
    where id = auth.uid() and is_admin = true
  );
$$;

-- Expose it to the client so the UI can gate the /admin route. (Reads only the
-- caller's own admin bit — never anyone else's.)
create or replace function public.current_user_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin();
$$;

-- 3. admin_stats() — headline counts for the dashboard. ---------------------
create or replace function public.admin_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'users',                  (select count(*) from public.users),
    'admins',                 (select count(*) from public.users where is_admin),
    'characters',             (select count(*) from public.characters),
    'public_characters',      (select count(*) from public.characters where is_public),
    'companions',             (select count(*) from public.companions),
    'characters_active_7d',   (select count(*) from public.characters where updated_at > now() - interval '7 days'),
    'characters_active_30d',  (select count(*) from public.characters where updated_at > now() - interval '30 days')
  );
end;
$$;

-- 4. admin_users() — one row per user with their character count + activity. -
create or replace function public.admin_users()
returns table (
  user_id uuid,
  discord_id text,
  discord_username text,
  character_count bigint,
  last_activity timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return query
    select
      u.id,
      u.discord_id::text,
      u.discord_username::text,
      count(c.id) as character_count,
      max(c.updated_at)::timestamptz as last_activity
    from public.users u
    left join public.characters c on c.user_id = u.id
    group by u.id, u.discord_id, u.discord_username
    order by max(c.updated_at) desc nulls last;
end;
$$;

-- 5. admin_characters() — every character with its owner, newest first. ------
create or replace function public.admin_characters()
returns table (
  id uuid,
  char_key text,
  name text,
  owner_user_id uuid,
  owner_username text,
  ancestry_name text,
  class_name text,
  level int,
  experience int,
  is_public boolean,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return query
    select
      c.id,
      c.char_key::text,
      c.name::text,
      c.user_id,
      u.discord_username::text,
      c.ancestry_name::text,
      c.class_name::text,
      c.level::int,
      c.experience::int,
      c.is_public,
      c.updated_at::timestamptz
    from public.characters c
    left join public.users u on u.id = c.user_id
    order by c.updated_at desc;
end;
$$;

-- 6. Grants: any signed-in (authenticated) user may CALL these — each RPC
--    self-guards with is_admin(), so a non-admin call raises instead of
--    leaking. anon (logged-out) gets nothing.
grant execute on function public.current_user_is_admin() to authenticated;
grant execute on function public.admin_stats()          to authenticated;
grant execute on function public.admin_users()          to authenticated;
grant execute on function public.admin_characters()     to authenticated;
