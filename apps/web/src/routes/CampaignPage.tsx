import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { CornerBrackets } from '@/components/ui/CornerBrackets';
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

type Tab = 'party' | 'quests' | 'npcs' | 'journal';

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'party', label: 'Party', icon: '⚔' },
  { id: 'quests', label: 'Quests', icon: '✦' },
  { id: 'npcs', label: 'NPCs', icon: '☺' },
  { id: 'journal', label: 'Journal', icon: '❧' },
];

/** A campaign dashboard: a gilded hero header + tabbed party / quests / NPCs / journal. */
export function CampaignPage() {
  const { campaignId } = useParams<{ campaignId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();

  const { data: campaign, isLoading, isError, error } = useCampaign(campaignId);
  const { data: party } = useParty(campaignId);
  const deleteCampaign = useDeleteCampaign();
  const [tab, setTab] = useState<Tab>('party');

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
    <div className="space-y-6">
      <CampaignHero campaign={campaign} party={party} isGm={isGm} onDelete={onDelete} />

      <TabBar tab={tab} onChange={setTab} partyCount={party?.length ?? null} />

      {tab === 'party' && (
        <div className="space-y-6">
          {isGm && <InvitePanel code={campaign.join_code} />}

          {!party && <Spinner label="Summoning the party…" />}
          {party && party.length === 0 && (
            <EmptyPanel>
              No one has joined yet.{' '}
              {isGm ? 'Share the invite code above.' : 'Ask your GM for an invite code.'}
            </EmptyPanel>
          )}
          {party && party.length > 0 && (
            <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
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

          {myMembership && (
            <MyCharacterPanel campaignId={campaign.id} current={myMembership.char_key} />
          )}
        </div>
      )}

      {tab === 'quests' && <QuestsSection campaignId={campaign.id} isGm={isGm} />}

      {tab === 'npcs' && <NpcsSection campaignId={campaign.id} isGm={isGm} />}

      {tab === 'journal' && (
        <JournalSection
          campaignId={campaign.id}
          isGm={isGm}
          authorName={(uid) =>
            (party ?? []).find((m) => m.user_id === uid)?.username ?? 'Unknown'
          }
        />
      )}
    </div>
  );
}

// --- hero header -----------------------------------------------------------

function CampaignHero({
  campaign,
  party,
  isGm,
  onDelete,
}: {
  campaign: { id: string; name: string; description: string | null };
  party: PartyMember[] | undefined;
  isGm: boolean;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const update = useUpdateCampaign(campaign.id);
  const [name, setName] = useState(campaign.name);
  const [description, setDescription] = useState(campaign.description ?? '');

  const gm = (party ?? []).find((m) => m.role === 'gm');
  const players = (party ?? []).filter((m) => m.role !== 'gm');

  if (editing) {
    return (
      <header className="relative overflow-hidden rounded-lg border border-gold/30 bg-midnight-900/70 p-6 shadow-gilded">
        <CornerBrackets />
        <div className="relative space-y-3">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-md border border-gold/20 bg-midnight-900 px-3 py-2 font-display text-2xl text-parchment focus:border-gold/60 focus:outline-none"
          />
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            placeholder="A one-line pitch for your table."
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
      </header>
    );
  }

  return (
    <header className="relative overflow-hidden rounded-lg border border-gold/30 bg-midnight-900/70 p-6 shadow-gilded">
      <CornerBrackets />
      <div className="relative">
        <Link to="/campaigns" className="text-xs uppercase tracking-widest text-silver/50 hover:text-gold">
          ← Campaigns
        </Link>

        <div className="mt-2 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-3xl tracking-wide text-gold [overflow-wrap:anywhere] sm:text-4xl">
              {campaign.name}
            </h1>
            {campaign.description && (
              <p className="mt-1.5 max-w-2xl text-sm text-silver/70">{campaign.description}</p>
            )}
            <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm">
              <HeroStat label="Adventurers" value={players.length} />
              <HeroStat label="Game Master" value={gm?.username ?? '—'} />
              <HeroStat label="Your role" value={isGm ? 'GM' : 'Player'} />
            </dl>
          </div>

          <div className="flex shrink-0 flex-col items-start gap-3 sm:items-end">
            {party && party.length > 0 && <AvatarStack members={party} />}
            {isGm && (
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="rounded-md border border-gold/25 px-3 py-1.5 text-sm text-silver/80 transition-all hover:-translate-y-0.5 hover:border-gold/60 hover:text-gold"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={onDelete}
                  className="rounded-md border border-red-500/30 px-3 py-1.5 text-sm text-red-300/80 transition-all hover:-translate-y-0.5 hover:border-red-500/60 hover:text-red-300"
                >
                  Delete
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}

function HeroStat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[0.65rem] uppercase tracking-widest text-silver/50">{label}</dt>
      <dd className="font-display text-lg text-gold">{value}</dd>
    </div>
  );
}

/** Overlapping portrait circles for the party — a D&D-Beyond-style "who's here". */
function AvatarStack({ members }: { members: PartyMember[] }) {
  const shown = members.slice(0, 6);
  const extra = members.length - shown.length;
  return (
    <div className="flex items-center">
      <div className="flex -space-x-3">
        {shown.map((m) => {
          const initials = (m.character_name ?? m.username ?? '?').slice(0, 2).toUpperCase();
          return (
            <div
              key={m.user_id}
              title={m.character_name ?? m.username ?? undefined}
              className="h-9 w-9 overflow-hidden rounded-full border-2 border-midnight-900 bg-midnight-800 ring-1 ring-gold/40"
            >
              {m.art ? (
                <img src={m.art} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
              ) : (
                <div className="flex h-full w-full items-center justify-center font-display text-xs text-gold/70">
                  {initials}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {extra > 0 && <span className="ml-2 text-xs text-silver/50">+{extra}</span>}
    </div>
  );
}

// --- tab bar ---------------------------------------------------------------

function TabBar({
  tab,
  onChange,
  partyCount,
}: {
  tab: Tab;
  onChange: (t: Tab) => void;
  partyCount: number | null;
}) {
  return (
    <div className="flex flex-wrap gap-1 border-b border-gold/15">
      {TABS.map((t) => {
        const active = t.id === tab;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onChange(t.id)}
            className={`-mb-px flex items-center gap-2 rounded-t-md border-b-2 px-4 py-2.5 text-sm font-display uppercase tracking-widest transition-colors ${
              active
                ? 'border-gold bg-gold/5 text-gold'
                : 'border-transparent text-silver/60 hover:text-gold'
            }`}
          >
            <span aria-hidden className="text-base leading-none">{t.icon}</span>
            {t.label}
            {t.id === 'party' && partyCount != null && (
              <span className="rounded-full bg-midnight-700 px-1.5 text-[0.65rem] tabular-nums text-silver/70">
                {partyCount}
              </span>
            )}
          </button>
        );
      })}
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

  const tile = (
    <div className="group relative aspect-[3/4] overflow-hidden rounded-lg border border-gold/25 bg-midnight-900 shadow-gilded transition-all group-hover:border-gold/70">
      {member.art ? (
        <img
          src={member.art}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-midnight-700 to-midnight-950">
          <span className="font-display text-5xl text-gold/50">{initials}</span>
        </div>
      )}

      {/* badges */}
      <div className="absolute inset-x-2 top-2 flex items-start justify-between">
        {member.level != null ? (
          <span className="rounded border border-gold/40 bg-midnight-950/85 px-1.5 py-0.5 text-[0.65rem] font-display uppercase tracking-widest text-gold">
            L{member.level}
          </span>
        ) : (
          <span />
        )}
        {member.role === 'gm' ? (
          <span className="rounded border border-gold/40 bg-gold/15 px-1.5 py-0.5 text-[0.55rem] font-display uppercase tracking-widest text-gold">
            GM
          </span>
        ) : isMe ? (
          <span className="rounded border border-arcane/40 bg-arcane/15 px-1.5 py-0.5 text-[0.55rem] font-display uppercase tracking-widest text-arcane">
            You
          </span>
        ) : null}
      </div>

      {/* bottom gradient with name + class line + HP */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-midnight-950 via-midnight-950/85 to-transparent p-3 pt-10">
        <div className="truncate font-display text-base leading-tight text-gold">
          {member.character_name ?? <span className="italic text-silver/60">No character yet</span>}
        </div>
        {line && <div className="mt-0.5 truncate text-xs text-silver/70">{line}</div>}
        <div className="mt-1 flex items-center justify-between text-[0.7rem] text-silver/50">
          <span className="truncate">{member.username ?? 'Unknown'}</span>
          {member.current_hp != null && (
            <span className="ml-2 shrink-0 rounded bg-midnight-950/70 px-1.5 py-0.5 font-mono text-rose-300/90">
              {member.current_hp} HP
            </span>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <li className="group">
      {isMe && member.char_key ? (
        <Link to={`/vault/${encodeURIComponent(member.char_key)}`} className="block">
          {tile}
        </Link>
      ) : (
        tile
      )}
      {canRemove && (
        <div className="mt-1.5 text-right">
          <button
            type="button"
            onClick={() => {
              const msg = isMe ? 'Leave this campaign?' : `Remove ${member.username ?? 'this member'}?`;
              if (window.confirm(msg)) remove.mutate(member.user_id);
            }}
            className="text-xs text-red-300/60 hover:text-red-300"
          >
            {isMe ? 'Leave campaign' : 'Remove'}
          </button>
        </div>
      )}
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

function EmptyPanel({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-lg border border-gold/15 bg-midnight-700/40 p-8 text-center text-sm text-silver/60">
      {children}
    </p>
  );
}

function Info({ children, tone }: { children: React.ReactNode; tone?: 'danger' }) {
  const cls =
    tone === 'danger'
      ? 'border-red-500/30 bg-red-500/10 text-red-300'
      : 'border-arcane/25 bg-arcane/5 text-silver/75';
  return <div className={`rounded-lg border p-6 text-sm ${cls}`}>{children}</div>;
}
