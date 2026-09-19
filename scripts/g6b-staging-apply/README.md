# G6B staging-only apply packs

Generated concatenations of historical `supabase/migrations` SQL for a **clean Mortgage Hub Staging** project (`fwgjtbeigpipvayytwlu`).

These files are **not** production migrations. Do not copy them into `supabase/migrations/`. Do not apply them to `tiuplmftooauihulhtws`.

Order:

1. `pre-g2-part1.sql` — migrations before G1
2. `pre-g2-part2.sql` — remaining pre-G1 migrations through advisor diary
3. `pre-g2-part3.sql` — G1 / G1A
4. `../g6b-staging-g2-structural.sql` — G2 structure without production identities
5. `post-g2.sql` — G3 through G6 invite membership role

**Sidecar:** production also had tables created via `supabase/RUN_*.sql` (telephony, network commission, audit logs, profile address). Those are applied once as `g6b_staging_sidecar_run_tables` so G1 nullable `tenant_id` columns can succeed on a clean project.

**Migration-history treatment**

Supabase MCP `apply_migration` records its own timestamps in `schema_migrations` (not the git filenames). Staging history is therefore a **named bootstrap sequence**, not a clone of production version keys:

| Staging version name | Meaning |
|---|---|
| `g6b_staging_pre_g2_part*` | Historical pre-G2 files, concatenated |
| `g6b_staging_sidecar_run_tables` | Production `RUN_*.sql` tables missing from dated migrations |
| `gate_g1_*` / `gate_g1a_*` | G1 / G1A originals |
| `gate_g2_tenant_ownership_and_memberships_staging_structural` | G2 **structure only** — not the production identity seed |
| `gate_g3*` … `gate_g6*` | Remaining G3–G6 originals |

Git file `20260917193000_gate_g2_tenant_ownership_and_memberships.sql` is never edited. Later shared migrations continue from `supabase/migrations/` identically for both environments.
