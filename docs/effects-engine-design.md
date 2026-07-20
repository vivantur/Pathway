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

> **Strikes, weapons, runes, and MAP live in their own doc (2026-07-19):**
> [`strikes-and-weapons.md`](./strikes-and-weapons.md). That work is the largest single
> coverage unlock in the corpus — `needs-item-model` is 32% of all unsupported ingest
> elements — and it is what makes the reserved `attack`/`damage` selectors real. It was
> split out because this doc is past 120KB and no longer readable end to end. Read it
> before touching strikes, weapons, or the multiple attack penalty; the owner-supplied
> rules text for runes, deadly/fatal, MAP, and critical specialization lives there.

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

## Where this stands — distance to the first-goal state (measured 2026-07-18)

*Everything in this section was verified against the code and the SHIPPED DATA, not
against the status prose elsewhere in this repo. Re-verify before trusting it; the
one-liners are all reproducible with a `node -e` over the datasets.*

The owner's **first-goal state** — the engine's essential functions — is three things:

1. the web character builder assigns **passive effects AND new actions** from chosen feats;
2. users get **basic-strike effects from weapons + runes**, Pathbuilder-style, on the sheet;
3. **spell effects work when cast**, including heightening (spell *slots* explicitly later).

**The headline: the engine is largely built; the content and the app wiring are not.**
Every goal below is blocked on authoring + wiring rather than on missing engine
capability — with ONE exception (weapons), which needs genuinely new engine surface.

### Goal 1 — feats → passives + actions

**Passives are DONE and live.** `characterEffects()` (`apps/web/src/features/builder/
rules.ts`) walks the chosen feats, takes `effects` + `resolveChoiceEffects(choices)`, and
runs them through core's `collectPassiveSheetEffects` onto the sheet. That wire is complete.

**The constraint is coverage, and it is small: 265 of 6,116 feats carry effects (4.3%).**
The review queue's ceiling is measured: 1,096 feats have at least one candidate, so
resolving the ENTIRE queue reaches **~17.9%**. Of those, **590 feats are fully resolvable
today with no gap-filling at all** — they are merely undecided, which is the cheapest
coverage in the project.

**Actions are NOT started.** Zero feats carry actions; the feat schema has no `actions`
field (it parses action *cost*, a different thing). Core has `GrantedAction` and a tested
Layer-2 interpreter, and the BOT executes trees — but **`apps/web` never imports the
automation engine at all.**

### Goal 2 — weapons, runes, strikes (the biggest gap, and the only one needing new engine)

Weapon DATA is already rich: 5,218 items, weapons carrying `damageDie`, `damageType`,
`group`, `hands`, `range`, `traits`. What is missing is the mechanical layer:

- **`attack` and `damage` selectors return 0.** They are explicitly RESERVED in
  `selectors.ts` ("per-weapon, the resolved model does not carry them yet"). So today **no
  effect can modify an attack or damage roll.**
- **No item/weapon schema in core** — `items.json` is validated by nothing.
- **No rune system.** The 28 rune-ish entries are wondrous items; potency/striking are not
  modeled.
- **No Strike model** — nothing computes "your Strike with this weapon is +X for YdZ+W".

This is the same missing piece that blocks the bot's scoped attack/damage selectors (see
CLAUDE.md on Enfeebled/Clumsy), so it pays off twice.

### Goal 3 — spells on cast, with heightening (further off than it looks)

- **0 of 1,818 spells carry effects or automation.**
- **The spell schema has no `effects`/`automation` field at all** — deliberately deferred
  in `spell.ts` to "a later effect system".
- `heightening.ts` is two pure functions (`autoHeightenRank`, `heightenIncrements`) — the
  rank MATH, not the application of heightened effects.
- The 543 spells carrying `heightening` hold **raw Foundry shape**
  (`levels: {3: {damage: {…}}}`), a different encoding from core's `heightenEntrySchema`.
- **No producer exists for spell automation.** The prose parser emits Layer-1 passives only,
  so trees would be hand-authored via `AutomationEditor` — viable for the top ~50 spells,
  not for 1,818.

### Cross-cutting: the shipped content does not conform to core's schemas

**Feats, ancestries, backgrounds and spells all validate 0/300 against core's content
schemas.** The schemas are real and tested; the shipped JSON is a separate, older ingest
shape that predates them. Nothing is broken by this today — the web reads the JSON with its
own TS types, and the `effects` field genuinely IS core's `PassiveEffect`, which is exactly
why goal 1 works. But it means "add an automation field to the spell schema" would be adding
a field to a schema nothing currently conforms to. This is the "`packages/db` not wired, the
JSON is transitional" gap showing its true size.

### Suggested ordering

1. **Finish goal 1's passives** — nearest to done, and `resolution.ts` unblocked exactly it.
   590 feats are decidable before anyone fills a single gap.
2. **Weapons/strikes** — biggest lift, makes the sheet feel real, unblocks the bot too.
3. **Spells** — needs a schema field, a web execution surface, and hand authoring.

Goal 1's *actions* half shares the "no web automation surface" blocker with goal 3, so those
two are probably cheaper together than in goal 1's slot.

### The silent corpus — 5,020 feats that never reach review (measured 2026-07-18)

The review queue shows 1,820 candidates over **1,096** feats. The other **5,020 feats propose
nothing at all**, and until now there was no way to see them — which made the queue look like
the whole problem when it is 18% of it. Classified by why they are silent:

| count | why | |
|---|---|---|
| 3,302 | **no producer saw it** — absent from the Foundry ingest AND the parser found nothing | |
| 1,718 | **Foundry had rule elements, every one mapped to `unsupported`** | |

For that second group the blocking reasons are already recorded per element by `foundry.ts`,
and **they are the roadmap, restated from the other side**:

| elements | reason | |
|---|---|---|
| 1,352 | `needs-item-model` | ← this is goal 2 |
| 968 | `needs-combat-tags` | |
| 420 | `needs-granting` | |
| 288 | `unsupported-selector` | ← the reserved `attack`/`damage`, also goal 2 |
| 266 | `unsupported-shape` | |
| 207 | `needs-runtime-choice` | |
| 27 | `unsupported-value` | |

(Element counts, not feat counts — one feat can be blocked several ways.) That
`needs-item-model` is the single largest blocker is independent confirmation that the weapon
work is correctly ranked #2, arrived at from the corpus rather than from intuition.

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
> character's `staticTags` unioned with `rollTags` (the opposed context of a roll) and any
> caller-supplied combat tags — *one evaluator, N producers*. **Not yet built:** the
> `set`/override full-stat mode (polymorph; validation-run
> item), grant/rollAdjust *behavior*, combat-state tag production, the `collectSheetEffects`→
> `PassiveEffect[]` ingest refactor, and retiring the duplicate builder/pathbuilder
> orchestration (all still additive-blocked or their own slice).

A passive effect is a *targeted, typed, conditional change*. Small discriminated union:

```ts
type Effect =
  | { kind: 'modifier';    target: Selector; bonusType: BonusType; value: Value; when?: Predicate }
  | { kind: 'proficiency'; target: ProfSelector; rank: Rank; mode: 'upgrade' | 'set' }
  | { kind: 'grant';       grant: Grant; when?: Predicate }        // sense, speed, resistance, trait, action
  | { kind: 'rollAdjust';  target: Selector; adjust: DegreeShift | DegreeMap | Reroll; when?: Predicate }
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

**Degree adjustments are CONDITIONAL on the incoming degree (landed 2026-07-19).** The
original `DegreeShift` said only "one degree better/worse", unconditionally — and almost
no PF2e prose says that. It says *"when you roll a success against a fear effect, you get
a critical success instead"*, which is silent about the other three degrees. 167 clauses
across 131 feats carry that shape, and `foundry.ts` had already named the gap by dropping
`AdjustDegreeOfSuccess` as `unsupported-shape`. So `adjust` gained a **`degreeMap`**: a
partial map from incoming degree → resulting degree.

The map targets an **absolute** degree, not a step count. That is what the prose literally
says ("you get a critical success *instead*"), and it subsumes the **floor** shape without
a second primitive — Forager's "any result worse than a success, you get a success" is
just `{ 'critical-failure': 'success', failure: 'success' }`.

Ordering when several apply to one roll is **owner-supplied (2026-07-19)**, not derived:
*apply all the effects that improve the degree, then any that worsen it; each effect can
change the degree at most once.* Two consequences are load-bearing and locked by tests:

- **The order is only observable at the clamp bounds** — on a critical success, one
  improver plus one worsener yields success, while the reverse yields critical success.
  Collapse this to a sum of deltas and the rule becomes vacuous.
- **"Once" means every effect is measured against the same incoming (post-natural-20/1)
  degree.** Adjustments never cascade into one another, and the outcome does not depend
  on the order a sheet happens to list its effects in — which a pure engine requires.

`degreeAdjustmentsFor` (passive.ts) is the bridge from the collected `rollAdjusts` bucket
to `resolveCheck`/`rollCheck`. It drops `reroll` payloads: Fortune/Misfortune operates on
*dice*, not degrees, and is still unwired. **The interpreter is not yet bound**: a `save`
node is rolled by the TARGET and a `check` node by the actor, so adjustments must be
selected per *roller*, and neither `ResolvedCharacter` nor `ExecutionContext` carries a
creature's passives today. That binding is an open model decision.

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

## Conditions — `conditions.ts` (slice 1 landed 2026-07-18)

The 41 PF2e conditions, built from rules text supplied by the owner (Player Core 442–447).

**The finding that shaped the module: most conditions are not modifiers.** Roughly a dozen
reduce to typed penalties; the rest change action economy (Slowed, Stunned), detection state
(Hidden, Invisible), or are GM adjudication (the five attitudes). So a condition is *not* "a
bundle of PassiveEffects" — it MAY contribute passives and MUST name what it does beyond
them, via a closed `UnmodeledReason` vocabulary. Same discipline as `foundry.ts`: an
approximate penalty on a sheet is a wrong sheet, so a condition whose penalty we cannot
express exactly emits nothing and says why. `conditionGaps()` reports those blockers so a
caller cannot present a partial answer as a complete one.

**The three general stacking rules come almost free.** Conditions emit `status`-typed
modifiers, so `stackModifiers` already yields "only the worst penalty applies" (Clumsy 1 +
Frightened 2 on AC is −2, never −3) and lets a status bonus coexist with a status penalty.
Off-Guard and Prone are `circumstance`, so they stack *alongside* status penalties. Only the
third rule needed new code: the same condition applied twice keeps the worst (Enfeebled 1 +
Enfeebled 2 = Enfeebled 2), which is instance dedup in `applyCondition`, not modifier stacking.

**Implications and overrides are a VIEW, not a mutation.** `resolveConditions` expands
`implies` transitively (Dying → Unconscious → Blinded + Off-Guard) and then applies the three
explicit overrides (blinded>dazzled, restrained>grabbed, stunned>slowed). Suppression is
computed rather than stored, so Escaping a restraint correctly leaves you still Grabbed.

**Two deliberate non-claims:**
- **The death track is bot-owned.** Dying/Wounded/Doomed carry no passives and are marked
  `death-track`. Their math lives in `apps/bot/src/rules/combatV2/model.js` under 82 tests,
  and CLAUDE.md names dying/recovery drift as the bug that justified `packages/core`. Core
  asserting a second version would recreate exactly that. Consolidation is its own slice.
- **`apps/bot/src/rules/effects.js` is a second, partial condition table** (20 conditions in a
  five-bucket attack/damage/ac/save/skill model). It cannot express "Dex-based skills only",
  so it over-applies Clumsy/Enfeebled/Stupefied. Comparing it against the rules text also
  found two divergences that are *not* granularity: **Frightened and Sickened penalise damage**
  (the text says "checks and DCs"; a damage roll is neither), and **Off-Guard is described as
  a status penalty where the text says circumstance** — which changes what it stacks with.
  Reported, not fixed here. The end state is the bot delegating to this module, as
  `rules/pf2eMath.js` already does for arithmetic.

**Nothing consumes `conditions.ts` yet** — it is the vocabulary, not the wiring. The obvious
next consumers are the sheet (show held conditions and their net effect) and, eventually, the
bot. Slice 2+ is the systems the `unmodeled` tallies name: action economy, detection.

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

### `prose.ts` slice 1 landed 2026-07-17 — pipeline + the proficiency extractor

The parser is a candidate.ts **producer** (`source: "parser"`), sibling to `foundry.ts`. It
emits `DraftEffect` + `Gap[]` + an evidence span, NEVER a `PassiveEffect` — a guess is
structurally incapable of reaching a sheet, which is exactly what frees the parser to guess.
Pipeline: `normalize → segment (clause + governor) → extractors`.

- **Normalization built against the REAL markup, not assumptions.** A probe found the
  descriptions are already HTML/macro-free, but carry markdown structure (`**Effect**`
  headers, `---` rules, `\n\n`) and a tail of Foundry roll debris (`[[/act …]]`,
  `(@actor.system…)))` formula fragments). Structure → hard clause boundaries; debris →
  stripped (a stray `)))` mid-sentence otherwise splits a clause wrongly).
- **The governor gate IS the Lepidstadt regression.** Clauses are split on subordinating
  conjunctions (`when`/`if`/`while`/…), and the proficiency extractor DECLINES a governed
  clause: "you become an expert in Medicine" is a grant; "…increases by 10 when you are
  **legendary in Medicine**" is a condition, not a grant with a hole. Measured: a
  governor-blind parser emits 25 false grants across 23 feats; the gate removes all 25.
  Lepidstadt Surgeon (grant in clause 1, same skill as a condition in clause 3) is the
  locked regression test.
- **Extractors key on SEMANTIC PIECES, never sentence templates** (the probe's core
  finding). "gain the trained proficiency rank in Thievery", "are trained in Stealth",
  "become an expert in Medicine" are one effect in five costumes — one `rank + in + skill`
  pattern reads them all.
- **Foundry as a labeled test set — `scripts/prose-recall.mjs`** (committed, rerunnable,
  the parser's analogue of `remap-effects.mjs`). Runs both producers over the corpus,
  reconciles, reports recall/conflicts. Current: **73.1% recall vs Foundry's direct skill
  grants** (158 corroborated / 216), **0 conflicts, 42 parser-only, 58 missed**.
  Choice-driven grants ("a skill of your choice", 238 of them) are excluded from the
  denominator — a different shape, not slice 1's target.
- **A conflict caught a real parser bug during the slice.** "increase your proficiency
  **from trained to expert** in Diplomacy" (Pactbinder Dedication) grants EXPERT; the naive
  regex grabbed the first rank word (`trained`). Foundry disagreed → surfaced as a conflict
  → fixed (consume an optional `from <rank> to` prefix). This is the second producer paying
  for itself on day one, exactly as designed.
- **Spot-checked parser-only precision.** Most are genuine grants Foundry maps as a choice
  or drops — the parser's value (prose contains more). Two are honest false positives that
  point at slice-2 work, and both land safely as `parser-only` candidates a human resolves,
  never as content: **`require`** as a threshold word ("traps that *require* master in
  Thievery" — a capability, not a grant) and **subject detection** ("this *animal* is
  trained in Performance" — not the character). Neither is in slice 1's scope.

### `prose.ts` slice 2 landed 2026-07-17 — the modifier extractor + the gap machinery

"+2 circumstance bonus to X" is the biggest single shape (probe: 915 phrases across 792
feats). This slice is where the GAP machinery finally earns its place: the target — not the
value or type — is the hard part, and honest partial extraction is the whole architecture.

- **Value and bonus type are read, not guessed.** The type is stated in all but 36/915
  cases (circumstance 648 · status 201 · item 30); unstated → untyped. A "penalty" negates
  the value. Non-numeric values ("a bonus equal to your level") need a digit and fall
  through cleanly to a later slice.
- **The target resolves three ways, and this is the point:**
  - *resolved* → one draft per selector, after stripping possessives/`dc`/`roll`/`save`
    noise ("your Reflex save" → reflex) and FANNING broadcast classes ("all saving throws"
    → the three saves; "skill checks" → the 16 skills), the same fan-out Foundry does at
    ingest — which is what lets the two producers corroborate on "+1 to all saves".
  - *anaphoric* → a GAPPED draft: value + type filled, `target` absent, a `Gap{anaphoric}`
    quoting the phrase ("the check"). It enters the queue as a real work item and `promote`
    refuses it until a human fills the target. This is the ~24% the doc predicted, and it
    is the CORRECT output, not a failure — a guessed target is a bonus on the wrong stat.
  - *neither* (regex over-matched into prose) → skipped, not emitted as garbage.
- **Conditions are never dropped — the recurring hazard, handled in one rule.** A modifier
  is conditional when (a) its clause is governed ("while raging, +1 …"), (b) a trailing
  clause governs it ("+1 … while raging" — segmentation splits these, so a `trailingCondition`
  is threaded back onto the modifier clause), or (c) a SCOPE follows the target ("+1 to
  saves AGAINST magic", "+1 to Athletics checks TO Climb"). Each carries a
  `conditional-unmapped` gap. Case (c) was the single biggest precision hazard found by the
  probe: without it every "saves against X" fans to a BLANKET all-saves bonus. After the
  fix, 886 of 1042 modifier extractions are gapped (conditional or anaphoric) and only 156
  are clean-unconditional.
- **Foundry is a WEAK labeled set for modifiers, and that itself proves the pivot.** Its
  FlatModifiers are overwhelmingly predicated, so the mapper (correctly) reports them
  `needs-combat-tags` — only 26 modifier effects survive to `feat.effects`. The parser finds
  1042. Prose contains vastly more than the rule elements here; the recall number
  (corroborated / Foundry's 26) is not meaningful for this family and is reported per-kind
  so it does not blend with proficiency's honest 73%.
### `prose.ts` slice 3 landed 2026-07-17 — compound targets

The slice-2 residual (compound targets) turned out to be 176 phrases, worth handling. "+1 to
Intimidation, Perception, and Survival" / "saves and AC against spells" now fan into one
draft per stat. The change was contained: broaden the target capture to keep internal
`,`/`and`/`or`, split on those (Oxford comma included), and resolve each element through the
existing single-target resolver. A fragment that resolves to neither a stat nor an anaphor
(the run over-captured into a following clause — "Reflex saves and is Off-Guard") is dropped,
so the resolvable half still lands and the junk half does not. A shared trailing scope
("against spells") conditions EVERY element, so a compound never becomes a blanket bonus.
Verified on the real feats: Avowed Insight → AC + 3 saves, Avenge in Glory → attack + damage,
Web Walker → 3 saves + AC all conditional. Proficiency recall unchanged (73.1%, 0 conflicts);
modifier drafts 1042 → 1270.

- **Deliberately still not chased (broadly effective, not exhaustive):** weapon-scoped
  targets ("damage with weapons and unarmed attacks"), Lore skills, and DC-vs-check nuance.
  These drop to review rather than mis-resolving — the right place for a long tail.

**Next prose slices:** `require`/subject governors (the two slice-1 false positives — "traps
that require master in Thievery"; "this animal is trained in …"); then the review UI over the
reconciled candidates. The review UI's spec is already measured — 12 gap/effect shapes cover
89% of what needs a human — and it will reveal which recurring gaps deserve a parser rule vs a
one-time confirm. Build it on the merged "Gilded Observatory" theme (the `admin` surface +
`CornerBrackets`/`GildedRule`/`panel` primitives), extending `EffectCoveragePage`.

### Parser shape expansion driven by the review UI (2026-07-17)

The review UI immediately paid for itself: browsing it surfaced parser gaps, each fixed as
a shape. All in `prose.ts` + `candidate.ts`, measured by `prose-recall.mjs`.

- **Compound proficiency grants** — the ancestry-Lore feats grant TWO skills ("trained in
  Crafting AND Survival"); single-word capture silently dropped the second (52 feats). The
  skill capture became a CHAIN over the 16 skill names joined by "and"/comma — so it stops at
  the first non-skill word, keeping "your choice of Arcana, Nature, …" (the CHOICE shape, a
  later slice) from fanning a pick-one into four grants. "or" is not a conjunction either.
  Proficiency recall 73.1% → **96.3%**.
- **Grant extractor (senses + speeds, then resistances/weaknesses/immunities)** — grants were
  the biggest corroboration gap vs Foundry (86 foundry-only). SPEED reads every "results in
  speed N" phrasing to one `grant:speed` (Foundry's `BaseSpeed`): "Speed of N", "increases to
  N", "increases from X to N" (value after the final "to" — the from→to trap again), "Your
  Speed is N", "a N-foot swim Speed". "increases BY N" is a different (additive, usually
  conditional) effect, left to the governor gate — matching Foundry leaving it unmapped.
  RESISTANCE/WEAKNESS match Foundry's value AST exactly: `floor(level/2)`, or `max(1,
  floor(level/2))` **only when the prose says "(minimum 1)"** — FOLLOW THE PROSE (owner):
  feats that omit it are never 1st-level, so half-your-level is never 0 when taken, and
  applying min-1 anyway would disagree with Foundry's bare-floor encoding on 18 feats. The 7
  where Foundry *added* min-1 the prose omits surface as (legitimate) conflicts. Grant recall
  0 → **77%**; the parser also finds 177 grants Foundry never mapped (prose contains more).
- **`effectKey` granularity fix (candidate.ts)** — a grant's key was `grant:${type}`, ignoring
  WHAT is granted, so a feat granting fire AND sonic resistance collapsed into one bucket and
  reconcile reported a false conflict for two producers that AGREED. The key now carries the
  sub-target (`grant:resistance:fire`, `grant:sense:scent`, `grant:immunity:poison`,
  `grant:speed:swim`). This split multi-grant feats into per-grant candidates and turned
  ~4 false conflicts into corroborations. `effectSignature` stays coarse (the bulk-review shape).
- **A conflict caught a real Foundry data gap**: Sensitive Nose's prose says "imprecise scent",
  Foundry dropped the acuity its four sibling scent-feats carry — the parser being MORE correct
  than the rule element, surfaced for a human. The second producer earning its keep, by design.

Auto-promote (corroborated + complete, clears with no human): **163 → 287** across these.

### Choice candidates — a SECOND content type in the pipeline (slice A, 2026-07-17)

Choices ("a skill of your choice") are not `PassiveEffect`s — Foundry stores them in
`feat.choices` as `EffectChoice` (flag/prompt/options[], each option carrying its own
`effects[]`). So the whole `DraftEffect → reconcile → promote → PassiveEffect` pipeline had
to learn a second promotable content type. Owner-sequenced core+script first (this), web
rendering as slice B. Skill-proficiency choices only for now (save/ternary-rank and paired
choices deferred).

- **`candidate.ts` carries choices.** `DraftEffect.kind` widened to include `"choice"` +
  a `choice` payload; `promote` validates it against `effectChoiceSchema` (the same
  schema-is-the-completeness-check rule) and returns it on a `choice` field; `resolveEntity`
  routes it into a new `choices` output beside `effects`; `EffectDecision` gained a `choice`.
- **THE KEY INSIGHT — choices reconcile on MEANING, not cosmetics.** The parser cannot know
  Foundry's `flag` ("elementalLore"), so `effectKey` keys a choice on its OPTION SET
  (`choice:arcana|nature`) and `sameDraft` compares only (option value → its effects),
  ignoring flag/prompt/labels. Without this every choice would be a false conflict on the
  flag; with it, Skill Training (16 options) and Elemental Lore (arcana/nature) corroborate.
- **`choiceExtractor`** reads "a skill of your choice" (→ all 16), "your choice of X, Y, or Z"
  (explicit list), and "either X or Y" — the last also catching the CHOICE half of a mixed
  "your choice of Survival and either Arcana or Nature" (Elemental Lore) so the definite skill
  is never swept in. Declines the SUBSTITUTION fallback ("you *instead* become trained in a
  skill of your choice") — a conditional replacement, not a primary choice; the governor gate
  catches its "If you would…" cousins, the `instead` marker catches the ungoverned "For each…".
- **Measured:** choice recall vs Foundry **43.3%** (13 corroborated, 34 parser-only finds Foundry
  never mapped, **0 conflicts**). Auto-promote **287 → 300**.
- **Slice B (web) landed 2026-07-17.** `EffectReviewPage` renders a choice candidate as its
  option list — "Pick one · Skill: Arcana → trained, Nature → trained" — reusing `describeEffect`
  per option (with the redundant leading target trimmed, since the option label already names the
  skill). Accept routes `promote().choice` into `EffectDecision.choice`, so a choice reaches the
  right `resolveEntity` output. 64 choice candidates now review cleanly alongside the effects.

### Authoring UI (stage 3) slice 1 landed 2026-07-17 — passives + choices

**Why now, and why it's the ANSWER to granted actions** (owner call): granted-action feats
(a huge chunk of class feats) can't be auto-ingested — Foundry's rule elements don't encode
the activity and prose→automation is not a tractable parse — so they must be AUTHORED. The
engine can already REPRESENT them (Layer 2 `target`→`applyEffect`→`linkGroup`, the Grapple
two-actor pair is a locked test), and nothing cross-creature is the blocker; the missing piece
is the authoring surface. The owner also wants the editor as a DIAGNOSTIC: try to build real
feats, watch what fails, and learn where the data structure needs expanding.

- **Content slot added** (`effectBearingShape.actions?: GrantedAction[]`, foundry.ts) — the
  first "expand the data structure" step, so a feat can carry a granted action. Additive,
  optional, zero migration. The automation-tree editor that fills it is slice 2.
- **`EffectAuthorPage` (`admin/effect-author`)** — the homebrew editor, gated + lazy like its
  siblings. SCHEMA-DRIVEN, AND THE SCHEMA IS THE DIAGNOSTIC: every form emits a draft validated
  live against `passiveEffectSchema`/`effectChoiceSchema` — the same schema the sheet reads — so
  "this feat can't be built" surfaces as a red validation row or a missing field, exactly the
  gap-hunt the owner wants. Slice 1 covers the five Layer-1 passive kinds + skill-proficiency
  choices. A value editor offers the level-scaled idioms (flat / half-level / half-level-min-1 /
  your level) that map to the exact expr AST Foundry uses, plus an "advanced expression" read-out
  for anything it doesn't recognize. Loads an existing feat's effects to edit (the same surface
  the review UI's deferred "edit" action will embed), or authors blank. Output is authored-content
  JSON (file sink, like decisions), folded into the entity later.
- **Verified**: every form output validates against the real schemas (all five kinds, the
  resistance min-1 idiom, a skill choice), a real feat's effects round-trip, web typecheck + lint
  + build clean. **Slice 2** is the automation-tree editor (the node vocabulary as a nestable
  tree) — where granted actions and cross-creature `applyEffect` get built.

**Slice 2 landed 2026-07-17 — the automation-tree editor.** A RECURSIVE node editor over the
Layer-2 vocabulary (`features/authoring/AutomationEditor.tsx`), added as a "Granted actions"
section on the page. Slice-1 fields were extracted to `features/authoring/fields.tsx` so the
`applyEffect` EffectTemplate reuses the SAME passive forms — one implementation.
- **Recursion**: nodes nest through `children` (target), `onTrue`/`onFalse` (branch), and the
  per-degree lists (save/attack/check → onCriticalSuccess/…); `ChildList` renders `AutomationTree`
  again, so the tree is arbitrarily deep. Each node is validated live against `automationNodeSchema`
  (red when invalid), the whole action against `grantedActionSchema`.
- **Expressions are the core grammar, not a text blob**: `ExprField` runs the input through
  `parseExpr` — a bad formula is a red field with the parser's message, a good one becomes the AST.
  DCs edit as flat-expr or "10 + a creature's stat" (`{who, selector}`), which is what expresses a
  Trip's *check vs the target's Reflex*.
- **Cross-creature is buildable and PROVEN**: an authored `target → check(vs target's stat) →
  onFailure: applyEffect(on target) / onCriticalFailure: damage` validates against
  `grantedActionSchema` (verified). The `applyEffect` EffectTemplate editor covers name + duration
  (all six kinds incl. "until end of your next turn") + Layer-1 passives; `linkGroup` is an input,
  so the Grapple two-actor pair is authorable.
- **Deliberately deferred** (shown as "not yet"): spell `heightened`, an applyEffect's nested
  buttons/granted actions, and `capture`. Nothing consumes `runAutomation` in `apps/` yet —
  runtime execution stays a separate, later track. **The editor is now the tool to find data-model
  gaps by trying to build real class feats.**

**Gaps the editor surfaced, closed 2026-07-17** (owner, from using it):
- **VARIABLE MODIFIERS now resolve on the sheet.** A value like `strengthMod + 2` always parsed
  and evaluated (it's in `characterNamespace`, and `applyPassiveEffects` uses the full scope), but
  the SHEET's collect path (`collectPassiveSheetEffects`/`collectTraits`) only exposed `{level}`,
  so a `strengthMod` modifier threw → was skipped. `EffectContext` gained an optional `abilityMods`,
  and the collect scope now carries the six ability mods under the `characterNamespace` names.
  Deliberately ONLY ability mods + level — at collect (pre-derivation) time those base inputs exist,
  but derived stats (proficiencyBonus, a skill total) do not, and a value referencing one would be
  circular. The web builder passes `abilityModsFor(state)` (computed from the same `computeAbilityScores`).
  The authoring value editor gained an **"an expression…"** mode (a `parseExpr` field) so these are
  authorable, alongside the flat/half-level idioms.
- **BROADCAST authoring convenience.** The model stays per-stat (broadcast selectors are fanned out
  at ingest), but the editor's modifier target offers "all saves"/"all skills", which fan the one
  effect into one-per-stat (copying its type/value) on select — so "+1 to all saves" is one action,
  three stored effects.
- **Conditional authoring — the vocabulary exists, no PRODUCER does (2026-07-18).** Creature tags
  landed (decision 3, partially resolved) and the sheet now *displays* conditional modifiers as
  **Situational** instead of discarding them: `collectPassiveSheetEffects` returns them in
  `SheetEffects.conditional` with `describePredicate` prose ("+1 status to Will · vs undead"),
  never folded into a total. But **no producer emits a `when` today** — measured on the current
  corpus, 0 of 6,116 feats carry one, because `foundry.ts` reports every conditional element as
  `needs-combat-tags` and the authoring UI has no `when` control. So the Situational section is
  correct, wiring-tested, and **dormant**. Two ways to switch it on, either sufficient:
  1. **Map Foundry predicates** when *every* leaf is expressible in our vocabulary (keep
     reporting `needs-combat-tags` otherwise). Ceiling ≈171 elements — `target:trait` 112,
     `origin:trait` 21, `self:trait` 38 — realistically fewer, since many predicates mix an
     expressible leaf with a numeric or `action:` one.
  2. **A `when` control in the effect editor**, which makes homebrew conditionals authorable
     immediately and doesn't depend on Foundry's encoding at all.

  **Option 2 landed 2026-07-18 — the first producer.** `PredicateField` (features/authoring/
  fields.tsx) builds a `when` from a FLAT list of trait terms: scope (`opponent` / `target` /
  `origin` / `self`) × trait × a per-term `not`, joined by all/any, with a live
  `describePredicate` preview so the author reads the same prose the player will. Offered on
  `modifier`/`grant`/`rollAdjust`/`note` and **not** `proficiency` — which has no `when` in the
  schema, because a raised rank is permanent, not momentary. Trait suggestions are a datalist
  derived from the 52 traits the Foundry corpus's own predicates use (free text still authors
  fine). Tested end-to-end: an authored condition reaches `SheetEffects.conditional` with the
  expected prose.

  **Effect traits in the editor (2026-07-18).** The condition scope list gained *"vs an effect
  with"* (`effect:trait:`), and the `applyEffect` template form gained a **traits** input —
  the read side, so an authored effect can declare itself a `death`/`emotion`/`fear` effect for
  such a condition to test. Suggestions come from the spell corpus's own 97-trait vocabulary,
  deliberately unfiltered: deciding which traits are "really" effect traits would be a rules
  judgement from memory, and noise in a filter-as-you-type list is the cheaper error.

  **DEFERRED — the full recursive predicate editor.** The flat builder cannot express nesting
  (`all: [A, any: [B, C]]`), which is a deliberate deviation from decision 5 ("expose the full
  node set"), taken because no such content exists yet. The cost is paid honestly rather than
  hidden: `readPredicate` returns `null` for any tree it cannot represent and the field renders
  it **read-only** instead of flattening it — flattening would corrupt the author's condition,
  the same failure class as mapping an effect by dropping a condition. Build the recursive
  editor (reusing `AutomationEditor`'s pattern) when nested predicates actually turn up —
  most likely alongside the condition/effect-trait tags, which will widen the leaf vocabulary
  past traits and make combinations worth writing.

### Review UI slice 1 landed 2026-07-17 — triage + accept/reject + export

The review queue, kicked off as the read-and-decide surface WITHOUT the inline editor.
Scope (owner-approved): render the reconciled candidates, let a human accept/reject them
into an exported `EffectDecision[]`, and DEFER the gap/conflict editor to the stage-3
authoring surface. Purely additive — zero change to shipped content; a decision here goes
to a downloaded JSON, folded into content by a LATER slice, never straight to a sheet.

- **`scripts/build-candidates.mjs` → `effect-candidates.json`** — the web analogue of
  `prose-recall.mjs`: where that MEASURES the two producers, this FREEZES the reconciled
  result. Runs `parseProse` + the feat's mapped `effects` through `reconcile` over the whole
  feats corpus and writes an ADMIN-ONLY sidecar (the flat `EffectCandidate[]` + the triage
  summary). It carries NO descriptions — the page reads those from `feats.json`, already
  bundled for the builder, so the sidecar stays ~1 MB. Foundry proposals include ALL kinds,
  not just the parser's proficiency/modifier: a foundry-only `grant` is a legitimate review
  item. **Measured now: 1,563 candidates → 163 auto-promote, 0 conflicts, 1,058 gapped, 342
  review, 0 invalid** (the modifier drafts grew the queue since candidate.ts's first count).
- **`EffectReviewPage` (`admin/effect-review`)** — lazy + admin-gated exactly like
  `effect-coverage`; its sidecar is its own chunk (789 kB / 71 kB gz), out of the player
  bundle. `triage`/`groupBySignature`/`promote` run CLIENT-SIDE from `@pathway/core`, so the
  bucketing policy stays in core, not re-implemented in the UI. Bucket tabs (review / gapped /
  conflicts / auto-promoted / invalid) → signature groups largest-first ("confirm this shape
  across 150 feats") → candidate rows with the described effect, agreement chip, gaps, and
  evidence (the parser's quoted span; Foundry's element index). Accept is enabled ONLY when
  `promote(c).ok` — so gapped/conflict candidates can be rejected but not accepted, which is
  the editor deferral made structural rather than a rule to remember. Bulk accept/reject per
  group. Decisions accumulate in state; Export downloads `effect-decisions.json`, Import
  resumes a session. Both diagnostics are now linked from the admin dashboard (`EffectEnginePanel`).
- **Verified**: web typecheck + lint + production build clean; the boundary grep still shows
  only `foundry.ts` (+ its test); and every one of the 342 `review` candidates promotes OK
  while all 1,058 gapped are correctly blocked, exercised over the real sidecar.

### The fold-in landed 2026-07-18 — decisions reach `feat.effects`

`remap-effects.mjs` now runs `resolveEntity(candidates, decisions)` for every feat and ships
what comes back. `resolveEntity` is the single path from proposal to content, so the parser's
output reaches a real sheet for the first time.

Three things had to be settled to make that safe, and each is worth remembering:

- **The producer feedback loop.** `build-candidates.mjs` read Foundry's proposals from
  `feat.effects` — which is now the pipeline's OWN output. A human's accepted edit would
  return next run as "Foundry proposed this", corroborate itself, and auto-promote on a
  second producer that never existed. It now re-maps the sidecar's quarantined `raw`
  instead. Same queue today (1,820 candidates, 300 auto, 14 conflicts); loop-proof
  tomorrow.
- **The Foundry baseline had to be grandfathered.** Auto-promotion requires corroboration,
  so 57 `foundry-only` effects that already shipped would simply have stopped —
  reverting working content because a second producer stayed quiet is data loss, not
  review. `scripts/grandfather-decisions.mjs` writes them as accepts carrying
  `by: "migration:foundry-baseline"` and a note saying they were NOT human-reviewed. It
  refuses to grandfather conflicts: those 14 would be silently ruling in Foundry's favour
  on 14 open rules questions, which is the coin-flip `promote()` exists to refuse. Owner's
  call (2026-07-18): grandfather the 57, let the 14 stop shipping until reviewed.
- **`multiplicity` — a real bug the fold-in exposed.** `reconcile` buckets by `effectKey`,
  which collapsed a producer proposing the same effect TWICE. Natural Skill, Officer's
  Education, and Skill Mastery each grant two identical "become trained in a skill of your
  choice" elements; folded as one candidate they silently became "choose one skill". An
  `EffectCandidate` now carries `multiplicity` (the MAX across producers, not the sum —
  two producers agreeing once is one instance corroborated) and `resolveEntity` emits that
  many. Content: 341 → 328 effects (the 14 conflicts, minus one restored by multiplicity),
  choices 33 → 33.

### Parser predicates landed 2026-07-18 — trait scopes stop being gaps

The parser emitted **no `when:` at all**, so every conditional became a
`conditional-unmapped` gap *even when the model could already express it*. `effect:trait:<t>`
had landed with predicate.ts and is exactly what "+1 to saves against death effects" needs;
nothing proposed one. **Gapped 1,058 → 965; review 448 → 541. 93 gaps closed, and shipped
content is byte-identical** — a closed gap moves a candidate from `gapped` to `review`
(promotable, needs a human), never to auto-promote, which requires corroboration.

**Two shapes, two vocabularies, and the split IS the safety argument:**

| shape | vocabulary | why |
|---|---|---|
| `against <X> effects` / `<X> spells` | wide (spells + feats) | the noun already ruled out a creature reading, so `linguistic effects` is safe though `linguistic` is never a spell trait |
| bare `against <X>` | spell traits only | measured, this shape contains BOTH `against poisons` (effect) and `against dragons` / `against humans` (creature types) |

Reading "against humans" as `effect:trait:human` would attach a bonus that can never fire —
silently wrong, and worse than the honest gap. Restricting the bare shape to traits that
appear on SPELLS admits the first group and excludes the second; verified against the corpus.

**The vocabulary is PASSED IN, not hardcoded** (`parseProse(raw, extractors, ctx)`). Traits
are game content, content does not live in core, and the caller already holds the corpus —
so `build-candidates.mjs` derives 230 effect / 97 spell traits from `spells.json` +
`feats.json` and they cannot drift. Both default to EMPTY, and empty reproduces the old
behavior exactly: a parser resolving against a stale built-in list would be worse than one
that admits it does not know the word. Plurals de-pluralize only by checking the SINGULAR
against the vocabulary ("diseases" → `disease`), never by a rule about English.

**The compound scopes followed the same day.** Of the ~340 remaining `against …`
conditions, only a minority were safely expressible, and measuring said which:

- **`effects with the <X> trait`** (13) — the prose names the concept outright, the least
  ambiguous shape in the corpus.
- **coordinated pairs** (30) — "against emotion and fear effects", "against poisons and
  diseases" → `{ any: [...] }`. Read as ANY, not ALL: the bonus applies to an emotion
  effect *and* to a fear effect, not only to one carrying both. **Both halves must
  resolve** — emitting only the resolvable half is a NARROWER condition than the prose
  states, so the bonus would silently fail to apply where the feat grants it.
- **`effects that would impose <condition>`** (15) — `effect:causes:<slug>`, whose
  vocabulary is core's own `CONDITION_SLUGS`: closed and owner-supplied, so this shape
  needs nothing from the caller.

**Gapped 965 → 910; review 541 → 596. Content byte-identical again.**

**Also fixed: 68 gaps were mislabelled.** "against the triggering attack", "against this
creature", "against the affliction" were filed as `conditional-unmapped`, which tells a
reviewer to go find a word we lack. They are ANAPHORIC — what is needed is the referent
from the surrounding text. `anaphoric` 110 → 181. No coverage change; the queue simply
now points reviewers at the right problem.

Still gapped and deliberately so: creature scopes ("against dragons") need
`opponent:trait:` plus a creature-trait vocabulary no dataset here carries, and "against
magic" / "against spells and other magical effects from the same tradition as yours" are
not single predicates at all.

**Next**: the gap/conflict editor on the stage-3 authoring surface — the 14 conflicts and
910 gapped candidates still have no UI that can resolve them, which remains the binding
constraint on coverage.

### Resolution backend landed 2026-07-18 — `resolution.ts`, the editor's core half

The gap/conflict editor's backend, built ahead of any UI so the frontend can be designed
against a settled API. `candidate.ts` decides what needs a human; `resolution.ts` is what the
human does about it, and it is the ONLY path from a gapped or conflicting candidate to a
decision — so `promote`'s refusals stay the last word everywhere else. Pure and
storage-agnostic like its sibling: decisions flow into the existing `effect-decisions.json`
and the fold-in consumes them unchanged. **Zero content change this slice.**

**The measurement reshaped the design, twice.** Taken before writing anything:

- **Every gap in the corpus is on one of two fields** — `when` (956) and `target` (110). So
  this is not a general draft editor; the general one is the stage-3 authoring surface, which
  already exists. `ResolutionPatch` is deliberately those two fields plus `unconditional`,
  NOT a `Partial<DraftEffect>`: a type admitting any field would turn the review queue into a
  second authoring surface, where an edit is no longer checkable against *which gap did this
  close?*
- **Bulk-by-signature does NOT carry over from review slice 1.** The `when` gaps have 504
  distinct raw phrasings; the top 20 cover 16.5% and 319 occur exactly once. No grouping of
  the QUESTION collapses this queue. What repeats is the ANSWER — many phrasings resolve to
  the same predicate — so the leverage is human multi-select (`applyBulk`), not automatic
  grouping. Assuming the slice-1 model would have built the wrong UI.

**The API**: `applyResolution` (patch + recompute gaps), `resolutionIssues` (field-addressed,
for a form), `resolveGaps` / `resolveConflict` (the gate into a decision), `conflictReadings`
(each reading + which producer proposed it), `applyBulk` / `patchResolves`,
`rejectCandidate` / `rejectReasonOf`, `parsePredicate`.

Four things it settled, each a trap for the next person:

- **The gap-clearing rule is MECHANICAL: a gap on field F clears when the patch supplies F.**
  Nothing inspects the value to judge whether the fill is a *good* answer — detecting "that's
  the wrong condition" requires implementing the rules, and inferring "that fill looks
  insufficient" is exactly the guessing the pipeline refuses. The schema still gets the last
  word in `promote`; rules correctness is the human's. Gaps on unsupplied fields SURVIVE, so a
  candidate gapped on both fields and patched with one stays unpromotable rather than
  half-resolving into content.
- **A decision is addressed by the ORIGINAL candidate key, never the patched one.** This was a
  real bug, caught by writing the end-to-end assertion rather than by a unit test. Filling a
  `target` changes the key (`modifier:?:circumstance` → `modifier:stealth:circumstance`), but
  next run the producers re-emit the GAPPED proposal under the OLD key — so keying by the
  patched draft sent all 110 target-gap decisions to `staleDecisions`: the human's answer
  silently dropped and the candidate back in the queue. **A `when` fill does not change the
  key, which is precisely why this hid.** Regression-tested, and verified over the real corpus
  at 0 stale.
- **`resolutionIssues` is empty ⇔ `promote().ok`, pinned by a test** and verified at 0
  mismatches across all 1,820 real candidates. A second completeness opinion would eventually
  disagree with the one that governs, and the editor would enable a save `promote` refuses.
- **Rejection carries a reason** (`not-a-passive` | `wrong-reading` | `out-of-scope` |
  `duplicate`), riding in the existing `note` so `EffectDecision` stays backward compatible.
  It exists for one measured distinction: **104 of the `when` gaps are DURATION text** ("until
  the start of your next turn") — a category error, since a Layer-1 passive has no duration.
  They are real content the parser reached from a passive's clause, belonging to Layer 2.
  Filing them as `wrong-reading` would tell a future reviewer the prose was misread; leaving
  them gapped leaves a reviewer trying to invent a predicate for a duration. `not-a-passive`
  says the true thing and makes the set queryable when Layer 2 authoring comes for them.

**`applyBulk` is partial by design, never forced.** A candidate the shared patch does not
complete is REFUSED with its issues, not approximated — forcing a shared fill onto a candidate
whose remaining gap it never addressed is how a bulk action produces wrong sheets at scale.
`patchResolves` predicts the split so the UI can say "34 of 50" *before* the action.

**Verified over the real sidecar**, not just fixtures: all 910 gapped candidates resolve, the
14 conflicts produce fully attributed readings, and the decisions round-trip through
`resolveEntity` with 0 stale. (Placeholder patches — the run exercised the machinery and
resolved nothing for real.) Core 662 → 704 tests; root typecheck clean; boundary grep
unchanged.

#### What this is NOT — and what the UI still needs

**It is gap-specific, not a first cut at the complete editor.** The complete one already
exists and is strictly more general: `EffectAuthorPage` authors any of the five passive kinds
plus choices and automation trees, from scratch. `resolution.ts` edits two fields on a draft a
producer already wrote. The two meet at their shared components — `PredicateField` is the
`when` control both need, and the schemas are the same.

**The deferred recursive predicate editor stays deferred, and now there is a number for it.**
Of the 956 `when` gaps only **15** show mixed and/or structure that the flat builder cannot
express, and **13** are numeric thresholds ("at least two hobgoblin allies") that are not
Layer-1 predicates at all — those are `branch` conditions in Layer 2, and belong in the
`not-a-passive` bucket alongside the durations. So the flat `PredicateField` covers the
overwhelming majority of the queue, and the recursive editor is still not worth building.
Its honesty cost is already paid: `readPredicate` returns `null` for a tree it cannot
represent and renders read-only rather than flattening.

**Remaining UI work** is therefore the review surface, not the effect editor: wiring
`PredicateField` and a target selector into `EffectReviewPage`'s rows, multi-select +
`applyBulk` with the `patchResolves` count, the conflict side-by-side over `conflictReadings`,
and a reject-with-reason control. The 14 conflicts and 910 gapped candidates remain unresolved
content-wise — this slice built the tool, and used it on nothing.

### Gap re-triage landed 2026-07-19 — `conditional-unmapped` was a bucket, not a diagnosis

**Zero content change.** `feats.json` and every other dataset are byte-identical; all 2,044
candidates keep their drafts, targets, values and evidence spans (verified field-by-field —
0 structural diffs). Only *gap reasons* and the `raw` quoted beside them moved. This slice
re-aims the review queue and makes the roadmap tallies true; it promotes nothing.

**The measurement.** `conditional-unmapped` held **965 of 1,017 gaps** and meant six
different things. A reviewer opening one could not tell "go find a word we lack" from "this
was never a condition in the first place". Split:

| before | after | |
|---|---|---|
| | 446 | `combat-state` — momentary state; blocked on the MODEL (decision 3), not vocabulary |
| 965 | 233 | `conditional-unmapped` — the honest residual: compound scopes we truly cannot state |
| | 138 | `purpose-scope` — "to Climb", "to Recall Knowledge"; needs an `action:` namespace |
| | 104 | `duration-not-condition` — "until the start of your next turn" is not a condition |
| | 44 | `unresolved-vocabulary` — a bare noun no trait vocabulary matched |

This is the `anaphoric` argument (which split 68 gaps out of the same bucket) generalized.
Each reason now routes to a *different fixer*: a model decision, a namespace, a dataset, or
nothing at all.

**THE GOVERNED-CLAUSE FINDING — the reason this was worth doing.** For a governed clause the
extractor builds the condition as `governor + THE WHOLE CLAUSE TEXT`, so the string handed to
`resolveTraitScope` reads *"as long as you have these temporary hit points, you gain a +1
circumstance bonus to AC"*. Every trait-scope pattern is `^against …$` anchored — **so a
governed clause could never resolve, no matter what vocabulary we added.** 217 of the 218
gaps that looked like parser over-capture, plus the whole combat-state bucket, were
structurally guaranteed rather than word-blocked. `isolateCondition` recovers the governing
phrase, and the reviewer now sees the condition instead of the entire sentence.

It is **deliberately not wired into `resolveTraitScope`.** Isolation could make a condition
newly resolvable, turning a gapped draft into a clean one — a content change, which belongs
in its own slice behind its own verification. Here it informs only the label.

**`creature-scope` was designed, built, and then rejected on the evidence.** "against
dragons" really does name a creature and really does need `opponent:trait:` plus a creature
vocabulary — but "against magic" is the *identical shape* and names no creature. A classifier
reading shape alone cannot tell them apart, so the reason would have confidently mislabeled
one of them. The observable fact is weaker and already had a name: `unresolved-vocabulary`.
Same discipline as the mapper's — report the blocker you can defend, not the one you suspect.

**`GrantItem` was three blockers wearing one key.** Of 620 on feats: ~313 name a static
entity, ~182 name an ACTION, and ~90 name no entity at all — their uuid is
`{item|flags.system.rulesSelections.…}`, an unresolved ChoiceSet reference. That last group's
blocker is the CHOICE, so it now reports `needs-runtime-choice`: `needs-granting` 414 → 345,
`needs-runtime-choice` 207 → 276. A balanced −69/+69 that stops overstating the
entity-modelling work and puts those elements in the tally that would justify building
choices.

**Two things this measured for the work after it.** (1) Core's `grantSchema` *already* has
`{ type: 'action', ref }`, and `grep '"action"' foundry.ts` returns nothing — the mapper never
emits the grant kind it already models, so ~182 action grants are reachable with no schema
change. (2) 283 distinct feats grant another feat (50 conditionally, 44 `allowDuplicate`).
Per the owner (2026-07-19) those land in a **`grants` field of their own, outside the
`PassiveEffect` union** — a feat granting a feat is a build-graph edge, not a number on a
sheet, and the builder must walk it (transitively) rather than the effects engine folding it.

### Entity grants landed 2026-07-19 — `grants.ts`, a feat that gives you a feat

**No content regenerated yet**, deliberately: `remap-effects.mjs` folds in the decisions
file, so running it would also ship the 343 human accepts the owner has explicitly
deferred. The mapper, schema and closure are in and tested; the content write is one
`node apps/web/scripts/remap-effects.mjs` away, to be run when the accepts are dealt with.
Verified by dry run: **206 feats yield 221 grants over 85 distinct targets, 0 dangling
refs**, and mapped elements rise 492 → 717 (+225).

**Its own field, NOT a `PassiveEffect`** (owner decision). Everything in `passive.ts`
answers "what number on the sheet does this change"; a feat granting a feat changes no
number, it changes *which content the character has*. It is a build-graph edge, so the
BUILDER walks it and the effects engine never sees it. Folding it into the union would
have made `applyPassiveEffects` collect something no sheet could apply.

**The mapper must CONFIRM the ref, and that rule came from being wrong.** The plan called
the 182 action grants "nearly free" because `grantSchema` already has
`{type:'action', ref}` — reasoning from the schema. Measured: **242/242 feat grants
resolve to entities we hold, but only 8/180 action grants do.** A mapper trusting the uuid
would have emitted 172 refs to content that does not exist, which is strictly worse than an
honest `unsupported`. So `knownFeatIds` is passed in (content, like `effectTraits`) and an
unconfirmed uuid stays unsupported. Coverage now tracks the dataset: land an actions
dataset and those 180 start resolving with no mapper change.

**Corpus shape** (why the closure is simple but still guarded): 242 edges over 217 feats,
24 granting more than one, exactly ONE chain (`gray-corsair-training`), **zero cycles**,
zero self-grants. `resolveGrantedFeats` is breadth-first with a global visited set anyway —
content is human-edited and re-ingested, so "no cycles today" is not a property to rely on.
A grant pointing at content we lack is reported in `unresolved` rather than dropped: that is
how a character quietly loses a feat with nothing saying so.

**Conditional grants (17 of 242) are deferred, not approximated.** Dropping the predicate
would hand out an unearned feat; honouring it needs the BUILDER to re-evaluate on every
build change (gain the prerequisite → gain the feat; retrain out → lose it again). That is a
lifecycle question, not a mapping one.

**`multiplicity` was designed, then deleted on one example.** Elemental Trade — the dwarf
heritage known as **Anvil Dwarf** — grants Specialty Crafting twice, and the two elements
differ only in `preselectChoices` (`stonemasonry` / `blacksmithing`). Per the owner the
player gains the FEAT once and alters its rules to pick two professions; Specialty Crafting
cannot otherwise be taken twice. A `multiplicity: 2` would have asserted the character holds
it twice — a wrong sheet. Note this is the OPPOSITE conclusion from
`EffectCandidate.multiplicity`, and correctly so: Natural Skill's duplication is two
instances of an EFFECT, this is two selections inside ONE feat.

**The other three doubled grants are a different case, and still dedupe.** Hellbreaker
Dedication → Additional Lore, Linguist Dedication → Multilingual, Terrain Scout → Terrain
Stalker — each granting a feat whose prose carries a `**Special**` clause saying it may be
taken more than once (Specialty Crafting has none, so **the discriminator is in the
content** and never has to be remembered). For those three a repeat arguably is two
acquisitions, so deduping under-grants them. Owner's call: a repeat only means something
once the player can pick a different Lore/language/terrain, and that selection is not
modelled — two indistinguishable copies is its own wrong sheet. Deduping errs toward a legal
character, duplicating toward an illegal one. Every discard is named in the report
(`produced: 0` plus a reason), so revisiting costs no re-derivation.

**Grants skip the fold-in**, unlike effects and choices: the decisions pipeline arbitrates
between two producers proposing effects, whereas a grant has ONE producer and a
deterministic uuid→id derivation with no gaps. If prose ever proposes grants ("you also gain
the X feat"), that stops being true and they should join the candidate pipeline as choices
did.

**Next**: the builder consuming `grants` — nothing reads the field yet.

### The action vocabulary landed 2026-07-20 — `actions.ts`, and the predicate gate came off

**`needs-combat-tags` 1,779 → 1,514. Mapped elements 717 → 921 (+204); effects 789 → 1,299.**
Shipped content rose 371 → 455 effects with **zero previously-shipping effects lost**.

**The premise this started from was wrong, and measuring it first is the whole lesson.**
`foundry.ts` carried a comment saying the conditional gate was scoped to
`AdjustDegreeOfSuccess` because widening it "moves a great deal of content at once, and is
its own measured change" — with `needs-combat-tags` at ~1,600 elements as the justification.
Replaying `mapPredicate` over all 1,779 blocked elements first: **only 97 had a predicate the
leaf mapper could already state.** The gate was almost never the wall; the leaf VOCABULARY
was. Sizing this work off that comment would have spent the effort for 97 elements.

**What the bucket actually contained**, once measured rather than tallied:
- **RollOption — 546 (31%), the largest single line item, and not this problem at all.** These
  PRODUCE a roll option; they are not gated by one. Filed here because the reason vocabulary
  is named after the blocker and they share the noun. They need a tag *production* model and
  are untouched by any of the below.
- **`action:*` — 199 elements where it is the sole blocker, 272 counting co-blockers.** The
  only large *coherent* family, and what this slice addressed.
- **A genuine long tail that looks like a roadmap until you read it.** A greedy
  set-cover ranked two synthetic buckets on top ("bare-non-trait" 346, "other" 173); both
  dissolved on inspection. `other` is per-class Foundry state machines (`kinetic-gate:earth`,
  `werecreature:wereshark`) at a max frequency of 5 — internal bookkeeping, not rules
  conditions. `bare-non-trait` is mostly feat slugs, and includes `alghollthu`, which is
  creature identity the owner has ruled is never automated. **Aggregate tallies pointed at the
  wrong work here; only reading the leaves corrected it.**

**`actions.ts` — 75 slugs, entirely from owner-supplied rules text** (AoN 2343 basic, AoN 2344
specialty, plus a compiled skill-action directory, since AoN does not carry those on one
page). It is a **TAG NAMESPACE, not a state machine**: core cannot know a character is
Escaping, and nothing on `ResolvedCharacter` says so. Whoever RUNS an action asserts the tag —
the bot's `/use`, or an Escape button on the Grabbed condition (the owner's framing, and the
thing that settled the design). A consumer that never asserts them, like the web sheet, simply
never fires those effects, which is correct rather than a gap.

**Sourcing caught two errors that would otherwise have shipped**: the directory's "Manuever in
Flight" typo (the corpus uses `maneuver-in-flight`; a slug that could never match), and
`action:trait:downtime`, which is a trait filter OVER actions, not an action name. **Stride is
deliberately absent** — the Basic Actions page references it but carries no entry, and no
corpus content asks for it, so adding it would be a rules claim invented to fix a
non-problem. There is a test asserting its absence so it reads as a decision.

**Lifting the gate alone would have been a REGRESSION, not a coverage win.** Only
`AdjustDegreeOfSuccess` attached its own `when`; every other mapper ignored the predicate
entirely. Widening the gate without attaching it centrally would have shipped every
conditional FlatModifier as a **permanent** bonus — the exact wrong-sheet bug this boundary
exists to prevent, and strictly worse than the refusal it replaced. `proficiency` is the one
kind that cannot carry a `when` (deliberately — a raised rank is permanent, and its schema is
`.strict()`), so conditional `ActiveEffectLike` elements are still REFUSED rather than granted
unconditionally.

**Faithful fan-out became noise the moment conditionals mapped.** Foundry's `skill-check`
selector means "any skill check" and we expand it to all 16 skills. Harmless while conditional
elements were refused; once they mapped, Sturdy Bindings ("a critical failure on a check to
Grapple") became 16 effects, one of which told the sheet that **Arcana** improves when
Grappling. Nothing is arithmetically wrong — `action:grapple` is never asserted beside an
Arcana roll — but 67 corpus elements did this, 1,072 effects saying what ~100 could, and a
sheet reading "Arcana: +1 when Grappling" is misleading. **Inert clutter is still a wrong
sheet.** So the action→skill map narrows fanned-out skill targets, with three guards, each
blocking a way this could silently lose a real effect:
- **negation disqualifies** — `not: action:grapple` means the OTHER 15 skills; narrowing to
  Athletics would invert it;
- **a non-skill action disqualifies** — Escape is basic and our source assigns it no skill;
  guessing Athletics would be a rules claim;
- **only fan-outs narrow** — a single explicitly-targeted skill is left alone even when it
  disagrees with the map, because that is a content question and dropping it would hide it.

Effects 1,462 → 1,299 with mapped elements unchanged.

**The review-queue delta is the system working, not damage.** Conflicts 48 → 187. All 139 new
ones were previously `parser-only`, **none had a human decision (so nothing stopped
shipping)**, and **100 of 139 differ ONLY by Foundry supplying a condition the parser
missed**. Charming Liar is the pattern: the prose says "when you get a critical success using
the **Lie** action" and the parser had proposed it unconditionally. Foundry now corroborates
the effect and contradicts its unconditionality — which is precisely what a conflict is for.

**Worth knowing: none of the 84 newly-shipped effects are action-gated.** All 84 come from the
gate lift (trait predicates like `effect:trait:visual`). The action vocabulary's contribution
sits entirely in the review queue, because it conflicts with parser proposals and ships only
once a human rules. **The action work's value is currently latent, gated on review** — the
coverage number moved, the shipped-content number moved for a different reason.

**Reconciling earlier numbers in this doc.** 265 elements left `needs-combat-tags`, but only
204 became mapped: the other **61 hit a DEEPER blocker** (`unsupported-shape` +41,
`unsupported-selector` +11, `unsupported-value` +7, `needs-runtime-choice` +2) and are now
reported against the real wall instead of hiding behind the predicate gate. Earlier
`needs-combat-tags` figures in this doc (1,606 post-slice-A; 968 in the first-goal table) are
dated snapshots on different scopings and were not rewritten.

**Next**: `RollOption` (546) is now the largest blocker in this bucket by a wide margin and
needs a tag-PRODUCTION model — its own slice, with tag lifetime and scope to settle. The 18
remaining uncovered action slugs are feat-granted actions (Battle Medicine, Scare to Death)
and creature abilities (`swallow-whole`), defined by feats we already ingest. And the `.docx`
of skill-action degrees of success is the raw material for replacing the hand-authored
`authoredActions.js` catalog with rules-sourced ones — deliberately NOT pulled into this
slice, which needed only the slugs.

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

   **RESOLVED 2026-07-18 (all three capabilities) — creature tags landed first.** `predicate.ts` now carries a
   second producer, `rollTags(ctx)`, for the *opposed* context of a roll, in three
   namespaces: `target:trait:<t>` (the creature you roll against), `origin:trait:<t>` (the
   creature behind an incoming effect), and `opponent:trait:<t>` — **either of the above**.
   `rollTags` emits the precise namespace *and* the union for every creature present.

   *Why the union.* Rules prose says "against undead" and almost never states the direction,
   because the direction is already fixed by **which stat the effect targets** — a `when` on
   `will` is inherently incoming, one on `attack` inherently outgoing. So the selector carries
   direction and the predicate only answers "who is the other creature". Authors write
   `opponent:`; `target:`/`origin:` remain for content that genuinely cares, and are what the
   Foundry corpus encodes (it separates the two), so ingest can map without reinterpreting.

   **RESOLVED 2026-07-18 — effect traits.** `EffectTemplate.traits` (automation.ts) landed,
   optional and additive, and `rollTags` reads it into `effect:trait:<t>` — so "+1 to saves
   against death effects" is representable end to end. `AppliedEffect` inherits the field for
   free (its schema spreads the template's shape), so a runtime host can read an incoming
   effect's traits without further model work.

   *One namespace, not a directional pair.* `effect:` gets no `opponent:`-style union because
   an effect is not a creature, and no incoming/outgoing split because the **selector already
   carries direction** (a `when` on `will` is inherently about an incoming effect). If an
   outgoing shape ever needs it ("+1 to spell attack rolls with fire spells"), `effect:` widens
   to "the effect at issue" and the producer supplies whichever that is — no new namespace, no
   migration. Not modelled now because no such content is in hand.

   **FULLY RESOLVED 2026-07-18 — caused conditions.** `EffectTemplate.conditions`
   (`HeldCondition[]`, validated against the closed 41-slug vocabulary) is read by
   `effect:causes:<c>`, so *"+2 circumstance to saves against effects that would make you
   enfeebled"* is representable end to end. All three of the owner's conditional
   capabilities are now built.

   *Declarative, not an automation node* — the same constraint `traits` has, and the
   reason it is a field rather than an `applyCondition` node: the predicate says "**would**
   give you", and the save is rolled BEFORE the effect resolves, so the tag must be
   readable at rest without executing the tree. The declaration is a claim about what the
   effect does, not the mechanism that applies it; keeping them apart is what lets a save
   be modified by an effect that never lands.

   *The value is accepted but not in the tag.* "Enfeebled 2 or more" is a numeric
   threshold and the tag model is membership-only (see the top of this decision); numeric
   comparisons belong to Layer 2's `branch`.

   Because conditions are a CLOSED vocabulary (unlike traits, which are free text), the
   editor offers a real dropdown and the schema rejects a typo — a misspelled condition is
   a parse error rather than a predicate that silently never matches.

   **Still deferred:** momentary combat state (flanking, off-guard, stances) — still
   unproduced; `rollTags` passes host `extra` tags through verbatim as the seam for it.

   A `when` control in the effect editor is the producer — see "Conditional authoring" below.
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
