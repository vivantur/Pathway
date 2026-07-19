// ── features/automation/runAction.ts ────────────────────────────────────────
//
// The WEB's host for core's Layer-2 automation interpreter — the counterpart to
// the bot's `rules/automation.js`, and the first time `apps/web` reaches the
// automation engine at all (it consumed only Layer-1 passives before).
//
// Composing a tree is `features/authoring/` (the node editor). RUNNING one is
// here. They are different layers and deliberately different folders.
//
// Core owns the interpreter and every rule inside it. This module owns only the
// adapter concerns a host must supply:
//
//   1. the ACTOR — a `ResolvedCharacter`, which the builder ALREADY derives via
//      `toResolvedCharacter`. It is re-shaped, never recomputed: a second sheet
//      engine here is precisely the drift bug this repo is organized to prevent.
//   2. the COUNTERS — see the note on `buildContext`. The web holds no play
//      state, so it supplies none unless a caller says otherwise.
//   3. NARRATION — turning the outcome into plain strings.
//
// It computes NO rules. Every number in an outcome came out of core.
//
// PURE: no network, no React, no persistence. Deterministic — the seed is an
// argument, never generated here, so a run can be replayed exactly.

import {
  runAutomation,
  makeRng,
  type Counter,
  type ErrorPolicy,
  type ExecutionContext,
  type ExprValue,
  type GrantedAction,
  type MutationTarget,
  type Outcome,
  type ResolvedCharacter,
  type RolledDie,
} from '@pathway/core';
import { toResolvedCharacter } from '@/features/builder/rules';
import type { BuilderState } from '@/features/builder/types';

export interface BuildContextOptions {
  /**
   * REQUIRED, and deliberately not defaulted: a silently-random seed makes a run
   * unreplayable, which defeats the point of core threading a seeded RNG through
   * every roll. A caller that wants a fresh run generates the seed itself and
   * keeps it alongside whatever it displays.
   */
  seed: number;
  /**
   * The actor's spendable pools, in core's `{ current, max }` shape.
   *
   * EMPTY BY DEFAULT, on purpose. The bot can populate this because it stores
   * play state (`overlay.daily.focus_spent`); the web builder stores none —
   * `toResolvedCharacter` carries `focusPoints.max` and nothing about what has
   * been spent. Seeding `focus: { current: max }` here would assert a fully
   * rested character, which is a play-state claim this layer cannot make.
   *
   * So a tree with a focus cost fails through the error policy and the run SAYS
   * SO, rather than quietly succeeding on invented resources. A caller that can
   * legitimately make the assumption (a preview surface that labels it) passes
   * the counters in explicitly, where the assumption is visible to the user.
   */
  counters?: Record<string, Counter>;
  /** Other creatures this invocation can affect. Area geometry is the caller's concern. */
  targets?: ResolvedCharacter[];
  /** Spell ranks behind the invocation, when there is one. */
  spell?: { baseRank: number; castRank: number };
  /** Starting execution-state variables (how a pressed button receives captured values). */
  vars?: Record<string, ExprValue>;
  /** Overrides the host default described below. */
  onError?: ErrorPolicy;
}

/**
 * Build the `ExecutionContext` core's interpreter reads, from builder state.
 *
 * The actor comes from `toResolvedCharacter` — the builder's own derived sheet.
 * (Characters IMPORTED from Pathbuilder have no `_pathwayBuild` and so no
 * `BuilderState`; core's `resolvedFromPathbuilder` is their path, and a caller
 * on that side should use `buildContextFor` with the resolved actor directly.)
 */
export function buildContext(state: BuilderState, opts: BuildContextOptions): ExecutionContext {
  return buildContextFor(toResolvedCharacter(state), opts);
}

/**
 * The same, for a caller that already holds a `ResolvedCharacter` — an imported
 * Pathbuilder character, or a creature that was never built here.
 */
export function buildContextFor(
  actor: ResolvedCharacter,
  opts: BuildContextOptions,
): ExecutionContext {
  const { seed, counters, targets, spell, vars, onError } = opts;

  if (!Number.isFinite(seed)) {
    throw new TypeError('buildContext requires a numeric `seed` so the run can be replayed.');
  }

  const ctx: ExecutionContext = {
    actor,
    rng: makeRng(seed),
    counters: counters ?? {},
    // Core defaults an unhandled node failure to `ignore` — right for a library,
    // wrong for a host that shows results to a person. Ignored means an action
    // whose cost silently failed still hands out its effect, and nobody is told.
    // A host narrating to a player defaults to `warn` so every failure surfaces;
    // an authored node that genuinely must not proceed carries its own `raise`.
    onError: onError ?? { on: 'warn' },
  };

  if (targets && targets.length > 0) ctx.targets = targets;
  if (spell) ctx.spell = spell;
  if (vars) ctx.vars = vars;

  return ctx;
}

/**
 * Run a granted action against a prepared context. A pass-through to core.
 *
 * An action with no `automation` tree yet is legal (that is the state most
 * decided actions start in) and simply produces an empty outcome — the caller
 * can tell "nothing authored" from "nothing happened" via `hasAutomation`.
 */
export function runAction(action: GrantedAction, ctx: ExecutionContext): Outcome {
  return runAutomation(action.automation ?? [], ctx);
}

/** Whether an action actually carries a runnable tree. */
export function hasAutomation(action: GrantedAction): boolean {
  return (action.automation?.length ?? 0) > 0;
}

/** Build a context for `state` and run `action` against it — the one-call form. */
export function runActionFor(
  state: BuilderState,
  action: GrantedAction,
  opts: BuildContextOptions,
): Outcome {
  return runAction(action, buildContext(state, opts));
}

// ── narration ───────────────────────────────────────────────────────────────

/** `(4, 3)` — the individual dice behind a roll, for transparency. */
function formatDice(dice: readonly RolledDie[] | undefined): string {
  if (!Array.isArray(dice) || dice.length === 0) return '';
  const rolled = dice.map((d) => d?.result).filter((r): r is number => Number.isFinite(r));
  return rolled.length ? ` (${rolled.join(', ')})` : '';
}

const DEGREE_LABEL: Record<string, string> = {
  criticalSuccess: 'Critical Success',
  success: 'Success',
  failure: 'Failure',
  criticalFailure: 'Critical Failure',
};

export interface DescribedOutcome {
  /** The narration, in order. */
  lines: string[];
  /** What the run INTENDED to change — see `describeMutations`. */
  changes: string[];
  /** Non-fatal problems. Kept separate so a partial run cannot read as a whole one. */
  warnings: string[];
  aborted: boolean;
}

function describeTarget(t: MutationTarget): string {
  return t.kind === 'self' ? '' : `Target ${t.index + 1}: `;
}

/**
 * Render an outcome's MUTATIONS — what the run intended to change.
 *
 * THE LOG IS NOT THE WHOLE STORY: core's `damage`, `temphp` and `counter` nodes
 * emit a mutation and NO log entry, so a healing tree rendered from the log
 * alone narrates "Heal" without ever saying 6. This is the other half.
 *
 * These are INTENTIONS, not results. The bot has a `state/automation.js` that
 * applies mutations and reports what survived clamping ("healed 6" is a lie if
 * the character was 2 HP from full); the web has no apply layer yet, so every
 * caller must present these as what WOULD happen, never as what did.
 */
export function describeMutations(outcome: Outcome | undefined): string[] {
  const lines: string[] = [];

  for (const m of outcome?.mutations ?? []) {
    switch (m.kind) {
      case 'damage': {
        const types = m.instances
          .map((i) => i.type)
          .filter(Boolean)
          .join(', ');
        const verb = m.healing ? 'Healing' : 'Damage';
        lines.push(`${describeTarget(m.target)}${verb} ${m.amount}${types ? ` ${types}` : ''}`);
        break;
      }
      case 'temphp':
        lines.push(`${describeTarget(m.target)}${m.amount} temporary HP`);
        break;
      case 'counter':
        lines.push(`Spend ${m.spent} ${m.counter} — ${m.remaining} would remain`);
        break;
      case 'applyEffect':
        lines.push(`${describeTarget(m.target)}Gain ${m.effect.name}`);
        break;
      case 'removeEffect':
        lines.push(`${describeTarget(m.target)}Lose ${m.name}${m.cascade ? ' (and linked)' : ''}`);
        break;
      default: {
        // Core grew its mutation vocabulary and this renderer has not caught up.
        // Say so rather than dropping a state change silently.
        const unknown = m as { kind: string };
        lines.push(`(unrenderable change: ${unknown.kind})`);
      }
    }
  }

  return lines;
}

/**
 * Render an outcome to plain strings — no JSX, so this stays unit-testable and
 * the component layer decides what it looks like.
 *
 * Warnings are kept SEPARATE rather than folded into the narration: a run that
 * half-worked should say so out loud instead of quietly presenting a shorter
 * story as if it were the whole thing.
 */
export function describeOutcome(outcome: Outcome | undefined): DescribedOutcome {
  const lines: string[] = [];

  for (const entry of outcome?.log ?? []) {
    switch (entry.kind) {
      case 'text':
        lines.push(entry.title ? `${entry.title}\n${entry.body}` : entry.body);
        break;
      case 'roll':
        lines.push(
          `${entry.name ? `${entry.name}: ` : ''}${entry.notation} → ${entry.total}${formatDice(entry.dice)}`,
        );
        break;
      case 'check': {
        const degree = DEGREE_LABEL[entry.degree] ?? entry.degree;
        lines.push(
          `${entry.name ? `${entry.name}: ` : ''}d20 ${entry.die} → ${entry.total} vs DC ${entry.dc} — ${degree}`,
        );
        break;
      }
      default: {
        // An unknown log kind means core grew its vocabulary and this renderer
        // has not caught up. Say so rather than dropping the entry silently.
        const unknown = entry as { kind: string };
        lines.push(`(unrenderable log entry: ${unknown.kind})`);
      }
    }
  }

  return {
    lines,
    changes: describeMutations(outcome),
    warnings: [...(outcome?.warnings ?? [])],
    aborted: !!outcome?.aborted,
  };
}
