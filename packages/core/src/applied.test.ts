import { describe, expect, it } from "vitest";
import {
  advanceDuration,
  appliedEffectSchema,
  effectPassives,
  momentCreature,
  sustainEffect,
  tickFires,
  type AppliedEffect,
  type Duration,
  type TurnEvent,
} from "./applied.js";

const CASTER = "caster";
const TARGET = "target";

/** An effect applied by CASTER onto TARGET, during CASTER's own turn in round 3. */
const effect = (duration: Duration, over: Partial<AppliedEffect> = {}): AppliedEffect => ({
  id: "e1",
  name: "Test Effect",
  originId: CASTER,
  bearerId: TARGET,
  duration,
  appliedAt: { round: 3, duringTurnOf: CASTER },
  passives: [],
  ...over,
});

const ev = (when: "start" | "end", creature: string, round: number): TurnEvent => ({ when, creature, round });

describe("momentCreature", () => {
  it("maps origin/bearer to the right creature", () => {
    const e = effect({ kind: "unlimited" });
    expect(momentCreature({ when: "end", whose: "origin" }, e)).toBe(CASTER);
    expect(momentCreature({ when: "end", whose: "bearer" }, e)).toBe(TARGET);
  });
});

describe("tickFires", () => {
  it("fires only at the matching moment of the matching creature's turn", () => {
    const e = effect({ kind: "unlimited" }, { tickTiming: { when: "end", whose: "bearer" } });
    expect(tickFires(e, ev("end", TARGET, 3))).toBe(true);
    expect(tickFires(e, ev("start", TARGET, 3))).toBe(false); // wrong moment
    expect(tickFires(e, ev("end", CASTER, 3))).toBe(false); // wrong creature
  });

  it("an effect with no tickTiming never fires", () => {
    expect(tickFires(effect({ kind: "unlimited" }), ev("end", TARGET, 3))).toBe(false);
  });
});

describe("advanceDuration — rounds (decrements at the START of the ORIGIN's turn)", () => {
  it("a 1-round effect cast on your turn survives your turn and ends at the start of your NEXT turn", () => {
    const e = effect({ kind: "rounds", count: 1 });
    // rest of the round: nothing decrements it
    expect(advanceDuration(e, ev("end", CASTER, 3)).expired).toBe(false);
    expect(advanceDuration(e, ev("start", TARGET, 3)).expired).toBe(false);
    expect(advanceDuration(e, ev("end", TARGET, 3)).expired).toBe(false);
    // start of the caster's next turn → 1 - 1 = 0 → ends
    const next = advanceDuration(e, ev("start", CASTER, 4));
    expect(next).toEqual({ duration: { kind: "rounds", count: 0 }, expired: true });
  });

  it("counts down one per origin turn, not per bearer turn", () => {
    let d: Duration = { kind: "rounds", count: 3 };
    for (const round of [4, 5]) {
      // the bearer's turn never decrements it
      expect(advanceDuration(effect(d), ev("start", TARGET, round)).expired).toBe(false);
      const r = advanceDuration(effect(d), ev("start", CASTER, round));
      d = r.duration;
      expect(r.expired).toBe(false);
    }
    expect(d).toEqual({ kind: "rounds", count: 1 });
    expect(advanceDuration(effect(d), ev("start", CASTER, 6)).expired).toBe(true);
  });

  it("stays anchored to the origin's initiative even though the bearer is someone else", () => {
    // Nothing reads the origin's state, so a dead/incapacitated caster changes nothing:
    // the host keeps feeding events on that initiative slot.
    const e = effect({ kind: "rounds", count: 1 });
    expect(advanceDuration(e, ev("start", CASTER, 4)).expired).toBe(true);
  });

  it("does not decrement at the END of the origin's turn", () => {
    expect(advanceDuration(effect({ kind: "rounds", count: 2 }), ev("end", CASTER, 3))).toEqual({
      duration: { kind: "rounds", count: 2 },
      expired: false,
    });
  });
});

describe("advanceDuration — sustained (until the end of the origin's NEXT turn)", () => {
  it("cast on your own turn: the END of that same turn does NOT end it; your next turn's end does", () => {
    const e = effect({ kind: "sustained" }); // applied during CASTER's turn, round 3
    expect(advanceDuration(e, ev("end", CASTER, 3)).expired).toBe(false); // the off-by-one guard
    expect(advanceDuration(e, ev("end", TARGET, 3)).expired).toBe(false);
    expect(advanceDuration(e, ev("end", CASTER, 4)).expired).toBe(true);
  });

  it("applied during someone else's turn: the origin's very next turn-end ends it", () => {
    const e = effect({ kind: "sustained" }, { appliedAt: { round: 3, duringTurnOf: TARGET } });
    expect(advanceDuration(e, ev("end", CASTER, 3)).expired).toBe(true);
  });

  it("Sustaining restarts the clock", () => {
    const e = effect({ kind: "sustained" });
    // Sustained on the caster's turn in round 4 → now lasts to the end of round 5's turn
    const sustained = sustainEffect(e, { round: 4, duringTurnOf: CASTER });
    expect(advanceDuration(sustained, ev("end", CASTER, 4)).expired).toBe(false);
    expect(advanceDuration(sustained, ev("end", CASTER, 5)).expired).toBe(true);
  });
});

describe("advanceDuration — until a turn moment", () => {
  it("'until the end of the TARGET's next turn' waits for the bearer, not the caster", () => {
    const e = effect(
      { kind: "until", moment: { when: "end", whose: "bearer" }, next: true },
      { appliedAt: { round: 3, duringTurnOf: CASTER } },
    );
    expect(advanceDuration(e, ev("end", CASTER, 3)).expired).toBe(false);
    // applied during the CASTER's turn, so the bearer's turn-end this round is their "next"
    expect(advanceDuration(e, ev("end", TARGET, 3)).expired).toBe(true);
  });

  it("without `next`, the first matching moment ends it ('until the end of your turn')", () => {
    const e = effect({ kind: "until", moment: { when: "end", whose: "origin" } });
    expect(advanceDuration(e, ev("end", CASTER, 3)).expired).toBe(true);
  });

  it("with `next`, the occurrence during the applying turn is skipped", () => {
    const e = effect({ kind: "until", moment: { when: "end", whose: "origin" }, next: true });
    expect(advanceDuration(e, ev("end", CASTER, 3)).expired).toBe(false);
    expect(advanceDuration(e, ev("end", CASTER, 4)).expired).toBe(true);
  });

  it("a START moment needs no guard — that moment already passed", () => {
    const e = effect({ kind: "until", moment: { when: "start", whose: "origin" }, next: true });
    expect(advanceDuration(e, ev("start", CASTER, 4)).expired).toBe(true);
  });
});

describe("advanceDuration — durations not measured in turns", () => {
  it("unlimited / time / dailyPreparations never expire on a turn event", () => {
    const durations: Duration[] = [
      { kind: "unlimited" },
      { kind: "time", amount: 10, unit: "minutes" },
      { kind: "dailyPreparations" },
    ];
    for (const d of durations) {
      expect(advanceDuration(effect(d), ev("start", CASTER, 9)).expired).toBe(false);
      expect(advanceDuration(effect(d), ev("end", TARGET, 9)).expired).toBe(false);
    }
  });
});

describe("sustainEffect — sustain is orthogonal to duration", () => {
  it("leaves a fixed duration alone: a Sustain BONUS must not extend it", () => {
    const e = effect({ kind: "rounds", count: 10 }, { sustain: { extends: false } });
    expect(sustainEffect(e, { round: 4, duringTurnOf: CASTER })).toBe(e);
  });

  it("extends a fixed duration when the effect says Sustaining does", () => {
    const e = effect({ kind: "until", moment: { when: "end", whose: "origin" }, next: true }, { sustain: { extends: true } });
    const s = sustainEffect(e, { round: 4, duringTurnOf: CASTER });
    expect(s.appliedAt).toEqual({ round: 4, duringTurnOf: CASTER });
  });
});

describe("effectPassives — the seam back into Layer 1", () => {
  it("collects the passives of every active effect", () => {
    const a = effect({ kind: "unlimited" }, {
      passives: [{ kind: "modifier", target: "ac", bonusType: "status", value: { kind: "lit", value: 1 } }],
    });
    const b = effect({ kind: "unlimited" }, {
      passives: [{ kind: "modifier", target: "will", bonusType: "status", value: { kind: "lit", value: -2 } }],
    });
    expect(effectPassives([a, b])).toHaveLength(2);
    expect(effectPassives([])).toEqual([]);
  });
});

describe("appliedEffectSchema", () => {
  it("validates a full effect carrying Layer-1 passives", () => {
    expect(
      appliedEffectSchema.safeParse({
        id: "frightened",
        name: "Frightened 2",
        originId: CASTER,
        bearerId: TARGET,
        duration: { kind: "rounds", count: 2 },
        appliedAt: { round: 3, duringTurnOf: CASTER },
        tickTiming: { when: "end", whose: "bearer" },
        passives: [{ kind: "modifier", target: "will", bonusType: "status", value: { kind: "lit", value: -2 } }],
        dismissible: true,
        sustain: { extends: false },
      }).success,
    ).toBe(true);
  });

  it("accepts a null duringTurnOf (applied out of combat)", () => {
    expect(
      appliedEffectSchema.safeParse({
        id: "e",
        name: "E",
        originId: CASTER,
        bearerId: TARGET,
        duration: { kind: "unlimited" },
        appliedAt: { round: 0, duringTurnOf: null },
        passives: [],
      }).success,
    ).toBe(true);
  });

  it("rejects an unknown duration kind, a bad moment, and extra fields", () => {
    const base = { id: "e", name: "E", originId: CASTER, bearerId: TARGET, appliedAt: { round: 0, duringTurnOf: null }, passives: [] };
    expect(appliedEffectSchema.safeParse({ ...base, duration: { kind: "forever" } }).success).toBe(false);
    expect(
      appliedEffectSchema.safeParse({ ...base, duration: { kind: "unlimited" }, tickTiming: { when: "end", whose: "everyone" } }).success,
    ).toBe(false);
    expect(appliedEffectSchema.safeParse({ ...base, duration: { kind: "unlimited" }, extra: 1 }).success).toBe(false);
  });
});
