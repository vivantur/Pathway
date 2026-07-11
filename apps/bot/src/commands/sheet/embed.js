// ── commands/sheet/embed.js ─────────────────────────────────────────────────
// Builds the /sheet command's character-sheet embed.
//
// This is a pure function: it takes a charEntry + a deps bundle, returns an
// EmbedBuilder, and has no side effects. All character math, formatting,
// and state-derivation helpers come in via `deps` so this file has no
// implicit knowledge of where they live (currently still in index.js;
// future phases move them into rules/lore.js, rules/pf2eMath.js, and
// state/characters.js).
//
// Pure formatting helpers (fmt, getMod, calcProfNum, xpToNextLevel) come
// directly from lib/format.js — they've been there since Phase 0 but were
// dead code (index.js had its own copies). This is the first real consumer.

const { EmbedBuilder } = require('discord.js');
const { fmt, getMod, calcProfNum, xpToNextLevel } = require('../../lib/format');
const {
  calcCharacterProfNum, characterProfValue, canonicalProfValue,
  profIconForValue, computeCharSkillModifier,
} = require('../../rules/pf2eMath');
const {
  getCharacterHp, getCharacterXp, getCharacterWeapons,
} = require('../../state/characters');
const { loreKey, loreTopicLabel, isLoreProficiencyKey } = require('../../rules/lore');

function cleanDefenseLabel(value) {
  return String(value ?? '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatDefenseEntry(entry) {
  if (entry == null || entry === '') return null;
  if (typeof entry === 'string') return cleanDefenseLabel(entry);
  if (typeof entry === 'number') return String(entry);
  if (Array.isArray(entry)) return entry.map(formatDefenseEntry).filter(Boolean).join(' ');
  if (typeof entry === 'object') {
    const type = entry.type ?? entry.name ?? entry.damageType ?? entry.kind ?? entry.label;
    const value = entry.value ?? entry.amount ?? entry.number ?? entry.total;
    const note = entry.note ?? entry.notes ?? entry.exceptions ?? entry.exception;
    if (type || value !== undefined) {
      return [cleanDefenseLabel(type), value, note ? `(${cleanDefenseLabel(note)})` : null]
        .filter(v => v !== null && v !== undefined && v !== '')
        .join(' ');
    }
    return Object.entries(entry)
      .filter(([, v]) => v !== false && v !== null && v !== undefined && v !== '')
      .map(([k, v]) => {
        const label = cleanDefenseLabel(k);
        if (v === true) return label;
        if (typeof v === 'object') return formatDefenseEntry({ type: label, ...v });
        return `${label} ${cleanDefenseLabel(v)}`;
      })
      .filter(Boolean)
      .join(', ');
  }
  return null;
}

function formatDefenseList(...sources) {
  const parts = [];
  for (const source of sources) {
    if (source == null || source === '') continue;
    if (typeof source === 'string') {
      parts.push(...source.split(',').map(cleanDefenseLabel).filter(Boolean));
    } else if (Array.isArray(source)) {
      parts.push(...source.map(formatDefenseEntry).filter(Boolean));
    } else if (typeof source === 'object') {
      const formatted = formatDefenseEntry(source);
      if (formatted) parts.push(...formatted.split(',').map(cleanDefenseLabel).filter(Boolean));
    }
  }
  const unique = [...new Set(parts.filter(Boolean))];
  return unique.length ? unique.join(', ') : 'none';
}

// As of Phase 3.5 buildSheetEmbed has no `deps` parameter — every helper it
// needs comes through an explicit import. This is the target state for all
// extracted commands and embeds: imports declare exact dependencies, no
// runtime parameter-passing for "context" that the type system can't see.
function buildSheetEmbed(charEntry) {

  // Merge overrides from charEntry.edits into a display-only view of c.
  // Original c.data is untouched so JSON re-imports don't lose user edits
  // (preserved via `edits` overlay which saveImportedCharacter keeps).
  const rawC = charEntry.data;
  const identityOv = charEntry.edits?.identity ?? {};
  const miscOv     = charEntry.edits?.misc ?? {};
  const abilityOv  = charEntry.edits?.abilities ?? {};
  const moneyOv    = charEntry.edits?.money ?? {};
  const c = {
    ...rawC,
    class:      identityOv.class     ?? rawC.class,
    subclass:   identityOv.subclass  ?? rawC.subclass,
    level:      identityOv.level     ?? rawC.level,
    dualClass:  identityOv.dualClass ?? rawC.dualClass,
    ancestry:   identityOv.ancestry  ?? rawC.ancestry,
    heritage:   identityOv.heritage  ?? rawC.heritage,
    gender:     miscOv.gender     ?? rawC.gender,
    age:        miscOv.age        ?? rawC.age,
    size:       (miscOv.size !== undefined) ? miscOv.size : rawC.size,
    alignment:  miscOv.alignment  ?? rawC.alignment,
    keyability: miscOv.keyability ?? rawC.keyability,
    abilities:  { ...(rawC.abilities ?? {}), ...abilityOv },
    money:      { ...(rawC.money ?? {}), ...moneyOv },
  };
  const lvl = c.level ?? 1;
  const ab = c.abilities ?? {};
  const prof = c.proficiencies ?? {};
  const currentXP = getCharacterXp(charEntry);
  const xpDisplay = `${currentXP} / ${xpToNextLevel(lvl)} XP`;
  const conMod = Math.floor(((ab.con ?? 10) - 10) / 2);
  const totalHPComputed = (c.attributes?.ancestryhp ?? 0) + (c.attributes?.bonushp ?? 0) + (((c.attributes?.classhp ?? 0) + (c.attributes?.bonushpPerLevel ?? 0) + conMod) * lvl);
  // Apply HP max override if set via /char stat
  const statOverridesPre = charEntry.edits?.stats ?? {};
  const totalHP = statOverridesPre.hpMax ?? totalHPComputed;
  // If the bot has been tracking HP (via /hp), show current/max; otherwise just max.
  const currentHP = getCharacterHp(charEntry);
  const hpDisplay = (currentHP < totalHP) ? `${currentHP}/${totalHP}` : `${totalHP}`;
  const wisMod = Math.floor(((ab.wis ?? 10) - 10) / 2);
  const percComputed = wisMod + calcCharacterProfNum(c, prof.perception ?? 0, lvl);
  const percSkill = computeCharSkillModifier(charEntry, 'perception');
  const percMod = statOverridesPre.perception ?? percSkill?.modifier ?? percComputed;
  const overriddenFields = [];
  let spellAttackBonus = null, spellDC = null;
  if (c.spellCasters?.length > 0) {
    const caster = c.spellCasters[0];
    const tradAbilMap = { arcane: 'int', divine: 'wis', occult: 'cha', primal: 'wis' };
    const traditionProfMap = {
      arcane: ['castingArcane', 'casting_arcane'],
      divine: ['castingDivine', 'casting_divine'],
      occult: ['castingOccult', 'casting_occult'],
      primal: ['castingPrimal', 'casting_primal'],
    };
    const spellOv = charEntry.edits?.spellcasting ?? {};
    const effectiveTradition = spellOv.tradition ?? caster.magicTradition?.toLowerCase();
    const tradKeys = traditionProfMap[effectiveTradition] ?? traditionProfMap.arcane;
    const keyAbility = (spellOv.keyAbility ?? caster.ability?.toLowerCase()) ?? tradAbilMap[effectiveTradition] ?? 'int';
    const keyMod = Math.floor(((ab[keyAbility] ?? 10) - 10) / 2);
    const spellProf = canonicalProfValue(prof, ...tradKeys, 'spell_dc', 'spellDC');
    const spellProfMod = calcCharacterProfNum(c, spellProf, lvl);
    spellAttackBonus = spellOv.attack ?? (keyMod + spellProfMod);
    spellDC = spellOv.dc ?? (10 + keyMod + spellProfMod);
    if (spellOv.attack !== undefined)   overriddenFields.push('Spell atk');
    if (spellOv.dc !== undefined)       overriddenFields.push('Spell DC');
    if (spellOv.tradition !== undefined)  overriddenFields.push('Tradition');
    if (spellOv.keyAbility !== undefined) overriddenFields.push('Spell key');
  }
  // Stat overrides: user-set values via /char stat. These win over the
  // computed values from c.data. Track which ones are overridden so we
  // can mark them in the display with a warning.
  const skillOverrides = (charEntry.edits?.skillOverrides) ?? {};
  const statOverrides = charEntry.edits?.stats ?? {};
  const fortModComputed   = Math.floor(((ab.con ?? 10) - 10) / 2) + calcCharacterProfNum(c, prof.fortitude ?? 0, lvl);
  const reflexModComputed = Math.floor(((ab.dex ?? 10) - 10) / 2) + calcCharacterProfNum(c, prof.reflex ?? 0, lvl);
  const willModComputed   = Math.floor(((ab.wis ?? 10) - 10) / 2) + calcCharacterProfNum(c, prof.will ?? 0, lvl);
  const fortMod   = statOverrides.fortitude ?? fortModComputed;
  const reflexMod = statOverrides.reflex ?? reflexModComputed;
  const willMod   = statOverrides.will ?? willModComputed;
  if (statOverrides.fortitude !== undefined) overriddenFields.push('Fort');
  if (statOverrides.reflex !== undefined)    overriddenFields.push('Ref');
  if (statOverrides.will !== undefined)      overriddenFields.push('Will');
  if (statOverrides.hpMax !== undefined)     overriddenFields.push('HP max');
  if (statOverrides.perception !== undefined || skillOverrides.perception !== undefined) overriddenFields.push('Perception');
  if (statOverrides.ac !== undefined)        overriddenFields.push('AC');
  if (statOverrides.speed !== undefined)     overriddenFields.push('Speed');
  // Identity / misc / ability / money overrides
  for (const [k, label] of [
    ['class', 'Class'], ['subclass', 'Subclass'], ['level', 'Level'],
    ['dualClass', 'Dual Class'], ['ancestry', 'Ancestry'], ['heritage', 'Heritage'],
  ]) if (identityOv[k] !== undefined && identityOv[k] !== null && identityOv[k] !== '') overriddenFields.push(label);
  for (const [k, label] of [
    ['gender', 'Gender'], ['age', 'Age'], ['size', 'Size'],
    ['alignment', 'Alignment'], ['keyability', 'Key ability'],
  ]) if (miscOv[k] !== undefined && miscOv[k] !== null && miscOv[k] !== '') overriddenFields.push(label);
  for (const ab_ of ['str', 'dex', 'con', 'int', 'wis', 'cha']) {
    if (abilityOv[ab_] !== undefined) overriddenFields.push(ab_.toUpperCase());
  }
  for (const coin of ['cp', 'sp', 'gp', 'pp']) {
    if (moneyOv[coin] !== undefined) overriddenFields.push(coin.toUpperCase());
  }
  const skillMap = {
    acrobatics: 'dex', arcana: 'int', athletics: 'str', crafting: 'int',
    deception: 'cha', diplomacy: 'cha', intimidation: 'cha', medicine: 'wis',
    nature: 'wis', occultism: 'int', performance: 'cha', religion: 'wis',
    society: 'int', stealth: 'dex', survival: 'wis', thievery: 'dex',
  };
  // Skill overrides layer on top of c.proficiencies. A user can set:
  //   { rank: 2|4|6|8 } — proficiency rank (trained/expert/master/legendary)
  //   { total: N }      — flat bonus override (ignores rank math)
  // If both present, total wins.
  const trainedSkills = [];
  // Collect all skills the character might have: base keys plus override keys
  const skillKeys = new Set([
    ...Object.keys(skillMap),
    ...Object.keys(skillOverrides)
      .filter(k => skillMap[k.toLowerCase()] && !isLoreProficiencyKey(k))
      .map(k => k.toLowerCase()),
  ]);
  for (const skill of skillKeys) {
    const override = skillOverrides[skill] ?? null;
    const jsonRank = prof[skill] ?? 0;
    const displayProfValue = override?.rank !== undefined ? override.rank : characterProfValue(c, jsonRank);
    const abilMod = Math.floor(((ab[skillMap[skill]] ?? 10) - 10) / 2);
    const computedTotal = abilMod + (
      override?.rank !== undefined ? calcProfNum(override.rank, lvl) : calcCharacterProfNum(c, jsonRank, lvl)
    );
    const total = (typeof override?.total === 'number') ? override.total : computedTotal;
    // Only include if trained (rank > 0) or explicitly overridden
    if (displayProfValue > 0 || override) {
      const icon = profIconForValue(displayProfValue, { override: !!override });
      trainedSkills.push(`${icon} ${skill.charAt(0).toUpperCase() + skill.slice(1)} ${fmt(total)}`);
    }
  }
  // Lore skills: combine c.lores (from JSON) with edits.lores (user-added
  // via /char lore). If the same topic appears in both, the edit wins.
  // edits.hiddenLores hides lores (used to remove JSON/PDF-sourced lores
  // that the user wants gone, since we don't mutate c.lores directly).
  const jsonLores = c.lores ?? [];
  const editLores = (charEntry.edits?.lores) ?? [];
  const hiddenLores = new Set((charEntry.edits?.hiddenLores ?? []).map(s => loreKey(s)));
  const loreMap = new Map();
  for (const lore of jsonLores) {
    const name = Array.isArray(lore) ? lore[0] : (lore?.name ?? lore?.skill ?? lore?.topic);
    const profNum = Array.isArray(lore)
      ? (typeof lore[1] === 'number' ? lore[1] : 0)
      : (typeof lore?.rank === 'number' ? lore.rank : typeof lore?.proficiency === 'number' ? lore.proficiency : 0);
    const totalOverride = Array.isArray(lore)
      ? (typeof lore[2] === 'number' ? lore[2] : null)
      : (typeof lore?.total === 'number' ? lore.total : null);
    if (!name || hiddenLores.has(loreKey(name))) continue;
    loreMap.set(loreKey(name), { name: loreTopicLabel(name), rank: profNum, total: totalOverride, source: 'json' });
  }
  for (const [key, rank] of Object.entries(prof)) {
    if (rank <= 0 || !isLoreProficiencyKey(key) || hiddenLores.has(loreKey(key))) continue;
    loreMap.set(loreKey(key), { name: loreTopicLabel(key), rank, total: null, source: 'proficiency' });
  }
  for (const lore of editLores) {
    if (!lore?.name || hiddenLores.has(loreKey(lore.name))) continue;
    loreMap.set(loreKey(lore.name), {
      name: loreTopicLabel(lore.name),
      rank: lore.rank ?? 0,
      total: (typeof lore.total === 'number') ? lore.total : null,
      source: 'edit',
    });
  }
  const loreSkills = [...loreMap.values()].map(lore => {
    const intMod = Math.floor(((ab.int ?? 10) - 10) / 2);
    // 'proficiency' (raw c.proficiencies) and JSON lores use the source-aware
    // helper so Pathbuilder ranks (2/4/6/8) aren't inflated by a rank; only
    // manual 'edit' overrides bypass it.
    const profBonus = lore.source === 'edit'
      ? calcProfNum(lore.rank, lvl)
      : calcCharacterProfNum(c, lore.rank, lvl);
    const displayProfValue = lore.source === 'edit'
      ? lore.rank
      : characterProfValue(c, lore.rank);
    const computedTotal = intMod + profBonus;
    const total = (lore.total !== null) ? lore.total : computedTotal;
    const icon = profIconForValue(displayProfValue, { override: lore.total !== null });
    return `${icon} Lore: ${lore.name} ${fmt(total)}`;
  });
  const allTrainedSkills = [...trainedSkills, ...loreSkills];
  const half = Math.ceil(allTrainedSkills.length / 2);
  const col1 = allTrainedSkills.slice(0, half);
  const col2 = allTrainedSkills.slice(half);
  const skillCols = col1.map((s, i) => `${s.padEnd(24)}${col2[i] ?? ''}`).join('\n');
  // Weapons: merge Pathbuilder weapons, Pathway web custom attacks, and
  // bot-added attacks. User-edited versions of the same-named weapon win.
  const mergedWeapons = getCharacterWeapons(charEntry);
  let attackLines = '';
  if (mergedWeapons.length > 0) {
    mergedWeapons.forEach(w => {
      const atkBonus = w.attack ?? 0;
      const dmgBonus = w.damageBonus > 0 ? `+${w.damageBonus}` : w.damageBonus < 0 ? `${w.damageBonus}` : '';
      const dmgType = w.damageType === 'P' ? 'Piercing' : w.damageType === 'S' ? 'Slashing' : w.damageType === 'B' ? 'Bludgeoning' : w.damageType ?? '';
      attackLines += `**${w.display ?? w.name}** ${fmt(atkBonus)} to hit · ${w.die ?? '1d4'}${dmgBonus} ${dmgType}\n`;
    });
  }
  // Edits overlay: user-set overrides for fields that Pathbuilder provides
  // but the user might want to customize (background, deity) or that PDF
  // imports might not capture (skill ranks). charEntry.edits is populated
  // by /char edit and /char skill.
  const edits = charEntry.edits ?? {};
  const languages = (edits.languages && edits.languages.length) ? edits.languages : (charEntry.languages ?? c.languages ?? []);
  const senses    = (edits.senses && edits.senses.length)       ? edits.senses    : (charEntry.senses ?? []);
  const background = edits.background ?? c.background ?? 'Unknown';
  const deity      = edits.deity ?? c.deity ?? 'None';
  const ancestryDisplay = `${c.ancestry ?? ''} ${c.heritage ?? ''}`.trim();
  const classDisplay = c.class ?? 'Unknown';
  const dualClass = c.dualClass ? ` / ${c.dualClass}` : '';
  const speedValue = statOverrides.speed ?? c.stats?.speed ?? ((c.attributes?.speed ?? 30) + (c.attributes?.speedBonus ?? 0));
  const sizeDisplay = c.size ?? c.stats?.size ?? '';
  const spellStatsLine = spellAttackBonus !== null ? ` · **Spell Attack** ${fmt(spellAttackBonus)} · **Spell DC** ${spellDC}` : '';
  const defenseData = c.defenses ?? c.defense ?? c.stats?.defenses ?? {};
  const weaknessText = formatDefenseList(
    charEntry.edits?.weaknesses, c.weaknesses, c.weakness, defenseData.weaknesses, defenseData.weakness,
  );
  const resistanceText = formatDefenseList(
    charEntry.edits?.resistances, c.resistances, c.resistance, defenseData.resistances, defenseData.resistance,
  );
  const immunityText = formatDefenseList(
    charEntry.edits?.immunities, c.immunities, c.immunity, defenseData.immunities, defenseData.immunity,
  );
  const savingThrowsText =
    `**Fort** ${fmt(fortMod)} \u00B7 **Reflex** ${fmt(reflexMod)} \u00B7 **Will** ${fmt(willMod)}\n` +
    `**Weaknesses:** ${weaknessText}\n` +
    `**Resistances:** ${resistanceText}\n` +
    `**Immunities:** ${immunityText}`;
  const embed = new EmbedBuilder()
    .setColor(0x7289DA)
    .setTitle(c.name)
    .setDescription(
      `*${ancestryDisplay} · ${classDisplay}${dualClass} · Level ${lvl}*\n` +
      `**Background:** ${background} · **Deity:** ${deity}\n` +
      `**XP:** ${xpDisplay}`
    )
    .addFields(
      { name: '⚔️ Core Stats', value: `**AC** ${statOverrides.ac ?? c.acTotal?.acTotal ?? '?'} · **HP** ${hpDisplay} · **Speed** ${speedValue} ft${sizeDisplay ? ` (${sizeDisplay})` : ''} · **Perception** ${fmt(percMod)}${spellStatsLine}`, inline: false },
      { name: '💪 Ability Scores', value: `**STR** ${ab.str ?? '?'} (${getMod(ab.str ?? 10)}) · **DEX** ${ab.dex ?? '?'} (${getMod(ab.dex ?? 10)}) · **CON** ${ab.con ?? '?'} (${getMod(ab.con ?? 10)})\n**INT** ${ab.int ?? '?'} (${getMod(ab.int ?? 10)}) · **WIS** ${ab.wis ?? '?'} (${getMod(ab.wis ?? 10)}) · **CHA** ${ab.cha ?? '?'} (${getMod(ab.cha ?? 10)})`, inline: false },
      { name: '🛡️ Saving Throws', value: `**Fort** ${fmt(fortMod)} · **Reflex** ${fmt(reflexMod)} · **Will** ${fmt(willMod)}`, inline: false },
      { name: '🎯 Trained Skills', value: allTrainedSkills.length > 0 ? `\`\`\`${skillCols}\`\`\`` : 'No trained skills', inline: false },
      ...(attackLines ? [{ name: '⚔️ Attacks', value: attackLines.trim(), inline: false }] : []),
      { name: '🌐 Languages', value: languages.length > 0 ? languages.join(', ') : 'None set — use `/char edit`', inline: true },
      { name: '👁️ Senses', value: senses.length > 0 ? senses.join(', ') : 'None set — use `/char edit`', inline: true },
      ...(overriddenFields.length > 0 ? [{ name: '⚠️ Manual overrides', value: `The following values are manually set (ignoring JSON): ${overriddenFields.join(', ')}. Use \`/char stat field:<field> action:clear\` to revert.`, inline: false }] : []),
    )
    .setFooter({ text: `Pathfinder 2e · Saved ${charEntry.saved?.split('T')[0] ?? ''}` });
  if (embed.data.fields?.[2]) embed.data.fields[2].value = savingThrowsText;
  if (charEntry.art) embed.setThumbnail(charEntry.art);
  return embed;
}

module.exports = { buildSheetEmbed };
