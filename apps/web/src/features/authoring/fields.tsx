import {
  passiveEffectSchema,
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

// ── value AST (the level-scaled idioms + a flat number), both directions ─────
export type ValueMode = 'flat' | 'halfLevel' | 'halfLevelMin1' | 'level';
const VALUE_MODES: { mode: ValueMode; label: string }[] = [
  { mode: 'flat', label: 'a fixed number' },
  { mode: 'halfLevel', label: 'half your level' },
  { mode: 'halfLevelMin1', label: 'half your level (min 1)' },
  { mode: 'level', label: 'your level' },
];
const HALF = { kind: 'call', fn: 'floor', args: [{ kind: 'call', fn: 'divide', args: [{ kind: 'var', name: 'level' }, { kind: 'lit', value: 2 }] }] };
export function buildValue(mode: ValueMode, n: number): unknown {
  switch (mode) {
    case 'flat': return { kind: 'lit', value: n };
    case 'halfLevel': return HALF;
    case 'halfLevelMin1': return { kind: 'call', fn: 'max', args: [{ kind: 'lit', value: 1 }, HALF] };
    case 'level': return { kind: 'var', name: 'level' };
  }
}
function readValue(v: unknown): { mode: ValueMode; n: number } | null {
  const s = JSON.stringify(v);
  if (s === JSON.stringify(HALF)) return { mode: 'halfLevel', n: 0 };
  if (s === JSON.stringify(buildValue('halfLevelMin1', 0))) return { mode: 'halfLevelMin1', n: 0 };
  if (s === JSON.stringify(buildValue('level', 0))) return { mode: 'level', n: 0 };
  const lit = v as { kind?: string; value?: number } | undefined;
  if (lit?.kind === 'lit' && typeof lit.value === 'number') return { mode: 'flat', n: lit.value };
  return null;
}

// ── inputs ────────────────────────────────────────────────────────────────────
export function SelectorField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
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

/** A value editor: a mode dropdown + a number when "a fixed number". `value` in, patch out. */
export function ValueField({ value, onValue }: { value: unknown; onValue: (v: unknown) => void }) {
  const parsed = readValue(value);
  const mode = parsed?.mode ?? 'flat';
  const n = parsed?.n ?? 0;
  if (value !== undefined && parsed === null) {
    return <span className="text-xs text-brass" title={JSON.stringify(value)}>advanced expression (edit as JSON)</span>;
  }
  return (
    <span className="inline-flex items-center gap-1">
      <select className={inputCls} value={mode} onChange={(e) => onValue(buildValue(e.target.value as ValueMode, n))}>
        {VALUE_MODES.map((m) => <option key={m.mode} value={m.mode}>{m.label}</option>)}
      </select>
      {mode === 'flat' && (
        <input type="number" className={`${inputCls} w-16`} value={n} onChange={(e) => onValue(buildValue('flat', Number(e.target.value)))} />
      )}
    </span>
  );
}

// ── the per-kind passive-effect form ─────────────────────────────────────────
export function EffectForm({ draft, onPatch }: { draft: Draft; onPatch: (p: Record<string, unknown>) => void }) {
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
