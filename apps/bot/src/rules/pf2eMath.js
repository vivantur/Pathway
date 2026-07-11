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
// This module owns only the CHARACTER-AWARE part: decoding each source's
// proficiency convention into a core rank. The arithmetic itself — the
// proficiency bonus, the ability modifier, the rank label — lives in
// @pathway/core, the single source of truth the web app also uses (root
// CLAUDE.md, "Architecture"). require() of that ESM package works on Node
// 22.12+, which the bot targets.

const { abilityModifier, proficiencyBonus, rankLabel, rawBonusToRank } = require('@pathway/core');

function usesRankProficiencies(charData) {
  return charData?._pathwaySource === 'native';
}

function canonicalProfValue(prof, ...keys) {
  for (const key of keys) {
    if (prof?.[key] !== undefined) return prof[key];
  }
  return 0;
}

/**
 * Decode a character's stored proficiency number into a core rank (0–4).
 * Native characters store the rank pre-doubled differently from Pathbuilder:
 * native holds the rank itself (0–4), Pathbuilder holds the pre-doubled bonus
 * (0/2/4/6/8). Normalize both to the pre-doubled bonus, then let core decode it.
 */
function profRank(charData, profNum) {
  const rawBonus = usesRankProficiencies(charData) ? profNum * 2 : profNum;
  return rawBonusToRank(rawBonus);
}

function calcCharacterProfNum(charData, profNum, level) {
  if (!profNum || profNum === 0) return 0;
  return proficiencyBonus(profRank(charData, profNum), level);
}

function characterProfValue(charData, profNum) {
  if (!profNum || profNum === 0) return 0;
  return profRank(charData, profNum) * 2;
}

function characterProfLabel(charData, profNum) {
  return rankLabel(profRank(charData, profNum));
}

function profIconForValue(value, { override = false } = {}) {
  const icons = { 2: '◐', 4: '●', 6: '★', 8: '⭐' };
  return icons[value] || (override ? '◒' : '◐');
}

// PF2e Remaster: each of the 16 core skills maps to a fixed key ability.
// This is canonical (from the rulebook), not character-dependent.
const SKILL_ABIL_MAP = {
  perception: 'wis',
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
  const abilMod = abilityModifier(ab[abilKey]);
  const jsonProfNum = prof[skillKey] ?? 0;
  const profNum = override?.rank ?? jsonProfNum;
  // An override's `rank` is stored on the pre-doubled 0/2/4/6/8 scale, like
  // Pathbuilder — decode it through core the same way.
  const overrideRank = override?.rank !== undefined ? rawBonusToRank(override.rank) : undefined;
  const computedModifier = abilMod + (
    overrideRank !== undefined
      ? proficiencyBonus(overrideRank, lvl)
      : calcCharacterProfNum(c, jsonProfNum, lvl)
  );
  const modifier = (typeof override?.total === 'number') ? override.total : computedModifier;
  const profLabel = overrideRank !== undefined
    ? rankLabel(overrideRank)
    : characterProfLabel(c, jsonProfNum);
  return { modifier, profLabel, profNum };
}

module.exports = {
  usesRankProficiencies,
  canonicalProfValue,
  calcCharacterProfNum,
  characterProfValue,
  characterProfLabel,
  profIconForValue,
  SKILL_ABIL_MAP,
  computeCharSkillModifier,
};
