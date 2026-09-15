# Deploy Mortgage Hub → `mymortgagehub.uk`

Move the Hub off ngrok onto your own domain, running **independently of your laptop**.  
Cursor development on the Mac stays the same (`npm run dev` / localhost).

| Role | URL |
|------|-----|
| Live Hub (production) | `https://mymortgagehub.uk` |
| Local development | `http://localhost:8080` or `http://localhost:5173` |
| Old demo tunnel (retire after cutover) | `https://another-selector-ranged.ngrok-free.dev` |

Brand sites (Mortgage Easy, Trent Valley) keep their own domains later and link into Hub for sign-in / journeys.

---

## What you need

1. Domain **mymortgagehub.uk** (you have this).
2. A small always-on Linux VPS (1–2 GB RAM is enough to start) — Hetzner, DigitalOcean, Lightsail, etc.
3. SSH access to that server.
4. Your GitHub repo access on the server.
5. The same secrets you use locally (Supabase, OpenAI, Twilio, etc.) — stored in a **server** `.env`, never committed.

---

## One-time server setup

### 1. Create the VPS

- Ubuntu 22.04 or 24.04.
- Open ports **22** (SSH), **80**, **443**.
- Note the server’s public IP.

### 2. Point DNS

At your domain registrar for `mymortgagehub.uk`:

| Type | Name | Value |
|------|------|--------|
| A | `@` | *your VPS IP* |
| A | `www` | *your VPS IP* (optional but recommended) |

Wait until `ping mymortgagehub.uk` (or a DNS checker) shows the new IP.

### 3. Install Node + Caddy on the server

SSH in, then:

```bash
# Node 22 (LTS-style current)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs git

# Caddy = HTTPS reverse proxy (auto Let’s Encrypt)
sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt-get update
sudo apt-get install -y caddy
```

### 4. Clone the app

```bash
sudo mkdir -p /var/www
sudo chown "$USER":"$USER" /var/www
cd /var/www
git clone https://github.com/pmabbott2-lab/m-abbott-co-uk.git mymortgagehub
cd mymortgagehub
# Use the branch you want live (targeted-features or main)
git checkout targeted-features
npm install
```

### 5. Create production `.env` on the server

```bash
cp .env.example .env
nano .env   # or scp your laptop .env and edit URLs only
```

**Must set for production:**

```env
APP_BASE_URL=https://mymortgagehub.uk
VITE_APP_URL=https://mymortgagehub.uk
```

Keep all Supabase / OpenAI / Twilio / Azure keys as on your Mac.  
Do **not** point the laptop `.env` at the production domain while you still use ngrok for demos.

### 6. First build + run as a service

```bash
cd /var/www/mymortgagehub
npm run build

# Install systemd unit (from this repo)
sudo cp deploy/mymortgagehub.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now mymortgagehub
sudo systemctl status mymortgagehub
```

App listens on **127.0.0.1:8080**. Caddy will expose it on HTTPS.

### 7. Caddy (HTTPS)

```bash
sudo cp deploy/mymortgagehub.caddy /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Visit: `https://mymortgagehub.uk/auth`

---

## External services (one-time)

### Supabase Auth

**Authentication → URL configuration**

- Site URL: `https://mymortgagehub.uk`
- Redirect URLs (add, keep localhost for Cursor):
  - `https://mymortgagehub.uk/**`
  - `https://mymortgagehub.uk/home`
  - `http://localhost:8080/**`
  - `http://localhost:5173/**`

### Twilio (if SMS / voice enabled)

Point webhooks / TwiML app voice URL at:

`https://mymortgagehub.uk/...`  
(same paths you used with ngrok — run `npm run configure:twilio-voice` **on the server** after `.env` is correct, or update in the Twilio console).

### Teams calendar (if used)

Redirect URI: `https://mymortgagehub.uk/api/teams/callback`

---

## Everyday deploy (after you change code in Cursor)

On your Mac: commit / push as usual.

On the server:

```bash
cd /var/www/mymortgagehub
bash scripts/deploy-mymortgagehub.sh
```

That script: `git pull` → `npm install` → `npm run build` → restart the service.

Cursor workflow does **not** change. Local preview stays local. Production only updates when you run deploy on the server (or later via GitHub Action).

---

## Cut over from ngrok

When `https://mymortgagehub.uk/auth` works and you can sign in:

1. Update any Mortgage Easy / Trent Valley “Start” links to `https://mymortgagehub.uk`.
2. On the Mac: `npm run stop:site` (stops ngrok + local public preview).
3. Keep using Cursor + `npm run dev` / `npm run dev:local` for development.

---

## Checks

| Check | Expect |
|-------|--------|
| `https://mymortgagehub.uk/auth` | Sign-in page |
| `sudo systemctl status mymortgagehub` | `active (running)` |
| `sudo journalctl -u mymortgagehub -n 50` | No crash loop |
| Laptop asleep | Hub still loads |

---

## Files in this repo

| File | Purpose |
|------|---------|
| `docs/DEPLOY_MYMORTGAGEHUB.md` | This checklist |
| `scripts/deploy-mymortgagehub.sh` | Pull + build + restart on the server |
| `deploy/mymortgagehub.service` | systemd unit |
| `deploy/mymortgagehub.caddy` | Caddy HTTPS config |

---

## Troubleshooting

- **502 Bad Gateway** — Hub service not running; check `systemctl status mymortgagehub`.
- **Old UI after deploy** — hard refresh; confirm `deploy-mymortgagehub.sh` finished `build` without errors.
- **Auth redirect fails** — Supabase redirect URL missing `mymortgagehub.uk`.
- **SMS / voice broken** — Twilio still pointing at ngrok; update webhooks.
- **Laptop `.env` vs server `.env`** — they are separate. Local can stay on localhost or ngrok until you retire the tunnel.
