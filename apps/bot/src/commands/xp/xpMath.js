// ── commands/xp/xpMath.js ───────────────────────────────────────────────────
// Pure XP arithmetic + the award mutation. No Discord, no I/O.
//
// `awardXp` is the central mutation for /xp award: it adds amount to the
// character's XP, appends to the bot-managed log (capped at 100 entries),
// and reports whether the change crossed a 1000-XP threshold so the
// caller can show a level-up embed.

const { xpToNextLevel } = require('../../lib/format');
const { getCharacterXp } = require('../../state/characters');

// Award XP and record it in charEntry.xpLog. Mutates charEntry in place.
// Returns { oldXp, newXp, leveledUp }.
function awardXp(charEntry, amount, reason, awarderId) {
  const oldXp = getCharacterXp(charEntry);
  const newXp = Math.max(0, Math.floor(oldXp + amount));
  charEntry.xp = newXp;
  if (!Array.isArray(charEntry.xpLog)) charEntry.xpLog = [];
  charEntry.xpLog.push({
    amount: Math.floor(amount),
    reason: reason ?? null,
    at: new Date().toISOString(),
    awardedBy: awarderId ?? null,
    oldXp,
    newXp,
  });
  // Keep a useful campaign audit trail without letting the row grow forever.
  while (charEntry.xpLog.length > 100) charEntry.xpLog.shift();
  // Leveled up if we crossed a 1000-XP threshold this award.
  const cap = xpToNextLevel();
  const oldLevels = Math.floor(oldXp / cap);
  const newLevels = Math.floor(newXp / cap);
  const leveledUp = newLevels > oldLevels;
  return { oldXp, newXp, leveledUp };
}

module.exports = { awardXp };
