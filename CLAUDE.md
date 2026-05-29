# Pathway Bot Notes

Pathway now runs from `Pathwayv2`. Treat the old root bot files and folders as legacy cleanup targets, not active source.

## Active Entry Points

- Bot runtime: `Pathwayv2/src/index.js`
- Slash-command deploy: `Pathwayv2/src/deploy.js`
- Root start command: `npm start`
- Root deploy commands: `npm run deploy` and `npm run deploy:guild`

Root `index.js` and `deploy.js` may exist as compatibility launchers only. Do
not put bot logic there.

## Active Source Layout

```text
Pathwayv2/src/
  commands/   # Slash command feature folders
  discord/    # Discord-specific helpers
  lib/        # Infrastructure helpers
  parsers/    # Input parsers
  reference/  # Reference-data helpers
  rules/      # PF2e rules and math
  state/      # Supabase-backed state modules
```

For deeper architecture details, use `Pathwayv2/CLAUDE.md` and `Pathwayv2/HANDOFF.md`.

## Cleanup Guidance

Do not add bot logic to the root `index.js`, `deploy.js`, `commands/`, `systems/`, `utils/`, or `parsers/`. Those belonged to the v1 layout; the root entry files are only host compatibility launchers.

CI validates `Pathwayv2`, so the old root bot files can be removed after confirming the deployment uses `npm start`.

## Environment

Keep local secrets in `.env` at the repository root or inside `Pathwayv2` when running from that folder. Both locations are ignored by git.
