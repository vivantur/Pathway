// itemParser.js
// Parses a pasted Archives-of-Nethys-style item statblock into the JSON shape
// used by items.json's `items` map. Same tolerance/warnings philosophy as
// spellParser.js.
//
// Expected layout (flexible):
//
//   Flaming Rapier
//   Item 8
//   Uncommon, Fire, Magical
//   Price 500 gp
//   Usage held in 1 hand; Bulk 1
//   Category Weapons; Subcategory Specific Magic Weapons
//   A slim, crackling rapier etched with... [description]
//   Activate [one-action] command; The flame flares...
//
// Minimally required: name + "Item N" line. Everything else optional.

'use strict';

function toSlug(name) {
  return String(name ?? '')
    .toLowerCase()
    .replace(/[''`]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Convert a price string like "500 gp", "1 sp 5 cp", or "2 pp" to copper.
function parsePriceToCp(raw) {
  if (!raw) return null;
  const s = String(raw).toLowerCase().replace(/,/g, '');
  let cp = 0;
  let matched = false;
  const units = [
    { re: /(\d+(?:\.\d+)?)\s*pp/, mul: 1000 },
    { re: /(\d+(?:\.\d+)?)\s*gp/, mul: 100 },
    { re: /(\d+(?:\.\d+)?)\s*sp/, mul: 10 },
    { re: /(\d+(?:\.\d+)?)\s*cp/, mul: 1 },
  ];
  for (const u of units) {
    const m = s.match(u.re);
    if (m) {
      cp += Math.round(parseFloat(m[1]) * u.mul);
      matched = true;
    }
  }
  return matched ? cp : null;
}

// Normalize bulk text into { raw, normalized }.
function parseBulk(raw) {
  if (!raw) return { raw: null, normalized: null };
  const s = String(raw).trim();
  const lower = s.toLowerCase();
  if (lower === 'l' || lower === 'light') return { raw: 'L', normalized: 'light' };
  if (lower === '—' || lower === '-' || lower === '0' || lower === 'negligible') {
    return { raw: '—', normalized: 'negligible' };
  }
  // Numeric bulk like "1", "2", "1.5"
  const num = parseFloat(s);
  if (!Number.isNaN(num)) return { raw: s, normalized: String(num) };
  return { raw: s, normalized: s.toLowerCase() };
}

function parseItemStatBlock(raw) {
  const warnings = [];
  if (!raw || typeof raw !== 'string') {
    return { ok: false, error: 'Empty or invalid input.' };
  }

  const text = raw
    .replace(/[\u2018\u2019\u02bc]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\r\n?/g, '\n');
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) return { ok: false, error: 'Empty input.' };

  // Line 1 = name
  const name = lines[0];
  if (name.length < 2) return { ok: false, error: 'Could not detect an item name on the first line.' };

  // Line 2 (usually): "Item N"
  let level = null;
  const levelLine = lines[1] ?? '';
  const levelMatch = levelLine.match(/^item\s+(\d{1,2})\b/i);
  if (levelMatch) {
    level = Number(levelMatch[1]);
  } else {
    warnings.push('Could not detect the item level. Expected a line like "Item 5" just under the name.');
  }

  // Detect traits line (comma-separated, short terms, no label prefix).
  const RARITIES = ['common', 'uncommon', 'rare', 'unique'];
  let rarity = 'Common';
  let traits = [];
  const startIdx = levelMatch ? 2 : 1;
  let cursor = startIdx;

  if (cursor < lines.length) {
    const candidate = lines[cursor];
    const looksLikeTraits =
      /,/.test(candidate) &&
      candidate.split(',').every(p => p.trim().split(/\s+/).length <= 4) &&
      !/^[A-Z][a-z]+\s/.test(candidate.split(',')[0].trim().split(' ').length > 3 ? candidate : '') &&
      candidate.length < 200;
    if (looksLikeTraits) {
      const parts = candidate.split(',').map(s => s.trim()).filter(Boolean);
      const lower = parts.map(p => p.toLowerCase());
      const rIdx = lower.findIndex(p => RARITIES.includes(p));
      if (rIdx >= 0) {
        rarity = parts[rIdx][0].toUpperCase() + parts[rIdx].slice(1).toLowerCase();
        parts.splice(rIdx, 1);
      }
      traits = parts;
      cursor++;
    }
  }

  // Now extract labeled fields from the rest
  const labels = ['source', 'price', 'usage', 'bulk', 'category', 'subcategory', 'pfs', 'campaign'];
  const labelRe = new RegExp('^(' + labels.join('|') + ')\\s+(.+)$', 'i');

  const fields = {
    source_text: '', price_raw: '', usage: '', bulk_raw: '',
    category: '', subcategory: '', pfs_availability: '', campaign: ''
  };
  const descParts = [];

  for (const line of lines.slice(cursor)) {
    // A line may contain multiple labels separated by semicolons (e.g. "Usage held in 1 hand; Bulk 1")
    const segments = line.split(/;\s+/);
    let allLabeled = true;
    const segResults = [];
    for (const seg of segments) {
      const m = seg.match(labelRe);
      if (m) segResults.push(m);
      else   { allLabeled = false; break; }
    }
    if (allLabeled && segResults.length > 0) {
      for (const m of segResults) {
        const label = m[1].toLowerCase();
        const value = m[2].trim();
        switch (label) {
          case 'source':       fields.source_text = value; break;
          case 'price':        fields.price_raw = value; break;
          case 'usage':        fields.usage = value; break;
          case 'bulk':         fields.bulk_raw = value; break;
          case 'category':     fields.category = value; break;
          case 'subcategory':  fields.subcategory = value; break;
          case 'pfs':          fields.pfs_availability = value; break;
          case 'campaign':     fields.campaign = value; break;
        }
      }
    } else {
      descParts.push(line);
    }
  }

  const description = descParts.join('\n').trim();
  const bulk = parseBulk(fields.bulk_raw);
  const price_cp = parsePriceToCp(fields.price_raw);

  // Build source object in the shape items.json uses
  let source = null;
  if (fields.source_text) {
    const pageMatch = fields.source_text.match(/pg\.?\s*(\d+)/i);
    const bookText = fields.source_text.replace(/\s*pg\.?\s*\d+$/i, '').trim();
    source = {
      book: bookText || fields.source_text,
      page: pageMatch ? Number(pageMatch[1]) : null,
      source_text: fields.source_text
    };
  } else {
    source = { book: 'Homebrew', page: null, source_text: 'Homebrew' };
  }

  if (!fields.category) warnings.push('No Category detected. Set one with /itemedit later if needed.');
  if (!fields.price_raw) warnings.push('No Price detected.');
  if (!fields.bulk_raw) warnings.push('No Bulk detected.');

  const entry = {
    id: toSlug(name),
    name,
    lookup_name: name.toLowerCase(),
    pfs_availability: fields.pfs_availability || null,
    source,
    rarity,
    traits,
    category: fields.category || null,
    subcategory: fields.subcategory || null,
    level: level ?? null,
    price_raw: fields.price_raw || null,
    price_cp: price_cp,
    bulk_raw: bulk.raw,
    bulk_normalized: bulk.normalized,
    usage: fields.usage || null,
    campaign: fields.campaign || null,
    notes: description || null,
    _homebrew: true,
  };

  return { ok: true, entry, slug: entry.id, warnings };
}

module.exports = {
  parseItemStatBlock,
  toSlug,
  parsePriceToCp,
  parseBulk,
};