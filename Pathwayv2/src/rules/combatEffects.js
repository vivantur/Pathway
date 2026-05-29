// Sum up all attack/damage/AC/save/skill modifiers from a combatant's effects.
function sumEffectModifiers(combatant) {
  const totals = {
    attackBonus: 0,
    damageBonus: 0,
    acBonus: 0,
    saveBonus: 0,
    skillBonus: 0,
    activeEffects: [],
  };
  if (!combatant?.effects || combatant.effects.length === 0) return totals;

  for (const effect of combatant.effects) {
    const m = effect.modifiers || {};
    const atk = m.attackBonus ?? 0;
    const dmg = m.damageBonus ?? 0;
    const ac = m.acBonus ?? 0;
    const save = m.saveBonus ?? 0;
    const skill = m.skillBonus ?? 0;

    totals.attackBonus += atk;
    totals.damageBonus += dmg;
    totals.acBonus += ac;
    totals.saveBonus += save;
    totals.skillBonus += skill;

    if (atk || dmg || ac || save || skill) {
      const displayValue = effect.value !== null && effect.value !== undefined ? ` ${effect.value}` : '';
      totals.activeEffects.push({
        name: `${effect.name}${displayValue}`,
        attackBonus: atk,
        damageBonus: dmg,
        acBonus: ac,
      });
    }
  }
  return totals;
}

module.exports = {
  sumEffectModifiers,
};
