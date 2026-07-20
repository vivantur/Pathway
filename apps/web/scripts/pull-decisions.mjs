#!/usr/bin/env node
// Materialize the review queue's decisions from Supabase into
// `effect-decisions.json` — the file `remap-effects.mjs` folds into content.
//
// WHY A PULL STEP RATHER THAN READING THE DB AT BUILD TIME. The committed JSON is
// what keeps the Vercel build hermetic: no network, no credentials, and a deploy
// that is reproducible from the commit alone. The web deploy already depends on an
// unversioned Vercel setting (see CLAUDE.md); adding a second way for it to fail,
// with service credentials in the mix, is not a trade worth making. So the database
// holds the human's WORKING state, and baking content is an explicit act that
// records its input in git alongside its output.
//
// Reads with the SERVICE ROLE key, because `effect_decisions` is admin-only by RLS
// and a script has no session. That key must never reach the browser bundle.
//
//   node apps/web/scripts/pull-decisions.mjs [--dry]
//
// Credentials are resolved by supabase-env.mjs, which reads the repo's .env files —
// node does not load them the way Vite does for the browser.

import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireServiceCredentials } from './supabase-env.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, '..', 'src', 'features', 'builder', 'data');
const outPath = join(dataDir, 'effect-decisions.json');
const dry = process.argv.includes('--dry');

/**
 * NEVER call process.exit() past this point. supabase-js keeps a connection pool
 * alive, and on Windows exiting while those handles are mid-close trips a libuv
 * assertion: the script printed its results correctly and then exited 127, which
 * would break any `&&` chain or CI step that trusts the status. Falling off the end
 * exits 0 cleanly and does not hang — so this returns and sets `process.exitCode`.
 */
async function main() {
  const { url, key } = requireServiceCredentials();
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const { data, error } = await supabase
    .from('effect_decisions')
    .select('entity_id, key, action, effect, choice, granted_action, note, decided_by_label, updated_at')
    .order('entity_id');

  if (error) {
    console.error('Query failed:', error.message);
    process.exitCode = 1;
    return;
  }

  // Back to core's `EffectDecision` shape — the same one the file already holds, so
  // `remap-effects.mjs` needs no change at all.
  const decisions = (data ?? []).map((r) => ({
    entityId: r.entity_id,
    key: r.key,
    action: r.action,
    ...(r.effect ? { effect: r.effect } : {}),
    ...(r.choice ? { choice: r.choice } : {}),
    ...(r.granted_action ? { grantedAction: r.granted_action } : {}),
    ...(r.note ? { note: r.note } : {}),
    ...(r.decided_by_label ? { by: r.decided_by_label } : {}),
    ...(r.updated_at ? { at: r.updated_at } : {}),
  }));

  const byAction = {};
  for (const d of decisions) byAction[d.action] = (byAction[d.action] ?? 0) + 1;
  const withActions = decisions.filter((d) => d.grantedAction).length;

  console.log('effect decisions, pulled');
  console.log('========================================');
  console.log('rows            :', decisions.length);
  for (const [action, n] of Object.entries(byAction).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${action.padEnd(14)}: ${n}`);
  }
  // Counted separately because a granted action is a payload, not an action kind —
  // every one of these is also an `add` above. Reported so a run that silently
  // stopped carrying activities is visible here rather than at the bake.
  console.log('granted actions :', withActions);

  // A pull that would WIPE a non-empty file is almost certainly pointing at the wrong
  // project or an unmigrated one. Refuse rather than silently discard every recorded
  // decision — the one irreversible thing this script could do.
  if (decisions.length === 0 && existsSync(outPath)) {
    const existing = JSON.parse(readFileSync(outPath, 'utf8')).decisions ?? [];
    if (existing.length > 0) {
      console.error(`\nRefusing to overwrite ${existing.length} decisions with 0 rows.`);
      console.error('Check SUPABASE_URL and that the migration has been applied.');
      process.exitCode = 1;
      return;
    }
  }

  if (dry) {
    console.log('\n--dry: nothing written');
    return;
  }

  writeFileSync(outPath, `${JSON.stringify({ decisions }, null, 2)}\n`);
  console.log(`\nwrote effect-decisions.json (${decisions.length} decisions)`);
}

await main();
