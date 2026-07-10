const { EmbedBuilder } = require('discord.js');

const { fmt } = require('../../lib/format');
const combatV2State = require('../../state/combat');
const { combatV2AttackListText } = require('../monster/combatV2Helpers');

async function execute(interaction) {
    const channelId = interaction.channel.id;
    const encounter = combatV2State.getEncounter(channelId);
    const wantPublic = interaction.options.getBoolean('public') ?? true;
    if (!encounter) return interaction.reply({ content: 'No active combat v2 encounter in this channel. Start one with `/init start`.', ephemeral: true });
    if (interaction.user.id !== encounter.gmId) return interaction.reply({ content: 'Only the GM can use `/m attacks`.', ephemeral: true });
    const monsterName = interaction.options.getString('monster');
    const actor = combatV2State.findCombatant(encounter, monsterName);
    if (!actor) return interaction.reply({ content: `No combatant named **"${monsterName}"** in combat v2.`, ephemeral: true });
    const attackText = combatV2AttackListText(actor);
    const spellLines = (actor.spells ?? []).map(s => {
      const rank = Number(s.rank) === 0 ? 'Cantrip' : `Rank ${s.rank}`;
      const dc = s.dc != null ? ` DC ${s.dc}` : '';
      const atk = s.attack != null ? ` attack ${fmt(s.attack)}` : '';
      return `• **${s.name}** (${rank}${dc}${atk})`;
    });
    const embed = new EmbedBuilder()
      .setColor(0x8B0000)
      .setTitle(`${actor.name}'s Actions`)
      .addFields({ name: 'Attacks', value: attackText.slice(0, 1024), inline: false });
    if (spellLines.length) embed.addFields({ name: 'Spells', value: spellLines.join('\n').slice(0, 1024), inline: false });
    return interaction.reply({ embeds: [embed], ephemeral: !wantPublic });
}

module.exports = {
  name: 'monsterattacks',
  execute,
};
