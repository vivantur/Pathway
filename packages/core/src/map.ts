// The multiple attack penalty (MAP) — Player Core p. 402.
//
// PURE: this module is arithmetic over a count and a penalty pair. It owns no
// state; the turn counter itself lives on the execution context, because "this
// turn" is play state and core is I/O-free.
//
// THREE THINGS THE RULES TEXT SAYS THAT ARE EASY TO GET WRONG, all encoded here
// and all covered by tests (see docs/strikes-and-weapons.md for the full text):
//
//  1. MAP IS NOT A STRIKE CONCEPT. "Every check that has the attack trait counts
//     toward your multiple attack penalty, including Strikes, spell attack rolls,
//     certain skill actions like Shove, and many others." So the counter counts
//     ATTACK-TRAIT CHECKS, not Strikes — a Shove and a spell attack both advance
//     it. That is why the count lives on the context rather than on a weapon.
//
//  2. STORE THE COUNT, NEVER THE PENALTY. "Always calculate your multiple attack
//     penalty based on the weapon you're using on that attack, not ones you used
//     on previous attacks." The rules' own worked example: with a longsword and an
//     agile shortsword, the third attack is −10 with the longsword or −8 with the
//     shortsword *no matter which you swung before*. A design that caches "current
//     MAP = −5" is wrong, and wrong only in mixed-weapon turns — so it survives
//     casual testing. `multipleAttackPenalty` therefore takes the count and the
//     CURRENT attack's penalty pair, and derives the penalty fresh every time.
//
//  3. TURN-SCOPED. "The multiple attack penalty applies only during your turn, so
//     you don't have to keep track of it if you can perform a Reactive Strike."
//     An off-turn attack neither consults nor increments the counter.

/**
 * A MAP penalty pair: the penalty on the second attack-trait check of a turn and
 * on the third and subsequent. Modelled as a REPLACEMENT pair rather than a
 * reduction applied to a base, because that is literally how the rules state
 * agile — "reduce these penalties to −4 ... or −8" — a substitution, not an
 * arithmetic adjustment.
 *
 * That distinction is the extension seam. The owner has noted (2026-07-19) that
 * features beyond agile will modify MAP later; how they do so is not yet known
 * from rules text, and a `reduction: number` field would have quietly asserted
 * that every such feature works by subtraction. A pair asserts nothing.
 */
export interface MapPenaltyPair {
  /** Penalty applied to the second attack-trait check of the turn. */
  second: number;
  /** Penalty applied to the third and every subsequent one. */
  thirdPlus: number;
}

/** The standard progression: −5 on the second attack, −10 on the third and beyond. */
export const STANDARD_MAP: MapPenaltyPair = { second: -5, thirdPlus: -10 };

/**
 * The agile progression: −4 / −8. Per the owner (2026-07-19) this is the ENTIRE
 * mechanical effect of the agile trait on its own.
 */
export const AGILE_MAP: MapPenaltyPair = { second: -4, thirdPlus: -8 };

/** What the current attack needs to know about itself to resolve its own MAP. */
export interface MapInput {
  /**
   * How many attack-trait checks the actor has ALREADY made this turn — 0 for the
   * first attack, which takes no penalty. Not a penalty, not a "MAP level": the
   * raw count, so a differently-traited weapon derives a different penalty from
   * the same history (rules point 2 above).
   */
  priorAttacks: number;
  /** Whether the weapon used for THIS attack has the agile trait. */
  agile?: boolean;
  /**
   * A penalty pair supplied by a feature, overriding the trait-derived one. The
   * seam for future MAP-altering features; nothing in core populates it yet, and
   * inventing entries here would be a rules claim.
   */
  override?: MapPenaltyPair;
  /**
   * True when this attack happens outside the actor's own turn (a Reactive Strike
   * or similar reaction). Such an attack takes no MAP and does not advance the
   * counter — see `advanceAttackCount`.
   */
  offTurn?: boolean;
}

/** The penalty pair in force for one attack: an override, else agile, else standard. */
export function mapPenaltyPair(input: MapInput): MapPenaltyPair {
  if (input.override) return input.override;
  return input.agile ? AGILE_MAP : STANDARD_MAP;
}

/**
 * The multiple attack penalty for ONE attack, as a non-positive number to add to
 * the attack modifier (0 on the first attack of a turn, and always 0 off-turn).
 */
export function multipleAttackPenalty(input: MapInput): number {
  if (input.offTurn) return 0;
  const priorAttacks = Math.max(0, Math.floor(input.priorAttacks));
  if (priorAttacks <= 0) return 0;
  const pair = mapPenaltyPair(input);
  return priorAttacks === 1 ? pair.second : pair.thirdPlus;
}

/**
 * The attack-trait check count after this attack resolves. An off-turn attack
 * leaves the count untouched, which is what "you don't have to keep track of it"
 * means mechanically.
 */
export function advanceAttackCount(priorAttacks: number, offTurn?: boolean): number {
  const base = Math.max(0, Math.floor(priorAttacks));
  return offTurn ? base : base + 1;
}
