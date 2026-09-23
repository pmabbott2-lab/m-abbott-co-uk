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

if (failures.length) {
  console.error(`\nG7E-2B verify FAIL (${failures.length})`);
  process.exit(1);
}
console.log("\nG7E-2B super admin grants verify PASS");
