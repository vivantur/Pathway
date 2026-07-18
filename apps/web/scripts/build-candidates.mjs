#!/usr/bin/env node
/**
 * Build the effect-review queue — reconcile every producer's proposals into the
 * candidate list the admin Review UI renders. The web analogue of `prose-recall.mjs`:
 * that script MEASURES the two producers against each other; this one FREEZES the
 * reconciled result into a sidecar a browser page can load.
 *
 * THE SPINE (docs/effects-engine-design.md, "candidate/review model"): candidates are
 * NOT content. `producers → candidates (a work queue) → promote → effects`. This script
 * only produces the queue; a human's decisions (accept/reject) are the Review UI's
 * output, folded into content by a LATER slice — never here.
 *
 * PRODUCERS (both from @pathway/core, run in the browser too — pure, no I/O):
 *   • parser  — parseProse(feat.description). Emits DraftEffect + gaps + a prose span.
 *   • foundry — the feat's already-mapped `effects`. Human-authored, high precision.
 * `reconcile` buckets them by effect identity: two producers agreeing is corroboration,
 * two producers disagreeing is a conflict (the most informative thing in the queue).
 *
 * OUTPUT — `effect-candidates.json`, an ADMIN-ONLY sidecar (like the ingest report):
 *   • the flat EffectCandidate[] — the page runs triage()/groupBySignature() over it,
 *     so the bucketing policy stays in core, not duplicated in the UI.
 *   • a summary of the triage counts, for a headline the page can show before the
 *     (larger) candidate list finishes parsing.
 * It carries NO feat descriptions: the page reads those from feats.json, which the app
 * already bundles for the builder — duplicating them here would just bloat the sidecar.
 *
 * USAGE: node scripts/build-candidates.mjs [--data <dir>] [--dry]
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseProse, reconcile, triage } from '@pathway/core';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_DIR_DEFAULT = resolve(HERE, '..', 'src', 'features', 'builder', 'data');
const OUT = 'effect-candidates.json';

function parseArgs(argv) {
  const out = { data: DATA_DIR_DEFAULT, dry: false };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--data') out.data = resolve(argv[++i]);
    else if (argv[i] === '--dry') out.dry = true;
  }
  return out;
}

/**
 * A feat's already-mapped effects AND choices → foundry proposals (the ground truth half).
 * ALL kinds are included, not just the parser's families: the Review UI verifies every
 * auto-mapped effect, so a foundry-only `grant` or `choice` is a legitimate review item.
 * A choice becomes a `kind: "choice"` draft — the second content type reconcile handles.
 */
function foundryProposals(feat) {
  const proposals = (feat.effects ?? []).map((draft) => ({ draft }));
  for (const choice of feat.choices ?? []) proposals.push({ draft: { kind: 'choice', choice } });
  return { source: 'foundry', proposals };
}

function main() {
  const args = parseArgs(process.argv);
  const feats = JSON.parse(readFileSync(join(args.data, 'feats.json'), 'utf8'));

  const candidates = [];
  let featsWithProse = 0;
  for (const feat of feats) {
    if (!feat.description) continue;
    featsWithProse += 1;
    const parser = parseProse(feat.description);
    const foundry = foundryProposals(feat);
    // Nothing to reconcile if neither producer proposed anything for this feat.
    if (parser.proposals.length === 0 && foundry.proposals.length === 0) continue;
    candidates.push(...reconcile(feat.id, [parser, foundry]));
  }

  const t = triage(candidates);
  const summary = {
    feats: feats.length,
    featsWithProse,
    candidates: candidates.length,
    autoPromote: t.autoPromote.length,
    conflicts: t.conflicts.length,
    gapped: t.gapped.length,
    review: t.review.length,
    invalid: t.invalid.length,
  };

  const out = { generatedAt: new Date().toISOString(), summary, candidates };

  console.log('effect-review candidates');
  console.log('='.repeat(40));
  console.log(`feats            : ${summary.feats} (${summary.featsWithProse} with prose)`);
  console.log(`candidates       : ${summary.candidates}`);
  console.log(`  auto-promote   : ${summary.autoPromote}  (corroborated + complete; no human)`);
  console.log(`  conflicts      : ${summary.conflicts}  (producers disagree; review first)`);
  console.log(`  gapped         : ${summary.gapped}  (a hole a human fills)`);
  console.log(`  review         : ${summary.review}  (one producer, complete)`);
  console.log(`  invalid        : ${summary.invalid}  (producer bug — schema-invalid)`);

  if (args.dry) {
    console.log('\n--dry: nothing written');
    return;
  }
  const path = join(args.data, OUT);
  writeFileSync(path, `${JSON.stringify(out, null, 1)}\n`);
  console.log(`\nwrote ${OUT} (${summary.candidates} candidates)`);
}

main();
