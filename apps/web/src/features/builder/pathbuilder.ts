import {
  findAncestry,
  findBackground,
  findClass,
  findHeritage,
  findItem,
  findSpell,
  getDataset,
  type AbilityKey,
} from '@/features/builder/data';
import type {
  Ability,
  PathbuilderBuild as PathbuilderData,
} from '@/features/characters/pathbuilder';
import {
  casterConfig,
  focusConfig,
  focusPoolSize,
  focusRank,
  focusTraditionFor,
  resolveCasterTradition,
} from './spellcasting';
import { focusPoints } from './subclassEffects';
import { abilityModifier, bonusFeatSlots, deriveCharacter, trainedSkillIds } from '@/features/builder/rules';
import type { BuilderState, InnateSpellEntry, SpellTradition } from '@/features/builder/types';

const TRADITIONS: SpellTradition[] = ['arcane', 'divine', 'occult', 'primal'];

/**
 * Pathbuilder v2 export shape — what `toPathbuilder` EMITS. The Pathway bot
 * reads `pathbuilder_data.build ?? pathbuilder_data`, so we emit `{ success,
 * build }` to match a real Pathbuilder export and round-trip through the bot.
 *
 * Proficiencies are the Pathbuilder convention: 0/2/4/6/8 (2×rank, WITHOUT the
 * level term — the bot re-derives the level part). Abilities are final scores.
 *
 * This is the SAME format the character sheet reads, so it is derived from that
 * reader type (`PathbuilderData` in features/characters/pathbuilder.ts) rather
 * than duplicated. Deriving it means a shared field's type has one definition:
 * the two can no longer drift the way `acTotal` once did (only the sheet's copy
 * declared it — 449ad40). Two fields are shaped differently on the writer side
 * and overridden; the rest, `acTotal` included, come straight from the reader.
 */
export type PathbuilderBuild = Omit<
  PathbuilderData,
  'keyability' | 'spellCasters' | 'specificProficiencies'
> & {
  /** '' on a class-less draft; external Pathbuilder JSON always has a real key ability. */
  keyability?: Ability | '';
  /** Built ad hoc as plain objects; the reader types these as the richer Spellcaster it renders. */
  spellCasters?: unknown[];
  specificProficiencies?: { trained: string[]; expert: string[]; master: string[]; legendary: string[] };
  /** Pathbuilder-format fields the reader type doesn't model yet. */
  sizeName?: string;
  specials?: string[];
  /** Pathway provenance tag the bot understands. */
  _pathwaySource?: string;
};

export interface PathbuilderExport {
  success: true;
  build: PathbuilderBuild;
}

const SIZE_TO_NUMBER: Record<string, number> = {
  tiny: 0,
  small: 1,
  medium: 2,
  large: 3,
  huge: 4,
  gargantuan: 5,
};

const SIZE_NAME: Record<string, string> = {
  tiny: 'Tiny',
  small: 'Small',
  medium: 'Medium',
  large: 'Large',
  huge: 'Huge',
  gargantuan: 'Gargantuan',
};

/** 2×rank for the Pathbuilder proficiency convention. */
const p = (rank: number): number => rank * 2;

export function toPathbuilder(state: BuilderState): PathbuilderExport {
  const ancestry = state.ancestryId ? findAncestry(state.ancestryId) : undefined;
  const heritage = findHeritage(state.ancestryId, state.heritageId);
  const background = state.backgroundId ? findBackground(state.backgroundId) : undefined;
  const klass = state.classId ? findClass(state.classId) : undefined;
  const subclass = klass?.subclasses?.find((s) => s.id === state.subclassId);
  const derived = deriveCharacter(state);
  const ip = klass?.initialProficiencies;
  const trained = trainedSkillIds(state);

  const skillProf: Record<string, number> = {};
  // Lore skills carry `lore:*` ids and belong in the `lores` array below, not
  // in the standard skill-proficiency map.
  for (const s of derived.skills) {
    if (s.id.startsWith('lore:')) continue;
    skillProf[s.id] = p(s.rank);
  }

  const specials: string[] = [];
  if (heritage) specials.push(heritage.name);
  if (subclass) specials.push(subclass.name);

  const feats: [string, string | null, string, number][] = [];
  const push = (id: string | undefined, type: string, level: number) => {
    if (!id) return;
    feats.push([featName(id), null, type, level]);
  };
  // Level 1 (from the creation steps).
  push(state.ancestryFeatId, 'Ancestry', 1);
  push(state.ancestryParagonFeatId, 'Ancestry', 1); // Ancestry Paragon bonus feat
  push(state.classFeatId, 'Class', 1);
  if (background?.skillFeat) push(background.skillFeat, 'Skill', 1);
  // Bonus feats granted by another choice (Natural Ambition, General Training,
  // Ancestral Paragon, Multitalented, …), tagged by kind and granting level.
  const BONUS_KIND_TYPE: Record<string, string> = {
    class: 'Class',
    general: 'General',
    ancestry: 'Ancestry',
    dedication: 'Archetype',
  };
  for (const slot of bonusFeatSlots(state)) {
    push(state.bonusFeatChoices?.[slot.key], BONUS_KIND_TYPE[slot.kind] ?? 'Class', slot.level);
  }
  // Levels 2–20 (from the progression record).
  for (const [lvlStr, gains] of Object.entries(state.progression)) {
    const lvl = Number(lvlStr);
    if (lvl > state.level) continue;
    push(gains.classFeatId, 'Class', lvl);
    push(gains.ancestryFeatId, 'Ancestry', lvl);
    push(gains.skillFeatId, 'Skill', lvl);
    push(gains.generalFeatId, 'General', lvl);
    push(gains.archetypeFeatId, 'Archetype', lvl);
  }

  // Every trained Lore (background-granted + player-chosen), named the
  // Pathbuilder way (subject without a trailing "Lore") with its proficiency.
  const lores: [string, number][] = derived.skills
    .filter((s) => s.id.startsWith('lore:'))
    .map((s) => [s.name.replace(/\s+Lore$/i, ''), p(s.rank)]);

  const proficiencies: Record<string, number> = {
    classDC: p(ip?.classDC ?? 0),
    perception: p(ip?.perception ?? 0),
    fortitude: p(ip?.fortitude ?? 0),
    reflex: p(ip?.reflex ?? 0),
    will: p(ip?.will ?? 0),
    heavy: p(ip?.defenses.heavy ?? 0),
    medium: p(ip?.defenses.medium ?? 0),
    light: p(ip?.defenses.light ?? 0),
    unarmored: p(ip?.defenses.unarmored ?? 0),
    advanced: p(ip?.attacks.advanced ?? 0),
    martial: p(ip?.attacks.martial ?? 0),
    simple: p(ip?.attacks.simple ?? 0),
    unarmed: p(ip?.attacks.unarmed ?? 0),
    castingArcane: 0,
    castingDivine: 0,
    castingOccult: 0,
    castingPrimal: 0,
    ...skillProf,
  };

  const size = ancestry?.size ?? 'medium';

  // Money split into coins from the gp total.
  const totalCp = Math.round((state.money ?? 0) * 100);
  const money = {
    pp: 0,
    gp: Math.floor(totalCp / 100),
    sp: Math.floor((totalCp % 100) / 10),
    cp: totalCp % 10,
  };

  // Equipped weapons (with attack/damage) and armor; the rest go in equipment.
  const STRIKING_NAMES = ['', 'striking', 'greaterStriking', 'majorStriking'];
  const RESILIENT_NAMES = ['', 'resilient', 'greaterResilient', 'majorResilient'];
  const runesOf = (itemId: string) =>
    (state.inventory ?? []).find((e) => e.equipped && e.itemId === itemId)?.runes;
  const weaponsOut = derived.weapons.map((w) => {
    const item = findItem(w.id);
    const r = runesOf(w.id);
    const striking = Math.max(0, Math.min(3, r?.striking ?? 0));
    return {
      name: w.name,
      qty: 1,
      prof: item && item.kind === 'weapon' ? item.category : 'martial',
      die: w.damageDie,
      damageType: w.damageType,
      attack: w.attack,
      damageBonus: w.damageMod,
      pot: Math.max(0, Math.min(3, r?.potency ?? 0)),
      runes: striking ? [STRIKING_NAMES[striking]] : [],
      display: w.name,
    };
  });
  const equippedArmor = (state.inventory ?? [])
    .map((e) => (e.equipped ? findItem(e.itemId) : undefined))
    .find((i) => i?.kind === 'armor');
  const armorRunes = equippedArmor ? runesOf(equippedArmor.id) : undefined;
  const armorResilient = Math.max(0, Math.min(3, armorRunes?.resilient ?? 0));
  const armorOut =
    equippedArmor && equippedArmor.kind === 'armor'
      ? [{
          name: equippedArmor.name,
          qty: 1,
          prof: equippedArmor.category,
          worn: true,
          pot: Math.max(0, Math.min(3, armorRunes?.potency ?? 0)),
          res: armorResilient ? RESILIENT_NAMES[armorResilient] : '',
          display: equippedArmor.name,
        }]
      : [];
  const equipmentOut = (state.inventory ?? [])
    .filter((e) => {
      const it = findItem(e.itemId);
      return !(it && (it.kind === 'weapon' || it.kind === 'armor') && e.equipped);
    })
    .map((e) => [findItem(e.itemId)?.name ?? e.itemId, e.qty] as [string, number]);

  // Spellcasting → Pathbuilder spellCasters entry (spell lists by rank, cantrips at 0).
  const caster = casterConfig(state.classId, state.subclassId);
  const sc = state.spellcasting;
  const spellName = (id: string) => findSpell(id)?.name ?? id;
  const spellCastersOut =
    caster && sc
      ? [
          {
            name: klass?.name ?? 'Spellcaster',
            magicTradition: resolveCasterTradition(state) ?? caster.tradition ?? 'arcane',
            spellcastingType: caster.type,
            ability: caster.keyAbility,
            proficiency: 2, // trained at level 1
            // Pathbuilder convention: the focus pool rides on the caster entry.
            focusPoints: Math.max(focusPoolSize(state), focusPoints(state)),
            spells: [
              { spellLevel: 0, list: (sc.cantrips ?? []).map(spellName) },
              ...Object.entries(sc.spellsByRank ?? {})
                .map(([rank, ids]) => ({ spellLevel: Number(rank), list: ids.map(spellName) }))
                .filter((g) => g.list.length > 0),
            ],
            prepared: [],
            blendedSpells: [],
          },
        ]
      : [];

  // Focus spells → Pathbuilder `focus` map: tradition → ability → pool. The
  // sheet computes focus attack/DC as level + proficiency + abilityBonus, so we
  // store proficiency as 2×rank (Pathbuilder convention) and the ability mod.
  const focusCfg = focusConfig(state.classId, state.subclassId);
  const focusTradition = focusTraditionFor(state);
  const focusOut: Record<
    string,
    Record<string, { focusSpells: string[]; focusCantrips: string[]; proficiency: number; abilityBonus: number }>
  > = {};
  if (focusCfg && focusTradition) {
    const fSpells = (sc.focusSpells ?? []).map(spellName);
    const fCantrips = (sc.focusCantrips ?? []).map(spellName);
    if (fSpells.length || fCantrips.length) {
      focusOut[focusTradition] = {
        [focusCfg.keyAbility]: {
          focusSpells: fSpells,
          focusCantrips: fCantrips,
          proficiency: p(focusRank(state)),
          abilityBonus: abilityModifier(derived.scores[focusCfg.keyAbility]),
        },
      };
    }
  }

  // Innate spells → one Pathbuilder spellCasters entry per tradition, flagged
  // `innate` so the sheet's Innate Spells panel renders them (names grouped by
  // rank; perDay indexed by rank). Innate spells default to Charisma, trained.
  const innateByTradition = new Map<string, InnateSpellEntry[]>();
  for (const e of state.innateSpells ?? []) {
    const arr = innateByTradition.get(e.tradition) ?? [];
    arr.push(e);
    innateByTradition.set(e.tradition, arr);
  }
  const innateCastersOut = [...innateByTradition.entries()].map(([tradition, entries]) => {
    const byRank = new Map<number, string[]>();
    const perDay: number[] = [];
    for (const e of entries) {
      const spell = findSpell(e.spellId);
      if (!spell) continue;
      const rank = spell.traits.includes('cantrip') ? 0 : spell.rank;
      const list = byRank.get(rank) ?? [];
      list.push(spell.name);
      byRank.set(rank, list);
      perDay[rank] = Math.max(perDay[rank] ?? 0, e.perDay);
    }
    return {
      name: 'Innate Spells',
      innate: true,
      magicTradition: tradition,
      spellcastingType: 'innate',
      ability: 'cha',
      proficiency: 2,
      focusPoints: 0,
      perDay,
      spells: [...byRank.entries()].map(([spellLevel, list]) => ({ spellLevel, list })),
      prepared: [],
      blendedSpells: [],
    };
  });

  const build: PathbuilderBuild = {
    name: state.name || 'Unnamed Adventurer',
    class: klass?.name ?? '',
    dualClass: null,
    level: state.level,
    ancestry: ancestry?.name ?? '',
    heritage: heritage?.name ?? '',
    background: background?.name ?? '',
    alignment: 'N',
    gender: '',
    age: '',
    deity: '',
    size: SIZE_TO_NUMBER[size] ?? 2,
    sizeName: SIZE_NAME[size] ?? 'Medium',
    keyability: state.keyAbility ?? klass?.keyAbility[0] ?? '',
    languages: [...(ancestry?.languages ?? []), ...state.languageChoices],
    attributes: {
      ancestryhp: ancestry?.hp ?? 0,
      classhp: klass?.hp ?? 0,
      bonushp: 0,
      bonushpPerLevel: 0,
      speed: ancestry?.speed ?? 25,
      speedBonus: 0,
    },
    abilities: { ...derived.scores },
    proficiencies,
    feats,
    specials,
    lores,
    equipment: equipmentOut,
    specificProficiencies: { trained: [...trained], expert: [], master: [], legendary: [] },
    weapons: weaponsOut,
    money,
    armor: armorOut,
    spellCasters: [...spellCastersOut, ...innateCastersOut],
    // Pool size = focus spells known (max 3); keep any subclass-granted point too.
    focusPoints: Math.max(focusPoolSize(state), focusPoints(state)),
    focus: focusOut,
    formula: [],
    pets: [],
    familiars: [],
    // AC is the one derived stat no consumer of this JSON can recompute from it:
    // it needs the equipped armor, that armor's Dex cap, and its potency rune,
    // none of which the readers resolve. The character sheet and the bot both
    // just read `acTotal.acTotal`, so a build saved without it has no AC at all
    // (the sheet renders blank, `{{ac}}` had to guess, combat gets null).
    // Pathbuilder emits this field too, so writing it also makes our export
    // more faithful. The value excludes the shield, matching how the sheet adds
    // `shieldBonus` only while the shield is raised.
    acTotal: {
      acTotal: derived.ac,
      shieldBonus: derived.shieldBonus,
    },
    _pathwaySource: 'pathway-web',
  };

  return { success: true, build };
}

function featName(id: string): string {
  return getDataset().feats.find((f) => f.id === id)?.name ?? id;
}

/** True when the stored build carries a full embedded BuilderState (built here). */
export function hasEmbeddedBuild(data: unknown): boolean {
  const build = (data as { build?: PathbuilderBuild })?.build ?? (data as PathbuilderBuild);
  const embedded = (build as { _pathwayBuild?: unknown })?._pathwayBuild;
  return Boolean(embedded && typeof embedded === 'object');
}

/**
 * Best-effort import: map a Pathbuilder build back onto our BuilderState by
 * matching names to dataset ids. Unknown fields are dropped (logged by caller).
 */
export function fromPathbuilder(data: unknown): Partial<BuilderState> {
  const build = (data as { build?: PathbuilderBuild })?.build ?? (data as PathbuilderBuild);
  if (!build || typeof build !== 'object') return {};
  // Lossless path: characters built here embed their full BuilderState, so
  // re-opening for edit/level-up restores every choice exactly.
  const embedded = (build as { _pathwayBuild?: BuilderState })._pathwayBuild;
  if (embedded && typeof embedded === 'object' && embedded.name !== undefined) return embedded;
  const ds = getDataset();
  const byName = <T extends { id: string; name: string }>(list: T[], name?: string) =>
    list.find((x) => x.name.toLowerCase() === (name ?? '').toLowerCase())?.id;
  const spellIdByName = (name: string) =>
    ds.spells.find((s) => s.name.toLowerCase() === name.toLowerCase())?.id;

  const ancestryId = byName(ds.ancestries, build.ancestry);
  const ancestry = ancestryId ? findAncestry(ancestryId) : undefined;
  const heritageName = (build.heritage ?? '').toLowerCase();
  const heritageId =
    ancestry?.heritages.find((h) => h.name.toLowerCase() === heritageName)?.id ??
    ds.versatileHeritages.find((h) => h.name.toLowerCase() === heritageName)?.id;

  // Best-effort focus-spell import (names → dataset ids) for external Pathbuilder
  // JSON. Characters built here round-trip losslessly via `_pathwayBuild` above.
  const focusData = (
    build as { focus?: Record<string, Record<string, { focusSpells?: string[]; focusCantrips?: string[] }>> }
  ).focus;
  let spellcasting: BuilderState['spellcasting'] | undefined;
  if (focusData && typeof focusData === 'object') {
    const focusSpells: string[] = [];
    const focusCantrips: string[] = [];
    let focusTradition: string | undefined;
    for (const [tradition, byAbility] of Object.entries(focusData)) {
      for (const pool of Object.values(byAbility)) {
        for (const n of pool.focusSpells ?? []) {
          const id = spellIdByName(n);
          if (id) focusSpells.push(id);
        }
        for (const n of pool.focusCantrips ?? []) {
          const id = spellIdByName(n);
          if (id) focusCantrips.push(id);
        }
        if (!focusTradition && ((pool.focusSpells?.length ?? 0) || (pool.focusCantrips?.length ?? 0)))
          focusTradition = tradition;
      }
    }
    if (focusSpells.length || focusCantrips.length)
      spellcasting = { cantrips: [], spellsByRank: {}, focusSpells, focusCantrips, focusTradition };
  }

  // Best-effort innate-spell import from the `innate: true` spellCasters entries.
  const innateSpells: InnateSpellEntry[] = [];
  const casters = (build as { spellCasters?: unknown }).spellCasters;
  if (Array.isArray(casters)) {
    for (const c of casters as Array<{
      innate?: boolean;
      magicTradition?: string;
      perDay?: number[];
      spells?: Array<{ spellLevel?: number; list?: string[] }>;
    }>) {
      if (!c?.innate) continue;
      const tradition = (
        TRADITIONS.includes(c.magicTradition as SpellTradition) ? c.magicTradition : 'arcane'
      ) as SpellTradition;
      for (const sl of c.spells ?? []) {
        const rank = sl.spellLevel ?? 0;
        const perDay = c.perDay?.[rank] ?? 1;
        for (const name of sl.list ?? []) {
          const id = spellIdByName(name);
          if (id && !innateSpells.some((e) => e.spellId === id))
            innateSpells.push({ spellId: id, tradition, perDay });
        }
      }
    }
  }

  return {
    name: build.name ?? '',
    level: build.level ?? 1,
    ancestryId,
    heritageId,
    backgroundId: byName(ds.backgrounds, build.background),
    classId: byName(ds.classes, build.class),
    keyAbility: (build.keyability || undefined) as AbilityKey | undefined,
    ...(spellcasting ? { spellcasting } : {}),
    ...(innateSpells.length ? { innateSpells } : {}),
  };
}
