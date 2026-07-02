const fetch = require('node-fetch');

const { parseStatBlock: parseBestiaryStatBlock } = require('../../parsers/bestiaryParser');
const {
  syncHomebrewEntryToSupabase,
  deleteHomebrewEntryFromSupabase,
} = require('../../lib/storage');
const { buildMonsterEmbed } = require('../monster/embed');
const { addMonsterToBestiary, removeMonsterFromBestiary } = require('./database');

const BOT_OWNER_ID = process.env.BOT_OWNER_ID || null;

function isBotOwner(userId) {
  return BOT_OWNER_ID && String(userId) === String(BOT_OWNER_ID);
}

async function execute(interaction) {
  if (!BOT_OWNER_ID) {
    return interaction.reply({
      content: '⚙️ `/monsteradd` is disabled: the bot operator hasn\'t set the `BOT_OWNER_ID` environment variable. Add it to `.env` and restart the bot.',
      ephemeral: true,
    });
  }
  if (!isBotOwner(interaction.user.id)) {
    return interaction.reply({
      content: '🔒 Only the bot owner can add creatures to the global bestiary.',
      ephemeral: true,
    });
  }

  const sub = interaction.options.getSubcommand();

  if (sub === 'paste') {
    const raw = interaction.options.getString('statblock');
    await interaction.deferReply({ ephemeral: true });
    const result = parseBestiaryStatBlock(raw);
    if (!result.ok) {
      return interaction.editReply({ content: `❌ Parse failed: ${result.error}` });
    }
    result.entry._homebrew = true;
    result.entry._addedBy = interaction.user.id;
    const slug = addMonsterToBestiary(result.entry, result.slug);
    syncHomebrewEntryToSupabase('monster', slug, result.entry);
    const preview = buildMonsterEmbed(result.entry, null);
    const warnLine = result.warnings.length
      ? `\n⚠️ Warnings:\n• ${result.warnings.join('\n• ')}`
      : '';
    return interaction.editReply({
      content: `✅ Added **${result.entry.name}** to the global bestiary (key: \`${slug}\`).${warnLine}\nUse \`/monster name:${result.entry.name}\` to view. If something looks off, use \`/monsteredit\` to fix it or \`/monsteradd remove\` to roll back.`,
      embeds: [preview],
    });
  }

  if (sub === 'file') {
    const attachment = interaction.options.getAttachment('file');
    if (!attachment) return interaction.reply({ content: '❌ No file attached.', ephemeral: true });
    if (attachment.size > 256 * 1024) {
      return interaction.reply({ content: '❌ File is too large (256 KB max). Please paste the stat block inline instead.', ephemeral: true });
    }
    const ctype = (attachment.contentType || '').toLowerCase();
    const isTexty = ctype.startsWith('text/') || /\.(txt|md|text)$/i.test(attachment.name || '');
    if (!isTexty) {
      return interaction.reply({ content: '❌ Only plain-text files (.txt / .md) are supported. If you have an image, retype the stat block into a .txt file or use `/monsteradd paste`.', ephemeral: true });
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
    const result = parseBestiaryStatBlock(body);
    if (!result.ok) {
      return interaction.editReply({ content: `❌ Parse failed: ${result.error}` });
    }
    result.entry._homebrew = true;
    result.entry._addedBy = interaction.user.id;
    const slug = addMonsterToBestiary(result.entry, result.slug);
    syncHomebrewEntryToSupabase('monster', slug, result.entry);
    const preview = buildMonsterEmbed(result.entry, null);
    const warnLine = result.warnings.length
      ? `\n⚠️ Warnings:\n• ${result.warnings.join('\n• ')}`
      : '';
    return interaction.editReply({
      content: `✅ Added **${result.entry.name}** to the global bestiary (key: \`${slug}\`).${warnLine}\nUse \`/monster name:${result.entry.name}\` to view. If something looks off, use \`/monsteredit\` to fix it or \`/monsteradd remove\` to roll back.`,
      embeds: [preview],
    });
  }

  if (sub === 'remove') {
    const input = interaction.options.getString('monster').trim();
    const result = removeMonsterFromBestiary(input);
    if (!result.removed) {
      return interaction.reply({ content: `❌ No creature found for \`${input}\` in the bestiary.`, ephemeral: true });
    }
    deleteHomebrewEntryFromSupabase('monster', result.key);
    return interaction.reply({ content: `🗑️ Removed **${result.name}** (key: \`${result.key}\`) from the global bestiary.`, ephemeral: true });
  }

  return interaction.reply({ content: '❌ Unknown subcommand.', ephemeral: true });
}

module.exports = {
  name: 'monsteradd',
  execute,
};
