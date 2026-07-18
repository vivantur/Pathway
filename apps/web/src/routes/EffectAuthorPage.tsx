import { useMemo, useState } from 'react';
import {
  passiveEffectSchema,
  effectChoiceSchema,
  FIXED_SELECTORS,
  SKILL_SLUGS,
  SAVE_SELECTORS,
  DAMAGE_TYPES,
  DAMAGE_MATERIALS,
} from '@pathway/core';
import featData from '@/features/builder/data/feats.json';
import { GildedRule } from '@/components/ui/GildedRule';
import { GrimoireMarkdown } from '@/components/ui/GrimoireMarkdown';

/**
 * Effect authoring — the homebrew effect editor (design doc, stage 3). This is where a
 * human BUILDS an entity's effects, rather than reviewing what the machine mapped. It is
 * the same surface the review UI's "edit" action will embed, and the tool for the effects
 * that cannot be auto-derived at all (granted actions).
 *
 * SCHEMA-DRIVEN, AND THE SCHEMA IS THE DIAGNOSTIC. Every form emits a draft validated live
 * against the core Zod schema every other consumer uses. "This feat can't be built" shows
 * up as a validation failure or a field the vocabulary lacks — exactly the gaps we're
 * hunting. Nothing here is applied; the output is authored content JSON, folded in later.
 *
 * SLICE 1: Layer-1 passives (the five kinds) + skill-proficiency choices. The automation
 * tree editor (granted actions, cross-creature applyEffect) is slice 2 — the content slot
 * for it (`actions`) already exists on the schema.
 */

const SELECTOR_GROUPS = [
  { label: 'Defenses / core', options: FIXED_SELECTORS.filter((s) => !SAVE_SELECTORS.includes(s as never)) },
  { label: 'Saves', options: [...SAVE_SELECTORS] },
  { label: 'Skills', options: [...SKILL_SLUGS] },
];
const RESIST_TYPES = [
  ...DAMAGE_TYPES,
  'poison', 'mental', 'bleed', 'spirit', 'holy', 'unholy', 'precision', 'critical-hits',
  ...DAMAGE_MATERIALS,
];
const RANK_LABELS = ['untrained', 'trained', 'expert', 'master', 'legendary'];
const EFFECT_KINDS = ['modifier', 'proficiency', 'grant', 'note', 'rollAdjust'] as const;
const GRANT_TYPES = ['sense', 'speed', 'resistance', 'weakness', 'immunity', 'trait', 'action'] as const;
const MOVEMENTS = ['land', 'fly', 'swim', 'climb', 'burrow'];

// ── value AST (the level-scaled idioms + a flat number), both ways ───────────
type ValueMode = 'flat' | 'halfLevel' | 'halfLevelMin1' | 'level';
const VALUE_MODES: { mode: ValueMode; label: string }[] = [
  { mode: 'flat', label: 'a fixed number' },
  { mode: 'halfLevel', label: 'half your level' },
  { mode: 'halfLevelMin1', label: 'half your level (min 1)' },
  { mode: 'level', label: 'your level' },
];
const HALF = { kind: 'call', fn: 'floor', args: [{ kind: 'call', fn: 'divide', args: [{ kind: 'var', name: 'level' }, { kind: 'lit', value: 2 }] }] };
function buildValue(mode: ValueMode, n: number): unknown {
  switch (mode) {
    case 'flat': return { kind: 'lit', value: n };
    case 'halfLevel': return HALF;
    case 'halfLevelMin1': return { kind: 'call', fn: 'max', args: [{ kind: 'lit', value: 1 }, HALF] };
    case 'level': return { kind: 'var', name: 'level' };
  }
}
/** Recognize a value AST as one of the editable idioms, for loading existing effects. */
function readValue(v: unknown): { mode: ValueMode; n: number } | null {
  const s = JSON.stringify(v);
  if (s === JSON.stringify(HALF)) return { mode: 'halfLevel', n: 0 };
  if (s === JSON.stringify(buildValue('halfLevelMin1', 0))) return { mode: 'halfLevelMin1', n: 0 };
  if (s === JSON.stringify(buildValue('level', 0))) return { mode: 'level', n: 0 };
  const lit = v as { kind?: string; value?: number } | undefined;
  if (lit?.kind === 'lit' && typeof lit.value === 'number') return { mode: 'flat', n: lit.value };
  return null;
}

let uid = 0;
type Draft = Record<string, unknown> & { _id: number };
const withId = (d: Record<string, unknown>): Draft => ({ ...d, _id: (uid += 1) });
function strip(d: Draft): Record<string, unknown> {
  const rest: Record<string, unknown> = { ...d };
  delete rest._id;
  return rest;
}

// ── small inputs ─────────────────────────────────────────────────────────────
const inputCls = 'rounded border border-gold/20 bg-midnight-950/60 px-2 py-1 text-sm text-parchment';

function SelectorField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <select className={inputCls} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">target…</option>
      {SELECTOR_GROUPS.map((g) => (
        <optgroup key={g.label} label={g.label}>
          {g.options.map((o) => <option key={o} value={o}>{o}</option>)}
        </optgroup>
      ))}
    </select>
  );
}

/** The value editor: a mode dropdown, plus a number when the mode is "a fixed number". */
function ValueField({ draft, onPatch }: { draft: Draft; onPatch: (p: Record<string, unknown>) => void }) {
  const parsed = readValue(draft.value);
  const mode = parsed?.mode ?? 'flat';
  const n = parsed?.n ?? 0;
  const advanced = draft.value !== undefined && parsed === null;
  if (advanced) {
    return <span className="text-xs text-brass" title={JSON.stringify(draft.value)}>advanced expression (edit as JSON)</span>;
  }
  return (
    <span className="inline-flex items-center gap-1">
      <select className={inputCls} value={mode} onChange={(e) => onPatch({ value: buildValue(e.target.value as ValueMode, n) })}>
        {VALUE_MODES.map((m) => <option key={m.mode} value={m.mode}>{m.label}</option>)}
      </select>
      {mode === 'flat' && (
        <input type="number" className={`${inputCls} w-16`} value={n} onChange={(e) => onPatch({ value: buildValue('flat', Number(e.target.value)) })} />
      )}
    </span>
  );
}

// ── the per-kind form ────────────────────────────────────────────────────────
function EffectForm({ draft, onPatch }: { draft: Draft; onPatch: (p: Record<string, unknown>) => void }) {
  const grant = (draft.grant as Record<string, unknown>) ?? {};
  const patchGrant = (p: Record<string, unknown>) => onPatch({ grant: { ...grant, ...p } });
  const adjust = (draft.adjust as Record<string, unknown>) ?? {};

  switch (draft.kind) {
    case 'modifier':
      return (
        <div className="flex flex-wrap items-center gap-2">
          <SelectorField value={(draft.target as string) ?? ''} onChange={(v) => onPatch({ target: v })} />
          <select className={inputCls} value={(draft.bonusType as string) ?? ''} onChange={(e) => onPatch({ bonusType: e.target.value })}>
            <option value="">type…</option>
            {['circumstance', 'status', 'item', 'untyped'].map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <ValueField draft={draft} onPatch={onPatch} />
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
              <ValueField draft={{ _id: draft._id, value: grant.value }} onPatch={(p) => patchGrant(p)} />
            </>
          )}
          {(grant.type === 'resistance' || grant.type === 'weakness') && (
            <>
              <input className={inputCls} list="resist-types" placeholder="damage type" value={(grant.damageType as string) ?? ''} onChange={(e) => patchGrant({ damageType: e.target.value })} />
              <ValueField draft={{ _id: draft._id, value: grant.value }} onPatch={(p) => patchGrant(p)} />
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
        <div className="flex flex-wrap items-center gap-2">
          <SelectorField value={(draft.target as string) ?? ''} onChange={(v) => onPatch({ target: v })} />
          <select className={inputCls} value={(adjust.type as string) ?? 'degree'} onChange={(e) => onPatch({ adjust: e.target.value === 'degree' ? { type: 'degree', direction: 'improve' } : { type: 'reroll', keep: 'higher' } })}>
            <option value="degree">degree shift</option>
            <option value="reroll">reroll</option>
          </select>
          {adjust.type === 'reroll' ? (
            <select className={inputCls} value={(adjust.keep as string) ?? 'higher'} onChange={(e) => onPatch({ adjust: { type: 'reroll', keep: e.target.value } })}>
              <option value="higher">keep higher</option>
              <option value="lower">keep lower</option>
            </select>
          ) : (
            <select className={inputCls} value={(adjust.direction as string) ?? 'improve'} onChange={(e) => onPatch({ adjust: { type: 'degree', direction: e.target.value } })}>
              <option value="improve">improve</option>
              <option value="worsen">worsen</option>
            </select>
          )}
        </div>
      );
    default:
      return null;
  }
}

// ── validation ───────────────────────────────────────────────────────────────
function validate(draft: Draft): string[] {
  const r = passiveEffectSchema.safeParse(strip(draft));
  return r.success ? [] : r.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
}

// ── choices (skill proficiency) ──────────────────────────────────────────────
// A focused editor for the dominant choice shape: pick N skills + a rank → an EffectChoice
// whose options each grant that proficiency. The full nested-effect choice is a later step.
interface ChoiceDraft { _id: number; prompt: string; rank: number; skills: string[] }
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
function buildChoice(c: ChoiceDraft): Record<string, unknown> {
  return {
    flag: 'skill-choice',
    prompt: c.prompt || 'Skill',
    options: c.skills.map((s) => ({ value: s, label: cap(s), effects: [{ kind: 'proficiency', target: s, rank: c.rank, mode: 'upgrade' }] })),
  };
}
function validateChoice(c: ChoiceDraft): string[] {
  const r = effectChoiceSchema.safeParse(buildChoice(c));
  return r.success ? [] : r.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
}

// ── the page ─────────────────────────────────────────────────────────────────
interface FeatLite { id: string; name: string; description?: string; effects?: unknown[] }
const FEATS = featData as FeatLite[];

export function EffectAuthorPage() {
  const [query, setQuery] = useState('');
  const [feat, setFeat] = useState<FeatLite | null>(null);
  const [effects, setEffects] = useState<Draft[]>([]);
  const [choices, setChoices] = useState<ChoiceDraft[]>([]);
  const [showText, setShowText] = useState(true);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return FEATS.filter((f) => f.name.toLowerCase().includes(q)).slice(0, 8);
  }, [query]);

  const load = (f: FeatLite) => {
    setFeat(f);
    setQuery('');
    setEffects((f.effects ?? []).map((e) => withId(e as Record<string, unknown>)));
    setChoices([]);
  };

  const patchChoice = (id: number, p: Partial<ChoiceDraft>) => setChoices((prev) => prev.map((c) => (c._id === id ? { ...c, ...p } : c)));
  const toggleSkill = (id: number, skill: string) =>
    setChoices((prev) => prev.map((c) => (c._id === id ? { ...c, skills: c.skills.includes(skill) ? c.skills.filter((s) => s !== skill) : [...c.skills, skill] } : c)));

  const patch = (id: number, p: Record<string, unknown>) =>
    setEffects((prev) => prev.map((d) => (d._id === id ? { ...d, ...p } : d)));
  const addEffect = (kind: string) => setEffects((prev) => [...prev, withId({ kind })]);
  const removeEffect = (id: number) => setEffects((prev) => prev.filter((d) => d._id !== id));

  const authored = effects.map(strip);
  const authoredChoices = choices.map(buildChoice);
  const allValid = effects.every((d) => validate(d).length === 0) && choices.every((c) => validateChoice(c).length === 0);
  const exportJson = () => {
    const content = { id: feat?.id, name: feat?.name, effects: authored, ...(authoredChoices.length ? { choices: authoredChoices } : {}) };
    const blob = new Blob([`${JSON.stringify(content, null, 2)}\n`], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${feat?.id ?? 'effect'}.authored.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <h1 className="font-display text-3xl text-gold">Effect authoring</h1>
      <p className="mt-3 max-w-3xl text-parchment/80">
        Build an entity's effects by hand — the homebrew editor, and the surface for what the
        machine can't map. Every row is validated live against the same schema the sheet reads;
        an effect it can't express is a gap worth knowing about.
      </p>
      <GildedRule className="my-6" />

      {/* entity picker */}
      <div className="relative max-w-md">
        <input
          className="w-full rounded-md border border-gold/20 bg-midnight-900/60 px-3 py-2 text-sm text-parchment placeholder:text-parchment/40"
          placeholder="Search a feat to load, or edit a blank one…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {matches.length > 0 && (
          <div className="absolute z-10 mt-1 w-full rounded-md border border-gold/20 bg-midnight-950 shadow-lg">
            {matches.map((f) => (
              <button key={f.id} onClick={() => load(f)} className="block w-full px-3 py-1.5 text-left text-sm text-parchment hover:bg-midnight-900">
                {f.name} {f.effects?.length ? <span className="text-parchment/40">· {f.effects.length} effect(s)</span> : null}
              </button>
            ))}
          </div>
        )}
      </div>

      {feat && (
        <div className="mt-4 flex items-center gap-3">
          <span className="font-ui text-lg text-gold">{feat.name}</span>
          <button onClick={() => { setFeat(null); setEffects([]); }} className="text-xs text-parchment/50 hover:text-gold">clear</button>
          {feat.description && (
            <label className="ml-auto flex items-center gap-1.5 text-xs text-parchment/60">
              <input type="checkbox" checked={showText} onChange={(e) => setShowText(e.target.checked)} /> feat text
            </label>
          )}
        </div>
      )}
      {feat?.description && showText && (
        <div className="mt-2 max-h-56 overflow-y-auto rounded-md border border-gold/15 bg-midnight-950/60 p-3">
          <GrimoireMarkdown strip={['access', 'source']}>{feat.description}</GrimoireMarkdown>
        </div>
      )}

      {/* effects editor */}
      <h2 className="mt-8 font-display text-xl text-gold">Effects</h2>
      <div className="mt-3 space-y-2">
        {effects.map((d) => {
          const issues = validate(d);
          return (
            <div key={d._id} className={`rounded-md border p-3 ${issues.length ? 'border-red-500/30 bg-red-500/5' : 'border-emerald/25 bg-emerald/5'}`}>
              <div className="flex items-start gap-3">
                <span className="mt-1 w-20 shrink-0 font-ui text-sm text-gold">{String(d.kind)}</span>
                <div className="flex-1">
                  <EffectForm draft={d} onPatch={(p) => patch(d._id, p)} />
                  {issues.map((iss, i) => <div key={i} className="mt-1 text-xs text-red-300/80">{iss}</div>)}
                </div>
                <button onClick={() => removeEffect(d._id)} className="text-parchment/40 hover:text-red-300">✕</button>
              </div>
            </div>
          );
        })}
        {effects.length === 0 && <p className="text-sm text-parchment/50">No effects yet. Add one below.</p>}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="text-sm text-parchment/50">add:</span>
        {EFFECT_KINDS.map((k) => (
          <button key={k} onClick={() => addEffect(k)} className="rounded border border-gold/25 px-2.5 py-1 text-sm text-parchment hover:bg-midnight-900/60">
            + {k}
          </button>
        ))}
      </div>

      {/* choices editor — skill proficiency */}
      <h2 className="mt-8 font-display text-xl text-gold">Choices <span className="text-sm font-normal text-parchment/50">(skill proficiency)</span></h2>
      <div className="mt-3 space-y-2">
        {choices.map((c) => {
          const issues = validateChoice(c);
          return (
            <div key={c._id} className={`rounded-md border p-3 ${issues.length ? 'border-red-500/30 bg-red-500/5' : 'border-emerald/25 bg-emerald/5'}`}>
              <div className="flex flex-wrap items-center gap-2">
                <input className={`${inputCls} w-32`} placeholder="prompt" value={c.prompt} onChange={(e) => patchChoice(c._id, { prompt: e.target.value })} />
                <select className={inputCls} value={c.rank} onChange={(e) => patchChoice(c._id, { rank: Number(e.target.value) })}>
                  {RANK_LABELS.map((r, i) => <option key={r} value={i}>{r}</option>)}
                </select>
                <span className="text-xs text-parchment/50">in one of:</span>
                <button onClick={() => setChoices((prev) => prev.filter((x) => x._id !== c._id))} className="ml-auto text-parchment/40 hover:text-red-300">✕</button>
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                {SKILL_SLUGS.map((s) => (
                  <button
                    key={s}
                    onClick={() => toggleSkill(c._id, s)}
                    className={`rounded border px-1.5 py-0.5 text-xs ${c.skills.includes(s) ? 'border-gold/50 bg-gold/10 text-gold' : 'border-gold/15 text-parchment/60 hover:text-parchment'}`}
                  >
                    {s}
                  </button>
                ))}
              </div>
              {issues.map((iss, i) => <div key={i} className="mt-1 text-xs text-red-300/80">{iss}</div>)}
            </div>
          );
        })}
      </div>
      <button
        onClick={() => setChoices((prev) => [...prev, { _id: (uid += 1), prompt: 'Skill', rank: 1, skills: [] }])}
        className="mt-3 rounded border border-gold/25 px-2.5 py-1 text-sm text-parchment hover:bg-midnight-900/60"
      >
        + skill choice
      </button>

      {/* output */}
      <h2 className="mt-8 font-display text-xl text-gold">Authored content</h2>
      <div className="mt-2 flex items-center gap-3">
        <span className={`text-sm ${allValid ? 'text-emerald-soft' : 'text-red-300/80'}`}>
          {allValid ? `✓ ${effects.length} effect(s), ${choices.length} choice(s) valid` : 'some entries are invalid'}
        </span>
        <button onClick={exportJson} disabled={!feat || !allValid || (effects.length === 0 && choices.length === 0)} className="rounded-md border border-gold/30 bg-gold/10 px-3 py-1.5 text-sm text-gold hover:border-gold/60 disabled:opacity-40">
          Export JSON
        </button>
      </div>
      <pre className="mt-3 max-h-80 overflow-auto rounded-md border border-gold/15 bg-midnight-950/70 p-3 text-[11px] leading-relaxed text-parchment/70">
        {JSON.stringify({ effects: authored, ...(authoredChoices.length ? { choices: authoredChoices } : {}) }, null, 2)}
      </pre>

      <datalist id="resist-types">
        {RESIST_TYPES.map((t) => <option key={t} value={t} />)}
      </datalist>

      <p className="mt-8 text-xs text-parchment/40">
        Slice 1: Layer-1 passive effects. Granted actions (the automation tree) are slice 2 — the
        content slot exists; the editor for it is next.
      </p>
    </div>
  );
}
