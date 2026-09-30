/**
 * G7F-3A trusted server MFA foundation — unit + static verification.
 * Synthetic claim fixtures only. No MFA enrolment, no network, no secrets, no production.
 * Run: npm exec --yes --package=tsx -- tsx scripts/g7f3a-privileged-mfa-verify.mjs
 * DB-side cases: scripts/g7f3a-privileged-mfa-verify.sql (rollback-only).
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Guarantee audit writes cannot reach any Supabase project from this process.
for (const k of ["SUPABASE_URL", "VITE_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) delete process.env[k];
delete process.env.PRIVILEGED_MFA_MODE;

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];
function ok(name, cond, detail = "") {
  if (cond) console.log(`PASS  ${name}${detail ? ` — ${detail}` : ""}`);
  else {
    console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
    failures.push(name);
  }
}
const read = (rel) => readFileSync(resolve(root, rel), "utf8");
const code = (rel) =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const pure = await import("../src/lib/privileged-mfa.ts");
const srv = await import("../src/lib/privileged-mfa.server.ts");
const als = await import("../src/lib/request-auth-context.server.ts");

const NOW = Math.floor(Date.now() / 1000);
const SID = "11111111-2222-4333-8444-555555555555";
const UID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
function verified(over = {}) {
  return pure.fromVerifiedSupabaseClaims({
    sub: UID,
    aal: "aal2",
    session_id: SID,
    iat: NOW - 30,
    amr: [
      { method: "password", timestamp: NOW - 3600 },
      { method: "totp", timestamp: NOW - 60 },
    ],
    ...over,
  });
}
const fresh = (ctx, extra = {}) =>
  pure.evaluateFreshPrivilegedAuth(ctx, { maxAgeSec: 300, nowSec: NOW, ...extra });
async function throwsMfa(fn) {
  try {
    await fn();
    return false;
  } catch (e) {
    return e instanceof srv.PrivilegedMfaRequiredError;
  }
}
async function withMode(mode, fn) {
  if (mode === undefined) delete process.env.PRIVILEGED_MFA_MODE;
  else process.env.PRIVILEGED_MFA_MODE = mode;
  try {
    return await fn();
  } finally {
    delete process.env.PRIVILEGED_MFA_MODE;
  }
}

// ---- AMR shape (SDK) ----
const authTypes = read("node_modules/@supabase/auth-js/dist/module/lib/types.d.ts");
ok("AMR_sdk_shape_method_timestamp", /interface AMREntry[\s\S]*method: AMRMethod[\s\S]*timestamp: number/.test(authTypes));
ok("AMR_sdk_timestamp_seconds", /seconds since 1st January 1970/.test(authTypes));
ok("AMR_sdk_totp_values", authTypes.includes('"totp"') && authTypes.includes('"mfa/totp"'));
ok("AMR_totp_methods_constant", pure.TOTP_AMR_METHODS.includes("totp") && pure.TOTP_AMR_METHODS.includes("mfa/totp"));

// ---- 1-5 trust boundary ----
ok("TEST_1_verified_aal2_accepted", pure.evaluatePlatformAal2(verified()).satisfied);
{
  const aal1 = verified({ aal: "aal1" });
  const e = pure.evaluatePlatformAal2(aal1);
  const threw = await withMode("enforce", () => throwsMfa(() => srv.requirePlatformAal2(aal1, { action: "platform.route_access", userId: UID })));
  ok("TEST_2_verified_aal1_rejected_enforce", !e.satisfied && e.reason === "aal_insufficient" && threw);
}
{
  const fb = pure.unverifiedAuthContext(UID);
  const a = pure.evaluatePlatformAal2(fb);
  const f = fresh(fb);
  const b = pure.evaluateBoundAuthSession(fb, SID);
  const threw = await withMode("enforce", () => throwsMfa(() => srv.requirePlatformAal2(fb, { action: "platform.route_access", userId: UID })));
  const verifyThrows = await throwsMfa(async () => srv.requireVerifiedAuthClaims(fb));
  ok(
    "TEST_3_unverified_fallback_rejected",
    !a.satisfied && a.reason === "claims_unverified" && !f.satisfied && !b.satisfied && threw && verifyThrows &&
      srv.getVerifiedAuthSessionId(fb) === null,
  );
}
{
  const a = pure.evaluatePlatformAal2(null);
  const threwNoCtx = await withMode("enforce", () => throwsMfa(() => srv.requirePlatformAal2(undefined, { action: "platform.route_access", userId: UID })));
  const verifyThrows = await throwsMfa(async () => srv.requireVerifiedAuthClaims(null));
  ok("TEST_4_missing_claims_rejected", !a.satisfied && a.reason === "claims_missing" && threwNoCtx && verifyThrows);
}
{
  const forged = {
    claimsVerified: true,
    userId: UID,
    aal: "aal2",
    sessionId: SID,
    amr: [{ method: "totp", timestamp: NOW }],
  };
  const fnFiles = readdirSync(resolve(root, "src/lib")).filter(
    (f) => /^(platform-.*|break-glass)\.functions\.ts$/.test(f) || f === "company-provisioning.server.ts",
  );
  const inputsTakeAal = fnFiles.some((f) =>
    /z\.object\(\{[^}]*\b(aal|amr|session_id|sessionId|authSessionId|auth_session_id|claimsVerified|authAssurance)\b/.test(read(`src/lib/${f}`)),
  );
  const srvSrc = code("src/lib/privileged-mfa.server.ts");
  ok(
    "TEST_5_browser_fake_aal2_ignored",
    !pure.evaluatePlatformAal2(forged).satisfied &&
      !fresh(forged).satisfied &&
      !pure.isVerifiedAuthContext(forged) &&
      !inputsTakeAal &&
      !/\bgetRequest\(|\.headers|getCookie|import\.meta\.env|VITE_/.test(srvSrc),
  );
}

// ---- 6-10 AMR freshness ----
{
  const e = fresh(verified());
  ok("TEST_6_fresh_totp_accepted", e.satisfied && e.mfaProofAgeSec === 60);
  const mfaTotp = fresh(verified({ amr: [{ method: "mfa/totp", timestamp: NOW - 10 }] }));
  ok("TEST_6b_mfa_totp_variant_accepted", mfaTotp.satisfied);
}
{
  const stale = fresh(verified({ amr: [{ method: "totp", timestamp: NOW - 301 }] }));
  const g7dOk = pure.evaluateFreshPrivilegedAuth(verified({ amr: [{ method: "totp", timestamp: NOW - 500 }] }), {
    maxAgeSec: pure.PRIVILEGED_FRESH_AUTH_MAX_AGE_SEC.g7dEntry,
    nowSec: NOW,
  });
  const g7dStale = pure.evaluateFreshPrivilegedAuth(verified({ amr: [{ method: "totp", timestamp: NOW - 601 }] }), {
    maxAgeSec: pure.PRIVILEGED_FRESH_AUTH_MAX_AGE_SEC.g7dEntry,
    nowSec: NOW,
  });
  const future = fresh(verified({ amr: [{ method: "totp", timestamp: NOW + 3600 }] }));
  const msUnit = fresh(verified({ amr: [{ method: "totp", timestamp: Date.now() }] }));
  ok(
    "TEST_7_stale_totp_rejected",
    !stale.satisfied && stale.reason === "fresh_mfa_stale" && g7dOk.satisfied && !g7dStale.satisfied &&
      !future.satisfied && future.reason === "fresh_mfa_future" && !msUnit.satisfied,
  );
}
{
  const pw = fresh(verified({ amr: [{ method: "password", timestamp: NOW }] }));
  const otp = fresh(verified({ amr: [{ method: "otp", timestamp: NOW }] }));
  const phone = fresh(verified({ amr: [{ method: "mfa/phone", timestamp: NOW }] }));
  const sms = fresh(verified({ amr: [{ method: "sms", timestamp: NOW }] }));
  ok(
    "TEST_8_wrong_amr_method_rejected",
    [pw, otp, phone, sms].every((e) => !e.satisfied && e.reason === "fresh_mfa_missing"),
  );
}
{
  const cases = [
    "totp",
    { method: "totp", timestamp: NOW },
    [{ method: "totp", timestamp: "now" }],
    [{ method: "totp" }],
    [{ timestamp: NOW }],
    [null, 1, "x"],
    ["totp", "password"],
    [{ method: "totp", timestamp: Number.NaN }],
    [{ method: "totp", timestamp: -5 }],
  ].map((amr) => fresh(verified({ amr })));
  ok("TEST_9_malformed_amr_rejected", cases.every((e) => !e.satisfied && e.reason === "amr_malformed"));
}
{
  const missing = fresh(verified({ amr: undefined }));
  const empty = fresh(verified({ amr: [] }));
  const nul = fresh(verified({ amr: null }));
  ok(
    "TEST_10_missing_amr_rejected",
    [missing, empty, nul].every((e) => !e.satisfied && e.reason === "amr_missing") &&
      pure.parseAmrClaim(undefined).status === "missing" && pure.parseAmrClaim([]).status === "missing",
  );
}

// ---- 11-13 session binding ----
ok(
  "TEST_11_correct_session_binding_accepted",
  fresh(verified(), { bindSessionId: SID }).satisfied && pure.evaluateBoundAuthSession(verified(), SID).satisfied,
);
{
  const a = fresh(verified(), { bindSessionId: "other-session" });
  const b = pure.evaluateBoundAuthSession(verified(), "other-session");
  const c = pure.evaluatePlatformAal2(verified(), { expectedUserId: "someone-else" });
  ok(
    "TEST_12_wrong_session_rejected",
    !a.satisfied && a.reason === "session_id_mismatch" && !b.satisfied && b.reason === "session_id_mismatch" &&
      !c.satisfied && c.reason === "user_mismatch",
  );
}
{
  const noSid = verified({ session_id: undefined });
  const a = pure.evaluatePlatformAal2(noSid);
  const b = fresh(verified(), { bindSessionId: null });
  const c = pure.evaluateBoundAuthSession(noSid, SID);
  const denied = await withMode("enforce", () =>
    srv.checkBoundAuthSession(noSid, { action: "platform.g7d_request", userId: UID, storedAuthSessionId: SID }),
  );
  ok(
    "TEST_13_missing_session_id_rejected_enforce",
    !a.satisfied && a.reason === "session_id_missing" && !b.satisfied && b.reason === "session_binding_missing" &&
      !c.satisfied && denied === false,
  );
}

// ---- 14-16 modes ----
const realisticToday = verified({ aal: "aal1", amr: [{ method: "password", timestamp: NOW - 120 }] });
async function noLockout(mode) {
  return withMode(mode, async () => {
    const a = await srv.requirePlatformAal2(realisticToday, { action: "platform.route_access", userId: UID });
    const f = await srv.requireFreshPrivilegedAuth(realisticToday, {
      action: "platform.role_grant",
      userId: UID,
      maxAgeSec: 300,
    });
    const fb = await srv.requirePlatformAal2(pure.unverifiedAuthContext(UID), { action: "platform.route_access", userId: UID });
    const none = await srv.requireFreshPrivilegedAuth(null, { action: "platform.g7d_entry", userId: UID, maxAgeSec: 600 });
    const g7dHist = await srv.checkBoundAuthSession(realisticToday, {
      action: "platform.g7d_request",
      userId: UID,
      storedAuthSessionId: null,
    });
    return !a.denied && !f.denied && !fb.denied && !none.denied && g7dHist === true && srv.getPrivilegedMfaMode() === (mode || "disabled");
  });
}
ok("TEST_14_disabled_mode_no_lockout", (await noLockout(undefined)) && (await noLockout("disabled")) && (await noLockout("")));
ok("TEST_15_audit_mode_no_lockout", await noLockout("audit"));
{
  const r = await withMode("enforce", async () => {
    const a = await throwsMfa(() => srv.requirePlatformAal2(realisticToday, { action: "platform.route_access", userId: UID }));
    const f = await throwsMfa(() =>
      srv.requireFreshPrivilegedAuth(realisticToday, { action: "platform.role_grant", userId: UID, maxAgeSec: 300 }),
    );
    const staleAal2 = await throwsMfa(() =>
      srv.requireFreshPrivilegedAuth(verified({ amr: [{ method: "totp", timestamp: NOW - 900 }] }), {
        action: "platform.role_grant",
        userId: UID,
        maxAgeSec: 300,
      }),
    );
    const good = await srv.requireFreshPrivilegedAuth(verified(), { action: "platform.role_grant", userId: UID, maxAgeSec: 300 });
    const goodAal = await srv.requirePlatformAal2(verified(), { action: "platform.route_access", userId: UID });
    return a && f && staleAal2 && !good.denied && !goodAal.denied;
  });
  const typo = pure.parsePrivilegedMfaMode("enfroce") === "enforce" && pure.parsePrivilegedMfaMode(" AUDIT ") === "audit";
  ok("TEST_16_enforce_denies_insufficient", r && typo);
}

// ---- 17-19 platform roles ----
{
  const authSrv = code("src/lib/platform-authority.server.ts");
  const mfaPure = code("src/lib/privileged-mfa.ts");
  const loadsFromPlatformRoles =
    /is_super_owner/.test(authSrv) && /is_super_admin/.test(authSrv) && !/user_roles|auth-roles/.test(authSrv);
  ok(
    "TEST_17_super_owner_via_platform_roles",
    loadsFromPlatformRoles && pure.platformPrivilegedMfaRequired({ platformRoles: ["super_owner"], isBreakGlass: false }),
  );
  ok(
    "TEST_18_super_admin_via_platform_roles",
    loadsFromPlatformRoles && pure.platformPrivilegedMfaRequired({ platformRoles: ["super_admin"], isBreakGlass: false }),
  );
  const cannotWeaken =
    pure.platformPrivilegedMfaRequired({
      platformRoles: ["super_owner"],
      isBreakGlass: false,
      optionalPolicy: { super_owner: false, super_admin: false, customer: false },
    }) &&
    pure.platformPrivilegedMfaRequired({ platformRoles: [], isBreakGlass: true, optionalPolicy: { super_owner: false } }) &&
    !pure.platformPrivilegedMfaRequired({ platformRoles: [], isBreakGlass: false });
  ok(
    "TEST_19_legacy_customer_cannot_weaken",
    cannotWeaken && !/user_roles|requiresAuthenticatorMfa|auth-roles/.test(mfaPure + code("src/lib/privileged-mfa.server.ts")),
  );
}

// ---- 20-21 server hooks ----
const authSrv = read("src/lib/platform-authority.server.ts");
const admins = read("src/lib/platform-admins.server.ts");
const owners = read("src/lib/platform-tenant-owners.server.ts");
const prov = read("src/lib/company-provisioning.server.ts");
const bgFns = read("src/lib/break-glass.functions.ts");
const bgSrv = read("src/lib/break-glass.server.ts");
const entry = read("src/lib/platform-tenant-entry.server.ts");
const mw = read("src/integrations/supabase/auth-middleware.ts");
function hookAfter(src, fnName, needle) {
  const i = src.indexOf(`export async function ${fnName}(`);
  if (i < 0) return false;
  const body = src.slice(i, i + 1500);
  return body.includes(needle);
}
const hooks = {
  requirePlatformRouteAccess: /requirePlatformRouteAccess[\s\S]{0,300}requirePrivilegedPlatformAssurance/.test(authSrv),
  requireSuperOwner: /requireSuperOwner[\s\S]{0,300}requirePrivilegedPlatformAssurance/.test(authSrv),
  addPlatformAdministrator: hookAfter(admins, "addPlatformAdministratorImpl", "PRIVILEGED_MFA_ACTIONS.platformRoleGrant"),
  revokePlatformAdministrator: hookAfter(admins, "revokePlatformAdministratorImpl", "PRIVILEGED_MFA_ACTIONS.platformRoleRevoke"),
  acceptPlatformInvite: hookAfter(admins, "acceptPlatformInviteImpl", "PRIVILEGED_MFA_ACTIONS.platformInviteAccept"),
  upsertSuperAdminTenantGrant: hookAfter(admins, "upsertSuperAdminTenantGrantImpl", "PRIVILEGED_MFA_ACTIONS.superAdminGrantUpsert"),
  revokeSuperAdminTenantGrant: hookAfter(admins, "revokeSuperAdminTenantGrantImpl", "PRIVILEGED_MFA_ACTIONS.superAdminGrantRevoke"),
  addTenantOwner: hookAfter(owners, "addPlatformTenantOwnerImpl", "PRIVILEGED_MFA_ACTIONS.tenantOwnerAdd"),
  removeTenantOwner: hookAfter(owners, "removePlatformTenantOwnerImpl", "PRIVILEGED_MFA_ACTIONS.tenantOwnerRemove"),
  provisioningAuthority: /requirePlatformProvisioningAuthority[\s\S]{0,400}requirePlatformAal2/.test(prov),
  provisionCompany: /provisionCompany[\s\S]{0,900}PRIVILEGED_MFA_ACTIONS\.companyProvision/.test(prov),
  establishBreakGlassIdentity: /PRIVILEGED_MFA_ACTIONS\.breakGlassIdentityEstablish/.test(bgFns),
  g7dEntry: /PRIVILEGED_MFA_ACTIONS\.g7dEntry[\s\S]{0,300}PRIVILEGED_FRESH_AUTH_MAX_AGE_SEC\.g7dEntry/.test(entry),
  g7dRequest: /PRIVILEGED_MFA_ACTIONS\.g7dRequest/.test(entry),
  bgSessionCreate: /PRIVILEGED_MFA_ACTIONS\.breakGlassSessionCreate/.test(bgSrv),
  bgSessionUse: /PRIVILEGED_MFA_ACTIONS\.breakGlassSessionUse/.test(bgSrv),
};
const missingHooks = Object.entries(hooks).filter(([, v]) => !v).map(([k]) => k);
const hookBeforeSideEffects =
  /await requireSuperOwner\(input\.userId\);\n  await requireFreshPrivilegedAuth/.test(admins) &&
  /await requireSuperOwner\(input\.userId\);\n  await requireFreshPrivilegedAuth/.test(owners);
ok("TEST_20_privileged_mutations_have_hooks", missingHooks.length === 0 && hookBeforeSideEffects, missingHooks.join(","));
{
  // Direct server call (no verified request context, or unverified fallback context) cannot pass enforce.
  const r = await withMode("enforce", async () => {
    const noCtx = await throwsMfa(() => srv.requireFreshPrivilegedAuth(undefined, { action: "platform.role_grant", userId: UID, maxAgeSec: 300 }));
    const viaAls = await als.runWithRequestAuthAssurance(pure.unverifiedAuthContext(UID), () =>
      throwsMfa(() => srv.requirePlatformAal2(undefined, { action: "platform.super_owner_access", userId: UID })),
    );
    const alsPasses = await als.runWithRequestAuthAssurance(verified(), async () => {
      await import("../src/lib/privileged-mfa.ts");
      await new Promise((r) => setTimeout(r, 5));
      const d = await srv.requireFreshPrivilegedAuth(undefined, { action: "platform.role_grant", userId: UID, maxAgeSec: 300 });
      return !d.denied && als.getRequestAuthAssurance()?.userId === UID;
    });
    const otherUser = await als.runWithRequestAuthAssurance(verified(), () =>
      throwsMfa(() => srv.requirePlatformAal2(undefined, { action: "platform.super_owner_access", userId: "other-user" })),
    );
    return noCtx && viaAls && alsPasses && otherUser;
  });
  const mwOk =
    /fromVerifiedSupabaseClaims\(data\.claims/.test(mw) &&
    /unverifiedAuthContext\(fallback!\.sub/.test(mw) &&
    (mw.match(/runWithRequestAuthAssurance\(/g) || []).length === 2;
  const onlyMiddlewareMints = readdirSync(resolve(root, "src"), { recursive: true })
    .filter((f) => /\.(ts|tsx)$/.test(String(f)))
    .filter((f) => read(`src/${f}`).includes("fromVerifiedSupabaseClaims("))
    .map(String)
    .sort();
  ok(
    "TEST_21_direct_call_cannot_bypass_enforce",
    r && mwOk && JSON.stringify(onlyMiddlewareMints) === JSON.stringify(["integrations/supabase/auth-middleware.ts", "lib/privileged-mfa.ts"]),
    onlyMiddlewareMints.join(","),
  );
}

// ---- 22-25 G7D (app side; DB side in SQL harness) ----
ok(
  "TEST_22_app_g7d_insert_binds_verified_session",
  /auth_session_id: authSessionId/.test(entry) && /const authSessionId = getVerifiedAuthSessionId\(\)/.test(entry) &&
    /revoked_at, auth_session_id"/.test(entry),
);
{
  const wrong = pure.evaluateBoundAuthSession(verified(), "different-auth-session");
  const denied = await withMode("enforce", () =>
    srv.checkBoundAuthSession(verified(), { action: "platform.g7d_request", userId: UID, storedAuthSessionId: "different-auth-session" }),
  );
  const same = await withMode("enforce", () =>
    srv.checkBoundAuthSession(verified(), { action: "platform.g7d_request", userId: UID, storedAuthSessionId: SID }),
  );
  ok("TEST_23_g7d_wrong_auth_session_denied_enforce", !wrong.satisfied && denied === false && same === true);
}
{
  const hist = pure.evaluateBoundAuthSession(verified(), null);
  const denied = await withMode("enforce", () =>
    srv.checkBoundAuthSession(verified(), { action: "platform.g7d_request", userId: UID, storedAuthSessionId: null }),
  );
  const emptyStr = pure.evaluateBoundAuthSession(verified(), "   ");
  ok(
    "TEST_24_historical_null_auth_session_fails_closed_enforce",
    !hist.satisfied && hist.reason === "session_binding_missing" && denied === false && !emptyStr.satisfied,
  );
}
{
  const v = entry.slice(entry.indexOf("export async function validatePlatformTenantAccessSession"));
  const iBasis = v.indexOf("revalidateBasisViaRpc(");
  const iBind = v.indexOf("checkBoundAuthSession(");
  const iBgActive = v.indexOf("isBreakGlassPlatformSessionActive(input.userId)");
  ok(
    "TEST_25_g7d_authority_revalidation_intact",
    iBasis > 0 && iBind > iBasis && iBgActive > 0 && iBind > iBgActive && /if \(!basisOk\) return null;/.test(v),
  );
}

// ---- 26-30 BG (app side; DB side in SQL harness) ----
{
  const rab = bgSrv.slice(bgSrv.indexOf("async function readAuthBinding"), bgSrv.indexOf("async function rehydrateBgSessionCookies"));
  ok(
    "TEST_26_app_bg_auth_session_primary",
    /isVerifiedAuthContext\(assurance\)/.test(rab) && /authSessionId: assurance\.sessionId/.test(rab) &&
      /getPrivilegedMfaMode\(\) === "enforce"\) return \{ authSessionId: null/.test(rab) &&
      /storedAuthSessionId: typeof row\.auth_session_id === "string"/.test(bgSrv),
  );
  const d1 = read("supabase/migrations/20260925091946_gate_g7f1b_d1_break_glass_server_sessions.sql");
  const iatUses = (d1.match(/auth_iat_bind|p_auth_iat/g) || []).length;
  ok("TEST_27_app_iat_never_compared_in_d1", iatUses === 4 && !/auth_iat_bind\s*(=|<>|!=)/.test(d1));
  ok(
    "TEST_27b_app_create_gated_by_fresh_only_in_enforce",
    /const allowCreate = mfaMode !== "enforce" \|\| createEvaluation\?\.satisfied === true;/.test(bgSrv) &&
      /p_allow_create: allowCreate/.test(bgSrv),
  );
}

// ---- migration + bypass state ----
const migs = readdirSync(resolve(root, "supabase/migrations")).filter((f) => f.includes("g7f3a"));
ok("migration_single_g7f3a", migs.length === 1, migs.join(","));
const mig = read(`supabase/migrations/${migs[0]}`);
ok("migration_nullable_auth_session_id", /ADD COLUMN IF NOT EXISTS auth_session_id text;/.test(mig) && !/NOT NULL/.test(mig.split("\n").filter((l) => !l.startsWith("--")).join("\n")));
ok("migration_no_auth_schema_touch", !/auth\.(mfa_factors|users|sessions|identities)/.test(mig));
ok("migration_no_function_changes", !/CREATE (OR REPLACE )?FUNCTION/i.test(mig));
ok("migration_no_membership_or_role_writes", !/INSERT INTO|UPDATE public\.|DELETE FROM/i.test(mig));
ok("migration_policy_table_floor_documented", /cannot be weakened/.test(mig));

const mfaCfg = read("src/lib/auth-mfa-config.ts");
const wf = read(".github/workflows/mortgagehub-staging.yml");
const envEx = read(".env.example");
ok("BYPASS_TEMP_SUSPEND_LOGIN_MFA_true", /const TEMP_SUSPEND_LOGIN_MFA = true;/.test(mfaCfg));
ok("BYPASS_VITE_SKIP_LOGIN_MFA_true", /VITE_SKIP_LOGIN_MFA: "true"/.test(wf) && /"name": "VITE_SKIP_LOGIN_MFA", "value": "true"/.test(wf) && /VITE_SKIP_LOGIN_MFA=true/.test(envEx));
ok("BYPASS_SKIP_LOGIN_MFA_true", /"name": "SKIP_LOGIN_MFA", "value": "true"/.test(wf) && /^SKIP_LOGIN_MFA=true/m.test(envEx));
ok("PRIVILEGED_MFA_MODE_not_enforce_in_repo_config", !/PRIVILEGED_MFA_MODE/.test(wf + envEx));
ok("PRIVILEGED_MFA_MODE_default_disabled", srv.getPrivilegedMfaMode() === "disabled");

const sms = read("src/lib/auth-sms-session.ts");
ok("SMS_marker_documented_not_privileged", /NOT authentication assurance/.test(sms) && !/mh_login_sms_verified|auth-sms/.test(read("src/lib/privileged-mfa.server.ts")));

const audit = read("src/lib/platform-audit.ts");
const required = [
  "MFA_ENROLLED", "MFA_VERIFIED_LOGIN", "MFA_CHALLENGE_FAILED", "MFA_FACTOR_REMOVED", "MFA_FACTOR_RESET_BY_ADMIN",
  "MFA_RESET_RECOVERY", "PRIVILEGED_REAUTH_SUCCEEDED", "PRIVILEGED_REAUTH_REQUIRED", "PRIVILEGED_AAL_DENIED", "MFA_ENFORCEMENT_CHANGED",
];
ok("AUDIT_vocabulary_added", required.every((e) => audit.includes(`"${e}"`)));
{
  const { sanitisePlatformAuditMetadata } = await import("../src/lib/platform-audit.ts");
  const kept = sanitisePlatformAuditMetadata({
    action: "platform.role_grant", aal: "aal1", session_id: SID, mfa_proof_age_sec: 42, result_reason: "fresh_mfa_stale",
  });
  const stripped = sanitisePlatformAuditMetadata({ totp_secret: "x", qr_code: "otpauth://totp/secret", password: "p", recovery_token: "r" });
  ok(
    "AUDIT_metadata_safe",
    kept.session_id === SID && kept.mfa_proof_age_sec === 42 && kept.result_reason === "fresh_mfa_stale" &&
      Object.keys(stripped).length === 0 && !/MFA_ENROLLED|MFA_VERIFIED_LOGIN/.test(read("src/lib/privileged-mfa.server.ts")),
  );
}
ok("FRESH_AGE_constants_central", pure.PRIVILEGED_FRESH_AUTH_MAX_AGE_SEC.platformAuthorityChange === 300 && pure.PRIVILEGED_FRESH_AUTH_MAX_AGE_SEC.g7dEntry === 600 &&
  ![admins, owners, prov, bgFns, bgSrv, entry].some((s) => /maxAgeSec:\s*\d/.test(s)));

// ---- R1: platform invitation acceptance (real impl; fetch stubbed to a non-routable host) ----
{
  const FAKE_HOST = "g7f3a-r1.invalid";
  const INVITEE = "staging-g7f3a-r1-invitee@example.test";
  const RAW = "g7f3a-r1-synthetic-invite-token-0123456789";
  process.env.SUPABASE_URL = `http://${FAKE_HOST}`;
  process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_secret_g7f3a_r1_not_a_real_key";
  let calls = [];
  let claimReply = "ok";
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url ?? String(input));
    if (url.hostname !== FAKE_HOST) throw new Error(`R1 fetch stub refused host ${url.hostname}`);
    const method = String(init.method || "GET").toUpperCase();
    let body = null;
    try {
      body = init.body ? JSON.parse(String(init.body)) : null;
    } catch {
      body = String(init.body);
    }
    calls.push({ method, path: url.pathname, body });
    const json = (v, status = 200) =>
      new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } });
    if (url.pathname === "/rest/v1/profiles" && method === "GET") return json([{ email: INVITEE }]);
    // G7F-4S3B: the invitee email is the canonical confirmed auth.users email, not profiles.email.
    if (url.pathname === `/auth/v1/admin/users/${UID}` && method === "GET") {
      return json({
        id: UID,
        email: INVITEE,
        email_confirmed_at: "2026-01-01T00:00:00Z",
        aud: "authenticated",
        role: "authenticated",
      });
    }
    if (url.pathname === "/rest/v1/rpc/claim_platform_invitation") {
      if (claimReply === "used") return json({ code: "28000", message: "platform_invite_used", details: null, hint: null }, 400);
      return json([
        { invitation_id: "99999999-0000-4000-8000-000000000001", granted_role: "super_admin", first_name: "R1", last_name: "Invitee", invite_email: INVITEE },
      ]);
    }
    return new Response(null, { status: 201 });
  };
  const adminsMod = await import("../src/lib/platform-admins.server.ts");
  const nonAudit = () => calls.filter((c) => c.path !== "/rest/v1/security_audit_events");
  const claimCalls = () => calls.filter((c) => c.path === "/rest/v1/rpc/claim_platform_invitation");
  const roleOrInviteWrites = () =>
    calls.filter((c) => c.path === "/rest/v1/platform_roles" || c.path === "/rest/v1/platform_invitations" || (c.path === "/rest/v1/profiles" && c.method !== "GET"));
  const auditEvents = () => calls.filter((c) => c.path === "/rest/v1/security_audit_events").map((c) => c.body?.event_type);
  async function accept(mode, ctx) {
    calls = [];
    return withMode(mode, async () => {
      const run = () => adminsMod.acceptPlatformInviteImpl({ userId: UID, rawToken: RAW });
      try {
        const result = ctx === undefined ? await run() : await als.runWithRequestAuthAssurance(ctx, run);
        return { ok: true, result };
      } catch (e) {
        return { ok: false, mfa: e instanceof srv.PrivilegedMfaRequiredError, error: e };
      }
    });
  }
  const accepted = (r) => r.ok && r.result.platformRole === "super_admin" && claimCalls().length === 1;
  const deniedClean = (r) => !r.ok && r.mfa && nonAudit().length === 0 && claimCalls().length === 0 && roleOrInviteWrites().length === 0;

  const acc = adminsMod.acceptPlatformInviteImpl.toString();
  const iHook = acc.indexOf("requireFreshPrivilegedAuth(");
  const iEmail = acc.indexOf("loadConfirmedAuthEmail(");
  const iClaim = acc.indexOf("claim_platform_invitation");
  const accStart = admins.indexOf("export async function acceptPlatformInviteImpl(");
  const accSrc = admins.slice(accStart, admins.indexOf("\n}\n", accStart));
  ok(
    "R1_TEST_1_invite_mfa_hook_before_authority",
    iHook > 0 && iHook < iEmail && iEmail < iClaim &&
      /action: PRIVILEGED_MFA_ACTIONS\.platformInviteAccept/.test(accSrc) &&
      /maxAgeSec: PRIVILEGED_FRESH_AUTH_MAX_AGE_SEC\.platformAuthorityChange/.test(accSrc) &&
      /requireFreshPrivilegedAuth\(undefined,/.test(accSrc) &&
      pure.PRIVILEGED_FRESH_AUTH_MAX_AGE_SEC.platformAuthorityChange === 300,
  );

  const disabledUnset = await accept(undefined, realisticToday);
  const disabledOk = accepted(disabledUnset) && auditEvents().every((e) => e === "PLATFORM_ROLE_GRANTED");
  const disabledExplicit = await accept("disabled", pure.unverifiedAuthContext(UID));
  ok("R1_TEST_2_disabled_mode_non_blocking", disabledOk && accepted(disabledExplicit));

  const auditRun = await accept("audit", realisticToday);
  ok(
    "R1_TEST_3_audit_mode_non_blocking",
    accepted(auditRun) && auditEvents().includes("PRIVILEGED_REAUTH_REQUIRED") && auditEvents().includes("PLATFORM_ROLE_GRANTED"),
  );

  const aal1 = await accept("enforce", verified({ aal: "aal1" }));
  ok("R1_TEST_4_enforce_aal1_denied", deniedClean(aal1) && aal1.error.reason === "aal_insufficient");

  const unverified = await accept("enforce", pure.unverifiedAuthContext(UID));
  const noCtx = await accept("enforce", undefined);
  const noCtxClean = deniedClean(noCtx);
  const forged = await accept("enforce", { claimsVerified: true, userId: UID, aal: "aal2", sessionId: SID, amr: [{ method: "totp", timestamp: NOW }] });
  ok(
    "R1_TEST_5_enforce_unverified_denied",
    unverified.mfa && unverified.error.reason === "claims_unverified" && noCtxClean && deniedClean(forged),
  );

  const noTotp = await accept("enforce", verified({ amr: [{ method: "password", timestamp: NOW - 10 }] }));
  const smsOnly = await accept("enforce", verified({ amr: [{ method: "sms", timestamp: NOW - 10 }] }));
  ok("R1_TEST_6_enforce_missing_totp_denied", deniedClean(noTotp) && noTotp.error.reason === "fresh_mfa_missing" && deniedClean(smsOnly));

  const stale = await accept("enforce", verified({ amr: [{ method: "totp", timestamp: NOW - 301 }] }));
  ok("R1_TEST_7_enforce_stale_totp_denied", deniedClean(stale) && stale.error.reason === "fresh_mfa_stale");

  const good = await accept("enforce", verified({ amr: [{ method: "totp", timestamp: NOW - 240 }] }));
  const goodClaim = claimCalls()[0]?.body ?? {};
  const goodOrder = nonAudit().map((c) => `${c.method} ${c.path}`);
  ok(
    "R1_TEST_8_enforce_fresh_aal2_totp_accepted",
    accepted(good) && auditEvents().includes("PRIVILEGED_REAUTH_SUCCEEDED") && auditEvents().includes("PLATFORM_ROLE_GRANTED"),
  );

  const denials = [aal1, unverified, noCtx, forged, noTotp, smsOnly, stale];
  ok(
    "R1_TEST_9_failed_mfa_does_not_consume_invite",
    denials.every((r) => r.mfa) && noCtxClean && !/from\("platform_invitations"\)/.test(accSrc),
  );
  ok(
    "R1_TEST_10_failed_mfa_creates_no_platform_role",
    denials.every((r) => r.mfa) && !/from\("platform_roles"\)|\.insert\(/.test(accSrc),
  );

  claimReply = "used";
  const replay = await accept("enforce", verified());
  claimReply = "ok";
  ok(
    "R1_TEST_11_atomic_single_use_semantics_preserved",
    goodClaim.p_token_hash === adminsMod.hashPlatformInviteTokenForTests(RAW) &&
      goodClaim.p_user_id === UID &&
      goodClaim.p_email === INVITEE &&
      Object.keys(goodClaim).sort().join(",") === "p_email,p_token_hash,p_user_id" &&
      goodOrder[0] === `GET /auth/v1/admin/users/${UID}` &&
      goodOrder[1] === "POST /rest/v1/rpc/claim_platform_invitation" &&
      !replay.ok && !replay.mfa && replay.error?.code === "INVITE" && /already been used/.test(replay.error?.message ?? "") &&
      !auditEvents().includes("PLATFORM_ROLE_GRANTED"),
    goodOrder.join(" | "),
  );

  globalThis.fetch = realFetch;
  for (const k of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) delete process.env[k];
}
{
  const entryMod = await import("../src/lib/platform-tenant-entry.server.ts");
  const e = new entryMod.PlatformTenantEntryError("BREAK_GLASS_SESSION_REQUIRED");
  const union = entry.slice(entry.indexOf("export class PlatformTenantEntryError"), entry.indexOf("constructor("));
  const start = entry.slice(entry.indexOf("export async function startPlatformTenantEntryImpl"));
  const iBgEnsure = start.indexOf("ensureBreakGlassPlatformSession(");
  const iBgRequired = start.indexOf('"BREAK_GLASS_SESSION_REQUIRED"');
  const iFresh = start.indexOf("requireFreshPrivilegedAuth(");
  const iInsert = start.indexOf('.from("platform_tenant_access_sessions")');
  ok(
    "R1_TEST_12_bg_session_required_typed",
    e instanceof Error && e.code === "BREAK_GLASS_SESSION_REQUIRED" && e.name === "PlatformTenantEntryError" &&
      /\| "BREAK_GLASS_SESSION_REQUIRED";/.test(union) &&
      /if \(!bgSession\.active\) \{\s*throw new PlatformTenantEntryError\(\s*"BREAK_GLASS_SESSION_REQUIRED"/.test(start) &&
      iBgEnsure > 0 && iBgRequired > iBgEnsure && iFresh > iBgRequired && (iInsert < 0 || iInsert > iFresh),
  );
}

console.log(`\nAMR_TOTP_METHOD_VALUE=${pure.TOTP_AMR_METHODS.join("|")}`);
console.log("AMR_TIMESTAMP_UNIT=unix_seconds");
console.log("AMR_MISSING_BEHAVIOUR=reject(amr_missing); non-array/string[]/no well-formed entry=reject(amr_malformed)");

if (failures.length) {
  console.error(`\nG7F-3A verify FAILED: ${failures.join(", ")}`);
  process.exit(1);
}
console.log("\nG7F-3A verify PASSED");
