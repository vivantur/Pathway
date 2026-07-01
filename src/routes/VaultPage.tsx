import { Link } from 'react-router-dom';
import { useState, type ReactNode } from 'react';
import { Spinner } from '@/components/ui/Spinner';
import { useAuth } from '@/features/auth/useAuth';
import { useRelink } from '@/features/auth/useRelink';
import { useMyCharacters } from '@/features/characters/useCharacters';
import { isSchemaNotReady } from '@/features/characters/errors';
import type { CharacterSummary } from '@/features/characters/types';

// The signed-in user is read inside <VaultHeader />, not here — the top-level
// component only needs the character list. Kept as a note so future edits
// don't add a top-level useAuth() call that never gets used.

/**
 * The Character Vault — a Discord-profile-inspired gallery of the signed-in
 * user's characters. Header pulls Discord metadata from Supabase auth
 * (avatar, display name, username, discord id). Grid renders each character
 * as a portrait-oriented tile using `characters.art` when available and a
 * gilded initials placeholder otherwise.
 */
export function VaultPage() {
  const { data, isLoading, isError, error } = useMyCharacters();

  const characters = data ?? [];
  const withArt = characters.filter((c) => c.art);
  const withoutArt = characters.filter((c) => !c.art);

  return (
    <div className="space-y-8">
      <VaultHeader characterCount={characters.length} portraitCount={withArt.length} />
      <RelinkBanner />

      {isLoading && (
        <div className="py-10">
          <Spinner label="Drawing characters from the vault…" />
        </div>
      )}

      {isError && isSchemaNotReady(error) && (
        <div className="rounded-lg border border-arcane/25 bg-arcane/5 p-8 text-center">
          <p className="font-display text-arcane">Your database isn&apos;t set up yet</p>
          <p className="mx-auto mt-2 max-w-md text-sm text-silver/70">
            Pathway is connected to your Supabase project, but the character
            tables haven&apos;t been created yet. Once the schema is migrated in,
            your characters will appear here automatically.
          </p>
        </div>
      )}

      {isError && !isSchemaNotReady(error) && (
        <p className="rounded-md border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
          Couldn&apos;t load your characters:{' '}
          {error instanceof Error ? error.message : 'unknown error'}
        </p>
      )}

      {!isLoading && !isError && characters.length === 0 && (
        <div className="rounded-lg border border-gold/15 bg-midnight-700/40 p-10 text-center">
          <p className="font-display text-lg text-gold">Your vault is empty.</p>
          <p className="mx-auto mt-2 max-w-md text-sm text-silver/70">
            Import a character from Pathbuilder 2e to start building your collection.
            Characters created in the Pathway Discord bot will also appear here.
          </p>
          <Link
            to="/vault/new"
            className="mt-6 inline-flex items-center gap-2 rounded-md border border-gold/40 bg-gold/10 px-5 py-2.5 font-display text-sm uppercase tracking-widest text-gold transition-all hover:-translate-y-0.5 hover:border-gold/70 hover:bg-gold/20 hover:shadow-gilded"
          >
            <span aria-hidden className="text-lg leading-none">+</span>
            Import from Pathbuilder
          </Link>
        </div>
      )}

      {!isLoading && !isError && characters.length > 0 && (
        <>
          {withArt.length > 0 && (
            <section>
              <SectionHeading label="Portraits" count={withArt.length} />
              <CharacterGrid characters={withArt} showArt />
            </section>
          )}
          {withoutArt.length > 0 && (
            <section>
              <SectionHeading
                label="Awaiting portraits"
                count={withoutArt.length}
                subtitle="Open a character sheet and tap the camera to add art."
              />
              <CharacterGrid characters={withoutArt} showArt={false} />
            </section>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------
// Relink feedback — shown once when the session claims bot characters
// ---------------------------------------------------------------

function RelinkBanner() {
  const { data } = useRelink();
  const [dismissed, setDismissed] = useState(false);

  if (dismissed || !data) return null;

  // Only surface the two outcomes worth telling the user about. 'already_linked'
  // and 'no_discord_id' are silent (normal state / non-Discord login).
  if (data.status === 'linked') {
    const n = data.characters ?? 0;
    return (
      <Banner
        tone="success"
        onDismiss={() => setDismissed(true)}
      >
        Welcome! We linked your Discord account and found{' '}
        <span className="font-display text-emerald-soft">{n}</span>{' '}
        {n === 1 ? 'character' : 'characters'} from the Pathway bot.
      </Banner>
    );
  }

  if (data.status === 'conflict') {
    return (
      <Banner tone="danger" onDismiss={() => setDismissed(true)}>
        We couldn&apos;t link your Discord account automatically — it looks
        already mapped to a different profile. Reach out to an admin so we can
        sort it out.
      </Banner>
    );
  }

  return null;
}

function Banner({
  tone,
  children,
  onDismiss,
}: {
  tone: 'success' | 'danger';
  children: ReactNode;
  onDismiss: () => void;
}) {
  const cls =
    tone === 'success'
      ? 'border-emerald/40 bg-emerald/10 text-silver/90'
      : 'border-red-500/40 bg-red-500/10 text-red-200';
  return (
    <div className={`flex items-start justify-between gap-3 rounded-lg border p-4 text-sm ${cls}`}>
      <div>{children}</div>
      <button
        type="button"
        onClick={onDismiss}
        className="shrink-0 text-silver/50 hover:text-gold"
        aria-label="Dismiss"
      >
        ✕
      </button>
    </div>
  );
}

// ---------------------------------------------------------------
// Header — Discord-style profile card, grimoire palette
// ---------------------------------------------------------------

function VaultHeader({
  characterCount,
  portraitCount,
}: {
  characterCount: number;
  portraitCount: number;
}) {
  const { user } = useAuth();
  const meta = (user?.user_metadata ?? {}) as Record<string, unknown>;

  const displayName = pickString(meta, 'full_name', 'name', 'user_name', 'preferred_username') ??
    (user?.email ? user.email.split('@')[0] : 'Traveler');
  const username = pickString(meta, 'preferred_username', 'user_name');
  const avatarUrl = pickString(meta, 'avatar_url', 'picture');
  const providerId = pickString(meta, 'provider_id', 'sub');

  return (
    <header className="relative overflow-hidden rounded-lg border border-gold/30 bg-midnight-900/70 p-6 shadow-gilded">
      {/* Decorative gilded corner brackets */}
      <CornerBrackets />
      <div className="relative flex flex-wrap items-start gap-6">
        <Avatar url={avatarUrl} name={displayName} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0">
            <h1 className="font-display text-3xl tracking-wide text-gold sm:text-4xl">
              {displayName}
            </h1>
            <span className="text-sm text-silver/40">#0</span>
          </div>
          {username && (
            <p className="mt-0.5 text-sm text-silver/60">@{username}</p>
          )}
          <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm">
            <ProfileStat label="Characters" value={characterCount} />
            <ProfileStat label="Portraits" value={portraitCount} />
            {providerId && <ProfileStat label="Discord ID" value={providerId} mono />}
          </dl>
        </div>
        <Link
          to="/vault/new"
          className="inline-flex shrink-0 items-center gap-2 rounded-md border border-gold/40 bg-gold/10 px-4 py-2 text-sm font-display uppercase tracking-widest text-gold transition-all hover:-translate-y-0.5 hover:border-gold/70 hover:bg-gold/20 hover:shadow-gilded"
        >
          <span aria-hidden className="text-lg leading-none">+</span>
          Add Character
        </Link>
      </div>
    </header>
  );
}

function Avatar({ url, name }: { url: string | null; name: string }) {
  const initials = getInitials(name);
  return (
    <div className="relative shrink-0">
      <div className="h-28 w-28 overflow-hidden rounded-full border-2 border-gold/50 bg-gradient-to-br from-midnight-700 to-midnight-950 shadow-gilded sm:h-32 sm:w-32">
        {url ? (
          <img
            src={url}
            alt={name}
            className="h-full w-full object-cover"
            referrerPolicy="no-referrer"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = 'none';
            }}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center font-display text-3xl text-gold/70">
            {initials}
          </div>
        )}
      </div>
    </div>
  );
}

function ProfileStat({
  label,
  value,
  mono,
}: {
  label: string;
  value: ReactNode;
  mono?: boolean;
}) {
  return (
    <div>
      <dt className="text-[0.65rem] uppercase tracking-widest text-silver/50">{label}</dt>
      <dd className={`font-display text-lg text-gold ${mono ? 'font-mono text-sm tabular-nums' : ''}`}>
        {value}
      </dd>
    </div>
  );
}

// ---------------------------------------------------------------
// Grid + tile
// ---------------------------------------------------------------

function SectionHeading({
  label,
  count,
  subtitle,
}: {
  label: string;
  count: number;
  subtitle?: string;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2 border-b border-gold/15 pb-2">
      <h2 className="font-display text-xl text-gold">
        {label} <span className="ml-1 text-sm text-silver/50">({count})</span>
      </h2>
      {subtitle && <p className="text-xs text-silver/50">{subtitle}</p>}
    </div>
  );
}

function CharacterGrid({
  characters,
  showArt,
}: {
  characters: CharacterSummary[];
  showArt: boolean;
}) {
  return (
    <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
      {characters.map((c) => (
        <CharacterTile key={c.id} character={c} showArt={showArt} />
      ))}
    </ul>
  );
}

function CharacterTile({
  character,
  showArt,
}: {
  character: CharacterSummary;
  showArt: boolean;
}) {
  const subtitle = [character.ancestry_name, character.class_name]
    .filter(Boolean)
    .join(' · ');
  return (
    <li>
      <Link
        // encodeURIComponent so char_keys containing "/", "#", "?", etc. (e.g.
        // "Seika/Sekhmet") produce a single URL-safe segment instead of
        // getting parsed as two path parts and landing on 404.
        to={`/vault/${encodeURIComponent(character.char_key)}`}
        className="group relative block aspect-[3/4] overflow-hidden rounded-lg border border-gold/25 bg-midnight-900 shadow-gilded transition-all hover:-translate-y-0.5 hover:border-gold/70 hover:shadow-arcane"
      >
        {/* Art fills the whole tile; missing art falls back to initials */}
        {showArt && character.art ? (
          <img
            src={character.art}
            alt={character.name}
            loading="lazy"
            referrerPolicy="no-referrer"
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-midnight-700 to-midnight-950">
            <span className="font-display text-6xl text-gold/50">
              {getInitials(character.name)}
            </span>
          </div>
        )}

        {/* Level badge (top-left) */}
        {character.level != null && (
          <div className="absolute left-2 top-2 rounded border border-gold/40 bg-midnight-950/85 px-1.5 py-0.5 text-[0.65rem] font-display uppercase tracking-widest text-gold">
            L{character.level}
          </div>
        )}

        {/* Bottom gradient with name + optional subtitle */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-midnight-950 via-midnight-950/85 to-transparent p-3 pt-10">
          <div className="font-display text-base leading-tight text-gold">
            {character.name}
          </div>
          {subtitle && (
            <div className="mt-0.5 text-xs text-silver/70">{subtitle}</div>
          )}
        </div>
      </Link>
    </li>
  );
}

// ---------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------

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

function pickString(obj: Record<string, unknown>, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v.trim().length > 0) return v;
  }
  return null;
}

function getInitials(name: string | undefined): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? '' : '';
  return (first + last).toUpperCase() || '?';
}
