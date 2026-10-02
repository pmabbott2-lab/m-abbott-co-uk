/**
 * G7F-4S4C3-R1 listAdvisorCustomers cross-tenant read remediation — offline verification.
 * The real listAdvisorCustomers validator and handler run against an in-memory PostgREST fake on
 * a non-routable host (same harness and synthetic fixtures as the S4C3 verifier). No database,
 * no network, no staging, no production, no real identity, no phone numbers, no SMS, no calls.
 * Run: npm exec --yes --package=tsx -- tsx scripts/g7f4s4c3-r1-advisor-customers-verify.mjs
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
const FAKE_HOST = "g7f4s4c3r1.invalid";
process.env.SUPABASE_URL = `http://${FAKE_HOST}`;
process.env.VITE_SUPABASE_URL = `http://${FAKE_HOST}`;
process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_secret_g7f4s4c3r1_not_a_real_key";
process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_g7f4s4c3r1_not_a_real_key";
process.env.VITE_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_g7f4s4c3r1_not_a_real_key";

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
    throw new Error(`G7F4S4C3-R1 fetch stub refused host ${url.hostname}`);
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

// --- R1 fixture additions: rows that must never widen a tenant's adviser-customer list --------
const APPT_LEGACY = id("8", 9);
const RETURN_KEYS = [
  "caseRef",
  "caseStatus",
  "channel",
  "customer",
  "sessionId",
  "source",
  "startedAt",
  "status",
].join(",");
function seedR1() {
  // Allocation row pointing advA at a Tenant B session (allocation alone proves nothing).
  db.session_advisors.push({
    id: randomUUID(),
    session_id: S.b1,
    advisor_id: U.advA,
    tenant_id: T.b,
  });
  // Tenant A appointment linked to the tenantless session (appointment tenant proves nothing).
  db.appointments.push({
    id: APPT_LEGACY,
    tenant_id: T.a,
    session_id: S.nul,
    advisor_id: U.advA,
    introducer_id: null,
    lead_id: null,
    status: "confirmed",
    customer_name: "Legacy Caller",
    customer_phone: PHONE_PLACEHOLDER,
    customer_email: null,
    starts_at: nextSlot(),
    ends_at: null,
    created_at: daysAgo(2),
    lead_source: "web",
    referral_channel: null,
  });
  // Tenant A adviser also allocated on the multi-tenant customer's Tenant B session.
  db.session_advisors.push({
    id: randomUUID(),
    session_id: S.mB,
    advisor_id: U.advA,
    tenant_id: T.b,
  });
}
resetDb();
seedR1();

const list = (actor, advisorId) => call(sf.listAdvisorCustomers, { advisorId }, actor);
const sessionIds = (r) => (r.ok ? r.value.map((x) => x.sessionId).sort() : []);
const customerIds = (r) => (r.ok ? r.value.map((x) => x.customer?.id ?? null).sort() : []);
const bodyOf = (r) => (r.ok ? JSON.stringify(r.value) : r.message);
const TENANT_B_MARKERS = [
  T.b,
  S.b1,
  S.mB,
  U.custB,
  "Bravo Customer",
  "customer@bravo.example.test",
];
const TENANTLESS_MARKERS = [S.nul, U.custNull, "Nullco", APPT_LEGACY];
const hasAny = (r, markers) => markers.some((m) => bodyOf(r).includes(m));
const startWrites = mark();

// R1-01 legitimate same-tenant listing (Owner, Supervisor, General admin).
{
  const owner = await list(ownerA, U.advA);
  const expected = [S.a1, S.a3, S.mA, S.xA].sort();
  ok(
    "R1-01a Tenant A Owner listing Tenant A adviser returns exactly the Tenant A rows",
    owner.ok && JSON.stringify(sessionIds(owner)) === JSON.stringify(expected),
    describe(owner) + ` ${sessionIds(owner).length} rows`,
  );
  ok(
    "R1-01b customers resolved for the Tenant A rows only",
    JSON.stringify(customerIds(owner)) ===
      JSON.stringify([U.custA, U.custA3, U.custMulti, U.custX].sort()),
  );
  ok(
    "R1-01c response contract unchanged (same keys; customer = id, full_name, email, phone)",
    owner.ok &&
      owner.value.every(
        (r) =>
          Object.keys(r).sort().join(",") === RETURN_KEYS &&
          Object.keys(r.customer ?? {})
            .sort()
            .join(",") === "email,full_name,id,phone",
      ),
  );
  const sup = await list(supA, U.advA);
  const gen = await list(generalA, U.advA);
  ok(
    "R1-01d Supervisor and General admin get the same Tenant A rows",
    [sup, gen].every((r) => r.ok && JSON.stringify(sessionIds(r)) === JSON.stringify(expected)),
    describe(sup, gen),
  );
  const plat = await list(platRO, U.advA);
  ok(
    "R1-01f platform read-only entry still refused (no widening of the pre-R1 admin-only rule)",
    !plat.ok && plat.message === "Forbidden",
    describe(plat),
  );
  const ownerSecond = await list(ownerA, U.advA2);
  ok(
    "R1-01e Tenant A adviser with no customers returns an empty list",
    ownerSecond.ok && ownerSecond.value.length === 0,
    describe(ownerSecond),
  );
}

// R1-02 Tenant A actor supplying a Tenant B adviser id.
{
  const r = await list(ownerA, U.advB);
  ok("R1-02a Tenant A Owner + Tenant B adviser id → Not found.", notFound(r), describe(r));
  ok("R1-02b no Tenant B customer/session data in the response", !hasAny(r, TENANT_B_MARKERS));
  const viaSlug = await list(as(U.ownerA, "tenant-b"), U.advB);
  ok(
    "R1-02c a Tenant B route slug does not make Tenant A Owner a Tenant B actor",
    !viaSlug.ok && !hasAny(viaSlug, TENANT_B_MARKERS),
    describe(viaSlug),
  );
}

// R1-03 tenantless and other-tenant rows never appear, whatever links them to the adviser.
{
  const r = await list(ownerA, U.advA);
  ok(
    "R1-03a tenantless session and its customer excluded (allocation + Tenant A appointment link)",
    r.ok && !hasAny(r, TENANTLESS_MARKERS),
  );
  ok(
    "R1-03b Tenant B sessions excluded even when the Tenant A adviser is allocated to them",
    r.ok && !hasAny(r, TENANT_B_MARKERS),
  );
}

// R1-04 Tenant B actor listing a Tenant A adviser; advisers stay non-admin.
{
  const ownerBr = await list(ownerB, U.advA);
  ok(
    "R1-04a Tenant B Owner + Tenant A adviser id → Not found.",
    notFound(ownerBr),
    describe(ownerBr),
  );
  ok(
    "R1-04b no Tenant A data returned to Tenant B",
    ![S.a1, S.a3, S.mA, S.xA, U.custA, "Alpha Customer"].some((m) => bodyOf(ownerBr).includes(m)),
  );
  const advBr = await list(advB, U.advA);
  const advAr = await list(advA, U.advA);
  ok(
    "R1-04c advisers (not admins) still refused: Forbidden",
    !advBr.ok && advBr.message === "Forbidden" && !advAr.ok && advAr.message === "Forbidden",
    describe(advBr, advAr),
  );
  const noTenant = await list(as(U.custNull, null), U.advA);
  ok("R1-04d caller with no tenant membership refused", !noTenant.ok, describe(noTenant));
}

// R1-05 enumeration-safe target semantics.
{
  const unknown = await list(ownerA, RANDOM);
  const cross = await list(ownerA, U.advB);
  const crossOwner = await list(ownerA, U.ownerB);
  const sameTenantNonAdviser = await list(ownerA, U.custA);
  ok(
    "R1-05a unknown adviser, other-tenant adviser, other-tenant owner and same-tenant non-adviser are identical",
    [unknown, cross, crossOwner, sameTenantNonAdviser].every(notFound),
    describe(unknown, cross, crossOwner, sameTenantNonAdviser),
  );
  ok(
    "R1-05b refusal never names a tenant, adviser or customer",
    [unknown, cross, crossOwner, sameTenantNonAdviser].every(leakFree),
  );
}

// R1-06 multi-tenant customer: independent relationships per tenant.
{
  const a = await list(ownerA, U.advA);
  ok(
    "R1-06a multi-tenant customer listed in Tenant A through the Tenant A session only",
    sessionIds(a).includes(S.mA) && !sessionIds(a).includes(S.mB),
  );
  const b = await list(ownerB, U.advB);
  ok(
    "R1-06b Tenant B lists its own relationship with the same customer and nothing from Tenant A",
    b.ok &&
      sessionIds(b).includes(S.mB) &&
      sessionIds(b).includes(S.b1) &&
      !sessionIds(b).some((sid) => [S.mA, S.a1, S.a3, S.xA, S.nul].includes(sid)),
    describe(b) + ` ${sessionIds(b).length} rows`,
  );
}

// R1-07 read-only.
ok("R1-07 no write occurred across every R1 call", writesSince(startWrites).length === 0);

// R1-08 static: canonical helpers, tenant filter, S4C3 verifier untouched, no migration.
{
  const sessions = code("src/lib/sessions.functions.ts");
  const start = sessions.indexOf("export const listAdvisorCustomers = createServerFn(");
  const end = sessions.indexOf("\nexport const ", start + 10);
  const block = sessions.slice(start, end);
  ok(
    "R1-08a listAdvisorCustomers: acting tenant + capability, target adviser in that tenant, no legacy roles",
    /resolveActingTenantForList\(context\.userId,/.test(block) &&
      /requireTargetMemberInTenant\(data\.advisorId, tenantId, \["adviser"\]\)/.test(block) &&
      !/getRolesForUser\(/.test(block) &&
      block.indexOf("requireTargetMemberInTenant(") < block.indexOf('.from("session_advisors")'),
  );
  ok(
    "R1-08b both session reads are filtered to the acting tenant",
    (
      block.match(/\.from\("interview_sessions"\)[\s\S]{0,200}?\.eq\("tenant_id", tenantId\)/g) ??
      []
    ).length === 2,
  );
  const status = execFileSync(
    "git",
    [
      "status",
      "--porcelain",
      "--",
      "scripts/g7f4s4c3-booking-tenant-boundary-verify.mjs",
      "supabase/migrations",
      "src/lib/tenant-assert.server.ts",
    ],
    { cwd: root, encoding: "utf8" },
  );
  ok(
    "R1-08c S4C3 verifier, canonical tenant helpers and migrations unchanged",
    status.trim() === "",
  );
}

const refused = unknownCalls.filter((c) => !c.startsWith("refused host"));
ok("N1 no unstubbed backend calls", refused.length === 0, refused.slice(0, 5).join(", "));

if (process.env.G7F4S4C3_DEBUG) process.stderr.write(`${logs.join("\n")}\n`);
console.log(`\n${total - failures.length}/${total} PASS`);
if (failures.length) {
  process.stderr.write(`FAILED: ${failures.join(", ")}\n`);
  process.exit(1);
}
