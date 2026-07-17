import { useState, type FormEvent } from 'react';
import { Spinner } from '@/components/ui/Spinner';
import { useCreateNpc, useDeleteNpc, useNpcs, useUpdateNpc } from './useCampaigns';
import type { Npc, NpcInput } from './api';

/**
 * NPC tracker. The GM authors NPCs (with private gm_notes and a hidden/secret
 * toggle); players see only revealed NPCs, and never gm_notes — enforced by the
 * `campaign_npcs_list` RPC, so this UI just reflects what the server returns.
 */
export function NpcsSection({ campaignId, isGm }: { campaignId: string; isGm: boolean }) {
  const { data: npcs, isLoading } = useNpcs(campaignId);
  const [adding, setAdding] = useState(false);

  return (
    <section>
      <div className="mb-4 flex items-center justify-between border-b border-gold/15 pb-2">
        <h2 className="font-display text-xl text-gold">
          NPCs{npcs ? <span className="ml-1 text-sm text-silver/50">({npcs.length})</span> : null}
        </h2>
        {isGm && !adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="rounded-md border border-gold/30 bg-gold/10 px-3 py-1.5 text-sm text-gold transition-all hover:-translate-y-0.5 hover:border-gold/60"
          >
            + Add NPC
          </button>
        )}
      </div>

      <div className="space-y-3">
        {isGm && adding && (
          <NpcForm campaignId={campaignId} onDone={() => setAdding(false)} />
        )}
        {isLoading && <Spinner label="Rounding up the cast…" />}
        {npcs && npcs.length === 0 && !adding && (
          <p className="rounded-lg border border-gold/15 bg-midnight-700/40 p-6 text-center text-sm text-silver/60">
            {isGm ? 'No NPCs yet. Add your first with “+ Add NPC”.' : 'No NPCs to show yet.'}
          </p>
        )}
        {npcs?.map((npc) => (
          <NpcCard key={npc.id} npc={npc} campaignId={campaignId} isGm={isGm} />
        ))}
      </div>
    </section>
  );
}

const inputClass =
  'w-full rounded-md border border-gold/20 bg-midnight-900 px-3 py-2 text-sm text-silver placeholder:text-silver/30 focus:border-gold/60 focus:outline-none';

function NpcForm({
  campaignId,
  npc,
  onDone,
}: {
  campaignId: string;
  npc?: Npc;
  onDone: () => void;
}) {
  const create = useCreateNpc(campaignId);
  const update = useUpdateNpc(campaignId);
  const [name, setName] = useState(npc?.name ?? '');
  const [role, setRole] = useState(npc?.role ?? '');
  const [location, setLocation] = useState(npc?.location ?? '');
  const [description, setDescription] = useState(npc?.description ?? '');
  const [gmNotes, setGmNotes] = useState(npc?.gm_notes ?? '');
  const [isSecret, setIsSecret] = useState(npc?.is_secret ?? false);
  const [error, setError] = useState<string | null>(null);

  const busy = create.isPending || update.isPending;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const input: NpcInput = { name, role, location, description, gmNotes, isSecret };
    try {
      if (npc) await update.mutateAsync({ id: npc.id, input });
      else await create.mutateAsync(input);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the NPC.');
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3 rounded-xl border border-gold/20 bg-midnight-900/50 p-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name *" required className={inputClass} />
        <input value={role} onChange={(e) => setRole(e.target.value)} placeholder="Role (e.g. Villain, Ally)" className={inputClass} />
        <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Location" className={inputClass} />
      </div>
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        rows={2}
        placeholder="Description (players can see this once revealed)"
        className={inputClass}
      />
      <textarea
        value={gmNotes}
        onChange={(e) => setGmNotes(e.target.value)}
        rows={2}
        placeholder="GM notes (secret — never shown to players)"
        className={`${inputClass} border-arcane/30`}
      />
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-silver/80">
          <input type="checkbox" checked={isSecret} onChange={(e) => setIsSecret(e.target.checked)} />
          Hidden from players (secret)
        </label>
        <button
          type="submit"
          disabled={busy || !name.trim()}
          className="rounded-md bg-gold px-4 py-1.5 text-sm font-medium text-ink hover:opacity-90 disabled:opacity-50"
        >
          {busy ? 'Saving…' : npc ? 'Save' : 'Add NPC'}
        </button>
        <button type="button" onClick={onDone} className="text-sm text-silver/70 hover:text-silver">
          Cancel
        </button>
        {error && <span className="text-sm text-red-300">{error}</span>}
      </div>
    </form>
  );
}

function NpcCard({ npc, campaignId, isGm }: { npc: Npc; campaignId: string; isGm: boolean }) {
  const del = useDeleteNpc(campaignId);
  const [editing, setEditing] = useState(false);
  if (editing) return <NpcForm campaignId={campaignId} npc={npc} onDone={() => setEditing(false)} />;

  const sub = [npc.role, npc.location].filter(Boolean).join(' · ');
  return (
    <article className="rounded-xl border border-gold/15 bg-midnight-900/50 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-display text-parchment">{npc.name}</h3>
            {npc.is_secret && (
              <span className="rounded bg-arcane/15 px-1.5 py-0.5 text-[0.55rem] uppercase tracking-widest text-arcane/90">
                Hidden
              </span>
            )}
          </div>
          {sub && <p className="text-[0.7rem] uppercase tracking-widest text-silver/45">{sub}</p>}
        </div>
        {isGm && (
          <div className="flex shrink-0 gap-2 text-xs">
            <button type="button" onClick={() => setEditing(true)} className="text-silver/60 hover:text-gold">
              Edit
            </button>
            <button
              type="button"
              onClick={() => {
                if (window.confirm(`Delete ${npc.name}?`)) del.mutate(npc.id);
              }}
              className="text-red-300/60 hover:text-red-300"
            >
              Delete
            </button>
          </div>
        )}
      </div>
      {npc.description && <p className="mt-2 whitespace-pre-wrap text-sm text-silver/85">{npc.description}</p>}
      {isGm && npc.gm_notes && (
        <p className="mt-2 whitespace-pre-wrap rounded-md border border-arcane/25 bg-arcane/5 p-2 text-xs text-silver/70">
          <span className="uppercase tracking-widest text-arcane/80">GM notes · </span>
          {npc.gm_notes}
        </p>
      )}
    </article>
  );
}
