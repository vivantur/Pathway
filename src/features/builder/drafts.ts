import type { BuilderState } from './types';

/**
 * An in-progress builder draft, saved locally so someone can leave and come
 * back to finish a character. Local (per-browser) by design: it needs no login
 * and can't hit the vault's DB constraints — it's a work-in-progress, not a
 * saved character. Completing "Save to Vault" clears the draft.
 */
export interface BuilderDraft {
  state: BuilderState;
  updatedAt: string; // ISO timestamp
}

const KEY = 'pathway.builder.draft.v1';

export function saveDraft(state: BuilderState): void {
  try {
    const draft: BuilderDraft = { state, updatedAt: new Date().toISOString() };
    localStorage.setItem(KEY, JSON.stringify(draft));
  } catch {
    /* storage full or unavailable — ignore */
  }
}

export function loadDraft(): BuilderDraft | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as BuilderDraft;
    return parsed && parsed.state ? parsed : null;
  } catch {
    return null;
  }
}

export function clearDraft(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

/** True when the builder is on a fresh, untouched character (nothing to lose). */
export function isEmptyState(state: BuilderState): boolean {
  return !state.ancestryId && !state.classId && !state.backgroundId && !state.name.trim();
}
