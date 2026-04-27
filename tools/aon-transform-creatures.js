// tools/aon-transform-creatures.js
//
// Phase 2 of the AoN sync pipeline: transforms raw AoN creature documents
// into the JSON shape your bot expects in gamedata/bestiary.json.
//
// Reads:  gamedata/aon-raw/creature.json  (created by tools/aon-fetch.js)
// Writes: gamedata/bestiary.json
//
// Output format on disk:
//   { metadata: {...}, creatures: { slug: { name, core, rich, summary } } }
//
// ATTACK EXTRACTION:
// Each AoN creature's markdown contains a stat block with consistent attack
// formatting like:
//
//   **Melee**
//   <actions string="Single Action" />
//   dogslicer +7 ([Agile](/Traits.aspx?ID=526), [Backstabber](/Traits.aspx?ID=544)),
//   **Damage** 1d6 slashing
//
// We parse this with regex into the shape the bot's formatAttackLine and
// /init addmonster expect:
//
//   { name: "dogslicer", type: "melee", to_hit: 7,
//     traits: ["Agile", "Backstabber", "Finesse"], damage: "1d6 slashing" }
//
// Preserves homebrew (anything in existing bestiary.json with custom: true).
//
// USAGE:
//   node tools/aon-transform-creatures.js               # transform & write
//   node tools/aon-transform-creatures.js --dry-run     # show what would happen
//   node tools/aon-transform-creatures.js --verbose     # log every creature

'use strict';

const fs = require('fs');
const path = require('path');

const DRY_RUN = process.argv.includes('--dry-run');
const VERBOSE = process.argv.includes('--verbose');

const RAW_FILE = path.join(__dirname, '..', 'gamedata', 'aon-raw', 'creature.json');
const OUT_FILE = path.join(__dirname, '..', 'gamedata', 'bestiary.json');

// ── Helpers ─────────────────────────────────────────────────────────────────

function capitalize(s) {
  if (!s || typeof s !== 'string') return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function creatureSlug(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/['\u2018\u2019\u02bc\u201c\u201d]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_{2,}/g, '_');
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

// ── Attack extraction ───────────────────────────────────────────────────────

function parseAttackBlock(blockText, type) {
  let body = blockText
    .replace(/\*\*(?:Melee|Ranged)\*\*/i, '')
    .replace(/<actions[^/]*\/>/g, '')
    .replace(/\r/g, '')
    .replace(/\n/g, ' ')
    .trim();

  // Damage portion: everything after **Damage**
  const damageMatch = body.match(/\*\*Damage\*\*\s+([^*]+?)(?=\*\*|$)/);
  const damage = damageMatch ? stripLinks(damageMatch[1]).trim().replace(/[\s,]+$/, '') : null;

  const headerPart = damageMatch ? body.slice(0, damageMatch.index).trim() : body;

  // Header: "weapon-name +N (traits...)" — name may have spaces, traits in parens
  const headerMatch = headerPart.match(/^(.+?)\s+([+\-]\d+)\s*(?:\(([\s\S]*?)\))?\s*,?\s*$/);
  if (!headerMatch) return null;

  const name = headerMatch[1].trim().replace(/,$/, '');
  const toHit = parseInt(headerMatch[2], 10);
  const traitsRaw = headerMatch[3] || '';

  const traits = traitsRaw
    .split(',')
    .map(t => stripLinks(t).trim())
    .filter(Boolean);

  return {
    name,
    type,
    to_hit: toHit,
    traits,
    damage: damage || '',
  };
}

function extractAttacks(raw) {
  const md = raw.markdown || '';
  if (!md) return [];

  const re = /\*\*(Melee|Ranged)\*\*[\s\S]*?\*\*Damage\*\*[^*\n]+/g;
  const out = [];
  let m;
  while ((m = re.exec(md)) !== null) {
    const block = m[0];
    const type = m[1].toLowerCase();
    const parsed = parseAttackBlock(block, type);
    if (parsed && parsed.name && !isNaN(parsed.to_hit)) out.push(parsed);
  }
  return out;
}

// ── Description extraction ──────────────────────────────────────────────────

function extractDescription(raw) {
  const md = raw.markdown || '';
  if (!md) return raw.summary || '';

  const statBlockStart = md.search(/<title level="2"/);
  let lead = statBlockStart !== -1 ? md.slice(0, statBlockStart) : md;

  lead = lead
    .replace(/<title[\s\S]*?<\/title>/g, '')
    .replace(/<traits>[\s\S]*?<\/traits>/g, '')
    .replace(/<image[^/]*\/>/g, '')
    .replace(/<column[^>]*>|<\/column>/g, '')
    .replace(/<row[^>]*>|<\/row>/g, '')
    .replace(/<actions[^/]*\/>/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .trim();

  const firstPara = lead.split(/\n\s*\n|\n\s*\*\*/)[0].trim();
  return firstPara || raw.summary || '';
}

// ── Other field parsers ─────────────────────────────────────────────────────

function parseSpeed(rawSpeed) {
  if (!rawSpeed || typeof rawSpeed !== 'object') return null;
  const out = {};
  for (const [k, v] of Object.entries(rawSpeed)) {
    if (k === 'max') continue;
    if (typeof v === 'number' && v > 0) out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : null;
}

function parseSenses(rawSense) {
  if (!rawSense || typeof rawSense !== 'string') return [];
  return rawSense.split(',').map(s => s.trim()).filter(Boolean);
}

function parseLanguages(rawLang) {
  if (!Array.isArray(rawLang)) return [];
  return rawLang.filter(l => l && typeof l === 'string').map(l => l.trim());
}

function parseSkills(raw) {
  const md = raw.skill_markdown || '';
  if (!md) return null;
  const cleaned = stripLinks(md);
  const out = {};
  const re = /([A-Z][a-zA-Z ]+?)\s+([+\-]\d+)/g;
  let m;
  while ((m = re.exec(cleaned)) !== null) {
    const name = m[1].trim();
    const value = parseInt(m[2], 10);
    if (name && !isNaN(value)) out[name] = value;
  }
  return Object.keys(out).length > 0 ? out : null;
}

function parseItems(raw) {
  const md = raw.markdown || '';
  const m = md.match(/\*\*Items\*\*\s*([^\n]+)/);
  if (!m) return [];
  const cleaned = stripLinks(m[1]).trim();
  return cleaned.split(',').map(s => s.trim()).filter(Boolean);
}

function parseDefenseList(obj) {
  if (!obj || typeof obj !== 'object') return [];
  const out = [];
  for (const [type, value] of Object.entries(obj)) {
    if (value == null) continue;
    out.push({ type, value });
  }
  return out;
}

function parseImmunities(raw) {
  const md = raw.markdown || '';
  const m = md.match(/\*\*Immunities\*\*\s*([^\n]+)/);
  if (!m) return [];
  const cleaned = stripLinks(m[1]).trim();
  return cleaned.split(',').map(s => s.trim()).filter(Boolean);
}

// ── Main transformer ────────────────────────────────────────────────────────

function transformCreature(raw) {
  if (!raw || !raw.name || raw.name.length < 1) return null;

  const ac = typeof raw.ac === 'number' ? raw.ac : null;
  const hp = typeof raw.hp === 'number' ? raw.hp : null;

  const core = {
    level: typeof raw.level === 'number' ? raw.level : parseInt(raw.level) || 0,
    size: Array.isArray(raw.size) && raw.size[0] ? raw.size[0] : null,
    rarity: capitalize(raw.rarity || 'common'),
    traits: normalizeTraits(raw.trait),
    hp,
    ac,
    perception: typeof raw.perception === 'number' ? raw.perception : null,
    saves: {
      fort: typeof raw.fortitude_save === 'number' ? raw.fortitude_save : null,
      ref:  typeof raw.reflex_save     === 'number' ? raw.reflex_save     : null,
      will: typeof raw.will_save       === 'number' ? raw.will_save       : null,
    },
  };

  const attacks = extractAttacks(raw);

  const rich = {
    ability_modifiers: {
      str: typeof raw.strength === 'number'     ? raw.strength     : null,
      dex: typeof raw.dexterity === 'number'    ? raw.dexterity    : null,
      con: typeof raw.constitution === 'number' ? raw.constitution : null,
      int: typeof raw.intelligence === 'number' ? raw.intelligence : null,
      wis: typeof raw.wisdom === 'number'       ? raw.wisdom       : null,
      cha: typeof raw.charisma === 'number'     ? raw.charisma     : null,
    },
    speed: parseSpeed(raw.speed),
    senses: parseSenses(raw.sense),
    languages: parseLanguages(raw.language),
    skills: parseSkills(raw),
    items: parseItems(raw),
    defenses: {
      ac,
      hp,
      immunities: parseImmunities(raw),
      weaknesses: parseDefenseList(raw.weakness),
      resistances: parseDefenseList(raw.resistance),
    },
    attacks,
    description: extractDescription(raw),
  };

  // Legacy compat: also write a `summary` block
  const summary = {
    summary: {
      level: core.level,
      hp: hp != null ? { value: hp } : null,
      ac,
      perception: core.perception,
      fortitude: core.saves.fort,
      reflex:    core.saves.ref,
      will:      core.saves.will,
      speed_raw: raw.speed_raw || null,
      senses_raw: rich.senses.join(', ') || null,
    }
  };

  return {
    name: raw.name,
    family: raw.creature_family || null,
    npc: !!raw.npc,
    core,
    rich,
    summary,
    source: raw.primary_source_raw || raw.primary_source || (Array.isArray(raw.source) ? raw.source[0] : raw.source) || null,
    aon_url: raw.url ? `https://2e.aonprd.com${raw.url}` : null,
    aon_id: raw.id || null,
    image: raw.image || null,
    custom: false,
    _aon_imported: true,
    _aon_imported_at: new Date().toISOString(),
  };
}

// ── Driver ──────────────────────────────────────────────────────────────────

async function main() {
  console.log('🔄 AoN creature transformer\n');

  if (!fs.existsSync(RAW_FILE)) {
    console.error(`❌ Raw file not found: ${RAW_FILE}`);
    console.error('   Run `node tools/aon-fetch.js creature` first.');
    process.exit(1);
  }
  const raw = JSON.parse(fs.readFileSync(RAW_FILE, 'utf8'));
  console.log(`📂 Loaded ${raw.length.toLocaleString()} raw creatures from aon-raw/creature.json`);

  const transformed = {};
  let skipped = 0;
  let withAttacks = 0;
  let totalAttacks = 0;
  let withFullStats = 0;
  let renamed = 0;

  for (const r of raw) {
    const t = transformCreature(r);
    if (!t) { skipped++; continue; }

    const baseSlug = creatureSlug(t.name);
    let slug = baseSlug;
    let counter = 2;
    while (transformed[slug]) {
      slug = `${baseSlug}_${counter}`;
      counter++;
      renamed++;
    }
    transformed[slug] = t;

    if (t.rich.attacks?.length > 0) {
      withAttacks++;
      totalAttacks += t.rich.attacks.length;
    }
    if (t.core.hp != null && t.core.ac != null && t.core.perception != null) withFullStats++;
    if (VERBOSE) console.log(`   ✓ ${t.name} (level ${t.core.level}, ${t.rich.attacks?.length || 0} attacks)`);
  }

  const transformedCount = Object.keys(transformed).length;
  console.log(`✅ Transformed ${transformedCount.toLocaleString()} creatures (skipped ${skipped})`);
  console.log(`   • ${withAttacks.toLocaleString()} have at least one attack (${totalAttacks.toLocaleString()} total attacks parsed)`);
  console.log(`   • ${withFullStats.toLocaleString()} have full HP+AC+Perception`);
  if (renamed > 0) console.log(`   • disambiguated ${renamed} duplicate slugs`);

  // Preserve homebrew
  let homebrew = {};
  let existingMeta = null;
  if (fs.existsSync(OUT_FILE)) {
    try {
      const existing = JSON.parse(fs.readFileSync(OUT_FILE, 'utf8'));
      existingMeta = existing.metadata ?? null;
      const creaturesObj = existing.creatures ?? existing;
      const obj = Array.isArray(creaturesObj)
        ? creaturesObj.reduce((m, c) => (c?.name && (m[creatureSlug(c.name)] = c), m), {})
        : creaturesObj;
      for (const [k, v] of Object.entries(obj)) {
        if (v && v.custom === true) homebrew[k] = v;
      }
    } catch (err) {
      console.warn(`⚠️  could not read existing bestiary.json (${err.message}) — starting fresh`);
    }
  }
  const homebrewCount = Object.keys(homebrew).length;
  if (homebrewCount > 0) {
    console.log(`🛡️  Preserving ${homebrewCount} homebrew creature${homebrewCount === 1 ? '' : 's'}`);
    for (const k of Object.keys(homebrew)) delete transformed[k];
    const homebrewNames = new Set(Object.values(homebrew).map(c => (c.name || '').toLowerCase()));
    for (const [k, v] of Object.entries(transformed)) {
      if (homebrewNames.has((v.name || '').toLowerCase())) delete transformed[k];
    }
  }

  const allCreatures = { ...transformed, ...homebrew };

  const metadata = existingMeta ?? {
    source: 'Archives of Nethys (Elasticsearch)',
    last_synced: new Date().toISOString(),
  };
  metadata.last_synced = new Date().toISOString();
  metadata.aon_count = transformedCount;
  metadata.homebrew_count = homebrewCount;
  metadata.total_attacks_parsed = totalAttacks;

  const payload = { metadata, creatures: allCreatures };

  if (DRY_RUN) {
    console.log(`\n🚫 --dry-run: would write ${Object.keys(allCreatures).length.toLocaleString()} creatures to ${OUT_FILE}`);
    console.log(`   (file size estimate: ~${Math.round(JSON.stringify(payload).length / 1024)} KB)`);
  } else {
    fs.writeFileSync(OUT_FILE, JSON.stringify(payload, null, 2), 'utf8');
    console.log(`\n✨ Wrote ${Object.keys(allCreatures).length.toLocaleString()} creatures to ${OUT_FILE}`);
    console.log(`   (${(JSON.stringify(payload).length / (1024 * 1024)).toFixed(1)} MB)`);
  }

  console.log('\n📋 Sample entries (with attacks):');
  const samples = ['Goblin Warrior', 'Ogre Warrior', 'Adult Red Dragon', 'Skeleton Guard', 'Lich', 'Bugbear Tormentor'];
  for (const name of samples) {
    const c = Object.values(allCreatures).find(x => x.name === name);
    if (c) {
      const lvl = c.core.level;
      const hp = c.core.hp ?? '?';
      const ac = c.core.ac ?? '?';
      const atks = c.rich.attacks?.length || 0;
      console.log(`   • ${c.name.padEnd(22)} L${String(lvl).padStart(2)} | HP ${String(hp).padEnd(4)} AC ${String(ac).padEnd(3)} | ${atks} attack${atks !== 1 ? 's' : ''}`);
      if (c.rich.attacks?.[0]) {
        const a = c.rich.attacks[0];
        const traits = a.traits.length ? ` (${a.traits.slice(0,3).join(', ')})` : '';
        console.log(`       ↳ ${a.type === 'ranged' ? '🏹' : '⚔️'} ${a.name} +${a.to_hit}${traits}, ${a.damage}`);
      }
    }
  }
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});