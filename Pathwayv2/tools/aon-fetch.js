// tools/aon-fetch.js
//
// Phase 1 of the AoN sync pipeline. Pulls raw documents from Archives of
// Nethys's public Elasticsearch endpoint into gamedata/aon-raw/<category>.json.
//
// What this does NOT do: transform documents into your bot's internal format.
// That's phase 2 — once we've seen real AoN documents, we'll write proper
// transformers from raw shape → bot shape.
//
// USAGE:
//   node tools/aon-fetch.js                   # fetch every category
//   node tools/aon-fetch.js spell             # one category
//   node tools/aon-fetch.js spell feat item   # several
//   node tools/aon-fetch.js --force           # re-fetch even if file exists
//
// AoN's Elasticsearch is community-run and free. Be a good citizen:
//   • This script paginates with a small page size (200) and a 250ms gap
//     between requests, so a full sync is ~2-3 minutes total — gentle.
//   • Sets a User-Agent identifying our bot so AoN's ops team can reach out
//     if we ever cause a problem.
//   • Idempotent: re-running skips categories that already have a complete
//     file (delete the file or use --force to re-fetch).
//
// Categories pulled (matches AoN's `category` field on each document):
//   action, ancestry, archetype, armor, article, background, class,
//   class-feature, creature, creature-family, deity, equipment, feat, hazard,
//   rules, skill, shield, spell, source, trait, weapon, weapon-group, plus
//   subsystem/reference categories such as ritual, relic, language, domain,
//   plane, vehicle, disease, curse, familiar-ability, and kingdom data.
//
// OUTPUT: gamedata/aon-raw/<category>.json — an array of documents in the
//         exact shape AoN returns them. We don't touch the data; we just
//         strip Elasticsearch's wrapper (each document arrives wrapped in
//         { _id, _source: {...} } — we save just the _source for each).

'use strict';

const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

// ── Config ──────────────────────────────────────────────────────────────────
const ES_URL = 'https://elasticsearch.aonprd.com/aon/_search';
const PAGE_SIZE = 200;            // small page = polite
const REQUEST_GAP_MS = 250;       // wait between paginated requests
const MAX_RETRIES = 3;
const RETRY_BACKOFF_MS = 2000;
const USER_AGENT = 'PathwayBot/1.0 (Discord bot for PF2e; https://github.com/vivantur/Pathway)';

// All categories AoN's `aon` index knows about. Order is fastest-to-slowest;
// running this top-down makes the early progress visible quickly.
const ALL_CATEGORIES = [
  'action', 'skill', 'trait', 'weapon-group',
  'ancestry', 'background', 'class', 'archetype',
  'class-feature', 'deity', 'source', 'rules', 'article',
  'shield', 'armor', 'weapon',
  'feat', 'hazard', 'creature-family',
  'equipment', 'spell', 'creature',
  'ritual', 'relic', 'set-relic',
  'familiar-ability', 'familiar-specific',
  'language', 'domain', 'plane',
  'curse', 'disease',
  'vehicle', 'siege-weapon',
  'kingdom-structure', 'kingdom-event',
  'skill-general-action', 'weather-hazard',
  'animal-companion', 'animal-companion-specialization', 'animal-companion-advanced', 'animal-companion-unique',
  'creature-ability', 'creature-adjustment', 'creature-theme-template',
  'source', 'sidebar', 'category-page',
  'bloodline', 'lesson', 'patron', 'mystery', 'cause', 'doctrine', 'instinct',
  'muse', 'racket', 'research-field', 'arcane-school', 'arcane-thesis',
  'eidolon', 'implement', 'innovation', 'hybrid-study', 'methodology',
  'conscious-mind', 'subconscious-mind',
  'hunters-edge', 'druidic-order', 'apparition', 'way', 'style',
  'mythic-calling', 'ikon', 'destiny', 'epithet',
];

const OUTPUT_DIR = path.join(__dirname, '..', 'gamedata', 'aon-raw');

// ── Tiny helpers ────────────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function fmtDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 100) / 10;
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
}

// ── Elasticsearch fetcher ───────────────────────────────────────────────────
// Uses the search-after pattern for stable pagination over large result sets.
// (Plain from/size pagination is capped at 10k results in Elasticsearch by
// default, and AoN has more creatures than that. search_after is the fix.)

async function fetchPage(category, fromOffset = 0) {
  const body = {
    from: fromOffset,
    size: PAGE_SIZE,
    query: { match: { category } },
    // No sort: AoN's Elasticsearch disallows fielddata access on `_id` and
    // we don't know their full field mapping. Default scoring + simple
    // from/size pagination works fine for AoN's volume — every category
    // has < 10k documents (the ES default cap), so we never hit the
    // pagination limit.
  };

  let lastErr = null;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(ES_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': USER_AGENT,
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        // 429 = rate limited; 5xx = server hiccup. Both retryable.
        if (res.status === 429 || res.status >= 500) {
          throw new Error(`HTTP ${res.status} ${res.statusText}`);
        }
        // 4xx = our request is bad; don't retry, surface clearly.
        const text = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status} ${res.statusText} (bad request — not retrying): ${text.slice(0, 200)}`);
      }
      const data = await res.json();
      return data;
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_RETRIES) {
        const wait = RETRY_BACKOFF_MS * attempt;
        console.warn(`  ⚠️  attempt ${attempt}/${MAX_RETRIES} failed (${err.message}). retrying in ${wait}ms...`);
        await sleep(wait);
      }
    }
  }
  throw new Error(`failed after ${MAX_RETRIES} attempts: ${lastErr?.message}`);
}

// Fetch ALL documents in one category, paginating through with from/size.
// Returns an array of just the `_source` objects (not the ES wrapper).
async function fetchCategory(category) {
  const allDocs = [];
  let pageNum = 0;
  let totalExpected = null;
  const startTime = Date.now();

  while (true) {
    pageNum++;
    const result = await fetchPage(category, allDocs.length);
    const hits = result?.hits?.hits || [];
    if (hits.length === 0) break;

    for (const hit of hits) {
      // Save just the _source. The bot doesn't need ES's _id / _score / etc.
      allDocs.push(hit._source);
    }

    // First page also tells us total count — useful for progress display.
    if (pageNum === 1) {
      totalExpected = result?.hits?.total?.value ?? null;
    }
    process.stdout.write(`\r    fetching: ${allDocs.length}/${totalExpected ?? '?'}    `);

    // If we got fewer hits than PAGE_SIZE, we're at the end.
    if (hits.length < PAGE_SIZE) break;

    // Safety: if we somehow loop forever (shouldn't happen, but ES has been
    // weird before), bail out at 15k results — that's larger than any AoN
    // category and well past the 10k from/size cap.
    if (allDocs.length >= 15000) {
      console.warn(`\n    ⚠️  reached 15k document safety cap; stopping early.`);
      break;
    }

    await sleep(REQUEST_GAP_MS);
  }

  console.log(`\r    ✓ fetched ${allDocs.length} ${category} documents in ${fmtDuration(Date.now() - startTime)}            `);
  return allDocs;
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  // Parse args
  const argv = process.argv.slice(2);
  const force = argv.includes('--force');
  const explicit = argv.filter(a => !a.startsWith('--'));
  const categories = explicit.length > 0 ? explicit : ALL_CATEGORIES;

  // Validate category names if user passed any explicitly
  if (explicit.length > 0) {
    const unknown = explicit.filter(c => !ALL_CATEGORIES.includes(c));
    if (unknown.length > 0) {
      console.error(`❌ Unknown category/categories: ${unknown.join(', ')}`);
      console.error(`   Known categories: ${ALL_CATEGORIES.join(', ')}`);
      process.exit(1);
    }
  }

  // Make sure the output dir exists
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  console.log(`🪶 AoN raw data fetch`);
  console.log(`   endpoint: ${ES_URL}`);
  console.log(`   output:   ${OUTPUT_DIR}`);
  console.log(`   target:   ${categories.length} categor${categories.length === 1 ? 'y' : 'ies'}${force ? ' (force re-fetch)' : ''}`);
  console.log('');

  const overallStart = Date.now();
  const summary = { ok: [], skipped: [], failed: [] };

  for (const cat of categories) {
    const outFile = path.join(OUTPUT_DIR, `${cat}.json`);
    if (!force && fs.existsSync(outFile)) {
      console.log(`  ⏭  ${cat.padEnd(18)} (already fetched — use --force to re-fetch)`);
      summary.skipped.push(cat);
      continue;
    }

    console.log(`  📥 ${cat}`);
    try {
      const docs = await fetchCategory(cat);
      // Pretty-print so humans can read these files; small overhead.
      fs.writeFileSync(outFile, JSON.stringify(docs, null, 2), 'utf8');
      summary.ok.push({ cat, count: docs.length });
    } catch (err) {
      console.error(`    ❌ failed: ${err.message}`);
      summary.failed.push({ cat, error: err.message });
    }
    // Polite gap between categories too
    await sleep(REQUEST_GAP_MS);
  }

  // ── Final summary ────────────────────────────────────────────────────────
  console.log('');
  console.log(`✨ Done in ${fmtDuration(Date.now() - overallStart)}`);
  if (summary.ok.length > 0) {
    console.log(`   ✓ ${summary.ok.length} fetched:`);
    for (const { cat, count } of summary.ok) {
      console.log(`     • ${cat.padEnd(18)} ${count.toLocaleString()} docs`);
    }
  }
  if (summary.skipped.length > 0) {
    console.log(`   ⏭ ${summary.skipped.length} skipped (already cached): ${summary.skipped.join(', ')}`);
  }
  if (summary.failed.length > 0) {
    console.log(`   ❌ ${summary.failed.length} failed:`);
    for (const { cat, error } of summary.failed) {
      console.log(`     • ${cat.padEnd(18)} ${error}`);
    }
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
