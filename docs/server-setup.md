# Running the Pathway bot on your own Ubuntu server

The bot must run from an IP that Discord hasn't Cloudflare-banned. Railway's
shared egress IPs are banned (see the root `CLAUDE.md` deploy notes), so we host
the bot on a machine we control. This runbook is written to be **replicable** —
follow the same steps on any bigger box later.

**Key fact that simplifies everything:** the bot only *dials out* to Discord and
Supabase. It needs **no inbound ports** and **no static public IP**. A normal
residential/office connection is a clean, un-banned IP, which is all Discord
cares about. The "static IP" below is a static **LAN** address so the server is
reachable at a known spot on your network — not a public one.

Assumes Ubuntu Server 22.04/24.04 with sudo.

---

## 1. Static LAN IP (netplan)

Find your interface name and current gateway:

```bash
ip -brief link          # interface name, e.g. eth0 / ens18 / enp3s0
ip route | grep default # your gateway, e.g. "default via 192.168.1.1"
```

Edit the netplan file (name varies, e.g. `/etc/netplan/00-installer-config.yaml`):

```bash
sudo nano /etc/netplan/*.yaml
```

```yaml
network:
  version: 2
  ethernets:
    eth0:                     # <- your interface
      dhcp4: no
      addresses: [192.168.1.50/24]   # <- pick a free address in your subnet
      routes:
        - to: default
          via: 192.168.1.1           # <- your gateway
      nameservers:
        addresses: [1.1.1.1, 8.8.8.8]
```

Apply (do this at the physical console or over a session you can recover, since
the IP changes):

```bash
sudo netplan apply
```

> Tip: also reserve this IP as a **DHCP reservation** in your router so nothing
> else grabs it.

---

## 2. Remote access

### SSH (LAN)

```bash
sudo apt update && sudo apt install -y openssh-server
sudo systemctl enable --now ssh
```

Use **key-based auth** and turn off passwords. From your laptop:

```bash
ssh-copy-id youruser@192.168.1.50      # once, to install your public key
```

Then on the server, in `/etc/ssh/sshd_config` set `PasswordAuthentication no`
and `sudo systemctl restart ssh`.

### Remote from anywhere — Tailscale (recommended)

Instead of forwarding SSH through your router (fragile, exposes SSH to the
internet, breaks under CGNAT), use Tailscale — a private mesh VPN. You get a
stable address for the box that works from anywhere, with nothing exposed
publicly.

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
```

SSH to the server's Tailscale IP from any device also on your tailnet. This is
the piece that makes the setup portable — the box keeps the same Tailscale
address on any network.

---

## 3. Node.js 22.x

The repo pins Node ≥ 22.12. Install system-wide via NodeSource so systemd finds
`/usr/bin/node`:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs git
node --version   # v22.x
```

---

## 4. Get the bot and configure it

Create a dedicated service user and install under `/opt/pathway`:

```bash
sudo useradd --system --create-home --home-dir /opt/pathway --shell /usr/sbin/nologin pathway
sudo -u pathway git clone https://github.com/vivantur/Pathway.git /opt/pathway
cd /opt/pathway
sudo -u pathway git checkout release/post-ban-clean   # (or main, once merged)
sudo -u pathway npm install                            # root install; builds packages/core
```

Create `/opt/pathway/apps/bot/.env` (secrets — keep it locked down):

```bash
sudo -u pathway tee /opt/pathway/apps/bot/.env >/dev/null <<'EOF'
TOKEN=<PROD bot token — copy from Railway's service Variables>
CLIENT_ID=<prod application id>
BOT_OWNER_ID=<your discord user id>
SUPABASE_URL=<prod Supabase URL>
SUPABASE_SERVICE_ROLE_KEY=<prod Supabase service-role key>
EOF
sudo chmod 600 /opt/pathway/apps/bot/.env
```

Notes:
- Use the **prod** bot token so this becomes the real "Pathway" bot again (not
  the test app). Point it at the **prod** Supabase (same data your test bot uses).
- **Slash commands are already registered** for the prod app, and `deploy.js`
  didn't change, so you do **not** need to re-run a command deploy. (Only run
  `npm run deploy` / `deploy:guild` if you later edit `deploy.js`.)

---

## 5. Run it as a service

```bash
sudo cp /opt/pathway/deploy/pathway-bot.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now pathway-bot
```

Watch it come up:

```bash
journalctl -u pathway-bot -f
```

You want to see the net-probe report **`HTTP 200`** (clean IP), then
`Logged in as <bot>#…!`. If the probe ever shows `HTTP 429`, that IP is banned —
which shouldn't happen on a residential IP, but if it does, that's your signal.

`enable` makes it start on boot; `Restart=on-failure` brings it back after a
crash.

---

## 6. Cutover checklist

Only **one** bot instance may be in the friend server, or every command gets two
replies:

- [ ] Railway deployment removed / stopped (already done).
- [ ] Server bot (prod token) is up and responding in the friend server.
- [ ] **Stop the test bot** (and/or remove the test app from the friend server)
      so it isn't double-answering.

---

## 7. Deploy an update later

```bash
cd /opt/pathway
sudo -u pathway git pull
sudo -u pathway npm install          # only strictly needed if deps changed
sudo systemctl restart pathway-bot
journalctl -u pathway-bot -f
```

---

## 8. Optional hardening

```bash
# Firewall: allow SSH only; the bot needs no inbound ports.
sudo apt install -y ufw
sudo ufw allow OpenSSH
sudo ufw enable

# Automatic security updates.
sudo apt install -y unattended-upgrades
sudo dpkg-reconfigure -plow unattended-upgrades
```

---

## Replicating to a bigger machine

Sections 2–8 are the whole recipe and are hardware-independent: install Node,
clone, `.env`, drop in the systemd unit, `enable --now`. Only section 1 (the LAN
IP) is network-specific. Tailscale (section 2) keeps remote access identical
across machines.
