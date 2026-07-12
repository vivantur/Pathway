// Tests for Plan B write-diffing in src/state/characters.js — saveAll should
// push only the characters whose persisted payload actually changed, so a
// single-character edit no longer re-syncs every character (which blew Discord's
// 3s interaction window → 10062 Unknown interaction).

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { _selectChangedUpserts } = require('../src/state/characters');

const row = (userId, charKey, extra = {}) => ({ user_id: userId, char_key: charKey, name: charKey, ...extra });

function seed(upserts) {
  const hashes = new Map();
  for (const r of upserts) hashes.set(`${r.user_id}:${r.char_key}`, JSON.stringify(r));
  return hashes;
}

describe('_selectChangedUpserts (Plan B write-diffing)', () => {
  it('selects everything on the first sync (empty hash map)', () => {
    const upserts = [row('u1', 'aria'), row('u1', 'brand'), row('u2', 'cleo')];
    const { changed, updatedHashes } = _selectChangedUpserts(upserts, new Map());
    expect(changed).toHaveLength(3);
    expect(updatedHashes).toHaveLength(3);
  });

  it('selects nothing when nothing changed', () => {
    const upserts = [row('u1', 'aria'), row('u2', 'cleo')];
    const { changed } = _selectChangedUpserts(upserts, seed(upserts));
    expect(changed).toHaveLength(0);
  });

  it('selects only the character whose payload changed', () => {
    const before = [row('u1', 'aria', { level: 3 }), row('u1', 'brand', { level: 5 })];
    const hashes = seed(before);
    // aria levels up; brand unchanged
    const after = [row('u1', 'aria', { level: 4 }), row('u1', 'brand', { level: 5 })];
    const { changed } = _selectChangedUpserts(after, hashes);
    expect(changed).toHaveLength(1);
    expect(changed[0].char_key).toBe('aria');
  });

  it('keys by user_id + char_key so the same char_key under different users is distinct', () => {
    const upserts = [row('u1', 'aria', { level: 1 }), row('u2', 'aria', { level: 9 })];
    const hashes = new Map();
    hashes.set('u1:aria', JSON.stringify(upserts[0])); // only u1's aria is known
    const { changed } = _selectChangedUpserts(upserts, hashes);
    expect(changed).toHaveLength(1);
    expect(changed[0].user_id).toBe('u2');
  });

  it('reports updated hashes only for the changed rows', () => {
    const upserts = [row('u1', 'aria', { level: 2 })];
    const { updatedHashes } = _selectChangedUpserts(upserts, new Map());
    expect(updatedHashes).toHaveLength(1);
    expect(updatedHashes[0][0]).toBe('u1:aria');
    expect(updatedHashes[0][1]).toBe(JSON.stringify(upserts[0]));
  });
});
