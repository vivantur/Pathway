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
// and a script has no session. That key must never reach the browser bundle — it is
// read from the environment here and nowhere else.
//
//   node apps/web/scripts/pull-decisions.mjs [--dry]
//
// Env: SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY.

import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, '..', 'src', 'features', 'builder', 'data');
const outPath = join(dataDir, 'effect-decisions.json');
const dry = process.argv.includes('--dry');

const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.');
  console.error('The service role key is required: effect_decisions is admin-only by RLS.');
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });

const { data, error } = await supabase
  .from('effect_decisions')
  .select('entity_id, key, action, effect, choice, note, decided_by_label, updated_at')
  .order('entity_id');

if (error) {
  console.error('Query failed:', error.message);
  process.exit(1);
}

// Back to core's `EffectDecision` shape — the same one the file already holds, so
// `remap-effects.mjs` needs no change at all.
const decisions = (data ?? []).map((r) => ({
  entityId: r.entity_id,
  key: r.key,
  action: r.action,
  ...(r.effect ? { effect: r.effect } : {}),
  ...(r.choice ? { choice: r.choice } : {}),
  ...(r.note ? { note: r.note } : {}),
  ...(r.decided_by_label ? { by: r.decided_by_label } : {}),
  ...(r.updated_at ? { at: r.updated_at } : {}),
}));

const byAction = {};
for (const d of decisions) byAction[d.action] = (byAction[d.action] ?? 0) + 1;

console.log('effect decisions, pulled');
console.log('========================================');
console.log('rows            :', decisions.length);
for (const [action, n] of Object.entries(byAction).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${action.padEnd(14)}: ${n}`);
}

// A pull that would WIPE a non-empty file is almost certainly pointing at the wrong
// project or an unmigrated one. Refuse rather than silently discard every recorded
// decision — the one irreversible thing this script could do.
if (decisions.length === 0 && existsSync(outPath)) {
  const existing = JSON.parse(readFileSync(outPath, 'utf8')).decisions ?? [];
  if (existing.length > 0) {
    console.error(`\nRefusing to overwrite ${existing.length} decisions with 0 rows.`);
    console.error('Check SUPABASE_URL and that the migration has been applied.');
    process.exit(1);
  }
}

if (dry) {
  console.log('\n--dry: nothing written');
  process.exit(0);
}

writeFileSync(outPath, `${JSON.stringify({ decisions }, null, 2)}\n`);
console.log(`\nwrote effect-decisions.json (${decisions.length} decisions)`);
