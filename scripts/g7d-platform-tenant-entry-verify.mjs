/**
 * G7D platform tenant entry — static / synthetic checks.
 * No secrets. No network. No production queries.
 * Run: npx tsx scripts/g7d-platform-tenant-entry-verify.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { resolvePlatformAuthorityFromRoles } from "../src/lib/platform-authority.ts";
import {
  computePlatformAccessExpiresAt,
  emergencyScopeToEntryLevel,
  isSessionTemporallyActive,
  platformAccessAllowsWrite,
  resolveTenantAuthenticatedEntryWithPlatform,
  superAdminGrantToEntryLevel,
  supportScopeToEntryLevel,
  PLATFORM_TENANT_ACCESS_COOKIE,
  PLATFORM_TENANT_ACCESS_MAX_HOURS,
} from "../src/lib/platform-tenant-entry.ts";
import {
  deniedTenantRoleView,
  isPlatformAccessContext,
  isTenantStaffMember,
  platformAccessMayMutate,
  platformAccessTenantRoleView,
  resolveTenantRoleView,
} from "../src/lib/tenant-role.ts";
import { resolveTenantAuthenticatedEntry } from "../src/lib/tenant-access.ts";
import { wouldRemoveLastSuperOwner } from "../src/lib/platform-authority.ts";

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

const MIGRATION = "supabase/migrations/20260922160000_gate_g7d_platform_tenant_access_sessions.sql";
ok("migration_exists", exists(MIGRATION));
const mig = read(MIGRATION);
ok("migration_creates_sessions_table", mig.includes("platform_tenant_access_sessions"));
ok("migration_basis_enum", mig.includes("super_owner_group_access") && mig.includes("emergency_grant"));
ok("migration_level_enum", mig.includes("read_only") && mig.includes("operational_admin"));
ok("migration_no_platform_roles_insert", !/INSERT\s+INTO\s+public\.platform_roles/i.test(mig));
ok("migration_no_membership_insert", !/INSERT\s+INTO\s+public\.tenant_memberships/i.test(mig));
ok("migration_session_helpers", mig.includes("auth_has_active_platform_tenant_access"));
ok("migration_write_helper", mig.includes("auth_has_platform_tenant_write_access"));
ok("migration_basis_revalidate", mig.includes("platform_tenant_access_basis_valid_now"));
ok(
  "migration_revokes_client_writes",
  mig.includes("REVOKE ALL ON TABLE public.platform_tenant_access_sessions FROM authenticated"),
);
ok("migration_extends_appointments", mig.includes("Staff view tenant appointments"));
ok("migration_keeps_g7a_helpers", !mig.includes("CREATE OR REPLACE FUNCTION public.can_access_tenant_data"));
ok("migration_keeps_can_admin", !mig.includes("CREATE OR REPLACE FUNCTION public.can_administer_tenant"));

ok("cookie_name", PLATFORM_TENANT_ACCESS_COOKIE === "mh_platform_tenant_access");
ok("max_duration_4h", PLATFORM_TENANT_ACCESS_MAX_HOURS === 4);
ok(
  "expires_honours_grant",
  computePlatformAccessExpiresAt(new Date("2026-01-01T00:00:00Z"), "2026-01-01T01:00:00Z").toISOString() ===
    "2026-01-01T01:00:00.000Z",
);
ok(
  "expires_caps_at_4h",
  computePlatformAccessExpiresAt(new Date("2026-01-01T00:00:00Z"), "2026-01-02T00:00:00Z").toISOString() ===
    "2026-01-01T04:00:00.000Z",
);

ok(
  "session_active_ok",
  isSessionTemporallyActive({
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  }),
);
ok(
  "session_ended_denied",
  !isSessionTemporallyActive({
    endedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  }),
);
ok(
  "session_revoked_denied",
  !isSessionTemporallyActive({
    revokedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  }),
);
ok(
  "session_expired_denied",
  !isSessionTemporallyActive({
    expiresAt: new Date(Date.now() - 60_000).toISOString(),
  }),
);

ok("sa_platform_admin_no_entry", superAdminGrantToEntryLevel("platform_admin") === null);
ok("sa_data_read_readonly", superAdminGrantToEntryLevel("data_read") === "read_only");
ok("sa_data_write_ops", superAdminGrantToEntryLevel("data_write") === "operational_admin");
ok("sa_full_ops", superAdminGrantToEntryLevel("full") === "operational_admin");
ok("support_metadata_denied", supportScopeToEntryLevel("read_metadata") === null);
ok("support_read_cases_ro", supportScopeToEntryLevel("read_cases") === "read_only");
ok("support_full_write_ops", supportScopeToEntryLevel("full_write") === "operational_admin");
ok("emergency_full_read", emergencyScopeToEntryLevel("full_read") === "emergency");
ok("emergency_metadata_denied", emergencyScopeToEntryLevel("read_metadata") === null);
ok("write_allowed_ops", platformAccessAllowsWrite("operational_admin"));
ok("write_denied_ro", !platformAccessAllowsWrite("read_only"));

const so = resolvePlatformAuthorityFromRoles({ userId: "so", roles: ["super_owner"] });
const sa = resolvePlatformAuthorityFromRoles({ userId: "sa", roles: ["super_admin"] });
ok("so_platform_yes", so.canAccessPlatform && so.canCreateCompany);
ok("sa_no_create_company", !sa.canCreateCompany);

ok(
  "gate_membership_ok",
  resolveTenantAuthenticatedEntry({ userId: "u", member: true }) === "ok",
);
ok(
  "gate_platform_ok",
  resolveTenantAuthenticatedEntry({ userId: "u", member: false, platformAccess: true }) === "ok",
);
ok(
  "gate_neither_denied",
  resolveTenantAuthenticatedEntry({ userId: "u", member: false, platformAccess: false }) === "denied",
);
ok(
  "gate_helper_platform",
  resolveTenantAuthenticatedEntryWithPlatform({
    userId: "u",
    member: false,
    platformAccess: true,
  }) === "ok",
);

const ownerView = resolveTenantRoleView({
  membershipRoles: ["owner"],
  tenantId: "t1",
  tenantSlug: "mortgageeasy",
});
ok("owner_membership_regression", ownerView.shell === "owner" && ownerView.member && !isPlatformAccessContext(ownerView));
const adviserView = resolveTenantRoleView({
  membershipRoles: ["adviser"],
  tenantId: "t1",
});
ok("adviser_membership_regression", adviserView.shell === "adviser" && isTenantStaffMember(adviserView));
const introView = resolveTenantRoleView({ membershipRoles: ["introducer"], tenantId: "t1" });
ok("introducer_membership_regression", introView.shell === "introducer");
const custView = resolveTenantRoleView({ membershipRoles: ["customer"], tenantId: "t1" });
ok("customer_membership_regression", custView.shell === "customer");

const platView = platformAccessTenantRoleView({
  tenantSlug: "mortgageeasy",
  tenantId: "t001",
  accessLevel: "operational_admin",
  basisLabel: "Super Owner access",
});
ok("platform_shell_created", platView.shell === "platform_access" && isPlatformAccessContext(platView));
ok("platform_not_owner", !platView.isOwner && !platView.isAdvisor && !platView.member);
ok("platform_main_admin_dashboard", platView.isMainAdmin);
ok("platform_not_staff_member_helper", !isTenantStaffMember(platView));

const roView = platformAccessTenantRoleView({
  tenantSlug: "tv",
  tenantId: "t002",
  accessLevel: "read_only",
  basisLabel: "Platform administrator access",
});
ok("read_only_shell", roView.shell === "platform_access" && roView.platformAccessLevel === "read_only");
ok("read_only_write_denied", !platformAccessMayMutate(roView));
ok("ops_write_allowed", platformAccessMayMutate(platView));
ok("membership_write_unaffected", platformAccessMayMutate(ownerView));

ok("denied_default", deniedTenantRoleView().shell === "denied");

const entryServer = read("src/lib/platform-tenant-entry.server.ts");
const entryFns = read("src/lib/platform-tenant-entry.functions.ts");
ok("entry_requires_auth", entryFns.includes("requireSupabaseAuth"));
ok("entry_so_group_only_auto", entryServer.includes('tenant_type === "GROUP"'));
ok("entry_external_needs_grant", entryServer.includes("tenant_support_access_grants"));
ok("entry_emergency_table", entryServer.includes("tenant_emergency_access_grants"));
ok("entry_ends_prior_sessions", entryServer.includes("endOpenSessionsForUser"));
ok("entry_sets_httponly_cookie", entryServer.includes("httpOnly: true"));
ok("entry_cookie_samesite_lax", entryServer.includes('sameSite: "lax"'));
ok("entry_audit_started", entryServer.includes("PLATFORM_TENANT_ENTRY_STARTED"));
ok("entry_audit_ended", entryServer.includes("PLATFORM_TENANT_ENTRY_ENDED"));
ok("entry_audit_denied", entryServer.includes("PLATFORM_TENANT_ENTRY_DENIED"));
ok("entry_no_membership_insert", !entryServer.includes('.from("tenant_memberships").insert'));
ok("entry_no_platform_roles_insert", !entryServer.includes('.from("platform_roles").insert'));
ok("entry_no_user_roles_write", !entryServer.includes('.from("user_roles")'));
ok("entry_client_bridge", entryFns.includes("startPlatformTenantEntryImpl"));
ok("idle_timeout_not_implemented", !entryServer.toLowerCase().includes("idle timeout"));

const gate = read("src/components/tenant/TenantAuthenticatedGate.tsx");
ok("gate_platform_aware", gate.includes("getMyPlatformTenantAccess") && gate.includes("platformAccess"));
ok("gate_banner", gate.includes("PlatformAccessBanner"));
ok("gate_still_checks_membership", gate.includes("checkTenantMembershipFn"));

const banner = read("src/components/platform/PlatformAccessBanner.tsx");
ok("banner_exit", banner.includes("Exit company") && banner.includes("endPlatformTenantEntry"));
ok("banner_platform_access_label", banner.includes("PLATFORM ACCESS"));

const views = read("src/components/platform/PlatformCompanyViews.tsx");
ok("enter_confirmation_modal", views.includes("Enter") && views.includes("confirmed: true"));
ok("external_disabled_enter", views.includes("EXTERNAL_ENTRY_REQUIRES_GRANT_COPY"));
ok("no_hardcoded_me", !views.includes("Mortgage Easy") || views.includes("company.companyName"));

const audit = read("src/lib/platform-audit.ts");
ok("audit_types_entry", audit.includes("PLATFORM_TENANT_ENTRY_STARTED"));
ok("audit_ui_labels", read("src/lib/platform-dashboard.ts").includes("Tenant entry started"));

ok(
  "view_as_untouched",
  exists("src/lib/view-as-audit.functions.ts") &&
    read("src/lib/view-as-audit.functions.ts").includes("view_as_audit_log") &&
    !read("src/lib/view-as-audit.functions.ts").includes("platform_tenant_access"),
);

ok(
  "create_company_still_so",
  read("src/lib/company-provisioning.server.ts").includes("requirePlatformProvisioningAuthority"),
);

ok(
  "last_so_protection",
  wouldRemoveLastSuperOwner([{ id: "r1", userId: "u1", role: "super_owner" }], {
    op: "delete",
    id: "r1",
  }) === true,
);

ok(
  "sessions_fn_platform_path",
  read("src/lib/sessions.functions.ts").includes('accessContext === "platform_access"'),
);

if (failures.length) {
  console.error(`\n${failures.length} failure(s)`);
  process.exit(1);
}
console.log("\nG7D platform tenant entry verify PASS");
