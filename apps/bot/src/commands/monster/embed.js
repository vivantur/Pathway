const { EmbedBuilder } = require('discord.js');

// Format a single ability score modifier for the embed (e.g. "+3", "-1").
function fmtMod(n) {
  if (n === undefined || n === null) return null;
  return n >= 0 ? `+${n}` : `${n}`;
}

// Icons for PF2e action costs. Falls back to the raw string for unexpected values
// (e.g. "1 varies", "none", campaign-specific costs).
function actionCostIcon(cost) {
  if (!cost) return '';
  const c = String(cost).toLowerCase().trim();
  const map = {
    '1 action': '◆',
    'single action': '◆',
    '2 actions': '◆◆',
    'two actions': '◆◆',
    '3 actions': '◆◆◆',
    'three actions': '◆◆◆',
    '1 reaction': '⤾',
    'reaction': '⤾',
    '1 free': '◇',
    'free action': '◇',
    'none': '',
  };
  return map[c] ?? cost;
}

// Format one entry from the attacks array. Strikes look like:
//   ⚔️ dogslicer +8 (agile, backstabber, finesse), 1d6 slashing
function formatAttackLine(attack) {
  if (!attack) return '';
  const typeIcon = attack.type === 'ranged' ? '🏹' : '⚔️';
  const to = attack.to_hit !== undefined && attack.to_hit !== null
    ? ` ${attack.to_hit >= 0 ? '+' : ''}${attack.to_hit}`
    : '';
  const traits = Array.isArray(attack.traits) && attack.traits.length
    ? ` *(${attack.traits.join(', ')})*`
    : '';
  const dmg = attack.damage ? `, ${attack.damage}` : '';
  return `${typeIcon} **${attack.name}**${to}${traits}${dmg}`;
}

// Format one ability from the abilities.top/mid/bot arrays for the embed body.
// Kept compact — full descriptions can run long, so we truncate to 350 chars
// per ability to avoid blowing out the embed's 4096-char description cap.
function formatAbilityLine(ab) {
  if (!ab || !ab.name) return '';
  const icon = ab.action_cost ? actionCostIcon(ab.action_cost) : '';
  const iconPrefix = icon ? `${icon} ` : '';
  const traits = Array.isArray(ab.traits) && ab.traits.length
    ? ` *[${ab.traits.join(', ')}]*`
    : '';
  let body = '';
  if (ab.trigger)      body += `\n  *Trigger:* ${ab.trigger}`;
  if (ab.requirements) body += `\n  *Requirements:* ${ab.requirements}`;
  if (ab.frequency)    body += `\n  *Frequency:* ${ab.frequency}`;
  if (ab.description) {
    const desc = String(ab.description);
    body += `\n  ${desc.length > 350 ? desc.slice(0, 347) + '...' : desc}`;
  }
  return `${iconPrefix}**${ab.name}**${traits}${body}`;
}

// Schema-aware monster embed builder. Works with both the new merged bestiary
// shape ({ core, rich, summary }) and the legacy summary-only shape that
// used to live at the top level. Renders the full PF2e stat block when rich
// data is available: ability scores, skills, languages, items, attacks,
// abilities (top/mid/bot), spellcasting, plus the embed-only lore/tactics.
function buildMonsterEmbed(monster, artUrl = null) {
  const rarityColor = {
    Common: 0x4a90d9,
    Uncommon: 0xc45f00,
    Rare: 0x6b21a8,
    Unique: 0xb91c4a,
  };
  const sizeEmoji = {
    Tiny: '🐁', Small: '🐇', Medium: '🧍', Large: '🐎',
    Huge: '🐘', Gargantuan: '🐲',
  };

  // Prefer the flattened `core` block from the merged schema; fall back to
  // legacy `summary` and top-level fields for older bestiary files.
  const core = monster.core ?? {};
  const legacySummary = monster.summary ?? {};
  const rich = monster.rich ?? null;

  const level      = core.level      ?? legacySummary.level;
  const size       = core.size       ?? monster.size;
  const rarity     = core.rarity     ?? monster.rarity;
  const traits     = core.traits     ?? monster.traits ?? [];
  const hp         = core.hp         ?? legacySummary.hp?.value;
  const hpNotes    = legacySummary.hp?.notes ?? null;
  const ac         = core.ac         ?? legacySummary.ac;
  const perception = core.perception ?? legacySummary.perception;
  const fort = core.saves?.fort ?? legacySummary.fortitude;
  const ref  = core.saves?.ref  ?? legacySummary.reflex;
  const will = core.saves?.will ?? legacySummary.will;

  // Speed: rich has a structured object { land, fly, swim, ... };
  // summary has a raw string like "30 feet, fly 60 feet".
  let speedText = legacySummary.speed_raw ?? null;
  if (!speedText && rich?.speed) {
    speedText = Object.entries(rich.speed).map(([k, v]) => `${k} ${v} ft.`).join(', ');
  }

  // Senses: summary has senses_raw; rich has an array.
  const sensesText = legacySummary.senses_raw
    ?? (rich?.senses?.length ? rich.senses.join(', ') : null);

  const family = monster.family ?? null;

  const title = `${sizeEmoji[size] ?? '👹'} ${monster.name}`;
  const levelLine = level !== undefined && level !== null ? `Creature ${level}` : 'Creature';
  const rarityLine = rarity && rarity !== 'Common' ? ` • ${rarity}` : '';
  const sizeLine = size ? ` • ${size}` : '';

  // Description can come from the overlay (flavor text the GM set) or from
  // the bestiary's own summary. Only show it if present, and keep the header
  // block italicized so it reads as the subtitle.
  const headerDescription = `*${levelLine}${rarityLine}${sizeLine}*`;
  const editDescription = rich?.description ? `\n\n${String(rich.description).slice(0, 600)}` : '';

  const embed = new EmbedBuilder()
    .setColor(rarityColor[rarity] ?? 0x4a90d9)
    .setTitle(title)
    .setDescription(`${headerDescription}${editDescription}`);

  if (traits.length) {
    embed.addFields({ name: '🏷️ Traits', value: traits.join(', '), inline: false });
  }

  // Languages — rich only, but if a GM edit set them they'll be here too.
  if (rich?.languages?.length) {
    embed.addFields({ name: '🗣️ Languages', value: rich.languages.join(', '), inline: false });
  }

  // Skills — rich only. Show as "Athletics +8, Stealth +5" etc.
  if (rich?.skills && typeof rich.skills === 'object' && Object.keys(rich.skills).length) {
    const skillLine = Object.entries(rich.skills)
      .map(([name, mod]) => `${name} ${mod >= 0 ? '+' : ''}${mod}`)
      .join(', ');
    embed.addFields({ name: '🎯 Skills', value: skillLine.slice(0, 1024), inline: false });
  }

  // Ability scores — rich only, shown as a compact row. These are PF2e
  // modifiers (already the ±N form), not D&D-style raw scores.
  if (rich?.ability_modifiers && typeof rich.ability_modifiers === 'object') {
    const m = rich.ability_modifiers;
    const parts = [];
    if (m.str !== undefined) parts.push(`**Str** ${fmtMod(m.str)}`);
    if (m.dex !== undefined) parts.push(`**Dex** ${fmtMod(m.dex)}`);
    if (m.con !== undefined) parts.push(`**Con** ${fmtMod(m.con)}`);
    if (m.int !== undefined) parts.push(`**Int** ${fmtMod(m.int)}`);
    if (m.wis !== undefined) parts.push(`**Wis** ${fmtMod(m.wis)}`);
    if (m.cha !== undefined) parts.push(`**Cha** ${fmtMod(m.cha)}`);
    if (parts.length) {
      embed.addFields({ name: '📊 Ability Modifiers', value: parts.join(' · '), inline: false });
    }
  }

  // Items — rich only. Simple comma-joined.
  if (rich?.items?.length) {
    embed.addFields({ name: '🎒 Items', value: rich.items.join(', ').slice(0, 1024), inline: false });
  }

  // Defenses
  const defenseParts = [];
  if (ac !== undefined && ac !== null) defenseParts.push(`**AC** ${ac}`);
  if (hp !== undefined && hp !== null) {
    const notes = hpNotes ? ` ${hpNotes}` : '';
    defenseParts.push(`**HP** ${hp}${notes}`);
  }
  // Extra defensive stats that only live in the rich stat block
  if (rich?.defenses?.hardness) defenseParts.push(`**Hardness** ${rich.defenses.hardness}`);
  if (rich?.defenses?.hp_notes?.length) {
    defenseParts.push(`*${rich.defenses.hp_notes.join(', ')}*`);
  }
  if (defenseParts.length) {
    embed.addFields({ name: '🛡️ Defenses', value: defenseParts.join(' • '), inline: false });
  }

  // Immunities / weaknesses / resistances — rich only
  if (rich?.defenses?.immunities?.length) {
    embed.addFields({ name: '🚫 Immunities', value: rich.defenses.immunities.join(', ').slice(0, 1024), inline: false });
  }
  if (rich?.defenses?.weaknesses?.length) {
    const w = rich.defenses.weaknesses.map(x =>
      typeof x === 'string' ? x : `${x.type} ${x.value}`
    ).join(', ');
    embed.addFields({ name: '💔 Weaknesses', value: w.slice(0, 1024), inline: false });
  }
  if (rich?.defenses?.resistances?.length) {
    const r = rich.defenses.resistances.map(x =>
      typeof x === 'string' ? x : `${x.type} ${x.value}${x.notes ? ` (${x.notes})` : ''}`
    ).join(', ');
    embed.addFields({ name: '💠 Resistances', value: r.slice(0, 1024), inline: false });
  }

  // Saves
  const saveParts = [];
  if (fort !== undefined && fort !== null) saveParts.push(`**Fort** ${fort >= 0 ? '+' : ''}${fort}`);
  if (ref  !== undefined && ref  !== null) saveParts.push(`**Ref** ${ref >= 0 ? '+' : ''}${ref}`);
  if (will !== undefined && will !== null) saveParts.push(`**Will** ${will >= 0 ? '+' : ''}${will}`);
  if (saveParts.length) {
    embed.addFields({ name: '💪 Saves', value: saveParts.join(' • '), inline: true });
  }

  // Perception (+ senses inline)
  if (perception !== undefined && perception !== null) {
    const percStr = `${perception >= 0 ? '+' : ''}${perception}`;
    const sensesSuffix = sensesText ? ` (${sensesText})` : '';
    embed.addFields({ name: '👁️ Perception', value: `${percStr}${sensesSuffix}`, inline: true });
  }

  // Speed
  if (speedText) {
    embed.addFields({ name: '🏃 Speed', value: speedText, inline: false });
  }

  // Attacks — rendered as one field with one line per attack
  if (rich?.attacks?.length) {
    const attackLines = rich.attacks.map(formatAttackLine).filter(Boolean);
    if (attackLines.length) {
      const joined = attackLines.join('\n');
      embed.addFields({
        name: '⚔️ Attacks',
        value: joined.length > 1024 ? joined.slice(0, 1021) + '...' : joined,
        inline: false,
      });
    }
  }

  // Abilities — rendered as separate fields per slot so the PF2e stat block
  // reads naturally (top-of-block before HP, mid between defenses and offense,
  // bot as the attacks/special actions region).
  for (const [slot, label] of [['top', '✨ Special Abilities (Top)'], ['mid', '✨ Abilities'], ['bot', '✨ Offensive / Reactive']]) {
    const list = rich?.abilities?.[slot];
    if (!list?.length) continue;
    const lines = list.map(formatAbilityLine).filter(Boolean);
    if (!lines.length) continue;
    // Discord caps individual fields at 1024 chars — chunk if needed so big
    // creatures (dragons, liches) don't get truncated to one ability.
    let buf = '';
    let partIdx = 1;
    const emit = () => {
      if (!buf) return;
      const suffix = partIdx > 1 ? ` (${partIdx})` : '';
      embed.addFields({ name: `${label}${suffix}`, value: buf.trim(), inline: false });
      partIdx++;
      buf = '';
    };
    for (const line of lines) {
      if (buf.length + line.length + 2 > 1000) emit();
      buf += (buf ? '\n\n' : '') + line;
    }
    emit();
  }

  // Spellcasting — condensed summary; each caster block gets one field.
  if (Array.isArray(rich?.spellcasting) && rich.spellcasting.length) {
    for (const caster of rich.spellcasting) {
      const heading = [caster.type, caster.tradition].filter(Boolean).join(' ') || 'Spells';
      const dcBits = [];
      if (caster.DC !== null && caster.DC !== undefined) dcBits.push(`DC ${caster.DC}`);
      if (caster.attack_bonus !== null && caster.attack_bonus !== undefined) dcBits.push(`attack ${caster.attack_bonus >= 0 ? '+' : ''}${caster.attack_bonus}`);
      const header = dcBits.length ? `*${dcBits.join(', ')}*\n` : '';
      const lines = [];
      const slots = caster.spells_by_level ?? {};
      // Sort numerically; cantrips usually live at level 0
      const levels = Object.keys(slots).sort((a, b) => Number(b) - Number(a));
      for (const lvl of levels) {
        const spellNames = (slots[lvl]?.spells ?? []).map(s => {
          const n = s.name ?? String(s);
          const notes = s.notes?.length ? ` *(${s.notes.join(', ')})*` : '';
          return `${n}${notes}`;
        });
        if (!spellNames.length) continue;
        const label = lvl === '0' ? 'Cantrips' : `Rank ${lvl}`;
        lines.push(`**${label}:** ${spellNames.join(', ')}`);
      }
      const body = (header + lines.join('\n')).slice(0, 1024);
      if (body.trim()) {
        embed.addFields({ name: `🔮 ${heading.charAt(0).toUpperCase() + heading.slice(1)} Spells`, value: body, inline: false });
      }
    }
  }

  // Rich-only goodies: lore + GM tactics. These are what make Pathway
  // distinctly better than Avrae.
  if (rich?.lore_short) {
    embed.addFields({ name: '📖 Lore', value: String(rich.lore_short).slice(0, 1024), inline: false });
  }
  if (rich?.tactics && typeof rich.tactics === 'object') {
    const t = rich.tactics;
    const tacticsLines = [];
    if (t.role)      tacticsLines.push(`**Role:** ${t.role}`);
    if (t.opening)   tacticsLines.push(`**Opening:** ${t.opening}`);
    if (t.in_combat) tacticsLines.push(`**In Combat:** ${t.in_combat}`);
    if (t.when_hurt) tacticsLines.push(`**When Hurt:** ${t.when_hurt}`);
    const tacticsText = tacticsLines.join('\n');
    if (tacticsText) {
      embed.addFields({ name: '🎯 Tactics (GM)', value: tacticsText.slice(0, 1024), inline: false });
    }
  }

  if (family) {
    embed.addFields({ name: '👪 Family', value: family, inline: true });
  }

  // Source: rich has { source_book, pdf_page, _source_bestiary };
  // summary has { raw, book, page }.
  let sourceText = legacySummary.source?.raw
    ?? (legacySummary.source?.book ? `${legacySummary.source.book}${legacySummary.source.page ? ` pg. ${legacySummary.source.page}` : ''}` : null);
  if (!sourceText && rich) {
    sourceText = rich.source_book
      ? `${rich.source_book}${rich.pdf_page ? ` pg. ${rich.pdf_page}` : ''}`
      : (rich._source_bestiary ?? null);
  }
  // Footnote guild edits so GMs remember they're looking at a customized block
  const footerSuffix = monster._hasGuildEdits ? ' • customized for this server' : '';
  embed.setFooter({ text: `${sourceText ?? 'Unknown source'} • PF2e Bestiary Lookup${footerSuffix}` });

  // Monster art: set as the large image below the stat block so it doesn't
  // shrink the embed. GMs can set this per-guild with /monsterart set.
  if (artUrl) embed.setImage(artUrl);

  return embed;
}

module.exports = {
  buildMonsterEmbed,
};
