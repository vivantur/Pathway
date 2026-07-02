// ── commands/serversnippet/command.js ───────────────────────────────────────
// /serversnippet: per-guild roll macros (create, list, view, delete).
//
// Server snippets are visible to everyone in a guild, but only users with
// the `ManageGuild` Discord permission can create or delete them — typically
// GMs and moderators. Personal snippets override server snippets with the
// same name (see /roll's expansion logic).
//
// Sister command to /snippet. Shares the validators in commands/snippet/
// since both apply the same naming + expansion rules.

const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const snippetState = require('../../state/snippets');
const { validateSnippetName, validateSnippetExpansion } = require('../snippet/validation');

const MAX_SNIPPETS_PER_GUILD = 100;

async function execute(interaction) {
  if (!interaction.guildId) {
    return interaction.reply({ content: '❌ Server snippets can only be used in a server, not in DMs.', ephemeral: true });
  }

  const sub = interaction.options.getSubcommand();
  const all = snippetState.getAllGuild();
  const guildSnippets = all[interaction.guildId] ?? {};

  // Helper: can the user manage server snippets?
  const canManage = () =>
    interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);

  if (sub === 'create') {
    if (!canManage()) {
      return interaction.reply({ content: '🔒 Only users with the **Manage Server** permission can create server snippets.', ephemeral: true });
    }
    const name = interaction.options.getString('name').trim();
    const expansion = interaction.options.getString('expand').trim();
    const nameErr = validateSnippetName(name);
    if (nameErr) return interaction.reply({ content: `❌ ${nameErr}`, ephemeral: true });
    const expErr = validateSnippetExpansion(expansion);
    if (expErr) return interaction.reply({ content: `❌ ${expErr}`, ephemeral: true });

    if (!guildSnippets[name.toLowerCase()] && Object.keys(guildSnippets).length >= MAX_SNIPPETS_PER_GUILD) {
      return interaction.reply({
        content: `❌ This server has reached the ${MAX_SNIPPETS_PER_GUILD} server-snippet limit.`,
        ephemeral: true,
      });
    }

    const existed = !!guildSnippets[name.toLowerCase()];
    all[interaction.guildId] = { ...guildSnippets, [name.toLowerCase()]: expansion };
    await snippetState.saveAllGuild(all);

    const argCount = (expansion.match(/%\d+/g) ?? []).length
      ? Math.max(...[...expansion.matchAll(/%(\d+)/g)].map(m => parseInt(m[1])))
      : 0;
    const usageHint = argCount > 0
      ? `Anyone on this server can use: \`/roll 1d20+5 ${name} ${Array.from({ length: argCount }, (_, i) => `<arg${i + 1}>`).join(' ')}\``
      : `Anyone on this server can use: \`/roll 1d20+5 ${name}\``;
    return interaction.reply({
      content: `${existed ? '✏️ Updated' : '✅ Created'} server snippet **${name}** = \`${expansion}\`\n${usageHint}`,
    });
  }

  if (sub === 'list') {
    const entries = Object.entries(guildSnippets);
    if (entries.length === 0) {
      return interaction.reply({
        content: '📭 This server has no snippets yet. A GM can create one with `/serversnippet create`.',
        ephemeral: true,
      });
    }
    entries.sort(([a], [b]) => a.localeCompare(b));
    const lines = entries.map(([n, v]) => {
      const hasArgs = /%\d+/.test(v);
      return `• **${n}**${hasArgs ? ' *(takes args)*' : ''} → \`${v}\``;
    });
    const embed = new EmbedBuilder()
      .setColor(0x43B581)
      .setTitle(`📋 ${interaction.guild?.name ?? 'Server'} Snippets (${entries.length}/${MAX_SNIPPETS_PER_GUILD})`)
      .setDescription(lines.join('\n'))
      .setFooter({ text: 'Everyone on this server can use these. Personal snippets override same-name server snippets.' });
    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  if (sub === 'view') {
    const name = interaction.options.getString('name').trim().toLowerCase();
    const expansion = guildSnippets[name];
    if (!expansion) return interaction.reply({ content: `❌ No server snippet named \`${name}\`.`, ephemeral: true });
    const phs = [...expansion.matchAll(/%(\d+)(?::([0-9.]+))?/g)];
    let argInfo = '';
    if (phs.length > 0) {
      const maxArg = Math.max(...phs.map(m => parseInt(m[1])));
      const argLines = [];
      for (let i = 1; i <= maxArg; i++) {
        const match = phs.find(m => parseInt(m[1]) === i);
        argLines.push(`  • \`%${i}\`${match?.[2] ? ` (default: ${match[2]})` : ' *required*'}`);
      }
      argInfo = `\n**Arguments:**\n${argLines.join('\n')}`;
    }
    return interaction.reply({
      content: `**${name}** → \`${expansion}\`${argInfo}`,
      ephemeral: true,
    });
  }

  if (sub === 'delete') {
    if (!canManage()) {
      return interaction.reply({ content: '🔒 Only users with the **Manage Server** permission can delete server snippets.', ephemeral: true });
    }
    const name = interaction.options.getString('name').trim().toLowerCase();
    if (!guildSnippets[name]) return interaction.reply({ content: `❌ No server snippet named \`${name}\`.`, ephemeral: true });
    delete guildSnippets[name];
    all[interaction.guildId] = guildSnippets;
    await snippetState.saveAllGuild(all);
    return interaction.reply({ content: `🗑️ Deleted server snippet **${name}**.` });
  }

  return interaction.reply({ content: '❌ Unknown subcommand.', ephemeral: true });
}

module.exports = {
  name: 'serversnippet',
  execute,
};
