# Gate G6 — Company provisioning, tenant settings & staff invitations

**Status:** Complete (local; not pushed; not Azure-deployed)  
**Branch:** `targeted-features`  
**Base:** `post-g5-tenant-features` → `09e2b3a` (+ local checkpoint commit of early provisioning stubs)  
**Tag:** `post-g6-company-provisioning`  
**Verify:** `node --env-file=.env scripts/g6-company-provisioning-verify.mjs`

G1–G5 remain in force. **G6A staging / G7 Super Owner / MFA / Twilio subaccounts / Azure NOT started.**

---

## Admin inventory (reuse map)

| Surface | Access | Tenant-aware | G6 action |
|---------|--------|--------------|-----------|
| StaffDashboard / Manage | Owner/Supervisor/admin perms | partial→yes | **extend** — Company settings tab |
| InviteStaffCard | invites perm / admin | yes | **reuse** + membership_role |
| TeamRolesPanel / AdminAccessPanel | Owner/Supervisor | partial | **reuse** |
| CommsScriptsPanel | Owner/Supervisor / `comms_templates` | yes | **reuse** (templates); brand wrapper via `tenant_comms_config` |
| ThemeProfilePicker | Owner | no (personal CSS) | **leave** — not firm branding |
| TelephonyManagePanel | Owner | partial | **leave** (+ G6 telephony status placeholder) |
| Finance / Diary / Customers / RAF | operational | partial | **leave** |
| Create Company / `/companies` | Super Owner only | platform | **new** (UI gated; no live SO) |
| Company settings sections | Owner/Supervisor | yes | **new** |

---

## Architecture

| Concern | Module |
|---------|--------|
| Provisioning (SO-gated) | `src/lib/company-provisioning.server.ts` — `provisionCompany`, `provisionTenantInternal`, `destroyProvisionedTenant` |
| Company settings | `src/lib/company-settings.server.ts` |
| UI | `CompanySettingsPanel`, `CreateCompanyWizard` |
| Invite binding | `staff_invitations.membership_role` + `sessions.functions.ts` |
| Code allocator | `allocate_next_company_code()` (advisory lock) |

**Create Company** requires `is_super_owner`. No current user qualifies. Tenant Owner **cannot** provision. Tests use `provisionTenantInternal` / service-role harness with full rollback.

---

## Wizard (future Super Owner)

Steps: Type → Details → Branding → Regulatory → Features → Comms → Initial Owner → Review → Create.

- Default licensee type: **EXTERNAL**
- GROUP ≠ copy Mortgage Easy
- Neutral defaults only; explicit feature opt-in
- Initial Owner → tenant-bound invite (`role=admin`, `membership_role=owner`); membership only on accept

Route: `/_authenticated/companies` — shows deny shell without platform authority.

---

## Company code & slug

- Codes: zero-padded `001`…`999` via `allocate_next_company_code()` + `pg_advisory_xact_lock`
- Immutable after activation (no Owner edit)
- Slugs: lowercase URL-safe; reserved set includes `auth`, `api`, `home`, `companies`, `settings`, …
- Preview: `mymortgagehub.uk/[slug]`
- Collision / reserved → DENY

---

## Company settings (Owner / Supervisor)

Sections: Overview, Details, Branding, Regulatory, Features & Journeys, Communications, Staff & Access, Telephony (placeholder).

**Not editable by tenant Owner:** `tenant_type`, `status`, `company_code` (platform-controlled).

### Regulatory

Editable fields on `tenants` + `tenant_settings.regulatory` JSON. Empty → **Not configured** (not presented as complete). Trent Valley gaps remain empty until user-supplied — **not invented**.

### Branding

`tenant_branding` paths/colours. Static/repo assets retained. **No unsafe Storage upload** in G6. Future: tenant-namespaced Storage.

### Features & Journeys

Uses `feature_catalogue` + `tenant_features` only.

| Authority | Model |
|-----------|--------|
| Owner / Supervisor | ON/OFF → `enabled` / `disabled` |
| Future Super Owner | full states incl. entitlement/rollout |
| General Admin / Adviser / Introducer / Customer | no company feature admin |

`password_recovery` cannot be turned off here. Soft dependency notes shown (booking/Teams, case hub/portal, telephony/SMS, Susan services). Changing features feeds G5 resolver → UI/route/API.

001’s 23 seeded rows remain configuration (not hard-coded ME behaviour). 002 Susan stays **OFF**.

### Communications

`tenant_comms_config` (+ sync legacy `communication_settings` footers). No provider secrets. Brand wrapper ≠ message templates (Marketing → Scripts unchanged).

### Telephony

Informational only. Twilio freeze.

---

## Invitations & membership

| Invite | app_role | membership_role |
|--------|----------|-----------------|
| Initial Owner (provisioning) | admin | **owner** |
| General Admin staff | admin | **general** (fixed; was incorrectly owner) |
| Supervisor staff | admin | supervisor |
| Adviser | advisor | adviser |
| Introducer | introducer | introducer |

Security preserved: token → one tenant + role; expiry; single use; `withForcedTenantId`; slug/code URL cannot rebind tenant.

Existing Auth user + new invite → **additional membership**, no duplicate Auth.

### Remove / revoke

`revokeTenantStaffAccess`: sets `tenant_memberships.active=false` for **this tenant only**. Never `auth.admin.deleteUser`. Historical cases/comms retained. Soft-delete advisor/introducer bins remain separate.

---

## Permission matrix (G6 sections)

| Role | Create Company | Company settings | Features | Staff revoke | Invites | Scripts |
|------|----------------|------------------|----------|--------------|---------|---------|
| Super Owner (future) | YES | platform | full states | platform | — | — |
| Owner | DENY | YES | ON/OFF | YES (non-owner) | YES | YES |
| Supervisor | DENY | YES | ON/OFF | DENY | per perms | YES |
| General Admin | DENY | DENY | DENY | DENY | if `invites` | if `comms_templates` |
| Adviser | DENY | DENY | DENY | DENY | DENY | DENY |
| Introducer | DENY | DENY | DENY | DENY | DENY | DENY |
| Customer | DENY | DENY | DENY | DENY | DENY | DENY |

---

## Atomic provisioning

validate → tenant → branding → comms → settings → features → owner invite; on failure → destroy partial tenant.

---

## Tests

`scripts/g6-company-provisioning-verify.mjs` — EXTERNAL/GROUP fixtures, code uniqueness, slug/reserved deny, feature→G5, isolation, support grant wall, invite matrix, cleanup. **No 7th Auth user. No persistent 003.**

Regressions: G5, G4A, G4, G3 — PASS.

---

## Migrations

| ID | Purpose |
|----|---------|
| `20260918120000_gate_g6_company_provisioning` | `allocate_next_company_code`, `tenant_settings.regulatory` |
| `20260918123000_gate_g6_invite_membership_role` | `staff_invitations.membership_role` |

No RLS weaken, no platform_roles, no MFA, no Twilio changes.

---

## Type debt

G5 reported ~13 untyped bridges. G6 reuses `supabaseAdminUntyped` in provisioning/settings (canonical pattern). Count of files using untyped/any bridges remains elevated pending type regen — **pre-production cleanup still required**. Do not expand `as any` beyond this pattern.

---

## Staging readiness

**STAGING READY FOR G6A: NO**

Blockers: Twilio isolation, Graph isolation, outbound email isolation, webhooks, secrets strategy, 002 test identity/membership, 002 regulatory content (editable but empty), type debt, staff nav polish, Susan/avatar staging, Supabase staging project.

---

## Rollback

1. Destroy any fixture tenants (`destroyProvisionedTenant` / verify cleanup).  
2. Revert git to `post-g5-tenant-features`.  
3. Optional: drop `membership_role` column / allocator function if abandoning G6.  
4. Restore `backups/post-g5-tenant-features-20260918T100326Z/` if needed.

---

## Confirmations

- Owner retains 001 access; 002 memberships = 0; platform_roles = 0  
- Super Owner NOT started; MFA OFF  
- Twilio / Graph unchanged; no real SMS/email/Teams  
- No EXTERNAL / 003 persists; Auth users = 6  
- NO Azure; G6A/G7 NOT STARTED
