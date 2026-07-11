// Seam tests: coercion-at-the-boundary and the write-side validation gate.
//
// `partitionSpells` is pure and tested directly. The client-facing functions are
// exercised with a tiny fake Supabase client (a thenable query builder) so the
// seam's behaviour — valid rows through, invalid rows reported, bad writes
// rejected before the DB is touched — is verified without a live database.

import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  partitionSpells,
  readSpellById,
  readSpells,
  writeSpell,
} from './spells';

const validRow = {
  id: 'electric_arc',
  name: 'Electric Arc',
  rank: 1,
  actionCost: '[two-actions]',
  traits: 'Cantrip Concentrate Electricity Manipulate',
  traditions: 'arcane, primal',
  source: 'Player Core pg. 328',
  range: '30 feet',
  targets: '1 or 2 creatures',
  defense: 'basic Reflex',
  description: 'An arc of lightning leaps from one target to another.',
};

/** No rank → coerceSpell rejects it. */
const invalidRow = { id: 'broken', name: 'Broken Spell', description: 'x' };

/**
 * A fake Supabase client. `.from()` returns a thenable builder whose chain
 * methods return itself and which resolves to `result`; `upsert` records its
 * calls so we can assert the DB was (or was not) written.
 */
function fakeClient(result: { data: unknown; error: unknown }, upsertSpy = vi.fn()) {
  const builder: Record<string, unknown> = {};
  Object.assign(builder, {
    select: () => builder,
    eq: () => builder,
    ilike: () => builder,
    limit: () => builder,
    maybeSingle: async () => result,
    upsert: async (row: unknown) => {
      upsertSpy(row);
      return { error: null };
    },
    then: (resolve: (r: typeof result) => unknown) => resolve(result),
  });
  const client = { from: () => builder } as unknown as SupabaseClient;
  return { client, upsertSpy };
}

describe('partitionSpells', () => {
  it('coerces valid rows and reports invalid ones without aborting the batch', () => {
    const { spells, invalid } = partitionSpells([validRow, invalidRow]);
    expect(spells).toHaveLength(1);
    expect(spells[0]?.name).toBe('Electric Arc');
    expect(invalid).toHaveLength(1);
    expect(invalid[0]?.id).toBe('broken');
    expect(invalid[0]?.issues.join(' ')).toMatch(/rank/);
  });

  it('is empty-safe', () => {
    expect(partitionSpells([])).toEqual({ spells: [], invalid: [] });
  });
});

describe('readSpellById', () => {
  it('returns a coerced spell when the row exists and is valid', async () => {
    const { client } = fakeClient({ data: validRow, error: null });
    const res = await readSpellById(client, 'electric_arc');
    expect(res).toEqual({ ok: true, spell: expect.objectContaining({ name: 'Electric Arc' }) });
  });

  it('reports not-found when the row is absent', async () => {
    const { client } = fakeClient({ data: null, error: null });
    const res = await readSpellById(client, 'nope');
    expect(res).toEqual({ ok: false, reason: 'not-found' });
  });

  it('reports invalid when the row fails to coerce', async () => {
    const { client } = fakeClient({ data: invalidRow, error: null });
    const res = await readSpellById(client, 'broken');
    expect(res.ok).toBe(false);
    if (!res.ok && res.reason === 'invalid') expect(res.issues.join(' ')).toMatch(/rank/);
    else throw new Error('expected invalid');
  });

  it('surfaces a query error', async () => {
    const { client } = fakeClient({ data: null, error: { message: 'boom' } });
    const res = await readSpellById(client, 'x');
    expect(res).toEqual({ ok: false, reason: 'error', message: 'boom' });
  });
});

describe('readSpells', () => {
  it('partitions a fetched batch into valid spells and invalid rows', async () => {
    const { client } = fakeClient({ data: [validRow, invalidRow], error: null });
    const res = await readSpells(client, { search: 'arc', limit: 10 });
    expect(res.spells).toHaveLength(1);
    expect(res.invalid).toHaveLength(1);
    expect(res.error).toBeUndefined();
  });

  it('surfaces a query error and yields no spells', async () => {
    const { client } = fakeClient({ data: null, error: { message: 'denied' } });
    const res = await readSpells(client);
    expect(res).toEqual({ spells: [], invalid: [], error: 'denied' });
  });
});

describe('writeSpell — the validation gate', () => {
  it('persists a valid spell and returns the coerced result', async () => {
    const { client, upsertSpy } = fakeClient({ data: null, error: null });
    const res = await writeSpell(client, validRow);
    expect(res).toEqual({ ok: true, spell: expect.objectContaining({ name: 'Electric Arc' }) });
    expect(upsertSpy).toHaveBeenCalledOnce();
  });

  it('rejects an invalid spell and NEVER touches the database', async () => {
    const { client, upsertSpy } = fakeClient({ data: null, error: null });
    const res = await writeSpell(client, invalidRow);
    expect(res.ok).toBe(false);
    if (!res.ok && res.reason === 'invalid') expect(res.issues.join(' ')).toMatch(/rank/);
    else throw new Error('expected invalid');
    expect(upsertSpy).not.toHaveBeenCalled();
  });
});
