#!/usr/bin/env node
// Import Impossible Playtest content (necromancer + runesmith) into the bot's
// reference tables so /spell and /feat lookups know it:
//   - grave spells → `spells` rows ({ name, spell_metadata })
//   - class feats  → `gamedata` rows (category 'feats', slug, data)
//
// The content is read from the web builder's dataset (the single place the
// playtest PDF was extracted to), so web and bot stay in agreement.
//
// Usage:  node scripts/import-impossible-playtest.js [--dry-run]
// Env:    SUPABASE_URL + SUPABASE_SERVICE_KEY (same as the bot; .env is loaded)

require('dotenv').config();
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const DRY = process.argv.includes('--dry-run');
const DATA = path.join(__dirname, '../../web/src/features/builder/data');
const feats = require(path.join(DATA, 'feats.json'));
const spells = require(path.join(DATA, 'spells.json'));

const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const playtestFeats = feats.filter(
  (f) => Array.isArray(f.classIds) && (f.classIds.includes('necromancer') || f.classIds.includes('runesmith')),
);
const graveSpells = spells.filter((s) => (s.traits ?? []).includes('grave'));

async function main() {
  console.log(`playtest feats: ${playtestFeats.length} · grave spells: ${graveSpells.length}${DRY ? ' (dry run)' : ''}`);
  if (DRY) {
    for (const f of playtestFeats) console.log(`  feat  L${f.level} ${f.name} [${f.classIds.join(',')}]`);
    for (const s of graveSpells) console.log(`  spell R${s.rank} ${s.name}`);
    return;
  }

  // Accept the bot's convention and the Supabase dashboard's names alike.
  const url = process.env.SUPABASE_URL ?? process.env.SUPABASE_PROJECT_URL;
  const key =
    process.env.SUPABASE_SERVICE_KEY ??
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_KEY;
  if (!url || !key) {
    if (!url) console.error('Missing SUPABASE_URL (or SUPABASE_PROJECT_URL).');
    if (!key)
      console.error(
        'Missing SUPABASE_SERVICE_KEY (also accepted: SUPABASE_SERVICE_ROLE_KEY, SUPABASE_KEY).',
      );
    process.exit(1);
  }
  const sb = createClient(url, key);

  // Feats → gamedata(category='feats', slug, data). The bot merges these into
  // its featDatabase at startup (lib/storage.js).
  let featsOk = 0;
  for (const f of playtestFeats) {
    const row = {
      category: 'feats',
      slug: slugify(f.name),
      data: {
        name: f.name,
        level: f.level,
        type: 'class',
        class: f.classIds.includes('necromancer') ? 'Necromancer' : 'Runesmith',
        traits: f.traits ?? [],
        prerequisites: f.prerequisites ?? '',
        description: f.description ?? '',
        source: f.source ?? 'Impossible Playtest',
      },
    };
    const { error } = await sb.from('gamedata').upsert(row, { onConflict: 'category,slug' });
    if (error) console.error(`  feat FAILED ${f.name}: ${error.message}`);
    else featsOk++;
  }
  console.log(`feats upserted: ${featsOk}/${playtestFeats.length}`);

  // Grave spells → spells rows. The bot reads only spell_metadata; skip any
  // spell that already exists by name (don't clobber AoN imports).
  let spellsOk = 0;
  for (const s of graveSpells) {
    const { data: existing, error: selErr } = await sb
      .from('spells')
      .select('id')
      .ilike('name', s.name)
      .limit(1);
    if (selErr) {
      console.error(`  spell lookup FAILED ${s.name}: ${selErr.message}`);
      continue;
    }
    if (existing && existing.length) {
      console.log(`  spell exists, skipping: ${s.name}`);
      continue;
    }
    const metadata = {
      name: s.name,
      level: s.rank,
      traits: (s.traits ?? []).join(', '),
      traditions: 'occult (grave spell)',
      actions: s.cast ?? '',
      description: s.description ?? '',
      source: s.source ?? 'Impossible Playtest',
    };
    // The live table also carries a NOT NULL top-level level column.
    const { error } = await sb.from('spells').insert({ name: s.name, level: s.rank, spell_metadata: metadata });
    if (error) console.error(`  spell FAILED ${s.name}: ${error.message}`);
    else spellsOk++;
  }
  console.log(`spells inserted: ${spellsOk}/${graveSpells.length}`);
  console.log('Done. Restart the bot (or redeploy) so it reloads reference data.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
