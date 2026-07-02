'use strict';

const { PDFParse } = require('pdf-parse');

async function extractPdfText(buffer) {
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return result.text ?? '';
  } finally {
    await parser.destroy();
  }
}

function dedupeBoldPdfText(text) {
  const lines = String(text ?? '').split('\n');
  let headerIdx = 0;
  while (headerIdx < lines.length && lines[headerIdx].trim() === '') headerIdx++;

  const pass = (str, dedupeDigits) => {
    let out = '';
    for (let i = 0; i < str.length; i++) {
      const ch = str[i];
      const next = str[i + 1];
      const after = str[i + 2];
      if (/[A-Z]/.test(ch) && next === '\t' && after === ch) {
        out += ch;
        i += 2;
        continue;
      }
      if (/[a-zA-Z()[\]+\-]/.test(ch) && next === ch) {
        out += ch;
        i += 1;
        continue;
      }
      if (dedupeDigits && /\d/.test(ch) && next === ch) {
        out += ch;
        i += 1;
        continue;
      }
      out += ch;
    }
    return out;
  };

  return lines.map((line, i) => pass(line, i === headerIdx)).join('\n');
}

function cleanPdfText(raw) {
  return dedupeBoldPdfText(raw)
    .replace(/\t/g, ' ')
    .replace(/\uFFFDy/g, 'fly')
    .replace(/Bene.{0,4}t/gi, 'Benefit')
    .replace(/\bAditional\b/gi, 'Additional')
    .replace(/\bSkil\b/g, 'Skill')
    .replace(/\bSkils\b/g, 'Skills')
    .replace(/\bComon\b/gi, 'Common')
    .replace(/\bFinese\b/gi, 'Finesse')
    .replace(/\bfet\b/gi, 'feet')
    .replace(/\batack\b/gi, 'attack')
    .replace(/\bcarying\b/gi, 'carrying')
    .replace(/\bfaling\b/gi, 'falling')
    .replace(/Dam\s*mage/g, 'Damage')
    .replace(/Item\s*ms/g, 'Items')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseMod(value) {
  const match = String(value ?? '').match(/[+-]?\d+/);
  return match ? Number.parseInt(match[0], 10) : 0;
}

function titleCaseFromFilename(name) {
  return String(name ?? '')
    .replace(/\.[^.]+$/, '')
    .replace(/pdf$/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, ch => ch.toUpperCase());
}

function splitList(text) {
  return String(text ?? '')
    .split(/,\s*/)
    .map(part => part.trim())
    .filter(Boolean);
}

function parseDamage(damage) {
  const match = String(damage ?? '').trim().match(/^(\d+d\d+)([+-]\d+)?$/i);
  return {
    dice: (match?.[1] ?? String(damage ?? '').trim()) || '1d4',
    bonus: match?.[2] ? Number.parseInt(match[2], 10) : 0,
  };
}

function section(joined, start, endAlternation) {
  const re = new RegExp(`${start}\\s+(.+?)(?=\\s+(?:${endAlternation})\\b|$)`, 'i');
  return joined.match(re)?.[1]?.trim() ?? '';
}

function parseCompanionStatblockText(rawText, { fallbackName = '' } = {}) {
  if (!rawText || String(rawText).length < 80) {
    return { ok: false, error: 'That PDF did not contain enough text to parse as a companion statblock.' };
  }

  const text = cleanPdfText(rawText)
    .replace(/\s+Pathbuilder 2e\s+https?:\/\/\S+.*$/i, '')
    .replace(/\s+--\s+\d+\s+of\s+\d+\s+--.*$/i, '')
    .trim();
  const warnings = [];
  const headerMatch = text.match(/^(\d+)\s+(.+?)\s+(Tiny|Small|Medium|Large|Huge|Gargantuan)\s+/i);
  if (!headerMatch) {
    return { ok: false, error: `Could not read the companion header. First text was: "${text.slice(0, 120)}"` };
  }

  const sourceLevel = Number.parseInt(headerMatch[1], 10);
  const sourceName = headerMatch[2].trim();
  const formMatch = sourceName.match(/^(Young|Mature|Nimble|Savage)\s+(.+)$/i);
  const form = formMatch ? formMatch[1].toLowerCase() : 'young';
  const baseName = formMatch ? formMatch[2].trim() : sourceName;
  const displayName = fallbackName || baseName;

  const typeMatch = text.match(/\b(Tiny|Small|Medium|Large|Huge|Gargantuan)\s+(.+?)\s+Perception\s+/i);
  const size = typeMatch?.[1] ?? 'Medium';
  const traits = typeMatch?.[2] ? typeMatch[2].split(/\s+/).filter(Boolean) : [];

  const perceptionMatch = text.match(/\bPerception\s+([+-]?\d+)(?:;\s*(.+?))?\s+Languages\s+/i);
  const perception = perceptionMatch ? parseMod(perceptionMatch[1]) : 0;
  const senses = perceptionMatch?.[2]?.trim() ?? '';

  const languagesText = section(text, 'Languages', 'Skills|Str');
  const languages = /^None(?: selected)?$/i.test(languagesText) ? [] : splitList(languagesText);

  const skills = {};
  const skillsText = section(text, 'Skills', 'Str');
  const skillRe = /([A-Z][A-Za-z' -]*(?: Lore)?)\s+([+-]\d+)/g;
  let skillMatch;
  while ((skillMatch = skillRe.exec(skillsText)) !== null) {
    skills[skillMatch[1].trim()] = parseMod(skillMatch[2]);
  }

  const abilities = {};
  for (const key of ['Str', 'Dex', 'Con', 'Int', 'Wis', 'Cha']) {
    const match = text.match(new RegExp(`\\b${key}\\s+([+-]?\\d+)`, 'i'));
    abilities[key.toLowerCase()] = match ? parseMod(match[1]) : 0;
  }

  const items = splitList(section(text, 'Items', 'AC'));
  const ac = Number.parseInt(text.match(/\bAC\s+(\d+)/i)?.[1] ?? '10', 10);
  const savesMatch = text.match(/\bFort\s+([+-]?\d+),?\s+Ref\s+([+-]?\d+),?\s+Will\s+([+-]?\d+)/i);
  const saves = {
    fort: savesMatch ? parseMod(savesMatch[1]) : 0,
    ref: savesMatch ? parseMod(savesMatch[2]) : 0,
    will: savesMatch ? parseMod(savesMatch[3]) : 0,
  };
  const hp = Number.parseInt(text.match(/\bHP\s+(\d+)/i)?.[1] ?? '10', 10);
  const speed = section(text, 'Speed', 'Melee|Ranged|Support|Additional|Unsteady|Pathbuilder') || '25 feet';

  const attacks = [];
  const attackRe = /\b(Melee|Ranged)\s+(.+?)\s+([+-]\d+)\s*,?\s*Damage\s+(\d+d\d+(?:[+-]\d+)?)\s+([A-Za-z/]+)/gi;
  let attackMatch;
  while ((attackMatch = attackRe.exec(text)) !== null) {
    attacks.push({
      type: attackMatch[1].toLowerCase(),
      name: attackMatch[2].trim(),
      bonus: parseMod(attackMatch[3]),
      damage: attackMatch[4].trim(),
      damageType: attackMatch[5].trim(),
      traits: [],
    });
  }
  if (!attacks.length) warnings.push('No attacks were found in the PDF.');

  const support = section(text, 'Support\\s+Benefit', 'Additional\\s+Specials|Unsteady\\s+Mount|Pathbuilder');
  const additional = section(text, 'Additional\\s+Specials', 'Unsteady\\s+Mount|Pathbuilder')
    .replace(/\bdeals Additional poison\b/i, 'deals additional poison');
  const unsteady = section(text, 'Unsteady\\s+Mount', 'Pathbuilder');

  return {
    ok: true,
    companion: {
      displayName,
      sourceName,
      baseName,
      sourceLevel,
      form,
      size,
      traits,
      perception,
      senses,
      languages,
      skills,
      abilities,
      items,
      ac,
      saves,
      hp,
      speed,
      attacks,
      support,
      additional,
      unsteady,
    },
    warnings,
  };
}

module.exports = {
  extractPdfText,
  parseCompanionStatblockText,
  titleCaseFromFilename,
};
