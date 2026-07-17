// The prose parser — a PRODUCER for the candidate/review model (candidate.ts),
// sibling to foundry.ts. It reads PF2e rules PROSE and proposes effects.
//
// WHY PROSE IS THE PRIMARY PRODUCER (docs/effects-engine-design.md, the prose pivot):
//   • It strictly contains MORE than Foundry's rule elements — Adroit Manipulation's
//     text carries a "(or another skill…)" fallback that its single rule element drops.
//   • It is licence-clean and source-agnostic: the same parser runs on AoN prose today
//     and Paizo's ORC release later. Foundry's encodings are Foundry's own work.
//   • Foundry stays as a CORROBORATOR — human-authored, high precision / low recall;
//     the parser is the inverse. Two independent derivations agreeing is evidence, and
//     a disagreement is the most informative thing in the review queue.
//
// WHAT IT EMITS, AND WHAT IT MUST NEVER EMIT. This module produces DRAFT effects with
// GAPS (candidate.ts's `DraftEffect` + `Gap`), never a `PassiveEffect`. A guess is
// structurally incapable of reaching a sheet — promotion happens elsewhere, behind the
// schema and a human. So the parser is FREE to guess, and its job is to guess honestly:
// extract what it is sure of, and mark what it is not as a gap for a human to resolve.
//
// NO PF2e RULES LIVE HERE. It maps English onto our effect vocabulary; the rules are in
// passive.ts / the degree resolver / etc., each from pasted source text. Nothing here is
// remembered PF2e — an extractor that reads "expert in Medicine" as a rank grant is doing
// English, not adjudicating a rule.
//
// MEASURED, NOT ASSUMED. Every design choice below is backed by a probe over the real
// 6,116-feat corpus (see scripts/prose-recall.mjs). The numbers in the comments are from
// that probe; rerun it after any change.

// ---------------------------------------------------------------------------
// 1. normalization — flatten the description to clause-segmentable plain text
// ---------------------------------------------------------------------------
//
// The ingested descriptions are ALREADY free of HTML and `@UUID[...]{label}` macros
// (the ingest flattened them). What remains, measured over the corpus:
//   • markdown structure — `**Effect**` / `**Frequency**` headers (2,259 feats),
//     `---` section rules (2,087), `\n\n` paragraph breaks (3,195).
//   • Foundry roll debris — `[[/act grapple]]` inline rolls (137), `(@actor.system…)`
//     formula fragments and their unbalanced `)))` tails (25), `{label}` remnants (58).
//
// The debris is pure noise for a prose reader and actively breaks governor detection
// (a stray `)))` mid-sentence splits a clause wrongly), so it is stripped. The markdown
// structure is SEMANTIC — a `---` or a header is a hard clause boundary, so a sentence
// never runs across it — and is converted to boundary markers, not discarded silently.

/** A hard boundary the segmenter must not cross (section rules, headers, paragraphs). */
const BOUNDARY = "␞"; // ␞ record separator — a char that cannot occur in prose

function normalize(raw: string): string {
  let s = String(raw ?? "");

  // Foundry inline rolls: `[[/act grapple]]`, `[[/r 1d6]]`, optionally `{label}` after.
  // Keep the label when present (it's real prose, e.g. "{Acrobatics} check"); else drop.
  s = s.replace(/\[\[[^\]]*\]\](?:\{([^}]*)\})?/g, (_m, label) => label ?? " ");

  // Foundry formula fragments: `(@actor.system.skills.medicine.rank - 2)` and the
  // `(ceil(@actor.level / 2))d4` family, including the unbalanced `)))` tails they leave.
  // Anything containing an @-ref inside parens is a formula, not prose — blank it.
  s = s.replace(/\(+[^()]*@(?:actor|item)\.[^()]*\)+/g, " ");
  s = s.replace(/@(?:actor|item)\.[\w.]+/g, " "); // any stragglers
  s = s.replace(/\){2,}|\({2,}/g, " "); // orphaned paren runs left behind

  // Markdown structure → boundary markers.
  s = s.replace(/^\s*-{3,}\s*$/gm, BOUNDARY); // `---` horizontal rules (own line)
  s = s.replace(/\*\*([^*]+)\*\*/g, `${BOUNDARY}$1:${BOUNDARY}`); // **Header** → boundaried label
  s = s.replace(/[*_`]/g, " "); // any remaining markdown emphasis chars
  s = s.replace(/\r\n?/g, "\n").replace(/\n{2,}/g, BOUNDARY); // paragraph breaks
  s = s.replace(/\n/g, " "); // soft single newlines are just spaces

  // Leftover `{label}` remnants (58 feats) — keep the inside, it's usually a real word.
  s = s.replace(/\{([^}]*)\}/g, "$1");

  // Collapse whitespace WITHIN segments, but preserve the boundary markers.
  s = s
    .split(BOUNDARY)
    .map((seg) => seg.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(BOUNDARY);
  return s;
}

// ---------------------------------------------------------------------------
// 2. clause segmentation
// ---------------------------------------------------------------------------
//
// Effects are extracted at the CLAUSE level, never the sentence (design doc: 96% of
// sentence templates are one-offs; the same effects collapse to 57 shapes). A clause is
// the unit a governor scopes over — "you become an expert in Medicine" is a grant;
// "the healing increases by 10 when you are legendary in Medicine" is one sentence with
// TWO clauses, and only the second carries the rank phrase, under a condition.
//
// We split on sentence terminators AND on the boundary markers from normalization, then
// (crucially) on subordinating conjunctions, so a governor and the phrase it scopes land
// in DIFFERENT clauses. The conjunction stays attached to its clause as the governor.

/** Subordinating conjunctions that turn a following phrase into a condition, not a grant. */
const GOVERNORS = ["when", "whenever", "while", "if", "unless", "until", "after", "before", "as long as"] as const;
export type Governor = (typeof GOVERNORS)[number];

export interface Clause {
  /** The clause text, trimmed. */
  text: string;
  /** The subordinating conjunction that introduces it, if any — the Lepidstadt gate. */
  governor?: Governor;
  /** Character offset of `text` in the ORIGINAL (post-normalization) string, for evidence spans. */
  start: number;
  end: number;
}

const GOV_RE = new RegExp(`\\b(${GOVERNORS.join("|")})\\b`, "gi");

/**
 * Split normalized prose into governed clauses. Boundaries: sentence terminators, the
 * normalization markers, and subordinating conjunctions (which begin a new, governed
 * clause). Offsets are into the normalized string so evidence spans stay meaningful.
 */
export function segment(normalized: string): Clause[] {
  const clauses: Clause[] = [];

  // First split on hard boundaries: markers, and sentence-final punctuation followed by
  // a space. Keep it simple and conservative — over-splitting is safe here (each piece is
  // still checked for a phrase), under-splitting is what causes a governor to be missed.
  const hardParts: { text: string; start: number }[] = [];
  let cursor = 0;
  const hardRe = /[.;:!?]\s+|␞/g;
  let m: RegExpExecArray | null;
  while ((m = hardRe.exec(normalized))) {
    const piece = normalized.slice(cursor, m.index + (m[0] === BOUNDARY ? 0 : 1));
    if (piece.trim()) hardParts.push({ text: piece, start: cursor });
    cursor = hardRe.lastIndex;
  }
  if (cursor < normalized.length) {
    const tail = normalized.slice(cursor);
    if (tail.trim()) hardParts.push({ text: tail, start: cursor });
  }

  // Then split each sentence on subordinating conjunctions. The conjunction opens a new
  // clause and becomes its governor; the text before it is its own (ungoverned) clause.
  for (const part of hardParts) {
    GOV_RE.lastIndex = 0;
    let last = 0;
    let currentGov: Governor | undefined;
    const pushes: { text: string; governor?: Governor; offset: number }[] = [];
    let g: RegExpExecArray | null;
    while ((g = GOV_RE.exec(part.text))) {
      const before = part.text.slice(last, g.index);
      if (before.trim()) pushes.push({ text: before, governor: currentGov, offset: last });
      currentGov = g[1]!.toLowerCase() as Governor;
      last = g.index + g[0].length;
    }
    const tail = part.text.slice(last);
    if (tail.trim()) pushes.push({ text: tail, governor: currentGov, offset: last });

    for (const p of pushes) {
      const rawText = p.text;
      const leadTrim = rawText.length - rawText.trimStart().length;
      const text = rawText.trim();
      const start = part.start + p.offset + leadTrim;
      clauses.push({
        text,
        ...(p.governor ? { governor: p.governor } : {}),
        start,
        end: start + text.length,
      });
    }
  }
  return clauses;
}

// ---------------------------------------------------------------------------
// 3. the parse entry point + the extractor framework
// ---------------------------------------------------------------------------

import type { DraftEffect, Gap, SourceProposals } from "./candidate.js";

/** One extracted proposal, before it is wrapped as a producer's `SourceProposals`. */
export interface Extraction {
  draft: DraftEffect;
  gaps: Gap[];
  /** The clause the extraction came from, for the evidence span. */
  span: { start: number; end: number; text: string };
}

/**
 * An extractor reads ONE clause and returns any effects it proposes. It receives the
 * clause's governor so it can decline (a rank phrase under `when` is a condition, not a
 * grant — the Lepidstadt trap) or emit a conditional draft with a gap. Pure and
 * self-contained: extractors do not see each other's output.
 */
export type Extractor = (clause: Clause) => Extraction[];

/** Parse a raw description into extractions. The producer wrapper is `parseProse`. */
export function extractFromProse(raw: string, extractors: readonly Extractor[]): Extraction[] {
  const clauses = segment(normalize(raw));
  const out: Extraction[] = [];
  for (const clause of clauses) {
    for (const extractor of extractors) out.push(...extractor(clause));
  }
  return out;
}

/**
 * The parser as a candidate.ts PRODUCER: raw description → `SourceProposals` ready for
 * `reconcile`. `source: "parser"` so Foundry's proposals corroborate or conflict with it.
 */
export function parseProse(raw: string, extractors: readonly Extractor[] = DEFAULT_EXTRACTORS): SourceProposals {
  return {
    source: "parser",
    proposals: extractFromProse(raw, extractors).map((e) => ({
      draft: e.draft,
      gaps: e.gaps,
      evidence: { span: e.span },
    })),
  };
}

// ---------------------------------------------------------------------------
// 4. the proficiency extractor (slice 1)
// ---------------------------------------------------------------------------
//
// MEASURED over the corpus vs Foundry's 216 proficiency grants (scripts/prose-recall.mjs):
// a naive "match a rank word + skill" reads 25 CONDITIONS as grants (the Lepidstadt trap)
// — every one under a `when`/`if` governor. The governor gate removes all 25. The recall
// ceiling is set by phrasing variety: real prose says "gain the trained proficiency rank
// IN Thievery", "are trained in Stealth", "become an expert in Medicine" — so the
// extractor keys on the SEMANTIC PIECES (a rank word, "in", a skill), never a sentence
// template, exactly as the probe findings require.

const RANK_WORDS: Record<string, 0 | 1 | 2 | 3 | 4> = {
  untrained: 0,
  trained: 1,
  expert: 2,
  master: 3,
  legendary: 4,
};

/** The 16 core skills, lowercased. A skill name is the extractor's semantic anchor. */
const SKILLS = new Set([
  "acrobatics", "arcana", "athletics", "crafting", "deception", "diplomacy",
  "intimidation", "medicine", "nature", "occultism", "performance", "religion",
  "society", "stealth", "survival", "thievery",
]);

// "<rank> in/of <Skill>", with a short window between them for "proficiency rank in".
//
// THE "from X to Y" TRAP (caught as a real conflict on Pactbinder Dedication): "increase
// your proficiency FROM trained TO expert in Diplomacy" grants EXPERT, not trained. The
// granted rank is the one after "to". So an optional `from <rank> to` prefix is consumed
// greedily, leaving the operative rank in the capture group. A plain "trained in Stealth"
// has no prefix and matches directly.
const PROF_RE =
  /\b(?:from\s+(?:untrained|trained|expert|master|legendary)\s+)?(?:to\s+)?(untrained|trained|expert|master|legendary)\b(?:\s+\w+){0,2}?\s+(?:in|of)\s+([A-Za-z]+)/gi;

/**
 * Extract proficiency-rank grants from a clause. Declines when the clause is governed by
 * a subordinating conjunction ("when you are legendary in Medicine" is a condition on
 * some OTHER effect, not a grant) — that gate is the Lepidstadt Surgeon regression.
 */
export const proficiencyExtractor: Extractor = (clause) => {
  // A governed clause's rank phrase is a CONDITION, not a grant. Emit nothing: it is not
  // a proficiency grant with a hole, it is a different effect (a conditional modifier),
  // and a gapped proficiency draft would pollute the queue with ~70 non-effects.
  if (clause.governor) return [];

  const out: Extraction[] = [];
  let m: RegExpExecArray | null;
  PROF_RE.lastIndex = 0;
  while ((m = PROF_RE.exec(clause.text))) {
    const rank = RANK_WORDS[m[1]!.toLowerCase()];
    const skill = m[2]!.toLowerCase();
    if (rank === undefined || !SKILLS.has(skill)) continue;
    out.push({
      draft: { kind: "proficiency", target: skill, rank, mode: "upgrade" },
      gaps: [],
      span: { start: clause.start, end: clause.end, text: clause.text },
    });
  }
  return out;
};

/** The default producer extractor set. Grows one family per slice. */
export const DEFAULT_EXTRACTORS: readonly Extractor[] = [proficiencyExtractor];
