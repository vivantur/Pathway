#!/usr/bin/env node
/**
 * Measure the prose parser against Foundry's rule elements as a LABELED TEST SET.
 *
 * WHY THIS EXISTS (docs/effects-engine-design.md, the prose pivot): the parser and the
 * Foundry mapper are two INDEPENDENT producers of the same effects. Foundry's elements
 * are human-authored — high precision, low recall — so where they overlap the parser's
 * output, they are a free ground truth. This script runs both producers over the whole
 * corpus, reconciles them into candidates (the real candidate.ts path), and reports:
 *
 *   • recall     — of the effects Foundry encodes, how many the parser also found.
 *   • parser-only — effects the parser found that Foundry did NOT (its whole point: prose
 *                   contains more; but also where false positives hide).
 *   • conflicts  — where the two producers DISAGREE. One is wrong; this is the most
 *                   informative output, and the regression cases (Lepidstadt) live here.
 *
 * It is the parser's analogue of remap-effects.mjs: rerun it after any parser change and
 * the recall number moves, so a regression is visible instead of silent. It writes
 * nothing — it is a measurement, not an ingest step.
 *
 * SCOPE: slice 1 is proficiency grants only, so the report filters to `kind:proficiency`.
 * Widen the filter as extractor families land.
 *
 * USAGE: node scripts/prose-recall.mjs [--conflicts] [--limit N]
 */

import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseProse, reconcile } from '@pathway/core';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA = resolve(HERE, '..', 'src', 'features', 'builder', 'data');

function parseArgs(argv) {
  const out = { conflicts: false, limit: 20 };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--conflicts') out.conflicts = true;
    else if (argv[i] === '--limit') out.limit = Number(argv[++i]);
  }
  return out;
}

/**
 * Foundry's DIRECT proficiency grants for a feat → producer proposals (the ground truth).
 *
 * Choice-driven grants (`feat.choices` — Skill Training's "a skill of your choice", 16
 * options) are deliberately EXCLUDED: they are a different shape slice 1 does not target,
 * and folding their 16-options-each into the denominator would drown the recall number in
 * effects the parser was never meant to find. They are reported separately as context.
 */
function foundryProposals(feat) {
  const proposals = [];
  for (const e of feat.effects ?? []) {
    if (e.kind === 'proficiency') proposals.push({ draft: e });
  }
  return { source: 'foundry', proposals };
}

/** How many choice-driven proficiency grants a feat carries (context, not ground truth). */
function choiceGrantCount(feat) {
  let n = 0;
  for (const choice of feat.choices ?? []) {
    for (const opt of choice.options ?? []) {
      for (const e of opt.effects ?? []) if (e.kind === 'proficiency') n += 1;
    }
  }
  return n;
}

function main() {
  const args = parseArgs(process.argv);
  const feats = JSON.parse(readFileSync(join(DATA, 'feats.json'), 'utf8'));

  let corroborated = 0;
  let parserOnly = 0;
  let foundryOnly = 0;
  const conflicts = [];

  let featsWithProse = 0;
  let choiceGrants = 0;
  for (const feat of feats) {
    if (!feat.description) continue;
    choiceGrants += choiceGrantCount(feat);
    const parser = parseProse(feat.description);
    const foundry = foundryProposals(feat);
    // Only measure feats where AT LEAST ONE producer proposed a proficiency effect.
    const anyProf =
      parser.proposals.some((p) => p.draft.kind === 'proficiency') || foundry.proposals.length > 0;
    if (!anyProf) continue;
    featsWithProse += 1;

    for (const c of reconcile(feat.id, [parser, foundry])) {
      if (c.draft.kind !== 'proficiency') continue;
      switch (c.agreement) {
        case 'corroborated':
          corroborated += 1;
          break;
        case 'parser-only':
          parserOnly += 1;
          break;
        case 'foundry-only':
          foundryOnly += 1;
          break;
        case 'conflicting':
          conflicts.push({ id: feat.id, name: feat.name, draft: c.draft, alternatives: c.alternatives });
          break;
      }
    }
  }

  const foundryTotal = corroborated + foundryOnly + conflicts.length;
  const recall = foundryTotal ? ((corroborated / foundryTotal) * 100).toFixed(1) : 'n/a';

  console.log('prose parser vs Foundry (proficiency grants)');
  console.log('─'.repeat(52));
  console.log(`feats measured        : ${featsWithProse}`);
  console.log(`corroborated (agree)  : ${corroborated}`);
  console.log(`parser-only           : ${parserOnly}   (prose caught what Foundry didn't — or a false positive)`);
  console.log(`foundry-only (missed) : ${foundryOnly}`);
  console.log(`conflicts             : ${conflicts.length}   (one producer is wrong — the review queue's top priority)`);
  console.log(`\nRECALL vs Foundry     : ${recall}%  (corroborated / Foundry's DIRECT grants)`);
  console.log(
    `\n(context: ${choiceGrants} choice-driven grants excluded — "a skill of your choice",\n a different shape slice 1 does not target.)`,
  );

  if (args.conflicts && conflicts.length) {
    console.log(`\nconflicts (first ${Math.min(args.limit, conflicts.length)}):`);
    for (const c of conflicts.slice(0, args.limit)) {
      console.log(`  ${c.name} (${c.id})`);
      console.log(`    parser  : ${JSON.stringify(c.draft)}`);
      console.log(`    foundry : ${JSON.stringify(c.alternatives ?? [])}`);
    }
  }
}

main();
