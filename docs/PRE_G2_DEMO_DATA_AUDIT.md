# Mortgage Hub — Pre-G2 demo data audit (READ-ONLY)

**Status:** Audit only · **ZERO data modified** · **G2 not started**  
**Date:** 2026-09-17  
**Scope:** Live Supabase project `tiuplmftooauihulhtws` (read-only SQL)

This document does **not** authorise purge, backfill, RLS cutover, MFA, Super Owner conversion, routing changes, or Azure deploy.

---

## 1. Total table / row reconciliation

### 1.1 Legacy checkpoint (G1 baseline)

| Metric | Value |
|--------|-------|
| Legacy public tables | **47** |
| Legacy rows | **1,632** |

### 1.2 What makes up the 1,632 rows (not “1,632 customers”)

Dominant weight is **Susan/interview transcript volume**, not customer headcount:

| Table | Rows | Share of 1,632 | Nature |
|-------|------|----------------|--------|
| `interview_messages` | 746 | 45.7% | Session chat/avatar turns |
| `interview_answers` | 356 | 21.8% | Structured fact-find answers |
| `customer_contact_log` | 68 | 4.2% | CRM contact history |
| `sms_messages` | 53 | 3.2% | SMS log |
| `advisor_contact_views` | 40 | 2.5% | Staff UI contact opens |
| `interview_sessions` | 40 | 2.5% | Cases/sessions (**8 distinct customers**) |
| `user_roles` | 30 | 1.8% | Role assignments |
| `view_as_audit_log` | 27 | 1.7% | View-as audit |
| `phone_calls` | 24 | 1.5% | Voice call records |
| `session_advisors` | 24 | 1.5% | Session allocation links |
| `profiles` | 22 | 1.3% | User profiles (= auth user count) |
| `advisor_availability` | 20 | 1.2% | Diary windows |
| `callback_requests` | 19 | 1.2% | Callbacks |
| `finance_ledger` | 19 | 1.2% | Commission/fee ledger |
| Remaining 33 tables | 144 | 8.8% | Staff config, templates, rates, appointments, etc. |

**Customer headcount signal:** ~22 auth users / profiles; only **8** distinct `customer_id`s appear on `interview_sessions`. One person (especially Owner) can generate hundreds of message/answer rows.

### 1.3 Current public schema (after G1/G1A)

| Bucket | Tables | Rows (approx) |
|--------|--------|----------------|
| Legacy 47 | 47 | **1,632** (unchanged) |
| G1/G1A platform | 13 | **43** (tenants 2, branding/comms/settings 6, MFA policy 7, catalogue 24, tenant_features 2, empty scaffolding 0) |
| **Total public tables now** | **60** | **~1,675** |

All legacy business `tenant_id` columns remain **NULL** (0 backfilled).

---

## 2. Table-by-table inventory (legacy 47 + notes)

Legend: **B**=business/customer transactional · **P**=platform/config · **U**=user/account · **tenant_id**=nullable column present (all NULL on legacy data)

| Table | Rows | Purpose | B/P/U | Key deps / cascade risk | tenant_id |
|-------|------|---------|-------|-------------------------|-----------|
| profiles | 22 | Display names/phones | U | ← auth.users | YES NULL |
| user_roles | 30 | app roles | U | user_id | no |
| admin_profiles | 2 | Owner/supervisor/general | U | user_id; CASCADE from auth | YES NULL |
| admin_permissions | 15 | General admin perms | U/P | admin user | YES NULL |
| advisor_profiles | 4 | Advisers | U | user_id | YES NULL |
| advisor_availability | 20 | Diary slots | P/U | advisor | YES NULL |
| advisor_diary_settings | 0 | Diary params | P/U | advisor | YES NULL |
| advisor_diary_exceptions | 0 | Diary exceptions | P/U | advisor | YES NULL |
| advisor_notes | 3 | Case notes | B | **CASCADE**←session | YES NULL |
| advisor_contact_views | 40 | Contact open audit | B | advisor/session | YES NULL |
| advisor_telephony | 1 | Softphone config | P/U | adviser; SET NULL←telephony_numbers | YES NULL |
| appointments | 11 | Bookings | B | SET NULL←session/lead/introducer | YES NULL |
| interview_sessions | 40 | Cases/sessions | B | Parent of many CASCADE children | YES NULL |
| interview_messages | 746 | Susan/chat turns | B | **CASCADE**←session | YES NULL |
| interview_answers | 356 | Fact-find answers | B | **CASCADE**←session | YES NULL |
| session_advisors | 24 | Allocation | B | **CASCADE**←session | YES NULL |
| session_contact_tracking | 14 | Next contact | B | **CASCADE**←session | YES NULL |
| customer_contact_log | 68 | Contact history | B | **CASCADE**←session | YES NULL |
| customer_journey_milestones | 7 | Journey ticks | B | **CASCADE**←session | YES NULL |
| case_mortgage_details | 0 | Case mortgage fields | B | **CASCADE**←session | YES NULL |
| callback_requests | 19 | Callbacks | B | SET NULL←session/phone_call | YES NULL |
| phone_calls | 24 | Voice records | B | **CASCADE**←session; SET NULL←profile | YES NULL |
| sms_messages | 53 | SMS log | B | SET NULL←appointment/lead | YES NULL |
| staff_contact_tasks | 8 | Welcome-call tasks | B | **CASCADE**←session | YES NULL |
| introducers | 4 | Introducer firms/users | B/U | Parent of leads (**CASCADE**) | YES NULL |
| introducer_leads | 3 | Leads | B | **CASCADE**←introducer | YES NULL |
| customer_introducer_links | 4 | Customer↔introducer | B | **CASCADE**←introducer | YES NULL |
| introducer_amendment_history | 1 | Introducer changes | B | SET NULL links | YES NULL |
| referral_codes | 2 | RAF codes | B | | YES NULL |
| referrals | 1 | RAF claims | B | SET NULL←code | YES NULL |
| staff_invitations | 2 | Invite tokens | U | | YES NULL |
| finance_fee_lines | 8 | Fees on cases | B | **CASCADE**←session | YES NULL |
| finance_ledger | 19 | Payouts/commission | B | SET NULL←session/fee/referral | YES NULL |
| finance_audit_log | 9 | Finance audit | B | SET NULL←session | YES NULL |
| finance_settings | 1 | Fee settings singleton | P | | YES NULL |
| commission_rates | 3 | Rate cards | P/U | staff subjects | YES NULL |
| commission_rate_history | 16 | Rate history | P/U | | YES NULL |
| network_commission_statements | 1 | Network statement | B/P | | YES NULL |
| network_commission_lines | 0 | Statement lines | B | **CASCADE**←statement | YES NULL |
| communication_settings | 1 | Comms branding singleton | P | | YES NULL |
| communication_templates | 16 | SMS/email scripts | P | | YES NULL |
| communication_template_versions | 0 | Template history | P | **CASCADE**←template | YES NULL |
| telephony_numbers | 2 | DIDs | P | | YES NULL |
| telephony_routing_settings | 1 | Routing | P | | YES NULL |
| lender_remortgage_policies | 1 | Lender policy | P | | YES NULL |
| view_as_audit_log | 27 | View-as audit | B/P | | YES NULL |
| platform_restore_points | 3 | Ops markers | P | | no |

### G1/G1A tables (KEEP — do not purge)

| Table | Rows | Class |
|-------|------|-------|
| tenants | 2 | KEEP |
| tenant_branding / comms / settings | 2+2+2 | KEEP |
| feature_catalogue | 24 | KEEP |
| tenant_features | 2 | KEEP (Susan 001/002) |
| platform_mfa_policy | 7 | KEEP |
| platform_roles | 0 | KEEP (empty) |
| super_admin_tenant_access | 0 | KEEP |
| tenant_memberships | 0 | KEEP |
| support/emergency grants | 0 | KEEP |
| security_audit_events | 0 | KEEP |

---

## 3. Business / customer data breakdown

| Category | Count | Notes |
|----------|------:|-------|
| Auth users / profiles | 22 | Not all are “customers” |
| Distinct customers with sessions | **8** | Far fewer than 1,632 |
| Interview sessions (active) | 17 | |
| Interview sessions (binned) | 23 | Soft-deleted |
| Sessions with case_ref | 19 | “Cases” |
| Interview messages | 746 | Mostly Susan/chat volume |
| Interview answers | 356 | |
| Appointments | 11 | Denormalised customer_email/name/phone |
| Callback requests | 19 | |
| Introducers | 4 | Includes test + Owner-linked |
| Introducer leads | 3 | |
| Referrals / codes | 1 / 2 | |
| Phone calls | 24 | |
| SMS | 53 | |
| Contact log | 68 | |
| Advisor notes | 3 | |
| Staff contact tasks | 8 | |
| Journey milestones | 7 | |
| Finance ledger / fee lines | 19 / 8 | |
| Commission rates / history | 3 / 16 | Staff config-ish |
| Network commission statements | 1 | |
| Comms templates / settings | 16 / 1 | Platform-ish content |
| Diary availability windows | 20 | Adviser config |
| View-as events | 27 | |
| Documents / Storage objects | **0** | `avatars` bucket empty |
| Applications (separate table) | **none** | Cases = interview_sessions |
| Email message store | **none** found | Templates only |

**One customer → many rows:** e.g. Owner account alone has **26** sessions and a large share of messages/answers/contact activity.

Approximate session / message attribution:

| Customer cohort | Sessions | Messages |
|-----------------|---------:|---------:|
| `@test.co.uk` provisioned tests | 4 | 118 |
| Peter accounts (aol + two gmail variants) | 33 | 557 |
| Other personal emails | 3 | 71 |

---

## 4. Auth / user / test-account inventory (safe fields only)

**22** `auth.users` · **30** `user_roles` rows · **no** password/MFA/token material reported.

### 4.1 Provisioned test suite (`src/lib/test-accounts.ts` → `@test.co.uk`)

| Email | Roles | Staff links | Sessions | Proposed default |
|-------|-------|-------------|----------|------------------|
| 1@test.co.uk | customer,introducer | introducer | 1 | KEEP as test **or** DELETE per Peter |
| 2@test.co.uk | customer,introducer | introducer | 0 | same |
| 3@test.co.uk | customer,introducer | introducer | 0 | same |
| 4@test.co.uk | advisor,customer | advisor | 0 | same |
| 5@test.co.uk | advisor,customer | advisor | 0 | same |
| 6@test.co.uk | customer | — | 2 | same |
| 7@test.co.uk | customer | — | 1 | same |
| 8–12@test.co.uk | customer | — | 0 | same |
| 13@test.co.uk | admin,customer | general admin | 0 | same |

### 4.2 Genuine Owner / platform candidate

| Email | Roles | Notes |
|-------|-------|-------|
| **pmabbott2@aol.com** | admin+advisor (+introducer row) | **Owner** admin_level; designated future Super Owner; **26 sessions** — transactional data under this user is mostly demo but **account must KEEP** |

### 4.3 Other Peter / related identities — REVIEW

| Email | Roles | Sessions | Note |
|-------|-------|----------|------|
| pmabbott29@gmail.com | advisor,customer | 4 | Likely personal test adviser |
| mabbottpk@gmail.com | customer | 3 | Likely personal test customer |
| shepherdsrest@hotmail.co.uk | customer | 0 | Name “Peter Arthur” — REVIEW |
| avatar.viewer@gmail.com | customer | 0 | Looks like avatar testing |
| reset-check+…@example.com | customer | 0 | Explicit reset probe — SAFE purge candidate |

### 4.4 Other personal emails — REVIEW (do not auto-purge)

| Email | Sessions | Note |
|-------|----------|------|
| katieannsheridanxx@gmail.com | 2 | Real-looking; may be demo with known person |
| paulsheridan1@sky.com | 0 | Real-looking |
| shirleyhollingsworth@hotmail.co.uk | 1 | Real-looking |

**Do not classify these SAFE TO PURGE on name alone.**

### 4.5 Proposed retained-account list for Peter (decision grid)

| # | Email | Suggest | KEEP / DELETE (Peter) |
|---|-------|---------|------------------------|
| 1 | pmabbott2@aol.com | **KEEP** (Owner / future Super Owner) | |
| 2 | 4@test.co.uk | KEEP test adviser | |
| 3 | 5@test.co.uk | KEEP test adviser | |
| 4 | 1@test.co.uk | KEEP test introducer | |
| 5 | 6@test.co.uk | KEEP test customer | |
| 6 | 13@test.co.uk | KEEP test general admin | |
| 7 | Other @test.co.uk | Optional trim | |
| 8 | pmabbott29@gmail.com | REVIEW | |
| 9 | mabbottpk@gmail.com | REVIEW | |
| 10 | Sheridan / Hollingsworth / etc. | REVIEW | |
| 11 | avatar.viewer@ / reset-check+ | lean DELETE | |

Final purge must use Peter’s explicit KEEP/DELETE per identity.

---

## 5. Classifications

### KEEP (platform / architecture / must survive)

- All G1/G1A: `tenants`, branding/comms/settings, `feature_catalogue`, `tenant_features`, MFA policy, empty role/grant scaffolding  
- `communication_templates` + `communication_settings` (Hub scripts — content may be ME-oriented but operational)  
- `finance_settings`, `lender_remortgage_policies`  
- `telephony_numbers`, `telephony_routing_settings` (platform telephony)  
- `platform_restore_points`  
- Retained user **accounts** (auth + profiles + roles + staff profile rows for those users)  
- `admin_permissions` for retained general admin  

### TEST ACCOUNT DEPENDENCY (if that test identity is KEEP)

| Dependency | Why |
|------------|-----|
| `user_roles` for that user | Login role routing |
| `advisor_profiles` / `advisor_availability` / telephony | Adviser diary & softphone tests |
| `introducers` row + slug | Introducer portal /go /book |
| `admin_profiles` (+ permissions) | Admin access tests |
| Minimal empty-or-fixture session **only if** product requires a seeded case for demos | Prefer recreate after purge rather than keeping dirty history |

### SAFE TO PURGE (candidates — after dependency order; pending Peter confirmation)

Transactional demo activity **not** required for platform boot:

- Most `interview_sessions` + CASCADE children (messages, answers, notes, milestones, session_advisors, contact logs, fee lines, phone_calls on sessions, staff tasks)  
- `appointments`, `callback_requests`, `sms_messages` tied to demo activity  
- `introducer_leads`, demo `customer_introducer_links`, amendment history  
- `referrals` / optionally unused `referral_codes`  
- `finance_ledger`, `finance_audit_log`, network statement rows  
- `advisor_contact_views`, `view_as_audit_log`  
- Probe account `reset-check+…@example.com` and its profile/roles  
- Soft-deleted sessions (23) especially  

**Caveat:** Purging sessions owned by `pmabbott2@aol.com` removes demo history but **must not** delete the auth user.

### REVIEW

| Item | Why |
|------|-----|
| Sheridan / Hollingsworth / Paul Sheridan accounts | May be real people used in demos |
| How much Owner session history to keep for demos | Product preference |
| Whether to keep all 13 `@test.co.uk` or a subset | Explicit KEEP/DELETE |
| `commission_rates` / history | Config for staff — keep rates for retained advisers; purge orphans |
| `communication_templates` wording | KEEP table; content review later for TVFS |
| Introducer `company_code` firms linked to Owner | Avoid breaking Owner’s introducer hat if still needed |

---

## 6. Storage audit

| Item | Result |
|------|--------|
| Buckets | `avatars` (public) |
| Objects | **0** |
| DB refs | `profiles.avatar_url` — none populated in practice for purge risk |
| Orphan file risk today | **None** (empty bucket) |

Future purge of customers still must clear any new Storage paths before/with DB deletes.

---

## 7. Foreign-key / CASCADE risks

**Dangerous / broad CASCADE when deleting `interview_sessions`:**  
messages, answers, notes, contact_log, milestones, fee_lines, phone_calls, session_advisors, session_contact_tracking, staff_contact_tasks, case_mortgage_details.

**CASCADE when deleting `introducers`:** leads, customer_introducer_links.

**CASCADE when deleting `tenants`:** would wipe G1A tenant config — **never** include tenants in demo purge.

**SET NULL** links (appointments↔session, etc.) can leave orphaned appointments if order is wrong — delete appointments/callbacks/SMS **before or with** sessions explicitly.

**auth.users delete** typically cascades profiles/roles — **do not delete Owner**; only delete explicitly selected test identities.

---

## 8. Proposed future deletion order (NOT executed)

1. Confirm KEEP/DELETE matrix for every auth user (Peter).  
2. Snapshot / backup verification.  
3. Delete child transactional data for purge-set sessions:  
   messages → answers → notes → contact_log → milestones → session_advisors → contact_tracking → fee_lines → phone_calls → staff_tasks → case details.  
4. Delete appointments, callbacks, SMS referencing those sessions/leads.  
5. Delete finance_ledger / finance_audit / network lines for demo.  
6. Delete introducer_leads / links / amendments for purge-set.  
7. Delete referrals as needed.  
8. Delete interview_sessions in purge-set.  
9. Delete view_as / contact_views noise.  
10. For DELETE-marked users only: revoke roles, staff rows, then auth user (or use existing test-account revoke tooling).  
11. **Never** delete: tenants, feature catalogue/features, MFA policy, telephony numbers, templates/settings (unless separately approved), Owner account.  
12. Verify Storage still empty / clear any new objects.  
13. Re-count + smoke login for retained accounts.

---

## 9. Expected post-purge position (target)

| Area | Expected |
|------|----------|
| Platform G1/G1A | Intact (001/002 GROUP, Susan flags, catalogue) |
| Auth | Owner + approved test identities only |
| Customers/cases | Zero unwanted demo; optional minimal fixtures recreated later |
| Messages/answers | ~0 (or tiny fixture) |
| Appointments/callbacks/SMS/voice | ~0 |
| Finance demo ledger | ~0 |
| Comms templates / telephony / rates for retained staff | Retained |
| Storage | Still empty / no orphans |
| Credentials of retained users | Unchanged |

Illustrative residual public rows: platform ~40–80 + retained user scaffolding + diary windows for retained advisers — **orders of magnitude below 1,632**, mostly because messages/answers dominate today.

---

## 10. Unexpected findings

1. **1,632 ≠ customers** — ~67% of rows are `interview_messages` + `interview_answers`.  
2. Owner `pmabbott2@aol.com` owns **26/40 sessions** — largest demo volume sits on the account you must keep.  
3. Storage `avatars` bucket exists but is **empty** — simplifies file cleanup for now.  
4. Several **real-looking personal emails** exist alongside `@test.co.uk` — must be REVIEW, not auto-purge.  
5. G1/G1A added **43** platform rows on top of 1,632; legacy total unchanged.

---

## 11. Confirmations

| Item | Status |
|------|--------|
| DELETE/UPDATE/TRUNCATE/ALTER/INSERT cleanup | **Not performed** |
| Auth / MFA / Super Owner / RLS / routing / Azure | **Unchanged** |
| G1/G1A architecture | **Untouched** |
| G2 started | **No** |

---

## STOP

Awaiting Peter’s KEEP/DELETE decisions and explicit approval before any purge plan or cleanup migration.
