import { useState } from 'react';
import { parseExpr, automationNodeSchema, SKILL_SLUGS, FIXED_SELECTORS, DAMAGE_TYPES } from '@pathway/core';
import { inputCls, withId, nextId, EffectForm, validatePassive, type Draft } from './fields';

/**
 * The automation-tree editor (authoring UI slice 2). A RECURSIVE node editor over the Layer-2
 * vocabulary — where granted actions and cross-creature `target`→`applyEffect` get built. Nodes
 * nest through `children` (target), `onTrue`/`onFalse` (branch) and the per-degree lists
 * (save/attack/check), so the editor is recursive too. Everything is validated live against
 * `automationNodeSchema`; an expression is parsed by the core grammar (`parseExpr`), so a bad
 * formula is a red field, not silent nonsense.
 *
 * Deliberately not (yet): `heightened` (spell-only), an applyEffect's nested buttons/granted
 * actions, and `capture` — the EffectTemplate editor covers name + duration + Layer-1 passives,
 * the common "impose a condition on the target" case.
 */

/** Recursively drop the `_id` React keys so the tree validates/exports as pure content. */
export function stripDeep(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stripDeep);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) if (k !== '_id') out[k] = stripDeep(val);
    return out;
  }
  return v;
}

const ALL_SELECTORS = [...FIXED_SELECTORS, ...SKILL_SLUGS];
const NODE_KINDS = ['text', 'variable', 'roll', 'target', 'branch', 'save', 'attack', 'check', 'damage', 'temphp', 'counter', 'applyEffect', 'removeEffect'] as const;

function blankNode(kind: string): Draft {
  const base: Record<string, Record<string, unknown>> = {
    text: { body: '' },
    variable: { name: '' },
    roll: { notation: '' },
    target: { mode: 'all', children: [] },
    branch: { onTrue: [], onFalse: [] },
    save: { save: 'fortitude', dc: { kind: 'flat' } },
    attack: {},
    check: { check: 'athletics', dc: { kind: 'flat' } },
    damage: { components: [{ formula: '' }] },
    temphp: { formula: '' },
    counter: { counter: '', amount: { kind: 'lit', value: 1 } },
    applyEffect: { effect: { name: '', duration: { kind: 'unlimited' }, passives: [] } },
    removeEffect: { name: '' },
  };
  return withId({ kind, ...(base[kind] ?? {}) });
}

// ── expression field: a string parsed by the core grammar ────────────────────
export function ExprField({ value, onChange, placeholder = 'e.g. floor(level/2)' }: { value: unknown; onChange: (v: unknown) => void; placeholder?: string }) {
  const [text, setText] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const set = (t: string) => {
    setText(t);
    if (!t.trim()) { setErr(null); onChange(undefined); return; }
    try {
      onChange(parseExpr(t));
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'parse error');
      onChange({ _invalidExpr: t }); // forces schema-invalid so the node reads red
    }
  };
  return (
    <span className="inline-flex flex-col">
      <input className={`${inputCls} w-48`} placeholder={placeholder} value={text} onChange={(e) => set(e.target.value)} />
      {err && <span className="text-[10px] text-red-300/80">{err}</span>}
      {!err && value !== undefined && !text && <span className="text-[10px] text-parchment/40">set</span>}
    </span>
  );
}

function SelectorPick({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <select className={inputCls} value={value} onChange={(e) => onChange(e.target.value)}>
      {ALL_SELECTORS.map((s) => <option key={s} value={s}>{s}</option>)}
    </select>
  );
}

// ── DC: flat expression, or 10 + a creature's stat ───────────────────────────
function DcField({ dc, onChange }: { dc: Record<string, unknown>; onChange: (dc: Record<string, unknown>) => void }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="text-xs text-parchment/50">DC</span>
      <select className={inputCls} value={(dc.kind as string) ?? 'flat'} onChange={(e) => onChange(e.target.value === 'flat' ? { kind: 'flat' } : { kind: 'stat', who: 'target', selector: 'fortitude' })}>
        <option value="flat">flat</option>
        <option value="stat">10 + stat</option>
      </select>
      {dc.kind === 'stat' ? (
        <>
          <select className={inputCls} value={(dc.who as string) ?? 'target'} onChange={(e) => onChange({ ...dc, who: e.target.value })}>
            <option value="target">target's</option>
            <option value="actor">actor's</option>
          </select>
          <SelectorPick value={(dc.selector as string) ?? 'fortitude'} onChange={(v) => onChange({ ...dc, selector: v })} />
        </>
      ) : (
        <ExprField value={dc.value} onChange={(v) => onChange({ kind: 'flat', value: v })} placeholder="e.g. 20" />
      )}
    </span>
  );
}

// ── damage components ────────────────────────────────────────────────────────
function DamageComponents({ components, onChange }: { components: Record<string, unknown>[]; onChange: (c: Record<string, unknown>[]) => void }) {
  const patch = (i: number, p: Record<string, unknown>) => onChange(components.map((c, j) => (j === i ? { ...c, ...p } : c)));
  return (
    <div className="flex flex-col gap-1">
      {components.map((c, i) => (
        <span key={i} className="inline-flex items-center gap-1">
          <input className={`${inputCls} w-24`} placeholder="2d6" value={(c.formula as string) ?? ''} onChange={(e) => patch(i, { formula: e.target.value })} />
          <select className={inputCls} value={(c.type as string) ?? ''} onChange={(e) => patch(i, { type: e.target.value || undefined })}>
            <option value="">untyped</option>
            {DAMAGE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          {components.length > 1 && <button className="text-parchment/40 hover:text-red-300" onClick={() => onChange(components.filter((_, j) => j !== i))}>✕</button>}
        </span>
      ))}
      <button className="self-start text-xs text-parchment/50 hover:text-gold" onClick={() => onChange([...components, { formula: '' }])}>+ component</button>
    </div>
  );
}

// ── EffectTemplate (for applyEffect): name + duration + Layer-1 passives ──────
function DurationField({ duration, onChange }: { duration: Record<string, unknown>; onChange: (d: Record<string, unknown>) => void }) {
  const k = (duration.kind as string) ?? 'unlimited';
  return (
    <span className="inline-flex items-center gap-1">
      <span className="text-xs text-parchment/50">for</span>
      <select className={inputCls} value={k} onChange={(e) => onChange({ kind: e.target.value, ...(e.target.value === 'rounds' ? { count: 1 } : {}), ...(e.target.value === 'time' ? { amount: 1, unit: 'minutes' } : {}), ...(e.target.value === 'until' ? { moment: { when: 'end', whose: 'origin' }, next: true } : {}) })}>
        {['unlimited', 'rounds', 'sustained', 'until', 'time', 'dailyPreparations'].map((d) => <option key={d} value={d}>{d}</option>)}
      </select>
      {k === 'rounds' && <input type="number" className={`${inputCls} w-14`} value={(duration.count as number) ?? 1} onChange={(e) => onChange({ kind: 'rounds', count: Number(e.target.value) })} />}
      {k === 'time' && (
        <>
          <input type="number" className={`${inputCls} w-14`} value={(duration.amount as number) ?? 1} onChange={(e) => onChange({ ...duration, amount: Number(e.target.value) })} />
          <select className={inputCls} value={(duration.unit as string) ?? 'minutes'} onChange={(e) => onChange({ ...duration, unit: e.target.value })}>
            {['minutes', 'hours', 'days'].map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
        </>
      )}
      {k === 'until' && (
        <>
          {(() => { const m = (duration.moment as Record<string, unknown>) ?? {}; return (
            <>
              <select className={inputCls} value={(m.when as string) ?? 'end'} onChange={(e) => onChange({ ...duration, moment: { ...m, when: e.target.value } })}>
                <option value="start">start</option><option value="end">end</option>
              </select>
              <span className="text-xs text-parchment/50">of</span>
              <select className={inputCls} value={(m.whose as string) ?? 'origin'} onChange={(e) => onChange({ ...duration, moment: { ...m, whose: e.target.value } })}>
                <option value="origin">origin's</option><option value="bearer">bearer's</option>
              </select>
              <label className="flex items-center gap-1 text-xs text-parchment/60"><input type="checkbox" checked={(duration.next as boolean) ?? false} onChange={(e) => onChange({ ...duration, next: e.target.checked })} />next turn</label>
            </>
          ); })()}
        </>
      )}
    </span>
  );
}

function EffectTemplateField({ template, onChange }: { template: Record<string, unknown>; onChange: (t: Record<string, unknown>) => void }) {
  const passives = (template.passives as Draft[]) ?? [];
  const patchPassive = (id: number, p: Record<string, unknown>) => onChange({ ...template, passives: passives.map((d) => (d._id === id ? { ...d, ...p } : d)) });
  return (
    <div className="mt-1 rounded border border-arcane/25 bg-arcane/5 p-2">
      <div className="flex flex-wrap items-center gap-2">
        <input className={`${inputCls} w-40`} placeholder="effect name (e.g. Frightened)" value={(template.name as string) ?? ''} onChange={(e) => onChange({ ...template, name: e.target.value })} />
        <DurationField duration={(template.duration as Record<string, unknown>) ?? { kind: 'unlimited' }} onChange={(d) => onChange({ ...template, duration: d })} />
      </div>
      <div className="mt-2 pl-2">
        <div className="text-xs uppercase tracking-wide text-parchment/40">while active</div>
        {passives.map((d) => {
          const issues = validatePassive(d);
          return (
            <div key={d._id} className="mt-1 flex items-start gap-2">
              <span className="mt-1 w-16 shrink-0 text-xs text-gold">{String(d.kind)}</span>
              <div className="flex-1">
                <EffectForm draft={d} onPatch={(p) => patchPassive(d._id, p)} />
                {issues.map((iss, i) => <div key={i} className="text-[10px] text-red-300/80">{iss}</div>)}
              </div>
              <button className="text-parchment/40 hover:text-red-300" onClick={() => onChange({ ...template, passives: passives.filter((x) => x._id !== d._id) })}>✕</button>
            </div>
          );
        })}
        <div className="mt-1 flex gap-1">
          {(['modifier', 'proficiency', 'grant', 'note', 'rollAdjust'] as const).map((kd) => (
            <button key={kd} className="rounded border border-gold/15 px-1.5 py-0.5 text-[11px] text-parchment/60 hover:text-gold" onClick={() => onChange({ ...template, passives: [...passives, withId({ kind: kd })] })}>+ {kd}</button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── a labeled recursive child list ───────────────────────────────────────────
function ChildList({ label, nodes, onChange }: { label: string; nodes: Draft[]; onChange: (n: Draft[]) => void }) {
  return (
    <div className="mt-1 border-l border-gold/15 pl-3">
      <div className="text-xs uppercase tracking-wide text-parchment/40">{label}</div>
      <AutomationTree nodes={nodes} onChange={onChange} />
    </div>
  );
}

const DEGREES: [string, string][] = [['onCriticalSuccess', 'crit success'], ['onSuccess', 'success'], ['onFailure', 'failure'], ['onCriticalFailure', 'crit failure']];

// ── one node ──────────────────────────────────────────────────────────────────
function NodeEditor({ node, onPatch }: { node: Draft; onPatch: (p: Record<string, unknown>) => void }) {
  const kids = (field: string) => (node[field] as Draft[]) ?? [];
  const targetSel = (
    <select className={inputCls} value={(node.target as string) ?? 'target'} onChange={(e) => onPatch({ target: e.target.value })}>
      <option value="target">on target</option>
      <option value="self">on self</option>
    </select>
  );

  switch (node.kind) {
    case 'text':
      return <div className="flex flex-wrap gap-2"><input className={`${inputCls} w-32`} placeholder="title" value={(node.title as string) ?? ''} onChange={(e) => onPatch({ title: e.target.value || undefined })} /><input className={`${inputCls} min-w-64 flex-1`} placeholder="body" value={(node.body as string) ?? ''} onChange={(e) => onPatch({ body: e.target.value })} /></div>;
    case 'variable':
      return <div className="flex flex-wrap items-center gap-2"><input className={`${inputCls} w-32`} placeholder="name" value={(node.name as string) ?? ''} onChange={(e) => onPatch({ name: e.target.value })} /><span className="text-xs text-parchment/50">=</span><ExprField value={node.value} onChange={(v) => onPatch({ value: v })} /></div>;
    case 'roll':
      return <div className="flex flex-wrap items-center gap-2"><input className={`${inputCls} w-28`} placeholder="1d20" value={(node.notation as string) ?? ''} onChange={(e) => onPatch({ notation: e.target.value })} /><input className={`${inputCls} w-28`} placeholder="name (opt)" value={(node.name as string) ?? ''} onChange={(e) => onPatch({ name: e.target.value || undefined })} /></div>;
    case 'target':
      return (
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <select className={inputCls} value={(node.mode as string) ?? 'all'} onChange={(e) => onPatch({ mode: e.target.value })}>
              {['all', 'self', 'position'].map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            {node.mode === 'position' && <input type="number" className={`${inputCls} w-14`} placeholder="idx" value={(node.index as number) ?? 0} onChange={(e) => onPatch({ index: Number(e.target.value) })} />}
          </div>
          <ChildList label="then, for each target" nodes={kids('children')} onChange={(n) => onPatch({ children: n })} />
        </div>
      );
    case 'branch':
      return (
        <div>
          <div className="flex flex-wrap items-center gap-2"><span className="text-xs text-parchment/50">if</span><ExprField value={node.condition} onChange={(v) => onPatch({ condition: v })} placeholder="e.g. gte(level, 5)" /></div>
          <ChildList label="then" nodes={kids('onTrue')} onChange={(n) => onPatch({ onTrue: n })} />
          <ChildList label="else" nodes={kids('onFalse')} onChange={(n) => onPatch({ onFalse: n })} />
        </div>
      );
    case 'save':
    case 'check':
    case 'attack':
      return (
        <div>
          <div className="flex flex-wrap items-center gap-2">
            {node.kind === 'save' && <select className={inputCls} value={(node.save as string) ?? 'fortitude'} onChange={(e) => onPatch({ save: e.target.value })}>{['fortitude', 'reflex', 'will'].map((s) => <option key={s} value={s}>{s}</option>)}</select>}
            {node.kind === 'check' && <SelectorPick value={(node.check as string) ?? 'athletics'} onChange={(v) => onPatch({ check: v })} />}
            {node.kind === 'attack' && <span className="inline-flex items-center gap-1 text-xs text-parchment/50">bonus <ExprField value={node.bonus} onChange={(v) => onPatch({ bonus: v })} placeholder="e.g. 9" /></span>}
            {node.kind !== 'attack' && <DcField dc={(node.dc as Record<string, unknown>) ?? { kind: 'flat' }} onChange={(dc) => onPatch({ dc })} />}
            {node.kind === 'save' && <label className="flex items-center gap-1 text-xs text-parchment/60"><input type="checkbox" checked={(node.basicSave as boolean) ?? false} onChange={(e) => onPatch({ basicSave: e.target.checked || undefined })} />basic</label>}
          </div>
          {DEGREES.map(([field, label]) => (
            <ChildList key={field} label={label} nodes={kids(field)} onChange={(n) => onPatch({ [field]: n.length ? n : undefined })} />
          ))}
        </div>
      );
    case 'damage':
      return (
        <div className="flex flex-wrap items-start gap-2">
          <DamageComponents components={(node.components as Record<string, unknown>[]) ?? [{ formula: '' }]} onChange={(c) => onPatch({ components: c })} />
          <select className={inputCls} value={(node.scaling as { by?: string } | undefined)?.by ?? ''} onChange={(e) => onPatch({ scaling: e.target.value ? { by: e.target.value } : undefined })}>
            <option value="">no scaling</option>
            <option value="attack">crit doubles (attack)</option>
            <option value="basic-save">basic save</option>
          </select>
          <label className="flex items-center gap-1 text-xs text-parchment/60"><input type="checkbox" checked={(node.healing as boolean) ?? false} onChange={(e) => onPatch({ healing: e.target.checked || undefined })} />healing</label>
          {targetSel}
        </div>
      );
    case 'temphp':
      return <div className="flex flex-wrap items-center gap-2"><input className={`${inputCls} w-24`} placeholder="2d6" value={(node.formula as string) ?? ''} onChange={(e) => onPatch({ formula: e.target.value })} />{targetSel}</div>;
    case 'counter':
      return <div className="flex flex-wrap items-center gap-2"><input className={`${inputCls} w-28`} placeholder="counter name" value={(node.counter as string) ?? ''} onChange={(e) => onPatch({ counter: e.target.value })} /><span className="text-xs text-parchment/50">by</span><ExprField value={node.amount} onChange={(v) => onPatch({ amount: v })} placeholder="-1" /><label className="flex items-center gap-1 text-xs text-parchment/60"><input type="checkbox" checked={(node.requireAvailable as boolean) ?? false} onChange={(e) => onPatch({ requireAvailable: e.target.checked || undefined })} />require available</label></div>;
    case 'applyEffect':
      return (
        <div>
          <div className="flex flex-wrap items-center gap-2">{targetSel}<input className={`${inputCls} w-28`} placeholder="link group (opt)" value={(node.linkGroup as string) ?? ''} onChange={(e) => onPatch({ linkGroup: e.target.value || undefined })} /></div>
          <EffectTemplateField template={(node.effect as Record<string, unknown>) ?? { name: '', duration: { kind: 'unlimited' }, passives: [] }} onChange={(t) => onPatch({ effect: t })} />
        </div>
      );
    case 'removeEffect':
      return <div className="flex flex-wrap items-center gap-2"><input className={`${inputCls} w-40`} placeholder="effect name" value={(node.name as string) ?? ''} onChange={(e) => onPatch({ name: e.target.value })} />{targetSel}<label className="flex items-center gap-1 text-xs text-parchment/60"><input type="checkbox" checked={(node.cascade as boolean) ?? false} onChange={(e) => onPatch({ cascade: e.target.checked || undefined })} />cascade</label></div>;
    default:
      return <span className="text-xs text-brass">no editor for “{String(node.kind)}”</span>;
  }
}

// ── the tree (a list of nodes) ────────────────────────────────────────────────
export function AutomationTree({ nodes, onChange }: { nodes: Draft[]; onChange: (n: Draft[]) => void }) {
  const patch = (id: number, p: Record<string, unknown>) => onChange(nodes.map((n) => (n._id === id ? { ...n, ...p } : n)));
  return (
    <div className="mt-1 space-y-1.5">
      {nodes.map((n) => {
        const issues = automationNodeSchema.safeParse(stripDeep(n)).success ? [] : ['invalid'];
        return (
          <div key={n._id} className={`rounded border p-2 ${issues.length ? 'border-red-500/25 bg-red-500/5' : 'border-gold/12 bg-midnight-950/40'}`}>
            <div className="flex items-start gap-2">
              <span className="mt-0.5 w-20 shrink-0 font-ui text-xs text-gold">{String(n.kind)}</span>
              <div className="flex-1"><NodeEditor node={n} onPatch={(p) => patch(n._id, p)} /></div>
              <button className="text-parchment/40 hover:text-red-300" onClick={() => onChange(nodes.filter((x) => x._id !== n._id))}>✕</button>
            </div>
          </div>
        );
      })}
      <div className="flex flex-wrap gap-1">
        <span className="text-[11px] text-parchment/40">add node:</span>
        {NODE_KINDS.map((k) => (
          <button key={k} className="rounded border border-gold/12 px-1.5 py-0.5 text-[11px] text-parchment/60 hover:text-gold" onClick={() => onChange([...nodes, blankNode(k)])}>{k}</button>
        ))}
      </div>
    </div>
  );
}

export { nextId };
