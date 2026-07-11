import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useBuilder } from '../store';
import { useAuth } from '@/features/auth/useAuth';
import {
  CompanionEditorForm,
  CompanionManager,
  CompanionStatBlock,
  type CompanionFormOutput,
} from '@/features/companions/CompanionManager';
import type { CompanionRow } from '@/features/companions/types';
import type { CompanionDraft } from '../types';

/**
 * Companions step — build animal companions, mounts, familiars, eidolons, and
 * custom allies as part of character creation.
 *
 * Companions live in the bot's `companions` table keyed by char_key. When
 * editing a saved character the full manager works directly against the table;
 * for a brand-new character the choices buffer as DRAFTS in builder state and
 * are created for real right after the first "Save to Vault" (useSaveBuild).
 */
export function CompanionsStep() {
  const { charKey } = useParams<{ charKey?: string }>();
  const level = useBuilder((s) => s.state.level) || 1;
  const { user } = useAuth();

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h3 className="mb-1 font-display text-xl text-gold-400">Companions</h3>
        <p className="font-ui text-sm text-parchment/70">
          Animal companions, mounts, familiars, eidolons, and custom allies — each with its own stat
          block, synced to the Discord bot.
        </p>
      </div>

      {charKey ? (
        user ? (
          <CompanionManager charKey={charKey} level={level} />
        ) : (
          <div className="rounded-xl border border-arcane-400/30 bg-arcane-500/10 p-3 font-ui text-sm text-parchment/80">
            Sign in to manage this character’s companions.
          </div>
        )
      ) : (
        <DraftCompanions level={level} />
      )}
    </div>
  );
}

/** Convert a builder draft into a display row for CompanionStatBlock. */
function draftToRow(draft: CompanionDraft, index: number): CompanionRow {
  return {
    user_id: '',
    char_key: '',
    comp_key: `draft-${index}`,
    display_name: draft.displayName,
    base_type: draft.baseType,
    form: draft.form,
    notes: draft.notes ?? null,
    current_hp: null,
    is_active: false,
    custom_stats: {
      kind: draft.kind,
      ...(draft.kind === 'animal' || draft.kind === 'mount'
        ? { specialization: draft.specialization ?? null }
        : {}),
      ...(draft.kind === 'familiar'
        ? {
            familiar: {
              abilities: draft.familiarAbilities ?? [],
              limit: draft.familiarAbilityLimit,
              specific: draft.specificFamiliar ?? null,
            },
          }
        : {}),
      ...(draft.kind === 'eidolon'
        ? {
            eidolon: {
              type: draft.eidolonType ?? '',
              build: draft.eidolonBuild ?? 0,
              primaryName: draft.eidolonPrimaryName,
              primaryDie: draft.eidolonPrimaryDie,
            },
          }
        : {}),
      ...(draft.kind === 'custom' ? { custom: draft.custom ?? {} } : {}),
    },
  };
}

function DraftCompanions({ level }: { level: number }) {
  const drafts = useBuilder((s) => s.state.companionDrafts) ?? [];
  const addDraft = useBuilder((s) => s.addCompanionDraft);
  const updateDraft = useBuilder((s) => s.updateCompanionDraft);
  const removeDraft = useBuilder((s) => s.removeCompanionDraft);
  const [editing, setEditing] = useState<number | 'new' | null>(null);

  const onSubmit = (output: CompanionFormOutput) => {
    const draft = output as CompanionDraft;
    if (editing === 'new' || editing === null) addDraft(draft);
    else updateDraft(editing, draft);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-xl border border-gold-500/30 bg-gold-500/10 p-3 font-ui text-sm text-parchment/85">
        This character isn’t saved yet, so companions you add here are drafts — they’ll be created in
        your vault (and synced to the Discord bot) the moment you{' '}
        <span className="text-gold-400">Save to Vault</span>.
      </div>

      {drafts.length > 0 && (
        <ul className="space-y-3">
          {drafts.map((d, i) => (
            <li key={`${d.displayName}-${i}`} className="rounded border border-gold/15 bg-midnight-900/40 p-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <span className="font-display text-silver">
                  {d.displayName}
                  <span className="ml-2 rounded bg-midnight-800/80 px-1.5 py-0.5 font-ui text-[0.6rem] uppercase tracking-widest text-gold/70">
                    draft
                  </span>
                </span>
                <span className="flex items-center gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => setEditing(i)}
                    className="rounded border border-gold/25 px-2 py-0.5 text-gold/80 hover:bg-gold/10"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => removeDraft(i)}
                    className="rounded border border-red-400/30 px-2 py-0.5 text-red-300/80 hover:bg-red-500/10"
                  >
                    Remove
                  </button>
                </span>
              </div>
              <CompanionStatBlock companion={draftToRow(d, i)} level={level} />
            </li>
          ))}
        </ul>
      )}

      {editing !== null ? (
        <CompanionEditorForm
          charKey=""
          level={level}
          existing={typeof editing === 'number' ? draftToRow(drafts[editing], editing) : null}
          onClose={() => setEditing(null)}
          onSubmitDraft={onSubmit}
        />
      ) : (
        <button
          type="button"
          onClick={() => setEditing('new')}
          className="inline-flex w-fit items-center gap-2 rounded-md border border-gold/40 bg-gold/10 px-4 py-2 text-sm font-display uppercase tracking-widest text-gold transition hover:bg-gold/20"
        >
          + Add a Companion
        </button>
      )}
    </div>
  );
}
