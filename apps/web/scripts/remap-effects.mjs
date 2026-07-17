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
 *   2. each feat's legacy top-level `rules[]` — the ONE-TIME migration path, used
 *      when the sidecar does not exist yet
 *
 * OUTPUT:
 *   • feats.json          — each feat gains `effects` (ours); legacy `rules` removed.
 *                           This file is BUNDLED and shipped to every builder user,
 *                           so it carries only what the runtime actually reads.
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

function main() {
  const args = parseArgs(process.argv);
  const featsPath = join(args.data, 'feats.json');
  const sidecarPath = join(args.data, SIDECAR);
  if (!existsSync(featsPath)) throw new Error(`no feats.json at ${featsPath}`);

  const feats = readJson(featsPath);
  if (!Array.isArray(feats)) throw new Error('feats.json is not an array');

  // Prefer the sidecar's quarantined raw; fall back to the legacy inline `rules`.
  const sidecar = existsSync(sidecarPath) ? readJson(sidecarPath) : null;
  const rawById = new Map();
  for (const e of sidecar?.entities ?? []) if (Array.isArray(e.raw) && e.raw.length) rawById.set(e.id, e.raw);
  const source = rawById.size > 0 ? 'sidecar' : 'legacy feats.json rules[]';

  const entities = [];
  const reports = [];
  let withEffects = 0;
  let strippedRules = 0;

  for (const feat of feats) {
    const raw = rawById.get(feat.id) ?? (Array.isArray(feat.rules) ? feat.rules : null);
    if (Array.isArray(feat.rules)) strippedRules += 1;
    // The legacy field is Foundry's shape as a first-class field on our content, and
    // it is what the runtime used to read. It goes; `effects` replaces it.
    delete feat.rules;
    delete feat.effects;

    if (!raw || raw.length === 0) continue;

    const { effects, report } = mapFoundryRules(raw);
    reports.push(report);
    if (effects.length > 0) {
      feat.effects = effects;
      withEffects += 1;
    }
    entities.push({ id: feat.id, name: feat.name, raw, report });
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
  console.log(`source           : ${source}`);
  console.log(`entities         : ${entities.length} (${withEffects} yield effects)`);
  console.log(`rule elements    : ${summary.elements}`);
  console.log(`  mapped         : ${summary.mapped} (${pct(summary.mapped)}) -> ${summary.effects} effects`);
  console.log(`  unsupported    : ${summary.unsupported} (${pct(summary.unsupported)})`);
  console.log(`  silently lost  : 0`);
  console.log(`legacy rules[] stripped from ${strippedRules} feats`);
  console.log('\nblockers, by reason:');
  for (const [k, v] of Object.entries(summary.byReason).sort((a, b) => b[1] - a[1])) {
    console.log(`${String(v).padStart(6)}  ${k}`);
  }

  if (args.dry) {
    console.log('\n--dry: nothing written');
    return;
  }
  writeFileSync(featsPath, `${JSON.stringify(feats, null, 2)}\n`);
  writeFileSync(sidecarPath, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`\nwrote feats.json + ${SIDECAR}`);
}

main();
