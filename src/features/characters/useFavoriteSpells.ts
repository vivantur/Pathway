import { useCallback, useEffect, useState } from 'react';

/**
 * Per-character "pinned spells" preference, persisted in localStorage.
 *
 * Favoriting is a purely local convenience (which spells a player keeps at the
 * top of their Attacks list) — it never syncs to the bot and never touches the
 * `overlay` blob or any DB column, so it can't fight bot-managed state. Keyed
 * by char_key so each character has its own pin set on this browser.
 */
const keyFor = (charKey: string) => `pathway:fav-spells:${charKey}`;

function read(charKey: string): string[] {
  try {
    const raw = localStorage.getItem(keyFor(charKey));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((x): x is string => typeof x === 'string')
      : [];
  } catch {
    return [];
  }
}

export function useFavoriteSpells(charKey: string) {
  const [favorites, setFavorites] = useState<Set<string>>(() => new Set(read(charKey)));

  // Re-sync when switching characters (the hook instance is reused per sheet).
  useEffect(() => {
    setFavorites(new Set(read(charKey)));
  }, [charKey]);

  const toggle = useCallback(
    (name: string) => {
      setFavorites((prev) => {
        const next = new Set(prev);
        if (next.has(name)) next.delete(name);
        else next.add(name);
        try {
          localStorage.setItem(keyFor(charKey), JSON.stringify([...next]));
        } catch {
          /* storage disabled or over quota — pins just won't persist */
        }
        return next;
      });
    },
    [charKey],
  );

  return { favorites, toggle };
}
