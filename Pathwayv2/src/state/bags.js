// ── state/bags.js ────────────────────────────────────────────────────────────
// Inventory: one bag per user, normalized into bags + bag_items.
//
// bags        — metadata (bag_name), keyed by user_id (1:1 with users).
// bag_items   — many rows per user, each one item (category + qty + name +
//               references to items.id / homebrew_entries.id / custom_name).
//
// Phase 2: this module owns the in-memory cache + TWO Realtime subscriptions
// (bags and bag_items). Cache shape mirrors the legacy in-memory format:
//   { [discordId]: { bagName, categories: { [cat]: [{name, qty}] } } }
//
// Realtime strategy for bag_items: any INSERT / UPDATE / DELETE event for a
// user triggers a re-fetch of that user's full bag_items and rebuilds the
// `categories` map. This is simpler than patching the cache in-place (which
// would require us to track per-item ids in the cache shape) and the per-user
// query is small. Bursts of events on the same user are coalesced via a Set
// + setImmediate so a multi-item "save inventory" from the web hits Supabase
// once per burst, not N times.

const { getSupabase } = require('../lib/supabase');
const { _recordSyncSuccess, _recordSyncFailure } = require('../lib/syncTracker');
const { buildDiscordToUserMap } = require('../lib/userMap');

// ── In-memory cache ────────────────────────────────────────────────────────
let _cache = null;
let _ready = false;
const _pendingEvents = [];
// Supabase user_id (UUID) → discord_id lookup. Also reverse for refreshing.
let _userIdToDiscordId = {};
let _discordIdToUserId = {};
// Coalesce bag_items refreshes per user_id within the same tick.
const _pendingUserRefresh = new Set();

function _ensureCache() {
  if (_cache === null) _cache = {};
  return _cache;
}

// ── Accessors ──────────────────────────────────────────────────────────────

function getAll() { return _ensureCache(); }
function get(discordId) { return _ensureCache()[discordId] ?? null; }

// Bulk save — used by the delegation in index.js (loadBags/saveBags).
async function saveAll(map) {
  _cache = map || {};
  await syncAllBagsToSupabase(_cache);
}

// ── Sync helpers (Phase 1 — kept) ──────────────────────────────────────────

// Flatten a userBag into [{category, name, qty, sortOrder}].
function flattenBagEntries(userBag) {
  const entries = [];
  let sortOrder = 0;
  for (const [category, items] of Object.entries(userBag.categories ?? {})) {
    for (const raw of (Array.isArray(items) ? items : [])) {
      const entry = typeof raw === 'string' ? { name: raw, qty: 1 } : raw;
      if (!entry?.name) continue;
      entries.push({
        category,
        name:      String(entry.name).trim(),
        qty:       Math.max(1, Number(entry.qty) || 1),
        sortOrder: sortOrder++,
      });
    }
  }
  return entries;
}

// Resolve item names → Supabase UUIDs in batch.
async function resolveItemNames(sb, names) {
  const uniqueNames = [...new Set(names)];
  const itemIdByNameLower     = {};
  const homebrewIdByNameLower = {};
  if (uniqueNames.length === 0) return { itemIdByNameLower, homebrewIdByNameLower };

  const { data: officialMatches } = await sb
    .from('items')
    .select('id, name')
    .in('name', uniqueNames);
  for (const row of officialMatches ?? []) {
    itemIdByNameLower[row.name.toLowerCase()] = row.id;
  }

  const unresolved = uniqueNames.filter(n => !itemIdByNameLower[n.toLowerCase()]);
  if (unresolved.length > 0) {
    const { data: homebrewMatches } = await sb
      .from('homebrew_entries')
      .select('id, name')
      .eq('type', 'item')
      .in('name', unresolved);
    for (const row of homebrewMatches ?? []) {
      homebrewIdByNameLower[row.name.toLowerCase()] = row.id;
    }
  }

  return { itemIdByNameLower, homebrewIdByNameLower };
}

function buildBagItemRows(userId, entries, itemIdByNameLower, homebrewIdByNameLower) {
  return entries.map(e => {
    const nl        = e.name.toLowerCase();
    const itemId    = itemIdByNameLower[nl]     ?? null;
    const homebrewId = homebrewIdByNameLower[nl] ?? null;
    return {
      user_id:      userId,
      category:     e.category,
      item_id:      itemId,
      homebrew_id:  homebrewId,
      custom_name:  (!itemId && !homebrewId) ? e.name : null,
      display_name: e.name,
      quantity:     e.qty,
      sort_order:   e.sortOrder,
    };
  });
}

async function syncBagToSupabase(discordId, userBag) {
  try {
    const sb = getSupabase();
    if (!sb) return;
    const { data: userRow } = await sb.from('users').select('id').eq('discord_id', discordId).single();
    if (!userRow) return;
    const userId = userRow.id;

    await sb.from('bags').upsert({
      user_id:    userId,
      bag_name:   userBag.bagName ?? 'Bag 1',
      categories: {},   // deprecated; kept empty for schema compat during cutover
    }, { onConflict: 'user_id' });

    const entries = flattenBagEntries(userBag);
    await sb.from('bag_items').delete().eq('user_id', userId);

    if (entries.length > 0) {
      const { itemIdByNameLower, homebrewIdByNameLower } =
        await resolveItemNames(sb, entries.map(e => e.name));
      const rows = buildBagItemRows(userId, entries, itemIdByNameLower, homebrewIdByNameLower);
      const { error } = await sb.from('bag_items').insert(rows);
      if (error) throw error;
    }

    // Update cache so reads immediately reflect the change. (Without this,
    // the cache would only get the change after Realtime delivers the
    // INSERT/DELETE events — a small race window.)
    _ensureCache()[discordId] = userBag;
  } catch (err) {
    console.error('[Supabase] bag sync failed:', err.message);
  }
}

async function syncAllBagsToSupabase(bags) {
  try {
    const sb = getSupabase();
    if (!sb || !bags) return;
    const discordIds = Object.keys(bags).filter(k => /^\d+$/.test(k));
    if (discordIds.length === 0) return;
    const userMap = await buildDiscordToUserMap(sb, discordIds);

    const bagUpserts = [];
    for (const [discordId, userBag] of Object.entries(bags)) {
      const userId = userMap[discordId];
      if (!userId || !userBag) continue;
      bagUpserts.push({ user_id: userId, bag_name: userBag.bagName ?? 'Bag 1', categories: {} });
    }
    if (bagUpserts.length === 0) return;
    const { error: bagErr } = await sb.from('bags').upsert(bagUpserts, { onConflict: 'user_id' });
    if (bagErr) throw bagErr;

    const allEntries = [];
    const affectedUserIds = [];
    for (const [discordId, userBag] of Object.entries(bags)) {
      const userId = userMap[discordId];
      if (!userId || !userBag) continue;
      affectedUserIds.push(userId);
      const flat = flattenBagEntries(userBag);
      for (const e of flat) allEntries.push({ ...e, userId });
    }

    if (affectedUserIds.length > 0) {
      const { error: delErr } = await sb.from('bag_items').delete().in('user_id', affectedUserIds);
      if (delErr) throw delErr;
    }

    if (allEntries.length > 0) {
      const allNames = [...new Set(allEntries.map(e => e.name))];
      const { itemIdByNameLower, homebrewIdByNameLower } = await resolveItemNames(sb, allNames);

      const rows = [];
      for (const e of allEntries) {
        const nameLower = e.name.toLowerCase();
        rows.push({
          user_id:      e.userId,
          category:     e.category,
          display_name: e.name,
          quantity:     e.qty,
          sort_order:   e.sortOrder,
          item_id:      itemIdByNameLower[nameLower] ?? null,
          homebrew_id:  homebrewIdByNameLower[nameLower] ?? null,
          custom_name:  (!itemIdByNameLower[nameLower] && !homebrewIdByNameLower[nameLower]) ? e.name : null,
        });
      }
      const { error: insErr } = await sb.from('bag_items').insert(rows);
      if (insErr) throw insErr;
    }

    _recordSyncSuccess();
  } catch (err) {
    _recordSyncFailure();
    console.error('[Supabase] bags full sync failed:', err.message);
  }
}

// ── Realtime ───────────────────────────────────────────────────────────────

function subscribe(sb) {
  if (!sb) {
    console.warn('[state/bags:realtime] Supabase not available — live sync disabled');
    return;
  }

  // bags table — bag_name (and the legacy categories column) changes.
  sb.channel('state-bags-meta')
    .on('postgres_changes', {
      event:  '*',
      schema: 'public',
      table:  'bags',
    }, (payload) => {
      const apply = () => _applyBagsEvent(payload);
      if (_ready) apply();
      else _pendingEvents.push(apply);
    })
    .subscribe((status, err) => {
      if (err) console.error('[state/bags:realtime meta] subscription error:', err.message);
      else console.log(`[state/bags:realtime meta] ${status}`);
    });

  // bag_items table — actual inventory rows. Each event triggers a coalesced
  // refresh of that user's items (a multi-row save burst becomes one fetch).
  sb.channel('state-bag-items')
    .on('postgres_changes', {
      event:  '*',
      schema: 'public',
      table:  'bag_items',
    }, (payload) => {
      const apply = () => _applyBagItemsEvent(payload);
      if (_ready) apply();
      else _pendingEvents.push(apply);
    })
    .subscribe((status, err) => {
      if (err) console.error('[state/bags:realtime items] subscription error:', err.message);
      else console.log(`[state/bags:realtime items] ${status}`);
    });
}

function _applyBagsEvent(payload) {
  try {
    const event = payload.eventType ?? payload.type;
    const cache = _ensureCache();

    if (event === 'DELETE') {
      const row = payload.old;
      const discordId = _userIdToDiscordId[row.user_id];
      if (!discordId) return;
      delete cache[discordId];
      console.log(`[state/bags:realtime meta] - ${discordId}`);
      return;
    }

    const row = payload.new;
    const discordId = _userIdToDiscordId[row.user_id];
    if (!discordId) return;
    if (!cache[discordId]) cache[discordId] = { bagName: row.bag_name ?? 'Bag 1', categories: {} };
    else cache[discordId].bagName = row.bag_name ?? 'Bag 1';
    console.log(`[state/bags:realtime meta] ${event === 'INSERT' ? '+' : '~'} ${discordId} (bagName)`);
  } catch (e) {
    console.error('[state/bags:realtime meta] handler error:', e.message);
  }
}

function _applyBagItemsEvent(payload) {
  try {
    // Find the user_id on whichever row is present (INSERT/UPDATE have .new,
    // DELETE has .old with REPLICA IDENTITY FULL).
    const userId = payload.new?.user_id ?? payload.old?.user_id;
    if (!userId) return;
    _scheduleUserRefresh(userId);
  } catch (e) {
    console.error('[state/bags:realtime items] handler error:', e.message);
  }
}

// Coalesce bursts of bag_items events for the same user into a single
// Supabase fetch. setImmediate schedules onto the NEXT tick — any events
// dispatched in the current tick merge into one refresh.
function _scheduleUserRefresh(userId) {
  if (_pendingUserRefresh.has(userId)) return;
  _pendingUserRefresh.add(userId);
  setImmediate(() => {
    _pendingUserRefresh.delete(userId);
    _refreshUserBagItems(userId).catch(err => {
      console.error('[state/bags:realtime] refresh failed for user', userId, '-', err.message);
    });
  });
}

async function _refreshUserBagItems(userId) {
  const sb = getSupabase();
  if (!sb) return;
  const discordId = _userIdToDiscordId[userId];
  if (!discordId) return;

  const { data: items, error } = await sb
    .from('bag_items')
    .select('category, display_name, quantity, sort_order')
    .eq('user_id', userId)
    .order('sort_order', { ascending: true });
  if (error) {
    console.error('[state/bags:realtime] refetch failed for user', discordId, '-', error.message);
    return;
  }

  const categories = {};
  for (const item of items ?? []) {
    const cat = item.category ?? 'General';
    if (!categories[cat]) categories[cat] = [];
    categories[cat].push({ name: item.display_name, qty: item.quantity ?? 1 });
  }

  const cache = _ensureCache();
  if (!cache[discordId]) cache[discordId] = { bagName: 'Bag 1', categories };
  else cache[discordId].categories = categories;
  console.log(`[state/bags:realtime items] ~ ${discordId} (${items?.length ?? 0} items)`);
}

// ── Restore ────────────────────────────────────────────────────────────────

async function restore(sb, { bySupabaseId, byDiscordId }, diskBags = {}) {
  if (!sb) {
    _ready = true;
    _drainPending();
    return _ensureCache();
  }

  const { data: bagRows, error: bagErr } = await sb
    .from('bags')
    .select('user_id, bag_name');
  if (bagErr) throw bagErr;

  const { data: bagItemRows, error: biErr } = await sb
    .from('bag_items')
    .select('user_id, category, display_name, quantity, sort_order')
    .order('sort_order', { ascending: true });
  if (biErr) throw biErr;

  _userIdToDiscordId = { ...bySupabaseId };
  _discordIdToUserId = { ...byDiscordId };

  const cache = _ensureCache();
  Object.assign(cache, diskBags);

  // Index bag_items by user_id
  const itemsByUserId = {};
  for (const item of bagItemRows ?? []) {
    if (!itemsByUserId[item.user_id]) itemsByUserId[item.user_id] = [];
    itemsByUserId[item.user_id].push(item);
  }

  // Pull Supabase rows in (Supabase wins on conflict)
  const bagsInSupabase = new Set();
  for (const row of bagRows ?? []) {
    const discordId = bySupabaseId[row.user_id];
    if (!discordId) continue;
    bagsInSupabase.add(discordId);

    const categories = {};
    for (const item of itemsByUserId[row.user_id] ?? []) {
      const cat = item.category ?? 'General';
      if (!categories[cat]) categories[cat] = [];
      categories[cat].push({ name: item.display_name, qty: item.quantity ?? 1 });
    }
    cache[discordId] = { bagName: row.bag_name ?? 'Bag 1', categories };
  }

  // Backfill disk-only bags into Supabase.
  let backfilled = 0;
  for (const [discordId, userBag] of Object.entries(diskBags)) {
    if (bagsInSupabase.has(discordId)) continue;
    const supabaseUserId = byDiscordId[discordId];
    if (!supabaseUserId) continue;

    const { error: uErr } = await sb.from('bags').upsert({
      user_id:    supabaseUserId,
      bag_name:   userBag.bagName ?? 'Bag 1',
      categories: {},
    }, { onConflict: 'user_id' });
    if (uErr) { console.error(`[Supabase] bag backfill failed for ${discordId}:`, uErr.message); continue; }

    const entries = flattenBagEntries(userBag);
    if (entries.length > 0) {
      const { itemIdByNameLower, homebrewIdByNameLower } =
        await resolveItemNames(sb, entries.map(e => e.name));
      const rows = buildBagItemRows(supabaseUserId, entries, itemIdByNameLower, homebrewIdByNameLower);
      const { error: biUErr } = await sb.from('bag_items').insert(rows);
      if (biUErr) console.error(`[Supabase] bag_items backfill failed for ${discordId}:`, biUErr.message);
    }
    backfilled++;
  }

  _ready = true;
  _drainPending();

  console.log(`[Supabase] restore: loaded ${bagRows?.length ?? 0} bags (backfilled ${backfilled} new)`);
  return cache;
}

function _drainPending() {
  if (_pendingEvents.length === 0) return;
  console.log(`[state/bags:realtime] draining ${_pendingEvents.length} queued event(s) after restore`);
  for (const apply of _pendingEvents) apply();
  _pendingEvents.length = 0;
}

module.exports = {
  // Phase 2 surface
  getAll,
  get,
  saveAll,
  restore,
  subscribe,

  // Phase 1 compat
  syncBagToSupabase,
  syncAllBagsToSupabase,
  flattenBagEntries,
  resolveItemNames,
  buildBagItemRows,
};
