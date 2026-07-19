#!/usr/bin/env node
/**
 * Seed `effect-decisions.json` with the Foundry baseline — the ONE-TIME migration that
 * lets `resolveEntity` become the single path to content without silently reverting
 * effects that already ship.
 *
 * THE PROBLEM THIS SOLVES. Before the fold-in, a feat's `effects` were whatever
 * `mapFoundryRules` produced. After it, they are whatever `resolveEntity` returns:
 * decided accepts plus auto-promotions. Auto-promotion requires CORROBORATION (both
 * producers agreeing), so a Foundry effect the prose parser never proposed is
 * `foundry-only` — complete and perfectly good, but undecided, and it would simply
 * stop shipping. 57 effects are in that position (Beast Trainer's Nature proficiency,
 * Fleet's speed bonus, …). Reverting working content because a second producer stayed
 * quiet is not a review process, it is data loss.
 *
 * WHAT IT DOES, AND WHAT IT REFUSES TO DO. It writes an `accept` for every
 * `foundry-only` candidate that `promote()` says is complete. It writes NOTHING for:
 *
 *   • CONFLICTS. 14 candidates have the parser and Foundry disagreeing outright.
 *     Grandfathering those would silently rule in Foundry's favour on 14 open rules
 *     questions — exactly the coin-flip `promote()` refuses to make. They stay pending
 *     and stop shipping until a human decides, which is the owner's call (2026-07-18).
 *   • parser-only candidates. Those have never shipped; there is no baseline to
 *     preserve, and accepting them here would be inventing content, not migrating it.
 *
 * HONEST PROVENANCE. Every decision it writes carries `by: "migration:foundry-baseline"`
 * and a note saying it was grandfathered, NOT human-reviewed. An `EffectDecision` is
 * documented as "a human said this is what the feat does", and these are not that. The
 * marker is what stops them being mistaken for review later — and it is what lets the
 * Review UI resurface them for real scrutiny.
 *
 * IDEMPOTENT. An existing decision — human or a previous run's — is never overwritten.
 * Re-running only adds decisions for candidates that have none.
 *
 * USAGE: node scripts/grandfather-decisions.mjs [--data <dir>] [--dry]
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promote } from '@pathway/core';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_DIR_DEFAULT = resolve(HERE, '..', 'src', 'features', 'builder', 'data');
const CANDIDATES = 'effect-candidates.json';
const DECISIONS = 'effect-decisions.json';

const MIGRATION_BY = 'migration:foundry-baseline';
const MIGRATION_NOTE =
  'Grandfathered from the pre-fold-in Foundry baseline: this effect already shipped, ' +
  'and dropping it for lack of corroboration would revert working content. NOT reviewed by a human.';

function parseArgs(argv) {
  const out = { data: DATA_DIR_DEFAULT, dry: false };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--data') out.data = resolve(argv[++i]);
    else if (argv[i] === '--dry') out.dry = true;
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv);
  const candidatesPath = join(args.data, CANDIDATES);
  if (!existsSync(candidatesPath)) {
    throw new Error(`no ${CANDIDATES} at ${candidatesPath} — run build-candidates.mjs first`);
  }
  const { candidates } = JSON.parse(readFileSync(candidatesPath, 'utf8'));

  const decisionsPath = join(args.data, DECISIONS);
  const existing = existsSync(decisionsPath)
    ? JSON.parse(readFileSync(decisionsPath, 'utf8')).decisions ?? []
    : [];
  const decided = new Set(existing.map((d) => `${d.entityId} ${d.key}`));

  const added = [];
  const skipped = { alreadyDecided: 0, notFoundryOnly: 0, blocked: 0 };
  const at = new Date().toISOString();

  for (const c of candidates) {
    if (decided.has(`${c.entityId} ${c.key}`)) { skipped.alreadyDecided += 1; continue; }
    if (c.agreement !== 'foundry-only') { skipped.notFoundryOnly += 1; continue; }

    // promote() is the completeness check — there is deliberately no second one.
    const p = promote(c);
    if (!p.ok) { skipped.blocked += 1; continue; }

    added.push({
      entityId: c.entityId,
      key: c.key,
      action: 'accept',
      ...(p.effect ? { effect: p.effect } : {}),
      ...(p.choice ? { choice: p.choice } : {}),
      by: MIGRATION_BY,
      at,
      note: MIGRATION_NOTE,
    });
  }

  const decisions = [...existing, ...added];
  const out = {
    generatedAt: at,
    summary: {
      total: decisions.length,
      grandfathered: decisions.filter((d) => d.by === MIGRATION_BY).length,
      human: decisions.filter((d) => d.by !== MIGRATION_BY).length,
    },
    decisions,
  };

  console.log('grandfather the Foundry baseline');
  console.log('='.repeat(40));
  console.log(`candidates            : ${candidates.length}`);
  console.log(`existing decisions    : ${existing.length}`);
  console.log(`added (foundry-only)  : ${added.length}`);
  console.log(`  skipped, decided    : ${skipped.alreadyDecided}`);
  console.log(`  skipped, not f-only : ${skipped.notFoundryOnly}`);
  console.log(`  skipped, blocked    : ${skipped.blocked}  (conflicts/gaps — a human decides)`);
  console.log(`total decisions       : ${decisions.length}`);

  if (args.dry) {
    console.log('\n--dry: nothing written');
    return;
  }
  writeFileSync(decisionsPath, `${JSON.stringify(out, null, 1)}\n`);
  console.log(`\nwrote ${DECISIONS} (${decisions.length} decisions)`);
}

main();
