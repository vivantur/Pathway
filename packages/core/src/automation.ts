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
import { effectTemplateSchema, type EffectTemplate } from "./applied.js";
import type { ResolvedCharacter } from "./character.js";
import { characterScope, resolveSelector } from "./character.js";
import { attackDamageMultiplier, basicSaveMultiplier, dcFromModifier, degreeOrdinal, resolveCheck, rollCheck } from "./checks.js";
import { applyCounter, canSpend, type Counter } from "./counter.js";
import { isDamageType, type DamageCategory, type DamageType } from "./damage.js";
import { DEGREES, type DegreeOfSuccess } from "./degree.js";
import { rollNotation, safeParseDice, type RolledDie } from "./dice.js";
import { evaluate, exprSchema, type Expr, type ExprScope, type ExprValue } from "./expr.js";
import type { Rng } from "./rng.js";
import { isSelector, type SaveSelector, type Selector } from "./selectors.js";

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
  | { kind: "damage"; components: DamageComponent[]; scaling?: DamageScaling; healing?: boolean; target?: "self" | "target"; rollMode?: RollMode; onError?: ErrorPolicy }
  | { kind: "temphp"; formula: string; target?: "self" | "target"; onError?: ErrorPolicy }
  | { kind: "counter"; counter: string; amount: Expr; allowOverflow?: boolean; requireAvailable?: boolean; name?: string; onError?: ErrorPolicy }
  | { kind: "applyEffect"; effect: EffectTemplate; target?: "self" | "target"; linkGroup?: string; onError?: ErrorPolicy }
  | { kind: "removeEffect"; name: string; target?: "self" | "target"; cascade?: boolean; onError?: ErrorPolicy }
  | { kind: "target"; mode: "all" | "self" | "position"; index?: number; children: AutomationNode[]; onError?: ErrorPolicy }
  | { kind: "branch"; condition: Expr; onTrue: AutomationNode[]; onFalse: AutomationNode[]; onError?: ErrorPolicy };

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
  | { kind: "applyEffect"; target: MutationTarget; effect: EffectTemplate; linkGroup?: string }
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
  /** The seeded RNG — the ONLY randomness source, so the run is replayable. */
  rng: Rng;
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
  const execVars: Record<string, ExprValue> = {};
  // A working copy of the host's counter snapshot: spends within one run compound,
  // but the caller's objects are never mutated.
  const counters: Record<string, Counter> = {};
  for (const [id, c] of Object.entries(ctx.counters ?? {})) counters[id] = { ...c };
  const scope = (): ExprScope => ({ vars: { ...charScope.vars, ...execVars }, functions: charScope.functions });

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
            for (const c of node.components) {
              const r = rollNotation(c.formula, ctx.rng, vars);
              subtotal += r.total;
              instances.push({
                amount: r.total,
                ...(c.type !== undefined ? { type: c.type } : {}),
                ...(c.material !== undefined ? { material: c.material } : {}),
                ...(c.categories !== undefined ? { categories: c.categories } : {}),
                ...(c.label !== undefined ? { label: c.label } : {}),
              });
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
          outcome.mutations.push({
            kind: "applyEffect",
            target,
            effect: node.effect,
            ...(node.linkGroup !== undefined ? { linkGroup: node.linkGroup } : {}),
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
