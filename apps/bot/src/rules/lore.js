// ── rules/lore.js ────────────────────────────────────────────────────────────
// Lore-skill string normalization. PF2e lore is awkward to handle because
// users type lore topics in many forms ("Forge Lore", "Lore: Forge", "forge",
// "Forge"); also Pathbuilder serializes lore-rank entries as proficiency
// keys like `forge_lore` or `cooking_lore`. The helpers here normalize all
// those flavors into a canonical lookup key and a display label.
//
// All pure functions, no I/O. Lives in rules/ because lore is a PF2e
// concept; the canonicalization is part of how the bot models PF2e
// proficiencies.

// Private — turns any string into a snake_case identifier safe for object
// keys (alphanumerics + underscores, no leading/trailing underscore).
function _customKey(name) {
  return String(name ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

// Strip any "Lore:" / "Lore -" prefix and trailing "Lore" word, then convert
// the rest into a canonical "<topic>_lore" snake_case key for lookup.
function loreKey(name) {
  const cleaned = String(name ?? '')
    .trim()
    .replace(/^lore\s*[:\-]?\s*/i, '')
    .replace(/^lore[_\s-]+/i, '')
    .replace(/\s+lore$/i, '')
    .replace(/[_\s-]+lore$/i, '')
    .trim();
  return _customKey(`${cleaned} Lore`);
}

// Title-case display label for the lore topic only (without the word "Lore").
// e.g. "FORGE lore" → "Forge".
function loreTopicLabel(name) {
  const cleaned = String(name ?? '')
    .trim()
    .replace(/^lore\s*[:\-]?\s*/i, '')
    .replace(/^lore[_\s-]+/i, '')
    .replace(/\s+lore$/i, '')
    .replace(/[_\s-]+lore$/i, '')
    .replace(/[_-]+/g, ' ')
    .trim();
  return cleaned.replace(/\b\w/g, c => c.toUpperCase());
}

// True if a proficiency-table key represents a lore skill (Pathbuilder
// JSON stores lores in proficiencies as `lore`, `forge_lore`, `lore_forge`,
// etc.). Used by /sheet to enumerate lore skills the user has trained.
function isLoreProficiencyKey(name) {
  const normalized = _customKey(name);
  return (
    normalized === 'lore' ||
    normalized.startsWith('lore_') ||
    normalized.endsWith('_lore') ||
    normalized.includes('_lore_')
  );
}

module.exports = {
  loreKey,
  loreTopicLabel,
  isLoreProficiencyKey,
};
