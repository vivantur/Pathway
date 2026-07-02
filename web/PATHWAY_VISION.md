# Pathway — Master Vision Specification

| | |
| --- | --- |
| **Project Name** | Pathway |
| **Domain** | [www.pathwaypf2e.com](https://www.pathwaypf2e.com) |
| **Author** | Olyvia Green |
| **Purpose** | Master Vision Document |

> This is the **north-star vision** for Pathway: the long-term destination, in
> the author's own words. It is intentionally aspirational and edition-agnostic
> about implementation order. For *how reality constrains the build today* — the
> Discord bot already exists in production and the website joins its live backend
> as a second client — read the [System Architecture](./docs/architecture/system-architecture.md),
> the [Web ⇄ Bot Sync Contract](./docs/architecture/web-bot-sync.md), and the
> [Roadmap](./docs/architecture/roadmap.md). The vision below is the *what and
> why*; those documents are the *how and in what order*.

---

## Vision

Pathway is the definitive digital platform for Pathfinder Second Edition.

It is not simply a character builder.

It is a complete ecosystem designed to become the single destination for
everything related to Pathfinder 2e.

The long-term goal is to combine the strengths of:

- Archive of Nethys
- Pathbuilder
- D&D Beyond
- Foundry VTT
- Modern campaign management software
- Community-driven homebrew platforms

...into one unified platform with its own original identity.

The Pathway Website and the Pathway Discord Bot are **equal parts of the same
ecosystem**. Neither is secondary.

- The website provides rich visual management.
- The Discord Bot provides Discord-native gameplay, automation, and accessibility.

Both communicate through the same backend, database, permissions, and APIs.

---

## Core Philosophy

The project should always prioritize:

- Clean Architecture
- Scalability
- Extensibility
- Maintainability
- Excellent UX
- Beginner Friendly
- Powerful for Veterans
- Fantasy Immersion
- Performance
- Accessibility

This project is intended to be maintained for many years.

- Avoid technical debt.
- Avoid shortcuts.
- Build correctly before building quickly.

---

## Technology Stack

### Frontend

- React
- TypeScript
- Tailwind CSS
- Vite
- React Router
- TanStack Query

### Backend

- Express
- TypeScript
- Railway

### Database

- PostgreSQL
- Supabase
- Supabase Auth
- Supabase Storage

### Hosting

- Vercel
- Railway
- Supabase

### Future

- Stripe
- Public API
- Plugin System

---

## Design Vision

Pathway should feel like opening:

- an ancient magical archive
- an adventurer's journal
- a spellbook
- a grimoire
- an explorer's codex
- a celestial atlas

The interface should immediately immerse users in fantasy while remaining highly
usable.

Fantasy should enhance usability. Never reduce readability.

---

## Visual Style

Inspired by:

- Baldur's Gate 3
- Diablo IV
- Dragon Age
- Elder Scrolls Online
- World of Warcraft
- Pillars of Eternity
- Foundry VTT
- Obsidian

Do **not** copy these products. Instead, create an original visual identity.

### Colors

**Primary**

- Midnight Blue
- Dark Navy
- Black
- Charcoal

**Accent**

- Gold
- Antique Brass
- Emerald
- Arcane Cyan
- Silver

### Decorative Elements

- Arcane circles
- Animated runes
- Magical particles
- Spell effects
- Gold filigree
- Celestial maps
- Compass roses
- Ancient parchment
- Leather journals
- Decorative borders
- Fantasy iconography

Everything should remain tasteful and readable.

---

## Rules Support

**Primary:** Pathfinder 2e Remaster

**Also support:** Pathfinder 2e Legacy

Support both simultaneously. Track:

- Source book
- Version
- Traits
- Errata
- Prerequisites

---

## Character Builder

Support:

- Guided creation
- Beginner Mode
- Learning Mode
- Tooltips
- Automatic calculations
- Manual overrides
- Variant Rules
- Character history
- Audit log
- Portraits
- Tokens
- Banners
- Notes
- Inventory
- Spell management

### Variant Rules

Support from character creation:

- Free Archetype
- Automatic Bonus Progression
- Ancestry Paragon
- Gradual Ability Boosts

Future variant rules should be modular.

---

## Character Vault

Every character stores:

- Portrait
- Banner
- Token
- Statistics
- Inventory
- Spellbook
- Companions
- Campaign assignments
- Level history
- Audit log
- JSON
- PDFs

---

## Companion Builder

Support:

- Animal Companions
- Familiars
- Eidolons
- Mounts
- Custom companions

Each companion should have:

- Portrait
- Token
- Banner
- Export
- Bot synchronization

---

## Table Mode

Designed specifically for live gameplay. Include:

- HP
- AC
- Saves
- Skills
- Conditions
- Attacks
- Damage
- Actions
- Reactions
- Hero Points
- Focus Points
- Spellcasting
- Inventory
- Dice Roller
- Notes

The website itself does not need a full combat tracker because the Discord Bot
already manages combat. However, combat should be capable of synchronizing live
between the website and bot.

---

## Rules Library

Create a searchable Pathfinder database similar to Archive of Nethys. Include:

- Rules
- Traits
- Conditions
- Actions
- Activities
- Classes
- Archetypes
- Feats
- Spells
- Equipment
- Weapons
- Armor
- Shields
- Consumables
- Rituals
- Monsters
- Hazards
- NPCs
- Deities
- Languages
- Skills
- Proficiencies
- Source Books
- Glossary

Automatically import updates on a schedule while respecting official attribution
and usage requirements.

---

## Global Search

One search bar should search everything:

- Rules
- Characters
- Campaigns
- Homebrew
- Monsters
- NPCs
- Organizations
- Companions
- Marketplace
- Notes

---

## Campaign Manager

Support:

- Campaign Dashboard
- Player Management
- Multiple GMs
- NPCs
- Journals
- Loot
- Quests
- Session Recaps
- Shared Homebrew
- Permissions

**Future:** Maps · Calendar

---

## Organizations

Support:

- West Marches
- Discord Communities
- Multiple Campaigns
- Multiple GMs
- Shared NPC Libraries
- Shared Monster Libraries
- Shared Homebrew
- Shared Loot
- Shared Encounters
- Organization Moderators
- Organization Administrators

---

## Homebrew Workshop

Users should be able to create:

- Classes
- Archetypes
- Ancestries
- Heritages
- Backgrounds
- Feats
- Spells
- Weapons
- Armor
- Items
- Monsters
- NPCs
- Traits
- Conditions
- Actions
- Companions
- Familiars
- Eidolons
- Rules

**Visibility:** Private · Campaign · Organization · Public

**Features:**

- Drafts
- Publishing
- Version History
- Changelog
- Comments
- Ratings
- Favorites
- Moderation
- Verified Creators
- Collections

Public homebrew should automatically synchronize with the Discord Bot.

---

## Discord Bot

The Pathway Bot is a first-class component of the platform. It should support
everything the website supports, including:

- Character Management
- Campaign Management
- Rules Lookup
- Feats
- Spells
- Monsters
- Conditions
- Traits
- Equipment
- Homebrew
- Dice
- Combat
- Automation

The website and bot are simply two interfaces for the same backend.

---

## Import / Export

Support:

- Pathbuilder JSON Import
- Pathbuilder JSON Export
- JSON IDs
- PDF Character Sheets
- PDF Companion Sheets
- FoundryVTT Token Export

Maintain compatibility with the existing Pathway Discord Bot.

---

## Subscription Model

**Free**

- 4 Characters
- 1 Campaign
- Limited Homebrew

**Premium (Future)**

- Unlimited Characters
- More Campaigns
- Advanced Campaign Tools
- Expanded Homebrew
- Premium PDF Themes
- Enhanced Sync

**Admin Features**

- Permanent Whitelist
- Feature Flags

---

## Marketplace

Future support for publishing:

- Character Builds
- Adventures
- Encounter Packs
- NPC Packs
- Monster Packs
- Homebrew Packs
- Campaign Templates

---

## Offline Support

Support:

- Offline Character Sheets
- Offline Table Mode
- Cached Rules
- Sync When Reconnected

---

## Public API

Design secure APIs for:

- Website
- Discord Bot
- Foundry VTT
- Roll20
- Owlbear Rodeo
- Future Integrations

---

## Development Philosophy

Every feature follows:

1. Design
2. Architecture
3. Review
4. Approval
5. Implementation
6. Testing
7. Documentation
8. Release

- Never skip architecture.
- Never rush implementation.
- Always explain architectural decisions.
- Always leave room for future expansion.

---

## Final Vision

Pathway should become the definitive Pathfinder Second Edition platform.

A player should be able to learn the rules, build characters, create companions,
manage campaigns, publish homebrew, organize communities, and play Pathfinder 2e
without leaving the Pathway ecosystem.

The website and Discord Bot together should provide everything needed to create,
learn, manage, automate, and run Pathfinder 2e for individuals, groups, and
entire West Marches communities.
