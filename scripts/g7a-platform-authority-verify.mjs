/**
 * G7A platform authority hardening — static / synthetic checks.
 * No secrets. No network. No staging/production queries. No platform_roles inserts.
 * Run: npx tsx scripts/g7a-platform-authority-verify.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  canAccessTenantDataFromFlags,
  canAdministerTenantFromFlags,
  deniedPlatformAuthority,
  resolvePlatformAuthorityFromRoles,
  superAdminGrantAllowsAdmin,
  superAdminGrantAllowsData,
  superAdminGrantAllowsDataWrite,
  superAdminGrantAllowsVisibility,
  supportScopeAllowsData,
  wouldRemoveLastSuperOwner,
} from "../src/lib/platform-authority.ts";
import { resolveTenantAuthenticatedEntry } from "../src/lib/tenant-access.ts";
import {
  isTenantStaffMember,
  resolveTenantRoleView,
} from "../src/lib/tenant-role.ts";
import { isReservedTenantSlug } from "../src/lib/tenant-presentation.ts";
import { sanitisePlatformAuditMetadata } from "../src/lib/platform-audit.ts";
import { remapAppNavigate } from "../src/lib/tenant-app-nav.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];
function ok(name, cond, detail = "") {
  if (cond) console.log(`PASS  ${name}${detail ? ` — ${detail}` : ""}`);
  else {
    console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
    failures.push(name);
  }
}

const MIGRATION = "supabase/migrations/20260921160000_gate_g7a_platform_authority_hardening.sql";
const migPath = resolve(root, MIGRATION);
const mig = existsSync(migPath) ? readFileSync(migPath, "utf8") : "";
ok("g7a_migration_exists", existsSync(migPath));
ok("g7a_migration_not_applied_comment", mig.includes("LOCAL ONLY"));
ok("g7a_no_platform_roles_insert", !/INSERT\s+INTO\s+public\.platform_roles/i.test(mig));
ok("g7a_no_has_role", !mig.includes("has_role("));
ok("g7a_no_mfa_policy_write", !mig.includes("platform_mfa_policy") || !/UPDATE\s+public\.platform_mfa_policy/i.test(mig));

ok(
  "g7a_so_group_admin_sql",
  mig.includes("t.tenant_type = 'GROUP'::public.tenant_type") &&
    mig.includes("CREATE OR REPLACE FUNCTION public.can_administer_tenant"),
);
ok(
  "g7a_sa_admin_levels_sql",
  mig.includes("'platform_admin'::public.super_admin_access_level") &&
    mig.includes("'full'::public.super_admin_access_level") &&
    mig.includes("super_admin_grant_allows_admin"),
);
ok("g7a_sa_admin_not_any_non_null", !/SELECT p_access_level IS NOT NULL/.test(mig));
ok(
  "g7a_visibility_helper",
  mig.includes("super_admin_grant_allows_visibility") &&
    mig.includes("has_super_admin_tenant_access") &&
    mig.includes("Not administration. Not data."),
);
ok("g7a_support_scope_helper", mig.includes("support_scope_allows_data") && mig.includes("read_metadata"));
ok(
  "g7a_last_so_trigger",
  mig.includes("prevent_last_super_owner_loss") &&
    mig.includes("platform_roles_prevent_last_super_owner") &&
    mig.includes("last_super_owner_protected"),
);
ok("g7a_truncate_guard", mig.includes("platform_roles_prevent_truncate"));

const so = resolvePlatformAuthorityFromRoles({
  userId: "user-so",
  roles: ["super_owner"],
});
ok("so_platform_yes", so.canAccessPlatform && so.isSuperOwner && so.canListPlatformTenants && so.canCreateCompany);
ok(
  "so_no_membership_required",
  so.canAccessPlatform === true,
);

const sa = resolvePlatformAuthorityFromRoles({
  userId: "user-sa",
  roles: ["super_admin"],
});
ok("sa_platform_yes", sa.canAccessPlatform && sa.isSuperAdmin && !sa.canListPlatformTenants && !sa.canCreateCompany);

const owner = resolvePlatformAuthorityFromRoles({
  userId: "user-owner-001",
  roles: ["owner"],
});
ok("001_owner_platform_denied", !owner.canAccessPlatform && !owner.isSuperOwner);

const owner002 = resolvePlatformAuthorityFromRoles({
  userId: "user-owner-002",
  roles: ["owner", "supervisor", "admin"],
});
ok("002_owner_platform_denied", !owner002.canAccessPlatform);

const globalAdmin = resolvePlatformAuthorityFromRoles({
  userId: "user-global-admin",
  roles: ["admin"],
});
ok("global_admin_platform_denied", !globalAdmin.canAccessPlatform && !globalAdmin.isSuperOwner);

ok(
  "email_not_an_input",
  deniedPlatformAuthority({ userId: "anyone" }).canAccessPlatform === false,
);
ok("missing_user_denied", resolvePlatformAuthorityFromRoles({ userId: null, roles: ["super_owner"] }).canAccessPlatform === false);

const owner001View = resolveTenantRoleView({
  membershipRoles: ["owner"],
  tenantId: "t001",
  tenantSlug: "mortgageeasy",
});
const owner002View = resolveTenantRoleView({
  membershipRoles: [],
  tenantId: "t002",
  tenantSlug: "trentvalleyfs",
});
ok("001_owner_cannot_admin_002_membership", owner001View.isOwner && !owner002View.member && owner002View.shell === "denied");
ok(
  "001_owner_cannot_admin_002_flags",
  canAdministerTenantFromFlags({
    isSuperOwner: false,
    isSuperAdmin: false,
    tenantType: "GROUP",
    superAdminGrant: null,
    membershipRole: null,
  }) === false,
);
ok(
  "002_owner_cannot_admin_001_flags",
  canAdministerTenantFromFlags({
    isSuperOwner: false,
    isSuperAdmin: false,
    tenantType: "GROUP",
    superAdminGrant: null,
    membershipRole: null,
  }) === false,
);

ok(
  "sa_no_grant_cannot_admin_001",
  canAdministerTenantFromFlags({
    isSuperOwner: false,
    isSuperAdmin: true,
    tenantType: "GROUP",
    superAdminGrant: null,
    membershipRole: null,
  }) === false,
);
ok(
  "sa_no_grant_cannot_admin_002",
  canAdministerTenantFromFlags({
    isSuperOwner: false,
    isSuperAdmin: true,
    tenantType: "EXTERNAL",
    superAdminGrant: null,
    membershipRole: null,
  }) === false,
);

ok(
  "sa_data_read_not_admin",
  superAdminGrantAllowsVisibility("data_read") &&
    superAdminGrantAllowsData("data_read") &&
    !superAdminGrantAllowsAdmin("data_read") &&
    !superAdminGrantAllowsDataWrite("data_read"),
);
ok(
  "sa_platform_admin_not_data",
  superAdminGrantAllowsAdmin("platform_admin") &&
    superAdminGrantAllowsVisibility("platform_admin") &&
    !superAdminGrantAllowsData("platform_admin") &&
    !superAdminGrantAllowsDataWrite("platform_admin"),
);
ok(
  "sa_full_all",
  superAdminGrantAllowsAdmin("full") &&
    superAdminGrantAllowsData("full") &&
    superAdminGrantAllowsDataWrite("full") &&
    superAdminGrantAllowsVisibility("full"),
);
ok(
  "sa_data_write_not_admin",
  superAdminGrantAllowsData("data_write") &&
    superAdminGrantAllowsDataWrite("data_write") &&
    !superAdminGrantAllowsAdmin("data_write"),
);
ok(
  "sa_data_read_grant_cannot_admin_tenant",
  canAdministerTenantFromFlags({
    isSuperOwner: false,
    isSuperAdmin: true,
    tenantType: "GROUP",
    superAdminGrant: "data_read",
    membershipRole: null,
  }) === false,
);
ok(
  "sa_platform_admin_can_admin_granted_only",
  canAdministerTenantFromFlags({
    isSuperOwner: false,
    isSuperAdmin: true,
    tenantType: "GROUP",
    superAdminGrant: "platform_admin",
    membershipRole: null,
  }) === true,
);

ok(
  "so_group_admin_yes",
  canAdministerTenantFromFlags({
    isSuperOwner: true,
    isSuperAdmin: false,
    tenantType: "GROUP",
    superAdminGrant: null,
    membershipRole: null,
  }) === true,
);
ok(
  "so_external_admin_no",
  canAdministerTenantFromFlags({
    isSuperOwner: true,
    isSuperAdmin: false,
    tenantType: "EXTERNAL",
    superAdminGrant: null,
    membershipRole: null,
  }) === false,
);
ok(
  "so_group_data_yes",
  canAccessTenantDataFromFlags({
    isSuperOwner: true,
    isSuperAdmin: false,
    tenantType: "GROUP",
    superAdminGrant: null,
    hasMembership: false,
  }) === true,
);
ok(
  "so_external_data_no",
  canAccessTenantDataFromFlags({
    isSuperOwner: true,
    isSuperAdmin: false,
    tenantType: "EXTERNAL",
    superAdminGrant: null,
    hasMembership: false,
  }) === false,
);

const soNoMember = resolveTenantRoleView({ membershipRoles: [], tenantId: "t001" });
ok(
  "so_not_tenant_staff",
  so.isSuperOwner && !soNoMember.member && !isTenantStaffMember(soNoMember) && soNoMember.shell === "denied",
);
ok(
  "tenant_gate_so_not_member",
  resolveTenantAuthenticatedEntry({ userId: "user-so", member: false }) === "denied",
);
ok(
  "tenant_gate_member_ok",
  resolveTenantAuthenticatedEntry({ userId: "user-owner", member: true }) === "ok",
);

ok("support_metadata_not_data", supportScopeAllowsData("read_metadata") === false);
ok("support_full_read_is_data", supportScopeAllowsData("full_read") === true);
ok("support_read_cases_is_data", supportScopeAllowsData("read_cases") === true);

const lastOnly = [{ id: "r1", userId: "u1", role: "super_owner" }];
ok("last_so_delete_blocked", wouldRemoveLastSuperOwner(lastOnly, { op: "delete", id: "r1" }) === true);
ok(
  "last_so_role_change_blocked",
  wouldRemoveLastSuperOwner(lastOnly, { op: "update_role", id: "r1", nextRole: "super_admin" }) === true,
);
const two = [
  { id: "r1", userId: "u1", role: "super_owner" },
  { id: "r2", userId: "u2", role: "super_owner" },
];
ok("second_so_delete_allowed", wouldRemoveLastSuperOwner(two, { op: "delete", id: "r1" }) === false);
ok(
  "sa_delete_when_so_exists_allowed",
  wouldRemoveLastSuperOwner(
    [
      { id: "r1", userId: "u1", role: "super_owner" },
      { id: "r3", userId: "u3", role: "super_admin" },
    ],
    { op: "delete", id: "r3" },
  ) === false,
);

const gateSrc = readFileSync(resolve(root, "src/components/tenant/TenantAuthenticatedGate.tsx"), "utf8");
ok("tenant_gate_no_super_owner_bypass", !gateSrc.includes("is_super_owner") && !gateSrc.includes("platform_roles"));
ok("tenant_gate_membership_only", gateSrc.includes("checkTenantMembershipFn") && gateSrc.includes("member: result.member"));

const platformRoute = readFileSync(resolve(root, "src/routes/platform/route.tsx"), "utf8");
ok("platform_route_file", existsSync(resolve(root, "src/routes/platform/route.tsx")));
ok("platform_home_file", existsSync(resolve(root, "src/routes/platform/index.tsx")));
ok("platform_tenants_file", existsSync(resolve(root, "src/routes/platform/tenants.tsx")));
ok("platform_not_tenant_gate", !platformRoute.includes("TenantAuthenticatedGate"));
const shellSrc = readFileSync(resolve(root, "src/components/platform/PlatformShell.tsx"), "utf8");
ok("platform_shell_uses_platform_authority", shellSrc.includes("getMyPlatformAuthority"));
ok("platform_shell_no_tenant_gate", !shellSrc.includes("TenantAuthenticatedGate") && !shellSrc.includes("checkTenantMembership"));
ok("platform_shell_no_admin_emails", !shellSrc.includes("ADMIN_EMAILS") && !shellSrc.includes("BUILTIN_OWNER"));
ok("platform_resolver_no_email", !readFileSync(resolve(root, "src/lib/platform-authority.ts"), "utf8").includes("ADMIN_EMAILS"));
ok(
  "platform_server_uses_rpc",
  readFileSync(resolve(root, "src/lib/platform-authority.server.ts"), "utf8").includes("is_super_owner") &&
    readFileSync(resolve(root, "src/lib/platform-authority.server.ts"), "utf8").includes("is_super_admin"),
);

ok("reserved_platform_slug", isReservedTenantSlug("platform"));
ok(
  "platform_path_not_remapped_into_tenant",
  remapAppNavigate({ to: "/platform", tenantSlug: "mortgageeasy" }).to === "/platform",
);
ok(
  "route_tree_has_platform",
  existsSync(resolve(root, "src/routeTree.gen.ts")) &&
    readFileSync(resolve(root, "src/routeTree.gen.ts"), "utf8").includes("/platform"),
);

const authSrc = readFileSync(resolve(root, "src/lib/platform-authority.server.ts"), "utf8");
ok("resolver_no_user_roles_table", !authSrc.includes('.from("user_roles")'));
ok("resolver_no_membership_table", !authSrc.includes("tenant_memberships"));
ok("resolver_no_admin_profiles", !authSrc.includes("admin_profiles"));

const auditSrc = readFileSync(resolve(root, "src/lib/platform-audit.server.ts"), "utf8");
ok("audit_reuses_security_audit_events", auditSrc.includes("security_audit_events"));
ok(
  "audit_has_so_granted",
  readFileSync(resolve(root, "src/lib/platform-audit.ts"), "utf8").includes("SUPER_OWNER_ROLE_GRANTED"),
);
ok(
  "audit_has_tenant_created",
  readFileSync(resolve(root, "src/lib/platform-audit.ts"), "utf8").includes("TENANT_CREATED"),
);
ok(
  "audit_sanitises_secrets",
  sanitisePlatformAuditMetadata({ token: "x", companyCode: "001" }).companyCode === "001" &&
    sanitisePlatformAuditMetadata({ token: "x", companyCode: "001" }).token === undefined,
);
ok(
  "provision_wires_tenant_created",
  readFileSync(resolve(root, "src/lib/company-provisioning.server.ts"), "utf8").includes("TENANT_CREATED"),
);
ok(
  "provision_still_requires_so",
  readFileSync(resolve(root, "src/lib/company-provisioning.server.ts"), "utf8").includes(
    "requirePlatformProvisioningAuthority",
  ),
);

const mfaSrc = readFileSync(resolve(root, "src/lib/auth-mfa-config.ts"), "utf8");
ok("mfa_config_untouched_in_g7a_script_scope", mfaSrc.includes("TEMP_SUSPEND_LOGIN_MFA"));

const companiesTenant = readFileSync(resolve(root, "src/routes/$tenantSlug/companies.tsx"), "utf8");
ok("tenant_companies_still_membership_wrapped", companiesTenant.includes("TenantAuthenticatedApp"));

if (failures.length) {
  console.error(`\n${failures.length} failure(s)`);
  process.exit(1);
}
console.log("\nG7A platform authority verify PASS");
