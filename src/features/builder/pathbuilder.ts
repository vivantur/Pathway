import {
  findAncestry,
  findBackground,
  findClass,
  findHeritage,
  findItem,
  getDataset,
  type AbilityKey,
} from '@/features/builder/data';
import { deriveCharacter, trainedSkillIds } from '@/features/builder/rules';
import type { BuilderState } from '@/features/builder/types';

/**
 * Pathbuilder v2 export shape. The Pathway bot reads
 * `pathbuilder_data.build ?? pathbuilder_data`, so we emit `{ success, build }`
 * to match a real Pathbuilder export and round-trip through the bot.
 *
 * Proficiencies are the Pathbuilder convention: 0/2/4/6/8 (2×rank, WITHOUT the
 * level term — the bot re-derives the level part). Abilities are final scores.
 */
export interface PathbuilderBuild {
  name: string;
  class: string;
  dualClass: string | null;
  level: number;
  ancestry: string;
  heritage: string;
  background: string;
  alignment: string;
  gender: string;
  age: string;
  deity: string;
  size: number;
  sizeName: string;
  keyability: AbilityKey | '';
  languages: string[];
  attributes: {
    ancestryhp: number;
    classhp: number;
    bonushp: number;
    bonushpPerLevel: number;
    speed: number;
    speedBonus: number;
  };
  abilities: Record<AbilityKey, number> & { breakdown?: unknown };
  proficiencies: Record<string, number>;
  feats: [string, string | null, string, number][];
  specials: string[];
  lores: [string, number][];
  equipment: [string, number][];
  specificProficiencies: { trained: string[]; expert: string[]; master: string[]; legendary: string[] };
  weapons: unknown[];
  money: { cp: number; sp: number; gp: number; pp: number };
  armor: unknown[];
  spellCasters: unknown[];
  focusPoints: number;
  focus: Record<string, unknown>;
  formula: unknown[];
  pets: unknown[];
  familiars: unknown[];
  /** Pathway provenance tag the bot understands. */
  _pathwaySource: string;
}

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
  for (const s of derived.skills) skillProf[s.id] = p(s.rank);

  const specials: string[] = [];
  if (heritage) specials.push(heritage.name);
  if (subclass) specials.push(subclass.name);

  const feats: PathbuilderBuild['feats'] = [];
  const push = (id: string | undefined, type: string, level: number) => {
    if (!id) return;
    feats.push([featName(id), null, type, level]);
  };
  // Level 1 (from the creation steps).
  push(state.ancestryFeatId, 'Ancestry', 1);
  push(state.classFeatId, 'Class', 1);
  if (background?.skillFeat) push(background.skillFeat, 'Skill', 1);
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

  const lores: PathbuilderBuild['lores'] = background?.loreSkill
    ? [[background.loreSkill, p(1)]]
    : [];

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
  const weaponsOut = derived.weapons.map((w) => {
    const item = findItem(w.id);
    return {
      name: w.name,
      qty: 1,
      prof: item && item.kind === 'weapon' ? item.category : 'martial',
      die: w.damageDie,
      damageType: w.damageType,
      attack: w.attack,
      damageBonus: w.damageMod,
      display: w.name,
    };
  });
  const equippedArmor = (state.inventory ?? [])
    .map((e) => (e.equipped ? findItem(e.itemId) : undefined))
    .find((i) => i?.kind === 'armor');
  const armorOut =
    equippedArmor && equippedArmor.kind === 'armor'
      ? [{ name: equippedArmor.name, qty: 1, prof: equippedArmor.category, worn: true, display: equippedArmor.name }]
      : [];
  const equipmentOut = (state.inventory ?? [])
    .filter((e) => {
      const it = findItem(e.itemId);
      return !(it && (it.kind === 'weapon' || it.kind === 'armor') && e.equipped);
    })
    .map((e) => [findItem(e.itemId)?.name ?? e.itemId, e.qty] as [string, number]);

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
    spellCasters: [],
    focusPoints: 0,
    focus: {},
    formula: [],
    pets: [],
    familiars: [],
    _pathwaySource: 'pathway-web',
  };

  return { success: true, build };
}

function featName(id: string): string {
  return getDataset().feats.find((f) => f.id === id)?.name ?? id;
}

/**
 * Best-effort import: map a Pathbuilder build back onto our BuilderState by
 * matching names to dataset ids. Unknown fields are dropped (logged by caller).
 */
export function fromPathbuilder(data: unknown): Partial<BuilderState> {
  const build = (data as { build?: PathbuilderBuild })?.build ?? (data as PathbuilderBuild);
  if (!build || typeof build !== 'object') return {};
  const ds = getDataset();
  const byName = <T extends { id: string; name: string }>(list: T[], name?: string) =>
    list.find((x) => x.name.toLowerCase() === (name ?? '').toLowerCase())?.id;

  const ancestryId = byName(ds.ancestries, build.ancestry);
  const ancestry = ancestryId ? findAncestry(ancestryId) : undefined;
  const heritageName = (build.heritage ?? '').toLowerCase();
  const heritageId =
    ancestry?.heritages.find((h) => h.name.toLowerCase() === heritageName)?.id ??
    ds.versatileHeritages.find((h) => h.name.toLowerCase() === heritageName)?.id;

  return {
    name: build.name ?? '',
    level: build.level ?? 1,
    ancestryId,
    heritageId,
    backgroundId: byName(ds.backgrounds, build.background),
    classId: byName(ds.classes, build.class),
    keyAbility: (build.keyability || undefined) as AbilityKey | undefined,
  };
}
