// fetch-heritages.js
// One-time fetcher for PF2e heritages from Archives of Nethys.
//
// Pulls heritage data directly from AoN's Elasticsearch endpoint and writes
// the result to gamedata/heritages.json. Run once locally; the bot reads from
// gamedata/heritages.json on startup.
//
// Run with: node fetch-heritages.js
//
// What this fetches:
//   - Ancestry-specific heritages (Wildwood Halfling, Cavern Elf, etc.)
//   - Versatile heritages (Tiefling, Aasimar, Dhampir, Changeling, Nephilim,
//     Dragonblood, Duskwalker, etc.)
//
// Output shape:
//   {
//     "_meta": { fetchedAt, count },
//     "wildwood-halfling": {
//       name: "Wildwood",
//       ancestry: "Halfling",
//       description: "...",
//       traits: [...],
//       rarity: "Common"
//     },
//     ...
//   }

'use strict';

const fs = require('fs');
const path = require('path');

const AON_URL = 'https://elasticsearch.aonprd.com/aon/_search';
const PAGE_SIZE = 1000;

async function fetchAll() {
  const heritages = [];
  let from = 0;

  while (true) {
    const body = {
      query: { match: { category: 'heritage' } },
      from,
      size: PAGE_SIZE,
    };

    console.log(`Fetching heritages ${from}–${from + PAGE_SIZE}...`);
    const res = await fetch(AON_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const body = await res.text();
      if (res.status === 403 && /host not in allowlist/i.test(body)) {
        throw new Error(
          `AoN's allowlist blocked the request (403).\n\n` +
          `Most cloud-hosted IPs are blocked. RUN THIS SCRIPT FROM YOUR LOCAL\n` +
          `WINDOWS MACHINE — not from Railway, not from any cloud server.\n\n` +
          `Once heritages.json is generated locally, commit it to your repo\n` +
          `and Railway will pick it up on the next deploy.`
        );
      }
      throw new Error(`AoN returned HTTP ${res.status}: ${body.slice(0, 200)}`);
    }
    const data = await res.json();
    const hits = data?.hits?.hits ?? [];
    if (hits.length === 0) break;

    for (const hit of hits) {
      heritages.push(hit._source);
    }

    from += hits.length;
    if (hits.length < PAGE_SIZE) break;
  }

  console.log(`Got ${heritages.length} heritages.`);
  return heritages;
}

function transform(rawHeritages) {
  // Convert AoN's raw doc into the shape our /heritage handler wants.
  // AoN's heritage docs have these (approximate) fields:
  //   name           → "Cavern Elf"
  //   ancestry       → "Elf" (sometimes "Versatile Heritage" for versatiles)
  //   text           → markdown body
  //   trait          → array of strings
  //   rarity         → "Common" / "Uncommon" / "Rare" / "Unique"
  //   summary        → short description
  //   primary_source → e.g. "Player Core 1 pg. 47"
  const out = { _meta: { fetchedAt: new Date().toISOString(), count: 0 } };
  for (const h of rawHeritages) {
    if (!h || !h.name) continue;
    const key = h.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    if (!key) continue;
    // For versatile heritages (e.g. Tiefling), `ancestry` is often "Versatile
    // Heritage" or missing. Mark them so the bot can render them differently.
    const ancestry = h.ancestry || h.ancestry_markdown || '';
    const isVersatile = !ancestry || /versatile/i.test(ancestry);

    // Body text: prefer summary then text. Strip the markdown header bits.
    let description = h.summary || h.text || '*(no description)*';
    if (typeof description === 'string') {
      // Trim off the leading source/trait bracket text that AoN markdown
      // usually starts with — not strictly necessary but cleans output.
      description = description.replace(/^(Source [^\n]+\n)?(?:\*\*[^*]+\*\*\s*\n)*/i, '').trim();
    }

    out[key] = {
      name: h.name,
      ancestry: isVersatile ? 'Versatile Heritage' : ancestry,
      isVersatile,
      description,
      traits: Array.isArray(h.trait) ? h.trait : [],
      rarity: h.rarity || 'Common',
      source: h.primary_source || h.source || null,
    };
    out._meta.count++;
  }
  return out;
}

async function main() {
  console.log('Fetching heritages from Archives of Nethys...');
  const raw = await fetchAll();

  console.log('Transforming into bot-ready shape...');
  const transformed = transform(raw);

  const outDir = path.join(process.cwd(), 'gamedata');
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
    console.log(`Created ${outDir}/`);
  }

  const outFile = path.join(outDir, 'heritages.json');
  fs.writeFileSync(outFile, JSON.stringify(transformed, null, 2));
  console.log(`✓ Wrote ${transformed._meta.count} heritages to ${outFile}`);

  // Print a summary so you can sanity-check the result
  const versatileCount = Object.values(transformed)
    .filter(v => v && typeof v === 'object' && v.isVersatile)
    .length;
  console.log(`  Including ${versatileCount} versatile heritages.`);

  // Sample a few names
  const sample = Object.values(transformed)
    .filter(v => v && typeof v === 'object' && v.name)
    .slice(0, 8)
    .map(v => `${v.name} (${v.ancestry})`);
  console.log(`  Sample: ${sample.join(', ')}`);
}

main().catch(err => {
  console.error('Failed:', err);
  process.exit(1);
});