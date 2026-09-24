/**
 * G7F-1A Second Super Owner resilience — static / synthetic checks.
 * No secrets. No network. No production queries. No MFA changes.
 * Run: npm exec --yes --package=tsx -- tsx scripts/g7f1a-second-super-owner-verify.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  resolvePlatformAuthorityFromRoles,
  wouldRemoveLastSuperOwner,
} from "../src/lib/platform-authority.ts";
import { isLastSuperOwnerProtectedError } from "../src/lib/platform-admins.ts";

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

const authority = read("src/lib/platform-authority.ts");
ok(
  "authority_platform_roles_only",
  authority.includes("platform_roles.role only") &&
    authority.includes("Never infers from email") &&
    authority.includes("tenant_memberships"),
);
ok("authority_no_email_allowlist", !authority.includes("BUILTIN_OWNER") && !authority.includes("ADMIN_EMAILS"));

const so = resolvePlatformAuthorityFromRoles({ userId: "so-2", roles: ["super_owner"] });
ok("so2_platform_from_roles_only", so.isSuperOwner && so.canAccessPlatform && so.canCreateCompany);
ok(
  "empty_roles_no_platform",
  !resolvePlatformAuthorityFromRoles({ userId: "x", roles: [] }).canAccessPlatform,
);
ok(
  "sa_cannot_self_elevate_via_pure",
  !resolvePlatformAuthorityFromRoles({ userId: "sa", roles: ["super_admin"] }).isSuperOwner,
);
ok(
  "no_membership_required_for_so",
  so.isSuperOwner === true,
);

const two = [
  { id: "r1", userId: "u1", role: "super_owner" },
  { id: "r2", userId: "u2", role: "super_owner" },
];
ok(
  "non_final_so_remove_allowed",
  wouldRemoveLastSuperOwner(two, { op: "delete", id: "r2" }) === false,
);
ok(
  "final_so_remove_blocked",
  wouldRemoveLastSuperOwner([{ id: "r1", userId: "u1", role: "super_owner" }], {
    op: "delete",
    id: "r1",
  }) === true,
);
ok(
  "non_final_demote_allowed",
  wouldRemoveLastSuperOwner(two, { op: "update_role", id: "r2", nextRole: "super_admin" }) ===
    false,
);
ok(
  "final_demote_blocked",
  wouldRemoveLastSuperOwner([{ id: "r1", userId: "u1", role: "super_owner" }], {
    op: "update_role",
    id: "r1",
    nextRole: "super_admin",
  }) === true,
);
ok("last_so_error_helper", isLastSuperOwnerProtectedError("last_super_owner_protected"));

const server = read("src/lib/platform-admins.server.ts");
ok("server_confirm_so", server.includes("confirmSuperOwner"));
ok("server_requires_so", server.includes("requireSuperOwner"));
ok("server_no_membership_insert", !server.includes('.from("tenant_memberships").insert'));
ok("server_no_mfa_policy_write", !server.includes("platform_mfa_policy"));
ok(
  "server_no_dual_control_env",
  !server.includes("SECOND_SO_APPROVAL_REQUIRED") &&
    !server.includes("secondSuperOwnerApprovalRequired") &&
    !server.includes("SECOND_SO_APPROVAL"),
);
ok(
  "server_no_dormant_dual_control_logic",
  !server.includes("dualControlEnabled") && !server.includes("policyEnabled"),
);

const admins = read("src/lib/platform-admins.ts");
ok(
  "admins_no_dormant_dual_control_helper",
  !admins.includes("secondSuperOwnerApprovalRequired") &&
    !admins.includes("SECOND_SO_APPROVAL_USER_MESSAGE") &&
    !admins.includes("SECOND_SO_APPROVAL_REQUIRED"),
);

const mfaCfg = read("src/lib/auth-mfa-config.ts");
ok("mfa_still_suspended", mfaCfg.includes("TEMP_SUSPEND_LOGIN_MFA = true"));

ok(
  "no_breakglass_impl_superseded_by_g7f1b_b",
  exists("src/lib/break-glass.ts") && exists("src/lib/break-glass.server.ts"),
);

const g6bHelper = read("scripts/g6b-staging-apply/phase2b-auth-helper.sql");
ok(
  "g6b_helper_no_generated_identities_email_insert",
  g6bHelper.includes("INSERT INTO auth.identities") &&
    !g6bHelper.includes("updated_at, email") &&
    !/INSERT INTO auth\.identities\s*\([^)]*\bemail\b/.test(g6bHelper),
);

if (failures.length) {
  console.error(`\nG7F-1A verify FAIL (${failures.length})`);
  process.exit(1);
}
console.log("\nG7F-1A second Super Owner verify PASS");
