import { useState, type FormEvent } from 'react';
import { Spinner } from '@/components/ui/Spinner';
import {
  useCreateQuest,
  useDeleteQuest,
  useQuests,
  useSetQuestStatus,
  useUpdateQuest,
} from './useCampaigns';
import type { Quest, QuestInput, QuestStatus } from './api';

const STATUS_META: Record<QuestStatus, { label: string; cls: string }> = {
  active: { label: 'Active', cls: 'bg-gold/15 text-gold' },
  completed: { label: 'Completed', cls: 'bg-emerald-500/15 text-emerald-300' },
  failed: { label: 'Failed', cls: 'bg-red-500/15 text-red-300' },
};

/**
 * Quest tracker. Same secrecy model as NPCs (GM-authored; gm_notes + secret
 * quests are stripped for players by the campaign_quests_list RPC).
 */
export function QuestsSection({ campaignId, isGm }: { campaignId: string; isGm: boolean }) {
  const { data: quests, isLoading } = useQuests(campaignId);
  const [adding, setAdding] = useState(false);

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-display text-lg text-gold">Quests{quests ? ` (${quests.length})` : ''}</h2>
        {isGm && !adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="rounded-md border border-gold/30 bg-gold/10 px-3 py-1.5 text-sm text-gold hover:border-gold/60"
          >
            + Add quest
          </button>
        )}
      </div>

      <div className="space-y-3">
        {isGm && adding && <QuestForm campaignId={campaignId} onDone={() => setAdding(false)} />}
        {isLoading && <Spinner label="Consulting the quest board…" />}
        {quests && quests.length === 0 && !adding && (
          <p className="rounded-lg border border-gold/15 bg-midnight-700/40 p-6 text-center text-sm text-silver/60">
            {isGm ? 'No quests yet. Add one with “+ Add quest”.' : 'No quests to show yet.'}
          </p>
        )}
        {quests?.map((quest) => (
          <QuestCard key={quest.id} quest={quest} campaignId={campaignId} isGm={isGm} />
        ))}
      </div>
    </section>
  );
}

const inputClass =
  'w-full rounded-md border border-gold/20 bg-midnight-900 px-3 py-2 text-sm text-silver placeholder:text-silver/30 focus:border-gold/60 focus:outline-none';

function QuestForm({ campaignId, quest, onDone }: { campaignId: string; quest?: Quest; onDone: () => void }) {
  const create = useCreateQuest(campaignId);
  const update = useUpdateQuest(campaignId);
  const [title, setTitle] = useState(quest?.title ?? '');
  const [description, setDescription] = useState(quest?.description ?? '');
  const [status, setStatus] = useState<QuestStatus>(quest?.status ?? 'active');
  const [gmNotes, setGmNotes] = useState(quest?.gm_notes ?? '');
  const [isSecret, setIsSecret] = useState(quest?.is_secret ?? false);
  const [error, setError] = useState<string | null>(null);
  const busy = create.isPending || update.isPending;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const input: QuestInput = { title, description, status, gmNotes, isSecret };
    try {
      if (quest) await update.mutateAsync({ id: quest.id, input });
      else await create.mutateAsync(input);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the quest.');
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3 rounded-xl border border-gold/20 bg-midnight-900/50 p-4">
      <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Quest title *" required className={inputClass} />
        <select value={status} onChange={(e) => setStatus(e.target.value as QuestStatus)} className={inputClass}>
          <option value="active">Active</option>
          <option value="completed">Completed</option>
          <option value="failed">Failed</option>
        </select>
      </div>
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        rows={2}
        placeholder="What are they trying to accomplish? (players can see this once revealed)"
        className={inputClass}
      />
      <textarea
        value={gmNotes}
        onChange={(e) => setGmNotes(e.target.value)}
        rows={2}
        placeholder="GM notes (secret)"
        className={`${inputClass} border-arcane/30`}
      />
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-silver/80">
          <input type="checkbox" checked={isSecret} onChange={(e) => setIsSecret(e.target.checked)} />
          Hidden from players (secret)
        </label>
        <button
          type="submit"
          disabled={busy || !title.trim()}
          className="rounded-md bg-gold px-4 py-1.5 text-sm font-medium text-ink hover:opacity-90 disabled:opacity-50"
        >
          {busy ? 'Saving…' : quest ? 'Save' : 'Add quest'}
        </button>
        <button type="button" onClick={onDone} className="text-sm text-silver/70 hover:text-silver">
          Cancel
        </button>
        {error && <span className="text-sm text-red-300">{error}</span>}
      </div>
    </form>
  );
}

function QuestCard({ quest, campaignId, isGm }: { quest: Quest; campaignId: string; isGm: boolean }) {
  const setStatus = useSetQuestStatus(campaignId);
  const del = useDeleteQuest(campaignId);
  const [editing, setEditing] = useState(false);
  if (editing) return <QuestForm campaignId={campaignId} quest={quest} onDone={() => setEditing(false)} />;

  const meta = STATUS_META[quest.status];
  return (
    <article
      className={`rounded-xl border bg-midnight-900/50 p-4 ${
        quest.status === 'active' ? 'border-gold/15' : 'border-gold/10 opacity-80'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className={`font-display text-parchment ${quest.status !== 'active' ? 'line-through decoration-silver/40' : ''}`}>
              {quest.title}
            </h3>
            <span className={`rounded px-1.5 py-0.5 text-[0.55rem] uppercase tracking-widest ${meta.cls}`}>{meta.label}</span>
            {quest.is_secret && (
              <span className="rounded bg-arcane/15 px-1.5 py-0.5 text-[0.55rem] uppercase tracking-widest text-arcane/90">
                Hidden
              </span>
            )}
          </div>
        </div>
        {isGm && (
          <div className="flex shrink-0 items-center gap-2 text-xs">
            <select
              value={quest.status}
              onChange={(e) => setStatus.mutate({ id: quest.id, status: e.target.value as QuestStatus })}
              className="rounded border border-gold/20 bg-midnight-900 px-1.5 py-0.5 text-silver/80"
            >
              <option value="active">Active</option>
              <option value="completed">Completed</option>
              <option value="failed">Failed</option>
            </select>
            <button type="button" onClick={() => setEditing(true)} className="text-silver/60 hover:text-gold">
              Edit
            </button>
            <button
              type="button"
              onClick={() => {
                if (window.confirm(`Delete "${quest.title}"?`)) del.mutate(quest.id);
              }}
              className="text-red-300/60 hover:text-red-300"
            >
              Delete
            </button>
          </div>
        )}
      </div>
      {quest.description && <p className="mt-2 whitespace-pre-wrap text-sm text-silver/85">{quest.description}</p>}
      {isGm && quest.gm_notes && (
        <p className="mt-2 whitespace-pre-wrap rounded-md border border-arcane/25 bg-arcane/5 p-2 text-xs text-silver/70">
          <span className="uppercase tracking-widest text-arcane/80">GM notes · </span>
          {quest.gm_notes}
        </p>
      )}
    </article>
  );
}
