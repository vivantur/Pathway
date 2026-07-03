import { describe, it, expect } from 'vitest';
import * as core from './index';

// Smoke test: the public surface the apps depend on is exported. The real rules
// coverage lives in engine.test.ts (worked examples).
describe('@pathway/core public API', () => {
  it('exports the schema, character model, and engine', () => {
    expect(core.ABILITY_KEYS).toHaveLength(6);
    expect(typeof core.datasetSchema.parse).toBe('function');
    expect(typeof core.emptyBuilderState).toBe('function');
    expect(typeof core.deriveCharacter).toBe('function');
    expect(typeof core.createEngine).toBe('function');
    expect(core.OPT.proficiencyWithoutLevel).toBe('proficiencyWithoutLevel');
  });
});
