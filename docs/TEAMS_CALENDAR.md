# Microsoft Teams diary (advisor profile)

Connect + sync: each advisor links their own Outlook/Teams calendar; Hub bookings create/update Teams meetings.

## 1. Database

Run in Supabase SQL Editor:

- [`supabase/RUN_TEAMS_CALENDAR.sql`](../supabase/RUN_TEAMS_CALENDAR.sql)

Or apply migration `20260713230000_teams_calendar_link.sql`.

## 2. Entra ID app registration

1. [Entra admin centre](https://entra.microsoft.com/) → **App registrations** → **New registration**
2. Name: `Mortgage Hub Teams Diary`
3. Supported accounts: single tenant or multi-tenant (use `common` for multi)
4. Redirect URI (Web):

   ```
   https://your-app-url/api/teams/callback
   ```

   Examples:
   - Production: `https://mymortgagehub.uk/api/teams/callback`
   - Local: `http://localhost:8080/api/teams/callback`
   - Demo tunnel: `https://another-selector-ranged.ngrok-free.dev/api/teams/callback`

   Add **all** URIs you use (Entra allows multiple redirect URIs).

5. **Certificates & secrets** → new client secret
6. **API permissions** (Delegated):
   - `User.Read`
   - `Calendars.ReadWrite`
   - `OnlineMeetings.ReadWrite`
   - `offline_access` (via Microsoft Graph if prompted)
7. Grant admin consent if required by your tenant

## 3. Environment variables

In `.env`:

```bash
TEAMS_CLIENT_ID=...
TEAMS_CLIENT_SECRET=...
TEAMS_TENANT_ID=common   # or your directory (tenant) ID
VITE_APP_URL=https://your-app-url   # must match redirect origin
APP_BASE_URL=https://your-app-url   # production / Azure App Setting
```

### Azure (mymortgagehub.uk)

In **Azure Portal → Mortgagehub-prod → Configuration → Application settings**, set the same three `TEAMS_*` values as on your laptop `.env`, plus:

```
APP_BASE_URL=https://mymortgagehub.uk
VITE_APP_URL=https://mymortgagehub.uk
```

Or add GitHub Actions secrets `TEAMS_CLIENT_ID`, `TEAMS_CLIENT_SECRET`, `TEAMS_TENANT_ID` — the deploy workflow writes them into App Settings.

In Entra, add redirect URI: `https://mymortgagehub.uk/api/teams/callback`.

Restart / redeploy after changing settings.

## 4. Advisor flow

1. Sign in as an advisor
2. Open **Diary**
3. Click **Connect Teams diary**
4. Sign in with Microsoft and consent
5. Book or amend an appointment — a Teams meeting is created/updated on that advisor’s calendar
6. Diary shows **Open Teams meeting** when a join URL is returned

## Behaviour notes

- Sync is **per advisor** (the appointment’s `advisor_id`)
- If Teams is not linked/configured, booking still succeeds (sync is skipped)
- Disconnect clears tokens; appointments remain in Hub
- Amend updates the existing Graph event when `ms_event_id` is set
