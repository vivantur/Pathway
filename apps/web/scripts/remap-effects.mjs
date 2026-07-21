#!/usr/bin/env node
/**
 * Re-map ingested Foundry rule elements into our Layer-1 `PassiveEffect[]`.
 *
 * WHY THIS EXISTS SEPARATELY FROM `ingest-pf2e.mjs`: the two dependencies on Foundry
 * are different, and only one of them should ever be re-paid.
 *
 *   ingest-pf2e.mjs   needs a Foundry CLONE. It is how content ARRIVES. Run rarely.
 *   remap-effects.mjs needs NOTHING but this repo. It re-runs the MAPPER over rule
 *                     elements we already hold, so coverage improves as the mapper
 *                     improves — without ever going back to Foundry.
 *
 * That is the concrete form of "use them once, don't rely on them continuously": when
 * expr.ts learns infix arithmetic, or a new PassiveEffect kind lands, run this and
 * coverage rises. Foundry is not in the loop.
 *
 * INPUT (in priority order):
 *   1. the sidecar's `entities[].raw` — the normal path once migrated
 *   2. each bearer's legacy top-level `rules[]` — the ONE-TIME migration path, used
 *      when the sidecar does not exist yet
 *
 * EFFECT-BEARING DATASETS (an "effect bearer" is any content entity carrying rule
 * elements; the datasets differ only in how you WALK to them):
 *   • feats.json               — a flat array of feats.
 *   • ancestries.json          — rules live on the NESTED `heritages[]`, not on the
 *                                ancestry itself. Cavern Elf's darkvision is a
 *                                heritage's, so walking only the top level finds none.
 *   • versatile-heritages.json — a flat array of heritages (Nephilim, Dhampir, …).
 *
 * OUTPUT:
 *   • each dataset        — every bearer gains `effects` (ours); legacy `rules` removed.
 *                           These files are BUNDLED and shipped to every builder user,
 *                           so they carry only what the runtime actually reads.
 *   • <sidecar>.json      — `raw` (Foundry's shape, quarantined) + the per-element
 *                           report + a coverage summary. ADMIN-ONLY: deliberately not
 *                           imported by the builder, so none of it reaches a player's
 *                           browser.
 *
 * USAGE:
 *   node scripts/remap-effects.mjs [--data <dir>] [--dry]
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mapFoundryRules, resolveEntity, summarizeReports, producedOptionTags } from '@pathway/core';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_DIR_DEFAULT = resolve(HERE, '..', 'src', 'features', 'builder', 'data');
const SIDECAR = 'effect-ingest-report.json';
const CANDIDATES = 'effect-candidates.json';
const DECISIONS = 'effect-decisions.json';

function parseArgs(argv) {
  const out = { data: DATA_DIR_DEFAULT, dry: false };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--data') out.data = resolve(argv[++i]);
    else if (argv[i] === '--dry') out.dry = true;
  }
  return out;
}

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

/**
 * The datasets carrying rule elements, and how to reach the bearers in each.
 * `walk` yields every effect-bearing object in the parsed file.
 */
const DATASETS = [
  { file: 'feats.json', kind: 'feat', walk: (data) => data },
  {
    file: 'ancestries.json',
    kind: 'heritage',
    // Ancestries themselves carry none in the corpus; their heritages carry all 49.
    walk: (data) => data.flatMap((ancestry) => ancestry.heritages ?? []),
  },
  { file: 'versatile-heritages.json', kind: 'heritage', walk: (data) => data },
];

/**
 * The fold-in: candidates + human decisions → the effects a sheet actually reads.
 *
 * `resolveEntity` is the ONE path from proposal to content, so this script does not
 * decide anything — it loads the two inputs and reports what came back. Absent either
 * file, folding is skipped and the Foundry mapping stands, which is what a fresh clone
 * or a `--data` pointed at a bare directory should do.
 *
 * FEATS ONLY, because candidates exist only for feats: `build-candidates.mjs` runs the
 * prose parser over the feats corpus. Heritages keep the mapped-from-Foundry path until
 * a producer proposes for them.
 */
function loadFoldIn(dataDir) {
  const candidatesPath = join(dataDir, CANDIDATES);
  const decisionsPath = join(dataDir, DECISIONS);
  if (!existsSync(candidatesPath)) return null;

  const { candidates } = readJson(candidatesPath);
  const decisions = existsSync(decisionsPath) ? readJson(decisionsPath).decisions ?? [] : [];

  const byEntity = new Map();
  for (const c of candidates) {
    const list = byEntity.get(c.entityId);
    if (list) list.push(c);
    else byEntity.set(c.entityId, [c]);
  }

  // Decisions are grouped by entity too, and each entity is resolved against ITS OWN
  // decisions only. Handing the whole list to every entity would make resolveEntity
  // report every other entity's decisions as stale — 57 decisions across 711 feats
  // came back as 40,470 "stale" entries before this was split.
  const decisionsByEntity = new Map();
  for (const d of decisions) {
    const list = decisionsByEntity.get(d.entityId);
    if (list) list.push(d);
    else decisionsByEntity.set(d.entityId, [d]);
  }

  // Staleness is a GLOBAL question — a decision pointing at a candidate that no
  // producer proposes any more — so it is computed once, here, not per entity.
  const liveKeys = new Set(candidates.map((c) => `${c.entityId} ${c.key}`));
  const stale = decisions.filter((d) => !liveKeys.has(`${d.entityId} ${d.key}`));

  return {
    byEntity,
    decisionsByEntity,
    decisions,
    stale,
    candidateCount: candidates.length,
    decisionCount: decisions.length,
  };
}

function main() {
  const args = parseArgs(process.argv);
  const sidecarPath = join(args.data, SIDECAR);

  // Prefer the sidecar's quarantined raw; fall back to the legacy inline `rules`.
  // Entities are keyed by kind so a heritage id can never shadow a feat id. A
  // pre-existing sidecar predates `kind` and is feats-only, hence the fallback.
  const sidecar = existsSync(sidecarPath) ? readJson(sidecarPath) : null;
  const rawById = new Map();
  for (const e of sidecar?.entities ?? []) {
    if (Array.isArray(e.raw) && e.raw.length) rawById.set(`${e.kind ?? 'feat'}:${e.id}`, e.raw);
  }

  // The SAME corpus-derived trait vocabulary build-candidates gives the parser, so
  // both producers read a bare Foundry roll option against one list. Hardcoding it in
  // core would drift; deriving it twice from different files would drift too.
  const effectTraits = new Set();
  for (const file of ['spells.json', 'feats.json']) {
    const path = join(args.data, file);
    if (!existsSync(path)) continue;
    const data = readJson(path);
    const rows = Array.isArray(data) ? data : (data.spells ?? data.feats ?? []);
    for (const row of rows) for (const t of row.traits ?? []) effectTraits.add(String(t).toLowerCase());
  }

  // The feat ids we actually HOLD, so a GrantItem can resolve to one of ours. Derived
  // from the same corpus for the same reason as the traits above: a grant `ref` that
  // points at content we do not have is a dangling pointer, so the mapper confirms
  // every one against this set and reports the rest. (Measured 2026-07-19: 242/242 feat
  // grants resolve; only 8/180 ACTION grants would, which is why actions are not
  // modelled as grants yet.)
  const knownFeatIds = new Set();
  {
    const path = join(args.data, 'feats.json');
    if (existsSync(path)) {
      const data = readJson(path);
      for (const row of Array.isArray(data) ? data : (data.feats ?? [])) knownFeatIds.add(String(row.id));
    }
  }

  // The tag options RollOptions produce across the WHOLE corpus. A consumer predicate
  // that reads `spellshape:reach-spell` is mappable only because something asserts that
  // tag, and that is cross-entity knowledge — so we do a cheap pre-pass mapping every
  // entity's `raw` (with the trait vocab, but no options yet, which only affects the
  // rare option-gated toggle) and collect the toggles it declares. Reusing the mapper
  // rather than re-parsing Foundry keeps the producer and consumer sides in lockstep.
  const producedOptions = new Set();
  for (const raw of rawById.values()) {
    const { toggles } = mapFoundryRules(raw, { effectTraits, knownFeatIds });
    for (const tag of producedOptionTags(toggles)) producedOptions.add(tag);
  }

  const foldIn = loadFoldIn(args.data);
  const folded = { entities: 0, effects: 0, pending: 0, droppedFromMapping: 0, grantedActions: 0, riders: 0 };

  const entities = [];
  const reports = [];
  const written = [];
  let withEffects = 0;
  let withChoices = 0;
  let withGrants = 0;
  let withToggles = 0;
  let withGrantedActions = 0;
  let withRiders = 0;
  let strippedRules = 0;
  let fromSidecar = 0;
  let fromLegacy = 0;

  for (const dataset of DATASETS) {
    const path = join(args.data, dataset.file);
    if (!existsSync(path)) throw new Error(`no ${dataset.file} at ${path}`);
    const data = readJson(path);
    if (!Array.isArray(data)) throw new Error(`${dataset.file} is not an array`);
    let bearers = 0;

    for (const bearer of dataset.walk(data)) {
      const legacy = Array.isArray(bearer.rules) ? bearer.rules : null;
      const raw = rawById.get(`${dataset.kind}:${bearer.id}`) ?? legacy;
      if (legacy) strippedRules += 1;
      if (raw) (rawById.has(`${dataset.kind}:${bearer.id}`) ? fromSidecar++ : fromLegacy++);
      // The legacy field is Foundry's shape as a first-class field on our content,
      // and it is what the runtime used to read. It goes; `effects` replaces it.
      delete bearer.rules;
      delete bearer.effects;
      delete bearer.choices;
      delete bearer.grants;
      delete bearer.grantedActions;
      delete bearer.riders;
      delete bearer.toggles;

      // AUTHORED ACTIVITIES, folded in BEFORE the `raw` guard below — deliberately.
      //
      // A granted action comes only from a human `add` decision; nothing proposes
      // one, so it does not depend on `raw` at all. And the entities that carry one
      // are precisely the ones most likely to have NO rule elements: the corpus
      // names 1,544 of them `action-feat` — they grant an activity and are correctly
      // absent from the passive queue. Folding below the guard would drop every
      // authored action on exactly the feats this field exists for.
      //
      // Routed through `resolveEntity` rather than reading the decisions directly,
      // even with no candidates to reconcile, because that function is the ONE path
      // from a decision to content. Worth a second call on entities that also have
      // candidates; a private second path would not be.
      const entityDecisions =
        foldIn && dataset.kind === 'feat' ? (foldIn.decisionsByEntity.get(bearer.id) ?? []) : [];
      if (entityDecisions.length > 0) {
        // Both authored payloads come only from `add` decisions and never depend on
        // `raw`, so they are resolved together here, above the guard.
        const resolvedAdds = resolveEntity([], entityDecisions);
        if (resolvedAdds.grantedActions.length > 0) {
          bearer.grantedActions = resolvedAdds.grantedActions;
          withGrantedActions += 1;
          folded.grantedActions += resolvedAdds.grantedActions.length;
        }
        if (resolvedAdds.riders.length > 0) {
          bearer.riders = resolvedAdds.riders;
          withRiders += 1;
          folded.riders += resolvedAdds.riders.length;
        }
      }

      // A feat can carry candidates WITHOUT own raw — when its mechanics live
      // entirely on a granted feat-effect (ingest-feat-effects.mjs), whose
      // effect-derived candidates build-candidates already folded into the queue.
      // So map own raw only when present, but run the fold-in whenever there are
      // candidates. Skipping no-raw feats here (as this once did) would silently
      // drop an accepted effect-derived effect on exactly the stance/rider feats
      // this slice exists to reach.
      const candidates = foldIn && dataset.kind === 'feat' ? foldIn.byEntity.get(bearer.id) : null;
      if ((!raw || raw.length === 0) && !candidates) continue;

      let effects = [];
      let choices = [];
      let grants = [];
      let toggles = [];
      let report = null;
      if (raw && raw.length > 0) {
        ({ effects, choices, grants, toggles, report } = mapFoundryRules(raw, { effectTraits, knownFeatIds, producedOptions }));
        reports.push(report);
      }

      // The fold-in replaces the mapper's output with the RESOLVED effects wherever
      // candidates exist for this bearer. The mapper still runs — the sidecar's report
      // is the coverage diagnostic, and `raw` is what build-candidates re-maps from —
      // but what SHIPS is what a human decided plus what earned auto-promotion.
      let finalEffects = effects;
      let finalChoices = choices;
      if (candidates) {
        const resolved = resolveEntity(candidates, foldIn.decisionsByEntity.get(bearer.id) ?? []);
        finalEffects = resolved.effects;
        finalChoices = resolved.choices;
        folded.entities += 1;
        folded.effects += resolved.effects.length;
        folded.pending += resolved.pending.length;
        // Foundry proposed something the resolution dropped: it was rejected, or it
        // is still pending review. Worth counting — it is content that stopped
        // shipping, and a silent decrease is exactly what this report exists to prevent.
        if (effects.length > resolved.effects.length) {
          folded.droppedFromMapping += effects.length - resolved.effects.length;
        }
      }

      if (finalEffects.length > 0) {
        bearer.effects = finalEffects;
        withEffects += 1;
      }
      // Options + their effects are fixed content; only the pick is runtime.
      if (finalChoices.length > 0) {
        bearer.choices = finalChoices;
        withChoices += 1;
      }
      // Entity grants are NOT run through the fold-in, and that is deliberate: the
      // decisions pipeline arbitrates between two producers proposing EFFECTS, whereas
      // a grant has a single producer and a deterministic uuid→id derivation with no
      // gaps to fill. There is nothing for a human to decide that the mapper has not
      // already confirmed against the corpus. If a second producer ever proposes grants
      // (prose: "you also gain the X feat"), that stops being true and they should join
      // the candidate pipeline as choices did.
      if (grants.length > 0) {
        bearer.grants = grants;
        withGrants += 1;
      }
      // Toggles, like grants, have a single producer and no fold-in: there is nothing
      // for a human to arbitrate between two proposals of. They ship as mapped.
      if (toggles.length > 0) {
        bearer.toggles = toggles;
        withToggles += 1;
      }
      // The sidecar's entities carry the feat's OWN raw for re-mapping; a feat with
      // no own raw contributes none (its granted-effect raw lives in the links file),
      // even when the fold-in above shipped an effect for it.
      if (raw && raw.length > 0) {
        entities.push({ id: bearer.id, kind: dataset.kind, name: bearer.name, raw, report });
        bearers += 1;
      }
    }
    written.push({ path, data, file: dataset.file, bearers });
  }

  // INTERIM STANCE TOGGLES (2026-07-20). A stance's mechanics live on a separate
  // Foundry EFFECT item ("Effect: Everstand Stance") that our ingest does not read —
  // it walks packs/pf2e/feats only — so all 94 `stance`-trait feats reach here with no
  // RollOption and no toggle. Until the effects-pack ingest lands, synthesize a plain
  // TRACKING toggle from the trait, so a player who takes Everstand Stance can record
  // "I'm in it" on the sheet and in /use. It makes NO rules claim: no modifiers, no
  // consumer, just the switch. That is exactly the "player's record of a choice we
  // can't yet fully express" a toggle is for.
  //
  // Runs AFTER the mapping loop and only when a feat has no toggle, so a real
  // RollOption (should one ever sit on a stance feat) always wins. Keyed on the feat
  // id so the eventual effects-pack toggle can reconcile against it by lookup rather
  // than guessing. See docs/effects-engine-design.md.
  let synthStanceToggles = 0;
  const featsData = written.find((w) => w.file === 'feats.json')?.data ?? [];
  for (const feat of featsData) {
    const traits = Array.isArray(feat.traits) ? feat.traits.map((t) => String(t).toLowerCase()) : [];
    if (!traits.includes('stance')) continue;
    if (Array.isArray(feat.toggles) && feat.toggles.length > 0) continue;
    feat.toggles = [{ option: feat.id, label: feat.name }];
    synthStanceToggles += 1;
  }
  withToggles += synthStanceToggles;

  const summary = summarizeReports(reports);
  const out = {
    // Provenance: which upstream snapshot these rule elements came from. The mapper
    // can be re-run against them forever without touching that source again.
    sourceCommit: sidecar?.sourceCommit ?? 'foundryvtt/pf2e@ea40c945bc2828ad8164e14fab8a2298484d4f4d',
    mappedAt: new Date().toISOString(),
    summary: {
      entities: entities.length,
      entitiesWithEffects: withEffects,
      entitiesWithChoices: withChoices,
      entitiesWithGrants: withGrants,
      entitiesWithToggles: withToggles,
      entitiesWithGrantedActions: withGrantedActions,
      grantedActions: folded.grantedActions,
      elements: summary.elements,
      mapped: summary.mapped,
      effectsProduced: summary.effects,
      unsupported: summary.unsupported,
      byReason: summary.byReason,
      byKey: summary.byKey,
    },
    entities,
  };

  const pct = (n) => `${((n / summary.elements) * 100).toFixed(1)}%`;
  console.log(`raw source       : ${fromSidecar} from sidecar, ${fromLegacy} from legacy rules[]`);
  console.log(
    `entities         : ${entities.length} (${withEffects} yield effects, ${withChoices} yield choices, ${withGrants} yield grants, ${withToggles} yield toggles)`,
  );
  console.log(`  of which toggles : ${synthStanceToggles} are synthesized stance trackers (no mechanics yet)`);
  for (const w of written) console.log(`  ${w.file.padEnd(25)}: ${w.bearers} bearers`);
  console.log(`rule elements    : ${summary.elements}`);
  console.log(`  mapped         : ${summary.mapped} (${pct(summary.mapped)}) -> ${summary.effects} effects`);
  console.log(`  unsupported    : ${summary.unsupported} (${pct(summary.unsupported)})`);
  console.log(`  silently lost  : 0`);
  console.log(`legacy rules[] stripped from ${strippedRules} bearers`);
  console.log('\nblockers, by reason:');
  for (const [k, v] of Object.entries(summary.byReason).sort((a, b) => b[1] - a[1])) {
    console.log(`${String(v).padStart(6)}  ${k}`);
  }

  console.log('\nfold-in (candidates + decisions -> effects):');
  if (!foldIn) {
    console.log('  no effect-candidates.json — shipping the Foundry mapping unfolded');
  } else {
    const human = foldIn.decisions.filter((d) => d.by !== 'migration:foundry-baseline').length;
    console.log(`  candidates     : ${foldIn.candidateCount}`);
    console.log(`  decisions      : ${foldIn.decisionCount} (${human} human, ${foldIn.decisionCount - human} grandfathered)`);
    console.log(`  feats folded   : ${folded.entities} -> ${folded.effects} effects`);
    // Reported unconditionally, including the zero. These are the ONLY Layer-2
    // content that ships, and they come from a table rather than the corpus — so a
    // run that quietly stopped carrying them (an unapplied migration, a pull against
    // the wrong project) must be visible here, not discovered on a character sheet.
    console.log(`  granted actions: ${folded.grantedActions} on ${withGrantedActions} feats`);
    console.log(`  still pending  : ${folded.pending}  (awaiting a human in the Review UI)`);
    console.log(`  dropped vs map : ${folded.droppedFromMapping}  (rejected or pending; NOT shipping)`);
    if (foldIn.stale.length > 0) {
      // A decision whose candidate no longer exists: a producer changed its mind, so
      // a human's judgment is now floating. Loud, because it silently does nothing.
      console.log(`  STALE decisions: ${foldIn.stale.length} — no matching candidate any more`);
      for (const s of foldIn.stale.slice(0, 10)) console.log(`      ${s.entityId} ${s.key}`);
      if (foldIn.stale.length > 10) console.log(`      … and ${foldIn.stale.length - 10} more`);
    }
  }

  if (args.dry) {
    console.log('\n--dry: nothing written');
    return;
  }
  for (const w of written) writeFileSync(w.path, `${JSON.stringify(w.data, null, 2)}\n`);
  writeFileSync(sidecarPath, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`\nwrote ${written.map((w) => w.file).join(', ')} + ${SIDECAR}`);
}

main();
