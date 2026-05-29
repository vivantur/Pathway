const fetch = require('node-fetch');
const { EmbedBuilder } = require('discord.js');

const characterState = require('../../state/characters');
const { fmt } = require('../../lib/format');
const { rollD20Plus, determineDegreeOfSuccess, calculateMap } = require('../../lib/dice');
const { rollCompoundExpression } = require('../../lib/spellDamage');
const { sumEffectModifiers } = require('../../rules/combatEffects');
const ca = require('../../rules/combatAutomation');
const {
  syncCompanionToSupabase,
  deleteCompanionFromSupabase,
} = require('../../lib/storage');
const {
  extractPdfText: extractCompanionPdfText,
  parseCompanionStatblockText,
  titleCaseFromFilename: titleCaseCompanionFilename,
} = require('../../parsers/companionPdfParser');
const { getEncounter, addCombatant } = require('../encounters');
const { updateSummary } = require('../init/summary');
const { findMonster } = require('../monster/lookup');
const { buildRollEmbed, formatRollBreakdown } = require('../../discord/rollEmbeds');
const {
  findCompanion,
  buildCompanionEmbed,
  buildCompanionListEmbed,
  importedCompanionToTrackedCompanion,
  scaleCompanion,
  buildCompanionSheetEmbed,
} = require('./helpers');

function loadCharacters() {
  return characterState.getAll();
}

async function saveCharacters(data) {
  await characterState.saveAll(data);
}

const { resolveChar } = characterState;

async function execute(interaction) {
  const sub = interaction.options.getSubcommand();

  if (sub === 'info') {
    const input = interaction.options.getString('name');
    const { companion, matches } = findCompanion(input);
    if (!companion && matches.length > 1) {
      const preview = matches.sort().slice(0, 15).join(', ');
      return interaction.reply({ content: `🔍 Multiple companions match **"${input}"**. Did you mean:\n**${preview}**`, ephemeral: true });
    }
    if (!companion) return interaction.reply({ content: `❌ No companion found for **"${input}"**. Use \`/companion list\`.`, ephemeral: true });
    return interaction.reply({ embeds: [buildCompanionEmbed(companion)] });
  }

  if (sub === 'list') {
    const category = interaction.options.getString('category');
    return interaction.reply({ embeds: [buildCompanionListEmbed(category)] });
  }

  // Tracking subcommands require a character
  const characters = loadCharacters();
  const charNameArg = interaction.options.getString('character');
  const { error, charKey, char: charEntry } = resolveChar(interaction.user.id, charNameArg, characters);
  if (error) {
    return interaction.reply({ content: error, ephemeral: true });
  }
  const char = charEntry.data;
  if (!charEntry.companions) charEntry.companions = {};

  const getOptionString = optionName => {
    try { return interaction.options.getString(optionName); }
    catch { return null; }
  };
  const companionSlug = value => String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const companionNameArg = () => getOptionString('companion') ?? getOptionString('name');

  if (sub === 'add') {
    const displayName = interaction.options.getString('name');
    const baseInput = interaction.options.getString('base');
    const form = interaction.options.getString('form') ?? 'young';
    const custom = interaction.options.getBoolean('custom') ?? false;
    if (!displayName || !baseInput) {
      return interaction.reply({ content: '❌ Companion add needs both a display name and a base companion type.', ephemeral: true });
    }
    const compKey = companionSlug(displayName);
    if (charEntry.companions[compKey]) return interaction.reply({ content: `❌ **${char.name}** already has a companion named **${displayName}**.`, ephemeral: true });
    let baseType, customStats = null;
    if (custom) {
      const { monster } = findMonster(baseInput);
      if (monster) {
        customStats = {
          fromBestiary: monster.name,
          size: monster.size ?? 'Medium',
          speed: monster.speed ?? '25 feet',
          hp: monster.hp ?? 20,
          ac: monster.ac ?? 15,
          attacks: (monster.attacks ?? []).slice(0, 3),
          abilities: { str: monster.str ?? 0, dex: monster.dex ?? 0, con: monster.con ?? 0, int: monster.int ?? -4, wis: monster.wis ?? 0, cha: monster.cha ?? 0 },
        };
        baseType = 'custom';
      } else {
        return interaction.reply({ content: `❌ Custom companion base "${baseInput}" not found in bestiary.`, ephemeral: true });
      }
    } else {
      const { companion } = findCompanion(baseInput);
      if (!companion) return interaction.reply({ content: `❌ Companion type "${baseInput}" not found. Use \`/companion list\` or set custom:true for homebrew.`, ephemeral: true });
      baseType = companion.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    }
    charEntry.companions[compKey] = { displayName, baseType, form, notes: '', customStats, currentHp: null };
    if (!charEntry.activeCompanion) charEntry.activeCompanion = compKey;
    characters[interaction.user.id][charKey] = charEntry;
    await saveCharacters(characters);
    await syncCompanionToSupabase(interaction.user.id, charKey, compKey, charEntry.companions[compKey], charEntry.activeCompanion === compKey);
    return interaction.reply({ content: `🐾 **${displayName}** (${custom ? 'custom: ' + baseInput : baseInput}, ${form}) added to **${char.name}**'s companions!${charEntry.activeCompanion === compKey ? ' *(active)*' : ''}\nUse \`/companion sheet\` to view.` });
  }

  if (sub === 'import') {
    const file = interaction.options.getAttachment('file');
    const displayName = interaction.options.getString('name') || titleCaseCompanionFilename(file?.name ?? '');
    const form = interaction.options.getString('form');

    if (!file) {
      return interaction.reply({ content: 'Please attach a companion statblock PDF.', ephemeral: true });
    }
    const isPdf = /\.pdf$/i.test(file.name ?? '') || /pdf/i.test(file.contentType ?? '');
    if (!isPdf) {
      return interaction.reply({ content: 'Please upload a PDF file from the companion statblock export.', ephemeral: true });
    }
    if ((file.size ?? 0) > 8 * 1024 * 1024) {
      return interaction.reply({ content: 'That PDF is too large for import. Please upload a file under 8 MB.', ephemeral: true });
    }

    const compKey = companionSlug(displayName);
    if (!compKey) {
      return interaction.reply({ content: 'Please give the imported companion a usable name.', ephemeral: true });
    }
    if (charEntry.companions[compKey]) {
      return interaction.reply({ content: `**${char.name}** already has a companion named **${displayName}**. Remove it first or import with a different name.`, ephemeral: true });
    }

    await interaction.deferReply();
    try {
      const response = await fetch(file.url);
      if (!response.ok) throw new Error(`Discord attachment download failed with ${response.status}`);
      const buffer = await response.buffer();
      const rawText = await extractCompanionPdfText(buffer);
      const parsed = parseCompanionStatblockText(rawText, { fallbackName: displayName });
      if (!parsed.ok) {
        return interaction.editReply(`Could not parse that companion PDF. ${parsed.error ?? 'Try a Pathbuilder-style statblock PDF.'}`);
      }

      const companion = importedCompanionToTrackedCompanion(parsed.companion, { displayName, form });
      charEntry.companions[compKey] = companion;
      if (!charEntry.activeCompanion) charEntry.activeCompanion = compKey;
      characters[interaction.user.id][charKey] = charEntry;
      await saveCharacters(characters);
      await syncCompanionToSupabase(interaction.user.id, charKey, compKey, companion, charEntry.activeCompanion === compKey);

      const scaled = scaleCompanion(companion, char);
      const warningText = parsed.warnings?.length ? `\n\nImport notes: ${parsed.warnings.join(' ')}` : '';
      return interaction.editReply({
        content: `Imported **${companion.displayName}** from **${parsed.companion.sourceName}** for **${char.name}**.${charEntry.activeCompanion === compKey ? ' It is now active.' : ''}${warningText}`,
        embeds: [buildCompanionSheetEmbed(companion, scaled, char, charEntry, charEntry.activeCompanion === compKey)],
      });
    } catch (err) {
      console.error('/companion import error:', err);
      return interaction.editReply('Something went wrong importing that companion PDF. Check the deploy logs for the exact error.');
    }
  }

  if (sub === 'mine') {
    const mine = Object.entries(charEntry.companions);
    if (mine.length === 0) return interaction.reply({ content: `**${char.name}** has no companions. Add one with \`/companion add\`.`, ephemeral: true });
    const activeKey = charEntry.activeCompanion;
    const lines = mine.map(([k, c]) => {
      const active = k === activeKey ? ' ⭐ *(active)*' : '';
      const customTag = c.baseType === 'custom' && c.customStats?.fromBestiary ? ` *(custom: ${c.customStats.fromBestiary})*` : '';
      return `• **${c.displayName}** — ${c.form}${customTag}${active}`;
    });
    const embed = new EmbedBuilder().setColor(0x2ecc71).setTitle(`🐾 ${char.name}'s Companions`).setDescription(lines.join('\n'));
    if (charEntry.art) embed.setThumbnail(charEntry.art);
    return interaction.reply({ embeds: [embed] });
  }

  if (sub === 'sheet') {
    const compNameArg = companionNameArg();
    const compKey = compNameArg ? companionSlug(compNameArg) : charEntry.activeCompanion;
    if (!compKey || !charEntry.companions[compKey]) return interaction.reply({ content: `❌ ${compNameArg ? 'No companion named "' + compNameArg + '"' : char.name + ' has no active companion'}.`, ephemeral: true });
    const comp = charEntry.companions[compKey];
    const scaled = scaleCompanion(comp, char);
    if (comp.currentHp === null || comp.currentHp === undefined) {
      comp.currentHp = scaled.maxHp;
      characters[interaction.user.id][charKey] = charEntry;
      await saveCharacters(characters);
      await syncCompanionToSupabase(interaction.user.id, charKey, compKey, comp, compKey === charEntry.activeCompanion);
    }
    return interaction.reply({ embeds: [buildCompanionSheetEmbed(comp, scaled, char, charEntry, compKey === charEntry.activeCompanion)] });
  }

  // ── /companion active — set which companion is currently active ───
  // The slash command schema in deploy.js uses `name`, but earlier code
  // used `companion`. We accept both so users hitting either don't crash.
  if (sub === 'active' || sub === 'swap') {
    const compNameArg = companionNameArg();
    if (!compNameArg) {
      return interaction.reply({ content: `❌ Please specify a companion. Use \`/companion mine\` to see your options.`, ephemeral: true });
    }
    const compKey = companionSlug(compNameArg);
    if (!charEntry.companions[compKey]) return interaction.reply({ content: `❌ No companion named "${compNameArg}".`, ephemeral: true });
    const prevActiveKey = charEntry.activeCompanion;
    charEntry.activeCompanion = compKey;
    characters[interaction.user.id][charKey] = charEntry;
    await saveCharacters(characters);
    if (prevActiveKey && prevActiveKey !== compKey && charEntry.companions[prevActiveKey]) {
      await syncCompanionToSupabase(interaction.user.id, charKey, prevActiveKey, charEntry.companions[prevActiveKey], false);
    }
    await syncCompanionToSupabase(interaction.user.id, charKey, compKey, charEntry.companions[compKey], true);
    return interaction.reply({ content: `⭐ **${charEntry.companions[compKey].displayName}** is now **${char.name}**'s active companion.` });
  }

  // ── /companion use — add the active companion to the current encounter ──
  // Convenience shortcut so users don't have to remember `/init add companion:`.
  // Uses the active companion (since `/companion use` takes no companion arg).
  // Companions roll initiative on Perception per PF2e standard.
  if (sub === 'use') {
    const channelId = interaction.channel.id;
    const enc = getEncounter(channelId);
    if (!enc) {
      return interaction.reply({ content: `❌ No encounter active in this channel. Start one with \`/init start\` first.`, ephemeral: true });
    }
    if (!charEntry.activeCompanion || !charEntry.companions[charEntry.activeCompanion]) {
      return interaction.reply({ content: `❌ **${char.name}** has no active companion. Set one with \`/companion active <name>\`, or add one with \`/companion add\`.`, ephemeral: true });
    }
    const comp = charEntry.companions[charEntry.activeCompanion];
    if (enc.combatants.some(x => x.name.toLowerCase() === comp.displayName.toLowerCase())) {
      return interaction.reply({ content: `❌ **${comp.displayName}** is already in the encounter.`, ephemeral: true });
    }
    const scaled = scaleCompanion(comp, char);
    const initMod = scaled.perception ?? 0;
    const r = rollD20Plus(initMod);
    addCombatant(channelId, {
      name: comp.displayName,
      initiative: r.total,
      hp: comp.currentHp ?? scaled.maxHp,
      maxHp: scaled.maxHp,
      ac: scaled.ac,
      ownerId: interaction.user.id,
      isNpc: false,
      companionOf: char.name,
      effects: [],
    });
    await interaction.reply(`🐾 **${comp.displayName}** (${char.name}'s ${comp.form} companion) joins initiative at **${r.total}** (rolled ${r.roll} ${fmt(r.mod)}). HP ${comp.currentHp ?? scaled.maxHp}/${scaled.maxHp} · AC ${scaled.ac}`);
    await updateSummary(interaction.channel, enc);
    return;
  }

  if (sub === 'form') {
    const compNameArg = interaction.options.getString('companion');
    const newForm = interaction.options.getString('form');
    const compKey = compNameArg ? compNameArg.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') : charEntry.activeCompanion;
    if (!compKey || !charEntry.companions[compKey]) return interaction.reply({ content: `❌ Companion not found.`, ephemeral: true });
    const oldForm = charEntry.companions[compKey].form;
    charEntry.companions[compKey].form = newForm;
    const scaled = scaleCompanion(charEntry.companions[compKey], char);
    if (charEntry.companions[compKey].currentHp && charEntry.companions[compKey].currentHp > scaled.maxHp) {
      charEntry.companions[compKey].currentHp = scaled.maxHp;
    }
    characters[interaction.user.id][charKey] = charEntry;
    await saveCharacters(characters);
    await syncCompanionToSupabase(interaction.user.id, charKey, compKey, charEntry.companions[compKey], charEntry.activeCompanion === compKey);
    return interaction.reply({ content: `🔄 **${charEntry.companions[compKey].displayName}**: **${oldForm}** → **${newForm}**.\nNew max HP: **${scaled.maxHp}** · Attack: **+${scaled.attackBonus}** · AC: **${scaled.ac}**` });
  }

  if (sub === 'hp') {
    const compNameArg = interaction.options.getString('companion');
    const compKey = compNameArg ? compNameArg.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') : charEntry.activeCompanion;
    if (!compKey || !charEntry.companions[compKey]) return interaction.reply({ content: `❌ Companion not found.`, ephemeral: true });
    const comp = charEntry.companions[compKey];
    const scaled = scaleCompanion(comp, char);
    const change = interaction.options.getInteger('change');
    const setValue = interaction.options.getInteger('set');
    if (setValue !== null && setValue !== undefined) comp.currentHp = Math.max(0, Math.min(scaled.maxHp, setValue));
    else if (change !== null && change !== undefined) comp.currentHp = Math.max(0, Math.min(scaled.maxHp, (comp.currentHp ?? scaled.maxHp) + change));
    else comp.currentHp = scaled.maxHp;
    characters[interaction.user.id][charKey] = charEntry;
    await saveCharacters(characters);
    await syncCompanionToSupabase(interaction.user.id, charKey, compKey, comp, charEntry.activeCompanion === compKey);
    return interaction.reply({ content: `❤️ **${comp.displayName}**: ${comp.currentHp}/${scaled.maxHp} HP.` });
  }

  if (sub === 'remove') {
    const compNameArg = companionNameArg();
    if (!compNameArg) {
      return interaction.reply({ content: `❌ Please specify a companion to remove. Use \`/companion mine\` to see your options.`, ephemeral: true });
    }
    const compKey = companionSlug(compNameArg);
    if (!charEntry.companions[compKey]) return interaction.reply({ content: `❌ No companion named "${compNameArg}".`, ephemeral: true });
    const name = charEntry.companions[compKey].displayName;
    delete charEntry.companions[compKey];
    if (charEntry.activeCompanion === compKey) {
      const remaining = Object.keys(charEntry.companions);
      charEntry.activeCompanion = remaining[0] ?? null;
    }
    characters[interaction.user.id][charKey] = charEntry;
    await saveCharacters(characters);
    await deleteCompanionFromSupabase(interaction.user.id, charKey, compKey);
    return interaction.reply({ content: `🗑️ Removed **${name}** from **${char.name}**'s companions.` });
  }

  // ── /companion art — set portrait URL ──────────────────────────────
  if (sub === 'art') {
    const compNameArg = interaction.options.getString('companion');
    const url = interaction.options.getString('url');
    const compKey = compNameArg ? compNameArg.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') : charEntry.activeCompanion;
    if (!compKey || !charEntry.companions[compKey]) {
      return interaction.reply({ content: `❌ Companion not found. Use \`/companion mine\` to see your companions.`, ephemeral: true });
    }
    // Empty / "clear" / "none" wipes the art
    if (!url || /^(clear|none|remove|off)$/i.test(url.trim())) {
      delete charEntry.companions[compKey].art;
      characters[interaction.user.id][charKey] = charEntry;
      saveCharacters(characters);
      await syncCompanionToSupabase(interaction.user.id, charKey, compKey, charEntry.companions[compKey], charEntry.activeCompanion === compKey);
      return interaction.reply({ content: `🗑️ Cleared portrait for **${charEntry.companions[compKey].displayName}**.`, ephemeral: true });
    }
    // Basic URL validation — must start with http(s) and point at a plausible image host
    if (!/^https?:\/\/\S+\.\S+/.test(url)) {
      return interaction.reply({ content: `❌ That doesn't look like a valid URL. Use a direct image link (e.g. https://i.imgur.com/abc.png).`, ephemeral: true });
    }
    charEntry.companions[compKey].art = url.trim();
    characters[interaction.user.id][charKey] = charEntry;
    saveCharacters(characters);
    await syncCompanionToSupabase(interaction.user.id, charKey, compKey, charEntry.companions[compKey], charEntry.activeCompanion === compKey);
    return interaction.reply({ content: `🖼️ Updated portrait for **${charEntry.companions[compKey].displayName}**.\nView it with \`/companion sheet\`.`, ephemeral: true });
  }

  // ── /companion roll — make the companion roll something ────────────
  // Unified rolling subcommand: attack, skill check, save, or perception.
  // Rolls use the companion's scaled stats (which include any /companion set
  // overrides). For attacks, accepts a target combatant for auto-resolution
  // of degree of success and damage on hit.
  if (sub === 'roll') {
    const action = interaction.options.getString('action');
    const compNameArg = interaction.options.getString('companion');
    const compKey = compNameArg ? compNameArg.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') : charEntry.activeCompanion;
    if (!compKey || !charEntry.companions[compKey]) {
      return interaction.reply({ content: `❌ ${compNameArg ? 'No companion named "' + compNameArg + '"' : char.name + ' has no active companion'}. Use \`/companion mine\` to see options.`, ephemeral: true });
    }
    const comp = charEntry.companions[compKey];
    const scaled = scaleCompanion(comp, char);
    const extraBonus = interaction.options.getInteger('bonus') ?? 0;
    const dc = interaction.options.getInteger('dc'); // null if unset
    const thumbnail = comp.art ?? charEntry.art ?? null;
    const charName = `${comp.displayName} · ${char.name}'s ${comp.form} companion`;

    // Helper for skill/save/perception — single d20 roll with optional DC
    function rollAndReply(title, modifier, label) {
      const r = rollD20Plus(modifier + extraBonus);
      let breakdown = formatRollBreakdown(r.roll, modifier, extraBonus, r.total, 20);
      if (dc != null) {
        const degree = determineDegreeOfSuccess(r.total, r.roll, dc);
        const degreeNames = { 'crit-success': '⭐ Critical Success', 'success': '✅ Success', 'failure': '❌ Failure', 'crit-failure': '💀 Critical Failure' };
        breakdown += `\nvs DC ${dc}: **${degreeNames[degree] ?? degree}**`;
      }
      return interaction.reply({ embeds: [buildRollEmbed({
        title,
        breakdown,
        charName: `${charName}${label ? ' · ' + label : ''}`,
        thumbnail,
      })] });
    }

    // ── action: skill ────────────────────────────────────────────────
    if (action === 'skill') {
      const skillNameArg = interaction.options.getString('name');
      if (!skillNameArg) return interaction.reply({ content: `❌ Specify a skill name (e.g. Athletics). Set companion skills with \`/companion skill action:set\`.`, ephemeral: true });
      const skills = comp.skills ?? {};
      // Case-insensitive lookup
      const foundKey = Object.keys(skills).find(k => k.toLowerCase() === skillNameArg.toLowerCase());
      if (!foundKey) {
        const list = Object.keys(skills);
        const hint = list.length ? ` Known skills: ${list.join(', ')}.` : ` No skills set yet — use \`/companion skill action:set\` first.`;
        return interaction.reply({ content: `❌ **${comp.displayName}** has no **${skillNameArg}** skill bonus set.${hint}`, ephemeral: true });
      }
      const modifier = skills[foundKey];
      return rollAndReply(`🎯 ${comp.displayName} attempts ${foundKey}!`, modifier, `${foundKey} ${fmt(modifier)}`);
    }

    // ── action: save ─────────────────────────────────────────────────
    if (action === 'save') {
      const saveType = interaction.options.getString('save_type');
      if (!saveType) return interaction.reply({ content: `❌ Specify which save (\`save_type:\` — fortitude, reflex, or will).`, ephemeral: true });
      const saveKeyMap = { fortitude: 'fort', reflex: 'ref', will: 'will' };
      const key = saveKeyMap[saveType];
      if (!key) return interaction.reply({ content: `❌ Unknown save type \`${saveType}\`.`, ephemeral: true });
      const modifier = scaled.saves[key] ?? 0;
      const labelMap = { fortitude: 'Fortitude', reflex: 'Reflex', will: 'Will' };
      return rollAndReply(`🛡️ ${comp.displayName} makes a ${labelMap[saveType]} save!`, modifier, `${labelMap[saveType]} ${fmt(modifier)}`);
    }

    // ── action: perception ───────────────────────────────────────────
    if (action === 'perception') {
      const modifier = scaled.perception ?? 0;
      return rollAndReply(`👁️ ${comp.displayName} rolls Perception!`, modifier, `Perception ${fmt(modifier)}`);
    }

    // ── action: attack ───────────────────────────────────────────────
    if (action === 'attack') {
      // Resolve which attack to use. Default: primary attack. Otherwise look
      // up by name across primary + customAttacks.
      const attackNameArg = interaction.options.getString('name');
      const customs = Array.isArray(comp.customAttacks) ? comp.customAttacks : [];

      // Build a unified attack list: primary first, then customs
      const allAttacks = [];
      if (scaled.primaryAttack) {
        allAttacks.push({
          name: scaled.primaryAttack.name,
          bonus: scaled.attackBonus,
          damage: `${scaled.damageDice}${scaled.damageBonus !== 0 ? (scaled.damageBonus > 0 ? '+' : '') + scaled.damageBonus : ''}`,
          damageType: scaled.damageType ?? '',
          traits: scaled.primaryAttack.traits ?? [],
          isPrimary: true,
        });
      }
      for (const a of customs) {
        allAttacks.push({
          name: a.name,
          bonus: a.bonus,
          damage: a.damage,
          damageType: a.damageType ?? '',
          traits: a.traits ?? [],
          isPrimary: false,
        });
      }

      if (allAttacks.length === 0) {
        return interaction.reply({ content: `❌ **${comp.displayName}** has no attacks. Add one with \`/companion attack action:add\`.`, ephemeral: true });
      }

      let attack;
      if (attackNameArg) {
        attack = allAttacks.find(a => a.name.toLowerCase() === attackNameArg.toLowerCase());
        if (!attack) {
          const list = allAttacks.map(a => a.name).join(', ');
          return interaction.reply({ content: `❌ No attack named **${attackNameArg}** on **${comp.displayName}**. Available: ${list}.`, ephemeral: true });
        }
      } else {
        attack = allAttacks[0]; // default to primary
      }

      if (attack.bonus == null) {
        return interaction.reply({ content: `❌ **${attack.name}** has no attack bonus configured. Set one with \`/companion set stat:attack\` or \`/companion attack action:add\`.`, ephemeral: true });
      }

      // MAP handling — match /attack's pattern. If user provides map: explicitly,
      // use that. Otherwise, look at the encounter's attack history for this
      // companion if they're a combatant, else default to MAP 0.
      const explicitMap = interaction.options.getInteger('map');
      // Auto-detect agile from the attack's traits unless overridden
      const userAgile = interaction.options.getBoolean('agile');
      const traitAgile = (attack.traits ?? []).map(t => String(t).toLowerCase()).includes('agile');
      const agile = userAgile != null ? userAgile : traitAgile;

      const channelId = interaction.channel.id;
      const enc = getEncounter(channelId);
      const compCombatant = enc?.combatants.find(c => c.name.toLowerCase() === comp.displayName.toLowerCase());

      let mapPenalty, mapNoteText;
      if (explicitMap != null) {
        mapPenalty = calculateMap(explicitMap, agile);
        mapNoteText = explicitMap > 0 ? `MAP ${mapPenalty} (manual)` : null;
      } else if (compCombatant) {
        // Companion is in initiative — use the encounter's attack tracker
        const mapInfo = ca.computeMapForNextAttack(compCombatant, agile);
        mapPenalty = mapInfo.penalty;
        mapNoteText = mapInfo.noteText;
      } else {
        mapPenalty = 0;
        mapNoteText = null;
      }

      // Resolve target if specified
      const targetName = interaction.options.getString('target');
      let target = null;
      if (targetName) {
        if (!enc) {
          return interaction.reply({ content: `❌ Can't target "${targetName}" — no encounter active in this channel.`, ephemeral: true });
        }
        target = enc.combatants.find(c => c.name.toLowerCase() === targetName.toLowerCase());
        if (!target) {
          return interaction.reply({ content: `❌ No combatant named "${targetName}" in this encounter.`, ephemeral: true });
        }
      }

      // Roll the attack
      const dieRoll = Math.floor(Math.random() * 20) + 1;
      const attackTotal = dieRoll + attack.bonus + mapPenalty + extraBonus;

      const targetMods = target ? sumEffectModifiers(target) : null;
      const baseTargetAc = target?.ac ?? null;
      const effectiveTargetAc = baseTargetAc !== null && targetMods ? baseTargetAc + targetMods.acBonus : baseTargetAc;
      const degree = effectiveTargetAc != null
        ? determineDegreeOfSuccess(attackTotal, dieRoll, effectiveTargetAc)
        : null;

      // Build attack line
      const mapText = mapPenalty !== 0 ? ` ${fmt(mapPenalty)}` : '';
      const bonusText = extraBonus !== 0 ? ` ${fmt(extraBonus)}` : '';
      let attackLine = `**Attack Roll** — ${attack.name}\n1d20 (${dieRoll}) ${fmt(attack.bonus)}${mapText}${bonusText} = **${attackTotal}**`;
      if (mapNoteText) attackLine += `\n*${mapNoteText}*`;
      if (dieRoll === 20) attackLine += '\n⭐ Natural 20!';
      if (dieRoll === 1)  attackLine += '\n💀 Natural 1!';

      // Degree of success line
      let degreeLine = '';
      if (degree) {
        const degreeNames = { 'crit-success': '⭐ Critical Hit', 'success': '✅ Hit', 'failure': '❌ Miss', 'crit-failure': '💀 Critical Miss' };
        const acDisplay = effectiveTargetAc !== baseTargetAc ? `${baseTargetAc}→${effectiveTargetAc}` : `${effectiveTargetAc}`;
        degreeLine = `\nvs **${target.name}** AC ${acDisplay}: **${degreeNames[degree] ?? degree}**`;
      }

      // Damage roll — only on hit/crit. Use rollCompoundExpression to support
      // expressions like "1d6+2" that have a flat modifier.
      let damageLine = '';
      if (degree === 'success' || degree === 'crit-success' || !target) {
        if (attack.damage) {
          const dmgResult = rollCompoundExpression(attack.damage);
          if (dmgResult) {
            const isCrit = degree === 'crit-success';
            const finalDamage = isCrit ? dmgResult.total * 2 : dmgResult.total;
            const typeText = attack.damageType ? ` ${attack.damageType}` : '';
            if (isCrit) {
              damageLine = `\n\n**Damage (CRIT × 2)**\n${dmgResult.display} = ${dmgResult.total} × 2 = **${finalDamage}${typeText}**`;
            } else if (target) {
              damageLine = `\n\n**Damage**\n${dmgResult.display} = **${finalDamage}${typeText}**`;
            } else {
              // No target — show damage but flag it as "if hit"
              damageLine = `\n\n**Damage** *(if hit)*\n${dmgResult.display} = **${finalDamage}${typeText}**`;
            }
          } else {
            damageLine = `\n\n**Damage** ${attack.damage}${attack.damageType ? ' ' + attack.damageType : ''} *(couldn't auto-roll)*`;
          }
        }
      }

      // Record the attack in the encounter's MAP tracker (so the next
      // attack auto-bumps to MAP 1, etc.) — but only if the companion
      // actually rolled in initiative.
      if (compCombatant && explicitMap == null) {
        ca.recordAttack(channelId, compCombatant.name);
      }

      const traitsLine = attack.traits?.length ? `\n*${attack.traits.join(', ')}*` : '';

      return interaction.reply({ embeds: [buildRollEmbed({
        title: `⚔️ ${comp.displayName} attacks!`,
        breakdown: `${attackLine}${degreeLine}${traitsLine}${damageLine}`,
        charName,
        thumbnail,
      })] });
    }

    return interaction.reply({ content: `❌ Unknown roll action \`${action}\`. Choose: attack, skill, save, perception.`, ephemeral: true });
  }

  // ── /companion set — override any stat field ───────────────────────
  // stat choice values:
  //   str, dex, con, int, wis, cha   → overrides.abilities[key]
  //   ac, hp, speed, size            → overrides[key]
  //   fort, ref, will                → overrides.saves[key]
  //   attack, damage_dice, damage_bonus → overrides[key]
  if (sub === 'set') {
    const compNameArg = interaction.options.getString('companion');
    const stat = interaction.options.getString('stat');
    const rawValue = interaction.options.getString('value');
    const compKey = compNameArg ? compNameArg.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') : charEntry.activeCompanion;
    if (!compKey || !charEntry.companions[compKey]) {
      return interaction.reply({ content: `❌ Companion not found. Use \`/companion mine\` to see your companions.`, ephemeral: true });
    }
    const comp = charEntry.companions[compKey];
    if (!comp.overrides) comp.overrides = { abilities: {}, saves: {} };
    if (!comp.overrides.abilities) comp.overrides.abilities = {};
    if (!comp.overrides.saves) comp.overrides.saves = {};

    // Classify the stat and validate the value.
    const abilityKeys = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
    const saveKeys = ['fort', 'ref', 'will'];
    const numericKeys = ['ac', 'hp', 'attack', 'damage_bonus'];
    const stringKeys = ['speed', 'size', 'damage_dice'];

    function parseIntStrict(s) {
      // Accept leading +/- and whitespace; reject anything non-numeric
      const cleaned = String(s).trim();
      if (!/^[+-]?\d+$/.test(cleaned)) return null;
      return parseInt(cleaned);
    }

    let displayLabel, displayValue;
    if (abilityKeys.includes(stat)) {
      const n = parseIntStrict(rawValue);
      if (n === null) return interaction.reply({ content: `❌ \`${stat}\` expects a number (ability modifier, e.g. 3 or -1).`, ephemeral: true });
      if (n < -5 || n > 10) return interaction.reply({ content: `❌ Ability modifier ${n} is out of range (-5 to +10).`, ephemeral: true });
      comp.overrides.abilities[stat] = n;
      displayLabel = stat.toUpperCase();
      displayValue = fmt(n);
    }
    else if (saveKeys.includes(stat)) {
      const n = parseIntStrict(rawValue);
      if (n === null) return interaction.reply({ content: `❌ \`${stat}\` expects a number (total save bonus, e.g. 12).`, ephemeral: true });
      if (n < -5 || n > 50) return interaction.reply({ content: `❌ Save bonus ${n} is out of range (-5 to +50).`, ephemeral: true });
      comp.overrides.saves[stat] = n;
      displayLabel = stat.charAt(0).toUpperCase() + stat.slice(1);
      displayValue = fmt(n);
    }
    else if (stat === 'ac' || stat === 'hp' || stat === 'attack' || stat === 'damage_bonus' || stat === 'perception') {
      const n = parseIntStrict(rawValue);
      if (n === null) return interaction.reply({ content: `❌ \`${stat}\` expects a number.`, ephemeral: true });
      const bounds = { ac: [0, 80], hp: [0, 2000], attack: [-5, 60], damage_bonus: [-5, 40], perception: [-5, 50] };
      const [lo, hi] = bounds[stat];
      if (n < lo || n > hi) return interaction.reply({ content: `❌ ${stat} ${n} is out of range (${lo} to ${hi}).`, ephemeral: true });
      const keyMap = { ac: 'ac', hp: 'hp', attack: 'attackBonus', damage_bonus: 'damageBonus', perception: 'perception' };
      comp.overrides[keyMap[stat]] = n;
      displayLabel = stat === 'damage_bonus' ? 'Damage bonus' : stat === 'perception' ? 'Perception' : stat.toUpperCase();
      displayValue = (stat === 'attack' || stat === 'damage_bonus' || stat === 'perception') ? fmt(n) : String(n);
    }
    else if (stat === 'damage_dice') {
      if (!/^\d+d\d+$/i.test(rawValue.trim())) {
        return interaction.reply({ content: `❌ \`damage_dice\` expects a dice expression like \`2d6\` or \`1d10\`.`, ephemeral: true });
      }
      comp.overrides.damageDice = rawValue.trim().toLowerCase();
      displayLabel = 'Damage dice';
      displayValue = comp.overrides.damageDice;
    }
    else if (stat === 'speed') {
      if (rawValue.length > 60) return interaction.reply({ content: `❌ Speed text is too long (60 chars max).`, ephemeral: true });
      comp.overrides.speed = rawValue.trim();
      displayLabel = 'Speed';
      displayValue = comp.overrides.speed;
    }
    else if (stat === 'size') {
      const normalized = rawValue.trim().charAt(0).toUpperCase() + rawValue.trim().slice(1).toLowerCase();
      if (!['Tiny', 'Small', 'Medium', 'Large', 'Huge', 'Gargantuan'].includes(normalized)) {
        return interaction.reply({ content: `❌ Size must be one of: Tiny, Small, Medium, Large, Huge, Gargantuan.`, ephemeral: true });
      }
      comp.overrides.size = normalized;
      displayLabel = 'Size';
      displayValue = normalized;
    }
    else {
      return interaction.reply({ content: `❌ Unknown stat \`${stat}\`.`, ephemeral: true });
    }

    characters[interaction.user.id][charKey] = charEntry;
    saveCharacters(characters);
    await syncCompanionToSupabase(interaction.user.id, charKey, compKey, comp, charEntry.activeCompanion === compKey);
    return interaction.reply({ content: `✏️ **${comp.displayName}** — ${displayLabel} set to **${displayValue}**.\nView with \`/companion sheet\`. Undo with \`/companion reset stat:${stat}\`.`, ephemeral: true });
  }

  // ── /companion reset — clear one override ──────────────────────────
  if (sub === 'reset') {
    const compNameArg = interaction.options.getString('companion');
    const stat = interaction.options.getString('stat');
    const compKey = compNameArg ? compNameArg.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') : charEntry.activeCompanion;
    if (!compKey || !charEntry.companions[compKey]) {
      return interaction.reply({ content: `❌ Companion not found.`, ephemeral: true });
    }
    const comp = charEntry.companions[compKey];
    if (!comp.overrides) {
      return interaction.reply({ content: `ℹ️ **${comp.displayName}** has no overrides to reset.`, ephemeral: true });
    }

    const abilityKeys = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
    const saveKeys = ['fort', 'ref', 'will'];
    const topKeyMap = { ac: 'ac', hp: 'hp', attack: 'attackBonus', damage_bonus: 'damageBonus', damage_dice: 'damageDice', speed: 'speed', size: 'size', perception: 'perception' };

    if (abilityKeys.includes(stat)) {
      if (comp.overrides.abilities) delete comp.overrides.abilities[stat];
    } else if (saveKeys.includes(stat)) {
      if (comp.overrides.saves) delete comp.overrides.saves[stat];
    } else if (topKeyMap[stat]) {
      delete comp.overrides[topKeyMap[stat]];
    } else {
      return interaction.reply({ content: `❌ Unknown stat \`${stat}\`.`, ephemeral: true });
    }

    characters[interaction.user.id][charKey] = charEntry;
    saveCharacters(characters);
    await syncCompanionToSupabase(interaction.user.id, charKey, compKey, comp, charEntry.activeCompanion === compKey);
    return interaction.reply({ content: `↺ Reset \`${stat}\` on **${comp.displayName}** to auto-calculated.`, ephemeral: true });
  }

  // ── /companion resetall — clear all overrides ──────────────────────
  if (sub === 'resetall') {
    const compNameArg = interaction.options.getString('companion');
    const compKey = compNameArg ? compNameArg.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') : charEntry.activeCompanion;
    if (!compKey || !charEntry.companions[compKey]) {
      return interaction.reply({ content: `❌ Companion not found.`, ephemeral: true });
    }
    const comp = charEntry.companions[compKey];
    comp.overrides = { abilities: {}, saves: {} };
    characters[interaction.user.id][charKey] = charEntry;
    saveCharacters(characters);
    await syncCompanionToSupabase(interaction.user.id, charKey, compKey, comp, charEntry.activeCompanion === compKey);
    return interaction.reply({ content: `↺ Cleared all stat overrides on **${comp.displayName}**. Using auto-calculated stats again.`, ephemeral: true });
  }

  // ── /companion attack — add/remove/list custom attacks ─────────────
  // Custom attacks are APPENDED to the base (catalog) attack; they don't
  // replace it. This lets a wyvern keep its base jaws while adding a
  // player-homebrewed breath weapon, for example.
  if (sub === 'attack') {
    const action = interaction.options.getString('action');
    const compNameArg = interaction.options.getString('companion');
    const compKey = compNameArg ? compNameArg.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') : charEntry.activeCompanion;
    if (!compKey || !charEntry.companions[compKey]) {
      return interaction.reply({ content: `❌ Companion not found.`, ephemeral: true });
    }
    const comp = charEntry.companions[compKey];
    if (!Array.isArray(comp.customAttacks)) comp.customAttacks = [];

    if (action === 'add') {
      const atkName = interaction.options.getString('name')?.trim();
      const bonus = interaction.options.getInteger('bonus');
      const damage = interaction.options.getString('damage')?.trim();
      const damageType = interaction.options.getString('type')?.trim() ?? '';
      const traitsText = interaction.options.getString('traits')?.trim() ?? '';
      if (!atkName) return interaction.reply({ content: `❌ Attack name is required.`, ephemeral: true });
      if (atkName.length > 40) return interaction.reply({ content: `❌ Attack name too long (40 chars max).`, ephemeral: true });
      if (damage && damage.length > 40) return interaction.reply({ content: `❌ Damage too long (40 chars max).`, ephemeral: true });
      if (comp.customAttacks.length >= 10) return interaction.reply({ content: `❌ Max 10 custom attacks per companion. Remove one first.`, ephemeral: true });
      if (comp.customAttacks.some(a => a.name.toLowerCase() === atkName.toLowerCase())) {
        return interaction.reply({ content: `❌ An attack named **${atkName}** already exists. Remove it first or use a different name.`, ephemeral: true });
      }
      const traits = traitsText ? traitsText.split(',').map(t => t.trim().toLowerCase()).filter(Boolean).slice(0, 8) : [];
      comp.customAttacks.push({
        name: atkName,
        bonus: bonus ?? null,
        damage: damage || null,
        damageType: damageType || null,
        traits,
      });
      characters[interaction.user.id][charKey] = charEntry;
      saveCharacters(characters);
      await syncCompanionToSupabase(interaction.user.id, charKey, compKey, comp, charEntry.activeCompanion === compKey);
      return interaction.reply({ content: `⚔️ Added **${atkName}** to **${comp.displayName}**'s attacks.`, ephemeral: true });
    }

    if (action === 'remove') {
      const atkName = interaction.options.getString('name')?.trim();
      if (!atkName) return interaction.reply({ content: `❌ Attack name is required.`, ephemeral: true });
      const idx = comp.customAttacks.findIndex(a => a.name.toLowerCase() === atkName.toLowerCase());
      if (idx < 0) return interaction.reply({ content: `❌ No custom attack named **${atkName}** on **${comp.displayName}**.`, ephemeral: true });
      const [removed] = comp.customAttacks.splice(idx, 1);
      characters[interaction.user.id][charKey] = charEntry;
      saveCharacters(characters);
      await syncCompanionToSupabase(interaction.user.id, charKey, compKey, comp, charEntry.activeCompanion === compKey);
      return interaction.reply({ content: `🗑️ Removed **${removed.name}** from **${comp.displayName}**'s attacks.`, ephemeral: true });
    }

    if (action === 'list') {
      if (comp.customAttacks.length === 0) return interaction.reply({ content: `${comp.displayName} has no custom attacks. Add one with \`/companion attack action:add name:... bonus:... damage:...\`.`, ephemeral: true });
      const lines = comp.customAttacks.map(a => {
        const traits = a.traits?.length ? ` *(${a.traits.join(', ')})*` : '';
        const bonusText = a.bonus != null ? `**${fmt(a.bonus)}** to hit · ` : '';
        const dmgText = a.damage ? `**${a.damage}** ${a.damageType ?? ''}` : '';
        return `• **${a.name}**${traits} — ${bonusText}${dmgText}`;
      });
      return interaction.reply({ content: `**${comp.displayName}'s custom attacks:**\n${lines.join('\n')}`, ephemeral: true });
    }

    return interaction.reply({ content: `❌ Unknown action.`, ephemeral: true });
  }

  // ── /companion ability — add/remove/list custom abilities ──────────
  // Abilities can be free-form text or structured with an action cost.
  if (sub === 'ability') {
    const action = interaction.options.getString('action');
    const compNameArg = interaction.options.getString('companion');
    const compKey = compNameArg ? compNameArg.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') : charEntry.activeCompanion;
    if (!compKey || !charEntry.companions[compKey]) {
      return interaction.reply({ content: `❌ Companion not found.`, ephemeral: true });
    }
    const comp = charEntry.companions[compKey];
    if (!Array.isArray(comp.customAbilities)) comp.customAbilities = [];

    if (action === 'add') {
      const abName = interaction.options.getString('name')?.trim();
      const description = interaction.options.getString('description')?.trim();
      const actionCost = interaction.options.getString('action_cost'); // optional
      if (!abName) return interaction.reply({ content: `❌ Ability name is required.`, ephemeral: true });
      if (!description) return interaction.reply({ content: `❌ Description is required.`, ephemeral: true });
      if (abName.length > 50) return interaction.reply({ content: `❌ Name too long (50 chars max).`, ephemeral: true });
      if (description.length > 500) return interaction.reply({ content: `❌ Description too long (500 chars max).`, ephemeral: true });
      if (comp.customAbilities.length >= 20) return interaction.reply({ content: `❌ Max 20 abilities per companion. Remove one first.`, ephemeral: true });
      if (comp.customAbilities.some(a => a.name.toLowerCase() === abName.toLowerCase())) {
        return interaction.reply({ content: `❌ An ability named **${abName}** already exists.`, ephemeral: true });
      }
      comp.customAbilities.push({
        name: abName,
        description,
        actionCost: actionCost || null,
      });
      characters[interaction.user.id][charKey] = charEntry;
      saveCharacters(characters);
      await syncCompanionToSupabase(interaction.user.id, charKey, compKey, comp, charEntry.activeCompanion === compKey);
      return interaction.reply({ content: `✨ Added **${abName}** to **${comp.displayName}**'s abilities.`, ephemeral: true });
    }

    if (action === 'remove') {
      const abName = interaction.options.getString('name')?.trim();
      if (!abName) return interaction.reply({ content: `❌ Ability name is required.`, ephemeral: true });
      const idx = comp.customAbilities.findIndex(a => a.name.toLowerCase() === abName.toLowerCase());
      if (idx < 0) return interaction.reply({ content: `❌ No ability named **${abName}** on **${comp.displayName}**.`, ephemeral: true });
      const [removed] = comp.customAbilities.splice(idx, 1);
      characters[interaction.user.id][charKey] = charEntry;
      saveCharacters(characters);
      await syncCompanionToSupabase(interaction.user.id, charKey, compKey, comp, charEntry.activeCompanion === compKey);
      return interaction.reply({ content: `🗑️ Removed **${removed.name}** from **${comp.displayName}**'s abilities.`, ephemeral: true });
    }

    if (action === 'list') {
      if (comp.customAbilities.length === 0) return interaction.reply({ content: `${comp.displayName} has no custom abilities. Add one with \`/companion ability action:add name:... description:...\`.`, ephemeral: true });
      const lines = comp.customAbilities.map(a => {
        if (a.actionCost) {
          const costIcon = { 'one-action': '◆', 'two-actions': '◆◆', 'three-actions': '◆◆◆', 'reaction': '⤾', 'free-action': '◇' }[a.actionCost] ?? a.actionCost;
          return `• **${a.name}** ${costIcon} — ${a.description}`;
        }
        return `• **${a.name}** — ${a.description}`;
      });
      return interaction.reply({ content: `**${comp.displayName}'s abilities:**\n${lines.join('\n')}`.slice(0, 1990), ephemeral: true });
    }

    return interaction.reply({ content: `❌ Unknown action.`, ephemeral: true });
  }

  // ── /companion skill — set/clear/list custom skills ────────────────
  // Skills are override-only: users pick any skill name and assign a number.
  // No auto-calc. This lets people add PF2e-standard skills (Athletics, etc.)
  // OR custom lores (Lore: Dragons, etc.) without restriction.
  if (sub === 'skill') {
    const action = interaction.options.getString('action');
    const compNameArg = interaction.options.getString('companion');
    const compKey = compNameArg ? compNameArg.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') : charEntry.activeCompanion;
    if (!compKey || !charEntry.companions[compKey]) {
      return interaction.reply({ content: `❌ Companion not found.`, ephemeral: true });
    }
    const comp = charEntry.companions[compKey];
    if (!comp.skills || typeof comp.skills !== 'object') comp.skills = {};

    if (action === 'set') {
      const skillName = interaction.options.getString('name')?.trim();
      const bonusRaw = interaction.options.getString('bonus')?.trim();
      if (!skillName) return interaction.reply({ content: `❌ Skill name is required.`, ephemeral: true });
      if (skillName.length > 40) return interaction.reply({ content: `❌ Skill name too long (40 chars max).`, ephemeral: true });
      if (!bonusRaw || !/^[+-]?\d+$/.test(bonusRaw)) return interaction.reply({ content: `❌ Bonus must be a number (e.g. 8 or -1).`, ephemeral: true });
      const bonus = parseInt(bonusRaw);
      if (bonus < -10 || bonus > 50) return interaction.reply({ content: `❌ Bonus ${bonus} is out of range (-10 to +50).`, ephemeral: true });
      if (Object.keys(comp.skills).length >= 20 && !(skillName in comp.skills)) {
        return interaction.reply({ content: `❌ Max 20 skills per companion. Remove one first.`, ephemeral: true });
      }
      // Title-case the skill name for nicer display
      const displayName = skillName.split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
      comp.skills[displayName] = bonus;
      characters[interaction.user.id][charKey] = charEntry;
      saveCharacters(characters);
      await syncCompanionToSupabase(interaction.user.id, charKey, compKey, comp, charEntry.activeCompanion === compKey);
      return interaction.reply({ content: `🎯 Set **${displayName}** to **${fmt(bonus)}** on **${comp.displayName}**.`, ephemeral: true });
    }

    if (action === 'clear') {
      const skillName = interaction.options.getString('name')?.trim();
      if (!skillName) return interaction.reply({ content: `❌ Skill name is required.`, ephemeral: true });
      // Match case-insensitively
      const foundKey = Object.keys(comp.skills).find(k => k.toLowerCase() === skillName.toLowerCase());
      if (!foundKey) return interaction.reply({ content: `❌ No skill named **${skillName}** on **${comp.displayName}**.`, ephemeral: true });
      delete comp.skills[foundKey];
      characters[interaction.user.id][charKey] = charEntry;
      saveCharacters(characters);
      await syncCompanionToSupabase(interaction.user.id, charKey, compKey, comp, charEntry.activeCompanion === compKey);
      return interaction.reply({ content: `🗑️ Cleared **${foundKey}** from **${comp.displayName}**.`, ephemeral: true });
    }

    if (action === 'list') {
      const entries = Object.entries(comp.skills);
      if (entries.length === 0) return interaction.reply({ content: `${comp.displayName} has no skills set. Add one with \`/companion skill action:set name:Athletics bonus:8\`.`, ephemeral: true });
      entries.sort(([a], [b]) => a.localeCompare(b));
      const lines = entries.map(([n, b]) => `• **${n}** ${fmt(b)}`);
      return interaction.reply({ content: `**${comp.displayName}'s skills:**\n${lines.join('\n')}`, ephemeral: true });
    }

    return interaction.reply({ content: `❌ Unknown action.`, ephemeral: true });
  }

  // ── /companion notes — set/clear free-form notes ───────────────────
  if (sub === 'notes') {
    const compNameArg = interaction.options.getString('companion');
    const compKey = compNameArg ? compNameArg.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') : charEntry.activeCompanion;
    if (!compKey || !charEntry.companions[compKey]) {
      return interaction.reply({ content: `❌ Companion not found.`, ephemeral: true });
    }
    const comp = charEntry.companions[compKey];
    const text = interaction.options.getString('text');
    if (!text || /^(clear|none|remove|off)$/i.test(text.trim())) {
      comp.notes = '';
      characters[interaction.user.id][charKey] = charEntry;
      saveCharacters(characters);
      await syncCompanionToSupabase(interaction.user.id, charKey, compKey, comp, charEntry.activeCompanion === compKey);
      return interaction.reply({ content: `🗑️ Cleared notes on **${comp.displayName}**.`, ephemeral: true });
    }
    if (text.length > 1000) return interaction.reply({ content: `❌ Notes too long (1000 chars max).`, ephemeral: true });
    comp.notes = text;
    characters[interaction.user.id][charKey] = charEntry;
    saveCharacters(characters);
    await syncCompanionToSupabase(interaction.user.id, charKey, compKey, comp, charEntry.activeCompanion === compKey);
    return interaction.reply({ content: `📝 Updated notes on **${comp.displayName}**.`, ephemeral: true });
  }
}

// ─── /monster ────────────────────────────────────────────────────

module.exports = {
  name: 'companion',
  execute,
};
