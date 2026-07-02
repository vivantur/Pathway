import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGlobalSearch } from './useGlobalSearch';

/**
 * Site-wide search: a command-palette overlay that fans out across the Rules
 * Library and the player's characters. Opens from the header button or
 * ⌘K / Ctrl+K; Esc closes; ↑/↓ move the selection and Enter opens it.
 */
export function GlobalSearch() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Search Pathway"
        className="flex items-center gap-2 rounded-md border border-gold/25 px-2.5 py-1.5 text-silver/70 transition-colors hover:border-gold/50 hover:text-gold"
      >
        <SearchGlyph />
        <span className="hidden text-sm sm:inline">Search</span>
        <span className="hidden rounded border border-gold/20 px-1 text-[0.6rem] uppercase tracking-widest text-silver/40 md:inline">
          ⌘K
        </span>
      </button>
      {open && <SearchOverlay onClose={() => setOpen(false)} />}
    </>
  );
}

function SearchOverlay({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Debounce the query feeding the fan-out.
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(query), 180);
    return () => window.clearTimeout(t);
  }, [query]);

  const { grouped, flat, isLoading, enabled } = useGlobalSearch(debounced);

  // Keep the active index in range as results change.
  useEffect(() => {
    setActive((a) => (flat.length === 0 ? 0 : Math.min(a, flat.length - 1)));
  }, [flat.length]);

  const go = (to: string) => {
    onClose();
    navigate(to);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, Math.max(flat.length - 1, 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter') {
      const hit = flat[active];
      if (hit) go(hit.to);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 px-4 pt-[10vh] backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl overflow-hidden rounded-lg border border-gold/30 bg-midnight-900/95 shadow-gilded"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-gold/20 px-3">
          <span className="text-gold/70">
            <SearchGlyph />
          </span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search spells, feats, monsters, characters…"
            className="w-full bg-transparent py-3 text-sm text-silver placeholder:text-silver/40 focus:outline-none"
          />
          {isLoading && <span className="text-[0.6rem] uppercase tracking-widest text-silver/40">…</span>}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close search"
            className="rounded border border-gold/20 px-1.5 text-[0.6rem] uppercase tracking-widest text-silver/50 hover:text-gold"
          >
            Esc
          </button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto p-2">
          {!enabled ? (
            <p className="px-2 py-6 text-center text-sm text-silver/40">
              Type at least 2 letters to search the archive and your vault.
            </p>
          ) : flat.length === 0 && !isLoading ? (
            <p className="px-2 py-6 text-center text-sm text-silver/40">
              No matches for “{debounced.trim()}”.
            </p>
          ) : (
            grouped.map((g) => (
              <div key={g.group} className="mb-2">
                <div className="px-2 py-1 text-[0.6rem] font-display uppercase tracking-widest text-gold/70">
                  {g.group}
                </div>
                <ul>
                  {g.hits.map((hit) => {
                    const idx = flat.indexOf(hit);
                    const isActive = idx === active;
                    return (
                      <li key={hit.key}>
                        <button
                          type="button"
                          onMouseEnter={() => setActive(idx)}
                          onClick={() => go(hit.to)}
                          className={`flex w-full items-center justify-between gap-3 rounded px-2 py-1.5 text-left text-sm ${
                            isActive
                              ? 'bg-gold/15 text-gold'
                              : 'text-silver/90 hover:bg-midnight-800/60'
                          }`}
                        >
                          <span className="min-w-0 truncate">{hit.name}</span>
                          {hit.subtitle && (
                            <span className="shrink-0 text-[0.65rem] uppercase tracking-widest text-silver/40">
                              {hit.subtitle}
                            </span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function SearchGlyph() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      aria-hidden
    >
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
    </svg>
  );
}
