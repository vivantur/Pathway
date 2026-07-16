// The expression language — a bounded, sandboxed evaluator for effect values.
//
// Effect values (a bonus, a DC, a scaling term, a boolean condition) are stored
// as a small AST (`Expr`) and evaluated against a `scope` that resolves variable
// names and a finite set of functions. This is the canonical `Value` form the
// design doc's decision #1 calls for: a "structured" builder emits a subset of
// this AST, so widening to a free-form expression mode later is additive and
// zero-migration.
//
// SECURITY: homebrew is user-submitted, so this is a security surface. There is
// NO `eval` and NO arbitrary code — only the enumerated pure functions below plus
// whatever scope-aware functions the host explicitly wires in (e.g. `rank`). An
// unknown variable or function throws (the host catches, per the error policy).
//
// It supersedes effects.ts's original single-purpose `evalNumeric` parser, which
// now delegates here so there is ONE expression implementation.

import { z } from "zod";

export type ExprValue = number | boolean | string;

/** The stored value AST. `lit` = constant, `var` = a namespace lookup, `call` = a function. */
export type Expr =
  | { kind: "lit"; value: ExprValue }
  | { kind: "var"; name: string }
  | { kind: "call"; fn: string; args: Expr[] };

/**
 * Zod schema for the value AST (recursive via `z.lazy`) — so any stored effect
 * whose value is an `Expr` (a Layer-1 modifier, a Layer-2 term) validates the
 * same shape this evaluator reads. This is the persisted `Value` form of the
 * design doc's decision #1.
 */
export const exprSchema: z.ZodType<Expr> = z.lazy(() =>
  z.union([
    z.object({ kind: z.literal("lit"), value: z.union([z.number(), z.boolean(), z.string()]) }).strict(),
    z.object({ kind: z.literal("var"), name: z.string().min(1) }).strict(),
    z.object({ kind: z.literal("call"), fn: z.string().min(1), args: z.array(exprSchema) }).strict(),
  ]),
);

/**
 * The evaluation environment. `vars` holds the merged namespaces (character
 * stats + execution state) as name→value; `functions` are host-provided,
 * scope-aware builtins (e.g. `rank(selector)`, later `target(...)`) kept separate
 * from the pure-math functions so the string surface stays contained.
 */
export interface ExprScope {
  vars?: Record<string, ExprValue>;
  functions?: Record<string, (args: ExprValue[]) => ExprValue>;
}

// --- value coercion ---------------------------------------------------------

function asNum(v: ExprValue): number {
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  throw new Error(`expected a number, got string ${JSON.stringify(v)}`);
}
function asBool(v: ExprValue): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  throw new Error(`expected a boolean, got string ${JSON.stringify(v)}`);
}

// --- the finite pure-function set (no I/O, no scope) -------------------------
// Comparisons return booleans; `ternary` and the logic ops treat a number as
// truthy when non-zero, so nested numeric expressions keep working.

const at = (a: ExprValue[], i: number): ExprValue => a[i] ?? 0;

const PURE_FUNCS: Record<string, (a: ExprValue[]) => ExprValue> = {
  ternary: (a) => (asBool(at(a, 0)) ? at(a, 1) : at(a, 2)),
  gte: (a) => asNum(at(a, 0)) >= asNum(at(a, 1)),
  gt: (a) => asNum(at(a, 0)) > asNum(at(a, 1)),
  lte: (a) => asNum(at(a, 0)) <= asNum(at(a, 1)),
  lt: (a) => asNum(at(a, 0)) < asNum(at(a, 1)),
  eq: (a) => asNum(at(a, 0)) === asNum(at(a, 1)),
  and: (a) => a.every((x) => asBool(x)),
  or: (a) => a.some((x) => asBool(x)),
  not: (a) => !asBool(at(a, 0)),
  min: (a) => Math.min(...a.map(asNum)),
  max: (a) => Math.max(...a.map(asNum)),
  floor: (a) => Math.floor(asNum(at(a, 0))),
  ceil: (a) => Math.ceil(asNum(at(a, 0))),
  int: (a) => Math.trunc(asNum(at(a, 0))),
  abs: (a) => Math.abs(asNum(at(a, 0))),
  add: (a) => a.reduce<number>((s, n) => s + asNum(n), 0),
  subtract: (a) => asNum(at(a, 0)) - asNum(at(a, 1)),
  multiply: (a) => a.reduce<number>((s, n) => s * asNum(n), 1),
};

/** The names of the pure functions, for editors / validation. */
export const EXPR_FUNCTIONS = Object.keys(PURE_FUNCS);

// --- evaluation -------------------------------------------------------------

function evalNode(expr: Expr, scope: ExprScope): ExprValue {
  switch (expr.kind) {
    case "lit":
      return expr.value;
    case "var": {
      const v = scope.vars?.[expr.name];
      if (v === undefined) throw new Error(`unknown variable "${expr.name}"`);
      return v;
    }
    case "call": {
      const args = expr.args.map((a) => evalNode(a, scope));
      const pure = PURE_FUNCS[expr.fn];
      if (pure) return pure(args);
      const scoped = scope.functions?.[expr.fn];
      if (scoped) return scoped(args);
      throw new Error(`unknown function "${expr.fn}"`);
    }
  }
}

/**
 * Evaluate an expression AST against a scope. `expected` coerces/validates the
 * result: `"number"` (booleans → 1/0), `"boolean"` (numbers → truthy), or
 * undefined (returned as-is).
 */
export function evaluate(
  expr: Expr,
  scope: ExprScope = {},
  expected?: "number" | "boolean",
): ExprValue {
  const val = evalNode(expr, scope);
  if (expected === "number") return asNum(val);
  if (expected === "boolean") return asBool(val);
  return val;
}

// --- string grammar → AST ---------------------------------------------------
//
// Parses the bounded, no-infix function-call grammar (numbers, quoted strings,
// `@actor.level`, bare identifiers as variables, and `fn(args)` calls) into an
// `Expr`. Foundry-ingest string values and any serialized value funnel through
// here into the same AST that a structured builder emits.

type Token =
  | { t: "num"; v: number }
  | { t: "str"; v: string }
  | { t: "ref"; name: string }
  | { t: "ident"; v: string }
  | { t: "punc"; v: "(" | ")" | "," };

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (c === " ") {
      i += 1;
      continue;
    }
    if (c === "(" || c === ")" || c === ",") {
      tokens.push({ t: "punc", v: c });
      i += 1;
      continue;
    }
    if (c === "@") {
      // Only `@actor.level` is supported; any other @-ref is rejected.
      const m = /^@actor\.level/.exec(src.slice(i));
      if (!m) throw new Error(`unsupported reference at "${src.slice(i)}"`);
      tokens.push({ t: "ref", name: "level" });
      i += m[0].length;
      continue;
    }
    if (c === '"' || c === "'") {
      const end = src.indexOf(c, i + 1);
      if (end === -1) throw new Error(`unterminated string in "${src}"`);
      tokens.push({ t: "str", v: src.slice(i + 1, end) });
      i = end + 1;
      continue;
    }
    let m = /^-?\d+(?:\.\d+)?/.exec(src.slice(i));
    if (m) {
      tokens.push({ t: "num", v: Number(m[0]) });
      i += m[0].length;
      continue;
    }
    m = /^[a-zA-Z][a-zA-Z0-9]*/.exec(src.slice(i));
    if (m) {
      tokens.push({ t: "ident", v: m[0] });
      i += m[0].length;
      continue;
    }
    throw new Error(`unexpected character "${c}" in "${src}"`);
  }
  return tokens;
}

/** Parse a bounded expression string into an `Expr` AST. Throws on invalid grammar. */
export function parseExpr(src: string): Expr {
  const tokens = tokenize(src.trim());
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];

  function parsePrimary(): Expr {
    const tok = next();
    if (!tok) throw new Error(`unexpected end of "${src}"`);
    if (tok.t === "num") return { kind: "lit", value: tok.v };
    if (tok.t === "str") return { kind: "lit", value: tok.v };
    if (tok.t === "ref") return { kind: "var", name: tok.name };
    if (tok.t === "ident") {
      const p = peek();
      if (p && p.t === "punc" && p.v === "(") {
        next(); // consume "("
        const args: Expr[] = [];
        let q = peek();
        if (q && !(q.t === "punc" && q.v === ")")) {
          args.push(parsePrimary());
          q = peek();
          while (q && q.t === "punc" && q.v === ",") {
            next();
            args.push(parsePrimary());
            q = peek();
          }
        }
        const close = next();
        if (!close || close.t !== "punc" || close.v !== ")") throw new Error(`expected ) closing ${tok.v}`);
        return { kind: "call", fn: tok.v, args };
      }
      return { kind: "var", name: tok.v };
    }
    throw new Error(`unexpected token in "${src}"`);
  }

  const expr = parsePrimary();
  if (pos !== tokens.length) throw new Error(`trailing tokens in "${src}"`);
  return expr;
}

/** Parse then evaluate a string expression — the string-input convenience path. */
export function evaluateString(
  src: string,
  scope: ExprScope = {},
  expected?: "number" | "boolean",
): ExprValue {
  return evaluate(parseExpr(src), scope, expected);
}
