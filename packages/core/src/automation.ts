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
import { attackDamageMultiplier, basicSaveMultiplier, dcFromModifier, degreeOrdinal, rollCheck } from "./checks.js";
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
  | ({ kind: "attack"; bonus: Expr; onError?: ErrorPolicy } & DegreeChildren)
  | ({ kind: "check"; check: Selector; dc: Dc; onError?: ErrorPolicy } & DegreeChildren)
  | { kind: "damage"; components: DamageComponent[]; scaling?: DamageScaling; healing?: boolean; target?: "self" | "target"; onError?: ErrorPolicy }
  | { kind: "temphp"; formula: string; target?: "self" | "target"; onError?: ErrorPolicy }
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
    branchNodeSchema,
  ]),
);

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
export type Mutation =
  | { kind: "damage"; target: "self" | "target"; healing: boolean; amount: number; instances: DamageInstance[] }
  | { kind: "temphp"; target: "self" | "target"; amount: number };

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
   * The current target of a resolution node (`save`/`attack`/`check`). A single
   * target for now; multi-target scoping is the `target` node (slice 6), which
   * will re-scope this per iteration. A resolution needing a target with none set
   * fails through the error policy.
   */
  target?: ResolvedCharacter;
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

  const requireTarget = (): ResolvedCharacter => {
    if (!ctx.target) throw new Error("no target in context");
    return ctx.target;
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
  ): AutomationNode[] | undefined => {
    const result = rollCheck({ modifier, dc, rng: ctx.rng });
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
          children = resolve(node, "attack", modifier, resolveSelector(target, "ac"));
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
          children = resolve(node, "check", resolveSelector(ctx.actor, node.check), resolveDc(node.dc));
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
          const vars = numericVars();
          const instances: DamageInstance[] = [];
          let subtotal = 0;
          for (const c of node.components) {
            const rolled = rollNotation(c.formula, ctx.rng, vars);
            subtotal += rolled.total;
            instances.push({
              amount: rolled.total,
              ...(c.type !== undefined ? { type: c.type } : {}),
              ...(c.material !== undefined ? { material: c.material } : {}),
              ...(c.categories !== undefined ? { categories: c.categories } : {}),
              ...(c.label !== undefined ? { label: c.label } : {}),
            });
          }
          // Scale the TOTAL, then round down once (PF2e's round-once-at-the-end rule).
          const factor = node.scaling ? scalingFactor(node.scaling) : 1;
          const amount = Math.max(0, Math.floor(subtotal * factor));
          outcome.mutations.push({ kind: "damage", target: node.target ?? "target", healing: node.healing === true, amount, instances });
        } catch (e) {
          if (e instanceof Abort) throw e;
          applyPolicy(node.onError, "damage");
        }
        return;
      }
      case "temphp": {
        try {
          const amount = Math.max(0, rollNotation(node.formula, ctx.rng, numericVars()).total);
          outcome.mutations.push({ kind: "temphp", target: node.target ?? "self", amount });
        } catch (e) {
          if (e instanceof Abort) throw e;
          applyPolicy(node.onError, "temphp");
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
