// systems/spellEffects.js
// Reads gamedata/spell-effects.json and applies the appropriate condition(s)
// to combatants based on save degree of success.
//
// Used by the /cast command in index.js to auto-apply spell effects to
// targets, eliminating the need for the GM to manually run /init effect on
// every enemy after a cast.
//
// Public API:
//   hasMapping(spellName)
//     → boolean. True if this spell has an entry in spell-effects.json.
//
//   getMapping(spellName)
//     → { saveType, save?, alwaysApply?, scaling?, notes? } or null
//
//   resolveEffectsForDegree(spellName, degree, castLevel)
//     → array of effect objects to apply for the given save result.
//        For no-save spells, pass degree=null to get alwaysApply effects.
//
//   applyEffectsToCombatant(channelId, combatantName, effects, encountersModule, appliedBy)
//     → { applied: number, errors: [] }
//
//   formatEffectSummary(effects)
//     → human-readable single-line summary like "Frightened 2, Off-Guard"
//
// Notes:
//   • Spell names are matched case-insensitively.
//   • Scaling rules: { rank_breakpoints: [{min:6, value:2}, ...] } means
//     "if cast at rank 6+, override the value to 2; rank 9+ → 3" (used for
//     Heroism). Applied to every effect in the list.
//   • Effects use the same shape as systems/effects.js presets, so they
//     interop with /init effect, /init effects, and addEffect().

'use strict';

const path = require('path');
const fs = require('fs');

const RULES = (() => {
  try {
    return JSON.parse(fs.readFileSync(
      path.join(__dirname, '..', 'gamedata', 'spell-effects.json'),
      'utf8'
    ));
  } catch (err) {
    console.error('spellEffects.js: failed to load gamedata/spell-effects.json:', err.message);
    return null;
  }
})();

// Normalize a spell name for lookup (lowercase, trim, collapse spaces).
function normalizeName(name) {
  return String(name || '').toLowerCase().trim().replace(/\s+/g, ' ');
}

function hasMapping(spellName) {
  if (!RULES) return false;
  return Object.prototype.hasOwnProperty.call(RULES, normalizeName(spellName));
}

function getMapping(spellName) {
  if (!RULES) return null;
  return RULES[normalizeName(spellName)] || null;
}

// Apply scaling to an effect (Heroism gets stronger at higher ranks, etc.)
// Mutates a copy — never the original from the JSON file.
function applyScalingToEffect(effect, scaling, castLevel) {
  if (!scaling || !castLevel) return effect;
  const out = JSON.parse(JSON.stringify(effect)); // deep clone

  if (scaling.rank_breakpoints) {
    // Find the highest breakpoint at or below castLevel
    let newValue = out.value;
    for (const bp of scaling.rank_breakpoints) {
      if (castLevel >= bp.min) newValue = bp.value;
    }
    if (newValue !== out.value) {
      out.value = newValue;
      // Also update the modifiers if they're numeric (attackBonus etc.)
      if (out.modifiers) {
        for (const k of ['attackBonus', 'damageBonus', 'acBonus', 'saveBonus', 'skillBonus']) {
          if (typeof out.modifiers[k] === 'number' && out.modifiers[k] !== 0) {
            // Preserve sign (penalties stay negative, bonuses stay positive)
            const sign = Math.sign(out.modifiers[k]);
            out.modifiers[k] = sign * Math.abs(newValue);
          }
        }
        // Update description to reflect the new value if it mentions a number
        if (typeof out.modifiers.description === 'string') {
          out.modifiers.description = out.modifiers.description.replace(/\+\d+ status bonus/, `+${newValue} status bonus`);
        }
      }
    }
  }

  return out;
}

// Resolve which effects should be applied for a given (spell, degree, castLevel).
// degree is one of 'crit-success', 'success', 'failure', 'crit-failure', or null
// (for spells with no save — uses alwaysApply).
function resolveEffectsForDegree(spellName, degree, castLevel = null) {
  const mapping = getMapping(spellName);
  if (!mapping) return [];

  let raw = [];
  if (mapping.alwaysApply && Array.isArray(mapping.alwaysApply)) {
    raw = raw.concat(mapping.alwaysApply);
  }
  if (mapping.save && degree && Array.isArray(mapping.save[degree])) {
    raw = raw.concat(mapping.save[degree]);
  }

  // Apply scaling to each effect
  return raw.map(e => applyScalingToEffect(e, mapping.scaling, castLevel));
}

// Apply a list of effects to a combatant in an active encounter.
// `encountersModule` should be the module exporting `addEffect`.
// Returns { applied: count, errors: [] }.
function applyEffectsToCombatant(channelId, combatantName, effects, encountersModule, appliedBy = 'spell') {
  const out = { applied: 0, errors: [] };
  if (!encountersModule || typeof encountersModule.addEffect !== 'function') {
    out.errors.push('encounters module not available');
    return out;
  }
  if (!Array.isArray(effects) || effects.length === 0) return out;

  for (const e of effects) {
    try {
      // Spread to avoid mutating the JSON-loaded original or the scaling-cloned copy
      const effectCopy = { ...e, appliedBy };
      const result = encountersModule.addEffect(channelId, combatantName, effectCopy);
      if (result) out.applied++;
    } catch (err) {
      out.errors.push(`${e.name}: ${err.message}`);
    }
  }
  return out;
}

// Build a short human-readable summary of effects applied (for embed text).
// Examples:
//   "Frightened 2, Off-Guard"
//   "Slowed 1 (1 round)"
//   "(no effect)"
function formatEffectSummary(effects) {
  if (!Array.isArray(effects) || effects.length === 0) return '*no condition applied*';
  return effects.map(e => {
    let label = e.name;
    if (e.value && Number(e.value) > 0 && !label.includes(String(e.value))) {
      label += ` ${e.value}`;
    }
    if (e.duration && Number(e.duration) > 0) {
      label += ` (${e.duration}r)`;
    }
    return label;
  }).join(', ');
}

module.exports = {
  RULES,
  hasMapping,
  getMapping,
  resolveEffectsForDegree,
  applyEffectsToCombatant,
  formatEffectSummary,
};