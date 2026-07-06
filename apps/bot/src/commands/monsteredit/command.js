const { EmbedBuilder } = require('discord.js');

const monsterState = require('../../state/monster');
const { findMonster } = require('../monster/lookup');
const { monsterKey, getMonsterEdit } = require('../monster/helpers');

function loadMonsterEdits() {
  return monsterState.getAllEdits();
}

async function saveMonsterEdits(data) {
  await monsterState.saveAllEdits(data);
}

function getGuildEdits(store, guildId) {
  if (!store[guildId]) store[guildId] = {};
  return store[guildId];
}

function ensureMonsterEdit(guildId, displayName, userId) {
  const store = loadMonsterEdits();
  const guild = getGuildEdits(store, guildId);
  const key = monsterKey(displayName);
  if (!guild[key]) {
    guild[key] = { displayName, setBy: userId, setAt: new Date().toISOString() };
  } else {
    guild[key].setAt = new Date().toISOString();
    guild[key].setBy = userId;
    guild[key].displayName = displayName;
  }
  return { store, guild, entry: guild[key] };
}

async function execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guildId;
    if (!guildId) return interaction.reply({ content: '❌ `/monsteredit` only works in a server, not in DMs.', ephemeral: true });

    // Resolve the canonical bestiary name where possible so "goblin warrior"
    // and "Goblin Warrior" always edit the same entry. Homebrew names that
    // don't match anything in the bestiary are accepted as-is.
    const resolveName = (input) => {
      const found = findMonster(input);
      return found.monster?.name ?? input;
    };

    // ── ability: add or replace a named ability ──
    if (sub === 'ability') {
      const monsterInput = interaction.options.getString('monster');
      const name = interaction.options.getString('name').trim();
      const description = interaction.options.getString('description');
      const actionCost = interaction.options.getString('action_cost');
      const trigger = interaction.options.getString('trigger');
      const traitsRaw = interaction.options.getString('traits');
      const slot = interaction.options.getString('slot') ?? 'mid';

      if (!['top', 'mid', 'bot'].includes(slot)) {
        return interaction.reply({ content: '❌ `slot` must be one of: top, mid, bot.', ephemeral: true });
      }

      const displayName = resolveName(monsterInput);
      const { store, entry } = ensureMonsterEdit(guildId, displayName, interaction.user.id);

      // If the user hasn't edited abilities yet, seed from the bestiary so
      // they keep Goblin Scuttle etc. and merely add Scoundrel's Feint.
      if (!entry.abilities) {
        const base = findMonster(monsterInput).monster?.rich?.abilities;
        entry.abilities = base
          ? { top: [...(base.top ?? [])], mid: [...(base.mid ?? [])], bot: [...(base.bot ?? [])] }
          : { top: [], mid: [], bot: [] };
      }

      const newAbility = { name };
      if (description) newAbility.description = description;
      if (actionCost)  newAbility.action_cost = actionCost;
      if (trigger)     newAbility.trigger = trigger;
      if (traitsRaw)   newAbility.traits = traitsRaw.split(',').map(t => t.trim()).filter(Boolean);

      const bucket = entry.abilities[slot] ?? (entry.abilities[slot] = []);
      // Replace any existing ability with the same name (case-insensitive)
      const existingIdx = bucket.findIndex(a => a.name?.toLowerCase() === name.toLowerCase());
      if (existingIdx >= 0) bucket[existingIdx] = newAbility;
      else bucket.push(newAbility);

      await saveMonsterEdits(store);
      const verb = existingIdx >= 0 ? 'Updated' : 'Added';
      return interaction.reply({ content: `✅ ${verb} ability **${name}** on **${displayName}** (slot: ${slot}).`, ephemeral: true });
    }

    // ── item: add one to the carried items list ──
    if (sub === 'item') {
      const monsterInput = interaction.options.getString('monster');
      const item = interaction.options.getString('item').trim();
      const displayName = resolveName(monsterInput);
      const { store, entry } = ensureMonsterEdit(guildId, displayName, interaction.user.id);
      if (!entry.items) {
        const base = findMonster(monsterInput).monster?.rich?.items;
        entry.items = Array.isArray(base) ? [...base] : [];
      }
      if (entry.items.some(i => String(i).toLowerCase() === item.toLowerCase())) {
        return interaction.reply({ content: `❌ **${displayName}** already has item **${item}**.`, ephemeral: true });
      }
      entry.items.push(item);
      await saveMonsterEdits(store);
      return interaction.reply({ content: `✅ Added item **${item}** to **${displayName}**.`, ephemeral: true });
    }

    // ── language: add one to the languages list ──
    if (sub === 'language') {
      const monsterInput = interaction.options.getString('monster');
      const lang = interaction.options.getString('language').trim();
      const displayName = resolveName(monsterInput);
      const { store, entry } = ensureMonsterEdit(guildId, displayName, interaction.user.id);
      if (!entry.languages) {
        const base = findMonster(monsterInput).monster?.rich?.languages;
        entry.languages = Array.isArray(base) ? [...base] : [];
      }
      if (entry.languages.some(l => String(l).toLowerCase() === lang.toLowerCase())) {
        return interaction.reply({ content: `❌ **${displayName}** already speaks **${lang}**.`, ephemeral: true });
      }
      entry.languages.push(lang);
      await saveMonsterEdits(store);
      return interaction.reply({ content: `✅ Added language **${lang}** to **${displayName}**.`, ephemeral: true });
    }

    // ── skill: set a skill modifier (for Recall Knowledge etc.) ──
    if (sub === 'skill') {
      const monsterInput = interaction.options.getString('monster');
      const skillName = interaction.options.getString('skill').trim();
      const modifier = interaction.options.getInteger('modifier');
      const displayName = resolveName(monsterInput);
      const { store, entry } = ensureMonsterEdit(guildId, displayName, interaction.user.id);
      if (!entry.skills) {
        const base = findMonster(monsterInput).monster?.rich?.skills;
        entry.skills = base && typeof base === 'object' ? { ...base } : {};
      }
      const normalized = skillName.charAt(0).toUpperCase() + skillName.slice(1).toLowerCase();
      entry.skills[normalized] = modifier;
      await saveMonsterEdits(store);
      return interaction.reply({ content: `✅ Set **${normalized}** ${modifier >= 0 ? '+' : ''}${modifier} on **${displayName}**.`, ephemeral: true });
    }

    // ── attack: add a strike to the attacks array (flavor-only; for
    // rollable saved attacks use /m attack add instead) ──
    if (sub === 'attack') {
      const monsterInput = interaction.options.getString('monster');
      const name = interaction.options.getString('name').trim();
      const toHit = interaction.options.getInteger('to_hit');
      const damage = interaction.options.getString('damage').trim();
      const type = interaction.options.getString('type') ?? 'melee';
      const traitsRaw = interaction.options.getString('traits');
      const displayName = resolveName(monsterInput);
      const { store, entry } = ensureMonsterEdit(guildId, displayName, interaction.user.id);
      if (!entry.attacks) {
        const base = findMonster(monsterInput).monster?.rich?.attacks;
        entry.attacks = Array.isArray(base) ? [...base] : [];
      }
      const newAtk = {
        type,
        name,
        to_hit: toHit,
        damage,
        traits: traitsRaw ? traitsRaw.split(',').map(t => t.trim()).filter(Boolean) : [],
      };
      const idx = entry.attacks.findIndex(a => a.name?.toLowerCase() === name.toLowerCase());
      if (idx >= 0) entry.attacks[idx] = newAtk;
      else entry.attacks.push(newAtk);
      await saveMonsterEdits(store);
      return interaction.reply({ content: `✅ ${idx >= 0 ? 'Updated' : 'Added'} attack **${name}** on **${displayName}**.`, ephemeral: true });
    }

    // ── ability-score: set str/dex/con/int/wis/cha modifier ──
    if (sub === 'ability-score') {
      const monsterInput = interaction.options.getString('monster');
      const which = interaction.options.getString('score');
      const value = interaction.options.getInteger('value');
      const valid = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
      if (!valid.includes(which)) {
        return interaction.reply({ content: `❌ \`score\` must be one of: ${valid.join(', ')}`, ephemeral: true });
      }
      const displayName = resolveName(monsterInput);
      const { store, entry } = ensureMonsterEdit(guildId, displayName, interaction.user.id);
      if (!entry.ability_modifiers) {
        const base = findMonster(monsterInput).monster?.rich?.ability_modifiers;
        entry.ability_modifiers = base && typeof base === 'object' ? { ...base } : {};
      }
      entry.ability_modifiers[which] = value;
      await saveMonsterEdits(store);
      return interaction.reply({ content: `✅ Set **${which.toUpperCase()}** ${value >= 0 ? '+' : ''}${value} on **${displayName}**.`, ephemeral: true });
    }

    // ── description: set the flavor text shown under the title ──
    if (sub === 'description') {
      const monsterInput = interaction.options.getString('monster');
      const description = interaction.options.getString('description').trim();
      const displayName = resolveName(monsterInput);
      const { store, entry } = ensureMonsterEdit(guildId, displayName, interaction.user.id);
      entry.description = description;
      await saveMonsterEdits(store);
      return interaction.reply({ content: `✅ Description set on **${displayName}**.`, ephemeral: true });
    }

    // ── paste: bulk JSON paste (for homebrew creatures) ──
    if (sub === 'paste') {
      const monsterInput = interaction.options.getString('monster');
      const jsonRaw = interaction.options.getString('json');
      let parsed;
      try {
        parsed = JSON.parse(jsonRaw);
      } catch (err) {
        return interaction.reply({ content: `❌ That's not valid JSON: ${err.message}`, ephemeral: true });
      }
      if (typeof parsed !== 'object' || Array.isArray(parsed) || parsed === null) {
        return interaction.reply({ content: '❌ The JSON must be an object with fields like `abilities`, `items`, `attacks`, etc.', ephemeral: true });
      }
      const allowed = ['abilities', 'items', 'languages', 'skills', 'attacks', 'ability_modifiers', 'spellcasting', 'description'];
      const applied = [];
      const displayName = resolveName(monsterInput);
      const { store, entry } = ensureMonsterEdit(guildId, displayName, interaction.user.id);
      for (const k of allowed) {
        if (parsed[k] !== undefined) {
          entry[k] = parsed[k];
          applied.push(k);
        }
      }
      if (applied.length === 0) {
        return interaction.reply({ content: `❌ JSON had none of the recognized fields: ${allowed.join(', ')}`, ephemeral: true });
      }
      await saveMonsterEdits(store);
      return interaction.reply({ content: `✅ Applied fields [${applied.join(', ')}] to **${displayName}**.`, ephemeral: true });
    }

    // ── view: dump the current edits for a monster, or list all ──
    if (sub === 'view') {
      const monsterInput = interaction.options.getString('monster');
      if (monsterInput) {
        const displayName = resolveName(monsterInput);
        const entry = getMonsterEdit(guildId, displayName);
        if (!entry) return interaction.reply({ content: `📭 No saved edits for **${displayName}** on this server.`, ephemeral: true });
        const { displayName: _d, setBy: _b, setAt: _a, ...fields } = entry;
        const body = '```json\n' + JSON.stringify(fields, null, 2).slice(0, 1800) + '\n```';
        const embed = new EmbedBuilder()
          .setColor(0xe67e22)
          .setTitle(`📝 Edits for ${entry.displayName}`)
          .setDescription(body)
          .setFooter({ text: `Set by user ${entry.setBy} • /monsteredit reset to clear` });
        return interaction.reply({ embeds: [embed], ephemeral: true });
      }
      const store = loadMonsterEdits();
      const guild = store[guildId] ?? {};
      const entries = Object.values(guild);
      if (entries.length === 0) return interaction.reply({ content: '📖 No monster edits saved for this server yet.', ephemeral: true });
      entries.sort((a, b) => a.displayName.localeCompare(b.displayName));
      const lines = entries.map(e => {
        const { displayName: _d, setBy: _b, setAt: _a, ...fields } = e;
        const keys = Object.keys(fields);
        return `• **${e.displayName}** — ${keys.length ? keys.join(', ') : '*empty*'}`;
      });
      const embed = new EmbedBuilder()
        .setColor(0xe67e22)
        .setTitle(`📝 Monster Edits (${entries.length})`)
        .setDescription(lines.join('\n').slice(0, 4000))
        .setFooter({ text: '/monsteredit view monster:<n> to see details' });
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    // ── remove: drop one entry from a list field ──
    if (sub === 'remove') {
      const monsterInput = interaction.options.getString('monster');
      const field = interaction.options.getString('field');
      const value = interaction.options.getString('value').trim();
      const displayName = resolveName(monsterInput);
      const entry = getMonsterEdit(guildId, displayName);
      if (!entry) return interaction.reply({ content: `❌ No edits to modify for **${displayName}**.`, ephemeral: true });

      const store = loadMonsterEdits();
      const liveEntry = store[guildId][monsterKey(displayName)];

      if (field === 'ability') {
        let removed = false;
        for (const slot of ['top', 'mid', 'bot']) {
          const list = liveEntry.abilities?.[slot];
          if (!list) continue;
          const idx = list.findIndex(a => a.name?.toLowerCase() === value.toLowerCase());
          if (idx >= 0) { list.splice(idx, 1); removed = true; break; }
        }
        if (!removed) return interaction.reply({ content: `❌ No ability named "${value}" on **${displayName}**.`, ephemeral: true });
      } else if (field === 'item') {
        const list = liveEntry.items;
        if (!list) return interaction.reply({ content: `❌ No items to remove.`, ephemeral: true });
        const idx = list.findIndex(i => String(i).toLowerCase() === value.toLowerCase());
        if (idx < 0) return interaction.reply({ content: `❌ **${displayName}** doesn't have item "${value}".`, ephemeral: true });
        list.splice(idx, 1);
      } else if (field === 'language') {
        const list = liveEntry.languages;
        if (!list) return interaction.reply({ content: `❌ No languages to remove.`, ephemeral: true });
        const idx = list.findIndex(l => String(l).toLowerCase() === value.toLowerCase());
        if (idx < 0) return interaction.reply({ content: `❌ **${displayName}** doesn't speak "${value}".`, ephemeral: true });
        list.splice(idx, 1);
      } else if (field === 'skill') {
        if (!liveEntry.skills) return interaction.reply({ content: `❌ No skills to remove.`, ephemeral: true });
        const matchKey = Object.keys(liveEntry.skills).find(k => k.toLowerCase() === value.toLowerCase());
        if (!matchKey) return interaction.reply({ content: `❌ **${displayName}** has no edit for skill "${value}".`, ephemeral: true });
        delete liveEntry.skills[matchKey];
      } else if (field === 'attack') {
        const list = liveEntry.attacks;
        if (!list) return interaction.reply({ content: `❌ No attacks to remove.`, ephemeral: true });
        const idx = list.findIndex(a => a.name?.toLowerCase() === value.toLowerCase());
        if (idx < 0) return interaction.reply({ content: `❌ **${displayName}** has no attack named "${value}".`, ephemeral: true });
        list.splice(idx, 1);
      } else {
        return interaction.reply({ content: `❌ \`field\` must be one of: ability, item, language, skill, attack.`, ephemeral: true });
      }
      await saveMonsterEdits(store);
      return interaction.reply({ content: `🗑️ Removed ${field} **${value}** from **${displayName}**.`, ephemeral: true });
    }

    // ── reset: wipe all edits for one monster ──
    if (sub === 'reset') {
      const monsterInput = interaction.options.getString('monster');
      const displayName = resolveName(monsterInput);
      const store = loadMonsterEdits();
      const guild = store[guildId];
      if (!guild || !guild[monsterKey(displayName)]) {
        return interaction.reply({ content: `📭 No saved edits for **${displayName}** on this server.`, ephemeral: true });
      }
      delete guild[monsterKey(displayName)];
      if (Object.keys(guild).length === 0) delete store[guildId];
      else store[guildId] = guild;
      await saveMonsterEdits(store);
      return interaction.reply({ content: `🗑️ Wiped all edits for **${displayName}**.`, ephemeral: true });
    }
}

module.exports = {
  name: 'monsteredit',
  execute,
};
