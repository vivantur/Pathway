# Pathway Discord bot — portable container image.
#
# Deliberately host-agnostic: this same image runs on any VPS (DigitalOcean,
# Hetzner, Oracle Cloud, …) or PaaS (Fly.io). Moving hosts — e.g. off a
# shared-IP provider that Discord rate-limited — becomes "run it on a new box",
# not a re-platform. See DEPLOY.md.
#
# Node 22 (the repo pins 22.23.1; @supabase/supabase-js needs >=22 and the
# CommonJS bot consuming @pathway/core needs the require(esm) support in 22.12+).
FROM node:22-bookworm-slim

WORKDIR /app

# The bot depends on the @pathway/core workspace, and there is ONE root
# lockfile that wires every workspace together — so the whole monorepo is the
# build context, and we install from the root (exactly like the Railway build).
COPY . .

# Install from the lockfile. --include=dev is REQUIRED: packages/core's `prepare`
# script runs `tsc` to emit its dist/, which the bot loads at runtime. A
# production-only install fails at that build step.
RUN npm ci --include=dev

# Runtime hardening: drop to the unprivileged `node` user shipped in the image.
ENV NODE_ENV=production
USER node

# The bot holds a persistent WebSocket to Discord (a long-running process, not a
# request/response server), so there is no port to expose. Supabase is the
# datastore; no volume is needed. `npm start` delegates to apps/bot.
CMD ["npm", "start"]
