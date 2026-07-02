import { Link, useParams } from 'react-router-dom';
import { Spinner } from '@/components/ui/Spinner';
import { errorMessage } from '@/features/characters/errorMessage';
import { usePublicCharacter } from '@/features/characters/usePublicCharacter';
import { Sheet } from '@/features/characters/sheet/Sheet';
import type { PathbuilderBuild } from '@/features/characters/pathbuilder';
import type { PathbuilderData } from '@/features/characters/types';

/**
 * Route: /share/:shareId — public read-only view of a shared character.
 *
 * No RequireAuth wrapper: anyone with the URL can view (as long as the owner
 * has sharing turned on). The Sheet receives `readOnly` which:
 *   - hides SheetActions (Update/Share/Delete)
 *   - hides the Portrait upload camera + file input
 *   - drops the Journal tab from the bottom nav (private notes + XP log)
 *
 * RLS on `characters` must include a policy allowing `is_public = true`
 * anon reads — see the SQL in the accompanying chat message.
 */
export function PublicSharePage() {
  const { shareId } = useParams<{ shareId: string }>();
  const { data, isLoading, isError, error } = usePublicCharacter(shareId);

  if (isLoading) {
    return (
      <div className="flex justify-center py-20">
        <Spinner label="Retrieving shared character…" />
      </div>
    );
  }

  if (isError) {
    return (
      <InfoPanel tone="danger">
        Couldn&apos;t load this shared character:{' '}
        <code className="text-red-300">{errorMessage(error)}</code>
      </InfoPanel>
    );
  }

  if (!data) {
    return <NotShared />;
  }

  const build = unwrapBuild(data.pathbuilder_data);
  if (!build) {
    return (
      <InfoPanel>
        This character has no build data. Ask the owner to re-export from
        Pathbuilder.
      </InfoPanel>
    );
  }

  return (
    <div className="space-y-4">
      <PublicBanner name={data.name} />
      <Sheet character={data} build={build} readOnly />
    </div>
  );
}

// ---------------------------------------------------------------
// UI pieces
// ---------------------------------------------------------------

function PublicBanner({ name }: { name: string }) {
  return (
    <div className="rounded-lg border border-arcane/40 bg-arcane/10 px-4 py-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <span className="font-display text-[0.65rem] uppercase tracking-widest text-arcane">
            Shared character
          </span>{' '}
          <span className="text-silver/85">
            You&apos;re viewing{' '}
            <span className="font-display text-arcane">{name}</span> as a public
            share. Editing, uploads, and the character journal are hidden.
          </span>
        </div>
        <Link
          to="/"
          className="whitespace-nowrap text-[0.65rem] uppercase tracking-widest text-silver/60 hover:text-gold"
        >
          What is Pathway? →
        </Link>
      </div>
    </div>
  );
}

function NotShared() {
  return (
    <div className="mx-auto max-w-md py-20 text-center">
      <p className="font-display text-6xl text-gold/80">?</p>
      <h1 className="mt-4 font-display text-xl text-silver">
        This share isn&apos;t available
      </h1>
      <p className="mt-2 text-sm text-silver/60">
        The link may have expired, the owner turned sharing off, or the URL is
        wrong.
      </p>
      <Link
        to="/"
        className="mt-6 inline-block rounded-md border border-gold/30 px-4 py-2 text-gold transition-colors hover:border-gold/60"
      >
        Return to Pathway
      </Link>
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

/** Pathbuilder JSON may or may not wrap the build under `.build`. */
function unwrapBuild(pd: PathbuilderData | null): PathbuilderBuild | null {
  if (!pd || typeof pd !== 'object') return null;
  const asObj = pd as Record<string, unknown>;
  if (asObj.build && typeof asObj.build === 'object') {
    return asObj.build as PathbuilderBuild;
  }
  return asObj as PathbuilderBuild;
}
