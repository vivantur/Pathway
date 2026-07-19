// Pure display helpers for the sheet's granted-actions panel.
//
// Split from GrantedActions.tsx so the component file exports only components
// (react-refresh) and so these stay testable without any render infrastructure.

import type { ActionCost } from '@pathway/core';

/**
 * The short cost badge — `1A`, `1–3A`, `R`, `F`, or a time cost's own text.
 *
 * Returns null rather than a placeholder for BOTH "no cost declared" and a kind
 * this function doesn't know: an absent badge is honest, where "0A" or
 * "[object Object]" on a character sheet is not.
 */
export function formatActionCost(cost: ActionCost | undefined): string | null {
  if (!cost) return null;
  switch (cost.kind) {
    case 'actions':
      // Core's schema allows min < max; collapsing that to one number would
      // misreport a variable-cost activity.
      return cost.min === cost.max ? `${cost.min}A` : `${cost.min}–${cost.max}A`;
    case 'reaction':
      return 'R';
    case 'free':
      return 'F';
    case 'time':
      return cost.text;
    default:
      return null;
  }
}
