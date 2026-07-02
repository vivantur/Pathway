/**
 * Tiny dice-expression engine for the sheet's dice roller.
 *
 * Supports sums of dice and flat modifiers: `d20+7`, `2d6+3`, `1d8+1d6+2`,
 * `4d6-1`. Whitespace and case are ignored. Returns null on anything it can't
 * fully parse (so callers can show an error instead of a bogus 0).
 */
export interface DiceTermResult {
  sides: number;
  values: number[];
}

export interface RollResult {
  /** The expression as the user typed it (trimmed). */
  expression: string;
  total: number;
  dice: DiceTermResult[];
  modifier: number;
  /** True only for a single d20 that came up 20 / 1 (nat crit flavor). */
  nat20: boolean;
  nat1: boolean;
}

const MAX_DICE = 100;
const MAX_SIDES = 1000;

/** Roll a dice expression. Returns null if it isn't a valid `NdX (+/- …)` sum. */
export function rollExpression(
  input: string,
  rng: () => number = Math.random,
): RollResult | null {
  const expr = input.replace(/\s+/g, '').toLowerCase();
  if (!expr) return null;

  const termRe = /([+-]?)(\d*d\d+|\d+)/g;
  const dice: DiceTermResult[] = [];
  let modifier = 0;
  let total = 0;
  let matchedLen = 0;
  let m: RegExpExecArray | null;

  while ((m = termRe.exec(expr)) !== null) {
    matchedLen += m[0].length;
    const sign = m[1] === '-' ? -1 : 1;
    const body = m[2];

    if (body.includes('d')) {
      const [nStr, xStr] = body.split('d');
      const n = nStr === '' ? 1 : parseInt(nStr, 10);
      const sides = parseInt(xStr, 10);
      if (n < 1 || n > MAX_DICE || sides < 2 || sides > MAX_SIDES) return null;
      const values: number[] = [];
      for (let i = 0; i < n; i++) {
        const v = 1 + Math.floor(rng() * sides);
        values.push(v);
        total += sign * v;
      }
      dice.push({ sides, values });
    } else {
      const val = parseInt(body, 10);
      modifier += sign * val;
      total += sign * val;
    }
  }

  // Reject anything with stray characters the token scanner didn't consume.
  if (matchedLen !== expr.length || (dice.length === 0 && modifier === 0 && !/\d/.test(expr))) {
    return null;
  }

  const singleD20 =
    dice.length === 1 && dice[0].sides === 20 && dice[0].values.length === 1;
  const face = singleD20 ? dice[0].values[0] : 0;

  return {
    expression: input.trim(),
    total,
    dice,
    modifier,
    nat20: singleD20 && face === 20,
    nat1: singleD20 && face === 1,
  };
}

/** Format the dice portion of a result, e.g. "[7, 3] + 2" — for the breakdown line. */
export function formatBreakdown(result: RollResult): string {
  const parts = result.dice.map((d) => `${d.values.length}d${d.sides} [${d.values.join(', ')}]`);
  if (result.modifier !== 0) {
    parts.push(`${result.modifier > 0 ? '+' : '−'}${Math.abs(result.modifier)}`);
  }
  return parts.join(' ');
}
