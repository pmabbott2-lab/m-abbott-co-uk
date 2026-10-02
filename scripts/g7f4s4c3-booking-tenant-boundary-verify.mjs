/**
 * G7F-4S4C3 adviser allocation, appointment & booking tenant boundary — offline verification.
 * Real server-function validators and handlers run against an in-memory PostgREST fake on a
 * non-routable host. Synthetic fixtures only: no database, no network, no production, no real
 * customer, staff or privileged identity, no phone numbers, no SMS, no calls.
 * Run: npm exec --yes --package=tsx -- tsx scripts/g7f4s4c3-booking-tenant-boundary-verify.mjs
 */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { register } from "node:module";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";

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
const code = (rel) => strip(readFileSync(resolve(root, rel), "utf8"));

// --- module stubs: createServerFn capture, request Referer, Enter Company sessions ------------
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
export function getRequest() { return globalThis.__S4C3_REQUEST ?? null; }
export function getCookie() { return undefined; }
export function setCookie() {}
export function deleteCookie() {}
`;
const stubPlatform = `
export async function validatePlatformTenantAccessSession(input) {
  return globalThis.__S4C3_PLATFORM?.get(input.userId + ":" + input.tenantId) ?? null;
}
export async function hasValidPlatformTenantAccess() { return false; }
export async function clearPlatformTenantEntryOnLogout() {}
`;
const dataUrl = (src) => `data:text/javascript,${encodeURIComponent(src)}`;
const hookSource = `
const fromData = (ctx) => String(ctx.parentURL ?? "").startsWith("data:");
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
  return next(specifier, context);
}
`;
register(dataUrl(hookSource), import.meta.url);

// --- synthetic fixtures ------------------------------------------------------------------------
const FAKE_HOST = "g7f4s4c3.invalid";
process.env.SUPABASE_URL = `http://${FAKE_HOST}`;
process.env.VITE_SUPABASE_URL = `http://${FAKE_HOST}`;
process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_secret_g7f4s4c3_not_a_real_key";
process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_g7f4s4c3_not_a_real_key";
process.env.VITE_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_g7f4s4c3_not_a_real_key";

const id = (prefix, n) =>
  `${prefix}${String(n).repeat(7).slice(0, 7)}-0000-4000-8000-${String(n).padStart(12, "0")}`;
const T = { a: id("1", 1), b: id("1", 2) };
const U = {
  ownerA: id("2", 1),
  ownerB: id("2", 2),
  supA: id("2", 3),
  advA: id("2", 4),
  advA2: id("2", 5),
  advB: id("2", 6),
  generalA: id("2", 7),
  platRO: id("3", 1),
  custA: id("4", 1),
  custB: id("4", 2),
  custMulti: id("4", 3),
  custNull: id("4", 4),
  custA3: id("4", 5),
  custX: id("4", 6),
};
const S = {
  a1: id("5", 1),
  a2: id("5", 2),
  a3: id("5", 3),
  b1: id("5", 4),
  mA: id("5", 5),
  mB: id("5", 6),
  nul: id("5", 7),
  xA: id("5", 8),
  xB: id("5", 9),
};
const I = { a: id("7", 1), b: id("7", 2) };
const APPT = { a1: id("8", 1), b1: id("8", 2), nul: id("8", 3) };
const CB = { a: id("9", 1), b: id("9", 2), nul: id("9", 3) };
const RANDOM = "9f9f9f9f-9f9f-4f9f-8f9f-9f9f9f9f9f9f";
const PHONE_PLACEHOLDER = "SYNTHETIC";

const now = Date.now();
const daysAgo = (d) => new Date(now - d * 86400000).toISOString();
let slotCounter = 0;
/** Distinct future slot per booking (whole hours) so exact-start conflicts never collide. */
function nextSlot() {
  slotCounter += 1;
  const t = new Date(now + (20 + slotCounter) * 86400000);
  t.setUTCHours(10, 0, 0, 0);
  return t.toISOString();
}

let db;
function resetDb() {
  const profile = (pid, full_name, email) => ({ id: pid, full_name, email, phone: null });
  const mem = (user_id, tenant_id, role, active = true) => ({
    id: randomUUID(),
    user_id,
    tenant_id,
    role,
    active,
  });
  const sess = (sid, customer_id, tenant_id, case_ref, extra = {}) => ({
    id: sid,
    customer_id,
    tenant_id,
    case_ref,
    status: "in_progress",
    deleted_at: null,
    started_at: daysAgo(5),
    updated_at: daysAgo(3),
    created_at: daysAgo(5),
    ...extra,
  });
  const appt = (aid, tenant_id, session_id, advisor_id, customer_name) => ({
    id: aid,
    tenant_id,
    session_id,
    advisor_id,
    introducer_id: null,
    lead_id: null,
    status: "confirmed",
    customer_name,
    customer_phone: PHONE_PLACEHOLDER,
    customer_email: null,
    starts_at: nextSlot(),
    ends_at: null,
    created_at: daysAgo(2),
    lead_source: "web",
    referral_channel: null,
  });
  const callback = (cid, tenant_id, session_id, advisor_id, customer_name) => ({
    id: cid,
    tenant_id,
    session_id,
    advisor_id,
    customer_name,
    customer_phone: null,
    customer_email: null,
    preferred_window: "any",
    status: "new",
    notes: null,
    phone_call_id: null,
    created_at: daysAgo(1),
  });
  db = {
    tenants: [
      {
        id: T.a,
        slug: "tenant-a",
        company_name: "Tenant A",
        status: "active",
        tenant_type: "firm",
        company_code: "901",
      },
      {
        id: T.b,
        slug: "tenant-b",
        company_name: "Tenant B",
        status: "active",
        tenant_type: "firm",
        company_code: "902",
      },
    ],
    tenant_memberships: [
      mem(U.ownerA, T.a, "owner"),
      mem(U.ownerB, T.b, "owner"),
      mem(U.supA, T.a, "supervisor"),
      mem(U.advA, T.a, "adviser"),
      mem(U.advA2, T.a, "adviser"),
      mem(U.advB, T.b, "adviser"),
      mem(U.generalA, T.a, "general"),
      mem(U.custA, T.a, "customer"),
      mem(U.custB, T.b, "customer"),
      mem(U.custMulti, T.a, "customer"),
      mem(U.custMulti, T.b, "customer"),
      mem(U.custA3, T.a, "customer"),
      mem(U.custX, T.a, "customer"),
      mem(U.custX, T.b, "customer"),
    ],
    admin_permissions: [
      { user_id: U.generalA, tenant_id: T.a, permission_key: "relationship", access: "view" },
    ],
    profiles: [
      profile(U.ownerA, "Alpha Owner", "owner@alpha.example.test"),
      profile(U.ownerB, "Bravo Owner", "owner@bravo.example.test"),
      profile(U.supA, "Alpha Supervisor", "supervisor@alpha.example.test"),
      profile(U.advA, "Alpha Adviser", "adviser@alpha.example.test"),
      profile(U.advA2, "Alpha Adviser Two", "adviser2@alpha.example.test"),
      profile(U.advB, "Bravo Adviser", "adviser@bravo.example.test"),
      profile(U.generalA, "Alpha General", "general@alpha.example.test"),
      profile(U.custA, "Alpha Customer", "customer@alpha.example.test"),
      profile(U.custB, "Bravo Customer", "customer@bravo.example.test"),
      profile(U.custMulti, "Multi Customer", "multi@shared.example.test"),
      profile(U.custNull, "Nullco Customer", "customer@nullco.example.test"),
      profile(U.custA3, "Alpha Three Customer", "three@alpha.example.test"),
      profile(U.custX, "Unlinked Multi Customer", "unlinked@shared.example.test"),
    ],
    interview_sessions: [
      sess(S.a1, U.custA, T.a, "MG-A-0001"),
      sess(S.a2, U.custA, T.a, null),
      sess(S.a3, U.custA3, T.a, "MG-A-0003"),
      sess(S.b1, U.custB, T.b, "MG-B-0001"),
      sess(S.mA, U.custMulti, T.a, "MG-M-000A"),
      sess(S.mB, U.custMulti, T.b, null, { started_at: daysAgo(1) }),
      sess(S.nul, U.custNull, null, "MG-N-0001"),
      sess(S.xA, U.custX, T.a, "MG-X-000A"),
      sess(S.xB, U.custX, T.b, "MG-X-000B"),
    ],
    session_advisors: [
      { id: randomUUID(), session_id: S.a1, advisor_id: U.advA, tenant_id: T.a },
      { id: randomUUID(), session_id: S.a3, advisor_id: U.advA, tenant_id: T.a },
      { id: randomUUID(), session_id: S.mA, advisor_id: U.advA, tenant_id: T.a },
      { id: randomUUID(), session_id: S.xA, advisor_id: U.advA, tenant_id: T.a },
      { id: randomUUID(), session_id: S.b1, advisor_id: U.advB, tenant_id: T.b },
      { id: randomUUID(), session_id: S.mB, advisor_id: U.advB, tenant_id: T.b },
      { id: randomUUID(), session_id: S.nul, advisor_id: U.advA, tenant_id: null },
    ],
    appointments: [
      appt(APPT.a1, T.a, S.a1, U.advA, "Alpha Customer"),
      appt(APPT.b1, T.b, S.b1, U.advB, "Bravo Customer"),
      appt(APPT.nul, null, null, U.advA, "Nullco Caller"),
    ],
    callback_requests: [
      callback(CB.a, T.a, S.a2, U.advA, "Alpha Callback"),
      callback(CB.b, T.b, S.b1, U.advB, "Bravo Callback"),
      callback(CB.nul, null, null, null, "Nullco Voicemail"),
    ],
    phone_calls: [],
    staff_contact_tasks: [],
    session_contact_tracking: [],
    advisor_contact_views: [],
    advisor_notes: [],
    advisor_diary_settings: [],
    advisor_availability: [],
    interview_messages: [],
    interview_answers: [],
    customer_introducer_links: [
      { customer_id: U.custA, introducer_id: I.a, tenant_id: T.a, source: "seed" },
      { customer_id: U.custB, introducer_id: I.b, tenant_id: T.b, source: "seed" },
      { customer_id: U.custMulti, introducer_id: I.b, tenant_id: null, source: "seed" },
    ],
    introducer_leads: [],
    introducer_amendment_history: [],
    introducers: [
      {
        id: I.a,
        tenant_id: T.a,
        user_id: null,
        company_code: "INT-A",
        company_name: "Alpha Introducer Co",
        slug: "intro-a",
        active: true,
        deleted_at: null,
      },
      {
        id: I.b,
        tenant_id: T.b,
        user_id: null,
        company_code: "INT-B",
        company_name: "Bravo Introducer Co",
        slug: "intro-b",
        active: true,
        deleted_at: null,
      },
    ],
    commission_rates: [],
    commission_ledger: [],
    advisor_profiles: [
      {
        user_id: U.advA,
        tenant_id: T.a,
        code: "ADV-A1",
        deleted_at: null,
        teams_calendar_enabled: true,
      },
      { user_id: U.advA2, tenant_id: T.a, code: "ADV-A2", deleted_at: null },
      { user_id: U.advB, tenant_id: T.b, code: "ADV-B1", deleted_at: null },
    ],
    sms_messages: [],
  };
  writes.length = 0;
  unknownCalls.length = 0;
}

globalThis.__S4C3_PLATFORM = new Map([
  [`${U.platRO}:${T.a}`, { accessLevel: "read_only", basisLabel: "synthetic read-only" }],
]);

// --- in-memory PostgREST fake ------------------------------------------------------------------
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
      const pat = arg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*");
      return value != null && new RegExp(`^${pat}$`, op === "ilike" ? "i" : "").test(String(value));
    }
    default:
      throw new Error(`fake postgrest: unsupported op ${op}`);
  }
}
function splitTopLevel(s) {
  const out = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    if (ch === "," && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}
function matchOr(row, v) {
  return splitTopLevel(v.replace(/^\(|\)$/g, "")).some((part) => {
    const dot = part.indexOf(".");
    return matchOp(row[part.slice(0, dot)], part.slice(dot + 1));
  });
}
function applyFilters(rows, url) {
  let out = rows;
  for (const [k, v] of url.searchParams.entries()) {
    if (RESERVED.has(k)) continue;
    if (k === "or") out = out.filter((r) => matchOr(r, v));
    else if (k === "and") throw new Error(`fake postgrest: unsupported and=${v}`);
    else out = out.filter((r) => matchOp(r[k], v));
  }
  const order = url.searchParams.get("order");
  if (order) {
    const [col, dir] = order.split(",")[0].split(".");
    out = [...out].sort((a, b) => cmp(a[col], b[col]) * (dir === "desc" ? -1 : 1));
  }
  const offset = Number(url.searchParams.get("offset") ?? 0);
  const limit = url.searchParams.get("limit");
  out = out.slice(offset, limit ? offset + Number(limit) : undefined);
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

let caseRefSeq = 0;
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === "string" ? input : (input.url ?? String(input)));
  if (url.hostname !== FAKE_HOST) {
    unknownCalls.push(`refused host ${url.hostname}`);
    throw new Error(`G7F4S4C3 fetch stub refused host ${url.hostname}`);
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
    if (fn === "has_tenant_membership") {
      return json(
        db.tenant_memberships.some(
          (m) => m.user_id === body?.p_user_id && m.tenant_id === body?.p_tenant_id && m.active,
        ),
      );
    }
    if (fn === "is_tenant_feature_enabled") {
      return json(db.tenants.some((t) => t.id === body?.p_tenant_id));
    }
    if (fn === "allocate_case_ref") {
      caseRefSeq += 1;
      return json(`MG-S4C3-${String(caseRefSeq).padStart(4, "0")}`);
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
          return json({ code: "23505", message: `duplicate key on ${table}` }, 409);
        }
        if (row.id === undefined && !["advisor_profiles", "commission_rates"].includes(table))
          row.id = randomUUID();
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
      return wantRows ? respondRows(hit, headers, "PATCH") : new Response(null, { status: 204 });
    }
    if (method === "DELETE") {
      const hit = new Set(applyFilters(rows, url));
      db[table] = rows.filter((r) => !hit.has(r));
      for (const r of hit) writes.push({ method: "DELETE", table, row: { ...r } });
      return new Response(null, { status: 204 });
    }
  }
  unknownCalls.push(`${method} ${p}`);
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
const sf = await import("../src/lib/sessions.functions.ts");
const bf = await import("../src/lib/booking.functions.ts");
const ta = await import("../src/lib/tenant-assert.server.ts");

async function invoke(fn, data, context) {
  const d = fn.__def;
  const parsed = d.validator ? await d.validator(data) : data;
  return d.handler({ data: parsed, context });
}
/** Actor context; `slug` simulates the verified /$tenantSlug route carried in the Referer. */
function as(userId, slug = null) {
  return { userId, slug };
}
async function call(fn, data, actor) {
  globalThis.__S4C3_REQUEST = actor?.slug
    ? new Request(`http://app.invalid/_serverFn/x`, {
        headers: { referer: `http://app.invalid/${actor.slug}/admin` },
      })
    : null;
  return outcome(() =>
    invoke(fn, data, {
      userId: actor?.userId ?? null,
      claims: actor ? { sub: actor.userId } : null,
      supabase: null,
    }),
  );
}
const NOT_FOUND = ta.RESOURCE_NOT_FOUND_MESSAGE;
const ATTRIBUTION_LOCKED = "This booking can't be completed from this company account yet.";
const notFound = (r) => !r.ok && r.message === NOT_FOUND;
const denied = (r) => !r.ok;
const leakFree = (r) =>
  !r.ok &&
  !["tenant-a", "tenant-b", "Bravo", "Alpha", "Nullco", T.a, T.b, U.custB, U.advB, I.b].some((s) =>
    r.message.includes(s),
  );
const mark = () => writes.length;
const writesSince = (m) => writes.slice(m);
const businessWritesSince = (m) =>
  writesSince(m).filter((w) => !["advisor_contact_views"].includes(w.table));
const row = (table, rid) => db[table].find((r) => r.id === rid);
const describe = (...rs) => rs.map((r) => (r.ok ? "ok" : r.message)).join(" | ");

const ownerA = as(U.ownerA, "tenant-a");
const supA = as(U.supA, "tenant-a");
const advA = as(U.advA, "tenant-a");
const advA2 = as(U.advA2, "tenant-a");
const advB = as(U.advB, "tenant-b");
const ownerB = as(U.ownerB, "tenant-b");
const generalA = as(U.generalA, "tenant-a");
const platRO = as(U.platRO, "tenant-a");
const custA = as(U.custA, "tenant-a");
const custNull = as(U.custNull, null);

const followUp = (sessionId, customerId, extra = {}) => ({
  sessionId,
  customerId,
  customerName: "Synthetic Customer",
  customerPhone: PHONE_PLACEHOLDER,
  customerEmail: "synthetic@example.test",
  startsAt: nextSlot(),
  sendSms: false,
  ...extra,
});
const staffBooking = (customerId, extra = {}) => ({
  customerId,
  customerName: "Synthetic Customer",
  customerPhone: PHONE_PLACEHOLDER,
  customerEmail: "synthetic@example.test",
  startsAt: nextSlot(),
  sendSms: false,
  ...extra,
});

// --- fingerprints (T19 / T20) ----------------------------------------------------------------
const pick = (rows, cols) =>
  (rows ?? [])
    .map((r) => cols.map((c) => r[c] ?? null))
    .map((x) => JSON.stringify(x))
    .sort();
const hash = (material) => createHash("sha256").update(JSON.stringify(material)).digest("hex");
/** Business identity: tenants, Auth ids, memberships, adviser codes, introducers, attribution. */
function identityFingerprint() {
  return hash({
    tenants: pick(db.tenants, ["id", "slug", "company_name", "company_code", "status"]),
    memberships: pick(db.tenant_memberships, ["user_id", "tenant_id", "role", "active"]),
    adviserCodes: pick(db.advisor_profiles, ["user_id", "tenant_id", "code"]),
    profiles: pick(db.profiles, ["id", "full_name", "email", "phone"]),
    seededIntroducers: pick(
      db.introducers.filter((r) => [I.a, I.b].includes(r.id)),
      ["id", "tenant_id", "user_id", "company_code", "slug", "active"],
    ),
    seededLinks: pick(
      db.customer_introducer_links.filter((l) =>
        [U.custA, U.custB, U.custMulti].includes(l.customer_id),
      ),
      ["customer_id", "introducer_id", "tenant_id", "source"],
    ),
    commission: pick(db.commission_ledger, ["id"]),
  });
}
/** Everything a denied call must leave untouched. */
function stateFingerprint() {
  return hash({
    identity: identityFingerprint(),
    sessions: pick(db.interview_sessions, ["id", "customer_id", "tenant_id", "case_ref"]),
    allocations: pick(db.session_advisors, ["session_id", "advisor_id", "tenant_id"]),
    appointments: pick(db.appointments, [
      "id",
      "tenant_id",
      "session_id",
      "advisor_id",
      "introducer_id",
      "starts_at",
      "status",
    ]),
    callbacks: pick(db.callback_requests, [
      "id",
      "tenant_id",
      "session_id",
      "advisor_id",
      "status",
    ]),
    links: pick(db.customer_introducer_links, ["customer_id", "introducer_id", "tenant_id"]),
    introducers: pick(db.introducers, ["id", "tenant_id", "user_id"]),
    tasks: pick(db.staff_contact_tasks, ["session_id", "tenant_id"]),
  });
}

// =============================================================================================
// T1 same-tenant follow-up succeeds (allocated adviser, default adviser = allocated one)
// =============================================================================================
let t1Appointment = null;
{
  resetDb();
  const r = await call(bf.bookCaseFollowUpAppointment, followUp(S.a1, U.custA), advA);
  t1Appointment = r.ok ? r.value : null;
  ok(
    "T1 same-tenant follow-up succeeds",
    r.ok &&
      r.value.session_id === S.a1 &&
      r.value.tenant_id === T.a &&
      r.value.advisor_id === U.advA &&
      row("appointments", r.value.id)?.tenant_id === T.a,
    describe(r),
  );
  const rel = await call(bf.bookCaseFollowUpAppointment, followUp(S.a1, U.custA), generalA);
  const sup = await call(bf.bookCaseFollowUpAppointment, followUp(S.a1, U.custA), supA);
  ok(
    "T1b same-tenant relationship viewer (general admin) and Supervisor still book follow-ups",
    rel.ok && rel.value.tenant_id === T.a && sup.ok && sup.value.tenant_id === T.a,
    describe(rel, sup),
  );
}

// =============================================================================================
// T2 / T3 / T4 cross-tenant, unknown and tenantless sessions — every path, identical result
// =============================================================================================
{
  resetDb();
  const before = stateFingerprint();
  const m = mark();
  const results = {};
  for (const [label, actor] of [
    ["advA", advA],
    ["ownerA", ownerA],
    ["supA", supA],
    ["generalA(relationship-view)", generalA],
  ]) {
    results[label] = {
      cross: await call(bf.bookCaseFollowUpAppointment, followUp(S.b1, U.custB), actor),
      crossOwnCustomer: await call(bf.bookCaseFollowUpAppointment, followUp(S.b1, U.custA), actor),
      unknown: await call(bf.bookCaseFollowUpAppointment, followUp(RANDOM, U.custA), actor),
      tenantless: await call(bf.bookCaseFollowUpAppointment, followUp(S.nul, U.custNull), actor),
      multiOther: await call(bf.bookCaseFollowUpAppointment, followUp(S.mB, U.custMulti), actor),
    };
  }
  const all = Object.values(results);
  ok(
    "T2 cross-tenant session cannot be used for a follow-up (staff + relationship-view paths)",
    all.every((r) => notFound(r.cross) && notFound(r.crossOwnCustomer) && notFound(r.multiOther)),
    Object.entries(results)
      .map(([k, r]) => `${k}:${describe(r.cross, r.crossOwnCustomer, r.multiOther)}`)
      .join(" ; "),
  );
  ok(
    "T3 unknown session is indistinguishable from a cross-tenant session",
    all.every(
      (r) =>
        notFound(r.unknown) &&
        r.unknown.message === r.cross.message &&
        leakFree(r.unknown) &&
        leakFree(r.cross),
    ),
  );
  ok(
    "T4 tenantless session is blocked with the same result",
    all.every((r) => notFound(r.tenantless) && r.tenantless.message === r.cross.message),
  );
  ok(
    "T2-4 no write of any kind before/after a refused follow-up",
    writesSince(m).length === 0 && stateFingerprint() === before,
    `${writesSince(m).length} writes`,
  );
  const ro = await call(bf.bookCaseFollowUpAppointment, followUp(S.a1, U.custA), platRO);
  ok(
    "T2b platform read-only entry cannot book (no mutation)",
    denied(ro) && writesSince(m).length === 0,
    describe(ro),
  );
}

// =============================================================================================
// T5 browser-supplied adviser cannot change tenant; T6 002 adviser cannot be put on a 001 booking
// =============================================================================================
{
  resetDb();
  const before = stateFingerprint();
  const viaFollowUp = await call(
    bf.bookCaseFollowUpAppointment,
    followUp(S.a1, U.custA, { advisorId: U.advB }),
    ownerA,
  );
  const viaStaff = await call(
    bf.bookCustomerAppointmentAsStaff,
    staffBooking(U.custA, { advisorId: U.advB }),
    ownerA,
  );
  const viaStaffSession = await call(
    bf.bookCustomerAppointmentAsStaff,
    staffBooking(U.custA, { advisorId: U.advB, sessionId: S.a2 }),
    ownerA,
  );
  const viaCustomer = await call(
    bf.bookSessionAppointment,
    {
      sessionId: S.a2,
      channel: "text",
      customerName: "Alpha Customer",
      customerPhone: PHONE_PLACEHOLDER,
      startsAt: nextSlot(),
      advisorId: U.advB,
    },
    custA,
  );
  const allRefused = [viaFollowUp, viaStaff, viaStaffSession, viaCustomer].every(notFound);
  ok(
    "T5 browser-supplied adviser cannot move the booking into the adviser's tenant",
    allRefused && stateFingerprint() === before,
    describe(viaFollowUp, viaStaff, viaStaffSession, viaCustomer),
  );
  const withTenantField = await call(
    bf.bookCaseFollowUpAppointment,
    followUp(S.a1, U.custA, { tenant_id: T.b, tenantSlug: "tenant-b" }),
    advA,
  );
  ok(
    "T5b caller-supplied tenant fields are ignored: booking tenant stays the session tenant",
    withTenantField.ok && withTenantField.value.tenant_id === T.a,
    describe(withTenantField),
  );
  ok(
    "T6 a tenant-B adviser cannot be assigned to a tenant-A booking",
    notFound(viaFollowUp) &&
      notFound(viaStaff) &&
      !db.appointments.some((a) => a.tenant_id === T.a && a.advisor_id === U.advB),
  );
}

// =============================================================================================
// T7 new staff session gets the acting tenant; T8 appointment == session == acting tenant
// =============================================================================================
{
  resetDb();
  const sessionsBefore = db.interview_sessions.length;
  const r = await call(
    bf.bookCustomerAppointmentAsStaff,
    staffBooking(U.custA3, { advisorId: U.advA }),
    ownerA,
  );
  const created = db.interview_sessions.slice(sessionsBefore);
  const newSession = created[0];
  ok(
    "T7 a new staff-created case session gets the verified acting tenant_id",
    r.ok &&
      created.length === 1 &&
      newSession.tenant_id === T.a &&
      newSession.customer_id === U.custA3 &&
      Boolean(newSession.case_ref),
    describe(r),
  );
  const appt = r.ok ? row("appointments", r.value.id) : null;
  const alloc = db.session_advisors.find((s) => s.session_id === newSession?.id);
  ok(
    "T8 appointment tenant == session tenant == acting tenant (staff booking + follow-up)",
    appt &&
      appt.tenant_id === T.a &&
      appt.session_id === newSession.id &&
      newSession.tenant_id === appt.tenant_id &&
      alloc?.tenant_id === T.a &&
      t1Appointment?.tenant_id === T.a &&
      t1Appointment?.session_id === S.a1,
    appt ? `appt=${appt.tenant_id === T.a} session=${newSession.tenant_id === T.a}` : "no appt",
  );
  const task = db.staff_contact_tasks.find((t) => t.session_id === newSession?.id);
  ok(
    "T8b allocation and welcome-call task written by the booking carry the booking tenant",
    !task || task.tenant_id === T.a,
    task ? `task tenant ${task.tenant_id === T.a ? "A" : task.tenant_id}` : "no task row",
  );
}

// =============================================================================================
// T9 multi-tenant customer can book in tenant A; T10 tenant-A booking never selects a B session
// =============================================================================================
{
  resetDb();
  const linkBefore = JSON.stringify(
    db.customer_introducer_links.filter((l) => l.customer_id === U.custMulti),
  );
  const sessionsBefore = db.interview_sessions.length;
  const staff = await call(
    bf.bookCustomerAppointmentAsStaff,
    staffBooking(U.custMulti, { advisorId: U.advA }),
    ownerA,
  );
  const follow = await call(bf.bookCaseFollowUpAppointment, followUp(S.mA, U.custMulti), advA);
  const created = db.interview_sessions.slice(sessionsBefore);
  ok(
    "T9 a customer with relationships in A and B can book in A (staff booking + follow-up)",
    staff.ok && staff.value.tenant_id === T.a && follow.ok && follow.value.tenant_id === T.a,
    describe(staff, follow),
  );
  const mB = row("interview_sessions", S.mB);
  ok(
    "T10 the tenant-A booking never selected the customer's newer unbooked tenant-B session",
    staff.ok &&
      staff.value.session_id !== S.mB &&
      created.length === 1 &&
      created[0].tenant_id === T.a &&
      !db.appointments.some((a) => a.session_id === S.mB) &&
      !db.session_advisors.some((s) => s.session_id === S.mB && s.advisor_id === U.advA) &&
      mB.case_ref === null,
    staff.ok ? `selected ${staff.value.session_id === S.mB ? "B session" : "A session"}` : "",
  );
  const explicitB = await call(
    bf.bookCustomerAppointmentAsStaff,
    staffBooking(U.custMulti, { advisorId: U.advA, sessionId: S.mB }),
    ownerA,
  );
  ok(
    "T10b an explicit tenant-B session id on a tenant-A staff booking is Not found",
    notFound(explicitB),
    describe(explicitB),
  );
  ok(
    "T9b the multi-tenant customer's existing global introducer link is untouched",
    JSON.stringify(db.customer_introducer_links.filter((l) => l.customer_id === U.custMulti)) ===
      linkBefore,
  );
}

// =============================================================================================
// T11 allocated adviser OK; T12 unallocated denied; T13 cross-tenant adviser denied
// =============================================================================================
{
  resetDb();
  const allocated = await call(
    bf.bookCustomerAppointmentAsStaff,
    staffBooking(U.custA, { sessionId: S.a2, advisorId: U.advA }),
    advA,
  );
  ok(
    "T11 allocated same-tenant adviser can book",
    allocated.ok && allocated.value.tenant_id === T.a && allocated.value.session_id === S.a2,
    describe(allocated),
  );
  resetDb();
  const before = stateFingerprint();
  const unFollow = await call(bf.bookCaseFollowUpAppointment, followUp(S.a1, U.custA), advA2);
  const unStaff = await call(
    bf.bookCustomerAppointmentAsStaff,
    staffBooking(U.custA, { sessionId: S.a2, advisorId: U.advA2 }),
    advA2,
  );
  ok(
    "T12 unallocated same-tenant adviser is denied (no writes)",
    denied(unFollow) && denied(unStaff) && stateFingerprint() === before,
    describe(unFollow, unStaff),
  );
  const crossFollow = await call(bf.bookCaseFollowUpAppointment, followUp(S.a1, U.custA), advB);
  const crossStaff = await call(
    bf.bookCustomerAppointmentAsStaff,
    staffBooking(U.custA, { advisorId: U.advB }),
    advB,
  );
  ok(
    "T13 cross-tenant adviser is denied with Not found (no writes)",
    notFound(crossFollow) && denied(crossStaff) && stateFingerprint() === before,
    describe(crossFollow, crossStaff),
  );
}

// =============================================================================================
// T14 / T15 getSession existence oracle
// =============================================================================================
{
  resetDb();
  const results = [];
  for (const actor of [advA, advA2, ownerA, supA, generalA, platRO]) {
    results.push({
      unknown: await call(sf.getSession, { sessionId: RANDOM }, actor),
      cross: await call(sf.getSession, { sessionId: S.b1 }, actor),
      tenantless: await call(sf.getSession, { sessionId: S.nul }, actor),
    });
  }
  ok(
    "T14 getSession: unknown session == cross-tenant session (Not found.)",
    results.every(
      (r) => notFound(r.unknown) && notFound(r.cross) && r.unknown.message === r.cross.message,
    ),
    results.map((r) => describe(r.unknown, r.cross)).join(" ; "),
  );
  ok(
    "T15 getSession: tenantless session does not reveal existence",
    results.every(
      (r) =>
        notFound(r.tenantless) &&
        r.tenantless.message === r.unknown.message &&
        leakFree(r.tenantless),
    ),
  );
  const own = await call(sf.getSession, { sessionId: S.a1 }, ownerA);
  const alloc = await call(sf.getSession, { sessionId: S.a1 }, advA);
  const unalloc = await call(sf.getSession, { sessionId: S.a1 }, advA2);
  const cust = await call(sf.getSession, { sessionId: S.a1 }, custA);
  const ownerBCross = await call(sf.getSession, { sessionId: S.a1 }, ownerB);
  const platformRead = await call(sf.getSession, { sessionId: S.a1 }, platRO);
  ok(
    "T14c getSession: platform read-only entry still reads a session of the entered tenant",
    platformRead.ok && platformRead.value.session.id === S.a1,
    describe(platformRead),
  );
  ok(
    "T14b getSession same-tenant behaviour preserved (Owner, allocated adviser, customer owner; unallocated adviser refused)",
    own.ok &&
      own.value.session.id === S.a1 &&
      alloc.ok &&
      cust.ok &&
      !unalloc.ok &&
      /not allocated/i.test(unalloc.message) &&
      notFound(ownerBCross),
    describe(own, alloc, unalloc, cust, ownerBCross),
  );
}

// =============================================================================================
// T16 S4C2 notes intact; T17 global profile mutation still fails closed
// =============================================================================================
{
  resetDb();
  const add = await call(sf.addAdvisorNote, { sessionId: S.a1, note: "s4c3 note" }, advA);
  const list = await call(sf.listNotes, { sessionId: S.a1 }, advA);
  const crossAdd = await call(sf.addAdvisorNote, { sessionId: S.b1, note: "x" }, advA);
  const crossList = await call(sf.listNotes, { sessionId: S.b1 }, advA);
  ok(
    "T16 S4C2 per-session notes still work in-tenant and refuse cross-tenant",
    add.ok && list.ok && notFound(crossAdd) && notFound(crossList),
    describe(add, list, crossAdd, crossList),
  );
  const nameBefore = row("profiles", U.custMulti).full_name;
  const edit = await call(
    sf.updateCustomerContact,
    { customerId: U.custMulti, fullName: "Changed Name" },
    ownerA,
  );
  ok(
    "T17 global profile mutation for a multi-tenant customer still fails closed",
    denied(edit) && row("profiles", U.custMulti).full_name === nameBefore,
    describe(edit),
  );
}

// =============================================================================================
// T18 S2 public createAppointment intact
// =============================================================================================
{
  resetDb();
  const before = stateFingerprint();
  const injectedSession = await call(
    bf.createAppointment,
    {
      tenantSlug: "tenant-a",
      sessionId: S.a1,
      customerName: "Public Visitor",
      customerPhone: PHONE_PLACEHOLDER,
      startsAt: nextSlot(),
    },
    null,
  );
  const injectedCustomer = await call(
    bf.createAppointment,
    {
      tenantSlug: "tenant-a",
      customerId: U.custA,
      customerName: "Public Visitor",
      customerPhone: PHONE_PLACEHOLDER,
      startsAt: nextSlot(),
    },
    null,
  );
  const injectedTenant = await call(
    bf.createAppointment,
    {
      tenantSlug: "tenant-a",
      tenant_id: T.b,
      customerName: "Public Visitor",
      customerPhone: PHONE_PLACEHOLDER,
      startsAt: nextSlot(),
    },
    null,
  );
  const crossAdviser = await call(
    bf.createAppointment,
    {
      tenantSlug: "tenant-a",
      advisorId: U.advB,
      customerName: "Public Visitor",
      customerPhone: PHONE_PLACEHOLDER,
      startsAt: nextSlot(),
    },
    null,
  );
  ok(
    "T18 S2 public createAppointment still rejects session/customer/tenant ids and other-tenant advisers",
    denied(injectedSession) &&
      denied(injectedCustomer) &&
      denied(injectedTenant) &&
      denied(crossAdviser) &&
      stateFingerprint() === before,
    describe(injectedSession, injectedCustomer, injectedTenant, crossAdviser),
  );
  const pub = await call(
    bf.createAppointment,
    {
      tenantSlug: "tenant-a",
      advisorId: U.advA,
      customerName: "Public Visitor",
      customerPhone: PHONE_PLACEHOLDER,
      startsAt: nextSlot(),
      sendSms: false,
    },
    null,
  );
  ok(
    "T18b S2 public booking in tenant A still succeeds, tenant from the route, no session/customer",
    pub.ok && pub.value.tenant_id === T.a && !pub.value.session_id,
    describe(pub),
  );
}

// =============================================================================================
// Other S4C3 entry points
// =============================================================================================
{
  resetDb();
  // Customer self-booking binds to the session's tenant; others' and tenantless sessions refuse.
  const ownSelf = await call(
    bf.bookSessionAppointment,
    {
      sessionId: S.a2,
      channel: "text",
      customerName: "Alpha Customer",
      customerPhone: PHONE_PLACEHOLDER,
      startsAt: nextSlot(),
      advisorId: U.advA,
    },
    custA,
  );
  const otherSelf = await call(
    bf.bookSessionAppointment,
    {
      sessionId: S.b1,
      channel: "text",
      customerName: "Alpha Customer",
      customerPhone: PHONE_PLACEHOLDER,
      startsAt: nextSlot(),
    },
    custA,
  );
  const nullSelf = await call(
    bf.bookSessionAppointment,
    {
      sessionId: S.nul,
      channel: "text",
      customerName: "Nullco Customer",
      customerPhone: PHONE_PLACEHOLDER,
      startsAt: nextSlot(),
      advisorId: U.advA,
    },
    custNull,
  );
  ok(
    "E1 bookSessionAppointment: own session books in its tenant; other/tenantless sessions Not found",
    ownSelf.ok &&
      ownSelf.value.tenant_id === T.a &&
      notFound(otherSelf) &&
      notFound(nullSelf) &&
      otherSelf.message === nullSelf.message,
    describe(ownSelf, otherSelf, nullSelf),
  );
}
{
  resetDb();
  const before = stateFingerprint();
  const bookingCross = await call(bf.getSessionBooking, { sessionId: S.b1 }, advA);
  const bookingUnknown = await call(bf.getSessionBooking, { sessionId: RANDOM }, advA);
  const bookingNull = await call(bf.getSessionBooking, { sessionId: S.nul }, advA);
  const apptCross = await call(bf.getAppointmentForSession, { sessionId: S.b1 }, ownerA);
  const bookingOwn = await call(bf.getSessionBooking, { sessionId: S.a1 }, ownerA);
  ok(
    "E2 getSessionBooking / getAppointmentForSession: cross-tenant, unknown, tenantless Not found; same-tenant works",
    notFound(bookingCross) &&
      notFound(bookingUnknown) &&
      notFound(bookingNull) &&
      notFound(apptCross) &&
      bookingOwn.ok &&
      bookingOwn.value.appointment?.id === APPT.a1 &&
      stateFingerprint() === before,
    describe(bookingCross, bookingUnknown, bookingNull, apptCross, bookingOwn),
  );
}
{
  resetDb();
  const startsAt = nextSlot();
  const cross = await call(bf.rescheduleAppointment, { appointmentId: APPT.b1, startsAt }, advA);
  const tenantless = await call(
    bf.rescheduleAppointment,
    { appointmentId: APPT.nul, startsAt },
    advA,
  );
  const unknown = await call(bf.rescheduleAppointment, { appointmentId: RANDOM, startsAt }, advA);
  const unalloc = await call(bf.rescheduleAppointment, { appointmentId: APPT.a1, startsAt }, advA2);
  const readOnly = await call(
    bf.rescheduleAppointment,
    { appointmentId: APPT.a1, startsAt },
    platRO,
  );
  ok(
    "E3c rescheduleAppointment: platform read-only entry cannot reschedule",
    denied(readOnly) && row("appointments", APPT.a1).starts_at !== startsAt,
    describe(readOnly),
  );
  const own = await call(bf.rescheduleAppointment, { appointmentId: APPT.a1, startsAt }, advA);
  ok(
    "E3 rescheduleAppointment: other-tenant, tenantless (even when the adviser matches) and unknown are Not found",
    notFound(cross) &&
      notFound(tenantless) &&
      notFound(unknown) &&
      row("appointments", APPT.nul).starts_at !== startsAt &&
      row("appointments", APPT.b1).starts_at !== startsAt,
    describe(cross, tenantless, unknown),
  );
  ok(
    "E3b rescheduleAppointment: another same-tenant adviser refused; the assigned adviser can reschedule",
    denied(unalloc) && own.ok && row("appointments", APPT.a1).starts_at === startsAt,
    describe(unalloc, own),
  );
}
{
  resetDb();
  const before = stateFingerprint();
  const cbCross = await call(bf.updateCallbackStatus, { callbackId: CB.b, status: "closed" }, advA);
  const cbNull = await call(
    bf.updateCallbackStatus,
    { callbackId: CB.nul, status: "closed" },
    ownerA,
  );
  const cbUnknown = await call(
    bf.updateCallbackStatus,
    { callbackId: RANDOM, status: "closed" },
    ownerA,
  );
  const vmNull = await call(
    bf.assignUnallocatedVoicemail,
    { callbackId: CB.nul, advisorId: U.advA },
    ownerA,
  );
  const resolveMismatch = await call(
    bf.resolveCallback,
    { callbackId: CB.b, sessionId: S.a2 },
    ownerA,
  );
  const crm = await call(bf.listSessionCrmContacts, { sessionId: S.b1 }, ownerA);
  const attempt = await call(bf.logCallbackAttempt, { sessionId: S.b1 }, ownerA);
  ok(
    "E4 callbacks: other-tenant, tenantless (inbound voicemail) and unknown callbacks Not found; no writes",
    [cbCross, cbNull, cbUnknown, vmNull, resolveMismatch, crm, attempt].every(notFound) &&
      stateFingerprint() === before,
    describe(cbCross, cbNull, cbUnknown, vmNull, resolveMismatch, crm, attempt),
  );
  const cbOwn = await call(
    bf.updateCallbackStatus,
    { callbackId: CB.a, status: "contacted" },
    ownerA,
  );
  ok(
    "E4b same-tenant callback status update still works",
    cbOwn.ok && row("callback_requests", CB.a).status === "contacted",
    describe(cbOwn),
  );
  const viewAs = await call(bf.listAdvisorAppointments, { viewAsAdvisorId: U.advB }, ownerA);
  const viewOwn = await call(bf.listAdvisorAppointments, {}, advA);
  ok(
    "E5 listAdvisorAppointments: view-as another tenant's adviser Not found; own list tenant-scoped",
    notFound(viewAs) &&
      viewOwn.ok &&
      !JSON.stringify(viewOwn.value).includes(APPT.nul) &&
      !JSON.stringify(viewOwn.value).includes(APPT.b1),
    describe(viewAs, viewOwn),
  );
}

// --- allocation writers (adviser tenant binding, allocation tenant) --------------------------
{
  resetDb();
  const before = stateFingerprint();
  const crossTarget = await call(
    sf.allocateSession,
    { sessionId: S.a2, advisorId: U.advB },
    ownerA,
  );
  const crossSession = await call(
    sf.allocateSession,
    { sessionId: S.b1, advisorId: U.advA },
    ownerA,
  );
  const nullSession = await call(
    sf.allocateSession,
    { sessionId: S.nul, advisorId: U.advA },
    ownerA,
  );
  const customerTarget = await call(
    sf.allocateSession,
    { sessionId: S.a2, advisorId: U.custA },
    ownerA,
  );
  const bulkMixed = await call(
    sf.bulkAllocateSessions,
    { sessionIds: [S.a2, S.b1], advisorId: U.advA },
    ownerA,
  );
  const codeCross = await call(
    sf.bulkAllocateSessions,
    { sessionIds: [S.a2], advisorCode: "ADV-B1" },
    ownerA,
  );
  const codeUnknown = await call(
    sf.bulkAllocateSessions,
    { sessionIds: [S.a2], advisorCode: "ADV-ZZ" },
    ownerA,
  );
  const transferCross = await call(
    sf.transferSession,
    { sessionId: S.a1, fromAdvisorId: U.advA, toAdvisorId: U.advB },
    ownerA,
  );
  const bulkTransferCross = await call(
    sf.bulkTransferSessions,
    { sessionIds: [S.a1], fromAdvisorId: U.advA, toAdvisorCode: "ADV-B1" },
    ownerA,
  );
  const unallocCross = await call(
    sf.unallocateSession,
    { sessionId: S.b1, advisorId: U.advB },
    ownerA,
  );
  const advSelf = await call(sf.allocateSession, { sessionId: S.a2, advisorId: U.advA }, advA);
  const roAlloc = await call(sf.allocateSession, { sessionId: S.a2, advisorId: U.advA }, platRO);
  ok(
    "A1 allocation writers refuse other-tenant advisers, sessions and tenantless sessions (no writes)",
    [crossTarget, crossSession, nullSession, customerTarget, transferCross, unallocCross].every(
      notFound,
    ) &&
      notFound(bulkMixed) &&
      denied(codeCross) &&
      denied(codeUnknown) &&
      codeCross.message.replace("ADV-B1", "X") === codeUnknown.message.replace("ADV-ZZ", "X") &&
      denied(bulkTransferCross) &&
      denied(advSelf) &&
      denied(roAlloc) &&
      stateFingerprint() === before,
    describe(
      crossTarget,
      crossSession,
      nullSession,
      customerTarget,
      bulkMixed,
      codeCross,
      codeUnknown,
      transferCross,
      bulkTransferCross,
      unallocCross,
      advSelf,
      roAlloc,
    ),
  );
  const okAlloc = await call(sf.allocateSession, { sessionId: S.a2, advisorId: U.advA2 }, ownerA);
  const okCode = await call(
    sf.bulkAllocateSessions,
    { sessionIds: [S.a2], advisorCode: "ADV-A1" },
    supA,
  );
  const okTransfer = await call(
    sf.transferSession,
    { sessionId: S.a1, fromAdvisorId: U.advA, toAdvisorId: U.advA2 },
    ownerA,
  );
  const allocRows = db.session_advisors.filter((s) => [S.a1, S.a2].includes(s.session_id));
  ok(
    "A2 same-tenant allocation, code allocation and transfer still work and write the session tenant",
    okAlloc.ok &&
      okCode.ok &&
      okTransfer.ok &&
      allocRows.some((s) => s.session_id === S.a2 && s.advisor_id === U.advA2) &&
      allocRows.some((s) => s.session_id === S.a1 && s.advisor_id === U.advA2) &&
      allocRows
        .filter((s) =>
          writes.some(
            (w) =>
              w.table === "session_advisors" &&
              w.row.session_id === s.session_id &&
              w.row.advisor_id === s.advisor_id,
          ),
        )
        .every((s) => s.tenant_id === T.a),
    describe(okAlloc, okCode, okTransfer),
  );
}

// =============================================================================================
// T19 identity fingerprints unchanged; T20 no global introducer-link mutation introduced
// =============================================================================================
{
  resetDb();
  const identityBefore = identityFingerprint();
  const stateBefore = stateFingerprint();
  // A battery of refused S4C3 calls must leave all state untouched.
  const actors = [advA, advA2, advB, ownerA, ownerB, supA, generalA, platRO, custA];
  for (const actor of actors) {
    for (const [sid, cid] of [
      [S.b1, U.custB],
      [S.nul, U.custNull],
      [RANDOM, U.custA],
      [S.mB, U.custMulti],
    ]) {
      if (actor === ownerB && sid === S.b1) continue;
      if (actor === advB && sid === S.b1) continue;
      await call(bf.bookCaseFollowUpAppointment, followUp(sid, cid), actor);
      await call(sf.getSession, { sessionId: sid }, actor);
    }
    await call(
      bf.bookCustomerAppointmentAsStaff,
      staffBooking(U.custB, { advisorId: U.advA }),
      actor === ownerB || actor === advB ? ownerA : actor,
    );
  }
  ok(
    "T19a refused-call battery leaves identity and booking state unchanged",
    stateFingerprint() === stateBefore,
  );
  // Successful bookings must not change business identity either.
  await call(bf.bookCaseFollowUpAppointment, followUp(S.a1, U.custA), advA);
  await call(
    bf.bookCustomerAppointmentAsStaff,
    staffBooking(U.custMulti, { advisorId: U.advA }),
    ownerA,
  );
  await call(sf.allocateSession, { sessionId: S.a2, advisorId: U.advA2 }, ownerA);
  ok(
    "T19 identity fingerprints unchanged (tenants, Auth ids, memberships, adviser codes, profiles, seeded introducers/links, commission)",
    identityFingerprint() === identityBefore,
    `${identityBefore.slice(0, 12)} → ${identityFingerprint().slice(0, 12)}`,
  );
}
{
  resetDb();
  const linksBefore = JSON.stringify(db.customer_introducer_links);
  const before = stateFingerprint();
  const m = mark();
  // Multi-tenant customer with no existing link: a staff booking would create the global
  // first-wins link from tenant A, so it fails closed before any write (S4C4 dependency).
  const unlinkedStaff = await call(
    bf.bookCustomerAppointmentAsStaff,
    staffBooking(U.custX, { advisorId: U.advA }),
    ownerA,
  );
  const unlinkedFollow = await call(bf.bookCaseFollowUpAppointment, followUp(S.xA, U.custX), advA);
  ok(
    "T20 no global introducer link is created for a customer tied to another tenant (fails closed, no writes)",
    !unlinkedStaff.ok &&
      unlinkedStaff.message === ATTRIBUTION_LOCKED &&
      !unlinkedFollow.ok &&
      unlinkedFollow.message === ATTRIBUTION_LOCKED &&
      writesSince(m).length === 0 &&
      stateFingerprint() === before,
    describe(unlinkedStaff, unlinkedFollow),
  );
  await call(bf.bookCaseFollowUpAppointment, followUp(S.a1, U.custA), advA);
  await call(
    bf.bookCustomerAppointmentAsStaff,
    staffBooking(U.custMulti, { advisorId: U.advA }),
    ownerA,
  );
  const linkWrites = writes.filter(
    (w) => w.table === "customer_introducer_links" && w.method !== "INSERT",
  );
  ok(
    "T20b successful bookings never modify an existing introducer link",
    JSON.stringify(db.customer_introducer_links) === linksBefore && linkWrites.length === 0,
  );
  resetDb();
  const singleTenant = await call(
    bf.bookCustomerAppointmentAsStaff,
    staffBooking(U.custA3, { advisorId: U.advA }),
    ownerA,
  );
  const created = db.customer_introducer_links.filter((l) => l.customer_id === U.custA3);
  ok(
    "T20c single-tenant customer: first-wins attribution behaviour unchanged (one link to a tenant-A introducer)",
    singleTenant.ok &&
      created.length === 1 &&
      db.introducers.find((i) => i.id === created[0].introducer_id)?.tenant_id === T.a,
    describe(singleTenant),
  );
}

// =============================================================================================
// Static checks
// =============================================================================================
{
  const booking = code("src/lib/booking.functions.ts");
  const sessions = code("src/lib/sessions.functions.ts");
  function exportBlock(src, name) {
    const start = src.indexOf(`export const ${name} = createServerFn`);
    if (start < 0) return "";
    const rest = src.slice(start + 1);
    const next = rest.search(/\n(?=[A-Za-z])/);
    return src.slice(start, next < 0 ? undefined : start + 1 + next);
  }
  function fnBlock(src, name) {
    const start = src.indexOf(`async function ${name}(`);
    if (start < 0) return "";
    const rest = src.slice(start + 1);
    const next = rest.search(/\n(?=[A-Za-z])/);
    return src.slice(start, next < 0 ? undefined : start + 1 + next);
  }
  const follow = exportBlock(booking, "bookCaseFollowUpAppointment");
  ok(
    "S1 bookCaseFollowUpAppointment: canonical session + customer authorisation, no relationship-view bypass",
    /authoriseTenantResource\(\{/.test(follow) &&
      /authoriseTenantCustomer\(\{/.test(follow) &&
      /\{ tenantId \}/.test(follow) &&
      !/resolveAdminAccess|actingTenantStaffFlags|getRolesForUser/.test(follow),
  );
  const staffBlock = exportBlock(booking, "bookCustomerAppointmentAsStaff");
  ok(
    "S2 bookCustomerAppointmentAsStaff: tenant-scoped session selection and trusted tenant",
    /authoriseTenantCustomer\(\{/.test(staffBlock) &&
      /\.eq\("tenant_id", tenantId\)/.test(staffBlock) &&
      /\{ tenantId \}/.test(staffBlock),
  );
  const trusted = fnBlock(booking, "bookAppointmentTrusted");
  ok(
    "S3 bookAppointmentTrusted: tenant never derived from the chosen adviser; session tenant verified; no unscoped session lookup",
    !/advisorId:\s*data\.advisorId/.test(trusted) &&
      /row\.tenant_id !== tenantId/.test(trusted) &&
      /createCaseSessionForCustomer\(targetCustomerId, tenantId\)/.test(trusted) &&
      !/\.from\("interview_sessions"\)[\s\S]{0,200}\.eq\("customer_id"/.test(trusted),
  );
  ok(
    "S4 bookAppointmentTrusted keeps the single first-wins link call and the attribution pre-check",
    (trusted.match(/ensureCustomerIntroducerLink\(/g) ?? []).length === 1 &&
      /assertBookingMayAttributeCustomer\(customerIdForIntro, tenantId\)/.test(trusted) &&
      /ignoreDuplicates: true/.test(code("src/lib/introducer-attribution.ts")),
  );
  ok(
    "S5 bookAppointmentTrusted call sites unchanged (6)",
    (booking.match(/bookAppointmentTrusted\(/g) ?? []).length === 7,
    `${(booking.match(/bookAppointmentTrusted\(/g) ?? []).length - 1} call sites`,
  );
  const createCase = sessions.split("export async function createCaseSessionForCustomer(")[1] ?? "";
  ok(
    "S6 createCaseSessionForCustomer requires the tenant and forces it on insert",
    /tenantId: string,?\s*\)/.test(createCase.slice(0, 200)) &&
      /withForcedTenantId\(/.test(createCase.slice(0, 900)),
  );
  const getSession = exportBlock(sessions, "getSession");
  ok(
    "S7 getSession uses the canonical resource helper; no separate tenantless/mismatch message",
    /authoriseTenantResource\(\{/.test(getSession) &&
      !/Session not found|loadTenantRoleForTenantId/.test(getSession),
  );
  const allocBlocks = [
    "allocateSession",
    "bulkAllocateSessions",
    "unallocateSession",
    "transferSession",
    "bulkTransferSessions",
  ].map((n) => exportBlock(sessions, n));
  ok(
    "S8 allocation writers use the canonical helpers and never legacy global roles",
    allocBlocks.every(
      (b) => /authoriseTenantResources?\(\{/.test(b) && !/getRolesForUser\(/.test(b),
    ),
  );
  const status = execFileSync(
    "git",
    [
      "status",
      "--porcelain",
      "--",
      "supabase/migrations",
      "src/lib/test-accounts.ts",
      "src/lib/test-accounts.functions.ts",
    ],
    { cwd: root, encoding: "utf8" },
  );
  ok("S9 no migration created; Test Account sources unchanged", status.trim() === "");
}

const refused = unknownCalls.filter((c) => !c.startsWith("refused host"));
ok("N1 no unstubbed backend calls", refused.length === 0, refused.slice(0, 5).join(", "));
ok(
  "N2 no SMS sent and no outbound call placed",
  !writes.some((w) => w.table === "sms_messages" || w.table === "phone_calls"),
);

if (process.env.G7F4S4C3_DEBUG) process.stderr.write(`${logs.join("\n")}\n`);
console.log(`\n${total - failures.length}/${total} PASS`);
if (failures.length) {
  process.stderr.write(`FAILED: ${failures.join(", ")}\n`);
  process.exit(1);
}
