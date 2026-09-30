/**
 * G7F-4S2B createAppointment IDOR remediation — end-to-end offline verification.
 * Real server-function validators and handlers run against an in-memory PostgREST/Auth fake on a
 * non-routable host: synthetic fixtures only, no database, no network, no production, no real
 * user. SMS sign-in codes (if any) stay in this process and are never printed.
 * Run: npm exec --yes --package=tsx -- tsx scripts/g7f4s2b-create-appointment-idor-verify.mjs
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
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_MESSAGING_SERVICE_SID",
  "STAGING_TWILIO_ALLOW_LIVE",
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
const code = (rel) => strip(readFileSync(resolve(root, rel), "utf8"));

// --- capture createServerFn definitions (validator, middleware, handler) ----------------------
const realStartUrl = import.meta.resolve("@tanstack/react-start");
const stubSource = `
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
const stubUrl = `data:text/javascript,${encodeURIComponent(stubSource)}`;
const hookSource = `
export async function resolve(specifier, context, next) {
  if (specifier === "@tanstack/react-start" && !String(context.parentURL ?? "").startsWith("data:")) {
    return { url: ${JSON.stringify(stubUrl)}, shortCircuit: true };
  }
  return next(specifier, context);
}
`;
register(`data:text/javascript,${encodeURIComponent(hookSource)}`, import.meta.url);

// --- synthetic fixtures ------------------------------------------------------------------------
const FAKE_HOST = "g7f4s2b.invalid";
process.env.SUPABASE_URL = `http://${FAKE_HOST}`;
process.env.VITE_SUPABASE_URL = `http://${FAKE_HOST}`;
process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_secret_g7f4s2b_not_a_real_key";
process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_g7f4s2b_not_a_real_key";
process.env.VITE_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_g7f4s2b_not_a_real_key";

const T = { a: "c1111111-1111-4111-8111-111111111111", b: "c2222222-2222-4222-8222-222222222222" };
const U = {
  advA: "d1111111-1111-4111-8111-111111111111",
  advA2: "d1212121-1212-4121-8121-121212121212",
  inactiveA: "d2222222-2222-4222-8222-222222222222",
  noTeamsA: "d3333333-3333-4333-8333-333333333333",
  customerMemberA: "d4444444-4444-4444-8444-444444444444",
  advB: "d5555555-5555-4555-8555-555555555555",
  victim: "d6666666-6666-4666-8666-666666666666",
  victimB: "d6767676-6767-4676-8676-767676767676",
  owner: "d7777777-7777-4777-8777-777777777777",
  attacker: "d8888888-8888-4888-8888-888888888888",
  authCustomer: "d9999999-9999-4999-8999-999999999999",
  introUserA: "daaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  outsider: "dbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
};
const I = {
  a: "e1111111-1111-4111-8111-111111111111",
  a2: "e2222222-2222-4222-8222-222222222222",
  b: "e3333333-3333-4333-8333-333333333333",
};
const S = {
  victim: "f1111111-1111-4111-8111-111111111111",
  victimB: "f2222222-2222-4222-8222-222222222222",
  owner: "f3333333-3333-4333-8333-333333333333",
  victimCase: "f4444444-4444-4444-8444-444444444444",
};
const L = {
  a: "a1111111-1111-4111-8111-111111111111",
  booked: "a2222222-2222-4222-8222-222222222222",
  otherIntro: "a3333333-3333-4333-8333-333333333333",
  b: "a4444444-4444-4444-8444-444444444444",
  missing: "a5555555-5555-4555-8555-555555555555",
  nullTenant: "a6666666-6666-4666-8666-666666666666",
  converted: "a7777777-7777-4777-8777-777777777777",
};
const EXISTING_APPT = "b0000000-0000-4000-8000-000000000001";

function londonUtcFor(dateKey, hh) {
  for (const h of [hh - 1, hh]) {
    const d = new Date(`${dateKey}T${String(h).padStart(2, "0")}:00:00.000Z`);
    const shown = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London",
      hour: "2-digit",
      hour12: false,
    }).format(d);
    if (Number(shown) === hh) return d.toISOString();
  }
  throw new Error("no london instant");
}
function futureWeekday(offsetDays) {
  const d = new Date(Date.now() + offsetDays * 86400000);
  while ([0, 6].includes(d.getUTCDay())) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
const DAY = futureWeekday(4);
const SLOT = londonUtcFor(DAY, 9);

let db;
function resetDb() {
  const profile = (id, full_name, email, phone = null) => ({ id, full_name, email, phone });
  db = {
    tenants: [
      {
        id: T.a,
        slug: "tenant-a",
        company_name: "Tenant A",
        status: "active",
        tenant_type: "firm",
        company_code: "101",
      },
      {
        id: T.b,
        slug: "tenant-b",
        company_name: "Tenant B",
        status: "active",
        tenant_type: "firm",
        company_code: "102",
      },
    ],
    introducers: [
      {
        id: I.a,
        slug: "intro-a",
        tenant_id: T.a,
        active: true,
        company_name: "Intro A",
        user_id: U.introUserA,
      },
      {
        id: I.a2,
        slug: "intro-a2",
        tenant_id: T.a,
        active: true,
        company_name: "Intro A2",
        user_id: null,
      },
      {
        id: I.b,
        slug: "intro-b",
        tenant_id: T.b,
        active: true,
        company_name: "Intro B",
        user_id: null,
      },
    ],
    tenant_memberships: [
      { id: randomUUID(), user_id: U.advA, tenant_id: T.a, role: "adviser", active: true },
      { id: randomUUID(), user_id: U.advA2, tenant_id: T.a, role: "adviser", active: true },
      { id: randomUUID(), user_id: U.inactiveA, tenant_id: T.a, role: "adviser", active: false },
      { id: randomUUID(), user_id: U.noTeamsA, tenant_id: T.a, role: "adviser", active: true },
      {
        id: randomUUID(),
        user_id: U.customerMemberA,
        tenant_id: T.a,
        role: "customer",
        active: true,
      },
      { id: randomUUID(), user_id: U.advB, tenant_id: T.b, role: "adviser", active: true },
      { id: randomUUID(), user_id: U.introUserA, tenant_id: T.a, role: "introducer", active: true },
    ],
    user_roles: [
      { user_id: U.advA, role: "advisor" },
      { user_id: U.advA2, role: "advisor" },
      { user_id: U.advB, role: "advisor" },
      { user_id: U.introUserA, role: "introducer" },
      { user_id: U.victim, role: "customer" },
      { user_id: U.owner, role: "customer" },
      { user_id: U.authCustomer, role: "customer" },
    ],
    profiles: [
      profile(U.advA, "Adviser A", "adviser.a@example.test"),
      profile(U.advA2, "Adviser A2", "adviser.a2@example.test"),
      profile(U.inactiveA, "Inactive A", "inactive.a@example.test"),
      profile(U.noTeamsA, "No Teams A", "noteams.a@example.test"),
      profile(U.customerMemberA, "Customer Member A", "cm.a@example.test"),
      profile(U.advB, "Adviser B", "adviser.b@example.test"),
      profile(U.victim, "Victim Customer", "victim@example.test", "+447700900111"),
      profile(U.victimB, "Victim B", "victim.b@example.test", "+447700900112"),
      profile(U.owner, "Owner Customer", "owner@example.test", "+447700900113"),
      profile(U.attacker, "Attacker", "attacker@example.test", "+447700900114"),
      profile(U.authCustomer, "Auth Customer", "auth.customer@example.test", "+447700900115"),
      profile(U.introUserA, "Intro User A", "intro.a@example.test", "+447700900116"),
    ],
    advisor_profiles: [
      { user_id: U.advA, deleted_at: null, teams_calendar_enabled: true },
      { user_id: U.advA2, deleted_at: null, teams_calendar_enabled: true },
      { user_id: U.inactiveA, deleted_at: null, teams_calendar_enabled: true },
      { user_id: U.noTeamsA, deleted_at: null, teams_calendar_enabled: false },
      { user_id: U.customerMemberA, deleted_at: null, teams_calendar_enabled: true },
      { user_id: U.advB, deleted_at: null, teams_calendar_enabled: true },
    ],
    interview_sessions: [
      {
        id: S.victim,
        customer_id: U.victim,
        tenant_id: T.a,
        case_ref: null,
        status: "in_progress",
        deleted_at: null,
        started_at: "2026-09-01T10:00:00Z",
      },
      {
        id: S.victimB,
        customer_id: U.victimB,
        tenant_id: T.b,
        case_ref: null,
        status: "in_progress",
        deleted_at: null,
        started_at: "2026-09-01T10:00:00Z",
      },
      {
        id: S.owner,
        customer_id: U.owner,
        tenant_id: T.a,
        case_ref: null,
        status: "in_progress",
        deleted_at: null,
        started_at: "2026-09-01T10:00:00Z",
      },
      {
        id: S.victimCase,
        customer_id: U.victim,
        tenant_id: T.a,
        case_ref: "MG-2026-9001",
        status: "in_progress",
        deleted_at: null,
        started_at: "2026-08-01T10:00:00Z",
      },
    ],
    introducer_leads: [
      {
        id: L.a,
        tenant_id: T.a,
        introducer_id: I.a,
        status: "new",
        appointment_id: null,
        customer_name: "Lead A",
        customer_phone: "+447700900201",
        customer_email: "lead.a@example.test",
      },
      {
        id: L.booked,
        tenant_id: T.a,
        introducer_id: I.a,
        status: "booked",
        appointment_id: EXISTING_APPT,
        customer_name: "Lead Booked",
        customer_phone: null,
        customer_email: null,
      },
      {
        id: L.otherIntro,
        tenant_id: T.a,
        introducer_id: I.a2,
        status: "new",
        appointment_id: null,
        customer_name: "Lead A2",
        customer_phone: null,
        customer_email: null,
      },
      {
        id: L.b,
        tenant_id: T.b,
        introducer_id: I.b,
        status: "new",
        appointment_id: null,
        customer_name: "Lead B",
        customer_phone: null,
        customer_email: null,
      },
      {
        id: L.nullTenant,
        tenant_id: null,
        introducer_id: I.a,
        status: "new",
        appointment_id: null,
        customer_name: "Lead Null",
        customer_phone: null,
        customer_email: null,
      },
      {
        id: L.converted,
        tenant_id: T.a,
        introducer_id: I.a,
        status: "converted",
        appointment_id: null,
        customer_name: "Lead Conv",
        customer_phone: null,
        customer_email: null,
      },
    ],
    appointments: [],
    session_advisors: [],
    staff_contact_tasks: [],
    customer_introducer_links: [],
    sms_messages: [],
    advisor_availability: [],
    features: { [T.a]: true, [T.b]: true },
    authUsers: new Map(
      [U.victim, U.victimB, U.owner, U.attacker, U.authCustomer, U.introUserA, U.advA].map((id) => [
        id,
        { id, email: null },
      ]),
    ),
  };
  for (const p of db.profiles) if (db.authUsers.has(p.id)) db.authUsers.get(p.id).email = p.email;
  writes.length = 0;
  unknownCalls.length = 0;
  logs.length = 0;
}

// --- in-memory PostgREST / Auth fake ----------------------------------------------------------
const writes = [];
const unknownCalls = [];
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
  const na = Number(a);
  const nb = Number(b);
  if (a !== null && a !== "" && !Number.isNaN(na) && !Number.isNaN(nb) && typeof a !== "string")
    return na - nb;
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
    case "ilike":
    case "like": {
      const pat = arg.replace(/\\([\\%_])/g, "\u0000$1").replace(/[.*+?^${}()|[\]]/g, "\\$&");
      const re = new RegExp(
        `^${pat
          .replace(/%/g, ".*")
          .replace(/_/g, ".")
          .replace(/\u0000(.)/g, "\\$1")}$`,
        op === "ilike" ? "i" : "",
      );
      return value != null && re.test(String(value));
    }
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
  const limit = url.searchParams.get("limit");
  if (limit) out = out.slice(0, Number(limit));
  return out;
}
function tableRows(table) {
  if (!Array.isArray(db[table])) db[table] = [];
  return db[table];
}
function respondRows(rows, headers, method, status = 200) {
  const accept = headers.get("accept") ?? "";
  const prefer = headers.get("prefer") ?? "";
  const extra = {};
  if (/count=exact/.test(prefer))
    extra["content-range"] = rows.length ? `0-${rows.length - 1}/${rows.length}` : "*/0";
  if (method === "HEAD") return new Response(null, { status, headers: extra });
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
    return json(rows[0], status, extra);
  }
  return json(rows, status, extra);
}

const userTokens = new Map();
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === "string" ? input : (input.url ?? String(input)));
  if (url.hostname !== FAKE_HOST) {
    unknownCalls.push(`refused host ${url.hostname}`);
    throw new Error(`G7F4S2B fetch stub refused host ${url.hostname}`);
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

  if (p.startsWith("/rest/v1/rpc/")) {
    const fn = p.slice("/rest/v1/rpc/".length);
    if (fn === "is_tenant_feature_enabled") {
      return json(
        Boolean(db.features[body?.p_tenant_id]) && body?.p_feature_key === "appointment_booking",
      );
    }
    if (fn === "has_tenant_membership") {
      return json(
        db.tenant_memberships.some(
          (m) => m.user_id === body?.p_user_id && m.tenant_id === body?.p_tenant_id && m.active,
        ),
      );
    }
    unknownCalls.push(`rpc ${fn}`);
    return json(null);
  }

  if (p.startsWith("/rest/v1/")) {
    const table = p.slice("/rest/v1/".length);
    const rows = tableRows(table);
    if (method === "GET" || method === "HEAD") {
      return respondRows(applyFilters(rows, url), headers, method);
    }
    const prefer = headers.get("prefer") ?? "";
    const wantRows = /return=representation/.test(prefer);
    if (method === "POST") {
      const incoming = Array.isArray(body) ? body : [body];
      const conflictCols = (url.searchParams.get("on_conflict") ?? "").split(",").filter(Boolean);
      const out = [];
      for (const raw of incoming) {
        const row = { ...raw };
        const existing = conflictCols.length
          ? rows.find((r) => conflictCols.every((c) => String(r[c]) === String(row[c])))
          : row.id
            ? rows.find((r) => r.id === row.id)
            : null;
        if (existing) {
          if (/ignore-duplicates/.test(prefer)) continue;
          if (/merge-duplicates/.test(prefer)) {
            Object.assign(existing, row);
            writes.push({ method: "UPSERT", table, row: { ...existing } });
            out.push(existing);
            continue;
          }
          return json(
            {
              code: "23505",
              message: `duplicate key value violates unique constraint on ${table}`,
            },
            409,
          );
        }
        if (row.id === undefined && !["advisor_profiles"].includes(table)) row.id = randomUUID();
        if (row.created_at === undefined) row.created_at = new Date().toISOString();
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
        writes.push({
          method: "UPDATE",
          table,
          row: { ...r },
          filter: decodeURIComponent(url.search),
        });
      }
      if (hit.length === 0)
        writes.push({ method: "UPDATE_NOOP", table, filter: decodeURIComponent(url.search) });
      return wantRows ? respondRows(hit, headers, "PATCH") : new Response(null, { status: 204 });
    }
    if (method === "DELETE") {
      const hit = new Set(applyFilters(rows, url));
      db[table] = rows.filter((r) => !hit.has(r));
      for (const r of hit) writes.push({ method: "DELETE", table, row: { ...r } });
      return new Response(null, { status: 204 });
    }
  }

  if (p === "/auth/v1/admin/users" && method === "POST") {
    const email = String(body?.email ?? "").toLowerCase();
    if ([...db.authUsers.values()].some((u) => u.email === email))
      return json(
        { code: "email_exists", msg: "A user with this email address has already been registered" },
        422,
      );
    const id = randomUUID();
    db.authUsers.set(id, { id, email });
    writes.push({ method: "AUTH_CREATE", table: "auth.users", row: { id } });
    return json({ id, email, aud: "authenticated", role: "authenticated" });
  }
  const userMatch = p.match(/^\/auth\/v1\/admin\/users\/([0-9a-f-]+)$/);
  if (userMatch && method === "GET") {
    const u = db.authUsers.get(userMatch[1]);
    return u
      ? json({ ...u, aud: "authenticated", role: "authenticated" })
      : json({ msg: "User not found" }, 404);
  }
  if (p === "/auth/v1/user" && method === "GET") {
    const token = (headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    const id = userTokens.get(token);
    const u = id ? db.authUsers.get(id) : null;
    return u
      ? json({ ...u, aud: "authenticated", role: "authenticated" })
      : json({ msg: "invalid" }, 401);
  }
  unknownCalls.push(`${method} ${p}`);
  return json({ message: `unstubbed ${method} ${p}` }, 500);
};

// --- quiet application logs (kept for assertions) ---------------------------------------------
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
const bf = await import("../src/lib/booking.functions.ts");
const contract = await import("../src/lib/public-booking-contract.ts");
const guard = await import("../src/lib/public-booking-guard.server.ts");
const { createClient } = await import("@supabase/supabase-js");

const def = (fn) => fn.__def;
async function invoke(fn, data, context) {
  const d = def(fn);
  const parsed = d.validator ? await d.validator(data) : data;
  return d.handler({ data: parsed, context });
}
function userContext(userId, email) {
  const token = `synthetic-token-${userId.slice(0, 8)}`;
  userTokens.set(token, userId);
  const supabase = createClient(`http://${FAKE_HOST}`, "sb_publishable_g7f4s2b_not_a_real_key", {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return { userId, supabase, claims: { sub: userId, email: email ?? null } };
}

const base = (extra = {}) => ({
  customerName: "Public Caller",
  customerPhone: "07700 900301",
  customerEmail: "public.caller@example.test",
  startsAt: SLOT,
  ...extra,
});
const w = (table, method) =>
  writes.filter((x) => x.table === table && (!method || x.method === method));
const apptInserts = () => w("appointments", "INSERT");
const noWrites = () =>
  writes.filter((x) => x.method !== "UPDATE_NOOP" && x.table !== "advisor_availability").length ===
  0;
const touchesVictim = () =>
  writes.some((x) => {
    const r = x.row ?? {};
    return (
      ([S.victim, S.victimB, S.victimCase].includes(r.id) && x.table === "interview_sessions") ||
      [S.victim, S.victimB, S.victimCase].includes(r.session_id) ||
      [U.victim, U.victimB].includes(r.customer_id)
    );
  });
const confirmationUrls = () => [
  ...db.sms_messages.map((m) => m.body ?? ""),
  ...logs.filter((l) => l.includes("[booking-email]")),
];
const isZodUnrecognized = (r, key) =>
  !r.ok &&
  (r.error?.name === "ZodError" || Array.isArray(r.error?.issues)) &&
  JSON.stringify(r.error.issues ?? []).includes("unrecognized_keys") &&
  JSON.stringify(r.error.issues ?? []).includes(key);

const LEAD_ERR = guard.PUBLIC_LEAD_ERROR;
const ADV_ERR = guard.PUBLIC_ADVISER_ERROR;

// =============================================================================================
// 01–06 trusted-id injection fails validation on both exported endpoints
// =============================================================================================
{
  const cases = [
    ["01 public customerId injection rejected", bf.createAppointment, "customerId", U.victim],
    ["02 public sessionId injection rejected", bf.createAppointment, "sessionId", S.victim],
    ["03 public tenant_id injection rejected", bf.createAppointment, "tenant_id", T.a],
    [
      "04 createAppointmentAuth customerId injection rejected",
      bf.createAppointmentAuth,
      "customerId",
      U.victim,
    ],
    [
      "05 createAppointmentAuth sessionId injection rejected",
      bf.createAppointmentAuth,
      "sessionId",
      S.victim,
    ],
    [
      "06 createAppointmentAuth tenant_id injection rejected",
      bf.createAppointmentAuth,
      "tenant_id",
      T.a,
    ],
  ];
  for (const [name, fn, key, value] of cases) {
    resetDb();
    const r = await outcome(() =>
      invoke(fn, base({ tenantSlug: "tenant-a", [key]: value }), userContext(U.attacker)),
    );
    ok(
      name,
      isZodUnrecognized(r, key) && noWrites(),
      r.ok ? "accepted" : `unrecognized key ${key}, no writes`,
    );
  }
  resetDb();
  const r = await outcome(() =>
    invoke(
      bf.createAppointment,
      base({ tenantSlug: "tenant-a", sessionId: S.victim, customerId: U.victim, tenant_id: T.a }),
    ),
  );
  ok(
    "01-06b all three trusted keys together rejected",
    isZodUnrecognized(r, "sessionId") && noWrites(),
  );
  const auth = def(bf.createAppointmentAuth);
  ok(
    "04-06c createAppointmentAuth still requires Supabase auth middleware",
    auth.middleware.includes(
      (await import("../src/integrations/supabase/auth-middleware.ts")).requireSupabaseAuth,
    ),
  );
}

// =============================================================================================
// 07–11 lead binding
// =============================================================================================
async function publicBook(extra) {
  return outcome(() => invoke(bf.createAppointment, base(extra)));
}
{
  resetDb();
  let r = await publicBook({
    slug: "intro-a",
    tenantSlug: "tenant-a",
    leadId: L.b,
    advisorId: U.advA,
  });
  const cross1 = !r.ok && r.message === LEAD_ERR && apptInserts().length === 0;
  resetDb();
  r = await publicBook({ slug: "intro-b", tenantSlug: "tenant-b", leadId: L.a, advisorId: U.advB });
  const cross2 =
    !r.ok &&
    r.message === LEAD_ERR &&
    apptInserts().length === 0 &&
    db.introducer_leads.find((l) => l.id === L.a).status === "new";
  ok("07 cross-tenant lead rejected", cross1 && cross2);

  resetDb();
  r = await publicBook({
    slug: "intro-a2",
    tenantSlug: "tenant-a",
    leadId: L.a,
    advisorId: U.advA,
  });
  ok(
    "08 wrong-introducer lead rejected",
    !r.ok && r.message === LEAD_ERR && apptInserts().length === 0,
  );

  resetDb();
  r = await publicBook({
    slug: "intro-a",
    tenantSlug: "tenant-a",
    leadId: L.booked,
    advisorId: U.advA,
  });
  const bookedRow = db.introducer_leads.find((l) => l.id === L.booked);
  const r2 = await publicBook({
    slug: "intro-a",
    tenantSlug: "tenant-a",
    leadId: L.converted,
    advisorId: U.advA,
  });
  ok(
    "09 already-booked lead rejected (appointment_id not overwritten)",
    !r.ok &&
      r.message === LEAD_ERR &&
      apptInserts().length === 0 &&
      bookedRow.appointment_id === EXISTING_APPT &&
      !r2.ok &&
      r2.message === LEAD_ERR,
  );

  resetDb();
  r = await publicBook({ tenantSlug: "tenant-a", leadId: L.a, advisorId: U.advA });
  const r3 = await publicBook({
    slug: "intro-missing",
    tenantSlug: "tenant-a",
    leadId: L.a,
    advisorId: U.advA,
  });
  ok(
    "10 lead without (resolvable) referral slug rejected",
    !r.ok &&
      r.message === LEAD_ERR &&
      !r3.ok &&
      r3.message === LEAD_ERR &&
      apptInserts().length === 0,
  );

  resetDb();
  r = await publicBook({
    slug: "intro-a",
    tenantSlug: "tenant-a",
    leadId: L.a,
    advisorId: U.advA,
    sendSms: false,
  });
  const lead = db.introducer_leads.find((l) => l.id === L.a);
  const appt = apptInserts()[0]?.row;
  const leadUpdate = w("introducer_leads", "UPDATE")[0];
  ok(
    "11 valid introducer lead accepted",
    r.ok &&
      appt?.lead_id === L.a &&
      appt?.introducer_id === I.a &&
      appt?.tenant_id === T.a &&
      lead.status === "booked" &&
      lead.appointment_id === appt?.id &&
      /appointment_id=is\.null/.test(leadUpdate?.filter ?? ""),
    r.ok ? "" : r.message,
  );
}

// =============================================================================================
// 12–15 adviser binding
// =============================================================================================
{
  resetDb();
  let r = await publicBook({ tenantSlug: "tenant-a", advisorId: U.advB });
  ok(
    "12 cross-tenant adviser rejected",
    !r.ok && r.message === ADV_ERR && apptInserts().length === 0,
  );

  resetDb();
  r = await publicBook({ tenantSlug: "tenant-a", advisorId: U.customerMemberA });
  ok(
    "13 same-tenant customer-as-adviser rejected",
    !r.ok && r.message === ADV_ERR && apptInserts().length === 0,
  );

  resetDb();
  const inactive = await publicBook({ tenantSlug: "tenant-a", advisorId: U.inactiveA });
  const noTeams = await publicBook({ tenantSlug: "tenant-a", advisorId: U.noTeamsA });
  const arbitrary = await publicBook({ tenantSlug: "tenant-a", advisorId: U.victim });
  const introAsAdv = await publicBook({ tenantSlug: "tenant-a", advisorId: U.introUserA });
  ok(
    "14 inactive / non-bookable / arbitrary same-tenant user rejected",
    [inactive, noTeams, arbitrary, introAsAdv].every((x) => !x.ok && x.message === ADV_ERR) &&
      apptInserts().length === 0,
  );

  resetDb();
  r = await publicBook({ tenantSlug: "tenant-a", advisorId: U.advA, sendSms: false });
  ok(
    "15 valid public bookable adviser accepted",
    r.ok && apptInserts()[0]?.row.advisor_id === U.advA,
    r.ok ? "" : r.message,
  );

  resetDb();
  r = await publicBook({ advisorId: U.advA });
  ok(
    "15b tenant never derived from a caller-chosen adviser (no route/referral → refused)",
    !r.ok && apptInserts().length === 0,
    r.ok ? "accepted" : r.message.slice(0, 60),
  );
}

// =============================================================================================
// 16–17 public contracts preserved
// =============================================================================================
{
  resetDb();
  process.env.TWILIO_ACCOUNT_SID = "ACg7f4s2bsynthetic";
  process.env.TWILIO_AUTH_TOKEN = "g7f4s2b-synthetic";
  process.env.TWILIO_MESSAGING_SERVICE_SID = "MGg7f4s2bsynthetic";
  let r = await publicBook({
    tenantSlug: "tenant-a",
    preferAnyAdvisor: true,
    channel: "direct_booking",
    sendSms: true,
  });
  const appt = apptInserts()[0]?.row;
  ok(
    "16 valid public direct booking contract preserved",
    r.ok &&
      appt?.tenant_id === T.a &&
      appt?.session_id === null &&
      appt?.lead_source === "web" &&
      [U.advA, U.advA2].includes(appt?.advisor_id) &&
      w("interview_sessions").length === 0 &&
      w("session_advisors").length === 0,
    r.ok ? "" : r.message,
  );
  const urls16 = confirmationUrls();
  ok(
    "16b anonymous confirmation links to tenant home, not a session",
    urls16.length > 0 &&
      urls16.every((u) => !u.includes("/sessions/")) &&
      urls16.some((u) => u.includes("/tenant-a/home")),
    `${urls16.length} captured`,
  );

  resetDb();
  r = await publicBook({
    slug: "intro-a",
    tenantSlug: "tenant-a",
    advisorId: U.advA,
    channel: "direct_booking",
    sendSms: true,
  });
  const appt17 = apptInserts()[0]?.row;
  ok(
    "17 valid public introducer booking contract preserved",
    r.ok &&
      appt17?.introducer_id === I.a &&
      appt17?.lead_source === "referral_link" &&
      appt17?.tenant_id === T.a &&
      appt17?.session_id === null &&
      w("customer_introducer_links").length === 0,
    r.ok ? "" : r.message,
  );
  resetDb();
  r = await publicBook({
    slug: "intro-a",
    tenantSlug: "tenant-b",
    advisorId: U.advB,
    sendSms: false,
  });
  ok(
    "17b referral from another tenant than the route is refused",
    !r.ok && apptInserts().length === 0,
  );
  delete process.env.TWILIO_ACCOUNT_SID;
  delete process.env.TWILIO_AUTH_TOKEN;
  delete process.env.TWILIO_MESSAGING_SERVICE_SID;
}

// =============================================================================================
// 18–19 S1B signup preserved
// =============================================================================================
{
  resetDb();
  const r = await outcome(() =>
    invoke(bf.customerAppointmentSignup, {
      customerName: "Brand New",
      customerPhone: "07700 900401",
      customerEmail: "brand.new@example.test",
      startsAt: SLOT,
      preferAnyAdvisor: true,
      journey: "book",
      slug: "intro-a",
    }),
  );
  const created = writes.find((x) => x.method === "AUTH_CREATE")?.row.id;
  const appt = apptInserts()[0]?.row;
  const caseRow = w("interview_sessions", "INSERT")[0]?.row;
  const linkedAppt = db.appointments.find((a) => a.id === appt?.id);
  ok(
    "18 S1B new-customer booking preserved (linked to the account created in this request)",
    r.ok &&
      r.value.signInRequired === true &&
      created &&
      caseRow?.customer_id === created &&
      linkedAppt?.session_id === caseRow?.id &&
      appt?.tenant_id === T.a &&
      db.customer_introducer_links.some(
        (l) => l.customer_id === created && l.introducer_id === I.a,
      ),
    r.ok ? "" : r.message,
  );

  resetDb();
  const r2 = await outcome(() =>
    invoke(bf.customerAppointmentSignup, {
      customerName: "Someone Else",
      customerPhone: "07700 900402",
      customerEmail: "victim@example.test",
      startsAt: SLOT,
      preferAnyAdvisor: true,
      journey: "book",
      slug: "intro-a",
    }),
  );
  const appt2 = apptInserts()[0]?.row;
  ok(
    "19 S1B existing-account collision books unlinked",
    r2.ok &&
      r2.value.signInRequired === true &&
      appt2 &&
      appt2.session_id === null &&
      !writes.some((x) => x.method === "AUTH_CREATE") &&
      !touchesVictim(),
    r2.ok ? "" : r2.message,
  );
}

// =============================================================================================
// 20–22 authenticated customer + owned session
// =============================================================================================
{
  resetDb();
  let r = await outcome(() =>
    invoke(
      bf.createAppointmentAuth,
      base({
        channel: "direct_booking",
        slug: "intro-a",
        customerName: "Auth Customer",
        sendSms: false,
      }),
      userContext(U.authCustomer),
    ),
  );
  const caseRow = w("interview_sessions", "INSERT")[0]?.row;
  const appt = db.appointments[0];
  ok(
    "20 authenticated ordinary booking preserved (case for the caller only)",
    r.ok &&
      caseRow?.customer_id === U.authCustomer &&
      appt?.session_id === caseRow?.id &&
      appt?.tenant_id === T.a &&
      !touchesVictim(),
    r.ok ? "" : r.message,
  );
  resetDb();
  r = await outcome(() =>
    invoke(
      bf.createAppointmentAuth,
      base({ slug: "intro-a", advisorId: U.advB, sendSms: false }),
      userContext(U.authCustomer),
    ),
  );
  ok(
    "20b authenticated caller cannot pick an adviser outside the pool",
    !r.ok && r.message === ADV_ERR && apptInserts().length === 0,
  );

  resetDb();
  r = await outcome(() =>
    invoke(
      bf.bookSessionAppointment,
      {
        sessionId: S.owner,
        channel: "voice",
        customerName: "Owner Customer",
        customerPhone: "07700 900113",
        startsAt: SLOT,
        advisorId: U.advA,
        slug: "intro-a",
      },
      userContext(U.owner),
    ),
  );
  const appt21 = db.appointments[0];
  ok(
    "21 owned-session booking preserved",
    r.ok &&
      appt21?.session_id === S.owner &&
      db.session_advisors.some((x) => x.session_id === S.owner && x.advisor_id === U.advA) &&
      db.interview_sessions.find((s) => s.id === S.owner).case_ref,
    r.ok ? "" : r.message,
  );

  resetDb();
  r = await outcome(() =>
    invoke(
      bf.bookSessionAppointment,
      {
        sessionId: S.victim,
        channel: "voice",
        customerName: "Attacker",
        customerPhone: "07700 900114",
        startsAt: SLOT,
        advisorId: U.advA,
        slug: "intro-a",
      },
      userContext(U.attacker),
    ),
  );
  ok(
    "22 non-owner session booking refused",
    !r.ok && /Forbidden/.test(r.message) && noWrites(),
    r.ok ? "accepted" : r.message,
  );
}

// =============================================================================================
// 23–26 staff / introducer trusted paths
// =============================================================================================
const bfSrc = code("src/lib/booking.functions.ts");
const headSrc = strip(
  execFileSync("git", ["show", "HEAD:src/lib/booking.functions.ts"], {
    cwd: root,
    encoding: "utf8",
  }),
).replace(/\bbookAppointment\(/g, "bookAppointmentTrusted(");
function exportBlock(src, name) {
  const start = src.indexOf(`export const ${name} = createServerFn`);
  if (start < 0) return "";
  const rest = src.slice(start + 1);
  const next = rest.search(/\n(?=[A-Za-z])/);
  return src.slice(start, next < 0 ? undefined : start + 1 + next);
}
async function tryStaff(name, fn, data, ctx, check, seed = () => {}) {
  resetDb();
  seed();
  const r = await outcome(() => invoke(fn, data, ctx));
  const unchanged =
    exportBlock(bfSrc, name) === exportBlock(headSrc, name) && exportBlock(bfSrc, name).length > 0;
  const unk = unknownCalls.filter((c) => !c.startsWith("refused host"));
  if (process.env.G7F4S2B_DEBUG && !r.ok)
    process.stderr.write(`${name}: ${r.error?.stack}\n${unk.join("\n")}\n`);
  return { r, unchanged, runtime: r.ok && check(), unk };
}
{
  const staffCtx = userContext(U.advA, "adviser.a@example.test");
  const introCtx = userContext(U.introUserA, "intro.a@example.test");
  const OWNER_CASE = "f5555555-5555-4555-8555-555555555555";
  const allocateOwner = () => {
    db.interview_sessions.push({
      id: OWNER_CASE,
      customer_id: U.owner,
      tenant_id: T.a,
      case_ref: "MG-2026-9002",
      status: "in_progress",
      deleted_at: null,
      started_at: "2026-08-01T10:00:00Z",
    });
    db.session_advisors.push(
      { session_id: S.owner, advisor_id: U.advA },
      { session_id: OWNER_CASE, advisor_id: U.advA },
    );
  };
  const specs = [
    [
      "23 staff customer booking preserved",
      "bookCustomerAppointmentAsStaff",
      bf.bookCustomerAppointmentAsStaff,
      {
        customerId: U.owner,
        sessionId: S.owner,
        customerName: "Owner Customer",
        customerPhone: "07700 900113",
        customerEmail: "owner@example.test",
        startsAt: SLOT,
        advisorId: U.advA,
        sendSms: false,
      },
      staffCtx,
      () =>
        db.appointments[0]?.session_id === S.owner &&
        db.appointments[0]?.lead_source === "introducer_portal",
      allocateOwner,
    ],
    [
      "24 staff case follow-up preserved",
      "bookCaseFollowUpAppointment",
      bf.bookCaseFollowUpAppointment,
      {
        sessionId: OWNER_CASE,
        customerId: U.owner,
        advisorId: U.advA,
        customerName: "Owner Customer",
        customerPhone: "07700 900113",
        customerEmail: "owner@example.test",
        startsAt: SLOT,
        sendSms: false,
      },
      staffCtx,
      () => db.appointments[0]?.session_id === OWNER_CASE,
      allocateOwner,
    ],
    [
      "23c staff cannot book an unallocated customer (existing check intact)",
      "bookCustomerAppointmentAsStaff",
      bf.bookCustomerAppointmentAsStaff,
      {
        customerId: U.victim,
        sessionId: S.victim,
        customerName: "Victim Customer",
        customerPhone: "07700 900111",
        customerEmail: "victim@example.test",
        startsAt: SLOT,
        advisorId: U.advA,
        sendSms: false,
      },
      staffCtx,
      "expect-refusal",
    ],
    [
      "25 staff new-customer booking preserved",
      "bookNewCustomerAsStaff",
      bf.bookNewCustomerAsStaff,
      {
        customerName: "Staff New",
        customerPhone: "07700 900501",
        customerEmail: "staff.new@example.test",
        startsAt: SLOT,
        advisorId: U.advA,
        sendSms: false,
      },
      staffCtx,
      () => db.appointments.length === 1 && w("interview_sessions", "INSERT").length === 1,
    ],
    [
      "26 introducer portal booking preserved",
      "bookNewCustomerAsIntroducer",
      bf.bookNewCustomerAsIntroducer,
      {
        customerName: "Intro New",
        customerPhone: "07700 900601",
        customerEmail: "intro.new@example.test",
        startsAt: SLOT,
        advisorId: U.advA,
        sendSms: false,
      },
      introCtx,
      () =>
        db.appointments[0]?.lead_source === "introducer_portal" &&
        db.appointments[0]?.introducer_id === I.a,
    ],
  ];
  for (const [label, name, fn, data, ctx, check, seed] of specs) {
    if (check === "expect-refusal") {
      const res = await tryStaff(name, fn, data, ctx, () => false, seed);
      ok(
        label,
        !res.r.ok && /not allocated/.test(res.r.message) && noWrites(),
        res.r.ok ? "accepted" : res.r.message,
      );
      continue;
    }
    const res = await tryStaff(name, fn, data, ctx, check, seed);
    ok(
      label,
      res.unchanged && res.runtime,
      `handler unchanged apart from rename: ${res.unchanged}; runtime: ${res.runtime ? "booked via trusted path" : res.r.ok ? "check failed" : res.r.message.slice(0, 70)}`,
    );
  }
}

// =============================================================================================
// 27–33 victim relationships cannot be reached from public input
// =============================================================================================
{
  const attacks = [
    { customerId: U.victim },
    { sessionId: S.victim },
    { sessionId: S.victimB },
    { customerId: U.victimB, sessionId: S.victimB },
  ];
  let allRejected = true;
  let anyVictimWrite = false;
  let anyVictimUrl = false;
  process.env.TWILIO_ACCOUNT_SID = "ACg7f4s2bsynthetic";
  process.env.TWILIO_AUTH_TOKEN = "g7f4s2b-synthetic";
  process.env.TWILIO_MESSAGING_SERVICE_SID = "MGg7f4s2bsynthetic";
  const paths = [
    (extra) =>
      invoke(
        bf.createAppointment,
        base({
          slug: "intro-a",
          tenantSlug: "tenant-a",
          advisorId: U.advA,
          sendSms: true,
          ...extra,
        }),
      ),
    (extra) =>
      invoke(
        bf.createAppointmentAuth,
        base({ slug: "intro-a", advisorId: U.advA, sendSms: true, ...extra }),
        userContext(U.attacker),
      ),
    // Validator bypass: a future caller posting straight to the handler.
    (extra) =>
      def(bf.createAppointment).handler({
        data: base({
          slug: "intro-a",
          tenantSlug: "tenant-a",
          advisorId: U.advA,
          sendSms: true,
          ...extra,
        }),
      }),
    (extra) =>
      def(bf.createAppointmentAuth).handler({
        data: base({ slug: "intro-a", advisorId: U.advA, sendSms: true, ...extra }),
        context: userContext(U.attacker),
      }),
  ];
  for (const attack of attacks) {
    for (const run of paths) {
      resetDb();
      const r = await outcome(() => run(attack));
      if (r.ok) allRejected = false;
      if (touchesVictim() || apptInserts().length) anyVictimWrite = true;
      if (confirmationUrls().some((u) => [S.victim, S.victimB].some((s) => u.includes(s))))
        anyVictimUrl = true;
    }
  }
  const victimSessions = () =>
    db.interview_sessions.filter((s) => [S.victim, S.victimB].includes(s.id));
  ok(
    "27 public customerId cannot create/promote a victim case",
    allRejected && !anyVictimWrite && w("interview_sessions").length === 0,
  );
  ok(
    "28 public sessionId cannot promote a victim session",
    allRejected && victimSessions().every((s) => s.case_ref === null),
  );
  ok(
    "29 public injection cannot create a session_advisors allocation",
    allRejected && db.session_advisors.length === 0,
  );
  ok(
    "30 public injection cannot create a welcome-call task",
    allRejected && db.staff_contact_tasks.length === 0,
  );
  ok(
    "31 public injection cannot create a victim introducer link",
    allRejected && db.customer_introducer_links.length === 0,
  );
  ok(
    "32 public injection cannot alter commission attribution",
    allRejected &&
      db.customer_introducer_links.length === 0 &&
      !db.appointments.some((a) => [S.victim, S.victimB].includes(a.session_id)),
  );
  ok("33 public arbitrary sessionId cannot enter SMS/session URL", allRejected && !anyVictimUrl);

  // S1B adapter: only the account created in this request may be linked.
  resetDb();
  const signupDef = def(bf.customerAppointmentSignup);
  const signupSrc = exportBlock(bfSrc, "customerAppointmentSignup");
  ok(
    "33b S1B adapter drops customerId and refuses an id other than the created account",
    /customerId !== actingUserId/.test(signupSrc) &&
      /bookAppointmentPublic\(booking, actingUserId\)/.test(signupSrc) &&
      !/bookAppointmentTrusted/.test(signupSrc) &&
      typeof signupDef.handler === "function",
  );
  delete process.env.TWILIO_ACCOUNT_SID;
  delete process.env.TWILIO_AUTH_TOKEN;
  delete process.env.TWILIO_MESSAGING_SERVICE_SID;
}

// =============================================================================================
// 34 opaque errors
// =============================================================================================
{
  resetDb();
  const foreign = await publicBook({
    slug: "intro-a",
    tenantSlug: "tenant-a",
    leadId: L.b,
    advisorId: U.advA,
  });
  const missing = await publicBook({
    slug: "intro-a",
    tenantSlug: "tenant-a",
    leadId: L.missing,
    advisorId: U.advA,
  });
  const nullTenant = await publicBook({
    slug: "intro-a",
    tenantSlug: "tenant-a",
    leadId: L.nullTenant,
    advisorId: U.advA,
  });
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const u = new URL(typeof input === "string" ? input : input.url);
    if (u.pathname === "/rest/v1/introducer_leads")
      return json({ message: "relation leak detail", code: "XX000" }, 500);
    return origFetch(input, init);
  };
  const dbErr = await publicBook({
    slug: "intro-a",
    tenantSlug: "tenant-a",
    leadId: L.a,
    advisorId: U.advA,
  });
  globalThis.fetch = origFetch;
  const advForeign = await publicBook({ tenantSlug: "tenant-a", advisorId: U.advB });
  const advMissing = await publicBook({
    tenantSlug: "tenant-a",
    advisorId: "dfffffff-ffff-4fff-8fff-ffffffffffff",
  });
  ok(
    "34 foreign / missing / invalid ids return identical opaque errors",
    [foreign, missing, nullTenant, dbErr].every((x) => !x.ok && x.message === LEAD_ERR) &&
      [advForeign, advMissing].every((x) => !x.ok && x.message === ADV_ERR),
  );
}

// =============================================================================================
// 35–36 structural boundary
// =============================================================================================
{
  const pub = contract.publicAppointmentInput;
  ok(
    "35a public schema is strict",
    pub._def.unknownKeys === "strict" || pub._def?.catchall?._def?.typeName === "ZodNever",
  );
  ok(
    "35b public schema has no trusted relationship fields",
    !["customerId", "sessionId", "tenant_id", "tenantId"].some((k) => k in pub.shape),
  );
  ok(
    "35c exported endpoints validate with the public schema only",
    /export const createAppointment = createServerFn[\s\S]{0,120}inputValidator\(\(d: unknown\) => publicAppointmentInput\.parse\(d\)\)/.test(
      bfSrc,
    ) &&
      /export const createAppointmentAuth = createServerFn[\s\S]{0,160}inputValidator\(\(d: unknown\) => publicAppointmentInput\.parse\(d\)\)/.test(
        bfSrc,
      ),
  );
  ok(
    "35d no server function parses the trusted appointment schema",
    !/appointmentInput\.parse\(/.test(bfSrc.replace(/publicAppointmentInput\.parse\(/g, "")),
  );
  ok(
    "35e trusted implementation is not exported",
    !/export\s+(async\s+)?function\s+bookAppointmentTrusted|export\s*\{[^}]*bookAppointmentTrusted/.test(
      bfSrc,
    ),
  );
  ok("35f legacy bookAppointment name no longer exists", !/\bbookAppointment\(/.test(bfSrc));
  ok(
    "35g public wrapper hands only the server-built plan to the trusted implementation",
    /async function bookAppointmentPublic\(input: unknown, actingUserId\?: string\)[\s\S]{0,400}planPublicBooking\(input,[\s\S]{0,200}return bookAppointmentTrusted\(plan, actingUserId\);/.test(
      bfSrc,
    ),
  );
  const guardSrc = code("src/lib/public-booking-guard.server.ts");
  ok(
    "35h guard re-validates with the strict schema",
    /publicAppointmentInput\.parse\(raw\)/.test(guardSrc),
  );
  ok(
    "35i guard never forwards customerId / sessionId",
    !/customerId|sessionId/.test(
      guardSrc.slice(guardSrc.indexOf("export async function planPublicBooking")),
    ),
  );
  ok(
    "35j tenant resolution in the public plan never uses advisorId",
    /resolveTenantId\(\{\s*tenantSlug:[^}]*introducerId:[^}]*actingUserId: ctx\.actingUserId,\s*\}\)/.test(
      guardSrc,
    ),
  );
  ok(
    "35k lead update cannot overwrite an existing lead appointment",
    /\.update\(\{ status: "booked", appointment_id: appointment\.id \}\)[\s\S]{0,120}\.is\("appointment_id", null\)/.test(
      bfSrc,
    ),
  );

  resetDb();
  const planned = await outcome(() =>
    guard.planPublicBooking(base({ tenantSlug: "tenant-a", sessionId: S.victim }), {
      actingUserId: null,
      resolveTenantId: async () => T.a,
    }),
  );
  const clean = await guard.planPublicBooking(base({ tenantSlug: "tenant-a", advisorId: U.advA }), {
    actingUserId: null,
    resolveTenantId: async () => T.a,
  });
  ok(
    "36 trusted-id fields refused even when posted straight past the endpoint validator",
    isZodUnrecognized(planned, "sessionId") &&
      !("customerId" in clean) &&
      !("sessionId" in clean) &&
      clean.tenant_id === T.a,
  );
}

// =============================================================================================
// Section 8 — caller review of the trusted implementation
// =============================================================================================
{
  const sites = [];
  const re = /bookAppointmentTrusted\(/g;
  let m;
  while ((m = re.exec(bfSrc))) {
    const before = bfSrc.slice(0, m.index);
    if (/async function\s*$/.test(before)) continue;
    const exp = [...before.matchAll(/export const (\w+) = createServerFn/g)].at(-1);
    const fnDecl = [...before.matchAll(/async function (\w+)\(/g)].at(-1);
    const expIdx = exp?.index ?? -1;
    const fnIdx = fnDecl?.index ?? -1;
    if (fnIdx > expIdx) {
      sites.push({ caller: fnDecl[1], kind: "internal function" });
    } else {
      const block = exportBlock(bfSrc, exp[1]);
      sites.push({
        caller: exp[1],
        kind: block.includes(".middleware([requireSupabaseAuth])")
          ? "authenticated server fn"
          : "UNAUTHENTICATED server fn",
      });
    }
  }
  const allowed = {
    bookAppointmentPublic: "public-safe wrapper (plan only: no customerId/sessionId)",
    bookSessionAppointment: "owned-session booking (session.customer_id === caller)",
    bookCustomerAppointmentAsStaff:
      "authorised staff booking (assertStaffCanAccessCustomer forMutation)",
    bookCaseFollowUpAppointment:
      "authorised staff booking (relationship access / assertStaffCanAccessCustomer)",
    bookNewCustomerAsStaff:
      "authorised staff booking (assertStaffBookingAccess + read-only resolver)",
    bookNewCustomerAsIntroducer:
      "authorised introducer booking (assertIntroducerBookingAccess + read-only resolver)",
  };
  for (const s of sites)
    console.log(
      `INFO  trusted caller: ${s.caller} [${s.kind}] — ${allowed[s.caller] ?? "UNREVIEWED"}`,
    );
  ok(
    "S8a every trusted-implementation caller is a reviewed authorised path",
    sites.length === 6 &&
      sites.every((s) => allowed[s.caller] && s.kind !== "UNAUTHENTICATED server fn"),
    `${sites.length} call sites`,
  );
  const publicSites = [];
  const reP = /bookAppointmentPublic\(/g;
  while ((m = reP.exec(bfSrc))) {
    const before = bfSrc.slice(0, m.index);
    if (/async function\s*$/.test(before)) continue;
    publicSites.push([...before.matchAll(/export const (\w+) = createServerFn/g)].at(-1)?.[1]);
  }
  ok(
    "S8b public wrapper callers are exactly createAppointment, customerAppointmentSignup, createAppointmentAuth",
    JSON.stringify([...publicSites].sort()) ===
      JSON.stringify(["createAppointment", "createAppointmentAuth", "customerAppointmentSignup"]),
    publicSites.join(","),
  );
  const unauth = [...bfSrc.matchAll(/export const (\w+) = createServerFn/g)]
    .map((x) => x[1])
    .filter((n) => !exportBlock(bfSrc, n).includes(".middleware([requireSupabaseAuth])"))
    .filter((n) => /bookAppointmentTrusted\(/.test(exportBlock(bfSrc, n)));
  ok(
    "S8c no unauthenticated exported function calls the trusted implementation",
    unauth.length === 0,
    unauth.join(","),
  );
}

if (process.env.G7F4S2B_DEBUG) {
  process.stderr.write(`${logs.join("\n")}\n`);
}
console.log(`\n${total - failures.length}/${total} PASS`);
if (failures.length) {
  process.stderr.write(`FAILED: ${failures.join(", ")}\n`);
  process.exit(1);
}
