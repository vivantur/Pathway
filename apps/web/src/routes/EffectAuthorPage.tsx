import { useMemo, useState } from 'react';
import {
  addGrantedAction,
  CONDITION_SLUGS,
  effectChoiceSchema,
  grantedActionSchema,
  SKILL_SLUGS,
  type EffectDecision,
} from '@pathway/core';
import { saveDecisions } from '@/features/effects/decisions';
import featData from '@/features/builder/data/feats.json';
import { GildedRule } from '@/components/ui/GildedRule';
import { GrimoireMarkdown } from '@/components/ui/GrimoireMarkdown';
import {
  inputCls, cap, withId, strip, nextId, RANK_LABELS, EFFECT_KINDS, RESIST_TYPES, BROADCAST,
  PREDICATE_TRAITS, EFFECT_TRAITS, EffectForm, validatePassive, type Draft,
} from '@/features/authoring/fields';
import { AutomationTree, stripDeep } from '@/features/authoring/AutomationEditor';

/**
 * Effect authoring — the homebrew effect editor (design doc, stage 3). Builds an entity's
 * effects, choices, and granted actions by hand, validated live against the same core Zod
 * schemas the sheet reads. The schema is the diagnostic: an unbuildable feat surfaces as a
 * red row or a missing field. Nothing here is applied; the output is authored content JSON.
 *
 * Slice 1: Layer-1 passives + skill choices. Slice 2: granted actions with a full Layer-2
 * automation tree (see features/authoring/AutomationEditor).
 */

// ── choices (skill proficiency) ──────────────────────────────────────────────
interface ChoiceDraft { _id: number; prompt: string; rank: number; skills: string[] }
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

// ── granted actions ──────────────────────────────────────────────────────────
interface ActionDraft { _id: number; id: string; name: string; cost: string; automation: Draft[] }
const ACTION_COSTS: Record<string, unknown> = {
  '': undefined, '1': { kind: 'actions', min: 1, max: 1 }, '2': { kind: 'actions', min: 2, max: 2 },
  '3': { kind: 'actions', min: 3, max: 3 }, reaction: { kind: 'reaction' }, free: { kind: 'free' },
};
function buildAction(a: ActionDraft): Record<string, unknown> {
  return stripDeep({
    id: a.id || a.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
    name: a.name,
    ...(ACTION_COSTS[a.cost] ? { actionCost: ACTION_COSTS[a.cost] } : {}),
    ...(a.automation.length ? { automation: a.automation } : {}),
  }) as Record<string, unknown>;
}
function validateAction(a: ActionDraft): string[] {
  const r = grantedActionSchema.safeParse(buildAction(a));
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
  const [actions, setActions] = useState<ActionDraft[]>([]);
  const [showText, setShowText] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveState, setSaveState] = useState<{ ok: boolean; message: string } | null>(null);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? FEATS.filter((f) => f.name.toLowerCase().includes(q)).slice(0, 8) : [];
  }, [query]);

  const load = (f: FeatLite) => {
    setFeat(f);
    setQuery('');
    setEffects((f.effects ?? []).map((e) => withId(e as Record<string, unknown>)));
    setChoices([]);
    setActions([]);
  };

  const patchEffect = (id: number, p: Record<string, unknown>) => {
    // A broadcast target ("all saves"/"all skills") is an authoring convenience: replace the
    // one effect with one PER STAT, copying its other fields. The stored model stays per-stat
    // (broadcast selectors are fanned out at ingest too), so this just saves the clicks.
    const fan = BROADCAST[p.target as keyof typeof BROADCAST];
    if (fan) {
      setEffects((prev) => {
        const i = prev.findIndex((d) => d._id === id);
        if (i < 0) return prev;
        const base = strip(prev[i]!);
        const expanded = fan.map((t) => withId({ ...base, target: t }));
        return [...prev.slice(0, i), ...expanded, ...prev.slice(i + 1)];
      });
      return;
    }
    setEffects((prev) => prev.map((d) => (d._id === id ? { ...d, ...p } : d)));
  };
  const patchChoice = (id: number, p: Partial<ChoiceDraft>) => setChoices((prev) => prev.map((c) => (c._id === id ? { ...c, ...p } : c)));
  const toggleSkill = (id: number, skill: string) =>
    setChoices((prev) => prev.map((c) => (c._id === id ? { ...c, skills: c.skills.includes(skill) ? c.skills.filter((s) => s !== skill) : [...c.skills, skill] } : c)));
  const patchAction = (id: number, p: Partial<ActionDraft>) => setActions((prev) => prev.map((a) => (a._id === id ? { ...a, ...p } : a)));

  const authored = effects.map(strip);
  const authoredChoices = choices.map(buildChoice);
  const authoredActions = actions.map(buildAction);
  const allValid =
    effects.every((d) => validatePassive(d).length === 0) &&
    choices.every((c) => validateChoice(c).length === 0) &&
    actions.every((a) => validateAction(a).length === 0);

  /**
   * Persist the authored activities as `add` decisions — the rail passives already
   * ride, rather than the download/re-import round trip this page used to require.
   *
   * ONLY ACTIONS. `effects` and `choices` are owned by the review queue, and
   * `remap-effects.mjs` deletes and rebuilds them from candidates + decisions on
   * every run; writing them from here would either be clobbered on the next bake or
   * fight the queue for the same rows. Granted actions have no such producer, which
   * is exactly why they are the thing this page can author outright.
   *
   * `addGrantedAction` is core's door: it validates against `grantedActionSchema`
   * (recursively, so a bad automation tree is refused here rather than on a sheet)
   * and derives the stable key that makes a re-save an update.
   */
  const saveActions = async () => {
    if (!feat) return;
    setSaving(true);
    setSaveState(null);
    try {
      const decisions: EffectDecision[] = [];
      for (const draft of authoredActions) {
        const out = addGrantedAction(feat.id, draft);
        if (!out.ok) {
          // Refuse the whole batch rather than saving part of it: a half-saved set
          // is a feat that grants some of its activities, which is worse than one
          // that grants none and says why.
          setSaveState({
            ok: false,
            message: `Not saved — ${out.issues.map((i) => `${i.field}: ${i.message}`).join('; ')}`,
          });
          return;
        }
        decisions.push(out.decision!);
      }
      await saveDecisions(decisions);
      setSaveState({ ok: true, message: `Saved ${decisions.length} action(s) to the review queue.` });
    } catch (e) {
      setSaveState({ ok: false, message: `Save failed: ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setSaving(false);
    }
  };

  const exportJson = () => {
    const content = {
      id: feat?.id, name: feat?.name, effects: authored,
      ...(authoredChoices.length ? { choices: authoredChoices } : {}),
      // `grantedActions`, matching the field on our content — this used to emit
      // `actions`, which no consumer reads. The mismatch was silent by construction:
      // a feat carrying `actions` validates fine and simply grants nothing.
      ...(authoredActions.length ? { grantedActions: authoredActions } : {}),
    };
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
        machine can't map (granted actions). Every row is validated live against the same schema
        the sheet reads; anything it can't express is a gap worth knowing about.
      </p>
      <GildedRule className="my-6" />

      {/* entity picker */}
      <div className="relative max-w-md">
        <input className="w-full rounded-md border border-gold/20 bg-midnight-900/60 px-3 py-2 text-sm text-parchment placeholder:text-parchment/40" placeholder="Search a feat to load, or edit a blank one…" value={query} onChange={(e) => setQuery(e.target.value)} />
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
          <button onClick={() => { setFeat(null); setEffects([]); setChoices([]); setActions([]); }} className="text-xs text-parchment/50 hover:text-gold">clear</button>
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
      <h2 className="mt-8 font-display text-xl text-gold">Passive effects</h2>
      <div className="mt-3 space-y-2">
        {effects.map((d) => {
          const issues = validatePassive(d);
          return (
            <div key={d._id} className={`rounded-md border p-3 ${issues.length ? 'border-red-500/30 bg-red-500/5' : 'border-emerald/25 bg-emerald/5'}`}>
              <div className="flex items-start gap-3">
                <span className="mt-1 w-20 shrink-0 font-ui text-sm text-gold">{String(d.kind)}</span>
                <div className="flex-1">
                  <EffectForm draft={d} onPatch={(p) => patchEffect(d._id, p)} allowBroadcast />
                  {issues.map((iss, i) => <div key={i} className="mt-1 text-xs text-red-300/80">{iss}</div>)}
                </div>
                <button onClick={() => setEffects((prev) => prev.filter((x) => x._id !== d._id))} className="text-parchment/40 hover:text-red-300">✕</button>
              </div>
            </div>
          );
        })}
        {effects.length === 0 && <p className="text-sm text-parchment/50">No passive effects yet.</p>}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="text-sm text-parchment/50">add:</span>
        {EFFECT_KINDS.map((k) => (
          <button key={k} onClick={() => setEffects((prev) => [...prev, withId({ kind: k })])} className="rounded border border-gold/25 px-2.5 py-1 text-sm text-parchment hover:bg-midnight-900/60">+ {k}</button>
        ))}
      </div>

      {/* choices editor */}
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
                  <button key={s} onClick={() => toggleSkill(c._id, s)} className={`rounded border px-1.5 py-0.5 text-xs ${c.skills.includes(s) ? 'border-gold/50 bg-gold/10 text-gold' : 'border-gold/15 text-parchment/60 hover:text-parchment'}`}>{s}</button>
                ))}
              </div>
              {issues.map((iss, i) => <div key={i} className="mt-1 text-xs text-red-300/80">{iss}</div>)}
            </div>
          );
        })}
      </div>
      <button onClick={() => setChoices((prev) => [...prev, { _id: nextId(), prompt: 'Skill', rank: 1, skills: [] }])} className="mt-3 rounded border border-gold/25 px-2.5 py-1 text-sm text-parchment hover:bg-midnight-900/60">+ skill choice</button>

      {/* granted actions editor */}
      <h2 className="mt-8 font-display text-xl text-gold">Granted actions <span className="text-sm font-normal text-parchment/50">(Layer-2 automation)</span></h2>
      <div className="mt-3 space-y-2">
        {actions.map((a) => {
          const issues = validateAction(a);
          return (
            <div key={a._id} className={`rounded-md border p-3 ${issues.length ? 'border-red-500/30 bg-red-500/5' : 'border-emerald/25 bg-emerald/5'}`}>
              <div className="flex flex-wrap items-center gap-2">
                <input className={`${inputCls} w-48`} placeholder="action name (e.g. Grapple)" value={a.name} onChange={(e) => patchAction(a._id, { name: e.target.value })} />
                <select className={inputCls} value={a.cost} onChange={(e) => patchAction(a._id, { cost: e.target.value })}>
                  <option value="">— cost —</option>
                  <option value="1">1 action</option><option value="2">2 actions</option><option value="3">3 actions</option>
                  <option value="reaction">reaction</option><option value="free">free</option>
                </select>
                <button onClick={() => setActions((prev) => prev.filter((x) => x._id !== a._id))} className="ml-auto text-parchment/40 hover:text-red-300">✕</button>
              </div>
              <AutomationTree nodes={a.automation} onChange={(n) => patchAction(a._id, { automation: n })} />
              {issues.map((iss, i) => <div key={i} className="mt-1 text-xs text-red-300/80">{iss}</div>)}
            </div>
          );
        })}
      </div>
      <button onClick={() => setActions((prev) => [...prev, { _id: nextId(), id: '', name: '', cost: '', automation: [] }])} className="mt-3 rounded border border-gold/25 px-2.5 py-1 text-sm text-parchment hover:bg-midnight-900/60">+ granted action</button>

      {/* output */}
      <h2 className="mt-8 font-display text-xl text-gold">Authored content</h2>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <span className={`text-sm ${allValid ? 'text-emerald-soft' : 'text-red-300/80'}`}>
          {allValid ? `✓ ${effects.length} effect(s), ${choices.length} choice(s), ${actions.length} action(s) valid` : 'some entries are invalid'}
        </span>
        <button onClick={saveActions} disabled={!feat || !allValid || actions.length === 0 || saving} className="rounded-md border border-gold/30 bg-gold/10 px-3 py-1.5 text-sm text-gold hover:border-gold/60 disabled:opacity-40">
          {saving ? 'Saving…' : `Save ${actions.length || ''} action(s) to review queue`}
        </button>
        <button onClick={exportJson} disabled={!feat || !allValid || (effects.length === 0 && choices.length === 0 && actions.length === 0)} className="rounded-md border border-gold/30 bg-gold/10 px-3 py-1.5 text-sm text-gold hover:border-gold/60 disabled:opacity-40">
          Export JSON
        </button>
      </div>
      {saveState && (
        <p className={`mt-2 text-sm ${saveState.ok ? 'text-emerald-soft' : 'text-red-300/80'}`}>{saveState.message}</p>
      )}
      <p className="mt-2 max-w-3xl text-xs text-parchment/50">
        Saving records each action as an <code>add</code> decision keyed by its id, so re-saving an
        edited action updates it rather than adding a second copy. Effects and choices are NOT saved
        here — those belong to the review queue, which owns them and rebuilds them on every bake.
        Run <code>npm run pull:decisions</code> then <code>remap-effects.mjs</code> to bake what you
        save into content.
      </p>
      <pre className="mt-3 max-h-80 overflow-auto rounded-md border border-gold/15 bg-midnight-950/70 p-3 text-[11px] leading-relaxed text-parchment/70">
        {JSON.stringify({ effects: authored, ...(authoredChoices.length ? { choices: authoredChoices } : {}), ...(authoredActions.length ? { grantedActions: authoredActions } : {}) }, null, 2)}
      </pre>

      <datalist id="resist-types">
        {RESIST_TYPES.map((t) => <option key={t} value={t} />)}
      </datalist>
      <datalist id="predicate-traits">
        {PREDICATE_TRAITS.map((t) => <option key={t} value={t} />)}
      </datalist>
      <datalist id="effect-traits">
        {EFFECT_TRAITS.map((t) => <option key={t} value={t} />)}
      </datalist>
      <datalist id="condition-slugs">
        {CONDITION_SLUGS.map((c) => <option key={c} value={c} />)}
      </datalist>

      <p className="mt-8 text-xs text-parchment/40">
        Deliberately not yet in the tree editor: spell heightening, an applyEffect's nested
        buttons/granted actions, and capture. The EffectTemplate covers name + duration + passives.
        Conditions build a flat list of trait terms; a nested predicate loaded from existing
        content is shown read-only rather than flattened.
      </p>
    </div>
  );
}
