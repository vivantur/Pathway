// systems/eberronCalendar.js
// Eberron (Galifar) calendar engine. Same per-guild state model as Golarion.
//
// Differences from Golarion:
//   • 336-day year (12 × 28), NO leap years — Eberron has perfect 4-week months.
//   • 7-day week: Sul, Mol, Zol, Wir, Zor, Far, Sar (Sul = first day of week).
//   • Year format: YK ("Years of the Kingdom"), default 998 YK.
//   • TWELVE moons each with their own full-to-full cycle. Olarune (56-day,
//     8 weeks) is shown as the "primary" moon by default — most narratively
//     important due to lycanthropy and the Day of Mourning anchor — but
//     getAllMoonPhases returns all twelve.
//   • Holidays support weekday-based occurrences (e.g. Tain Gala = first Far
//     of every month) in addition to fixed-date holidays.
//
// Storage: shares STATE_FILE with the Golarion engine (calendar-state.json),
// but each guild's state is keyed independently. Because the format is just
// {year, month, day, updatedAt}, Eberron and Golarion data don't conflict —
// the dispatcher in commands/calendar-cmd.js picks the right engine per guild
// based on the campaignSetting.
//
// Public API: matches systems/calendar.js exactly so the cmd file can swap
// between them by reference. Plus eberron-specific:
//   getAllMoonPhases(year, month, day) → array of 12 phase objects, one per moon.
//   getPrimaryMoonPhase(date) — alias for getMoonPhase, the headline moon.

'use strict';

const path = require('path');
const fs = require('fs');
const { loadJson, mutateJson } = require('../utils/storage');

// ── Static rules data ────────────────────────────────────────────────────────
const RULES = (() => {
  try {
    return JSON.parse(fs.readFileSync(
      path.join(__dirname, '..', 'gamedata', 'eberron-calendar.json'),
      'utf8'
    ));
  } catch (err) {
    console.error('eberronCalendar.js: failed to load gamedata/eberron-calendar.json:', err.message);
    return null;
  }
})();

const STATE_FILE = 'calendar-state.json';

// ── Constants derived from the data file ─────────────────────────────────────
const MONTH_NAMES   = RULES ? RULES.months.map(m => m.name) : [];
const WEEKDAY_NAMES = RULES ? RULES.weekdays.map(w => w.name) : [];

// Compute the "epoch offset" — days to add so anchor date lands on configured weekday.
const EPOCH_OFFSET = (() => {
  if (!RULES) return 0;
  const a = RULES.anchor;
  const anchorWeekdayIdx = WEEKDAY_NAMES.indexOf(a.weekday);
  if (anchorWeekdayIdx === -1) {
    console.error(`eberronCalendar.js: anchor weekday "${a.weekday}" not found in weekdays list.`);
    return 0;
  }
  const anchorDays = daysSinceEpoch(a.year, a.month, a.day);
  return ((anchorWeekdayIdx - (anchorDays % 7)) % 7 + 7) % 7;
})();

// Per-moon offset map. Each moon gets its own anchor calculation so all 12
// can be queried at once via getAllMoonPhases.
const MOON_OFFSETS = (() => {
  if (!RULES) return {};
  const offsets = {};
  const anchorDays = daysSinceEpoch(RULES.anchor.year, RULES.anchor.month, RULES.anchor.day);
  for (const moon of (RULES.moons || [])) {
    const cycle = moon.cycleDays;
    offsets[moon.key] = ((moon.anchorPhase - (anchorDays % cycle)) % cycle + cycle) % cycle;
  }
  return offsets;
})();

// Primary moon offset — headline moon shown by default (Olarune).
const PRIMARY_MOON_OFFSET = (() => {
  if (!RULES) return 0;
  const cycle = RULES.moon.cycleDays;
  const anchorDays = daysSinceEpoch(RULES.anchor.year, RULES.anchor.month, RULES.anchor.day);
  return ((RULES.moon.anchorPhase - (anchorDays % cycle)) % cycle + cycle) % cycle;
})();

// ── Pure math helpers ────────────────────────────────────────────────────────

// Eberron has NO leap years. Always exactly 336 days. We keep the function
// for API parity with Golarion but it always returns false.
function isLeapYear(_year) {
  return false;
}

function monthLength(monthIdx, _year) {
  if (!RULES) return 28;
  return RULES.months[monthIdx]?.days ?? 28;
}

function daysInYear(_year) {
  return 336; // 12 × 28, always
}

// Days from 1 Zarantyr 1 YK to start-of-given-date.
function daysSinceEpoch(year, month, day) {
  let total = 0;
  if (year >= 1) {
    for (let y = 1; y < year; y++) total += daysInYear(y);
  } else {
    for (let y = year; y < 1; y++) total -= daysInYear(y);
  }
  for (let m = 0; m < month - 1; m++) total += monthLength(m, year);
  total += (day - 1);
  return total;
}

function validateDate(year, month, day) {
  if (!Number.isInteger(year)) throw new Error('Year must be an integer.');
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error('Month must be 1-12.');
  }
  if (!Number.isInteger(day) || day < 1) {
    throw new Error('Day must be a positive integer.');
  }
  const max = monthLength(month - 1, year);
  if (day > max) {
    throw new Error(`${MONTH_NAMES[month - 1]} ${year} only has ${max} days.`);
  }
}

function addDays(year, month, day, delta) {
  validateDate(year, month, day);
  if (delta === 0) return { year, month, day };

  if (Math.abs(delta) < 400) {
    let y = year, m = month, d = day;
    while (delta > 0) {
      d++;
      if (d > monthLength(m - 1, y)) {
        d = 1; m++;
        if (m > 12) { m = 1; y++; }
      }
      delta--;
    }
    while (delta < 0) {
      d--;
      if (d < 1) {
        m--;
        if (m < 1) { m = 12; y--; }
        d = monthLength(m - 1, y);
      }
      delta++;
    }
    return { year: y, month: m, day: d };
  }

  const target = daysSinceEpoch(year, month, day) + delta;
  return dateFromDayCount(target);
}

function dateFromDayCount(targetDays) {
  let year = 1;
  let dayInYear = targetDays;
  if (targetDays >= 0) {
    while (dayInYear >= daysInYear(year)) { dayInYear -= daysInYear(year); year++; }
  } else {
    while (dayInYear < 0) {
      year--;
      dayInYear += daysInYear(year);
    }
  }
  let month = 1;
  while (month <= 12) {
    const ml = monthLength(month - 1, year);
    if (dayInYear < ml) break;
    dayInYear -= ml;
    month++;
  }
  return { year, month, day: dayInYear + 1 };
}

function weekdayIndex(year, month, day) {
  return ((daysSinceEpoch(year, month, day) + EPOCH_OFFSET) % 7 + 7) % 7;
}
function weekdayName(year, month, day) {
  return WEEKDAY_NAMES[weekdayIndex(year, month, day)];
}

function seasonOf(month) {
  if (!RULES) return 'spring';
  const mKey = RULES.months[month - 1]?.key;
  for (const [skey, sdef] of Object.entries(RULES.seasons)) {
    if (skey === '_comment') continue;
    if (sdef.monthsByKey?.includes(mKey)) return skey;
  }
  return 'spring';
}

// ── Moon phases ──────────────────────────────────────────────────────────────

// Compute one moon's phase by its individual cycle.
function computeMoonPhase(moonDef, year, month, day) {
  if (!moonDef) return null;
  const cycle = moonDef.cycleDays;
  const offset = MOON_OFFSETS[moonDef.key] ?? 0;
  const dayInCycle = ((daysSinceEpoch(year, month, day) + offset) % cycle + cycle) % cycle;
  // Each moon uses the SAME phase definitions (new/waxing/full/waning) but
  // its phase boundaries scale with its cycle length so e.g. a 28-day moon
  // (Nymm) is "full" for ~3 days while a 105-day moon (Barrakas) is full for
  // ~13 days. We map proportionally.
  const phaseRefCycle = RULES.moon.cycleDays; // 56 days reference
  const scale = cycle / phaseRefCycle;
  const phase = RULES.moon.phases.find(p => {
    const lo = p.min * scale;
    const hi = (p.max + 1) * scale - 0.0001; // -epsilon for boundary precision
    return dayInCycle >= lo && dayInCycle <= hi;
  }) || RULES.moon.phases[RULES.moon.phases.length - 1];
  return {
    moon: moonDef.key,
    moonName: moonDef.name,
    color: moonDef.color,
    dragonmark: moonDef.dragonmark,
    blurb: moonDef.blurb,
    cycleDays: cycle,
    dayOfCycle: Math.floor(dayInCycle),
    key: phase.key,
    name: phase.name,
    emoji: phase.emoji,
  };
}

// Primary moon — Olarune by canon. Same shape as Golarion's getMoonPhase.
function getMoonPhase(year, month, day) {
  if (!RULES) return null;
  const olarune = (RULES.moons || []).find(m => m.key === 'olarune') || (RULES.moons || [])[0];
  if (!olarune) return null;
  return computeMoonPhase(olarune, year, month, day);
}

// All 12 moons in one go. Used by /calendar moon to show the full sky.
function getAllMoonPhases(year, month, day) {
  if (!RULES || !RULES.moons) return [];
  return RULES.moons.map(m => computeMoonPhase(m, year, month, day));
}

// Alias for clarity in the cmd file.
function getPrimaryMoonPhase(year, month, day) {
  return getMoonPhase(year, month, day);
}

// ── Holidays ─────────────────────────────────────────────────────────────────

// Return all fixed-date holidays for a given month (or all months).
function listHolidays(month = null) {
  if (!RULES) return [];
  const all = (RULES.holidays || []).filter(h => h.month != null);
  return month == null ? all.slice() : all.filter(h => h.month === month);
}

// Compute weekday-based holidays for a given month (e.g. "first Far of month").
// Returns the resolved day numbers so they can mix with fixed-date holidays.
function resolveWeekdayHolidays(year, month) {
  if (!RULES) return [];
  const out = [];
  const monthLen = monthLength(month - 1, year);
  const recurring = (RULES.holidays || []).filter(h => h.month == null && h.weekday);
  for (const h of recurring) {
    const wdIdx = WEEKDAY_NAMES.indexOf(h.weekday);
    if (wdIdx === -1) continue;
    // Find the correct occurrence in the month
    if (h.weekOf === 'first' || !h.weekOf) {
      for (let d = 1; d <= 7; d++) {
        if (weekdayIndex(year, month, d) === wdIdx) {
          out.push({ ...h, month, day: d, _resolved: true });
          break;
        }
      }
    } else if (h.weekOf === 'last') {
      for (let d = monthLen; d > monthLen - 7; d--) {
        if (weekdayIndex(year, month, d) === wdIdx) {
          out.push({ ...h, month, day: d, _resolved: true });
          break;
        }
      }
    } else if (h.weekOf === 'every') {
      // Every occurrence of this weekday in the month (4 occurrences)
      for (let d = 1; d <= monthLen; d++) {
        if (weekdayIndex(year, month, d) === wdIdx) {
          out.push({ ...h, month, day: d, _resolved: true });
        }
      }
    }
  }
  return out;
}

// All holidays on a specific date — fixed-date AND weekday-resolved.
function getHolidaysOn(year, month, day) {
  const fixed = listHolidays(month).filter(h => h.day === day);
  const recur = resolveWeekdayHolidays(year, month).filter(h => h.day === day);
  return [...fixed, ...recur];
}

// Find the next holiday on or after the given date.
function getNextHoliday(year, month, day) {
  if (!RULES) return null;
  let cur = { year, month, day };
  for (let i = 0; i < 400; i++) {
    const hits = getHolidaysOn(cur.year, cur.month, cur.day);
    if (hits.length > 0 && i > 0) {
      return { holiday: hits[0], daysAway: i, occursOn: cur };
    }
    cur = addDays(cur.year, cur.month, cur.day, 1);
  }
  return null;
}

// ── Description helpers ─────────────────────────────────────────────────────

function describeDate(date, { includeWeekday = true, includeYear = true } = {}) {
  if (!date) return '(no date)';
  const monthName = MONTH_NAMES[date.month - 1] || `Month ${date.month}`;
  const wd = includeWeekday ? weekdayName(date.year, date.month, date.day) + ', ' : '';
  const yr = includeYear ? `, ${date.year} YK` : '';
  return `${wd}${ordinal(date.day)} of ${monthName}${yr}`;
}

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function getMonthGrid(year, month, today = null) {
  if (!RULES) return [];
  const len = monthLength(month - 1, year);
  const firstWeekday = weekdayIndex(year, month, 1);
  const grid = [];
  let week = new Array(firstWeekday).fill(null);
  for (let d = 1; d <= len; d++) {
    const wd = (firstWeekday + d - 1) % 7;
    const cell = {
      day: d,
      weekday: wd,
      isToday: !!(today && today.year === year && today.month === month && today.day === d),
      holidays: getHolidaysOn(year, month, d),
    };
    week.push(cell);
    if (week.length === 7) { grid.push(week); week = []; }
  }
  if (week.length > 0) {
    while (week.length < 7) week.push(null);
    grid.push(week);
  }
  return grid;
}

// ── State management (per guild) ────────────────────────────────────────────
// Same storage file as Golarion — they don't collide because guildId is unique.

function loadState() {
  return loadJson(STATE_FILE, { default: {}, quiet: true }) || {};
}

function getDate(guildId) {
  const state = loadState();
  const entry = state[String(guildId)];
  if (!entry) return null;
  return { year: entry.year, month: entry.month, day: entry.day };
}

async function ensureDate(guildId, { year = null, month = null, day = null } = {}) {
  const key = String(guildId);
  const seedYear  = year  ?? RULES.anchor.year;
  const seedMonth = month ?? RULES.anchor.month;
  const seedDay   = day   ?? RULES.anchor.day;
  validateDate(seedYear, seedMonth, seedDay);
  return mutateJson(STATE_FILE, { default: {} }, (state) => {
    if (state[key]) return state;
    state[key] = {
      year: seedYear, month: seedMonth, day: seedDay,
      updatedAt: new Date().toISOString(),
    };
    return state;
  });
}

async function setDate(guildId, year, month, day) {
  validateDate(year, month, day);
  const key = String(guildId);
  return mutateJson(STATE_FILE, { default: {} }, (state) => {
    state[key] = {
      year, month, day,
      updatedAt: new Date().toISOString(),
    };
    return state;
  });
}

async function advance(guildId, deltaDays) {
  if (!Number.isInteger(deltaDays)) throw new Error('Days must be an integer.');
  const key = String(guildId);
  return mutateJson(STATE_FILE, { default: {} }, (state) => {
    const entry = state[key];
    if (!entry) throw new Error('No calendar set for this server. Use /calendar set first.');
    const next = addDays(entry.year, entry.month, entry.day, deltaDays);
    state[key] = {
      year: next.year, month: next.month, day: next.day,
      updatedAt: new Date().toISOString(),
    };
    return state;
  });
}

async function clear(guildId) {
  const key = String(guildId);
  return mutateJson(STATE_FILE, { default: {} }, (state) => {
    delete state[key];
    return state;
  });
}

// ── Exports ──────────────────────────────────────────────────────────────────
module.exports = {
  // Static data
  RULES,
  MONTH_NAMES,
  WEEKDAY_NAMES,
  // Pure math
  isLeapYear,
  monthLength,
  daysInYear,
  daysSinceEpoch,
  addDays,
  weekdayIndex,
  weekdayName,
  seasonOf,
  getMoonPhase,
  getAllMoonPhases,
  getPrimaryMoonPhase,
  validateDate,
  // Holidays
  listHolidays,
  getHolidaysOn,
  getNextHoliday,
  resolveWeekdayHolidays,
  // Description / formatting
  describeDate,
  ordinal,
  getMonthGrid,
  // State management
  getDate,
  ensureDate,
  setDate,
  advance,
  clear,
};