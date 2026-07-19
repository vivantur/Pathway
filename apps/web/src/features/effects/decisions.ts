import { requireSupabase } from '@/lib/supabase';
import type { EffectDecision } from '@pathway/core';

/**
 * The effect review queue's decisions, persisted.
 *
 * WHY THIS EXISTS. Decisions used to live only in the review page's React state,
 * exported to JSON by hand. A closed tab lost everything un-exported, and with
 * 2,000+ candidates in the queue that is a data-loss hazard rather than mere
 * friction. Candidates are regenerated on every producer run and are disposable;
 * a decision records a human's judgment and has to outlive the proposal.
 *
 * WHAT THIS IS NOT. Not the content pipeline's input. Content stays baked into
 * the committed JSON so the Vercel build needs no network or credentials;
 * `scripts/pull-decisions.mjs` materializes this table into
 * `effect-decisions.json` when content is rebuilt. This is the human's working
 * state, one step upstream of that.
 *
 * Everything here is admin-gated in the DATABASE (RLS + `is_admin()` inside each
 * RPC), not merely by the route guard — one Supabase project serves the live site
 * too, so the route guard is a convenience and the policy is the control.
 */

/** A stored decision, plus who made it — the page only needs the core shape back. */
interface DecisionRow {
  entity_id: string;
  key: string;
  action: EffectDecision['action'];
  effect: unknown;
  choice: unknown;
  note: string | null;
  decided_by_label: string | null;
  updated_at: string | null;
}

/** Map a stored row back to core's shape, dropping nulls so it round-trips clean. */
function toDecision(row: DecisionRow): EffectDecision {
  return {
    entityId: row.entity_id,
    key: row.key,
    action: row.action,
    ...(row.effect ? { effect: row.effect as EffectDecision['effect'] } : {}),
    ...(row.choice ? { choice: row.choice as EffectDecision['choice'] } : {}),
    ...(row.note ? { note: row.note } : {}),
    ...(row.decided_by_label ? { by: row.decided_by_label } : {}),
    ...(row.updated_at ? { at: row.updated_at } : {}),
  };
}

/** Every recorded decision. The queue is small enough (thousands) to load whole. */
export async function fetchDecisions(): Promise<EffectDecision[]> {
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from('effect_decisions')
    .select('entity_id, key, action, effect, choice, note, decided_by_label, updated_at');
  if (error) throw error;
  return (data ?? []).map((r) => toDecision(r as DecisionRow));
}

/**
 * Persist decisions. ALWAYS batched — the page bulk-accepts 130 candidates at a
 * time, and 130 round trips would be slow and, worse, non-atomic: a half-applied
 * bulk accept is a confusing state to recover from. One call, one transaction.
 *
 * `by` is deliberately NOT sent. The RPC stamps `auth.uid()` server-side, which
 * is the entire reason attribution is worth recording — a client-supplied author
 * field asserts nothing.
 */
export async function saveDecisions(decisions: readonly EffectDecision[]): Promise<void> {
  if (decisions.length === 0) return;
  const supabase = requireSupabase();
  const payload = decisions.map(({ entityId, key, action, effect, choice, note }) => ({
    entityId,
    key,
    action,
    ...(effect ? { effect } : {}),
    ...(choice ? { choice } : {}),
    ...(note ? { note } : {}),
  }));
  const { error } = await supabase.rpc('save_effect_decisions', { p_decisions: payload });
  if (error) throw error;
}

/** Undo: remove decisions by the (entityId, key) that addresses them. */
export async function clearDecisions(
  keys: readonly { entityId: string; key: string }[],
): Promise<void> {
  if (keys.length === 0) return;
  const supabase = requireSupabase();
  const { error } = await supabase.rpc('clear_effect_decisions', { p_keys: keys });
  if (error) throw error;
}
