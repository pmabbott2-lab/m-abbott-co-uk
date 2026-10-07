/**
 * G7F-4S4C4-B2b Lifecycle tenant stamping + referral qualification boundary — offline verification.
 *
 * Real server code runs against an in-memory PostgREST fake on a non-routable host:
 *   - markReferralQualified + submitSession (RAF qualification is tenant-scoped to the submitted
 *     session's tenant; tenantless/foreign referrals are never touched; NO financial side effect),
 *   - createManualLead, sendStaffCustomerBookingLink, sendIntroducerCustomerBookingLink
 *     (the three previously unstamped introducer_leads INSERT writers),
 *   - ensureMyReferralLink / sendMyReferralLink (RAF self-service on the canonical acting tenant).
 * The acting-tenant authority (resolveActingTenant / resolveActingTenantRole /
 * requireActiveActingIntroducerRegistration) runs for real against synthetic memberships.
 * Negative controls load in-memory mutated copies of the modules (behavioural) — nothing is
 * written to disk.
 *
 * Synthetic fixtures only: no database, no network, no production, no real customer / staff /
 * privileged identity, no real phone number (Ofcom drama-range placeholder 07700 900123 only);
 * SMS is stubbed and booking links are sent with sendSms=false. B2b adds NO migration, NO
 * RLS/grant change, NO finance ledger write.
 *
 * Run: npm exec --yes --package=tsx -- tsx scripts/g7f4s4c4b2b-lifecycle-tenant-boundary-verify.mjs
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
const SESS_FILE = "src/lib/sessions.functions.ts";
const INTRO_FILE = "src/lib/introducer.functions.ts";
const BOOKING_FILE = "src/lib/booking.functions.ts";
const CALC_FILE = "src/lib/introducer-calculator-lead.server.ts";

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
const MUTANT_MARK = "/*b2b-mutant*/";
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
export function getRequest() { return globalThis.__B2B_REQUEST ?? null; }
export function getCookie() { return undefined; }
export function setCookie() {}
export function deleteCookie() {}
`;
const stubPlatform = `
export async function validatePlatformTenantAccessSession(args) {
  const f = globalThis.__B2B_PLATFORM;
  return typeof f === "function" ? f(args) : null;
}
export async function hasValidPlatformTenantAccess() { return false; }
export async function clearPlatformTenantEntryOnLogout() {}
export async function startPlatformTenantEntryImpl() { throw new Error("not available in verifier"); }
export async function endPlatformTenantEntryImpl() { throw new Error("not available in verifier"); }
export async function getMyPlatformTenantAccessImpl() { return null; }
`;
const stubSms = `
export * from ${JSON.stringify(realSmsUrl)};
export function isTwilioConfigured() { return true; }
export async function sendSms(opts) {
  (globalThis.__B2B_SMS ??= []).push({ to: opts.to, body: opts.body });
  (globalThis.__B2B_SMS_LOG ??= []).push(1);
  return { sid: "SMxB2B" + String(globalThis.__B2B_SMS.length) };
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
const FAKE_HOST = "g7f4s4c4b2b.invalid";
process.env.SUPABASE_URL = `http://${FAKE_HOST}`;
process.env.VITE_SUPABASE_URL = `http://${FAKE_HOST}`;
process.env.SUPABASE_SERVICE_ROLE_KEY = "synthetic_service_role_g7f4s4c4b2b_not_a_real_key";
process.env.SUPABASE_PUBLISHABLE_KEY = "synthetic_publishable_g7f4s4c4b2b_not_a_real_key";
process.env.VITE_SUPABASE_PUBLISHABLE_KEY = "synthetic_publishable_g7f4s4c4b2b_not_a_real_key";
process.env.APP_BASE_URL = "http://app.invalid";

const id = (prefix, n) =>
  `${prefix}${String(n).repeat(7).slice(0, 7)}-0000-4000-8000-${String(n).padStart(12, "0")}`;
// tenant-a models T001, tenant-b models T002.
const T = { a: id("1", 1), b: id("1", 2) };
const U = {
  friend: id("2", 1), // customer, sole member of tenant-a (referred friend)
  dual: id("2", 2), // A2 dual-tenant customer: member of tenant-a AND tenant-b
  none: id("2", 3), // no membership at all
  referrer: id("2", 4), // RAF self-service, sole member of tenant-a
  intro: id("2", 5), // introducer, sole member of tenant-a, registration in tenant-a
  introDual: id("2", 6), // introducer in tenant-a AND tenant-b, registration in each
  introUnbound: id("2", 7), // introducer member of tenant-a whose registration row is tenantless
  staff: id("2", 8), // adviser, sole member of tenant-a, staff introducer record in tenant-a
  staffDual: id("2", 9), // adviser in tenant-a AND tenant-b
  platform: id("3", 1), // platform operator: NO membership (Enter Company stub only)
};
const I = {
  intro: id("4", 1),
  introDualA: id("4", 2),
  introDualB: id("4", 3),
  introUnbound: id("4", 4),
  staff: id("4", 5),
};
const S = { a: id("6", 1), b: id("6", 2), none: id("6", 3), dualA: id("6", 4) };
const C = { dualA: id("5", 1) };
const daysAgo = (d) => new Date(Date.now() - d * 86400000).toISOString();

let db;
const writes = [];
function mem(user_id, tenant_id, role) {
  return { id: randomUUID(), user_id, tenant_id, role, active: true };
}
function introducer(rid, user_id, tenant_id, slug) {
  return {
    id: rid,
    user_id,
    tenant_id,
    slug,
    company_name: `Co ${slug}`,
    active: true,
    deleted_at: null,
  };
}
function referral(tenant_id, referred_user_id, status = "pending", extra = {}) {
  return {
    id: randomUUID(),
    tenant_id,
    code: tenant_id === T.b ? "BRAVO111" : "ALPHA111",
    referral_code_id: null,
    referred_user_id,
    referred_email: "friend@example.test",
    referrer_user_id: U.referrer,
    status,
    bonus_status: "none",
    created_at: daysAgo(3),
    ...extra,
  };
}
function resetDb({ referrals = [] } = {}) {
  db = {
    tenants: [
      {
        id: T.a,
        slug: "tenant-a",
        company_name: "Tenant A",
        trading_name: null,
        status: "active",
        tenant_type: "firm",
      },
      {
        id: T.b,
        slug: "tenant-b",
        company_name: "Tenant B",
        trading_name: null,
        status: "active",
        tenant_type: "firm",
      },
    ],
    tenant_memberships: [
      mem(U.friend, T.a, "customer"),
      mem(U.dual, T.a, "customer"),
      mem(U.dual, T.b, "customer"),
      mem(U.referrer, T.a, "customer"),
      mem(U.intro, T.a, "introducer"),
      mem(U.introDual, T.a, "introducer"),
      mem(U.introDual, T.b, "introducer"),
      mem(U.introUnbound, T.a, "introducer"),
      mem(U.staff, T.a, "adviser"),
      mem(U.staffDual, T.a, "adviser"),
      mem(U.staffDual, T.b, "adviser"),
    ],
    admin_permissions: [],
    profiles: [
      { id: U.referrer, full_name: "Self Referrer", email: "r@example.test", phone: null },
      { id: U.dual, full_name: "Dual Customer", email: "d@example.test", phone: null },
      { id: U.staff, full_name: "Staff Adviser", email: "s@example.test", phone: null },
    ],
    introducers: [
      introducer(I.intro, U.intro, T.a, "intro-a"),
      introducer(I.introDualA, U.introDual, T.a, "introdual-a"),
      introducer(I.introDualB, U.introDual, T.b, "introdual-b"),
      introducer(I.introUnbound, U.introUnbound, null, "intro-unbound"),
      introducer(I.staff, U.staff, T.a, "staff-a"),
    ],
    // Pre-seeded so the (pre-existing, B4-owned) staff-record rate seeding performs no write.
    commission_rates: [
      { user_id: U.staff, role: "introducer", percentage: 10 },
      { user_id: U.staffDual, role: "introducer", percentage: 10 },
    ],
    referral_codes: [
      {
        id: C.dualA,
        tenant_id: T.a,
        code: "DUALA111",
        referrer_user_id: U.dual,
        referrer_name: "Dual Customer",
        referrer_phone: null,
        active: true,
        created_by: U.dual,
        created_at: daysAgo(10),
      },
    ],
    referrals: [...referrals],
    interview_sessions: [
      { id: S.a, tenant_id: T.a, customer_id: U.friend, status: "submitted" },
      { id: S.b, tenant_id: T.b, customer_id: U.dual, status: "submitted" },
      { id: S.dualA, tenant_id: T.a, customer_id: U.dual, status: "submitted" },
      { id: S.none, tenant_id: null, customer_id: U.friend, status: "submitted" },
    ],
    introducer_leads: [],
    finance_ledger: [],
    commission_ledger: [],
    customer_introducer_links: [],
    feature_on: new Set([`${T.a}:refer_a_friend`, `${T.b}:refer_a_friend`]),
  };
  writes.length = 0;
  globalThis.__B2B_REQUEST = null;
  globalThis.__B2B_SMS = [];
  globalThis.__B2B_PLATFORM = null;
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
    case "gte":
      return value !== null && value !== undefined && String(value) >= arg;
    case "lte":
      return value !== null && value !== undefined && String(value) <= arg;
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
  const limit = url.searchParams.get("limit");
  return limit ? out.slice(0, Number(limit)) : out;
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
  if (url.hostname !== FAKE_HOST) throw new Error(`B2B fetch stub refused host ${url.hostname}`);
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
    if (fn === "is_tenant_feature_enabled") {
      return json(db.feature_on.has(`${body?.p_tenant_id}:${body?.p_feature_key}`));
    }
    return json(null);
  }
  if (p.startsWith("/rest/v1/")) {
    const table = p.slice("/rest/v1/".length);
    const rows = tableRows(table);
    if (
      db.failSessionTenantRead &&
      method === "GET" &&
      table === "interview_sessions" &&
      String(url.searchParams.get("id") ?? "").startsWith("in.")
    ) {
      return json({ message: "synthetic session tenant read failure" }, 500);
    }
    if (method === "GET" || method === "HEAD")
      return respondRows(applyFilters(rows, url), headers, method);
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
        rows.push(row);
        writes.push({ method: "INSERT", table, row: { ...row } });
        out.push(row);
      }
      return wantRows
        ? respondRows(out, headers, "POST", 201)
        : new Response(null, { status: 201 });
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
      writes.push({ method: "DELETE", table, row: null });
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
const sf = await import("../src/lib/sessions.functions.ts");
const inf = await import("../src/lib/introducer.functions.ts");
const bf = await import("../src/lib/booking.functions.ts");
const { supabaseAdminUntyped: userClient } =
  await import("../src/integrations/supabase/client.server.ts");
const REF_SRC = readFileSync(resolve(root, REF_FILE), "utf8");
const SESS_SRC = readFileSync(resolve(root, SESS_FILE), "utf8");
const INTRO_SRC = readFileSync(resolve(root, INTRO_FILE), "utf8");
const BOOKING_SRC = readFileSync(resolve(root, BOOKING_FILE), "utf8");
const CALC_SRC = readFileSync(resolve(root, CALC_FILE), "utf8");

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
/** Simulate a membership-verified /$tenantSlug route context carried in the Referer (or none). */
function context(slug) {
  globalThis.__B2B_REQUEST = slug
    ? new Request("http://app.invalid/_serverFn/x", {
        headers: { referer: `http://app.invalid/${slug}/home` },
      })
    : null;
}
const ctx = (userId) => ({ userId, claims: { sub: userId }, supabase: userClient });
async function call(fn, userId, data, slug = null) {
  context(slug);
  return outcome(() => invoke(fn, data, ctx(userId)));
}

const refRow = (rid) => db.referrals.find((r) => r.id === rid);
const leads = () => db.introducer_leads;
const codesOf = (user) => db.referral_codes.filter((c) => c.referrer_user_id === user);
const FINANCE_TABLES = new Set([
  "finance_ledger",
  "commission_ledger",
  "commission_rates",
  "commissions",
  "commission_payouts",
]);
const financeWrites = () => writes.filter((w) => FINANCE_TABLES.has(w.table));
const linkWrites = () => writes.filter((w) => w.table === "customer_introducer_links");
const leadInput = (extra = {}) => ({
  customerName: "Synthetic Customer",
  customerPhone: "07700900123",
  customerEmail: "cust@example.test",
  sendSms: false,
  ...extra,
});
const manualLeadInput = (extra = {}) => ({
  customerName: "Synthetic Customer",
  customerPhone: "07700900123",
  customerEmail: "cust@example.test",
  ...extra,
});

// ===============================================================================================
// SECTION A — RAF qualification (markReferralQualified + submitSession), tests 1–10
// ===============================================================================================

// 1: same-tenant referral qualifies.
let ra = referral(T.a, U.friend, "pending");
resetDb({ referrals: [ra] });
await rf.markReferralQualified(U.friend, T.a);
ok(
  "B2B-01 same-tenant referral qualifies",
  refRow(ra.id).status === "qualified" && refRow(ra.id).bonus_status === "eligible",
  `status=${refRow(ra.id).status}`,
);

// 2: foreign-tenant referral unchanged.
let rb = referral(T.b, U.friend, "pending");
resetDb({ referrals: [rb] });
await rf.markReferralQualified(U.friend, T.a);
ok(
  "B2B-02 foreign-tenant referral unchanged",
  refRow(rb.id).status === "pending" && refRow(rb.id).bonus_status === "none",
);

// 3: tenantless referral unchanged.
let rn = referral(null, U.friend, "pending");
resetDb({ referrals: [rn] });
await rf.markReferralQualified(U.friend, T.a);
ok(
  "B2B-03 tenantless referral unchanged",
  refRow(rn.id).status === "pending" && refRow(rn.id).bonus_status === "none",
);

// 4: same user in T001 + T002 — only the submitted session's tenant qualifies (via submitSession).
ra = referral(T.a, U.dual, "pending");
rb = referral(T.b, U.dual, "pending");
resetDb({ referrals: [ra, rb] });
let r = await call(sf.submitSession, U.dual, { sessionId: S.b }, "tenant-a");
ok(
  "B2B-04 dual-tenant user: only the session tenant (T002) referral qualifies",
  r.ok && refRow(rb.id).status === "qualified" && refRow(ra.id).status === "pending",
  r.ok ? `a=${refRow(ra.id).status} b=${refRow(rb.id).status}` : r.message,
);

// 5: allowed status transitions preserved (pending → qualified, signed_up → qualified).
ra = referral(T.a, U.friend, "signed_up");
const ra2 = referral(T.a, U.friend, "pending", { code: "ALPHA222" });
resetDb({ referrals: [ra, ra2] });
await rf.markReferralQualified(U.friend, T.a);
ok(
  "B2B-05 allowed transitions (pending/signed_up → qualified) preserved",
  refRow(ra.id).status === "qualified" && refRow(ra2.id).status === "qualified",
);

// 6: disallowed statuses unchanged.
const disallowed = ["paid", "rejected", "qualified", "cancelled"].map((s, i) =>
  referral(T.a, U.friend, s, { code: `ALPHA9${i}0`, bonus_status: "paid" }),
);
resetDb({ referrals: disallowed });
await rf.markReferralQualified(U.friend, T.a);
ok(
  "B2B-06 disallowed statuses unchanged",
  disallowed.every((d) => refRow(d.id).status === d.status && refRow(d.id).bonus_status === "paid"),
);

// 7: a tenantless session (no authoritative tenant) does not qualify; submission still succeeds.
ra = referral(T.a, U.friend, "pending");
rn = referral(null, U.friend, "pending", { code: "NULL1111" });
resetDb({ referrals: [ra, rn] });
db.interview_sessions.find((s) => s.id === S.none).status = "draft";
r = await call(sf.submitSession, U.friend, { sessionId: S.none });
ok(
  "B2B-07 missing session tenant: no qualification, submission preserved",
  r.ok &&
    r.value?.ok === true &&
    db.interview_sessions.find((s) => s.id === S.none).status === "submitted" &&
    refRow(ra.id).status === "pending" &&
    refRow(rn.id).status === "pending",
  r.ok ? "" : r.message,
);
const direct7 = referral(T.a, U.friend, "pending");
resetDb({ referrals: [direct7] });
await rf.markReferralQualified(U.friend, null);
ok(
  "B2B-07b markReferralQualified(user, null) fails closed",
  refRow(direct7.id).status === "pending",
);

// 7c: if the session tenant cannot be read, submission still succeeds and nothing is qualified.
const r7c = referral(T.a, U.friend, "pending");
resetDb({ referrals: [r7c] });
db.failSessionTenantRead = true;
db.interview_sessions.find((s) => s.id === S.a).status = "draft";
r = await call(sf.submitSession, U.friend, { sessionId: S.a });
ok(
  "B2B-07c unreadable session tenant: submission preserved, qualification fails closed",
  r.ok &&
    r.value?.ok === true &&
    db.interview_sessions.find((s) => s.id === S.a).status === "submitted" &&
    refRow(r7c.id).status === "pending",
  r.ok ? "" : r.message,
);

// 8–10: qualification has NO financial / attribution side effect. Fixtures are chosen so the
// deferred ensureRafCommissionLedgerEntry WOULD post a commission row (tenant-stamped referral
// with a referrer) — NC03 proves that, with the call restored, a finance_ledger row appears.
ra = referral(T.a, U.friend, "pending");
resetDb({ referrals: [ra] });
await rf.markReferralQualified(U.friend, T.a);
r = await call(sf.submitSession, U.friend, { sessionId: S.a });
const qualifiedOk = refRow(ra.id).status === "qualified";
ok(
  "B2B-08 qualification creates NO finance_ledger row",
  qualifiedOk &&
    db.finance_ledger.length === 0 &&
    !writes.some((w) => w.table === "finance_ledger"),
);
ok(
  "B2B-09 qualification creates NO commission record",
  qualifiedOk && financeWrites().length === 0 && db.commission_ledger.length === 0,
  `financeWrites=${financeWrites().length}`,
);
ok(
  "B2B-10 qualification creates NO customer_introducer_link",
  qualifiedOk && linkWrites().length === 0 && db.customer_introducer_links.length === 0,
);

// ===============================================================================================
// SECTION B — introducer_leads writers, tests 11–20
// ===============================================================================================

globalThis.__B2B_SMS_LOG ??= [];
const smsMark = globalThis.__B2B_SMS_LOG.length;

// 11: createManualLead stamps the acting registration's tenant (single + A2 dual via context).
resetDb();
r = await call(inf.createManualLead, U.intro, manualLeadInput());
const r11b = await call(inf.createManualLead, U.introDual, manualLeadInput(), "tenant-b");
ok(
  "B2B-11 createManualLead stamps registration tenant",
  r.ok &&
    r11b.ok &&
    leads().length === 2 &&
    leads()[0].tenant_id === T.a &&
    leads()[0].introducer_id === I.intro &&
    leads()[1].tenant_id === T.b &&
    leads()[1].introducer_id === I.introDualB,
  r.ok ? "" : r.message,
);

// 12: createManualLead cannot create a NULL-tenant lead (unbound / ambiguous / no membership).
resetDb();
const m12 = [
  await call(inf.createManualLead, U.introUnbound, manualLeadInput()),
  await call(inf.createManualLead, U.introDual, manualLeadInput()), // 2 tenants, no context
  await call(inf.createManualLead, U.none, manualLeadInput()),
];
ok(
  "B2B-12 createManualLead cannot create NULL tenant lead",
  m12.every((x) => !x.ok) && leads().length === 0,
);

// 13: caller cannot override the manual-lead tenant (payload tenant_id / foreign context).
resetDb();
const r13a = await call(
  inf.createManualLead,
  U.intro,
  manualLeadInput({ tenant_id: T.b, tenantId: T.b }),
);
const r13b = await call(inf.createManualLead, U.intro, manualLeadInput(), "tenant-b");
ok(
  "B2B-13 caller cannot override manual-lead tenant",
  r13a.ok && !r13b.ok && leads().length === 1 && leads()[0].tenant_id === T.a,
);

// 14: staff booking-link lead stamps the staff introducer's tenant.
resetDb();
r = await call(bf.sendStaffCustomerBookingLink, U.staff, leadInput());
ok(
  "B2B-14 staff booking-link lead stamps introducer tenant",
  r.ok &&
    leads().length === 1 &&
    leads()[0].tenant_id === T.a &&
    leads()[0].introducer_id === I.staff &&
    String(r.value?.bookUrl).includes("/tenant-a/"),
  r.ok ? "" : r.message,
);

// 15: staff writer cannot create a NULL-tenant lead (ambiguous staff fails closed; guard present).
resetDb();
const r15 = await call(bf.sendStaffCustomerBookingLink, U.staffDual, leadInput());
const staffBlock = sliceConst(BOOKING_SRC, "sendStaffCustomerBookingLink");
ok(
  "B2B-15 staff booking-link writer cannot create NULL tenant lead",
  !r15.ok &&
    leads().length === 0 &&
    /if \(!introducer\.tenant_id\) throw new Error\(/.test(staffBlock),
);

// 16: foreign / caller tenant cannot override the staff lead tenant.
resetDb();
const r16a = await call(bf.sendStaffCustomerBookingLink, U.staff, leadInput({ tenant_id: T.b }));
const r16b = await call(bf.sendStaffCustomerBookingLink, U.staff, leadInput(), "tenant-b");
ok(
  "B2B-16 foreign/caller tenant cannot override staff lead",
  r16a.ok && !r16b.ok && leads().length === 1 && leads()[0].tenant_id === T.a,
);

// 17: introducer-portal booking-link lead stamps the introducer tenant (single + A2 dual).
resetDb();
r = await call(bf.sendIntroducerCustomerBookingLink, U.intro, leadInput());
const r17b = await call(bf.sendIntroducerCustomerBookingLink, U.introDual, leadInput(), "tenant-b");
ok(
  "B2B-17 portal booking-link lead stamps introducer tenant",
  r.ok &&
    r17b.ok &&
    leads().length === 2 &&
    leads()[0].tenant_id === T.a &&
    leads()[1].tenant_id === T.b &&
    leads()[1].introducer_id === I.introDualB,
  r.ok ? (r17b.ok ? "" : r17b.message) : r.message,
);

// 18: portal writer cannot create a NULL-tenant lead.
resetDb();
const m18 = [
  await call(bf.sendIntroducerCustomerBookingLink, U.introUnbound, leadInput()),
  await call(bf.sendIntroducerCustomerBookingLink, U.introDual, leadInput()),
  await call(bf.sendIntroducerCustomerBookingLink, U.none, leadInput()),
];
const portalBlock = sliceConst(BOOKING_SRC, "sendIntroducerCustomerBookingLink");
ok(
  "B2B-18 portal writer cannot create NULL tenant lead",
  m18.every((x) => !x.ok) &&
    leads().length === 0 &&
    /if \(!introducer\.tenant_id\) throw new Error\(/.test(portalBlock),
);

// 19: foreign / caller tenant cannot override the portal lead tenant.
resetDb();
const r19a = await call(
  bf.sendIntroducerCustomerBookingLink,
  U.intro,
  leadInput({ tenant_id: T.b }),
);
const r19b = await call(bf.sendIntroducerCustomerBookingLink, U.intro, leadInput(), "tenant-b");
ok(
  "B2B-19 foreign/caller tenant cannot override portal lead",
  r19a.ok && !r19b.ok && leads().length === 1 && leads()[0].tenant_id === T.a,
);

// 20: calculator writer remains correctly tenant stamped (unchanged; source-level).
ok(
  "B2B-20 calculator writer remains tenant stamped + fails closed when unbound",
  /from\("introducer_leads"\)\s*\.insert\(\s*withForcedTenantId\(\s*\{[\s\S]*?\},\s*introducer\.tenant_id,\s*\),/.test(
    CALC_SRC,
  ) && /if \(!introducer\.tenant_id\) \{\s*throw new TenantContextError\(/.test(CALC_SRC),
);

// ===============================================================================================
// SECTION C — RAF self-service on the canonical acting tenant, tests 21–31
// ===============================================================================================

// 21: ensureMyReferralLink single tenant works.
resetDb();
r = await call(rf.ensureMyReferralLink, U.referrer, undefined);
ok(
  "B2B-21 ensureMyReferralLink single tenant works",
  r.ok &&
    r.value?.tenantSlug === "tenant-a" &&
    codesOf(U.referrer).length === 1 &&
    codesOf(U.referrer)[0].tenant_id === T.a &&
    codesOf(U.referrer)[0].code === r.value.code,
  r.ok ? "" : r.message,
);

// 22: A2 dual-tenant + verified T001 context → T001 (existing T001 code reused).
resetDb();
r = await call(rf.ensureMyReferralLink, U.dual, undefined, "tenant-a");
ok(
  "B2B-22 ensureMyReferralLink dual + T001 context → T001",
  r.ok &&
    r.value?.tenantSlug === "tenant-a" &&
    r.value.code === "DUALA111" &&
    codesOf(U.dual).length === 1,
  r.ok ? "" : r.message,
);

// 23: A2 dual-tenant + verified T002 context → T002 (a T002 code, never the T001 one).
resetDb();
r = await call(rf.ensureMyReferralLink, U.dual, undefined, "tenant-b");
const t23 = codesOf(U.dual).find((c) => c.tenant_id === T.b);
ok(
  "B2B-23 ensureMyReferralLink dual + T002 context → T002",
  r.ok &&
    r.value?.tenantSlug === "tenant-b" &&
    r.value.code !== "DUALA111" &&
    t23?.code === r.value.code,
  r.ok ? "" : r.message,
);

// 24: ambiguous (2+ memberships, no verified context) or no authority → fail closed, no code.
resetDb();
const e24 = [
  await call(rf.ensureMyReferralLink, U.dual, undefined),
  await call(rf.ensureMyReferralLink, U.none, undefined),
  await call(rf.ensureMyReferralLink, U.friend, undefined, "tenant-b"), // non-member slug
];
ok(
  "B2B-24 ensureMyReferralLink ambiguous/no acting tenant → fail closed",
  e24.every((x) => !x.ok) &&
    db.referral_codes.length === 1 &&
    !writes.some((w) => w.table === "referral_codes"),
);

// 25: sendMyReferralLink single tenant works (email channel: link built, nothing sent).
resetDb();
r = await call(rf.sendMyReferralLink, U.referrer, { channel: "email" });
const code25 = codesOf(U.referrer)[0]?.code;
ok(
  "B2B-25 sendMyReferralLink single tenant works",
  r.ok &&
    code25 &&
    String(r.value?.link).endsWith(`/tenant-a/raf/${code25}`) &&
    codesOf(U.referrer)[0].tenant_id === T.a,
  r.ok ? String(r.value?.link) : r.message,
);

// 26: A2 dual + T001 → T001 link with the T001 code.
resetDb();
r = await call(rf.sendMyReferralLink, U.dual, { channel: "email" }, "tenant-a");
ok(
  "B2B-26 sendMyReferralLink dual + T001 → T001",
  r.ok && String(r.value?.link).endsWith("/tenant-a/raf/DUALA111"),
  r.ok ? String(r.value?.link) : r.message,
);

// 27: A2 dual + T002 → T002 link with a T002 code.
resetDb();
r = await call(rf.sendMyReferralLink, U.dual, { channel: "email" }, "tenant-b");
const t27 = codesOf(U.dual).find((c) => c.tenant_id === T.b);
ok(
  "B2B-27 sendMyReferralLink dual + T002 → T002",
  r.ok && t27 && String(r.value?.link).endsWith(`/tenant-b/raf/${t27.code}`),
  r.ok ? String(r.value?.link) : r.message,
);

// 28: ambiguous / no acting tenant → fail closed; nothing created, nothing sent.
resetDb();
const e28 = [
  await call(rf.sendMyReferralLink, U.dual, { channel: "email" }),
  await call(rf.sendMyReferralLink, U.dual, { channel: "sms" }),
  await call(rf.sendMyReferralLink, U.none, { channel: "email" }),
];
ok(
  "B2B-28 sendMyReferralLink ambiguous/no acting tenant → fail closed",
  e28.every((x) => !x.ok) && db.referral_codes.length === 1 && globalThis.__B2B_SMS.length === 0,
);

// 29: no first-membership fallback anywhere in B2b scope (dual users without context fail closed).
resetDb();
const e29 = [
  await call(rf.ensureMyReferralLink, U.dual, undefined),
  await call(rf.sendMyReferralLink, U.dual, { channel: "email" }),
  await call(inf.createManualLead, U.introDual, manualLeadInput()),
  await call(bf.sendIntroducerCustomerBookingLink, U.introDual, leadInput()),
];
ok(
  "B2B-29 no first-membership fallback",
  e29.every((x) => !x.ok) && leads().length === 0 && db.referral_codes.length === 1,
);

// 30: holding a referral code cannot establish the acting tenant.
resetDb();
const r30a = await call(rf.ensureMyReferralLink, U.dual, undefined, "tenant-b");
const r30b = await call(rf.ensureMyReferralLink, U.dual, undefined);
ok(
  "B2B-30 referral code cannot establish acting tenant",
  r30a.ok && r30a.value.tenantSlug === "tenant-b" && r30a.value.code !== "DUALA111" && !r30b.ok,
);

// 31: T001/T002 isolation end-to-end in the harness.
ra = referral(T.a, U.dual, "pending");
rb = referral(T.b, U.dual, "pending");
resetDb({ referrals: [ra, rb] });
const e31 = {
  codeA: await call(rf.ensureMyReferralLink, U.dual, undefined, "tenant-a"),
  codeB: await call(rf.ensureMyReferralLink, U.dual, undefined, "tenant-b"),
  submitA: await call(sf.submitSession, U.dual, { sessionId: S.dualA }, "tenant-a"),
  leadA: await call(inf.createManualLead, U.introDual, manualLeadInput(), "tenant-a"),
  leadB: await call(bf.sendIntroducerCustomerBookingLink, U.introDual, leadInput(), "tenant-b"),
};
ok(
  "B2B-31 T001/T002 isolation end-to-end",
  Object.values(e31).every((x) => x.ok) &&
    e31.codeA.value.tenantSlug === "tenant-a" &&
    e31.codeB.value.tenantSlug === "tenant-b" &&
    e31.codeA.value.code !== e31.codeB.value.code &&
    refRow(ra.id).status === "qualified" &&
    refRow(rb.id).status === "pending" &&
    leads().length === 2 &&
    leads().find((l) => l.introducer_id === I.introDualA)?.tenant_id === T.a &&
    leads().find((l) => l.introducer_id === I.introDualB)?.tenant_id === T.b &&
    leads().every((l) => l.tenant_id) &&
    financeWrites().length === 0 &&
    linkWrites().length === 0,
  Object.entries(e31)
    .filter(([, x]) => !x.ok)
    .map(([k, x]) => `${k}: ${x.message}`)
    .join("; "),
);

// ===============================================================================================
// SECTION D — supplementary guards
// ===============================================================================================

// 32: membership is still required — platform Enter Company into a foreign company cannot mint a code.
resetDb();
globalThis.__B2B_PLATFORM = ({ userId, tenantId }) =>
  userId === U.platform && tenantId === T.a
    ? { accessLevel: "operational_admin", basisLabel: "synthetic" }
    : null;
r = await call(rf.ensureMyReferralLink, U.platform, undefined, "tenant-a");
ok(
  "B2B-32 platform entry (non-member) cannot mint a RAF code",
  !r.ok && codesOf(U.platform).length === 0,
);

// 33: submitSession reads the session tenant and passes it (not a referral/cookie/membership value).
function guard_submitPassesSessionTenant(src) {
  const b = sliceConst(src, "submitSession");
  return (
    /const sessionTenantId = await loadSessionTenantMap\(\[data\.sessionId\]\)/.test(b) &&
    /\.then\(\(m\) => m\.get\(data\.sessionId\) \?\? null\)\s*\.catch\(\(\) => null\);/.test(b) &&
    /await markReferralQualified\(context\.userId, sessionTenantId\);/.test(b)
  );
}
ok(
  "B2B-33 submitSession passes the session's own tenant",
  guard_submitPassesSessionTenant(SESS_SRC),
);

// 34: the RAF financial posting stays deferred to B4 in the qualification path.
function guard_financeDeferred(src) {
  const b = sliceFn(src, "markReferralQualified");
  return (
    !/ensureRafCommissionLedgerEntry\s*\(/.test(b) &&
    !/import\("@\/lib\/finance\.functions"\)/.test(b) &&
    /G7F-4S4C4-B4/.test(b)
  );
}
ok(
  "B2B-34 RAF finance posting deferred to B4 (no call from qualification)",
  guard_financeDeferred(REF_SRC),
);

// 35: RAF self-service uses the canonical acting tenant; no sole-membership resolver remains.
function guard_rafCanonical(src) {
  const ensure = sliceConst(src, "ensureMyReferralLink");
  const send = sliceConst(src, "sendMyReferralLink");
  const helper = sliceFn(src, "resolveRafSelfServiceTenant");
  return (
    /resolveRafSelfServiceTenant\(actingUserId\)/.test(ensure) &&
    /resolveRafSelfServiceTenant\(context\.userId\)/.test(send) &&
    !/resolveSoleMembershipTenant/.test(ensure + send) &&
    /await resolveActingTenant\(userId\)/.test(helper) &&
    /!view\.member/.test(helper)
  );
}
ok("B2B-35 RAF self-service on canonical acting tenant (source)", guard_rafCanonical(REF_SRC));

// 36: all three previously unstamped writers force the tenant via withForcedTenantId (source).
ok(
  "B2B-36 three lead writers stamp via withForcedTenantId (source)",
  /withForcedTenantId\([\s\S]*?registration\.tenantId,/.test(
    sliceConst(INTRO_SRC, "createManualLead"),
  ) &&
    /withForcedTenantId\([\s\S]*?introducer\.tenant_id,/.test(staffBlock) &&
    /withForcedTenantId\([\s\S]*?introducer\.tenant_id,/.test(portalBlock),
);

// 37: the lead writers and RAF self-service under test dispatched no SMS (stub only; sendSms=false).
ok(
  "B2B-37 no SMS dispatched by lead/RAF paths under test",
  globalThis.__B2B_SMS_LOG.length === smsMark,
  `sms=${globalThis.__B2B_SMS_LOG.length - smsMark}`,
);

// --- source helpers ----------------------------------------------------------------------------
function sliceFn(src, name) {
  const m = new RegExp(`(?:export )?(?:async )?function ${name}\\b`).exec(src);
  if (!m) return "";
  return topLevelBlock(src, m.index, m[0].length);
}
function sliceConst(src, name) {
  const m = new RegExp(`export const ${name}\\b`).exec(src);
  if (!m) return "";
  return topLevelBlock(src, m.index, m[0].length);
}
function topLevelBlock(src, index, headLen) {
  const rest = src.slice(index);
  const end = /\n(?=export |async function |function |const |let |type |interface |\/\*\*)/.exec(
    rest.slice(headLen),
  );
  return (end ? rest.slice(0, headLen + end.index) : rest).trimEnd();
}

// ===============================================================================================
// NEGATIVE CONTROLS — each reverts a B2b guard and proves the unsafe effect is detected.
// ===============================================================================================
function replaceBlock(src, name, pairs) {
  const start = new RegExp(`(?:export )?(?:async )?(?:function|const) ${name}\\b`, "m").exec(src);
  if (!start) return null;
  const block = topLevelBlock(src, start.index, start[0].length);
  let changed = block;
  for (const [from, to] of pairs) {
    const next = changed.split(from).join(to);
    if (next === changed) return null;
    changed = next;
  }
  return src.replace(block, changed);
}
const NO_OP_STAMP = "const withForcedTenantId = (payload: any, _tenantId: any) => payload;";
const STAMP_IMPORT = 'const { withForcedTenantId } = await import("@/lib/tenant-assert.server");';
const FIRST_MEMBERSHIP = `
  const { supabaseAdminUntyped: __db } = await import("@/integrations/supabase/client.server");
  const { data: __m } = await __db.from("tenant_memberships").select("tenant_id").eq("user_id", userId).eq("active", true).limit(1).maybeSingle();
  const { data: __t } = await __db.from("tenants").select("slug").eq("id", __m?.tenant_id ?? "").maybeSingle();
  const tenantId = __m?.tenant_id;
  const view = { member: Boolean(__m), tenantSlug: __t?.slug ?? null };`;

const NEGATIVE_CONTROLS = [
  {
    name: "NC01 remove qualification tenant predicate → foreign referral qualified",
    async detect() {
      const m = replaceBlock(REF_SRC, "markReferralQualified", [
        ['      .eq("tenant_id", tenantId)\n      .in("status"', '      .in("status"'],
      ]);
      if (!m) return false;
      const mod = await loadMutant(m);
      const foreign = referral(T.b, U.friend, "pending");
      resetDb({ referrals: [foreign] });
      await mod.markReferralQualified(U.friend, T.a);
      return refRow(foreign.id).status === "qualified";
    },
  },
  {
    name: "NC02 permit tenantless qualification → tenantless session qualifies referrals",
    async detect() {
      const m = replaceBlock(REF_SRC, "markReferralQualified", [
        [
          "  if (!tenantId) return;\n",
          `  if (!tenantId) {
    const { supabaseAdminUntyped: __sa } = await import("@/integrations/supabase/client.server");
    await __sa.from("referrals").update({ status: "qualified", bonus_status: "eligible" }).eq("referred_user_id", referredUserId).in("status", ["pending", "signed_up"]);
    return;
  }\n`,
        ],
      ]);
      if (!m) return false;
      const mod = await loadMutant(m);
      const tl = referral(null, U.friend, "pending");
      const fr = referral(T.b, U.friend, "pending", { code: "BRAVO222" });
      resetDb({ referrals: [tl, fr] });
      await mod.markReferralQualified(U.friend, null);
      return refRow(tl.id).status === "qualified" || refRow(fr.id).status === "qualified";
    },
  },
  {
    name: "NC03 restore ensureRafCommissionLedgerEntry call → finance_ledger commission row created",
    async detect() {
      const m = replaceBlock(REF_SRC, "markReferralQualified", [
        [
          "const { error } = await supabaseAdmin",
          "const { data: updated, error } = await supabaseAdmin",
        ],
        [
          '.in("status", ["pending", "signed_up"]);',
          '.in("status", ["pending", "signed_up"])\n      .select("id");',
        ],
        [
          "    // B2b TEMPORARY FINANCIAL GUARD",
          '    const { ensureRafCommissionLedgerEntry } = await import("@/lib/finance.functions");\n    for (const row of updated ?? []) await ensureRafCommissionLedgerEntry(row.id);\n    // B2b TEMPORARY FINANCIAL GUARD',
        ],
      ]);
      if (!m) return false;
      const mod = await loadMutant(m);
      const same = referral(T.a, U.friend, "pending");
      resetDb({ referrals: [same] });
      await mod.markReferralQualified(U.friend, T.a);
      return db.finance_ledger.some((f) => f.kind === "commission" && f.referral_id === same.id);
    },
  },
  {
    name: "NC04 remove createManualLead tenant stamp → tenantless lead",
    async detect() {
      const m = replaceBlock(INTRO_SRC, "createManualLead", [[STAMP_IMPORT, NO_OP_STAMP]]);
      if (!m) return false;
      const mod = await loadMutant(m);
      resetDb();
      const res = await call(mod.createManualLead, U.intro, manualLeadInput());
      return res.ok && leads().length === 1 && !leads()[0].tenant_id;
    },
  },
  {
    name: "NC05 remove staff booking-link tenant stamp → tenantless lead",
    async detect() {
      const m = replaceBlock(BOOKING_SRC, "sendStaffCustomerBookingLink", [
        [STAMP_IMPORT, NO_OP_STAMP],
      ]);
      if (!m) return false;
      const mod = await loadMutant(m);
      resetDb();
      const res = await call(mod.sendStaffCustomerBookingLink, U.staff, leadInput());
      return res.ok && leads().length === 1 && !leads()[0].tenant_id;
    },
  },
  {
    name: "NC06 remove portal booking-link tenant stamp → tenantless lead",
    async detect() {
      const m = replaceBlock(BOOKING_SRC, "sendIntroducerCustomerBookingLink", [
        [STAMP_IMPORT, NO_OP_STAMP],
      ]);
      if (!m) return false;
      const mod = await loadMutant(m);
      resetDb();
      const res = await call(mod.sendIntroducerCustomerBookingLink, U.intro, leadInput());
      return res.ok && leads().length === 1 && !leads()[0].tenant_id;
    },
  },
  {
    name: "NC07 allow caller tenant override on manual lead → lead lands in foreign tenant",
    async detect() {
      const m = replaceBlock(INTRO_SRC, "createManualLead", [
        [
          "        notes: z.string().max(500).optional(),\n",
          "        notes: z.string().max(500).optional(),\n        tenantId: z.string().optional(),\n",
        ],
        [
          "          registration.tenantId,\n",
          "          (data as any).tenantId ?? registration.tenantId,\n",
        ],
      ]);
      if (!m) return false;
      const mod = await loadMutant(m);
      resetDb();
      const res = await call(mod.createManualLead, U.intro, manualLeadInput({ tenantId: T.b }));
      return res.ok && leads().length === 1 && leads()[0].tenant_id === T.b;
    },
  },
  {
    name: "NC08 restore first-membership fallback in RAF self-service → verified T002 context gets T001",
    async detect() {
      const m = replaceBlock(REF_SRC, "resolveRafSelfServiceTenant", [
        ["  const { tenantId, view } = await resolveActingTenant(userId);", FIRST_MEMBERSHIP],
      ]);
      if (!m) return false;
      const mod = await loadMutant(m);
      resetDb();
      const res = await call(mod.ensureMyReferralLink, U.dual, undefined, "tenant-b");
      return res.ok && res.value.tenantSlug === "tenant-a";
    },
  },
  {
    name: "NC09 allow ambiguous 2+ membership selection → ambiguous user mints a code",
    async detect() {
      const m = replaceBlock(REF_SRC, "resolveRafSelfServiceTenant", [
        [
          "  const { tenantId, view } = await resolveActingTenant(userId);",
          `  let tenantId: any; let view: any;
  try {
    ({ tenantId, view } = await resolveActingTenant(userId));
  } catch {
    ${FIRST_MEMBERSHIP.replace("const tenantId = ", "tenantId = ").replace("const view = ", "view = ")}
  }`,
        ],
      ]);
      if (!m) return false;
      const mod = await loadMutant(m);
      resetDb();
      const res = await call(mod.ensureMyReferralLink, U.dual, undefined);
      return res.ok && typeof res.value?.code === "string";
    },
  },
  {
    name: "NC10 derive RAF tenant from an existing referral code → T002 context gets T001 code",
    async detect() {
      const m = replaceBlock(REF_SRC, "resolveRafSelfServiceTenant", [
        [
          "  const { tenantId, view } = await resolveActingTenant(userId);",
          `  const { supabaseAdminUntyped: __db } = await import("@/integrations/supabase/client.server");
  const { data: __c } = await __db.from("referral_codes").select("tenant_id").eq("referrer_user_id", userId).limit(1).maybeSingle();
  let tenantId: any; let view: any;
  if (__c?.tenant_id) {
    const { data: __t } = await __db.from("tenants").select("slug").eq("id", __c.tenant_id).maybeSingle();
    tenantId = __c.tenant_id; view = { member: true, tenantSlug: __t?.slug ?? null };
  } else {
    ({ tenantId, view } = await resolveActingTenant(userId));
  }`,
        ],
      ]);
      if (!m) return false;
      const mod = await loadMutant(m);
      resetDb();
      const res = await call(mod.ensureMyReferralLink, U.dual, undefined, "tenant-b");
      return res.ok && res.value.tenantSlug === "tenant-a" && res.value.code === "DUALA111";
    },
  },
  {
    name: "NC11 submitSession derives qualification tenant from the referral → tenantless session qualifies",
    async detect() {
      const m = replaceBlock(SESS_SRC, "submitSession", [
        [
          "await markReferralQualified(context.userId, sessionTenantId);",
          `const { supabaseAdminUntyped: __sa } = await import("@/integrations/supabase/client.server");
    const { data: __ref } = await __sa.from("referrals").select("tenant_id").eq("referred_user_id", context.userId).limit(1).maybeSingle();
    await markReferralQualified(context.userId, sessionTenantId ?? __ref?.tenant_id ?? null);`,
        ],
      ]);
      if (!m) return false;
      const mod = await loadMutant(m);
      const ref = referral(T.a, U.friend, "pending");
      resetDb({ referrals: [ref] });
      const res = await call(mod.submitSession, U.friend, { sessionId: S.none });
      return res.ok && refRow(ref.id).status === "qualified";
    },
  },
  {
    name: "NC12 drop RAF membership requirement → platform entry (non-member) mints a code",
    async detect() {
      const m = replaceBlock(REF_SRC, "resolveRafSelfServiceTenant", [
        ["if (!view.member || !view.tenantSlug) {", "if (!view.tenantSlug) {"],
      ]);
      if (!m) return false;
      const mod = await loadMutant(m);
      resetDb();
      globalThis.__B2B_PLATFORM = ({ userId, tenantId }) =>
        userId === U.platform && tenantId === T.a
          ? { accessLevel: "operational_admin", basisLabel: "synthetic" }
          : null;
      const res = await call(mod.ensureMyReferralLink, U.platform, undefined, "tenant-a");
      return res.ok && codesOf(U.platform).length === 1;
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

const testFailures = failures.filter((f) => f.startsWith("B2B-")).length;
console.log(`\nTEST_CASES=${total}`);
console.log(`NEGATIVE_CONTROL_COUNT=${NEGATIVE_CONTROLS.length}`);
console.log(
  `NEGATIVE_CONTROLS_PASS=${ncPassed === NEGATIVE_CONTROLS.length ? "yes" : "no"} (${ncPassed}/${NEGATIVE_CONTROLS.length})`,
);
console.log(
  `RESULT=${failures.length === 0 ? "PASS" : "FAIL"} (${total - testFailures}/${total} tests)`,
);
if (failures.length) {
  console.error(`FAILURES: ${failures.join(", ")}`);
  if (process.env.B2B_DEBUG) for (const l of logs.slice(-40)) process.stderr.write(`${l}\n`);
  process.exit(1);
}
console.log("ALL B2B CHECKS PASSED");
