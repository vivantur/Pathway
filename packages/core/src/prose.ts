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
  /**
   * A condition that FOLLOWS this clause in the same sentence: "you gain +1 … WHILE you
   * are raging" splits the modifier (here, ungoverned) from its trailing `while` clause.
   * A modifier conditioned by a trailing clause is still conditional, so the extractor
   * carries it as a gap rather than emitting an unconditional (wrong) draft.
   */
  trailingCondition?: string;
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

    for (let i = 0; i < pushes.length; i += 1) {
      const p = pushes[i]!;
      const rawText = p.text;
      const leadTrim = rawText.length - rawText.trimStart().length;
      const text = rawText.trim();
      const start = part.start + p.offset + leadTrim;
      // If the NEXT part of this sentence is governed, its condition scopes back onto this
      // (ungoverned) clause — "modifier … while condition".
      const next = pushes[i + 1];
      const trailing = !p.governor && next?.governor ? `${next.governor} ${next.text.trim()}`.trim() : undefined;
      clauses.push({
        text,
        ...(p.governor ? { governor: p.governor } : {}),
        ...(trailing ? { trailingCondition: trailing } : {}),
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
import type { Selector } from "./selectors.js";

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

// A CONJUNCTION of skills — the target of a compound grant. "Crafting and Survival",
// "Deception, Diplomacy, and Intimidation" (Oxford comma included). Joined ONLY by
// "and"/comma — a TRUE conjunction (grant all of them). "or" and "your choice of" are the
// CHOICE shape (grant ONE), a different slice, and are deliberately NOT chained: fanning a
// "pick one of four" into four grants is a wrong sheet, worse than the choice being missed.
// The alternation is the 16 real skill names, so the chain STOPS at the first non-skill
// word — "Intimidation and your choice of Arcana…" captures "Intimidation" only, because
// "your" is not a skill. That is what keeps a compound grant from swallowing a choice group.
const SKILL_ALT = [...SKILLS].join("|");
const SKILL_CONJ = String.raw`(?:\s*,\s*and\s+|\s*,\s*|\s+and\s+)`;
const SKILL_CHAIN = `(?:${SKILL_ALT})(?:${SKILL_CONJ}(?:${SKILL_ALT}))*`;
/** Split a matched chain back into its skills — the same connectors, "and" forms first. */
const SKILL_SPLIT = /\s*,\s*and\s+|\s*,\s*|\s+and\s+/i;

// "<rank> in/of <Skill chain>", with a short window between them for "proficiency rank in".
//
// THE "from X to Y" TRAP (caught as a real conflict on Pactbinder Dedication): "increase
// your proficiency FROM trained TO expert in Diplomacy" grants EXPERT, not trained. The
// granted rank is the one after "to". So an optional `from <rank> to` prefix is consumed
// greedily, leaving the operative rank in the capture group. A plain "trained in Stealth"
// has no prefix and matches directly.
//
// The skill capture is a CHAIN (`SKILL_CHAIN`), not one word, so "trained in Crafting and
// Survival" yields BOTH — the ancestry-Lore feats grant two skills, and single-word capture
// silently dropped the second (52 feats). `\b` after the chain rejects a skill embedded in a
// longer word.
const PROF_RE = new RegExp(
  String.raw`\b(?:from\s+(?:untrained|trained|expert|master|legendary)\s+)?(?:to\s+)?(untrained|trained|expert|master|legendary)\b(?:\s+\w+){0,2}?\s+(?:in|of)\s+(${SKILL_CHAIN})\b`,
  "gi",
);

/**
 * Extract proficiency-rank grants from a clause. Declines when the clause is governed by
 * a subordinating conjunction ("when you are legendary in Medicine" is a condition on
 * some OTHER effect, not a grant) — that gate is the Lepidstadt Surgeon regression. A
 * compound target ("Crafting and Survival") yields one draft per skill.
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
    if (rank === undefined) continue;
    for (const part of m[2]!.toLowerCase().split(SKILL_SPLIT)) {
      const skill = part.trim();
      if (!SKILLS.has(skill)) continue;
      out.push({
        draft: { kind: "proficiency", target: skill, rank, mode: "upgrade" },
        gaps: [],
        span: { start: clause.start, end: clause.end, text: clause.text },
      });
    }
  }
  return out;
};

// ---------------------------------------------------------------------------
// 5. the modifier extractor (slice 2)
// ---------------------------------------------------------------------------
//
// "+2 circumstance bonus to X" is the biggest single shape in the corpus: 915 phrases
// across 792 feats (probe). Three things the probe settled:
//   • The bonus TYPE is almost always stated (only 36/915 unstated) — read it, don't
//     guess it. circumstance 648 · status 201 · item 30.
//   • The VALUE is a plain integer here; "a bonus equal to your level" and friends are a
//     later slice, and fall through cleanly (the regex needs a digit).
//   • The TARGET is the whole game, and splits three ways — this is where the gap
//     machinery finally earns its place (design doc: ~24% of extractions know the value
//     and type but not the target). See `resolveTarget`.
//
// BROADLY EFFECTIVE, NOT EXHAUSTIVE (owner). We nail the high-frequency shapes and let the
// tail fall into GAPS for a human, never into wrong content. Chasing every one-off phrasing
// just breaks the common ones on the next feat.

const BONUS_TYPES = new Set(["circumstance", "status", "item", "untyped"]);

// "+2 circumstance bonus to X" / "a status bonus on X" / "take a –2 penalty to X, Y, and
// Z". The value is optional-signed; the type is optional (defaults untyped). The target
// run allows internal commas + and/or so a COMPOUND list is captured whole; it stops at a
// hard boundary or a scope/condition keyword, so a duration, condition, or following clause
// is not swallowed. `and`/`or`/`,` are list separators, NOT stops.
const MOD_RE =
  /([+-]?\d+)\s+(circumstance|status|item|untyped)?\s*(bonus|penalty)\s+(?:to|on)\s+([a-z][\w\s,'&/-]{0,80}?)(?=\s*(?:[.;:]|$|\b(?:when|if|while|until|unless|but|against|to|for|from|equal|on|made|instead)\b))/gi;

/** List separators inside a compound target: commas and and/or, incl. the Oxford ", and". */
const LIST_SEP = /\s*(?:,|\band\b|\bor\b)\s*/i;

/**
 * The target-resolution vocabulary: a phrase (after stripping articles/possessives and
 * "check"/"roll"/"dc"/"save" noise) → the read selector(s) it means. A plural/general
 * class fans out to every stat it covers, exactly as Foundry's broadcast selectors do at
 * ingest — which is also what makes the two producers corroborate on "+1 to all saves".
 */
const TARGET_MAP: Record<string, Selector[]> = {
  ac: ["ac"],
  "armor class": ["ac"],
  perception: ["perception"],
  initiative: ["initiative"],
  fortitude: ["fortitude"],
  reflex: ["reflex"],
  will: ["will"],
  attack: ["attack"],
  attacks: ["attack"],
  damage: ["damage"],
  // broadcast classes (plural / general) → the stats they cover
  save: ["fortitude", "reflex", "will"],
  saves: ["fortitude", "reflex", "will"],
  "saving throw": ["fortitude", "reflex", "will"],
  "saving throws": ["fortitude", "reflex", "will"],
  "skill check": [...SKILLS] as Selector[],
  "skill checks": [...SKILLS] as Selector[],
};
for (const s of SKILLS) TARGET_MAP[s] = [s as Selector];

/** Leading articles/possessives to strip: "your Reflex", "the check". */
const LEADING = /^(?:the|your|this|that|its|their|his|her|a|an|all|each|any|every)\s+/i;
/** Trailing role nouns that don't change the stat: "reflex SAVE", "perception DC". */
const TRAILING = /\s+(?:dcs?|checks?|rolls?|saves?|saving\s+throws?|attack\s+rolls?)$/i;

/** Words that mark an ANAPHORIC target — a reference to a check/roll/save with no stat. */
const ANAPHORA_NOUN = /^(?:check|checks|roll|rolls|save|saves|dc|dcs|attack|attacks|saving\s+throws?)$/i;

type TargetResolution =
  | { kind: "resolved"; selectors: Selector[] }
  | { kind: "anaphoric"; raw: string }
  | { kind: "skip" };

/**
 * Resolve a raw modifier target to selector(s), an anaphoric gap, or nothing.
 *
 *   "your Reflex"        → resolved [reflex]
 *   "all saving throws"  → resolved [fortitude, reflex, will]   (broadcast fan-out)
 *   "the attack roll"    → resolved [attack]                    ("attack roll" names a stat)
 *   "your check"         → anaphoric ("check" names no stat — a human picks which)
 *   "an impression…"     → skip                                 (regex over-matched)
 */
function resolveTarget(rawTarget: string): TargetResolution {
  const raw = rawTarget.trim();
  const stripped = raw
    .toLowerCase()
    .replace(LEADING, "")
    .replace(TRAILING, "")
    .trim();

  if (stripped && TARGET_MAP[stripped]) return { kind: "resolved", selectors: TARGET_MAP[stripped]! };

  // Nothing resolvable. If what's left (or the raw phrase) is a bare check/roll/save
  // reference, it is anaphoric — the value is known, the target points elsewhere, and a
  // human resolves it. Otherwise the regex caught non-modifier prose; drop it.
  const leftover = stripped || raw.toLowerCase().replace(LEADING, "").trim();
  if (ANAPHORA_NOUN.test(leftover) || ANAPHORA_NOUN.test(raw.toLowerCase().replace(LEADING, "").trim())) {
    return { kind: "anaphoric", raw };
  }
  return { kind: "skip" };
}

/**
 * A scope that narrows a modifier, appearing right after the target: "…to saves AGAINST
 * magic", "…to Athletics checks TO Climb". The target still resolves, but the effect is
 * conditional and the scope must not be silently dropped (a narrow bonus shown as blanket
 * is a wrong sheet). At this position — immediately after a resolved target — a leading
 * "to <verb>" is reliably a purpose scope, since the target's own "to"/"on" is consumed.
 */
const SCOPE_RE = /^\s*((?:against|to)\s+[a-z][^.,;:]{2,60})/i;

/**
 * Resolve a possibly-COMPOUND target run ("Nature, Society, and Reflex saves") into the
 * selectors it names and any anaphoric fragments. Each element resolves independently via
 * `resolveTarget`; a fragment that is neither a stat nor an anaphor (the run over-captured
 * into a following clause) is dropped — which keeps "Reflex saves and is Off-Guard" from
 * emitting garbage for its second half. Selectors dedupe (a broadcast may repeat one).
 */
function resolveTargetList(run: string): { selectors: Selector[]; anaphoric: string[] } {
  const selectors: Selector[] = [];
  const anaphoric: string[] = [];
  const seen = new Set<string>();
  for (const part of run.split(LIST_SEP)) {
    if (!part.trim()) continue;
    const r = resolveTarget(part);
    if (r.kind === "resolved") {
      for (const s of r.selectors) {
        if (!seen.has(s)) {
          seen.add(s);
          selectors.push(s);
        }
      }
    } else if (r.kind === "anaphoric") {
      anaphoric.push(r.raw);
    }
  }
  return { selectors, anaphoric };
}

/**
 * Extract typed bonus/penalty modifiers from a clause.
 *
 * A resolved target yields one draft per selector — a broadcast fans out and a COMPOUND
 * list ("Deception and Diplomacy") yields one per element. An anaphoric target yields a
 * gapped draft (value + type filled, `target` absent) so a human completes it and `promote`
 * refuses it meanwhile (a bonus on the wrong stat is a wrong sheet). Governed clauses ARE
 * extracted — "+1 to attacks while raging" is a real conditional modifier, its condition
 * carried as a gap, unlike a governed proficiency phrase which is declined outright.
 */
export const modifierExtractor: Extractor = (clause) => {
  const out: Extraction[] = [];
  const span = { start: clause.start, end: clause.end, text: clause.text };
  let m: RegExpExecArray | null;
  MOD_RE.lastIndex = 0;
  while ((m = MOD_RE.exec(clause.text))) {
    const magnitude = Math.abs(Number(m[1]));
    if (!Number.isFinite(magnitude) || magnitude === 0) continue;
    const bonusType = m[2]?.toLowerCase() && BONUS_TYPES.has(m[2].toLowerCase()) ? m[2].toLowerCase() : "untyped";
    const signed = m[3]!.toLowerCase() === "penalty" ? -magnitude : magnitude;
    const value = { kind: "lit" as const, value: signed };

    // Conditions on the modifier come from three places, and NONE may be dropped — a
    // situational bonus emitted as unconditional is a wrong sheet (the whole design's
    // recurring hazard):
    //   • a governing clause          — "while raging, +1 …"
    //   • a trailing governed clause  — "+1 … while raging"
    //   • a SCOPE right after the target — "+1 to saves AGAINST magic", which also fans a
    //     broadcast target, so without this every "saves against X" becomes a blanket
    //     all-saves bonus. Measured: this is the single biggest precision hazard.
    const scopeMatch = SCOPE_RE.exec(clause.text.slice(m.index + m[0].length));
    const condition = clause.governor
      ? `${clause.governor} ${clause.text}`
      : (clause.trailingCondition ?? scopeMatch?.[1]);
    const conditionGap: Gap[] = condition
      ? [{ field: "when", reason: "conditional-unmapped", raw: condition.slice(0, 80) }]
      : [];

    // The target may be a list ("Deception and Diplomacy"); each resolved selector becomes
    // its own draft (a broadcast fans out too), and each anaphoric fragment its own gapped
    // draft. A run that resolves to nothing at all is regex noise — skip it.
    const { selectors, anaphoric } = resolveTargetList(m[4]!);
    if (selectors.length === 0 && anaphoric.length === 0) continue;

    for (const target of selectors) {
      out.push({ draft: { kind: "modifier", target, bonusType, value }, gaps: [...conditionGap], span });
    }
    for (const raw of anaphoric) {
      out.push({
        draft: { kind: "modifier", bonusType, value },
        gaps: [{ field: "target", reason: "anaphoric", raw }, ...conditionGap],
        span,
      });
    }
  }
  return out;
};

/** The default producer extractor set. Grows one family per slice. */
export const DEFAULT_EXTRACTORS: readonly Extractor[] = [proficiencyExtractor, modifierExtractor];
