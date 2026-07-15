// The counter — a general spend/restore resource primitive.
//
// One primitive underlies every consumable resource the automation engine
// touches: focus points, item charges, a "recharge 6" pool, hero points, a
// class resource. Spellcasting resources (focus points, per-rank slots, prepared
// vs spontaneous) are a SPECIALIZED LAYER that targets these same spend/restore
// verbs — not modeled here (see docs/effects-engine-design.md, decision 4).
//
// PURE mechanics — no PF2e rules, no I/O. A counter is just a bounded integer;
// this module applies a signed change and reports what actually happened.
//
// Sign convention (from the design doc: "signed amount, recharge = negative"):
// `amount` is units to SPEND. Positive spends (reduces `current`); negative
// recharges (increases it). `spent` in the result follows the same convention
// (positive = removed, negative = restored), so the interpreter can surface both
// `remaining` and `spent` to execution state uniformly.

export interface Counter {
  current: number;
  /** Upper bound. `undefined` = uncapped (recharge never clamps at the top). */
  max?: number;
  /** Lower bound. Defaults to 0. */
  min?: number;
}

export interface CounterChange {
  /** Units to spend: positive spends, negative recharges. */
  amount: number;
  /**
   * Let the result pass its bounds — spend below `min` (can go negative) or
   * recharge above `max`. Default false = clamp into `[min, max]`. The escape
   * hatch for a free-form counter used as a plain number store.
   */
  allowOverflow?: boolean;
}

export interface CounterResult {
  /** The counter after the change (a new object; the input is not mutated). */
  counter: Counter;
  /** The signed amount requested (echoes `change.amount`). */
  requested: number;
  /** Units actually applied: positive = spent, negative = recharged. |spent| ≤ |requested|. */
  spent: number;
  /** `current` after the change. */
  remaining: number;
  /** True if a bound truncated the request (the full amount was not applied). */
  clamped: boolean;
}

/** Apply a signed spend/recharge to a counter, clamping to its bounds unless overflow is allowed. */
export function applyCounter(counter: Counter, change: CounterChange): CounterResult {
  const min = counter.min ?? 0;
  const { max } = counter;
  // Positive amount spends → subtract from current.
  const raw = counter.current - change.amount;

  let next = raw;
  let clamped = false;
  if (!change.allowOverflow) {
    if (next < min) {
      next = min;
      clamped = true;
    } else if (max !== undefined && next > max) {
      next = max;
      clamped = true;
    }
  }

  return {
    counter: { ...counter, current: next },
    requested: change.amount,
    spent: counter.current - next,
    remaining: next,
    clamped,
  };
}

/** Whether a positive spend of `amount` fits fully without hitting the lower bound. */
export function canSpend(counter: Counter, amount: number): boolean {
  const min = counter.min ?? 0;
  return counter.current - amount >= min;
}

/** Clamp a counter's `current` into its own `[min, max]` bounds (e.g. after `max` changes). */
export function clampCounter(counter: Counter): Counter {
  const min = counter.min ?? 0;
  const { max } = counter;
  let c = counter.current;
  if (c < min) c = min;
  else if (max !== undefined && c > max) c = max;
  return c === counter.current ? counter : { ...counter, current: c };
}
