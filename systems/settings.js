// systems/settings.js
// Per-guild bot settings. Currently tracks which campaign setting the guild
// uses ('golarion' or 'eberron') for /calendar and /weather. Designed to be
// trivial to extend with future per-guild flags.
//
// Storage: bot-settings.json (separate from calendar-state.json /
// weather-state.json so changing the setting doesn't wipe in-game state, and
// resetting calendar/weather doesn't lose the chosen setting).
//
// Public API:
//   getSetting(guildId, key, default?)
//   setSetting(guildId, key, value)
//   getCampaignSetting(guildId)        // shortcut: 'golarion' | 'eberron'
//   setCampaignSetting(guildId, value) // validates value before writing
//   getCalendarAutotick(guildId)       // server calendar auto-advance config
//   setCalendarAutotick(guildId, patch)
//   listCalendarAutotickGuilds()
//
// Defaults to 'golarion' for backward compatibility — every existing server
// keeps its existing experience until someone explicitly switches.

'use strict';

const { loadJson, mutateJson } = require('../utils/storage');

const STATE_FILE = 'bot-settings.json';
const VALID_CAMPAIGN_SETTINGS = ['golarion', 'eberron'];
const DEFAULT_CALENDAR_AUTOTICK = {
  enabled: false,
  time: '06:00',
  timezone: 'America/Chicago',
  lastRunLocalDate: null,
};

function loadAll() {
  return loadJson(STATE_FILE, { default: {}, quiet: true }) || {};
}

function getSetting(guildId, key, defaultValue = null) {
  const all = loadAll();
  const entry = all[String(guildId)];
  if (!entry) return defaultValue;
  return entry[key] ?? defaultValue;
}

async function setSetting(guildId, key, value) {
  const id = String(guildId);
  return mutateJson(STATE_FILE, { default: {} }, (state) => {
    if (!state[id]) state[id] = {};
    state[id][key] = value;
    state[id]._updatedAt = new Date().toISOString();
    return state;
  });
}

function getCalendarAutotick(guildId) {
  const stored = getSetting(guildId, 'calendarAutotick', {}) || {};
  return { ...DEFAULT_CALENDAR_AUTOTICK, ...stored };
}

async function setCalendarAutotick(guildId, patch) {
  const id = String(guildId);
  return mutateJson(STATE_FILE, { default: {} }, (state) => {
    if (!state[id]) state[id] = {};
    const current = { ...DEFAULT_CALENDAR_AUTOTICK, ...(state[id].calendarAutotick || {}) };
    state[id].calendarAutotick = { ...current, ...patch };
    state[id]._updatedAt = new Date().toISOString();
    return state;
  });
}

function listCalendarAutotickGuilds() {
  const all = loadAll();
  return Object.entries(all)
    .map(([guildId, entry]) => ({
      guildId,
      config: { ...DEFAULT_CALENDAR_AUTOTICK, ...(entry?.calendarAutotick || {}) },
    }))
    .filter(row => row.config.enabled);
}

function getCampaignSetting(guildId) {
  return getSetting(guildId, 'campaignSetting', 'golarion');
}

async function setCampaignSetting(guildId, value) {
  const v = String(value || '').toLowerCase();
  if (!VALID_CAMPAIGN_SETTINGS.includes(v)) {
    throw new Error(`Invalid campaign setting "${value}". Must be one of: ${VALID_CAMPAIGN_SETTINGS.join(', ')}.`);
  }
  return setSetting(guildId, 'campaignSetting', v);
}

module.exports = {
  VALID_CAMPAIGN_SETTINGS,
  getSetting,
  setSetting,
  getCalendarAutotick,
  setCalendarAutotick,
  listCalendarAutotickGuilds,
  getCampaignSetting,
  setCampaignSetting,
};
