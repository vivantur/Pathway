// Tests for the builder's Pathbuilder serializer.
//
// This JSON is what a character built on the web is SAVED as: the vault row, the
// bot's view of the character, and the Pathbuilder-compatible export all read it.
// Anything a consumer cannot recompute from this object has to be written into it.
//
// AC is the case in point. It needs the equipped armor, that armor's Dex cap, and
// its potency rune to derive; neither the character sheet nor the bot resolves any
// of those, so both just read `acTotal.acTotal`. Before this was emitted, every
// in-house character had no AC at all — the sheet rendered blank, the bot's `{{ac}}`
// substituted a hardcoded 10, and combat saw null.

import { describe, expect, it } from 'vitest';
import { proficiencyBonus } from '@pathway/core';
import { getDataset } from '@/features/builder/data';
import { toPathbuilder } from '@/features/builder/pathbuilder';
import { deriveCharacter } from '@/features/builder/rules';
import { emptyBuilderState, type BuilderState } from '@/features/builder/types';

/** A level-1 fighter with nothing equipped, so AC is the unarmored case. */
function unarmoredFighter(): BuilderState {
  const ds = getDataset();
  const human = ds.ancestries.find((a) => a.id === 'human');
  const fighter = ds.classes.find((c) => c.id === 'fighter');
  if (!human || !fighter) throw new Error('dataset is missing human/fighter');

  return {
    ...emptyBuilderState(),
    name: 'Test Fighter',
    level: 1,
    ancestryId: human.id,
    classId: fighter.id,
    keyAbility: 'str',
    freeBoosts: ['str', 'dex', 'con', 'wis'],
  };
}

describe('toPathbuilder — acTotal', () => {
  it('writes an acTotal, so saved characters actually have an AC', () => {
    const result = toPathbuilder(unarmoredFighter());
    expect(result.success).toBe(true);

    const { acTotal } = result.build;
    expect(acTotal).toBeDefined();
    expect(typeof acTotal?.acTotal).toBe('number');
    expect(acTotal?.acTotal).toBeGreaterThan(0);
  });

  it('the emitted acTotal is exactly what deriveCharacter computed', () => {
    const state = unarmoredFighter();
    const derived = deriveCharacter(state);
    const { build } = toPathbuilder(state);

    expect(build.acTotal).toEqual({
      acTotal: derived.ac,
      shieldBonus: derived.shieldBonus,
    });
  });

  it('unarmored AC = 10 + proficiency + Dex (no armor equipped)', () => {
    const state = unarmoredFighter();
    const derived = deriveCharacter(state);

    const expected =
      10 + proficiencyBonus(derived.ranks.unarmoredDefense, state.level) + derived.mods.dex;

    expect(derived.ac).toBe(expected);
    expect(toPathbuilder(state).build.acTotal?.acTotal).toBe(expected);
  });

  it('excludes the shield: the sheet adds shieldBonus only while it is raised', () => {
    const state = unarmoredFighter();
    const { build } = toPathbuilder(state);
    const derived = deriveCharacter(state);

    expect(build.acTotal?.acTotal).toBe(derived.ac);
    expect(build.acTotal?.shieldBonus).toBe(derived.shieldBonus);
  });
});

describe('toPathbuilder — proficiencies', () => {
  // Consumers (sheet, bot, PDF) re-add level + ability from these ranks but
  // never re-derive rank PROGRESSION, so the export must carry the ranks at
  // the character's current level. It used to freeze the class's level-1
  // initial proficiencies, which read 2-4 points low past every bump.
  it('writes current-level ranks, not level-1 initial proficiencies', () => {
    const state = { ...unarmoredFighter(), level: 9 };
    const { build } = toPathbuilder(state);

    // Fighter progression per @pathway/core's locked table:
    // perception master@7, fortitude master@9, will expert@3, reflex expert@1.
    expect(build.proficiencies!.perception).toBe(6);
    expect(build.proficiencies!.fortitude).toBe(6);
    expect(build.proficiencies!.will).toBe(4);
    expect(build.proficiencies!.reflex).toBe(4);
  });

  it('weapon-category ranks follow the class progression (fighter master@13)', () => {
    const at1 = toPathbuilder(unarmoredFighter()).build.proficiencies!;
    const at13 = toPathbuilder({ ...unarmoredFighter(), level: 13 }).build.proficiencies!;

    expect(at1.martial).toBe(4); // expert at level 1
    expect(at13.martial).toBe(6); // Weapon Legend: master simple/martial
    expect(at13.simple).toBe(6);
  });

  it('every serialized rank equals what deriveCharacter reports', () => {
    const state = { ...unarmoredFighter(), level: 17 };
    const derived = deriveCharacter(state);
    const { build } = toPathbuilder(state);

    expect(build.proficiencies!.classDC).toBe(2 * derived.ranks.classDC);
    expect(build.proficiencies!.perception).toBe(2 * derived.ranks.perception);
    expect(build.proficiencies!.fortitude).toBe(2 * derived.ranks.fortitude);
    expect(build.proficiencies!.reflex).toBe(2 * derived.ranks.reflex);
    expect(build.proficiencies!.will).toBe(2 * derived.ranks.will);
    expect(build.proficiencies!.unarmored).toBe(2 * derived.ranks.defenses.unarmored);
    expect(build.proficiencies!.heavy).toBe(2 * derived.ranks.defenses.heavy);
    expect(build.proficiencies!.martial).toBe(2 * derived.ranks.attacks.martial);
    expect(build.proficiencies!.unarmed).toBe(2 * derived.ranks.attacks.unarmed);
  });

  it('bakes the armor speed penalty into attributes.speed (readers cannot derive it)', () => {
    const state = unarmoredFighter();
    state.inventory = [{ itemId: 'full-plate', qty: 1, equipped: true }];
    const derived = deriveCharacter(state);
    const { build } = toPathbuilder(state);

    // Full Plate is Str +4 / speed -10: reduced to -5 when the requirement is
    // met, full otherwise — either way the exported speed carries the penalty.
    expect(derived.speed).toBeLessThan(25);
    expect(build.attributes!.speed).toBe(derived.speed);
  });

  it('armor Strength requirement compares the MODIFIER, not the raw score', () => {
    // Str 14 (mod +2) vs Full Plate's Str +4: requirement NOT met, so the
    // full -10 speed penalty and the -3 check penalty apply. The old raw-score
    // comparison (14 >= 4) treated it as met.
    const state = unarmoredFighter();
    state.inventory = [{ itemId: 'full-plate', qty: 1, equipped: true }];
    const derived = deriveCharacter(state);
    expect(derived.mods.str).toBe(2);
    expect(derived.speed).toBe(15);
    const athletics = derived.skills.find((s) => s.id === 'athletics');
    const religion = derived.skills.find((s) => s.id === 'religion');
    expect(athletics && religion).toBeTruthy();
    // Check penalty hits Str/Dex skills only.
    expect(athletics!.modifier).toBe(proficiencyBonus(athletics!.rank, 1) + 2 - 3);
    expect(religion!.modifier).toBe(proficiencyBonus(religion!.rank, 1) + derived.mods.wis);
  });

  it('caster spell proficiency rides the spellcasting track, not "trained forever"', () => {
    const ds = getDataset();
    const wizard = ds.classes.find((c) => c.id === 'wizard');
    if (!wizard) throw new Error('dataset is missing wizard');

    const state: BuilderState = {
      ...emptyBuilderState(),
      name: 'Test Wizard',
      level: 15,
      classId: wizard.id,
      keyAbility: 'int',
      spellcasting: { cantrips: [], spellsByRank: {}, focusSpells: [], focusCantrips: [] },
    };
    const derived = deriveCharacter(state);
    const { build } = toPathbuilder(state);
    const casterEntry = build.spellCasters![0] as { proficiency: number } | undefined;

    expect(casterEntry).toBeDefined();
    expect(derived.ranks.spellcasting).toBeGreaterThan(1);
    expect(casterEntry?.proficiency).toBe(2 * Math.max(1, derived.ranks.spellcasting));
    expect(build.proficiencies!.castingArcane).toBe(casterEntry?.proficiency);
  });
});
