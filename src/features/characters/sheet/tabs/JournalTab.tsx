import { noteText } from '@/features/characters/api';
import { useCharacterNotes } from '@/features/characters/useCharacterNotes';
import type { CharacterRow, XpLogEntry } from '@/features/characters/types';
import { Panel } from '../Sheet';
import { NoteIcon, StarIcon } from '../icons';

/**
 * Journal — biographical + play-history view.
 * - Bio: the character's `notes` text column (short description).
 * - Notes: the full character_notes list (long-form, added over time).
 * - XP History: overlay.pathway_bot_state.xpLog, reverse-chronological.
 */
export function JournalTab({ character }: { character: CharacterRow }) {
  const { data: notes, isLoading: notesLoading } = useCharacterNotes(character.char_key);
  const xpLog = character.overlay?.pathway_bot_state?.xpLog ?? [];
  const bio = character.notes?.trim();

  const noteEntries = (notes ?? []).filter((n) => noteText(n).length > 0);

  return (
    <div className="space-y-4">
      {bio && (
        <Panel title="Bio" icon={<NoteIcon />}>
          <p className="whitespace-pre-line text-sm italic leading-relaxed text-silver/85">
            {bio}
          </p>
        </Panel>
      )}

      <Panel title={`Notes${noteEntries.length ? ` (${noteEntries.length})` : ''}`} icon={<NoteIcon />}>
        {notesLoading ? (
          <p className="text-sm text-silver/40">Loading notes…</p>
        ) : noteEntries.length === 0 ? (
          <EmptyBlock>
            No notes yet. Add them from Discord with the bot — they'll show up here.
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
            {[...xpLog]
              .sort(byNewestFirst)
              .map((entry, i) => (
                <XpLogRow key={i} entry={entry} />
              ))}
          </ol>
        )}
      </Panel>
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
        <div
          className={`font-display text-xl ${positive ? 'text-emerald-soft' : 'text-red-300'}`}
        >
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
