import { useMemo, useState } from 'react';
import type { CharacterRow } from '@/features/characters/types';
import type { PathbuilderBuild } from '@/features/characters/pathbuilder';
import { Panel } from '../Sheet';
import { CompanionIcon } from '../icons';
import { useAuth } from '@/features/auth/useAuth';
import {
  useCompanions,
  useDeleteCompanion,
  useSaveCompanion,
  useSetActiveCompanion,
} from '@/features/companions/useCompanions';
import {
  COMPANION_CATALOG,
  COMPANION_FORMS,
  findCompanionType,
  scaleCompanion,
  type CompanionForm,
} from '@/features/companions/engine';
import type { CompanionRow } from '@/features/companions/types';

const sign = (n: number) => (n >= 0 ? `+${n}` : `${n}`);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Companions tab — animal companions (and mounts), with their own scaled stat
 * blocks stored in the bot's `companions` table so they sync to Discord.
 *
 * Signed-in owners get the full builder (create / edit / delete / set active);
 * public share views and any Pathbuilder-imported `pets`/`familiars` are shown
 * read-only below.
 */
export function CompanionsTab({
  build,
  character,
  readOnly,
}: {
  build: PathbuilderBuild;
  character: CharacterRow;
  readOnly: boolean;
}) {
  const { user } = useAuth();
  const charKey = character.char_key;
  const level = character.level ?? build.level ?? 1;
  const companionsQuery = useCompanions(charKey);
  const companions = companionsQuery.data ?? [];

  const [editing, setEditing] = useState<CompanionRow | 'new' | null>(null);
  const canManage = Boolean(user) && !readOnly;

  const pets = extractCompanions(build.pets);
  const familiars = extractCompanions(build.familiars);

  return (
    <div className="space-y-4">
      {canManage && (
        <Panel title="Animal Companions" icon={<CompanionIcon />}>
          {companionsQuery.isLoading ? (
            <p className="py-4 text-sm text-silver/60">Loading companions…</p>
          ) : companions.length === 0 ? (
            <p className="py-4 text-sm text-silver/60">
              No companions yet. Build one below — it syncs to the Discord bot.
            </p>
          ) : (
            <ul className="space-y-3">
              {companions.map((c) => (
                <CompanionCard
                  key={c.comp_key}
                  companion={c}
                  level={level}
                  charKey={charKey}
                  onEdit={() => setEditing(c)}
                />
              ))}
            </ul>
          )}
          {companionsQuery.isError && (
            <p className="mt-2 text-sm text-red-300">
              Couldn’t load companions. The companions table may not be provisioned yet.
            </p>
          )}
          <div className="mt-4">
            {editing ? (
              <CompanionForm
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
            )}
          </div>
        </Panel>
      )}

      {familiars.length > 0 && (
        <CompanionGroup title="Familiars (from import)" entries={familiars} />
      )}
      {pets.length > 0 && (
        <CompanionGroup title="Companions (from import)" entries={pets} />
      )}

      {!canManage && companions.length === 0 && pets.length === 0 && familiars.length === 0 && (
        <Panel title="Companions" icon={<CompanionIcon />}>
          <p className="py-6 text-center text-sm text-silver/60">
            {readOnly
              ? 'This character has no companions to show.'
              : 'Sign in to build animal companions and sync them to the Discord bot.'}
          </p>
        </Panel>
      )}
    </div>
  );
}

// ---------------------------------------------------------------
// One managed companion — scaled stat block
// ---------------------------------------------------------------

function CompanionCard({
  companion,
  level,
  charKey,
  onEdit,
}: {
  companion: CompanionRow;
  level: number;
  charKey: string;
  onEdit: () => void;
}) {
  const del = useDeleteCompanion(charKey);
  const setActive = useSetActiveCompanion(charKey);
  const type = findCompanionType(companion.base_type);
  const scaled = type ? scaleCompanion(type, level, companion.form) : null;

  return (
    <li className="rounded border border-gold/15 bg-midnight-900/40 p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <span className="font-display text-silver">{companion.display_name}</span>
          <span className="ml-2 text-xs text-silver/60">
            {cap(companion.form)} {type?.name ?? companion.base_type} · Lvl {level}
          </span>
          {companion.is_active && (
            <span className="ml-2 rounded bg-emerald/15 px-1.5 py-0.5 text-[0.6rem] uppercase tracking-widest text-emerald-soft">
              Active
            </span>
          )}
        </div>
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
      </div>

      {scaled ? (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="HP" value={scaled.maxHp} />
            <Stat label="AC" value={scaled.ac} />
            <Stat label="Perception" value={sign(scaled.perception)} />
            <Stat label="Speed" value={scaled.speed} small />
            <Stat label="Fort" value={sign(scaled.saves.fortitude)} />
            <Stat label="Ref" value={sign(scaled.saves.reflex)} />
            <Stat label="Will" value={sign(scaled.saves.will)} />
            <Stat label={cap(scaled.skill.name)} value={sign(scaled.skill.modifier)} />
          </div>
          <div className="mt-2 space-y-1">
            {scaled.attacks.map((a) => (
              <div key={a.name} className="text-xs text-silver/80">
                <span className="font-display text-gold/90">{cap(a.name)}</span>{' '}
                {sign(a.attack)} · {a.damage}
                {a.damageBonus ? sign(a.damageBonus) : ''} {a.damageType}
                {a.traits.length > 0 && (
                  <span className="text-silver/50"> ({a.traits.join(', ')})</span>
                )}
              </div>
            ))}
          </div>
          {companion.notes && (
            <p className="mt-2 text-xs italic text-silver/60">{companion.notes}</p>
          )}
        </>
      ) : (
        <p className="text-xs text-silver/60">
          Custom companion “{companion.base_type}” — stats are managed on Discord.
        </p>
      )}
    </li>
  );
}

function Stat({ label, value, small }: { label: string; value: string | number; small?: boolean }) {
  return (
    <div className="rounded border border-gold/10 bg-midnight-900/60 px-2 py-1">
      <div className="text-[0.55rem] uppercase tracking-widest text-silver/50">{label}</div>
      <div className={`font-display text-gold ${small ? 'text-xs' : 'text-sm'}`}>{value}</div>
    </div>
  );
}

// ---------------------------------------------------------------
// Create / edit form
// ---------------------------------------------------------------

function CompanionForm({
  charKey,
  level,
  existing,
  onClose,
}: {
  charKey: string;
  level: number;
  existing: CompanionRow | null;
  onClose: () => void;
}) {
  const save = useSaveCompanion(charKey);
  const [name, setName] = useState(existing?.display_name ?? '');
  const [baseType, setBaseType] = useState(existing?.base_type ?? COMPANION_CATALOG[0].slug);
  const [form, setForm] = useState<CompanionForm>(existing?.form ?? 'young');
  const [notes, setNotes] = useState(existing?.notes ?? '');

  const type = findCompanionType(baseType);
  const preview = useMemo(
    () => (type ? scaleCompanion(type, level, form) : null),
    [type, level, form],
  );

  const submit = () => {
    if (!name.trim()) return;
    save.mutate(
      {
        compKey: existing?.comp_key,
        displayName: name.trim(),
        baseType,
        form,
        notes: notes.trim() || null,
      },
      { onSuccess: onClose },
    );
  };

  return (
    <div className="rounded-lg border border-gold/30 bg-midnight-900/70 p-4">
      <div className="mb-3 font-display text-gold">
        {existing ? `Edit ${existing.display_name}` : 'New Companion'}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs text-silver/70">
          Name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Shadow"
            className="rounded border border-gold/25 bg-midnight-950/50 px-2 py-1.5 text-sm text-silver focus:border-gold/60 focus:outline-none"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-silver/70">
          Type
          <select
            value={baseType}
            onChange={(e) => setBaseType(e.target.value)}
            className="rounded border border-gold/25 bg-midnight-950/50 px-2 py-1.5 text-sm text-silver focus:border-gold/60 focus:outline-none"
          >
            {COMPANION_CATALOG.map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-silver/70">
          Maturity
          <select
            value={form}
            onChange={(e) => setForm(e.target.value as CompanionForm)}
            className="rounded border border-gold/25 bg-midnight-950/50 px-2 py-1.5 text-sm text-silver focus:border-gold/60 focus:outline-none"
          >
            {COMPANION_FORMS.map((f) => (
              <option key={f} value={f}>
                {cap(f)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-silver/70">
          Notes
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Optional"
            className="rounded border border-gold/25 bg-midnight-950/50 px-2 py-1.5 text-sm text-silver focus:border-gold/60 focus:outline-none"
          />
        </label>
      </div>

      {preview && (
        <div className="mt-3 rounded border border-gold/10 bg-midnight-950/40 p-2 text-xs text-silver/80">
          <span className="text-silver/50">Preview (level {level}): </span>
          HP {preview.maxHp} · AC {preview.ac} · Per {sign(preview.perception)} · Fort{' '}
          {sign(preview.saves.fortitude)} / Ref {sign(preview.saves.reflex)} / Will{' '}
          {sign(preview.saves.will)}
          {preview.attacks[0] && (
            <>
              {' '}
              · {cap(preview.attacks[0].name)} {sign(preview.attacks[0].attack)} (
              {preview.attacks[0].damage}
              {preview.attacks[0].damageBonus ? sign(preview.attacks[0].damageBonus) : ''})
            </>
          )}
        </div>
      )}

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

// ---------------------------------------------------------------
// Pathbuilder-imported companions (read-only) — shapes vary
// ---------------------------------------------------------------

function CompanionGroup({ title, entries }: { title: string; entries: CompanionEntry[] }) {
  return (
    <Panel title={`${title} (${entries.length})`} icon={<CompanionIcon />}>
      <ul className="grid gap-2 sm:grid-cols-2">
        {entries.map((c, i) => (
          <li key={`${c.name}-${i}`} className="rounded border border-gold/15 bg-midnight-900/40 p-3">
            <div className="font-display text-silver">{c.name}</div>
            {c.subtitle && <div className="mt-0.5 text-xs text-silver/60">{c.subtitle}</div>}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

interface CompanionEntry {
  name: string;
  subtitle: string | null;
}

function extractCompanions(raw: unknown): CompanionEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: CompanionEntry[] = [];
  for (const item of raw) {
    if (item == null) continue;
    if (typeof item === 'string') {
      if (item.trim()) out.push({ name: item.trim(), subtitle: null });
      continue;
    }
    if (typeof item === 'object') {
      const rec = item as Record<string, unknown>;
      const name = pickStr(rec, 'name', 'displayName', 'nickname', 'type', 'animal') ?? 'Companion';
      const subtitle = pickStr(rec, 'type', 'animal', 'specific', 'kind', 'ancestry');
      out.push({ name, subtitle: subtitle && subtitle !== name ? subtitle : null });
    }
  }
  return out;
}

function pickStr(obj: Record<string, unknown>, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v.trim().length > 0) return v.trim();
  }
  return null;
}
