// Display helpers for the sheet's granted-actions panel.
//
// The panel's real logic is tested elsewhere and deliberately not duplicated here:
// the lookup in builder/grantedActions.test.ts, the interpreter host in
// features/automation/runAction.test.ts. This repo has no component-render
// infrastructure (no jsdom, no testing-library), so what is coverable here is the
// pure formatting — which is exactly the part with branches worth locking.

import { describe, expect, it } from 'vitest';
import type { ActionCost } from '@pathway/core';
import { formatActionCost } from './grantedActionsDisplay';

describe('formatActionCost', () => {
  it('renders a fixed action cost', () => {
    expect(formatActionCost({ kind: 'actions', min: 1, max: 1 })).toBe('1A');
    expect(formatActionCost({ kind: 'actions', min: 3, max: 3 })).toBe('3A');
  });

  it('renders a variable action cost as a range', () => {
    // Core's schema allows min < max (a spell or activity that can be sustained
    // longer); collapsing that to one number would misreport the cost.
    expect(formatActionCost({ kind: 'actions', min: 1, max: 3 })).toBe('1–3A');
  });

  it('renders reaction and free actions', () => {
    expect(formatActionCost({ kind: 'reaction' })).toBe('R');
    expect(formatActionCost({ kind: 'free' })).toBe('F');
  });

  it('passes a time-based cost through as its own text', () => {
    expect(formatActionCost({ kind: 'time', text: '10 minutes' })).toBe('10 minutes');
  });

  it('renders nothing for an action with no declared cost', () => {
    // Absent, not zero — the badge is simply omitted rather than showing "0A".
    expect(formatActionCost(undefined)).toBeNull();
  });

  it('returns null for a cost kind it does not know', () => {
    // If core grows the union, the badge disappears rather than rendering
    // "[object Object]" onto a character sheet.
    expect(formatActionCost({ kind: 'newKind' } as unknown as ActionCost)).toBeNull();
  });
});
