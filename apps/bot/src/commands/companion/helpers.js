const { EmbedBuilder } = require('discord.js');

const { fmt } = require('../../lib/format');
const { companionDatabase } = require('../../reference/databases');
const { scaleCompanionStats } = require('../../rules/companionScaling');
const { findSpecificFamiliar } = require('../../rules/specificFamiliars');

// Parse a catalog attack's "1d8 piercing" damage string into the shape the
// scaling engine wants: { damageDie, damageType }.
function parseCatalogDamage(damage) {
  const m = String(damage || '').match(/(\d+d\d+)\s*(\w*)/i);
  return { damageDie: m ? m[1] : '1d4', damageType: m ? (m[2] || '') : '' };
}

// Normalize a bot catalog entry into the scaling engine's `type` shape.
function catalogToScalingType(base) {
  const rawAttacks = (base.melee && base.melee.length) || (base.ranged && base.ranged.length)
    ? [...(base.melee || []), ...(base.ranged || [])]
    : (Array.isArray(base.attacks) ? base.attacks : []);
  return {
    abilityMods: base.abilities || {},
    ancestryHp: base.hp ?? 6,
    size: base.size || 'Medium',
    skill: base.skill ? String(base.skill).toLowerCase() : null,
    attacks: rawAttacks.map((a) => {
      const d = parseCatalogDamage(a.damage);
      return { name: a.name, traits: a.traits || [], damageDie: d.damageDie, damageType: d.damageType };
    }),
  };
}

// ── Companion lookup ─────────────────────────────────────────────────────────
function findCompanion(query) {
  if (!query) return { companion: null, matches: [] };
  const q = String(query).toLowerCase().trim();
  if (companionDatabase.length === 0) return { companion: null, matches: [] };

  // 1. Exact name match
  const exact = companionDatabase.find(c => c.name.toLowerCase() === q);
  if (exact) return { companion: exact, matches: [] };

  // 2. Starts-with match
  const starts = companionDatabase.filter(c => c.name.toLowerCase().startsWith(q));
  if (starts.length === 1) return { companion: starts[0], matches: [] };
  if (starts.length > 1) return { companion: null, matches: starts.map(c => c.name) };

  // 3. Contains match
  const contains = companionDatabase.filter(c => c.name.toLowerCase().includes(q));
  if (contains.length === 1) return { companion: contains[0], matches: [] };
  if (contains.length > 1) return { companion: null, matches: contains.map(c => c.name) };

  return { companion: null, matches: [] };
}

// Format an attack line for the companion embed:
//   "◆ **jaws** (finesse) — 1d8 piercing"
function formatCompanionAttack(atk) {
  const costIcon = atk.actionCost === 'one-action' ? '◆'
    : atk.actionCost === 'two-actions' ? '◆◆'
    : atk.actionCost === 'three-actions' ? '◆◆◆'
    : atk.actionCost === 'reaction' ? '⤾'
    : atk.actionCost === 'free-action' ? '◇'
    : `[${atk.actionCost}]`;
  const traits = atk.traits && atk.traits.length ? ` *(${atk.traits.join(', ')})*` : '';
  const damage = atk.damage ? ` — ${atk.damage}` : '';
  return `${costIcon} **${atk.name}**${traits}${damage}`;
}

// Format the ability scores line: "Str +2, Dex +3, Con +2, Int -4, Wis +1, Cha +0"
function formatCompanionAbilities(abilities) {
  const order = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
  return order.map(a => {
    const v = abilities[a] ?? 0;
    const sign = v >= 0 ? '+' : '';
    return `**${a.toUpperCase()}** ${sign}${v}`;
  }).join(' · ');
}

// Build the companion info embed. Shows the full Young-tier statblock with
// description, abilities, defenses, offense, support benefit, and maneuver.
function buildCompanionEmbed(companion) {
  // Category → color: Animal green, Construct gray, Plant forest, Undead crimson
  const colorByCategory = {
    Animal: 0x2ecc71,
    Construct: 0x95a5a6,
    Plant: 0x16a085,
    Undead: 0x8B0000,
  };
  const color = colorByCategory[companion.category] ?? 0x7289DA;
  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`🐾 ${companion.name}`)
    .setFooter({ text: `${companion.category} Companion · ${companion.source ?? 'Pathfinder 2e'}` });

  // Header line: traits + size + PFS
  // Normalize across the two catalog shapes (current uses tags + rarity,
  // older homebrew may use a traits array) into a single display list.
  // Excluding 'Common' rarity since it's the default and noise on the embed.
  const displayTraits = [
    ...(companion.rarity && String(companion.rarity).toLowerCase() !== 'common' ? [companion.rarity] : []),
    ...(Array.isArray(companion.tags) ? companion.tags : []),
    ...(Array.isArray(companion.traits) ? companion.traits : []),
  ];
  const traitsLine = displayTraits.length ? `*${displayTraits.join(', ')}*` : '';
  const sizeLine = companion.size ? `**Size:** ${companion.size}` : '';
  const header = [traitsLine, sizeLine].filter(Boolean).join(' · ');
  const descParts = [];
  if (header) descParts.push(header);
  if (companion.description) descParts.push(companion.description);
  if (companion.access) descParts.push(`**Access:** ${companion.access}`);
  if (descParts.length) embed.setDescription(descParts.join('\n\n').slice(0, 4000));

  // Abilities (inline)
  embed.addFields({
    name: '📊 Abilities',
    value: formatCompanionAbilities(companion.abilities),
    inline: false,
  });

  // Defenses: HP + senses
  const defParts = [];
  if (companion.hp !== null) defParts.push(`**HP** ${companion.hp}`);
  if (companion.speed) defParts.push(`**Speed** ${companion.speed}`);
  if (companion.skill) defParts.push(`**Skill** ${companion.skill}`);
  if (companion.senses && companion.senses.length) defParts.push(`**Senses** ${companion.senses.join(', ')}`);
  if (defParts.length) {
    embed.addFields({ name: '🛡️ Stats', value: defParts.join(' · '), inline: false });
  }

  // Attacks
  const attackLines = [];
  for (const a of companion.melee) attackLines.push('Melee: ' + formatCompanionAttack(a));
  for (const a of companion.ranged) attackLines.push('Ranged: ' + formatCompanionAttack(a));
  if (attackLines.length) {
    embed.addFields({ name: '⚔️ Attacks', value: attackLines.join('\n'), inline: false });
  }

  // Special abilities
  if (companion.special) {
    embed.addFields({ name: '✨ Special', value: companion.special.slice(0, 1020), inline: false });
  }

  // Support Benefit
  if (companion.support) {
    embed.addFields({ name: '🤝 Support Benefit', value: companion.support.slice(0, 1020), inline: false });
  }

  // Advanced Maneuver
  if (companion.maneuver) {
    const m = companion.maneuver;
    const actions = m.actions ? m.actions.replace(/\[([^\]]+)\]/, '$1') : '';
    const traits = m.traits && m.traits.length ? ` · *${m.traits.join(' ')}*` : '';
    const heading = `💥 Advanced Maneuver: ${m.name}${actions ? ` (${actions})` : ''}${traits}`;
    const body = m.description ?
      m.description.replace(/^Source .+?pg\.\s*\d+\s*/i, '').slice(0, 1020) :
      '*No description available.*';
    embed.addFields({ name: heading.slice(0, 256), value: body, inline: false });
  }

  return embed;
}

// Build a paginated list embed of companions, optionally filtered by category.
function buildCompanionListEmbed(category, page = 0) {
  const filtered = category
    ? companionDatabase.filter(c => c.category.toLowerCase() === category.toLowerCase())
    : companionDatabase;
  const perPage = 40; // just list names, so we can fit a lot
  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
  const actualPage = Math.min(page, totalPages - 1);
  const start = actualPage * perPage;
  const slice = filtered.slice(start, start + perPage);

  const title = category
    ? `🐾 ${category} Companions`
    : `🐾 Animal Companions`;
  const embed = new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle(title)
    .setDescription(slice.map(c => {
      // Your catalog stores rarity as a top-level string ("Common", "Uncommon",
      // "Rare", "Unique") and tags as a separate array. Older code assumed a
      // single traits array containing both. Normalize defensively so a
      // missing field never crashes the embed build.
      const rarity = String(c.rarity ?? '').toLowerCase();
      const tag = rarity === 'uncommon' ? ' *(uncommon)*'
                : rarity === 'rare'     ? ' *(rare)*'
                : rarity === 'unique'   ? ' *(unique)*'
                : '';
      return `• **${c.name}**${tag}`;
    }).join('\n') || '*No companions match this filter.*')
    .setFooter({ text: `${filtered.length} total${totalPages > 1 ? ` · Page ${actualPage + 1}/${totalPages}` : ''} · Use /companion info name:<name> for details` });
  return embed;
}

function parseImportedCompanionDamage(damage) {
  const match = String(damage ?? '').trim().match(/^(\d+d\d+)([+-]\d+)?$/i);
  return {
    dice: (match?.[1] ?? String(damage ?? '').trim()) || '1d4',
    bonus: match?.[2] ? Number.parseInt(match[2], 10) : 0,
  };
}

function importedCompanionToTrackedCompanion(parsed, { displayName, form } = {}) {
  const attacks = Array.isArray(parsed.attacks) ? parsed.attacks : [];
  const primary = attacks[0] ?? null;
  const primaryDamage = parseImportedCompanionDamage(primary?.damage);
  const sourceLevel = Math.max(1, Number(parsed.sourceLevel ?? 1));
  const hp = Number(parsed.hp ?? 10);
  const hpPerLevel = Math.max(1, Math.round(hp / sourceLevel));
  const customAbilities = [];

  if (parsed.support) {
    customAbilities.push({ name: 'Support Benefit', description: parsed.support });
  }
  if (parsed.additional) {
    customAbilities.push({ name: 'Additional Specials', description: parsed.additional });
  }
  if (parsed.unsteady) {
    customAbilities.push({ name: 'Unsteady Mount', description: parsed.unsteady });
  }

  const noteParts = [`Imported from companion PDF: ${parsed.sourceName ?? 'unknown statblock'}.`];
  if (parsed.traits?.length) noteParts.push(`Traits: ${parsed.traits.join(', ')}.`);
  if (parsed.senses) noteParts.push(`Senses: ${parsed.senses}.`);
  if (parsed.languages?.length) noteParts.push(`Languages: ${parsed.languages.join(', ')}.`);
  if (parsed.items?.length) noteParts.push(`Items: ${parsed.items.join(', ')}.`);

  return {
    displayName: displayName || parsed.displayName || parsed.baseName || 'Imported Companion',
    baseType: 'custom',
    form: form || parsed.form || 'young',
    notes: noteParts.join(' '),
    customStats: {
      fromPdf: true,
      sourceName: parsed.sourceName,
      sourceLevel: parsed.sourceLevel,
      size: parsed.size ?? 'Medium',
      speed: parsed.speed ?? '25 feet',
      hp,
      hpPerLevel,
      ac: parsed.ac ?? 10,
      abilities: parsed.abilities ?? {},
      attacks: primary ? [{
        name: primary.name,
        damage: `${primaryDamage.dice} ${primary.damageType ?? ''}`.trim(),
        traits: primary.traits ?? [],
      }] : [],
      traits: parsed.traits ?? [],
      senses: parsed.senses ?? '',
      languages: parsed.languages ?? [],
      items: parsed.items ?? [],
    },
    overrides: {
      hp,
      ac: parsed.ac ?? 10,
      perception: parsed.perception ?? 0,
      speed: parsed.speed ?? '25 feet',
      size: parsed.size ?? 'Medium',
      abilities: parsed.abilities ?? {},
      saves: parsed.saves ?? {},
      ...(primary ? {
        attackBonus: primary.bonus,
        damageDice: primaryDamage.dice,
        damageBonus: primaryDamage.bonus,
      } : {}),
    },
    skills: parsed.skills ?? {},
    customAttacks: attacks.slice(1).map(atk => ({
      name: atk.name,
      bonus: atk.bonus,
      damage: atk.damage,
      damageType: atk.damageType,
      traits: atk.traits ?? [],
    })),
    customAbilities,
    currentHp: hp,
    importedFromPdf: true,
  };
}


// Which kind of companion a tracked row is. The website writes
// custom_stats.kind ('animal' | 'mount' | 'familiar' | 'eidolon' | 'custom');
// rows created before that field exists are animal-companion-shaped.
function companionKind(comp) {
  return comp.webStats?.kind ?? (comp.baseType === 'custom' ? 'custom' : 'animal');
}

// "touch-telepathy" → "Touch Telepathy" (display for web-stored ability slugs).
function titleCaseSlug(slug) {
  return String(slug ?? '')
    .split('-')
    .map(w => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}

// Scale a companion's combat stats by character level + form.
function scaleCompanion(comp, char) {
  const lvl = char.level ?? 1;
  const form = comp.form ?? 'young';

  // Familiars don't scale like animal companions: HP is 5 × the master's
  // level, Speed 25 feet, and AC/saves use the master's own modifiers. The
  // sheet embed renders those as "as master"; only maxHp matters here (it
  // seeds currentHp).
  if (companionKind(comp) === 'familiar') {
    return {
      maxHp: 5 * lvl, ac: null, attackBonus: null, damageDice: null, damageType: '',
      damageBonus: 0, saves: {}, form, size: 'Tiny', speed: '25 feet',
      primaryAttack: null, abilities: {}, attacks: [], perception: null,
      overriddenFields: [], kind: 'familiar',
    };
  }
  const ov = comp.overrides ?? {};

  // Custom (PDF-imported) companions keep their existing override-driven path:
  // they carry their own stat block, so the animal-companion advancement
  // formulas don't apply. Only catalog companions go through the corrected
  // engine below.
  if (comp.baseType === 'custom' && comp.customStats) {
    const baseHp = comp.customStats.hpPerLevel ?? (() => {
      const s = (comp.customStats.size ?? 'Medium').toLowerCase();
      if (s === 'tiny') return 4;
      if (s === 'small') return 6;
      if (s === 'medium') return 8;
      if (s === 'large') return 10;
      if (s === 'huge') return 12;
      return 8;
    })();
    const abilities = comp.customStats.abilities ?? {};
    const attacks = comp.customStats.attacks ?? [];
    const size = comp.customStats.size ?? 'Medium';
    const speed = comp.customStats.speed ?? '25 feet';
    const conMod = abilities.con ?? 0;
    let maxHp;
    if (form === 'young') maxHp = baseHp * lvl;
    else if (form === 'mature') maxHp = (baseHp + conMod) * lvl;
    else maxHp = (baseHp + conMod + 1) * lvl;
    if (maxHp < baseHp) maxHp = baseHp;
    const profBonus = form === 'young' ? lvl : form === 'mature' ? lvl + 2 : lvl + 4;
    const dexMod = abilities.dex ?? 0;
    const ac = 10 + dexMod + profBonus;
    const saves = { fort: profBonus + conMod, ref: profBonus + dexMod, will: profBonus + (abilities.wis ?? 0) };
    const primary = attacks[0];
    const isFinesse = primary?.traits?.includes('finesse');
    const strMod = abilities.str ?? 0;
    const abilForAttack = isFinesse && dexMod > strMod ? dexMod : strMod;
    const attackBonus = profBonus + abilForAttack;
    let damageDice = '1d4', damageType = '';
    if (primary?.damage) {
      const m = primary.damage.match(/(\d+)d(\d+)\s*(\w*)/);
      if (m) {
        let dieSize = parseInt(m[2], 10);
        if (form === 'savage') dieSize = Math.min(12, dieSize + 2);
        damageDice = `${m[1]}d${dieSize}`;
        damageType = m[3] || '';
      }
    }
    const result = { maxHp, ac, attackBonus, damageDice, damageType, damageBonus: strMod, saves, form, size, speed, primaryAttack: primary, abilities, attacks, specialization: null, typeSkill: null };
    return applyCompanionOverrides(result, ov, profBonus, abilities.wis ?? 0);
  }

  // Catalog companions: corrected advancement engine (mirrors @pathway/core,
  // Player Core pg. 206-211). Reads the website-chosen specialization from the
  // round-tripped custom_stats (webStats.specialization).
  const { companion: base } = findCompanion(comp.baseType);
  if (!base) return { maxHp: 10, ac: 10, attackBonus: 0, damageDice: '1d4', form, abilities: {}, saves: { fort: 0, ref: 0, will: 0 }, size: 'Medium', speed: '25 feet', damageType: '', damageBonus: 0, attacks: [], primaryAttack: null, specialization: null, typeSkill: null, overriddenFields: [] };
  const type = catalogToScalingType(base);
  const specialization = comp.webStats?.specialization ?? null;
  const scaled = scaleCompanionStats(type, lvl, form, 0, specialization);
  const primary = scaled.attacks[0] ?? null;
  const result = {
    maxHp: scaled.maxHp,
    ac: scaled.ac,
    attackBonus: primary ? primary.attack : 0,
    damageDice: primary ? primary.damage : '1d4',
    damageType: primary ? primary.damageType : '',
    damageBonus: primary ? primary.damageBonus : 0,
    saves: { fort: scaled.saves.fortitude, ref: scaled.saves.reflex, will: scaled.saves.will },
    form,
    size: scaled.size,
    speed: base.speed ?? '25 feet',
    primaryAttack: primary ? { name: primary.name, traits: primary.traits } : null,
    abilities: scaled.abilityMods,
    attacks: scaled.attacks,
    specialization: scaled.specialization ? { slug: scaled.specialization.slug, name: scaled.specialization.name } : null,
    typeSkill: scaled.skill,
  };
  // Perception's proficiency component = scaled.perception minus its Wis mod;
  // applyCompanionOverrides re-adds the (possibly overridden) Wis.
  const perceptionProf = scaled.perception - (scaled.abilityMods.wis || 0);
  return applyCompanionOverrides(result, ov, perceptionProf, scaled.abilityMods.wis || 0);
}

// Apply per-companion overrides on top of a computed result. Any field set to a
// non-null value in `overrides` replaces the computed value, so players can
// tweak stats without losing the automatic scaling for untouched fields.
// `perceptionProf` + `baseWis` reconstruct Perception when Wis is overridden.
function applyCompanionOverrides(result, ov, perceptionProf, baseWis) {
  ov = ov ?? {};
  if (ov.hp != null)           result.maxHp = ov.hp;
  if (ov.ac != null)           result.ac = ov.ac;
  if (ov.attackBonus != null)  result.attackBonus = ov.attackBonus;
  if (ov.damageDice)           result.damageDice = ov.damageDice;
  if (ov.damageBonus != null)  result.damageBonus = ov.damageBonus;
  if (ov.speed)                result.speed = ov.speed;
  if (ov.size)                 result.size = ov.size;
  if (ov.abilities) {
    result.abilities = { ...result.abilities };
    for (const key of ['str', 'dex', 'con', 'int', 'wis', 'cha']) {
      if (ov.abilities[key] != null) result.abilities[key] = ov.abilities[key];
    }
  }
  if (ov.saves) {
    result.saves = { ...result.saves };
    for (const key of ['fort', 'ref', 'will']) {
      if (ov.saves[key] != null) result.saves[key] = ov.saves[key];
    }
  }
  const finalWis = (ov.abilities && ov.abilities.wis != null) ? ov.abilities.wis : baseWis;
  result.perception = perceptionProf + finalWis;
  if (ov.perception != null) result.perception = ov.perception;

  result.overriddenFields = [];
  if (ov.hp != null) result.overriddenFields.push('HP');
  if (ov.ac != null) result.overriddenFields.push('AC');
  if (ov.attackBonus != null) result.overriddenFields.push('attack');
  if (ov.damageDice) result.overriddenFields.push('damage');
  if (ov.damageBonus != null) result.overriddenFields.push('dmg bonus');
  if (ov.speed) result.overriddenFields.push('speed');
  if (ov.size) result.overriddenFields.push('size');
  if (ov.perception != null) result.overriddenFields.push('perception');
  if (ov.abilities && Object.values(ov.abilities).some(v => v != null)) result.overriddenFields.push('abilities');
  if (ov.saves && Object.values(ov.saves).some(v => v != null)) result.overriddenFields.push('saves');

  return result;
}

// Familiar sheet — the website stores the chosen abilities as slugs in
// custom_stats.familiar.abilities; stats follow the familiar rules (HP 5×level,
// Speed 25 ft, AC/saves as the master's).
function buildFamiliarSheetEmbed(comp, scaled, char, charEntry, isActive) {
  const fam = comp.webStats?.familiar ?? {};
  const specific = findSpecificFamiliar(fam.specific);
  const embed = new EmbedBuilder()
    .setColor(isActive ? 0xf39c12 : 0x9b59b6)
    .setTitle(`🦉 ${comp.displayName}${isActive ? ' ⭐' : ''}`)
    .setDescription(specific
      ? `*${char.name}'s ${specific.name} — ${specific.source}*`
      : `*${char.name}'s familiar*`);
  if (comp.art) embed.setThumbnail(comp.art);
  else if (charEntry.art) embed.setThumbnail(charEntry.art);

  const hp = comp.currentHp ?? scaled.maxHp;
  embed.addFields({
    name: '🛡️ Stats',
    value: `**HP** ${hp}/${scaled.maxHp} · **Speed** 25 feet · **AC & saves** as ${char.name}'s`,
    inline: false,
  });

  // A specific familiar's granted abilities are innate and always present; its
  // unique abilities are listed by name (full text on the website).
  if (specific) {
    const parts = [`**Granted (innate):** ${specific.granted.map(titleCaseSlug).join(', ')}`];
    if (specific.unique.length) parts.push(`**Unique:** ${specific.unique.join(', ')}`);
    if (specific.access) parts.push(`*Access: ${specific.access}*`);
    embed.addFields({ name: `⭐ Specific Familiar`, value: parts.join('\n').slice(0, 1020), inline: false });
  }

  const slugs = fam.abilities ?? [];
  const limit = fam.limit ?? 2;
  const consumed = specific ? specific.required : 0;
  const free = Math.max(0, limit - consumed);
  embed.addFields({
    name: `✨ Chosen Abilities (${slugs.length}/${free})`,
    value: slugs.length
      ? slugs.map(s => `• ${titleCaseSlug(s)}`).join('\n').slice(0, 1020)
      : '*None selected — pick them on the website or with your daily preparations.*',
    inline: false,
  });

  if (comp.notes) embed.addFields({ name: '📝 Notes', value: comp.notes.slice(0, 1020), inline: false });
  embed.setFooter({ text: `Character: ${char.name} · managed on the Pathway website` });
  return embed;
}

// Eidolon sheet — the website stores the subtype in custom_stats.eidolon.type.
// Full eidolon stat scaling isn't modeled yet; show identity + notes.
function buildEidolonSheetEmbed(comp, char, charEntry, isActive) {
  const subtype = titleCaseSlug(comp.webStats?.eidolon?.type ?? '') || 'Eidolon';
  const embed = new EmbedBuilder()
    .setColor(isActive ? 0xf39c12 : 0x1abc9c)
    .setTitle(`👁️ ${comp.displayName}${isActive ? ' ⭐' : ''}`)
    .setDescription(`*${char.name}'s ${subtype} eidolon — shares ${char.name}'s level (${char.level ?? 1}) and actions*`);
  if (comp.art) embed.setThumbnail(comp.art);
  else if (charEntry.art) embed.setThumbnail(charEntry.art);
  if (comp.currentHp != null) {
    embed.addFields({ name: '🛡️ HP', value: `${comp.currentHp}`, inline: false });
  }
  if (comp.notes) embed.addFields({ name: '📝 Notes', value: comp.notes.slice(0, 1020), inline: false });
  embed.setFooter({ text: `Character: ${char.name} · managed on the Pathway website` });
  return embed;
}

function buildCompanionSheetEmbed(comp, scaled, char, charEntry, isActive) {
  const kind = companionKind(comp);
  if (kind === 'familiar') return buildFamiliarSheetEmbed(comp, scaled, char, charEntry, isActive);
  if (kind === 'eidolon') return buildEidolonSheetEmbed(comp, char, charEntry, isActive);

  const customLabel = comp.customStats?.fromBestiary ?? comp.customStats?.sourceName ?? 'custom';
  const kindWord = kind === 'mount' ? 'mount' : 'companion';
  // "specialized (Wrecker)" when a specialization is applied, else the form.
  const formLabel = scaled.specialization
    ? `specialized (${scaled.specialization.name})`
    : comp.form;
  const embed = new EmbedBuilder()
    .setColor(isActive ? 0xf39c12 : 0x7289DA)
    .setTitle(`🐾 ${comp.displayName}${isActive ? ' ⭐' : ''}`)
    .setDescription(`*${char.name}'s ${formLabel} ${comp.baseType === 'custom' ? customLabel : comp.baseType} ${kindWord}*`);

  // Show portrait if set. Prefer companion.art, fall back to character art.
  if (comp.art) embed.setThumbnail(comp.art);
  else if (charEntry.art) embed.setThumbnail(charEntry.art);

  // Mark overridden fields with a small visible flag
  const ov = comp.overrides ?? {};
  const flag = (key) => ov[key] != null ? ' ✏️' : '';
  const abFlag = (key) => (ov.abilities && ov.abilities[key] != null) ? '\\*' : '';
  const saveFlag = (key) => (ov.saves && ov.saves[key] != null) ? '\\*' : '';

  const hp = comp.currentHp ?? scaled.maxHp;
  embed.addFields({ name: '🛡️ Defenses', value: `**HP** ${hp}/${scaled.maxHp}${flag('hp')} · **AC** ${scaled.ac}${flag('ac')} · **Size** ${scaled.size}${flag('size')} · **Speed** ${scaled.speed}${flag('speed')}`, inline: false });
  embed.addFields({ name: '💪 Saves', value: `**Fort** ${fmt(scaled.saves.fort)}${saveFlag('fort')} · **Ref** ${fmt(scaled.saves.ref)}${saveFlag('ref')} · **Will** ${fmt(scaled.saves.will)}${saveFlag('will')} · **Perception** ${fmt(scaled.perception)}${flag('perception')}`, inline: false });
  const ab = scaled.abilities;
  embed.addFields({ name: '📊 Abilities', value: `Str ${fmt(ab.str ?? 0)}${abFlag('str')} · Dex ${fmt(ab.dex ?? 0)}${abFlag('dex')} · Con ${fmt(ab.con ?? 0)}${abFlag('con')} · Int ${fmt(ab.int ?? -4)}${abFlag('int')} · Wis ${fmt(ab.wis ?? 0)}${abFlag('wis')} · Cha ${fmt(ab.cha ?? 0)}${abFlag('cha')}`, inline: false });

  // Skills: the companion type's trained skill (computed) plus any override
  // skills added via /companion set. Display alphabetically, type skill first.
  const skills = { ...(comp.skills ?? {}) };
  if (scaled.typeSkill && skills[scaled.typeSkill.name] == null) {
    skills[scaled.typeSkill.name] = scaled.typeSkill.modifier;
  }
  const skillEntries = Object.entries(skills).sort(([a], [b]) => a.localeCompare(b));
  if (skillEntries.length > 0) {
    const line = skillEntries.map(([name, bonus]) => `**${titleCaseSlug(name)}** ${fmt(bonus)}`).join(' · ');
    embed.addFields({ name: '🎯 Skills', value: line.slice(0, 1020), inline: false });
  }

  // Attacks: primary (from catalog/custom, with scaling) + any custom attacks
  // added via /companion attack add. Show all of them.
  const attackLines = [];
  if (scaled.primaryAttack) {
    const traits = scaled.primaryAttack.traits?.length ? ` *(${scaled.primaryAttack.traits.join(', ')})*` : '';
    const dmgBonus = scaled.damageBonus !== 0 ? (scaled.damageBonus > 0 ? `+${scaled.damageBonus}` : `${scaled.damageBonus}`) : '';
    attackLines.push(`**${scaled.primaryAttack.name}**${traits} — **+${scaled.attackBonus}**${flag('attackBonus')} to hit · **${scaled.damageDice}${flag('damageDice')}${dmgBonus}${flag('damageBonus')}** ${scaled.damageType}`);
  }
  if (Array.isArray(comp.customAttacks) && comp.customAttacks.length) {
    for (const atk of comp.customAttacks) {
      const traits = atk.traits?.length ? ` *(${atk.traits.join(', ')})*` : '';
      const bonusText = atk.bonus != null ? `**${fmt(atk.bonus)}** to hit · ` : '';
      const dmgText = atk.damage ? `**${atk.damage}** ${atk.damageType ?? ''}` : '';
      attackLines.push(`**${atk.name}**${traits} — ${bonusText}${dmgText}`);
    }
  }
  if (attackLines.length) {
    embed.addFields({ name: '⚔️ Attacks', value: attackLines.join('\n').slice(0, 1020), inline: false });
  }

  // Abilities: free-form text abilities + structured maneuver-style ones
  if (Array.isArray(comp.customAbilities) && comp.customAbilities.length) {
    const abilityLines = comp.customAbilities.map(a => {
      if (a.actionCost) {
        const costIcon = { 'one-action': '◆', 'two-actions': '◆◆', 'three-actions': '◆◆◆', 'reaction': '⤾', 'free-action': '◇' }[a.actionCost] ?? a.actionCost;
        return `**${a.name}** ${costIcon} — ${a.description}`;
      }
      return `**${a.name}** — ${a.description}`;
    });
    embed.addFields({ name: '✨ Abilities', value: abilityLines.join('\n').slice(0, 1020), inline: false });
  }

  if (comp.notes) embed.addFields({ name: '📝 Notes', value: comp.notes.slice(0, 1020), inline: false });
  const hasOverrides = (scaled.overriddenFields ?? []).length > 0;
  const footerExtra = hasOverrides ? ` · ✏️ = overridden` : '';
  embed.setFooter({ text: `Character: ${char.name} · /companion set to customize${footerExtra}` });
  return embed;
}

module.exports = {
  findCompanion,
  companionKind,
  buildCompanionEmbed,
  buildCompanionListEmbed,
  importedCompanionToTrackedCompanion,
  scaleCompanion,
  buildCompanionSheetEmbed,
};
