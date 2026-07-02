'use strict';

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { getSupabase } = require('../utils/supabase');
const { toSlug, parsePriceToCp, parseBulk } = require('../parsers/itemParser');

const inputArg = process.argv.slice(2).find(arg => !arg.startsWith('--'));
const inputPath = inputArg
  ? path.resolve(inputArg)
  : path.join(__dirname, 'homebrew-items.json');
const dryRun = process.argv.includes('--dry-run');

function normalizeRarity(value) {
  const raw = String(value || 'Common').toLowerCase();
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

function normalizeCategory(category) {
  const raw = String(category || '').trim();
  const map = {
    alchemical: 'Alchemical Items',
    'crafting material': 'Materials',
    material: 'Materials',
    treasure: 'Treasure',
    'magical component': 'Consumables',
    'magical item': 'Held Items',
    'trade good': 'Treasure',
    ammunition: 'Consumables',
  };
  return map[raw.toLowerCase()] || raw || null;
}

function normalizeBulk(value) {
  if (value == null) return { raw: null, normalized: null };
  const cleaned = String(value)
    .replace(/\u2014/g, '-')
    .replace(/^-$|^—$/g, '—');
  return parseBulk(cleaned);
}

function sourceObject(item) {
  const book = item.source_book || item.source || 'Homebrew';
  const page = item.page != null ? Number(item.page) : null;
  return {
    book,
    page: Number.isFinite(page) ? page : null,
    source_text: Number.isFinite(page) ? `${book} pg. ${page}` : book,
  };
}

function convertItem(item) {
  const name = item.name || item.item_name;
  if (!name) throw new Error('Item is missing item_name/name.');

  const id = toSlug(name);
  const bulk = normalizeBulk(item.bulk);
  const priceRaw = item.price ?? item.price_raw ?? null;
  const traits = Array.isArray(item.traits)
    ? item.traits.map(t => String(t).trim()).filter(Boolean)
    : [];

  return {
    id,
    name,
    lookup_name: name.toLowerCase(),
    pfs_availability: null,
    source: sourceObject(item),
    rarity: normalizeRarity(item.rarity),
    traits,
    category: normalizeCategory(item.category),
    subcategory: item.subcategory || null,
    level: item.item_level ?? item.level ?? null,
    price_raw: priceRaw,
    price_cp: parsePriceToCp(priceRaw),
    bulk_raw: bulk.raw,
    bulk_normalized: bulk.normalized,
    usage: item.usage && item.usage !== '—' ? item.usage : null,
    campaign: null,
    notes: item.description || item.notes || null,
    _homebrew: true,
  };
}

async function main() {
  if (!fs.existsSync(inputPath)) {
    throw new Error(`Input file not found: ${inputPath}`);
  }

  const payload = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  const rawItems = Array.isArray(payload) ? payload : payload.items;
  if (!Array.isArray(rawItems)) {
    throw new Error('Input JSON must be an array or an object with an items array.');
  }

  const converted = rawItems.map(convertItem);
  const rows = converted.map(item => ({
    type: 'item',
    entry_key: item.id,
    name: item.name,
    data: item,
    added_by: 'supabase-import-homebrew-items',
  }));

  if (dryRun) {
    console.log(`Dry run OK. Converted ${rows.length} homebrew item rows.`);
    console.log(`First: ${rows[0]?.entry_key} / ${rows[0]?.name}`);
    console.log(`Last: ${rows[rows.length - 1]?.entry_key} / ${rows[rows.length - 1]?.name}`);
    return;
  }

  const sb = getSupabase();
  if (!sb) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
  }

  const chunkSize = 100;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const { error } = await sb
      .from('homebrew_entries')
      .upsert(chunk, { onConflict: 'type,entry_key' });
    if (error) throw error;
    console.log(`Imported ${Math.min(i + chunk.length, rows.length)} / ${rows.length} homebrew items`);
  }

  console.log(`Done. Imported ${rows.length} homebrew items into Supabase.`);
}

main().catch(err => {
  console.error(err.message || err);
  process.exit(1);
});
