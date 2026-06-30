# Roadmap

> Status: **Draft for review** · Phase 0 (Planning).

Pathway is built in phases. Per the [Master Specification](../../PATHWAY_MASTER_SPEC.md),
every phase moves through **Design → Review → Approve → Build → Test → Refactor
→ Release**, and we do not start a phase's build step until its design is
approved. This roadmap sequences the phases and states the **gate** (the
condition that must be true) to move on.

The ordering principle: **build the shared spine before the clients.** The
`core` rules engine, schema, and data layer are dependencies of almost
everything, so they come first. Both the website and the bot are clients of that
spine.

---

## Phase 0 — Planning *(current)*

Architecture documents and decision records.

- Master spec committed ✅
- System architecture ✅
- Conceptual data model ✅
- Roadmap (this doc) ✅
- ADR template + first ADR ✅

**Gate to Phase 1:** stakeholder approval of the architecture, data model, and
this phase plan.

---

## Phase 1 — Foundation

The runnable skeleton and shared spine. No user features yet.

- Monorepo tooling decided (ADR) and scaffolded: `apps/`, `packages/`.
- `apps/api` (Express + TS) and `apps/web` (Vite + React + Tailwind) boot and
  talk to each other with a health check.
- Supabase project: Postgres, Auth, Storage wired; first migrations + RLS
  baseline for `user` / `account_link`.
- `packages/schema` (Zod + types) and an empty `packages/core` established.
- CI: lint, typecheck, test on every PR. Deploy previews (Vercel / Railway).
- The grimoire **design system** seed in `packages/ui`: color tokens (midnight
  blues, gold filigree), typography, base components.

**Gate to Phase 2:** app deploys, auth works end-to-end, CI is green.

---

## Phase 2 — Rules Library (read path)

Get official content in and make it browsable/searchable. This unblocks both the
builder and the bot.

- AoN **import pipeline**: scheduled job → staging → review queue → published
  tables, with attribution. (ADR for the pipeline + search backend.)
- Rules schema in `packages/schema` for spells, feats, classes, ancestries,
  items, monsters, hazards, conditions, traits.
- Website: searchable, filterable rules browser with the grimoire layout.
- API: read endpoints for all rules entities, versioned under `/v1`.

**Gate to Phase 3:** a reviewer can publish AoN content; users can search it on
the web.

---

## Phase 3 — Character System

The flagship feature.

- `packages/core` rules engine: compute a full sheet from a `build`.
- Guided builder with Beginner Mode, Learning Mode, tooltips, automatic
  calculations + manual overrides.
- Character Vault, level history, audit log.
- Portraits / tokens / banners via Supabase Storage.
- Exports: **Pathbuilder-compatible JSON** and **PDF** as adapters over `core`.

**Gate to Phase 4:** a user can build, save, level, and export a legal
character; the engine matches PF2e math in tests.

---

## Phase 4 — Companions

- Animal companions, familiars, eidolons, mounts, custom companions.
- Reuse `core` + builder patterns; export + (later) bot sync.

**Gate to Phase 5:** companions build and attach to characters.

---

## Phase 5 — Discord Bot (parity client)

Now that the spine exists, the bot is a second client — not a rewrite.

- Discord OAuth account linking via `account_link`.
- Commands: rules lookup, character sheet, dice, conditions, combat tracker.
- **Two-way sync**: realtime updates between web and Discord; audit log records
  bot edits.

**Gate to Phase 6:** a linked user can view/roll their character in Discord and
see web edits reflected live.

---

## Phase 6 — Campaigns

- Campaigns + membership/roles enforced by RLS.
- NPCs, encounters, journals, loot, quests.
- Shared homebrew at campaign scope; permissions.

**Gate to Phase 7:** a GM runs a campaign with players and shared content.

---

## Phase 7 — Organizations / West Marches

- Organizations, multi-GM, org-scoped shared content.
- Discord server (guild) integration; role-based permissions.

**Gate to Phase 8:** an org with multiple GMs shares content across campaigns.

---

## Phase 8 — Homebrew Workshop

- Authoring for all PF2e object types, validated against official schemas.
- Visibility scopes (Private / Campaign / Organization / Public).
- Version history, moderation queue, ratings, comments, bot sync.

**Gate to Phase 9:** a user publishes homebrew that the engine and bot consume
like official content.

---

## Phase 9 — Table Mode

- A focused play view (web) pulling characters, encounters, combat tracker,
  and rules together for live sessions.

**Gate to Phase 10:** a table can run an encounter end-to-end.

---

## Phase 10+ — Platform & Future

Sequenced after the core product is proven:

- **Community Library / Marketplace** (browse, share, later sell homebrew).
- **Public API** hardening + scoped API keys.
- **Plugin framework** (API-only, reviewed).
- **Payments**: Stripe-ready billing, entitlements behind the whitelist.
- **Offline** character sheets (local cache + reconcile).
- **Localization** rollout beyond `en`.

---

## Notes on sequencing tradeoffs

- **Why the bot is Phase 5, not earlier:** it depends on rules (Phase 2) and the
  character engine (Phase 3). Building it first would mean re-implementing logic
  that later moves to `core` — exactly the drift the architecture forbids.
- **Why rules content precedes the builder:** the builder is meaningless without
  feats/spells/items to choose from, and the import pipeline has its own review
  complexity worth isolating.
- **Why payments/marketplace are last:** they are revenue, not product. The
  whitelist + Stripe-ready stubs from Phase 1 mean we can switch them on without
  re-architecting.

Phase boundaries are gates, not deadlines. We never rush a feature.
