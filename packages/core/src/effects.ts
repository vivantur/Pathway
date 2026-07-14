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
import { RANK_LABEL } from "./stats.js";

/** A Foundry rule element. Only the fields we read are typed; the rest is open. */
export interface RuleElement {
  key: string;
  [field: string]: unknown;
}

// ---------------------------------------------------------------------------
// PF2e bonus & penalty stacking
// ---------------------------------------------------------------------------
//
// Implemented verbatim from the Player Core "Bonuses and Penalties" rules
// (corroborated against Archive of Nethys "Bonuses"/"Penalties", ID 2281/2282):
//
//   Bonuses come in three types — circumstance, status, item. (There are no
//   untyped bonuses in the rules.) If you have more than one bonus of the same
//   type, you use only the HIGHEST. Bonuses of different types all add together.
//
//   Penalties come in the same three types plus UNTYPED. For each *typed*
//   penalty, if you have more than one of the same type you use only the WORST.
//   Penalties of different types all add together. Untyped penalties are the
//   exception: you always add ALL of them together rather than taking the worst.
//
// Data note: the Foundry corpus occasionally tags a *bonus* as "untyped" (which
// the rules say shouldn't exist). Such bonuses are authored to always apply, so
// we stack them — matching how the source system evaluates them.

export type BonusType = "circumstance" | "status" | "item" | "untyped";

export interface Modifier {
  type: BonusType;
  /** Positive = bonus, negative = penalty. Zero contributes nothing. */
  value: number;
}

/**
 * Net modifier from a set of typed bonuses/penalties, per the PF2e stacking
 * rules above. Bonuses and penalties are resolved independently and summed.
 */
export function stackModifiers(mods: Modifier[]): number {
  // Highest bonus per typed category; untyped bonuses all stack.
  const bestBonus: Record<string, number> = {};
  let untypedBonus = 0;
  // Worst (most negative) penalty per typed category; untyped penalties all stack.
  const worstPenalty: Record<string, number> = {};
  let untypedPenalty = 0;

  for (const m of mods) {
    if (!m || !Number.isFinite(m.value) || m.value === 0) continue;
    if (m.value > 0) {
      if (m.type === "untyped") untypedBonus += m.value;
      else bestBonus[m.type] = Math.max(bestBonus[m.type] ?? 0, m.value);
    } else {
      if (m.type === "untyped") untypedPenalty += m.value;
      else worstPenalty[m.type] = Math.min(worstPenalty[m.type] ?? 0, m.value);
    }
  }

  const sum = (o: Record<string, number>) => Object.values(o).reduce((s, n) => s + n, 0);
  return sum(bestBonus) + untypedBonus + sum(worstPenalty) + untypedPenalty;
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

/**
 * A single applied effect, attributed to its source, for "why did this change?"
 * display. `stat` is the affected stat key ("hp", "perception", a skill slug, …);
 * `summary` is a ready-to-show phrase ("+5 HP", "Trained in Thievery",
 * "+2 circumstance to Perception").
 */
export interface AppliedEffect {
  source: string;
  stat: string;
  summary: string;
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
   * Typed bonus/penalty modifiers to combine per stat, keyed by selector:
   * `ac`, `saving-throw`, `fortitude`/`reflex`/`will`, `perception`,
   * `skill-check`, an individual skill slug, or `land-speed`. The consumer
   * gathers the relevant selectors for a stat and runs them through
   * `stackModifiers`. (Raw lists — stacking is applied at use, once the stat's
   * own item bonuses are folded in, so item bonuses don't double-count.)
   */
  statModifiers: Map<string, Modifier[]>;
  /** Every applied effect, attributed to its source, for provenance display. */
  applied: AppliedEffect[];
  /**
   * Count of rule elements that would affect the sheet but fall outside this
   * increment's scope (choice-driven, unparseable value, strikes, ability/
   * proficiency-typed). Kept for reporting so silently-skipped effects are
   * visible, never hidden.
   */
  skipped: number;
}

// ---------------------------------------------------------------------------
// value expression evaluator
// ---------------------------------------------------------------------------
//
// The corpus expresses these effect values as either a number, an integer
// string, `@actor.level`, a fully-parenthesized function-call expression such
// as `ternary(gte(@actor.level,13),2,1)`, or one using infix arithmetic like
// `floor(@actor.level/2)` (resistance scaling). We parse both — function calls
// and the four infix operators `+ - * /` with the usual precedence — and
// evaluate; anything unrecognized throws (the caller then skips, never guesses).

type Token =
  | { t: "num"; v: number }
  | { t: "ref" }
  | { t: "ident"; v: string }
  | { t: "punc"; v: "(" | ")" | "," }
  | { t: "op"; v: "+" | "-" | "*" | "/" };

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
    if (c === "+" || c === "-" || c === "*" || c === "/") {
      tokens.push({ t: "op", v: c });
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
    // Bare (unsigned) numbers only; a leading `-` is the unary/binary operator.
    let m = /^\d+(?:\.\d+)?/.exec(src.slice(i));
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

  // expr := term (('+' | '-') term)*
  function parseExpr(): number {
    let acc = parseTerm();
    for (let p = peek(); p && p.t === "op" && (p.v === "+" || p.v === "-"); p = peek()) {
      next();
      const rhs = parseTerm();
      acc = p.v === "+" ? acc + rhs : acc - rhs;
    }
    return acc;
  }

  // term := unary (('*' | '/') unary)*
  function parseTerm(): number {
    let acc = parseUnary();
    for (let p = peek(); p && p.t === "op" && (p.v === "*" || p.v === "/"); p = peek()) {
      next();
      const rhs = parseUnary();
      acc = p.v === "*" ? acc * rhs : acc / rhs;
    }
    return acc;
  }

  // unary := '-' unary | primary
  function parseUnary(): number {
    const p = peek();
    if (p && p.t === "op" && p.v === "-") {
      next();
      return -parseUnary();
    }
    return parsePrimary();
  }

  // primary := num | ref | ident '(' args ')' | '(' expr ')'
  function parsePrimary(): number {
    const tok = next();
    if (!tok) throw new Error(`unexpected end of "${expr}"`);
    if (tok.t === "num") return tok.v;
    if (tok.t === "ref") return ctx.level;
    if (tok.t === "punc" && tok.v === "(") {
      const inner = parseExpr();
      const close = next();
      if (!close || close.t !== "punc" || close.v !== ")") throw new Error(`expected ) in "${expr}"`);
      return inner;
    }
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
// senses & resistances (ancestry / heritage traits)
// ---------------------------------------------------------------------------
//
// Ancestries and heritages grant special senses (darkvision, scent, …) and
// damage resistances via `Sense` / `Resistance` rule elements. Resistance values
// are commonly level-scaled expressions (`floor(@actor.level/2)`), evaluated with
// the same bounded grammar as ranks. Choice-driven resistance types (a
// `{item|…}` placeholder we don't yet resolve) are skipped and counted.

/** A special sense granted to the character (darkvision, scent, tremorsense, …). */
export interface GrantedSense {
  /** Sense selector, e.g. "darkvision", "low-light-vision", "scent", "wavesense". */
  type: string;
  /** Acuity, when the sense specifies one. */
  acuity?: "precise" | "imprecise";
  /** Range in feet, when the sense is limited. */
  range?: number;
  /** Attribution (the ancestry/heritage/feat that granted it). */
  source: string;
}

/** A damage resistance granted to the character, resolved at the character's level. */
export interface GrantedResistance {
  /** Damage type resisted, e.g. "cold", "fire", "poison". */
  type: string;
  /** Resistance amount at the character's level (always ≥ 1). */
  value: number;
  /** Attribution (the ancestry/heritage/feat that granted it). */
  source: string;
}

export interface CharacterTraits {
  senses: GrantedSense[];
  resistances: GrantedResistance[];
  /** Count of Sense/Resistance rules that couldn't be resolved (choice-driven, unparseable). */
  skipped: number;
}

/** How "strong" a sense acuity is, for deduping (precise beats imprecise beats none). */
const ACUITY_RANK: Record<string, number> = { precise: 2, imprecise: 1 };

/**
 * Resolve the special senses and damage resistances granted by a set of items'
 * rule arrays (an ancestry's, a heritage's, …). `labels[i]` attributes item `i`.
 * Senses dedupe by type keeping the more useful (precise > imprecise, then longer
 * range); resistances dedupe by type keeping the highest value.
 */
export function collectTraits(
  itemRules: RuleElement[][],
  ctx: EffectContext,
  labels: string[] = [],
): CharacterTraits {
  const senses = new Map<string, GrantedSense>();
  const resistances = new Map<string, GrantedResistance>();
  let skipped = 0;

  const senseBetter = (a: GrantedSense, b: GrantedSense): boolean => {
    const ra = ACUITY_RANK[a.acuity ?? ""] ?? 0;
    const rb = ACUITY_RANK[b.acuity ?? ""] ?? 0;
    if (ra !== rb) return ra > rb;
    // Unlimited range (undefined) beats any finite range; otherwise longer wins.
    if ((a.range ?? Infinity) !== (b.range ?? Infinity)) return (a.range ?? Infinity) > (b.range ?? Infinity);
    return false;
  };

  itemRules.forEach((rules, itemIndex) => {
    const source = labels[itemIndex] ?? "";
    if (!Array.isArray(rules)) return;
    for (const rule of rules) {
      if (!rule || typeof rule.key !== "string" || rule.ignored) continue;
      if (isConditional(rule)) continue; // situational senses/resistances are out of scope

      if (rule.key === "Sense") {
        const type = rule.selector;
        if (typeof type !== "string" || type.includes("{item")) {
          skipped += 1;
          continue;
        }
        const acuity = rule.acuity === "precise" || rule.acuity === "imprecise" ? rule.acuity : undefined;
        const range = typeof rule.range === "number" && rule.range > 0 ? rule.range : undefined;
        const next: GrantedSense = { type, source, ...(acuity ? { acuity } : {}), ...(range ? { range } : {}) };
        const cur = senses.get(type);
        if (!cur || senseBetter(next, cur)) senses.set(type, next);
        continue;
      }

      if (rule.key === "Resistance") {
        const type = rule.type;
        if (typeof type !== "string" || type.includes("{item")) {
          skipped += 1; // choice-driven resistance type — needs a stored selection
          continue;
        }
        let value: number;
        try {
          value = evalNumeric(rule.value, ctx);
        } catch {
          skipped += 1;
          continue;
        }
        value = Math.floor(value);
        if (value < 1) continue; // a resistance that rounds to 0 doesn't apply yet
        const cur = resistances.get(type);
        if (!cur || value > cur.value) resistances.set(type, { type, value, source });
        continue;
      }
    }
  });

  const byType = (a: { type: string }, b: { type: string }) => a.type.localeCompare(b.type);
  return {
    senses: [...senses.values()].sort(byType),
    resistances: [...resistances.values()].sort(byType),
    skipped,
  };
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

// The 16 PF2e skills (canonical rules content). A `skill-check` FlatModifier
// hits all of them; a skill-slug selector hits just one.
const SKILL_SLUGS = new Set([
  "acrobatics", "arcana", "athletics", "crafting", "deception", "diplomacy",
  "intimidation", "medicine", "nature", "occultism", "performance", "religion",
  "society", "stealth", "survival", "thievery",
]);

// FlatModifier selectors this increment applies to the static sheet.
const STAT_SELECTORS = new Set(["ac", "saving-throw", "fortitude", "reflex", "will", "perception", "skill-check", "land-speed"]);

/** Which stat-modifier bucket(s) a FlatModifier selector maps to, if any. */
function statBucketFor(selector: unknown): string | null {
  if (typeof selector !== "string") return null;
  if (STAT_SELECTORS.has(selector) || SKILL_SLUGS.has(selector)) return selector;
  return null;
}

const titleCase = (s: string): string => s.replace(/\b\w/g, (c) => c.toUpperCase());

/** Human label for a stat bucket, for provenance summaries. */
function statLabel(bucket: string): string {
  switch (bucket) {
    case "ac": return "AC";
    case "saving-throw": return "saves";
    case "fortitude": return "Fortitude";
    case "reflex": return "Reflex";
    case "will": return "Will";
    case "perception": return "Perception";
    case "skill-check": return "skill checks";
    case "land-speed": return "Speed";
    default: return titleCase(bucket); // a skill slug
  }
}

/** The stacking type for a modifier, or null if it's a base-calc type we skip. */
function modifierType(rawType: unknown): BonusType | null {
  if (rawType === "circumstance" || rawType === "status" || rawType === "item") return rawType;
  // Missing type or "untyped" → untyped. "ability"/"proficiency"/etc. are part of
  // the base statistic already (attribute mod + proficiency) — not stacked here.
  if (rawType == null || rawType === "untyped") return "untyped";
  return null;
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
 * `itemRules` is one rule-element array per chosen feat/feature; `labels[i]` is
 * the display name of item `i` (for the attributed `applied` list — pass the
 * feat/feature names). `choices[i]` maps a ChoiceSet flag name to the player's
 * stored selection for item `i` (e.g. `{ cannyAcumen: "system.saves.will.rank" }`
 * or `{ skillOne: "stealth" }`), used to resolve `{item|flags.system.
 * rulesSelections.<flag>}` placeholders in an ActiveEffectLike path. All three
 * trailing args are optional so existing callers/tests still work.
 */
export function collectSheetEffects(
  itemRules: RuleElement[][],
  ctx: EffectContext,
  labels: string[] = [],
  choices: Record<string, string>[] = [],
): SheetEffects {
  const effects: SheetEffects = {
    hpBonus: 0,
    skillRanks: new Map(),
    saveRanks: new Map(),
    perceptionRank: null,
    statModifiers: new Map(),
    applied: [],
    skipped: 0,
  };

  const raise = (map: Map<string, ProficiencyRank>, key: string, rank: ProficiencyRank) => {
    const cur = map.get(key) ?? 0;
    if (rank > cur) map.set(key, rank);
  };
  const addModifier = (bucket: string, mod: Modifier) => {
    const list = effects.statModifiers.get(bucket);
    if (list) list.push(mod);
    else effects.statModifiers.set(bucket, [mod]);
  };

  const CHOICE_PLACEHOLDER = /\{item\|flags\.system\.rulesSelections\.([^}]+)\}/g;

  itemRules.forEach((rules, itemIndex) => {
    const source = labels[itemIndex] ?? "";
    const itemChoices = choices[itemIndex] ?? {};
    const note = (stat: string, summary: string) => effects.applied.push({ source, stat, summary });
    if (!Array.isArray(rules)) return;
    for (const rule of rules) {
      if (!rule || typeof rule.key !== "string" || rule.ignored) continue;

      // --- HP: unconditional untyped FlatModifier on the hp selector ---
      if (rule.key === "FlatModifier" && rule.selector === "hp") {
        if (isConditional(rule) || (typeof rule.type === "string" && rule.type !== "untyped")) {
          effects.skipped += 1;
          continue;
        }
        try {
          const v = evalNumeric(rule.value, ctx);
          effects.hpBonus += v;
          if (v !== 0) note("hp", `${v >= 0 ? "+" : ""}${v} HP`);
        } catch {
          effects.skipped += 1;
        }
        continue;
      }

      // --- typed stat modifiers: unconditional FlatModifier on a sheet stat ---
      if (rule.key === "FlatModifier") {
        const bucket = statBucketFor(rule.selector);
        if (!bucket) {
          effects.skipped += 1; // strike-*, initiative, spell DCs, … — deferred
          continue;
        }
        const type = modifierType(rule.type);
        if (type === null || isConditional(rule)) {
          effects.skipped += 1; // ability/proficiency-typed or situational
          continue;
        }
        let value: number;
        try {
          value = evalNumeric(rule.value, ctx);
        } catch {
          effects.skipped += 1;
          continue;
        }
        if (value !== 0) {
          addModifier(bucket, { type, value });
          note(bucket, `${value >= 0 ? "+" : ""}${value} ${type} to ${statLabel(bucket)}`);
        }
        continue;
      }

      // --- proficiency rank: fixed-path ActiveEffectLike upgrade/override ---
      if (rule.key === "ActiveEffectLike" && typeof rule.path === "string") {
        let path = rule.path;
        // Resolve choice-driven paths (`{item|flags.system.rulesSelections.<flag>}`)
        // by substituting the player's stored selection for each flag. Skip the
        // rule entirely if any referenced flag has no stored choice yet.
        if (path.includes("{item")) {
          let missing = false;
          path = path.replace(CHOICE_PLACEHOLDER, (_m, flag: string) => {
            const sel = itemChoices[flag];
            if (typeof sel !== "string" || sel === "") {
              missing = true;
              return "";
            }
            return sel;
          });
          if (missing) {
            effects.skipped += 1;
            continue;
          }
        }
        if (!/\.rank$/.test(path)) continue;
        const mode = rule.mode;
        if (mode !== "upgrade" && mode !== "override") continue;
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
          note(skill[1], `${RANK_LABEL[rank]} in ${titleCase(skill[1])}`);
          continue;
        }
        const save = SAVE_RANK_PATH.exec(path);
        if (save?.[1]) {
          raise(effects.saveRanks, save[1], rank);
          note(save[1], `${RANK_LABEL[rank]} ${titleCase(save[1])}`);
          continue;
        }
        if (PERCEPTION_RANK_PATH.test(path)) {
          if (effects.perceptionRank === null || rank > effects.perceptionRank) effects.perceptionRank = rank;
          note("perception", `${RANK_LABEL[rank]} Perception`);
          continue;
        }
        // A rank path we don't map (e.g. spellcasting-entry ranks) — out of scope.
        effects.skipped += 1;
        continue;
      }

      // Anything else that would change the sheet but is deferred to a later
      // increment (speed/senses/resistances → the class-feature pass) is counted,
      // so deferred coverage stays visible. (FlatModifiers are fully handled above.)
      if (DEFERRED_SHEET_KINDS.has(rule.key)) {
        effects.skipped += 1;
      }
    }
  });

  return effects;
}
