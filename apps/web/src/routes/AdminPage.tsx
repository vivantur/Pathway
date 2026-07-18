import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Spinner } from '@/components/ui/Spinner';
import { useAdminCharacters, useAdminStats, useAdminUsers } from '@/features/admin/useAdmin';
import type { AdminCharacterRow, AdminUserRow } from '@/features/admin/api';
import { useFeedbackInbox, useUpdateFeedbackStatus } from '@/features/feedback/useFeedback';
import type { FeedbackRow, FeedbackStatus } from '@/features/feedback/api';
import { isSchemaNotReady } from '@/features/characters/errors';
import {
  loadFallbackIndex,
  resolveFallbackRow,
  type FallbackIndex,
} from '@/features/characters/useFeatFallback';

/**
 * Admin dashboard — read-only oversight for the project owner. Every data query
 * hits an admin-gated RPC (server re-checks is_admin()), so this page renders
 * only for admins and shows nothing sensitive to anyone else even if reached.
 */
export function AdminPage() {
  const stats = useAdminStats(true);
  const users = useAdminUsers(true);
  const characters = useAdminCharacters(true);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-2xl text-gold">Admin</h1>
        <p className="mt-1 text-sm text-silver/70">
          Read-only oversight across the whole vault. Numbers are live from Supabase.
        </p>
      </div>

      <StatsPanel query={stats} />
      <FeedbackPanel />
      <UsersPanel query={users} />
      <CharactersPanel query={characters} />
      <ContentGapsPanel />
      <EffectEnginePanel />
    </div>
  );
}

// --- effect engine ---------------------------------------------------------

/**
 * Links to the admin-only effect diagnostics. Both are unlinked from the nav and
 * lazy-loaded (their sidecars are diagnostic data, not player content), so this is
 * where an admin reaches them.
 */
function EffectEnginePanel() {
  const tools = [
    {
      to: '/admin/effect-coverage',
      title: 'Ingest coverage',
      body: 'Every Foundry rule element and what our mapper made of it — mapped, or reported with the reason it could not be.',
    },
    {
      to: '/admin/effect-review',
      title: 'Review queue',
      body: 'Reconciled proposals from the parser and Foundry, triaged for a human to accept or reject into content.',
    },
  ];
  return (
    <Panel title="Effect engine" subtitle="Admin-only diagnostics over auto-mapped content.">
      <div className="grid gap-3 sm:grid-cols-2">
        {tools.map((t) => (
          <Link
            key={t.to}
            to={t.to}
            className="rounded-lg border border-gold/15 bg-midnight-800/40 p-4 transition-colors hover:border-gold/40"
          >
            <div className="font-display text-gold">{t.title}</div>
            <p className="mt-1 text-sm text-silver/70">{t.body}</p>
          </Link>
        ))}
      </div>
    </Panel>
  );
}

// --- shared bits -----------------------------------------------------------

function Panel({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-gold/15 bg-midnight-900/50 p-5">
      <div className="mb-4">
        <h2 className="font-display text-lg text-gold">{title}</h2>
        {subtitle && <p className="mt-0.5 text-xs text-silver/60">{subtitle}</p>}
      </div>
      {children}
    </section>
  );
}

function QueryState({
  isLoading,
  error,
  label,
}: {
  isLoading: boolean;
  error: unknown;
  label: string;
}) {
  if (isLoading) return <Spinner label={label} />;
  if (error) {
    if (isSchemaNotReady(error)) {
      return (
        <p className="rounded-md border border-arcane/25 bg-arcane/5 p-3 text-sm text-silver/75">
          This table isn&apos;t set up yet — apply the pending Supabase migration, then reload.
        </p>
      );
    }
    return (
      <p className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
        {error instanceof Error ? error.message : 'Failed to load.'}
      </p>
    );
  }
  return null;
}

const fmtDate = (iso: string | null): string =>
  iso ? new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—';

// --- stats -----------------------------------------------------------------

function StatCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg border border-gold/15 bg-midnight-800/50 px-4 py-3">
      <div className="font-display text-2xl text-parchment">{value}</div>
      <div className="mt-0.5 text-[0.65rem] uppercase tracking-widest text-silver/55">{label}</div>
    </div>
  );
}

function StatsPanel({ query }: { query: ReturnType<typeof useAdminStats> }) {
  const s = query.data;
  return (
    <Panel title="At a glance">
      <QueryState isLoading={query.isLoading} error={query.error} label="Counting the archive…" />
      {s && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <StatCard label="Users" value={s.users} />
          <StatCard label="Admins" value={s.admins} />
          <StatCard label="Characters" value={s.characters} />
          <StatCard label="Public characters" value={s.public_characters} />
          <StatCard label="Companions" value={s.companions} />
          <StatCard label="Active (7d)" value={s.characters_active_7d} />
          <StatCard label="Active (30d)" value={s.characters_active_30d} />
        </div>
      )}
    </Panel>
  );
}

// --- users -----------------------------------------------------------------

function UsersPanel({ query }: { query: ReturnType<typeof useAdminUsers> }) {
  const rows: AdminUserRow[] = query.data ?? [];
  return (
    <Panel title={`Users${rows.length ? ` (${rows.length})` : ''}`} subtitle="Everyone who has signed in.">
      <QueryState isLoading={query.isLoading} error={query.error} label="Gathering members…" />
      {query.data && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[36rem] text-left text-sm">
            <thead className="text-[0.65rem] uppercase tracking-widest text-silver/50">
              <tr className="border-b border-gold/10">
                <th className="py-2 pr-4 font-normal">User</th>
                <th className="py-2 pr-4 font-normal">Discord ID</th>
                <th className="py-2 pr-4 font-normal">Characters</th>
                <th className="py-2 font-normal">Last activity</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => (
                <tr key={u.user_id} className="border-b border-gold/5">
                  <td className="py-2 pr-4 text-parchment">{u.discord_username ?? '(no name)'}</td>
                  <td className="py-2 pr-4 font-mono text-xs text-silver/60">{u.discord_id ?? '—'}</td>
                  <td className="py-2 pr-4 text-silver/80">{u.character_count}</td>
                  <td className="py-2 text-silver/70">{fmtDate(u.last_activity)}</td>
                </tr>
              ))}
              {rows.length === 0 && !query.isLoading && (
                <tr>
                  <td colSpan={4} className="py-6 text-center text-silver/50">
                    No users yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

// --- characters ------------------------------------------------------------

function CharactersPanel({ query }: { query: ReturnType<typeof useAdminCharacters> }) {
  const rows: AdminCharacterRow[] = useMemo(() => query.data ?? [], [query.data]);
  const [filter, setFilter] = useState('');
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.owner_username ?? '').toLowerCase().includes(q) ||
        (c.class_name ?? '').toLowerCase().includes(q) ||
        (c.ancestry_name ?? '').toLowerCase().includes(q),
    );
  }, [rows, filter]);

  return (
    <Panel
      title={`Characters${rows.length ? ` (${rows.length})` : ''}`}
      subtitle="Every character in the vault, newest first."
    >
      <QueryState isLoading={query.isLoading} error={query.error} label="Summoning the roster…" />
      {query.data && (
        <>
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter by name, owner, class, ancestry…"
            className="mb-3 w-full rounded-lg border border-gold/20 bg-midnight-950/50 px-3 py-2 text-sm text-parchment placeholder:text-silver/40 focus:border-gold/50 focus:outline-none"
          />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[44rem] text-left text-sm">
              <thead className="text-[0.65rem] uppercase tracking-widest text-silver/50">
                <tr className="border-b border-gold/10">
                  <th className="py-2 pr-4 font-normal">Character</th>
                  <th className="py-2 pr-4 font-normal">Owner</th>
                  <th className="py-2 pr-4 font-normal">Ancestry / Class</th>
                  <th className="py-2 pr-4 font-normal">Lv</th>
                  <th className="py-2 pr-4 font-normal">Public</th>
                  <th className="py-2 font-normal">Updated</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((c) => (
                  <tr key={c.id} className="border-b border-gold/5">
                    <td className="py-2 pr-4 text-parchment">{c.name}</td>
                    <td className="py-2 pr-4 text-silver/70">{c.owner_username ?? '—'}</td>
                    <td className="py-2 pr-4 text-silver/70">
                      {[c.ancestry_name, c.class_name].filter(Boolean).join(' · ') || '—'}
                    </td>
                    <td className="py-2 pr-4 text-silver/80">{c.level ?? '—'}</td>
                    <td className="py-2 pr-4">
                      {c.is_public ? <span className="text-emerald-300/80">public</span> : <span className="text-silver/40">private</span>}
                    </td>
                    <td className="py-2 text-silver/70">{fmtDate(c.updated_at)}</td>
                  </tr>
                ))}
                {shown.length === 0 && !query.isLoading && (
                  <tr>
                    <td colSpan={6} className="py-6 text-center text-silver/50">
                      {rows.length === 0 ? 'No characters yet.' : 'No matches.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Panel>
  );
}

// --- feedback inbox --------------------------------------------------------

const KIND_STYLES: Record<string, string> = {
  bug: 'border-red-500/30 bg-red-500/10 text-red-300',
  suggestion: 'border-emerald/30 bg-emerald/10 text-emerald-300',
  concern: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  contact: 'border-arcane/30 bg-arcane/10 text-arcane',
  other: 'border-gold/25 bg-gold/10 text-gold',
};

function FeedbackCard({ row }: { row: FeedbackRow }) {
  const update = useUpdateFeedbackStatus();
  const setStatus = (status: FeedbackStatus) => update.mutate({ id: row.id, status });

  return (
    <div
      className={[
        'rounded-lg border p-4',
        row.status === 'new' ? 'border-gold/30 bg-midnight-800/60' : 'border-gold/10 bg-midnight-800/30',
      ].join(' ')}
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className={`rounded border px-2 py-0.5 text-[0.65rem] uppercase tracking-wider ${KIND_STYLES[row.kind] ?? KIND_STYLES.other}`}>
          {row.kind}
        </span>
        {row.status !== 'new' && (
          <span className="rounded border border-silver/20 px-2 py-0.5 text-[0.65rem] uppercase tracking-wider text-silver/50">
            {row.status}
          </span>
        )}
        <span className="text-xs text-silver/50">{fmtDate(row.created_at)}</span>
        <span className="ml-auto text-xs text-silver/60">
          {row.name || 'Anonymous'}
          {row.email && (
            <>
              {' · '}
              <a href={`mailto:${row.email}`} className="text-gold underline underline-offset-2">
                {row.email}
              </a>
            </>
          )}
        </span>
      </div>
      {row.subject && <div className="mb-1 font-display text-parchment">{row.subject}</div>}
      <p className="whitespace-pre-wrap text-sm text-silver/80">{row.message}</p>
      {row.page && <p className="mt-2 text-xs text-silver/40">From: {row.page}</p>}
      <div className="mt-3 flex gap-2">
        {row.status !== 'read' && (
          <button
            type="button"
            onClick={() => setStatus('read')}
            className="rounded border border-gold/20 px-2.5 py-1 text-xs text-silver/70 hover:border-gold/50 hover:text-gold"
          >
            Mark read
          </button>
        )}
        {row.status !== 'resolved' && (
          <button
            type="button"
            onClick={() => setStatus('resolved')}
            className="rounded border border-emerald/20 px-2.5 py-1 text-xs text-emerald-300/80 hover:border-emerald/50"
          >
            Resolve
          </button>
        )}
        {row.status !== 'new' && (
          <button
            type="button"
            onClick={() => setStatus('new')}
            className="rounded border border-silver/15 px-2.5 py-1 text-xs text-silver/50 hover:border-silver/40"
          >
            Reopen
          </button>
        )}
      </div>
    </div>
  );
}

function FeedbackPanel() {
  const query = useFeedbackInbox(true);
  const rows: FeedbackRow[] = useMemo(() => query.data ?? [], [query.data]);
  const [showResolved, setShowResolved] = useState(false);
  const shown = useMemo(
    () => (showResolved ? rows : rows.filter((r) => r.status !== 'resolved')),
    [rows, showResolved],
  );
  const newCount = rows.filter((r) => r.status === 'new').length;

  return (
    <Panel
      title={`Feedback inbox${newCount ? ` (${newCount} new)` : ''}`}
      subtitle="Bug reports, suggestions, concerns, and messages from the Contact page."
    >
      <QueryState isLoading={query.isLoading} error={query.error} label="Opening the mailbag…" />
      {query.data && (
        <>
          <label className="mb-3 flex items-center gap-2 text-xs text-silver/60">
            <input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} />
            Show resolved
          </label>
          <div className="space-y-3">
            {shown.map((r) => (
              <FeedbackCard key={r.id} row={r} />
            ))}
            {shown.length === 0 && (
              <p className="py-6 text-center text-sm text-silver/50">
                {rows.length === 0 ? 'No messages yet.' : 'Nothing open — all caught up.'}
              </p>
            )}
          </div>
        </>
      )}
    </Panel>
  );
}

// --- content gaps ----------------------------------------------------------

/**
 * Test whether a feat/heritage name resolves to a definition in the app's
 * dataset — the same lookup the character sheet uses (exact name, then
 * suffix-stripped base with class/ancestry/heritage disambiguation). Lets the
 * owner check any name that showed "no reference entry" and confirm whether it's
 * a true content gap or just a naming mismatch.
 */
function ContentGapsPanel() {
  const [index, setIndex] = useState<FallbackIndex | null>(null);
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState('');
  const [hint, setHint] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      setIndex(await loadFallbackIndex());
    } finally {
      setLoading(false);
    }
  };

  const result = useMemo(() => {
    if (!index || !name.trim()) return null;
    const hints = hint.split(',').map((h) => h.trim()).filter(Boolean);
    return resolveFallbackRow(index, name, hints);
  }, [index, name, hint]);

  return (
    <Panel
      title="Content gap check"
      subtitle="Test a feat or heritage name against the dataset the sheet falls back to."
    >
      {!index && (
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="rounded-md border border-gold/30 bg-gold/10 px-4 py-2 text-sm text-gold transition-colors hover:border-gold/60 disabled:opacity-50"
        >
          {loading ? 'Loading dataset…' : 'Load dataset to check'}
        </button>
      )}
      {index && (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-silver/70">Feat / heritage name</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Blessed Blood"
                className="rounded-lg border border-gold/20 bg-midnight-950/50 px-3 py-2 text-parchment placeholder:text-silver/40 focus:border-gold/50 focus:outline-none"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-silver/70">Disambiguation hints (class, ancestry…)</span>
              <input
                value={hint}
                onChange={(e) => setHint(e.target.value)}
                placeholder="e.g. Sorcerer"
                className="rounded-lg border border-gold/20 bg-midnight-950/50 px-3 py-2 text-parchment placeholder:text-silver/40 focus:border-gold/50 focus:outline-none"
              />
            </label>
          </div>
          {name.trim() && (
            <div className="rounded-lg border border-gold/10 bg-midnight-800/40 p-3 text-sm">
              {result ? (
                <>
                  <div className="text-emerald-300/90">
                    ✓ Resolves to <span className="font-display text-parchment">{result.name}</span>
                  </div>
                  {result.description && (
                    <p className="mt-1 line-clamp-3 text-silver/70">{result.description}</p>
                  )}
                </>
              ) : (
                <div className="text-red-300/90">
                  ✗ No match in the dataset — a genuine gap. Paste the definition and it can be authored in.
                </div>
              )}
            </div>
          )}
          <p className="text-xs text-silver/50">
            Indexed names: {index.byName.size}. This is exactly what the sheet uses when the
            reference table has no row.
          </p>
        </div>
      )}
    </Panel>
  );
}
