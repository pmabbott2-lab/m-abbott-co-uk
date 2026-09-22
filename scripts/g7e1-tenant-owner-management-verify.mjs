/**
 * G7E-1 Tenant Owner management — static / synthetic checks.
 * No secrets. No network. No production queries.
 * Run: npm exec --yes --package=tsx -- tsx scripts/g7e1-tenant-owner-management-verify.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { resolvePlatformAuthorityFromRoles } from "../src/lib/platform-authority.ts";
import {
  LAST_OWNER_USER_MESSAGE,
  isLastOwnerProtectedError,
} from "../src/lib/platform-tenant-owners.ts";
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

const MIGRATION = "supabase/migrations/20260922180000_gate_g7e1_last_tenant_owner_protection.sql";
ok("migration_exists", exists(MIGRATION));
const mig = read(MIGRATION);
ok("migration_last_owner_fn", mig.includes("prevent_last_tenant_owner_loss"));
ok("migration_last_owner_trigger", mig.includes("tenant_memberships_prevent_last_owner"));
ok("migration_protects_active_only", mig.includes("tenant_status") && mig.includes("'active'"));
ok("migration_tenant_row_lock", mig.includes("FOR UPDATE"));
ok("migration_no_membership_insert", !/INSERT\s+INTO\s+public\.tenant_memberships/i.test(mig));
ok("migration_no_platform_roles", !/INSERT\s+INTO\s+public\.platform_roles/i.test(mig));

ok(
  "last_owner_message",
  LAST_OWNER_USER_MESSAGE.includes("at least one active Owner"),
);
ok(
  "last_owner_error_detect",
  isLastOwnerProtectedError("last_tenant_owner_protected") &&
    isLastOwnerProtectedError("at least one active Owner"),
);

const so = resolvePlatformAuthorityFromRoles({ userId: "so", roles: ["super_owner"] });
const sa = resolvePlatformAuthorityFromRoles({ userId: "sa", roles: ["super_admin"] });
ok("so_is_super_owner", so.isSuperOwner);
ok("sa_not_super_owner", !sa.isSuperOwner && sa.isSuperAdmin);

const server = read("src/lib/platform-tenant-owners.server.ts");
ok("server_requires_super_owner", server.includes("requireSuperOwner"));
ok("server_no_sa_grant_path", !server.includes("super_admin_tenant_access"));
ok("server_uses_memberships_owner", server.includes('role", "owner"') || server.includes("role: \"owner\""));
ok("server_no_user_roles_authority", !server.includes('.from("user_roles")'));
ok("server_no_admin_profiles_authority", !server.includes('.from("admin_profiles")'));
ok("server_invite_reuses_staff", server.includes("staff_invitations") && server.includes('membership_role: "owner"'));
ok("server_invite_7d", server.includes("7 * 24 * 3600"));
ok("server_no_password", !server.toLowerCase().includes("password"));
ok("server_no_token_return", !server.includes("inviteToken") && !server.includes("token:"));
ok("server_soft_deactivate", server.includes("active: false"));
ok("server_audit_invited", server.includes("TENANT_OWNER_INVITED"));
ok("server_audit_added", server.includes("TENANT_OWNER_ADDED"));
ok("server_audit_removed", server.includes("TENANT_OWNER_REMOVED"));
ok("server_audit_denied", server.includes("LAST_TENANT_OWNER_ACTION_DENIED"));
ok("server_create_company_untouched", exists("src/lib/company-provisioning.server.ts") &&
  read("src/lib/company-provisioning.server.ts").includes("initialOwner") &&
  read("src/lib/company-provisioning.server.ts").includes('membership_role: "owner"'));

const fns = read("src/lib/platform-tenant-owners.functions.ts");
ok("fns_auth_middleware", fns.includes("requireSupabaseAuth"));
ok("fns_company_code_param", fns.includes("companyCode"));

const views = read("src/components/platform/PlatformCompanyViews.tsx");
ok("ui_company_owners", views.includes("Company Owners"));
ok("ui_add_owner", views.includes("Add owner") || views.includes("Add first owner"));
ok("ui_pending", views.includes("Pending invitations"));
ok("ui_so_only", views.includes("isSuperOwner"));
ok("ui_no_token", !views.includes("token"));
ok("ui_no_password", !views.toLowerCase().includes("password"));

const audit = read("src/lib/platform-audit.ts");
ok("audit_types", audit.includes("TENANT_OWNER_INVITED") && audit.includes("LAST_TENANT_OWNER_ACTION_DENIED"));
ok(
  "audit_labels",
  read("src/lib/platform-dashboard.ts").includes("Company owner invited"),
);

ok(
  "admins_page_g7e2a",
  read("src/routes/platform/admins.tsx").includes("Platform Administrators") &&
    !read("src/routes/platform/admins.tsx").includes("super_admin_tenant_access"),
);
ok("g7d_untouched_cookie", read("src/lib/platform-tenant-entry.ts").includes("mh_platform_tenant_access"));
ok(
  "last_so_still_protected",
  wouldRemoveLastSuperOwner([{ id: "r1", userId: "u1", role: "super_owner" }], {
    op: "delete",
    id: "r1",
  }) === true,
);

if (failures.length) {
  console.error(`\n${failures.length} failure(s)`);
  process.exit(1);
}
console.log("\nG7E-1 tenant owner management verify PASS");
