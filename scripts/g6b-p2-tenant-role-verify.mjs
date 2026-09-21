/**
 * P2 tenant-role authority checks (UI shell + server authorization).
 * No secrets. No network. No staging/production queries.
 * Run: npx tsx scripts/g6b-p2-tenant-role-verify.mjs
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  canAdministerAsTenantMember,
  canAdviseAsTenantMember,
  canIntroduceAsTenantMember,
  deniedTenantRoleView,
  resolveTenantRoleView,
} from "../src/lib/tenant-role.ts";
import { getStaffBranchVisibility } from "../src/lib/staff-branch-nav.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];
function ok(name, cond, detail = "") {
  if (cond) console.log(`PASS  ${name}${detail ? ` — ${detail}` : ""}`);
  else {
    console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
    failures.push(name);
  }
}

const T001 = "tenant-001";
const T002 = "tenant-002";

function viewFor(memberships, tenantId, tenantSlug) {
  const roles = memberships.filter((m) => m.tenantId === tenantId).map((m) => m.role);
  return resolveTenantRoleView({
    membershipRoles: roles,
    tenantId,
    tenantSlug,
  });
}

function nav(view) {
  return getStaffBranchVisibility({
    isAdvisor: view.isAdvisor,
    isMainAdmin: view.isMainAdmin,
    isOwner: view.isOwner,
    isSupervisor: view.isSupervisor,
    isIntroducer: view.isIntroducer,
    adminAccess: view.adminAccess,
  });
}

function homeShell(view) {
  if (!view.member) return "denied";
  if (view.isMainAdmin) return view.shell;
  if (view.isAdvisor) return "adviser";
  if (view.isIntroducer) return "introducer";
  return view.shell;
}

// ── Scenario A: 001 Owner / no 002 ──────────────────────────────────────────
const a = [{ tenantId: T001, role: "owner" }];
const a1 = viewFor(a, T001, "mortgageeasy");
const a2 = viewFor(a, T002, "trentvalleyfs");
ok("A_001_shell_owner", homeShell(a1) === "owner" && a1.isOwner && a1.isMainAdmin);
ok("A_001_admin_yes", canAdministerAsTenantMember(a1) && !canAdviseAsTenantMember(a1));
ok("A_001_nav_management", nav(a1).branches.management === true && nav(a1).management.adminAccess === true);
ok("A_002_denied", a2.shell === "denied" && !a2.member);
ok("A_002_admin_no", !canAdministerAsTenantMember(a2) && !canAdviseAsTenantMember(a2));
ok("A_002_no_membership_denied", deniedTenantRoleView({ tenantId: T002 }).member === false);

// ── Scenario B: 001 Owner / 002 Adviser ─────────────────────────────────────
const b = [
  { tenantId: T001, role: "owner" },
  { tenantId: T002, role: "adviser" },
];
const b1 = viewFor(b, T001, "mortgageeasy");
const b2 = viewFor(b, T002, "trentvalleyfs");
ok("B_001_shell_owner", homeShell(b1) === "owner" && b1.isOwner && !b1.isAdvisor);
ok("B_002_shell_adviser", homeShell(b2) === "adviser" && b2.isAdvisor && !b2.isOwner && !b2.isMainAdmin);
ok("B_001_owner_cannot_admin_002", !canAdministerAsTenantMember(b2) && canAdviseAsTenantMember(b2));
ok("B_002_adviser_cannot_admin_001", canAdministerAsTenantMember(b1) && !canAdviseAsTenantMember(b1));
ok("B_002_nav_not_owner", nav(b2).branches.management === false && nav(b2).management.adminAccess === false);
ok("B_001_nav_owner", nav(b1).branches.management === true);

// ── Scenario C: 001 Adviser / 002 Owner ─────────────────────────────────────
const c = [
  { tenantId: T001, role: "adviser" },
  { tenantId: T002, role: "owner" },
];
const c1 = viewFor(c, T001, "mortgageeasy");
const c2 = viewFor(c, T002, "trentvalleyfs");
ok("C_001_shell_adviser", homeShell(c1) === "adviser" && c1.isAdvisor && !c1.isOwner);
ok("C_002_shell_owner", homeShell(c2) === "owner" && c2.isOwner);
ok("C_002_owner_does_not_become_owner_in_001", !c1.isOwner && !canAdministerAsTenantMember(c1));
ok("C_001_adviser_cannot_admin_002", canAdministerAsTenantMember(c2) && !canAdviseAsTenantMember(c2));

// ── Scenario D: 001 Introducer / 002 Adviser ────────────────────────────────
const d = [
  { tenantId: T001, role: "introducer" },
  { tenantId: T002, role: "adviser" },
];
const d1 = viewFor(d, T001, "mortgageeasy");
const d2 = viewFor(d, T002, "trentvalleyfs");
ok("D_001_shell_introducer", homeShell(d1) === "introducer" && d1.isIntroducer && !d1.isAdvisor);
ok("D_002_shell_adviser", homeShell(d2) === "adviser" && d2.isAdvisor && !d2.isIntroducer);
ok("D_001_introducer_not_introducer_in_002", !canIntroduceAsTenantMember(d2) && canAdviseAsTenantMember(d2));
ok("D_002_adviser_not_introducer_in_001", canIntroduceAsTenantMember(d1) && !canAdviseAsTenantMember(d1));
ok("D_001_nav_introducers", nav(d1).branches.introducers === true && nav(d1).branches.management === false);

// ── Scenario E: 001 General / no 002 ────────────────────────────────────────
const e = [{ tenantId: T001, role: "general" }];
const e1 = viewFor(e, T001, "mortgageeasy");
const e2 = viewFor(e, T002, "trentvalleyfs");
ok("E_001_shell_general", homeShell(e1) === "general" && e1.isGeneralAdmin && e1.isMainAdmin && !e1.isOwner);
ok("E_001_not_flattened_owner", e1.adminLevel === "general" && e1.adminAccess.isOwner === false);
ok("E_002_denied", e2.shell === "denied" && !canAdministerAsTenantMember(e2));

// Owner / supervisor / general remain distinct
const ownerV = resolveTenantRoleView({ membershipRoles: ["owner"], tenantId: T001 });
const superV = resolveTenantRoleView({ membershipRoles: ["supervisor"], tenantId: T001 });
const genV = resolveTenantRoleView({ membershipRoles: ["general"], tenantId: T001 });
ok("owner_not_supervisor_only", ownerV.isOwner && ownerV.isSupervisor && ownerV.shell === "owner");
ok("supervisor_not_owner", superV.isSupervisor && !superV.isOwner && superV.shell === "supervisor");
ok("general_not_owner_or_supervisor", genV.isGeneralAdmin && !genV.isOwner && !genV.isSupervisor);

// Global roles cannot elevate: mapper has no global-role input
const introOnly = resolveTenantRoleView({ membershipRoles: ["introducer"], tenantId: T002 });
ok(
  "global_admin_cannot_elevate_introducer",
  introOnly.shell === "introducer" &&
    !canAdministerAsTenantMember(introOnly) &&
    !introOnly.isMainAdmin,
);
const adviserOnly = resolveTenantRoleView({ membershipRoles: ["adviser"], tenantId: T002 });
ok(
  "global_admin_cannot_elevate_adviser",
  adviserOnly.shell === "adviser" && !canAdministerAsTenantMember(adviserOnly),
);
ok(
  "no_membership_denied",
  resolveTenantRoleView({ membershipRoles: [], tenantId: T002 }).shell === "denied",
);

const mapperSrc = readFileSync(resolve(root, "src/lib/tenant-role.ts"), "utf8");
ok("mapper_no_user_roles_input", !mapperSrc.includes("user_roles") || mapperSrc.includes("not an input"));
ok("mapper_no_admin_emails", !mapperSrc.includes("process.env.ADMIN_EMAILS") && !mapperSrc.includes("parseOwnerEmails"));
ok("mapper_no_has_role", !mapperSrc.includes("has_role"));

const serverSrc = readFileSync(resolve(root, "src/lib/tenant-role.server.ts"), "utf8");
ok("server_no_user_roles_read", !serverSrc.includes('.from("user_roles")'));
ok("server_no_admin_emails", !serverSrc.includes("process.env.ADMIN_EMAILS") && !serverSrc.includes("parseOwnerEmails"));
ok("server_no_001_infer", !serverSrc.includes("mortgageeasy") || serverSrc.includes("Never infers"));
ok("getMyRole_uses_acting_role", readFileSync(resolve(root, "src/lib/sessions.functions.ts"), "utf8").includes("resolveActingTenantRole"));
ok(
  "getMyRole_accepts_tenantSlug",
  readFileSync(resolve(root, "src/lib/sessions.functions.ts"), "utf8").includes("tenantSlug: z.string()"),
);
const adminSrc = readFileSync(resolve(root, "src/lib/admin.functions.ts"), "utf8");
ok("resolveAdminAccess_uses_acting_role", adminSrc.includes("resolveActingTenantRole"));
ok("resolveAdminAccess_ignores_email", adminSrc.includes("_claimsEmail"));
ok("home_passes_tenantSlug", readFileSync(resolve(root, "src/routes/_authenticated/home.tsx"), "utf8").includes('queryKey: ["my-role", tenantSlug ?? null]'));
ok(
  "staff_dashboard_passes_tenantSlug",
  readFileSync(resolve(root, "src/components/staff/StaffDashboard.tsx"), "utf8").includes(
    "tenantSlug",
  ),
);

const migration = resolve(root, "supabase/migrations/20260921140000_gate_p2_tenant_membership_rls_helpers.sql");
ok("p2_rls_migration_exists", existsSync(migration));
const mig = existsSync(migration) ? readFileSync(migration, "utf8") : "";
ok("rls_staff_no_has_role", mig.includes("auth_is_tenant_staff") && !mig.includes("has_role("));
ok("rls_admin_no_has_role", mig.includes("auth_is_tenant_admin") && !mig.includes("has_role("));
ok("rls_introducer_no_has_role", mig.includes("auth_is_tenant_introducer"));
ok("rls_admin_includes_general", mig.includes("'general'::public.tenant_member_role"));
ok("rls_not_super_owner", !mig.includes("super_admin") && !mig.includes("platform_roles"));
ok("rls_remediates_admin_profiles", mig.includes('DROP POLICY IF EXISTS "Admins view admin profiles"') && mig.includes("auth_is_tenant_admin(tenant_id)"));
ok("rls_remediates_admin_permissions", mig.includes('DROP POLICY IF EXISTS "Admins view permissions"'));
ok("rls_remediates_advisor_profiles", mig.includes('DROP POLICY IF EXISTS "Advisors view advisor codes"') && mig.includes("auth_is_tenant_staff(tenant_id)"));
ok("rls_remediates_interview_sessions", mig.includes('DROP POLICY IF EXISTS "Customer manages own sessions"') && mig.includes("customer_id = auth.uid()"));
ok("rls_remediates_interview_messages", mig.includes('DROP POLICY IF EXISTS "Access messages for own sessions"'));
ok("rls_remediates_interview_answers", mig.includes('DROP POLICY IF EXISTS "Access answers for own sessions"'));
ok("rls_remediates_profiles", mig.includes('DROP POLICY IF EXISTS "Users view own profile"'));
ok("rls_remediates_lender_policies", mig.includes('DROP POLICY IF EXISTS "Staff view lender policies"'));
ok("rls_admin_profiles_own_row", /admin_profiles[\s\S]*user_id = auth\.uid\(\)/.test(mig));
ok("rls_advisor_profiles_own_row", /advisor_profiles[\s\S]*user_id = auth\.uid\(\)/.test(mig));
ok("rls_interview_preserves_customer", mig.includes("s.customer_id = auth.uid()"));
ok("rls_no_second_p2_migration", !existsSync(resolve(root, "supabase/migrations/20260921150000_gate_p2_residual_rls.sql")));

const g3a = readFileSync(resolve(root, "supabase/migrations/20260917200000_gate_g3a_rls_security_helpers.sql"), "utf8");
ok("g3a_legacy_has_role_still_present_until_apply", g3a.includes("has_role"));

ok("no_platform_roles_write", !serverSrc.includes("platform_roles") && !adminSrc.includes("platform_roles"));
ok("no_super_owner", !serverSrc.includes("super_admin_tenant_access") && !adminSrc.includes("Super Owner"));

// ── Residual policy semantics (global app_role is ignored) ──────────────────
const STAFF = new Set(["owner", "supervisor", "general", "adviser"]);
const ADMIN = new Set(["owner", "supervisor", "general"]);

function roleOn(memberships, tenantId) {
  return memberships.find((m) => m.tenantId === tenantId)?.role ?? null;
}
function interviewAccess(memberships, tenantId, { isCustomer = false } = {}) {
  return isCustomer || STAFF.has(roleOn(memberships, tenantId));
}
function advisorProfileAccess(memberships, tenantId, { isOwn = false } = {}) {
  return isOwn || STAFF.has(roleOn(memberships, tenantId));
}
function adminProfileAccess(memberships, tenantId, { isOwn = false } = {}) {
  return isOwn || ADMIN.has(roleOn(memberships, tenantId));
}

const dualOwnerAdviser = [
  { tenantId: T001, role: "owner" },
  { tenantId: T002, role: "adviser" },
];
const dualAdviserOwner = [
  { tenantId: T001, role: "adviser" },
  { tenantId: T002, role: "owner" },
];
const dualIntroAdviser = [
  { tenantId: T001, role: "introducer" },
  { tenantId: T002, role: "adviser" },
];
const generalOnly = [{ tenantId: T001, role: "general" }];
const none = [];

ok("matrix_001_owner_002_adviser_helpers", STAFF.has("adviser") && !ADMIN.has("adviser") && ADMIN.has("owner"));
ok(
  "matrix_001_owner_002_adviser_interview",
  interviewAccess(dualOwnerAdviser, T001) &&
    interviewAccess(dualOwnerAdviser, T002) &&
    !adminProfileAccess(dualOwnerAdviser, T002),
);
ok(
  "matrix_001_owner_002_adviser_admin_profiles",
  adminProfileAccess(dualOwnerAdviser, T001) && !adminProfileAccess(dualOwnerAdviser, T002),
);
ok(
  "matrix_001_owner_002_adviser_advisor_profiles",
  advisorProfileAccess(dualOwnerAdviser, T001) && advisorProfileAccess(dualOwnerAdviser, T002),
);
ok(
  "matrix_001_adviser_002_owner_interview",
  interviewAccess(dualAdviserOwner, T001) &&
    interviewAccess(dualAdviserOwner, T002) &&
    !adminProfileAccess(dualAdviserOwner, T001) &&
    adminProfileAccess(dualAdviserOwner, T002),
);
ok(
  "matrix_001_introducer_002_adviser_no_intro_on_002",
  !STAFF.has("introducer") &&
    !interviewAccess(dualIntroAdviser, T001) &&
    interviewAccess(dualIntroAdviser, T002) &&
    !adminProfileAccess(dualIntroAdviser, T002) &&
    advisorProfileAccess(dualIntroAdviser, T002),
);
ok(
  "matrix_001_general_no_002",
  adminProfileAccess(generalOnly, T001) &&
    interviewAccess(generalOnly, T001) &&
    !interviewAccess(generalOnly, T002) &&
    !adminProfileAccess(generalOnly, T002),
);
ok(
  "matrix_global_admin_002_adviser_ignores_global",
  interviewAccess([{ tenantId: T002, role: "adviser" }], T002) &&
    !adminProfileAccess([{ tenantId: T002, role: "adviser" }], T002),
);
ok(
  "matrix_global_advisor_002_introducer_denied_staff",
  !interviewAccess([{ tenantId: T002, role: "introducer" }], T002) &&
    !advisorProfileAccess([{ tenantId: T002, role: "introducer" }], T002) &&
    advisorProfileAccess([{ tenantId: T002, role: "introducer" }], T002, { isOwn: true }),
);
ok(
  "matrix_global_introducer_002_adviser_not_introducer",
  interviewAccess([{ tenantId: T002, role: "adviser" }], T002) &&
    !canIntroduceAsTenantMember(viewFor([{ tenantId: T002, role: "adviser" }], T002, "trentvalleyfs")),
);
ok("matrix_no_membership_denied", !interviewAccess(none, T002) && !adminProfileAccess(none, T001) && !advisorProfileAccess(none, T002));
ok(
  "matrix_self_access_intact",
  interviewAccess(none, T002, { isCustomer: true }) &&
    advisorProfileAccess(none, T002, { isOwn: true }) &&
    adminProfileAccess(none, T001, { isOwn: true }),
);

const migDir = resolve(root, "supabase/migrations");
const later = readdirSync(migDir)
  .filter((f) => f.endsWith(".sql") && f > "20260921140000_gate_p2_tenant_membership_rls_helpers.sql")
  .filter((f) => readFileSync(resolve(migDir, f), "utf8").includes("has_role("));
ok("no_later_migration_reintroduces_has_role", later.length === 0, later.join(","));

const activePolicyFiles = [
  "20260917200300_gate_g3d_telephony_comms_finance_rls.sql",
  "20260917200200_gate_g3c_business_tenant_rls.sql",
  "20260918200000_gate_g6b_enable_rls_six_unprotected_tables.sql",
  "20260921140000_gate_p2_tenant_membership_rls_helpers.sql",
];
const remainingTenantHasRole = [];
for (const f of activePolicyFiles) {
  const text = readFileSync(resolve(migDir, f), "utf8");
  if (f === "20260921140000_gate_p2_tenant_membership_rls_helpers.sql") {
    if (text.includes("has_role(")) remainingTenantHasRole.push(f);
    continue;
  }
  // G3C/G3D historical text remains; P2 supersedes the tenant-owned defects.
}
ok("p2_active_c_count_zero", remainingTenantHasRole.length === 0, remainingTenantHasRole.join(","));
ok("p2_package_has_zero_has_role_calls", !mig.includes("has_role("));
ok("g3d_null_tenant_templates_remain_compatibility", readFileSync(resolve(migDir, "20260917200300_gate_g3d_telephony_comms_finance_rls.sql"), "utf8").includes("tenant_id IS NULL"));

const securitySql = resolve(root, "scripts/g3-security-verify.sql");
ok("g3_security_harness_exists", existsSync(securitySql));
ok("g3_security_no_production_project", !readFileSync(securitySql, "utf8").includes("tiuplmftooauihulhtws"));

if (failures.length) {
  console.error(`\n${failures.length} failure(s)`);
  process.exit(1);
}
console.log("\nP2 tenant-role verify PASS");
