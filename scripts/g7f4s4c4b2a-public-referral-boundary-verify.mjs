/**
 * G7F-4S4C4-B2a Public tenant / referral context + RAF claim boundary — offline verification.
 *
 * Real referral server functions and public RAF resolvers run against an in-memory PostgREST fake
 * on a non-routable host; the acting-tenant authority (resolveActingTenant / resolveActingTenantRole
 * / resolveSoleMembershipTenant) runs for real against synthetic memberships. Booking and RAF-route
 * consumer changes are proven at the source level (the full booking server-fn graph is too
 * dependency-heavy to exercise in-process). Negative controls load in-memory mutated copies of the
 * module (behavioural) or mutate the source string (static) — nothing is written to disk.
 *
 * Synthetic fixtures only: no database, no network, no production, no real customer / staff /
 * privileged identity, no phone numbers. B2a adds NO migration, NO RLS/grant change, NO finance
 * ledger write — the verifier proves claimReferral creates no finance_ledger / commission row.
 *
 * Run: npm exec --yes --package=tsx -- tsx scripts/g7f4s4c4b2a-public-referral-boundary-verify.mjs
 */
import { readFileSync } from "node:fs";
import { register } from "node:module";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import ts from "typescript";

for (const k of [
  "SUPABASE_URL",
  "VITE_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_PUBLISHABLE_KEY",
  "VITE_SUPABASE_PUBLISHABLE_KEY",
  "OPENAI_API_KEY",
  "LOVABLE_API_KEY",
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_MESSAGING_SERVICE_SID",
  "TWILIO_SMS_SENDER_LABEL",
  "STAGING_TWILIO_ALLOW_LIVE",
  "APP_BASE_URL",
  "VITE_APP_URL",
  "APP_URL",
  "WEBSITE_SITE_NAME",
  "WEBSITE_HOSTNAME",
]) {
  delete process.env[k];
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REF_FILE = "src/lib/referrals.functions.ts";
const BOOKING_FILE = "src/lib/booking.functions.ts";
const RAF_BARE_FILE = "src/routes/raf.$code.tsx";
const RAF_TENANT_FILE = "src/routes/$tenantSlug/raf.$code.tsx";

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
async function outcome(fn) {
  try {
    return { ok: true, value: await fn() };
  } catch (e) {
    return { ok: false, error: e, message: String(e?.message ?? e) };
  }
}

// --- module stubs ------------------------------------------------------------------------------
const realStartUrl = import.meta.resolve("@tanstack/react-start");
const realStartServerUrl = import.meta.resolve("@tanstack/react-start/server");
const realSmsUrl = pathToFileURL(resolve(root, "src/lib/sms.server.ts")).href;
const realRefUrl = pathToFileURL(resolve(root, REF_FILE)).href;
const MUTANT_MARK = "/*b2a-mutant*/";
const stubStart = `
export * from ${JSON.stringify(realStartUrl)};
export function createServerFn(opts = {}) {
  const state = { method: opts.method ?? "GET", middleware: [], validator: null };
  const builder = {
    middleware(m) { state.middleware = [...state.middleware, ...m]; return builder; },
    inputValidator(v) { state.validator = v; return builder; },
    validator(v) { state.validator = v; return builder; },
    handler(h) {
      const fn = async () => { throw new Error("client invocation not available in verifier"); };
      fn.__def = { ...state, handler: h };
      return fn;
    },
  };
  return builder;
}
`;
const stubStartServer = `
export * from ${JSON.stringify(realStartServerUrl)};
export function getRequest() { return globalThis.__B2A_REQUEST ?? null; }
export function getCookie() { return undefined; }
export function setCookie() {}
export function deleteCookie() {}
`;
const stubPlatform = `
export async function validatePlatformTenantAccessSession() { return null; }
export async function hasValidPlatformTenantAccess() { return false; }
export async function clearPlatformTenantEntryOnLogout() {}
`;
const stubSms = `
export * from ${JSON.stringify(realSmsUrl)};
export function isTwilioConfigured() { return true; }
export async function sendSms(opts) {
  (globalThis.__B2A_SMS ??= []).push({ to: opts.to, body: opts.body });
  return { sid: "SMxB2A" + String(globalThis.__B2A_SMS.length) };
}
`;
const dataUrl = (src) => `data:text/javascript,${encodeURIComponent(src)}`;
const hookSource = `
const MUTANT = ${JSON.stringify(dataUrl(MUTANT_MARK))};
const REAL_REF = ${JSON.stringify(realRefUrl)};
export async function resolve(specifier, context, next) {
  let parent = String(context.parentURL ?? "");
  if (parent.startsWith(MUTANT)) {
    context = { ...context, parentURL: REAL_REF };
    parent = REAL_REF;
  }
  const fromData = parent.startsWith("data:");
  if (specifier === "@tanstack/react-start" && !fromData) {
    return { url: ${JSON.stringify(dataUrl(stubStart))}, shortCircuit: true };
  }
  if (specifier === "@tanstack/react-start/server" && !fromData) {
    return { url: ${JSON.stringify(dataUrl(stubStartServer))}, shortCircuit: true };
  }
  if (/platform-tenant-entry\\.server(\\.ts)?$/.test(specifier)) {
    return { url: ${JSON.stringify(dataUrl(stubPlatform))}, shortCircuit: true };
  }
  if (/(^|\\/)sms\\.server(\\.ts)?$/.test(specifier) && !fromData) {
    return { url: ${JSON.stringify(dataUrl(stubSms))}, shortCircuit: true };
  }
  return next(specifier, context);
}
`;
register(dataUrl(hookSource), import.meta.url);

// --- synthetic fixtures ------------------------------------------------------------------------
const FAKE_HOST = "g7f4s4c4b2a.invalid";
process.env.SUPABASE_URL = `http://${FAKE_HOST}`;
process.env.VITE_SUPABASE_URL = `http://${FAKE_HOST}`;
process.env.SUPABASE_SERVICE_ROLE_KEY = "synthetic_service_role_g7f4s4c4b2a_not_a_real_key";
process.env.SUPABASE_PUBLISHABLE_KEY = "synthetic_publishable_g7f4s4c4b2a_not_a_real_key";
process.env.VITE_SUPABASE_PUBLISHABLE_KEY = "synthetic_publishable_g7f4s4c4b2a_not_a_real_key";
process.env.APP_BASE_URL = "http://app.invalid";

const id = (prefix, n) =>
  `${prefix}${String(n).repeat(7).slice(0, 7)}-0000-4000-8000-${String(n).padStart(12, "0")}`;
const T = { a: id("1", 1), b: id("1", 2) };
const U = {
  friendA: id("2", 1), // sole member of tenant A (the referred friend)
  friendB: id("2", 2), // sole member of tenant B
  referrerA: id("2", 3), // owns code ALPHA, sole member of tenant A
  dual: id("2", 4), // member of BOTH tenants (ambiguous)
  none: id("2", 5), // no membership at all
};
const C = { alpha: id("5", 1), bravo: id("5", 2), inactive: id("5", 3) };
const daysAgo = (d) => new Date(Date.now() - d * 86400000).toISOString();

const SECRETS = [
  "Alpha Referrer",
  "Bravo Referrer",
  "REFPHONE-ALPHA",
  "REFPHONE-BRAVO",
  T.a,
  T.b,
];

let db;
const writes = [];
function mem(user_id, tenant_id, role) {
  return { id: randomUUID(), user_id, tenant_id, role, active: true };
}
function codeRow(cid, tenant_id, code, referrer_user_id, referrer_name, referrer_phone, active) {
  return {
    id: cid,
    tenant_id,
    code,
    referrer_user_id,
    referrer_name,
    referrer_phone,
    active,
    created_by: null,
    created_at: daysAgo(10),
  };
}
function resetDb(extraReferrals = []) {
  db = {
    tenants: [
      { id: T.a, slug: "tenant-a", company_name: "Tenant A", status: "active", tenant_type: "firm" },
      { id: T.b, slug: "tenant-b", company_name: "Tenant B", status: "active", tenant_type: "firm" },
    ],
    tenant_memberships: [
      mem(U.friendA, T.a, "customer"),
      mem(U.friendB, T.b, "customer"),
      mem(U.referrerA, T.a, "customer"),
      mem(U.dual, T.a, "customer"),
      mem(U.dual, T.b, "customer"),
    ],
    admin_permissions: [],
    profiles: [
      { id: U.referrerA, full_name: "Alpha Referrer", email: "a@alpha.example.test", phone: "REFPHONE-ALPHA" },
    ],
    referral_codes: [
      codeRow(C.alpha, T.a, "ALPHA111", U.referrerA, "Alpha Referrer", "REFPHONE-ALPHA", true),
      codeRow(C.bravo, T.b, "BRAVO111", U.friendB, "Bravo Referrer", "REFPHONE-BRAVO", true),
      codeRow(C.inactive, T.a, "INACT111", null, "Alpha Referrer", null, false),
    ],
    referrals: [...extraReferrals],
    finance_ledger: [],
    commission_ledger: [],
  };
  writes.length = 0;
  globalThis.__B2A_REQUEST = null;
  globalThis.__B2A_SMS = [];
}

// --- in-memory PostgREST fake ------------------------------------------------------------------
const json = (v, status = 200, extra = {}) =>
  new Response(v === undefined ? "" : JSON.stringify(v), {
    status,
    headers: { "content-type": "application/json", ...extra },
  });
const RESERVED = new Set(["select", "order", "limit", "offset", "on_conflict", "columns"]);
function parseList(v) {
  return v
    .replace(/^\(|\)$/g, "")
    .split(",")
    .map((s) => s.trim().replace(/^"|"$/g, ""));
}
function matchOp(value, expr) {
  if (expr.startsWith("not.")) return !matchOp(value, expr.slice(4));
  const dot = expr.indexOf(".");
  const op = expr.slice(0, dot);
  const arg = expr.slice(dot + 1);
  switch (op) {
    case "eq":
      return value !== null && value !== undefined && String(value) === arg;
    case "neq":
      return value !== null && value !== undefined && String(value) !== arg;
    case "is":
      if (arg === "null") return value === null || value === undefined;
      if (arg === "true") return value === true;
      if (arg === "false") return value === false;
      return false;
    case "in":
      return value !== null && value !== undefined && parseList(arg).includes(String(value));
    default:
      throw new Error(`fake postgrest: unsupported op ${op}`);
  }
}
function applyFilters(rows, url) {
  let out = rows;
  for (const [k, v] of url.searchParams.entries()) {
    if (RESERVED.has(k)) continue;
    if (k === "or" || k === "and") throw new Error(`fake postgrest: unsupported ${k}`);
    out = out.filter((r) => matchOp(r[k], v));
  }
  return out;
}
function tableRows(table) {
  if (!Array.isArray(db[table])) db[table] = [];
  return db[table];
}
function respondRows(rows, headers, method, status = 200) {
  const accept = headers.get("accept") ?? "";
  if (method === "HEAD") return new Response(null, { status });
  if (accept.includes("vnd.pgrst.object+json")) {
    if (rows.length !== 1)
      return json(
        { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" },
        406,
      );
    return json(rows[0], status);
  }
  return json(rows, status);
}
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === "string" ? input : (input.url ?? String(input)));
  if (url.hostname !== FAKE_HOST) throw new Error(`B2A fetch stub refused host ${url.hostname}`);
  const method = String(init.method || "GET").toUpperCase();
  const headers = new Headers(init.headers || undefined);
  let body = null;
  try {
    body = init.body ? JSON.parse(String(init.body)) : null;
  } catch {
    body = null;
  }
  const p = url.pathname;
  if (p.startsWith("/rest/v1/rpc/")) {
    const fn = p.slice("/rest/v1/rpc/".length);
    if (fn === "has_tenant_membership") {
      return json(
        db.tenant_memberships.some(
          (m) => m.user_id === body?.p_user_id && m.tenant_id === body?.p_tenant_id && m.active,
        ),
      );
    }
    return json(null);
  }
  if (p.startsWith("/rest/v1/")) {
    const table = p.slice("/rest/v1/".length);
    const rows = tableRows(table);
    if (method === "GET" || method === "HEAD") return respondRows(applyFilters(rows, url), headers, method);
    const wantRows = /return=representation/.test(headers.get("prefer") ?? "");
    if (method === "POST") {
      const incoming = Array.isArray(body) ? body : [body];
      const out = [];
      for (const raw of incoming) {
        const row = { ...raw };
        if (row.id === undefined) row.id = randomUUID();
        if (row.created_at === undefined) row.created_at = new Date().toISOString();
        if (table === "referral_codes" && rows.some((r) => r.code === row.code))
          return json({ code: "23505", message: "duplicate key" }, 409);
        if (
          table === "referrals" &&
          // The production DB enforces UNIQUE (code, referred_user_id), and because referral_codes.code
          // is globally UNIQUE a code maps to exactly one tenant — so storage-layer isolation already
          // holds. The fake keys uniqueness per (code, referred_user_id, tenant_id) to ISOLATE and
          // exercise the application-layer tenant predicate on claimReferral's idempotency lookup.
          rows.some(
            (r) =>
              r.code === row.code &&
              r.referred_user_id === row.referred_user_id &&
              r.tenant_id === row.tenant_id,
          )
        )
          return json({ code: "23505", message: "duplicate key" }, 409);
        rows.push(row);
        writes.push({ method: "INSERT", table, row: { ...row } });
        out.push(row);
      }
      return wantRows ? respondRows(out, headers, "POST", 201) : new Response(null, { status: 201 });
    }
    if (method === "PATCH") {
      const hit = applyFilters(rows, url);
      for (const r of hit) {
        Object.assign(r, body);
        writes.push({ method: "UPDATE", table, row: { ...r } });
      }
      return wantRows ? respondRows(hit, headers, "PATCH") : new Response(null, { status: 204 });
    }
    if (method === "DELETE") {
      const hit = new Set(applyFilters(rows, url));
      db[table] = rows.filter((r) => !hit.has(r));
      return new Response(null, { status: 204 });
    }
  }
  return json({ message: `unstubbed ${method} ${p}` }, 500);
};

// Quiet console (keep PASS/FAIL on their own streams).
const logs = [];
for (const level of ["info", "warn", "error", "debug"]) {
  console[level] = (...args) => {
    const line = args
      .map((a) => (a instanceof Error ? a.message : typeof a === "string" ? a : JSON.stringify(a)))
      .join(" ");
    if (line.startsWith("FAIL  ")) process.stderr.write(`${line}\n`);
    else logs.push(`[${level}] ${line}`);
  };
}

// --- load real modules + sources ---------------------------------------------------------------
resetDb();
const rf = await import("../src/lib/referrals.functions.ts");
const ta = await import("../src/lib/tenant-assert.server.ts");
const REF_SRC = readFileSync(resolve(root, REF_FILE), "utf8");
const BOOKING_SRC = readFileSync(resolve(root, BOOKING_FILE), "utf8");
const RAF_BARE_SRC = readFileSync(resolve(root, RAF_BARE_FILE), "utf8");
const RAF_TENANT_SRC = readFileSync(resolve(root, RAF_TENANT_FILE), "utf8");

async function loadMutant(src) {
  const js = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return import(dataUrl(`${MUTANT_MARK}\n${js}\n// ${randomUUID()}`));
}

async function invoke(fn, data, context) {
  const d = fn.__def;
  const parsed = d.validator ? await d.validator(data) : data;
  return d.handler({ data: parsed, context });
}
/** Actor; `slug` simulates a membership-verified /$tenantSlug route carried in the Referer. */
function as(userId, slug = null) {
  return { userId, slug };
}
async function callClaim(mod, code, actor) {
  globalThis.__B2A_REQUEST = actor.slug
    ? new Request("http://app.invalid/_serverFn/x", {
        headers: { referer: `http://app.invalid/${actor.slug}/home` },
      })
    : null;
  return outcome(() =>
    invoke(mod.claimReferral, { code }, {
      userId: actor.userId,
      claims: { sub: actor.userId, email: `${actor.userId}@friend.example.test` },
      supabase: null,
    }),
  );
}
const referralsFor = (code, user) =>
  db.referrals.filter((r) => r.code === code && r.referred_user_id === user);
const leakFree = (r) => !r.ok && !SECRETS.some((s) => r.message.includes(String(s)));

// ===============================================================================================
// SECTION A — claimReferral tenant-authority boundary (behavioural)
// ===============================================================================================

// T01: legitimate same-tenant claim is recorded.
resetDb();
let r = await callClaim(rf, "ALPHA111", as(U.friendA));
ok("B2A-T01 same-tenant claim recorded", r.ok && r.value?.ok && r.value.reason === "recorded");

// T02: the recorded referral row is stamped with the acting tenant via withForcedTenantId.
const t02rows = referralsFor("ALPHA111", U.friendA);
ok(
  "B2A-T02 claim stamps acting tenant_id (withForcedTenantId)",
  t02rows.length === 1 && t02rows[0].tenant_id === T.a,
  `tenant_id=${t02rows[0]?.tenant_id}`,
);

// T03: claim creates NO finance_ledger / commission row (B4 preserved; no financial consequence).
ok(
  "B2A-T03 claim creates no finance ledger / commission row",
  db.finance_ledger.length === 0 &&
    db.commission_ledger.length === 0 &&
    !writes.some((w) => w.table === "finance_ledger" || w.table === "commission_ledger"),
);

// T04: foreign-tenant code is invalid for an acting tenant-A customer; nothing inserted.
resetDb();
r = await callClaim(rf, "BRAVO111", as(U.friendA));
ok(
  "B2A-T04 foreign-tenant code rejected, no row",
  r.ok && r.value?.ok === false && r.value.reason === "invalid" && referralsFor("BRAVO111", U.friendA).length === 0,
);

// T05: unknown code is indistinguishable from a foreign code (same outcome, no existence leak).
resetDb();
r = await callClaim(rf, "ZZZZ999", as(U.friendA));
ok(
  "B2A-T05 unknown code === foreign outcome (no existence leak)",
  r.ok && r.value?.ok === false && r.value.reason === "invalid",
);

// T06: tenant-B customer cannot claim a tenant-A code.
resetDb();
r = await callClaim(rf, "ALPHA111", as(U.friendB));
ok(
  "B2A-T06 cross-tenant claim rejected, no row",
  r.ok && r.value?.reason === "invalid" && referralsFor("ALPHA111", U.friendB).length === 0,
);

// T07: multi-tenant (ambiguous) customer fails closed — no first-membership fallback.
resetDb();
r = await callClaim(rf, "ALPHA111", as(U.dual));
ok(
  "B2A-T07 ambiguous multi-tenant customer fails closed",
  r.ok && r.value?.reason === "invalid" && referralsFor("ALPHA111", U.dual).length === 0,
);

// T08: customer with no membership fails closed.
resetDb();
r = await callClaim(rf, "ALPHA111", as(U.none));
ok(
  "B2A-T08 no-membership customer fails closed",
  r.ok && r.value?.reason === "invalid" && db.referrals.length === 0,
);

// T09: idempotent within tenant — second claim is 'already', exactly one row.
resetDb();
await callClaim(rf, "ALPHA111", as(U.friendA));
r = await callClaim(rf, "ALPHA111", as(U.friendA));
ok(
  "B2A-T09 same-tenant idempotent (one row, 'already')",
  r.ok && r.value?.reason === "already" && referralsFor("ALPHA111", U.friendA).length === 1,
);

// T10: a foreign-tenant referral row must NOT suppress a legitimate claim (tenant-bound idempotency).
resetDb([
  {
    id: randomUUID(),
    tenant_id: T.b,
    code: "ALPHA111",
    referred_user_id: U.friendA,
    referrer_user_id: null,
    status: "signed_up",
    bonus_status: "none",
    created_at: daysAgo(3),
  },
]);
r = await callClaim(rf, "ALPHA111", as(U.friendA));
ok(
  "B2A-T10 foreign referral does not suppress legit claim",
  r.ok && r.value?.reason === "recorded" && referralsFor("ALPHA111", U.friendA).some((x) => x.tenant_id === T.a),
);

// T11: self-referral guarded (referrer cannot claim own code).
resetDb();
r = await callClaim(rf, "ALPHA111", as(U.referrerA));
ok(
  "B2A-T11 self-referral rejected, no row",
  r.ok && r.value?.reason === "self" && referralsFor("ALPHA111", U.referrerA).length === 0,
);

// T12: membership-verified slug (Referer) authorises the claim in that tenant.
resetDb();
r = await callClaim(rf, "ALPHA111", as(U.friendA, "tenant-a"));
ok("B2A-T12 verified-slug claim recorded", r.ok && r.value?.reason === "recorded");

// T13: a foreign slug the caller is NOT a member of cannot authorise a claim.
resetDb();
r = await callClaim(rf, "BRAVO111", as(U.friendA, "tenant-b"));
ok(
  "B2A-T13 non-member foreign slug cannot authorise claim",
  r.ok && r.value?.reason === "invalid" && db.referrals.length === 0,
);

// T14: no claim-failure response leaks a referrer name, phone, or tenant id.
resetDb();
const fails = [
  await callClaim(rf, "BRAVO111", as(U.friendA)),
  await callClaim(rf, "ALPHA111", as(U.friendB)),
  await callClaim(rf, "ALPHA111", as(U.dual)),
  await callClaim(rf, "ALPHA111", as(U.referrerA)),
].map((x) => (x.ok ? { ok: false, message: JSON.stringify(x.value) } : x));
ok(
  "B2A-T14 claim failures leak no referrer identity / tenant id",
  fails.every((f) => !SECRETS.some((s) => f.message.includes(String(s)))),
);

// ===============================================================================================
// SECTION B — public RAF resolvers (behavioural: no referrer identity before tenant proof)
// ===============================================================================================
resetDb();

// T15: the bare-route resolver returns the code's owning tenant slug (bootstrap redirect allowed).
let meta = await rf.resolveReferralCodeTenantSlug("ALPHA111");
ok("B2A-T15 tenant-only resolver returns owning tenant", meta?.tenantSlug === "tenant-a");

// T16: the tenant-only resolver exposes ONLY tenantSlug — never a referrer name.
ok(
  "B2A-T16 tenant-only resolver exposes no referrer identity",
  JSON.stringify(Object.keys(meta).sort()) === JSON.stringify(["tenantSlug"]) &&
    !("referrer_name" in meta),
);

// T17: unknown code → null tenant (no existence signal beyond tenant).
meta = await rf.resolveReferralCodeTenantSlug("ZZZZ999");
ok("B2A-T17 unknown code → null tenant", meta?.tenantSlug === null);

// T18: tenant-validated resolver returns referrer identity ONLY on a matching tenant.
const m18 = await rf.resolveReferralCodeMetaForTenant("ALPHA111", "tenant-a");
ok(
  "B2A-T18 identity disclosed only after tenant match",
  m18 !== null && m18.referrer_name === "Alpha Referrer" && m18.tenantSlug === "tenant-a",
);

// T19: a mismatched tenant yields null — no referrer identity leak.
const m19 = await rf.resolveReferralCodeMetaForTenant("ALPHA111", "tenant-b");
ok("B2A-T19 mismatched tenant → null (no identity leak)", m19 === null);

// T20: unknown code with any tenant → null.
const m20 = await rf.resolveReferralCodeMetaForTenant("ZZZZ999", "tenant-a");
ok("B2A-T20 unknown code (tenant-scoped) → null", m20 === null);

// ===============================================================================================
// SECTION C — booking + RAF-route consumer changes (source-level guards)
// ===============================================================================================

// Static guard helpers (also reused by the negative controls on mutated sources).
function sliceFn(src, name) {
  const m = new RegExp(`(?:async )?function ${name}\\b`).exec(src);
  if (!m) return "";
  return src.slice(m.index, m.index + 4000);
}
function guard_noPublicResolveReferralCode(src) {
  return !/export const resolveReferralCode\s*=/.test(src);
}
function guard_bookingActingBeforeIntroducer(src) {
  const fn = sliceFn(src, "resolveBookingTenantId");
  const acting = fn.indexOf("if (opts.actingUserId)");
  const intro = fn.indexOf("if (opts.introducerId)");
  return acting !== -1 && intro !== -1 && acting < intro;
}
function guard_bookingDiscardsForeignIntroducer(src) {
  // The cookie consumer must DISCARD (introducerId = null) and must NOT be a bare throwing assert.
  const m = /if \(introducerId && !creditActingStaff\) \{([\s\S]*?)\n  \}/.exec(src);
  if (!m) return false;
  const block = m[1];
  return /introducerId = null/.test(block) && !/throw /.test(block);
}
function guard_bareRafNoNamePreValidation(src) {
  const head = /head: \(\{ loaderData, params \}\) => \{([\s\S]*?)\n  \},/.exec(src);
  const loaderUsesTenantOnly = /resolveReferralCodeTenantSlug\(params\.code\)/.test(src);
  const loaderAvoidsLeakyMeta = !/resolveReferralCodeMeta\(params\.code\)/.test(src);
  const headNoName = head ? !/referrer_name|referrerName/.test(head[1]) : false;
  return loaderUsesTenantOnly && loaderAvoidsLeakyMeta && headNoName;
}
function guard_tenantRafValidatesBeforeName(src) {
  return (
    /resolveReferralCodeMetaForTenant\(params\.code, params\.tenantSlug\)/.test(src) &&
    /if \(!meta\) \{[\s\S]*?throw notFound\(\);/.test(src) &&
    !/resolveReferralCodeMeta\(params\.code\)/.test(src)
  );
}

// T21: the public, globally-resolvable name-leaking resolveReferralCode server fn is removed.
ok("B2A-T21 public resolveReferralCode name-leak endpoint removed", guard_noPublicResolveReferralCode(REF_SRC));

// T22: booking tenant precedence resolves the acting user's canonical tenant before the cookie introducer.
ok("B2A-T22 booking resolves acting tenant before cookie introducer", guard_bookingActingBeforeIntroducer(BOOKING_SRC));

// T23: the cookie introducer consumer discards a foreign/invalid introducer (never throws/blocks).
ok("B2A-T23 cookie introducer discarded not blocked", guard_bookingDiscardsForeignIntroducer(BOOKING_SRC));

// T24: the bare RAF route never fetches/renders a referrer name before tenant validation.
ok("B2A-T24 bare RAF route exposes no referrer name pre-validation", guard_bareRafNoNamePreValidation(RAF_BARE_SRC));

// T25: the tenant-prefixed RAF route validates tenant in the loader before returning a referrer name.
ok("B2A-T25 tenant RAF loader validates tenant before identity", guard_tenantRafValidatesBeforeName(RAF_TENANT_SRC));

// ===============================================================================================
// NEGATIVE CONTROLS — each reverts a B2a guard and proves the verifier detects the unsafe effect.
// ===============================================================================================
function replaceBlock(src, name, from, to) {
  const start = new RegExp(`(?:export )?(?:async )?(?:function|const) ${name}\\b`, "m").exec(src);
  if (!start) return null;
  const rest = src.slice(start.index);
  const end = /\n(?=export |async function |function |const |let |type |interface |\/\*\*)/.exec(
    rest.slice(start[0].length),
  );
  const block = (end ? rest.slice(0, start[0].length + end.index) : rest).trimEnd();
  const changed = block.split(from).join(to);
  if (changed === block) return null;
  return src.replace(block, changed);
}

const NEGATIVE_CONTROLS = [
  // --- behavioural (mutate referrals.functions.ts; load mutant; prove unsafe outcome) ----------
  {
    name: "NC01 drop tenant predicate from code lookup → cross-tenant claim succeeds",
    async detect() {
      const mutated = replaceBlock(
        REF_SRC,
        "claimReferral",
        '.eq("code", data.code)\n      .eq("tenant_id", tenantId)\n      .maybeSingle();',
        '.eq("code", data.code)\n      .maybeSingle();',
      );
      if (!mutated) return false;
      const mod = await loadMutant(mutated);
      resetDb();
      const res = await callClaim(mod, "BRAVO111", as(U.friendA));
      return res.ok && res.value?.reason === "recorded"; // unsafe: foreign code claimed
    },
  },
  {
    name: "NC02 drop withForcedTenantId stamp → referral row not tenant-stamped",
    async detect() {
      const mutated = replaceBlock(
        REF_SRC,
        "claimReferral",
        "await supabaseAdmin.from(\"referrals\").insert(\n      withForcedTenantId(\n        {",
        "await supabaseAdmin.from(\"referrals\").insert(\n      ({",
      );
      const mutated2 = mutated
        ? mutated.replace(
            "        },\n        tenantId,\n      ),\n    );",
            "        }),\n    );",
          )
        : null;
      if (!mutated2 || mutated2 === REF_SRC) return false;
      const mod = await loadMutant(mutated2);
      resetDb();
      await callClaim(mod, "ALPHA111", as(U.friendA));
      const rows = referralsFor("ALPHA111", U.friendA);
      return rows.length === 1 && rows[0].tenant_id !== T.a; // unsafe: tenantless/unstamped row
    },
  },
  {
    name: "NC03 drop tenant predicate from idempotency → foreign referral suppresses legit claim",
    async detect() {
      const mutated = replaceBlock(
        REF_SRC,
        "claimReferral",
        '.eq("referred_user_id", context.userId)\n      .eq("tenant_id", tenantId)\n      .maybeSingle();',
        '.eq("referred_user_id", context.userId)\n      .maybeSingle();',
      );
      if (!mutated) return false;
      const mod = await loadMutant(mutated);
      resetDb([
        {
          id: randomUUID(),
          tenant_id: T.b,
          code: "ALPHA111",
          referred_user_id: U.friendA,
          referrer_user_id: null,
          status: "signed_up",
          bonus_status: "none",
          created_at: daysAgo(3),
        },
      ]);
      const res = await callClaim(mod, "ALPHA111", as(U.friendA));
      // unsafe: a foreign-tenant referral short-circuits the legitimate claim.
      return res.ok && res.value?.reason === "already" && !referralsFor("ALPHA111", U.friendA).some((x) => x.tenant_id === T.a);
    },
  },
  {
    name: "NC04 tenant-validated resolver returns identity on mismatch → name leak",
    async detect() {
      const mutated = replaceBlock(
        REF_SRC,
        "resolveReferralCodeMetaForTenant",
        "if (!meta?.tenantSlug || meta.tenantSlug !== tenantSlug) return null;\n  return { referrer_name: meta.referrer_name, tenantSlug: meta.tenantSlug };",
        "if (!meta?.tenantSlug) return null;\n  return { referrer_name: meta.referrer_name, tenantSlug: meta.tenantSlug };",
      );
      if (!mutated) return false;
      const mod = await loadMutant(mutated);
      resetDb();
      const m = await mod.resolveReferralCodeMetaForTenant("ALPHA111", "tenant-b");
      return m !== null && m.referrer_name === "Alpha Referrer"; // unsafe: identity on mismatch
    },
  },
  {
    name: "NC05 tenant-only resolver also returns referrer name → pre-tenant identity leak",
    async detect() {
      const mutated = replaceBlock(
        REF_SRC,
        "resolveReferralCodeTenantSlug",
        "return { tenantSlug: meta?.tenantSlug ?? null };",
        "return { tenantSlug: meta?.tenantSlug ?? null, referrer_name: meta?.referrer_name ?? null };",
      );
      if (!mutated) return false;
      const mod = await loadMutant(mutated);
      resetDb();
      const m = await mod.resolveReferralCodeTenantSlug("ALPHA111");
      return "referrer_name" in m && m.referrer_name === "Alpha Referrer"; // unsafe: name before tenant
    },
  },
  // --- static (mutate source string; prove the guard flips to unsafe) --------------------------
  {
    name: "NC06 re-introduce public resolveReferralCode name-leak endpoint",
    async detect() {
      const mutated =
        REF_SRC + "\nexport const resolveReferralCode = createServerFn({ method: \"GET\" });\n";
      return !guard_noPublicResolveReferralCode(mutated);
    },
  },
  {
    name: "NC07 booking precedence puts cookie introducer before acting tenant",
    async detect() {
      const fn = sliceFn(BOOKING_SRC, "resolveBookingTenantId");
      const introBlock = /(  if \(opts\.introducerId\) \{[\s\S]*?\n  \}\n)/.exec(fn);
      const actingBlock = /(  if \(opts\.actingUserId\) \{[\s\S]*?\n  \}\n)/.exec(fn);
      if (!introBlock || !actingBlock) return false;
      // Swap: move the introducer block ahead of the acting-user block.
      let mf = fn.replace(actingBlock[1], "").replace(introBlock[1], introBlock[1] + actingBlock[1]);
      const mutated = BOOKING_SRC.replace(fn, mf);
      return !guard_bookingActingBeforeIntroducer(mutated);
    },
  },
  {
    name: "NC08 cookie introducer consumer throws instead of discarding (blocks journey)",
    async detect() {
      const mutated = BOOKING_SRC.replace(
        /if \(introducerId && !creditActingStaff\) \{([\s\S]*?)\n  \}/,
        'if (introducerId && !creditActingStaff) {\n    throw new Error("Resource not found.");\n  }',
      );
      return mutated !== BOOKING_SRC && !guard_bookingDiscardsForeignIntroducer(mutated);
    },
  },
  {
    name: "NC09 bare RAF head renders referrer name before tenant validation",
    async detect() {
      const mutated = RAF_BARE_SRC.replace(
        'const title = "A friend invited you — Mortgage Hub";',
        'const title = `${loaderData?.referrer_name} invited you`;',
      );
      return mutated !== RAF_BARE_SRC && !guard_bareRafNoNamePreValidation(mutated);
    },
  },
  {
    name: "NC10 tenant RAF loader uses leaky resolver without validation",
    async detect() {
      const mutated = RAF_TENANT_SRC.replace(
        /resolveReferralCodeMetaForTenant\(params\.code, params\.tenantSlug\)/,
        "resolveReferralCodeMeta(params.code)",
      );
      return mutated !== RAF_TENANT_SRC && !guard_tenantRafValidatesBeforeName(mutated);
    },
  },
];

let ncPassed = 0;
for (const nc of NEGATIVE_CONTROLS) {
  const res = await outcome(() => nc.detect());
  const detected = res.ok && res.value === true;
  if (detected) {
    ncPassed += 1;
    console.log(`PASS  ${nc.name} (unsafe effect detected)`);
  } else {
    console.error(`FAIL  ${nc.name} — ${res.ok ? "mutation not detected" : res.message}`);
    failures.push(nc.name);
  }
}

console.log(`\nTEST_CASES=${total}`);
console.log(`NEGATIVE_CONTROL_COUNT=${NEGATIVE_CONTROLS.length}`);
console.log(
  `NEGATIVE_CONTROLS_PASS=${ncPassed === NEGATIVE_CONTROLS.length ? "yes" : "no"} (${ncPassed}/${NEGATIVE_CONTROLS.length})`,
);
console.log(`RESULT=${failures.length === 0 ? "PASS" : "FAIL"} (${total - failures.filter((f) => f.startsWith("B2A-")).length}/${total} tests)`);
if (failures.length) {
  console.error(`FAILURES: ${failures.join(", ")}`);
  process.exit(1);
}
console.log("ALL B2A CHECKS PASSED");
