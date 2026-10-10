/**
 * G7F-4 — Contact Task Security and Tenant Attribution: completeStaffContactTask authorisation and
 * the tenant of every new contact record, run on a real PostgreSQL server.
 *
 * A disposable local PostgreSQL 17 server (embedded-postgres) carries the B4b2 verifier's
 * staging-shaped base schema plus the staging shapes of the contact tables (read-only staging
 * catalogue inventory), legacy contact rows written before the guard (tenantless rows and a task
 * whose tenant contradicts its case), then the G7F-4 contact tenant attribution migration read
 * unchanged from the working tree. The real staff-contact-task, session and tenant-assert server
 * code runs unmodified through a fake PostgREST layer on a non-routable host.
 *
 * Negative controls remove one protection each (the HEAD handler, a handler mutant or a migration
 * mutant) and show the unsafe effect happening and the matching test predicate rejecting it.
 *
 * Synthetic fixtures only: no network, no staging, no production, no real user, phone or token.
 *
 * Dependencies: npm install --prefix /tmp/b4b2-conc embedded-postgres@17.6.0-beta.15 pg@8
 * Run: npm exec --yes --package=tsx -- tsx scripts/g7f4ct-contact-task-tenant-attribution-verify.mjs
 */
import { execFileSync } from "node:child_process";
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire, register } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

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
const read = (rel) => readFileSync(resolve(root, rel), "utf8");
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
  ncResults.push({ label, pass });
  if (pass) console.log(`PASS  ${label}`);
  else console.error(`FAIL  ${label} — effect=${Boolean(effect)} caught=${Boolean(caught)} ${detail}`);
}
async function outcome(fn) {
  try {
    return { ok: true, value: await fn() };
  } catch (e) {
    return { ok: false, error: e, message: String(e?.message ?? e), code: e?.code };
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CT_REL = "supabase/migrations/20261010120000_gate_g7f4_contact_tenant_attribution.sql";
const TASKS_FN_REL = "src/lib/staff-contact-tasks.functions.ts";
const TASKS_SERVER_REL = "src/lib/staff-contact-tasks.server.ts";
const TENANT_ASSERT_REL = "src/lib/tenant-assert.server.ts";
const PAGE_REL = "src/routes/_authenticated/sessions.$sessionId.tsx";
const B4B2_VERIFIER_REL = "scripts/g7f4s4c4b4b2-financial-posting-verify.mjs";
const atHead = (rel) =>
  execFileSync("git", ["show", `HEAD:${rel}`], { cwd: root, encoding: "utf8", maxBuffer: 1 << 26 });
const ctSql = read(CT_REL);

const BASE_SCHEMA = (() => {
  const src = read(B4B2_VERIFIER_REL);
  const tok = "const BASE_SCHEMA = `";
  const s0 = src.indexOf(tok) + tok.length;
  const text = src.slice(s0, src.indexOf("\n`;", s0));
  if (s0 < tok.length || text.includes("\\") || text.includes("${")) {
    throw new Error("B4b2 verifier BASE_SCHEMA is not a plain literal");
  }
  return text;
})();
const ROLES_SQL = "create role anon; create role authenticated; create role service_role bypassrls;";
if (!BASE_SCHEMA.trimStart().startsWith(ROLES_SQL)) throw new Error("BASE_SCHEMA role prelude changed");
const DB_SCHEMA = BASE_SCHEMA.replace(ROLES_SQL, "");
const sha256 = (s) => createHash("sha256").update(s, "utf8").digest("hex");


// --- module stubs (the task and session server functions run unmodified) --------------------
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
export function getRequest() { return globalThis.__B4C1_REQUEST ?? null; }
export function getCookie() { return undefined; }
export function setCookie() {}
export function deleteCookie() {}
`;
// Platform Enter Company: an active session is simulated per (user, tenant) via a global table.
const stubPlatform = `
export async function validatePlatformTenantAccessSession(input) {
  const p = (globalThis.__B4C1_PLATFORM ?? {})[input.userId];
  return p && p.tenantId === input.tenantId ? { accessLevel: p.level, basisLabel: "verifier" } : null;
}
export async function hasValidPlatformTenantAccess() { return false; }
export async function clearPlatformTenantEntryOnLogout() {}
`;
const stubSms = `
export * from ${JSON.stringify(fileUrl("src/lib/sms.server.ts"))};
export function isTwilioConfigured() { return true; }
export async function sendSms(input) {
  const outbox = (globalThis.__COV_SMS ??= []);
  outbox.push({ to: input.to, body: input.body });
  return { sid: "SMcoverage" + outbox.length };
}
export async function sendInterviewCompleteSms() {}
`;
const stubMfa = `
export * from ${JSON.stringify(fileUrl("src/lib/privileged-mfa.server.ts"))};
export async function requireFreshPrivilegedAuth() {}
export async function requirePlatformAal2() {}
`;
const stubOpenAi = `
export async function chatCompletion() { throw new Error("AI refused in verifier"); }
`;
const mutantMark = "/*g7f4ct-mutant:tasks*/";
const hookSource = `
const MUTANTS = ${JSON.stringify({ [dataUrl(mutantMark)]: fileUrl(TASKS_FN_REL) })};
const STUBS = {
  start: ${JSON.stringify(dataUrl(stubStart))},
  startServer: ${JSON.stringify(dataUrl(stubStartServer))},
  platform: ${JSON.stringify(dataUrl(stubPlatform))},
  sms: ${JSON.stringify(dataUrl(stubSms))},
  mfa: ${JSON.stringify(dataUrl(stubMfa))},
  openai: ${JSON.stringify(dataUrl(stubOpenAi))},
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
  if (/(^|\\/)privileged-mfa\\.server(\\.ts)?$/.test(specifier)) return { url: STUBS.mfa, shortCircuit: true };
  if (/(^|\\/)openai\\.server(\\.ts)?$/.test(specifier)) return { url: STUBS.openai, shortCircuit: true };
  return next(specifier, context);
}
`;
register(dataUrl(hookSource), import.meta.url);

// --- real PostgreSQL server ---------------------------------------------------------------------
const depDir = process.env.G7F4S4C4B4C1_PG_DIR || process.env.G7F4S4C4B4B2F1_PG_DIR || "/tmp/b4b2-conc";
let EmbeddedPostgres;
let pg;
try {
  const req = createRequire(join(depDir, "package.json"));
  ({ default: EmbeddedPostgres } = await import(pathToFileURL(req.resolve("embedded-postgres")).href));
  ({ default: pg } = await import(pathToFileURL(req.resolve("pg")).href));
} catch (e) {
  console.error(`FAIL  embedded-postgres / pg not found in ${depDir} (${e.message}). See header.`);
  process.exit(1);
}
pg.types.setTypeParser(20, Number);
pg.types.setTypeParser(1700, Number);
pg.types.setTypeParser(1082, (s) => s);

const DATA_DIR = mkdtempSync(join(tmpdir(), "g7f4ct-pg-"));
const PASSWORD = randomBytes(18).toString("hex");
const PORT = 57000 + Math.floor(Math.random() * 900);
const server = new EmbeddedPostgres({
  databaseDir: DATA_DIR,
  user: "postgres",
  password: PASSWORD,
  port: PORT,
  persistent: false,
  initdbFlags: ["--locale=C", "--encoding=UTF8"],
  onLog: () => {},
  onError: () => {},
});
let serverStarted = false;
async function shutdown() {
  if (serverStarted) {
    serverStarted = false;
    await server.stop().catch(() => {});
  }
  rmSync(DATA_DIR, { recursive: true, force: true });
}
const baseCfg = { host: "127.0.0.1", port: PORT, user: "postgres", password: PASSWORD };

// --- quiet logs ---------------------------------------------------------------------------------
const logs = [];
for (const level of ["log", "info", "warn", "error", "debug"]) {
  const orig = console[level].bind(console);
  console[level] = (...a) => {
    const line = a
      .map((x) => (x instanceof Error ? x.message : typeof x === "string" ? x : JSON.stringify(x)))
      .join(" ");
    if (level === "error" && line.startsWith("FAIL  ")) orig(...a);
    else if (level === "log" && (line.startsWith("PASS  ") || /^[A-Z_0-9]+=/.test(line))) orig(...a);
    else {
      logs.push(`[${level}] ${line}`);
      if (process.env.G7F4CT_DEBUG) orig(...a);
    }
  };
}

// --- fake PostgREST over a pool (each request: own connection + transaction) ---------------------
const FAKE_HOST = "g7f4ct.invalid";
const PUBLISHABLE = "sb_publishable_g7f4ct_not_a_real_key";
process.env.SUPABASE_URL = `http://${FAKE_HOST}`;
process.env.VITE_SUPABASE_URL = `http://${FAKE_HOST}`;
process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_secret_g7f4ct_not_a_real_key";
process.env.SUPABASE_PUBLISHABLE_KEY = PUBLISHABLE;
process.env.VITE_SUPABASE_PUBLISHABLE_KEY = PUBLISHABLE;
const USER_HEADER = "x-g7f4ct-user";
const IDENT = /^[a-z_][a-z0-9_]*$/;
const qi = (id) => {
  if (!IDENT.test(id)) throw new Error(`fake postgrest: bad identifier ${id}`);
  return `"${id}"`;
};
const json = (body, status = 200, headers = {}) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
const pgError = (e) =>
  json(
    { code: e.code ?? "XX000", message: e.message, details: e.detail ?? null, hint: null },
    e.code === "23505" ? 409 : e.code === "42501" ? 403 : e.code === "42P01" ? 404 : 400,
  );
const RESERVED = new Set(["select", "order", "limit", "offset", "on_conflict", "columns"]);
const unknownCalls = [];
const reqClient = new AsyncLocalStorage();
const rsql = async (text, args = []) => (await reqClient.getStore().query(text, args)).rows;
function selectList(raw) {
  if (!raw || raw === "*") return "*";
  return raw
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean)
    .map((c) => {
      if (c.includes("(")) throw new Error(`fake postgrest: embedded select unsupported (${c})`);
      return qi(c);
    })
    .join(", ");
}
function filterClause(key, raw, args) {
  let value = raw;
  let negate = false;
  if (value.startsWith("not.")) {
    negate = true;
    value = value.slice(4);
  }
  const dot = value.indexOf(".");
  const op = value.slice(0, dot);
  const v = value.slice(dot + 1);
  const col = qi(key);
  let clause;
  if (op === "eq") clause = `${col} = $${args.push(v)}`;
  else if (op === "neq") clause = `${col} <> $${args.push(v)}`;
  else if (op === "gt") clause = `${col} > $${args.push(v)}`;
  else if (op === "gte") clause = `${col} >= $${args.push(v)}`;
  else if (op === "lt") clause = `${col} < $${args.push(v)}`;
  else if (op === "lte") clause = `${col} <= $${args.push(v)}`;
  else if (op === "ilike") clause = `${col}::text ilike $${args.push(v.replace(/\*/g, "%"))}`;
  else if (op === "is") {
    if (!["null", "true", "false"].includes(v)) throw new Error(`fake postgrest: is.${v}`);
    clause = `${col} is ${v}`;
  } else if (op === "in") {
    const list = v
      .replace(/^\(|\)$/g, "")
      .split(",")
      .map((s) => s.trim().replace(/^"|"$/g, ""))
      .filter((s) => s !== "");
    clause = `${col}::text = any($${args.push(list)}::text[])`;
  } else throw new Error(`fake postgrest: unsupported filter ${key}=${raw}`);
  return negate ? `not (${clause})` : clause;
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
function whereClause(params, args) {
  const parts = [];
  for (const [key, raw] of params) {
    if (RESERVED.has(key)) continue;
    if (key === "or") {
      const ors = splitTopLevel(raw.replace(/^\(|\)$/g, "")).map((part) => {
        const dot = part.indexOf(".");
        return filterClause(part.slice(0, dot), part.slice(dot + 1), args);
      });
      parts.push(`(${ors.join(" or ")})`);
      continue;
    }
    parts.push(filterClause(key, raw, args));
  }
  return parts.length ? ` where ${parts.join(" and ")}` : "";
}
function orderClause(raw) {
  if (!raw) return "";
  return (
    " order by " +
    raw
      .split(",")
      .map((part) => {
        const [col, dir, nulls] = part.split(".");
        return `${qi(col)} ${dir === "desc" ? "desc" : "asc"}${
          nulls === "nullsfirst" ? " nulls first" : nulls === "nullslast" ? " nulls last" : ""
        }`;
      })
      .join(", ")
  );
}
const cellValue = (v) => (v !== null && typeof v === "object" ? JSON.stringify(v) : v);
async function restTable(method, table, url, headers, body) {
  const params = [...url.searchParams.entries()];
  const sp = url.searchParams;
  const args = [];
  const t = `public.${qi(table)}`;
  const accept = headers.get("accept") ?? "";
  const prefer = headers.get("prefer") ?? "";
  const wantObject = accept.startsWith("application/vnd.pgrst.object+json");
  const returning = prefer.includes("return=representation") ? ` returning ${selectList(sp.get("select"))}` : "";
  let rows;
  if (method === "GET" || method === "HEAD") {
    const where = whereClause(params, args);
    const limit = sp.get("limit") ? ` limit ${Number(sp.get("limit"))}` : "";
    const offset = sp.get("offset") ? ` offset ${Number(sp.get("offset"))}` : "";
    rows = await rsql(`select ${selectList(sp.get("select"))} from ${t}${where}${orderClause(sp.get("order"))}${limit}${offset}`, args);
    if (rest.holdGet && rest.holdGet.table === table) await sleep(rest.holdGet.ms);
  } else if (method === "PATCH") {
    const sets = Object.entries(body)
      .map(([c, v]) => `${qi(c)} = $${args.push(cellValue(v))}`)
      .join(", ");
    rows = await rsql(`update ${t} set ${sets}${whereClause(params, args)}${returning}`, args);
  } else if (method === "POST") {
    const list = Array.isArray(body) ? body : [body];
    const cols = [...new Set(list.flatMap((o) => Object.keys(o)))];
    const values = list
      .map((o) => `(${cols.map((c) => (c in o ? `$${args.push(cellValue(o[c]))}` : "default")).join(", ")})`)
      .join(", ");
    // PostgREST upsert: ON CONFLICT on the requested columns, updating exactly the payload columns.
    let conflict = "";
    const merge = prefer.includes("resolution=merge-duplicates");
    const ignore = prefer.includes("resolution=ignore-duplicates");
    if (merge || ignore) {
      const target = (sp.get("on_conflict") ?? "").split(",").map((c) => c.trim()).filter(Boolean);
      if (target.length === 0) throw new Error("fake postgrest: upsert without on_conflict");
      conflict = ignore
        ? ` on conflict (${target.map(qi).join(", ")}) do nothing`
        : ` on conflict (${target.map(qi).join(", ")}) do update set ${cols.map((c) => `${qi(c)} = excluded.${qi(c)}`).join(", ")}`;
    }
    rows = await rsql(`insert into ${t} (${cols.map(qi).join(", ")}) values ${values}${conflict}${returning}`, args);
  } else if (method === "DELETE") {
    rows = await rsql(`delete from ${t}${whereClause(params, args)}${returning}`, args);
  } else {
    throw new Error(`fake postgrest: method ${method} not served`);
  }
  if (wantObject) {
    if (rows.length !== 1) {
      return json(
        { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned", details: `${rows.length} rows`, hint: null },
        406,
      );
    }
    return json(rows[0]);
  }
  if (!returning && method !== "GET" && method !== "HEAD") return new Response(null, { status: 201 });
  return json(rows, 200, { "content-range": `0-${Math.max(rows.length - 1, 0)}/*` });
}
async function restRpc(fn, body) {
  const keys = Object.keys(body ?? {});
  const args = keys.map((k) => cellValue(body[k]));
  const call = `public.${qi(fn)}(${keys.map((k, i) => `${qi(k)} => $${i + 1}`).join(", ")})`;
  const rows = await rsql(`select ${call} as r`, args);
  return json(rows[0]?.r ?? null);
}
let served = null;
const rest = { holdGet: null };
async function handle(input, init) {
  const url = new URL(typeof input === "string" ? input : (input.url ?? String(input)));
  if (url.hostname !== FAKE_HOST) {
    unknownCalls.push(`refused host ${url.hostname}`);
    throw new Error(`verifier fetch stub refused host ${url.hostname}`);
  }
  const method = String(init.method || (typeof input === "object" && input.method) || "GET").toUpperCase();
  const headers = new Headers(init.headers || (typeof input === "object" ? input.headers : undefined));
  const rawBody = init.body ?? null;
  const body = rawBody ? JSON.parse(typeof rawBody === "string" ? rawBody : String(rawBody)) : null;
  const userId = headers.get(USER_HEADER);
  if (!url.pathname.startsWith("/rest/v1/")) {
    unknownCalls.push(`${method} ${url.pathname}`);
    return json({ message: "unexpected" }, 500);
  }
  const isRpc = url.pathname.startsWith("/rest/v1/rpc/");
  const name = isRpc ? url.pathname.slice("/rest/v1/rpc/".length) : url.pathname.slice("/rest/v1/".length);
  const c = await served.connect();
  try {
    await c.query("begin");
    if (userId) await c.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId]);
    await c.query(`set local role ${userId ? "authenticated" : "service_role"}`);
    const res = await reqClient.run(c, () => (isRpc ? restRpc(name, body) : restTable(method, name, url, headers, body)));
    await c.query("commit");
    return res;
  } catch (e) {
    await c.query("rollback").catch(() => {});
    if (e?.code) return pgError(e);
    unknownCalls.push(String(e?.message ?? e));
    return json({ code: "XX000", message: String(e?.message ?? e) }, 500);
  } finally {
    c.release();
  }
}
globalThis.fetch = (input, init = {}) => handle(input, init);
function useDb(ctx) {
  ctx.pool ??= new pg.Pool({ ...ctx.cfg, max: 12 });
  ctx.pool.on("error", () => {});
  served = ctx.pool;
}

// --- staging-shaped contact tables --------------------------------------------------------------
// Constraints, indexes and policies of the read-only staging catalogue inventory. The B4b2 base
// schema carries customer_contact_log, session_contact_tracking and advisor_contact_views as bare
// columns and has no staff_contact_tasks or phone_calls.
const CONTACT_STAGING_SQL = `
alter table public.customer_contact_log
  add constraint customer_contact_log_session_id_fkey foreign key (session_id) references public.interview_sessions(id) on delete cascade,
  add constraint customer_contact_log_author_id_fkey foreign key (author_id) references auth.users(id) on delete set null,
  add constraint customer_contact_log_tenant_id_fkey foreign key (tenant_id) references public.tenants(id),
  add constraint customer_contact_log_entry_type_check check ((entry_type = any (array['contact'::text, 'note'::text, 'next_contact_set'::text, 'appointment'::text, 'callback'::text, 'journey_milestone'::text, 'history_amend'::text, 'finance'::text])));
alter table public.session_contact_tracking
  add constraint session_contact_tracking_session_id_fkey foreign key (session_id) references public.interview_sessions(id) on delete cascade,
  add constraint session_contact_tracking_updated_by_fkey foreign key (updated_by) references auth.users(id) on delete set null,
  add constraint session_contact_tracking_tenant_id_fkey foreign key (tenant_id) references public.tenants(id);
alter table public.advisor_contact_views
  add constraint advisor_contact_views_advisor_id_fkey foreign key (advisor_id) references auth.users(id) on delete cascade,
  add constraint advisor_contact_views_contact_type_check check ((contact_type = any (array['appointment'::text, 'callback'::text, 'phone_call'::text, 'staff_task'::text, 'abandoned'::text]))),
  add constraint advisor_contact_views_tenant_id_fkey foreign key (tenant_id) references public.tenants(id);
create table public.staff_contact_tasks (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.interview_sessions(id) on delete cascade,
  task_type text not null constraint staff_contact_tasks_task_type_check check (task_type in ('welcome_call', 'next_contact')),
  due_at timestamptz not null,
  completed_at timestamptz,
  completed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  tenant_id uuid references public.tenants(id)
);
create index staff_contact_tasks_session_idx on public.staff_contact_tasks(session_id);
create unique index staff_contact_tasks_open_welcome_idx on public.staff_contact_tasks(session_id)
  where task_type = 'welcome_call' and completed_at is null;
create unique index staff_contact_tasks_open_next_idx on public.staff_contact_tasks(session_id)
  where task_type = 'next_contact' and completed_at is null;
create table public.phone_calls (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references public.interview_sessions(id) on delete cascade,
  advisor_id uuid references auth.users(id) on delete set null,
  to_number text not null,
  started_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  tenant_id uuid references public.tenants(id)
);
alter table public.customer_contact_log enable row level security;
alter table public.session_contact_tracking enable row level security;
alter table public.advisor_contact_views enable row level security;
alter table public.staff_contact_tasks enable row level security;
alter table public.phone_calls enable row level security;
create policy "Staff view tenant contact log" on public.customer_contact_log for select to authenticated
  using (public.auth_is_tenant_staff(tenant_id));
create policy "Staff view tenant contact tracking" on public.session_contact_tracking for select to authenticated
  using (public.auth_is_tenant_staff(tenant_id));
create policy "Advisors view own contact views" on public.advisor_contact_views for select to authenticated
  using ((advisor_id = auth.uid()) or public.auth_is_tenant_admin(tenant_id));
create policy staff_contact_tasks_service on public.staff_contact_tasks using (false) with check (false);
grant all on public.staff_contact_tasks, public.phone_calls to service_role;
grant select on public.staff_contact_tasks, public.phone_calls to authenticated;
`;

// --- fixtures -----------------------------------------------------------------------------------
const idProxy = () =>
  new Proxy({}, { get: (o, k) => (typeof k === "string" ? (o[k] ??= randomUUID()) : o[k]) });
const U = idProxy();
const S = idProxy();
const L = idProxy();
const T = { a: randomUUID(), b: randomUUID() };
const SLUG = { a: "tenant-a", b: "tenant-b" };
const LEGACY_AT = "2026-09-01T09:00:00.000Z";
const NOT_FOUND = "Not found.";
const FORBIDDEN = "Forbidden";
const DONE = "Task not found or already completed";

async function buildDb(name, { migrate = true, sql = ctSql, before = null } = {}) {
  const admin0 = new pg.Client({ ...baseCfg, database: "postgres" });
  await admin0.connect();
  await admin0.query(`create database ${name}`);
  await admin0.query(`alter database ${name} set timezone to 'UTC'`);
  await admin0.end();
  const cfg = { ...baseCfg, database: name };
  const connect = async () => {
    const c = new pg.Client(cfg);
    c.on("error", () => {});
    await c.connect();
    await c.query(`set statement_timeout = '30s'`);
    return c;
  };
  const admin = await connect();
  const q = async (text, params = []) => (await admin.query(text, params)).rows;
  const one = async (text, params = []) => (await q(text, params))[0] ?? null;
  await admin.query(DB_SCHEMA);
  await admin.query(CONTACT_STAGING_SQL);
  await q(
    `insert into public.tenants (id, company_code, slug, company_name, status) values
     ($1,'901','tenant-a','Tenant A Ltd','active'), ($2,'902','tenant-b','Tenant B Ltd','active')`,
    [T.a, T.b],
  );
  const addUser = async (key) => {
    const email = `${key.toLowerCase()}@example.test`;
    await q(`insert into auth.users (id, email, email_confirmed_at) values ($1, $2, now())`, [U[key], email]);
    await q(`insert into public.profiles (id, email, full_name) values ($1, $2, $3)`, [U[key], email, `${key} Person`]);
  };
  const addMember = (key, tenant, role) =>
    q(`insert into public.tenant_memberships (tenant_id, user_id, role) values ($1, $2, $3)`, [tenant, U[key], role]);
  for (const [key, ms] of [
    ["ownerA", [[T.a, "owner"]]],
    ["supA", [[T.a, "supervisor"]]],
    ["genA", [[T.a, "general"]]],
    ["advA", [[T.a, "adviser"]]],
    ["advA2", [[T.a, "adviser"]]],
    ["advAppt", [[T.a, "adviser"]]],
    ["introA", [[T.a, "introducer"]]],
    ["custA", [[T.a, "customer"]]],
    ["ownerB", [[T.b, "owner"]]],
    ["advB", [[T.b, "adviser"]]],
    ["custB", [[T.b, "customer"]]],
    ["superOwner", []],
  ]) {
    await addUser(key);
    for (const [t, r] of ms) await addMember(key, t, r);
  }
  await q(`insert into public.platform_roles (user_id, role) values ($1, 'super_owner')`, [U.superOwner]);
  for (const [key, code, t] of [["advA", "ADVA", T.a], ["advA2", "ADVA2", T.a], ["advAppt", "ADVAP", T.a], ["advB", "ADVB", T.b]]) {
    await q(`insert into public.advisor_profiles (user_id, code, tenant_id) values ($1,$2,$3)`, [U[key], code, t]);
  }

  // Legacy contact rows as written before the guard: tenantless rows on a tenant-A case and on a
  // tenantless case, and a task and a log entry whose tenant (A) contradicts their case (B).
  for (const [id, cust, tenant] of [[S.leg, "custA", T.a], [S.legTl, "custA", null], [S.forged, "custB", T.b]]) {
    await q(
      `insert into public.interview_sessions (id, customer_id, tenant_id, case_ref, status, created_at) values ($1,$2,$3,$4,'submitted',$5)`,
      [id, U[cust], tenant, `MG-LEG-${id.slice(0, 6)}`, LEGACY_AT],
    );
  }
  await q(
    `insert into public.customer_contact_log (id, session_id, author_id, entry_type, body, occurred_at, created_at, tenant_id) values
     ($1,$4,$7,'note','legacy note',$8,$8,null), ($2,$5,$7,'note','legacy tenantless-case note',$8,$8,null),
     ($3,$6,$7,'note','legacy contradictory note',$8,$8,$9)`,
    [L.logLeg, L.logLegTl, L.logForged, S.leg, S.legTl, S.forged, U.advA, LEGACY_AT, T.a],
  );
  await q(
    `insert into public.session_contact_tracking (session_id, last_contacted_at, updated_by, updated_at, session_attention_cleared_at, tenant_id) values
     ($1,$3,$4,$3,$3,null), ($2,$3,$4,$3,$3,null)`,
    [S.leg, S.legTl, LEGACY_AT, U.advA],
  );
  await q(
    `insert into public.staff_contact_tasks (id, session_id, task_type, due_at, created_at, tenant_id) values
     ($1,$4,'welcome_call',$7,$7,null), ($2,$5,'welcome_call',$7,$7,null), ($3,$6,'welcome_call',$7,$7,$8)`,
    [L.taskLeg, L.taskLegTl, L.taskForged, S.leg, S.legTl, S.forged, LEGACY_AT, T.a],
  );
  await q(
    `insert into public.appointments (id, advisor_id, session_id, customer_name, starts_at, tenant_id, created_at) values ($1,$2,$3,'Synthetic Customer',$4,$5,$4)`,
    [L.apptLeg, U.advA, S.leg, LEGACY_AT, T.a],
  );
  await q(
    `insert into public.advisor_contact_views (id, advisor_id, contact_type, contact_id, opened_at, tenant_id) values ($1,$2,'appointment',$3,$4,null)`,
    [L.viewLeg, U.advA, L.apptLeg, LEGACY_AT],
  );
  if (before) await before({ q, admin });

  const legacyRows = async () =>
    q(
      `select 'log:' || t.id k, to_jsonb(t)::text j from public.customer_contact_log t where t.id = any($1::uuid[])
       union all select 'trk:' || t.session_id, to_jsonb(t)::text from public.session_contact_tracking t where t.session_id = any($2::uuid[])
       union all select 'task:' || t.id, to_jsonb(t)::text from public.staff_contact_tasks t where t.id = any($3::uuid[])
       union all select 'view:' || t.id, to_jsonb(t)::text from public.advisor_contact_views t where t.id = any($4::uuid[])
       order by 1`,
      [[L.logLeg, L.logLegTl, L.logForged], [S.leg, S.legTl], [L.taskLeg, L.taskLegTl, L.taskForged], [L.viewLeg]],
    );
  const legacyBefore = await legacyRows();
  const migration = migrate ? await outcome(() => admin.query(sql)) : null;
  const ctx = { name, cfg, connect, admin, q, one, migration, legacyBefore, legacyRows, pool: null };

  /** One service-role transaction on its own connection. */
  ctx.svc = async (text, params = []) => {
    const k = await connect();
    try {
      await k.query("begin");
      await k.query("set local role service_role");
      const r = await k.query(text, params);
      await k.query("commit");
      return { ok: true, rows: r.rows, rowCount: r.rowCount };
    } catch (e) {
      await k.query("rollback").catch(() => {});
      return { ok: false, code: e.code, message: e.message };
    } finally {
      await k.end();
    }
  };
  /** One transaction as an authenticated API client. */
  ctx.asClient = async (user, text, params = []) => {
    const k = await connect();
    try {
      await k.query("begin");
      await k.query(`select set_config('request.jwt.claim.sub', $1, true)`, [user]);
      await k.query("set local role authenticated");
      const r = await k.query(text, params);
      await k.query("commit");
      return { ok: true, rows: r.rows };
    } catch (e) {
      await k.query("rollback").catch(() => {});
      return { ok: false, code: e.code, message: e.message };
    } finally {
      await k.end();
    }
  };
  ctx.newCase = async ({ tenant = T.a, customer = "custA", deleted = false, alloc = null, apptAdviser = null, callback = false } = {}) => {
    const id = randomUUID();
    await q(
      `insert into public.interview_sessions (id, customer_id, tenant_id, case_ref, status) values ($1,$2,$3,$4,'submitted')`,
      [id, U[customer], tenant, `MG-CT-${id.slice(0, 6)}`],
    );
    if (alloc) await q(`insert into public.session_advisors (session_id, advisor_id, tenant_id) values ($1,$2,$3)`, [id, U[alloc], tenant]);
    if (apptAdviser) {
      await q(
        `insert into public.appointments (advisor_id, session_id, customer_name, starts_at, tenant_id) values ($1,$2,'Synthetic Customer', now() + interval '1 day', $3)`,
        [U[apptAdviser], id, tenant],
      );
    }
    if (callback) {
      await q(
        `insert into public.callback_requests (session_id, customer_name, customer_phone, preferred_window, status, tenant_id) values ($1,'Synthetic Customer','SYNTH-PHONE','9-12','new',$2)`,
        [id, tenant],
      );
    }
    if (deleted) await q(`update public.interview_sessions set deleted_at = now() where id = $1`, [id]);
    return id;
  };
  /** A staff task written by the service role (through the guard once migrated). */
  ctx.newTask = async (sessionId, type = "welcome_call") => {
    const r = await ctx.svc(
      `insert into public.staff_contact_tasks (session_id, task_type, due_at) values ($1,$2, now() + interval '1 day') returning id`,
      [sessionId, type],
    );
    if (!r.ok) throw new Error(`task: ${r.message}`);
    return r.rows[0].id;
  };
  ctx.task = (id) => one(`select * from public.staff_contact_tasks where id = $1`, [id]);
  ctx.logs = (sessionId) =>
    q(`select * from public.customer_contact_log where session_id = $1 order by created_at, id`, [sessionId]);
  ctx.tracking = (sessionId) => one(`select * from public.session_contact_tracking where session_id = $1`, [sessionId]);
  ctx.views = (sessionId) =>
    q(
      `select v.* from public.advisor_contact_views v
        where (v.contact_type = 'appointment' and v.contact_id in (select id from public.appointments where session_id = $1))
           or (v.contact_type = 'callback' and v.contact_id in (select id from public.callback_requests where session_id = $1))`,
      [sessionId],
    );
  /** Every task, contact log, tracking and attention-marker row, byte for byte. */
  ctx.state = async () =>
    JSON.stringify(
      await q(
        `select 'task' k, to_jsonb(t)::text j from public.staff_contact_tasks t union all
         select 'log', to_jsonb(t)::text from public.customer_contact_log t union all
         select 'trk', to_jsonb(t)::text from public.session_contact_tracking t union all
         select 'view', to_jsonb(t)::text from public.advisor_contact_views t order by 1, 2`,
      ),
    );
  return ctx;
}

// --- modules under test -------------------------------------------------------------------------
const { createClient } = await import("@supabase/supabase-js");
const tf = await import("../src/lib/staff-contact-tasks.functions.ts");
const sf = await import("../src/lib/sessions.functions.ts");
const st = await import("../src/lib/staff-contact-tasks.server.ts");
const { supabaseAdminUntyped: svcClient } = await import("../src/integrations/supabase/client.server.ts");
const TASKS_FN_SRC = read(TASKS_FN_REL);
function mutate(src, pairs) {
  let out = src;
  for (const [from, to] of pairs) {
    if (!out.includes(from)) return null;
    out = out.split(from).join(to);
  }
  return out;
}
async function tasksModule(src) {
  if (!src) return null;
  const js = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return import(dataUrl(`${mutantMark}\n${js}\n// ${randomUUID()}`));
}
async function invoke(fn, data, actor, slug) {
  const d = fn.__def;
  const parsed = d.validator ? await d.validator(data) : data;
  globalThis.__B4C1_REQUEST = new Request("http://app.invalid/_serverFn/x", {
    headers: { referer: `http://app.invalid/${slug}/admin` },
  });
  const supabase = createClient(`http://${FAKE_HOST}`, PUBLISHABLE, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { [USER_HEADER]: actor } },
  });
  return d.handler({ data: parsed, context: { userId: actor, claims: { sub: actor, email: null }, supabase } });
}
const call = (fn, data, actor, slug = SLUG.a) => outcome(() => invoke(fn, data, actor, slug));
const complete = (mod, taskId, actor, slug = SLUG.a) => call(mod.completeStaffContactTask, { taskId }, actor, slug);

// --- predicates (shared by tests and negative controls) -----------------------------------------
const refusals = [];
/** Runs a call and reports whether every task, log, tracking and marker row is untouched. */
async function quiet(ctx, fn) {
  const before = await ctx.state();
  const r = await fn();
  const x = { r, clean: (await ctx.state()) === before };
  if (!r.ok) refusals.push(x);
  return x;
}
const refusedClean = (x, msg) => !x.r.ok && (msg === undefined || x.r.message === msg) && x.clean;
const tenantOf = (row) => row?.tenant_id ?? null;

/** Tenantless case: every actor of either tenant gets "Not found." and nothing changes. */
async function tenantlessRefusal(ctx, mod, taskId) {
  const tries = [];
  for (const [actor, slug] of [[U.ownerA, SLUG.a], [U.supA, SLUG.a], [U.advA, SLUG.a], [U.ownerB, SLUG.b], [U.advB, SLUG.b]]) {
    tries.push(await quiet(ctx, () => complete(mod, taskId, actor, slug)));
  }
  const task = await ctx.task(taskId);
  return { tries, task, pass: tries.every((x) => refusedClean(x, NOT_FOUND)) && task.completed_at === null };
}
/** Unallocated adviser of the case's own tenant: "Forbidden", nothing changes. */
async function unallocatedRefusal(ctx, mod, taskId) {
  const x = await quiet(ctx, () => complete(mod, taskId, U.advA2));
  const task = await ctx.task(taskId);
  return { x, task, pass: refusedClean(x, FORBIDDEN) && task.completed_at === null };
}
/** A task whose tenant contradicts its case: refused in both tenants, nothing changes. */
async function forgedTaskRefusal(ctx, mod, taskId) {
  const tries = [
    await quiet(ctx, () => complete(mod, taskId, U.ownerA, SLUG.a)),
    await quiet(ctx, () => complete(mod, taskId, U.ownerB, SLUG.b)),
  ];
  const task = await ctx.task(taskId);
  return { tries, task, pass: tries.every((x) => refusedClean(x, NOT_FOUND)) && task.completed_at === null };
}
/** Binned case: refused for Owner, Supervisor and the allocated adviser, nothing changes. */
async function binnedRefusal(ctx, mod, taskId) {
  const tries = [];
  for (const actor of [U.ownerA, U.supA, U.advA]) tries.push(await quiet(ctx, () => complete(mod, taskId, actor)));
  const task = await ctx.task(taskId);
  return { tries, task, pass: tries.every((x) => refusedClean(x, NOT_FOUND)) && task.completed_at === null };
}
/** Platform Enter Company (operational or emergency, no membership): refused, nothing changes. */
async function platformRefusal(ctx, mod, taskId) {
  const tries = [];
  for (const level of ["operational_admin", "emergency"]) {
    globalThis.__B4C1_PLATFORM = { [U.superOwner]: { tenantId: T.a, level } };
    try {
      tries.push(await quiet(ctx, () => complete(mod, taskId, U.superOwner)));
    } finally {
      globalThis.__B4C1_PLATFORM = {};
    }
  }
  const task = await ctx.task(taskId);
  return { tries, task, pass: tries.every((x) => refusedClean(x, FORBIDDEN)) && task.completed_at === null };
}
/** Concurrent completions of one task, every request past authorisation before any update. */
async function raceCompletion(ctx, mod, taskId, sessionId) {
  const actors = [U.ownerA, U.supA, U.advA, U.genA, U.ownerA, U.advA];
  const logs0 = (await ctx.logs(sessionId)).length;
  rest.holdGet = { table: "staff_contact_tasks", ms: 250 };
  let res;
  try {
    res = await Promise.all(actors.map((a) => complete(mod, taskId, a)));
  } finally {
    rest.holdGet = null;
  }
  const oks = res.filter((r) => r.ok).length;
  const others = res.filter((r) => !r.ok);
  const winner = actors[res.findIndex((r) => r.ok)];
  const task = await ctx.task(taskId);
  const logs = (await ctx.logs(sessionId)).length - logs0;
  const trk = await q1(ctx, `select count(*)::int n from public.session_contact_tracking where session_id = $1`, [sessionId]);
  return {
    oks,
    logs,
    pass:
      oks === 1 && logs === 1 && others.every((r) => r.message === DONE) && task.completed_by === winner && trk.n === 1,
  };
}
const q1 = (ctx, text, params) => ctx.one(text, params);
/** After a completion: tracking and attention markers carry the case's tenant. */
async function attributionAfterCompletion(ctx, sessionId, tenant) {
  const trk = await ctx.tracking(sessionId);
  const views = await ctx.views(sessionId);
  const logs = await ctx.logs(sessionId);
  return {
    trk,
    views,
    pass:
      tenantOf(trk) === tenant && views.length > 0 && views.every((v) => tenantOf(v) === tenant) &&
      logs.length > 0 && logs.every((l) => tenantOf(l) === tenant),
  };
}
/** Cross-tenant parent/child writes by the service role: each refused, nothing changes. */
async function crossTenantWrites(ctx, { sB, sA, sTl, cbB, logA }) {
  const before = await ctx.state();
  const tries = {
    logForeign: await ctx.svc(`insert into public.customer_contact_log (session_id, entry_type, body, tenant_id) values ($1,'note','x',$2)`, [sB, T.a]),
    logTenantlessParent: await ctx.svc(`insert into public.customer_contact_log (session_id, entry_type, body, tenant_id) values ($1,'note','x',$2)`, [sTl, T.a]),
    trackingForeign: await ctx.svc(`insert into public.session_contact_tracking (session_id, tenant_id) values ($1,$2)`, [sB, T.a]),
    taskForeign: await ctx.svc(`insert into public.staff_contact_tasks (session_id, task_type, due_at, tenant_id) values ($1,'next_contact', now(), $2)`, [sB, T.a]),
    viewForeign: await ctx.svc(`insert into public.advisor_contact_views (advisor_id, contact_type, contact_id, tenant_id) values ($1,'callback',$2,$3)`, [U.advA, cbB, T.a]),
    viewUnknown: await ctx.svc(`insert into public.advisor_contact_views (advisor_id, contact_type, contact_id, tenant_id) values ($1,'appointment',$2,$3)`, [U.advA, randomUUID(), T.a]),
    reparentLog: await ctx.svc(`update public.customer_contact_log set session_id = $2 where id = $1`, [logA, sB]),
    retenantLog: await ctx.svc(`update public.customer_contact_log set tenant_id = $2 where id = $1`, [logA, T.b]),
    backfillLegacyLog: await ctx.svc(`update public.customer_contact_log set tenant_id = $2 where id = $1`, [L.logLeg, T.a]),
    reparentTask: await ctx.svc(`update public.staff_contact_tasks set session_id = $2 where session_id = $1`, [sA, sB]),
    upsertTrackingForeign: await ctx.svc(
      `insert into public.session_contact_tracking (session_id, tenant_id) values ($1,$2)
       on conflict (session_id) do update set tenant_id = excluded.tenant_id`,
      [sA, T.b],
    ),
  };
  const api = await svcClient.from("customer_contact_log").insert({ session_id: sB, entry_type: "note", body: "x", tenant_id: T.a });
  const refusedAll = Object.values(tries).every((r) => !r.ok && r.code === "42501") && Boolean(api.error);
  return { tries, api, pass: refusedAll && (await ctx.state()) === before };
}
/** Every legacy row except the listed keys is byte-identical to its pre-migration self. */
async function legacyUnchanged(ctx, except = []) {
  const now = await ctx.legacyRows();
  const pick = (rows) => JSON.stringify(rows.filter((r) => !except.includes(r.k)));
  return { pass: ctx.legacyBefore.length === 9 && pick(now) === pick(ctx.legacyBefore), count: ctx.legacyBefore.length };
}

// =============================================================================================
// RUN
// =============================================================================================
let exitCode = 1;
try {
  await server.initialise();
  await server.start();
  serverStarted = true;
  const ver = await (async () => {
    const c = new pg.Client({ ...baseCfg, database: "postgres" });
    await c.connect();
    await c.query(ROLES_SQL);
    const r = (await c.query(`select current_setting('server_version') v`)).rows[0].v;
    await c.end();
    return r;
  })();

  const db = await buildDb("ct_main");
  const triggers = await db.q(
    `select tgname from pg_trigger where not tgisinternal and tgenabled = 'O' and tgname like '%tenant_guard' order by 1`,
  );
  const dml = ctSql.match(/^\s*(update\s|insert\s+into\s|delete\s+from\s|alter\s+table\s|create\s+policy|drop\s)/gim) ?? [];
  ok(
    "CT-00 fixture: the contact tenant attribution migration (unchanged) applies over legacy tenantless and contradictory contact rows, installs the four guards, leaves every legacy row byte-identical and contains no data or policy statement",
    db.migration.ok &&
      triggers.length === 4 &&
      JSON.stringify(await db.legacyRows()) === JSON.stringify(db.legacyBefore) &&
      db.legacyBefore.length === 9 &&
      dml.length === 0,
    `PostgreSQL ${ver}; migration=${sha256(ctSql)} ${db.migration.message ?? ""} triggers=${triggers.length} dml=${dml.length}`,
  );
  if (!db.migration.ok) throw new Error("fixture database did not build");
  useDb(db);

  const s1 = await db.newCase({ alloc: "advA", apptAdviser: "advAppt", callback: true });
  const t1 = await db.newTask(s1);
  const sB = await db.newCase({ tenant: T.b, customer: "custB", alloc: "advB", callback: true });
  const tB = await db.newTask(sB);
  const sTl = await db.newCase({ tenant: null });
  const tTl = await db.newTask(sTl);
  const sBin = await db.newCase({ alloc: "advA", deleted: true, callback: true });
  const tBin = await db.newTask(sBin);

  // CT-01 cross-tenant completion
  {
    const tries = [];
    for (const actor of [U.ownerA, U.supA, U.genA, U.advA]) {
      for (const id of [tB, randomUUID()]) tries.push(await quiet(db, () => complete(tf, id, actor)));
    }
    ok(
      "CT-01 cross-tenant: tenant A's Owner, Supervisor, General Admin and Adviser completing tenant B's task get the same \"Not found.\" as for an unknown task id; tenant B's task, logs, tracking and markers are untouched",
      tries.every((x) => refusedClean(x, NOT_FOUND)) && (await db.task(tB)).completed_at === null,
      tries.map((x) => x.r.message ?? "ok").join("|"),
    );
  }

  // CT-02 tenantless case
  {
    const r = await tenantlessRefusal(db, tf, tTl);
    ok(
      "CT-02 tenantless case: no Owner, Supervisor or Adviser of either tenant can complete a task on a tenantless case (\"Not found.\"); the task stays open and tenantless (no ownership fabricated)",
      r.pass && r.task.tenant_id === null,
      r.tries.map((x) => x.r.message ?? "ok").join("|"),
    );
  }

  // CT-03 forged identity / tenant context
  {
    const slugForged = [
      await quiet(db, () => complete(tf, t1, U.ownerB, SLUG.a)),
      await quiet(db, () => complete(tf, t1, U.advB, SLUG.a)),
    ];
    const roles = [
      await quiet(db, () => complete(tf, t1, U.introA)),
      await quiet(db, () => complete(tf, t1, U.custA)),
    ];
    const forged = await forgedTaskRefusal(db, tf, L.taskForged);
    const platform = await platformRefusal(db, tf, t1);
    ok(
      "CT-03 forged context: tenant B staff presenting tenant A's slug, tenant A's Introducer and Customer, Platform Enter Company (operational and emergency, no membership) and a task whose tenant_id contradicts its case are all refused with nothing written",
      slugForged.every((x) => refusedClean(x)) &&
        roles.every((x) => refusedClean(x, FORBIDDEN)) &&
        forged.pass &&
        platform.pass &&
        (await db.task(t1)).completed_at === null,
      [...slugForged, ...roles, ...forged.tries, ...platform.tries].map((x) => x.r.message ?? "ok").join("|"),
    );
  }

  // CT-04 adviser allocation
  let advComplete;
  {
    const un = await unallocatedRefusal(db, tf, t1);
    advComplete = await complete(tf, t1, U.advA);
    const s2 = await db.newCase({ apptAdviser: "advAppt" });
    const t2 = await db.newTask(s2);
    const byAppt = await complete(tf, t2, U.advAppt);
    ok(
      "CT-04 allocation: an Adviser of the same tenant who is neither allocated nor booked on the case is refused (\"Forbidden\", nothing written); the allocated Adviser and an Adviser with an appointment on the case complete",
      un.pass && advComplete.ok && byAppt.ok,
      `${un.x.r.message} alloc=${advComplete.ok ? "ok" : advComplete.message} appt=${byAppt.ok ? "ok" : byAppt.message}`,
    );
  }

  // CT-05 same-tenant completion effects
  {
    const task = await db.task(t1);
    const logs = await db.logs(s1);
    const trk = await db.tracking(s1);
    const views = await db.views(s1);
    const doneLogs = logs.filter((l) => l.entry_type === "contact" && / completed$/.test(l.body ?? ""));
    ok(
      "CT-05 same-tenant completion: the task records completed_at and the completing adviser; exactly one completion log entry (tenant A, author = adviser); tracking attention cleared (tenant A); callback and appointment markers for the adviser (tenant A)",
      advComplete.ok &&
        task.completed_at !== null &&
        task.completed_by === U.advA &&
        task.tenant_id === T.a &&
        doneLogs.length === 1 &&
        doneLogs[0].tenant_id === T.a &&
        doneLogs[0].author_id === U.advA &&
        trk?.tenant_id === T.a &&
        trk?.session_attention_cleared_at !== null &&
        views.length === 2 &&
        views.every((v) => v.tenant_id === T.a && v.advisor_id === U.advA),
      `logs=${doneLogs.length} views=${views.length}`,
    );
  }

  // CT-06 Owner / Supervisor / General Admin
  {
    const out = [];
    for (const actor of ["ownerA", "supA", "genA"]) {
      const s = await db.newCase({ callback: true });
      const t = await db.newTask(s);
      const r = await complete(tf, t, U[actor]);
      const logs = (await db.logs(s)).filter((l) => / completed$/.test(l.body ?? ""));
      out.push({ actor, ok: r.ok, msg: r.message, logs: logs.length, tenant: logs[0]?.tenant_id, by: (await db.task(t)).completed_by });
    }
    ok(
      "CT-06 Owner, Supervisor and General Admin of the case's tenant complete without an allocation; one completion log each, attributed to tenant A",
      out.every((o) => o.ok && o.logs === 1 && o.tenant === T.a && o.by === U[o.actor]),
      out.map((o) => `${o.actor}:${o.ok ? "ok" : o.msg}`).join(" "),
    );
  }

  // CT-08 tenant attribution on the shared write paths
  const keys = {};
  {
    const s3 = await db.newCase({ alloc: "advA", callback: true });
    const marked = await call(sf.markContacted, { sessionId: s3 }, U.advA);
    const nextAt = new Date(Date.now() + 3 * 86400000).toISOString();
    const nexted = await call(sf.setNextContact, { sessionId: s3, nextContactAt: nextAt }, U.advA);
    await st.ensureWelcomeCallTask(svcClient, s3, null);
    const tasks = await db.q(`select task_type, tenant_id from public.staff_contact_tasks where session_id = $1 order by task_type`, [s3]);
    const nextTask = await db.one(`select id from public.staff_contact_tasks where session_id = $1 and task_type = 'next_contact'`, [s3]);
    const pc = await db.svc(`insert into public.phone_calls (session_id, advisor_id, to_number, tenant_id) values ($1,$2,'SYNTH-PHONE',$3) returning id`, [s3, U.advA, T.a]);
    const markers = await db.svc(
      `insert into public.advisor_contact_views (advisor_id, contact_type, contact_id) values ($1,'phone_call',$2), ($1,'staff_task',$3), ($1,'abandoned',$4)
       returning contact_type, tenant_id`,
      [U.advA, pc.rows?.[0]?.id, nextTask?.id, s3],
    );
    const tlLog = await db.svc(`insert into public.customer_contact_log (session_id, entry_type, body) values ($1,'note','tenantless parent') returning tenant_id`, [sTl]);
    const logs = await db.logs(s3);
    const trk = await db.tracking(s3);
    const views = await db.views(s3);
    keys.log = logs.length > 0 && logs.every((l) => l.tenant_id === T.a);
    keys.tracking = trk?.tenant_id === T.a;
    keys.marker = views.length > 0 && views.every((v) => v.tenant_id === T.a) && markers.ok && markers.rows.every((m) => m.tenant_id === T.a);
    keys.nextTask = tasks.length === 2 && tasks.every((t) => t.tenant_id === T.a);
    ok(
      "CT-08 attribution: markContacted, setNextContact (tracking, log, next-contact task), ensureWelcomeCallTask, clearSessionAttention markers and phone-call/staff-task/abandoned markers written without a tenant all carry the parent case's tenant; a record on a tenantless case stays tenantless",
      marked.ok && nexted.ok && keys.log && keys.tracking && keys.marker && keys.nextTask && tlLog.ok && tlLog.rows[0].tenant_id === null,
      `log=${keys.log} tracking=${keys.tracking} marker=${keys.marker} task=${keys.nextTask} logs=${logs.length} views=${views.length} ${marked.message ?? ""} ${nexted.message ?? ""} ${markers.message ?? ""}`,
    );
  }

  // CT-09 no cross-tenant parent/child records
  let cross;
  {
    const cbB = (await db.one(`select id from public.callback_requests where session_id = $1`, [sB])).id;
    const logA = (await db.logs(s1))[0].id;
    cross = await crossTenantWrites(db, { sB, sA: s1, sTl, cbB, logA });
    ok(
      "CT-09 parent/child: service-role writes that attach tenant A to tenant B's case, a callback of tenant B or an unknown contact, supply a tenant for a tenantless case, re-parent or re-attribute a log or task, back-fill a legacy row or upsert a foreign tenant are refused (42501) through SQL and the PostgREST client, and nothing changes",
      cross.pass,
      Object.entries(cross.tries).map(([k, r]) => `${k}:${r.ok ? "applied" : r.code}`).join(" ") + ` api=${cross.api.error?.code ?? "applied"}`,
    );
  }

  // CT-10 concurrent completion
  {
    const s4 = await db.newCase({ alloc: "advA", callback: true });
    const t4 = await db.newTask(s4);
    const r = await raceCompletion(db, tf, t4, s4);
    ok(
      "CT-10 concurrency: six concurrent completions of one task (all past authorisation before any update) → exactly one succeeds, the rest get \"Task not found or already completed\", one completion log entry, one tracking row, completed_by = the winner",
      r.pass,
      `oks=${r.oks} logs=${r.logs}`,
    );
  }

  // CT-11 idempotent repeat
  {
    const again = [await quiet(db, () => complete(tf, t1, U.advA)), await quiet(db, () => complete(tf, t1, U.ownerA))];
    ok(
      "CT-11 idempotent repeat: completing an already-completed task again (same adviser, then the Owner) is refused with \"Task not found or already completed\" and writes no log entry, tracking or marker",
      again.every((x) => refusedClean(x, DONE)),
      again.map((x) => x.r.message ?? "ok").join("|"),
    );
  }

  // CT-12 legacy data preservation
  let legacyPass;
  {
    const before = await db.task(L.taskLeg);
    const r = await complete(tf, L.taskLeg, U.ownerA);
    const after = await db.task(L.taskLeg);
    const trk = await db.tracking(S.leg);
    const newLogs = (await db.logs(S.leg)).filter((l) => l.id !== L.logLeg);
    const rest0 = await legacyUnchanged(db, [`task:${L.taskLeg}`, `trk:${S.leg}`]);
    legacyPass = rest0.pass;
    ok(
      "CT-12 legacy: a legacy tenantless task on a tenant-A case is still completable by tenant A's Owner, its tenant_id and the legacy tracking row's tenant_id stay NULL (no back-fill), the new log entry is attributed to tenant A; every other legacy row (tenantless and contradictory) is byte-identical",
      r.ok &&
        after.tenant_id === null &&
        after.session_id === before.session_id &&
        after.completed_by === U.ownerA &&
        trk.tenant_id === null &&
        newLogs.length === 1 &&
        newLogs[0].tenant_id === T.a &&
        rest0.pass,
      `${r.message ?? "ok"} legacyRows=${rest0.count}`,
    );
  }

  // CT-13 binned case
  {
    const r = await binnedRefusal(db, tf, tBin);
    const page = await call(sf.getSession, { sessionId: sBin }, U.ownerA);
    const reads = [
      await quiet(db, () => call(sf.getContactTracking, { sessionId: sBin }, U.advA)),
      await quiet(db, () => call(sf.markContacted, { sessionId: sBin }, U.advA)),
      await quiet(db, () => call(sf.getCustomerJourney, { sessionId: sBin }, U.ownerA)),
    ];
    const pageSrc = read(PAGE_REL);
    const ui =
      /const isBinned = Boolean\(\(session as \{ deleted_at\?: string \| null \}\)\.deleted_at\);/.test(pageSrc) &&
      /isBinned \? \(\s*<BinnedCaseNotice>[\s\S]*?<\/BinnedCaseNotice>\s*\) : \(\s*<ContactTrackingCard sessionId=\{sessionId\} \/>\s*\)/.test(pageSrc) &&
      /isBinned && isStaffViewer \? \(\s*<BinnedCaseNotice>[\s\S]*?<\/BinnedCaseNotice>\s*\) : \(\s*<CustomerJourneyTab/.test(pageSrc) &&
      (pageSrc.match(/<ContactTrackingCard /g) ?? []).length === 1 &&
      (pageSrc.match(/<CustomerJourneyTab/g) ?? []).length === 1;
    ok(
      "CT-13 binned case: task completion on a binned case is refused for Owner, Supervisor and the allocated Adviser (\"Not found.\", nothing written); the Owner can still open the binned case, contact tracking, mark-contacted and journey stay refused server-side; the staff case page shows a binned notice instead of the contact-tracking and journey panels",
      r.pass && page.ok && Boolean(page.value?.session?.deleted_at) && reads.every((x) => refusedClean(x, NOT_FOUND)) && ui,
      `${r.tries.map((x) => x.r.message).join("|")} page=${page.ok ? "ok" : page.message} reads=${reads.map((x) => x.r.message).join("|")} ui=${ui}`,
    );
  }

  // CT-14 RLS visibility
  {
    const doneB = await complete(tf, tB, U.ownerB, SLUG.b);
    const seenA = await db.asClient(U.ownerA, `select tenant_id from public.customer_contact_log`);
    const seenB = await db.asClient(U.ownerB, `select tenant_id from public.customer_contact_log`);
    const trkA = await db.asClient(U.supA, `select tenant_id from public.session_contact_tracking`);
    const viewsOwnerA = await db.asClient(U.ownerA, `select tenant_id, advisor_id from public.advisor_contact_views`);
    const viewsOwnerB = await db.asClient(U.ownerB, `select tenant_id, advisor_id from public.advisor_contact_views`);
    const tasksA = await db.asClient(U.ownerA, `select id from public.staff_contact_tasks`);
    ok(
      "CT-14 RLS: tenant A staff see tenant A's new contact log, tracking and marker rows and nothing of tenant B or tenantless rows; tenant B's Owner sees only tenant B's; staff_contact_tasks stay service-only",
      doneB.ok &&
        seenA.rows.length > 0 && seenA.rows.every((r) => r.tenant_id === T.a) &&
        seenB.rows.length > 0 && seenB.rows.every((r) => r.tenant_id === T.b) &&
        trkA.rows.length > 0 && trkA.rows.every((r) => r.tenant_id === T.a) &&
        viewsOwnerA.rows.length > 0 && viewsOwnerA.rows.every((r) => r.tenant_id === T.a) &&
        viewsOwnerB.rows.every((r) => r.tenant_id === T.b) &&
        tasksA.rows.length === 0,
      `A=${seenA.rows.length} B=${seenB.rows.length} trk=${trkA.rows.length} viewsA=${viewsOwnerA.rows.length} viewsB=${viewsOwnerB.rows.length}`,
    );
  }

  // CT-15 migration fails closed
  {
    const before = await db.state();
    const again = await outcome(() => db.admin.query(ctSql));
    const pre = await buildDb("ct_pre_missing", {
      migrate: true,
      before: ({ q }) => q(`alter table public.phone_calls drop column tenant_id`),
    });
    const objs = await pre.one(
      `select (select count(*)::int from pg_trigger where tgname like '%tenant_guard') t,
              (select count(*)::int from pg_proc where proname in ('contact_session_tenant_guard','advisor_contact_view_tenant_guard')) f`,
    );
    await pre.admin.end();
    ok(
      "CT-15 fail-closed: re-applying the migration stops at objects_present with nothing changed; a database missing a parent tenant column stops at its precondition with no function or trigger created",
      !again.ok && /g7f4ct_precondition:objects_present/.test(again.message) && (await db.state()) === before &&
        !pre.migration.ok && /g7f4ct_precondition:column phone_calls\.tenant_id/.test(pre.migration.message) && objs.t === 0 && objs.f === 0,
      `${again.message ?? ""} / ${pre.migration.message ?? ""}`,
    );
  }

  // CT-16 static boundary and scope
  {
    const at = (s) => TASKS_FN_SRC.indexOf(s);
    const order =
      at("resolveActingTenantForList(context.userId, capability)") > 0 &&
      at("resolveActingTenantForList(context.userId, capability)") < at('.from("staff_contact_tasks")') &&
      at('.from("staff_contact_tasks")') < at("authoriseTenantResource({") &&
      at("authoriseTenantResource({") < at("taskRow.tenant_id !== tenantId") &&
      at("taskRow.tenant_id !== tenantId") < at("completeStaffContactTaskById(") &&
      at("completeStaffContactTaskById(") < at('.from("customer_contact_log")') &&
      !TASKS_FN_SRC.includes("requireActingTenantStaff") &&
      TASKS_FN_SRC.includes("v.member && (v.isMainAdmin || v.isAdvisor)") &&
      !TASKS_FN_SRC.includes("includeDeleted");
    ok(
      "CT-16 scope: completeStaffContactTask checks role in the verified acting tenant, then the task, then the case boundary and the task/case tenant agreement before any write; no Platform-entry or deleted-case widening; staff-contact-tasks.server.ts and tenant-assert.server.ts are unchanged from HEAD",
      order && read(TASKS_SERVER_REL) === atHead(TASKS_SERVER_REL) && read(TENANT_ASSERT_REL) === atHead(TENANT_ASSERT_REL),
    );
  }

  // CT-07 aggregate: every refusal of the run left all contact state untouched
  ok(
    "CT-07 refusals are side-effect free: every refused completion and contact call in this run left every task, contact log, tracking and attention-marker row byte-identical",
    refusals.length >= 30 && refusals.every((x) => x.clean),
    `refusals=${refusals.length}`,
  );

  // =============================================================================================
  // Negative controls
  // =============================================================================================
  const headMod = await tasksModule(atHead(TASKS_FN_REL));
  {
    const s = await db.newCase({ tenant: null });
    const t = await db.newTask(s);
    const r = await tenantlessRefusal(db, headMod, t);
    nc("NC01 HEAD completeStaffContactTask → a tenantless case's task is completed by another company's staff; CT-02 rejects", {
      effect: r.task.completed_at !== null,
      caught: !r.pass,
    });
  }
  {
    const s = await db.newCase({ alloc: "advA" });
    const t = await db.newTask(s);
    const r = await unallocatedRefusal(db, headMod, t);
    nc("NC02 HEAD completeStaffContactTask → an unallocated Adviser completes the task; CT-04 rejects", {
      effect: r.task.completed_by === U.advA2,
      caught: !r.pass,
    });
  }
  {
    const m = await tasksModule(
      mutate(TASKS_FN_SRC, [["if (taskRow.tenant_id && taskRow.tenant_id !== tenantId) {", "if (false) {"]]),
    );
    const r = m ? await forgedTaskRefusal(db, m, L.taskForged) : { pass: true, task: {} };
    nc("NC03 handler without the task/case tenant agreement → tenant B's Owner completes a task whose tenant contradicts its case; CT-03 rejects", {
      effect: Boolean(r.task.completed_at),
      caught: !r.pass,
    });
  }
  {
    const m = await tasksModule(
      mutate(TASKS_FN_SRC, [["id: taskRow.session_id,\n      capability,\n", "id: taskRow.session_id,\n      capability,\n      includeDeleted: true,\n"]]),
    );
    const s = await db.newCase({ alloc: "advA", deleted: true });
    const t = await db.newTask(s);
    const r = m ? await binnedRefusal(db, m, t) : { pass: true, task: {} };
    nc("NC04 handler admitting deleted cases → a binned case's task is completed; CT-13 rejects", {
      effect: Boolean(r.task.completed_at),
      caught: !r.pass,
    });
  }
  {
    const m = await tasksModule(
      mutate(TASKS_FN_SRC, [["v.member && (v.isMainAdmin || v.isAdvisor)", "v.isMainAdmin || v.isAdvisor"]]),
    );
    const s = await db.newCase();
    const t = await db.newTask(s);
    const r = m ? await platformRefusal(db, m, t) : { pass: true, task: {} };
    nc("NC05 handler without the membership requirement → Platform Enter Company completes a tenant task; CT-03 rejects", {
      effect: r.task.completed_by === U.superOwner,
      caught: !r.pass,
    });
  }
  {
    const m = await tasksModule(
      mutate(TASKS_FN_SRC, [
        [
          "const result = await completeStaffContactTaskById(supabaseAdmin, data.taskId, context.userId);",
          `const result = await (async () => {
      const { data: t } = await supabaseAdminUntyped.from("staff_contact_tasks").select("session_id, task_type, completed_at").eq("id", data.taskId).maybeSingle();
      if (!t || t.completed_at) return null;
      await supabaseAdminUntyped.from("staff_contact_tasks").update({ completed_at: new Date().toISOString(), completed_by: context.userId }).eq("id", data.taskId);
      return { sessionId: t.session_id, taskType: t.task_type };
    })();`,
        ],
      ]),
    );
    const s = await db.newCase({ alloc: "advA", callback: true });
    const t = await db.newTask(s);
    const r = m ? await raceCompletion(db, m, t, s) : { pass: true, oks: 0, logs: 0 };
    nc("NC06 handler with a read-then-update (non-atomic) completion → concurrent completions all succeed and log repeatedly; CT-10 rejects", {
      effect: r.oks > 1 && r.logs > 1,
      caught: !r.pass,
      detail: `oks=${r.oks} logs=${r.logs}`,
    });
  }
  // Migration variants, each on its own database.
  const migrationNc = async (label, dbName, sql, run) => {
    let effect = false;
    let caught = false;
    let detail = "";
    if (sql !== null) {
      const m = await buildDb(dbName, { migrate: sql !== false, sql: sql || ctSql });
      if (sql === false || m.migration.ok) {
        useDb(m);
        ({ effect, caught, detail = "" } = await run(m));
        await m.pool.end();
      } else detail = m.migration.message;
      await m.admin.end();
      useDb(db);
    }
    nc(label, { effect, caught, detail });
  };
  await migrationNc(
    "NC07 without the migration → a completion leaves the tracking row and attention markers tenantless; CT-08 rejects",
    "ct_nc_nomig",
    false,
    async (m) => {
      const s = await m.newCase({ alloc: "advA", callback: true });
      const t = await m.newTask(s);
      const r = await complete(tf, t, U.advA);
      const a = await attributionAfterCompletion(m, s, T.a);
      return { effect: r.ok && a.trk?.tenant_id === null && a.views.some((v) => v.tenant_id === null), caught: !a.pass };
    },
  );
  await migrationNc(
    "NC08 guard trusting a supplied tenant → tenant A is attached to tenant B's case; CT-09 rejects",
    "ct_nc_trust",
    mutate(ctSql, [
      ["  ELSIF v_parent IS NULL OR NEW.tenant_id <> v_parent THEN\n    RAISE EXCEPTION 'contact record tenant does not match its case'", "  ELSIF false THEN\n    RAISE EXCEPTION 'contact record tenant does not match its case'"],
    ]),
    async (m) => {
      const sA = await m.newCase({ callback: true });
      const sB2 = await m.newCase({ tenant: T.b, customer: "custB", callback: true });
      const sTl2 = await m.newCase({ tenant: null });
      const logA = (await m.svc(`insert into public.customer_contact_log (session_id, entry_type, body) values ($1,'note','a') returning id`, [sA])).rows[0].id;
      const cbB = (await m.one(`select id from public.callback_requests where session_id = $1`, [sB2])).id;
      const r = await crossTenantWrites(m, { sB: sB2, sA, sTl: sTl2, cbB, logA });
      const foreign = await m.one(`select count(*)::int n from public.customer_contact_log where session_id = $1 and tenant_id = $2`, [sB2, T.a]);
      return { effect: foreign.n > 0, caught: !r.pass };
    },
  );
  await migrationNc(
    "NC09 guard without case immutability → a tenant A log entry is re-parented onto tenant B's case; CT-09 rejects",
    "ct_nc_reparent",
    mutate(ctSql, [["IF NEW.session_id IS DISTINCT FROM OLD.session_id THEN", "IF false THEN"]]),
    async (m) => {
      const sA = await m.newCase({ callback: true });
      const sB2 = await m.newCase({ tenant: T.b, customer: "custB", callback: true });
      const sTl2 = await m.newCase({ tenant: null });
      const logA = (await m.svc(`insert into public.customer_contact_log (session_id, entry_type, body) values ($1,'note','a') returning id`, [sA])).rows[0].id;
      const cbB = (await m.one(`select id from public.callback_requests where session_id = $1`, [sB2])).id;
      const r = await crossTenantWrites(m, { sB: sB2, sA, sTl: sTl2, cbB, logA });
      const moved = await m.one(`select session_id, tenant_id from public.customer_contact_log where id = $1`, [logA]);
      return { effect: moved.session_id === sB2 && moved.tenant_id === T.a, caught: !r.pass };
    },
  );
  await migrationNc(
    "NC10 migration with a back-fill → legacy tenantless contact rows are re-attributed; CT-12 rejects",
    "ct_nc_backfill",
    mutate(ctSql, [
      [
        "-- C. Session-keyed contact records: tenant from the case.",
        "UPDATE public.customer_contact_log l SET tenant_id = s.tenant_id FROM public.interview_sessions s WHERE s.id = l.session_id AND l.tenant_id IS NULL;\n-- C. Session-keyed contact records: tenant from the case.",
      ],
    ]),
    async (m) => {
      const r = await legacyUnchanged(m);
      const leg = await m.one(`select tenant_id from public.customer_contact_log where id = $1`, [L.logLeg]);
      return { effect: leg.tenant_id === T.a, caught: !r.pass };
    },
  );

  await db.pool?.end();
  await db.admin.end();

  const ncPass = ncResults.filter((r) => r.pass).length;
  console.log(`CONTACT_LOG_TENANT_ID=${keys.log ? "DERIVED_FROM_CASE" : "FAIL"}`);
  console.log(`CONTACT_TRACKING_TENANT_ID=${keys.tracking ? "DERIVED_FROM_CASE" : "FAIL"}`);
  console.log(`ATTENTION_MARKER_TENANT_ID=${keys.marker ? "DERIVED_FROM_CONTACT" : "FAIL"}`);
  console.log(`NEXT_CONTACT_TASK_TENANT_ID=${keys.nextTask ? "DERIVED_FROM_CASE" : "FAIL"}`);
  console.log(`LEGACY_ROWS_UNCHANGED=${legacyPass ? "YES" : "NO"}`);
  console.log(`UNKNOWN_CALLS=${unknownCalls.length}`);
  console.log(`TEST_CASES=${total}`);
  console.log(`TESTS_PASS=${total - failures.length}`);
  console.log(`NEGATIVE_CONTROL_COUNT=${ncResults.length}`);
  console.log(`NEGATIVE_CONTROLS_PASS=${ncPass}`);
  const pass = failures.length === 0 && ncPass === ncResults.length;
  console.log(`RESULT=${pass ? "PASS" : "FAIL"}`);
  exitCode = pass ? 0 : 1;
} catch (e) {
  console.error(`FAIL  verifier aborted: ${e?.stack ?? e}`);
  exitCode = 1;
} finally {
  await shutdown();
}
process.exit(exitCode);
