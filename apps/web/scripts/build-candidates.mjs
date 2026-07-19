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
 *   • parser  — parseProse(feat.description, …, traitVocabulary). Emits DraftEffect +
 *               gaps + a prose span. The trait vocabulary comes from the corpus (see
 *               traitVocabulary), which is what lets "saves against mental effects"
 *               resolve to a predicate instead of landing as a gap.
 *   • foundry — mapFoundryRules over the sidecar's quarantined `raw`. Human-authored
 *               upstream, high precision. Read from `raw` and NOT from `feat.effects`,
 *               which is now the pipeline's own output — see foundryProposals.
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

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mapFoundryRules, parseProse, reconcile, triage, classifySilence, groupSilence, silenceBlockerTally } from '@pathway/core';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_DIR_DEFAULT = resolve(HERE, '..', 'src', 'features', 'builder', 'data');
const OUT = 'effect-candidates.json';
const SIDECAR = 'effect-ingest-report.json';

function parseArgs(argv) {
  const out = { data: DATA_DIR_DEFAULT, dry: false };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--data') out.data = resolve(argv[++i]);
    else if (argv[i] === '--dry') out.dry = true;
  }
  return out;
}

/**
 * Foundry's proposals for a feat: its rule elements, mapped fresh.
 *
 * DERIVED FROM `raw`, NOT FROM `feat.effects` — and that distinction is load-bearing
 * now that the fold-in writes RESOLVED effects back into feats.json. Reading
 * `feat.effects` would make this producer echo the pipeline's own output: a human's
 * accepted edit would come back next run as "Foundry proposed this", corroborating
 * itself and auto-promoting on a second producer that never existed. The sidecar's
 * quarantined `raw` is the only honest source for what Foundry actually said.
 *
 * Falls back to `feat.effects` only when the sidecar has no entry for the feat — the
 * pre-sidecar path, where the mapped effects ARE still Foundry's unmodified output.
 *
 * ALL kinds are included, not just the parser's families: the Review UI verifies every
 * auto-mapped effect, so a foundry-only `grant` or `choice` is a legitimate review item.
 * A choice becomes a `kind: "choice"` draft — the second content type reconcile handles.
 */
function foundryProposals(feat, rawById) {
  const raw = rawById.get(feat.id);
  const { effects, choices, report } = raw
    ? mapFoundryRules(raw)
    : { effects: feat.effects ?? [], choices: feat.choices ?? [], report: [] };

  const proposals = effects.map((draft) => ({ draft }));
  for (const choice of choices) proposals.push({ draft: { kind: 'choice', choice } });
  // The blockers come from THIS run's re-mapping, never from the ingest report's
  // stored outcomes — those are a previous run's output, and reading a producer's
  // result out of the pipeline's own output is the feedback loop the fold-in slice
  // had to unpick. Re-mapping means the blocker tally improves the moment the
  // mapper does.
  const unsupportedReasons = (report ?? [])
    .filter((r) => r.outcome === 'unsupported' && r.reason)
    .map((r) => r.reason);
  return { source: 'foundry', proposals, unsupportedReasons };
}

/**
 * The trait vocabulary the parser resolves scopes against, read from the corpus we
 * already ship rather than hardcoded in core — traits are game content, and content
 * supplied from the data can never drift out of date the way a constant would.
 *
 * TWO SETS, because they carry different risk:
 *   • effectTraits (wide, spells + feats) is used only where the prose says
 *     "effects"/"spells", which has already ruled out a creature reading.
 *   • spellTraits (narrow) is used for a bare "against X", where nothing
 *     disambiguates. Traits that appear on SPELLS admit "against poisons" and
 *     exclude "against dragons" / "against humans" — creature types that would
 *     otherwise become a bonus that can never fire.
 */
function traitVocabulary(dataDir) {
  const read = (file) => {
    const path = join(dataDir, file);
    return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : [];
  };
  const spellTraits = new Set();
  for (const s of read('spells.json')) for (const t of s.traits ?? []) spellTraits.add(String(t).toLowerCase());

  const effectTraits = new Set(spellTraits);
  for (const f of read('feats.json')) for (const t of f.traits ?? []) effectTraits.add(String(t).toLowerCase());

  return { effectTraits, spellTraits };
}

function main() {
  const args = parseArgs(process.argv);
  const feats = JSON.parse(readFileSync(join(args.data, 'feats.json'), 'utf8'));
  const traits = traitVocabulary(args.data);

  // Foundry's untouched rule elements, keyed by feat id. See foundryProposals.
  const sidecarPath = join(args.data, SIDECAR);
  const rawById = new Map();
  if (existsSync(sidecarPath)) {
    const sidecar = JSON.parse(readFileSync(sidecarPath, 'utf8'));
    for (const e of sidecar.entities ?? []) {
      if ((e.kind ?? 'feat') === 'feat' && Array.isArray(e.raw) && e.raw.length) rawById.set(e.id, e.raw);
    }
  }

  const candidates = [];
  let featsWithProse = 0;
  // What `classifySilence` needs per feat, gathered in the SAME pass that proposes —
  // so the silence view can never disagree with the queue about which feats proposed.
  const silenceInputs = [];
  for (const feat of feats) {
    if (!feat.description) continue;
    featsWithProse += 1;
    const parser = parseProse(feat.description, undefined, traits);
    const foundry = foundryProposals(feat, rawById);
    silenceInputs.push({
      entityId: feat.id,
      actionCost: feat.actionCost ?? null,
      unsupportedReasons: foundry.unsupportedReasons,
    });
    // Nothing to reconcile if neither producer proposed anything for this feat.
    if (parser.proposals.length === 0 && foundry.proposals.length === 0) continue;
    candidates.push(...reconcile(feat.id, [parser, foundry]));
  }

  const t = triage(candidates);
  // The other 3/4 of the corpus: feats that proposed nothing at all. Without this the
  // review page reports ~18% of the work as though it were all of it.
  const silence = classifySilence(silenceInputs, candidates);
  const blockers = silenceBlockerTally(silence.silent);
  const summary = {
    feats: feats.length,
    featsWithProse,
    candidates: candidates.length,
    autoPromote: t.autoPromote.length,
    conflicts: t.conflicts.length,
    gapped: t.gapped.length,
    review: t.review.length,
    invalid: t.invalid.length,
    silent: silence.silent.length,
    actionFeatsInQueue: silence.actionFeatsInQueue.length,
  };

  const out = {
    generatedAt: new Date().toISOString(),
    summary,
    candidates,
    silent: silence.silent,
    actionFeatsInQueue: silence.actionFeatsInQueue,
    silenceBlockers: blockers,
  };

  console.log('effect-review candidates');
  console.log('='.repeat(40));
  console.log(`feats            : ${summary.feats} (${summary.featsWithProse} with prose)`);
  console.log(`trait vocabulary : ${traits.effectTraits.size} effect / ${traits.spellTraits.size} spell (from the corpus)`);
  console.log(`candidates       : ${summary.candidates}`);
  console.log(`  auto-promote   : ${summary.autoPromote}  (corroborated + complete; no human)`);
  console.log(`  conflicts      : ${summary.conflicts}  (producers disagree; review first)`);
  console.log(`  gapped         : ${summary.gapped}  (a hole a human fills)`);
  console.log(`  review         : ${summary.review}  (one producer, complete)`);
  console.log(`  invalid        : ${summary.invalid}  (producer bug — schema-invalid)`);
  console.log(`
silent feats     : ${summary.silent}  (proposed NOTHING — never reach review)`);
  for (const g of groupSilence(silence.silent)) console.log(`  ${g.reason.padEnd(19)}: ${g.entities.length}`);
  console.log(`
blockers across the silent (elements, not feats):`);
  for (const b of blockers) console.log(`  ${b.reason.padEnd(22)}: ${b.count}`);
  console.log(`
action feats IN the queue: ${summary.actionFeatsInQueue}  (likely modelled as passives — needs a human)`);

  if (args.dry) {
    console.log('\n--dry: nothing written');
    return;
  }
  const path = join(args.data, OUT);
  writeFileSync(path, `${JSON.stringify(out, null, 1)}\n`);
  console.log(`\nwrote ${OUT} (${summary.candidates} candidates)`);
}

main();
