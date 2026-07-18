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

// The effect families the parser targets so far. Each is measured separately: the parser
// grows one family per slice, and a blended number would hide a per-family regression.
const MEASURED_KINDS = ['proficiency', 'modifier', 'grant'];

/**
 * Foundry's DIRECT effects for a feat → producer proposals (the ground truth), for the
 * measured kinds only.
 *
 * Choice-driven grants (`feat.choices` — Skill Training's "a skill of your choice", 16
 * options) are deliberately EXCLUDED: a different shape, and folding their 16-options-each
 * into the denominator would drown the recall number. Reported separately as context.
 */
function foundryProposals(feat) {
  const proposals = [];
  for (const e of feat.effects ?? []) {
    if (MEASURED_KINDS.includes(e.kind)) proposals.push({ draft: e });
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

  // Tallies per measured kind, plus a gap tally (the parser's partial extractions).
  const tally = Object.fromEntries(
    MEASURED_KINDS.map((k) => [k, { corroborated: 0, parserOnly: 0, foundryOnly: 0, gappedParserOnly: 0 }]),
  );
  const conflicts = [];
  let choiceGrants = 0;

  for (const feat of feats) {
    if (!feat.description) continue;
    choiceGrants += choiceGrantCount(feat);
    const parser = parseProse(feat.description);
    const foundry = foundryProposals(feat);

    for (const c of reconcile(feat.id, [parser, foundry])) {
      const t = tally[c.draft.kind];
      if (!t) continue;
      switch (c.agreement) {
        case 'corroborated':
          t.corroborated += 1;
          break;
        case 'parser-only':
          t.parserOnly += 1;
          if (c.gaps.length) t.gappedParserOnly += 1;
          break;
        case 'foundry-only':
          t.foundryOnly += 1;
          break;
        case 'conflicting':
          conflicts.push({ id: feat.id, name: feat.name, kind: c.draft.kind, draft: c.draft, alternatives: c.alternatives });
          break;
      }
    }
  }

  console.log('prose parser vs Foundry — a labeled test set');
  console.log('═'.repeat(58));
  for (const kind of MEASURED_KINDS) {
    const t = tally[kind];
    const kindConflicts = conflicts.filter((c) => c.kind === kind).length;
    const foundryTotal = t.corroborated + t.foundryOnly + kindConflicts;
    const recall = foundryTotal ? ((t.corroborated / foundryTotal) * 100).toFixed(1) : 'n/a';
    console.log(`\n${kind.toUpperCase()}`);
    console.log(`  corroborated (agree)  : ${t.corroborated}`);
    console.log(`  parser-only           : ${t.parserOnly}   (of which gapped: ${t.gappedParserOnly})`);
    console.log(`  foundry-only (missed) : ${t.foundryOnly}`);
    console.log(`  conflicts             : ${kindConflicts}`);
    console.log(`  RECALL vs Foundry     : ${recall}%   (corroborated / Foundry's direct grants)`);
  }
  console.log(
    `\n(context: ${choiceGrants} choice-driven proficiency grants excluded — "a skill of\n your choice", a different shape the parser does not target here.)`,
  );

  if (args.conflicts && conflicts.length) {
    console.log(`\nconflicts (first ${Math.min(args.limit, conflicts.length)}):`);
    for (const c of conflicts.slice(0, args.limit)) {
      console.log(`  [${c.kind}] ${c.name} (${c.id})`);
      console.log(`    parser  : ${JSON.stringify(c.draft)}`);
      console.log(`    foundry : ${JSON.stringify(c.alternatives ?? [])}`);
    }
  }
}

main();
