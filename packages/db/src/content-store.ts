// Generic content-store factory — the reusable core↔db seam for any content entity.
//
// Every content entity (ancestries, heritages, backgrounds, feats, …) needs the
// same thing spells got: read rows and parse them into the canonical shape via
// core's coerceX at the boundary, partitioning failures; and validate-on-write.
// Rather than copy that per entity, `makeContentStore(table, coerce)` builds it.
//
// (The spell store predates this and still hand-rolls the same logic; a cleanup
// can point it here too.)

import type { SupabaseClient } from '@supabase/supabase-js';

/** A stored row that failed to coerce — the signal a coverage audit consumes. */
export interface InvalidRow {
  id?: string;
  issues: string[];
}

export interface ReadManyResult<T> {
  items: T[];
  invalid: InvalidRow[];
  error?: string;
}

export type ReadOneResult<T> =
  | { ok: true; item: T }
  | { ok: false; reason: 'not-found' }
  | { ok: false; reason: 'invalid'; issues: string[] }
  | { ok: false; reason: 'error'; message: string };

export type WriteResult<T> =
  | { ok: true; item: T }
  | { ok: false; reason: 'invalid'; issues: string[] }
  | { ok: false; reason: 'error'; message: string };

/** Uniform coerce shape the factory consumes (wrap each core coerceX into this). */
export type Coerce<T> = (raw: unknown) => { ok: true; item: T } | { ok: false; issues: string[] };

function readId(row: unknown): string | undefined {
  if (row && typeof row === 'object' && 'id' in row) {
    const id = (row as Record<string, unknown>).id;
    if (typeof id === 'string') return id;
    if (typeof id === 'number') return String(id);
  }
  return undefined;
}

export interface ContentStore<T> {
  readonly table: string;
  /** Pure: coerce a batch, partitioning failures. Testable without a database. */
  partition(rows: unknown[]): { items: T[]; invalid: InvalidRow[] };
  readById(client: SupabaseClient, id: string): Promise<ReadOneResult<T>>;
  readMany(client: SupabaseClient, opts?: { search?: string; limit?: number }): Promise<ReadManyResult<T>>;
  /** Validation gate: coerce first; on failure never touch the DB. */
  write(client: SupabaseClient, raw: unknown): Promise<WriteResult<T>>;
}

export function makeContentStore<T>(table: string, coerce: Coerce<T>): ContentStore<T> {
  function partition(rows: unknown[]): { items: T[]; invalid: InvalidRow[] } {
    const items: T[] = [];
    const invalid: InvalidRow[] = [];
    for (const row of rows) {
      const res = coerce(row);
      if (res.ok) items.push(res.item);
      else invalid.push({ id: readId(row), issues: res.issues });
    }
    return { items, invalid };
  }

  async function readById(client: SupabaseClient, id: string): Promise<ReadOneResult<T>> {
    const { data, error } = await client.from(table).select('*').eq('id', id).maybeSingle();
    if (error) return { ok: false, reason: 'error', message: error.message };
    if (!data) return { ok: false, reason: 'not-found' };
    const res = coerce(data);
    return res.ok ? { ok: true, item: res.item } : { ok: false, reason: 'invalid', issues: res.issues };
  }

  async function readMany(
    client: SupabaseClient,
    opts: { search?: string; limit?: number } = {},
  ): Promise<ReadManyResult<T>> {
    let query = client.from(table).select('*');
    const search = opts.search?.trim();
    if (search) query = query.ilike('name', `%${search.replace(/[\\%_]/g, '\\$&')}%`);
    query = query.limit(opts.limit ?? 100);
    const { data, error } = await query;
    if (error) return { items: [], invalid: [], error: error.message };
    return partition((data ?? []) as unknown[]);
  }

  async function write(client: SupabaseClient, raw: unknown): Promise<WriteResult<T>> {
    const res = coerce(raw);
    if (!res.ok) return { ok: false, reason: 'invalid', issues: res.issues };
    const { error } = await client.from(table).upsert(raw as Record<string, unknown>);
    if (error) return { ok: false, reason: 'error', message: error.message };
    return { ok: true, item: res.item };
  }

  return { table, partition, readById, readMany, write };
}
