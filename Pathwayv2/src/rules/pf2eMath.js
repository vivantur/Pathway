// ── rules/pf2eMath.js ────────────────────────────────────────────────────────
// Character-data-aware PF2e proficiency math.
//
// Pathbuilder JSON and Pathway's native sheet builder use different
// conventions for proficiency numbers:
//   • Pathbuilder uses the rank itself encoded as `2/4/6/8` (trained/expert/master/legendary)
//   • Pathway native uses the rank as `1/2/3/4` and the bot doubles it for math
//
// `usesRankProficiencies(charData)` flips between the two. Every "character
// aware" math helper goes through it so the bot produces the same modifier
// regardless of which import source a character originated from.
//
// These all live in rules/ because they are PURE PF2e game logic: no I/O,
// no state, no Discord. lib/format.js still owns the simpler formatters
// (fmt, getMod, calcProfNum, xpToNextLevel) that don't need character data.

const { calcProfNum } = require('../lib/format');

function usesRankProficiencies(charData) {
  return charData?._pathwaySource === 'native';
}

function canonicalProfValue(prof, ...keys) {
  for (const key of keys) {
    if (prof?.[key] !== undefined) return prof[key];
  }
  return 0;
}

function calcCharacterProfNum(charData, profNum, level) {
  if (!profNum || profNum === 0) return 0;
  return level + (usesRankProficiencies(charData) ? profNum * 2 : profNum);
}

function calcEditableProfNum(profNum, level) {
  if (!profNum || profNum === 0) return 0;
  return level + (profNum > 4 ? profNum : profNum * 2);
}

function editableProfValue(profNum) {
  if (!profNum || profNum === 0) return 0;
  return profNum > 4 ? profNum : profNum * 2;
}

function characterProfValue(charData, profNum) {
  if (!profNum || profNum === 0) return 0;
  return usesRankProficiencies(charData) ? profNum * 2 : profNum;
}

function characterProfLabel(charData, profNum) {
  const value = characterProfValue(charData, profNum);
  return { 0: 'Untrained', 2: 'Trained', 4: 'Expert', 6: 'Master', 8: 'Legendary' }[value] ?? 'Untrained';
}

function profIconForValue(value, { override = false } = {}) {
  const icons = { 2: '◐', 4: '●', 6: '★', 8: '⭐' };
  return icons[value] || (override ? '◒' : '◐');
}

// PF2e Remaster: each of the 16 core skills maps to a fixed key ability.
// This is canonical (from the rulebook), not character-dependent.
const SKILL_ABIL_MAP = {
  acrobatics: 'dex', arcana: 'int', athletics: 'str', crafting: 'int',
  deception: 'cha', diplomacy: 'cha', intimidation: 'cha', medicine: 'wis',
  nature: 'wis', occultism: 'int', performance: 'cha', religion: 'wis',
  society: 'int', stealth: 'dex', survival: 'wis', thievery: 'dex',
};

/**
 * Compute a character's modifier + proficiency for a given skill slug.
 * Returns `{ modifier, profLabel, profNum }` or null if no character / invalid skill.
 *
 * Respects the character's `edits.skillOverrides[slug]` overlay if present —
 * an explicit `total` overrides the computed modifier; an explicit `rank`
 * overrides the JSON proficiency rank. Used by /skillinfo (and available to
 * any future command that wants a character's current skill bonus).
 */
function computeCharSkillModifier(charEntry, skillKey) {
  if (!charEntry || !skillKey) return null;
  const c = charEntry.data;
  if (!c) return null;
  const ab = c.abilities ?? {};
  const prof = c.proficiencies ?? {};
  const lvl = c.level ?? 1;

  const abilKey = SKILL_ABIL_MAP[skillKey];
  if (!abilKey) return null;
  const override = charEntry.edits?.skillOverrides?.[skillKey] ?? null;
  const abilMod = Math.floor(((ab[abilKey] ?? 10) - 10) / 2);
  const jsonProfNum = prof[skillKey] ?? 0;
  const profNum = override?.rank ?? jsonProfNum;
  const computedModifier = abilMod + (
    override?.rank !== undefined
      ? calcProfNum(override.rank, lvl)
      : calcCharacterProfNum(c, jsonProfNum, lvl)
  );
  const modifier = (typeof override?.total === 'number') ? override.total : computedModifier;
  const profLabelMap = { 0: 'Untrained', 2: 'Trained', 4: 'Expert', 6: 'Master', 8: 'Legendary' };
  const profLabel = override?.rank !== undefined
    ? (profLabelMap[override.rank] ?? 'Untrained')
    : characterProfLabel(c, jsonProfNum);
  return { modifier, profLabel, profNum };
}

module.exports = {
  usesRankProficiencies,
  canonicalProfValue,
  calcCharacterProfNum,
  calcEditableProfNum,
  editableProfValue,
  characterProfValue,
  characterProfLabel,
  profIconForValue,
  SKILL_ABIL_MAP,
  computeCharSkillModifier,
};
