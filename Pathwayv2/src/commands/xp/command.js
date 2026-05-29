// ── commands/xp/command.js ──────────────────────────────────────────────────
// /xp: per-character XP tracking. Subcommands: view, award, set, reset.
//
// Award goes through awardXp (xpMath.js) which also handles the log entry
// and level-up detection. The bot doesn't auto-level the sheet — when a
// character crosses 1000 XP we show a celebratory embed and prompt the
// player to level up in Pathbuilder, then re-import via /char update.
//
// /xp award is GM-gated (Manage Server permission). Other subcommands are
// open to anyone who owns or can see the character.

const { PermissionFlagsBits } = require('discord.js');
const characterState = require('../../state/characters');
const {
  resolveChar,
  getCharacterXp,
  setCharacterXp,
} = characterState;
const { awardXp } = require('./xpMath');
const { buildXpEmbed, buildLevelUpEmbed } = require('./embed');

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

  if (sub === 'award') {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({ content: '🔒 Only GMs (Manage Server permission) can award XP.', ephemeral: true });
    }
    const amount = interaction.options.getInteger('amount');
    const reason = interaction.options.getString('reason');
    if (amount === 0) return interaction.reply({ content: '❌ Amount cannot be 0.', ephemeral: true });

    const { oldXp, newXp, leveledUp } = awardXp(charEntry, amount, reason, interaction.user.id);
    characters[interaction.user.id][charKey] = charEntry;
    await characterState.saveAll(characters);

    const sign = amount >= 0 ? '+' : '';
    const note = `${amount >= 0 ? '✨' : '📉'} **${sign}${amount} XP**${reason ? ` — *${reason}*` : ''}\n${oldXp} → **${newXp}** XP`;
    const replyPayload = { embeds: [buildXpEmbed(char, charEntry, { note, showLog: false })] };

    if (leveledUp) {
      replyPayload.embeds.push(buildLevelUpEmbed(char, charEntry, oldXp, newXp));
      // Ping the owner if someone else (e.g. GM) awarded the XP
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
    if (amount < 0) return interaction.reply({ content: '❌ XP cannot be negative.', ephemeral: true });
    const oldXp = getCharacterXp(charEntry);
    setCharacterXp(charEntry, amount);
    characters[interaction.user.id][charKey] = charEntry;
    await characterState.saveAll(characters);
    const note = `✏️ Set XP to **${amount}** (was ${oldXp}).`;
    return interaction.reply({ embeds: [buildXpEmbed(char, charEntry, { note })] });
  }

  if (sub === 'reset') {
    // Zero the XP AND the log. Use this after leveling up in Pathbuilder
    // and running /char update, to start fresh toward the next level.
    const oldXp = getCharacterXp(charEntry);
    charEntry.xp = 0;
    charEntry.xpLog = [];
    characters[interaction.user.id][charKey] = charEntry;
    await characterState.saveAll(characters);
    const note = `🌅 Reset XP to **0** (was ${oldXp}). Good luck on the road to the next level!`;
    return interaction.reply({ embeds: [buildXpEmbed(char, charEntry, { note })] });
  }
}

module.exports = {
  name: 'xp',
  execute,
};
