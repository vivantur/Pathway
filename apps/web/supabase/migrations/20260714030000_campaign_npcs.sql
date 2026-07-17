-- Campaign NPC tracker: the GM's cast of characters.
--
-- NPCs are authored only by the GM. Two layers of secrecy:
--   * `is_secret` — the whole NPC is hidden from players until revealed.
--   * `gm_notes`  — GM-only text, never shown to players even for revealed NPCs.
-- Row-level security can't hide a single column, so players NEVER select this
-- table directly (RLS restricts SELECT to the GM); they read through the
-- `campaign_npcs_list` RPC, which strips gm_notes and secret rows for non-GMs.
-- Depends on is_campaign_gm/_member from the campaigns migration. Idempotent.

create table if not exists public.campaign_npcs (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  name text not null,
  role text,
  location text,
  description text,          -- shown to players once revealed
  gm_notes text,            -- GM only
  is_secret boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists campaign_npcs_campaign_idx on public.campaign_npcs (campaign_id);

alter table public.campaign_npcs enable row level security;

drop policy if exists "Service role manages campaign_npcs" on public.campaign_npcs;
create policy "Service role manages campaign_npcs" on public.campaign_npcs
  for all to service_role using (true) with check (true);

-- Only the GM touches the table directly (read included — players use the RPC).
drop policy if exists "GM reads npcs" on public.campaign_npcs;
create policy "GM reads npcs" on public.campaign_npcs for select to authenticated
  using (public.is_campaign_gm(campaign_id));
drop policy if exists "GM writes npcs" on public.campaign_npcs;
create policy "GM writes npcs" on public.campaign_npcs for insert to authenticated
  with check (public.is_campaign_gm(campaign_id));
drop policy if exists "GM updates npcs" on public.campaign_npcs;
create policy "GM updates npcs" on public.campaign_npcs for update to authenticated
  using (public.is_campaign_gm(campaign_id)) with check (public.is_campaign_gm(campaign_id));
drop policy if exists "GM deletes npcs" on public.campaign_npcs;
create policy "GM deletes npcs" on public.campaign_npcs for delete to authenticated
  using (public.is_campaign_gm(campaign_id));

-- Members read the NPC list: the GM sees everything (incl. gm_notes + secret
-- NPCs); players see only revealed NPCs, with gm_notes stripped.
create or replace function public.campaign_npcs_list(cid uuid)
returns table (
  id uuid, name text, role text, location text, description text,
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
    select n.id, n.name::text, n.role::text, n.location::text, n.description::text,
           (case when gm then n.gm_notes else null end)::text,
           n.is_secret, n.updated_at
    from public.campaign_npcs n
    where n.campaign_id = cid
      and (gm or not n.is_secret)
    order by n.name;
end;
$$;

grant execute on function public.campaign_npcs_list(uuid) to authenticated;
