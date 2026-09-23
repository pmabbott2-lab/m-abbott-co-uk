/**
 * G7E-2B Super Admin tenant grants — static / synthetic checks.
 * No secrets. No network. No production queries.
 * Run: npm exec --yes --package=tsx -- tsx scripts/g7e2b-super-admin-grants-verify.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { resolvePlatformAuthorityFromRoles } from "../src/lib/platform-authority.ts";
import {
  grantReasonRequired,
  isGrantCurrentlyActive,
  accessLevelLabel,
} from "../src/lib/platform-admins.ts";
import {
  platformAccessMayMutate,
  platformAccessMayRead,
  isPlatformReadOnly,
  tenantViewMayReadOperational,
  platformAccessTenantRoleView,
  assertTenantViewMayMutate,
  resolveTenantRoleView,
} from "../src/lib/tenant-role.ts";
import { getStaffBranchVisibility } from "../src/lib/staff-branch-nav.ts";
import { superAdminGrantToEntryLevel } from "../src/lib/platform-tenant-entry.ts";

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
function exists(rel) {
  return existsSync(resolve(root, rel));
}

const MIGRATION = "supabase/migrations/20260923100000_gate_g7e2b_super_admin_tenant_grants.sql";
ok("migration_exists", exists(MIGRATION));
const mig = read(MIGRATION);
ok("migration_expires_at", mig.includes("expires_at"));
ok("migration_revoked_at", mig.includes("revoked_at"));
ok("migration_reason", mig.includes("reason text"));
ok("migration_updated_at", mig.includes("updated_at"));
ok("migration_partial_unique", mig.includes("WHERE revoked_at IS NULL"));
ok("migration_helpers_revoked", mig.includes("g.revoked_at IS NULL"));
ok("migration_helpers_expired", mig.includes("expires_at IS NULL OR now() < g.expires_at"));
ok("migration_helpers_tenant_active", mig.includes("t.status = 'active'::public.tenant_status"));
ok("migration_g7d_ops_write_only", mig.includes("super_admin_grant_allows_data_write(g.access_level)"));
ok(
  "migration_g7d_no_admin_bypass_for_ops",
  !mig.includes("OR public.super_admin_grant_allows_admin(g.access_level)"),
);
ok("migration_revoke_client_writes", mig.includes("REVOKE INSERT, UPDATE, DELETE, TRUNCATE"));
ok("migration_no_staff_invitations", !mig.includes("staff_invitations"));
ok("migration_no_platform_invite_email", !mig.includes("inviteUserByEmail"));

ok(
  "entry_platform_admin_null",
  superAdminGrantToEntryLevel("platform_admin") === null,
);
ok("entry_data_read_ro", superAdminGrantToEntryLevel("data_read") === "read_only");
ok(
  "entry_data_write_ops",
  superAdminGrantToEntryLevel("data_write") === "operational_admin",
);
ok("entry_full_ops", superAdminGrantToEntryLevel("full") === "operational_admin");

ok(
  "reason_group_permanent_optional",
  grantReasonRequired({
    accessLevel: "data_read",
    tenantType: "GROUP",
    expiresAt: null,
  }) === false,
);
ok(
  "reason_temporary_required",
  grantReasonRequired({
    accessLevel: "data_read",
    tenantType: "GROUP",
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
  }) === true,
);
ok(
  "reason_external_required",
  grantReasonRequired({
    accessLevel: "platform_admin",
    tenantType: "EXTERNAL",
    expiresAt: null,
  }) === true,
);
ok(
  "reason_full_required",
  grantReasonRequired({
    accessLevel: "full",
    tenantType: "GROUP",
    expiresAt: null,
  }) === true,
);

ok(
  "grant_active_no_expiry",
  isGrantCurrentlyActive({ revokedAt: null, expiresAt: null }) === true,
);
ok(
  "grant_expired",
  isGrantCurrentlyActive({
    revokedAt: null,
    expiresAt: new Date(Date.now() - 1000).toISOString(),
  }) === false,
);
ok(
  "grant_revoked",
  isGrantCurrentlyActive({
    revokedAt: new Date().toISOString(),
    expiresAt: null,
  }) === false,
);

const so = resolvePlatformAuthorityFromRoles({ userId: "so", roles: ["super_owner"] });
const sa = resolvePlatformAuthorityFromRoles({ userId: "sa", roles: ["super_admin"] });
ok("so_create_company", so.canCreateCompany);
ok("sa_no_create_company", !sa.canCreateCompany);
ok("sa_no_list_all", !sa.canListPlatformTenants);

const server = read("src/lib/platform-admins.server.ts");
ok("server_grant_upsert", server.includes("upsertSuperAdminTenantGrantImpl"));
ok("server_grant_list", server.includes("listSuperAdminTenantGrantsImpl"));
ok("server_requires_so", server.includes("requireSuperOwner"));
ok("server_target_must_be_sa", server.includes("Target must currently be a Super Admin"));
ok("server_atomic_rpc", server.includes("upsert_super_admin_tenant_grant_atomic"));
ok("server_no_membership_insert", !server.includes('.from("tenant_memberships").insert'));
ok("migration_atomic_rpc", mig.includes("upsert_super_admin_tenant_grant_atomic"));
ok("migration_atomic_advisory", mig.includes("pg_advisory_xact_lock"));
ok("migration_atomic_service_only", mig.includes("TO service_role") && mig.includes("FROM PUBLIC, anon, authenticated"));
ok("server_audit_created", server.includes("SUPER_ADMIN_GRANT_CREATED"));
ok("server_audit_changed", server.includes("SUPER_ADMIN_GRANT_CHANGED"));
ok("server_audit_revoked", server.includes("SUPER_ADMIN_GRANT_REVOKED"));

const fns = read("src/lib/platform-admins.functions.ts");
ok("fns_grant_upsert", fns.includes("upsertSuperAdminTenantGrant"));
ok("fns_grant_list", fns.includes("listSuperAdminTenantGrants"));

const ui = read("src/routes/platform/admins.tsx");
ok("ui_tenant_access", ui.includes("Tenant access") || ui.includes("SuperAdminTenantAccessPanel"));
ok("ui_full_warning", ui.includes("does NOT make the user a Tenant Owner"));
ok("ui_external_warning", ui.includes("EXTERNAL"));
ok("ui_revoke_warning", ui.includes("lose authority on its next server"));
ok("ui_expiry", ui.includes("No expiry") && ui.includes("24 hours"));
ok("ui_reason", ui.includes("Reason"));
ok("ui_no_raw_tenant_uuid", !ui.includes("tenant_id") && !ui.includes("user_id"));

const dash = read("src/lib/platform-dashboard.server.ts");
ok("dashboard_filters_revoked", dash.includes("revoked_at"));
ok("dashboard_filters_expired", dash.includes("expires_at"));

const entry = read("src/lib/platform-tenant-entry.server.ts");
ok("entry_filters_revoked", entry.includes("revoked_at"));
ok("entry_filters_expired", entry.includes("expires_at"));

const owners = read("src/lib/platform-tenant-owners.server.ts");
ok("owner_mgmt_still_so", owners.includes("requireSuperOwner"));

const audit = read("src/lib/platform-audit.ts");
ok(
  "audit_types",
  audit.includes("SUPER_ADMIN_GRANT_CREATED") && audit.includes("SUPER_ADMIN_GRANT_REVOKED"),
);
ok(
  "audit_labels",
  read("src/lib/platform-dashboard.ts").includes("Company access granted"),
);

ok("access_label_full", accessLevelLabel("full") === "Full");

ok("g7e2a_invite_untouched", exists("src/routes/platform-invite.tsx"));
ok("g7d_cookie_untouched", read("src/lib/platform-tenant-entry.ts").includes("mh_platform_tenant_access"));

const roleServer = read("src/lib/tenant-role.server.ts");
const g7dCall = roleServer.indexOf("await validatePlatformTenantAccessSession");
const membershipCall = roleServer.indexOf("await listTenantMembershipRoles");
ok(
  "g7d_ceiling_before_membership",
  g7dCall > 0 && membershipCall > 0 && g7dCall < membershipCall,
);
ok(
  "g7d_ceiling_comment",
  roleServer.includes("G7D authority ceiling") || roleServer.includes("overrides ordinary membership"),
);
ok(
  "require_ops_mutation_helper",
  roleServer.includes("requireActingTenantOperationalMutation"),
);

const roleTsEarly = read("src/lib/tenant-role.ts");
ok("assert_tenant_view_may_mutate", roleTsEarly.includes("assertTenantViewMayMutate"));
ok(
  "read_only_not_main_admin_view",
  roleTsEarly.includes("// read_only: not main-admin for write gates"),
);

const dualRo = platformAccessTenantRoleView({
  tenantId: "t001",
  accessLevel: "read_only",
  basisLabel: "test",
});
ok("ceiling_ro_may_not_mutate", !platformAccessMayMutate(dualRo));
ok("ceiling_ro_not_owner", !dualRo.isOwner && !dualRo.adminAccess.isOwner);
ok("ceiling_ro_not_main_admin", !dualRo.isMainAdmin);
ok("ceiling_ro_may_read", platformAccessMayRead(dualRo));
ok("ceiling_ro_is_platform_read_only", isPlatformReadOnly(dualRo));
ok("ceiling_ro_tenant_may_read_ops", tenantViewMayReadOperational(dualRo));
let mutateDenied = false;
try {
  assertTenantViewMayMutate(dualRo);
} catch {
  mutateDenied = true;
}
ok("ceiling_ro_assert_throws", mutateDenied);

const roNav = getStaffBranchVisibility({
  isAdvisor: dualRo.isAdvisor,
  isMainAdmin: dualRo.isMainAdmin,
  isOwner: dualRo.isOwner,
  isSupervisor: dualRo.isSupervisor,
  isIntroducer: dualRo.isIntroducer,
  adminAccess: dualRo.adminAccess,
  platformReadOnly: isPlatformReadOnly(dualRo),
});
ok("ro_nav_customers", roNav.branches.customers && roNav.customers.list && roNav.customers.contacts);
ok("ro_nav_diary", roNav.branches.diary && roNav.diary.allAppointments && roNav.diary.myDiary);
ok("ro_nav_no_diary_settings", !roNav.diary.diarySettings);
ok("ro_nav_no_management", !roNav.branches.management);
ok("ro_nav_no_finance", !roNav.branches.finance);
ok("ro_nav_no_owner_admin", !roNav.management.adminAccess && !roNav.management.manage);

const dualOps = platformAccessTenantRoleView({
  tenantId: "t001",
  accessLevel: "operational_admin",
  basisLabel: "test",
});
ok("ceiling_ops_may_mutate", platformAccessMayMutate(dualOps));
ok("ceiling_ops_not_owner_flag", !dualOps.isOwner && !dualOps.adminAccess.isOwner);
ok("ceiling_ops_is_main_admin", dualOps.isMainAdmin);
ok("ceiling_ops_may_read", platformAccessMayRead(dualOps));
ok("ceiling_ops_not_read_only_flag", !isPlatformReadOnly(dualOps));

const opsNav = getStaffBranchVisibility({
  isAdvisor: dualOps.isAdvisor,
  isMainAdmin: dualOps.isMainAdmin,
  isOwner: dualOps.isOwner,
  isSupervisor: dualOps.isSupervisor,
  isIntroducer: dualOps.isIntroducer,
  adminAccess: dualOps.adminAccess,
  platformReadOnly: isPlatformReadOnly(dualOps),
});
ok("ops_nav_customers", opsNav.branches.customers);
ok("ops_nav_management", opsNav.branches.management);
ok("ops_nav_not_owner_admin_tab", !opsNav.management.adminAccess);

const ownerView = resolveTenantRoleView({
  membershipRoles: ["owner"],
  tenantId: "t001",
  tenantSlug: "mortgageeasy",
});
ok("direct_owner_is_main_admin", ownerView.isMainAdmin && ownerView.isOwner);
ok("direct_owner_may_mutate", platformAccessMayMutate(ownerView));
const ownerNav = getStaffBranchVisibility({
  isAdvisor: ownerView.isAdvisor,
  isMainAdmin: ownerView.isMainAdmin,
  isOwner: ownerView.isOwner,
  isSupervisor: ownerView.isSupervisor,
  isIntroducer: ownerView.isIntroducer,
  adminAccess: ownerView.adminAccess,
});
ok("direct_owner_nav_management", ownerNav.branches.management && ownerNav.management.adminAccess);

const roleTs = read("src/lib/tenant-role.ts");
ok("helper_platform_access_may_read", roleTs.includes("export function platformAccessMayRead"));
ok("helper_is_platform_read_only", roleTs.includes("export function isPlatformReadOnly"));
ok(
  "helper_tenant_view_may_read",
  roleTs.includes("export function tenantViewMayReadOperational"),
);

const sessions = read("src/lib/sessions.functions.ts");
ok(
  "list_sessions_uses_platform_may_read",
  sessions.includes("platformAccessMayRead") &&
    !sessions.includes("platformAccess && !view.isMainAdmin"),
);
ok(
  "contact_update_for_mutation",
  sessions.includes("forMutation: true") && sessions.includes("updateCustomerContact"),
);
ok(
  "assert_staff_platform_data_access",
  sessions.includes("platformDataAccess") && sessions.includes("platformAccessMayRead"),
);

const navTs = read("src/lib/staff-branch-nav.ts");
ok("nav_platform_read_only_flag", navTs.includes("platformReadOnly"));
ok("nav_platform_read_only_visibility", navTs.includes("platformReadOnlyVisibility"));

const staffDash = read("src/components/staff/StaffDashboard.tsx");
ok("dash_platform_read_only", staffDash.includes("platformReadOnly") && staffDash.includes("canLoadOperationalReads"));
ok("dash_no_is_main_admin_for_ro", staffDash.includes("listAsMainAdmin = isMainAdmin && !platformReadOnly"));

const booking = read("src/lib/booking.functions.ts");
ok("diary_list_platform_may_read", booking.includes("platformAccessMayRead(view)"));
ok("diary_list_tenant_scoped", booking.includes('.eq("tenant_id", view.tenantId)'));
ok("reschedule_assert_mutate", booking.includes("assertTenantViewMayMutate(flags.view)"));

const customersUi = read("src/routes/_authenticated/customers.$customerId.tsx");
ok(
  "ui_contact_edit_hidden_read_only",
  customersUi.includes("isPlatformReadOnly") && customersUi.includes("canEditContact"),
);
ok("ui_book_hidden_read_only", customersUi.includes("canBookOrPromote"));

if (failures.length) {
  console.error(`\nG7E-2B verify FAIL (${failures.length})`);
  process.exit(1);
}
console.log("\nG7E-2B super admin grants verify PASS");
