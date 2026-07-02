'use strict';

// ─── dedupe-content.js ───────────────────────────────────────────────────────
// READ-ONLY by default. Reports duplicate + legacy (pre-Remaster) PF2e content
// in Supabase, and — only when explicitly confirmed — deletes duplicate SPELL
// rows (keeping the best row per identity group).
//
// Safety tiers:
//   node supabase/dedupe-content.js                 → dry-run report (no writes)
//   node supabase/dedupe-content.js --apply         → prints the exact deletion
//                                                     plan, still writes nothing
//   node supabase/dedupe-content.js --apply --yes   → actually deletes duplicates
//
// Options:
//   --table=spells | --table=monsters   limit to one table (default: both)
//
// Requires env (loaded from .env via dotenv): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
// ⚠️ ALWAYS point at your DEVELOP project first and back up. See DEDUPE_RUNBOOK.md.

// Load apps/bot/.env regardless of the directory you run this from.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { getSupabase } = require('../src/lib/supabase');

const APPLY = process.argv.includes('--apply');
const CONFIRM = process.argv.includes('--yes');
const TABLE = (process.argv.find(a => a.startsWith('--table=')) || '').split('=')[1] || 'all';

const LEGACY_DAMAGE = ['positive', 'negative', 'good', 'evil', 'lawful', 'chaotic'];

async function fetchAll(sb, table, columns) {
  const PAGE = 1000;
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb.from(table).select(columns).range(from, from + PAGE - 1);
    if (error) throw error;
    if (data?.length) rows.push(...data);
    if (!data?.length || data.length < PAGE) break;
  }
  return rows;
}

// Same identity the importer uses, collapsed to ONE canonical key for grouping:
// aon_id (strongest) › name+source › name.
function spellDedupKey(row) {
  const meta = row.spell_metadata || {};
  if (meta.aon_id) return `aon:${meta.aon_id}`;
  const name = String(row.name || meta.name || '').toLowerCase().trim();
  const source = String(row.source || meta.source || '').toLowerCase().trim();
  return source ? `ns:${name}|${source}` : `n:${name}`;
}

// Which row to KEEP in a duplicate group: prefer an aon_id, then the newest
// import, then the lowest id (stable / oldest — safest for anything that
// references it).
function pickKeep(rows) {
  return [...rows].sort((a, b) => {
    const am = a.spell_metadata || {}, bm = b.spell_metadata || {};
    if (!!bm.aon_id !== !!am.aon_id) return bm.aon_id ? 1 : -1;
    const at = am._aon_imported_at || '', bt = bm._aon_imported_at || '';
    if (at !== bt) return at > bt ? -1 : 1;
    return (a.id || 0) - (b.id || 0);
  })[0];
}

async function auditSpells(sb) {
  console.log('\n=== SPELLS ===');
  const rows = await fetchAll(sb, 'spells', 'id, name, slug, source, spell_metadata');
  console.log(`Total spell rows: ${rows.length}`);

  // Exact-identity duplicate groups (safe to auto-merge).
  const groups = new Map();
  for (const r of rows) {
    const k = spellDedupKey(r);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  const dupGroups = [...groups.values()].filter(rs => rs.length > 1);
  const removable = dupGroups.reduce((n, rs) => n + rs.length - 1, 0);
  console.log(`Exact-identity duplicate groups: ${dupGroups.length}  (rows removable: ${removable})`);
  for (const rs of dupGroups.slice(0, 40)) {
    console.log(`  DUP x${rs.length}: ids [${rs.map(r => r.id).join(', ')}] — "${rs[0].name}" (${spellDedupKey(rs[0])})`);
  }
  if (dupGroups.length > 40) console.log(`  ...and ${dupGroups.length - 40} more groups`);

  // Same NAME across different identities = possible legacy+remaster pair. NEVER
  // auto-deleted — these need a human to decide which version to keep.
  const byName = new Map();
  for (const r of rows) {
    const n = String(r.name || '').toLowerCase().trim();
    if (!byName.has(n)) byName.set(n, new Set());
    byName.get(n).add(spellDedupKey(r));
  }
  const nameCollisions = [...byName.entries()].filter(([, keys]) => keys.size > 1);
  console.log(`Same-name / different-identity (possible legacy+remaster — MANUAL review): ${nameCollisions.length}`);
  for (const [n, keys] of nameCollisions.slice(0, 20)) console.log(`  NAME "${n}": ${[...keys].join('  |  ')}`);

  // Legacy (pre-Remaster) fields — read-only report; cleanup is separate SQL.
  const withSchool = rows.filter(r => r.spell_metadata && r.spell_metadata.school);
  const legacyDamage = rows.filter(r => {
    const t = String(r.spell_metadata?.damage?.type || r.spell_metadata?.damageType || '').toLowerCase();
    return LEGACY_DAMAGE.includes(t);
  });
  console.log(`Legacy 'school' field present on: ${withSchool.length} spells`);
  console.log(`Legacy damage type (positive/negative/alignment) on: ${legacyDamage.length} spells`);

  if (!APPLY) {
    console.log("\n(DRY RUN — nothing written. Re-run with '--apply' to preview the deletion plan.)");
    return;
  }

  const toDelete = [];
  for (const rs of dupGroups) {
    const keep = pickKeep(rs);
    for (const r of rs) if (r.id !== keep.id) toDelete.push(r.id);
  }
  console.log(`\n--apply: plan is to DELETE ${toDelete.length} duplicate spell rows (keeping the best row in each group).`);
  console.log(`  ids to delete: [${toDelete.slice(0, 100).join(', ')}${toDelete.length > 100 ? ', …' : ''}]`);
  if (!CONFIRM) {
    console.log("\n(No deletion performed. Add '--yes' to execute — AFTER you have a backup and are on DEVELOP.)");
    return;
  }
  const CH = 100;
  for (let i = 0; i < toDelete.length; i += CH) {
    const ids = toDelete.slice(i, i + CH);
    const { error } = await sb.from('spells').delete().in('id', ids);
    if (error) throw error;
    console.log(`  deleted ${Math.min(i + ids.length, toDelete.length)}/${toDelete.length}`);
  }
  console.log('Duplicate spells removed. (Legacy school/damage-type cleanup is separate — see DEDUPE_RUNBOOK.md.)');
}

async function auditMonsters(sb) {
  console.log('\n=== MONSTERS ===');
  const rows = await fetchAll(sb, 'monsters', 'id, name, is_official, is_companion, discord_guild_id');
  const official = rows.filter(r => r.is_official && !r.is_companion);
  console.log(`Total monster rows: ${rows.length}  (official non-companion: ${official.length})`);

  // Official rows carrying a discord_guild_id ESCAPE the importer's delete filter
  // (.is('discord_guild_id', null)), so a refresh won't replace them → dupes.
  const escaping = official.filter(r => r.discord_guild_id != null);
  console.log(`Official rows with discord_guild_id set (escape the refresh delete — potential dupes): ${escaping.length}`);
  for (const r of escaping.slice(0, 20)) console.log(`  id ${r.id} "${r.name}" guild=${r.discord_guild_id}`);

  const byName = new Map();
  for (const r of official) {
    const n = String(r.name || '').toLowerCase().trim();
    byName.set(n, (byName.get(n) || 0) + 1);
  }
  const dupNames = [...byName.entries()].filter(([, c]) => c > 1);
  console.log(`Official monster name duplicates: ${dupNames.length}`);
  for (const [n, c] of dupNames.slice(0, 20)) console.log(`  "${n}" x${c}`);
  console.log("Monsters are best deduped by re-running 'import-aon-bestiary.js --replace-official' after a backup — not manual deletes.");
}

(async () => {
  const sb = getSupabase();
  if (!sb) {
    console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in env (.env). Aborting.');
    process.exit(1);
  }
  console.log(APPLY
    ? (CONFIRM ? '*** APPLY + CONFIRM — this WILL delete duplicate spell rows ***' : '*** APPLY (preview) — no --yes, so nothing will be deleted ***')
    : 'DRY-RUN — read-only report, no changes.');
  if (TABLE === 'all' || TABLE === 'spells') await auditSpells(sb);
  if (TABLE === 'all' || TABLE === 'monsters') await auditMonsters(sb);
  console.log('\nDone.');
})().catch(err => {
  console.error(err.message || err);
  process.exit(1);
});
