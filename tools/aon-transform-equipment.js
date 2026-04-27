// tools/aon-transform-equipment.js
//
// Phase 2 of the AoN sync pipeline: transforms raw AoN equipment documents
// into the JSON shape your bot expects in gamedata/items.json.
//
// Reads:  gamedata/aon-raw/equipment.json  (created by tools/aon-fetch.js)
// Writes: gamedata/items.json
//
// Output format: items.json on disk uses { meta, items: { slug: {...} } }
// (not a flat array). The bot's loader handles both shapes, but persistItems()
// in index.js writes back to the map form, so we match that on output.
// Each item is keyed by its `id` (a slug derived from the name).
//
// Preserves homebrew: any existing entries with custom: true are kept.
// AoN entries with the same id/name as a homebrew lose to the homebrew.
//
// Bot fields produced (from index.js buildItemEmbed and findItem):
//   name              — required
//   lookup_name       — lowercase name for matching
//   id                — stable slug for map keying & cross-references
//   level             — used for level filter
//   rarity            — Common/Uncommon/Rare/Unique (capitalized)
//   traits            — array (Common rarity stripped — that's not a trait)
//   category          — top-level item category (used for icon + display)
//   subcategory       — subcategory if present
//   price_raw         — display string like "4 gp" or "300 gp"
//   bulk_raw          — display string like "L", "1", "—"
//   usage             — "held in 1 hand", "worn", etc.
//   pfs_availability  — Standard/Limited/Restricted
//   source            — string (e.g. "Player Core pg. 248")
//   description       — full body text from markdown
//   summary           — short one-liner
//   custom            — false (AoN data); homebrew sets true
//
// USAGE:
//   node tools/aon-transform-equipment.js               # transform & write
//   node tools/aon-transform-equipment.js --dry-run     # show what would happen
//   node tools/aon-transform-equipment.js --verbose     # log every item

'use strict';

const fs = require('fs');
const path = require('path');

const DRY_RUN = process.argv.includes('--dry-run');
const VERBOSE = process.argv.includes('--verbose');

const RAW_FILE = path.join(__dirname, '..', 'gamedata', 'aon-raw', 'equipment.json');
const OUT_FILE = path.join(__dirname, '..', 'gamedata', 'items.json');

// ── Helpers ─────────────────────────────────────────────────────────────────

function capitalize(s) {
  if (!s || typeof s !== 'string') return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Generate a URL-safe slug from a name. Used as the map key in items.json.
// Mimics index.js's itemSlug() for consistency.
//   "Healing Potion (Minor)"          → "healing-potion-minor"
//   "+1 Striking Longsword"           → "1-striking-longsword"
//   "Bag of Holding (Type II)"        → "bag-of-holding-type-ii"
function itemSlug(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/['\u2018\u2019\u02bc\u201c\u201d]/g, '')   // strip quotes/apostrophes
    .replace(/[^a-z0-9]+/g, '-')                          // non-alphanum → hyphen
    .replace(/^-+|-+$/g, '')                              // trim hyphens
    .replace(/-{2,}/g, '-');                              // collapse runs
}

// Pull the body text from AoN's markdown. Same approach as the spell/feat
// transformers. Item markdown layout:
//   <title>...</title>
//   <traits>...</traits>
//   metadata block (Source, Category, Price, Bulk, Usage, etc.)
//   ---
//   <DESCRIPTION TEXT>
//   ---
//   activate / activation block (for magic items)
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
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/<additional-info>[\s\S]*?<\/additional-info>/g, '')
    .replace(/<summary>([\s\S]*?)<\/summary>/g, '$1')
    .replace(/<[^>]+>/g, '');

  const parts = md.split(/\n\s*---\s*\n/);
  if (parts.length >= 2) {
    return parts.slice(1).join('\n\n').trim();
  }
  return md.trim() || raw.summary || '';
}

// Drop "Common" — it's a rarity, not a trait. Dedupe.
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

function transformItem(raw) {
  if (!raw || !raw.name || raw.name.length < 1) return null;

  const slug = itemSlug(raw.name);

  return {
    id: slug,
    name: raw.name,
    lookup_name: raw.name.toLowerCase(),
    level: typeof raw.level === 'number' ? raw.level : parseInt(raw.level) || 0,
    rarity: capitalize(raw.rarity || 'common'),
    traits: normalizeTraits(raw.trait),
    category: raw.item_category || null,
    subcategory: raw.item_subcategory || null,
    price_raw: raw.price_raw || null,
    bulk_raw: raw.bulk_raw || null,
    bulk: raw.bulk != null ? raw.bulk : null,         // numeric form for math
    hands: raw.hands || null,
    usage: raw.usage || null,
    actions_text: raw.actions || null,
    pfs_availability: raw.pfs || null,
    source: raw.primary_source_raw || raw.primary_source || (Array.isArray(raw.source) ? raw.source[0] : raw.source) || null,
    summary: raw.summary || null,
    description: extractDescription(raw),
    aon_url: raw.url ? `https://2e.aonprd.com${raw.url}` : null,
    aon_id: raw.id || null,                            // AoN's internal id (e.g. "equipment-1234")
    custom: false,
    _aon_imported: true,
    _aon_imported_at: new Date().toISOString(),
  };
}

// ── Driver ──────────────────────────────────────────────────────────────────

async function main() {
  console.log('🔄 AoN equipment transformer\n');

  // 1. Load raw data
  if (!fs.existsSync(RAW_FILE)) {
    console.error(`❌ Raw file not found: ${RAW_FILE}`);
    console.error('   Run `node tools/aon-fetch.js equipment` first.');
    process.exit(1);
  }
  const raw = JSON.parse(fs.readFileSync(RAW_FILE, 'utf8'));
  console.log(`📂 Loaded ${raw.length.toLocaleString()} raw items from aon-raw/equipment.json`);

  // 2. Transform each item
  let transformed = [];
  let skipped = 0;
  let withPrice = 0;
  let withBulk = 0;
  let withUsage = 0;
  const categoryStats = {};
  for (const r of raw) {
    const t = transformItem(r);
    if (!t) { skipped++; continue; }
    transformed.push(t);
    if (t.price_raw) withPrice++;
    if (t.bulk_raw) withBulk++;
    if (t.usage) withUsage++;
    if (t.category) categoryStats[t.category] = (categoryStats[t.category] || 0) + 1;
    if (VERBOSE) console.log(`   ✓ ${t.name} (level ${t.level} ${t.category || 'uncategorized'})`);
  }
  console.log(`✅ Transformed ${transformed.length.toLocaleString()} items (skipped ${skipped})`);
  console.log(`   • ${withPrice.toLocaleString()} have a price`);
  console.log(`   • ${withBulk.toLocaleString()} have bulk`);
  console.log(`   • ${withUsage.toLocaleString()} have a usage`);
  console.log(`   • Top categories: ${Object.entries(categoryStats).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([k,v])=>`${k} (${v})`).join(', ')}`);

  // 3. Detect & resolve duplicate slugs (AoN sometimes has multiple items
  // sharing a name — e.g. legacy + remaster versions). We append a counter
  // to disambiguate so the map keying doesn't lose entries.
  const seen = new Map();
  let renamed = 0;
  for (const item of transformed) {
    const baseSlug = item.id;
    if (!seen.has(baseSlug)) {
      seen.set(baseSlug, 1);
      continue;
    }
    const n = seen.get(baseSlug) + 1;
    seen.set(baseSlug, n);
    item.id = `${baseSlug}-${n}`;                     // disambiguate slug
    renamed++;
  }
  if (renamed > 0) {
    console.log(`   • disambiguated ${renamed} duplicate slug${renamed === 1 ? '' : 's'}`);
  }

  // 4. Preserve homebrew. items.json on disk is a map { items: { slug: {...} } }
  // (or an array; we handle both). Pull custom: true entries.
  let homebrew = [];
  let existingMeta = null;
  if (fs.existsSync(OUT_FILE)) {
    try {
      const existing = JSON.parse(fs.readFileSync(OUT_FILE, 'utf8'));
      existingMeta = existing.meta ?? null;
      const itemsObj = existing.items ?? existing;
      const arr = Array.isArray(itemsObj) ? itemsObj : Object.values(itemsObj);
      homebrew = arr.filter(i => i && i.custom === true);
    } catch (err) {
      console.warn(`⚠️  could not read existing items.json (${err.message}) — starting fresh`);
    }
  }
  if (homebrew.length > 0) {
    console.log(`🛡️  Preserving ${homebrew.length} homebrew item${homebrew.length === 1 ? '' : 's'}`);
    const homebrewIds = new Set(homebrew.map(i => (i.id || itemSlug(i.name) || '').toLowerCase()));
    const homebrewNames = new Set(homebrew.map(i => (i.name || '').toLowerCase()));
    transformed = transformed.filter(i =>
      !homebrewIds.has((i.id || '').toLowerCase()) &&
      !homebrewNames.has((i.name || '').toLowerCase())
    );
  }

  // 5. Combine and build the map. items.json's disk shape is
  // { meta, items: { slug: {...} } } — the bot's persistItems() also
  // writes this shape. Sort all entries before mapping for stable output.
  const allItems = [...transformed, ...homebrew].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  const itemsMap = {};
  for (const item of allItems) {
    const key = item.id || itemSlug(item.name);
    itemsMap[key] = item;
  }
  const meta = existingMeta ?? {
    source: 'Archives of Nethys (Elasticsearch)',
    last_synced: new Date().toISOString(),
  };
  // Always update the timestamp on a fresh sync
  meta.last_synced = new Date().toISOString();
  meta.aon_count = transformed.length;
  meta.homebrew_count = homebrew.length;

  const payload = { meta, items: itemsMap };

  // 6. Write
  if (DRY_RUN) {
    console.log(`\n🚫 --dry-run: would write ${allItems.length.toLocaleString()} items to ${OUT_FILE}`);
    console.log(`   (file size estimate: ~${Math.round(JSON.stringify(payload).length / 1024)} KB)`);
  } else {
    fs.writeFileSync(OUT_FILE, JSON.stringify(payload, null, 2), 'utf8');
    console.log(`\n✨ Wrote ${allItems.length.toLocaleString()} items to ${OUT_FILE}`);
    console.log(`   (${(JSON.stringify(payload).length / (1024 * 1024)).toFixed(1)} MB)`);
  }

  // 7. Sample verification
  console.log('\n📋 Sample entries:');
  const samples = ['Healing Potion (Minor)', 'Holy Water', 'Bag of Holding (Type II)', 'Climbing Kit', 'Adamantine'];
  for (const name of samples) {
    const it = allItems.find(x => x.name === name);
    if (it) {
      const cat = (it.category || '?').slice(0, 18);
      console.log(`   • ${it.name.padEnd(28)} L${String(it.level).padStart(2)} ${it.rarity.padEnd(8)} | ${(it.price_raw || '—').padEnd(8)} | ${(it.bulk_raw || '—').padEnd(3)} | ${cat}`);
    }
  }
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});