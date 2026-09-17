# Mortgage Hub — Multi-tenant Phase 0 (revised)

**Status:** Architecture approved in principle · **pre-Phase-1 amendments incorporated** · **STOPPED — awaiting final approval to start Phase 1**  
**Revised:** 2026-09-17  
**Do not implement** until explicit Phase 1 authorisation.

| Baseline | Value |
|----------|--------|
| Git tag | `pre-multitenant-baseline` |
| Git SHA | `244ceaa456486c5c7cb9c416b7ff766a10427eeb` |
| Azure deploy | Mortgagehub-prod · Actions run #29 · same SHA |
| Immediate logical dump | `backups/pre-phase1-immediate-baseline-20260917T164555Z/` (gitignored) |

Canvas companion (earlier overview): `multi-tenant-phase0-architecture.canvas.tsx` — this markdown is now the **authoritative** Phase 0 document.

---

## 1. Recovery baseline (current)

### 1.1 Supabase plan & scheduled backups

| Check | Result |
|-------|--------|
| Organisation plan | **Pro** (upgraded; verified) |
| Project | `tiuplmftooauihulhtws` · ACTIVE_HEALTHY · eu-west-1 |
| Automatic daily backups | **Active** |

**Confirmed scheduled backups (COMPLETED):**

| Completed (UTC) | Status |
|-----------------|--------|
| 2026-09-17 05:04:38 | COMPLETED |
| 2026-09-16 05:05:33 | COMPLETED |

Latest platform restore point available at documentation time: **17 Sep 2026 05:04:38 UTC**.

### 1.2 Immediate pre-Phase-1 offline logical dump

| Field | Value |
|-------|--------|
| UTC | **2026-09-17 16:45:55 UTC** |
| UK | **2026-09-17 17:45:55 BST** |
| Location | `backups/pre-phase1-immediate-baseline-20260917T164555Z/` |
| Tables | **47/47** public |
| Rows | **1,632** (matched live SQL counts) |
| Checksums | **PASS** |
| Auth metadata | **22 users** (ids/emails/providers — not password hashes) |
| Gitignored | Yes — **not** committed to GitHub |
| Phase 1 | **Not started** |

Paired with Git migrations under `schema_from_git/migrations/` inside that folder. Separate from earlier dump `backups/pre-multitenant-baseline-20260917/`.

### 1.3 What is / is not protected

| Layer | Protected by |
|-------|----------------|
| Application code | Git tag `pre-multitenant-baseline` |
| Postgres data + schema (platform restore) | Pro daily backups |
| Public business rows (offline) | Immediate logical dump |
| Auth users as in DB | Pro daily backup restore |
| Auth identity inventory (offline) | Dump metadata JSON |

**Not in offline dump / not revived by DB-only restore of Storage:**

- Auth password hashes / MFA factors / sessions (offline dump)
- **Supabase Storage file bytes** (e.g. avatars)
- Azure App Settings / GitHub secrets
- Dashboard Auth URL Configuration
- Edge Function deploy artefacts

### 1.4 PITR recommendation (unchanged)

**Enable PITR** (7-day+) before high-risk Phase 1 stages (backfill / RLS cutover). Available as Pro add-on; not confirmed enabled at last check.

### 1.5 Git restore

```bash
git fetch github --tags
git checkout -b recover/pre-mt pre-multitenant-baseline
npm ci && npm run build
# redeploy Azure from that commit via Actions
```

---

## 2. Decisions locked for implementation (when approved)

| # | Decision | Status |
|---|----------|--------|
| Super Admin access | **Option B — explicit tenant grants only** | Approved |
| Super Owner identity | `pmabbott2@aol.com` → platform `super_owner` (secure storage; **do not convert yet**) | Confirmed |
| Tenant 001 | Mortgage Easy · code `001` · slug `mortgageeasy` | Confirmed |
| Tenant 002 | Trent Valley Financial Services · code `002` · slug `trentvalleyfs` | Confirmed |
| TVFS data at cutover | **Empty CRM** unless classification finds genuine TVFS-owned rows | Confirmed |
| ME data | Classify then backfill — **do not assume** all 1,632 rows are ME without validation | Confirmed |

---

## 3. Super Admin membership model (final recommendation)

### Recommendation: **B — separate `super_admin_tenant_access`**

Keep **two distinct concepts**:

1. **`platform_roles`** — `super_owner` | `super_admin` (platform identity; never email string in client).
2. **`tenant_memberships`** — membership of a company as Owner / Supervisor / General / Adviser / Introducer (staff of that firm).
3. **`super_admin_tenant_access`** — `(user_id, tenant_id)` grants for Super Admins only.

**Do not** put Super Admin grants into `tenant_memberships`.

| Why not `tenant_memberships` for Super Admin? | Why separate grants? |
|-----------------------------------------------|----------------------|
| Pollutes “staff of company” lists and invite UX | Single clear source for cross-company access |
| Ambiguous semantics (staff role vs platform delegate) | Super Owner needs **no** grant rows (all tenants) |
| Risk of double-counting in reports / billing / RLS | RLS: `is_super_owner()` OR (`is_super_admin()` AND grant exists) OR membership |
| Harder least-privilege audits | Revoking Super Admin = delete platform role + grants |

**Security rule:** one authoritative path per question:

- “Is this user a platform Super Admin?” → `platform_roles`
- “Which companies may this Super Admin enter?” → `super_admin_tenant_access` only
- “Is this user staff of company X?” → `tenant_memberships` only

Never trust client-supplied `tenant_id` without server validation against one of those sources.

---

## 4. Super Owner (design only — no conversion yet)

- Seed (later) `platform_roles` for the user id of `pmabbott2@aol.com` with `super_owner`.
- Resolve via SECURITY DEFINER helpers / JWT claims — **not** `email === …` in frontend.
- Retire `ADMIN_EMAILS` / builtin email list as ongoing authz (bootstrap-only at most).
- **Do not convert the account until the Super Owner conversion gate.**

---

## 5. Revised architecture (summary)

```
Mortgage Hub (mymortgagehub.uk)
├── platform_roles (super_owner, super_admin)
├── super_admin_tenant_access (Option B grants)
├── tenants (uuid, company_code, slug, name, status, …)
├── tenant_memberships (user ↔ tenant ↔ tenant_role)
├── tenant_branding + tenant_comms_config + tenant_settings
└── business data (tenant_id on ownership roots; RLS + server asserts)
```

- One app, one codebase, many tenants.
- URL `/{slug}/…` sets **context only** after authz.
- Public ME / TVFS websites stay separate; CTAs deep-link into Hub tenant routes.
- Existing introducer `company_code` (4-digit introducer firm code) ≠ tenant `company_code` (`001`/`002`).

---

## 6. Forty-seven table migration classification

Row counts from live DB at immediate baseline (**2026-09-17 16:45:55 UTC**).  
**No backfill performed.**

### Legend

| Class | Meaning |
|-------|---------|
| TENANT OWNED | Explicit `tenant_id` on row |
| TENANT INHERITED | Tenant via mandatory parent; may still denormalise `tenant_id` for RLS |
| PLATFORM LEVEL | Platform-wide (Super Owner tooling) |
| SHARED/GLOBAL | Candidate to become per-tenant copy or stay global with care |
| SYSTEM/TECHNICAL | Operational / restore markers |
| REQUIRES MANUAL DECISION | Needs human classification before backfill |

### 6.1 Manifest

| Table | Rows | Class | Ownership root | Explicit `tenant_id`? | Proposed FK / index | Backfill rule (later) | Validation |
|-------|------|-------|----------------|----------------------|---------------------|------------------------|------------|
| profiles | 22 | TENANT OWNED* | User in tenant context | Yes (nullable→NOT NULL for staff/customers in tenants) | FK→tenants; idx(tenant_id) | Map via roles/sessions; orphans → review | Every profile with role in tenant has membership |
| user_roles | 30 | TENANT INHERITED / PLATFORM | user_id | Prefer membership table over extending roles | — | Migrate staff roles into `tenant_memberships`; keep app_role transitional | No dual conflicting role |
| admin_profiles | 2 | TENANT OWNED* | admin user | Yes (tenant Owner/Supervisor/General) | FK→tenants | Map current owner/supervisor to ME 001 | Platform roles separate |
| admin_permissions | 15 | TENANT INHERITED | admin_profiles | Yes (denorm) or via admin user | idx(tenant_id) | Same tenant as admin_profiles | Permission rows match admin tenant |
| advisor_profiles | 4 | TENANT OWNED | adviser user | Yes | FK→tenants; unique(tenant_id, code) | All current → ME 001 unless flagged | Codes unique per tenant |
| advisor_availability | 20 | TENANT INHERITED | advisor_id | Yes denorm | idx(tenant_id, advisor_id) | From advisor_profiles.tenant_id | No cross-tenant advisor_id |
| advisor_diary_settings | 0 | TENANT INHERITED | advisor_id | Yes denorm | idx(tenant_id, advisor_id) | From adviser | — |
| advisor_diary_exceptions | 0 | TENANT INHERITED | advisor_id | Yes denorm | idx(tenant_id, advisor_id) | From adviser | — |
| advisor_notes | 3 | TENANT INHERITED | session / advisor | Yes denorm via session | idx(tenant_id) | From interview_sessions | Session tenant match |
| advisor_contact_views | 40 | TENANT INHERITED | advisor / session | Yes denorm | idx(tenant_id) | From adviser or session | — |
| advisor_telephony | 1 | TENANT OWNED | adviser | Yes | FK→tenants | ME 001 | — |
| appointments | 11 | TENANT OWNED | appointment | Yes | FK→tenants; idx(tenant_id, starts_at) | From advisor_id / session | Advisor & session same tenant |
| interview_sessions | 40 | TENANT OWNED | case/session | Yes | FK→tenants; idx(tenant_id, customer_id) | From customer/introducer/staff path | Customer membership match |
| interview_messages | 746 | TENANT INHERITED | session | Yes denorm recommended | idx(tenant_id, session_id) | From session | Count integrity |
| interview_answers | 356 | TENANT INHERITED | session | Yes denorm recommended | idx(tenant_id, session_id) | From session | — |
| session_advisors | 24 | TENANT INHERITED | session | Yes denorm | idx(tenant_id) | From session | Advisers same tenant |
| session_contact_tracking | 14 | TENANT INHERITED | session | Yes denorm | idx(tenant_id) | From session | — |
| customer_contact_log | 68 | TENANT INHERITED | customer/session | Yes denorm | idx(tenant_id) | From customer/session | — |
| customer_journey_milestones | 7 | TENANT INHERITED | session | Yes denorm | idx(tenant_id) | From session | — |
| case_mortgage_details | 0 | TENANT INHERITED | session | Yes denorm | idx(tenant_id) | From session | — |
| callback_requests | 19 | TENANT OWNED | callback | Yes | FK→tenants | From session/advisor/phone | — |
| phone_calls | 24 | TENANT OWNED | call | Yes | FK→tenants | From adviser / routing | — |
| sms_messages | 53 | TENANT INHERITED | appointment/lead | Yes denorm | idx(tenant_id) | From appointment/lead | — |
| staff_contact_tasks | 8 | TENANT OWNED | task | Yes | FK→tenants | From session/advisor | — |
| introducers | 4 | TENANT OWNED | introducer | Yes | FK→tenants; keep legacy `company_code` as introducer-firm code | All → ME 001 unless audit says else | Slug unique per tenant |
| introducer_leads | 3 | TENANT INHERITED | introducer | Yes denorm | idx(tenant_id, introducer_id) | From introducer | — |
| customer_introducer_links | 4 | TENANT INHERITED | introducer + customer | Yes denorm | idx(tenant_id) | From introducer | Both sides same tenant |
| introducer_amendment_history | 1 | TENANT INHERITED | link | Yes denorm | idx(tenant_id) | From link | — |
| referral_codes | 2 | TENANT OWNED | RAF code | Yes | FK→tenants; unique(tenant_id, code) | ME 001 | — |
| referrals | 1 | TENANT INHERITED | referral_codes | Yes denorm | idx(tenant_id) | From code | — |
| staff_invitations | 2 | TENANT OWNED | invite | Yes **immutable** | FK→tenants | Set from issuer tenant | Token cannot change tenant |
| finance_fee_lines | 8 | TENANT INHERITED | session | Yes denorm | idx(tenant_id, session_id) | From session | — |
| finance_ledger | 19 | TENANT OWNED | ledger row | Yes | FK→tenants; idx(tenant_id, status) | From session/beneficiary | Amounts reconcile |
| finance_audit_log | 9 | TENANT OWNED | audit | Yes | FK→tenants | From actor context | — |
| finance_settings | 1 | SHARED→TENANT | settings | **Per-tenant row** (replace singleton) | PK(tenant_id) or (tenant_id, key) | Copy current into ME 001 | TVFS gets defaults on provision |
| commission_rates | 3 | TENANT OWNED | rate | Yes | unique(tenant_id, subject…) | ME 001 | — |
| commission_rate_history | 16 | TENANT INHERITED | rates | Yes denorm | idx(tenant_id) | From rates | — |
| network_commission_statements | 1 | TENANT OWNED | statement | Yes | FK→tenants | ME 001 | — |
| network_commission_lines | 0 | TENANT INHERITED | statement | Yes denorm | idx(tenant_id) | From statement | — |
| communication_settings | 1 | SHARED→TENANT | branding/comms | **Per-tenant** (replace id=1 singleton) | PK tenant_id | Copy into ME 001 | TVFS defaults on provision |
| communication_templates | 16 | TENANT OWNED | template | Yes | unique(tenant_id, template_key) | Clone to ME 001 | — |
| communication_template_versions | 0 | TENANT INHERITED | template | Yes denorm | idx(tenant_id) | From template | — |
| telephony_numbers | 2 | REQUIRES MANUAL DECISION | number | Likely TENANT OWNED or PLATFORM pool | TBD | Audit DID ownership ME vs shared Hub | Explicit assignment |
| telephony_routing_settings | 1 | REQUIRES MANUAL DECISION | routing | Tenant or platform | TBD | Same as numbers | — |
| lender_remortgage_policies | 1 | SHARED/GLOBAL or TENANT | policy | Prefer TENANT OWNED copy | FK→tenants optional | Start as ME copy; allow global later | — |
| view_as_audit_log | 27 | TENANT OWNED + platform | audit | Yes + nullable for platform-only | idx(tenant_id) | From viewed user’s tenant | Super Owner actions tagged |
| platform_restore_points | 3 | SYSTEM/TECHNICAL | platform | No | — | Leave global | — |
| journey analytics inputs | (via sessions) | TENANT INHERITED | sessions | via session | — | — | — |

\*Profiles/admin_profiles: platform Super Owner/Admin users may have **null** `tenant_id` on profile and only `platform_roles` (+ grants). Tenant staff/customers must have tenant scope via membership.

### 6.2 Backfill principle

Do **not** blindly assign all 1,632 rows to Mortgage Easy. Sequence:

1. Create tenants 001 / 002.
2. Nullable `tenant_id` columns.
3. Deterministic rules (adviser email domain, introducer slug, session attribution).
4. Orphan / ambiguous queue for manual decision.
5. Dual-run filters → RLS → NOT NULL.

TVFS 002 starts with **zero** migrated CRM rows unless the classification audit finds genuine TVFS-owned records.

---

## 7. Company provisioning — minimum dataset

When Super Owner creates Tenant 003+:

| Area | Fields |
|------|--------|
| Identity | `tenant_id`, `company_code` (next), `slug`, `company_name`, `trading_name`, `status` |
| Web | `website_url` (Back / Return destination) |
| Brand | logo (Storage path), primary_colour, secondary_colour |
| Contact | company_email, telephone |
| Regulatory | legal_name, fca_details, email_footer, sms_footer / disclosures |
| Comms | default templates cloned from platform seed; from-name; regulatory footers |
| Settings | diary defaults, feature flags, telephony defaults (if any) |
| People | invite Owner (`staff_invitations` with **immutable** `tenant_id`) |

**Flow:** Create Company → configure → invite Owner → Owner accepts → Owner invites staff. No developer DB work.

---

## 8. Company-aware links

All of the following must resolve from **tenant configuration / tenant context**, not hard-coded Mortgage Easy:

| Surface | Today (single-tenant) | Target |
|---------|----------------------|--------|
| Back / Return to website | Often ME marketing / MMH | `tenant.website_url` |
| Introducer | `/go/{slug}`, `/book/{slug}` | `/{tenantSlug}/go/…`, `/{tenantSlug}/book/…` |
| Customer journeys | Hub + marketing `?ref=` | Tenant-scoped Hub + configured public site |
| Appointment / Teams SMS | `getAppBaseUrl()` | Tenant-aware public Hub URL + tenant brand in copy |
| RAF | `/raf/{code}` | `/{tenantSlug}/raf/{code}` |
| Marketing / Scripts | Global templates | Per-tenant templates + branding |
| Email / SMS links | MMH + ME footers | Tenant footers + links |
| Referral / booking links | Origin-based | Origin + tenant slug; invite/referral bind tenant_id server-side |

Changing slug in the URL must **not** reassign data; only membership/grants authorise.

---

## 9. Introducer ownership chain

```
Tenant
  → Introducer (tenant_id immutable; legacy introducers.company_code remains introducer-firm code ≠ 001/002)
    → Introducer link (/go|/book under tenant slug)
      → Lead / Customer (tenant_id from introducer at creation)
        → Case (interview_sessions.tenant_id)
```

Preserve current introducer portal behaviour; add immutable tenant ownership; never use introducer `company_code` as platform tenant key.

---

## 10. Service-role access inventory

**Fact:** `supabaseAdmin` (`SUPABASE_SERVICE_ROLE_KEY`) bypasses RLS. Key must remain **server-only** (never client bundles).

**Mandatory pattern before any tenant-owned write/read via service role:**

1. Authenticate user (or verify Twilio signature for webhooks).
2. Resolve `activeTenantId` from membership / Super Admin grant / Super Owner — **never** raw client body alone.
3. Assert permission for operation.
4. Scope every query with `tenant_id` (and parent FKs).
5. Reject mismatches.

### 10.1 Modules using `supabaseAdmin` (inventory)

| Module | Representative operations | Tables (non-exhaustive) | Auth today | Tenant assert required |
|--------|---------------------------|-------------------------|------------|------------------------|
| `admin.functions.ts` | list/set admins, permissions, diagnose | profiles, user_roles, admin_*, staff_invitations | requireSupabaseAuth + owner/supervisor | Platform vs tenant admin split |
| `auth.functions.ts` | SMS login, generateLink | profiles, auth.admin | mixed | Tenant from user membership when applicable |
| `booking.functions.ts` | slots, book, contacts, diary lists, SMS | appointments, availability, sessions, profiles, introducers, sms_messages, callbacks, phone_calls, … | auth / public booking / staff | **High risk** — every book/list/amend |
| `sessions.functions.ts` | CRM sessions, invites, allocate, delete | sessions, roles, invites, advisors, … | staff auth | Tenant on all session ops |
| `finance.functions.ts` | fees, ledger, rates, RAF bonus | finance_*, commission_*, referrals | finance perms | Tenant on all money rows |
| `network-commission.functions.ts` | statements, allocate | network_commission_* | finance perms | Tenant |
| `comms.functions.ts` / `comms.server.ts` | templates, footers | communication_* | comms perms | Per-tenant templates |
| `diary-settings.functions.ts` | availability settings | diary_*, availability | adviser/admin | Adviser’s tenant |
| `case-details.functions.ts` | mortgage details, lender policies | case_mortgage_details, lender_* | staff | Session tenant |
| `introducer.functions.ts` | portal, leads, referrals | introducers, leads | introducer/admin | Introducer tenant |
| `introducer-customer.functions.ts` | link customers | links, introducers | staff | Tenant |
| `introducer-attribution.ts` | attribution writes | links, sessions, appointments, leads | server callers | Tenant at create |
| `introducer-calculator-lead.server.ts` | calculator leads | introducers, leads | API | Slug→tenant |
| `referrals.functions.ts` | RAF | referral_codes, referrals, profiles | auth/admin | Tenant |
| `relationship.functions.ts` | renewals pipeline | case details, sessions | relationship perm | Tenant filter |
| `journey-analytics.functions.ts` | analytics | sessions, milestones | owner/supervisor | Tenant / aggregate for platform |
| `telephony*.ts` / inbound voicemail / SMS routes | voice, SMS webhooks | phone_calls, callbacks, sms_messages, profiles | Twilio sig / staff | Map number→tenant; assert |
| `teams-calendar.server.ts` | OAuth tokens | advisor profiles / token store | adviser | Adviser tenant |
| `sms.server.ts` | outbound SMS log | profiles, sms_messages | callers | Tenant denorm on insert |
| `staff-contact-tasks.*` | tasks | staff_contact_tasks | staff | Tenant |
| `view-as-audit.functions.ts` | view-as audit | view_as_audit_log | platform/tenant admin | Tag tenant |
| `test-accounts.functions.ts` | provision/revoke tests | many | owner | Tenant ME only / platform |
| `api/auth/request-password-reset.ts` | recovery links | auth.admin | public | N/A tenant data read |
| `phone-lookup` / `phone-call-recording` | call enrichment | phone_calls | server | Tenant |

Webhook note: Twilio routes authenticate by signature, not Hub user — resolve tenant from **telephony_numbers** (or equivalent) mapping, not client input.

---

## 11. Automated tenant isolation test plan

Mandatory suite (CI) with identities:

| Identity | Access |
|----------|--------|
| Super Owner | All tenants |
| Super Admin | Grants **001 only** |
| Super Admin | Grants **001 + 002** |
| ME Owner / TVFS Owner | Own tenant |
| ME Adviser / TVFS Adviser | Own tenant scope |

For each, attempt authorised **and** unauthorised SELECT/INSERT/UPDATE/DELETE on representatives:

customers (profiles/sessions), cases, appointments, advisers, introducers, referrals, communications, finance/commission, storage paths.

**Explicit attacks:**

- Navigate/API as ME user with `tenantSlug=trentvalleyfs` or TVFS ids.
- Swap session/appointment UUIDs across tenants.

**Pass criteria:** failure at **server assert and/or RLS**, not merely empty UI.

---

## 12. Staged implementation plan with **hard gates**

No stage auto-continues past a gate without **explicit approval** and a written result report.

| Gate | Stage | Allowed work | Exit criteria | Rollback |
|------|-------|--------------|---------------|----------|
| **G0** | Backup readiness | PITR enable (optional but recommended); confirm latest daily backup | Dashboard backup + dump verified | N/A |
| **G1** | Schema scaffolding | New platform/tenant tables; **nullable** tenant_id columns only | Migrations on branch/preview; no backfill | Drop new objects |
| **G2** | Classification sign-off | Complete orphan/ambiguous review for 47 tables | Signed classification sheet | N/A |
| **G3** | Data backfill | Populate tenant_id for ME; TVFS empty unless justified | Zero unexplained nulls on roots; count reports | Null out tenant_id / restore dump |
| **G4** | Server tenant context | Middleware + service-role asserts (no RLS cutover yet) | Isolation tests dual-run (app filter) | Feature flag off |
| **G5** | RLS cutover | Tenant policies enforced | Full isolation suite green | Disable new policies / PITR |
| **G6** | Routing / branding cutover | `/{slug}` shell; website_url backs; link migration | ME+TVFS smoke; no hard-coded ME where config required | Route flag off |
| **G7** | Super Owner conversion | Seed platform_roles; retire email authz | Diagnose + login checks | Revert role row |
| **G8** | Production deploy | Azure release | Post-deploy isolation smoke | Redeploy `pre-multitenant-baseline` + DB restore |

**Checkpoints requiring your explicit go:** G0→G1, G2→G3, G4→G5, G5→G6, G6→G7, G7→G8.

---

## 13. Final Super Admin recommendation (summary)

- **Option B** with **`super_admin_tenant_access`** (not `tenant_memberships`).
- Super Owner: platform-wide, no grant rows required.
- Super Admin: platform role + explicit per-tenant grants only.

---

## 14. Confirmation checklist

| Item | Status |
|------|--------|
| Architecture approved in principle | Yes |
| Pre-Phase-1 amendments incorporated in this doc | Yes |
| Recovery baseline current (Pro + scheduled backups + immediate dump) | Yes |
| 47-table classification produced | Yes |
| Service-role inventory produced | Yes |
| Super Admin model finalised | Yes — separate grants table |
| Phase 1 started | **No** |
| Schema / RLS / auth / routing / branding / deploy changed | **No** |
| Super Owner converted | **No** |

---

## STOP

This document is the revised Phase 0 proposal for **final approval**.

**Do not start Phase 1** until you explicitly authorise Gate G0/G1.
