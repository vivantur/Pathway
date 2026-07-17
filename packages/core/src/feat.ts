// PF2e feats — fourth content entity in core. DISPLAY/LOOKUP scope only.
//
// A feat carries its machine-readable effect data in `rules` as a DORMANT
// passthrough (the Foundry rule-element blob, exactly as the web already does).
// The feat slice deliberately does NOT model the canonical effect schema — that is
// the effect/automation engine's job (docs/effects-engine-design.md), which builds
// its own schema and maps Foundry at ingest. Doing display first unblocks that
// engine without foreclosing its schema decision.
//
// Consolidates the web builder's `Feat` interface and adds the fields it dropped:
// access, trigger, requirements, frequency.
//
// PURE: schema + adapter only. `coerceFeat` ingests a loose row into the shape.

import { z } from 'zod';
import { contentBaseSchema, slugify, RARITIES, type Rarity, type Source } from './content.js';
import { effectBearingShape } from './foundry.js';
import { actionCostSchema, parseActionCostText, type ActionCost } from './spell.js';

export const featTypeSchema = z.enum(['general', 'skill', 'ancestry', 'class', 'archetype']);
export type FeatType = z.infer<typeof featTypeSchema>;

export const featSchema = z.object({
  ...contentBaseSchema.shape,
  /** 1–20 for normal feats; some data stores level-0 feat-likes (e.g. deity boons). */
  level: z.number().int().min(0).max(20),
  featType: featTypeSchema.optional(),
  /** Reused from the spell schema — a feat's action cost is the same concept. */
  actionCost: actionCostSchema.optional(),
  prerequisites: z.string().min(1).optional(),
  /** Uncommon-content access requirement — distinct from prerequisites. */
  access: z.string().min(1).optional(),
  trigger: z.string().min(1).optional(),
  requirements: z.string().min(1).optional(),
  frequency: z.string().min(1).optional(),
  /** Class id(s) that can take this feat (builder filtering). */
  classIds: z.array(z.string()),
  /** Ancestry id for ancestry feats. */
  ancestryId: z.string().optional(),
  // A `rules: unknown[]` field used to live here — Foundry's rule-element array,
  // carried verbatim as "dormant feedstock" and interpreted at runtime by
  // collectSheetEffects. It is GONE: their shape is no longer a field on our
  // content. `effects` (ours, mapped at ingest) replaces it, and the raw elements
  // are quarantined in `ingest.raw` as opaque provenance nothing at runtime reads.
  ...effectBearingShape,
  description: z.string().min(1),
});
export type Feat = z.infer<typeof featSchema>;

// ── Generic parse helpers (private; 4th copy — hoist all to content.ts in a cleanup) ─
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

function parseFeatType(v: unknown): FeatType | undefined {
  const s = str(v)?.toLowerCase();
  return s && (['general', 'skill', 'ancestry', 'class', 'archetype'] as string[]).includes(s)
    ? (s as FeatType)
    : undefined;
}

function parseLevel(rec: Record<string, unknown>): number {
  const s = firstStr(rec, 'level');
  const n = s === undefined ? NaN : parseInt(s, 10);
  return Number.isNaN(n) ? NaN : n;
}

// ── Adapter ──────────────────────────────────────────────────────────────────

export type CoerceFeatResult = { ok: true; feat: Feat } | { ok: false; issues: string[] };

export function coerceFeat(raw: unknown): CoerceFeatResult {
  const rec = asRecord(raw);
  const name = firstStr(rec, 'name') ?? '';
  const allTraits = splitTraits(rec.traits);
  const { rarity: traitRarity, rest: traits } = extractRarity(allTraits);
  const rarity = (firstStr(rec, 'rarity')?.toLowerCase() as Rarity | undefined) ?? traitRarity;

  const actionCost =
    (rec.actionCost && typeof rec.actionCost === 'object' ? (rec.actionCost as ActionCost) : undefined) ??
    parseActionCostText(firstStr(rec, 'actionCost', 'actions', 'action_cost', 'action_type'));

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
    level: parseLevel(rec),
    featType: parseFeatType(firstStr(rec, 'featType', 'feat_type', 'type')),
    actionCost,
    prerequisites: firstStr(rec, 'prerequisites', 'prerequisite'),
    access: firstStr(rec, 'access'),
    trigger: firstStr(rec, 'trigger'),
    requirements: firstStr(rec, 'requirements', 'requirement'),
    frequency: firstStr(rec, 'frequency'),
    classIds: splitList(rec.classIds ?? rec.class_ids),
    ancestryId: firstStr(rec, 'ancestryId', 'ancestry_id'),
    // `rec.rules` (Foundry's shape) is deliberately NOT read: an ingested row's rule
    // elements are mapped to `effects` by the ingest, not carried onto the entity.
    ...(Array.isArray(rec.effects) ? { effects: rec.effects } : {}),
    description: firstStr(rec, 'description', 'summary'),
  };

  const parsed = featSchema.safeParse(draft);
  if (parsed.success) return { ok: true, feat: parsed.data };
  return { ok: false, issues: parsed.error.issues.map((i) => `${i.path.length ? i.path.join('.') : '(root)'}: ${i.message}`) };
}
