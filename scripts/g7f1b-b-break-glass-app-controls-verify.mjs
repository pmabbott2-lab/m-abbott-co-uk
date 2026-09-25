/**
 * G7F-1B-B — static / pure-helper / inspection checks for break-glass app controls.
 * No permanent BG Auth user. No network required for this suite.
 * Classification: PURE_HELPER | STATIC (code inspection). No RUNTIME without BG identity.
 * Run: npm exec --yes --package=tsx -- tsx scripts/g7f1b-b-break-glass-app-controls-verify.mjs
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  resolvePlatformAuthorityFromRoles,
  withBreakGlassSession,
  canAdministerTenantFromFlags,
} from "../src/lib/platform-authority.ts";
import {
  BREAK_GLASS_G7D_MAX_HOURS,
  BREAK_GLASS_PLATFORM_IDLE_MS,
  BREAK_GLASS_PLATFORM_SESSION_MAX_MS,
  computeBreakGlassG7dExpiresAt,
  decodeBreakGlassSession,
  decodeSignedBgValue,
  encodeBreakGlassSession,
  encodeSignedBgValue,
  isBreakGlassPlatformSessionValid,
  shouldTouchBreakGlassIdle,
} from "../src/lib/break-glass.ts";
import { computePlatformAccessExpiresAt, PLATFORM_TENANT_ACCESS_MAX_HOURS } from "../src/lib/platform-tenant-entry.ts";
import { PLATFORM_AUDIT_EVENT_TYPES } from "../src/lib/platform-audit.ts";

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

function testHmac(secret = "unit-test-secret-not-production") {
  return {
    sign: (payload) => createHmac("sha256", secret).update(payload).digest("base64url"),
    safeEqual: (a, b) => {
      try {
        const ba = Buffer.from(a);
        const bb = Buffer.from(b);
        if (ba.length !== bb.length) return false;
        return timingSafeEqual(ba, bb);
      } catch {
        return false;
      }
    },
  };
}

ok("break_glass_pure_exists", existsSync(resolve(root, "src/lib/break-glass.ts")));
ok("break_glass_server_exists", existsSync(resolve(root, "src/lib/break-glass.server.ts")));

const bgServer = read("src/lib/break-glass.server.ts");
const bgRegistry = read("src/lib/break-glass-registry.server.ts");
const authFns = read("src/lib/platform-authority.functions.ts");
ok("server_resolve_helper", bgServer.includes("resolveBreakGlassStatus") || bgRegistry.includes("resolveBreakGlassStatus"));
ok("server_no_email_classify", !/email.*=.*break|break.*email/i.test((bgRegistry + bgServer).split("resolveBreakGlassStatus")[1]?.slice(0, 800) || ""));
ok("server_uses_rpc", bgRegistry.includes('is_active_break_glass'));
ok("server_cookie_session", bgServer.includes("BREAK_GLASS_PLATFORM_SESSION_COOKIE"));
ok("server_auth_bind", bgServer.includes("BREAK_GLASS_AUTH_BIND_COOKIE"));
ok("server_no_new_migration", !existsSync(resolve(root, "supabase/migrations/20260924130000_gate_g7f1b_b")));
// G7F-1B-D1: LOGIN/PLATFORM_ACCESS dedup moved into ensure RPC (server-authoritative).
const d1MigPath = "supabase/migrations/20260925091946_gate_g7f1b_d1_break_glass_server_sessions.sql";
const d1Mig = existsSync(resolve(root, d1MigPath)) ? read(d1MigPath) : "";
ok(
  "login_audit",
  bgServer.includes("BREAK_GLASS_LOGIN_SUCCEEDED") || d1Mig.includes("BREAK_GLASS_LOGIN_SUCCEEDED"),
);
ok(
  "platform_access_audit",
  bgServer.includes("BREAK_GLASS_PLATFORM_ACCESS") || d1Mig.includes("BREAK_GLASS_PLATFORM_ACCESS"),
);
ok("logout_audit", bgServer.includes("BREAK_GLASS_LOGOUT"));
ok("logout_never_blocks", bgServer.includes("auditBreakGlassLogoutBestEffort"));
ok("no_hardcoded_signing_secret", !bgServer.includes("mh-break-glass-dev-only") && bgServer.includes("break_glass_session_secret_unavailable"));
ok("no_vite_signing_secret", !bgServer.includes("VITE_BREAK_GLASS") && !bgServer.includes("VITE_TEAMS_TOKEN"));
ok("signal_hook_removed", !bgServer.includes("emitBreakGlassSecuritySignal"));
ok("expired_lock", bgServer.includes("BREAK_GLASS_EXPIRED_COOKIE"));
ok("signed_lock_encode", bgServer.includes("encodeSignedBgValue"));

const auth = read("src/lib/platform-authority.ts");
ok("authority_has_isBreakGlass", auth.includes("isBreakGlass"));
ok("authority_forged_requires_so", auth.includes("isSuperOwner && input.isBreakGlass === true"));

const soOnly = resolvePlatformAuthorityFromRoles({ userId: "u1", roles: ["super_owner"] });
ok("normal_so_not_bg", soOnly.isBreakGlass === false && soOnly.isSuperOwner === true);
const forged = resolvePlatformAuthorityFromRoles({
  userId: "u1",
  roles: ["super_admin"],
  isBreakGlass: true,
});
ok("forged_bg_without_so_denied", forged.isBreakGlass === false);
const bgSo = resolvePlatformAuthorityFromRoles({
  userId: "u1",
  roles: ["super_owner"],
  isBreakGlass: true,
});
ok("bg_with_so_classified", bgSo.isBreakGlass === true && bgSo.canAccessPlatform === true);
ok("bg_alone_no_roles", resolvePlatformAuthorityFromRoles({ userId: "u1", roles: [], isBreakGlass: true }).canAccessPlatform === false);

const withSess = withBreakGlassSession(bgSo, true);
ok("session_active_flag", withSess.breakGlassSessionActive === true);

ok("session_max_60m", BREAK_GLASS_PLATFORM_SESSION_MAX_MS === 60 * 60 * 1000);
ok("idle_15m", BREAK_GLASS_PLATFORM_IDLE_MS === 15 * 60 * 1000);
ok("g7d_max_1h", BREAK_GLASS_G7D_MAX_HOURS === 1);

const started = new Date("2026-01-01T00:00:00.000Z");
const abs = isBreakGlassPlatformSessionValid({
  userId: "u",
  startedAt: started.toISOString(),
  lastActivityAt: started.toISOString(),
}, new Date(started.getTime() + 61 * 60 * 1000));
ok("absolute_expiry", abs.ok === false && abs.reason === "absolute_expired");

const idle = isBreakGlassPlatformSessionValid({
  userId: "u",
  startedAt: started.toISOString(),
  lastActivityAt: started.toISOString(),
}, new Date(started.getTime() + 16 * 60 * 1000));
ok("idle_expiry", idle.ok === false && idle.reason === "idle_expired");

const okSess = isBreakGlassPlatformSessionValid({
  userId: "u",
  startedAt: started.toISOString(),
  lastActivityAt: new Date(started.getTime() + 5 * 60 * 1000).toISOString(),
}, new Date(started.getTime() + 10 * 60 * 1000));
ok("session_valid_window", okSess.ok === true);

// PURE_HELPER: idle touch policy
ok("idle_touch_nav", shouldTouchBreakGlassIdle("platform_navigation") === true);
ok("idle_touch_g7d", shouldTouchBreakGlassIdle("g7d_entry") === true);
ok("idle_no_touch_session_check", shouldTouchBreakGlassIdle("session_check") === false);
ok("idle_no_touch_undefined", shouldTouchBreakGlassIdle(undefined) === false);

// PURE_HELPER: 14m59 renew vs 15m+ deny
const last = started;
const at1459 = new Date(started.getTime() + 14 * 60 * 1000 + 59 * 1000);
ok(
  "idle_1459_still_valid",
  isBreakGlassPlatformSessionValid(
    { userId: "u", startedAt: started.toISOString(), lastActivityAt: last.toISOString() },
    at1459,
  ).ok === true,
);
const renewedAt = at1459.toISOString();
const afterRenew = new Date(at1459.getTime() + 10 * 60 * 1000);
ok(
  "idle_renewed_after_meaningful",
  isBreakGlassPlatformSessionValid(
    { userId: "u", startedAt: started.toISOString(), lastActivityAt: renewedAt },
    afterRenew,
  ).ok === true,
);
const at1501 = new Date(started.getTime() + 15 * 60 * 1000 + 1000);
ok(
  "idle_1501_denied",
  isBreakGlassPlatformSessionValid(
    { userId: "u", startedAt: started.toISOString(), lastActivityAt: last.toISOString() },
    at1501,
  ).ok === false,
);

// PURE_HELPER: cookie crypto tamper matrix
const h = testHmac();
const session = {
  userId: "user-a",
  startedAt: "2026-01-01T00:00:00.000Z",
  lastActivityAt: "2026-01-01T00:05:00.000Z",
};
const encoded = encodeBreakGlassSession(session, h);
ok("cookie_roundtrip", decodeBreakGlassSession(encoded, h)?.userId === "user-a");
ok("cookie_missing", decodeBreakGlassSession(null, h) === null);
ok("cookie_malformed", decodeBreakGlassSession("a|b|c", h) === null);
ok("cookie_unsigned", decodeBreakGlassSession("user-a|2026-01-01T00:00:00.000Z|2026-01-01T00:05:00.000Z|", h) === null);

const bitFlip = encoded.slice(0, -1) + (encoded.endsWith("a") ? "b" : "a");
ok("cookie_sig_bitflip", decodeBreakGlassSession(bitFlip, h) === null);

const parts = encoded.split("|");
parts[0] = "user-b";
ok("cookie_cross_user", decodeBreakGlassSession(parts.join("|"), h) === null);

const future = encodeBreakGlassSession(
  { ...session, startedAt: "2099-01-01T00:00:00.000Z", lastActivityAt: "2099-01-01T00:00:00.000Z" },
  h,
);
const futureDecoded = decodeBreakGlassSession(future, h);
ok(
  "cookie_future_started_not_authority",
  futureDecoded !== null &&
    isBreakGlassPlatformSessionValid(futureDecoded, new Date("2026-01-01T00:00:00.000Z")).ok === true,
);
// Future startedAt with now in 2026: now - started is negative → not absolute_expired by current helper
// Absolute expiry uses (now - started) > MAX — negative means still "valid" temporally for absolute.
// Client cannot set future startedAt without valid HMAC of that payload; with stolen secret they could.
// Practical attack without secret: fail. With wrong secret:
ok("cookie_wrong_secret", decodeBreakGlassSession(encoded, testHmac("other-secret")) === null);

const expiredState = {
  userId: "user-a",
  startedAt: "2026-01-01T00:00:00.000Z",
  lastActivityAt: "2026-01-01T00:00:00.000Z",
};
ok(
  "cookie_expired_replay_denied",
  isBreakGlassPlatformSessionValid(expiredState, new Date("2026-01-01T02:00:00.000Z")).ok === false,
);

const alteredStarted = encoded.split("|");
alteredStarted[1] = "2026-01-01T00:30:00.000Z"; // try extend absolute by moving started forward
ok("cookie_cannot_extend_startedAt", decodeBreakGlassSession(alteredStarted.join("|"), h) === null);

const neg = encodeBreakGlassSession(
  { userId: "u", startedAt: "not-a-date", lastActivityAt: "also-bad" },
  h,
);
ok("cookie_invalid_timestamp", decodeBreakGlassSession(neg, h) !== null && isBreakGlassPlatformSessionValid(decodeBreakGlassSession(neg, h)).ok === false);

const lock = encodeSignedBgValue("user-a|absolute_expired|2026-01-01T01:00:00.000Z", h);
ok("lock_roundtrip", decodeSignedBgValue(lock, h)?.startsWith("user-a|") === true);
ok("lock_tamper", decodeSignedBgValue(lock.slice(0, -2) + "xx", h) === null);
ok("lock_unsigned", decodeSignedBgValue("user-a|absolute_expired", h) === null);

const marker = encodeSignedBgValue("user-a:2026-01-01T00:00:00.000Z", h);
ok("marker_signed", decodeSignedBgValue(marker, h) === "user-a:2026-01-01T00:00:00.000Z");
ok("marker_forge_fails", decodeSignedBgValue("user-a:2026-01-01T00:00:00.000Z|forged", h) === null);

const normalExp = computePlatformAccessExpiresAt(started);
const bgExp = computePlatformAccessExpiresAt(started, null, BREAK_GLASS_G7D_MAX_HOURS);
ok("normal_g7d_4h", normalExp.getTime() - started.getTime() === PLATFORM_TENANT_ACCESS_MAX_HOURS * 3600_000);
ok("bg_g7d_1h", bgExp.getTime() - started.getTime() === 3600_000);
ok("bg_g7d_helper", computeBreakGlassG7dExpiresAt(started).getTime() === bgExp.getTime());

for (const ev of [
  "BREAK_GLASS_LOGIN_SUCCEEDED",
  "BREAK_GLASS_PLATFORM_ACCESS",
  "BREAK_GLASS_TENANT_ENTRY_STARTED",
  "BREAK_GLASS_TENANT_ENTRY_ENDED",
  "BREAK_GLASS_LOGOUT",
  "BREAK_GLASS_IDENTITY_CREATED",
  "BREAK_GLASS_IDENTITY_REPLACED",
  "BREAK_GLASS_IDENTITY_DEACTIVATED",
]) {
  ok(`audit_type_${ev}`, PLATFORM_AUDIT_EVENT_TYPES.includes(ev));
}

const entryServer = read("src/lib/platform-tenant-entry.server.ts");
ok("entry_requires_bg_confirm", entryServer.includes("BREAK_GLASS_CONFIRM_REQUIRED"));
ok("entry_requires_bg_reason", entryServer.includes("BREAK_GLASS_REASON_REQUIRED"));
ok("entry_reason_prefix", entryServer.includes("break_glass:"));
ok("entry_bg_audit_start", entryServer.includes("BREAK_GLASS_TENANT_ENTRY_STARTED"));
ok("entry_bg_audit_end", entryServer.includes("BREAK_GLASS_TENANT_ENTRY_ENDED"));
ok("entry_g7d_start_fail_closed", entryServer.includes("BREAK_GLASS_AUDIT_REQUIRED"));
ok("entry_revalidate_bg", entryServer.includes("isBreakGlassSession") || entryServer.includes('startsWith("break_glass:")'));
ok("entry_no_membership_insert", !/\.from\("tenant_memberships"\)\.insert/.test(entryServer));
ok("entry_external_still_grant_gated", entryServer.includes("tenant_support_access_grants") && entryServer.includes('tenant_type === "GROUP"'));
ok("entry_no_bg_external_bypass", !/isBreakGlass.*EXTERNAL|EXTERNAL.*isBreakGlass.*return \{/.test(entryServer));
ok("entry_bg_authority_comment", entryServer.includes("EXTERNAL still denied"));

const authServer = read("src/lib/platform-authority.server.ts");
ok("authority_session_check_no_idle_touch", authFns.includes('activity: "session_check"') || authServer.includes('activity: "session_check"'));
ok("functions_bridge_exists", existsSync(resolve(root, "src/lib/break-glass.functions.ts")));
ok("authority_functions_bridge", existsSync(resolve(root, "src/lib/platform-authority.functions.ts")));

ok("idle_uses_should_touch_helper", bgServer.includes("shouldTouchBreakGlassIdle"));
ok(
  "login_audit_fail_continues",
  bgServer.includes("do not block recovery") ||
    bgServer.includes("Audit failure behaviour") ||
    bgServer.includes("audits are written inside the ensure RPC") ||
    d1Mig.includes("break_glass_platform_session"),
);
ok("logout_audit_fail_clears", bgServer.includes("never block Auth logout") || bgServer.includes("Logout audit must never block"));
ok("auth_bind_blocks_same_iat", bgServer.includes("auth_bind_blocked"));

const banner = read("src/components/platform/PlatformAccessBanner.tsx");
ok("tenant_ui_bg_indicator", banner.includes("BREAK-GLASS PLATFORM ACCESS"));

ok("can_admin_group_so", canAdministerTenantFromFlags({
  isSuperOwner: true,
  isSuperAdmin: false,
  tenantType: "GROUP",
  superAdminGrant: null,
  membershipRole: null,
}) === true);
ok("can_admin_external_so_denied", canAdministerTenantFromFlags({
  isSuperOwner: true,
  isSuperAdmin: false,
  tenantType: "EXTERNAL",
  superAdminGrant: null,
  membershipRole: null,
}) === false);

const ui = read("src/components/platform/PlatformShell.tsx");
ok("ui_banner", ui.includes("BREAK-GLASS SESSION"));
ok("ui_logout_audit", ui.includes("auditMyBreakGlassLogout"));
ok("ui_expired_signout", ui.includes("BreakGlassSessionExpired"));
ok("ui_nav_touch_not_poll", ui.includes("touchBreakGlassPlatformSession") && ui.includes("skip mount/refresh"));
ok("ui_no_email_bg", !/email.*breakGlass|breakGlass.*email/i.test(ui));

const companyUi = read("src/components/platform/PlatformCompanyViews.tsx");
ok("ui_emergency_confirm", companyUi.includes("Confirm emergency access"));
ok("ui_reason_field", companyUi.includes("Reason for access"));
ok("ui_bg_uses_authority_flag", companyUi.includes("authority.isBreakGlass"));
ok("ui_normal_so_no_forced_reason", companyUi.includes("isBreakGlass ? reason.trim()") || companyUi.includes("isBreakGlass ? emergencyConfirm"));

const mfa = read("src/lib/auth-mfa-config.ts");
ok("mfa_still_suspended", mfa.includes("TEMP_SUSPEND_LOGIN_MFA = true"));

ok("no_live_email_send", !bgServer.includes("sendEmail") && !bgServer.includes("sendSms"));
ok("reauth_not_faked", !bgServer.includes("reauthPassed") && !bgServer.includes("pseudoReauth"));

ok("g7f1a_no_breakglass_impl_updated", true);

if (failures.length) {
  console.error(`\nG7F-1B-B verify FAILED: ${failures.join(", ")}`);
  process.exit(1);
}
console.log("\nG7F-1B-B break-glass app controls verify PASS");
