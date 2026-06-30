# PATHWAY Master Specification (Starter)

> **Purpose:** This document serves as the master architectural prompt for Claude Code. It defines the long-term vision, product philosophy, and development workflow for Pathway.

# Vision

Pathway is the definitive digital companion for Pathfinder Second Edition.

It is **not just a character builder**. It is a complete ecosystem that combines the strengths of Archive of Nethys, Pathbuilder, D&D Beyond, a modern campaign manager, and the Pathway Discord Bot into one unified platform.

The website and Discord Bot are equal citizens of the platform.

- The website provides rich visual interfaces, dashboards, editing tools, exports, campaign management, homebrew creation, and account management.
- The Discord Bot provides fast Discord-native gameplay, rules lookup, automation, combat tracking, character management, campaign tools, and community interaction.
- Both share the same backend, database, permissions, APIs, and synchronization.

## Core Goals

- Complete Pathfinder 2e rules library (Remaster first, Legacy supported)
- Character Builder & Character Vault
- Companion Builder
- Campaign Manager
- Organization / West Marches support
- Homebrew Workshop
- Community Library / Marketplace
- Table Mode
- PDF & JSON import/export
- Pathbuilder compatibility
- Two-way Discord Bot sync
- Offline-ready character sheets
- Public API
- Secure plugin architecture
- Future subscription support with whitelist

## Technology Stack

Frontend:
- React
- TypeScript
- Tailwind CSS
- Vite

Backend:
- Express
- TypeScript
- Railway

Database:
- Supabase (PostgreSQL)
- Supabase Auth
- Supabase Storage

Hosting:
- Vercel
- Railway
- Supabase

Payments:
- Stripe-ready architecture

## Design Philosophy

Pathway should feel like opening an enchanted adventurer's grimoire.

Inspirations:
- Baldur's Gate 3
- Diablo IV
- Elder Scrolls Online
- Pillars of Eternity
- Dragon Age
- World of Warcraft
- Foundry VTT
- Obsidian

Do **not** copy these products. Create an original identity.

Visual language:
- Deep midnight blues
- Gold filigree
- Arcane runes
- Celestial motifs
- Spellbook layouts
- Elegant fantasy typography
- Magical but readable

Fantasy should enhance usability, never reduce it.

## Feature Summary

### Rules Library
- Searchable rules
- Monsters
- Hazards
- Classes
- Feats
- Spells
- Traits
- Conditions
- Equipment
- Source tracking
- Scheduled Archive of Nethys import with attribution and review workflow

### Character System
- Guided builder
- Beginner Mode
- Learning Mode
- Tooltips
- Automatic calculations
- Manual overrides
- Level history
- Audit log
- Portraits
- Tokens
- Banners
- PDF export
- Pathbuilder-compatible JSON

### Companion System
- Animal companions
- Familiars
- Eidolons
- Mounts
- Custom companions
- Export and Bot sync

### Campaign Platform
- Campaigns
- NPCs
- Encounters
- Journals
- Loot
- Quests
- Permissions
- Shared homebrew

### Organizations
- West Marches
- Multi-GM
- Shared content
- Discord server integration
- Role-based permissions

### Homebrew
- All PF2e object types
- Private / Campaign / Organization / Public
- Version history
- Moderation
- Ratings
- Comments
- Bot sync

### Discord Bot
The bot supports everything the website supports:
- Rules lookup
- Character management
- Campaign management
- Homebrew lookup
- Monsters
- Items
- Spells
- Combat tracking
- Dice rolling
- Automation
- Two-way synchronization

### Future
- Marketplace
- Public API
- Plugin framework
- Offline support
- Localization

## Development Philosophy

Never rush features.

Every major phase follows:

1. Design
2. Review
3. Approve
4. Build
5. Test
6. Refactor
7. Release

Claude should first produce architecture documents before implementation, explain tradeoffs, and wait for approval between phases.
