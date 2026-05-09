// systems/weather.js
// PF2e Remaster weather engine. Per-server (guild) state. GM-controlled
// advancement only — no auto-ticking. Stored in weather-state.json on the
// volume so weather persists across redeploys.
//
// Public API (everything index.js or commands need):
//   getWeather(guildId)            → current weather entry, or null
//   ensureWeather(guildId, opts)   → create-if-missing helper for first use
//   setClimate(guildId, climate, season)
//   setComponent(guildId, component, value)   // 'temperature', 'precipitation', 'wind', 'fog'
//   rollWeather(guildId, opts)                // re-rolls today
//   advanceDays(guildId, n)                   // step forward, rolling each day
//   getForecast(guildId, days)                // peek without committing
//   clear(guildId)
//   describeWeather(weather)                  // human-readable summary
//   buildEffectsForCombatant(weather)         // returns array of effects to apply via /init effect
//
// Storage shape (weather-state.json):
//   {
//     "<guildId>": {
//       climate: 'temperate',
//       season: 'autumn',
//       day: 12,                      // in-game day counter (just for display)
//       current: { temperatureF, temperatureCategory, precipitation, wind, fog, soaked },
//       yesterday: { ... same shape ... },     // used for persistence
//       history: [ { day, ...weather }, ... ], // last 7 days
//       updatedAt: ISO string
//     }
//   }

'use strict';

const { loadJson, mutateJson } = require('../utils/storage');

let RULES = null;

function setRules(data) {
  RULES = data ?? null;
  module.exports.RULES = RULES;
}

const STATE_FILE = 'weather-state.json';
const SEASONS = ['spring', 'summer', 'autumn', 'winter'];

// ── Generic helpers ──────────────────────────────────────────────────────────

// Pick a key from a {key: weight} table. Optional `boostKey` gets a multiplier
// (used for persistence: yesterday's value is more likely to recur).
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
  return adjusted[adjusted.length - 1][0]; // floating-point safety
}

// Find which named temperature category a Fahrenheit value falls into.
function categorizeTemperature(f) {
  if (!RULES) return 'normal';
  for (const [key, def] of Object.entries(RULES.temperature)) {
    const [lo, hi] = def.rangeF;
    if (f >= lo && f <= hi) return key;
  }
  // Out of bounds — clamp to extremes
  return f < 0 ? 'incredibleCold' : 'incredibleHeat';
}

// Random integer in [min, max] inclusive.
function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// ── Climate / season validation ──────────────────────────────────────────────
function isValidClimate(climate)   { return RULES && Object.prototype.hasOwnProperty.call(RULES.climates, climate); }
function isValidSeason(season)     { return SEASONS.includes(season); }

function listClimates() {
  if (!RULES) return [];
  return Object.entries(RULES.climates).map(([key, def]) => ({
    key, label: def.label, description: def.description, emoji: def.emoji,
  }));
}

// ── Core rolling logic ───────────────────────────────────────────────────────
// Roll a fresh weather state for a guild, optionally biased by yesterday's
// values (for continuity).
function rollOneDay(climate, season, yesterday = null) {
  if (!isValidClimate(climate) || !isValidSeason(season)) {
    return null;
  }
  const cdef = RULES.climates[climate];
  const sdef = cdef.seasons[season];
  const { precipitation: pp, wind: ww, fog: ff, persistence: per = {} } = {
    precipitation: sdef.precipitation,
    wind: sdef.wind,
    fog: sdef.fog,
    persistence: RULES.persistence,
  };

  const precipitation = weightedPick(pp, yesterday?.precipitation, RULES.persistence.precipitation);
  const wind          = weightedPick(ww, yesterday?.wind,          RULES.persistence.wind);
  const fog           = weightedPick(ff, yesterday?.fog,           RULES.persistence.fog);

  // Temperature: roll within the season's range, with optional drift toward
  // yesterday's value. This avoids "70°F → 25°F → 70°F" yo-yo days.
  const [lo, hi] = sdef.tempRangeF;
  let temperatureF;
  if (yesterday && typeof yesterday.temperatureF === 'number') {
    const drift = RULES.persistence.tempDriftF;
    const target = randInt(lo, hi);
    // Move halfway from yesterday toward the new target, plus jitter.
    const blended = Math.round((yesterday.temperatureF + target) / 2);
    temperatureF = blended + randInt(-drift, drift);
  } else {
    const variance = sdef.tempVarianceF || 0;
    temperatureF = randInt(lo, hi) + randInt(-variance, variance);
  }
  // Hard clamp so we don't generate -200°F by piling on jitter.
  temperatureF = Math.max(-100, Math.min(150, temperatureF));

  // "Soaked" applies if the precipitation soaks the character. The PF2e rule
  // is that soaked characters treat the temperature as one step colder, so
  // we precompute that once and store both the actual and effective category.
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

// Cold-stepping ladder. Names mirror RULES.temperature keys.
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

// Create a default state on first use. Defaults: temperate / spring / day 1.
async function ensureWeather(guildId, { climate = 'temperate', season = 'spring' } = {}) {
  const key = String(guildId);
  return mutateJson(STATE_FILE, { default: {} }, (state) => {
    if (state[key]) return state; // already exists, no-op
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
    // Re-roll today's weather under the new climate so it's consistent.
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

// Override one component (temp / precip / wind / fog) without re-rolling others.
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

// Advance N days. Each day's weather influences the next.
async function advanceDays(guildId, n) {
  if (!Number.isInteger(n) || n <= 0) throw new Error('Days must be a positive integer.');
  if (n > 30) throw new Error('Cannot advance more than 30 days at a time.');
  const key = String(guildId);
  return mutateJson(STATE_FILE, { default: {} }, (state) => {
    const entry = state[key];
    if (!entry) throw new Error('No weather state for this guild yet. Use /weather climate first.');
    let prev = entry.current;
    for (let i = 0; i < n; i++) {
      // Push prev into history before overwriting
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

// Peek at the next N days WITHOUT committing them. Used by /weather forecast.
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

// ── Description helpers (used by the slash command) ──────────────────────────

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

// Build a list of effect objects (compatible with encounters.addEffect) that
// represent the current weather's mechanical effects on a combatant.
//
// Effect shape matches systems/effects.js convention:
//   { name, value, duration, modifiers: {...}, isPreset: true, presetKey, appliedBy }
//
// duration: null = until removed (weather effects persist until weather changes)
function buildEffectsForCombatant(weather, { appliedBy = 'weather' } = {}) {
  if (!weather) return [];
  const effects = [];

  // --- Temperature ---
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

  // --- Precipitation ---
  const pdef = RULES.precipitation[weather.precipitation];
  if (pdef && (pdef.perceptionPenalty || pdef.fatigue || pdef.lightning)) {
    const desc = [];
    if (pdef.perceptionPenalty) desc.push(`${pdef.perceptionPenalty} circumstance penalty to visual Perception checks`);
    if (pdef.fatigue) desc.push(`fatigues after ${pdef.fatigue === '4h' ? '4 hours' : pdef.fatigue} of travel`);
    if (pdef.lightning) {
      const tier = RULES.damageTiers[pdef.lightning.tier];
      desc.push(`small chance of lightning strike per hour (~${(pdef.lightning.chancePerHour * 100).toFixed(1)}%, ${tier.dice} ${pdef.lightning.type} damage)`);
    }
    if (pdef.soaked) desc.push('soaked: temperature treated one step colder');
    effects.push({
      name: `Weather: ${pdef.label}`,
      value: pdef.perceptionPenalty || 0,
      duration: null,
      modifiers: {
        skillBonus: pdef.perceptionPenalty || 0, // visual Perception is a skill check
        description: desc.join('; '),
      },
      isPreset: true,
      presetKey: `weather-precip-${weather.precipitation}`,
      appliedBy,
    });
  }

  // --- Wind ---
  const wdef = RULES.wind[weather.wind];
  if (wdef && (wdef.auditoryPenalty || wdef.rangedPenalty || wdef.rangedImpossible)) {
    const desc = [];
    if (wdef.auditoryPenalty) desc.push(`${wdef.auditoryPenalty} circumstance penalty to auditory Perception checks`);
    if (wdef.rangedImpossible) desc.push('physical ranged attacks are impossible');
    else if (wdef.rangedPenalty) desc.push(`${wdef.rangedPenalty} circumstance penalty to physical ranged attack rolls (arrows, etc.)`);
    if (wdef.note) desc.push(wdef.note);
    effects.push({
      name: `Weather: ${wdef.label}`,
      value: wdef.rangedPenalty || 0,
      duration: null,
      modifiers: {
        // Wind hits ranged attacks specifically (not melee), but our effect
        // model only has a generic attackBonus. Track it there with a note in
        // the description so GMs can apply it manually for ranged only.
        attackBonus: wdef.rangedImpossible ? -99 : (wdef.rangedPenalty || 0),
        description: `[Ranged attacks only] ${desc.join('; ')}`,
      },
      isPreset: true,
      presetKey: `weather-wind-${weather.wind}`,
      appliedBy,
    });
  }

  // --- Fog ---
  const fdef = RULES.fog[weather.fog];
  if (fdef && (fdef.perceptionPenalty || fdef.concealment)) {
    const desc = [];
    if (fdef.perceptionPenalty) desc.push(`${fdef.perceptionPenalty} circumstance penalty to visual Perception checks`);
    if (fdef.concealment) desc.push('creatures viewed through significant fog have concealment (DC 5 flat to target)');
    if (fdef.visibility) desc.push(`visibility limited to ${fdef.visibility}`);
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

// ── Choices for slash command autocomplete / dropdowns ────────────────────────
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
  // Static data accessors
  RULES,
  listClimates,
  listChoices,
  isValidClimate,
  isValidSeason,
  SEASONS,
  // State management
  getWeather,
  ensureWeather,
  setClimate,
  setSeason,
  setComponent,
  rollWeather,
  advanceDays,
  getForecast,
  clear,
  // Output helpers
  describeWeather,
  buildEffectsForCombatant,
  setRules,
  // Internal helpers, exported for testing
  _internal: {
    rollOneDay,
    weightedPick,
    categorizeTemperature,
    stepColder,
  },
};
