const monsterState = require('../../state/monster');

function monsterKey(name) {
  return String(name ?? '').toLowerCase().trim().replace(/\s+/g, ' ');
}

function getGuildArt(store, guildId) {
  if (!store[guildId]) store[guildId] = {};
  return store[guildId];
}

function monsterBuiltinArtUrl(monsterOrName) {
  if (!monsterOrName || typeof monsterOrName === 'string') return null;
  const raw = Array.isArray(monsterOrName.image) ? monsterOrName.image[0] : monsterOrName.image;
  if (!raw || typeof raw !== 'string') return null;
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith('/')) return `https://2e.aonprd.com${raw}`;
  return `https://2e.aonprd.com/${raw.replace(/^\/+/, '')}`;
}

function lookupMonsterArt(guildId, monsterOrName) {
  let saved = null;
  const name = typeof monsterOrName === 'string' ? monsterOrName : monsterOrName?.name;
  if (guildId && name) {
    const store = monsterState.getAllArt();
    const guild = store[guildId];
    const key = monsterKey(name);
    saved = guild?.[key]?.url ?? null;
  }
  return saved ?? monsterBuiltinArtUrl(monsterOrName);
}

function getMonsterEdit(guildId, displayName) {
  if (!guildId || !displayName) return null;
  const guild = monsterState.getAllEdits()[guildId];
  if (!guild) return null;
  return guild[monsterKey(displayName)] ?? null;
}

function applyMonsterEdits(monster, edits) {
  if (!edits || !monster) return monster;
  const merged = { ...monster };
  const baseRich = monster.rich ? { ...monster.rich } : {};
  const overlayKeys = [
    'abilities', 'items', 'languages', 'skills', 'attacks',
    'ability_modifiers', 'spellcasting', 'description',
  ];
  let overlayApplied = false;
  for (const key of overlayKeys) {
    if (edits[key] !== undefined) {
      baseRich[key] = edits[key];
      overlayApplied = true;
    }
  }
  if (overlayApplied || !monster.rich) merged.rich = baseRich;
  merged._hasGuildEdits = true;
  return merged;
}

function applyMonsterAttackLibrary(monster, guildId) {
  if (!monster || !guildId) return monster;
  const guildLib = monsterState.getAllAttacks()[guildId];
  if (!guildLib) return monster;
  const entry = guildLib[monsterKey(monster.name)];
  if (!entry || !entry.attacks?.length) return monster;

  const merged = { ...monster };
  const baseRich = monster.rich ? { ...monster.rich } : {};
  const existingAttacks = Array.isArray(baseRich.attacks) ? [...baseRich.attacks] : [];
  const existingAbilities = baseRich.abilities
    ? { top: [...(baseRich.abilities.top ?? [])], mid: [...(baseRich.abilities.mid ?? [])], bot: [...(baseRich.abilities.bot ?? [])] }
    : { top: [], mid: [], bot: [] };
  const seenAttackNames = new Set(existingAttacks.map(attack => attack.name?.toLowerCase()));

  for (const attack of entry.attacks) {
    if (attack.kind === 'strike') {
      if (seenAttackNames.has(attack.name.toLowerCase())) continue;
      existingAttacks.push({
        type: 'melee',
        name: attack.name,
        to_hit: attack.bonus,
        damage: `${attack.damage} ${attack.damageType ?? ''}`.trim() + (attack.extraDamage ? ` + ${attack.extraDamage}${attack.extraType ? ' ' + attack.extraType : ''}` : ''),
        traits: attack.traits ?? [],
        _fromLibrary: true,
      });
      seenAttackNames.add(attack.name.toLowerCase());
    } else if (attack.kind === 'spell') {
      existingAbilities.bot.push({
        name: attack.name,
        description: `Spell attack ${attack.bonus >= 0 ? '+' : ''}${attack.bonus}, damage ${attack.damage}${attack.damageType ? ' ' + attack.damageType : ''}.`,
        _fromLibrary: true,
      });
    } else if (attack.kind === 'save') {
      const saveCap = attack.saveType ? attack.saveType.charAt(0).toUpperCase() + attack.saveType.slice(1) : 'Save';
      existingAbilities.bot.push({
        name: attack.name,
        description: `DC ${attack.saveDC} ${saveCap} save - ${attack.damage}${attack.damageType ? ' ' + attack.damageType : ''}.`,
        _fromLibrary: true,
      });
    }
  }

  baseRich.attacks = existingAttacks;
  baseRich.abilities = existingAbilities;
  merged.rich = baseRich;
  return merged;
}

module.exports = {
  monsterKey,
  getGuildArt,
  lookupMonsterArt,
  getMonsterEdit,
  applyMonsterEdits,
  applyMonsterAttackLibrary,
};
