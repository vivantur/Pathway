# Action feats — session handoff

**Status: PLANNING ONLY. Nothing here is built.** This doc points a fresh session at the
action-feats surface: what it is, what already exists to build on, the decisions already made,
the sequence, and the traps. Read `docs/effects-engine-design.md` (the plan of record) for the
effects engine as a whole; this doc is the action-feats slice specifically.

---

## The problem in one paragraph

A large bucket of PF2e feats (~1,850 in the review queue, classified `action-feat`) grant or
modify an *activity* rather than change a passive number. They currently reach the review queue
as passives (a misread) or as "silent" (no producer signal). They need a real home: some are
runnable activities the character gains (Layer-2 automation), some are riders on an existing
action (chiefly a Strike), and a meaningful slice are *not actions at all* — they are passives
that were misfiled. Sorting those three apart is the first job.

## The two categories (the most important distinction — get this right first)

A feat that "modifies a Strike" is one of two things. Conflating them will bloat the work.

1. **Always-on conditional → a Layer-1 PASSIVE. Not an action.**
   "When you Strike with a weapon you're trained in, deal +1 damage." This auto-applies; the
   player types nothing. It is a `PassiveEffect` with a **scoped selector** (`damage:strike`,
   `attack:strike:melee`, …) and a `when` predicate. The scoped-selector vocabulary already
   exists (`packages/core/src/selectors.ts`). **A real fraction of the "action feats read as
   passives" queue is CORRECTLY passive** — accept those as passives; they need no action.

2. **Opt-in activity → a granted ACTION (Layer-2), possibly a Strike rider.**
   Intimidating Strike (1 action), Power Attack (2 actions). It **costs an action** and is
   chosen *instead of* a plain Strike. This is the granted-action work, and where the
   snippet/rider idea lives (below).

**First task of the pass: trichotomy per feat** — (a) keep-as-passive, (b) bespoke activity,
(c) Strike rider. Do not build authoring UI before you can classify, because the classification
tells you how much authoring you actually need.

## What already exists (build ON this, do not rebuild)

- **The decision model already supports "reject the passive, add an action."** They are two
  independent decisions on one feat:
  - reject the misread passive candidate → it stops shipping;
  - `addGrantedAction(entityId, draft)` in `packages/core/src/resolution.ts` → records an
    authored activity under key `added:action:<id>`. There is deliberately **no**
    `acceptGrantedAction` — nothing proposes an activity, so an authored action is always an
    ADDITION. Re-authoring upserts the same row (keyed on the action id), so editing and saving
    again replaces rather than duplicates.
- **`GrantedAction` is the schema** (`packages/core/src/automation.ts`, `grantedActionSchema`):
  `{ id, name, actionCost?, description?, automation?: AutomationNode[] }`. An action can be
  granted BEFORE its tree is authored — the sheet shows it with "run it at the table."
- **The Layer-2 interpreter is complete and pure** — `runAutomation(tree, ctx)` over a seeded
  RNG. Node vocabulary (damage, checks, degree, dice, counter, applied effects, branch) is
  built and tested. This is what a granted action's `automation` is.
- **The strike model is built** (`packages/core/src/strike.ts`):
  - `resolveStrike(actor, input) → Strike` (full breakdown) — **consumed by the web sheet**
    (`apps/web/src/features/builder/rules.ts`) for the Attacks display.
  - `strikeAutomation(strike, map?) → AutomationNode[]` — turns a strike into a Layer-2 tree.
    **Consumed by NOTHING yet.**
  - `collectStrikeModifiers` / `ScopedModifier` — the scoped attack/damage modifier plumbing.
- **The bot can already run a Layer-2 tree end to end**: `/use` →
  `apps/bot/src/rules/automation.js` (`buildContext`, pure) + `apps/bot/src/state/automation.js`
  (seeds, writes mutations back) + combat targeting through the tracker's `applyHp`. Damage,
  temp HP, conditions, counters all land. This is the host a granted action runs in.
- **`apps/bot/src/rules/authoredActions.js` is a TEMPORARY hand-authored catalog** in
  `GrantedAction` shape, so `/use` has something to run. It makes no rules claims and is meant
  to be DELETED once real content carries trees. Do not build on it; it is the demo, not the
  design.
- **The web has a read-only window already**: `GrantedActions.tsx` (Feats tab) renders a
  character's granted actions and, in dev, previews a run. `grantedActionsFor(state)` in web
  `rules.ts` collects them from the dataset. Nothing writes them yet — that is the authoring UI
  you will build.

## What does NOT exist yet (the gaps to fill, in order)

1. **The content.** Most action-feat mechanics live on a **separate Foundry Effect item**, not
   the feat — the same reason stances came in bare (see the stance note in the design doc). The
   ingest walks `packs/pf2e/feats/` only. So a prerequisite is **ingesting the effects pack and
   LINKING each Effect to the feat that grants it** — the link is often name-matching or a
   `@UUID` in the action's prose, because the feat carries no `GrantItem`. This needs the
   Foundry clone (`ingest-pf2e.mjs --src <clone>`); `remap-effects.mjs` cannot help because the
   effect-pack raw was never captured in the sidecar. **This is itself a real slice.**
2. **The action-authoring UI.** A builder that writes through `addGrantedAction` (and edits/
   re-authors). The backend door exists; the surface does not. Rules-from-source applies: an
   authored action's mechanics come from rules TEXT, never model memory.
3. **A player-facing strike-run path.** There is no "I, the player, Strike through the engine"
   command in the bot — only monster attacks (`mattack`/`monsterattack`). `strikeAutomation`
   exists but no host runs it. A Strike rider (category b/c) attaches to a strike run, so that
   run must exist first.

## The snippet / rider idea (Avrae-style) — direction, deliberately sequenced LAST

Owner's framing: for a "modify a Strike" activity (Intimidating Strike), the player should
Strike normally and **tack on a keyword** — not invoke a wholly bespoke action. This is exactly
Avrae's snippet/attack-argument shape.

**It fits the architecture:** a snippet is a small Layer-2 **fragment** (an extra damage die, a
degree-of-success rider, an applied condition) **composed onto a base Strike's tree** at
invocation. `strikeAutomation` already produces the base tree; the node vocabulary already has
the rider pieces. So this is compositional automation, with the grain of the engine.

**It is the composition LAYER of the granted-action pass, not a separate feature.** A rider is
"author the strike-modifier as a composable fragment instead of a bespoke tree."

**Sequence it last, on purpose:**
1. build the player strike-run path,
2. do the granted-action pass for genuinely bespoke activities (and accept the category-(a)
   passives),
3. add snippet composition once enough real riders exist to show the shared shape.

Building the composition model *first* means designing against imagined content. That is the
"seam before the consumer" trap the toggle work hit twice (dead derivation wiring; the bot tags
seam). **Design toward snippets from day one so the authoring surface doesn't foreclose them —
but build the composition third.**

Open design questions for snippets (answer with real riders in hand, not up front): how a rider
merges into a base tree; the keyword vocabulary; whether riders stack; how MAP and the rider's
own action cost interact.

## Suggested order of work

1. **Trichotomy pass** (no new engine): go through the `action-feat` queue and classify each as
   keep-passive / bespoke-activity / strike-rider. This scopes everything else and immediately
   clears the category-(a) passives.
2. **Effects-pack ingest + linking** (needs the Foundry clone): gets real mechanics onto the
   feats instead of hand-authoring from scratch.
3. **Action-authoring UI** writing through `addGrantedAction`.
4. **Player strike-run path** in the bot.
5. **Snippet/rider composition** as the efficiency layer.

## Non-negotiables to carry in

- **Rules-from-source** (CLAUDE.md): implement PF2e rules only from provided rules text, never
  from model memory. Authored actions are rules claims.
- **One implementation in `packages/core`**: no rules math in `apps/web` or `apps/bot`. The bot
  is un-frozen to CONSUME core, not to grow its own rules.
- **Foundry is feedstock, mapped at ingest** — `foundry.ts` is the only module that knows its
  shape. Effect items come through that same door.
- **DB schema is a separate no-touch plan** — one Supabase project serves the live bot; a
  migration needs its own plan. Code on `test` is safe; schema is not.
- **Verify against the code, including the docs** — every status has been wrong at least once.

## Key files

| what | where |
|---|---|
| Granted-action decision door | `packages/core/src/resolution.ts` (`addGrantedAction`, `addEffect`) |
| GrantedAction schema + interpreter | `packages/core/src/automation.ts` (`grantedActionSchema`, `runAutomation`, `ExecutionContext`) |
| Strike model | `packages/core/src/strike.ts` (`resolveStrike`, `strikeAutomation`, `collectStrikeModifiers`) |
| Scoped selectors | `packages/core/src/selectors.ts` (`attack:strike`, `damage:strike:*`) |
| Silent-corpus classification | `packages/core/src/candidate.ts` (`action-feat` bucket) |
| Bot automation host | `apps/bot/src/rules/automation.js`, `apps/bot/src/state/automation.js` |
| Bot `/use` | `apps/bot/src/commands/use/` |
| Temporary demo catalog (delete later) | `apps/bot/src/rules/authoredActions.js` |
| Web granted-action read surface | `apps/web/src/features/characters/sheet/GrantedActions.tsx`, web `rules.ts` (`grantedActionsFor`) |
| Foundry ingest (needs clone) | `apps/web/scripts/ingest-pf2e.mjs` |
| Re-map without clone | `apps/web/scripts/remap-effects.mjs` |
