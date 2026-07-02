// ── commands/notes/command.js ───────────────────────────────────────────────
// /notes slash command: add, list, view, search, edit, remove, pin.
//
// Notes are visible to anyone in the server (read), but only the
// character's owner can add notes, and only a note's author can edit /
// remove / pin it.
//
// This is the first command extracted with **zero ctx** — `execute` takes
// only the interaction. Every dependency arrives via an explicit import.
// The pattern: state modules + per-feature helpers + Discord render = a
// self-contained command. No parameter-passing for "this is the bot's
// context object" because everything has a real home.

const { EmbedBuilder } = require('discord.js');
const notes = require('../../state/notes');
const { resolveChar, getAll: getAllCharacters } = require('../../state/characters');
const {
  NOTE_CATEGORIES,
  NOTE_CATEGORY_ORDER,
  noteKey,
  getNotebook,
  addNote,
  sortNotes,
  truncateNote,
  formatNoteLine,
} = require('./notebook');
const { buildNotebookEmbed, buildNoteDetailEmbed } = require('./embed');

async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  const charNameArg = interaction.options.getString('character');
  const characters = getAllCharacters();

  // Find the character — could be ANY character on the server, not just
  // the invoker's. /notes is intentionally cross-character so a GM can
  // read another player's notes for their own NPC tracking, etc.
  let charOwnerId = null;
  let charKey = null;
  let charEntry = null;

  if (!charNameArg) {
    // No character specified — resolve the invoker's own default.
    const own = resolveChar(interaction.user.id, null, characters);
    if (!own.error) {
      charOwnerId = interaction.user.id;
      charKey = own.charKey;
      charEntry = own.char;
    }
  } else {
    // Search across every user's characters for one with this name.
    const target = String(charNameArg).toLowerCase();
    outer: for (const [ownerId, userChars] of Object.entries(characters)) {
      for (const [key, entry] of Object.entries(userChars)) {
        if (key.startsWith('_') || !entry || !entry.name) continue;
        if (entry.name.toLowerCase() === target) {
          charOwnerId = ownerId;
          charKey = key;
          charEntry = entry;
          break outer;
        }
      }
    }
  }

  if (!charEntry) {
    return interaction.reply({
      content: charNameArg
        ? `❌ No character named **"${charNameArg}"** found on this server.`
        : `❌ You don't have a character loaded. Specify one with \`character:<name>\`, or load one with \`/char add\`.`,
      ephemeral: true,
    });
  }

  const char = charEntry.data;
  const isOwner = interaction.user.id === charOwnerId;
  const notesData = notes.getAll();
  const book = getNotebook(notesData, charOwnerId, charKey);
  const findNote = (id) => book.notes.find(n => n.id === id) ?? null;

  if (sub === 'add') {
    if (!isOwner) {
      return interaction.reply({ content: `❌ Only **${char.name}**'s owner can add notes to their notebook.`, ephemeral: true });
    }
    const category = interaction.options.getString('category');
    const text = interaction.options.getString('text');
    const pinned = interaction.options.getBoolean('pin') ?? false;
    if (!NOTE_CATEGORIES[category]) {
      return interaction.reply({ content: `❌ Invalid category. Choose one of: ${Object.values(NOTE_CATEGORIES).map(c => c.label).join(', ')}.`, ephemeral: true });
    }
    if (text.length > 1800) {
      return interaction.reply({ content: `❌ Note too long (${text.length} chars, max 1800).`, ephemeral: true });
    }
    const note = addNote(notesData, charOwnerId, charKey, {
      category, text, pinned,
      authorId: interaction.user.id,
      authorName: interaction.user.username,
    });
    if (note.error) return interaction.reply({ content: `❌ ${note.error}`, ephemeral: true });
    await notes.save(charOwnerId, charKey, book);
    const cat = NOTE_CATEGORIES[category];
    return interaction.reply({
      content: `${cat.icon} Added note \`#${note.id}\` to **${char.name}**'s ${cat.label}${pinned ? ' *(pinned)*' : ''}.\n> ${truncateNote(text, 200)}`,
    });
  }

  if (sub === 'list') {
    const categoryFilter = interaction.options.getString('category');
    const pinnedOnly = interaction.options.getBoolean('pinned') ?? false;
    if (categoryFilter && !NOTE_CATEGORIES[categoryFilter]) {
      return interaction.reply({ content: `❌ Invalid category filter.`, ephemeral: true });
    }
    const embed = buildNotebookEmbed(char, book.notes, { categoryFilter, pinnedOnly });
    return interaction.reply({ embeds: [embed] });
  }

  if (sub === 'view') {
    const id = interaction.options.getInteger('id');
    const note = findNote(id);
    if (!note) return interaction.reply({ content: `❌ No note with ID **#${id}** in **${char.name}**'s notebook.`, ephemeral: true });
    return interaction.reply({ embeds: [buildNoteDetailEmbed(char, note)] });
  }

  if (sub === 'search') {
    const query = interaction.options.getString('query').toLowerCase();
    const matches = book.notes.filter(n => n.text.toLowerCase().includes(query));
    if (matches.length === 0) {
      return interaction.reply({ content: `🔍 No notes matching **"${query}"** in **${char.name}**'s notebook.`, ephemeral: true });
    }
    const sorted = sortNotes(matches);
    const embed = new EmbedBuilder()
      .setColor(0x7b5ea7)
      .setTitle(`🔍 Search: "${query}" in ${char.name}'s notebook`)
      .setDescription(`Found **${matches.length}** matching note${matches.length === 1 ? '' : 's'}.`);

    for (const catKey of NOTE_CATEGORY_ORDER) {
      const inCat = sorted.filter(n => n.category === catKey);
      if (inCat.length === 0) continue;
      const cat = NOTE_CATEGORIES[catKey];
      const lines = inCat.map(formatNoteLine).join('\n');
      embed.addFields({
        name: `${cat.icon} ${cat.label} (${inCat.length})`,
        value: lines.length > 1020 ? lines.slice(0, 1020) + '\n*…more.*' : lines,
        inline: false,
      });
    }
    embed.setFooter({ text: `Tip: /notes view id:<n> for full detail` });
    return interaction.reply({ embeds: [embed] });
  }

  if (sub === 'edit') {
    if (!isOwner) return interaction.reply({ content: `❌ Only **${char.name}**'s owner can edit notes in their notebook.`, ephemeral: true });
    const id = interaction.options.getInteger('id');
    const newText = interaction.options.getString('text');
    const note = findNote(id);
    if (!note) return interaction.reply({ content: `❌ No note with ID **#${id}**.`, ephemeral: true });
    if (note.authorId !== interaction.user.id) {
      return interaction.reply({ content: `❌ Only the person who wrote note **#${id}** (${note.authorName}) can edit it.`, ephemeral: true });
    }
    if (newText.length > 1800) return interaction.reply({ content: `❌ Note too long (${newText.length} chars, max 1800).`, ephemeral: true });
    note.text = newText;
    note.editedAt = new Date().toISOString();
    await notes.save(charOwnerId, charKey, book);
    return interaction.reply({ embeds: [buildNoteDetailEmbed(char, note)] });
  }

  if (sub === 'remove') {
    if (!isOwner) return interaction.reply({ content: `❌ Only **${char.name}**'s owner can remove notes from their notebook.`, ephemeral: true });
    const id = interaction.options.getInteger('id');
    const note = findNote(id);
    if (!note) return interaction.reply({ content: `❌ No note with ID **#${id}**.`, ephemeral: true });
    if (note.authorId !== interaction.user.id) {
      return interaction.reply({ content: `❌ Only the person who wrote note **#${id}** (${note.authorName}) can remove it.`, ephemeral: true });
    }
    book.notes = book.notes.filter(n => n.id !== id);
    await notes.save(charOwnerId, charKey, book);
    const cat = NOTE_CATEGORIES[note.category];
    return interaction.reply({ content: `🗑️ Removed note \`#${id}\` from **${char.name}**'s ${cat.label}.` });
  }

  if (sub === 'pin') {
    if (!isOwner) return interaction.reply({ content: `❌ Only **${char.name}**'s owner can pin notes in their notebook.`, ephemeral: true });
    const id = interaction.options.getInteger('id');
    const note = findNote(id);
    if (!note) return interaction.reply({ content: `❌ No note with ID **#${id}**.`, ephemeral: true });
    note.pinned = !note.pinned;
    await notes.save(charOwnerId, charKey, book);
    return interaction.reply({
      content: `${note.pinned ? '📌' : '📍'} Note \`#${id}\` is now ${note.pinned ? '**pinned**' : '**unpinned**'}.`,
    });
  }
}

module.exports = {
  name: 'notes',
  execute,
};
