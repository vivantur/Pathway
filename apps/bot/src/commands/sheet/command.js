// ── commands/sheet/command.js ───────────────────────────────────────────────
// Handler for the /sheet slash command. Shows a character's full sheet:
// stats, abilities, saves, skills, attacks, languages, senses, plus any
// active overrides applied via /char edit, /char stat, /char skill, etc.
//
// As of Phase 3.7 this is a zero-ctx command — every dependency comes
// through an explicit import. Joins /notes as the second model command
// for the "feature folder + clean imports" pattern.

const { buildSheetEmbed } = require('./embed');
const { resolveChar, getAll: getAllCharacters } = require('../../state/characters');
const {
  fetchPathwayCharacter,
  fetchLinkedPathwayCharacter,
  saveImportedCharacter,
} = require('../../lib/pathwayWebClient');

async function execute(interaction) {
  await interaction.deferReply();
  const userId = interaction.user.id;
  const characters = getAllCharacters();
  const nameArg = interaction.options.getString('name');
  let { error, charKey, char: charEntry } = resolveChar(userId, nameArg, characters);
  if (error) {
    return interaction.editReply(error);
  }
  try {
    // If the character is linked to a Pathway web sheet (or was imported
    // from one), refresh from Supabase before rendering. Lets web-side
    // edits show up immediately in /sheet without waiting for the next
    // save round-trip.
    if (charEntry.pathwayWebId || charEntry.data?._pathwaySource === 'native') {
      const refreshed = charEntry.pathwayWebId
        ? await fetchPathwayCharacter(charEntry.pathwayWebId, userId)
        : await fetchLinkedPathwayCharacter(userId, charKey, charEntry);
      if (!refreshed.error) {
        const savedRefresh = await saveImportedCharacter(userId, refreshed.char, {
          preserveOverlay: true,
          pathwayRow: refreshed.row,
        });
        const updatedCharacters = getAllCharacters();
        if (savedRefresh.ok && updatedCharacters[userId]?.[savedRefresh.key]) {
          charKey = savedRefresh.key;
          charEntry = updatedCharacters[userId][savedRefresh.key];
        }
      }
    }

    const embed = buildSheetEmbed(charEntry);
    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    console.error(err);
    await interaction.editReply('Something went wrong. Check the terminal for details!');
  }
}

module.exports = {
  name: 'sheet',
  execute,
};
