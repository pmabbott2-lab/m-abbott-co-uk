# Mortgage Hub — Twilio Multi-Tenant Architecture

**Status:** Design / audit only · **G2 NOT STARTED** · **ZERO runtime behaviour changed**  
**Date:** 2026-09-17  
**Baseline:** `pre-g2-clean-baseline` @ `b725819`  
**Scope:** READ-ONLY code + live schema inventory · proposed tenant communications model

**Do not implement from this document until explicitly authorised.**  
**Do not provision Twilio subaccounts, purchase/release numbers, or change webhooks from this gate.**

Business decision locked for design:

```
Mortgage Hub master Twilio account
  └── one Twilio subaccount per communications-enabled tenant (GROUP and EXTERNAL)
        ├── company landline
        ├── adviser / mobile numbers
        ├── SMS
        ├── voice / voicemail / routing
        └── usage attribution
```

External companies do **not** bring their own Twilio account by default.  
Mortgage Hub owns and manages the Twilio estate. Alternative models may be supported later; not required for initial implementation.

**Preservation mandate:** tenantise the **existing working** communications engine — do not rewrite it.

---

## 1. Current architecture summary

Mortgage Hub today is a **single Twilio account / single firm telephony estate** wired through **server-only environment variables**, with a working **DB-backed telephony control panel** for number inventory, adviser allocation, business hours, and voicemail routing brand.

| Layer | Current behaviour |
|-------|-------------------|
| Credentials | Global `TWILIO_*` env (Azure App Settings / `.env`) — **not** in Supabase tables |
| SMS | REST Messages API via **one** Messaging Service SID; alphanumeric sender label `MortgageHub` |
| Voice outbound | Browser softphone (`@twilio/voice-sdk`) + Access Token + one TwiML App → dial with firm landline caller ID |
| Voice inbound | One firm landline webhook → routing engine → softphone / mobiles / personal reroute / Susan voicemail |
| Number inventory | `telephony_numbers` (+ optional `twilio_sid` column, currently often empty) |
| Adviser allocation | `advisor_telephony` + allocate/unallocate mobiles (Owner-only Manage UI) |
| Routing settings | **Singleton** `telephony_routing_settings` (`id = 1`) including `voice_brand` |
| Logging | `sms_messages`, `phone_calls` (recordings/transcripts/AI), `callback_requests` |
| Tenant awareness | Nullable `tenant_id` columns exist (G1) but **all live telephony rows remain NULL**; no subaccount map |
| Feature catalogue | `telephone_voice`, `sms_notifications`, `request_callback` seeded; **not enforced** on live routes yet |

Live post-purge inventory (masked):

| Resource | State |
|----------|--------|
| Firm landline | 1 active · `is_firm_inbound=true` · E.164 ends `…2912` · `tenant_id` NULL |
| Agent mobile | 1 active · allocated · E.164 ends `…5627` · `tenant_id` NULL |
| `advisor_telephony` | 1 row (Owner) · softphone on · allocated-mobile ring off · personal mobile on |
| Routing | `voice_brand=mortgage_easy` · Europe/London · OOH/no-answer → personal reroute · unowned → fallback user |
| Env echo in UI | Control panel surfaces landline/mobile **from env** as reference |

Interpretation: the working estate is **Mortgage Easy / Hub-global**, not yet split for Trent Valley (002). `voice_brand` already admits `trent_valley` scripts, but settings remain a single global row.

---

## 2. Code / file inventory

### Core server libraries

| Path | Purpose |
|------|---------|
| `src/lib/sms.server.ts` | Twilio credentials helpers, `sendSms`, UK normalisation, SMS templates/copy, journey + interview completion SMS |
| `src/lib/voice.server.ts` | Voice config, Twilio SDK client, TwiML builders, brand greeting scripts, Susan Play URL signing |
| `src/lib/voice-token.server.ts` | Browser Voice Access Tokens (API Key + TwiML App) |
| `src/lib/telephony-routing.server.ts` | Inbound routing decisions, business hours, dial targets, inbound TwiML |
| `src/lib/telephony-manage.functions.ts` | Owner control panel: numbers, allocate, provision clone, routing settings |
| `src/lib/telephony.functions.ts` | Softphone token, prepare/attach/finalize browser calls, voicemail list, GDPR export hooks |
| `src/lib/inbound-voicemail.server.ts` | Caller → session/advisor resolution for inbound |
| `src/lib/phone-lookup.server.ts` | Phone → session lookup |
| `src/lib/phone-call-recording.server.ts` | Download/persist Twilio recordings |
| `src/lib/call-ai.server.ts` | Transcript/summary pipeline using Twilio media credentials |
| `src/lib/comms.server.ts` | SMS/email templates + regulatory footers (used by SMS send) |
| `src/lib/auth-sms.store.server.ts` | Login SMS code storage |
| `src/lib/phone.ts` | Client-safe phone normalisation (no secrets) |

### SMS / booking / auth callers

| Path | Purpose |
|------|---------|
| `src/lib/booking.functions.ts` | Appointment confirmation SMS, callback confirmation SMS, booking invites, staff/introducer booking SMS |
| `src/lib/sessions.functions.ts` | Interview complete + journey milestone SMS |
| `src/routes/api/interview-step.ts` | Interview complete SMS on step completion |
| `src/lib/auth.functions.ts` | SMS login / verification codes |
| `src/lib/referrals.functions.ts` | Referral invite / reward SMS |
| `src/components/customer/CustomerHomeLanding.tsx` | “Text me the link” |
| `src/routes/_authenticated/home.tsx` | Same customer SMS link pattern |
| UI booking cards | Pass `sendSms` flags into booking server fns |

### Twilio HTTP routes (webhooks / TwiML)

| Path | Purpose |
|------|---------|
| `src/routes/api/sms/inbound.ts` | Inbound SMS log + auto-reply TwiML |
| `src/routes/api/twilio/voice/inbound.ts` | Firm landline inbound entry |
| `src/routes/api/twilio/voice/inbound-dial-done.ts` | Post-dial / no-answer continuation |
| `src/routes/api/twilio/voice/client-outbound.ts` | Softphone outbound TwiML |
| `src/routes/api/twilio/voice/status.ts` | Call status callback |
| `src/routes/api/twilio/voice/recording.ts` | Recording status callback |
| `src/routes/api/twilio/voice/voicemail-done.ts` | After Record action |
| `src/routes/api/twilio/voice/amd-status.ts` | Answering-machine detection callback |
| `src/routes/api/twilio/voice/susan-prompt.ts` | Signed TTS audio for voicemail greeting |

### Softphone UI

| Path | Purpose |
|------|---------|
| `src/hooks/useTwilioSoftphone.ts` | `@twilio/voice-sdk` Device lifecycle |
| `src/components/BrowserSoftphone.tsx` | Softphone UI |
| `src/components/TelephonyManagePanel.tsx` | Owner Manage → Telephony |
| `src/components/PhoneCallDetailDialog.tsx` | Call detail / recording playback UI |

### Ops scripts (not runtime request path)

| Path | Purpose |
|------|---------|
| `scripts/configure-twilio-voice.mjs` | Configure landline VoiceUrl, TwiML App, API Key, Messaging Service hooks |
| `scripts/backfill-twilio-voicemails.mjs` | Historical voicemail backfill |
| `scripts/backfill-call-transcripts.mjs` | Historical transcript backfill |
| `scripts/fix-env-app-base-url.mjs` | Env hygiene helper |

### Schema sources

| Path | Purpose |
|------|---------|
| `supabase/RUN_TELEPHONY_CONTROL.sql` | `telephony_numbers`, `advisor_telephony`, `telephony_routing_settings` + RLS |
| `supabase/migrations/20260706140000_phone_calls.sql` | `phone_calls` |
| `supabase/migrations/20260626230000_diary_sms_booking.sql` | Diary/SMS booking era tables |
| G1 migrations | Nullable `tenant_id` on telephony/SMS/call tables |
| G1A migration | Feature catalogue keys including voice/SMS/callback |

### Packages

- `twilio` (server JWT / REST helper)
- `@twilio/voice-sdk` (browser softphone only)

---

## 3. Environment variable **NAMES** (no values)

Server / Azure App Settings (secrets — never `VITE_*`):

| Name | Role |
|------|------|
| `TWILIO_ACCOUNT_SID` | Master Account SID |
| `TWILIO_AUTH_TOKEN` | Master Auth Token |
| `TWILIO_MESSAGING_SERVICE_SID` | Outbound SMS Messaging Service |
| `TWILIO_PHONE_NUMBER` | Mobile / Messaging pool / voice fallback |
| `TWILIO_VOICE_PHONE_NUMBER` | Firm landline caller ID + inbound |
| `TWILIO_SMS_SENDER_LABEL` | Optional override (default `MortgageHub`) |
| `TWILIO_API_KEY_SID` | Voice Access Token signing |
| `TWILIO_API_KEY_SECRET` | Voice Access Token signing |
| `TWILIO_TWIML_APP_SID` | Softphone TwiML App |
| `APP_BASE_URL` | Public webhook base (also `VITE_APP_URL` / `APP_URL` fallbacks) |
| `AZURE_SPEECH_KEY` / `AZURE_SPEECH_REGION` | Susan voicemail TTS (not Twilio secret) |

**Client exposure check:** no `VITE_TWILIO_*` usage found. Softphone receives **short-lived Access Tokens** from authenticated server functions only.

Related public URL helpers may use `VITE_APP_URL` for links in SMS bodies — that is not a Twilio credential.

---

## 4. Current communication flows

### 4.1 Outbound SMS

```
Trigger (booking / auth / journey / referral / UI)
  → server function
  → sendSms()
  → Twilio REST Messages.json
       AccountSid = TWILIO_ACCOUNT_SID
       MessagingServiceSid = TWILIO_MESSAGING_SERVICE_SID
  → recipient
  → optional insert sms_messages (twilio_sid, from=sender label, to, body)
```

**Observed SMS triggers (code-present):**

| Trigger | Location |
|---------|----------|
| Appointment confirmation | `booking.functions.ts` |
| Callback confirmation | `booking.functions.ts` |
| Booking / text-channel invite (introducer/staff) | `booking.functions.ts` |
| Appointment signup login code (passwordless path) | `booking.functions.ts` |
| SMS login / verify code | `auth.functions.ts` |
| Interview / fact-find complete | `sms.server.ts`, `sessions.functions.ts`, `interview-step.ts` |
| Journey milestones (AIP, offer, completion, …) | `sendJourneyMilestoneSms` |
| Referral friend / referrer SMS | `referrals.functions.ts` |
| Customer “Text me the link” | home / CustomerHomeLanding → booking/session helpers |
| Inbound SMS auto-reply | `api/sms/inbound.ts` (TwiML `<Message>`) |

Templates hard-code `company_name: "MortgageEasy"` / sender brand `MortgageHub` in several helpers — **Mortgage Easy assumption**.

**Not found as first-class dedicated paths:** separate “Teams meeting SMS” product feature beyond booking flows that may include meeting URLs when Teams is linked; treat Teams+SMS as booking-path regression, not a separate Twilio module.

### 4.2 Inbound SMS

```
Customer SMS → Twilio number / Messaging Service
  → POST /api/sms/inbound
  → insert sms_messages
  → TwiML auto-reply (book link)
```

No signature validation today. No tenant resolution. No status/delivery callback route found in app code (delivery relies on Twilio defaults / Messaging Service unless configured outside repo).

### 4.3 Inbound call

```
Customer dials firm landline (env / telephony_numbers firm inbound)
  → Twilio VoiceUrl → POST/GET /api/twilio/voice/inbound
  → buildInboundTwiml(From)
       load telephony_routing_settings (id=1)
       lookup caller → session → adviser
       business hours / Outlook / Hub diary busy
       ring softphone client:{userId} and/or mobiles
       OR personal reroute
       OR Susan voicemail (Play + Record)
  → status / recording / dial-done / amd callbacks
  → phone_calls (+ AI transcript pipeline)
```

Inbound does **not** currently key off `To` number for multi-tenant resolution (single expected landline).

### 4.4 Outbound call (browser softphone)

```
Adviser (staff auth)
  → prepareBrowserCall (phone_calls row, caller ID = getTwilioVoiceNumber())
  → getVoiceAccessToken (identity = userId)
  → Device.connect → Twilio TwiML App
  → /api/twilio/voice/client-outbound
  → Dial customer with firm landline callerId + dual-channel record
  → recording/status callbacks → phone_calls / AI
```

Caller ID is the **global voice number**, not the adviser’s allocated mobile (allocation is primarily for **inbound ring** behaviour).

### 4.5 Adviser / mobile allocation (preserve)

```
Owner (isOwner)
  → Manage → Telephony (TelephonyManagePanel)
  → addTelephonyMobileNumber  (DB insert of E.164 — does NOT purchase via Twilio API)
  → allocateTelephonyNumber / provisionAdvisorTelephony / updateAdvisorTelephony
  → telephony_numbers.allocated_user_id + advisor_telephony profile
  → inbound routing uses allocated mobile / softphone / personal reroute flags
```

Constraints today: one active firm landline globally; one active mobile per adviser; Owner-only mutations; staff can read.

---

## 5. Data model (telephony-related)

| Table | Important columns | tenant_id | Structural / transactional | Twilio IDs | Credentials |
|-------|-------------------|-----------|----------------------------|------------|-------------|
| `telephony_numbers` | `e164`, `kind`, `label`, `twilio_sid`, `is_firm_inbound`, `allocated_user_id`, `active` | nullable, live NULL | Structural inventory | optional PN SID | **No** |
| `advisor_telephony` | ring flags, `allocated_mobile_number_id`, `personal_reroute_e164`, `enabled` | nullable | Structural | No | **No** (personal number is PII) |
| `telephony_routing_settings` | singleton `id=1`, hours, actions, `voice_brand`, `fallback_user_id` | nullable | Structural (must become per-tenant) | No | **No** |
| `sms_messages` | direction, from/to, body, `twilio_sid`, appointment/lead links | nullable | Transactional | Message SID | **No** (body may be sensitive) |
| `phone_calls` | SIDs, numbers, status, recording_url, transcript, summary, AI | nullable | Transactional | Call/Recording SIDs | recording URLs need auth to fetch |
| `callback_requests` | windows, customer phone, status, optional `phone_call_id` | nullable | Transactional | No | **No** |
| `tenant_comms_config` | footers / from_name | **keyed by tenant** | Structural branding | No | **No** |
| `communication_templates` | SMS template bodies | nullable | Structural | No | **No** |
| `communication_settings` | global/legacy comms | nullable | Structural | No | **No** |

**RLS (current):** staff SELECT on telephony tables / SMS / calls / callbacks; mutations via **service role** server functions (Owner checks in app). Policies are **not** tenant-scoped yet.

**Unique indexes to revisit for multi-tenant:**  
- one firm landline **globally** → must become **one per tenant**  
- one allocated mobile per user remains OK if numbers are tenant-scoped

---

## 6. Single-account / global assumptions

| Assumption | Where | Classification |
|------------|-------|----------------|
| One `TWILIO_ACCOUNT_SID` / Auth Token | `sms.server.ts`, `voice*.ts`, scripts | **TENANTISE** (master + subaccounts) |
| One Messaging Service | `sendSms` | **REPLACE WITH TENANT CONFIG** |
| One landline / voice caller ID from env | `getTwilioVoiceNumber`, softphone prepare | **REPLACE WITH TENANT CONFIG** |
| One mobile env number | control panel echo / fallback | **TENANTISE** |
| One TwiML App + API Key pair | `voice-token.server.ts`, configure script | **TENANTISE** (per subaccount or carefully shared master app with tenant context — prefer per-tenant TwiML App) |
| Singleton routing settings `id=1` | manage + routing loaders | **REPLACE WITH TENANT CONFIG** |
| Global unique firm landline index | SQL | **REQUIRES MIGRATION** |
| Hard-coded `MortgageEasy` / `MortgageHub` in SMS copy | `sms.server.ts` templates | **TENANTISE** (use `tenant_comms_config` / branding) |
| Default `voice_brand=mortgage_easy` | routing defaults | **TENANTISE** |
| Webhooks ignore AccountSid / Called number for tenancy | inbound SMS/voice | **TENANTISE** + **SECURITY RISK** if multi-tenant without fail-closed |
| No Twilio signature validation | all webhook routes | **SECURITY RISK** |
| Shared adviser number pool across all staff | control panel lists all numbers | **TENANTISE** |
| Feature keys unused on live paths | catalogue only | **SAFE AS-IS** until enforcement gate (then wire) |
| `tenant_comms_config` exists but unused by Twilio send path | G1 tables | **SAFE AS-IS** structurally; **TENANTISE** send path to read it |

---

## 7. Proposed tenant Twilio model

### 7.1 Logical config (per tenant)

Proposed server-owned config (names illustrative — **not created yet**):

| Field | Kind |
|-------|------|
| `tenant_id`, `company_code` | Safe |
| `comms_status` (`disabled` / `provisioning` / `active` / `suspended`) | Safe |
| `twilio_subaccount_sid` | **Safe identifier** |
| `messaging_service_sid` | Safe identifier |
| `twiml_app_sid` | Safe identifier |
| `api_key_sid` | Safe identifier (secret separate) |
| `main_number_id` → `telephony_numbers` | Safe |
| SMS sender label / brand | Safe |
| Voice brand / business hours / voicemail / routing | Safe (move off singleton) |
| Usage attribution tags | Safe |

### 7.2 Credential model (critical)

**SAFE IDENTIFIERS (may live in DB with RLS):**  
Subaccount SID, Messaging Service SID, Phone Number SID, TwiML App SID, API Key SID, E.164, friendly names.

**SECRETS (never in ordinary tenant-readable tables; never `VITE_*`):**  
Master Auth Token; subaccount Auth Tokens; API Key Secrets; any long-lived Twilio tokens.

**Recommended approach:**

1. Keep **master** SID + Auth Token in Azure App Settings / Key Vault only.  
2. Create one Twilio **subaccount per tenant**.  
3. Prefer **parent credentials acting on subaccount resources** (Twilio Accounts API path `/Accounts/{SubaccountSid}/…`) so Hub does not scatter subaccount auth tokens — **or** store subaccount auth tokens exclusively in Key Vault / sealed server secret store keyed by `tenant_id`.  
4. Issue **short-lived Voice Access Tokens** only after staff auth + tenant membership + feature checks.  
5. Webhook validation uses the auth token that owns the resource (master or subaccount) after tenant resolution.

**FAIL CLOSED** if tenant context or credential resolution fails — never fall back to tenant 001.

---

## 8. Subaccount architecture

```
Mortgage Hub Master Account
  ├── Subaccount 001 Mortgage Easy
  ├── Subaccount 002 Trent Valley FS
  └── Subaccount 003+ EXTERNAL…
```

Each subaccount isolates: purchased numbers, Messaging Services, calls, SMS, recordings, usage, TwiML Apps.

**Resolution chain:**

```
Request context
  → tenant_id (membership / case / number / webhook AccountSid|Called)
  → tenant_telephony_config.twilio_subaccount_sid
  → allowlist check: number SID / E.164 belongs to that tenant inventory
  → Twilio API scoped to that subaccount
```

Cross-tenant number use is forbidden at server layer even if UI is bypassed.

---

## 9. Company landline design

Per communications-enabled tenant:

- Main business number in `telephony_numbers` (`kind=landline`, `is_firm_inbound=true`) scoped by `tenant_id`
- Provisioning options: purchase new Twilio number into tenant subaccount **or** associate existing number already in Hub estate
- Inbound VoiceUrl → shared Hub webhook with **tenant resolution by Called number / AccountSid**
- Business hours, OOH, voicemail, fallback, caller ID from **that tenant’s** routing settings
- UI: Company Settings → Communications → Main Telephone Number  
- Also Create Company → Communications step

Partial-failure rule: tenant can exist with `comms_status=disabled` until number + webhooks verified.

---

## 10. Adviser / mobile preservation design

**Keep** existing UX and functions conceptually:

- Add number to inventory  
- Allocate to adviser  
- Clone agent-mobile template  
- Ring softphone / allocated mobile / personal reroute flags  

**Change only isolation boundaries:**

- Inventory queries filtered by `tenant_id`  
- Allocation validates number.tenant_id == adviser.tenant_id  
- Owner/admin of tenant 001 cannot list or allocate 002 numbers  
- EXTERNAL 003 never sees GROUP inventories  
- Super Owner: **admin plane** may provision numbers; **data plane** for EXTERNAL customer call/SMS logs remains governed by `can_access_tenant_data()` / support grants  

Do not redesign the panel unless isolation requires it.

**Note:** today’s `addTelephonyMobileNumber` registers inventory only — Twilio purchase remains ops/script/console. Future provisioning may wrap Twilio IncomingPhoneNumber create **inside the tenant subaccount**, still behind the same UI.

---

## 11. SMS preservation design

Keep `sendSms` as the single send primitive; extend signature conceptually:

```
sendSms({ tenantId, to, body })
  → require feature sms_notifications
  → resolve tenant Twilio config
  → MessagingServiceSid for that tenant only
  → log sms_messages.tenant_id
  → FAIL CLOSED if unresolved
```

Preserve templates and triggers; replace hard-coded `MortgageEasy` with tenant branding/`tenant_comms_config`.

Status callbacks (when added) must resolve tenant the same way as inbound SMS — never default to 001.

---

## 12. Webhook tenant resolution

**Do not** trust editable query params alone (`?tenant=001`).

Preferred ordered signals:

1. Validate `X-Twilio-Signature` against candidate auth material  
2. Read Twilio `AccountSid` → map to `tenant_id` via subaccount registry  
3. Confirm `To` / `Called` E.164 ∈ that tenant’s `telephony_numbers`  
4. Process only in that tenant scope  
5. If any step fails → **FAIL CLOSED**, write `security_audit_events`, empty/safe TwiML, no cross-tenant side effects  

Shared webhook URL path is fine; tenancy comes from Twilio identity + number map.

---

## 13. Feature-control integration (G1A)

Existing keys:

| Key | Role |
|-----|------|
| `telephone_voice` | Softphone, inbound voice, voicemail pipelines |
| `sms_notifications` | Outbound/inbound SMS product paths |
| `request_callback` | Callback request journey |

**Recommendations (do not create yet):**

| Possible key | Needed? |
|--------------|---------|
| `voicemail` | Optional split if product wants voice without voicemail; otherwise keep under `telephone_voice` |
| `call_recording` | Recommended when compliance differs per tenant |
| `adviser_numbers` | Optional; can remain part of `telephone_voice` + admin permission |

Enforcement target (later gate): UI + server fn + webhook action + Twilio API wrapper — not UI hide-only. Catalogue rows for voice/SMS exist; **001/002 tenant_features currently only seed Susan** — voice/SMS features not yet per-tenant toggled in live data.

---

## 14. Company provisioning (design only)

Extend wizard:

```
Create Company
  → Group / External
  → Company Details
  → Branding
  → Regulatory Details
  → Features & Journeys
  → Communications      ← subaccount, main number, SMS, voice, hours, voicemail, adviser-number capability
  → Initial Owner
  → Review
  → Activate
```

**State machine (conceptual):**

1. `tenant_created`  
2. `subaccount_created` (record SID)  
3. `messaging_ready`  
4. `main_number_ready` (webhooks verified)  
5. `voice_ready` (TwiML App + token path verified)  
6. `comms_active`  

On failure: mark `comms_status=provisioning_failed`, do not activate customer-facing SMS/voice; garbage-collect orphan Twilio resources via explicit cleanup job (never leave unpaid dangling numbers without operator visibility).

---

## 15. Billing / usage attribution

Retain for future reconciliation (no invoicing now):

- `twilio_subaccount_sid` per tenant  
- Phone Number SIDs + rental start/end  
- Message SIDs / Call SIDs / Recording SIDs on Hub rows  
- Twilio Usage Records filtered by subaccount  
- Internal `tenant_id` on every SMS/call log  

Licence fee (Hub) remains separate from pass-through Twilio usage.

---

## 16. GROUP vs EXTERNAL data wall

| Plane | Communications meaning |
|-------|------------------------|
| `can_administer_tenant` | Create subaccount, buy/allocate numbers, edit routing, feature toggles |
| `can_access_tenant_data` | Read customer SMS bodies, call recordings/transcripts, callback content |

GROUP 001/002: platform operators may have broader operational access per product policy.  
EXTERNAL: Super Owner admin ≠ automatic routine access to customer communications content — use support / emergency grants.

Twilio resource admin actions must still be tenant-bound.

---

## 17. Security findings (audit — **no remediation in this gate**)

| Finding | Severity | Notes |
|---------|----------|-------|
| **No Twilio webhook signature verification** on SMS/voice routes | **High** | Spoofable callbacks if URL guessed/leaked |
| Global secrets in server env only | Expected | Keep; extend carefully for subaccounts |
| **No `VITE_TWILIO_*` client secrets found** | OK | Softphone uses short-lived tokens |
| Softphone Access Token = staff userId identity | Medium | Ensure grants cannot dial arbitrary numbers outside authorised prepareBrowserCall |
| `client-outbound` trusts CallId / To without Twilio signature | High (with above) | Pair with signature + call row ownership checks |
| Susan prompt HMAC falls back to weak default if secrets missing | Medium | Code path in `voice.server.ts` |
| Hard-coded brand in SMS | Isolation risk | Cross-brand messaging once 002 enabled |
| Singleton routing / global number unique indexes | Isolation blocker | Must migrate before dual live estates |
| Live Auth Token present in local `.env` | Ops hygiene | Standard for local; ensure not committed (gitignored) — **values must never appear in docs/commits** |

**Client-exposed Twilio credential risk:** none found via `VITE_TWILIO_*`. Short-lived Voice JWTs are intentional and server-issued.

---

## 18. Recommended migration sequence

Priorities: **no SMS interruption**, **no number loss**, **no cross-tenant routing**, **preserve adviser allocation UX**.

| Stage | Action |
|-------|--------|
| **T0** | Inventory freeze: document current numbers, Messaging Service, TwiML App, webhooks (this doc + ops checklist) |
| **T1** | Schema/design only: per-tenant telephony config + drop global firm-landline uniqueness in favour of per-tenant uniqueness (**no cutover**) |
| **T2** | Introduce `resolveTenantTwilioContext(tenantId)` used by **new** code paths behind flag; default still global env |
| **T3** | Regression suite on **current** SMS/voice/allocation (baseline green) |
| **T4** | Create subaccounts for 001 and 002 (empty) — **do not move numbers yet** |
| **T5** | Map intended ownership: 001 owns current landline+mobile estate; 002 starts empty or new numbers |
| **T6** | Dual-write / shadow: resolve 001 explicitly to master-or-subaccount while still serving today’s numbers |
| **T7** | Move or re-point **001** resources; verify SMS + inbound + softphone + allocation |
| **T8** | Provision **002** numbers/Messaging/Voice in its subaccount; configure branding |
| **T9** | Verify 002 isolation (wrong-tenant fail closed) |
| **T10** | Automate Create Company communications provisioning |
| **T11** | EXTERNAL isolation + support-grant tests |
| **T12** | Usage attribution reporting |

**Safer default for 001:** keep numbers on master briefly under explicit `tenant_id=001` mapping, then move into subaccount in a maintenance window after shadow traffic succeeds. Avoid uncontrolled Twilio number transfers.

Webhook signature verification should land **before** multi-tenant cutover (can be done on single-account first).

---

## 19. Regression / isolation test matrix (proposed)

| Case | Expected |
|------|----------|
| 001 outbound SMS | PASS via 001 Messaging Service; logged `tenant_id=001` |
| 002 outbound SMS | PASS via 002 only |
| 001 inbound call to 001 landline | PASS route 001 rules/brand |
| 002 inbound call to 002 landline | PASS route 002 rules/brand |
| 001 outbound softphone | PASS caller ID = 001 main |
| 002 outbound softphone | PASS caller ID = 002 main |
| 001 allocate 001 mobile | PASS |
| 002 allocate 002 mobile | PASS |
| 001 allocate 002 number | **FAIL** closed |
| 002 SMS using 001 service | **FAIL** closed |
| Call with wrong tenant caller ID | **FAIL** closed |
| Webhook invalid signature | **FAIL** closed + security event |
| Unknown Called number | **FAIL** closed |
| Unknown AccountSid | **FAIL** closed |
| `sms_notifications` disabled | SMS API blocked (not just hidden) |
| `telephone_voice` disabled | Token + dial + inbound dial blocked |
| EXTERNAL isolation | No GROUP numbers/logs without grant |
| Super Owner admin plane | Can provision; cannot silently read EXTERNAL comms content without data plane |
| Support grant | Temporary scoped access works |
| Emergency/break-glass | Audited elevated access works |

---

## 20. Specific 001 migration impact

**Mortgage Easy (001)** currently **is** the live communications estate.

| Item | Impact |
|------|--------|
| Landline `…2912` | Treat as 001 main; re-point VoiceUrl after tenant resolver exists |
| Mobile `…5627` | Treat as 001 inventory; keep Owner allocation |
| Messaging Service | Remains 001’s SMS pipe until replaced/cloned into 001 subaccount |
| Softphone TwiML App / API Key | Re-create or move under 001 subaccount; update secrets |
| Routing singleton + `voice_brand=mortgage_easy` | Become 001’s routing row |
| SMS copy `MortgageEasy` / `MortgageHub` | Align to 001 branding explicitly |
| Risk | Highest — production SMS/voice depend on this path |
| Order | Migrate/shadow **001 first** while 002 still unused for Twilio |

---

## 21. Specific 002 migration impact

**Trent Valley FS (002)** has **no dedicated Twilio numbers** in Hub inventory today.

| Item | Impact |
|------|--------|
| Numbers | Need new landline (+ optional mobiles) in **002 subaccount** |
| SMS | New Messaging Service + sender branding (not MortgageHub/ME) |
| Voice brand | Already scripted as `trent_valley`; wire to 002 settings |
| Susan voice feature | Disabled for 002 — voicemail TTS brand must not pull ME journey features incorrectly |
| Risk | Lower for cutover of existing traffic; higher for **mistaken fallback to 001** if fail-open |
| Order | After 001 stable on tenant resolver; enable 002 only when fail-closed proven |

---

## 22. Documentation / confirmations

| Item | Status |
|------|--------|
| This document | `docs/TWILIO_MULTI_TENANT_ARCHITECTURE.md` |
| Runtime code changed | **No** |
| Twilio resources changed | **No** |
| Database/schema changed | **No** |
| G2 started | **No** |
| Azure deployment | **No** |

---

## 23. Unexpected findings

1. Telephony control panel **does not purchase** Twilio numbers via API — inventory insert only.  
2. Global SQL uniqueness allows only **one** firm inbound landline in the whole DB.  
3. `voice_brand` already knows Trent Valley, but settings are still singleton → brand switch would affect the single live estate.  
4. Webhook signature verification is **absent**.  
5. G1A voice/SMS feature keys exist but are **not** present as `tenant_features` rows for 001/002 (only Susan is).  
6. Softphone outbound caller ID ignores allocated adviser mobile (by design today).  
7. `referrals.functions.ts` contains a `sendSms(profile.phone, message)` call shape that does not match `sendSms({to, body})` — likely dead/broken path; verify before tenant work (do not “fix” in this gate).

---

**STOP.** Do not begin implementation, subaccount provisioning, or G2 until explicit approval.
