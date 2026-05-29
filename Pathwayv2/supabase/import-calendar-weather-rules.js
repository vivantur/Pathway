#!/usr/bin/env node
'use strict';

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}

const db = createClient(SUPABASE_URL, SERVICE_KEY);

function loadRule(kind, slug) {
  const file = path.join(__dirname, `${kind}-rules`, `${slug}.json`);
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  const { _meta: _ignored, ...data } = parsed;
  return {
    category: `${kind}_rules`,
    slug,
    name: slug,
    data,
  };
}

async function main() {
  const rows = [
    loadRule('calendar', 'golarion'),
    loadRule('calendar', 'eberron'),
    loadRule('weather', 'golarion'),
    loadRule('weather', 'eberron'),
  ];

  const { error } = await db
    .from('gamedata')
    .upsert(rows, { onConflict: 'category,slug' });

  if (error) throw error;
  console.log(`Imported ${rows.length} calendar/weather rules into Supabase.`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
