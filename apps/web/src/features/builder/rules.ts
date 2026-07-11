import {
  ABILITY_KEYS,
  findAncestry,
  findBackground,
  findClass,
  findItem,
  getDataset,
  type AbilityKey,
  type Armor,
  type Boost,
  type ProficiencyRank,
  type Shield,
  type Weapon,
} from '@/features/builder/data';
import { OPT } from '@/features/builder/options/config';
import {
  abilityModifier,
  attackRankAtLevel,
  proficiencyBonus,
  proficiencyRankAtLevel,
  RANK_LABEL,
  type AttackCategory,
  type ProficiencyTrack,
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

/** Final proficiency rank of every skill, factoring in per-level skill increases. */
export function skillRankMap(state: BuilderState): Map<string, ProficiencyRank> {
  const level = state.level || 1;
  const trained = trainedSkillIds(state);
  const ranks = new Map<string, ProficiencyRank>();
  for (const s of getDataset().skills) ranks.set(s.id, trained.has(s.id) ? 1 : 0);

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
export function trainedSkillIds(state: BuilderState): Set<string> {
  const set = new Set<string>();
  const background = state.backgroundId ? findBackground(state.backgroundId) : undefined;
  const klass = state.classId ? findClass(state.classId) : undefined;
  if (background?.trainedSkill) set.add(background.trainedSkill);
  if (klass) for (const s of klass.initialProficiencies.trainedSkills) set.add(s);
  for (const s of state.skillChoices) set.add(s);
  return set;
}

/** Every feat id chosen anywhere on the build (all levels + creation slots). */
export function chosenFeatIds(state: BuilderState): Set<string> {
  const ids = new Set<string>();
  const add = (id?: string) => {
    if (id) ids.add(id);
  };
  add(state.ancestryFeatId);
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
    /** Spell attack/DC track (0 for non-casters), incl. doctrine bumps. */
    spellcasting: ProficiencyRank;
    defenses: Record<ArmorCategory, ProficiencyRank>;
    attacks: Record<AttackCategory, ProficiencyRank>;
  };
}

type ArmorCategory = 'unarmored' | 'light' | 'medium' | 'heavy';

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
  const pb = (rank: ProficiencyRank) => proficiencyBonus(rank, level, pwl);
  const abp = opt(state, OPT.automaticBonusProgression);

  // Ancestry HP is granted once; class HP + Con modifier apply every level.
  const maxHp = (ancestry?.hp ?? 0) + ((klass?.hp ?? 0) + mods.con) * level;

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

  // Defense (armor-category) ranks at the current level. All four are derived —
  // not just the equipped category — because the serialized export carries the
  // full set and consumers (sheet, bot) must never see level-1 ranks.
  const defenseRankFor = (cat: ArmorCategory): ProficiencyRank =>
    progressionRank(
      state,
      cat,
      Math.max(ip?.defenses[cat] ?? 0, subclassArmorRank(state, cat)),
    );
  const defenses: Record<ArmorCategory, ProficiencyRank> = {
    unarmored: defenseRankFor('unarmored'),
    light: defenseRankFor('light'),
    medium: defenseRankFor('medium'),
    heavy: defenseRankFor('heavy'),
  };

  // Armor Class: 10 + defense proficiency + (Dex capped by armor) + armor bonus.
  const armorCategory = (armor?.category ?? 'unarmored') as ArmorCategory;
  const defenseRank = defenses[armorCategory];
  const dexForAc =
    armor && armor.dexCap !== null ? Math.min(mods.dex, armor.dexCap) : mods.dex;
  const ac =
    10 +
    pb(defenseRank) +
    dexForAc +
    (armor?.acBonus ?? 0) +
    armorPotency +
    (abp ? abpDefense(level) : 0);
  const unarmoredDefense = defenses.unarmored;

  // Category-level attack ranks (weapon-specific overlays — named weapons,
  // group scopes — are applied per equipped weapon below; these are the
  // baseline ranks the export serializes).
  const attackRankFor = (cat: AttackCategory): ProficiencyRank =>
    Math.max(
      ip?.attacks[cat] ?? 0,
      state.classId
        ? attackRankAtLevel(state.classId, { category: cat, chosenGroup: state.weaponGroup }, level)
        : 0,
      doctrineAttackRank(state, cat, level),
    ) as ProficiencyRank;
  const attacks: Record<AttackCategory, ProficiencyRank> = {
    unarmed: attackRankFor('unarmed'),
    simple: attackRankFor('simple'),
    martial: attackRankFor('martial'),
    advanced: attackRankFor('advanced'),
  };

  const spellcastingRank = progressionRank(state, 'spellcasting', 0);

  // Armor penalties apply when the wearer doesn't meet the Strength requirement.
  // The dataset stores that threshold as a MODIFIER (remaster style: Full Plate
  // is "Str +4", stored 4) — comparing the raw score (10-20) against it made
  // every character "meet" every armor, so check/speed penalties never applied.
  const meetsStr = !armor || mods.str >= armor.strength;
  const checkPenalty = armor && !meetsStr ? armor.checkPenalty : 0;
  const speedPenalty = armor ? (meetsStr ? Math.min(0, armor.speedPenalty + 5) : armor.speedPenalty) : 0;

  const perceptionRank = progressionRank(state, 'perception', ip?.perception ?? 0);
  const perception = pb(perceptionRank) + mods.wis + (abp ? abpPerception(level) : 0);

  const fortRank = progressionRank(state, 'fortitude', ip?.fortitude ?? 0);
  const refRank = progressionRank(state, 'reflex', ip?.reflex ?? 0);
  const willRank = progressionRank(state, 'will', ip?.will ?? 0);
  const classDCRank = progressionRank(state, 'classDC', ip?.classDC ?? 0);

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
      modifier: pb(rank) + mods[s.ability] + penalty,
    };
  });

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
    return {
      id: w.id,
      name: w.name,
      attack: pb(catRank) + attackMod + potency + (abp ? abpAttack(level) : 0),
      dice: abp ? abpDamageDice(level) : 1 + striking,
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
      fortitude: pb(fortRank) + mods.con + (abp ? abpResilience(level) : resilient),
      reflex: pb(refRank) + mods.dex + (abp ? abpResilience(level) : resilient),
      will: pb(willRank) + mods.wis + (abp ? abpResilience(level) : resilient),
    },
    classDc: 10 + pb(classDCRank) + (state.keyAbility ? mods[state.keyAbility] : 0),
    speed: (ancestry?.speed ?? 25) + speedPenalty,
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
      spellcasting: spellcastingRank,
      defenses,
      attacks,
    },
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
  const chosen = state.skillChoices.length;
  if (chosen < freePicks) problems.push(`Choose ${freePicks - chosen} more trained skill(s).`);
  // Also flag TOO MANY — e.g. picked at Int +3 then a boost moved off Int, so the
  // free-skill count shrank but the extra picks weren't trimmed. Without this the
  // build validates as complete and exports an illegal extra trained skill.
  if (chosen > freePicks)
    problems.push(`Deselect ${chosen - freePicks} trained skill(s) — more than your free skills allow (an Intelligence change likely reduced them).`);

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
