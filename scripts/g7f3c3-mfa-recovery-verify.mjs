/**
 * G7F-3C3 privileged MFA recovery — unit + static verification.
 * Fetch stub bound to a non-routable host: no real factor, no Auth change, no network, no secrets,
 * no production. Synthetic grants only exist in this process and are never printed.
 * Run: npm exec --yes --package=tsx -- tsx scripts/g7f3c3-mfa-recovery-verify.mjs
 */
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

for (const k of ["SUPABASE_URL", "VITE_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "APP_ENV", "VITE_APP_ENV"]) delete process.env[k];
for (const k of ["PRIVILEGED_MFA_MODE", "MFA_RECOVERY_COOLING_OFF_MINUTES", "COMMUNICATION_DELIVERY_MODE", "WEBSITE_SITE_NAME", "WEBSITE_HOSTNAME"]) {
  delete process.env[k];
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];
let total = 0;
function ok(name, cond, detail = "") {
  total += 1;
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

const FAKE_HOST = "g7f3c3.invalid";
process.env.SUPABASE_URL = `http://${FAKE_HOST}`;
process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_secret_g7f3c3_not_a_real_key";

const UID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const TARGET = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff";
const SID = "11111111-2222-4333-8444-555555555555";
const REQ = "cccccccc-dddd-4eee-8fff-000000000001";

const net = { locked: false, so: false, sa: false, bg: false, rpcError: null, rpcResult: {}, calls: [] };
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === "string" ? input : input.url ?? String(input));
  if (url.hostname !== FAKE_HOST) throw new Error(`G7F3C3 fetch stub refused host ${url.hostname}`);
  const method = String(init.method || (typeof input === "object" && input.method) || "GET").toUpperCase();
  let body = null;
  try {
    body = init.body ? JSON.parse(String(init.body)) : null;
  } catch {
    body = String(init.body);
  }
  net.calls.push({ method, path: url.pathname, search: url.search, body, raw: init.body ? String(init.body) : "" });
  const json = (v, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } });
  const p = url.pathname;
  if (p === "/rest/v1/rpc/is_platform_mfa_recovery_locked") {
    return net.rpcError === "lock" ? json({ message: "boom", code: "XX000" }, 500) : json(net.locked);
  }
  if (p === "/rest/v1/rpc/platform_mfa_recovery_authority_state") {
    if (net.rpcError === "lock") return json({ message: "boom", code: "XX000" }, 500);
    return json(net.authState ?? (net.locked ? "locked" : net.stale ? "stale_auth_context" : "ok"));
  }
  if (p === "/rest/v1/rpc/is_super_owner") return json(net.so);
  if (p === "/rest/v1/rpc/is_super_admin") return json(net.sa);
  if (p === "/rest/v1/rpc/is_active_break_glass") return json(net.bg);
  if (p.startsWith("/rest/v1/platform_break_glass_identities")) return json(net.bg ? [{ user_id: UID, active: true }] : []);
  if (p === "/rest/v1/security_audit_events" && method === "POST") return new Response(null, { status: 201 });
  if (p === "/rest/v1/security_audit_events" && method === "GET") return json([]);
  if (p === "/rest/v1/platform_roles") return json([{ user_id: UID }, { user_id: TARGET }]);
  if (p === "/rest/v1/platform_mfa_recovery_requests") return json({ target_user_id: TARGET });
  if (p.startsWith("/rest/v1/rpc/")) {
    const name = p.slice("/rest/v1/rpc/".length);
    if (net.rpcError === name) return json({ message: "boom", code: "XX000" }, 500);
    return json(net.rpcResult[name] ?? { ok: true });
  }
  return json({ message: "unexpected" }, 500);
};

function resetNet(over = {}) {
  Object.assign(
    net,
    { locked: false, stale: false, authState: undefined, so: false, sa: false, bg: false, rpcError: null, rpcResult: {}, calls: [] },
    over,
  );
}
const rpcCalls = (name) => net.calls.filter((c) => c.path === `/rest/v1/rpc/${name}`);
const auditWrites = () => net.calls.filter((c) => c.path === "/rest/v1/security_audit_events" && c.method === "POST");

const pure = await import("../src/lib/privileged-mfa.ts");
const rec = await import("../src/lib/privileged-mfa-recovery.ts");
const server = await import("../src/lib/privileged-mfa-recovery.server.ts");
const mfaServer = await import("../src/lib/privileged-mfa.server.ts");
const authorityServer = await import("../src/lib/platform-authority.server.ts");
const postAuth = await import("../src/lib/post-auth-destination.ts");
const external = await import("../src/lib/external-action.server.ts");

const NOW = Math.floor(Date.now() / 1000);
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
const fresh = () => verified();
const stale = () => verified({ amr: [{ method: "password", timestamp: NOW - 3600 }, { method: "totp", timestamp: NOW - 400 }] });
const aal1 = () => verified({ aal: "aal1", amr: [{ method: "password", timestamp: NOW - 30 }] });
const noSession = () => verified({ session_id: undefined });
const otherUser = () => verified({ sub: TARGET });
const unverified = () => pure.unverifiedAuthContext(UID);
const plainObject = () => ({ claimsVerified: true, userId: UID, aal: "aal2", sessionId: SID, amr: [{ method: "totp", timestamp: NOW }] });
const MODES = ["disabled", "audit", "enforce"];

async function withMode(mode, fn) {
  if (mode === undefined) delete process.env.PRIVILEGED_MFA_MODE;
  else process.env.PRIVILEGED_MFA_MODE = mode;
  try {
    return await fn();
  } finally {
    delete process.env.PRIVILEGED_MFA_MODE;
  }
}
async function rejects(fn) {
  try {
    await fn();
    return null;
  } catch (e) {
    return e;
  }
}

const logs = [];
const realConsole = { log: console.log, info: console.info, warn: console.warn, error: console.error, debug: console.debug };
function captureConsole() {
  logs.length = 0;
  for (const k of ["info", "warn", "debug"]) console[k] = (...a) => logs.push(a.map(String).join(" "));
  console.error = (...a) => {
    const line = a.map(String).join(" ");
    if (line.startsWith("FAIL  ")) realConsole.error(...a);
    else logs.push(line);
  };
}
function restoreConsole() {
  Object.assign(console, realConsole);
}

// ------------------------------------------------------------------------------------------
// 1. Grant format, entropy, normalisation, hashing
// ------------------------------------------------------------------------------------------
const zero = rec.formatRecoveryGrant(new Uint8Array(20));
const ff = rec.formatRecoveryGrant(new Uint8Array(20).fill(0xff));
ok("GRANT_1_format_32_chars_grouped", /^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){7}$/.test(ff) && zero === "0000-0000-0000-0000-0000-0000-0000-0000" && ff === "ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ");
ok(
  "GRANT_2_entropy_160_bits",
  rec.MFA_RECOVERY_GRANT_BYTES * 8 === 160 && rec.MFA_RECOVERY_GRANT_CHARS * 5 === 160 && rec.MFA_RECOVERY_GRANT_ALPHABET.length === 32 &&
    new Set(rec.MFA_RECOVERY_GRANT_ALPHABET).size === 32 && !/[ILOU]/.test(rec.MFA_RECOVERY_GRANT_ALPHABET),
);
ok(
  "GRANT_3_wrong_entropy_length_refused",
  (() => {
    try {
      rec.formatRecoveryGrant(new Uint8Array(16));
      return false;
    } catch {
      return true;
    }
  })(),
);
const generated = Array.from({ length: 2000 }, () => server.generateRecoveryGrant());
ok(
  "GRANT_4_generated_unique_and_well_formed",
  new Set(generated.map((g) => g.grant)).size === 2000 && new Set(generated.map((g) => g.hash)).size === 2000 &&
    generated.every((g) => /^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){7}$/.test(g.grant) && /^[0-9a-f]{64}$/.test(g.hash)),
);
const charCounts = new Map();
for (const g of generated) for (const ch of g.grant.replace(/-/g, "")) charCounts.set(ch, (charCounts.get(ch) ?? 0) + 1);
const expected = (2000 * 32) / 32;
ok(
  "GRANT_5_character_distribution_uniform",
  charCounts.size === 32 && [...charCounts.values()].every((n) => n > expected * 0.8 && n < expected * 1.2),
);
const sample = generated[0];
const canonical = sample.grant.replace(/-/g, "");
const typed = ` ${canonical.toLowerCase().replace(/0/g, "o").replace(/1/g, "l").match(/.{1,4}/g).join(" ")} `;
ok(
  "GRANT_6_normalise_tolerates_typing",
  rec.normaliseRecoveryGrant(sample.grant) === canonical && rec.normaliseRecoveryGrant(typed) === canonical &&
    server.hashRecoveryGrant(typed) === sample.hash && server.hashRecoveryGrant(sample.grant.replace(/-/g, "")) === sample.hash,
);
ok(
  "GRANT_7_normalise_rejects_invalid",
  [null, undefined, 42, {}, "", "ABC", canonical.slice(0, 31), canonical + "0", canonical.slice(0, 31) + "U", canonical.slice(0, 31) + "!", "0".repeat(81)].every(
    (v) => rec.normaliseRecoveryGrant(v) === null && server.hashRecoveryGrant(v) === null,
  ),
);
ok(
  "GRANT_8_hash_domain_separated",
  sample.hash === createHash("sha256").update(`mh-mfa-recovery-grant:v1:${canonical}`, "utf8").digest("hex") &&
    sample.hash !== createHash("sha256").update(canonical, "utf8").digest("hex") &&
    sample.hash !== createHash("sha256").update(sample.grant, "utf8").digest("hex"),
);
generated.length = 0;

// ------------------------------------------------------------------------------------------
// 2. Cooling-off resolver
// ------------------------------------------------------------------------------------------
const co = (appEnv, raw) => rec.resolveMfaRecoveryCoolingOffMinutes({ appEnv, raw });
ok("COOL_1_production_default_60", co("production") === 60 && co("production", "") === 60 && co("production", "junk") === 60);
ok("COOL_2_production_never_inherits_staging_15", co("production", "15") === 60 && co("production", "0") === 60 && co("production", "59") === 60);
ok("COOL_3_production_configurable_upward", co("production", "90") === 90 && co("production", "1440") === 1440);
ok("COOL_4_staging_default_15_floor_15", co("staging") === 15 && co("staging", "5") === 15 && co("staging", "30") === 30 && co("development") === 15);
ok("COOL_5_unknown_env_fails_to_production_values", co("unknown") === 60 && co(null) === 60 && co("", "15") === 60 && co("qa", "15") === 60);
ok("COOL_6_capped_and_parsing_strict", co("staging", "99999999") === 15 && co("staging", "999999") === 10080 && co("staging", "-20") === 15 && co("staging", "20.5") === 15);
process.env.APP_ENV = "production";
const prodMinutes = await server.mfaRecoveryCoolingOffMinutes();
process.env.MFA_RECOVERY_COOLING_OFF_MINUTES = "15";
const prodWithStagingValue = await server.mfaRecoveryCoolingOffMinutes();
process.env.APP_ENV = "staging";
const stagingMinutes = await server.mfaRecoveryCoolingOffMinutes();
delete process.env.MFA_RECOVERY_COOLING_OFF_MINUTES;
process.env.APP_ENV = "nonsense";
const unknownMinutes = await server.mfaRecoveryCoolingOffMinutes();
delete process.env.APP_ENV;
ok("COOL_7_server_uses_app_environment", prodMinutes === 60 && prodWithStagingValue === 60 && stagingMinutes === 15 && unknownMinutes === 60);

// ------------------------------------------------------------------------------------------
// 3. Denial message map covers every database reason
// ------------------------------------------------------------------------------------------
const migrationName = readdirSync(resolve(root, "supabase/migrations")).find((f) => f.endsWith("_gate_g7f3c3_privileged_mfa_recovery.sql"));
const migration = migrationName ? read(`supabase/migrations/${migrationName}`) : "";
const dbReasons = new Set([...migration.matchAll(/g7f3c3_deny\('\w+',\s*'([a-z_]+)'/g)].map((m) => m[1]));
for (const m of migration.matchAll(/RETURN '((?:session|aal|fresh)_[a-z_]+)'/g)) dbReasons.add(m[1]);
const missing = [...dbReasons].filter((r) => !rec.MFA_RECOVERY_DENIAL_MESSAGES[r]);
ok("DENY_1_every_db_reason_has_message", dbReasons.size >= 40 && missing.length === 0, `${dbReasons.size} reasons${missing.length ? `; missing ${missing.join(",")}` : ""}`);
ok(
  "DENY_2_session_reasons_mapped",
  ["session_missing", "session_user_mismatch", "session_expired", "aal_insufficient", "fresh_mfa_missing", "fresh_mfa_stale"].every(
    (r) => dbReasons.has(r) && rec.mfaRecoveryDenialMessage(r) !== rec.MFA_RECOVERY_DENIAL_FALLBACK,
  ),
);
ok("DENY_3_unknown_reason_generic", rec.mfaRecoveryDenialMessage("xyz") === rec.MFA_RECOVERY_DENIAL_FALLBACK && rec.mfaRecoveryDenialMessage(null) === rec.MFA_RECOVERY_DENIAL_FALLBACK);
ok("DENY_4_five_attempt_limit_matches_db", /v_attempts >= 5/.test(migration) && /five incorrect attempts/.test(rec.MFA_RECOVERY_DENIAL_MESSAGES.grant_mismatch));
ok("DENY_5_migration_version_matches_staging", migrationName === "20260928152546_gate_g7f3c3_privileged_mfa_recovery.sql");

// ------------------------------------------------------------------------------------------
// 4. Operator fresh-TOTP gate: denies in every PRIVILEGED_MFA_MODE
// ------------------------------------------------------------------------------------------
const CHECK = { action: pure.PRIVILEGED_MFA_ACTIONS.mfaRecoveryExecute, userId: UID };
ok("FRESH_1_window_is_5_minutes", pure.PRIVILEGED_FRESH_AUTH_MAX_AGE_SEC.mfaRecovery === 300);
const badContexts = { aal1, stale, noSession, otherUser, unverified, plainObject, missing: () => null };
for (const mode of [undefined, ...MODES]) {
  const outcomes = {};
  for (const [name, mk] of Object.entries(badContexts)) {
    resetNet();
    const err = await withMode(mode, () => rejects(() => mfaServer.requireRecoveryFreshAuth(mk(), CHECK)));
    outcomes[name] = err instanceof mfaServer.PrivilegedMfaRequiredError;
  }
  resetNet();
  const good = await withMode(mode, () => mfaServer.requireRecoveryFreshAuth(fresh(), CHECK));
  ok(
    `FRESH_2_${mode ?? "default"}_denies_all_insufficient_contexts`,
    Object.values(outcomes).every(Boolean) && good.sessionId === SID && good.userId === UID,
    Object.entries(outcomes).filter(([, v]) => !v).map(([k]) => k).join(",") || "7 denied, fresh allowed",
  );
}
resetNet();
await withMode("audit", () => rejects(() => mfaServer.requireRecoveryFreshAuth(stale(), CHECK)));
const auditBodies = auditWrites().map((c) => c.body);
ok(
  "FRESH_3_audit_mode_records_reauth_required",
  auditBodies.some((b) => b?.event_type === "PRIVILEGED_REAUTH_REQUIRED" && b?.metadata?.action === "platform.mfa_recovery_execute"),
);

// ------------------------------------------------------------------------------------------
// 5. Operator actions: no RPC without fresh TOTP; hash only; grant returned once, never leaked
// ------------------------------------------------------------------------------------------
const operatorImpls = {
  request: (auth) => server.requestMfaRecoveryImpl({ userId: UID, targetUserId: TARGET, reason: "Lost phone, verified by video call", auth }),
  approve: (auth) => server.approveMfaRecoveryImpl({ userId: UID, requestId: REQ, auth }),
  execute: (auth) => server.executeMfaRecoveryImpl({ userId: UID, requestId: REQ, auth }),
  reissue: (auth) => server.reissueMfaRecoveryGrantImpl({ userId: UID, requestId: REQ, auth }),
  cancel: (auth) => server.cancelMfaRecoveryImpl({ userId: UID, requestId: REQ, auth }),
};
for (const mode of MODES) {
  const leaked = [];
  for (const [name, impl] of Object.entries(operatorImpls)) {
    for (const mk of [stale, aal1, unverified]) {
      resetNet();
      const err = await withMode(mode, () => rejects(() => impl(mk())));
      if (!(err instanceof mfaServer.PrivilegedMfaRequiredError) || net.calls.some((c) => c.path.includes("_platform_mfa_recovery"))) leaked.push(`${name}/${mk.name}`);
    }
  }
  ok(`OP_1_${mode}_stale_or_aal1_never_reaches_rpc`, leaked.length === 0, leaked.join(",") || "15 denied before RPC");
}

process.env.APP_ENV = "staging";
resetNet({ rpcResult: { request_platform_mfa_recovery: { ok: true, request_id: REQ, target_kind: "normal_so", cooling_off_until: "2026-09-28T16:00:00Z", expires_at: "2026-09-28T17:00:00Z", requires_second_approval: false } } });
const reqRes = await withMode("disabled", () => operatorImpls.request(fresh()));
const reqBody = rpcCalls("request_platform_mfa_recovery")[0]?.body ?? {};
ok(
  "OP_2_request_passes_session_mode_cooling_off",
  reqRes.requestId === REQ && reqBody.p_actor_user_id === UID && reqBody.p_actor_session_id === SID && reqBody.p_target_user_id === TARGET &&
    reqBody.p_cooling_off_minutes === 15 && reqBody.p_mode === "disabled",
);
delete process.env.APP_ENV;

resetNet({ rpcResult: { execute_platform_mfa_recovery: { ok: true, target_user_id: TARGET, grant_expires_at: "2026-09-28T16:30:00Z", recovery_expires_at: "2026-09-29T16:00:00Z" } } });
external.clearCommunicationCaptures();
captureConsole();
let issued;
try {
  issued = await withMode("enforce", () => operatorImpls.execute(fresh()));
} finally {
  restoreConsole();
}
const execCall = rpcCalls("execute_platform_mfa_recovery")[0];
const issuedCanonical = rec.normaliseRecoveryGrant(issued?.grant);
const everything = net.calls.map((c) => c.raw + c.search).join("\n") + JSON.stringify(external.getCommunicationCaptures()) + logs.join("\n");
ok(
  "OP_3_execute_sends_hash_only",
  Boolean(issuedCanonical) && execCall?.body?.p_grant_hash === server.hashRecoveryGrant(issued.grant) && execCall.body.p_actor_session_id === SID &&
    execCall.body.p_mode === "enforce" && !Object.keys(execCall.body).some((k) => /grant$/.test(k) && k !== "p_grant_hash"),
);
ok(
  "OP_4_grant_never_leaves_process",
  Boolean(issuedCanonical) && !everything.includes(issued.grant) && !everything.includes(issuedCanonical) && !everything.includes(issuedCanonical.toLowerCase()),
  `${net.calls.length} requests, ${logs.length} log lines, ${external.getCommunicationCaptures().length} captures scanned`,
);
const notify = auditWrites().map((c) => c.body).find((b) => b?.event_type === "MFA_RECOVERY_NOTIFICATION_RECORDED");
ok(
  "OP_5_notification_audited_without_grant_or_sms",
  notify?.metadata?.transition === "executed" && notify.metadata.channel === "email" && notify.metadata.recipient_count === 2 &&
    !JSON.stringify(notify).includes(execCall?.body?.p_grant_hash ?? "none") &&
    external.getCommunicationCaptures().every((c) => c.service === "email"),
);
ok("OP_6_execute_returns_grant_once_shape", issued?.targetUserId === TARGET && issued.grantExpiresAt === "2026-09-28T16:30:00Z" && issued.requestId === REQ);
issued = null;

resetNet({ rpcResult: { reissue_platform_mfa_recovery_grant: { ok: true, target_user_id: TARGET, grant_expires_at: "x", recovery_expires_at: null } } });
const re1 = await operatorImpls.reissue(fresh());
resetNet({ rpcResult: { reissue_platform_mfa_recovery_grant: { ok: true, target_user_id: TARGET, grant_expires_at: "x", recovery_expires_at: null } } });
const re2 = await operatorImpls.reissue(fresh());
ok("OP_7_reissue_fresh_grant_each_time", re1.grant !== re2.grant && rpcCalls("reissue_platform_mfa_recovery_grant")[0].body.p_grant_hash === server.hashRecoveryGrant(re2.grant));

resetNet({ rpcResult: { execute_platform_mfa_recovery: { ok: false, reason: "cooling_off_active" } } });
const deniedErr = await rejects(() => operatorImpls.execute(fresh()));
ok(
  "OP_8_db_denial_maps_to_message_no_grant",
  deniedErr instanceof server.MfaRecoveryDeniedError && deniedErr.reason === "cooling_off_active" &&
    deniedErr.message === rec.MFA_RECOVERY_DENIAL_MESSAGES.cooling_off_active && !auditWrites().some((c) => c.body?.event_type === "MFA_RECOVERY_NOTIFICATION_RECORDED"),
);
resetNet({ rpcError: "execute_platform_mfa_recovery" });
captureConsole();
let rpcErr;
try {
  rpcErr = await rejects(() => operatorImpls.execute(fresh()));
} finally {
  restoreConsole();
}
ok(
  "OP_9_rpc_error_generic_and_logs_no_detail",
  rpcErr instanceof Error && !(rpcErr instanceof server.MfaRecoveryDeniedError) && !/boom|XX000/.test(rpcErr.message) &&
    logs.every((l) => !/boom|p_grant_hash|[0-9a-f]{64}/.test(l)),
);
resetNet({ rpcResult: { request_platform_mfa_recovery: { ok: true, request_id: REQ }, cancel_platform_mfa_recovery: { ok: true } } });
net.calls.length = 0;
const origFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const u = new URL(typeof input === "string" ? input : input.url ?? String(input));
  if (u.pathname === "/rest/v1/security_audit_events") return new Response(JSON.stringify({ message: "down" }), { status: 500 });
  return origFetch(input, init);
};
const notifyFailure = await rejects(() => operatorImpls.cancel(fresh()));
globalThis.fetch = origFetch;
ok("OP_10_notification_failure_never_blocks_transition", notifyFailure === null);

// ------------------------------------------------------------------------------------------
// 6. Target actions
// ------------------------------------------------------------------------------------------
resetNet({ rpcResult: { redeem_platform_mfa_recovery_grant: { ok: true, request_id: REQ } } });
const targetGrant = server.generateRecoveryGrant();
const redeemOk = await withMode("disabled", () =>
  server.redeemMyMfaRecoveryGrantImpl({ userId: UID, grant: targetGrant.grant.toLowerCase(), auth: aal1() }),
);
const redeemCall = rpcCalls("redeem_platform_mfa_recovery_grant")[0];
ok(
  "TGT_1_redeem_aal1_sends_hash_and_session",
  redeemOk.requestId === REQ && redeemCall?.body?.p_grant_hash === targetGrant.hash && redeemCall.body.p_session_id === SID &&
    !redeemCall.raw.includes(rec.normaliseRecoveryGrant(targetGrant.grant)),
);
resetNet({ rpcResult: { redeem_platform_mfa_recovery_grant: { ok: false, reason: "grant_mismatch" } } });
const badGrantErr = await rejects(() => server.redeemMyMfaRecoveryGrantImpl({ userId: UID, grant: "not a grant", auth: aal1() }));
ok(
  "TGT_2_malformed_grant_sent_as_null_db_denies",
  badGrantErr instanceof server.MfaRecoveryDeniedError && rpcCalls("redeem_platform_mfa_recovery_grant")[0]?.body?.p_grant_hash === null,
);
const redeemDenials = [];
for (const mk of [unverified, noSession, otherUser, plainObject]) {
  resetNet();
  const err = await rejects(() => server.redeemMyMfaRecoveryGrantImpl({ userId: UID, grant: targetGrant.grant, auth: mk() }));
  redeemDenials.push(err instanceof mfaServer.PrivilegedMfaRequiredError && rpcCalls("redeem_platform_mfa_recovery_grant").length === 0);
}
ok("TGT_3_redeem_requires_verified_own_session", redeemDenials.every(Boolean));

for (const mode of MODES) {
  const res = [];
  for (const mk of [stale, aal1, unverified, noSession, otherUser]) {
    resetNet();
    const err = await withMode(mode, () => rejects(() => server.completeMyMfaRecoveryImpl({ userId: UID, auth: mk() })));
    res.push(err instanceof mfaServer.PrivilegedMfaRequiredError && rpcCalls("complete_platform_mfa_recovery").length === 0);
  }
  ok(`TGT_4_${mode}_complete_requires_fresh_aal2`, res.every(Boolean));
}
resetNet({ rpcResult: { complete_platform_mfa_recovery: { ok: true, request_id: REQ } } });
const completed = await withMode("disabled", () => server.completeMyMfaRecoveryImpl({ userId: UID, auth: fresh() }));
ok(
  "TGT_5_complete_fresh_passes_session",
  completed.requestId === REQ && rpcCalls("complete_platform_mfa_recovery")[0]?.body?.p_session_id === SID &&
    auditWrites().some((c) => c.body?.event_type === "MFA_RECOVERY_NOTIFICATION_RECORDED" && c.body.metadata.transition === "completed"),
);
resetNet({
  rpcResult: {
    get_platform_mfa_recovery_self_state: {
      locked: true,
      request_id: REQ,
      status: "executed_awaiting_enrolment",
      target_kind: "normal_so",
      grant_usable: true,
      grant_redeemed: false,
      redeemed_by_this_session: false,
      grant_hash: "a".repeat(64),
      pending_requests: [],
    },
  },
});
const self = await server.getMyMfaRecoveryStateImpl({ userId: UID, auth: aal1() });
ok(
  "TGT_6_self_state_verified_only_and_no_hash",
  self.locked && self.status === "executed_awaiting_enrolment" && self.grantUsable && !("grant_hash" in self) && !JSON.stringify(self).includes("a".repeat(64)) &&
    rpcCalls("get_platform_mfa_recovery_self_state")[0]?.body?.p_session_id === SID,
);
resetNet();
const selfUnverified = await rejects(() => server.getMyMfaRecoveryStateImpl({ userId: UID, auth: unverified() }));
const selfOther = await rejects(() => server.getMyMfaRecoveryStateImpl({ userId: UID, auth: otherUser() }));
ok("TGT_7_self_state_denies_unverified_or_other_user", selfUnverified instanceof mfaServer.PrivilegedMfaRequiredError && selfOther instanceof mfaServer.PrivilegedMfaRequiredError && net.calls.length === 0);

// ------------------------------------------------------------------------------------------
// 7. Recovery lock suspends all platform authority, independent of mode and token
// ------------------------------------------------------------------------------------------
for (const mode of [undefined, ...MODES]) {
  resetNet({ locked: true, so: true, sa: true, bg: true });
  const view = await withMode(mode, () => authorityServer.resolvePlatformAuthority(UID));
  const soErr = await withMode(mode, () => rejects(() => authorityServer.requireSuperOwner(UID)));
  const routeErr = await withMode(mode, () => rejects(() => authorityServer.requirePlatformRouteAccess(UID)));
  ok(
    `LOCK_1_${mode ?? "default"}_locked_user_has_no_authority`,
    view.mfaRecoveryRequired === true && !view.canAccessPlatform && !view.isSuperOwner && !view.isSuperAdmin && !view.isBreakGlass &&
      !view.canListPlatformTenants && !view.canCreateCompany && soErr instanceof authorityServer.PlatformRouteDeniedError &&
      routeErr instanceof authorityServer.PlatformRouteDeniedError && rpcCalls("is_super_owner").length === 0,
  );
}
resetNet({ so: true, rpcError: "lock" });
const lockErrView = await authorityServer.resolvePlatformAuthority(UID);
ok("LOCK_2_lock_lookup_error_fails_closed", !lockErrView.canAccessPlatform && !lockErrView.isSuperOwner && rpcCalls("is_super_owner").length === 0);
resetNet({ so: true });
const unlockedView = await authorityServer.resolvePlatformAuthority(UID);
ok("LOCK_3_unlocked_super_owner_unchanged", unlockedView.isSuperOwner && unlockedView.canAccessPlatform && unlockedView.mfaRecoveryRequired !== true);
resetNet({ locked: true, so: true });
const lockedList = await rejects(() => server.listMfaRecoveryRequestsImpl({ userId: UID }));
const lockedCandidates = await rejects(() => server.listMfaRecoveryCandidatesImpl({ userId: UID }));
ok(
  "LOCK_4_locked_user_cannot_view_operator_data",
  lockedList instanceof authorityServer.PlatformRouteDeniedError && lockedCandidates instanceof authorityServer.PlatformRouteDeniedError &&
    !net.calls.some((c) => c.path === "/rest/v1/platform_mfa_recovery_requests" || c.path === "/rest/v1/platform_roles"),
);
ok(
  "LOCK_5_db_lock_in_is_super_functions",
  /CREATE OR REPLACE FUNCTION public\.is_super_owner[\s\S]{0,1200}?NOT public\.is_platform_mfa_recovery_locked/.test(migration) &&
    /CREATE OR REPLACE FUNCTION public\.is_super_admin[\s\S]{0,1200}?NOT public\.is_platform_mfa_recovery_locked/.test(migration),
);
ok(
  "LOCK_6_lock_resolved_by_user_id_and_verified_context",
  /platform_mfa_recovery_authority_state", \{\s*p_user_id: userId,\s*p_session_id: own\?\.sessionId \?\? null,\s*p_iat: own\?\.issuedAt \?\? null,/.test(
    code("src/lib/platform-authority.server.ts"),
  ),
);

// ------------------------------------------------------------------------------------------
// 7b. G7F-3C3A: pre-recovery authentication contexts never regain authority
// ------------------------------------------------------------------------------------------
const { runWithRequestAuthAssurance } = await import("../src/lib/request-auth-context.server.ts");
const stateCalls = () => rpcCalls("platform_mfa_recovery_authority_state");
for (const mode of [undefined, ...MODES]) {
  resetNet({ stale: true, so: true, sa: true, bg: true });
  const view = await withMode(mode, () => runWithRequestAuthAssurance(fresh(), () => authorityServer.resolvePlatformAuthority(UID)));
  const soErr = await withMode(mode, () => runWithRequestAuthAssurance(fresh(), () => rejects(() => authorityServer.requireSuperOwner(UID))));
  const routeErr = await withMode(mode, () =>
    runWithRequestAuthAssurance(fresh(), () => rejects(() => authorityServer.requirePlatformRouteAccess(UID))),
  );
  ok(
    `BND_1_${mode ?? "default"}_stale_context_has_no_authority`,
    !view.canAccessPlatform && !view.isSuperOwner && !view.isSuperAdmin && !view.isBreakGlass && view.mfaRecoveryRequired !== true &&
      soErr instanceof authorityServer.PlatformRouteDeniedError && routeErr instanceof authorityServer.PlatformRouteDeniedError &&
      rpcCalls("is_super_owner").length === 0 && rpcCalls("is_super_admin").length === 0,
  );
}
resetNet({ so: true });
const ownView = await runWithRequestAuthAssurance(fresh(), () => authorityServer.resolvePlatformAuthority(UID));
ok(
  "BND_2_own_verified_session_and_iat_sent",
  ownView.isSuperOwner && stateCalls().length === 1 && stateCalls()[0].body?.p_user_id === UID &&
    stateCalls()[0].body?.p_session_id === SID && stateCalls()[0].body?.p_iat === NOW - 30,
);
const sentNulls = async (ctx) => {
  resetNet({ so: true });
  await runWithRequestAuthAssurance(ctx, () => authorityServer.resolvePlatformAuthority(UID));
  const b = stateCalls()[0]?.body ?? {};
  return stateCalls().length === 1 && b.p_session_id === null && b.p_iat === null;
};
ok(
  "BND_3_foreign_unverified_or_missing_context_sends_no_evidence",
  (await sentNulls(otherUser())) && (await sentNulls(unverified())) && (await sentNulls(plainObject())) &&
    (await (async () => {
      resetNet({ so: true });
      await authorityServer.resolvePlatformAuthority(UID);
      const b = stateCalls()[0]?.body ?? {};
      return b.p_session_id === null && b.p_iat === null;
    })()),
);
resetNet({ stale: true });
const mwStale = await rejects(() => authorityServer.assertAuthContextNotSuperseded(fresh()));
const mwStaleBody = stateCalls()[0]?.body ?? {};
resetNet();
const mwOk = await rejects(() => authorityServer.assertAuthContextNotSuperseded(fresh()));
resetNet({ locked: true });
const mwLocked = await rejects(() => authorityServer.assertAuthContextNotSuperseded(fresh()));
resetNet({ rpcError: "lock" });
const mwErr = await rejects(() => authorityServer.assertAuthContextNotSuperseded(fresh()));
resetNet({ authState: "surprise" });
const mwOdd = await rejects(() => authorityServer.assertAuthContextNotSuperseded(fresh()));
const mwNoUser = await rejects(() => authorityServer.assertAuthContextNotSuperseded(pure.unverifiedAuthContext(null)));
ok(
  "BND_4_middleware_guard_rejects_stale_fails_closed_and_admits_locked",
  mwStale instanceof authorityServer.SupersededAuthContextError && mwStaleBody.p_session_id === SID && mwStaleBody.p_iat === NOW - 30 &&
    mwOk === null && mwLocked === null && mwErr instanceof Error && !(mwErr instanceof authorityServer.SupersededAuthContextError) &&
    mwOdd instanceof Error && mwNoUser instanceof authorityServer.SupersededAuthContextError,
);
resetNet({ authState: "surprise", so: true });
const oddView = await runWithRequestAuthAssurance(fresh(), () => authorityServer.resolvePlatformAuthority(UID));
ok("BND_5_unexpected_state_fails_closed", !oddView.canAccessPlatform && !oddView.isSuperOwner && rpcCalls("is_super_owner").length === 0);
const mwSrc = code("src/integrations/supabase/auth-middleware.ts");
const guardIdx = [...mwSrc.matchAll(/await assertAuthContextNotSuperseded\(authAssurance\);\s*return runWithRequestAuthAssurance\(authAssurance/g)];
ok(
  "BND_6_middleware_guards_verified_and_fallback_contexts_before_handlers",
  guardIdx.length === 2 && (mwSrc.match(/runWithRequestAuthAssurance\(/g) ?? []).length === 2,
);
const boundaryMigrationFile = readdirSync(resolve(root, "supabase/migrations")).find((f) => /_gate_g7f3c3a_recovery_auth_boundary\.sql$/.test(f));
const boundaryMigration = boundaryMigrationFile ? read(`supabase/migrations/${boundaryMigrationFile}`) : "";
ok(
  "BND_7_db_boundary_in_root_helpers_and_session_iat_checks",
  /CREATE OR REPLACE FUNCTION public\.is_super_owner[\s\S]{0,600}?NOT public\.is_platform_mfa_recovery_locked\(p_user_id\)\s*AND public\.g7f3c3a_request_context_current\(p_user_id\)/.test(boundaryMigration) &&
    /CREATE OR REPLACE FUNCTION public\.is_super_admin[\s\S]{0,600}?NOT public\.is_platform_mfa_recovery_locked\(p_user_id\)\s*AND public\.g7f3c3a_request_context_current\(p_user_id\)/.test(boundaryMigration) &&
    /s\.id = p_session_id::uuid\s*AND s\.user_id = p_user_id\s*AND s\.created_at >= v_boundary/.test(boundaryMigration) &&
    /p_iat < pg_catalog\.floor\(pg_catalog\.date_part\('epoch', v_boundary\)\)::bigint/.test(boundaryMigration) &&
    /AFTER UPDATE OF grant_issued_at ON public\.platform_mfa_recovery_requests/.test(boundaryMigration),
  boundaryMigrationFile ?? "missing",
);
ok(
  "BND_8_boundary_durable_and_mode_independent",
  /NEW\.boundary_at < OLD\.boundary_at/.test(boundaryMigration) && /REFERENCES auth\.users \(id\) ON DELETE CASCADE/.test(boundaryMigration) &&
    /mfa_recovery_boundary_immutable/.test(boundaryMigration) && !/p_mode|PRIVILEGED_MFA_MODE/.test(boundaryMigration.replace(/--.*$/gm, "")) &&
    /REVOKE ALL ON FUNCTION public\.platform_mfa_recovery_authority_state\(uuid, text, bigint\) FROM PUBLIC, anon, authenticated;/.test(boundaryMigration),
);

const dest = postAuth.resolvePostAuthDestination({ mfaRecoveryRequired: true, canAccessPlatform: true, requestedTenantSlug: "acme", soleMembershipSlug: "acme" });
const destNormal = postAuth.resolvePostAuthDestination({ mfaRecoveryRequired: false, canAccessPlatform: true });
ok("REDIR_1_post_auth_goes_to_recovery_first", dest.to === rec.MFA_RECOVERY_PATH && dest.kind === "platform_mfa_recovery" && destNormal.to === "/platform");
const postAuthServerSrc = code("src/lib/post-auth-destination.server.ts");
ok("REDIR_2_post_auth_server_passes_flag", /mfaRecoveryRequired: platform\.mfaRecoveryRequired === true/.test(postAuthServerSrc) && /!platform\.mfaRecoveryRequired/.test(postAuthServerSrc));
const shellSrc = code("src/components/platform/PlatformShell.tsx");
const gateBody = shellSrc.slice(shellSrc.indexOf("function PlatformAuthenticatedGate"));
const redirectIdx = gateBody.indexOf("mfaRecoveryRequired === true");
const accessIdx = gateBody.search(/canAccessPlatform/);
ok(
  "REDIR_3_shell_redirect_before_access_check",
  redirectIdx > 0 && accessIdx > 0 && redirectIdx < accessIdx && /<MfaRecoveryRequiredRedirect \/>/.test(gateBody) &&
    /navigate\(\{ to: MFA_RECOVERY_PATH, replace: true \}\)/.test(shellSrc),
);

// ------------------------------------------------------------------------------------------
// 8. Static: isolated route, operator controls, hygiene
// ------------------------------------------------------------------------------------------
const routeSrc = code("src/routes/platform_.mfa-recovery.tsx");
const panelSrc = code("src/components/platform/MfaRecoveryAdminPanel.tsx");
const fnSrc = code("src/lib/privileged-mfa-recovery.functions.ts");
const serverSrc = code("src/lib/privileged-mfa-recovery.server.ts");
const pureSrc = code("src/lib/privileged-mfa-recovery.ts");
const securitySrc = code("src/routes/platform/security.tsx");
const routeTree = read("src/routeTree.gen.ts");
const routeImports = [...routeSrc.matchAll(/from "([^"]+)"/g)].map((m) => m[1]);
ok(
  "ROUTE_1_isolated_outside_platform_layout",
  /createFileRoute\("\/platform_\/mfa-recovery"\)/.test(routeSrc) && /ssr: false/.test(routeSrc) &&
    routeImports.every((i) => !/PlatformShell|PlatformLayout|platform-dashboard|platform-tenants|platform-admin|platform-grants|platform-authority|break-glass|tenant/.test(i)) &&
    /PlatformMfaRecoveryRoute[\s\S]{0,200}getParentRoute: \(\) => rootRouteImport/.test(routeTree),
  routeImports.join(", "),
);
ok(
  "ROUTE_2_only_own_recovery_functions",
  /getMyMfaRecoveryState/.test(routeSrc) && /redeemMyMfaRecoveryGrant/.test(routeSrc) && /completeMyMfaRecovery/.test(routeSrc) &&
    !/listMfaRecovery|executeMfaRecovery|approveMfaRecovery|reissueMfaRecoveryGrant|requestMfaRecovery/.test(routeSrc),
);
ok(
  "ROUTE_3_grant_input_not_persisted",
  !/localStorage|sessionStorage|indexedDB|document\.cookie|console\./.test(routeSrc) && /autoComplete="off"/.test(routeSrc) &&
    /const entered = grant;\s*setGrant\(""\)/.test(routeSrc),
);
ok(
  "ROUTE_4_completion_needs_step_up_and_same_session",
  /useStepUpServerFn\(useServerFn\(completeMyMfaRecovery\)\)/.test(routeSrc) && /redeemedByThisSession/.test(routeSrc) &&
    /<PrivilegedMfaPanel purpose="manage"/.test(routeSrc),
);
ok(
  "PANEL_1_all_actions_step_up",
  ["requestMfaRecovery", "approveMfaRecovery", "executeMfaRecovery", "reissueMfaRecoveryGrant", "cancelMfaRecovery"].every((f) =>
    new RegExp(`useStepUpServerFn\\(useServerFn\\(${f}\\)\\)`).test(panelSrc),
  ),
);
ok(
  "PANEL_2_break_glass_cannot_initiate_or_execute",
  /\{!isBreakGlass \? \(\s*<div[\s\S]{0,200}Start a recovery/.test(panelSrc) &&
    /\(row\.status === "requested" \|\| row\.status === "approved"\) && !isBreakGlass/.test(panelSrc) &&
    /row\.status === "executed_awaiting_enrolment" && !isBreakGlass/.test(panelSrc),
);
ok(
  "PANEL_3_grant_shown_once_in_memory",
  !/localStorage|sessionStorage|indexedDB|document\.cookie|console\.|clipboard/.test(panelSrc) && /setIssued\(null\)/.test(panelSrc) &&
    /useState<\(MfaRecoveryIssuedGrant/.test(panelSrc),
);
ok(
  "PANEL_4_rendered_for_super_owner_only",
  /authority\.isSuperOwner[\s\S]{0,300}<MfaRecoveryAdminPanel isBreakGlass=\{authority\.isBreakGlass\} \/>/.test(securitySrc),
);
const grantReturners = [...fnSrc.matchAll(/export const (\w+)[\s\S]*?(?=export const|$)/g)].filter((m) => /MfaRecoveryIssuedGrant/.test(m[0])).map((m) => m[1]);
ok("FN_1_grant_returned_only_by_execute_reissue", grantReturners.sort().join(",") === "executeMfaRecovery,reissueMfaRecoveryGrant", grantReturners.join(","));
ok(
  "FN_2_all_functions_authenticated_and_validated",
  (fnSrc.match(/createServerFn\(/g) ?? []).length === 10 && (fnSrc.match(/\.middleware\(\[requireSupabaseAuth\]\)/g) ?? []).length === 10 &&
    (fnSrc.match(/method: "POST"/g) ?? []).length === 7 && /z\.string\(\)\.uuid\(\)/.test(fnSrc) && /grant: z\.string\(\)\.min\(1\)\.max\(80\)/.test(fnSrc),
);
ok(
  "FN_3_no_caller_supplied_identity",
  !/userId: data\.|targetUserId: data\.userId|p_user_id|sessionId: data/.test(fnSrc) && (fnSrc.match(/requireUserId\(context\)/g) ?? []).length === 10,
);
const notifyBody = serverSrc.slice(serverSrc.indexOf("export async function notifyMfaRecoveryTransition"), serverSrc.indexOf("async function operatorFreshAuth"));
ok(
  "HYG_1_notification_never_receives_grant",
  notifyBody.length > 100 && !/grant/i.test(notifyBody) && !/sms|twilio|whatsapp/i.test(serverSrc) &&
    !/notifyMfaRecoveryTransition\(\{[^}]*grant/.test(serverSrc),
);
ok(
  "HYG_2_grant_hash_never_read_back",
  !/grant_hash/.test(serverSrc.match(/REQUEST_COLUMNS =[^;]+;/)?.[0] ?? "grant_hash") && !/select\([^)]*grant_hash/.test(serverSrc) &&
    !/\.select\(\s*["']\*["']/.test(serverSrc),
);
ok(
  "HYG_3_no_grant_logging_or_audit",
  !/console\.\w+\([^)]*grant/i.test(serverSrc) && !/writePlatformAuditEvent\(\{[^}]*grant\b/.test(serverSrc) &&
    (serverSrc.match(/console\./g) ?? []).length === 1 && /console\.error\("mfa_recovery_rpc_failed", name, error\.code \?\? "unknown"\)/.test(serverSrc),
);
ok(
  "HYG_4_db_audits_exclude_grant_hash",
  !/'grant_hash'\s*,\s*(p_grant_hash|v_hash|r\.grant_hash)/.test(migration) && /REVOKE ALL ON TABLE public\.platform_mfa_recovery_requests FROM PUBLIC, anon, authenticated/.test(migration),
);
ok("HYG_5_no_identity_provider_or_document_upload", !/onfido|persona|veriff|jumio|passport|driving.?licen[cs]e|upload/i.test(serverSrc + fnSrc + panelSrc + routeSrc + pureSrc));
const auditSrc = code("src/lib/platform-audit.ts");
ok(
  "HYG_6_audit_vocabulary_present",
  [
    "MFA_RECOVERY_REQUESTED", "MFA_RECOVERY_APPROVED", "MFA_RECOVERY_SECOND_APPROVAL", "MFA_RECOVERY_EXECUTED", "MFA_TARGET_SESSIONS_REVOKED",
    "MFA_RECOVERY_GRANT_ISSUED", "MFA_RECOVERY_GRANT_REDEEMED", "MFA_REPLACEMENT_ENROLLED", "MFA_RECOVERY_COMPLETED", "MFA_RECOVERY_CANCELLED",
    "MFA_RECOVERY_EXPIRED", "MFA_RECOVERY_DENIED", "MFA_RECOVERY_NOTIFICATION_RECORDED",
  ].every((e) => auditSrc.includes(`"${e}"`)),
);
ok(
  "HYG_7_recovery_actions_registered",
  ["mfaRecoveryRequest", "mfaRecoveryApprove", "mfaRecoveryExecute", "mfaRecoveryCancel", "mfaRecoveryReissue", "mfaRecoveryComplete"].every(
    (k) => typeof pure.PRIVILEGED_MFA_ACTIONS[k] === "string" && pure.PRIVILEGED_MFA_ACTIONS[k].startsWith("platform.mfa_recovery_"),
  ),
);
ok(
  "HYG_8_mode_independence_in_db",
  !/IF p_mode\s*(=|<>|IN)/.test(migration) && !/PRIVILEGED_MFA_MODE/.test(migration.replace(/--.*$/gm, "")),
);

// 7c. G7F-3C3B: tenant authority honours the recovery boundary; subject is never client-supplied
const tpSrc = code("src/lib/tenant-presentation.server.ts");
const tmFn = tpSrc.slice(tpSrc.indexOf("export const checkTenantMembershipFn"), tpSrc.indexOf("export const listActiveTenantSummariesFn"));
ok(
  "TENANT_1_membership_fn_authenticated_subject_server_derived",
  /\.middleware\(\[requireSupabaseAuth\]\)/.test(tmFn) && /const userId = \(context as \{ userId\?: string \} \| undefined\)\?\.userId;/.test(tmFn) &&
    /if \(!userId\) throw new Error\("Not authenticated"\);/.test(tmFn) && /checkTenantMembership\(data\.slug, userId\)/.test(tmFn) && !/data\.userId/.test(tmFn),
);
ok(
  "TENANT_2_membership_input_has_no_user_id",
  /checkTenantMembershipInput = z\.object\(\{ slug: z\.string\(\)\.min\(1\)\.max\(64\) \}\)/.test(tpSrc) && !/userId/.test(tpSrc.match(/checkTenantMembershipInput = [^;]+;/)?.[0] ?? "userId"),
);
const tpMod = await import("../src/lib/tenant-presentation.server.ts").catch(() => null);
const spoofParsed = tpMod?.checkTenantMembershipInput?.parse({ slug: "t1", userId: TARGET });
ok("TENANT_3_spoofed_user_id_stripped", !!spoofParsed && spoofParsed.slug === "t1" && !("userId" in spoofParsed), JSON.stringify(spoofParsed ?? null));
const gateSrc = code("src/components/tenant/TenantAuthenticatedGate.tsx");
const tenantLoginSrc = code("src/routes/$tenantSlug/login.tsx");
ok(
  "TENANT_4_callers_send_slug_only",
  [gateSrc, tenantLoginSrc].every((s) => /checkTenantMembershipFn\(\{\s*data: \{ slug: tenant\.slug \},?\s*\}\)/.test(s)),
);
const c3bFile = readdirSync(resolve(root, "supabase/migrations")).find((f) => f.endsWith("_gate_g7f3c3b_tenant_auth_boundary.sql"));
const c3b = c3bFile ? read(`supabase/migrations/${c3bFile}`).replace(/--.*$/gm, "") : "";
const c3bBody = (name) => {
  const start = c3b.indexOf(`FUNCTION public.${name}(`);
  if (start < 0) return "";
  const end = c3b.slice(start).search(/\n\$(function)?\$;/);
  return end < 0 ? "" : c3b.slice(start, start + end);
};
ok(
  "TENANT_5_root_helpers_bound_to_subject_and_boundary",
  ["has_tenant_membership", "can_access_tenant_data", "can_administer_tenant", "has_active_support_data_access"].every((f) =>
    /SELECT public\.g7f3c3b_tenant_subject_current\(p_user_id\)\s+AND/.test(c3bBody(f)),
  ) &&
    ["auth_is_tenant_staff", "auth_is_tenant_admin", "auth_is_tenant_introducer"].every((f) => /public\.g7f3c3b_auth_context_current\(\)/.test(c3bBody(f))) &&
    /IF v_uid IS DISTINCT FROM p_user_id THEN\s*RETURN false;/.test(c3bBody("g7f3c3b_tenant_subject_current")) &&
    /public\.g7f3c3a_request_context_current\(p_user_id\)/.test(c3bBody("g7f3c3b_tenant_subject_current")),
);
ok(
  "TENANT_6_guard_privileges_and_policies",
  /REVOKE ALL ON FUNCTION public\.g7f3c3b_tenant_subject_current\(uuid\) FROM PUBLIC, anon, authenticated, service_role/.test(c3b) &&
    /GRANT EXECUTE ON FUNCTION public\.g7f3c3b_auth_context_current\(\) TO authenticated/.test(c3b) &&
    /ALTER POLICY "Users read own memberships"[\s\S]*?user_id = auth\.uid\(\)\) AND public\.g7f3c3b_auth_context_current\(\)/.test(c3b) &&
    /ALTER POLICY "Staff view lender policies"[\s\S]*?g7f3c3b_auth_context_current\(\)/.test(c3b),
);
ok(
  "TENANT_7_memberships_never_created_or_deleted",
  !!c3b && !/(INSERT INTO|DELETE FROM|UPDATE)\s+public\.tenant_memberships/i.test(c3b) && !/platform_role|user_roles/i.test(c3bBody("has_tenant_membership")),
);

restoreConsole();
console.log(`\nG7F3C3_UNIT total=${total} failed=${failures.length}`);
if (failures.length) {
  console.error(`FAILED: ${failures.join(", ")}`);
  process.exit(1);
}
