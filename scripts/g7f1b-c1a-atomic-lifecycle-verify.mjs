/**
 * G7F-1B-C1A — static verification for atomic establish_break_glass_identity.
 * Runtime SQL results are reported separately from staging MCP execution.
 * Run: npm exec --yes --package=tsx -- tsx scripts/g7f1b-c1a-atomic-lifecycle-verify.mjs
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

const MIG = "supabase/migrations/20260924135501_gate_g7f1b_c1a_atomic_break_glass_lifecycle.sql";
ok("migration_file_exists", existsSync(resolve(root, MIG)));
const mig = read(MIG);
ok("rpc_name", mig.includes("establish_break_glass_identity"));
ok("security_definer", /SECURITY DEFINER/i.test(mig));
ok("safe_search_path", mig.includes("SET search_path = public"));
ok("advisory_lock", mig.includes("pg_advisory_xact_lock(872014002)"));
ok("actor_so_recheck", mig.includes("is_super_owner(p_acting_user_id)"));
ok("target_auth_users", mig.includes("FROM auth.users"));
ok("created_event", mig.includes("BREAK_GLASS_IDENTITY_CREATED"));
ok("replaced_event", mig.includes("BREAK_GLASS_IDENTITY_REPLACED"));
ok("already_active", mig.includes("already_active"));
ok("revoke_anon_auth", mig.includes("FROM PUBLIC, anon, authenticated"));
ok("grant_service_role", mig.includes("TO service_role"));
ok("no_password_in_audit", !/password|jwt|refresh.?token|mfa.?secret/i.test(mig.split("security_audit_events")[1]?.slice(0, 800) || ""));
ok("keeps_prior_so_on_replace", !/DELETE FROM public\.platform_roles/.test(mig));
ok("no_membership_insert", !/tenant_memberships/.test(mig));
ok("no_g7d_session", !/platform_tenant_access_sessions/.test(mig));
ok("v_had_active_preserved", mig.includes("v_had_active"));

const server = read("src/lib/break-glass-registry.server.ts");
const fns = read("src/lib/break-glass.functions.ts");
ok("wrapper_impl", server.includes("establishBreakGlassIdentityRpc"));
ok("wrapper_requires_so", fns.includes("requireSuperOwner"));
ok("wrapper_rpc_call", server.includes('establish_break_glass_identity'));
ok("wrapper_actor_from_input_acting", server.includes("p_acting_user_id: actingUserId"));
ok("server_fn_export", fns.includes("establishBreakGlassIdentity"));
ok("auth_middleware", fns.includes("requireSupabaseAuth"));
ok("actor_from_context", fns.includes("context") && fns.includes("actingUserId") && !fns.includes("actingUserId: data"));
ok("no_client_actor_input", !/actingUserId:\s*z\.|p_acting_user_id:\s*data|actingUserId:\s*data/.test(fns));
ok("input_only_target", fns.includes("targetUserId: z.string().uuid()"));
ok("wrapper_so_gate", fns.includes("requireSuperOwner") && fns.includes("requireSupabaseAuth"));
ok("classification_matrix_so_gate", fns.includes("requireSuperOwner"));
ok("classification_matrix_no_client_actor", !/actingUserId:\s*z\./.test(fns));
ok("rpc_rechecks_actor_so", mig.includes("is_super_owner(p_acting_user_id)"));


const sqlHarness = "scripts/g7f1b-c1a-atomic-lifecycle-verify.sql";
ok("sql_harness_exists", existsSync(resolve(root, sqlHarness)));
const harness = read(sqlHarness);
ok("sql_cleans_to_so2", harness.includes("count_super_owners() = 2"));
ok("sql_no_bg1_email", harness.includes("staging-g7f1b-break-glass@example.test") && harness.includes("NOT EXISTS"));

if (failures.length) {
  console.error(`\nG7F-1B-C1A static verify FAILED: ${failures.join(", ")}`);
  process.exit(1);
}
console.log("\nG7F-1B-C1A atomic lifecycle static verify PASS");
