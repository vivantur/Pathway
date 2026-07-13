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
//   node tools/aon-import-associations.js --apply      # UPDATE spells.associations in Supabase (needs the migration + env)
//
// Prereqs: run tools/aon-fetch.js spell first; apply needs the
// 20260713120000_spells_associations.sql migration and SUPABASE_URL + SUPABASE_SERVICE_KEY.

'use strict';

const fs = require('fs');
const path = require('path');
const { parseAssociations } = require('@pathway/core');

const RAW_FILE = path.join(__dirname, '..', 'gamedata', 'aon-raw', 'spell.json');
const DRYRUN_OUT = path.join(__dirname, '..', 'gamedata', 'spell-associations.dryrun.json');
const APPLY = process.argv.includes('--apply');

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
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    console.error('❌ --apply needs SUPABASE_URL and SUPABASE_SERVICE_KEY in the environment.');
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

async function main() {
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
