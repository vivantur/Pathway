export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'pathway-theme';

/** Read the persisted theme, defaulting to dark (the grimoire default). */
export function getStoredTheme(): Theme {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

/** Persist + apply a theme by toggling the `.light` / `.dark` class on <html>. */
export function setTheme(theme: Theme): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // ignore storage failures (private mode, etc.)
  }
  applyTheme(theme);
}

export function applyTheme(theme: Theme): void {
  const el = document.documentElement;
  el.classList.toggle('light', theme === 'light');
  el.classList.toggle('dark', theme === 'dark');
}
