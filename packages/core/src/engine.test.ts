import { describe, it, expect } from 'vitest';
import {
  abilityModifier,
  archetypeFeatOptions,
  classProficiency,
  computeAbilityScores,
  createEngine,
  deriveCharacter,
  proficiencyBonus,
  validate,
} from './index';
import {
  spellStats,
  maxSpellRank,
  slotsForRank,
  casterConfig,
  isCaster,
  maxSpellRankFor,
  partialSlotsForRank,
} from './spellcasting';
import { emptyBuilderState } from './character';
import { testDataset, fighterState } from './testFixtures';

describe('proficiency + ability math', () => {
  it('proficiency bonus is level + 2×rank, zero when untrained', () => {
    expect(proficiencyBonus(0, 5)).toBe(0);
    expect(proficiencyBonus(1, 1)).toBe(3);
    expect(proficiencyBonus(3, 1)).toBe(7);
    // Proficiency Without Level drops the level term.
    expect(proficiencyBonus(2, 5, true)).toBe(4);
  });

  it('ability modifier floors (score − 10) / 2', () => {
    expect(abilityModifier(10)).toBe(0);
    expect(abilityModifier(16)).toBe(3);
    expect(abilityModifier(7)).toBe(-2);
    expect(abilityModifier(18)).toBe(4);
  });
});

describe('computeAbilityScores', () => {
  it('applies flaws + boosts from every source', () => {
    const scores = computeAbilityScores(testDataset, fighterState());
    expect(scores).toEqual({ str: 16, dex: 14, con: 14, int: 12, wis: 12, cha: 8 });
  });

  it('honors the "+1 instead of +2 at/above 18" rule', () => {
    // Pile five boosts onto Strength; the fifth lands while Str is already 18.
    const s = {
      ...emptyBuilderState(),
      ancestryId: 'testfolk',
      backgroundId: 'warrior-bg',
      classId: 'fighter',
      keyAbility: 'str' as const,
      ancestryBoostChoices: ['str' as const], // free → str  (+2 → 12)
      backgroundBoostChoices: ['str' as const, 'str' as const], // restricted + free → str (+2, +2 → 16)
      freeBoosts: ['str' as const, 'dex' as const, 'con' as const, 'int' as const], // key(+2→18), free str(+1→19)
    };
    expect(computeAbilityScores(testDataset, s).str).toBe(19);
  });
});

describe('deriveCharacter — level-1 fighter worked example', () => {
  const d = deriveCharacter(testDataset, fighterState());

  it('HP = ancestry + (class + Con) × level', () => {
    expect(d.maxHp).toBe(20); // 8 + (10 + 2) × 1
  });

  it('AC = 10 + trained + Dex(capped) + armor bonus', () => {
    expect(d.ac).toBe(16); // 10 + 3 + 2 + 1
  });

  it('perception and saves', () => {
    expect(d.perception).toBe(4); // trained(3) + Wis(1)
    expect(d.saves).toEqual({ fortitude: 9, reflex: 7, will: 4 });
  });

  it('class DC', () => {
    expect(d.classDc).toBe(16); // 10 + trained(3) + Str(3)
  });

  it('equipped weapon attack + damage', () => {
    expect(d.weapons).toHaveLength(1);
    const w = d.weapons[0]!;
    expect(w.attack).toBe(8); // martial(5) + Str(3)
    expect(w.dice).toBe(1);
    expect(w.damageMod).toBe(3);
  });

  it('skills carry rank + ability modifier', () => {
    const byId = Object.fromEntries(d.skills.map((s) => [s.id, s.modifier]));
    expect(byId.athletics).toBe(6); // trained(3) + Str(3)
    expect(byId.acrobatics).toBe(5); // trained(3) + Dex(2)
    expect(byId.intimidation).toBe(2); // trained(3) + Cha(-1)
  });
});

describe('variant rules', () => {
  it('Proficiency Without Level removes level from derived numbers', () => {
    const s = { ...fighterState(), level: 5, options: { proficiencyWithoutLevel: true } };
    const d = deriveCharacter(testDataset, s);
    expect(d.perception).toBe(3); // trained(2, no level) + Wis(1)
  });

  it('Automatic Bonus Progression adds attack + extra weapon dice by level', () => {
    const s = { ...fighterState(), level: 4, options: { automaticBonusProgression: true } };
    const w = deriveCharacter(testDataset, s).weapons[0]!;
    expect(w.dice).toBe(2); // abpDamageDice(4) = 2
    expect(w.attack).toBe(12); // martial pb(2,4)=8 + Str(3) + abpAttack(4)=1
  });
});

describe('proficiency advancement by level', () => {
  const fighter = testDataset.classes.find((c) => c.id === 'fighter');

  it('classProficiency raises the base rank once the level is reached', () => {
    // fighter martial: base expert(2), → master(3) at level 5.
    expect(classProficiency(fighter, 'attacks.martial', 4, 2)).toBe(2);
    expect(classProficiency(fighter, 'attacks.martial', 5, 2)).toBe(3);
    // never lowers below the base
    expect(classProficiency(fighter, 'attacks.martial', 20, 4)).toBe(4);
  });

  it('a level-5 fighter attacks at master proficiency', () => {
    const w = deriveCharacter(testDataset, { ...fighterState(), level: 5 }).weapons[0]!;
    expect(w.attack).toBe(14); // master pb(3,5)=11 + Str(3)
  });

  it('a fighter Will save advances to expert at level 9', () => {
    const d = deriveCharacter(testDataset, { ...fighterState(), level: 9 });
    expect(d.ranks.will).toBe(2);
    expect(d.saves.will).toBe(14); // expert pb(2,9)=13 + Wis(1)
  });
});

describe('spellStats — wizard', () => {
  it('spell attack and DC use the key ability at trained proficiency', () => {
    const s = {
      ...emptyBuilderState(),
      ancestryId: 'testfolk',
      backgroundId: 'warrior-bg',
      classId: 'wizard',
      keyAbility: 'int' as const,
      ancestryBoostChoices: ['int' as const],
      backgroundBoostChoices: ['con' as const, 'int' as const],
      freeBoosts: ['int' as const, 'dex' as const, 'con' as const, 'wis' as const],
    };
    const stats = spellStats(testDataset, s);
    expect(stats).not.toBeNull();
    expect(stats!.ability).toBe('int');
    expect(stats!.attack).toBe(7); // trained(3) + Int(4)
    expect(stats!.dc).toBe(17); // 10 + 3 + 4
  });

  it('spell proficiency advances to expert at level 7', () => {
    const s = {
      ...emptyBuilderState(),
      level: 7,
      ancestryId: 'testfolk',
      backgroundId: 'warrior-bg',
      classId: 'wizard',
      keyAbility: 'int' as const,
      ancestryBoostChoices: ['int' as const],
      backgroundBoostChoices: ['con' as const, 'int' as const],
      freeBoosts: ['int' as const, 'dex' as const, 'con' as const, 'wis' as const],
    };
    const stats = spellStats(testDataset, s)!;
    expect(stats.dc).toBe(25); // 10 + expert pb(2,7)=11 + Int(4)
    expect(stats.attack).toBe(15); // 11 + 4
  });
});

describe('full-caster spell slots', () => {
  const row = (lvl: number) => Array.from({ length: 10 }, (_, i) => slotsForRank(lvl, i + 1));

  it('highest castable rank is ceil(level / 2)', () => {
    expect(maxSpellRank(1)).toBe(1);
    expect(maxSpellRank(2)).toBe(1);
    expect(maxSpellRank(3)).toBe(2);
    expect(maxSpellRank(17)).toBe(9);
    expect(maxSpellRank(19)).toBe(10);
  });

  it('matches the Player Core Spells-per-Day table', () => {
    // ranks 1..10
    expect(row(1)).toEqual([2, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(row(3)).toEqual([3, 2, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(row(5)).toEqual([3, 3, 2, 0, 0, 0, 0, 0, 0, 0]);
    expect(row(9)).toEqual([3, 3, 3, 3, 2, 0, 0, 0, 0, 0]);
    expect(row(17)).toEqual([3, 3, 3, 3, 3, 3, 3, 3, 2, 0]);
    expect(row(20)).toEqual([3, 3, 3, 3, 3, 3, 3, 3, 3, 1]);
  });
});

describe('subclass-gated advancement (cleric doctrine)', () => {
  const clericState = (level: number, doctrine: string) => ({
    ...emptyBuilderState(),
    level,
    ancestryId: 'testfolk',
    backgroundId: 'warrior-bg',
    classId: 'cleric',
    subclassId: doctrine,
    keyAbility: 'wis' as const,
    ancestryBoostChoices: ['wis' as const],
    backgroundBoostChoices: ['str' as const, 'wis' as const],
    freeBoosts: ['wis' as const, 'con' as const, 'dex' as const, 'int' as const],
  });

  // The fixture has no cleric class, so add one with the doctrine subclasses.
  const dataset = {
    ...testDataset,
    classes: [
      ...testDataset.classes,
      {
        id: 'cleric',
        name: 'Cleric',
        keyAbility: ['wis' as const],
        hp: 8,
        initialProficiencies: {
          perception: 1, fortitude: 1, reflex: 1, will: 2, classDC: 1,
          trainedSkillCount: 2, trainedSkills: [],
          attacks: { unarmed: 1, simple: 1, martial: 0, advanced: 0, unarmored: 1 },
          defenses: { unarmored: 1, light: 0, medium: 0, heavy: 0 },
        },
        proficiencyIncreases: [{ level: 1, target: 'spell' as const, rank: 1 as const }],
        subclasses: [
          {
            id: 'cloistered-cleric', name: 'Cloistered Cleric', description: '',
            proficiencyIncreases: [
              { level: 7, target: 'spell' as const, rank: 2 as const },
              { level: 19, target: 'spell' as const, rank: 4 as const },
            ],
          },
          {
            id: 'warpriest', name: 'Warpriest', description: '',
            proficiencyIncreases: [{ level: 15, target: 'fortitude' as const, rank: 3 as const }],
          },
        ],
        source: 'test', description: '',
      },
    ],
  };

  it('spell proficiency advances by doctrine (isolated vs a doctrine that does not)', () => {
    // Warpriest fixture has no spell increase, so it stays trained — the DC gap
    // is exactly the proficiency-rank difference, isolating the doctrine effect.
    const cloistered7 = spellStats(dataset, clericState(7, 'cloistered-cleric'))!;
    const warpriest7 = spellStats(dataset, clericState(7, 'warpriest'))!;
    expect(cloistered7.dc - warpriest7.dc).toBe(2); // expert pb(2,7)=11 vs trained pb(1,7)=9

    const cloistered19 = spellStats(dataset, clericState(19, 'cloistered-cleric'))!;
    const warpriest19 = spellStats(dataset, clericState(19, 'warpriest'))!;
    expect(cloistered19.dc - warpriest19.dc).toBe(6); // legendary pb(4,19)=27 vs trained pb(1,19)=21
  });

  it('warpriest Fortitude reaches master at 15 via its doctrine', () => {
    expect(deriveCharacter(dataset, clericState(15, 'warpriest')).ranks.fortitude).toBe(3);
    // cloistered does NOT get that Fortitude bump
    expect(deriveCharacter(dataset, clericState(15, 'cloistered-cleric')).ranks.fortitude).toBe(1);
  });
});

describe('partial casters (magus, summoner)', () => {
  it('are recognized casters with the right config', () => {
    expect(isCaster('magus')).toBe(true);
    const magus = casterConfig('magus')!;
    expect(magus.progression).toBe('partial');
    expect(magus.type).toBe('prepared');
    expect(magus.keyAbility).toBe('int'); // casts on Int despite Str/Dex class key
    expect(magus.tradition).toBe('arcane');

    const summoner = casterConfig('summoner', 'beast')!;
    expect(summoner.progression).toBe('partial');
    expect(summoner.type).toBe('spontaneous');
    expect(summoner.keyAbility).toBe('cha');
    expect(summoner.tradition).toBe('primal'); // from the beast eidolon
  });

  it('use the reduced slot table (top two ranks only, 9th-rank max)', () => {
    const row = (lvl: number) => Array.from({ length: 10 }, (_, i) => partialSlotsForRank(lvl, i + 1));
    expect(row(1)).toEqual([1, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(row(4)).toEqual([2, 2, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(row(5)).toEqual([0, 2, 1, 0, 0, 0, 0, 0, 0, 0]); // lost 1st-rank slots
    expect(row(20)).toEqual([0, 0, 0, 0, 0, 0, 0, 2, 2, 0]); // never 10th rank
    expect(maxSpellRankFor(casterConfig('magus')!, 20)).toBe(9);
  });

  it('a magus spell DC advances on Int at partial proficiency', () => {
    const s = {
      ...emptyBuilderState(),
      level: 9,
      ancestryId: 'testfolk',
      backgroundId: 'warrior-bg',
      classId: 'magus',
      keyAbility: 'str' as const, // class key ability
      ancestryBoostChoices: ['int' as const],
      backgroundBoostChoices: ['str' as const, 'int' as const],
      freeBoosts: ['int' as const, 'str' as const, 'con' as const, 'dex' as const],
    };
    const stats = spellStats(testDataset, s)!;
    expect(stats.ability).toBe('int');
    // Int here: 10 +2(ancestry) +2(bg) +2(free) = 16 → mod 3; expert pb(2,9)=13.
    expect(stats.dc).toBe(26); // 10 + 13 + 3
  });
});

describe('Free Archetype — dedication first', () => {
  it('offers only dedications until one is taken, then opens the rest', () => {
    const before = archetypeFeatOptions(testDataset, emptyBuilderState(), 4);
    expect(before.map((f) => f.id)).toEqual(['acrobat-dedication']); // Quick Jump gated

    const withDedication = {
      ...emptyBuilderState(),
      progression: { 2: { skillIncreases: [], boosts: [], archetypeFeatId: 'acrobat-dedication' } },
    };
    const after = archetypeFeatOptions(testDataset, withDedication, 4).map((f) => f.id).sort();
    expect(after).toEqual(['acrobat-dedication', 'quick-jump']);
  });
});

describe('validate', () => {
  it('a complete build has no problems', () => {
    expect(validate(testDataset, fighterState())).toEqual([]);
  });

  it('an empty build reports what is missing', () => {
    const problems = validate(testDataset, emptyBuilderState());
    expect(problems).toContain('Name your character.');
    expect(problems).toContain('Choose an ancestry.');
    expect(problems).toContain('Choose a class.');
  });
});

describe('createEngine', () => {
  it('binds the dataset so results match the free functions', () => {
    const engine = createEngine(testDataset);
    const s = fighterState();
    expect(engine.deriveCharacter(s)).toEqual(deriveCharacter(testDataset, s));
    expect(engine.validate(s)).toEqual(validate(testDataset, s));
  });
});
