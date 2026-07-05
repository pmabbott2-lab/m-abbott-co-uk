# Stable site (Mac + ngrok)

## One-time setup (already done)

Project lives at **`~/Projects/m-abbott-co-uk-main`** (moved out of Downloads so macOS can keep it running).

Auto-restart service installed: checks every 30 seconds and restarts app + ngrok if either drops.

## Your URLs

| URL | Purpose |
|-----|---------|
| https://another-selector-ranged.ngrok-free.dev | Public (click **Visit Site** on ngrok warning once) |
| http://localhost:8080 | Production preview on this Mac |

## Daily commands

```bash
cd ~/Projects/m-abbott-co-uk-main

# Check status
npm run status:site

# After code changes — rebuild and refresh the live ngrok site
npm run refresh:site

# Local hot-reload while coding (port 8081, does not affect public site)
npm run dev:local

# Stop everything
npm run stop:site
```

## Why it dropped before

1. **Dev server (`npm run dev`)** — meant for coding; stops when Cursor/Terminal closes.
2. **Project in Downloads** — macOS blocks background auto-restart there.
3. **Tonight's restarts** — killed the old long-running processes that had been stable since 30 June.

## Now

- **Public site** = production build via `vite preview` (stable).
- **Keep-alive** = `~/bin/mortgage-hub-watch.sh` via LaunchAgent.
- **Sleep prevention** = `caffeinate` while watch runs.

Keep Mac **plugged in** and avoid **Force Quit** on Terminal if you start manually.

Logs: `/tmp/m-abbott-site/`
