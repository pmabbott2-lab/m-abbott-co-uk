# Mortgage Hub — Multi-tenant Phase 0 (revised)

**Status:** Phase 0 approved · **G1 + G1A complete** · **G2 not started**  
**Revised:** 2026-09-17 (Gate G1A)  
**Do not** start G2, backfill, RLS cutover, MFA, Super Owner conversion, feature route enforcement, or Azure deploy without explicit authorisation.

| Document | Role |
|----------|------|
| This file | Authoritative Phase 0 + gated plan |
| `docs/SUPER_OWNER_RECOVERY.md` | Super Owner MFA recovery (design) |
| `docs/TENANT_CLASSIFICATION_AND_DATA_WALL.md` | GROUP/EXTERNAL data wall |
| `docs/TENANT_FEATURES_AND_JOURNEYS.md` | Features & Journeys catalogue |

| Baseline | Value |
|----------|--------|
| Pre-MT Git tag | `pre-multitenant-baseline` @ `244ceaa` |
| Post-G1 Git tag | `post-g1-multitenant-scaffolding` |
| Post-G1A Git tag | `post-g1a-tenant-controls` (see latest commit) |
| Immediate logical dump | `backups/pre-phase1-immediate-baseline-20260917T164555Z/` (**gitignored**) |

**G1A:** `tenant_type`, administer/data helpers, support/emergency grant tables, `feature_catalogue` / `tenant_features`, Susan 001 enabled / 002 disabled. Live app routes **not** yet enforcing features.

---

## 1. Recovery baseline (current) — CONFIRMED

### 1.1 Supabase plan & scheduled backups

| Check | Result |
|-------|--------|
| Organisation plan | **Pro** |
| Project | `tiuplmftooauihulhtws` · ACTIVE_HEALTHY · eu-west-1 |
| Automatic daily backups | **Active** |

**Confirmed scheduled backups (COMPLETED):**

| Completed (UTC) | Status |
|-----------------|--------|
| **2026-09-17 05:04:38** | COMPLETED |
| **2026-09-16 05:05:33** | COMPLETED |

### 1.2 Immediate pre-Phase-1 offline logical dump

| Field | Value |
|-------|--------|
| UTC | **2026-09-17 16:45:55 UTC** |
| UK | **2026-09-17 17:45:55 BST** |
| Location | `backups/pre-phase1-immediate-baseline-20260917T164555Z/` |
| Tables | **47/47** public · all `count_match: true` |
| Rows | **1,632** (`total_data_rows` = `expected_total_from_sql`) |
| Checksums | Per-table SHA-256 in `MANIFEST.json` · **PASS** |
| Auth metadata | **22 users** (ids/emails/providers — not password hashes) |
| `phase1_started` | **false** |
| Gitignored | Yes — **do not commit** backup payloads or secrets |
| Separate from | `backups/pre-multitenant-baseline-20260917/` |

Paired schema snapshot: `schema_from_git/migrations/` inside the dump folder.

### 1.3 What is / is not protected

| Layer | Protected by |
|-------|----------------|
| Application code | Git tag `pre-multitenant-baseline` @ `244ceaa` |
| Postgres (platform restore) | Pro daily backups |
| Public business rows (offline) | Immediate logical dump |
| Auth users as in DB | Pro daily backup restore |
| Auth identity inventory (offline) | Dump `auth_users_metadata.json` |

**Not fully covered by offline dump alone:** password hashes; **TOTP / MFA secrets**; Auth sessions; **Storage file bytes**; Azure App Settings / GitHub secrets; Dashboard Auth URL config; Edge Function artefacts.

**Explicit:** the immediate logical baseline does **not** contain TOTP secrets, MFA factors, or password hashes. Restoring that dump alone does **not** restore complete Supabase Auth/MFA state. Use Pro platform backup/PITR for Auth-inclusive restore points, and `docs/SUPER_OWNER_RECOVERY.md` when MFA must be reset without a full Auth restore.

### 1.4 PITR recommendation

**Enable PITR** (7-day+) before Gate G3–G5 (backfill / RLS). Pro add-on; confirm before high-risk stages.

### 1.5 Git restore

```bash
git fetch github --tags
git checkout -b recover/pre-mt pre-multitenant-baseline
npm ci && npm run build
# redeploy Azure from that commit via Actions
```

---

## 2. Decisions locked (design only — not applied)

| # | Decision | Status |
|---|----------|--------|
| Super Admin access | **Option B — explicit tenant grants only** | Approved |
| Super Admin grants table | **`super_admin_tenant_access`** (not `tenant_memberships`) | **Recommended / final** |
| Super Owner identity | `pmabbott2@aol.com` → resolve `auth.users.id` → `platform_roles.user_id` + `role = super_owner` (**do not convert yet**) | Confirmed |
| Super Owner tenant access | Platform-level only — **no** `tenant_memberships` required for 001/002/future | Confirmed |
| MFA method | Supabase Auth **TOTP** | Design |
| MFA mandatory (target) | Super Owner, Super Admin, Company Owner, Supervisor, General Admin, Adviser | Design — controlled migration |
| Customer MFA | Optional initially | Design |
| Global MFA day-one | **Do not** enforce globally on first ship | Confirmed |
| Super Owner recovery | `docs/SUPER_OWNER_RECOVERY.md` (Auth Admin — not app bypass) | Design |
| Tenant 001 | Mortgage Easy · code `001` · slug `mortgageeasy` · **GROUP** (design) | Confirmed |
| Tenant 002 | Trent Valley Financial Services · code `002` · slug `trentvalleyfs` · **GROUP** (design) | Confirmed |
| Future licensees | Normally **EXTERNAL** (strong data wall) | Design — see `TENANT_CLASSIFICATION_AND_DATA_WALL.md` |
| TVFS at cutover | **Empty CRM** unless classification finds genuine TVFS-owned rows | Confirmed |
| ME backfill | Classify first — **do not assume** all 1,632 rows are ME | Confirmed |

---

## 3. Final Super Admin membership recommendation

### Recommendation: **B — separate `super_admin_tenant_access`**

Three distinct sources — **no competing truth for the same question**:

| Question | Authoritative store |
|----------|---------------------|
| Is this user a platform Super Admin / Super Owner? | `platform_roles` |
| Which companies may this Super Admin enter? | **`super_admin_tenant_access` only** |
| Is this user staff of company X (Owner/Supervisor/General/Adviser/Introducer)? | **`tenant_memberships` only** |

**Why not put Super Admin grants in `tenant_memberships`?**

1. **Semantics:** membership = “works for this firm”; Super Admin grant = “platform delegate may enter this firm.” Mixing them creates ambiguous staff lists, invites, billing, and reports.
2. **Least privilege:** Super Owner needs **no** grant rows (all tenants). Super Admin needs **only** explicit grants. Membership rows would imply staff privileges they must not inherit by accident.
3. **Audit:** revoke Super Admin = delete platform role + grants. No orphan “Owner” memberships to clean.
4. **RLS clarity:**  
   `is_super_owner()`  
   OR (`is_super_admin()` AND exists grant for `tenant_id`)  
   OR exists `tenant_memberships` for `tenant_id`  
   — one predicate path each.

**Security rule:** never trust client-supplied `tenant_id` without server validation against one of the three stores above.

---

## 4. Super Owner (design only — no conversion yet)

### 4.1 Identity model

```
pmabbott2@aol.com  (migration lookup only)
        ↓
auth.users.id
        ↓
platform_roles.user_id  +  platform_roles.role = 'super_owner'
```

- Email may identify the existing account **during controlled migration only**.
- Ongoing security mechanism = **UUID + `platform_roles`**, never frontend email comparison.
- Super Owner is **PLATFORM LEVEL**.
- Must **not** depend on `tenant_memberships` for access to 001, 002, or future tenants.
- A valid Super Owner accesses every tenant through platform authorisation alone.

### 4.2 Conversion rules

- Seed `platform_roles` only after Gate **G7** approval.
- Retire `ADMIN_EMAILS` / builtin email list as ongoing authz (bootstrap-only at most).
- **Do not** combine conversion, TOTP enrolment, and mandatory MFA into one step (see Gates G7–G10).

---


## 5. Revised architecture

```
Mortgage Hub (mymortgagehub.uk)
├── platform_roles (super_owner | super_admin)
├── super_admin_tenant_access (user_id, tenant_id)     ← Option B grants
├── tenants (uuid, company_code, slug, name, status, website_url, …)
├── tenant_memberships (user ↔ tenant ↔ tenant_role)
├── tenant_branding + tenant_comms_config + tenant_settings
└── business data (tenant_id on ownership roots; RLS + server asserts)
```

- One app, one codebase, many tenants.
- URL `/{slug}/…` sets **context only** after authz — slug change must not reassign data.
- Public ME / TVFS websites remain separate; CTAs deep-link into Hub tenant routes.
- Existing introducer `company_code` (introducer-firm code) **≠** tenant `company_code` (`001` / `002`).

### 5.1 Introducer ownership chain

```
Tenant
  → Introducer (tenant_id immutable; keep legacy introducers.company_code as introducer-firm code)
    → Introducer link (/go|/book under tenant slug)
      → Lead / Customer (tenant_id from introducer at creation)
        → Case (interview_sessions.tenant_id)
```

Preserve current introducer portal behaviour; add immutable tenant ownership.

---

## 6. Company provisioning — minimum dataset

When Super Owner creates Tenant **003+**:

| Area | Required fields |
|------|-----------------|
| Identity | `tenant_id`, `company_code` (allocated), `slug`, `company_name`, `trading_name`, `status` |
| Web | `website_url` (Back / Return destination) |
| Brand | logo (Storage path), primary_colour, secondary_colour |
| Contact | company_email, telephone |
| Regulatory | legal_name, FCA / disclosure text, email_footer, sms_footer |
| Comms | clone platform seed templates; from-name; footers |
| Settings | diary defaults, feature flags, telephony defaults if any |
| People | invite Owner (`staff_invitations.tenant_id` **immutable**) |

**Flow:** Create Company → configure → invite Owner → Owner accepts → Owner invites staff.  
No developer / database intervention for a normal new tenant.

---

## 7. Company-aware links

All company-sensitive destinations must resolve from **tenant configuration / tenant context**, not hard-coded Mortgage Easy:

| Surface | Target |
|---------|--------|
| Back / Return to website | `tenant.website_url` |
| Introducer | `/{tenantSlug}/go/…`, `/{tenantSlug}/book/…` |
| Customer journeys | Tenant-scoped Hub + configured public site |
| Appointment / Teams / SMS | Tenant-aware Hub base URL + tenant brand in copy |
| RAF | `/{tenantSlug}/raf/{code}` |
| Marketing / Scripts | Per-tenant templates + branding |
| Email / SMS links | Tenant footers + links |
| Referral / booking / invite links | Bind `tenant_id` server-side; never reassign via URL alone |

Mortgage Easy context → ME website/branding. Trent Valley context → TVFS website/branding.

---

## 8. Forty-seven table migration classification

Row counts = live exact counts at dump time (**2026-09-17 16:45:55 UTC**) · sum **1,632**.  
**No backfill. No schema change. Classification only.**

### Legend

| Class | Meaning |
|-------|---------|
| TENANT OWNED | Explicit `tenant_id` on row |
| TENANT INHERITED | Tenant via parent; denormalise `tenant_id` recommended for RLS |
| PLATFORM LEVEL | Platform-wide |
| SHARED→TENANT | Today singleton / global → become per-tenant |
| SYSTEM/TECHNICAL | Operational |
| REQUIRES MANUAL DECISION | Human decision before backfill |

### 8.1 Full manifest (47 tables)

| # | Table | Rows | Class | Ownership root | Explicit `tenant_id`? | Proposed FK / index | Backfill rule (later) | Validation |
|---|-------|------|-------|----------------|----------------------|---------------------|------------------------|------------|
| 1 | profiles | 22 | TENANT OWNED* | user | Yes (nullable for platform-only users) | FK→tenants; idx(tenant_id) | Via roles/sessions/membership map; orphans → queue | Staff/customers have membership |
| 2 | user_roles | 30 | TENANT INHERITED / transitional | user_id | Prefer migrate into `tenant_memberships` | — | Map advisor/introducer/admin into memberships | No dual conflicting role |
| 3 | admin_profiles | 2 | TENANT OWNED* | admin user | Yes for tenant admins | FK→tenants | Current Owner/Supervisor → ME 001 | Platform roles separate |
| 4 | admin_permissions | 15 | TENANT INHERITED | admin_profiles | Yes denorm | idx(tenant_id) | Same as admin_profiles | Match admin tenant |
| 5 | advisor_profiles | 4 | TENANT OWNED | adviser | Yes | FK→tenants; unique(tenant_id, code) | → ME 001 unless flagged | Codes unique per tenant |
| 6 | advisor_availability | 20 | TENANT INHERITED | advisor_id | Yes denorm | idx(tenant_id, advisor_id) | From advisor_profiles | No cross-tenant advisor_id |
| 7 | advisor_diary_settings | 0 | TENANT INHERITED | advisor_id | Yes denorm | idx(tenant_id, advisor_id) | From adviser | — |
| 8 | advisor_diary_exceptions | 0 | TENANT INHERITED | advisor_id | Yes denorm | idx(tenant_id, advisor_id) | From adviser | — |
| 9 | advisor_notes | 3 | TENANT INHERITED | session/advisor | Yes denorm | idx(tenant_id) | From interview_sessions | Session tenant match |
| 10 | advisor_contact_views | 40 | TENANT INHERITED | advisor/session | Yes denorm | idx(tenant_id) | From adviser/session | — |
| 11 | advisor_telephony | 1 | TENANT OWNED | adviser | Yes | FK→tenants | ME 001 | — |
| 12 | appointments | 11 | TENANT OWNED | appointment | Yes | FK→tenants; idx(tenant_id, starts_at) | From advisor/session | Advisor & session same tenant |
| 13 | interview_sessions | 40 | TENANT OWNED | case/session | Yes | FK→tenants; idx(tenant_id, customer_id) | Attribution path; orphans → queue | Customer membership match |
| 14 | interview_messages | 746 | TENANT INHERITED | session | Yes denorm | idx(tenant_id, session_id) | From session | Count integrity |
| 15 | interview_answers | 356 | TENANT INHERITED | session | Yes denorm | idx(tenant_id, session_id) | From session | — |
| 16 | session_advisors | 24 | TENANT INHERITED | session | Yes denorm | idx(tenant_id) | From session | Advisers same tenant |
| 17 | session_contact_tracking | 14 | TENANT INHERITED | session | Yes denorm | idx(tenant_id) | From session | — |
| 18 | customer_contact_log | 68 | TENANT INHERITED | customer/session | Yes denorm | idx(tenant_id) | From customer/session | — |
| 19 | customer_journey_milestones | 7 | TENANT INHERITED | session | Yes denorm | idx(tenant_id) | From session | — |
| 20 | case_mortgage_details | 0 | TENANT INHERITED | session | Yes denorm | idx(tenant_id) | From session | — |
| 21 | callback_requests | 19 | TENANT OWNED | callback | Yes | FK→tenants | From session/advisor | — |
| 22 | phone_calls | 24 | TENANT OWNED | call | Yes | FK→tenants | From adviser / number map | — |
| 23 | sms_messages | 53 | TENANT INHERITED | appointment/lead | Yes denorm | idx(tenant_id) | From appointment/lead | — |
| 24 | staff_contact_tasks | 8 | TENANT OWNED | task | Yes | FK→tenants | From session/advisor | — |
| 25 | introducers | 4 | TENANT OWNED | introducer | Yes | FK→tenants; **keep** legacy `company_code` as introducer-firm code | → ME 001 unless audit says else | Slug unique **per tenant** |
| 26 | introducer_leads | 3 | TENANT INHERITED | introducer | Yes denorm | idx(tenant_id, introducer_id) | From introducer | — |
| 27 | customer_introducer_links | 4 | TENANT INHERITED | introducer+customer | Yes denorm | idx(tenant_id) | From introducer | Both sides same tenant |
| 28 | introducer_amendment_history | 1 | TENANT INHERITED | link | Yes denorm | idx(tenant_id) | From link | — |
| 29 | referral_codes | 2 | TENANT OWNED | RAF code | Yes | unique(tenant_id, code) | ME 001 | — |
| 30 | referrals | 1 | TENANT INHERITED | referral_codes | Yes denorm | idx(tenant_id) | From code | — |
| 31 | staff_invitations | 2 | TENANT OWNED | invite | Yes **immutable** | FK→tenants | Issuer tenant | Token cannot change tenant |
| 32 | finance_fee_lines | 8 | TENANT INHERITED | session | Yes denorm | idx(tenant_id, session_id) | From session | — |
| 33 | finance_ledger | 19 | TENANT OWNED | ledger | Yes | FK→tenants; idx(tenant_id, status) | From session/beneficiary | Amounts reconcile |
| 34 | finance_audit_log | 9 | TENANT OWNED | audit | Yes | FK→tenants | Actor context | — |
| 35 | finance_settings | 1 | SHARED→TENANT | settings | Per-tenant row | PK(tenant_id) | Copy into ME 001 | TVFS defaults on provision |
| 36 | commission_rates | 3 | TENANT OWNED | rate | Yes | unique(tenant_id, subject…) | ME 001 | — |
| 37 | commission_rate_history | 16 | TENANT INHERITED | rates | Yes denorm | idx(tenant_id) | From rates | — |
| 38 | network_commission_statements | 1 | TENANT OWNED | statement | Yes | FK→tenants | ME 001 | — |
| 39 | network_commission_lines | 0 | TENANT INHERITED | statement | Yes denorm | idx(tenant_id) | From statement | — |
| 40 | communication_settings | 1 | SHARED→TENANT | branding/comms | Per-tenant | PK tenant_id | Copy into ME 001 | TVFS defaults on provision |
| 41 | communication_templates | 16 | TENANT OWNED | template | Yes | unique(tenant_id, template_key) | Clone to ME 001 | — |
| 42 | communication_template_versions | 0 | TENANT INHERITED | template | Yes denorm | idx(tenant_id) | From template | — |
| 43 | telephony_numbers | 2 | **REQUIRES MANUAL DECISION** | number | Likely TENANT OWNED or PLATFORM pool | TBD | Audit DID ownership ME vs shared Hub | Explicit assignment |
| 44 | telephony_routing_settings | 1 | **REQUIRES MANUAL DECISION** | routing | Tenant or platform | TBD | Same as numbers | — |
| 45 | lender_remortgage_policies | 1 | SHARED/GLOBAL or TENANT | policy | Prefer TENANT copy | optional FK | Start as ME copy | — |
| 46 | view_as_audit_log | 27 | TENANT OWNED + platform | audit | Yes + nullable platform-only | idx(tenant_id) | From viewed user’s tenant | Super Owner tagged |
| 47 | platform_restore_points | 3 | SYSTEM/TECHNICAL | platform | No | — | Leave global | — |

\*Platform Super Owner/Admin may have **null** `tenant_id` on profile and only `platform_roles` (+ grants).

### 8.2 Backfill principle

Do **not** assign all 1,632 rows to Mortgage Easy blindly:

1. Create tenants 001 / 002 (Gate G1).
2. Add **nullable** `tenant_id` columns.
3. Deterministic rules → orphan queue for Gate G2 sign-off.
4. Dual-run filters → RLS → NOT NULL.

**TVFS 002:** zero migrated CRM rows unless audit finds genuine TVFS-owned records.

**RLS impact (all tenant tables):** policies using `is_super_owner()` / Super Admin grant / membership; inherited tables enforce parent + denorm `tenant_id` match.

---

## 9. Service-role access inventory

**Fact:** `supabaseAdmin` (`SUPABASE_SERVICE_ROLE_KEY`) **bypasses RLS**.

**Mandatory pattern** before any tenant-owned read/write via service role:

1. Authenticate user **or** verify Twilio signature (webhooks).
2. Resolve authority plane:
   - **Administer** → `can_administer_tenant` (future; see data-wall doc)
   - **Business data** → `can_access_tenant_data` (future; Super Owner ≠ automatic EXTERNAL data)
   - Do **not** use G1 `can_access_tenant` as-is for EXTERNAL business queries
3. Assert permission for the operation.
4. Scope every query with `tenant_id` (and parent FKs).
5. Reject mismatches.

`SUPABASE_SERVICE_ROLE_KEY` must remain **server-only** (never Vite client bundles).

### 9.1 Modules & representative endpoints

| Module / route | Functions / handlers (representative) | Tables accessed | Auth today | Tenant assert required |
|----------------|----------------------------------------|-----------------|------------|------------------------|
| `admin.functions.ts` | `getMyAdminAccess`, `listAdmins`, `setAdminLevel`, `setAdminPermissions`, `listUsersForAdminGrant`, `diagnoseSupabaseAdminConfig` | profiles, user_roles, admin_*, staff_invitations | requireSupabaseAuth + owner/supervisor | Split platform vs tenant admin |
| `auth.functions.ts` | `sendLoginSmsCode`, `verifyLoginSmsCodeFn`, `verifyAppointmentSignupSms` | profiles, auth.admin | mixed / public flows | Membership when user is tenant-scoped |
| `booking.functions.ts` | `getAvailableSlots`, `createAppointment*`, `book*`, `listAdvisorContacts`, `list*Appointments`, `rescheduleAppointment`, callbacks, voicemail assign, introducer booking SMS | appointments, availability, diary_*, sessions, profiles, introducers, leads, sms_messages, callbacks, phone_calls, session_advisors, tasks, … | staff / public booking / introducer | **Critical** — every list/book/amend |
| `sessions.functions.ts` | `list*`, `getSession`, `createSession`, `deleteSession`, allocate/transfer, invites, notes, journey, `listCustomersForAdmin`, soft-delete staff | sessions, answers, messages, roles, advisors, introducers, invites, contact logs, milestones | staff auth | Tenant on all session/customer ops |
| `finance.functions.ts` | fees, ledger, rates, payouts, RAF bonus, audit | finance_*, commission_*, referrals, sessions | finance perms | Tenant on all money rows |
| `network-commission.functions.ts` | statements, AI parse, allocate, validate | network_commission_* | finance perms | Tenant |
| `comms.functions.ts` / `comms.server.ts` | templates, settings, send-path reads | communication_* | comms perms | Per-tenant |
| `diary-settings.functions.ts` | `getAdvisorDiarySettings`, `saveAdvisorDiarySettings` | diary_*, availability | adviser/admin | Adviser’s tenant |
| `case-details.functions.ts` | `getCaseMortgageDetails`, `upsertCaseMortgageDetails` | case_mortgage_details, lender_* | staff | Session tenant |
| `introducer.functions.ts` | portal, leads, `resolveReferralSlug`, calculator lead | introducers, leads | introducer/admin | Introducer tenant |
| `introducer-customer.functions.ts` | lookup/amend links, commission refresh | links, introducers, rates | staff | Tenant |
| `introducer-attribution.ts` | attribution writes | links, sessions, appointments, leads | server callers | Tenant at create |
| `introducer-calculator-lead.server.ts` | calculator leads | introducers, leads | API | slug → tenant |
| `referrals.functions.ts` | RAF create/claim/list/text | referral_codes, referrals, profiles | auth/admin | Tenant |
| `relationship.functions.ts` | pipeline refresh | case details, sessions | relationship perm | Tenant filter |
| `journey-analytics.functions.ts` | `listJourneyAnalyticsLeads` | sessions, milestones | owner/supervisor | Tenant / platform aggregate |
| `telephony.functions.ts` | softphone, voicemails, GDPR export | phone_calls, profiles, sessions | staff | Tenant |
| `telephony-manage.functions.ts` | control panel, provision numbers, routing | telephony_*, advisor_telephony | admin | Manual class + tenant |
| `telephony-routing.server.ts` / inbound voicemail / SMS | routing + inbound | phone_calls, callbacks, sms_messages | Twilio sig | Map **number → tenant** |
| `routes/api/twilio/voice/*` | outbound, status | phone_calls, telephony | Twilio | Number/call → tenant |
| `routes/api/sms/inbound.ts` | inbound SMS insert | sms_messages | Twilio | Number → tenant |
| `sms.server.ts` | outbound send + log | profiles, sms_messages | callers | Tenant denorm on insert |
| `teams-calendar.server.ts` | OAuth tokens / sync | advisor profiles / tokens | adviser | Adviser tenant |
| `staff-contact-tasks.*` | complete / list open | staff_contact_tasks | staff | Tenant |
| `view-as-audit.functions.ts` | list/record view-as | view_as_audit_log | platform/tenant admin | Tag tenant |
| `test-accounts.functions.ts` | provision/revoke/reset | many | owner | ME-only or platform-gated |
| `routes/api/auth/request-password-reset.ts` | `auth.admin.generateLink` | auth only | public | N/A business rows |
| `phone-lookup.server.ts` / `phone-call-recording.server.ts` | enrichment / recording meta | phone_calls | server | Tenant |
| `scripts/resync-appointment-teams.ts` | ops script | appointments | CLI | Ops-only; tenant aware |

**Storage / documents:** avatar and any future document buckets must use tenant-prefixed paths and server-side path checks — same assert pattern (client path alone is insufficient).

---

## 10. MFA / TOTP architecture (design only — not enabled)

**Do not enable MFA, change authentication, or convert Super Owner until Gates G7–G10 are individually authorised.**

### 10.1 Proposed TOTP architecture

| Element | Design |
|---------|--------|
| Provider | Supabase Auth MFA — **TOTP** (`supabase.auth.mfa.enroll` / `challenge` / `verify`) |
| Assurance | JWT `aal` claim: **`aal1`** (password/OTP/OAuth only) · **`aal2`** (verified second factor) |
| Detection API | `supabase.auth.mfa.getAuthenticatorAssuranceLevel()` → `currentLevel` / `nextLevel` |
| Enrolment | Create unverified factor → show QR (`totp.qr_code` / secret) → user enters code → verify → factor becomes verified; session promoted to `aal2` |
| Login | Password (or existing first factor) → if verified TOTP exists and `currentLevel=aal1` & `nextLevel=aal2` → challenge → verify → `aal2` |
| Issuer label | e.g. `Mortgage Hub` (or per-tenant display name for tenant staff) |
| Scope | Internal Hub users (roles below). Customers: optional initially |

**Target mandatory MFA roles (after controlled enforcement gate):**

- Super Owner · Super Admin · Company Owner · Supervisor Admin · General Admin · Adviser  

**Not globally enforced** on initial MFA capability ship.

### 10.2 Independence of the three layers

| Layer | Proves | Store / mechanism |
|-------|--------|-------------------|
| **MFA (AAL2)** | **WHO** the user is (stronger identity) | Supabase Auth factors + JWT `aal` |
| **Roles / membership** | **WHAT** they may do | `platform_roles`, `super_admin_tenant_access`, `tenant_memberships` |
| **Tenant data guard** | **WHICH DATA** | RLS + server asserts + scoped service-role queries |

Passing MFA does **not** grant another tenant.  
Having a platform/tenant role does **not** replace MFA when enforcement requires AAL2.  
RLS/service-role scoping must not trust AAL alone.

### 10.3 MFA assurance vs authorisation surfaces

| Surface | Password-only (`aal1`) when MFA required for role | After TOTP (`aal2`) |
|---------|----------------------------------------------------|---------------------|
| `platform_roles` lookup | May resolve role, but **privileged UI/API blocked** until AAL2 (once enforcement on) | Role applies |
| `super_admin_tenant_access` | Grant list visible only after AAL2 for Super Admin | Tenant entry allowed **only** if grant exists |
| `tenant_memberships` | Same — membership ≠ MFA | Tenant staff access if membership + AAL2 when enforced |
| RLS | Prefer policies that require `auth.jwt()->>'aal' = 'aal2'` for privileged tables **only after** enforcement gate; until then dual-run app checks | Full policy |
| Server-side APIs | Middleware: if `roleRequiresMfa(user)` and `currentLevel !== 'aal2'` → 401/403 with `mfa_required` | Proceed + tenant assert |
| Service-role ops | **Still** authenticate user + assert role/membership/grant + tenant scope; **additionally** require AAL2 for privileged ops when enforcement on | Same + AAL2 |

Helper pattern (conceptual): `requireAal2(session)` **and** `requirePlatformRole` / `requireTenantMembership` / `requireSuperAdminGrant` — never one without the other for privileged paths.

### 10.4 Super Owner enrolment sequence (mandatory order)

Never make MFA mandatory for the only Super Owner before this sequence passes.

| Step | Action | Exit check |
|------|--------|------------|
| **A** | Identify `auth.users.id` for `pmabbott2@aol.com` | UUID recorded |
| **B** | Assign `platform_roles.role = super_owner` for that UUID | Row present |
| **C** | Verify normal authentication still works | Password login OK |
| **D** | Verify account resolves as Super Owner (server/diagnose — not email UI check) | Platform role true |
| **E** | Verify access: platform root · ME 001 · TVFS 002 | All three OK |
| **F** | Enrol TOTP via Supabase MFA flow | Unverified factor created |
| **G** | Display QR for authenticator app | User scans |
| **H** | Require valid TOTP to complete enrolment | Factor verified · AAL2 |
| **I** | Sign out completely | No session |
| **J** | Fresh auth: email/password → TOTP → AAL2 → Super Owner platform | Challenge path OK |
| **K** | Re-test 001 and 002 | Both OK |

**Only after A–K** may mandatory MFA enforcement be activated for Super Owner.

### 10.5 Existing-user migration (no sudden enforcement)

```
sign-in (aal1)
  → resolve role (platform_roles / tenant_memberships)
  → if role in MFA-target set AND enforcement flag for that role ON:
        if no verified factor → enrolment journey (QR → verify)
        if verified factor → TOTP challenge → aal2
  → else continue as today
```

| Topic | Design |
|-------|--------|
| Soft launch | Ship enrolment UI with enforcement **OFF**; invite voluntary enrol |
| Per-role flags | e.g. `mfa_required_super_owner`, `mfa_required_adviser`, … flipped independently |
| Partial enrolment | Unverified factors are incomplete — user remains usable at AAL1 until verify succeeds; allow restart; Admin may delete unverified factors |
| Incomplete ≠ lockout | An unfinished enrol must **not** brick the account; only **verified** factors force login challenge |
| Customers | Optional; no mandatory flag initially |

### 10.6 Step-up / sensitive Super Owner operations

**Recommendation:** require **AAL2** for all privileged internal Hub use once enforcement is on, plus **fresh MFA** (re-challenge or max age on TOTP `amr`) for selected high-risk actions — without prompting on every navigation.

| Action | Recommendation |
|--------|----------------|
| Create company | AAL2 + step-up if TOTP verify older than ~15–30 min |
| Create/remove Super Admin / platform roles | AAL2 + step-up |
| Change Company Owner | AAL2 + step-up |
| Reset privileged-user MFA | AAL2 + step-up + audit (see recovery doc) |
| Critical tenant configuration | AAL2 + step-up |
| Routine Super Owner browsing of 001/002 | AAL2 session sufficient (no per-click step-up) |

Implementation options (choose at build time): short-lived “step-up OK” server cookie after `mfa.challenge/verify`, or compare JWT `amr` TOTP timestamp. Prefer server-side enforcement over UI-only.

### 10.7 MFA audit design

Persist security audit events (acting user id + timestamp; never secrets):

| Event |
|-------|
| `mfa_enrolled` |
| `mfa_verified` (successful challenge) |
| `mfa_unenrolled` |
| `mfa_reset_recovery` |
| `mfa_challenge_failed` |
| `platform_role_created` / `platform_role_removed` |
| `super_admin_tenant_grant_added` / `super_admin_tenant_grant_removed` |

### 10.8 Backup / recovery interaction

| Restore path | Restores MFA factors? |
|--------------|----------------------|
| Logical dump `backups/pre-phase1-immediate-baseline-…` | **No** |
| Supabase Pro daily backup / PITR (full project) | **Yes** (for that snapshot) |
| Super Owner lost device | **`docs/SUPER_OWNER_RECOVERY.md`** — Auth Admin factor reset + re-enrol A–K style checks |

### 10.9 Super Owner recovery design (summary)

Full procedure: **`docs/SUPER_OWNER_RECOVERY.md`**.

- Out-of-band identity verification → Auth Admin remove factors (Dashboard or server Admin API) → re-enrol TOTP → sign out → fresh MFA login → verify platform + 001/002 → audit.  
- **Not** an application MFA bypass.

---

## 11. Automated tenant isolation + MFA test plan

### 11.1 Tenant isolation identities (unchanged)

| Identity | Access |
|----------|--------|
| Super Owner | All tenants |
| Super Admin | Grants **001 only** |
| Super Admin | Grants **001 + 002** |
| Mortgage Easy Owner | 001 only |
| Trent Valley Owner | 002 only |
| Mortgage Easy Adviser | 001 scope |
| Trent Valley Adviser | 002 scope |

CRUD attacks on customers, cases, appointments, advisers, introducers, referrals, communications, finance, storage — authorised and unauthorised. URL `/mortgageeasy` → `/trentvalleyfs` and ID swapping must fail at server/RLS.

### 11.2 MFA / authentication extensions

| # | Test | Expected |
|---|------|----------|
| 1 | Super Owner password-only when MFA required | Privileged access denied / challenged — not full platform |
| 2 | Super Owner completes valid TOTP | AAL2 · platform OK |
| 3 | Invalid TOTP | Reject · remain AAL1 |
| 4 | Expired / incorrect TOTP | Reject |
| 5 | Super Admin MFA | Same pattern + grant-scoped tenants only |
| 6 | Tenant Owner MFA | AAL2 + own tenant only |
| 7 | Adviser MFA | AAL2 + adviser scope |
| 8 | MFA user cross-tenant ID/URL attack | **Denied** (membership/RLS) despite AAL2 |
| 9 | Lost-device recovery drill | Per `SUPER_OWNER_RECOVERY.md` · re-enrol · fresh login |
| 10 | Super Owner 001 + 002 after MFA | Both accessible via platform role |

**Critical principle:** MFA ≠ tenant access ≠ data scope — three independent layers.

Gate **G4/G5** require isolation suite green; Gate **G9/G10** require MFA suite green.

---

## 12. Staged implementation plan with hard gates

No stage auto-continues. Each gate needs **explicit approval** + written results.  
**Gate G1 must not start until this MFA addendum is confirmed.**

| Gate | Stage | Allowed work | Exit criteria | Rollback |
|------|-------|--------------|---------------|----------|
| **G0** | Backup readiness | Confirm latest daily backup; prefer enable PITR | Dashboard + dump verified | N/A |
| **G1** | Schema scaffolding | Platform/tenant tables; nullable `tenant_id`; MFA policy flags tables if needed — **no** Auth MFA enablement | Migrations reviewed; **no** backfill; MFA still off | Drop new objects |
| **G2** | Classification sign-off | Orphan/ambiguous + telephony decisions | Signed sheet | N/A |
| **G3** | Data backfill | `tenant_id` for ME; TVFS empty unless justified | Count reports | Null / restore dump |
| **G4** | Server tenant context | Middleware + service-role asserts (**no** RLS cutover) | Isolation dual-run green | Flag off |
| **G5** | RLS cutover | Tenant policies | Isolation suite green | Policies / PITR |
| **G6** | Routing / branding cutover | `/{slug}`; company-aware links | ME+TVFS smoke | Route flag off |
| **G7** | Super Owner **conversion only** | Seed `platform_roles` for UUID of `pmabbott2@aol.com`; retire email authz | Steps A–E pass (password login; platform + 001 + 002) — **MFA not mandatory** | Delete role row |
| **G8** | MFA **capability** | TOTP enrol/verify UI; AAL helpers; audit events; enforcement flags **OFF** | Staff can voluntarily enrol; no lockouts | Hide MFA routes / flags off |
| **G9** | Super Owner **TOTP enrolment** | Execute sequence F–K | Fresh MFA login + 001/002 verified | Unenroll factor via recovery doc if needed |
| **G10** | Mandatory MFA **enforcement** | Flip per-role flags (Super Owner first, then others) | MFA test suite §11.2 green; no Super Owner lockout | Flip flags off |
| **G11** | Production deploy | Azure release of gated work | Post-deploy isolation + MFA smoke | Redeploy `pre-multitenant-baseline` + DB/Auth restore |

**Do not combine G7 + G9 + G10 into one irreversible operation.**  
**Your explicit go required before:** G0→G1 (after MFA design confirmation), G2→G3, G4→G5, G5→G6, G6→G7, G7→G8, G8→G9, G9→G10, G10→G11.

---

## 13. Deliverables checklist (this revision)

| # | Deliverable | Status |
|---|-------------|--------|
| 1 | Proposed TOTP architecture | §10.1–10.3 |
| 2 | Super Owner enrolment sequence | §10.4 |
| 3 | Super Owner recovery design | §10.9 + `docs/SUPER_OWNER_RECOVERY.md` |
| 4 | MFA assurance-level design | §10.2–10.3 |
| 5 | Existing-user migration approach | §10.5 |
| 6 | MFA audit design | §10.7 |
| 7 | Updated implementation gates | §12 (G7–G10 separated) |
| 8 | No authentication changes made | §14 |
| 9 | Phase 1 not started | §14 |
| — | Prior: architecture, 47-table class, service-role inventory, Super Admin model, recovery baseline | §§1–9 |

---

## 14. Explicit non-actions (this turn)

| Action | Done? |
|--------|-------|
| Production schema change / add `tenant_id` | **No** |
| Data migrate / backfill | **No** |
| RLS change | **No** |
| Authentication change | **No** |
| MFA enabled / TOTP enrolled | **No** |
| Super Owner conversion | **No** |
| Routing / branding change | **No** |
| Deploy | **No** |
| Phase 1 / Gate G1 started | **No** |
| Backup data or secrets committed | **No** |

---

## STOP

MFA/TOTP security addendum incorporated into Phase 0 for **approval**.

**Do not start Gate G1** until you explicitly confirm this design.  
**Do not enable MFA, change authentication, or convert Super Owner** until Gates G7–G10 are individually authorised.
