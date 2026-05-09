'use strict';

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { getSupabase } = require('../utils/supabase');
const { creatureSlug, transformCreature } = require('../tools/aon-transform-creatures');

const rawArg = process.argv.slice(2).find(arg => !arg.startsWith('--'));
const RAW_FILE = rawArg
  ? path.resolve(rawArg)
  : path.join(__dirname, '..', 'gamedata', 'aon-raw', 'creature.json');

const dryRun = process.argv.includes('--dry-run');
const replaceOfficial = process.argv.includes('--replace-official') || process.argv.includes('--apply');

function firstCreatureTrait(traits) {
  const skip = new Set(['tiny', 'small', 'medium', 'large', 'huge', 'gargantuan', 'common', 'uncommon', 'rare', 'unique']);
  return (traits || []).find(t => !skip.has(String(t).toLowerCase())) || 'Humanoid';
}

function toTopLevelMonsterRow(key, monster) {
  const core = monster.core || {};
  const rich = monster.rich || {};
  const defenses = rich.defenses || {};
  const saves = core.saves || {};
  const traits = core.traits || [];
  const metadata = { key, ...monster };

  return {
    name: String(monster.name || ''),
    level: Number.isInteger(core.level) ? core.level : 0,
    size: String(core.size || 'Medium'),
    creature_type: String(firstCreatureTrait(traits)),
    alignment: String(monster.alignment || 'Unaligned'),
    traits,
    rarity: String(core.rarity || 'Common'),
    hp: Number.isInteger(core.hp) ? core.hp : 1,
    ac: Number.isInteger(core.ac) ? core.ac : 10,
    perception: Number.isInteger(core.perception) ? core.perception : 0,
    saving_throws: {
      fort: Number.isInteger(saves.fort) ? saves.fort : 0,
      ref: Number.isInteger(saves.ref) ? saves.ref : 0,
      will: Number.isInteger(saves.will) ? saves.will : 0,
    },
    speed: rich.speed || {},
    ability_modifiers: rich.ability_modifiers || {},
    languages: rich.languages || [],
    immunities: defenses.immunities || [],
    resistances: defenses.resistances || [],
    weaknesses: defenses.weaknesses || [],
    abilities: rich.abilities || {},
    attacks: rich.attacks || [],
    spellcasting: rich.spellcasting?.length ? rich.spellcasting : null,
    is_companion: false,
    companion_types: [],
    description: rich.description || null,
    source: monster.source || null,
    is_official: true,
    discord_guild_id: null,
    created_by_user_id: null,
    monster_metadata: metadata,
  };
}

async function deleteOfficialBestiary(sb) {
  const { error } = await sb
    .from('monsters')
    .delete()
    .eq('is_official', true)
    .eq('is_companion', false)
    .is('discord_guild_id', null);
  if (error) throw error;
}

async function insertRows(sb, rows) {
  const chunkSize = 100;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const { error } = await sb.from('monsters').insert(chunk);
    if (error) throw error;
    console.log(`Inserted ${Math.min(i + chunk.length, rows.length)} / ${rows.length} monsters`);
  }
}

async function main() {
  if (!fs.existsSync(RAW_FILE)) {
    throw new Error(`Raw AoN creature file not found: ${RAW_FILE}. Run node tools/aon-fetch.js creature --force first.`);
  }

  const rawCreatures = JSON.parse(fs.readFileSync(RAW_FILE, 'utf8'));
  if (!Array.isArray(rawCreatures)) throw new Error('AoN creature JSON must be an array.');

  const byKey = new Map();
  let skipped = 0;
  let withImage = 0;
  let withDescription = 0;
  let withAttacks = 0;
  let totalAttacks = 0;
  let withAbilities = 0;
  let withSpellcasting = 0;

  for (const raw of rawCreatures) {
    const monster = transformCreature(raw);
    if (!monster?.name) { skipped++; continue; }

    const base = creatureSlug(monster.name);
    let key = base;
    let n = 2;
    while (byKey.has(key)) key = `${base}_${n++}`;

    const attacks = monster.rich?.attacks || [];
    const abilities = monster.rich?.abilities?.bot || [];
    const spells = monster.rich?.spellcasting || [];
    if (monster.image) withImage++;
    if (monster.rich?.description) withDescription++;
    if (attacks.length) {
      withAttacks++;
      totalAttacks += attacks.length;
    }
    if (abilities.length) withAbilities++;
    if (spells.length) withSpellcasting++;
    byKey.set(key, toTopLevelMonsterRow(key, monster));
  }

  const rows = [...byKey.values()];
  console.log(`Prepared ${rows.length} official AoN monsters (${skipped} skipped).`);
  console.log(`Images: ${withImage}; descriptions: ${withDescription}; attacks: ${withAttacks} creatures / ${totalAttacks} total; abilities: ${withAbilities}; spellcasting: ${withSpellcasting}.`);
  console.log(`First: ${rows[0]?.name}; Last: ${rows[rows.length - 1]?.name}`);

  if (dryRun || !replaceOfficial) {
    console.log('Dry run only. Add --replace-official to delete and replace official non-companion monsters in Supabase.');
    return;
  }

  const sb = getSupabase();
  if (!sb) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');

  console.log('Deleting existing official non-companion bestiary rows...');
  await deleteOfficialBestiary(sb);
  console.log('Importing fresh AoN bestiary rows...');
  await insertRows(sb, rows);
  console.log(`Done. Imported ${rows.length} AoN monsters into Supabase.`);
}

main().catch(err => {
  console.error(err.message || err);
  process.exit(1);
});
