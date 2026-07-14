// The PF2e spell — the first real content entity in core.
//
// This module owns TWO things and nothing else (no I/O, no rendering):
//   1. `spellSchema` — the ONE canonical shape of a spell. `Spell = z.infer<…>`.
//      Both apps/web (Rules Library, sheet) and apps/bot (/spell embed) will read
//      this shape, deleting the duplicated defensive readers in
//      apps/web/src/features/rules/api.ts and apps/bot/src/commands/spell/embed.js.
//   2. `coerceSpell(raw)` — the adapter that ingests today's messy inputs (a
//      Supabase `spells` row, or an AoN-import object) into a validated Spell.
//      Every defensive "which key holds the save / rank / action cost" decision
//      that used to live in two apps lives here once.
//
// SCOPE: data shape + display only. What a spell *does when cast* (degree-of-
// success mechanical effects, damage application) is a later "effect system"
// slice; `degreeOfSuccess` here is human-readable text, not executable rules.
//
// Raw statblock *text* parsing (the "Saving Throw FortitudeYou…" field/description
// fusion in copied AoN text) stays at the edge (importers) and calls coerceSpell;
// this module never touches raw text.

import { z } from 'zod';
import { contentBaseSchema, raritySchema, ownerKindSchema, sourceSchema, slugify, RARITIES, type Rarity, type Source } from './content.js';

// ── Unions ───────────────────────────────────────────────────────────────────

/**
 * Action cost. A union, not a scalar: spells like Heal cast with a *range* of
 * actions (min≠max), and some cast in time (rituals-adjacent), not actions.
 */
export const actionCostSchema = z
  .discriminatedUnion('kind', [
    z.object({
      kind: z.literal('actions'),
      min: z.number().int().min(1).max(3),
      max: z.number().int().min(1).max(3),
    }),
    z.object({ kind: z.literal('reaction') }),
    z.object({ kind: z.literal('free') }),
    z.object({ kind: z.literal('time'), text: z.string().min(1) }),
  ])
  .refine((a) => a.kind !== 'actions' || a.min <= a.max, {
    message: 'actionCost.min must be <= max',
  });
export type ActionCost = z.infer<typeof actionCostSchema>;

export const saveTypeSchema = z.enum(['fortitude', 'reflex', 'will']);
export type SaveType = z.infer<typeof saveTypeSchema>;

/**
 * Defense — save XOR attack, structurally. AoN's legacy "Saving Throw X" and
 * remaster "Defense X" / "Defense basic X" / "Defense AC" all normalize here.
 */
export const defenseSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('save'), save: saveTypeSchema, basic: z.boolean() }),
  z.object({ kind: z.literal('ac') }),
]);
export type Defense = z.infer<typeof defenseSchema>;

/**
 * A single heightening rule. `interval` = "Heightened (+N)"; `at-rank` =
 * "Heightened (3rd)". A future `by-level` variant (Kineticist-style, mostly a
 * class-feature concern) can join this union without a schema break.
 */
export const heightenEntrySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('interval'), step: z.number().int().min(1), effect: z.string().min(1) }),
  z.object({ kind: z.literal('at-rank'), rank: z.number().int().min(1).max(10), effect: z.string().min(1) }),
]);
export type HeightenEntry = z.infer<typeof heightenEntrySchema>;

/**
 * "Granted by" association — oracle mystery, sorcerer bloodline, cleric domain,
 * deities, witch lesson… Generic on purpose (a fixed column per kind would need
 * a schema change for every new one). `kind` is normalized to singular lowercase.
 */
export const associationSchema = z.object({
  kind: z.string().min(1),
  values: z.array(z.string().min(1)).min(1),
});
export type Association = z.infer<typeof associationSchema>;

/** Known association kinds, in the deterministic order coerceSpell emits them. */
export const ASSOCIATION_KINDS = ['mystery', 'bloodline', 'deity', 'domain', 'lesson', 'patron', 'curse'] as const;

export const degreeOfSuccessSchema = z.object({
  critSuccess: z.string().optional(),
  success: z.string().optional(),
  failure: z.string().optional(),
  critFailure: z.string().optional(),
});
export type DegreeOfSuccess = z.infer<typeof degreeOfSuccessSchema>;

export const spellTypeSchema = z.enum(['spell', 'cantrip', 'focus']);
export type SpellType = z.infer<typeof spellTypeSchema>;

// ── The spell schema ─────────────────────────────────────────────────────────

export const spellSchema = z.object({
  ...contentBaseSchema.shape,
  spellType: spellTypeSchema,
  /**
   * The spell's base (unheightened) rank. 1–10 for leveled spells; some data
   * sources store cantrips as rank 0 (their unheightened rank) while others use
   * 1 — both are accepted, and the display treats 0/cantrip as "Cantrip".
   */
  rank: z.number().int().min(0).max(10),
  /** May be empty — focus spells omit Traditions (the class grants them). */
  traditions: z.array(z.string()),
  /** Optional: a handful of entries (e.g. constant effects) carry no cast cost. */
  actionCost: actionCostSchema.optional(),
  /** somatic / verbal / material / focus — may be empty. */
  castComponents: z.array(z.string()),
  range: z.string().min(1).optional(),
  area: z.string().min(1).optional(),
  targets: z.string().min(1).optional(),
  duration: z.string().min(1).optional(),
  /**
   * The defenses a target resolves against — usually one, but empty for utility
   * spells and two for the real dual cases (attack roll AND a save, e.g.
   * Disintegrate; or a target's-choice "Reflex or Will"). The and/or combinator
   * lives in the description for now; the effect system formalizes it later.
   */
  defenses: z.array(defenseSchema),
  degreeOfSuccess: degreeOfSuccessSchema.optional(),
  heightening: z.array(heightenEntrySchema),
  associations: z.array(associationSchema),
  description: z.string().min(1),
});
export type Spell = z.infer<typeof spellSchema>;

// ── Pure parsing helpers (exported for direct unit testing) ──────────────────

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/** Trimmed non-empty string from string|number, else undefined. */
function str(v: unknown): string | undefined {
  if (typeof v === 'string') {
    const t = v.trim();
    return t.length ? t : undefined;
  }
  if (typeof v === 'number' && !Number.isNaN(v)) return String(v);
  return undefined;
}

/** First defined string among the given keys — the "which column?" resolver. */
function firstStr(rec: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const s = str(rec[k]);
    if (s !== undefined) return s;
  }
  return undefined;
}

/** Split a comma/newline list (or pass an array through), trimmed + de-blanked. */
export function splitCommaList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
  const s = str(v);
  if (!s) return [];
  return s.split(/\s*[,\n]\s*/).map((x) => x.trim()).filter(Boolean);
}

/**
 * Traits line → tokens. AoN writes them space-separated ("Uncommon Cantrip
 * Necromancy Negative"); a DB column may store a comma string or an array.
 */
export function splitTraits(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
  const s = str(v);
  if (!s) return [];
  const parts = s.includes(',') ? s.split(',') : s.split(/\s+/);
  return parts.map((x) => x.trim()).filter(Boolean);
}

/** Pull the rarity out of a trait list (default common), returning the rest verbatim. */
export function extractRarity(traits: string[]): { rarity: Rarity; rest: string[] } {
  const idx = traits.findIndex((t) => (RARITIES as readonly string[]).includes(t.toLowerCase()));
  if (idx < 0) return { rarity: 'common', rest: traits };
  const rarity = (traits[idx] ?? '').toLowerCase() as Rarity;
  return { rarity, rest: [...traits.slice(0, idx), ...traits.slice(idx + 1)] };
}

export function parseSpellType(rawType: string | undefined, traits: string[]): SpellType {
  const t = (rawType ?? '').toLowerCase();
  if (t.startsWith('cantrip')) return 'cantrip';
  if (t.startsWith('focus')) return 'focus';
  if (t === 'spell') return 'spell';
  const lower = traits.map((x) => x.toLowerCase());
  if (lower.includes('cantrip')) return 'cantrip';
  if (lower.includes('focus')) return 'focus';
  return 'spell';
}

const ACTION_WORD: Record<string, 1 | 2 | 3> = { one: 1, single: 1, two: 2, three: 3, '1': 1, '2': 2, '3': 3 };

/** "[two-actions]", "[one-action] to [three-actions]", "reaction", "10 minutes" → ActionCost. */
export function parseActionCostText(input: unknown): ActionCost | undefined {
  const raw = str(input);
  if (!raw) return undefined;
  const t = raw.toLowerCase();

  // Reaction / free first — "reaction" contains "action", so it must win before
  // we start counting actions (and before the strip step below eats it).
  if (/\breaction\b/.test(t)) return { kind: 'reaction' };
  if (/\bfree(?:[-\s]?action)?\b/.test(t)) return { kind: 'free' };

  // Time cast: "1 minute", "10 minutes", "1 hour", "1 round"
  const time = t.match(/\b(\d+)\s*(round|minute|hour|day|week)s?\b/);
  if (time) {
    const n = time[1];
    const unit = time[2] + (n === '1' ? '' : 's');
    return { kind: 'time', text: `${n} ${unit}` };
  }

  // Action counts. Strip brackets/parens and the word "action(s)" so all the
  // spellings collapse: "[two-actions]", "two actions", and the variable
  // "[one-action] to [three-actions]" / "one to three actions" all reduce to
  // their count words, and a " to " between two counts means a range (Heal).
  const cleaned = t
    .replace(/[[\]()]/g, ' ')
    .replace(/\bactions?\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const nums = (cleaned.match(/\b(one|two|three|single|1|2|3)\b/g) ?? [])
    .map((w) => ACTION_WORD[w])
    .filter((n): n is 1 | 2 | 3 => Boolean(n));
  const first = nums[0];
  if (first === undefined) return undefined;
  if (/\bto\b/.test(cleaned) && nums.length >= 2) {
    return { kind: 'actions', min: Math.min(...nums), max: Math.max(...nums) };
  }
  return { kind: 'actions', min: first, max: first };
}

const KNOWN_COMPONENTS = ['material', 'somatic', 'verbal', 'focus'] as const;

/** Extract cast components (somatic/verbal/…) from a Cast line or component string. */
export function parseCastComponents(input: unknown): string[] {
  if (Array.isArray(input)) return input.map((x) => String(x).trim()).filter(Boolean);
  const s = str(input);
  if (!s) return [];
  return KNOWN_COMPONENTS.filter((c) => new RegExp(`\\b${c}\\b`, 'i').test(s));
}

export function parseSaveType(input: unknown): SaveType | undefined {
  const s = str(input)?.toLowerCase();
  if (!s) return undefined;
  if (s.startsWith('fort')) return 'fortitude';
  if (s.startsWith('ref')) return 'reflex';
  if (s.startsWith('will')) return 'will';
  return undefined;
}

/** "AC" → attack; "basic Reflex" / "Fortitude" → save. undefined if unparseable. */
export function parseDefenseText(input: unknown): Defense | undefined {
  const s = str(input);
  if (!s) return undefined;
  if (/^ac$/i.test(s)) return { kind: 'ac' };
  const basic = /^basic\s+/i.test(s);
  const save = parseSaveType(s.replace(/^basic\s+/i, ''));
  if (save) return { kind: 'save', save, basic };
  return undefined;
}

function defenseEq(a: Defense, b: Defense): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'save' && b.kind === 'save') return a.save === b.save && a.basic === b.basic;
  return true;
}

/**
 * All defenses a spell targets. `isAttack` (from the "Attack" trait) contributes
 * an AC defense; the save string may add one or more saves — including the real
 * dual cases AoN writes as "AC and basic Fortitude" or "Reflex or Will (target's
 * choice)". Parenthetical/"see text" noise is dropped; unparseable → empty.
 */
export function parseDefenses(input: unknown, isAttack = false): Defense[] {
  const out: Defense[] = [];
  const push = (d: Defense | undefined) => {
    if (d && !out.some((x) => defenseEq(x, d))) out.push(d);
  };
  if (isAttack) push({ kind: 'ac' });
  const s = str(input);
  if (s) {
    const cleaned = s.replace(/\([^)]*\)/g, ' ').replace(/\bsee\s+(?:text|below)\b/gi, ' ');
    for (const tok of cleaned.split(/\band\b|\bor\b|[,/]/i)) push(parseDefenseText(tok));
  }
  return out;
}

/** Parse "Heightened (+N) …" / "Heightened (3rd) …" lines into entries. */
export function parseHeightening(input: unknown): HeightenEntry[] {
  // Already-structured entries: pass through (schema validates later).
  if (Array.isArray(input) && input.every((e) => e && typeof e === 'object' && 'kind' in (e as object))) {
    return input as HeightenEntry[];
  }
  const text = Array.isArray(input)
    ? input.map((x) => String(x)).join('\n')
    : str(input);
  if (!text) return [];

  const chunks = text.split(/(?=Heightened\s*\()/i).map((c) => c.trim()).filter(Boolean);
  const out: HeightenEntry[] = [];
  for (const chunk of chunks) {
    const interval = chunk.match(/^Heightened\s*\(\+(\d+)\)\s*([\s\S]*)$/i);
    if (interval) {
      const effect = (interval[2] ?? '').trim();
      if (effect) out.push({ kind: 'interval', step: Number(interval[1]), effect });
      continue;
    }
    const atRank = chunk.match(/^Heightened\s*\((\d+)(?:st|nd|rd|th)\)\s*([\s\S]*)$/i);
    if (atRank) {
      const effect = (atRank[2] ?? '').trim();
      if (effect) out.push({ kind: 'at-rank', rank: Number(atRank[1]), effect });
    }
  }
  return out;
}

const ASSOCIATION_ALIASES: Record<string, (typeof ASSOCIATION_KINDS)[number]> = {
  mystery: 'mystery', mysteries: 'mystery',
  bloodline: 'bloodline', bloodlines: 'bloodline',
  deity: 'deity', deities: 'deity',
  domain: 'domain', domains: 'domain',
  lesson: 'lesson', lessons: 'lesson',
  patron: 'patron', patrons: 'patron',
  curse: 'curse', curses: 'curse',
};

/** Gather association fields (mystery/bloodline/deity/domain/…) into one list. */
export function parseAssociations(rec: Record<string, unknown>): Association[] {
  const byKind = new Map<string, string[]>();
  const add = (rawKind: string, value: unknown) => {
    const kind = ASSOCIATION_ALIASES[rawKind.toLowerCase()] ?? rawKind.toLowerCase();
    const values = splitCommaList(value);
    if (!values.length) return;
    byKind.set(kind, [...(byKind.get(kind) ?? []), ...values]);
  };

  for (const [key, value] of Object.entries(rec)) {
    if (key.toLowerCase() in ASSOCIATION_ALIASES) add(key, value);
  }
  // Also accept a nested `associations` object map or array.
  const nested = rec.associations;
  if (Array.isArray(nested)) {
    for (const a of nested) {
      const o = asRecord(a);
      if (typeof o.kind === 'string') add(o.kind, o.values);
    }
  } else if (nested && typeof nested === 'object') {
    for (const [k, v] of Object.entries(nested as Record<string, unknown>)) add(k, v);
  }

  const orderOf = (k: string) => {
    const i = (ASSOCIATION_KINDS as readonly string[]).indexOf(k);
    return i < 0 ? ASSOCIATION_KINDS.length : i;
  };
  return [...byKind.entries()]
    .sort((a, b) => orderOf(a[0]) - orderOf(b[0]))
    .map(([kind, values]) => ({ kind, values }));
}

/** "Player Core pg. 328" → { title, page }. Accepts an already-structured object. */
export function parseSource(input: unknown): Source | undefined {
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    const o = input as Record<string, unknown>;
    const title = str(o.title);
    if (title) return { title, ...(typeof o.page === 'number' ? { page: o.page } : {}) };
  }
  const s = str(input);
  if (!s) return undefined;
  const m = s.match(/\bpg\.?\s*(\d+)\b/i);
  if (m) {
    const title = s.slice(0, m.index).replace(/[\s,;:]+$/, '').trim();
    return { title: title || s, page: Number(m[1]) };
  }
  return { title: s };
}

function parseDegreeOfSuccess(v: unknown): DegreeOfSuccess | undefined {
  const rec = asRecord(v);
  const dos: DegreeOfSuccess = {
    critSuccess: firstStr(rec, 'critSuccess', 'criticalSuccess', 'crit_success', 'critical_success'),
    success: firstStr(rec, 'success'),
    failure: firstStr(rec, 'failure'),
    critFailure: firstStr(rec, 'critFailure', 'criticalFailure', 'crit_failure', 'critical_failure'),
  };
  return Object.values(dos).some((x) => x !== undefined) ? dos : undefined;
}

function truthy(v: unknown): boolean {
  return v === true || v === 'true' || v === 1 || v === '1';
}

// ── The adapter ──────────────────────────────────────────────────────────────

export type CoerceResult =
  | { ok: true; spell: Spell }
  | { ok: false; issues: string[] };

/**
 * Ingest a loosely-typed spell (a Supabase row or an AoN-import object) into a
 * validated Spell, or return the reasons it failed. This is the single place the
 * "which key / which format" defensiveness lives — the seam packages/db calls on
 * write and read.
 */
export function coerceSpell(raw: unknown): CoerceResult {
  const rec = asRecord(raw);

  const name = firstStr(rec, 'name') ?? '';
  const allTraits = splitTraits(rec.traits);
  const { rarity: traitRarity, rest: traits } = extractRarity(allTraits);
  const rarity = (firstStr(rec, 'rarity')?.toLowerCase() as Rarity | undefined) ?? traitRarity;

  // Action cost + components: prefer explicit structured/typed fields, else parse
  // the AoN "Cast" line (which carries both the cost and the components).
  const actionCost =
    (rec.actionCost && typeof rec.actionCost === 'object'
      ? (rec.actionCost as ActionCost)
      : undefined) ??
    parseActionCostText(firstStr(rec, 'actionCost', 'actions', 'action_cost', 'cast'));
  const castComponents = rec.castComponents
    ? parseCastComponents(rec.castComponents)
    : parseCastComponents(firstStr(rec, 'cast', 'components'));

  // Defenses: the "Attack" trait contributes an AC defense; the save field
  // (legacy or remaster key) adds one or more saves — both may apply.
  const defenseText = firstStr(rec, 'defense', 'saving_throw', 'savingThrow', 'save');
  const defenses = parseDefenses(defenseText, truthy(rec.attack));

  const draft = {
    id: firstStr(rec, 'id') ?? slugify(name),
    version: typeof rec.version === 'number' ? rec.version : 1,
    name,
    ownerKind: (firstStr(rec, 'ownerKind') as unknown) ??
      (truthy(rec._homebrew) || truthy(rec.homebrew) ? 'homebrew' : 'official'),
    source: parseSource(firstStr(rec, 'source') ?? rec.source),
    rarity,
    traits,
    isLegacy: truthy(rec.isLegacy) || truthy(rec.legacy),
    spellType: parseSpellType(firstStr(rec, 'spellType', 'type'), allTraits),
    rank: parseRank(rec),
    traditions: splitCommaList(rec.traditions),
    actionCost,
    castComponents,
    range: firstStr(rec, 'range'),
    area: firstStr(rec, 'area'),
    targets: firstStr(rec, 'targets', 'target'),
    duration: firstStr(rec, 'duration'),
    defenses,
    degreeOfSuccess: parseDegreeOfSuccess(rec.degreeOfSuccess ?? rec.degrees_of_success),
    heightening: parseHeightening(rec.heightening ?? rec.heightened),
    associations: parseAssociations(rec),
    description: firstStr(rec, 'description', 'summary'),
  };

  const parsed = spellSchema.safeParse(draft);
  if (parsed.success) return { ok: true, spell: parsed.data };
  return {
    ok: false,
    issues: parsed.error.issues.map(
      (i) => `${i.path.length ? i.path.join('.') : '(root)'}: ${i.message}`,
    ),
  };
}

function parseRank(rec: Record<string, unknown>): number {
  const s = firstStr(rec, 'rank', 'level', 'spell_level');
  const n = s === undefined ? NaN : parseInt(s, 10);
  return Number.isNaN(n) ? NaN : n;
}

// Re-export a couple of primitives so consumers can `import { … } from '@pathway/core'`.
export { raritySchema, ownerKindSchema, sourceSchema };
