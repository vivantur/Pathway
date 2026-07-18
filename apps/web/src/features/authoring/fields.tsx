import { useState } from 'react';
import {
  passiveEffectSchema,
  parseExpr,
  FIXED_SELECTORS,
  SKILL_SLUGS,
  SAVE_SELECTORS,
  DAMAGE_TYPES,
  DAMAGE_MATERIALS,
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

// ── the per-kind passive-effect form ─────────────────────────────────────────
export function EffectForm({ draft, onPatch, allowBroadcast }: { draft: Draft; onPatch: (p: Record<string, unknown>) => void; allowBroadcast?: boolean }) {
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

export function validatePassive(draft: Draft): string[] {
  const r = passiveEffectSchema.safeParse(strip(draft));
  return r.success ? [] : r.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
}
