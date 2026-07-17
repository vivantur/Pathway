-- Campaign manager (Phase W6, v1): campaigns + members + session journal.
--
-- A campaign has one GM (owner) and any number of player members, each bringing
-- a character from their vault. Authorization is database-enforced (RLS +
-- SECURITY DEFINER helpers), mirroring the admin/feedback pattern. Cross-user
-- reads (a GM seeing a player's character) go through guarded RPCs, never broad
-- RLS on `characters`. Idempotent — safe to re-run.

-- 1. Tables -----------------------------------------------------------------
create table if not exists public.campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Untitled Campaign',
  description text,
  gm_user_id uuid not null references public.users(id) on delete cascade,
  -- Short code players use to self-join (shared by the GM as a link).
  join_code text not null unique
    default lower(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.campaign_members (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  role text not null default 'player' check (role in ('gm', 'player')),
  -- Which character (by the vault's per-user slug) this member brings. Nullable
  -- and NOT a FK — char_key is only unique per user; the party RPC left-joins.
  char_key text,
  created_at timestamptz not null default now(),
  unique (campaign_id, user_id)
);
create index if not exists campaign_members_campaign_idx on public.campaign_members (campaign_id);
create index if not exists campaign_members_user_idx on public.campaign_members (user_id);

create table if not exists public.campaign_journal (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  author_user_id uuid references public.users(id) on delete set null,
  title text,
  body text not null check (char_length(body) between 1 and 20000),
  session_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists campaign_journal_campaign_idx on public.campaign_journal (campaign_id, created_at desc);

-- 2. Membership helpers (SECURITY DEFINER → bypass RLS, so no policy recursion)
create or replace function public.is_campaign_gm(cid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.campaigns where id = cid and gm_user_id = auth.uid());
$$;

create or replace function public.is_campaign_member(cid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.campaigns where id = cid and gm_user_id = auth.uid())
      or exists (select 1 from public.campaign_members where campaign_id = cid and user_id = auth.uid());
$$;

-- 3. RLS --------------------------------------------------------------------
alter table public.campaigns enable row level security;
alter table public.campaign_members enable row level security;
alter table public.campaign_journal enable row level security;

-- Service role (the bot, future sync) can do anything.
drop policy if exists "Service role manages campaigns" on public.campaigns;
create policy "Service role manages campaigns" on public.campaigns for all to service_role using (true) with check (true);
drop policy if exists "Service role manages campaign_members" on public.campaign_members;
create policy "Service role manages campaign_members" on public.campaign_members for all to service_role using (true) with check (true);
drop policy if exists "Service role manages campaign_journal" on public.campaign_journal;
create policy "Service role manages campaign_journal" on public.campaign_journal for all to service_role using (true) with check (true);

-- campaigns: members read; only the GM writes.
drop policy if exists "Members read campaigns" on public.campaigns;
create policy "Members read campaigns" on public.campaigns for select to authenticated
  using (public.is_campaign_member(id));
drop policy if exists "GM creates campaigns" on public.campaigns;
create policy "GM creates campaigns" on public.campaigns for insert to authenticated
  with check (gm_user_id = auth.uid());
drop policy if exists "GM updates campaigns" on public.campaigns;
create policy "GM updates campaigns" on public.campaigns for update to authenticated
  using (gm_user_id = auth.uid()) with check (gm_user_id = auth.uid());
drop policy if exists "GM deletes campaigns" on public.campaigns;
create policy "GM deletes campaigns" on public.campaigns for delete to authenticated
  using (gm_user_id = auth.uid());

-- campaign_members: members read; GM adds; a member edits/removes their own row
-- (leave / change character) and the GM edits/removes anyone in their campaign.
drop policy if exists "Members read membership" on public.campaign_members;
create policy "Members read membership" on public.campaign_members for select to authenticated
  using (public.is_campaign_member(campaign_id));
drop policy if exists "GM adds members" on public.campaign_members;
create policy "GM adds members" on public.campaign_members for insert to authenticated
  with check (public.is_campaign_gm(campaign_id));
drop policy if exists "Self or GM update member" on public.campaign_members;
create policy "Self or GM update member" on public.campaign_members for update to authenticated
  using (user_id = auth.uid() or public.is_campaign_gm(campaign_id))
  with check (user_id = auth.uid() or public.is_campaign_gm(campaign_id));
drop policy if exists "Self or GM remove member" on public.campaign_members;
create policy "Self or GM remove member" on public.campaign_members for delete to authenticated
  using (user_id = auth.uid() or public.is_campaign_gm(campaign_id));

-- campaign_journal: members read + post; author or GM edits/deletes.
drop policy if exists "Members read journal" on public.campaign_journal;
create policy "Members read journal" on public.campaign_journal for select to authenticated
  using (public.is_campaign_member(campaign_id));
drop policy if exists "Members post journal" on public.campaign_journal;
create policy "Members post journal" on public.campaign_journal for insert to authenticated
  with check (public.is_campaign_member(campaign_id) and author_user_id = auth.uid());
drop policy if exists "Author or GM edit journal" on public.campaign_journal;
create policy "Author or GM edit journal" on public.campaign_journal for update to authenticated
  using (author_user_id = auth.uid() or public.is_campaign_gm(campaign_id))
  with check (author_user_id = auth.uid() or public.is_campaign_gm(campaign_id));
drop policy if exists "Author or GM delete journal" on public.campaign_journal;
create policy "Author or GM delete journal" on public.campaign_journal for delete to authenticated
  using (author_user_id = auth.uid() or public.is_campaign_gm(campaign_id));

-- 4. RPCs -------------------------------------------------------------------

-- Create a campaign and enroll the creator as its GM member, atomically.
create or replace function public.create_campaign(p_name text, p_description text)
returns uuid language plpgsql security definer set search_path = public as $$
declare cid uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  insert into public.campaigns (name, description, gm_user_id)
  values (coalesce(nullif(trim(p_name), ''), 'Untitled Campaign'), nullif(trim(p_description), ''), auth.uid())
  returning id into cid;
  insert into public.campaign_members (campaign_id, user_id, role)
  values (cid, auth.uid(), 'gm')
  on conflict (campaign_id, user_id) do nothing;
  return cid;
end;
$$;

-- Self-join a campaign by its code (bringing an optional character).
create or replace function public.join_campaign(p_code text, p_char_key text)
returns uuid language plpgsql security definer set search_path = public as $$
declare cid uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  select id into cid from public.campaigns where join_code = lower(trim(p_code));
  if cid is null then raise exception 'Invalid campaign code' using errcode = 'P0002'; end if;
  insert into public.campaign_members (campaign_id, user_id, role, char_key)
  values (cid, auth.uid(), 'player', nullif(trim(p_char_key), ''))
  on conflict (campaign_id, user_id) do update set char_key = excluded.char_key;
  return cid;
end;
$$;

-- Every campaign the caller is in, with their role and the member count.
create or replace function public.my_campaigns()
returns table (id uuid, name text, description text, gm_user_id uuid, role text, member_count bigint, updated_at timestamptz)
language sql stable security definer set search_path = public as $$
  select c.id, c.name::text, c.description::text, c.gm_user_id,
         (case when c.gm_user_id = auth.uid() then 'gm' else 'player' end)::text as role,
         (select count(*) from public.campaign_members m2 where m2.campaign_id = c.id) as member_count,
         c.updated_at
  from public.campaigns c
  where c.gm_user_id = auth.uid()
     or exists (select 1 from public.campaign_members m where m.campaign_id = c.id and m.user_id = auth.uid())
  order by c.updated_at desc;
$$;

-- The party roster for a campaign: each member + the character they bring, with
-- live sheet columns. Admin-style guarded read so a GM sees players' characters
-- without a broad RLS grant on `characters`.
create or replace function public.campaign_party(cid uuid)
returns table (
  user_id uuid, username text, role text, char_key text,
  character_id uuid, character_name text, level int,
  ancestry_name text, class_name text, current_hp int, art text
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_campaign_member(cid) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return query
    select m.user_id, u.discord_username::text, m.role::text, m.char_key::text,
           c.id, c.name::text, c.level::int, c.ancestry_name::text, c.class_name::text,
           c.current_hp::int, c.art::text
    from public.campaign_members m
    left join public.users u on u.id = m.user_id
    left join public.characters c on c.user_id = m.user_id and c.char_key = m.char_key
    order by (m.role = 'gm') desc, u.discord_username nulls last;
end;
$$;

grant execute on function public.create_campaign(text, text)  to authenticated;
grant execute on function public.join_campaign(text, text)    to authenticated;
grant execute on function public.my_campaigns()               to authenticated;
grant execute on function public.campaign_party(uuid)         to authenticated;
grant execute on function public.is_campaign_gm(uuid)         to authenticated;
grant execute on function public.is_campaign_member(uuid)     to authenticated;
