-- Campaign quest tracker: objectives with an active/completed/failed status.
--
-- Same secrecy model as NPCs: GM-authored, with GM-only `gm_notes` and an
-- `is_secret` flag that hides a quest from players until revealed. Players never
-- select the table (RLS = GM only); they read via `campaign_quests_list`, which
-- strips gm_notes and secret quests. Depends on is_campaign_gm/_member from the
-- campaigns migration. Idempotent.

create table if not exists public.campaign_quests (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  title text not null,
  description text,
  status text not null default 'active' check (status in ('active', 'completed', 'failed')),
  gm_notes text,
  is_secret boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists campaign_quests_campaign_idx on public.campaign_quests (campaign_id);

alter table public.campaign_quests enable row level security;

drop policy if exists "Service role manages campaign_quests" on public.campaign_quests;
create policy "Service role manages campaign_quests" on public.campaign_quests
  for all to service_role using (true) with check (true);

drop policy if exists "GM reads quests" on public.campaign_quests;
create policy "GM reads quests" on public.campaign_quests for select to authenticated
  using (public.is_campaign_gm(campaign_id));
drop policy if exists "GM writes quests" on public.campaign_quests;
create policy "GM writes quests" on public.campaign_quests for insert to authenticated
  with check (public.is_campaign_gm(campaign_id));
drop policy if exists "GM updates quests" on public.campaign_quests;
create policy "GM updates quests" on public.campaign_quests for update to authenticated
  using (public.is_campaign_gm(campaign_id)) with check (public.is_campaign_gm(campaign_id));
drop policy if exists "GM deletes quests" on public.campaign_quests;
create policy "GM deletes quests" on public.campaign_quests for delete to authenticated
  using (public.is_campaign_gm(campaign_id));

create or replace function public.campaign_quests_list(cid uuid)
returns table (
  id uuid, title text, description text, status text,
  gm_notes text, is_secret boolean, updated_at timestamptz
)
language plpgsql stable security definer set search_path = public as $$
declare gm boolean;
begin
  if not public.is_campaign_member(cid) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  gm := public.is_campaign_gm(cid);
  return query
    select q.id, q.title::text, q.description::text, q.status::text,
           (case when gm then q.gm_notes else null end)::text,
           q.is_secret, q.updated_at
    from public.campaign_quests q
    where q.campaign_id = cid
      and (gm or not q.is_secret)
    order by
      case q.status when 'active' then 0 when 'completed' then 1 else 2 end,
      q.updated_at desc;
end;
$$;

grant execute on function public.campaign_quests_list(uuid) to authenticated;
