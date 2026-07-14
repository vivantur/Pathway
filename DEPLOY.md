# Hosting the Pathway bot

The bot needs a **dedicated outbound IP** and a **persistent process** (it holds
a WebSocket to Discord). Railway gave neither — its shared IPs get rate-limited
by Discord (Cloudflare error 1015), which is why the bot kept dropping. Any small
VPS fixes this: each machine has its own IP that only you use.

This repo ships a portable `Dockerfile` + `docker-compose.yml`, so hosting is the
same three commands everywhere, and moving hosts later is trivial.

## Recommended hosts

| Host | Cost | Notes |
|------|------|-------|
| **DigitalOcean** | $4/mo | Easiest UX + best docs. Pick a US region (NYC/SFO). |
| **Hetzner Cloud** | ~€3.79/mo | Cheapest reliable. **Has US regions** (Ashburn VA, Hillsboro OR) — pick one to avoid a transatlantic hop, though for a text bot the EU latency is unnoticeable anyway. |
| **Oracle Cloud** | Free | Always-Free ARM VM; the image is multi-arch so it just works. Caveats: signup needs a card for verification, and idle free VMs can be reclaimed. |

The `node:22` base image is multi-arch, so the exact same setup runs on x86
(DO/Hetzner) and ARM (Oracle, Apple-silicon local testing).

## One-time setup

1. **Create the VM.** Smallest tier is plenty (1 vCPU / 512 MB–1 GB RAM). Ubuntu
   24.04 LTS. Note its public IP — that's your dedicated Discord egress IP.

2. **Install Docker** (Ubuntu/Debian):
   ```bash
   curl -fsSL https://get.docker.com | sh
   ```

3. **Get the code + secrets:**
   ```bash
   git clone https://github.com/vivantur/pathway-website.git pathway
   cd pathway
   cp bot.env.example bot.env
   nano bot.env            # paste your Discord + Supabase values
   ```

4. **Start it:**
   ```bash
   docker compose up -d
   docker compose logs -f bot
   ```
   Success looks like `Logged in as <bot>!` and
   `[notifiers/feedback] SUBSCRIBED`. `restart: unless-stopped` keeps it running
   across crashes and reboots.

5. **Register slash commands** (only after changing `deploy.js`, or on first
   deploy). Runs inside the container so it uses the same env:
   ```bash
   docker compose run --rm bot npm run deploy          # global (~1h to propagate)
   docker compose run --rm bot npm run deploy:guild    # instant, needs DEV_GUILD_ID
   ```

## Updating after a code change

```bash
git pull
docker compose up -d --build
```

## Moving hosts (the "never again" part)

If a host ever gets flagged again, migration is minutes, not a re-platform:
spin up a new VM → install Docker → clone → copy your `bot.env` over →
`docker compose up -d`. Same commands, new dedicated IP. Because the bot is
stateless (Supabase holds everything), there's no data to migrate.

## Notes

- **No inbound ports.** The bot only makes outbound connections, so you don't
  need to open any firewall ports or a load balancer.
- **Logs** are capped at 3×10 MB so a long-running container can't fill the disk.
  Tail with `docker compose logs -f bot`; check status with `docker compose ps`.
- **`bot.env` is git-ignored.** Keep it only on the server (and a password
  manager) — it holds the service-role key, which bypasses Supabase RLS.
- **Fly.io alternative:** if you prefer Railway-style `git push` deploys, Fly can
  build this same Dockerfile — but buy a **dedicated IPv4** (`fly ips allocate-v4`,
  ~$2/mo) so you don't reinherit the shared-IP problem.
