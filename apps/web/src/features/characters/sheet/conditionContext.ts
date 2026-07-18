import { createContext, useContext } from 'react';
import type { ConditionAdjustments } from './sheetStats';

/**
 * Net condition modifiers per stat, ambient to everything the sheet renders.
 *
 * A context rather than a prop because this is cross-cutting — AC, saves, Perception,
 * class DC, max HP, every skill and every weapon row need the same map, and threading it
 * through that many component signatures would obscure more than it revealed.
 *
 * It lives in its OWN module rather than in Sheet.tsx because the tab components
 * (EquipmentTab and friends) consume it and are themselves imported BY Sheet.tsx —
 * importing back would be a cycle.
 */
export const ConditionAdjContext = createContext<ConditionAdjustments | undefined>(undefined);

export const useConditionAdj = () => useContext(ConditionAdjContext);
