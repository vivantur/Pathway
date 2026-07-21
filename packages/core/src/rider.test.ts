import { describe, it, expect } from "vitest";
import { composeStrikeRider, riderMapMultiplier, strikeRiderSchema, type StrikeRider } from "./rider.js";
import { resolveStrike, type Strike, type StrikeActor, type StrikeSource } from "./strike.js";
import type { AutomationNode } from "./automation.js";

// A real longsword Strike to compose onto — resolved through the actual model, not a
// hand-built literal, so the base tree is exactly what the engine ships.
const actor: StrikeActor = { level: 5, mods: { str: 4, dex: 2, con: 1, int: 0, wis: 1, cha: 0 } };
const longsword: StrikeSource = {
  id: "longsword", name: "Longsword", kind: "strike", range: "melee",
  weapon: "longsword", traits: [], damageDie: 8, damageType: "slashing",
};
const strike: Strike = resolveStrike(actor, { source: longsword, rank: 2 });

/** An applyEffect node imposing a valued condition on the target — the rider staple. */
function condition(name: string, slug: string, value: number): AutomationNode {
  return {
    kind: "applyEffect",
    target: "target",
    effect: { name, conditions: [{ slug, value }], duration: { kind: "unlimited" }, passives: [] },
  } as AutomationNode;
}

// Intimidating Strike [2]: on a hit, Frightened 1; on a crit, Frightened 2.
const intimidatingStrike: StrikeRider = {
  id: "intimidating-strike", name: "Intimidating Strike", keyword: "intimidating", actionCost: { kind: "actions", min: 2, max: 2 },
  onSuccess: [condition("Frightened", "frightened", 1)],
  onCriticalSuccess: [condition("Frightened", "frightened", 2)],
};

const attackOf = (tree: AutomationNode[]) => {
  const n = tree[0];
  if (!n || n.kind !== "attack") throw new Error("no attack node");
  return n;
};

describe("composeStrikeRider — degree-gated fragments (Intimidating Strike)", () => {
  const tree = composeStrikeRider(strike, intimidatingStrike);
  const attack = attackOf(tree);

  const conditionValue = (n: AutomationNode | undefined) =>
    (n as unknown as { effect: { conditions: { value: number }[] } }).effect.conditions[0]!.value;

  it("keeps the base damage first, then appends the per-degree rider", () => {
    expect(attack.onSuccess?.[0]?.kind).toBe("damage");
    const last = attack.onSuccess?.at(-1);
    expect(last?.kind).toBe("applyEffect");
    expect(conditionValue(last)).toBe(1);
  });

  it("applies the crit-specific value on a critical hit (Frightened 2, not 1)", () => {
    expect(conditionValue(attack.onCriticalSuccess?.at(-1))).toBe(2);
  });

  it("does not invent failure branches a plain Strike does not have", () => {
    expect(attack.onFailure).toBeUndefined();
    expect(attack.onCriticalFailure).toBeUndefined();
  });

  it("does not mutate the input strike or its base tree", () => {
    // Composing again yields the same shape — proof nothing accumulated on the inputs.
    const again = attackOf(composeStrikeRider(strike, intimidatingStrike));
    expect(again.onSuccess).toHaveLength(attack.onSuccess!.length);
  });
});

describe("composeStrikeRider — onHit fans to both success branches (Snagging Strike)", () => {
  // Off-Guard is unvalued and lasts until the start of your next turn.
  const snagging: StrikeRider = {
    id: "snagging-strike", name: "Snagging Strike", keyword: "snagging", actionCost: { kind: "actions", min: 1, max: 1 },
    onHit: [{
      kind: "applyEffect", target: "target",
      effect: { name: "Off-Guard", conditions: [{ slug: "off-guard" }], duration: { kind: "until", moment: { whose: "origin", when: "start" }, next: true }, passives: [] },
    } as AutomationNode],
  };
  const attack = attackOf(composeStrikeRider(strike, snagging));

  it("appears on BOTH a regular hit and a critical hit", () => {
    expect(attack.onSuccess?.some((n) => n.kind === "applyEffect")).toBe(true);
    expect(attack.onCriticalSuccess?.some((n) => n.kind === "applyEffect")).toBe(true);
  });
});

describe("composeStrikeRider — bonus weapon dice double on a crit (Power Attack)", () => {
  const powerAttack: StrikeRider = {
    id: "power-attack", name: "Power Attack", keyword: "power", actionCost: { kind: "actions", min: 2, max: 2 },
    strikeMods: { mapMultiplier: 2, bonusDamage: [{ formula: "1d8", type: "slashing" }] },
  };
  const tree = composeStrikeRider(strike, powerAttack);
  const attack = attackOf(tree);

  it("folds the extra die into the Strike's damage (so the interpreter doubles it on a crit)", () => {
    const hitDamage = attack.onSuccess?.find((n) => n.kind === "damage") as { components: unknown[] };
    // Base longsword component + the Power Attack die.
    expect(hitDamage.components.length).toBe(strike.damage.length + 1);
    // The crit branch scales the SAME components by the attack multiplier, so the die
    // is not a separate un-doubled node — it rides the weapon dice.
    const critDamage = attack.onCriticalSuccess?.find((n) => n.kind === "damage") as { scaling?: { by: string } };
    expect(critDamage.scaling?.by).toBe("attack");
  });

  it("surfaces the MAP multiplier for the host rather than dropping it", () => {
    expect(riderMapMultiplier(powerAttack)).toBe(2);
    expect(riderMapMultiplier(intimidatingStrike)).toBe(1);
  });
});

describe("composeStrikeRider — a rider may add a failure branch (Certain Strike)", () => {
  const certainStrike: StrikeRider = {
    id: "certain-strike", name: "Certain Strike", keyword: "certain", actionCost: { kind: "actions", min: 1, max: 1 },
    onFailure: [{ kind: "text", body: "Deal weapon damage excluding all damage dice." } as AutomationNode],
  };
  const attack = attackOf(composeStrikeRider(strike, certainStrike));

  it("adds an onFailure branch the base Strike lacked", () => {
    expect(attack.onFailure).toBeDefined();
    expect(attack.onFailure?.[0]?.kind).toBe("text");
  });
});

describe("strikeRiderSchema", () => {
  it("validates a real rider and its fragments recursively", () => {
    expect(strikeRiderSchema.safeParse(intimidatingStrike).success).toBe(true);
  });
  it("rejects an unknown field (strict) and a bad fragment", () => {
    expect(strikeRiderSchema.safeParse({ ...intimidatingStrike, wat: 1 }).success).toBe(false);
    expect(strikeRiderSchema.safeParse({ id: "x", name: "X", keyword: "x", onSuccess: [{ kind: "nope" }] }).success).toBe(false);
  });
});
