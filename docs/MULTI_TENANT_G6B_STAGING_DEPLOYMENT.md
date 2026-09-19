# Gate G6B — Staging infrastructure, isolated data & safe deployment

**Status:** Phase 3A — Azure staging Supabase settings entered manually; first-deploy origin is the Azure hostname. **Not deployed.**  
**Branch:** `targeted-features`  
**HEAD:** `d1aff17` (`post-g6a-integration-hardening`)  
**Remote:** `github` → `https://github.com/pmabbott2-lab/m-abbott-co-uk.git`  
**Tracking:** `github/targeted-features` (**ahead 13**, not pushed)  
**Verify (local only):** `node --env-file=.env scripts/g6b-staging-safety-verify.mjs`

G1–G6A remain in force. **No Git push. No production deploy. No G7. No MFA. No production Twilio/Graph/Supabase changes.**

---

## Git state (recovered)

| Field | Value |
|-------|--------|
| Repository root | `/Users/petermabbott/Projects/m-abbott-co-uk-main` |
| Worktrees | this tree only |
| Branch | `targeted-features` |
| HEAD | `d1aff17` Harden G6A staging gates for OpenAI, Azure TTS, and getAddress |
| Remote name | **`github`** (there is **no** `origin`) |
| Tracking | `github/targeted-features` ahead 13 |
| Working tree at G6B start | clean |

G6A original checkpoint: `9683d23` / tag `post-g6a-staging-safety` (not moved).  
G6A hardened checkpoint: `d1aff17` / tag `post-g6a-integration-hardening` (already existed; not moved).

---

## Production freeze (read-only, 2026-09-18)

Do not treat this as a new production backup. G6 recovery point remains:

`backups/post-g6-company-provisioning-20260918T112548Z/` (60 tables / 157 rows / Auth 6).

| Item | Value |
|------|--------|
| Production Azure app | `Mortgagehub-prod` (from GitHub workflow; Azure CLI **not installed**, so live Azure inventory not re-queried) |
| Production hostname | `https://mymortgagehub.uk` |
| Last **pushed** `targeted-features` SHA | `3af401f` (G1A docs) — this is the last commit the **old** push-to-deploy workflow would have shipped. Local G2–G6A work is **not** on production. |
| Production APP_ENV | Unset on Azure historically → G6A **legacy default production**. Not changed in G6B. Future explicit `APP_ENV=production` is required before final production release. |
| Production Supabase | `tiuplmftooauihulhtws` |
| Public tables | **60** |
| Auth users | **6** |
| Tenants | **2** — `001` Mortgage Easy / `mortgageeasy` / GROUP / active; `002` Trent Valley Financial Services / `trentvalleyfs` / GROUP / active |
| Memberships | **12** all on **001** (owner 1, general 1, adviser 3, introducer 2, customer 5). **002 = 0** |
| platform_roles | **0** |
| MFA factors | **0** (off) |
| Susan | 001 enabled / 002 disabled |

No production rows were written for this freeze.

---

## Isolation target

| Plane | Production | Staging (intended) |
|-------|------------|--------------------|
| App | `Mortgagehub-prod` · `mymortgagehub.uk` | **`Mortgagehub-staging`** · `staging.mymortgagehub.uk` |
| Database / Auth | `tiuplmftooauihulhtws` | **new Supabase project** (not created) |
| Data | live 001 memberships | synthetic only |
| Comms | live (unchanged) | capture / blocked |
| CI | manual `workflow_dispatch` (local) | separate staging workflow (local) |

Fail closed: missing staging config must never resolve to production resources.

---

## Azure staging plan (NOT created)

**Proposed Web App name:** `Mortgagehub-staging`  
**Not a slot** of `Mortgagehub-prod`. Do not modify `Mortgagehub-prod`.

Name collision could not be checked: **Azure CLI is not installed** (`az` missing).

Required staging App Settings (names only):

| Name | Value | Class |
|------|--------|--------|
| `APP_ENV` | `staging` | required |
| `VITE_APP_ENV` | `staging` | public |
| `COMMUNICATION_DELIVERY_MODE` | `capture` | required |
| `APP_BASE_URL` / `VITE_APP_URL` | `https://staging.mymortgagehub.uk` | required unique |
| `SUPABASE_URL` + publishable + service role | staging project | **must not copy production** |
| `STAGING_SUSAN_ENABLED` | `false` | required off |
| `STAGING_OPENAI_ENABLED` | `false` | required off |
| `STAGING_GETADDRESS_ENABLED` | `false` | required off |
| Twilio / Graph / Simli / OpenAI / Speech | unset | must not copy production |

See `.env.staging.example`.

---

## Supabase staging plan (NOT created)

**Proposed name:** Mortgage Hub Staging  
**Organisation:** `gdyepsffqqndftcadxxn` (pmabbott2-lab's Org)  
**Must not** use `tiuplmftooauihulhtws`.  
**Must not** create staging tenants inside production.

Creation is a billing/dashboard action. G6B stops here until you authorise it.

After the project exists: apply repo migrations G1–G6 in order, then `scripts/g6b-staging-seed.mjs`. Do not clone production data.

---

## Synthetic personas (plan only — Auth users not created)

Emails are synthetic. Passwords will not be committed.

| Tenant | Role | Email |
|--------|------|--------|
| 001 | Owner | `staging-001-owner@example.test` |
| 001 | Supervisor | `staging-001-supervisor@example.test` |
| 001 | General Admin | `staging-001-admin@example.test` |
| 001 | Adviser | `staging-001-adviser@example.test` |
| 001 | Introducer | `staging-001-introducer@example.test` |
| 001 | Customer | `staging-001-customer@example.test` |
| 002 | Owner … Customer | `staging-002-…@example.test` |

Platform Super Owner fixture is **deferred to G7**. `/companies` UAT waits unless a later staging-only fixture is explicitly approved.

---

## Local artifacts prepared this session

| Artifact | Purpose |
|----------|---------|
| `.github/workflows/targeted-features_mortgagehub-prod.yml` | **BEFORE:** `on.push` → `targeted-features` plus `workflow_dispatch`. **AFTER (local):** `workflow_dispatch` only + `environment: production` |
| `.github/workflows/mortgagehub-staging.yml` | Manual deploy to `Mortgagehub-staging` only |
| `scripts/g6b-production-guard.mjs` | Fail-closed: `APP_ENV=staging` **and** exact ref `fwgjtbeigpipvayytwlu`; denylists production `tiuplmftooauihulhtws` and stale `ibajpnsnsrjgbhlcvnve` |
| `scripts/g6b-staging-seed.mjs` | 001/002 config + features; refuses production |
| `scripts/g6b-staging-reset.mjs` | Clears staging transactional tables; refuses production |
| `scripts/g6b-staging-safety-verify.mjs` | Workflow + refuse-production + exact-ref tests |
| `scripts/g6b-staging-bootstrap.mjs` | Staging-only clean-project migration plan (does not execute SQL) |
| `scripts/g6b-staging-g2-structural.sql` | G2 structural ops without production Auth/membership seed |

**Staging branch model:** keep `targeted-features` as the development source. Staging deploys by **manual workflow_dispatch** of that branch. No parallel history branch yet.

**First push (not done):** the same commit that removes `on.push` is the one that would land on GitHub, so that push should **not** start the old production deploy. Still **do not push** until you explicitly authorise it.

---

## External integrations (initial staging)

| Service | Staging |
|---------|---------|
| Twilio | capture / blocked · no prod SIDs · no webhook changes |
| Graph/Teams | mock · no prod calendar writes |
| OpenAI | `STAGING_OPENAI_ENABLED=false` |
| Susan/Simli | tenant 001 ON / 002 OFF · env `STAGING_SUSAN_ENABLED=false` |
| Azure TTS | blocked |
| getAddress | `STAGING_GETADDRESS_ENABLED=false` → postcodes.io |
| Email | capture; Auth email only after staging Auth exists |
| Webhooks | production unchanged; future staging URLs on staging origin only |

---

## Phase 2A — clean-staging schema bootstrap

Historical production G2 is **immutable**:

`supabase/migrations/20260917193000_gate_g2_tenant_ownership_and_memberships.sql`

Clean staging uses a **separate** bootstrap path:

1. Apply every `supabase/migrations/*.sql` file in timestamp order **except** historical G2.
2. At the G2 timestamp, apply `scripts/g6b-staging-g2-structural.sql` instead (tenant_id backfill + empty-project assertions; **no** production Auth/membership seed).
3. Continue G3–G6 (and G6 invite membership role) in original order.

**Migration-history treatment**

- Git: production G2 file is never edited. Later shared migrations stay in `supabase/migrations/`.
- Staging `schema_migrations` records the **original timestamped filenames** as version names so history keys match the repo.
- The SQL body stored for `20260917193000_gate_g2_tenant_ownership_and_memberships` on staging is the structural subset, not the production identity seed. That is a one-time clean-project exception, not a long-term divergent application schema.
- After bootstrap, staging has the same G6/G6A **schema/security architecture** as production-compatible code, with empty Auth/memberships/business data.

The bootstrap script cannot run against production: it requires `APP_ENV=staging` and project ref `fwgjtbeigpipvayytwlu`, and the staging G2 SQL aborts if `auth.users` is not empty.

---

## STOP — next user action required


Azure CLI is unavailable and no Azure/Supabase resource has been created.

**Do this one step next:**

1. Install and sign in to Azure CLI on this Mac (`brew install azure-cli` then `az login`), **or** open Azure Portal for the existing subscription that hosts `Mortgagehub-prod`.
2. Confirm whether the name **`Mortgagehub-staging`** is free.
3. Reply **yes, create `Mortgagehub-staging`** (separate Web App, not a slot).

## Phase 2B — synthetic identities (staging only)

Auth users (12) and tenant memberships (6×001 + 6×002) exist on `fwgjtbeigpipvayytwlu`. `platform_roles` remains 0. Super Owner not created.

Login passwords were **not** stored in Git, chat, or Markdown. Set them locally in the Staging Dashboard (no recovery email).

## Phase 2C — six-table RLS (staging only)

Forward-only migration `supabase/migrations/20260918200000_gate_g6b_enable_rls_six_unprotected_tables.sql` applied on staging as `gate_g6b_enable_rls_six_unprotected_tables`. Production not applied. Finding: `docs/MULTI_TENANT_G6B_RLS_FINDING_SIX_TABLES.md`.

## Phase 3A — Azure staging connection (no deploy)

Six staging Supabase App Settings were entered manually on `Mortgagehub-staging` from `fwgjtbeigpipvayytwlu`. Azure CLI is unavailable here; persistence was user-confirmed.

**VITE / runtime decision:** `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` are **not** baked into the GitHub Actions build. The staging workflow refuses those variables at build and then SSR-injects them from Azure App Settings via `__MH_PUBLIC_ENV__` (`src/lib/supabase-public-env.ts`). A local `npm run build` that still has production `.env` will inline the production public URL as a Vite fallback — do not deploy that artifact. CI-equivalent staging builds unset those Vite keys so runtime Azure settings win. Build-time public flags are `VITE_APP_ENV=staging`, first-deploy `VITE_APP_URL` = Azure hostname, `VITE_SUPABASE_PROJECT_ID=fwgjtbeigpipvayytwlu`, `VITE_SKIP_LOGIN_MFA=true`, `VITE_REALTIME_AVATAR=false`.

**Atomic push rule:** the first Git push of G6B work **must** include the local production workflow change (`workflow_dispatch` only). Remote `github` still auto-deploys `Mortgagehub-prod` on `targeted-features` push.

Still **not** authorised:

- deploy / push / commit
- DNS / Auth redirect URLs / MFA / live communications / G7


---

## Confirmations so far

- Production app / workflow on GitHub **unchanged** (local workflow edit not pushed)
- Production Supabase unchanged (read-only freeze queries only)
- Production Auth unchanged (6 users)
- Production Twilio / Graph unchanged
- No real customer communications
- No production data copied
- G7 not started · MFA off · platform_roles = 0
- **STAGING READY FOR USER UAT: NO**

**Type debt:** G6A counted 18 untyped bridges; G6B local work did not add a new `as any` / `supabaseAdminUntyped` module.
