// tools/aon-import-associations.js
//
// Recovers spell "granted by" associations (mystery / bloodline / deity / domain /
// lesson / patron) from the raw AoN dump and writes them into the `spells.associations`
// jsonb column — the one field the old aon-transform-spells.js dropped entirely.
//
// This is the FIRST, deliberately narrow spell importer. It touches ONLY the new
// `associations` column, which the bot's combat code (/cast, /i, /monstercast) does
// not read — so it cannot regress combat while the bot's spell interpretation stays
// on its legacy path. The web recovers Spell.associations for free (coerceSpell
// already reads this column). Broader canonical enrichment waits for the bot rewire.
//
// Association shape (what @pathway/core's coerceSpell reads):
//   [{ kind: 'deity', values: ['Sarenrae', ...] }, { kind: 'bloodline', values: [...] }]
//
// USAGE:
//   node tools/aon-import-associations.js              # DRY RUN — report + write a payload file, no DB
//   node tools/aon-import-associations.js --check      # read-only: connect via .env, report project + spells row count
//   node tools/aon-import-associations.js --apply      # UPDATE spells.associations in Supabase (needs the migration + env)
//   node tools/aon-import-associations.js --verify     # read-only: cross-check applied associations vs the AoN source
//
// Prereqs: run tools/aon-fetch.js spell first; apply needs the
// 20260713120000_spells_associations.sql migration and SUPABASE_URL +
// SUPABASE_SERVICE_ROLE_KEY (the name the bot's lib/supabase.js uses).

'use strict';

const fs = require('fs');
const path = require('path');
// Load apps/bot/.env so `--apply` picks up SUPABASE_URL / SUPABASE_SERVICE_KEY
// without the caller having to export them by hand.
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { parseAssociations } = require('@pathway/core');

const RAW_FILE = path.join(__dirname, '..', 'gamedata', 'aon-raw', 'spell.json');
const DRYRUN_OUT = path.join(__dirname, '..', 'gamedata', 'spell-associations.dryrun.json');
const APPLY = process.argv.includes('--apply');
const CHECK = process.argv.includes('--check');
const VERIFY = process.argv.includes('--verify');

/** AoN doc → canonical associations via core (handles singular/plural + ordering). */
function computeAssociations(doc) {
  return parseAssociations({
    mystery: doc.mystery,
    bloodline: doc.bloodline,
    deity: doc.deity,
    domain: doc.domain,
    lesson: doc.lesson,
    patron: doc.patron_theme,
  });
}

/** Merge two association lists, unioning values per kind (dedup, order-stable). */
function mergeAssociations(a, b) {
  const byKind = new Map();
  for (const assoc of [...a, ...b]) {
    const prev = byKind.get(assoc.kind) ?? [];
    for (const v of assoc.values) if (!prev.includes(v)) prev.push(v);
    byKind.set(assoc.kind, prev);
  }
  return [...byKind.entries()].map(([kind, values]) => ({ kind, values }));
}

function buildPayloads(docs) {
  // Legacy + Remaster docs can share a name; union their associations so a single
  // name-keyed update carries the complete set.
  const byName = new Map();
  for (const doc of docs) {
    if (!doc.name) continue;
    const associations = computeAssociations(doc);
    if (!associations.length) continue;
    const key = doc.name.toLowerCase();
    const existing = byName.get(key);
    byName.set(key, {
      name: doc.name,
      associations: existing ? mergeAssociations(existing.associations, associations) : associations,
    });
  }
  return [...byName.values()];
}

async function apply(payloads) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    console.error('❌ --apply needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment.');
    process.exit(1);
  }
  const { createClient } = require('@supabase/supabase-js');
  const sb = createClient(url, key);

  let updated = 0;
  let noMatch = 0;
  let errors = 0;
  for (const p of payloads) {
    // Case-insensitive exact name match (no wildcards). Twins share a name, so
    // this may touch >1 row — both should carry the same associations.
    const { data, error } = await sb
      .from('spells')
      .update({ associations: p.associations })
      .ilike('name', p.name)
      .select('id');
    if (error) {
      errors++;
      console.error(`  ✗ ${p.name}: ${error.message}`);
    } else if (!data || data.length === 0) {
      noMatch++;
    } else {
      updated += data.length;
    }
  }
  console.log(`\n✨ APPLIED — rows updated: ${updated}, names with no matching row: ${noMatch}, errors: ${errors}`);
}

/** Read-only connectivity + shape check. Confirms the .env points at a project
 *  that actually has a populated `spells` table, and whether the migration ran. */
async function check() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    console.error('❌ Credentials not loaded from apps/bot/.env:');
    console.error(`   SUPABASE_URL: ${url ? url : 'MISSING'}`);
    console.error(`   SUPABASE_SERVICE_ROLE_KEY: ${key ? 'set' : 'MISSING'}`);
    process.exit(1);
  }
  const ref = (url.match(/https?:\/\/([a-z0-9]+)\./i) || [])[1] || url;
  console.log(`🔌 Project ref: ${ref}\n   URL: ${url}`);

  const { createClient } = require('@supabase/supabase-js');
  const sb = createClient(url, key);

  // Row count — confirms the table exists and this is the populated project.
  const { count, error: countErr } = await sb.from('spells').select('*', { count: 'exact', head: true });
  if (countErr) {
    console.error(`\n❌ Could not read the spells table: ${countErr.message}`);
    console.error('   → This project may have no `spells` table (wrong project) or the key/RLS blocks it.');
    process.exit(1);
  }
  console.log(`\n✅ spells table found — ${count} rows`);

  // Sample names so you can eyeball that it's the real data.
  const { data: sample } = await sb.from('spells').select('name').order('name').limit(3);
  if (sample && sample.length) console.log(`   sample: ${sample.map((s) => s.name).join(', ')}`);

  // Does the associations column exist yet (has the migration run)?
  const { error: colErr } = await sb.from('spells').select('associations').limit(1);
  if (colErr) {
    console.log(`\n⚠️  associations column NOT present yet — ${colErr.message.split('\n')[0]}`);
    console.log('   → Apply migration 20260713120000_spells_associations.sql, then re-check.');
  } else {
    const { count: withAssoc } = await sb
      .from('spells')
      .select('*', { count: 'exact', head: true })
      .not('associations', 'is', null);
    console.log(`\n✅ associations column present — ${withAssoc ?? 0} rows already populated`);
    console.log(withAssoc ? '   (import has run)' : '   (ready to run --apply)');
  }
}

/** Page through every spells row (Supabase caps a select at 1000). */
async function fetchAllSpellRows(sb, columns) {
  const PAGE = 1000;
  const all = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb.from('spells').select(columns).range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
  }
  return all;
}

/** Cross-check the applied associations against the source + spot-check spells. */
async function verify(payloads) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    console.error('❌ --verify needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (see --check).');
    process.exit(1);
  }
  const { createClient } = require('@supabase/supabase-js');
  const sb = createClient(url, key);

  let rows;
  try {
    rows = await fetchAllSpellRows(sb, 'name, associations');
  } catch (e) {
    console.error(`❌ ${e.message}`);
    if (/associations/.test(e.message)) console.error('   → apply the migration first.');
    process.exit(1);
  }

  const dbNames = new Set(rows.map((r) => (r.name || '').toLowerCase()));
  const populated = rows.filter((r) => r.associations != null).length;
  const missed = payloads.filter((p) => !dbNames.has(p.name.toLowerCase()));

  console.log('\n=== VERIFY ===');
  console.log(`DB spell rows: ${rows.length}`);
  console.log(`rows with associations populated: ${populated}`);
  console.log(`source names with associations (AoN dump): ${payloads.length}`);
  console.log(`  matched to a DB row by name: ${payloads.length - missed.length}`);
  console.log(`  NOT matched (associations couldn't be applied — DB name differs): ${missed.length}`);
  if (missed.length) console.log(`    e.g. ${missed.slice(0, 10).map((p) => p.name).join(', ')}`);
  console.log(
    `\nWhy populated (${populated}) > source names (${payloads.length}): legacy/remaster twins ` +
      `share a name, so one name-keyed update sets both rows.`,
  );

  console.log('\nspot-check (name → kinds):');
  for (const name of ['Fireball', 'Heal', 'Chill Touch', 'Agile Feet', 'Bless']) {
    const hits = rows.filter((r) => (r.name || '').toLowerCase() === name.toLowerCase());
    if (!hits.length) {
      console.log(`  ${name}: (not in DB)`);
      continue;
    }
    for (const h of hits) {
      const a = Array.isArray(h.associations)
        ? h.associations.map((x) => `${x.kind}(${x.values.length})`).join(', ')
        : '(no associations)';
      console.log(`  ${name}: ${a}`);
    }
  }
}

async function main() {
  if (CHECK) {
    await check();
    return;
  }
  if (!fs.existsSync(RAW_FILE)) {
    console.error(`❌ Raw file not found: ${RAW_FILE}\n   Run \`node tools/aon-fetch.js spell\` first.`);
    process.exit(1);
  }
  const docs = JSON.parse(fs.readFileSync(RAW_FILE, 'utf8'));
  const payloads = buildPayloads(docs);

  // Kind-frequency summary.
  const kinds = {};
  for (const p of payloads) for (const a of p.associations) kinds[a.kind] = (kinds[a.kind] || 0) + 1;

  console.log(`🔮 Spell associations from ${docs.length} AoN docs`);
  console.log(`   spells with ≥1 association: ${payloads.length}`);
  console.log(`   by kind: ${Object.entries(kinds).map(([k, c]) => `${k} ${c}`).join(', ')}`);
  console.log('   samples:');
  for (const p of payloads.slice(0, 6)) {
    console.log(`     • ${p.name}: ${p.associations.map((a) => `${a.kind}(${a.values.join(', ')})`).join('; ')}`);
  }

  if (VERIFY) {
    await verify(payloads);
    return;
  }

  if (APPLY) {
    await apply(payloads);
  } else {
    fs.writeFileSync(DRYRUN_OUT, JSON.stringify(payloads, null, 2), 'utf8');
    console.log(`\n🚫 DRY RUN — wrote ${payloads.length} payloads to ${DRYRUN_OUT}`);
    console.log('   Apply the migration, set env, then re-run with --apply to write to Supabase.');
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
