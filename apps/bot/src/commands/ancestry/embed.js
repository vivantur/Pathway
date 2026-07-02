// ── commands/ancestry/embed.js ──────────────────────────────────────────────
// Three-page renderer for /ancestry:
//   • buildAncestryCorePage      — main stats + parsed description sections
//   • buildAncestryHeritagesPage — heritage list (from baked entries or index)
//   • buildAncestryFeatsPage     — feats grouped by level
//
// All three share the ANCESTRY_COLORS palette and use ButtonBuilder via
// ./buttons.js (which lives next to this file so the page/button styling
// stays in sync).

const { EmbedBuilder } = require('discord.js');
const {
  parseDescription: parseAncestryDescription,
  getAncestryHp,
  hasHeritages,
  hasAncestryFeats,
} = require('../../lib/ancestryParser');
const { heritageDatabase } = require('../../reference/databases');
const { ANCESTRY_COLORS } = require('./colors');
const { ancestryHeritageSlugs } = require('./lookup');

// Emoji prefixes for each section label produced by ancestryParser. Keeps
// the embed visually scannable instead of all-text.
const SECTION_EMOJIS = {
  'Description':          '📖',
  'You Might...':         '✅',
  'Others Probably...':   '💬',
  'Physical Description': '🧍',
  'Society':              '🏛️',
  'Beliefs':              '🕯️',
  'Names':                '🏷️',
  'Sample Names':         '📝',
  'Special Ability':      '✨',
};

/**
 * Split a long string into chunks that each fit Discord's 1024-char field
 * value limit, breaking on whitespace where possible to avoid mid-word cuts.
 */
function splitForFieldValue(text, max) {
  if (text.length <= max) return [text];
  const out = [];
  let remaining = text;
  while (remaining.length > max) {
    // Find the last whitespace before max
    let cut = remaining.lastIndexOf(' ', max);
    if (cut < max * 0.5) cut = max; // no good break point — hard cut
    out.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }
  if (remaining) out.push(remaining);
  return out;
}

function buildAncestryCorePage(ancestry) {
  const boosts = (ancestry.attribute_boosts || []).join(', ') || 'None';
  const flaws  = (ancestry.attribute_flaws || []).length
    ? ancestry.attribute_flaws.join(', ')
    : 'None';

  // Senses: array of {name, description}. AoN often duplicates name == description,
  // so collapse the redundancy.
  const senses = ancestry.senses || [];
  const sensesText = senses.length
    ? senses.map(s => {
        if (!s) return '';
        if (s.description && s.description !== s.name) return `**${s.name}** — ${s.description}`;
        return `**${s.name}**`;
      }).filter(Boolean).join('\n')
    : 'Normal';

  // Languages: base list + (only if bonus_count > 0) the bonus pool.
  const langs = ancestry.languages || { base: [], bonus_count: 0, bonus_pool: [] };
  const baseLangs = (langs.base || []).join(', ') || 'None';
  const bonusLine = (langs.bonus_count > 0 && langs.bonus_pool?.length)
    ? `\n*Plus ${langs.bonus_count} additional language${langs.bonus_count === 1 ? '' : 's'} (if Int positive), chosen from: ${langs.bonus_pool.join(', ')}.*`
    : (langs.bonus_count > 0)
      ? `\n*Plus additional languages equal to your Intelligence modifier (if positive).*`
      : '';
  const languageText = `${baseLangs}${bonusLine}`;

  // HP: handle both `hp` and `hit_points` schemas; null for versatile heritages.
  const hp = getAncestryHp(ancestry);
  const hpText = hp != null ? String(hp) : '—';

  // Speed: tolerate string ("25 ft.") or number (25)
  const speed = ancestry.speed;
  const speedText = (speed == null) ? '—'
    : (typeof speed === 'number') ? `${speed} ft.`
    : String(speed);

  // Description sections — parse the messy AoN dump into labeled chunks.
  const sections = parseAncestryDescription(ancestry.description);
  const mainDescription = sections[0]?.content || '';
  const subSections = sections.slice(1);

  // Discord limits: description ≤ 4096, each field value ≤ 1024, total ≤ 6000.
  // Many AoN ancestries blow past 6000 if we render every section in full, so
  // we budget ~4500 chars for sections (saving room for description + meta
  // fields). When that's exceeded, longer sections get truncated with "..."
  // and an AoN link footer added so users can read the full text.
  const traitLine = (ancestry.traits || []).join(', ');
  const headerLine = traitLine ? `*${traitLine}*\n\n` : '';
  const truncatedMain = mainDescription.length > 1500
    ? mainDescription.slice(0, 1497) + '...'
    : mainDescription;

  const embed = new EmbedBuilder()
    .setTitle(ancestry.name)
    .setDescription(`${headerLine}${truncatedMain}`)
    .setColor(ANCESTRY_COLORS.main)
    .addFields(
      { name: '❤️ Hit Points',       value: hpText,       inline: true },
      { name: '🏃 Speed',            value: speedText,    inline: true },
      { name: '📏 Size',             value: ancestry.size || '—', inline: true },
      { name: '📈 Attribute Boosts', value: boosts,       inline: true },
      { name: '📉 Attribute Flaw',   value: flaws,        inline: true },
      { name: '​',              value: '​',     inline: true },
      { name: '👁️ Senses',          value: sensesText,   inline: false },
      { name: '🗣️ Languages',       value: languageText, inline: false },
    );

  // Track running embed length so we don't blow past Discord's 6000-char cap.
  // The fields above add ~150-300 chars; we budget the rest for sub-sections.
  let runningLen = (embed.data.title?.length || 0)
    + (embed.data.description?.length || 0)
    + (embed.data.footer?.text?.length || 0)
    + (embed.data.fields || []).reduce((s, f) => s + f.name.length + f.value.length, 0);
  const HARD_CAP = 5800; // a bit under 6000 to leave room for the footer

  let truncatedSomething = false;
  for (const sec of subSections) {
    if (!sec.content) continue;
    if (runningLen >= HARD_CAP) {
      truncatedSomething = true;
      break;
    }
    const labelEmoji = SECTION_EMOJIS[sec.label] || '📜';
    // How much room is left for this section?
    const reserved = labelEmoji.length + sec.label.length + 8; // emoji + label + " (cont.)"
    const remaining = HARD_CAP - runningLen - reserved;
    if (remaining < 100) {
      truncatedSomething = true;
      break;
    }
    let content = sec.content;
    if (content.length > remaining) {
      content = content.slice(0, remaining - 3) + '...';
      truncatedSomething = true;
    }
    const chunks = splitForFieldValue(content, 1024);
    for (let i = 0; i < chunks.length; i++) {
      const name = i === 0
        ? `${labelEmoji} ${sec.label}`
        : `${labelEmoji} ${sec.label} (cont.)`;
      embed.addFields({ name, value: chunks[i], inline: false });
      runningLen += name.length + chunks[i].length;
      if (runningLen >= HARD_CAP) { truncatedSomething = true; break; }
    }
  }

  // Footer: include AoN link suggestion when content was trimmed
  const footerText = truncatedSomething && ancestry.aon_url
    ? `Source: ${ancestry.source} • Page 1/3 • Trimmed — full text on Archives of Nethys`
    : `Source: ${ancestry.source} • Page 1/3`;
  embed.setFooter({ text: footerText });

  return embed;
}

function buildAncestryHeritagesPage(ancestry, ancestrySlug) {
  const embed = new EmbedBuilder()
    .setTitle(`${ancestry.name} — Heritages`)
    .setColor(ANCESTRY_COLORS.heritage)
    .setFooter({ text: `Source: ${ancestry.source} • Page 2/3` });

  // Three sources of heritage data, in priority order:
  //   1. Heritages baked into the ancestry object (legacy/homebrew entries)
  //   2. Heritages in heritages.json keyed by the ancestry slug
  //   3. None — fall back to "view on AoN" message
  let heritageEntries = null;

  if (hasHeritages(ancestry)) {
    heritageEntries = ancestry.heritages.map(h => ({
      name: h.name,
      description: h.description,
    }));
  } else if (ancestrySlug && ancestryHeritageSlugs(ancestrySlug).length) {
    // Look up via the heritages.json index
    heritageEntries = ancestryHeritageSlugs(ancestrySlug)
      .map(slug => heritageDatabase[slug])
      .filter(Boolean)
      .map(h => ({ name: h.name, description: h.description }));
  }

  if (!heritageEntries || heritageEntries.length === 0) {
    const aonNote = ancestry.aon_url
      ? `\n\n[View on Archives of Nethys](${ancestry.aon_url})`
      : '';
    embed.setDescription(
      `Heritage details aren't available in the local database for **${ancestry.name}** yet.${aonNote}`
    );
    return embed;
  }

  // Discord caps total embed body at 6000 chars. Each field is also capped
  // at 1024. Some ancestries (like Dwarf with 9 heritages, or Catfolk with 8)
  // can blow that budget if every heritage description is full-length.
  // Strategy: trim descriptions and add a footer hint if anything got cut.
  const descIntro = `Choose one heritage at character creation. *(${heritageEntries.length} available — use \`/heritage <name>\` for full details.)*`;
  embed.setDescription(descIntro);

  // Per-heritage budget: remaining chars / count, capped at 400 chars to keep
  // the page readable.
  const budgetPerHeritage = Math.min(400, Math.floor((5500 - descIntro.length) / heritageEntries.length));
  let trimmed = false;
  for (const h of heritageEntries) {
    const raw = h.description || '*No description.*';
    let value;
    if (raw.length <= budgetPerHeritage) {
      value = raw;
    } else {
      value = raw.slice(0, budgetPerHeritage - 3).trimEnd() + '...';
      trimmed = true;
    }
    embed.addFields({ name: `◈ ${h.name}`, value, inline: false });
  }
  if (trimmed) {
    embed.setFooter({ text: `Source: ${ancestry.source} • Page 2/3 • Some descriptions trimmed — use /heritage for full text` });
  }
  return embed;
}

function buildAncestryFeatsPage(ancestry) {
  const embed = new EmbedBuilder()
    .setTitle(`${ancestry.name} — Ancestry Feats`)
    .setColor(ANCESTRY_COLORS.feats)
    .setFooter({ text: `Source: ${ancestry.source} • Page 3/3` });

  if (!hasAncestryFeats(ancestry)) {
    const aonNote = ancestry.aon_url
      ? `\n\n[View on Archives of Nethys](${ancestry.aon_url})`
      : '';
    embed.setDescription(
      `Ancestry feat details aren't available in the local database for **${ancestry.name}** yet.${aonNote}`
    );
    return embed;
  }

  embed.setDescription('You gain ancestry feats at 1st level and every 4 levels thereafter.');
  for (const group of ancestry.ancestry_feats) {
    embed.addFields({ name: `── Level ${group.level} ──`, value: '​', inline: false });
    for (const feat of (group.feats || [])) {
      const prereqs = Array.isArray(feat.prerequisites) && feat.prerequisites.length
        ? `*Prerequisite: ${feat.prerequisites.join(', ')}*\n`
        : '';
      const value = `${prereqs}${feat.description || '*No description.*'}`.slice(0, 1024);
      embed.addFields({ name: `✦ ${feat.name}`, value, inline: false });
    }
  }
  return embed;
}

module.exports = {
  buildAncestryCorePage,
  buildAncestryHeritagesPage,
  buildAncestryFeatsPage,
};
