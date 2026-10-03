/**
 * G7F-4S4C4-A1 acting-tenant introducer registration resolver — offline verification.
 *
 * Real portal server-function validators and handlers run against an in-memory PostgREST fake on
 * a non-routable host. The fixture models the FUTURE multi-registration contract synthetically
 * (one Auth user with a Tenant A and a Tenant B registration); the real schema keeps
 * UNIQUE(user_id) until A2. The user client is emulated with the A0 grants (no INSERT, UPDATE
 * only company_name/contact_email, SELECT own rows). Synthetic fixtures only: no database, no
 * network, no production, no real identity, no phone numbers, no SMS (sms.server is stubbed).
 * Run: npm exec --yes --package=tsx -- tsx scripts/g7f4s4c4a1-introducer-registration-verify.mjs
 */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { register } from "node:module";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

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
  "STAGING_TWILIO_ALLOW_LIVE",
  "ADMIN_EMAILS",
]) {
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
async function outcome(fn) {
  try {
    return { ok: true, value: await fn() };
  } catch (e) {
    return { ok: false, error: e, message: String(e?.message ?? e) };
  }
}
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const read = (rel) => readFileSync(resolve(root, rel), "utf8");
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
function topLevelDeclaration(src, name) {
  const start = new RegExp(`^(?:export )?(?:async )?(?:function|const) ${name}\\b`, "m").exec(src);
  if (!start) return null;
  const rest = src.slice(start.index);
  const end =
    /\n(?=export |async function |function |const |let |type |interface |\/\*\*|\/\/ )/.exec(
      rest.slice(start[0].length),
    );
  return (end ? rest.slice(0, start[0].length + end.index) : rest).trimEnd();
}

// --- module stubs: createServerFn capture, request Referer, platform entry, SMS -----------------
const realStartUrl = import.meta.resolve("@tanstack/react-start");
const realStartServerUrl = import.meta.resolve("@tanstack/react-start/server");
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
export function getRequest() { return globalThis.__A1_REQUEST ?? null; }
export function getCookie() { return undefined; }
export function setCookie() {}
export function deleteCookie() {}
`;
const stubPlatform = `
export async function validatePlatformTenantAccessSession() { return null; }
export async function hasValidPlatformTenantAccess() { return false; }
export async function clearPlatformTenantEntryOnLogout() {}
`;
// Booking SMS helpers: "configured", nothing leaves the process, phone input passes through.
const stubSms = `
export function bookingConfirmationMessage() { return "Synthetic confirmation"; }
export function callbackConfirmationMessage() { return "Synthetic callback"; }
export function getAppBaseUrl() { return "http://app.invalid"; }
export function getSmsSenderLabel() { return "SYNTHETIC-SENDER"; }
export function isTwilioConfigured() { return true; }
export function normaliseUkPhone(value) { return String(value); }
export async function sendSms(opts) { globalThis.__A1_SMS.push(opts); return { sid: "SYNTHETIC-SID" }; }
export async function textChannelInviteMessage(opts) { return "Synthetic invite " + opts.bookUrl; }
`;
const dataUrl = (src) => `data:text/javascript,${encodeURIComponent(src)}`;
const hookSource = `
const fromData = (ctx) => String(ctx.parentURL ?? "").startsWith("data:");
const fromBooking = (ctx) => /booking\\.functions\\.ts$/.test(String(ctx.parentURL ?? ""));
export async function resolve(specifier, context, next) {
  if (specifier === "@tanstack/react-start" && !fromData(context)) {
    return { url: ${JSON.stringify(dataUrl(stubStart))}, shortCircuit: true };
  }
  if (specifier === "@tanstack/react-start/server" && !fromData(context)) {
    return { url: ${JSON.stringify(dataUrl(stubStartServer))}, shortCircuit: true };
  }
  if (/platform-tenant-entry\\.server(\\.ts)?$/.test(specifier)) {
    return { url: ${JSON.stringify(dataUrl(stubPlatform))}, shortCircuit: true };
  }
  if (fromBooking(context) && /\\/sms\\.server(\\.ts)?$/.test(specifier)) {
    return { url: ${JSON.stringify(dataUrl(stubSms))}, shortCircuit: true };
  }
  return next(specifier, context);
}
`;
register(dataUrl(hookSource), import.meta.url);
globalThis.__A1_SMS = [];

// --- synthetic fixtures ------------------------------------------------------------------------
const FAKE_HOST = "g7f4s4c4a1.invalid";
const PUBLIC_KEY = "synthetic-public-key-g7f4s4c4a1-not-real";
process.env.SUPABASE_URL = `http://${FAKE_HOST}`;
process.env.VITE_SUPABASE_URL = `http://${FAKE_HOST}`;
process.env.SUPABASE_SERVICE_ROLE_KEY = "synthetic-service-key-g7f4s4c4a1-not-real";
process.env.SUPABASE_PUBLISHABLE_KEY = PUBLIC_KEY;
process.env.VITE_SUPABASE_PUBLISHABLE_KEY = PUBLIC_KEY;

const id = (prefix, n) =>
  `${prefix}${String(n).repeat(7).slice(0, 7)}-0000-4000-8000-${String(n).padStart(12, "0")}`;
const T = { a: id("1", 1), b: id("1", 2), c: id("1", 3) };
const U = {
  x: id("2", 1), // introducer in Tenant A AND Tenant B (future BR8 model)
  y: id("2", 2), // introducer in Tenant A only
  w: id("2", 3), // introducer member of A, registration only in B
  g: id("2", 4), // introducer member of A, legacy tenantless registration only
  d: id("2", 5), // two Tenant A registrations (ambiguous)
  z: id("2", 6), // introducer member of C, no registration anywhere
  n: id("2", 7), // registration in A but no introducer capacity in A (customer)
  e: id("2", 8), // introducer member of A whose email/phone/code/slug match Y's registration
  ownerA: id("3", 1),
  ownerB: id("3", 2),
  advA: id("3", 3),
};
const I = {
  xa: id("4", 1),
  xb: id("4", 2),
  ya: id("4", 3),
  wb: id("4", 4),
  gNull: id("4", 5),
  d1: id("4", 6),
  d2: id("4", 7),
  na: id("4", 8),
};
const LEAD = { xa: id("5", 1), xb: id("5", 2) };
const APPT = { xa: id("6", 1), xb: id("6", 2) };
const SECRET_B = "TENANT-B-ONLY";
const E_EMAIL = "e.person@example.test";
const E_PHONE = "SYNTHETIC-PHONE-E";

const now = Date.now();
const daysAgo = (d) => new Date(now - d * 86400000).toISOString();

let db;
function resetDb() {
  const mem = (user_id, tenant_id, role, active = true) => ({
    id: randomUUID(),
    user_id,
    tenant_id,
    role,
    active,
  });
  const reg = (rid, user_id, tenant_id, extra = {}) => ({
    id: rid,
    user_id,
    tenant_id,
    company_name: `Company ${rid.slice(0, 2)}`,
    slug: `slug-${rid.slice(0, 2)}`,
    contact_email: null,
    company_code: `C${rid.slice(0, 2)}`,
    active: true,
    deleted_at: null,
    created_at: daysAgo(30),
    ...extra,
  });
  db = {
    tenants: [
      { id: T.a, slug: "tenant-a", company_name: "Tenant A", status: "active" },
      { id: T.b, slug: "tenant-b", company_name: "Tenant B", status: "active" },
      { id: T.c, slug: "tenant-c", company_name: "Tenant C", status: "active" },
    ],
    tenant_memberships: [
      mem(U.x, T.a, "introducer"),
      mem(U.x, T.b, "introducer"),
      mem(U.y, T.a, "introducer"),
      mem(U.w, T.a, "introducer"),
      mem(U.w, T.b, "introducer"),
      mem(U.g, T.a, "introducer"),
      mem(U.d, T.a, "introducer"),
      mem(U.z, T.c, "introducer"),
      mem(U.n, T.a, "customer"),
      mem(U.e, T.a, "introducer"),
      mem(U.ownerA, T.a, "owner"),
      mem(U.ownerB, T.b, "owner"),
      mem(U.advA, T.a, "adviser"),
    ],
    admin_permissions: [],
    profiles: [
      { id: U.x, full_name: "Synthetic X", email: "x.person@example.test", phone: null },
      { id: U.e, full_name: "Synthetic E", email: E_EMAIL, phone: E_PHONE },
      { id: U.advA, full_name: "Synthetic Adviser", email: "adv@example.test", phone: null },
    ],
    introducers: [
      reg(I.xa, U.x, T.a, { company_name: "X Alpha Ltd", slug: "x-alpha", company_code: "1111" }),
      reg(I.xb, U.x, T.b, {
        company_name: `X Bravo Ltd ${SECRET_B}`,
        slug: "x-bravo",
        company_code: "2222",
      }),
      // Y's registration carries E's email, phone-like data, a code and slug E could know.
      reg(I.ya, U.y, T.a, {
        company_name: "Y Alpha Ltd",
        slug: "e-person",
        company_code: "3333",
        contact_email: E_EMAIL,
      }),
      reg(I.wb, U.w, T.b, { company_name: `W Bravo Ltd ${SECRET_B}`, slug: "w-bravo" }),
      reg(I.gNull, U.g, null, { company_name: "G Legacy Global Ltd", slug: "g-legacy" }),
      reg(I.d1, U.d, T.a, { slug: "d-one" }),
      reg(I.d2, U.d, T.a, { slug: "d-two" }),
      reg(I.na, U.n, T.a, { slug: "n-alpha" }),
    ],
    introducer_leads: [
      {
        id: LEAD.xa,
        introducer_id: I.xa,
        customer_name: "Alpha Lead",
        customer_email: null,
        customer_phone: "SYNTH-LEAD-A",
        status: "new",
        lead_source: "introducer_portal",
        channel: "manual",
        created_at: daysAgo(5),
        appointment_id: null,
      },
      {
        id: LEAD.xb,
        introducer_id: I.xb,
        customer_name: `Bravo Lead ${SECRET_B}`,
        customer_email: null,
        customer_phone: "SYNTH-LEAD-B",
        status: "new",
        lead_source: "introducer_portal",
        channel: "manual",
        created_at: daysAgo(4),
        appointment_id: null,
      },
    ],
    appointments: [
      {
        id: APPT.xa,
        tenant_id: T.a,
        introducer_id: I.xa,
        advisor_id: U.advA,
        session_id: null,
        status: "confirmed",
        lead_source: "introducer_portal",
        referral_channel: null,
        customer_name: "Alpha Appointment",
        customer_email: null,
        customer_phone: null,
        starts_at: daysAgo(-3),
        created_at: daysAgo(6),
      },
      {
        id: APPT.xb,
        tenant_id: T.b,
        introducer_id: I.xb,
        advisor_id: null,
        session_id: null,
        status: "confirmed",
        lead_source: "introducer_portal",
        referral_channel: null,
        customer_name: `Bravo Appointment ${SECRET_B}`,
        customer_email: null,
        customer_phone: null,
        starts_at: daysAgo(-2),
        created_at: daysAgo(5),
      },
    ],
    interview_sessions: [],
    customer_journey_milestones: [],
    session_contact_tracking: [],
    sms_messages: [],
    view_as_audit_log: [],
    communication_templates: [],
    communication_settings: [],
  };
  writes.length = 0;
  introducerReads.length = 0;
  globalThis.__A1_SMS.length = 0;
  afterResolverRead = null;
}

// --- in-memory PostgREST fake ------------------------------------------------------------------
const writes = [];
const introducerReads = [];
const refusedHosts = [];
const unstubbed = [];
let afterResolverRead = null;
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
function cmp(a, b) {
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
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
    case "gt":
      return value != null && cmp(value, arg) > 0;
    case "gte":
      return value != null && cmp(value, arg) >= 0;
    case "lt":
      return value != null && cmp(value, arg) < 0;
    case "lte":
      return value != null && cmp(value, arg) <= 0;
    default:
      throw new Error(`fake postgrest: unsupported op ${op}`);
  }
}
function applyFilters(rows, url) {
  let out = rows;
  for (const [k, v] of url.searchParams.entries()) {
    if (RESERVED.has(k)) continue;
    if (k === "or" || k === "and") throw new Error(`fake postgrest: unsupported ${k}=${v}`);
    out = out.filter((r) => matchOp(r[k], v));
  }
  const order = url.searchParams.get("order");
  if (order) {
    const [col, dir] = order.split(",")[0].split(".");
    out = [...out].sort((a, b) => cmp(a[col], b[col]) * (dir === "desc" ? -1 : 1));
  }
  const offset = Number(url.searchParams.get("offset") ?? 0);
  const limit = url.searchParams.get("limit");
  return out.slice(offset, limit ? offset + Number(limit) : undefined);
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
        {
          code: "PGRST116",
          message: "JSON object requested, multiple (or no) rows returned",
          details: `The result contains ${rows.length} rows`,
        },
        406,
      );
    return json(rows[0], status);
  }
  return json(rows, status);
}
const denied = () =>
  json({ code: "42501", message: "permission denied for table introducers" }, 403);

globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === "string" ? input : (input.url ?? String(input)));
  if (url.hostname !== FAKE_HOST) {
    refusedHosts.push(url.hostname);
    throw new Error(`G7F4S4C4A1 fetch stub refused host ${url.hostname}`);
  }
  const method = String(
    init.method || (typeof input === "object" && input.method) || "GET",
  ).toUpperCase();
  const headers = new Headers(
    init.headers || (typeof input === "object" ? input.headers : undefined),
  );
  let body = null;
  try {
    body = init.body ? JSON.parse(String(init.body)) : null;
  } catch {
    body = null;
  }
  const p = url.pathname;
  const actor = headers.get("x-a1-actor");

  if (p.startsWith("/rest/v1/rpc/")) {
    const fn = p.slice("/rest/v1/rpc/".length);
    if (fn === "has_tenant_membership") {
      return json(
        db.tenant_memberships.some(
          (m) => m.user_id === body?.p_user_id && m.tenant_id === body?.p_tenant_id && m.active,
        ),
      );
    }
    if (fn === "is_tenant_feature_enabled") return json(true);
    unstubbed.push(`rpc ${fn}`);
    return json(null);
  }

  if (p.startsWith("/rest/v1/")) {
    const table = p.slice("/rest/v1/".length);
    let rows = tableRows(table);
    // A0 grants + own-row RLS for the user client on introducers.
    if (table === "introducers" && actor) rows = rows.filter((r) => r.user_id === actor);
    if (method === "GET" || method === "HEAD") {
      if (table === "introducers") {
        const filters = {};
        for (const [k, v] of url.searchParams.entries()) if (!RESERVED.has(k)) filters[k] = v;
        introducerReads.push({ client: actor ? "user" : "admin", filters });
      }
      const out = respondRows(applyFilters(rows, url), headers, method);
      if (
        table === "introducers" &&
        url.searchParams.has("user_id") &&
        url.searchParams.has("tenant_id") &&
        afterResolverRead
      ) {
        const hook = afterResolverRead;
        afterResolverRead = null;
        hook();
      }
      return out;
    }
    const prefer = headers.get("prefer") ?? "";
    const wantRows = /return=representation/.test(prefer);
    if (method === "POST") {
      if (table === "introducers" && actor) return denied();
      const incoming = Array.isArray(body) ? body : [body];
      const out = [];
      for (const raw of incoming) {
        const row = { ...raw };
        if (row.id === undefined) row.id = randomUUID();
        if (row.created_at === undefined) row.created_at = new Date().toISOString();
        tableRows(table).push(row);
        writes.push({ method: "INSERT", table, client: actor ? "user" : "admin", row: { ...row } });
        out.push(row);
      }
      return wantRows
        ? respondRows(out, headers, "POST", 201)
        : new Response(null, { status: 201 });
    }
    if (method === "PATCH") {
      if (
        table === "introducers" &&
        actor &&
        Object.keys(body ?? {}).some((k) => !["company_name", "contact_email"].includes(k))
      ) {
        writes.push({ method: "DENIED_UPDATE", table, client: "user", body: { ...body } });
        return denied();
      }
      const hit = applyFilters(rows, url);
      for (const r of hit) {
        Object.assign(r, body);
        writes.push({
          method: "UPDATE",
          table,
          client: actor ? "user" : "admin",
          row: { ...r },
          body: { ...body },
        });
      }
      return wantRows ? respondRows(hit, headers, "PATCH") : new Response(null, { status: 204 });
    }
  }
  unstubbed.push(`${method} ${p}`);
  return json({ message: `unstubbed ${method} ${p}` }, 500);
};

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

// --- load real modules ------------------------------------------------------------------------
resetDb();
const { createClient } = await import("@supabase/supabase-js");
const reg = await import("../src/lib/introducer-registration.server.ts");
const inf = await import("../src/lib/introducer.functions.ts");
const bf = await import("../src/lib/booking.functions.ts");

const MISSING = reg.INTRODUCER_REGISTRATION_MISSING_MESSAGE;
const NOT_INTRODUCER = reg.INTRODUCER_NOT_AUTHORISED_MESSAGE;
const INACTIVE = reg.INTRODUCER_REGISTRATION_INACTIVE_MESSAGE;
const GENERIC = new Set([MISSING, NOT_INTRODUCER, INACTIVE, "Forbidden"]);

function userClient(userId) {
  return createClient(`http://${FAKE_HOST}`, PUBLIC_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { "x-a1-actor": userId } },
  });
}
/** Actor; `slug` simulates the verified /$tenantSlug route carried in the Referer. */
const as = (userId, slug = null) => ({ userId, slug });
function setRequest(actor) {
  globalThis.__A1_REQUEST = actor?.slug
    ? new Request("http://app.invalid/_serverFn/x", {
        headers: { referer: `http://app.invalid/${actor.slug}/introducer` },
      })
    : null;
}
async function call(fn, data, actor) {
  setRequest(actor);
  const d = fn.__def;
  return outcome(async () => {
    const parsed = d.validator ? await d.validator(data) : data;
    return d.handler({
      data: parsed,
      context: {
        userId: actor.userId,
        claims: { sub: actor.userId, email: "actor@example.test" },
        supabase: userClient(actor.userId),
      },
    });
  });
}
async function resolveAs(actor, viewAsIntroducerUserId) {
  setRequest(actor);
  return outcome(() =>
    reg.requireActingIntroducerRegistration({ actingUserId: actor.userId, viewAsIntroducerUserId }),
  );
}
const describe = (...rs) => rs.map((r) => (r.ok ? "ok" : r.message)).join(" | ");
const failedWith = (r, msg) => !r.ok && r.message === msg;
const genericFail = (r) => !r.ok && GENERIC.has(r.message);
const noLeak = (r) => !(r.ok ? JSON.stringify(r.value) : r.message).includes(SECRET_B);
const introducerWrites = () => writes.filter((w) => w.table === "introducers");
const leadWrites = () => writes.filter((w) => w.table === "introducer_leads");
const reactivations = () =>
  writes.filter((w) => w.table === "introducers" && w.body && "active" in w.body);
const registrationOf = (rid) => db.introducers.find((r) => r.id === rid);

const xA = as(U.x, "tenant-a");
const xB = as(U.x, "tenant-b");
const ownerA = as(U.ownerA, "tenant-a");
const ownerB = as(U.ownerB, "tenant-b");

const IN_SCOPE = {
  "src/lib/introducer.functions.ts": [
    "resolveViewAsIntroducer",
    "getIntroducerProfile",
    "updateIntroducerProfile",
    "createManualLead",
    "listIntroducerReferrals",
  ],
  "src/lib/booking.functions.ts": [
    "listIntroducerAppointments",
    "sendLeadBookingSms",
    "assertIntroducerBookingAccess",
    "sendIntroducerCustomerBookingLink",
  ],
};
const NEW_BUSINESS = new Set([
  "createManualLead",
  "sendLeadBookingSms",
  "assertIntroducerBookingAccess",
  "sendIntroducerCustomerBookingLink",
]);
const RESOLVER_REL = "src/lib/introducer-registration.server.ts";
const resolverSrc = strip(read(RESOLVER_REL));

// =============================================================================================
// A1-01 / A1-02  resolution needs user_id AND acting tenant; no user_id-only resolver
// =============================================================================================
{
  const queryBlock = resolverSrc.slice(resolverSrc.indexOf('.from("introducers")'));
  ok(
    "A1-01a resolver derives the acting tenant from the canonical model and queries introducers by user_id AND tenant_id",
    /resolveActingTenantRole\(input\.actingUserId\)/.test(resolverSrc) &&
      /\.eq\("user_id", targetUserId\)\s*\.eq\("tenant_id", tenantId\)\s*\.limit\(2\)/.test(
        queryBlock,
      ) &&
      (resolverSrc.match(/\.from\("introducers"\)/g) ?? []).length === 1,
  );
  const blocks = [];
  for (const [rel, names] of Object.entries(IN_SCOPE)) {
    const src = read(rel);
    for (const name of names)
      blocks.push({ rel, name, block: topLevelDeclaration(src, name) ?? "" });
  }
  const userIdOnly = blocks.filter((b) => /\.eq\("user_id"/.test(b.block));
  const unresolved = blocks.filter(
    (b) =>
      !(NEW_BUSINESS.has(b.name)
        ? /requireActiveActingIntroducerRegistration\(/.test(b.block)
        : /requireActingIntroducerRegistration\(/.test(b.block)),
  );
  ok(
    "A1-02a every in-scope current-user portal lookup goes through the resolver (new business via the active variant) and none filters introducers by user_id",
    blocks.every((b) => b.block) && userIdOnly.length === 0 && unresolved.length === 0,
    [
      ...userIdOnly.map((b) => `user_id:${b.name}`),
      ...unresolved.map((b) => `resolver:${b.name}`),
    ].join(",") || `${blocks.length} functions`,
  );
}

// =============================================================================================
// NEGATIVE CONTROL  pre-A1 user_id-only lookup picks the wrong / global row
// =============================================================================================
{
  const headBlocks = [];
  for (const [rel, names] of Object.entries(IN_SCOPE)) {
    const src = git("show", `HEAD:${rel}`);
    for (const name of names) {
      const block = topLevelDeclaration(src, name) ?? "";
      if (
        /\.from\("introducers"\)[\s\S]{0,120}\.eq\("user_id", (targetUserId|context\.userId)\)\s*\.(single|maybeSingle)\(\)/.test(
          block,
        )
      )
        headBlocks.push(name);
    }
  }
  ok(
    "A1-NC1 pre-A1 (HEAD) portal handlers resolved the registration by user_id alone",
    [
      "getIntroducerProfile",
      "updateIntroducerProfile",
      "createManualLead",
      "listIntroducerReferrals",
      "listIntroducerAppointments",
      "sendLeadBookingSms",
    ].every((n) => headBlocks.includes(n)),
    headBlocks.join(","),
  );

  resetDb();
  const { supabaseAdminUntyped: admin } =
    await import("../src/integrations/supabase/client.server.ts");
  // HEAD listIntroducerReferrals / sendLeadBookingSms shape: .eq("user_id", target).single()
  const wAsTenantA = await admin
    .from("introducers")
    .select("id, tenant_id")
    .eq("user_id", U.w)
    .single();
  const gGlobal = await admin
    .from("introducers")
    .select("id, tenant_id")
    .eq("user_id", U.g)
    .single();
  const xAmbiguous = await admin.from("introducers").select("id").eq("user_id", U.x).maybeSingle();
  const wNew = await resolveAs(as(U.w, "tenant-a"));
  const gNew = await resolveAs(as(U.g, "tenant-a"));
  ok(
    "A1-NC2 negative control: user_id-only lookup returns W's Tenant B row in a Tenant A context and G's tenantless global row; the A1 resolver fails closed for both",
    wAsTenantA.data?.id === I.wb &&
      wAsTenantA.data?.tenant_id === T.b &&
      gGlobal.data?.id === I.gNull &&
      gGlobal.data?.tenant_id === null &&
      failedWith(wNew, MISSING) &&
      failedWith(gNew, MISSING),
    describe(wNew, gNew),
  );
  ok(
    "A1-NC3 negative control: with two registrations the user_id-only lookup cannot pick a tenant (multiple rows)",
    xAmbiguous.error != null && xAmbiguous.data == null,
    xAmbiguous.error?.code ?? "no error",
  );
}

// =============================================================================================
// A1-03 / A1-04  each acting tenant returns only its own registration
// =============================================================================================
resetDb();
{
  const ra = await resolveAs(xA);
  const rb = await resolveAs(xB);
  ok(
    "A1-03a resolver: X acting in Tenant A gets exactly the Tenant A registration",
    ra.ok && ra.value.id === I.xa && ra.value.tenantId === T.a && ra.value.userId === U.x,
    describe(ra),
  );
  ok(
    "A1-04a resolver: X acting in Tenant B gets exactly the Tenant B registration",
    rb.ok && rb.value.id === I.xb && rb.value.tenantId === T.b,
    describe(rb),
  );

  const profA = await call(inf.getIntroducerProfile, {}, xA);
  const refA = await call(inf.listIntroducerReferrals, {}, xA);
  const apA = await call(bf.listIntroducerAppointments, undefined, xA);
  const refIds = refA.ok ? refA.value.referrals.map((r) => r.id) : [];
  const apIds = apA.ok ? apA.value.map((a) => a.id) : [];
  ok(
    "A1-03b portal in Tenant A (profile, referrals, appointments) shows only Tenant A data",
    profA.ok &&
      profA.value.id === I.xa &&
      profA.value.tenantSlug === "tenant-a" &&
      refIds.includes(LEAD.xa) &&
      refIds.includes(APPT.xa) &&
      !refIds.includes(LEAD.xb) &&
      !refIds.includes(APPT.xb) &&
      apIds.length === 1 &&
      apIds[0] === APPT.xa &&
      [profA, refA, apA].every(noLeak),
    describe(profA, refA, apA),
  );

  const profB = await call(inf.getIntroducerProfile, {}, xB);
  const refB = await call(inf.listIntroducerReferrals, {}, xB);
  const apB = await call(bf.listIntroducerAppointments, undefined, xB);
  const refIdsB = refB.ok ? refB.value.referrals.map((r) => r.id) : [];
  const apIdsB = apB.ok ? apB.value.map((a) => a.id) : [];
  ok(
    "A1-04b portal in Tenant B shows only Tenant B data",
    profB.ok &&
      profB.value.id === I.xb &&
      profB.value.tenantSlug === "tenant-b" &&
      refIdsB.includes(LEAD.xb) &&
      !refIdsB.includes(LEAD.xa) &&
      !refIdsB.includes(APPT.xa) &&
      apIdsB.length === 1 &&
      apIdsB[0] === APPT.xb,
    describe(profB, refB, apB),
  );

  const vaA = await call(inf.listIntroducerReferrals, { viewAsIntroducerUserId: U.x }, ownerA);
  const vaB = await call(inf.getIntroducerProfile, { viewAsIntroducerUserId: U.x }, ownerB);
  const vaCross = await call(
    inf.getIntroducerProfile,
    { viewAsIntroducerUserId: U.x },
    as(U.ownerA, "tenant-b"),
  );
  const vaW = await call(inf.listIntroducerReferrals, { viewAsIntroducerUserId: U.w }, ownerA);
  const vaIds = vaA.ok ? vaA.value.referrals.map((r) => r.id) : [];
  ok(
    "A1-04c Introducer view (owner view-as) is scoped to the owner's acting tenant: Owner A sees X's Tenant A registration only, Owner B sees Tenant B; Owner A cannot view in Tenant B or reach W's Tenant B registration",
    vaA.ok &&
      vaIds.includes(LEAD.xa) &&
      !vaIds.includes(LEAD.xb) &&
      noLeak(vaA) &&
      vaB.ok &&
      vaB.value.id === I.xb &&
      failedWith(vaCross, "Forbidden") &&
      failedWith(vaW, MISSING) &&
      noLeak(vaW),
    describe(vaA, vaB, vaCross, vaW),
  );

  const crossReads = introducerReads.filter(
    (r) => "user_id" in r.filters && !("tenant_id" in r.filters),
  );
  ok(
    "A1-01b runtime: no introducer read during portal calls filtered by user_id without tenant_id",
    crossReads.length === 0 &&
      introducerReads.some((r) => "user_id" in r.filters && "tenant_id" in r.filters),
    `${introducerReads.length} introducer reads`,
  );
}

// =============================================================================================
// A1-05  no fallback to another tenant's registration / sole row / global row
// =============================================================================================
resetDb();
{
  const wA = await resolveAs(as(U.w, "tenant-a"));
  const gA = await resolveAs(as(U.g, "tenant-a"));
  const xNoSlug = await resolveAs(as(U.x, null));
  const xC = await resolveAs(as(U.x, "tenant-c"));
  const wPortal = await call(inf.getIntroducerProfile, {}, as(U.w, "tenant-a"));
  ok(
    "A1-05a no fallback: Tenant A context never returns W's Tenant B registration or G's tenantless row; X with no acting tenant (two memberships) or a non-member tenant is refused",
    failedWith(wA, MISSING) &&
      failedWith(gA, MISSING) &&
      failedWith(xNoSlug, NOT_INTRODUCER) &&
      failedWith(xC, NOT_INTRODUCER) &&
      failedWith(wPortal, MISSING) &&
      noLeak(wPortal),
    describe(wA, gA, xNoSlug, xC, wPortal),
  );
  const yNoSlug = await resolveAs(as(U.y, null));
  ok(
    "A1-05b a single-membership introducer resolves via the canonical sole-membership acting tenant (identity → tenant → registration), not via a sole introducer row",
    yNoSlug.ok && yNoSlug.value.id === I.ya && yNoSlug.value.tenantId === T.a,
    describe(yNoSlug),
  );
  ok(
    "A1-05c no portal write or registration creation happened on refused resolution",
    introducerWrites().length === 0 && db.introducers.length === 8,
  );
}

// =============================================================================================
// A1-06..09  email / phone / company_code / slug are not registration authority
// =============================================================================================
resetDb();
{
  ok(
    "A1-06a static: resolver has no email, phone, company_code, slug, referral, cookie, user_roles or customer-link input",
    !/email|phone|company_code|companyCode|slug|referral|cookie|user_roles|customer_introducer_links/i.test(
      resolverSrc.replace(/tenantSlug/g, ""),
    ),
  );
  const eA = await resolveAs(as(U.e, "tenant-a"));
  const eProfile = await call(inf.getIntroducerProfile, {}, as(U.e, "tenant-a"));
  ok(
    "A1-06b email: E's email is the contact_email of Y's Tenant A registration, yet E resolves nothing",
    failedWith(eA, MISSING) && failedWith(eProfile, MISSING),
    describe(eA, eProfile),
  );
  ok(
    "A1-07 phone: E's profile phone is never consulted (no profile read, no phone filter on any introducer read)",
    !introducerReads.some((r) => Object.keys(r.filters).some((k) => /phone|email/.test(k))) &&
      failedWith(eA, MISSING),
  );
  const injected = {
    viewAsIntroducerUserId: undefined,
    companyCode: "2222",
    slug: "x-bravo",
    introducerId: I.xb,
    tenantId: T.b,
    email: E_EMAIL,
  };
  const codeProbe = await call(inf.getIntroducerProfile, injected, xA);
  const refProbe = await call(inf.listIntroducerReferrals, injected, xA);
  ok(
    "A1-08 company_code: a supplied Tenant B company code (and introducer id / tenant id) is ignored; X in Tenant A still gets only the Tenant A registration",
    codeProbe.ok &&
      codeProbe.value.id === I.xa &&
      refProbe.ok &&
      !refProbe.value.referrals.some((r) => r.id === LEAD.xb) &&
      noLeak(codeProbe) &&
      noLeak(refProbe),
    describe(codeProbe, refProbe),
  );
  const eSlug = await call(
    inf.getIntroducerProfile,
    { slug: "e-person", companyCode: "3333" },
    as(U.e, "tenant-a"),
  );
  ok(
    "A1-09 slug: E supplying the slug / code of Y's registration still resolves nothing; no introducer read filters by slug or company_code",
    failedWith(eSlug, MISSING) &&
      !introducerReads.some(
        (r) => "slug" in r.filters || "company_code" in r.filters || "contact_email" in r.filters,
      ),
    describe(eSlug),
  );
}

// =============================================================================================
// A1-10  ambiguous / missing / no-capacity registrations fail closed
// =============================================================================================
resetDb();
{
  const dA = await resolveAs(as(U.d, "tenant-a"));
  const zC = await resolveAs(as(U.z, "tenant-c"));
  const nA = await resolveAs(as(U.n, "tenant-a"));
  const dPortal = await call(inf.listIntroducerReferrals, {}, as(U.d, "tenant-a"));
  ok(
    "A1-10a two registrations for (user, tenant) → generic failure; no registration → generic failure; registration without introducer capacity → refused",
    failedWith(dA, MISSING) &&
      failedWith(zC, MISSING) &&
      failedWith(nA, NOT_INTRODUCER) &&
      failedWith(dPortal, MISSING),
    describe(dA, zC, nA, dPortal),
  );
  const zProfile = await call(inf.getIntroducerProfile, {}, as(U.z, "tenant-c"));
  ok(
    "A1-10b no registration: getIntroducerProfile fails closed and the legacy tenantless self-insert is unreachable (no INSERT attempted)",
    failedWith(zProfile, MISSING) &&
      introducerWrites().length === 0 &&
      !db.introducers.some((r) => r.user_id === U.z),
    describe(zProfile),
  );
  const profileSrc = strip(
    topLevelDeclaration(read("src/lib/introducer.functions.ts"), "getIntroducerProfile"),
  );
  ok(
    "A1-10c static: getIntroducerProfile throws on a missing registration before the legacy insert",
    profileSrc.indexOf("if (!existing) throw new Error(INTRODUCER_REGISTRATION_MISSING_MESSAGE)") >
      -1 &&
      profileSrc.indexOf(
        "if (!existing) throw new Error(INTRODUCER_REGISTRATION_MISSING_MESSAGE)",
      ) < profileSrc.indexOf('.from("introducers")\n      .insert('),
  );
}

// =============================================================================================
// A1-11..16  BR4: registration-specific active status (future T001 disabled / T002 active)
// =============================================================================================
const leadInput = {
  customerName: "Synthetic Customer",
  customerPhone: "SYNTH-0001",
  notes: "synthetic",
};
const linkInput = {
  customerName: "Synthetic Link",
  customerPhone: "SYNTH-0002",
  customerEmail: "link.customer@example.test",
  sendSms: false,
};
resetDb();
{
  const manual = await call(inf.createManualLead, leadInput, xA);
  const link = await call(bf.sendIntroducerCustomerBookingLink, linkInput, xA);
  const sms = await call(bf.sendLeadBookingSms, { leadId: LEAD.xa }, xA);
  const leads = leadWrites().filter((w) => w.method === "INSERT");
  ok(
    "A1-11 active Tenant A registration may create Tenant A new business (manual lead, booking link, lead SMS) attributed to the Tenant A registration",
    manual.ok &&
      link.ok &&
      sms.ok &&
      leads.length === 2 &&
      leads.every((w) => w.row.introducer_id === I.xa) &&
      globalThis.__A1_SMS.length === 1 &&
      link.value.bookUrl.includes("/tenant-a/"),
    describe(manual, link, sms),
  );
}

resetDb();
{
  const book = await call(
    bf.bookNewCustomerAsIntroducer,
    {
      customerName: "Synthetic Booking",
      customerPhone: "SYNTH-0003",
      customerEmail: "book.customer@example.test",
      startsAt: new Date(now + 3 * 86400000).toISOString(),
      sendSms: false,
    },
    xA,
  );
  ok(
    "A1-11b active Tenant A registration passes the introducer booking gate (full booking path is covered by S2B test 26)",
    book.ok || !GENERIC.has(book.message),
    book.ok ? "booked" : `stopped after the gate: ${book.message.slice(0, 80)}`,
  );
}

resetDb();
registrationOf(I.xa).active = false;
{
  const before = JSON.stringify(db.introducers);
  const manual = await call(inf.createManualLead, leadInput, xA);
  const link = await call(bf.sendIntroducerCustomerBookingLink, linkInput, xA);
  const sms = await call(bf.sendLeadBookingSms, { leadId: LEAD.xa }, xA);
  const book = await call(
    bf.bookNewCustomerAsIntroducer,
    {
      customerName: "Synthetic Booking",
      customerPhone: "SYNTH-0003",
      customerEmail: "book.customer@example.test",
      startsAt: new Date(now + 3 * 86400000).toISOString(),
      sendSms: false,
    },
    xA,
  );
  const vaLink = await call(
    bf.sendIntroducerCustomerBookingLink,
    { ...linkInput, viewAsIntroducerUserId: U.x },
    ownerA,
  );
  ok(
    "A1-12 disabled Tenant A registration cannot create Tenant A new business (manual lead, booking link, lead SMS, booking, owner view-as booking link)",
    [manual, link, sms, book, vaLink].every((r) => failedWith(r, INACTIVE)) &&
      leadWrites().length === 0 &&
      globalThis.__A1_SMS.length === 0 &&
      !writes.some((w) => w.table === "appointments"),
    describe(manual, link, sms, book, vaLink),
  );
  ok(
    "A1-13a no automatic reactivation: the disabled registration stays disabled and no write touched introducers.active (self or view-as)",
    registrationOf(I.xa).active === false &&
      reactivations().length === 0 &&
      JSON.stringify(db.introducers) === before,
  );

  const xbView = await resolveAs(xB);
  const linkB = await call(bf.sendIntroducerCustomerBookingLink, linkInput, xB);
  const manualB = await call(inf.createManualLead, leadInput, xB);
  const smsB = await call(bf.sendLeadBookingSms, { leadId: LEAD.xb }, xB);
  const leadsB = leadWrites().filter((w) => w.method === "INSERT");
  ok(
    "A1-14 Tenant A disabled does not imply Tenant B disabled",
    xbView.ok && xbView.value.active === true && registrationOf(I.xb).active === true,
    describe(xbView),
  );
  ok(
    "A1-15 Tenant B active registration still creates Tenant B new business (attributed to the Tenant B registration)",
    linkB.ok &&
      manualB.ok &&
      smsB.ok &&
      leadsB.length === 2 &&
      leadsB.every((w) => w.row.introducer_id === I.xb) &&
      linkB.value.bookUrl.includes("/tenant-b/"),
    describe(linkB, manualB, smsB),
  );

  const prof = await call(inf.getIntroducerProfile, {}, xA);
  const refs = await call(inf.listIntroducerReferrals, {}, xA);
  const appts = await call(bf.listIntroducerAppointments, undefined, xA);
  const upd = await call(
    inf.updateIntroducerProfile,
    { companyName: "X Alpha Renamed", contactEmail: "" },
    xA,
  );
  ok(
    "A1-16 BR4 READ/HISTORICAL (profile, referrals, appointments) and ADMIN/PROFILE (company name/contact email) remain allowed for the disabled Tenant A registration, without reactivating it",
    prof.ok &&
      prof.value.id === I.xa &&
      prof.value.active === false &&
      refs.ok &&
      refs.value.referrals.some((r) => r.id === LEAD.xa) &&
      appts.ok &&
      appts.value.some((a) => a.id === APPT.xa) &&
      upd.ok &&
      registrationOf(I.xa).company_name === "X Alpha Renamed" &&
      registrationOf(I.xa).active === false &&
      reactivations().length === 0,
    describe(prof, refs, appts, upd),
  );
}

resetDb();
registrationOf(I.xa).deleted_at = daysAgo(1);
{
  const link = await call(bf.sendIntroducerCustomerBookingLink, linkInput, xA);
  const manual = await call(inf.createManualLead, leadInput, xA);
  ok(
    "A1-12b a binned registration (deleted_at set) is treated as inactive for new business",
    failedWith(link, INACTIVE) && failedWith(manual, INACTIVE) && leadWrites().length === 0,
    describe(link, manual),
  );
}

resetDb();
{
  // Disabled between the resolver read and the booking-link row load: the legacy
  // reactivation branch must still be unreachable (view-as uses the service-role client).
  afterResolverRead = () => {
    registrationOf(I.xa).active = false;
  };
  const race = await call(
    bf.sendIntroducerCustomerBookingLink,
    { ...linkInput, viewAsIntroducerUserId: U.x },
    ownerA,
  );
  ok(
    "A1-13b no reactivation even if the registration is disabled after the resolver check (owner view-as, service-role client): request refused, row stays disabled",
    failedWith(race, INACTIVE) &&
      registrationOf(I.xa).active === false &&
      reactivations().length === 0 &&
      leadWrites().length === 0,
    describe(race),
  );
  const linkSrc = strip(
    topLevelDeclaration(read("src/lib/booking.functions.ts"), "sendIntroducerCustomerBookingLink"),
  );
  const guard = linkSrc.search(
    /\.eq\("active", true\)\s*\.is\("deleted_at", null\)\s*\.maybeSingle\(\);\s*if \(introErr\) throw new Error\(introErr\.message\);\s*if \(!introducer\) throw new Error\(INTRODUCER_REGISTRATION_INACTIVE_MESSAGE\);/,
  );
  const legacy = linkSrc.indexOf("update({ active: true })");
  ok(
    "A1-13c static: the legacy update({ active: true }) is preceded by the active-registration resolver and an active, non-binned row load that throws otherwise",
    linkSrc.indexOf("requireActiveActingIntroducerRegistration(") > -1 &&
      linkSrc.indexOf("requireActiveActingIntroducerRegistration(") < guard &&
      guard > -1 &&
      legacy > guard,
  );
}

// =============================================================================================
// A1-17..20  out-of-scope contracts unchanged
// =============================================================================================
{
  const unchangedVsHead = (rel, names) =>
    names.filter((n) => {
      const a = topLevelDeclaration(git("show", `HEAD:${rel}`), n);
      const b = topLevelDeclaration(read(rel), n);
      return !(a !== null && a === b);
    });
  const changedBooking = unchangedVsHead("src/lib/booking.functions.ts", [
    "bookAppointmentTrusted",
    "ensureStaffIntroducerRecord",
    "bookNewCustomerAsIntroducer",
    "bookNewCustomerAsStaff",
    "sendStaffCustomerBookingLink",
    "actingTenantStaffFlags",
  ]);
  const changedIntro = unchangedVsHead("src/lib/introducer.functions.ts", [
    "generateUniqueCompanyCode",
    "uniqueSlug",
    "resolveReferralSlug",
    "checkIsIntroducer",
    "listIntroducersForAdmin",
    "activeTenantSlugForIntroducer",
    "captureIntroducerCalculatorLead",
  ]);
  const inviteStatus = git(
    "status",
    "--porcelain",
    "--",
    "src/lib/staff-invite.server.ts",
    "src/lib/staff-invite-contract.ts",
    "src/lib/staff-invite.functions.ts",
    "supabase/migrations",
  ).trim();
  ok(
    "A1-17 same-tenant duplicate/invite protections unchanged: invite modules and migrations untouched; staff-introducer creation, booking writers, company-code and slug generation byte-identical to HEAD",
    inviteStatus === "" && changedBooking.length === 0 && changedIntro.length === 0,
    [inviteStatus, ...changedBooking, ...changedIntro].filter(Boolean).join(",") || "unchanged",
  );
  const s3b = "scripts/g7f4s3b-staff-invite-binding-verify.mjs";
  ok(
    "A1-18 S3B test 27 unchanged (S3B verifier untouched; cross-tenant introducer invite still fails closed there)",
    git("status", "--porcelain", "--", s3b).trim() === "" &&
      read(s3b).includes('"27 cross-tenant introducer invite fails closed"'),
  );
  ok(
    "A1-19 no migration created or modified",
    git("status", "--porcelain", "--", "supabase").trim() === "",
  );
  const schemaPaths = [
    "src/lib/introducer-attribution.ts",
    "src/lib/introducer-customer.functions.ts",
    "src/lib/finance.functions.ts",
    "src/lib/referrals.functions.ts",
    "src/integrations/supabase/types.ts",
    "src/lib/test-accounts.ts",
    "src/lib/test-accounts.functions.ts",
    "src/lib/tenant-assert.server.ts",
    "src/lib/tenant-role.server.ts",
  ];
  ok(
    "A1-20 no attribution, commission, referral, schema-type, test-account or canonical-tenant source change",
    git("status", "--porcelain", "--", ...schemaPaths).trim() === "",
  );
  const changed = git("status", "--porcelain", "--", "src")
    .trimEnd()
    .split("\n")
    .filter(Boolean)
    .map((l) => l.slice(3));
  const allowed = [
    "src/lib/introducer.functions.ts",
    "src/lib/booking.functions.ts",
    "src/lib/introducer-registration.server.ts",
  ];
  ok(
    "A1-20b application changes limited to the resolver module and the introducer/booking portal functions",
    changed.every((f) => allowed.includes(f)),
    changed.join(", "),
  );
  const oldVerifiers = git("status", "--porcelain", "--", "scripts")
    .trimEnd()
    .split("\n")
    .filter(Boolean)
    .map((l) => l.slice(3))
    .filter((f) => f !== "scripts/g7f4s4c4a1-introducer-registration-verify.mjs");
  ok("A1-20c no existing verifier modified", oldVerifiers.length === 0, oldVerifiers.join(", "));
}

// =============================================================================================
// harness hygiene + BR4 classification
// =============================================================================================
ok(
  "A1-21 no network: every request went to the synthetic host; no real SMS (stubbed sender only)",
  refusedHosts.length === 0,
  refusedHosts.join(",") ||
    (unstubbed.length ? `unstubbed fake paths: ${[...new Set(unstubbed)].join(",")}` : ""),
);

const BR4 = [
  ["getIntroducerProfile", "READ/HISTORICAL", "ALLOW"],
  ["listIntroducerReferrals", "READ/HISTORICAL", "ALLOW"],
  ["listIntroducerAppointments", "READ/HISTORICAL", "ALLOW"],
  ["updateIntroducerProfile", "ADMIN/PROFILE", "ALLOW"],
  ["createManualLead", "NEW BUSINESS", "DENY"],
  ["sendLeadBookingSms", "NEW BUSINESS", "DENY"],
  ["sendIntroducerCustomerBookingLink", "NEW BUSINESS", "DENY"],
  ["bookNewCustomerAsIntroducer", "NEW BUSINESS", "DENY"],
];
console.log("\nINFO  BR4 classification (active=false):");
for (const [fn, cls, policy] of BR4)
  console.log(`INFO    ${fn.padEnd(36)} ${cls.padEnd(16)} ${policy}`);

console.log(`\n${total - failures.length}/${total} PASS`);
if (failures.length) {
  console.log(`FAILED: ${failures.join("; ")}`);
  process.exit(1);
}
