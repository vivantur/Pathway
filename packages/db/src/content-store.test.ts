// Tests for the generic content-store factory + the entity stores that use it.

import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { makeContentStore, type Coerce } from './content-store.js';
import { ancestryStore, heritageStore } from './ancestries.js';
import { backgroundStore } from './backgrounds.js';

/** Trivial coerce for the generic tests: valid iff it has a non-empty `name`. */
const coerce: Coerce<{ name: string }> = (raw) => {
  const r = raw as { name?: unknown };
  return typeof r?.name === 'string' && r.name.length > 0
    ? { ok: true, item: { name: r.name } }
    : { ok: false, issues: ['name is required'] };
};
const store = makeContentStore('things', coerce);

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

describe('makeContentStore', () => {
  it('partition splits valid rows from invalid, tagging invalid with id + issues', () => {
    const { items, invalid } = store.partition([{ id: 'a', name: 'A' }, { id: 'bad' }]);
    expect(items).toEqual([{ name: 'A' }]);
    expect(invalid).toEqual([{ id: 'bad', issues: ['name is required'] }]);
  });

  it('readById returns the coerced item, not-found, or invalid', async () => {
    expect(await store.readById(fakeClient({ data: { name: 'A' }, error: null }).client, 'a')).toEqual({
      ok: true,
      item: { name: 'A' },
    });
    expect(await store.readById(fakeClient({ data: null, error: null }).client, 'x')).toEqual({
      ok: false,
      reason: 'not-found',
    });
    const bad = await store.readById(fakeClient({ data: {}, error: null }).client, 'x');
    expect(bad.ok).toBe(false);
  });

  it('write is a validation gate: invalid never touches the DB', async () => {
    const okc = fakeClient({ data: null, error: null });
    expect(await store.write(okc.client, { name: 'A' })).toEqual({ ok: true, item: { name: 'A' } });
    expect(okc.upsertSpy).toHaveBeenCalledOnce();

    const badc = fakeClient({ data: null, error: null });
    const res = await store.write(badc.client, {});
    expect(res.ok).toBe(false);
    expect(badc.upsertSpy).not.toHaveBeenCalled();
  });
});

describe('entity stores wire the right core coerce', () => {
  it('ancestryStore coerces a real ancestry row and reports an invalid one', () => {
    const { items, invalid } = ancestryStore.partition([
      {
        name: 'Dwarf', source: 'Player Core pg. 43', hp: 10, size: 'medium', speed: 20,
        boosts: ['con', 'wis', 'free'], flaws: ['cha'], languages: ['Common'], description: 'A stocky people.',
      },
      { name: 'Broken' }, // missing hp/size/speed/description
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]?.name).toBe('Dwarf');
    expect(invalid).toHaveLength(1);
    expect(invalid[0]?.id).toBeUndefined();
  });

  it('heritageStore and backgroundStore point at the right tables', () => {
    expect(heritageStore.table).toBe('heritages');
    expect(backgroundStore.table).toBe('backgrounds');
    const b = backgroundStore.partition([
      { name: 'Acrobat', source: 'Player Core pg. 84', boosts: [['str', 'dex'], 'free'], description: 'x' },
    ]);
    expect(b.items[0]?.name).toBe('Acrobat');
  });
});
