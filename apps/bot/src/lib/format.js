// utils/format.js
// Pure formatting helpers. These functions take primitives (numbers, strings,
// small plain objects) and return formatted display strings. No I/O, no state.
// Safe to import from anywhere.

'use strict';

// ── Ability mods ─────────────────────────────────────────────────────────────

// Turn an ability score (e.g. 14) into a signed modifier string (e.g. "+2").
function getMod(score) {
  const mod = Math.floor((score - 10) / 2);
  return mod >= 0 ? `+${mod}` : `${mod}`;
}

// Turn a raw number into a signed string ("+3" / "-1" / "+0").
function fmt(n) { return n >= 0 ? `+${n}` : `${n}`; }

// Same thing, but tolerates null/undefined (returns null so callers can skip).
function fmtMod(n) {
  if (n === undefined || n === null) return null;
  return n >= 0 ? `+${n}` : `${n}`;
}

// PF2e proficiency math: 0 untrained, 2 trained, 4 expert, 6 master, 8 legendary.
// Trained+ gets level added; untrained stays at 0.
function calcProfNum(profNum, level) {
  if (!profNum || profNum === 0) return 0;
  return profNum + level;
}

// ── Currency (copper-piece math, PF2e-style pp/gp/sp/cp) ─────────────────────

// Convert a wallet object { pp, gp, sp, cp } into a total in copper.
function walletToCopper(wallet) {
  return (wallet.cp ?? 0) + (wallet.sp ?? 0) * 10 + (wallet.gp ?? 0) * 100 + (wallet.pp ?? 0) * 1000;
}

// Convert a copper total back into a breakdown wallet.
function copperToWallet(total) {
  const pp = Math.floor(total / 1000); total %= 1000;
  const gp = Math.floor(total / 100);  total %= 100;
  const sp = Math.floor(total / 10);   total %= 10;
  return { pp, gp, sp, cp: total };
}

// Format a wallet object as a human-readable coin string: "2 gp, 5 sp".
function formatWallet(wallet) {
  const parts = [];
  if (wallet.pp) parts.push(`${wallet.pp} pp`);
  if (wallet.gp) parts.push(`${wallet.gp} gp`);
  if (wallet.sp) parts.push(`${wallet.sp} sp`);
  if (wallet.cp || parts.length === 0) parts.push(`${wallet.cp ?? 0} cp`);
  return parts.join(', ');
}

// Format a raw copper-piece total into PF2e coinage. Only shows nonzero denominations.
function formatCp(cp) {
  if (!cp) return '0 gp';
  const pp = Math.floor(cp / 1000);
  const gp = Math.floor((cp % 1000) / 100);
  const sp = Math.floor((cp % 100) / 10);
  const cpLeft = cp % 10;
  const parts = [];
  if (pp) parts.push(`${pp} pp`);
  if (gp) parts.push(`${gp} gp`);
  if (sp) parts.push(`${sp} sp`);
  if (cpLeft) parts.push(`${cpLeft} cp`);
  return parts.join(', ') || '0 gp';
}

// ── Bulk (PF2e encumbrance: 1 Bulk = 10 Light, "—" = negligible) ─────────────

// Convert normalized bulk text ("1", "L", "—") into light units (tenths of Bulk).
// Returns null for unparseable input so callers can warn about the item.
function bulkToLightUnits(bulkNormalized) {
  if (bulkNormalized == null) return 0; // treat missing as negligible
  const s = String(bulkNormalized).trim().toLowerCase();
  if (s === '' || s === '—' || s === '-' || s === 'negligible' || s === '0') return 0;
  if (s === 'l' || s === 'light') return 1;
  const n = parseFloat(s);
  if (Number.isFinite(n)) return Math.round(n * 10);
  return null;
}

// Format a light-unit total back into PF2e bulk notation: "3 Bulk, 2 L" / "5 L" / "—".
function formatBulk(lightUnits) {
  if (!lightUnits) return '—';
  const bulk = Math.floor(lightUnits / 10);
  const light = lightUnits % 10;
  const parts = [];
  if (bulk > 0)  parts.push(`${bulk} Bulk`);
  if (light > 0) parts.push(`${light} L`);
  return parts.join(', ');
}

// ── PF2e action costs and damage types ───────────────────────────────────────

// Icons for PF2e action costs. Falls back to the raw string for unexpected values
// (e.g. "1 varies", "none", campaign-specific costs).
function actionCostIcon(cost) {
  if (!cost) return '';
  const c = String(cost).toLowerCase().trim();
  const map = {
    '1 action': '◆',
    'single action': '◆',
    '2 actions': '◆◆',
    'two actions': '◆◆',
    '3 actions': '◆◆◆',
    'three actions': '◆◆◆',
    '1 reaction': '⤾',
    'reaction': '⤾',
    '1 free': '◇',
    'free action': '◇',
    'none': '',
  };
  return map[c] ?? cost;
}

// PF2e damage-type emojis. Covers every canonical type in the Player Core.
const DAMAGE_TYPE_EMOJI = {
  acid: '🧪', bleed: '🩸', bludgeoning: '🔨', chaotic: '🌀', cold: '❄️',
  electricity: '⚡', evil: '😈', fire: '🔥', force: '✨', good: '🌟',
  lawful: '⚖️', mental: '🧠', negative: '💀', physical: '💥', piercing: '🏹',
  poison: '☠️', positive: '✨', slashing: '🗡️', sonic: '🔊', spirit: '👻',
  untyped: '⚔️', vitality: '💖', void: '🕳️',
};

// Look up a damage-type emoji. Strips qualifiers like "persistent " or "precision "
// so inputs like "persistent fire" still resolve to 🔥.
function damageTypeEmoji(type) {
  if (!type) return '⚔️';
  const key = String(type).toLowerCase().trim();
  // Direct match first
  if (DAMAGE_TYPE_EMOJI[key]) return DAMAGE_TYPE_EMOJI[key];
  // Strip qualifier prefixes and try again
  const stripped = key.replace(/^(persistent|precision|splash)\s+/, '').trim();
  return DAMAGE_TYPE_EMOJI[stripped] ?? '⚔️';
}

// ── XP progress bar ──────────────────────────────────────────────────────────

// PF2e: 1000 XP per level.
/**
 * Trim a string to fit a Discord embed field value (1024-char default cap).
 * Adds "..." if anything was cut so the user can tell it was truncated.
 * Used pervasively across reference embeds — anywhere a database field
 * might be longer than Discord allows.
 */
function truncateField(value, max = 1024) {
  const text = String(value ?? '').trim();
  if (text.length <= max) return text;
  return text.slice(0, max - 3).trimEnd() + '...';
}

function xpToNextLevel() { return 1000; }

// Render an XP progress bar as a block string.
function renderXpBar(xp, segments = 10) {
  const cap = xpToNextLevel();
  const clamped = Math.max(0, Math.min(xp, cap));
  const filled = Math.round((clamped / cap) * segments);
  const empty = segments - filled;
  return '▰'.repeat(filled) + '▱'.repeat(empty);
}

module.exports = {
  // ability mods
  getMod, fmt, fmtMod, calcProfNum,
  // currency
  walletToCopper, copperToWallet, formatWallet, formatCp,
  // bulk
  bulkToLightUnits, formatBulk,
  // PF2e display
  actionCostIcon, DAMAGE_TYPE_EMOJI, damageTypeEmoji,
  // strings
  truncateField,
  // xp
  xpToNextLevel, renderXpBar,
};