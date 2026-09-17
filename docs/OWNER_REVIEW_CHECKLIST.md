# Owner review checklist — Mortgage Hub (`mymortgagehub.uk`)

Use this after each deploy. Sign in as **pmabbott2@aol.com** (Owner). Compare with ngrok if needed: `https://another-selector-ranged.ngrok-free.dev`.

Baseline: restore point `restore-point-2026-09-15-hub-telephony` + Azure packaging.

---

## 0. Before you start (config)

- [ ] Azure App Settings include `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (no trailing slash on URL)
- [ ] **Critical:** `SUPABASE_SERVICE_ROLE_KEY` must be `sb_secret_…` (or legacy `service_role` JWT) — **never** `sb_publishable_…`. Wrong key → “This endpoint requires a valid Bearer token” on booking confirm, invites, test accounts, SMS admin paths.
- [ ] Prefer also storing the same three Supabase values as GitHub Actions secrets so deploys can re-sync them to Azure
- [ ] `ADMIN_EMAILS=pmabbott2@aol.com`
- [ ] `APP_BASE_URL=https://mymortgagehub.uk` and `VITE_APP_URL=https://mymortgagehub.uk`
- [ ] Teams: `TEAMS_CLIENT_ID`, `TEAMS_CLIENT_SECRET`, `TEAMS_TENANT_ID` (same as laptop `.env`)
- [ ] Entra redirect URI includes `https://mymortgagehub.uk/api/teams/callback`
- [ ] Supabase Auth Site URL / redirect URLs include `https://mymortgagehub.uk/**`
- [ ] Twilio webhooks point at `mymortgagehub.uk` (not ngrok) if testing live voice/SMS

---

## 1. Sign-in & owner shell

- [ ] Password sign-in works (MFA currently suspended for testing)
- [ ] Home shows **Admin dashboard** (not customer / introducer-only)
- [ ] Top branches visible: **Customers · Diary · Management · Marketing · Finance**
- [ ] No top-level **Introducers** tab (owner uses Management → View instead)
- [ ] No **My commission** under Finance (that is advisor-only)

---

## 2. Customers

- [ ] Customers list loads (allocated / unallocated filters)
- [ ] Open a customer → profile, journey, finance, relationship sections as designed
- [ ] Soft-delete / restore customer (Recently deleted) if you use that flow
- [ ] Contact history visible; owner amend/delete on contact-log rows
- [ ] Introducer on case: amend + refresh commission (owner)

---

## 3. Diary

- [ ] **My diary** and **All appointments** both available
- [ ] Create / amend appointment
- [ ] **Microsoft Teams diary** card: shows **Connect** (not “not configured”)
- [ ] Connect Teams → returns to Hub linked; book appointment → Teams meeting / join link
- [ ] Disconnect Teams clears link without deleting Hub appointments

---

## 4. Management

- [ ] **Analytics** loads
- [ ] **Advisor commission** summary
- [ ] **View** → Advisor / Introducer / Customer view-as (and audit if enabled)
- [ ] **Manage** → invites, team roles, telephony
- [ ] **Admin access** → owner can see levels (Owner / Supervisor / General) and permission matrix
- [ ] Provision / reset **test accounts** (`1@`–`13@test.co.uk`) if you use them

### Telephony (Manage)

- [ ] Allocate / reallocate numbers
- [ ] Softphone dial from browser
- [ ] Missed call → Hub Susan voicemail (not carrier VM)
- [ ] AMD / routing rules behave as configured

---

## 5. Marketing

- [ ] Refer-a-friend admin / RAF tools load
- [ ] Customer RAF claim path still works end-to-end (optional smoke)

---

## 6. Finance

- [ ] **Commission management** (advisor / introducer / RAF payouts) visible
- [ ] **Finance report** visible (owner-only)
- [ ] Export / sheet downloads if you use them
- [ ] Customer-level finance fees editable where permitted

---

## 7. Role-specific profiles (test accounts)

Sign in (or View-as) and confirm each matches original design:

| Account | Expect |
|---------|--------|
| `1@`–`3@test.co.uk` | Introducer portal / introducer branch |
| `4@`–`5@test.co.uk` | Advisor: customers + own diary + **My commission** — no Management |
| `6@`–`12@test.co.uk` | Customer home / fact-find |
| `13@test.co.uk` | General admin — limited by permission matrix |
| `pmabbott2@aol.com` | Full owner (section 1) |

---

## 8. Core customer journeys

- [ ] Start voice fact-find (Susan / TTS)
- [ ] Start chat fact-find
- [ ] Submit interview → appears for advisor/admin
- [ ] Booking / callback request from customer side
- [ ] SMS outbound / inbound (if Twilio live on this domain)

---

## 9. Integrations smoke

- [ ] Supabase auth session persists refresh
- [ ] Address lookup (getAddress) on profile / interview if keyed
- [ ] OpenAI interview features (summaries / STT) if keyed
- [ ] Simli realtime avatar only if `VITE_REALTIME_AVATAR=true` (optional)
- [ ] MortgageEasy / marketing links to Hub auth on production domain

---

## 10. After review

- [ ] Re-enable login MFA when ready (`TEMP_SUSPEND_LOGIN_MFA` / `SKIP_LOGIN_MFA`)
- [ ] Confirm ngrok is only for laptop compare, not customer-facing
- [ ] Note any gaps vs restore point in a short list for the next fix pass
