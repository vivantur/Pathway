'use strict';

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { getSupabase } = require('../src/lib/supabase');

const rawArg = process.argv.slice(2).find(arg => !arg.startsWith('--'));
const SPELLS_FILE = rawArg
  ? path.resolve(rawArg)
  : path.join(__dirname, '..', 'gamedata', 'spells.json');

const dryRun = process.argv.includes('--dry-run');
const replaceOfficial = process.argv.includes('--replace-official') || process.argv.includes('--apply');

function spellSlug(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function toSpellRow(spell) {
  const metadata = {
    ...spell,
    custom: false,
    _aon_imported: true,
    _aon_imported_at: spell._aon_imported_at || new Date().toISOString(),
  };

  return {
    name: String(spell.name || ''),
    slug: spellSlug(spell.name),
    level: Number.isInteger(spell.level) ? spell.level : parseInt(spell.level, 10) || 0,
    source: spell.source || null,
    is_official: true,
    spell_metadata: metadata,
  };
}

function spellIdentity(spell) {
  return [
    spell?.aon_id ? `aon:${spell.aon_id}` : null,
    spell?.name && spell?.source ? `name-source:${String(spell.name).toLowerCase()}|${String(spell.source).toLowerCase()}` : null,
    spell?.name ? `name:${String(spell.name).toLowerCase()}` : null,
  ].filter(Boolean);
}

async function fetchExistingSpells(sb) {
  const PAGE = 1000;
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from('spells')
      .select('id, name, source, spell_metadata')
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (data?.length) rows.push(...data);
    if (!data?.length || data.length < PAGE) break;
  }
  return rows;
}

function buildExistingIndex(existingRows) {
  const byIdentity = new Map();
  for (const row of existingRows) {
    const meta = row.spell_metadata || {};
    for (const key of spellIdentity({
      name: row.name || meta.name,
      source: row.source || meta.source,
      aon_id: meta.aon_id,
    })) {
      if (!byIdentity.has(key)) byIdentity.set(key, row);
    }
  }
  return byIdentity;
}

function minimalRow(row) {
  const base = {
    name: row.name || row.spell_metadata?.name,
    level: Number.isInteger(row.level) ? row.level : parseInt(row.spell_metadata?.level, 10) || 0,
    spell_metadata: row.spell_metadata,
  };
  return row.id ? { id: row.id, ...base } : base;
}

async function updateRows(sb, updates) {
  const chunkSize = 100;
  for (let i = 0; i < updates.length; i += chunkSize) {
    const chunk = updates.slice(i, i + chunkSize).map(({ id, row }) => ({ id, ...row }));
    let { error } = await sb.from('spells').upsert(chunk, { onConflict: 'id' });
    if (error && /column .*slug|column .*level|column .*source|column .*is_official|Could not find|schema cache/i.test(error.message || '')) {
      ({ error } = await sb.from('spells').upsert(chunk.map(minimalRow), { onConflict: 'id' }));
    }
    if (error) throw error;
    console.log(`Updated ${Math.min(i + chunk.length, updates.length)} / ${updates.length} spells`);
  }
}

async function insertRows(sb, rows) {
  const chunkSize = 100;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    let { error } = await sb.from('spells').insert(chunk);
    if (error && /column .*slug|column .*level|column .*source|column .*is_official|Could not find|schema cache/i.test(error.message || '')) {
      const minimal = chunk.map(minimalRow);
      ({ error } = await sb.from('spells').insert(minimal));
    }
    if (error) throw error;
    console.log(`Inserted ${Math.min(i + chunk.length, rows.length)} / ${rows.length} spells`);
  }
}

async function main() {
  if (!fs.existsSync(SPELLS_FILE)) {
    throw new Error(`Transformed spells file not found: ${SPELLS_FILE}. Run node tools/aon-fetch.js spell --force, then node tools/aon-transform-spells.js first.`);
  }

  const spells = JSON.parse(fs.readFileSync(SPELLS_FILE, 'utf8'));
  if (!Array.isArray(spells)) throw new Error('Spell JSON must be an array.');

  const official = spells.filter(spell => spell?.name && spell.custom !== true && spell._homebrew !== true);
  const rows = official.map(toSpellRow);
  const withDamage = official.filter(spell => spell.damage?.base || spell.damageBase).length;
  const withHeighteningDamage = official.filter(spell => spell.heightening?.damage_bonus).length;
  const withSave = official.filter(spell => spell.defense && spell.defense !== 'AC').length;
  const attackRolls = official.filter(spell => spell.defense === 'AC').length;

  console.log(`Prepared ${rows.length} official AoN spells.`);
  console.log(`Damage: ${withDamage} base damage entries; ${withHeighteningDamage} heightening damage entries.`);
  console.log(`Defenses: ${withSave} save spells; ${attackRolls} attack-roll spells.`);
  console.log(`First: ${rows[0]?.name}; Last: ${rows[rows.length - 1]?.name}`);

  if (dryRun || !replaceOfficial) {
    console.log('Dry run only. Add --replace-official to update existing AoN spells and insert missing ones in Supabase.');
    return;
  }

  const sb = getSupabase();
  if (!sb) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');

  console.log('Loading existing Supabase spell rows...');
  const existingRows = await fetchExistingSpells(sb);
  const byIdentity = buildExistingIndex(existingRows);
  const updates = [];
  const inserts = [];

  for (const row of rows) {
    const existing = spellIdentity(row.spell_metadata)
      .map(key => byIdentity.get(key))
      .find(Boolean);
    if (existing?.id) updates.push({ id: existing.id, row });
    else inserts.push(row);
  }

  console.log(`Existing rows: ${existingRows.length}. Will update ${updates.length}, insert ${inserts.length}.`);
  if (updates.length) await updateRows(sb, updates);
  if (inserts.length) await insertRows(sb, inserts);
  console.log(`Done. Upserted ${rows.length} AoN spells into Supabase while preserving existing spell IDs.`);
}

main().catch(err => {
  console.error(err.message || err);
  process.exit(1);
});
