#!/usr/bin/env node
/**
 * The trichotomy scoping pass (action-feats handoff, step 1).
 *
 * A DIAGNOSTIC, not a decision. It reads every action-feat's OWN rules text
 * (`feats.json` — a licensed source, never model memory) plus the producer
 * signals we already hold (`effect-candidates.json`), and PROPOSES which of the
 * three buckets each feat belongs to:
 *
 *   (c) strike-rider   — the feat's action IS or modifies a Strike ("Make a
 *                        melee Strike. If you hit…"). Intimidating Strike.
 *   (b) bespoke        — an opt-in activity of its own (a skill check, a save
 *                        effect, a spell, a stance/buff). Blessing of the Five.
 *   (a) keep-passive   — an always-on modifier the pipeline already caught as a
 *                        scoped-strike passive ("when you Strike, +1 damage");
 *                        auto-applies, no action spent to trigger it.
 *
 * WHY A SCOPING PASS COMES FIRST (handoff): the split tells us how much authoring
 * each downstream slice needs — do NOT build authoring UI before you can classify.
 * And WHY A PROPOSAL, not a ruling: prose signals are exactly what the review
 * pipeline distrusts enough to put a human in the loop, so every row carries the
 * SIGNAL that drove it and a confidence, and the owner confirms. Nothing here
 * writes content or a decision.
 *
 * NO PF2e RULES MATH. It classifies by structural text signals ("does the feat
 * say 'make a Strike'"), computes no bonus or DC, and makes no rules claim beyond
 * "this reads like a rider / an activity / a passive — confirm."
 *
 * USAGE:
 *   node scripts/classify-action-feats.mjs [--data <dir>] [--out <dir>] [--dry]
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_DIR_DEFAULT = resolve(HERE, '..', 'src', 'features', 'builder', 'data');
const OUT_DIR_DEFAULT = resolve(HERE, '..', '..', '..', 'docs');
const FEATS = 'feats.json';
const CANDIDATES = 'effect-candidates.json';

function parseArgs(argv) {
  const out = { data: DATA_DIR_DEFAULT, outDir: OUT_DIR_DEFAULT, dry: false };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--data') out.data = resolve(argv[++i]);
    else if (argv[i] === '--out') out.outDir = resolve(argv[++i]);
    else if (argv[i] === '--dry') out.dry = true;
  }
  return out;
}

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

// ── source-text cleanup ──────────────────────────────────────────────────────
// The descriptions carry Foundry markup (@UUID[…]{…}, @Damage[…], [[/act …]]) and
// bold labels (**Effect**). Strip them so the signal regexes read prose, not syntax.
function cleanText(desc) {
  return String(desc ?? '')
    .replace(/@[A-Za-z]+\[[^\]]*\](?:\{[^}]*\})?/g, ' ') // @UUID[…]{Label}, @Damage[…]
    .replace(/\[\[[^\]]*\]\]/g, ' ')                      // [[/act grapple]]
    .replace(/\*\*[^*]*\*\*/g, ' ')                       // **Effect**, **Trigger**
    .replace(/[—–-]{2,}/g, ' ')                           // --- separators
    .replace(/\s+/g, ' ')
    .trim();
}

// ── the signals (structural, from the feat's own text) ───────────────────────

// The action IS or modifies a Strike — the rider signal. Deliberately anchored on
// the IMPERATIVE "make … Strike(s)" (the action the feat tells you to take) and a
// few explicit "your/this Strike" riders, NOT any mention of the word: plenty of
// bespoke actions reference strikes incidentally ("gain a bonus to your next…").
const STRIKE_ACTION = [
  /\bmake\s+(?:a|an|one|two|three|another|your|the)\b[\w\s,'"-]{0,28}?\bstrikes?\b/i,
  /\bmakes?\s+(?:a|an|one|two|three)\s+strikes?\b/i,
  /\byour\s+(?:next|last)\s+strikes?\b/i,
  /\bwhen\s+you\s+(?:next\s+)?strike\b/i,
  /\bas\s+part\s+of\s+(?:a|the|this|your)?\s*strikes?\b/i,
  /\binstead\s+of\s+(?:a|the|your)?\s*strikes?\b/i,
];

// A producer already read an auto-applying attack/damage/strike modifier — the
// shape of an always-on rider (category a). `attack`, `damage`, `damage:strike`,
// `attack:strike:melee`, `damage:unarmed`, …
const SCOPED_STRIKE_TARGET = /^(?:attack|damage)(?::|$)|(?::strike|:unarmed)(?::|$)/i;

// A self-contained activity verb — corroborates "bespoke" when there is no Strike.
// Not used to override the Strike/scoped signals; only to raise confidence. Broad
// on purpose: it spans PF2e's basic actions (Interact, Stride, Repair, Recall…),
// its common effect verbs (gain, deal, become, restore…), and plain motion/attack
// verbs, so "low confidence" lands on genuinely thin text rather than on a verb the
// list happened to omit.
const ACTIVITY_VERB = new RegExp(
  '\\b(' + [
    'cast', 'attempt', 'roll', 'choose', 'command', 'conjure', 'summon', 'activate',
    'gain', 'grant', 'create', 'regain', 'restore', 'heal',
    'step', 'stride', 'leap', 'jump', 'move', 'fly', 'glide', 'climb', 'swim', 'burrow', 'crawl',
    'interact', 'repair', 'recall', 'demoralize', 'feint', 'hide', 'sneak', 'seek', 'escape', 'delay',
    'shoot', 'throw', 'hurl', 'launch', 'deal', 'take', 'reduce', 'increase',
    'grab', 'push', 'pull', 'knock', 'trip', 'shove', 'disarm', 'disable', 'grapple',
    'lie', 'pretend', 'emit', 'send', 'blind', 'dazzle', 'sicken', 'frighten',
    'drink', 'eat', 'apply', 'reroll', 'spend', 'enter', 'become', 'you can',
  ].join('|') + ')\\b', 'i',
);

// A proper action stat-block — a Trigger/Frequency/Requirements/degree ladder in
// the RAW (unstripped) text — is a well-formed action even when its effect verb is
// unusual. Reactions especially read as "thin" once the Trigger is stripped.
const HAS_STRUCTURE = /\*\*(Trigger|Frequency|Requirements|Effect|Critical Success|Success|Critical Failure)\*\*/i;

function signalsFor(feat, prod) {
  const raw = String(feat.description ?? '');
  const text = cleanText(raw);
  const strikeAction = STRIKE_ACTION.some((re) => re.test(text));
  const scopedStrike = (prod?.targets ?? []).some((t) => SCOPED_STRIKE_TARGET.test(String(t)));
  const activityVerb = ACTIVITY_VERB.test(text) || HAS_STRUCTURE.test(raw);
  return { text, strikeAction, scopedStrike, activityVerb };
}

// ── the classifier (proposes a bucket + why + confidence) ────────────────────

const BUCKET = {
  RIDER: 'strike-rider',       // (c)
  BESPOKE: 'bespoke-activity', // (b)
  PASSIVE: 'keep-passive',     // (a)
};

/**
 * Propose a bucket for one action-feat. Pure. Returns
 * `{ bucket, signal, confidence, flags }`.
 *
 * Precedence encodes the handoff's own distinction: an IMPERATIVE "make a Strike"
 * is the action itself, so it is a rider even when a passive was also read; a
 * scoped-strike modifier with NO such imperative is the always-on shape, so it is
 * the keep-passive candidate; everything else with an action cost is a bespoke
 * activity. Ambiguity (both an imperative and a scoped passive; or no clear signal
 * at all) is FLAGGED, never silently resolved.
 */
export function classifyActionFeat(feat, prod) {
  const s = signalsFor(feat, prod);
  const flags = [];

  if (s.strikeAction && s.scopedStrike) {
    flags.push('both an imperative Strike and an auto-applying strike modifier — is the modifier the rider itself, or a separate always-on passive?');
  }

  if (s.strikeAction) {
    return { bucket: BUCKET.RIDER, signal: 'imperative "make … Strike" in the rules text', confidence: 'high', flags };
  }
  if (s.scopedStrike) {
    return {
      bucket: BUCKET.PASSIVE,
      signal: 'a producer read an auto-applying attack/damage modifier, with no imperative Strike',
      confidence: 'medium',
      flags,
    };
  }
  // No Strike signal → an activity of its own. Confidence rises when the text
  // carries a clear activity verb; a terse description with none is worth a look.
  const confidence = s.activityVerb ? 'high' : 'low';
  if (confidence === 'low') flags.push('no Strike reference and no clear activity verb — verify it is an action at all, not a mis-costed passive');
  return { bucket: BUCKET.BESPOKE, signal: s.activityVerb ? 'an action cost with a self-contained activity verb, no Strike' : 'an action cost, no Strike and no clear activity verb', confidence, flags };
}

// ── run ──────────────────────────────────────────────────────────────────────

function main() {
  const args = parseArgs(process.argv);
  const feats = readJson(join(args.data, FEATS));
  const cand = readJson(join(args.data, CANDIDATES));

  const featById = new Map(feats.map((f) => [f.id, f]));
  const inQueue = new Set(cand.actionFeatsInQueue ?? []);
  // Per-entity producer signals: the set of candidate targets, for the scoped check.
  const targetsByEntity = new Map();
  for (const c of cand.candidates ?? []) {
    if (!targetsByEntity.has(c.entityId)) targetsByEntity.set(c.entityId, []);
    if (c.draft?.target) targetsByEntity.get(c.entityId).push(c.draft.target);
  }
  const silentActionCost = new Map(
    (cand.silent ?? []).filter((s) => s.reason === 'action-feat').map((s) => [s.entityId, s.actionCost]),
  );

  // The action-feat corpus: every feat that carries an action cost.
  const actionFeats = feats.filter((f) => f.actionCost !== undefined && f.actionCost !== null && f.actionCost !== '');

  const rows = actionFeats.map((f) => {
    const prod = { targets: targetsByEntity.get(f.id) ?? [] };
    const c = classifyActionFeat(f, prod);
    const source = inQueue.has(f.id) ? 'in-queue' : silentActionCost.has(f.id) ? 'silent' : 'other';
    return {
      id: f.id,
      name: f.name,
      actionCost: f.actionCost,
      traits: f.traits ?? [],
      source,
      hasCandidates: (targetsByEntity.get(f.id)?.length ?? 0) > 0,
      scopedStrike: prod.targets.some((t) => SCOPED_STRIKE_TARGET.test(String(t))),
      ...c,
    };
  });

  // ── self-check against hand-eyeballed goldens (from the sampled descriptions).
  // A cheap guard that the signals still classify the obvious cases the way a human
  // read them; a mismatch is printed, not thrown, so the report still generates.
  const GOLDENS = {
    'intimidating-strike': BUCKET.RIDER,
    'shackles-of-law': BUCKET.RIDER,
    'combat-assessment': BUCKET.RIDER,
    'spiritual-disruption': BUCKET.RIDER,
    'blessing-of-the-five': BUCKET.BESPOKE,
    'battle-medicine': BUCKET.BESPOKE,
    'bon-mot': BUCKET.BESPOKE,
    'aerial-boomerang': BUCKET.BESPOKE,
  };
  const byId = new Map(rows.map((r) => [r.id, r]));
  const mismatches = [];
  for (const [id, want] of Object.entries(GOLDENS)) {
    const got = byId.get(id);
    if (!got) { mismatches.push(`${id}: not in action-feat set (id changed?)`); continue; }
    if (got.bucket !== want) mismatches.push(`${id}: expected ${want}, got ${got.bucket} (${got.signal})`);
  }

  // ── aggregate.
  const tally = (pred) => rows.filter(pred).length;
  const buckets = [BUCKET.RIDER, BUCKET.BESPOKE, BUCKET.PASSIVE];
  const summary = {
    generatedAt: 'unstamped', // scripts here avoid Date.now() for reproducibility
    corpus: rows.length,
    byBucket: Object.fromEntries(buckets.map((b) => [b, tally((r) => r.bucket === b)])),
    byBucketAndSource: Object.fromEntries(
      buckets.map((b) => [b, {
        silent: tally((r) => r.bucket === b && r.source === 'silent'),
        inQueue: tally((r) => r.bucket === b && r.source === 'in-queue'),
      }]),
    ),
    lowConfidence: tally((r) => r.confidence === 'low'),
    flagged: tally((r) => r.flags.length > 0),
    scopedStrikePassives: tally((r) => r.scopedStrike),
  };

  const report = { note: 'PROPOSAL from source-text signals — confirm before acting. See classify-action-feats.mjs.', summary, rows };

  // ── human-readable digest.
  const md = renderMd(summary, rows, mismatches);

  console.log(md);
  if (mismatches.length) {
    console.log('\n⚠️  golden self-check mismatches:');
    for (const m of mismatches) console.log('   •', m);
  }

  if (args.dry) { console.log('\n--dry: nothing written'); return; }
  if (!existsSync(args.outDir)) mkdirSync(args.outDir, { recursive: true });
  writeFileSync(join(args.outDir, 'action-feats-classification.json'), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(join(args.outDir, 'action-feats-classification.md'), md);
  console.log(`\nWrote action-feats-classification.{json,md} to ${args.outDir}`);
}

function renderMd(summary, rows, mismatches) {
  const pct = (n) => `${((n / summary.corpus) * 100).toFixed(1)}%`;
  const fmtRows = (rs) => rs.slice(0, 8).map((r) => `  - **${r.name}** \`[${r.actionCost}]\` — _${r.signal}_`).join('\n');
  // Prefer high-confidence examples; fall back to any (the keep-passive bucket is
  // medium-confidence by construction, so it would otherwise render blank).
  const examples = (bucket) => {
    const inBucket = rows.filter((r) => r.bucket === bucket);
    const high = inBucket.filter((r) => r.confidence === 'high');
    return fmtRows(high.length ? high : inBucket);
  };

  const L = [];
  L.push('# Action-feats — trichotomy classification (PROPOSAL)');
  L.push('');
  L.push('> Generated by `apps/web/scripts/classify-action-feats.mjs` from each feat\'s own');
  L.push('> rules text (`feats.json`) + producer signals (`effect-candidates.json`). Every');
  L.push('> row is a **proposal driven by a named signal**, not a ruling — confirm before');
  L.push('> authoring. No PF2e rules math; no content or decision is written.');
  L.push('');
  L.push(`**Corpus:** ${summary.corpus} action-feats (every feat carrying an action cost).`);
  L.push('');
  L.push('## The three buckets');
  L.push('');
  L.push('| bucket | count | share | silent | in-queue |');
  L.push('|---|---:|---:|---:|---:|');
  for (const b of Object.keys(summary.byBucket)) {
    const s = summary.byBucketAndSource[b];
    L.push(`| ${b} | ${summary.byBucket[b]} | ${pct(summary.byBucket[b])} | ${s.silent} | ${s.inQueue} |`);
  }
  L.push('');
  L.push('- **strike-rider (c)** — the feat\'s action is or modifies a Strike. These compose onto a base Strike tree (step 5); until then, author as bespoke actions or scoped passives.');
  L.push('- **bespoke-activity (b)** — an opt-in activity of its own. Author via `addGrantedAction` (the authoring UI exists).');
  L.push('- **keep-passive (a)** — an always-on scoped-strike modifier a producer already read. Accept the passive; no action needed.');
  L.push('');
  L.push('## Where a human is needed');
  L.push('');
  L.push(`- **${summary.flagged}** rows carry a **flag** (genuine ambiguity — e.g. both an imperative Strike and an auto-applying modifier).`);
  L.push(`- **${summary.lowConfidence}** rows are **low-confidence** (no Strike and no clear activity verb — verify they are actions at all).`);
  L.push(`- **${summary.scopedStrikePassives}** carry an auto-applying attack/damage modifier the pipeline already extracted.`);
  L.push('');
  L.push('## Examples per bucket');
  L.push('');
  for (const b of Object.keys(summary.byBucket)) {
    L.push(`### ${b}`);
    L.push(examples(b) || '  _(none)_');
    L.push('');
  }
  L.push('## Flagged / low-confidence — the review shortlist');
  L.push('');
  const shortlist = rows.filter((r) => r.flags.length > 0 || r.confidence === 'low').slice(0, 30);
  for (const r of shortlist) {
    L.push(`- **${r.name}** \`[${r.actionCost}]\` (${r.bucket}, ${r.confidence}) — ${r.flags.join('; ') || r.signal}`);
  }
  if (mismatches.length === 0) L.push('\n_Golden self-check: all 8 hand-eyeballed feats classified as expected._');
  L.push('');
  return L.join('\n');
}

main();
