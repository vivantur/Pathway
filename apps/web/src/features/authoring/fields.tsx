import { useState } from 'react';
import {
  passiveEffectSchema,
  parseExpr,
  describePredicate,
  tagSlug,
  CONDITIONS,
  CONDITION_SLUGS,
  ACTION_SLUGS,
  FIXED_SELECTORS,
  SKILL_SLUGS,
  SAVE_SELECTORS,
  DAMAGE_TYPES,
  DAMAGE_MATERIALS,
  type Predicate,
} from '@pathway/core';

/**
 * Shared authoring field components. Extracted from EffectAuthorPage so the automation-tree
 * editor (AutomationEditor) can reuse EffectForm for an applyEffect's Layer-1 passives — the
 * same forms, one implementation, so an authored passive is identical wherever it is built.
 */

export const inputCls = 'rounded border border-gold/20 bg-midnight-950/60 px-2 py-1 text-sm text-parchment';
export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

let uid = 0;
export const nextId = () => (uid += 1);

export type Draft = Record<string, unknown> & { _id: number };
export const withId = (d: Record<string, unknown>): Draft => ({ ...d, _id: nextId() });
export function strip(d: Draft): Record<string, unknown> {
  const rest: Record<string, unknown> = { ...d };
  delete rest._id;
  return rest;
}

export const RANK_LABELS = ['untrained', 'trained', 'expert', 'master', 'legendary'];
export const EFFECT_KINDS = ['modifier', 'proficiency', 'grant', 'note', 'rollAdjust'] as const;
const GRANT_TYPES = ['sense', 'speed', 'resistance', 'weakness', 'immunity', 'trait', 'action'] as const;
const MOVEMENTS = ['land', 'fly', 'swim', 'climb', 'burrow'];

const SELECTOR_GROUPS = [
  { label: 'Defenses / core', options: FIXED_SELECTORS.filter((s) => !SAVE_SELECTORS.includes(s as never)) },
  { label: 'Saves', options: [...SAVE_SELECTORS] },
  { label: 'Skills', options: [...SKILL_SLUGS] },
];
export const RESIST_TYPES = [
  ...DAMAGE_TYPES,
  'poison', 'mental', 'bleed', 'spirit', 'holy', 'unholy', 'precision', 'critical-hits',
  ...DAMAGE_MATERIALS,
];

// ── expression field: a string parsed by the core grammar ────────────────────
/** Render a value AST back to compact infix text, so an existing expression is editable. */
export function exprToText(v: unknown): string {
  if (v === null || v === undefined || typeof v !== 'object') return String(v ?? '');
  const e = v as { kind?: string; value?: unknown; name?: string; fn?: string; args?: unknown[] };
  if (e.kind === 'lit') return String(e.value);
  if (e.kind === 'var') return e.name ?? '';
  if (e.kind === 'call') {
    const infix: Record<string, string> = { add: '+', subtract: '-', multiply: '*', divide: '/' };
    if (e.fn && infix[e.fn] && e.args?.length === 2) return `${exprToText(e.args[0])} ${infix[e.fn]} ${exprToText(e.args[1])}`;
    return `${e.fn}(${(e.args ?? []).map(exprToText).join(', ')})`;
  }
  return '';
}

export function ExprField({ value, onChange, placeholder = 'e.g. floor(level/2)' }: { value: unknown; onChange: (v: unknown) => void; placeholder?: string }) {
  const [text, setText] = useState(() => exprToText(value));
  const [err, setErr] = useState<string | null>(null);
  const set = (t: string) => {
    setText(t);
    if (!t.trim()) { setErr(null); onChange(undefined); return; }
    try { onChange(parseExpr(t)); setErr(null); }
    catch (e) { setErr(e instanceof Error ? e.message : 'parse error'); onChange({ _invalidExpr: t }); }
  };
  return (
    <span className="inline-flex flex-col">
      <input className={`${inputCls} w-48`} placeholder={placeholder} value={text} onChange={(e) => set(e.target.value)} />
      {err && <span className="text-[10px] text-red-300/80">{err}</span>}
    </span>
  );
}

// ── value AST (level-scaled idioms, a flat number, or a raw expression) ──────
export type ValueMode = 'flat' | 'halfLevel' | 'halfLevelMin1' | 'level' | 'expression';
const VALUE_MODES: { mode: ValueMode; label: string }[] = [
  { mode: 'flat', label: 'a fixed number' },
  { mode: 'halfLevel', label: 'half your level' },
  { mode: 'halfLevelMin1', label: 'half your level (min 1)' },
  { mode: 'level', label: 'your level' },
  { mode: 'expression', label: 'an expression…' },
];
const HALF = { kind: 'call', fn: 'floor', args: [{ kind: 'call', fn: 'divide', args: [{ kind: 'var', name: 'level' }, { kind: 'lit', value: 2 }] }] };
export function buildValue(mode: ValueMode, n: number): unknown {
  switch (mode) {
    case 'flat': return { kind: 'lit', value: n };
    case 'halfLevel': return HALF;
    case 'halfLevelMin1': return { kind: 'call', fn: 'max', args: [{ kind: 'lit', value: 1 }, HALF] };
    case 'level': return { kind: 'var', name: 'level' };
    case 'expression': return undefined; // filled by the ExprField
  }
}
function readValue(v: unknown): { mode: ValueMode; n: number } {
  const s = JSON.stringify(v);
  if (s === JSON.stringify(HALF)) return { mode: 'halfLevel', n: 0 };
  if (s === JSON.stringify(buildValue('halfLevelMin1', 0))) return { mode: 'halfLevelMin1', n: 0 };
  if (s === JSON.stringify(buildValue('level', 0))) return { mode: 'level', n: 0 };
  const lit = v as { kind?: string; value?: number } | undefined;
  if (lit?.kind === 'lit' && typeof lit.value === 'number') return { mode: 'flat', n: lit.value };
  if (v !== undefined) return { mode: 'expression', n: 0 }; // any other AST → editable expression
  return { mode: 'flat', n: 0 };
}

// ── inputs ────────────────────────────────────────────────────────────────────
/** The two BROADCAST tokens; the page fans them out to per-stat effects on select. */
export const BROADCAST = { 'all-saves': [...SAVE_SELECTORS], 'all-skills': [...SKILL_SLUGS] } as const;

export function SelectorField({ value, onChange, allowBroadcast }: { value: string; onChange: (v: string) => void; allowBroadcast?: boolean }) {
  return (
    <select className={inputCls} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">target…</option>
      {allowBroadcast && (
        <optgroup label="Broadcast (fans out)">
          <option value="all-saves">all saves</option>
          <option value="all-skills">all skills</option>
        </optgroup>
      )}
      {SELECTOR_GROUPS.map((g) => (
        <optgroup key={g.label} label={g.label}>
          {g.options.map((o) => <option key={o} value={o}>{o}</option>)}
        </optgroup>
      ))}
    </select>
  );
}

/**
 * A value editor: a mode dropdown + a number ("fixed") or a parsed expression. The mode is
 * derived from the value, but "expression" needs a local override — an unfilled expression is
 * indistinguishable from a default flat 0 by value alone.
 */
export function ValueField({ value, onValue }: { value: unknown; onValue: (v: unknown) => void }) {
  const derived = readValue(value);
  const [override, setOverride] = useState<ValueMode | null>(null);
  const mode = override ?? derived.mode;
  const pick = (m: ValueMode) => {
    setOverride(m);
    if (m !== 'expression') onValue(buildValue(m, derived.n)); // keep the value for the ExprField
  };
  return (
    <span className="inline-flex items-center gap-1">
      <select className={inputCls} value={mode} onChange={(e) => pick(e.target.value as ValueMode)}>
        {VALUE_MODES.map((m) => <option key={m.mode} value={m.mode}>{m.label}</option>)}
      </select>
      {mode === 'flat' && (
        <input type="number" className={`${inputCls} w-16`} value={derived.n} onChange={(e) => onValue(buildValue('flat', Number(e.target.value)))} />
      )}
      {mode === 'expression' && <ExprField value={value} onChange={onValue} placeholder="e.g. strengthMod + 2" />}
    </span>
  );
}

// ── the `when` predicate ──────────────────────────────────────────────────────
//
// A FLAT builder over core's predicate tree: a list of trait terms, each optionally
// negated, joined by all/any. That is deliberately less than the full grammar (it
// cannot nest, e.g. `all: [A, any: [B, C]]`), and it is enough for every conditional
// shape in the corpus — the tag vocabulary today is only creature and self traits.
//
// The honesty cost is paid explicitly: `readPredicate` returns null for any tree the
// flat builder cannot represent, and the field then shows it READ-ONLY rather than
// flattening it. Silently dropping a nesting level would corrupt the author's
// condition, which is the same failure as mapping an effect by dropping a condition.
// A full recursive editor is on the roadmap (docs, "Deferred").

/**
 * A term's namespace — `scope:category`, matching the tag prefix it builds. It carries
 * the CATEGORY too (not just the scope) because the vocabulary now has two: a trait, and
 * a condition an effect would cause.
 */
export type PredicateScope =
  | 'opponent:trait'
  | 'target:trait'
  | 'origin:trait'
  | 'effect:trait'
  | 'effect:causes'
  | 'self:trait'
  // The action being performed — `action:<slug>`. Unlike the others this is a
  // ONE-segment scope (an action name has no category), so it builds a 2-segment tag.
  | 'action';

export interface PredicateTerm {
  scope: PredicateScope;
  /** The trait, condition, or action slug — whichever the scope's category names. */
  value: string;
  negate: boolean;
}

const SCOPE_LABELS: { scope: PredicateScope; label: string }[] = [
  { scope: 'opponent:trait', label: 'vs a creature with' },
  { scope: 'target:trait', label: 'vs a creature you target with' },
  { scope: 'origin:trait', label: 'vs effects from a creature with' },
  { scope: 'effect:trait', label: 'vs an effect with' },
  { scope: 'effect:causes', label: 'vs an effect that would cause' },
  { scope: 'self:trait', label: 'when you have' },
  { scope: 'action', label: 'when performing the action' },
];
const SCOPES = SCOPE_LABELS.map((s) => s.scope);

/** De-slug an action name for a dropdown option: `make-an-impression` → `make an impression`. */
const actionLabel = (slug: string) => slug.replace(/-/g, ' ');
/** Action names sorted for a scannable dropdown. */
const ACTION_OPTIONS = [...ACTION_SLUGS].sort();

/**
 * Creature/self traits observed in the Foundry corpus's own predicates — a datalist
 * of SUGGESTIONS, never a constraint (free text still authors fine). Derived from the
 * data rather than written from memory, per the rules-from-source rule. Two entries
 * are excluded on purpose: `contruct` (a misspelling in their data) and a
 * `{item|flags…}` template artifact, neither of which is a trait.
 */
export const PREDICATE_TRAITS = [
  'aberration', 'air', 'amphibious', 'animal', 'aquatic', 'astral', 'beast', 'celestial',
  'chaotic', 'cleric', 'construct', 'demon', 'devil', 'dinosaur', 'dragon', 'earth',
  'elemental', 'elf', 'enchanted', 'environmental', 'ethereal', 'fey', 'fiend', 'fire',
  'fungus', 'giant', 'goblin', 'good', 'hag', 'haunt', 'holy', 'hryngar', 'human',
  'humanoid', 'incorporeal', 'kaiju', 'kami', 'magical', 'metal', 'monitor', 'ooze',
  'orc', 'plant', 'possessed', 'sakhil', 'spirit', 'sprite', 'stone', 'strix', 'trap',
  'undead', 'unholy', 'vampire', 'water', 'wood',
];

/**
 * Traits an EFFECT can carry (`effect:trait:` terms) — the raw trait vocabulary of the
 * spell corpus, which is where effect traits actually live. Also suggestions only.
 *
 * Deliberately unfiltered. It includes entries nobody would write a save bonus against
 * (`concentrate`, `uncommon`, class names), because the alternative is me deciding which
 * traits are "really" effect traits — a rules judgement from memory, which the
 * rules-from-source rule forbids. Noise in a filter-as-you-type list costs little;
 * silently dropping a legitimate trait would cost more.
 */
export const EFFECT_TRAITS = [
  'acid', 'air', 'animist', 'attack', 'auditory', 'aura', 'bard', 'beast', 'cantrip',
  'champion', 'chaotic', 'cleric', 'cold', 'composition', 'concentrate', 'consecration',
  'contingency', 'curse', 'cursebound', 'darkness', 'death', 'detection', 'disease',
  'dream', 'druid', 'earth', 'eidolon', 'electricity', 'emotion', 'evil', 'exploration',
  'extradimensional', 'fear', 'fire', 'focus', 'force', 'fortune', 'fungus', 'good',
  'grave', 'healing', 'hex', 'holy', 'illusion', 'incapacitation', 'incarnate',
  'incorporeal', 'light', 'linguistic', 'magus', 'manipulate', 'mental', 'metal',
  'misfortune', 'monk', 'morph', 'move', 'mythic', 'necromancer', 'nonlethal', 'olfactory',
  'oracle', 'plant', 'poison', 'polymorph', 'possession', 'prediction', 'psychic', 'ranger',
  'rare', 'revelation', 'sanctified', 'scrying', 'shadow', 'sleep', 'sonic', 'sorcerer',
  'spellshape', 'spirit', 'stance', 'structure', 'subtle', 'summon', 'summoner',
  'teleportation', 'trial', 'true-name', 'uncommon', 'unholy', 'unique', 'visual',
  'vitality', 'void', 'water', 'witch', 'wizard', 'wood',
];

/** Build a predicate from flat terms. Blank traits are ignored; no terms ⇒ unconditional. */
export function buildPredicate(terms: readonly PredicateTerm[], join: 'all' | 'any'): Predicate | undefined {
  const leaves = terms
    .filter((t) => t.value.trim())
    .map((t): Predicate => {
      const leaf: Predicate = { tag: `${t.scope}:${tagSlug(t.value)}` };
      return t.negate ? { not: leaf } : leaf;
    });
  if (leaves.length === 0) return undefined;
  if (leaves.length === 1) return leaves[0]!;
  return join === 'all' ? { all: leaves } : { any: leaves };
}

/** The plaintext of a top-level `{ prose }` predicate, or null if it isn't one. */
function readProse(pred: unknown): string | null {
  const p = pred as { prose?: unknown };
  return p && typeof p === 'object' && typeof p.prose === 'string' ? p.prose : null;
}

/** One flat leaf (`tag` or `not`-of-`tag`) back into a term, or null if it isn't one. */
function readTerm(node: unknown): PredicateTerm | null {
  const n = node as { tag?: unknown; not?: unknown };
  if (n && typeof n === 'object' && 'not' in n) {
    const inner = readTerm(n.not);
    return inner && !inner.negate ? { ...inner, negate: true } : null; // no double negation
  }
  if (!n || typeof n !== 'object' || typeof n.tag !== 'string') return null;
  const parts = n.tag.split(':');
  // `action:<slug>` — a one-segment scope, so it reads back before the 3-part check.
  // (`action:trait:<t>` deliberately stays unread → the field shows it read-only.)
  if (parts.length === 2 && parts[0] === 'action' && parts[1]) {
    return { scope: 'action', value: parts[1], negate: false };
  }
  if (parts.length !== 3 || !parts[2]) return null;
  const scope = `${parts[0]}:${parts[1]}` as PredicateScope;
  if (!SCOPES.includes(scope)) return null;
  return { scope, value: parts[2], negate: false };
}

/**
 * Read a predicate back into flat terms for editing. Returns `null` when the tree is
 * beyond the flat builder — the caller must then show it read-only rather than edit
 * it. An absent predicate reads as an empty (unconditional) term list.
 */
export function readPredicate(pred: unknown): { terms: PredicateTerm[]; join: 'all' | 'any' } | null {
  if (pred === undefined || pred === null) return { terms: [], join: 'any' };
  const p = pred as { all?: unknown; any?: unknown };
  const group = Array.isArray(p.all) ? p.all : Array.isArray(p.any) ? p.any : null;
  if (group === null) {
    const single = readTerm(pred);
    return single ? { terms: [single], join: 'any' } : null;
  }
  const terms: PredicateTerm[] = [];
  for (const child of group) {
    const t = readTerm(child);
    if (!t) return null; // a nested group — not representable here
    terms.push(t);
  }
  return { terms, join: Array.isArray(p.all) ? 'all' : 'any' };
}

/**
 * The `when` editor. Two modes:
 *   • STRUCTURED — the flat tag-vocabulary builder (scope + trait + negate), joined
 *     by and/or. What most conditions are.
 *   • PLAIN TEXT — an un-evaluable `{ prose }` condition for anything the vocabulary
 *     can't express ("against non-damaging effects"). It surfaces verbatim on the
 *     sheet and never auto-applies — the honest escape hatch instead of faking a trait.
 *
 * Either way it shows the condition as the PLAYER will read it (core's
 * `describePredicate`, the same prose the sheet renders), so an author can see that
 * "vs undead or fiend" is what they built.
 */
export function PredicateField({ value, onChange }: { value: unknown; onChange: (v: Predicate | undefined) => void }) {
  const proseFromValue = readProse(value);
  const parsed = readPredicate(value);
  const [mode, setMode] = useState<'structured' | 'plaintext'>(proseFromValue !== null ? 'plaintext' : 'structured');
  const [proseText, setProseText] = useState(proseFromValue ?? '');
  const [terms, setTerms] = useState<PredicateTerm[]>(() => parsed?.terms ?? []);
  const [join, setJoin] = useState<'all' | 'any'>(() => parsed?.join ?? 'any');

  // Switching modes re-emits the value in the target representation, so the parent's
  // `when` is never left as the mode we just navigated away from.
  const switchTo = (m: 'structured' | 'plaintext') => {
    if (m === mode) return;
    setMode(m);
    onChange(m === 'plaintext' ? (proseText.trim() ? { prose: proseText.trim() } : undefined) : buildPredicate(terms, join));
  };

  const ModeToggle = (
    <div className="flex gap-1 text-[11px]">
      {(['structured', 'plaintext'] as const).map((m) => (
        <button
          key={m}
          onClick={() => switchTo(m)}
          className={`rounded border px-1.5 py-0.5 ${mode === m ? 'border-gold/50 bg-gold/10 text-gold' : 'border-gold/15 text-parchment/50 hover:text-parchment'}`}
        >
          {m === 'structured' ? 'structured' : 'plain text'}
        </button>
      ))}
    </div>
  );

  if (mode === 'plaintext') {
    const setProse = (text: string) => {
      setProseText(text);
      onChange(text.trim() ? { prose: text.trim() } : undefined);
    };
    return (
      <div className="flex flex-col gap-1">
        {ModeToggle}
        <input
          className={inputCls}
          value={proseText}
          onChange={(e) => setProse(e.target.value)}
          placeholder={'describe the condition, e.g. "against non-damaging effects"'}
        />
        <span className="text-[11px] text-parchment/50">
          shown verbatim on the sheet; never applied automatically — the player judges when it holds
        </span>
      </div>
    );
  }

  // Structured mode, beyond the flat builder — show it, refuse to mangle it. A prose
  // value is excluded: it belongs to plain-text mode, which the toggle above reaches.
  if (parsed === null && proseFromValue === null) {
    return (
      <div className="rounded border border-gold/15 bg-midnight-950/40 px-2 py-1.5">
        {ModeToggle}
        <div className="mt-1 text-[11px] text-parchment/50">
          condition: too complex to edit here (nested) — left untouched
        </div>
        <pre className="mt-1 overflow-auto text-[10px] text-parchment/60">{JSON.stringify(value)}</pre>
      </div>
    );
  }

  const push = (nextTerms: PredicateTerm[], nextJoin: 'all' | 'any' = join) => {
    setTerms(nextTerms);
    setJoin(nextJoin);
    onChange(buildPredicate(nextTerms, nextJoin));
  };
  const patch = (i: number, p: Partial<PredicateTerm>) => push(terms.map((t, j) => (j === i ? { ...t, ...p } : t)));
  const built = buildPredicate(terms, join);

  return (
    <div className="flex flex-col gap-1">
      {ModeToggle}
      {terms.map((t, i) => (
        <div key={i} className="flex flex-wrap items-center gap-1.5">
          {i > 0 && (
            <select className={`${inputCls} w-16`} value={join} onChange={(e) => push(terms, e.target.value as 'all' | 'any')}>
              <option value="any">or</option>
              <option value="all">and</option>
            </select>
          )}
          <select className={inputCls} value={t.scope} onChange={(e) => patch(i, { scope: e.target.value as PredicateScope })}>
            {SCOPE_LABELS.map((s) => <option key={s.scope} value={s.scope}>{s.label}</option>)}
          </select>
          <button
            onClick={() => patch(i, { negate: !t.negate })}
            className={`rounded border px-1.5 py-0.5 text-xs ${t.negate ? 'border-gold/50 bg-gold/10 text-gold' : 'border-gold/15 text-parchment/50 hover:text-parchment'}`}
            title="negate this term"
          >
            not
          </button>
          {t.scope === 'effect:causes' ? (
            // Conditions are a CLOSED 41-slug vocabulary, so this is a real select — a
            // typo here would otherwise build a predicate that silently never matches.
            <select className={`${inputCls} w-36`} value={t.value} onChange={(e) => patch(i, { value: e.target.value })}>
              <option value="">condition…</option>
              {CONDITION_SLUGS.map((c) => (
                <option key={c} value={c}>{CONDITIONS[c].name}</option>
              ))}
            </select>
          ) : t.scope === 'action' ? (
            // Action names are a CLOSED vocabulary too (core's ACTION_SLUGS) — a select,
            // so an unrecognized name can't build a condition that never fires.
            <select className={`${inputCls} w-44`} value={t.value} onChange={(e) => patch(i, { value: e.target.value })}>
              <option value="">action…</option>
              {ACTION_OPTIONS.map((a) => (
                <option key={a} value={a}>{actionLabel(a)}</option>
              ))}
            </select>
          ) : (
            <input className={`${inputCls} w-36`} list={t.scope === 'effect:trait' ? 'effect-traits' : 'predicate-traits'} placeholder="trait" value={t.value} onChange={(e) => patch(i, { value: e.target.value })} />
          )}
          <button onClick={() => push(terms.filter((_, j) => j !== i))} className="text-parchment/40 hover:text-red-300" title="remove">✕</button>
        </div>
      ))}
      <div className="flex items-center gap-2">
        <button
          onClick={() => push([...terms, { scope: 'opponent:trait', value: '', negate: false }])}
          className="w-fit rounded border border-gold/20 px-2 py-0.5 text-xs text-parchment/70 hover:bg-midnight-900/60"
        >
          + condition
        </button>
        {built && <span className="text-xs text-emerald-soft/80">{describePredicate(built)}</span>}
      </div>
    </div>
  );
}

// ── the per-kind passive-effect form ─────────────────────────────────────────
/**
 * The kinds that carry a `when` in the schema. `proficiency` is deliberately absent —
 * a raised rank is a permanent property of the sheet, not momentary state, so
 * `proficiencyEffectSchema` has no predicate. The form mirrors that distinction
 * rather than offering a control the schema would reject.
 */
const WHEN_KINDS = new Set(['modifier', 'grant', 'rollAdjust', 'note']);

/** The four degrees, worst → best, as core orders them. */
const DEGREES = ['critical-failure', 'failure', 'success', 'critical-success'] as const;
const DEGREE_LABEL: Record<string, string> = {
  'critical-failure': 'critical failure',
  failure: 'failure',
  success: 'success',
  'critical-success': 'critical success',
};

/** A fresh payload per `adjust` type, so switching never leaves a half-built shape. */
const NEW_ADJUST: Record<string, Record<string, unknown>> = {
  degreeMap: { type: 'degreeMap', map: {} },
  degree: { type: 'degree', direction: 'improve' },
  reroll: { type: 'reroll', keep: 'higher' },
};

/**
 * The per-degree rewrite editor: one row per incoming degree, each optionally becoming
 * another. This IS the shape of the prose — "when you roll a success, you get a
 * critical success instead" is one row — and a floor needs no separate control, since
 * Forager's "any result worse than a success" is simply the two rows below success
 * both pointing at it.
 *
 * Rows the author leaves alone are absent from the map, which is what makes the effect
 * conditional: a degree with no row is untouched.
 */
function DegreeMapField({ map, onChange }: { map: Record<string, string>; onChange: (m: Record<string, string>) => void }) {
  const set = (from: string, to: string) => {
    const next = { ...map };
    if (to) next[from] = to;
    else delete next[from];
    onChange(next);
  };
  return (
    <div className="rounded border border-gold/15 bg-midnight-950/40 px-2 py-1.5">
      <div className="mb-1 text-xs uppercase tracking-wide text-parchment/50">when you roll…</div>
      <div className="flex flex-col gap-1">
        {DEGREES.map((from) => (
          <div key={from} className="flex items-center gap-2 text-sm">
            <span className="w-28 text-parchment/70">{DEGREE_LABEL[from]}</span>
            <span className="text-parchment/40">→</span>
            <select className={inputCls} value={map[from] ?? ''} onChange={(e) => set(from, e.target.value)}>
              <option value="">(unchanged)</option>
              {DEGREES.filter((d) => d !== from).map((to) => (
                <option key={to} value={to}>{DEGREE_LABEL[to]}</option>
              ))}
            </select>
          </div>
        ))}
      </div>
      {Object.keys(map).length === 0 && (
        <div className="mt-1 text-xs text-amber-300/70">Rewrite at least one result, or this effect says nothing.</div>
      )}
    </div>
  );
}

export function EffectForm({ draft, onPatch, allowBroadcast }: { draft: Draft; onPatch: (p: Record<string, unknown>) => void; allowBroadcast?: boolean }) {
  const body = KindFields({ draft, onPatch, allowBroadcast });
  if (!WHEN_KINDS.has(String(draft.kind))) return body;
  return (
    <div className="flex flex-col gap-1.5">
      {body}
      <PredicateField value={draft.when} onChange={(w) => onPatch({ when: w })} />
    </div>
  );
}

function KindFields({ draft, onPatch, allowBroadcast }: { draft: Draft; onPatch: (p: Record<string, unknown>) => void; allowBroadcast?: boolean }) {
  const grant = (draft.grant as Record<string, unknown>) ?? {};
  const patchGrant = (p: Record<string, unknown>) => onPatch({ grant: { ...grant, ...p } });
  const adjust = (draft.adjust as Record<string, unknown>) ?? {};

  switch (draft.kind) {
    case 'modifier':
      return (
        <div className="flex flex-wrap items-center gap-2">
          <SelectorField value={(draft.target as string) ?? ''} onChange={(v) => onPatch({ target: v })} allowBroadcast={allowBroadcast} />
          <select className={inputCls} value={(draft.bonusType as string) ?? ''} onChange={(e) => onPatch({ bonusType: e.target.value })}>
            <option value="">type…</option>
            {['circumstance', 'status', 'item', 'untyped'].map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <ValueField value={draft.value} onValue={(v) => onPatch({ value: v })} />
        </div>
      );
    case 'proficiency':
      return (
        <div className="flex flex-wrap items-center gap-2">
          <SelectorField value={(draft.target as string) ?? ''} onChange={(v) => onPatch({ target: v })} />
          <select className={inputCls} value={(draft.rank as number) ?? 1} onChange={(e) => onPatch({ rank: Number(e.target.value) })}>
            {RANK_LABELS.map((r, i) => <option key={r} value={i}>{r}</option>)}
          </select>
          <select className={inputCls} value={(draft.mode as string) ?? 'upgrade'} onChange={(e) => onPatch({ mode: e.target.value })}>
            <option value="upgrade">upgrade to</option>
            <option value="set">set to</option>
          </select>
        </div>
      );
    case 'grant':
      return (
        <div className="flex flex-wrap items-center gap-2">
          <select className={inputCls} value={(grant.type as string) ?? ''} onChange={(e) => onPatch({ grant: { type: e.target.value } })}>
            <option value="">grant…</option>
            {GRANT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          {grant.type === 'sense' && (
            <>
              <input className={inputCls} placeholder="sense name" value={(grant.name as string) ?? ''} onChange={(e) => patchGrant({ name: e.target.value })} />
              <select className={inputCls} value={(grant.acuity as string) ?? ''} onChange={(e) => patchGrant({ acuity: e.target.value || undefined })}>
                <option value="">acuity…</option>
                {['precise', 'imprecise', 'vague'].map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
              <input type="number" className={`${inputCls} w-16`} placeholder="range" value={(grant.range as number) ?? ''} onChange={(e) => patchGrant({ range: e.target.value ? Number(e.target.value) : undefined })} />
            </>
          )}
          {grant.type === 'speed' && (
            <>
              <select className={inputCls} value={(grant.movement as string) ?? ''} onChange={(e) => patchGrant({ movement: e.target.value })}>
                <option value="">movement…</option>
                {MOVEMENTS.map((mv) => <option key={mv} value={mv}>{mv}</option>)}
              </select>
              <ValueField value={grant.value} onValue={(v) => patchGrant({ value: v })} />
            </>
          )}
          {(grant.type === 'resistance' || grant.type === 'weakness') && (
            <>
              <input className={inputCls} list="resist-types" placeholder="damage type" value={(grant.damageType as string) ?? ''} onChange={(e) => patchGrant({ damageType: e.target.value })} />
              <ValueField value={grant.value} onValue={(v) => patchGrant({ value: v })} />
            </>
          )}
          {grant.type === 'immunity' && (
            <input className={inputCls} placeholder="immune to…" value={(grant.to as string) ?? ''} onChange={(e) => patchGrant({ to: e.target.value })} />
          )}
          {grant.type === 'trait' && (
            <input className={inputCls} placeholder="trait" value={(grant.trait as string) ?? ''} onChange={(e) => patchGrant({ trait: e.target.value })} />
          )}
          {grant.type === 'action' && (
            <input className={inputCls} placeholder="action ref" value={(grant.ref as string) ?? ''} onChange={(e) => patchGrant({ ref: e.target.value })} />
          )}
        </div>
      );
    case 'note':
      return (
        <div className="flex flex-wrap items-center gap-2">
          <SelectorField value={(draft.target as string) ?? ''} onChange={(v) => onPatch({ target: v })} />
          <input className={`${inputCls} min-w-64 flex-1`} placeholder="note text" value={(draft.text as string) ?? ''} onChange={(e) => onPatch({ text: e.target.value })} />
        </div>
      );
    case 'rollAdjust':
      return (
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <SelectorField value={(draft.target as string) ?? ''} onChange={(v) => onPatch({ target: v })} allowBroadcast={allowBroadcast} />
            <select className={inputCls} value={(adjust.type as string) ?? 'degreeMap'} onChange={(e) => onPatch({ adjust: NEW_ADJUST[e.target.value] ?? NEW_ADJUST.degreeMap })}>
              <option value="degreeMap">on a result…</option>
              <option value="degree">shift every result</option>
              <option value="reroll">reroll</option>
            </select>
            {adjust.type === 'reroll' && (
              <select className={inputCls} value={(adjust.keep as string) ?? 'higher'} onChange={(e) => onPatch({ adjust: { type: 'reroll', keep: e.target.value } })}>
                <option value="higher">keep higher</option>
                <option value="lower">keep lower</option>
              </select>
            )}
            {adjust.type === 'degree' && (
              <select className={inputCls} value={(adjust.direction as string) ?? 'improve'} onChange={(e) => onPatch({ adjust: { type: 'degree', direction: e.target.value } })}>
                <option value="improve">one degree better</option>
                <option value="worsen">one degree worse</option>
              </select>
            )}
          </div>
          {(adjust.type ?? 'degreeMap') === 'degreeMap' && (
            <DegreeMapField
              map={(adjust.map as Record<string, string>) ?? {}}
              onChange={(map) => onPatch({ adjust: { type: 'degreeMap', map } })}
            />
          )}
        </div>
      );
    default:
      return null;
  }
}

export function validatePassive(draft: Draft): string[] {
  const r = passiveEffectSchema.safeParse(strip(draft));
  return r.success ? [] : r.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
}
