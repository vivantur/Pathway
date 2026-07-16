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
  collectSheetEffects,
  collectTraits,
  maxHitPoints,
  proficiencyBonus,
  proficientDC,
  proficientModifier,
  proficiencyRankAtLevel,
  RANK_LABEL,
  stackModifiers,
  type AppliedEffect,
  type AttackCategory,
  type CharacterTraits,
  type GrantedSense,
  type Modifier,
  type ProficiencyTrack,
  type RuleElement,
  type SheetEffects,
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
 * Sheet effects granted by the character's chosen feats — HP bonuses and
 * proficiency-rank grants resolved from each feat's ingested rule elements by
 * `@pathway/core`. Recomputed on demand; the underlying collection is cheap.
 */
export function characterEffects(state: BuilderState): SheetEffects {
  const level = state.level || 1;
  const itemRules: RuleElement[][] = [];
  const labels: string[] = [];
  const choices: Record<string, string>[] = [];
  for (const id of chosenFeatIds(state)) {
    const feat = findFeat(id);
    if (feat && Array.isArray(feat.rules)) {
      itemRules.push(feat.rules as RuleElement[]);
      labels.push(feat.name);
      choices.push(state.featChoices?.[id] ?? {});
    }
  }
  return collectSheetEffects(itemRules, { level }, labels, choices);
}

// --- choice-driven feats: player prompts ------------------------------------
//
// Some feats carry a ChoiceSet whose selection drives a proficiency-rank grant
// (Canny Acumen picks a save/Perception; Natural Skill picks two skills). Core
// resolves `{item|flags.system.rulesSelections.<flag>}` once the player's choice
// is stored in `state.featChoices`. These helpers expose which prompts a feat
// needs and turn a raw ChoiceSet into simple {value,label} options — scoped to
// the rank paths the engine actually applies, so we never show a dropdown whose
// selection would silently do nothing.

export interface FeatChoiceOption {
  value: string;
  label: string;
}
export interface FeatChoicePrompt {
  /** ChoiceSet flag the selection is stored under (e.g. `cannyAcumen`, `skillOne`). */
  flag: string;
  /** Short label for the dropdown ("Proficiency", "Skill", "Save"). */
  prompt: string;
  options: FeatChoiceOption[];
}

const CHOICE_SKILL_RANK = /^system\.skills\.([a-z]+)\.rank$/;
const CHOICE_SAVE_RANK = /^system\.saves\.(fortitude|reflex|will)\.rank$/;
const CHOICE_PERCEPTION_RANK = /^system\.(?:attributes\.)?perception\.rank$/;

/** A whole-path choice value the effects engine can map to a sheet rank. */
function mappableRankPath(p: unknown): p is string {
  return (
    typeof p === 'string' &&
    (CHOICE_SKILL_RANK.test(p) || CHOICE_SAVE_RANK.test(p) || CHOICE_PERCEPTION_RANK.test(p))
  );
}

/** Human label for a whole-path rank choice value. */
function labelForRankPath(p: string): string {
  const save = CHOICE_SAVE_RANK.exec(p);
  if (save?.[1]) return titleCaseWord(save[1]);
  const skill = CHOICE_SKILL_RANK.exec(p);
  if (skill?.[1]) return titleCaseWord(skill[1]);
  if (CHOICE_PERCEPTION_RANK.test(p)) return 'Perception';
  return p;
}

const titleCaseWord = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

const SAVE_CHOICE_OPTIONS: FeatChoiceOption[] = [
  { value: 'fortitude', label: 'Fortitude' },
  { value: 'reflex', label: 'Reflex' },
  { value: 'will', label: 'Will' },
];

function skillChoiceOptions(): FeatChoiceOption[] {
  return getDataset().skills.map((s) => ({ value: s.id, label: s.name }));
}

/** True if some ActiveEffectLike rank path on `rules` references this flag. */
function flagDrivesRank(rules: unknown[], flag: string): boolean {
  const placeholder = `{item|flags.system.rulesSelections.${flag}}`;
  return rules.some(
    (r) =>
      r != null &&
      typeof r === 'object' &&
      (r as { key?: unknown }).key === 'ActiveEffectLike' &&
      typeof (r as { path?: unknown }).path === 'string' &&
      ((r as { path: string }).path.includes(placeholder)),
  );
}

/**
 * The player prompts a feat needs, in order. Empty when the feat has no
 * choice-driven rank grant this engine supports (its object-valued or
 * out-of-scope ChoiceSets are omitted rather than shown as dead dropdowns).
 */
export function featChoicePrompts(feat: Feat | undefined): FeatChoicePrompt[] {
  const rules = feat?.rules;
  if (!feat || !Array.isArray(rules)) return [];
  const prompts: FeatChoicePrompt[] = [];
  for (const rule of rules) {
    if (!rule || typeof rule !== 'object') continue;
    const r = rule as { key?: unknown; flag?: unknown; choices?: unknown };
    if (r.key !== 'ChoiceSet' || typeof r.flag !== 'string') continue;
    if (!flagDrivesRank(rules, r.flag)) continue;

    if (Array.isArray(r.choices)) {
      // Explicit list (Canny Acumen): each value is a whole rank path. Keep only
      // the ones the engine applies (saves + Perception), labelled from the path.
      const options = r.choices
        .map((c) => (c as { value?: unknown }).value)
        .filter(mappableRankPath)
        .map((v) => ({ value: v, label: labelForRankPath(v) }));
      if (options.length) prompts.push({ flag: r.flag, prompt: 'Proficiency', options });
    } else if (r.choices && typeof r.choices === 'object') {
      const config = (r.choices as { config?: unknown }).config;
      if (config === 'skills') prompts.push({ flag: r.flag, prompt: 'Skill', options: skillChoiceOptions() });
      else if (config === 'saves') prompts.push({ flag: r.flag, prompt: 'Save', options: SAVE_CHOICE_OPTIONS });
      // Other configs (weapons, itemType filters) are out of scope for the rank
      // engine — omitted, not shown as a no-op dropdown.
    }
  }
  // Object-valued skill grants (Clan Lore, Aldori/Eldritch dedications): these
  // pick an option whose sub-fields name skills, which we apply ourselves.
  prompts.push(...objectSkillChoicePrompts(feat));
  return prompts;
}

// A skill-rank grant driven by a *nested* selection field, e.g. Clan Lore's
// `…rulesSelections.clan.skillOne`. Core can't substitute nested flags, so the
// builder resolves these: the prompt's stored value is the granted skill id(s).
const NESTED_SKILL_RANK = /system\.skills\.\{item\|flags\.system\.rulesSelections\.([a-z]+)\.([a-z]+)\}\.rank/i;

/**
 * Prompts for ChoiceSets whose object-valued options grant skills via nested
 * rank paths. Each option's value is the comma-joined skill ids it trains (also
 * what gets stored), labelled by the skill names.
 */
function objectSkillChoicePrompts(feat: Feat | undefined): FeatChoicePrompt[] {
  const rules = feat?.rules;
  if (!Array.isArray(rules)) return [];
  // flag → the sub-fields of its selection that name a trained skill.
  const subfieldsByFlag = new Map<string, Set<string>>();
  for (const r of rules) {
    const path = (r as { key?: unknown; path?: unknown }).path;
    if ((r as { key?: unknown }).key !== 'ActiveEffectLike' || typeof path !== 'string') continue;
    const m = NESTED_SKILL_RANK.exec(path);
    if (m) (subfieldsByFlag.get(m[1]) ?? subfieldsByFlag.set(m[1], new Set()).get(m[1])!).add(m[2]);
  }
  if (!subfieldsByFlag.size) return [];
  const skillIds = new Set(getDataset().skills.map((s) => s.id));
  const skillName = (id: string) => getDataset().skills.find((s) => s.id === id)?.name ?? id;
  const prompts: FeatChoicePrompt[] = [];
  for (const rule of rules) {
    const r = rule as { key?: unknown; flag?: unknown; choices?: unknown };
    if (r.key !== 'ChoiceSet' || typeof r.flag !== 'string' || !Array.isArray(r.choices)) continue;
    const subs = subfieldsByFlag.get(r.flag);
    if (!subs) continue;
    const seen = new Set<string>();
    const options: FeatChoiceOption[] = [];
    for (const c of r.choices as Array<{ value?: unknown }>) {
      const val = c.value;
      if (!val || typeof val !== 'object') continue;
      const ids = [...subs]
        .map((sf) => (val as Record<string, unknown>)[sf])
        .filter((x): x is string => typeof x === 'string' && skillIds.has(x));
      if (!ids.length) continue;
      const key = ids.join(',');
      if (seen.has(key)) continue;
      seen.add(key);
      options.push({ value: key, label: ids.map(skillName).join(', ') });
    }
    if (options.length) prompts.push({ flag: r.flag, prompt: 'Trains', options });
  }
  return prompts;
}

/** Skill ids trained by a resolved object-valued feat choice (Clan Lore, etc.). */
export function featChosenSkillIds(state: BuilderState): string[] {
  const out: string[] = [];
  for (const id of chosenFeatIds(state)) {
    const feat = findFeat(id);
    if (!feat) continue;
    for (const p of objectSkillChoicePrompts(feat)) {
      const chosen = state.featChoices?.[id]?.[p.flag];
      if (chosen) out.push(...chosen.split(',').filter(Boolean));
    }
  }
  return out;
}

/** Every chosen feat that still needs one or more player choices, with prompts. */
export function pendingFeatChoices(
  state: BuilderState,
): { feat: Feat; prompts: FeatChoicePrompt[] }[] {
  const out: { feat: Feat; prompts: FeatChoicePrompt[] }[] = [];
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
  const itemRules: RuleElement[][] = [];
  const labels: string[] = [];

  if (ancestry?.vision && ancestry.vision !== 'normal') {
    itemRules.push([{ key: 'Sense', selector: ancestry.vision } as RuleElement]);
    labels.push(ancestry.name);
  }
  if (ancestry && Array.isArray(ancestry.rules)) {
    itemRules.push(ancestry.rules as RuleElement[]);
    labels.push(ancestry.name);
  }
  if (heritage && Array.isArray(heritage.rules)) {
    itemRules.push(heritage.rules as RuleElement[]);
    labels.push(heritage.name);
  }

  const traits = collectTraits(itemRules, { level }, labels);
  // Darkvision supersedes low-light-vision (it does everything low-light does),
  // so don't list both when a heritage upgrades an ancestry's low-light vision.
  if (traits.senses.some((s) => s.type === 'darkvision')) {
    traits.senses = traits.senses.filter((s) => s.type !== 'low-light-vision');
  }
  return traits;
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
  effectNotes: AppliedEffect[];
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
  // modifiers), resolved from each chosen feat's rule elements by @pathway/core.
  const effects = characterEffects(state);
  // Ancestry/heritage senses & resistances (level-scaled) from the same engine.
  const traits = characterTraits(state);

  // Net bonus for a stat: the stat's own fundamental item bonus (rune / ABP) plus
  // any feat modifiers on the given selector buckets, run through the PF2e
  // stacking rules (so, e.g., a rune's item bonus and a feat's item bonus don't
  // both count — only the higher does). With no feats and no runes this returns
  // the plain item bonus, so baseline sheets are unchanged.
  const statBonus = (itemBonus: number, ...buckets: string[]): number => {
    const mods: Modifier[] = itemBonus ? [{ type: 'item', value: itemBonus }] : [];
    for (const b of buckets) for (const m of effects.statModifiers.get(b) ?? []) mods.push(m);
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
      itemBonus: statBonus(saveItemBonus, 'saving-throw', saveId),
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
        itemBonus: statBonus(0, 'skill-check', s.id),
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
  const weaponSpecNotes: AppliedEffect[] = [];

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
    speed: (ancestry?.speed ?? 25) + speedPenalty + statBonus(0, 'land-speed'),
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
    senses: traits.senses,
    resistances: traits.resistances,
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
