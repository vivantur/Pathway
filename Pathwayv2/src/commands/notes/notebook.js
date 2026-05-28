// ── commands/notes/notebook.js ──────────────────────────────────────────────
// Pure data model + operations for character notebooks.
//
// A "notebook" is a per-character collection of session notes, keyed in
// state/notes by `<discordId>:<charKey>`. Each note has an id, category,
// text, pin state, author info, and timestamps.
//
// This file has no Discord, no I/O — just data shape, validation, and
// list-formatting helpers. Both the command handler and the embed
// builders import from here.

// ── Categories ─────────────────────────────────────────────────────────────
// Each category gets a display label, an emoji icon, and an embed color.
// Order matters for /notes list — categories render top-to-bottom in this
// order regardless of how notes were added.
const NOTE_CATEGORIES = {
  npcs:           { label: 'NPCs',         icon: '🧑',  color: 0x3498db },
  locations:      { label: 'Locations',    icon: '🗺️',  color: 0x2ecc71 },
  'plot-threads': { label: 'Plot Threads', icon: '🎭',  color: 0x9b59b6 },
  influence:      { label: 'Influence',    icon: '🤝',  color: 0xf39c12 },
  items:          { label: 'Items',        icon: '💎',  color: 0xe91e63 },
};

const NOTE_CATEGORY_ORDER = ['npcs', 'locations', 'plot-threads', 'influence', 'items'];

const MAX_NOTES_PER_CHARACTER = 100;

// ── Notebook key + accessor ────────────────────────────────────────────────

// Compose the flat key for a character's notebook in state/notes.
// state/notes stores books keyed by "<ownerId>:<charKey>" so the cache
// itself doesn't need a nested shape.
function noteKey(ownerId, charKey) {
  return `${ownerId}:${charKey}`;
}

// Get (or initialize) the notebook for a character inside a notesData map.
// Mutates notesData if no book exists yet — call sites that want to
// preserve the map should clone before passing it.
function getNotebook(notesData, ownerId, charKey) {
  const key = noteKey(ownerId, charKey);
  if (!notesData[key]) notesData[key] = { nextId: 1, notes: [] };
  return notesData[key];
}

// Add a note. Returns the new note object on success, or { error } if the
// 100-note cap is hit. Mutates the notebook (push + increment nextId).
function addNote(notesData, ownerId, charKey, { category, text, pinned, authorId, authorName }) {
  const book = getNotebook(notesData, ownerId, charKey);
  if (book.notes.length >= MAX_NOTES_PER_CHARACTER) {
    return { error: `This character has reached the ${MAX_NOTES_PER_CHARACTER}-note limit. Remove some old notes first.` };
  }
  const note = {
    id: book.nextId++,
    category,
    text,
    pinned: !!pinned,
    createdAt: new Date().toISOString(),
    editedAt: null,
    authorId,
    authorName,
  };
  book.notes.push(note);
  return note;
}

// ── List formatting helpers ────────────────────────────────────────────────

// Sort order: pinned first, then newest first (by createdAt). Pure — does
// not mutate input.
function sortNotes(notes) {
  return [...notes].sort((a, b) => {
    if (a.pinned !== b.pinned) return b.pinned ? 1 : -1;
    return String(b.createdAt).localeCompare(String(a.createdAt));
  });
}

// Truncate text for list previews, preserving word boundaries when the
// last space is reasonably close to the cutoff.
function truncateNote(text, max = 120) {
  if (text.length <= max) return text;
  const slice = text.slice(0, max);
  const lastSpace = slice.lastIndexOf(' ');
  return (lastSpace > max * 0.7 ? slice.slice(0, lastSpace) : slice) + '…';
}

// Format a single note as one line of a list display: `#id 📌 preview...`
function formatNoteLine(note) {
  const pinTag = note.pinned ? '📌 ' : '';
  const preview = truncateNote(note.text, 100);
  return `\`#${note.id}\` ${pinTag}${preview}`;
}

module.exports = {
  NOTE_CATEGORIES,
  NOTE_CATEGORY_ORDER,
  MAX_NOTES_PER_CHARACTER,
  noteKey,
  getNotebook,
  addNote,
  sortNotes,
  truncateNote,
  formatNoteLine,
};
