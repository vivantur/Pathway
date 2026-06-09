const { EmbedBuilder } = require('discord.js');

const characterState = require('../../state/characters');
const charOverlay = require('../../rules/characterOverlay');
const ca = require('../../rules/combatAutomation');
const encounters = require('../encounters');
const { updateSummary } = require('../init/summary');
const { findSpell, spellAmbiguityMessage } = require('../spell/lookup');
const { normalizeSpell } = require('../spell/embed');
const { findMonster } = require('../monster/lookup');
const { fmt } = require('../../lib/format');
const {
  usesRankProficiencies,
  canonicalProfValue,
  calcCharacterProfNum,
} = require('../../rules/pf2eMath');
const { resolveSpellDamage, rollCompoundExpression } = require('../../lib/spellDamage');
const spellEffects = require('../../rules/spellEffects');
const { sumEffectModifiers } = require('../../rules/combatEffects');

function determineDegreeOfSuccess(attackTotal, dieRoll, targetAc) {
  if (targetAc === null || targetAc === undefined) return null;
  let degree;
  if (attackTotal >= targetAc + 10) degree = 'crit-success';
  else if (attackTotal >= targetAc) degree = 'success';
  else if (attackTotal <= targetAc - 10) degree = 'crit-failure';
  else degree = 'failure';
  if (dieRoll === 20) {
    degree = degree === 'crit-failure' ? 'failure' : degree === 'failure' ? 'success' : 'crit-success';
  } else if (dieRoll === 1) {
    degree = degree === 'crit-success' ? 'success' : degree === 'success' ? 'failure' : 'crit-failure';
  }
  return degree;
}

const DAMAGE_TYPE_EMOJI = {
  acid: '\u{1F9EA}', bleed: '\u{1FA78}', bludgeoning: '\u{1F528}', chaotic: '\u{1F300}', cold: '\u2744\uFE0F',
  electricity: '\u26A1', evil: '\u{1F608}', fire: '\u{1F525}', force: '\u2728', good: '\u{1F31F}',
  lawful: '\u2696\uFE0F', mental: '\u{1F9E0}', negative: '\u{1F480}', physical: '\u{1F4A5}', piercing: '\u{1F3F9}',
  poison: '\u2620\uFE0F', positive: '\u2728', slashing: '\u{1F5E1}\uFE0F', sonic: '\u{1F50A}', spirit: '\u{1F47B}',
  untyped: '\u2694\uFE0F', vitality: '\u{1F496}', void: '\u{1F573}\uFE0F',
};

function damageTypeEmoji(type) {
  if (!type) return '\u2694\uFE0F';
  const key = String(type).toLowerCase().trim();
  for (const [damageType, emoji] of Object.entries(DAMAGE_TYPE_EMOJI)) {
    if (key.includes(damageType)) return emoji;
  }
  return '\u2694\uFE0F';
}

function getTargetSaveBonus(target, saveType, loadedCharacters) {
  if (!target || !saveType) return null;
  const key = String(saveType).toLowerCase();
  const normalized = key.startsWith('fort') ? 'fort' : key.startsWith('ref') ? 'ref' : key.startsWith('will') ? 'will' : null;
  if (!normalized) return null;

  if (target.saveBonuses && target.saveBonuses[normalized] != null) {
    return { bonus: target.saveBonuses[normalized], source: 'stored' };
  }

  if (!target.isNpc && target.ownerId) {
    const characters = loadedCharacters ?? characterState.getAll();
    const userChars = characters[target.ownerId] ?? {};
    for (const charEntry of Object.values(userChars)) {
      if (charEntry?.data?.name && charEntry.data.name.toLowerCase() === target.name.toLowerCase()) {
        const c = charEntry.data;
        const ab = c.abilities ?? {};
        const prof = c.proficiencies ?? {};
        const lvl = c.level ?? 1;
        const abilityFor = { fort: 'con', ref: 'dex', will: 'wis' };
        const profKey = { fort: 'fortitude', ref: 'reflex', will: 'will' };
        const abilMod = Math.floor(((ab[abilityFor[normalized]] ?? 10) - 10) / 2);
        const profNum = prof[profKey[normalized]] ?? 0;
        const itemBonus = (c.overlay?.saveItemBonuses?.[normalized]) ?? 0;
        return { bonus: abilMod + calcCharacterProfNum(c, profNum, lvl) + itemBonus, source: 'character' };
      }
    }
  }

  if (target.isNpc) {
    const { monster } = findMonster(target.name) || {};
    if (monster) {
      const rich = monster.rich ?? null;
      const coreSaves = monster.core?.saves ?? {};
      const legacySaves = monster.summary?.summary ?? {};
      const saveMap = { fort: ['fort', 'fortitude'], ref: ['ref', 'reflex'], will: ['will'] };
      for (const saveKey of saveMap[normalized]) {
        if (coreSaves[saveKey] != null) return { bonus: coreSaves[saveKey], source: 'bestiary' };
        if (legacySaves[saveKey] != null) return { bonus: legacySaves[saveKey], source: 'bestiary' };
        if (rich?.defenses?.saves?.[saveKey.charAt(0).toUpperCase() + saveKey.slice(1)] != null) {
          return { bonus: rich.defenses.saves[saveKey.charAt(0).toUpperCase() + saveKey.slice(1)], source: 'bestiary' };
        }
      }
    }
  }

  return null;
}

function rollSaveForTarget(bonus, dc) {
  const dieRoll = Math.floor(Math.random() * 20) + 1;
  const total = dieRoll + bonus;
  const degree = determineDegreeOfSuccess(total, dieRoll, dc);
  return { dieRoll, total, degree };
}

function basicSaveDamage(fullDamage, degree) {
  if (degree === 'crit-success') return 0;
  if (degree === 'success') return Math.floor(fullDamage / 2);
  if (degree === 'failure') return fullDamage;
  if (degree === 'crit-failure') return fullDamage * 2;
  return fullDamage;
}

function formatEffectContributions(effects, kind) {
  const contributions = effects
    .filter(effect => {
      if (kind === 'attack') return effect.attackBonus !== 0;
      if (kind === 'damage') return effect.damageBonus !== 0;
      if (kind === 'ac') return effect.acBonus !== 0;
      return false;
    })
    .map(effect => {
      const val = kind === 'attack' ? effect.attackBonus : kind === 'damage' ? effect.damageBonus : effect.acBonus;
      return effect.name + ' ' + fmt(val);
    });
  return contributions.length > 0 ? ' (' + contributions.join(', ') + ')' : '';
}

function buildCombatDeathEmbed(name) {
  return new EmbedBuilder()
    .setColor(0x8b0000)
    .setTitle(name + ' has Died!')
    .setDescription('**' + name + '** reached Dying 4 and has been removed from initiative.');
}

function combatDeathPayload(result) {
  const name = result?.removed?.name ?? result?.name ?? result?.combatant?.name;
  return result?.died && name ? { embeds: [buildCombatDeathEmbed(name)] } : null;
}

async function execute(interaction) {

  await interaction.deferReply();
  const spellName = interaction.options.getString('spell');
  const nameArg   = interaction.options.getString('character');
  const castLevel = interaction.options.getInteger('level') ?? null;
  const targetName = interaction.options.getString('target');
  const characters = characterState.getAll();
  const { error, char: charEntry } = characterState.resolveChar(interaction.user.id, nameArg, characters);
  if (error) return interaction.editReply(error);
  const rawSpell = findSpell(spellName);
  if (rawSpell?.ambiguous) return interaction.editReply(spellAmbiguityMessage(rawSpell));
  if (!rawSpell) return interaction.editReply(`Couldn't find a spell called **${spellName}**. Check the spelling and try again!`);
  const spell = normalizeSpell(rawSpell);
  const c = charEntry.data;
  const ab = c.abilities ?? {};
  const prof = c.proficiencies ?? {};
  const lvl = c.level ?? 1;
  const traditionProfMap = {
    arcane: ['castingArcane', 'casting_arcane'],
    divine: ['castingDivine', 'casting_divine'],
    occult: ['castingOccult', 'casting_occult'],
    primal: ['castingPrimal', 'casting_primal'],
  };
  const tradAbilMap = { arcane: 'int', divine: 'wis', occult: 'cha', primal: 'wis' };
  let keyAbility = 'int', spellProfNum = usesRankProficiencies(c) ? 1 : 2;
  if (c.spellCasters?.length > 0) {
    const spellTraditions = spell.traditions.map(t => t.toLowerCase());
    const caster = c.spellCasters.find(sc => spellTraditions.includes(sc.magicTradition?.toLowerCase())) ?? c.spellCasters[0];
    const tradKeys = traditionProfMap[caster.magicTradition?.toLowerCase()] ?? traditionProfMap.arcane;
    spellProfNum = canonicalProfValue(prof, ...tradKeys, 'spell_dc', 'spellDC') || spellProfNum;
    keyAbility = caster.ability?.toLowerCase() ?? tradAbilMap[caster.magicTradition?.toLowerCase()] ?? 'int';
  }
  const keyMod = Math.floor(((ab[keyAbility] ?? 10) - 10) / 2);
  const spellAttackBonus = keyMod + calcCharacterProfNum(c, spellProfNum, lvl);
  const spellDC = 10 + keyMod + calcCharacterProfNum(c, spellProfNum, lvl);
  const isAttackSpell = spell.isAttackSpell === true;
  const saveType = spell.savingThrow ?? null;
  const effectiveLevel = castLevel ?? spell.level ?? 1;
  const isCantrip = spell.type === 'Cantrip';
  const levelDisplay = isCantrip ? `Cantrip ${effectiveLevel}` : `Level ${effectiveLevel}`;
  const traditionDisplay = spell.traditions?.[0] ?? '';

  // ── Overlay-aware slot tracking ──
  // Find which caster is actually casting (same match as above).
  charOverlay.ensureOverlay(charEntry);
  let castingCaster = null;
  if (c.spellCasters?.length > 0) {
    const spellTraditions = spell.traditions.map(t => t.toLowerCase());
    castingCaster = c.spellCasters.find(sc => spellTraditions.includes(sc.magicTradition?.toLowerCase())) ?? c.spellCasters[0];
  }
  // Non-cantrips consume slots. Cantrips and focus spells are at-will.
  const consumesSlot = !isCantrip && castingCaster && effectiveLevel > 0;
  const warnings = [];
  if (consumesSlot) {
    const slots = charOverlay.getSlotsRemaining(charEntry, castingCaster.name, effectiveLevel);
    if (slots && slots.max > 0 && slots.current <= 0) {
      warnings.push(`⚠️ ${castingCaster.name} has no rank ${effectiveLevel} slots remaining (0/${slots.max}). Casting anyway — use \`/rest\` to refresh, or this might be from a wand/scroll/staff.`);
    } else if (slots && slots.max === 0) {
      warnings.push(`⚠️ ${castingCaster.name} has no rank ${effectiveLevel} slots at all. Casting anyway — this is likely a scroll, wand, or higher-rank slot use.`);
    }
    // Prepared-caster check: warn if spell isn't on today's prepared list (only if they've prepared anything)
    if (castingCaster.spellcastingType === 'prepared') {
      const overlay = charEntry.overlay;
      const prep = overlay.prepared_override?.[castingCaster.name] ?? [];
      if (prep.length > 0) {
        const hasPrep = prep.some(p =>
          Number(p.rank) === Number(effectiveLevel) &&
          (p.spell || '').toLowerCase() === spell.name.toLowerCase()
        );
        if (!hasPrep) {
          warnings.push(`⚠️ **${spell.name}** isn't on ${castingCaster.name}'s prepared list for today. Casting anyway.`);
        }
      }
    }
    // Spend the slot
    charOverlay.spendSlot(charEntry, castingCaster.name, effectiveLevel);
    characterState.saveAll(characters);
  }

  const channelId = interaction.channel.id;
  const enc = encounters.getEncounter(channelId);

  // ── Resolve target(s) ──────────────────────────────────────────────
  // Two ways to specify targets:
  //   target  — a single combatant name (legacy/single-target spells)
  //   targets — comma-separated list of combatant names (multi-target,
  //             multi-save resolution, auto-effect application)
  // If both are given, `targets` wins (and target is ignored).
  // The existing single-target rendering logic below uses `target` (singular)
  // — so for multi-target casts, we resolve a list AND set `target` to the
  // first entry to keep that legacy path working for the embed header.
  const targetsArg = interaction.options.getString('targets');
  let resolvedTargets = []; // populated below; used by the multi-target effect-applier section
  let target = null;
  if (targetsArg) {
    // Parse "Goblin1, Goblin2, Bandit" into a clean list
    if (!enc) return interaction.editReply('❌ Targets specified but no active encounter in this channel. Start one with `/init start`.');
    const names = targetsArg.split(',').map(s => s.trim()).filter(Boolean);
    const notFound = [];
    for (const n of names) {
      const found = enc.combatants.find(x => x.name.toLowerCase() === n.toLowerCase());
      if (found) resolvedTargets.push(found);
      else notFound.push(n);
    }
    if (notFound.length > 0) return interaction.editReply(`❌ No combatant(s) named: ${notFound.map(n => `"${n}"`).join(', ')} in this encounter.`);
    if (resolvedTargets.length === 0) return interaction.editReply('❌ No valid targets resolved.');
    // First target is "the" target for the legacy single-target rendering path.
    target = resolvedTargets[0];
  } else if (targetName) {
    if (!enc) return interaction.editReply('❌ Target specified but no active encounter in this channel. Start one with `/init start`.');
    target = enc.combatants.find(x => x.name.toLowerCase() === targetName.toLowerCase());
    if (!target) return interaction.editReply(`❌ No combatant named "${targetName}" in this encounter.`);
    resolvedTargets = [target];
  }

  const embed = new EmbedBuilder().setColor(0x9B59B6).setTitle(`${c.name} casts ${spell.name}!`);
  if (charEntry.art) embed.setThumbnail(charEntry.art);

  let description = `*${levelDisplay}${traditionDisplay ? ` ${traditionDisplay}` : ''} spell*\n`;
  if (spell.cast)     description += `**Cast** ${spell.cast}\n`;
  if (spell.range)    description += `**Range** ${spell.range}\n`;
  if (spell.area)     description += `**Area** ${spell.area}\n`;
  if (spell.target)   description += `**Target** ${spell.target}\n`;
  description += `**Duration** ${spell.duration || 'Instantaneous'}\n`;
  description += '\n';

  // Look up caster's active effects if in encounter
  const casterCombatant = enc ? enc.combatants.find(x => x.name.toLowerCase() === c.name.toLowerCase()) : null;
  const casterMods = sumEffectModifiers(casterCombatant);
  const targetMods = target ? sumEffectModifiers(target) : { acBonus: 0, activeEffects: [] };

  let attackDegree = null;
  let attackDieRoll = null;
  let attackTotal = null;
  let effectiveTargetAcForSpell = null;
  if (isAttackSpell) {
    attackDieRoll = Math.floor(Math.random() * 20) + 1;
    attackTotal = attackDieRoll + spellAttackBonus + casterMods.attackBonus;
    const casterEffectText = formatEffectContributions(casterMods.activeEffects, 'attack');
    description += `**Spell Attack Roll**\n1d20 (${attackDieRoll}) ${fmt(spellAttackBonus)}${casterEffectText ? ` ${fmt(casterMods.attackBonus)}` : ''} = **${attackTotal}**`;
    if (casterEffectText) description += `\n*${casterEffectText.trim().slice(1, -1)}*`;
    if (attackDieRoll === 20) description += ' ⭐ Natural 20!';
    if (attackDieRoll === 1)  description += ' 💀 Natural 1!';
    description += '\n\n';
    if (target && target.ac !== null && target.ac !== undefined) {
      effectiveTargetAcForSpell = target.ac + targetMods.acBonus;
      attackDegree = determineDegreeOfSuccess(attackTotal, attackDieRoll, effectiveTargetAcForSpell);
    }
  }

  if (saveType) {
    const humanSave = saveType.charAt(0).toUpperCase() + saveType.slice(1);
    const basicLabel = spell.saveIsBasic ? 'basic ' : '';
    description += `**${basicLabel}${humanSave} Save DC ${spellDC}**\n`;
    if (!target) description += `Target(s) should roll \`/save type:${saveType}\`.\n`;
    description += '\n';
  }

  // ── Damage: roll dice (with heightening) and track type ─────────────
  // resolveSpellDamage handles every heightening shape that appears in
  // spells.json — per_rank with/without damage_bonus, fixed with/without
  // dice in the level text — and reads spell.damage as { base, type, extra }
  // (the actual catalog shape, not the legacy spell.damageBase). See
  // utils/spellDamage.js for the full rules.
  let damageResult = null;
  let finalDamage = 0;
  let damageTypeLabel = null;
  let damageExpressionDisplay = null;
  let heightenedNoteForEmbed = '';

  const resolved = resolveSpellDamage(spell, effectiveLevel);
  if (resolved) {
    damageTypeLabel = resolved.damageType;
    heightenedNoteForEmbed = resolved.heightenedNote || '';
    if (resolved.diceExpr) {
      damageResult = rollCompoundExpression(resolved.diceExpr);
      damageExpressionDisplay = resolved.diceExpr;
    }
  }

  // Surface the heightened narrative note in the embed when the spell is
  // actually being cast above its base level. This catches spells like
  // Magic Missile (per_rank, no scaling dice but extra missiles) and Aerial
  // Form (fixed, narrative-only changes), so users see *what* the heightened
  // version does rather than just rolling the same dice.
  if (heightenedNoteForEmbed && resolved.bonusRanks > 0) {
    description += `*⬆️ Heightened (rank ${effectiveLevel}): ${heightenedNoteForEmbed}*\n\n`;
  }

  // ── Auto-resolve save (basic or non-basic) on a single target ──────
  // For BASIC saves: auto-apply damage based on the target's rolled degree
  // of success. For NON-BASIC saves: report the degree but don't auto-apply
  // any effect (most non-basic saves have narrative effects the GM adjudicates).
  let saveResult = null;
  let saveDegreeApplied = null;
  if (saveType && target && !isAttackSpell) {
    const bonusInfo = getTargetSaveBonus(target, saveType, characters);
    if (bonusInfo) {
      saveResult = rollSaveForTarget(bonusInfo.bonus, spellDC);
      saveDegreeApplied = saveResult.degree;
      const targetDesc = target.isNpc ? target.name : `**${target.name}**`;
      const degreeEmoji = { 'crit-success': '🌟', 'success': '✅', 'failure': '❌', 'crit-failure': '💥' };
      const degreeLabel = { 'crit-success': 'Critical Success', 'success': 'Success', 'failure': 'Failure', 'crit-failure': 'Critical Failure' };
      description += `${targetDesc}'s ${saveType.charAt(0).toUpperCase() + saveType.slice(1)} Save: 1d20 (${saveResult.dieRoll}) ${fmt(bonusInfo.bonus)} = **${saveResult.total}** vs DC ${spellDC}\n`;
      description += `${degreeEmoji[saveDegreeApplied] ?? '•'} **${degreeLabel[saveDegreeApplied] ?? saveDegreeApplied}**\n\n`;
    } else {
      // No save bonus available — fall back to asking them to roll manually
      description += `${target.name}'s save bonus unknown — please roll \`/save type:${saveType}\` manually.\n\n`;
    }
  }

  // ── Render damage breakdown + compute final damage to apply ─────────
  if (damageResult) {
    const typeBadge = damageTypeLabel ? `${damageTypeEmoji(damageTypeLabel)} **${damageTypeLabel}**` : '';
    const headerSuffix = typeBadge ? ` — ${typeBadge}` : '';

    if (isAttackSpell && target && attackDegree) {
      // Attack-roll spell path: existing crit-double logic
      if (attackDegree === 'crit-success') {
        finalDamage = damageResult.total * 2;
        description += `**Damage (CRIT ×2)**${headerSuffix}\n${damageResult.display} = ${damageResult.total} × 2 = **${finalDamage}**\n`;
      } else if (attackDegree === 'success') {
        finalDamage = damageResult.total;
        description += `**Damage**${headerSuffix}\n${damageResult.display} = **${finalDamage}**\n`;
      } else {
        description += `*No damage (missed)*\n`;
      }
    } else if (spell.saveIsBasic && saveDegreeApplied) {
      // Basic-save path: apply degree-based scaling to the rolled damage
      const rolledTotal = damageResult.total;
      finalDamage = basicSaveDamage(rolledTotal, saveDegreeApplied);
      const multiplier = { 'crit-success': '× 0', 'success': '÷ 2', 'failure': '(full)', 'crit-failure': '× 2' }[saveDegreeApplied];
      description += `**Damage** ${multiplier}${headerSuffix}\n${damageResult.display} = ${rolledTotal} → **${finalDamage}**\n`;
    } else {
      // No target / manual resolution: show the rolled damage and scaling hints
      finalDamage = damageResult.total;
      description += `**Damage**${headerSuffix}\n${damageResult.display} = **${finalDamage}**\n`;
      if (saveType && (!target || !saveDegreeApplied)) {
        const scaleNote = spell.saveIsBasic
          ? `Basic save: crit-success 0 · success ${Math.floor(finalDamage / 2)} · failure ${finalDamage} · crit-fail ${finalDamage * 2}`
          : `Non-basic save — see spell text for effect per degree`;
        description += `*${scaleNote}*\n`;
      }
    }
  } else if (spell.damage) {
    description += `**Damage:** ${spell.damage}\n`;
  }

  if (isAttackSpell && target) {
    const acBreakdown = target.ac !== null && target.ac !== undefined && targetMods.acBonus !== 0
      ? ` (base ${target.ac}${fmt(targetMods.acBonus)} from effects = ${effectiveTargetAcForSpell})`
      : '';
    const displayAc = effectiveTargetAcForSpell ?? target.ac;
    if (attackDegree === 'crit-success')      description += `\n🎯 **Critical Hit on ${target.name}!** AC ${displayAc}${acBreakdown}`;
    else if (attackDegree === 'success')      description += `\n✅ **Hit on ${target.name}!** AC ${displayAc}${acBreakdown}`;
    else if (attackDegree === 'failure')      description += `\n❌ **Miss on ${target.name}.** AC ${displayAc}${acBreakdown}`;
    else if (attackDegree === 'crit-failure') description += `\n💢 **Critical Miss on ${target.name}.** AC ${displayAc}${acBreakdown}`;
    else                                       description += `\n🎯 Attack against **${target.name}** (AC unknown — GM decides)`;
  }

  // ── Apply damage to target ─────────────────────────────────────────
  // Two paths lead here:
  //   1. Attack spell hit: attackDegree is success or crit-success
  //   2. Basic-save spell: saveDegreeApplied exists and finalDamage > 0
  const deathEmbeds = [];
  const attackHit = target && isAttackSpell && (attackDegree === 'success' || attackDegree === 'crit-success');
  const basicSaveDealsDamage = target && !isAttackSpell && spell.saveIsBasic && saveDegreeApplied && finalDamage > 0;
  if ((attackHit || basicSaveDealsDamage) && finalDamage > 0) {
    const dmgResult = ca.applyDamage(channelId, target.name, finalDamage);
    const dyingNote = dmgResult?.displaySuffix ?? '';
    description += target.isNpc
      ? `\n❤️ **${target.name}** took ${finalDamage} damage${dyingNote}`
      : `\n❤️ **${target.name}**: ${target.hp}/${target.maxHp} HP${dyingNote}`;
    const deathPayload = combatDeathPayload(dmgResult);
    if (deathPayload?.embeds?.length) deathEmbeds.push(...deathPayload.embeds);
  }

  // ── Multi-target processing & auto-effect application ──────────────
  // At this point, the existing single-target path has already handled
  // resolvedTargets[0] (saved into `target`): rolled attack/save, applied
  // damage, rendered the result. Now we need to:
  //
  //   (a) Apply spell-mapped CONDITIONS to that first target based on
  //       its save degree (e.g. cast Fear → Frightened auto-applies).
  //       This is independent of the basic-save damage logic above.
  //
  //   (b) For target #2..N (only set when /cast was used with `targets`
  //       plural), repeat the save+damage+effect logic for each.
  //
  // The whole block is gated on (resolvedTargets.length > 0 && enc) so
  // we never touch combatants outside an active encounter.
  if (enc && resolvedTargets.length > 0) {
    const hasEffectMapping = spellEffects.hasMapping(spell.name);
    const degreeEmoji = { 'crit-success': '🌟', 'success': '✅', 'failure': '❌', 'crit-failure': '💥' };
    const degreeLabel = { 'crit-success': 'Crit Success', 'success': 'Success', 'failure': 'Failure', 'crit-failure': 'Crit Failure' };

    // (a) Apply auto-effects to the FIRST target (the one already rendered).
    // For attack spells, we use attackDegree as the "save degree" so spells
    // with attack rolls + conditions (rare) work. Otherwise saveDegreeApplied.
    // For no-save spells (alwaysApply), pass null and the engine returns
    // the alwaysApply list.
    if (hasEffectMapping && target) {
      const mapping = spellEffects.getMapping(spell.name);
      let degreeForTarget = null;
      if (mapping.saveType && saveDegreeApplied) {
        degreeForTarget = saveDegreeApplied;
      } else if (mapping.saveType && isAttackSpell && attackDegree) {
        // Treat attack hit/miss as failure/success for effect resolution
        degreeForTarget = (attackDegree === 'success' || attackDegree === 'crit-success') ? 'failure' : 'success';
      }
      const effects = spellEffects.resolveEffectsForDegree(spell.name, degreeForTarget, effectiveLevel);
      if (effects.length > 0) {
        const result = spellEffects.applyEffectsToCombatant(channelId, target.name, effects, encounters, 'spell');
        if (result.applied > 0) {
          description += `\n✨ **${target.name}** gains: ${spellEffects.formatEffectSummary(effects)}\n`;
        }
      }
    }

    // (b) Process additional targets (everything past index 0).
    // Each gets its own save roll, damage application (basic save), and
    // effect application. We render a compact one-line-per-target summary.
    if (resolvedTargets.length > 1) {
      description += `\n**Additional targets:**\n`;
      for (let i = 1; i < resolvedTargets.length; i++) {
        const t = resolvedTargets[i];
        let line = `• **${t.name}**: `;
        let extraDegree = null;

        // Save spells (basic or non-basic): roll the save, possibly apply damage
        if (saveType && !isAttackSpell) {
          const bonusInfo = getTargetSaveBonus(t, saveType, characters);
          if (bonusInfo) {
            const sr = rollSaveForTarget(bonusInfo.bonus, spellDC);
            extraDegree = sr.degree;
            line += `${saveType.charAt(0).toUpperCase() + saveType.slice(1)} ${sr.total} (${sr.dieRoll}${fmt(bonusInfo.bonus)}) ${degreeEmoji[sr.degree] || ''} ${degreeLabel[sr.degree] || sr.degree}`;
            // Basic-save damage: apply to this target
            if (spell.saveIsBasic && damageResult) {
              const dmgForTarget = basicSaveDamage(damageResult.total, sr.degree);
              if (dmgForTarget > 0) {
                const dmgResult = ca.applyDamage(channelId, t.name, dmgForTarget);
                const dyingNote = dmgResult?.displaySuffix ?? '';
                line += ` — ${dmgForTarget} dmg${dyingNote}`;
                const deathPayload = combatDeathPayload(dmgResult);
                if (deathPayload?.embeds?.length) deathEmbeds.push(...deathPayload.embeds);
              }
            }
          } else {
            line += `*save bonus unknown — roll \`/save type:${saveType}\` manually*`;
          }
        }
        // Attack spells against multiple targets: re-roll attack for each
        // (PF2e doesn't have multi-target attack-roll spells in core but
        // homebrew might; treat each as an independent attack).
        else if (isAttackSpell) {
          const die = Math.floor(Math.random() * 20) + 1;
          const total = die + spellAttackBonus + casterMods.attackBonus;
          const tMods = sumEffectModifiers(t);
          const effAc = (t.ac ?? 0) + tMods.acBonus;
          const deg = (t.ac != null) ? determineDegreeOfSuccess(total, die, effAc) : null;
          extraDegree = deg;
          line += `Atk ${total} (${die}${fmt(spellAttackBonus + casterMods.attackBonus)}) vs AC ${effAc} ${degreeEmoji[deg] || ''} ${degreeLabel[deg] || ''}`;
          if ((deg === 'success' || deg === 'crit-success') && damageResult) {
            const dmg = deg === 'crit-success' ? damageResult.total * 2 : damageResult.total;
            const dmgResult = ca.applyDamage(channelId, t.name, dmg);
            const dyingNote = dmgResult?.displaySuffix ?? '';
            line += ` — ${dmg} dmg${dyingNote}`;
            const deathPayload = combatDeathPayload(dmgResult);
            if (deathPayload?.embeds?.length) deathEmbeds.push(...deathPayload.embeds);
          }
        }

        // Auto-apply effects for this target based on resolved degree
        if (hasEffectMapping) {
          const mapping = spellEffects.getMapping(spell.name);
          let degForT = null;
          if (mapping.saveType && extraDegree) {
            degForT = extraDegree;
          } else if (mapping.saveType && extraDegree && isAttackSpell) {
            degForT = (extraDegree === 'success' || extraDegree === 'crit-success') ? 'failure' : 'success';
          }
          const tEffects = spellEffects.resolveEffectsForDegree(spell.name, degForT, effectiveLevel);
          if (tEffects.length > 0) {
            const r = spellEffects.applyEffectsToCombatant(channelId, t.name, tEffects, encounters, 'spell');
            if (r.applied > 0) line += ` → ${spellEffects.formatEffectSummary(tEffects)}`;
          }
        }
        description += line + '\n';
      }
    }
  }


  const shortDesc = spell.description ?? '';
  if (shortDesc && shortDesc !== '*No description available.*') {
    const desc = shortDesc.length > 300 ? shortDesc.slice(0, 300) + `...\n*Use \`/spell ${spell.name}\` for full details*` : shortDesc;
    description += `\n\n${desc}`;
  }

  embed.setDescription(description);
  // Build footer with spell attack + DC + remaining slots if relevant
  let footer = `${c.name} · Spell Attack ${fmt(spellAttackBonus)} · DC ${spellDC}`;
  if (consumesSlot && castingCaster) {
    const slotsNow = charOverlay.getSlotsRemaining(charEntry, castingCaster.name, effectiveLevel);
    if (slotsNow && slotsNow.max > 0) {
      footer += ` · Rank ${effectiveLevel} slots: ${slotsNow.current}/${slotsNow.max}`;
    }
  }
  embed.setFooter({ text: footer });

  const payload = { embeds: [embed, ...deathEmbeds].slice(0, 10) };
  if (warnings.length) payload.content = warnings.join('\n');
  if (target && !target.isNpc && target.ownerId) payload.content = [payload.content, `<@${target.ownerId}>`].filter(Boolean).join('\n');
  await interaction.editReply(payload);
  if (target && enc) await updateSummary(interaction.channel, enc);
}

module.exports = {
  name: 'cast',
  execute,
};
