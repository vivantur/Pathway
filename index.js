require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const fetch = require('node-fetch');
const fs = require('fs');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
  ]
});

// ── Prevent unhandled rejections from crashing the bot ───────────────────────
process.on('unhandledRejection', error => {
  console.error('Unhandled rejection:', error);
});

let spellDatabase = [];
try {
  spellDatabase = JSON.parse(fs.readFileSync('spells.json', 'utf8'));
  console.log(`Loaded ${spellDatabase.length} spells from database.`);
} catch (err) {
  console.error('Could not load spells.json:', err.message);
}

let ancestryDatabase = {};
try {
  ancestryDatabase = JSON.parse(fs.readFileSync('ancestries.json', 'utf8'));
  console.log(`Loaded ${Object.keys(ancestryDatabase).length} ancestries from database.`);
} catch (err) {
  console.error('Could not load ancestries.json:', err.message);
}

function loadCharacters() {
  try {
    return JSON.parse(fs.readFileSync('characters.json', 'utf8'));
  } catch {
    return {};
  }
}

function saveCharacters(data) {
  fs.writeFileSync('characters.json', JSON.stringify(data, null, 2));
}

function getMod(score) {
  const mod = Math.floor((score - 10) / 2);
  return mod >= 0 ? `+${mod}` : `${mod}`;
}

function calcProfNum(profNum, level) {
  if (!profNum || profNum === 0) return 0;
  return profNum + level;
}

function fmt(n) {
  return n >= 0 ? `+${n}` : `${n}`;
}

function xpToNextLevel(level) {
  return 1000;
}

function resolveChar(userId, nameArg, characters) {
  if (!characters[userId] || Object.keys(characters[userId]).length === 0) {
    return { error: 'You have no saved characters! Use `/addchar` to add one.' };
  }
  let charKey;
  if (!nameArg) {
    const keys = Object.keys(characters[userId]);
    if (keys.length === 1) {
      charKey = keys[0];
    } else {
      const names = Object.values(characters[userId]).map(c => c.name).join(', ');
      return { error: `You have multiple characters! Specify one.\nYour characters: ${names}` };
    }
  } else {
    charKey = nameArg.toLowerCase().replace(/\s+/g, '-');
  }
  if (!characters[userId][charKey]) {
    const names = Object.values(characters[userId]).map(c => c.name).join(', ');
    return { error: `Couldn't find that character. Your characters: ${names}` };
  }
  return { charKey, char: characters[userId][charKey] };
}

function buildRollEmbed({ title, breakdown, charName, thumbnail }) {
  const embed = new EmbedBuilder()
    .setColor(0x7289DA)
    .setTitle(title)
    .setDescription(breakdown);
  if (thumbnail) embed.setThumbnail(thumbnail);
  if (charName) embed.setFooter({ text: charName });
  return embed;
}

function formatRollBreakdown(dieRoll, modifier, extraBonus, total, sides) {
  const isCrit = sides === 20 && dieRoll === 20;
  const isFumble = sides === 20 && dieRoll === 1;
  const modPart = modifier !== 0 ? ` + ${modifier}` : '';
  const extraPart = extraBonus && extraBonus !== 0 ? ` + ${extraBonus}` : '';
  let line = `1d20 (${dieRoll})${modPart}${extraPart} = **${total}**`;
  if (isCrit) line += '\n⭐ Natural 20!';
  if (isFumble) line += '\n💀 Natural 1!';
  return line;
}

// ── Spell lookup ──────────────────────────────────────────────────────────────

function findSpell(spellName) {
  // Normalize smart quotes and curly apostrophes to straight ones
  const normalize = str => str
    .toLowerCase()
    .trim()
    .replace(/[\u2018\u2019\u02bc]/g, "'")
    .replace(/[\u201c\u201d]/g, '"');

  const query = normalize(spellName);
  const exact = spellDatabase.find(s => normalize(s.name ?? '') === query);
  if (exact) return exact;
  const startsWith = spellDatabase.find(s => normalize(s.name ?? '').startsWith(query));
  if (startsWith) return startsWith;
  const includes = spellDatabase.find(s => normalize(s.name ?? '').includes(query));
  if (includes) return includes;
  return null;
}

// ── Normalize spell to match spells.json format ───────────────────────────────
function normalizeSpell(spell) {
  // level: "1st" → 1
  let level = spell.level;
  if (typeof level === 'string') {
    level = parseInt(level) || 1;
  }

  // traditions: comma string → array
  let traditions = spell.traditions ?? '';
  if (typeof traditions === 'string') {
    traditions = traditions.split(',').map(t => t.trim()).filter(Boolean);
  }
  if (!Array.isArray(traditions)) traditions = [];

  // traits: comma string → array
  let traits = spell.traits ?? '';
  if (typeof traits === 'string') {
    traits = traits.split(',').map(t => t.trim()).filter(Boolean);
  }
  if (!Array.isArray(traits)) traits = [];

  // type: use spell.type, confirm cantrip from traits
  let type = spell.type ?? 'Spell';
  if (traits.map(t => t.toLowerCase()).includes('cantrip')) type = 'Cantrip';
  if (level === 0) type = 'Cantrip';

  // saving throw: strip "basic " from defense field
  let savingThrow = null;
  if (spell.defense && spell.defense.trim()) {
    savingThrow = spell.defense.replace(/^basic\s+/i, '').trim();
  }

  // target: spells.json uses "target" not "targets"
  const target = spell.target ?? spell.targets ?? null;

  // damage: flatten { base, type, extra } → string
  let damage = spell.damage;
  if (damage && typeof damage === 'object') {
    const parts = [damage.base, damage.type].filter(Boolean).join(' ');
    const extra = damage.extra ? ` + ${damage.extra}` : '';
    damage = (parts + extra).trim() || null;
  }
  if (!damage || (typeof damage === 'string' && !damage.trim())) damage = null;

  // description: fall back to summary, then a default string — never allow empty
  let description = '';
  if (spell.description && spell.description.trim()) {
    description = spell.description.trim();
  } else if (spell.summary && spell.summary.trim()) {
    description = spell.summary.trim();
  } else {
    description = '*No description available.*';
  }

  return { ...spell, level, traditions, traits, type, savingThrow, target, damage, description };
}

// ── Build spell embed ─────────────────────────────────────────────────────────

function buildSpellEmbed(rawSpell) {
  const spell = normalizeSpell(rawSpell);

  const isCantrip    = spell.type === 'Cantrip';
  const levelDisplay = isCantrip ? `Cantrip ${spell.level}` : `Spell ${spell.level}`;
  const traditionsDisplay = spell.traditions.length > 0 ? spell.traditions.join(', ') : 'None';
  const traitsDisplay     = spell.traits.length > 0 ? spell.traits.join(', ') : null;

  // Ensure description is never empty for Discord's embed validator
  let description = spell.description && spell.description.trim()
    ? spell.description
    : '*No description available.*';
  if (description.length > 1500) {
    description = description.slice(0, 1500) + '...\n*(description truncated)*';
  }

  const embed = new EmbedBuilder()
    .setColor(0x9B59B6)
    .setTitle(spell.name)
    .setDescription(description);

  // Level line
  const levelLine = [`**${levelDisplay}**`, spell.school ?? null].filter(Boolean).join(' · ');
  embed.addFields({ name: '\u200b', value: levelLine, inline: false });

  if (spell.source) embed.addFields({ name: 'Source', value: spell.source, inline: false });
  embed.addFields({ name: 'Traditions', value: traditionsDisplay, inline: false });
  if (traitsDisplay) embed.addFields({ name: 'Traits', value: traitsDisplay, inline: false });

  // Meta
  const metaLines = [
    spell.cast     ? `**Cast** ${spell.cast}`         : null,
    spell.range    ? `**Range** ${spell.range}`       : null,
    spell.area     ? `**Area** ${spell.area}`         : null,
    spell.target   ? `**Target** ${spell.target}`     : null,
    spell.duration ? `**Duration** ${spell.duration}` : null,
  ].filter(Boolean);
  if (metaLines.length > 0) embed.addFields({ name: 'Meta', value: metaLines.join('\n'), inline: false });

  if (spell.savingThrow) embed.addFields({ name: 'Saving Throw', value: spell.savingThrow, inline: false });
  if (spell.damage)      embed.addFields({ name: 'Damage',       value: spell.damage,      inline: false });

  // Heightening
  if (spell.heightening && typeof spell.heightening === 'object') {
    let htText = '';
    if (spell.heightening.type === 'per_rank' && spell.heightening.damage_bonus) {
      htText = `Each rank above ${spell.level}: +${spell.heightening.damage_bonus} damage`;
    } else if (spell.heightening.type === 'fixed' && spell.heightening.levels) {
      htText = Object.entries(spell.heightening.levels).map(([k, v]) => `**${k}:** ${v}`).join('\n');
    } else {
      htText = JSON.stringify(spell.heightening);
    }
    if (htText) embed.addFields({ name: '⬆️ Heightened', value: htText, inline: false });
  } else if (spell.heightened && typeof spell.heightened === 'string' && spell.heightened.trim()) {
    embed.addFields({ name: '⬆️ Heightened', value: spell.heightened, inline: false });
  }

  embed.setFooter({ text: `Pathfinder 2e · ${spell.source ?? 'Unknown source'}` });
  return embed;
}

// ── Ancestry embed builders ───────────────────────────────────────────────────

const ANCESTRY_COLORS = {
  main:     0x4B8B6F,
  heritage: 0x7B5EA7,
  feats:    0xC4862A,
};

function buildAncestryCorePage(ancestry) {
  const boosts = ancestry.attribute_boosts.join(', ');
  const flaws  = ancestry.attribute_flaws.length ? ancestry.attribute_flaws.join(', ') : 'None';
  const sensesText = ancestry.senses.map(s => `**${s.name}** — ${s.description}`).join('\n');
  const langBase   = ancestry.languages.base.join(', ');
  const langPool   = ancestry.languages.bonus_pool.join(', ');
  const langBonus  = ancestry.languages.bonus_count;
  const languageText = `${langBase}\n*Plus additional languages equal to ${langBonus}, chosen from: ${langPool}.*`;

  return new EmbedBuilder()
    .setTitle(ancestry.name)
    .setDescription(`*${ancestry.traits.join(', ')}*\n\n${ancestry.description}`)
    .setColor(ANCESTRY_COLORS.main)
    .setFooter({ text: `Source: ${ancestry.source} • Page 1/3` })
    .addFields(
      { name: '❤️ Hit Points',       value: `${ancestry.hp}`,       inline: true },
      { name: '🏃 Speed',            value: `${ancestry.speed} ft.`, inline: true },
      { name: '📏 Size',             value: ancestry.size,           inline: true },
      { name: '📈 Attribute Boosts', value: boosts,                  inline: true },
      { name: '📉 Attribute Flaw',   value: flaws,                   inline: true },
      { name: '\u200B',              value: '\u200B',                inline: true },
      { name: '👁️ Senses',          value: sensesText,              inline: false },
      { name: '🗣️ Languages',       value: languageText,            inline: false },
    );
}

function buildAncestryHeritagesPage(ancestry) {
  const embed = new EmbedBuilder()
    .setTitle(`${ancestry.name} — Heritages`)
    .setDescription('Choose one heritage at character creation. Your heritage represents your particular lineage within the ancestry.')
    .setColor(ANCESTRY_COLORS.heritage)
    .setFooter({ text: `Source: ${ancestry.source} • Page 2/3` });
  for (const h of ancestry.heritages) {
    embed.addFields({ name: `◈ ${h.name}`, value: h.description, inline: false });
  }
  return embed;
}

function buildAncestryFeatsPage(ancestry) {
  const embed = new EmbedBuilder()
    .setTitle(`${ancestry.name} — Ancestry Feats`)
    .setDescription('You gain ancestry feats at 1st level and every 4 levels thereafter.')
    .setColor(ANCESTRY_COLORS.feats)
    .setFooter({ text: `Source: ${ancestry.source} • Page 3/3` });
  for (const group of ancestry.ancestry_feats) {
    embed.addFields({ name: `── Level ${group.level} ──`, value: '\u200B', inline: false });
    for (const feat of group.feats) {
      const prereqLine = feat.prerequisites ? `*Prerequisite: ${feat.prerequisites.join(', ')}*\n` : '';
      embed.addFields({ name: `✦ ${feat.name}`, value: `${prereqLine}${feat.description}`, inline: false });
    }
  }
  return embed;
}

function buildAncestryButtons(currentPage, ancestryKey) {
  const id = ancestryKey.toLowerCase();
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`ancestry_${id}_0`).setLabel('◀ Core').setStyle(ButtonStyle.Secondary).setDisabled(currentPage === 0),
    new ButtonBuilder().setCustomId(`ancestry_${id}_1`).setLabel('Heritages').setStyle(ButtonStyle.Primary).setDisabled(currentPage === 1),
    new ButtonBuilder().setCustomId(`ancestry_${id}_2`).setLabel('Feats ▶').setStyle(ButtonStyle.Success).setDisabled(currentPage === 2),
  );
}

// ── Bot ready ─────────────────────────────────────────────────────────────────

client.once('clientReady', () => {
  console.log(`Logged in as ${client.user.tag}!`);
});

// ── Interaction handler ───────────────────────────────────────────────────────

client.on('interactionCreate', async (interaction) => {

  // ── Button interactions ───────────────────────────────────────────────────────
  if (interaction.isButton()) {
    if (!interaction.customId.startsWith('ancestry_')) return;
    const parts       = interaction.customId.split('_');
    const pageIndex   = parseInt(parts[parts.length - 1], 10);
    const ancestryKey = parts.slice(1, parts.length - 1).join('_');
    const ancestry    = ancestryDatabase[ancestryKey];
    if (!ancestry) return interaction.update({ content: '❌ Could not reload ancestry data.', components: [] });
    let newEmbed;
    if (pageIndex === 0) newEmbed = buildAncestryCorePage(ancestry);
    if (pageIndex === 1) newEmbed = buildAncestryHeritagesPage(ancestry);
    if (pageIndex === 2) newEmbed = buildAncestryFeatsPage(ancestry);
    return interaction.update({ embeds: [newEmbed], components: [buildAncestryButtons(pageIndex, ancestryKey)] });
  }

  if (!interaction.isChatInputCommand()) return;
  const { commandName } = interaction;

  // ─── /ping ───────────────────────────────────────────────────────
  if (commandName === 'ping') {
    await interaction.reply('Pong! 🏓 Bot is alive and running.');
  }

  // ─── /setinfo ────────────────────────────────────────────────────
  else if (commandName === 'setinfo') {
    const field      = interaction.options.getString('field');
    const value      = interaction.options.getString('value');
    const nameArg    = interaction.options.getString('character');
    const characters = loadCharacters();
    const { error, charKey } = resolveChar(interaction.user.id, nameArg, characters);
    if (error) return interaction.reply({ content: error, ephemeral: true });
    const parsed     = value.split(',').map(v => v.trim()).filter(Boolean);
    characters[interaction.user.id][charKey][field] = parsed;
    saveCharacters(characters);
    const charName   = characters[interaction.user.id][charKey].name;
    const fieldLabel = field.charAt(0).toUpperCase() + field.slice(1);
    await interaction.reply({ content: `✅ **${fieldLabel}** updated for **${charName}**:\n${parsed.join(', ')}`, ephemeral: true });
  }

  // ─── /sheet ──────────────────────────────────────────────────────
  else if (commandName === 'sheet') {
    await interaction.deferReply();
    const userId     = interaction.user.id;
    const characters = loadCharacters();
    const nameArg    = interaction.options.getString('name');
    const { error, charKey, char: charEntry } = resolveChar(userId, nameArg, characters);
    if (error) return interaction.editReply(error);
    try {
      const c   = charEntry.data;
      const lvl = c.level ?? 1;
      const ab  = c.abilities ?? {};
      const prof = c.proficiencies ?? {};
      const currentXP = c.xp ?? 0;
      const xpDisplay = `${currentXP} / ${xpToNextLevel(lvl)} XP`;
      const conMod  = Math.floor(((ab.con ?? 10) - 10) / 2);
      const totalHP = (c.attributes?.ancestryhp ?? 0) + (c.attributes?.classhp ?? 0) + ((c.attributes?.bonushp ?? 0) * lvl) + (conMod * lvl);
      const profBonus = Math.floor(lvl / 4) + 2;
      const wisMod    = Math.floor(((ab.wis ?? 10) - 10) / 2);
      const percMod   = wisMod + calcProfNum(prof.perception ?? 0, lvl);
      let spellAttackBonus = null;
      let spellDC = null;
      if (c.spellCasters?.length > 0) {
        const caster = c.spellCasters[0];
        const tradAbilMap      = { arcane: 'int', divine: 'wis', occult: 'cha', primal: 'wis' };
        const traditionProfMap = { arcane: 'castingArcane', divine: 'castingDivine', occult: 'castingOccult', primal: 'castingPrimal' };
        const tradKey    = traditionProfMap[caster.magicTradition?.toLowerCase()] ?? 'castingArcane';
        const keyAbility = caster.ability?.toLowerCase() ?? tradAbilMap[caster.magicTradition?.toLowerCase()] ?? 'int';
        const keyMod     = Math.floor(((ab[keyAbility] ?? 10) - 10) / 2);
        const spellProfMod = calcProfNum(prof[tradKey] ?? 0, lvl);
        spellAttackBonus = keyMod + spellProfMod;
        spellDC = 10 + keyMod + spellProfMod;
      }
      const fortMod   = Math.floor(((ab.con ?? 10) - 10) / 2) + calcProfNum(prof.fortitude ?? 0, lvl);
      const reflexMod = Math.floor(((ab.dex ?? 10) - 10) / 2) + calcProfNum(prof.reflex ?? 0, lvl);
      const willMod   = Math.floor(((ab.wis ?? 10) - 10) / 2) + calcProfNum(prof.will ?? 0, lvl);
      const skillMap = {
        acrobatics: 'dex', arcana: 'int', athletics: 'str', crafting: 'int',
        deception: 'cha', diplomacy: 'cha', intimidation: 'cha', medicine: 'wis',
        nature: 'wis', occultism: 'int', performance: 'cha', religion: 'wis',
        society: 'int', stealth: 'dex', survival: 'wis', thievery: 'dex',
      };
      const profIcons = { 2: '◑', 4: '●', 6: '★', 8: '⭐' };
      const trainedSkills = Object.entries(prof)
        .filter(([skill, profNum]) => skillMap[skill] && profNum > 0)
        .map(([skill, profNum]) => {
          const abilMod = Math.floor(((ab[skillMap[skill]] ?? 10) - 10) / 2);
          const total   = abilMod + calcProfNum(profNum, lvl);
          const icon    = profIcons[profNum] || '◑';
          return `${icon} ${skill.charAt(0).toUpperCase() + skill.slice(1)} ${fmt(total)}`;
        });
      const loreSkills = (c.lores ?? []).map(([loreName, profNum]) => {
        const intMod = Math.floor(((ab.int ?? 10) - 10) / 2);
        const total  = intMod + calcProfNum(profNum, lvl);
        const icon   = profIcons[profNum] || '◑';
        return `${icon} Lore: ${loreName} ${fmt(total)}`;
      });
      const allTrainedSkills = [...trainedSkills, ...loreSkills];
      const half      = Math.ceil(allTrainedSkills.length / 2);
      const col1      = allTrainedSkills.slice(0, half);
      const col2      = allTrainedSkills.slice(half);
      const skillCols = col1.map((s, i) => `${s.padEnd(24)}${col2[i] ?? ''}`).join('\n');
      let attackLines = '';
      if (c.weapons?.length > 0) {
        c.weapons.forEach(w => {
          const atkBonus = w.attack ?? 0;
          const dmgBonus = w.damageBonus > 0 ? `+${w.damageBonus}` : w.damageBonus < 0 ? `${w.damageBonus}` : '';
          const dmgType  = w.damageType === 'P' ? 'Piercing' : w.damageType === 'S' ? 'Slashing' : w.damageType === 'B' ? 'Bludgeoning' : w.damageType ?? '';
          attackLines += `**${w.display ?? w.name}** ${fmt(atkBonus)} to hit · ${w.die ?? '1d4'}${dmgBonus} ${dmgType}\n`;
        });
      }
      const languages       = charEntry.languages ?? c.languages ?? [];
      const senses          = charEntry.senses ?? [];
      const ancestryDisplay = `${c.ancestry ?? ''} ${c.heritage ?? ''}`.trim();
      const classDisplay    = c.class ?? 'Unknown';
      const dualClass       = c.dualClass ? ` / ${c.dualClass}` : '';
      const embed = new EmbedBuilder()
        .setColor(0x7289DA)
        .setTitle(c.name)
        .setDescription(
          `*${ancestryDisplay} · ${classDisplay}${dualClass} · Level ${lvl}*\n` +
          `**Background:** ${c.background ?? 'Unknown'} · **Deity:** ${c.deity ?? 'None'}\n` +
          `**XP:** ${xpDisplay}`
        )
        .addFields(
          { name: '⚔️ Combat Stats', value: `**AC** ${c.acTotal?.acTotal ?? '?'} · **HP** ${totalHP} · **Speed** ${c.attributes?.speed ?? 30} ft · **Perception** ${fmt(percMod)}\n**Prof Bonus** +${profBonus}` + (spellAttackBonus !== null ? ` · **Spell Attack** ${fmt(spellAttackBonus)} · **Spell DC** ${spellDC}` : ''), inline: false },
          { name: '💪 Ability Scores', value: `**STR** ${ab.str ?? '?'} (${getMod(ab.str ?? 10)}) · **DEX** ${ab.dex ?? '?'} (${getMod(ab.dex ?? 10)}) · **CON** ${ab.con ?? '?'} (${getMod(ab.con ?? 10)})\n**INT** ${ab.int ?? '?'} (${getMod(ab.int ?? 10)}) · **WIS** ${ab.wis ?? '?'} (${getMod(ab.wis ?? 10)}) · **CHA** ${ab.cha ?? '?'} (${getMod(ab.cha ?? 10)})`, inline: false },
          { name: '🛡️ Saving Throws', value: `**Fort** ${fmt(fortMod)} · **Reflex** ${fmt(reflexMod)} · **Will** ${fmt(willMod)}`, inline: false },
          { name: '🎯 Trained Skills', value: allTrainedSkills.length > 0 ? `\`\`\`${skillCols}\`\`\`` : 'No trained skills', inline: false },
          ...(attackLines ? [{ name: '⚔️ Attacks', value: attackLines.trim(), inline: false }] : []),
          { name: '🌐 Languages', value: languages.length > 0 ? languages.join(', ') : 'None set — use `/setinfo`', inline: true },
          { name: '👁️ Senses', value: senses.length > 0 ? senses.join(', ') : 'None set — use `/setinfo`', inline: true },
        )
        .setFooter({ text: `Pathfinder 2e · Saved ${charEntry.saved?.split('T')[0] ?? ''}` });
      if (charEntry.art) embed.setThumbnail(charEntry.art);
      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      console.error(err);
      await interaction.editReply('Something went wrong. Check the terminal for details!');
    }
  }

  // ─── /spellbook ──────────────────────────────────────────────────
  else if (commandName === 'spellbook') {
    await interaction.deferReply();
    const characters = loadCharacters();
    const nameArg    = interaction.options.getString('name');
    const { error, char: charEntry } = resolveChar(interaction.user.id, nameArg, characters);
    if (error) return interaction.editReply(error);
    const c = charEntry.data;
    if (!c.spellCasters || c.spellCasters.length === 0) return interaction.editReply(`**${c.name}** has no spellcasting!`);
    const embed = new EmbedBuilder().setColor(0x9B59B6).setTitle(`🔮 ${c.name}'s Spellbook`);
    if (charEntry.art) embed.setThumbnail(charEntry.art);
    c.spellCasters.forEach(caster => {
      let casterText = '';
      (caster.spells ?? []).forEach(slotGroup => {
        const names = slotGroup.list?.map(s => s.name).filter(Boolean).join(', ');
        if (names) {
          const label = slotGroup.spellLevel === 0 ? 'Cantrips' : `Level ${slotGroup.spellLevel}`;
          casterText += `**${label}:** ${names}\n`;
        }
      });
      if (casterText) embed.addFields({ name: `${caster.name} (${caster.magicTradition} · ${caster.castingType})`, value: casterText.trim(), inline: false });
    });
    embed.setFooter({ text: `Use /cast <spell> to cast · /spell <name> for spell details` });
    await interaction.editReply({ embeds: [embed] });
  }

  // ─── /charfeats ──────────────────────────────────────────────────
  else if (commandName === 'charfeats') {
    await interaction.deferReply();
    const characters = loadCharacters();
    const nameArg    = interaction.options.getString('name');
    const { error, char: charEntry } = resolveChar(interaction.user.id, nameArg, characters);
    if (error) return interaction.editReply(error);
    const c        = charEntry.data;
    const allFeats = (c.feats ?? []).map(f => Array.isArray(f) ? f[0] : f).filter(Boolean);
    const embed    = new EmbedBuilder().setColor(0x7289DA).setTitle(`✨ ${c.name}'s Feats`).setDescription(allFeats.length > 0 ? allFeats.join('\n') : 'No feats found');
    if (charEntry.art) embed.setThumbnail(charEntry.art);
    await interaction.editReply({ embeds: [embed] });
  }

  // ─── /spell ──────────────────────────────────────────────────────
  else if (commandName === 'spell') {
    await interaction.deferReply();
    const spellName = interaction.options.getString('name');
    const spell     = findSpell(spellName);
    if (!spell) return interaction.editReply(`Couldn't find a spell called **${spellName}**. Check the spelling and try again!`);
    const embed = buildSpellEmbed(spell);
    await interaction.editReply({ embeds: [embed] });
  }

  // ─── /cast ───────────────────────────────────────────────────────
  else if (commandName === 'cast') {
    await interaction.deferReply();
    const spellName  = interaction.options.getString('spell');
    const nameArg    = interaction.options.getString('character');
    const castLevel  = interaction.options.getInteger('level') ?? null;
    const characters = loadCharacters();
    const { error, char: charEntry } = resolveChar(interaction.user.id, nameArg, characters);
    if (error) return interaction.editReply(error);
    const rawSpell = findSpell(spellName);
    if (!rawSpell) return interaction.editReply(`Couldn't find a spell called **${spellName}**. Check the spelling and try again!`);
    const spell = normalizeSpell(rawSpell);
    const c    = charEntry.data;
    const ab   = c.abilities ?? {};
    const prof = c.proficiencies ?? {};
    const lvl  = c.level ?? 1;
    const traditionProfMap = { arcane: 'castingArcane', divine: 'castingDivine', occult: 'castingOccult', primal: 'castingPrimal' };
    const tradAbilMap      = { arcane: 'int', divine: 'wis', occult: 'cha', primal: 'wis' };
    let keyAbility   = 'int';
    let spellProfNum = 2;
    if (c.spellCasters?.length > 0) {
      const spellTraditions = spell.traditions.map(t => t.toLowerCase());
      const caster  = c.spellCasters.find(sc => spellTraditions.includes(sc.magicTradition?.toLowerCase())) ?? c.spellCasters[0];
      const tradKey = traditionProfMap[caster.magicTradition?.toLowerCase()] ?? 'castingArcane';
      spellProfNum  = prof[tradKey] ?? 2;
      keyAbility    = caster.ability?.toLowerCase() ?? tradAbilMap[caster.magicTradition?.toLowerCase()] ?? 'int';
    }
    const keyMod           = Math.floor(((ab[keyAbility] ?? 10) - 10) / 2);
    const spellAttackBonus = keyMod + calcProfNum(spellProfNum, lvl);
    const spellDC          = 10 + keyMod + calcProfNum(spellProfNum, lvl);
    const isAttackSpell    = !!spell.attack;
    const saveType         = spell.savingThrow ?? null;
    const effectiveLevel   = castLevel ?? spell.level ?? 1;
    const isCantrip        = spell.type === 'Cantrip';
    const levelDisplay     = isCantrip ? `Cantrip ${effectiveLevel}` : `Level ${effectiveLevel}`;
    const traditionDisplay = spell.traditions?.[0] ?? '';
    const embed = new EmbedBuilder().setColor(0x9B59B6).setTitle(`${c.name} casts ${spell.name}!`);
    if (charEntry.art) embed.setThumbnail(charEntry.art);
    let description = `*${levelDisplay}${traditionDisplay ? ` ${traditionDisplay}` : ''} spell*\n`;
    if (spell.cast)     description += `**Cast** ${spell.cast}\n`;
    if (spell.range)    description += `**Range** ${spell.range}\n`;
    if (spell.area)     description += `**Area** ${spell.area}\n`;
    if (spell.target)   description += `**Target** ${spell.target}\n`;
    if (spell.duration) description += `**Duration** ${spell.duration}\n`;
    description += '\n';
    if (isAttackSpell) {
      const dieRoll = Math.floor(Math.random() * 20) + 1;
      const total   = dieRoll + spellAttackBonus;
      description += `**Spell Attack Roll**\n1d20 (${dieRoll}) + ${spellAttackBonus} = **${total}**`;
      if (dieRoll === 20) description += ' ⭐ Natural 20!';
      if (dieRoll === 1)  description += ' 💀 Natural 1!';
      description += '\n\n';
    }
    if (saveType) description += `**${saveType.charAt(0).toUpperCase() + saveType.slice(1)} Save DC: ${spellDC}**\n\n`;
    if (spell.damage) description += `**Damage:** ${spell.damage}\n\n`;
    const shortDesc = spell.description ?? '';
    if (shortDesc && shortDesc !== '*No description available.*') {
      description += shortDesc.length > 400 ? shortDesc.slice(0, 400) + `...\n*Use \`/spell ${spell.name}\` for full details*` : shortDesc;
    }
    embed.setDescription(description);
    embed.setFooter({ text: `${c.name} · Spell Attack ${fmt(spellAttackBonus)} · DC ${spellDC}` });
    await interaction.editReply({ embeds: [embed] });
  }

  // ─── /setart ─────────────────────────────────────────────────────
  else if (commandName === 'setart') {
    const url        = interaction.options.getString('url');
    const nameArg    = interaction.options.getString('character');
    const characters = loadCharacters();
    const { error, charKey } = resolveChar(interaction.user.id, nameArg, characters);
    if (error) return interaction.reply({ content: error, ephemeral: true });
    if (!url.startsWith('http://') && !url.startsWith('https://')) return interaction.reply({ content: "That doesn't look like a valid URL.", ephemeral: true });
    characters[interaction.user.id][charKey].art = url;
    saveCharacters(characters);
    const charName = characters[interaction.user.id][charKey].name;
    const embed = new EmbedBuilder().setColor(0x7289DA).setTitle(`✅ Art set for ${charName}`).setThumbnail(url).setDescription('Character art updated!');
    await interaction.reply({ embeds: [embed] });
  }

  // ─── /roll ───────────────────────────────────────────────────────
  else if (commandName === 'roll') {
    const expression  = interaction.options.getString('dice');
    const charNameArg = interaction.options.getString('character');
    const match = expression.toLowerCase().replace(/\s+/g, '').match(/^(\d+)d(\d+)([+-]\d+)?$/);
    if (!match) return interaction.reply({ content: 'Invalid dice format! Try `1d20`, `2d6+3`, etc.', ephemeral: true });
    const count  = Math.min(parseInt(match[1]), 100);
    const sides  = parseInt(match[2]);
    const bonus  = parseInt(match[3] ?? '0');
    const rolls  = Array.from({ length: count }, () => Math.floor(Math.random() * sides) + 1);
    const total  = rolls.reduce((a, b) => a + b, 0) + bonus;
    const rollStr  = rolls.length > 1 ? `[${rolls.join(', ')}]` : `${rolls[0]}`;
    const bonusStr = bonus !== 0 ? ` + ${bonus}` : '';
    const isCrit   = sides === 20 && count === 1 && rolls[0] === 20;
    const isFumble = sides === 20 && count === 1 && rolls[0] === 1;
    let breakdown = `${count}d${sides} (${rollStr})${bonusStr} = **${total}**`;
    if (isCrit)   breakdown += '\n⭐ Natural 20!';
    if (isFumble) breakdown += '\n💀 Natural 1!';
    let thumbnail = null;
    if (charNameArg) {
      const characters = loadCharacters();
      const key = charNameArg.toLowerCase().replace(/\s+/g, '-');
      thumbnail = characters[interaction.user.id]?.[key]?.art ?? null;
    }
    const embed = buildRollEmbed({ title: `🎲 ${count}d${sides}${bonusStr}`, breakdown, charName: charNameArg ?? interaction.user.username, thumbnail });
    await interaction.reply({ embeds: [embed] });
  }

  // ─── /skill ──────────────────────────────────────────────────────
  else if (commandName === 'skill') {
    await interaction.deferReply();
    const skillName  = interaction.options.getString('skill');
    const nameArg    = interaction.options.getString('character');
    const extraBonus = interaction.options.getInteger('bonus') ?? 0;
    const characters = loadCharacters();
    const { error, char: charEntry } = resolveChar(interaction.user.id, nameArg, characters);
    if (error) return interaction.editReply(error);
    const c    = charEntry.data;
    const ab   = c.abilities ?? {};
    const prof = c.proficiencies ?? {};
    const lvl  = c.level ?? 1;
    const skillMap = {
      acrobatics: 'dex', arcana: 'int', athletics: 'str', crafting: 'int',
      deception: 'cha', diplomacy: 'cha', intimidation: 'cha', medicine: 'wis',
      nature: 'wis', occultism: 'int', performance: 'cha', religion: 'wis',
      society: 'int', stealth: 'dex', survival: 'wis', thievery: 'dex',
    };
    const abilKey  = skillMap[skillName];
    const abilMod  = Math.floor(((ab[abilKey] ?? 10) - 10) / 2);
    const profNum  = prof[skillName] ?? 0;
    const modifier = abilMod + calcProfNum(profNum, lvl);
    const dieRoll  = Math.floor(Math.random() * 20) + 1;
    const total    = dieRoll + modifier + extraBonus;
    const profLabels   = { 0: 'Untrained', 2: 'Trained', 4: 'Expert', 6: 'Master', 8: 'Legendary' };
    const profLabel    = profLabels[profNum] ?? 'Untrained';
    const skillDisplay = skillName.charAt(0).toUpperCase() + skillName.slice(1);
    const breakdown    = formatRollBreakdown(dieRoll, modifier, extraBonus, total, 20);
    const embed = buildRollEmbed({ title: `${c.name} makes a ${skillDisplay} check!`, breakdown, charName: `${c.name} · ${profLabel} (${fmt(modifier)})`, thumbnail: charEntry.art ?? null });
    await interaction.editReply({ embeds: [embed] });
  }

  // ─── /save ───────────────────────────────────────────────────────
  else if (commandName === 'save') {
    await interaction.deferReply();
    const saveType   = interaction.options.getString('type');
    const nameArg    = interaction.options.getString('character');
    const extraBonus = interaction.options.getInteger('bonus') ?? 0;
    const characters = loadCharacters();
    const { error, char: charEntry } = resolveChar(interaction.user.id, nameArg, characters);
    if (error) return interaction.editReply(error);
    const c    = charEntry.data;
    const ab   = c.abilities ?? {};
    const prof = c.proficiencies ?? {};
    const lvl  = c.level ?? 1;
    const saveAbilMap = { fortitude: 'con', reflex: 'dex', will: 'wis' };
    const abilKey  = saveAbilMap[saveType];
    const abilMod  = Math.floor(((ab[abilKey] ?? 10) - 10) / 2);
    const profNum  = prof[saveType] ?? 0;
    const modifier = abilMod + calcProfNum(profNum, lvl);
    const dieRoll  = Math.floor(Math.random() * 20) + 1;
    const total    = dieRoll + modifier + extraBonus;
    const saveDisplay = saveType.charAt(0).toUpperCase() + saveType.slice(1);
    const profLabels  = { 0: 'Untrained', 2: 'Trained', 4: 'Expert', 6: 'Master', 8: 'Legendary' };
    const profLabel   = profLabels[profNum] ?? 'Untrained';
    const breakdown   = formatRollBreakdown(dieRoll, modifier, extraBonus, total, 20);
    const embed = buildRollEmbed({ title: `${c.name} makes a ${saveDisplay} save!`, breakdown, charName: `${c.name} · ${profLabel} (${fmt(modifier)})`, thumbnail: charEntry.art ?? null });
    await interaction.editReply({ embeds: [embed] });
  }

  // ─── /addchar ────────────────────────────────────────────────────
  else if (commandName === 'addchar') {
    await interaction.deferReply();
    const attachment = interaction.options.getAttachment('file');
    if (!attachment.name.endsWith('.json')) return interaction.editReply('Please attach a `.json` file exported from Pathbuilder.');
    try {
      const response = await fetch(attachment.url);
      const data     = await response.json();
      const char     = data.build ?? data;
      if (!char || !char.name) return interaction.editReply('Could not read that file.');
      const characters     = loadCharacters();
      const userId         = interaction.user.id;
      if (!characters[userId]) characters[userId] = {};
      const key            = char.name.toLowerCase().replace(/\s+/g, '-');
      const existingArt    = characters[userId][key]?.art ?? null;
      const existingSenses = characters[userId][key]?.senses ?? null;
      characters[userId][key] = { name: char.name, data: char, art: existingArt, senses: existingSenses, saved: new Date().toISOString() };
      saveCharacters(characters);
      await interaction.editReply(`✅ **${char.name}** saved! Use \`/sheet\` to view them.`);
    } catch (err) {
      console.error(err);
      await interaction.editReply('Something went wrong reading that file. Try again!');
    }
  }

  // ─── /updatechar ─────────────────────────────────────────────────
  else if (commandName === 'updatechar') {
    await interaction.deferReply();
    const attachment = interaction.options.getAttachment('file');
    if (!attachment.name.endsWith('.json')) return interaction.editReply('Please attach a `.json` file exported from Pathbuilder.');
    try {
      const response = await fetch(attachment.url);
      const data     = await response.json();
      const char     = data.build ?? data;
      if (!char || !char.name) return interaction.editReply('Could not read that file.');
      const characters     = loadCharacters();
      const userId         = interaction.user.id;
      const key            = char.name.toLowerCase().replace(/\s+/g, '-');
      if (!characters[userId]?.[key]) return interaction.editReply(`Couldn't find **${char.name}**. Use \`/addchar\` first.`);
      const existingArt    = characters[userId][key].art ?? null;
      const existingSenses = characters[userId][key].senses ?? null;
      characters[userId][key] = { name: char.name, data: char, art: existingArt, senses: existingSenses, saved: new Date().toISOString() };
      saveCharacters(characters);
      await interaction.editReply(`✅ **${char.name}** updated to level ${char.level}!`);
    } catch (err) {
      console.error(err);
      await interaction.editReply('Something went wrong. Try again!');
    }
  }

  // ─── /mychars ────────────────────────────────────────────────────
  else if (commandName === 'mychars') {
    const userId     = interaction.user.id;
    const characters = loadCharacters();
    if (!characters[userId] || Object.keys(characters[userId]).length === 0) return interaction.reply('You have no saved characters! Use `/addchar` to add one.');
    const list = Object.values(characters[userId]).map(c => `• **${c.name}**${c.art ? ' 🖼️' : ''}`).join('\n');
    await interaction.reply(`Your characters:\n${list}`);
  }

  // ─── /removechar ─────────────────────────────────────────────────
  else if (commandName === 'removechar') {
    const userId     = interaction.user.id;
    const characters = loadCharacters();
    const nameArg    = interaction.options.getString('name');
    const charKey    = nameArg.toLowerCase().replace(/\s+/g, '-');
    if (!characters[userId]?.[charKey]) {
      const names = Object.values(characters[userId] ?? {}).map(c => c.name).join(', ');
      return interaction.reply(`Couldn't find that character. Your characters: ${names}`);
    }
    const name = characters[userId][charKey].name;
    delete characters[userId][charKey];
    saveCharacters(characters);
    await interaction.reply(`✅ **${name}** has been removed.`);
  }

  // ─── /ancestry ───────────────────────────────────────────────────
  else if (commandName === 'ancestry') {
    const input    = interaction.options.getString('name');
    const key      = input.toLowerCase().trim();
    const ancestry = ancestryDatabase[key];
    if (!ancestry) {
      return interaction.reply({ content: `❌ No ancestry found for **"${input}"**. Check your spelling or try another name.\nAvailable: ${Object.keys(ancestryDatabase).join(', ')}`, ephemeral: true });
    }
    const embed   = buildAncestryCorePage(ancestry);
    const buttons = buildAncestryButtons(0, key);
    await interaction.reply({ embeds: [embed], components: [buttons] });
  }

});

client.login(process.env.TOKEN);