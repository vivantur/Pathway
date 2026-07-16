// Dice notation — a small parser + seeded evaluator for expressions like
// `2d6 + 3`, `1d8 - 1`, `(1d6 + strengthMod) * 2`. The `roll` automation node
// consumes it; it is the second Layer-2 slice and, like the interpreter skeleton,
// encodes NO PF2e rules — just generic dice arithmetic.
//
// GRAMMAR (recursive descent, normal precedence): `+ - * /`, parentheses, and
// unary minus, over three leaf kinds:
//   • number literals    — `3`, `0.5`
//   • dice terms         — `NdM` (`2d6`) or bare `dM` (`d20`, count 1)
//   • variable terms     — bare identifiers (`strengthMod`), resolved from a
//                          supplied numeric var bag; `{strengthMod}` braces are
//                          accepted and stripped (the design doc's brace convention)
//
// Division is the only source of fractions; the whole expression is evaluated in
// real arithmetic and the FINAL total is floored to an integer ("dice yield whole
// numbers"). PF2e's own round-down / halve-on-save / crit rules are NOT here — they
// belong to the damage/save nodes, applied to this integer total.
//
// DEFERRED (its own later slice, needs rules text): expression-valued dice COUNTS
// (`{level}d6`, dice that scale) — here a dice term's count and sides are integer
// literals. A variable may be an additive/arithmetic term, just not the die count.
//
// PURE + seeded: every die is rolled through the passed `Rng` (rng.ts), so a roll
// is replayable and unit-testable.

import type { Rng } from "./rng.js";

/** The parsed dice-expression AST. */
export type DiceExpr =
  | { kind: "num"; value: number }
  | { kind: "var"; name: string }
  | { kind: "dice"; count: number; sides: number }
  | { kind: "neg"; operand: DiceExpr }
  | { kind: "binary"; op: "+" | "-" | "*" | "/"; left: DiceExpr; right: DiceExpr };

/** One individual die that was rolled, for narration / later mechanics. */
export interface RolledDie {
  sides: number;
  result: number;
}

/** The outcome of rolling a dice expression: the integer total + every die rolled. */
export interface DiceRoll {
  total: number;
  dice: RolledDie[];
}

// --- tokenizer --------------------------------------------------------------

type Tok =
  | { t: "num"; v: number }
  | { t: "ident"; v: string }
  | { t: "op"; v: "+" | "-" | "*" | "/" }
  | { t: "lp" }
  | { t: "rp" };

function tokenize(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    // Whitespace and the optional {var} braces are delimiters.
    if (c === " " || c === "\t" || c === "{" || c === "}") {
      i += 1;
      continue;
    }
    if (c === "(") {
      toks.push({ t: "lp" });
      i += 1;
      continue;
    }
    if (c === ")") {
      toks.push({ t: "rp" });
      i += 1;
      continue;
    }
    if (c === "+" || c === "-" || c === "*" || c === "/") {
      toks.push({ t: "op", v: c });
      i += 1;
      continue;
    }
    let m = /^\d+(?:\.\d+)?/.exec(src.slice(i));
    if (m) {
      toks.push({ t: "num", v: Number(m[0]) });
      i += m[0].length;
      continue;
    }
    m = /^[a-zA-Z][a-zA-Z0-9]*/.exec(src.slice(i));
    if (m) {
      toks.push({ t: "ident", v: m[0] });
      i += m[0].length;
      continue;
    }
    throw new Error(`unexpected character "${c}" in dice "${src}"`);
  }
  return toks;
}

// A bare-or-suffixed die: the identifier part of `2d6` ("d6") or a lone `d20`.
const DIE_RE = /^d(\d+)$/;

/** Parse dice notation into a `DiceExpr` AST. Throws on malformed input. */
export function parseDice(notation: string): DiceExpr {
  const toks = tokenize(notation);
  let pos = 0;
  const peek = (): Tok | undefined => toks[pos];
  const next = (): Tok | undefined => toks[pos++];

  const parseAdd = (): DiceExpr => {
    let left = parseMul();
    for (let p = peek(); p && p.t === "op" && (p.v === "+" || p.v === "-"); p = peek()) {
      next();
      left = { kind: "binary", op: p.v, left, right: parseMul() };
    }
    return left;
  };
  const parseMul = (): DiceExpr => {
    let left = parseUnary();
    for (let p = peek(); p && p.t === "op" && (p.v === "*" || p.v === "/"); p = peek()) {
      next();
      left = { kind: "binary", op: p.v, left, right: parseUnary() };
    }
    return left;
  };
  const parseUnary = (): DiceExpr => {
    const p = peek();
    if (p && p.t === "op" && p.v === "-") {
      next();
      return { kind: "neg", operand: parseUnary() };
    }
    if (p && p.t === "op" && p.v === "+") {
      next(); // unary plus is a no-op
      return parseUnary();
    }
    return parsePrimary();
  };
  const parsePrimary = (): DiceExpr => {
    const tok = next();
    if (!tok) throw new Error(`unexpected end of dice "${notation}"`);
    if (tok.t === "lp") {
      const e = parseAdd();
      const close = next();
      if (!close || close.t !== "rp") throw new Error(`expected ) in dice "${notation}"`);
      return e;
    }
    if (tok.t === "num") {
      // A number immediately followed by a `dM` identifier is a dice term.
      const p = peek();
      if (p && p.t === "ident") {
        const m = DIE_RE.exec(p.v);
        if (m) {
          next();
          if (!Number.isInteger(tok.v)) throw new Error(`dice count must be a whole number in "${notation}"`);
          return dieTerm(tok.v, Number(m[1]), notation);
        }
      }
      return { kind: "num", value: tok.v };
    }
    if (tok.t === "ident") {
      const m = DIE_RE.exec(tok.v);
      if (m) return dieTerm(1, Number(m[1]), notation); // bare `d20`
      return { kind: "var", name: tok.v };
    }
    throw new Error(`unexpected token in dice "${notation}"`);
  };

  const expr = parseAdd();
  if (pos !== toks.length) throw new Error(`trailing tokens in dice "${notation}"`);
  return expr;
}

function dieTerm(count: number, sides: number, notation: string): DiceExpr {
  if (count < 0) throw new Error(`dice count must be non-negative in "${notation}"`);
  if (sides < 1) throw new Error(`a die must have at least 1 side in "${notation}"`);
  return { kind: "dice", count, sides };
}

/** Parse without throwing — for schema validation of an authored notation. */
export function safeParseDice(notation: string): DiceExpr | null {
  try {
    return parseDice(notation);
  } catch {
    return null;
  }
}

// --- evaluation -------------------------------------------------------------

function evalNode(node: DiceExpr, rng: Rng, vars: Record<string, number>, rolled: RolledDie[]): number {
  switch (node.kind) {
    case "num":
      return node.value;
    case "var": {
      const v = vars[node.name];
      if (typeof v !== "number") throw new Error(`unknown dice variable "${node.name}"`);
      return v;
    }
    case "dice": {
      let sum = 0;
      for (let i = 0; i < node.count; i++) {
        const result = rng.int(1, node.sides);
        rolled.push({ sides: node.sides, result });
        sum += result;
      }
      return sum;
    }
    case "neg":
      return -evalNode(node.operand, rng, vars, rolled);
    case "binary": {
      const l = evalNode(node.left, rng, vars, rolled);
      const r = evalNode(node.right, rng, vars, rolled);
      switch (node.op) {
        case "+":
          return l + r;
        case "-":
          return l - r;
        case "*":
          return l * r;
        case "/":
          return l / r;
      }
    }
  }
}

/** Roll a parsed dice expression with a seeded RNG, resolving any variable terms. */
export function rollDice(expr: DiceExpr, rng: Rng, vars: Record<string, number> = {}): DiceRoll {
  const dice: RolledDie[] = [];
  const raw = evalNode(expr, rng, vars, dice);
  return { total: Math.floor(raw), dice };
}

/** Parse then roll a dice-notation string — the string-input convenience path. */
export function rollNotation(notation: string, rng: Rng, vars: Record<string, number> = {}): DiceRoll {
  return rollDice(parseDice(notation), rng, vars);
}
