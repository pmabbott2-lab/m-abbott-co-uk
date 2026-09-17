# Supabase Auth URLs — Mortgage Hub (MMH)

Update these in the Supabase dashboard (MCP cannot change Auth URL config without a signed-in session):

**Project:** `tiuplmftooauihulhtws`  
**Dashboard:** https://supabase.com/dashboard/project/tiuplmftooauihulhtws/auth/url-configuration

## Required settings

| Field | Value |
|-------|--------|
| **Site URL** | `https://mymortgagehub.uk` |
| **Redirect URLs** | `https://mymortgagehub.uk/**` |
| | `https://mymortgagehub.uk/auth` |
| | `https://mymortgagehub.uk/auth/reset` |
| | `http://localhost:8080/**` (local only) |

Remove any **ngrok** Site URL / redirect entries used for the old Hub tunnel. Keep ngrok only if you still need marketing-site demos that share this Supabase project (prefer not to).

## What these control

| Flow | App sets `redirectTo` / `emailRedirectTo` to | Needs allow-list |
|------|-----------------------------------------------|------------------|
| Password reset | `https://mymortgagehub.uk/auth/reset` | yes |
| Create account / confirm email | `https://mymortgagehub.uk/auth` | yes |
| Staff invite registration | `https://mymortgagehub.uk/auth` | yes |
| Magic / OAuth (if used) | `https://mymortgagehub.uk/auth` | yes |

App code now prefers MMH on Azure and ignores stale ngrok `APP_BASE_URL` / `VITE_APP_URL` values.

## Teams / Outlook (separate from Supabase)

Entra app redirect URI: `https://mymortgagehub.uk/api/teams/callback`  
Azure App Settings: `APP_BASE_URL`, `VITE_APP_URL`, `TEAMS_CLIENT_ID`, `TEAMS_CLIENT_SECRET`, `TEAMS_TENANT_ID`.
