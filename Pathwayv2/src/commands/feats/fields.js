function normalizeCharacterFeat(feat) {
  const knownTypes = new Set([
    'Heritage',
    'Ancestry Feat',
    'Class Feat',
    'Archetype Feat',
    'Skill Feat',
    'General Feat',
    'Awarded Feat',
    'Other Feats',
  ]);
  const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
  const isKnownType = value => knownTypes.has(clean(value));
  const isProbablyDescription = value => clean(value).length > 80 || /[.!?]\s/.test(clean(value));

  if (Array.isArray(feat)) {
    const webType = isKnownType(feat[1]) ? clean(feat[1]) : '';
    const pathbuilderType = isKnownType(feat[3]) ? clean(feat[3]) : '';
    const type = webType || pathbuilderType || '';
    const source = !isKnownType(feat[1]) && !isProbablyDescription(feat[1]) ? clean(feat[1])
      : !isKnownType(feat[2]) && !isProbablyDescription(feat[2]) ? clean(feat[2])
      : '';
    const level = Number.isFinite(Number(feat[3])) ? feat[3]
      : Number.isFinite(Number(feat[2])) ? feat[2]
      : null;
    return { name: clean(feat[0]), source, level, type };
  }

  if (feat && typeof feat === 'object') {
    return {
      name: clean(feat.name ?? feat.feat),
      source: isProbablyDescription(feat.source ?? feat.sourceText) ? '' : clean(feat.source ?? feat.sourceText),
      level: feat.level ?? feat.takenLevel ?? null,
      type: isKnownType(feat.type ?? feat.category) ? clean(feat.type ?? feat.category) : '',
    };
  }

  return { name: clean(feat), source: '', level: null, type: '' };
}

function buildCharacterFeatsFields(charEntry) {
  const feats = (charEntry.data?.feats ?? [])
    .map(normalizeCharacterFeat)
    .filter(f => f.name)
    .sort((a, b) => {
      const al = Number.isFinite(Number(a.level)) ? Number(a.level) : 999;
      const bl = Number.isFinite(Number(b.level)) ? Number(b.level) : 999;
      return al - bl || a.name.localeCompare(b.name);
    });

  if (feats.length === 0) {
    return { description: 'No feats recorded.', fields: [] };
  }

  const groups = new Map();
  for (const feat of feats) {
    const group = feat.type && feat.type.length <= 80 ? feat.type : 'Other Feats';
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(feat);
  }

  const preferredOrder = [
    'Heritage',
    'Ancestry Feat',
    'Class Feat',
    'Archetype Feat',
    'Skill Feat',
    'General Feat',
    'Awarded Feat',
    'Other Feats',
  ];
  const groupNames = [...groups.keys()].sort((a, b) => {
    const ai = preferredOrder.indexOf(a);
    const bi = preferredOrder.indexOf(b);
    if (ai !== -1 || bi !== -1) return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    return a.localeCompare(b);
  });
  const fieldLabel = {
    Heritage: 'Heritage',
    'Ancestry Feat': 'Ancestry Feats',
    'Class Feat': 'Class Feats',
    'Archetype Feat': 'Archetype Feats',
    'Skill Feat': 'Skill Feats',
    'General Feat': 'General Feats',
    'Awarded Feat': 'Awarded Feats',
  };

  let hidden = 0;
  const fields = groupNames.map(groupName => {
    const lines = [];
    for (const feat of groups.get(groupName)) {
      const level = feat.level !== null && feat.level !== undefined && feat.level !== '' ? `**${feat.level}** ` : '';
      const source = feat.source ? ` (${feat.source})` : '';
      const line = `• ${level}${feat.name}${source}`;
      if ([...lines, line].join('\n').length > 1000) hidden += 1;
      else lines.push(line);
    }
    return {
      name: fieldLabel[groupName] ?? (groupName.endsWith('s') ? groupName : `${groupName}s`),
      value: lines.join('\n') || 'No visible feats.',
      inline: false,
    };
  });

  const suffix = hidden > 0 ? ` ${hidden} additional feat${hidden === 1 ? '' : 's'} hidden by Discord's field limit.` : '';
  return {
    description: `${feats.length} feat${feats.length === 1 ? '' : 's'} recorded.${suffix}`,
    fields,
  };
}

function buildCharacterAbilitiesFields(charEntry) {
  const specials = Array.isArray(charEntry?.data?.specials) ? charEntry.data.specials : [];
  const lines = [];
  let hidden = 0;

  for (const special of specials) {
    const raw = typeof special === 'string'
      ? special
      : [special?.name, special?.details ?? special?.description].filter(Boolean).join(': ');
    const cleaned = String(raw ?? '').replace(/\s+/g, ' ').trim();
    if (!cleaned) continue;
    const line = `• ${cleaned}`;
    if (line.length > 1000) lines.push(`${line.slice(0, 997)}...`);
    else lines.push(line);
  }

  const fields = [];
  let chunk = [];
  for (const line of lines) {
    const next = [...chunk, line].join('\n');
    if (next.length > 1000 && chunk.length) {
      fields.push({ name: fields.length ? 'More Abilities' : 'Special Abilities', value: chunk.join('\n'), inline: false });
      chunk = [line];
      if (fields.length >= 25) {
        hidden += 1;
        chunk = [];
      }
    } else {
      chunk.push(line);
    }
  }

  if (chunk.length && fields.length < 25) {
    fields.push({ name: fields.length ? 'More Abilities' : 'Special Abilities', value: chunk.join('\n'), inline: false });
  }

  const suffix = hidden > 0 ? ` ${hidden} additional ability entr${hidden === 1 ? 'y was' : 'ies were'} hidden by Discord's field limit.` : '';
  return {
    description: `${lines.length} special abilit${lines.length === 1 ? 'y' : 'ies'} recorded.${suffix}`,
    fields,
  };
}

module.exports = {
  normalizeCharacterFeat,
  buildCharacterFeatsFields,
  buildCharacterAbilitiesFields,
};
