# Mortgage Hub — Gate G3 (Tenant RLS & data isolation)

**Status:** Complete · **G4 NOT STARTED** · **NO Azure deployment** · **NO push of `targeted-features`**  
**Date:** 2026-09-17  
**Baseline before:** `post-g2-tenant-ownership` @ `bb0e44e`  
**Backup before:** `backups/post-g2-tenant-ownership-20260917T194913Z/` (60 tables, 135 rows, 6 auth metadata users, checksums PASS)

---

## 1. Scope

G3 enforced **database-level tenant isolation** via staged RLS:

| Stage | Remote migration name | Local file |
|-------|----------------------|------------|
| G3A | `gate_g3a_rls_security_helpers` (`20260917200952`) | `supabase/migrations/20260917200000_gate_g3a_rls_security_helpers.sql` |
| G3B | `gate_g3b_identity_platform_config_rls` (`20260917201033`) | `…20260917200100_…` |
| G3C | `gate_g3c_business_tenant_rls` (`20260917201228`) | `…20260917200200_…` |
| G3D | `gate_g3d_telephony_comms_finance_rls` (`20260917201645`) | `…20260917200300_…` |

G3 did **not**:

- Super Owner conversion / MFA
- Twilio runtime / number / webhook changes
- Create EXTERNAL tenant 003 (fixture-only, rolled back)
- Azure deploy / push `targeted-features`
- Full feature-enforcement (G5) or Create Company wizard (G4+)

---

## 2. Security model enforced

```
auth.uid()
  → tenant_memberships / platform helpers
  → tenant_id (UUID)
  → RLS USING / WITH CHECK
  → row visibility & mutation
```

Not authorised by: URL slug, email string comparison, or frontend filters alone.

**Fail closed:** unknown / missing tenant → deny. No default to 001 / Mortgage Easy on the security path (`src/lib/tenant-context.server.ts` remains fail-closed).

---

## 3. Helper audit & G3A changes

### Existing G1A helpers (preserved semantics)

| Helper | Definer | search_path | Notes |
|--------|---------|-------------|--------|
| `is_super_owner` / `is_super_admin` | SECURITY DEFINER | `public` | Platform roles; **0 rows** during G3 |
| `has_tenant_membership` | DEFINER | `public` | Active membership only |
| `can_administer_tenant` | DEFINER | `public` | owner/supervisor (+ platform admin paths). **Does not** treat `general` as Owner |
| `can_access_tenant_data` | DEFINER | `public` | membership **or** Super Owner **on GROUP only** **or** Super Admin data grant **or** active support/emergency |
| `has_active_support_data_access` | DEFINER | `public` | Time-boxed support **or** emergency grants |
| `has_super_admin_tenant_access` | DEFINER | `public` | Explicit grant table |

### New G3A wrappers (for policy expressions)

| Helper | Purpose |
|--------|---------|
| `auth_can_access_tenant(uuid)` | `can_access_tenant_data(auth.uid(), …)` |
| `auth_can_administer_tenant(uuid)` | admin-plane via `can_administer_tenant` |
| `auth_is_tenant_staff(uuid)` | membership + advisor/admin app role **or** owner/supervisor/general/adviser membership |
| `auth_is_tenant_admin(uuid)` | `can_administer_tenant` **or** legacy `has_role(admin)` + membership (General Admin path) |
| `auth_is_tenant_introducer(uuid)` | introducer membership / app role |

Also hardened `super_admin_grant_allows_*` with fixed `search_path`.  
EXECUTE granted to `authenticated` + `service_role`; revoked from `PUBLIC`/`anon`.

Helpers take **UUID tenant_id** from the row — they do not trust client “current firm” cookies.

---

## 4. Role semantics (within tenant)

| Role | Tenant scope | Capability notes |
|------|--------------|------------------|
| **Owner** | membership | Admin-plane (`can_administer_tenant`); staff/data as designed |
| **Supervisor** | membership | Same admin-plane helper as Owner |
| **General (`general`)** | membership | **Not** Owner via `can_administer_tenant`; legacy admin UI via `has_role('admin')` + `admin_permissions`; `auth_is_tenant_admin` includes that path |
| **Adviser** | membership | Staff reads of CRM/telephony; finance **restricted** (admin-plane) |
| **Introducer** | membership | Own introducer/lead paths; not firm-wide finance/telephony mutate |
| **Customer** | membership | Own sessions/cases only — **not** all 001 customers |

Membership = **tenant boundary**. Role/permission = **capability**.

---

## 5. Policy model by class

### Identity / platform (G3B)

| Table | SELECT | Mutations |
|-------|--------|-----------|
| `tenants` | members of that tenant (+ future SO/SA) | **no** authenticated write |
| `tenant_memberships` | own rows **or** tenant admin | **service_role only** |
| `platform_roles` | own rows | **service_role only** (stays 0) |
| `super_admin_tenant_access` | own (+ SO) | **service_role only** |
| `tenant_support_access_grants` / `tenant_emergency_access_grants` | grantee (+ SO) | **service_role only** |
| `feature_catalogue` / `platform_mfa_policy` | authenticated read | no client write |
| `security_audit_events` | SO or tenant admin | no client write |
| `platform_restore_points` | RLS on, no auth policies | service only |
| `tenant_branding` / `settings` / `comms_config` / `features` | members read | admin-plane update only |

`profiles.tenant_id` remains **NULL** (identity ≠ membership). Multi-tenant membership allowed.

### Business / CRM (G3C)

Outer boundary: `auth_can_access_tenant` / `auth_is_tenant_staff` / ownership predicates.  
Inner boundaries preserved where present:

- **Customer:** `interview_sessions.customer_id = auth.uid()` (and related child EXISTS)
- **Adviser:** own allocations / notes / advisor_id where applicable; staff may see tenant CRM
- **Introducer:** own `introducers.user_id` / leads; staff may see tenant leads
- Diary availability: public read of **active** slots for booking; mutate own + tenant check

### Telephony / comms / finance (G3D)

| Area | SELECT | Mutate |
|------|--------|--------|
| Telephony numbers / routing | tenant staff | tenant **admin** |
| Advisor telephony | self or staff | admin or self |
| SMS / phone_calls | staff (calls also party) | SMS insert staff |
| Comms templates/settings | staff (NULL tenant = global template read) | admin (global needs legacy admin role) |
| Finance / commission / network statements | **tenant admin** (commission_rates: admin **or** own `user_id`) | admin where granted |

Twilio **runtime frozen** — RLS only.

---

## 6. Authenticated RLS tests

Harness: `scripts/g3-security-verify.sql` + batched JWT simulation (`request.jwt.claim.sub` + `SET LOCAL ROLE authenticated`).

| Batch | Result |
|-------|--------|
| Owner 001 allow / 002 deny; insert-002 / reassign tenant / platform_role / membership escalation denied | **PASS** |
| Customer telephony/finance/feature mutate denied; adviser 001 telephony allow / 002 deny / finance deny; introducer finance & telephony update deny; temp 002 member cannot delete 001 number | **PASS** |
| EXTERNAL fixture: SO auto data denied; GROUP 001 SO data allowed; support grant allows; revoked denies; cleanup → platform_roles=0, t003=0, support=0, mem_002=0 | **PASS** |

Service role used only for fixture setup/cleanup and helpers that are SECURITY DEFINER.

---

## 7. Service-role audit (summary)

`SUPABASE_SERVICE_ROLE_KEY` is **server-only** (`client.server.ts`). Browser client must not use it.

| Area | Classification |
|------|----------------|
| Auth admin (invite, password reset, createUser) | **JUSTIFIED** |
| Booking / SMS insert / Twilio webhooks writing logs | **REQUIRES TENANT ASSERTION** (deferred hardening — RLS does not apply) |
| Tenant context helpers using admin client | **JUSTIFIED** for resolution; must stay fail-closed |
| Broad CRM admin functions | **DEFERRED REFACTOR** — explicit tenant assertion before mutating tenant-owned rows |

No G3 change exposed service role to the browser. No full service-layer rewrite in G3.

---

## 8. Storage

- Bucket `avatars`: **0 objects**
- Policies: owner-scoped avatar CRUD (user id path) — **not yet tenant-namespaced**
- **Deferred:** tenant UUID path prefix + policies when multi-tenant uploads land

---

## 9. Types

`supabase` CLI not available in this environment; `npx supabase gen types` did not complete safely without project login.  
`src/integrations/supabase/types.ts` remains **stale** (G1–G3 tables may be missing). App continues G2 pattern of selective untyped admin access where needed. **Regenerate when CLI auth is available.**

---

## 10. Security audit events

`security_audit_events` exists (admin/SO read). G3 did **not** flood persistent events.  
**Later log:** membership/role changes, platform grants, support/emergency, telephony admin, notable cross-tenant denials.

---

## 11. Known deferred / documented issues

- Referral `sendSms(phone, msg)` arity mismatch (G2) — **unchanged**
- Service-role paths need explicit tenant assertions (G4+/hardening)
- Storage tenant namespace
- Type regeneration
- Adviser “assigned-only” inner boundaries remain partially legacy-broad for some staff CRM tables — outer tenant wall is mandatory; finer assignment redesign later
- Feature **API** blocking remains G5

---

## 12. Rollback

1. Code: checkout `post-g2-tenant-ownership` (`bb0e44e`)
2. Data: restore from `backups/post-g2-tenant-ownership-20260917T194913Z/` and/or Supabase PITR to pre-G3 timestamps (`~2026-09-17 20:09 UTC` before G3A)
3. Do **not** “fix” lockout by granting Super Owner or disabling RLS

---

## 13. G4 dependencies

- Create Company / EXTERNAL onboarding UX (still design-gated)
- Invitation/provisioning server paths that mutate `tenant_memberships` under authority
- Progressive replacement of service-role tenant mutations with asserted user-scoped clients where safe
- Do **not** start G4 until explicit approval

---

## 14. Post-G3 validation snapshot

| Check | Expected / result |
|-------|-------------------|
| Auth users | 6 |
| Memberships 001 / 002 | 12 / 0 |
| platform_roles | 0 |
| support / emergency / SA grants | 0 |
| Tenant 003 | none |
| Susan 001 / 002 | enabled / disabled |
| Telephony 2912 / 5627 | still 001 only |
| MFA factors | 0 |
| Storage objects | 0 |
| Owner `5eef06a0-…` 001 admin+data | true; 002 false |
| Twilio | unchanged |
| Azure | not deployed |

**Post-G3 backup:** `backups/post-g3-tenant-security-20260917T204824Z/` (gitignored; 60 tables, 135 rows, 6 auth metadata users, 0 failed tables).
