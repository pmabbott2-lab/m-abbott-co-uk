# Mortgage Hub — Tenant classification & EXTERNAL data wall

**Status:** Design approved · **Gate G1A schema applied** · **G2 not started** · no business backfill  
**Revised:** 2026-09-17 (G1A)  
**Depends on:** Gate G1 scaffolding (`post-g1-multitenant-scaffolding`) · `docs/MULTI_TENANT_PHASE0.md`

This document amends the approved multi-tenant architecture **before Gate G2**.  
It does **not** authorise migrations, backfill, RLS cutover, auth, MFA, or Azure deploy.

---

## 1. Recommended GROUP / EXTERNAL model

### 1.1 Enum (preferred)

```text
tenant_type: GROUP | EXTERNAL
```

Add as `public.tenant_type` enum + `tenants.tenant_type NOT NULL` (future migration, **not G1/G2 until authorised**).

| Value | Meaning |
|-------|---------|
| **GROUP** | Companies inside the Mortgage Hub commercial group (shared platform ops; Super Owner may routinely access business data) |
| **EXTERNAL** | Independently owned firms licensing Mortgage Hub (strong data wall; no routine platform access to customer/business data) |

### 1.2 Initial classification (when column is added)

| Code | Slug | Name | Type |
|------|------|------|------|
| 001 | mortgageeasy | Mortgage Easy | **GROUP** |
| 002 | trentvalleyfs | Trent Valley Financial Services | **GROUP** |

Future independently owned licensees → **EXTERNAL** by default.

### 1.3 Why enum on `tenants` (not a side table)

- Single source of truth next to `company_code` / `slug`
- Easy in RLS / helpers: `tenants.tenant_type`
- Provisioning forces an explicit choice at Create Company
- Avoids dual classification stores

`company_code` / `slug` remain **identifiers only** — not security boundaries.  
`tenant_id` (UUID) remains the immutable ownership key.

---

## 2. EXTERNAL data wall (architecture)

### 2.1 Principle

For **EXTERNAL** tenants, isolation must fail closed at **database RLS and server asserts**, not UI hiding.

An EXTERNAL company is isolated from:

- Mortgage Easy (001)  
- Trent Valley FS (002)  
- every other EXTERNAL tenant  
- routine Mortgage Hub platform-operator browsing of its business data  

Applies to all tenant-owned domains: customers, leads, cases, advisers, admins, introducers, referrals, appointments, communications, voice/SMS, documents/Storage, finance, commissions, marketing, reporting, diary, and other operational data.

### 2.2 Two authority planes

| Plane | Question | Typical grant |
|-------|----------|----------------|
| **Platform administration** | May this user administer the *tenant as a platform object*? | Super Owner always; Super Admin with admin-scoped grant |
| **Business data access** | May this user read/write *customer/operational rows* for this tenant? | Tenant membership; Super Owner for **GROUP** only; EXTERNAL only via explicit support/emergency grant |

**Critical:** Platform administration ≠ business-data access for EXTERNAL tenants.

### 2.3 Proposed helper split (amend G1 before G5 RLS)

G1 shipped:

- `is_super_owner(uid)`
- `can_access_tenant(uid, tenant_id)` ← **too coarse for EXTERNAL**

**Required amendment (design; implement before RLS cutover):**

| Helper | Meaning |
|--------|---------|
| `can_administer_tenant(uid, tenant_id)` | Platform ops: config, status, licensing, Owner identity, health, features |
| `can_access_tenant_data(uid, tenant_id)` | Business rows / Storage paths for that tenant |
| `can_access_tenant` | **Deprecate or redefine** as alias of `can_access_tenant_data` only — never use for both planes |

#### `can_administer_tenant` (conceptual)

```
is_super_owner(uid)
OR (is_super_admin(uid) AND grant exists with admin scope)
OR (active tenant_membership as owner/supervisor for platform-allowed ops — carefully scoped)
```

Super Owner: **always true** for every tenant (GROUP and EXTERNAL).

#### `can_access_tenant_data` (conceptual)

```
active tenant_membership for tenant_id
OR (is_super_owner(uid) AND tenant.tenant_type = 'GROUP')
OR (is_super_admin(uid) AND grant exists with data scope covering the operation)
OR active non-expired support_access_grant for (uid, tenant_id) covering scope
OR active emergency_access_grant (exceptional)
```

Super Owner on EXTERNAL: **false** for routine data unless support/emergency grant.

Service-role server paths must call the **same** plane-specific helpers before querying business tables. Never: “user is Super Owner → SELECT * FROM customers WHERE tenant_id = …”.

---

## 3. Platform admin vs business-data access (Super Owner)

### 3.1 GROUP (001, 002)

Unchanged intent from Phase 0:

- Super Owner may administer **and** routinely access GROUP business data (subject to MFA gates when enforced).

### 3.2 EXTERNAL

Super Owner **retains** platform authority without routine customer-data visibility:

| Permitted (platform) | Not permitted by default (business data) |
|----------------------|------------------------------------------|
| Create / activate / deactivate tenant | List/search customers, cases, leads |
| Platform configuration & feature flags | Read appointments, diary, voice, SMS |
| Identify Tenant Owner (identity metadata) | Open case files / interview content |
| Platform permissions & licensing | Finance/commission ledgers of the firm |
| Health / telemetry (aggregates, error rates) | Documents / Storage objects |
| Security recovery (Auth MFA reset of *platform* users; tenant Owner MFA only via controlled process) | Marketing lists / RAF internals |

Owner identification for support: prefer **user id + role + contact channel**, not dumping CRM.

---

## 4. Temporary support access (EXTERNAL)

### 4.1 Default

Mortgage Hub platform administrators → **NO ROUTINE ACCESS** to EXTERNAL business data.

### 4.2 Explicit grant table (future schema)

`tenant_support_access_grants` (name illustrative):

| Column | Purpose |
|--------|---------|
| `id` | UUID |
| `tenant_id` | EXTERNAL tenant |
| `grantee_user_id` | Platform user (Super Owner / Super Admin) |
| `reason` | Free text (required) |
| `requested_by` | User id |
| `approved_by` | User id (may be Tenant Owner and/or second platform approver) |
| `starts_at` | timestamptz |
| `expires_at` | timestamptz (required; short default e.g. 4–24h) |
| `revoked_at` | nullable |
| `scope` | enum/flags: e.g. `read_metadata`, `read_cases`, `read_comms`, `read_finance`, `write_limited` — least privilege |
| `audit` | Link / events in `security_audit_events` |

**Rules:**

- Explicit, time-limited, auto-expire (`now() < expires_at AND revoked_at IS NULL`)
- Revocable immediately
- Tenant-specific
- Auditable (grant create, use, expire, revoke — never log secrets)
- **No hidden backdoor**

### 4.3 Tenant Owner approval

**Recommend:** for EXTERNAL, **Tenant Owner approval required** for support grants (dual control), with optional emergency exception path (§5) that does not require Owner if legally necessary — but that path is separate and louder in audit.

---

## 5. Emergency / break-glass access

Separate from support grants: `tenant_emergency_access_grants` (or typed row on same table with `access_class = emergency`).

| Attribute | Requirement |
|-----------|-------------|
| Use | Security incident, regulatory demand, data recovery, platform integrity |
| Control | Dual control (two platform privileged users) + written reason |
| Duration | Very short (e.g. ≤ 2–4 hours) |
| Audit | Distinct event types: `emergency_access_granted`, `emergency_access_used`, `emergency_access_revoked` |
| Distinguisher | Must not look like normal support in logs or UI badges |

**Do not** implement unrestricted permanent bypass.  
**Do not** overload Super Owner `can_access_tenant_data` to always return true.

---

## 6. Super Admin implications

Keep:

```
platform_roles.super_admin
+
super_admin_tenant_access (explicit tenants)
```

### 6.1 Add scope / access level

**Recommend** extending `super_admin_tenant_access`:

```text
access_level: platform_admin | data_read | data_write | full
```

| Level | Administer tenant? | Business data? |
|-------|--------------------|----------------|
| `platform_admin` | Yes | No (EXTERNAL wall intact) |
| `data_read` | Yes | Read within scopes |
| `data_write` | Yes | Read/write within scopes |
| `full` | Yes | Equivalent to strong data access (rare; audit heavily) |

**Default for new EXTERNAL grants:** `platform_admin` only.  
**GROUP grants:** may default to `full` or `data_write` if product needs Super Admin CRM visibility — decide per product policy; recommend explicit, not implied.

A bare grant without scope must **not** mean unrestricted customer data on EXTERNAL.

---

## 7. Tenant Owner

| Capability | EXTERNAL Owner |
|------------|----------------|
| Operate own company (staff, CRM, finance of **their** tenant) | Yes |
| Approve/deny support access (recommended) | Yes |
| Platform-level roles / other tenants | **Never** |
| `platform_roles` | **Never** |

Isolation: membership is always `(user_id, tenant_id)` — Owner of 003 cannot see 004.

---

## 8. Provisioning (Create Company)

```
Create Company
  → tenant_type: GROUP | EXTERNAL   (required)
  → company_code, slug, names, status
  → branding, regulatory, website, contact
  → Features & Journeys             (catalogue; see TENANT_FEATURES_AND_JOURNEYS.md)
  → features / licensing entitlements
  → communications defaults
  → security / data-access defaults
       EXTERNAL → strongest isolation profile
       GROUP → group profile (Super Owner data access allowed)
  → invite initial Owner (immutable tenant_id)
  → review
  → activate
```

Features & Journeys is **orthogonal** to GROUP/EXTERNAL (an EXTERNAL tenant may enable Susan; a GROUP tenant may disable Susan).

EXTERNAL defaults:

- `tenant_type = EXTERNAL`
- no Super Owner data access without grant
- Super Admin grants default `platform_admin`
- support access requires Owner approval (policy flag on tenant_settings)
- conservative feature defaults (Susan **not** auto-enabled)

---

## 9. Required amendments to G1 schema / helpers (before G2/G5)

**Do not apply until separately authorised.** Documented now so G2 classification / G5 RLS do not bake in the wrong Super Owner semantics.

| Item | Change |
|------|--------|
| `tenants.tenant_type` | Add enum GROUP \| EXTERNAL; backfill 001/002 = GROUP |
| `can_administer_tenant` | **New** helper |
| `can_access_tenant_data` | **New** helper (GROUP Super Owner yes; EXTERNAL no unless grant) |
| `can_access_tenant` | Redefine as data-access only **or** remove from future RLS; stop using for “any platform power” |
| `super_admin_tenant_access.access_level` | Add scope enum; default EXTERNAL → `platform_admin` |
| Support / emergency grant tables | Add before any EXTERNAL live tenant with data |
| Service-role inventory | Every path classified as **admin plane** vs **data plane** |

G1 helpers that are **correct as-is for scaffolding** but **unsafe if used unchanged in RLS for EXTERNAL:**

- `can_access_tenant` — treats Super Owner as universal data access  
- Any future policy of the form `is_super_owner(auth.uid())` on business tables — **forbidden for EXTERNAL data wall**

`is_super_owner` / `is_super_admin` remain valid **role detectors**; they must not be the sole predicate on business-table RLS.

---

## 10. Revised RLS implications

| Table class | GROUP data access | EXTERNAL data access |
|-------------|-------------------|----------------------|
| Business tables | membership OR Super Owner OR scoped Super Admin OR support grant | membership OR scoped data grant OR support/emergency only |
| Platform tables (`tenants`, grants, MFA policy) | Super Owner / platform roles | Super Owner / platform roles (`can_administer_tenant`) |
| Storage | Path prefix `tenant_id/…` + `can_access_tenant_data` | Same; Super Owner no list without grant |

UI must not be the control. Expired/revoked grants → deny at server/RLS.

---

## 11. Revised isolation tests

Identities / tenants:

| Tenant | Type |
|--------|------|
| 001 Mortgage Easy | GROUP |
| 002 Trent Valley FS | GROUP |
| 003 (fixture) | EXTERNAL |
| 004 (fixture) | EXTERNAL |

| # | Scenario | Expected |
|---|----------|----------|
| 1 | 001 user → 002 data | Denied unless legitimate cross-grant (normally deny) |
| 2 | 003 user → 001 | Denied |
| 3 | 003 user → 002 | Denied |
| 4 | 003 user → 004 | Denied |
| 5 | 004 user → 003 | Denied |
| 6 | Super Owner platform admin on 003/004 | **Permitted** (`can_administer_tenant`) |
| 7 | Super Owner routine EXTERNAL customer data | **Denied** (no grant) |
| 8 | Super Owner GROUP 001/002 data | **Permitted** |
| 9 | Active support grant in scope/time | Permitted within scope |
| 10 | Expired support grant | Denied |
| 11 | Revoked support grant | Denied |
| 12 | URL / record / API ID manipulation | Denied at server/RLS |
| 13 | Super Admin `platform_admin` grant on 003 | Admin OK; data denied |
| 14 | Super Admin `data_read` grant on 003 | Data read OK within scope |

---

## 12. Future dedicated infrastructure compatibility

Preserve the ability for a large/sensitive EXTERNAL customer to move to:

- dedicated Supabase project / database  
- dedicated Storage  
- dedicated deployment  

**without redesigning the product model**, by keeping:

| Habit | Why |
|-------|-----|
| All business keys scoped by `tenant_id` | Export/migrate one tenant cleanly |
| No hard cross-tenant FKs without tenant agreement | Sharding-friendly |
| Config (branding, comms, features) on tenant rows | Portable |
| App resolves tenant by slug → tenant_id → connection/config | Swap “shared DB” for “dedicated project” behind a tenant registry |
| Storage paths `/{tenant_id}/…` | Bucket or project split later |
| Platform registry may live in Hub control plane even if data plane is dedicated | Admin plane vs data plane maps to “control plane vs data plane” infra |

**Do not implement** dedicated infra now — only avoid designs that force shared-only assumptions (e.g. global sequences without tenant, cross-tenant joins as core product).

---

## 13. Confirmations (this checkpoint)

| Item | Status |
|------|--------|
| G2 started | **No** |
| `tenant_id` backfill | **No** |
| Business data changed | **No** |
| Existing RLS changed | **No** |
| Auth / MFA / Super Owner conversion | **No** |
| Azure deploy | **No** |
| Production schema change for `tenant_type` | **Not yet** — design only until authorised |

---

## STOP

Awaiting approval before:

1. Any migration adding `tenant_type` / support grants / helper amendments  
2. Gate G2 (classification sign-off / backfill planning)
