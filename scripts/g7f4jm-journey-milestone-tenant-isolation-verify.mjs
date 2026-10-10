/**
 * G7F-4 Journey Milestone Tenant Isolation — offline verification.
 *
 * The real confirmJourneyMilestone / reverseJourneyMilestone validators and handlers (and the real
 * tenant role, acting tenant and resource authorisation modules) run against an in-memory
 * PostgREST fake on a non-routable host. Each call carries its own request (Referer = verified
 * /$tenantSlug route) through AsyncLocalStorage, so concurrent calls keep separate tenant contexts.
 * The journey SMS is replaced by an in-process recorder; no message is ever sent.
 *
 * Negative controls load in-memory mutants (the pre-fix handlers from the vulnerable baseline
 * commit, and the fixed handlers with one protection removed) and show the unsafe effect happening
 * and the matching test predicate rejecting it.
 *
 * Synthetic fixtures only: no database, no network, no staging, no production, no phone numbers.
 * Run: npm exec --yes --package=tsx -- tsx scripts/g7f4jm-journey-milestone-tenant-isolation-verify.mjs
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
export function getRequest() { return globalThis.__JM_ALS?.getStore()?.request ?? null; }
export function getCookie() { return undefined; }
export function setCookie() {}
export function deleteCookie() {}
`;
const stubPlatform = `
export async function validatePlatformTenantAccessSession(input) {
  return globalThis.__JM_PLATFORM?.get(input.userId + ":" + input.tenantId) ?? null;
}
export async function hasValidPlatformTenantAccess() { return false; }
export async function clearPlatformTenantEntryOnLogout() {}
`;
const stubSms = `
export * from ${JSON.stringify(fileUrl("src/lib/sms.server.ts"))};
export async function sendSms() { throw new Error("SMS refused in verifier"); }
export async function sendInterviewCompleteSms() {}
export async function sendJourneyMilestoneSms(customerId, sessionId, milestoneKey) {
  globalThis.__JM_SMS.push({ customerId, sessionId, milestoneKey });
}
`;
const SESSIONS_MARK = "/*jm-mutant:sessions*/";
const TA_MARK = "/*jm-mutant:tenant-assert*/";
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
const FAKE_HOST = "g7f4jm.invalid";
process.env.SUPABASE_URL = `http://${FAKE_HOST}`;
process.env.VITE_SUPABASE_URL = `http://${FAKE_HOST}`;
process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_secret_g7f4jm_not_a_real_key";
process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_g7f4jm_not_a_real_key";
process.env.VITE_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_g7f4jm_not_a_real_key";

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

let db;
const writes = [];
const unknownCalls = [];
globalThis.__JM_SMS = [];
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
      { id: T.a, slug: "tenant-a", company_name: "Tenant A", status: "active", tenant_type: "firm", company_code: "901" },
      { id: T.b, slug: "tenant-b", company_name: "Tenant B", status: "active", tenant_type: "firm", company_code: "902" },
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
    session_contact_tracking: [],
    advisor_contact_views: [],
  };
  writes.length = 0;
  unknownCalls.length = 0;
  globalThis.__JM_SMS.length = 0;
}

globalThis.__JM_PLATFORM = new Map([
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
    throw new Error(`G7F4JM fetch stub refused host ${url.hostname}`);
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
globalThis.__JM_ALS = new AsyncLocalStorage();
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
  return globalThis.__JM_ALS.run({ request }, () =>
    outcome(() =>
      invoke(mod, name, data, {
        userId: actor.userId,
        claims: { sub: actor.userId, email: `${actor.userId}@example.test` },
        supabase: null,
      }),
    ),
  );
}
const confirm = (mod, sid, actor, key = "aip_completed", extra = {}) =>
  call(mod, "confirmJourneyMilestone", { sessionId: sid, milestoneKey: key, ...extra }, actor);
const reverse = (mod, sid, actor, key = "id_confirmed", extra = {}) =>
  call(mod, "reverseJourneyMilestone", { sessionId: sid, milestoneKey: key, ...extra }, actor);

const A = {
  ownerA: as(U.ownerA, "tenant-a"),
  supA: as(U.supA, "tenant-a"),
  advA: as(U.advA, "tenant-a"),
  advA2: as(U.advA2, "tenant-a"),
  advAppt: as(U.advAppt, "tenant-a"),
  genJ: as(U.genJ, "tenant-a"),
  genN: as(U.genN, "tenant-a"),
  introA: as(U.introA, "tenant-a"),
  custA: as(U.custA, "tenant-a"),
  ownerB: as(U.ownerB, "tenant-b"),
  supB: as(U.supB, "tenant-b"),
  advB: as(U.advB, "tenant-b"),
  dualA: as(U.dual, "tenant-a"),
  dualB: as(U.dual, "tenant-b"),
  dualNone: as(U.dual, null),
  platRO: as(U.platRO, "tenant-a"),
  platOp: as(U.platOp, "tenant-a"),
  outsider: as(U.outsider, null),
  ownerBForgedA: as(U.ownerB, "tenant-a"),
};

/** Every row a milestone call could touch, keyed for a byte comparison. */
function effectState() {
  const pick = (table) => JSON.stringify([...(db[table] ?? [])].map((r) => JSON.stringify(r)).sort());
  return [
    pick("customer_journey_milestones"),
    pick("customer_contact_log"),
    pick("session_contact_tracking"),
    pick("advisor_contact_views"),
    pick("interview_sessions"),
    pick("session_advisors"),
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
  sms: globalThis.__JM_SMS.filter((m) => sids.includes(m.sessionId)).length,
});
const zero = (t) => t.milestones === 0 && t.log === 0 && t.attention === 0 && t.views === 0 && t.sms === 0;
const leakFree = (r) =>
  !r.ok &&
  !["tenant-a", "tenant-b", "Tenant A", "Tenant B", T.a, T.b, U.custA, U.custB, S.a1, S.b1].some((s) =>
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
    clean: !r.ok && effectState() === before && writes.length === 0 && globalThis.__JM_SMS.length === 0,
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

// =================================================================================================
// Same-tenant authorised behaviour
// =================================================================================================
{
  resetDb();
  const r = await confirm(sf, S.a1, A.ownerA, "aip_completed");
  const m = db.customer_journey_milestones.find((x) => x.session_id === S.a1 && x.milestone_key === "aip_completed");
  const log = db.customer_contact_log.filter((x) => x.session_id === S.a1);
  const track = db.session_contact_tracking.find((x) => x.session_id === S.a1);
  const sms = globalThis.__JM_SMS;
  ok(
    "JM-01 same-tenant Owner confirms a milestone: milestone row, one contact-log entry, attention cleared and one SMS, all on that session only",
    r.ok && m?.completed_by === U.ownerA && log.length === 1 && log[0].author_id === U.ownerA &&
      log[0].entry_type === "journey_milestone" && track?.session_attention_cleared_at &&
      sms.length === 1 && sms[0].sessionId === S.a1 && sms[0].customerId === U.custA &&
      writes.every((w) => w.table === "advisor_contact_views" || sessionOf(w) === S.a1),
    `${fmt(r)} log=${log.length} sms=${sms.length}`,
  );
}
{
  const outs = [];
  for (const [actor, sid] of [
    [A.supA, S.a1],
    [A.advA, S.a1],
    [A.advAppt, S.a2],
    [A.genJ, S.a1],
    [A.genN, S.a1],
    [A.dualA, S.a1],
    [A.platOp, S.a1],
  ]) {
    resetDb();
    const r = await confirm(sf, sid, actor);
    outs.push(r.ok && db.customer_journey_milestones.some((x) => x.session_id === sid && x.milestone_key === "aip_completed") &&
      globalThis.__JM_SMS.length === 1);
  }
  ok(
    "JM-02 existing confirm authority preserved in the acting tenant: Supervisor, allocated Adviser (session_advisors and appointment), General Admin (main admin), dual-member Owner acting in A and platform operational entry into A",
    outs.every(Boolean),
    outs.join(","),
  );
}
{
  const outs = [];
  for (const actor of [A.ownerA, A.supA, A.genJ, A.dualA, A.platOp]) {
    resetDb();
    const r = await reverse(sf, S.a1, actor);
    const gone = !db.customer_journey_milestones.some((x) => x.session_id === S.a1 && x.milestone_key === "id_confirmed");
    const log = db.customer_contact_log.filter((x) => x.session_id === S.a1 && /reversed/.test(x.body ?? ""));
    outs.push(r.ok && gone && log.length === 1 && db.customer_journey_milestones.some((x) => x.session_id === S.b1) &&
      globalThis.__JM_SMS.length === 0);
  }
  ok(
    "JM-03 same-tenant reversal by Owner, Supervisor, General Admin with journey amend, dual Owner acting in A and platform operational entry: only that session's milestone is removed and one log entry written",
    outs.every(Boolean),
    outs.join(","),
  );
}
{
  const outs = [];
  for (const actor of [A.advA, A.genN, A.introA, A.custA]) {
    const { r, clean } = await refusedWithoutEffect(() => reverse(sf, S.a1, actor));
    outs.push(clean && r.message === "Only an admin can reverse journey milestones.");
  }
  ok(
    "JM-04 reversal stays admin-only: Adviser, General Admin without journey amend, Introducer and Customer refused with the existing message and no effect",
    outs.every(Boolean),
    outs.join(","),
  );
}

// =================================================================================================
// Cross-tenant refusal
// =================================================================================================
const crossCases = [
  ["Owner", A.ownerB],
  ["Supervisor", A.supB],
  ["Adviser (with a stale cross-tenant allocation row)", A.advB],
  ["dual-member Owner acting in tenant B", A.dualB],
];
for (const [i, [label, actor]] of crossCases.entries()) {
  const c = await refusedWithoutEffect(() => confirm(sf, S.a1, actor));
  const rv = await refusedWithoutEffect(() => reverse(sf, S.a1, actor));
  // An Adviser has no reversal role in any tenant, so its refusal is the role message.
  const rvExpected = actor === A.advB ? "Only an admin can reverse journey milestones." : NOT_FOUND;
  ok(
    `JM-${String(5 + i).padStart(2, "0")} cross-tenant ${label}: confirm and reverse on tenant A's case refused with no milestone, contact-log, attention-flag or SMS effect`,
    c.clean && c.r.message === NOT_FOUND && leakFree(c.r) && rv.clean && rv.r.message === rvExpected && leakFree(rv.r),
    `${fmt(c.r)} | ${fmt(rv.r)}`,
  );
}
{
  // Tenant B's own staff keep working on tenant B's case.
  resetDb();
  const c = await confirm(sf, S.b1, A.ownerB);
  const rv = await reverse(sf, S.b1, A.supB);
  const advB = await confirm(sf, S.b1, A.advB, "appointment_seen");
  ok(
    "JM-09 tenant B's Owner, Supervisor and allocated Adviser still act on tenant B's own case, and nothing touches tenant A",
    c.ok && rv.ok && advB.ok && zero(touches([S.a1, S.a2, S.aDel])) &&
      globalThis.__JM_SMS.every((m) => m.sessionId === S.b1),
    `${fmt(c)} | ${fmt(rv)} | ${fmt(advB)}`,
  );
}

// =================================================================================================
// Unknown, tenantless, binned and forged context
// =================================================================================================
{
  const outs = [];
  for (const sid of [RANDOM, S.b1, S.nul, S.aDel]) {
    const c = await refusedWithoutEffect(() => confirm(sf, sid, A.ownerA));
    const rv = await refusedWithoutEffect(() => reverse(sf, sid, A.ownerA));
    outs.push([c.clean && rv.clean, c.r.message, rv.r.message]);
  }
  ok(
    "JM-10 unknown, foreign, tenantless and binned cases are indistinguishable: identical \"Not found.\" for confirm and reverse, no effect",
    outs.every(([clean, a, b]) => clean && a === NOT_FOUND && b === NOT_FOUND),
    outs.map((o) => `${o[0]}:${o[1]}/${o[2]}`).join(" "),
  );
}
{
  const forged = [
    ["Referer slug of tenant A (not a member)", () => confirm(sf, S.a1, A.ownerBForgedA)],
    ["Referer slug of tenant A (not a member), reverse", () => reverse(sf, S.a1, A.ownerBForgedA)],
    ["body tenantId/tenantSlug of tenant A", () =>
      confirm(sf, S.a1, A.ownerB, "aip_completed", { tenantId: T.a, tenantSlug: "tenant-a", customerId: U.custA })],
    ["body tenantId/tenantSlug of tenant A, reverse", () =>
      reverse(sf, S.a1, A.ownerB, "id_confirmed", { tenantId: T.a, tenantSlug: "tenant-a" })],
    ["dual member without a verified tenant context", () => confirm(sf, S.a1, A.dualNone)],
    ["no membership at all", () => confirm(sf, S.a1, A.outsider)],
  ];
  const outs = [];
  for (const [label, run] of forged) {
    const { r, clean } = await refusedWithoutEffect(run);
    outs.push([label, clean && leakFree(r), r.message]);
  }
  ok(
    "JM-11 forged tenant context refused: a foreign Referer slug, caller-supplied tenantId/tenantSlug/customerId in the body (stripped by the validator) and an unverified or absent context never reach tenant A's case",
    outs.every((o) => o[1]),
    outs.map((o) => `${o[1]}:${o[2]}`).join(" | "),
  );
}
{
  const unalloc = await refusedWithoutEffect(() => confirm(sf, S.a1, A.advA2));
  const wrongSession = await refusedWithoutEffect(() => confirm(sf, S.a2, A.advA));
  ok(
    "JM-12 adviser allocation enforced (existing staff-customer policy): an Adviser of the same tenant who is not allocated to the case (no session_advisors row or appointment) is refused with no effect",
    unalloc.clean && unalloc.r.message === "Forbidden" && wrongSession.clean && wrongSession.r.message === "Forbidden",
    `${fmt(unalloc.r)} | ${fmt(wrongSession.r)}`,
  );
}
{
  const outs = [];
  for (const run of [
    () => confirm(sf, S.a1, A.platRO),
    () => reverse(sf, S.a1, A.platRO),
    () => confirm(sf, S.b1, A.platOp),
    () => reverse(sf, S.b1, A.platOp),
    () => confirm(sf, S.a1, A.introA),
    () => confirm(sf, S.a1, A.custA),
  ]) {
    const { r, clean } = await refusedWithoutEffect(run);
    outs.push([clean, r.message]);
  }
  ok(
    "JM-13 no new platform privilege: read-only platform entry cannot confirm or reverse; operational entry into tenant A cannot reach tenant B's case; Introducer and Customer cannot confirm",
    outs.every((o) => o[0]) && outs[2][1] === NOT_FOUND && outs[3][1] === NOT_FOUND,
    outs.map((o) => `${o[0]}:${o[1]}`).join(" | "),
  );
}

// =================================================================================================
// Concurrency
// =================================================================================================
{
  resetDb();
  jitter = true;
  const plan = [];
  for (let i = 0; i < 6; i += 1) {
    plan.push(["legitA", () => confirm(sf, S.a1, A.ownerA, ["appointment_seen", "aip_completed"][i % 2])]);
    plan.push(["attack", () => confirm(sf, S.a1, A.ownerB)]);
    plan.push(["attack", () => reverse(sf, S.a1, A.supB)]);
    plan.push(["attack", () => confirm(sf, S.a1, A.advB)]);
    plan.push(["attack", () => confirm(sf, S.a1, A.dualB)]);
    plan.push(["legitB", () => confirm(sf, S.b1, A.ownerB, "aip_completed")]);
    plan.push(["attack", () => confirm(sf, S.b1, A.ownerA)]);
  }
  const results = await Promise.all(plan.map(([kind, run]) => run().then((r) => [kind, r])));
  jitter = false;
  const A_ACTORS = new Set([U.ownerA]);
  const B_ACTORS = new Set([U.ownerB]);
  const actorOf = (w) => w.row.completed_by ?? w.row.author_id ?? w.row.updated_by ?? w.row.advisor_id;
  const crossWrites = writes.filter((w) => {
    const sid = sessionOf(w);
    const who = actorOf(w);
    if (sid === S.a1) return !A_ACTORS.has(who);
    if (sid === S.b1) return !B_ACTORS.has(who);
    return w.table !== "advisor_contact_views";
  });
  const legitA = results.filter(([k]) => k === "legitA");
  const legitB = results.filter(([k]) => k === "legitB");
  const attacks = results.filter(([k]) => k === "attack");
  const aMilestones = db.customer_journey_milestones.filter((m) => m.session_id === S.a1);
  ok(
    "JM-14 concurrent interleaved calls (per-request tenant contexts, jittered I/O): every cross-tenant attempt refused, every legitimate call applied; no write to a case by another tenant's actor; one milestone row per key (upsert); SMS only for authorised confirmations",
    attacks.every(([, r]) => !r.ok) && legitA.every(([, r]) => r.ok) && legitB.every(([, r]) => r.ok) &&
      crossWrites.length === 0 &&
      aMilestones.filter((m) => m.milestone_key === "aip_completed").length === 1 &&
      aMilestones.filter((m) => m.milestone_key === "appointment_seen").length === 1 &&
      globalThis.__JM_SMS.filter((m) => m.sessionId === S.a1).length === legitA.length &&
      globalThis.__JM_SMS.filter((m) => m.sessionId === S.b1).length === legitB.length,
    `attacks=${attacks.length} refused=${attacks.filter(([, r]) => !r.ok).length} legit=${legitA.length + legitB.length} crossWrites=${crossWrites.length} sms=${globalThis.__JM_SMS.length}`,
  );
}

// =================================================================================================
// Static boundary and scope
// =================================================================================================
{
  const order = (name) => {
    const b = block(name);
    const auth = b.indexOf("authoriseTenantResource(");
    const firstEffect = Math.min(
      ...["supabaseAdmin\n", ".from(", "appendContactLog(", "clearSessionAttention(", "sendJourneyMilestoneSms("]
        .map((s) => b.indexOf(s))
        .filter((x) => x >= 0),
    );
    return auth > 0 && auth < firstEffect && !/getRolesForUser|resolveAdminAccess/.test(b);
  };
  ok(
    "JM-15 both handlers authorise the session in the verified acting tenant (authoriseTenantResource) before any service-role query, write or SMS; no unscoped role-only gate remains",
    order("confirmJourneyMilestone") && order("reverseJourneyMilestone"),
  );
}
{
  const allowed = new Set([
    "confirmJourneyMilestone",
    "reverseJourneyMilestone",
    "submitSession",
    // Journey Security Follow-up gate (verified by g7f4jf-contact-journey-tenant-isolation-verify.mjs).
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
  ok(
    "JM-16 scope: in sessions.functions.ts only the two milestone handlers differ from HEAD (plus the separately pending B4c-1 submitSession change and the four follow-up-gate handlers); imports and every other declaration are byte-identical; tenant-assert.server.ts unchanged",
    changed.length === 0 && cur.head === head.head && TA_SRC === atHead(TA_REL),
    changed.join(","),
  );
}

// =================================================================================================
// Negative controls
// =================================================================================================
const preFixSrc = (() => {
  const vulnerable = topLevelBlocks(atVulnerableBaseline(SESSIONS_REL));
  let s = SESSIONS_SRC;
  for (const name of ["confirmJourneyMilestone", "reverseJourneyMilestone"]) {
    const b = vulnerable.blocks.get(name);
    if (!b || !block(name) || b === block(name)) {
      console.error(
        `FAIL  vulnerable baseline ${VULNERABLE_BASELINE}: ${name} ${!b ? "is missing" : !block(name) ? "is missing from the working tree" : "is identical to the fixed handler"}`,
      );
      console.log("RESULT=FAIL");
      process.exit(1);
    }
    s = s.replace(block(name), b);
  }
  return s;
})();
const preFix = await loadMutant(SESSIONS_MARK, preFixSrc);
{
  resetDb();
  const r = await confirm(preFix, S.a1, A.ownerB);
  const t = touches([S.a1]);
  const effect = r.ok && t.milestones === 1 && t.log === 1 && t.attention === 1 && t.sms === 1;
  const caught = !(r.ok === false && r.message === NOT_FOUND && zero(t));
  nc("NC01 pre-fix confirmJourneyMilestone (0e077078) → tenant B's Owner confirms a milestone on tenant A's case, logs it, clears its attention flag and texts tenant A's customer (vulnerability confirmed); JM-05 rejects", {
    effect,
    caught,
    detail: `${fmt(r)} ${JSON.stringify(t)}`,
  });
}
{
  resetDb();
  const r = await reverse(preFix, S.a1, A.ownerB);
  const gone = !db.customer_journey_milestones.some((x) => x.session_id === S.a1 && x.milestone_key === "id_confirmed");
  const effect = r.ok && gone && touches([S.a1]).log === 1;
  nc("NC02 pre-fix reverseJourneyMilestone (0e077078) → tenant B's Owner deletes tenant A's milestone and writes to its contact log (vulnerability confirmed); JM-05 rejects", {
    effect,
    caught: !(r.ok === false && r.message === NOT_FOUND),
    detail: fmt(r),
  });
}
{
  resetDb();
  const advB = await confirm(preFix, S.a1, A.advB);
  const effect = advB.ok && touches([S.a1]).milestones === 1;
  nc("NC03 pre-fix confirm (0e077078) → tenant B's Adviser confirms on tenant A's case; JM-07 rejects", {
    effect,
    caught: !(advB.ok === false && advB.message === NOT_FOUND),
    detail: fmt(advB),
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
    // The fixed handlers import the tenant-assert mutant instead of the real module.
    const mutantTaUrl = dataUrl(`${TA_MARK}\n${ts.transpileModule(taSrc, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    }).outputText}\n// nc04`);
    const sMod = await loadMutant(
      SESSIONS_MARK,
      SESSIONS_SRC.split('await import("@/lib/tenant-assert.server")').join(`await import(${JSON.stringify(mutantTaUrl)})`)
        .split(`await import(\n      "@/lib/tenant-assert.server"\n    )`).join(`await import(${JSON.stringify(mutantTaUrl)})`),
    );
    resetDb();
    const c = await confirm(sMod, S.a1, A.ownerB);
    const cT = touches([S.a1]);
    resetDb();
    const rv = await reverse(sMod, S.a1, A.ownerB);
    const rvGone = !db.customer_journey_milestones.some((x) => x.session_id === S.a1 && x.milestone_key === "id_confirmed");
    effect = c.ok && cT.milestones === 1 && cT.sms === 1 && rv.ok && rvGone;
    caught = !(c.ok === false && c.message === NOT_FOUND) && !(rv.ok === false && rv.message === NOT_FOUND);
    detail = `${fmt(c)} | ${fmt(rv)}`;
  }
  nc("NC04 tenant filter removed from the session authorisation (row.tenant_id !== acting tenant) → tenant B's Owner confirms and reverses on tenant A's case through the fixed handlers; JM-05 rejects", {
    effect,
    caught,
    detail,
  });
}
{
  const src = mutateIn(SESSIONS_SRC, "confirmJourneyMilestone", 'allocation: "adviser_must_be_allocated"', 'allocation: "none"');
  let effect = false;
  let caught = false;
  if (src) {
    const m = await loadMutant(SESSIONS_MARK, src);
    resetDb();
    const r = await confirm(m, S.a1, A.advA2);
    effect = r.ok && touches([S.a1]).milestones === 1 && touches([S.a1]).sms === 1;
    caught = !(r.ok === false && r.message === "Forbidden");
  }
  nc("NC05 allocation requirement removed → an unallocated Adviser of the same tenant confirms a milestone and texts the customer; JM-12 rejects", { effect, caught });
}
{
  const src = mutateIn(
    SESSIONS_SRC,
    "confirmJourneyMilestone",
    "allow: (v) => v.isAdvisor || v.isMainAdmin,",
    "allow: () => true,",
  );
  let effect = false;
  let caught = false;
  if (src) {
    const m = await loadMutant(SESSIONS_MARK, src);
    resetDb();
    const r = await confirm(m, S.a1, A.introA);
    effect = r.ok && touches([S.a1]).milestones === 1 && touches([S.a1]).sms === 1;
    caught = !(r.ok === false);
  }
  nc("NC06 confirm role check removed → tenant A's Introducer confirms a milestone and texts the customer; JM-13 rejects", { effect, caught });
}
{
  const src = mutateIn(
    SESSIONS_SRC,
    "confirmJourneyMilestone",
    "const { row: session } = await authoriseTenantResource({",
    "const session = (await (await import(\"@/integrations/supabase/client.server\")).supabaseAdminUntyped.from(\"interview_sessions\").select(\"customer_id\").eq(\"id\", data.sessionId).maybeSingle()).data ?? { customer_id: null };\n    void ({",
  );
  let effect = false;
  let caught = false;
  if (src) {
    const m = await loadMutant(SESSIONS_MARK, src);
    resetDb();
    jitter = true;
    const rs = await Promise.all([confirm(m, S.a1, A.ownerB), confirm(m, S.a1, A.dualB), confirm(m, S.b1, A.ownerB)]);
    jitter = false;
    const cross = writes.filter((w) => sessionOf(w) === S.a1 && w.row.completed_by !== U.ownerA && w.row.author_id !== U.ownerA).length;
    effect = rs[0].ok && rs[1].ok && cross > 0;
    caught = !(rs[0].ok === false && rs[1].ok === false);
  }
  nc("NC07 session lookup by id only (no acting-tenant authorisation) under concurrency → interleaved tenant B calls write to tenant A's case; JM-14 rejects", { effect, caught });
}

ok("JM-17 no network or unstubbed backend call; SMS only through the in-process recorder", unknownCalls.length === 0, unknownCalls.join(" | "));

const ncPass = ncResults.filter(Boolean).length;
console.log("");
console.log(`TEST_CASES=${total}`);
console.log(`TESTS_PASS=${total - failures.length}`);
console.log(`NEGATIVE_CONTROL_COUNT=${ncResults.length}`);
console.log(`NEGATIVE_CONTROLS_PASS=${ncPass}`);
console.log(`RESULT=${failures.length === 0 && ncPass === ncResults.length ? "PASS" : "FAIL"}`);
process.exit(failures.length === 0 && ncPass === ncResults.length ? 0 : 1);
