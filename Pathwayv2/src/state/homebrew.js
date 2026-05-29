// ── state/homebrew.js ────────────────────────────────────────────────────────
// User-added monsters, spells, and items (the /homebrew command suite).
//
// Stored in `homebrew_entries` keyed by (type, entry_key). The `data` column
// holds the full statblock as JSONB. Inserts add to the relevant in-memory
// reference database (bestiary/spells/items) at runtime via the Realtime
// subscription below.
//
// This module has ALREADY had Realtime since before Phase 1 — the
// setupHomebrewRealtimeSync function lives here. It's the proven template
// the other state modules will follow when they gain Realtime in Phase 2.

const { getSupabase } = require('../lib/supabase');

// ── Write helpers ──────────────────────────────────────────────────────────

async function syncHomebrewEntryToSupabase(type, entryKey, entry) {
  try {
    const sb = getSupabase();
    if (!sb) return;
    const { error } = await sb.from('homebrew_entries').upsert({
      type,
      entry_key: entryKey,
      name:      entry.name,
      data:      entry,
      added_by:  entry._addedBy ?? null,
    }, { onConflict: 'type,entry_key' });
    if (error) throw error;
  } catch (err) {
    console.error('[Supabase] homebrew sync failed:', err.message);
  }
}

async function deleteHomebrewEntryFromSupabase(type, entryKey) {
  try {
    const sb = getSupabase();
    if (!sb) return;
    const { error } = await sb.from('homebrew_entries').delete()
      .eq('type', type).eq('entry_key', entryKey);
    if (error) throw error;
  } catch (err) {
    console.error('[Supabase] homebrew delete failed:', err.message);
  }
}

// ── Realtime sync ──────────────────────────────────────────────────────────
//
// Subscribes to Supabase Realtime postgres_changes on homebrew_entries.
// INSERT events immediately splice the entry into the relevant in-memory
// database; DELETE events remove it. Both mutations happen in-place so
// existing closures throughout index.js see the change immediately.
//
// Requires REPLICA IDENTITY FULL on homebrew_entries (migration applied)
// so DELETE payloads include all columns, not just the primary key.
//
// Call once after restoreAllFromSupabase() + reloadDatabasesAfterRestore().

function setupHomebrewRealtimeSync({ bestiaryDatabase, spellDatabase, itemDatabase }) {
  const sb = getSupabase();
  if (!sb) {
    console.warn('[homebrew:realtime] Supabase not available — live sync disabled');
    return;
  }

  function normalize(s) {
    return (s ?? '').toLowerCase().trim();
  }

  sb.channel('homebrew-live')
    .on('postgres_changes', {
      event:  'INSERT',
      schema: 'public',
      table:  'homebrew_entries',
    }, (payload) => {
      const { type, entry_key, name, data } = payload.new;
      try {
        if (type === 'monster') {
          bestiaryDatabase[entry_key] = { name, ...data };
          console.log(`[homebrew:realtime] + monster "${name}" (${entry_key})`);

        } else if (type === 'spell') {
          const entry = { name, ...data };
          const idx = spellDatabase.findIndex(
            s => normalize(s.name) === normalize(name) && s._homebrew
          );
          if (idx >= 0) spellDatabase.splice(idx, 1, entry);
          else spellDatabase.push(entry);
          console.log(`[homebrew:realtime] + spell "${name}"`);

        } else if (type === 'item') {
          const entry = { id: entry_key, name, ...data };
          const idx = itemDatabase.findIndex(i => i.id === entry_key);
          if (idx >= 0) itemDatabase.splice(idx, 1, entry);
          else itemDatabase.push(entry);
          console.log(`[homebrew:realtime] + item "${name}" (${entry_key})`);
        }
      } catch (err) {
        console.error(`[homebrew:realtime] INSERT handler error:`, err.message);
      }
    })
    .on('postgres_changes', {
      event:  'UPDATE',
      schema: 'public',
      table:  'homebrew_entries',
    }, (payload) => {
      const { type, entry_key, name, data } = payload.new;
      // For spells the in-memory lookup is by name, not entry_key — use
      // payload.old.name so a rename still finds and replaces the right entry.
      const oldName = payload.old?.name ?? name;
      try {
        if (type === 'monster') {
          // entry_key never changes on PATCH; replace in-place by key
          bestiaryDatabase[entry_key] = { name, ...data };
          console.log(`[homebrew:realtime] ~ monster "${name}" (${entry_key})`);

        } else if (type === 'spell') {
          const entry = { name, ...data };
          // First try to find by old name (handles renames)
          const byOldName = spellDatabase.findIndex(
            s => normalize(s.name) === normalize(oldName) && s._homebrew
          );
          if (byOldName >= 0) {
            spellDatabase.splice(byOldName, 1, entry);
          } else {
            // Fall back to new name in case of partial state
            const byNewName = spellDatabase.findIndex(
              s => normalize(s.name) === normalize(name) && s._homebrew
            );
            if (byNewName >= 0) spellDatabase.splice(byNewName, 1, entry);
            else spellDatabase.push(entry);
          }
          console.log(`[homebrew:realtime] ~ spell "${name}"`);

        } else if (type === 'item') {
          const entry = { id: entry_key, name, ...data };
          const idx = itemDatabase.findIndex(i => i.id === entry_key);
          if (idx >= 0) itemDatabase.splice(idx, 1, entry);
          else itemDatabase.push(entry);
          console.log(`[homebrew:realtime] ~ item "${name}" (${entry_key})`);
        }
      } catch (err) {
        console.error(`[homebrew:realtime] UPDATE handler error:`, err.message);
      }
    })
    .on('postgres_changes', {
      event:  'DELETE',
      schema: 'public',
      table:  'homebrew_entries',
    }, (payload) => {
      const { type, entry_key, name } = payload.old;
      try {
        if (type === 'monster') {
          delete bestiaryDatabase[entry_key];
          console.log(`[homebrew:realtime] - monster "${name}" (${entry_key})`);

        } else if (type === 'spell') {
          const idx = spellDatabase.findIndex(
            s => normalize(s.name) === normalize(name) && s._homebrew
          );
          if (idx >= 0) {
            spellDatabase.splice(idx, 1);
            console.log(`[homebrew:realtime] - spell "${name}"`);
          }

        } else if (type === 'item') {
          const idx = itemDatabase.findIndex(i => i.id === entry_key);
          if (idx >= 0) {
            itemDatabase.splice(idx, 1);
            console.log(`[homebrew:realtime] - item "${name}" (${entry_key})`);
          }
        }
      } catch (err) {
        console.error(`[homebrew:realtime] DELETE handler error:`, err.message);
      }
    })
    .subscribe((status, err) => {
      if (err) {
        console.error('[homebrew:realtime] subscription error:', err.message);
      } else {
        console.log(`[homebrew:realtime] ${status}`);
      }
    });
}

module.exports = {
  syncHomebrewEntryToSupabase,
  deleteHomebrewEntryFromSupabase,
  setupHomebrewRealtimeSync,
};
