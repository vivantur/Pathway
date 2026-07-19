import { useMemo, useState } from 'react';
import { isDatasetLoaded } from '@/features/builder/data';
import { grantedActionsFor, type CharacterGrantedAction } from '@/features/builder/rules';
import type { BuilderState } from '@/features/builder/types';
import { describeOutcome, hasAutomation, runActionFor } from '@/features/automation/runAction';
import type { PathbuilderBuild } from '@/features/characters/pathbuilder';
import { formatActionCost } from './grantedActionsDisplay';
import { Panel } from './Sheet';

/**
 * Runnable ACTIONS the character's feats grant — the sheet's window onto the
 * Layer-2 automation engine, and the first place `apps/web` runs one.
 *
 * Renders NOTHING unless there is something to show. Three reasons there might
 * not be, none of them an error:
 *
 *  1. The character was imported from Pathbuilder and has no `_pathwayBuild`, so
 *     there is no BuilderState to walk (same fallback `sheetStats` documents).
 *  2. The builder dataset hasn't loaded — `findFeat` throws before it does.
 *  3. No chosen feat grants an action. Today that is EVERY character: the review
 *     pipeline emits Layer-1 passives and choices only, and nothing yet writes
 *     `grantedActions` onto a feat. This surface is deliberately built ahead of
 *     that wire, and stays invisible until content carries a tree.
 *
 * The PREVIEW RUN is dev-only (`import.meta.env.DEV`). It executes a real tree
 * through core's interpreter, but it applies nothing — the web has no apply
 * layer, so every result is what WOULD happen. Showing a player a button whose
 * effects don't persist would be worse than showing them no button.
 */

/** A run's rendered result, plus the seed that produced it so it can be replayed. */
interface PreviewRun {
  seed: number;
  lines: string[];
  changes: string[];
  warnings: string[];
  aborted: boolean;
}

function ActionCard({
  granted,
  state,
}: {
  granted: CharacterGrantedAction;
  state: BuilderState;
}) {
  const { action, sourceName } = granted;
  const [run, setRun] = useState<PreviewRun | null>(null);
  const cost = formatActionCost(action.actionCost);
  const runnable = hasAutomation(action);

  const preview = () => {
    // A fresh seed per press, SHOWN below, so an interesting result can be
    // reproduced exactly. Core's RNG is seeded; a hidden seed would waste that.
    const seed = Math.floor(Math.random() * 2 ** 31);
    const described = describeOutcome(runActionFor(state, action, { seed }));
    setRun({ seed, ...described });
  };

  return (
    <li className="rounded border border-gold/15 bg-midnight-900/40 p-2.5">
      <div className="flex items-baseline gap-2">
        <span className="font-display text-sm text-parchment">{action.name}</span>
        {cost && (
          <span className="rounded border border-gold/30 px-1 text-[0.65rem] uppercase tracking-wider text-gold">
            {cost}
          </span>
        )}
        <span className="ml-auto text-[0.7rem] text-parchment/50">{sourceName}</span>
      </div>

      {action.description && (
        <p className="mt-1.5 text-xs leading-relaxed text-parchment/75">{action.description}</p>
      )}

      {!runnable && (
        // An action can be granted before its tree is authored, and the sheet says
        // so rather than hiding it — the character HAS the activity either way.
        <p className="mt-1.5 text-[0.7rem] italic text-parchment/45">
          No automation authored yet — run it at the table.
        </p>
      )}

      {import.meta.env.DEV && runnable && (
        <div className="mt-2">
          <button
            onClick={preview}
            className="rounded-md border border-gold/30 bg-gold/10 px-2 py-1 text-[0.7rem] text-gold hover:border-gold/60"
          >
            Preview run (dev)
          </button>

          {run && (
            <div className="mt-2 space-y-1.5 border-l-2 border-gold/20 pl-2.5 text-xs">
              {run.lines.map((line, i) => (
                <p key={`l${i}`} className="whitespace-pre-line text-parchment/80">
                  {line}
                </p>
              ))}

              {run.changes.length > 0 && (
                <div>
                  {/* INTENTIONS, not results. The web has no apply layer, so this
                      must never read as though the sheet changed. */}
                  <p className="text-[0.7rem] uppercase tracking-wider text-parchment/45">
                    Would change (not applied)
                  </p>
                  {run.changes.map((c, i) => (
                    <p key={`c${i}`} className="text-parchment/80">
                      {c}
                    </p>
                  ))}
                </div>
              )}

              {run.warnings.length > 0 && (
                <div>
                  <p className="text-[0.7rem] uppercase tracking-wider text-amber-400/70">
                    Warnings
                  </p>
                  {run.warnings.map((w, i) => (
                    <p key={`w${i}`} className="text-amber-200/80">
                      {w}
                    </p>
                  ))}
                  {/* The most likely warning by far, and the least obvious. Core
                      defaults a damage node to the CURRENT TARGET; a sheet preview
                      has none, so the node resolves nothing. Saying so here stops
                      it reading as a broken button. */}
                  <p className="mt-1 text-[0.7rem] italic text-parchment/45">
                    A preview runs with no target and no spendable resources, so
                    anything needing either is reported instead of guessed.
                  </p>
                </div>
              )}

              {run.aborted && (
                <p className="text-[0.7rem] uppercase tracking-wider text-red-400/80">
                  Aborted before every node ran
                </p>
              )}

              {run.lines.length === 0 && run.changes.length === 0 && !run.warnings.length && (
                <p className="italic text-parchment/45">The tree produced no output.</p>
              )}

              <p className="pt-0.5 text-[0.65rem] text-parchment/35">seed {run.seed}</p>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

export function GrantedActions({ build }: { build: PathbuilderBuild }) {
  const state = (build as { _pathwayBuild?: BuilderState })._pathwayBuild;

  const actions = useMemo(() => {
    // `grantedActionsFor` calls `findFeat`, which throws until the dataset loads.
    if (!state || !isDatasetLoaded()) return [];
    try {
      return grantedActionsFor(state);
    } catch {
      // A malformed embedded build must not break the sheet, exactly as
      // sheetStats' `derived()` decides.
      return [];
    }
  }, [state]);

  if (!state || actions.length === 0) return null;

  return (
    <Panel title="Granted actions">
      <ul className="space-y-2">
        {actions.map((g) => (
          <ActionCard key={`${g.sourceId}:${g.action.id}`} granted={g} state={state} />
        ))}
      </ul>
    </Panel>
  );
}
