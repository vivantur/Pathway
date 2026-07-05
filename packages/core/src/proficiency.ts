// PF2e class proficiency progression — the level at which each class advances
// each save / Perception / class DC / spellcasting / armor proficiency.
//
// Data mechanically extracted from the Foundry VTT pf2e system (class items for
// the granted-feature levels; class feature rules text for the rank each grants,
// scoped to the per-class section of shared features). ORC-safe: only numeric
// ranks keyed by generic class ids — no names, flavor, or Product Identity.
//
// NOT modeled (deliberately, to avoid wrong numbers):
//   - Weapon/attack proficiency past level 1 now lives in ATTACK_PROGRESSION
//     below (category-, list-, and group-scoped).
//   - Monk Path to Perfection: the player chooses which save advances, so it
//     cannot be applied statically; monk saves stay at their level-1 rank.
//   - Doctrine-/subclass-dependent branches beyond the base class grants.

export type ProficiencyRank = 0 | 1 | 2 | 3 | 4;

export type ProficiencyTrack =
  | "perception"
  | "fortitude"
  | "reflex"
  | "will"
  | "classDC"
  | "spellcasting"
  | "unarmored"
  | "light"
  | "medium"
  | "heavy";

/** A track's level-1 base rank plus its ascending [level, rank] increase points. */
export interface TrackProgression {
  base: ProficiencyRank;
  bumps: [level: number, rank: ProficiencyRank][];
}

export type ClassProgression = Record<ProficiencyTrack, TrackProgression>;

/** Keyed by builder class id (e.g. "fighter"). */
export const PROFICIENCY_PROGRESSION: Record<string, ClassProgression> = {
  alchemist: {
    perception: { base: 1, bumps: [[9,2]] },
    fortitude: { base: 2, bumps: [[11,3]] },
    reflex: { base: 2, bumps: [[15,3]] },
    will: { base: 1, bumps: [[7,2]] },
    classDC: { base: 1, bumps: [[9,2], [17,3]] },
    spellcasting: { base: 0, bumps: [] },
    unarmored: { base: 1, bumps: [[13,2], [19,3]] },
    light: { base: 1, bumps: [[13,2], [19,3]] },
    medium: { base: 1, bumps: [[13,2], [19,3]] },
    heavy: { base: 0, bumps: [] },
  },
  animist: {
    perception: { base: 1, bumps: [[9,2]] },
    fortitude: { base: 1, bumps: [[3,2]] },
    reflex: { base: 1, bumps: [[11,2]] },
    will: { base: 2, bumps: [[13,3]] },
    classDC: { base: 1, bumps: [] },
    spellcasting: { base: 1, bumps: [[7,2], [15,3], [19,4]] },
    unarmored: { base: 1, bumps: [[11,2]] },
    light: { base: 1, bumps: [[11,2]] },
    medium: { base: 1, bumps: [[11,2]] },
    heavy: { base: 0, bumps: [] },
  },
  barbarian: {
    perception: { base: 2, bumps: [[17,3]] },
    fortitude: { base: 2, bumps: [[7,3], [13,4]] },
    reflex: { base: 1, bumps: [[9,2]] },
    will: { base: 2, bumps: [[15,3]] },
    classDC: { base: 1, bumps: [[11,2], [19,3]] },
    spellcasting: { base: 0, bumps: [] },
    unarmored: { base: 1, bumps: [[13,2], [19,3]] },
    light: { base: 1, bumps: [[13,2], [19,3]] },
    medium: { base: 1, bumps: [[13,2], [19,3]] },
    heavy: { base: 0, bumps: [] },
  },
  bard: {
    perception: { base: 2, bumps: [[11,3]] },
    fortitude: { base: 1, bumps: [[9,2]] },
    reflex: { base: 1, bumps: [[3,2]] },
    will: { base: 2, bumps: [[9,3], [17,4]] },
    classDC: { base: 1, bumps: [] },
    spellcasting: { base: 1, bumps: [[7,2], [15,3], [19,4]] },
    unarmored: { base: 1, bumps: [[13,2]] },
    light: { base: 1, bumps: [[13,2]] },
    medium: { base: 0, bumps: [] },
    heavy: { base: 0, bumps: [] },
  },
  champion: {
    perception: { base: 1, bumps: [[11,2]] },
    fortitude: { base: 2, bumps: [[9,3]] },
    reflex: { base: 1, bumps: [[9,2]] },
    will: { base: 2, bumps: [[11,3]] },
    classDC: { base: 1, bumps: [[9,2], [17,3]] },
    spellcasting: { base: 1, bumps: [[9,2], [17,3]] },
    unarmored: { base: 1, bumps: [[7,2], [13,3], [17,4]] },
    light: { base: 1, bumps: [[7,2], [13,3], [17,4]] },
    medium: { base: 1, bumps: [[7,2], [13,3], [17,4]] },
    heavy: { base: 1, bumps: [[7,2], [13,3], [17,4]] },
  },
  cleric: {
    perception: { base: 1, bumps: [[5,2]] },
    fortitude: { base: 1, bumps: [] },
    reflex: { base: 1, bumps: [[11,2]] },
    will: { base: 2, bumps: [[9,3]] },
    classDC: { base: 1, bumps: [] },
    spellcasting: { base: 1, bumps: [] },
    unarmored: { base: 1, bumps: [[13,2]] },
    light: { base: 0, bumps: [] },
    medium: { base: 0, bumps: [] },
    heavy: { base: 0, bumps: [] },
  },
  druid: {
    perception: { base: 1, bumps: [[3,2]] },
    fortitude: { base: 1, bumps: [[3,2]] },
    reflex: { base: 1, bumps: [[5,2]] },
    will: { base: 2, bumps: [[11,3]] },
    classDC: { base: 1, bumps: [] },
    spellcasting: { base: 1, bumps: [[7,2], [15,3], [19,4]] },
    unarmored: { base: 1, bumps: [[13,2]] },
    light: { base: 1, bumps: [[13,2]] },
    medium: { base: 1, bumps: [[13,2]] },
    heavy: { base: 0, bumps: [] },
  },
  exemplar: {
    perception: { base: 1, bumps: [[9,2], [17,3]] },
    fortitude: { base: 2, bumps: [[15,3]] },
    reflex: { base: 1, bumps: [[9,2]] },
    will: { base: 2, bumps: [[7,3], [13,4]] },
    classDC: { base: 1, bumps: [[9,2], [17,3]] },
    spellcasting: { base: 0, bumps: [] },
    unarmored: { base: 1, bumps: [[13,2], [19,3]] },
    light: { base: 1, bumps: [[13,2], [19,3]] },
    medium: { base: 1, bumps: [[13,2], [19,3]] },
    heavy: { base: 0, bumps: [] },
  },
  fighter: {
    perception: { base: 2, bumps: [[7,3]] },
    fortitude: { base: 2, bumps: [[9,3]] },
    reflex: { base: 2, bumps: [[15,3]] },
    will: { base: 1, bumps: [[3,2]] },
    classDC: { base: 1, bumps: [[11,2], [19,3]] },
    spellcasting: { base: 0, bumps: [] },
    unarmored: { base: 1, bumps: [[11,2], [17,3]] },
    light: { base: 1, bumps: [[11,2], [17,3]] },
    medium: { base: 1, bumps: [[11,2], [17,3]] },
    heavy: { base: 1, bumps: [[11,2], [17,3]] },
  },
  gunslinger: {
    perception: { base: 2, bumps: [[7,3], [19,4]] },
    fortitude: { base: 2, bumps: [[17,3]] },
    reflex: { base: 2, bumps: [[11,3]] },
    will: { base: 1, bumps: [[3,2]] },
    classDC: { base: 1, bumps: [[9,2], [17,3]] },
    spellcasting: { base: 0, bumps: [] },
    unarmored: { base: 1, bumps: [[13,2], [19,3]] },
    light: { base: 1, bumps: [[13,2], [19,3]] },
    medium: { base: 1, bumps: [[13,2], [19,3]] },
    heavy: { base: 0, bumps: [] },
  },
  inventor: {
    perception: { base: 1, bumps: [[13,2]] },
    fortitude: { base: 2, bumps: [[17,3]] },
    reflex: { base: 1, bumps: [[7,2]] },
    will: { base: 2, bumps: [[11,3]] },
    classDC: { base: 1, bumps: [[9,2], [17,3]] },
    spellcasting: { base: 0, bumps: [] },
    unarmored: { base: 1, bumps: [[11,2], [19,3]] },
    light: { base: 1, bumps: [[11,2], [19,3]] },
    medium: { base: 1, bumps: [[11,2], [19,3]] },
    heavy: { base: 0, bumps: [] },
  },
  investigator: {
    perception: { base: 2, bumps: [[13,4]] },
    fortitude: { base: 1, bumps: [[9,2]] },
    reflex: { base: 2, bumps: [[15,3]] },
    will: { base: 2, bumps: [[11,3], [17,4]] },
    classDC: { base: 1, bumps: [[9,2], [19,3]] },
    spellcasting: { base: 0, bumps: [] },
    unarmored: { base: 1, bumps: [[13,2], [19,3]] },
    light: { base: 1, bumps: [[13,2], [19,3]] },
    medium: { base: 0, bumps: [] },
    heavy: { base: 0, bumps: [] },
  },
  kineticist: {
    perception: { base: 1, bumps: [[9,2]] },
    fortitude: { base: 2, bumps: [[7,3], [15,4]] },
    reflex: { base: 2, bumps: [[11,3]] },
    will: { base: 1, bumps: [[3,2]] },
    classDC: { base: 1, bumps: [[7,2], [15,3], [19,4]] },
    spellcasting: { base: 0, bumps: [] },
    unarmored: { base: 1, bumps: [[13,2], [19,3]] },
    light: { base: 1, bumps: [[13,2], [19,3]] },
    medium: { base: 0, bumps: [] },
    heavy: { base: 0, bumps: [] },
  },
  magus: {
    perception: { base: 1, bumps: [[9,2]] },
    fortitude: { base: 2, bumps: [[15,3]] },
    reflex: { base: 1, bumps: [[5,2]] },
    will: { base: 2, bumps: [[9,3]] },
    classDC: { base: 1, bumps: [] },
    spellcasting: { base: 1, bumps: [[9,2], [17,3]] },
    unarmored: { base: 1, bumps: [[11,2], [17,3]] },
    light: { base: 1, bumps: [[11,2], [17,3]] },
    medium: { base: 1, bumps: [[11,2], [17,3]] },
    heavy: { base: 0, bumps: [] },
  },
  // Impossible Playtest necromancer: Fort expert@1 master@11 legendary@17
  // (Unnatural Fortitude / Undying Resilience), Will expert@3 (Grim Wards),
  // Reflex expert@5, Perception expert@7, occult spells expert@7 master@15
  // legendary@19 (Expert/Master/Legendary Necromancy), light+unarmored
  // expert@13 (Light Armor Expertise).
  necromancer: {
    perception: { base: 1, bumps: [[7,2]] },
    fortitude: { base: 2, bumps: [[11,3], [17,4]] },
    reflex: { base: 1, bumps: [[5,2]] },
    will: { base: 1, bumps: [[3,2]] },
    classDC: { base: 1, bumps: [] },
    spellcasting: { base: 1, bumps: [[7,2], [15,3], [19,4]] },
    unarmored: { base: 1, bumps: [[13,2]] },
    light: { base: 1, bumps: [[13,2]] },
    medium: { base: 0, bumps: [] },
    heavy: { base: 0, bumps: [] },
  },
  monk: {
    perception: { base: 1, bumps: [[5,2]] },
    fortitude: { base: 2, bumps: [] },
    reflex: { base: 2, bumps: [] },
    will: { base: 2, bumps: [] },
    classDC: { base: 1, bumps: [[9,2], [17,3]] },
    spellcasting: { base: 0, bumps: [[9,2], [17,3]] },
    unarmored: { base: 2, bumps: [[13,3], [17,4]] },
    light: { base: 0, bumps: [] },
    medium: { base: 0, bumps: [] },
    heavy: { base: 0, bumps: [] },
  },
  oracle: {
    perception: { base: 1, bumps: [[11,2]] },
    fortitude: { base: 1, bumps: [[9,2]] },
    reflex: { base: 1, bumps: [[13,2]] },
    will: { base: 2, bumps: [[7,3], [17,4]] },
    classDC: { base: 1, bumps: [] },
    spellcasting: { base: 1, bumps: [[7,2], [15,3], [19,4]] },
    unarmored: { base: 1, bumps: [[13,2]] },
    light: { base: 1, bumps: [[13,2]] },
    medium: { base: 0, bumps: [] },
    heavy: { base: 0, bumps: [] },
  },
  psychic: {
    perception: { base: 1, bumps: [[11,2]] },
    fortitude: { base: 1, bumps: [[9,2]] },
    reflex: { base: 1, bumps: [[5,2]] },
    will: { base: 2, bumps: [[11,3], [17,4]] },
    classDC: { base: 1, bumps: [] },
    spellcasting: { base: 1, bumps: [[7,2], [15,3], [19,4]] },
    unarmored: { base: 1, bumps: [[13,2]] },
    light: { base: 0, bumps: [] },
    medium: { base: 0, bumps: [] },
    heavy: { base: 0, bumps: [] },
  },
  ranger: {
    perception: { base: 2, bumps: [[7,3], [15,4]] },
    fortitude: { base: 2, bumps: [[11,3]] },
    reflex: { base: 2, bumps: [[7,3], [15,4]] },
    will: { base: 1, bumps: [[3,2]] },
    classDC: { base: 1, bumps: [[17,3]] },
    spellcasting: { base: 0, bumps: [[9,2], [17,3]] },
    unarmored: { base: 1, bumps: [[11,2], [19,3]] },
    light: { base: 1, bumps: [[11,2], [19,3]] },
    medium: { base: 1, bumps: [[11,2], [19,3]] },
    heavy: { base: 0, bumps: [] },
  },
  rogue: {
    perception: { base: 2, bumps: [[7,3], [13,4]] },
    fortitude: { base: 1, bumps: [[9,2]] },
    reflex: { base: 2, bumps: [[7,3], [13,4]] },
    will: { base: 2, bumps: [[17,3]] },
    classDC: { base: 1, bumps: [[11,2], [19,3]] },
    spellcasting: { base: 0, bumps: [] },
    unarmored: { base: 1, bumps: [[13,2], [19,3]] },
    light: { base: 1, bumps: [[13,2], [19,3]] },
    medium: { base: 0, bumps: [] },
    heavy: { base: 0, bumps: [] },
  },
  sorcerer: {
    perception: { base: 1, bumps: [[11,2]] },
    fortitude: { base: 1, bumps: [[5,2]] },
    reflex: { base: 1, bumps: [[9,2]] },
    will: { base: 2, bumps: [[17,3]] },
    classDC: { base: 1, bumps: [] },
    spellcasting: { base: 1, bumps: [[7,2], [15,3], [19,4]] },
    unarmored: { base: 1, bumps: [[13,2]] },
    light: { base: 0, bumps: [] },
    medium: { base: 0, bumps: [] },
    heavy: { base: 0, bumps: [] },
  },
  summoner: {
    perception: { base: 1, bumps: [[3,2]] },
    fortitude: { base: 2, bumps: [[11,3]] },
    reflex: { base: 1, bumps: [[9,2]] },
    will: { base: 2, bumps: [[15,3]] },
    classDC: { base: 1, bumps: [] },
    spellcasting: { base: 1, bumps: [[9,2], [17,3]] },
    unarmored: { base: 1, bumps: [[11,2], [19,3]] },
    light: { base: 0, bumps: [] },
    medium: { base: 0, bumps: [] },
    heavy: { base: 0, bumps: [] },
  },
  swashbuckler: {
    perception: { base: 2, bumps: [[11,3]] },
    fortitude: { base: 1, bumps: [[3,2]] },
    reflex: { base: 2, bumps: [[7,3], [13,4]] },
    will: { base: 2, bumps: [[17,3]] },
    classDC: { base: 1, bumps: [[9,2], [19,3]] },
    spellcasting: { base: 0, bumps: [] },
    unarmored: { base: 1, bumps: [[13,2], [19,3]] },
    light: { base: 1, bumps: [[13,2], [19,3]] },
    medium: { base: 0, bumps: [] },
    heavy: { base: 0, bumps: [] },
  },
  thaumaturge: {
    perception: { base: 2, bumps: [] },
    fortitude: { base: 2, bumps: [[15,3]] },
    reflex: { base: 1, bumps: [[3,2]] },
    will: { base: 2, bumps: [[7,3], [13,4]] },
    classDC: { base: 1, bumps: [[9,2], [17,3]] },
    spellcasting: { base: 0, bumps: [] },
    unarmored: { base: 1, bumps: [[11,2], [19,3]] },
    light: { base: 1, bumps: [[11,2], [19,3]] },
    medium: { base: 1, bumps: [[11,2], [19,3]] },
    heavy: { base: 0, bumps: [] },
  },
  witch: {
    perception: { base: 1, bumps: [[11,2]] },
    fortitude: { base: 1, bumps: [[5,2]] },
    reflex: { base: 1, bumps: [[9,2]] },
    will: { base: 2, bumps: [[17,3]] },
    classDC: { base: 1, bumps: [] },
    spellcasting: { base: 1, bumps: [[7,2], [15,3], [19,4]] },
    unarmored: { base: 1, bumps: [[13,2]] },
    light: { base: 0, bumps: [] },
    medium: { base: 0, bumps: [] },
    heavy: { base: 0, bumps: [] },
  },
  wizard: {
    perception: { base: 1, bumps: [[11,2]] },
    fortitude: { base: 1, bumps: [[9,2]] },
    reflex: { base: 1, bumps: [[5,2]] },
    will: { base: 2, bumps: [[17,3]] },
    classDC: { base: 1, bumps: [] },
    spellcasting: { base: 1, bumps: [[7,2], [15,3], [19,4]] },
    unarmored: { base: 1, bumps: [[13,2]] },
    light: { base: 0, bumps: [] },
    medium: { base: 0, bumps: [] },
    heavy: { base: 0, bumps: [] },
  },
};

/**
 * The proficiency rank a class has in a given track at a given character level.
 * Returns the base (level-1) rank, upgraded by the last increase whose level is
 * at or below `level`. Unknown class/track → 0 (untrained).
 */
export function proficiencyRankAtLevel(
  classId: string,
  track: ProficiencyTrack,
  level: number,
): ProficiencyRank {
  const cls = PROFICIENCY_PROGRESSION[classId];
  const prog = cls?.[track];
  if (!prog) return 0;
  let rank: ProficiencyRank = prog.base;
  for (const [lvl, r] of prog.bumps) {
    if (level >= lvl) rank = r;
    else break;
  }
  return rank;
}

// ── Weapon / unarmed attack proficiency progression ─────────────────────────
//
// Extracted from the same machine-readable class-feature data as the table
// above (each class's Weapon Expertise / Mastery / Legend features; see the
// feature names in the comments). Base ranks come from each class's level-1
// initial proficiencies (callers take max(initial, track)), so tracks below
// carry ONLY the increase points.
//
// Scoping:
//  - Category tracks (unarmed/simple/martial/advanced) cover class-wide bumps.
//  - `namedWeapons` covers weapon-LIST bumps (rogue/bard/wizard lists).
//  - `chosenGroup` covers fighter's group-scoped Weapon Mastery / Weapon
//    Legend, and gunslinger's fixed firearm+crossbow scope via `fixedGroups`.
//  - Cleric doctrine and monk feat-based increases remain unmodeled (doctrine
//    is subclass work; feats are choice-scoped).

export type AttackCategory = "unarmed" | "simple" | "martial" | "advanced";

export interface AttackProgression {
  unarmed?: TrackProgression;
  simple?: TrackProgression;
  martial?: TrackProgression;
  advanced?: TrackProgression;
  /** Specific weapon names (lowercase) that ride their own track. */
  namedWeapons?: { names: string[]; track: TrackProgression };
  /**
   * Group-scoped overlay. `fixedGroups` (gunslinger: firearm/crossbow) applies
   * automatically; otherwise the player's chosen group (fighter) activates it.
   */
  chosenGroup?: {
    fixedGroups?: string[];
    simpleMartialUnarmed: TrackProgression;
    advanced: TrackProgression;
  };
}

const E5_M13: TrackProgression = { base: 0, bumps: [[5, 2], [13, 3]] };
const E11: TrackProgression = { base: 0, bumps: [[11, 2]] };

export const ATTACK_PROGRESSION: Record<string, AttackProgression> = {
  // Alchemical Weapon Expertise (7): simple weapons + bombs.
  alchemist: { simple: { base: 0, bumps: [[7, 2]] } },
  // Simple Weapon Expertise (11) — Foundry class feature levels.
  animist: { simple: E11, unarmed: E11 },
  // Brutality (5), Weapon Fury (13).
  barbarian: { unarmed: E5_M13, simple: E5_M13, martial: E5_M13 },
  // Bard Weapon Expertise (11): simple + a named list.
  bard: {
    simple: E11,
    namedWeapons: {
      names: ["longsword", "rapier", "sap", "shortbow", "shortsword", "whip"],
      track: E11,
    },
  },
  // Weapon Expertise (5), Weapon Mastery (13).
  champion: { unarmed: E5_M13, simple: E5_M13, martial: E5_M13 },
  // Cleric weapon increases are doctrine-scoped (warpriest) — not modeled here.
  cleric: {},
  // Druid Weapon Expertise (11).
  druid: { simple: E11, unarmed: E11 },
  // Weapon Expertise (5) + Divine Weapon Mastery (13) — Foundry feature levels,
  // standard martial pattern.
  exemplar: { unarmed: E5_M13, simple: E5_M13, martial: E5_M13 },
  // Fighter Weapon Mastery (5, chosen group), Weapon Legend (13: master
  // simple/martial + expert advanced class-wide; legendary/master in group),
  // Versatile Legend (19).
  fighter: {
    unarmed: { base: 0, bumps: [[19, 4]] },
    simple: { base: 0, bumps: [[13, 3], [19, 4]] },
    martial: { base: 0, bumps: [[13, 3], [19, 4]] },
    advanced: { base: 0, bumps: [[13, 2], [19, 3]] },
    chosenGroup: {
      simpleMartialUnarmed: { base: 0, bumps: [[5, 3], [13, 4]] },
      advanced: { base: 0, bumps: [[5, 2], [13, 3]] },
    },
  },
  // Gunslinger Weapon Mastery (5), Gunslinging Legend (13); firearm/crossbow
  // scope is fixed, not chosen.
  gunslinger: {
    unarmed: E5_M13,
    simple: E5_M13,
    martial: E5_M13,
    chosenGroup: {
      fixedGroups: ["firearm", "crossbow"],
      simpleMartialUnarmed: { base: 0, bumps: [[5, 3], [13, 4]] },
      advanced: { base: 0, bumps: [[5, 2], [13, 3]] },
    },
  },
  // Inventor Weapon Expertise (5), Inventor Weapon Mastery (13).
  inventor: { unarmed: E5_M13, simple: E5_M13, martial: E5_M13 },
  // Weapon Expertise (5), Weapon Mastery (13).
  investigator: { unarmed: E5_M13, simple: E5_M13, martial: E5_M13 },
  // Weapon Expertise (11).
  kineticist: { simple: E11, unarmed: E11 },
  // Weapon Expertise (5), Weapon Mastery (13).
  magus: { unarmed: E5_M13, simple: E5_M13, martial: E5_M13 },
  // Expert Strikes (5), Master Strikes (13).
  monk: { unarmed: E5_M13, simple: E5_M13 },
  // Weapon Expertise (11) — Impossible Playtest.
  necromancer: { simple: E11, unarmed: E11 },
  // Weapon Expertise (11).
  oracle: { simple: E11, unarmed: E11 },
  // Weapon Expertise (11).
  psychic: { simple: E11, unarmed: E11 },
  // Weapon Expertise (5), Weapon Mastery (13).
  ranger: { unarmed: E5_M13, simple: E5_M13, martial: E5_M13 },
  // Weapon Tricks (5), Master Tricks (13): simple + unarmed + a named list.
  rogue: {
    simple: E5_M13,
    unarmed: E5_M13,
    namedWeapons: { names: ["rapier", "sap", "shortbow", "shortsword"], track: E5_M13 },
  },
  // Simple Weapon Expertise (11).
  sorcerer: { simple: E11, unarmed: E11 },
  // Simple Weapon Expertise (11) — the summoner personally; the eidolon's own
  // track lives in the companion engine.
  summoner: { simple: E11, unarmed: E11 },
  // Weapon Expertise (5), Weapon Mastery (13).
  swashbuckler: { unarmed: E5_M13, simple: E5_M13, martial: E5_M13 },
  // Thaumaturge Weapon Expertise (5), Weapon Mastery (13).
  thaumaturge: { unarmed: E5_M13, simple: E5_M13, martial: E5_M13 },
  // Weapon Expertise (11).
  witch: { simple: E11, unarmed: E11 },
  // Wizard Weapon Expertise (11): ONLY the named list (simple stays trained).
  wizard: {
    namedWeapons: {
      names: ["club", "crossbow", "dagger", "heavy crossbow", "staff"],
      track: E11,
    },
  },
};

function trackRank(track: TrackProgression | undefined, level: number): ProficiencyRank {
  if (!track) return 0;
  let rank = track.base;
  for (const [lvl, r] of track.bumps) if (level >= lvl && r > rank) rank = r;
  return rank;
}

export interface WeaponRankQuery {
  category: AttackCategory;
  /** Weapon group (e.g. "sword") when known — enables group-scoped features. */
  group?: string;
  /** Lowercase weapon name — enables list-scoped features. */
  name?: string;
  /** The player's chosen weapon group (fighter's Weapon Mastery). */
  chosenGroup?: string;
}

/**
 * The attack proficiency rank a class grants for one weapon at a level, from
 * class features only (callers still take max() with the class's level-1
 * initial rank).
 */
export function attackRankAtLevel(
  classId: string,
  query: WeaponRankQuery,
  level: number,
): ProficiencyRank {
  const prog = ATTACK_PROGRESSION[classId];
  if (!prog) return 0;
  let rank = trackRank(prog[query.category], level);
  if (query.name && prog.namedWeapons?.names.includes(query.name)) {
    rank = Math.max(rank, trackRank(prog.namedWeapons.track, level)) as ProficiencyRank;
  }
  const g = prog.chosenGroup;
  if (g && query.group) {
    const inScope = g.fixedGroups
      ? g.fixedGroups.includes(query.group)
      : query.chosenGroup === query.group;
    if (inScope) {
      const overlay =
        query.category === "advanced" ? g.advanced : g.simpleMartialUnarmed;
      rank = Math.max(rank, trackRank(overlay, level)) as ProficiencyRank;
    }
  }
  return rank;
}
