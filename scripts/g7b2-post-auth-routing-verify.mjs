/**
 * G7B-2 post-auth destination — static / synthetic checks.
 * No secrets. No network. No staging/production queries.
 * Run: npx tsx scripts/g7b2-post-auth-routing-verify.mjs
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  resolveAuthenticatedHomeRedirect,
  resolvePostAuthDestination,
} from "../src/lib/post-auth-destination.ts";
import { resolveTenantAuthenticatedEntry } from "../src/lib/tenant-access.ts";
import { resolvePlatformAuthorityFromRoles } from "../src/lib/platform-authority.ts";
import { buildAuthPath, buildHomePathAfterAuth } from "../src/lib/post-auth-journey.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];
function ok(name, cond, detail = "") {
  if (cond) console.log(`PASS  ${name}${detail ? ` — ${detail}` : ""}`);
  else {
    console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
    failures.push(name);
  }
}

const destSrc = readFileSync(resolve(root, "src/lib/post-auth-destination.ts"), "utf8");
const destServer = readFileSync(resolve(root, "src/lib/post-auth-destination.server.ts"), "utf8");
ok(
  "dest_no_user_roles",
  !destSrc.includes('.from("user_roles")') && !destServer.includes('.from("user_roles")'),
);
ok(
  "dest_no_admin_emails",
  !destSrc.includes("ADMIN_EMAILS") && !destServer.includes("ADMIN_EMAILS"),
);
ok(
  "dest_no_admin_profiles",
  !destSrc.includes('.from("admin_profiles")') && !destServer.includes('.from("admin_profiles")'),
);
ok("dest_no_email_lookup", !destSrc.toLowerCase().includes("pmabbott2") && !destServer.toLowerCase().includes("pmabbott2"));
ok("dest_uses_platform_authority", destServer.includes("resolvePlatformAuthority"));
ok("dest_sole_membership_not_001", destServer.includes("ids.length !== 1") && !destServer.includes("mortgageeasy"));

const so = resolvePlatformAuthorityFromRoles({
  userId: "f8c24260-fe31-4277-9589-d4000e18a782",
  roles: ["super_owner"],
});
ok("so_platform_from_roles_only", so.canAccessPlatform && so.isSuperOwner);

const soLogin = resolvePostAuthDestination({
  canAccessPlatform: so.canAccessPlatform,
  requestedTenantSlug: null,
  soleMembershipSlug: null,
  platformIntent: true,
});
ok("so_login_platform", soLogin.to === "/platform" && soLogin.kind === "platform");

const soWithCustomerNoise = resolvePostAuthDestination({
  canAccessPlatform: true,
  requestedTenantSlug: null,
  soleMembershipSlug: null,
  start: "voice",
});
ok(
  "so_customer_role_does_not_win",
  soWithCustomerNoise.to === "/platform" && soWithCustomerNoise.to !== "/home",
);

const soHome = resolveAuthenticatedHomeRedirect({
  canAccessPlatform: true,
  tenantSlug: null,
});
ok("so_home_redirects_platform", soHome === "/platform");

const saLogin = resolvePostAuthDestination({
  canAccessPlatform: resolvePlatformAuthorityFromRoles({
    userId: "sa-user",
    roles: ["super_admin"],
  }).canAccessPlatform,
});
ok("sa_login_platform", saLogin.to === "/platform" && saLogin.kind === "platform");

const owner001 = resolvePostAuthDestination({
  canAccessPlatform: false,
  requestedTenantSlug: "mortgageeasy",
});
ok("owner_001_tenant_dest", owner001.to === "/mortgageeasy/workspace" && owner001.kind === "tenant");

const adviser001 = resolvePostAuthDestination({
  canAccessPlatform: false,
  soleMembershipSlug: "mortgageeasy",
});
ok("adviser_001_sole_dest", adviser001.to === "/mortgageeasy/workspace");

const introducer001 = resolvePostAuthDestination({
  canAccessPlatform: false,
  requestedTenantSlug: "mortgageeasy",
  platformIntent: true,
});
ok(
  "introducer_001_intent_not_platform",
  introducer001.to === "/mortgageeasy/workspace" && introducer001.kind === "tenant",
);

const user002 = resolvePostAuthDestination({
  canAccessPlatform: false,
  requestedTenantSlug: "trentvalleyfs",
});
ok("user_002_tenant_dest", user002.to === "/trentvalleyfs/workspace");

const globalAdmin = resolvePostAuthDestination({
  canAccessPlatform: false,
  platformIntent: true,
});
ok(
  "global_admin_platform_denied",
  globalAdmin.kind === "platform_denied" && globalAdmin.to === "/platform",
);
ok(
  "global_admin_not_elevated",
  resolvePlatformAuthorityFromRoles({ userId: "admin-user", roles: ["admin"] }).canAccessPlatform ===
    false,
);

const customer = resolvePostAuthDestination({
  canAccessPlatform: false,
  start: "chat",
});
ok("customer_legacy_home", customer.to === "/home?start=chat" && customer.kind === "legacy_home");

const customerIntent = resolvePostAuthDestination({
  canAccessPlatform: false,
  platformIntent: true,
});
ok(
  "customer_platform_intent_denied",
  customerIntent.kind === "platform_denied" && customerIntent.to === "/platform",
);

ok(
  "intent_never_sets_authority",
  resolvePostAuthDestination({ canAccessPlatform: false, platformIntent: true }).kind !== "platform",
);

ok(
  "cross_001_on_002_denied",
  resolveTenantAuthenticatedEntry({ userId: "u-001", member: false }) === "denied",
);
ok(
  "cross_002_on_001_denied",
  resolveTenantAuthenticatedEntry({ userId: "u-002", member: false }) === "denied",
);

ok(
  "no_001_fallback",
  resolvePostAuthDestination({ canAccessPlatform: false }).to === "/home" &&
    !resolvePostAuthDestination({ canAccessPlatform: false }).to.includes("mortgageeasy"),
);

ok("build_home_path_unchanged_tenant", buildHomePathAfterAuth(null, "mortgageeasy") === "/mortgageeasy/workspace");
ok("build_home_path_unchanged_legacy", buildHomePathAfterAuth(null, null) === "/home");
ok("platform_signin_path", buildAuthPath({ platformIntent: true }) === "/auth?intent=platform");

const authSrc = readFileSync(resolve(root, "src/routes/auth.tsx"), "utf8");
ok("auth_uses_resolver", authSrc.includes("resolveMyPostAuthDestination"));
ok("auth_intent_is_not_grant", authSrc.includes("platformIntent") && authSrc.includes("isPlatformLoginIntent"));

const indexSrc = readFileSync(resolve(root, "src/routes/index.tsx"), "utf8");
ok("root_platform_signin_intent", indexSrc.includes("/auth?intent=platform"));

const homeSrc = readFileSync(resolve(root, "src/routes/_authenticated/home.tsx"), "utf8");
ok("home_redirects_platform_only", homeSrc.includes("resolveAuthenticatedHomeRedirect"));
ok("home_does_not_delete_customer_role", !homeSrc.includes("user_roles"));

const resetSrc = readFileSync(resolve(root, "src/routes/auth/reset.tsx"), "utf8");
ok("reset_uses_resolver", resetSrc.includes("resolveMyPostAuthDestination"));

if (failures.length) {
  console.error(`\n${failures.length} failure(s)`);
  process.exit(1);
}
console.log("\nG7B-2 post-auth routing verify PASS");
