# Pathway Effects Engine — Design

*Design synthesis. Brainstorming outcome, July 2026. NOT an implementation plan yet —
this depends on the content/db work and the `packages/core` character model, both in
progress in separate tracks.*

> **Status (updated 2026-07-15): Layer 1 has landed (additive).** The prerequisites
> (both blockers below) were already cleared: the DB/content schema is substantially built
> (`packages/db` content-store + spell/ancestry/heritage/background/feat entities in
> `packages/core`), and **Stage 1 — the character model — landed** as the resolved
> read-surface the engine consumes: `packages/core/src/character.ts` (`ResolvedCharacter` +
> `resolveSelector` + `characterNamespace`) and `packages/core/src/selectors.ts` (the
> canonical read-selector vocabulary + the 16 skill slugs). It is pure and input-only (no
> rules math); the web builder and Pathbuilder reader both emit it (`toResolvedCharacter`,
> `resolvedFromPathbuilder`).
>
> **Layer 1 now exists** in two pure, tested modules (2026-07-15, `phase-7/core-character-model`):
> `predicate.ts` (the `when?` boolean-tree + tag evaluator + `staticTags`) and `passive.ts`
> (the canonical `PassiveEffect` union + `applyPassiveEffects`). See "Layer 1" and "Staging"
> below for exactly what is applied vs. collected, and what remains. This doc remains the
> durable design to resume from.
>
> *Original gate (kept for context): do not begin implementation drafts — Zod schemas, node
> interpreter, etc. — until the DB/content schema and character model land. Both now have.*

---

## What this is

The "effect engine" is the shared system that makes feats, spells, actions, monsters,
items, conditions, and **user-created homebrew of all of those** actually *do things* —
modify a stat, roll typed damage, force a save, apply a condition, spin up a repeatable
ongoing effect. It is the engine other parts of the app depend on, and per the project's
one architectural rule it lives in `packages/core`, pure and tested; the bot and web both
consume it.

### Decisions already locked (don't re-litigate)

- **We build our own schema.** Not a port of anyone else's data structure. The reason is
  the homebrew creation system: we will not ask our users to author someone else's format,
  and we will not present someone else's authored work as our own.
- **Foundry VTT's `pf2e` system is a *reference and import feedstock*, never our contract.**
  Its game-content text (Paizo's, ORC/Community-Use) we import freely with attribution.
  Its hand-authored rule-element encodings (`system.rules[]`) are Foundry's own work — we
  treat them as reference and map *into our schema* at ingest, never store or read their
  shape at runtime. (See the note on `apps/web/.../effects.ts` reading Foundry's shape
  directly today — that is transitional and to be refactored behind an adapter.)
- **Avrae's custom-action builder is UX inspiration, not a clone target.** We take the
  *shape of the authoring experience* (an effect tree of typed nodes) but the semantics are
  ours — and PF2e's rules force real divergence (see "Where PF2e forces divergence").
- **A raw Avrae action will not parse against our schema, and that is expected.** Different
  game, different framework. The only meaningful validation of our schema against the Avrae
  corpus is **semantic** — "can our node vocabulary express what this action *intends*?" —
  translated by intent, never by syntax.

### This is partly consolidation, not greenfield

Two bodies of prior art already exist and should be *extracted/unified into core*, not
rebuilt:

- **Passive side** — `packages/core/src/effects.ts` already has `stackModifiers` (the PF2e
  bonus/penalty stacking rules, from rules text, tested) and a bounded no-`eval` expression
  evaluator. `derived.ts` composes base stats. `content.ts` is the content envelope.
- **Runtime side** — the **bot already implements** much of the automation *behavior*
  (see `docs/avrae-pathbuilder-roadmap.md`): a dice parser with crit doubling, degree-of-
  success resolution, persistent damage with end-of-turn flat checks, ~30 condition presets
  with numeric effects, MAP tracking, and spell automation that spends slots and applies
  conditions by degree. This is welded to the bot today. The engine work is largely about
  lifting that into a pure, shared, *user-authorable* core — the same "one implementation"
  consolidation we're doing for derived stats.

---

## The core framing: two interlocking layers

Everything divides into two paradigms that meet at one bridge.

```
┌─────────────────────────────────────────────────────────────────┐
│ LAYER 1 — PASSIVE EFFECTS  (declarative, continuous)             │
│   "what is currently ON an actor and modifies its numbers"       │
│   feats, item runes, a stance's bonus, a condition's penalty     │
│   → resolved by stackModifiers + predicates                      │
└─────────────────────────────────────────────────────────────────┘
                      ▲ applied / removed by
                      │
┌─────────────────────┴───────────────────────────────────────────┐
│ LAYER 1.5 — APPLIED EFFECT  (the bridge / combat entity)         │
│   a container carrying: passive effects (L1) + granted actions   │
│   + buttons (each holding L2 automation) + duration/lifecycle    │
│   + link-group relationships                                     │
└─────────────────────────────────────────────────────────────────┘
                      ▲ produced by an `applyEffect` node
                      │
┌─────────────────────┴───────────────────────────────────────────┐
│ LAYER 2 — AUTOMATION  (imperative, executed on invocation)       │
│   "what happens when you DO the thing" — an ordered tree of      │
│   typed nodes: target → attack/save/check → damage → applyEffect │
│   a button re-enters Layer 2 → the recursion                     │
└─────────────────────────────────────────────────────────────────┘
```

The recursion is the heart of the engine: **automation → applied effect → button →
automation**. Persistent damage, escape-grapple, sustained spells all live in that loop.

---

## Layer 1 — Passive effect schema

> **Implemented (2026-07-15) in `packages/core/src/passive.ts` + `predicate.ts`.** The union
> below is the `PassiveEffect` type; the `Value` is the `expr.ts` AST (`exprSchema`), and the
> `Predicate` is `predicate.ts` (a boolean tree over a **membership-flag** tag set — no
> numeric/threshold leaves; those are Layer 2 `branch` expressions). `applyPassiveEffects(rc,
> effects, ctx?)` is deliberately **additive and boundary-honest**: it folds `modifier`
> (via `stackModifiers`) and `note` onto the resolved sheet, and *collects* the kinds it must
> not guess — `proficiency` → `rankGrants` (re-deriving a modifier from a raised rank is the
> content-blocked orchestration), `grant` → `grants` (no senses/resistances field on the model
> yet), `rollAdjust` → `rollAdjusts` (consumed at Layer 2). Predicates evaluate against the
> character's `staticTags` unioned with caller-supplied combat tags — *one evaluator, two
> contexts*. **Not yet built:** the `set`/override full-stat mode (polymorph; validation-run
> item), grant/rollAdjust *behavior*, combat-tag production, the `collectSheetEffects`→
> `PassiveEffect[]` ingest refactor, and retiring the duplicate builder/pathbuilder
> orchestration (all still additive-blocked or their own slice).

A passive effect is a *targeted, typed, conditional change*. Small discriminated union:

```ts
type Effect =
  | { kind: 'modifier';    target: Selector; bonusType: BonusType; value: Value; when?: Predicate }
  | { kind: 'proficiency'; target: ProfSelector; rank: Rank; mode: 'upgrade' | 'set' }
  | { kind: 'grant';       grant: Grant; when?: Predicate }        // sense, speed, resistance, trait, action
  | { kind: 'rollAdjust';  target: Selector; adjust: DegreeShift | Reroll; when?: Predicate }
  | { kind: 'note';        target: Selector; text: string; when?: Predicate };
```

Sub-vocabularies (finite enumerations — these ARE the contract that makes homebrew
authorable and validatable; an author picks from lists, never writes a DSL):

- **`Selector`** — the target namespace: `ac`, `fortitude`/`reflex`/`will`, `perception`,
  `hp`, `attack`, `damage`, `spell-attack`, `spell-dc`, `class-dc`, the 16 skills +
  `skill-check`, `initiative`, `speed:land|fly|swim`, `reach`. (Seeded by `STAT_SELECTORS`
  in `effects.ts`.)
- **`BonusType`** — `circumstance | status | item | untyped`. Resolved by the existing
  `stackModifiers` (highest-of-type for bonuses, worst-of-type for penalties, untyped
  stacks). **This resolver already exists and does not change** once it reads our schema.
- **`Value`** — recommend **structured** (`{ base, scaling?: 'level'|'halfLevel'|AbilityKey }`
  + a bounded by-rank/level step table) over a string expression, because the homebrew
  builder is a first-class surface and structured = dropdowns, not a formula box. Narrow
  escape hatch for power users. (Open decision — see below.)
- **`Predicate` (`when`)** — a declarative boolean tree (`all`/`any`/`not`/leaf-tag) over a
  **finite tag vocabulary** (`self:condition:frightened`, `target:trait:undead`,
  `weapon:trait:agile`). Same *structure* as Foundry/Avrae predicates, *our* tags. The
  static sheet evaluates against a small fixed tag set; the bot's combat tracker adds
  runtime tags — **one evaluator, two contexts.**

Deliberately **NOT** on the passive effect: **duration/lifecycle** (owned by the applied
effect / source) and **provenance** (on the content envelope).

---

## Layer 2 — the automation engine

### It's a runtime, and it's pure

The automation engine is a **tree interpreter, pure in `core`**. It takes
`(automation tree, context, seeded RNG)` and returns an **outcome**: an ordered list of
*intended mutations* + a *narration log* (rolls made, degrees achieved, damage per target,
effects to apply/remove). It does **not** touch persistence, Discord, or the DB. Each app
then *applies* the mutations — the bot to `state/combat.js`, the web to a preview/encounter.
This is the same "rules pure / persistence at the edge" split already done for combat v2,
at larger scale, and it is what stops the bot and web from implementing automation twice.

Seeded RNG ⇒ replayable ⇒ **testable**: every node and every worked example is locked by
tests, per the project's rules-from-source rule.

### Node vocabulary

Mapped from the Avrae reference, with divergences marked **[PF2e]**:

| Node | Purpose | Notes / divergence |
|---|---|---|
| `variable` | compute + bind a value for later use | forward-only lexical scope; `On Error` fallback |
| `roll` | roll dice, bind the result to a named var | feeds later `branch`/expressions via execution state (`lastRoll`, or the given name) — e.g. a d4 affliction table, a "recharge 6" roll |
| `text` | display narration | title + body |
| `target` | select creatures, scope children | modes: all / self / position(N); **ordered** list; **repeatable** scoping node; area/template targeting layers on later (bot combat) |
| `attack` | attack roll vs a defense | **[PF2e]** resolves to **four degrees**, not hit/miss; Avrae's `Advantage` dropdown → **Fortune/Misfortune** (roll twice keep higher/lower), which are *effects* not a roll setting |
| `save` | force a save vs a DC | **[PF2e]** four degrees; provide a **`basicSave`** shorthand (crit-success none / success half / failure full / crit-failure double) so authors don't hand-wire four branches |
| `check` | acting creature rolls a check vs a DC | active (vs `save`'s reactive); **best-of-skills** choice; DC is flat **or** target-stat-derived (**[PF2e]** e.g. vs a Fortitude DC = 10 + Fort mod); `Check Type` dropdown implies opposed/contested modes |
| `damage` | typed damage or healing | **[PF2e]** crit **doubles the final total**, not the dice; rich type vocabulary (see below); healing = negative damage `[healing]`; `scales like cantrip` uses the **PF2e** heightening formula |
| `temphp` | grant temporary HP | |
| `counter` | spend/restore a resource | signed amount (**recharge = negative**); `allowOverflow`; sources: system-assigned or custom; **spell slots are a specialized layer, deferred** (see below) |
| `branch` (condition) | boolean-expression if/else | `onTrue`/`onFalse`; boolean-expression flavor; **error behavior** required |
| `applyEffect` | impose an applied effect (Layer 1.5) | the bridge; can target multiple actors; can create **link groups** |
| `removeEffect` | remove an applied effect | with **parent cascade** (`removeParent`) |

### The degree-of-success resolver is a core primitive

`attack`, `save`, and `check` all resolve through one shared function: compare total vs DC;
beating/missing the DC by **10** shifts one degree; a natural **20** / natural **1** each
shift **one further** step. This interaction is subtle and squarely "implement from rules
text, never from memory" — it lives in core, tested, shared, exactly like the proficiency
tables. It must be **pluggable by Layer-1 `rollAdjust` effects** (Assurance; "treat a crit
failure as a failure") — this is the first real Layer-1 ↔ Layer-2 coupling, and it is
PF2e-specific.

---

## Layer 1.5 — the applied effect (the bridge)

An applied effect is the container where passive and active meet. Roughly:

```ts
interface AppliedEffect {
  name: string;
  duration: Duration;            // indefinite | timed | until-your-next-turn | sustained…
  tickTiming: TickTiming;        // start/end of whose turn — persistent damage & condition decrement
  sustained: boolean;            // PF2e "sustained" ≈ Avrae "requires concentration"
  passives: Effect[];            // Layer 1 — status bonus/penalty, etc.
  grantedActions: Action[];      // temporary activities gained while affected (stances, Escape)
  grantedButtons: Button[];      // Layer 2 automation triggers
  link?: LinkRef;                // parent/child relationship to a paired effect
}
```

Key properties learned from the walkthrough:

- **Buttons are self-contained mini-actions** — own presentation (label/verb/style), own
  automation tree, own DC/bonus **resolution chain** (explicit on node → button/effect
  default → actor's default casting/class stat).
- **Buttons are LIVE by default; capture is opt-in.** ~~Buttons capture context at *apply*
  time, not press time (a closure).~~ **Corrected 2026-07-15 (owner) — this Avrae framing is
  wrong for PF2e** and was nearly built. PF2e leans far harder on bonuses and penalties, so a
  derived DC must track *current* circumstances: if you grapple at Athletics DC 20 and then
  become enfeebled 2, the escape DC is 18 **while the grapple is ongoing** — not still 20. So
  `runButton` takes a context built **fresh at press time** and re-resolves against current
  stats (the host recomputes that sheet with `applyPassiveEffects` over the creature's active
  effects). The `applyEffect` node's `capture?` is **opt-in freezing**, for the narrow set that
  genuinely must not drift — the rank a spell was cast at, a one-time roll, a value from a
  creature that may be gone. The runtime still supports **deferred execution** — a button's
  automation runs long after, and detached from, the action that spawned it — it just resolves
  live rather than replaying a snapshot.
- **Granted actions ≠ buttons.** A granted action is a full activity the creature *gains*
  for the duration (a stance's special strike, an Escape action); a button is a quick
  trigger. **[PF2e]** stances and transformations lean on this heavily.
- **Effects can be linked into groups with cascade removal.** One invocation can apply
  effects to **multiple actors** (Constrict → Grappled on the target *and* Grappling on the
  caster), joined by `parent`, with **asymmetric per-actor buttons** (grappled creature
  rolls a check to escape; grappler just releases), and removing one **cascades** to both.
  Load-bearing for Grapple/Grab, tethers, mounted combat, shared conditions.
- **Lifecycle owner differs by context.** In combat the applied effect lives in the bot's
  `state/combat.js`; out of combat, plain passive effects apply on the character sheet. The
  *same passive schema* serves both — different lifecycle owner.
- **Sustain is ORTHOGONAL to duration (owner, 2026-07-15).** The `sustained: boolean` above is
  not redundant with `duration` — but it is too weak a type. There are effects with an ordinary
  duration that do **not** need sustaining, yet offer an *additional* effect when you Sustain
  them. So `sustain` is its own optional field (`{ extends?, onSustain? }`), never inferred from
  the duration; `duration: sustained` is the separate, self-extending case ("until the end of
  your next turn unless you Sustain").
- **Ticks PROMPT, they do not RESOLVE (owner, 2026-07-15).** `tickTiming` says only *when* a
  recurring effect fires. What it fires must also be **manually invocable** — because the
  defaults get overridden constantly: assistance lowers a persistent-damage flat-check DC, and
  abilities like *Cauterize* grant an immediate recovery attempt off-turn. So the tick and a
  button invoke the **same** automation, and its DC is a resolved value, not a constant. This is
  the same principle already locked for reactions ("auto-firing is wrong; proxy with buttons +
  text") extended to effect ticks: **no effect is purely automated — there is always a way to
  manually trigger a new attempt.**

---

## The expression system

A bounded, **sandboxed** evaluator — **never `eval`** (homebrew is user-submitted; this is
a security surface). The existing `evalNumeric` hand-written parser is the right instinct,
scaled up.

- **Three namespaces:**
  1. **character stats** — `strengthMod`, `proficiencyBonus`, … (the public API of the
     `core` character model — this is the seam between the engine and that model).
  2. **execution state** — accumulated by the interpreter as it runs: `lastDamage`,
     `lastCounterRemaining`, and **degree-aware** outcome refs. **[PF2e]** Avrae's binary
     `lastAttackDidCrit` becomes `lastAttack.degree`, enabling
     `lastAttackWasCritSuccess` / `…CritFailure` / `…Failure` — richer branching than
     Avrae's, falling out of the degree primitive.
  3. **target state** — `target.saves.get('Strength').value`; expressions read target
     stats, not just the caster's.
- **Typed flavors:** int (bonuses), dice/damage, boolean (conditions). The evaluator knows
  the expected return type per slot.
- **Function set stays small:** `max`, `min`, `floor`, `ceil`, `int`, arithmetic, … — no
  arbitrary code.
- **Bracing convention** (`{var}` inside a dice string) is a *consequence of storing a field
  as one flat string*. In a structured builder the ambiguity dissolves; keep brace-marking
  only for free-form / serialized-string fields. → structured in the UI, brace-marked on
  export.

---

## Cross-cutting: the error policy

Every node and expression that can fail carries a **defined fallback** — seen on Set
Variable (`On Error`/`Error Value`), Branch, Counter, and the nested nodes. The *option set*
is node-specific (`ignore` / `treat as false|true` / `raise` / `warn`) but the *concept* is
uniform. Design **one error-policy model** spanning expressions and nodes, not per-element
bolt-ons. For user-authored content this is essential: a homebrew action with a typo'd
variable must **degrade gracefully mid-execution**, not hard-crash the invocation.

---

## The damage-type vocabulary (its own contract)

`[magical slashing]` packs a damage type with a material/trait descriptor, and PF2e makes
this load-bearing for resistances:

- **physical:** bludgeoning / piercing / slashing
- **energy:** fire / cold / acid / electricity / sonic / vitality / void / force
- **materials:** silver / cold iron / adamantine / orichalcum … (resistance bypass)
- **categories:** persistent / precision / splash

Like the selector list, this is a finite enumeration, and a lot of PF2e correctness lives
in it (a creature "resistant to physical except silver" needs the material carried).

---

## Where PF2e forces divergence from Avrae (summary)

The divergences are also our best protection against reading as an obvious clone — the
structure genuinely has to differ.

| Avrae (5e-shaped) | Pathway (PF2e) |
|---|---|
| attack: hit / miss | **four degrees** (crit success / success / failure / crit failure) |
| save: fail / success | four degrees; **`basicSave`** shorthand |
| advantage / disadvantage | **Fortune / Misfortune** (effects: roll twice keep higher/lower) |
| crit = roll extra dice | crit = **double the final total** |
| flat DCs | also **target-stat-derived DCs** (vs a save DC) |
| `scales like cantrip` (5e) | PF2e cantrip heightening (half level, round up) |
| spell slots = uniform counters | **heterogeneous**: focus points, per-rank slots, prepared vs spontaneous, cantrips (unlimited), non-casters |
| `lastAttackDidCrit` (boolean) | `lastAttack.degree` (degree-aware, richer branches) |
| button context **frozen** at apply time (a closure) | **live by default** — re-resolved at press time against current stats, because PF2e's bonus/penalty layer moves DCs mid-effect (enfeebled drops a grapple's escape DC); `capture` is opt-in for what must not drift |

---

## Dependencies & sequencing

**Blocked on** (other tracks): ~~the `core` character model~~ ✅ **DONE (2026-07-14)** — the
character-stat namespace / engine input surface landed as `character.ts` (`ResolvedCharacter`
+ `resolveSelector` + `characterNamespace`); ~~the content/db schema~~ ✅ substantially built
(content-store + five entities).

**Shared primitives to design first** (both layers depend on them): ✅ **ALL DONE
(2026-07-14)** on `phase-7/core-character-model` — selector vocabulary (`selectors.ts`),
degree-of-success resolver (`degree.ts`, from rules text), damage-type vocabulary
(`damage.ts`), counter model (`counter.ts`), and the expression language (`expr.ts` — AST +
`evaluate`/`parseExpr` + `ExprScope`; `effects.ts` `evalNumeric` now delegates to it, killing
the duplicate parser). The character namespace (`characterNamespace`/`characterScope` in
`character.ts`) exposes ability mods, defenses/checks, skills, `rank("x")`, `keyAbilityMod`/
`spellcastingMod`, extra speeds, `focusPointsMax`. 213 core tests green.

**Staging:**
1. **Layer 1 first** — finishes the derived-stat consolidation (retire the duplicate
   `deriveCharacter`/`pathbuilder` sheet math) and delivers the character sheet. **The schema
   + apply landed 2026-07-15** (`predicate.ts` + `passive.ts`), additive: modifiers/notes fold
   onto `ResolvedCharacter`, the other kinds are collected. **Still open under Layer 1:** the
   duplicate *orchestration* (which ranks/abilities feed which stat) is not yet retired —
   content-in-core-blocked; the Foundry ingest (`collectSheetEffects`) still emits its own bag
   rather than mapping to `PassiveEffect[]`; and the web sheet does not yet consume
   `applyPassiveEffects`.
2. **Layer 2 next** — the automation runtime; where the bot's *play* lives. Larger; consumes
   the shared primitives; much of the *behavior* already exists in the bot to extract.
   Sequenced into 7 slices (owner-approved 2026-07-15), each its own plan→approve→build:
   (1) interpreter skeleton + `text`/`variable`/`branch`, (2) seeded dice roller + `roll`,
   (3) `attack`/`save`/`check`, (4) `damage`/`temphp`, (5) `counter`, (6) `target` scoping +
   multi-actor, (7) Layer 1.5 applied effect + `applyEffect`/`removeEffect`. Slices 3–4 need
   pasted PF2e rules text (basicSave + target-derived DC; crit-doubles-the-total + cantrip
   heightening); the rest are structural. **Slices 1–2 landed 2026-07-15.** Slice 1 (`rng.ts` +
   `automation.ts`): the execution model (context → outcome = log + intended mutations), the
   uniform error policy (ignore/warn/value/raise), and the rules-free nodes text/variable/branch.
   Slice 2 (`dice.ts` + the `roll` node): a dice parser/evaluator with full basic arithmetic
   (`+ - * /`, parens, variable terms) over the seeded RNG. **Slice 3 landed 2026-07-15**
   (`checks.ts` + the `save`/`attack`/`check` nodes): `rollCheck` (d20+mod vs DC → degree via
   `degree.ts`), `dcFromModifier` (the pasted `10 + modifier` rule), a `Dc` type (flat or
   target-stat-derived), a single `ExecutionContext.target`, per-degree child lists
   (`onCriticalSuccess`/…/`onCriticalFailure`) + degree execution-state refs. `basicSave` is
   carried as metadata; its none/half/full/double damage scale is applied by slice 4's `damage`.
   **Slice 4 landed 2026-07-15** (`checks.ts` multipliers + the `damage`/`temphp` nodes): the
   FIRST `mutations` producers. `damage` rolls typed components (`dice.ts` + `damage.ts` vocab,
   type optional so untyped/healing are valid) and optionally scales by a resolved degree —
   `scaling {by:"attack"|"basic-save", from?}` applies `attackDamageMultiplier` (crit x2 / hit x1
   / miss x0) or `basicSaveMultiplier` (0 / half / 1 / 2) to the total, floored once. `Mutation`
   is now `{damage} | {temphp}`. Heightening (cantrip half-level + the "+N per increment" scaling)
   is DEFERRED to its own slice — needs a cast-rank input the context lacks + ties to the
   spellcasting layer; rules text recorded. Resistance/weakness resolution is also deferred (with
   a "minimum 1" note for feat-granted resistance).
   **Slice 5 landed 2026-07-15** (the `counter` node over `counter.ts`): the purity seam is a
   read-only `ExecutionContext.counters` snapshot in, a `counter` mutation out; the run works on a
   clone so spends compound within one invocation without touching the caller's state.
   `requireAvailable` blocks a partial spend; `lastCounter…` refs remove the corpus's "dummy
   counter as a variable store" hack. The spellcasting specialization stays deferred (decision 4).
   **Slice 6 landed 2026-07-15** (the `target` scoping node + `rollMode`). `ExecutionContext.target`
   became `targets: ResolvedCharacter[]`; the interpreter tracks a current scope (default
   `targets[0]`), and `target {mode: all|self|position, index?, children}` re-scopes it per
   creature. Mutations now carry resolved attribution: `target: {kind:"self"} | {kind:"target",
   index}`. **The multi-target axis is the RANDOM ROLL, not the comparison**: `rollMode:
   "per-target" | "shared"` (default per-target) on the ACTOR-rolled nodes (attack/check/damage) —
   `save` has none, since a save is rolled BY each target. A shared roll is cached per target-scope
   iteration; the DC/AC lookup, degree, and multiplier stay per target. This is what expresses both
   *fireball* (each target rolls its own save; one shared 6d6 scaled by each result) and a
   *one-attack-roll-vs-many-ACs feat* (one d20 → different degrees per AC; one shared damage roll).
   Both are locked as tests. Area/template geometry stays the host's concern.
   **Slice 7a landed 2026-07-15** (`applied.ts` — the Layer-1.5 shape + duration/tick vocabulary
   + pure resolvers). `TurnMoment {when: start|end, whose: origin|bearer}` is the shared primitive
   behind both tick and expiry — modelling start/end *without whose* is how effects end up a turn
   off. `Duration` kinds come from the pasted Durations text, which pins the trap: **`rounds`
   decrements at the START of the ORIGIN's turn** (the caster's, not the bearer's), so a 1-round
   effect cast on your turn ends at the start of your *next* turn — the off-by-one falls out
   mechanically; and the origin anchor **outlives the origin** ("using the caster's initiative
   order"). `AppliedEffect.passives` is where **Layer 1 plugs back in** (`effectPassives`). Core
   owns the semantics (`advanceDuration`/`tickFires`/`sustainEffect`, tested); the host's tracker
   owns initiative + the round counter and feeds `TurnEvent`s. Note: `effects.ts`'s display record
   `AppliedEffect` was renamed `EffectProvenance` to free the doc-canonical name. **7b** =
   `applyEffect`/`removeEffect` nodes + mutations + link groups/cascade; **7c** = granted actions
   + buttons (apply-time context capture → the recursion), which is also where a tick's
   manually-invocable twin lives.
   **Slices 7b + 7c landed 2026-07-15 — Layer 2's node vocabulary is COMPLETE.** 7b: the
   `applyEffect`/`removeEffect` nodes + mutations; `EffectTemplate` (authored) split from
   `AppliedEffect` (runtime), since minting an instance id and reading the clock are impure and
   belong to the host; `linkGroup` is an authored label joining a paired application across two
   actors (Grappled on the target AND Grappling on the caster) so `cascade` removes them as a
   unit — the Grapple pair is a test. 7c: `Button`/`GrantedAction` + `runButton` (the recursion
   closing), `tickButton` wiring a tick to the same button a player can press off-turn, and
   `capture?` as opt-in freezing. **Module arrangement (owner chose A):** the loop
   applyEffect→template→button→node is genuinely mutually recursive, so the AUTHORED vocabulary
   (TurnMoment/Duration/Button/GrantedAction/EffectTemplate) lives in `automation.ts` beside the
   node union; `applied.ts` holds the runtime shape + timing resolvers and imports **one-way**
   (no cycle). A later cleanup could extract a `schema.ts` (option B) if `automation.ts` grows
   unwieldy.
   **HEIGHTENING landed 2026-07-16** (`heightening.ts` + `ctx.spell` + `damage.heightening` +
   the `heightened` node), from pasted Heightened Spells / Cantrips / Focus Spells text. The
   organizing insight: heightening is THREE shapes with three costs, and only one needed new
   machinery.
   - **`ctx.spell {baseRank, castRank}`** — the input the context lacked. The HOST resolves
     `castRank` (the slot used, or `autoHeightenRank(level)` for a cantrip/focus spell) and
     re-supplies it when building a button's press-time context; core owns the rules
     (`autoHeightenRank` = ⌈level/2⌉; `heightenIncrements` = `max(0, floor((cast-base)/step))`).
     Both ranks are exposed as ambient scope vars `castRank`/`baseRank` — the typed field stays
     authoritative for the arithmetic, exactly as `resolveDc` reads the real creature not a var.
   - **Flat heightening** ("the temporary HP increase by 5") → falls out of `castRank` in scope
     as plain arithmetic. **Zero new vocabulary.**
   - **At-rank heightening** ("Heightened (5th) …") → the `heightened` node. **OWNER CORRECTION
     (2026-07-16), the trap here:** an entry is a **floor, not an exact match** — it applies from
     its rank UP, and with several entries you read the **highest applicable one, never stacked**
     (Mystic Armor: entries at 2nd/5th/7th cast at 8th → the 7th; cast at 4th → the 2nd). The
     rules text's "read the entry only for the rank you're using" means *don't stack*, and its
     "those benefits will be included in the entry" is *why* entries are self-contained. Reading
     it as an exact match leaves a 4th-rank cast unheightened. Hence `minRank`, and selection by
     max — so authored order carries no meaning and cannot be got wrong. A `branch` chain can
     express this, but only descending, where authoring it ascending fails silently; that is why
     it is structured (locked decision #1) rather than left to authors and the ingest adapter.
   - **Interval heightening** ("Heightened (+1) The damage increases by 2d6") → the ONLY case
     needing new machinery: `damage.heightening {step, components}`, roll the per-increment
     components once per earned increment and sum. It sits inside the shared-roll cache (so a
     fireball heightens once and still scales per target's own save) and BEFORE the degree
     multiplier, keeping the single floor at the end. The fireball ladder from the rules text
     (6d6/8d6/10d6) is the anchor test.
   - **The `dice.ts` variable-dice-count deferral is CLOSED — superseded, not implemented.** It
     was deferred "pending rules text" for exactly this slice, but repeat-rolling is the better
     tool: `2d6` twice IS `4d6` (same distribution), it stays correct for a mixed `1d4+1` where
     scaling only the die count would leave the flat term behind, and it keeps the authored
     "+N per increment" structure the builder needs instead of pushing authors into hand-written
     rank arithmetic in a formula box. What remains is *non-heightening* level-scaled dice (a
     class feature or monster ability rolling dice per level) — **no consumer, not blocked**.
   - **Deferred, unchanged:** casting LEGALITY (a focus spell whose minimum rank exceeds half
     your level; a spontaneous caster needing the spell known at that rank) — rules-checking that
     belongs to the spellcasting layer (decision 4), not the damage math. Rules text is pasted in
     this session's history if needed.
3. **Homebrew authoring** — the builder UI that emits our schema, once the schema is proven
   on official content.

---

## Ingest review — the admin verification surface (planned)

Auto-mapping official content into our effect schema at ingest is **best-effort, not
trustworthy-by-default.** The Foundry rule-element corpus is large and irregular; our ingest
adapter will confidently map the clean cases and *punt* on the rest rather than guess (the
`skipped` counter on `collectSheetEffects` already works this way — every rule element it
can't map is counted, never invented). That means a human must be able to review what the
machine produced, confirm it matches the rules, and correct it. So:

- **An admin-only web page** ("Effect review" / content admin) that, per entity (feat, spell,
  granted action, condition, item), shows: the source rule text, the effects we
  auto-generated (Layer-1 passives + any Layer-2 automation on granted actions/buttons), and
  a **coverage signal** — what mapped, what was skipped and why. Admins verify each, or edit.
- **Adjustments reuse the homebrew authoring surface, not a bespoke editor.** Because official
  and homebrew share ONE schema (root architecture rule), an admin correction to official
  content is just an authored edit of the same effect tree the homebrew builder produces.
  The admin page is therefore *the homebrew editor + a coverage/diff view over the
  auto-ingested draft* — largely a consequence of building stage 3, not a separate engine.
- **Edits are versioned, not silent.** Per the pin-version invariant (root CLAUDE.md), an
  admin adjustment bumps the entity's content `version`; characters pin a version, so a fix
  is an explicit content update, never a retroactive mutation of live characters.
- **Provenance of the mapping is retained** — auto-generated vs. admin-verified vs.
  admin-overridden — so a re-ingest of upstream data never clobbers a human correction, and
  we can report "% of official content verified" as a real coverage metric.

**Sequencing:** the *coverage view* (what mapped / what was skipped) is a cheap diagnostic
that can land early alongside Layer 1 — it's essentially a UI over the `skipped` data we
already produce. The full *review-and-edit* surface rides on stage 3 (homebrew authoring),
since it reuses that editor. Not a v1-Layer-1 blocker, but a first-class part of trusting the
official-content effects, so it belongs in the plan of record.

### Ingest slice A landed 2026-07-16 — `foundry.ts` (the mapper + the report)

Sliced A (mapper+report, core) → B (wire the ingest script) → C (retire the runtime read) →
D (admin coverage view). **Owner reiterated the two constraints this exists to satisfy**, and
measuring the code against them produced the shape:

- **"Use Foundry once; don't rely on them continuously" — two dependencies, not one.** The
  *data-source* dependency was ALREADY fine (`ingest-pf2e.mjs` is manual + offline against a
  local clone pinned at `ea40c94`; only generated JSON is committed). The *schema* dependency
  was NOT: `feat.rules` stores their shape verbatim and `collectSheetEffects` interprets it
  **live on every sheet derive**. `foundry.ts` is now the one module allowed to know that
  shape, so the boundary is a file, not a convention. **Point 1 is not closed until slice C**
  removes the runtime read — `grep -rl RuleElement packages/core/src apps/web/src` is the
  check: when only `foundry.ts` matches, it's done.
- **"Review what was fetched/missed, then fix it up" — the old `skipped` scalar could not.**
  Measured over the corpus: of **5,143** rule elements on 2,429 feats, the old path produced
  ~239 effects, counted 1,284 `skipped`, and **3,620 (70%) were neither — silently inert**.
  In fairness `skipped` was never a coverage metric (it counts only 8 `DEFERRED_SHEET_KINDS`
  + unparseable values), but the practical effect was a number that read as far better
  coverage than existed. Replaced by a **per-element report**, invariant
  `report.length === rules.length` — nothing can fall through.
- **Reasons are named after the BLOCKER, not the symptom**, so tallies are a roadmap.
  Post-slice-A corpus: **306/5,143 mapped (5.9%) → 312 PassiveEffects; 4,837 unsupported;
  0 silently dropped.** By reason: `needs-combat-tags` 1606 · `needs-item-model` 1446 ·
  `needs-granting` 620 · `unsupported-shape` 396 · `unsupported-selector` 394 ·
  `needs-runtime-choice` 297 · `unsupported-value` 75 · `unsupported-bonus-type` 3.
  **5.9% is the honest number and the point of the slice is not to raise it** — it is that the
  other 94% is now named. (My pre-build estimate of ~1,500 mappable was ~5x optimistic: 91% of
  FlatModifiers are predicated, and 40 of the biggest value idiom are deep Foundry actor refs.)
- **Conditional elements are reported, never mapped-with-the-condition-dropped** — that would
  turn a situational bonus into a permanent one (a wrong sheet), which is worse than an absent
  effect. 540 of 592 FlatModifiers are predicated; Foundry's predicates need the combat tags
  deferred in decision 3 and use numeric leaves our tag model deliberately excludes.
- **Provenance model settled now, editor still stage 3** (owner call). `effects` (ours, the
  ONLY thing runtime reads) + `ingest {raw, report, sourceCommit}` + `review {status}`, via
  `effectBearingShape`, spread into `featSchema`. Two deliberate properties: `ingest.raw` is
  typed **`unknown[]`, not `RuleElement[]`** — the *content* schema doesn't know Foundry's type
  at all, the strongest form of the quarantine; and `review.status` is a message to the
  **re-ingest** ("`overridden` ⇒ don't replace `effects`"), never to the sheet. An admin edit
  bumps `version` per the pin invariant.
- **THREE LAYER-1 GAPS THE INGEST EXPOSED** (2 fixed, 1 deferred):
  1. ✅ **`grant`'s numeric payloads were `z.number()`** → now `exprSchema`, like
     `modifier.value`. "Fire resistance equal to half your level" was *unrepresentable*: a
     grant is ingested with no character in hand, so there is nothing to evaluate against.
     Contradicted decision 1 ("every value IS an expression"); nothing consumed grants, so the
     fix had zero blast radius.
  2. ✅ **`hp` was missing from `FIXED_SELECTORS`** (the doc's selector list names it) →
     added, `resolveSelector` → `hp.max`. Without it the mapper couldn't do Toughness and
     would have *regressed* against `collectSheetEffects`.
  3. ✅ **`expr.ts` was a NO-INFIX grammar** → **fixed 2026-07-17** during the main merge, which
     forced it: every one of the 32 ancestry/heritage resistance values in the corpus is
     `max(1,floor(@actor.level/2))` or `floor(@actor.level/2)`, so porting `collectTraits` onto
     the engine without infix would have silently deleted every resistance from the sheet.
     Infix DESUGARS TO THE EXISTING CALL NODES (`a/2` → `divide(a,2)`), so `Expr`, `exprSchema`
     and every stored effect were untouched — a parser surface, not a value shape; only
     `divide` was new vocabulary. The mapper needed **no change at all**: widening the grammar
     moved a whole reason-bucket into coverage by itself, which is exactly what the reason
     tallies are for. Also ends the `dice.ts`/`expr.ts` two-grammar inconsistency.

### Ingest slices B + C landed 2026-07-16 — POINT 1 IS CLOSED

B and C shipped together because they are one migration: writing effects nobody reads, or
reading effects that do not exist, are each incomplete halves.

- **The boundary check now passes.** `grep -rl RuleElement packages/core/src apps/web/src` →
  only `foundry.ts` + its test. Nothing else in the codebase knows Foundry's shape exists.
  Verified in the PRODUCTION BUNDLE too: `FlatModifier` = 0 hits, `mapFoundryRules` = 0 hits
  (the mapper tree-shakes out). Their vocabulary no longer reaches a browser. (Three Zod enum
  strings from `featSchema`'s optional `ingest`/`review` remain — inert metadata, a few
  hundred bytes, not a coupling.)
- **`collectSheetEffects` → `collectPassiveSheetEffects`** (passive.ts). Same `SheetEffects`
  output contract, so `deriveCharacter` is untouched; the only change is the INPUT — our
  `PassiveEffect[]` instead of their rule elements. It is the sibling of `applyPassiveEffects`,
  and both exist because there are two moments: `apply` is POST-hoc (folds onto a resolved
  sheet, cannot apply a rank grant); `collect` is PRE-derivation (rank grants land before
  proficiency is computed). `evalNumeric` and `collectSheetEffects` are DELETED — the first
  existed only to evaluate Foundry's value strings at runtime.
- **Foundry's broadcast selectors are gone by construction**: `saving-throw`/`skill-check` fan
  out to individual stats AT INGEST, so `statBonus` gathers `fortitude`, not `saving-throw` +
  `fortitude`. `land-speed` → `speed:land`.
- **PARITY IS THE PROOF.** The web's real-dataset sheet tests passed UNCHANGED across the swap:
  Toughness +5 HP at L5, Adroit Manipulation → trained Thievery, Superior Sight → +2 Perception,
  featless build unchanged. Same feats, same sheet, different pipeline.
- **`feats.json` 6.35 MB → 4.65 MB.** Removing Foundry's rule elements from the shipped data
  makes the client ~1.7 MB lighter — the coupling was costing players bandwidth.
- **`scripts/remap-effects.mjs` is the durable win.** It re-runs the MAPPER over rule elements
  we already hold (from the sidecar's `raw`), so coverage improves as the mapper improves —
  **without a Foundry clone, ever again**. `ingest-pf2e.mjs` (needs the clone) is only for when
  CONTENT itself is re-ingested. That split is the concrete form of "use them once": when
  expr.ts learns infix, run remap and coverage rises. Foundry is not in the loop.
- **The sidecar `effect-ingest-report.json` (3.0 MB) is ADMIN-ONLY** — raw + per-element report
  + summary, deliberately not imported by the builder, so none of it reaches a player. Slice D
  (the coverage view) is a UI over this file; it exists and is browsable now.
- One web test had to change, and the change is the architecture moving: it asserted a runtime
  `skipped` count for Untrained Improvisation. The runtime no longer SEES unmappable elements —
  they are rejected at ingest with a reason (`unsupported-bonus-type: type "proficiency"`). The
  test now checks both halves: absent from the sheet AND named in the report. `SheetEffects.skipped`
  now means only "passive effects we hold that this derivation cannot apply".
- ⚠️ **CI's `packages/core run typecheck` had been RED since 2026-07-15** and nobody noticed:
  `build` excludes `*.test.ts` and `vitest` does not typecheck, so a type error in a core test
  is invisible to both. Two errors pre-dated this session (`applied.test.ts` importing `Duration`
  from `applied.js`, which only imports it one-way from automation.ts and never re-exports; a
  strict-undefined in `passive.test.ts` from the Layer 1 slice) and one was mine from ingest
  slice A (the grant widening). All three fixed. **Run `npm --workspace packages/core run
  typecheck` — `npm test` will not catch this class of break.**

---

## The prose-first pivot + the candidate/review model (2026-07-16)

**Owner direction:** Foundry is no longer the primary ingest route. A text parser over PF2e
rules prose becomes the main producer; Foundry stays as a **corroborator**. Reasons, in order
of weight:

1. **Prose strictly contains more than the rule elements.** *Adroit Manipulation*'s text says
   "trained in Thievery **(or another skill of your choice, if you're already trained in
   Thievery)**"; its entire rule-element array is one `ActiveEffectLike`. Foundry drops the
   fallback clause. So the mapper has a **ceiling below the rules** — you cannot map what was
   never encoded. 126 feats carry that prose pattern.
2. **Licensing.** Foundry's `system.rules[]` encodings are *Foundry's own work* (locked
   decision, top of this doc) — not Paizo ORC content. A commercial Pathway cannot derive its
   effects from them. A parser over **rules prose** is clean ORC material and is
   **source-agnostic**: same parser on AoN today, Paizo's ORC release later. This removes a
   commercialization blocker the mapper can never remove. (Get the IP review anyway.)
3. Coverage: 7 crude extractors reach **1,051 feats (17.2%)** vs the whole Foundry mapper's
   **251**.

**Why Foundry stays** (do not delete it): its elements are *human-authored* — high precision,
low recall; the parser is the inverse. Two independent derivations agreeing is **evidence**.
It is also a free **labeled test set**: measured parser recall vs its skill-rank grants is
~79% (171 agreed / 45 missed) — and on the first real run a conflict caught the parser reading
"when you are **legendary in Medicine**" (a *condition*) as a *grant*, on a feat whose actual
text is "you become an expert in Medicine". Without the second opinion that ships silently.

### Probe findings (2026-07-16) — measured, not assumed

- **Sentence templating FAILS.** 96% of sentence templates are one-offs; the top 1,000 cover
  21.7% of mechanical sentences. A template-matching parser drowns in the tail.
- **Effect templating COLLAPSES.** The same extractions fall into **57 effect shapes**; top 5 =
  60%, **top 20 = 90%**. The prose hides the redundancy ("gain the trained proficiency rank in
  {skill}" / "are trained in {skill}" / "become trained in {skill}" are one effect in five
  costumes). ⇒ **the parser must work at CLAUSE level with a semantic target, never sentence
  templates**, and review is "confirm this shape across 150 feats", not 150 forms.
- **The bottleneck is ANAPHORA, not vocabulary.** ~24% of extractions know the value and bonus
  type but not the target, and the top unresolved targets are *"the check"*, *"your check"*,
  *"the attack roll"*, *"the save"* — pronouns pointing at an earlier clause. No dictionary
  fixes it. ⇒ partial extraction + human resolution is the CORRECT architecture here, not a
  workaround for a weak parser.
- 67.3% of feats have mechanical prose (the recall ceiling); 6,116 feats total.

### The model — `candidate.ts` (landed 2026-07-16)

**THE SPINE: candidates are not content.**
`producers → candidates (a work queue) → promote → effects (content, versioned, applied)`.
Separate stores, because candidates regenerate whenever a producer improves and content is
pinned by characters — if candidates lived on the entity, a parser tweak would bump every
`version` and force a content update on every character. It is also what makes the owner's
"guess if it's close" safe: a guess is *structurally incapable* of reaching a sheet. No
regression, either — today's 306 Foundry effects are already in `effects` and keep applying.

- **Agreement is EARNED, not scored** — deliberately no numeric confidence (a parser does not
  know how right it is; a score invites false precision). `corroborated` / `conflicting` /
  `parser-only` / `foundry-only` are *facts about the producers*.
- **The schema IS the completeness check.** `promote()` runs `passiveEffectSchema.safeParse`;
  there is no second "is this finished?" predicate to drift. `gaps` exist to EXPLAIN a hole to
  a human. Promotion refuses gaps (a bonus on the wrong stat, or a situational bonus gone
  permanent) and refuses conflicts (no coin-flip winners).
- **`effectSignature` powers bulk**: generalizes `proficiency:thievery` → `proficiency:skill:trained`.
- **Auto-promote = corroborated + complete** (owner, 2026-07-16); listed and reversible.
- **Decisions point at (entityId, key), not at a candidate** — candidates are ephemeral; an
  `accept` carries the FINAL effect so a human's judgment outlives the proposal.
- **Storage-agnostic on purpose** (owner: everything ends up in the DB eventually; don't
  overbuild on files). Pure functions over values; the file/DB edge lives outside the module.
  v1 sink = an exported decisions file, committed, folded in by `remap-effects.mjs`.

**Measured on the real corpus, both real producers**: 1,102 candidates → 173 auto-promote
(15.7%, zero review), 1 conflict, 395 gapped, 533 single-source. **929 needing a human fall
into 27 shapes; 12 shapes cover 89%.** That is the review UI's spec.

**Next:** the parser proper (`prose.ts`, sibling to `foundry.ts`), then the review UI, then the
authoring interface.

## The `main` merge — absorbing the sheet features (2026-07-17)

`main` had diverged 30 commits while `test` built the engine, and it had built MORE on the
Foundry-at-runtime mechanism the engine exists to replace. Owner policy going in: *keep their
features, discard their mechanism.* Every feature was kept; the mechanism is gone.

**Two runtime Foundry interpreters were absorbed, not two halves of one:**
- `collectTraits(itemRules: RuleElement[][], …)` → now `collectTraits(itemEffects, ctx, labels)`
  in `passive.ts`, the THIRD consumer of `PassiveEffect[]` beside `applyPassiveEffects` and
  `collectPassiveSheetEffects`. It reads the `grant` slice the other two deliberately punt on —
  the doc's "no senses/resistances field on the model yet" was exactly what main built.
  Attribution comes from the CALLER, because provenance lives on the content envelope, never on
  an effect.
- `featChoicePrompts`/`resolveChoiceGrants` — a SECOND interpreter the handoff hadn't named,
  reading Foundry's `ChoiceSet`/`ActiveEffectLike` and substituting
  `{item|flags.system.rulesSelections.<flag>}` at runtime. Its input (`feat.rules`) no longer
  existed on `test`. Replaced by `EffectChoice` (passive.ts) + `mapChoiceGroups` (foundry.ts):
  **the options and their effects are content, resolved at ingest; only the pick is runtime.**

**The insight that collapsed the choice mapper:** what looked like three shapes (Canny Acumen's
whole-path options, Skill Training's `{config:'skills'}`, Fighter Dedication's bare-slug list) is
ONE rule — *substitute the selection into the AEL's path, then resolve it as a rank path* —
because substitution IS Foundry's mechanism. An option that doesn't resolve is dropped, which is
what makes the rule safe to apply broadly. Only Clan Lore's nested sub-field selections are a
genuine exception. This maps **30 feats, including ~18 `main` silently dropped** (its
`mappableRankPath` filter rejected bare slugs).

**Two model gaps the merge exposed, both decision 1 ("every value IS an expression") unapplied:**
1. ✅ infix — see gap 3 above.
2. ✅ **`proficiency.rank` was a literal 0–4** → now `RankValue` (`rankSchema | exprSchema`),
   resolved by `resolveRankValue(rank, level)`. Canny Acumen grants *expert, or master at 17th*
   (`ternary(gte(@actor.level,17),3,2)`); a literal made that unrepresentable, and mapping it as
   a flat 2 is a wrong sheet at 17+. The literal stays first in the union, so every stored rank
   but one validates unchanged and reads back as a number. Ripple was 2 call sites (both already
   had a level); the feared `candidate.ts` coupling was imaginary — its `rank?: number` is its
   own draft field. A `needs-rank-expression` reason was added, then removed once the fix landed
   and made it unreachable.

**Also folded in, because the merge made them true:**
- `remap-effects.mjs` generalized from feats-only to a DATASET table. Rules live on the NESTED
  `heritages[]` inside `ancestries.json` (49) and on `versatile-heritages.json` (20) — walking
  only the top level finds zero. Sidecar entities are keyed `kind:id` so a heritage id cannot
  shadow a feat id.
- The **darkvision-supersedes-low-light** sense rule was implemented TWICE on main (builder +
  imported sheet). It moved into core's `collectTraits` — a sense rule implemented twice is the
  exact duplication core exists to prevent.
- `/admin/effect-coverage` is now gated by `RequireAuth`+`RequireAdmin`. Its own comment said
  "wrap it the day roles exist"; main's admin dashboard is that day.
- Choice picks are stored in OUR vocabulary (`will`), not Foundry's path (`system.saves.will.rank`).
  Pre-migration saves are normalized on READ (`featChoicesFor`) — a feat quietly ceasing to grant
  is exactly the failure nobody notices.

**Coverage: 306 → 457 mapped (5.9% → 8.8%), 467 effects, 30 entities with choices, 0 silently
lost.** The mapper itself barely changed; most of that came from widening the MODEL, which is the
remap script's whole thesis — coverage rises without Foundry in the loop.

**The boundary still holds, verified in the production bundle:** `grep -rl RuleElement
packages/core/src apps/web/src` → only `foundry.ts` + its test. `FlatModifier`/`ActiveEffectLike`/
`ChoiceSet` appear ONLY in the lazily-loaded, admin-gated `effect-ingest-report` chunk (the raw
quarantine, by design); `mapFoundryRules`/`mapChoiceGroups` tree-shake out entirely. `rulesSelections`
went from main's 317 to 2 — and those 2 are Foundry template artifacts in Paizo DESCRIPTION PROSE
(*Invoke the Elements*, *Heart of the Kaiju*), pre-existing on `test`, cosmetic, not a coupling.
Worth cleaning at ingest someday.

**763 tests green** (core 478 · bot 209 · web 61 · db 15), web typecheck + lint + production build
clean. Main's real-dataset sheet tests — including `sheetStats.test.ts`'s imported-character
senses/resistances — passed UNCHANGED through the rewired pipeline. That is the parity proof.

## Decisions (resolved 2026-07-13)

1. **Value model → structured now, forward-compatible to expressions.** Store the canonical
   value as the **expression representation** (a small AST); "structured" is a *constrained
   editor* that emits a subset of that AST. Adding a free-form expression mode later is then
   **purely additive and zero-migration** — every value already *is* an expression under the
   hood, so widening the editor breaks no existing homebrew. Ship structured; pivot toward
   more expression freedom only where we keep hitting walls, without deleting anyone's work.
2. **Predicate ceiling → full predicate for everyone** (folds into #5). Revisit as planning
   continues.
3. **Runtime tag depth → design predicate structure + static tags now, defer combat tags.**
   Clarified scope: the tag vocabulary *only* powers the `when?` condition on **Layer 1
   passive effects** (when a modifier switches on). It does **not** gate effect or automation
   *creation*. Unconditional passives, character/static-conditional passives, and the entire
   Layer 2 automation tree (whose `branch` conditions are boolean *expressions*, a separate
   mechanism) all work without the combat tags. Deferring combat tags only defers passives
   that hinge on momentary combat state (flanking, off-guard).
4. **Spell-slot modeling → general counter primitive + specialized spellcasting layer.** The
   counter is the primitive; spellcasting resources (focus points, per-rank slots,
   prepared vs spontaneous) are a specialized layer the same spend/restore verbs target.
   Prepared-vs-spontaneous consumption details deferred.
5. **Homebrew ceiling → no gating; design for all users at once.** With a tester-only
   audience, treat every current user as a power user. Expose the **full node set and full
   expression surface to everyone** — no permissions/tiering machinery in v1 (less to build,
   not more). Add tiering only when there's a broad user base.

---

## Using the Avrae corpus (methodology reminder)

The collected test-character actions are a **semantic coverage checklist**, not a parse
test. For each action ask only: *is there any capability this action needs that our node
vocabulary cannot express?* Translate intent, discard syntax. A parse failure means nothing;
a missing *capability* is a real gap.

### Validation run — 16 actions (2026-07-13)

The vocabulary covered the corpus almost completely. Findings:

**Genuine additions to the node/effect set (small):**
- **`roll` node** — a standalone dice roll bound to a named execution-state var, consumed by
  later branches (a d4 "roll on this table," a "recharge 6" check). Added above.
- **Set / override stat mode** — `ac_value: 19` *sets* AC to a fixed value (ignoring Dex),
  not a bonus. Our Layer-1 modifier model is additive; we need an explicit **`set`/override**
  mode for a stat. Also required for PF2e **polymorph / battle forms** (which set AC, attack
  mods, etc.), so this is load-bearing, not niche.
- **Runtime choice / prompt** — several actions need a value chosen *at invocation* (how many
  dice from a pool to spend; an earlier action's `choice != ""`). A prompt/choice mechanism
  that binds user input into execution state. Note it as a first-class capability.

**Where our design is *cleaner* than Avrae's (validates building our own):** the corpus is
full of workarounds for primitives Avrae lacks, which our model removes —
- damage reduction / resistance authored as a granted "negative-damage attack" (`[reduce]`)
  → for us a plain **passive resistance grant**;
- a **dummy counter abused as a variable store** to stash "damage taken" and scale a DC
  (`dc: 5 + lastCounterRequestedAmount`) → for us, exposing the value cleanly in execution
  state + the real `variable` node makes the hack unnecessary;
- **pseudo-damage-types as labels** (`[fortitude]`, `[decomposition]`) to mean "untyped /
  unpreventable" → for us, **untyped damage + a display label** distinct from mechanical type.

**Named frontier — event-triggered automation. Turn-tick: handled. Reactions: deprioritized
(2026-07-13).** Distinguish two kinds:
- **turn-tick triggers** (start/end of turn) — already handled by the applied-effect
  `tickTiming` + the bot's combat tracker (persistent damage, condition decrement). Keep.
- **reaction-to-event triggers** (on-miss, on-hit-by, on-crit; reactive strike, Shield
  Block) — **explicitly not a priority.** Owner decision: it's not just hard, it's
  *low-value*, for three reasons: (1) we often can't reliably *know* a trigger condition was
  met; (2) even when we do, the player must *choose* whether/which reaction to spend (Shield
  Block vs Reactive Strike), so auto-firing is wrong; (3) it depends on positioning we don't
  own — there's no built-in battlemap and players use Foundry/Owlbear Rodeo anyway. Avrae
  doesn't automate reactions either; we proxy with buttons/granted actions + text, which is
  sufficient. Revisit only as a "later, if we get bored" feature.

**PF2e-divergence confirmations (not gaps — the corpus is 5e-authored):** advantage/
disadvantage (`attack_advantage`/`check_dis`), 5e damage types (thunder/radiant/necrotic),
5e conditions (Incapacitated/Befuddled), Con-save concentration, bonus actions, "Recharge 6".
All expected — they confirm our PF2e-native vocabulary choices rather than revealing holes.
