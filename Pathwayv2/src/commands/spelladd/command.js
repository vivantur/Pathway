const fetch = require('node-fetch');

const { parseSpellStatBlock } = require('../../parsers/spellParser');
const {
  syncHomebrewEntryToSupabase,
  deleteHomebrewEntryFromSupabase,
} = require('../../lib/storage');
const { buildSpellEmbed } = require('../spell/embed');
const { addSpellToDatabase, removeSpellFromDatabase } = require('./database');

const BOT_OWNER_ID = process.env.BOT_OWNER_ID || null;

function isBotOwner(userId) {
  return BOT_OWNER_ID && String(userId) === String(BOT_OWNER_ID);
}

async function execute(interaction) {
  if (!BOT_OWNER_ID) {
    return interaction.reply({
      content: '⚙️ `/spelladd` is disabled: the bot operator hasn\'t set the `BOT_OWNER_ID` environment variable. Add it to `.env` and restart the bot.',
      ephemeral: true,
    });
  }
  if (!isBotOwner(interaction.user.id)) {
    return interaction.reply({
      content: '🔒 Only the bot owner can add homebrew spells to the global database.',
      ephemeral: true,
    });
  }

  const sub = interaction.options.getSubcommand();

  if (sub === 'paste') {
    const raw = interaction.options.getString('statblock');
    await interaction.deferReply({ ephemeral: true });
    const result = parseSpellStatBlock(raw);
    if (!result.ok) return interaction.editReply({ content: `❌ Parse failed: ${result.error}` });
    result.entry._homebrew = true;
    result.entry._addedBy = interaction.user.id;
    const finalName = addSpellToDatabase(result.entry);
    syncHomebrewEntryToSupabase('spell', finalName.toLowerCase().replace(/\s+/g, '-'), result.entry);
    const warnLine = result.warnings.length ? `\n⚠️ Warnings:\n• ${result.warnings.join('\n• ')}` : '';
    return interaction.editReply({
      content: `✅ Added **${finalName}** to the global spell database.${warnLine}\nUse \`/spell name:${finalName}\` to view. Remove with \`/spelladd remove spell:${finalName}\`.`,
      embeds: [buildSpellEmbed(result.entry)],
    });
  }

  if (sub === 'file') {
    const attachment = interaction.options.getAttachment('file');
    if (!attachment) return interaction.reply({ content: '❌ No file attached.', ephemeral: true });
    if (attachment.size > 256 * 1024) {
      return interaction.reply({ content: '❌ File is too large (256 KB max). Please paste the statblock inline instead.', ephemeral: true });
    }
    const ctype = (attachment.contentType || '').toLowerCase();
    const isTexty = ctype.startsWith('text/') || /\.(txt|md|text)$/i.test(attachment.name || '');
    if (!isTexty) {
      return interaction.reply({ content: '❌ Only plain-text files (.txt / .md) are supported.', ephemeral: true });
    }
    await interaction.deferReply({ ephemeral: true });
    let body;
    try {
      const resp = await fetch(attachment.url);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      body = await resp.text();
    } catch (err) {
      return interaction.editReply({ content: `❌ Could not download the attachment: ${err.message}` });
    }
    const result = parseSpellStatBlock(body);
    if (!result.ok) return interaction.editReply({ content: `❌ Parse failed: ${result.error}` });
    result.entry._homebrew = true;
    result.entry._addedBy = interaction.user.id;
    const finalName = addSpellToDatabase(result.entry);
    syncHomebrewEntryToSupabase('spell', finalName.toLowerCase().replace(/\s+/g, '-'), result.entry);
    const warnLine = result.warnings.length ? `\n⚠️ Warnings:\n• ${result.warnings.join('\n• ')}` : '';
    return interaction.editReply({
      content: `✅ Added **${finalName}** to the global spell database.${warnLine}\nUse \`/spell name:${finalName}\` to view.`,
      embeds: [buildSpellEmbed(result.entry)],
    });
  }

  if (sub === 'remove') {
    const input = interaction.options.getString('spell').trim();
    const result = removeSpellFromDatabase(input);
    if (result.protected) {
      return interaction.reply({ content: `🛡️ **${result.name}** is part of the core spell database (not homebrew) and cannot be removed via \`/spelladd remove\`.`, ephemeral: true });
    }
    if (!result.removed) {
      return interaction.reply({ content: `❌ No homebrew spell found matching \`${input}\`.`, ephemeral: true });
    }
    deleteHomebrewEntryFromSupabase('spell', result.name.toLowerCase().replace(/\s+/g, '-'));
    return interaction.reply({ content: `🗑️ Removed homebrew spell **${result.name}** from the database.`, ephemeral: true });
  }

  return interaction.reply({ content: '❌ Unknown subcommand.', ephemeral: true });
}

module.exports = {
  name: 'spelladd',
  execute,
};
