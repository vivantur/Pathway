// utils/spellDamage.js
// Resolves a spell's damage at a given cast rank, handling every heightening
// shape that appears in spells.json:
//
//   - per_rank with damage_bonus (e.g. Fireball: "+2d6 per rank above 3")
//   - per_rank without damage_bonus (e.g. Magic Missile: extra missiles, no scaling dice)
//   - fixed with dice in level text (e.g. Acid Splash: "increases to 5d6 at rank 9")
//   - fixed without dice (e.g. Aerial Form: narrative changes only)
//   - spells with damage:null but heightening that scales (e.g. Heal: "+1d8 per rank")
//
// Returns:
//   {
//     diceExpr:    "6d6 + 4d6"  // full expression to roll, or null if no dice
//     damageType:  "fire"        // primary damage type, or null
//     extra:       "..."         // any extra rider text from spell.damage.extra
//     heightenedNote: "..."      // free-text note from heightening (no dice)
//     bonusRanks:  2             // how many ranks above base
//     fixedReplaced: false       // whether a fixed-rank entry replaced base damage
//   }
//
// The caller still does the actual rolling via rollDamageExpression() — this
// module just figures out the *expression*.

/**
 * Multiply a dice expression's dice count.
 * "2d6" * 3 -> "6d6". "1d8" * 2 -> "2d8". Returns null if not parseable.
 */
function multiplyDice(diceStr, factor) {
  if (!diceStr || factor < 1) return null;
  const m = String(diceStr).trim().match(/^(\d+)?d(\d+)$/i);
  if (!m) return null;
  const count = (parseInt(m[1]) || 1) * factor;
  return `${count}d${m[2]}`;
}

/**
 * Pull the first dice expression out of a free-text heightening level entry
 * like "The initial damage increases to 5d6, the persistent damage increases to 5".
 * We focus on the *primary* damage (typically what's said first), and prefer
 * "increases to" (replacement) over "increases by" (additive) because PF2e's
 * fixed heightening usually gives you a complete new number.
 *
 * Returns:
 *   { diceExpr: "5d6", mode: "replace" } — found "increases to Xd…"
 *   { diceExpr: "3d6", mode: "add" }     — found "increases by Xd…"
 *   null                                  — no dice in this text
 */
function extractDiceFromFixedText(text) {
  if (!text || typeof text !== 'string') return null;
  // "increases to X[+Y]d…"
  const replaceMatch = text.match(/increases?\s+to\s+(\d+d\d+(?:\s*[+\-]\s*\d+)?)/i);
  if (replaceMatch) {
    return { diceExpr: replaceMatch[1].replace(/\s+/g, ''), mode: 'replace' };
  }
  // "increases by X[+Y]d…"
  const addMatch = text.match(/increases?\s+by\s+(\d+d\d+(?:\s*[+\-]\s*\d+)?)/i);
  if (addMatch) {
    return { diceExpr: addMatch[1].replace(/\s+/g, ''), mode: 'add' };
  }
  // Bare "Xd…" mention as a fallback (treated as replacement)
  const bare = text.match(/\b(\d+d\d+)\b/);
  if (bare) {
    return { diceExpr: bare[1], mode: 'replace' };
  }
  return null;
}

/**
 * Find the highest fixed-heightening entry whose rank is ≤ castRank.
 * spell.heightening.levels is an object like { "3": "...", "6": "...", "9": "..." }.
 * If casting at rank 7, we want the rank-6 entry, not rank-9.
 */
function findApplicableFixedLevel(levels, castRank) {
  if (!levels || typeof levels !== 'object') return null;
  let best = null;
  for (const [rankStr, text] of Object.entries(levels)) {
    const rank = parseInt(rankStr);
    if (!Number.isFinite(rank)) continue;
    if (rank > castRank) continue;
    if (best == null || rank > best.rank) {
      best = { rank, text };
    }
  }
  return best;
}

const DAMAGE_TYPES = [
  'acid',
  'bleed',
  'bludgeoning',
  'chaotic',
  'cold',
  'electricity',
  'evil',
  'fire',
  'force',
  'good',
  'lawful',
  'mental',
  'negative',
  'piercing',
  'poison',
  'positive',
  'precision',
  'slashing',
  'sonic',
  'spirit',
  'vitality',
  'void',
];

function cleanDiceExpression(expr) {
  if (!expr) return null;
  const tokens = String(expr).match(/[+\-]?\s*\d*d\d+|[+\-]\s*\d+/gi);
  if (!tokens || !tokens.some((token) => /d/i.test(token))) return null;
  return tokens.map((token) => token.replace(/\s+/g, '')).join(' ');
}

function extractDiceExpression(text) {
  if (!text) return null;
  const m = String(text).match(/\b(\d*d\d+(?:\s*[+\-]\s*(?:\d*d\d+|\d+))*)\b/i);
  return m ? cleanDiceExpression(m[1]) : null;
}

function inferDamageType(text) {
  if (!text) return null;
  const normalized = String(text).toLowerCase().replace(/[_-]+/g, ' ');
  const beforeDamage = normalized.match(/\b\d*d\d+(?:\s*[+\-]\s*(?:\d*d\d+|\d+))*\s+([a-z][a-z\s]+?)\s+damage\b/i);

  if (beforeDamage) {
    const words = beforeDamage[1].trim().split(/\s+/);
    const found = DAMAGE_TYPES.find((type) => words.includes(type));
    if (found) return found;
  }

  return DAMAGE_TYPES.find((type) => normalized.includes(`${type} damage`)) || null;
}

function extractDamageFromText(text) {
  if (!text) return null;
  const source = String(text);
  const damagePhrase = source.match(/\b(?:deals?|dealing|takes?|taking|suffers?)\s+(\d*d\d+(?:\s*[+\-]\s*(?:\d*d\d+|\d+))*)\s+([a-z][a-z\s-]+?)\s+damage\b/i)
    || source.match(/\b(\d*d\d+(?:\s*[+\-]\s*(?:\d*d\d+|\d+))*)\s+([a-z][a-z\s-]+?)\s+damage\b/i);

  if (damagePhrase) {
    return {
      diceExpr: cleanDiceExpression(damagePhrase[1]),
      damageType: inferDamageType(damagePhrase[0]),
      extra: '',
    };
  }

  const diceExpr = extractDiceExpression(source);
  if (!diceExpr) return null;

  return {
    diceExpr,
    damageType: inferDamageType(source),
    extra: '',
  };
}

function extractDamageFromObject(dmg) {
  if (!dmg || typeof dmg !== 'object') return null;
  const candidates = [
    dmg.base,
    dmg.dice,
    dmg.formula,
    dmg.expression,
    dmg.value,
    dmg.damage,
    dmg.text,
    dmg.label,
  ];

  for (const candidate of candidates) {
    const diceExpr = extractDiceExpression(candidate);
    if (!diceExpr) continue;
    return {
      diceExpr,
      damageType: dmg.type || dmg.damageType || inferDamageType(candidate),
      extra: dmg.extra || dmg.notes || '',
    };
  }

  return null;
}

function extractDamageFromRolls(rolls) {
  if (!Array.isArray(rolls)) return null;

  for (const roll of rolls) {
    if (!roll) continue;
    const kind = String(roll.type || roll.kind || roll.category || roll.stat || '').toLowerCase();
    const joined = [
      roll.formula,
      roll.expression,
      roll.dice,
      roll.damage,
      roll.value,
      roll.text,
      roll.label,
      roll.name,
    ].filter(Boolean).join(' ');
    const kindIsDamageType = DAMAGE_TYPES.includes(kind);
    const looksLikeDamage = !kind || kind.includes('damage') || kindIsDamageType || /damage/i.test(joined);
    if (!looksLikeDamage) continue;

    const diceExpr = extractDiceExpression(joined);
    if (!diceExpr) continue;

    return {
      diceExpr,
      damageType: roll.damageType || roll.typeLabel || (kindIsDamageType ? kind : null) || inferDamageType(joined),
      extra: roll.extra || roll.notes || '',
    };
  }

  return null;
}

function extractSpellDamageSource(spell) {
  if (!spell) return null;

  if (spell.damageBase) {
    const diceExpr = extractDiceExpression(spell.damageBase);
    if (diceExpr) {
      return {
        diceExpr,
        damageType: spell.damageType || inferDamageType(`${spell.damageBase} ${spell.damageType || ''}`),
        extra: spell.damageExtra || '',
      };
    }
  }

  if (spell.damage && typeof spell.damage === 'object') {
    const fromObject = extractDamageFromObject(spell.damage);
    if (fromObject) return fromObject;
  }

  if (spell.damage && typeof spell.damage === 'string') {
    const fromText = extractDamageFromText(spell.damage);
    if (fromText) {
      return {
        ...fromText,
        damageType: spell.damageType || fromText.damageType,
        extra: spell.damageExtra || fromText.extra,
      };
    }
  }

  const fromRolls = extractDamageFromRolls(spell.rolls);
  if (fromRolls) return fromRolls;

  return extractDamageFromText(spell.description || spell.summary || spell.effect || '');
}

/**
 * Main resolver. Given a spell entry and the rank it's being cast at,
 * returns a fully assembled damage expression along with metadata.
 */
function resolveSpellDamage(spell, castRank) {
  if (!spell) return null;

  const baseLevel = spell.level || 0;
  const effectiveRank = Number.isFinite(castRank) ? castRank : baseLevel;
  const bonusRanks = Math.max(0, effectiveRank - baseLevel);

  // Pull base damage. Two valid shapes depending on whether the spell has
  // been run through normalizeSpell() yet:
  //   1. Raw catalog shape:    spell.damage = { base, type, extra }
  //   2. Post-normalize shape: spell.damageBase = "3d8", spell.damageType = "acid"
  //                            (spell.damage was clobbered to a display string)
  // The /cast handler normalizes BEFORE calling us, so we have to handle the
  // post-normalize shape; otherwise damage rolls silently fail. Try the
  // structured form first, then fall back to the raw object form.
  let diceExpr = null;
  let damageType = null;
  let extra = '';

  if (spell.damageBase) {
    // Post-normalize shape — fields already split out for us
    diceExpr = String(spell.damageBase);
    damageType = spell.damageType || null;
    extra = spell.damageExtra || '';
  } else {
    const dmg = spell.damage;
    if (dmg && typeof dmg === 'object' && dmg.base) {
      diceExpr = String(dmg.base);
      damageType = dmg.type || null;
      extra = dmg.extra || '';
    }
  }

  const baseDamage = extractSpellDamageSource(spell);
  if (baseDamage) {
    diceExpr = baseDamage.diceExpr;
    damageType = baseDamage.damageType || null;
    extra = baseDamage.extra || '';
  }

  let heightenedNote = '';
  let fixedReplaced = false;

  const ht = spell.heightening;
  if (ht && typeof ht === 'object') {
    if (ht.type === 'per_rank') {
      const step = ht.step || 1;
      const steps = Math.floor(bonusRanks / step);
      if (steps > 0 && ht.damage_bonus) {
        // Numeric per-rank bonus → multiply dice count and append
        const multiplied = multiplyDice(ht.damage_bonus, steps);
        if (multiplied) {
          diceExpr = diceExpr ? `${diceExpr} + ${multiplied}` : multiplied;
        } else {
          // Non-dice bonus (e.g. flat "+5"); append literally
          diceExpr = diceExpr ? `${diceExpr} + ${ht.damage_bonus}` : ht.damage_bonus;
        }
      }
      // Per-rank entries always have extra_text describing what changes
      // narratively (range, duration, etc.). Show it when actually heightened.
      if (bonusRanks > 0 && ht.extra_text) {
        heightenedNote = ht.extra_text;
      }
    } else if (ht.type === 'fixed') {
      // Fixed: find the highest level entry at or below castRank
      const applied = findApplicableFixedLevel(ht.levels, effectiveRank);
      if (applied) {
        const extracted = extractDiceFromFixedText(applied.text);
        if (extracted) {
          if (extracted.mode === 'replace') {
            diceExpr = extracted.diceExpr;
            fixedReplaced = true;
          } else {
            // 'add' mode → append to existing
            diceExpr = diceExpr ? `${diceExpr} + ${extracted.diceExpr}` : extracted.diceExpr;
          }
        }
        heightenedNote = applied.text;
      }
    }
  }

  return {
    diceExpr: diceExpr || null,
    damageType,
    extra,
    heightenedNote,
    bonusRanks,
    fixedReplaced,
  };
}

/**
 * Roll a compound expression like "6d6 + 4d6 + 5" by splitting on + / - and
 * summing the parts. Falls back to a simple roll if there's only one term.
 *
 * Returns {parts: [{expr, rolls, sum}], grandTotal, display} or null on parse fail.
 */
function rollCompoundExpression(expr) {
  if (!expr) return null;
  const cleaned = String(expr).replace(/\s+/g, '');
  // Split keeping the signs: "6d6+4d6-2" → ["+6d6","+4d6","-2"]
  const tokens = cleaned.match(/[+\-]?\d*d\d+|[+\-]?\d+/g);
  if (!tokens || !tokens.length) return null;

  const parts = [];
  let grandTotal = 0;
  const displayParts = [];

  for (const t of tokens) {
    const sign = t.startsWith('-') ? -1 : 1;
    const body = t.replace(/^[+\-]/, '');
    const dm = body.match(/^(\d*)d(\d+)$/i);
    if (dm) {
      const count = parseInt(dm[1]) || 1;
      const sides = parseInt(dm[2]);
      if (count < 1 || count > 100 || sides < 1) continue;
      const rolls = Array.from({ length: count }, () => Math.floor(Math.random() * sides) + 1);
      const sum = rolls.reduce((a, b) => a + b, 0) * sign;
      grandTotal += sum;
      parts.push({ expr: `${count}d${sides}`, rolls, sum, sign });
      const signStr = sign < 0 ? '-' : (displayParts.length ? '+' : '');
      displayParts.push(`${signStr}${count}d${sides}[${rolls.join(',')}]`);
    } else {
      const num = parseInt(body);
      if (!Number.isFinite(num)) continue;
      const signed = num * sign;
      grandTotal += signed;
      parts.push({ flat: signed });
      const signStr = sign < 0 ? '-' : (displayParts.length ? '+' : '');
      displayParts.push(`${signStr}${num}`);
    }
  }

  if (!parts.length) return null;
  return {
    parts,
    grandTotal: Math.max(0, grandTotal), // PF2e damage can't go negative
    display: displayParts.join(''),
    total: Math.max(0, grandTotal), // alias for compatibility with rollDamageExpression
  };
}

module.exports = {
  resolveSpellDamage,
  rollCompoundExpression,
  // Exposed for tests
  multiplyDice,
  extractDiceFromFixedText,
  findApplicableFixedLevel,
};
