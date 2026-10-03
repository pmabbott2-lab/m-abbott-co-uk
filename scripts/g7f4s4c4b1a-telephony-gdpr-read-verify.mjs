/**
 * G7F-4S4C4-B1a telephony + GDPR/contact-history tenant read boundary — offline verification.
 * Real server-function validators and handlers run against an in-memory PostgREST fake on a
 * non-routable host. Synthetic fixtures only: no database, no network, no production, no real
 * customer, staff or privileged identity, no phone numbers, no SMS, no calls.
 * Run: npm exec --yes --package=tsx -- tsx scripts/g7f4s4c4b1a-telephony-gdpr-read-verify.mjs
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
const code = (rel) => strip(readFileSync(resolve(root, rel), "utf8"));
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" });

// --- module stubs: createServerFn capture, request Referer, platform entry, voice config -------
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
export function getRequest() { return globalThis.__B1A_REQUEST ?? null; }
export function getCookie() { return undefined; }
export function setCookie() {}
export function deleteCookie() {}
`;
const stubPlatform = `
export async function validatePlatformTenantAccessSession(input) {
  return globalThis.__B1A_PLATFORM?.get(input.userId + ":" + input.tenantId) ?? null;
}
export async function hasValidPlatformTenantAccess() { return false; }
export async function clearPlatformTenantEntryOnLogout() {}
`;
// prepareBrowserCall only: voice is "configured" with a placeholder sender and phone input is
// passed through unchanged, so no phone number appears in this verifier.
const stubVoice = `
export function isTwilioVoiceConfigured() { return true; }
export function getVoiceConfig() { return { fromNumber: "SYNTHETIC-SENDER" }; }
`;
const stubTelephonySms = `
export function normaliseUkPhone(value) { return String(value); }
`;
const dataUrl = (src) => `data:text/javascript,${encodeURIComponent(src)}`;
const hookSource = `
const fromData = (ctx) => String(ctx.parentURL ?? "").startsWith("data:");
const fromTelephony = (ctx) => /telephony\\.functions\\.ts$/.test(String(ctx.parentURL ?? ""));
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
  if (fromTelephony(context) && /\\/voice\\.server(\\.ts)?$/.test(specifier)) {
    return { url: ${JSON.stringify(dataUrl(stubVoice))}, shortCircuit: true };
  }
  if (fromTelephony(context) && /\\/sms\\.server(\\.ts)?$/.test(specifier)) {
    return { url: ${JSON.stringify(dataUrl(stubTelephonySms))}, shortCircuit: true };
  }
  return next(specifier, context);
}
`;
register(dataUrl(hookSource), import.meta.url);

// --- synthetic fixtures ------------------------------------------------------------------------
const FAKE_HOST = "g7f4s4c4b1a.invalid";
process.env.SUPABASE_URL = `http://${FAKE_HOST}`;
process.env.VITE_SUPABASE_URL = `http://${FAKE_HOST}`;
process.env.SUPABASE_SERVICE_ROLE_KEY = "synthetic-service-key-g7f4s4c4b1a-not-real";
process.env.SUPABASE_PUBLISHABLE_KEY = "synthetic-public-key-g7f4s4c4b1a-not-real";
process.env.VITE_SUPABASE_PUBLISHABLE_KEY = "synthetic-public-key-g7f4s4c4b1a-not-real";

const id = (prefix, n) =>
  `${prefix}${String(n).repeat(7).slice(0, 7)}-0000-4000-8000-${String(n).padStart(12, "0")}`;
const T = { a: id("1", 1), b: id("1", 2) };
const U = {
  ownerA: id("2", 1),
  advA: id("2", 2),
  advA2: id("2", 3),
  ownerB: id("2", 4),
  advB: id("2", 5),
  platRO: id("3", 1),
  custA: id("4", 1),
  custB: id("4", 2),
  custM: id("4", 3),
  custNull: id("4", 4),
};
const S = {
  a1: id("5", 1),
  b1: id("5", 2),
  mA: id("5", 3),
  mB: id("5", 4),
  nul: id("5", 5),
  aDel: id("5", 6),
};
const C = {
  a1: id("6", 1),
  aLegacy: id("6", 2),
  aOwn: id("6", 3),
  b1: id("6", 4),
  nul: id("6", 5),
  orphan: id("6", 6),
  conflict: id("6", 7),
  vmA: id("6", 8),
  vmB: id("6", 9),
  vmConflict: id("a", 1),
  vmForeign: id("a", 2),
  vmOrphan: id("a", 3),
  vmSessA: id("a", 4),
  vmNullSessB: id("a", 5),
  vmNullTenantless: id("a", 6),
  vmOwnA: id("a", 7),
  vmConflictA: id("a", 8),
};
const L = { a1: id("7", 1), aDel: id("7", 2), mA: id("7", 3), mB: id("7", 4), conf: id("7", 5) };
const APPT = { mA: id("8", 1), mB: id("8", 2), conf: id("8", 3) };
const CB = {
  mA: id("9", 1),
  conf: id("9", 2),
  vmForeign: id("9", 3),
  vmOrphan: id("9", 4),
  vmSessA: id("9", 5),
  vmNullSessB: id("9", 6),
  vmNullTenantless: id("9", 7),
  vmOwnA: id("9", 8),
  vmConflictA: id("9", 9),
};
const SMS = {
  apptA: id("b", 1),
  phoneA: id("b", 2),
  phoneB: id("b", 3),
  phoneNull: id("b", 4),
  apptConf: id("b", 5),
};
const RANDOM = "9f9f9f9f-9f9f-4f9f-8f9f-9f9f9f9f9f9f";
const SHARED_CONTACT = "SYNTHETIC-CONTACT-M";
const SECRET = "OTHER-TENANT-SECRET";

const now = Date.now();
const daysAgo = (d) => new Date(now - d * 86400000).toISOString();

let db;
function resetDb() {
  const profile = (pid, full_name, email, phone = null) => ({ id: pid, full_name, email, phone });
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
    started_at: daysAgo(10),
    submitted_at: null,
    updated_at: daysAgo(3),
    created_at: daysAgo(10),
    ...extra,
  });
  const call = (cid, tenant_id, session_id, extra = {}) => ({
    id: cid,
    tenant_id,
    session_id,
    customer_id: null,
    advisor_id: null,
    twilio_call_sid: null,
    twilio_recording_sid: null,
    recording_url: null,
    direction: "outbound",
    call_kind: "outbound",
    to_number: "SYNTHETIC-TO",
    from_number: "SYNTHETIC-FROM",
    status: "completed",
    started_at: daysAgo(2),
    ended_at: daysAgo(2),
    duration_seconds: 120,
    transcript: "Synthetic transcript",
    summary: "Synthetic summary",
    ai_status: "complete",
    error_message: null,
    created_at: daysAgo(2),
    ...extra,
  });
  const vm = (cid, tenant_id, session_id, extra = {}) =>
    call(cid, tenant_id, session_id, {
      direction: "inbound",
      call_kind: "inbound_voicemail",
      ...extra,
    });
  const secret = (extra = {}) => ({
    transcript: `${SECRET} transcript`,
    summary: `${SECRET} summary`,
    from_number: `${SECRET}-FROM`,
    to_number: `${SECRET}-TO`,
    ...extra,
  });
  const log = (lid, session_id, tenant_id, body, extra = {}) => ({
    id: lid,
    session_id,
    tenant_id,
    author_id: null,
    entry_type: "note",
    body,
    occurred_at: daysAgo(4),
    created_at: daysAgo(4),
    amended_at: null,
    is_deleted: false,
    ...extra,
  });
  const appt = (aid, tenant_id, session_id) => ({
    id: aid,
    tenant_id,
    session_id,
    advisor_id: U.advA,
    customer_name: "Synthetic",
    customer_phone: "SYNTHETIC",
    starts_at: daysAgo(-5),
    ends_at: daysAgo(-5),
    status: "confirmed",
    created_at: daysAgo(6),
  });
  const callback = (cbid, tenant_id, session_id, extra = {}) => ({
    id: cbid,
    tenant_id,
    session_id,
    customer_id: null,
    advisor_id: null,
    customer_name: "Synthetic Caller",
    customer_phone: null,
    customer_email: null,
    preferred_window: "9-12",
    status: "new",
    notes: null,
    phone_call_id: null,
    created_at: daysAgo(1),
    ...extra,
  });
  const sms = (sid, tenant_id, extra = {}) => ({
    id: sid,
    tenant_id,
    direction: "outbound",
    from_number: "SYNTHETIC-SENDER",
    to_number: "SYNTHETIC-NOBODY",
    body: "Synthetic message",
    appointment_id: null,
    lead_id: null,
    created_at: daysAgo(3),
    ...extra,
  });
  db = {
    tenants: [
      {
        id: T.a,
        slug: "tenant-a",
        company_name: "Tenant A",
        status: "active",
        tenant_type: "firm",
      },
      {
        id: T.b,
        slug: "tenant-b",
        company_name: "Tenant B",
        status: "active",
        tenant_type: "firm",
      },
    ],
    tenant_memberships: [
      mem(U.ownerA, T.a, "owner"),
      mem(U.advA, T.a, "adviser"),
      mem(U.advA2, T.a, "adviser"),
      mem(U.ownerB, T.b, "owner"),
      mem(U.advB, T.b, "adviser"),
      mem(U.custA, T.a, "customer"),
      mem(U.custB, T.b, "customer"),
      mem(U.custM, T.a, "customer"),
      mem(U.custM, T.b, "customer"),
    ],
    admin_permissions: [],
    profiles: [
      profile(U.ownerA, "Alpha Owner", "owner@alpha.example.test"),
      profile(U.advA, "Alpha Adviser", "adviser@alpha.example.test"),
      profile(U.advA2, "Alpha Adviser Two", "adviser2@alpha.example.test"),
      profile(U.ownerB, "Bravo Owner", "owner@bravo.example.test"),
      profile(U.advB, "Bravo Adviser", "adviser@bravo.example.test"),
      profile(U.custA, "Alpha Customer", "customer@alpha.example.test"),
      profile(U.custB, "Bravo Customer", "customer@bravo.example.test"),
      profile(U.custM, "Multi Customer", "multi@shared.example.test", SHARED_CONTACT),
      profile(U.custNull, "Nullco Customer", "customer@nullco.example.test"),
    ],
    interview_sessions: [
      sess(S.a1, U.custA, T.a, "MG-A-0001"),
      sess(S.b1, U.custB, T.b, "MG-B-0001"),
      sess(S.mA, U.custM, T.a, "MG-M-000A"),
      sess(S.mB, U.custM, T.b, "MG-M-000B"),
      sess(S.nul, U.custNull, null, "MG-N-0001"),
      sess(S.aDel, U.custA, T.a, "MG-A-0002", { deleted_at: daysAgo(1) }),
    ],
    session_advisors: [
      { id: randomUUID(), session_id: S.a1, advisor_id: U.advA, tenant_id: T.a },
      { id: randomUUID(), session_id: S.mA, advisor_id: U.advA, tenant_id: T.a },
      { id: randomUUID(), session_id: S.b1, advisor_id: U.advB, tenant_id: T.b },
      { id: randomUUID(), session_id: S.mB, advisor_id: U.advB, tenant_id: T.b },
    ],
    phone_calls: [
      call(C.a1, T.a, S.a1, { advisor_id: U.advA, transcript: "Alpha call transcript" }),
      call(C.aLegacy, null, S.a1, { transcript: "Alpha legacy transcript" }),
      call(C.aOwn, T.a, null, { transcript: "Alpha own-tenant transcript" }),
      call(C.b1, T.b, S.b1, secret({ advisor_id: U.advB })),
      call(C.nul, null, S.nul, secret()),
      vm(C.orphan, null, null, secret()),
      call(C.conflict, T.b, S.a1, secret()),
      vm(C.vmA, T.a, S.mA, { summary: "Alpha voicemail summary" }),
      vm(C.vmB, T.b, S.mB, secret()),
      vm(C.vmConflict, T.b, S.mA, secret()),
      vm(C.vmForeign, T.b, null, secret()),
      vm(C.vmOrphan, null, null, { summary: "Unowned voicemail" }),
      vm(C.vmSessA, null, S.a1, { summary: "Tenantless voicemail on a Tenant A session" }),
      vm(C.vmNullSessB, null, S.b1, secret()),
      vm(C.vmNullTenantless, null, S.nul, secret()),
      vm(C.vmOwnA, T.a, null, { summary: "Tenant A voicemail" }),
      vm(C.vmConflictA, T.a, S.b1, secret()),
    ],
    customer_contact_log: [
      log(L.a1, S.a1, null, "Alpha legacy note"),
      log(L.aDel, S.a1, T.a, "Alpha removed note", { is_deleted: true }),
      log(L.mA, S.mA, T.a, "Alpha multi note"),
      log(L.mB, S.mB, T.b, `${SECRET} note`),
      log(L.conf, S.mA, T.b, `${SECRET} conflicting note`),
    ],
    appointments: [appt(APPT.mA, T.a, S.mA), appt(APPT.mB, T.b, S.mB), appt(APPT.conf, T.b, S.mA)],
    callback_requests: [
      callback(CB.mA, T.a, S.mA),
      callback(CB.conf, T.b, S.mA),
      callback(CB.vmForeign, T.a, null, { phone_call_id: C.vmForeign }),
      callback(CB.vmOrphan, T.a, null, { phone_call_id: C.vmOrphan }),
      callback(CB.vmSessA, T.a, null, { phone_call_id: C.vmSessA }),
      callback(CB.vmNullSessB, T.a, null, { phone_call_id: C.vmNullSessB }),
      callback(CB.vmNullTenantless, T.a, null, { phone_call_id: C.vmNullTenantless }),
      callback(CB.vmOwnA, T.a, null, { phone_call_id: C.vmOwnA }),
      callback(CB.vmConflictA, T.a, null, { phone_call_id: C.vmConflictA }),
    ],
    sms_messages: [
      sms(SMS.apptA, null, { appointment_id: APPT.mA }),
      sms(SMS.phoneA, T.a, { to_number: SHARED_CONTACT }),
      sms(SMS.phoneB, T.b, { to_number: SHARED_CONTACT, body: `${SECRET} sms` }),
      sms(SMS.phoneNull, null, { to_number: SHARED_CONTACT, body: `${SECRET} sms` }),
      sms(SMS.apptConf, T.b, { appointment_id: APPT.mA, body: `${SECRET} sms` }),
    ],
    advisor_profiles: [
      { user_id: U.advA, tenant_id: T.a, code: "ADV-A1", deleted_at: null },
      { user_id: U.advA2, tenant_id: T.a, code: "ADV-A2", deleted_at: null },
      { user_id: U.advB, tenant_id: T.b, code: "ADV-B1", deleted_at: null },
    ],
    customer_introducer_links: [],
    introducers: [],
    staff_contact_tasks: [],
    session_contact_tracking: [],
    advisor_contact_views: [],
  };
  writes.length = 0;
  unknownCalls.length = 0;
}

globalThis.__B1A_PLATFORM = new Map([
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
  out = out.slice(offset, limit ? offset + Number(limit) : undefined);
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

globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === "string" ? input : (input.url ?? String(input)));
  if (url.hostname !== FAKE_HOST) {
    unknownCalls.push(`refused host ${url.hostname}`);
    throw new Error(`G7F4S4C4B1A fetch stub refused host ${url.hostname}`);
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
      const out = [];
      for (const raw of incoming) {
        const row = { ...raw };
        if (row.id === undefined) row.id = randomUUID();
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
        writes.push({ method: "UPDATE", table, row: { ...r }, body: { ...body } });
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
const tf = await import("../src/lib/telephony.functions.ts");
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
  globalThis.__B1A_REQUEST = actor?.slug
    ? new Request(`http://app.invalid/_serverFn/x`, {
        headers: { referer: `http://app.invalid/${actor.slug}/admin` },
      })
    : null;
  return outcome(() =>
    invoke(fn, data, {
      userId: actor?.userId ?? null,
      claims: actor ? { sub: actor.userId, email: "actor@example.test" } : null,
      supabase: null,
    }),
  );
}
const NOT_FOUND = ta.RESOURCE_NOT_FOUND_MESSAGE;
const notFound = (r) => !r.ok && r.message === NOT_FOUND;
const forbidden = (r) => !r.ok && r.message === "Forbidden";
const OTHER_TENANT_MARKERS = [SECRET, "tenant-b", "Bravo", T.b, U.custB, U.advB];
const leakFree = (r) => {
  const text = r.ok ? JSON.stringify(r.value) : r.message;
  return !OTHER_TENANT_MARKERS.some((s) => text.includes(s));
};
const describe = (...rs) => rs.map((r) => (r.ok ? "ok" : r.message)).join(" | ");
const entryIds = (r) => (r.ok ? r.value.map((e) => e.id) : []);
const exportEntryIds = (r) => (r.ok ? r.value.entries.map((e) => e.id) : []);
const hasAll = (ids, want) => want.every((w) => ids.includes(w));
const hasNone = (ids, bad) => bad.every((b) => !ids.includes(b));

const ownerA = as(U.ownerA, "tenant-a");
const advA = as(U.advA, "tenant-a");
const advA2 = as(U.advA2, "tenant-a");
const ownerB = as(U.ownerB, "tenant-b");
const advB = as(U.advB, "tenant-b");
const platRO = as(U.platRO, "tenant-a");
const custA = as(U.custA, "tenant-a");

const A_MULTI_EXPECTED = [
  L.mA,
  `appt-${APPT.mA}`,
  `cb-${CB.mA}`,
  `sms-${SMS.apptA}`,
  `sms-${SMS.phoneA}`,
  `call-${C.vmA}`,
];
const A_MULTI_FORBIDDEN = [
  L.mB,
  L.conf,
  `appt-${APPT.mB}`,
  `appt-${APPT.conf}`,
  `cb-${CB.conf}`,
  `sms-${SMS.phoneB}`,
  `sms-${SMS.phoneNull}`,
  `sms-${SMS.apptConf}`,
  `call-${C.vmB}`,
  `call-${C.vmConflict}`,
];

// --- 1 / 2 / 10: getPhoneCall ------------------------------------------------------------------
{
  resetDb();
  const own = await call(tf.getPhoneCall, { callId: C.a1 }, ownerA);
  const unallocated = await call(tf.getPhoneCall, { callId: C.a1 }, advA2);
  ok(
    "B1A-01 getPhoneCall: Tenant A staff read a Tenant A call (owner and any Tenant A adviser, as before)",
    own.ok &&
      own.value.transcript === "Alpha call transcript" &&
      own.value.advisorName === "Alpha Adviser" &&
      unallocated.ok &&
      leakFree(own),
    describe(own, unallocated),
  );
  const legacy = await call(tf.getPhoneCall, { callId: C.aLegacy }, advA);
  const ownTenant = await call(tf.getPhoneCall, { callId: C.aOwn }, advA);
  ok(
    "B1A-01b getPhoneCall: tenantless call on a Tenant A session and a Tenant A call with no session are Tenant A's",
    legacy.ok && ownTenant.ok,
    describe(legacy, ownTenant),
  );
  const cross = await call(tf.getPhoneCall, { callId: C.b1 }, ownerA);
  const crossAdv = await call(tf.getPhoneCall, { callId: C.b1 }, advA);
  const unknown = await call(tf.getPhoneCall, { callId: RANDOM }, ownerA);
  ok(
    "B1A-02 getPhoneCall: Tenant B call requested by Tenant A staff is Not found with no Tenant B data",
    notFound(cross) && notFound(crossAdv) && leakFree(cross) && leakFree(crossAdv),
    describe(cross, crossAdv),
  );
  ok(
    "B1A-10a getPhoneCall: foreign and unknown call ids are indistinguishable",
    notFound(unknown) && cross.message === unknown.message,
    describe(cross, unknown),
  );
  const nul = await call(tf.getPhoneCall, { callId: C.nul }, ownerA);
  const orphan = await call(tf.getPhoneCall, { callId: C.orphan }, ownerA);
  const conflict = await call(tf.getPhoneCall, { callId: C.conflict }, ownerA);
  const conflictB = await call(tf.getPhoneCall, { callId: C.conflict }, ownerB);
  ok(
    "B1A-02b getPhoneCall: tenantless-session, unowned (no tenant, no session) and tenant-conflicting calls fail closed for both tenants",
    [nul, orphan, conflict, conflictB].every(notFound),
    describe(nul, orphan, conflict, conflictB),
  );
  const bOwn = await call(tf.getPhoneCall, { callId: C.b1 }, ownerB);
  const bCross = await call(tf.getPhoneCall, { callId: C.a1 }, ownerB);
  ok(
    "B1A-02c getPhoneCall: symmetric — Tenant B reads its own call, Tenant A's call is Not found",
    bOwn.ok && notFound(bCross),
    describe(bOwn, bCross),
  );
  const customer = await call(tf.getPhoneCall, { callId: C.a1 }, custA);
  const readOnly = await call(tf.getPhoneCall, { callId: C.a1 }, platRO);
  ok(
    "B1A-11a getPhoneCall: role gate unchanged — customers and read-only platform entry refused before any load",
    forbidden(customer) && forbidden(readOnly),
    describe(customer, readOnly),
  );
  ok("B1A-11b getPhoneCall: reads perform no writes", writes.length === 0, `${writes.length}`);
}

// --- 3 / 4: listSessionVoicemails ------------------------------------------------------------
{
  resetDb();
  const own = await call(tf.listSessionVoicemails, { sessionId: S.mA }, advA);
  ok(
    "B1A-03 listSessionVoicemails: Tenant A voicemail on a Tenant A session is listed; the conflicting Tenant B row is not",
    own.ok &&
      own.value.map((v) => v.id).join(",") === C.vmA &&
      leakFree(own) &&
      !("tenantId" in (own.value[0] ?? {})),
    describe(own),
  );
  const crossB = await call(tf.listSessionVoicemails, { sessionId: S.mB }, ownerA);
  const crossB1 = await call(tf.listSessionVoicemails, { sessionId: S.b1 }, advA);
  const nul = await call(tf.listSessionVoicemails, { sessionId: S.nul }, ownerA);
  const unknown = await call(tf.listSessionVoicemails, { sessionId: RANDOM }, ownerA);
  ok(
    "B1A-04 listSessionVoicemails: Tenant B session ids (including the same human's Tenant B session) are Not found for Tenant A",
    notFound(crossB) && notFound(crossB1) && leakFree(crossB) && leakFree(crossB1),
    describe(crossB, crossB1),
  );
  ok(
    "B1A-04b listSessionVoicemails: tenantless legacy session stays excluded; unknown and foreign are indistinguishable",
    notFound(nul) && notFound(unknown) && crossB.message === unknown.message,
    describe(nul, unknown),
  );
  ok("B1A-04c listSessionVoicemails: reads perform no writes", writes.length === 0);
}

// --- 5 / 6 / 7 / 8: getGdprHistoryExport --------------------------------------------------
{
  resetDb();
  const exp = await call(tf.getGdprHistoryExport, { sessionId: S.mA }, advA);
  const ids = exportEntryIds(exp);
  ok(
    "B1A-05 getGdprHistoryExport: Tenant A export of the multi-tenant customer contains the Tenant A history",
    exp.ok && hasAll(ids, A_MULTI_EXPECTED) && exp.value.calls.map((c) => c.id).join(",") === C.vmA,
    describe(exp),
  );
  const custMHasB = db.interview_sessions.some(
    (s) => s.customer_id === U.custM && s.tenant_id === T.b,
  );
  ok(
    "B1A-06 getGdprHistoryExport: the same human's Tenant B relationship does not block the legitimate Tenant A export",
    custMHasB && exp.ok && exp.value.customerName === "Multi Customer",
    describe(exp),
  );
  ok(
    "B1A-07 getGdprHistoryExport: Tenant B and tenant-conflicting history are absent (notes, appointments, call-backs, SMS, calls)",
    exp.ok && hasNone(ids, A_MULTI_FORBIDDEN) && leakFree(exp),
    describe(exp),
  );
  ok(
    "B1A-08 getGdprHistoryExport: tenantless SMS matched only by the customer's contact value is not included",
    exp.ok && !ids.includes(`sms-${SMS.phoneNull}`) && ids.includes(`sms-${SMS.apptA}`),
    "tenantless appointment-linked SMS kept; tenantless contact-matched SMS dropped",
  );
  const crossB = await call(tf.getGdprHistoryExport, { sessionId: S.mB }, ownerA);
  const nul = await call(tf.getGdprHistoryExport, { sessionId: S.nul }, ownerA);
  const unknown = await call(tf.getGdprHistoryExport, { sessionId: RANDOM }, ownerA);
  ok(
    "B1A-07b getGdprHistoryExport: Tenant B session of the same human, tenantless session and unknown id all Not found",
    [crossB, nul, unknown].every(notFound) && leakFree(crossB),
    describe(crossB, nul, unknown),
  );
  const unallocated = await call(tf.getGdprHistoryExport, { sessionId: S.mA }, advA2);
  const owner = await call(tf.getGdprHistoryExport, { sessionId: S.mA }, ownerA);
  ok(
    "B1A-05b getGdprHistoryExport: adviser must be allocated to the session; main admins are not allocation-bound",
    forbidden(unallocated) && owner.ok && leakFree(unallocated),
    describe(unallocated, owner),
  );
  const bExp = await call(tf.getGdprHistoryExport, { sessionId: S.mB }, advB);
  const bIds = exportEntryIds(bExp);
  ok(
    "B1A-07c getGdprHistoryExport: symmetric — Tenant B export contains Tenant B rows and none of Tenant A's",
    bExp.ok &&
      bIds.includes(L.mB) &&
      bIds.includes(`sms-${SMS.phoneB}`) &&
      !bIds.includes(L.mA) &&
      !bIds.includes(`sms-${SMS.phoneA}`) &&
      bExp.value.calls.map((c) => c.id).join(",") === C.vmB,
    describe(bExp),
  );
  ok("B1A-08b getGdprHistoryExport: export performs no writes", writes.length === 0);
}

// --- 9 / 11: listContactHistory ---------------------------------------------------------------
{
  resetDb();
  const multi = await call(sf.listContactHistory, { sessionId: S.mA }, ownerA);
  const ids = entryIds(multi);
  ok(
    "B1A-09 listContactHistory: Tenant A history of the multi-tenant customer has only Tenant A rows",
    multi.ok && hasAll(ids, A_MULTI_EXPECTED) && hasNone(ids, A_MULTI_FORBIDDEN) && leakFree(multi),
    describe(multi),
  );
  const crossB = await call(sf.listContactHistory, { sessionId: S.mB }, ownerA);
  const nul = await call(sf.listContactHistory, { sessionId: S.nul }, advA);
  const unknown = await call(sf.listContactHistory, { sessionId: RANDOM }, ownerA);
  ok(
    "B1A-09b listContactHistory: Tenant B session, tenantless session and unknown id are Not found alike",
    [crossB, nul, unknown].every(notFound) &&
      crossB.message === unknown.message &&
      leakFree(crossB),
    describe(crossB, nul, unknown),
  );
  const ownerHist = await call(sf.listContactHistory, { sessionId: S.a1 }, ownerA);
  const advHist = await call(sf.listContactHistory, { sessionId: S.a1 }, advA2);
  const oIds = entryIds(ownerHist);
  const aIds = entryIds(advHist);
  ok(
    "B1A-11c listContactHistory: same-tenant history unchanged — legacy tenantless note and calls on the session included, conflicting call excluded",
    ownerHist.ok &&
      hasAll(oIds, [L.a1, `call-${C.a1}`, `call-${C.aLegacy}`]) &&
      !oIds.includes(`call-${C.conflict}`),
    describe(ownerHist),
  );
  ok(
    "B1A-11d listContactHistory: owner still sees removed notes, an unallocated adviser still reads history but not removed notes",
    oIds.includes(L.aDel) && advHist.ok && !aIds.includes(L.aDel) && aIds.includes(L.a1),
    describe(ownerHist, advHist),
  );
  const binned = await call(sf.listContactHistory, { sessionId: S.aDel }, ownerA);
  const customer = await call(sf.listContactHistory, { sessionId: S.a1 }, custA);
  ok(
    "B1A-11e listContactHistory: binned Tenant A session history still readable (as the session page); customers refused",
    binned.ok && forbidden(customer),
    describe(binned, customer),
  );
  ok("B1A-11f listContactHistory: reads perform no writes", writes.length === 0);
}

// --- 10: consistent non-disclosure across endpoints ----------------------------------------
{
  resetDb();
  const msgs = [];
  for (const [fn, data] of [
    [tf.getPhoneCall, { callId: C.vmB }],
    [tf.listSessionVoicemails, { sessionId: S.b1 }],
    [tf.getGdprHistoryExport, { sessionId: S.b1 }],
    [sf.listContactHistory, { sessionId: S.b1 }],
    [tf.getPhoneCall, { callId: RANDOM }],
    [tf.listSessionVoicemails, { sessionId: RANDOM }],
    [tf.getGdprHistoryExport, { sessionId: RANDOM }],
    [sf.listContactHistory, { sessionId: RANDOM }],
  ]) {
    msgs.push(await call(fn, data, ownerA));
  }
  ok(
    'B1A-10 every B1a endpoint answers a foreign id exactly as an unknown id ("Not found.")',
    msgs.every(notFound) && msgs.every(leakFree),
    describe(...msgs),
  );
}

// --- 12: no email / phone / global profile matching as tenant authority ----------------------
{
  const tel = code("src/lib/telephony.functions.ts");
  const ses = code("src/lib/sessions.functions.ts");
  const seg = (src, start) => {
    const i = src.indexOf(start);
    if (i < 0) return "";
    const j = src.indexOf("\nexport ", i + start.length);
    return src.slice(i, j < 0 ? undefined : j);
  };
  const getCall = seg(tel, "export const getPhoneCall");
  const listVm = seg(tel, "export const listSessionVoicemails");
  const gdpr = seg(tel, "export const getGdprHistoryExport");
  const listHist = seg(ses, "export const listContactHistory");
  const fetchHist = seg(ses, "export async function fetchContactHistoryEntries");
  ok(
    "B1A-12a each B1a read proves the tenant canonically before loading data",
    /resolveActingTenantForList\(context\.userId, TELEPHONY_READ\)/.test(getCall) &&
      /scopeRowsToTenant\(/.test(getCall) &&
      /authoriseTenantResource\(\{[\s\S]*?capability: TELEPHONY_READ/.test(listVm) &&
      /authoriseTenantResource\(\{[\s\S]*?capability: GDPR_EXPORT/.test(gdpr) &&
      /authoriseTenantResource\(\{/.test(listHist) &&
      !/getRolesForUser|staffRoles/.test(getCall + listVm + gdpr + listHist),
  );
  ok(
    "B1A-12b no B1a read uses claims email, caller phone lookup or global roles as authority",
    !/claims|findSessionForCallerPhone|resolveAdminAccess|user_roles/.test(
      getCall + listVm + gdpr + listHist,
    ) &&
      !/\.(?:eq|ilike|in)\("(?:email|phone|customer_phone|customer_email|to_number|from_number)"/.test(
        getCall + listVm + gdpr + listHist,
      ) &&
      !/resolveAdminAccess|claims|\.(?:eq|ilike|in)\("(?:email|customer_email)"/.test(fetchHist),
  );
  const phoneQueries = fetchHist.match(
    /\.from\("sms_messages"\)[\s\S]*?\.in\("(?:to|from)_number", variants\)/g,
  );
  ok(
    "B1A-12c contact-value SMS matching is restricted to rows stamped with the proven tenant",
    (phoneQueries ?? []).length === 2 &&
      phoneQueries.every((q) => q.includes('.eq("tenant_id", opts.tenantId)')) &&
      /session\.tenant_id !== opts\.tenantId/.test(fetchHist),
  );
}

// --- coupled writers: prepareBrowserCall (row 65), voicemail assignment patch (row 71) -------
{
  resetDb();
  const cross = await call(
    tf.prepareBrowserCall,
    { sessionId: S.b1, customerPhone: "SYNTHETIC-DIAL" },
    ownerA,
  );
  const nul = await call(
    tf.prepareBrowserCall,
    { sessionId: S.nul, customerPhone: "SYNTHETIC-DIAL" },
    ownerA,
  );
  ok(
    "B1A-14a prepareBrowserCall: another tenant's or a tenantless session is Not found and no call row is written",
    notFound(cross) && notFound(nul) && writes.length === 0,
    describe(cross, nul),
  );
  const own = await call(
    tf.prepareBrowserCall,
    { sessionId: S.a1, customerPhone: "SYNTHETIC-DIAL" },
    ownerA,
  );
  const inserted = writes.filter((w) => w.table === "phone_calls" && w.method === "INSERT");
  ok(
    "B1A-14b prepareBrowserCall: same-tenant call still prepared and the row is stamped with the acting tenant",
    own.ok && inserted.length === 1 && inserted[0].row.tenant_id === T.a,
    describe(own),
  );
  resetDb();
  const multi = await call(
    tf.prepareBrowserCall,
    { sessionId: S.mA, customerPhone: "SYNTHETIC-DIAL" },
    advA,
  );
  ok(
    "B1A-14c prepareBrowserCall: existing multi-tenant customer refusal is unchanged (no broadening in B1a)",
    !multi.ok && writes.length === 0,
    describe(multi),
  );

  // Every call-back below is a Tenant A call-back (own tenant_id) whose phone_call_id points at
  // a different kind of call. The call-back assignment itself must always proceed.
  resetDb();
  const tenantBefore = new Map(db.phone_calls.map((r) => [r.id, r.tenant_id]));
  const snapshot = (cid) => ({ ...db.phone_calls.find((r) => r.id === cid) });
  const before = Object.fromEntries(Object.values(C).map((cid) => [cid, snapshot(cid)]));
  const unchanged = (cid) => JSON.stringify(snapshot(cid)) === JSON.stringify(before[cid]);
  const cbAssigned = (cbid) =>
    db.callback_requests.find((r) => r.id === cbid)?.advisor_id === U.advA;
  const assign = (cbid) =>
    call(bf.assignUnallocatedVoicemail, { callbackId: cbid, advisorId: U.advA }, ownerA);

  const rForeign = await assign(CB.vmForeign);
  ok(
    "B1A-15a (A) Tenant A cannot patch a Tenant B phone_call linked from its own call-back; the call-back is still assigned",
    rForeign.ok && cbAssigned(CB.vmForeign) && unchanged(C.vmForeign),
    describe(rForeign),
  );
  const rOrphan = await assign(CB.vmOrphan);
  ok(
    "B1A-15b (B) Tenant A cannot patch an unrelated NULL-tenant, session-less phone_call; the call-back is still assigned",
    rOrphan.ok && cbAssigned(CB.vmOrphan) && unchanged(C.vmOrphan),
    describe(rOrphan),
  );
  const rNullB = await assign(CB.vmNullSessB);
  const rNullTl = await assign(CB.vmNullTenantless);
  ok(
    "B1A-15c (C) a NULL-tenant call is not Tenant A's just because Tenant A is acting — NULL-tenant calls on a Tenant B session or a tenantless session stay unchanged",
    rNullB.ok &&
      rNullTl.ok &&
      cbAssigned(CB.vmNullSessB) &&
      cbAssigned(CB.vmNullTenantless) &&
      unchanged(C.vmNullSessB) &&
      unchanged(C.vmNullTenantless),
    describe(rNullB, rNullTl),
  );
  const rOwn = await assign(CB.vmOwnA);
  const rConflict = await assign(CB.vmConflictA);
  ok(
    "B1A-15d tenanted call: patched only when its own tenant_id is Tenant A with no conflicting session",
    rOwn.ok &&
      snapshot(C.vmOwnA).advisor_id === U.advA &&
      rConflict.ok &&
      cbAssigned(CB.vmConflictA) &&
      unchanged(C.vmConflictA),
    describe(rOwn, rConflict),
  );
  const rSessA = await assign(CB.vmSessA);
  ok(
    "B1A-15e (D) the only permitted NULL-tenant patch: the call's own server-written session is a Tenant A session",
    rSessA.ok &&
      snapshot(C.vmSessA).advisor_id === U.advA &&
      snapshot(C.vmSessA).tenant_id === null &&
      db.interview_sessions.find((s) => s.id === before[C.vmSessA].session_id)?.tenant_id === T.a,
    "linkage: phone_calls.session_id → interview_sessions.tenant_id = Tenant A (callback.phone_call_id only locates the call and is never tenant proof)",
  );
  const callUpdates = writes.filter((w) => w.table === "phone_calls" && w.method === "UPDATE");
  ok(
    "B1A-15f (E) no phone_calls tenant_id is written or changed",
    callUpdates.length === 2 &&
      callUpdates.every((w) => !("tenant_id" in w.body)) &&
      db.phone_calls.every((r) => r.tenant_id === tenantBefore.get(r.id)),
    `${callUpdates.length} call updates: ${callUpdates.map((w) => Object.keys(w.body).join("+")).join(", ")}`,
  );
  const bookingSrc = code("src/lib/booking.functions.ts");
  const assignSrc = bookingSrc.slice(
    bookingSrc.indexOf("export const assignUnallocatedVoicemail"),
    bookingSrc.indexOf(
      "\nexport ",
      bookingSrc.indexOf("export const assignUnallocatedVoicemail") + 10,
    ),
  );
  const blockStart = assignSrc.indexOf("if (cb.phone_call_id) {");
  const blockEnd = assignSrc.indexOf('callUpdate.is("tenant_id", null)', blockStart);
  const callBlock =
    blockStart >= 0 && blockEnd > blockStart ? assignSrc.slice(blockStart, blockEnd + 120) : "";
  const decision = callBlock.slice(
    callBlock.indexOf("linkedCall"),
    callBlock.indexOf("if (ownedCall)"),
  );
  ok(
    "B1A-15g (F) call ownership decision uses only the call's own tenant_id/session (no phone, email, profile or call-back link as authority)",
    callBlock.length > 0 &&
      decision.length > 0 &&
      /scopeRowsToTenant\(/.test(decision) &&
      /tenantOf: \(r\) => r\.tenant_id, sessionOf: \(r\) => r\.session_id/.test(decision) &&
      !/\bmatch\b|customer_phone|email|profiles|findSessionForCallerPhone/.test(decision) &&
      !/customer_phone|email|profiles|findSessionForCallerPhone/.test(callBlock) &&
      !/callPatch[^=;]*=\s*\{[^}]*tenant_id|callPatch\.tenant_id|callPatch\[/.test(callBlock),
    `decision region ${decision.length} chars`,
  );
}

// --- 13 / scope -------------------------------------------------------------------------------
{
  const s4b2Paths = [
    "src/lib/twilio-webhook.server.ts",
    "src/lib/sms.server.ts",
    "src/lib/voice.server.ts",
    "src/lib/voice-token.server.ts",
    "src/lib/inbound-voicemail.server.ts",
    "src/lib/phone-call-recording.server.ts",
    "src/lib/telephony-routing.server.ts",
    "src/lib/call-ai.server.ts",
    "src/lib/app-environment.server.ts",
    "src/routes/api/twilio",
    "src/routes/api/sms",
  ];
  ok(
    "B1A-13 S4B2 Twilio trust boundary files are untouched",
    git("status", "--porcelain", "--", ...s4b2Paths).trim() === "",
  );
  ok(
    "B1A-16 no migration; canonical tenant helpers, test accounts, introducer and finance code untouched",
    git(
      "status",
      "--porcelain",
      "--",
      "supabase/migrations",
      "src/lib/tenant-assert.server.ts",
      "src/lib/test-accounts.ts",
      "src/lib/test-accounts.functions.ts",
      "src/lib/introducer.functions.ts",
      "src/lib/finance.functions.ts",
    ).trim() === "",
  );
  const changed = git("diff", "--name-only", "HEAD", "--", "src")
    .trim()
    .split("\n")
    .filter(Boolean);
  const allowed = [
    "src/lib/telephony.functions.ts",
    "src/lib/sessions.functions.ts",
    "src/lib/booking.functions.ts",
  ];
  ok(
    "B1A-17 application changes limited to the telephony, sessions and booking server functions",
    changed.every((f) => allowed.includes(f)),
    changed.join(", ") || "no uncommitted source changes",
  );
}

ok(
  "B1A-18 no network or unstubbed backend access",
  unknownCalls.length === 0,
  unknownCalls.join(", "),
);

console.log(`\n${total - failures.length}/${total} PASS`);
if (failures.length) {
  console.log(`FAILED: ${failures.join("; ")}`);
  process.exit(1);
}
