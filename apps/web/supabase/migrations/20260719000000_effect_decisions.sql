-- Effect review decisions — the human's output from the effect review queue.
--
-- WHY THE DATABASE. A decision is a human judgment that must outlive the proposal
-- that prompted it: candidates are regenerated on every producer run and are
-- deliberately disposable, but a decision records "a human said this is what the
-- feat does" and has to survive. Until now the review page held them in React
-- state, so an un-exported tab closing lost the lot — with 2,000+ candidates in
-- the queue that is a data-loss hazard, not merely friction.
--
-- WHAT DOES *NOT* MOVE. Content (the baked `feats.json` and friends) stays
-- committed to the repo, so the Vercel build remains hermetic — no network, no
-- credentials. `scripts/pull-decisions.mjs` materializes this table into
-- `effect-decisions.json` when content is baked, and `remap-effects.mjs` reads
-- that file exactly as it does today. This table is the human's working state,
-- not the content pipeline's input.
--
-- ADMIN-ONLY, AND FROM THE START. One Supabase project serves the live site and
-- `test`, so this table is reachable over the same PostgREST endpoint by any
-- authenticated user of the live site. RLS is therefore part of this migration
-- rather than a follow-up. Mirrors the admin dashboard's `is_admin()` pattern.
--
-- Idempotent — safe to re-run.

-- 1. Table ------------------------------------------------------------------
create table if not exists public.effect_decisions (
  id uuid primary key default gen_random_uuid(),

  -- Which entity (feat/ancestry/…) the decision is about, and WHICH proposal on
  -- it. Together these are how `resolveEntity` finds a decision — see core's
  -- `EffectDecision`. A human ADDITION carries a minted `added:…#n` key instead
  -- of a producer's, which is why this is plain text and not a FK to anything.
  entity_id text not null,
  key text not null,

  action text not null check (action in ('accept', 'reject', 'edit', 'add')),

  -- The final effect/choice, as core's schema validated it. Stored whole rather
  -- than as a reference: the point of an accept is that it stays meaningful even
  -- if the producer later changes its mind.
  effect jsonb,
  choice jsonb,

  -- Why — especially for a reject, so a later reviewer is not re-deciding blind.
  note text,

  -- Attribution comes from the session, not free text. `decided_by` is null only
  -- for rows seeded by a migration script (the 57 grandfathered foundry-baseline
  -- decisions), which is exactly the case a reviewer should be able to spot.
  decided_by uuid references public.users(id) on delete set null,
  -- Retained for rows with no user: the grandfather script's provenance string.
  decided_by_label text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- One decision per proposal. The review page upserts on this, so re-deciding a
  -- candidate overwrites rather than accumulating history.
  unique (entity_id, key)
);

create index if not exists effect_decisions_entity_idx on public.effect_decisions (entity_id);

-- Keep `updated_at` honest on upsert.
create or replace function public.touch_effect_decision()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists effect_decisions_touch on public.effect_decisions;
create trigger effect_decisions_touch
  before update on public.effect_decisions
  for each row execute function public.touch_effect_decision();

-- 2. RLS --------------------------------------------------------------------
alter table public.effect_decisions enable row level security;

-- Service role (the pull script, future sync) can do anything.
drop policy if exists "Service role manages effect_decisions" on public.effect_decisions;
create policy "Service role manages effect_decisions" on public.effect_decisions
  for all to service_role using (true) with check (true);

-- Admins only, in both directions. Read is admin-gated too: these are editorial
-- working notes on unreleased content, and there is no reason for a player's
-- session to be able to enumerate them.
drop policy if exists "Admins read effect_decisions" on public.effect_decisions;
create policy "Admins read effect_decisions" on public.effect_decisions
  for select to authenticated using (public.is_admin());

drop policy if exists "Admins insert effect_decisions" on public.effect_decisions;
create policy "Admins insert effect_decisions" on public.effect_decisions
  for insert to authenticated with check (public.is_admin());

drop policy if exists "Admins update effect_decisions" on public.effect_decisions;
create policy "Admins update effect_decisions" on public.effect_decisions
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "Admins delete effect_decisions" on public.effect_decisions;
create policy "Admins delete effect_decisions" on public.effect_decisions
  for delete to authenticated using (public.is_admin());

-- 3. Upsert RPC -------------------------------------------------------------
--
-- Batched on purpose: the review page bulk-accepts 130 candidates at a time, and
-- 130 round trips would be both slow and non-atomic — a half-applied bulk accept
-- is a confusing state to recover from. One call, one transaction.
--
-- `decided_by` is stamped from `auth.uid()` here rather than trusted from the
-- client, which is the whole reason attribution is worth recording.
create or replace function public.save_effect_decisions(p_decisions jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare
  n integer;
begin
  if not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  -- `as d(item)` names the column explicitly. Aliasing a scalar-returning set
  -- function as a bare `d` and then writing `d->>'x'` also works, but relies on the
  -- alias standing in for its single column — explicit is one less thing to be
  -- right about in a migration that is awkward to test before it runs.
  insert into public.effect_decisions (entity_id, key, action, effect, choice, note, decided_by)
  select
    d.item->>'entityId',
    d.item->>'key',
    d.item->>'action',
    case when d.item ? 'effect' then d.item->'effect' end,
    case when d.item ? 'choice' then d.item->'choice' end,
    d.item->>'note',
    auth.uid()
  from jsonb_array_elements(p_decisions) as d(item)
  on conflict (entity_id, key) do update set
    action = excluded.action,
    effect = excluded.effect,
    choice = excluded.choice,
    note = excluded.note,
    decided_by = excluded.decided_by,
    decided_by_label = null;

  get diagnostics n = row_count;
  return n;
end;
$$;

-- Clearing a decision ("undo") is a delete, also batched.
create or replace function public.clear_effect_decisions(p_keys jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare
  n integer;
begin
  if not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  delete from public.effect_decisions e
  using jsonb_array_elements(p_keys) as k(item)
  where e.entity_id = k.item->>'entityId' and e.key = k.item->>'key';

  get diagnostics n = row_count;
  return n;
end;
$$;

grant execute on function public.save_effect_decisions(jsonb)  to authenticated;
grant execute on function public.clear_effect_decisions(jsonb) to authenticated;
