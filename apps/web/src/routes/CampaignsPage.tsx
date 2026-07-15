import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { CornerBrackets } from '@/components/ui/CornerBrackets';
import { Spinner } from '@/components/ui/Spinner';
import { isSchemaNotReady } from '@/features/characters/errors';
import { useMyCharacters } from '@/features/characters/useCharacters';
import { useCreateCampaign, useJoinCampaign, useMyCampaigns } from '@/features/campaigns/useCampaigns';
import type { CampaignSummary } from '@/features/campaigns/api';

/**
 * Campaign hub: the campaigns you're in, plus create / join. A campaign is a
 * GM-owned table of players (each bringing a character from their vault).
 */
export function CampaignsPage() {
  const { data: campaigns, isLoading, isError, error } = useMyCampaigns();

  return (
    <div className="space-y-8">
      <header className="relative overflow-hidden rounded-lg border border-gold/30 bg-midnight-900/70 p-6 shadow-gilded">
        <CornerBrackets />
        <div className="relative">
          <h1 className="font-display text-3xl tracking-wide text-gold sm:text-4xl">Campaigns</h1>
          <p className="mt-1.5 max-w-2xl text-sm text-silver/70">
            Run a table from one place — your party, quests, NPCs, and session recaps at a glance.
            Create one as GM, or join with a code your GM shares.
          </p>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-2">
        <CreateCampaign />
        <JoinCampaign />
      </div>

      <section>
        <div className="mb-4 flex items-baseline justify-between border-b border-gold/15 pb-2">
          <h2 className="font-display text-xl text-gold">
            Your campaigns
            {campaigns && <span className="ml-1 text-sm text-silver/50">({campaigns.length})</span>}
          </h2>
        </div>
        {isLoading && <Spinner label="Gathering your tables…" />}
        {isError && isSchemaNotReady(error) && (
          <p className="rounded-md border border-arcane/25 bg-arcane/5 p-4 text-sm text-silver/75">
            Campaigns aren&apos;t set up in the database yet — apply the pending Supabase migration,
            then reload.
          </p>
        )}
        {isError && !isSchemaNotReady(error) && (
          <p className="rounded-md border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
            {error instanceof Error ? error.message : 'Could not load your campaigns.'}
          </p>
        )}
        {campaigns && campaigns.length === 0 && (
          <p className="rounded-lg border border-gold/15 bg-midnight-700/40 p-8 text-center text-sm text-silver/60">
            No campaigns yet. Create one above, or join with a code.
          </p>
        )}
        {campaigns && campaigns.length > 0 && (
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {campaigns.map((c) => (
              <CampaignCard key={c.id} campaign={c} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function CampaignCard({ campaign: c }: { campaign: CampaignSummary }) {
  const crest = c.name.trim().slice(0, 1).toUpperCase() || '?';
  return (
    <li>
      <Link
        to={`/campaigns/${c.id}`}
        className="group relative flex h-full gap-4 overflow-hidden rounded-xl border border-gold/20 bg-midnight-900/60 p-4 shadow-gilded transition-all hover:-translate-y-0.5 hover:border-gold/60 hover:shadow-arcane"
      >
        {/* Crest / illuminated initial */}
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg border border-gold/30 bg-gradient-to-br from-midnight-700 to-midnight-950 font-display text-2xl text-gold/70 shadow-gilded">
          {crest}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <span className="truncate font-display text-lg text-parchment group-hover:text-gold">
              {c.name}
            </span>
            <span
              className={`shrink-0 rounded px-1.5 py-0.5 text-[0.6rem] font-display uppercase tracking-widest ${
                c.role === 'gm' ? 'bg-gold/15 text-gold' : 'bg-midnight-700 text-silver/60'
              }`}
            >
              {c.role === 'gm' ? 'GM' : 'Player'}
            </span>
          </div>
          {c.description ? (
            <p className="mt-1 line-clamp-2 text-xs text-silver/60">{c.description}</p>
          ) : (
            <p className="mt-1 text-xs italic text-silver/35">No description yet.</p>
          )}
          <p className="mt-3 text-[0.7rem] uppercase tracking-widest text-silver/45">
            {c.member_count} {c.member_count === 1 ? 'member' : 'members'}
          </p>
        </div>
      </Link>
    </li>
  );
}

const inputClass =
  'mt-1 w-full rounded-md border border-gold/20 bg-midnight-900 px-3 py-2 text-sm text-silver placeholder:text-silver/30 focus:border-gold/60 focus:outline-none';

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-gold/15 bg-midnight-900/50 p-5">
      <h2 className="mb-3 font-display text-lg text-gold">{title}</h2>
      {children}
    </section>
  );
}

function CreateCampaign() {
  const navigate = useNavigate();
  const create = useCreateCampaign();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const id = await create.mutateAsync({ name, description });
      navigate(`/campaigns/${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the campaign.');
    }
  }

  return (
    <Panel title="Create a campaign">
      <form onSubmit={onSubmit} className="space-y-3">
        <label className="block text-sm text-silver/80">
          Name
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="The Fall of Plaguestone"
            className={inputClass}
          />
        </label>
        <label className="block text-sm text-silver/80">
          Description <span className="text-silver/40">(optional)</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            placeholder="A one-line pitch for your table."
            className={inputClass}
          />
        </label>
        <button
          type="submit"
          disabled={create.isPending || !name.trim()}
          className="w-full rounded-md bg-gold px-4 py-2 font-medium text-ink transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {create.isPending ? 'Creating…' : 'Create campaign'}
        </button>
        {error && <p className="text-sm text-red-300">{error}</p>}
      </form>
    </Panel>
  );
}

function JoinCampaign() {
  const navigate = useNavigate();
  const join = useJoinCampaign();
  const { data: characters } = useMyCharacters();
  const [searchParams] = useSearchParams();
  // Prefill from an invite link (…/campaigns?join=CODE).
  const [code, setCode] = useState(searchParams.get('join') ?? '');
  const [charKey, setCharKey] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const id = await join.mutateAsync({ code: code.trim(), charKey });
      navigate(`/campaigns/${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not join — check the code.');
    }
  }

  return (
    <Panel title="Join a campaign">
      <form onSubmit={onSubmit} className="space-y-3">
        <label className="block text-sm text-silver/80">
          Invite code
          <input
            required
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="e.g. a1b2c3d4"
            className={`${inputClass} font-mono`}
          />
        </label>
        <label className="block text-sm text-silver/80">
          Bring a character <span className="text-silver/40">(optional — you can set it later)</span>
          <select value={charKey} onChange={(e) => setCharKey(e.target.value)} className={inputClass}>
            <option value="">— none yet —</option>
            {(characters ?? []).map((c) => (
              <option key={c.char_key} value={c.char_key}>
                {c.name} {c.level ? `(Lv ${c.level})` : ''}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          disabled={join.isPending || !code.trim()}
          className="w-full rounded-md border border-gold/40 bg-gold/10 px-4 py-2 font-medium text-gold transition-colors hover:border-gold/70 disabled:opacity-50"
        >
          {join.isPending ? 'Joining…' : 'Join campaign'}
        </button>
        {error && <p className="text-sm text-red-300">{error}</p>}
      </form>
    </Panel>
  );
}
