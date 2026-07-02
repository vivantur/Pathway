import { Link, useParams } from 'react-router-dom';
import { Spinner } from '@/components/ui/Spinner';
import { useCharacter } from '@/features/characters/useCharacter';
import { isSchemaNotReady } from '@/features/characters/errors';
import type { PathbuilderData } from '@/features/characters/types';
import type { PathbuilderBuild } from '@/features/characters/pathbuilder';
import { Sheet } from '@/features/characters/sheet/Sheet';

/**
 * Character sheet route: `/vault/:charKey`.
 *
 * This shell handles routing / auth / load state; the actual grimoire sheet
 * layout lives in `<Sheet />`. Kept small so the sheet gets to own the whole
 * viewport — this component only handles the "before we can show it" branches.
 */
export function CharacterPage() {
  const { charKey: rawCharKey } = useParams<{ charKey: string }>();
  // React Router already decodes params in practice, but we belt-and-suspender
  // here so a stray `%2F` (from hand-typed URLs or an older bookmark) still
  // resolves cleanly. decodeURIComponent on already-decoded input is a no-op.
  const charKey = rawCharKey ? safeDecode(rawCharKey) : undefined;
  const { data, isLoading, isError, error } = useCharacter(charKey);

  if (isLoading) {
    return (
      <div className="flex justify-center py-20">
        <Spinner label="Retrieving character…" />
      </div>
    );
  }

  if (isError && isSchemaNotReady(error)) {
    return <InfoPanel>Your database isn&apos;t set up yet.</InfoPanel>;
  }

  if (isError) {
    return (
      <InfoPanel tone="danger">
        Couldn&apos;t load this character:{' '}
        {error instanceof Error ? error.message : 'unknown error'}
      </InfoPanel>
    );
  }

  if (!data) return <NotFoundPanel charKey={charKey ?? ''} />;

  const build = unwrapBuild(data.pathbuilder_data);
  if (!build) {
    return (
      <InfoPanel>
        This character has no build data yet. Import from Pathbuilder to fill in the sheet.
      </InfoPanel>
    );
  }

  const editBase = `/vault/${rawCharKey}/edit`;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          to="/vault"
          className="inline-block text-sm text-silver/60 transition-colors hover:text-gold"
        >
          ← Character Vault
        </Link>
        <div className="flex gap-2">
          <Link
            to={editBase}
            className="rounded-md border border-gold/25 px-3 py-1.5 text-xs font-display uppercase tracking-widest text-silver/80 transition-colors hover:border-gold/50 hover:text-gold"
          >
            Edit in Builder
          </Link>
          <Link
            to={`${editBase}?levelup=1`}
            className="rounded-md border border-gold/40 bg-gold/10 px-3 py-1.5 text-xs font-display uppercase tracking-widest text-gold transition-colors hover:bg-gold/20"
          >
            Level Up
          </Link>
        </div>
      </div>
      <Sheet character={data} build={build} />
    </div>
  );
}

function InfoPanel({
  children,
  tone = 'info',
}: {
  children: React.ReactNode;
  tone?: 'info' | 'danger';
}) {
  const cls =
    tone === 'danger'
      ? 'border-red-500/30 bg-red-500/10 text-red-300'
      : 'border-arcane/25 bg-arcane/5 text-silver/80';
  return <div className={`rounded-lg border p-6 text-center ${cls}`}>{children}</div>;
}

function NotFoundPanel({ charKey }: { charKey: string }) {
  return (
    <div className="mx-auto max-w-md py-20 text-center">
      <p className="font-display text-6xl text-gold/80">?</p>
      <h1 className="mt-4 font-display text-xl text-silver">Character not found</h1>
      <p className="mt-2 text-sm text-silver/60">
        No character in your vault matches <code className="text-arcane">{charKey}</code>.
      </p>
      <Link
        to="/vault"
        className="mt-6 inline-block rounded-md border border-gold/30 px-4 py-2 text-gold transition-colors hover:border-gold/60"
      >
        Back to the vault
      </Link>
    </div>
  );
}

/**
 * Best-effort URL decode. If the input was already decoded (React Router's
 * usual behavior), decodeURIComponent is a no-op. If it fails (malformed
 * `%XX` sequence), fall back to the raw string rather than throwing.
 */
function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** Pathbuilder JSON may or may not wrap the build under `.build`. */
function unwrapBuild(pd: PathbuilderData | null): PathbuilderBuild | null {
  if (!pd || typeof pd !== 'object') return null;
  const asObj = pd as Record<string, unknown>;
  if (asObj.build && typeof asObj.build === 'object') {
    return asObj.build as PathbuilderBuild;
  }
  return asObj as PathbuilderBuild;
}
