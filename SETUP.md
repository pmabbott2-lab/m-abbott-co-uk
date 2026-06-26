# Setup guide — booking, SMS & introducer portal

The **voice fact-find app is unchanged**. These features are separate routes that sit alongside it.

| Route | Who uses it |
|-------|-------------|
| `/home`, `/interview`, `/sessions` | Customers & advisors (unchanged) |
| `/introducer` | Introducers |
| `/diary` | Advisors (appointments only) |
| `/book/:slug` | Public direct booking |
| `/go/:slug` | Short link → redirects to booking |

---

## Your action checklist

### 1. Pull the latest code on your laptop

```bash
git clone https://github.com/pmabbott2-lab/m-abbott-co-uk.git
cd m-abbott-co-uk
git checkout cursor/diary-sms-booking-4b79
npm install
```

After merge to `main`, use `git pull origin main` instead.

### 2. Run the database migrations in Supabase

Open [Supabase Dashboard](https://supabase.com/dashboard) → your project → **SQL Editor**, and run these files in order:

1. `supabase/migrations/20260626220000_introducer_portal.sql`
2. `supabase/migrations/20260626230000_diary_sms_booking.sql`

Or, if you use the Supabase CLI locally:

```bash
supabase db push
```

### 3. Create user roles

In Supabase SQL Editor, after each person has signed up once:

**Advisor** (needed for diary slots to work):

```sql
INSERT INTO user_roles (user_id, role)
VALUES ('PASTE-ADVISOR-USER-UUID', 'advisor');
```

**Introducer**:

```sql
INSERT INTO user_roles (user_id, role)
VALUES ('PASTE-INTRODUCER-USER-UUID', 'introducer');
```

Find user UUIDs in **Authentication → Users**.

### 4. Set environment variables on your server

Create or update `.env` on whatever hosts the app (VPS, Cloudflare, etc.):

```env
# Existing (required)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_PUBLISHABLE_KEY=your-publishable-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your-publishable-key

# AI (required for voice fact-find — use OpenAI directly if not on Lovable)
LOVABLE_API_KEY=your-key
# OR migrate STT/TTS to OPENAI_API_KEY (see src/lib/openai.server.ts)

# App URL (required for SMS links)
APP_BASE_URL=https://your-domain.com

# Twilio (required for SMS — skip if you only want booking without texts)
TWILIO_ACCOUNT_SID=ACxxxxxxxx
TWILIO_AUTH_TOKEN=your-auth-token
TWILIO_PHONE_NUMBER=+447xxxxxxxxx
```

Never commit `.env` to GitHub.

### 5. Set up Twilio (for SMS)

1. Create account at [twilio.com](https://www.twilio.com)
2. Buy a UK phone number with SMS capability
3. Copy Account SID, Auth Token, and phone number into `.env`
4. Set the **inbound webhook** on your Twilio number to:
   ```
   https://your-domain.com/api/sms/inbound
   ```
   Method: `POST`

### 6. Deploy the app

Build and run on your server:

```bash
npm run build
npm run preview   # test locally first
```

For production, use your hosting provider’s process (PM2, Docker, Cloudflare Workers, etc.).

### 7. Test the flows

| Test | URL / action |
|------|----------------|
| Fact-find (unchanged) | Sign in → `/home` → Start interview |
| Introducer portal | Sign in as introducer → `/introducer` |
| Direct booking | `/book/your-slug` |
| Short link | `/go/your-slug` |
| Advisor diary | Sign in as advisor → `/diary` |
| SMS booking link | Introducer portal → save lead → "Text booking link" |

---

## Default diary hours

On first booking request, the system creates **Mon–Fri 9:00–17:00** slots (30 minutes) for your first advisor. To change hours later, edit the `advisor_availability` table in Supabase.

---

## Backing up to your laptop

```bash
git pull origin main
```

Keep `.env` backed up separately (password manager or secure note). Use Time Machine or iCloud for an extra copy of the project folder.

---

## What was deliberately left unchanged

- Landing page (`/`)
- Customer home & interview flow
- Session creation logic
- Advisor fact-find dashboard on `/home`
- All voice / STT / TTS / AI interview code

New features only add routes and database tables — they do not modify the core fact-find experience.
