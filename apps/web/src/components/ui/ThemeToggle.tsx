import { useEffect, useState } from 'react';
import { getStoredTheme, setTheme, type Theme } from '@/lib/theme';

/**
 * Light/dark toggle. The theme is applied to <html> pre-render by an inline
 * script in index.html (so there's no flash); this button just reflects and
 * flips the stored value. Shows a moon in dark mode (tap for light) and a sun
 * in light mode (tap for dark).
 */
export function ThemeToggle({
  /** `landing` renders the 34px bordered square on the landing page's tokens. */
  variant = 'default',
}: { variant?: 'default' | 'landing' } = {}) {
  const [theme, setThemeState] = useState<Theme>('dark');

  // Sync to whatever the pre-render script already applied.
  useEffect(() => {
    setThemeState(getStoredTheme());
  }, []);

  const toggle = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    setThemeState(next);
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      className={
        variant === 'landing'
          ? 'inline-flex h-[34px] w-[34px] items-center justify-center rounded-md border border-line text-dim transition-colors hover:border-line-strong hover:text-gold'
          : 'rounded-md border border-gold/25 p-2 text-silver/70 transition-colors hover:border-gold/50 hover:text-gold'
      }
    >
      {theme === 'dark' ? (
        // Moon
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
        </svg>
      ) : (
        // Sun
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      )}
    </button>
  );
}
