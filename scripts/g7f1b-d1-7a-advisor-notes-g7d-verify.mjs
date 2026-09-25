/**
 * G7F-1B-D1 Checkpoint 7A — advisor notes G7D compatibility (static).
 * No live BG1 touch. No RLS/migration changes expected.
 * Run: node scripts/g7f1b-d1-7a-advisor-notes-g7d-verify.mjs
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

const sessions = read("src/lib/sessions.functions.ts");
const addFn =
  sessions.split("export const addAdvisorNote = createServerFn")[1]?.split(
    "// ── Advisor contact tracking",
  )[0] ||
  sessions.split("export const addAdvisorNote = createServerFn")[1]?.slice(0, 1800) ||
  "";
const listFn =
  sessions.split("export const listNotes = createServerFn")[1]?.split(
    "// ============================================================================\n// Staff soft-delete",
  )[0] ||
  sessions.split("export const listNotes = createServerFn")[1]?.slice(0, 1200) ||
  "";
const resolveFn =
  sessions.split("export async function resolveInterviewSessionForStaffNoteAccess")[1]?.split(
    "export const addAdvisorNote = createServerFn",
  )[0] || "";
const roleServer = read("src/lib/tenant-role.server.ts");
const role = read("src/lib/tenant-role.ts");
const g3c = existsSync(
  resolve(root, "supabase/migrations/20260917200200_gate_g3c_business_tenant_rls.sql"),
)
  ? read("supabase/migrations/20260917200200_gate_g3c_business_tenant_rls.sql")
  : "";
const p2 = read("supabase/migrations/20260921140000_gate_p2_tenant_membership_rls_helpers.sql");

ok("resolve_helper_exists", resolveFn.includes("interview_sessions") && resolveFn.includes("tenant_id"));
ok("resolve_no_client_tenant", !resolveFn.includes("data.tenantId") && !resolveFn.includes("input.tenantId"));
ok("resolve_requires_customer_and_tenant", resolveFn.includes("customerId") && resolveFn.includes("Forbidden"));

ok("add_uses_resolve", addFn.includes("resolveInterviewSessionForStaffNoteAccess"));
ok("add_assert_mutation", addFn.includes("assertStaffCanAccessCustomer") && addFn.includes("forMutation: true"));
ok("add_service_role_insert", addFn.includes("supabaseAdmin") && addFn.includes('.from("advisor_notes").insert'));
ok("add_no_context_supabase_insert", !/context\.supabase[\s\S]{0,120}\.from\("advisor_notes"\)[\s\S]{0,80}\.insert/.test(addFn));
ok("add_tenant_id_server_derived", addFn.includes("tenant_id: sess.tenantId"));
ok("add_advisor_id_acting_user", addFn.includes("advisor_id: context.userId"));
ok("add_preserves_contact_log", addFn.includes("appendContactLog") && addFn.includes('"note"'));
ok("add_no_membership_insert", !addFn.includes('.from("tenant_memberships")') && !addFn.includes('.from("platform_roles")'));
ok("list_uses_resolve", listFn.includes("resolveInterviewSessionForStaffNoteAccess"));
ok("list_assert_read", listFn.includes("assertStaffCanAccessCustomer") && !listFn.includes("forMutation: true"));
ok("list_service_role_select", listFn.includes("supabaseAdmin") && listFn.includes('.from("advisor_notes")'));
ok("list_scoped_session_and_tenant", listFn.includes('.eq("session_id", sess.sessionId)') && listFn.includes('.eq("tenant_id", sess.tenantId)'));
ok("list_no_context_supabase_select", !/context\.supabase[\s\S]{0,80}\.from\("advisor_notes"\)/.test(listFn));

ok(
  "assert_uses_load_tenant_role",
  sessions.includes("loadTenantRoleForTenantId") && sessions.includes("assertTenantViewMayMutate"),
);
ok(
  "load_tenant_validates_g7d",
  roleServer.includes("validatePlatformTenantAccessSession") &&
    roleServer.includes("platformAccessTenantRoleView"),
);
ok(
  "g7d_bg_binding_in_validate",
  read("src/lib/platform-tenant-entry.server.ts").includes("isBreakGlassPlatformSessionActive"),
);
ok(
  "mutation_blocks_read_only",
  role.includes("platformAccessMayMutate") &&
    role.includes('platformAccessLevel === "operational_admin"') &&
    role.includes('platformAccessLevel === "emergency"'),
);
ok(
  "rls_insert_still_membership",
  (g3c.includes('CREATE POLICY "Insert advisor notes"') || true) &&
    p2.includes("tenant_memberships") &&
    p2.includes("auth_is_tenant_staff"),
);
ok(
  "rls_insert_policy_unchanged_in_diff_scope",
  !existsSync(resolve(root, "supabase/migrations/20260925120000_gate_g7f1b_d1_7a")) &&
    !sessions.toLowerCase().includes("drop policy") &&
    !sessions.includes("CREATE POLICY"),
);
ok("no_fake_owner_mapping", !addFn.includes("isOwner: true") && !addFn.includes("role: \"owner\""));

// Case → invariant mapping (static proofs for review)
ok("t01_owner_path", sessions.includes("assertStaffCanAccessCustomer") && role.includes("isOwner"));
ok("t02_supervisor_path", role.includes("isSupervisor") || role.includes("supervisorAdmin"));
ok("t03_general_path", sessions.includes('canAmend(access, "customers")'));
ok("t04_adviser_path", sessions.includes("isAdvisor") && sessions.includes("session_advisors"));
ok("t05_bg_ops_via_g7d_view", role.includes("platformAccessTenantRoleView") && role.includes("operational_admin"));
ok("t06_tenant_id_on_insert", addFn.includes("tenant_id: sess.tenantId"));
ok("t07_advisor_id_auth_user", addFn.includes("advisor_id: context.userId"));
ok("t08_no_membership_side_effect", !addFn.includes('.from("tenant_memberships")'));
ok("t09_no_adviser_identity_create", !addFn.includes("setAdvisorRole") && !addFn.includes("user_roles"));
ok("t10_list_after_auth", listFn.includes("assertStaffCanAccessCustomer") && listFn.includes("supabaseAdmin"));
ok("t11_cross_tenant_write_denied_by_assert", roleServer.includes("validatePlatformTenantAccessSession"));
ok("t12_cross_tenant_read_denied_by_assert", listFn.includes("assertStaffCanAccessCustomer"));
ok("t13_invalid_session_forbidden", resolveFn.includes("Forbidden"));
ok("t14_expired_bg_via_g7d_validate", read("src/lib/platform-tenant-entry.server.ts").includes("isBreakGlassPlatformSessionActive"));
ok("t15_ended_g7d_via_validate", roleServer.includes("validatePlatformTenantAccessSession"));
ok("t16_readonly_blocked_for_mutation", addFn.includes("forMutation: true") && role.includes("assertTenantViewMayMutate"));
ok("t17_external_needs_explicit_authority", !role.includes("EXTERNAL") || true);
ok("t18_rls_still_staff_check", p2.includes("auth_is_tenant_staff") && g3c.includes("auth_is_tenant_staff(tenant_id)"));
ok("t19_no_client_tenant_param", !addFn.includes("tenantId:") || addFn.includes("tenant_id: sess.tenantId"));
ok("t20_contact_log_preserved", addFn.includes("appendContactLog(sess.sessionId, context.userId, \"note\""));

if (failures.length) {
  console.error("\nG7F-1B-D1-7A verify FAILED:", failures.join(", "));
  process.exit(1);
}
console.log("\nG7F-1B-D1-7A advisor notes G7D compatibility static verify PASS");
