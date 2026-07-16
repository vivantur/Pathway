import type { AbilityKey } from '@/features/builder/data';
import type { BuilderState } from './types';

/**
 * Mechanical effects a level-1 subclass choice has on the build. Kept focused on
 * effects that concretely change the numbers and are unambiguously correct:
 *  - a caster's magic tradition (sorcerer bloodline, witch patron)
 *  - a rogue's key ability (racket)
 *  - whether the subclass grants a focus spell (→ a focus point)
 * Situational/feat-like grants (rage damage, hunted-prey bonuses, kineticist
 * impulses) are surfaced via the subclass description for now.
 */
export type Tradition = 'arcane' | 'divine' | 'occult' | 'primal';

const SORCERER_TRADITION: Record<string, Tradition> = {
  aberrant: 'occult',
  angelic: 'divine',
  demonic: 'divine',
  diabolic: 'divine',
  draconic: 'arcane',
  elemental: 'primal',
  fey: 'primal',
  hag: 'occult',
  imperial: 'arcane',
  undead: 'divine',
};

const WITCH_TRADITION: Record<string, Tradition> = {
  'faiths-flamekeeper': 'divine',
  'the-inscribed-one': 'arcane',
  'the-resentment': 'occult',
  'silence-in-snow': 'primal',
  'spinner-of-threads': 'occult',
  'starless-shadow': 'occult',
  'wilding-steward': 'primal',
};

export const ROGUE_RACKET_ABILITY: Record<string, AbilityKey> = {
  ruffian: 'str',
  scoundrel: 'cha',
  thief: 'dex',
  mastermind: 'int',
};

/** Classes whose level-1 subclass grants a focus spell (and thus a focus point). */
const FOCUS_SUBCLASS_CLASSES = new Set([
  'druid',
  'sorcerer',
  'witch',
  'oracle',
  'bard',
  'psychic',
  // Impossible Playtest: each grim fascination's class feat grants a grave spell.
  'necromancer',
]);

/** The tradition a caster's subclass dictates, if any (else use the class default). */
export function subclassTradition(classId?: string, subclassId?: string): Tradition | undefined {
  if (!subclassId) return undefined;
  if (classId === 'sorcerer') return SORCERER_TRADITION[subclassId];
  if (classId === 'witch') return WITCH_TRADITION[subclassId];
  return undefined;
}

export function rogueRacketAbility(subclassId?: string): AbilityKey | undefined {
  return subclassId ? ROGUE_RACKET_ABILITY[subclassId] : undefined;
}

// ── Subclass-granted skill training ─────────────────────────────────────────
// Some level-1 subclass features train the character in a skill (the Gunslinger
// "Way Skill", verified against the Foundry pf2e class-feature rules the dataset
// is ingested from). A `choose` grant offers a pick the player resolves.
export interface SubclassSkillGrant {
  fixed?: string[];
  choose?: { key: string; options: string[] };
}

const SUBCLASS_SKILLS: Record<string, Record<string, SubclassSkillGrant>> = {
  gunslinger: {
    // Way Skill per Guns & Gears (Remaster): Drifter→Acrobatics, Sniper→Stealth,
    // Vanguard→Athletics, Pistolero→Deception or Intimidation.
    drifter: { fixed: ['acrobatics'] },
    sniper: { fixed: ['stealth'] },
    vanguard: { fixed: ['athletics'] },
    pistolero: { choose: { key: 'gunslinger-way', options: ['deception', 'intimidation'] } },
  },
};

/** The skill grant a build's level-1 subclass carries, if any. */
export function subclassSkillGrant(state: BuilderState): SubclassSkillGrant | undefined {
  if (!state.classId || !state.subclassId) return undefined;
  return SUBCLASS_SKILLS[state.classId]?.[state.subclassId];
}

/** Concrete skill ids a subclass trains: its fixed skills plus a resolved choice. */
export function subclassGrantedSkillIds(state: BuilderState): string[] {
  const g = subclassSkillGrant(state);
  if (!g) return [];
  const out = [...(g.fixed ?? [])];
  if (g.choose) {
    const chosen = state.subclassSkillChoices?.[g.choose.key];
    if (chosen && g.choose.options.includes(chosen)) out.push(chosen);
  }
  return out;
}

/** Level-1 focus points granted by the subclass choice (0 or 1). */
export function focusPoints(state: BuilderState): number {
  return state.classId && FOCUS_SUBCLASS_CLASSES.has(state.classId) && state.subclassId ? 1 : 0;
}

// The specific focus spell a subclass grants at level 1, where it's a clear,
// well-known mapping. (Other focus-granting subclasses still grant a focus
// point above; their spell is surfaced via the subclass description.)
const SUBCLASS_FOCUS_SPELL: Record<string, Record<string, string>> = {
  necromancer: {
    'bone-shaper': 'Bone Spear',
    'flesh-magician': 'Dead Weight',
    'spirit-monger': 'Life Tap',
  },
  druid: { animal: 'Heal Animal', leaf: 'Goodberry', storm: 'Tempest Surge', untamed: 'Untamed Form' },
  sorcerer: {
    aberrant: 'Tentacular Limbs',
    angelic: 'Angelic Halo',
    demonic: "Glutton's Jaw",
    diabolic: 'Diabolic Edict',
    draconic: 'Dragon Claws',
    elemental: 'Elemental Toss',
    fey: 'Faerie Dust',
    hag: 'Jealous Hex',
    imperial: 'Ancestral Memories',
    undead: 'Touch of Undeath',
  },
};

export function grantedFocusSpell(classId?: string, subclassId?: string): string | undefined {
  if (!classId || !subclassId) return undefined;
  return SUBCLASS_FOCUS_SPELL[classId]?.[subclassId];
}

/** Armor proficiency a subclass grants beyond the class default (e.g. Ruffian → medium). */
export function subclassArmorRank(state: BuilderState, category: string): number {
  if (state.classId === 'rogue' && state.subclassId === 'ruffian' && category === 'medium') return 1;
  return 0;
}

// ── Cleric doctrines ────────────────────────────────────────────────────────
// Proficiency schedules from the doctrine class features (remaster; the CRB
// and Player Core numbers agree except warpriest's 3rd doctrine, which in the
// remaster also raises MARTIAL weapons to expert). Favored-weapon-specific
// grants (crit spec, warpriest's master favored weapon at 19th) need a deity
// system and are not modeled yet.
//   Cloistered: Fort expert@3 · divine spells expert@7 / master@15 / legendary@19
//               · simple+unarmed expert@11
//   Warpriest:  light+medium armor trained@1 (expert@13 with Divine Defense)
//               · Fort expert@1, master@15 · martial trained@3, expert@7
//               · simple+unarmed expert@7 · divine spells expert@11 / master@19

type Bumps = [level: number, rank: number][];
const bumpRank = (bumps: Bumps, level: number): number => {
  let r = 0;
  for (const [lvl, rank] of bumps) if (level >= lvl && rank > r) r = rank;
  return r;
};

const DOCTRINE_TRACKS: Record<string, Record<string, Bumps>> = {
  'cloistered-cleric': {
    fortitude: [[3, 2]],
    spellcasting: [[7, 2], [15, 3], [19, 4]],
  },
  warpriest: {
    fortitude: [[1, 2], [15, 3]],
    light: [[1, 1], [13, 2]],
    medium: [[1, 1], [13, 2]],
    spellcasting: [[11, 2], [19, 3]],
  },
};

const DOCTRINE_ATTACKS: Record<string, Record<string, Bumps>> = {
  'cloistered-cleric': { simple: [[11, 2]], unarmed: [[11, 2]] },
  warpriest: { martial: [[3, 1], [7, 2]], simple: [[7, 2]], unarmed: [[7, 2]] },
};

/** Proficiency rank a cleric doctrine grants on a track at a level (0 if none). */
export function doctrineTrackRank(state: BuilderState, track: string, level: number): number {
  if (state.classId !== 'cleric' || !state.subclassId) return 0;
  return bumpRank(DOCTRINE_TRACKS[state.subclassId]?.[track] ?? [], level);
}

/** Attack proficiency rank a cleric doctrine grants for a weapon category. */
export function doctrineAttackRank(state: BuilderState, category: string, level: number): number {
  if (state.classId !== 'cleric' || !state.subclassId) return 0;
  return bumpRank(DOCTRINE_ATTACKS[state.subclassId]?.[category] ?? [], level);
}

// ── Monk Paths to Perfection ────────────────────────────────────────────────
// Path to Perfection (7th): chosen save → master. Second Path (11th): a
// DIFFERENT save → master. Third Path (15th): one of the two chosen saves →
// legendary. (The success→critical-success riders are display-level effects.)

export type SaveTrack = 'fortitude' | 'reflex' | 'will';

export function monkPathSaveRank(state: BuilderState, track: string, level: number): number {
  if (state.classId !== 'monk') return 0;
  const p = state.monkPaths ?? {};
  let rank = 0;
  if (level >= 7 && p.first === track) rank = 3;
  if (level >= 11 && p.second === track) rank = Math.max(rank, 3);
  if (level >= 15 && p.third === track && (p.first === track || p.second === track)) rank = 4;
  return rank;
}
