import { useParams } from 'react-router-dom';
import { useBuilder } from '../store';
import { useAuth } from '@/features/auth/useAuth';
import { CompanionManager } from '@/features/companions/CompanionManager';

/**
 * Companions step — build animal companions, mounts, familiars, eidolons, and
 * custom allies as part of character creation. Companions live in the bot's
 * `companions` table keyed by char_key, so they need a saved character; when
 * editing (a char_key is in the route) the full manager is available, and a new
 * character shows a prompt to save first.
 */
export function CompanionsStep() {
  const { charKey } = useParams<{ charKey?: string }>();
  const level = useBuilder((s) => s.state.level) || 1;
  const { user } = useAuth();

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h3 className="mb-1 font-display text-xl text-gold-400">Companions</h3>
        <p className="font-ui text-sm text-parchment/70">
          Animal companions, mounts, familiars, eidolons, and custom allies — each with its own stat
          block, synced to the Discord bot.
        </p>
      </div>

      {!user ? (
        <div className="rounded-xl border border-arcane-400/30 bg-arcane-500/10 p-3 font-ui text-sm text-parchment/80">
          Sign in to build and save companions to your vault.
        </div>
      ) : charKey ? (
        <CompanionManager charKey={charKey} level={level} />
      ) : (
        <div className="rounded-xl border border-gold-500/30 bg-gold-500/10 p-3 font-ui text-sm text-parchment/85">
          Save this character to your vault first (the <span className="text-gold-400">Save to Vault</span>{' '}
          button above). Once it’s saved, reopen it from your vault to add companions here.
        </div>
      )}
    </div>
  );
}
