import { useState } from 'react';
import { noteText } from '@/features/characters/api';
import { useCharacterNotes } from '@/features/characters/useCharacterNotes';
import type { CharacterRow, XpLogEntry } from '@/features/characters/types';
import { Panel, type EditControls } from '../Sheet';
import { NoteIcon, StarIcon } from '../icons';

/**
 * Journal — biographical + play-history view.
 * - Bio: the character's `notes` text column, editable in place.
 * - Notes: the full character_notes list (long-form, added over time by the bot).
 * - XP History: overlay.pathway_bot_state.xpLog, reverse-chronological.
 */
export function JournalTab({
  character,
  edit,
}: {
  character: CharacterRow;
  edit: EditControls;
}) {
  const { data: notes, isLoading: notesLoading } = useCharacterNotes(character.char_key);
  const xpLog = character.overlay?.pathway_bot_state?.xpLog ?? [];
  const noteEntries = (notes ?? []).filter((n) => noteText(n).length > 0);

  return (
    <div className="space-y-4">
      <BioPanel bio={character.notes ?? null} edit={edit} />

      <Panel title={`Notes${noteEntries.length ? ` (${noteEntries.length})` : ''}`} icon={<NoteIcon />}>
        {notesLoading ? (
          <p className="text-sm text-silver/40">Loading notes…</p>
        ) : noteEntries.length === 0 ? (
          <EmptyBlock>
            No notes yet. Add them from Discord with the bot — they&apos;ll show up here.
          </EmptyBlock>
        ) : (
          <ul className="space-y-3">
            {noteEntries.map((n, i) => (
              <li key={i} className="border-l-2 border-gold/30 pl-3">
                <p className="whitespace-pre-line text-sm leading-relaxed text-silver/90">
                  {noteText(n)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title={`XP History${xpLog.length ? ` (${xpLog.length})` : ''}`} icon={<StarIcon />}>
        {xpLog.length === 0 ? (
          <EmptyBlock>
            No XP awards on record yet. Play a session — every /xp the bot logs
            will appear here with date, amount, and reason.
          </EmptyBlock>
        ) : (
          <ol className="space-y-2">
            {[...xpLog].sort(byNewestFirst).map((entry, i) => (
              <XpLogRow key={`${entry.at ?? ''}:${entry.amount ?? ''}:${i}`} entry={entry} />
            ))}
          </ol>
        )}
      </Panel>
    </div>
  );
}

/** Editable Bio panel (moved here from the old Overview Notes box). */
function BioPanel({ bio, edit }: { bio: string | null; edit: EditControls }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  const start = () => {
    setDraft(bio ?? '');
    setEditing(true);
  };
  const commit = () => {
    if (draft !== (bio ?? '')) edit.update({ notes: draft });
    setEditing(false);
  };

  return (
    <Panel title="Bio" icon={<NoteIcon />}>
      {editing ? (
        <div className="space-y-2">
          <textarea
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={5}
            placeholder="A short bio or note for this character…"
            className="w-full rounded border border-gold/30 bg-midnight-800/80 p-2 text-sm text-silver focus:border-gold/60 focus:outline-none"
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="text-xs uppercase tracking-widest text-silver/60 hover:text-gold"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={commit}
              className="rounded border border-gold/40 bg-gold/10 px-2 py-1 text-xs uppercase tracking-widest text-gold hover:bg-gold/20"
            >
              Save
            </button>
          </div>
        </div>
      ) : (
        <>
          {bio?.trim() ? (
            <p className="whitespace-pre-line text-sm italic leading-relaxed text-silver/85">
              {bio}
            </p>
          ) : (
            <p className="text-sm text-silver/40">No bio yet.</p>
          )}
          {edit.enabled && (
            <button
              type="button"
              onClick={start}
              className="mt-2 text-[0.65rem] uppercase tracking-widest text-arcane hover:text-arcane-soft"
            >
              {bio?.trim() ? 'Edit bio' : '+ Add a bio'}
            </button>
          )}
        </>
      )}
    </Panel>
  );
}

function XpLogRow({ entry }: { entry: XpLogEntry }) {
  const date = entry.at ? new Date(entry.at) : null;
  const dateOk = date && !Number.isNaN(date.getTime());
  const amount = entry.amount ?? 0;
  const positive = amount >= 0;

  return (
    <li className="flex items-start gap-3 rounded border border-gold/15 bg-midnight-900/40 p-3">
      <div className="w-16 shrink-0 text-center">
        <div className={`font-display text-xl ${positive ? 'text-emerald-soft' : 'text-red-300'}`}>
          {positive ? '+' : ''}
          {amount}
        </div>
        <div className="text-[0.6rem] uppercase tracking-widest text-silver/50">XP</div>
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm text-silver/90">{entry.reason || 'XP awarded'}</div>
        <div className="mt-0.5 text-xs text-silver/50">
          {dateOk && (
            <>
              {date.toLocaleDateString(undefined, {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              })}
              {' · '}
              {date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
            </>
          )}
          {entry.oldXp != null && entry.newXp != null && (
            <span className="ml-2 tabular-nums">
              ({entry.oldXp} → {entry.newXp})
            </span>
          )}
        </div>
      </div>
    </li>
  );
}

function byNewestFirst(a: XpLogEntry, b: XpLogEntry): number {
  const ta = a.at ? Date.parse(a.at) : 0;
  const tb = b.at ? Date.parse(b.at) : 0;
  return tb - ta;
}

function EmptyBlock({ children }: { children: React.ReactNode }) {
  return (
    <p className="mx-auto max-w-md py-4 text-center text-sm text-silver/50">{children}</p>
  );
}
