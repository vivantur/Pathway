// ── commands/notes/embed.js ─────────────────────────────────────────────────
// Discord embed builders for /notes.
//
// buildNotebookEmbed   — the multi-section list view (one field per category)
// buildNoteDetailEmbed — single-note view with full text + metadata footer

const { EmbedBuilder } = require('discord.js');
const {
  NOTE_CATEGORIES,
  NOTE_CATEGORY_ORDER,
  sortNotes,
  formatNoteLine,
} = require('./notebook');

// Build the notebook listing embed. If categoryFilter is set, only show
// that category. If pinnedOnly, only show pinned notes. Long category
// sections are truncated to Discord's 1024-char field limit with a
// "...more" suffix.
function buildNotebookEmbed(char, notes, { categoryFilter, pinnedOnly } = {}) {
  const categoriesToShow = categoryFilter
    ? [categoryFilter]
    : NOTE_CATEGORY_ORDER;

  const filtered = pinnedOnly ? notes.filter(n => n.pinned) : notes;

  const embed = new EmbedBuilder()
    .setColor(0x7b5ea7)
    .setTitle(`📓 ${char.name}'s Notebook`);

  const descParts = [];
  if (categoryFilter) {
    const cat = NOTE_CATEGORIES[categoryFilter];
    descParts.push(`Filtered by **${cat.icon} ${cat.label}**`);
  }
  if (pinnedOnly) descParts.push('Pinned notes only');
  if (descParts.length) embed.setDescription(descParts.join(' · '));

  let totalShown = 0;
  for (const catKey of categoriesToShow) {
    const cat = NOTE_CATEGORIES[catKey];
    const inCat = sortNotes(filtered.filter(n => n.category === catKey));
    if (inCat.length === 0) continue;
    const lines = inCat.map(formatNoteLine).join('\n');
    const value = lines.length > 1020
      ? lines.slice(0, 1020) + '\n*…more. Use `/notes search` or `/notes list` with a filter.*'
      : lines;
    embed.addFields({
      name: `${cat.icon} ${cat.label} (${inCat.length})`,
      value,
      inline: false,
    });
    totalShown += inCat.length;
  }

  if (totalShown === 0) {
    embed.setDescription(
      (descParts.length ? descParts.join(' · ') + '\n\n' : '') +
      '*No notes yet. Add one with `/notes add`.*'
    );
  }

  embed.setFooter({ text: `/notes view id:<n> for full detail · /notes add to contribute` });
  if (char.art || notes.charArt) embed.setThumbnail(char.art || notes.charArt);
  return embed;
}

// Build a single-note detail embed used by /notes view, /notes add, and
// /notes edit. Includes pinned indicator, author, and edited timestamp
// in the footer.
function buildNoteDetailEmbed(char, note) {
  const cat = NOTE_CATEGORIES[note.category];
  const embed = new EmbedBuilder()
    .setColor(cat?.color ?? 0x95a5a6)
    .setTitle(`${cat?.icon ?? '📝'} Note #${note.id} · ${cat?.label ?? 'Uncategorized'}`)
    .setDescription(note.text.slice(0, 4000));

  const meta = [];
  if (note.pinned) meta.push('📌 Pinned');
  meta.push(`By **${note.authorName}**`);
  meta.push(`Added ${new Date(note.createdAt).toLocaleDateString()}`);
  if (note.editedAt) meta.push(`*edited ${new Date(note.editedAt).toLocaleDateString()}*`);
  embed.setFooter({ text: meta.join(' · ') });
  embed.setAuthor({ name: `${char.name}'s notebook` });
  return embed;
}

module.exports = {
  buildNotebookEmbed,
  buildNoteDetailEmbed,
};
