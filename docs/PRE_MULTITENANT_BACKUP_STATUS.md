# Pre-multi-tenant backup / recovery status

**Date:** 2026-09-17 (BST)  
**Git restore point:** `pre-multitenant-baseline` @ `244ceaa456486c5c7cb9c416b7ff766a10427eeb`  
**Azure production:** deploy run #29 · same SHA  
**Phase 1:** not started

## 1. Supabase plan (rechecked)

| Check | Result |
|-------|--------|
| Organisation plan | **Pro** (`gdyepsffqqndftcadxxn`) |
| Project | `tiuplmftooauihulhtws` · ACTIVE_HEALTHY · eu-west-1 |

## 2. Automatic / scheduled backups

On Pro, Supabase takes **daily scheduled backups** automatically (last **7 days** retainable on Pro).

Dashboard path: Database → Backups → Scheduled backups.

**Latest backup timestamp:** not machine-readable from this session (dashboard auth session expired before the backup list finished loading). Please open the Scheduled backups tab once and confirm the newest row’s date/time — if the upgrade was very recent, the **first daily backup may appear on the next scheduled cycle** (often within ~24 hours).

## 3. What platform daily backups protect / do not

**Protects (when restore is run from Dashboard):**
- Postgres database contents (schemas including `public`, `auth`, etc.)
- Tables, data, indexes, constraints
- RLS policies, functions, triggers (as stored in Postgres)
- Auth users as stored in the `auth` schema (including credentials material held by Supabase Auth)

**Does not protect:**
- **Storage object bytes** (e.g. avatar files) — DB only stores metadata; deleted objects are not revived by a DB restore
- Custom role passwords (per Supabase docs) — may need reset after restore
- Azure App Settings / GitHub secrets
- Auth **URL Configuration** / dashboard project settings outside the DB
- Edge Function deployment artefacts outside DB

## 4. PITR

| Check | Result |
|-------|--------|
| Available on Pro | **Yes** (paid add-on; typically requires Small compute) |
| Enabled now | **Not confirmed enabled** (Add-ons page reachable; PITR not verified as active) |
| Recommendation before Phase 1 migrations | **Enable PITR (7-day retention minimum)** so a bad migration can be rolled back to a precise timestamp, not only to the prior daily backup |

Note: enabling PITR replaces the daily-backup product with finer-grained recovery (Supabase does not run both).

## 5. Offline logical dump (created)

| Field | Value |
|-------|--------|
| Path | `backups/pre-multitenant-baseline-20260917/` (gitignored) |
| Method | Read-only service-role SELECT → JSON.gz + Auth Admin `listUsers` metadata |
| Tables | 47/47 OK |
| Rows | 1632 |
| Auth users (metadata) | 22 |
| Schema pairing | `schema_from_git/migrations` (31 files from tagged tree) |
| Checksums | Verified PASS |
| Production impact | None (read-only) |

This dump is a **usable data baseline** for reconciliation and rebuild of public business data. It is **not** a full substitute for platform physical restore for Auth secrets or Storage files.

## 6. Combined restore position

| Layer | Artefact |
|-------|----------|
| Application code | Git tag `pre-multitenant-baseline` |
| Business data snapshot | Offline dump folder above |
| Platform DB restore | Pro daily backups (confirm latest timestamp in Dashboard) |
| Recommended next hardening | Enable PITR before Phase 1 |

## STOP

No Phase 1 work. No schema/RLS/auth/routing/deploy changes performed in this recheck.
