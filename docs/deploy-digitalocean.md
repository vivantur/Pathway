# Hosting the Pathway bot on DigitalOcean (beginner guide)

A step-by-step, click-by-click walkthrough. No prior server experience needed —
you'll use a terminal that runs **inside your web browser**, so there's nothing
to install on your own computer.

Total time: ~20 minutes. Cost: **$6/month** (DigitalOcean usually gives new
accounts free credit that covers the first months).

> **Why this fixes the Railway problem:** a DigitalOcean "Droplet" is your own
> private server with its own dedicated IP address that nobody else uses — so
> Discord can't rate-limit you for a stranger's behavior.

---

## Before you start — grab your secrets

The bot needs 5 values. You **already have all of them in Railway** — open your
Railway project → **Variables** tab and keep it open; you'll copy from there:

| Value | Where it is in Railway |
|-------|------------------------|
| `DISCORD_TOKEN` | `TOKEN` or `DISCORD_TOKEN` |
| `CLIENT_ID` | `CLIENT_ID` |
| `BOT_OWNER_ID` | `BOT_OWNER_ID` |
| `SUPABASE_URL` | `SUPABASE_URL` |
| `SUPABASE_SERVICE_KEY` | `SUPABASE_SERVICE_KEY` |

(Optional: `FEEDBACK_CHANNEL_ID` for the Contact-form notifications.)

---

## Part 1 — Create the server (all clicking, no typing)

1. Sign up at **[digitalocean.com](https://www.digitalocean.com)**.
2. Top-right **Create → Droplets**.
   ⚠️ Choose **Droplets**, *not* "Apps" — Apps share IPs like Railway did.
3. **Region:** pick a US one (e.g. **New York**).
4. **Choose an image:** click the **Marketplace** tab, search **Docker**, and
   pick **"Docker on Ubuntu"**. (This comes with everything preinstalled, so you
   skip all the setup.)
5. **Size:** Basic → Regular → the **$6/mo** option (1 GB RAM / 1 vCPU / 25 GB).
   Don't pick the $4 one — the first build needs a little more memory.
6. **Authentication:** choose **Password**, set a strong root password, and save
   it in your password manager. (Simpler than SSH keys.)
7. **Hostname:** type `pathway-bot`.
8. Click **Create Droplet**. Wait ~1 minute. When it's ready, **copy the public
   IP address** shown — that's your bot's new dedicated IP.

## Part 2 — Open the browser terminal

9. On your droplet's page, click **Console** (the `>_` icon, top-right — "Launch
   Droplet Console"). A black terminal opens **in your browser**.
10. If it asks, log in as user `root` with the password from step 6.

## Part 3 — Start the bot (copy-paste these one at a time)

11. Download the code:
    ```bash
    git clone https://github.com/vivantur/Pathway.git
    cd Pathway
    ```
12. Create your secrets file and open it:
    ```bash
    cp bot.env.example bot.env
    nano bot.env
    ```
13. In the editor, fill in each value after the `=` (copy from Railway). Then:
    - Save: press **Ctrl+O**, then **Enter**
    - Exit: press **Ctrl+X**
14. Build and start it (first build takes a few minutes — that's normal):
    ```bash
    docker compose up -d --build
    ```
15. Watch it come online:
    ```bash
    docker compose logs -f bot
    ```
    Success looks like **`Logged in as <your bot>!`** and
    **`[notifiers/feedback] SUBSCRIBED`**. Press **Ctrl+C** to stop watching
    (this does **not** stop the bot).

## Part 4 — ⚠️ Turn off the other copy

A Discord bot token can only run in **one** place at a time. Before you rely on
the droplet:

- **Stop your friend's local copy** (close it / Ctrl+C in their terminal), and
- **Pause or delete the Railway service** (Railway dashboard → your service →
  Settings → **Remove**), or at least stop it.

If two copies run at once they'll fight and the bot goes flaky.

*(Your slash commands live on Discord's side, not the host, so they keep working
after the move — no need to re-register them.)*

---

## Everyday commands

Reopen the **Console** anytime and:

```bash
cd Pathway

docker compose ps            # is it running?
docker compose logs -f bot   # watch live logs (Ctrl+C to exit)
docker compose restart       # restart the bot
git pull && docker compose up -d --build   # update after a code change
```

The bot **auto-restarts** on crashes and reboots — you don't have to babysit it.

## If something goes wrong

- **`docker compose: command not found`** → your image is older; use
  `docker-compose` (with a hyphen) instead.
- **Bot logs show a Discord token error** → re-check `nano bot.env`; the
  `DISCORD_TOKEN` line must match Railway exactly (no spaces, no quotes).
- **Nothing in the logs / "unhealthy"** → run `docker compose logs bot` (without
  `-f`) and send me the last ~20 lines.

## Moving hosts later (peace of mind)

If any host ever gets flagged again, migration is minutes: make a new Droplet,
open its Console, and run the Part 3 commands (copy your `bot.env` over). Nothing
is stored on the server — Supabase holds all the data.
