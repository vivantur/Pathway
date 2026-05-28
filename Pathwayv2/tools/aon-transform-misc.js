// tools/aon-transform-misc.js
//
// Phase 2 transformer for the six "smaller" AoN categories. Handles all six
// in one script because they share ~80% of the same logic — only the
// per-document field mappings differ.
//
//   • backgrounds  → gamedata/background.json     (606 entries)
//   • ancestries   → gamedata/ancestries.json     (94 entries)
//   • archetypes   → gamedata/archetypes.json     (332 entries)
//   • classes      → gamedata/classes.json        (47 entries)
//   • deities      → gamedata/deities.json        (715 entries)
//   • rules        → gamedata/rules.json          (3,626 entries)
//
// Output shapes (matching what each loader in index.js expects):
//
//   backgrounds → { _meta, backgrounds: { slug: {...} } }
//   ancestries  → { slug: {...} }                            (flat keyed map)
//   archetypes  → { slug: {...} }                            (flat keyed map)
//   classes     → { _meta, classes: { slug: {...} } }
//   deities     → { _meta, deities: [ {...} ] }              (array form)
//   rules       → { Rulebook: { slug: {...} } }              (nested by category;
//                                                             AoN's `rules` category
//                                                             is all generic rulebook
//                                                             content, so we bucket
//                                                             them all under one cat)
//
// All six use a shared base (name, level, rarity, traits, source, summary,
// description) plus category-specific extra fields.
//
// USAGE:
//   node tools/aon-transform-misc.js                         # all six
//   node tools/aon-transform-misc.js backgrounds             # just one
//   node tools/aon-transform-misc.js backgrounds deities     # selected
//   node tools/aon-transform-misc.js --dry-run               # preview only
//   node tools/aon-transform-misc.js --verbose               # log every doc

'use strict';

const fs = require('fs');
const path = require('path');

const ALL_CATEGORIES = ['backgrounds', 'ancestries', 'archetypes', 'classes', 'deities', 'rules'];

const argv = process.argv.slice(2);
const DRY_RUN = argv.includes('--dry-run');
const VERBOSE = argv.includes('--verbose');
const requestedCats = argv.filter(a => !a.startsWith('--'));
const TARGET_CATEGORIES = requestedCats.length > 0 ? requestedCats : ALL_CATEGORIES;

// Map our category names → (raw filename, output filename, transformer fn,
// output shape, wrap-key when applicable).
//
// Output shapes:
//   'wrapped'     — { _meta, [wrapKey]: { slug: {...} } }
//   'wrapped-arr' — { _meta, [wrapKey]: [ {...} ] }
//   'flat-map'    — { slug: {...} }
//   'nested-map'  — { [topKey]: { slug: {...} } }
const CONFIG = {
  backgrounds: { rawFile: 'background.json', outFile: 'background.json',  outShape: 'wrapped',     wrapKey: 'backgrounds' },
  ancestries:  { rawFile: 'ancestry.json',   outFile: 'ancestries.json',  outShape: 'flat-map',    wrapKey: null },
  archetypes:  { rawFile: 'archetype.json',  outFile: 'archetypes.json',  outShape: 'flat-map',    wrapKey: null },
  classes:     { rawFile: 'class.json',      outFile: 'classes.json',     outShape: 'wrapped',     wrapKey: 'classes' },
  deities:     { rawFile: 'deity.json',      outFile: 'deities.json',     outShape: 'wrapped-arr', wrapKey: 'deities' },
  rules:       { rawFile: 'rules.json',      outFile: 'rules.json',       outShape: 'nested-map',  wrapKey: 'Rulebook' },
};

const RAW_DIR = path.join(__dirname, '..', 'gamedata', 'aon-raw');
const OUT_DIR = path.join(__dirname, '..', 'gamedata');

// ── Shared helpers ──────────────────────────────────────────────────────────

function capitalize(s) {
  if (!s || typeof s !== 'string') return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function makeSlug(name, sep = '_') {
  return String(name || '')
    .toLowerCase()
    .replace(/['\u2018\u2019\u02bc\u201c\u201d]/g, '')
    .replace(/[^a-z0-9]+/g, sep)
    .replace(new RegExp(`^${sep}+|${sep}+$`, 'g'), '')
    .replace(new RegExp(`${sep}{2,}`, 'g'), sep);
}

function stripLinks(s) {
  if (!s || typeof s !== 'string') return s;
  return s.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
}

function normalizeTraits(rawTraits) {
  if (!Array.isArray(rawTraits)) return [];
  const seen = new Set();
  const out = [];
  for (const t of rawTraits) {
    if (!t || typeof t !== 'string') continue;
    if (t.toLowerCase() === 'common') continue;
    if (seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    out.push(t);
  }
  return out;
}

// Strip AoN's wrapper tags from markdown to get just the prose.
function extractDescription(raw) {
  if (!raw.markdown || typeof raw.markdown !== 'string') return raw.summary || '';
  let md = raw.markdown
    .replace(/<title[\s\S]*?<\/title>/g, '')
    .replace(/<traits>[\s\S]*?<\/traits>/g, '')
    .replace(/<image[^/]*\/>/g, '')
    .replace(/<column[^>]*>|<\/column>/g, '')
    .replace(/<row[^>]*>|<\/row>/g, '')
    .replace(/<aside[\s\S]*?<\/aside>/g, '')
    .replace(/<actions[^/]*\/>/g, '')
    .replace(/<additional-info>[\s\S]*?<\/additional-info>/g, '')
    .replace(/<summary>([\s\S]*?)<\/summary>/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/<[^>]+>/g, '');
  // The description is usually the first chunk; some categories have multiple
  // `---` separators. Default to "everything after the first stat block".
  const parts = md.split(/\n\s*---\s*\n/);
  if (parts.length >= 2) return parts.slice(1).join('\n\n').trim();
  return md.trim() || raw.summary || '';
}

function getSource(raw) {
  return raw.primary_source_raw
    || raw.primary_source
    || (Array.isArray(raw.source_raw) ? raw.source_raw[0] : raw.source_raw)
    || (Array.isArray(raw.source) ? raw.source[0] : raw.source)
    || null;
}

// Common base shape — every category gets these fields.
function commonFields(raw) {
  return {
    name: raw.name,
    level: typeof raw.level === 'number' ? raw.level : (raw.level != null ? parseInt(raw.level) : null),
    rarity: capitalize(raw.rarity || 'common'),
    traits: normalizeTraits(raw.trait),
    pfs_availability: raw.pfs || null,
    source: getSource(raw),
    summary: raw.summary || null,
    description: extractDescription(raw),
    aon_url: raw.url ? `https://2e.aonprd.com${raw.url}` : null,
    aon_id: raw.id || null,
    custom: false,
    _aon_imported: true,
    _aon_imported_at: new Date().toISOString(),
  };
}

// ── Category-specific transformers ──────────────────────────────────────────

// BACKGROUNDS
// AoN exposes structured fields — easy. Bot expects:
//   ability_boosts, trained_skills, granted_feats, granted_lore, summary
function transformBackground(raw) {
  if (!raw || !raw.name) return null;
  return {
    ...commonFields(raw),
    ability_boosts: Array.isArray(raw.attribute) ? raw.attribute : [],
    trained_skills: Array.isArray(raw.skill) ? [...new Set(raw.skill)] : [],
    granted_feats:  raw.feat ? (Array.isArray(raw.feat) ? raw.feat : [raw.feat]) : [],
    granted_lore:   raw.lore ? (Array.isArray(raw.lore) ? raw.lore : [raw.lore]) : [],
    is_general: raw.is_general_background === true,
  };
}

// ANCESTRIES
// AoN gives us hp, size, speed, attribute, attribute_flaw, language, vision, sense.
// Bot expects: attribute_boosts, attribute_flaws, hit_points, size, speed,
//              languages: { base, bonus_count, bonus_pool }, senses: [{name, description}]
function transformAncestry(raw) {
  if (!raw || !raw.name) return null;
  const senseList = Array.isArray(raw.sense) ? raw.sense : (raw.sense ? [raw.sense] : []);
  const senses = senseList
    .filter(s => s && typeof s === 'string')
    .map(s => ({ name: s.trim(), description: s.trim() }));
  // If vision is present (e.g. "low-light vision"), add it to senses too
  if (raw.vision && !senses.some(s => s.name.toLowerCase() === String(raw.vision).toLowerCase())) {
    senses.unshift({ name: raw.vision, description: raw.vision });
  }
  const baseLangs = Array.isArray(raw.language) ? raw.language : (raw.language ? [raw.language] : []);
  return {
    ...commonFields(raw),
    attribute_boosts: Array.isArray(raw.attribute) ? raw.attribute : [],
    attribute_flaws:  Array.isArray(raw.attribute_flaw) ? raw.attribute_flaw : [],
    hit_points: typeof raw.hp === 'number' ? raw.hp : (raw.hp_raw ? parseInt(raw.hp_raw) : null),
    size: Array.isArray(raw.size) ? raw.size[0] : (raw.size || null),
    speed: typeof raw.speed === 'object' && raw.speed?.land
      ? raw.speed.land
      : (raw.speed_raw ? parseInt(raw.speed_raw) || raw.speed_raw : null),
    senses,
    languages: {
      base: baseLangs,
      bonus_count: 0,    // AoN doesn't expose this structurally
      bonus_pool: [],    // AoN doesn't expose this structurally
    },
    vision: raw.vision || null,
    image: raw.image || null,
  };
}

// ARCHETYPES
// AoN exposes: name, level (dedication feat level), trait (multiclass trait
// when applicable), prerequisite, archetype_category, summary, markdown.
// Bot expects: type ('multiclass'|'archetype'), dedication_level,
//              prerequisites, description, source, rarity.
function transformArchetype(raw) {
  if (!raw || !raw.name) return null;
  const base = commonFields(raw);
  const isMulticlass = base.traits.some(t => t.toLowerCase() === 'multiclass');
  const dedicationLevel = base.level != null ? base.level : 2;
  return {
    ...base,
    type: isMulticlass ? 'multiclass' : 'archetype',
    dedication_level: dedicationLevel,
    prerequisites: raw.prerequisite || null,
    archetype_category: Array.isArray(raw.archetype_category) ? raw.archetype_category : [],
  };
}

// CLASSES
// AoN exposes structured proficiencies — fortitude_proficiency, reflex_proficiency,
// will_proficiency, perception_proficiency, attack_proficiency (array),
// defense_proficiency (array), skill_proficiency (array). Plus hp, attribute.
// Bot expects: keyAttribute, hitPoints, source, keyTerms (array of {name, description}),
//              proficiencies: { perception, savingthrows, skills, attacks, defenses,
//                               classdc, armor, spellattacks, spelldcs },
//              classFeatures (array of strings), classFeatsRaw (array of strings).
function transformClass(raw) {
  if (!raw || !raw.name) return null;
  const base = commonFields(raw);
  // Build keyAttribute as the standard "X or Y" phrasing
  const keyAttribute = Array.isArray(raw.attribute) && raw.attribute.length > 0
    ? raw.attribute.join(' or ')
    : null;
  // HP per level
  const hitPoints = typeof raw.hp === 'number' ? raw.hp : (raw.hp_raw ? parseInt(raw.hp_raw) : null);
  // Build the proficiencies block — bot's renderer iterates a fixed key list
  const proficiencies = {};
  if (raw.perception_proficiency) proficiencies.perception = raw.perception_proficiency;
  // Saves: combine fort/ref/will into a single "savingthrows" string
  const saves = [];
  if (raw.fortitude_proficiency) saves.push(`Fortitude: ${raw.fortitude_proficiency}`);
  if (raw.reflex_proficiency)    saves.push(`Reflex: ${raw.reflex_proficiency}`);
  if (raw.will_proficiency)      saves.push(`Will: ${raw.will_proficiency}`);
  if (saves.length) proficiencies.savingthrows = saves.join('\n');
  // Skills
  if (Array.isArray(raw.skill_proficiency) && raw.skill_proficiency.length > 0) {
    proficiencies.skills = raw.skill_proficiency.map(s => `• ${s.trim()}`).join('\n');
  }
  // Attacks
  if (Array.isArray(raw.attack_proficiency) && raw.attack_proficiency.length > 0) {
    proficiencies.attacks = raw.attack_proficiency.map(a => `• ${a.trim()}`).join('\n');
  }
  // Defenses (armor)
  if (Array.isArray(raw.defense_proficiency) && raw.defense_proficiency.length > 0) {
    proficiencies.defenses = raw.defense_proficiency.map(d => `• ${d.trim()}`).join('\n');
    proficiencies.armor = proficiencies.defenses;
  }
  return {
    ...base,
    keyAttribute,
    hitPoints,
    keyTerms: [],            // these live in markdown <aside> tags; not structurally exposed
    classFeatures: [],       // these live in feat data, not class data — would need cross-referencing
    classFeatsRaw: [],       // same as above
    proficiencies,
    image: raw.image || null,
  };
}

// DEITIES
// AoN gives us rich structured fields: edict, anathema, area_of_concern,
// attribute, divine_font, domain, domain_primary, domain_alternate,
// favored_weapon, follower_alignment, pantheon, sanctification, skill, spell.
// Bot expects: pantheons, edicts, anathemas, domains, divine_font,
//              sanctification, attributes, divine_skill, favored_weapon,
//              devotee_benefits, source_text.
function transformDeity(raw) {
  if (!raw || !raw.name) return null;
  const base = commonFields(raw);
  const asArray = v => Array.isArray(v) ? v : (v ? [v] : []);
  // Domains: prefer the explicit primary/alternate split, else use combined
  const domains = asArray(raw.domain_primary).length > 0
    ? asArray(raw.domain_primary)
    : asArray(raw.domain);
  const altDomains = asArray(raw.domain_alternate);
  return {
    ...base,
    epithet: raw.epithet || null,
    alignment: raw.alignment || null,                              // legacy alignment (NG, LG, etc.)
    follower_alignments: asArray(raw.follower_alignment),
    pantheons: asArray(raw.pantheon),
    edicts:    Array.isArray(raw.edict)    ? raw.edict.join('; ')    : (raw.edict    || null),
    anathemas: Array.isArray(raw.anathema) ? raw.anathema.join('; ') : (raw.anathema || null),
    areas_of_concern: asArray(raw.area_of_concern),
    domains,
    alternate_domains: altDomains,
    divine_font:    Array.isArray(raw.divine_font)    ? raw.divine_font.join(' or ')    : (raw.divine_font || null),
    sanctification: Array.isArray(raw.sanctification) ? raw.sanctification.join(', ')  : (raw.sanctification || null),
    attributes:     asArray(raw.attribute),
    divine_skill:   Array.isArray(raw.skill) ? raw.skill.join(', ') : (raw.skill || null),
    favored_weapon: Array.isArray(raw.favored_weapon) ? raw.favored_weapon.join(', ') : (raw.favored_weapon || null),
    cleric_spells:  asArray(raw.spell),
    devotee_benefits: [],   // AoN doesn't structure these — would require markdown parsing
    source_text: base.source,
    image: raw.image || null,
  };
}

// RULES
// AoN's "rules" category is generic rulebook content (Flanking, Cover, Building
// Encounters, etc.). Conditions/actions/traits aren't here — they're in their
// own categories (which we're not pulling for now). Bot's findRule searches
// across categories of rulesDatabase, so we bucket all of these under
// "Rulebook" and the bot finds them just fine.
//
// Bot's buildRuleEmbed expects: name, category, description, action_cost,
//                                value_label, traits, trigger, requirements, source.
function transformRule(raw) {
  if (!raw || !raw.name) return null;
  const base = commonFields(raw);
  return {
    name: raw.name,
    category: 'rulebook',                  // bucket for the embed icon/color
    description: base.description || base.summary || '*No description available.*',
    traits: base.traits,
    source: base.source,
    aon_url: base.aon_url,
    aon_id: base.aon_id,
    custom: false,
    _aon_imported: true,
    _aon_imported_at: base._aon_imported_at,
  };
}

// ── Per-category processing ─────────────────────────────────────────────────

const TRANSFORMERS = {
  backgrounds: transformBackground,
  ancestries:  transformAncestry,
  archetypes:  transformArchetype,
  classes:     transformClass,
  deities:     transformDeity,
  rules:       transformRule,
};

// Read the existing output file, return its homebrew entries as an array of
// {key, entry} pairs (plus the file's metadata, if any).
function readExistingHomebrew(outPath, shape, wrapKey) {
  if (!fs.existsSync(outPath)) return { homebrew: [], meta: null };
  let existing;
  try {
    existing = JSON.parse(fs.readFileSync(outPath, 'utf8'));
  } catch (err) {
    console.warn(`   ⚠️  could not parse existing ${outPath}: ${err.message}`);
    return { homebrew: [], meta: null };
  }
  const meta = existing._meta ?? existing.meta ?? existing.metadata ?? null;
  const homebrew = [];
  if (shape === 'wrapped' || shape === 'flat-map') {
    const obj = (shape === 'wrapped') ? (existing[wrapKey] ?? {}) : existing;
    for (const [k, v] of Object.entries(obj)) {
      if (v && typeof v === 'object' && v.custom === true) homebrew.push({ key: k, entry: v });
    }
  } else if (shape === 'wrapped-arr') {
    const arr = existing[wrapKey] ?? [];
    if (Array.isArray(arr)) {
      for (const v of arr) {
        if (v && v.custom === true) homebrew.push({ key: makeSlug(v.name), entry: v });
      }
    }
  } else if (shape === 'nested-map') {
    // { topKey: { slug: rule, ... }, otherKey: {...} } — homebrew rules can be
    // anywhere in this nested structure.
    for (const [topKey, sub] of Object.entries(existing)) {
      if (!sub || typeof sub !== 'object') continue;
      if (topKey === '_meta' || topKey === 'meta' || topKey === 'metadata') continue;
      for (const [k, v] of Object.entries(sub)) {
        if (v && typeof v === 'object' && v.custom === true) homebrew.push({ key: k, entry: v, topKey });
      }
    }
  }
  return { homebrew, meta };
}

// Produce the final on-disk payload in the right shape.
function buildPayload(transformedMap, homebrew, meta, shape, wrapKey, category) {
  const ts = new Date().toISOString();
  const newMeta = meta ?? { source: 'Archives of Nethys (Elasticsearch)' };
  newMeta.last_synced = ts;
  newMeta.aon_count = Object.keys(transformedMap).length;
  newMeta.homebrew_count = homebrew.length;

  if (shape === 'wrapped') {
    const merged = { ...transformedMap };
    for (const { key, entry } of homebrew) merged[key] = entry;
    return { _meta: newMeta, [wrapKey]: merged };
  } else if (shape === 'flat-map') {
    const merged = { ...transformedMap };
    for (const { key, entry } of homebrew) merged[key] = entry;
    // Per the bot's loaders for ancestries/archetypes, they expect a raw
    // flat map with no _meta wrapper. We attach _meta as a hidden key
    // anyway since loadJson tolerates extras.
    return { _meta: newMeta, ...merged };
  } else if (shape === 'wrapped-arr') {
    const aonArr = Object.values(transformedMap);
    const homeArr = homebrew.map(h => h.entry);
    const all = [...aonArr, ...homeArr].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    return { _meta: newMeta, [wrapKey]: all };
  } else if (shape === 'nested-map') {
    const out = { [wrapKey]: { ...transformedMap } };
    // Re-attach homebrew entries — try to put them back under their original
    // top-level category if known, else under wrapKey.
    for (const h of homebrew) {
      const top = h.topKey || wrapKey;
      if (!out[top]) out[top] = {};
      out[top][h.key] = h.entry;
    }
    out._meta = newMeta;
    return out;
  }
}

// ── Main ────────────────────────────────────────────────────────────────────

async function processCategory(cat) {
  const cfg = CONFIG[cat];
  if (!cfg) {
    console.error(`❌ Unknown category: ${cat}. Valid: ${Object.keys(CONFIG).join(', ')}`);
    return false;
  }
  const xform = TRANSFORMERS[cat];
  const rawPath = path.join(RAW_DIR, cfg.rawFile);
  const outPath = path.join(OUT_DIR, cfg.outFile);

  console.log(`\n🔄 ${cat}`);
  console.log(`   raw:    ${rawPath}`);
  console.log(`   out:    ${outPath}`);

  if (!fs.existsSync(rawPath)) {
    console.warn(`   ⏭  raw file missing — run \`node tools/aon-fetch.js ${cat === 'backgrounds' ? 'background' : cat === 'ancestries' ? 'ancestry' : cat === 'archetypes' ? 'archetype' : cat === 'classes' ? 'class' : cat === 'deities' ? 'deity' : 'rules'}\` first. Skipping.`);
    return false;
  }

  const raw = JSON.parse(fs.readFileSync(rawPath, 'utf8'));
  console.log(`   📂 loaded ${raw.length.toLocaleString()} raw documents`);

  // Transform each document
  const transformedMap = {};
  let skipped = 0;
  let renamed = 0;
  for (const r of raw) {
    const t = xform(r);
    if (!t) { skipped++; continue; }
    let slug = makeSlug(t.name);
    let counter = 2;
    while (transformedMap[slug]) {
      slug = `${makeSlug(t.name)}_${counter}`;
      counter++;
      renamed++;
    }
    transformedMap[slug] = t;
    if (VERBOSE) console.log(`     ✓ ${t.name}`);
  }
  console.log(`   ✅ transformed ${Object.keys(transformedMap).length.toLocaleString()} (skipped ${skipped}${renamed > 0 ? `, disambiguated ${renamed} duplicate slugs` : ''})`);

  // Preserve homebrew
  const { homebrew, meta } = readExistingHomebrew(outPath, cfg.outShape, cfg.wrapKey);
  if (homebrew.length > 0) {
    console.log(`   🛡️  preserving ${homebrew.length} homebrew entries`);
    // Drop AoN entries that collide with homebrew
    const homeSlugs = new Set(homebrew.map(h => h.key));
    for (const k of homeSlugs) delete transformedMap[k];
  }

  // Build payload
  const payload = buildPayload(transformedMap, homebrew, meta, cfg.outShape, cfg.wrapKey, cat);

  // Write
  if (DRY_RUN) {
    const size = JSON.stringify(payload).length;
    console.log(`   🚫 --dry-run: would write ${size > 1024*1024 ? (size/(1024*1024)).toFixed(1)+' MB' : (size/1024).toFixed(0)+' KB'} to ${outPath}`);
  } else {
    fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf8');
    const size = JSON.stringify(payload).length;
    console.log(`   ✨ wrote ${outPath} (${size > 1024*1024 ? (size/(1024*1024)).toFixed(1)+' MB' : (size/1024).toFixed(0)+' KB'})`);
  }
  return true;
}

async function main() {
  console.log('🔄 AoN misc transformer');
  console.log(`   targets: ${TARGET_CATEGORIES.join(', ')}${DRY_RUN ? ' (dry run)' : ''}`);

  const summary = { ok: [], failed: [] };
  for (const cat of TARGET_CATEGORIES) {
    try {
      const ok = await processCategory(cat);
      if (ok) summary.ok.push(cat);
      else summary.failed.push(cat);
    } catch (err) {
      console.error(`   ❌ ${cat}: ${err.message}`);
      console.error(err.stack);
      summary.failed.push(cat);
    }
  }

  console.log('\n✨ Done');
  console.log(`   ✓ completed: ${summary.ok.join(', ') || '(none)'}`);
  if (summary.failed.length > 0) console.log(`   ❌ failed: ${summary.failed.join(', ')}`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});