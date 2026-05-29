// ── commands/snippet/command.js ─────────────────────────────────────────────
// /snippet: per-user roll macros (create, list, view, delete).
//
// Snippets are stored per-Discord-user in state/snippets. Each user can
// have up to 50 snippets; each expansion can use up to 9 numbered
// placeholders that are substituted from the /roll command line.
//
// Zero ctx — every dependency comes through explicit imports.

const { EmbedBuilder } = require('discord.js');
const snippetState = require('../../state/snippets');
const { validateSnippetName, validateSnippetExpansion } = require('./validation');

const MAX_SNIPPETS_PER_USER = 50;

async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  const snippets = snippetState.getAllUser();
  const userSnippets = snippets[interaction.user.id] ?? {};

  if (sub === 'create') {
    const name = interaction.options.getString('name').trim();
    const expansion = interaction.options.getString('expand').trim();
    const nameErr = validateSnippetName(name);
    if (nameErr) return interaction.reply({ content: `❌ ${nameErr}`, ephemeral: true });
    const expErr = validateSnippetExpansion(expansion);
    if (expErr) return interaction.reply({ content: `❌ ${expErr}`, ephemeral: true });

    // Per-user snippet cap so users can't bloat the file.
    if (!userSnippets[name.toLowerCase()] && Object.keys(userSnippets).length >= MAX_SNIPPETS_PER_USER) {
      return interaction.reply({
        content: `❌ You've reached the ${MAX_SNIPPETS_PER_USER}-snippet limit. Delete one with \`/snippet delete\` to make room.`,
        ephemeral: true,
      });
    }

    const existed = !!userSnippets[name.toLowerCase()];
    snippets[interaction.user.id] = { ...userSnippets, [name.toLowerCase()]: expansion };
    await snippetState.saveAllUser(snippets);

    // Detect arg count to give an accurate usage hint
    const argCount = (expansion.match(/%\d+/g) ?? []).length
      ? Math.max(...[...expansion.matchAll(/%(\d+)/g)].map(m => parseInt(m[1])))
      : 0;
    const usageHint = argCount > 0
      ? `Use like: \`/roll 1d20+5 ${name} ${Array.from({ length: argCount }, (_, i) => `<arg${i + 1}>`).join(' ')}\``
      : `Use like: \`/roll 1d20+5 ${name}\``;
    return interaction.reply({
      content: `${existed ? '✏️ Updated' : '✅ Created'} snippet **${name}** = \`${expansion}\`\n${usageHint}`,
      ephemeral: true,
    });
  }

  if (sub === 'list') {
    const entries = Object.entries(userSnippets);
    if (entries.length === 0) {
      return interaction.reply({
        content: '📭 You have no personal snippets yet. Create one with `/snippet create name:sneaky expand:+2d6[sneak]`\n\nTip: use `%1`, `%2`, etc. for arguments. Example: `+%1:2d6[sneak]` lets you do `/roll 1d20 sneaky 4` for 4d6.',
        ephemeral: true,
      });
    }
    entries.sort(([a], [b]) => a.localeCompare(b));
    const lines = entries.map(([n, v]) => {
      const hasArgs = /%\d+/.test(v);
      return `• **${n}**${hasArgs ? ' *(takes args)*' : ''} → \`${v}\``;
    });
    const embed = new EmbedBuilder()
      .setColor(0x7289DA)
      .setTitle(`📋 Your Snippets (${entries.length}/${MAX_SNIPPETS_PER_USER})`)
      .setDescription(lines.join('\n'))
      .setFooter({ text: 'Use any snippet name in /roll. Snippets with args take numbers after the name.' });
    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  if (sub === 'view') {
    const name = interaction.options.getString('name').trim().toLowerCase();
    const expansion = userSnippets[name];
    if (!expansion) return interaction.reply({ content: `❌ No snippet named \`${name}\`.`, ephemeral: true });
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
    const name = interaction.options.getString('name').trim().toLowerCase();
    if (!userSnippets[name]) return interaction.reply({ content: `❌ No snippet named \`${name}\`.`, ephemeral: true });
    delete userSnippets[name];
    snippets[interaction.user.id] = userSnippets;
    await snippetState.saveAllUser(snippets);
    return interaction.reply({ content: `🗑️ Deleted snippet **${name}**.`, ephemeral: true });
  }

  return interaction.reply({ content: '❌ Unknown subcommand.', ephemeral: true });
}

module.exports = {
  name: 'snippet',
  execute,
};
