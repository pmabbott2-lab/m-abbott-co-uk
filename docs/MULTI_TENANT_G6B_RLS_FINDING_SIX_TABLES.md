# G6B security finding — six tables with RLS off

**Status:** **Remediated on staging (Phase 2C) and production (Phase 2D).**  
**Severity (pre-fix):** CRITICAL SECURITY BLOCKER  
**Staging:** `fwgjtbeigpipvayytwlu`  
**Production:** `tiuplmftooauihulhtws` — migration `gate_g6b_enable_rls_six_unprotected_tables` (`20260918182133`)  
**Date:** 2026-09-18

## Historical G3D gap

G3D created SELECT policies for four of the six tables but **never enabled RLS**. Default GRANTs left `anon` / `authenticated` with full CRUD. Phase 2B proved cross-tenant and unknown-user reads.

| Table | Staging after Phase 2C |
|-------|-------------------------|
| `commission_rate_history` | RLS ON · admin SELECT · no client writes |
| `customer_introducer_links` | RLS ON · staff/admin/support/own-customer/own-introducer SELECT · no client writes |
| `finance_audit_log` | RLS ON · admin SELECT · no client writes |
| `finance_settings` | RLS ON · admin SELECT · G3D client ALL policy removed · no client writes |
| `introducer_amendment_history` | RLS ON · admin SELECT · no client writes |
| `view_as_audit_log` | RLS ON · admin or own-actor-with-tenant-access SELECT · no client writes |

Forward-only migration (do not rewrite G1–G6A):

`supabase/migrations/20260918200000_gate_g6b_enable_rls_six_unprotected_tables.sql`

Applied on staging as `gate_g6b_enable_rls_six_unprotected_tables` (`20260918181516`). Applied on production as `gate_g6b_enable_rls_six_unprotected_tables` (`20260918182133`).

## Production

Same G3D source gap is now patched on production via the same forward-only file. Do not disable RLS as a rollback.
