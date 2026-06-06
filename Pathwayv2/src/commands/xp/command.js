// commands/xp/command.js
// Per-character XP tracking. Players can award XP to their own characters;
// every award is kept in the character's XP log for later review.

const characterState = require('../../state/characters');
const {
  resolveChar,
  getCharacterXp,
  setCharacterXp,
} = characterState;
const { awardXp } = require('./xpMath');
const { buildXpEmbed, buildXpHistoryEmbed, buildLevelUpEmbed } = require('./embed');

async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  const characters = characterState.getAll();

  const charNameArg = interaction.options.getString('character');
  const { error, charKey, char: charEntry } = resolveChar(interaction.user.id, charNameArg, characters);
  if (error) return interaction.reply({ content: error, ephemeral: true });
  const char = charEntry.data;

  if (sub === 'view') {
    return interaction.reply({ embeds: [buildXpEmbed(char, charEntry, { showLog: true })] });
  }

  if (sub === 'history') {
    return interaction.reply({ embeds: [buildXpHistoryEmbed(char, charEntry)] });
  }

  if (sub === 'award') {
    const amount = interaction.options.getInteger('amount');
    const reason = interaction.options.getString('reason');
    if (amount === 0) return interaction.reply({ content: 'Amount cannot be 0.', ephemeral: true });

    const { oldXp, newXp, leveledUp } = awardXp(charEntry, amount, reason, interaction.user.id);
    characters[interaction.user.id][charKey] = charEntry;
    await characterState.saveAll(characters);

    const sign = amount >= 0 ? '+' : '';
    const note = `**${sign}${amount} XP**${reason ? ` - *${reason}*` : ''}\n${oldXp} -> **${newXp}** XP`;
    const replyPayload = { embeds: [buildXpEmbed(char, charEntry, { note, showLog: false })] };

    if (leveledUp) {
      replyPayload.embeds.push(buildLevelUpEmbed(char, charEntry, oldXp, newXp));
      if (charEntry.ownerId && charEntry.ownerId !== interaction.user.id) {
        replyPayload.content = `<@${charEntry.ownerId}>`;
      } else if (interaction.user.id) {
        replyPayload.content = `<@${interaction.user.id}>`;
      }
    }
    return interaction.reply(replyPayload);
  }

  if (sub === 'set') {
    const amount = interaction.options.getInteger('amount');
    if (amount < 0) return interaction.reply({ content: 'XP cannot be negative.', ephemeral: true });
    const oldXp = getCharacterXp(charEntry);
    setCharacterXp(charEntry, amount);
    characters[interaction.user.id][charKey] = charEntry;
    await characterState.saveAll(characters);
    const note = `Set XP to **${amount}** (was ${oldXp}).`;
    return interaction.reply({ embeds: [buildXpEmbed(char, charEntry, { note })] });
  }

  if (sub === 'reset') {
    const oldXp = getCharacterXp(charEntry);
    charEntry.xp = 0;
    charEntry.xpLog = [];
    characters[interaction.user.id][charKey] = charEntry;
    await characterState.saveAll(characters);
    const note = `Reset XP to **0** (was ${oldXp}). Good luck on the road to the next level!`;
    return interaction.reply({ embeds: [buildXpEmbed(char, charEntry, { note })] });
  }
}

module.exports = {
  name: 'xp',
  execute,
};
