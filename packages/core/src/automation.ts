// Layer 2 — the automation interpreter (skeleton slice).
//
// The automation engine is a TREE INTERPRETER, pure in core: it takes an ordered
// tree of typed nodes, an execution context (the acting character + a seeded RNG),
// and returns an OUTCOME — a narration `log` plus a list of intended `mutations`
// for the host app to apply. It never touches persistence, Discord, or the DB
// (docs/effects-engine-design.md, "Layer 2 — the automation engine").
//
// This is where the execution model was settled (slice 1) so every later node
// (damage, counter, target, applyEffect) plugs into a stable contract. The nodes:
//   • text     — append narration.
//   • variable — evaluate an expression and BIND it to a name (forward-only scope).
//   • roll     — roll dice (dice.ts) with the seeded RNG, bind the total to
//                `lastRoll` (and an optional name), and log the dice. (slice 2)
//   • save / attack / check — roll d20 + a modifier vs a DC and resolve the four
//                degrees (checks.ts + degree.ts), bind degree refs, log, and run
//                the matching per-degree child list. (slice 3)
//   • damage / temphp — roll typed damage (dice.ts + damage.ts), optionally scale
//                by a resolved degree (crit doubles, basic save none/half/full/
//                double), and emit an intended `Mutation`. (slice 4)
//   • counter  — spend/restore a resource (counter.ts) read from the context's
//                snapshot, emitting a `counter` mutation. (slice 5)
//   • applyEffect / removeEffect — impose or lift a Layer-1.5 applied effect
//                (applied.ts), emitting a mutation; `linkGroup` pairs effects
//                applied to different actors so they remove as a unit. (slice 7b)
//   • target   — a repeatable SCOPING node: re-scope the current target (all /
//                self / position(N)) and run its children once per creature, so
//                each target gets its own DC comparison, degree, and mutations.
//                (slice 6)
//   • branch   — evaluate a boolean expression and run one of two child lists.
// Only save/attack/check carry PF2e rules, and only via the pasted-text primitives
// in checks.ts/degree.ts (the DC=10+modifier formula, the degree bands); this
// module wires them, it re-derives nothing. Expressions are the shared evaluator
// (expr.ts), reading the character namespace (character.ts) merged with the
// execution-state vars this interpreter binds as it runs. Randomness is the seeded
// RNG (rng.ts), so every run is replayable.
//
// THE UNIFORM ERROR POLICY (the doc insists this is ONE model, not per-node
// bolt-ons): any node/expression that fails applies a `ErrorPolicy` — `ignore`
// (skip it), `warn` (skip + record a warning), `value` (substitute a fallback
// expression), or `raise` (abort the whole run gracefully, returning the partial
// outcome with `aborted: true`). "Treat a branch condition as true/false" is just
// a `value` fallback of a boolean literal — no branch-specific machinery needed.

import { z } from "zod";
import type { ResolvedCharacter } from "./character.js";
import { characterScope, resolveSelector } from "./character.js";
import { attackDamageMultiplier, basicSaveMultiplier, dcFromModifier, degreeOrdinal, resolveCheck, rollCheck } from "./checks.js";
import { applyCounter, canSpend, type Counter } from "./counter.js";
import { isDamageType, type DamageCategory, type DamageType } from "./damage.js";
import { DEGREES, type DegreeOfSuccess } from "./degree.js";
import { rollNotation, safeParseDice, type RolledDie } from "./dice.js";
import { evaluate, exprSchema, type Expr, type ExprScope, type ExprValue } from "./expr.js";
import { heightenIncrements } from "./heightening.js";
import type { Rng } from "./rng.js";
import { passiveEffectSchema } from "./passive.js";
import { isSelector, type SaveSelector, type Selector } from "./selectors.js";
import { actionCostSchema } from "./spell.js";

// ---------------------------------------------------------------------------
// the error policy (shared by every node/expression that can fail)
// ---------------------------------------------------------------------------

export const errorPolicySchema = z.discriminatedUnion("on", [
  z.object({ on: z.literal("ignore") }).strict(),
  z.object({ on: z.literal("warn") }).strict(),
  z.object({ on: z.literal("raise") }).strict(),
  z.object({ on: z.literal("value"), value: exprSchema }).strict(),
]);
export type ErrorPolicy = z.infer<typeof errorPolicySchema>;

// ---------------------------------------------------------------------------
// node vocabulary
// ---------------------------------------------------------------------------

/**
 * A DC for a resolution node: a flat value expression, or one DERIVED from a
 * creature's stat modifier per the pasted rule (`10 + modifier`). `who` picks the
 * actor or the current target; `selector` should name a modifier-type statistic
 * (a save, a skill, Perception) — the derived DC is `10 + that modifier`.
 */
export type Dc =
  | { kind: "flat"; value: Expr }
  | { kind: "stat"; who: "actor" | "target"; selector: Selector };

/**
 * The optional per-degree child node-lists shared by every resolution node
 * (`save`/`attack`/`check`). After the degree is resolved, the matching list runs
 * — the "additional effect on this result" mechanism. `name` prefixes the degree
 * execution-state refs this node binds (defaults to the node kind).
 */
export interface DegreeChildren {
  name?: string;
  onCriticalSuccess?: AutomationNode[];
  onSuccess?: AutomationNode[];
  onFailure?: AutomationNode[];
  onCriticalFailure?: AutomationNode[];
}

/**
 * One typed component of a `damage` node — a dice formula plus its damage
 * descriptor (damage.ts vocabulary). `type` is optional: an untyped component is
 * valid (untyped damage exists, and healing is untyped).
 */
export interface DamageComponent {
  formula: string;
  type?: DamageType;
  material?: string;
  categories?: DamageCategory[];
  label?: string;
}

/**
 * How a `damage` node scales by a resolved degree: `attack` (crit ×2 / hit ×1 /
 * miss ×0) or `basic-save` (crit-success ×0 / success ×½ / failure ×1 /
 * crit-failure ×2). `from` names which resolution's degree to read (default the
 * most recent, `last`).
 */
export interface DamageScaling {
  by: "attack" | "basic-save";
  from?: string;
}

/**
 * INTERVAL heightening on a `damage` node — the stat block's "Heightened (+N) The
 * damage increases by 2d6". `step` is the N (the rank interval); `components` is what
 * ONE increment adds. The interpreter rolls them once per earned increment and sums,
 * which is what "the benefit is cumulative" means.
 *
 * WHY REPEAT-ROLL RATHER THAN A SCALED DICE COUNT: a per-increment `2d6` rolled twice
 * IS `4d6` — same dice, same distribution — and it stays correct for a mixed formula
 * like `1d4+1`, where multiplying only the dice count would silently leave the flat
 * term unscaled. It also needs no variable dice count in the grammar (see dice.ts).
 *
 * The other two heightening shapes deliberately need no field here: a FLAT increase is
 * plain arithmetic over the in-scope `castRank`/`baseRank` vars, and AT-RANK
 * heightening ("Heightened (5th) …") selects a subtree, which is the `heightened` node.
 */
export interface DamageHeightening {
  step: number;
  components: DamageComponent[];
}

/**
 * Whether an ACTOR-rolled node re-rolls for every target or rolls once and shares
 * the result across an enclosing `target` scope's iterations. Default
 * `per-target` — explicit beats magic.
 *
 * Only the roll is shared: the DC/AC lookup, the degree, and any damage multiplier
 * are ALWAYS computed per target. That is what expresses a one-attack-roll-vs-many-
 * ACs feat (one d20, different degrees because the ACs differ), and an area spell
 * whose damage is rolled once and then scaled by each target's own save result.
 *
 * `save` deliberately has no rollMode: a save is rolled BY the target, so every
 * creature inherently rolls its own.
 */
export type RollMode = "per-target" | "shared";

/** One rolled damage component in an emitted mutation (pre-scaling amount + descriptor). */
export interface DamageInstance {
  amount: number;
  type?: DamageType;
  material?: string;
  categories?: DamageCategory[];
  label?: string;
}

/**
 * One automation node. The union grows one entry per later slice; only the nodes
 * the interpreter can actually run are here, so the schema never claims more.
 * `branch` and the resolution nodes' per-degree lists make the tree recursive.
 */
export type AutomationNode =
  | { kind: "text"; title?: string; body: string }
  | { kind: "variable"; name: string; value: Expr; onError?: ErrorPolicy }
  | { kind: "roll"; notation: string; name?: string; onError?: ErrorPolicy }
  | ({ kind: "save"; save: SaveSelector; dc: Dc; basicSave?: boolean; onError?: ErrorPolicy } & DegreeChildren)
  | ({ kind: "attack"; bonus: Expr; rollMode?: RollMode; onError?: ErrorPolicy } & DegreeChildren)
  | ({ kind: "check"; check: Selector; dc: Dc; rollMode?: RollMode; onError?: ErrorPolicy } & DegreeChildren)
  | { kind: "damage"; components: DamageComponent[]; heightening?: DamageHeightening; scaling?: DamageScaling; healing?: boolean; target?: "self" | "target"; rollMode?: RollMode; onError?: ErrorPolicy }
  | { kind: "temphp"; formula: string; target?: "self" | "target"; onError?: ErrorPolicy }
  | { kind: "counter"; counter: string; amount: Expr; allowOverflow?: boolean; requireAvailable?: boolean; name?: string; onError?: ErrorPolicy }
  | { kind: "applyEffect"; effect: EffectTemplate; target?: "self" | "target"; linkGroup?: string; capture?: Record<string, Expr>; onError?: ErrorPolicy }
  | { kind: "removeEffect"; name: string; target?: "self" | "target"; cascade?: boolean; onError?: ErrorPolicy }
  | { kind: "target"; mode: "all" | "self" | "position"; index?: number; children: AutomationNode[]; onError?: ErrorPolicy }
  | { kind: "heightened"; entries: HeightenedEntry[]; onError?: ErrorPolicy }
  | { kind: "branch"; condition: Expr; onTrue: AutomationNode[]; onFalse: AutomationNode[]; onError?: ErrorPolicy };

/**
 * One AT-RANK heightening entry on a `heightened` node — the stat block's "Heightened
 * (5th) …". `minRank` is the rank the entry starts applying at, and it keeps applying
 * at every higher rank until a higher entry takes over.
 *
 * `minRank`, not `rank`: an entry is a FLOOR, not an exact match. A spell with entries
 * at 2nd/5th/7th cast at 8th rank uses the 7th entry, and cast at 4th uses the 2nd.
 */
export interface HeightenedEntry {
  minRank: number;
  children: AutomationNode[];
}

/** Zod schema for a node (recursive via `z.lazy`, since nodes nest node lists). */
export const automationNodeSchema: z.ZodType<AutomationNode> = z.lazy(() =>
  z.discriminatedUnion("kind", [
    textNodeSchema,
    variableNodeSchema,
    rollNodeSchema,
    saveNodeSchema,
    attackNodeSchema,
    checkNodeSchema,
    damageNodeSchema,
    tempHpNodeSchema,
    counterNodeSchema,
    applyEffectNodeSchema,
    removeEffectNodeSchema,
    targetNodeSchema,
    heightenedNodeSchema,
    branchNodeSchema,
  ]),
);

const rollModeSchema = z.enum(["per-target", "shared"]);

/** Any readable stat selector (a fixed stat or a skill slug); validated by isSelector. */
const selectorSchema = z.custom<Selector>((v) => isSelector(v), { message: "unknown stat selector" });

const dcSchema: z.ZodType<Dc> = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("flat"), value: exprSchema }).strict(),
  z.object({ kind: z.literal("stat"), who: z.enum(["actor", "target"]), selector: selectorSchema }).strict(),
]);

/** The per-degree child lists, spread into each resolution node's schema. */
const degreeOutcomeShape = {
  name: z.string().min(1).optional(),
  onCriticalSuccess: z.array(automationNodeSchema).optional(),
  onSuccess: z.array(automationNodeSchema).optional(),
  onFailure: z.array(automationNodeSchema).optional(),
  onCriticalFailure: z.array(automationNodeSchema).optional(),
};

// ---------------------------------------------------------------------------
// the authored EFFECT vocabulary (Layer 1.5's content side)
// ---------------------------------------------------------------------------
//
// This lives here, next to the node union, because the two are MUTUALLY
// RECURSIVE — an `applyEffect` node carries an effect template, the template
// carries buttons, and a button carries automation nodes. That loop is the doc's
// "heart of the engine" (automation → applied effect → button → automation), so
// the declarations cannot be split across modules. `applied.ts` builds the RUNTIME
// shape on top of these and imports one-way.

/**
 * A moment in the turn cycle, relative to an effect: the start or end of the turn
 * of the creature that APPLIED it (`origin`) or the one it is ON (`bearer`). The
 * shared primitive behind both tick timing and expiry — modelling only start/end,
 * without *whose*, is how effects end up a turn off.
 */
export const turnMomentSchema = z
  .object({ when: z.enum(["start", "end"]), whose: z.enum(["origin", "bearer"]) })
  .strict();
export type TurnMoment = z.infer<typeof turnMomentSchema>;

/** How long an applied effect lasts. Kinds mirror the Durations rules text. */
export const durationSchema = z.discriminatedUnion("kind", [
  /** Until counteracted or Dismissed. */
  z.object({ kind: z.literal("unlimited") }).strict(),
  /** N rounds: decrements at the START of the origin's turn, ending at 0. */
  z.object({ kind: z.literal("rounds"), count: z.number().int().nonnegative() }).strict(),
  /** Until the end of the origin's NEXT turn, unless Sustained. */
  z.object({ kind: z.literal("sustained") }).strict(),
  /**
   * Until a given turn moment. `next: true` means the NEXT such turn — the
   * occurrence during the turn the effect was applied in does not count ("until the
   * end of your next turn" vs "until the end of your turn").
   */
  z.object({ kind: z.literal("until"), moment: turnMomentSchema, next: z.boolean().optional() }).strict(),
  /** Wall/game-clock durations. Not resolved by the turn machinery — the host's clock. */
  z.object({ kind: z.literal("time"), amount: z.number().positive(), unit: z.enum(["minutes", "hours", "days"]) }).strict(),
  /** Until the origin's next daily preparations. */
  z.object({ kind: z.literal("dailyPreparations") }).strict(),
]);
export type Duration = z.infer<typeof durationSchema>;

/**
 * A BUTTON on an applied effect — a self-contained mini-action a player presses
 * (Escape a grapple, attempt a recovery check). Its automation is re-entered
 * through `runButton`, which is the recursion closing.
 *
 * [PF2e] Its context is LIVE, not a frozen closure: the host builds a fresh
 * execution context at PRESS time, so a DC derived from a creature's stat tracks
 * that creature's current bonuses and penalties (a grapple's escape DC drops when
 * the grappler becomes enfeebled). Values that genuinely must not drift are frozen
 * separately, via the `applyEffect` node's opt-in `capture`.
 */
export const buttonSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    verb: z.string().min(1).optional(),
    style: z.enum(["primary", "secondary", "danger"]).optional(),
    automation: z.array(automationNodeSchema),
  })
  .strict();
export type Button = z.infer<typeof buttonSchema>;

/**
 * A GRANTED ACTION — a full activity the creature gains for the effect's duration
 * (a stance's special strike, Escape). Distinct from a button: a button is a quick
 * trigger, an action is something you spend actions on.
 */
export const grantedActionSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    actionCost: actionCostSchema.optional(),
    description: z.string().min(1).optional(),
    automation: z.array(automationNodeSchema).optional(),
  })
  .strict();
export type GrantedAction = z.infer<typeof grantedActionSchema>;

/**
 * The AUTHORED part of an applied effect — everything content can know ahead of
 * time. An `applyEffect` node carries one of these; the runtime identity
 * (`id`/`originId`/`bearerId`/`appliedAt`) is stamped by the HOST, because minting
 * an instance id and reading the clock are both impure and belong outside core.
 * See `applied.ts` for the runtime shape and the timing resolvers.
 */
export const effectTemplateSchema = z
  .object({
    name: z.string().min(1),
    duration: durationSchema,
    /**
     * Whether this effect can be Sustained — INDEPENDENT of `duration`. `extends`
     * says whether Sustaining restarts the duration clock (implicit for
     * `duration: sustained`); a fixed-duration effect with a Sustain bonus sets
     * `extends: false` and carries its extra automation as a granted action.
     */
    sustain: z.object({ extends: z.boolean().optional() }).strict().optional(),
    /** WHEN a recurring effect fires/prompts. */
    tickTiming: turnMomentSchema.optional(),
    /**
     * The button the tick fires — so the tick and a manual press run the SAME
     * automation. Ticks PROMPT, they do not resolve: a recovery check must always
     * be re-attemptable off-turn (assistance changing its DC, an ability granting
     * an immediate attempt), so nothing here is purely automatic.
     */
    tickButton: z.string().min(1).optional(),
    /** The Layer-1 passives this effect imposes while active. */
    passives: z.array(passiveEffectSchema),
    /** Quick triggers the bearer/origin can press while the effect is active. */
    buttons: z.array(buttonSchema).optional(),
    /** Full activities gained for the duration. */
    grantedActions: z.array(grantedActionSchema).optional(),
    /** Can be ended early by the Dismiss action. */
    dismissible: z.boolean().optional(),
  })
  .strict();
export type EffectTemplate = z.infer<typeof effectTemplateSchema>;

const textNodeSchema = z
  .object({ kind: z.literal("text"), title: z.string().optional(), body: z.string() })
  .strict();

const variableNodeSchema = z
  .object({ kind: z.literal("variable"), name: z.string().min(1), value: exprSchema, onError: errorPolicySchema.optional() })
  .strict();

const rollNodeSchema = z
  .object({
    kind: z.literal("roll"),
    /** Dice notation (`2d6 + strengthMod`); validated as parseable at schema time. */
    notation: z.string().min(1).refine((n) => safeParseDice(n) !== null, { message: "invalid dice notation" }),
    /** Optional name to bind the total to (the total is always bound to `lastRoll`). */
    name: z.string().min(1).optional(),
    onError: errorPolicySchema.optional(),
  })
  .strict();

const saveNodeSchema = z
  .object({
    kind: z.literal("save"),
    save: z.enum(["fortitude", "reflex", "will"]),
    dc: dcSchema,
    /** Marks this as a basic save; the none/half/full/double scale is applied by the damage node (slice 4). */
    basicSave: z.boolean().optional(),
    onError: errorPolicySchema.optional(),
    ...degreeOutcomeShape,
  })
  .strict();

const attackNodeSchema = z
  .object({
    kind: z.literal("attack"),
    /** The attack modifier expression (e.g. `spellAttack`); resolved against the target's AC. */
    bonus: exprSchema,
    rollMode: rollModeSchema.optional(),
    onError: errorPolicySchema.optional(),
    ...degreeOutcomeShape,
  })
  .strict();

const checkNodeSchema = z
  .object({
    kind: z.literal("check"),
    /** The statistic the actor rolls (a skill, Perception, …). */
    check: selectorSchema,
    dc: dcSchema,
    rollMode: rollModeSchema.optional(),
    onError: errorPolicySchema.optional(),
    ...degreeOutcomeShape,
  })
  .strict();

const damageComponentSchema = z
  .object({
    formula: z.string().min(1).refine((n) => safeParseDice(n) !== null, { message: "invalid dice notation" }),
    type: z.custom<DamageType>((v) => isDamageType(v), { message: "unknown damage type" }).optional(),
    material: z.string().min(1).optional(),
    categories: z.array(z.enum(["persistent", "precision", "splash"])).optional(),
    label: z.string().min(1).optional(),
  })
  .strict();

const damageNodeSchema = z
  .object({
    kind: z.literal("damage"),
    components: z.array(damageComponentSchema).min(1),
    heightening: z
      .object({ step: z.number().int().min(1), components: z.array(damageComponentSchema).min(1) })
      .strict()
      .optional(),
    scaling: z.object({ by: z.enum(["attack", "basic-save"]), from: z.string().min(1).optional() }).strict().optional(),
    healing: z.boolean().optional(),
    target: z.enum(["self", "target"]).optional(),
    rollMode: rollModeSchema.optional(),
    onError: errorPolicySchema.optional(),
  })
  .strict();

const tempHpNodeSchema = z
  .object({
    kind: z.literal("temphp"),
    formula: z.string().min(1).refine((n) => safeParseDice(n) !== null, { message: "invalid dice notation" }),
    target: z.enum(["self", "target"]).optional(),
    onError: errorPolicySchema.optional(),
  })
  .strict();

const counterNodeSchema = z
  .object({
    kind: z.literal("counter"),
    /** The counter's id in the context snapshot (e.g. "focus", "wand-charges"). */
    counter: z.string().min(1),
    /** Units to SPEND: positive spends, negative recharges (the counter.ts convention). */
    amount: exprSchema,
    /** Let the result pass its bounds instead of clamping into [min, max]. */
    allowOverflow: z.boolean().optional(),
    /** Require the FULL amount to be spendable; otherwise emit nothing and apply the error policy. */
    requireAvailable: z.boolean().optional(),
    /** Optional prefix for this node's execution-state refs (always also bound to `lastCounter…`). */
    name: z.string().min(1).optional(),
    onError: errorPolicySchema.optional(),
  })
  .strict();

const applyEffectNodeSchema = z
  .object({
    kind: z.literal("applyEffect"),
    /** The authored effect; the host stamps its runtime identity when applying. */
    effect: effectTemplateSchema,
    target: z.enum(["self", "target"]).optional(),
    /**
     * A label joining effects applied by ONE invocation into a link group, so a
     * paired application (Grappled on the target + Grappling on the caster) can be
     * removed as a unit. The host maps the label to a real group id.
     */
    linkGroup: z.string().min(1).optional(),
    /**
     * OPT-IN freezing: expressions evaluated NOW, at apply time, whose values ride
     * along on the effect for its buttons to read. Live resolution is the DEFAULT —
     * a DC derived from a creature's stat should track that creature's current
     * bonuses/penalties — so capture only what genuinely must not drift (the rank a
     * spell was cast at, a one-time roll, a value from a creature that may be gone).
     */
    capture: z.record(z.string(), exprSchema).optional(),
    onError: errorPolicySchema.optional(),
  })
  .strict();

const removeEffectNodeSchema = z
  .object({
    kind: z.literal("removeEffect"),
    /** The effect's name; the host resolves which instance(s) on that creature. */
    name: z.string().min(1),
    target: z.enum(["self", "target"]).optional(),
    /** Also remove every effect linked to it (the whole link group). */
    cascade: z.boolean().optional(),
    onError: errorPolicySchema.optional(),
  })
  .strict();

const targetNodeSchema = z
  .object({
    kind: z.literal("target"),
    /** `all` iterates every target; `self` scopes to the actor; `position` picks the `index`th. */
    mode: z.enum(["all", "self", "position"]),
    /** Required by `position` mode; ignored otherwise. */
    index: z.number().int().nonnegative().optional(),
    children: z.array(automationNodeSchema),
    onError: errorPolicySchema.optional(),
  })
  .strict();

const heightenedNodeSchema = z
  .object({
    kind: z.literal("heightened"),
    entries: z
      .array(z.object({ minRank: z.number().int().min(0).max(10), children: z.array(automationNodeSchema) }).strict())
      .min(1),
    onError: errorPolicySchema.optional(),
  })
  .strict();

const branchNodeSchema = z
  .object({
    kind: z.literal("branch"),
    condition: exprSchema,
    onTrue: z.array(automationNodeSchema),
    onFalse: z.array(automationNodeSchema),
    onError: errorPolicySchema.optional(),
  })
  .strict();

/** An automation program is an ordered list of nodes. */
export const automationSchema = z.array(automationNodeSchema);

// ---------------------------------------------------------------------------
// execution context + outcome
// ---------------------------------------------------------------------------

/**
 * A narration entry the interpreter appends. `text` is authored narration; `roll`
 * records a dice roll (its total + every die) so the outcome is transparent about
 * what was rolled. The union grows with the node vocabulary.
 */
export type LogEntry =
  | { kind: "text"; title?: string; body: string }
  | { kind: "roll"; notation: string; total: number; dice: RolledDie[]; name?: string }
  | { kind: "check"; checkType: "save" | "attack" | "check"; die: number; total: number; dc: number; degree: DegreeOfSuccess; name?: string };

/**
 * An intended state change for the host app to apply. The union grows one kind per
 * later slice (applyEffect, spendCounter, …). `target` is the current target or the
 * actor; the host resolves those to concrete actors. Amounts are final integers;
 * `instances` carries the pre-scaling typed breakdown for the (later) resistance
 * slice. These are INTENTIONS — this module computes them, it never applies them.
 */
/**
 * WHICH creature a mutation lands on, resolved by the interpreter: the acting
 * character, or a concrete entry in the context's `targets` list (by index — the
 * host maps the index back to its own actor). A node authors `"self" | "target"`
 * ("the actor" / "the current target"); this is what that resolves to at emit.
 */
export type MutationTarget = { kind: "self" } | { kind: "target"; index: number };

export type Mutation =
  | { kind: "damage"; target: MutationTarget; healing: boolean; amount: number; instances: DamageInstance[] }
  | { kind: "temphp"; target: MutationTarget; amount: number }
  | { kind: "counter"; counter: string; spent: number; remaining: number }
  | { kind: "applyEffect"; target: MutationTarget; effect: EffectTemplate; linkGroup?: string; captured?: Record<string, ExprValue> }
  | { kind: "removeEffect"; target: MutationTarget; name: string; cascade: boolean };

export interface Outcome {
  /** Narration produced, in order. */
  log: LogEntry[];
  /** Intended state changes for the host to apply (empty this slice). */
  mutations: Mutation[];
  /** Non-fatal problems (a `warn`/`ignore`d failure, an abort reason). */
  warnings: string[];
  /** True if a `raise` error policy aborted the run before every node ran. */
  aborted: boolean;
}

export interface ExecutionContext {
  /** The acting character; its resolved stats seed the expression scope. */
  actor: ResolvedCharacter;
  /**
   * The ordered creatures this invocation can affect. The interpreter tracks a
   * CURRENT target — `targets[0]` outside any `target` node (so single-target
   * automations read naturally), re-scoped per iteration by a `target` node.
   * A resolution or mutation needing a target with none set fails through the
   * error policy. The host supplies this list; area/template geometry is its
   * concern, not the engine's.
   */
  targets?: ResolvedCharacter[];
  /**
   * A read-only snapshot of the actor's named counters (focus points, item
   * charges, …), supplied by the HOST — this interpreter owns no persistent
   * state. The run mutates only a working copy, so two `counter` nodes touching
   * the same counter compound correctly; the resulting spends are reported as
   * `counter` mutations for the host to apply. (Current focus points are play
   * state, not on `ResolvedCharacter`, which carries only `focusPoints.max`.)
   */
  counters?: Record<string, Counter>;
  /**
   * The spell ranks behind this invocation, when there is one — `baseRank` is the
   * spell's lowest rank, `castRank` the rank it was actually cast at. Both are
   * exposed to expressions and dice as `baseRank` / `castRank`, which is what lets
   * flat heightening ("the temporary HP increase by 5") be plain arithmetic and
   * at-rank heightening be a `heightened` node — no extra vocabulary for either.
   *
   * The HOST resolves `castRank` (the slot used, or `autoHeightenRank(level)` for a
   * cantrip or focus spell — heightening.ts owns that rule) and re-supplies it when
   * building a button's fresh press-time context. Absent for non-spell automation;
   * a `damage` node's `heightening` then warns and deals unheightened damage.
   */
  spell?: { baseRank: number; castRank: number };
  /** The seeded RNG — the ONLY randomness source, so the run is replayable. */
  rng: Rng;
  /**
   * Starting execution-state variables supplied by the host — how a pressed
   * button receives an effect's `captured` values. Character-namespace names are
   * still readable; these sit alongside them and are visible to every node.
   */
  vars?: Record<string, ExprValue>;
  /** Default error policy for nodes that don't carry their own. Defaults to `ignore`. */
  onError?: ErrorPolicy;
}

/** Internal sentinel: a `raise` policy aborts the walk; caught at the top of the run. */
class Abort {
  constructor(readonly reason: string) {}
}

// ---------------------------------------------------------------------------
// the interpreter
// ---------------------------------------------------------------------------

/**
 * Run an automation tree against a context, returning the accumulated outcome.
 * Pure: it reads the context and returns a value; it mutates nothing outside the
 * outcome it builds. Variables bind into a flat, forward-only execution scope —
 * a node sees every variable bound before it (including inside an earlier branch).
 */
export function runAutomation(tree: readonly AutomationNode[], ctx: ExecutionContext): Outcome {
  const outcome: Outcome = { log: [], mutations: [], warnings: [], aborted: false };
  const charScope = characterScope(ctx.actor);
  const execVars: Record<string, ExprValue> = { ...(ctx.vars ?? {}) };
  // A working copy of the host's counter snapshot: spends within one run compound,
  // but the caller's objects are never mutated.
  const counters: Record<string, Counter> = {};
  for (const [id, c] of Object.entries(ctx.counters ?? {})) counters[id] = { ...c };
  // The invocation's spell ranks read as ambient vars, so flat heightening is plain
  // arithmetic (`5 + 5 * (castRank - baseRank)`) and a `heightened` node's selection
  // needs no new expression vocabulary. They sit with the character scope — ambient
  // facts an explicit `variable` node may shadow in expressions, exactly as it may
  // shadow `strengthMod`. The typed `ctx.spell` stays authoritative for the rules
  // arithmetic itself, mirroring how `resolveDc` reads the real creature rather than
  // a scope var.
  const spellVars: Record<string, ExprValue> = ctx.spell
    ? { castRank: ctx.spell.castRank, baseRank: ctx.spell.baseRank }
    : {};
  const scope = (): ExprScope => ({
    vars: { ...charScope.vars, ...spellVars, ...execVars },
    functions: charScope.functions,
  });

  /**
   * The single error-policy handler (the doc's uniform model). Called after a
   * failure; on a `value` policy it evaluates the fallback expression (coerced to
   * `expected`) and hands it to `onValue`. Throws `Abort` on `raise`.
   */
  const applyPolicy = (
    policy: ErrorPolicy | undefined,
    what: string,
    onValue?: (v: ExprValue) => void,
    expected?: "number" | "boolean",
  ): void => {
    const p = policy ?? ctx.onError ?? { on: "ignore" };
    switch (p.on) {
      case "raise":
        throw new Abort(`${what} failed`);
      case "warn":
        outcome.warnings.push(`${what} failed`);
        return;
      case "value":
        if (!onValue) return;
        try {
          onValue(evaluate(p.value, scope(), expected));
        } catch {
          outcome.warnings.push(`${what} failed and its fallback value failed`);
        }
        return;
      case "ignore":
        return;
    }
  };

  /** Evaluate an expression under the active error policy. */
  const tryEval = (
    expr: Expr,
    expected: "number" | "boolean" | undefined,
    policy: ErrorPolicy | undefined,
    what: string,
  ): { ok: true; value: ExprValue } | { ok: false } => {
    try {
      return { ok: true, value: evaluate(expr, scope(), expected) };
    } catch {
      let result: { ok: true; value: ExprValue } | { ok: false } = { ok: false };
      applyPolicy(policy, what, (v) => {
        result = { ok: true, value: v };
      }, expected);
      return result;
    }
  };

  /** The numeric subset of the current scope vars — what dice notation can read. */
  const numericVars = (): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(scope().vars ?? {})) if (typeof v === "number") out[k] = v;
    return out;
  };

  /** Bind a roll's total to `lastRoll` (and the node's name) and log it. */
  const bindRoll = (node: { notation: string; name?: string }, total: number, dice: RolledDie[]): void => {
    execVars.lastRoll = total;
    if (node.name) execVars[node.name] = total;
    outcome.log.push({ kind: "roll", notation: node.notation, total, dice, ...(node.name ? { name: node.name } : {}) });
  };

  // The current target scope: the actor, or an index into ctx.targets. Defaults to
  // the first target so single-target automations need no `target` node; a `target`
  // node re-scopes it per iteration.
  let current: MutationTarget | null = (ctx.targets?.length ?? 0) > 0 ? { kind: "target", index: 0 } : null;

  // Cache for `rollMode: "shared"` nodes, keyed by node identity and scoped to one
  // `target` node's iteration. Null outside a target scope — a shared node there is
  // simply a normal single roll, since there is nothing to share across.
  let sharedRolls: Map<AutomationNode, unknown> | null = null;
  const getShared = <T>(node: AutomationNode, mode: RollMode | undefined): T | undefined =>
    mode === "shared" ? (sharedRolls?.get(node) as T | undefined) : undefined;
  const putShared = (node: AutomationNode, mode: RollMode | undefined, value: unknown): void => {
    if (mode === "shared") sharedRolls?.set(node, value);
  };

  /** The creature currently in scope, or throw (→ the node's error policy). */
  const requireTarget = (): ResolvedCharacter => {
    if (!current) throw new Error("no target in context");
    if (current.kind === "self") return ctx.actor;
    const t = ctx.targets?.[current.index];
    if (!t) throw new Error("no target in context");
    return t;
  };

  /** Resolve an authored `"self" | "target"` to the concrete creature a mutation lands on. */
  const mutationTarget = (which: "self" | "target"): MutationTarget => {
    if (which === "self") return { kind: "self" };
    if (!current) throw new Error("no target in context");
    return current;
  };

  /** Resolve a DC: a flat expression, or `10 + a creature's stat modifier`. */
  const resolveDc = (dc: Dc): number => {
    if (dc.kind === "flat") return evaluate(dc.value, scope(), "number") as number;
    const creature = dc.who === "actor" ? ctx.actor : requireTarget();
    return dcFromModifier(resolveSelector(creature, dc.selector));
  };

  /** Bind a degree to the execution scope under `<name>…` refs (ordinal + booleans). */
  const bindDegree = (name: string, degree: DegreeOfSuccess): void => {
    execVars[`${name}Degree`] = degreeOrdinal(degree);
    execVars[`${name}IsCritSuccess`] = degree === "critical-success";
    execVars[`${name}IsSuccess`] = degree === "success";
    execVars[`${name}IsFailure`] = degree === "failure";
    execVars[`${name}IsCritFailure`] = degree === "critical-failure";
  };

  const childrenFor = (node: DegreeChildren, degree: DegreeOfSuccess): AutomationNode[] | undefined => {
    switch (degree) {
      case "critical-success":
        return node.onCriticalSuccess;
      case "success":
        return node.onSuccess;
      case "failure":
        return node.onFailure;
      case "critical-failure":
        return node.onCriticalFailure;
    }
  };

  /**
   * Roll a resolution, bind its degree refs (under the node's name AND `last…`),
   * log it, and return the matching per-degree child list to run. The children are
   * returned rather than run here so a `raise` inside them propagates cleanly.
   */
  const resolve = (
    node: DegreeChildren,
    checkType: "save" | "attack" | "check",
    modifier: number,
    dc: number,
    rollMode?: RollMode,
  ): AutomationNode[] | undefined => {
    // A shared roll is made once and compared against each target's own DC, so the
    // degree still differs per target.
    const cached = getShared<{ die: number; total: number }>(node as AutomationNode, rollMode);
    const result = cached ? resolveCheck({ ...cached, dc }) : rollCheck({ modifier, dc, rng: ctx.rng });
    if (!cached) putShared(node as AutomationNode, rollMode, { die: result.die, total: result.total });
    const name = node.name ?? checkType;
    bindDegree(name, result.degree);
    bindDegree("last", result.degree);
    outcome.log.push({
      kind: "check",
      checkType,
      die: result.die,
      total: result.total,
      dc: result.dc,
      degree: result.degree,
      ...(node.name ? { name: node.name } : {}),
    });
    return childrenFor(node, result.degree);
  };

  /**
   * Bind a counter result to the execution scope under `lastCounter…` (and the
   * node's name, if given). Exposing these cleanly is what removes the need for
   * the "dummy counter as a variable store" hack seen in the Avrae corpus.
   */
  const bindCounter = (name: string | undefined, requested: number, spent: number, remaining: number, clamped: boolean): void => {
    const set = (prefix: string) => {
      execVars[`${prefix}Requested`] = requested;
      execVars[`${prefix}Spent`] = spent;
      execVars[`${prefix}Remaining`] = remaining;
      execVars[`${prefix}Clamped`] = clamped;
    };
    set("lastCounter");
    if (name) set(name);
  };

  /** The degree-based damage multiplier for a scaling spec, reading the named degree ref. */
  const scalingFactor = (scaling: DamageScaling): number => {
    const from = scaling.from ?? "last";
    const ord = execVars[`${from}Degree`];
    if (typeof ord !== "number" || DEGREES[ord] === undefined) {
      outcome.warnings.push(`damage scaling: no "${from}" degree to scale by`);
      return 1;
    }
    const degree = DEGREES[ord];
    return scaling.by === "attack" ? attackDamageMultiplier(degree) : basicSaveMultiplier(degree);
  };

  const runNode = (node: AutomationNode): void => {
    switch (node.kind) {
      case "text":
        outcome.log.push({ kind: "text", ...(node.title !== undefined ? { title: node.title } : {}), body: node.body });
        return;
      case "variable": {
        const r = tryEval(node.value, undefined, node.onError, `variable "${node.name}"`);
        if (r.ok) execVars[node.name] = r.value;
        return;
      }
      case "roll": {
        try {
          const result = rollNotation(node.notation, ctx.rng, numericVars());
          bindRoll(node, result.total, result.dice);
        } catch {
          applyPolicy(node.onError, `roll "${node.notation}"`, (v) => bindRoll(node, Number(v), []), "number");
        }
        return;
      }
      case "save": {
        let children: AutomationNode[] | undefined;
        try {
          const target = requireTarget();
          children = resolve(node, "save", resolveSelector(target, node.save), resolveDc(node.dc));
        } catch (e) {
          if (e instanceof Abort) throw e;
          applyPolicy(node.onError, `save (${node.save})`);
          return;
        }
        if (children) runNodes(children);
        return;
      }
      case "attack": {
        let children: AutomationNode[] | undefined;
        try {
          const target = requireTarget();
          const modifier = evaluate(node.bonus, scope(), "number") as number;
          children = resolve(node, "attack", modifier, resolveSelector(target, "ac"), node.rollMode);
        } catch (e) {
          if (e instanceof Abort) throw e;
          applyPolicy(node.onError, "attack");
          return;
        }
        if (children) runNodes(children);
        return;
      }
      case "check": {
        let children: AutomationNode[] | undefined;
        try {
          children = resolve(node, "check", resolveSelector(ctx.actor, node.check), resolveDc(node.dc), node.rollMode);
        } catch (e) {
          if (e instanceof Abort) throw e;
          applyPolicy(node.onError, `check (${node.check})`);
          return;
        }
        if (children) runNodes(children);
        return;
      }
      case "damage": {
        try {
          // A shared damage roll is rolled once and reused for every target; each
          // target's own degree still scales it independently.
          let rolled = getShared<{ instances: DamageInstance[]; subtotal: number }>(node, node.rollMode);
          if (!rolled) {
            const vars = numericVars();
            const instances: DamageInstance[] = [];
            let subtotal = 0;
            const rollComponent = (c: DamageComponent, times: number): void => {
              if (times < 1) return;
              // One instance per component, even when heightening rolls it several
              // times: the repeats are the SAME typed damage, and the deferred
              // resistance slice applies resistance once per descriptor.
              let amount = 0;
              for (let i = 0; i < times; i += 1) amount += rollNotation(c.formula, ctx.rng, vars).total;
              subtotal += amount;
              instances.push({
                amount,
                ...(c.type !== undefined ? { type: c.type } : {}),
                ...(c.material !== undefined ? { material: c.material } : {}),
                ...(c.categories !== undefined ? { categories: c.categories } : {}),
                ...(c.label !== undefined ? { label: c.label } : {}),
              });
            };
            for (const c of node.components) rollComponent(c, 1);
            if (node.heightening) {
              // "The listed effect applies for every increment of ranks by which the
              // spell is heightened above its lowest spell rank, and the benefit is
              // cumulative" — so roll the per-increment components once per increment.
              const increments = ctx.spell
                ? heightenIncrements({ ...ctx.spell, step: node.heightening.step })
                : 0;
              if (!ctx.spell) outcome.warnings.push("damage heightening: no spell rank in context");
              for (const c of node.heightening.components) rollComponent(c, increments);
            }
            rolled = { instances, subtotal };
            putShared(node, node.rollMode, rolled);
          }
          // Scale the TOTAL, then round down once (PF2e's round-once-at-the-end rule).
          const factor = node.scaling ? scalingFactor(node.scaling) : 1;
          const amount = Math.max(0, Math.floor(rolled.subtotal * factor));
          const target = mutationTarget(node.target ?? "target");
          // Clone the instances so shared rolls never alias across mutations.
          const instances = rolled.instances.map((i) => ({ ...i }));
          outcome.mutations.push({ kind: "damage", target, healing: node.healing === true, amount, instances });
        } catch (e) {
          if (e instanceof Abort) throw e;
          applyPolicy(node.onError, "damage");
        }
        return;
      }
      case "temphp": {
        try {
          const amount = Math.max(0, rollNotation(node.formula, ctx.rng, numericVars()).total);
          const target = mutationTarget(node.target ?? "self");
          outcome.mutations.push({ kind: "temphp", target, amount });
        } catch (e) {
          if (e instanceof Abort) throw e;
          applyPolicy(node.onError, "temphp");
        }
        return;
      }
      case "counter": {
        const current = counters[node.counter];
        if (!current) {
          applyPolicy(node.onError, `counter "${node.counter}" (unknown)`);
          return;
        }
        const r = tryEval(node.amount, "number", node.onError, `counter "${node.counter}" amount`);
        if (!r.ok) return;
        const amount = r.value as number;
        if (node.requireAvailable === true && !canSpend(current, amount)) {
          applyPolicy(node.onError, `counter "${node.counter}" (not enough available)`);
          return;
        }
        const result = applyCounter(current, {
          amount,
          ...(node.allowOverflow !== undefined ? { allowOverflow: node.allowOverflow } : {}),
        });
        counters[node.counter] = result.counter; // later nodes see the spend
        bindCounter(node.name, result.requested, result.spent, result.remaining, result.clamped);
        outcome.mutations.push({ kind: "counter", counter: node.counter, spent: result.spent, remaining: result.remaining });
        return;
      }
      case "applyEffect": {
        try {
          const target = mutationTarget(node.target ?? "target");
          // Opt-in freeze: evaluate the captured expressions NOW.
          let captured: Record<string, ExprValue> | undefined;
          if (node.capture) {
            captured = {};
            for (const [name, expr] of Object.entries(node.capture)) captured[name] = evaluate(expr, scope());
          }
          outcome.mutations.push({
            kind: "applyEffect",
            target,
            effect: node.effect,
            ...(node.linkGroup !== undefined ? { linkGroup: node.linkGroup } : {}),
            ...(captured !== undefined ? { captured } : {}),
          });
        } catch (e) {
          if (e instanceof Abort) throw e;
          applyPolicy(node.onError, `applyEffect "${node.effect.name}"`);
        }
        return;
      }
      case "removeEffect": {
        try {
          const target = mutationTarget(node.target ?? "target");
          outcome.mutations.push({ kind: "removeEffect", target, name: node.name, cascade: node.cascade === true });
        } catch (e) {
          if (e instanceof Abort) throw e;
          applyPolicy(node.onError, `removeEffect "${node.name}"`);
        }
        return;
      }
      case "target": {
        // Work out the scopes to iterate. `all` over an empty target list simply
        // runs nothing (an area that caught no one is not an error).
        let scopes: MutationTarget[];
        if (node.mode === "self") {
          scopes = [{ kind: "self" }];
        } else if (node.mode === "all") {
          scopes = (ctx.targets ?? []).map((_, i) => ({ kind: "target", index: i }));
        } else {
          if (node.index === undefined || (ctx.targets ?? [])[node.index] === undefined) {
            applyPolicy(node.onError, `target position ${node.index ?? "(unset)"}`);
            return;
          }
          scopes = [{ kind: "target", index: node.index }];
        }
        // Children run OUTSIDE any try/catch so a `raise` inside them still aborts;
        // `finally` restores the enclosing scope either way.
        const saved = current;
        const savedShared = sharedRolls;
        sharedRolls = new Map();
        try {
          for (const scope of scopes) {
            current = scope;
            runNodes(node.children);
          }
        } finally {
          current = saved;
          sharedRolls = savedShared;
        }
        return;
      }
      case "heightened": {
        // AT-RANK heightening: read exactly ONE entry — the highest whose minRank the
        // cast reaches — and never stack them. Entries are self-contained by the rules
        // text ("if its benefits are meant to include any of the effects of a
        // lower-rank heightened entry, those benefits will be included in the entry"),
        // precisely because only one is ever read. Selecting by max here means the
        // authored order carries no meaning and cannot be got wrong.
        if (!ctx.spell) {
          applyPolicy(node.onError, "heightened (no spell rank in context)");
          return;
        }
        const castRank = ctx.spell.castRank;
        let best: HeightenedEntry | undefined;
        for (const e of node.entries) {
          if (e.minRank <= castRank && (best === undefined || e.minRank > best.minRank)) best = e;
        }
        // No entry reached is not an error: a spell cast below its lowest heightened
        // entry simply gains nothing.
        if (best) runNodes(best.children);
        return;
      }
      case "branch": {
        const r = tryEval(node.condition, "boolean", node.onError, "branch condition");
        if (r.ok) runNodes(r.value ? node.onTrue : node.onFalse);
        return;
      }
    }
  };

  const runNodes = (nodes: readonly AutomationNode[]): void => {
    for (const node of nodes) runNode(node);
  };

  try {
    runNodes(tree);
  } catch (e) {
    if (e instanceof Abort) {
      outcome.aborted = true;
      outcome.warnings.push(`aborted: ${e.reason}`);
    } else {
      throw e;
    }
  }
  return outcome;
}

/**
 * Run a button's automation — the host's entry point when a player presses it, and
 * where the engine's recursion closes (automation → applied effect → button →
 * automation).
 *
 * `ctx` is built FRESH at press time, so everything resolves LIVE against current
 * stats: an escape DC read as `{kind:"stat", who:"target", selector:"athletics"}`
 * follows the grappler's Athletics *right now*, enfeebled and all. `captured` (the
 * opt-in values frozen when the effect was applied) is merged in as starting
 * variables, so a button can mix live lookups with frozen ones.
 */
export function runButton(
  button: Button,
  ctx: ExecutionContext,
  captured: Record<string, ExprValue> = {},
): Outcome {
  return runAutomation(button.automation, { ...ctx, vars: { ...ctx.vars, ...captured } });
}
