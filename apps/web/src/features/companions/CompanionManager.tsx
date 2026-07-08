import { useMemo, useState } from 'react';
import {
  COMPANION_CATALOG,
  COMPANION_FORMS,
  DEFAULT_FAMILIAR_ABILITY_COUNT,
  EIDOLON_TYPES,
  FAMILIAR_ABILITIES,
  familiarBaseStats,
  findCompanionType,
  findEidolonType,
  findFamiliarAbility,
  scaleCompanion,
  scaleEidolon,
  type CompanionForm,
  type CompanionKind,
} from '@pathway/core';
import type { CompanionRow, CustomCompanionStats } from './types';
import { companionKind } from './types';
import {
  useCompanions,
  useDeleteCompanion,
  useSaveCompanion,
  useSetActiveCompanion,
} from './useCompanions';

const sign = (n: number) => (n >= 0 ? `+${n}` : `${n}`);
const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

const KIND_LABEL: Record<CompanionKind, string> = {
  animal: 'Animal Companion',
  mount: 'Mount',
  familiar: 'Familiar',
  eidolon: 'Eidolon',
  custom: 'Custom',
};

/**
 * The full companion manager: lists a character's companions (all kinds) with
 * in-depth stat blocks and a create/edit form. Reused by the character sheet's
 * Companions tab and the character builder's Companions step. Requires a saved
 * character (companions are keyed by char_key).
 */
export function CompanionManager({
  charKey,
  level,
  readOnly = false,
}: {
  charKey: string;
  level: number;
  readOnly?: boolean;
}) {
  const query = useCompanions(charKey);
  const companions = query.data ?? [];
  const [editing, setEditing] = useState<CompanionRow | 'new' | null>(null);

  return (
    <div className="space-y-3">
      {query.isLoading ? (
        <p className="py-4 text-sm text-silver/60">Loading companions…</p>
      ) : companions.length === 0 ? (
        <p className="py-3 text-sm text-silver/60">No companions yet.</p>
      ) : (
        <ul className="space-y-3">
          {companions.map((c) => (
            <CompanionCard
              key={c.comp_key}
              companion={c}
              level={level}
              charKey={charKey}
              readOnly={readOnly}
              onEdit={() => setEditing(c)}
            />
          ))}
        </ul>
      )}

      {query.isError && (
        <p className="text-sm text-red-300">
          Couldn’t load companions. The companions table may not be provisioned yet.
        </p>
      )}

      {!readOnly &&
        (editing ? (
          <CompanionEditorForm
            charKey={charKey}
            level={level}
            existing={editing === 'new' ? null : editing}
            onClose={() => setEditing(null)}
          />
        ) : (
          <button
            type="button"
            onClick={() => setEditing('new')}
            className="inline-flex items-center gap-2 rounded-md border border-gold/40 bg-gold/10 px-4 py-2 text-sm font-display uppercase tracking-widest text-gold transition hover:bg-gold/20"
          >
            + Create a Companion
          </button>
        ))}
    </div>
  );
}

// ---------------------------------------------------------------
// Card — in-depth, per kind
// ---------------------------------------------------------------

function CompanionCard({
  companion,
  level,
  charKey,
  readOnly,
  onEdit,
}: {
  companion: CompanionRow;
  level: number;
  charKey: string;
  readOnly: boolean;
  onEdit: () => void;
}) {
  const del = useDeleteCompanion(charKey);
  const setActive = useSetActiveCompanion(charKey);
  const kind = companionKind(companion);

  return (
    <li className="rounded border border-gold/15 bg-midnight-900/40 p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <span className="font-display text-silver">{companion.display_name}</span>
          <span className="ml-2 rounded bg-midnight-800/80 px-1.5 py-0.5 text-[0.6rem] uppercase tracking-widest text-gold/70">
            {KIND_LABEL[kind]}
          </span>
          {companion.is_active && (
            <span className="ml-2 rounded bg-emerald/15 px-1.5 py-0.5 text-[0.6rem] uppercase tracking-widest text-emerald-soft">
              Active
            </span>
          )}
        </div>
        {!readOnly && (
          <div className="flex items-center gap-2 text-xs">
            {!companion.is_active && (
              <button
                type="button"
                onClick={() => setActive.mutate(companion.comp_key)}
                className="rounded border border-gold/25 px-2 py-0.5 text-gold/80 hover:bg-gold/10"
              >
                Set active
              </button>
            )}
            <button
              type="button"
              onClick={onEdit}
              className="rounded border border-gold/25 px-2 py-0.5 text-gold/80 hover:bg-gold/10"
            >
              Edit
            </button>
            <button
              type="button"
              onClick={() => del.mutate(companion.comp_key)}
              className="rounded border border-red-400/30 px-2 py-0.5 text-red-300/80 hover:bg-red-500/10"
            >
              Remove
            </button>
          </div>
        )}
      </div>

      <CompanionStatBlock companion={companion} level={level} />

      {companion.notes && <p className="mt-2 text-xs italic text-silver/60">{companion.notes}</p>}
    </li>
  );
}

/** Kind-aware stat block for one companion row. Also used for builder drafts. */
export function CompanionStatBlock({ companion, level }: { companion: CompanionRow; level: number }) {
  const kind = companionKind(companion);
  if (kind === 'animal' || kind === 'mount') return <AnimalBlock companion={companion} level={level} />;
  if (kind === 'familiar') return <FamiliarBlock companion={companion} level={level} />;
  if (kind === 'eidolon') return <EidolonBlock companion={companion} level={level} />;
  return <CustomBlock companion={companion} />;
}

function StatGrid({ items }: { items: Array<[string, string | number]> }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {items.map(([label, value]) => (
        <div key={label} className="rounded border border-gold/10 bg-midnight-900/60 px-2 py-1">
          <div className="text-[0.55rem] uppercase tracking-widest text-silver/50">{label}</div>
          <div className="font-display text-sm text-gold">{value}</div>
        </div>
      ))}
    </div>
  );
}

function AnimalBlock({ companion, level }: { companion: CompanionRow; level: number }) {
  const type = findCompanionType(companion.base_type);
  if (!type) {
    return (
      <p className="text-xs text-silver/60">
        Custom base “{companion.base_type}” — stats managed on Discord.
      </p>
    );
  }
  const s = scaleCompanion(type, level, companion.form);
  return (
    <>
      <div className="mb-1 text-xs text-silver/60">
        {cap(companion.form)} {type.name} · {cap(s.size)} · Lvl {level}
      </div>
      <StatGrid
        items={[
          ['HP', s.maxHp],
          ['AC', s.ac],
          ['Perception', sign(s.perception)],
          ['Speed', s.speed],
          ['Fort', sign(s.saves.fortitude)],
          ['Ref', sign(s.saves.reflex)],
          ['Will', sign(s.saves.will)],
          [cap(s.skill.name), sign(s.skill.modifier)],
        ]}
      />
      <div className="mt-2 space-y-1">
        {s.attacks.map((a) => (
          <div key={a.name} className="text-xs text-silver/80">
            <span className="font-display text-gold/90">{cap(a.name)}</span> {sign(a.attack)} ·{' '}
            {a.damage}
            {a.damageBonus ? sign(a.damageBonus) : ''} {a.damageType}
            {a.traits.length > 0 && <span className="text-silver/50"> ({a.traits.join(', ')})</span>}
          </div>
        ))}
      </div>
      {type.senses.length > 0 && (
        <p className="mt-2 text-xs text-silver/60">
          <span className="text-silver/40">Senses:</span> {type.senses.join(', ')}
        </p>
      )}
      {type.support && (
        <p className="mt-1 text-xs text-silver/70">
          <span className="text-gold/70">Support</span> {type.support}
        </p>
      )}
    </>
  );
}

function FamiliarBlock({ companion, level }: { companion: CompanionRow; level: number }) {
  const base = familiarBaseStats(level);
  const abilities = (companion.custom_stats.familiar?.abilities ?? [])
    .map(findFamiliarAbility)
    .filter(Boolean);
  return (
    <>
      <StatGrid
        items={[
          ['HP', base.hp],
          ['Speed', `${base.speed} ft`],
          ['AC / Saves', 'as master'],
          ['Abilities', abilities.length],
        ]}
      />
      <div className="mt-2 space-y-1">
        {abilities.length === 0 ? (
          <p className="text-xs text-silver/50">No abilities selected.</p>
        ) : (
          abilities.map((a) => (
            <div key={a!.slug} className="text-xs text-silver/80">
              <span className="font-display text-gold/90">{a!.name}</span>
              {a!.master && (
                <span className="ml-1 rounded bg-arcane/15 px-1 text-[0.55rem] uppercase text-arcane">
                  master
                </span>
              )}
              <span className="text-silver/60"> — {a!.description}</span>
            </div>
          ))
        )}
      </div>
    </>
  );
}

function EidolonBlock({ companion, level }: { companion: CompanionRow; level: number }) {
  const cfg = companion.custom_stats.eidolon;
  const type = cfg ? findEidolonType(cfg.type) : undefined;
  if (!type) {
    return (
      <p className="text-xs text-silver/60">Eidolon subtype not recognized — edit to pick one.</p>
    );
  }
  const s = scaleEidolon(type, cfg?.build ?? 0, level);
  const primaryName = cfg?.primaryName || 'primary attack';
  const primaryDie = cfg?.primaryDie || '—';
  return (
    <>
      <div className="mb-1 text-xs text-silver/60">
        {s.buildName} {type.name} eidolon · {cap(s.size)} · {cap(s.tradition)} · Lvl {level}
      </div>
      <StatGrid
        items={[
          ['HP', 'shared'],
          ['AC', s.ac],
          ['Perception', sign(s.perception)],
          ['Speed', s.speed],
          ['Fort', sign(s.saves.fortitude)],
          ['Ref', sign(s.saves.reflex)],
          ['Will', sign(s.saves.will)],
          ['Spec. dmg', s.specializationDamage ? `+${s.specializationDamage}` : '—'],
        ]}
      />
      <div className="mt-2 space-y-1 text-xs text-silver/80">
        <div>
          <span className="font-display text-gold/90">{cap(primaryName)}</span> {sign(s.attack)} ·{' '}
          {primaryDie}
          {s.specializationDamage ? `+${s.specializationDamage}` : ''}{' '}
          <span className="text-silver/50">(die per your eidolon’s entry)</span>
        </div>
        <div>
          <span className="font-display text-gold/90">Secondary</span> {sign(s.attackFinesse)} ·{' '}
          {s.secondary.damageDie}
          {s.specializationDamage ? `+${s.specializationDamage}` : ''}{' '}
          <span className="text-silver/50">({s.secondary.traits.join(', ')})</span>
        </div>
      </div>
      <p className="mt-2 text-xs text-silver/60">
        <span className="text-silver/40">Skills:</span> {s.skills.join(', ') || '—'}
        {s.senses.length > 0 && (
          <>
            {' '}
            · <span className="text-silver/40">Senses:</span> {s.senses.join(', ')}
          </>
        )}
      </p>
      <p className="mt-1 text-xs italic text-silver/50">
        Shares your HP pool, actions, and multiple attack penalty.
      </p>
    </>
  );
}

function CustomBlock({ companion }: { companion: CompanionRow }) {
  const c = companion.custom_stats.custom ?? {};
  const items: Array<[string, string | number]> = [];
  if (c.hp != null) items.push(['HP', c.hp]);
  if (c.ac != null) items.push(['AC', c.ac]);
  if (c.perception != null) items.push(['Perception', sign(c.perception)]);
  if (c.speed) items.push(['Speed', c.speed]);
  if (c.size) items.push(['Size', cap(c.size)]);
  return (
    <>
      {items.length > 0 && <StatGrid items={items} />}
      {(c.attacks ?? []).length > 0 && (
        <div className="mt-2 space-y-1">
          {c.attacks!.map((a, i) => (
            <div key={`${a.name}-${i}`} className="text-xs text-silver/80">
              <span className="font-display text-gold/90">{cap(a.name)}</span>
              {a.attack != null ? ` ${sign(a.attack)}` : ''} {a.damage ?? ''} {a.damageType ?? ''}
            </div>
          ))}
        </div>
      )}
      {items.length === 0 && (c.attacks ?? []).length === 0 && (
        <p className="text-xs text-silver/50">No stats entered.</p>
      )}
    </>
  );
}

// ---------------------------------------------------------------
// Create / edit form — type-aware
// ---------------------------------------------------------------

const inputCls =
  'rounded border border-gold/25 bg-midnight-950/50 px-2 py-1.5 text-sm text-silver focus:border-gold/60 focus:outline-none';

/** The per-kind fields the form produces (matches builder CompanionDraft). */
export interface CompanionFormOutput {
  kind: CompanionKind;
  displayName: string;
  baseType: string;
  form: CompanionForm;
  notes?: string | null;
  familiarAbilities?: string[];
  eidolonType?: string;
  eidolonBuild?: number;
  eidolonPrimaryName?: string;
  eidolonPrimaryDie?: string;
  custom?: CustomCompanionStats;
}

export function CompanionEditorForm({
  charKey,
  level,
  existing,
  onClose,
  onSubmitDraft,
}: {
  charKey: string;
  level: number;
  existing: CompanionRow | null;
  onClose: () => void;
  /**
   * Draft mode (builder, character not saved yet): receive the values instead
   * of writing to the companions table.
   */
  onSubmitDraft?: (output: CompanionFormOutput) => void;
}) {
  const save = useSaveCompanion(charKey);
  const [kind, setKind] = useState<CompanionKind>(
    existing ? companionKind(existing) : 'animal',
  );
  const [name, setName] = useState(existing?.display_name ?? '');
  const [notes, setNotes] = useState(existing?.notes ?? '');

  // animal / mount
  const [baseType, setBaseType] = useState(
    existing && findCompanionType(existing.base_type) ? existing.base_type : COMPANION_CATALOG[0].slug,
  );
  const [form, setForm] = useState<CompanionForm>(existing?.form ?? 'young');
  // familiar
  const [familiarAbilities, setFamiliarAbilities] = useState<string[]>(
    existing?.custom_stats.familiar?.abilities ?? [],
  );
  // eidolon
  const [eidolonType, setEidolonType] = useState(
    existing?.custom_stats.eidolon?.type ?? EIDOLON_TYPES[0].slug,
  );
  const [eidolonBuild, setEidolonBuild] = useState(existing?.custom_stats.eidolon?.build ?? 0);
  const [eidolonPrimaryName, setEidolonPrimaryName] = useState(
    existing?.custom_stats.eidolon?.primaryName ?? '',
  );
  const [eidolonPrimaryDie, setEidolonPrimaryDie] = useState(
    existing?.custom_stats.eidolon?.primaryDie ?? '',
  );
  // custom
  const [custom, setCustom] = useState<CustomCompanionStats>(existing?.custom_stats.custom ?? {});

  const animalPreview = useMemo(() => {
    if (kind !== 'animal' && kind !== 'mount') return null;
    const t = findCompanionType(baseType);
    return t ? scaleCompanion(t, level, form) : null;
  }, [kind, baseType, form, level]);

  const toggleAbility = (slug: string) =>
    setFamiliarAbilities((prev) =>
      prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug],
    );

  const submit = () => {
    if (!name.trim()) return;
    const baseTypeForKind =
      kind === 'animal' || kind === 'mount' ? baseType : kind === 'familiar' ? 'familiar' : kind;
    const output: CompanionFormOutput = {
      kind,
      displayName: name.trim(),
      baseType: baseTypeForKind,
      form: kind === 'animal' || kind === 'mount' ? form : 'young',
      notes: notes.trim() || null,
      familiarAbilities: kind === 'familiar' ? familiarAbilities : undefined,
      eidolonType: kind === 'eidolon' ? eidolonType : undefined,
      eidolonBuild: kind === 'eidolon' ? eidolonBuild : undefined,
      eidolonPrimaryName: kind === 'eidolon' ? eidolonPrimaryName || undefined : undefined,
      eidolonPrimaryDie: kind === 'eidolon' ? eidolonPrimaryDie || undefined : undefined,
      custom: kind === 'custom' ? custom : undefined,
    };
    if (onSubmitDraft) {
      onSubmitDraft(output);
      onClose();
      return;
    }
    save.mutate({ compKey: existing?.comp_key, ...output }, { onSuccess: onClose });
  };

  return (
    <div className="rounded-lg border border-gold/30 bg-midnight-900/70 p-4">
      <div className="mb-3 font-display text-gold">
        {existing ? `Edit ${existing.display_name}` : 'New Companion'}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs text-silver/70">
          Kind
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as CompanionKind)}
            className={inputCls}
            disabled={Boolean(existing)}
          >
            {(Object.keys(KIND_LABEL) as CompanionKind[]).map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-silver/70">
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Shadow" className={inputCls} />
        </label>
      </div>

      {(kind === 'animal' || kind === 'mount') && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-xs text-silver/70">
            Type
            <select value={baseType} onChange={(e) => setBaseType(e.target.value)} className={inputCls}>
              {COMPANION_CATALOG.map((c) => (
                <option key={c.slug} value={c.slug}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-silver/70">
            Maturity
            <select value={form} onChange={(e) => setForm(e.target.value as CompanionForm)} className={inputCls}>
              {COMPANION_FORMS.map((f) => (
                <option key={f} value={f}>
                  {cap(f)}
                </option>
              ))}
            </select>
          </label>
          {animalPreview && (
            <div className="sm:col-span-2 rounded border border-gold/10 bg-midnight-950/40 p-2 text-xs text-silver/80">
              <span className="text-silver/50">Preview (lvl {level}): </span>
              HP {animalPreview.maxHp} · AC {animalPreview.ac} · Fort {sign(animalPreview.saves.fortitude)} / Ref{' '}
              {sign(animalPreview.saves.reflex)} / Will {sign(animalPreview.saves.will)}
            </div>
          )}
        </div>
      )}

      {kind === 'familiar' && (
        <div className="mt-3">
          <div className="mb-1 text-xs text-silver/70">
            Familiar abilities ({familiarAbilities.length} chosen — base {DEFAULT_FAMILIAR_ABILITY_COUNT}/day,
            more via feats). HP {familiarBaseStats(level).hp}, Speed 25 ft, AC & saves as master.
          </div>
          <div className="max-h-64 space-y-1 overflow-y-auto rounded border border-gold/15 bg-midnight-950/40 p-2">
            {FAMILIAR_ABILITIES.map((a) => (
              <label key={a.slug} className="flex cursor-pointer items-start gap-2 rounded px-1 py-0.5 hover:bg-midnight-800/50">
                <input
                  type="checkbox"
                  checked={familiarAbilities.includes(a.slug)}
                  onChange={() => toggleAbility(a.slug)}
                  className="mt-0.5"
                />
                <span className="text-xs">
                  <span className="font-display text-gold/90">{a.name}</span>
                  {a.master && (
                    <span className="ml-1 rounded bg-arcane/15 px-1 text-[0.55rem] uppercase text-arcane">master</span>
                  )}
                  <span className="text-silver/60"> — {a.description}</span>
                </span>
              </label>
            ))}
          </div>
        </div>
      )}

      {kind === 'eidolon' && (
        <EidolonFields
          type={eidolonType}
          build={eidolonBuild}
          primaryName={eidolonPrimaryName}
          primaryDie={eidolonPrimaryDie}
          level={level}
          onType={(t) => {
            setEidolonType(t);
            setEidolonBuild(0);
          }}
          onBuild={setEidolonBuild}
          onPrimaryName={setEidolonPrimaryName}
          onPrimaryDie={setEidolonPrimaryDie}
        />
      )}

      {kind === 'custom' && <CustomStatFields value={custom} onChange={setCustom} />}

      <label className="mt-3 flex flex-col gap-1 text-xs text-silver/70">
        Notes
        <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" className={inputCls} />
      </label>

      {save.isError && (
        <p className="mt-2 text-xs text-red-300">Couldn’t save: {(save.error as Error).message}</p>
      )}

      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={save.isPending || !name.trim()}
          className="rounded-md border border-gold/40 bg-gold/10 px-4 py-1.5 text-sm font-display uppercase tracking-widest text-gold hover:bg-gold/20 disabled:opacity-50"
        >
          {save.isPending ? 'Saving…' : existing ? 'Update' : 'Create'}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-gold/20 px-4 py-1.5 text-sm text-silver/70 hover:bg-midnight-800/60"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

const PRIMARY_DICE = ['1d4', '1d6', '1d8', '1d10', '1d12'];

function EidolonFields({
  type,
  build,
  primaryName,
  primaryDie,
  level,
  onType,
  onBuild,
  onPrimaryName,
  onPrimaryDie,
}: {
  type: string;
  build: number;
  primaryName: string;
  primaryDie: string;
  level: number;
  onType: (t: string) => void;
  onBuild: (b: number) => void;
  onPrimaryName: (n: string) => void;
  onPrimaryDie: (d: string) => void;
}) {
  const t = findEidolonType(type);
  const preview = t ? scaleEidolon(t, build, level) : null;
  return (
    <div className="mt-3 grid gap-3 sm:grid-cols-2">
      <label className="flex flex-col gap-1 text-xs text-silver/70">
        Eidolon subtype
        <select value={type} onChange={(e) => onType(e.target.value)} className={inputCls}>
          {EIDOLON_TYPES.map((e) => (
            <option key={e.slug} value={e.slug}>
              {e.name}
            </option>
          ))}
        </select>
      </label>
      {t && t.builds.length > 1 && (
        <label className="flex flex-col gap-1 text-xs text-silver/70">
          Build (ability array)
          <select value={build} onChange={(e) => onBuild(Number(e.target.value))} className={inputCls}>
            {t.builds.map((b, i) => (
              <option key={b.name} value={i}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="flex flex-col gap-1 text-xs text-silver/70">
        Primary attack name
        <input
          value={primaryName}
          onChange={(e) => onPrimaryName(e.target.value)}
          placeholder={t?.suggestedAttacks || 'claw, jaws, …'}
          className={inputCls}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-silver/70">
        Primary attack die (per your eidolon’s entry)
        <select value={primaryDie} onChange={(e) => onPrimaryDie(e.target.value)} className={inputCls}>
          <option value="">— choose —</option>
          {PRIMARY_DICE.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
      </label>
      {preview && (
        <div className="sm:col-span-2 rounded border border-gold/10 bg-midnight-950/40 p-2 text-xs text-silver/80">
          <span className="text-silver/50">Preview (lvl {level}, {preview.buildName}): </span>
          HP shared · AC {preview.ac} · Per {sign(preview.perception)} · Fort {sign(preview.saves.fortitude)} / Ref{' '}
          {sign(preview.saves.reflex)} / Will {sign(preview.saves.will)} · Attack {sign(preview.attack)}
          {preview.specializationDamage ? ` · Spec +${preview.specializationDamage}` : ''}
        </div>
      )}
    </div>
  );
}

function CustomStatFields({
  value,
  onChange,
}: {
  value: CustomCompanionStats;
  onChange: (v: CustomCompanionStats) => void;
}) {
  const set = (patch: Partial<CustomCompanionStats>) => onChange({ ...value, ...patch });
  const num = (s: string) => (s === '' ? undefined : Number(s));
  return (
    <div className="mt-3 grid gap-3 sm:grid-cols-3">
      <label className="flex flex-col gap-1 text-xs text-silver/70">
        Size
        <input value={value.size ?? ''} onChange={(e) => set({ size: e.target.value })} className={inputCls} />
      </label>
      <label className="flex flex-col gap-1 text-xs text-silver/70">
        HP
        <input type="number" value={value.hp ?? ''} onChange={(e) => set({ hp: num(e.target.value) })} className={inputCls} />
      </label>
      <label className="flex flex-col gap-1 text-xs text-silver/70">
        AC
        <input type="number" value={value.ac ?? ''} onChange={(e) => set({ ac: num(e.target.value) })} className={inputCls} />
      </label>
      <label className="flex flex-col gap-1 text-xs text-silver/70">
        Perception
        <input type="number" value={value.perception ?? ''} onChange={(e) => set({ perception: num(e.target.value) })} className={inputCls} />
      </label>
      <label className="col-span-2 flex flex-col gap-1 text-xs text-silver/70">
        Speed
        <input value={value.speed ?? ''} onChange={(e) => set({ speed: e.target.value })} placeholder="25 feet" className={inputCls} />
      </label>
      <label className="col-span-3 flex flex-col gap-1 text-xs text-silver/70">
        Primary attack (name · bonus · damage)
        <div className="grid grid-cols-3 gap-2">
          <input
            value={value.attacks?.[0]?.name ?? ''}
            onChange={(e) => set({ attacks: [{ ...(value.attacks?.[0] ?? {}), name: e.target.value }] })}
            placeholder="jaws"
            className={inputCls}
          />
          <input
            type="number"
            value={value.attacks?.[0]?.attack ?? ''}
            onChange={(e) =>
              set({ attacks: [{ name: value.attacks?.[0]?.name ?? '', ...(value.attacks?.[0] ?? {}), attack: num(e.target.value) }] })
            }
            placeholder="+8"
            className={inputCls}
          />
          <input
            value={value.attacks?.[0]?.damage ?? ''}
            onChange={(e) =>
              set({ attacks: [{ name: value.attacks?.[0]?.name ?? '', ...(value.attacks?.[0] ?? {}), damage: e.target.value }] })
            }
            placeholder="1d8+4 piercing"
            className={inputCls}
          />
        </div>
      </label>
    </div>
  );
}
