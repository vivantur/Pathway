function rollDiceExpression(raw) {
  const expr = String(raw ?? '').toLowerCase().replace(/\s+/g, '');
  if (!/^[0-9d+\-*/]+$/.test(expr)) {
    return { error: 'Invalid expression. Use dice like `2d6`, math like `10+5`, or mix them like `1d8+4`.' };
  }

  const tokens = expr.split(/([+\-*/])/).filter(Boolean);
  const breakdownParts = [];
  const values = [];

  for (const token of tokens) {
    if (['+', '-', '*', '/'].includes(token)) {
      breakdownParts.push(token === '*' ? 'x' : token === '/' ? '/' : token);
      values.push(token);
      continue;
    }

    if (token.includes('d')) {
      const [numDiceStr, numSidesStr] = token.split('d');
      const numDice = parseInt(numDiceStr, 10) || 1;
      const numSides = parseInt(numSidesStr, 10);
      if (!numSides || numSides < 1 || numSides > 10000 || numDice < 1 || numDice > 100) {
        return { error: `Invalid dice: \`${token}\`.` };
      }
      const rolls = Array.from({ length: numDice }, () => Math.floor(Math.random() * numSides) + 1);
      const rollTotal = rolls.reduce((a, b) => a + b, 0);
      breakdownParts.push(numDice > 1 ? `${numDice}d${numSides}[${rolls.join(', ')}]` : `${numDice}d${numSides}(${rolls[0]})`);
      values.push(rollTotal);
      continue;
    }

    const num = parseInt(token, 10);
    if (Number.isNaN(num)) return { error: `Couldn't parse \`${token}\`.` };
    breakdownParts.push(`${num}`);
    values.push(num);
  }

  const pass1values = [];
  const pass1ops = [];
  let current = values[0];
  for (let i = 1; i < values.length; i += 2) {
    const op = values[i];
    const next = values[i + 1];
    if (op === '*') current *= next;
    else if (op === '/') {
      if (next === 0) return { error: 'Cannot divide by zero.' };
      current = Math.floor(current / next);
    } else {
      pass1values.push(current);
      pass1ops.push(op);
      current = next;
    }
  }
  pass1values.push(current);

  let total = pass1values[0];
  for (let i = 0; i < pass1ops.length; i++) {
    if (pass1ops[i] === '+') total += pass1values[i + 1];
    if (pass1ops[i] === '-') total -= pass1values[i + 1];
  }

  return { total: Math.floor(total), breakdown: breakdownParts.join(' ') };
}

module.exports = {
  rollDiceExpression,
};
