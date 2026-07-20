-- Granted actions on effect decisions — the Layer-2 payload.
--
-- WHY THIS COLUMN. `effect_decisions` already carries the two Layer-1 payloads a
-- human can author (`effect`, `choice`). A runnable ACTIVITY is the third, and it
-- had nowhere to live: the authoring page could build one and validate it against
-- core's schema, but could only hand the author a downloaded file that nothing
-- imported. This column is what lets an authored activity ride the same rail
-- decisions already ride — persisted on save, attributed server-side, pulled by
-- `scripts/pull-decisions.mjs`, folded into content by `remap-effects.mjs`.
--
-- ONLY EVER WITH `action = 'add'`, and that is the shape of the problem rather
-- than a restriction: no producer proposes an activity, so there is no proposal
-- for an accept/reject/edit to answer. The corpus says it directly — 1,544
-- entities are silent for `action-feat`, i.e. they grant an activity and are
-- correctly absent from a PASSIVE review queue. Not enforced by a CHECK because
-- the existing rows' semantics are carried by core's `resolveEntity`, which reads
-- `grantedAction` only on an `add`; a constraint here would be a second place for
-- that rule to live and drift.
--
-- WHAT DOES *NOT* MOVE. Content still stays committed — see the original
-- migration's note. This table remains the human's working state, one step
-- upstream of the bake.
--
-- ADDITIVE AND IDEMPOTENT. A nullable column plus a CREATE OR REPLACE on one
-- function. Every existing row stays valid, and every existing client keeps
-- working: `save_effect_decisions` reads the new field with `?`, so a payload
-- without it behaves exactly as before. The bot never touches this table.

-- 1. Column -----------------------------------------------------------------
alter table public.effect_decisions
  add column if not exists granted_action jsonb;

-- 2. Upsert RPC -------------------------------------------------------------
--
-- Replaces the original to carry `granted_action` through. Everything else is
-- unchanged, including `auth.uid()` attribution (a client-supplied author field
-- asserts nothing) and the admin gate.
create or replace function public.save_effect_decisions(p_decisions jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare
  n integer;
begin
  if not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  insert into public.effect_decisions (entity_id, key, action, effect, choice, granted_action, note, decided_by)
  select
    d.item->>'entityId',
    d.item->>'key',
    d.item->>'action',
    case when d.item ? 'effect' then d.item->'effect' end,
    case when d.item ? 'choice' then d.item->'choice' end,
    case when d.item ? 'grantedAction' then d.item->'grantedAction' end,
    d.item->>'note',
    auth.uid()
  from jsonb_array_elements(p_decisions) as d(item)
  on conflict (entity_id, key) do update set
    action = excluded.action,
    effect = excluded.effect,
    choice = excluded.choice,
    granted_action = excluded.granted_action,
    note = excluded.note,
    decided_by = excluded.decided_by,
    decided_by_label = null;

  get diagnostics n = row_count;
  return n;
end;
$$;

grant execute on function public.save_effect_decisions(jsonb) to authenticated;
