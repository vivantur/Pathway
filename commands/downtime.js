// downtime.js
// Pathfinder 2e downtime activities tracker.
//
// Conceptual model:
//   - An "entry" is one in-progress (or completed) downtime activity belonging
//     to a specific character. Entries persist across bot restarts via JSON.
//   - Each character also has a "bank" of downtime days awarded by the GM as
//     quest rewards. Banked days can be applied to any in-progress activity.
//   - Real-life days are automatically counted toward in-progress activities:
//     when the player checks status, the bot computes how many calendar days
//     have elapsed since they started and credits them.
//
// State shape (downtime.json):
// {
//   "<userId>": {
//     "<charKey>": {
//       "bank": 0,                          // banked downtime days
//       "bankHistory": [                    // ledger for transparency
//         { "ts": "2026-04-24T...", "delta": +5, "reason": "quest reward" }
//       ],
//       "entries": [
//         {
//           "id": "abc123",                 // short unique id
//           "activity": "earn-income",
//           "status": "in-progress",        // | "completed" | "cancelled"
//           "startedAt": "2026-04-24T20:00:00.000Z",
//           "lastAdvanceDay": "2026-04-24", // YYYY-MM-DD of last credited day
//           "plannedDays": 7,
//           "elapsedDays": 0,
//           "params": { ... activity-specific ... },
//           "result": { ... activity-specific ... },
//         }
//       ]
//     }
//   }
// }

// ── PF2e Income Earned table (Player Core p. 228) ─────────────────────────
// Index = task level (0-20). Each entry has:
//   dc:        DC for the check
//   failed:    cp earned per day on a failure
//   trained, expert, master, legendary: cp earned per day on a success
//                                       at that proficiency rank
// Crit success uses (taskLevel + 1) row's success column (so a level-20 crit
// uses the special "20 (critical success)" entry below).
// All values are stored in copper for clean math; converted on display.
//
// Conversion: 1 sp = 10 cp, 1 gp = 100 cp, 1 pp = 1000 cp.

const INCOME_TABLE = [
  // L=0
  { dc: 14, failed: 1,    trained: 5,    expert: 5,    master: 5,    legendary: 5    },
  // L=1
  { dc: 15, failed: 2,    trained: 20,   expert: 20,   master: 20,   legendary: 20   },
  // L=2
  { dc: 16, failed: 4,    trained: 30,   expert: 30,   master: 30,   legendary: 30   },
  // L=3
  { dc: 18, failed: 8,    trained: 50,   expert: 50,   master: 50,   legendary: 50   },
  // L=4
  { dc: 19, failed: 10,   trained: 70,   expert: 80,   master: 80,   legendary: 80   },
  // L=5
  { dc: 20, failed: 20,   trained: 90,   expert: 100,  master: 100,  legendary: 100  },
  // L=6
  { dc: 22, failed: 30,   trained: 150,  expert: 200,  master: 200,  legendary: 200  },
  // L=7
  { dc: 23, failed: 40,   trained: 200,  expert: 250,  master: 250,  legendary: 250  },
  // L=8
  { dc: 24, failed: 50,   trained: 250,  expert: 300,  master: 300,  legendary: 300  },
  // L=9
  { dc: 26, failed: 60,   trained: 300,  expert: 400,  master: 400,  legendary: 400  },
  // L=10
  { dc: 27, failed: 70,   trained: 400,  expert: 500,  master: 600,  legendary: 600  },
  // L=11
  { dc: 28, failed: 80,   trained: 500,  expert: 600,  master: 800,  legendary: 800  },
  // L=12
  { dc: 30, failed: 90,   trained: 600,  expert: 800,  master: 1000, legendary: 1000 },
  // L=13
  { dc: 31, failed: 100,  trained: 700,  expert: 1000, master: 1500, legendary: 1500 },
  // L=14
  { dc: 32, failed: 150,  trained: 800,  expert: 1500, master: 2000, legendary: 2000 },
  // L=15
  { dc: 34, failed: 200,  trained: 1000, expert: 2000, master: 2800, legendary: 2800 },
  // L=16
  { dc: 35, failed: 250,  trained: 1300, expert: 2500, master: 3600, legendary: 4000 },
  // L=17
  { dc: 36, failed: 300,  trained: 1500, expert: 3000, master: 4500, legendary: 5500 },
  // L=18
  { dc: 38, failed: 400,  trained: 2000, expert: 4500, master: 7000, legendary: 9000 },
  // L=19
  { dc: 39, failed: 600,  trained: 3000, expert: 6000, master: 10000, legendary: 13000 },
  // L=20
  { dc: 40, failed: 800,  trained: 4000, expert: 7500, master: 15000, legendary: 20000 },
];

// L=20 critical success has its own special row per the table.
// (For other levels, a crit just uses the next-level row's success column.)
const INCOME_TABLE_20_CRIT = {
  trained: 5000, expert: 9000, master: 17500, legendary: 30000,
};

// Look up the daily payout for a given level / proficiency / outcome.
// Returns copper pieces.
function dailyIncomeCopper({ taskLevel, profRank, outcome }) {
  // Clamp task level to [0, 20]
  const lvl = Math.max(0, Math.min(20, taskLevel));
  const profKey = profRankKey(profRank);

  if (outcome === 'crit-failure') return 0;
  if (outcome === 'failure') return INCOME_TABLE[lvl].failed;

  if (outcome === 'crit-success') {
    if (lvl === 20) return INCOME_TABLE_20_CRIT[profKey];
    // Use level+1 row's success column for crit (per RAW)
    return INCOME_TABLE[lvl + 1][profKey];
  }
  // success
  return INCOME_TABLE[lvl][profKey];
}

// Map proficiency number (0/2/4/6/8) to table column key.
function profRankKey(profNum) {
  if (profNum >= 8) return 'legendary';
  if (profNum >= 6) return 'master';
  if (profNum >= 4) return 'expert';
  if (profNum >= 2) return 'trained';
  // Untrained can't actually use Earn Income above the trivial level, but if
  // someone tries, treat as trained-equivalent of failure (caller should warn).
  return 'trained';
}

// Format copper pieces as a human-readable PF2e currency string.
// e.g. 158 → "1 gp, 5 sp, 8 cp"; 50 → "5 sp"; 5 → "5 cp"; 1500 → "15 gp"
// We don't promote to platinum — most tables prefer "15 gp" over "1 pp, 5 gp".
function formatCopper(cp) {
  if (cp === 0) return '0 cp';
  const gp = Math.floor(cp / 100);   cp -= gp * 100;
  const sp = Math.floor(cp / 10);    cp -= sp * 10;
  const parts = [];
  if (gp) parts.push(`${gp} gp`);
  if (sp) parts.push(`${sp} sp`);
  if (cp) parts.push(`${cp} cp`);
  return parts.join(', ');
}

// Get the DC for a task level.
function taskLevelDC(taskLevel) {
  const lvl = Math.max(0, Math.min(20, taskLevel));
  return INCOME_TABLE[lvl].dc;
}

// ── Activity registry ────────────────────────────────────────────────────
// Each activity defines its parameters, how it's resolved, and how rewards
// are computed. Future activities (Treat Disease, Subsist, Craft) plug in
// here without changing the tracker.

const ACTIVITIES = {
  'earn-income': {
    name: 'Earn Income',
    summary: 'Use a skill to make money during downtime.',
    source: 'Player Core p. 228',
    // Returns true if the activity is finished (no more days to earn).
    isComplete: (entry) => entry.elapsedDays >= entry.plannedDays,
    // Compute incremental income for newDays additional days.
    creditDays: (entry, newDays) => {
      const perDay = entry.params.dailyIncomeCp ?? 0;
      const earned = perDay * newDays;
      entry.result = entry.result || { totalEarnedCp: 0 };
      entry.result.totalEarnedCp += earned;
      return { addedCp: earned };
    },
  },
};

// ── ID generator (short, human-readable) ──────────────────────────────────
// 6-char alphanumeric IDs are unique enough for one character's active list.
function newEntryId() {
  return Math.random().toString(36).slice(2, 8);
}

// ── Date helpers ──────────────────────────────────────────────────────────
// We track day boundaries as YYYY-MM-DD in UTC for consistency. Each calendar
// day boundary that's elapsed since the entry's lastAdvanceDay = +1 day.

function isoDate(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

// Number of full calendar-day boundaries between two YYYY-MM-DD strings.
// Same day = 0; consecutive days = 1; etc.
function daysBetween(fromDateStr, toDateStr) {
  const from = new Date(fromDateStr + 'T00:00:00Z');
  const to   = new Date(toDateStr   + 'T00:00:00Z');
  return Math.floor((to - from) / 86400000);
}

// ── Per-character helpers ─────────────────────────────────────────────────

function getCharRecord(store, userId, charKey) {
  if (!store[userId]) store[userId] = {};
  if (!store[userId][charKey]) {
    store[userId][charKey] = { bank: 0, bankHistory: [], entries: [] };
  }
  return store[userId][charKey];
}

// ── Bank operations ───────────────────────────────────────────────────────

function awardDays(store, userId, charKey, days, reason = 'GM award') {
  if (days === 0) return null;
  const rec = getCharRecord(store, userId, charKey);
  rec.bank += days;
  rec.bankHistory.push({ ts: new Date().toISOString(), delta: days, reason });
  // Keep history bounded
  if (rec.bankHistory.length > 50) rec.bankHistory = rec.bankHistory.slice(-50);
  return rec.bank;
}

function spendBankedDays(store, userId, charKey, entryId, days) {
  if (days <= 0) return { ok: false, reason: 'must spend at least 1 day' };
  const rec = getCharRecord(store, userId, charKey);
  if (rec.bank < days) return { ok: false, reason: `not enough banked days (have ${rec.bank})` };
  const entry = rec.entries.find(e => e.id === entryId && e.status === 'in-progress');
  if (!entry) return { ok: false, reason: 'no such in-progress activity' };

  const remaining = entry.plannedDays - entry.elapsedDays;
  const toApply = Math.min(days, remaining);
  if (toApply <= 0) return { ok: false, reason: 'activity already finished' };

  // Credit days
  const result = creditEntryDays(entry, toApply);
  rec.bank -= toApply;
  rec.bankHistory.push({
    ts: new Date().toISOString(),
    delta: -toApply,
    reason: `applied to ${entry.activity} (${entry.id})`,
  });
  if (rec.bankHistory.length > 50) rec.bankHistory = rec.bankHistory.slice(-50);

  return { ok: true, daysApplied: toApply, ...result, entry };
}

// ── Entry creation & advancement ──────────────────────────────────────────

function startEntry(store, userId, charKey, activityKey, params, plannedDays) {
  const def = ACTIVITIES[activityKey];
  if (!def) return { ok: false, reason: `unknown activity: ${activityKey}` };
  if (plannedDays <= 0) return { ok: false, reason: 'plannedDays must be positive' };

  const rec = getCharRecord(store, userId, charKey);
  const today = isoDate();
  const entry = {
    id: newEntryId(),
    activity: activityKey,
    status: 'in-progress',
    startedAt: new Date().toISOString(),
    lastAdvanceDay: today, // day 0 — calendar advances start crediting from tomorrow
    plannedDays,
    elapsedDays: 0,
    params: { ...params },
    result: null,
  };
  rec.entries.push(entry);
  return { ok: true, entry };
}

// Internal: credit N days to an entry, returning the activity's payout info.
function creditEntryDays(entry, days) {
  const def = ACTIVITIES[entry.activity];
  if (!def) return {};
  const before = entry.elapsedDays;
  const remaining = entry.plannedDays - before;
  const toCredit = Math.min(days, remaining);
  if (toCredit <= 0) return { addedCp: 0 };

  const payload = def.creditDays(entry, toCredit) || {};
  entry.elapsedDays = before + toCredit;
  if (def.isComplete(entry)) {
    entry.status = 'ready-to-complete';
  }
  return payload;
}

// Bring an entry up to date based on real-life calendar days elapsed.
// Returns { addedDays, addedCp, completed }.
function autoAdvanceEntry(entry) {
  if (entry.status !== 'in-progress' && entry.status !== 'ready-to-complete') {
    return { addedDays: 0, addedCp: 0, completed: false };
  }
  const today = isoDate();
  const elapsedCalendarDays = daysBetween(entry.lastAdvanceDay, today);
  if (elapsedCalendarDays <= 0) {
    return { addedDays: 0, addedCp: 0, completed: entry.status === 'ready-to-complete' };
  }
  const before = entry.elapsedDays;
  const result = creditEntryDays(entry, elapsedCalendarDays);
  entry.lastAdvanceDay = today;
  return {
    addedDays: entry.elapsedDays - before,
    addedCp: result.addedCp ?? 0,
    completed: entry.status === 'ready-to-complete',
  };
}

// Auto-advance ALL entries for a character based on calendar time.
// Returns array of { entry, addedDays, addedCp, completed }.
function autoAdvanceAll(store, userId, charKey) {
  const rec = getCharRecord(store, userId, charKey);
  return rec.entries
    .filter(e => e.status === 'in-progress' || e.status === 'ready-to-complete')
    .map(entry => ({ entry, ...autoAdvanceEntry(entry) }));
}

// Mark an entry completed (player has acknowledged and claimed reward).
function completeEntry(store, userId, charKey, entryId) {
  const rec = getCharRecord(store, userId, charKey);
  const entry = rec.entries.find(e => e.id === entryId);
  if (!entry) return { ok: false, reason: 'no such activity' };
  if (entry.status === 'completed' || entry.status === 'cancelled') {
    return { ok: false, reason: `already ${entry.status}` };
  }
  entry.status = 'completed';
  entry.completedAt = new Date().toISOString();
  return { ok: true, entry };
}

function cancelEntry(store, userId, charKey, entryId) {
  const rec = getCharRecord(store, userId, charKey);
  const entry = rec.entries.find(e => e.id === entryId);
  if (!entry) return { ok: false, reason: 'no such activity' };
  if (entry.status === 'completed' || entry.status === 'cancelled') {
    return { ok: false, reason: `already ${entry.status}` };
  }
  entry.status = 'cancelled';
  entry.cancelledAt = new Date().toISOString();
  return { ok: true, entry };
}

// Hide finished entries from the default listing — they stay in storage for
// history but the player doesn't want to see them every time.
function listActiveEntries(store, userId, charKey) {
  const rec = getCharRecord(store, userId, charKey);
  return rec.entries.filter(e => e.status === 'in-progress' || e.status === 'ready-to-complete');
}

function listAllEntries(store, userId, charKey) {
  const rec = getCharRecord(store, userId, charKey);
  return rec.entries.slice(); // copy
}

function getEntry(store, userId, charKey, entryId) {
  const rec = getCharRecord(store, userId, charKey);
  return rec.entries.find(e => e.id === entryId) || null;
}

function getBank(store, userId, charKey) {
  const rec = getCharRecord(store, userId, charKey);
  return { bank: rec.bank, history: rec.bankHistory.slice() };
}

module.exports = {
  // Activity definitions
  ACTIVITIES,
  // Income table
  INCOME_TABLE,
  dailyIncomeCopper,
  taskLevelDC,
  profRankKey,
  formatCopper,
  // Bank
  awardDays,
  spendBankedDays,
  getBank,
  // Entry lifecycle
  startEntry,
  autoAdvanceEntry,
  autoAdvanceAll,
  completeEntry,
  cancelEntry,
  // Queries
  listActiveEntries,
  listAllEntries,
  getEntry,
  // Date helpers (for testing)
  isoDate,
  daysBetween,
};