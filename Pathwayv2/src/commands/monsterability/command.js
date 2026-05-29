const { EmbedBuilder } = require('discord.js');

const { fmt } = require('../../lib/format');
const { basicSaveDamage } = require('../../lib/dice');
const { rollCompoundExpression } = require('../../lib/spellDamage');
const combatV2State = require('../../rules/combatV2/state');
const combatV2Rolls = require('../../rules/combatV2/rolls');
const { updateCombatV2Summary } = require('../init/combatV2Summary');
const { combatV2SaveKey, combatV2SaveModifier, combatV2DegreeLabel, combatV2LegacyDegree } = require('../monster/combatV2Helpers');

async function execute(interaction) {
    const channelId = interaction.channel.id;
    const encounter = combatV2State.getEncounter(channelId);
    const wantPublic = interaction.options.getBoolean('public') ?? true;
    if (!encounter) return interaction.reply({ content: 'No active combat v2 encounter in this channel. Start one with `/init start`.', ephemeral: true });
    if (interaction.user.id !== encounter.gmId) return interaction.reply({ content: 'Only the GM can use `/m ability`.', ephemeral: true });

    const actorName = interaction.options.getString('monster');
    const abilityName = interaction.options.getString('name');
    const targetName = interaction.options.getString('target');
    const saveKey = combatV2SaveKey(interaction.options.getString('save'));
    const dc = interaction.options.getInteger('dc');
    const damageExpr = interaction.options.getString('damage');
    const damageType = interaction.options.getString('type');
    const isBasic = interaction.options.getBoolean('basic') ?? !!damageExpr;
    const notes = interaction.options.getString('notes');

    const actor = combatV2State.findCombatant(encounter, actorName);
    if (!actor) return interaction.reply({ content: `No combatant named **"${actorName}"** in combat v2.`, ephemeral: true });
    const target = combatV2State.findCombatant(encounter, targetName);
    if (!target) return interaction.reply({ content: `No combatant named **"${targetName}"** in combat v2.`, ephemeral: true });
    if (!saveKey) return interaction.reply({ content: 'Unknown save type.', ephemeral: true });
    const targetSave = combatV2SaveModifier(target, saveKey, interaction.guildId);
    if (targetSave == null) return interaction.reply({ content: `**${target.name}** does not have that save recorded.`, ephemeral: true });

    const saveLabels = { fort: 'Fortitude', ref: 'Reflex', will: 'Will' };
    const result = combatV2Rolls.rollCheck({
      actor: target,
      stat: targetSave,
      dc,
      label: `${saveLabels[saveKey]} Save`,
      effectKind: 'save',
    });
    const lines = [
      `**Target** ${target.name}`,
      `**${saveLabels[saveKey]} Save DC ${dc}**`,
      `1d20 (${result.die}) ${fmt(result.stat)}${result.effectBonus ? ` ${fmt(result.effectBonus)} effects` : ''} = **${result.total}**`,
      `**${combatV2DegreeLabel(result.degree)}**`,
    ];

    let appliedLine = null;
    if (damageExpr) {
      const damageRoll = rollCompoundExpression(damageExpr);
      if (!damageRoll) return interaction.reply({ content: `Could not parse damage expression **${damageExpr}**.`, ephemeral: true });
      const scaledDamage = isBasic ? basicSaveDamage(damageRoll.total, combatV2LegacyDegree(result.degree)) : damageRoll.total;
      const defended = combatV2Rolls.applyDefenses(scaledDamage, damageType, target);
      lines.push('', `**Damage${isBasic ? ' (basic save)' : ''}** ${damageRoll.display} -> **${defended.finalDamage}**${damageType ? ` ${damageType}` : ''}`);
      if (defended.notes.length) lines.push(`*${defended.notes.join(', ')}*`);
      if (defended.finalDamage > 0 && (isBasic || result.degree === 'failure' || result.degree === 'criticalFailure')) {
        const beforeHp = target.hp;
        const applied = combatV2State.applyHp(channelId, target.name, -defended.finalDamage);
        appliedLine = `**${target.name}** took **${defended.finalDamage}** damage: ${beforeHp}/${target.maxHp} -> ${applied.combatant.hp}/${applied.combatant.maxHp} HP`;
      }
    }
    if (notes) lines.push('', `**Effect Reminder** ${notes}`);

    const embed = new EmbedBuilder()
      .setColor(0x9B59B6)
      .setTitle(`${actor.name}: ${abilityName}`)
      .setDescription(lines.join('\n').slice(0, 4096));
    await interaction.reply({ content: appliedLine ?? undefined, embeds: [embed], ephemeral: !wantPublic });
    await updateCombatV2Summary(interaction.channel, encounter);
    return;
}

module.exports = {
  name: 'monsterability',
  execute,
};
