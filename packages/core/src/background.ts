// PF2e backgrounds — third content entity in core.
//
// Consolidates the web builder's `Background` interface into Zod over ContentBase,
// with two corrections the real data forced: `trainedSkill` is OPTIONAL (some
// backgrounds, e.g. Blessed, train only a Lore) and `loreSkill` is optional (it can
// be a variable/GM-choice lore). A background's boosts are the restricted-choice +
// free pattern ([['str','dex'], 'free']). Any non-skill-feat grant (Blessed's innate
// spell) stays in `description` for v1.
//
// PURE: schema + adapter only. `coerceBackground` ingests a loose row into the shape.

import { z } from 'zod';
import { contentBaseSchema, boostSchema, slugify, RARITIES, type Rarity, type Source } from './content.js';
import { parseBoosts } from './ancestry.js';

export const backgroundSchema = z.object({
  ...contentBaseSchema.shape,
  boosts: z.array(boostSchema),
  /** The regular skill this background trains — optional (some train only a Lore). */
  trainedSkill: z.string().min(1).optional(),
  /** The Lore skill trained (subject text; may be variable/GM-choice). */
  loreSkill: z.string().min(1).optional(),
  /** Skill feat granted, if any (feat id/name). */
  skillFeat: z.string().min(1).optional(),
  description: z.string().min(1),
});
export type Background = z.infer<typeof backgroundSchema>;

// ── Generic parse helpers (private; hoist to content.ts in the shared cleanup) ──
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

// ── Adapter ──────────────────────────────────────────────────────────────────

export type CoerceBackgroundResult =
  | { ok: true; background: Background }
  | { ok: false; issues: string[] };

export function coerceBackground(raw: unknown): CoerceBackgroundResult {
  const rec = asRecord(raw);
  const name = firstStr(rec, 'name') ?? '';
  const allTraits = splitTraits(rec.traits);
  const { rarity: traitRarity, rest: traits } = extractRarity(allTraits);
  const rarity = (firstStr(rec, 'rarity')?.toLowerCase() as Rarity | undefined) ?? traitRarity;

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
    boosts: parseBoosts(rec.boosts),
    trainedSkill: firstStr(rec, 'trainedSkill', 'trained_skill'),
    loreSkill: firstStr(rec, 'loreSkill', 'lore_skill', 'lore'),
    skillFeat: firstStr(rec, 'skillFeat', 'skill_feat'),
    description: firstStr(rec, 'description', 'summary'),
  };

  const parsed = backgroundSchema.safeParse(draft);
  if (parsed.success) return { ok: true, background: parsed.data };
  return { ok: false, issues: parsed.error.issues.map((i) => `${i.path.length ? i.path.join('.') : '(root)'}: ${i.message}`) };
}
