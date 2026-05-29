const { spellDatabase } = require('../../reference/databases');

function normalizeSpellQuery(str) {
  return String(str ?? '').toLowerCase().trim()
    .replace(/[\u2018\u2019\u02bc]/g, "'").replace(/[\u201c\u201d]/g, '"');
}

function findSpell(spellName) {
  const query = normalizeSpellQuery(spellName);
  const exact = spellDatabase.filter(s => normalizeSpellQuery(s.name ?? '') === query);
  if (exact.length > 0) return pickSpellEntry(exact);
  return spellDatabase.find(s => normalizeSpellQuery(s.name ?? '').startsWith(query))
    || spellDatabase.find(s => normalizeSpellQuery(s.name ?? '').includes(query))
    || null;
}

function spellSourceRank(spell) {
  const source = String(spell?.source ?? '').toLowerCase();
  let rank = 0;
  if (spell?.custom || spell?._homebrew) rank += 1000;
  if (source.includes('divine mysteries')) rank += 300;
  if (source.includes('player core 2')) rank += 280;
  if (source.includes('player core')) rank += 270;
  if (source.includes('rage of elements')) rank += 260;
  if (source.includes('war of immortals')) rank += 250;
  if (source.includes('secrets of magic')) rank += 150;
  if (source.includes('dark archive')) rank += 140;
  if (source.includes('core rulebook')) rank -= 100;
  if (source.includes('advanced player')) rank -= 90;
  if (source.includes('gods & magic')) rank -= 80;
  if (source.includes('legacy')) rank -= 200;
  if (Array.isArray(spell?.traits)) rank += Math.min(30, spell.traits.length);
  if (spell?.description) rank += 5;
  return rank;
}

function pickSpellEntry(spells) {
  return [...spells].sort((a, b) =>
    spellSourceRank(b) - spellSourceRank(a) ||
    String(b.source ?? '').localeCompare(String(a.source ?? '')) ||
    String(a.aon_id ?? '').localeCompare(String(b.aon_id ?? ''))
  )[0] ?? null;
}

function spellAmbiguityMessage(result) {
  const lines = (result.matches ?? []).slice(0, 10).map((s, i) => {
    const rank = s.type === 'Cantrip' ? 'cantrip' : `rank ${s.level ?? '?'}`;
    const source = s.source ? `, ${s.source}` : '';
    const traits = Array.isArray(s.traits) && s.traits.length ? `, traits: ${s.traits.slice(0, 4).join(', ')}` : '';
    return `${i + 1}. **${s.name}** (${rank}${source}${traits})`;
  });
  const more = (result.matches?.length ?? 0) > 10 ? `\n...and ${(result.matches.length - 10)} more.` : '';
  return `Multiple spell entries match **${result.query}**:\n${lines.join('\n')}${more}\n\nPlease narrow the spell data first; Pathway will not guess between duplicate official versions.`;
}

module.exports = {
  findSpell,
  spellAmbiguityMessage,
};
