import { useEffect, useRef, useState } from 'react';

/**
 * "Send to the Discord bot" — surfaces the character's Pathway ID (its Supabase
 * row UUID) and the exact bot command, the way Pathbuilder surfaces its export
 * id. The bot's `/char import id:<uuid>` reads this character straight from the
 * shared database (with an ownership check against the requester's linked
 * Discord account), so no separate download endpoint is needed.
 */
export function BotImportButton({ characterId }: { characterId: string }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const importCmd = `/char import id:${characterId}`;
  const updateCmd = `/char update id:${characterId}`;

  const copy = async (text: string, which: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(which);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  // Close when clicking outside.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="rounded-md border border-arcane/40 bg-arcane/10 px-3 py-1.5 text-xs font-display uppercase tracking-widest text-arcane transition-colors hover:bg-arcane/20"
      >
        Send to Discord bot
      </button>

      {open && (
        <div className="absolute right-0 z-30 mt-2 w-[22rem] max-w-[90vw] rounded-lg border border-gold/30 bg-midnight-800 p-4 shadow-gilded">
          <h4 className="font-display text-sm text-gold">Import into the Pathway bot</h4>
          <p className="mt-1 text-xs text-silver/70">
            In Discord, run this command (or copy just the ID):
          </p>

          <div className="mt-2">
            <div className="text-[0.6rem] uppercase tracking-widest text-silver/50">Command</div>
            <div className="mt-1 flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded border border-gold/20 bg-midnight-900/70 px-2 py-1 text-xs text-silver">
                {importCmd}
              </code>
              <button
                type="button"
                onClick={() => copy(importCmd, 'cmd')}
                className="shrink-0 rounded border border-gold/30 px-2 py-1 text-xs text-silver/80 hover:border-gold/60 hover:text-gold"
              >
                {copied === 'cmd' ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>

          <div className="mt-2">
            <div className="text-[0.6rem] uppercase tracking-widest text-silver/50">Pathway ID</div>
            <div className="mt-1 flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded border border-gold/20 bg-midnight-900/70 px-2 py-1 text-xs text-silver">
                {characterId}
              </code>
              <button
                type="button"
                onClick={() => copy(characterId, 'id')}
                className="shrink-0 rounded border border-gold/30 px-2 py-1 text-xs text-silver/80 hover:border-gold/60 hover:text-gold"
              >
                {copied === 'id' ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>

          <p className="mt-3 text-[0.7rem] leading-relaxed text-silver/60">
            Your Discord account must be linked to this Pathway account — it is if you signed in with
            Discord. To re‑sync later (keeping HP/XP), use{' '}
            <code className="text-silver/80">{updateCmd}</code>.
          </p>
        </div>
      )}
    </div>
  );
}
