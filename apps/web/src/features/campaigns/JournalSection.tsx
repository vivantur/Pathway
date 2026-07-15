import { useState, type FormEvent } from 'react';
import { Spinner } from '@/components/ui/Spinner';
import { useAuth } from '@/features/auth/useAuth';
import {
  useDeleteJournal,
  useJournal,
  usePostJournal,
  useUpdateJournal,
} from './useCampaigns';
import type { JournalEntry } from './api';

/**
 * Session journal / recaps for a campaign. Any member can post; an entry can be
 * edited or deleted by its author or the GM (enforced by RLS — this UI just
 * mirrors it). Author names come from the party roster.
 */
export function JournalSection({
  campaignId,
  isGm,
  authorName,
}: {
  campaignId: string;
  isGm: boolean;
  authorName: (userId: string | null) => string;
}) {
  const { user } = useAuth();
  const { data: entries, isLoading } = useJournal(campaignId);

  return (
    <section>
      <div className="mb-4 flex items-baseline justify-between border-b border-gold/15 pb-2">
        <h2 className="font-display text-xl text-gold">
          Session journal
          {entries && <span className="ml-1 text-sm text-silver/50">({entries.length})</span>}
        </h2>
      </div>
      <div className="space-y-4">
        <NewEntryForm campaignId={campaignId} />
        {isLoading && <Spinner label="Turning the pages…" />}
        {entries && entries.length === 0 && (
          <p className="rounded-lg border border-gold/15 bg-midnight-700/40 p-6 text-center text-sm text-silver/60">
            No entries yet. Post a recap after your next session.
          </p>
        )}
        {entries?.map((entry) => (
          <EntryCard
            key={entry.id}
            entry={entry}
            campaignId={campaignId}
            canEdit={entry.author_user_id === user?.id || isGm}
            authorName={authorName}
          />
        ))}
      </div>
    </section>
  );
}

const inputClass =
  'w-full rounded-md border border-gold/20 bg-midnight-900 px-3 py-2 text-sm text-silver placeholder:text-silver/30 focus:border-gold/60 focus:outline-none';

function NewEntryForm({ campaignId }: { campaignId: string }) {
  const post = usePostJournal(campaignId);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [sessionDate, setSessionDate] = useState('');
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await post.mutateAsync({ title, body, sessionDate });
      setTitle('');
      setSessionDate('');
      setBody('');
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not post the entry.');
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border border-gold/30 bg-gold/10 px-4 py-2 text-sm text-gold transition-colors hover:border-gold/60"
      >
        + New entry
      </button>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3 rounded-xl border border-gold/20 bg-midnight-900/50 p-4">
      <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title (optional) — e.g. Session 4: The Sunken Vault"
          className={inputClass}
        />
        <input type="date" value={sessionDate} onChange={(e) => setSessionDate(e.target.value)} className={inputClass} />
      </div>
      <textarea
        required
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={5}
        placeholder="What happened this session?"
        className={inputClass}
      />
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={post.isPending || !body.trim()}
          className="rounded-md bg-gold px-4 py-1.5 text-sm font-medium text-ink hover:opacity-90 disabled:opacity-50"
        >
          {post.isPending ? 'Posting…' : 'Post'}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-sm text-silver/70 hover:text-silver">
          Cancel
        </button>
        {error && <span className="text-sm text-red-300">{error}</span>}
      </div>
    </form>
  );
}

function EntryCard({
  entry,
  campaignId,
  canEdit,
  authorName,
}: {
  entry: JournalEntry;
  campaignId: string;
  canEdit: boolean;
  authorName: (userId: string | null) => string;
}) {
  const update = useUpdateJournal(campaignId);
  const del = useDeleteJournal(campaignId);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(entry.title ?? '');
  const [sessionDate, setSessionDate] = useState(entry.session_date ?? '');
  const [body, setBody] = useState(entry.body);

  const dateLabel = entry.session_date
    ? new Date(`${entry.session_date}T00:00:00`).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    : new Date(entry.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

  if (editing) {
    return (
      <div className="space-y-3 rounded-xl border border-gold/20 bg-midnight-900/50 p-4">
        <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title (optional)" className={inputClass} />
          <input type="date" value={sessionDate} onChange={(e) => setSessionDate(e.target.value)} className={inputClass} />
        </div>
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={5} className={inputClass} />
        <div className="flex gap-2">
          <button
            type="button"
            disabled={!body.trim()}
            onClick={async () => {
              await update.mutateAsync({ id: entry.id, input: { title, body, sessionDate } });
              setEditing(false);
            }}
            className="rounded-md bg-gold px-4 py-1.5 text-sm font-medium text-ink hover:opacity-90 disabled:opacity-50"
          >
            Save
          </button>
          <button type="button" onClick={() => setEditing(false)} className="text-sm text-silver/70 hover:text-silver">
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <article className="rounded-xl border border-gold/15 bg-midnight-900/50 p-4">
      <div className="mb-1 flex items-start justify-between gap-3">
        <div>
          {entry.title && <h3 className="font-display text-parchment">{entry.title}</h3>}
          <p className="text-[0.7rem] uppercase tracking-widest text-silver/45">
            {dateLabel} · {authorName(entry.author_user_id)}
          </p>
        </div>
        {canEdit && (
          <div className="flex shrink-0 gap-2 text-xs">
            <button type="button" onClick={() => setEditing(true)} className="text-silver/60 hover:text-gold">
              Edit
            </button>
            <button
              type="button"
              onClick={() => {
                if (window.confirm('Delete this entry?')) del.mutate(entry.id);
              }}
              className="text-red-300/60 hover:text-red-300"
            >
              Delete
            </button>
          </div>
        )}
      </div>
      <p className="whitespace-pre-wrap text-sm leading-relaxed text-silver/85">{entry.body}</p>
    </article>
  );
}
