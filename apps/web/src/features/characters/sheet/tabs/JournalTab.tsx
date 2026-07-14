import { useState } from 'react';
import { noteText } from '@/features/characters/api';
import { useCharacterNotes } from '@/features/characters/useCharacterNotes';
import { useUpdateCharacterNotes } from '@/features/characters/useUpdateCharacterNotes';
import { useCharacterDowntime } from '@/features/characters/useCharacterDowntime';
import { useUpdateCharacterDowntime } from '@/features/characters/useUpdateCharacterDowntime';
import { useXpLog, useXpLogMutations } from '@/features/characters/useXpLog';
import type { XpLogRow as XpLogTableRow } from '@/features/characters/xpLog';
import type {
  CharacterNoteEntry,
  CharacterRow,
  DowntimeLogEntry,
  XpLogEntry,
} from '@/features/characters/types';
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
  // Read the shared character_xp_log table (the bot's live store). Table rows can
  // be removed here (they have a stable id); a false entry is one Remove click
  // away. Older characters whose log predates the table fall back to the legacy
  // overlay copy, which is display-only (no id to delete).
  const { data: xpRows = [] } = useXpLog(character.char_key);
  const { remove } = useXpLogMutations(character.char_key);
  const legacyXp = character.overlay?.pathway_bot_state?.xpLog ?? [];
  const xpCount = xpRows.length || legacyXp.length;

  return (
    <div className="space-y-4">
      <BioPanel bio={character.notes ?? null} edit={edit} />

      <NotesPanel
        charKey={character.char_key}
        notes={notes ?? []}
        loading={notesLoading}
        canEdit={edit.enabled}
      />

      <DowntimePanel charKey={character.char_key} canEdit={edit.enabled} />

      <Panel title={`XP History${xpCount ? ` (${xpCount})` : ''}`} icon={<StarIcon />}>
        {xpCount === 0 ? (
          <EmptyBlock>
            No XP awards on record yet. Play a session — every /xp the bot logs
            will appear here with date, amount, and reason.
          </EmptyBlock>
        ) : xpRows.length ? (
          <ol className="space-y-2">
            {xpRows.map((row) => (
              <XpLogRow
                key={row.id}
                entry={rowToEntry(row)}
                onDelete={edit.enabled ? () => remove.mutate(row) : undefined}
                deleting={remove.isPending}
              />
            ))}
          </ol>
        ) : (
          <ol className="space-y-2">
            {[...legacyXp].sort(byNewestFirst).map((entry, i) => (
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

/** Downtime bank: spendable days + audit log, with grant/spend in edit mode. */
function DowntimePanel({ charKey, canEdit }: { charKey: string; canEdit: boolean }) {
  const { data, isLoading } = useCharacterDowntime(charKey);
  const { grant, spend, isPending } = useUpdateCharacterDowntime(charKey);
  const [days, setDays] = useState('');
  const [reason, setReason] = useState('');

  const bank = data?.bank ?? 0;
  const log = data?.log ?? [];
  const recent = [...log].reverse().slice(0, 8);

  const submit = (kind: 'grant' | 'spend') => {
    const n = Number(days);
    if (!Number.isFinite(n) || n <= 0) return;
    if (kind === 'grant') grant(n, reason);
    else spend(n, reason);
    setDays('');
    setReason('');
  };

  // Hide entirely for viewers when there's no downtime to show.
  if (!canEdit && !isLoading && bank === 0 && log.length === 0) return null;

  return (
    <Panel title="Downtime" icon={<StarIcon />}>
      {isLoading ? (
        <p className="text-sm text-silver/40">Loading downtime…</p>
      ) : (
        <>
          <div className="flex items-baseline gap-2">
            <span className="font-display text-2xl text-gold tabular-nums">{bank}</span>
            <span className="text-xs uppercase tracking-widest text-silver/60">days banked</span>
          </div>

          {canEdit && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <input
                type="number"
                min={1}
                value={days}
                onChange={(e) => setDays(e.target.value)}
                placeholder="Days"
                className="w-20 rounded border border-gold/30 bg-midnight-800/80 px-2 py-1 text-sm text-silver focus:border-gold/60 focus:outline-none"
              />
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Reason (optional)"
                className="min-w-0 flex-1 rounded border border-gold/30 bg-midnight-800/80 px-2 py-1 text-sm text-silver focus:border-gold/60 focus:outline-none"
              />
              <button
                type="button"
                disabled={isPending}
                onClick={() => submit('grant')}
                className="rounded border border-emerald/40 bg-emerald/10 px-2 py-1 text-xs uppercase tracking-widest text-emerald-soft hover:bg-emerald/20 disabled:opacity-50"
              >
                Grant
              </button>
              <button
                type="button"
                disabled={isPending || bank === 0}
                onClick={() => submit('spend')}
                className="rounded border border-red-400/40 bg-red-500/10 px-2 py-1 text-xs uppercase tracking-widest text-red-200 hover:bg-red-500/20 disabled:opacity-50"
              >
                Spend
              </button>
            </div>
          )}

          {recent.length > 0 && (
            <ul className="mt-3 space-y-1.5">
              {recent.map((e, i) => (
                <DowntimeLogRow key={`${e.ts}:${i}`} entry={e} />
              ))}
            </ul>
          )}
        </>
      )}
    </Panel>
  );
}

function DowntimeLogRow({ entry }: { entry: DowntimeLogEntry }) {
  const date = entry.ts ? new Date(entry.ts) : null;
  const dateOk = date && !Number.isNaN(date.getTime());
  const positive = entry.delta >= 0;
  return (
    <li className="flex items-baseline justify-between gap-2 text-xs">
      <span className="flex items-baseline gap-2">
        <span className={`font-display tabular-nums ${positive ? 'text-emerald-soft' : 'text-red-300'}`}>
          {positive ? '+' : ''}
          {entry.delta}
        </span>
        <span className="text-silver/50 capitalize">{entry.kind}</span>
        {entry.reason && <span className="text-silver/75">— {entry.reason}</span>}
      </span>
      <span className="shrink-0 text-silver/40">
        {dateOk ? date!.toLocaleDateString() : ''} · {entry.balance}d
      </span>
    </li>
  );
}

/** Map a character_xp_log table row to the display shape XpLogRow renders. */
function rowToEntry(r: XpLogTableRow): XpLogEntry {
  return {
    at: r.created_at,
    amount: r.amount,
    reason: r.reason ?? undefined,
    oldXp: r.old_xp,
    newXp: r.new_xp,
    awardedBy: r.awarded_by_discord_id ?? undefined,
  };
}

function XpLogRow({
  entry,
  onDelete,
  deleting,
}: {
  entry: XpLogEntry;
  onDelete?: () => void;
  deleting?: boolean;
}) {
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
      {onDelete && (
        <button
          type="button"
          onClick={onDelete}
          disabled={deleting}
          title="Remove this XP entry (adjusts your total and syncs to the bot)"
          className="shrink-0 self-center rounded border border-red-400/30 px-2 py-0.5 text-xs text-red-300/80 hover:bg-red-500/10 disabled:opacity-50"
        >
          Remove
        </button>
      )}
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
