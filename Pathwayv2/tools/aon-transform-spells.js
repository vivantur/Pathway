// tools/aon-transform-spells.js
//
// Phase 2 of the AoN sync pipeline: transforms raw AoN spell documents into
// the JSON shape your bot expects in gamedata/spells.json.
//
// Reads:  gamedata/aon-raw/spell.json   (created by tools/aon-fetch.js)
// Writes: gamedata/spells.json
//
// Preserves homebrew: any existing entries in gamedata/spells.json marked
// custom: true are kept untouched and merged in at the end. AoN entries
// with the same name as a homebrew lose to the homebrew (your custom data
// wins — exactly the same behavior as your existing covertspells.js).
//
// Why a custom transformer instead of just dumping AoN's data?
//   • Your bot's normalizeSpell() expects specific fields: traditions,
//     traits, defense (the save), damage, heightening — but AoN exposes
//     traditions/trait/saving_throw with different names and shapes.
//   • AoN doesn't expose damage as a structured field at all — it's
//     buried in the markdown text. We extract it with regex.
//   • Your bot expects clean strings for cast/range/area/duration; AoN
//     mixes structured arrays + raw strings.
//
// USAGE:
//   node tools/aon-transform-spells.js              # transform & write
//   node tools/aon-transform-spells.js --dry-run    # show what would happen, don't write
//   node tools/aon-transform-spells.js --verbose    # log every spell as it processes

'use strict';

const fs = require('fs');
const path = require('path');

const DRY_RUN  = process.argv.includes('--dry-run');
const VERBOSE  = process.argv.includes('--verbose');

const RAW_FILE = path.join(__dirname, '..', 'gamedata', 'aon-raw', 'spell.json');
const OUT_FILE = path.join(__dirname, '..', 'gamedata', 'spells.json');

// ── Helpers ─────────────────────────────────────────────────────────────────

// Pull just the descriptive text from AoN's markdown. AoN's markdown
// structure is consistently:
//   <title>...</title>
//   <traits>...</traits>
//   metadata (Source, Traditions, Cast, Range, Area, Saving Throw, etc.)
//   ---
//   <DESCRIPTION TEXT>
//   ---
//   **Heightened (+N)** ...
//
// We split on `---` markers and grab the middle section. If we can't find
// markers, fall back to the `summary` or empty string.
function extractDescription(raw) {
  if (!raw.markdown || typeof raw.markdown !== 'string') {
    return raw.summary || '';
  }
  // Strip AoN-specific tags first so they don't pollute the description
  let md = raw.markdown
    .replace(/<title[^>]*>[\s\S]*?<\/title>/g, '')
    .replace(/<traits>[\s\S]*?<\/traits>/g, '')
    .replace(/<\/column>\s*<column[^>]*>/g, ' | ')
    .replace(/<column[^>]*>/g, '')
    .replace(/<\/column>/g, '')
    .replace(/<row[^>]*>/g, '\n')
    .replace(/<\/row>/g, '\n')
    .replace(/<actions[^/]*\/>/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')   // [text](link) → text
    .replace(/<additional-info>[\s\S]*?<\/additional-info>/g, '')
    .replace(/<summary>([\s\S]*?)<\/summary>/g, '$1')
    .replace(/<[^>]+>/g, '')                    // strip remaining tags
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n');

  // Now split on the "---" separator. Description is between the first and
  // (optional) second separator.
  const parts = md.split(/\n\s*---\s*\n/);
  if (parts.length >= 2) {
    // Everything from index 1 onward — concatenate all middle sections so
    // we keep heightening info that comes after a second `---`.
    return parts.slice(1).join('\n\n').trim();
  }
  return md.trim() || raw.summary || '';
}

// Try to extract damage information from a spell's markdown. Returns
// { base: '6d6', type: 'fire', extra: '' } or null. We look for patterns like:
//   "dealing 6d6 fire damage"
//   "takes 4d6 cold damage"
//   "1d4+1 piercing damage"
// AoN spells have inconsistent phrasing, so we cast a wide net and pick the
// FIRST dice expression we find.
function extractDamage(raw) {
  const md = raw.markdown || raw.text || '';
  if (!md) return null;

  // Common patterns (case-insensitive). We try these in order of confidence.
  const patterns = [
    // "dealing 6d6 fire damage"
    /dealing\s+(\d+d\d+(?:\s*[+\-]\s*\d+)?)\s+([a-z]+(?:\s+(?:and|or|plus)\s+[a-z]+)?)\s+damage/i,
    // "takes 4d6 cold damage"
    /takes?\s+(\d+d\d+(?:\s*[+\-]\s*\d+)?)\s+([a-z]+)\s+damage/i,
    // "deal 1d4 piercing damage"
    /deals?\s+(\d+d\d+(?:\s*[+\-]\s*\d+)?)\s+([a-z]+)\s+damage/i,
    // Bare "Xd6 fire damage" anywhere
    /(\d+d\d+(?:\s*[+\-]\s*\d+)?)\s+([a-z]+)\s+damage/i,
    // Variable or contextual damage type: "deals 2d10 damage"
    /\b(?:deals?|dealing|takes?|taking|suffers?)\s+(\d+d\d+(?:\s*[+\-]\s*\d+)?)\s+damage\b/i,
  ];

  for (const re of patterns) {
    const m = md.match(re);
    if (m) {
      return {
        base: m[1].replace(/\s+/g, ''),
        type: m[2] ? m[2].trim().toLowerCase() : inferDamageType(raw),
        extra: '',
      };
    }
  }
  return null;
}

function inferDamageType(raw) {
  const traits = asArray(raw.trait).map(t => String(t).toLowerCase());
  const known = [
    'acid', 'bleed', 'bludgeoning', 'cold', 'electricity', 'fire', 'force',
    'mental', 'negative', 'piercing', 'poison', 'positive', 'precision',
    'slashing', 'sonic', 'spirit', 'vitality', 'void',
  ];
  return known.find(type => traits.includes(type)) || null;
}

// Parse heightening from AoN's `heighten` array + the markdown text.
// AoN's `heighten` field tells us the structure:
//   ["+1"]                           → per-rank: heightened by 1 each rank
//   ["+2"]                           → per-rank: heightened by 2 each rank
//   ["3rd","5th","7th","9th"]        → fixed levels
// And the markdown has the actual content like "**Heightened (+1)** ..."
function extractHeightening(raw) {
  const md = raw.markdown || raw.text || '';
  if (!md) return null;

  // Per-rank pattern: "Heightened (+1) The damage increases by 2d6."
  const perRank = md.match(/\*?\*?Heightened\s*\(\s*\+(\d+)\s*\)\*?\*?\s+(.+?)(?:\n|$)/i);
  if (perRank) {
    // Try to extract the bonus dice: "increases by 2d6" or "by 1d8"
    const dice = perRank[2].match(/(\d+d\d+)/);
    return {
      type: 'per_rank',
      step: parseInt(perRank[1]) || 1,
      damage_bonus: dice ? dice[1] : null,
      extra_text: perRank[2].trim(),
    };
  }

  // Fixed-rank pattern: "**Heightened (5th)** ..." can appear multiple times
  const fixedMatches = [...md.matchAll(/\*?\*?Heightened\s*\(\s*(\d+(?:st|nd|rd|th)?)\s*\)\*?\*?\s+(.+?)(?=\n\n|\*\*Heightened|$)/gi)];
  if (fixedMatches.length > 0) {
    const levels = {};
    for (const m of fixedMatches) {
      const rank = m[1].replace(/[a-z]/gi, '');
      levels[rank] = m[2].trim();
    }
    return { type: 'fixed', levels };
  }

  return null;
}

// Normalize a list-or-string field. AoN often has both a structured array
// (e.g. `tradition: ["Arcane", "Primal"]`) and a markdown version.
function asArray(v) {
  if (Array.isArray(v)) return v.filter(Boolean);
  if (typeof v === 'string') return v.split(',').map(s => s.trim()).filter(Boolean);
  return [];
}

// Pretty action-cost label. AoN uses verbose text ("Two Actions") and a
// numeric code (`actions_number` 1-4 + reaction/free). We pass the verbose
// text through unchanged — your bot's normalizeSpell handles anything truthy.
function actionsToCast(raw) {
  return raw.actions || null;
}

// Map AoN spell_type to your bot's `type` field.
//   "Spell"   → "Spell"
//   "Cantrip" → "Cantrip"
//   "Focus"   → "Focus"
//   "Ritual"  → "Ritual"
function spellTypeFor(raw) {
  return raw.spell_type || raw.type || 'Spell';
}

// AoN's `saving_throw` is a string like "basic Reflex" or "Will" — which is
// EXACTLY the format your bot's normalizeSpell expects in the `defense` field.
// (It splits "basic Reflex" → saveType="Reflex", saveIsBasic=true.)
function deriveDefense(raw) {
  if (raw.saving_throw && typeof raw.saving_throw === 'string') {
    return raw.saving_throw.trim().replace(/\s+/g, ' ');
  }
  // Some spells are spell-attack rolls. AoN doesn't have an explicit field;
  // we detect this via traits or markdown.
  const traits = asArray(raw.trait).map(t => t.toLowerCase());
  const md = (raw.markdown || '').toLowerCase();
  if (md.includes('spell attack roll') || md.includes('ranged spell attack') || md.includes('melee spell attack')) {
    return 'AC';
  }
  return null;
}

// AoN gives us area as a structured array `[20]` plus `area_raw` "20-foot burst".
// The bot prefers the human-readable string.
function deriveArea(raw) {
  return raw.area_raw || (Array.isArray(raw.area) && raw.area_type ? `${raw.area[0]}-foot ${raw.area_type[0] || ''}`.trim() : null);
}

// AoN exposes most spell durations as both seconds and a human-readable
// `duration_raw`. Keep the readable version for Discord, and fall back to
// the markdown line for any odd entries that only expose it there.
function deriveDuration(raw) {
  if (raw.duration_raw && typeof raw.duration_raw === 'string') {
    return raw.duration_raw.trim().replace(/\s+/g, ' ');
  }
  if (raw.duration !== undefined && raw.duration !== null && raw.duration !== '') {
    const seconds = Number(raw.duration);
    if (Number.isFinite(seconds)) {
      if (seconds === 0) return null;
      if (seconds % 3600 === 0) return `${seconds / 3600} hour${seconds === 3600 ? '' : 's'}`;
      if (seconds % 60 === 0) return `${seconds / 60} minute${seconds === 60 ? '' : 's'}`;
      if (seconds % 6 === 0) return `${seconds / 6} round${seconds === 6 ? '' : 's'}`;
      return `${seconds} second${seconds === 1 ? '' : 's'}`;
    }
    return String(raw.duration).trim().replace(/\s+/g, ' ') || null;
  }

  const md = raw.markdown || raw.text || '';
  const match = md.match(/(?:^|\n)\s*\*?\*?Duration\*?\*?\s+([^\n<]+)/i);
  return match ? match[1].trim().replace(/\s+/g, ' ') : null;
}

// AoN's component field is an array like ["somatic", "verbal"]. Bot expects
// a `cast` string, but we'd rather keep it as the action cost text and put
// components elsewhere. Stick to the action cost string for `cast`.
// (Components live in raw.component if anyone ever needs them.)

// ── Main transformer ────────────────────────────────────────────────────────

function transformSpell(raw) {
  // Only convert real spell entries (skip the few odd entries with no name)
  if (!raw || !raw.name) return null;

  // The raw spell_type is what determines Spell vs Cantrip vs Focus vs Ritual.
  // Bot's normalizeSpell also re-checks via traits — both work.
  const traditions = asArray(raw.tradition);
  const traits = asArray(raw.trait);
  const heightening = extractHeightening(raw);
  let damage = extractDamage(raw);

  if (!damage && String(spellTypeFor(raw)).toLowerCase() === 'cantrip' && heightening?.damage_bonus) {
    damage = {
      base: heightening.damage_bonus,
      type: inferDamageType(raw),
      extra: '',
    };
  }

  return {
    name: raw.name,
    level: typeof raw.level === 'number' ? raw.level : parseInt(raw.level) || 1,
    type: spellTypeFor(raw),
    traditions,
    traits,
    rarity: raw.rarity || 'common',
    school: raw.school || null,
    cast: actionsToCast(raw),
    range: raw.range_raw || null,
    area: deriveArea(raw),
    target: null,                // AoN doesn't expose target as a structured field; description has it
    duration: deriveDuration(raw),
    defense: deriveDefense(raw),
    damage,
    heightening,
    description: extractDescription(raw),
    summary: raw.summary || null,
    source: raw.primary_source_raw || raw.primary_source || (Array.isArray(raw.source) ? raw.source[0] : raw.source) || null,
    aon_url: raw.url ? `https://2e.aonprd.com${raw.url}` : null,
    aon_id: raw.id || null,
    custom: false,
    _aon_imported: true,
    _aon_imported_at: new Date().toISOString(),
  };
}

// ── Driver ──────────────────────────────────────────────────────────────────

async function main() {
  console.log('🔄 AoN spell transformer\n');

  // 1. Load raw AoN data
  if (!fs.existsSync(RAW_FILE)) {
    console.error(`❌ Raw file not found: ${RAW_FILE}`);
    console.error('   Run \`node tools/aon-fetch.js spell\` first.');
    process.exit(1);
  }
  const raw = JSON.parse(fs.readFileSync(RAW_FILE, 'utf8'));
  console.log(`📂 Loaded ${raw.length.toLocaleString()} raw spells from aon-raw/spell.json`);

  // 2. Transform each spell. Track failures so we can report them.
  let transformed = [];
  let skipped = 0;
  let damageFound = 0;
  let saveDetected = 0;
  let attackDetected = 0;
  let durationDetected = 0;
  for (const r of raw) {
    const t = transformSpell(r);
    if (!t) { skipped++; continue; }
    transformed.push(t);
    if (t.damage) damageFound++;
    if (t.defense && t.defense !== 'AC') saveDetected++;
    if (t.defense === 'AC') attackDetected++;
    if (t.duration) durationDetected++;
    if (VERBOSE) console.log(`   ✓ ${t.name} (level ${t.level} ${t.type})`);
  }
  console.log(`✅ Transformed ${transformed.length.toLocaleString()} spells (skipped ${skipped})`);
  console.log(`   • ${damageFound.toLocaleString()} have damage detected`);
  console.log(`   • ${saveDetected.toLocaleString()} have a save defense`);
  console.log(`   • ${attackDetected.toLocaleString()} are attack-roll spells`);

  console.log(`   • ${durationDetected.toLocaleString()} have duration detected`);

  // 3. Preserve any existing homebrew. We read the current spells.json (if
  // it exists), filter for custom: true, and merge those on top of the
  // AoN data — homebrew wins ties on name.
  let homebrew = [];
  if (fs.existsSync(OUT_FILE)) {
    try {
      const existing = JSON.parse(fs.readFileSync(OUT_FILE, 'utf8'));
      if (Array.isArray(existing)) {
        homebrew = existing.filter(s => s && s.custom === true);
      }
    } catch (err) {
      console.warn(`⚠️  could not read existing spells.json (${err.message}) — starting fresh`);
    }
  }
  if (homebrew.length > 0) {
    console.log(`🛡️  Preserving ${homebrew.length} homebrew spell${homebrew.length === 1 ? '' : 's'}`);
    const homebrewNames = new Set(homebrew.map(s => (s.name || '').toLowerCase()));
    transformed = transformed.filter(s => !homebrewNames.has(s.name.toLowerCase()));
  }

  // 4. Combine and sort alphabetically
  const final = [...transformed, ...homebrew].sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  // 5. Write (unless dry run)
  if (DRY_RUN) {
    console.log(`\n🚫 --dry-run: would write ${final.length.toLocaleString()} spells to ${OUT_FILE}`);
    console.log(`   (file size estimate: ~${Math.round(JSON.stringify(final).length / 1024)} KB)`);
  } else {
    fs.writeFileSync(OUT_FILE, JSON.stringify(final, null, 2), 'utf8');
    console.log(`\n✨ Wrote ${final.length.toLocaleString()} spells to ${OUT_FILE}`);
    console.log(`   (${(JSON.stringify(final).length / (1024 * 1024)).toFixed(1)} MB)`);
  }

  // 6. Print a few sample entries for sanity checking
  console.log('\n📋 Sample entries:');
  for (const name of ['Fireball', 'Heal', 'Bane', 'Magic Missile', 'Acid Splash']) {
    const s = final.find(x => x.name === name);
    if (s) {
      const dmg = s.damage ? `${s.damage.base} ${s.damage.type}` : 'no damage';
      const def = s.defense || 'no defense';
      console.log(`   • ${s.name.padEnd(20)} L${s.level} ${s.type.padEnd(8)} | ${dmg.padEnd(20)} | ${def}`);
    }
  }
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
