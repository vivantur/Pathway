// Parser for Archives of Nethys-style PF2e stat blocks pasted as plain text.
// Output matches the "rich" + "core" schema used by buildMonsterEmbed in index.js.

'use strict';

// ─── Helpers ──────────────────────────────────────────────────────────────────
const SIZE_WORDS   = ['Tiny', 'Small', 'Medium', 'Large', 'Huge', 'Gargantuan'];
const RARITY_WORDS = ['Common', 'Uncommon', 'Rare', 'Unique'];

function toSlug(name) {
  return String(name || '').toLowerCase().trim()
    .replace(/[\u2018\u2019\u02bc]/g, "'")
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

// Normalize pasted text: strip BOM, convert CRLF→LF, collapse weird whitespace
// but preserve line structure because the parser is line-oriented.
function normalizeText(raw) {
  return String(raw || '')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    // Curly quotes → straight
    .replace(/[\u2018\u2019\u02bc]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    // En/em dashes → hyphen-minus for range notation like "1d10+5"
    .replace(/[\u2013\u2014]/g, '-')
    // Non-breaking spaces → regular
    .replace(/\u00a0/g, ' ');
}

// Parse modifier like "+22", "-1", "22", returns number or null
function parseMod(s) {
  if (s === undefined || s === null) return null;
  const m = String(s).trim().match(/^([+-]?)\s*(\d+)/);
  if (!m) return null;
  const n = parseInt(m[2], 10);
  return m[1] === '-' ? -n : n;
}

// Split a comma-separated list, trimming each part and dropping empties.
function splitList(s) {
  if (!s) return [];
  return String(s).split(/\s*[,;]\s*/).map(x => x.trim()).filter(Boolean);
}

// ─── Field parsers ────────────────────────────────────────────────────────────
// Parses "Source Draconic Codex pg. 110" → { raw, book, page }
function parseSource(line) {
  const m = line.match(/^Source\s+(.+?)(?:\s+pg\.\s*(\d+))?\s*$/i);
  if (!m) return { raw: line.replace(/^Source\s+/i, '').trim() || null };
  const book = m[1].trim();
  const page = m[2] ? parseInt(m[2], 10) : null;
  const rawParts = [book];
  if (page !== null) rawParts.push(`pg. ${page}`);
  return { raw: rawParts.join(' '), book, page };
}

// "Str +7, Dex +3, Con +5, Int +1, Wis +5, Cha +3"
function parseAbilityMods(line) {
  const out = { str: null, dex: null, con: null, int: null, wis: null, cha: null };
  const re = /(Str|Dex|Con|Int|Wis|Cha)\s*([+-]?\s*\d+)/gi;
  let m;
  while ((m = re.exec(line)) !== null) {
    const k = m[1].toLowerCase();
    out[k] = parseMod(m[2]);
  }
  return out;
}

// "AC 30; Fort +22, Ref +18, Will +23; +2 status to all saves vs. primal"
function parseDefensesLine(line) {
  const out = { ac: null, saves: {}, save_notes: null };
  const ac = line.match(/AC\s+(\d+)/i);
  if (ac) out.ac = parseInt(ac[1], 10);
  const fort = line.match(/Fort(?:itude)?\s*([+-]?\s*\d+)/i);
  const ref  = line.match(/Ref(?:lex)?\s*([+-]?\s*\d+)/i);
  const will = line.match(/Will\s*([+-]?\s*\d+)/i);
  if (fort) out.saves.Fort = parseMod(fort[1]);
  if (ref)  out.saves.Ref  = parseMod(ref[1]);
  if (will) out.saves.Will = parseMod(will[1]);
  // Tail: anything after the saves semicolon that isn't itself a save
  const tail = line.split(';').slice(2).join(';').trim();
  if (tail) out.save_notes = tail;
  return out;
}

// "HP 200; Immunities acid, paralyzed, sleep; Weaknesses cold 10; Resistances fire 15 (except magical)"
function parseHpLine(line) {
  const out = { hp: null, hp_notes: [], immunities: [], weaknesses: [], resistances: [] };
  // Each section is separated by ";" and labeled
  const parts = line.split(/\s*;\s*/);
  for (const part of parts) {
    const hpMatch = part.match(/^HP\s+(\d+)(?:\s*\(([^)]+)\))?(.*)$/i);
    if (hpMatch) {
      out.hp = parseInt(hpMatch[1], 10);
      if (hpMatch[2]) out.hp_notes.push(hpMatch[2].trim());
      const trailing = hpMatch[3].trim();
      if (trailing) out.hp_notes.push(trailing);
      continue;
    }
    const immMatch = part.match(/^Immunit(?:y|ies)\s+(.+)$/i);
    if (immMatch) { out.immunities = splitList(immMatch[1]); continue; }
    const weakMatch = part.match(/^Weakness(?:es)?\s+(.+)$/i);
    if (weakMatch) {
      out.weaknesses = splitList(weakMatch[1]).map(parseResistanceEntry);
      continue;
    }
    const resMatch = part.match(/^Resistances?\s+(.+)$/i);
    if (resMatch) {
      out.resistances = splitList(resMatch[1]).map(parseResistanceEntry);
      continue;
    }
  }
  return out;
}

// "acid 10" → { type: 'acid', value: 10 }; "all damage 5 (except fire)" → with notes
function parseResistanceEntry(s) {
  const m = s.match(/^(.+?)\s+(\d+)(?:\s*\(([^)]+)\))?$/);
  if (!m) return { raw: s };
  const out = { type: m[1].trim(), value: parseInt(m[2], 10) };
  if (m[3]) out.notes = m[3].trim();
  return out;
}

// "Speed 30 feet, burrow 25 feet, fly 80 feet, swim 40 feet; swamp passage"
// We only lift the numeric segments into the structured object; the raw line is
// kept for display via legacySummary.speed_raw.
function parseSpeedLine(line) {
  const out = {};
  // Leading "Speed N feet" is the land speed
  const land = line.match(/Speed\s+(\d+)\s*f(?:ee|oo)?t/i);
  if (land) out.land = parseInt(land[1], 10);
  const kinds = ['burrow', 'climb', 'fly', 'swim'];
  for (const kind of kinds) {
    const re = new RegExp(`\\b${kind}\\s+(\\d+)\\s*f(?:ee|oo)?t`, 'i');
    const m = line.match(re);
    if (m) out[kind] = parseInt(m[1], 10);
  }
  return out;
}

// "Perception +22; darkvision, scent (imprecise) 60 feet, tremorsense (imprecise) 90 feet"
function parsePerceptionLine(line) {
  const out = { perception: null, senses: [] };
  const perc = line.match(/Perception\s*([+-]?\s*\d+)/i);
  if (perc) out.perception = parseMod(perc[1]);
  const rest = line.replace(/^Perception\s*[+-]?\s*\d+\s*;?\s*/i, '').trim();
  if (rest) out.senses = splitList(rest);
  return out;
}

// "Skills Arcana +21, Athletics +23, ..."
function parseSkillsLine(line) {
  const out = {};
  const body = line.replace(/^Skills\s+/i, '').trim();
  for (const entry of splitList(body)) {
    const m = entry.match(/^(.+?)\s+([+-]?\s*\d+)/);
    if (m) out[m[1].trim()] = parseMod(m[2]);
  }
  return out;
}

// "Languages Common, Draconic, Necril"
function parseLanguagesLine(line) {
  return splitList(line.replace(/^Languages?\s+/i, '').trim());
}

// An attack line like:
// "Melee ◆ jaws +24 (magical, reach 10 feet), Damage 2d10+13 piercing plus bog rot and Grab"
// Returns { type, name, to_hit, traits, damage, plus? }
function parseAttackLine(line) {
  // Strip leading action cost marker (◆, ◆◆, [one-action], etc.)
  let rest = line.replace(/^(Melee|Ranged)\s+/i, '');
  const typeMatch = line.match(/^(Melee|Ranged)/i);
  if (!typeMatch) return null;
  const type = typeMatch[1].toLowerCase();

  // Strip action symbol at start (◆, ➤, [one-action], [1A], etc.)
  rest = rest.replace(/^(?:\[[^\]]+\]|[\u25c6\u27a4\u2192\u2194→▶◆]+)\s*/u, '').trim();

  // Find "Damage" separator
  const dmgIdx = rest.search(/,?\s*Damage\s+/i);
  if (dmgIdx === -1) {
    // No damage line; still try to grab name + to-hit
    const m = rest.match(/^(.+?)\s*([+-]\d+)\s*(?:\(([^)]+)\))?/);
    if (!m) return null;
    return { type, name: m[1].trim(), to_hit: parseMod(m[2]), traits: m[3] ? splitList(m[3]) : [], damage: null };
  }

  const pre = rest.slice(0, dmgIdx).trim().replace(/,$/, '');
  const dmgStr = rest.slice(dmgIdx).replace(/^,?\s*Damage\s+/i, '').trim();

  // pre: "jaws +24 (magical, reach 10 feet)"
  // Multiple attack bonuses may appear, like "+24 [+19/+14]". Keep the first.
  const nm = pre.match(/^(.+?)\s+([+-]?\s*\d+)(?:\s*\[[^\]]+\])?\s*(?:\(([^)]+)\))?\s*$/);
  if (!nm) return { type, name: pre, to_hit: null, traits: [], damage: dmgStr };
  const name = nm[1].trim();
  const to_hit = parseMod(nm[2]);
  const traits = nm[3] ? splitList(nm[3]).filter(t => !/^reach\s/i.test(t) && !/^range\s/i.test(t)) : [];
  // Pull reach/range into its own field for display
  let reach = null, range = null;
  if (nm[3]) {
    const reachM = nm[3].match(/reach\s+(\d+)\s*f(?:ee|oo)?t/i);
    if (reachM) reach = `reach ${reachM[1]} feet`;
    const rangeM = nm[3].match(/range\s+(\d+)\s*f(?:ee|oo)?t/i);
    if (rangeM) range = `range ${rangeM[1]} feet`;
  }

  const out = { type, name, to_hit, traits, damage: dmgStr };
  if (reach) out.reach = reach;
  if (range) out.range = range;
  return out;
}

// ─── Main parse function ─────────────────────────────────────────────────────
// Input: the full pasted stat block text.
// Output: a monster entry suitable for bestiaryDatabase.
function parseStatBlock(rawText) {
  const text = normalizeText(rawText);
  const allLines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  if (allLines.length === 0) {
    return { ok: false, error: 'No content provided.', warnings: [] };
  }

  const warnings = [];

  // ── Header: "Name ... Creature N" ───────────────────────────────────────────
  // Typical first line after title: "ADULT BOG DRAGON    CREATURE 11"
  // or, the first non-empty line contains the name, and then "Creature N" is on
  // the same line or the next. Handle both.
  let name = null;
  let level = null;
  let headerIdx = 0;
  {
    const first = allLines[0];
    // Same-line form: "Name ... Creature N"
    const sameLine = first.match(/^(.+?)\s+Creature\s+(-?\d+)\s*$/i);
    if (sameLine) {
      name = sameLine[1].trim();
      level = parseInt(sameLine[2], 10);
      headerIdx = 1;
    } else {
      // Two-line form: first line is name, next is "Creature N"
      const second = allLines[1] || '';
      const lvlMatch = second.match(/^Creature\s+(-?\d+)\s*$/i);
      if (lvlMatch) {
        name = first.trim();
        level = parseInt(lvlMatch[1], 10);
        headerIdx = 2;
      } else {
        // Fallback: name-only first line, no level found
        name = first.trim();
        warnings.push('Could not detect creature level. Use /monsteredit to set it if needed.');
        headerIdx = 1;
      }
    }
  }

  // Normalize name capitalization if it's ALL CAPS
  if (name && name === name.toUpperCase() && /[A-Z]/.test(name)) {
    name = name.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
  }

  if (!name) {
    return { ok: false, error: 'Could not detect the creature name on the first line.', warnings };
  }

  // ── Traits line: the line right after header is usually the trait pills ────
  // e.g. "Huge, Amphibious, Dragon, Primal" or space-separated.
  // Detect by: contains a size word OR a rarity word, and is short-ish.
  let traits = [];
  let rarity = 'Common';
  let size = null;
  let idx = headerIdx;
  {
    const candidate = allLines[idx] || '';
    // Heuristic: trait line does NOT start with a known section keyword
    const isSection = /^(Source|Recall Knowledge|Perception|Languages|Skills|Str|AC|HP|Speed|Melee|Ranged)\b/i.test(candidate);
    if (!isSection) {
      const parts = candidate.split(/\s*,\s*|\s{2,}/).map(s => s.trim()).filter(Boolean);
      const flat = parts.flatMap(p => p.split(/\s+/));
      // Pull size and rarity out of the list; keep everything else as traits
      const remaining = [];
      for (const token of parts) {
        if (SIZE_WORDS.includes(token)) { size = token; continue; }
        if (RARITY_WORDS.includes(token)) { rarity = token; continue; }
        remaining.push(token);
      }
      traits = remaining;
      idx++;
    }
  }

  // ── Walk remaining lines and bucket each one by its leading keyword ───────
  const data = {
    name,
    level,
    size,
    rarity,
    traits,
    source_book: null,
    pdf_page: null,
    source_raw: null,
    perception: null,
    senses: [],
    languages: [],
    skills: {},
    ability_modifiers: {},
    items: [],
    speed: {},
    speed_raw: null,
    defenses: { ac: null, saves: {}, hp: null, hp_notes: [], immunities: [], weaknesses: [], resistances: [] },
    attacks: [],
    abilities: { top: [], mid: [], bot: [] },
    spellcasting: [],
    description: null,
  };

  // Two passes: first pass picks up the headlined fields; second pass collects
  // everything leftover as "ability" blocks, slotted top/mid/bot by position
  // relative to HP and Speed.
  const hpLineIdx = [];
  const speedLineIdx = [];
  const attackLineIdx = [];

  // Accumulator for multi-line abilities. We split on lines that look like
  // ability headers: "Name (traits) [action-cost]" or "Name Trigger ..."
  const unclassified = []; // {lineIdx, text}

  for (let i = idx; i < allLines.length; i++) {
    const line = allLines[i];
    // Source
    if (/^Source\s+/i.test(line)) {
      const src = parseSource(line);
      data.source_raw = src.raw;
      data.source_book = src.book || null;
      data.pdf_page = src.page || null;
      continue;
    }
    // Recall Knowledge — we don't need the structured form; fold into abilities
    if (/^Recall Knowledge\b/i.test(line)) {
      data.abilities.top.push({ name: 'Recall Knowledge', description: line.replace(/^Recall Knowledge\s*/i, '').trim() });
      continue;
    }
    // Perception (+ senses)
    if (/^Perception\b/i.test(line)) {
      const p = parsePerceptionLine(line);
      data.perception = p.perception;
      data.senses = p.senses;
      continue;
    }
    // Languages
    if (/^Languages?\b/i.test(line)) {
      data.languages = parseLanguagesLine(line);
      continue;
    }
    // Skills
    if (/^Skills\b/i.test(line)) {
      data.skills = parseSkillsLine(line);
      continue;
    }
    // Ability modifiers: "Str +7, Dex +3, ..."
    if (/^Str\s*[+-]?\s*\d/i.test(line)) {
      data.ability_modifiers = parseAbilityMods(line);
      continue;
    }
    // AC / Saves (always starts with "AC ")
    if (/^AC\s+\d/i.test(line)) {
      const def = parseDefensesLine(line);
      data.defenses.ac = def.ac;
      data.defenses.saves = def.saves;
      if (def.save_notes) data.defenses.save_notes = def.save_notes;
      continue;
    }
    // HP (+ immunities/weaknesses/resistances on the same line)
    if (/^HP\s+\d/i.test(line)) {
      const hp = parseHpLine(line);
      data.defenses.hp = hp.hp;
      if (hp.hp_notes.length) data.defenses.hp_notes = hp.hp_notes;
      if (hp.immunities.length) data.defenses.immunities = hp.immunities;
      if (hp.weaknesses.length) data.defenses.weaknesses = hp.weaknesses;
      if (hp.resistances.length) data.defenses.resistances = hp.resistances;
      hpLineIdx.push(i);
      continue;
    }
    // Speed (Speed marks the boundary between top/mid and bot abilities)
    if (/^Speed\b/i.test(line)) {
      data.speed = parseSpeedLine(line);
      data.speed_raw = line.replace(/^Speed\s+/i, '').trim();
      speedLineIdx.push(i);
      continue;
    }
    // Items: "Items longsword, shield, ..."
    if (/^Items?\b/i.test(line)) {
      data.items = splitList(line.replace(/^Items?\s+/i, '').trim());
      continue;
    }
    // Attacks
    if (/^(Melee|Ranged)\b/i.test(line)) {
      const atk = parseAttackLine(line);
      if (atk) {
        data.attacks.push(atk);
        attackLineIdx.push(i);
      } else {
        warnings.push(`Could not parse attack line: "${line.slice(0, 80)}"`);
      }
      continue;
    }
    // Spellcasting block header: "Divine Innate Spells DC 24; ..."
    // or "Arcane Prepared Spells DC 20, attack +12;"
    const spellHdr = line.match(/^(Arcane|Divine|Occult|Primal)\s+(Innate|Prepared|Spontaneous|Focus)\s+Spells\b(.*)$/i);
    if (spellHdr) {
      const caster = {
        tradition: spellHdr[1].toLowerCase(),
        type: spellHdr[2],
        DC: null,
        attack_bonus: null,
        spells_by_level: {},
      };
      const tail = spellHdr[3];
      const dcM = tail.match(/DC\s+(\d+)/i);
      const atkM = tail.match(/attack\s+([+-]?\s*\d+)/i);
      if (dcM) caster.DC = parseInt(dcM[1], 10);
      if (atkM) caster.attack_bonus = parseMod(atkM[1]);
      // Scan subsequent lines for "Xth  spell, spell, spell" entries
      let j = i + 1;
      const rankRe = /^(Cantrips?\s*\(\s*(\d+)(?:st|nd|rd|th)?\s*\)|(\d+)(?:st|nd|rd|th)(?:\s+\(\s*\d+\s+slots?\s*\))?)\s+(.+)$/i;
      while (j < allLines.length) {
        const next = allLines[j];
        const rm = next.match(rankRe);
        if (!rm) break;
        const rankNum = rm[2] !== undefined ? 0 : parseInt(rm[3], 10);
        const spellList = rm[4].split(/\s*,\s*/).map(x => ({ name: x.trim() })).filter(x => x.name);
        const key = String(rankNum);
        if (!caster.spells_by_level[key]) caster.spells_by_level[key] = { spells: [] };
        caster.spells_by_level[key].spells.push(...spellList);
        j++;
      }
      data.spellcasting.push(caster);
      i = j - 1; // outer loop will i++ to the first non-spell line
      continue;
    }

    // Anything else: collect for later ability classification
    unclassified.push({ lineIdx: i, text: line });
  }

  // ── Classify leftover lines as abilities ──────────────────────────────────
  // When pasting from AoN, each ability is one logical line (it may span
  // multiple visual lines in the source, but the text paste puts them all on
  // the same line). So the simplest and most accurate strategy is: treat each
  // leftover line as its own ability, and extract {name, action_cost, traits,
  // trigger, description} by scanning the line from left to right.
  //
  // Name heuristic: take the longest Title-Case prefix (words starting with an
  // uppercase letter, with optional lowercase connectives like "of", "to",
  // "the") until we hit one of the following sentinels:
  //   • an action symbol  (◆, ◆◆, ◆◆◆, ⤾, ⟲, ⊕)
  //   • a trait block     (laren paren → "(trait, trait, ...)")
  //   • the word "Trigger", "Effect", "Requirements", "Saving Throw", "DC"
  //   • a lowercase word that isn't a connective (e.g. "deals", "makes", "ignores")
  //
  // This gives us "Bog Rot", "Slain to Serve", "Swallow Whole", "Frightful
  // Presence", etc. correctly.

  const hpIdx = hpLineIdx[0] ?? -1;
  const firstAttackIdx = attackLineIdx[0] ?? Infinity;

  function classifySlot(lineIdx) {
    if (hpIdx === -1) return 'mid';
    if (lineIdx < hpIdx) return 'top';
    if (lineIdx < firstAttackIdx && firstAttackIdx !== Infinity) return 'mid';
    return 'bot';
  }

  const ACTION_SYM_RE = /(◆◆◆|◆◆|◆|⤾|⟲|⊕|\[(?:one|two|three|free|reaction)-?(?:action)?s?\])/i;
  const ACTION_MAP = { '◆': '1 action', '◆◆': '2 actions', '◆◆◆': '3 actions', '⤾': '1 reaction', '⟲': '1 reaction', '⊕': '1 free' };
  const NAME_STOP_WORDS = new Set([
    'trigger', 'effect', 'requirements', 'frequency', 'saving', 'dc',
    'the', 'a', 'an', 'this', 'that', 'these', 'those',
    'deals', 'makes', 'ignores', 'gains', 'can', 'cannot', "can't", 'must',
    'when', 'if', 'as', 'while', 'whenever', 'once',
  ]);
  const NAME_CONNECTIVES = new Set(['of', 'to', 'the', 'and', 'for', 'in', 'on', 'at', 'from', 'with', "'s"]);

  function extractAbilityHeader(text) {
    // Walk tokens from left. Keep tokens that are TitleCase (start uppercase)
    // or small connective words. Stop when we hit an action symbol, "(", or a
    // non-connective lowercase stop word.
    // Return { name, rest, action_cost?, traits?, trigger?, description? }
    const out = {};

    // Detect action symbol anywhere in the first ~50 chars
    const actionMatch = text.slice(0, 80).match(ACTION_SYM_RE);
    // We don't assume the symbol is right after the name; it's *usually* there
    // but some abilities have it embedded later (rare). Record it if present.

    // Split on whitespace preserving positions via a running index
    const tokens = [];
    let re = /\S+/g, tm;
    while ((tm = re.exec(text)) !== null) {
      tokens.push({ text: tm[0], start: tm.index, end: tm.index + tm[0].length });
    }
    if (tokens.length === 0) return { name: text, description: text };

    // Find the end-of-name token index
    let nameEndTokenIdx = 0;
    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i].text;
      const lower = tok.toLowerCase().replace(/[^a-z']/g, '');
      // Immediate stop: action symbol, open paren, semicolon-starter
      if (ACTION_SYM_RE.test(tok)) break;
      if (tok.startsWith('(') || tok.startsWith('[')) break;
      // Stop at trigger/effect/requirements/saving throw
      if (NAME_STOP_WORDS.has(lower)) break;
      // Capitalized word (including "O'Brien", "Fire-and-Forget"): extend name
      if (/^[A-Z]/.test(tok)) { nameEndTokenIdx = i + 1; continue; }
      // Connective lowercase inside a Title Case phrase: keep going
      if (NAME_CONNECTIVES.has(lower) && nameEndTokenIdx === i) { nameEndTokenIdx = i + 1; continue; }
      // Lowercase non-connective: name ends before this token
      break;
    }

    if (nameEndTokenIdx === 0) nameEndTokenIdx = 1; // always take at least one token

    const name = tokens.slice(0, nameEndTokenIdx).map(t => t.text).join(' ').trim();
    const afterNameStart = tokens[nameEndTokenIdx]?.start ?? text.length;
    let rest = text.slice(afterNameStart).trim();

    out.name = name;

    // Action cost from symbol
    if (actionMatch) {
      const sym = actionMatch[1];
      out.action_cost = ACTION_MAP[sym] || sym;
      // Strip the symbol from the rest
      rest = rest.replace(ACTION_SYM_RE, '').trim();
    }

    // Leading traits in parens: "(acid, primal)"
    const traitM = rest.match(/^\(([^)]+)\)\s*/);
    if (traitM) {
      out.traits = splitList(traitM[1]);
      rest = rest.slice(traitM[0].length).trim();
    }

    // Trigger ... Effect ...
    const trigM = rest.match(/^Trigger\s+(.+?)(?:;\s*Effect\s+(.+))?$/i);
    if (trigM) {
      out.trigger = trigM[1].trim();
      if (trigM[2]) out.description = trigM[2].trim();
      if (!out.action_cost) out.action_cost = '1 reaction';
      return out;
    }

    // Requirements prefix
    const reqM = rest.match(/^Requirements?\s+(.+?);\s*(?:Effect\s+)?(.+)$/i);
    if (reqM) {
      out.requirements = reqM[1].trim();
      out.description = reqM[2].trim();
      return out;
    }

    // Otherwise whatever's left is the description
    if (rest) out.description = rest;
    return out;
  }

  for (const { lineIdx, text } of unclassified) {
    const slot = classifySlot(lineIdx);
    const ability = extractAbilityHeader(text);
    if (ability.name) {
      data.abilities[slot].push(ability);
    }
  }

  // ── Build the final merged entry matching the bestiary schema ──────────────
  const core = {
    name: data.name,
    level: data.level,
    size: data.size,
    traits: data.traits,
    rarity: data.rarity,
    hp: data.defenses.hp,
    ac: data.defenses.ac,
    perception: data.perception,
    saves: {
      fort: data.defenses.saves.Fort ?? null,
      ref:  data.defenses.saves.Ref  ?? null,
      will: data.defenses.saves.Will ?? null,
    },
    source: {
      summary_source: data.source_raw ? { raw: data.source_raw, book: data.source_book, page: data.pdf_page } : null,
    },
    has_rich_data: true,
  };

  const rich = {
    name: data.name,
    level: data.level,
    source_book: data.source_book,
    pdf_page: data.pdf_page,
    size: data.size,
    creature_traits: data.traits.map(t => t.toLowerCase()),
    perception: data.perception,
    senses: data.senses,
    languages: data.languages.map(l => l.toLowerCase()),
    skills: data.skills,
    ability_modifiers: data.ability_modifiers,
    items: data.items,
    speed: data.speed,
    defenses: data.defenses,
    attacks: data.attacks,
    spellcasting: data.spellcasting,
    abilities: data.abilities,
    _source_bestiary: 'User-added via /monsteradd',
  };
  if (data.description) rich.description = data.description;

  const summary = {
    name: data.name,
    source: data.source_raw ? { raw: data.source_raw, book: data.source_book, page: data.pdf_page } : null,
    rarity: data.rarity,
    size: data.size,
    traits: data.traits,
    summary: {
      level: data.level,
      hp: { value: data.defenses.hp, raw: data.defenses.hp != null ? String(data.defenses.hp) : null, notes: data.defenses.hp_notes?.length ? data.defenses.hp_notes.join(', ') : null },
      ac: data.defenses.ac,
      perception: data.perception,
      fortitude: data.defenses.saves.Fort ?? null,
      reflex:    data.defenses.saves.Ref  ?? null,
      will:      data.defenses.saves.Will ?? null,
      senses_raw: data.senses.length ? data.senses.join(', ') : null,
      speed_raw: data.speed_raw,
    },
  };

  // Critical-field sanity warnings (don't fail, just flag)
  if (!data.defenses.hp) warnings.push('No HP detected.');
  if (!data.defenses.ac) warnings.push('No AC detected.');
  if (level === null) warnings.push('No level detected.');

  const entry = { name: data.name, core, rich, summary };

  return { ok: true, entry, slug: toSlug(data.name), warnings };
}

module.exports = { parseStatBlock, toSlug };