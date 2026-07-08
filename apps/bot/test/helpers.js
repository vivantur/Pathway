// Shared test utilities.
//
// Most of the bot's dice code calls Math.random() directly. To make tests
// deterministic we temporarily replace Math.random with a scripted sequence:
// each call takes the next value from the queue (then falls back to `fallback`).
// Use `die(v, sides)` to produce the Math.random value that makes an
// N-sided die roll exactly `v`.

import { vi } from 'vitest';

export function stubRandomSequence(seq, fallback = 0) {
  const queue = [...seq];
  return vi.spyOn(Math, 'random').mockImplementation(() =>
    queue.length ? queue.shift() : fallback
  );
}

// Math.random value that makes `Math.floor(r * sides) + 1` equal `v`.
export function die(v, sides) {
  return (v - 0.5) / sides;
}
