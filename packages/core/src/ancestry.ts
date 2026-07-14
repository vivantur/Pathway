// PF2e ancestries + heritages — the second content entity in core.
//
// Consolidates the web's de-facto `Ancestry`/`Heritage` interfaces
// (apps/web/src/features/builder/data/schema.ts) into one canonical shape over
// the shared `ContentBase` envelope, and adds the two mechanics that interface
// dropped: `senses` (darkvision/low-light) and `specialAbilities` (Clan Dagger…).
//
// Heritages are their OWN entity (owner decision): each is a standalone row with
// an `ancestryId` (empty = a versatile heritage like Ardande/Nephilim), rather
// than nested inside the ancestry.
//
// PURE: schema + adapter only, no I/O. `coerceAncestry`/`coerceHeritage` ingest a
// loose row (web dataset / DB / AoN-derived) into the canonical shape.

import { z } from 'zod';
import {
  contentBaseSchema,
  abilitySchema,
  boostSchema,
  slugify,
  RARITIES,
  type Ability,
  type Boost,
  type Rarity,
  type Source,
} from './content.js';

// ── Schemas ──────────────────────────────────────────────────────────────────

export const SIZES = ['tiny', 'small', 'medium', 'large', 'huge', 'gargantuan'] as const;
export const sizeSchema = z.enum(SIZES);
export type Size = z.infer<typeof sizeSchema>;

/** A named ancestry ability that isn't a sense (e.g. Clan Dagger). */
export const specialAbilitySchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
});
export type SpecialAbility = z.infer<typeof specialAbilitySchema>;

export const ancestrySchema = z.object({
  ...contentBaseSchema.shape,
  hp: z.number().int().positive(),
  size: sizeSchema,
  speed: z.number().int().nonnegative(),
  boosts: z.array(boostSchema),
  flaws: z.array(abilitySchema),
  /** Languages always known (Common, Dwarven). */
  languages: z.array(z.string()),
  /** Fixed extra language choices beyond the universal Int-mod (Dwarf 0, Human 1). */
  bonusLanguages: z.number().int().nonnegative(),
  /** The explicit pool the bonus languages are chosen from. */
  bonusLanguageChoices: z.array(z.string()),
  /** Marker for a "any common language" pool (Human) rather than an explicit list. */
  anyCommonLanguage: z.boolean(),
  /** Darkvision, low-light vision, scent… free-text for now. */
  senses: z.array(z.string()),
  specialAbilities: z.array(specialAbilitySchema),
  description: z.string().min(1),
});
export type Ancestry = z.infer<typeof ancestrySchema>;

export const heritageSchema = z.object({
  ...contentBaseSchema.shape,
  /** The ancestry this heritage belongs to; '' for versatile heritages (Ardande…). */
  ancestryId: z.string(),
  versatile: z.boolean(),
  description: z.string().min(1),
});
export type Heritage = z.infer<typeof heritageSchema>;

// ── Generic parse helpers (private; a future cleanup can hoist these to content) ─

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
function str(v: unknown): string | undefined {
  if (typeof v === 'string') {
    const t = v.trim();
    return t.length ? t : undefined;
  }
  if (typeof v === 'number' && !Number.isNaN(v)) return String(v);
  return undefined;
}
function firstStr(rec: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const s = str(rec[k]);
    if (s !== undefined) return s;
  }
  return undefined;
}
function truthy(v: unknown): boolean {
  return v === true || v === 'true' || v === 1 || v === '1';
}
function splitList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
  const s = str(v);
  if (!s) return [];
  return s.split(/\s*[,\n]\s*/).map((x) => x.trim()).filter(Boolean);
}
function splitTraits(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
  const s = str(v);
  if (!s) return [];
  const parts = s.includes(',') ? s.split(',') : s.split(/\s+/);
  return parts.map((x) => x.trim()).filter(Boolean);
}
function extractRarity(traits: string[]): { rarity: Rarity; rest: string[] } {
  const idx = traits.findIndex((t) => (RARITIES as readonly string[]).includes(t.toLowerCase()));
  if (idx < 0) return { rarity: 'common', rest: traits };
  const rarity = (traits[idx] ?? '').toLowerCase() as Rarity;
  return { rarity, rest: [...traits.slice(0, idx), ...traits.slice(idx + 1)] };
}
function parseSource(input: unknown): Source | undefined {
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

// ── Ancestry-specific parsers (exported for direct unit testing) ─────────────

const ABILITY_ALIASES: Record<string, Ability> = {
  str: 'str', strength: 'str',
  dex: 'dex', dexterity: 'dex',
  con: 'con', constitution: 'con',
  int: 'int', intelligence: 'int',
  wis: 'wis', wisdom: 'wis',
  cha: 'cha', charisma: 'cha',
};

/** "Constitution" / "con" → 'con'. */
export function parseAbility(v: unknown): Ability | undefined {
  const s = str(v)?.toLowerCase();
  return s ? ABILITY_ALIASES[s] : undefined;
}

/** A boost slot: "Free" → 'free'; "Constitution" → 'con'; ["str","dex"] → restricted choice. */
export function parseBoost(v: unknown): Boost | undefined {
  if (Array.isArray(v)) {
    const abils = v.map(parseAbility).filter((a): a is Ability => a !== undefined);
    return abils.length >= 2 ? abils : abils[0];
  }
  const s = str(v);
  if (!s) return undefined;
  if (/^free$/i.test(s)) return 'free';
  return parseAbility(s);
}

export function parseBoosts(v: unknown): Boost[] {
  const arr = Array.isArray(v) ? v : v != null ? [v] : [];
  return arr.map(parseBoost).filter((b): b is Boost => b !== undefined);
}

export function parseSize(v: unknown): Size | undefined {
  const s = str(v)?.toLowerCase();
  return s && (SIZES as readonly string[]).includes(s) ? (s as Size) : undefined;
}

/** "25 feet" → 25; 25 → 25; unparseable → NaN. */
export function parseSpeed(v: unknown): number {
  if (typeof v === 'number') return v;
  const s = str(v);
  if (!s) return NaN;
  const m = s.match(/(\d+)/);
  return m ? Number(m[1]) : NaN;
}

function parseSpecialAbilities(v: unknown): SpecialAbility[] {
  if (!Array.isArray(v)) return [];
  const out: SpecialAbility[] = [];
  for (const raw of v) {
    const o = asRecord(raw);
    const name = str(o.name);
    const description = str(o.description);
    if (name && description) out.push({ name, description });
  }
  return out;
}

function parseHp(rec: Record<string, unknown>): number {
  const s = firstStr(rec, 'hp', 'hit_points', 'hitPoints');
  const n = s === undefined ? NaN : parseInt(s, 10);
  return Number.isNaN(n) ? NaN : n;
}

function parseIdentity(rec: Record<string, unknown>, name: string) {
  return {
    id: firstStr(rec, 'id') ?? slugify(name),
    version: typeof rec.version === 'number' ? rec.version : 1,
    ownerKind: (firstStr(rec, 'ownerKind') as unknown) ??
      (truthy(rec._homebrew) || truthy(rec.homebrew) ? 'homebrew' : 'official'),
    isLegacy: truthy(rec.isLegacy) || truthy(rec.legacy),
  };
}

// ── Adapters ─────────────────────────────────────────────────────────────────

export type CoerceAncestryResult =
  | { ok: true; ancestry: Ancestry }
  | { ok: false; issues: string[] };

export function coerceAncestry(raw: unknown): CoerceAncestryResult {
  const rec = asRecord(raw);
  const name = firstStr(rec, 'name') ?? '';
  const allTraits = splitTraits(rec.traits);
  const { rarity: traitRarity, rest: traits } = extractRarity(allTraits);
  const rarity = (firstStr(rec, 'rarity')?.toLowerCase() as Rarity | undefined) ?? traitRarity;

  const draft = {
    ...parseIdentity(rec, name),
    name,
    source: parseSource(firstStr(rec, 'source') ?? rec.source),
    rarity,
    traits,
    hp: parseHp(rec),
    size: parseSize(firstStr(rec, 'size')),
    speed: parseSpeed(rec.speed),
    boosts: parseBoosts(rec.boosts),
    flaws: splitList(rec.flaws).map(parseAbility).filter((a): a is Ability => a !== undefined),
    languages: splitList(rec.languages),
    bonusLanguages: typeof rec.bonusLanguages === 'number' ? rec.bonusLanguages : Number(firstStr(rec, 'bonusLanguages') ?? 0) || 0,
    bonusLanguageChoices: splitList(rec.bonusLanguageChoices),
    anyCommonLanguage: truthy(rec.anyCommonLanguage),
    senses: splitList(rec.senses),
    specialAbilities: parseSpecialAbilities(rec.specialAbilities),
    description: firstStr(rec, 'description', 'summary'),
  };

  const parsed = ancestrySchema.safeParse(draft);
  if (parsed.success) return { ok: true, ancestry: parsed.data };
  return { ok: false, issues: parsed.error.issues.map((i) => `${i.path.length ? i.path.join('.') : '(root)'}: ${i.message}`) };
}

export type CoerceHeritageResult =
  | { ok: true; heritage: Heritage }
  | { ok: false; issues: string[] };

export function coerceHeritage(raw: unknown): CoerceHeritageResult {
  const rec = asRecord(raw);
  const name = firstStr(rec, 'name') ?? '';
  const allTraits = splitTraits(rec.traits);
  const { rarity: traitRarity, rest: traits } = extractRarity(allTraits);
  const rarity = (firstStr(rec, 'rarity')?.toLowerCase() as Rarity | undefined) ?? traitRarity;

  const draft = {
    ...parseIdentity(rec, name),
    name,
    source: parseSource(firstStr(rec, 'source') ?? rec.source),
    rarity,
    traits,
    ancestryId: firstStr(rec, 'ancestryId', 'ancestry_id') ?? '',
    versatile: truthy(rec.versatile),
    description: firstStr(rec, 'description', 'summary'),
  };

  const parsed = heritageSchema.safeParse(draft);
  if (parsed.success) return { ok: true, heritage: parsed.data };
  return { ok: false, issues: parsed.error.issues.map((i) => `${i.path.length ? i.path.join('.') : '(root)'}: ${i.message}`) };
}
