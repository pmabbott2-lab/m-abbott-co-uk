/**
 * G7F-2A Super Admin lifecycle cascades — static verification.
 * No secrets. No network. No production.
 * Run: npm exec --yes --package=tsx -- tsx scripts/g7f2a-super-admin-lifecycle-verify.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];
function ok(name, cond, detail = "") {
  if (cond) console.log(`PASS  ${name}${detail ? ` — ${detail}` : ""}`);
  else {
    console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
    failures.push(name);
  }
}
function read(rel) {
  return readFileSync(resolve(root, rel), "utf8");
}

const MIG = "supabase/migrations/20260925130311_gate_g7f2a_super_admin_lifecycle_cascades.sql";
ok("migration_file_exists", existsSync(resolve(root, MIG)));
const mig = read(MIG);
ok("exact_grant_id_bind", mig.includes("AND p_grant_id IS NOT NULL") && mig.includes("WHERE g.id = p_grant_id"));
ok("role_cascade_rpc", mig.includes("revoke_super_admin_role_cascade"));
ok("grant_cascade_rpc", mig.includes("revoke_super_admin_tenant_grant_cascade"));
ok("end_helper", mig.includes("g7f2a_end_sa_g7d_sessions"));
ok("sa_cascade_lock", mig.includes("sa_cascade:"));
ok("level_changed_ends_g7d", mig.includes("v_level_changed") && mig.includes("g7f2a_end_sa_g7d_sessions"));
ok("revoke_public_anon_auth", mig.includes("FROM PUBLIC, anon, authenticated"));
ok("grant_service_role", mig.includes("TO service_role"));
ok("soft_revoke_not_delete_grants", /UPDATE public\.super_admin_tenant_access[\s\S]*revoked_at/.test(mig));
ok("ends_only_sa_basis", mig.includes("authority_basis = 'super_admin_grant'"));
ok("no_membership_insert", !/INSERT INTO public\.tenant_memberships/.test(mig));
ok("no_owner_manufacture", !/role\s*=\s*'Owner'/.test(mig));
ok("no_support_grant_insert", !/INSERT INTO public\.tenant_support_access_grants/.test(mig));
ok("no_emergency_grant_insert", !/INSERT INTO public\.tenant_emergency_access_grants/.test(mig));
ok("no_bg_session_touch", !/platform_break_glass_sessions/.test(mig));
ok("support_basis_unchanged_null_or", mig.includes("(p_grant_id IS NULL OR g.id = p_grant_id)"));
ok("audit_grants_revoked_count", mig.includes("grants_revoked_count"));
ok("audit_g7d_ended_count", mig.includes("g7d_ended_count"));

const server = read("src/lib/platform-admins.server.ts");
ok("server_role_cascade", server.includes('revoke_super_admin_role_cascade'));
ok("server_grant_cascade", server.includes('revoke_super_admin_tenant_grant_cascade'));
ok("server_no_direct_grant_update_revoke", !/revokeSuperAdminTenantGrantImpl[\s\S]*\.update\(\{\s*revoked_at/.test(server));
ok("server_changed_audit_g7d", server.includes("g7d_ended_count") && server.includes("level_changed"));
ok("server_no_membership", !/tenant_memberships/.test(server.split("revokePlatformAdministratorImpl")[1]?.slice(0, 2500) || ""));

const sqlHarness = "scripts/g7f2a-super-admin-lifecycle-verify.sql";
ok("sql_harness_exists", existsSync(resolve(root, sqlHarness)));
const harness = read(sqlHarness);
ok("sql_disposable_prefix", harness.includes("staging-g7f2a-%@example.test"));
ok("sql_no_bg1_touch", harness.includes("staging-g7f1b-break-glass@example.test") && /NOT EXISTS[\s\S]*staging-g7f1b-break-glass/.test(harness));
ok("sql_cleans_fixtures", harness.includes("DELETE FROM auth.users WHERE email LIKE 'staging-g7f2a-%"));

if (failures.length) {
  console.error(`\nG7F-2A static verify FAILED: ${failures.join(", ")}`);
  process.exit(1);
}
console.log("\nG7F-2A static verify PASS");
