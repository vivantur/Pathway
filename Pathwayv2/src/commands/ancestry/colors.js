// ── commands/ancestry/colors.js ─────────────────────────────────────────────
// Shared palette used by both /ancestry's three pages and /heritage's single
// embed. Co-located under commands/ancestry/ because that's the primary
// consumer — /heritage borrows just the heritage hue so the two commands
// feel like one family.

const ANCESTRY_COLORS = {
  main:     0x4B8B6F, // forest green — core page
  heritage: 0x7B5EA7, // muted violet  — heritages page + /heritage
  feats:    0xC4862A, // amber         — feats page
};

module.exports = { ANCESTRY_COLORS };
