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
import { CONDITION_SLUGS } from "./conditions.js";
import { DEGREES, type DegreeOfSuccess } from "./degree.js";
import type { Predicate } from "./predicate.js";
import type { Selector } from "./selectors.js";

/** One extracted proposal, before it is wrapped as a producer's `SourceProposals`. */
export interface Extraction {
  draft: DraftEffect;
  gaps: Gap[];
  /** The clause the extraction came from, for the evidence span. */
  span: { start: number; end: number; text: string };
}

/**
 * Vocabulary the caller supplies so the parser can resolve trait scopes ("saves
 * against mental effects") into a real predicate instead of a gap.
 *
 * PASSED IN, NOT HARDCODED. These are game CONTENT — the set of traits that exist —
 * and content does not live in core (it is headed for the database; see the repo's
 * content-storage rule). The caller already holds the corpus, so a vocabulary
 * supplied from it can never drift out of date the way a constant here would.
 *
 * Both default to EMPTY, and empty means every conditional gaps exactly as it did
 * before this existed. A parser that silently resolved scopes against a stale
 * built-in list would be worse than one that admits it does not know the word.
 */
export interface ParseContext {
  /**
   * Traits an EFFECT can carry, used only where the prose itself says "effects" or
   * "spells" — that noun is what makes the wide vocabulary safe. Feats' traits
   * belong here too ("linguistic effects"), because the noun has already ruled out
   * a creature reading.
   */
  effectTraits?: ReadonlySet<string>;
  /**
   * The NARROWER vocabulary used for a bare "against X", where nothing in the prose
   * says whether X is an effect or a creature. Restricting it to traits that appear
   * on SPELLS is what keeps "against dragons" and "against humans" out: those are
   * creature types, and reading them as effect traits would produce a bonus that can
   * never fire — a silently wrong sheet, which is worse than an honest gap.
   */
  spellTraits?: ReadonlySet<string>;
}

/**
 * An extractor reads ONE clause and returns any effects it proposes. It receives the
 * clause's governor so it can decline (a rank phrase under `when` is a condition, not a
 * grant — the Lepidstadt trap) or emit a conditional draft with a gap, plus the parse
 * context's vocabulary. Pure and self-contained: extractors do not see each other's
 * output.
 */
export type Extractor = (clause: Clause, ctx?: ParseContext) => Extraction[];

/** Parse a raw description into extractions. The producer wrapper is `parseProse`. */
export function extractFromProse(
  raw: string,
  extractors: readonly Extractor[],
  ctx: ParseContext = {},
): Extraction[] {
  const clauses = segment(normalize(raw));
  const out: Extraction[] = [];
  for (const clause of clauses) {
    for (const extractor of extractors) out.push(...extractor(clause, ctx));
  }
  return out;
}

/**
 * The parser as a candidate.ts PRODUCER: raw description → `SourceProposals` ready for
 * `reconcile`. `source: "parser"` so Foundry's proposals corroborate or conflict with it.
 */
export function parseProse(
  raw: string,
  extractors: readonly Extractor[] = DEFAULT_EXTRACTORS,
  ctx: ParseContext = {},
): SourceProposals {
  return {
    source: "parser",
    proposals: extractFromProse(raw, extractors, ctx).map((e) => ({
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

// --- trait scopes: "against mental effects" -> when: effect:trait:mental -------
//
// The single biggest category of conditional the parser saw and could not express:
// 1,108 conditional gaps, of which "against ..." is 434. The MODEL was never the
// blocker — `effect:trait:<t>` landed with predicate.ts and is exactly what
// "+1 to saves against death effects" needs — the parser simply never proposed one.
//
// TWO SHAPES, TWO VOCABULARIES, and the difference is the whole safety argument:
//
//   A. "against <X> effects" / "against <X> spells"  → the WIDE vocabulary.
//      The noun has already told us X describes an effect, so "linguistic effects"
//      is safe even though `linguistic` never appears on a spell.
//
//   B. bare "against <X>"                            → the SPELL-ONLY vocabulary.
//      Nothing here says whether X is an effect or a creature. Measured on the
//      corpus, this shape contains both: "against poisons" (an effect trait) and
//      "against dragons" / "against humans" (creature types). Restricting to traits
//      that appear on SPELLS admits the first and excludes the second. Reading
//      "against humans" as `effect:trait:human` would attach a bonus that can never
//      fire — silently wrong, and worse than leaving the gap.
//
// A plural is singularized only by checking the SINGULAR against the vocabulary
// ("diseases" → `disease` because `disease` is a trait), never by a rule about
// English — so a word that merely ends in "s" is not mangled into a false match.
// THREE MORE SHAPES, measured on what was left after the single-trait pass:
//
//   C. "effects with the <X> trait" / "... the <X> or <Y> traits"  — the prose says
//      "trait" outright, so this is the least ambiguous shape of all.
//   D. "against <X> and <Y> effects" / "against <X>s and <Y>s"      — a coordinated
//      pair. Read as ANY, not ALL: a bonus "against emotion and fear effects" applies
//      to an emotion effect and to a fear effect, not only to one carrying both.
//      That is a reading of English, and it is the reading the corpus supports.
//   E. "effects that would impose/cause/inflict <condition>"        — `effect:causes:`,
//      whose vocabulary is core's own CONDITION_SLUGS: a closed, owner-supplied list,
//      so no caller vocabulary is needed and nothing can drift.
//
// Everything past these stays gapped, and deliberately: creature scopes ("against
// dragons") need `opponent:trait:` plus a creature-trait vocabulary no dataset here
// carries, and "against magic" / "against spells and other magical effects from the
// same tradition as yours" are not single predicates at all.
const TRAIT_SCOPE_NOUNED = /^against\s+([a-z][a-z-]*)\s+(?:effects?|spells?)$/i;
const TRAIT_SCOPE_BARE = /^against\s+([a-z][a-z-]*)$/i;
const TRAIT_SCOPE_EXPLICIT = /^against\s+(?:effects?|spells?)\s+with\s+the\s+([a-z][a-z\s,-]*?)\s+traits?$/i;
const TRAIT_SCOPE_PAIR = /^against\s+([a-z][a-z-]*?)s?\s+and\s+([a-z][a-z-]*?)s?(?:\s+effects?|\s+spells?)?$/i;
const CAUSES_SCOPE = /^against\s+effects?\s+that\s+(?:would\s+)?(?:impose|cause|inflict|make|give)\b(.*)$/i;

/** `a`, `a or b`, `a, b, or c` → the individual words. */
function splitCoordination(text: string): string[] {
  return text
    .split(/\s*,\s*|\s+or\s+|\s+and\s+/)
    .map((w) => w.trim())
    .filter(Boolean);
}

/** One tag, or an `any` over several — the shape a coordinated scope needs. */
function anyOf(tags: string[]): Predicate | null {
  if (tags.length === 0) return null;
  if (tags.length === 1) return { tag: tags[0]! };
  return { any: tags.map((tag) => ({ tag })) };
}

/**
 * Does this scope point BACK at something rather than name a category?
 *
 * "against the triggering attack", "against this creature", "against the affliction"
 * — a reviewer resolving one of these needs the referent from the surrounding text,
 * not a word we are missing from a vocabulary. That is the difference between the
 * `anaphoric` and `conditional-unmapped` gap reasons, and getting it wrong sends the
 * reviewer looking for the wrong thing.
 */
const ANAPHORIC_SCOPE = /^against\s+(the|this|that|these|those|your|their|its|his|her)\b/i;
function isAnaphoricScope(condition: string): boolean {
  return ANAPHORIC_SCOPE.test(condition.trim());
}

/** The word itself if it is in `vocab`, else its de-pluralized form if THAT is. */
function resolveTraitWord(word: string, vocab: ReadonlySet<string> | undefined): string | null {
  if (!vocab || vocab.size === 0) return null;
  const w = word.toLowerCase();
  if (vocab.has(w)) return w;
  if (w.endsWith("es") && vocab.has(w.slice(0, -2))) return w.slice(0, -2);
  if (w.endsWith("s") && vocab.has(w.slice(0, -1))) return w.slice(0, -1);
  return null;
}

/**
 * A condition phrase → an `effect:trait:<t>` predicate, or null when it is anything
 * this cannot state with confidence (in which case the caller keeps its gap).
 */
export function resolveTraitScope(condition: string, ctx: ParseContext): Predicate | null {
  const text = condition.trim().toLowerCase();

  // "effects with the darkness or shadow traits" — the prose names the concept, so
  // the wide vocabulary is safe and every word must resolve or the whole thing does.
  const explicit = TRAIT_SCOPE_EXPLICIT.exec(text);
  if (explicit) {
    const words = splitCoordination(explicit[1]!).map((w) => resolveTraitWord(w, ctx.effectTraits));
    if (words.length > 0 && words.every((w): w is string => w !== null)) {
      return anyOf(words.map((w) => `effect:trait:${w}`));
    }
    return null;
  }

  // "effects that would impose the immobilized condition" — condition slugs are
  // core's own closed vocabulary, so this needs nothing from the caller.
  const causes = CAUSES_SCOPE.exec(text);
  if (causes) {
    const rest = causes[1]!;
    const hits = CONDITION_SLUGS.filter((slug) => new RegExp(`\\b${slug}\\b`).test(rest));
    if (hits.length > 0) return anyOf(hits.map((slug) => `effect:causes:${slug}`));
    return null;
  }

  const nouned = TRAIT_SCOPE_NOUNED.exec(text);
  if (nouned) {
    const trait = resolveTraitWord(nouned[1]!, ctx.effectTraits);
    return trait ? { tag: `effect:trait:${trait}` } : null;
  }

  // "against emotion and fear effects" / "against poisons and diseases". BOTH halves
  // must resolve: half a coordinated scope is a narrower condition than the prose
  // states, which would apply the bonus in cases the feat does not grant it.
  const pair = TRAIT_SCOPE_PAIR.exec(text);
  if (pair) {
    const hasNoun = /\s+(?:effects?|spells?)$/.test(text);
    const vocab = hasNoun ? ctx.effectTraits : ctx.spellTraits;
    const a = resolveTraitWord(pair[1]!, vocab);
    const b = resolveTraitWord(pair[2]!, vocab);
    if (a && b) return anyOf([`effect:trait:${a}`, `effect:trait:${b}`]);
    return null;
  }

  const bare = TRAIT_SCOPE_BARE.exec(text);
  if (bare) {
    const trait = resolveTraitWord(bare[1]!, ctx.spellTraits);
    return trait ? { tag: `effect:trait:${trait}` } : null;
  }

  return null;
}

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
export const modifierExtractor: Extractor = (clause, ctx = {}) => {
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

    // A condition we can STATE becomes a predicate; one we cannot becomes a gap.
    // Never both, and never neither — dropping it silently is the wrong-sheet bug.
    const when = condition ? resolveTraitScope(condition, ctx) : null;
    const conditionGap: Gap[] = condition && !when
      ? [{
          field: "when",
          // "against the triggering attack" is not missing vocabulary — it points
          // back at something earlier in the text, which is what `anaphoric` means.
          // Filing it as `conditional-unmapped` told a reviewer to go find a word we
          // lack, when what they actually need is the referent. 68 gaps were
          // mislabelled this way; the fix costs nothing and aims the queue correctly.
          reason: isAnaphoricScope(condition) ? "anaphoric" : "conditional-unmapped",
          raw: condition.slice(0, 80),
        }]
      : [];
    const whenField = when ? { when } : {};

    // The target may be a list ("Deception and Diplomacy"); each resolved selector becomes
    // its own draft (a broadcast fans out too), and each anaphoric fragment its own gapped
    // draft. A run that resolves to nothing at all is regex noise — skip it.
    const { selectors, anaphoric } = resolveTargetList(m[4]!);
    if (selectors.length === 0 && anaphoric.length === 0) continue;

    for (const target of selectors) {
      out.push({ draft: { kind: "modifier", target, bonusType, value, ...whenField }, gaps: [...conditionGap], span });
    }
    for (const raw of anaphoric) {
      out.push({
        draft: { kind: "modifier", bonusType, value, ...whenField },
        gaps: [{ field: "target", reason: "anaphoric", raw }, ...conditionGap],
        span,
      });
    }
  }
  return out;
};

// ---------------------------------------------------------------------------
// 7. the grant extractor (slice — senses + speeds)
// ---------------------------------------------------------------------------
//
// Grants are the biggest corroboration gap vs Foundry (86 foundry-only grants). This slice
// takes the two structurally simple sub-shapes — SPEEDS (a flat integer) and SENSES
// (value-free) — and defers resistances/weaknesses/immunities, whose values are level-scaled
// expressions (`max(1, floor(level/2))`) tangled with the feat-granted-resistance min-1 rule.
//
// SPEED: Foundry maps EVERY "results in speed N" phrasing to one BaseSpeed → grant:speed, so
// the parser must read all three to corroborate:
//   "a swim Speed of 15 feet"                  → grant swim 15
//   "your land Speed increases to 15 feet"     → grant land 15
//   "your swim Speed increases from 10 to 25"  → grant swim 25   (value AFTER the final "to")
// The "from X to N" trap is the proficiency "from trained to expert" trap again — the
// operative number follows "to". "increases BY N" is a DIFFERENT effect (an additive
// FlatModifier, usually conditional) and is deliberately NOT matched: a conditional one is
// declined by the governor gate, exactly as Foundry leaves that +5 unmapped.

const MOVEMENTS = ["land", "fly", "swim", "climb", "burrow"] as const;
const MOVE_ALT = MOVEMENTS.join("|");

// Movement optional (→ land). The value is the integer the speed BECOMES: after "of"/"is",
// or after the final "to" (an optional "from X" is consumed first, so "from 10 to 25" → 25).
const SPEED_RE = new RegExp(
  String.raw`\b(?:(${MOVE_ALT})\s+)?speed\s+(?:of|is|increases\s+(?:from\s+\d+\s*(?:feet|foot|ft\.?)?\s+)?to)\s+(\d+)`,
  "gi",
);
// The value-BEFORE phrasing: "a 15-foot swim Speed" (Wavetouched Paragon). Value then movement.
const SPEED_FOOT_RE = new RegExp(
  String.raw`\b(?:a|an)\s+(\d+)[\s-]*(?:foot|feet|ft\.?)\s+(${MOVE_ALT})\s+speed\b`,
  "gi",
);

// The sense vocabulary — a closed set (the schema's `name` is a free string, but the parser
// claims only senses it knows). `[-\s]` so "low-light vision"/"low-light-vision" both match;
// alternation is longest-first so "greater darkvision" beats "darkvision".
const SENSES = [
  "greater darkvision", "low-light vision", "darkvision", "tremorsense", "bloodsense",
  "lifesense", "wavesense", "echolocation", "scent",
];
const SENSE_ALT = SENSES.map((s) => s.replace(/[-\s]/g, "[-\\s]")).join("|");
// "you gain darkvision", "gain imprecise scent … range of 30 feet", "scent as an imprecise
// sense …". Acuity appears EITHER before the sense ("imprecise scent") or after ("as an
// imprecise sense"); range as "range of N" or "at a range of N" (the "range of" tail matches
// both). Groups: 1 acuity-before · 2 sense · 3 acuity-after · 4 range.
const SENSE_RE = new RegExp(
  String.raw`\b(?:gains?|have|has)\s+(?:the\s+)?(?:(precise|imprecise|vague)\s+)?(${SENSE_ALT})\b(?:\s+as\s+an?\s+(precise|imprecise|vague)\s+sense)?(?:[^.]*?\brange\s+of\s+(\d+))?`,
  "gi",
);
const ACUITY = new Set(["precise", "imprecise", "vague"]);

// ── resistances / weaknesses / immunities (grant slice 2) ────────────────────
//
// The value is level-scaled or flat, and Foundry's AST must be matched EXACTLY to
// corroborate: `floor(level/2)`, or `max(1, floor(level/2))` — but ONLY when the prose says
// "(minimum 1)". FOLLOW THE PROSE (owner call): the feats that omit "(minimum 1)" are never
// 1st-level feats, so half-your-level is never 0 by the time you can take them — the minimum
// is unnecessary and the text says so. Applying min-1 anyway would DISAGREE with Foundry's own
// bare-floor encoding on 18 feats. Where the prose does say it, min-1 is applied.
//
// The damageType is a broad free-string vocabulary (not just the base damage types —
// resistances target poison/mental/bleed/holy/precision/… and materials like cold-iron), and
// the emitted string must be Foundry's canonical hyphenated form ("cold iron" → "cold-iron").
const RESIST_TYPES = new Set([
  "bludgeoning", "piercing", "slashing", "physical",
  "acid", "cold", "electricity", "fire", "sonic", "vitality", "void", "force",
  "poison", "mental", "bleed", "spirit", "holy", "unholy", "precision", "critical-hits",
  "silver", "cold-iron", "adamantine", "orichalcum", "darkwood", "dawnsilver", "duskwood", "sovereign-steel",
]);
// Immunity also covers a few conditions/effects the observed feats grant immunity to.
const IMMUNITY_TYPES = new Set([...RESIST_TYPES, "disease", "sleep", "paralyzed"]);

const RESIST_TYPE_ALT = [...RESIST_TYPES].sort((a, b) => b.length - a.length).map((t) => t.replace(/-/g, "[-\\s]")).join("|");
/** Split a compound type run — "fire, cold, and acid" — on and/comma (Oxford comma first). */
const TYPE_SEP = /\s*,\s*and\s+|\s*,\s*|\s+and\s+/i;

// A) kind-first: "resistance 3 to fire and sonic", "resistance to poison equal to half your
//    level", "resistance 2 to cold, electricity, fire, and slashing". Groups: 1 kind · 2 flat ·
//    3 type-run · 4 scale · 5 min1.
//
// The type run is lazy and STOPS at "equal to", a sentence break, or "and <verb>" (a clause
// continuation like "and gain a bonus") — but NOT at a bare comma, since commas separate the
// TYPES of a compound list ("cold, electricity, fire"). Treating a comma as a hard stop
// truncated every comma-separated list to its first type. The value clause is matched AFTER
// the run and needs no trailing boundary — the match simply ends at the value.
const RESIST_A_RE = new RegExp(
  String.raw`\b(resistance|weakness)\s+(?:(\d+)\s+)?to\s+(?:both\s+)?([a-z][a-z\s,'-]*?)(?=\s+equal\s+to\b|[.;:]|$|\s+and\s+(?:reduce|gain|you|treat|the|but|a)\b|\s+even\b|\s+if\b|\s+when\b|\s+while\b|\s+for\b)(?:\s+equal\s+to\s+(half\s+your\s+level|your\s+level)\s*(\(minimum\s*1\))?)?`,
  "gi",
);
// B) type-first: "fire resistance equal to half your level", "mental weakness 5". A value is
//    REQUIRED (a bare "fire resistance" is not a grant here). Groups: 1 type · 2 kind · 3 flat · 4 scale · 5 min1.
const RESIST_B_RE = new RegExp(
  String.raw`\b(${RESIST_TYPE_ALT})\s+(resistance|weakness)\s+(?:(\d+)\b\s*)?(?:equal\s+to\s+(half\s+your\s+level|your\s+level)\s*(\(minimum\s*1\))?)?`,
  "gi",
);
// "immune to poison and disease", "immunity to sleep effects", "immune to cold damage".
// Commas stay list-separators (see RESIST_A_RE); the run stops at a clause break, not a comma.
const IMMUNITY_RE = /\b(?:immune|immunity)\s+to\s+([a-z][a-z\s,'-]*?)(?=[.;:]|$|\s+and\s+(?:gain|you|the)\b|\s+even\b|\s+for\b|\s+but\b)/gi;

/** Canonicalize a captured type phrase to Foundry's form, or "" if it is not a known type. */
function normalizeType(raw: string, vocab: Set<string>): string {
  const t = raw
    .toLowerCase()
    .replace(/^(?:both|persistent|all)\s+/, "")
    .replace(/\s+(?:damage|effects?)$/, "")
    .trim()
    .replace(/\s+/g, "-");
  return vocab.has(t) ? t : "";
}

/** Build the value AST Foundry uses. `min1` only when the prose stated "(minimum 1)". */
function scaledValue(scale: string | undefined, min1: boolean, flat: string | undefined): unknown {
  if (scale) {
    const base = /half/i.test(scale)
      ? { kind: "call", fn: "floor", args: [{ kind: "call", fn: "divide", args: [{ kind: "var", name: "level" }, { kind: "lit", value: 2 }] }] }
      : { kind: "var", name: "level" };
    return min1 ? { kind: "call", fn: "max", args: [{ kind: "lit", value: 1 }, base] } : base;
  }
  if (flat !== undefined) {
    const n = Number(flat);
    if (Number.isFinite(n) && n > 0) return { kind: "lit", value: n };
  }
  return undefined;
}

/**
 * Extract GRANTS from a clause — senses, speeds, and resistances/weaknesses/immunities.
 * Governed clauses are declined (a conditional grant needs a predicate the parser can't build)
 * — the same gate as the proficiency extractor, and why Like a Fish's "+5 if you already have
 * a swim Speed" is dropped rather than emitted as permanent.
 */
export const grantExtractor: Extractor = (clause) => {
  if (clause.governor) return [];
  const out: Extraction[] = [];
  const span = { start: clause.start, end: clause.end, text: clause.text };
  let m: RegExpExecArray | null;

  const pushSpeed = (move: string | undefined, raw: string) => {
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) return;
    const movement = (move?.toLowerCase() as (typeof MOVEMENTS)[number] | undefined) ?? "land";
    out.push({ draft: { kind: "grant", grant: { type: "speed", movement, value: { kind: "lit", value } } }, gaps: [], span });
  };
  SPEED_RE.lastIndex = 0;
  while ((m = SPEED_RE.exec(clause.text))) pushSpeed(m[1], m[2]!);
  SPEED_FOOT_RE.lastIndex = 0;
  while ((m = SPEED_FOOT_RE.exec(clause.text))) pushSpeed(m[2], m[1]!);

  SENSE_RE.lastIndex = 0;
  while ((m = SENSE_RE.exec(clause.text))) {
    const name = m[2]!.toLowerCase().replace(/\s+/g, " ");
    const acuity = (m[1] ?? m[3])?.toLowerCase();
    const grant: Record<string, unknown> = { type: "sense", name };
    if (acuity && ACUITY.has(acuity)) grant.acuity = acuity;
    if (m[4]) {
      const range = Number(m[4]);
      if (Number.isFinite(range) && range > 0) grant.range = range;
    }
    out.push({ draft: { kind: "grant", grant }, gaps: [], span });
  }

  // resistance / weakness — a compound type run fans out, one grant per type; the value AST
  // is shared across the run (a single "resistance 3 to fire and sonic" is 3 to each).
  const pushResist = (kind: string, value: unknown, typeRun: string) => {
    if (value === undefined) return;
    for (const part of typeRun.split(TYPE_SEP)) {
      const damageType = normalizeType(part, RESIST_TYPES);
      if (damageType) out.push({ draft: { kind: "grant", grant: { type: kind, damageType, value } }, gaps: [], span });
    }
  };
  RESIST_A_RE.lastIndex = 0;
  while ((m = RESIST_A_RE.exec(clause.text))) pushResist(m[1]!.toLowerCase(), scaledValue(m[4], !!m[5], m[2]), m[3]!);
  RESIST_B_RE.lastIndex = 0;
  while ((m = RESIST_B_RE.exec(clause.text))) pushResist(m[2]!.toLowerCase(), scaledValue(m[4], !!m[5], m[3]), m[1]!);

  // immunity — value-free; a compound run fans out ("immune to poison and disease").
  IMMUNITY_RE.lastIndex = 0;
  while ((m = IMMUNITY_RE.exec(clause.text))) {
    for (const part of m[1]!.split(TYPE_SEP)) {
      const to = normalizeType(part, IMMUNITY_TYPES);
      if (to) out.push({ draft: { kind: "grant", grant: { type: "immunity", to } }, gaps: [], span });
    }
  }

  return out;
};

// ---------------------------------------------------------------------------
// 8. the choice extractor (slice — skill-proficiency choices)
// ---------------------------------------------------------------------------
//
// A CHOICE is a second content type (`EffectChoice`), not a PassiveEffect: "a skill of
// your choice" grants proficiency to ONE of several skills the player picks. Foundry
// stores these in `feat.choices`; this emits a matching choice draft (`kind: "choice"`)
// that reconcile keys on its OPTION SET (see candidate.ts), so the two producers
// corroborate despite the parser not knowing Foundry's flag.
//
// SLICE SCOPE (owner): skill-proficiency choices only. The rank is read from the clause
// (default trained). Save/perception choices with level-scaled ranks (Canny Acumen) and
// paired choices (Clan Lore) are deferred.

// "a skill of your choice" → a choice over ALL 16 skills (Skill Training).
const SKILL_OF_CHOICE_RE = /\b(?:a|one|another|the)\s+skill\s+of\s+your\s+choice\b/gi;
// "your choice of Arcana, Nature, Occultism, or Religion" → the listed skills. A run
// containing "and"/"either" is a MIXED definite+choice phrase (Elemental Lore) — skipped
// here and left to EITHER_RE, so a definite skill is never swept into the option set.
const CHOICE_OF_RE = /\b(?:your|his|her|their)\s+choice\s+of\s+([a-z][a-z\s,'-]*?)(?=[.;:]|$|\s+(?:if|when|while|for|in\s+which)\b|\s+and\s+(?:gain|you)\b)/gi;
// "either Arcana or Nature" → a two-skill choice (also catches the choice half of a mixed phrase).
const EITHER_RE = /\beither\s+([a-z]+)\s+or\s+([a-z]+)\b/gi;
/** Split a choice list on comma/or (Oxford ", or" first); "and" is handled by EITHER_RE. */
const CHOICE_SEP = /\s*,\s*or\s+|\s*,\s*|\s+or\s+/i;

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The rank a nearby preceding rank word states, or trained (1) — the dominant default. */
function rankBefore(text: string, idx: number): 0 | 1 | 2 | 3 | 4 {
  const words = text.slice(0, idx).toLowerCase().match(/\b(?:untrained|trained|expert|master|legendary)\b/g);
  const last = words?.[words.length - 1];
  return last ? RANK_WORDS[last]! : 1;
}

/** Build a skill-proficiency `EffectChoice` draft. `flag` is generated — reconcile keys on options. */
function skillChoice(skills: readonly string[], rank: 0 | 1 | 2 | 3 | 4): DraftEffect {
  return {
    kind: "choice",
    choice: {
      flag: "skill-choice",
      prompt: "Skill",
      options: skills.map((s) => ({
        value: s,
        label: cap(s),
        effects: [{ kind: "proficiency", target: s, rank, mode: "upgrade" }],
      })),
    },
  };
}

/**
 * Extract skill-proficiency CHOICES from a clause. Governed clauses are declined (a
 * conditional choice needs a predicate we can't build), like the proficiency extractor.
 */
export const choiceExtractor: Extractor = (clause) => {
  if (clause.governor) return [];
  const out: Extraction[] = [];
  const span = { start: clause.start, end: clause.end, text: clause.text };
  const seen = new Set<string>();
  const emit = (skills: string[], rank: 0 | 1 | 2 | 3 | 4) => {
    const uniq = [...new Set(skills)].sort();
    if (uniq.length < 2) return; // one option is a definite grant, not a choice
    const key = uniq.join("|");
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ draft: skillChoice(uniq, rank), gaps: [], span });
  };

  // "you INSTEAD become trained in a skill of your choice" is a SUBSTITUTION fallback (you
  // already had the granted skill), not a primary choice — decline it. The governor gate
  // catches the "If you would…" phrasings; this catches the ungoverned "For each…" ones.
  const substitution = (idx: number) => /\binstead\b/i.test(clause.text.slice(0, idx));

  let m: RegExpExecArray | null;
  SKILL_OF_CHOICE_RE.lastIndex = 0;
  while ((m = SKILL_OF_CHOICE_RE.exec(clause.text))) {
    if (!substitution(m.index)) emit([...SKILLS], rankBefore(clause.text, m.index));
  }

  CHOICE_OF_RE.lastIndex = 0;
  while ((m = CHOICE_OF_RE.exec(clause.text))) {
    const run = m[1]!;
    if (/\band\b|\beither\b/i.test(run) || substitution(m.index)) continue; // mixed phrase or substitution
    const skills = run.split(CHOICE_SEP).map((s) => s.trim().toLowerCase()).filter((s) => SKILLS.has(s));
    emit(skills, rankBefore(clause.text, m.index));
  }

  EITHER_RE.lastIndex = 0;
  while ((m = EITHER_RE.exec(clause.text))) {
    const a = m[1]!.toLowerCase();
    const b = m[2]!.toLowerCase();
    if (SKILLS.has(a) && SKILLS.has(b)) emit([a, b], rankBefore(clause.text, m.index));
  }

  return out;
};

// ---------------------------------------------------------------------------
// 9. the degree-of-success extractor
// ---------------------------------------------------------------------------
//
// MEASURED over the corpus (167 degree clauses across 131 feats, 127 distinct
// surface shapes) — but the shapes are variations on ONE template:
//
//     you roll a <TRIGGER>  <scope phrase>,  you get a <RESULT> instead
//
// The variety is entirely in the middle: "on a saving throw against a fear effect",
// "on an Athletics check to Climb", "on the save", or nothing at all. So this keys
// on the two degree words and the "instead", and hands the middle to the SAME
// target/scope machinery the modifier extractor uses. The top shapes:
//
//     8  you roll a <S>, you get a <CS> instead.
//     7  you roll a <S> on an ~ check to ~, you get a <CS> instead.
//     6  you roll a <CF>, you get a <F> instead.
//     5  you roll a <CF> on the save you get a <F> instead.      (note: no comma)
//     5  you roll a <S> on a saving throw against an ~ ~, you get a <CS> instead.
//
// GOVERNORS ARE NOT CONDITIONS HERE, and this is the one thing to get right. The
// modifier extractor treats a governing "when"/"if" as an unexpressed condition,
// because "+1 to attacks WHILE raging" is a conditional modifier. But "WHEN you roll
// a success, you get a critical success instead" is not a conditional anything — the
// governor introduces the effect's own TRIGGER, which is precisely what the map's key
// encodes. Emitting it as a condition gap as well would send all 131 feats to a
// reviewer to "resolve" a condition the draft already states.

const DEG_WORD: Record<string, DegreeOfSuccess> = {
  "critical success": "critical-success",
  "critical failure": "critical-failure",
  success: "success",
  failure: "failure",
};
// Longest-first so "critical success" is never read as the bare "success".
const DEG_ALT = String.raw`critical\s+success|critical\s+failure|success|failure`;

/**
 * `roll [any result worse than] a <trigger> <middle>, you get a <result>`.
 * The middle is lazy and stops at the "you get" that follows, so it captures exactly
 * the scope phrase. The comma is optional — 5 corpus clauses omit it.
 *
 * "instead" is NOT required, though 129 of the 135 matching clauses say it. Six real
 * rewrites do not ("…you get a success.", "…you get a critical success;"), and one
 * more puts a phrase in between ("you get a critical success against that target
 * instead"). Precision does not depend on the word: the template already needs two
 * degree words in a fixed frame, and a match whose trigger and result are the SAME
 * degree is discarded below, which is what rules out "you roll a success to Treat
 * Wounds … you get a success".
 */
const DEGREE_RE = new RegExp(
  String.raw`\broll\s+(?:(any\s+result\s+worse\s+than)\s+)?(?:a|an|the)?\s*(${DEG_ALT})\b([^.;]{0,140}?)\s*,?\s*(?:and\s+)?you\s+get\s+(?:a|an)\s+(${DEG_ALT})\b`,
  "gi",
);

/** Leading prepositions on the scope phrase: "ON a saving throw", "AT one of…". */
const DEGREE_MIDDLE_LEAD = /^\s*(?:on|at|for|in|with|to)\s+/i;
/** Where the target run ends and a narrowing scope begins. */
const DEGREE_SCOPE_SPLIT = /\s+\b(against|to)\b\s+/i;
/**
 * Degree prose scopes in the SINGULAR with an article — "against A VISUAL EFFECT" —
 * where modifier prose says "against visual effects". The trait-scope patterns expect
 * the bare noun phrase, so the article is dropped before they see it. Without this
 * every one of these gaps as `conditional-unmapped` over a trait we can in fact name.
 */
const DEGREE_SCOPE_ARTICLE = /^(against|to)\s+(?:a|an|the)\s+/i;

/**
 * A DEFINITE article on a bare check noun — "on THE save", "on THE check" — points
 * back at a specific roll named earlier in the feat, so it is anaphoric. An INDEFINITE
 * one — "on A saving throw" — is generic and correctly fans out to all three saves.
 *
 * `resolveTarget` reads both as the broadcast, because it hits TARGET_MAP's "save"
 * before its own anaphora check. That is defensible for modifier prose and wrong here:
 * measured, 5 corpus clauses say "on the save", and Cantorian Reinforcement is the
 * proof — its second sentence rewrites a critical failure "on the save", meaning the
 * disease-or-poison save from its FIRST sentence. Read as a broadcast it becomes an
 * unconditional rewrite on every save the character ever rolls. Narrowed to this
 * extractor deliberately: changing `resolveTarget` would move modifier candidates
 * across the whole corpus, which needs its own measurement.
 */
const DEGREE_DEFINITE_TARGET = /^the\s+(?:saving\s+throws?|saves?|checks?|rolls?|attacks?)$/i;

/**
 * Build the degree map. A plain trigger rewrites ONE degree; "any result worse than
 * a success" is a FLOOR, which is just every degree below the trigger rewritten to
 * the result — no separate clamp primitive (see `DegreeAdjustment` in degree.ts).
 */
function degreeMapFor(trigger: DegreeOfSuccess, result: DegreeOfSuccess, floor: boolean): Partial<Record<DegreeOfSuccess, DegreeOfSuccess>> {
  const map: Partial<Record<DegreeOfSuccess, DegreeOfSuccess>> = {};
  if (!floor) {
    if (trigger !== result) map[trigger] = result;
    return map;
  }
  const cutoff = DEGREES.indexOf(trigger);
  for (const d of DEGREES) {
    if (DEGREES.indexOf(d) < cutoff && d !== result) map[d] = result;
  }
  return map;
}

/**
 * Extract conditional degree-of-success rewrites ("when you roll a success …, you get
 * a critical success instead") as `rollAdjust` drafts carrying a `degreeMap`.
 *
 * A resolved target fans out exactly as a modifier does — "a saving throw" is a
 * broadcast, so Adaptive Vision yields one draft per save and a Fortitude roll picks
 * up only its own (see `degreeAdjustmentsFor`). An unstated target yields a gapped
 * draft rather than a guess: an unconditional degree rewrite on the wrong check is
 * the same wrong-sheet bug a blanket-from-narrow modifier is, and `promote` refuses
 * a gapped draft meanwhile.
 */
export const degreeExtractor: Extractor = (clause, ctx = {}) => {
  const out: Extraction[] = [];
  const span = { start: clause.start, end: clause.end, text: clause.text };
  let m: RegExpExecArray | null;
  DEGREE_RE.lastIndex = 0;
  while ((m = DEGREE_RE.exec(clause.text))) {
    const trigger = DEG_WORD[m[2]!.toLowerCase().replace(/\s+/g, " ")];
    const result = DEG_WORD[m[4]!.toLowerCase().replace(/\s+/g, " ")];
    if (!trigger || !result) continue;

    const map = degreeMapFor(trigger, result, Boolean(m[1]));
    // "roll a success, you get a success instead" rewrites nothing. Not an effect.
    if (Object.keys(map).length === 0) continue;
    const draftBase = { kind: "rollAdjust" as const, adjust: { type: "degreeMap" as const, map } };

    // Split the middle into "what is rolled" and "what narrows it": "a saving throw
    // against a fear effect" → target "a saving throw", scope "against a fear effect".
    const middle = m[3]!.replace(DEGREE_MIDDLE_LEAD, "").trim();
    const split = DEGREE_SCOPE_SPLIT.exec(middle);
    const targetRun = split ? middle.slice(0, split.index) : middle;
    const scope = split ? middle.slice(split.index).trim().replace(DEGREE_SCOPE_ARTICLE, "$1 ") : undefined;

    // Same discipline as the modifier extractor: a scope we can state becomes a
    // predicate, one we cannot becomes a gap — never both, never neither.
    const when = scope ? resolveTraitScope(scope, ctx) : null;
    const scopeGap: Gap[] = scope && !when
      ? [{ field: "when", reason: isAnaphoricScope(scope) ? "anaphoric" : "conditional-unmapped", raw: scope.slice(0, 80) }]
      : [];
    const whenField = when ? { when } : {};

    const { selectors, anaphoric } =
      !targetRun || DEGREE_DEFINITE_TARGET.test(targetRun.trim())
        ? { selectors: [] as Selector[], anaphoric: targetRun ? [targetRun.trim()] : [] }
        : resolveTargetList(targetRun);

    for (const target of selectors) {
      out.push({ draft: { ...draftBase, target, ...whenField }, gaps: [...scopeGap], span });
    }
    for (const raw of anaphoric) {
      out.push({ draft: { ...draftBase, ...whenField }, gaps: [{ field: "target", reason: "anaphoric", raw }, ...scopeGap], span });
    }
    // Nothing said what is being rolled ("when you roll a success, you get a critical
    // success instead"). Filed as `anaphoric`, not `missing`: the referent is earlier
    // in the feat's own text, so the reviewer's job is to go read it, not to supply
    // vocabulary we lack. Mislabelling this cost 68 misaimed gaps once already.
    if (selectors.length === 0 && anaphoric.length === 0) {
      out.push({
        draft: { ...draftBase, ...whenField },
        gaps: [{ field: "target", reason: "anaphoric", raw: clause.text.slice(0, 80) }, ...scopeGap],
        span,
      });
    }
  }
  return out;
};

/** The default producer extractor set. Grows one family per slice. */
export const DEFAULT_EXTRACTORS: readonly Extractor[] = [
  proficiencyExtractor,
  modifierExtractor,
  grantExtractor,
  choiceExtractor,
  degreeExtractor,
];
