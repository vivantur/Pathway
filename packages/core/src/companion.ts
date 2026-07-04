// @pathway/core — Animal companion catalog + derived-stat engine.
//
// Pure PF2e domain: base companion types (a seed catalog) plus `scaleCompanion`,
// which derives a companion's statistics from its type, its handler's level, and
// its maturity form. No I/O.
//
// RULES SOURCE (non-negotiable per CLAUDE.md — implemented from rules text, not
// model memory): Pathfinder 2e Remaster, Player Core 1 "Animal Companions".
//   - Young baseline: an animal companion has the same level as its handler,
//     is trained in unarmored defense, unarmed attacks, all saves, Perception,
//     Acrobatics, Athletics, and its type's skill, and uses the handler's level
//     for proficiency. HP = (type HP + Con mod) per level. AC/attacks/saves are
//     computed like any creature: 10-or-level + proficiency (level + 2×rank) +
//     ability mod (+ item bonus to AC, max +3).
//   - Mature: +1 Str/Dex/Con/Wis; Perception + all saves (and the type skill)
//     become expert; unarmed damage goes from one die to two dice; grows one
//     size if Medium or smaller.
//   - Nimble: +2 Dex, +1 Str/Con/Wis; Acrobatics expert; +2 damage.
//   - Savage: +2 Str, +1 Dex/Con/Wis; Athletics expert; +3 damage; grows one
//     size if Medium or smaller.
//
// NOTE ON THE DISCORD BOT: the live bot (apps/bot .../companion/helpers.js
// `scaleCompanion`) uses an older approximation — young HP omits the Con mod,
// "specialized" bumps a die size instead of adding two dice + a flat bonus, and
// proficiency is level/level+2/level+4 rather than per-statistic ranks. Those
// are known legacy differences; when the bot adopts @pathway/core the numbers
// reconcile. Until then a companion's derived stats can differ slightly between
// the website (these correct values) and Discord. The stored sync DATA
// (base type, form, overrides) is identical either way.

export type CompanionForm = 'young' | 'mature' | 'nimble' | 'savage';
export const COMPANION_FORMS: readonly CompanionForm[] = ['young', 'mature', 'nimble', 'savage'];

export interface CompanionAbilityMods {
  str: number;
  dex: number;
  con: number;
  int: number;
  wis: number;
  cha: number;
}

export interface CompanionAttack {
  name: string;
  traits: string[];
  /** Base (young) damage die, e.g. "1d8". */
  damageDie: string;
  damageType: string;
}

/** A base animal-companion type (young statistics). */
export interface CompanionType {
  slug: string;
  name: string;
  size: string;
  /** Per-level HP base (added to the Con mod, times level). */
  hp: number;
  abilityMods: CompanionAbilityMods;
  /** The companion's trained skill (lowercase), e.g. "survival". */
  skill: string;
  speed: string;
  senses: string[];
  attacks: CompanionAttack[];
  support: string;
  source: string;
}

// Seed catalog — common, ORC-safe animal companions from Player Core 1 (remaster),
// extracted from machine-readable rules data. Slugs match the bot's catalog so a
// companion created on the web is recognized by the same `base_type` on Discord.
export const COMPANION_CATALOG: CompanionType[] = [
  {
    slug: "ape",
    name: "Ape",
    size: "small",
    hp: 8,
    abilityMods: { str: 3, dex: 1, con: 2, int: -4, wis: 2, cha: 0 },
    skill: "intimidation",
    speed: "walk 25 feet, climb 25 feet",
    senses: ["low-light vision"],
    attacks: [{ name: "fist", traits: [], damageDie: "1d8", damageType: "bludgeoning" }],
    support: "Your ape threatens your foes with menacing growls. Until the start of your next turn, if you hit and deal damage to a creature in your ape's reach, the creature becomes frightened.",
    source: "PC1",
  },
  {
    slug: "badger",
    name: "Badger",
    size: "small",
    hp: 8,
    abilityMods: { str: 2, dex: 2, con: 2, int: -4, wis: 2, cha: 0 },
    skill: "survival",
    speed: "walk 25 feet, burrow 10 feet, climb 10 feet",
    senses: ["low-light vision", "scent (imprecise, 30 feet)"],
    attacks: [{ name: "jaws", traits: [], damageDie: "1d8", damageType: "piercing" }, { name: "claw", traits: ["agile"], damageDie: "1d6", damageType: "slashing" }],
    support: "Your badger digs around your foe's position, interfering with its footing. Until the start of your next turn, if you hit and deal damage to a creature your badger threatens, the target can't use a Step action (unless it can Step through difficult terrain) until it moves from its current position.",
    source: "PC1",
  },
  {
    slug: "bat",
    name: "Bat",
    size: "small",
    hp: 6,
    abilityMods: { str: 2, dex: 3, con: 2, int: -4, wis: 1, cha: 0 },
    skill: "stealth",
    speed: "walk 15 feet, fly 30 feet",
    senses: ["echolocation 20 feet (the bat can use hearing as a precise sense within this range)", "low-light vision"],
    attacks: [{ name: "jaws", traits: ["finesse"], damageDie: "1d6", damageType: "piercing" }, { name: "wing", traits: ["agile", "finesse"], damageDie: "1d4", damageType: "slashing" }],
    support: "Your bat flaps around your foes' arms and faces, getting in the way of their attacks. Until the start of your next turn, creatures in your bat's reach that you damage with Strike take a −1 circumstance penalty to their attack rolls.",
    source: "PC1",
  },
  {
    slug: "bear",
    name: "Bear",
    size: "small",
    hp: 8,
    abilityMods: { str: 3, dex: 2, con: 2, int: -4, wis: 1, cha: 0 },
    skill: "intimidation",
    speed: "walk 35 feet",
    senses: ["low-light vision", "scent (imprecise, 30 feet)"],
    attacks: [{ name: "jaws", traits: [], damageDie: "1d8", damageType: "piercing" }, { name: "claw", traits: ["agile"], damageDie: "1d6", damageType: "slashing" }],
    support: "Your bear mauls your enemies when you create an opening. Until the start of your next turn, each time you hit a creature in the bear's reach with a Strike, the creature takes 1d8 slashing damage from the bear. If your bear is nimble or savage, the slashing damage increases to 2d8.",
    source: "PC1",
  },
  {
    slug: "bird",
    name: "Bird",
    size: "small",
    hp: 4,
    abilityMods: { str: 2, dex: 3, con: 1, int: -4, wis: 2, cha: 0 },
    skill: "stealth",
    speed: "walk 5 feet, fly 30 feet",
    senses: ["low-light vision"],
    attacks: [{ name: "jaws", traits: ["finesse"], damageDie: "1d6", damageType: "piercing" }, { name: "talon", traits: ["agile", "finesse"], damageDie: "1d4", damageType: "slashing" }],
    support: "The bird pecks at your foes' eyes when you create an opening. Until the start of your next turn, your Strike that damage a creature that your bird threatens also deal 1d4 persistent damage, and the target is dazzled until it removes the bleed damage. If your bird is nimble or savage, the persistent damage increases to 2d4.",
    source: "PC1",
  },
  {
    slug: "boar",
    name: "Boar",
    size: "small",
    hp: 8,
    abilityMods: { str: 3, dex: 1, con: 2, int: -4, wis: 2, cha: 0 },
    skill: "survival",
    speed: "walk 35 feet",
    senses: ["low-light vision", "scent (imprecise, 30 feet)"],
    attacks: [{ name: "tusk", traits: [], damageDie: "1d8", damageType: "piercing" }],
    support: "Your boar gores your foes. Until the start of your next turn, your Strike that damage a creature in your boar's reach also deal 1d6 persistent damage. If your boar is nimble or savage, the persistent damage increases to 2d6.",
    source: "PC1",
  },
  {
    slug: "cat",
    name: "Cat",
    size: "small",
    hp: 4,
    abilityMods: { str: 2, dex: 3, con: 1, int: -4, wis: 2, cha: 0 },
    skill: "stealth",
    speed: "walk 35 feet",
    senses: ["low-light vision", "scent (imprecise, 30 feet)"],
    attacks: [{ name: "jaws", traits: ["finesse"], damageDie: "1d6", damageType: "piercing" }, { name: "claw", traits: ["agile", "finesse"], damageDie: "1d4", damageType: "slashing" }],
    support: "Your cat throws your enemies off-balance when you create an opening. Until the start of your next turn, your Strike that deal damage to a creature within your cat's reach make the target off-guard until the end of your next turn.",
    source: "PC1",
  },
  {
    slug: "horse",
    name: "Horse",
    size: "medium",
    hp: 8,
    abilityMods: { str: 3, dex: 2, con: 2, int: -4, wis: 1, cha: 0 },
    skill: "survival",
    speed: "walk 40 feet",
    senses: ["low-light vision", "scent (imprecise, 30 feet)"],
    attacks: [{ name: "hoof", traits: ["agile"], damageDie: "1d6", damageType: "bludgeoning" }],
    support: "Until the start of your next turn, if you're mounted on your horse and moved 10 feet or more on the action before a melee Strike, add a circumstance bonus to damage for that Strike equal to twice the number of weapon damage dice. If your weapon already has the jousting weapon trait, increase the trait's damage bonus by 2 per die instead.",
    source: "PC1",
  },
  {
    slug: "snake",
    name: "Snake",
    size: "small",
    hp: 6,
    abilityMods: { str: 3, dex: 3, con: 1, int: -4, wis: 1, cha: 0 },
    skill: "stealth",
    speed: "walk 20 feet, climb 20 feet, swim 20 feet",
    senses: ["low-light vision", "scent (imprecise, 30 feet)"],
    attacks: [{ name: "jaws", traits: [], damageDie: "1d8", damageType: "piercing" }],
    support: "Your snake holds your enemies with its coils, interfering with reactions. Until the start of your next turn, any creature your snake threatens can't use reactions triggered by your actions unless its level is higher than yours.",
    source: "PC1",
  },
  {
    slug: "shark",
    name: "Shark",
    size: "small",
    hp: 6,
    abilityMods: { str: 3, dex: 2, con: 2, int: -4, wis: 1, cha: 0 },
    skill: "stealth",
    speed: "swim 40 feet",
    senses: ["blood scent", "scent (imprecise, 60 feet)"],
    attacks: [{ name: "jaws", traits: [], damageDie: "1d8", damageType: "piercing" }],
    support: "When your shark senses blood, it tears into your enemies. Until the start of your next turn, each time you hit a creature in the shark's reach with a Strike and deal slashing or piercing damage, the creature takes 1d8 slashing damage from the shark. If your shark is nimble or savage, the slashing damage increases to 2d8.",
    source: "PC1",
  },
  {
    slug: "wolf",
    name: "Wolf",
    size: "small",
    hp: 6,
    abilityMods: { str: 2, dex: 3, con: 2, int: -4, wis: 1, cha: 0 },
    skill: "survival",
    speed: "walk 40 feet",
    senses: ["low-light vision", "scent (imprecise, 30 feet)"],
    attacks: [{ name: "jaws", traits: ["finesse"], damageDie: "1d8", damageType: "piercing" }],
    support: "Your wolf tears tendons with each opening. Until the start of your next turn, your Strike that damage creatures your wolf threatens give the target a −5-foot status penalty to its Speeds for 1 minute (−10 on a critical success).",
    source: "PC1",
  },
  {
    slug: "scorpion",
    name: "Scorpion",
    size: "small",
    hp: 6,
    abilityMods: { str: 3, dex: 3, con: 1, int: -4, wis: 1, cha: 0 },
    skill: "stealth",
    speed: "walk 30 feet",
    senses: ["darkvision"],
    attacks: [{ name: "stinger", traits: [], damageDie: "1d6", damageType: "piercing" }, { name: "pincer", traits: ["agile"], damageDie: "1d6", damageType: "slashing" }],
    support: "Your scorpion drips poison from its stinger when you create an opening. Until the start of your next turn, your Strike that damage a creature in your scorpion's reach also deal 1d6 persistent damage. If your scorpion is nimble or savage, the persistent damage increases to 2d6.",
    source: "PC1",
  },
];

export function findCompanionType(slug: string): CompanionType | undefined {
  const s = slug.toLowerCase();
  return COMPANION_CATALOG.find((c) => c.slug === s);
}

// --------------------------------------------------------------------------
// Derived-stat engine
// --------------------------------------------------------------------------

const SIZE_ORDER = ['tiny', 'small', 'medium', 'large', 'huge', 'gargantuan'] as const;
const SKILL_ABILITY: Record<string, keyof CompanionAbilityMods> = {
  acrobatics: 'dex',
  arcana: 'int',
  athletics: 'str',
  crafting: 'int',
  deception: 'cha',
  diplomacy: 'cha',
  intimidation: 'cha',
  medicine: 'wis',
  nature: 'wis',
  occultism: 'int',
  performance: 'cha',
  religion: 'wis',
  society: 'int',
  stealth: 'dex',
  survival: 'wis',
  thievery: 'dex',
};

/** Cumulative ability-mod increases each form adds over the young baseline. */
const FORM_ABILITY_DELTA: Record<CompanionForm, Partial<CompanionAbilityMods>> = {
  young: {},
  mature: { str: 1, dex: 1, con: 1, wis: 1 },
  nimble: { str: 2, dex: 3, con: 2, wis: 2 },
  savage: { str: 3, dex: 2, con: 2, wis: 2 },
};

/** Flat damage a form adds to the companion's Strikes (beyond doubling dice). */
const FORM_DAMAGE_BONUS: Record<CompanionForm, number> = { young: 0, mature: 0, nimble: 2, savage: 3 };
/** How many size steps a form grows a Medium-or-smaller companion. */
const FORM_SIZE_STEPS: Record<CompanionForm, number> = { young: 0, mature: 1, nimble: 1, savage: 2 };

export interface ScaledAttack {
  name: string;
  traits: string[];
  attack: number;
  /** e.g. "2d8" — dice count doubles once the companion is mature or beyond. */
  damage: string;
  damageBonus: number;
  damageType: string;
}

export interface ScaledCompanion {
  slug: string;
  name: string;
  level: number;
  form: CompanionForm;
  size: string;
  abilityMods: CompanionAbilityMods;
  maxHp: number;
  ac: number;
  perception: number;
  saves: { fortitude: number; reflex: number; will: number };
  attacks: ScaledAttack[];
  skill: { name: string; modifier: number };
  speed: string;
  senses: string[];
}

/** Grow a size label by n steps, capped at gargantuan (only for Medium or smaller). */
function growSize(size: string, steps: number): string {
  const i = SIZE_ORDER.indexOf(size.toLowerCase() as (typeof SIZE_ORDER)[number]);
  if (i < 0 || steps <= 0) return size;
  // Only Medium or smaller grow (per the maturation rules).
  if (i > SIZE_ORDER.indexOf('medium')) return size;
  return SIZE_ORDER[Math.min(SIZE_ORDER.length - 1, i + steps)];
}

/** "1d8" → "2d8" (double the dice count). */
function doubleDice(die: string): string {
  const m = die.match(/^(\d+)(d\d+)$/i);
  if (!m) return die;
  return `${Number(m[1]) * 2}${m[2]}`;
}

/**
 * Derive a companion's statistics. `level` is the handler's level; proficiency
 * uses that level plus 2× the statistic's rank (trained = +2, expert = +4).
 * `itemAcBonus` covers barding (max +3 per the rules); default 0.
 */
export function scaleCompanion(
  type: CompanionType,
  level: number,
  form: CompanionForm,
  itemAcBonus = 0,
): ScaledCompanion {
  const lvl = Math.max(1, Math.min(20, Math.round(level)));
  const delta = FORM_ABILITY_DELTA[form];
  const mods: CompanionAbilityMods = {
    str: type.abilityMods.str + (delta.str ?? 0),
    dex: type.abilityMods.dex + (delta.dex ?? 0),
    con: type.abilityMods.con + (delta.con ?? 0),
    int: type.abilityMods.int,
    wis: type.abilityMods.wis + (delta.wis ?? 0),
    cha: type.abilityMods.cha,
  };

  const matured = form !== 'young';
  // Proficiency ranks (1 trained, 2 expert). Companions always use the handler's
  // level; only Perception, saves, and the type skill advance to expert.
  const acRank = 1; // unarmored defense stays trained (Remaster)
  const attackRank = 1; // unarmed attacks stay trained
  const advancedRank = matured ? 2 : 1;
  const prof = (rank: number) => lvl + 2 * rank;
  const itemAc = Math.max(0, Math.min(3, itemAcBonus));

  const maxHp = (type.hp + mods.con) * lvl;
  const ac = 10 + prof(acRank) + mods.dex + itemAc;
  const perception = prof(advancedRank) + mods.wis;
  const saves = {
    fortitude: prof(advancedRank) + mods.con,
    reflex: prof(advancedRank) + mods.dex,
    will: prof(advancedRank) + mods.wis,
  };

  const flatDamage = FORM_DAMAGE_BONUS[form];
  const attacks: ScaledAttack[] = type.attacks.map((a) => {
    const finesse = a.traits.includes('finesse');
    const attackAbility = finesse ? Math.max(mods.str, mods.dex) : mods.str;
    return {
      name: a.name,
      traits: a.traits,
      attack: prof(attackRank) + attackAbility,
      damage: matured ? doubleDice(a.damageDie) : a.damageDie,
      damageBonus: mods.str + flatDamage,
      damageType: a.damageType,
    };
  });

  const skillAbility = SKILL_ABILITY[type.skill] ?? 'str';
  const skill = { name: type.skill, modifier: prof(advancedRank) + mods[skillAbility] };

  return {
    slug: type.slug,
    name: type.name,
    level: lvl,
    form,
    size: growSize(type.size, FORM_SIZE_STEPS[form]),
    abilityMods: mods,
    maxHp,
    ac,
    perception,
    saves,
    attacks,
    skill,
    speed: type.speed,
    senses: type.senses,
  };
}
