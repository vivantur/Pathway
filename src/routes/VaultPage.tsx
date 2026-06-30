import { GildedRule } from '@/components/ui/GildedRule';
import { Spinner } from '@/components/ui/Spinner';
import { useAuth } from '@/features/auth/useAuth';
import { useMyCharacters } from '@/features/characters/useCharacters';
import type { CharacterSummary } from '@/features/characters/types';

/**
 * The Character Vault — Phase W0's proof of life. It reads the signed-in user's
 * own `characters` rows through RLS (anon key + session, no service key) and
 * renders them. This satisfies the W0 gate: "the web app authenticates a user
 * and reads one of their own characters rows through RLS."
 */
export function VaultPage() {
  const { user } = useAuth();
  const { data, isLoading, isError, error } = useMyCharacters();

  return (
    <div>
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl text-gold">Character Vault</h1>
          <p className="mt-1 text-sm text-silver/60">
            Signed in as <span className="text-silver/90">{user?.email ?? user?.id}</span>
          </p>
        </div>
      </header>

      <GildedRule className="my-6" />

      {isLoading && (
        <div className="py-10">
          <Spinner label="Drawing characters from the vault…" />
        </div>
      )}

      {isError && (
        <p className="rounded-md border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
          Couldn&apos;t load your characters: {error instanceof Error ? error.message : 'unknown error'}
        </p>
      )}

      {!isLoading && !isError && data && data.length === 0 && (
        <div className="rounded-lg border border-gold/15 bg-midnight-700/40 p-8 text-center">
          <p className="text-silver/80">No characters yet.</p>
          <p className="mt-1 text-sm text-silver/50">
            Characters created in the Pathway Discord bot will appear here once your
            accounts are linked.
          </p>
        </div>
      )}

      {!isLoading && !isError && data && data.length > 0 && (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.map((c) => (
            <CharacterCard key={c.id} character={c} />
          ))}
        </ul>
      )}
    </div>
  );
}

function CharacterCard({ character }: { character: CharacterSummary }) {
  return (
    <li className="rounded-lg border border-gold/15 bg-midnight-700/40 p-5 transition-colors hover:border-gold/40">
      <h2 className="font-display text-lg text-gold">{character.name}</h2>
      <p className="text-xs uppercase tracking-wide text-silver/40">{character.char_key}</p>
      <dl className="mt-4 grid grid-cols-3 gap-2 text-center text-sm">
        <Stat label="HP" value={character.current_hp} />
        <Stat label="Hero" value={character.hero_points} />
        <Stat label="XP" value={character.experience} />
      </dl>
      {character.source && (
        <p className="mt-4 text-xs text-silver/40">via {character.source}</p>
      )}
    </li>
  );
}

function Stat({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="rounded-md bg-midnight-900/60 py-2">
      <div className="font-display text-arcane">{value ?? '—'}</div>
      <div className="text-[0.65rem] uppercase tracking-wide text-silver/40">{label}</div>
    </div>
  );
}
