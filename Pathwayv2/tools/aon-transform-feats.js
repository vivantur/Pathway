// tools/aon-transform-feats.js
//
// Phase 2 of the AoN sync pipeline: transforms raw AoN feat documents into
// the JSON shape your bot expects in gamedata/feats.json.
//
// Reads:  gamedata/aon-raw/feat.json  (created by tools/aon-fetch.js)
// Writes: gamedata/feats.json
//
// Preserves homebrew: any existing entries in gamedata/feats.json marked
// custom: true are kept untouched. AoN entries with the same name as a
// homebrew lose to the homebrew (your custom data wins) — same pattern as
// aon-transform-spells.js and your existing covertspells.js.
//
// Bot fields produced (from index.js buildFeatEmbed and findFeat):
//   name              — required, used for matching
//   level             — required, used for level filter
//   rarity            — Common/Uncommon/Rare/Unique (capitalized)
//   traits            — array of strings (no "Common" — that's a rarity)
//   description       — body text (no metadata, no markdown wrappers)
//   prerequisites     — string; combines AoN's prerequisite + frequency + trigger + requirement
//   action_tag_full   — one_action / two_actions / three_actions / reaction / free_action
//   source            — primary source citation
//   pfs_access        — Standard/Limited/Restricted
//   lookup_name       — lowercase name for matching
//   custom            — false (AoN data); homebrew sets true
//
// USAGE:
//   node tools/aon-transform-feats.js               # transform & write
//   node tools/aon-transform-feats.js --dry-run     # show what would happen
//   node tools/aon-transform-feats.js --verbose     # log every feat as it processes

'use strict';

const fs = require('fs');
const path = require('path');

const DRY_RUN = process.argv.includes('--dry-run');
const VERBOSE = process.argv.includes('--verbose');

const RAW_FILE = path.join(__dirname, '..', 'gamedata', 'aon-raw', 'feat.json');
const OUT_FILE = path.join(__dirname, '..', 'gamedata', 'feats.json');

// ── Helpers ─────────────────────────────────────────────────────────────────

// Capitalize first letter of a string (AoN gives us lowercase rarities like
// "common", "uncommon", "rare", "unique"; bot expects them capitalized).
function capitalize(s) {
  if (!s || typeof s !== 'string') return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Convert AoN's verbose action text to the bot's snake_case enum.
//   "Single Action"        → one_action
//   "Two Actions"          → two_actions
//   "Three Actions"        → three_actions
//   "Reaction"             → reaction
//   "Free Action"          → free_action
//   "Single Action to Three Actions" (variable) → multiple
// Returns null if the feat is passive (no actions).
function actionTagFor(actionsText) {
  if (!actionsText) return null;
  const t = String(actionsText).trim().toLowerCase();
  if (t === 'single action' || t === 'one action') return 'one_action';
  if (t === 'two actions') return 'two_actions';
  if (t === 'three actions') return 'three_actions';
  if (t === 'reaction') return 'reaction';
  if (t === 'free action') return 'free_action';
  // Variable / "to" syntax (e.g. "Single Action to Three Actions") — pass through verbatim
  // so the embed shows the actual phrase rather than a misleading icon.
  if (t.includes(' to ')) return null;
  return null;
}

// Combine AoN's prerequisite + frequency + trigger + requirement into one
// "Prerequisites" block. Each piece gets a labeled prefix when present, so
// the embed reads naturally:
//   Prerequisites: trained in Acrobatics
//   Frequency: once per day
//   Trigger: While you have your shield raised...
//   Requirement: You must be wielding a shield.
function buildPrerequisites(raw) {
  const parts = [];
  if (raw.prerequisite && String(raw.prerequisite).trim()) {
    parts.push(String(raw.prerequisite).trim());
  }
  if (raw.frequency && String(raw.frequency).trim()) {
    parts.push(`**Frequency** ${String(raw.frequency).trim()}`);
  }
  if (raw.trigger && String(raw.trigger).trim()) {
    parts.push(`**Trigger** ${String(raw.trigger).trim()}`);
  }
  if (raw.requirement && String(raw.requirement).trim()) {
    parts.push(`**Requirements** ${String(raw.requirement).trim()}`);
  }
  return parts.length > 0 ? parts.join('\n') : null;
}

// Pull just the descriptive body text out of AoN's markdown. AoN's structure:
//   <title>...</title>
//   <traits>...</traits>
//   metadata block (Source, Archetypes, etc.)
//   ---
//   <DESCRIPTION TEXT>
//
// Same approach as aon-transform-spells.js but feats often have multiple
// "---" sections for special cases (success/failure outcomes, etc.) so we
// keep all sections after the first separator, joined with double newlines.
function extractDescription(raw) {
  if (!raw.markdown || typeof raw.markdown !== 'string') {
    return raw.summary || '';
  }
  let md = raw.markdown
    .replace(/<title[\s\S]*?<\/title>/g, '')
    .replace(/<traits>[\s\S]*?<\/traits>/g, '')
    .replace(/<column[^>]*>|<\/column>/g, '')
    .replace(/<row[^>]*>|<\/row>/g, '')
    .replace(/<actions[^/]*\/>/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')   // [text](link) → text
    .replace(/<additional-info>[\s\S]*?<\/additional-info>/g, '')
    .replace(/<summary>([\s\S]*?)<\/summary>/g, '$1')
    .replace(/<[^>]+>/g, '');

  const parts = md.split(/\n\s*---\s*\n/);
  if (parts.length >= 2) {
    return parts.slice(1).join('\n\n').trim();
  }
  return md.trim() || raw.summary || '';
}

// Normalize traits: drop "Common" (it's a rarity, not a real trait), drop
// duplicates, and pass everything else through.
function normalizeTraits(rawTraits) {
  if (!Array.isArray(rawTraits)) return [];
  const seen = new Set();
  const out = [];
  for (const t of rawTraits) {
    if (!t || typeof t !== 'string') continue;
    if (t.toLowerCase() === 'common') continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

// ── Main transformer ────────────────────────────────────────────────────────

function transformFeat(raw) {
  if (!raw || !raw.name || raw.name.length < 2) return null;

  return {
    name: raw.name,
    lookup_name: raw.name.toLowerCase(),
    level: typeof raw.level === 'number' ? raw.level : parseInt(raw.level) || 1,
    rarity: capitalize(raw.rarity || 'common'),
    traits: normalizeTraits(raw.trait),
    description: extractDescription(raw),
    summary: raw.summary || null,
    prerequisites: buildPrerequisites(raw),
    action_tag_full: actionTagFor(raw.actions),
    actions_text: raw.actions || null,        // raw verbose form, useful as fallback
    pfs_access: raw.pfs || null,
    archetype: Array.isArray(raw.archetype) ? raw.archetype : null,
    skill: Array.isArray(raw.skill) ? [...new Set(raw.skill)] : null,  // dedup
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
  console.log('🔄 AoN feat transformer\n');

  // 1. Load raw AoN data
  if (!fs.existsSync(RAW_FILE)) {
    console.error(`❌ Raw file not found: ${RAW_FILE}`);
    console.error('   Run `node tools/aon-fetch.js feat` first.');
    process.exit(1);
  }
  const raw = JSON.parse(fs.readFileSync(RAW_FILE, 'utf8'));
  console.log(`📂 Loaded ${raw.length.toLocaleString()} raw feats from aon-raw/feat.json`);

  // 2. Transform each feat
  let transformed = [];
  let skipped = 0;
  let withPrereqs = 0;
  let withActions = 0;
  let withArchetype = 0;
  for (const r of raw) {
    const t = transformFeat(r);
    if (!t) { skipped++; continue; }
    transformed.push(t);
    if (t.prerequisites) withPrereqs++;
    if (t.action_tag_full) withActions++;
    if (t.archetype) withArchetype++;
    if (VERBOSE) console.log(`   ✓ ${t.name} (level ${t.level})`);
  }
  console.log(`✅ Transformed ${transformed.length.toLocaleString()} feats (skipped ${skipped})`);
  console.log(`   • ${withPrereqs.toLocaleString()} have prerequisites/triggers/frequency`);
  console.log(`   • ${withActions.toLocaleString()} have an action cost`);
  console.log(`   • ${withArchetype.toLocaleString()} are archetype feats`);

  // 3. Preserve any existing homebrew
  let homebrew = [];
  if (fs.existsSync(OUT_FILE)) {
    try {
      const existing = JSON.parse(fs.readFileSync(OUT_FILE, 'utf8'));
      const arr = Array.isArray(existing) ? existing : (existing.feats ?? []);
      homebrew = arr.filter(f => f && f.custom === true);
    } catch (err) {
      console.warn(`⚠️  could not read existing feats.json (${err.message}) — starting fresh`);
    }
  }
  if (homebrew.length > 0) {
    console.log(`🛡️  Preserving ${homebrew.length} homebrew feat${homebrew.length === 1 ? '' : 's'}`);
    const homebrewNames = new Set(homebrew.map(f => (f.name || '').toLowerCase()));
    transformed = transformed.filter(f => !homebrewNames.has(f.name.toLowerCase()));
  }

  // 4. Combine and sort alphabetically
  const final = [...transformed, ...homebrew].sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  // 5. Write (unless dry run)
  if (DRY_RUN) {
    console.log(`\n🚫 --dry-run: would write ${final.length.toLocaleString()} feats to ${OUT_FILE}`);
    console.log(`   (file size estimate: ~${Math.round(JSON.stringify(final).length / 1024)} KB)`);
  } else {
    fs.writeFileSync(OUT_FILE, JSON.stringify(final, null, 2), 'utf8');
    console.log(`\n✨ Wrote ${final.length.toLocaleString()} feats to ${OUT_FILE}`);
    console.log(`   (${(JSON.stringify(final).length / (1024 * 1024)).toFixed(1)} MB)`);
  }

  // 6. Sanity-check sample
  console.log('\n📋 Sample entries:');
  const samples = ['Power Attack', 'Toughness', 'Sudden Charge', 'Shield Block', 'Cat Fall', 'Assurance'];
  for (const name of samples) {
    const f = final.find(x => x.name === name);
    if (f) {
      const action = f.action_tag_full ? f.action_tag_full.replace('_', ' ') : 'passive';
      const prereq = f.prerequisites ? f.prerequisites.split('\n')[0].slice(0, 40) : 'none';
      console.log(`   • ${f.name.padEnd(20)} L${f.level} ${f.rarity.padEnd(8)} | ${action.padEnd(13)} | prereq: ${prereq}`);
    }
  }
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});