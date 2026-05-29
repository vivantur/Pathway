const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const characterState = require('../../state/characters');
const charOverlay = require('../../rules/characterOverlay');
const ca = require('../../rules/combatAutomation');
const combatV2State = require('../../rules/combatV2/state');
const combatV2Render = require('../../rules/combatV2/render');
const combatV2Rolls = require('../../rules/combatV2/rolls');
const { computeCharPerception } = require('../../rules/characterChecks');
const { getPreset, listPresets } = require('../../rules/effects');
const { fmt, calcProfNum } = require('../../lib/format');
const { rollD20Plus, rollDamageExpression, determineDegreeOfSuccess, calculateMap } = require('../../lib/dice');
const { combatDeathPayload, combatDyingSuffix } = require('../../discord/rollEmbeds');
const encounters = require('../encounters');
const { scaleCompanion } = require('../companion/helpers');
const { findMonster } = require('../monster/lookup');
const { buildMonsterEmbed } = require('../monster/embed');
const { getMonsterEdit, applyMonsterEdits, applyMonsterAttackLibrary } = require('../monster/helpers');
const { normalizeAttackForRolling } = require('../monsterattack/command');
const { updateSummary, clearSummary } = require('./legacySummary');
const { updateCombatV2Summary, clearCombatV2Summary } = require('./combatV2Summary');
const {
  combatV2Initiative,
  combatV2CharacterAttacks,
  combatV2CharacterSave,
  combatV2CharacterSkills,
  combatV2HasName,
  findCharacterEntryForCombatant,
} = require('./combatV2Actors');

const {
  getEncounter,
  createEncounter,
  deleteEncounter,
  addCombatant,
  removeCombatant,
  advanceTurn,
  modifyHp,
  setSummaryMessageId,
  findCombatant,
  addEffect,
  removeEffect,
  clearEffects,
  delayCombatant,
  rejoinFromDelay,
} = encounters;
const { computeCharMaxHp, resolveChar } = characterState;

function loadCharacters() {
  return characterState.getAll();
}

function firstNumber(...values) {
  for (const value of values) {
    if (value == null || value === '') continue;
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function combatV2NormalizeMonsterSaves(core = {}, summary = {}, rich = null) {
  const summaryObj = summary.summary ?? summary ?? {};
  const richSaves = rich?.saves ?? rich?.defenses?.saves ?? {};
  const coreSaves = core.saves ?? {};
  return {
    fort: firstNumber(
      richSaves.fort,
      richSaves.fortitude,
      richSaves.Fortitude,
      coreSaves.fort,
      coreSaves.fortitude,
      core.fort,
      core.fortitude,
      summaryObj.fort,
      summaryObj.fortitude,
      summaryObj.Fortitude,
    ),
    ref: firstNumber(
      richSaves.ref,
      richSaves.reflex,
      richSaves.Reflex,
      coreSaves.ref,
      coreSaves.reflex,
      core.ref,
      core.reflex,
      summaryObj.ref,
      summaryObj.reflex,
      summaryObj.Reflex,
    ),
    will: firstNumber(
      richSaves.will,
      richSaves.Will,
      coreSaves.will,
      core.will,
      summaryObj.will,
      summaryObj.Will,
    ),
  };
}

function combatV2ParseDefenseMap(input) {
  if (input == null) return null;
  const map = {};
  for (const part of String(input).split(',')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const match = trimmed.match(/^(.+?)\s+(-?\d+)$/);
    if (!match) continue;
    map[match[1].trim().toLowerCase()] = Number(match[2]);
  }
  return map;
}

function combatV2ParseList(input) {
  if (input == null) return null;
  return String(input).split(',').map(s => s.trim()).filter(Boolean);
}

function combatV2CompanionAttacks(comp, scaled) {
  const attacks = [];
  if (scaled.primaryAttack) {
    attacks.push({
      name: scaled.primaryAttack.name,
      bonus: scaled.attackBonus,
      damage: `${scaled.damageDice}${scaled.damageBonus !== 0 ? (scaled.damageBonus > 0 ? '+' : '') + scaled.damageBonus : ''}`,
      damageType: scaled.damageType ?? '',
      traits: scaled.primaryAttack.traits ?? [],
      source: 'companion',
    });
  }
  for (const a of (comp.customAttacks ?? [])) {
    attacks.push({
      name: a.name,
      bonus: a.bonus ?? 0,
      damage: a.damage ?? '1d4',
      damageType: a.damageType ?? '',
      traits: a.traits ?? [],
      source: 'companion-custom',
    });
  }
  return attacks;
}

function combatV2MonsterStats(monster, guildId) {
  const edits = guildId ? getMonsterEdit(guildId, monster.name) : null;
  const edited = applyMonsterEdits(monster, edits);
  const withLibrary = guildId ? applyMonsterAttackLibrary(edited, guildId) : edited;
  const core = withLibrary.core ?? {};
  const summary = withLibrary.summary ?? {};
  const rich = withLibrary.rich ?? null;
  const rawAttacks = Array.isArray(withLibrary?.rich?.attacks) ? withLibrary.rich.attacks : [];
  const spellcasting = Array.isArray(rich?.spellcasting) ? rich.spellcasting : [];
  const spells = [];
  for (const caster of spellcasting) {
    const byRank = caster.spells_by_level ?? {};
    for (const [rank, bucket] of Object.entries(byRank)) {
      for (const entry of (bucket?.spells ?? [])) {
        const name = entry?.name ?? String(entry ?? '');
        if (!name) continue;
        spells.push({
          name,
          rank: Number(rank),
          dc: caster.DC ?? caster.dc ?? null,
          attack: caster.attack_bonus ?? caster.attack ?? null,
          tradition: caster.tradition ?? null,
          type: caster.type ?? null,
          source: 'bestiary',
        });
      }
    }
  }
  const resistanceMap = {};
  for (const r of rich?.defenses?.resistances ?? []) {
    if (typeof r === 'string') {
      const match = r.match(/^(.+?)\s+(\d+)$/);
      if (match) resistanceMap[match[1].trim().toLowerCase()] = Number(match[2]);
    } else if (r?.type && r?.value != null) {
      resistanceMap[String(r.type).toLowerCase()] = Number(r.value);
    }
  }
  const weaknessMap = {};
  for (const w of rich?.defenses?.weaknesses ?? []) {
    if (typeof w === 'string') {
      const match = w.match(/^(.+?)\s+(\d+)$/);
      if (match) weaknessMap[match[1].trim().toLowerCase()] = Number(match[2]);
    } else if (w?.type && w?.value != null) {
      weaknessMap[String(w.type).toLowerCase()] = Number(w.value);
    }
  }
  return {
    monster: withLibrary,
    hp: core.hp ?? summary.summary?.hp?.value ?? rich?.defenses?.hp ?? 1,
    ac: core.ac ?? summary.summary?.ac ?? rich?.defenses?.ac ?? null,
    perception: core.perception ?? summary.summary?.perception ?? rich?.perception ?? 0,
    saves: combatV2NormalizeMonsterSaves(core, summary, rich),
    skills: (rich?._skillTotals && typeof rich._skillTotals === 'object') ? { ...rich._skillTotals }
      : (rich?.skills && typeof rich.skills === 'object') ? { ...rich.skills }
      : {},
    spells,
    resistances: resistanceMap,
    weaknesses: weaknessMap,
    immunities: Array.isArray(rich?.defenses?.immunities) ? rich.defenses.immunities : [],
    attacks: rawAttacks.map(a => {
      const normalized = normalizeAttackForRolling(a);
      return {
        name: normalized.name,
        bonus: normalized.bonus ?? normalized.to_hit ?? 0,
        damage: normalized.damage ?? '1d4',
        damageType: normalized.damageType ?? '',
        traits: normalized.traits ?? [],
        source: 'bestiary',
      };
    }),
  };
}

function uniqueCombatV2Name(encounter, baseName, count, index) {
  const taken = new Set((encounter?.combatants ?? []).map(c => c.name.toLowerCase()));
  if (count === 1 && !taken.has(baseName.toLowerCase())) return baseName;
  let suffix = index;
  let name = `${baseName} ${suffix}`;
  while (taken.has(name.toLowerCase())) {
    suffix += 1;
    name = `${baseName} ${suffix}`;
  }
  return name;
}

function buildRecoveryCheckPayload(rc, combatant, { heroButtons = true } = {}) {
  const outcomeEmoji = rc.outcome === 'crit-success' ? '🌟'
    : rc.outcome === 'success' ? '✅'
    : rc.outcome === 'failure' ? '❌'
    : '💥';

  // Build the embed description with all the Remaster details
  const lines = [
    `Flat check vs DC ${rc.dc}: 1d20 (${rc.roll})`,
    `${outcomeEmoji} **${rc.outcome.replace('-', ' ').replace(/\b\w/g, l => l.toUpperCase())}**`,
    rc.narration,
  ];
  if (rc.doomed && rc.doomed > 0) {
    lines.splice(1, 0, `*Doomed ${rc.doomed} → death threshold is Dying ${rc.maxDying}*`);
  }

  const embed = new EmbedBuilder()
    .setColor(rc.died ? 0x8B0000 : rc.awoke ? 0x2ecc71 : rc.outcome === 'success' || rc.outcome === 'crit-success' ? 0x27ae60 : 0xe74c3c)
    .setTitle(`💀 ${combatant.name}'s Recovery Check`)
    .setDescription(lines.join('\n'));

  const components = [];
  if (!heroButtons || combatant.isNpc || !combatant.ownerId) return { embeds: [embed], components };

  // Look up hero points (PCs only)
  let heroPoints = 0;
  try {
    const characters = loadCharacters();
    const userCharacters = characters[combatant.ownerId] ?? {};
    const charKey = combatant.name.toLowerCase().replace(/\s+/g, '-');
    const charEntry = userCharacters[charKey];
    heroPoints = charEntry?.heroPoints ?? (charEntry ? 1 : 0);
  } catch (err) {
    console.error('Recovery check: hero point lookup failed:', err);
  }

  if (heroPoints <= 0) return { embeds: [embed], components };

  const safeName = combatant.name.replace(/[^a-zA-Z0-9]/g, '_');
  const buttons = [];

  // "Reroll" button — only when not dead. Reroll one die, keep better.
  if (!rc.died) {
    const awokeFlag = rc.awoke ? '1' : '0';
    buttons.push(
      new ButtonBuilder()
        .setCustomId(`rcheck_reroll_${safeName}_${rc.dyingBefore}_${rc.dyingAfter}_${rc.roll}_${awokeFlag}`)
        .setLabel(`🎭 Reroll (1 HP)`)
        .setStyle(ButtonStyle.Primary)
    );
  }

  // "Spend all to escape death" button — show whenever they got worse OR died.
  // PF2e RAW: triggers at start of turn OR when dying value would increase.
  const dyingWentUp = rc.dyingAfter > rc.dyingBefore;
  if (rc.died || dyingWentUp) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(`rcheck_stabilize_${safeName}`)
        .setLabel(`🛡️ Escape Death (spend all ${heroPoints} HP)`)
        .setStyle(rc.died ? ButtonStyle.Danger : ButtonStyle.Secondary)
    );
  }

  if (buttons.length > 0) {
    components.push(new ActionRowBuilder().addComponents(...buttons));
  }
  return { embeds: [embed], components };
}

function parseAndRollAttackDamage(damageString) {
  if (!damageString || typeof damageString !== 'string') return null;
  // Split on " plus " to handle compound damage. PF2e canonically uses "plus"
  // as the separator; we lowercase to be safe.
  const parts = damageString.split(/\s+plus\s+/i);
  const out = [];
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    // Try to extract a dice expression followed by a damage type. Patterns:
    //   "1d6 slashing"
    //   "3d12+15 piercing"
    //   "2d6 fire"
    //   "siphon life"   ← no dice, treat as flavor note
    const dmgMatch = trimmed.match(/^(\d*d\d+(?:[+-]\d+)?)\s+(.+)$/i);
    if (dmgMatch) {
      const expr = dmgMatch[1];
      const type = dmgMatch[2].trim().toLowerCase();
      const rollResult = rollDamageExpression(expr);
      if (rollResult) {
        out.push({ expr, type, rollResult });
        continue;
      }
    }
    // Non-dice part — treat as flavor (e.g. "siphon life", "grab", "knockdown")
    out.push({ expr: null, type: null, note: trimmed });
  }
  return out.length > 0 ? out : null;
}

function getCombatantAttacks(combatant, guildId) {
  if (!combatant?.bestiaryKey) return [];
  const { monster } = findMonster(combatant.bestiaryKey);
  if (!monster) return [];
  // Same pipeline /init addmonster used: GM edits + attack library overlay
  const edits = guildId ? getMonsterEdit(guildId, monster.name) : null;
  const edited = applyMonsterEdits(monster, edits);
  const withLibrary = guildId ? applyMonsterAttackLibrary(edited, guildId) : edited;
  return Array.isArray(withLibrary?.rich?.attacks) ? withLibrary.rich.attacks : [];
}

function findCombatantLoose(enc, name) {
  if (!enc || !name) return null;
  const q = String(name).toLowerCase().trim();
  const exact = enc.combatants.find(c => c.name.toLowerCase() === q);
  if (exact) return exact;
  const partial = enc.combatants.filter(c => c.name.toLowerCase().includes(q));
  return partial.length === 1 ? partial[0] : null;
}

function pickDefaultAttacker(enc, userId, attackerName) {
  if (!enc || enc.combatants.length === 0) return null;
  if (attackerName) return findCombatantLoose(enc, attackerName);
  const current = enc.combatants[enc.turnIndex] ?? null;
  if (current && (current.ownerId === userId || userId === enc.gmId)) return current;
  const owned = enc.combatants.filter(c => c.ownerId === userId && c.hp > 0);
  return owned.length === 1 ? owned[0] : current;
}

function pickDefaultTarget(enc, attacker, targetName) {
  if (!enc || !attacker) return null;
  if (targetName) return findCombatantLoose(enc, targetName);
  const enemies = enc.combatants.filter(c =>
    c.name.toLowerCase() !== attacker.name.toLowerCase() &&
    c.hp > 0 &&
    c.isNpc !== attacker.isNpc
  );
  return enemies[0] ?? null;
}

function findCombatantAttack(combatant, attackName, guildId) {
  const attacks = getCombatantAttacks(combatant, guildId);
  if (attacks.length === 0) return null;
  const q = String(attackName ?? '').toLowerCase().trim();
  if (!q) return attacks[0];
  // 1. Exact (case-insensitive) match
  const exact = attacks.find(a => String(a.name ?? '').toLowerCase() === q);
  if (exact) return exact;
  // 2. Substring match — return only if unambiguous
  const partial = attacks.filter(a => String(a.name ?? '').toLowerCase().includes(q));
  if (partial.length === 1) return partial[0];
  return null;
}

async function execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const channelId = interaction.channel.id;
    const userId = interaction.user.id;

    if (sub === 'start') {
      if (combatV2State.getEncounter(channelId) || getEncounter(channelId)) {
        return interaction.reply({ content: 'An encounter is already active here. Use `/init end` first.', ephemeral: true });
      }
      const newEnc = combatV2State.createEncounter(channelId, {
        guildId: interaction.guildId,
        gmId: userId,
        name: `Combat in #${interaction.channel?.name ?? 'channel'}`,
      });
      await interaction.reply(`Combat started. <@${userId}> is the GM.\nUse \`/init view\` to show the tracker. Next up: \`/init add\` will add PCs, monsters, NPCs, and companions into combat v2.`);
      await updateCombatV2Summary(interaction.channel, newEnc);
      return;
    }

    const v2Encounter = combatV2State.getEncounter(channelId);
    if (v2Encounter && (sub === 'view' || sub === 'list')) {
      const gmView = userId === v2Encounter.gmId;
      const { embed, page, totalPages } = combatV2Render.renderEncounter(v2Encounter, { gmView });
      const components = combatV2Render.pageButtons(channelId, page, totalPages);
      await updateCombatV2Summary(interaction.channel, v2Encounter);
      return interaction.reply({ embeds: [embed], components, ephemeral: gmView });
    }

    if (v2Encounter && sub === 'next') {
      if (userId !== v2Encounter.gmId) return interaction.reply({ content: 'Only the GM can advance turns.', ephemeral: true });
      if (v2Encounter.combatants.length === 0) return interaction.reply({ content: 'No combatants in the encounter yet.', ephemeral: true });
      const result = combatV2State.processTurnTransition(channelId, 1);
      const { current, encounter, recoveryCheck } = result;
      await updateCombatV2Summary(interaction.channel, encounter);
      const lines = [current
        ? `Next turn: **${current.name}**. Round **${encounter.round}**.`
        : `No combatants remain. Round **${encounter.round}**.`];
      for (const pr of result.persistentResults ?? []) {
        const flatStatus = pr.ended
          ? `flat check ${pr.flatRoll} vs DC ${pr.flatDc}: persistent damage ends`
          : `flat check ${pr.flatRoll} vs DC ${pr.flatDc}: persistent damage continues`;
        const defenseNote = pr.defenseNotes?.length ? ` (${pr.defenseNotes.join(', ')})` : '';
        const dyingTag = pr.died ? ' and died' : pr.wentDown ? ` and is Dying ${pr.dying}` : '';
        lines.push(`**${pr.name}** persistent ${pr.damageType}: ${pr.damageDice}[${pr.damageRolls.join(', ')}] = ${pr.finalDamage} damage${defenseNote}${dyingTag}; ${flatStatus}.`);
      }
      for (const expired of result.expiredEffects ?? []) {
        lines.push(`**${expired.effect.name}** expired on **${expired.combatantName}**.`);
      }
      if (result.actionEconomy?.text) {
        lines.push(result.actionEconomy.text);
      }
      const replyPayload = {
        content: lines.join('\n'),
      };
      if (recoveryCheck) {
        const recoveryPayload = buildRecoveryCheckPayload(recoveryCheck, recoveryCheck.combatant ?? current, { heroButtons: false });
        replyPayload.embeds = recoveryPayload.embeds;
        const deathPayload = combatDeathPayload(recoveryCheck);
        if (deathPayload?.embeds?.length) replyPayload.embeds = [...replyPayload.embeds, ...deathPayload.embeds].slice(0, 10);
      }
      for (const pr of result.persistentResults ?? []) {
        const deathPayload = combatDeathPayload(pr);
        if (deathPayload?.embeds?.length) {
          replyPayload.embeds = [...(replyPayload.embeds ?? []), ...deathPayload.embeds].slice(0, 10);
        }
      }
      return interaction.reply(replyPayload);
    }

    if (v2Encounter && sub === 'prev') {
      if (userId !== v2Encounter.gmId) return interaction.reply({ content: 'Only the GM can move turns backward.', ephemeral: true });
      if (v2Encounter.combatants.length === 0) return interaction.reply({ content: 'No combatants in the encounter yet.', ephemeral: true });
      const { current, encounter } = combatV2State.advanceTurn(channelId, -1);
      await updateCombatV2Summary(interaction.channel, encounter);
      return interaction.reply(`Previous turn: **${current.name}**. Round **${encounter.round}**.`);
    }

    if (v2Encounter && sub === 'end') {
      if (userId !== v2Encounter.gmId) return interaction.reply({ content: 'Only the GM can end the encounter.', ephemeral: true });
      await clearCombatV2Summary(interaction.channel, v2Encounter);
      combatV2State.endEncounter(channelId);
      return interaction.reply('Combat ended.');
    }

    if (v2Encounter && sub === 'hp') {
      const name = interaction.options.getString('name');
      const change = interaction.options.getInteger('change');
      const combatant = combatV2State.findCombatant(v2Encounter, name);
      if (!combatant) return interaction.reply({ content: `No combatant named **"${name}"** in combat.`, ephemeral: true });
      if (combatant.ownerId !== userId && v2Encounter.gmId !== userId) {
        return interaction.reply({ content: 'You can only modify HP for your own combatant, unless you are the GM.', ephemeral: true });
      }
      const result = combatV2State.applyHp(channelId, combatant.name, change);
      const verb = change >= 0 ? 'healed' : 'took';
      await interaction.reply({
        content: `**${result.combatant.name}** ${verb} **${Math.abs(change)}**: ${result.before.hp}/${result.combatant.maxHp} -> ${result.combatant.hp}/${result.combatant.maxHp} HP${result.combatant.tempHp ? ` (${result.combatant.tempHp} temp HP)` : ''}${combatDyingSuffix(result)}`,
        ...(combatDeathPayload(result) ?? {}),
      });
      await updateCombatV2Summary(interaction.channel, result.encounter);
      return;
    }

    if (v2Encounter && sub === 'recovery') {
      const name = interaction.options.getString('name');
      const target = combatV2State.findCombatant(v2Encounter, name);
      if (!target) return interaction.reply({ content: `No combatant named **"${name}"** in combat.`, ephemeral: true });
      if (target.ownerId !== userId && v2Encounter.gmId !== userId) {
        return interaction.reply({ content: 'Only the combatant owner or GM can roll that recovery check.', ephemeral: true });
      }
      if ((target.dying ?? 0) <= 0) {
        return interaction.reply({ content: `**${target.name}** is not dying.`, ephemeral: true });
      }
      const recoveryCheck = combatV2State.rollRecoveryCheck(channelId, target.name);
      const payload = buildRecoveryCheckPayload(recoveryCheck, target, { heroButtons: false });
      const deathPayload = combatDeathPayload(recoveryCheck);
      if (deathPayload?.embeds?.length) payload.embeds = [...(payload.embeds ?? []), ...deathPayload.embeds].slice(0, 10);
      await interaction.reply(payload);
      await updateCombatV2Summary(interaction.channel, recoveryCheck.encounter);
      return;
    }

    if (v2Encounter && sub === 'thp') {
      if (userId !== v2Encounter.gmId) return interaction.reply({ content: 'Only the GM can set temp HP for combatants right now.', ephemeral: true });
      const name = interaction.options.getString('name');
      const amount = interaction.options.getInteger('amount');
      const result = combatV2State.setTempHp(channelId, name, amount);
      await interaction.reply(`**${result.combatant.name}** temp HP: ${result.before} -> **${result.combatant.tempHp}**.`);
      await updateCombatV2Summary(interaction.channel, v2Encounter);
      return;
    }

    if (v2Encounter && sub === 'remove') {
      if (userId !== v2Encounter.gmId) return interaction.reply({ content: 'Only the GM can remove combatants.', ephemeral: true });
      const name = interaction.options.getString('name');
      const result = combatV2State.removeCombatant(channelId, name);
      await interaction.reply(`Removed **${result.combatant.name}** from combat.`);
      await updateCombatV2Summary(interaction.channel, result.encounter);
      return;
    }

    if (v2Encounter && sub === 'modify') {
      if (userId !== v2Encounter.gmId) return interaction.reply({ content: 'Only the GM can modify combatants.', ephemeral: true });
      const name = interaction.options.getString('name');
      const target = combatV2State.findCombatant(v2Encounter, name);
      if (!target) return interaction.reply({ content: `No combatant named **"${name}"** in combat.`, ephemeral: true });

      const patch = {};
      const changes = [];
      const newName = interaction.options.getString('new_name');
      if (newName) {
        const existing = combatV2State.findCombatant(v2Encounter, newName);
        if (existing && existing.id !== target.id) return interaction.reply({ content: `A combatant named **${newName}** already exists.`, ephemeral: true });
        patch.name = newName.trim();
        changes.push(`name -> ${patch.name}`);
      }
      const initiative = interaction.options.getInteger('initiative');
      if (initiative != null) { patch.initiative = initiative; changes.push(`initiative -> ${initiative}`); }
      const maxHp = interaction.options.getInteger('max_hp');
      if (maxHp != null) { patch.maxHp = maxHp; changes.push(`max HP -> ${maxHp}`); }
      const hp = interaction.options.getInteger('hp');
      if (hp != null) {
        patch.hp = Math.min(hp, maxHp ?? target.maxHp);
        changes.push(`HP -> ${patch.hp}`);
      } else if (maxHp != null && target.hp > maxHp) {
        patch.hp = maxHp;
        changes.push(`HP clamped -> ${maxHp}`);
      }
      const ac = interaction.options.getInteger('ac');
      if (ac != null) { patch.ac = ac; changes.push(`AC -> ${ac}`); }
      const hidden = interaction.options.getBoolean('hidden');
      if (hidden != null) { patch.hidden = hidden; changes.push(`hidden -> ${hidden}`); }
      const group = interaction.options.getString('group');
      if (group != null) { patch.groupId = group.trim() || null; changes.push(`group -> ${patch.groupId ?? 'none'}`); }

      const saves = { ...(target.saves ?? {}) };
      let changedSaves = false;
      for (const [opt, key] of [['fort', 'fort'], ['ref', 'ref'], ['will', 'will']]) {
        const value = interaction.options.getInteger(opt);
        if (value != null) {
          saves[key] = value;
          changedSaves = true;
          changes.push(`${opt} -> ${value}`);
        }
      }
      if (changedSaves) patch.saves = saves;

      const resistances = combatV2ParseDefenseMap(interaction.options.getString('resistances'));
      if (resistances) { patch.resistances = resistances; changes.push(`resistances updated`); }
      const weaknesses = combatV2ParseDefenseMap(interaction.options.getString('weaknesses'));
      if (weaknesses) { patch.weaknesses = weaknesses; changes.push(`weaknesses updated`); }
      const immunities = combatV2ParseList(interaction.options.getString('immunities'));
      if (immunities) { patch.immunities = immunities; changes.push(`immunities updated`); }
      const notes = interaction.options.getString('notes');
      if (notes != null) { patch.notes = notes; changes.push('notes updated'); }

      if (!changes.length) return interaction.reply({ content: 'No changes provided.', ephemeral: true });
      const result = combatV2State.modifyCombatant(channelId, target.name, patch);
      await interaction.reply(`Updated **${result.combatant.name}**: ${changes.join(', ')}.`);
      await updateCombatV2Summary(interaction.channel, result.encounter);
      return;
    }

    if (v2Encounter && sub === 'effect') {
      if (userId !== v2Encounter.gmId) return interaction.reply({ content: 'Only the GM can add effects.', ephemeral: true });
      const targetName = interaction.options.getString('target');
      const effectName = interaction.options.getString('name');
      const value = interaction.options.getInteger('value');
      const duration = interaction.options.getInteger('duration');
      const target = combatV2State.findCombatant(v2Encounter, targetName);
      if (!target) return interaction.reply({ content: `No combatant named **"${targetName}"** in combat.`, ephemeral: true });
      const preset = getPreset(effectName);
      const effect = preset ? {
        name: preset.name,
        value: preset.scaling ? (value ?? 1) : null,
        duration: duration ?? null,
        modifiers: preset.build(value ?? 1),
        source: 'preset',
      } : {
        name: effectName,
        value: value ?? null,
        duration: duration ?? null,
        modifiers: {
          attackBonus: interaction.options.getInteger('attack_bonus') ?? 0,
          damageBonus: interaction.options.getInteger('damage_bonus') ?? 0,
          acBonus: interaction.options.getInteger('ac_bonus') ?? 0,
          saveBonus: interaction.options.getInteger('save_bonus') ?? 0,
          skillBonus: interaction.options.getInteger('skill_bonus') ?? 0,
          description: interaction.options.getString('description') ?? '',
        },
        source: 'custom',
      };
      const result = combatV2State.addEffect(channelId, target.name, effect);
      await interaction.reply(`Added **${result.effect.name}${result.effect.value ? ` ${result.effect.value}` : ''}** to **${result.combatant.name}**.`);
      await updateCombatV2Summary(interaction.channel, result.encounter);
      return;
    }

    if (v2Encounter && sub === 'removeeffect') {
      if (userId !== v2Encounter.gmId) return interaction.reply({ content: 'Only the GM can remove effects.', ephemeral: true });
      const targetName = interaction.options.getString('target');
      const effectName = interaction.options.getString('name');
      const result = combatV2State.removeEffect(channelId, targetName, effectName);
      await interaction.reply(`Removed **${result.effect.name}** from **${result.combatant.name}**.`);
      await updateCombatV2Summary(interaction.channel, result.encounter);
      return;
    }

    if (v2Encounter && sub === 'effects') {
      const targetName = interaction.options.getString('target');
      const target = combatV2State.findCombatant(v2Encounter, targetName);
      if (!target) return interaction.reply({ content: `No combatant named **"${targetName}"** in combat.`, ephemeral: true });
      const lines = (target.effects ?? []).map(e => {
        const value = e.value != null ? ` ${e.value}` : '';
        const durationText = e.duration != null ? ` (${e.duration} rounds)` : '';
        return `• **${e.name}${value}**${durationText}`;
      });
      const embed = new EmbedBuilder()
        .setColor(0x9B59B6)
        .setTitle(`${target.name}'s Effects`)
        .setDescription(lines.length ? lines.join('\n') : 'No active effects.');
      return interaction.reply({ embeds: [embed], ephemeral: target.hidden && userId === v2Encounter.gmId });
    }

    if (v2Encounter && sub === 'move') {
      const moverName = interaction.options.getString('name');
      const mover = combatV2State.findCombatant(v2Encounter, moverName);
      if (!mover) return interaction.reply({ content: `No combatant named **"${moverName}"** in combat.`, ephemeral: true });
      const reactors = v2Encounter.combatants.filter(c =>
        c.id !== mover.id &&
        c.hp > 0 &&
        c.hasReaction !== false &&
        !c.reactionUsed &&
        c.isNpc !== mover.isNpc
      );
      if (!reactors.length) return interaction.reply(`**${mover.name}** moves. No opposing combatants have reactions available.`);
      const lines = [`**${mover.name}** moves. Potential reactions:`];
      for (const reactor of reactors.slice(0, 10)) {
        const mention = reactor.isNpc ? `<@${v2Encounter.gmId}>` : (reactor.ownerId ? `<@${reactor.ownerId}>` : '');
        lines.push(`${mention} **${reactor.name}** can react. Use \`/i reaction actor:${reactor.name}\` if they do.`);
      }
      if (reactors.length > 10) lines.push(`*...and ${reactors.length - 10} more.*`);
      return interaction.reply(lines.join('\n'));
    }

    if (v2Encounter && sub === 'reaction') {
      const reactorName = interaction.options.getString('name');
      const reason = interaction.options.getString('reason') ?? 'reaction trigger';
      const reactor = combatV2State.findCombatant(v2Encounter, reactorName);
      if (!reactor) return interaction.reply({ content: `No combatant named **"${reactorName}"** in combat.`, ephemeral: true });
      if (reactor.hasReaction === false || reactor.reactionUsed || reactor.hp <= 0) {
        return interaction.reply({ content: `**${reactor.name}** does not currently have a reaction available.`, ephemeral: true });
      }
      const mention = reactor.isNpc ? `<@${v2Encounter.gmId}>` : (reactor.ownerId ? `<@${reactor.ownerId}>` : '');
      return interaction.reply(`${mention} **${reactor.name}** reaction prompt: *${reason}*\nUse \`/i reaction actor:${reactor.name}\` if the reaction is used.`);
    }

    if (v2Encounter && sub === 'delay') {
      const current = combatV2State.currentCombatant(v2Encounter);
      if (!current) return interaction.reply({ content: 'No current combatant to delay.', ephemeral: true });
      if (userId !== v2Encounter.gmId && current.ownerId !== userId) {
        return interaction.reply({ content: 'Only the current combatant owner or GM can delay this turn.', ephemeral: true });
      }
      const result = combatV2State.delayCombatant(channelId, current.name);
      await updateCombatV2Summary(interaction.channel, result.encounter);
      const next = result.current ? ` Next up: **${result.current.name}**.` : '';
      return interaction.reply(`**${result.combatant.name}** delays.${next}`);
    }

    if (v2Encounter && sub === 'rejoin') {
      const name = interaction.options.getString('name');
      const targetName = interaction.options.getString('target');
      const combatant = combatV2State.findCombatant(v2Encounter, name);
      if (!combatant) return interaction.reply({ content: `No combatant named **"${name}"** in combat.`, ephemeral: true });
      if (userId !== v2Encounter.gmId && combatant.ownerId !== userId) {
        return interaction.reply({ content: 'Only the combatant owner or GM can rejoin this turn.', ephemeral: true });
      }
      if (!combatant.delayed) return interaction.reply({ content: `**${combatant.name}** is not delaying.`, ephemeral: true });
      if (targetName && !combatV2State.findCombatant(v2Encounter, targetName)) {
        return interaction.reply({ content: `No combatant named **"${targetName}"** in combat.`, ephemeral: true });
      }
      const result = combatV2State.rejoinCombatant(channelId, combatant.name, targetName);
      await updateCombatV2Summary(interaction.channel, result.encounter);
      return interaction.reply(`**${result.combatant.name}** rejoins initiative and acts now.`);
    }

    if (!v2Encounter && ['view', 'prev'].includes(sub)) {
      return interaction.reply({ content: 'No active combat v2 encounter. Start one with `/init start`.', ephemeral: true });
    }

    if (v2Encounter && sub === 'add') {
      const kind = interaction.options.getString('kind') ?? (interaction.options.getString('companion') ? 'companion' : 'pc');
      const nameArg = interaction.options.getString('name');
      const companionArg = interaction.options.getString('companion');
      const resultOverride = interaction.options.getInteger('result');
      const bonusOverride = interaction.options.getInteger('bonus');
      const count = interaction.options.getInteger('count') ?? 1;
      const groupId = interaction.options.getString('group');

      if (['monster', 'npc'].includes(kind) && userId !== v2Encounter.gmId) {
        return interaction.reply({ content: 'Only the GM can add monsters or NPCs.', ephemeral: true });
      }

      if (kind === 'pc') {
        const characters = loadCharacters();
        const { error, char: charEntry } = resolveChar(userId, interaction.options.getString('character') ?? nameArg, characters);
        if (error) return interaction.reply({ content: error, ephemeral: true });
        const c = charEntry.data;
        if (combatV2HasName(v2Encounter, c.name)) return interaction.reply({ content: `**${c.name}** is already in combat.`, ephemeral: true });
        const maxHp = computeCharMaxHp(charEntry);
        const initMod = bonusOverride ?? computeCharPerception(charEntry);
        const rolled = combatV2Initiative(initMod, resultOverride);
        const { combatant } = combatV2State.addCombatant(channelId, {
          name: c.name,
          type: 'pc',
          isNpc: false,
          hidden: false,
          initiative: rolled.initiative,
          hp: charEntry.hp ?? maxHp,
          maxHp,
          ac: c.acTotal?.acTotal ?? null,
          ownerId: userId,
          attacks: combatV2CharacterAttacks(charEntry),
          saves: {
            fort: combatV2CharacterSave(c, 'fortitude'),
            ref: combatV2CharacterSave(c, 'reflex'),
            will: combatV2CharacterSave(c, 'will'),
          },
          skills: combatV2CharacterSkills(charEntry),
        });
        await interaction.reply(`**${combatant.name}** joined combat at **${combatant.initiative}** ${rolled.text}.`);
        await updateCombatV2Summary(interaction.channel, v2Encounter);
        return;
      }

      if (kind === 'companion') {
        const characters = loadCharacters();
        const { error, char: charEntry } = resolveChar(userId, interaction.options.getString('character'), characters);
        if (error) return interaction.reply({ content: error, ephemeral: true });
        const companions = charEntry.companions ?? {};
        const query = companionArg ?? nameArg ?? charEntry.activeCompanion ?? 'active';
        const key = String(query).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        let comp = companions[key];
        if (!comp && (query === 'active' || !query)) comp = companions[charEntry.activeCompanion];
        if (!comp) comp = Object.values(companions).find(c => c.displayName?.toLowerCase() === String(query).toLowerCase());
        if (!comp) return interaction.reply({ content: `No companion "${query}" found for **${charEntry.data.name}**.`, ephemeral: true });
        if (combatV2HasName(v2Encounter, comp.displayName)) return interaction.reply({ content: `**${comp.displayName}** is already in combat.`, ephemeral: true });
        const scaled = scaleCompanion(comp, charEntry.data);
        const initMod = bonusOverride ?? scaled.perception ?? 0;
        const rolled = combatV2Initiative(initMod, resultOverride);
        const { combatant } = combatV2State.addCombatant(channelId, {
          name: comp.displayName,
          type: 'companion',
          isNpc: false,
          hidden: false,
          initiative: rolled.initiative,
          hp: comp.currentHp ?? scaled.maxHp,
          maxHp: scaled.maxHp,
          ac: scaled.ac,
          ownerId: userId,
          sourceKey: comp.baseType,
          attacks: combatV2CompanionAttacks(comp, scaled),
          saves: scaled.saves,
          skills: comp.skills ?? {},
          notes: `${charEntry.data.name}'s ${comp.form} companion`,
        });
        await interaction.reply(`**${combatant.name}** joined combat at **${combatant.initiative}** ${rolled.text}.`);
        await updateCombatV2Summary(interaction.channel, v2Encounter);
        return;
      }

      if (kind === 'npc') {
        const name = nameArg ?? 'NPC';
        const hp = interaction.options.getInteger('hp') ?? 1;
        const ac = interaction.options.getInteger('ac');
        const initMod = bonusOverride ?? 0;
        const added = [];
        for (let i = 1; i <= count; i += 1) {
          const rolled = combatV2Initiative(initMod, resultOverride);
          const uniqueName = uniqueCombatV2Name(v2Encounter, name, count, i);
          const { combatant } = combatV2State.addCombatant(channelId, {
            name: uniqueName,
            type: 'npc',
            isNpc: true,
            hidden: true,
            initiative: rolled.initiative,
            groupId,
            hp,
            maxHp: hp,
            ac,
            ownerId: userId,
          });
          added.push(`**${combatant.name}** init ${combatant.initiative}`);
        }
        await interaction.reply(`Added ${added.join(', ')}.`);
        await updateCombatV2Summary(interaction.channel, v2Encounter);
        return;
      }

      if (kind === 'monster') {
        const input = nameArg;
        if (!input) return interaction.reply({ content: 'Monster add needs `name:<monster name>`.', ephemeral: true });
        const { monster, matches, total } = findMonster(input);
        if (!monster) {
          if (matches?.length > 1) {
            const preview = matches.slice(0, 10).map(n => `• **${n}**`).join('\n');
            const extra = (total ?? matches.length) > 10 ? `\n*...and ${(total ?? matches.length) - 10} more.*` : '';
            return interaction.reply({ content: `Multiple creatures match **"${input}"**:\n${preview}${extra}`, ephemeral: true });
          }
          return interaction.reply({ content: `No creature named **"${input}"** in the bestiary.`, ephemeral: true });
        }
        const stats = combatV2MonsterStats(monster, interaction.guildId);
        const initMod = bonusOverride ?? stats.perception ?? 0;
        const sharedRoll = resultOverride !== null || groupId ? combatV2Initiative(initMod, resultOverride) : null;
        const added = [];
        for (let i = 1; i <= count; i += 1) {
          const rolled = sharedRoll ?? combatV2Initiative(initMod, resultOverride);
          const hp = stats.hp;
          const uniqueName = uniqueCombatV2Name(v2Encounter, monster.name, count, i);
          const { combatant } = combatV2State.addCombatant(channelId, {
            name: uniqueName,
            type: 'monster',
            isNpc: true,
            hidden: true,
            initiative: rolled.initiative,
            groupId: groupId ?? (count > 1 && sharedRoll ? monster.name : null),
            hp,
            maxHp: hp,
            ac: stats.ac,
            saves: stats.saves,
            skills: stats.skills,
            spells: stats.spells,
            resistances: stats.resistances,
            weaknesses: stats.weaknesses,
            immunities: stats.immunities,
            attacks: stats.attacks,
            ownerId: v2Encounter.gmId,
            sourceKey: monster.name,
          });
          added.push(`**${combatant.name}** init ${combatant.initiative}`);
        }
        await interaction.reply(`Added ${count === 1 ? monster.name : `${count} ${monster.name}s`} to combat.`);
        await interaction.followUp({ content: `GM details: ${added.join(', ')}. HP ${stats.hp}, AC ${stats.ac ?? '?'}.`, ephemeral: true });
        await updateCombatV2Summary(interaction.channel, v2Encounter);
        return;
      }
    }

    if (v2Encounter && sub === 'addnpc') {
      if (userId !== v2Encounter.gmId) return interaction.reply({ content: 'Only the GM can add NPCs.', ephemeral: true });
      const name = interaction.options.getString('name');
      const hp = interaction.options.getInteger('hp');
      const ac = interaction.options.getInteger('ac');
      const bonus = interaction.options.getInteger('bonus') ?? 0;
      const resultOverride = interaction.options.getInteger('result');
      const rolled = combatV2Initiative(bonus, resultOverride);
      if (combatV2HasName(v2Encounter, name)) return interaction.reply({ content: `A combatant named **${name}** is already in combat.`, ephemeral: true });
      const { combatant } = combatV2State.addCombatant(channelId, {
        name,
        type: 'npc',
        isNpc: true,
        hidden: true,
        initiative: rolled.initiative,
        hp,
        maxHp: hp,
        ac,
        ownerId: userId,
      });
      await interaction.reply(`**${combatant.name}** joined combat at **${combatant.initiative}** ${rolled.text}.`);
      await updateCombatV2Summary(interaction.channel, v2Encounter);
      return;
    }

    if (v2Encounter && sub === 'addmonster') {
      if (userId !== v2Encounter.gmId) return interaction.reply({ content: 'Only the GM can add monsters.', ephemeral: true });
      const input = interaction.options.getString('monster');
      const count = interaction.options.getInteger('count') ?? 1;
      const initMode = interaction.options.getString('init_mode') ?? 'per_copy';
      const hpMode = interaction.options.getString('hp_mode') ?? 'fixed';
      const bonusOverride = interaction.options.getInteger('bonus');
      const resultOverride = interaction.options.getInteger('result');
      const { monster, matches, total } = findMonster(input);
      if (!monster) {
        if (matches?.length > 1) {
          const preview = matches.slice(0, 10).map(n => `• **${n}**`).join('\n');
          const extra = (total ?? matches.length) > 10 ? `\n*...and ${(total ?? matches.length) - 10} more.*` : '';
          return interaction.reply({ content: `Multiple creatures match **"${input}"**:\n${preview}${extra}`, ephemeral: true });
        }
        return interaction.reply({ content: `No creature named **"${input}"** in the bestiary.`, ephemeral: true });
      }
      const stats = combatV2MonsterStats(monster, interaction.guildId);
      const initMod = bonusOverride ?? stats.perception ?? 0;
      const sharedRoll = initMode === 'shared' || resultOverride !== null ? combatV2Initiative(initMod, resultOverride) : null;
      const added = [];
      for (let i = 1; i <= count; i += 1) {
        const rolled = sharedRoll ?? combatV2Initiative(initMod, resultOverride);
        const uniqueName = uniqueCombatV2Name(v2Encounter, monster.name, count, i);
        const hp = hpMode === 'varied' ? Math.max(1, stats.hp + Math.floor(Math.random() * 11) - 5) : stats.hp;
        const { combatant } = combatV2State.addCombatant(channelId, {
          name: uniqueName,
          type: 'monster',
          isNpc: true,
          hidden: true,
          initiative: rolled.initiative,
          groupId: initMode === 'shared' && count > 1 ? monster.name : null,
          hp,
          maxHp: hp,
          ac: stats.ac,
          saves: stats.saves,
          skills: stats.skills,
          spells: stats.spells,
          resistances: stats.resistances,
          weaknesses: stats.weaknesses,
          immunities: stats.immunities,
          attacks: stats.attacks,
          ownerId: v2Encounter.gmId,
          sourceKey: monster.name,
        });
        added.push(`**${combatant.name}** init ${combatant.initiative}`);
      }
      await interaction.reply(`Added ${count === 1 ? monster.name : `${count} ${monster.name}s`} to combat.`);
      await interaction.followUp({ content: `GM details: ${added.join(', ')}. Base HP ${stats.hp}, AC ${stats.ac ?? '?'}.`, ephemeral: true });
      await updateCombatV2Summary(interaction.channel, v2Encounter);
      return;
    }

    return interaction.reply({
      content: 'No active combat v2 encounter here. Use `/init start`, then add combatants with `/init add`, `/init addmonster`, or `/i join`.',
      ephemeral: true,
    });

    if (sub === 'start') {
      if (getEncounter(channelId)) return interaction.reply({ content: '⚠️ An encounter is already active here. Use `/init end` first.', ephemeral: true });
      const newEnc = createEncounter(channelId, userId);
      await interaction.reply(
        `⚔️ Combat started! <@${userId}> is the GM.\n` +
        `Players: use \`/init add\` to join. GM: use \`/init addnpc\` for monsters.\n` +
        `When everyone is in, the GM uses \`/init next\` to begin.`
      );
      await updateSummary(interaction.channel, newEnc);
      return;
    }

    const enc = getEncounter(channelId);
    if (!enc) return interaction.reply({ content: '❌ No active encounter. Start one with `/init start`.', ephemeral: true });

    if (sub === 'add') {
      const characters = loadCharacters();

      // ── Companion path ─────────────────────────────────────────────
      // If `companion:` is specified, add the user's companion to init as
      // their own combatant (ownedby the user, not NPC-controlled). Uses
      // the companion's Perception for the initiative roll (standard PF2e).
      const compArg = interaction.options.getString('companion');
      if (compArg) {
        const { error: cerr, char: ce } = resolveChar(userId, interaction.options.getString('character'), characters);
        if (cerr) {
          return interaction.reply({ content: cerr, ephemeral: true });
        }
        if (!ce.companions || Object.keys(ce.companions).length === 0) {
          return interaction.reply({ content: `❌ **${ce.data.name}** has no companions. Add one with \`/companion add\`.`, ephemeral: true });
        }
        // Resolve the companion: by slug/name, falling back to active.
        const compKey = compArg.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        let comp = ce.companions[compKey];
        if (!comp && (compArg === 'active' || !compArg.trim())) {
          comp = ce.companions[ce.activeCompanion];
        }
        // Try matching by displayName too, in case the user typed the actual
        // shown name (slug-ified may not match if it contains non-ASCII).
        if (!comp) {
          const byDisplay = Object.values(ce.companions).find(
            c => c.displayName.toLowerCase() === compArg.toLowerCase()
          );
          if (byDisplay) comp = byDisplay;
        }
        if (!comp) return interaction.reply({ content: `❌ No companion "${compArg}" found for **${ce.data.name}**.`, ephemeral: true });

        if (enc.combatants.some(x => x.name.toLowerCase() === comp.displayName.toLowerCase())) {
          return interaction.reply({ content: `❌ **${comp.displayName}** is already in the encounter.`, ephemeral: true });
        }

        const scaled = scaleCompanion(comp, ce.data);
        const initBonus = interaction.options.getInteger('bonus') ?? 0;
        const resultOverride = interaction.options.getInteger('result');
        // Companions roll initiative using Perception (standard PF2e rule).
        // scaled.perception already factors in any perception override the user set.
        const initMod = scaled.perception ?? 0;
        let initiative, rollText;
        if (resultOverride !== null) {
          initiative = resultOverride;
          rollText = `(set to ${resultOverride})`;
        } else {
          const r = rollD20Plus(initMod + initBonus);
          initiative = r.total;
          rollText = `(rolled ${r.roll} ${fmt(r.mod)})`;
        }

        addCombatant(channelId, {
          name: comp.displayName,
          initiative,
          hp: comp.currentHp ?? scaled.maxHp,
          maxHp: scaled.maxHp,
          ac: scaled.ac,
          ownerId: userId,
          isNpc: false,
          companionOf: ce.data.name,
          effects: [],
        });

        await interaction.reply(`🐾 **${comp.displayName}** (${ce.data.name}'s ${comp.form} companion) joins initiative at **${initiative}** ${rollText}. HP ${comp.currentHp ?? scaled.maxHp}/${scaled.maxHp} · AC ${scaled.ac}`);
        await updateSummary(interaction.channel, enc);
        return;
      }

      // ── Character path (default) ───────────────────────────────────
      const { error, char: charEntry } = resolveChar(userId, interaction.options.getString('character'), characters);
      if (error) return interaction.reply({ content: error, ephemeral: true });

      const charName = charEntry.name;
      if (enc.combatants.some(x => x.name.toLowerCase() === charName.toLowerCase())) return interaction.reply({ content: `❌ ${charName} is already in the encounter.`, ephemeral: true });

      const perception = computeCharPerception(charEntry);
      const maxHp = computeCharMaxHp(charEntry);
      const bonusOverride = interaction.options.getInteger('bonus');
      const resultOverride = interaction.options.getInteger('result');
      const bonus = bonusOverride ?? perception;

      let initiative, rollText;
      if (resultOverride !== null) {
        initiative = resultOverride;
        rollText = `(set to ${resultOverride})`;
      } else {
        const r = rollD20Plus(bonus);
        initiative = r.total;
        rollText = `(rolled ${r.roll} ${fmt(r.mod)})`;
      }

      const charAc = charEntry.data?.acTotal?.acTotal ?? null;
      addCombatant(channelId, {
        name: charName,
        initiative,
        hp: maxHp,
        maxHp,
        ac: charAc,
        ownerId: userId,
        isNpc: false,
        effects: [],
      });

      await interaction.reply(`**${charName}** joined initiative at **${initiative}** ${rollText}.`);
      await updateSummary(interaction.channel, enc);
      return;
    }

    if (sub === 'addnpc') {
      if (userId !== enc.gmId) return interaction.reply({ content: '❌ Only the GM can add NPCs.', ephemeral: true });

      const name = interaction.options.getString('name');
      const bonus = interaction.options.getInteger('bonus');
      const hp = interaction.options.getInteger('hp');
      const ac = interaction.options.getInteger('ac');
      const resultOverride = interaction.options.getInteger('result');

      if (enc.combatants.some(x => x.name.toLowerCase() === name.toLowerCase())) return interaction.reply({ content: `❌ A combatant named "${name}" already exists. Use a unique name (e.g. "Goblin 1").`, ephemeral: true });

      let initiative, rollText;
      if (resultOverride !== null) {
        initiative = resultOverride;
        rollText = `(set to ${resultOverride})`;
      } else {
        const r = rollD20Plus(bonus);
        initiative = r.total;
        rollText = `(rolled ${r.roll} ${fmt(r.mod)})`;
      }

      addCombatant(channelId, {
        name,
        initiative,
        hp,
        maxHp: hp,
        ac,
        ownerId: userId,
        isNpc: true,
        effects: [],
      });

      await interaction.reply(`**${name}** joined initiative at **${initiative}** ${rollText}.`);
      await updateSummary(interaction.channel, enc);
      return;
    }

    // ── /init addmonster ─────────────────────────────────────────────
    // Pull name/HP/AC/perception straight from bestiary.json. Supports
    // count for multi-spawns (auto-numbered "Goblin Warrior 1", 2, etc.).
    // GM chooses whether to roll initiative once (shared) or per-copy,
    // and whether to use the published HP or roll a d10 wiggle.
    if (sub === 'addmonster') {
      if (userId !== enc.gmId) return interaction.reply({ content: '❌ Only the GM can add monsters.', ephemeral: true });

      const input = interaction.options.getString('monster');
      const count = interaction.options.getInteger('count') ?? 1;
      const initMode = interaction.options.getString('init_mode') ?? 'per_copy';
      const hpMode = interaction.options.getString('hp_mode') ?? 'fixed';
      const bonusOverride = interaction.options.getInteger('bonus');
      const resultOverride = interaction.options.getInteger('result');

      if (count < 1 || count > 20) return interaction.reply({ content: '❌ Count must be between 1 and 20.', ephemeral: true });

      // Look up the monster, falling back to match suggestions
      const { monster, matches, total } = findMonster(input);
      if (!monster) {
        if (matches && matches.length > 1) {
          const preview = matches.slice(0, 10).map(n => `• **${n}**`).join('\n');
          const totalCount = total ?? matches.length;
          const extra = totalCount > 10 ? `\n*…and ${totalCount - 10} more.*` : '';
          return interaction.reply({ content: `🔍 Multiple creatures match **"${input}"**:\n${preview}${extra}`, ephemeral: true });
        }
        return interaction.reply({ content: `❌ No creature named **"${input}"** in the bestiary.`, ephemeral: true });
      }

      // Apply GM edits + attack library so added monsters have the overlays
      // their bestiary entry promises (same pipeline as /monster shows).
      const edits = getMonsterEdit(interaction.guildId, monster.name);
      const edited = applyMonsterEdits(monster, edits);
      const withLibrary = applyMonsterAttackLibrary(edited, interaction.guildId);
      const core = withLibrary.core ?? {};
      const summary = withLibrary.summary ?? {};
      const rich = withLibrary.rich ?? null;

      const baseHp = core.hp ?? summary.summary?.hp?.value ?? rich?.defenses?.hp ?? null;
      const ac = core.ac ?? summary.summary?.ac ?? rich?.defenses?.ac ?? null;
      const perception = core.perception ?? summary.summary?.perception ?? rich?.perception ?? null;

      if (baseHp === null || baseHp === undefined) {
        return interaction.reply({ content: `❌ **${monster.name}** has no HP value in the bestiary. Use \`/init addnpc\` or \`/monsteredit\` to fix it.`, ephemeral: true });
      }

      // Bonus defaults to published perception; GM can override
      const bonus = bonusOverride ?? perception ?? 0;

      // For shared init, roll once up front
      let sharedInit = null, sharedRollText = '';
      if (resultOverride !== null) {
        sharedInit = resultOverride;
        sharedRollText = `(set to ${resultOverride})`;
      } else if (initMode === 'shared') {
        const r = rollD20Plus(bonus);
        sharedInit = r.total;
        sharedRollText = `(rolled ${r.roll} ${fmt(r.mod)})`;
      }

      // Figure out how to compute HP per copy
      const rollHp = () => {
        if (hpMode === 'fixed') return baseHp;
        // 'varied': apply a d10 wiggle — ±5 around the published HP, clamped
        // to ≥1. This isn't a full HP formula (bestiary doesn't store one),
        // just a way to avoid four identical goblins at exactly 14 HP each.
        const wiggle = Math.floor(Math.random() * 11) - 5;
        return Math.max(1, baseHp + wiggle);
      };

      // Auto-number copies, skipping names already in the encounter.
      const baseName = monster.name;
      const existingNames = new Set(enc.combatants.map(c => c.name.toLowerCase()));
      const addedLines = [];
      let skipped = 0;
      for (let i = 1; i <= count; i++) {
        // Try "baseName 1", "baseName 2", ... until we find one not taken.
        // If count === 1 and there's no existing "baseName", use "baseName" alone.
        let name;
        if (count === 1 && !existingNames.has(baseName.toLowerCase())) {
          name = baseName;
        } else {
          let suffix = i;
          while (existingNames.has(`${baseName} ${suffix}`.toLowerCase())) suffix++;
          name = `${baseName} ${suffix}`;
        }
        existingNames.add(name.toLowerCase());

        let initiative, rollText;
        if (initMode === 'shared' || resultOverride !== null) {
          initiative = sharedInit;
          rollText = sharedRollText;
        } else {
          const r = rollD20Plus(bonus);
          initiative = r.total;
          rollText = `(${r.roll} ${fmt(r.mod)})`;
        }

        const hp = rollHp();
        addCombatant(channelId, {
          name,
          initiative,
          hp,
          maxHp: hp,
          ac,
          ownerId: userId,
          isNpc: true,
          effects: [],
          // Stash the bestiary key so future features (e.g. "show this combatant's
          // stat block") can look them up without having to re-search.
          bestiaryKey: monster.name,
        });
        addedLines.push(`• **${name}** — init **${initiative}** ${rollText}, HP ${hp}, AC ${ac ?? '?'}`);
      }

      // Two-message reply pattern:
      //   1. PUBLIC reply — just the count + name, NO stats. Players see "Goblin
      //      Warrior 1 joined initiative" without being able to see HP/AC/init.
      //   2. EPHEMERAL follow-up to GM — full stat line per copy. GM gets the
      //      details they need to run combat without leaking them to players.
      // This protects metagame info (esp. HP — players shouldn't know the
      // monster has 14 HP because they saw the GM type it in).
      const publicNames = enc.combatants
        .filter(c => c.bestiaryKey === monster.name)
        .slice(-count)
        .map(c => c.name);
      const publicHeader = count === 1
        ? `**${publicNames[0]}** joined the encounter.`
        : `**${count}× ${baseName}** joined the encounter: ${publicNames.join(', ')}`;
      await interaction.reply({ content: publicHeader });

      const gmHeader = `**GM details — ${count}× ${baseName}**${skipped ? ` (${skipped} name collision(s) auto-renumbered)` : ''}:`;
      await interaction.followUp({
        content: `${gmHeader}\n${addedLines.join('\n')}`,
        ephemeral: true,
      });
      await updateSummary(interaction.channel, enc);
      return;
    }

    // ── /init attack — auto-roll a monster's bestiary attack ─────────
    // GM-only. Looks up the combatant in the encounter, pulls the attack
    // from their bestiary entry (rich.attacks), and rolls it just like
    // /attack does for player characters: auto-MAP, effect modifiers,
    // crit handling, damage application, reaction prompts.
    //
    // Replaces the old /mattack flow where GMs had to manually type
    // bonus + damage every time. Now: /init attack monster:Goblin Warrior
    // attack:dogslicer target:Bard does it all.
    if (sub === 'attack') {
      const attackerName = interaction.options.getString('monster');
      const attackName = interaction.options.getString('attack');
      const targetName = interaction.options.getString('target');
      const extraBonus = interaction.options.getInteger('bonus') ?? 0;
      const explicitMap = interaction.options.getInteger('map'); // null if unset

      // 1. Look up the attacker as a combatant in the encounter. If omitted,
      // default to the current turn when it belongs to the caller/GM, otherwise
      // the caller's only living combatant.
      const attacker = pickDefaultAttacker(enc, userId, attackerName);
      if (!attacker) {
        return interaction.reply({
          content: attackerName
            ? `❌ No combatant named **"${attackerName}"** in this encounter. Use \`/init list\` to see who's in initiative.`
            : '❌ I could not tell who is attacking. Use `monster:<name>` once, or wait until your combatant is the current turn.',
          ephemeral: true,
        });
      }
      if (userId !== enc.gmId && attacker.ownerId !== userId) {
        return interaction.reply({ content: `❌ You can only attack with your own combatant. I resolved the attacker as **${attacker.name}**.`, ephemeral: true });
      }
      if (!attacker.isNpc) {
        const characters = loadCharacters();
        const resolved = findCharacterEntryForCombatant(characters, attacker);
        if (!resolved?.char) return interaction.reply({ content: `❌ I found **${attacker.name}** in initiative, but couldn't match it to a saved character or companion.`, ephemeral: true });
        const target = pickDefaultTarget(enc, attacker, targetName);
        if (targetName && !target) return interaction.reply({ content: `❌ No combatant named **"${targetName}"** in this encounter.`, ephemeral: true });

        const charEntry = resolved.char;
        const char = charEntry.data;
        const attacks = [];
        if (resolved.companion) {
          const comp = resolved.companion;
          const scaled = scaleCompanion(comp, char);
          if (scaled.primaryAttack) attacks.push({
            name: scaled.primaryAttack.name,
            bonus: scaled.attackBonus,
            damage: `${scaled.damageDice}${scaled.damageBonus !== 0 ? (scaled.damageBonus > 0 ? '+' : '') + scaled.damageBonus : ''}`,
            damageType: scaled.damageType ?? '',
            traits: scaled.primaryAttack.traits ?? [],
            title: `${comp.displayName} attacks with ${scaled.primaryAttack.name}!`,
            footer: `${char.name}'s companion`,
            thumbnail: comp.art ?? charEntry.art ?? null,
          });
          for (const a of (comp.customAttacks ?? [])) attacks.push({
            name: a.name, bonus: a.bonus, damage: a.damage, damageType: a.damageType ?? '', traits: a.traits ?? [],
            title: `${comp.displayName} attacks with ${a.name}!`, footer: `${char.name}'s companion`, thumbnail: comp.art ?? charEntry.art ?? null,
          });
        } else {
          for (const attack of combatV2CharacterAttacks(charEntry)) {
            attacks.push({
              ...attack,
              title: `${char.name} attacks with ${attack.name}!`,
              footer: `${char.name} · Attack ${fmt(attack.bonus ?? 0)} · ${attack.damage ?? ''} ${attack.damageType ?? ''}`,
              thumbnail: charEntry.art ?? null,
            });
          }
        }
        if (attacks.length === 0) return interaction.reply({ content: `❌ **${attacker.name}** has no attacks configured.`, ephemeral: true });
        const chosen = attackName
          ? attacks.find(a => a.name.toLowerCase() === attackName.toLowerCase()) ?? attacks.find(a => a.name.toLowerCase().includes(attackName.toLowerCase()))
          : attacks[0];
        if (!chosen) return interaction.reply({ content: `❌ No attack matching **"${attackName}"**. Available: ${attacks.map(a => a.name).join(', ')}`, ephemeral: true });

        const agile = (chosen.traits ?? []).map(t => String(t).toLowerCase()).includes('agile');
        const mapInfo = explicitMap !== null
          ? { penalty: calculateMap(explicitMap, agile), noteText: explicitMap > 0 ? `MAP ${calculateMap(explicitMap, agile)} (manual)` : null }
          : ca.computeMapForNextAttack(attacker, agile);
        const attackerMods = sumEffectModifiers(attacker);
        const targetMods = target ? sumEffectModifiers(target) : { acBonus: 0, activeEffects: [] };
        const dieRoll = Math.floor(Math.random() * 20) + 1;
        const attackTotal = dieRoll + chosen.bonus + extraBonus + mapInfo.penalty + attackerMods.attackBonus;
        const baseTargetAc = target?.ac ?? null;
        const effectiveTargetAc = baseTargetAc !== null ? baseTargetAc + targetMods.acBonus : null;
        const degree = effectiveTargetAc !== null ? determineDegreeOfSuccess(attackTotal, dieRoll, effectiveTargetAc) : null;
        const dmg = rollCompoundExpression(chosen.damage);
        let finalDamage = dmg ? Math.max(1, dmg.total + attackerMods.damageBonus) : 0;
        const preCritDamage = finalDamage;
        if (degree === 'crit-success') finalDamage *= 2;

        const mapText = mapInfo.penalty !== 0 ? ` ${fmt(mapInfo.penalty)}` : '';
        const bonusText = extraBonus !== 0 ? ` ${fmt(extraBonus)}` : '';
        const attackerEffectText = formatEffectContributions(attackerMods.activeEffects, 'attack');
        let attackLine = `**Attack Roll**\n1d20 (${dieRoll}) ${fmt(chosen.bonus)}${mapText}${bonusText}${attackerEffectText ? ` ${fmt(attackerMods.attackBonus)}` : ''} = **${attackTotal}**`;
        if (mapInfo.noteText) attackLine += `\n*${mapInfo.noteText}*`;
        if (attackerEffectText) attackLine += `\n*${attackerEffectText.trim().slice(1, -1)}*`;
        if (dieRoll === 20) attackLine += '\n⭐ Natural 20!';
        if (dieRoll === 1) attackLine += '\n💀 Natural 1!';

        let outcomeLine = target ? `🎯 Attack against **${target.name}** (AC unknown — GM decides)` : 'No target selected.';
        if (degree === 'crit-success') outcomeLine = `🎯 **Critical Hit on ${target.name}!** AC ${effectiveTargetAc}`;
        else if (degree === 'success') outcomeLine = `✅ **Hit on ${target.name}!** AC ${effectiveTargetAc}`;
        else if (degree === 'failure') outcomeLine = `❌ **Miss on ${target.name}.** AC ${effectiveTargetAc}`;
        else if (degree === 'crit-failure') outcomeLine = `💢 **Critical Miss on ${target.name}.** AC ${effectiveTargetAc}`;

        let damageLine = '';
        if (dmg && (degree === 'success' || degree === 'crit-success' || !target)) {
          damageLine = degree === 'crit-success'
            ? `**Damage (CRIT × 2)**\n${dmg.display}${attackerMods.damageBonus ? ` ${fmt(attackerMods.damageBonus)}` : ''} = ${preCritDamage} × 2 = **${finalDamage} ${chosen.damageType}**`
            : `**Damage**\n${dmg.display}${attackerMods.damageBonus ? ` ${fmt(attackerMods.damageBonus)}` : ''} = **${finalDamage} ${chosen.damageType}**`;
        }
        let hpLine = '';
        let deathPayload = null;
        if (target && finalDamage > 0 && (degree === 'success' || degree === 'crit-success')) {
          const dmgResult = ca.applyDamage(channelId, target.name, finalDamage, { isCrit: degree === 'crit-success' });
          hpLine = target.isNpc
            ? `\n❤️ **${target.name}** took ${finalDamage} damage${dmgResult?.displaySuffix ?? ''}`
            : `\n❤️ **${target.name}**: ${target.hp}/${target.maxHp} HP${dmgResult?.displaySuffix ?? ''}`;
          deathPayload = combatDeathPayload(dmgResult);
        }
        if (explicitMap === null) ca.recordAttack(channelId, attacker.name);
        const embed = new EmbedBuilder()
          .setColor(0xC0392B)
          .setTitle(`⚔️ ${chosen.title}`)
          .setDescription([attackLine, '', damageLine || null, outcomeLine, hpLine || null].filter(Boolean).join('\n'))
          .setFooter({ text: chosen.footer });
        if (chosen.thumbnail) embed.setThumbnail(chosen.thumbnail);
        await interaction.reply({ embeds: [embed, ...(deathPayload?.embeds ?? [])].slice(0, 10) });
        await updateSummary(interaction.channel, enc);
        return;
      }
      if (!attacker.bestiaryKey) {
        return interaction.reply({
          content: `❌ **${attacker.name}** wasn't added from the bestiary, so I can't auto-pull their attacks. Use \`/mattack\` to roll an attack manually instead.`,
          ephemeral: true,
        });
      }

      // 2. Find the named attack on the attacker
      const atk = findCombatantAttack(attacker, attackName, interaction.guildId);
      if (!atk) {
        const available = getCombatantAttacks(attacker, interaction.guildId)
          .map(a => `**${a.name}** (${a.type === 'ranged' ? '🏹' : '⚔️'} ${fmt(a.to_hit)})`)
          .join(', ') || 'none';
        return interaction.reply({
          content: `❌ **${attacker.name}** has no attack matching **"${attackName}"**. Available: ${available}`,
          ephemeral: true,
        });
      }

      // 3. Look up the target. If omitted, pick the first living opposing
      // combatant so the short form can resolve in ordinary PC-vs-monster turns.
      const target = pickDefaultTarget(enc, attacker, targetName);
      if (!target) {
        return interaction.reply({ content: targetName ? `❌ No combatant named **"${targetName}"** in this encounter.` : '❌ I could not choose a target. Use `target:<name>`.', ephemeral: true });
      }

      const baseAttackBonus = typeof atk.to_hit === 'number' ? atk.to_hit : 0;
      const isAgile = (atk.traits ?? []).some(t => String(t).toLowerCase() === 'agile');
      const attackerMods = sumEffectModifiers(attacker);
      const targetMods = sumEffectModifiers(target);

      // 4. Compute MAP (auto-tracked from encounter, or manual override)
      let mapPenalty, mapNoteText;
      if (explicitMap !== null) {
        mapPenalty = calculateMap(explicitMap, isAgile);
        mapNoteText = explicitMap > 0 ? `MAP ${mapPenalty} (manual)` : null;
      } else {
        const mapInfo = ca.computeMapForNextAttack(attacker, isAgile);
        mapPenalty = mapInfo.penalty;
        mapNoteText = mapInfo.noteText;
      }

      // 5. Roll attack
      const dieRoll = Math.floor(Math.random() * 20) + 1;
      const attackTotal = dieRoll + baseAttackBonus + extraBonus + mapPenalty + attackerMods.attackBonus;

      const baseTargetAc = target.ac ?? null;
      const effectiveTargetAc = baseTargetAc !== null ? baseTargetAc + targetMods.acBonus : null;
      const degree = effectiveTargetAc !== null
        ? determineDegreeOfSuccess(attackTotal, dieRoll, effectiveTargetAc)
        : null;

      // 6. Roll damage (handles compound expressions like "3d12+15 piercing plus 2d6 fire")
      const damageParts = parseAndRollAttackDamage(atk.damage);
      const totalDamageBonus = attackerMods.damageBonus;

      // Sum all the rolled dice damage (flavor-only parts contribute 0)
      let totalRolledDamage = 0;
      const damageLineParts = [];
      const allTypes = [];
      if (damageParts) {
        for (const part of damageParts) {
          if (part.rollResult) {
            totalRolledDamage += part.rollResult.total;
            const partTotal = part.rollResult.total;
            damageLineParts.push(`${part.rollResult.display} **${partTotal} ${part.type}**`);
            allTypes.push(part.type);
          } else if (part.note) {
            damageLineParts.push(`*plus ${part.note}*`);
          }
        }
      }
      // Apply effect bonus to damage (e.g. Bless)
      let finalDamage = Math.max(1, totalRolledDamage + totalDamageBonus);
      // Crits double
      if (degree === 'crit-success') finalDamage = finalDamage * 2;

      // 7. Build the embed (same shape as /mattack so it feels consistent)
      const mapText = mapPenalty !== 0 ? ` ${mapPenalty}` : '';
      const bonusText = extraBonus !== 0 ? ` ${fmt(extraBonus)}` : '';
      const attackerEffectText = formatEffectContributions(attackerMods.activeEffects, 'attack');
      const traitsText = (atk.traits?.length) ? ` *(${atk.traits.join(', ')})*` : '';

      let attackLine = `**Attack Roll**\n1d20 (${dieRoll}) ${fmt(baseAttackBonus)}${mapText}${bonusText}${attackerEffectText ? ` ${fmt(attackerMods.attackBonus)}` : ''} = **${attackTotal}**`;
      if (mapNoteText) attackLine += `\n*${mapNoteText}*`;
      if (attackerEffectText) attackLine += `\n*${attackerEffectText.trim().slice(1, -1)}*`;
      if (dieRoll === 20) attackLine += '\n⭐ Natural 20!';
      if (dieRoll === 1)  attackLine += '\n💀 Natural 1!';

      // Damage line (if we have parsed damage)
      let damageLine = null;
      if (damageParts && damageLineParts.length > 0) {
        const damageContribText = formatEffectContributions(attackerMods.activeEffects, 'damage');
        const bonusDisplay = totalDamageBonus !== 0 ? ` ${fmt(totalDamageBonus)}` : '';
        if (degree === 'crit-success') {
          damageLine = `**Damage (CRIT × 2)**\n${damageLineParts.join(' + ')}${bonusDisplay} → **${finalDamage}** total`;
        } else {
          damageLine = `**Damage**\n${damageLineParts.join(' + ')}${bonusDisplay} → **${finalDamage}** total`;
        }
        if (damageContribText) damageLine += `\n*${damageContribText.trim().slice(1, -1)}*`;
      } else if (atk.damage) {
        // Couldn't parse — show raw string so GM can roll manually
        damageLine = `**Damage**\n*Couldn't auto-roll \`${atk.damage}\` — please roll manually.*`;
      }

      const acBreakdown = baseTargetAc !== null && targetMods.acBonus !== 0
        ? ` (base ${baseTargetAc}${fmt(targetMods.acBonus)} from effects = ${effectiveTargetAc})`
        : '';
      let outcomeLine;
      if (degree === 'crit-success')      outcomeLine = `🎯 **Critical Hit on ${target.name}!** AC ${effectiveTargetAc}${acBreakdown}`;
      else if (degree === 'success')      outcomeLine = `✅ **Hit on ${target.name}!** AC ${effectiveTargetAc}${acBreakdown}`;
      else if (degree === 'failure')      outcomeLine = `❌ **Miss on ${target.name}.** AC ${effectiveTargetAc}${acBreakdown}`;
      else if (degree === 'crit-failure') outcomeLine = `💢 **Critical Miss on ${target.name}.** AC ${effectiveTargetAc}${acBreakdown}`;
      else                                outcomeLine = `🎯 Attack against **${target.name}** (AC unknown — GM decides)`;

      // 8. Apply damage on hit
      let hpLine = '';
      let deathPayload = null;
      let mentionLine = '';
      if (degree === 'success' || degree === 'crit-success') {
        const dmgResult = ca.applyDamage(channelId, target.name, finalDamage);
        const dyingNote = dmgResult?.displaySuffix ?? '';
        hpLine = target.isNpc
          ? `\n❤️ **${target.name}** took ${finalDamage} damage${dyingNote}`
          : `\n❤️ **${target.name}**: ${target.hp}/${target.maxHp} HP${dyingNote}`;
        deathPayload = combatDeathPayload(dmgResult);
      }
      if (!target.isNpc && target.ownerId) mentionLine = `<@${target.ownerId}>`;

      // 9. Record attack for MAP tracking (only if MAP wasn't manually overridden)
      if (explicitMap === null) {
        ca.recordAttack(channelId, attacker.name);
      }

      // 10. Reaction prompt for the target (Reactive Strike, Shield Block, etc.)
      let reactionPromptRow = null;
      let reactionPromptContent = '';
      if (target && target.hasReaction !== false && ca.hasReactionAvailable(target)) {
        if (target.name.toLowerCase() !== attacker.name.toLowerCase()) {
          const reactorMention = target.isNpc ? `<@${enc.gmId}>` : (target.ownerId ? `<@${target.ownerId}>` : '');
          reactionPromptContent = `\n${reactorMention} **${target.name}** may have a reaction available (e.g. Reactive Strike, Shield Block).`;
          reactionPromptRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`reaction_trigger_${target.name.replace(/[^a-zA-Z0-9]/g, '_')}`)
              .setLabel(`${target.name}: Trigger Reaction`)
              .setStyle(ButtonStyle.Primary)
              .setEmoji('🎲'),
            new ButtonBuilder()
              .setCustomId(`reaction_skip_${target.name.replace(/[^a-zA-Z0-9]/g, '_')}`)
              .setLabel('Skip')
              .setStyle(ButtonStyle.Secondary),
          );
        }
      }

      const showDamage = (degree === 'success' || degree === 'crit-success' || degree === null);
      const description = [
        attackLine,
        '',
        showDamage ? damageLine : null,
        outcomeLine,
        hpLine || null,
      ].filter(s => s !== null).join('\n');

      const embed = new EmbedBuilder()
        .setColor(0x8B0000)
        .setTitle(`${attacker.name} attacks with ${atk.name}!${traitsText}`)
        .setDescription(description)
        .setFooter({ text: `${atk.name} ${fmt(baseAttackBonus)} · ${atk.damage}` });

      const replyPayload = { embeds: [embed, ...(deathPayload?.embeds ?? [])].slice(0, 10) };
      let content = (mentionLine || '').trim();
      if (reactionPromptContent) content = (content + reactionPromptContent).trim();
      if (content) replyPayload.content = content;
      if (reactionPromptRow) replyPayload.components = [reactionPromptRow];

      await interaction.reply(replyPayload);
      await updateSummary(interaction.channel, enc);
      return;
    }

    if (sub === 'next') {
      if (userId !== enc.gmId) return interaction.reply({ content: '❌ Only the GM can advance turns.', ephemeral: true });
      if (enc.combatants.length === 0) return interaction.reply({ content: '❌ No combatants in the encounter yet.', ephemeral: true });

      // ca.processTurnTransition handles: persistent damage tick on outgoing
      // combatant, advanceTurn (effect duration ticks), MAP/reaction reset, and
      // recovery check on incoming combatant if dying.
      const result = ca.processTurnTransition(channelId);
      const current = result.current;
      const mention = current.isNpc ? `<@${enc.gmId}>` : `<@${current.ownerId}>`;

      // Diagnostic logging — helps us see what happened if auto-roll doesn't fire
      console.log(`[init next] Advanced to ${current.name} (isNpc=${current.isNpc}, hp=${current.hp}/${current.maxHp}, dying=${current.dying ?? 0}, wounded=${current.wounded ?? 0}). recoveryCheck=${result.recoveryCheck ? 'fired' : 'not-triggered'}`);

      const lines = [`▶ It's **${current.name}**'s turn! ${mention}`];

      // Show new round banner
      if (result.newRound) {
        lines.push(`**Round ${enc.round}** — all reactions refreshed.`);
      }

      // Show expired effects
      if (result.expiredEffects && result.expiredEffects.length > 0) {
        const expiredText = result.expiredEffects.map(x => `**${x.effect.name}** on **${x.combatantName}**`).join(', ');
        lines.push(`Expired: ${expiredText}`);
      }

      // Show persistent damage results from outgoing combatant
      if (result.persistentResults && result.persistentResults.length > 0) {
        for (const pr of result.persistentResults) {
          const flatStatus = pr.ended
            ? `*Flat check ${pr.flatRoll} ≥ ${pr.flatDc} — condition ends.*`
            : `*Flat check ${pr.flatRoll} < ${pr.flatDc} — persists.*`;
          const dyingTag = pr.died ? ' **Dead!**' : pr.wentDown ? ` (Dying ${pr.dying})` : '';
          lines.push(`**${pr.name}** persistent: ${pr.damageDice}[${pr.damageRolls.join(',')}] = ${pr.damage} ${pr.damageType} damage${dyingTag}\n${flatStatus}`);
        }
      }

      // Hint to the GM if the combatant is dying but the check didn't fire
      // (shouldn't happen, but diagnostic aid for the user)
      if ((current.dying ?? 0) > 0 && !result.recoveryCheck) {
        lines.push(`*${current.name} is Dying ${current.dying} but no recovery check auto-rolled. Use \`/init recovery name:${current.name}\` to force a roll.*`);
      }

      // ── Action economy at start of turn ────────────────────────────
      // PF2e: Slowed N → lose N actions. Quickened → +1 action.
      // Stunned N → lose N actions, then reduce stunned by N (capped at 0).
      // We surface this immediately so the player and GM see it on turn start.
      // Stunned auto-decrements after announcing.
      if (current.effects && current.effects.length > 0) {
        const slowed = current.effects.find(e => e.presetKey === 'slowed');
        const quickened = current.effects.find(e => e.presetKey === 'quickened');
        const stunned = current.effects.find(e => e.presetKey === 'stunned');

        const actionNotes = [];
        let netActions = 3;
        if (slowed?.value) {
          netActions -= slowed.value;
          actionNotes.push(`Slowed ${slowed.value}`);
        }
        if (stunned?.value) {
          const lost = Math.min(stunned.value, netActions);
          netActions -= lost;
          // Auto-decrement stunned by the actions lost (PF2e RAW)
          const stunnedRemaining = Math.max(0, stunned.value - lost);
          if (stunnedRemaining === 0) {
            // Remove the stunned effect entirely
            current.effects = current.effects.filter(e => e !== stunned);
            actionNotes.push(`Stunned ${stunned.value} (lost ${lost} actions; Stunned cleared)`);
          } else {
            stunned.value = stunnedRemaining;
            actionNotes.push(`Stunned ${stunned.value + lost} → ${stunnedRemaining} (lost ${lost} actions)`);
          }
        }
        if (quickened) {
          netActions += 1;
          actionNotes.push('Quickened (+1 action)');
        }
        if (actionNotes.length > 0) {
          netActions = Math.max(0, netActions);
          lines.push(`⚡ **${current.name}** has ${netActions} action${netActions === 1 ? '' : 's'} this turn — *${actionNotes.join(', ')}*`);
        }
      }

      const deathEmbeds = [];
      for (const pr of result.persistentResults ?? []) {
        const deathPayload = combatDeathPayload(pr);
        if (deathPayload?.embeds?.length) deathEmbeds.push(...deathPayload.embeds);
      }
      const replyPayload = { content: lines.join('\n') };
      if (result.recoveryCheck) {
        const payload = buildRecoveryCheckPayload(result.recoveryCheck, current);
        replyPayload.embeds = payload.embeds;
        if (payload.components.length) replyPayload.components = payload.components;
        const deathPayload = combatDeathPayload(result.recoveryCheck);
        if (deathPayload?.embeds?.length) deathEmbeds.push(...deathPayload.embeds);
      }
      if (deathEmbeds.length) replyPayload.embeds = [...(replyPayload.embeds ?? []), ...deathEmbeds].slice(0, 10);

      await interaction.reply(replyPayload);
      await updateSummary(interaction.channel, enc);
      return;
    }

    if (sub === 'list') {
      // /init list shows MORE detail than the pinned summary embed:
      // full effect descriptions (with modifiers and durations) and explicit
      // dying/wounded/doomed/unconscious flags. Useful for "what's actually
      // going on" mid-fight when the summary line is too compact.
      //
      // The summary part now uses pagination so big encounters don't blow
      // past Discord's description limit. /init list shows the natural page
      // (current turn) just like the pinned summary.
      const { embed: summaryEmbed, page, totalPages } = buildInitiativeEmbed(enc);
      const detailLines = [];
      for (const c of enc.combatants) {
        const flags = [];
        if ((c.dying ?? 0) > 0)   flags.push(`💀 Dying ${c.dying}`);
        if ((c.wounded ?? 0) > 0) flags.push(`🩸 Wounded ${c.wounded}`);
        if ((c.doomed ?? 0) > 0)  flags.push(`⚰️ Doomed ${c.doomed}`);
        if (c.unconscious === true && (c.dying ?? 0) === 0) flags.push('😴 Unconscious');
        const flagText = flags.length > 0 ? ` · ${flags.join(' · ')}` : '';

        const effectDetails = (c.effects ?? []).map(e => {
          if (e.kind === 'persistent-damage' || e.modifiers?.kind === 'persistent-damage') {
            const dice = e.modifiers?.dice ?? e.dice ?? '?';
            const dtype = e.modifiers?.damageType ?? e.damageType ?? 'damage';
            const dc = e.modifiers?.dc ?? e.dc ?? 15;
            return `   🩸 Persistent ${dice} ${dtype} (DC ${dc} flat to end)`;
          }
          const value = e.value ?? '';
          const dur = e.duration !== null && e.duration !== undefined ? ` — ${e.duration}r left` : '';
          const desc = e.modifiers?.description ? ` *(${e.modifiers.description})*` : '';
          return `   • **${e.name}${value ? ' ' + value : ''}**${dur}${desc}`;
        });
        if (flags.length > 0 || effectDetails.length > 0) {
          detailLines.push(`**${c.name}**${flagText}\n${effectDetails.join('\n')}`.trim());
        }
      }
      const buttons = buildInitiativeButtons(channelId, page, totalPages);
      const replyPayload = { embeds: [summaryEmbed] };
      if (buttons) replyPayload.components = [buttons];
      if (detailLines.length > 0) {
        const detailEmbed = new EmbedBuilder()
          .setColor(0x9B59B6)
          .setTitle('🌀 Active Effects & Conditions')
          .setDescription(detailLines.join('\n\n').slice(0, 4000));
        replyPayload.embeds.push(detailEmbed);
      }
      return interaction.reply(replyPayload);
    }

    if (sub === 'hp') {
      const name = interaction.options.getString('name');
      const change = interaction.options.getInteger('change');
      const combatant = enc.combatants.find(x => x.name.toLowerCase() === name.toLowerCase());
      if (!combatant) return interaction.reply({ content: `❌ No combatant named "${name}".`, ephemeral: true });
      if (combatant.ownerId !== userId && enc.gmId !== userId) return interaction.reply({ content: '❌ You can only modify HP for your own character (or any, if GM).', ephemeral: true });

      // Use ca.applyHpChange so dying/wounded transitions are handled automatically.
      const result = ca.applyHpChange(channelId, name, change);
      const verb = change >= 0 ? 'healed' : 'took';
      const amount = Math.abs(change);
      const dyingNote = result?.displaySuffix ?? '';
      await interaction.reply({
        content: `❤️ **${combatant.name}** ${verb} ${amount} → ${combatant.hp}/${combatant.maxHp} HP${dyingNote}`,
        ...(combatDeathPayload(result) ?? {}),
      });
      await updateSummary(interaction.channel, enc);
      return;
    }

    if (sub === 'remove') {
      const name = interaction.options.getString('name');
      const result = removeCombatant(channelId, name);
      if (!result) return interaction.reply({ content: `❌ No combatant named "${name}".`, ephemeral: true });
      await interaction.reply(`🗑️ Removed **${name}** from initiative.`);
      await updateSummary(interaction.channel, enc);
      return;
    }

    if (sub === 'effect') {
      const targetName = interaction.options.getString('target');
      const effectName = interaction.options.getString('name');
      const value = interaction.options.getInteger('value');
      const duration = interaction.options.getInteger('duration');

      const target = findCombatant(enc, targetName);
      if (!target) return interaction.reply({ content: `❌ No combatant named "${targetName}" in this encounter.`, ephemeral: true });

      const preset = getPreset(effectName);
      let effect;

      if (preset) {
        const modifiers = preset.build(value ?? 1);
        effect = {
          name: preset.name,
          value: preset.scaling ? (value ?? 1) : null,
          duration: duration ?? null,
          modifiers,
          isPreset: true,
          presetKey: preset.key,
          appliedBy: userId,
        };
      } else {
        const modifiers = {
          attackBonus: interaction.options.getInteger('attack_bonus') ?? 0,
          damageBonus: interaction.options.getInteger('damage_bonus') ?? 0,
          acBonus: interaction.options.getInteger('ac_bonus') ?? 0,
          saveBonus: interaction.options.getInteger('save_bonus') ?? 0,
          skillBonus: interaction.options.getInteger('skill_bonus') ?? 0,
          description: interaction.options.getString('description') ?? '(custom effect)',
        };
        effect = {
          name: effectName,
          value: value ?? null,
          duration: duration ?? null,
          modifiers,
          isPreset: false,
          presetKey: null,
          appliedBy: userId,
        };
      }

      const result = addEffect(channelId, target.name, effect);
      if (!result) return interaction.reply({ content: `❌ Failed to apply effect.`, ephemeral: true });

      // ── Sync core PF2e tracked-field conditions to the combatant ─────
      // Doomed and Wounded need to be on the combatant directly (not just in
      // the effects array) because combatAutomation reads them for dying math.
      // Setting these via /init effect is the same as setting them via a
      // dedicated subcommand — we just keep the surface small.
      if (preset?.key === 'doomed') {
        target.doomed = effect.value ?? 1;
      } else if (preset?.key === 'wounded') {
        target.wounded = effect.value ?? 1;
      } else if (preset?.key === 'unconscious') {
        target.unconscious = true;
      }

      const modLines = [];
      const m = effect.modifiers;
      if (m.attackBonus) modLines.push(`Attack: ${fmt(m.attackBonus)}`);
      if (m.damageBonus) modLines.push(`Damage: ${fmt(m.damageBonus)}`);
      if (m.acBonus)     modLines.push(`AC: ${fmt(m.acBonus)}`);
      if (m.saveBonus)   modLines.push(`Saves: ${fmt(m.saveBonus)}`);
      if (m.skillBonus)  modLines.push(`Skills: ${fmt(m.skillBonus)}`);

      const valueText = effect.value !== null ? ` ${effect.value}` : '';
      const durationText = effect.duration !== null ? ` for ${effect.duration} round${effect.duration === 1 ? '' : 's'}` : '';
      const replacedText = result.replaced ? ' (replaced existing)' : '';
      const modText = modLines.length > 0 ? `\n**Modifiers:** ${modLines.join(', ')}` : '';
      const descText = m.description ? `\n*${m.description}*` : '';

      await interaction.reply(`🌀 Applied **${effect.name}${valueText}** to **${target.name}**${durationText}${replacedText}${modText}${descText}`);
      await updateSummary(interaction.channel, enc);
      return;
    }

    if (sub === 'removeeffect') {
      const targetName = interaction.options.getString('target');
      const effectName = interaction.options.getString('name');

      const target = findCombatant(enc, targetName);
      if (!target) return interaction.reply({ content: `❌ No combatant named "${targetName}" in this encounter.`, ephemeral: true });

      const result = removeEffect(channelId, target.name, effectName);
      if (!result) return interaction.reply({ content: `❌ **${target.name}** doesn't have an effect named "${effectName}".`, ephemeral: true });

      // Sync PF2e tracked-field conditions when removing the effect.
      if (result.effect.presetKey === 'doomed')      target.doomed = 0;
      else if (result.effect.presetKey === 'wounded') target.wounded = 0;
      else if (result.effect.presetKey === 'unconscious') target.unconscious = false;

      await interaction.reply(`🧹 Removed **${result.effect.name}** from **${target.name}**.`);
      await updateSummary(interaction.channel, enc);
      return;
    }

    if (sub === 'effects') {
      const targetName = interaction.options.getString('target');
      const target = findCombatant(enc, targetName);
      if (!target) return interaction.reply({ content: `❌ No combatant named "${targetName}" in this encounter.`, ephemeral: true });

      if (!target.effects || target.effects.length === 0) return interaction.reply(`**${target.name}** has no active effects.`);

      const lines = target.effects.map(e => {
        const valueText = e.value !== null && e.value !== undefined ? ` ${e.value}` : '';
        const durationText = e.duration !== null && e.duration !== undefined ? ` — ${e.duration} round${e.duration === 1 ? '' : 's'} left` : ' — permanent';
        const desc = e.modifiers?.description ? `\n    *${e.modifiers.description}*` : '';
        return `• **${e.name}${valueText}**${durationText}${desc}`;
      });

      const embed = new EmbedBuilder()
        .setColor(0x9B59B6)
        .setTitle(`🌀 ${target.name}'s Active Effects`)
        .setDescription(lines.join('\n'));
      return interaction.reply({ embeds: [embed] });
    }

    if (sub === 'conditions') {
      const presets = listPresets();
      const scaling = presets.filter(p => p.scaling).map(p => p.name).sort();
      const flat = presets.filter(p => !p.scaling).map(p => p.name).sort();

      const embed = new EmbedBuilder()
        .setColor(0x9B59B6)
        .setTitle('🌀 Available PF2e Conditions')
        .setDescription('Use `/init effect target:<name> name:<condition>` to apply one. Conditions with values need the `value:` option (e.g. Frightened 2).')
        .addFields(
          { name: 'Scaling (need a value)', value: scaling.join(', '), inline: false },
          { name: 'Flat', value: flat.join(', '), inline: false },
          { name: 'Custom Effects', value: 'Use any name not in the list and provide your own `attack_bonus`, `damage_bonus`, `ac_bonus`, `save_bonus`, or `skill_bonus` options.', inline: false }
        );
      return interaction.reply({ embeds: [embed] });
    }

    if (sub === 'end') {
      if (userId !== enc.gmId) return interaction.reply({ content: '❌ Only the GM can end the encounter.', ephemeral: true });
      await clearSummary(interaction.channel, enc);
      deleteEncounter(channelId);
      return interaction.reply('🏁 Combat ended. Well fought!');
    }

    // ── /init move ──
    // Manual movement trigger for Attacks of Opportunity. Since the bot
    // doesn't know positioning, the GM/player calls this when someone
    // moves out of an enemy's reach. Bot prompts all combatants with
    // reactions available.
    if (sub === 'move') {
      const moverName = interaction.options.getString('name');
      const mover = enc.combatants.find(x => x.name.toLowerCase() === moverName.toLowerCase());
      if (!mover) return interaction.reply({ content: `❌ No combatant named "${moverName}".`, ephemeral: true });

      const reactors = ca.findPotentialReactors(channelId, moverName);
      if (reactors.length === 0) {
        return interaction.reply(`🏃 **${mover.name}** moves. No combatants have reactions available.`);
      }

      // Build a single message with one row per reactor (max 5 due to Discord button limit)
      const lines = [`🏃 **${mover.name}** moves — provoking attacks of opportunity?`];
      const components = [];
      for (const reactor of reactors.slice(0, 5)) {
        const reactorMention = reactor.isNpc ? `<@${enc.gmId}>` : (reactor.ownerId ? `<@${reactor.ownerId}>` : '');
        lines.push(`${reactorMention} **${reactor.name}** has a reaction available.`);
        const safeName = reactor.name.replace(/[^a-zA-Z0-9]/g, '_');
        components.push(new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`reaction_trigger_${safeName}`)
            .setLabel(`${reactor.name}: AoO`)
            .setStyle(ButtonStyle.Primary)
            .setEmoji('🎲'),
          new ButtonBuilder()
            .setCustomId(`reaction_skip_${safeName}`)
            .setLabel('Skip')
            .setStyle(ButtonStyle.Secondary),
        ));
      }
      if (reactors.length > 5) {
        lines.push(`*…and ${reactors.length - 5} more (Discord caps at 5 buttons per message). Use \`/init reaction\` for the rest.*`);
      }
      return interaction.reply({ content: lines.join('\n'), components });
    }

    // ── /init reaction ──
    // Manual reaction prompt for any edge case (Shield Block, Reactive Shield,
    // narrative triggers, etc.) Lets the GM ping a specific combatant.
    if (sub === 'reaction') {
      const reactorName = interaction.options.getString('name');
      const reason = interaction.options.getString('reason') ?? 'something just happened';
      const reactor = enc.combatants.find(x => x.name.toLowerCase() === reactorName.toLowerCase());
      if (!reactor) return interaction.reply({ content: `❌ No combatant named "${reactorName}".`, ephemeral: true });
      if (!ca.hasReactionAvailable(reactor)) {
        return interaction.reply({ content: `⚠️ **${reactor.name}** has already used their reaction this round (or is dying).`, ephemeral: true });
      }

      const reactorMention = reactor.isNpc ? `<@${enc.gmId}>` : (reactor.ownerId ? `<@${reactor.ownerId}>` : '');
      const safeName = reactor.name.replace(/[^a-zA-Z0-9]/g, '_');
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`reaction_trigger_${safeName}`)
          .setLabel(`${reactor.name}: Trigger Reaction`)
          .setStyle(ButtonStyle.Primary)
          .setEmoji('🎲'),
        new ButtonBuilder()
          .setCustomId(`reaction_skip_${safeName}`)
          .setLabel('Skip')
          .setStyle(ButtonStyle.Secondary),
      );
      return interaction.reply({
        content: `${reactorMention} ⤾ **${reactor.name}** — reaction prompt: *${reason}*`,
        components: [row],
      });
    }

    // ── /init damage ──
    // Manually trigger persistent damage roll for a combatant outside the
    // normal turn-end tick. Useful when a GM forgot to /init next or wants
    // to apply a one-off dot.
    if (sub === 'damage') {
      const targetName = interaction.options.getString('name');
      const target = enc.combatants.find(x => x.name.toLowerCase() === targetName.toLowerCase());
      if (!target) return interaction.reply({ content: `❌ No combatant named "${targetName}".`, ephemeral: true });
      const persistentResults = ca.tickPersistentDamage(channelId, target.name);
      if (persistentResults.length === 0) {
        return interaction.reply({ content: `**${target.name}** has no persistent damage to roll.`, ephemeral: true });
      }
      const lines = [`🩸 Manually rolling persistent damage on **${target.name}**:`];
      const deathEmbeds = [];
      for (const pr of persistentResults) {
        const flatStatus = pr.ended
          ? `🩹 *Flat check ${pr.flatRoll} ≥ ${pr.flatDc} — condition ends.*`
          : `🔁 *Flat check ${pr.flatRoll} < ${pr.flatDc} — persists.*`;
        const dyingTag = pr.died ? ' ☠️ **Dead!**' : pr.wentDown ? ` 💀 (Dying ${pr.dying})` : '';
        lines.push(`**${pr.name}**: ${pr.damageDice}[${pr.damageRolls.join(',')}] = ${pr.damage} ${pr.damageType}${dyingTag}\n${flatStatus}`);
        const deathPayload = combatDeathPayload(pr);
        if (deathPayload?.embeds?.length) deathEmbeds.push(...deathPayload.embeds);
      }
      const replyPayload = { content: lines.join('\n') };
      if (deathEmbeds.length) replyPayload.embeds = deathEmbeds.slice(0, 10);
      await interaction.reply(replyPayload);
      await updateSummary(interaction.channel, enc);
      return;
    }

    // ── /init dying ──
    // Manually set a combatant's dying value (override the auto-applied value
    // for cases like a critical effect that bumps dying directly, or a GM
    // marking someone dying who isn't tracked through normal damage).
    //
    // PF2e RAW: setting dying to 0 from above 0 does NOT regain HP — the character
    // remains unconscious at 0 HP until something heals them. We follow RAW.
    if (sub === 'dying') {
      if (userId !== enc.gmId) return interaction.reply({ content: '❌ Only the GM can override dying values.', ephemeral: true });
      const targetName = interaction.options.getString('name');
      const value = interaction.options.getInteger('value');
      const target = enc.combatants.find(x => x.name.toLowerCase() === targetName.toLowerCase());
      if (!target) return interaction.reply({ content: `❌ No combatant named "${targetName}".`, ephemeral: true });
      if (value < 0 || value > 4) return interaction.reply({ content: '❌ Dying value must be 0–4.', ephemeral: true });

      const maxDying = Math.max(1, 4 - (target.doomed ?? 0));
      const before = target.dying ?? 0;
      target.dying = value;
      let extra = '';
      if (value === 0 && before > 0) {
        // Recovered from dying — gain Wounded 1 (or +1 if already wounded).
        // Per RAW, do NOT auto-restore HP; the character is unconscious at 0 HP.
        target.wounded = (target.wounded ?? 0) + 1;
        if ((target.hp ?? 0) <= 0) {
          target.unconscious = true;
          extra = ` ✨ Recovered from dying (now Wounded ${target.wounded}, still unconscious at 0 HP — needs healing to wake)`;
        } else {
          target.unconscious = false;
          extra = ` ✨ Recovered from dying (now Wounded ${target.wounded})`;
        }
      } else if (value >= maxDying) {
        target.dying = maxDying;
        extra = target.doomed > 0
          ? ` ☠️ **Dead!** (Doomed ${target.doomed} → death at Dying ${maxDying})`
          : ' ☠️ **Dead!**';
      }
      const deathPayload = value >= maxDying ? combatDeathPayload({ died: true, name: target.name }) : null;
      if (value >= maxDying) removeCombatant(channelId, target.name);
      await interaction.reply({
        content: `💀 **${target.name}** dying set to ${value} (was ${before}).${extra}`,
        ...(deathPayload ?? {}),
      });
      await updateSummary(interaction.channel, enc);
      return;
    }

    // ── /init recovery ──
    // Manually force a recovery check roll for a dying combatant. Useful as a
    // reliability backup when the auto-roll on turn start doesn't fire, or to
    // force an off-turn recovery check (e.g. "the party just stopped combat
    // to stabilize the fallen; everyone dying rolls now"). The roll rules and
    // display are identical to the auto-rolled version, and the Hero Point
    // reroll button is available.
    if (sub === 'recovery') {
      const targetName = interaction.options.getString('name');
      const target = enc.combatants.find(x => x.name.toLowerCase() === targetName.toLowerCase());
      if (!target) return interaction.reply({ content: `❌ No combatant named "${targetName}".`, ephemeral: true });

      // Permission: GM can roll for anyone; players can only roll for their own PC
      const isOwner = !target.isNpc && interaction.user.id === target.ownerId;
      const isGm = interaction.user.id === enc.gmId;
      if (!isOwner && !isGm) {
        return interaction.reply({ content: `❌ Only ${target.isNpc ? 'the GM' : 'the combatant\'s owner (or GM)'} can roll recovery for **${target.name}**.`, ephemeral: true });
      }

      if ((target.dying ?? 0) <= 0) {
        return interaction.reply({ content: `❌ **${target.name}** isn't dying (Dying ${target.dying ?? 0}). No recovery check needed.\n\n*If they SHOULD be dying, a GM can use \`/init dying name:${target.name} value:1\` to set it.*`, ephemeral: true });
      }

      console.log(`[init recovery] Manual recovery check for ${target.name} (dying=${target.dying}, wounded=${target.wounded ?? 0})`);

      const rc = ca.rollRecoveryCheck(channelId, target.name);
      if (!rc) {
        return interaction.reply({ content: `❌ Failed to roll recovery check. (This shouldn't happen — please report.)`, ephemeral: true });
      }

      const payload = buildRecoveryCheckPayload(rc, target);
      const deathPayload = combatDeathPayload(rc);
      if (deathPayload?.embeds?.length) payload.embeds = [...(payload.embeds ?? []), ...deathPayload.embeds].slice(0, 10);
      await interaction.reply(payload);
      await updateSummary(interaction.channel, enc);
      return;
    }

    // ── /init delay ──
    // PF2e Player Core p. 469: When it's your turn, you may take the Delay
    // action. Your turn ends, you're set aside, and you can rejoin at any
    // point before your next normal turn. Implemented as a flag on the
    // combatant; turn rotation skips delayed combatants.
    //
    // NOTE: Until this subcommand is registered with Discord (via deploy.js
    // or the Dev Portal), users won't see it. The handler is here and ready.
    if (sub === 'delay') {
      const current = enc.combatants[enc.turnIndex];
      if (!current) return interaction.reply({ content: '❌ No active combatant to delay.', ephemeral: true });
      // Permission: only the current combatant's owner (or GM) can delay
      const isOwner = !current.isNpc && interaction.user.id === current.ownerId;
      const isGm = interaction.user.id === enc.gmId;
      if (!isOwner && !isGm) {
        return interaction.reply({ content: `❌ Only ${current.name}'s controller (or GM) can have them delay.`, ephemeral: true });
      }
      if (current.delayed) {
        return interaction.reply({ content: `❌ **${current.name}** is already delayed.`, ephemeral: true });
      }

      // Use encounters.js delay function (also advances turn past delayed combatants)
      const result = delayCombatant(channelId);
      if (!result) return interaction.reply({ content: '❌ Could not delay.', ephemeral: true });

      const newCurrent = result.current;
      const newMention = newCurrent.isNpc ? `<@${enc.gmId}>` : `<@${newCurrent.ownerId}>`;
      const lines = [
        `⏸️ **${current.name}** delays. They'll rejoin with \`/init rejoin\`.`,
        `🎯 It's **${newCurrent.name}**'s turn! ${newMention}`,
      ];
      // Show expired effects on the new current combatant
      if (result.expiredEffects && result.expiredEffects.length > 0) {
        const expiredText = result.expiredEffects.map(x => `**${x.effect.name}** on **${x.combatantName}**`).join(', ');
        lines.push(`⏳ Expired: ${expiredText}`);
      }
      await interaction.reply(lines.join('\n'));
      await updateSummary(interaction.channel, enc);
      return;
    }

    // ── /init rejoin ──
    // A delayed combatant returns to initiative. Optional `before:` parameter
    // sets initiative just before the named target. Without it, they rejoin
    // immediately before the current combatant (taking their turn now).
    if (sub === 'rejoin') {
      const rejoinerName = interaction.options.getString('name');
      const rejoiner = enc.combatants.find(c => c.name.toLowerCase() === rejoinerName.toLowerCase());
      if (!rejoiner) return interaction.reply({ content: `❌ No combatant named "${rejoinerName}".`, ephemeral: true });
      if (!rejoiner.delayed) {
        return interaction.reply({ content: `❌ **${rejoiner.name}** isn't delayed. (Are they trying to use /init next?)`, ephemeral: true });
      }
      const isOwner = !rejoiner.isNpc && interaction.user.id === rejoiner.ownerId;
      const isGm = interaction.user.id === enc.gmId;
      if (!isOwner && !isGm) {
        return interaction.reply({ content: `❌ Only ${rejoiner.name}'s controller (or GM) can have them rejoin.`, ephemeral: true });
      }

      const beforeName = interaction.options.getString('target');
      const result = rejoinFromDelay(channelId, rejoiner.name, beforeName);
      if (!result || !result.ok) {
        const reason = result?.reason === 'before-not-found'
          ? `❌ No combatant named "${beforeName}" to rejoin before.`
          : `❌ Could not rejoin.`;
        return interaction.reply({ content: reason, ephemeral: true });
      }

      const mention = rejoiner.isNpc ? `<@${enc.gmId}>` : `<@${rejoiner.ownerId}>`;
      const beforeText = beforeName ? ` (just before **${beforeName}**)` : '';
      await interaction.reply(`▶️ **${rejoiner.name}** rejoins initiative at **${result.newInit.toFixed(3)}**${beforeText}. ${mention}, take your turn!`);
      await updateSummary(interaction.channel, enc);
      return;
    }
}

module.exports = {
  name: 'init',
  execute,
};
