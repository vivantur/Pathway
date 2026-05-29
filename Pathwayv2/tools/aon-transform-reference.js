// tools/aon-transform-reference.js
//
// Generic AoN transformer for reference categories that Pathway looks up but
// does not need to mechanically automate yet: actions, hazards, rituals,
// traits, afflictions, languages, domains, planes, relics, familiars, vehicles,
// siege weapons, kingdom entries, class features, and class option buckets.

'use strict';

const fs = require('fs');
const path = require('path');

const RAW_DIR = path.join(__dirname, '..', 'gamedata', 'aon-raw');
const OUT_DIR = path.join(__dirname, '..', 'gamedata');

const DRY_RUN = process.argv.includes('--dry-run');
const VERBOSE = process.argv.includes('--verbose');
const requested = process.argv.filter((a, i) => i > 1 && !a.startsWith('--'));

const CONFIG = {
  actions: {
    outFile: 'actions.json',
    raw: ['action', 'skill-general-action'],
    label: 'Actions and Activities',
    topKey: 'actions',
  },
  hazards: {
    outFile: 'hazards.json',
    raw: ['hazard', 'weather-hazard'],
    label: 'Hazards',
    topKey: 'hazards',
  },
  rituals: {
    outFile: 'rituals.json',
    raw: ['ritual'],
    label: 'Rituals',
    topKey: 'rituals',
  },
  traits: {
    outFile: 'traits.json',
    raw: ['trait'],
    label: 'Traits',
    topKey: 'traits',
  },
  afflictions: {
    outFile: 'afflictions.json',
    raw: ['curse', 'disease'],
    label: 'Afflictions',
    topKey: 'afflictions',
  },
  languages: {
    outFile: 'languages.json',
    raw: ['language'],
    label: 'Languages',
    topKey: 'languages',
  },
  domains: {
    outFile: 'domains.json',
    raw: ['domain'],
    label: 'Domains',
    topKey: 'domains',
  },
  planes: {
    outFile: 'planes.json',
    raw: ['plane'],
    label: 'Planes',
    topKey: 'planes',
  },
  relics: {
    outFile: 'relics.json',
    raw: ['relic', 'set-relic'],
    label: 'Relics',
    topKey: 'relics',
  },
  familiars: {
    outFile: 'familiars.json',
    raw: ['familiar-ability', 'familiar-specific'],
    label: 'Familiars',
    topKey: 'familiars',
  },
  vehicles: {
    outFile: 'vehicles.json',
    raw: ['vehicle'],
    label: 'Vehicles',
    topKey: 'vehicles',
  },
  siege: {
    outFile: 'siege-weapons.json',
    raw: ['siege-weapon'],
    label: 'Siege Weapons',
    topKey: 'siege_weapons',
  },
  kingdom: {
    outFile: 'kingdom.json',
    raw: ['kingdom-structure', 'kingdom-event'],
    label: 'Kingdom',
    topKey: 'kingdom',
  },
  classfeatures: {
    outFile: 'class-features.json',
    raw: [
      'class-feature',
      'bloodline', 'lesson', 'patron', 'mystery', 'cause', 'doctrine', 'instinct',
      'muse', 'racket', 'research-field', 'arcane-school', 'arcane-thesis',
      'eidolon', 'implement', 'innovation', 'hybrid-study', 'methodology',
      'conscious-mind', 'subconscious-mind',
      'hunters-edge', 'druidic-order', 'apparition', 'way', 'style',
    ],
    label: 'Class Features',
    topKey: 'class_features',
  },
  creatureextras: {
    outFile: 'creature-extras.json',
    raw: ['creature-ability', 'creature-adjustment', 'creature-theme-template'],
    label: 'Creature Extras',
    topKey: 'creature_extras',
  },
  sources: {
    outFile: 'sources.json',
    raw: ['source'],
    label: 'Sources',
    topKey: 'sources',
  },
};

function slugify(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/['\u2018\u2019\u02bc\u201c\u201d]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

function capitalize(s) {
  if (!s || typeof s !== 'string') return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function stripMarkup(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    .replace(/<title[\s\S]*?<\/title>/g, '')
    .replace(/<traits>[\s\S]*?<\/traits>/g, '')
    .replace(/<image[^/]*\/>/g, '')
    .replace(/<column[^>]*>|<\/column>/g, '')
    .replace(/<row[^>]*>|<\/row>/g, '')
    .replace(/<aside[\s\S]*?<\/aside>/g, '')
    .replace(/<additional-info>[\s\S]*?<\/additional-info>/g, '')
    .replace(/<summary>([\s\S]*?)<\/summary>/g, '$1')
    .replace(/<actions[^/]*\/>/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/\r\n/g, '\n')
    .trim();
}

function descriptionFrom(raw) {
  const clean = stripMarkup(raw.markdown);
  if (!clean) return raw.summary || '';
  const parts = clean.split(/\n\s*---\s*\n/).map(p => p.trim()).filter(Boolean);
  if (parts.length >= 2) return parts.slice(1).join('\n\n');
  return clean;
}

function arrayField(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (value == null || value === '') return [];
  return [value];
}

function sourceFrom(raw) {
  return raw.primary_source_raw
    || raw.primary_source
    || arrayField(raw.source_raw)[0]
    || arrayField(raw.source)[0]
    || null;
}

function transform(raw, rawCategory) {
  if (!raw || !raw.name) return null;
  const traits = arrayField(raw.trait).filter(t => String(t).toLowerCase() !== 'common');
  return {
    id: raw.id || null,
    slug: slugify(raw.name),
    name: raw.name,
    lookup_name: String(raw.name).toLowerCase(),
    category: rawCategory,
    level: raw.level != null ? Number(raw.level) : null,
    rarity: capitalize(raw.rarity || 'common'),
    traits,
    actions: raw.actions || null,
    action_type: raw.action_type || null,
    trigger: raw.trigger || null,
    requirements: raw.requirements || null,
    frequency: raw.frequency || null,
    prerequisite: raw.prerequisite || null,
    access: raw.access || null,
    price_raw: raw.price_raw || null,
    bulk_raw: raw.bulk_raw || null,
    pfs_availability: raw.pfs || null,
    source: sourceFrom(raw),
    summary: raw.summary || null,
    description: descriptionFrom(raw),
    aon_url: raw.url ? `https://2e.aonprd.com${raw.url}` : null,
    _aon_imported: true,
    _aon_imported_at: new Date().toISOString(),
  };
}

function loadRaw(rawCategory) {
  const file = path.join(RAW_DIR, `${rawCategory}.json`);
  if (!fs.existsSync(file)) return [];
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function disambiguate(entries) {
  const seen = new Map();
  const map = {};
  for (const entry of entries) {
    const base = entry.slug || slugify(entry.name);
    const next = (seen.get(base) || 0) + 1;
    seen.set(base, next);
    const slug = next === 1 ? base : `${base}-${next}`;
    map[slug] = { ...entry, slug };
  }
  return map;
}

function runOne(key, cfg) {
  const entries = [];
  const missing = [];
  for (const rawCategory of cfg.raw) {
    const raw = loadRaw(rawCategory);
    if (!raw.length) {
      missing.push(rawCategory);
      continue;
    }
    for (const doc of raw) {
      const entry = transform(doc, rawCategory);
      if (entry) entries.push(entry);
    }
  }

  const payload = {
    _meta: {
      label: cfg.label,
      generated_at: new Date().toISOString(),
      raw_categories: cfg.raw,
      missing_raw_categories: missing,
      count: entries.length,
    },
    [cfg.topKey]: disambiguate(entries),
  };

  if (VERBOSE) {
    console.log(`${key}: ${entries.length} entries (${missing.length ? `missing ${missing.join(', ')}` : 'all raw present'})`);
  }

  if (!DRY_RUN) {
    fs.writeFileSync(path.join(OUT_DIR, cfg.outFile), JSON.stringify(payload, null, 2), 'utf8');
  }

  return { key, count: entries.length, missing };
}

function main() {
  const keys = requested.length ? requested : Object.keys(CONFIG);
  const unknown = keys.filter(k => !CONFIG[k]);
  if (unknown.length) {
    console.error(`Unknown reference set(s): ${unknown.join(', ')}`);
    console.error(`Known sets: ${Object.keys(CONFIG).join(', ')}`);
    process.exit(1);
  }

  const results = keys.map(k => runOne(k, CONFIG[k]));
  for (const r of results) {
    const note = r.missing.length ? ` (missing raw: ${r.missing.join(', ')})` : '';
    console.log(`${DRY_RUN ? 'Would write' : 'Wrote'} ${CONFIG[r.key].outFile}: ${r.count.toLocaleString()} entries${note}`);
  }
}

main();
