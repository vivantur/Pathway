/**
 * The PF2e derived-stat engine — the heart of `@pathway/core`.
 *
 * PURE and I/O-free: every function that needs game content takes a `Dataset`
 * as its first argument, so the package never imports the bundled JSON. The apps
 * hold the data and pass it in (see `createEngine` in `factory.ts` for an
 * ergonomic binding).
 *
 * Rules implemented here are locked by worked-example tests. Do not add rules
 * from memory — implement only from rules text and lock with a test.
 */

import {
  ABILITY_KEYS,
  type AbilityKey,
  type Armor,
  type Boost,
  type CharacterClass,
  type Dataset,
  type ProficiencyRank,
  type ProficiencyTarget,
  type Shield,
  type Weapon,
} from './schema';
import type { BuilderState } from './character';
import { OPT } from './options';
import { focusPoints, subclassArmorRank } from './subclass';

export type AbilityScores = Record<AbilityKey, number>;

/** Look up a content entity by id within a dataset list. */
function byId<T extends { id: string }>(list: readonly T[], id: string | undefined): T | undefined {
  return id == null ? undefined : list.find((x) => x.id === id);
}

/** Read a character option (defaults to off). */
export function opt(state: BuilderState, id: string): boolean {
  return state.options?.[id] ?? false;
}

/**
 * PF2e proficiency bonus: 0 when untrained, otherwise level + 2×rank.
 * With Proficiency Without Level (a variant rule), the level term is dropped.
 */
export function proficiencyBonus(
  rank: ProficiencyRank,
  level: number,
  withoutLevel = false,
): number {
  if (rank === 0) return 0;
  return (withoutLevel ? 0 : level) + rank * 2;
}

export function abilityModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

/**
 * Effective proficiency rank for a target at a given character level: the
 * class's base rank raised by any `proficiencyIncreases` reached by that level,
 * including those gated behind the chosen subclass (e.g. a cleric's doctrine).
 * Proficiency only ever increases, so this is the max of the base and every
 * applicable increase. This is what makes a level-20 fighter legendary with
 * martial weapons instead of frozen at its level-1 rank.
 */
export function classProficiency(
  klass: CharacterClass | undefined,
  target: ProficiencyTarget,
  level: number,
  base: ProficiencyRank,
  subclassId?: string,
): ProficiencyRank {
  let rank: ProficiencyRank = base;
  const subclass = subclassId ? klass?.subclasses?.find((s) => s.id === subclassId) : undefined;
  const apply = (increases: readonly { target: ProficiencyTarget; level: number; rank: ProficiencyRank }[] | undefined) => {
    for (const inc of increases ?? []) {
      if (inc.target === target && inc.level <= level && inc.rank > rank) rank = inc.rank;
    }
  };
  apply(klass?.proficiencyIncreases);
  apply(subclass?.proficiencyIncreases);
  return rank;
}

export const RANK_LABEL: Record<ProficiencyRank, string> = {
  0: 'Untrained',
  1: 'Trained',
  2: 'Expert',
  3: 'Master',
  4: 'Legendary',
};

// PF2e character-advancement table (generic across the Player Core classes).
// Level 1's class feat + ancestry feat + skill feat live in the creation steps.
const CLASS_FEAT_LEVELS = [1, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20];
const ANCESTRY_FEAT_LEVELS = [1, 5, 9, 13, 17];
const ANCESTRY_PARAGON_LEVELS = [1, 3, 7, 11, 15, 19];
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

export function computeAbilityScores(dataset: Dataset, state: BuilderState): AbilityScores {
  const applied: Applied[] = [];
  const ancestry = byId(dataset.ancestries, state.ancestryId);
  const background = byId(dataset.backgrounds, state.backgroundId);
  const klass = byId(dataset.classes, state.classId);

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

  // Ability boosts gained at levels 5/10/15/20, up to the character's level.
  for (const [lvlStr, gains] of Object.entries(state.progression)) {
    if (Number(lvlStr) > (state.level || 1)) continue;
    for (const a of gains.boosts) if (a) applied.push({ ability: a, kind: 'boost' });
  }

  return applyAll(applied);
}

/** Final proficiency rank of every skill, factoring in per-level skill increases. */
export function skillRankMap(dataset: Dataset, state: BuilderState): Map<string, ProficiencyRank> {
  const level = state.level || 1;
  const trained = trainedSkillIds(dataset, state);
  const ranks = new Map<string, ProficiencyRank>();
  for (const s of dataset.skills) ranks.set(s.id, trained.has(s.id) ? 1 : 0);

  for (const [lvlStr, gains] of Object.entries(state.progression)) {
    if (Number(lvlStr) > level) continue;
    for (const id of gains.skillIncreases) {
      const current = ranks.get(id) ?? 0;
      // An increase lifts a skill by one step (from untrained too, if chosen).
      ranks.set(id, Math.min(4, current + 1) as ProficiencyRank);
    }
  }

  const cap = maxRankForLevel(level);
  for (const [id, rank] of ranks) ranks.set(id, Math.min(rank, cap) as ProficiencyRank);
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
export function trainedSkillIds(dataset: Dataset, state: BuilderState): Set<string> {
  const set = new Set<string>();
  const background = byId(dataset.backgrounds, state.backgroundId);
  const klass = byId(dataset.classes, state.classId);
  if (background?.trainedSkill) set.add(background.trainedSkill);
  if (klass) for (const s of klass.initialProficiencies.trainedSkills) set.add(s);
  for (const s of state.skillChoices) set.add(s);
  return set;
}

/** Every feat id chosen anywhere on the build (all levels + creation slots). */
export function chosenFeatIds(dataset: Dataset, state: BuilderState): Set<string> {
  const ids = new Set<string>();
  const add = (id?: string) => {
    if (id) ids.add(id);
  };
  add(state.ancestryFeatId);
  add(state.classFeatId);
  const bg = byId(dataset.backgrounds, state.backgroundId);
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

/** Total number of free skills the player may pick (class count + Int bonus). */
export function freeSkillCount(dataset: Dataset, state: BuilderState): number {
  const klass = byId(dataset.classes, state.classId);
  if (!klass) return 0;
  const scores = computeAbilityScores(dataset, state);
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
}

export function deriveCharacter(dataset: Dataset, state: BuilderState): DerivedCharacter {
  const level = state.level || 1;
  const scores = computeAbilityScores(dataset, state);
  const mods = ABILITY_KEYS.reduce(
    (acc, k) => ({ ...acc, [k]: abilityModifier(scores[k]) }),
    {} as Record<AbilityKey, number>,
  );

  const ancestry = byId(dataset.ancestries, state.ancestryId);
  const klass = byId(dataset.classes, state.classId);
  const ip = klass?.initialProficiencies;
  const pwl = opt(state, OPT.proficiencyWithoutLevel);
  const pb = (rank: ProficiencyRank) => proficiencyBonus(rank, level, pwl);
  const abp = opt(state, OPT.automaticBonusProgression);

  // Ancestry HP is granted once; class HP + Con modifier apply every level.
  const maxHp = (ancestry?.hp ?? 0) + ((klass?.hp ?? 0) + mods.con) * level;

  // Equipped gear.
  const equipped = (state.inventory ?? [])
    .filter((e) => e.equipped)
    .map((e) => byId(dataset.items, e.itemId))
    .filter((i): i is NonNullable<typeof i> => Boolean(i));
  const armor = equipped.find((i): i is Armor => i.kind === 'armor');
  const shield = equipped.find((i): i is Shield => i.kind === 'shield');
  const equippedWeapons = equipped.filter((i): i is Weapon => i.kind === 'weapon');

  // Armor Class: 10 + defense proficiency + (Dex capped by armor) + armor bonus.
  const armorCategory = armor?.category ?? 'unarmored';
  const defenseBase = Math.max(
    ip?.defenses[armorCategory] ?? 0,
    subclassArmorRank(state, armorCategory),
  ) as ProficiencyRank;
  const defenseRank = classProficiency(klass, `defenses.${armorCategory}`, level, defenseBase, state.subclassId);
  const dexForAc =
    armor && armor.dexCap !== null ? Math.min(mods.dex, armor.dexCap) : mods.dex;
  const ac =
    10 + pb(defenseRank) + dexForAc + (armor?.acBonus ?? 0) + (abp ? abpDefense(level) : 0);
  const unarmoredDefense = classProficiency(
    klass,
    'defenses.unarmored',
    level,
    (ip?.defenses.unarmored ?? 0) as ProficiencyRank,
    state.subclassId,
  );

  // Armor penalties apply when the wearer doesn't meet the Strength requirement.
  const meetsStr = !armor || scores.str >= armor.strength;
  const checkPenalty = armor && !meetsStr ? armor.checkPenalty : 0;
  const speedPenalty = armor ? (meetsStr ? Math.min(0, armor.speedPenalty + 5) : armor.speedPenalty) : 0;

  const sc = state.subclassId;
  const perceptionRank = classProficiency(klass, 'perception', level, (ip?.perception ?? 0) as ProficiencyRank, sc);
  const perception = pb(perceptionRank) + mods.wis + (abp ? abpPerception(level) : 0);

  const fortRank = classProficiency(klass, 'fortitude', level, (ip?.fortitude ?? 0) as ProficiencyRank, sc);
  const refRank = classProficiency(klass, 'reflex', level, (ip?.reflex ?? 0) as ProficiencyRank, sc);
  const willRank = classProficiency(klass, 'will', level, (ip?.will ?? 0) as ProficiencyRank, sc);
  const classDCRank = classProficiency(klass, 'classDC', level, (ip?.classDC ?? 0) as ProficiencyRank, sc);

  const ranks = skillRankMap(dataset, state);
  const skills: SkillProficiency[] = dataset.skills.map((s) => {
    const rank = ranks.get(s.id) ?? 0;
    // Armor check penalty applies to Strength- and Dexterity-based skills.
    const penalty = s.ability === 'str' || s.ability === 'dex' ? checkPenalty : 0;
    return {
      id: s.id,
      name: s.name,
      ability: s.ability,
      rank,
      modifier: pb(rank) + mods[s.ability] + penalty,
    };
  });

  const weapons: EquippedWeapon[] = equippedWeapons.map((w) => {
    const catRank = classProficiency(
      klass,
      `attacks.${w.category}`,
      level,
      (ip?.attacks[w.category] ?? 0) as ProficiencyRank,
      state.subclassId,
    );
    const finesse = w.traits.includes('finesse');
    const attackMod = w.ranged ? mods.dex : finesse ? Math.max(mods.str, mods.dex) : mods.str;
    const propulsive = w.traits.includes('propulsive');
    const thrown = w.traits.includes('thrown');
    const damageMod = w.ranged
      ? propulsive
        ? Math.max(0, Math.floor(mods.str / 2))
        : thrown
          ? mods.str
          : 0
      : mods.str;
    return {
      id: w.id,
      name: w.name,
      attack: pb(catRank) + attackMod + (abp ? abpAttack(level) : 0),
      dice: abp ? abpDamageDice(level) : 1,
      damageDie: w.damageDie,
      damageMod,
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
      fortitude: pb(fortRank) + mods.con + (abp ? abpResilience(level) : 0),
      reflex: pb(refRank) + mods.dex + (abp ? abpResilience(level) : 0),
      will: pb(willRank) + mods.wis + (abp ? abpResilience(level) : 0),
    },
    classDc: 10 + pb(classDCRank) + (state.keyAbility ? mods[state.keyAbility] : 0),
    speed: (ancestry?.speed ?? 25) + speedPenalty,
    focusPoints: focusPoints(state),
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
  };
}

/** Human-readable validation problems that block a complete build. */
export function validate(dataset: Dataset, state: BuilderState): string[] {
  const problems: string[] = [];
  if (!state.name.trim()) problems.push('Name your character.');
  if (!state.ancestryId) problems.push('Choose an ancestry.');
  else if (!state.heritageId) problems.push('Choose a heritage.');
  if (!state.backgroundId) problems.push('Choose a background.');
  if (!state.classId) problems.push('Choose a class.');

  const klass = byId(dataset.classes, state.classId);
  if (klass && klass.keyAbility.length > 1 && !state.keyAbility)
    problems.push('Choose your key ability.');
  if (klass?.subclasses?.length && !state.subclassId)
    problems.push(`Choose your ${klass.subclassLabel ?? 'subclass'}.`);

  const ancestry = byId(dataset.ancestries, state.ancestryId);
  if (ancestry) {
    const need = choiceSlots(ancestry.boosts).length;
    const have = state.ancestryBoostChoices.filter(Boolean).length;
    if (have < need) problems.push('Assign all ancestry ability boosts.');
  }
  const background = byId(dataset.backgrounds, state.backgroundId);
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

  const freePicks = freeSkillCount(dataset, state);
  const chosen = state.skillChoices.length;
  if (chosen < freePicks) problems.push(`Choose ${freePicks - chosen} more trained skill(s).`);

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
  // Archetype feats are optional in validation until archetype content exists,
  // so Free Archetype never blocks completing a build.
  if (slots.boostCount > 0) {
    const boosts = (gains?.boosts ?? []).filter(Boolean);
    if (boosts.length < slots.boostCount)
      out.push(`assign ${slots.boostCount} ability boost${slots.boostCount > 1 ? 's' : ''}`);
    else if (new Set(boosts).size < boosts.length) out.push('ability boosts must differ');
  }
  return out;
}
