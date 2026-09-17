# Mortgage Hub — PRE-G2 CLEAN BASELINE

**Status:** Controlled demo purge complete · **G2 NOT STARTED** · **NO Azure deployment**  
**Date:** 2026-09-17  
**Supabase project:** `tiuplmftooauihulhtws`

This is the post-purge restore checkpoint after the authorised pre-G2 demo data cleanup.

---

## 1. What was done

| Step | Result |
|------|--------|
| Verified existing revoke/wipe path (`wipeTestAccountActivity` / `purgeTestAccount`) | Safe for **DELETE** accounts; **unsafe** as bulk revoke against KEEP `@test.co.uk` |
| Deleted 16 authorised unwanted Auth users | Using per-user wipe + `auth.admin.deleteUser` (same behaviour as `purgeTestAccount`) |
| Purged transactional history for 6 KEEP accounts | Structure retained (`removeStructure: false`) |
| Orphan transactional sweep | Sessions/messages/answers/appointments/comms/finance demo rows cleared |
| Platform G1/G1A | Untouched (tenants, features, MFA policy scaffolding, support/emergency grants tables) |

Script used: `scripts/pre-g2-demo-purge.mjs` (mirrors app wipe patterns; does **not** call bulk `revokeTestAccounts`).

---

## 2. Retained Auth accounts (6)

| Email | Structural capability retained |
|-------|--------------------------------|
| `pmabbott2@aol.com` | Owner (`admin_profiles.level=owner`), advisor, introducer |
| `1@test.co.uk` | Introducer (+ customer role) |
| `4@test.co.uk` | Advisor (+ customer role) |
| `5@test.co.uk` | Advisor (+ customer role) |
| `6@test.co.uk` | Customer only |
| `13@test.co.uk` | General Admin (`admin_profiles.level=general`) |

Passwords / Auth credentials were **not** changed.

---

## 3. Deleted Auth accounts (16)

`2@test.co.uk`, `3@test.co.uk`, `7@test.co.uk`, `8@test.co.uk`, `9@test.co.uk`, `10@test.co.uk`, `11@test.co.uk`, `12@test.co.uk`, `katieannsheridanxx@gmail.com`, `mabbottpk@gmail.com`, `reset-check+1782566769@example.com`, `shirleyhollingsworth@hotmail.co.uk`, `paulsheridan1@sky.com`, `avatar.viewer@gmail.com`, `pmabbott29@gmail.com`, `shepherdsrest@hotmail.co.uk`

---

## 4. Counts (pre → post)

| Table / metric | Pre-purge | Post-purge |
|----------------|-----------|------------|
| `auth.users` | 22 | **6** |
| `profiles` | 22 | **6** |
| `user_roles` | 30 | **11** |
| `interview_sessions` | 40 | **0** |
| `interview_messages` | 746 | **0** |
| `interview_answers` | 356 | **0** |
| `appointments` | 11 | **0** |
| `callback_requests` | 19 | **0** |
| `sms_messages` | 53 | **0** |
| `phone_calls` | 24 | **0** |
| `introducer_leads` | 3 | **0** |
| `introducers` | 4 | **2** (1@ + owner) |
| `finance_ledger` | 19 | **0** |
| `finance_fee_lines` | 8 | **0** |
| `commission_rates` | 3 | **2** (structural rates for retained users) |
| Public tables | 60 | **60** |
| Public rows (all) | ~1,675 | **125** |
| Storage `avatars` objects | 0 | **0** |
| Storage objects (all) | 0 | **0** |

Structural retained examples: `advisor_profiles` 3, `admin_profiles` 2, `admin_permissions` 15, `advisor_availability` 15, `communication_templates` 16, telephony config rows.

---

## 5. Platform validation

| Check | Result |
|-------|--------|
| 001 Mortgage Easy | Present · `tenant_type=GROUP` · active |
| 002 Trent Valley Financial Services | Present · `tenant_type=GROUP` · active |
| Susan `susan_ai_journey` on 001 | **enabled** |
| Susan `susan_ai_journey` on 002 | **disabled** |
| `feature_catalogue` | 24 |
| `tenant_features` | 2 |
| `tenant_branding` / `tenant_settings` / `tenant_comms_config` | 2 each |
| `platform_roles` (Super Owner conversion) | **0** |
| `auth.mfa_factors` | **0** |
| `platform_mfa_policy.mfa_required` | all **false** |
| Orphan profiles/roles/advisors/admins/introducers | **0** |
| G2 started | **NO** |
| Azure deploy from this work | **NO** |

---

## 6. Offline logical dump

| Field | Value |
|-------|--------|
| Location | `backups/pre-g2-clean-baseline-20260917T190910Z/` (**gitignored**) |
| Tables | **60/60** · all `count_match: true` |
| Rows | **125** |
| Auth metadata | **6** users (ids/emails/providers — **no** password hashes / MFA secrets) |
| Checksums | `MANIFEST.json` |

Paired recoveries still available:

- `backups/pre-phase1-immediate-baseline-20260917T164555Z/` (pre-G1 immediate)
- `backups/pre-multitenant-baseline-20260917/`
- Supabase Pro scheduled backups / platform restore

**Offline dump alone does not restore password hashes or MFA secrets.** Use Pro platform backup for Auth-inclusive restore.

---

## 7. Git checkpoint

| Field | Value |
|-------|--------|
| Annotated tag | `pre-g2-clean-baseline` |
| Docs | this file · purge script `scripts/pre-g2-demo-purge.mjs` |
| Dump payloads | **not** committed |

---

## 8. STOP

**G2 must not start** until explicit approval.  
**Do not deploy Azure** from this checkpoint unless separately authorised.
