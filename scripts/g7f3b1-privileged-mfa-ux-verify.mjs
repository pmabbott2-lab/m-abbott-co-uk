/**
 * G7F-3B1 privileged MFA enrolment + step-up experience — unit + static verification.
 * Mocked MFA API and a fetch stub bound to a non-routable host: no real factor, no Auth
 * change, no network, no secrets, no production.
 * Run: npm exec --yes --package=tsx -- tsx scripts/g7f3b1-privileged-mfa-ux-verify.mjs
 */
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

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
const git = (args) => execSync(`git ${args}`, { cwd: root, encoding: "utf8" });

const pure = await import("../src/lib/privileged-mfa.ts");
const flow = await import("../src/lib/privileged-mfa-flow.ts");
const authority = await import("../src/lib/platform-authority.ts");

const NOW = Math.floor(Date.now() / 1000);
const SID = "11111111-2222-4333-8444-555555555555";
const UID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const FACTOR_V = "f0000000-0000-4000-8000-00000000000a";
const FACTOR_U1 = "f0000000-0000-4000-8000-00000000000b";
const FACTOR_U2 = "f0000000-0000-4000-8000-00000000000c";
const FACTOR_NEW = "f0000000-0000-4000-8000-00000000000d";
const SYNTH_SECRET = "SYNTHETICB1SECRETNOTREAL";
const SYNTH_CODE = "246810";

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

/** In-memory stand-in for supabase.auth.mfa. Never talks to Supabase. */
function mockMfa({ factors = [], aal = "aal1", verifyError = null, promoteOnVerify = true, unenrollError = null } = {}) {
  const state = { factors: factors.map((f) => ({ ...f })), aal, calls: [], codesSeen: [] };
  const api = {
    async listFactors() {
      state.calls.push("listFactors");
      const all = state.factors.map((f) => ({ ...f }));
      return { data: { all, totp: all.filter((f) => f.factor_type === "totp" && f.status === "verified") }, error: null };
    },
    async enroll(params) {
      state.calls.push(`enroll:${params.friendlyName}`);
      state.factors.push({ id: FACTOR_NEW, factor_type: "totp", status: "unverified", friendly_name: params.friendlyName });
      return {
        data: {
          id: FACTOR_NEW,
          type: "totp",
          totp: { qr_code: "<svg xmlns='http://www.w3.org/2000/svg'></svg>", secret: SYNTH_SECRET, uri: "otpauth://totp/x" },
        },
        error: null,
      };
    },
    async challenge({ factorId }) {
      state.calls.push(`challenge:${factorId}`);
      return { data: { id: `ch-${factorId}` }, error: null };
    },
    async verify({ factorId, code }) {
      state.calls.push(`verify:${factorId}`);
      state.codesSeen.push(code);
      if (verifyError) return { data: null, error: { message: verifyError } };
      const f = state.factors.find((x) => x.id === factorId);
      if (f) f.status = "verified";
      if (promoteOnVerify) state.aal = "aal2";
      return { data: { access_token: "synthetic" }, error: null };
    },
    async unenroll({ factorId }) {
      state.calls.push(`unenroll:${factorId}`);
      if (unenrollError) return { data: null, error: { message: unenrollError } };
      state.factors = state.factors.filter((f) => f.id !== factorId);
      return { data: { id: factorId }, error: null };
    },
    async getAuthenticatorAssuranceLevel() {
      state.calls.push("aal");
      return { data: { currentLevel: state.aal, nextLevel: "aal2" }, error: null };
    },
  };
  return { api, state };
}
const V = (id = FACTOR_V) => ({ id, factor_type: "totp", status: "verified", friendly_name: "Mortgage Hub platform" });
const U = (id) => ({ id, factor_type: "totp", status: "unverified", friendly_name: "Mortgage Hub platform" });
const serverAal2 = async () => ({ claimsVerified: true, aal: "aal2" });
const serverAal1 = async () => ({ claimsVerified: true, aal: "aal1" });

// ---- Server status / events harness (fetch stub, fake host) ----
const FAKE_HOST = "g7f3b1.invalid";
process.env.SUPABASE_URL = `http://${FAKE_HOST}`;
process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_secret_g7f3b1_not_a_real_key";
const net = { so: false, sa: false, bg: false, adminFactors: [], auditExists: false, calls: [] };
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === "string" ? input : input.url ?? String(input));
  if (url.hostname !== FAKE_HOST) throw new Error(`B1 fetch stub refused host ${url.hostname}`);
  const method = String(init.method || (typeof input === "object" && input.method) || "GET").toUpperCase();
  let body = null;
  try {
    body = init.body ? JSON.parse(String(init.body)) : null;
  } catch {
    body = String(init.body);
  }
  net.calls.push({ method, path: url.pathname, body });
  const json = (v, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } });
  if (url.pathname === "/rest/v1/rpc/platform_mfa_recovery_authority_state") return json("ok");
  if (url.pathname === "/rest/v1/rpc/is_super_owner") return json(net.so);
  if (url.pathname === "/rest/v1/rpc/is_super_admin") return json(net.sa);
  if (url.pathname === "/rest/v1/rpc/is_active_break_glass") return json(net.bg);
  if (url.pathname === `/auth/v1/admin/users/${UID}/factors` && method === "GET") return json(net.adminFactors);
  if (url.pathname === "/rest/v1/security_audit_events" && method === "GET") return json(net.auditExists ? [{ id: 1 }] : []);
  if (url.pathname === "/rest/v1/security_audit_events" && method === "POST") return new Response(null, { status: 201 });
  return json({ message: "unexpected" }, 500);
};
const account = await import("../src/lib/privileged-mfa-account.server.ts");
const auditWrites = () => net.calls.filter((c) => c.path === "/rest/v1/security_audit_events" && c.method === "POST").map((c) => c.body);
function resetNet(over = {}) {
  Object.assign(net, { so: false, sa: false, bg: false, adminFactors: [], auditExists: false, calls: [] }, over);
  account.resetMfaEventThrottleForTests();
}
async function status(ctx, mode) {
  if (mode === undefined) delete process.env.PRIVILEGED_MFA_MODE;
  else process.env.PRIVILEGED_MFA_MODE = mode;
  try {
    return await account.resolvePrivilegedMfaStatus({ userId: UID, auth: ctx });
  } finally {
    delete process.env.PRIVILEGED_MFA_MODE;
  }
}

const accountSrc = code("src/lib/privileged-mfa-account.server.ts");
const flowSrc = code("src/lib/privileged-mfa-flow.ts");
const panelSrc = code("src/components/platform/PrivilegedMfaPanel.tsx");
const stepUpSrc = code("src/components/platform/PrivilegedStepUp.tsx");
const statusFnSrc = code("src/lib/privileged-mfa-status.functions.ts");
const shellSrc = code("src/components/platform/PlatformShell.tsx");
const securitySrc = code("src/routes/platform/security.tsx");
const authSrc = code("src/routes/auth.tsx");
const newB1 = [accountSrc, flowSrc, panelSrc, stepUpSrc, statusFnSrc, securitySrc];

// ---- 1-5 role detection ----
resetNet({ so: true });
const soStatus = await status(verified({ aal: "aal1" }));
ok(
  "TEST_1_platform_roles_source",
  /resolvePlatformAuthority\(/.test(accountSrc) && !/user_roles|fetchUserRoles|requiresAuthenticatorMfa/.test(accountSrc) &&
    net.calls.some((c) => c.path === "/rest/v1/rpc/is_super_owner") && net.calls.some((c) => c.path === "/rest/v1/rpc/is_super_admin") &&
    !net.calls.some((c) => c.path.includes("user_roles")),
);
ok("TEST_2_super_owner_recognised", soStatus.isSuperOwner && soStatus.platformRoles.includes("super_owner") && soStatus.privilegedMfaRequired);
resetNet({ sa: true });
const saStatus = await status(verified({ aal: "aal1" }));
ok("TEST_3_super_admin_recognised", saStatus.isSuperAdmin && !saStatus.isSuperOwner && saStatus.privilegedMfaRequired);
resetNet();
const plainStatus = await status(verified({ aal: "aal1" }), "enforce");
const legacyView = authority.resolvePlatformAuthorityFromRoles({ userId: UID, roles: ["admin", "owner", "customer", "advisor"] });
ok(
  "TEST_4_legacy_customer_role_cannot_bypass",
  !plainStatus.privilegedMfaRequired && !plainStatus.continuationBlocked && !legacyView.canAccessPlatform &&
    pure.platformPrivilegedMfaRequired({ platformRoles: ["super_admin", "customer"], isBreakGlass: false }) &&
    pure.platformPrivilegedMfaRequired({ platformRoles: ["super_owner", "admin"], isBreakGlass: false }),
);
resetNet({ so: true, bg: true });
const bgStatus = await status(verified({ aal: "aal1" }));
resetNet({ so: false, bg: true });
const bgOnly = await status(verified({ aal: "aal1" }));
const bgView = authority.withBreakGlassSession(
  authority.resolvePlatformAuthorityFromRoles({ userId: UID, roles: ["super_owner"], isBreakGlass: true }),
  false,
  { mfaRequired: true },
);
ok(
  "TEST_5_break_glass_recognised_separately",
  bgStatus.isBreakGlass && bgStatus.isSuperOwner && bgStatus.privilegedMfaRequired && !bgOnly.isBreakGlass &&
    bgView.breakGlassMfaRequired === true && bgView.breakGlassSessionActive === false &&
    authority.withBreakGlassSession(bgView, true, { mfaRequired: true }).breakGlassMfaRequired !== true &&
    /breakGlassMfaRequired === true/.test(shellSrc) && /<BreakGlassMfaRequired/.test(shellSrc),
);

// ---- 6-10 factor flows ----
{
  const { api, state } = mockMfa();
  const loaded = await flow.loadTotpFactors(api);
  const step = flow.decidePrivilegedMfaStep({ required: true, verifiedFactorCount: loaded.verified.length, currentLevel: "aal1" });
  const started = await flow.startTotpEnrolment(api);
  ok(
    "TEST_6_zero_factors_setup",
    step === "setup" && started.kind === "enrolment_pending" && state.calls.filter((c) => c.startsWith("enroll")).length === 1 &&
      state.calls.includes(`enroll:${flow.PRIVILEGED_TOTP_FRIENDLY_NAME}`) && started.removedStaleFactorIds.length === 0,
  );
}
{
  const { api } = mockMfa({ factors: [U(FACTOR_U1)] });
  const loaded = await flow.loadTotpFactors(api);
  ok(
    "TEST_7_unverified_not_configured",
    loaded.ok && loaded.verified.length === 0 && loaded.unverified.length === 1 &&
      flow.decidePrivilegedMfaStep({ required: true, verifiedFactorCount: loaded.verified.length, currentLevel: "aal1" }) === "setup" &&
      (await flow.confirmPrivilegedAal2(api, { factorId: FACTOR_U1 })).confirmed === false,
  );
}
{
  const { api } = mockMfa({ factors: [V()] });
  const loaded = await flow.loadTotpFactors(api);
  ok(
    "TEST_8_verified_factor_challenge",
    flow.decidePrivilegedMfaStep({ required: true, verifiedFactorCount: loaded.verified.length, currentLevel: "aal1" }) === "challenge" &&
      flow.decidePrivilegedMfaStep({ required: true, verifiedFactorCount: 1, currentLevel: "aal2" }) === "satisfied" &&
      flow.decidePrivilegedMfaStep({ required: false, verifiedFactorCount: 0, currentLevel: "aal1" }) === "not_required",
  );
}
{
  const { api, state } = mockMfa({ factors: [V()] });
  const started = await flow.startTotpEnrolment(api);
  const challenged = await flow.completeTotpChallenge(api, { code: SYNTH_CODE, serverConfirm: serverAal2 });
  ok(
    "TEST_9_verified_factor_not_duplicated",
    started.kind === "already_configured" && challenged.status === "verified_aal2" &&
      !state.calls.some((c) => c.startsWith("enroll") || c.startsWith("unenroll")) && state.factors.length === 1,
  );
}
{
  const a = mockMfa({ factors: [U(FACTOR_U1), U(FACTOR_U2)] });
  const startedA = await flow.startTotpEnrolment(a.api);
  const b = mockMfa({ factors: [V(), U(FACTOR_U1)] });
  const startedB = await flow.startTotpEnrolment(b.api);
  const c = mockMfa({ factors: [U(FACTOR_U1)], unenrollError: "denied" });
  const startedC = await flow.startTotpEnrolment(c.api);
  const d = mockMfa({ factors: [U(FACTOR_U1)] });
  await flow.startTotpEnrolment(d.api);
  await flow.startTotpEnrolment(d.api);
  ok(
    "TEST_10_abandoned_enrolment_safe",
    startedA.kind === "enrolment_pending" && startedA.removedStaleFactorIds.join(",") === `${FACTOR_U1},${FACTOR_U2}` &&
      a.state.factors.filter((f) => f.status === "unverified").length === 1 &&
      startedB.kind === "already_configured" && !b.state.calls.some((x) => x.startsWith("unenroll") || x.startsWith("enroll")) &&
      b.state.factors.some((f) => f.id === FACTOR_V && f.status === "verified") &&
      startedC.kind === "error" && !c.state.calls.some((x) => x.startsWith("enroll")) &&
      d.state.factors.filter((f) => f.status === "unverified").length === 1 &&
      !/unenroll\(/.test(panelSrc + stepUpSrc + securitySrc + shellSrc),
  );
}

// ---- 11-14 assurance ----
{
  const { api } = mockMfa();
  const started = await flow.startTotpEnrolment(api);
  const confirm = await flow.confirmPrivilegedAal2(api, { factorId: FACTOR_NEW, serverConfirm: serverAal2 });
  ok(
    "TEST_11_enrol_response_does_not_unlock",
    started.kind === "enrolment_pending" && confirm.confirmed === false &&
      /status === "verified_aal2"[\s\S]*onSatisfied\?\.\(\)/.test(panelSrc) &&
      (panelSrc.match(/onSatisfied\?\.\(\)/g) || []).length === 1 &&
      !/onSatisfied/.test(panelSrc.slice(panelSrc.indexOf("const beginSetup"), panelSrc.indexOf("const onResult"))),
  );
}
{
  const { api } = mockMfa({ promoteOnVerify: false });
  await flow.startTotpEnrolment(api);
  const r = await flow.completeTotpEnrolment(api, { factorId: FACTOR_NEW, code: SYNTH_CODE, serverConfirm: serverAal2 });
  ok("TEST_12_verify_requires_aal2_confirmation", r.status === "failed" && r.stage === "aal2");
}
{
  const runs = [];
  for (const serverConfirm of [serverAal1, async () => ({ claimsVerified: false, aal: "aal2" }), async () => { throw new Error("x"); }]) {
    const { api } = mockMfa({ factors: [V()] });
    runs.push(await flow.completeTotpChallenge(api, { code: SYNTH_CODE, serverConfirm }));
  }
  let executed = 0;
  let refused = false;
  try {
    await flow.runWithPrivilegedStepUp(async () => {
      executed++;
      throw new Error(pure.PRIVILEGED_MFA_ERROR_MESSAGES.PRIVILEGED_AAL_REQUIRED);
    }, async () => false);
  } catch {
    refused = true;
  }
  ok("TEST_13_failed_aal2_confirmation_no_continuation", runs.every((r) => r.status === "failed" && r.stage === "aal2") && refused && executed === 1);
}
{
  const { api } = mockMfa();
  await flow.startTotpEnrolment(api);
  const r = await flow.completeTotpEnrolment(api, { factorId: FACTOR_NEW, code: SYNTH_CODE, serverConfirm: serverAal2 });
  ok("TEST_14_verified_aal2_continues", r.status === "verified_aal2" && r.factorId === FACTOR_NEW);
}

// ---- 15-19 step-up ----
function serverMutation({ deny = 1 } = {}) {
  const s = { attempts: 0, executed: 0, denied: 0 };
  s.call = async () => {
    s.attempts++;
    if (s.denied < deny) {
      s.denied++;
      // Browser-side view after ShallowErrorPlugin: message only, no code.
      throw new Error(pure.PRIVILEGED_MFA_ERROR_MESSAGES.PRIVILEGED_REAUTH_REQUIRED);
    }
    s.executed++;
    return { ok: true };
  };
  return s;
}
{
  const m = serverMutation();
  const prompts = [];
  const executedAtPrompt = [];
  const result = await flow.runWithPrivilegedStepUp(m.call, async (reason) => {
    prompts.push(reason);
    executedAtPrompt.push(m.executed);
    return true;
  });
  ok(
    "TEST_15_step_up_triggers_on_reauth_required",
    prompts.length === 1 && prompts[0] === "PRIVILEGED_REAUTH_REQUIRED" && result.ok === true &&
      pure.classifyPrivilegedMfaError(new Error(pure.PRIVILEGED_MFA_ERROR_MESSAGES.PRIVILEGED_AAL_REQUIRED)) === "PRIVILEGED_AAL_REQUIRED" &&
      pure.classifyPrivilegedMfaError(new Error("Something else")) === null,
  );
  ok("TEST_16_mutation_not_executed_before_step_up", executedAtPrompt[0] === 0 && m.executed === 1);
}
{
  const m = serverMutation();
  let caught = null;
  try {
    await flow.runWithPrivilegedStepUp(m.call, async () => false);
  } catch (e) {
    caught = e;
  }
  const { api, state } = mockMfa({ factors: [V()], verifyError: "Invalid TOTP code entered" });
  const r = await flow.completeTotpChallenge(api, { code: SYNTH_CODE, serverConfirm: serverAal2 });
  ok(
    "TEST_17_failed_totp_does_not_execute_mutation",
    m.executed === 0 && m.attempts === 1 && caught?.message === pure.PRIVILEGED_MFA_ERROR_MESSAGES.PRIVILEGED_REAUTH_REQUIRED &&
      r.status === "failed" && r.stage === "verify" && state.aal === "aal1",
  );
}
{
  const m = serverMutation({ deny: 1 });
  let prompts = 0;
  await flow.runWithPrivilegedStepUp(m.call, async () => {
    prompts++;
    return true;
  });
  const m2 = serverMutation({ deny: 5 });
  let prompts2 = 0;
  let secondDenied = false;
  try {
    await flow.runWithPrivilegedStepUp(m2.call, async () => {
      prompts2++;
      return true;
    });
  } catch {
    secondDenied = true;
  }
  let opened = 0;
  let release;
  const coordinated = flow.createStepUpCoordinator(() => {
    opened++;
    return new Promise((r) => {
      release = r;
    });
  });
  const p1 = coordinated("PRIVILEGED_REAUTH_REQUIRED");
  const p2 = coordinated("PRIVILEGED_REAUTH_REQUIRED");
  release(true);
  const both = await Promise.all([p1, p2]);
  ok(
    "TEST_18_successful_step_up_retries_once",
    m.attempts === 2 && m.executed === 1 && prompts === 1 && secondDenied && m2.attempts === 2 && m2.executed === 0 && prompts2 === 1 &&
      opened === 1 && both.every(Boolean) && /createStepUpCoordinator\(/.test(stepUpSrc) && /runWithPrivilegedStepUp\(/.test(stepUpSrc),
  );
}
{
  const { api, state } = mockMfa();
  const started = await flow.startTotpEnrolment(api);
  const done = await flow.completeTotpEnrolment(api, { factorId: FACTOR_NEW, code: SYNTH_CODE, serverConfirm: serverAal2 });
  const submit = panelSrc.slice(panelSrc.indexOf("const submitCode"), panelSrc.indexOf("if (loadError)"));
  ok(
    "TEST_19_code_not_retained",
    state.codesSeen.join() === SYNTH_CODE && !JSON.stringify(done).includes(SYNTH_CODE) && !JSON.stringify(started).includes(SYNTH_CODE) &&
      /const entered = code;\s*setCode\(""\);/.test(submit) && submit.indexOf('setCode("")') < submit.indexOf("await ") &&
      /setMfaTotpCode\(""\);\s*setLoading\(true\)/.test(authSrc) &&
      !newB1.some((s) => /localStorage|sessionStorage|console\.(log|info|debug|warn|error)/.test(s)) &&
      !/dangerouslySetInnerHTML/.test(panelSrc + authSrc),
  );
}

// ---- 20-25 trust + modes ----
resetNet({ so: true });
const smsStatus = await status(verified({ aal: "aal1", amr: [{ method: "sms", timestamp: NOW - 5 }] }), "enforce");
ok(
  "TEST_20_sms_marker_cannot_satisfy",
  smsStatus.continuationBlocked && smsStatus.recentMfaAgeSec === null &&
    !newB1.some((s) => /isLoginSmsVerified|mh_login_sms_verified|sendLoginSmsCode|factorType:\s*"phone"/.test(s)),
);
{
  const { api } = mockMfa({ factors: [V()], aal: "aal2" });
  const clientOnly = await flow.confirmPrivilegedAal2(api, { factorId: FACTOR_V, serverConfirm: serverAal1 });
  ok(
    "TEST_21_client_skip_cannot_manufacture_aal2",
    clientOnly.confirmed === false &&
      !newB1.some((s) => /SKIP_LOGIN_MFA|isLoginMfaSuspended|TEMP_SUSPEND_LOGIN_MFA/.test(s)) &&
      /server\.claimsVerified !== true \|\| server\.aal !== "aal2"/.test(flowSrc),
  );
}
resetNet({ so: true });
const unverifiedStatus = await status(pure.unverifiedAuthContext(UID), "enforce");
const forgedStatus = await status({ claimsVerified: true, userId: UID, aal: "aal2", sessionId: SID, amr: [{ method: "totp", timestamp: NOW }] }, "enforce");
const forgedEvent = await account.recordPrivilegedMfaEventImpl({
  userId: UID,
  event: "verified",
  auth: { claimsVerified: true, userId: UID, aal: "aal2", sessionId: SID, amr: [{ method: "totp", timestamp: NOW }] },
});
ok(
  "TEST_22_unverified_claims_cannot_satisfy",
  !unverifiedStatus.claimsVerified && unverifiedStatus.aal === null && unverifiedStatus.continuationBlocked &&
    !forgedStatus.claimsVerified && forgedStatus.aal === null && forgedStatus.continuationBlocked &&
    !forgedEvent.recorded && forgedEvent.reason === "claims_unverified" && auditWrites().length === 0,
);
resetNet({ so: true });
const disabledUnset = await status(verified({ aal: "aal1" }));
const disabledExplicit = await status(pure.unverifiedAuthContext(UID), "disabled");
ok(
  "TEST_23_disabled_mode_non_blocking",
  disabledUnset.mode === "disabled" && !disabledUnset.continuationBlocked && !disabledExplicit.continuationBlocked &&
    /continuationBlocked === true/.test(shellSrc) && /if \(!blocked \|\| pathname === PRIVILEGED_MFA_SETUP_PATH\) return;/.test(shellSrc),
);
const auditStatus = await status(verified({ aal: "aal1" }), "audit");
ok("TEST_24_audit_mode_non_blocking", auditStatus.mode === "audit" && !auditStatus.enforced && !auditStatus.continuationBlocked);
{
  const enforceAal1 = await status(verified({ aal: "aal1" }), "enforce");
  const enforceAal2 = await status(verified(), "enforce");
  const workflow = read(".github/workflows/mortgagehub-staging.yml");
  ok(
    "TEST_25_enforce_testable_not_activated",
    enforceAal1.enforced && enforceAal1.continuationBlocked && !enforceAal2.continuationBlocked && enforceAal2.recentMfaAgeSec !== null &&
      !/PRIVILEGED_MFA_MODE/.test(workflow) && read("src/lib/auth-mfa-config.ts").includes("const TEMP_SUSPEND_LOGIN_MFA = true;") &&
      !/process\.env\.PRIVILEGED_MFA_MODE\s*=/.test(newB1.join("\n")),
  );
}

// ---- 26-28 break-glass + boundary ----
{
  const bgBlock = shellSrc.slice(shellSrc.indexOf("function BreakGlassMfaRequired"), shellSrc.indexOf("export function PlatformAuthenticatedGate"));
  ok(
    "TEST_26_bg_no_fallback",
    /<PrivilegedMfaPanel/.test(bgBlock) && !/signInWithOtp|sendLoginSmsCode|resetPasswordForEmail|factorType|phone|skip/i.test(bgBlock) &&
      !newB1.some((s) => /signInWithOtp|sendLoginSmsCode|resetPasswordForEmail|channel:\s*"sms"/.test(s)) &&
      !/>\s*(Skip|Bypass|Continue without)/i.test(panelSrc + stepUpSrc + securitySrc + bgBlock),
  );
}
{
  const bgDiff = git("diff --stat HEAD -- src/lib/break-glass.server.ts src/lib/break-glass.functions.ts src/lib/break-glass-registry.server.ts supabase/migrations");
  ok(
    "TEST_27_bg_constants_unchanged",
    bgDiff.trim() === "" && shellSrc.includes("Sessions expire after 60 minutes (15 minutes idle).") &&
      git("status --porcelain -- supabase/migrations").trim() === "",
  );
}
{
  const PRE_B1 = "7e773365e54537bb7dbfdb297e7a8cc2f37f1943";
  const authDiff = git(`diff -U0 ${PRE_B1} -- src/lib/platform-authority.ts`).split("\n").filter((l) => /^[+-][^+-]/.test(l));
  const entryDiff = git(`diff --stat ${PRE_B1} -- src/lib/platform-tenant-entry.server.ts src/lib/platform-tenant-entry.functions.ts`);
  ok(
    "TEST_28_group_external_boundary_unchanged",
    entryDiff.trim() === "" && authDiff.length > 0 && authDiff.every((l) => !/GROUP|EXTERNAL|TenantType|canAdminister|canAccessTenantData|superAdminGrant|supportScope/.test(l)),
  );
}

// ---- Audit authority model ----
{
  const recentIso = new Date(Date.now() - 60_000).toISOString();
  const staleIso = new Date(Date.now() - 3 * 3600_000).toISOString();
  resetNet({ so: true, adminFactors: [{ id: FACTOR_V, factor_type: "totp", status: "verified", friendly_name: "Mortgage Hub platform", updated_at: recentIso }] });
  const enrolled = await account.recordPrivilegedMfaEventImpl({ userId: UID, event: "enrolled", factorId: FACTOR_V, auth: verified() });
  const w1 = auditWrites();
  resetNet({ so: true, auditExists: true, adminFactors: [{ id: FACTOR_V, factor_type: "totp", status: "verified", updated_at: recentIso }] });
  const dup = await account.recordPrivilegedMfaEventImpl({ userId: UID, event: "enrolled", factorId: FACTOR_V, auth: verified() });
  const w2 = auditWrites();
  resetNet({ so: true, adminFactors: [{ id: FACTOR_V, factor_type: "totp", status: "unverified", updated_at: recentIso }] });
  const unverifiedFactor = await account.recordPrivilegedMfaEventImpl({ userId: UID, event: "enrolled", factorId: FACTOR_V, auth: verified() });
  resetNet({ so: true, adminFactors: [{ id: FACTOR_V, factor_type: "totp", status: "verified", updated_at: staleIso }] });
  const oldFactor = await account.recordPrivilegedMfaEventImpl({ userId: UID, event: "enrolled", factorId: FACTOR_V, auth: verified() });
  resetNet({ so: true, adminFactors: [{ id: FACTOR_V, factor_type: "totp", status: "verified", updated_at: recentIso }] });
  const aal1Enrol = await account.recordPrivilegedMfaEventImpl({ userId: UID, event: "enrolled", factorId: FACTOR_V, auth: verified({ aal: "aal1" }) });
  const w3 = auditWrites();
  ok(
    "AUDIT_MFA_ENROLLED_authoritative_only",
    enrolled.recorded && w1.length === 1 && w1[0].event_type === "MFA_ENROLLED" && w1[0].metadata.authoritative === true &&
      w1[0].metadata.factor_id === FACTOR_V && w1[0].acting_user_id === UID &&
      !dup.recorded && dup.reason === "duplicate" && w2.length === 0 &&
      !unverifiedFactor.recorded && !oldFactor.recorded && oldFactor.reason === "enrolment_not_recent" &&
      !aal1Enrol.recorded && aal1Enrol.reason === "fresh_mfa_missing" && w3.length === 0,
  );

  resetNet({ so: true, adminFactors: [{ id: FACTOR_V, factor_type: "totp", status: "verified", updated_at: staleIso }] });
  const login = await account.recordPrivilegedMfaEventImpl({ userId: UID, event: "verified", auth: verified() });
  const w4 = auditWrites();
  resetNet({ so: true, adminFactors: [] });
  const noFactor = await account.recordPrivilegedMfaEventImpl({ userId: UID, event: "verified", auth: verified() });
  resetNet({ so: true, adminFactors: [{ id: FACTOR_V, factor_type: "totp", status: "verified", updated_at: staleIso }] });
  const staleLogin = await account.recordPrivilegedMfaEventImpl({ userId: UID, event: "verified", auth: verified({ amr: [{ method: "totp", timestamp: NOW - 900 }] }) });
  ok(
    "AUDIT_MFA_VERIFIED_LOGIN_authoritative_only",
    login.recorded && w4.length === 1 && w4[0].event_type === "MFA_VERIFIED_LOGIN" && w4[0].metadata.authoritative === true &&
      w4[0].metadata.session_id === SID && typeof w4[0].metadata.mfa_at === "number" &&
      !noFactor.recorded && noFactor.reason === "factor_not_verified" && !staleLogin.recorded && staleLogin.reason === "fresh_mfa_missing",
  );

  resetNet({ so: true });
  const t0 = Date.now();
  const f1 = await account.recordPrivilegedMfaEventImpl({ userId: UID, event: "challenge_failed", auth: verified({ aal: "aal1" }), nowMs: t0 });
  const f2 = await account.recordPrivilegedMfaEventImpl({ userId: UID, event: "challenge_failed", auth: verified({ aal: "aal1" }), nowMs: t0 + 60_000 });
  const w5 = auditWrites();
  resetNet({ so: false, sa: false });
  const nonPriv = await account.recordPrivilegedMfaEventImpl({ userId: UID, event: "challenge_failed", auth: verified({ aal: "aal1" }) });
  const w6 = auditWrites();
  ok(
    "AUDIT_MFA_CHALLENGE_FAILED_informational_throttled",
    f1.recorded && !f2.recorded && f2.reason === "throttled" && w5.length === 1 && w5[0].event_type === "MFA_CHALLENGE_FAILED" &&
      w5[0].metadata.authoritative === false && w5[0].metadata.client_reported === true &&
      !nonPriv.recorded && nonPriv.reason === "not_privileged" && w6.length === 0,
  );
  const allMeta = JSON.stringify([...w1, ...w4, ...w5].map((w) => w.metadata));
  ok(
    "AUDIT_metadata_no_secrets",
    !allMeta.includes(SYNTH_SECRET) && !allMeta.includes(SYNTH_CODE) && !/"(code|secret|qr|uri|password|token)[^"]*":/i.test(allMeta) &&
      /event: z\.enum\(\["enrolled", "verified", "challenge_failed"\]\)/.test(statusFnSrc) && !/code: z\./.test(statusFnSrc),
  );
}

// ---- Factor visibility / management ----
ok(
  "FACTOR_last_verified_removal_not_offered",
  !/unenroll|deleteFactor|admin\.mfa\.deleteFactor/.test(panelSrc + securitySrc + stepUpSrc + accountSrc + statusFnSrc) &&
    /the last verified authenticator on a platform account is never removed/.test(securitySrc) &&
    /factors\.verified\.map/.test(panelSrc) && /friendlyName/.test(panelSrc),
);

// ---- Setup route + involuntary enrolment ----
ok(
  "SETUP_route_and_redirect_validation",
  /createFileRoute\("\/platform\/security"\)/.test(securitySrc) && read("src/routeTree.gen.ts").includes("/platform/security") &&
    flow.safePlatformRedirect("/platform/companies/ABC") === "/platform/companies/ABC" &&
    flow.safePlatformRedirect("https://evil.example/platform") === null && flow.safePlatformRedirect("//evil.example") === null &&
    flow.safePlatformRedirect("/platform/../auth") === null && flow.safePlatformRedirect("/platform/security") === null &&
    flow.safePlatformRedirect("/auth") === null,
);
{
  const effects = [...panelSrc.matchAll(/useEffect\(([\s\S]*?)\}, \[/g)].map((m) => m[1]).join("\n");
  const headAuth = git("show HEAD:src/routes/auth.tsx");
  const count = (s, re) => (s.match(re) || []).length;
  ok(
    "SETUP_no_involuntary_enrolment",
    !/startTotpEnrolment|beginSetup|completeTotp/.test(effects) && /onClick=\{\(\) => void beginSetup\(\)\}/.test(panelSrc) &&
      count(authSrc, /isLoginMfaSuspended\(\)/g) === count(headAuth, /isLoginMfaSuspended\(\)/g) &&
      !/startTotpEnrolment|enroll\(/.test(shellSrc + stepUpSrc + securitySrc),
  );
}
ok(
  "SETUP_qr_rendered_as_image",
  flow.totpQrImageSrc("<svg></svg>")?.startsWith("data:image/svg+xml;charset=utf-8,%3Csvg") &&
    flow.totpQrImageSrc("data:image/svg+xml;utf-8,<svg></svg>")?.startsWith("data:image/svg+xml;charset=utf-8,%3Csvg") &&
    flow.totpQrImageSrc("javascript:alert(1)") === null && /<img src=\{pending\.qrSrc\}/.test(panelSrc),
);

// ---- Step-up wiring ----
{
  const sites = [
    ["src/components/platform/PlatformCompanyViews.tsx", "startPlatformTenantEntry"],
    ["src/components/platform/PlatformCompanyViews.tsx", "addPlatformTenantOwner"],
    ["src/components/platform/PlatformCompanyViews.tsx", "removePlatformTenantOwner"],
    ["src/routes/platform/admins.tsx", "addPlatformAdministrator"],
    ["src/routes/platform/admins.tsx", "revokePlatformAdministrator"],
    ["src/routes/platform/admins.tsx", "upsertSuperAdminTenantGrant"],
    ["src/routes/platform-invite.tsx", "acceptPlatformInvite"],
    ["src/components/company/CreateCompanyWizard.tsx", "provisionCompany"],
  ];
  ok(
    "STEPUP_call_sites_wrapped",
    sites.every(([f, fn]) => code(f).includes(`useStepUpServerFn(useServerFn(${fn}))`)) &&
      /<PrivilegedStepUpProvider>\{children\}<\/PrivilegedStepUpProvider>/.test(shellSrc) &&
      /<PrivilegedStepUpProvider>/.test(code("src/routes/platform-invite.tsx")) &&
      /useContext\(PrivilegedStepUpContext\) \?\? passThrough/.test(stepUpSrc),
  );
}
ok(
  "SERVER_error_messages_shared",
  read("src/lib/privileged-mfa.server.ts").includes("super(PRIVILEGED_MFA_ERROR_MESSAGES[code])") &&
    pure.PRIVILEGED_MFA_ERROR_MESSAGES.PRIVILEGED_REAUTH_REQUIRED === "Re-verify with your authenticator app to continue." &&
    pure.PRIVILEGED_MFA_ERROR_MESSAGES.PRIVILEGED_AAL_REQUIRED === "Authenticator verification is required for platform administration.",
);

// ---- SDK behaviour evidence (REPEATED_TOTP_VERIFY_EXPECTED_TO_REFRESH_AMR) ----
{
  const types = read("node_modules/@supabase/auth-js/dist/module/lib/types.d.ts");
  const client = read("node_modules/@supabase/auth-js/dist/module/GoTrueClient.js");
  const verifyImpl = client.slice(client.indexOf("async _verify(params)"), client.indexOf("async _challenge(params)"));
  ok(
    "SDK_verify_saves_server_session_only",
    /\/factors\/\$\{params\.factorId\}\/verify/.test(verifyImpl) && /this\._saveSession\(/.test(verifyImpl) &&
      /MFA_CHALLENGE_VERIFIED/.test(verifyImpl) && !/amr/i.test(verifyImpl),
  );
  ok(
    "SDK_docs_session_promoted_other_sessions_logged_out",
    types.includes("all other sessions are logged out and the current session's authenticator level is promoted to `aal2`") &&
      types.includes("Timestamp when the method was successfully used"),
  );
  ok(
    "SDK_client_aal_decodes_local_jwt_not_authoritative",
    /_getAuthenticatorAssuranceLevel\(jwt\)[\s\S]{0,400}decodeJWT\(jwt\)/.test(client),
  );
}

// ---- G7F-3B2 "Verify again now" (re-verification without a business mutation) ----
{
  const aal2Status = { claimsVerified: true, aal: "aal2" };
  const offer = (over = {}) =>
    flow.canOfferPrivilegedReverify({
      purpose: "manage",
      privilegedMfaRequired: true,
      verifiedFactorCount: 1,
      status: aal2Status,
      enrolmentPending: false,
      ...over,
    });
  const renderBlock = panelSrc.slice(panelSrc.indexOf("const reverifyOffered"), panelSrc.indexOf("{showCodeForm ? ("));
  const openBtn = panelSrc.slice(panelSrc.lastIndexOf("<Button", panelSrc.indexOf("Verify again now")), panelSrc.indexOf("Verify again now"));
  const submit = panelSrc.slice(panelSrc.indexOf("const submitCode"), panelSrc.indexOf("if (loadError)"));
  const onResultSrc = panelSrc.slice(panelSrc.indexOf("const onResult"), panelSrc.indexOf("const submitCode"));

  ok(
    "REVERIFY_TEST_1_configured_aal2_privileged_sees_control",
    offer() && /\{reverifyOffered && !reverifyActive \? \(/.test(panelSrc) && /Verify again now/.test(panelSrc) &&
      /privilegedMfaRequired: status\?\.privilegedMfaRequired === true/.test(renderBlock) &&
      /verifiedFactorCount: factors\.verified\.length/.test(renderBlock),
  );
  ok(
    "REVERIFY_TEST_2_zero_factor_no_reverify",
    !offer({ verifiedFactorCount: 0 }) && !offer({ privilegedMfaRequired: false }) && !offer({ purpose: "step-up" }) &&
      !offer({ status: { claimsVerified: true, aal: "aal1" } }) && !offer({ status: null }) && !offer({ enrolmentPending: true }),
  );
  {
    const { api } = mockMfa({ factors: [U(FACTOR_U1)], aal: "aal2" });
    const loaded = await flow.loadTotpFactors(api);
    ok("REVERIFY_TEST_3_unverified_only_no_reverify", loaded.ok && !offer({ verifiedFactorCount: loaded.verified.length }));
  }
  const rv = mockMfa({ factors: [V()], aal: "aal2" });
  const rvResult = await flow.completeTotpChallenge(rv.api, { code: SYNTH_CODE, serverConfirm: serverAal2 });
  ok(
    "REVERIFY_TEST_4_reverify_does_not_enrol",
    rvResult.status === "verified_aal2" && !rv.state.calls.some((c) => c.startsWith("enroll")) &&
      !/startTotpEnrolment|beginSetup|enroll\(/.test(openBtn) &&
      /\} else \{\s*await onResult\(await completeTotpChallenge\(api, \{ code: entered, serverConfirm \}\), "verified"\);/.test(submit),
  );
  ok(
    "REVERIFY_TEST_5_challenges_existing_verified_factor",
    rv.state.calls.includes(`challenge:${FACTOR_V}`) && rv.state.calls.includes(`verify:${FACTOR_V}`) &&
      rvResult.factorId === FACTOR_V && rv.state.factors.length === 1 && rv.state.factors[0].status === "verified",
  );
  ok(
    "REVERIFY_TEST_6_code_not_persisted",
    !JSON.stringify(rvResult).includes(SYNTH_CODE) && /setCode\(""\);\s*setReverifying\(true\);/.test(panelSrc) &&
      /setCode\(""\);\s*setReverifying\(false\);/.test(panelSrc) && /const entered = code;\s*setCode\(""\);/.test(submit) &&
      !/localStorage|sessionStorage|console\./.test(panelSrc),
  );
  {
    const { api } = mockMfa({ factors: [V()], aal: "aal2" });
    const clientOnly = await flow.completeTotpChallenge(api, { code: SYNTH_CODE, serverConfirm: serverAal1 });
    const noClaims = await flow.completeTotpChallenge(mockMfa({ factors: [V()], aal: "aal2" }).api, {
      code: SYNTH_CODE,
      serverConfirm: async () => ({ claimsVerified: false, aal: "aal2" }),
    });
    ok(
      "REVERIFY_TEST_7_server_aal2_confirmation_required",
      clientOnly.status === "failed" && clientOnly.stage === "aal2" && noClaims.status === "failed" && noClaims.stage === "aal2",
    );
  }
  resetNet({ so: true });
  const freshStatus = await status(verified({ amr: [{ method: "password", timestamp: NOW - 3600 }, { method: "totp", timestamp: NOW - 42 }] }));
  const staleStatus = await status(verified({ amr: [{ method: "password", timestamp: NOW - 3600 }, { method: "totp", timestamp: NOW - 900 }] }));
  ok(
    "REVERIFY_TEST_8_freshness_from_server_status",
    freshStatus.recentMfaAgeSec >= 42 && freshStatus.recentMfaAgeSec < 55 &&
      flow.describeServerMfaFreshness(freshStatus) === `Last authenticator check: ${freshStatus.recentMfaAgeSec} seconds ago` &&
      flow.describeServerMfaFreshness({ claimsVerified: true, aal: "aal2", recentMfaAgeSec: 42 }) === "Last authenticator check: 42 seconds ago" &&
      staleStatus.recentMfaAgeSec === null && flow.describeServerMfaFreshness(staleStatus) === "Last authenticator check: more than 5 minutes ago" &&
      flow.describeServerMfaFreshness({ claimsVerified: true, aal: "aal2", recentMfaAgeSec: 125 }) === "Last authenticator check: 2 minutes ago" &&
      /describeServerMfaFreshness\(status\)/.test(panelSrc),
  );
  {
    const forged = await status({ claimsVerified: true, userId: UID, aal: "aal2", sessionId: SID, amr: [{ method: "totp", timestamp: NOW }] });
    const unverifiedCtx = await status(pure.unverifiedAuthContext(UID));
    ok(
      "REVERIFY_TEST_9_client_cannot_manufacture_freshness",
      forged.recentMfaAgeSec === null && flow.describeServerMfaFreshness(forged) === null &&
        unverifiedCtx.recentMfaAgeSec === null && flow.describeServerMfaFreshness(unverifiedCtx) === null &&
        flow.describeServerMfaFreshness({ claimsVerified: true, aal: "aal1", recentMfaAgeSec: 5 }) === null &&
        (panelSrc.match(/setStatus\(/g) || []).length === 1 && /setStatus\(serverStatus\)/.test(panelSrc) &&
        !/recentMfaAgeSec/.test(onResultSrc.replace("latest?.recentMfaAgeSec == null", "")) &&
        /wasReverify && latest\?\.recentMfaAgeSec == null/.test(onResultSrc) && /A fresh check has not been recorded\./.test(onResultSrc),
    );
  }
  {
    resetNet({ so: true, adminFactors: [{ id: FACTOR_V, factor_type: "totp", status: "verified", updated_at: new Date(Date.now() - 3600_000).toISOString() }] });
    const freshLogin = await account.recordPrivilegedMfaEventImpl({
      userId: UID,
      event: "verified",
      auth: verified({ amr: [{ method: "password", timestamp: NOW - 3600 }, { method: "totp", timestamp: NOW - 5 }] }),
    });
    const w1 = auditWrites();
    resetNet({ so: true, adminFactors: [{ id: FACTOR_V, factor_type: "totp", status: "verified", updated_at: new Date(Date.now() - 3600_000).toISOString() }] });
    const staleLogin = await account.recordPrivilegedMfaEventImpl({
      userId: UID,
      event: "verified",
      auth: verified({ amr: [{ method: "password", timestamp: NOW - 3600 }, { method: "totp", timestamp: NOW - 900 }] }),
    });
    const w2 = auditWrites();
    ok(
      "REVERIFY_TEST_10_verified_login_existing_path",
      /report\(kind, result\.factorId\)/.test(onResultSrc) && /recordFn = useServerFn\(recordMyPrivilegedMfaEvent\)/.test(panelSrc) &&
        freshLogin.recorded && w1.length === 1 && w1[0].event_type === "MFA_VERIFIED_LOGIN" && w1[0].metadata.authoritative === true &&
        !staleLogin.recorded && staleLogin.reason === "fresh_mfa_missing" && w2.length === 0,
    );
  }
  const panelImports = (read("src/components/platform/PrivilegedMfaPanel.tsx").match(/from "[^"]+"/g) || []).join(" ");
  ok(
    "REVERIFY_TEST_11_no_business_mutation",
    !/platform-admins|platform-tenant-owners|company-provisioning|platform-tenant-entry|break-glass|platform-authority\.functions/.test(panelImports) &&
      !/useStepUpServerFn|runWithPrivilegedStepUp/.test(panelSrc),
  );
  ok(
    "REVERIFY_TEST_12_no_authority_changes",
    net.calls.every(
      (c) =>
        c.method === "GET" ||
        c.path === "/rest/v1/security_audit_events" ||
        c.path.startsWith("/rest/v1/rpc/is_") ||
        c.path === "/rest/v1/rpc/platform_mfa_recovery_authority_state",
    ) &&
      !/platform_roles|tenant_memberships|super_admin_tenant_access/.test(panelSrc + flowSrc),
  );
  ok(
    "REVERIFY_TEST_13_no_factor_removal",
    !rv.state.calls.some((c) => c.startsWith("unenroll")) && !/unenroll|deleteFactor/.test(panelSrc) &&
      !/unenroll/.test(flowSrc.slice(flowSrc.indexOf("export async function completeTotpChallenge"), flowSrc.indexOf("export type RequestStepUp"))),
  );
  {
    resetNet({ so: true });
    const smsAal1 = await status(verified({ aal: "aal1", amr: [{ method: "password", timestamp: NOW - 60 }, { method: "sms", timestamp: NOW - 5 }] }));
    const smsAal2 = await status(verified({ amr: [{ method: "password", timestamp: NOW - 60 }, { method: "sms", timestamp: NOW - 5 }] }));
    ok(
      "REVERIFY_TEST_14_sms_cannot_satisfy_reverify",
      !offer({ status: smsAal1 }) && flow.describeServerMfaFreshness(smsAal1) === null &&
        smsAal2.recentMfaAgeSec === null && flow.describeServerMfaFreshness(smsAal2) === "Last authenticator check: more than 5 minutes ago" &&
        !/isLoginSmsVerified|sendLoginSmsCode|factorType:\s*"phone"/.test(panelSrc + flowSrc),
    );
  }
  ok(
    "REVERIFY_TEST_15_bg_fallback_unchanged",
    git("diff --stat HEAD -- src/components/platform/PlatformShell.tsx src/components/platform/PrivilegedStepUp.tsx src/lib/break-glass.server.ts src/lib/break-glass.functions.ts").trim() === "" &&
      /There is no SMS, email or bypass/.test(panelSrc),
  );
  ok(
    "REVERIFY_TEST_16_disabled_enforcement_unchanged",
    git("diff --stat HEAD -- .github src/lib/auth-mfa-config.ts src/lib/privileged-mfa.server.ts src/lib/privileged-mfa.ts src/lib/privileged-mfa-account.server.ts src/lib/privileged-mfa-status.functions.ts supabase").trim() === "" &&
      (await status(verified({ aal: "aal1" }))).continuationBlocked === false && !/PRIVILEGED_MFA_MODE/.test(panelSrc + flowSrc),
  );
  ok(
    "REVERIFY_TEST_17_group_external_boundary_unchanged",
    git("diff --stat HEAD -- src/lib/platform-authority.ts src/lib/platform-tenant-entry.server.ts src/lib/platform-tenant-entry.functions.ts").trim() === "",
  );
}

// ---- 29-32 side effects of this harness ----
const nonGetAuth = net.calls.filter((c) => c.path.startsWith("/auth/v1") && c.method !== "GET");
const allPaths = net.calls.map((c) => `${c.method} ${c.path}`);
ok(
  "TEST_29_no_real_factor_created",
  nonGetAuth.length === 0 && net.calls.every((c) => new URL(`http://${FAKE_HOST}${c.path}`).hostname === FAKE_HOST) &&
    /admin\.mfa\.listFactors\(/.test(accountSrc) && !/admin\.mfa\.(deleteFactor|enroll)/.test(accountSrc),
);
ok(
  "TEST_30_no_auth_user_changed",
  nonGetAuth.length === 0 && !/updateUserById|createUser|deleteUser|inviteUserByEmail|signUp\(|updateUser\(/.test(newB1.join("\n")),
);
ok(
  "TEST_31_no_membership_created",
  !allPaths.some((p) => /membership/.test(p)) && !/membership/i.test(accountSrc + statusFnSrc + flowSrc),
);
ok(
  "TEST_32_no_owner_authority_created",
  !allPaths.some((p) => /platform_roles|tenant_owner|owner|grant/.test(p) && !/rpc\/is_super_(owner|admin)/.test(p)) &&
    allPaths.filter((p) => p.startsWith("POST ") && !/rpc\/is_|rpc\/platform_mfa_recovery_authority_state$|security_audit_events/.test(p)).length === 0,
);

globalThis.fetch = realFetch;
for (const k of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) delete process.env[k];

console.log(`\n${failures.length === 0 ? "ALL PASS" : `${failures.length} FAILED: ${failures.join(", ")}`}`);
process.exit(failures.length === 0 ? 0 : 1);
