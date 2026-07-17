#!/usr/bin/env node
/**
 * Re-map ingested Foundry rule elements into our Layer-1 `PassiveEffect[]`.
 *
 * WHY THIS EXISTS SEPARATELY FROM `ingest-pf2e.mjs`: the two dependencies on Foundry
 * are different, and only one of them should ever be re-paid.
 *
 *   ingest-pf2e.mjs   needs a Foundry CLONE. It is how content ARRIVES. Run rarely.
 *   remap-effects.mjs needs NOTHING but this repo. It re-runs the MAPPER over rule
 *                     elements we already hold, so coverage improves as the mapper
 *                     improves — without ever going back to Foundry.
 *
 * That is the concrete form of "use them once, don't rely on them continuously": when
 * expr.ts learns infix arithmetic, or a new PassiveEffect kind lands, run this and
 * coverage rises. Foundry is not in the loop.
 *
 * INPUT (in priority order):
 *   1. the sidecar's `entities[].raw` — the normal path once migrated
 *   2. each bearer's legacy top-level `rules[]` — the ONE-TIME migration path, used
 *      when the sidecar does not exist yet
 *
 * EFFECT-BEARING DATASETS (an "effect bearer" is any content entity carrying rule
 * elements; the datasets differ only in how you WALK to them):
 *   • feats.json               — a flat array of feats.
 *   • ancestries.json          — rules live on the NESTED `heritages[]`, not on the
 *                                ancestry itself. Cavern Elf's darkvision is a
 *                                heritage's, so walking only the top level finds none.
 *   • versatile-heritages.json — a flat array of heritages (Nephilim, Dhampir, …).
 *
 * OUTPUT:
 *   • each dataset        — every bearer gains `effects` (ours); legacy `rules` removed.
 *                           These files are BUNDLED and shipped to every builder user,
 *                           so they carry only what the runtime actually reads.
 *   • <sidecar>.json      — `raw` (Foundry's shape, quarantined) + the per-element
 *                           report + a coverage summary. ADMIN-ONLY: deliberately not
 *                           imported by the builder, so none of it reaches a player's
 *                           browser.
 *
 * USAGE:
 *   node scripts/remap-effects.mjs [--data <dir>] [--dry]
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mapFoundryRules, summarizeReports } from '@pathway/core';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_DIR_DEFAULT = resolve(HERE, '..', 'src', 'features', 'builder', 'data');
const SIDECAR = 'effect-ingest-report.json';

function parseArgs(argv) {
  const out = { data: DATA_DIR_DEFAULT, dry: false };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--data') out.data = resolve(argv[++i]);
    else if (argv[i] === '--dry') out.dry = true;
  }
  return out;
}

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

/**
 * The datasets carrying rule elements, and how to reach the bearers in each.
 * `walk` yields every effect-bearing object in the parsed file.
 */
const DATASETS = [
  { file: 'feats.json', kind: 'feat', walk: (data) => data },
  {
    file: 'ancestries.json',
    kind: 'heritage',
    // Ancestries themselves carry none in the corpus; their heritages carry all 49.
    walk: (data) => data.flatMap((ancestry) => ancestry.heritages ?? []),
  },
  { file: 'versatile-heritages.json', kind: 'heritage', walk: (data) => data },
];

function main() {
  const args = parseArgs(process.argv);
  const sidecarPath = join(args.data, SIDECAR);

  // Prefer the sidecar's quarantined raw; fall back to the legacy inline `rules`.
  // Entities are keyed by kind so a heritage id can never shadow a feat id. A
  // pre-existing sidecar predates `kind` and is feats-only, hence the fallback.
  const sidecar = existsSync(sidecarPath) ? readJson(sidecarPath) : null;
  const rawById = new Map();
  for (const e of sidecar?.entities ?? []) {
    if (Array.isArray(e.raw) && e.raw.length) rawById.set(`${e.kind ?? 'feat'}:${e.id}`, e.raw);
  }

  const entities = [];
  const reports = [];
  const written = [];
  let withEffects = 0;
  let withChoices = 0;
  let strippedRules = 0;
  let fromSidecar = 0;
  let fromLegacy = 0;

  for (const dataset of DATASETS) {
    const path = join(args.data, dataset.file);
    if (!existsSync(path)) throw new Error(`no ${dataset.file} at ${path}`);
    const data = readJson(path);
    if (!Array.isArray(data)) throw new Error(`${dataset.file} is not an array`);
    let bearers = 0;

    for (const bearer of dataset.walk(data)) {
      const legacy = Array.isArray(bearer.rules) ? bearer.rules : null;
      const raw = rawById.get(`${dataset.kind}:${bearer.id}`) ?? legacy;
      if (legacy) strippedRules += 1;
      if (raw) (rawById.has(`${dataset.kind}:${bearer.id}`) ? fromSidecar++ : fromLegacy++);
      // The legacy field is Foundry's shape as a first-class field on our content,
      // and it is what the runtime used to read. It goes; `effects` replaces it.
      delete bearer.rules;
      delete bearer.effects;
      delete bearer.choices;

      if (!raw || raw.length === 0) continue;

      const { effects, choices, report } = mapFoundryRules(raw);
      reports.push(report);
      if (effects.length > 0) {
        bearer.effects = effects;
        withEffects += 1;
      }
      // Options + their effects are fixed content; only the pick is runtime.
      if (choices.length > 0) {
        bearer.choices = choices;
        withChoices += 1;
      }
      entities.push({ id: bearer.id, kind: dataset.kind, name: bearer.name, raw, report });
      bearers += 1;
    }
    written.push({ path, data, file: dataset.file, bearers });
  }

  const summary = summarizeReports(reports);
  const out = {
    // Provenance: which upstream snapshot these rule elements came from. The mapper
    // can be re-run against them forever without touching that source again.
    sourceCommit: sidecar?.sourceCommit ?? 'foundryvtt/pf2e@ea40c945bc2828ad8164e14fab8a2298484d4f4d',
    mappedAt: new Date().toISOString(),
    summary: {
      entities: entities.length,
      entitiesWithEffects: withEffects,
      entitiesWithChoices: withChoices,
      elements: summary.elements,
      mapped: summary.mapped,
      effectsProduced: summary.effects,
      unsupported: summary.unsupported,
      byReason: summary.byReason,
      byKey: summary.byKey,
    },
    entities,
  };

  const pct = (n) => `${((n / summary.elements) * 100).toFixed(1)}%`;
  console.log(`raw source       : ${fromSidecar} from sidecar, ${fromLegacy} from legacy rules[]`);
  console.log(`entities         : ${entities.length} (${withEffects} yield effects, ${withChoices} yield choices)`);
  for (const w of written) console.log(`  ${w.file.padEnd(25)}: ${w.bearers} bearers`);
  console.log(`rule elements    : ${summary.elements}`);
  console.log(`  mapped         : ${summary.mapped} (${pct(summary.mapped)}) -> ${summary.effects} effects`);
  console.log(`  unsupported    : ${summary.unsupported} (${pct(summary.unsupported)})`);
  console.log(`  silently lost  : 0`);
  console.log(`legacy rules[] stripped from ${strippedRules} bearers`);
  console.log('\nblockers, by reason:');
  for (const [k, v] of Object.entries(summary.byReason).sort((a, b) => b[1] - a[1])) {
    console.log(`${String(v).padStart(6)}  ${k}`);
  }

  if (args.dry) {
    console.log('\n--dry: nothing written');
    return;
  }
  for (const w of written) writeFileSync(w.path, `${JSON.stringify(w.data, null, 2)}\n`);
  writeFileSync(sidecarPath, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`\nwrote ${written.map((w) => w.file).join(', ')} + ${SIDECAR}`);
}

main();
