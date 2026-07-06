# Self-hosted setup — FactFind & booking

Run this app on **your own server or domain**. No third-party hosting platform is required.

Your code is on GitHub (`main`). Deploy from there to see the latest home page, booking options, and fact-find flows.

---

## Routes

| Route | Purpose |
|-------|---------|
| `/` | Landing — fact-find & booking overview |
| `/auth` | Sign in / sign up |
| `/home` | Verbal, text, or direct booking |
| `/booking` | Book an appointment (logged in) |
| `/interview/:id` | Verbal fact-find |
| `/text/:id` | Text fact-find |
| `/sessions/:id` | Summary + appointment details |
| `/diary` | Advisor appointments |
| `/introducer` | Introducer portal |
| `/book/:slug` | Public booking via referral link |

---

## 1. Clone and install

```bash
git clone https://github.com/pmabbott2-lab/m-abbott-co-uk.git
cd m-abbott-co-uk
git checkout main
npm install
```

---

## 2. Environment variables

Copy `.env.example` to `.env` and fill in values:

```bash
cp .env.example .env
```

Required:

| Variable | Purpose |
|----------|---------|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_PUBLISHABLE_KEY` | Supabase anon/publishable key |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side Supabase access |
| `VITE_SUPABASE_URL` | Same URL for browser |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Same publishable key for browser |
| `OPENAI_API_KEY` | Voice interview AI, STT, TTS |
| `APP_BASE_URL` | Your live site URL, e.g. `https://m-abbott.co.uk` |

Optional (SMS booking texts + voice):

| Variable | Purpose |
|----------|---------|
| `TWILIO_ACCOUNT_SID` | Twilio account |
| `TWILIO_AUTH_TOKEN` | Twilio auth token |
| `TWILIO_MESSAGING_SERVICE_SID` | Outbound SMS via Messaging Service (sender: MortgageHub) |
| `TWILIO_PHONE_NUMBER` | Mobile in Messaging Service pool / voice fallback |
| `TWILIO_VOICE_PHONE_NUMBER` | Landline for CRM calls and inbound voicemail |
| `TWILIO_API_KEY_SID` | API key for browser Voice SDK tokens |
| `TWILIO_API_KEY_SECRET` | API key secret (shown once when created) |
| `TWILIO_TWIML_APP_SID` | TwiML App for browser outbound calls |

---

## 3. Supabase database

In Supabase **SQL Editor**, run migrations in order:

1. `supabase/migrations/20260626220000_introducer_portal.sql`
2. `supabase/migrations/20260626230000_diary_sms_booking.sql`
3. `supabase/migrations/20260626240000_session_channel_and_appointment_rls.sql`

Or with Supabase CLI: `supabase db push`

### User roles

After users sign up, assign roles in SQL:

```sql
-- Advisor (required for diary slots)
INSERT INTO user_roles (user_id, role)
VALUES ('YOUR-USER-UUID', 'advisor');
```

Find UUIDs under **Authentication → Users**.

### Google sign-in

In Supabase **Authentication → Providers → Google**, enable Google and add your site URL to **Redirect URLs**:

```
https://your-domain.com/home
http://localhost:5173/home
```

---

## 4. Run locally

```bash
npm run dev
```

Open http://localhost:5173 — you should see **"Complete your fact-find or book an appointment"** on the landing page, and three options on `/home` after sign-in.

---

## 5. Deploy to production

```bash
npm run build
```

Serve the built app with your host (VPS + Node, Docker, Cloudflare, etc.). The build outputs a Nitro-compatible server entry at `dist/server/server.js`.

Example test after build:

```bash
npm run preview
```

Point your domain DNS at the server and set `APP_BASE_URL` to that domain.

### Using ngrok (e.g. `another-selector-ranged.ngrok-free.dev`)

ngrok only forwards to whatever is running **on your laptop**. It does not read from GitHub automatically.

1. **Pull latest code and restart the dev server:**

   ```bash
   git pull origin main
   npm install
   npm run dev
   ```

2. **Point ngrok at the dev port** (usually 5173):

   ```bash
   ngrok http 5173
   ```

3. **Set in `.env`:**

   ```env
   APP_BASE_URL=https://your-subdomain.ngrok-free.dev
   ```

4. **Add Supabase redirect URLs** (Authentication → URL configuration):

   ```
   https://your-subdomain.ngrok-free.dev/home
   http://localhost:5173/home
   ```

5. **Confirm you have the new build** — the landing page title should be **"Mortgage Fact-Find & Appointment Booking"**, not "Voice Interview" only. If you still see the old title, your local folder has not been updated or the dev server was not restarted after `git pull`.

---

## 6. Verify booking works

| Step | Expected |
|------|----------|
| Visit `/` | Landing mentions fact-find **and** booking |
| Sign in → `/home` | Three cards: Verbal · Text · **Book an appointment** |
| Click **Book an appointment** | Calendar at `/booking` |
| Complete verbal/text fact-find | "Thank you for completing — book an appointment" step |
| View session summary | Appointment details shown if booked |

---

## Default diary hours

First booking request auto-creates **Mon–Fri 9:00–17:00** (30-min slots) for your first advisor. Edit `advisor_availability` in Supabase to change.

---

## Seeing old pages?

If a deployment is showing stale content, it likely hasn't been rebuilt from the latest GitHub `main`. Self-hosting from this repo gives you direct control — every `git pull` + redeploy updates what users see.
