import { create } from 'zustand';
import { findAncestry, findBackground, findClass } from '@/features/builder/data';
import {
  emptyBuilderState,
  emptyLevelGains,
  type BuilderState,
  type LevelGains,
  type SpellTradition,
  type StepId,
} from './types';
import { choiceSlots } from './rules';

export const STEPS: { id: StepId; label: string }[] = [
  { id: 'ancestry', label: 'Ancestry' },
  { id: 'heritage', label: 'Heritage' },
  { id: 'background', label: 'Background' },
  { id: 'class', label: 'Class' },
  { id: 'abilities', label: 'Abilities' },
  { id: 'skills', label: 'Skills' },
  { id: 'feats', label: 'Feats' },
  { id: 'advancement', label: 'Advancement' },
  { id: 'spells', label: 'Spells' },
  { id: 'equipment', label: 'Equipment' },
  { id: 'companions', label: 'Companions' },
  { id: 'review', label: 'Review' },
];

export const MAX_LEVEL = 20;

interface BuilderStore {
  state: BuilderState;
  step: StepId;
  setStep: (step: StepId) => void;
  update: (patch: Partial<BuilderState>) => void;
  replace: (state: BuilderState) => void;
  reset: () => void;

  chooseAncestry: (id: string) => void;
  chooseBackground: (id: string) => void;
  chooseClass: (id: string) => void;
  toggleSkill: (id: string, maxFree: number) => void;
  toggleLanguage: (name: string, max: number) => void;

  setLevel: (level: number) => void;
  levelUp: () => void;
  updateLevelGains: (level: number, patch: Partial<LevelGains>) => void;
  setOption: (id: string, value: boolean) => void;

  addItem: (itemId: string) => void;
  removeItem: (itemId: string) => void;
  setItemQty: (itemId: string, qty: number) => void;
  toggleEquip: (itemId: string) => void;
  setMoney: (gp: number) => void;

  toggleCantrip: (id: string, max: number) => void;
  toggleSpell: (rank: number, id: string, max: number) => void;
  toggleFocusSpell: (id: string) => void;
  toggleFocusCantrip: (id: string) => void;
  setFocusTradition: (tradition: string) => void;

  addInnateSpell: (spellId: string, tradition: SpellTradition) => void;
  removeInnateSpell: (spellId: string) => void;
  setInnatePerDay: (spellId: string, perDay: number) => void;
  setInnateTradition: (spellId: string, tradition: SpellTradition) => void;
}

export const useBuilder = create<BuilderStore>((set) => ({
  state: emptyBuilderState(),
  step: 'ancestry',
  setStep: (step) => set({ step }),
  update: (patch) => set((s) => ({ state: { ...s.state, ...patch } })),
  replace: (state) => set({ state }),
  reset: () => set({ state: emptyBuilderState(), step: 'ancestry' }),

  chooseAncestry: (id) =>
    set((s) => {
      const ancestry = findAncestry(id);
      const slots = ancestry ? choiceSlots(ancestry.boosts).length : 0;
      return {
        state: {
          ...s.state,
          ancestryId: id,
          heritageId: undefined, // reset heritage when ancestry changes
          ancestryBoostChoices: Array(slots).fill(null),
          ancestryFeatId: undefined,
          languageChoices: [],
        },
      };
    }),

  chooseBackground: (id) =>
    set((s) => {
      const bg = findBackground(id);
      const slots = bg ? choiceSlots(bg.boosts).length : 0;
      return {
        state: { ...s.state, backgroundId: id, backgroundBoostChoices: Array(slots).fill(null) },
      };
    }),

  chooseClass: (id) =>
    set((s) => {
      const klass = findClass(id);
      return {
        state: {
          ...s.state,
          classId: id,
          keyAbility: klass && klass.keyAbility.length === 1 ? klass.keyAbility[0] : undefined,
          subclassId: undefined,
          classFeatId: undefined,
          skillChoices: [],
        },
      };
    }),

  toggleSkill: (id, maxFree) =>
    set((s) => {
      const chosen = new Set(s.state.skillChoices);
      if (chosen.has(id)) {
        chosen.delete(id);
      } else if (chosen.size < maxFree) {
        chosen.add(id);
      }
      return { state: { ...s.state, skillChoices: [...chosen] } };
    }),

  toggleLanguage: (name, max) =>
    set((s) => {
      const chosen = new Set(s.state.languageChoices);
      if (chosen.has(name)) chosen.delete(name);
      else if (chosen.size < max) chosen.add(name);
      return { state: { ...s.state, languageChoices: [...chosen] } };
    }),

  setLevel: (level) =>
    set((s) => ({
      state: { ...s.state, level: Math.max(1, Math.min(MAX_LEVEL, Math.round(level))) },
    })),

  levelUp: () =>
    set((s) => ({
      step: 'advancement',
      state: { ...s.state, level: Math.min(MAX_LEVEL, s.state.level + 1) },
    })),

  updateLevelGains: (level, patch) =>
    set((s) => {
      const existing = s.state.progression[level] ?? emptyLevelGains();
      return {
        state: {
          ...s.state,
          progression: { ...s.state.progression, [level]: { ...existing, ...patch } },
        },
      };
    }),

  setOption: (id, value) =>
    set((s) => ({
      state: { ...s.state, options: { ...s.state.options, [id]: value } },
    })),

  addItem: (itemId) =>
    set((s) => {
      const existing = s.state.inventory.find((e) => e.itemId === itemId);
      // Immutable update: replace the matched entry with a new object rather
      // than mutating one still referenced by the previous state snapshot.
      const inv = existing
        ? s.state.inventory.map((e) => (e.itemId === itemId ? { ...e, qty: e.qty + 1 } : e))
        : [...s.state.inventory, { itemId, qty: 1 }];
      return { state: { ...s.state, inventory: inv } };
    }),

  removeItem: (itemId) =>
    set((s) => ({
      state: { ...s.state, inventory: s.state.inventory.filter((e) => e.itemId !== itemId) },
    })),

  setItemQty: (itemId, qty) =>
    set((s) => ({
      state: {
        ...s.state,
        inventory: s.state.inventory
          .map((e) => (e.itemId === itemId ? { ...e, qty: Math.max(0, Math.round(qty)) } : e))
          .filter((e) => e.qty > 0),
      },
    })),

  toggleEquip: (itemId) =>
    set((s) => ({
      state: {
        ...s.state,
        inventory: s.state.inventory.map((e) =>
          e.itemId === itemId ? { ...e, equipped: !e.equipped } : e,
        ),
      },
    })),

  setMoney: (gp) => set((s) => ({ state: { ...s.state, money: Math.max(0, gp) } })),

  toggleCantrip: (id, max) =>
    set((s) => {
      const chosen = new Set(s.state.spellcasting.cantrips);
      if (chosen.has(id)) chosen.delete(id);
      else if (chosen.size < max) chosen.add(id);
      return { state: { ...s.state, spellcasting: { ...s.state.spellcasting, cantrips: [...chosen] } } };
    }),

  toggleSpell: (rank, id, max) =>
    set((s) => {
      const byRank = { ...s.state.spellcasting.spellsByRank };
      const chosen = new Set(byRank[rank] ?? []);
      if (chosen.has(id)) chosen.delete(id);
      else if (chosen.size < max) chosen.add(id);
      byRank[rank] = [...chosen];
      return { state: { ...s.state, spellcasting: { ...s.state.spellcasting, spellsByRank: byRank } } };
    }),

  // Focus spells aren't slot-limited: you can know more focus spells than your
  // pool has points (the pool just caps at 3). So toggling is free add/remove.
  toggleFocusSpell: (id) =>
    set((s) => {
      const chosen = new Set(s.state.spellcasting.focusSpells ?? []);
      if (chosen.has(id)) chosen.delete(id);
      else chosen.add(id);
      return { state: { ...s.state, spellcasting: { ...s.state.spellcasting, focusSpells: [...chosen] } } };
    }),

  toggleFocusCantrip: (id) =>
    set((s) => {
      const chosen = new Set(s.state.spellcasting.focusCantrips ?? []);
      if (chosen.has(id)) chosen.delete(id);
      else chosen.add(id);
      return { state: { ...s.state, spellcasting: { ...s.state.spellcasting, focusCantrips: [...chosen] } } };
    }),

  setFocusTradition: (tradition) =>
    set((s) => ({
      state: { ...s.state, spellcasting: { ...s.state.spellcasting, focusTradition: tradition } },
    })),

  addInnateSpell: (spellId, tradition) =>
    set((s) => {
      const list = s.state.innateSpells ?? [];
      if (list.some((e) => e.spellId === spellId)) return s;
      return { state: { ...s.state, innateSpells: [...list, { spellId, tradition, perDay: 1 }] } };
    }),

  removeInnateSpell: (spellId) =>
    set((s) => ({
      state: { ...s.state, innateSpells: (s.state.innateSpells ?? []).filter((e) => e.spellId !== spellId) },
    })),

  setInnatePerDay: (spellId, perDay) =>
    set((s) => ({
      state: {
        ...s.state,
        innateSpells: (s.state.innateSpells ?? []).map((e) =>
          e.spellId === spellId ? { ...e, perDay: Math.max(1, Math.round(perDay)) } : e,
        ),
      },
    })),

  setInnateTradition: (spellId, tradition) =>
    set((s) => ({
      state: {
        ...s.state,
        innateSpells: (s.state.innateSpells ?? []).map((e) =>
          e.spellId === spellId ? { ...e, tradition } : e,
        ),
      },
    })),
}));
