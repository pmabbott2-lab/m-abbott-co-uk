/**
 * G7E-2A platform administrator identities — static / synthetic checks.
 * No secrets. No network. No production queries.
 * Run: npm exec --yes --package=tsx -- tsx scripts/g7e2a-platform-admins-verify.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { resolvePlatformAuthorityFromRoles } from "../src/lib/platform-authority.ts";
import {
  LAST_SUPER_OWNER_USER_MESSAGE,
  isLastSuperOwnerProtectedError,
  isPlatformInviteError,
} from "../src/lib/platform-admins.ts";
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

const MIGRATION = "supabase/migrations/20260922190000_gate_g7e2a_platform_admins.sql";
ok("migration_exists", exists(MIGRATION));
const mig = read(MIGRATION);
ok("migration_platform_invitations", mig.includes("CREATE TABLE IF NOT EXISTS public.platform_invitations"));
ok("migration_token_hash", mig.includes("token_hash text NOT NULL"));
ok("migration_no_plaintext_token_col", !mig.includes("token UUID") && !mig.includes("token uuid"));
ok("migration_claim_fn", mig.includes("claim_platform_invitation"));
ok("migration_claim_advisory", mig.includes("872014003"));
ok("migration_last_so_advisory", mig.includes("pg_advisory_xact_lock(872014002)"));
ok("migration_last_so_message", mig.includes("Mortgage Hub must have at least one Super Owner"));
ok("migration_rls_no_client_write", mig.includes("REVOKE ALL ON public.platform_invitations FROM PUBLIC, anon, authenticated"));
ok(
  "migration_platform_roles_revoke_writes",
  exists("supabase/migrations/20260922190500_gate_g7e2a_platform_roles_client_write_revoke.sql") &&
    read("supabase/migrations/20260922190500_gate_g7e2a_platform_roles_client_write_revoke.sql").includes(
      "REVOKE INSERT, UPDATE, DELETE, TRUNCATE",
    ),
);
ok("migration_no_grant_table_change", !mig.includes("ALTER TABLE public.super_admin_tenant_access"));
ok("migration_no_staff_invitations", !mig.includes("staff_invitations"));

ok("last_so_message", LAST_SUPER_OWNER_USER_MESSAGE.includes("at least one Super Owner"));
ok(
  "last_so_error_detect",
  isLastSuperOwnerProtectedError("last_super_owner_protected") &&
    isLastSuperOwnerProtectedError("at least one Super Owner"),
);
ok("invite_error_expired", isPlatformInviteError("platform_invite_expired")?.includes("expired"));
ok("invite_error_revoked", isPlatformInviteError("platform_invite_revoked")?.includes("cancelled"));
ok("invite_error_replay", isPlatformInviteError("platform_invite_used")?.includes("already"));

const so = resolvePlatformAuthorityFromRoles({ userId: "so", roles: ["super_owner"] });
const sa = resolvePlatformAuthorityFromRoles({ userId: "sa", roles: ["super_admin"] });
const owner = resolvePlatformAuthorityFromRoles({ userId: "o", roles: [] });
ok("so_can_access_platform", so.canAccessPlatform && so.isSuperOwner);
ok("sa_can_access_platform", sa.canAccessPlatform && !sa.isSuperOwner);
ok("sa_cannot_create_company", !sa.canCreateCompany);
ok("sa_cannot_list_all_tenants", !sa.canListPlatformTenants);
ok("tenant_owner_no_platform", !owner.canAccessPlatform);

const server = read("src/lib/platform-admins.server.ts");
ok("server_requires_super_owner", server.includes("requireSuperOwner"));
ok("server_no_sa_grant_path", !server.includes("super_admin_tenant_access"));
ok("server_no_staff_invitations", !server.includes("staff_invitations"));
ok("server_uses_platform_invitations", server.includes("platform_invitations"));
ok("server_hashes_token", server.includes("sha256") && server.includes("token_hash"));
ok("server_no_role_before_invite", server.includes("no platform_roles yet") || server.includes("hashed platform_invitations only"));
ok("server_claim_rpc", server.includes("claim_platform_invitation"));
ok("server_7d_expiry", server.includes("7 * 24 * 3600"));
ok("server_audit_invited", server.includes("PLATFORM_ADMIN_INVITED"));
ok("server_audit_cancelled", server.includes("PLATFORM_ADMIN_INVITE_CANCELLED"));
ok("server_audit_granted", server.includes("PLATFORM_ROLE_GRANTED"));
ok("server_audit_changed", server.includes("PLATFORM_ROLE_CHANGED"));
ok("server_audit_revoked", server.includes("PLATFORM_ROLE_REVOKED"));
ok("server_audit_last_denied", server.includes("LAST_PLATFORM_OWNER_ACTION_DENIED"));
ok("server_no_password_gen", !server.toLowerCase().includes("temporary password") && !server.includes("generatePassword"));
ok("server_no_membership_insert", !server.includes('.from("tenant_memberships").insert'));

const fns = read("src/lib/platform-admins.functions.ts");
ok("fns_auth_on_mgmt", fns.includes("requireSupabaseAuth") && fns.includes("addPlatformAdministrator"));
ok("fns_accept_auth", fns.includes("acceptPlatformInvite") && fns.includes("requireSupabaseAuth"));
ok("fns_resolve_public", fns.includes("resolvePlatformInvite"));

const adminsUi = read("src/routes/platform/admins.tsx");
ok("ui_title", adminsUi.includes("Platform Administrators"));
ok("ui_add", adminsUi.includes("Add platform administrator"));
ok("ui_so_section", adminsUi.includes("SUPER OWNERS"));
ok("ui_sa_section", adminsUi.includes("SUPER ADMINS"));
ok("ui_sa_no_grants_copy", adminsUi.includes("No grants configured"));
ok("ui_no_grant_controls", !adminsUi.includes("data_read") && !adminsUi.includes("Grant:"));
ok("ui_so_only_gate", adminsUi.includes("isSuperOwner"));
ok("ui_no_token", !adminsUi.includes("rawToken") && !adminsUi.includes("token_hash"));
ok("ui_no_password", !adminsUi.toLowerCase().includes("password"));

ok("invite_route", exists("src/routes/platform-invite.tsx"));
const invitePage = read("src/routes/platform-invite.tsx");
ok("invite_accept_flow", invitePage.includes("acceptPlatformInvite"));
ok("invite_identity_copy", invitePage.includes("different") || invitePage.includes("invited email"));

const audit = read("src/lib/platform-audit.ts");
ok(
  "audit_types",
  audit.includes("PLATFORM_ADMIN_INVITED") &&
    audit.includes("PLATFORM_ROLE_GRANTED") &&
    audit.includes("LAST_PLATFORM_OWNER_ACTION_DENIED"),
);
ok(
  "audit_labels",
  read("src/lib/platform-dashboard.ts").includes("Platform administrator invited") &&
    read("src/lib/platform-dashboard.ts").includes("Final Super Owner action denied"),
);

ok(
  "last_so_predicate",
  wouldRemoveLastSuperOwner([{ id: "r1", userId: "u1", role: "super_owner" }], {
    op: "delete",
    id: "r1",
  }) === true,
);

ok("g7e2b_not_started_no_expires_at_grant", !mig.includes("ALTER TABLE public.super_admin_tenant_access"));
ok("g7d_untouched", read("src/lib/platform-tenant-entry.ts").includes("mh_platform_tenant_access"));

if (failures.length) {
  console.error(`\nG7E-2A verify FAIL (${failures.length})`);
  process.exit(1);
}
console.log("\nG7E-2A platform admins verify PASS");
