// ── commands/class/command.js ───────────────────────────────────────────────
// /class: 5-page reference lookup for the PF2e Remaster classes.
//
// Has a character-aware twist:
//   • If `class:` is not specified, auto-detect from the user's loaded
//     character (so `/class` alone works for a player viewing their own
//     class).
//   • If `class:` is specified AND matches the user's character's class,
//     surface "Your character: X" on the Overview page.
//
// Both code paths converge on the same `findClass` lookup and the same
// renderer. The character lookup is best-effort — if nothing's loaded we
// just don't surface that info.

const { didYouMeanLine } = require('../../lib/fuzzyMatch');
const { classDatabase } = require('../../reference/databases');
const { resolveChar } = require('../../state/characters');
const { loadCharacters } = require('../../lib/storage');
const { findClass } = require('./lookup');
const { buildClassOverviewPage } = require('./embed');
const { buildClassButtons } = require('./buttons');

async function execute(interaction) {
  let input = interaction.options.getString('class');
  let userCharName = null;

  // If no class specified, try to pull from character. If specified, still
  // try to pull the character's name so we can surface "Your character: X"
  // when the user has a matching character loaded.
  if (!input) {
    try {
      const characters = loadCharacters();
      const charArg = interaction.options.getString('character');
      const { char: charEntry } = resolveChar(interaction.user.id, charArg, characters);
      if (charEntry?.data?.class) {
        input = charEntry.data.class;
        userCharName = charEntry.data.name;
      }
    } catch { /* fall through to error below */ }
  } else {
    try {
      const characters = loadCharacters();
      const charArg = interaction.options.getString('character');
      const { char: charEntry } = resolveChar(interaction.user.id, charArg, characters);
      if (charEntry?.data?.class && charEntry.data.class.toLowerCase() === input.toLowerCase()) {
        userCharName = charEntry.data.name;
      }
    } catch { /* no character loaded, that's fine */ }
  }

  if (!input) {
    return interaction.reply({
      content: '❌ Specify a class with `class:<name>`, or load a character first.',
      ephemeral: true,
    });
  }

  const { cls, key, matches } = findClass(input);
  if (!cls && matches.length > 1) {
    return interaction.reply({
      content: `🔍 Multiple classes match **"${input}"**: ${matches.slice(0, 10).join(', ')}`,
      ephemeral: true,
    });
  }
  if (!cls) {
    const all = Object.values(classDatabase).map(c => c.name).sort().join(', ');
    const hint = didYouMeanLine(input, all.split(', ').filter(Boolean));
    return interaction.reply({
      content: `❌ No class found for **"${input}"**.${hint || `\nAvailable: ${all}`}`,
      ephemeral: true,
    });
  }

  const embed = buildClassOverviewPage(cls, userCharName);
  const buttons = buildClassButtons(0, key);
  return interaction.reply({ embeds: [embed], components: [buttons] });
}

module.exports = {
  name: 'class',
  execute,
};
