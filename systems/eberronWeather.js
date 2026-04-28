// systems/eberronWeather.js
// Eberron weather engine. Uses the SAME rolling logic as systems/weather.js,
// but loads gamedata/eberron-weather.json with all 5 continents' climates +
// the Mournland's special phenomena.
//
// Per-guild state is shared with the Golarion engine via weather-state.json
// (different guild IDs, no collision). The dispatcher in commands/weather-cmd
// picks which engine to use based on the guild's campaignSetting.
//
// IMPORTANT: This file's API matches systems/weather.js exactly so it's a
// drop-in replacement. Internal-only differences:
//   • Different rules data file (eberron-weather.json)
//   • Mournland fog values include "deadgray" and precipitation includes
//     mournland-specific phenomena (mournlandAsh, mournlandShard, deathRain)
//   • Climate keys are continent-prefixed (khorvaire_temperate, aerenal, etc.)

'use strict';

const path = require('path');
const fs = require('fs');
const { loadJson, mutateJson } = require('../utils/storage');

const RULES = (() => {
  try {
    return JSON.parse(fs.readFileSync(
      path.join(__dirname, '..', 'gamedata', 'eberron-weather.json'),
      'utf8'
    ));
  } catch (err) {
    console.error('eberronWeather.js: failed to load gamedata/eberron-weather.json:', err.message);
    return null;
  }
})();

const STATE_FILE = 'weather-state.json';
const SEASONS = ['spring', 'summer', 'autumn', 'winter'];

// ── Generic helpers (mirror systems/weather.js exactly) ─────────────────────

function weightedPick(table, boostKey = null, boostMul = 1) {
  if (!table || typeof table !== 'object') return null;
  const entries = Object.entries(table).filter(([, w]) => w > 0);
  if (entries.length === 0) return null;
  const adjusted = entries.map(([k, w]) => [k, k === boostKey ? w * boostMul : w]);
  const total = adjusted.reduce((s, [, w]) => s + w, 0);
  let r = Math.random() * total;
  for (const [k, w] of adjusted) {
    r -= w;
    if (r <= 0) return k;
  }
  return adjusted[adjusted.length - 1][0];
}

function categorizeTemperature(f) {
  if (!RULES) return 'normal';
  for (const [key, def] of Object.entries(RULES.temperature)) {
    const [lo, hi] = def.rangeF;
    if (f >= lo && f <= hi) return key;
  }
  return f < 0 ? 'incredibleCold' : 'incredibleHeat';
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function isValidClimate(climate)   { return RULES && Object.prototype.hasOwnProperty.call(RULES.climates, climate); }
function isValidSeason(season)     { return SEASONS.includes(season); }

function listClimates() {
  if (!RULES) return [];
  return Object.entries(RULES.climates).map(([key, def]) => ({
    key, label: def.label, description: def.description, emoji: def.emoji,
  }));
}

// ── Core rolling logic (identical to Golarion engine, just different data) ──

function rollOneDay(climate, season, yesterday = null) {
  if (!isValidClimate(climate) || !isValidSeason(season)) {
    return null;
  }
  const cdef = RULES.climates[climate];
  const sdef = cdef.seasons[season];
  if (!sdef) return null;

  const precipitation = weightedPick(sdef.precipitation, yesterday?.precipitation, RULES.persistence.precipitation);
  const wind          = weightedPick(sdef.wind,          yesterday?.wind,          RULES.persistence.wind);
  const fog           = weightedPick(sdef.fog,           yesterday?.fog,           RULES.persistence.fog);

  const [lo, hi] = sdef.tempRangeF;
  let temperatureF;
  if (yesterday && typeof yesterday.temperatureF === 'number') {
    const drift = RULES.persistence.tempDriftF;
    const target = randInt(lo, hi);
    const blended = Math.round((yesterday.temperatureF + target) / 2);
    temperatureF = blended + randInt(-drift, drift);
  } else {
    const variance = sdef.tempVarianceF || 0;
    temperatureF = randInt(lo, hi) + randInt(-variance, variance);
  }
  temperatureF = Math.max(-100, Math.min(150, temperatureF));

  const ppDef = RULES.precipitation[precipitation] || {};
  const soaked = !!ppDef.soaked;

  const actualCategory = categorizeTemperature(temperatureF);
  const effectiveCategory = soaked ? stepColder(actualCategory) : actualCategory;

  return {
    temperatureF,
    temperatureCategory: actualCategory,
    effectiveTemperatureCategory: effectiveCategory,
    precipitation,
    wind,
    fog,
    soaked,
  };
}

const COLD_STEPS = ['incredibleHeat', 'extremeHeat', 'severeHeat', 'mildHeat',
                    'normal',
                    'mildCold', 'severeCold', 'extremeCold', 'incredibleCold'];
function stepColder(category) {
  const idx = COLD_STEPS.indexOf(category);
  if (idx === -1) return category;
  return COLD_STEPS[Math.min(idx + 1, COLD_STEPS.length - 1)];
}

// ── State accessors ──────────────────────────────────────────────────────────

function loadState() {
  return loadJson(STATE_FILE, { default: {}, quiet: true }) || {};
}

function getWeather(guildId) {
  const state = loadState();
  return state[String(guildId)] || null;
}

async function ensureWeather(guildId, { climate = 'khorvaire_temperate', season = 'spring' } = {}) {
  const key = String(guildId);
  return mutateJson(STATE_FILE, { default: {} }, (state) => {
    if (state[key]) return state;
    const current = rollOneDay(climate, season, null);
    state[key] = {
      climate,
      season,
      day: 1,
      current,
      yesterday: null,
      history: [],
      updatedAt: new Date().toISOString(),
    };
    return state;
  });
}

async function setClimate(guildId, climate, season = null) {
  if (!isValidClimate(climate)) throw new Error(`Unknown climate: ${climate}`);
  if (season !== null && !isValidSeason(season)) throw new Error(`Unknown season: ${season}`);
  const key = String(guildId);
  return mutateJson(STATE_FILE, { default: {} }, (state) => {
    const entry = state[key] || { day: 1, history: [] };
    entry.climate = climate;
    if (season) entry.season = season;
    if (!entry.season) entry.season = 'spring';
    entry.current = rollOneDay(entry.climate, entry.season, entry.yesterday);
    entry.updatedAt = new Date().toISOString();
    state[key] = entry;
    return state;
  });
}

async function setSeason(guildId, season) {
  if (!isValidSeason(season)) throw new Error(`Unknown season: ${season}`);
  const key = String(guildId);
  return mutateJson(STATE_FILE, { default: {} }, (state) => {
    const entry = state[key];
    if (!entry) throw new Error('No weather state for this guild yet. Use /weather climate first.');
    entry.season = season;
    entry.current = rollOneDay(entry.climate, entry.season, entry.yesterday);
    entry.updatedAt = new Date().toISOString();
    return state;
  });
}

async function setComponent(guildId, component, value) {
  const key = String(guildId);
  return mutateJson(STATE_FILE, { default: {} }, (state) => {
    const entry = state[key];
    if (!entry) throw new Error('No weather state for this guild yet. Use /weather climate first.');
    const current = entry.current || {};
    if (component === 'temperature') {
      const f = Number(value);
      if (Number.isNaN(f)) throw new Error('Temperature must be a number (°F).');
      current.temperatureF = Math.max(-100, Math.min(150, f));
      current.temperatureCategory = categorizeTemperature(current.temperatureF);
      current.effectiveTemperatureCategory = current.soaked
        ? stepColder(current.temperatureCategory)
        : current.temperatureCategory;
    } else if (component === 'precipitation') {
      if (!RULES.precipitation[value]) throw new Error(`Unknown precipitation: ${value}`);
      current.precipitation = value;
      current.soaked = !!RULES.precipitation[value].soaked;
      current.effectiveTemperatureCategory = current.soaked
        ? stepColder(current.temperatureCategory)
        : current.temperatureCategory;
    } else if (component === 'wind') {
      if (!RULES.wind[value]) throw new Error(`Unknown wind: ${value}`);
      current.wind = value;
    } else if (component === 'fog') {
      if (!RULES.fog[value]) throw new Error(`Unknown fog: ${value}`);
      current.fog = value;
    } else {
      throw new Error(`Unknown component: ${component}`);
    }
    entry.current = current;
    entry.updatedAt = new Date().toISOString();
    return state;
  });
}

async function rollWeather(guildId) {
  const key = String(guildId);
  return mutateJson(STATE_FILE, { default: {} }, (state) => {
    const entry = state[key];
    if (!entry) throw new Error('No weather state for this guild yet. Use /weather climate first.');
    entry.current = rollOneDay(entry.climate, entry.season, entry.yesterday);
    entry.updatedAt = new Date().toISOString();
    return state;
  });
}

async function advanceDays(guildId, n) {
  if (!Number.isInteger(n) || n <= 0) throw new Error('Days must be a positive integer.');
  if (n > 30) throw new Error('Cannot advance more than 30 days at a time.');
  const key = String(guildId);
  return mutateJson(STATE_FILE, { default: {} }, (state) => {
    const entry = state[key];
    if (!entry) throw new Error('No weather state for this guild yet. Use /weather climate first.');
    let prev = entry.current;
    for (let i = 0; i < n; i++) {
      if (prev) {
        entry.history.push({ day: entry.day, ...prev });
        if (entry.history.length > 7) entry.history.shift();
      }
      entry.day += 1;
      entry.yesterday = prev;
      prev = rollOneDay(entry.climate, entry.season, prev);
    }
    entry.current = prev;
    entry.updatedAt = new Date().toISOString();
    return state;
  });
}

function getForecast(guildId, n = 3) {
  const entry = getWeather(guildId);
  if (!entry) return null;
  const out = [];
  let prev = entry.current;
  for (let i = 1; i <= n; i++) {
    const day = rollOneDay(entry.climate, entry.season, prev);
    out.push({ day: entry.day + i, ...day });
    prev = day;
  }
  return out;
}

async function clear(guildId) {
  const key = String(guildId);
  return mutateJson(STATE_FILE, { default: {} }, (state) => {
    delete state[key];
    return state;
  });
}

// ── Description helpers ──────────────────────────────────────────────────────

function describeWeather(weather) {
  if (!weather) return 'No weather set.';
  const t = RULES.temperature[weather.temperatureCategory] || {};
  const p = RULES.precipitation[weather.precipitation] || {};
  const w = RULES.wind[weather.wind] || {};
  const f = RULES.fog[weather.fog] || {};
  const lines = [];
  lines.push(`${t.emoji || ''} **${weather.temperatureF}°F** (${t.label || 'Normal'})`);
  if (weather.precipitation && weather.precipitation !== 'none') {
    lines.push(`${p.emoji || ''} **${p.label}**${weather.soaked ? ' *(soaked)*' : ''}`);
  } else {
    lines.push(`${p.emoji || '☀️'} Clear skies`);
  }
  if (weather.wind && weather.wind !== 'calm') {
    lines.push(`${w.emoji || ''} **${w.label}**`);
  }
  if (weather.fog && weather.fog !== 'none') {
    lines.push(`${f.emoji || ''} **${f.label}**`);
  }
  return lines.join('\n');
}

function buildEffectsForCombatant(weather, { appliedBy = 'weather' } = {}) {
  if (!weather) return [];
  const effects = [];

  const tempCat = weather.effectiveTemperatureCategory || weather.temperatureCategory;
  const tdef = RULES.temperature[tempCat];
  if (tdef && tdef.damage) {
    effects.push({
      name: `Weather: ${tdef.label}`,
      value: 0,
      duration: null,
      modifiers: {
        description: `${tdef.label} (${weather.temperatureF}°F${weather.soaked ? ', soaked' : ''}). Takes ${RULES.damageTiers[tdef.damage.tier].dice} ${tdef.damage.type} damage every ${tdef.damage.interval} without protection. Fatigues after ${tdef.fatigueHours} hours of overland travel.`,
      },
      isPreset: true,
      presetKey: `weather-temp-${tempCat}`,
      appliedBy,
    });
  }

  const pdef = RULES.precipitation[weather.precipitation];
  if (pdef && (pdef.perceptionPenalty || pdef.fatigue || pdef.lightning || pdef.note)) {
    const desc = [];
    if (pdef.perceptionPenalty) desc.push(`${pdef.perceptionPenalty} circumstance penalty to visual Perception checks`);
    if (pdef.fatigue) desc.push(`fatigues after ${pdef.fatigue === '4h' ? '4 hours' : pdef.fatigue} of travel`);
    if (pdef.lightning) {
      const tier = RULES.damageTiers[pdef.lightning.tier];
      desc.push(`small chance of ${pdef.lightning.type} damage per hour (~${(pdef.lightning.chancePerHour * 100).toFixed(1)}%, ${tier.dice})`);
    }
    if (pdef.soaked) desc.push('soaked: temperature treated one step colder');
    if (pdef.note) desc.push(pdef.note);
    effects.push({
      name: `Weather: ${pdef.label}`,
      value: pdef.perceptionPenalty || 0,
      duration: null,
      modifiers: {
        skillBonus: pdef.perceptionPenalty || 0,
        description: desc.join('; '),
      },
      isPreset: true,
      presetKey: `weather-precip-${weather.precipitation}`,
      appliedBy,
    });
  }

  const wdef = RULES.wind[weather.wind];
  if (wdef && (wdef.auditoryPenalty || wdef.rangedPenalty || wdef.rangedImpossible)) {
    const desc = [];
    if (wdef.auditoryPenalty) desc.push(`${wdef.auditoryPenalty} circumstance penalty to auditory Perception checks`);
    if (wdef.rangedImpossible) desc.push('physical ranged attacks are impossible');
    else if (wdef.rangedPenalty) desc.push(`${wdef.rangedPenalty} circumstance penalty to physical ranged attack rolls`);
    if (wdef.note) desc.push(wdef.note);
    effects.push({
      name: `Weather: ${wdef.label}`,
      value: wdef.rangedPenalty || 0,
      duration: null,
      modifiers: {
        attackBonus: wdef.rangedImpossible ? -99 : (wdef.rangedPenalty || 0),
        description: `[Ranged attacks only] ${desc.join('; ')}`,
      },
      isPreset: true,
      presetKey: `weather-wind-${weather.wind}`,
      appliedBy,
    });
  }

  const fdef = RULES.fog[weather.fog];
  if (fdef && (fdef.perceptionPenalty || fdef.concealment)) {
    const desc = [];
    if (fdef.perceptionPenalty) desc.push(`${fdef.perceptionPenalty} circumstance penalty to visual Perception checks`);
    if (fdef.concealment) desc.push('creatures viewed through significant fog have concealment (DC 5 flat to target)');
    if (fdef.visibility) desc.push(`visibility limited to ${fdef.visibility}`);
    if (fdef.note) desc.push(fdef.note);
    effects.push({
      name: `Weather: ${fdef.label}`,
      value: fdef.perceptionPenalty || 0,
      duration: null,
      modifiers: {
        skillBonus: fdef.perceptionPenalty || 0,
        description: desc.join('; '),
      },
      isPreset: true,
      presetKey: `weather-fog-${weather.fog}`,
      appliedBy,
    });
  }

  return effects;
}

function listChoices(component) {
  if (!RULES) return [];
  const map = RULES[component];
  if (!map) return [];
  return Object.entries(map).map(([key, def]) => ({
    name: def.label || key,
    value: key,
  }));
}

module.exports = {
  RULES,
  listClimates,
  listChoices,
  isValidClimate,
  isValidSeason,
  SEASONS,
  getWeather,
  ensureWeather,
  setClimate,
  setSeason,
  setComponent,
  rollWeather,
  advanceDays,
  getForecast,
  clear,
  describeWeather,
  buildEffectsForCombatant,
  _internal: {
    rollOneDay,
    weightedPick,
    categorizeTemperature,
    stepColder,
  },
};