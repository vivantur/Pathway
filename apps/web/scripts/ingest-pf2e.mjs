#!/usr/bin/env node
/**
 * Ingest the Foundry VTT `pf2e` system data into Pathway's content dataset.
 *
 * WHY: our hand-seeded `data/*.json` carries only one-line flavor stubs (avg ~96
 * chars) with no mechanics — a player can't read what a feat or spell actually
 * does, and there's nothing to drive an effects engine from. Foundry's pf2e
 * packs are the authoritative machine-readable PF2e corpus: every document has
 * full rules text (`system.description.value`, HTML), structured spell fields
 * (range/area/defense/heightening), and a `system.rules[]` array of machine
 * effects (FlatModifier, ChoiceSet, GrantItem, …). We transform that into our
 * app schema, keeping our existing ids (Foundry's file slug == our id in almost
 * every case) so saved characters and recommendations keep resolving.
 *
 * SCOPE (first pass — "content depth"): fully re-ingest FEATS and SPELLS (the
 * two big, shallow datasets, and the safe ones — our engine reads none of their
 * mechanical fields today). For ancestries / heritages / backgrounds / classes
 * we only enrich the `description` text in place and DO NOT touch their
 * engine-critical mechanical fields (boosts, flaws, initialProficiencies) — those
 * are curated and locked by core's tests. Equipment is deliberately left alone
 * (the engine depends heavily on its mechanical fields; a separate pass).
 *
 * The raw `system.rules[]` is carried onto each feat/spell but is DORMANT — no
 * consumer reads it yet. It's captured now so the later effects-engine workstream
 * doesn't require a re-ingest.
 *
 * SOURCE: a local clone of https://github.com/foundryvtt/pf2e (blobless + sparse
 * on `packs/` is enough). Pinned reference during authoring:
 *   commit ea40c945bc2828ad8164e14fab8a2298484d4f4d (master, 2026-07)
 * The clone is never committed — only the generated JSON is. Re-runnable.
 *
 * LICENSING: per repo policy (CLAUDE.md, owner revision 2026-07-04) game content
 * may be imported freely with attribution; every entity keeps its `source`.
 *
 * USAGE:
 *   node scripts/ingest-pf2e.mjs --src <path-to-foundry-pf2e-clone> [--out <data-dir>] [--dry]
 */

import { mapFoundryRules, summarizeReports } from '@pathway/core';
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';

/**
 * The upstream snapshot this ingest reads. Recorded onto the effect sidecar so a
 * later re-map can state which Foundry revision its rule elements came from, and
 * diff against a newer one. Keep in step with the header's pinned commit.
 */
const PINNED_SOURCE = 'foundryvtt/pf2e@ea40c945bc2828ad8164e14fab8a2298484d4f4d';
import { join, basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR_DEFAULT = resolve(__dirname, '../src/features/builder/data');

// ---------------------------------------------------------------------------
// args
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const out = { src: null, out: DATA_DIR_DEFAULT, dry: false };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--src') out.src = argv[++i];
    else if (a === '--out') out.out = argv[++i];
    else if (a === '--dry') out.dry = true;
    else throw new Error(`Unknown argument: ${a}`);
  }
  if (!out.src) throw new Error('Missing --src <path-to-foundry-pf2e-clone>');
  const packsRoot = join(out.src, 'packs', 'pf2e');
  if (!existsSync(packsRoot)) throw new Error(`No packs/pf2e under --src (${packsRoot})`);
  return { ...out, packsRoot };
}

// ---------------------------------------------------------------------------
// fs helpers
// ---------------------------------------------------------------------------
function walkJson(dir) {
  const results = [];
  if (!existsSync(dir)) return results;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) results.push(...walkJson(p));
    else if (name.endsWith('.json') && name !== '_folders.json') results.push(p);
  }
  return results;
}
const readDoc = (p) => JSON.parse(readFileSync(p, 'utf8'));
const slugOf = (p) => basename(p, '.json');

// ---------------------------------------------------------------------------
// @UUID resolution index — map a document _id (16-char) to its display name so
// `@UUID[Compendium.pf2e.pack.Item.<id>]` refs resolve to a readable name.
// ---------------------------------------------------------------------------
function buildUuidIndex(packsRoot) {
  const byId = new Map();
  for (const p of walkJson(packsRoot)) {
    try {
      const d = readDoc(p);
      if (d._id && d.name) byId.set(d._id, d.name);
    } catch {
      /* skip unreadable */
    }
  }
  return byId;
}

// ---------------------------------------------------------------------------
// enrichers — turn Foundry @-codes + HTML into clean Markdown for display
// ---------------------------------------------------------------------------
const titleCase = (s) => s.replace(/\b\w/g, (c) => c.toUpperCase());

function resolveInlineCodes(text, uuidById) {
  let s = text;

  // @UUID[...]{Label} -> Label
  s = s.replace(/@UUID\[[^\]]*\]\{([^}]*)\}/g, (_m, label) => label);
  // @UUID[Compendium.pkg.pack.Item.NameOrId] -> resolved name
  s = s.replace(/@UUID\[([^\]]*)\]/g, (_m, ref) => {
    const last = ref.split('.').pop() ?? ref;
    if (/^[A-Za-z0-9]{16}$/.test(last) && uuidById.has(last)) return uuidById.get(last);
    return last.replace(/^Item\./, '');
  });

  // @Damage[formula[types]|opts]{label} -> label ; else "formula type".
  // Content can nest one [...] group and carry "|options:…|traits:…" tails; the
  // damage spec is always the first "|"-segment ("6d6[fire]", "3d8[persistent,void]",
  // "(@item.rank)d12[cold]"). Scaling refs are humanized (@item.rank -> "rank").
  s = s.replace(/@Damage\[((?:[^[\]]|\[[^\]]*\])*)\](?:\{([^}]*)\})?/g, (_m, body, label) => {
    if (label) return label;
    const spec = body.split('|')[0].trim(); // drop "|options:…|traits:…" tail
    // spec may hold several instances: "2d6[piercing],2d6[persistent,piercing]"
    const groups = [...spec.matchAll(/([^,[\]]*)\[([^\]]*)\]/g)];
    if (!groups.length) return spec;
    return groups
      .map((g) => {
        const formula = g[1].replace(/@item\.rank/g, 'rank').replace(/@(?:item|actor)\.level/g, 'level').trim();
        const types = g[2].split(',').map((t) => t.trim()).filter(Boolean).join(' ');
        return `${formula} ${types}`.trim();
      })
      .join(' plus ');
  });

  // @Check[statistic|params] -> "Statistic DC N" / "Statistic (vs X)" / "Statistic"
  s = s.replace(/@Check\[([^\]]*)\](?:\{([^}]*)\})?/g, (_m, body, label) => {
    if (label) return label;
    const [statRaw, ...paramParts] = body.split('|');
    const params = Object.fromEntries(
      paramParts.map((kv) => {
        const [k, ...v] = kv.split(':');
        return [k, v.join(':')];
      }),
    );
    const stat = titleCase((statRaw || '').replace(/-/g, ' '));
    if (params.dc) return `${stat} DC ${params.dc}`;
    if (params.against || params.defense) return `${stat} (vs ${titleCase(params.against || params.defense)})`;
    return stat;
  });

  // @Template[type:shape|distance:N|...] (or older "shape|distance:N") -> "N-foot shape"
  s = s.replace(/@Template\[([^\]]*)\](?:\{([^}]*)\})?/g, (_m, body, label) => {
    if (label) return label;
    const params = {};
    let positionalShape = null;
    for (const seg of body.split('|')) {
      const [k, ...v] = seg.split(':');
      if (v.length) params[k] = v.join(':');
      else positionalShape = k;
    }
    const shape = params.type || positionalShape || 'area';
    return params.distance ? `${params.distance}-foot ${shape}` : shape;
  });

  // @Embed[...]{label} / @Localize[...] -> drop to label or last segment
  s = s.replace(/@Embed\[[^\]]*\]\{([^}]*)\}/g, (_m, label) => label);
  s = s.replace(/@Embed\[([^\]]*)\]/g, (_m, ref) => (ref.split('.').pop() ?? '').replace(/^Item\./, ''));
  s = s.replace(/@Localize\[([^\]]*)\]/g, (_m, ref) => titleCase((ref.split('.').pop() ?? '').replace(/([A-Z])/g, ' $1').trim()));

  return s;
}

const HTML_ENTITIES = {
  '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"',
  '&#39;': "'", '&rsquo;': '’', '&lsquo;': '‘', '&rdquo;': '”',
  '&ldquo;': '“', '&mdash;': '—', '&ndash;': '–', '&times;': '×',
  '&plusmn;': '±', '&hellip;': '…', '&frac12;': '½',
};

function htmlToMarkdown(html) {
  let s = html;
  s = s.replace(/<hr\s*\/?>/gi, '\n\n---\n\n');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<\/(p|div)>/gi, '\n\n');
  s = s.replace(/<(p|div)[^>]*>/gi, '');
  s = s.replace(/<(strong|b)>/gi, '**').replace(/<\/(strong|b)>/gi, '**');
  s = s.replace(/<(em|i)>/gi, '*').replace(/<\/(em|i)>/gi, '*');
  s = s.replace(/<li[^>]*>/gi, '\n- ').replace(/<\/li>/gi, '');
  s = s.replace(/<\/?(ul|ol)[^>]*>/gi, '\n');
  s = s.replace(/<h[1-6][^>]*>/gi, '\n\n**').replace(/<\/h[1-6]>/gi, '**\n\n');
  s = s.replace(/<table[^>]*>/gi, '\n').replace(/<\/table>/gi, '\n');
  s = s.replace(/<\/tr>/gi, '\n').replace(/<\/t[dh]>/gi, ' | ');
  s = s.replace(/<[^>]+>/g, ''); // strip any remaining tags
  for (const [ent, ch] of Object.entries(HTML_ENTITIES)) s = s.split(ent).join(ch);
  s = s.replace(/&#(\d+);/g, (_m, n) => String.fromCodePoint(Number(n)));
  s = s.replace(/\n{3,}/g, '\n\n').replace(/[ \t]+\n/g, '\n').trim();
  return s;
}

function enrich(html, uuidById) {
  if (!html) return '';
  return htmlToMarkdown(resolveInlineCodes(html, uuidById));
}

// ---------------------------------------------------------------------------
// small field helpers
// ---------------------------------------------------------------------------
function featActionCost(system) {
  const kind = system.actionType?.value ?? 'passive';
  if (kind === 'passive') return undefined;
  if (kind === 'reaction') return 'reaction';
  if (kind === 'free') return 'free';
  const n = system.actions?.value;
  return n ? String(n) : 'action';
}
function spellActionCost(system) {
  return system.time?.value || undefined;
}
function rarityOf(system) {
  const r = system.traits?.rarity;
  return r && r !== 'common' ? r : undefined;
}
function sourceOf(system) {
  return system.publication?.title || 'Pathfinder';
}
function areaText(area) {
  if (!area || area.value == null) return undefined;
  return `${area.value}-foot ${area.type ?? 'area'}`;
}
function defenseText(defense) {
  const save = defense?.save;
  if (!save?.statistic) return undefined;
  return `${save.basic ? 'basic ' : ''}${titleCase(save.statistic)}`;
}

// map Foundry feat category -> our FeatType union
const FEAT_TYPE = {
  ancestry: 'ancestry', class: 'class', skill: 'skill',
  general: 'general', archetype: 'archetype',
  miscellaneous: 'general', mythic: 'class',
};

// ---------------------------------------------------------------------------
// transformers
// ---------------------------------------------------------------------------
function transformFeat(path, doc, uuidById, knownClassIds) {
  const s = doc.system ?? {};
  const slug = slugOf(path);
  const rel = path.split(/[\\/]/); // .../feats/<category>/<group>/level-N/<slug>.json
  const catIdx = rel.lastIndexOf('feats');
  const category = rel[catIdx + 1]; // ancestry|class|general|skill|archetype|miscellaneous|mythic
  const groupFolder = rel[catIdx + 2]; // class or ancestry slug, or level-N/…

  const traitVals = s.traits?.value ?? [];
  const classIds =
    category === 'class'
      ? [...new Set(traitVals.filter((t) => knownClassIds.has(t)))].length
        ? [...new Set(traitVals.filter((t) => knownClassIds.has(t)))]
        : knownClassIds.has(groupFolder)
          ? [groupFolder]
          : undefined
      : undefined;
  const ancestryId = category === 'ancestry' && groupFolder && groupFolder !== 'versatile' ? groupFolder : undefined;

  const prereq = (s.prerequisites?.value ?? [])
    .map((x) => (typeof x === 'string' ? x : x?.value))
    .filter(Boolean)
    .join('; ');

  const traits = [...traitVals];
  const rarity = rarityOf(s);
  if (rarity && !traits.includes(rarity)) traits.push(rarity);

  return {
    id: slug,
    name: doc.name,
    level: s.level?.value ?? 0,
    type: FEAT_TYPE[category] ?? 'general',
    traits,
    ...(prereq ? { prerequisites: prereq } : {}),
    ...(classIds ? { classIds } : {}),
    ...(ancestryId ? { ancestryId } : {}),
    ...(featActionCost(s) ? { actionCost: featActionCost(s) } : {}),
    ...(rarity ? { rarity } : {}),
    source: sourceOf(s),
    description: enrich(s.description?.value ?? '', uuidById),
    // Foundry's `system.rules[]` is NOT carried onto the feat. It is mapped into our
    // own PassiveEffect schema below (mapEffects) and the raw elements are quarantined
    // in the admin-only sidecar. Their shape must not be a field on our content, and
    // must never reach a runtime consumer — see packages/core/src/foundry.ts.
    ...(Array.isArray(s.rules) && s.rules.length ? { _rawRules: s.rules } : {}),
  };
}

/**
 * Map every feat's Foundry rule elements into our `PassiveEffect[]`, strip the raw,
 * and build the admin-only sidecar (raw + per-element report + coverage summary).
 *
 * Mirrors scripts/remap-effects.mjs, which does this WITHOUT a Foundry clone once the
 * raw is in the sidecar. That script is the one to re-run as the mapper improves; this
 * path only matters when content itself is re-ingested.
 */
function mapEffects(feats) {
  const entities = [];
  const reports = [];
  let withEffects = 0;
  for (const feat of feats) {
    const raw = feat._rawRules;
    delete feat._rawRules;
    if (!Array.isArray(raw) || raw.length === 0) continue;
    const { effects, report } = mapFoundryRules(raw);
    reports.push(report);
    if (effects.length > 0) {
      feat.effects = effects;
      withEffects += 1;
    }
    entities.push({ id: feat.id, name: feat.name, raw, report });
  }
  const summary = summarizeReports(reports);
  return {
    sidecar: {
      sourceCommit: PINNED_SOURCE,
      mappedAt: new Date().toISOString(),
      summary: {
        entities: entities.length,
        entitiesWithEffects: withEffects,
        elements: summary.elements,
        mapped: summary.mapped,
        effectsProduced: summary.effects,
        unsupported: summary.unsupported,
        byReason: summary.byReason,
        byKey: summary.byKey,
      },
      entities,
    },
    summary,
  };
}

function transformSpell(path, doc, uuidById) {
  const s = doc.system ?? {};
  const slug = slugOf(path);
  const traitVals = s.traits?.value ?? [];
  const traditions = s.traits?.traditions ?? [];
  const traits = [...traitVals];
  const rarity = rarityOf(s);
  if (rarity && !traits.includes(rarity)) traits.push(rarity);

  const durationVal = s.duration?.value || (s.duration?.sustained ? 'sustained' : '');

  return {
    id: slug,
    name: doc.name,
    rank: s.level?.value ?? 1,
    traditions,
    traits,
    cast: s.time?.value ?? '',
    ...(spellActionCost(s) ? { actionCost: spellActionCost(s) } : {}),
    ...(s.range?.value ? { range: s.range.value } : {}),
    ...(areaText(s.area) ? { area: areaText(s.area) } : {}),
    ...(s.target?.value ? { targets: s.target.value } : {}),
    ...(durationVal ? { duration: durationVal } : {}),
    ...(defenseText(s.defense) ? { defense: defenseText(s.defense) } : {}),
    ...(s.heightening ? { heightening: s.heightening } : {}),
    ...(rarity ? { rarity } : {}),
    source: sourceOf(s),
    description: enrich(s.description?.value ?? '', uuidById),
  };
}

// ---------------------------------------------------------------------------
// dedup — Foundry mostly replaced legacy content in place, so `remaster:false`
// docs are non-reprinted unique content, NOT duplicates. Only collapse EXACT
// name collisions, preferring the remastered version.
// ---------------------------------------------------------------------------
function dedupeByName(docs, remasterOf) {
  const byName = new Map();
  for (const d of docs) {
    const key = d.name.toLowerCase();
    const existing = byName.get(key);
    if (!existing) byName.set(key, d);
    else if (remasterOf.get(d.id) && !remasterOf.get(existing.id)) byName.set(key, d);
  }
  return [...byName.values()];
}

// Normalize a name for aliasing: lowercase, drop a trailing "(Rogue)"-style
// disambiguator our old data added, unify apostrophes.
const normName = (s) =>
  s.toLowerCase().replace(/\s*\([^)]*\)\s*$/, '').replace(/[’']/g, "'").trim();

/**
 * Reconcile old ids the new corpus dropped. For each dropped id:
 *   - if its (normalized) name matches a new entry, record an ALIAS
 *     old id → new id (the enriched entry supersedes it); else
 *   - PRESERVE the old entry verbatim (tagged `legacy`) so the id still
 *     resolves — used for playtest classes Foundry doesn't yet ship (necromancer
 *     Impossible Playtest, runesmith playtest).
 * Returns { aliases, preserved }.
 */
// `priorAliases` (from a previous run's content-aliases.json) makes this
// idempotent: re-running against already-migrated data keeps the aliases whose
// target still exists and re-preserves `legacy` entries as-is, so a second run
// doesn't silently drop the id-resolution the first run established.
function reconcile(newList, oldList, priorAliases = {}) {
  const newIds = new Set(newList.map((x) => x.id));
  const byNormName = new Map();
  for (const x of newList) if (!byNormName.has(normName(x.name))) byNormName.set(normName(x.name), x.id);
  const aliases = {};
  for (const [oldId, newId] of Object.entries(priorAliases)) if (newIds.has(newId)) aliases[oldId] = newId;
  const preserved = [];
  for (const old of oldList) {
    if (newIds.has(old.id) || aliases[old.id]) continue;
    if (old.legacy) {
      preserved.push(old);
      continue;
    }
    const target = byNormName.get(normName(old.name));
    if (target) aliases[old.id] = target;
    else preserved.push({ ...old, legacy: true });
  }
  return { aliases, preserved };
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
function main() {
  const { packsRoot, out, dry } = parseArgs(process.argv);
  const log = (...a) => console.log(...a);

  log('Building @UUID index across all packs…');
  const uuidById = buildUuidIndex(packsRoot);
  log(`  indexed ${uuidById.size} documents`);

  // Known ids for reconciliation / classId derivation.
  const existingFeats = readDoc(join(out, 'feats.json'));
  const existingSpells = readDoc(join(out, 'spells.json'));
  const classes = readDoc(join(out, 'classes.json'));
  const knownClassIds = new Set(classes.map((c) => c.id));
  const existingFeatIds = new Set(existingFeats.map((f) => f.id));
  const existingSpellIds = new Set(existingSpells.map((s) => s.id));

  // ---- FEATS ----
  log('Transforming feats…');
  const featRemaster = new Map();
  let feats = walkJson(join(packsRoot, 'feats')).map((p) => {
    const doc = readDoc(p);
    featRemaster.set(slugOf(p), doc.system?.publication?.remaster === true);
    return transformFeat(p, doc, uuidById, knownClassIds);
  });
  const featsBefore = feats.length;
  feats = dedupeByName(feats, featRemaster).sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));

  // ---- SPELLS ----
  log('Transforming spells…');
  const spellRemaster = new Map();
  let spells = walkJson(join(packsRoot, 'spells')).map((p) => {
    const doc = readDoc(p);
    spellRemaster.set(slugOf(p), doc.system?.publication?.remaster === true);
    return transformSpell(p, doc, uuidById);
  });
  const spellsBefore = spells.length;
  spells = dedupeByName(spells, spellRemaster).sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));

  // ---- in-place description enrichment for ancestry/heritage/background/class ----
  // Only the `description` text is replaced; mechanical fields are untouched.
  log('Enriching descriptions for ancestries / heritages / backgrounds / classes…');
  const descIndex = new Map(); // slug -> enriched description
  // slug -> the level a class grants (Greater) Weapon Specialization, read from
  // the class doc's system.items progression (authoritative per-class levels).
  const wsLevels = new Map();
  // slug -> { vision?, rules? } for ancestries/heritages — base vision plus the
  // trait-relevant subset of rule elements (Sense/Resistance) the effects engine
  // reads. Everything else on those docs is intentionally left out.
  const traitIndex = new Map();
  const traitRules = (doc) =>
    (doc.system?.rules ?? []).filter((r) => r && (r.key === 'Sense' || r.key === 'Resistance'));
  for (const type of ['ancestries', 'heritages', 'backgrounds', 'classes']) {
    for (const p of walkJson(join(packsRoot, type))) {
      const doc = readDoc(p);
      const slug = slugOf(p);
      descIndex.set(slug, enrich(doc.system?.description?.value ?? '', uuidById));
      if (type === 'classes') {
        const items = Object.values(doc.system?.items ?? {});
        const lvlOf = (name) => items.find((i) => i.name === name)?.level;
        wsLevels.set(slug, {
          weaponSpecialization: lvlOf('Weapon Specialization'),
          greaterWeaponSpecialization: lvlOf('Greater Weapon Specialization'),
        });
      }
      if (type === 'ancestries' || type === 'heritages') {
        const entry = {};
        const rules = traitRules(doc);
        if (rules.length) entry.rules = rules;
        if (type === 'ancestries' && typeof doc.system?.vision === 'string') entry.vision = doc.system.vision;
        traitIndex.set(slug, entry);
      }
    }
  }
  const enrichDescriptions = (list) => {
    let hit = 0;
    for (const item of list) {
      const d = descIndex.get(item.id);
      if (d) {
        item.description = d;
        hit += 1;
      }
    }
    return hit;
  };
  const ancestries = readDoc(join(out, 'ancestries.json'));
  const backgrounds = readDoc(join(out, 'backgrounds.json'));
  const versatileHeritages = readDoc(join(out, 'versatile-heritages.json'));
  const ancHit = enrichDescriptions(ancestries);
  // heritages live nested under each ancestry, plus the versatile-heritages file
  let herHit = 0;
  for (const anc of ancestries)
    for (const h of anc.heritages ?? []) {
      const d = descIndex.get(h.id);
      if (d) {
        h.description = d;
        herHit += 1;
      }
    }
  herHit += enrichDescriptions(versatileHeritages);
  const bgHit = enrichDescriptions(backgrounds);
  const clsHit = enrichDescriptions(classes);
  // Weapon Specialization grant levels (mechanical field — additive, never clobbers).
  for (const c of classes) {
    const ws = wsLevels.get(c.id);
    if (ws?.weaponSpecialization != null) c.weaponSpecialization = ws.weaponSpecialization;
    else delete c.weaponSpecialization;
    if (ws?.greaterWeaponSpecialization != null) c.greaterWeaponSpecialization = ws.greaterWeaponSpecialization;
    else delete c.greaterWeaponSpecialization;
  }

  // Base vision + trait rules (Sense/Resistance) for ancestries and heritages —
  // additive mechanical fields, re-applied idempotently (deleted when absent so a
  // re-ingest never leaves stale data).
  let visionHit = 0;
  let traitRuleHit = 0;
  const applyTraits = (item) => {
    const entry = traitIndex.get(item.id);
    if (entry?.vision) {
      item.vision = entry.vision;
      visionHit += 1;
    } else if ('vision' in item) {
      delete item.vision;
    }
    if (entry?.rules?.length) {
      item.rules = entry.rules;
      traitRuleHit += 1;
    } else if ('rules' in item) {
      delete item.rules;
    }
  };
  for (const anc of ancestries) {
    applyTraits(anc);
    for (const h of anc.heritages ?? []) applyTraits(h);
  }
  for (const h of versatileHeritages) applyTraits(h);

  // ---- reconciliation: alias consolidated ids, preserve Foundry-absent ones ----
  const priorAliases = existsSync(join(out, 'content-aliases.json'))
    ? readDoc(join(out, 'content-aliases.json'))
    : { feats: {}, spells: {} };
  const featRecon = reconcile(feats, existingFeats, priorAliases.feats);
  const spellRecon = reconcile(spells, existingSpells, priorAliases.spells);
  feats.push(...featRecon.preserved);
  spells.push(...spellRecon.preserved);
  feats.sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
  spells.sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));
  const aliases = { feats: featRecon.aliases, spells: spellRecon.aliases };

  // Rewrite curated recommendations through the alias map so they keep resolving.
  const recommendations = readDoc(join(out, 'recommendations.json'));
  let recRewritten = 0;
  for (const bucket of Object.values(recommendations)) {
    for (const recs of Object.values(bucket)) {
      for (const rec of recs) {
        if (aliases.feats[rec.featId]) {
          rec.featId = aliases.feats[rec.featId];
          recRewritten += 1;
        }
      }
    }
  }

  // Map Foundry's rule elements into our schema and strip the raw off the feats.
  // After this point no Foundry-shaped data remains on any content record.
  const { sidecar, summary: effectSummary } = mapEffects(feats);

  const newFeatIds = new Set(feats.map((f) => f.id));
  const newSpellIds = new Set(spells.map((s) => s.id));
  const report = {
    generatedFrom: 'foundryvtt/pf2e packs/pf2e',
    effects: {
      entities: sidecar.summary.entities,
      entitiesWithEffects: sidecar.summary.entitiesWithEffects,
      elements: effectSummary.elements,
      mapped: effectSummary.mapped,
      effectsProduced: effectSummary.effects,
      unsupported: effectSummary.unsupported,
      byReason: effectSummary.byReason,
    },
    feats: {
      raw: featsBefore,
      total: feats.length,
      preservedExistingIds: [...newFeatIds].filter((id) => existingFeatIds.has(id)).length,
      newIds: feats.filter((f) => !existingFeatIds.has(f.id) && !f.legacy).length,
      aliased: Object.keys(featRecon.aliases).length,
      preservedLegacy: featRecon.preserved.length,
    },
    spells: {
      raw: spellsBefore,
      total: spells.length,
      preservedExistingIds: [...newSpellIds].filter((id) => existingSpellIds.has(id)).length,
      newIds: spells.filter((s) => !existingSpellIds.has(s.id) && !s.legacy).length,
      aliased: Object.keys(spellRecon.aliases).length,
      preservedLegacy: spellRecon.preserved.length,
    },
    aliasSample: Object.entries(featRecon.aliases).slice(0, 10),
    legacyPreservedSample: featRecon.preserved.slice(0, 8).map((f) => f.id),
    recommendationsRewritten: recRewritten,
    descriptionsEnriched: { ancestries: ancHit, heritages: herHit, backgrounds: bgHit, classes: clsHit },
    traits: { vision: visionHit, senseResistanceRules: traitRuleHit },
  };
  log('\n=== ingest report ===');
  log(JSON.stringify(report, null, 2));

  if (dry) {
    log('\n--dry: no files written.');
    return;
  }

  // Pretty-print (2-space) to match the repo's data convention and keep future
  // re-ingest diffs reviewable line-by-line rather than one giant minified line.
  const write = (name, data) => {
    writeFileSync(join(out, name), `${JSON.stringify(data, null, 2)}\n`);
    log(`wrote ${name} (${(JSON.stringify(data).length / 1e6).toFixed(2)} MB min)`);
  };
  write('feats.json', feats);
  write('spells.json', spells);
  write('ancestries.json', ancestries);
  write('backgrounds.json', backgrounds);
  write('versatile-heritages.json', versatileHeritages);
  write('classes.json', classes);
  write('content-aliases.json', aliases);
  write('recommendations.json', recommendations);
  writeFileSync(join(out, 'ingest-report.json'), JSON.stringify(report, null, 2));
  log('wrote ingest-report.json');
  // Admin-only: Foundry's raw elements + the per-element mapping report. NOT imported
  // by the builder — it must not ship to a player's browser.
  write('effect-ingest-report.json', sidecar);
}

main();
