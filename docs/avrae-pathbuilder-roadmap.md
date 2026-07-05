# Pathway Review: Becoming the Avrae of PF2e (and Beating Pathbuilder)

*A capability review of the Pathway Discord bot and web app, with a prioritized roadmap.*
*July 2026*

---

## Where things actually stand

**The good news: Pathway is much closer than it probably feels.** The bot already implements most of Avrae's mechanical surface — for PF2e, natively, which Avrae itself never did. The web app is a real, functional level 1–20 builder, not a prototype. The gaps are specific and finite, and one of them is structural rather than feature-shaped.

**The headline finding:** the v2 bot — all ~96 commands, the initiative tracker, cast automation, dying/wounded logic — **has never been deployed to production.** Per `apps/bot/HANDOFF.md`, Railway is still serving the legacy v1 single-file bot. Before anything else on this list, ship what's already built.

---

## Part 1: The bot vs. Avrae

### What Pathway already matches or beats

The bot has working equivalents of nearly everything people use Avrae for:

- An advanced dice parser (keep/drop, iteration, crit doubling, rerolls, labels)
- Skill/save/attack rolls with real proficiency math and degree-of-success resolution
- A full initiative tracker: monsters with bestiary auto-fill, groups/hordes, hidden stats, resistances/weaknesses/immunities, delay/rejoin
- Multi-Attack Penalty tracking (including agile weapons)
- ~30 PF2e condition presets with numeric effects, plus custom effects
- Persistent damage with end-of-turn flat checks
- Remaster-accurate dying/wounded/doomed, recovery checks, and hero-point stabilization
- Spell casting automation that resolves heightened damage, spends slots, handles basic saves, and auto-applies conditions by degree of success
- Pathbuilder JSON/ID import, plus import from the Pathway web app
- Snippets, character variables (cvars), and custom counters
- Homebrew monsters/spells/items with per-guild overrides
- Hero points, focus points, XP tracking, rest/refocus

The downtime system (18 activity commands with day banking) and the Golarion calendar/weather tools go *beyond* anything Avrae offers.

### What separates Pathway from "the Avrae of PF2e"

**1. Ship v2 to production.** Smoke-test in the dev guild, cut Railway over. Everything else is theoretical until real sessions run on this code.

**2. A programmable alias engine — this is Avrae's moat.** Avrae's dominance comes from `!alias` + the Draconic scripting language + the Alias Workshop: users write custom automation and share it across servers, so the community extends the bot for free. Pathway has the precursors (snippets with positional args, cvars with `{{}}` substitution) but no user-defined *logic*:

- No conditionals, loops, or computed output
- No reading character/combat state inside a user-defined command
- No server-level variables (Avrae's `svar`/`gvar` equivalents)
- No public library of shared aliases

There's no need to invent a language: embed a sandboxed interpreter (a restricted JS/Lua sandbox, or the restricted-Python approach Avrae took with Draconic) exposing a small read API over character and combat state plus a roll function. Then add `/alias` and `/servalias`, and eventually a workshop page on the website. This is the single biggest bot feature between Pathway and "Avrae equivalent."

**3. Finish the combat migration.** Two parallel engines coexist (legacy `/init` internals + combat v2) with bridge files between them. This is the riskiest code in the repo and the place drift bugs will bite mid-session. Pick v2, port what's missing, delete the legacy path and the four retired command folders.

**4. Automation depth**, in priority order:

- Condition durations tick but don't auto-expire or prompt save-to-end
- Effects that end on the caster's turn vs. the target's turn aren't distinguished
- Targeting is name-string based

These are the things GMs notice ten sessions in.

**5. Tests.** There is *no test suite* on ~39k lines of rules-heavy code — validation is `node --check`. At minimum, lock the pure `rules/` modules (dice parser, degree of success, MAP, dying/recovery, condition math, spell damage heightening) with Vitest against human-verified worked examples. These are pure functions — the cheapest possible tests, guarding exactly the code that ruins a game night when it's wrong.

**6. Public-scale hygiene** (only when opening up beyond the friend group): onboarding docs / a docs site, per-guild settings, rate limiting, and eventually sharding. Avrae's other moat is simply being installed in tens of thousands of servers — distribution requires this plumbing.

---

## Part 2: The website vs. Pathbuilder

### What Pathway already matches or beats

- A 12-step builder with real ability-boost math, including the 18+ partial-boost rule and Gradual Ability Boosts
- Per-level skill increases with rank caps; feat slots by type per level with best-effort prerequisite checking
- Spellcasting including focus spells and innate spells; fundamental runes; companions/eidolons/familiars
- Six working variant rules: Free Archetype, Automatic Bonus Progression, Proficiency Without Level, Ancestry Paragon, Gradual Ability Boosts, Stamina
- Pathbuilder JSON import *and* export (round-trips with Pathbuilder-aware tools), plus PDF export
- Public share links and a rules library with full monster stat blocks
- The thing Pathbuilder fundamentally cannot do: **a character sheet that live-syncs bidirectionally with a Discord bot during play**

### What needs closing

**1. Rules-enforcement holes.** Players notice these fast, and "better than Pathbuilder" means being *stricter* — Pathbuilder's accuracy is its reputation:

- Archetype dedication chains not enforced (dedication before archetype feats; the two-feat rule before a second dedication)
- No bulk/encumbrance
- No one-armor/one-shield enforcement (the engine just picks best AC)
- Monk Path-to-Perfection save choice unmodeled
- Dual-class and Mythic toggles visible but inert — implement or hide them

**2. Content completeness.** The builder runs on a bundled ~4.6 MB JSON seed (5,361 feats, 1,731 spells, 5,218 items, 459 backgrounds, 27 classes). The `ingest:pf2e` pipeline for a fuller generated dataset exists but the app isn't wired to prefer it — flip that on, and move content out of the JS bundle (lazy-load or serve from Supabase) since 4.6 MB in the bundle hurts mobile load times. Pathbuilder's other reputation is same-week coverage of new releases; a repeatable ingestion pipeline is what makes that sustainable.

**3. Homebrew authoring.** Pathbuilder has custom content packs; Pathway has homebrew only on the bot side (`/monsteradd` etc.). The architecture already says official and homebrew share one schema — build the web UI for authoring feats/items/spells/ancestries, and let both the builder and the bot consume them. Do this *after* the schema lands in `packages/core` (Part 3) so the editor only gets built once.

**4. Where Pathway leapfrogs Pathbuilder** rather than chasing it:

- **Play mode.** Pathbuilder is a builder; Pathway's sheet already has a dice roller, live conditions, and HP/hero/focus tracking synced to Discord. Lean into *"build on the web, play in Discord, both always agree"* as the product identity — nobody else in PF2e has this.
- **A GM/campaign layer** (roadmap phase W6): parties, a campaign dashboard showing everyone's live sheets, and a web encounter builder that pushes directly into the bot's `/init`. Pathbuilder has nothing here, and it composes both halves of the product into something neither Avrae nor Pathbuilder is.

---

## Part 3: The structural fix — build `packages/core` for real

This is the one item that's not a feature but taxes every feature. The PF2e rules math currently exists in **three places**, which is exactly the drift bug the project's own architecture rule was written to prevent:

1. `apps/web/src/features/builder/rules.ts` (~630 lines — the builder's engine)
2. `apps/web/src/features/characters/pathbuilder.ts` (~500 lines — the *sheet's* engine, a different input shape, partially trusting Pathbuilder's precomputed totals)
3. `apps/bot/src/rules/pf2eMath.js` (the bot's own proficiency/check math)

On top of that, the web app *vendors byte-identical copies* of core's proficiency and companion modules, because Vercel builds with root directory `apps/web` and prunes sibling packages. `packages/core` itself has only two real slices (proficiency, companions) and `packages/db` is a placeholder.

What to do, in order:

1. **Fix the deploy constraint that forces vendoring.** Build from the repo root (Vercel supports monorepo installs — root install plus a build command that runs `npm --workspace apps/web run build`), or prebuild/publish core. Until this is fixed, everything moved into core gets copied back out.
2. **Move the builder engine into core**, one derived value at a time (AC, then saves, then skills…), deleting the local copy as each is verified by tests — the migration plan in `CLAUDE.md`, actually executed.
3. **Unify the two web engines.** The sheet engine should become a thin adapter converting stored Pathbuilder JSON into core's character model — not a second implementation. Stop preferring Pathbuilder's precomputed totals once core's math is test-locked; that's how "better than Pathbuilder" accuracy claims become verifiable.
4. **Point the bot's `rules/` at core last.** The bot is frozen for architecture; when it does migrate, the pure functions in `rules/` are the natural first imports.

Why this ranks so high: the alias engine, homebrew authoring, the encounter builder, and campaign tools *all* need a single character model and stat engine to read from. Built on three divergent engines, each feature gets re-implemented per client.

---

## Suggested order of attack

| # | Milestone | Why / payoff |
|---|-----------|--------------|
| 1 | **Deploy the v2 bot** | It's built; it needs a dev-guild smoke test and a Railway cutover. Days, not weeks. |
| 2 | **Vitest over the bot's pure `rules/` modules + fix the Vercel monorepo build** | Cheap safety net on the code that matters most; unblocks all structural work. |
| 3 | **`packages/core` migration** of the builder engine, value by value, test-locked | Ends the three-implementations drift problem for good. |
| 4 | **Builder enforcement gaps** (dedication chains, bulk, armor/shield slots) | Cheap wins once the math lives in one place. |
| 5 | **Content pipeline switch-on + bundle diet** | Full corpus, fast mobile loads, sustainable coverage of new releases. |
| 6 | **Alias/scripting engine for the bot** | The true "Avrae equivalent" milestone. |
| 7 | **Homebrew authoring on the web**, shared schema, consumed by both clients | Matches Pathbuilder's custom packs — but shared with live Discord play. |
| 8 | **Campaign/party/encounter layer** | The leapfrog feature that turns two tools into one product. |

Items 1–2 are hygiene doable in a week. Items 3–5 make the website credibly better than Pathbuilder. Items 6–8 make the bot the Avrae of PF2e — and the combination is something neither of those products can answer.

---

## Appendix: inventory snapshots

### Bot (`apps/bot`)

- discord.js v14, CommonJS, ~181 files / ~39k LOC; clean feature-folder architecture (`commands/`, `state/`, `rules/`, `lib/`, `parsers/`, `reference/`)
- ~96 registered slash commands spanning character management, combat, spells, resources, inventory, notes, downtime, and 31 reference lookups
- Content sourced from Archives of Nethys into Supabase (spells, bestiary, items, plus ~20 reference tables); homebrew spliced in live via Realtime
- Data layer: Supabase (shared with the web app) with in-memory caches hydrated at startup and kept fresh via Realtime subscriptions
- Known debt: v2 undeployed, two combat engines mid-migration, no test suite, a handful of legacy command scaffolds awaiting extraction

### Web app (`apps/web`)

- Vite + React 18 + React Router 6 + React Query 5 + zustand, ~24k LOC, strict TypeScript
- Routes: landing, about, roadmap, rules library, login (Discord OAuth + magic link), vault, importer, builder, sheet, public share
- Builder: 12-step wizard (Ancestry → … → Review), levels 1–20, drafts in localStorage, beginner mode
- Sheet: 10 tabs, dice roller, live conditions, in-browser editing of HP/hero/dying/XP/currency/focus/notes — live-synced with the bot via Supabase Realtime
- Content: bundled JSON seed (~4.6 MB) for the builder; Supabase reference tables (public-read) for the rules library
- Export: Pathbuilder-compatible JSON, themed PDF; import from Pathbuilder by ID/URL/file
- Known debt: rules math duplicated locally (builder engine + sheet engine + vendored core copies), several inert variant-rule toggles, no campaign/party/GM features yet
