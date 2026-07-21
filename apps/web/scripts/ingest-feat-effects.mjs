#!/usr/bin/env node
/**
 * Ingest the Foundry `feat-effects` pack and LINK each Effect to the feat that
 * grants it (action-feats handoff, step 2).
 *
 * WHY THIS IS A SEPARATE PASS. Most action-feat mechanics do NOT live on the feat
 * — they live on a separate Foundry *Effect* item (a stance's bonus, a rider's
 * rider), and the feat carries no `GrantItem` pointing at it (measured: 0 of 6,044
 * feats GrantItem a feat-effect). `ingest-pf2e.mjs` walks `packs/pf2e/feats` only,
 * so those mechanics never reach us. This pass walks `packs/pf2e/feat-effects`
 * (833 items), links each to its feat, and folds the effect's `rules[]` into that
 * feat's `raw` in the sidecar — so the existing `foundry` producer maps them and
 * `build-candidates.mjs` reconciles them into the review queue.
 *
 * WHAT IT DOES NOT DO. It writes NO content (no `feats.json` `effects`) and makes
 * NO decision — it only adds provenance-tagged `raw` to the admin sidecar, exactly
 * the shape `remap-effects.mjs` re-maps later WITHOUT a clone. Capturing that raw
 * is the gap the handoff named ("the effect-pack raw was never captured").
 *
 * LINKING IS EARNED, NOT FORCED. A wrong link puts a stance's mechanics on the
 * wrong feat — a wrong sheet, worse than an absent one. So each link carries HOW it
 * was made (exact slug, prose @UUID, fuzzy), and the fuzzy tail and the unmatched
 * are REPORTED, never approximated.
 *
 * SOURCE: the same local clone `ingest-pf2e.mjs` uses (pinned commit). Never
 * committed; only the regenerated sidecar is.
 *
 * USAGE:
 *   node scripts/ingest-feat-effects.mjs --src <foundry-pf2e-clone> [--data <dir>] [--dry]
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_DIR_DEFAULT = resolve(HERE, '..', 'src', 'features', 'builder', 'data');
const SIDECAR = 'effect-ingest-report.json';
const LINKS = 'feat-effects-links.json';
const FEATS = 'feats.json';

function parseArgs(argv) {
  const out = { src: null, data: DATA_DIR_DEFAULT, dry: false };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--src') out.src = resolve(argv[++i]);
    else if (argv[i] === '--data') out.data = resolve(argv[++i]);
    else if (argv[i] === '--dry') out.dry = true;
  }
  if (!out.src) throw new Error('Missing --src <path-to-foundry-pf2e-clone>');
  return out;
}

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

/** Recursively collect .json files under a dir (skipping Foundry's _folders.json). */
function walkJson(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walkJson(p));
    else if (name.endsWith('.json') && name !== '_folders.json') out.push(p);
  }
  return out;
}

// ── linking ──────────────────────────────────────────────────────────────────

// Prefixes a feat-effect filename carries that its feat does not (`effect-…`,
// `aura-…`). Stripped to recover the candidate feat slug.
const EFFECT_PREFIXES = [/^effect-/, /^aura-/];

// Suffixes that mark a VARIANT of one effect (the ally/enemy halves of an aura, a
// stance's temporary-HP rider, rank tiers). Stripped only in the fuzzy pass, and
// only after exact + prose have failed — a variant still belongs to its base feat.
const VARIANT_SUFFIXES = [
  /-ally$/, /-enemy$/, /-self$/,
  /-temporary-hit-points$/, /-temp-hp$/,
  /-greater$/, /-lesser$/, /-major$/, /-moderate$/, /-minor$/,
  /-adept$/, /-expert$/, /-master$/, /-legendary$/,
];

function stripPrefix(slug) {
  for (const re of EFFECT_PREFIXES) if (re.test(slug)) return slug.replace(re, '');
  return slug;
}

/**
 * Link one effect (by its base slug) to a feat id, trying the methods in order of
 * confidence. Returns `{ featId, method }` or `{ featId: null, method: 'unmatched' }`.
 *
 * `proseLinks` maps a feat id → true when a clone feat's prose @UUID-references this
 * effect; it is the authoritative non-name signal and so is tried before fuzzing.
 */
function linkEffect(effect, featIds, proseByToken) {
  const base = stripPrefix(effect.slug);
  if (featIds.has(base)) return { featId: base, method: 'exact' };

  // Prose links are keyed by the RAW @UUID token, which is either the effect's
  // _id or its display name ("Effect: Armor Tampered With (Critical Success)").
  // Tamper references its four degree effects by name, so this is the pass that
  // links slug-mismatched variants to the feat that actually grants them.
  const prose = proseByToken.get(effect._id) ?? proseByToken.get(effect.name);
  if (prose && featIds.has(prose)) return { featId: prose, method: 'prose-uuid' };

  let fuzzy = base;
  for (const re of VARIANT_SUFFIXES) fuzzy = fuzzy.replace(re, '');
  if (fuzzy !== base && featIds.has(fuzzy)) return { featId: fuzzy, method: 'fuzzy' };

  return { featId: null, method: 'unmatched' };
}

/**
 * Index every clone feat whose prose or rules @UUID-reference a feat-effect, so we
 * can link an effect back to a feat that names it explicitly even when the slugs
 * differ. Maps the raw @UUID token (an effect `_id` OR its display name) → feat id
 * (the clone filename slug == our feat id).
 */
function buildProseIndex(cloneFeatFiles) {
  const byToken = new Map();
  const UUID_RE = /@UUID\[Compendium\.pf2e\.feat-effects\.Item\.([^\]]+)\]/g;
  for (const p of cloneFeatFiles) {
    const featId = basename(p, '.json');
    const feat = readJson(p);
    const hay = JSON.stringify(feat.system?.rules ?? []) + (feat.system?.description?.value ?? '');
    for (const m of hay.matchAll(UUID_RE)) {
      if (!byToken.has(m[1])) byToken.set(m[1], featId);
    }
  }
  return byToken;
}

// ── run ──────────────────────────────────────────────────────────────────────

function main() {
  const args = parseArgs(process.argv);
  const packRoot = join(args.src, 'packs', 'pf2e');
  const effectsDir = join(packRoot, 'feat-effects');
  const featsDir = join(packRoot, 'feats');
  if (!existsSync(effectsDir)) throw new Error(`No feat-effects pack under --src (${effectsDir})`);

  const feats = readJson(join(args.data, FEATS));
  const featIds = new Set(feats.map((f) => f.id));

  const effectFiles = readdirSync(effectsDir).filter((f) => f.endsWith('.json') && f !== '_folders.json');
  const effects = effectFiles.map((f) => {
    const e = readJson(join(effectsDir, f));
    return {
      slug: basename(f, '.json'),
      _id: e._id,
      name: e.name,
      rules: e.system?.rules ?? [],
      duration: e.system?.duration,
      traits: e.system?.traits?.value ?? [],
      level: e.system?.level?.value,
    };
  });

  const proseByToken = buildProseIndex(walkJson(featsDir));

  const linked = effects.map((e) => ({ effect: e, ...linkEffect(e, featIds, proseByToken) }));

  // ── coverage report.
  const byMethod = {};
  for (const l of linked) byMethod[l.method] = (byMethod[l.method] ?? 0) + 1;
  const withRules = linked.filter((l) => l.featId && l.effect.rules.length > 0);
  const unmatched = linked.filter((l) => l.method === 'unmatched');

  console.log(`feat-effects: ${effects.length}`);
  console.log('linked by method:', JSON.stringify(byMethod));
  console.log(`linked total: ${linked.length - byMethod.unmatched} | of those carrying rule elements: ${withRules.length}`);
  console.log(`unmatched: ${unmatched.length}`);
  console.log('\nsample links:');
  for (const l of linked.filter((x) => x.featId).slice(0, 10)) {
    console.log(`  ${l.effect.slug}  →  ${l.featId}  [${l.method}] (${l.effect.rules.length} rules)`);
  }
  console.log('\nsample unmatched (no feat by any method):');
  for (const l of unmatched.slice(0, 15)) console.log(`  ${l.effect.slug}  (${l.effect.rules.length} rules)`);

  // ── rule-element key histogram — what mechanics the effects actually carry.
  const keyHist = {};
  for (const l of withRules) for (const r of l.effect.rules) keyHist[r.key] = (keyHist[r.key] ?? 0) + 1;
  const topKeys = Object.entries(keyHist).sort((a, b) => b[1] - a[1]).slice(0, 15);
  console.log('\nrule-element keys across linked effects (top 15):');
  for (const [k, n] of topKeys) console.log(`  ${k}: ${n}`);

  if (args.dry) { console.log('\n--dry: nothing written'); return { linked }; }

  // ── write the links to their OWN sidecar, `feat-effects-links.json`.
  //
  // A SEPARATE file, not the feat sidecar, on purpose. The feat sidecar's entities
  // carry a feat's OWN rule elements and are rebuilt from scratch by
  // remap-effects.mjs; folding granted-effect raw in there would be stripped on the
  // next re-map. Keeping links standalone means remap never touches them, the main
  // sidecar stays purely feat-own-rules, and build-candidates reads BOTH. Each link
  // carries its provenance (which effect, how linked, its duration) so the review UI
  // can say a candidate came from a granted effect, not the feat's own text.
  const commit = existsSync(join(args.data, SIDECAR))
    ? (readJson(join(args.data, SIDECAR)).sourceCommit ?? 'unknown')
    : 'unknown';

  const links = [];
  for (const l of linked) {
    if (!l.featId || l.effect.rules.length === 0) continue;
    links.push({
      featId: l.featId,
      effectId: l.effect.slug,
      effectName: l.effect.name,
      link: l.method,
      ...(l.effect.duration ? { duration: l.effect.duration } : {}),
      ...(l.effect.traits.length ? { traits: l.effect.traits } : {}),
      raw: l.effect.rules,
    });
  }
  const featsTouched = new Set(links.map((x) => x.featId));

  const out = {
    note: 'feat-effect → feat links (ingest-feat-effects.mjs). build-candidates maps these as a foundry source. Never shipped to the browser.',
    source: `foundryvtt/pf2e feat-effects @ ${commit}`,
    linked: links.length,
    feats: featsTouched.size,
    links,
  };
  writeFileSync(join(args.data, LINKS), `${JSON.stringify(out, null, 2)}\n`);
  console.log(`\nWrote ${links.length} link(s) across ${featsTouched.size} feats to ${LINKS}.`);
  return { linked };
}

main();
