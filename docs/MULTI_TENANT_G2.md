# Mortgage Hub — Gate G2 (Tenant ownership & context)

**Status:** Complete · **G3+ NOT STARTED** · **NO Azure deployment**  
**Date:** 2026-09-17  
**Baseline before:** `pre-g2-clean-baseline` @ `b725819`  
**Twilio design:** `docs/TWILIO_MULTI_TENANT_ARCHITECTURE.md` @ `d491ea3` (unchanged runtime)

---

## 1. Scope

G2 established:

- Retained-account **tenant_memberships** on **001 Mortgage Easy**
- Confident **tenant_id backfill** for Mortgage Easy structural rows
- **Empty valid 002** (no fabricated staff/customers/numbers)
- Server **tenant context helpers** (slug → UUID, fail-closed)
- Documentation + local git checkpoint

G2 did **not**:

- Full RLS cutover / `tenant_id NOT NULL`
- Super Owner conversion / MFA
- Twilio subaccounts, number moves, webhook/SMS/voice changes
- Create Company wizard / EXTERNAL tenant 003
- Azure deploy / push to `targeted-features` (workflow deploys on push)

---

## 2. Security model

```
URL slug / company_code
  → resolve tenants row
  → tenant_id (UUID)          ← security identity
  → membership / platform helpers
  → authorised action
```

Slug is **not** an authorisation boundary.  
**No default to 001** when context is missing.

---

## 3. Membership model

`tenant_member_role`: `owner` | `supervisor` | `general` | `adviser` | `introducer` | `customer`

| Auth email | 001 memberships |
|------------|-----------------|
| pmabbott2@aol.com | owner, adviser, introducer |
| 1@test.co.uk | introducer, customer |
| 4@test.co.uk | adviser, customer |
| 5@test.co.uk | adviser, customer |
| 6@test.co.uk | customer |
| 13@test.co.uk | general, customer |

- **002 memberships:** none (intentional empty tenant)  
- **platform_roles:** still **0** (no Super Owner)

### Identity layers

| Layer | Store | Notes |
|-------|--------|------|
| Auth identity | `auth.users` | Global login |
| Display profile | `profiles` | **tenant_id left NULL** — multi-company capable |
| Legacy app roles | `user_roles` / `admin_profiles` | Still drive current UI; not removed |
| Tenant binding | `tenant_memberships` | Canonical G2+ tenant ownership |

`can_administer_tenant` (G1A) = owner/supervisor (+ future platform grants).  
`general` gets **data** access via membership, not admin-plane via that helper — legacy General Admin permissions remain in `admin_permissions` until a later gate unifies them.

---

## 4. Staff invitations

| Invite | Result |
|--------|--------|
| 13@test.co.uk admin, expired, unused | **Deleted** (account already exists) |
| NULL-email advisor, unused | **Deleted** (incomplete demo) |

Tokens never logged. Count after G2: **0**.

---

## 5. Referral `sendSms` finding (Twilio audit)

In `referrals.functions.ts` customer share path:

```ts
await sendSms(profile.phone, message); // WRONG shape
```

Correct signature is `sendSms({ to, body })`. Other referral admin paths already use the object form.

- **TypeScript:** may not fail if unchecked / loosely typed call sites  
- **Runtime:** SMS share channel would throw if exercised  
- **G2 action:** **documented only — not fixed** (out of G2 scope; Twilio runtime frozen)

---

## 6. Backfill summary

| Table | Before NULL | After NULL | Ownership |
|-------|-------------|------------|-----------|
| admin_profiles | 2 | 0 | 001 |
| admin_permissions | 15 | 0 | 001 |
| advisor_profiles | 3 | 0 | 001 |
| advisor_availability | 15 | 0 | 001 |
| advisor_telephony | 1 | 0 | 001 |
| introducers | 2 | 0 | 001 |
| commission_rates | 2 | 0 | 001 (Owner rates) |
| telephony_numbers | 2 | 0 | 001 |
| telephony_routing_settings | 1 | 0 | 001 |
| communication_settings | 1 | 0 | 001 |
| finance_settings | 1 | 0 | 001 |
| tenant_memberships | 0 | 12 active on 001 | — |
| staff_invitations | 2 | 0 | removed |

### Intentionally global / NULL tenant_id

| Table | Reason |
|-------|--------|
| profiles | Auth/display identity; membership is binding |
| communication_templates (16) | Platform template catalogue; tenant wrappers later |
| lender_remortgage_policies (1) | Shared lender reference |
| feature_catalogue / platform_* | Platform |
| Empty transactional tables | N/A until data exists |

### Already tenant-scoped (unchanged)

`tenants`, `tenant_branding`, `tenant_settings`, `tenant_comms_config`, `tenant_features`

---

## 7. Tenant context implementation

File: `src/lib/tenant-context.server.ts`

| Helper | Behaviour |
|--------|-----------|
| `resolveTenantBySlug` | Lookup; throw `TENANT_NOT_FOUND` |
| `getTenantContextBySlug` | Active only; throw `TENANT_INACTIVE` |
| `requireTenantContext` | Fail closed — no 001 default |
| `requireTenantMembership` | RPC `has_tenant_membership` |
| `requireTenantAdmin` | RPC `can_administer_tenant` |
| `requireTenantDataAccess` | RPC `can_access_tenant_data` |
| `platformRootContext()` | Returns `null` (root = platform) |

Routing/UI slug paths **not** rolled out in G2 — helpers only.

Verify script: `scripts/g2-verify.mjs`

---

## 8. 001 / 002 final state

**001 Mortgage Easy (GROUP, active)**  
- 12 memberships · Susan enabled · telephony `…2912` / `…5627` · firm structural rows tagged 001  

**002 Trent Valley FS (GROUP, active)**  
- 0 memberships · Susan disabled · branding/settings/comms shell · **no** 001 numbers/finance/staff  

---

## 9. Twilio / Susan / RLS

| Item | Status |
|------|--------|
| Twilio resources | **Unchanged** |
| Numbers | Same E.164; DB `tenant_id=001` only |
| Susan 001/002 | enabled / disabled |
| Legacy RLS | **Unchanged** (cutover deferred) |
| EXTERNAL data wall helpers | Intact (`can_access_tenant_data` GROUP vs EXTERNAL) |

---

## 10. NULLABILITY recommendations (not applied)

| Eventually NOT NULL | Global OK | Undecided |
|--------------------|-----------|-----------|
| Most transactional business tables once app paths tenant-aware | feature_catalogue, platform_*, templates (until per-tenant overrides), profiles (or drop column) | communication_templates strategy; general-admin vs membership admin plane |

Do **not** enforce NOT NULL until write paths always set `tenant_id`.

---

## 11. Migration

`supabase/migrations/20260917193000_gate_g2_tenant_ownership_and_memberships.sql`  
Applied name: `gate_g2_tenant_ownership_and_memberships`

---

## 12. Rollback

1. Restore logical dump `backups/pre-g2-clean-baseline-20260917T190910Z/` **or** Pro backup  
2. Checkout `pre-g2-clean-baseline`  
3. Do **not** rely on reversing memberships alone if later gates ran  

Post-G2 dump: `backups/post-g2-tenant-ownership-20260917T194913Z/` (gitignored; 60 tables, 135 rows, 6 auth metadata users).

---

## 13. Future gates depend on G2 for

- Tenant-aware RLS  
- Feature enforcement wiring  
- Twilio tenant resolution / subaccounts  
- Create Company + 002 staffing  
- Super Owner / MFA  

**STOP — await approval before G3.**
