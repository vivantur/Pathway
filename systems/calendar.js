// systems/calendar.js
// Golarion (Inner Sea) calendar engine. Per-server state, GM-controlled.
//
// Design notes:
//   - The bot anchors weekday math to a single known fact ("26 Gozran 4712 AR
//     is Fireday") that the user gave us. All other dates are derived by
//     counting days forward or backward. This sidesteps the question of what
//     weekday 1/1/1 AR was — sources disagree, and it doesn't matter.
//   - Leap year rule: PF2e Remaster Core (year % 4 === 0). Adds an extra day
//     to the end of Calistril.
//   - Per-server scope: one calendar state per Discord guild.
//   - Manual advancement only. The GM moves the calendar; nothing auto-ticks.
//   - One-way integration with weather: when the calendar advances or the
//     month changes, we update weather.season to match. Weather can still be
//     used independently if no calendar is set.
//
// Public API:
//   getDate(guildId)                 → current date object or null
//   ensureDate(guildId, opts)        → seed with default if missing
//   setDate(guildId, y, m, d)        → set explicit date (m and d 1-indexed)
//   advance(guildId, days)           → step forward N days (negative for back)
//   describeDate(date, opts)         → human-readable string
//   listHolidays(month?)             → all holidays, optionally filtered by month
//   getHolidaysOn(year, month, day)  → array of holiday objects on that date
//   getNextHoliday(year, month, day) → { holiday, daysAway, occursOn }
//   getMoonPhase(year, month, day)   → { key, name, emoji, dayOfCycle }
//   seasonOf(month)                  → 'spring' | 'summer' | 'autumn' | 'winter'
//   getMonthGrid(year, month)        → 2D array of { day, weekday, isToday, holidays }
//   clear(guildId)
//
// Storage shape (calendar-state.json):
//   { "<guildId>": { year, month, day, updatedAt } }
// Just three numbers — everything else is computed.

'use strict';

const { loadJson, mutateJson } = require('../utils/storage');

const STATE_FILE = 'calendar-state.json';

// ── Static rules data (injected at startup via setRules) ─────────────────────
let RULES = null;
let MONTH_NAMES   = [];
let WEEKDAY_NAMES = [];
let EPOCH_OFFSET  = 0;
let MOON_OFFSET   = 0;

function setRules(data) {
  if (!data) return;
  RULES = data;
  MONTH_NAMES   = RULES.months.map(m => m.name);
  WEEKDAY_NAMES = RULES.weekdays.map(w => w.name);

  const a = RULES.anchor;
  const anchorWeekdayIdx = WEEKDAY_NAMES.indexOf(a.weekday);
  if (anchorWeekdayIdx === -1) {
    console.error(`calendar.js: anchor weekday "${a.weekday}" not found in weekdays list.`);
    EPOCH_OFFSET = 0;
  } else {
    const anchorDays = daysSinceEpoch(a.year, a.month, a.day);
    EPOCH_OFFSET = ((anchorWeekdayIdx - (anchorDays % 7)) % 7 + 7) % 7;
  }

  const cycle = RULES.moon.cycleDays;
  const anchorDays2 = daysSinceEpoch(a.year, a.month, a.day);
  MOON_OFFSET = ((RULES.moon.anchorPhase - (anchorDays2 % cycle)) % cycle + cycle) % cycle;

  module.exports.RULES = RULES;
  module.exports.MONTH_NAMES = MONTH_NAMES;
  module.exports.WEEKDAY_NAMES = WEEKDAY_NAMES;
}

// ── Pure math helpers ────────────────────────────────────────────────────────

function isLeapYear(year) {
  // PF2e: every 4 years, no century rule.
  return Number.isInteger(year) && year % 4 === 0;
}

function monthLength(monthIdx, year) {
  // monthIdx is 0-based.
  if (!RULES) return 30;
  const base = RULES.months[monthIdx]?.days ?? 30;
  // Calistril (index 1) gets a leap day.
  return monthIdx === 1 && isLeapYear(year) ? base + 1 : base;
}

function daysInYear(year) {
  return isLeapYear(year) ? 366 : 365;
}

// Days from 1 Abadius 1 AR (which is "day 0") to start-of-given-date.
// Used internally for weekday and moon-phase math; the absolute value doesn't
// matter, only the differences between dates.
function daysSinceEpoch(year, month, day) {
  // Sum complete years before `year`.
  let total = 0;
  if (year >= 1) {
    for (let y = 1; y < year; y++) total += daysInYear(y);
  } else {
    // Negative-year support (BR, "Before Reckoning"). Subtract.
    for (let y = year; y < 1; y++) total -= daysInYear(y);
  }
  // Sum complete months in the current year.
  for (let m = 0; m < month - 1; m++) total += monthLength(m, year);
  total += (day - 1);
  return total;
}

// Validate that (year, month, day) is a real date. Throws on invalid input.
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

// Add a number of days (can be negative) to a date and return the new date.
// Fast path for small deltas; falls back to days-since-epoch arithmetic for
// big jumps.
function addDays(year, month, day, delta) {
  validateDate(year, month, day);
  if (delta === 0) return { year, month, day };

  // Fast path: walk day by day for small steps. Avoids edge-case math bugs.
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

  // Slow path for big deltas: use absolute day count.
  const target = daysSinceEpoch(year, month, day) + delta;
  return dateFromDayCount(target);
}

// Given an absolute day-count (days since 1/1/1 AR), find the date.
function dateFromDayCount(targetDays) {
  // Year search: walk years from 1 AR until we cross targetDays.
  // (For really negative targetDays, walks backward from year 1.)
  let year = 1;
  let dayInYear = targetDays;
  if (targetDays >= 0) {
    while (true) {
      const dy = daysInYear(year);
      if (dayInYear < dy) break;
      dayInYear -= dy;
      year++;
    }
  } else {
    while (dayInYear < 0) {
      year--;
      dayInYear += daysInYear(year);
    }
  }
  // Now find the month within that year.
  let month = 1;
  while (month <= 12) {
    const ml = monthLength(month - 1, year);
    if (dayInYear < ml) break;
    dayInYear -= ml;
    month++;
  }
  return { year, month, day: dayInYear + 1 };
}

// Weekday for a given date (0 = Moonday, etc.).
function weekdayIndex(year, month, day) {
  return ((daysSinceEpoch(year, month, day) + EPOCH_OFFSET) % 7 + 7) % 7;
}
function weekdayName(year, month, day) {
  return WEEKDAY_NAMES[weekdayIndex(year, month, day)];
}

// Map month index to season key.
function seasonOf(month) {
  if (!RULES) return 'spring';
  const mKey = RULES.months[month - 1]?.key;
  for (const [skey, sdef] of Object.entries(RULES.seasons)) {
    if (skey === '_comment') continue;
    if (sdef.monthsByKey?.includes(mKey)) return skey;
  }
  return 'spring';
}

// Moon phase for a date.
function getMoonPhase(year, month, day) {
  if (!RULES) return null;
  const cycle = RULES.moon.cycleDays;
  const dayInCycle = ((daysSinceEpoch(year, month, day) + MOON_OFFSET) % cycle + cycle) % cycle;
  const phase = RULES.moon.phases.find(p => dayInCycle >= p.min && dayInCycle <= p.max)
             || RULES.moon.phases[0];
  return { ...phase, dayOfCycle: dayInCycle, cycleDays: cycle };
}

// ── Holidays ─────────────────────────────────────────────────────────────────

function listHolidays(month = null) {
  if (!RULES) return [];
  const all = RULES.holidays || [];
  return month == null ? all.slice() : all.filter(h => h.month === month);
}

function getHolidaysOn(year, month, day) {
  return listHolidays(month).filter(h => h.day === day);
}

// Find the next holiday on or after the given date. Returns a description
// including how many days away it is. Searches up to ~400 days forward so we
// always find something (every month has at least one holiday in our list).
function getNextHoliday(year, month, day) {
  if (!RULES) return null;
  let cur = { year, month, day };
  for (let i = 0; i < 400; i++) {
    const hits = getHolidaysOn(cur.year, cur.month, cur.day);
    if (hits.length > 0 && i > 0) {
      // Skip "today" — we want the next *future* holiday.
      return { holiday: hits[0], daysAway: i, occursOn: cur };
    }
    if (hits.length > 0 && i === 0) {
      // If today IS a holiday, return the *following* one. Callers who want
      // "today's holidays" should use getHolidaysOn directly.
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
  const yr = includeYear ? `, ${date.year} AR` : '';
  return `${wd}${ordinal(date.day)} of ${monthName}${yr}`;
}

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// Build a 2D grid of weeks × weekdays for a month. Each cell is either null
// (padding) or a { day, weekday, isToday, holidays } object. Used by
// /calendar month for the embed view.
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

function loadState() {
  return loadJson(STATE_FILE, { default: {}, quiet: true }) || {};
}

function getDate(guildId) {
  const state = loadState();
  const entry = state[String(guildId)];
  if (!entry) return null;
  return { year: entry.year, month: entry.month, day: entry.day };
}

// Default seed: the anchor date itself.
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
  // Pure math (no state)
  isLeapYear,
  monthLength,
  daysInYear,
  daysSinceEpoch,
  addDays,
  weekdayIndex,
  weekdayName,
  seasonOf,
  getMoonPhase,
  validateDate,
  // Holidays
  listHolidays,
  getHolidaysOn,
  getNextHoliday,
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
  setRules,
};
