import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { GildedRule } from '@/components/ui/GildedRule';
import { errorMessage } from '@/features/characters/errorMessage';
import {
  createCharacterFromBuild,
  findCharacterByPathbuilderId,
  updateCharacterFromBuild,
  type CreateCharacterResult,
  type ExistingCharacterMatch,
} from '@/features/characters/api';
import {
  fetchPathbuilderBuild,
  parsePathbuilderId,
} from '@/features/characters/pathbuilderImport';
import type { PathbuilderBuild } from '@/features/characters/pathbuilder';
import { useAuth } from '@/features/auth/useAuth';
import { useQueryClient } from '@tanstack/react-query';

type Stage =
  | { kind: 'ready' }
  | { kind: 'fetching' }
  | {
      kind: 'confirm-existing';
      pathbuilderId: number;
      build: PathbuilderBuild;
      existing: ExistingCharacterMatch;
    }
  | { kind: 'importing' }
  | { kind: 'error'; message: string };

/**
 * Route: /vault/new — import a character by Pathbuilder JSON id.
 *
 * Flow:
 *   1. User pastes the id (or full URL). Parse it.
 *   2. Fetch the build from Pathbuilder.
 *   3. Look up whether the user already imported this exact pathbuilder_id.
 *      - No: insert straight away.
 *      - Yes: pause and ask "Update existing or Import as copy?"
 *   4. On success, redirect to the character sheet.
 *
 * Update path preserves all live state (HP/hero/XP/currency/overlay/art/
 * notes). Copy path forces a fresh char_key (`name` / `name-2` / ...).
 */
export function AddCharacterPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [raw, setRaw] = useState('');
  const [stage, setStage] = useState<Stage>({ kind: 'ready' });

  const finish = (result: CreateCharacterResult) => {
    qc.invalidateQueries({ queryKey: ['characters'] });
    qc.invalidateQueries({ queryKey: ['character'] });
    navigate(`/vault/${encodeURIComponent(result.char_key)}`);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!user) {
      setStage({ kind: 'error', message: 'You need to be signed in.' });
      return;
    }

    const id = parsePathbuilderId(raw);
    if (id == null) {
      setStage({
        kind: 'error',
        message:
          "Couldn't find a Pathbuilder id in that. Paste either the number (e.g. 123456) or the full URL.",
      });
      return;
    }

    setStage({ kind: 'fetching' });

    let build: PathbuilderBuild;
    try {
      build = await fetchPathbuilderBuild(id);
    } catch (err) {
      setStage({ kind: 'error', message: errorMessage(err) });
      return;
    }

    let existing: ExistingCharacterMatch | null;
    try {
      existing = await findCharacterByPathbuilderId(user.id, id);
    } catch (err) {
      setStage({ kind: 'error', message: errorMessage(err) });
      return;
    }

    if (existing) {
      setStage({
        kind: 'confirm-existing',
        pathbuilderId: id,
        build,
        existing,
      });
      return;
    }

    // Fresh import — insert.
    setStage({ kind: 'importing' });
    try {
      const result = await createCharacterFromBuild({
        userId: user.id,
        build,
        pathbuilderId: id,
      });
      finish(result);
    } catch (err) {
      setStage({ kind: 'error', message: errorMessage(err) });
    }
  };

  const handleUpdateExisting = async () => {
    if (stage.kind !== 'confirm-existing' || !user) return;
    setStage({ kind: 'importing' });
    try {
      const result = await updateCharacterFromBuild({
        userId: user.id,
        charKey: stage.existing.char_key,
        build: stage.build,
        pathbuilderId: stage.pathbuilderId,
      });
      finish(result);
    } catch (err) {
      setStage({ kind: 'error', message: errorMessage(err) });
    }
  };

  const handleImportAsCopy = async () => {
    if (stage.kind !== 'confirm-existing' || !user) return;
    setStage({ kind: 'importing' });
    try {
      const result = await createCharacterFromBuild({
        userId: user.id,
        build: stage.build,
        pathbuilderId: stage.pathbuilderId,
      });
      finish(result);
    } catch (err) {
      setStage({ kind: 'error', message: errorMessage(err) });
    }
  };

  const isBusy = stage.kind === 'fetching' || stage.kind === 'importing';

  return (
    <div className="mx-auto max-w-2xl">
      <Link
        to="/vault"
        className="mb-4 inline-block text-sm text-silver/60 transition-colors hover:text-gold"
      >
        ← Character Vault
      </Link>

      <div className="relative overflow-hidden rounded-lg border border-gold/30 bg-midnight-900/70 p-6 shadow-gilded">
        <CornerBrackets />
        <h1 className="font-display text-3xl text-gold">Add a Character</h1>
        <p className="mt-1 text-sm text-silver/70">
          Import a character from{' '}
          <a
            href="https://pathbuilder2e.com"
            target="_blank"
            rel="noopener noreferrer"
            className="text-arcane underline decoration-arcane/40 underline-offset-2 hover:decoration-arcane/80"
          >
            Pathbuilder 2e
          </a>{' '}
          by pasting the JSON export id below.
        </p>

        <GildedRule className="my-5" />

        {stage.kind === 'confirm-existing' ? (
          <ConfirmExistingPanel
            existing={stage.existing}
            newName={stage.build.name}
            onUpdate={handleUpdateExisting}
            onImportCopy={handleImportAsCopy}
            onCancel={() => setStage({ kind: 'ready' })}
          />
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="pb-id"
                className="mb-1 block text-[0.65rem] uppercase tracking-widest text-gold/80"
              >
                Pathbuilder ID or Export URL
              </label>
              <input
                id="pb-id"
                type="text"
                autoFocus
                autoComplete="off"
                value={raw}
                onChange={(e) => setRaw(e.target.value)}
                placeholder="e.g. 123456   or   https://pathbuilder2e.com/json.php?id=123456"
                disabled={isBusy}
                className="w-full rounded-md border border-gold/25 bg-midnight-800/80 px-3 py-2 font-serif text-silver placeholder:text-silver/30 focus:border-gold/60 focus:outline-none focus:ring-1 focus:ring-gold/40 disabled:opacity-50"
              />
            </div>

            {stage.kind === 'error' && (
              <div className="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
                <span className="font-display text-[0.65rem] uppercase tracking-widest text-red-300">
                  Couldn&apos;t import:
                </span>{' '}
                {stage.message}
              </div>
            )}

            <div className="flex items-center justify-between gap-3">
              <button
                type="submit"
                disabled={isBusy || raw.trim().length === 0}
                className="inline-flex items-center gap-2 rounded-md border border-gold/40 bg-gold/10 px-4 py-2 text-sm font-display uppercase tracking-widest text-gold transition-colors hover:border-gold/70 hover:bg-gold/20 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isBusy && (
                  <span
                    aria-hidden
                    className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-gold/30 border-t-gold"
                  />
                )}
                {stage.kind === 'fetching'
                  ? 'Fetching from Pathbuilder…'
                  : stage.kind === 'importing'
                    ? 'Importing…'
                    : 'Import'}
              </button>
              <Link
                to="/vault"
                className="text-xs uppercase tracking-widest text-silver/60 hover:text-gold"
              >
                Cancel
              </Link>
            </div>
          </form>
        )}

        <GildedRule className="my-5" />

        <details className="text-sm text-silver/75">
          <summary className="cursor-pointer text-[0.65rem] uppercase tracking-widest text-gold/70 hover:text-gold">
            How do I find my Pathbuilder ID?
          </summary>
          <ol className="mt-3 space-y-2 pl-4 text-sm leading-relaxed">
            <li>
              <span className="text-gold/70">1.</span> Open your character on{' '}
              <a
                href="https://pathbuilder2e.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-arcane hover:text-arcane-soft"
              >
                Pathbuilder 2e
              </a>
              .
            </li>
            <li>
              <span className="text-gold/70">2.</span> Click{' '}
              <span className="text-gold/90">Menu</span> (top-right) →{' '}
              <span className="text-gold/90">Export JSON</span>.
            </li>
            <li>
              <span className="text-gold/70">3.</span> Pathbuilder will show a
              short numeric ID (usually 6–7 digits) — that&apos;s what you paste
              above. Or paste the whole export URL if it&apos;s easier.
            </li>
            <li>
              <span className="text-gold/70">4.</span> The export expires after
              a while, so import promptly. If you get an &quot;expired&quot;
              error, re-export from Pathbuilder and try again.
            </li>
          </ol>
        </details>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------
// Confirm existing character panel
// ---------------------------------------------------------------

function ConfirmExistingPanel({
  existing,
  newName,
  onUpdate,
  onImportCopy,
  onCancel,
}: {
  existing: ExistingCharacterMatch;
  newName: string | undefined;
  onUpdate: () => void;
  onImportCopy: () => void;
  onCancel: () => void;
}) {
  const nameChanged = newName && newName.trim() !== existing.name.trim();

  return (
    <div className="space-y-4 rounded-md border border-arcane/40 bg-arcane/5 p-4">
      <div>
        <div className="mb-1 font-display text-sm uppercase tracking-widest text-arcane">
          Already in your vault
        </div>
        <p className="text-sm leading-relaxed text-silver/85">
          You&apos;ve already imported this Pathbuilder character as{' '}
          <span className="text-gold">{existing.name}</span>
          {nameChanged && (
            <>
              {' '}
              (Pathbuilder now calls them{' '}
              <span className="text-gold">{newName}</span>)
            </>
          )}
          . What would you like to do?
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <ChoiceButton
          title={`Update ${existing.name}`}
          subtitle="Refreshes the build (feats, spells, abilities) while keeping HP, XP, hero points, notes, portrait, and bot state."
          onClick={onUpdate}
          primary
        />
        <ChoiceButton
          title="Import as a copy"
          subtitle={`Creates a brand-new character with a fresh slug. Live state resets to defaults. Useful when you're forking off an alt.`}
          onClick={onImportCopy}
        />
      </div>

      <div className="text-center">
        <button
          type="button"
          onClick={onCancel}
          className="text-xs uppercase tracking-widest text-silver/60 hover:text-gold"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function ChoiceButton({
  title,
  subtitle,
  onClick,
  primary,
}: {
  title: string;
  subtitle: string;
  onClick: () => void;
  primary?: boolean;
}) {
  const cls = primary
    ? 'border-gold/60 bg-gold/10 hover:border-gold hover:bg-gold/20'
    : 'border-gold/25 bg-midnight-900/40 hover:border-gold/50 hover:bg-midnight-900/70';
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md border p-3 text-left transition-all hover:-translate-y-0.5 ${cls}`}
    >
      <div className="font-display text-sm uppercase tracking-widest text-gold">
        {title}
      </div>
      <p className="mt-1 text-xs leading-relaxed text-silver/70">{subtitle}</p>
    </button>
  );
}

function CornerBrackets() {
  const cls = 'pointer-events-none absolute h-4 w-4 border-gold/60';
  return (
    <>
      <span className={`${cls} left-1.5 top-1.5 border-l border-t`} aria-hidden />
      <span className={`${cls} right-1.5 top-1.5 border-r border-t`} aria-hidden />
      <span className={`${cls} bottom-1.5 left-1.5 border-b border-l`} aria-hidden />
      <span className={`${cls} bottom-1.5 right-1.5 border-b border-r`} aria-hidden />
    </>
  );
}
