import { useMemo } from 'react';
import { isDatasetLoaded } from '@/features/builder/data';
import { characterToggles, type CharacterToggle } from '@/features/builder/rules';
import type { BuilderState } from '@/features/builder/types';
import type { ToggleDeclaration } from '@pathway/core';
import type { PathbuilderBuild } from '@/features/characters/pathbuilder';
import type { CharacterRow } from '@/features/characters/types';
import type { EditControls } from './Sheet';
import { Panel } from './Sheet';

/**
 * Feat TOGGLES — the switches a player flips to record a stance or mode (Dragon
 * Stance on, Deflecting Wave set to acid). The sheet's window onto core's toggle
 * vocabulary (packages/core/src/toggles.ts), and where a player's toggle STATE is
 * read and written.
 *
 * WHAT A TOGGLE DOES HERE, HONESTLY: today, nothing to the derived numbers. No
 * shipping feat effect reads a toggle tag yet — the consumers are pending review — and
 * the sheet's stat collector never folds a conditional into a total anyway. So this is
 * exactly what the owner asked for: the player's own record of a choice they made,
 * persisted so it survives a reload and (phase 4) reaches the bot. When reviewed
 * consumer effects ship, the stored state is already here for the derivation wiring to
 * read; nothing about this control changes.
 *
 * Renders NOTHING unless there is something to show — same three reasons as
 * `GrantedActions`: no embedded `_pathwayBuild` (a Pathbuilder import), the dataset
 * hasn't loaded, or no chosen feat offers a flippable toggle.
 */

/** A toggle's stored position: `true` for a plain switch, a variant value, or off. */
type Position = boolean | string | undefined;

/** Whether a declaration is a variant PICKER (a real choice among named options). */
function isPicker(t: ToggleDeclaration): boolean {
  return Array.isArray(t.variants) && t.variants.length > 0;
}

/**
 * Whether a declaration gives the player anything to DO. An `alwaysOn` switch with no
 * variants is an always-active constant — nothing to flip or choose — so it is not
 * rendered: the owner's rationale ("remember what you activated") is about switches a
 * player turns on and off, which that is not. An `alwaysOn` WITH variants still offers
 * a choice (which flavor), so it stays.
 */
function isInteractive(t: ToggleDeclaration): boolean {
  return !t.alwaysOn || isPicker(t);
}

/** Turn a raw slug into a readable label when the content carried no human one. */
function humanize(s: string): string {
  return s.replace(/[-:]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function FeatToggles({
  build,
  character,
  edit,
}: {
  build: PathbuilderBuild;
  character: CharacterRow;
  edit: EditControls;
}) {
  const state = (build as { _pathwayBuild?: BuilderState })._pathwayBuild;

  const toggles = useMemo(() => {
    // `characterToggles` calls `findFeat`, which throws until the dataset loads — the
    // same guard `GrantedActions` documents.
    if (!state || !isDatasetLoaded()) return [];
    try {
      return characterToggles(state).filter((t) => isInteractive(t.toggle));
    } catch {
      return [];
    }
  }, [state]);

  const stored = character.overlay?.web_edits?.toggles ?? {};

  // Read-modify-write only the `toggles` slice, against the FRESHEST overlay — a
  // concurrent bot write or a rapid second flip both survive. Mirrors the conditions
  // tracker's mutator exactly.
  const setPosition = (option: string, pos: Position) =>
    edit.updateOverlay((o) => {
      const next: Record<string, boolean | string> = { ...(o.web_edits?.toggles ?? {}) };
      if (pos === undefined || pos === false) delete next[option];
      else next[option] = pos;
      return { ...o, web_edits: { ...(o.web_edits ?? {}), toggles: next } };
    });

  if (!state || toggles.length === 0) return null;

  return (
    <Panel title="Toggles">
      {/* Honest about scope: these record state, they do not (yet) change the sheet. */}
      <p className="mb-3 text-[0.7rem] italic text-silver/45">
        Switches your feats offer — a record of the stances and modes you have active.
      </p>
      <ul className="space-y-2">
        {toggles.map((t) => (
          <ToggleRow
            key={`${t.sourceId}:${t.toggle.option}`}
            entry={t}
            position={stored[t.toggle.option]}
            readOnly={!edit.enabled}
            onChange={(pos) => setPosition(t.toggle.option, pos)}
          />
        ))}
      </ul>
    </Panel>
  );
}

function ToggleRow({
  entry,
  position,
  readOnly,
  onChange,
}: {
  entry: CharacterToggle;
  position: Position;
  readOnly: boolean;
  onChange: (pos: Position) => void;
}) {
  const { toggle, sourceName } = entry;
  const label = toggle.label ?? humanize(toggle.option);
  const variants = toggle.variants ?? [];
  const on = position === true || typeof position === 'string';

  return (
    <li className="flex items-center gap-3 rounded border border-gold/15 bg-midnight-900/40 p-2.5">
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="font-display text-sm text-silver">{label}</span>
          {toggle.alwaysOn && (
            <span className="rounded border border-gold/20 px-1 text-[0.6rem] uppercase tracking-wider text-silver/50">
              always active
            </span>
          )}
        </div>
        <span className="text-[0.7rem] text-silver/50">{sourceName}</span>
      </div>

      {variants.length > 1 ? (
        // A real choice among named variants: a select. `alwaysOn` pickers have no
        // "off" (the mode is always on — you only choose which); flippable ones do.
        <select
          value={typeof position === 'string' ? position : ''}
          disabled={readOnly}
          onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)}
          className="shrink-0 rounded border border-gold/25 bg-midnight-900/70 px-2 py-1 text-xs text-silver disabled:opacity-60"
        >
          {!toggle.alwaysOn && <option value="">Off</option>}
          {variants.map((v) => (
            <option key={v.value} value={v.value}>
              {v.label ?? humanize(v.value)}
            </option>
          ))}
        </select>
      ) : (
        // Plain switch, or a single-variant switch. A single variant still stores its
        // VALUE (not `true`) so the variant tag fires — core's `toggleTags` emits the
        // `option:value` tag only for a string position.
        <input
          type="checkbox"
          checked={on}
          disabled={readOnly}
          onChange={(e) => onChange(e.target.checked ? (variants[0]?.value ?? true) : undefined)}
          className="h-4 w-4 shrink-0 accent-gold disabled:opacity-60"
          aria-label={label}
        />
      )}
    </li>
  );
}
