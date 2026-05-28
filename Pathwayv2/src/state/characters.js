// ── state/characters.js ──────────────────────────────────────────────────────
//
// Stored in `characters` keyed by (user_id, char_key) with `status = 'active'`.
// The full Pathbuilder JSON lives in `pathbuilder_data`. Bot-only runtime
// state (HP, dying, wounded, hero points, sense overrides, edits, etc.)
// is split between dedicated columns and an `overlay` JSONB column.
//
// The overlay column is a co-tenant between bot and web app: the web app
// reserves its own keys, the bot reserves `pathway_bot_state`. Both sides
// are careful to read-modify-write only their own key so neither clobbers
// the other.
//
// Phase 2: this module OWNS the cache + Realtime. Companions are still
// nested inside each character entry as `.companions[compKey]` — they are
// hydrated from Supabase by this module's restore() but mutated via
// Realtime by state/companions.

const { getSupabase } = require('../lib/supabase');
const { _trackSync, _recordSyncSuccess, _recordSyncFailure } = require('../lib/syncTracker');

const CHARACTER_BOT_STATE_OVERLAY_KEY = 'pathway_bot_state';

// ── In-memory cache ────────────────────────────────────────────────────────
//
// Shape: { [discordId]: { [charKey]: charEntry, _activeChar?: 'someKey' } }
// charEntry: { name, data, hp, overlay, dying, wounded, heroPoints, guildId,
//              art, saved, companions?, activeCompanion?, ...bot-state-from-overlay }
let _cache = null;
let _ready = false;
const _pendingEvents = [];
let _userIdToDiscordId = {};
// Freshness key: `${discordId}:${charKey}` → row.updated_at
const _rowUpdatedAt = Object.create(null);

// ── Username cache ─────────────────────────────────────────────────────────
// Records Discord usernames captured from interactionCreate. Used by
// syncAllCharactersToSupabase to auto-create a users row for Discord-only
// users on their first character save. Index.js calls rememberUsername()
// from interactionCreate; saveAll() reads it implicitly.
const _usernameCache = new Map();

function rememberUsername(discordId, username) {
  if (!discordId || !username) return;
  _usernameCache.set(String(discordId), String(username));
}

// ── Storage limits ─────────────────────────────────────────────────────────
const MAX_CHARACTERS_PER_USER = 20;

function _ensureCache() {
  if (_cache === null) _cache = {};
  return _cache;
}

function _freshKey(discordId, charKey) {
  return `${discordId}:${charKey}`;
}

// ── Overlay shape helpers ──────────────────────────────────────────────────
//
// The bot owns one nested key (`pathway_bot_state`) inside the overlay JSONB
// column. `buildCharacterOverlayForSupabase` packs the in-memory character
// entry's bot-only fields into that key; `applyCharacterBotState` is the
// inverse, used when restoring or applying a Realtime event.

function buildCharacterOverlayForSupabase(charEntry) {
  const overlay = {
    ...((charEntry?.overlay && typeof charEntry.overlay === 'object' && !Array.isArray(charEntry.overlay))
      ? charEntry.overlay
      : {}),
  };
  const botState = {};

  if (charEntry?.edits && typeof charEntry.edits === 'object' && !Array.isArray(charEntry.edits)) botState.edits = charEntry.edits;
  if (charEntry?.senses !== undefined) botState.senses = charEntry.senses;
  if (charEntry?.languages !== undefined) botState.languages = charEntry.languages;
  if (charEntry?.wallet !== undefined) botState.wallet = charEntry.wallet;
  if (charEntry?._hpMaxOverride !== undefined) botState.hpMaxOverride = charEntry._hpMaxOverride;
  if (charEntry?.xpLog !== undefined) botState.xpLog = charEntry.xpLog;
  if (charEntry?.pathwayWebId !== undefined) botState.pathwayWebId = charEntry.pathwayWebId;

  overlay[CHARACTER_BOT_STATE_OVERLAY_KEY] = botState;
  return overlay;
}

function applyCharacterBotState(charEntry, overlay) {
  const botState = overlay?.[CHARACTER_BOT_STATE_OVERLAY_KEY];
  if (!botState || typeof botState !== 'object' || Array.isArray(botState)) return charEntry;

  if (botState.edits && typeof botState.edits === 'object' && !Array.isArray(botState.edits)) charEntry.edits = botState.edits;
  if (botState.senses !== undefined) charEntry.senses = botState.senses;
  if (botState.languages !== undefined) charEntry.languages = botState.languages;
  if (botState.wallet !== undefined) charEntry.wallet = botState.wallet;
  if (botState.hpMaxOverride !== undefined) charEntry._hpMaxOverride = botState.hpMaxOverride;
  if (botState.xpLog !== undefined) charEntry.xpLog = botState.xpLog;
  if (botState.pathwayWebId !== undefined) charEntry.pathwayWebId = botState.pathwayWebId;

  return charEntry;
}

// Convert a Supabase characters row into the bot's in-memory entry shape.
// `existing` is the current cache entry if we're patching one in (preserves
// companions/activeCompanion which come from a different table); when
// building from scratch (INSERT or initial restore) pass undefined.
function _entryFromRow(row, existing) {
  const build = row.pathbuilder_data?.build ?? row.pathbuilder_data;
  if (!build?.name) return null;
  if (row.source) build._pathwaySource = row.source;
  const entry = {
    name:       row.name ?? build.name,
    data:       build,
    hp:         row.current_hp ?? null,
    overlay:    row.overlay ?? {},
    dying:      row.dying ?? 0,
    wounded:    row.wounded ?? 0,
    heroPoints: row.hero_points ?? 1,
    guildId:    row.discord_guild_id ?? null,
    art:        row.art ?? null,
    saved:      new Date().toISOString(),
  };
  applyCharacterBotState(entry, row.overlay ?? {});
  // Preserve companion sub-state managed by state/companions.
  if (existing?.companions)      entry.companions      = existing.companions;
  if (existing?.activeCompanion) entry.activeCompanion = existing.activeCompanion;
  return entry;
}

// ── Accessors ──────────────────────────────────────────────────────────────

function getAll() { return _ensureCache(); }

function get(discordId, charKey) {
  return _ensureCache()[discordId]?.[charKey] ?? null;
}

// ── HP overlay helpers ─────────────────────────────────────────────────────
// Current HP is stored on charEntry.hp as a bot-managed overlay, defaulting
// to max HP from the sheet if not set. Changes are clamped to [0, max].
// Max HP is computed from the Pathbuilder attributes unless _hpMaxOverride
// is set (allows users to fix bad imports or apply homebrew HP rules).
//
// These three are operations on a charEntry object (not on the cache itself)
// so they're pure. They live with state/characters because they encapsulate
// the bot's understanding of how HP is stored in the character entry.

function computeCharMaxHp(charEntry) {
  // Honor a manual override if one is set on the entry. This is used when the
  // import calculation comes out wrong (e.g. PDF imports that don't include
  // every HP source, characters with custom HP rules, etc.). When the override
  // is null/undefined, fall back to computing from ancestry/class/Con/level.
  if (typeof charEntry?._hpMaxOverride === 'number' && charEntry._hpMaxOverride > 0) {
    return charEntry._hpMaxOverride;
  }
  const c = charEntry.data;
  const lvl = c.level ?? 1;
  const conMod = Math.floor(((c.abilities?.con ?? 10) - 10) / 2);
  // PF2e HP formula (matches Pathbuilder's own attribute semantics):
  //   ancestryhp        — flat (level 1 ancestry HP)
  //   bonushp           — flat one-time bonus (e.g. Toughness L1 portion)
  //   classhp           — per-level class HP
  //   bonushpPerLevel   — per-level bonus (e.g. Toughness scaling, ancestry feats)
  //   conMod            — per-level Con bonus
  // Total = ancestryhp + bonushp + (classhp + bonushpPerLevel + conMod) × lvl
  return (c.attributes?.ancestryhp ?? 0) + (c.attributes?.bonushp ?? 0) + (((c.attributes?.classhp ?? 0) + (c.attributes?.bonushpPerLevel ?? 0) + conMod) * lvl);
}

function getCharacterHp(charEntry) {
  const maxHp = computeCharMaxHp(charEntry);
  if (typeof charEntry.hp === 'number') return Math.max(0, Math.min(maxHp, charEntry.hp));
  return maxHp; // no overlay set yet = full HP
}

function setCharacterHp(charEntry, value) {
  const maxHp = computeCharMaxHp(charEntry);
  charEntry.hp = Math.max(0, Math.min(maxHp, Math.floor(value)));
  return charEntry.hp;
}

// ── XP overlay helpers ─────────────────────────────────────────────────────
// `charEntry.xp` is the bot-managed value (incrementally awarded via /xp).
// It wins over the Pathbuilder-exported value so the bot has authoritative
// ownership of XP tracking between sheet rebuilds.

function getCharacterXp(charEntry) {
  if (typeof charEntry.xp === 'number') return charEntry.xp;
  return charEntry.data?.xp ?? 0;
}

function setCharacterXp(charEntry, newValue) {
  charEntry.xp = Math.max(0, Math.floor(newValue));
  return charEntry.xp;
}

// ── Weapons derivation ─────────────────────────────────────────────────────
// Returns the merged weapon list for a character: Pathbuilder weapons +
// Pathway web custom attacks + bot-added attacks. When the same display
// name appears in multiple sources, the later one wins (so a user edit
// trumps the Pathbuilder default). Names listed in edits.hiddenWeapons
// are filtered out entirely.

function _normalizeCharacterDamageType(type) {
  const cleaned = String(type ?? '').trim();
  if (cleaned === 'P') return 'piercing';
  if (cleaned === 'S') return 'slashing';
  if (cleaned === 'B') return 'bludgeoning';
  return cleaned.toLowerCase();
}

function _splitCharacterDamage(damage, fallbackType = '') {
  const raw = String(damage ?? '').trim();
  const fallbackDamageType = _normalizeCharacterDamageType(fallbackType);
  if (!raw) return { die: '1d4', damageType: fallbackDamageType };
  const match = raw.match(/^(\d*d\d+(?:\s*[+-]\s*\d+)?)(?:\s+(.+))?$/i);
  if (!match) return { die: raw, damageType: fallbackDamageType };
  return {
    die: match[1].replace(/\s+/g, ''),
    damageType: match[2] ? _normalizeCharacterDamageType(match[2]) : fallbackDamageType,
  };
}

function _normalizePathwayCustomAttacks(customAttacks) {
  if (!Array.isArray(customAttacks)) return [];
  return customAttacks
    .map((attack) => {
      if (!attack || typeof attack !== 'object') return null;
      const name = String(attack.name ?? '').trim();
      if (!name) return null;
      const bonusMatch = String(attack.bonus ?? '').match(/[+-]?\d+/);
      const attackBonus = bonusMatch ? Number.parseInt(bonusMatch[0], 10) : 0;
      const traits = Array.isArray(attack.traits)
        ? attack.traits.map(t => String(t).trim()).filter(Boolean)
        : String(attack.traits ?? '').split(',').map(t => t.trim()).filter(Boolean);
      const damage = _splitCharacterDamage(attack.damage, attack.damage_type ?? attack.damageType);
      return {
        name,
        display: name,
        attack: attackBonus,
        die: damage.die,
        damageBonus: 0,
        damageType: damage.damageType,
        traits,
        action: String(attack.action ?? '').trim(),
        range: String(attack.range ?? '').trim(),
        notes: String(attack.notes ?? '').trim(),
        source: 'pathway-web',
      };
    })
    .filter(Boolean);
}

function getCharacterWeapons(charEntry) {
  const c = charEntry?.data ?? {};
  const hiddenWeapons = new Set((charEntry?.edits?.hiddenWeapons ?? []).map(n => String(n).toLowerCase()));
  const weapons = new Map();
  for (const w of (c.weapons ?? [])) {
    const key = String(w.display ?? w.name ?? '').toLowerCase();
    if (!key || hiddenWeapons.has(key)) continue;
    weapons.set(key, w);
  }
  for (const w of _normalizePathwayCustomAttacks(c.custom_attacks)) {
    const key = String(w.display ?? w.name ?? '').toLowerCase();
    if (!key || hiddenWeapons.has(key)) continue;
    weapons.set(key, w);
  }
  for (const w of (charEntry?.edits?.weapons ?? [])) {
    const key = String(w.display ?? w.name ?? '').toLowerCase();
    if (!key || hiddenWeapons.has(key)) continue;
    weapons.set(key, w);
  }
  return [...weapons.values()];
}

// ── Character resolution ───────────────────────────────────────────────────
// Resolves the user-facing "which character do you mean?" question from a
// `nameArg` (the optional `character:<name>` slash-command option) and falls
// back to the user's _activeChar setting or — if they have exactly one — to
// that single character. Returns either { error } or { charKey, char }.
//
// The 3rd argument is optional: if omitted, the function looks up its own
// cache via getAll(). This is the cleaner shape for new callers; legacy
// call sites (87 of them in index.js as of Phase 3.3) keep passing the
// cache explicitly because they were written before this convenience.

function resolveChar(userId, nameArg, characters = null) {
  if (characters === null) characters = getAll();
  if (!characters[userId] || Object.keys(characters[userId]).filter(k => !k.startsWith('_')).length === 0)
    return { error: 'You have no saved characters! Use `/char add` to add one.' };
  let charKey;
  if (!nameArg) {
    // Filter out underscore-prefixed metadata keys (like _activeChar)
    const keys = Object.keys(characters[userId]).filter(k => !k.startsWith('_'));
    if (keys.length === 1) { charKey = keys[0]; }
    else {
      // Multiple characters — check for an active character setting first.
      const activeKey = characters[userId]._activeChar;
      if (activeKey && characters[userId][activeKey]) {
        charKey = activeKey;
      } else {
        const names = keys.map(k => characters[userId][k].name).join(', ');
        return { error: `You have multiple characters! Specify one with \`character:<name>\`, or set a default with \`/char active character:<name>\`.\nYour characters: ${names}` };
      }
    }
  } else {
    const requested = nameArg.toLowerCase().replace(/\s+/g, '-');
    charKey = requested;
    if (!characters[userId][charKey]) {
      const lowered = nameArg.toLowerCase().trim();
      const match = Object.keys(characters[userId])
        .filter(k => !k.startsWith('_'))
        .find(k => characters[userId][k]?.name?.toLowerCase?.().trim() === lowered);
      if (match) charKey = match;
    }
  }
  if (!characters[userId][charKey]) {
    const names = Object.keys(characters[userId]).filter(k => !k.startsWith('_')).map(k => characters[userId][k].name).join(', ');
    return { error: `Couldn't find that character. Your characters: ${names}` };
  }
  return { charKey, char: characters[userId][charKey] };
}

// ── Writes ─────────────────────────────────────────────────────────────────
//
// `saveAll(data)` is the bot's bulk-save path. It replaces the cache (the
// same map callers were operating on) and pushes every character to
// Supabase via syncAllCharactersToSupabase. The username cache is read
// implicitly so callers don't have to forward it — anywhere in the bot
// that previously had to pass usernameCache through can now just call
// saveAll(data) and the right thing happens.
async function saveAll(data) {
  _cache = data || {};
  await syncAllCharactersToSupabase(_cache, _usernameCache);
}

// Update active char key + cache locally + sync to Supabase.
async function saveActive(discordId, charKey, discordUsername = null) {
  const cache = _ensureCache();
  if (!cache[discordId]) cache[discordId] = {};
  if (charKey && cache[discordId][charKey]) cache[discordId]._activeChar = charKey;
  else delete cache[discordId]._activeChar;
  await syncActiveCharacterToSupabase(discordId, charKey, discordUsername);
}

// ── Subscribe (Realtime — call BEFORE restore) ─────────────────────────────
function subscribe(sb) {
  if (!sb) {
    console.warn('[state/characters:realtime] Supabase not available — live sync disabled');
    return;
  }
  sb.channel('state-characters')
    .on('postgres_changes', {
      event:  '*',
      schema: 'public',
      table:  'characters',
    }, (payload) => {
      const apply = () => _applyEvent(payload);
      if (_ready) apply();
      else _pendingEvents.push(apply);
    })
    .subscribe((status, err) => {
      if (err) console.error('[state/characters:realtime] subscription error:', err.message);
      else console.log(`[state/characters:realtime] ${status}`);
    });
}

function _applyEvent(payload) {
  try {
    const event = payload.eventType ?? payload.type;
    const cache = _ensureCache();

    if (event === 'DELETE') {
      const row = payload.old;
      const discordId = _userIdToDiscordId[row.user_id];
      if (!discordId || !row.char_key) return;
      if (cache[discordId]?.[row.char_key]) {
        delete cache[discordId][row.char_key];
        if (cache[discordId]._activeChar === row.char_key) delete cache[discordId]._activeChar;
      }
      delete _rowUpdatedAt[_freshKey(discordId, row.char_key)];
      console.log(`[state/characters:realtime] - ${discordId}:${row.char_key}`);
      return;
    }

    // INSERT or UPDATE
    const row = payload.new;
    const discordId = _userIdToDiscordId[row.user_id];
    if (!discordId || !row.char_key) return;

    // Status transition: a row that becomes non-active is effectively
    // archived from the bot's point of view. Treat as a delete.
    if (row.status && row.status !== 'active') {
      if (cache[discordId]?.[row.char_key]) {
        delete cache[discordId][row.char_key];
        if (cache[discordId]._activeChar === row.char_key) delete cache[discordId]._activeChar;
      }
      delete _rowUpdatedAt[_freshKey(discordId, row.char_key)];
      console.log(`[state/characters:realtime] - ${discordId}:${row.char_key} (status=${row.status})`);
      return;
    }

    // Freshness check — skip stale events.
    const fk = _freshKey(discordId, row.char_key);
    if (_rowUpdatedAt[fk] && row.updated_at && row.updated_at <= _rowUpdatedAt[fk]) {
      return;
    }

    if (!cache[discordId]) cache[discordId] = {};
    const existing = cache[discordId][row.char_key];
    const entry = _entryFromRow(row, existing);
    if (!entry) return; // bad row (no build.name)
    cache[discordId][row.char_key] = entry;
    _rowUpdatedAt[fk] = row.updated_at ?? null;
    console.log(`[state/characters:realtime] ${event === 'INSERT' ? '+' : '~'} ${discordId}:${row.char_key}`);
  } catch (e) {
    console.error('[state/characters:realtime] handler error:', e.message);
  }
}

// ── Restore (called once at startup, AFTER subscribe) ──────────────────────
//
// Pulls all active characters and all companions in two queries, builds the
// nested cache, and applies the per-user active_char_key from the users
// table. Returns the populated cache so lib/storage.js's restoreAll can
// still propagate it to index.js's seed path (which becomes a no-op).
async function restore(sb, { bySupabaseId, userRows }) {
  if (!sb) {
    _ready = true;
    _drainPending();
    return _ensureCache();
  }

  // Characters
  const { data: charRows, error: charErr } = await sb
    .from('characters')
    .select('user_id, char_key, name, source, pathbuilder_data, current_hp, overlay, dying, wounded, hero_points, discord_guild_id, art, status, updated_at')
    .eq('status', 'active');
  if (charErr) throw charErr;

  // Companions (initial hydration only — Realtime mutations flow through state/companions)
  const { data: compRows, error: compErr } = await sb
    .from('companions')
    .select('user_id, char_key, comp_key, display_name, base_type, form, notes, current_hp, custom_stats, is_active');
  if (compErr) throw compErr;

  _userIdToDiscordId = { ...bySupabaseId };

  const cache = _ensureCache();

  for (const row of charRows ?? []) {
    const discordId = bySupabaseId[row.user_id];
    if (!discordId || !row.char_key) continue;
    const entry = _entryFromRow(row, undefined);
    if (!entry) continue;
    if (!cache[discordId]) cache[discordId] = {};
    cache[discordId][row.char_key] = entry;
    _rowUpdatedAt[_freshKey(discordId, row.char_key)] = row.updated_at ?? null;
  }
  console.log(`[Supabase] restore: loaded ${charRows?.length ?? 0} characters`);

  // Companion fan-out into the nested .companions field.
  for (const row of compRows ?? []) {
    const discordId = bySupabaseId[row.user_id];
    if (!discordId || !row.char_key || !row.comp_key) continue;
    const charEntry = cache[discordId]?.[row.char_key];
    if (!charEntry) continue;
    if (!charEntry.companions) charEntry.companions = {};
    const cs = row.custom_stats ?? {};
    charEntry.companions[row.comp_key] = {
      displayName:     row.display_name,
      baseType:        row.base_type,
      form:            row.form ?? 'young',
      notes:           row.notes ?? '',
      currentHp:       row.current_hp ?? null,
      customStats:     cs.customStats     ?? null,
      art:             cs.art             ?? null,
      skills:          cs.skills          ?? null,
      customAbilities: cs.customAbilities ?? null,
      customAttacks:   cs.customAttacks   ?? null,
      overrides:       cs.overrides       ?? null,
    };
    if (row.is_active) charEntry.activeCompanion = row.comp_key;
  }
  console.log(`[Supabase] restore: loaded ${compRows?.length ?? 0} companions`);

  // _activeChar from users.active_char_key
  for (const row of userRows ?? []) {
    const discordId = row.discord_id;
    const activeKey = row.active_char_key;
    if (discordId && activeKey && cache[discordId]?.[activeKey]) {
      cache[discordId]._activeChar = activeKey;
    }
  }

  _ready = true;
  _drainPending();
  return cache;
}

function _drainPending() {
  if (_pendingEvents.length === 0) return;
  console.log(`[state/characters:realtime] draining ${_pendingEvents.length} queued event(s) after restore`);
  for (const apply of _pendingEvents) apply();
  _pendingEvents.length = 0;
}

// ── Phase 1 sync helpers (the bulk write path — unchanged shape) ──────────

async function syncAllCharactersToSupabase(characters, usernamesByDiscordId) {
  return _trackSync(_doSyncAllCharacters(characters, usernamesByDiscordId));
}

async function _doSyncAllCharacters(characters, usernamesByDiscordId) {
  try {
    const sb = getSupabase();
    if (!sb) return;

    const discordIds = Object.keys(characters).filter(k => k !== '_activeChar' && /^\d+$/.test(k));
    if (discordIds.length === 0) return;

    const { data: userRows, error: userErr } = await sb
      .from('users')
      .select('id, discord_id')
      .in('discord_id', discordIds);
    if (userErr) throw userErr;

    const userMap = Object.fromEntries((userRows ?? []).map(u => [u.discord_id, u.id]));

    const missingIds = discordIds.filter(id => !userMap[id]);
    if (missingIds.length > 0 && usernamesByDiscordId?.size > 0) {
      const toCreate = missingIds
        .filter(id => usernamesByDiscordId.has(id))
        .map(id => ({ discord_id: id, discord_username: usernamesByDiscordId.get(id) }));
      if (toCreate.length > 0) {
        const { data: created } = await sb
          .from('users')
          .upsert(toCreate, { onConflict: 'discord_id' })
          .select('id, discord_id');
        for (const row of created ?? []) userMap[row.discord_id] = row.id;
      }
    }

    const upserts = [];
    for (const [discordId, userChars] of Object.entries(characters)) {
      const userId = userMap[discordId];
      if (!userId) continue;

      for (const [charKey, charEntry] of Object.entries(userChars)) {
        if (charKey.startsWith('_') || !charEntry || !charEntry.name) continue;
        const d = charEntry.data || {};
        upserts.push({
          user_id:          userId,
          char_key:         charKey,
          discord_guild_id: charEntry.guildId ?? null,
          name:             charEntry.name,
          class_name:       d.class ?? null,
          ancestry_name:    d.ancestry ?? null,
          background_name:  d.background ?? null,
          level:            d.level ?? 1,
          experience:       d.xp ?? 0,
          pathbuilder_data: d,
          current_hp:       charEntry.hp ?? null,
          overlay:          buildCharacterOverlayForSupabase(charEntry),
          hero_points:      charEntry.heroPoints ?? charEntry.overlay?.daily?.hero_points ?? 1,
          dying:            charEntry.dying ?? 0,
          wounded:          charEntry.wounded ?? 0,
          art:              charEntry.art ?? null,
          status:           'active',
        });
      }
    }
    if (upserts.length === 0) return;

    const { error } = await sb
      .from('characters')
      .upsert(upserts, { onConflict: 'user_id,char_key' });
    if (error) throw error;

    for (const [discordId, userChars] of Object.entries(characters)) {
      const userId = userMap[discordId];
      if (!userId || !userChars || typeof userChars !== 'object') continue;
      const activeKey = userChars._activeChar;
      const nextActiveKey = activeKey && userChars[activeKey] ? activeKey : null;
      const { error: activeErr } = await sb
        .from('users')
        .update({ active_char_key: nextActiveKey })
        .eq('id', userId);
      if (activeErr) throw activeErr;
    }

    _recordSyncSuccess();
  } catch (err) {
    _recordSyncFailure();
    console.error('[Supabase] character sync failed:', err.message);
  }
}

async function syncActiveCharacterToSupabase(discordId, activeCharKey, discordUsername = null) {
  try {
    const sb = getSupabase();
    if (!sb) return;

    const payload = { discord_id: String(discordId) };
    if (discordUsername) payload.discord_username = discordUsername;

    const { data: userRow, error: userErr } = await sb
      .from('users')
      .upsert(payload, { onConflict: 'discord_id' })
      .select('id')
      .single();
    if (userErr) throw userErr;
    if (!userRow?.id) return;

    const { error } = await sb
      .from('users')
      .update({ active_char_key: activeCharKey || null })
      .eq('id', userRow.id);
    if (error) throw error;
    _recordSyncSuccess();
  } catch (err) {
    _recordSyncFailure();
    console.error('[Supabase] active character sync failed:', err.message);
  }
}

// Pull all active characters for a Discord user from Supabase and merge any
// that aren't already in the local in-memory characters map. Returns the
// number of new entries added. Never throws — Supabase failures are silent.
//
// Phase 2 makes this mostly redundant since Realtime keeps the cache
// fresh — kept here as a manual fallback for /sync or similar commands.
async function mergeCharactersFromSupabase(discordId, charactersMap) {
  try {
    const sb = getSupabase();
    if (!sb) return 0;

    const { data: userRow } = await sb
      .from('users')
      .select('id, active_char_key')
      .eq('discord_id', discordId)
      .single();
    if (!userRow) return 0;

    const { data: rows } = await sb
      .from('characters')
      .select('char_key, name, source, pathbuilder_data, current_hp, overlay, dying, wounded, hero_points, discord_guild_id, art, updated_at')
      .eq('user_id', userRow.id)
      .eq('status', 'active');
    if (!rows || rows.length === 0) return 0;

    if (!charactersMap[discordId]) charactersMap[discordId] = {};
    let added = 0;
    for (const row of rows) {
      const key = row.char_key;
      if (!key) continue;
      const local = charactersMap[discordId][key];
      if (local?.saved && row.updated_at && local.saved >= row.updated_at) continue;
      const entry = _entryFromRow(row, local);
      if (!entry) continue;
      charactersMap[discordId][key] = entry;
      added++;
    }
    if (userRow.active_char_key && charactersMap[discordId]?.[userRow.active_char_key]) {
      charactersMap[discordId]._activeChar = userRow.active_char_key;
    }
    return added;
  } catch (err) {
    console.error('[Supabase] character merge failed:', err.message);
    return 0;
  }
}

module.exports = {
  // Phase 2 surface
  getAll,
  get,
  saveAll,
  saveActive,
  restore,
  subscribe,

  // HP overlay accessors (Phase 3 — moved here from index.js so /hp,
  // /sheet, /rest, /init hp, and the combat tracker all share one source
  // of truth for how a character's HP is read and written).
  computeCharMaxHp,
  getCharacterHp,
  setCharacterHp,

  // XP overlay (Phase 3.5 — same pattern as HP. /xp + /char debug + future
  // commands all read/write via these accessors).
  getCharacterXp,
  setCharacterXp,

  // Weapons derivation (Phase 3.5 — merges Pathbuilder weapons, Pathway-web
  // custom attacks, and bot-added attacks into a single list).
  getCharacterWeapons,

  // Character resolution (Phase 3.3 — formerly in index.js, used in 87+
  // call sites by every command that takes a `character:<name>` option).
  resolveChar,

  // Username cache + storage limits (Phase 3.7 — formerly in index.js).
  // rememberUsername is called by interactionCreate; MAX_CHARACTERS_PER_USER
  // is read by saveImportedCharacter and the /char add blank flow.
  rememberUsername,
  MAX_CHARACTERS_PER_USER,

  // Helpers (still exported for legacy callers — lib/storage's older
  // restore code path imported applyCharacterBotState by name)
  CHARACTER_BOT_STATE_OVERLAY_KEY,
  buildCharacterOverlayForSupabase,
  applyCharacterBotState,

  // Phase 1 sync helpers (still re-exported by the storage barrel)
  syncAllCharactersToSupabase,
  syncActiveCharacterToSupabase,
  mergeCharactersFromSupabase,
};
