import type { PathbuilderBuild } from '@/features/characters/pathbuilder';
import { Panel } from '../Sheet';
import { CompanionIcon } from '../icons';

/**
 * Companions tab — animal companions, familiars, eidolons, and mounts.
 *
 * v1 surfaces whatever the Pathbuilder build carries (`pets` / `familiars`,
 * read defensively since the shape varies) and a prominent link to the
 * upcoming Companion Creator. Full companion sheets (with their own stat
 * blocks, synced to the bot) land when the creator ships — this tab is the
 * home they'll live in.
 */
export function CompanionsTab({ build }: { build: PathbuilderBuild }) {
  const pets = extractCompanions(build.pets);
  const familiars = extractCompanions(build.familiars);
  const hasAny = pets.length > 0 || familiars.length > 0;

  return (
    <div className="space-y-4">
      {familiars.length > 0 && (
        <CompanionGroup title="Familiars" entries={familiars} />
      )}
      {pets.length > 0 && (
        <CompanionGroup title="Animal Companions & Mounts" entries={pets} />
      )}

      <Panel title="Companion Creator" icon={<CompanionIcon />}>
        <div className="flex flex-col items-center gap-4 py-8 text-center">
          <div className="rounded-full border border-gold/30 bg-midnight-900/60 p-5 text-gold/60">
            <CompanionIcon className="text-4xl" />
          </div>
          <div>
            <h3 className="font-display text-lg text-gold">Coming Soon</h3>
            <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-silver/70">
              {hasAny
                ? 'Full companion sheets — with their own stat blocks, actions, and Discord-side sync — arrive with the Companion Creator. Your build-imported companions above will link into it automatically.'
                : 'Build animal companions, familiars, eidolons, and mounts with their own sheets, then sync them to the Discord bot. This is where they’ll live.'}
            </p>
          </div>
          <button
            type="button"
            disabled
            title="The Companion Creator isn't available yet"
            className="inline-flex cursor-not-allowed items-center gap-2 rounded-md border border-gold/30 bg-gold/5 px-4 py-2 text-sm font-display uppercase tracking-widest text-gold/50"
          >
            + Create a Companion
          </button>
        </div>
      </Panel>
    </div>
  );
}

function CompanionGroup({
  title,
  entries,
}: {
  title: string;
  entries: CompanionEntry[];
}) {
  return (
    <Panel title={`${title} (${entries.length})`} icon={<CompanionIcon />}>
      <ul className="grid gap-2 sm:grid-cols-2">
        {entries.map((c, i) => (
          <li
            key={`${c.name}-${i}`}
            className="rounded border border-gold/15 bg-midnight-900/40 p-3"
          >
            <div className="font-display text-silver">{c.name}</div>
            {c.subtitle && (
              <div className="mt-0.5 text-xs text-silver/60">{c.subtitle}</div>
            )}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

// ---------------------------------------------------------------
// Defensive extraction — Pathbuilder companion shapes vary
// ---------------------------------------------------------------

interface CompanionEntry {
  name: string;
  subtitle: string | null;
}

function extractCompanions(raw: unknown): CompanionEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: CompanionEntry[] = [];
  for (const item of raw) {
    if (item == null) continue;
    if (typeof item === 'string') {
      if (item.trim()) out.push({ name: item.trim(), subtitle: null });
      continue;
    }
    if (typeof item === 'object') {
      const rec = item as Record<string, unknown>;
      const name =
        pickStr(rec, 'name', 'displayName', 'nickname', 'type', 'animal') ??
        'Companion';
      const subtitle = pickStr(rec, 'type', 'animal', 'specific', 'kind', 'ancestry');
      out.push({ name, subtitle: subtitle && subtitle !== name ? subtitle : null });
    }
  }
  return out;
}

function pickStr(obj: Record<string, unknown>, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v.trim().length > 0) return v.trim();
  }
  return null;
}
