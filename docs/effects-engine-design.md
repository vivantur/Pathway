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
- **Buttons capture context at *apply* time, not press time** (a closure). When Constrict
  applies Grappled, the grapple DC is *frozen into* the escape button, used when the target
  presses it turns later. The runtime must support **deferred execution with captured
  context** — the automation on a button runs long after, and detached from, the action
  that spawned it.
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

---

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
