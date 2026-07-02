// ── commands/class/embed.js ─────────────────────────────────────────────────
// Five-page renderer for /class:
//   • buildClassOverviewPage     — description + key attribute + HP + key terms
//   • buildClassProficienciesPage — initial proficiencies at 1st level
//   • buildClassFeaturesPage     — class features (level progression)
//   • buildClassFeatsPage        — class-specific feats
//   • buildClassSubclassPage     — subclass options (witch patrons, sorcerer bloodlines, etc.)
//
// `chunkText` lives here because it's only used by these embeds. It's
// similar in spirit to /ancestry's `splitForFieldValue` but breaks on
// paragraph/sentence boundaries rather than any whitespace — appropriate
// for the prose-heavy class content. If a future command needs paragraph-
// aware chunking, promote this to lib/format.js then.

const { EmbedBuilder } = require('discord.js');

/**
 * Split a long string into chunks that each fit Discord's 1024-char field
 * value limit (or `max` if specified). Prefers paragraph breaks (\n), then
 * sentence breaks (". "), then hard-cuts at `max` as a last resort.
 */
function chunkText(text, max = 1020) {
  if (!text) return [];
  const out = [];
  let rest = text;
  while (rest.length > max) {
    let cut = rest.lastIndexOf('\n', max);
    if (cut < max * 0.5) cut = rest.lastIndexOf('. ', max);
    if (cut < max * 0.5) cut = max;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}

function buildClassOverviewPage(cls, userCharName = null) {
  const embed = new EmbedBuilder()
    .setColor(0x8e44ad) // purple — distinct from /skillinfo's blue/orange/purple set
    .setTitle(`⚔️ ${cls.name}`)
    .setDescription((cls.description || '*No description available.*').slice(0, 4000));

  const metaBits = [];
  if (cls.keyAttribute) metaBits.push(`**🔑 Key Attribute:** ${cls.keyAttribute}`);
  if (cls.hitPoints)    metaBits.push(`**❤️ Hit Points:** ${cls.hitPoints}`);
  if (cls.source)       metaBits.push(`**📖 Source:** ${cls.source}`);
  if (userCharName)     metaBits.push(`*Your character: ${userCharName}*`);
  if (metaBits.length) {
    embed.addFields({ name: 'Class Basics', value: metaBits.join('\n'), inline: false });
  }

  if (Array.isArray(cls.keyTerms) && cls.keyTerms.length > 0) {
    const termText = cls.keyTerms.map(t => `**${t.name}**: ${t.description}`).join('\n\n');
    const chunks = chunkText(termText, 1020);
    chunks.slice(0, 2).forEach((chunk, i) => {
      embed.addFields({
        name: i === 0 ? '📚 Key Terms' : '📚 Key Terms (cont.)',
        value: chunk,
        inline: false,
      });
    });
  }

  embed.setFooter({ text: `Page 1/5 • Pathfinder 2e` });
  return embed;
}

function buildClassProficienciesPage(cls) {
  const embed = new EmbedBuilder()
    .setColor(0x2980b9) // blue
    .setTitle(`⚔️ ${cls.name} — Proficiencies`)
    .setDescription(`Initial proficiencies at 1st level.`);

  // Canonical order — perception first, then saves, then skills, then combat,
  // then spellcasting. Keeps the embed scannable across all classes.
  const order = ['perception', 'savingthrows', 'skills', 'attacks', 'defenses', 'classdc', 'armor', 'spellattacks', 'spelldcs'];
  const labels = {
    perception:    '👁️ Perception',
    savingthrows:  '💪 Saving Throws',
    skills:        '🎯 Skills',
    attacks:       '⚔️ Attacks',
    defenses:      '🛡️ Defenses',
    classdc:       '🎲 Class DC',
    armor:         '🛡️ Armor',
    spellattacks:  '✨ Spell Attacks',
    spelldcs:      '✨ Spell DCs',
  };
  for (const key of order) {
    if (cls.proficiencies?.[key]) {
      embed.addFields({
        name: labels[key] ?? key,
        value: String(cls.proficiencies[key]).slice(0, 1020),
        inline: false,
      });
    }
  }
  if (Object.keys(cls.proficiencies ?? {}).length === 0) {
    embed.setDescription('*No proficiency data available for this class.*');
  }

  embed.setFooter({ text: `Page 2/5 • Pathfinder 2e` });
  return embed;
}

function buildClassFeaturesPage(cls) {
  const embed = new EmbedBuilder()
    .setColor(0xc0392b) // red
    .setTitle(`⚔️ ${cls.name} — Class Features`)
    .setDescription(`Features gained as you level up. Level-by-level progression is printed in the class's Archives of Nethys entry.`);

  if (Array.isArray(cls.classFeatures) && cls.classFeatures.length > 0) {
    const text = cls.classFeatures.join('\n');
    const chunks = chunkText(text, 1020);
    chunks.slice(0, 4).forEach((chunk, i) => {
      embed.addFields({
        name: i === 0 ? '📋 Features' : '📋 Features (cont.)',
        value: chunk,
        inline: false,
      });
    });
  } else {
    embed.setDescription('*No structured class features parsed. Check the Archives of Nethys entry for a full list.*');
  }

  embed.setFooter({ text: `Page 3/5 • Pathfinder 2e` });
  return embed;
}

function buildClassFeatsPage(cls) {
  const embed = new EmbedBuilder()
    .setColor(0xe67e22) // orange
    .setTitle(`⚔️ ${cls.name} — Class Feats`)
    .setDescription(`Class-specific feats available to ${cls.name}s. Full descriptions are on Archives of Nethys; this is a level-organized summary.`);

  if (Array.isArray(cls.classFeatsRaw) && cls.classFeatsRaw.length > 0) {
    // The raw lines are a mix of feat names and descriptions; we just chunk
    // and render them. Cap at 4 chunks to stay under Discord's embed limit.
    const text = cls.classFeatsRaw.join('\n');
    const chunks = chunkText(text, 1020);
    chunks.slice(0, 4).forEach((chunk, i) => {
      embed.addFields({
        name: i === 0 ? '📜 Feats' : '📜 Feats (cont.)',
        value: chunk,
        inline: false,
      });
    });
    if (chunks.length > 4) {
      embed.addFields({
        name: '…',
        value: `*${chunks.length - 4} more sections — see Archives of Nethys for the complete list.*`,
        inline: false,
      });
    }
  } else {
    embed.setDescription('*No class feats parsed. Check Archives of Nethys for the full feat list.*');
  }

  embed.setFooter({ text: `Page 4/5 • Pathfinder 2e` });
  return embed;
}

function buildClassSubclassPage(cls) {
  const label = cls.subclassLabel ?? 'Subclasses';
  const embed = new EmbedBuilder()
    .setColor(0x16a085) // teal
    .setTitle(`⚔️ ${cls.name} — ${label}`)
    .setDescription(`${cls.name} subclass options.`);

  if (Array.isArray(cls.subclassesRaw) && cls.subclassesRaw.length > 0) {
    const text = cls.subclassesRaw.join('\n');
    const chunks = chunkText(text, 1020);
    chunks.slice(0, 4).forEach((chunk, i) => {
      embed.addFields({
        name: i === 0 ? `🎭 ${label}` : `🎭 ${label} (cont.)`,
        value: chunk,
        inline: false,
      });
    });
  } else if (cls.subclassLabel) {
    embed.setDescription(`*${label} data not parsed cleanly. Check Archives of Nethys.*`);
  } else {
    // Some classes (like Fighter) don't have a formal subclass system.
    embed.setDescription(`*${cls.name} doesn't have a formal subclass structure. Check Archives of Nethys for ${cls.name}-specific options.*`);
  }

  embed.setFooter({ text: `Page 5/5 • Pathfinder 2e` });
  return embed;
}

module.exports = {
  chunkText,
  buildClassOverviewPage,
  buildClassProficienciesPage,
  buildClassFeaturesPage,
  buildClassFeatsPage,
  buildClassSubclassPage,
};
