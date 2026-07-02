import { create } from 'zustand';

/**
 * Builder-local UI state: Beginner Mode and the option toggles. (Navigation and
 * the character vault are main's concern — react-router + Supabase — so this
 * store deliberately does NOT track views or persistence.)
 */
const BEGINNER_KEY = 'pathway.beginnerMode';
const GLOBAL_OPTS_KEY = 'pathway.globalOptions.v1';

function loadBeginner(): boolean {
  try {
    const raw = localStorage.getItem(BEGINNER_KEY);
    return raw === null ? true : raw === 'true';
  } catch {
    return true;
  }
}

function loadGlobalOptions(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(GLOBAL_OPTS_KEY);
    return raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

interface AppStore {
  beginner: boolean;
  setBeginner: (on: boolean) => void;
  globalOptions: Record<string, boolean>;
  setGlobalOption: (id: string, value: boolean) => void;
  /** The Supabase character id currently open in the builder (null = new). */
  currentCharacterId: string | null;
  setCurrentCharacterId: (id: string | null) => void;
}

export const useApp = create<AppStore>((set) => ({
  beginner: loadBeginner(),
  setBeginner: (on) => {
    try {
      localStorage.setItem(BEGINNER_KEY, String(on));
    } catch {
      /* ignore */
    }
    set({ beginner: on });
  },
  globalOptions: loadGlobalOptions(),
  setGlobalOption: (id, value) =>
    set((s) => {
      const next = { ...s.globalOptions, [id]: value };
      try {
        localStorage.setItem(GLOBAL_OPTS_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return { globalOptions: next };
    }),
  currentCharacterId: null,
  setCurrentCharacterId: (id) => set({ currentCharacterId: id }),
}));
