import { useState } from 'react';
import { noteText } from '@/features/characters/api';
import { useCharacterNotes } from '@/features/characters/useCharacterNotes';
import { useUpdateCharacterNotes } from '@/features/characters/useUpdateCharacterNotes';
import type { CharacterNoteEntry, CharacterRow, XpLogEntry } from '@/features/characters/types';
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

  return (
    <div className="space-y-4">
      <BioPanel bio={character.notes ?? null} edit={edit} />

      <NotesPanel
        charKey={character.char_key}
        notes={notes ?? []}
        loading={notesLoading}
        canEdit={edit.enabled}
      />

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

/** Notes panel: the character_notes book, add/edit/delete in edit mode. */
function NotesPanel({
  charKey,
  notes,
  loading,
  canEdit,
}: {
  charKey: string;
  notes: CharacterNoteEntry[];
  loading: boolean;
  canEdit: boolean;
}) {
  const { addNote, editNote, deleteNote, isPending } = useUpdateCharacterNotes(charKey);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState('');

  const entries = notes.filter((n) => noteText(n).length > 0);

  const commitAdd = () => {
    const text = draft.trim();
    if (text) addNote(text);
    setDraft('');
    setAdding(false);
  };
  const startEdit = (n: CharacterNoteEntry) => {
    setEditingId(Number(n.id));
    setEditDraft(noteText(n));
  };
  const commitEdit = () => {
    if (editingId != null) {
      const text = editDraft.trim();
      if (text) editNote(editingId, text);
      else deleteNote(editingId); // clearing a note removes it
    }
    setEditingId(null);
    setEditDraft('');
  };

  return (
    <Panel title={`Notes${entries.length ? ` (${entries.length})` : ''}`} icon={<NoteIcon />}>
      {loading ? (
        <p className="text-sm text-silver/40">Loading notes…</p>
      ) : entries.length === 0 && !adding ? (
        <EmptyBlock>
          {canEdit
            ? 'No notes yet. Add one here, or from Discord with the bot — they stay in sync.'
            : 'No notes yet.'}
        </EmptyBlock>
      ) : (
        <ul className="space-y-3">
          {entries.map((n) => {
            const id = Number(n.id);
            return (
              <li key={id} className="group border-l-2 border-gold/30 pl-3">
                {editingId === id ? (
                  <NoteEditor
                    value={editDraft}
                    onChange={setEditDraft}
                    onCommit={commitEdit}
                    onCancel={() => setEditingId(null)}
                  />
                ) : (
                  <div className="flex items-start justify-between gap-2">
                    <p className="whitespace-pre-line text-sm leading-relaxed text-silver/90">
                      {noteText(n)}
                    </p>
                    {canEdit && (
                      <span className="flex shrink-0 gap-2 opacity-0 transition-opacity group-hover:opacity-100">
                        <button
                          type="button"
                          onClick={() => startEdit(n)}
                          className="text-[0.6rem] uppercase tracking-widest text-arcane hover:text-arcane-soft"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteNote(id)}
                          className="text-[0.6rem] uppercase tracking-widest text-red-300/80 hover:text-red-300"
                        >
                          Delete
                        </button>
                      </span>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {canEdit &&
        (adding ? (
          <div className="mt-3">
            <NoteEditor value={draft} onChange={setDraft} onCommit={commitAdd} onCancel={() => setAdding(false)} autoFocus />
          </div>
        ) : (
          <button
            type="button"
            disabled={isPending}
            onClick={() => setAdding(true)}
            className="mt-3 text-[0.65rem] uppercase tracking-widest text-arcane hover:text-arcane-soft disabled:opacity-50"
          >
            + Add a note
          </button>
        ))}
    </Panel>
  );
}

/** Shared textarea + Save/Cancel used for adding and editing a note. */
function NoteEditor({
  value,
  onChange,
  onCommit,
  onCancel,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  onCommit: () => void;
  onCancel: () => void;
  autoFocus?: boolean;
}) {
  return (
    <div className="space-y-2">
      <textarea
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        placeholder="Write a note…"
        className="w-full rounded border border-gold/30 bg-midnight-800/80 p-2 text-sm text-silver focus:border-gold/60 focus:outline-none"
      />
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="text-xs uppercase tracking-widest text-silver/60 hover:text-gold"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onCommit}
          className="rounded border border-gold/40 bg-gold/10 px-2 py-1 text-xs uppercase tracking-widest text-gold hover:bg-gold/20"
        >
          Save
        </button>
      </div>
    </div>
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
