// Spell queries — the first slice of the core↔db seam.
//
// db's whole job is validation-at-the-edge: rows come out of Supabase as untyped
// JSON, and we parse them into core's canonical `Spell` through `coerceSpell`
// right here at the boundary, so nothing downstream ever sees an unvalidated
// spell. This is the read half of what replaces apps/web's defensive rules/api.ts
// mapper and the bot's spell/embed.js normalizer.
//
// The Supabase client is INJECTED, not created here — the web app (anon client)
// and the bot (service client) each already own one, and db must not duplicate
// their env/secret handling. The pure `partitionSpells` holds the coerce logic so
// it's testable without a database.

import { coerceSpell, type Spell } from '@pathway/core';
import type { SupabaseClient } from '@supabase/supabase-js';

/** The Supabase table backing spells. */
export const SPELLS_TABLE = 'spells';

/** A stored row that failed to coerce — the signal the coverage audit consumes. */
export interface InvalidSpellRow {
  /** The row's id if it had one, so a failure can be traced back to a record. */
  id?: string;
  issues: string[];
}

export interface ReadSpellsResult {
  spells: Spell[];
  /** Rows that did not validate. Empty when every row coerced cleanly. */
  invalid: InvalidSpellRow[];
  /** Set only when the query itself failed (network/permission). */
  error?: string;
}

export type ReadSpellResult =
  | { ok: true; spell: Spell }
  | { ok: false; reason: 'not-found' }
  | { ok: false; reason: 'invalid'; issues: string[] }
  | { ok: false; reason: 'error'; message: string };

export type WriteSpellResult =
  | { ok: true; spell: Spell }
  | { ok: false; reason: 'invalid'; issues: string[] }
  | { ok: false; reason: 'error'; message: string };

function readId(row: unknown): string | undefined {
  if (row && typeof row === 'object' && 'id' in row) {
    const id = (row as Record<string, unknown>).id;
    if (typeof id === 'string') return id;
    if (typeof id === 'number') return String(id);
  }
  return undefined;
}

/**
 * Coerce a batch of raw rows into canonical spells, partitioning the failures.
 * Pure — the boundary logic, unit-tested without Supabase. A failed row does not
 * abort the batch; it lands in `invalid` so one bad record can't hide the rest.
 */
export function partitionSpells(rows: unknown[]): { spells: Spell[]; invalid: InvalidSpellRow[] } {
  const spells: Spell[] = [];
  const invalid: InvalidSpellRow[] = [];
  for (const row of rows) {
    const res = coerceSpell(row);
    if (res.ok) spells.push(res.spell);
    else invalid.push({ id: readId(row), issues: res.issues });
  }
  return { spells, invalid };
}

/** Fetch one spell by id and parse it into the canonical shape at the boundary. */
export async function readSpellById(client: SupabaseClient, id: string): Promise<ReadSpellResult> {
  const { data, error } = await client.from(SPELLS_TABLE).select('*').eq('id', id).maybeSingle();
  if (error) return { ok: false, reason: 'error', message: error.message };
  if (!data) return { ok: false, reason: 'not-found' };
  const res = coerceSpell(data);
  return res.ok ? { ok: true, spell: res.spell } : { ok: false, reason: 'invalid', issues: res.issues };
}

/**
 * Fetch spells (optionally name-filtered) and coerce them, surfacing any rows
 * that fail validation in `invalid` rather than throwing.
 */
export async function readSpells(
  client: SupabaseClient,
  opts: { search?: string; limit?: number } = {},
): Promise<ReadSpellsResult> {
  let query = client.from(SPELLS_TABLE).select('*');
  const search = opts.search?.trim();
  if (search) {
    // Escape LIKE metacharacters so the user's text matches literally.
    query = query.ilike('name', `%${search.replace(/[\\%_]/g, '\\$&')}%`);
  }
  query = query.limit(opts.limit ?? 100);

  const { data, error } = await query;
  if (error) return { spells: [], invalid: [], error: error.message };
  return partitionSpells((data ?? []) as unknown[]);
}

/**
 * Validate a spell and persist it only if it coerces. On failure the DB is never
 * touched — this is the write-side rejection gate. On success the caller's row is
 * upserted as provided; remapping storage to the canonical shape is a later
 * migration decision (informed by the coverage audit), deliberately not here.
 */
export async function writeSpell(client: SupabaseClient, raw: unknown): Promise<WriteSpellResult> {
  const coerced = coerceSpell(raw);
  if (!coerced.ok) return { ok: false, reason: 'invalid', issues: coerced.issues };

  const { error } = await client.from(SPELLS_TABLE).upsert(raw as Record<string, unknown>);
  if (error) return { ok: false, reason: 'error', message: error.message };
  return { ok: true, spell: coerced.spell };
}
