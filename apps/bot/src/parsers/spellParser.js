// spellParser.js
// Parses a pasted Archives-of-Nethys-style spell statblock into the JSON shape
// used by spells.json. Tolerant of messy input; emits warnings rather than
// failing hard on missing fields.
//
// Input: one big string (the paste).
// Output: { ok, entry, slug, warnings, error }
//
// Expected layout (flexible; blank lines optional):
//
//   Fireball
//   Spell 3
//   Uncommon, Evocation, Fire
//   Traditions arcane, primal
//   Cast [two-actions] (somatic, verbal)
//   Range 500 feet; Area 20-foot burst
//   Saving Throw basic Reflex
//   You hurl a ball of fire... [description paragraph(s)]
//   Heightened (+1) The damage increases by 2d6.
//
// Every field is optional except the name and level line. Heuristics:
//   • First non-empty line = name
//   • "Spell N" / "Cantrip N" / "Focus N" = level/type detection
//   • Lines starting with known labels (Traditions, Cast, Range, etc.) are extracted
//   • Everything else accumulates into the description

'use strict';

function toSlug(name) {
  return String(name ?? '')
    .toLowerCase()
    .replace(/[''`]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function parseSpellStatBlock(raw) {
  const warnings = [];
  if (!raw || typeof raw !== 'string') {
    return { ok: false, error: 'Empty or invalid input.' };
  }

  // Normalize curly quotes, stray whitespace, and line endings
  const text = raw
    .replace(/[\u2018\u2019\u02bc]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\r\n?/g, '\n');

  // Strip any "Source ..." line by itself and keep its content; the parser
  // extracts source below from its own label regardless
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  if (lines.length === 0) return { ok: false, error: 'Empty input.' };

  // ── Line 1: name ──────────────────────────────────────────────────────────
  const name = lines[0];
  if (name.length < 2) return { ok: false, error: 'Could not detect a spell name on the first line.' };

  // ── Line 2 (usually): "Spell N", "Cantrip N", "Focus N", or "Focus Spell N"
  let level = null;
  let type = 'Spell';
  const levelLine = lines[1] ?? '';
  const levelMatch = levelLine.match(/^(spell|cantrip|focus(?:\s+spell)?|ritual)\s+(\d{1,2})\b/i);
  if (levelMatch) {
    const kind = levelMatch[1].toLowerCase();
    const n = Number(levelMatch[2]);
    level = `${n}`;
    if (kind.startsWith('cantrip')) type = 'Cantrip';
    else if (kind.startsWith('focus')) type = 'Focus';
    else if (kind.startsWith('ritual')) type = 'Ritual';
    else type = 'Spell';
  } else {
    warnings.push('Could not detect the spell rank/type. Expected a line like "Spell 3" or "Cantrip 1" just under the name.');
  }

  // Walk remaining lines and pull out labeled fields + description
  // Everything we don't recognize becomes part of the description.
  const labels = [
    'source', 'traits', 'traditions', 'cast', 'trigger', 'requirements',
    'range', 'area', 'targets', 'target', 'duration', 'saving throw',
    'defense', 'heightened'
  ];
  // Build a regex that matches "Label " at start of a line (case-insensitive)
  const labelRe = new RegExp(
    '^(' + labels.map(l => l.replace(/ /g, '\\s+')).join('|') + ')\\s+(.+)$',
    'i'
  );

  const fields = {
    source: '', traditions: '', rarity: '', traits: '',
    cast: '', trigger: '', range: '', area: '', target: '',
    duration: '', defense: '', heightened: '', description: ''
  };
  const descParts = [];

  // Skip the first two lines (name + level line if matched).
  // If level line didn't match, still skip just the name.
  const startIdx = levelMatch ? 2 : 1;

  // Detect a traits line right after the level line: a comma-separated line
  // with short words and no label prefix, and contains a rarity or trait keyword.
  const RARITIES = ['common', 'uncommon', 'rare', 'unique'];
  if (startIdx < lines.length && !labelRe.test(lines[startIdx])) {
    const candidate = lines[startIdx];
    const looksLikeTraits =
      candidate.includes(',') &&
      candidate.split(',').every(part => part.trim().split(/\s+/).length <= 4) &&
      candidate.length < 200;
    if (looksLikeTraits) {
      const traits = candidate.split(',').map(s => s.trim()).filter(Boolean);
      const lower = traits.map(t => t.toLowerCase());
      const rarityIdx = lower.findIndex(t => RARITIES.includes(t));
      if (rarityIdx >= 0) {
        fields.rarity = traits[rarityIdx].charAt(0).toUpperCase() + traits[rarityIdx].slice(1).toLowerCase();
        traits.splice(rarityIdx, 1);
      } else {
        fields.rarity = 'Common';
      }
      fields.traits = (fields.rarity !== 'Common' ? [fields.rarity, ...traits] : traits).join(', ');
      // Advance past the traits line
      processRemaining(lines.slice(startIdx + 1));
    } else {
      processRemaining(lines.slice(startIdx));
    }
  } else {
    processRemaining(lines.slice(startIdx));
  }

  function processRemaining(rest) {
    // Allow lines like "Range 60 feet; Targets 1 creature" to split into two
    // labeled segments. Only do this if every segment parses as a label.
    const expanded = [];
    for (const line of rest) {
      const segs = line.split(/;\s+/);
      if (segs.length > 1 && segs.every(s => labelRe.test(s))) {
        expanded.push(...segs);
      } else {
        expanded.push(line);
      }
    }
    for (const line of expanded) {
      const m = line.match(labelRe);
      if (m) {
        const label = m[1].toLowerCase().replace(/\s+/g, ' ');
        const value = m[2].trim();
        switch (label) {
          case 'source':        fields.source = value; break;
          case 'traditions':    fields.traditions = value; break;
          case 'traits':
            if (!fields.traits) fields.traits = value;
            break;
          case 'cast':          fields.cast = value; break;
          case 'trigger':       fields.trigger = value; break;
          case 'requirements':  fields.trigger = fields.trigger ? `${fields.trigger}; Requirements ${value}` : `Requirements ${value}`; break;
          case 'range':         fields.range = value; break;
          case 'area':          fields.area = value; break;
          case 'target':
          case 'targets':       fields.target = value; break;
          case 'duration':      fields.duration = value; break;
          case 'saving throw':
          case 'defense':       fields.defense = value; break;
          case 'heightened':    fields.heightened = value; break;
          default:              descParts.push(line);
        }
      } else {
        descParts.push(line);
      }
    }
  }

  fields.description = descParts.join('\n').trim();

  // Final validations / default fills
  if (!fields.rarity) fields.rarity = 'Common';
  if (!fields.traditions) warnings.push('No Traditions line detected. Set one with /spelledit later if needed.');
  if (!fields.description) warnings.push('No description text detected.');

  const entry = {
    name,
    source: fields.source || 'Homebrew',
    traditions: fields.traditions,
    rarity: fields.rarity,
    traits: fields.traits,
    type,
    level: level ?? '',
    heightened: fields.heightened,
    summary: fields.description.slice(0, 400),
    description: fields.description,
    cast: fields.cast,
    trigger: fields.trigger,
    target: fields.target,
    range: fields.range,
    area: fields.area,
    duration: fields.duration,
    defense: fields.defense,
    damage: { base: '', type: '', extra: '' },
    heightening: null,
    rolls: [],
    _homebrew: true,
  };

  return { ok: true, entry, slug: toSlug(name), warnings };
}

module.exports = {
  parseSpellStatBlock,
  toSlug,
};