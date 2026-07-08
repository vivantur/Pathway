const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const monsterState = require('../../state/monster');
const { rollDamageExpression, determineDegreeOfSuccess, calculateMap } = require('../../lib/dice');
const { fmt } = require('../../lib/format');
const { sumEffectModifiers } = require('../../rules/combatEffects');
const { combatDeathPayload, combatDyingSuffix } = require('../../discord/rollEmbeds');
const combatV2State = require('../../rules/combatV2/state');
const combatV2Rolls = require('../../rules/combatV2/rolls');
const { updateCombatV2Summary } = require('../init/combatV2Summary');
const { findMonster } = require('../monster/lookup');
const {
  monsterKey,
  getMonsterEdit,
  applyMonsterEdits,
  applyMonsterAttackLibrary,
} = require('../monster/helpers');

function loadMonsterAttacks() {
  return monsterState.getAllAttacks();
}

async function saveMonsterAttacks(data) {
  await monsterState.saveAllAttacks(data);
}

function getGuildMonsters(store, guildId) {
  if (!store[guildId]) store[guildId] = {};
  return store[guildId];
}

function resolveMonsterDisplayName(inputName) {
  try {
    const hit = findMonster(inputName);
    if (hit.monster) return hit.monster.name;
  } catch {
    // findMonster may be unavailable during module initialization.
  }
  return inputName;
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

function normalizeAttackForRolling(attack) {
  if (!attack || typeof attack !== 'object') return attack;

  const bonusRaw = attack.bonus
    ?? attack.to_hit
    ?? attack.toHit
    ?? attack.attack_bonus
    ?? attack.attackBonus
    ?? attack.attack;
  const bonus = Number.isFinite(Number(bonusRaw)) ? Number(bonusRaw) : 0;

  // Parse the damage string. Examples we need to handle:
  //   "1d8+7 slashing"
  //   "2d6 fire"
  //   "1d8+3 piercing plus Knockdown"          ← extra is non-dice text
  //   "1d6+3 bludgeoning plus 1d6 fire"        ← extra is dice + type
  //   "4d12+16 slashing plus 1d6 cold and Grotesque Gift"
  const dmgRaw = String(
    attack.damage
      ?? attack.damageDice
      ?? attack.damage_dice
      ?? attack.die
      ?? ''
  ).trim();
  // Match the leading dice expression + one word (the damage type).
  // Pattern: digits + 'd' + digits + optional +/-N, then a single word.
  const mainMatch = dmgRaw.match(/^(\d+d\d+(?:[+-]\d+)?)\s+([a-z]+)/i);
  let mainDamage = attack.damageDice ?? attack.damage_dice ?? attack.die ?? null;
  let mainType = attack.damageType ?? attack.damage_type ?? null;
  let trailing = '';
  if (mainMatch) {
    mainDamage = mainMatch[1];
    mainType = mainMatch[2].toLowerCase();
    trailing = dmgRaw.slice(mainMatch[0].length).trim();
  } else if (/^\d+d\d+(?:[+-]\d+)?$/i.test(dmgRaw)) {
    mainDamage = dmgRaw;
  } else {
    // Couldn't parse — best effort: pass the whole string as damage and
    // leave damageType unset. Rolling will still attempt to roll.
    mainDamage = dmgRaw || '0';
    mainType = mainType ?? '';
  }

  // Look for "plus <dice> <type>" trailing fragment for extra damage.
  // We only auto-extract dice-typed extras; non-dice "plus Knockdown" /
  // "plus Grotesque Gift" type fragments are ability triggers the GM
  // narrates manually — we don't synthesize a roll for them.
  let extraDamage = null;
  let extraType = null;
  if (trailing) {
    const extraMatch = trailing.match(/plus\s+(\d+d\d+(?:[+-]\d+)?)\s+([a-z]+)/i);
    if (extraMatch) {
      extraDamage = extraMatch[1];
      extraType = extraMatch[2].toLowerCase();
    }
  }

  const rawTraits = attack.traits ?? [];
  const traits = Array.isArray(rawTraits)
    ? rawTraits
    : String(rawTraits).split(',').map(t => t.trim()).filter(Boolean);

  return {
    ...attack,
    kind: attack.kind ?? 'strike',
    name: attack.name,
    bonus,
    damage: mainDamage,
    damageType: mainType,
    traits,
    extraDamage,
    extraType,
    // Carry through some metadata in case display code wants it
    type: attack.type,
    _normalized: true,
  };
}

async function execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guildId;
    if (!guildId) return interaction.reply({ content: '❌ `/monsterattack` only works in a server, not in DMs.', ephemeral: true });

    // ── add (strike) ──
    if (sub === 'add' || sub === 'addspell') {
      const monsterInput = interaction.options.getString('monster');
      const attackName = interaction.options.getString('attack')?.trim();
      const bonus = interaction.options.getInteger('bonus');
      const damage = interaction.options.getString('damage')?.trim();
      const damageType = (interaction.options.getString('type') ?? 'damage').toLowerCase();
      if (!attackName || !damage) return interaction.reply({ content: '❌ Both `attack` (name) and `damage` are required.', ephemeral: true });
      const traitsRaw = sub === 'add' ? interaction.options.getString('traits') : null;
      const extraDamage = sub === 'add' ? interaction.options.getString('extra_damage') : null;
      const extraType = sub === 'add' ? interaction.options.getString('extra_type') : null;

      if (!rollDamageExpression(damage)) return interaction.reply({ content: `❌ Couldn't parse damage "${damage}". Use something like \`1d6+2\` or \`2d8+4\`.`, ephemeral: true });
      if (extraDamage && !rollDamageExpression(extraDamage)) return interaction.reply({ content: `❌ Couldn't parse extra damage "${extraDamage}". Use something like \`1d6\`.`, ephemeral: true });

      const traits = traitsRaw
        ? traitsRaw.split(',').map(t => t.trim().toLowerCase()).filter(Boolean)
        : [];

      const store = loadMonsterAttacks();
      const guild = getGuildMonsters(store, guildId);
      const displayName = resolveMonsterDisplayName(monsterInput);
      const key = monsterKey(displayName);
      if (!guild[key]) guild[key] = { displayName, attacks: [] };
      // Replace existing attack with same name
      const existingIdx = guild[key].attacks.findIndex(a => a.name.toLowerCase() === attackName.toLowerCase());
      const entry = {
        name: attackName,
        kind: sub === 'addspell' ? 'spell' : 'strike',
        bonus,
        damage,
        damageType,
        traits,
        extraDamage: extraDamage || null,
        extraType: extraType ? extraType.toLowerCase() : null
      };
      if (existingIdx >= 0) guild[key].attacks[existingIdx] = entry;
      else guild[key].attacks.push(entry);
      await saveMonsterAttacks(store);
      const verb = existingIdx >= 0 ? 'Updated' : 'Saved';
      const kindLabel = sub === 'addspell' ? 'spell attack' : 'strike';
      const traitText = traits.length ? ` *(${traits.join(', ')})*` : '';
      return interaction.reply({ content: `✅ ${verb} ${kindLabel} **${attackName}** on **${displayName}**: ${fmt(bonus)}, ${damage} ${damageType}${traitText}`, ephemeral: true });
    }

    // ── addsave ──
    if (sub === 'addsave') {
      const monsterInput = interaction.options.getString('monster');
      const attackName = interaction.options.getString('attack')?.trim();
      const saveType = interaction.options.getString('save');
      const dc = interaction.options.getInteger('dc');
      const damage = interaction.options.getString('damage')?.trim();
      const damageType = (interaction.options.getString('type') ?? 'damage').toLowerCase();
      if (!attackName || !damage) return interaction.reply({ content: '❌ Both `attack` (name) and `damage` are required.', ephemeral: true });
      if (!rollDamageExpression(damage)) return interaction.reply({ content: `❌ Couldn't parse damage "${damage}". Use something like \`6d6\` or \`4d10+5\`.`, ephemeral: true });

      const store = loadMonsterAttacks();
      const guild = getGuildMonsters(store, guildId);
      const displayName = resolveMonsterDisplayName(monsterInput);
      const key = monsterKey(displayName);
      if (!guild[key]) guild[key] = { displayName, attacks: [] };
      const existingIdx = guild[key].attacks.findIndex(a => a.name.toLowerCase() === attackName.toLowerCase());
      const entry = { name: attackName, kind: 'save', saveType, saveDC: dc, damage, damageType };
      if (existingIdx >= 0) guild[key].attacks[existingIdx] = entry;
      else guild[key].attacks.push(entry);
      await saveMonsterAttacks(store);
      const verb = existingIdx >= 0 ? 'Updated' : 'Saved';
      return interaction.reply({ content: `✅ ${verb} save attack **${attackName}** on **${displayName}**: DC ${dc} ${saveType}, ${damage} ${damageType}`, ephemeral: true });
    }

    // ── remove ──
    if (sub === 'remove') {
      const monsterInput = interaction.options.getString('monster');
      const attackName = interaction.options.getString('attack')?.trim();
      if (!attackName) return interaction.reply({ content: '❌ An `attack` name is required.', ephemeral: true });
      const store = loadMonsterAttacks();
      const guild = getGuildMonsters(store, guildId);
      const displayName = resolveMonsterDisplayName(monsterInput);
      const key = monsterKey(displayName);
      if (!guild[key]) return interaction.reply({ content: `❌ No saved attacks for **${displayName}**.`, ephemeral: true });
      const idx = guild[key].attacks.findIndex(a => a.name.toLowerCase() === attackName.toLowerCase());
      if (idx < 0) return interaction.reply({ content: `❌ **${displayName}** has no attack named "${attackName}".`, ephemeral: true });
      const removed = guild[key].attacks.splice(idx, 1)[0];
      if (guild[key].attacks.length === 0) delete guild[key];
      await saveMonsterAttacks(store);
      return interaction.reply({ content: `🗑️ Removed **${removed.name}** from **${displayName}**.`, ephemeral: true });
    }

    // ── clear ──
    if (sub === 'clear') {
      const monsterInput = interaction.options.getString('monster');
      const store = loadMonsterAttacks();
      const guild = getGuildMonsters(store, guildId);
      const displayName = resolveMonsterDisplayName(monsterInput);
      const key = monsterKey(displayName);
      if (!guild[key]) return interaction.reply({ content: `❌ No saved attacks for **${displayName}**.`, ephemeral: true });
      delete guild[key];
      await saveMonsterAttacks(store);
      return interaction.reply({ content: `🗑️ Cleared all attacks for **${displayName}**.`, ephemeral: true });
    }

    // ── list ──
    if (sub === 'list') {
      const monsterInput = interaction.options.getString('monster');
      const store = loadMonsterAttacks();
      const guild = getGuildMonsters(store, guildId);
      if (monsterInput) {
        const displayName = resolveMonsterDisplayName(monsterInput);
        const key = monsterKey(displayName);
        const libEntry = guild[key];

        // Pull bestiary attacks too (with library overlay applied so user
        // overrides show through). Without this, /m attack list would say
        // "no attacks" for canonical creatures like Aasimar Redeemer that
        // have built-in attacks in the bestiary.
        const { monster } = findMonster(displayName);
        let bestiaryAttacks = [];
        if (monster) {
          const edits = getMonsterEdit(guildId, monster.name);
          const edited = applyMonsterEdits(monster, edits);
          const withLibrary = applyMonsterAttackLibrary(edited, guildId);
          const rawAttacks = Array.isArray(withLibrary?.rich?.attacks) ? withLibrary.rich.attacks : [];
          // Normalize bestiary schema → rolling schema (kind/bonus/damage/type)
          bestiaryAttacks = rawAttacks.map(a => normalizeAttackForRolling(a));
        }
        const libAttacks = libEntry?.attacks ?? [];

        // Use bestiary list if available (already includes library overlay);
        // fall back to library-only for pure homebrew.
        const allAttacks = bestiaryAttacks.length > 0 ? bestiaryAttacks : libAttacks;

        if (allAttacks.length === 0) {
          return interaction.reply({
            content: `❌ No attacks for **${displayName}** in the bestiary or saved library.`,
            ephemeral: true,
          });
        }

        const embed = new EmbedBuilder()
          .setColor(0x8B0000)
          .setTitle(`${displayName} — Available Attacks`)
          .setFooter({ text: `${allAttacks.length} attack${allAttacks.length === 1 ? '' : 's'} · /m attack use to roll` });
        for (const a of allAttacks) {
          let line;
          if (a.kind === 'save') {
            line = `DC ${a.saveDC} ${a.saveType} · ${a.damage} ${a.damageType ?? 'damage'}`;
          } else {
            const traitText = a.traits?.length ? ` *(${a.traits.join(', ')})*` : '';
            const extra = a.extraDamage ? ` + ${a.extraDamage} ${a.extraType ?? ''}`.trimEnd() : '';
            line = `${fmt(a.bonus)} · ${a.damage} ${a.damageType ?? ''}${extra}${traitText}`;
          }
          embed.addFields({ name: a.name, value: line, inline: false });
        }
        return interaction.reply({ embeds: [embed] });
      }
      // List all monsters in the saved library (bestiary list is too big).
      const entries = Object.values(guild);
      if (entries.length === 0) return interaction.reply({ content: `📖 No saved monsters in the library yet.\n\nNote: Bestiary creatures already have their attacks built in — try \`/m attack use attacker:<combatant> monster:Goblin Warrior attack:dogslicer\` directly.\n\nUse \`/m attack add\` to save custom or homebrew attacks.`, ephemeral: true });
      entries.sort((a, b) => a.displayName.localeCompare(b.displayName));
      const lines = entries.map(e => `• **${e.displayName}** — ${e.attacks.length} custom attack${e.attacks.length === 1 ? '' : 's'}`);
      const embed = new EmbedBuilder()
        .setColor(0x8B0000)
        .setTitle(`Saved Library (${entries.length} monster${entries.length === 1 ? '' : 's'})`)
        .setDescription(lines.join('\n'))
        .setFooter({ text: 'These are CUSTOM saved attacks. Bestiary creatures have their attacks built-in.' });
      return interaction.reply({ embeds: [embed] });
    }

    // ── use ──
    // Designed to work in TWO modes:
    //
    //   1. INSIDE initiative (encounter active in this channel):
    //      attacker is matched against combatants. MAP, effect modifiers, and
    //      target AC/effects all flow through. /init attack-style behavior.
    //
    //   2. OUTSIDE initiative (no encounter, or attacker not in encounter):
    //      attacker is treated as a bestiary name. Standalone roll — no MAP,
    //      no per-combatant effect modifiers. target can be a PC combatant
    //      name (if encounter exists) or omitted (just shows raw attack roll
    //      and damage; the GM narrates).
    //
    // The `monster` parameter is OPTIONAL. When omitted, we look up the
    // attacker's bestiary entry (so the common case is just /m attack use
    // attacker:Aasimar Redeemer attack:longsword). Provide `monster` only
    // when you want to use a DIFFERENT monster's attack library (rare).
    if (sub === 'use') {
      const attackerName = interaction.options.getString('attacker');
      const monsterInputRaw = interaction.options.getString('monster'); // may be null
      const attackQuery = interaction.options.getString('attack');
      const targetName = interaction.options.getString('target');
      const explicitMap = interaction.options.getInteger('map'); // null if unset

      const channelId = interaction.channel.id;
      const enc = combatV2State.getEncounter(channelId);

      // Try to find the attacker as a combatant first. If we find them,
      // we're in "init mode" — MAP and effects flow. Otherwise we treat the
      // attacker name as a bestiary lookup for "out of init" mode.
      const attacker = enc ? combatV2State.findCombatant(enc, attackerName) : null;
      const inInit = !!attacker;

      // Resolve which monster's attack library to consult:
      //   • If `monster` was provided explicitly → use that name.
      //   • Else if attacker is a combatant with a bestiaryKey → use that.
      //   • Else → fall back to the attacker name itself.
      const lookupName = monsterInputRaw ?? attacker?.bestiaryKey ?? attackerName;
      const displayName = resolveMonsterDisplayName(lookupName);
      const { monster } = findMonster(displayName);

      // Collect bestiary built-in attacks (already merged with library overlay).
      // The bestiary parser stores attacks in a DIFFERENT shape than the
      // library: `{ type, name, to_hit, traits, damage: "1d8+7 slashing plus..." }`
      // vs the library's `{ kind, name, bonus, damage, damageType, ... }`.
      // We normalize bestiary attacks here so the strike/spell/save rolling
      // code below can treat them uniformly.
      let bestiaryAttacks = [];
      if (monster) {
        const edits = getMonsterEdit(guildId, monster.name);
        const edited = applyMonsterEdits(monster, edits);
        const withLibrary = applyMonsterAttackLibrary(edited, guildId);
        const rawAttacks = Array.isArray(withLibrary?.rich?.attacks) ? withLibrary.rich.attacks : [];
        bestiaryAttacks = rawAttacks.map(a => normalizeAttackForRolling(a));
      }
      // Library fallback for pure homebrew (monster not in bestiary). These
      // already have the right shape (kind/bonus/damage/damageType).
      const store = loadMonsterAttacks();
      const guild = getGuildMonsters(store, guildId);
      const libEntry = guild[monsterKey(displayName)];
      const libAttacks = libEntry?.attacks ?? [];
      const allAttacks = bestiaryAttacks.length > 0 ? bestiaryAttacks : libAttacks;

      if (allAttacks.length === 0) {
        return interaction.reply({
          content: `❌ **${displayName}** has no attacks in the bestiary or saved library. Use \`/m attack add\` to define one.`,
          ephemeral: true,
        });
      }

      // Find the requested attack: exact match → unambiguous substring.
      const q = String(attackQuery ?? '').toLowerCase().trim();
      let attack = allAttacks.find(a => String(a.name ?? '').toLowerCase() === q);
      if (!attack) {
        const partial = allAttacks.filter(a => String(a.name ?? '').toLowerCase().includes(q));
        if (partial.length === 1) attack = partial[0];
        else if (partial.length > 1) {
          return interaction.reply({
            content: `🔍 Multiple attacks match "${attackQuery}" on **${displayName}**: ${partial.map(a => `\`${a.name}\``).join(', ')}. Be more specific.`,
            ephemeral: true,
          });
        }
      }
      if (!attack) {
        const available = allAttacks.map(a => `\`${a.name}\``).join(', ');
        return interaction.reply({
          content: `❌ **${displayName}** has no attack matching "${attackQuery}".\nAvailable: ${available}`,
          ephemeral: true,
        });
      }

      // Resolve target: ONLY meaningful in init mode. Out of init, target is
      // just a label string we'll mention in the embed (or null if omitted).
      let target = null;
      if (targetName && enc) {
        target = combatV2State.findCombatant(enc, targetName);
        // If targetName was given but didn't match a combatant, don't error —
        // just treat it as a label. Useful for "/m attack use ... target:that goblin"
        // when describing things narratively.
      }

      // ─── Strike / Spell Attack ───
      if (attack.kind === 'strike' || attack.kind === 'spell') {
        // Out-of-init mode: target is optional. Without a target we just roll
        // attack + damage and let the GM narrate. With a target name (no
        // matching combatant) we use the name as a label.
        const attackerLabel = inInit ? attacker.name : displayName;
        const targetLabel = target?.name ?? targetName ?? null;

        const agile = attack.traits?.includes('agile') ?? false;
        // MAP only tracked in init mode. Out of init, MAP must be manually
        // specified or it defaults to 0 (first attack).
        let mapPenalty = 0, mapNoteText = null;
        if (explicitMap !== null) {
          mapPenalty = calculateMap(explicitMap, agile);
          mapNoteText = explicitMap > 0 ? `MAP ${mapPenalty} (manual)` : null;
        } else if (inInit) {
          const attacksSoFar = attacker.attacksThisTurn ?? 0;
          mapPenalty = combatV2Rolls.mapPenalty(attacksSoFar, agile);
          if (attacksSoFar === 1) mapNoteText = `Attack #2 this turn · MAP ${mapPenalty}${agile ? ' (agile)' : ''}`;
          else if (attacksSoFar >= 2) mapNoteText = `Attack #3+ this turn · MAP ${mapPenalty}${agile ? ' (agile)' : ''}`;
        }

        // Effect modifiers only apply in init (and only when both attacker
        // and target are combatants).
        const attackerMods = inInit ? sumEffectModifiers(attacker)
          : { attackBonus: 0, damageBonus: 0, acBonus: 0, activeEffects: [] };
        const targetMods = (inInit && target) ? sumEffectModifiers(target)
          : { attackBonus: 0, damageBonus: 0, acBonus: 0, activeEffects: [] };

        const dieRoll = Math.floor(Math.random() * 20) + 1;
        const attackTotal = dieRoll + attack.bonus + mapPenalty + attackerMods.attackBonus;
        const baseTargetAc = target?.ac ?? null;
        const effectiveTargetAc = baseTargetAc !== null ? baseTargetAc + targetMods.acBonus : null;
        const degree = effectiveTargetAc !== null ? determineDegreeOfSuccess(attackTotal, dieRoll, effectiveTargetAc) : null;

        const mapText = mapPenalty !== 0 ? ` ${mapPenalty}` : '';
        const attackerEffectText = formatEffectContributions(attackerMods.activeEffects, 'attack');
        const rollLabel = attack.kind === 'spell' ? 'Spell Attack Roll' : 'Attack Roll';
        let attackLine = `**${rollLabel}**\n1d20 (${dieRoll}) ${fmt(attack.bonus)}${mapText}${attackerEffectText ? ` ${fmt(attackerMods.attackBonus)}` : ''} = **${attackTotal}**`;
        if (mapNoteText) attackLine += `\n*${mapNoteText}*`;
        if (attackerEffectText) attackLine += `\n*${attackerEffectText.trim().slice(1, -1)}*`;
        if (dieRoll === 20) attackLine += '\nNatural 20!';
        if (dieRoll === 1)  attackLine += '\nNatural 1!';

        // Main damage
        const damageResult = rollDamageExpression(attack.damage);
        const totalDamageBonus = attackerMods.damageBonus;
        let mainDamage = Math.max(1, damageResult.total + totalDamageBonus);
        const damageContribText = formatEffectContributions(attackerMods.activeEffects, 'damage');
        let extraDamageResult = null;
        if (attack.extraDamage) extraDamageResult = rollDamageExpression(attack.extraDamage);

        let damageLine;
        let totalDealt;
        if (degree === 'crit-success') {
          mainDamage = mainDamage * 2;
          const extraDoubled = extraDamageResult ? extraDamageResult.total * 2 : 0;
          totalDealt = mainDamage + extraDoubled;
          damageLine = `**Damage (CRIT × 2)**\n${damageResult.display}${totalDamageBonus ? ` ${fmt(totalDamageBonus)}` : ''} = ${damageResult.total + totalDamageBonus} × 2 = **${mainDamage} ${attack.damageType ?? ''}**`.trimEnd();
          if (extraDamageResult) damageLine += `\n+ ${extraDamageResult.display} × 2 = **${extraDoubled} ${attack.extraType ?? ''}**`.trimEnd();
        } else {
          const extraBase = extraDamageResult ? extraDamageResult.total : 0;
          totalDealt = mainDamage + extraBase;
          damageLine = `**Damage**\n${damageResult.display}${totalDamageBonus ? ` ${fmt(totalDamageBonus)}` : ''} = **${mainDamage} ${attack.damageType ?? ''}**`.trimEnd();
          if (extraDamageResult) damageLine += `\n+ ${extraDamageResult.display} = **${extraBase} ${attack.extraType ?? ''}**`.trimEnd();
        }
        if (damageContribText) damageLine += `\n*${damageContribText.trim().slice(1, -1)}*`;

        const acBreakdown = baseTargetAc !== null && targetMods.acBonus !== 0
          ? ` (base ${baseTargetAc}${fmt(targetMods.acBonus)} from effects = ${effectiveTargetAc})`
          : '';
        let outcomeLine;
        if (targetLabel && degree !== null) {
          if (degree === 'crit-success')      outcomeLine = `**Critical Hit on ${targetLabel}!** AC ${effectiveTargetAc}${acBreakdown}`;
          else if (degree === 'success')      outcomeLine = `**Hit on ${targetLabel}!** AC ${effectiveTargetAc}${acBreakdown}`;
          else if (degree === 'failure')      outcomeLine = `**Miss on ${targetLabel}.** AC ${effectiveTargetAc}${acBreakdown}`;
          else                                outcomeLine = `**Critical Miss on ${targetLabel}.** AC ${effectiveTargetAc}${acBreakdown}`;
        } else if (targetLabel) {
          outcomeLine = `Attack against **${targetLabel}** (AC unknown — GM decides)`;
        } else {
          outcomeLine = `*GM: compare ${attackTotal} to target's AC.*`;
        }

        // HP application + mention only happens in init mode with a real target
        let hpLine = '';
        let deathPayload = null;
        let mentionLine = '';
        if (inInit && target && (degree === 'success' || degree === 'crit-success')) {
          // v2: respect the target's resistances/weaknesses/immunities,
          // per damage type (main and extra damage may differ).
          const mainDefended = combatV2Rolls.applyDefenses(mainDamage, attack.damageType, target);
          const extraDealt = totalDealt - mainDamage;
          const extraDefended = extraDealt > 0
            ? combatV2Rolls.applyDefenses(extraDealt, attack.extraType ?? attack.damageType, target)
            : { finalDamage: 0, notes: [] };
          const finalDealt = mainDefended.finalDamage + extraDefended.finalDamage;
          const defenseNotes = [...new Set([...mainDefended.notes, ...extraDefended.notes])];
          const defenseText = defenseNotes.length ? ` (${defenseNotes.join(', ')})` : '';
          const dmgResult = finalDealt > 0
            ? combatV2State.applyHp(channelId, target.id, -finalDealt)
            : null;
          const dyingNote = dmgResult ? combatDyingSuffix(dmgResult) : '';
          hpLine = target.isNpc
            ? `\n**${target.name}** took ${finalDealt} damage${defenseText}${dyingNote}`
            : `\n**${target.name}**: ${dmgResult?.combatant.hp ?? target.hp}/${target.maxHp} HP${defenseText}${dyingNote}`;
          deathPayload = dmgResult ? combatDeathPayload(dmgResult) : null;
        }
        if (inInit && target && !target.isNpc && target.ownerId) mentionLine = `<@${target.ownerId}>`;

        const showDamage = (degree === 'success' || degree === 'crit-success' || degree === null);
        const description = [attackLine, '', showDamage ? damageLine : null, outcomeLine, hpLine || null].filter(s => s !== null).join('\n');

        const traitFooter = attack.traits?.length ? ` · ${attack.traits.join(', ')}` : '';
        const titlePrefix = inInit ? attackerLabel : `${displayName}'s`;
        const embed = new EmbedBuilder()
          .setColor(attack.kind === 'spell' ? 0x9B59B6 : 0x8B0000)
          .setTitle(`${titlePrefix} ${attack.name}!`)
          .setDescription(description)
          .setFooter({ text: `${displayName}${traitFooter} · ${fmt(attack.bonus)} · ${attack.damage} ${attack.damageType ?? ''}`.trim() });

        const replyPayload = { embeds: [embed, ...(deathPayload?.embeds ?? [])].slice(0, 10) };
        if (mentionLine) replyPayload.content = mentionLine;
        await interaction.reply(replyPayload);
        // Record attack for MAP tracking (only in init, only if MAP wasn't manual)
        if (inInit && explicitMap === null) {
          attacker.attacksThisTurn = (attacker.attacksThisTurn ?? 0) + 1;
        }
        if (inInit) await updateCombatV2Summary(interaction.channel, combatV2State.getEncounter(channelId) ?? enc);
        return;
      }

      // ─── Save-based (breath weapon, aura, AoE) ───
      if (attack.kind === 'save') {
        const damageResult = rollDamageExpression(attack.damage);
        const saveDisplay = attack.saveType.charAt(0).toUpperCase() + attack.saveType.slice(1);
        // Target line works for both modes: combatant name, free text label, or no target.
        const targetText = target?.name ?? targetName ?? null;
        const targetLine = targetText ? ` against **${targetText}**` : '';
        const mentionLine = (target && !target.isNpc && target.ownerId) ? `<@${target.ownerId}>` : '';

        const description =
          `**${saveDisplay} Save DC ${attack.saveDC}**${targetLine}\n\n` +
          `**Damage Rolled:** ${damageResult.display} = **${damageResult.total} ${attack.damageType ?? ''}**\n\n` +
          `• Crit Success → **0** damage\n` +
          `• Success → **${Math.floor(damageResult.total / 2)}** damage (half)\n` +
          `• Failure → **${damageResult.total}** damage (full)\n` +
          `• Crit Failure → **${damageResult.total * 2}** damage (double)\n\n` +
          `*${targetText ?? 'Target(s)'}, tap the button below to roll your save — or use \`/save type:${attack.saveType}\` manually.*`;

        const titlePrefix = inInit ? attacker.name : displayName;
        const embed = new EmbedBuilder()
          .setColor(0xD35400)
          .setTitle(`${titlePrefix} uses ${attack.name}!`)
          .setDescription(description)
          .setFooter({ text: `${displayName} · DC ${attack.saveDC} ${attack.saveType} · ${attack.damage} ${attack.damageType ?? ''}`.trim() });

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`msave_${attack.saveType}_${attack.saveDC}`)
            .setLabel(`Roll ${saveDisplay} Save (DC ${attack.saveDC})`)
            .setStyle(ButtonStyle.Primary)
        );

        const replyPayload = { embeds: [embed], components: [row] };
        if (mentionLine) replyPayload.content = mentionLine;
        await interaction.reply(replyPayload);
        return;
      }

      return interaction.reply({ content: `❌ Unknown attack kind "${attack.kind}".`, ephemeral: true });
    }
}

module.exports = {
  name: 'monsterattack',
  execute,
  normalizeAttackForRolling,
};
