// ── state/guild.js ───────────────────────────────────────────────────────────
// Per-guild state: calendar, weather, and bot settings — all stored in the
// `guild_state` table as three JSONB columns ({ calendar, weather, settings })
// in one row per Discord guild.
//
// In the bot these live behind three separate seeded JSON caches:
//   • calendar-state.json   { [guildId]: { year, month, day } }
//   • weather-state.json    { [guildId]: { climate, season, day, current, yesterday, history } }
//   • bot-settings.json     { [guildId]: { campaignSetting, ...settings } }
//
// Command handlers (in src/rules/calendar.js, src/rules/weather.js,
// src/rules/settings.js) operate on these via mutateJson(), which sits in
// lib/storage.js's _jsonCaches mechanism.
//
// Phase 2: this module owns the restore + Realtime subscription. It holds
// references to the same three map objects that lib/storage's _jsonCaches
// stores — mutations made by this module's Realtime handler are visible
// to subsequent mutateJson()/loadJson() calls because the mutators all
// return the same reference (in-place updates).

const { getSupabase } = require('../lib/supabase');
const { _recordSyncSuccess, _recordSyncFailure } = require('../lib/syncTracker');

// ── References to the seeded caches ────────────────────────────────────────
// Populated by restore(). The same objects are also seeded into
// lib/storage.js's _jsonCaches via index.js's clientReady — both sides
// share these references.
let _calStateRef    = null;
let _wxStateRef     = null;
let _botSettingsRef = null;

let _ready = false;
const _pendingEvents = [];
// Per-guild updated_at, for Realtime freshness check.
const _rowUpdatedAt = Object.create(null);

// ── Row → cache transformer ────────────────────────────────────────────────
// Single helper used by both restore() and the Realtime handler so the
// shape transformation is defined exactly once. Mutates the three cache
// maps in place; returns the affected guildId for logging.
function _applyRowToCaches(row, { calState, wxState, botSettings }) {
  const gid = row.discord_guild_id;
  if (!gid) return null;

  // Calendar: row.calendar is { year, month, day, setting? }. The bot's
  // cache only holds { year, month, day }; the legacy "setting" sub-field
  // is folded into botSettings.campaignSetting below.
  const cal = row.calendar;
  if (cal?.year && cal?.month && cal?.day) {
    calState[gid] = { year: cal.year, month: cal.month, day: cal.day };
    if (cal.setting) {
      if (!botSettings[gid]) botSettings[gid] = {};
      botSettings[gid].campaignSetting = cal.setting;
    }
  }

  // Settings: full settings object lives in row.settings. Merge into the
  // existing entry so we don't lose campaignSetting if it came from cal.
  if (row.settings && typeof row.settings === 'object') {
    botSettings[gid] = { ...(botSettings[gid] ?? {}), ...row.settings };
  }

  // Weather: row.weather has a flat shape with current snapshot only. The
  // bot's cache reshapes to a {current, yesterday, history} structure
  // (history is ephemeral and starts empty).
  const wx = row.weather;
  if (wx?.climate && wx?.current) {
    wxState[gid] = {
      climate:   wx.climate,
      season:    wx.season   ?? 'spring',
      day:       wx.day      ?? 1,
      current:   {
        temperatureF:                wx.temperatureF,
        temperatureCategory:         wx.temperatureCategory,
        effectiveTemperatureCategory: wx.effectiveTemperatureCategory ?? wx.temperatureCategory,
        precipitation:               wx.precipitation ?? 'none',
        wind:                        wx.wind          ?? 'calm',
        fog:                         wx.fog           ?? 'none',
        soaked:                      wx.soaked        ?? false,
      },
      yesterday: {
        temperatureF:                wx.temperatureF,
        temperatureCategory:         wx.temperatureCategory,
        effectiveTemperatureCategory: wx.effectiveTemperatureCategory ?? wx.temperatureCategory,
        precipitation:               wx.precipitation ?? 'none',
        wind:                        wx.wind          ?? 'calm',
        fog:                         wx.fog           ?? 'none',
        soaked:                      wx.soaked        ?? false,
      },
      history: [],
    };
  }

  return gid;
}

// ── Subscribe (Realtime — call BEFORE restore) ─────────────────────────────
function subscribe(sb) {
  if (!sb) {
    console.warn('[state/guild:realtime] Supabase not available — live sync disabled');
    return;
  }
  sb.channel('state-guild')
    .on('postgres_changes', {
      event:  '*',
      schema: 'public',
      table:  'guild_state',
    }, (payload) => {
      const apply = () => _applyEvent(payload);
      if (_ready) apply();
      else _pendingEvents.push(apply);
    })
    .subscribe((status, err) => {
      if (err) console.error('[state/guild:realtime] subscription error:', err.message);
      else console.log(`[state/guild:realtime] ${status}`);
    });
}

function _applyEvent(payload) {
  try {
    if (!_calStateRef || !_wxStateRef || !_botSettingsRef) return;

    const event = payload.eventType ?? payload.type;

    if (event === 'DELETE') {
      const row = payload.old;
      const gid = row.discord_guild_id;
      if (!gid) return;
      delete _calStateRef[gid];
      delete _wxStateRef[gid];
      delete _botSettingsRef[gid];
      delete _rowUpdatedAt[gid];
      console.log(`[state/guild:realtime] - ${gid}`);
      return;
    }

    const row = payload.new;
    const gid = row.discord_guild_id;
    if (!gid) return;

    // Freshness check
    if (_rowUpdatedAt[gid] && row.updated_at && row.updated_at <= _rowUpdatedAt[gid]) return;

    _applyRowToCaches(row, {
      calState:    _calStateRef,
      wxState:     _wxStateRef,
      botSettings: _botSettingsRef,
    });
    _rowUpdatedAt[gid] = row.updated_at ?? null;
    console.log(`[state/guild:realtime] ${event === 'INSERT' ? '+' : '~'} ${gid}`);
  } catch (e) {
    console.error('[state/guild:realtime] handler error:', e.message);
  }
}

// ── Restore (called once at startup, AFTER subscribe) ──────────────────────
//
// Builds the three guild-state caches by reading guild_state rows. The
// caller passes disk-side state as a starting point (the legacy
// calendar-state.json / weather-state.json / bot-settings.json fallbacks).
// Returns { calState, wxState, botSettings } — index.js then seeds these
// into lib/storage's _jsonCaches via seedJsonCache().
async function restore(sb, { diskCalState = {}, diskWxState = {}, diskBotSettings = {} } = {}) {
  const calState    = { ...diskCalState };
  const wxState     = { ...diskWxState };
  const botSettings = { ...diskBotSettings };

  // Store references BEFORE the fetch so Realtime events that fire during
  // restore have somewhere to apply to. (The Realtime handler also gates
  // on _ready, but capturing the refs early is defensive.)
  _calStateRef    = calState;
  _wxStateRef     = wxState;
  _botSettingsRef = botSettings;

  if (sb) {
    const { data: guildStateRows, error } = await sb
      .from('guild_state')
      .select('discord_guild_id, calendar, weather, settings, updated_at');
    if (error) throw error;

    for (const row of guildStateRows ?? []) {
      _applyRowToCaches(row, { calState, wxState, botSettings });
      _rowUpdatedAt[row.discord_guild_id] = row.updated_at ?? null;
    }
    console.log(`[Supabase] restore: loaded guild state for ${guildStateRows?.length ?? 0} guilds`);
  }

  _ready = true;
  _drainPending();
  return { calState, wxState, botSettings };
}

function _drainPending() {
  if (_pendingEvents.length === 0) return;
  console.log(`[state/guild:realtime] draining ${_pendingEvents.length} queued event(s) after restore`);
  for (const apply of _pendingEvents) apply();
  _pendingEvents.length = 0;
}

// ── Phase 1 sync helpers (unchanged) ───────────────────────────────────────

// patch: { calendar?, weather?, settings? }
// Uses patch semantics: only the provided keys are written, preserving the
// other columns. First write does an insert; subsequent writes use column-
// level update so /calendar set doesn't wipe the weather column.
async function syncGuildStateToSupabase(guildId, patch) {
  try {
    const sb = getSupabase();
    if (!sb) return;
    const gid = String(guildId);

    const { data: existing, error: selectErr } = await sb
      .from('guild_state')
      .select('id')
      .eq('discord_guild_id', gid)
      .maybeSingle();
    if (selectErr) throw selectErr;

    if (existing) {
      const { error } = await sb
        .from('guild_state')
        .update(patch)
        .eq('discord_guild_id', gid);
      if (error) throw error;
    } else {
      const { error } = await sb
        .from('guild_state')
        .insert({ discord_guild_id: gid, ...patch });
      if (error) throw error;
    }
  } catch (err) {
    console.error('[Supabase] guild state sync failed:', err.message);
  }
}

async function syncAllBotSettingsToSupabase(botSettings) {
  try {
    const sb = getSupabase();
    if (!sb || !botSettings) return;
    for (const [guildId, settings] of Object.entries(botSettings)) {
      if (!guildId || !settings) continue;
      await syncGuildStateToSupabase(guildId, { settings });
    }
    _recordSyncSuccess();
  } catch (err) {
    _recordSyncFailure();
    console.error('[Supabase] bot settings full sync failed:', err.message);
  }
}

module.exports = {
  // Phase 2 surface
  restore,
  subscribe,

  // Phase 1 compat — still re-exported by the storage barrel
  syncGuildStateToSupabase,
  syncAllBotSettingsToSupabase,
};
