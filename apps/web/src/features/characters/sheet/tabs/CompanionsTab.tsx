import type { CharacterRow } from '@/features/characters/types';
import type { PathbuilderBuild } from '@/features/characters/pathbuilder';
import { Panel } from '../Sheet';
import { CompanionIcon } from '../icons';
import { useAuth } from '@/features/auth/useAuth';
import { CompanionManager } from '@/features/companions/CompanionManager';

/**
 * Companions tab — all companion kinds (animal companions, mounts, familiars,
 * eidolons, custom) with their own stat blocks, stored in the bot's `companions`
 * table so they sync to Discord. Any Pathbuilder-imported `pets`/`familiars`
 * appear read-only below.
 */
export function CompanionsTab({
  build,
  character,
  readOnly,
}: {
  build: PathbuilderBuild;
  character: CharacterRow;
  readOnly: boolean;
}) {
  const { user } = useAuth();
  const level = character.level ?? build.level ?? 1;
  const canManage = Boolean(user) && !readOnly;

  const pets = extractCompanions(build.pets);
  const familiars = extractCompanions(build.familiars);

  return (
    <div className="space-y-4">
      {canManage ? (
        <Panel title="Companions" icon={<CompanionIcon />}>
          <CompanionManager charKey={character.char_key} level={level} />
        </Panel>
      ) : (
        <Panel title="Companions" icon={<CompanionIcon />}>
          <p className="py-6 text-center text-sm text-silver/60">
            {readOnly
              ? 'This character’s companions are private.'
              : 'Sign in to build companions and sync them to the Discord bot.'}
          </p>
        </Panel>
      )}

      {familiars.length > 0 && <CompanionGroup title="Familiars (from import)" entries={familiars} />}
      {pets.length > 0 && <CompanionGroup title="Companions (from import)" entries={pets} />}
    </div>
  );
}

// ---------------------------------------------------------------
// Pathbuilder-imported companions (read-only) — shapes vary
// ---------------------------------------------------------------

function CompanionGroup({ title, entries }: { title: string; entries: CompanionEntry[] }) {
  return (
    <Panel title={`${title} (${entries.length})`} icon={<CompanionIcon />}>
      <ul className="grid gap-2 sm:grid-cols-2">
        {entries.map((c, i) => (
          <li key={`${c.name}-${i}`} className="rounded border border-gold/15 bg-midnight-900/40 p-3">
            <div className="font-display text-silver">{c.name}</div>
            {c.subtitle && <div className="mt-0.5 text-xs text-silver/60">{c.subtitle}</div>}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

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
      const name = pickStr(rec, 'name', 'displayName', 'nickname', 'type', 'animal') ?? 'Companion';
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
