// utils/ancestryParser.js
// Parses the messy "description" field from AoN-imported ancestries.json into
// labeled sections (Description, Edicts, Anathema, Physical Description, etc.)
// so /ancestry's Core page can render structured fields instead of one giant
// wall of text with stripped section headers.
//
// Also provides field-name normalization helpers because the AoN importer
// uses `hit_points` while the original schema used `hp`.

const SECTION_LABELS = [
  'Description',
  'You Might...',
  'Others Probably...',
  'Physical Description',
  'Society',
  'Beliefs',
  'Names',
];

const ABILITY_NAMES = new Set([
  'Strength', 'Dexterity', 'Constitution',
  'Intelligence', 'Wisdom', 'Charisma', 'Free',
]);

const SIZE_WORDS = new Set(['Tiny', 'Small', 'Medium', 'Large', 'Huge']);

/**
 * The AoN importer dumps duplicate copies of every mechanical field at the
 * end of the description (HP as bare number, size as word, speed as "X feet",
 * boost list, flaw, languages, vision). We strip these because they're already
 * shown on the embed as proper fields with icons.
 */
function isDuplicateMechanics(chunk) {
  const s = chunk.trim();
  if (/^\d+$/.test(s)) return true;                       // bare HP number
  if (SIZE_WORDS.has(s)) return true;                     // bare size word
  if (/^\d+\s*feet?$/i.test(s)) return true;              // speed
  if (ABILITY_NAMES.has(s)) return true;                  // single ability (the flaw)

  // Comma-separated abilities only (boosts list)
  const parts = s.split(/[,;]/).map(p => p.trim());
  if (parts.length >= 2 && parts.every(p => ABILITY_NAMES.has(p))) return true;

  // "Two free ability boosts" style
  if (/^(One|Two|Three) free ability/i.test(s)) return true;

  // Languages duplicate block
  if (s.includes('Additional languages equal to') && s.length < 400) return true;

  // Vision duplicate (we already render ancestry.vision)
  const lower = s.toLowerCase();
  if ((lower.includes('see in dim light') || lower.includes('see in darkness')) && s.length < 250) {
    return true;
  }

  return false;
}

/**
 * Detect a "sample names" chunk by content rather than position. Some entries
 * have a Names *intro* paragraph followed by a sample list; others skip the
 * intro. The list always looks like "Comma, Separated, Capitalized, Words".
 */
function isSampleNames(chunk) {
  const s = chunk.trim();
  if (s.length > 300) return false;
  if (/\.\s+[A-Z]/.test(s)) return false; // sentence breaks → not a list
  const parts = s.split(',').map(p => p.trim()).filter(Boolean);
  if (parts.length < 3) return false;
  const cap = parts.filter(p => p && /^[A-Z]/.test(p)).length;
  return cap >= parts.length * 0.7;
}

/**
 * Strip the leading "**Source** ... pg. NN" line and italic summary
 * (`_Half-elves often appear..._`) from the first chunk so the description
 * starts with the real lore paragraph.
 */
function cleanLoreChunk(chunk) {
  return chunk
    .replace(/^\s*\*\*Source\*\*\s+[^\n]+/i, '')
    .replace(/^\s*_[^_]+_/, '')
    .trim();
}

function cleanSectionContent(label, chunk) {
  const cleaned = chunk
    .replace(/([.!?])(?=[A-Z])/g, '$1\n')
    .trim();

  if (label === 'You Might...' || label === 'Others Probably...') {
    const lines = cleaned
      .split(/\n+/)
      .map(s => s.trim())
      .filter(Boolean)
      .map(s => s.startsWith('•') ? s : `• ${s}`);
    return lines.join('\n');
  }

  return cleaned;
}

/**
 * Parse a raw AoN-imported description into [{label, content}] sections.
 * Returns an empty array if the description is empty or unparseable.
 */
function parseDescription(rawDescription) {
  if (!rawDescription || typeof rawDescription !== 'string') return [];

  // Split on triple+ blank lines (the AoN importer separates sections this way).
  let chunks = rawDescription
    .split(/(?:\r?\n\s*){3,}/)
    .map(c => c.trim())
    .filter(c => c && !c.startsWith('\r'));

  if (!chunks.length) return [];

  // Clean Source/summary off the first chunk
  chunks[0] = cleanLoreChunk(chunks[0]);

  // Drop chunks that are duplicated mechanical fields
  chunks = chunks.filter(c => c && !isDuplicateMechanics(c));

  // Walk and assign labels
  const sections = [];
  let labelIdx = 0;
  let sampleNamesFound = false;
  for (const chunk of chunks) {
    if (!chunk) continue;
    if (isSampleNames(chunk) && !sampleNamesFound) {
      sections.push({ label: 'Sample Names', content: cleanSectionContent('Sample Names', chunk) });
      sampleNamesFound = true;
    } else if (labelIdx < SECTION_LABELS.length) {
      const label = SECTION_LABELS[labelIdx];
      sections.push({ label, content: cleanSectionContent(label, chunk) });
      labelIdx++;
    } else {
      sections.push({ label: 'Special Ability', content: cleanSectionContent('Special Ability', chunk) });
    }
  }
  return sections;
}

/**
 * Normalize HP across both schemas (`hp` from old hand-written entries,
 * `hit_points` from the AoN import). Returns null for entries where HP isn't
 * a positive number — this is intentional for versatile heritages like
 * Aasimar/Dhampir/Tiefling that inherit HP from a parent ancestry.
 */
function getAncestryHp(ancestry) {
  if (!ancestry) return null;
  const v = ancestry.hp ?? ancestry.hit_points;
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Whether this entry has heritage data worth rendering. AoN import doesn't
 * include heritages, so the button should hide for those entries.
 */
function hasHeritages(ancestry) {
  return Array.isArray(ancestry?.heritages) && ancestry.heritages.length > 0;
}

/**
 * Whether this entry has ancestry feat data worth rendering. Same deal.
 */
function hasAncestryFeats(ancestry) {
  return Array.isArray(ancestry?.ancestry_feats) && ancestry.ancestry_feats.length > 0;
}

module.exports = {
  parseDescription,
  getAncestryHp,
  hasHeritages,
  hasAncestryFeats,
};
