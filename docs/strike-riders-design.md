# Strike riders — composition design (action-feats step 5)

Status: **design + core model.** This is the plan of record for the *snippet/rider*
layer. It is grounded in the 349 `strike-rider` feats the step-1 trichotomy found
(`docs/action-feats-classification.md`) and their real rules text, not invented shapes.
See `docs/action-feats-handoff.md` for the slice's place in the whole.

## The idea (owner's framing, Avrae-style)

A large class of activities is "**Make a Strike, and also do X**." The player should
not invoke a wholly bespoke action for each — they Strike as normal and **tack on a
keyword**: `/strike weapon:longsword rider:intimidating`. A rider is a small Layer-2
**fragment composed onto the base Strike's tree** at invocation. `strikeAutomation`
already produces the base tree (`packages/core/src/strike.ts`); the interpreter already
has the pieces a rider needs (damage, applyEffect, degree branches). So this is
compositional automation, with the grain of the engine — not a new execution model.

## The taxonomy (read off the real riders)

Sampling the step-1 riders by their rules text, they fall into three shapes. **Two are
riders; the third is not**, and saying so is half the design — it keeps the primitive
small.

### A. Degree-gated fragments — the core rider shape
Add automation to a *degree branch* of the base Strike. The effect is a condition, a
persistent-damage rider, or a value that differs by degree.
- **Intimidating Strike** [2] — on hit, target Frightened 1; **on a crit, Frightened 2**.
  (Distinct per-degree values, not "hit → 1, and also crit → 2".)
- **Snagging Strike** [1] — on any hit, target Off-Guard until your next turn.
- **Silence Heresy** [2] — on hit, target silenced for 1 round (a custom effect).
- **Certain Strike** [1] — adds a **failure** branch: deal non-dice damage on a miss.

### B. Attack/damage modifiers — the strike's own numbers
Change the base Strike *before* it becomes a tree.
- **Power Attack** — an extra weapon damage die (doubled on a crit, so it is *weapon*
  damage, not a tacked-on flat node), and it counts as **two** attacks for MAP.
- **Spiritual Disruption** [2] — counts as two attacks for MAP; plus an A-type on-hit
  rider (persistent spirit + Stupefied).

### C. NOT single-strike riders — out of scope for this primitive
These *contain* a Strike but are not "a keyword on one Strike"; they are bespoke
activities (step-1 `bespoke`), and forcing them into the rider model would bloat it.
- **Sudden Charge** — Stride twice, *then* Strike (a movement prefix).
- **Double Slice** — make **two** Strikes. Two attack rolls, shared target, MAP rules.

The rider primitive covers **A and B**. C is authored as a bespoke `GrantedAction`.

## The model (`packages/core/src/rider.ts`)

A rider has **two composition points**, because A and B attach at different stages:

```ts
interface StrikeRider {
  id: string;
  name: string;
  keyword: string;            // how a player invokes it (`rider:intimidating`)
  actionCost?: ActionCost;    // the activity's real cost (Intimidating Strike = 2),
                              // overriding a plain Strike's 1 — display/validation only

  // ── B: modifications to the STRIKE itself (applied pre-`strikeAutomation`) ──
  strikeMods?: {
    mapMultiplier?: number;         // "counts as N attacks" for MAP (2 = Power Attack)
    bonusDamage?: DamageComponent[]; // extra WEAPON dice, doubled on a crit
  };

  // ── A: fragments composed onto the base tree's DEGREE branches (post) ──
  onSuccess?: AutomationNode[];         // a regular hit
  onCriticalSuccess?: AutomationNode[]; // a crit (Frightened 2)
  onFailure?: AutomationNode[];         // a miss (Certain Strike)
  onCriticalFailure?: AutomationNode[];
  onHit?: AutomationNode[];             // convenience: fanned to success AND crit
}
```

`composeStrikeRider(strike, rider, map?)` → `AutomationNode[]`:
1. Apply `strikeMods` to a *copy* of the `Strike` (extra dice → `strike.damage`/
   `criticalDamage`; `mapMultiplier` → the attack node's MAP).
2. Run `strikeAutomation` on the modified strike.
3. Append the degree fragments to the attack node's `onSuccess`/`onCriticalSuccess`/
   `onFailure`/`onCriticalFailure` (with `onHit` fanned to the two success branches).

Because step 1 already produces the base tree and step 2 the effect mechanics, a rider
is *small* — a condition-applying `applyEffect` node and, at most, a damage tweak.

## Decisions

- **A Strike composes a SET of riders, not one** (owner, 2026-07-21 — this retires the
  earlier "one rider for now"). One Strike routinely carries several at once: a Rooting
  rune (Immobilized on a crit) on a weapon Struck with Power Attack (an extra die), plus
  whatever runes/feats always apply. At mid level a real attack stacks four or more
  (the Avrae-snippet reality). So the primitive is `composeStrikeRiders(strike,
  riders[], map?)`; `composeStrikeRider` is the one-rider case. The fold is additive and
  order-preserving: bonus dice concatenate (each doubles on a crit), degree fragments
  concatenate onto their branch, and `ridersMapMultiplier` takes the MAX (two riders
  never make a Strike "count as three attacks").
- **OPEN — automatic vs. opt-in riders** (shapes the authoring + bot collection, below).
  A Strike's rider SET has two origins: *automatic* ones the weapon/character always
  brings (a Rooting/Flaming rune, an always-on feat) and *opt-in* ones the player
  chooses (the activity — Intimidating Strike, Power Attack). The bot must collect the
  automatic set from the character's weapon + feats and add the chosen activity, then
  `composeStrikeRiders` the union. Whether "automatic" is a field on the rider or a
  property of WHERE it is attached (a rune's rider vs a feat-activity's) is the design
  question the authoring plumbing has to answer.
- **`mapMultiplier` is declarative here; its interpreter wiring is a follow-up.** "Counts
  as two attacks" advances the turn's attack count by 2 (so the *next* Strike is at
  third-attack MAP). That is a post-strike effect on `attacksThisTurn`, which the host
  threads (`/strike`'s `map:` option). The rider *declares* the multiplier; wiring it
  into `advanceAttackCount` is a small, separate interpreter change, called out rather
  than smuggled in. Until then the multiplier is surfaced, not silently dropped.
- **Rules-from-source.** The rider *model* here is a data structure and makes no PF2e
  claim. Each rider *instance* (Intimidating Strike = Frightened) is a rules claim and
  must be authored from the feat's text — the tests below use the real text, never
  model memory.

## Sequencing (the rest of step 5)

1. **This: the core model + composition, tested.** ← the load-bearing primitive.
2. The `mapMultiplier` interpreter wiring (a scoped `automation.ts` change).
3. The bot surface: `/strike … rider:<keyword>` resolves a rider and composes it before
   the run — a small extension to the command built in step 4.
4. Authoring real riders from the 349 (rules-from-source), which retires the hand
   `authoredActions.js` demos for the rider cases.
