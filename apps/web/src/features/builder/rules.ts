import {
  ABILITY_KEYS,
  findAncestry,
  findBackground,
  findClass,
  findFeat,
  findHeritage,
  findItem,
  getDataset,
  type AbilityKey,
  type Armor,
  type Boost,
  type Feat,
  type ProficiencyRank,
  type Shield,
  type Weapon,
} from '@/features/builder/data';
import { OPT } from '@/features/builder/options/config';
import {
  abilityModifier,
  armorClass,
  attackRankAtLevel,
  collectPassiveSheetEffects,
  collectTraits,
  isSkillSlug,
  maxHitPoints,
  proficiencyBonus,
  proficientDC,
  proficientModifier,
  proficiencyRankAtLevel,
  RANK_LABEL,
  resolveChoiceEffects,
  stackModifiers,
  type EffectChoice,
  type ConditionalModifier,
  type EffectProvenance,
  type AttackCategory,
  type CharacterTraits,
  type GrantedSense,
  type Modifier,
  type PassiveEffect,
  type ProficiencyTrack,
  type ResolvedCharacter,
  type SheetEffects,
  type SkillStat,
} from '@pathway/core';

// Scalar stat math lives in @pathway/core (one source for builder, sheet, and
// eventually the bot). Re-exported so existing `from './rules'` imports work.
export { abilityModifier, proficiencyBonus, RANK_LABEL };
import {
  doctrineAttackRank,
  doctrineTrackRank,
  focusPoints,
  monkPathSaveRank,
  subclassArmorRank,
  subclassGrantedSkillIds,
  subclassSkillGrant,
} from './subclassEffects';
import type { BuilderState } from './types';

export type AbilityScores = Record<AbilityKey, number>;

/** Read a character option (defaults to off). */
export function opt(state: BuilderState, id: string): boolean {
  return state.options?.[id] ?? false;
}

// PF2e character-advancement table (generic across the Player Core classes).
// Level 1's class feat + ancestry feat + skill feat live in the creation steps.
const CLASS_FEAT_LEVELS = [1, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20];
const ANCESTRY_FEAT_LEVELS = [1, 5, 9, 13, 17];
// Ancestry Paragon ADDS bonus ancestry feats (1, 3, 7, 11, 15, 19) ON TOP of the
// normal schedule (1, 5, 9, 13, 17) — so an ancestry feat lands at every odd
// level. Their union (below) drives the Advancement step for levels 2+. Level 1
// grants TWO ancestry feats: the normal creation feat plus a paragon bonus,
// which is stored separately (`ancestryParagonFeatId`) and picked in the Feats
// step, since the boolean-per-level slot model can't represent two at once.
const ANCESTRY_PARAGON_LEVELS = [1, 3, 5, 7, 9, 11, 13, 15, 17, 19];
const SKILL_FEAT_LEVELS = [2, 4, 6, 8, 10, 12, 14, 16, 18, 20];
const GENERAL_FEAT_LEVELS = [3, 7, 11, 15, 19];
const SKILL_INCREASE_LEVELS = [3, 5, 7, 9, 11, 13, 15, 17, 19];
const BOOST_LEVELS = [5, 10, 15, 20];
const GRADUAL_BOOST_LEVELS = [2, 3, 4, 5, 7, 8, 9, 10, 12, 13, 14, 15, 17, 18, 19, 20];

export interface LevelSlots {
  classFeat: boolean;
  ancestryFeat: boolean;
  skillFeat: boolean;
  generalFeat: boolean;
  archetypeFeat: boolean;
  skillIncrease: boolean;
  /** How many ability boosts this level grants (0 if none). */
  boostCount: number;
}

/**
 * What a character gains at a given level, honoring the character's variant-rule
 * options (Ancestry Paragon, Free Archetype, Gradual Ability Boosts).
 */
export function gainsForLevel(level: number, options?: Record<string, boolean>): LevelSlots {
  const paragon = options?.[OPT.ancestryParagon] ?? false;
  const freeArchetype = options?.[OPT.freeArchetype] ?? false;
  const gradual = options?.[OPT.gradualAbilityBoosts] ?? false;

  const ancestryLevels = paragon ? ANCESTRY_PARAGON_LEVELS : ANCESTRY_FEAT_LEVELS;
  const boostCount = gradual
    ? GRADUAL_BOOST_LEVELS.includes(level)
      ? 1
      : 0
    : BOOST_LEVELS.includes(level)
      ? 4
      : 0;

  return {
    classFeat: CLASS_FEAT_LEVELS.includes(level),
    ancestryFeat: ancestryLevels.includes(level),
    skillFeat: SKILL_FEAT_LEVELS.includes(level),
    generalFeat: GENERAL_FEAT_LEVELS.includes(level),
    archetypeFeat: freeArchetype && level >= 2 && level % 2 === 0,
    skillIncrease: SKILL_INCREASE_LEVELS.includes(level),
    boostCount,
  };
}

/** Highest proficiency rank a skill may reach at a given character level. */
function maxRankForLevel(level: number): ProficiencyRank {
  if (level >= 15) return 4;
  if (level >= 7) return 3;
  if (level >= 3) return 2;
  return 1;
}

interface Applied {
  ability: AbilityKey;
  kind: 'boost' | 'flaw';
}

/** Apply a boost/flaw in order, honoring the "+1 instead of +2 above 18" rule. */
function applyAll(applied: Applied[]): AbilityScores {
  const scores: AbilityScores = { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 };
  for (const a of applied) {
    if (a.kind === 'flaw') {
      scores[a.ability] -= 2;
    } else {
      scores[a.ability] += scores[a.ability] >= 18 ? 1 : 2;
    }
  }
  return scores;
}

/** Which ancestry/background boost slots require a player choice (free or restricted set). */
export function choiceSlots(boosts: Boost[]): { index: number; options: AbilityKey[] }[] {
  const slots: { index: number; options: AbilityKey[] }[] = [];
  boosts.forEach((b, index) => {
    if (b === 'free') slots.push({ index, options: [...ABILITY_KEYS] });
    else if (Array.isArray(b)) slots.push({ index, options: b });
  });
  return slots;
}

/** Resolve a boost slot to a concrete ability given the player's choices for that source. */
function resolveBoosts(boosts: Boost[], choices: (AbilityKey | null)[]): (AbilityKey | null)[] {
  let choiceIdx = 0;
  return boosts.map((b) => {
    if (b === 'free' || Array.isArray(b)) {
      const chosen = choices[choiceIdx] ?? null;
      choiceIdx += 1;
      return chosen;
    }
    return b;
  });
}

/**
 * Ability scores from character-CREATION choices only (ancestry, background,
 * class key ability, and the four free boosts) — i.e. the level-1 array before
 * any level-up ability boosts. Things fixed at level 1, like the number of
 * Intelligence-granted trained skills, must read from here, not the current
 * (post-level-up) scores.
 */
function creationAbilityScores(state: BuilderState): AbilityScores {
  const applied: Applied[] = [];
  const ancestry = state.ancestryId ? findAncestry(state.ancestryId) : undefined;
  const background = state.backgroundId ? findBackground(state.backgroundId) : undefined;
  const klass = state.classId ? findClass(state.classId) : undefined;

  // Flaws first (order only matters near 18; this is the conventional order).
  if (ancestry) for (const f of ancestry.flaws) applied.push({ ability: f, kind: 'flaw' });

  if (ancestry)
    for (const a of resolveBoosts(ancestry.boosts, state.ancestryBoostChoices))
      if (a) applied.push({ ability: a, kind: 'boost' });

  if (background)
    for (const a of resolveBoosts(background.boosts, state.backgroundBoostChoices))
      if (a) applied.push({ ability: a, kind: 'boost' });

  if (klass && state.keyAbility) applied.push({ ability: state.keyAbility, kind: 'boost' });

  for (const a of state.freeBoosts) if (a) applied.push({ ability: a, kind: 'boost' });

  return applyAll(applied);
}

export function computeAbilityScores(state: BuilderState): AbilityScores {
  const scores = creationAbilityScores(state);

  // Apply level-up ability boosts (levels 5/10/15/20, or the Gradual cadence)
  // in ascending level order so the "+1 instead of +2 above 18" rule is
  // deterministic. Only count a level's stored boosts if the CURRENT variant
  // options actually grant a boost there, and only as many as granted —
  // otherwise choices left over from a previous option config (e.g. 4 boosts
  // assigned at L5, then Gradual Ability Boosts enabled, which makes L5 grant
  // just 1) would silently inflate the scores.
  const levels = Object.keys(state.progression)
    .map(Number)
    .filter((lvl) => lvl <= (state.level || 1))
    .sort((a, b) => a - b);
  for (const lvl of levels) {
    const grant = gainsForLevel(lvl, state.options).boostCount;
    if (grant <= 0) continue;
    for (const a of (state.progression[lvl]?.boosts ?? []).slice(0, grant)) {
      if (a) scores[a] += scores[a] >= 18 ? 1 : 2;
    }
  }

  return scores;
}

/**
 * The ability modifiers a collect-time value expression may read (`strengthMod`, …).
 * These are base inputs — known before the passive effects are derived — so exposing them
 * to `collectPassiveSheetEffects`/`collectTraits` is not circular.
 */
function abilityModsFor(state: BuilderState): { str: number; dex: number; con: number; int: number; wis: number; cha: number } {
  const s = computeAbilityScores(state);
  return {
    str: abilityModifier(s.str), dex: abilityModifier(s.dex), con: abilityModifier(s.con),
    int: abilityModifier(s.int), wis: abilityModifier(s.wis), cha: abilityModifier(s.cha),
  };
}

/**
 * Sheet effects granted by the character's chosen feats — HP bonuses, proficiency
 * grants and typed stat modifiers, resolved by `@pathway/core`.
 *
 * These are OUR `PassiveEffect`s, mapped from Foundry's rule elements AT INGEST
 * (scripts/remap-effects.mjs → core's foundry.ts). This app no longer reads Foundry's
 * shape at runtime, which is the whole point: their schema is import feedstock, not
 * our contract. Recomputed on demand; the collection is cheap.
 */
export function characterEffects(state: BuilderState): SheetEffects {
  const level = state.level || 1;
  const itemEffects: PassiveEffect[][] = [];
  const labels: string[] = [];
  for (const id of chosenFeatIds(state)) {
    const feat = findFeat(id);
    if (!feat) continue;
    // A feat's unconditional effects, plus whatever its player choices resolve to.
    // The choice's OPTIONS and their effects were fixed at ingest; only the pick is
    // the player's, so this is a lookup, not an interpretation.
    const effects = [
      ...((feat.effects ?? []) as PassiveEffect[]),
      ...resolveChoiceEffects(feat.choices as EffectChoice[] | undefined, featChoicesFor(state, id)),
    ];
    if (!effects.length) continue;
    itemEffects.push(effects);
    labels.push(feat.name);
  }
  return collectPassiveSheetEffects(itemEffects, { level, abilityMods: abilityModsFor(state) }, labels);
}

// --- choice-driven feats: player prompts ------------------------------------
//
// Some feats don't know their own effect until the player picks something (Canny
// Acumen's save, Skill Training's skill). The OPTIONS and what each one grants are
// content, resolved at ingest into `feat.choices` by scripts/remap-effects.mjs. This
// app only stores the pick and looks it up — it does not interpret a rule element.
//
// This replaced a runtime interpreter that read Foundry's ChoiceSet/ActiveEffectLike
// and substituted `{item|flags.system.rulesSelections.<flag>}` into their paths on
// every derive. That mechanism is gone with the rest of the Foundry-at-runtime read.

/**
 * The player's stored picks for a feat, normalized.
 *
 * BACK-COMPAT: choices used to be stored as Foundry's own rank path
 * (`system.saves.will.rank`) because the option values came straight from their
 * ChoiceSet. Options are now keyed by OUR selector (`will`), so a character saved
 * before this migration would silently lose its choice — a feat quietly ceasing to
 * grant is exactly the kind of failure nobody notices. Old values are translated on
 * read; nothing needs migrating, and new saves are written in our vocabulary.
 */
const LEGACY_RANK_PATH = /^system\.(?:skills|saves)\.([a-z]+)\.rank$|^system\.(?:attributes\.)?(perception)\.rank$/;

export function featChoicesFor(state: BuilderState, featId: string): Record<string, string> {
  const stored = state.featChoices?.[featId];
  if (!stored) return {};
  const out: Record<string, string> = {};
  for (const [flag, value] of Object.entries(stored)) {
    const m = LEGACY_RANK_PATH.exec(value);
    out[flag] = m ? (m[1] ?? m[2] ?? value) : value;
  }
  return out;
}

/** The prompts a feat needs from the player, in order. Empty when it needs none. */
export function featChoicePrompts(feat: Feat | undefined): EffectChoice[] {
  return (feat?.choices as EffectChoice[] | undefined) ?? [];
}

/** Skill ids trained by a resolved feat choice — used by the Skills step. */
export function featChosenSkillIds(state: BuilderState): string[] {
  const out: string[] = [];
  for (const id of chosenFeatIds(state)) {
    const feat = findFeat(id);
    if (!feat) continue;
    for (const effect of resolveChoiceEffects(feat.choices as EffectChoice[] | undefined, featChoicesFor(state, id))) {
      if (effect.kind === 'proficiency' && isSkillSlug(effect.target)) out.push(effect.target);
    }
  }
  return out;
}

/** Every chosen feat that still needs one or more player choices, with prompts. */
export function pendingFeatChoices(state: BuilderState): { feat: Feat; prompts: EffectChoice[] }[] {
  const out: { feat: Feat; prompts: EffectChoice[] }[] = [];
  for (const id of chosenFeatIds(state)) {
    const feat = findFeat(id);
    if (!feat) continue;
    const prompts = featChoicePrompts(feat);
    if (prompts.length) out.push({ feat, prompts });
  }
  return out;
}

// --- ancestry / heritage traits: senses & resistances -----------------------

/**
 * Special senses and damage resistances the character's ancestry and heritage
 * grant, resolved (and level-scaled) by `@pathway/core`. The ancestry's base
 * vision is modeled as a sense so it dedupes/upgrades against heritage senses.
 */
export function characterTraits(state: BuilderState): CharacterTraits {
  const level = state.level || 1;
  const ancestry = state.ancestryId ? findAncestry(state.ancestryId) : undefined;
  const heritage = findHeritage(state.ancestryId, state.heritageId);
  const itemEffects: PassiveEffect[][] = [];
  const labels: string[] = [];

  if (ancestry?.vision && ancestry.vision !== 'normal') {
    // The ancestry's base vision is a plain field on our schema, not an ingested
    // effect. Expressing it as a sense GRANT lets it dedupe and upgrade against the
    // heritage's senses through the same path as everything else.
    itemEffects.push([{ kind: 'grant', grant: { type: 'sense', name: ancestry.vision } }]);
    labels.push(ancestry.name);
  }
  if (ancestry && Array.isArray(ancestry.effects)) {
    itemEffects.push(ancestry.effects as PassiveEffect[]);
    labels.push(ancestry.name);
  }
  if (heritage && Array.isArray(heritage.effects)) {
    itemEffects.push(heritage.effects as PassiveEffect[]);
    labels.push(heritage.name);
  }

  // Sense dedupe (including darkvision superseding low-light vision) is core's, so
  // this and the imported-character sheet cannot drift apart on it.
  return collectTraits(itemEffects, { level, abilityMods: abilityModsFor(state) }, labels);
}

/** Human-readable label for a granted sense, e.g. "Scent (imprecise, 30 ft)". */
export function formatSenseLabel(sense: GrantedSense): string {
  const name = sense.type
    .split('-')
    .map((w) => (w ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join('-');
  const parts: string[] = [];
  if (sense.acuity) parts.push(sense.acuity);
  if (sense.range) parts.push(`${sense.range} ft`);
  return parts.length ? `${name} (${parts.join(', ')})` : name;
}

/** Final proficiency rank of every skill, factoring in per-level skill increases. */
export function skillRankMap(state: BuilderState): Map<string, ProficiencyRank> {
  const level = state.level || 1;
  const trained = trainedSkillIds(state);
  const ranks = new Map<string, ProficiencyRank>();
  for (const s of getDataset().skills) ranks.set(s.id, trained.has(s.id) ? 1 : 0);
  // Trained Lore subjects (background + chosen) start at trained; per-level
  // increases below can raise them like any other skill.
  for (const subject of trainedLoreSubjects(state)) ranks.set(loreId(subject), 1);

  for (const [lvlStr, gains] of Object.entries(state.progression)) {
    if (Number(lvlStr) > level) continue;
    for (const id of gains.skillIncreases) {
      const current = ranks.get(id) ?? 0;
      // An increase lifts a skill by one step (from untrained too, if chosen).
      ranks.set(id, Math.min(4, current + 1) as ProficiencyRank);
    }
  }

  // The per-level increase cap bounds only the player's chosen increases.
  const cap = maxRankForLevel(level);
  for (const [id, rank] of ranks) ranks.set(id, Math.min(rank, cap) as ProficiencyRank);

  // Feat-granted training is explicit (e.g. "You become trained in Nature") and
  // is not subject to the increase cap — apply it after, taking the higher rank.
  for (const [skillId, grant] of characterEffects(state).skillRanks) {
    ranks.set(skillId, Math.max(ranks.get(skillId) ?? 0, grant) as ProficiencyRank);
  }

  // Subclass-granted training (e.g. a Gunslinger Way trains you in its skill).
  for (const id of subclassGrantedSkillIds(state)) {
    ranks.set(id, Math.max(ranks.get(id) ?? 0, 1) as ProficiencyRank);
  }

  // Object-valued feat choices that train skills (Clan Lore, Aldori/Eldritch).
  for (const id of featChosenSkillIds(state)) {
    ranks.set(id, Math.max(ranks.get(id) ?? 0, 1) as ProficiencyRank);
  }

  // Manual overrides (homebrew / GM grants) raise a skill to the chosen rank.
  for (const [id, rank] of Object.entries(state.skillOverrides ?? {})) {
    const r = Math.max(0, Math.min(4, Math.floor(rank))) as ProficiencyRank;
    ranks.set(id, Math.max(ranks.get(id) ?? 0, r) as ProficiencyRank);
  }
  return ranks;
}

export interface SkillProficiency {
  id: string;
  name: string;
  ability: AbilityKey;
  rank: ProficiencyRank;
  modifier: number;
}

/** Skills trained by class + background, plus the player's free skill choices. */
export function trainedSkillIds(state: BuilderState): Set<string> {
  const set = new Set<string>();
  const background = state.backgroundId ? findBackground(state.backgroundId) : undefined;
  const klass = state.classId ? findClass(state.classId) : undefined;
  if (background?.trainedSkill) set.add(background.trainedSkill);
  if (klass) for (const s of klass.initialProficiencies.trainedSkills) set.add(s);
  for (const s of state.skillChoices) set.add(s);
  return set;
}

// --- Lore skills -----------------------------------------------------------
// Lore is an Intelligence skill with a player-named subject ("Warfare Lore").
// A build can carry any number of distinct subjects; each is its own skill with
// its own proficiency. We key them by a `lore:<slug>` id so they slot into the
// same rank/derive machinery as the 16 standard skills.

const LORE_PREFIX = 'lore:';

/** Stable id for a Lore subject, e.g. "Warfare" → "lore:warfare". */
export function loreId(subject: string): string {
  return LORE_PREFIX + subject.trim().toLowerCase().replace(/\s+/g, '-');
}

/** Display name for a Lore subject, normalised to end in a single "Lore". */
export function loreDisplayName(subject: string): string {
  const base = subject.trim().replace(/(\s+lore)+\s*$/i, '').trim();
  return base ? `${base} Lore` : 'Lore';
}

/**
 * The Lore subject a background grants, cleaned of the free-text noise in the
 * source data ("Academia Lore Lore", trailing "Lore", …). Returns null when the
 * source leaves the subject to the player ("your choice", "GM choice"), so those
 * backgrounds simply let the player add a Lore of their own instead.
 */
export function backgroundLoreSubject(state: BuilderState): string | null {
  const bg = state.backgroundId ? findBackground(state.backgroundId) : undefined;
  const raw = bg?.loreSkill?.trim();
  if (!raw) return null;
  if (/choice|choose|\bgm\b/i.test(raw)) return null;
  const subject = raw.replace(/(\s+lore)+\s*$/i, '').trim();
  return subject || null;
}

/**
 * Every trained Lore subject on the build: the background's granted Lore plus
 * the player's chosen Lores, de-duplicated case-insensitively (first spelling
 * wins). Background Lore is free; chosen Lores draw from the free-skill pool.
 */
export function trainedLoreSubjects(state: BuilderState): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (s: string | null | undefined) => {
    const v = s?.trim();
    if (!v) return;
    const k = v.toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    out.push(v);
  };
  push(backgroundLoreSubject(state));
  for (const l of state.loreChoices ?? []) push(l);
  return out;
}

/** Feats from the fixed build slots (creation + per-level), excluding grants. */
function sourceFeatIds(state: BuilderState): Set<string> {
  const ids = new Set<string>();
  const add = (id?: string) => {
    if (id) ids.add(id);
  };
  add(state.ancestryFeatId);
  add(state.ancestryParagonFeatId);
  add(state.classFeatId);
  const bg = state.backgroundId ? findBackground(state.backgroundId) : undefined;
  add(bg?.skillFeat);
  for (const g of Object.values(state.progression)) {
    add(g.classFeatId);
    add(g.ancestryFeatId);
    add(g.skillFeatId);
    add(g.generalFeatId);
    add(g.archetypeFeatId);
  }
  return ids;
}

// --- bonus feats granted by another choice ---------------------------------
// Several options hand you an *extra* feat to choose. Each surfaces as its own
// picker; the choice is stored under a stable, level-scoped slot key so it
// survives edits and is honoured only while its granting choice is active.

export type BonusFeatKind = 'class' | 'general' | 'ancestry' | 'dedication';

export const BONUS_FEAT_KIND_LABEL: Record<BonusFeatKind, string> = {
  class: 'Class',
  general: 'General',
  ancestry: 'Ancestry',
  dedication: 'Dedication',
};

export interface BonusFeatSlot {
  /** Stable key the chosen feat is stored under in `state.bonusFeatChoices`. */
  key: string;
  kind: BonusFeatKind;
  /** What granted the feat, for the picker's heading. */
  source: string;
  /** Character level at which the granting choice sits (drives which step shows it). */
  level: number;
  /** Highest feat level the grant allows (e.g. "a 3rd-level general feat"). */
  featLevel: number;
}

const VERSATILE_HUMAN_HERITAGE = 'versatile-human';

/** Feats that grant a bonus feat: id → what kind, and the granted feat's level. */
const BONUS_FEAT_GRANTS: Record<string, { kind: BonusFeatKind; source: string; featLevel: number }> = {
  'natural-ambition': { kind: 'class', source: 'Natural Ambition', featLevel: 1 },
  'general-training': { kind: 'general', source: 'General Training', featLevel: 1 },
  'advanced-general-training': { kind: 'general', source: 'Advanced General Training', featLevel: 3 },
  'ancestral-paragon': { kind: 'ancestry', source: 'Ancestral Paragon', featLevel: 1 },
  runtsage: { kind: 'ancestry', source: 'Runtsage', featLevel: 1 },
  multitalented: { kind: 'dedication', source: 'Multitalented', featLevel: 2 },
  'multifarious-muse': { kind: 'class', source: 'Multifarious Muse', featLevel: 1 },
};

/** Levels at which a feat id sits in the fixed (non-bonus) build slots. */
function featLevels(state: BuilderState, featId: string): number[] {
  const levels: number[] = [];
  if (state.ancestryFeatId === featId) levels.push(1);
  if (state.ancestryParagonFeatId === featId) levels.push(1);
  if (state.classFeatId === featId) levels.push(1);
  const bg = state.backgroundId ? findBackground(state.backgroundId) : undefined;
  if (bg?.skillFeat === featId) levels.push(1);
  for (const [lvlStr, g] of Object.entries(state.progression)) {
    const lvl = Number(lvlStr);
    if (
      g.classFeatId === featId ||
      g.ancestryFeatId === featId ||
      g.skillFeatId === featId ||
      g.generalFeatId === featId ||
      g.archetypeFeatId === featId
    )
      levels.push(lvl);
  }
  return levels;
}

/** The bonus-feat pickers a build currently has, from its granting choices. */
export function bonusFeatSlots(state: BuilderState): BonusFeatSlot[] {
  const slots: BonusFeatSlot[] = [];
  if (state.heritageId === VERSATILE_HUMAN_HERITAGE)
    slots.push({ key: 'versatile-human', kind: 'general', source: 'Versatile Human heritage', level: 1, featLevel: 1 });
  for (const [id, def] of Object.entries(BONUS_FEAT_GRANTS)) {
    for (const lvl of featLevels(state, id)) {
      slots.push({ key: `${id}@${lvl}`, kind: def.kind, source: def.source, level: lvl, featLevel: def.featLevel });
    }
  }
  return slots;
}

/** The feats eligible for a bonus-feat slot (by kind, capped at its feat level). */
export function bonusFeatOptions(state: BuilderState, slot: BonusFeatSlot): Feat[] {
  const feats = getDataset().feats;
  const cap = slot.featLevel;
  switch (slot.kind) {
    case 'class': {
      const cid = state.classId ?? '';
      return feats.filter((f) => f.type === 'class' && f.level <= cap && (f.classIds ?? []).includes(cid));
    }
    case 'general':
      // A general-feat grant may be filled by a general OR skill feat.
      return feats.filter((f) => (f.type === 'general' || f.type === 'skill') && f.level <= cap);
    case 'ancestry': {
      const aid = state.ancestryId ?? '';
      return feats.filter((f) => f.type === 'ancestry' && f.level <= cap && f.ancestryId === aid);
    }
    case 'dedication':
      return feats.filter(
        (f) => f.type === 'archetype' && f.level <= cap && (f.traits ?? []).includes('dedication'),
      );
  }
}

/** Every feat id on the build: the fixed slots plus active bonus-feat grants. */
export function chosenFeatIds(state: BuilderState): Set<string> {
  const ids = sourceFeatIds(state);
  // Only honour a stored bonus choice while its granting slot is still active,
  // so removing Natural Ambition (etc.) also drops the feat it granted.
  for (const slot of bonusFeatSlots(state)) {
    const id = state.bonusFeatChoices?.[slot.key];
    if (id) ids.add(id);
  }
  return ids;
}

/** How many times a feat id is taken on the build (repeatable feats), counting
 *  fixed slots AND filled bonus-feat grants. */
function countFeatOccurrences(state: BuilderState, featId: string): number {
  let n = featLevels(state, featId).length;
  for (const slot of bonusFeatSlots(state)) {
    if (state.bonusFeatChoices?.[slot.key] === featId) n += 1;
  }
  return n;
}

/**
 * Extra language slots granted by feats. Multilingual (Player Core p.258):
 * "You learn two new languages … an additional if you are or become a master in
 * Society, and again if legendary." It's repeatable, so each instance grants
 * its own 2 + master + legendary. Society rank is read from the derived build.
 */
export function featLanguageSlots(state: BuilderState): number {
  const count = countFeatOccurrences(state, 'multilingual');
  if (!count) return 0;
  const society = skillRankMap(state).get('society') ?? 0;
  const perInstance = 2 + (society >= 3 ? 1 : 0) + (society >= 4 ? 1 : 0);
  return count * perInstance;
}

/** Total number of free skills the player may pick (class count + Int bonus).
 *  The Intelligence bonus is fixed at level 1: a later Int boost does NOT grant
 *  additional trained skills, so this reads creation-level Int, not current. */
export function freeSkillCount(state: BuilderState): number {
  const klass = state.classId ? findClass(state.classId) : undefined;
  if (!klass) return 0;
  const scores = creationAbilityScores(state);
  const intMod = abilityModifier(scores.int);
  return klass.initialProficiencies.trainedSkillCount + Math.max(0, intMod);
}

export interface EquippedWeapon {
  id: string;
  name: string;
  attack: number;
  /** Number of weapon damage dice (>1 with Automatic Bonus Progression). */
  dice: number;
  damageDie: string;
  damageMod: number;
  damageType: string;
  ranged: boolean;
  range?: number;
  hands: string;
}

// Automatic Bonus Progression (GMG variant): the "big six" item bonuses granted
// automatically by character level.
function abpAttack(level: number): number {
  return level >= 16 ? 3 : level >= 10 ? 2 : level >= 2 ? 1 : 0;
}
function abpDamageDice(level: number): number {
  return level >= 19 ? 4 : level >= 12 ? 3 : level >= 4 ? 2 : 1;
}
function abpDefense(level: number): number {
  return level >= 18 ? 3 : level >= 11 ? 2 : level >= 5 ? 1 : 0;
}
function abpResilience(level: number): number {
  return level >= 20 ? 3 : level >= 14 ? 2 : level >= 8 ? 1 : 0;
}
function abpPerception(level: number): number {
  return level >= 19 ? 3 : level >= 13 ? 2 : level >= 7 ? 1 : 0;
}

export interface DerivedCharacter {
  scores: AbilityScores;
  mods: Record<AbilityKey, number>;
  maxHp: number;
  ac: number;
  /** Extra AC while a shield is raised (0 if no shield equipped). */
  shieldBonus: number;
  perception: number;
  saves: { fortitude: number; reflex: number; will: number };
  classDc: number;
  speed: number;
  /** Focus points from the level-1 subclass (0 or 1 for now). */
  focusPoints: number;
  /** GMG Stamina variant: null unless the variant is on. */
  stamina: { points: number; resolve: number } | null;
  skills: SkillProficiency[];
  weapons: EquippedWeapon[];
  ranks: {
    perception: ProficiencyRank;
    fortitude: ProficiencyRank;
    reflex: ProficiencyRank;
    will: ProficiencyRank;
    classDC: ProficiencyRank;
    unarmoredDefense: ProficiencyRank;
  };
  /** Feat-granted effects applied to this sheet, attributed to their source. */
  // `AppliedEffect` was renamed `EffectProvenance` in core — the doc-canonical name
  // now belongs to the Layer-1.5 runtime shape.
  effectNotes: EffectProvenance[];
  /**
   * SITUATIONAL modifiers — real bonuses that apply only in a context the sheet
   * cannot know ("+1 status to Will, vs undead"). Deliberately absent from every
   * total above: folding one in would make a conditional bonus permanent. Shown
   * so the player can apply it at the table.
   */
  situational: ConditionalModifier[];
  /** Special senses granted by ancestry/heritage (darkvision, scent, …). */
  senses: GrantedSense[];
  /** Damage resistances granted by ancestry/heritage, resolved at this level. */
  resistances: CharacterTraits['resistances'];
}

/**
 * Highest proficiency rank a class has in `track` at the character's level,
 * combining the level-1 `initial` rank (from the dataset / subclass) with the
 * class progression table in `@pathway/core`. Ranks only ever rise, so we take
 * the max.
 *
 * Covered tracks: perception, saves, class DC, spellcasting, and armor
 * (defense) categories. Weapon/attack proficiency past level 1 is handled in
 * the weapon derivation via `attackRankAtLevel` (category-, list-, and
 * group-scoped, including the fighter's chosen group). Monk's choice-based
 * save increases (Path to Perfection) remain unmodeled.
 */
function progressionRank(
  state: BuilderState,
  track: ProficiencyTrack,
  initial: number,
): ProficiencyRank {
  const level = state.level || 1;
  const fromClass = state.classId ? proficiencyRankAtLevel(state.classId, track, level) : 0;
  // Choice-driven schedules: cleric doctrine (saves/armor/spellcasting) and
  // the monk's Path to Perfection save choices.
  const fromDoctrine = doctrineTrackRank(state, track, level);
  const fromMonkPath = monkPathSaveRank(state, track, level);
  return Math.max(initial, fromClass, fromDoctrine, fromMonkPath) as ProficiencyRank;
}

export function deriveCharacter(state: BuilderState): DerivedCharacter {
  const level = state.level || 1;
  const scores = computeAbilityScores(state);
  const mods = ABILITY_KEYS.reduce(
    (acc, k) => ({ ...acc, [k]: abilityModifier(scores[k]) }),
    {} as Record<AbilityKey, number>,
  );

  const ancestry = state.ancestryId ? findAncestry(state.ancestryId) : undefined;
  const klass = state.classId ? findClass(state.classId) : undefined;
  const ip = klass?.initialProficiencies;
  const pwl = opt(state, OPT.proficiencyWithoutLevel);
  const abp = opt(state, OPT.automaticBonusProgression);

  // Feat-granted sheet effects (HP bonuses, proficiency-rank grants, typed stat
  // modifiers), resolved from each chosen feat's PassiveEffects by @pathway/core.
  const effects = characterEffects(state);
  // Ancestry/heritage senses & resistances (level-scaled) from the same engine.
  const traits = characterTraits(state);

  // Net bonus for a stat: the stat's own fundamental item bonus (rune / ABP) plus
  // any feat modifiers on the given selectors, run through the PF2e stacking rules
  // (so, e.g., a rune's item bonus and a feat's item bonus don't both count — only
  // the higher does). With no feats and no runes this returns the plain item bonus,
  // so baseline sheets are unchanged.
  //
  // Selectors are core's read vocabulary now, not Foundry's import names. Foundry's
  // BROADCAST selectors are gone: `saving-throw` and `skill-check` fan out to the
  // individual stats at ingest, so a save gathers `fortitude` alone rather than
  // `saving-throw` + `fortitude`.
  const statBonus = (itemBonus: number, ...selectors: string[]): number => {
    const mods: Modifier[] = itemBonus ? [{ type: 'item', value: itemBonus }] : [];
    for (const s of selectors) for (const m of effects.statModifiers.get(s) ?? []) mods.push(m);
    return stackModifiers(mods);
  };

  // Ancestry HP is granted once; class HP + Con modifier apply every level.
  // Feat HP bonuses (e.g. Toughness → +level) are added as a flat bonus.
  const maxHp = maxHitPoints({
    ancestryHp: ancestry?.hp ?? 0,
    classHp: klass?.hp ?? 0,
    conMod: mods.con,
    level,
    bonusHp: effects.hpBonus,
  });

  // Equipped gear.
  const equipped = (state.inventory ?? [])
    .filter((e) => e.equipped)
    .map((e) => findItem(e.itemId))
    .filter((i): i is NonNullable<typeof i> => Boolean(i));
  // Nothing enforces one-armor/one-shield at equip time, so if the player has
  // several equipped, pick the highest-AC one deterministically instead of
  // relying on inventory order (which produced a silently wrong, order-dependent AC).
  const bestByAc = <T extends { acBonus?: number }>(list: T[]): T | undefined =>
    list.length ? list.reduce((b, i) => ((i.acBonus ?? 0) > (b.acBonus ?? 0) ? i : b)) : undefined;
  const armor = bestByAc(equipped.filter((i): i is Armor => i.kind === 'armor'));
  const shield = bestByAc(equipped.filter((i): i is Shield => i.kind === 'shield'));
  const equippedWeapons = equipped.filter((i): i is Weapon => i.kind === 'weapon');

  // Fundamental runes on equipped gear (potency/striking/resilient). With the
  // Automatic Bonus Progression variant on, these runes don't exist — ABP's
  // level-based bonuses replace them entirely.
  const runesFor = (itemId: string) =>
    (state.inventory ?? []).find((e) => e.equipped && e.itemId === itemId)?.runes;
  const armorRunes = armor ? runesFor(armor.id) : undefined;
  const armorPotency = abp ? 0 : Math.max(0, Math.min(3, armorRunes?.potency ?? 0));
  const resilient = abp ? 0 : Math.max(0, Math.min(3, armorRunes?.resilient ?? 0));

  // Armor Class: 10 + defense proficiency + (Dex capped by armor) + armor bonus.
  const armorCategory = armor?.category ?? 'unarmored';
  const defenseRank = progressionRank(
    state,
    armorCategory as ProficiencyTrack,
    Math.max(ip?.defenses[armorCategory] ?? 0, subclassArmorRank(state, armorCategory)),
  );
  const ac = armorClass({
    dexMod: mods.dex,
    // Unarmored (no armor) and capless armor are both uncapped.
    dexCap: armor ? armor.dexCap : null,
    rank: defenseRank,
    level,
    withoutLevel: pwl,
    armorBonus: armor?.acBonus ?? 0,
    itemBonus: statBonus(armorPotency + (abp ? abpDefense(level) : 0), 'ac'),
  });
  const unarmoredDefense = progressionRank(state, 'unarmored', ip?.defenses.unarmored ?? 0);

  // Armor penalties apply when the wearer doesn't meet the Strength requirement.
  const meetsStr = !armor || scores.str >= armor.strength;
  const checkPenalty = armor && !meetsStr ? armor.checkPenalty : 0;
  const speedPenalty = armor ? (meetsStr ? Math.min(0, armor.speedPenalty + 5) : armor.speedPenalty) : 0;

  // A feat may raise a save/Perception rank (e.g. Canny Acumen); take the higher
  // of the class progression and any feat grant.
  const withGrant = (rank: ProficiencyRank, grant: ProficiencyRank | number | undefined) =>
    Math.max(rank, grant ?? 0) as ProficiencyRank;

  const perceptionRank = withGrant(
    progressionRank(state, 'perception', ip?.perception ?? 0),
    effects.perceptionRank ?? 0,
  );
  const perception = proficientModifier({
    abilityMod: mods.wis,
    rank: perceptionRank,
    level,
    withoutLevel: pwl,
    itemBonus: statBonus(abp ? abpPerception(level) : 0, 'perception'),
  });

  const fortRank = withGrant(progressionRank(state, 'fortitude', ip?.fortitude ?? 0), effects.saveRanks.get('fortitude'));
  const refRank = withGrant(progressionRank(state, 'reflex', ip?.reflex ?? 0), effects.saveRanks.get('reflex'));
  const willRank = withGrant(progressionRank(state, 'will', ip?.will ?? 0), effects.saveRanks.get('will'));
  const classDCRank = progressionRank(state, 'classDC', ip?.classDC ?? 0);

  // A saving throw: ability mod + proficiency + a fundamental item bonus (the
  // resilient rune, or Automatic Bonus Progression's resilience when ABP is on).
  const saveItemBonus = abp ? abpResilience(level) : resilient;
  const saveModifier = (rank: ProficiencyRank, abilityMod: number, saveId: string) =>
    proficientModifier({
      abilityMod,
      rank,
      level,
      withoutLevel: pwl,
      // 'saving-throw' modifiers hit all saves; the save-specific bucket only this one.
      itemBonus: statBonus(saveItemBonus, saveId),
    });

  const ranks = skillRankMap(state);
  const skills: SkillProficiency[] = getDataset().skills.map((s) => {
    const rank = ranks.get(s.id) ?? 0;
    // Armor check penalty applies to Strength- and Dexterity-based skills.
    const penalty = s.ability === 'str' || s.ability === 'dex' ? checkPenalty : 0;
    return {
      id: s.id,
      name: s.name,
      ability: s.ability,
      rank,
      modifier: proficientModifier({
        abilityMod: mods[s.ability],
        rank,
        level,
        withoutLevel: pwl,
        // Feat modifiers to all skills ('skill-check') and to this skill; the
        // armor check penalty stays a separate untyped term.
        itemBonus: statBonus(0, s.id),
        otherBonus: penalty,
      }),
    };
  });

  // Lore skills (Intelligence-based, player-named) live alongside the standard
  // skills so the sheet, overview, and exports treat them uniformly.
  for (const subject of trainedLoreSubjects(state)) {
    const id = loreId(subject);
    const rank = ranks.get(id) ?? 1;
    skills.push({
      id,
      name: loreDisplayName(subject),
      ability: 'int',
      rank,
      modifier: proficientModifier({
        abilityMod: mods.int,
        rank,
        level,
        withoutLevel: pwl,
        itemBonus: statBonus(0, 'skill-check', id),
        otherBonus: 0,
      }),
    });
  }

  // Weapon Specialization (a class feature granted at a class-specific level):
  // +2/+3/+4 to a weapon's damage when you're expert/master/legendary in it, per
  // the Foundry weapon-specialization.json rule elements (base 2, upgraded to 3
  // at master and 4 at legendary). Greater Weapon Specialization doubles it.
  const hasWeaponSpec = klass?.weaponSpecialization != null && level >= klass.weaponSpecialization;
  const hasGreaterWeaponSpec =
    klass?.greaterWeaponSpecialization != null && level >= klass.greaterWeaponSpecialization;
  const weaponSpecNotes: EffectProvenance[] = [];

  const weapons: EquippedWeapon[] = equippedWeapons.map((w) => {
    // Attack proficiency: the class's level-1 rank, raised by its weapon
    // expertise/mastery features (category-, list-, and group-scoped — the
    // fighter's chosen group comes from state.weaponGroup).
    const featureRank = state.classId
      ? attackRankAtLevel(
          state.classId,
          {
            category: w.category as AttackCategory,
            group: w.group,
            name: w.name.toLowerCase(),
            chosenGroup: state.weaponGroup,
          },
          level,
        )
      : 0;
    const catRank = Math.max(
      ip?.attacks[w.category] ?? 0,
      featureRank,
      doctrineAttackRank(state, w.category, level),
    ) as ProficiencyRank;
    const finesse = w.traits.includes('finesse');
    const attackMod = w.ranged ? mods.dex : finesse ? Math.max(mods.str, mods.dex) : mods.str;
    const propulsive = w.traits.includes('propulsive');
    const thrown = w.traits.includes('thrown');
    // Propulsive: add half your Strength modifier if positive, your FULL
    // modifier if negative. Thrown adds full Strength; other ranged adds none.
    const damageMod = w.ranged
      ? propulsive
        ? mods.str >= 0
          ? Math.floor(mods.str / 2)
          : mods.str
        : thrown
          ? mods.str
          : 0
      : mods.str;
    const wRunes = runesFor(w.id);
    const potency = abp ? 0 : Math.max(0, Math.min(3, wRunes?.potency ?? 0));
    const striking = abp ? 0 : Math.max(0, Math.min(3, wRunes?.striking ?? 0));
    // Applies only at expert+ (rank ≥ 2); the value equals the rank, doubled by
    // Greater Weapon Specialization.
    const weaponSpecBonus =
      hasWeaponSpec && catRank >= 2 ? catRank * (hasGreaterWeaponSpec ? 2 : 1) : 0;
    if (weaponSpecBonus > 0) {
      weaponSpecNotes.push({
        source: hasGreaterWeaponSpec ? 'Greater Weapon Specialization' : 'Weapon Specialization',
        stat: w.id,
        summary: `+${weaponSpecBonus} ${w.name} damage`,
      });
    }
    return {
      id: w.id,
      name: w.name,
      attack: proficientModifier({
        abilityMod: attackMod,
        rank: catRank,
        level,
        withoutLevel: pwl,
        itemBonus: potency + (abp ? abpAttack(level) : 0),
      }),
      dice: abp ? abpDamageDice(level) : 1 + striking,
      damageDie: w.damageDie,
      damageMod: damageMod + weaponSpecBonus,
      damageType: w.damageType,
      ranged: w.ranged,
      range: w.range,
      hands: w.hands,
    };
  });

  return {
    scores,
    mods,
    maxHp,
    ac,
    shieldBonus: shield?.acBonus ?? 0,
    perception,
    saves: {
      fortitude: saveModifier(fortRank, mods.con, 'fortitude'),
      reflex: saveModifier(refRank, mods.dex, 'reflex'),
      will: saveModifier(willRank, mods.wis, 'will'),
    },
    classDc: proficientDC({
      abilityMod: state.keyAbility ? mods[state.keyAbility] : 0,
      rank: classDCRank,
      level,
      withoutLevel: pwl,
    }),
    // Base Speed + armor penalty + feat modifiers to land Speed (e.g. +5 status).
    speed: (ancestry?.speed ?? 25) + speedPenalty + statBonus(0, 'speed:land'),
    // Focus pool: the number of focus spells the build knows (feat- or
    // subclass-granted, chosen on the Spells step), capped at 3 per the focus
    // rules; the level-1 subclass grant is the floor.
    focusPoints: Math.max(
      focusPoints(state),
      Math.min(
        3,
        (state.spellcasting?.focusSpells?.length ?? 0) +
          (state.spellcasting?.focusCantrips?.length ?? 0),
      ),
    ),
    stamina: opt(state, OPT.legacyStamina)
      ? {
          // GMG: (half class HP, min 1, + Con mod) per level; Resolve = key ability mod.
          points: Math.max(0, (Math.max(1, Math.floor((klass?.hp ?? 0) / 2)) + mods.con) * level),
          resolve: Math.max(0, state.keyAbility ? mods[state.keyAbility] : 0),
        }
      : null,
    skills,
    weapons,
    ranks: {
      perception: perceptionRank,
      fortitude: fortRank,
      reflex: refRank,
      will: willRank,
      classDC: classDCRank,
      unarmoredDefense,
    },
    effectNotes: [...effects.applied, ...weaponSpecNotes],
    situational: effects.conditional,
    senses: traits.senses,
    resistances: traits.resistances,
  };
}

/**
 * Adapt the builder's forward-derived character onto core's `ResolvedCharacter`
 * — the shared read-surface the effects engine consumes. This is a pure
 * re-shaping of values `deriveCharacter` already computed (no new rules math);
 * it exists so the sheet, the bot, and the effects engine all read ONE resolved
 * shape rather than this builder-specific one. Spell attack/DC are omitted: the
 * builder does not compute them today (a caster's spell selectors resolve to 0
 * until it does), which is honest rather than guessed.
 */
export function toResolvedCharacter(state: BuilderState): ResolvedCharacter {
  const derived = deriveCharacter(state);
  const skills: Record<string, SkillStat> = {};
  for (const s of derived.skills) {
    skills[s.id] = { modifier: s.modifier, rank: s.rank, ability: s.ability };
  }
  return {
    level: state.level || 1,
    scores: derived.scores,
    mods: derived.mods,
    keyAbility: state.keyAbility ?? null,
    hp: { max: derived.maxHp },
    ac: { value: derived.ac, shieldBonus: derived.shieldBonus },
    perception: { modifier: derived.perception, rank: derived.ranks.perception },
    saves: {
      fortitude: { modifier: derived.saves.fortitude, rank: derived.ranks.fortitude },
      reflex: { modifier: derived.saves.reflex, rank: derived.ranks.reflex },
      will: { modifier: derived.saves.will, rank: derived.ranks.will },
    },
    classDc: { modifier: derived.classDc, rank: derived.ranks.classDC },
    speeds: { land: derived.speed },
    skills,
    focusPoints: { max: derived.focusPoints },
  };
}

/** Human-readable validation problems that block a complete build. */
export function validate(state: BuilderState): string[] {
  const problems: string[] = [];
  if (!state.name.trim()) problems.push('Name your character.');
  if (!state.ancestryId) problems.push('Choose an ancestry.');
  else if (!state.heritageId) problems.push('Choose a heritage.');
  if (!state.backgroundId) problems.push('Choose a background.');
  if (!state.classId) problems.push('Choose a class.');

  const klass = state.classId ? findClass(state.classId) : undefined;
  if (klass && klass.keyAbility.length > 1 && !state.keyAbility)
    problems.push('Choose your key ability.');
  if (klass?.subclasses?.length && !state.subclassId)
    problems.push(`Choose your ${klass.subclassLabel ?? 'subclass'}.`);

  const ancestry = state.ancestryId ? findAncestry(state.ancestryId) : undefined;
  if (ancestry) {
    const need = choiceSlots(ancestry.boosts).length;
    const have = state.ancestryBoostChoices.filter(Boolean).length;
    if (have < need) problems.push('Assign all ancestry ability boosts.');
  }
  const background = state.backgroundId ? findBackground(state.backgroundId) : undefined;
  if (background) {
    const need = choiceSlots(background.boosts).length;
    const have = state.backgroundBoostChoices.filter(Boolean).length;
    if (have < need) problems.push('Assign all background ability boosts.');
  }
  if (state.freeBoosts.filter(Boolean).length < 4)
    problems.push('Assign all four free ability boosts.');
  const freeSet = new Set(state.freeBoosts.filter(Boolean));
  if (freeSet.size < state.freeBoosts.filter(Boolean).length)
    problems.push('The four free boosts must each target a different ability.');

  const freePicks = freeSkillCount(state);
  // Chosen Lores draw from the same free-skill pool as trained skills.
  const chosen = state.skillChoices.length + (state.loreChoices?.length ?? 0);
  if (chosen < freePicks) problems.push(`Choose ${freePicks - chosen} more trained skill(s).`);
  // Also flag TOO MANY — e.g. picked at Int +3 then a boost moved off Int, so the
  // free-skill count shrank but the extra picks weren't trimmed. Without this the
  // build validates as complete and exports an illegal extra trained skill.
  if (chosen > freePicks)
    problems.push(`Deselect ${chosen - freePicks} trained skill(s) — more than your free skills allow (an Intelligence change likely reduced them).`);

  // Bonus feats granted by another choice must be filled in.
  for (const slot of bonusFeatSlots(state)) {
    if (!state.bonusFeatChoices?.[slot.key])
      problems.push(`Choose the ${slot.kind} feat granted by ${slot.source}.`);
  }
  // A subclass skill choice (e.g. Gunslinger Pistolero) must be resolved.
  const wayChoice = subclassSkillGrant(state)?.choose;
  if (wayChoice && !state.subclassSkillChoices?.[wayChoice.key])
    problems.push('Choose the skill your subclass trains.');

  for (let lvl = 2; lvl <= (state.level || 1); lvl += 1) {
    for (const msg of unmetAtLevel(state, lvl)) problems.push(`Level ${lvl}: ${msg}`);
  }

  return problems;
}

/** What's still unchosen at a given level (levels ≥ 2). Used by the Advancement UI. */
export function unmetAtLevel(state: BuilderState, level: number): string[] {
  const slots = gainsForLevel(level, state.options);
  const gains = state.progression[level];
  const out: string[] = [];
  if (slots.classFeat && !gains?.classFeatId) out.push('choose a class feat');
  if (slots.ancestryFeat && !gains?.ancestryFeatId) out.push('choose an ancestry feat');
  if (slots.skillFeat && !gains?.skillFeatId) out.push('choose a skill feat');
  if (slots.generalFeat && !gains?.generalFeatId) out.push('choose a general feat');
  if (slots.skillIncrease && !gains?.skillIncreases.length) out.push('choose a skill to increase');
  // Archetype feats stay optional in validation: the dataset carries the
  // archetype feats, but dedication chains (two-feat rule, per-archetype
  // limits) aren't enforced yet, so Free Archetype never blocks a build.
  if (slots.boostCount > 0) {
    const boosts = (gains?.boosts ?? []).filter(Boolean);
    if (boosts.length < slots.boostCount)
      out.push(`assign ${slots.boostCount} ability boost${slots.boostCount > 1 ? 's' : ''}`);
    else if (new Set(boosts).size < boosts.length) out.push('ability boosts must differ');
  }
  return out;
}
