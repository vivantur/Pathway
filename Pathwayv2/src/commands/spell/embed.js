const { EmbedBuilder } = require('discord.js');

function normalizeSpell(spell) {
  let level = spell.level;
  if (typeof level === 'string') level = parseInt(level) || 1;
  let traditions = spell.traditions ?? '';
  if (typeof traditions === 'string') traditions = traditions.split(',').map(t => t.trim()).filter(Boolean);
  if (!Array.isArray(traditions)) traditions = [];
  let traits = spell.traits ?? '';
  if (typeof traits === 'string') traits = traits.split(',').map(t => t.trim()).filter(Boolean);
  if (!Array.isArray(traits)) traits = [];
  let type = spell.type ?? 'Spell';
  if (traits.map(t => t.toLowerCase()).includes('cantrip')) type = 'Cantrip';
  if (level === 0) type = 'Cantrip';

  let savingThrow = null;
  let saveIsBasic = false;
  let isAttackSpell = !!spell.attack;
  if (spell.defense && String(spell.defense).trim()) {
    const raw = String(spell.defense).trim();
    if (/^ac$/i.test(raw)) {
      isAttackSpell = true;
    } else {
      saveIsBasic = /^basic\s+/i.test(raw);
      savingThrow = raw.replace(/^basic\s+/i, '').trim();
    }
  }
  if (!isAttackSpell && Array.isArray(spell.rolls)) {
    if (spell.rolls.some(r => r?.type === 'attack' || r?.stat === 'spell_attack')) {
      isAttackSpell = true;
    }
  }

  const target = spell.target ?? spell.targets ?? null;
  let damage = spell.damage;
  let damageBase = null;
  let damageType = null;
  let damageExtra = null;
  if (damage && typeof damage === 'object') {
    damageBase = damage.base || null;
    damageType = damage.type || null;
    damageExtra = damage.extra || null;
    const parts = [damage.base, damage.type].filter(Boolean).join(' ');
    damage = (parts + (damage.extra ? ` + ${damage.extra}` : '')).trim() || null;
  } else if (damage && typeof damage === 'string' && damage.trim()) {
    const m = damage.trim().match(/^(\d+d\d+(?:\s*[+\-]\s*\d+)?)\s+([a-zA-Z ]+?)(?:\s*\+\s*(.+))?$/);
    if (m) {
      damageBase = m[1].replace(/\s+/g, '');
      damageType = m[2].trim();
      damageExtra = m[3]?.trim() ?? null;
    } else {
      damageBase = damage.trim();
    }
  }
  if (!damage || (typeof damage === 'string' && !damage.trim())) damage = null;

  let heightening = null;
  if (spell.heightening) {
    heightening = spell.heightening;
  }

  let description = spell.description?.trim() || spell.summary?.trim() || '*No description available.*';
  return {
    ...spell, level, traditions, traits, type,
    savingThrow, saveIsBasic, isAttackSpell,
    target, damage, damageBase, damageType, damageExtra,
    heightening, description,
  };
}

function formatShiningStarlightAttackDescription(description) {
  const intro = String(description || '').split(/Constellation\s*Attack|ConstellationAttack/i)[0].trim();
  const rows = [
    ['Underworld Dragon', 'Volcanic Vents', 'line', 'Reflex', 'fire'],
    ['Ogre', 'Wild club swing', 'cone', 'Fortitude', 'bludgeoning'],
    ['Swordswoman', 'Falling blades of light', 'line', 'Reflex', 'piercing'],
    ['Forest Dragon', 'Swarm of Insects', 'cone', 'Fortitude', 'poison'],
    ['Sea Dragon', 'Pressurized seawater', 'line', 'Reflex', 'piercing; water trait'],
    ['Blossom', 'Storming petals and pollen', 'line', 'Fortitude', 'poison, plant, wood'],
    ['Swallow', 'Wind gust', 'cone', 'Reflex', 'slashing; air'],
    ['Dog', 'A biting dog', 'line', 'Reflex', 'slashing'],
    ['Ox', 'A trampling ox', 'line', 'Reflex', 'bludgeoning'],
    ['Sky Dragon', 'Draconic lightning', 'line', 'Reflex', 'electricity'],
    ['Sovereign Dragon', 'Psychic roar', 'cone', 'Will', 'mental'],
    ['Archer', 'Hail of silver arrows', 'cone', 'Reflex', 'piercing'],
  ];

  return [
    intro,
    '**Constellation Attacks**',
    ...rows.map(([constellation, attack, area, save, traits]) =>
      `**${constellation}:** ${attack} (${area}, ${save}, ${traits})`
    ),
    '',
    '**Heightened (+1)** The damage increases by 1d10.',
  ].filter(line => line !== null && line !== undefined).join('\n');
}

function cleanSpellDescription(spell) {
  let description = spell.description && spell.description.trim()
    ? spell.description
    : '*No description available.*';

  if (/^shining starlight attack$/i.test(String(spell.name || '')) || /Constellation\s*Attack|ConstellationAttack/i.test(description)) {
    description = formatShiningStarlightAttackDescription(description);
  }

  return description
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function formatSpellHeightened(heightened, baseLevel = null) {
  if (!heightened) return '';
  if (typeof heightened === 'string') return heightened.trim();
  if (Array.isArray(heightened)) {
    return heightened.map(entry => formatSpellHeightened(entry, baseLevel)).filter(Boolean).join('\n');
  }
  if (typeof heightened !== 'object') return String(heightened).trim();

  const lines = [];
  const type = String(heightened.type || '').toLowerCase();
  const step = heightened.step ?? heightened.interval ?? null;

  if (heightened.damage_bonus) {
    if (type === 'per_rank') {
      const prefix = step ? `Every +${step} ranks` : `Each rank above ${baseLevel ?? 'base rank'}`;
      lines.push(`${prefix}: +${heightened.damage_bonus} damage`);
    } else {
      lines.push(`+${heightened.damage_bonus} damage`);
    }
  }

  if (heightened.extra_text) {
    const text = String(heightened.extra_text).trim();
    if (text) {
      if (type === 'per_rank' && step && !lines.length) lines.push(`Every +${step} ranks: ${text}`);
      else lines.push(text);
    }
  }

  if (heightened.levels && typeof heightened.levels === 'object') {
    for (const [rank, value] of Object.entries(heightened.levels)) {
      const text = formatSpellHeightened(value, baseLevel);
      if (text) lines.push(`**${rank}:** ${text}`);
    }
  }

  if (heightened.text) lines.push(String(heightened.text).trim());
  if (heightened.note) lines.push(String(heightened.note).trim());

  return lines.filter(Boolean).join('\n').trim();
}

function buildSpellEmbed(rawSpell) {
  const spell = normalizeSpell(rawSpell);
  const isCantrip = spell.type === 'Cantrip';
  const levelDisplay = isCantrip ? `Cantrip ${spell.level}` : `Spell ${spell.level}`;
  const traditionsDisplay = spell.traditions.length > 0 ? spell.traditions.join(', ') : 'None';
  const traitsDisplay = spell.traits.length > 0 ? spell.traits.join(', ') : null;
  let description = cleanSpellDescription(spell);
  if (description.length > 1500) description = description.slice(0, 1500) + '...\n*(description truncated)*';
  const embed = new EmbedBuilder().setColor(0x9B59B6).setTitle(spell.name).setDescription(description);
  const levelLine = [`**${levelDisplay}**`, spell.school ?? null].filter(Boolean).join(' · ');
  embed.addFields({ name: '\u200b', value: levelLine, inline: false });
  if (spell.source) embed.addFields({ name: 'Source', value: spell.source, inline: false });
  embed.addFields({ name: 'Traditions', value: traditionsDisplay, inline: false });
  if (traitsDisplay) embed.addFields({ name: 'Traits', value: traitsDisplay, inline: false });
  const metaLines = [
    spell.cast     ? `**Cast** ${spell.cast}`         : null,
    spell.range    ? `**Range** ${spell.range}`       : null,
    spell.area     ? `**Area** ${spell.area}`         : null,
    spell.target   ? `**Target** ${spell.target}`     : null,
    `**Duration** ${spell.duration || 'Instantaneous'}`,
  ].filter(Boolean);
  if (metaLines.length > 0) embed.addFields({ name: 'Meta', value: metaLines.join('\n'), inline: false });
  if (spell.isAttackSpell) {
    embed.addFields({ name: 'Defense', value: 'AC', inline: false });
  } else if (spell.savingThrow) {
    const basicPrefix = spell.saveIsBasic ? 'basic ' : '';
    embed.addFields({ name: 'Defense', value: `${basicPrefix}${spell.savingThrow}`, inline: false });
  }
  if (spell.damage) embed.addFields({ name: 'Damage', value: spell.damage, inline: false });
  const descriptionHasHeightened = /\bheightened\b/i.test(description);
  const heightenedText = formatSpellHeightened(spell.heightening ?? spell.heightened, spell.level);
  if (heightenedText && !descriptionHasHeightened) embed.addFields({ name: '⬆️ Heightened', value: heightenedText, inline: false });
  embed.setFooter({ text: `Pathfinder 2e · ${spell.source ?? 'Unknown source'}` });
  return embed;
}

module.exports = {
  normalizeSpell,
  buildSpellEmbed,
};
