# Pathway

Pathfinder 2nd Edition companion: a Discord bot plus a web app, in the spirit of
D&D Beyond (content + character management) and Avrae (Discord play). Current
scope is a friend group; architecture should not foreclose growing into a product.

## Architecture — the one rule that matters most

There is exactly ONE implementation of the PF2e domain. It lives in `packages/core`.
The bot and the web app both consume it. Never compute a rules value (a bonus, a DC,
a derived stat) in `apps/web` or `apps/bot`. If logic is duplicated, it has gone wrong.

> Why this rule exists: duplicated rules logic has already caused real bugs here —
> the dying/recovery math existed in three places and drifted; the bot and web
> computed proficiency separately and disagreed. `packages/core` structurally ends
> that class of bug.

## Layout

The repo is an **npm-workspaces monorepo** (root `package.json` → `workspaces`):

```
packages/
  core/   ← pure PF2e domain: content schema + character model + derived-stat
            engine. NO I/O, NO database, NO network. Trivially unit-testable
            (Vitest). The heart of the project.
  db/     ← Supabase client, generated DB types, queries. Depends on core;
            validation happens here at the edges using core's Zod schemas.
            BUILT but NOT YET WIRED — nothing outside it imports it (see status).
apps/
  web/    ← the Vite + React + React Router + React Query web app (was web/).
            Depends on core + db (once wired). Keep Vite — do NOT rebuild on Next.js.
  bot/    ← the discord.js bot (was Pathwayv2/). CommonJS JS, no build step.
```

**Branches:** work happens on `test`; `main` is what deploys (the web app auto-deploys
from it on Vercel). Promote `test` → `main` deliberately, not by habit.

### Status of the migration

*(Last reconciled against the code on 2026-07-17. If you change this, re-verify —
this section has been wrong before, and a stale status is worse than none.)*

- ✅ **Structure** — monorepo layout + npm workspaces in place; `apps/bot` and
  `apps/web` moved.
- ✅ **Core packaging** (2026-07-09) — core builds to `dist/` and both consumers are
  proven against it: the web app typechecks/builds against `dist`, and a CommonJS
  `require('@pathway/core')` returns working rules math. ESM was never the obstacle
  (Node ≥22.12 `require(esm)` works); shipping raw `.ts` was.
- ✅ **Build core** — no longer three slices; **31 modules, 786 tests**. Roughly:
  - *scalar rules* — `stats.ts`, `proficiency.ts`, `derived.ts`, `companion.ts`
  - *content schemas* (Zod) — `content.ts` envelope + `spell` `ancestry` `background`
    `feat`
  - *character model* — `character.ts` (`ResolvedCharacter`, the engine's read
    surface) + `selectors.ts` (the canonical selector vocabulary) + `pathbuilder.ts`
    (the Pathbuilder boundary: the STORAGE format's types + the readers that reach
    `ResolvedCharacter`; it is what lets a bot character feed the effects engine)
  - *effects Layer 1* — `expr.ts` (sandboxed value AST, no `eval`), `predicate.ts`,
    `passive.ts` (`PassiveEffect` + apply/collect/traits)
  - *effects Layer 2* — `automation.ts`, `checks.ts`, `degree.ts`, `damage.ts`,
    `dice.ts`, `rng.ts`, `counter.ts`, `applied.ts`, `heightening.ts`
  - *ingest* — `foundry.ts` (the Foundry boundary), `candidate.ts` (the parser-pivot
    review model) + `resolution.ts` (the gap/conflict editor's backend — the ONLY
    path from a gapped or conflicting candidate to a decision)

  See `docs/effects-engine-design.md` — that doc is the effects engine's plan of
  record and is current. Read it before touching effects.
- 🔶 **Point web at core** — the *scalars* are consolidated and the second sheet
  engine is gone: `deriveCharacter` (`features/builder/rules.ts`) is now THE engine,
  and the character sheet consumes it (`sheet/sheetStats.ts`) rather than
  recomputing. 16 web files import `@pathway/core`. **What's left:** the
  *orchestration* — which ranks/abilities feed which stat — still lives in
  `deriveCharacter` rather than core, and `features/characters/pathbuilder.ts` keeps
  a parallel path for characters IMPORTED from Pathbuilder (no `_pathwayBuild`),
  where Pathbuilder's own numbers are authoritative and recomputing risks
  disagreeing with it. That fallback is deliberate; the orchestration is not.
- 🔶 **Migrate bot** — **the packaging blocker is gone.** `apps/bot` declares
  `@pathway/core: "*"`, imports it, and `rules/pf2eMath.js` is no longer a third
  implementation — it delegates the arithmetic to core and owns only the
  character-aware part (decoding Pathbuilder's `2/4/6/8` vs native `1/2/3/4`
  proficiency conventions). That is a legitimate adapter. Remaining: the rest of the
  bot's rules modules, opportunistically.

  **The automation host landed 2026-07-18** — `rules/automation.js` (pure: builds an
  `ExecutionContext` from a stored character, runs core's interpreter, renders the
  log) and `state/automation.js` (impure: seeds, and writes mutations back). So the
  bot CAN now execute a Layer-2 tree.

  **Combat targeting landed 2026-07-18 too.** `/use target:<combatant>` binds the
  run to the channel's encounter: damage routes through the tracker's `applyHp`
  (which already owns temp-HP absorption and the dying rules — do not grow a
  second one), and temp HP / conditions land on the combatant. Counters stay on
  the character, because a combatant has none. Outside an encounter, only what a
  character can hold applies and the rest is reported as skipped.

  `rules/effectTranslation.js` maps core's `EffectTemplate` onto the tracker's
  five flat modifier slots. **Its coverage is deliberately low.** The tracker is
  untyped, unconditional, and has one `saveBonus` for all three saves and one
  `skillBonus` for all sixteen skills — so a Fortitude-only penalty, a conditional
  modifier, or an expression-valued one is reported in `unsupported` with a reason
  instead of being approximated. A +1 to Fortitude rendered as `saveBonus` would
  silently buff Reflex and Will: a wrong combatant is worse than an absent effect.
  The honest fix is a richer combatant effect model, not a looser mapper.

  **Typed stacking landed 2026-07-18** — `rules/combatEffects.js` used to ADD every
  modifier, so two −2 *status* penalties to AC (Frightened + Sickened, an ordinary
  pairing) came out as −4, and Prone + Off-Guard + Grabbed as −6. It now delegates
  to core's `stackModifiers`. `rules/bonusTypes.js` DERIVES each slot's bonus type
  from core's condition data rather than a hand-written table — the bot's own
  preset text was wrong (`prone` says "status", core says circumstance), which is
  precisely what deriving avoids. It declines to type a slot when core models no
  modifier for it (Enfeebled's blanket attack penalty is an approximation core
  does not make — that is blocked on scoped attack/damage selectors) or is
  ambiguous (Unconscious hits AC with both a status and a circumstance penalty).
  Backward compatible by construction: no `bonusTypes` = untyped = added, exactly
  the old behavior, so effects stored in live encounters keep their numbers.
  `bless` and `heroism` are spells, not conditions, so nothing is derivable for
  them; the owner supplied both as **status** (2026-07-18) and they sit in
  `OWNER_SUPPLIED` in `bonusTypes.js`. **Do not extend that table from memory** —
  an entry there is a rules claim, and unclaimed presets stay untyped, which
  asserts nothing.

  **Persistent damage stacking (owner-supplied, 2026-07-18).** Different damage
  types coexist — they already did, since each type is its own preset with its own
  name. The SAME type keeps the HIGHER, and `addEffect` used to replace by
  recency, so 3d6 already burning could be silently downgraded to 1d6. It now
  compares, and **declines to decide when the comparison is genuinely ambiguous**
  (3 vs 1d4, or 1d4 vs 1d6): it keeps what is in play and tells the GM, because
  the owner's rule is explicit that this is their call, not the system's. Only two
  comparisons are automatic: flat-vs-flat, and dice of the same size.

  **No content carries an automation tree yet.** The corpus is all Layer-1
  passives, and the decisions fold-in (below) ships passives too — so the host
  still runs hand-authored trees. Layer-2 trees need the authoring surface, not
  the fold-in; that expectation in this file was wrong until 2026-07-18.

- ✅ **The decisions fold-in** (2026-07-18) — `remap-effects.mjs` runs
  `resolveEntity(candidates, decisions)` and ships the result, so the prose parser's
  output reaches a real sheet for the first time. Three things it settled, each a
  trap for the next person:
  - `build-candidates.mjs` read Foundry's proposals from `feat.effects`, which is now
    the pipeline's OWN output — a human's edit would have come back as "Foundry
    proposed this" and corroborated itself. It re-maps the sidecar's `raw` instead.
    **Never read a producer's input from the pipeline's output.**
  - `scripts/grandfather-decisions.mjs` records the 57 `foundry-only` effects that
    already shipped as accepts carrying `by: "migration:foundry-baseline"` and a note
    that they were NOT human-reviewed. Without it they would silently stop shipping,
    since auto-promotion needs corroboration. It refuses to grandfather the 14
    **conflicts** — those stop shipping until a human rules, per the owner.
  - `EffectCandidate.multiplicity` — `reconcile` bucketed by key, collapsing a
    producer that proposed the same effect twice, so Natural Skill's "become trained
    in TWO skills" silently became one. Content went 341 → 328 effects (the conflicts)
    and 33 → 33 choices.

  See `docs/effects-engine-design.md` for the full record.

  **`/use` landed 2026-07-18** — the loop is closed end to end: core computes, the
  host adapts, mutations are written back, the player sees narration AND what
  changed AND what didn't. `rules/authoredActions.js` is a TEMPORARY hand-authored
  catalog in core's `GrantedAction` shape (validated against `grantedActionSchema`
  at load); it exists only because no content carries a tree, and should be deleted
  once the decisions fold-in supplies them. **Its entries are deliberately generic
  demos that make no Pathfinder rules claims** — authoring real actions needs rules
  text, per the rules-from-source rule.

  One host decision worth knowing: core defaults an unhandled node failure to
  `ignore`, which is right for a library and wrong for a host narrating to a
  person (a spell whose cost silently failed would still hand out its effect).
  `buildContext` therefore defaults `onError` to `warn`, and an authored node that
  genuinely must not proceed — a COST — carries its own `raise`.
- 🔶 **`packages/db`** — no longer a skeleton: a content store plus `spells`,
  `feats`, `ancestries`, `backgrounds` (15 tests). But **nothing outside `packages/db`
  imports it yet** — the web app still reads the JSON datasets in
  `apps/web/src/features/builder/data/`. Wiring it up is real, unstarted work.
  (See "all content ends up in the DB" — the JSON files are transitional.)

`packages/core` declares `zod` (^4.4.3) — the content schemas use it.

Combat v2's rules were welded to its persistence; that was split on 2026-07-09.
`apps/bot/src/rules/combatV2/model.js` is now pure (requires only `./rolls`) and
the encounter Map plus every Supabase write live in `apps/bot/src/state/combat.js`.
Its 82 tests (`test/combatV2.test.js` + `test/combatV2Model.test.js`) drive the rules
both directly and through the store.

Still impure, despite the bot's own CLAUDE.md declaring `rules/` pure: `calendar.js`,
`weather.js`, `settings.js`, `eberronCalendar.js`, and `eberronWeather.js` import
`lib/storage`, and `rules/combatV2/render.js` imports `discord.js`. Apply the same
split when each is touched — nothing can move into an I/O-free core before it.

**`apps/bot` was UN-FROZEN by the project owner on 2026-07-18.** It had been "frozen
for architecture" (no restructuring, no new rules logic, hotfixes only). That rule is
retired: the effects engine has to be consumed by the bot, and that is not possible
without changing the bot. Restructuring it toward core is now expected work.

What the un-freezing does NOT license:
- **Rules logic still belongs in `packages/core`.** Un-frozen means the bot may be
  reshaped to CONSUME core, not that it may grow its own rules again. A new
  computation in `apps/bot/src/rules/` is still the bug this repo is organized to
  prevent — the legitimate pattern is an adapter (see `pf2eMath.js`, which decodes
  Pathbuilder's proficiency convention and delegates the arithmetic).
- **Database structure.** The live bot on `main` expects the live DB shape, and one
  Supabase project serves both. Schema changes need their own plan; code changes on
  `test` do not put the live bot at risk, but a migration would.

## Stack

- TypeScript, `strict: true`, in ALL new code (`packages/*`, `apps/web`). The bot is
  legacy CommonJS JS; migrate it opportunistically, not wholesale.
- **Node 22.12+.** Node 20 hit end-of-life 2026-04-30; `@supabase/supabase-js`
  requires `node >= 22`; and `require(esm)` (which lets the CommonJS bot consume
  core) needs 22.12. Pinned via `engines` and `.node-version`. CI runs on 22.
- **Use npm 11+ to change dependencies — but the lockfile must stay npm-10
  installable.** These are two operations with two different floors, which is why
  `engines` pins only Node, not npm (a blanket `engines.npm >= 11` would just warn
  on every CI run, since GitHub Actions' Node 22 ships npm 10.9).
  - *Re-resolving* (`npm install` / `npm update`) needs **npm 11+**. npm 10's cold
    resolution silently drops transitive packages here: a fresh `npm install` on
    npm 10.9.8 produced 517 packages instead of 588, omitting `obug` (a hard
    dependency of vitest 4), and every suite then failed with
    `ERR_MODULE_NOT_FOUND`. **Never delete `package-lock.json` to "fix" an install.**
  - *Installing from the lockfile* (`npm ci`) must work on **npm 10**, because CI
    and Vercel run it there. An npm-11-generated lockfile can be un-installable by
    npm 10 (it omits `esbuild` platform variants npm 10 demands). So after any
    dependency change, regenerate the lockfile and verify **`npx npm@10 ci`
    succeeds** before committing. CI's `npm ci` is the automated guard.
- **npm workspaces.** One root lockfile; `npm install` **at the repo root** wires
  everything — installing inside a single app will not link `@pathway/core`.
  (The kickstart kit floated pnpm; we chose npm since both apps already used it and
  the deploy build commands keep working unchanged.)
- **`packages/core` has a build step.** `src/*.ts` → `dist/*.js` + `.d.ts` via
  `tsc -p tsconfig.build.json`, wired to `prepare` so any install produces it.
  `dist/` is gitignored. Both clients consume `dist` through the `exports` map —
  there is deliberately no `development` condition pointing at source, because that
  would let the web app and the bot read *different* representations of the same
  rule and drift. Use `npm run watch:core` while editing core.
- Core's tsconfig uses `moduleResolution: "NodeNext"` on purpose: it forces explicit
  `.js` extensions on relative imports. "Bundler" would let an extensionless import
  compile and then crash inside the bot at runtime.
- **No `undici` override — deliberately removed 2026-07-11 after it took the bot
  offline.** A root `overrides.undici: "^6.27.0"` (patching a high-severity undici
  advisory) once existed, but `@discordjs/rest`/`@discordjs/ws` pin undici to
  **exactly `6.24.1`**, and forcing 6.27.0 hung discord.js's REST call at
  `GET /gateway/bot` — the bot connected to nothing, behind a green deploy. The
  override only ever reached the bot's *runtime* once the build moved to a
  root-directory workspace install (PR #27, back when the bot was on Railway); before
  that the bot's own lockfile shielded it, which is why this surfaced suddenly. **The
  Docker build installs from the root too, so the exposure is the same today.**
  undici is a **bot-only**
  dependency (discord.js is the sole consumer; the browser web app never runs it)
  and it only ever talks to **discord.com over TLS** — while the advisories require
  a *malicious server*, so they are not reachable in this bot's threat model.
  Net: track discord.js's own pin. Re-add a patched override **only** when discord.js
  ships a release that uses a patched undici (verify the bot still logs in), and
  never let it float ahead of what `@discordjs/rest` pins. Also: `npm audit fix
  --force` still proposes "fixing" undici by installing **discord.js@13 — a major
  downgrade** that would break the v14 bot. Do not run it.
- Vitest for tests. Content schemas in Zod; TS types via `z.infer`.
- Supabase (Postgres + Auth + JSONB content store).

## Content licensing (owner policy, revised 2026-07-04)

The former "ORC-clean" rule — a hard prohibition on storing any Paizo Product
Identity — was **retired by the project owner** (2026-07-04). Pathway operates as
a free fan project under Paizo's Community Use Policy (see the site footer) with
ORC-licensed rules content attributed; on that basis content decisions are:

- Game content (mechanics, creature/feat/spell names, descriptions) may be
  imported and stored freely from any reasonable source. Prefer machine-readable
  rules data; keep the `source` field on every entity so attribution stays intact.
- Keep the Community Use Policy / ORC attribution notices in the web footer and
  bot embeds — they are the legal basis for the above.
- The old strict-PI cleanup project is cancelled; the historical ORC-safe labels
  that exist are fine to leave as-is.

**Commercial end-goal (owner note, 2026-07-11).** Pathway is intended to eventually
become a public product, which changes the licensing basis — so plan for it now even
though we don't abide by it yet. The Community Use Policy above is **non-commercial**:
right for the current fan phase, but it does NOT cover a commercial product. The **ORC
License** (paizo.com/orclicense) permits commercial use of *Licensed Material* (game
mechanics) but excludes *Reserved Material* (proper nouns, settings, deities,
storylines, adventure-specific content) unless a licensor designates otherwise, and
requires the ORC Notice + upstream attribution + no implied Paizo endorsement.

We do NOT have to follow ORC strictly yet — but the architecture must let us reach an
ORC-clean, commercially-usable subset WITHOUT refactoring core/backend later:
- Keep provenance rich on every content entity: `source` (granular to the book),
  `isLegacy` (pre-Remaster/OGL), and — worth capturing at import — a coarse
  source-category (core-rules vs adventure vs setting), so the clean subset is a query,
  not a manual scrub. Reserved Material is broader than proper nouns, so filter by
  provenance, not by name-matching.
- The eventual commercial dataset should be sourced from Paizo's official ORC release,
  not AoN provenance (AoN runs under the Community Use Policy and mixes ORC/OGL/PI).
  Pulling from AoN is fine for the current fan phase and for coverage diagnostics.
- Not legal advice — get an IP review before commercializing.

## Rules-from-source rule (non-negotiable)

Do NOT implement Pathfinder rules from training knowledge — it is often subtly wrong
(proficiency stacking, untrained penalties, conditions, degree-of-success shifts). A
review found several model-remembered rules implemented incorrectly. Implement only from
rules text provided in the prompt. The stat engine is data-driven and locked by tests
against human-verified worked examples. When unsure about a rule, stop and ask.

## The effects engine — where most of the work is

The largest thing in `core`, and the current focus. **`docs/effects-engine-design.md`
is its plan of record and is kept current — read it before touching effects.** The
short version:

- **Two layers.** Layer 1 = *passive* effects (declarative: what is ON an actor and
  modifies its numbers). Layer 2 = *automation* (imperative: what happens when you DO
  the thing — a pure tree interpreter over a seeded RNG). They meet at Layer 1.5, the
  *applied effect*. Both layers' node vocabularies are complete and tested.
- **We build our own schema.** Foundry VTT's `pf2e` rule elements are *import
  feedstock, never our contract* — their encodings are their work, and a commercial
  Pathway could not derive from them anyway. `packages/core/src/foundry.ts` is the ONE
  module allowed to know their shape, and it maps **at ingest**. The boundary is
  checkable, so check it:

  ```bash
  grep -rl "RuleElement" packages/core/src apps/web/src   # only foundry.ts + its test
  ```

- **Honesty is the product.** The mapper never guesses: an element either maps to an
  effect we can stand behind, or it is reported unsupported **with a reason** from a
  closed vocabulary, named after the *blocker*. Coverage is ~8.8% of the Foundry
  corpus and **that number is not the point** — the point is the other 91% is named,
  and the tallies are the roadmap. Never map an element by dropping a condition it
  can't express: a situational bonus shown as permanent is a wrong sheet, which is
  worse than an absent effect.
- **`scripts/remap-effects.mjs` re-maps from data we already hold** — coverage rises
  as the model improves, with no Foundry clone, ever again. `ingest-pf2e.mjs` (which
  needs the clone) is only for re-ingesting CONTENT.
- **Next up: `prose.ts`** — a parser over PF2e rules *prose*, which strictly contains
  more than the rule elements, is licence-clean, and is source-agnostic. Foundry
  becomes a corroborator. `candidate.ts` is its landed review model. See the doc.

## Working conventions

- On any non-trivial task, propose a plan and wait for approval before writing files.
- Every function in `core` ships with tests. Tests are the contract.
- `core` stays I/O-free so it can be tested without a database or network.
- Characters reference content by id AND a pinned version — never embed a copy, never
  reference live. Content updates are an explicit action, not a silent mutation.
- Official and homebrew content share ONE schema, differing only by an owner/source field.
- **Verify claims against the code, including this file's.** Every "status" here has
  been wrong at least once. Prefer a grep over a memory.

## Commands

```bash
npm install               # install all workspaces (run at repo root)
npm start                 # run the bot locally (delegates to apps/bot)
npm run deploy            # register slash commands globally
npm run deploy:guild      # register slash commands to the dev guild (instant)
npm run dev:web           # Vite dev server for the web app
npm run build:web         # production build of the web app
npm test                  # ALL workspace tests (core 786 · bot 341 · web 101 · db 15)
npm run typecheck         # ALL workspaces — see the blindspot below. RUN THIS.
npm --workspace packages/core run test   # core tests only
npm --workspace apps/bot run test        # bot rules tests only
npm --workspace apps/web run lint        # web lint
node apps/web/scripts/remap-effects.mjs --dry   # re-map ingested effects (no clone needed)
npm run pull:decisions    # Supabase effect_decisions -> effect-decisions.json (before baking content)
npm run push:decisions    # the inverse: seed/restore the table from the file
```

### Review decisions live in Supabase; content stays committed

The effect review queue writes its decisions to the `effect_decisions` table
(migration `20260719000000_effect_decisions.sql`, admin-only by RLS) as you make them —
they used to exist only in React state, so a closed tab lost everything un-exported.

**Content does NOT move with them.** `feats.json` and friends stay committed so the
Vercel build remains hermetic — no network, no credentials, reproducible from the commit
alone. The web deploy already depends on one unversioned Vercel setting; a build-time DB
dependency would be a second way for it to break. `pull:decisions` materializes the table
into `effect-decisions.json` as an explicit step before `remap-effects.mjs` bakes content,
so the input is recorded in git next to the output. Both scripts need
`SUPABASE_SERVICE_ROLE_KEY` (the table is admin-only and a script has no session) — that
key must never reach the browser bundle.

### `npm test` cannot catch a type error in a core test file

`tsconfig.build.json` excludes `*.test.ts` and Vitest does not typecheck, so a type
error inside `packages/core/src/*.test.ts` is invisible to BOTH `npm test` and
`npm run build`. **CI went red for a day** before anyone noticed. `npm run typecheck`
at the root covers core (tests included), db, and web — run it before you push.

Vitest 4 occasionally flakes on a first cold run; re-run before investigating.

Deeper bot architecture notes live in `apps/bot/CLAUDE.md` and `apps/bot/HANDOFF.md`
(both partly historical — see their banners). `DEPLOY.md` is the bot hosting runbook.
`docs/effects-engine-design.md` is the effects engine's plan of record.
Secrets stay in `.env` (git-ignored) at the repo root or inside `apps/bot`; the bot's
production secrets live in `bot.env` on the VPS only.

## Deployment

- **Bot** → **self-hosted on a small VPS via Docker.** NOT Railway — see below.
- **Web** → Vercel, root directory `apps/web`, `npm run build` (Vite). Auto-deploys
  on push to `main`.

### The bot left Railway (2026-07-14) — don't send it back

Discord rate-limited Railway's **shared** egress IPs (Cloudflare error 1015) and the
bot kept dropping its gateway connection. A Discord bot needs a **dedicated outbound
IP** and a **persistent process** (it holds a WebSocket); Railway gave neither. There
is no Railway config in the repo any more.

It now runs from the repo-root `Dockerfile` + `docker-compose.yml` on any VPS
(DigitalOcean/Hetzner/Oracle). **`DEPLOY.md` is the runbook** — read it before
touching bot hosting. Consequences worth knowing:
- **Deploys are manual**: `git pull && docker compose up -d --build` on the box.
  Pushing to `main` does NOT deploy the bot. (The web app still auto-deploys.)
- The image builds from the **repo root**, not `apps/bot`, because the bot depends on
  the `@pathway/core` workspace and there is one root lockfile. `--include=dev` is
  required so core's `prepare` can emit `dist/`.
- The bot is stateless (Supabase holds everything), so moving hosts is "run it on a
  new box", not a migration.

### The web deploy depends on an unversioned Vercel setting

`apps/web` imports `@pathway/core`, which lives outside its root directory. Vercel
builds with Root Directory = `apps/web` and by default **prunes sibling packages**, so
`packages/core` is simply not on disk at build time. Nothing in this repo can work
around that: a workspace install, a Vite `resolve.alias`, and a tsconfig `paths`
mapping were each tried and each reverted (`752575b`, `701a572`, `db9f851`, `b297deb`,
`72d10f0`) — you cannot alias to a directory that was never checked out. The last
resort was vendoring a byte-identical copy of core back into `apps/web`, which is
exactly the drift bug this architecture exists to prevent.

It works today **only** because the Vercel project has *"Include source files outside
of the Root Directory in the Build Step"* enabled. If that is ever lost, the build
fails with `TS2307: Cannot find module '@pathway/core'` and
`[vite]: Rollup failed to resolve import "@pathway/core"`. Re-enable the setting;
do **not** vendor core back into the app.

The durable fix (worth doing): build from the repo root — Root Directory `.`, build
command `npm run build:web`, output directory `apps/web/dist`.

`vercel.json` is strict JSON. A `//` comment key in it once broke production
(`701a572`) — do not add comments to it.
