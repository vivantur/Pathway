import { create } from 'zustand';
import { findAncestry, findBackground, findClass } from '@/features/builder/data';
import {
  emptyBuilderState,
  emptyLevelGains,
  type BuilderState,
  type CompanionDraft,
  type InventoryEntry,
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
  addLore: (subject: string, max: number) => void;
  removeLore: (subject: string) => void;
  setBonusFeat: (slotKey: string, featId: string | undefined) => void;
  setSubclassSkillChoice: (key: string, skillId: string) => void;
  setSkillOverride: (skillId: string, rank: number | null) => void;
  toggleLanguage: (name: string, max: number) => void;
  setFeatChoice: (featId: string, flag: string, value: string) => void;

  setLevel: (level: number) => void;
  levelUp: () => void;
  updateLevelGains: (level: number, patch: Partial<LevelGains>) => void;
  setOption: (id: string, value: boolean) => void;

  addItem: (itemId: string) => void;
  removeItem: (itemId: string) => void;
  setItemQty: (itemId: string, qty: number) => void;
  toggleEquip: (itemId: string) => void;
  setItemRunes: (itemId: string, runes: Partial<NonNullable<InventoryEntry['runes']>>) => void;
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

  addCompanionDraft: (draft: CompanionDraft) => void;
  updateCompanionDraft: (index: number, draft: CompanionDraft) => void;
  removeCompanionDraft: (index: number) => void;
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
          ancestryParagonFeatId: undefined,
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
          loreChoices: [],
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

  addLore: (subject, max) =>
    set((s) => {
      const clean = subject.trim();
      const cur = s.state.loreChoices ?? [];
      // No blanks, no duplicate subjects, and never past the shared free-skill cap.
      if (!clean || cur.length >= max) return { state: s.state };
      if (cur.some((l) => l.toLowerCase() === clean.toLowerCase())) return { state: s.state };
      return { state: { ...s.state, loreChoices: [...cur, clean] } };
    }),

  removeLore: (subject) =>
    set((s) => ({
      state: {
        ...s.state,
        loreChoices: (s.state.loreChoices ?? []).filter(
          (l) => l.toLowerCase() !== subject.trim().toLowerCase(),
        ),
      },
    })),

  setBonusFeat: (slotKey, featId) =>
    set((s) => {
      const next = { ...(s.state.bonusFeatChoices ?? {}) };
      if (featId) next[slotKey] = featId;
      else delete next[slotKey];
      return { state: { ...s.state, bonusFeatChoices: next } };
    }),

  setSubclassSkillChoice: (key, skillId) =>
    set((s) => ({
      state: {
        ...s.state,
        subclassSkillChoices: { ...(s.state.subclassSkillChoices ?? {}), [key]: skillId },
      },
    })),

  setSkillOverride: (skillId, rank) =>
    set((s) => {
      const next = { ...(s.state.skillOverrides ?? {}) };
      if (rank && rank > 0) next[skillId] = rank;
      else delete next[skillId];
      return { state: { ...s.state, skillOverrides: next } };
    }),

  toggleLanguage: (name, max) =>
    set((s) => {
      const chosen = new Set(s.state.languageChoices);
      if (chosen.has(name)) chosen.delete(name);
      else if (chosen.size < max) chosen.add(name);
      return { state: { ...s.state, languageChoices: [...chosen] } };
    }),

  setFeatChoice: (featId, flag, value) =>
    set((s) => ({
      state: {
        ...s.state,
        featChoices: {
          ...s.state.featChoices,
          [featId]: { ...(s.state.featChoices?.[featId] ?? {}), [flag]: value },
        },
      },
    })),

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

  setItemRunes: (itemId, runes) =>
    set((s) => ({
      state: {
        ...s.state,
        inventory: s.state.inventory.map((e) =>
          e.itemId === itemId ? { ...e, runes: { ...e.runes, ...runes } } : e,
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

  addCompanionDraft: (draft) =>
    set((s) => ({
      state: { ...s.state, companionDrafts: [...(s.state.companionDrafts ?? []), draft] },
    })),

  updateCompanionDraft: (index, draft) =>
    set((s) => ({
      state: {
        ...s.state,
        companionDrafts: (s.state.companionDrafts ?? []).map((d, i) => (i === index ? draft : d)),
      },
    })),

  removeCompanionDraft: (index) =>
    set((s) => ({
      state: {
        ...s.state,
        companionDrafts: (s.state.companionDrafts ?? []).filter((_, i) => i !== index),
      },
    })),
}));
