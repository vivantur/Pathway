// Effects engine — turn the machine-readable rule elements carried on a
// character's chosen feats (ingested from the Foundry pf2e system) into the
// concrete sheet adjustments those feats grant.
//
// SCOPE (increment 1): the two static-sheet effects that need no bonus-stacking
// rules, so they can be applied with confidence today:
//   - HP bonuses      — unconditional `FlatModifier` on the `hp` selector. Every
//                       such modifier in the corpus is untyped, and untyped
//                       bonuses simply add, so we sum them. (Toughness → +level.)
//   - proficiency ups — fixed-path `ActiveEffectLike` "upgrade" of a skill / save
//                       / Perception rank. A rank is the highest you've been
//                       granted, so we take the max — exactly how the rest of the
//                       engine already treats proficiency.
//
// Deliberately NOT handled here (they require the PF2e bonus & penalty *stacking*
// rules, which must come from pasted rules text, or a player CHOICE we don't yet
// store): typed FlatModifiers on AC/saves/skills/strikes, and ChoiceSet-driven
// grants (paths containing `{item|…}` / values referencing a selection).
//
// The evaluator only understands the bounded expression grammar the corpus
// actually uses for these two effects; anything outside it (references to other
// proficiencies, choice selections, infix arithmetic) throws and the effect is
// skipped and counted, never guessed.

import type { ProficiencyRank } from "./proficiency.js";

/** A Foundry rule element. Only the fields we read are typed; the rest is open. */
export interface RuleElement {
  key: string;
  [field: string]: unknown;
}

export interface EffectContext {
  /** Character level — the only actor value the supported expressions reference. */
  level: number;
}

/** A proficiency-rank grant resolved from a feat. */
export interface RankGrant {
  kind: "skill" | "save" | "perception";
  /** Skill id ("athletics") or save id ("fortitude"); "perception" for Perception. */
  key: string;
  rank: ProficiencyRank;
}

export interface SheetEffects {
  /** Total flat HP bonus (summed untyped `hp` FlatModifiers). */
  hpBonus: number;
  /** Highest granted rank per skill id. */
  skillRanks: Map<string, ProficiencyRank>;
  /** Highest granted rank per save id (fortitude/reflex/will). */
  saveRanks: Map<string, ProficiencyRank>;
  /** Highest granted Perception rank, if any. */
  perceptionRank: ProficiencyRank | null;
  /**
   * Count of rule elements that would affect the sheet but fall outside this
   * increment's scope (typed modifiers, choice-driven, unparseable value). Kept
   * for reporting so silently-skipped effects are visible, never hidden.
   */
  skipped: number;
}

// ---------------------------------------------------------------------------
// value expression evaluator
// ---------------------------------------------------------------------------
//
// The corpus expresses these effect values as either a number, an integer
// string, `@actor.level`, or a fully-parenthesized function-call expression such
// as `ternary(gte(@actor.level,13),2,1)`. No infix operators appear. We parse
// that grammar and evaluate it; anything unrecognized throws (caller skips).

type Token = { t: "num"; v: number } | { t: "ref" } | { t: "ident"; v: string } | { t: "punc"; v: "(" | ")" | "," };

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
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
      tokens.push({ t: "ref" });
      i += m[0].length;
      continue;
    }
    let m = /^-?\d+(?:\.\d+)?/.exec(src.slice(i));
    if (m) {
      tokens.push({ t: "num", v: Number(m[0]) });
      i += m[0].length;
      continue;
    }
    m = /^[a-zA-Z]+/.exec(src.slice(i));
    if (m) {
      tokens.push({ t: "ident", v: m[0] });
      i += m[0].length;
      continue;
    }
    throw new Error(`unexpected character "${c}" in "${src}"`);
  }
  return tokens;
}

// Arity is guaranteed by the grammar at call time, but TS can't see that, so
// read positional args through a 0-defaulting accessor.
const g = (a: number[], i: number): number => a[i] ?? 0;

const FUNCS: Record<string, (a: number[]) => number> = {
  ternary: (a) => (g(a, 0) ? g(a, 1) : g(a, 2)),
  gte: (a) => (g(a, 0) >= g(a, 1) ? 1 : 0),
  gt: (a) => (g(a, 0) > g(a, 1) ? 1 : 0),
  lte: (a) => (g(a, 0) <= g(a, 1) ? 1 : 0),
  lt: (a) => (g(a, 0) < g(a, 1) ? 1 : 0),
  eq: (a) => (g(a, 0) === g(a, 1) ? 1 : 0),
  min: (a) => Math.min(...a),
  max: (a) => Math.max(...a),
  floor: (a) => Math.floor(g(a, 0)),
  ceil: (a) => Math.ceil(g(a, 0)),
  add: (a) => a.reduce((s, n) => s + n, 0),
  subtract: (a) => g(a, 0) - g(a, 1),
  multiply: (a) => a.reduce((s, n) => s * n, 1),
};

/** Evaluate a supported value expression to a number, or throw if unsupported. */
export function evalNumeric(expr: unknown, ctx: EffectContext): number {
  if (typeof expr === "number") return expr;
  if (typeof expr !== "string") throw new Error(`unsupported value ${JSON.stringify(expr)}`);
  const tokens = tokenize(expr.trim());
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];

  function parseExpr(): number {
    const tok = next();
    if (!tok) throw new Error(`unexpected end of "${expr}"`);
    if (tok.t === "num") return tok.v;
    if (tok.t === "ref") return ctx.level;
    if (tok.t === "ident") {
      const fn = FUNCS[tok.v];
      if (!fn) throw new Error(`unsupported function "${tok.v}"`);
      const open = next();
      if (!open || open.t !== "punc" || open.v !== "(") throw new Error(`expected ( after ${tok.v}`);
      const args: number[] = [];
      let p = peek();
      if (p && !(p.t === "punc" && p.v === ")")) {
        args.push(parseExpr());
        p = peek();
        while (p && p.t === "punc" && p.v === ",") {
          next();
          args.push(parseExpr());
          p = peek();
        }
      }
      const close = next();
      if (!close || close.t !== "punc" || close.v !== ")") throw new Error(`expected ) closing ${tok.v}`);
      return fn(args);
    }
    throw new Error(`unexpected token in "${expr}"`);
  }

  const result = parseExpr();
  if (pos !== tokens.length) throw new Error(`trailing tokens in "${expr}"`);
  return result;
}

// ---------------------------------------------------------------------------
// effect collection
// ---------------------------------------------------------------------------

/** A rule element is conditional (not always-on) if it carries a non-empty predicate. */
function isConditional(rule: RuleElement): boolean {
  const p = rule.predicate;
  return Array.isArray(p) && p.length > 0;
}

/** Clamp any evaluated rank into the 0–4 proficiency range. */
function toRank(n: number): ProficiencyRank | null {
  const r = Math.round(n);
  return r >= 0 && r <= 4 ? (r as ProficiencyRank) : null;
}

// Rule-element kinds that change the static sheet but are deferred to a later
// increment; counted toward `skipped` so deferred coverage is measurable.
const DEFERRED_SHEET_KINDS = new Set([
  "BaseSpeed",
  "Sense",
  "Resistance",
  "Weakness",
  "Immunity",
  "MartialProficiency",
  "CreatureSize",
  "DamageDice",
]);

const SKILL_RANK_PATH = /^system\.skills\.([a-z]+)\.rank$/;
const SAVE_RANK_PATH = /^system\.saves\.(fortitude|reflex|will)\.rank$/;
const PERCEPTION_RANK_PATH = /^system\.(?:attributes\.)?perception\.rank$/;

/**
 * Resolve every in-scope sheet effect from a set of chosen items' rule arrays.
 * `itemRules` is one rule-element array per chosen feat/feature.
 */
export function collectSheetEffects(itemRules: RuleElement[][], ctx: EffectContext): SheetEffects {
  const effects: SheetEffects = {
    hpBonus: 0,
    skillRanks: new Map(),
    saveRanks: new Map(),
    perceptionRank: null,
    skipped: 0,
  };

  const raise = (map: Map<string, ProficiencyRank>, key: string, rank: ProficiencyRank) => {
    const cur = map.get(key) ?? 0;
    if (rank > cur) map.set(key, rank);
  };

  for (const rules of itemRules) {
    if (!Array.isArray(rules)) continue;
    for (const rule of rules) {
      if (!rule || typeof rule.key !== "string" || rule.ignored) continue;

      // --- HP: unconditional untyped FlatModifier on the hp selector ---
      if (rule.key === "FlatModifier" && rule.selector === "hp") {
        if (isConditional(rule) || (typeof rule.type === "string" && rule.type !== "untyped")) {
          effects.skipped += 1;
          continue;
        }
        try {
          effects.hpBonus += evalNumeric(rule.value, ctx);
        } catch {
          effects.skipped += 1;
        }
        continue;
      }

      // --- proficiency rank: fixed-path ActiveEffectLike upgrade/override ---
      if (rule.key === "ActiveEffectLike" && typeof rule.path === "string") {
        const path = rule.path;
        if (!/\.rank$/.test(path)) continue;
        const mode = rule.mode;
        if (mode !== "upgrade" && mode !== "override") continue;
        // Choice-driven paths (`{item|…}`) need a stored selection we don't have yet.
        if (path.includes("{item")) {
          effects.skipped += 1;
          continue;
        }
        if (isConditional(rule)) {
          effects.skipped += 1;
          continue;
        }
        let value: number;
        try {
          value = evalNumeric(rule.value, ctx);
        } catch {
          effects.skipped += 1;
          continue;
        }
        const rank = toRank(value);
        if (rank === null) {
          effects.skipped += 1;
          continue;
        }
        const skill = SKILL_RANK_PATH.exec(path);
        if (skill?.[1]) {
          raise(effects.skillRanks, skill[1], rank);
          continue;
        }
        const save = SAVE_RANK_PATH.exec(path);
        if (save?.[1]) {
          raise(effects.saveRanks, save[1], rank);
          continue;
        }
        if (PERCEPTION_RANK_PATH.test(path)) {
          if (effects.perceptionRank === null || rank > effects.perceptionRank) effects.perceptionRank = rank;
          continue;
        }
        // A rank path we don't map (e.g. spellcasting-entry ranks) — out of scope.
        effects.skipped += 1;
        continue;
      }

      // Anything else that would change the sheet but is deferred to a later
      // increment (typed stat modifiers → stacking rules; speed/senses/resistances
      // → the class-feature pass) is counted, so deferred coverage stays visible.
      if (
        rule.key === "FlatModifier" || // non-hp selectors (ac, saves, skills, strikes, …)
        DEFERRED_SHEET_KINDS.has(rule.key)
      ) {
        effects.skipped += 1;
      }
    }
  }

  return effects;
}
