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
  const { charKey } = useParams<{ charKey: string }>();
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

  return (
    <div className="space-y-4">
      <Link
        to="/vault"
        className="inline-block text-sm text-silver/60 transition-colors hover:text-gold"
      >
        ← Character Vault
      </Link>
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

/** Pathbuilder JSON may or may not wrap the build under `.build`. */
function unwrapBuild(pd: PathbuilderData | null): PathbuilderBuild | null {
  if (!pd || typeof pd !== 'object') return null;
  const asObj = pd as Record<string, unknown>;
  if (asObj.build && typeof asObj.build === 'object') {
    return asObj.build as PathbuilderBuild;
  }
  return asObj as PathbuilderBuild;
}
