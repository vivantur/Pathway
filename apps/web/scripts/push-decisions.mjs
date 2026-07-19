#!/usr/bin/env node
// Seed `effect_decisions` FROM `effect-decisions.json` — the one-time move of the
// existing file-based decisions into the database, and the escape hatch for
// restoring an exported set.
//
// The inverse of `pull-decisions.mjs`. Idempotent: upserts on (entity_id, key), so
// re-running replaces rather than duplicating.
//
// PRESERVES `by` AS A LABEL, NOT A USER. The 57 rows this exists to seed carry
// `by: "migration:foundry-baseline"` — they were never human-reviewed, and the
// grandfather script recorded that on purpose. There is no `users` row to point
// `decided_by` at, so the string lands in `decided_by_label` and a null
// `decided_by` is exactly the signal that no person stands behind it. Decisions
// made in the UI from here on get a real `decided_by` from their session.
//
//   node apps/web/scripts/push-decisions.mjs [--dry]
//
// Env: SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY.

import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const inPath = join(here, '..', 'src', 'features', 'builder', 'data', 'effect-decisions.json');
const dry = process.argv.includes('--dry');

const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}
if (!existsSync(inPath)) {
  console.error(`No decisions file at ${inPath}`);
  process.exit(1);
}

const decisions = JSON.parse(readFileSync(inPath, 'utf8')).decisions ?? [];

const rows = decisions.map((d) => ({
  entity_id: d.entityId,
  key: d.key,
  action: d.action,
  effect: d.effect ?? null,
  choice: d.choice ?? null,
  note: d.note ?? null,
  decided_by: null,
  decided_by_label: d.by ?? null,
}));

const byAction = {};
for (const d of decisions) byAction[d.action] = (byAction[d.action] ?? 0) + 1;

console.log('effect decisions, pushed');
console.log('========================================');
console.log('rows            :', rows.length);
for (const [action, n] of Object.entries(byAction).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${action.padEnd(14)}: ${n}`);
}
const labels = new Set(rows.map((r) => r.decided_by_label ?? '(none)'));
console.log('attribution     :', [...labels].join(', '));

if (dry) {
  console.log('\n--dry: nothing written');
  process.exit(0);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });
const { error } = await supabase
  .from('effect_decisions')
  .upsert(rows, { onConflict: 'entity_id,key' });

if (error) {
  console.error('Upsert failed:', error.message);
  process.exit(1);
}
console.log(`\nupserted ${rows.length} decisions`);
