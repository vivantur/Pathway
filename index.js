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

let archetypeDatabase = {};
try {
  archetypeDatabase = JSON.parse(fs.readFileSync('archetypes.json', 'utf8'));
  console.log(`Loaded ${Object.keys(archetypeDatabase).length} archetypes from database.`);
} catch (err) {
  console.error('Could not load archetypes.json:', err.message);
}

let rulesDatabase = {};
try {
  rulesDatabase = JSON.parse(fs.readFileSync('rules.json', 'utf8'));
  const total = Object.values(rulesDatabase).reduce((sum, cat) => sum + Object.keys(cat).length, 0);
  console.log(`Loaded ${total} rules entries from database.`);
} catch (err) {
  console.error('Could not load rules.json:', err.message);
}

function loadCharacters() {
  try { return JSON.parse(fs.readFileSync('characters.json', 'utf8')); }
  catch { return {}; }
}
function saveCharacters(data) {
  fs.writeFileSync('characters.json', JSON.stringify(data, null, 2));
}

// ── Bag helpers ───────────────────────────────────────────────────────────────
function loadBags() {
  try { return JSON.parse(fs.readFileSync('bags.json', 'utf8')); }
  catch { return {}; }
}
function saveBags(data) {
  fs.writeFileSync('bags.json', JSON.stringify(data, null, 2));
}

function getOrCreateBag(bags, userId) {
  if (!bags[userId]) {
    bags[userId] = { bagName: 'Bag 1', categories: {} };
  }
  return bags[userId];
}

function buildBagEmbed(userBag) {
  const embed = new EmbedBuilder()
    .setTitle(`🎒 ${userBag.bagName}`)
    .setColor(0x9B59B6)
    .setFooter({ text: '/bag add • /bag remove • /bag removecategory • /bag rename • /bag clear' });

  const cats = Object.entries(userBag.categories ?? {});

  if (cats.length === 0) {
    embed.setDescription('*Your bag is empty. Use `/bag add <category> <item>` to get started!*');
  } else {
    for (const [cat, items] of cats) {
      const value = items.length > 0 ? items.join('\n') : '*Empty*';
      embed.addFields({ name: `**${cat}**`, value, inline: true });
    }
  }

  return embed;
}

// ── Character helpers ─────────────────────────────────────────────────────────
function getMod(score) {
  const mod = Math.floor((score - 10) / 2);
  return mod >= 0 ? `+${mod}` : `${mod}`;
}
function calcProfNum(profNum, level) {
  if (!profNum || profNum === 0) return 0;
  return profNum + level;
}
function fmt(n) { return n >= 0 ? `+${n}` : `${n}`; }
function xpToNextLevel() { return 1000; }

function resolveChar(userId, nameArg, characters) {
  if (!characters[userId] || Object.keys(characters[userId]).length === 0)
    return { error: 'You have no saved characters! Use `/char add` to add one.' };
  let charKey;
  if (!nameArg) {
    const keys = Object.keys(characters[userId]);
    if (keys.length === 1) { charKey = keys[0]; }
    else {
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
  const embed = new EmbedBuilder().setColor(0x7289DA).setTitle(title).setDescription(breakdown);
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
  const normalize = str => str.toLowerCase().trim()
    .replace(/[\u2018\u2019\u02bc]/g, "'").replace(/[\u201c\u201d]/g, '"');
  const query = normalize(spellName);
  return spellDatabase.find(s => normalize(s.name ?? '') === query)
    || spellDatabase.find(s => normalize(s.name ?? '').startsWith(query))
    || spellDatabase.find(s => normalize(s.name ?? '').includes(query))
    || null;
}

// ── Rules lookup ──────────────────────────────────────────────────────────────
function findRule(query) {
  const q = query.toLowerCase().trim().replace(/\s+/g, '-');
  const qRaw = query.toLowerCase().trim();
  for (const category of Object.values(rulesDatabase)) {
    if (category[q]) return { rule: category[q], matches: [] };
    const exactName = Object.values(category).find(r => r.name.toLowerCase() === qRaw);
    if (exactName) return { rule: exactName, matches: [] };
  }
  const matches = [];
  for (const category of Object.values(rulesDatabase)) {
    for (const [key, rule] of Object.entries(category)) {
      if (rule.name.toLowerCase().includes(qRaw) || key.includes(q)) matches.push(rule);
    }
  }
  if (matches.length === 1) return { rule: matches[0], matches: [] };
  if (matches.length > 1)   return { rule: null, matches };
  return { rule: null, matches: [] };
}

function buildRuleEmbed(rule) {
  const colors  = { condition: 0xe74c3c, action: 0x2ecc71, trait: 0xf39c12 };
  const emojis  = { condition: '🩸', action: '⚡', trait: '🏷️' };
  const embed = new EmbedBuilder()
    .setColor(colors[rule.category] ?? 0x7289DA)
    .setTitle(`${emojis[rule.category] ?? '📖'} ${rule.name}`)
    .setDescription(rule.description);
  if (rule.action_cost) embed.addFields({ name: '⏱️ Action Cost', value: rule.action_cost, inline: true });
  if (rule.value_label) embed.addFields({ name: '📊 Format', value: rule.value_label, inline: true });
  if (rule.traits?.length) embed.addFields({ name: '🏷️ Traits', value: rule.traits.join(', '), inline: true });
  if (rule.trigger)      embed.addFields({ name: '🔔 Trigger', value: rule.trigger, inline: false });
  if (rule.requirements) embed.addFields({ name: '📋 Requirements', value: rule.requirements, inline: false });
  const cat = rule.category.charAt(0).toUpperCase() + rule.category.slice(1);
  embed.setFooter({ text: `${cat} • ${rule.source ?? 'Pathfinder 2e'}` });
  return embed;
}

// ── Archetype lookup ──────────────────────────────────────────────────────────
function findArchetype(query) {
  const q = query.toLowerCase().trim();
  for (const [key, archetype] of Object.entries(archetypeDatabase)) {
    if (key.toLowerCase() === q) return { archetype, matches: [] };
  }
  const matches = Object.entries(archetypeDatabase).filter(([key]) => key.toLowerCase().includes(q));
  if (matches.length === 1) return { archetype: matches[0][1], matches: [] };
  if (matches.length > 1)   return { archetype: null, matches: matches.map(([k]) => k) };
  return { archetype: null, matches: [] };
}

function buildArchetypeEmbed(archetype) {
  const rarityColor = { Common: 0x4a90d9, Uncommon: 0xc45f00, Rare: 0x6b21a8 };
  const typeEmoji = archetype.type === 'multiclass' ? '🔀' : '📖';
  const typeLabel = archetype.type === 'multiclass' ? 'Multiclass Archetype' : 'Archetype';
  const rarityLabel = archetype.rarity !== 'Common' ? ` • ${archetype.rarity}` : '';
  const embed = new EmbedBuilder()
    .setColor(rarityColor[archetype.rarity] ?? 0x4a90d9)
    .setTitle(`${typeEmoji} ${archetype.name}`)
    .setDescription(archetype.description || '*No description available.*')
    .addFields(
      { name: '📋 Type',            value: `${typeLabel}${rarityLabel}`, inline: true },
      { name: '🎯 Dedication Feat', value: `Feat ${archetype.dedication_level}`, inline: true },
      { name: '📚 Source',          value: archetype.source || 'Unknown', inline: true },
    );
  if (archetype.prerequisites)
    embed.addFields({ name: '⚠️ Prerequisites', value: archetype.prerequisites, inline: false });
  embed.setFooter({ text: 'Pathway • PF2e Archetype Lookup' });
  return embed;
}

// ── Currency helpers ──────────────────────────────────────────────────────────
const COPPER_VALUE = { cp: 1, sp: 10, gp: 100, pp: 1000 };

function walletToCopper(wallet) {
  return (wallet.cp ?? 0) + (wallet.sp ?? 0) * 10 + (wallet.gp ?? 0) * 100 + (wallet.pp ?? 0) * 1000;
}
function copperToWallet(total) {
  const pp = Math.floor(total / 1000); total %= 1000;
  const gp = Math.floor(total / 100);  total %= 100;
  const sp = Math.floor(total / 10);   total %= 10;
  return { pp, gp, sp, cp: total };
}
function formatWallet(wallet) {
  const parts = [];
  if (wallet.pp) parts.push(`${wallet.pp} pp`);
  if (wallet.gp) parts.push(`${wallet.gp} gp`);
  if (wallet.sp) parts.push(`${wallet.sp} sp`);
  if (wallet.cp || parts.length === 0) parts.push(`${wallet.cp ?? 0} cp`);
  return parts.join(', ');
}
function buildWalletEmbed(char, charEntry) {
  const wallet = charEntry.wallet ?? { pp: 0, gp: 0, sp: 0, cp: 0 };
  const totalGP = (walletToCopper(wallet) / 100).toFixed(2);
  const embed = new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle(`💰 ${char.name}'s Wallet`)
    .addFields(
      { name: '🟣 Platinum (pp)', value: `${wallet.pp ?? 0}`, inline: true },
      { name: '🟡 Gold (gp)',     value: `${wallet.gp ?? 0}`, inline: true },
      { name: '⚪ Silver (sp)',   value: `${wallet.sp ?? 0}`, inline: true },
      { name: '🟤 Copper (cp)',   value: `${wallet.cp ?? 0}`, inline: true },
      { name: '💵 Total Value',   value: `${totalGP} gp`,     inline: true },
    )
    .setFooter({ text: 'Use /gold add, /gold spend, or /gold convert' });
  if (charEntry.art) embed.setThumbnail(charEntry.art);
  return embed;
}

// ── Normalize spell ───────────────────────────────────────────────────────────
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
  if (spell.defense && spell.defense.trim()) savingThrow = spell.defense.replace(/^basic\s+/i, '').trim();
  const target = spell.target ?? spell.targets ?? null;
  let damage = spell.damage;
  if (damage && typeof damage === 'object') {
    const parts = [damage.base, damage.type].filter(Boolean).join(' ');
    damage = (parts + (damage.extra ? ` + ${damage.extra}` : '')).trim() || null;
  }
  if (!damage || (typeof damage === 'string' && !damage.trim())) damage = null;
  let description = spell.description?.trim() || spell.summary?.trim() || '*No description available.*';
  return { ...spell, level, traditions, traits, type, savingThrow, target, damage, description };
}

// ── Build spell embed ─────────────────────────────────────────────────────────
function buildSpellEmbed(rawSpell) {
  const spell = normalizeSpell(rawSpell);
  const isCantrip = spell.type === 'Cantrip';
  const levelDisplay = isCantrip ? `Cantrip ${spell.level}` : `Spell ${spell.level}`;
  const traditionsDisplay = spell.traditions.length > 0 ? spell.traditions.join(', ') : 'None';
  const traitsDisplay = spell.traits.length > 0 ? spell.traits.join(', ') : null;
  let description = spell.description && spell.description.trim() ? spell.description : '*No description available.*';
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
    spell.duration ? `**Duration** ${spell.duration}` : null,
  ].filter(Boolean);
  if (metaLines.length > 0) embed.addFields({ name: 'Meta', value: metaLines.join('\n'), inline: false });
  if (spell.savingThrow) embed.addFields({ name: 'Saving Throw', value: spell.savingThrow, inline: false });
  if (spell.damage)      embed.addFields({ name: 'Damage', value: spell.damage, inline: false });
  if (spell.heightening && typeof spell.heightening === 'object') {
    let htText = '';
    if (spell.heightening.type === 'per_rank' && spell.heightening.damage_bonus)
      htText = `Each rank above ${spell.level}: +${spell.heightening.damage_bonus} damage`;
    else if (spell.heightening.type === 'fixed' && spell.heightening.levels)
      htText = Object.entries(spell.heightening.levels).map(([k, v]) => `**${k}:** ${v}`).join('\n');
    else htText = JSON.stringify(spell.heightening);
    if (htText) embed.addFields({ name: '⬆️ Heightened', value: htText, inline: false });
  } else if (spell.heightened?.trim()) {
    embed.addFields({ name: '⬆️ Heightened', value: spell.heightened, inline: false });
  }
  embed.setFooter({ text: `Pathfinder 2e · ${spell.source ?? 'Unknown source'}` });
  return embed;
}

// ── Ancestry embed builders ───────────────────────────────────────────────────
const ANCESTRY_COLORS = { main: 0x4B8B6F, heritage: 0x7B5EA7, feats: 0xC4862A };

function buildAncestryCorePage(ancestry) {
  const boosts = ancestry.attribute_boosts.join(', ');
  const flaws  = ancestry.attribute_flaws.length ? ancestry.attribute_flaws.join(', ') : 'None';
  const sensesText   = ancestry.senses.map(s => `**${s.name}** — ${s.description}`).join('\n');
  const languageText = `${ancestry.languages.base.join(', ')}\n*Plus additional languages equal to ${ancestry.languages.bonus_count}, chosen from: ${ancestry.languages.bonus_pool.join(', ')}.*`;
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
      { name: '👁️ Senses',          value: sensesText || 'None',    inline: false },
      { name: '🗣️ Languages',       value: languageText,            inline: false },
    );
}

function buildAncestryHeritagesPage(ancestry) {
  const embed = new EmbedBuilder()
    .setTitle(`${ancestry.name} — Heritages`)
    .setDescription('Choose one heritage at character creation.')
    .setColor(ANCESTRY_COLORS.heritage)
    .setFooter({ text: `Source: ${ancestry.source} • Page 2/3` });
  for (const h of ancestry.heritages)
    embed.addFields({ name: `◈ ${h.name}`, value: h.description, inline: false });
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
client.once('clientReady', () => { console.log(`Logged in as ${client.user.tag}!`); });

// ── Interaction handler ───────────────────────────────────────────────────────
client.on('interactionCreate', async (interaction) => {

  // ── Button handler ────────────────────────────────────────────────
  if (interaction.isButton()) {
    if (!interaction.customId.startsWith('ancestry_')) return;
    const parts = interaction.customId.split('_');
    const pageIndex = parseInt(parts[parts.length - 1], 10);
    const ancestryKey = parts.slice(1, parts.length - 1).join('_');
    const ancestry = ancestryDatabase[ancestryKey];
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

  // ─── /char ───────────────────────────────────────────────────────
  else if (commandName === 'char') {
    const sub = interaction.options.getSubcommand();

    // ADD
    if (sub === 'add') {
      await interaction.deferReply();
      const attachment = interaction.options.getAttachment('file');
      if (!attachment.name.endsWith('.json')) return interaction.editReply('Please attach a `.json` file exported from Pathbuilder.');
      try {
        const response = await fetch(attachment.url);
        const data = await response.json();
        const char = data.build ?? data;
        if (!char || !char.name) return interaction.editReply('Could not read that file.');
        const characters = loadCharacters();
        const userId = interaction.user.id;
        if (!characters[userId]) characters[userId] = {};
        const key = char.name.toLowerCase().replace(/\s+/g, '-');
        const existingArt    = characters[userId][key]?.art ?? null;
        const existingSenses = characters[userId][key]?.senses ?? null;
        characters[userId][key] = { name: char.name, data: char, art: existingArt, senses: existingSenses, saved: new Date().toISOString() };
        saveCharacters(characters);
        await interaction.editReply(`✅ **${char.name}** saved! Use \`/sheet\` to view them.`);
      } catch (err) { console.error(err); await interaction.editReply('Something went wrong reading that file. Try again!'); }
    }

    // UPDATE
    else if (sub === 'update') {
      await interaction.deferReply();
      const attachment = interaction.options.getAttachment('file');
      if (!attachment.name.endsWith('.json')) return interaction.editReply('Please attach a `.json` file exported from Pathbuilder.');
      try {
        const response = await fetch(attachment.url);
        const data = await response.json();
        const char = data.build ?? data;
        if (!char || !char.name) return interaction.editReply('Could not read that file.');
        const characters = loadCharacters();
        const userId = interaction.user.id;
        const key = char.name.toLowerCase().replace(/\s+/g, '-');
        if (!characters[userId]?.[key]) return interaction.editReply(`Couldn't find **${char.name}**. Use \`/char add\` first.`);
        const existingArt    = characters[userId][key].art ?? null;
        const existingSenses = characters[userId][key].senses ?? null;
        characters[userId][key] = { name: char.name, data: char, art: existingArt, senses: existingSenses, saved: new Date().toISOString() };
        saveCharacters(characters);
        await interaction.editReply(`✅ **${char.name}** updated to level ${char.level}!`);
      } catch (err) { console.error(err); await interaction.editReply('Something went wrong. Try again!'); }
    }

    // REMOVE
    else if (sub === 'remove') {
      const userId = interaction.user.id;
      const characters = loadCharacters();
      const charKey = interaction.options.getString('name').toLowerCase().replace(/\s+/g, '-');
      if (!characters[userId]?.[charKey]) {
        const names = Object.values(characters[userId] ?? {}).map(c => c.name).join(', ');
        return interaction.reply(`Couldn't find that character. Your characters: ${names}`);
      }
      const name = characters[userId][charKey].name;
      delete characters[userId][charKey];
      saveCharacters(characters);
      await interaction.reply(`✅ **${name}** has been removed.`);
    }

    // LIST
    else if (sub === 'list') {
      const userId = interaction.user.id;
      const characters = loadCharacters();
      if (!characters[userId] || Object.keys(characters[userId]).length === 0)
        return interaction.reply('You have no saved characters! Use `/char add` to add one.');
      const list = Object.values(characters[userId]).map(c => `• **${c.name}**${c.art ? ' 🖼️' : ''}`).join('\n');
      await interaction.reply(`Your characters:\n${list}`);
    }

    // FEATS
    else if (sub === 'feats') {
      await interaction.deferReply();
      const characters = loadCharacters();
      const { error, char: charEntry } = resolveChar(interaction.user.id, interaction.options.getString('name'), characters);
      if (error) return interaction.editReply(error);
      const c = charEntry.data;
      const allFeats = (c.feats ?? []).map(f => Array.isArray(f) ? f[0] : f).filter(Boolean);
      const embed = new EmbedBuilder().setColor(0x7289DA).setTitle(`✨ ${c.name}'s Feats`).setDescription(allFeats.length > 0 ? allFeats.join('\n') : 'No feats found');
      if (charEntry.art) embed.setThumbnail(charEntry.art);
      await interaction.editReply({ embeds: [embed] });
    }

    // ART
    else if (sub === 'art') {
      const url = interaction.options.getString('url');
      const characters = loadCharacters();
      const { error, charKey } = resolveChar(interaction.user.id, interaction.options.getString('character'), characters);
      if (error) return interaction.reply({ content: error, ephemeral: true });
      if (!url.startsWith('http://') && !url.startsWith('https://')) return interaction.reply({ content: "That doesn't look like a valid URL.", ephemeral: true });
      characters[interaction.user.id][charKey].art = url;
      saveCharacters(characters);
      const charName = characters[interaction.user.id][charKey].name;
      await interaction.reply({ embeds: [new EmbedBuilder().setColor(0x7289DA).setTitle(`✅ Art set for ${charName}`).setThumbnail(url).setDescription('Character art updated!')] });
    }

    // INFO
    else if (sub === 'info') {
      const field = interaction.options.getString('field');
      const value = interaction.options.getString('value');
      const nameArg = interaction.options.getString('character');
      const characters = loadCharacters();
      const { error, charKey } = resolveChar(interaction.user.id, nameArg, characters);
      if (error) return interaction.reply({ content: error, ephemeral: true });
      const parsed = value.split(',').map(v => v.trim()).filter(Boolean);
      characters[interaction.user.id][charKey][field] = parsed;
      saveCharacters(characters);
      const charName = characters[interaction.user.id][charKey].name;
      const fieldLabel = field.charAt(0).toUpperCase() + field.slice(1);
      await interaction.reply({ content: `✅ **${fieldLabel}** updated for **${charName}**:\n${parsed.join(', ')}`, ephemeral: true });
    }
  }

  // ─── /sheet ──────────────────────────────────────────────────────
  else if (commandName === 'sheet') {
    await interaction.deferReply();
    const userId = interaction.user.id;
    const characters = loadCharacters();
    const nameArg = interaction.options.getString('name');
    const { error, charKey, char: charEntry } = resolveChar(userId, nameArg, characters);
    if (error) return interaction.editReply(error);
    try {
      const c = charEntry.data;
      const lvl = c.level ?? 1;
      const ab = c.abilities ?? {};
      const prof = c.proficiencies ?? {};
      const currentXP = c.xp ?? 0;
      const xpDisplay = `${currentXP} / ${xpToNextLevel(lvl)} XP`;
      const conMod = Math.floor(((ab.con ?? 10) - 10) / 2);
      const totalHP = (c.attributes?.ancestryhp ?? 0) + (c.attributes?.classhp ?? 0) + ((c.attributes?.bonushp ?? 0) * lvl) + (conMod * lvl);
      const profBonus = Math.floor(lvl / 4) + 2;
      const wisMod = Math.floor(((ab.wis ?? 10) - 10) / 2);
      const percMod = wisMod + calcProfNum(prof.perception ?? 0, lvl);
      let spellAttackBonus = null, spellDC = null;
      if (c.spellCasters?.length > 0) {
        const caster = c.spellCasters[0];
        const tradAbilMap = { arcane: 'int', divine: 'wis', occult: 'cha', primal: 'wis' };
        const traditionProfMap = { arcane: 'castingArcane', divine: 'castingDivine', occult: 'castingOccult', primal: 'castingPrimal' };
        const tradKey = traditionProfMap[caster.magicTradition?.toLowerCase()] ?? 'castingArcane';
        const keyAbility = caster.ability?.toLowerCase() ?? tradAbilMap[caster.magicTradition?.toLowerCase()] ?? 'int';
        const keyMod = Math.floor(((ab[keyAbility] ?? 10) - 10) / 2);
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
          const total = abilMod + calcProfNum(profNum, lvl);
          return `${profIcons[profNum] || '◑'} ${skill.charAt(0).toUpperCase() + skill.slice(1)} ${fmt(total)}`;
        });
      const loreSkills = (c.lores ?? []).map(([loreName, profNum]) => {
        const intMod = Math.floor(((ab.int ?? 10) - 10) / 2);
        const total = intMod + calcProfNum(profNum, lvl);
        return `${profIcons[profNum] || '◑'} Lore: ${loreName} ${fmt(total)}`;
      });
      const allTrainedSkills = [...trainedSkills, ...loreSkills];
      const half = Math.ceil(allTrainedSkills.length / 2);
      const col1 = allTrainedSkills.slice(0, half);
      const col2 = allTrainedSkills.slice(half);
      const skillCols = col1.map((s, i) => `${s.padEnd(24)}${col2[i] ?? ''}`).join('\n');
      let attackLines = '';
      if (c.weapons?.length > 0) {
        c.weapons.forEach(w => {
          const atkBonus = w.attack ?? 0;
          const dmgBonus = w.damageBonus > 0 ? `+${w.damageBonus}` : w.damageBonus < 0 ? `${w.damageBonus}` : '';
          const dmgType = w.damageType === 'P' ? 'Piercing' : w.damageType === 'S' ? 'Slashing' : w.damageType === 'B' ? 'Bludgeoning' : w.damageType ?? '';
          attackLines += `**${w.display ?? w.name}** ${fmt(atkBonus)} to hit · ${w.die ?? '1d4'}${dmgBonus} ${dmgType}\n`;
        });
      }
      const languages = charEntry.languages ?? c.languages ?? [];
      const senses = charEntry.senses ?? [];
      const ancestryDisplay = `${c.ancestry ?? ''} ${c.heritage ?? ''}`.trim();
      const classDisplay = c.class ?? 'Unknown';
      const dualClass = c.dualClass ? ` / ${c.dualClass}` : '';
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
          { name: '🌐 Languages', value: languages.length > 0 ? languages.join(', ') : 'None set — use `/char info`', inline: true },
          { name: '👁️ Senses', value: senses.length > 0 ? senses.join(', ') : 'None set — use `/char info`', inline: true },
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
    const { error, char: charEntry } = resolveChar(interaction.user.id, interaction.options.getString('name'), characters);
    if (error) return interaction.editReply(error);
    const c = charEntry.data;
    if (!c.spellCasters?.length) return interaction.editReply(`**${c.name}** has no spellcasting!`);
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
    embed.setFooter({ text: 'Use /cast <spell> to cast · /spell <n> for spell details' });
    await interaction.editReply({ embeds: [embed] });
  }

  // ─── /spell ──────────────────────────────────────────────────────
  else if (commandName === 'spell') {
    await interaction.deferReply();
    const spell = findSpell(interaction.options.getString('name'));
    if (!spell) return interaction.editReply(`Couldn't find that spell. Check the spelling and try again!`);
    await interaction.editReply({ embeds: [buildSpellEmbed(spell)] });
  }

  // ─── /cast ───────────────────────────────────────────────────────
  else if (commandName === 'cast') {
    await interaction.deferReply();
    const spellName = interaction.options.getString('spell');
    const nameArg   = interaction.options.getString('character');
    const castLevel = interaction.options.getInteger('level') ?? null;
    const characters = loadCharacters();
    const { error, char: charEntry } = resolveChar(interaction.user.id, nameArg, characters);
    if (error) return interaction.editReply(error);
    const rawSpell = findSpell(spellName);
    if (!rawSpell) return interaction.editReply(`Couldn't find a spell called **${spellName}**. Check the spelling and try again!`);
    const spell = normalizeSpell(rawSpell);
    const c = charEntry.data;
    const ab = c.abilities ?? {};
    const prof = c.proficiencies ?? {};
    const lvl = c.level ?? 1;
    const traditionProfMap = { arcane: 'castingArcane', divine: 'castingDivine', occult: 'castingOccult', primal: 'castingPrimal' };
    const tradAbilMap = { arcane: 'int', divine: 'wis', occult: 'cha', primal: 'wis' };
    let keyAbility = 'int', spellProfNum = 2;
    if (c.spellCasters?.length > 0) {
      const spellTraditions = spell.traditions.map(t => t.toLowerCase());
      const caster = c.spellCasters.find(sc => spellTraditions.includes(sc.magicTradition?.toLowerCase())) ?? c.spellCasters[0];
      const tradKey = traditionProfMap[caster.magicTradition?.toLowerCase()] ?? 'castingArcane';
      spellProfNum = prof[tradKey] ?? 2;
      keyAbility = caster.ability?.toLowerCase() ?? tradAbilMap[caster.magicTradition?.toLowerCase()] ?? 'int';
    }
    const keyMod = Math.floor(((ab[keyAbility] ?? 10) - 10) / 2);
    const spellAttackBonus = keyMod + calcProfNum(spellProfNum, lvl);
    const spellDC = 10 + keyMod + calcProfNum(spellProfNum, lvl);
    const isAttackSpell = !!spell.attack;
    const saveType = spell.savingThrow ?? null;
    const effectiveLevel = castLevel ?? spell.level ?? 1;
    const isCantrip = spell.type === 'Cantrip';
    const levelDisplay = isCantrip ? `Cantrip ${effectiveLevel}` : `Level ${effectiveLevel}`;
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
      const total = dieRoll + spellAttackBonus;
      description += `**Spell Attack Roll**\n1d20 (${dieRoll}) + ${spellAttackBonus} = **${total}**`;
      if (dieRoll === 20) description += ' ⭐ Natural 20!';
      if (dieRoll === 1)  description += ' 💀 Natural 1!';
      description += '\n\n';
    }
    if (saveType) description += `**${saveType.charAt(0).toUpperCase() + saveType.slice(1)} Save DC: ${spellDC}**\n\n`;
    if (spell.damage) description += `**Damage:** ${spell.damage}\n\n`;
    const shortDesc = spell.description ?? '';
    if (shortDesc && shortDesc !== '*No description available.*')
      description += shortDesc.length > 400 ? shortDesc.slice(0, 400) + `...\n*Use \`/spell ${spell.name}\` for full details*` : shortDesc;
    embed.setDescription(description);
    embed.setFooter({ text: `${c.name} · Spell Attack ${fmt(spellAttackBonus)} · DC ${spellDC}` });
    await interaction.editReply({ embeds: [embed] });
  }

  // ─── /roll ───────────────────────────────────────────────────────
  else if (commandName === 'roll') {
    const expression = interaction.options.getString('dice');
    const charNameArg = interaction.options.getString('character');
    const match = expression.toLowerCase().replace(/\s+/g, '').match(/^(\d+)d(\d+)([+-]\d+)?$/);
    if (!match) return interaction.reply({ content: 'Invalid dice format! Try `1d20`, `2d6+3`, etc.', ephemeral: true });
    const count = Math.min(parseInt(match[1]), 100);
    const sides = parseInt(match[2]);
    const bonus = parseInt(match[3] ?? '0');
    const rolls = Array.from({ length: count }, () => Math.floor(Math.random() * sides) + 1);
    const total = rolls.reduce((a, b) => a + b, 0) + bonus;
    const rollStr = rolls.length > 1 ? `[${rolls.join(', ')}]` : `${rolls[0]}`;
    const bonusStr = bonus !== 0 ? ` + ${bonus}` : '';
    const isCrit   = sides === 20 && count === 1 && rolls[0] === 20;
    const isFumble = sides === 20 && count === 1 && rolls[0] === 1;
    let breakdown = `${count}d${sides} (${rollStr})${bonusStr} = **${total}**`;
    if (isCrit)   breakdown += '\n⭐ Natural 20!';
    if (isFumble) breakdown += '\n💀 Natural 1!';
    let thumbnail = null;
    if (charNameArg) {
      const characters = loadCharacters();
      thumbnail = characters[interaction.user.id]?.[charNameArg.toLowerCase().replace(/\s+/g, '-')]?.art ?? null;
    }
    await interaction.reply({ embeds: [buildRollEmbed({ title: `🎲 ${count}d${sides}${bonusStr}`, breakdown, charName: charNameArg ?? interaction.user.username, thumbnail })] });
  }

  // ─── /skill ──────────────────────────────────────────────────────
  else if (commandName === 'skill') {
    await interaction.deferReply();
    const skillName  = interaction.options.getString('skill');
    const extraBonus = interaction.options.getInteger('bonus') ?? 0;
    const characters = loadCharacters();
    const { error, char: charEntry } = resolveChar(interaction.user.id, interaction.options.getString('character'), characters);
    if (error) return interaction.editReply(error);
    const c = charEntry.data;
    const ab = c.abilities ?? {};
    const prof = c.proficiencies ?? {};
    const lvl = c.level ?? 1;
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
    const profLabels = { 0: 'Untrained', 2: 'Trained', 4: 'Expert', 6: 'Master', 8: 'Legendary' };
    const skillDisplay = skillName.charAt(0).toUpperCase() + skillName.slice(1);
    await interaction.editReply({ embeds: [buildRollEmbed({ title: `${c.name} makes a ${skillDisplay} check!`, breakdown: formatRollBreakdown(dieRoll, modifier, extraBonus, total, 20), charName: `${c.name} · ${profLabels[profNum] ?? 'Untrained'} (${fmt(modifier)})`, thumbnail: charEntry.art ?? null })] });
  }

  // ─── /save ───────────────────────────────────────────────────────
  else if (commandName === 'save') {
    await interaction.deferReply();
    const saveType   = interaction.options.getString('type');
    const extraBonus = interaction.options.getInteger('bonus') ?? 0;
    const characters = loadCharacters();
    const { error, char: charEntry } = resolveChar(interaction.user.id, interaction.options.getString('character'), characters);
    if (error) return interaction.editReply(error);
    const c = charEntry.data;
    const ab = c.abilities ?? {};
    const prof = c.proficiencies ?? {};
    const lvl = c.level ?? 1;
    const saveAbilMap = { fortitude: 'con', reflex: 'dex', will: 'wis' };
    const abilKey  = saveAbilMap[saveType];
    const abilMod  = Math.floor(((ab[abilKey] ?? 10) - 10) / 2);
    const profNum  = prof[saveType] ?? 0;
    const modifier = abilMod + calcProfNum(profNum, lvl);
    const dieRoll  = Math.floor(Math.random() * 20) + 1;
    const total    = dieRoll + modifier + extraBonus;
    const profLabels = { 0: 'Untrained', 2: 'Trained', 4: 'Expert', 6: 'Master', 8: 'Legendary' };
    const saveDisplay = saveType.charAt(0).toUpperCase() + saveType.slice(1);
    await interaction.editReply({ embeds: [buildRollEmbed({ title: `${c.name} makes a ${saveDisplay} save!`, breakdown: formatRollBreakdown(dieRoll, modifier, extraBonus, total, 20), charName: `${c.name} · ${profLabels[profNum] ?? 'Untrained'} (${fmt(modifier)})`, thumbnail: charEntry.art ?? null })] });
  }

  // ─── /ancestry ───────────────────────────────────────────────────
  else if (commandName === 'ancestry') {
    const input = interaction.options.getString('name');
    const key = input.toLowerCase().trim();
    const ancestry = ancestryDatabase[key];
    if (!ancestry) return interaction.reply({ content: `❌ No ancestry found for **"${input}"**. Available: ${Object.keys(ancestryDatabase).join(', ')}`, ephemeral: true });
    await interaction.reply({ embeds: [buildAncestryCorePage(ancestry)], components: [buildAncestryButtons(0, key)] });
  }

  // ─── /archetype ──────────────────────────────────────────────────
  else if (commandName === 'archetype') {
    const input = interaction.options.getString('name');
    const { archetype, matches } = findArchetype(input);
    if (!archetype && matches.length > 1)
      return interaction.reply({ content: `🔍 Multiple archetypes match **"${input}"**. Did you mean one of these?\n**${matches.sort().join(', ')}**`, ephemeral: true });
    if (!archetype)
      return interaction.reply({ content: `❌ No archetype found for **"${input}"**. Check your spelling or try another name.`, ephemeral: true });
    await interaction.reply({ embeds: [buildArchetypeEmbed(archetype)] });
  }

  // ─── /rule ───────────────────────────────────────────────────────
  else if (commandName === 'rule') {
    const input = interaction.options.getString('name');
    const { rule, matches } = findRule(input);
    if (!rule && matches.length > 1) {
      const nameList = matches.map(r => `${r.name} *(${r.category})*`).sort().join('\n');
      return interaction.reply({ content: `🔍 Multiple entries match **"${input}"**:\n${nameList}`, ephemeral: true });
    }
    if (!rule)
      return interaction.reply({ content: `❌ No rule found for **"${input}"**.\nTry a **condition** (e.g. frightened, prone), **action** (e.g. stride, grapple), or **trait** (e.g. agile, finesse).`, ephemeral: true });
    await interaction.reply({ embeds: [buildRuleEmbed(rule)] });
  }

  // ─── /bag ────────────────────────────────────────────────────────
  else if (commandName === 'bag') {
    const sub = interaction.options.getSubcommand();
    const userId = interaction.user.id;
    const bags = loadBags();
    const userBag = getOrCreateBag(bags, userId);

    if (sub === 'view') {
      return interaction.reply({ embeds: [buildBagEmbed(userBag)] });
    }
    if (sub === 'rename') {
      const newName = interaction.options.getString('name');
      userBag.bagName = newName;
      saveBags(bags);
      return interaction.reply({ content: `✅ Bag renamed to **${newName}**!`, ephemeral: true });
    }
    if (sub === 'add') {
      const category = interaction.options.getString('category').trim();
      const item = interaction.options.getString('item').trim();
      if (!userBag.categories[category]) userBag.categories[category] = [];
      userBag.categories[category].push(item);
      saveBags(bags);
      return interaction.reply({ content: `✅ Added **${item}** to **${category}**!`, ephemeral: true });
    }
    if (sub === 'remove') {
      const category = interaction.options.getString('category').trim();
      const item = interaction.options.getString('item').trim();
      if (!userBag.categories[category])
        return interaction.reply({ content: `❌ Category **"${category}"** doesn't exist in your bag.`, ephemeral: true });
      const index = userBag.categories[category].findIndex(i => i.toLowerCase() === item.toLowerCase());
      if (index === -1)
        return interaction.reply({ content: `❌ **${item}** not found in **${category}**.`, ephemeral: true });
      userBag.categories[category].splice(index, 1);
      if (userBag.categories[category].length === 0) delete userBag.categories[category];
      saveBags(bags);
      return interaction.reply({ content: `✅ Removed **${item}** from **${category}**!`, ephemeral: true });
    }
    if (sub === 'removecategory') {
      const category = interaction.options.getString('category').trim();
      if (!userBag.categories[category])
        return interaction.reply({ content: `❌ Category **"${category}"** doesn't exist.`, ephemeral: true });
      delete userBag.categories[category];
      saveBags(bags);
      return interaction.reply({ content: `🗑️ Removed category **${category}** from your bag.`, ephemeral: true });
    }
    if (sub === 'clear') {
      userBag.categories = {};
      saveBags(bags);
      return interaction.reply({ content: `🗑️ Your bag has been cleared!`, ephemeral: true });
    }
  }

  // ─── /gold ───────────────────────────────────────────────────────
  else if (commandName === 'gold') {
    const subcommand = interaction.options.getSubcommand();
    const characters = loadCharacters();
    const { error, charKey, char: charEntry } = resolveChar(interaction.user.id, interaction.options.getString('character'), characters);
    if (error) return interaction.reply({ content: error, ephemeral: true });
    const char = charEntry.data;
    if (!charEntry.wallet) charEntry.wallet = { pp: 0, gp: 0, sp: 0, cp: 0 };
    const wallet = charEntry.wallet;

    if (subcommand === 'view') {
      return interaction.reply({ embeds: [buildWalletEmbed(char, charEntry)] });
    }
    if (subcommand === 'add') {
      const pp = interaction.options.getInteger('pp') ?? 0;
      const gp = interaction.options.getInteger('gp') ?? 0;
      const sp = interaction.options.getInteger('sp') ?? 0;
      const cp = interaction.options.getInteger('cp') ?? 0;
      if (pp === 0 && gp === 0 && sp === 0 && cp === 0)
        return interaction.reply({ content: '❌ Specify at least one currency amount.', ephemeral: true });
      wallet.pp = (wallet.pp ?? 0) + pp;
      wallet.gp = (wallet.gp ?? 0) + gp;
      wallet.sp = (wallet.sp ?? 0) + sp;
      wallet.cp = (wallet.cp ?? 0) + cp;
      charEntry.wallet = wallet;
      characters[interaction.user.id][charKey] = charEntry;
      saveCharacters(characters);
      return interaction.reply({ embeds: [buildWalletEmbed(char, charEntry).setTitle(`💰 ${char.name}'s Wallet — Added ${formatWallet({ pp, gp, sp, cp })}`)] });
    }
    if (subcommand === 'spend') {
      const pp = interaction.options.getInteger('pp') ?? 0;
      const gp = interaction.options.getInteger('gp') ?? 0;
      const sp = interaction.options.getInteger('sp') ?? 0;
      const cp = interaction.options.getInteger('cp') ?? 0;
      if (pp === 0 && gp === 0 && sp === 0 && cp === 0)
        return interaction.reply({ content: '❌ Specify at least one currency amount.', ephemeral: true });
      const currentTotal = walletToCopper(wallet);
      const spendTotal = pp * 1000 + gp * 100 + sp * 10 + cp;
      if (spendTotal > currentTotal)
        return interaction.reply({ content: `❌ **${char.name}** can't afford that! They only have **${formatWallet(wallet)}**.`, ephemeral: true });
      charEntry.wallet = copperToWallet(currentTotal - spendTotal);
      characters[interaction.user.id][charKey] = charEntry;
      saveCharacters(characters);
      return interaction.reply({ embeds: [buildWalletEmbed(char, charEntry).setTitle(`💸 ${char.name}'s Wallet — Spent ${formatWallet({ pp, gp, sp, cp })}`)] });
    }
    if (subcommand === 'convert') {
      const from   = interaction.options.getString('from');
      const to     = interaction.options.getString('to');
      const amount = interaction.options.getInteger('amount');
      if (from === to) return interaction.reply({ content: `❌ Can't convert ${from} to ${from}!`, ephemeral: true });
      const fromValue = COPPER_VALUE[from];
      const toValue   = COPPER_VALUE[to];
      const totalCopperToConvert = amount * fromValue;
      if ((wallet[from] ?? 0) < amount)
        return interaction.reply({ content: `❌ **${char.name}** only has **${wallet[from] ?? 0} ${from}**.`, ephemeral: true });
      if (fromValue < toValue && totalCopperToConvert < toValue)
        return interaction.reply({ content: `❌ ${amount} ${from} isn't worth even 1 ${to}.`, ephemeral: true });
      const converted = Math.floor(totalCopperToConvert / toValue);
      const remainder = totalCopperToConvert % toValue;
      wallet[from] = (wallet[from] ?? 0) - amount;
      wallet[to]   = (wallet[to]   ?? 0) + converted;
      wallet.cp    = (wallet.cp    ?? 0) + remainder;
      charEntry.wallet = wallet;
      characters[interaction.user.id][charKey] = charEntry;
      saveCharacters(characters);
      const remainderNote = remainder > 0 ? ` (+${remainder} cp remainder)` : '';
      return interaction.reply({ embeds: [buildWalletEmbed(char, charEntry).setTitle(`🔄 ${char.name}'s Wallet — Converted`).setDescription(`Converted **${amount} ${from}** → **${converted} ${to}**${remainderNote}`)] });
    }
    if (subcommand === 'set') {
      charEntry.wallet = {
        pp: interaction.options.getInteger('pp') ?? wallet.pp ?? 0,
        gp: interaction.options.getInteger('gp') ?? wallet.gp ?? 0,
        sp: interaction.options.getInteger('sp') ?? wallet.sp ?? 0,
        cp: interaction.options.getInteger('cp') ?? wallet.cp ?? 0,
      };
      characters[interaction.user.id][charKey] = charEntry;
      saveCharacters(characters);
      return interaction.reply({ embeds: [buildWalletEmbed(char, charEntry).setTitle(`✏️ ${char.name}'s Wallet — Updated`)] });
    }
  }

});

client.login(process.env.TOKEN);