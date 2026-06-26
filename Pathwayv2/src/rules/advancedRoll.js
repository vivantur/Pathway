const { expandVariables } = require('./variables');

function rollAdvanced(raw, userSnippets = {}, charEntry = null) {
  if (!raw || typeof raw !== 'string') return { error: 'Empty roll expression.' };

  // ── 1. Expand snippets with optional arguments ──────────────────────────
  // Snippets are resolved in source order. A snippet name followed by bare
  // numbers (or simple dice like 3d6) can "consume" those as positional
  // args if the snippet's expansion contains %1, %2, ... placeholders.
  //
  // Example: snippet `sneak` = "+%1:2d6[sneak]"
  //   /roll 1d20 sneak      → /roll 1d20 +2d6[sneak]     (default %1=2)
  //   /roll 1d20 sneak 4    → /roll 1d20 +4d6[sneak]
  //
  // Modifiers (adv, crit, rr1...) and other snippet names break the arg run.
  //
  // Snippets are case-insensitive. We lower-case names for the lookup table.
  const snippetTable = {};
  for (const [name, expansion] of Object.entries(userSnippets)) {
    snippetTable[name.toLowerCase()] = expansion;
  }
  const snippetNames = Object.keys(snippetTable);

  // Reserved tokens that should not be treated as args or snippets.
  const RESERVED_TOKENS = new Set([
    'adv', 'advantage', 'dis', 'disadvantage', 'disadv',
    'crit', 'critical',
  ]);
  function isReservedToken(tok) {
    const low = tok.toLowerCase();
    if (RESERVED_TOKENS.has(low)) return true;
    if (/^rr\d+$/.test(low) || /^rr<\d+$/.test(low)) return true;
    if (/^kh\d+$/.test(low) || /^kl\d+$/.test(low)) return true;
    return false;
  }
  // A valid argument value is a bare number or simple NdM. Anything else
  // (operators, modifiers, other snippet names, dice expressions with
  // arithmetic) ends the arg run.
  function isSnippetArg(tok) {
    if (!tok) return false;
    if (isReservedToken(tok)) return false;
    if (snippetTable[tok.toLowerCase()]) return false;
    if (/^\d+$/.test(tok)) return true;
    if (/^\d*d\d+$/i.test(tok)) return true;
    return false;
  }
  // Apply arguments to an expansion. Replaces %N and %N:default with args[N-1]
  // (or the default if arg not provided). Returns { expansion, consumed,
  // warnings } where `consumed` is the number of args actually used.
  function applyArgs(expansion, args) {
    const placeholders = [...expansion.matchAll(/%(\d+)(?::([0-9.]+))?/g)];
    // No placeholders: snippet doesn't take args. Consume nothing.
    if (placeholders.length === 0) return { expansion, consumed: 0, warnings: [] };
    const maxArg = Math.max(...placeholders.map(m => parseInt(m[1])));
    const warnings = [];
    const missing = [];
    // Only use args up to maxArg. Extras are left for the caller to decide
    // (our caller consumes exactly maxArg, so extras fall through as
    // normal tokens — which means they'll error out if they're not valid
    // dice expression tokens).
    const usedArgs = args.slice(0, maxArg);
    const replaced = expansion.replace(/%(\d+)(?::([0-9.]+))?/g, (_, numStr, def) => {
      const idx = parseInt(numStr) - 1;
      if (usedArgs[idx] !== undefined) return usedArgs[idx];
      if (def !== undefined) return def;
      missing.push(numStr);
      return '0';
    });
    if (missing.length) {
      warnings.push(`Missing argument(s) ${missing.map(n => '%' + n).join(', ')} — used 0. Provide defaults with \`%N:default\` syntax.`);
    }
    return { expansion: replaced, consumed: usedArgs.length, warnings };
  }

  // Pre-compute placeholder counts for each snippet so the walker knows
  // how many args to grab.
  const snippetMaxArgs = {};
  for (const [name, expansion] of Object.entries(snippetTable)) {
    const phs = [...expansion.matchAll(/%(\d+)(?::([0-9.]+))?/g)];
    snippetMaxArgs[name] = phs.length ? Math.max(...phs.map(m => parseInt(m[1]))) : 0;
  }

  const expansionWarnings = [];
  let expanded;
  {
    // Pre-expand {{vars}} on the raw input so user-typed cvars/built-ins
    // are visible to the snippet walker (and so a cvar value can itself be
    // a snippet name in some future world). Safe no-op when charEntry is null.
    const preExpanded = expandVariables(raw, charEntry);
    const allTokens = preExpanded.trim().split(/\s+/).filter(Boolean);
    const outTokens = [];
    let i = 0;
    while (i < allTokens.length) {
      const tok = allTokens[i];
      const low = tok.toLowerCase();
      if (snippetTable[low]) {
        // Found a snippet name. Peek ahead for args, but only as many as
        // the snippet's placeholder count.
        const maxArgs = snippetMaxArgs[low];
        const collected = [];
        let j = i + 1;
        while (j < allTokens.length && collected.length < maxArgs && isSnippetArg(allTokens[j])) {
          collected.push(allTokens[j]);
          j++;
        }
        const { expansion, consumed, warnings } = applyArgs(snippetTable[low], collected);
        expansionWarnings.push(...warnings);
        // Expand {{vars}} on the snippet expansion too, so a snippet author
        // can write something like `+{{athletics}}[athletics]` and have it
        // resolve to the caller's actual modifier.
        outTokens.push(expandVariables(expansion, charEntry));
        i += 1 + consumed;
      } else {
        outTokens.push(tok);
        i++;
      }
    }
    expanded = outTokens.join(' ');
    // If any {{name}} survives both passes, it's an unknown variable.
    // Surface it as a warning before the validator says "Invalid characters",
    // which is much harder to debug.
    const unresolved = expanded.match(/\{\{[^{}]+\}\}/g);
    if (unresolved) {
      const uniq = [...new Set(unresolved)];
      expansionWarnings.push(`Unknown variable(s): ${uniq.join(', ')}. Use \`/cvar list\` to see what's defined.`);
      // Strip them so the validator gives a sensible error pointing at the
      // remaining expression rather than choking on the braces.
      expanded = expanded.replace(/\{\{[^{}]+\}\}/g, '0');
    }
  }

  // ── 2. Extract iteration prefix (N#...) ────────────────────────────────
  let iterations = 1;
  const iterMatch = expanded.match(/^\s*(\d+)\s*#\s*(.+)$/);
  if (iterMatch) {
    iterations = parseInt(iterMatch[1]);
    if (iterations < 1 || iterations > 25) {
      return { error: 'Iteration count must be between 1 and 25.' };
    }
    expanded = iterMatch[2];
  }

  // ── 3. Extract modifier keywords ──────────────────────────────────────
  // These are space-separated tokens at any position. We strip them out
  // and leave only the dice expression for evaluation.
  const mods = { adv: false, dis: false, crit: false, rrThreshold: 0, keep: null };
  const tokens = expanded.split(/\s+/).filter(Boolean);
  const exprTokens = [];
  for (const tok of tokens) {
    const low = tok.toLowerCase();
    if (low === 'adv' || low === 'advantage') { mods.adv = true; continue; }
    if (low === 'dis' || low === 'disadvantage' || low === 'disadv') { mods.dis = true; continue; }
    if (low === 'crit' || low === 'critical') { mods.crit = true; continue; }
    const rrMatch = low.match(/^rr(\d+)$/) || low.match(/^rr<(\d+)$/);
    if (rrMatch) { mods.rrThreshold = Math.max(mods.rrThreshold, parseInt(rrMatch[1])); continue; }
    const khMatch = low.match(/^kh(\d+)$/);
    if (khMatch) { mods.keep = { mode: 'high', n: parseInt(khMatch[1]) }; continue; }
    const klMatch = low.match(/^kl(\d+)$/);
    if (klMatch) { mods.keep = { mode: 'low', n: parseInt(klMatch[1]) }; continue; }
    exprTokens.push(tok);
  }
  if (mods.adv && mods.dis) return { error: 'Cannot apply both `adv` and `dis` to the same roll.' };

  // Join tokens, but insert an implicit `+` between any two adjacent tokens
  // where the second doesn't start with an operator. This handles cases like
  // `1d20 +2d6 3` (snippet expansion followed by a bare number) — we want
  // `1d20+2d6+3`, not `1d20+2d63`.
  let expr = '';
  for (let k = 0; k < exprTokens.length; k++) {
    const tok = exprTokens[k];
    if (k > 0 && !/^[+\-*/)]/.test(tok) && !/[+\-*/(]$/.test(exprTokens[k - 1])) {
      expr += '+';
    }
    expr += tok;
  }
  if (!expr) return { error: 'No dice expression found. Example: `1d20+5 adv`' };

  // Collapse double operators that can happen when a snippet expansion
  // starts with a sign (e.g. `str` -> `+3`, and input is `1d20+str` -> `1d20++3`)
  expr = expr
    .replace(/\+\s*\+/g, '+')
    .replace(/-\s*\+/g, '-')
    .replace(/\+\s*-/g, '-')
    .replace(/-\s*-/g, '+');

  // ── 4. Extract labels like [name] from dice terms ──────────────────────
  // Walk the expression; every time we see a NdM[label] pattern, stash the
  // label in a map keyed by a unique sentinel we embed in its place.
  const labelMap = {}; // sentinel -> label text
  let sentinelCounter = 0;
  expr = expr.replace(/\[([^\]]+)\]/g, (_, lbl) => {
    const sentinel = `LBL${sentinelCounter++}`;
    labelMap[sentinel] = lbl;
    return `_${sentinel}_`;
  });

  // ── 5. Validate characters ─────────────────────────────────────────────
  // Allow k/h/l/b for kh/kl dice suffixes and "lbl" label sentinels,
  // plus underscores for the sentinels themselves.
  const cleaned = expr.toLowerCase().replace(/\s+/g, '').replace(/x/g, '*');
  if (!/^[0-9dkhlb_+\-*/().^]+$/.test(cleaned)) {
    return { error: `Invalid characters in expression: \`${expr}\`` };
  }

  // ── 6. Apply crit modifier: double every NdM dice count ────────────────
  let workExpr = cleaned;
  if (mods.crit) {
    // Only double the leading dice-count number, not things inside sentinels
    workExpr = workExpr.replace(/(\d+)d(\d+)/g, (_, n, m) => `${parseInt(n) * 2}d${m}`);
  }

  // ── 7. Roll evaluator ──────────────────────────────────────────────────
  function rollOneDie(sides) {
    return Math.floor(Math.random() * sides) + 1;
  }

  function rollDiceGroup(numDice, numSides, localMods) {
    let rolls;
    if (localMods.adv || localMods.dis) {
      rolls = [];
      const rollsShown = [];
      for (let i = 0; i < numDice; i++) {
        const a = rollOneDie(numSides);
        const b = rollOneDie(numSides);
        const picked = localMods.adv ? Math.max(a, b) : Math.min(a, b);
        rolls.push(picked);
        rollsShown.push({ a, b, picked });
      }
      if (localMods.rrThreshold > 0) {
        for (let i = 0; i < rolls.length; i++) {
          if (rolls[i] <= localMods.rrThreshold) {
            const newVal = rollOneDie(numSides);
            rollsShown[i].rerolled = { from: rolls[i], to: newVal };
            rolls[i] = newVal;
          }
        }
      }
      return { rolls, rollsShown, advDisplay: true };
    }
    rolls = Array.from({ length: numDice }, () => rollOneDie(numSides));
    const rerollInfo = [];
    if (localMods.rrThreshold > 0) {
      for (let i = 0; i < rolls.length; i++) {
        if (rolls[i] <= localMods.rrThreshold) {
          const newVal = rollOneDie(numSides);
          rerollInfo.push({ idx: i, from: rolls[i], to: newVal });
          rolls[i] = newVal;
        }
      }
    }
    return { rolls, rerollInfo };
  }

  function evalOnce() {
    const breakdownParts = [];
    const tokens = [];
    const source = workExpr.replace(/x/g, '*');
    let cursor = 0;

    function isPrimaryStart(token) {
      return token && (token.type === 'number' || token.type === 'dice' || token.value === '(');
    }

    while (cursor < source.length) {
      const ch = source[cursor];
      if ('+-*/()^'.includes(ch)) {
        tokens.push({ type: 'op', value: ch });
        cursor++;
        continue;
      }

      const rest = source.slice(cursor);
      const diceMatch = rest.match(/^(\d*)d(\d+)(kh\d+|kl\d+)?(_lbl\d+_)?/i);
      if (diceMatch) {
        tokens.push({ type: 'dice', value: diceMatch[0] });
        cursor += diceMatch[0].length;
        continue;
      }

      const numMatch = rest.match(/^\d+/);
      if (numMatch) {
        tokens.push({ type: 'number', value: numMatch[0] });
        cursor += numMatch[0].length;
        continue;
      }

      return { error: `Couldn't parse \`${rest}\`.` };
    }

    let pos = 0;
    function peek() { return tokens[pos]; }
    function take() { return tokens[pos++]; }
    function recordOperator(op) {
      const display = op === '*' ? 'x' : op === '/' ? '/' : op;
      breakdownParts.push(display);
    }

    function parsePrimary() {
      const token = peek();
      if (!token) return { error: 'Unexpected end of expression.' };

      if (token.value === '(') {
        take();
        breakdownParts.push('(');
        const inner = parseExpression();
        if (inner.error) return inner;
        if (!peek() || peek().value !== ')') return { error: 'Missing closing parenthesis.' };
        take();
        breakdownParts.push(')');
        return inner;
      }

      if (token.value === '+') {
        take();
        recordOperator('+');
        return parsePrimary();
      }

      if (token.value === '-') {
        take();
        recordOperator('-');
        const primary = parsePrimary();
        if (primary.error) return primary;
        return { total: -primary.total };
      }

      take();
      let cleanTok = token.value;
      let labelText = null;
      const sentMatch = cleanTok.match(/_lbl(\d+)_$/i);
      if (sentMatch) {
        labelText = labelMap[`LBL${sentMatch[1]}`] ?? null;
        cleanTok = cleanTok.replace(/_lbl\d+_$/i, '');
      }

      if (token.type === 'dice') {
        const diceMatch = cleanTok.match(/^(\d*)d(\d+)(kh\d+|kl\d+)?$/);
        if (!diceMatch) return { error: `Could not parse dice \`${cleanTok}\`.` };
        const numDice = parseInt(diceMatch[1]) || 1;
        const numSides = parseInt(diceMatch[2]);
        const localKeep = diceMatch[3] ? parseKeep(diceMatch[3]) : null;
        if (numSides < 2 || numSides > 10000 || numDice < 1 || numDice > 100) {
          return { error: `Invalid dice \`${cleanTok}\`.` };
        }
        const { rolls, rollsShown, rerollInfo, advDisplay } = rollDiceGroup(numDice, numSides, mods);
        let keptIndices = null;
        if (localKeep) keptIndices = pickKeep(rolls, localKeep);
        const finalRolls = keptIndices ? keptIndices.map(i => rolls[i]) : rolls;
        const rollTotal = finalRolls.reduce((a, b) => a + b, 0);

        let diceDisplay;
        if (advDisplay) {
          const parts = rollsShown.map(r => {
            const pStr = `**${r.picked}**`;
            const oStr = r.picked === r.a ? `~~${r.b}~~` : `~~${r.a}~~`;
            const ordered = r.a === r.picked ? `${pStr},${oStr}` : `${oStr},${pStr}`;
            let s = `(${ordered})`;
            if (r.rerolled) s += `->rr${r.rerolled.to}`;
            return s;
          }).join(',');
          diceDisplay = `${numDice}d${numSides} ${mods.adv ? 'adv' : 'dis'}[${parts}]`;
        } else {
          if (keptIndices) {
            const display = rolls.map((v, i) => keptIndices.includes(i) ? `**${v}**` : `~~${v}~~`);
            diceDisplay = `${numDice}d${numSides}${diceMatch[3] || ''}[${display.join(', ')}]`;
          } else {
            const parts = rolls.map((v, i) => {
              const rer = (rerollInfo || []).find(r => r.idx === i);
              return rer ? `~~${rer.from}~~->${v}` : `${v}`;
            });
            diceDisplay = numDice > 1
              ? `${numDice}d${numSides}[${parts.join(', ')}]`
              : `${numDice}d${numSides}(${parts[0]})`;
          }
        }
        if (labelText) diceDisplay += ` *[${labelText}]*`;
        breakdownParts.push(diceDisplay);
        return { total: rollTotal };
      }

      if (token.type === 'number') {
        const num = parseInt(cleanTok, 10);
        if (Number.isNaN(num)) return { error: `Couldn't parse \`${cleanTok}\`.` };
        breakdownParts.push(`${num}`);
        return { total: num };
      }

      return { error: `Unexpected token \`${token.value}\`.` };
    }

    function parsePower() {
      let left = parsePrimary();
      if (left.error) return left;
      if (peek() && peek().value === '^') {
        take();
        recordOperator('^');
        const right = parsePower();
        if (right.error) return right;
        const powered = Math.pow(left.total, right.total);
        if (!Number.isFinite(powered)) return { error: 'Exponent result is too large.' };
        left = { total: powered };
      }
      return left;
    }

    function parseTerm() {
      let left = parsePower();
      if (left.error) return left;

      while (true) {
        const token = peek();
        const implicitMultiply = isPrimaryStart(token);
        if (!token || (!implicitMultiply && token.value !== '*' && token.value !== '/')) break;

        const op = implicitMultiply ? '*' : take().value;
        recordOperator(op);
        const right = parsePower();
        if (right.error) return right;
        if (op === '/') {
          if (right.total === 0) return { error: 'Cannot divide by zero.' };
          left = { total: Math.floor(left.total / right.total) };
        } else {
          left = { total: left.total * right.total };
        }
      }
      return left;
    }

    function parseExpression() {
      let left = parseTerm();
      if (left.error) return left;

      while (peek() && (peek().value === '+' || peek().value === '-')) {
        const op = take().value;
        recordOperator(op);
        const right = parseTerm();
        if (right.error) return right;
        left = { total: op === '+' ? left.total + right.total : left.total - right.total };
      }
      return left;
    }

    const parsed = parseExpression();
    if (parsed.error) return parsed;
    if (pos < tokens.length) return { error: `Unexpected token \`${tokens[pos].value}\`.` };
    return { total: Math.floor(parsed.total), breakdown: breakdownParts.join(' ') };
  }
  function parseKeep(suffix) {
    const m = suffix.match(/^(kh|kl)(\d+)$/);
    if (!m) return null;
    return { mode: m[1] === 'kh' ? 'high' : 'low', n: parseInt(m[2]) };
  }
  function pickKeep(rolls, keep) {
    const indexed = rolls.map((v, i) => ({ v, i }));
    indexed.sort((a, b) => keep.mode === 'high' ? b.v - a.v : a.v - b.v);
    return indexed.slice(0, keep.n).map(x => x.i).sort((a, b) => a - b);
  }

  // ── 8. Run iterations ─────────────────────────────────────────────────
  const results = [];
  let grandTotal = 0;
  for (let i = 0; i < iterations; i++) {
    const r = evalOnce();
    if (r.error) return { error: r.error };
    results.push(r);
    grandTotal += r.total;
  }

  // Build a summary line — useful for iteration rolls
  let summary = null;
  if (iterations > 1) {
    const totals = results.map(r => r.total);
    const min = Math.min(...totals);
    const max = Math.max(...totals);
    const avg = Math.round(totals.reduce((a, b) => a + b, 0) / totals.length * 10) / 10;
    summary = `Sum: **${grandTotal}** · Min: ${min} · Max: ${max} · Avg: ${avg}`;
  }

  return { iterations: results, grandTotal, summary, expanded, mods, warnings: expansionWarnings };

}

module.exports = {
  rollAdvanced,
};
