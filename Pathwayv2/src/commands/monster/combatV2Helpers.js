const { fmt } = require('../../lib/format');
const { findMonster } = require('./lookup');
const { getMonsterEdit, applyMonsterEdits, applyMonsterAttackLibrary } = require('./helpers');

function combatV2SaveKey(saveType) {
  const key = String(saveType ?? '').toLowerCase();
  if (key.startsWith('fort')) return 'fort';
  if (key.startsWith('ref')) return 'ref';
  if (key.startsWith('will')) return 'will';
  return null;
}

function firstNumber(...values) {
  for (const value of values) {
    if (value == null || value === '') continue;
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function combatV2NormalizeMonsterSaves(core = {}, summary = {}, rich = null) {
  const summaryObj = summary.summary ?? summary ?? {};
  const richSaves = rich?.saves ?? rich?.defenses?.saves ?? {};
  const coreSaves = core.saves ?? {};
  return {
    fort: firstNumber(richSaves.fort, richSaves.fortitude, richSaves.Fortitude, coreSaves.fort, coreSaves.fortitude, core.fort, core.fortitude, summaryObj.fort, summaryObj.fortitude, summaryObj.Fortitude),
    ref: firstNumber(richSaves.ref, richSaves.reflex, richSaves.Reflex, coreSaves.ref, coreSaves.reflex, core.ref, core.reflex, summaryObj.ref, summaryObj.reflex, summaryObj.Reflex),
    will: firstNumber(richSaves.will, richSaves.Will, coreSaves.will, core.will, summaryObj.will, summaryObj.Will),
  };
}

function combatV2MonsterSaveStats(monster, guildId) {
  const edits = guildId ? getMonsterEdit(guildId, monster.name) : null;
  const edited = applyMonsterEdits(monster, edits);
  const withLibrary = guildId ? applyMonsterAttackLibrary(edited, guildId) : edited;
  return combatV2NormalizeMonsterSaves(withLibrary.core ?? {}, withLibrary.summary ?? {}, withLibrary.rich ?? null);
}

function combatV2SaveModifier(combatant, saveKey, guildId = null) {
  const direct = combatant?.saves?.[saveKey];
  if (direct != null) {
    const number = Number(direct);
    if (Number.isFinite(number)) return number;
  }
  const lookupName = combatant?.sourceKey ?? combatant?.bestiaryKey ?? combatant?.name;
  if (!lookupName) return null;
  try {
    const { monster } = findMonster(lookupName);
    if (!monster) return null;
    return combatV2MonsterSaveStats(monster, guildId)?.[saveKey] ?? null;
  } catch {
    return null;
  }
}

function combatV2DegreeLabel(degree) {
  return {
    criticalSuccess: 'Critical Success',
    success: 'Success',
    failure: 'Failure',
    criticalFailure: 'Critical Failure',
  }[degree] ?? 'Result';
}

function combatV2LegacyDegree(degree) {
  return {
    criticalSuccess: 'crit-success',
    success: 'success',
    failure: 'failure',
    criticalFailure: 'crit-failure',
  }[degree] ?? degree;
}

function combatV2AttackListText(actor) {
  const attacks = actor?.attacks ?? [];
  if (!attacks.length) return `**${actor?.name ?? 'Actor'}** has no attacks configured.`;
  return attacks.map(a => {
    const traits = a.traits?.length ? ` (${a.traits.join(', ')})` : '';
    const damage = a.damage ? `, ${a.damage}${a.damageType ? ` ${a.damageType}` : ''}` : '';
    return `- **${a.name}** ${fmt(a.bonus ?? 0)}${damage}${traits}`;
  }).join('\n');
}

module.exports = {
  combatV2SaveKey,
  combatV2SaveModifier,
  combatV2DegreeLabel,
  combatV2LegacyDegree,
  combatV2AttackListText,
};
