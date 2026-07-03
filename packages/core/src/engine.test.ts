import { describe, it, expect } from 'vitest';
import {
  abilityModifier,
  computeAbilityScores,
  createEngine,
  deriveCharacter,
  proficiencyBonus,
  validate,
} from './index';
import { spellStats } from './spellcasting';
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
