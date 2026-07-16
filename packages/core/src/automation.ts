// Layer 2 — the automation interpreter (skeleton slice).
//
// The automation engine is a TREE INTERPRETER, pure in core: it takes an ordered
// tree of typed nodes, an execution context (the acting character + a seeded RNG),
// and returns an OUTCOME — a narration `log` plus a list of intended `mutations`
// for the host app to apply. It never touches persistence, Discord, or the DB
// (docs/effects-engine-design.md, "Layer 2 — the automation engine").
//
// This is where the execution model was settled (slice 1) so every later node
// (attack/save/check, damage, counter, target, applyEffect) plugs into a stable
// contract. The nodes so far encode NO PF2e rules — pure plumbing + generic dice:
//   • text     — append narration.
//   • variable — evaluate an expression and BIND it to a name (forward-only scope).
//   • roll     — roll dice (dice.ts) with the seeded RNG, bind the total to
//                `lastRoll` (and an optional name), and log the dice. (slice 2)
//   • branch   — evaluate a boolean expression and run one of two child lists.
// Expressions are the shared evaluator (expr.ts), reading the character namespace
// (character.ts) merged with the execution-state vars this interpreter binds as it
// runs. Randomness is the seeded RNG (rng.ts) — no node here consumes it yet, but
// it is threaded from the start so the context seam stays stable for the dice slice.
//
// THE UNIFORM ERROR POLICY (the doc insists this is ONE model, not per-node
// bolt-ons): any node/expression that fails applies a `ErrorPolicy` — `ignore`
// (skip it), `warn` (skip + record a warning), `value` (substitute a fallback
// expression), or `raise` (abort the whole run gracefully, returning the partial
// outcome with `aborted: true`). "Treat a branch condition as true/false" is just
// a `value` fallback of a boolean literal — no branch-specific machinery needed.

import { z } from "zod";
import type { ResolvedCharacter } from "./character.js";
import { characterScope } from "./character.js";
import { rollNotation, safeParseDice, type RolledDie } from "./dice.js";
import { evaluate, exprSchema, type Expr, type ExprScope, type ExprValue } from "./expr.js";
import type { Rng } from "./rng.js";

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
// node vocabulary (this slice: text / variable / branch)
// ---------------------------------------------------------------------------

/**
 * One automation node. The union grows one entry per later slice; only the
 * rules-free nodes are here so the schema never claims to run what the
 * interpreter can't yet. `branch` makes the tree recursive.
 */
export type AutomationNode =
  | { kind: "text"; title?: string; body: string }
  | { kind: "variable"; name: string; value: Expr; onError?: ErrorPolicy }
  | { kind: "roll"; notation: string; name?: string; onError?: ErrorPolicy }
  | { kind: "branch"; condition: Expr; onTrue: AutomationNode[]; onFalse: AutomationNode[]; onError?: ErrorPolicy };

/** Zod schema for a node (recursive via `z.lazy`, since `branch` nests node lists). */
export const automationNodeSchema: z.ZodType<AutomationNode> = z.lazy(() =>
  z.discriminatedUnion("kind", [textNodeSchema, variableNodeSchema, rollNodeSchema, branchNodeSchema]),
);

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
  | { kind: "roll"; notation: string; total: number; dice: RolledDie[]; name?: string };

/**
 * An intended state change for the host app to apply. The union grows one kind
 * per later slice (damage, applyEffect, spendCounter, …); NO node produces one
 * yet, so this slice's outcome always has `mutations: []`. Represented as the
 * empty union (`never`) until the first producer lands.
 */
export type Mutation = never;

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
