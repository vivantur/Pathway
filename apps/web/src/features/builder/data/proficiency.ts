// PF2e class proficiency progression — the level at which each class advances
// each save / Perception / class DC / spellcasting / armor proficiency.
//
// SOURCE OF TRUTH NOTE: this is the same table + lookup as
// `packages/core/src/proficiency.ts` (which carries the vitest coverage). It is
// vendored here because Vercel builds apps/web with Root Directory = apps/web
// and prunes sibling packages, so the @pathway/core workspace import isn't
// resolvable at build time. Keep the two files identical; when the monorepo
// build can resolve packages/core (Vercel "include files outside root", or a
// workspace-aware build), delete this copy and import from @pathway/core again.
//
// Data mechanically extracted from the Foundry VTT pf2e system (class items for
// the granted-feature levels; class feature rules text for the rank each grants,
// scoped to the per-class section of shared features). ORC-safe: only numeric
// ranks keyed by generic class ids — no names, flavor, or Product Identity.
//
// NOT modeled (deliberately, to avoid wrong numbers):
//   - Weapon/attack proficiency past level 1: increases are weapon-group- and
//     choice-scoped (e.g. Fighter Weapon Mastery applies to a chosen group), so
//     a class-wide attack progression would be incorrect. Callers keep the
//     class's level-1 weapon rank.
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
