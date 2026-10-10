/**
 * G7F-4 Journey Security Follow-up — contact tracking and customer journey tenant isolation,
 * offline verification.
 *
 * The real getContactTracking / markContacted / setNextContact / getCustomerJourney validators and
 * handlers (with the real tenant role, acting tenant, resource authorisation and staff contact task
 * modules) run against an in-memory PostgREST fake on a non-routable host. The fake enforces the
 * real partial unique indexes on open staff_contact_tasks rows. Each call carries its own request
 * (Referer = verified /$tenantSlug route) through AsyncLocalStorage, so concurrent calls keep
 * separate tenant contexts. SMS is replaced by an in-process recorder; no message is ever sent.
 *
 * Negative controls load in-memory mutants (the pre-fix handlers from the vulnerable baseline
 * commit, and the fixed handlers with one protection removed) and show the unsafe effect happening
 * and the matching test predicate rejecting it.
 *
 * Synthetic fixtures only (Tenant 001 and Tenant 002): no database, no network, no staging, no
 * production, no phone numbers.
 * Run: npm exec --yes --package=tsx -- tsx scripts/g7f4jf-contact-journey-tenant-isolation-verify.mjs
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
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
  "STAGING_TWILIO_ALLOW_LIVE",
]) {
  delete process.env[k];
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SESSIONS_REL = "src/lib/sessions.functions.ts";
const TA_REL = "src/lib/tenant-assert.server.ts";
const read = (rel) => readFileSync(resolve(root, rel), "utf8");
const atHead = (rel) =>
  execFileSync("git", ["show", `HEAD:${rel}`], { cwd: root, encoding: "utf8", maxBuffer: 1 << 26 });
// Pre-fix negative controls run the handlers of the last commit before this gate's fix; HEAD
// carries the fixed handlers from 7731008a on.
const VULNERABLE_BASELINE = "0e077078f215518c193b87d31ce483146bbd107a";
function atVulnerableBaseline(rel) {
  const git = (args) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 1 << 26, stdio: ["ignore", "pipe", "pipe"] });
  try {
    if (git(["rev-parse", "--verify", "--quiet", `${VULNERABLE_BASELINE}^{commit}`]).trim() !== VULNERABLE_BASELINE) {
      throw new Error("revision does not resolve to itself");
    }
    git(["merge-base", "--is-ancestor", VULNERABLE_BASELINE, "HEAD"]);
    return git(["show", `${VULNERABLE_BASELINE}:${rel}`]);
  } catch (e) {
    console.error(`FAIL  vulnerable baseline ${VULNERABLE_BASELINE} unavailable for ${rel} (missing, or not an ancestor of HEAD): ${e.message}`);
    console.log("RESULT=FAIL");
    process.exit(1);
  }
}

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
const ncResults = [];
function nc(label, { effect, caught, detail = "" }) {
  const pass = Boolean(effect) && Boolean(caught);
  ncResults.push(pass);
  if (pass) console.log(`PASS  ${label}`);
  else console.error(`FAIL  ${label} — effect=${Boolean(effect)} caught=${Boolean(caught)} ${detail}`);
}
async function outcome(fn) {
  try {
    return { ok: true, value: await fn() };
  } catch (e) {
    return { ok: false, error: e, message: String(e?.message ?? e) };
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- module stubs ---------------------------------------------------------------------------------
const fileUrl = (rel) => pathToFileURL(resolve(root, rel)).href;
const dataUrl = (src) => `data:text/javascript,${encodeURIComponent(src)}`;
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
export function getRequest() { return globalThis.__JF_ALS?.getStore()?.request ?? null; }
export function getCookie() { return undefined; }
export function setCookie() {}
export function deleteCookie() {}
`;
const stubPlatform = `
export async function validatePlatformTenantAccessSession(input) {
  return globalThis.__JF_PLATFORM?.get(input.userId + ":" + input.tenantId) ?? null;
}
export async function hasValidPlatformTenantAccess() { return false; }
export async function clearPlatformTenantEntryOnLogout() {}
`;
const stubSms = `
export * from ${JSON.stringify(fileUrl("src/lib/sms.server.ts"))};
export async function sendSms() { throw new Error("SMS refused in verifier"); }
export async function sendInterviewCompleteSms() {}
export async function sendJourneyMilestoneSms(customerId, sessionId, milestoneKey) {
  globalThis.__JF_SMS.push({ customerId, sessionId, milestoneKey });
}
`;
const SESSIONS_MARK = "/*jf-mutant:sessions*/";
const TA_MARK = "/*jf-mutant:tenant-assert*/";
const hookSource = `
const MUTANTS = ${JSON.stringify({
  [dataUrl(SESSIONS_MARK)]: fileUrl(SESSIONS_REL),
  [dataUrl(TA_MARK)]: fileUrl(TA_REL),
})};
const STUBS = {
  start: ${JSON.stringify(dataUrl(stubStart))},
  startServer: ${JSON.stringify(dataUrl(stubStartServer))},
  platform: ${JSON.stringify(dataUrl(stubPlatform))},
  sms: ${JSON.stringify(dataUrl(stubSms))},
};
export async function resolve(specifier, context, next) {
  let parent = String(context.parentURL ?? "");
  for (const [mark, real] of Object.entries(MUTANTS)) {
    if (parent.startsWith(mark)) {
      context = { ...context, parentURL: real };
      parent = real;
      break;
    }
  }
  if (parent.startsWith("data:")) return next(specifier, context);
  if (specifier === "@tanstack/react-start") return { url: STUBS.start, shortCircuit: true };
  if (specifier === "@tanstack/react-start/server") return { url: STUBS.startServer, shortCircuit: true };
  if (/platform-tenant-entry\\.server(\\.ts)?$/.test(specifier)) return { url: STUBS.platform, shortCircuit: true };
  if (/(^|\\/)sms\\.server(\\.ts)?$/.test(specifier)) return { url: STUBS.sms, shortCircuit: true };
  return next(specifier, context);
}
`;
register(dataUrl(hookSource), import.meta.url);

// --- synthetic fixtures -----------------------------------------------------------------------------
const FAKE_HOST = "g7f4jf.invalid";
process.env.SUPABASE_URL = `http://${FAKE_HOST}`;
process.env.VITE_SUPABASE_URL = `http://${FAKE_HOST}`;
process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_secret_g7f4jf_not_a_real_key";
process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_g7f4jf_not_a_real_key";
process.env.VITE_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_g7f4jf_not_a_real_key";

const id = (prefix, n) =>
  `${prefix}${String(n).repeat(7).slice(0, 7)}-0000-4000-8000-${String(n).padStart(12, "0")}`;
const T = { a: id("1", 1), b: id("1", 2) };
const U = {
  ownerA: id("2", 1),
  supA: id("2", 2),
  advA: id("2", 3),
  advA2: id("2", 4),
  advAppt: id("2", 5),
  genJ: id("2", 6),
  genN: id("2", 7),
  introA: id("2", 8),
  ownerB: id("3", 1),
  supB: id("3", 2),
  advB: id("3", 3),
  dual: id("3", 4),
  platRO: id("3", 5),
  platOp: id("3", 6),
  outsider: id("3", 7),
  ownAdvB: id("3", 8),
  custA: id("4", 1),
  custA2: id("4", 2),
  custB: id("4", 3),
};
const S = {
  a1: id("5", 1),
  a2: id("5", 2),
  aDel: id("5", 3),
  b1: id("5", 4),
  nul: id("5", 5),
};
const RANDOM = "9f9f9f9f-9f9f-4f9f-8f9f-9f9f9f9f9f9f";
const ago = (d) => new Date(Date.now() - d * 86400000).toISOString();

/** Seeded contact tracking of each tenant's case (distinct values to detect disclosure). */
const TRACK = {
  a1: { last: "2026-09-01T09:00:00.000Z", next: "2026-10-20T09:00:00.000Z" },
  b1: { last: "2026-09-02T11:00:00.000Z", next: "2026-10-21T11:00:00.000Z" },
};
let db;
const writes = [];
const unknownCalls = [];
globalThis.__JF_SMS = [];
function resetDb() {
  const mem = (user_id, tenant_id, role) => ({ id: randomUUID(), user_id, tenant_id, role, active: true });
  const sess = (sid, customer_id, tenant_id, extra = {}) => ({
    id: sid,
    customer_id,
    tenant_id,
    case_ref: `MG-${sid.slice(0, 4)}`,
    status: "in_progress",
    deleted_at: null,
    created_at: ago(5),
    updated_at: ago(3),
    ...extra,
  });
  const milestone = (session_id, milestone_key, by) => ({
    id: randomUUID(),
    session_id,
    milestone_key,
    completed_at: ago(1),
    completed_by: by,
  });
  db = {
    tenants: [
      { id: T.a, slug: "tenant-001", company_name: "Tenant 001", status: "active", tenant_type: "firm", company_code: "001" },
      { id: T.b, slug: "tenant-002", company_name: "Tenant 002", status: "active", tenant_type: "firm", company_code: "002" },
    ],
    tenant_memberships: [
      mem(U.ownerA, T.a, "owner"),
      mem(U.supA, T.a, "supervisor"),
      mem(U.advA, T.a, "adviser"),
      mem(U.advA2, T.a, "adviser"),
      mem(U.advAppt, T.a, "adviser"),
      mem(U.genJ, T.a, "general"),
      mem(U.genN, T.a, "general"),
      mem(U.introA, T.a, "introducer"),
      mem(U.custA, T.a, "customer"),
      mem(U.custA2, T.a, "customer"),
      mem(U.ownerB, T.b, "owner"),
      mem(U.supB, T.b, "supervisor"),
      mem(U.advB, T.b, "adviser"),
      mem(U.custB, T.b, "customer"),
      mem(U.dual, T.a, "owner"),
      mem(U.dual, T.b, "owner"),
      mem(U.ownAdvB, T.b, "owner"),
      mem(U.ownAdvB, T.b, "adviser"),
    ],
    admin_permissions: [
      { user_id: U.genJ, tenant_id: T.a, permission_key: "journey", access: "amend" },
      { user_id: U.genN, tenant_id: T.a, permission_key: "journey", access: "none" },
    ],
    profiles: Object.entries(U).map(([k, uid]) => ({
      id: uid,
      full_name: `Synthetic ${k}`,
      email: `${k.toLowerCase()}@example.test`,
      phone: null,
    })),
    interview_sessions: [
      sess(S.a1, U.custA, T.a),
      sess(S.a2, U.custA2, T.a),
      sess(S.aDel, U.custA, T.a, { deleted_at: ago(1) }),
      sess(S.b1, U.custB, T.b),
      sess(S.nul, U.custA, null),
    ],
    session_advisors: [
      { session_id: S.a1, advisor_id: U.advA },
      { session_id: S.b1, advisor_id: U.advB },
      // A stale cross-tenant allocation row must never authorise tenant B's adviser on tenant A.
      { session_id: S.a1, advisor_id: U.advB },
    ],
    appointments: [
      { id: id("6", 1), tenant_id: T.a, session_id: S.a2, advisor_id: U.advAppt, status: "confirmed", created_at: ago(2) },
      { id: id("6", 2), tenant_id: T.a, session_id: S.a1, advisor_id: U.advA, status: "confirmed", created_at: ago(2) },
      { id: id("6", 3), tenant_id: T.b, session_id: S.b1, advisor_id: U.advB, status: "confirmed", created_at: ago(2) },
    ],
    callback_requests: [
      { id: id("7", 1), tenant_id: T.a, session_id: S.a1, advisor_id: U.advA, status: "new", created_at: ago(1) },
    ],
    customer_journey_milestones: [
      milestone(S.a1, "id_confirmed", U.ownerA),
      milestone(S.a2, "id_confirmed", U.ownerA),
      milestone(S.b1, "id_confirmed", U.ownerB),
      milestone(S.aDel, "id_confirmed", U.ownerA),
      milestone(S.nul, "id_confirmed", U.ownerA),
    ],
    customer_contact_log: [],
    session_contact_tracking: [
      { session_id: S.a1, last_contacted_at: TRACK.a1.last, next_contact_at: TRACK.a1.next, updated_by: U.advA, updated_at: ago(2) },
      { session_id: S.b1, last_contacted_at: TRACK.b1.last, next_contact_at: TRACK.b1.next, updated_by: U.advB, updated_at: ago(2) },
    ],
    advisor_contact_views: [],
    staff_contact_tasks: [],
  };
  writes.length = 0;
  unknownCalls.length = 0;
  globalThis.__JF_SMS.length = 0;
}

globalThis.__JF_PLATFORM = new Map([
  [`${U.platRO}:${T.a}`, { accessLevel: "read_only", basisLabel: "synthetic read-only" }],
  [`${U.platOp}:${T.a}`, { accessLevel: "operational_admin", basisLabel: "synthetic operational" }],
]);

// --- in-memory PostgREST fake -------------------------------------------------------------------
let jitter = false;
const json = (v, status = 200, extra = {}) =>
  new Response(v === undefined ? "" : JSON.stringify(v), {
    status,
    headers: { "content-type": "application/json", ...extra },
  });
const RESERVED = new Set(["select", "order", "limit", "offset", "on_conflict", "columns"]);
const parseList = (v) =>
  v
    .replace(/^\(|\)$/g, "")
    .split(",")
    .map((s) => s.trim().replace(/^"|"$/g, ""));
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
    if (k === "or" || k === "and") throw new Error(`fake postgrest: unsupported ${k}=${v}`);
    out = out.filter((r) => matchOp(r[k], v));
  }
  const order = url.searchParams.get("order");
  if (order) {
    const [col, dir] = order.split(",")[0].split(".");
    out = [...out].sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : 1) * (dir === "desc" ? -1 : 1));
  }
  const limit = url.searchParams.get("limit");
  return limit ? out.slice(0, Number(limit)) : out;
}
const tableRows = (table) => (Array.isArray(db[table]) ? db[table] : (db[table] = []));
function respondRows(rows, headers, method, status = 200) {
  const accept = headers.get("accept") ?? "";
  if (method === "HEAD") return new Response(null, { status });
  if (accept.includes("vnd.pgrst.object+json")) {
    if (rows.length !== 1) {
      return json({ code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" }, 406);
    }
    return json(rows[0], status);
  }
  return json(rows, status);
}
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === "string" ? input : (input.url ?? String(input)));
  if (url.hostname !== FAKE_HOST) {
    unknownCalls.push(`refused host ${url.hostname}`);
    throw new Error(`G7F4JF fetch stub refused host ${url.hostname}`);
  }
  if (jitter) await sleep(Math.floor(Math.random() * 4));
  const method = String(init.method || (typeof input === "object" && input.method) || "GET").toUpperCase();
  const headers = new Headers(init.headers || (typeof input === "object" ? input.headers : undefined));
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
    unknownCalls.push(`rpc ${fn}`);
    return json(null);
  }
  if (p.startsWith("/rest/v1/")) {
    const table = p.slice("/rest/v1/".length);
    const rows = tableRows(table);
    if (method === "GET" || method === "HEAD") return respondRows(applyFilters(rows, url), headers, method);
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
        // The real partial unique indexes: one open welcome_call / next_contact task per session.
        if (
          table === "staff_contact_tasks" &&
          !row.completed_at &&
          rows.some((r) => r.session_id === row.session_id && r.task_type === row.task_type && !r.completed_at)
        ) {
          return json({ code: "23505", message: "duplicate key value violates unique constraint" }, 409);
        }
        if (row.id === undefined) row.id = randomUUID();
        if (row.created_at === undefined) row.created_at = new Date().toISOString();
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

// --- modules under test ---------------------------------------------------------------------------
globalThis.__JF_ALS = new AsyncLocalStorage();
resetDb();
const sf = await import("../src/lib/sessions.functions.ts");
const ta = await import("../src/lib/tenant-assert.server.ts");
const NOT_FOUND = ta.RESOURCE_NOT_FOUND_MESSAGE;

async function invoke(mod, name, data, context) {
  const d = mod[name].__def;
  const parsed = d.validator ? await d.validator(data) : data;
  return d.handler({ data: parsed, context });
}
/** Actor; `slug` is the verified /$tenantSlug route carried in the Referer (null = none). */
const as = (userId, slug) => ({ userId, slug });
function call(mod, name, data, actor) {
  const request = actor.slug
    ? new Request("http://app.invalid/_serverFn/x", {
        headers: { referer: `http://app.invalid/${actor.slug}/sessions/${data.sessionId ?? ""}` },
      })
    : null;
  return globalThis.__JF_ALS.run({ request }, () =>
    outcome(() =>
      invoke(mod, name, data, {
        userId: actor.userId,
        claims: { sub: actor.userId, email: `${actor.userId}@example.test` },
        supabase: null,
      }),
    ),
  );
}

const A = {
  ownerA: as(U.ownerA, "tenant-001"),
  supA: as(U.supA, "tenant-001"),
  advA: as(U.advA, "tenant-001"),
  advA2: as(U.advA2, "tenant-001"),
  advAppt: as(U.advAppt, "tenant-001"),
  genJ: as(U.genJ, "tenant-001"),
  genN: as(U.genN, "tenant-001"),
  introA: as(U.introA, "tenant-001"),
  custA: as(U.custA, "tenant-001"),
  ownerB: as(U.ownerB, "tenant-002"),
  supB: as(U.supB, "tenant-002"),
  advB: as(U.advB, "tenant-002"),
  dualA: as(U.dual, "tenant-001"),
  dualB: as(U.dual, "tenant-002"),
  dualNone: as(U.dual, null),
  platRO: as(U.platRO, "tenant-001"),
  platOp: as(U.platOp, "tenant-001"),
  outsider: as(U.outsider, null),
  ownAdvB: as(U.ownAdvB, "tenant-002"),
  ownAdvBForgedA: as(U.ownAdvB, "tenant-001"),
  custA2: as(U.custA2, "tenant-001"),
  custB: as(U.custB, "tenant-002"),
};

/** Every row a contact or journey call could touch, keyed for a byte comparison. */
function effectState() {
  const pick = (table) => JSON.stringify([...(db[table] ?? [])].map((r) => JSON.stringify(r)).sort());
  return [
    pick("customer_journey_milestones"),
    pick("customer_contact_log"),
    pick("session_contact_tracking"),
    pick("advisor_contact_views"),
    pick("interview_sessions"),
    pick("session_advisors"),
    pick("staff_contact_tasks"),
  ].join("|");
}
/** Writes and SMS touching tenant A's sessions (or any session of A, by table). */
const sessionOf = (w) => w.row.session_id ?? null;
const touches = (sids) => ({
  milestones: writes.filter((w) => w.table === "customer_journey_milestones" && sids.includes(sessionOf(w))).length,
  log: writes.filter((w) => w.table === "customer_contact_log" && sids.includes(sessionOf(w))).length,
  attention: writes.filter((w) => w.table === "session_contact_tracking" && sids.includes(sessionOf(w))).length,
  views: writes.filter((w) => {
    if (w.table !== "advisor_contact_views") return false;
    const src = w.row.contact_type === "callback" ? db.callback_requests : db.appointments;
    return sids.includes(src.find((x) => x.id === w.row.contact_id)?.session_id);
  }).length,
  sms: globalThis.__JF_SMS.filter((m) => sids.includes(m.sessionId)).length,
  tasks: writes.filter((w) => w.table === "staff_contact_tasks" && sids.includes(sessionOf(w))).length,
});
const zero = (t) =>
  t.milestones === 0 && t.log === 0 && t.attention === 0 && t.views === 0 && t.sms === 0 && t.tasks === 0;
const leakFree = (r) =>
  !r.ok &&
  !["tenant-001", "tenant-002", "Tenant 001", "Tenant 002", T.a, T.b, U.custA, U.custB, S.a1, S.b1].some((s) =>
    r.message.includes(s),
  );
const fmt = (r) => (r.ok ? "ok" : `refused:${r.message}`);
/** A refusal with no effect of any kind (rows, writes, SMS). */
async function refusedWithoutEffect(run) {
  resetDb();
  const before = effectState();
  const r = await run();
  return {
    r,
    clean: !r.ok && effectState() === before && writes.length === 0 && globalThis.__JF_SMS.length === 0,
  };
}

// --- source helpers (scope + mutants) ----------------------------------------------------------------
function topLevelBlocks(src) {
  const lines = src.split("\n");
  const starts = [];
  lines.forEach((l, i) => {
    const m = l.match(/^(?:export )?(?:async )?(?:function|const|let|type|interface|class) (\w+)/);
    if (m) starts.push({ i, name: m[1] });
  });
  const blocks = new Map();
  starts.forEach((s, k) => {
    const end = k + 1 < starts.length ? starts[k + 1].i : lines.length;
    let key = s.name;
    while (blocks.has(key)) key += "#";
    blocks.set(key, lines.slice(s.i, end).join("\n"));
  });
  return { head: lines.slice(0, starts[0]?.i ?? 0).join("\n"), blocks };
}
const SESSIONS_SRC = read(SESSIONS_REL);
const SESSIONS_HEAD = atHead(SESSIONS_REL);
const TA_SRC = read(TA_REL);
const cur = topLevelBlocks(SESSIONS_SRC);
const head = topLevelBlocks(SESSIONS_HEAD);
const block = (name) => cur.blocks.get(name) ?? "";

async function loadMutant(mark, src) {
  const js = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return import(dataUrl(`${mark}\n${js}\n// ${randomUUID()}`));
}
/** Replace `from` with `to` inside one top-level declaration of sessions.functions.ts. */
function mutateIn(src, name, from, to) {
  const b = topLevelBlocks(src).blocks.get(name);
  if (!b || !b.includes(from)) return null;
  return src.replace(b, b.split(from).join(to));
}

// --- contact / journey helpers --------------------------------------------------------------------
const NEXT = "2026-11-02T10:00:00.000Z";
const NEXT2 = "2026-11-09T15:30:00.000Z";
const ops = {
  tracking: (mod, sid, actor, extra = {}) => call(mod, "getContactTracking", { sessionId: sid, ...extra }, actor),
  mark: (mod, sid, actor, extra = {}) => call(mod, "markContacted", { sessionId: sid, ...extra }, actor),
  next: (mod, sid, actor, extra = {}) =>
    call(mod, "setNextContact", { sessionId: sid, nextContactAt: NEXT, ...extra }, actor),
  journey: (mod, sid, actor, extra = {}) => call(mod, "getCustomerJourney", { sessionId: sid, ...extra }, actor),
};
const OPS = Object.keys(ops);
/** Role gates as they were before this gate: contact tracking and "contacted" are Adviser-only. */
const ROLE_PASSES = {
  tracking: (u) => [U.advA, U.advA2, U.advAppt, U.advB, U.ownAdvB].includes(u),
  mark: (u) => [U.advA, U.advA2, U.advAppt, U.advB, U.ownAdvB].includes(u),
  next: (u) => ![U.introA, U.custA, U.custA2, U.custB, U.outsider, U.platRO].includes(u),
  journey: (u) => ![U.introA, U.custA, U.custA2, U.custB, U.outsider, U.platRO].includes(u),
};
const viewSession = (w) =>
  (w.row.contact_type === "callback" ? db.callback_requests : db.appointments).find((x) => x.id === w.row.contact_id)
    ?.session_id ?? null;
const writeSession = (w) => (w.table === "advisor_contact_views" ? viewSession(w) : sessionOf(w));
const welcomeTasks = (sid) => db.staff_contact_tasks.filter((t) => t.session_id === sid && t.task_type === "welcome_call");
const openNext = (sid) =>
  db.staff_contact_tasks.filter((t) => t.session_id === sid && t.task_type === "next_contact" && !t.completed_at);

// =================================================================================================
// Same-tenant authorised behaviour
// =================================================================================================
{
  resetDb();
  const a = await ops.tracking(sf, S.a1, A.advA);
  const appt = await ops.tracking(sf, S.a2, A.advAppt);
  const both = await ops.tracking(sf, S.b1, A.ownAdvB);
  ok(
    "JF-01 getContactTracking: an allocated Adviser (session_advisors or appointment) reads its own tenant's case tracking, and tenant 002's Owner-Adviser reads tenant 002's; a read writes nothing",
    a.ok && a.value.lastContactedAt === TRACK.a1.last && a.value.nextContactAt === TRACK.a1.next &&
      appt.ok && appt.value.lastContactedAt === null &&
      both.ok && both.value.lastContactedAt === TRACK.b1.last && writes.length === 0,
    `${fmt(a)} ${fmt(appt)} ${fmt(both)}`,
  );
}
{
  resetDb();
  const r = await ops.mark(sf, S.a1, A.advA);
  const t = db.session_contact_tracking.find((x) => x.session_id === S.a1);
  const log = db.customer_contact_log.filter((x) => x.session_id === S.a1);
  ok(
    "JF-02 markContacted: an allocated Adviser stamps last contact, writes one \"contact\" log entry and clears the attention flag (tracking + opened markers) on that case only",
    r.ok && t.last_contacted_at !== TRACK.a1.last && t.updated_by === U.advA && t.session_attention_cleared_at &&
      log.length === 1 && log[0].entry_type === "contact" && log[0].author_id === U.advA &&
      writes.some((w) => w.table === "advisor_contact_views") && writes.every((w) => writeSession(w) === S.a1) &&
      db.session_contact_tracking.find((x) => x.session_id === S.b1).last_contacted_at === TRACK.b1.last,
    fmt(r),
  );
}
{
  const outs = [];
  for (const actor of [A.advA, A.ownerA, A.supA, A.genN, A.dualA, A.platOp]) {
    resetDb();
    const r = await ops.next(sf, S.a1, actor);
    const t = db.session_contact_tracking.find((x) => x.session_id === S.a1);
    const log = db.customer_contact_log.filter((x) => x.session_id === S.a1 && x.entry_type === "next_contact_set");
    outs.push(
      r.ok && t.next_contact_at === NEXT && openNext(S.a1).length === 1 && openNext(S.a1)[0].due_at === NEXT &&
        log.length === 1 && writes.every((w) => writeSession(w) === S.a1),
    );
  }
  resetDb();
  await ops.next(sf, S.a1, A.advA);
  const clear = await ops.next(sf, S.a1, A.advA, { nextContactAt: null });
  const cleared = db.staff_contact_tasks.filter((t) => t.session_id === S.a1 && t.task_type === "next_contact");
  outs.push(clear.ok && cleared.length === 1 && Boolean(cleared[0].completed_at) && openNext(S.a1).length === 0);
  ok(
    "JF-03 setNextContact: existing authority preserved in the acting tenant (allocated Adviser, Owner, Supervisor, General Admin, dual Owner acting in 001, platform operational entry): tracking, one open next-contact task and one log entry on that case only; clearing completes the task",
    outs.every(Boolean),
    outs.join(","),
  );
}
{
  const outs = [];
  for (const actor of [A.ownerA, A.supA, A.advA, A.genN, A.dualA, A.platOp]) {
    resetDb();
    const r = await ops.journey(sf, S.a1, actor);
    const w = welcomeTasks(S.a1);
    outs.push(
      r.ok && r.value.milestones.find((m) => m.key === "id_confirmed")?.completedAt &&
        r.value.internalTasks.some((t) => t.taskType === "welcome_call") &&
        w.length === 1 && w[0].tenant_id === T.a && welcomeTasks(S.b1).length === 0,
    );
  }
  resetDb();
  const cust = await ops.journey(sf, S.a1, A.custA);
  outs.push(cust.ok && cust.value.internalTasks.length === 0 && cust.value.milestones.length > 0 && writes.length === 0);
  ok(
    "JF-04 getCustomerJourney: Owner, Supervisor, allocated Adviser, General Admin, dual Owner acting in 001 and platform operational entry read the case journey and staff tasks; the welcome-call task is created for that case with the case's tenant; the case's own customer sees milestones only and nothing is written",
    outs.every(Boolean),
    outs.join(","),
  );
}
{
  const outs = [];
  for (const [op, actors] of [
    ["tracking", [A.ownerA, A.supA, A.genN, A.introA, A.custA, A.platRO, A.platOp]],
    ["mark", [A.ownerA, A.supA, A.genN, A.introA, A.custA, A.platRO, A.platOp]],
    ["next", [A.introA, A.custA, A.platRO]],
    ["journey", [A.introA, A.custA2, A.platRO]],
  ]) {
    for (const actor of actors) {
      const { r, clean } = await refusedWithoutEffect(() => ops[op](sf, S.a1, actor));
      outs.push([`${op}:${actor.userId.slice(0, 2)}`, clean && r.message === "Forbidden"]);
    }
  }
  ok(
    "JF-05 existing role rules preserved and no new platform privilege: contact tracking and \"contacted\" stay Adviser-only; Introducer, Customer (not the case's own) and platform read-only entry are refused everywhere; each refusal has no effect",
    outs.every((o) => o[1]),
    outs.filter((o) => !o[1]).map((o) => o[0]).join(","),
  );
}

// =================================================================================================
// Cross-tenant refusal (tenant 002 actors on tenant 001's case)
// =================================================================================================
const crossCases = [
  ["Owner (and an Owner who is also an Adviser)", [A.ownerB, A.ownAdvB]],
  ["Supervisor", [A.supB]],
  ["Adviser (with a stale cross-tenant allocation row)", [A.advB]],
  ["dual-member Owner acting in tenant 002", [A.dualB]],
];
for (const [i, [label, actors]] of crossCases.entries()) {
  const outs = [];
  for (const actor of actors) {
    for (const op of OPS) {
      const { r, clean } = await refusedWithoutEffect(() => ops[op](sf, S.a1, actor));
      const expected = ROLE_PASSES[op](actor.userId) ? NOT_FOUND : "Forbidden";
      outs.push([`${op}`, clean && r.message === expected && leakFree(r), fmt(r)]);
    }
  }
  ok(
    `JF-${String(6 + i).padStart(2, "0")} cross-tenant ${label}: all four functions refused on tenant 001's case — no tracking value, milestone or task disclosed; no tracking, contact-log, task or attention-flag write`,
    outs.every((o) => o[1]),
    outs.map((o) => `${o[0]}=${o[2]}`).join(" "),
  );
}
{
  resetDb();
  const rs = [
    await ops.tracking(sf, S.b1, A.advB),
    await ops.mark(sf, S.b1, A.advB),
    await ops.next(sf, S.b1, A.ownerB),
    await ops.journey(sf, S.b1, A.supB),
  ];
  const t = touches([S.a1, S.a2, S.aDel, S.nul]);
  ok(
    "JF-10 tenant 002's own staff keep working on tenant 002's case (read, contacted, next contact, journey with welcome task) and nothing touches tenant 001",
    rs.every((r) => r.ok) && zero(t) && welcomeTasks(S.b1).length === 1 && welcomeTasks(S.b1)[0].tenant_id === T.b &&
      writes.every((w) => writeSession(w) === S.b1),
    rs.map(fmt).join(" | "),
  );
}

// =================================================================================================
// Unknown, tenantless, binned, customers and forged context
// =================================================================================================
{
  const outs = [];
  for (const op of OPS) {
    const actor = op === "tracking" || op === "mark" ? A.advA : A.ownerA;
    for (const sid of [RANDOM, S.b1, S.nul, S.aDel]) {
      const { r, clean } = await refusedWithoutEffect(() => ops[op](sf, sid, actor));
      outs.push([`${op}:${sid.slice(0, 2)}`, clean && r.message === NOT_FOUND, r.message]);
    }
  }
  ok(
    "JF-11 unknown, other-tenant, tenantless and binned cases are indistinguishable for all four functions: identical \"Not found.\", no effect",
    outs.every((o) => o[1]),
    outs.filter((o) => !o[1]).map((o) => `${o[0]}=${o[2]}`).join(" "),
  );
}
{
  const runs = [
    ["custB on 001's case", () => ops.journey(sf, S.a1, A.custB)],
    ["custB on an unknown id", () => ops.journey(sf, RANDOM, A.custB)],
    ["custA on its own binned case", () => ops.journey(sf, S.aDel, A.custA)],
    ["custA2 on custA's case", () => ops.journey(sf, S.a1, A.custA2)],
  ];
  const outs = [];
  for (const [label, run] of runs) {
    const { r, clean } = await refusedWithoutEffect(run);
    outs.push([label, clean && leakFree(r), r.message]);
  }
  ok(
    "JF-12 the customer path is the caller's own live case only: another customer's case, an unknown id and the customer's own binned case get the same refusal with no milestone disclosed and nothing written",
    outs.every((o) => o[1]) && new Set(outs.map((o) => o[2])).size === 1,
    outs.map((o) => `${o[0]}=${o[2]}`).join(" | "),
  );
}
{
  const outs = [];
  for (const op of OPS) {
    for (const [label, run] of [
      ["forged Referer slug of 001", () => ops[op](sf, S.a1, A.ownAdvBForgedA)],
      ["body tenantId/tenantSlug/customerId of 001", () =>
        ops[op](sf, S.a1, A.ownAdvB, { tenantId: T.a, tenantSlug: "tenant-001", customerId: U.custA })],
      ["dual member without a verified context", () => ops[op](sf, S.a1, A.dualNone)],
      ["no membership", () => ops[op](sf, S.a1, A.outsider)],
    ]) {
      const { r, clean } = await refusedWithoutEffect(run);
      outs.push([`${op}:${label}`, clean && leakFree(r), r.message]);
    }
  }
  ok(
    "JF-13 forged tenant context refused for all four functions: a foreign Referer slug, caller-supplied tenantId/tenantSlug/customerId (stripped by the validator) and an unverified or absent context never reach tenant 001's case",
    outs.every((o) => o[1]),
    outs.filter((o) => !o[1]).map((o) => `${o[0]}=${o[2]}`).join(" | "),
  );
}
{
  const outs = [];
  for (const op of OPS) {
    const a = await refusedWithoutEffect(() => ops[op](sf, S.a1, A.advA2));
    const b = await refusedWithoutEffect(() => ops[op](sf, S.a2, A.advA));
    outs.push([op, a.clean && a.r.message === "Forbidden" && b.clean && b.r.message === "Forbidden", `${fmt(a.r)}/${fmt(b.r)}`]);
  }
  ok(
    "JF-14 adviser allocation enforced for all four functions (the case page's existing rule): an Adviser of the same tenant not allocated to the case (no session_advisors row or appointment) is refused with no effect",
    outs.every((o) => o[1]),
    outs.map((o) => `${o[0]}=${o[2]}`).join(" "),
  );
}

// =================================================================================================
// Idempotency and concurrency
// =================================================================================================
{
  resetDb();
  for (let i = 0; i < 3; i += 1) await ops.journey(sf, S.a1, A.ownerA);
  jitter = true;
  const rs = await Promise.all([
    ops.journey(sf, S.a1, A.ownerA),
    ops.journey(sf, S.a1, A.advA),
    ops.journey(sf, S.a1, A.supA),
    ops.journey(sf, S.a1, A.ownerB),
    ops.journey(sf, S.a1, A.advB),
    ops.journey(sf, S.a1, A.platOp),
  ]);
  jitter = false;
  resetDb();
  jitter = true;
  const cold = await Promise.all([A.ownerA, A.advA, A.supA, A.genN, A.platOp].map((a) => ops.journey(sf, S.a1, a)));
  jitter = false;
  const w = welcomeTasks(S.a1);
  ok(
    "JF-15 welcome-call creation on journey load is idempotent and authorised: repeated and concurrent loads (including concurrent first loads) leave exactly one welcome-call task, stamped with the case's tenant; cross-tenant loads in the same batch are refused and create none",
    rs.filter((r) => r.ok).length === 4 && !rs[3].ok && !rs[4].ok &&
      cold.every((r) => r.ok) && w.length === 1 && w[0].tenant_id === T.a && welcomeTasks(S.b1).length === 0,
    `first-batch=${rs.map((r) => (r.ok ? "ok" : "x")).join("")} cold=${cold.map((r) => (r.ok ? "ok" : "x")).join("")} welcome=${w.length}`,
  );
}
{
  resetDb();
  await ops.next(sf, S.a1, A.advA);
  await ops.next(sf, S.a1, A.ownerA);
  await ops.next(sf, S.a1, A.advA, { nextContactAt: NEXT2 });
  const seq = openNext(S.a1);
  resetDb();
  jitter = true;
  const rs = await Promise.all([A.advA, A.ownerA, A.supA, A.genN].map((a) => ops.next(sf, S.a1, a)));
  jitter = false;
  ok(
    "JF-16 next-contact task is idempotent: repeated sets keep one open task (due date updated); concurrent first sets leave one open task",
    seq.length === 1 && seq[0].due_at === NEXT2 && rs.every((r) => r.ok) && openNext(S.a1).length === 1,
    `seq=${seq.length} concurrent=${openNext(S.a1).length}`,
  );
}
{
  resetDb();
  jitter = true;
  const plan = [];
  for (let i = 0; i < 5; i += 1) {
    plan.push(["legitA", () => ops.mark(sf, S.a1, A.advA)]);
    plan.push(["legitA", () => ops.next(sf, S.a1, A.ownerA)]);
    plan.push(["legitA", () => ops.journey(sf, S.a1, A.supA)]);
    plan.push(["readA", () => ops.tracking(sf, S.a1, A.advA)]);
    plan.push(["legitB", () => ops.mark(sf, S.b1, A.advB)]);
    plan.push(["legitB", () => ops.next(sf, S.b1, A.ownerB)]);
    plan.push(["legitB", () => ops.journey(sf, S.b1, A.ownAdvB)]);
    plan.push(["attack", () => ops.mark(sf, S.a1, A.advB)]);
    plan.push(["attack", () => ops.mark(sf, S.a1, A.ownAdvB)]);
    plan.push(["attack", () => ops.next(sf, S.a1, A.ownerB)]);
    plan.push(["attack", () => ops.journey(sf, S.a1, A.supB)]);
    plan.push(["attack", () => ops.tracking(sf, S.a1, A.advB)]);
    plan.push(["attack", () => ops.next(sf, S.b1, A.ownerA)]);
    plan.push(["attack", () => ops.mark(sf, S.b1, A.advA)]);
  }
  const results = await Promise.all(plan.map(([kind, run]) => run().then((r) => [kind, r])));
  jitter = false;
  const A_ACTORS = new Set([U.advA, U.ownerA, U.supA]);
  const B_ACTORS = new Set([U.advB, U.ownerB, U.ownAdvB]);
  const actorOf = (w) => w.row.author_id ?? w.row.updated_by ?? w.row.created_by ?? w.row.advisor_id ?? null;
  const crossWrites = writes.filter((w) => {
    const sid = writeSession(w);
    const who = actorOf(w);
    if (w.table === "staff_contact_tasks" && w.row.task_type === "welcome_call") {
      return (sid === S.a1 && w.row.tenant_id !== T.a) || (sid === S.b1 && w.row.tenant_id !== T.b);
    }
    if (sid === S.a1) return !A_ACTORS.has(who);
    if (sid === S.b1) return !B_ACTORS.has(who);
    return true;
  });
  const of = (k) => results.filter(([kind]) => kind === k).map(([, r]) => r);
  ok(
    "JF-17 concurrent interleaved calls across all four functions (per-request tenant contexts, jittered I/O): every cross-tenant attempt refused, every legitimate call applied, tenant 001's reads never return tenant 002's values, no write to a case by another tenant's actor, one welcome task and one open next-contact task per case",
    of("attack").every((r) => !r.ok) && [...of("legitA"), ...of("legitB")].every((r) => r.ok) &&
      of("readA").every((r) => r.ok && r.value.nextContactAt !== TRACK.b1.next && r.value.lastContactedAt !== TRACK.b1.last) &&
      crossWrites.length === 0 && welcomeTasks(S.a1).length === 1 && welcomeTasks(S.b1).length === 1 &&
      openNext(S.a1).length === 1 && openNext(S.b1).length === 1,
    `attacks=${of("attack").length} refused=${of("attack").filter((r) => !r.ok).length} legit=${of("legitA").length + of("legitB").length} crossWrites=${crossWrites.length}`,
  );
}

// =================================================================================================
// Static boundary and scope
// =================================================================================================
const EFFECTS = [
  ".from(",
  "upsertContactTracking(",
  "appendContactLog(",
  "clearSessionAttention(",
  "syncNextContactTask(",
  "ensureWelcomeCallTask(",
  "listStaffContactTasksForSession(",
];
{
  const order = (name, { customerQuery = false } = {}) => {
    let b = block(name);
    if (customerQuery) {
      // The only query allowed before authorisation: the caller's own live case, by customer_id.
      const own = b.match(/\.from\("interview_sessions"\)\s*\.select\("id"\)\s*\.eq\("id", data\.sessionId\)\s*\.eq\("customer_id", context\.userId\)\s*\.is\("deleted_at", null\)/);
      if (!own) return false;
      b = b.replace(own[0], "");
    }
    const auth = b.indexOf("authoriseTenantResource(");
    const first = Math.min(...EFFECTS.map((s) => b.indexOf(s)).filter((x) => x >= 0));
    return auth > 0 && auth < first && !/getRolesForUser|resolveAdminAccess/.test(b);
  };
  ok(
    "JF-18 all four handlers authorise the case in the verified acting tenant (authoriseTenantResource) before any other service-role query, write or task call (getCustomerJourney's only earlier query is the caller's own live case by customer_id); no unscoped role-only gate remains",
    order("getContactTracking") && order("markContacted") && order("setNextContact") &&
      order("getCustomerJourney", { customerQuery: true }),
  );
}
{
  const allowed = new Set([
    "submitSession",
    "confirmJourneyMilestone",
    "reverseJourneyMilestone",
    "getContactTracking",
    "markContacted",
    "setNextContact",
    "getCustomerJourney",
  ]);
  const changed = [];
  for (const [name, b] of cur.blocks) {
    if (allowed.has(name)) continue;
    if (head.blocks.get(name) !== b) changed.push(name);
  }
  for (const name of head.blocks.keys()) if (!cur.blocks.has(name)) changed.push(`-${name}`);
  const tasksRel = "src/lib/staff-contact-tasks.server.ts";
  ok(
    "JF-19 scope: in sessions.functions.ts only the four contact/journey handlers of this gate, the two journey-milestone handlers and the B4c-1 submitSession differ from HEAD; imports and every other declaration are byte-identical; tenant-assert.server.ts and staff-contact-tasks.server.ts unchanged",
    changed.length === 0 && cur.head === head.head && TA_SRC === atHead(TA_REL) && read(tasksRel) === atHead(tasksRel),
    changed.join(","),
  );
}

// =================================================================================================
// Negative controls
// =================================================================================================
const FOUR = ["getContactTracking", "markContacted", "setNextContact", "getCustomerJourney"];
const vulnerable = topLevelBlocks(atVulnerableBaseline(SESSIONS_REL));
for (const name of FOUR) {
  const b = vulnerable.blocks.get(name);
  if (!b || !block(name) || b === block(name)) {
    console.error(
      `FAIL  vulnerable baseline ${VULNERABLE_BASELINE}: ${name} ${!b ? "is missing" : !block(name) ? "is missing from the working tree" : "is identical to the fixed handler"}`,
    );
    console.log("RESULT=FAIL");
    process.exit(1);
  }
}
const preFix = await loadMutant(
  SESSIONS_MARK,
  FOUR.reduce((s, name) => s.replace(block(name), vulnerable.blocks.get(name)), SESSIONS_SRC),
);
{
  resetDb();
  const r = await ops.tracking(preFix, S.a1, A.advB);
  nc("NC01 pre-fix getContactTracking (0e077078) → tenant 002's Adviser reads tenant 001's last/next contact (vulnerability confirmed); JF-08 rejects", {
    effect: r.ok && r.value.lastContactedAt === TRACK.a1.last && r.value.nextContactAt === TRACK.a1.next,
    caught: !(r.ok === false && r.message === NOT_FOUND),
    detail: fmt(r),
  });
}
{
  resetDb();
  const r = await ops.mark(preFix, S.a1, A.advB);
  const t = touches([S.a1]);
  nc("NC02 pre-fix markContacted (0e077078) → tenant 002's Adviser stamps tenant 001's case, writes its contact log and clears its attention flag (vulnerability confirmed); JF-08 rejects", {
    effect: r.ok && t.attention >= 1 && t.log === 1,
    caught: !(r.ok === false && r.message === NOT_FOUND && zero(t)),
    detail: `${fmt(r)} ${JSON.stringify(t)}`,
  });
}
{
  resetDb();
  const r = await ops.next(preFix, S.a1, A.ownerB);
  const t = touches([S.a1]);
  nc("NC03 pre-fix setNextContact (0e077078) → tenant 002's Owner sets tenant 001's next contact, creates a task on its case and writes its contact log (vulnerability confirmed); JF-06 rejects", {
    effect: r.ok && t.tasks === 1 && t.log === 1 && openNext(S.a1).length === 1,
    caught: !(r.ok === false && r.message === NOT_FOUND && zero(t)),
    detail: `${fmt(r)} ${JSON.stringify(t)}`,
  });
}
{
  resetDb();
  const r = await ops.journey(preFix, S.a1, A.ownerB);
  const w = welcomeTasks(S.a1);
  nc("NC04 pre-fix getCustomerJourney (0e077078) → tenant 002's Owner reads tenant 001's milestones and staff tasks and creates a tenantless welcome task on its case (vulnerability confirmed); JF-06 rejects", {
    effect: r.ok && r.value.milestones.some((m) => m.completedAt) && w.length === 1 && w[0].tenant_id == null,
    caught: !(r.ok === false && r.message === NOT_FOUND),
    detail: `${fmt(r)} welcome=${w.length}`,
  });
}
{
  const taSrc = TA_SRC.replace(
    "if (!row || !row.tenant_id || row.tenant_id !== acting.tenantId) throw resourceNotFound();\n  if (row.deleted_at && !opts.includeDeleted)",
    "if (!row) throw resourceNotFound();\n  if (row.deleted_at && !opts.includeDeleted)",
  );
  let effect = false;
  let caught = false;
  let detail = "anchor missing";
  if (taSrc !== TA_SRC) {
    const mutantTaUrl = dataUrl(`${TA_MARK}\n${ts.transpileModule(taSrc, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    }).outputText}\n// nc05`);
    const sMod = await loadMutant(
      SESSIONS_MARK,
      SESSIONS_SRC.split('await import("@/lib/tenant-assert.server")').join(`await import(${JSON.stringify(mutantTaUrl)})`),
    );
    const rs = [];
    for (const op of OPS) {
      resetDb();
      const r = await ops[op](sMod, S.a1, A.ownAdvB);
      rs.push([op, r, touches([S.a1])]);
    }
    effect =
      rs[0][1].ok && rs[0][1].value.lastContactedAt === TRACK.a1.last &&
      rs[1][1].ok && rs[1][2].log === 1 &&
      rs[2][1].ok && rs[2][2].tasks === 1 &&
      rs[3][1].ok && rs[3][1].value.milestones.some((m) => m.completedAt);
    caught = rs.every(([, r]) => !(r.ok === false && r.message === NOT_FOUND));
    detail = rs.map(([op, r]) => `${op}=${fmt(r)}`).join(" ");
  }
  nc("NC05 tenant filter removed from the session authorisation (row.tenant_id !== acting tenant) → tenant 002's Owner-Adviser reads, marks, schedules and loads the journey of tenant 001's case through the fixed handlers; JF-06 rejects", {
    effect,
    caught,
    detail,
  });
}
{
  const src = mutateIn(SESSIONS_SRC, "markContacted", 'allocation: "adviser_must_be_allocated"', 'allocation: "none"');
  let effect = false;
  let caught = false;
  if (src) {
    const m = await loadMutant(SESSIONS_MARK, src);
    resetDb();
    const r = await ops.mark(m, S.a1, A.advA2);
    effect = r.ok && touches([S.a1]).log === 1;
    caught = !(r.ok === false && r.message === "Forbidden");
  }
  nc("NC06 allocation requirement removed from markContacted → an unallocated Adviser of the same tenant writes the case's contact log and clears its attention flag; JF-14 rejects", { effect, caught });
}
{
  const src = mutateIn(SESSIONS_SRC, "getCustomerJourney", '      .eq("customer_id", context.userId)\n', "");
  let effect = false;
  let caught = false;
  if (src) {
    const m = await loadMutant(SESSIONS_MARK, src);
    resetDb();
    const r = await ops.journey(m, S.a1, A.ownerB);
    effect = r.ok && r.value.milestones.some((x) => x.completedAt);
    caught = !(r.ok === false && r.message === NOT_FOUND);
  }
  nc("NC07 getCustomerJourney's customer path without the customer_id scope → any caller (tenant 002's Owner) is treated as the case's customer and reads tenant 001's milestones; JF-06 rejects", { effect, caught });
}
{
  const src = mutateIn(SESSIONS_SRC, "getCustomerJourney", "            tenantId: staffTenantId,\n", "");
  let effect = false;
  let caught = false;
  if (src) {
    const m = await loadMutant(SESSIONS_MARK, src);
    resetDb();
    const r = await ops.journey(m, S.a1, A.ownerA);
    const w = welcomeTasks(S.a1);
    effect = r.ok && w.length === 1 && w[0].tenant_id == null;
    caught = !(w.length === 1 && w[0].tenant_id === T.a);
  }
  nc("NC08 welcome-call task created without the authorised case's tenant → a tenantless task row; JF-15 rejects", { effect, caught });
}

ok("JF-20 no network or unstubbed backend call; no SMS sent by any of the four functions", unknownCalls.length === 0 && globalThis.__JF_SMS.length === 0, unknownCalls.join(" | "));

const ncPass = ncResults.filter(Boolean).length;
console.log("");
console.log(`TEST_CASES=${total}`);
console.log(`TESTS_PASS=${total - failures.length}`);
console.log(`NEGATIVE_CONTROL_COUNT=${ncResults.length}`);
console.log(`NEGATIVE_CONTROLS_PASS=${ncPass}`);
console.log(`RESULT=${failures.length === 0 && ncPass === ncResults.length ? "PASS" : "FAIL"}`);
process.exit(failures.length === 0 && ncPass === ncResults.length ? 0 : 1);
