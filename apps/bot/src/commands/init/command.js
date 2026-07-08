const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const characterState = require('../../state/characters');
const combatV2State = require('../../rules/combatV2/state');
const combatV2Render = require('../../rules/combatV2/render');
const combatV2Rolls = require('../../rules/combatV2/rolls');
const { computeCharPerception } = require('../../rules/characterChecks');
const { getPreset, listPresets } = require('../../rules/effects');
const { fmt } = require('../../lib/format');
const { rollDamageExpression } = require('../../lib/dice');
const { combatDeathPayload, combatDyingSuffix } = require('../../discord/rollEmbeds');
const { scaleCompanion } = require('../companion/helpers');
const { findMonster } = require('../monster/lookup');
const { getMonsterEdit, applyMonsterEdits, applyMonsterAttackLibrary } = require('../monster/helpers');
const { normalizeAttackForRolling } = require('../monsterattack/command');
const { updateCombatV2Summary, clearCombatV2Summary } = require('./combatV2Summary');
const {
  combatV2Initiative,
  combatV2CharacterAttacks,
  combatV2CharacterSave,
  combatV2CharacterSkills,
  combatV2HasName,
} = require('./combatV2Actors');

// Legacy store — referenced ONLY by the /init start guard so a restored
// pre-v2 encounter can't be silently shadowed. Goes away with the legacy
// engine in the final consolidation step.
const { getEncounter } = require('../encounters');
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

function formatEffectContributions(effects, kind) {
  const contributions = effects
    .filter(e => {
      if (kind === 'attack') return e.attackBonus !== 0;
      if (kind === 'damage') return e.damageBonus !== 0;
      if (kind === 'ac') return e.acBonus !== 0;
      return false;
    })
    .map(e => {
      const val = kind === 'attack' ? e.attackBonus : kind === 'damage' ? e.damageBonus : e.acBonus;
      return `${e.name} ${fmt(val)}`;
    });
  return contributions.length > 0 ? ` (${contributions.join(', ')})` : '';
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

    // ── /init conditions ── (engine-independent: lists the preset library)
    if (sub === 'conditions') {
      const presets = listPresets();
      const scaling = presets.filter(p => p.scaling).map(p => p.name).sort();
      const flat = presets.filter(p => !p.scaling).map(p => p.name).sort();
      const embed = new EmbedBuilder()
        .setColor(0x9B59B6)
        .setTitle('🌀 Available PF2e Conditions')
        .setDescription('Use `/init effect add name:<combatant> effect:<condition>` to apply one. Conditions with values need the `value:` option (e.g. Frightened 2).')
        .addFields(
          { name: 'Scaling (need a value)', value: scaling.join(', '), inline: false },
          { name: 'Flat', value: flat.join(', '), inline: false },
          { name: 'Custom Effects', value: 'Use any name not in the list and provide your own bonus options.', inline: false }
        );
      return interaction.reply({ embeds: [embed] });
    }

    // ── /init damage ── manually roll persistent damage outside the turn tick
    if (v2Encounter && sub === 'damage') {
      const targetName = interaction.options.getString('name');
      const target = combatV2State.findCombatant(v2Encounter, targetName);
      if (!target) return interaction.reply({ content: `❌ No combatant matching "${targetName}".`, ephemeral: true });
      const persistentResults = combatV2State.tickPersistentDamage(channelId, target.id);
      if (persistentResults.length === 0) {
        return interaction.reply({ content: `**${target.name}** has no persistent damage to roll.`, ephemeral: true });
      }
      const lines = [`🩸 Manually rolling persistent damage on **${target.name}**:`];
      const deathEmbeds = [];
      for (const pr of persistentResults) {
        const flatStatus = pr.ended
          ? `🩹 *Flat check ${pr.flatRoll} ≥ ${pr.flatDc} — condition ends.*`
          : `🔁 *Flat check ${pr.flatRoll} < ${pr.flatDc} — persists.*`;
        const defenseNote = pr.defenseNotes?.length ? ` (${pr.defenseNotes.join(', ')})` : '';
        const dyingTag = pr.died ? ' ☠️ **Dead!**' : pr.wentDown ? ` 💀 (Dying ${pr.dying})` : '';
        lines.push(`**${pr.name}**: ${pr.damageDice}[${pr.damageRolls.join(', ')}] = ${pr.finalDamage} ${pr.damageType}${defenseNote}${dyingTag}\n${flatStatus}`);
        const deathPayload = combatDeathPayload(pr);
        if (deathPayload?.embeds?.length) deathEmbeds.push(...deathPayload.embeds);
      }
      const replyPayload = { content: lines.join('\n') };
      if (deathEmbeds.length) replyPayload.embeds = deathEmbeds.slice(0, 10);
      await interaction.reply(replyPayload);
      await updateCombatV2Summary(interaction.channel, combatV2State.getEncounter(channelId) ?? v2Encounter);
      return;
    }

    // ── /init dying ── GM override of a dying value (RAW: clearing dying
    // grants Wounded +1 and does NOT restore HP; max dying = death)
    if (v2Encounter && sub === 'dying') {
      if (userId !== v2Encounter.gmId) return interaction.reply({ content: '❌ Only the GM can override dying values.', ephemeral: true });
      const targetName = interaction.options.getString('name');
      const value = interaction.options.getInteger('value');
      if (value < 0 || value > 4) return interaction.reply({ content: '❌ Dying value must be 0–4.', ephemeral: true });
      let result;
      try {
        result = combatV2State.setDying(channelId, targetName, value);
      } catch (err) {
        return interaction.reply({ content: `❌ ${err.message}`, ephemeral: true });
      }
      let extra = '';
      if (result.recovered) {
        extra = result.combatant.unconscious
          ? ` ✨ Recovered from dying (now Wounded ${result.wounded}, still unconscious at 0 HP — needs healing to wake)`
          : ` ✨ Recovered from dying (now Wounded ${result.wounded})`;
      } else if (result.died) {
        extra = result.doomed > 0
          ? ` ☠️ **Dead!** (Doomed ${result.doomed} → death at Dying ${result.maxDying})`
          : ' ☠️ **Dead!**';
      }
      const deathPayload = result.died ? combatDeathPayload({ died: true, name: result.removed?.name ?? targetName }) : null;
      await interaction.reply({
        content: `💀 **${result.removed?.name ?? result.combatant.name}** dying set to ${result.value} (was ${result.before}).${extra}`,
        ...(deathPayload ?? {}),
      });
      await updateCombatV2Summary(interaction.channel, combatV2State.getEncounter(channelId) ?? v2Encounter);
      return;
    }

    return interaction.reply({
      content: 'No active combat v2 encounter here. Use `/init start`, then add combatants with `/init add`, `/init addmonster`, or `/i join`.',
      ephemeral: true,
    });
}

module.exports = {
  name: 'init',
  execute,
};
