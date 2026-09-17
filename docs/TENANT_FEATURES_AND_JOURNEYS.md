# Mortgage Hub — Tenant features & customer journeys

**Status:** Design approved · **Gate G1A implemented (schema scaffolding)** · app enforcement not wired · **G2 not started**  
**Revised:** 2026-09-17 (G1A)  
**Related:** `docs/MULTI_TENANT_PHASE0.md` · `docs/TENANT_CLASSIFICATION_AND_DATA_WALL.md`

GROUP/EXTERNAL = relationship & data-wall security.  
**Features & Journeys** = which Mortgage Hub capabilities a tenant uses.  
These planes must **not** be coupled.

---

## 1. Proposed tenant feature model

### 1.1 Recommendation: catalogue + per-tenant rows (not boolean columns on `tenants`)

```text
feature_catalogue          — platform-defined capabilities (stable keys)
tenant_features            — per-tenant enablement + config + entitlement + rollout
```

#### `feature_catalogue` (platform)

| Column | Purpose |
|--------|---------|
| `feature_key` | Stable string PK, e.g. `susan_ai_journey` |
| `name` / `description` | UI labels for Super Owner wizard |
| `category` | `customer_journey` \| `public_access` \| `staff_capability` \| `comms` \| `integration` |
| `default_enabled` | Default when creating a company (overridable) |
| `supports_config` | Whether JSON config is used |
| `sort_order` | Wizard / settings order |
| `active` | Soft-retire obsolete catalogue entries |

#### `tenant_features` (per tenant)

| Column | Purpose |
|--------|---------|
| `tenant_id` | FK → tenants |
| `feature_key` | FK → catalogue |
| `state` | See §1.2 |
| `config` | jsonb — journey-specific options (nullable) |
| `entitlement` | jsonb — licence / plan limits (optional) |
| `updated_at` / `updated_by` | Audit |

**Unique** `(tenant_id, feature_key)`.

### 1.2 State model (more than enabled/disabled)

```text
feature_state: disabled | enabled | entitlement_blocked | rollout_hidden
```

| State | Meaning |
|-------|---------|
| `disabled` | Tenant must not use this capability (UI + routes + APIs blocked) |
| `enabled` | Fully available under tenant branding/config |
| `entitlement_blocked` | Catalogue allows it but licence/plan does not (Super Owner may show “upgrade”) |
| `rollout_hidden` | Internal gradual rollout — treat as unavailable to end users |

Optional later: `config` holds variant settings (e.g. Susan voice brand, booking slot defaults) without new columns.

### 1.3 Why not booleans on `tenants`

- Catalogue grows without migrations per feature  
- Supports config / entitlement / rollout without redesign  
- Clear audit of who changed what  
- Same model for Create Company wizard and Company Settings  

### 1.4 Runtime resolution

```
requireTenantFeature(tenantId, featureKey) →
  resolve tenant_features row (or catalogue default)
  if state !== enabled → throw controlled FeatureNotEnabledError
```

Never fall back to another tenant’s `tenant_features` or Mortgage Easy defaults when resolving for tenant B.

---

## 2. Complete feature / journey catalogue (current app audit)

### 2.1 Primary customer journeys (required minimum + audited)

| feature_key | Name | Current surfaces (today) |
|-------------|------|---------------------------|
| `susan_ai_journey` | Susan AI journey | `/` start=voice; `/interview/$sessionId`; `/api/interview-step`; `/api/avatar-token`; `/api/tts`; `/api/stt`; avatar messages; staff resume interview |
| `susan_chat_journey` | Susan typed chat fact-find | `/` start=chat; `/chat/$sessionId`; `/text/$sessionId`; shared interview APIs |
| `appointment_booking` | Appointment booking | `/` start=book; `/booking`; `/book/$slug`; `getAvailableSlots` / `createAppointment*`; post-completion booking; staff/introducer booking cards |
| `request_callback` | Request a callback | Customer hub / post-completion; `requestCallbackAuth` / `requestSessionCallback`; callback CRM |
| `external_website_links` | External website / return links | Tenant `website_url`; marketing `from=mortgageeasy`; post-auth return; “back to website” |
| `introducer_journey` | Introducer journey | `/go/$slug`; `/book/$slug`; `/introducer`; introducer portal; calculator lead API |
| `refer_a_friend` | Refer a Friend | `/raf/$code`; RAF cookies; `referrals.functions`; Marketing → RAF; customer RAF share on `/home` |
| `customer_portal` | Customer portal / login | `/auth`; `/register`; `/home` customer landing; `/sessions/$sessionId`; `/customers/$customerId` (customer view) |
| `telephone_voice` | Telephone / voice journeys | Softphone; Twilio inbound/outbound/status/recording/voicemail; `susan-prompt` voicemail brand; telephony manage |

### 2.2 Additional catalogue candidates (from audit)

| feature_key | Name | Notes |
|-------------|------|-------|
| `public_hub_landing` | Public Hub landing (`/`) | Voice/chat/book CTAs; today ME-centric |
| `customer_case_hub` | Customer case / session hub | `/sessions/$sessionId`, case list on home |
| `staff_diary` | Staff diary & appointments | `/diary`, diary settings, Teams calendar |
| `staff_crm` | Staff CRM / customers | Staff dashboard customers/contacts |
| `staff_cases` | Staff cases pipeline | `/cases`, journey milestones |
| `staff_finance` | Finance & commissions | Finance branch, ledger, rates, network statements |
| `staff_marketing_scripts` | Marketing scripts / templates | Comms scripts panel |
| `journey_analytics` | Journey analytics | Management analytics |
| `view_as` | View-as modes | Advisor/introducer/customer view-as |
| `teams_calendar` | Microsoft Teams calendar sync | OAuth `/api/teams/callback` |
| `mortgage_calculator_public` | Public calculator APIs | `/api/calculator/*`; often used from marketing/introducer sites |
| `introducer_calculator_lead` | Introducer calculator lead capture | `/api/introducer/calculator-lead` |
| `password_recovery` | Password reset | `/auth/reset`, `/api/auth/request-password-reset` — usually always on |
| `sms_notifications` | Outbound/inbound SMS | Booking SMS, `/api/sms/inbound` |
| `relationship_pipeline` | Relationship / renewals | Relationship sub-tab |

**Platform-always-on (not tenant-toggleable, or toggle with extreme care):** auth session, password recovery, Super Owner platform admin, health. Prefer keeping `password_recovery` always enabled.

### 2.3 Marketing / external sites (outside Hub repo routes)

MortgageEasy / Trent Valley **marketing** sites deep-link into Hub (`from=mortgageeasy`, `/go`, `/book`, RAF). Those links must resolve **tenant context** and respect that tenant’s features — e.g. ME marketing may advertise Susan; TVFS marketing must not deep-link Susan if disabled.

---

## 3. Initial configuration (001 / 002)

| feature_key | 001 Mortgage Easy | 002 Trent Valley FS |
|-------------|-------------------|---------------------|
| `susan_ai_journey` | **ENABLED** | **DISABLED** |
| `susan_chat_journey` | *Unspecified — preserve ME behaviour; decide with product (likely ENABLED for ME; DISABLED for TVFS if chat is Susan-branded)* | Treat as **DISABLED** if it is part of Susan experience; confirm before cutover |
| `appointment_booking` | Unspecified (assume keep current ME behaviour → treat as **ENABLED** when unambiguous) | Unspecified |
| `request_callback` | Unspecified | Unspecified |
| `external_website_links` | Unspecified | Unspecified |
| `introducer_journey` | Unspecified | Unspecified |
| `refer_a_friend` | Unspecified | Unspecified |
| `customer_portal` | Unspecified | Unspecified |
| `telephone_voice` | Unspecified | Unspecified |

**Explicitly locked for this checkpoint:**

- **001:** Susan AI Journey = **ENABLED** (preserve existing ME functionality)  
- **002:** Susan AI Journey = **DISABLED**  

Do not invent ENABLED/DISABLED for other features until product confirms current TVFS/ME usage.

When seeding TVFS, any Susan-related keys that are inseparable from the avatar experience (`susan_ai_journey`, and likely `susan_chat_journey` + interview/avatar APIs) should be disabled together unless product splits them.

---

## 4. Routes / APIs affected by feature disabling

### 4.1 If `susan_ai_journey` DISABLED (e.g. `/trentvalleyfs`)

| Layer | Action |
|-------|--------|
| UI | Hide voice/Susan CTAs on tenant landing & customer home; hide “Resume with Susan” |
| Routes | `/{tenantSlug}/interview/...` (future) or tenant-scoped interview entry → **controlled unavailable** |
| Direct URL | Manual navigation must **not** start Susan / load avatar |
| APIs | Reject: `/api/interview-step`, `/api/avatar-token`, `/api/tts`, `/api/stt` when session/tenant has Susan disabled; return stable `feature_not_enabled` |
| Staff | Cannot launch Susan interview for that tenant’s customers |
| Fallback | **Never** use Mortgage Easy Susan config/branding |

ME (`mortgageeasy`) with Susan ENABLED continues unchanged.

### 4.2 Other features (illustrative enforcement map)

| Feature | Block when disabled |
|---------|---------------------|
| `appointment_booking` | `/book/$slug`, `/booking`, booking serverFns, public start=book |
| `request_callback` | Callback request serverFns + UI |
| `introducer_journey` | `/go/$slug`, `/book/$slug`, introducer portal, calculator-lead |
| `refer_a_friend` | `/raf/$code`, RAF create/claim/share APIs, marketing RAF tab |
| `customer_portal` | Customer join/login landing for that tenant (staff may still exist) |
| `telephone_voice` | Softphone token, browser call prepare, tenant DID routing (careful — may be staff-critical) |
| `external_website_links` | Use tenant `website_url` only; if unset/disabled, hide return CTAs (no ME URL fallback) |

### 4.3 Enforcement rule

```
UI hide
+ route guard (tenant context)
+ serverFn/API assert requireTenantFeature
+ no cross-tenant config fallback
```

All three required. UI-only is insufficient.

---

## 5. Create Company wizard amendment

```
Create Company
  → Group / External          (tenant_type — security plane)
  → Company Details
  → Branding
  → Regulatory Details
  → Features & Journeys       ← NEW step (catalogue checkboxes + state)
  → Communications
  → Initial Owner
  → Review
  → Activate
```

Features & Journeys step:

- Lists catalogue by category  
- Checkboxes / toggles → `enabled` / `disabled`  
- EXTERNAL defaults = strongest isolation **and** conservative feature defaults (product-defined)  
- GROUP defaults may enable more (e.g. ME-like)  
- **Susan not auto-enabled** for EXTERNAL or for TVFS-like brands  

---

## 6. Company Settings amendment

```
Company Settings
  → Features & Journeys
```

Same catalogue controls as provisioning; editable by Super Owner (and optionally Tenant Owner for a subset — product decision).  
No developer intervention / deploy to flip Susan on/off.

---

## 7. Branding & website

- Enabled journeys load **active tenant** branding (`tenant_branding`, comms footers, voice brand where configured).  
- **No** fallback to Mortgage Easy assets/copy for another tenant.  
- Return/external links use `tenants.website_url` for that tenant only.

---

## 8. G1 schema / helper amendments required (design only — not applied)

| Item | Need |
|------|------|
| `feature_catalogue` + `tenant_features` | New tables (future authorised migration) |
| Seed catalogue keys | Including `susan_ai_journey` |
| Seed 001 ENABLED / 002 DISABLED for Susan | After tenants exist (G1 already has 001/002) |
| `requireTenantFeature` / `isTenantFeatureEnabled` helpers | Server + optional RLS-friendly SQL |
| G1 `tenant_settings.feature_flags` jsonb | **Insufficient long-term** — migrate conceptually to `tenant_features`; may use jsonb only as temporary bridge |

**No change** to `can_administer_tenant` / data-wall helpers for feature toggles — features are orthogonal to GROUP/EXTERNAL data access.

Do **not** implement in this checkpoint.

---

## 9. Confirmation: Susan off for TVFS without affecting ME

| Tenant | Susan |
|--------|--------|
| 001 `mortgageeasy` | ENABLED — existing interview/avatar/TTS/STT paths keep working |
| 002 `trentvalleyfs` | DISABLED — TVFS Susan URLs/APIs return not-enabled; no ME branding bleed |

Resolution always by **tenant_id** (from membership / slug context), never by “global Susan on”.

---

## 10. Confirmations

| Item | Status |
|------|--------|
| Implemented / deployed | **No** |
| Production schema changed for features | **No** |
| G2 started | **No** |

---

## STOP

Awaiting approval before any feature-catalogue migration or Gate G2.
