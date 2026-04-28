// commands/downtime.js
// Simple per-character downtime-day counter with audit log.
//
// Replaced the previous activity-based system (Earn Income + activity registry)
// with a free-floating bank that:
//   • Auto-accrues 1 day per IRL calendar day (UTC) on first interaction.
//   • Hard caps at 200 days banked (extra accrual is clipped, never lost into
//     the void — the system just stops crediting once you're full).
//   • Spends are manual via /downtime spend.
//   • Anyone can grant (audit log keeps people honest, per Viv's call).
//
// State shape (downtime.json — same filename as before, fresh schema):
// {
//   "<userId>": {
//     "<charKey>": {
//       "bank": 12,                        // current spendable balance (0..200)
//       "lastAccrualDate": "2026-04-28",   // YYYY-MM-DD UTC, last day credited
//       "log": [                           // audit trail, oldest first
//         { "ts": "2026-04-28T...", "kind": "accrual", "delta": +3, "balance": 8, "by": null,    "reason": "3 IRL days elapsed" },
//         { "ts": "2026-04-28T...", "kind": "spend",   "delta": -2, "balance": 6, "by": "userId","reason": "research downtime" },
//         { "ts": "2026-04-28T...", "kind": "grant",   "delta": +5, "balance": 11,"by": "userId","reason": "quest reward: Saved village" }
//       ]
//     }
//   }
// }
//
// All functions are PURE — they take a `store` object, mutate it in place, and
// return the result. The caller (index.js) is responsible for loading and
// saving downtime.json. This keeps the engine testable and avoids tying it to
// any specific storage layer.

'use strict';

const MAX_BANK = 200;
const MAX_LOG_ENTRIES = 100; // Cap log size so a year of daily checks doesn't bloat the file
const MAX_GRANT_PER_CALL = 200; // Sanity bound for /downtime grant
const MAX_SPEND_PER_CALL = 200; // Sanity bound for /downtime spend

// ── Date helpers ────────────────────────────────────────────────────────────
// We use UTC YYYY-MM-DD strings as our "day boundary" so accrual is consistent
// regardless of timezone. The day boundary is midnight UTC.
function isoDate(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function daysBetween(fromDateStr, toDateStr) {
  const from = new Date(fromDateStr + 'T00:00:00Z');
  const to   = new Date(toDateStr   + 'T00:00:00Z');
  return Math.floor((to - from) / 86400000);
}

// ── Per-character record helper ─────────────────────────────────────────────
// Lazily creates the {userId, charKey} record if it doesn't exist, seeded with
// today as lastAccrualDate (so first-time use gives 0 days, not a windfall).
//
// SELF-HEALING: If the record exists but is missing fields (e.g. data from the
// old activity-based schema, or a partially-migrated record), this fills in
// the missing fields without losing any existing balance. Any old fields
// (bankHistory, entries) are left in place but ignored — they don't hurt
// anything and keep the data file recoverable if you ever want to look back.
function getCharRecord(store, userId, charKey) {
  if (!store[userId]) store[userId] = {};
  if (!store[userId][charKey]) {
    store[userId][charKey] = {
      bank: 0,
      lastAccrualDate: isoDate(),
      log: [],
    };
    return store[userId][charKey];
  }
  // Heal any missing fields without overwriting existing data.
  const rec = store[userId][charKey];
  if (typeof rec.bank !== 'number') rec.bank = 0;
  if (typeof rec.lastAccrualDate !== 'string') rec.lastAccrualDate = isoDate();
  if (!Array.isArray(rec.log)) rec.log = [];
  return rec;
}

// ── Audit log ───────────────────────────────────────────────────────────────
function appendLog(rec, entry) {
  rec.log.push(entry);
  if (rec.log.length > MAX_LOG_ENTRIES) {
    rec.log = rec.log.slice(-MAX_LOG_ENTRIES);
  }
}

// ── Auto-accrual ────────────────────────────────────────────────────────────
// Brings a character's bank up to date based on IRL calendar days elapsed.
// Idempotent — calling twice on the same day is a no-op.
// Returns { added, capped } where `capped` is days that hit the 200-day ceiling
// and were dropped (so the UI can warn the player).
function accrue(store, userId, charKey) {
  const rec = getCharRecord(store, userId, charKey);
  const today = isoDate();
  const elapsed = daysBetween(rec.lastAccrualDate, today);

  if (elapsed <= 0) {
    return { added: 0, capped: 0, balance: rec.bank };
  }

  const before = rec.bank;
  const wouldBe = before + elapsed;
  const newBank = Math.min(MAX_BANK, wouldBe);
  const added = newBank - before;
  const capped = wouldBe - newBank; // how many days were dropped due to cap

  rec.bank = newBank;
  rec.lastAccrualDate = today;

  if (added > 0) {
    appendLog(rec, {
      ts: new Date().toISOString(),
      kind: 'accrual',
      delta: added,
      balance: newBank,
      by: null,
      reason: `${elapsed} IRL day${elapsed === 1 ? '' : 's'} elapsed${capped > 0 ? ` (capped at ${MAX_BANK}; ${capped} dropped)` : ''}`,
    });
  }

  return { added, capped, balance: newBank };
}

// ── Grant ──────────────────────────────────────────────────────────────────
// Manually add days (e.g. quest rewards). No GM gate — Viv chose audit-based
// honesty over permission gates. Caps at 200; overflow is reported to caller.
function grant(store, userId, charKey, days, reason, byUserId) {
  if (!Number.isInteger(days) || days <= 0) {
    return { ok: false, reason: 'days must be a positive integer' };
  }
  if (days > MAX_GRANT_PER_CALL) {
    return { ok: false, reason: `cannot grant more than ${MAX_GRANT_PER_CALL} days at once` };
  }
  const rec = getCharRecord(store, userId, charKey);
  // Run accrual first so the audit log shows accurate ordering.
  accrue(store, userId, charKey);

  const before = rec.bank;
  const wouldBe = before + days;
  const newBank = Math.min(MAX_BANK, wouldBe);
  const added = newBank - before;
  const capped = wouldBe - newBank;
  rec.bank = newBank;

  appendLog(rec, {
    ts: new Date().toISOString(),
    kind: 'grant',
    delta: added,
    balance: newBank,
    by: byUserId,
    reason: reason || 'no reason given',
  });

  return { ok: true, added, capped, balance: newBank };
}

// ── Spend ──────────────────────────────────────────────────────────────────
// Subtract days for a downtime activity. Reason is required so the audit log
// is meaningful (e.g. "research undead lore", "craft sword +1").
function spend(store, userId, charKey, days, reason, byUserId) {
  if (!Number.isInteger(days) || days <= 0) {
    return { ok: false, reason: 'days must be a positive integer' };
  }
  if (days > MAX_SPEND_PER_CALL) {
    return { ok: false, reason: `cannot spend more than ${MAX_SPEND_PER_CALL} days at once` };
  }
  const rec = getCharRecord(store, userId, charKey);
  // Accrue first so the player gets credit for any pending IRL days before spending.
  accrue(store, userId, charKey);

  if (rec.bank < days) {
    return { ok: false, reason: `not enough days banked (have ${rec.bank}, need ${days})` };
  }

  rec.bank -= days;
  appendLog(rec, {
    ts: new Date().toISOString(),
    kind: 'spend',
    delta: -days,
    balance: rec.bank,
    by: byUserId,
    reason: reason || 'no reason given',
  });

  return { ok: true, balance: rec.bank };
}

// ── Reset ──────────────────────────────────────────────────────────────────
// Wipe a character's downtime state back to 0. GM-side cleanup tool.
function reset(store, userId, charKey, byUserId, reason) {
  const rec = getCharRecord(store, userId, charKey);
  const before = rec.bank;
  rec.bank = 0;
  rec.lastAccrualDate = isoDate();
  // Keep the log so the reset itself is auditable, but trim very old entries.
  appendLog(rec, {
    ts: new Date().toISOString(),
    kind: 'reset',
    delta: -before,
    balance: 0,
    by: byUserId,
    reason: reason || 'manual reset',
  });
  return { ok: true, before, balance: 0 };
}

// ── Read-only accessors ─────────────────────────────────────────────────────
function getStatus(store, userId, charKey) {
  const rec = getCharRecord(store, userId, charKey);
  return {
    bank: rec.bank,
    lastAccrualDate: rec.lastAccrualDate,
    isFull: rec.bank >= MAX_BANK,
    capacity: MAX_BANK,
  };
}

function getLog(store, userId, charKey, limit = 10) {
  const rec = getCharRecord(store, userId, charKey);
  // Return most recent first
  return rec.log.slice(-limit).reverse();
}

module.exports = {
  // Constants
  MAX_BANK,
  MAX_LOG_ENTRIES,
  // Operations
  accrue,
  grant,
  spend,
  reset,
  // Reads
  getStatus,
  getLog,
  // Date helpers (for testing)
  isoDate,
  daysBetween,
};