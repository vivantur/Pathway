const { EmbedBuilder } = require('discord.js');

const { fmt } = require('../../lib/format');
const { basicSaveDamage } = require('../../lib/dice');
const { resolveSpellDamage, rollCompoundExpression } = require('../../lib/spellDamage');
const combatV2State = require('../../rules/combatV2/state');
const combatV2Rolls = require('../../rules/combatV2/rolls');
const { findSpell, spellAmbiguityMessage } = require('../spell/lookup');
const { normalizeSpell } = require('../spell/embed');
const { updateCombatV2Summary } = require('../init/combatV2Summary');
const { combatV2SaveKey, combatV2SaveModifier, combatV2DegreeLabel, combatV2LegacyDegree } = require('../monster/combatV2Helpers');

async function execute(interaction) {
    const channelId = interaction.channel.id;
    const encounter = combatV2State.getEncounter(channelId);
    const wantPublic = interaction.options.getBoolean('public') ?? true;
    if (!encounter) return interaction.reply({ content: 'No active combat v2 encounter in this channel. Start one with `/init start`.', ephemeral: true });
    if (interaction.user.id !== encounter.gmId) return interaction.reply({ content: 'Only the GM can use `/m cast`.', ephemeral: true });

    const monsterName = interaction.options.getString('monster');
    const spellName = interaction.options.getString('spell');
    const targetName = interaction.options.getString('target');
    const levelOverride = interaction.options.getInteger('level');
    const dcOverride = interaction.options.getInteger('dc');
    const attackOverride = interaction.options.getInteger('attack_bonus');
    const manualDamage = interaction.options.getString('damage');
    const manualSave = interaction.options.getString('save');

    const actor = combatV2State.findCombatant(encounter, monsterName);
    if (!actor) return interaction.reply({ content: `No combatant named **"${monsterName}"** in combat v2.`, ephemeral: true });
    const target = targetName
      ? combatV2State.findCombatant(encounter, targetName)
      : encounter.combatants.find(c => c.id !== actor.id && c.hp > 0 && c.isNpc !== actor.isNpc);
    if (targetName && !target) return interaction.reply({ content: `No combatant named **"${targetName}"** in combat v2.`, ephemeral: true });

    const savedSpell = (actor.spells ?? []).find(s => s.name.toLowerCase() === spellName.toLowerCase())
      ?? (actor.spells ?? []).find(s => s.name.toLowerCase().includes(spellName.toLowerCase()));
    const rawSpell = findSpell(spellName);
    if (rawSpell?.ambiguous) return interaction.reply({ content: spellAmbiguityMessage(rawSpell), ephemeral: true });
    const spell = rawSpell ? normalizeSpell(rawSpell) : {
      name: savedSpell?.name ?? spellName,
      level: savedSpell?.rank ?? 1,
      type: 'Ability',
      traditions: [],
      isAttackSpell: attackOverride != null && !manualSave,
      savingThrow: manualSave,
      saveIsBasic: true,
      description: '',
    };

    const effectiveLevel = levelOverride ?? savedSpell?.rank ?? spell.level ?? 1;
    const dc = dcOverride ?? savedSpell?.dc ?? 10;
    const attackBonus = attackOverride ?? savedSpell?.attack ?? 0;
    const saveKey = manualSave ?? combatV2SaveKey(spell.savingThrow);
    const isAttack = spell.isAttackSpell || (attackOverride != null && !saveKey);
    const resolved = manualDamage
      ? { diceExpr: manualDamage, damageType: null, heightenedNote: '' }
      : resolveSpellDamage(spell, effectiveLevel);
    const damageRoll = resolved?.diceExpr ? rollCompoundExpression(resolved.diceExpr) : null;
    const damageType = resolved?.damageType ?? null;

    const lines = [];
    lines.push(`*${spell.type === 'Cantrip' ? `Cantrip ${effectiveLevel}` : spell.type === 'Ability' ? 'Ability' : `Rank ${effectiveLevel} spell`}*`);
    if (target) lines.push(`**Target** ${target.name}`);
    lines.push('');
    let appliedLine = null;

    if (isAttack) {
      const targetEffects = combatV2Rolls.effectTotals(target);
      const ac = target?.ac != null ? target.ac + targetEffects.ac : null;
      const result = combatV2Rolls.rollCheck({ actor, stat: attackBonus, dc: ac, label: 'Spell Attack', effectKind: 'attack' });
      lines.push('**Spell Attack**');
      lines.push(`1d20 (${result.die}) ${fmt(result.stat)}${result.effectBonus ? ` ${fmt(result.effectBonus)} effects` : ''} = **${result.total}**`);
      if (target && ac != null) lines.push(`vs AC ${ac}: **${combatV2DegreeLabel(result.degree)}**`);
      if (damageRoll && ['success', 'criticalSuccess'].includes(result.degree)) {
        const baseDamage = result.degree === 'criticalSuccess' ? damageRoll.total * 2 : damageRoll.total;
        const defended = target ? combatV2Rolls.applyDefenses(baseDamage, damageType, target) : { finalDamage: baseDamage, notes: [] };
        lines.push(`**Damage${result.degree === 'criticalSuccess' ? ' (crit x2)' : ''}** ${damageRoll.display} = **${defended.finalDamage}**${damageType ? ` ${damageType}` : ''}`);
        if (defended.notes.length) lines.push(`*${defended.notes.join(', ')}*`);
        if (target && defended.finalDamage > 0) {
          const beforeHp = target.hp;
          const applied = combatV2State.applyHp(channelId, target.name, -defended.finalDamage);
          appliedLine = `**${target.name}** took **${defended.finalDamage}** damage: ${beforeHp}/${target.maxHp} -> ${applied.combatant.hp}/${applied.combatant.maxHp} HP`;
        }
      } else if (damageRoll) {
        lines.push('*No damage.*');
      }
    } else if (saveKey) {
      const saveLabels = { fort: 'Fortitude', ref: 'Reflex', will: 'Will' };
      lines.push(`**${spell.saveIsBasic ? 'Basic ' : ''}${saveLabels[saveKey] ?? saveKey} Save DC ${dc}**`);
      const targetSave = target && saveKey ? combatV2SaveModifier(target, saveKey, interaction.guildId) : null;
      if (target && targetSave != null) {
        const result = combatV2Rolls.rollCheck({ actor: target, stat: targetSave, dc, label: `${saveLabels[saveKey]} Save`, effectKind: 'save' });
        lines.push(`${target.name}: 1d20 (${result.die}) ${fmt(result.stat)}${result.effectBonus ? ` ${fmt(result.effectBonus)} effects` : ''} = **${result.total}**`);
        lines.push(`**${combatV2DegreeLabel(result.degree)}**`);
        if (damageRoll) {
          const fullDamage = spell.saveIsBasic ? basicSaveDamage(damageRoll.total, combatV2LegacyDegree(result.degree)) : damageRoll.total;
          const defended = combatV2Rolls.applyDefenses(fullDamage, damageType, target);
          lines.push(`**Damage** ${damageRoll.display} -> **${defended.finalDamage}**${damageType ? ` ${damageType}` : ''}`);
          if (defended.notes.length) lines.push(`*${defended.notes.join(', ')}*`);
          if (defended.finalDamage > 0 && (spell.saveIsBasic || result.degree === 'failure' || result.degree === 'criticalFailure')) {
            const beforeHp = target.hp;
            const applied = combatV2State.applyHp(channelId, target.name, -defended.finalDamage);
            appliedLine = `**${target.name}** took **${defended.finalDamage}** damage: ${beforeHp}/${target.maxHp} -> ${applied.combatant.hp}/${applied.combatant.maxHp} HP`;
          }
        }
      } else if (target) {
        lines.push(`${target.name}'s save bonus is not recorded.`);
      }
    } else if (damageRoll) {
      lines.push(`**Damage** ${damageRoll.display} = **${damageRoll.total}**${damageType ? ` ${damageType}` : ''}`);
    } else {
      lines.push('No attack, save, or damage data found. Add `dc` plus `save`, `attack_bonus`, or `damage` for custom abilities.');
    }

    if (resolved?.heightenedNote) lines.push(`*Heightened: ${resolved.heightenedNote}*`);
    if (spell.description && spell.description !== '*No description available.*') {
      lines.push('', spell.description.length > 300 ? `${spell.description.slice(0, 300)}...\n*Use \`/spell ${spell.name}\` for full details.*` : spell.description);
    }
    const embed = new EmbedBuilder()
      .setColor(0x9B59B6)
      .setTitle(`${actor.name} casts ${spell.name}`)
      .setDescription(lines.join('\n').slice(0, 4096))
      .setFooter({ text: `GM cast · Attack ${fmt(attackBonus)} · DC ${dc}` });
    await interaction.reply({ content: appliedLine ?? undefined, embeds: [embed], ephemeral: !wantPublic });
    await updateCombatV2Summary(interaction.channel, encounter);
    return;
}

module.exports = {
  name: 'monstercast',
  execute,
};
