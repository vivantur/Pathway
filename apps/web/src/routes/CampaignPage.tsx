import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Spinner } from '@/components/ui/Spinner';
import { useAuth } from '@/features/auth/useAuth';
import { isSchemaNotReady } from '@/features/characters/errors';
import { useMyCharacters } from '@/features/characters/useCharacters';
import {
  useCampaign,
  useDeleteCampaign,
  useParty,
  useRemoveMember,
  useSetMyCharacter,
  useUpdateCampaign,
} from '@/features/campaigns/useCampaigns';
import type { PartyMember } from '@/features/campaigns/api';
import { JournalSection } from '@/features/campaigns/JournalSection';
import { NpcsSection } from '@/features/campaigns/NpcsSection';
import { QuestsSection } from '@/features/campaigns/QuestsSection';

/** A campaign dashboard: the party at a glance + membership + GM controls. */
export function CampaignPage() {
  const { campaignId } = useParams<{ campaignId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();

  const { data: campaign, isLoading, isError, error } = useCampaign(campaignId);
  const { data: party } = useParty(campaignId);
  const deleteCampaign = useDeleteCampaign();

  const isGm = !!campaign && !!user && campaign.gm_user_id === user.id;
  const myMembership = useMemo(
    () => (party ?? []).find((m) => m.user_id === user?.id),
    [party, user?.id],
  );

  if (isLoading) {
    return (
      <div className="flex justify-center py-20">
        <Spinner label="Opening the campaign…" />
      </div>
    );
  }
  if (isError && isSchemaNotReady(error)) {
    return <Info>Campaigns aren&apos;t set up in the database yet — apply the pending migration.</Info>;
  }
  if (isError || !campaign) {
    return (
      <Info tone="danger">
        Couldn&apos;t open this campaign — you may not be a member, or it doesn&apos;t exist.{' '}
        <Link to="/campaigns" className="text-gold underline">
          Back to campaigns
        </Link>
      </Info>
    );
  }

  async function onDelete() {
    if (!campaign) return;
    if (!window.confirm(`Delete "${campaign.name}"? This removes it for everyone and can't be undone.`)) return;
    await deleteCampaign.mutateAsync(campaign.id);
    navigate('/campaigns');
  }

  return (
    <div className="space-y-8">
      <CampaignHeader campaign={campaign} isGm={isGm} onDelete={onDelete} />

      {isGm && <InvitePanel code={campaign.join_code} />}

      <section>
        <h2 className="mb-3 font-display text-lg text-gold">
          Party{party ? ` (${party.length})` : ''}
        </h2>
        {!party && <Spinner label="Summoning the party…" />}
        {party && party.length === 0 && (
          <p className="rounded-lg border border-gold/15 bg-midnight-700/40 p-6 text-center text-sm text-silver/60">
            No one has joined yet. Share the invite code above.
          </p>
        )}
        {party && party.length > 0 && (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {party.map((m) => (
              <PartyCard
                key={m.user_id}
                member={m}
                isMe={m.user_id === user?.id}
                // A GM manages the campaign via Delete, never "leaves"; only
                // non-GM members can be kicked (by GM) or leave (themselves).
                canRemove={m.role !== 'gm' && (isGm || m.user_id === user?.id)}
                campaignId={campaign.id}
              />
            ))}
          </ul>
        )}
      </section>

      {myMembership && (
        <MyCharacterPanel campaignId={campaign.id} current={myMembership.char_key} />
      )}

      <QuestsSection campaignId={campaign.id} isGm={isGm} />

      <NpcsSection campaignId={campaign.id} isGm={isGm} />

      <JournalSection
        campaignId={campaign.id}
        isGm={isGm}
        authorName={(uid) =>
          (party ?? []).find((m) => m.user_id === uid)?.username ?? 'Unknown'
        }
      />
    </div>
  );
}

// --- header ----------------------------------------------------------------

function CampaignHeader({
  campaign,
  isGm,
  onDelete,
}: {
  campaign: { id: string; name: string; description: string | null };
  isGm: boolean;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const update = useUpdateCampaign(campaign.id);
  const [name, setName] = useState(campaign.name);
  const [description, setDescription] = useState(campaign.description ?? '');

  if (editing) {
    return (
      <section className="rounded-xl border border-gold/20 bg-midnight-900/50 p-5">
        <div className="space-y-3">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-md border border-gold/20 bg-midnight-900 px-3 py-2 text-lg font-display text-parchment focus:border-gold/60 focus:outline-none"
          />
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className="w-full rounded-md border border-gold/20 bg-midnight-900 px-3 py-2 text-sm text-silver focus:border-gold/60 focus:outline-none"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={async () => {
                await update.mutateAsync({ name: name.trim() || campaign.name, description: description.trim() || null });
                setEditing(false);
              }}
              className="rounded-md bg-gold px-4 py-1.5 text-sm font-medium text-ink hover:opacity-90"
            >
              Save
            </button>
            <button type="button" onClick={() => setEditing(false)} className="text-sm text-silver/70 hover:text-silver">
              Cancel
            </button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <Link to="/campaigns" className="text-xs text-silver/50 hover:text-gold">
          ← Campaigns
        </Link>
        <h1 className="mt-1 font-display text-2xl text-gold">{campaign.name}</h1>
        {campaign.description && <p className="mt-1 max-w-2xl text-sm text-silver/70">{campaign.description}</p>}
      </div>
      {isGm && (
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="rounded-md border border-gold/25 px-3 py-1.5 text-sm text-silver/80 hover:border-gold/50 hover:text-gold"
          >
            Edit
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="rounded-md border border-red-500/30 px-3 py-1.5 text-sm text-red-300/80 hover:border-red-500/60 hover:text-red-300"
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

// --- invite ----------------------------------------------------------------

function InvitePanel({ code }: { code: string }) {
  const [copied, setCopied] = useState<'code' | 'link' | null>(null);
  const link = `${window.location.origin}/campaigns?join=${code}`;
  const copy = async (what: 'code' | 'link', value: string) => {
    await navigator.clipboard.writeText(value);
    setCopied(what);
    setTimeout(() => setCopied(null), 1500);
  };
  return (
    <section className="rounded-xl border border-gold/15 bg-midnight-900/50 p-5">
      <h2 className="mb-1 font-display text-lg text-gold">Invite players</h2>
      <p className="mb-3 text-xs text-silver/60">
        Share the code or link. Players open it, pick a character, and join.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <code className="rounded-md border border-gold/20 bg-midnight-950/60 px-3 py-1.5 font-mono text-gold">
          {code}
        </code>
        <button
          type="button"
          onClick={() => copy('code', code)}
          className="rounded-md border border-gold/25 px-3 py-1.5 text-sm text-silver/80 hover:border-gold/50 hover:text-gold"
        >
          {copied === 'code' ? 'Copied!' : 'Copy code'}
        </button>
        <button
          type="button"
          onClick={() => copy('link', link)}
          className="rounded-md border border-gold/25 px-3 py-1.5 text-sm text-silver/80 hover:border-gold/50 hover:text-gold"
        >
          {copied === 'link' ? 'Copied!' : 'Copy invite link'}
        </button>
      </div>
    </section>
  );
}

// --- party card ------------------------------------------------------------

function PartyCard({
  member,
  isMe,
  canRemove,
  campaignId,
}: {
  member: PartyMember;
  isMe: boolean;
  canRemove: boolean;
  campaignId: string;
}) {
  const remove = useRemoveMember(campaignId);
  const initials = (member.character_name ?? member.username ?? '?').slice(0, 2).toUpperCase();
  const line = [
    member.level ? `Lv ${member.level}` : null,
    member.ancestry_name,
    member.class_name,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <li className="rounded-xl border border-gold/15 bg-midnight-900/50 p-4">
      <div className="flex items-start gap-3">
        {member.art ? (
          <img src={member.art} alt="" className="h-12 w-12 shrink-0 rounded-lg border border-gold/30 object-cover" />
        ) : (
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-gold/20 bg-midnight-800 font-display text-sm text-gold/70">
            {initials}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-display text-parchment">
              {member.character_name ?? <span className="italic text-silver/50">No character yet</span>}
            </span>
            {member.role === 'gm' && (
              <span className="rounded bg-gold/15 px-1.5 py-0.5 text-[0.55rem] uppercase tracking-widest text-gold">GM</span>
            )}
          </div>
          {line && <p className="truncate text-xs text-silver/60">{line}</p>}
          <p className="truncate text-[0.7rem] text-silver/45">{member.username ?? 'Unknown'}</p>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between">
        <span className="text-xs text-silver/70">
          {member.current_hp != null ? `HP ${member.current_hp}` : '—'}
        </span>
        <div className="flex items-center gap-2">
          {isMe && member.char_key && (
            <Link to={`/vault/${encodeURIComponent(member.char_key)}`} className="text-xs text-arcane hover:text-arcane-soft">
              Open sheet ↗
            </Link>
          )}
          {canRemove && (
            <button
              type="button"
              onClick={() => {
                const msg = isMe ? 'Leave this campaign?' : `Remove ${member.username ?? 'this member'}?`;
                if (window.confirm(msg)) remove.mutate(member.user_id);
              }}
              className="text-xs text-red-300/70 hover:text-red-300"
            >
              {isMe ? 'Leave' : 'Remove'}
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

// --- "your character" picker ----------------------------------------------

function MyCharacterPanel({ campaignId, current }: { campaignId: string; current: string | null }) {
  const { data: characters } = useMyCharacters();
  const setChar = useSetMyCharacter(campaignId);
  return (
    <section className="rounded-xl border border-gold/15 bg-midnight-900/50 p-5">
      <h2 className="mb-1 font-display text-lg text-gold">Your character</h2>
      <p className="mb-3 text-xs text-silver/60">Choose which of your characters you bring to this table.</p>
      <select
        value={current ?? ''}
        onChange={(e) => setChar.mutate(e.target.value || null)}
        className="w-full max-w-sm rounded-md border border-gold/20 bg-midnight-900 px-3 py-2 text-sm text-silver focus:border-gold/60 focus:outline-none"
      >
        <option value="">— none —</option>
        {(characters ?? []).map((c) => (
          <option key={c.char_key} value={c.char_key}>
            {c.name} {c.level ? `(Lv ${c.level})` : ''}
          </option>
        ))}
      </select>
    </section>
  );
}

// --- shared ----------------------------------------------------------------

function Info({ children, tone }: { children: React.ReactNode; tone?: 'danger' }) {
  const cls =
    tone === 'danger'
      ? 'border-red-500/30 bg-red-500/10 text-red-300'
      : 'border-arcane/25 bg-arcane/5 text-silver/75';
  return <div className={`rounded-lg border p-6 text-sm ${cls}`}>{children}</div>;
}
