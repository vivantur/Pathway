import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { GildedRule } from '@/components/ui/GildedRule';
import { errorMessage } from '@/features/characters/errorMessage';
import { parsePathbuilderId } from '@/features/characters/pathbuilderImport';
import { useImportPathbuilder } from '@/features/characters/useImportPathbuilder';

/**
 * Route: /vault/new — import a character by Pathbuilder JSON id.
 *
 * The user pastes either the numeric id or the whole
 * `https://pathbuilder2e.com/json.php?id=…` URL; we parse it, fetch the
 * build from Pathbuilder's public JSON endpoint, insert a new row into
 * `characters` scoped to their user_id, and redirect to the new sheet.
 */
export function AddCharacterPage() {
  const navigate = useNavigate();
  const [raw, setRaw] = useState('');
  const [parseError, setParseError] = useState<string | null>(null);
  const importMutation = useImportPathbuilder();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setParseError(null);

    const id = parsePathbuilderId(raw);
    if (id == null) {
      setParseError(
        "Couldn't find a Pathbuilder id in that. Paste either the number (e.g. 123456) or the full URL.",
      );
      return;
    }

    try {
      const result = await importMutation.mutateAsync(id);
      // Land on the freshly-imported character's sheet.
      navigate(`/vault/${encodeURIComponent(result.char_key)}`);
    } catch {
      // Error is surfaced from the mutation state below — nothing to do here.
    }
  };

  const isPending = importMutation.isPending;
  const errorText = importMutation.error
    ? errorMessage(importMutation.error)
    : parseError;

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
              disabled={isPending}
              className="w-full rounded-md border border-gold/25 bg-midnight-800/80 px-3 py-2 font-serif text-silver placeholder:text-silver/30 focus:border-gold/60 focus:outline-none focus:ring-1 focus:ring-gold/40 disabled:opacity-50"
            />
          </div>

          {errorText && (
            <div className="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
              <span className="font-display text-[0.65rem] uppercase tracking-widest text-red-300">
                Couldn&apos;t import:
              </span>{' '}
              {errorText}
            </div>
          )}

          <div className="flex items-center justify-between gap-3">
            <button
              type="submit"
              disabled={isPending || raw.trim().length === 0}
              className="inline-flex items-center gap-2 rounded-md border border-gold/40 bg-gold/10 px-4 py-2 text-sm font-display uppercase tracking-widest text-gold transition-colors hover:border-gold/70 hover:bg-gold/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isPending && (
                <span
                  aria-hidden
                  className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-gold/30 border-t-gold"
                />
              )}
              {isPending ? 'Importing…' : 'Import'}
            </button>
            <Link
              to="/vault"
              className="text-xs uppercase tracking-widest text-silver/60 hover:text-gold"
            >
              Cancel
            </Link>
          </div>
        </form>

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
