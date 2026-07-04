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

// --------------------------------------------------------------------------
// Companion kinds — the full set of companion types the builder supports.
// --------------------------------------------------------------------------

export type CompanionKind = 'animal' | 'mount' | 'familiar' | 'eidolon' | 'custom';
export const COMPANION_KINDS: readonly CompanionKind[] = [
  'animal',
  'mount',
  'familiar',
  'eidolon',
  'custom',
];

// --------------------------------------------------------------------------
// Familiars — Player Core 1 (remaster): HP = 5 × level, AC and saves equal the
// master's, Speed 25 feet, and 2 familiar/master abilities per day by default
// (more via feats or class features). The ability list is sourced from
// machine-readable rules data; master abilities require abilities of the master
// (e.g. spellcasting).
// --------------------------------------------------------------------------

export interface FamiliarAbility {
  slug: string;
  name: string;
  master: boolean;
  description: string;
}

export const DEFAULT_FAMILIAR_ABILITY_COUNT = 2;

export const FAMILIAR_ABILITIES: FamiliarAbility[] = [
  { slug: "accompanist", name: "Accompanist", master: false, description: "Your familiar helps you perform. Whenever you attempt a Performance check, if your familiar is nearby and can act, it accompanies you with chirps, claps, or its own miniature instrument. This grants you a +1 circumstance bonus, or +2 if you're a master in Performance." },
  { slug: "alchemical-gut", name: "Alchemical Gut", master: false, description: "Choose one alchemical item with a level no higher than yours that has the distilling trait. Your familiar can act as the chosen item by swallowing consumables to be affected, which takes two Interact actions on its part and one from you. Instead of taking the normal time to distill the consumable, however, your familiar regurgitates the distilled item 1 round later." },
  { slug: "ambassador", name: "Ambassador", master: false, description: "Your familiar knows how to act cute or focused on cue, helping you make a good impression. Despite being a minion, your familiar gains 1 reaction at the start of its turns, which it can use only to Aid you on a Diplomacy check to Make an Impression (it still has to prepare to help you as normal for the Aid reaction, which requires it to participate throughout the activity). It automatically succeeds at its check to Aid you with those skills or automatically critically succeeds if you're a master of the skill in question." },
  { slug: "amphibious", name: "Amphibious", master: false, description: "It gains the amphibious trait, allowing it to breathe in both air and water, and has both a land Speed and a swim Speed, each equal to its highest land Speed or swim Speed." },
  { slug: "burrower", name: "Burrower", master: false, description: "It gains a burrow Speed of 5 feet, allowing it to dig Tiny holes." },
  { slug: "climber", name: "Climber", master: false, description: "It gains a climb Speed of 25 feet." },
  { slug: "construct", name: "Construct", master: false, description: "Your familiar has the construct trait instead of the animal trait. The familiar is immune to death effects, disease, doomed, drained, fatigued, healing, nonlethal attacks, paralyzed, poison, sickened, spirit, unconscious, vitality, and void. Your familiar must have the tough pet ability to select this." },
  { slug: "damage-avoidance", name: "Damage Avoidance", master: false, description: "Choose one type of save. Your familiar takes no damage when it rolls a success on that type of save; this doesn't prevent effects other than damage." },
  { slug: "darkeater", name: "Darkeater", master: false, description: "Your familiar naturally recovers in the shadows. After spending 10 consecutive minutes in an area of dim light or darkness, your familiar recovers a number of Hit Points equal to half your level." },
  { slug: "darkvision", name: "Darkvision", master: false, description: "It gains darkvision." },
  { slug: "dragon", name: "Dragon", master: false, description: "Your familiar has the dragon trait instead of the animal trait." },
  { slug: "echolocation", name: "Echolocation", master: false, description: "Your pet can use hearing as a precise sense within 20 feet." },
  { slug: "elemental", name: "Elemental", master: false, description: "Your familiar has the elemental trait instead of the animal trait. Choose air, earth, fire, metal, water, or wood. Your familiar gains that trait. The familiar is immune to persistent damage, paralyzed, poison, sleep, and the element matching its trait. Your familiar must have the resistance familiar ability to select this." },
  { slug: "fast-movement", name: "Fast Movement", master: false, description: "Increase one of the pet's Speeds from 25 feet to 40 feet." },
  { slug: "flier", name: "Flier", master: false, description: "It gains a fly Speed of 25 feet." },
  { slug: "focused-rejuvenation", name: "Focused Rejuvenation", master: false, description: "When you Refocus, you generate magical energy that heals your familiar. Your familiar regains 1 Hit Point per level whenever you Refocus." },
  { slug: "fungus", name: "Fungus", master: false, description: "Your familiar has the fungus trait instead of the animal trait." },
  { slug: "gills", name: "Gills", master: false, description: "Your familiar grows a set of gills, allowing it to breathe water in addition to air." },
  { slug: "greater-resistance", name: "Greater Resistance", master: false, description: "Your familiar increases the resistance it gains from its resistance familiar ability to 3 + half your level. Your familiar must have the resistance ability to select this." },
  { slug: "independent", name: "Independent", master: false, description: "In an encounter, if you don't Command an Animal your familiar, it still gains 1 action each round. Typically, you still decide how it spends that action, but, the GM might determine that your familiar chooses its own tactics rather than performing your preferred action. This doesn't work with valet or similar abilities that require a command, if you're capable of riding your familiar, or similar situations." },
  { slug: "kinspeech", name: "Kinspeech", master: false, description: "Your familiar can understand and speak with animals of the same species. To select this, your familiar must be an animal, it must have the speech ability, and you must be at least 6th level." },
  { slug: "lab-assistant", name: "Lab Assistant", master: false, description: "It can use your Quick Alchemy action. You must have Quick Alchemy, and your familiar must be in your space. This has the same cost and requirement as if you used it. It must have the manual dexterity ability to select this." },
  { slug: "levitator", name: "Levitator", master: false, description: "Using magnetism, magic, or other forces, your familiar can float up to 3 feet above solid and liquid surfaces while moving at a Speed of 25 feet. This allows it to ignore difficult terrain and damaging effects related to coming into direct contact with the surface. It typically allows the familiar to also avoid triggering the reactions of hazards that require you to step on them or an attached pressure plate." },
  { slug: "major-resistance", name: "Major Resistance", master: false, description: "Your familiar increases the resistance it gains from its resistance familiar ability to a value equal to your level. To select this you must be at least 8th level." },
  { slug: "manual-dexterity", name: "Manual Dexterity", master: false, description: "It can use up to two of its limbs as if they were hands to perform manipulate actions." },
  { slug: "mask-freeze", name: "Mask Freeze", master: false, description: "When in mask form, your familiar can hide its obvious supernatural qualities to pass as a simple, unassuming mask. It doesn't need to Impersonate to fool a passing glance, and it gains a +4 circumstance bonus to its Deception DC against an active observer Seek or otherwise studying it. This ability is available only to {@feat mask familiar.}" },
  { slug: "master-s-form", name: "Master's Form", master: false, description: "Your familiar can change shape as a single action, transforming into a humanoid of your ancestry with the same age, gender, and build of its true form, though it always maintains a clearly unnatural remnant of its nature, such as a cat's eyes or a serpent's tongue. This form is always the same each time it uses this ability. This otherwise uses the effects of humanoid form, except the change is purely cosmetic. It only appears humanoid and gains no new capabilities. Your familiar must have the manual dexterity and speech abilities to select this." },
  { slug: "partner-in-crime", name: "Partner in Crime", master: false, description: "Your familiar is your criminal associate. Despite being a minion, your familiar gains 1 reaction at the start of its turns, which it can use only to Aid you on a Deception or Thievery skill check (it still has to prepare to help you as normal for the Aid reaction). It automatically succeeds at its check to Aid you with those skills or automatically critically succeeds if you're a master of the skill in question." },
  { slug: "plant", name: "Plant", master: false, description: "Your familiar has the plant trait instead of the animal trait." },
  { slug: "plant-form", name: "Plant Form", master: false, description: "Your plant familiar can change shape as a single action, transforming into a Tiny plant of a type roughly similar to the familiar's nature. This otherwise uses the effects of one with plants. You must have a familiar with the plant trait to select this ability." },
  { slug: "poison-reservoir", name: "Poison Reservoir", master: false, description: "Your homunculus familiar has a reservoir for poison, allowing it to apply an injury poison to an adjacent ally's exposed weapon with a single Interact action. You must supply the poison and instill it into this reservoir using two consecutive Interact actions. You must have a homunculus familiar to select this ability." },
  { slug: "resistance", name: "Resistance", master: false, description: "Choose two of the following: acid, cold, electricity, fire, poison, or sonic. Your familiar gains resistance equal to half your level (minimum resistance 1) against the chosen damage types." },
  { slug: "scent", name: "Scent", master: false, description: "Your pet can use scent as an imprecise sense within 30 feet" },
  { slug: "second-opinion", name: "Second Opinion", master: false, description: "Your familiar is your academic confidant. Despite being a minion, your familiar gains 1 reaction at the start of its turns, which it can use only to Aid you on a Recall Knowledge skill check for a skill in which it has the skilled familiar ability (it still has to prepare to help you as normal for the Aid reaction). It automatically succeeds at its check to Aid you with those skills or automatically critically succeeds if you're a master of the skill in question. Your familiar must have the skilled ability to select this." },
  { slug: "shadow-step", name: "Shadow Step", master: false, description: "Your familiar gains the Shadow Step action. You must be at least 7th level to select this familiar ability for your familiar." },
  { slug: "skilled", name: "Skilled", master: false, description: "Choose a skill other than Acrobatics or Stealth. Your familiar's modifier for that skill is equal to your level plus your spellcasting attribute modifier, rather than just your level. You can select this ability repeatedly, choosing a different skill each time." },
  { slug: "snoop", name: "Snoop", master: false, description: "Your familiar keeps its eyes and ears open, ready to relay every snippet of gossip it catches, helping you gather information. Despite being a minion, your familiar gains 1 reaction at the start of its turns, which it can use only to Aid you on a Diplomacy check to Gather Information (it still has to prepare to help you as normal for the Aid reaction, which requires it to participate throughout the activity). It automatically succeeds at its check to Aid you with those skills or automatically critically succeeds if you're a master of the skill in question." },
  { slug: "speech", name: "Speech", master: false, description: "Your familiar understands and speaks a language you know." },
  { slug: "spellcasting", name: "Spellcasting", master: false, description: "Choose a spell in your repertoire or that you prepared today at least 5 levels lower than your highest-rank spell slot. Your familiar can Cast that Spell once per day using your magical tradition, spell attack modifier, and spell DC. If the spell has a drawback that affects the caster, both you and your familiar are affected. You must be able to cast 6th-rank spells using spell slots to select this." },
  { slug: "threat-display", name: "Threat Display", master: false, description: "Your familiar helps you convey wordless threats through body language. Whenever you attempt an Intimidation check to Demoralize a creature, if your familiar is within 30 feet of your target and can act, it accompanies you with snarls, hisses, or raising its hackles. If it can do so, you don't take the normal −4 penalty on the Intimidation check if your target doesn't understand the language you're speaking." },
  { slug: "toolbearer", name: "Toolbearer", master: false, description: "Your familiar can carry a toolkit of up to light Bulk. So long as your familiar is adjacent to you, you can draw and replace the tools as part of the action that uses them as if you were wearing them. Your familiar must have the manual dexterity ability to select this." },
  { slug: "touch-telepathy", name: "Touch Telepathy", master: false, description: "Your familiar can telepathically communicate with you via touch. If it also has the speech ability, it can telepathically communicate via touch with any creature if they share a language." },
  { slug: "tough", name: "Tough", master: false, description: "Your pet's max HP increase by 2 per level." },
  { slug: "tremorsense", name: "Tremorsense", master: false, description: "Your familiar is keenly aware of any vibrations traveling through a surface. It gains imprecise tremorsense with a range of 30 feet." },
  { slug: "valet", name: "Valet", master: false, description: "You can command your familiar to deliver you items more efficiently. Your familiar doesn't use its 2 actions immediately upon your command. Instead, up to twice before the end of your turn, you can have your familiar Interact to retrieve an item of light or negligible Bulk you are wearing and place it into one of your free hands. The familiar can't use this ability to retrieve stowed items. If the familiar has a different number of actions, it can retrieve one item for each action it has when commanded this way." },
  { slug: "wavesense", name: "Wavesense", master: false, description: "Your familiar can sense vibrations in the water. It gains imprecise wavesense with a range of 30 feet." },
  { slug: "absorb-familiar", name: "Absorb Familiar", master: true, description: "Your familiar can transform into a mark you carry on your flesh, typically seeming like a birthmark, tattoo, or gem that vaguely resembles its normal form. When transformed, the familiar can't act except to turn back into a familiar. It isn't affected by area effects and must be targeted separately to affect it, which requires knowledge that it's a creature. This means you and your allies can heal or assist the familiar while most enemies stay unaware of its true nature. Creatures must attempt a DC 20 Perception check to Seek to realize a it is actually a familiar. Your familiar can still communicate its feelings empathically. Transforming the familiar between forms is a 1-minute activity that has the concentrate trait." },
  { slug: "cantrip-connection", name: "Cantrip Connection", master: true, description: "You can prepare an additional cantrip or, if you have a repertoire, designate a cantrip to add to your repertoire every time you select this ability; you can retrain it but can't otherwise change it. You must be able to prepare cantrip or add them to your repertoire to select this." },
  { slug: "extra-reagents", name: "Extra Reagents", master: true, description: "Your familiar grows extra infused reagents on or in its body. You gain an additional batch of infused reagents. You must have the infused reagents ability to select this ability." },
  { slug: "familiar-focus", name: "Familiar Focus", master: true, description: "Once per day, your familiar can use 2 actions with the concentrate trait to restore 1 Focus Point to your focus pool, up to your usual maximum. You must have a focus pool to select this." },
  { slug: "innate-surge", name: "Innate Surge", master: true, description: "Once per day, you can draw upon your familiar's innate magic to replenish your own. You can cast one innate spell gained from an ancestry feat that you have already cast today. You must still Cast the Spell and meet the spell's other requirements." },
  { slug: "lifelink", name: "Lifelink", master: true, description: "If your familiar would be reduced to 0 HP by damage, as a reaction with the concentrate trait, you can take all the damage, and your familiar takes none. However, special effects that would occur due to that damage (such as snake venom) still apply." },
  { slug: "recall-familiar", name: "Recall Familiar", master: true, description: "Once per day, you can use a 3-action activity, which has the concentrate trait, to teleport your familiar to your space. Your familiar must be within 1 mile or the attempt to summon it fails. This is a teleportation effect." },
  { slug: "restorative-familiar", name: "Restorative Familiar", master: true, description: "Once per day, your familiar can use 2 actions with the concentrate trait to give up some of its energy and heal you. It must be in your space to do so. You restore a number of Hit Points equal to 1d8 times half your level (minimum 1d8)." },
  { slug: "share-senses", name: "Share Senses", master: true, description: "Once every 10 minutes, you can use a single action with the concentrate trait to project your senses into your familiar. When you do, you lose all sensory information from your own body, but can sense through your familiar's body for up to 1 minute. You can Dismiss this effect." },
  { slug: "spell-battery", name: "Spell Battery", master: true, description: "You gain one additional spell slot at least 3 ranks lower than your highest-rank spell slot; you must be able to cast 4th-rank spells using spell slots to select this master ability." },
  { slug: "spell-delivery", name: "Spell Delivery", master: true, description: "If your familiar is in your space, you can cast a spell with a range of touch, transfer its power to your familiar, and command the familiar to deliver the spell. If you do, the familiar uses its 2 actions for the round to move to a target of your choice and touch that target. If it doesn't reach the target to touch it this turn, the spell has no effect." },
  { slug: "tattoo-transformation", name: "Tattoo Transformation", master: true, description: "Your familiar can transform into a tattoo you carry on your flesh. When transformed into a tattoo, the familiar looks like a colorful and stylized version of itself and can't act except to turn back into a familiar. It isn't affected by area effects and must be targeted separately to affect it, which requires knowledge that it's a creature. This means you and your allies can heal or assist the familiar while most enemies stay unaware of its true nature. Creatures must attempt a DC 20 Perception check to Seek to realize a tattoo is actually a familiar (which few foes will try). Your familiar can still communicate its feelings empathically. Transforming into a tattoo or back to familiar form is a 1-minute activity that has the concentrate trait." },
];

export function findFamiliarAbility(slug: string): FamiliarAbility | undefined {
  return FAMILIAR_ABILITIES.find((a) => a.slug === slug);
}

/** A familiar's fixed base statistics; its AC and saves come from its master. */
export function familiarBaseStats(level: number): { hp: number; speed: number } {
  const lvl = Math.max(1, Math.min(20, Math.round(level)));
  return { hp: 5 * lvl, speed: 25 };
}

// --------------------------------------------------------------------------
// Eidolon subtypes — the base forms a summoner can manifest. Full eidolon stat
// scaling (it tracks the summoner's level and shares actions) is a later phase;
// these are the selectable subtypes for now.
// --------------------------------------------------------------------------

export interface EidolonType {
  slug: string;
  name: string;
}

export const EIDOLON_TYPES: EidolonType[] = [
  { slug: 'beast', name: 'Beast' },
  { slug: 'construct', name: 'Construct' },
  { slug: 'dragon', name: 'Dragon' },
  { slug: 'elemental', name: 'Elemental' },
  { slug: 'fey', name: 'Fey' },
  { slug: 'plant', name: 'Plant' },
  { slug: 'undead', name: 'Undead' },
  { slug: 'angel', name: 'Angel' },
  { slug: 'demon', name: 'Demon' },
  { slug: 'psychopomp', name: 'Psychopomp' },
  { slug: 'anger-phantom', name: 'Anger Phantom' },
  { slug: 'devotion-phantom', name: 'Devotion Phantom' },
];
