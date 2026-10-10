/**
 * G7F-4 — Case tenant ownership: interview_sessions.tenant_id is set once, at creation, from a
 * verified server context and never changes; client roles cannot create, delete or re-tenant
 * cases. Run on a real PostgreSQL server.
 *
 * A disposable local PostgreSQL 17 server (embedded-postgres) carries the B4b2 verifier's
 * staging-shaped base schema, the contact verifier's staging contact tables and the staging shape
 * of interview_sessions (read-only staging catalogue inventory: columns, the FOR ALL "Customer
 * manages own sessions" policy, every table privilege held by anon and authenticated, the
 * (id, tenant_id) key and a composite finance FK), the committed contact tenant attribution
 * migration, then the case tenant ownership migration read unchanged from the working tree. The
 * real session and tenant-assert server code runs unmodified through a fake PostgREST layer on a
 * non-routable host; client requests run as `authenticated` with the caller's id, server requests
 * as `service_role`.
 *
 * Negative controls weaken one protection each (no migration, or a migration mutant) and show the
 * unsafe effect happening and the matching test predicate rejecting it.
 *
 * Synthetic fixtures only: no network, no staging, no production, no real user, phone or token.
 *
 * Dependencies: npm install --prefix /tmp/b4b2-conc embedded-postgres@17.6.0-beta.15 pg@8
 * Run: npm exec --yes --package=tsx -- tsx scripts/g7f4cto-case-tenant-ownership-verify.mjs
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire, register } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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
const sha256 = (s) => createHash("sha256").update(s, "utf8").digest("hex");

const CTO_REL = "supabase/migrations/20261010150000_gate_g7f4_case_tenant_ownership.sql";
const CT_REL = "supabase/migrations/20261010120000_gate_g7f4_contact_tenant_attribution.sql";
const B4C1_REL = "supabase/migrations/20261009120000_gate_g7f4s4c4b4c1_raf_authority_audit.sql";
const COMMITTED = {
  [B4C1_REL]: "b8e73371cd277eb7566a8c9dce152d2eac8e0e7ee389fa7d2097a64f244f4942",
  [CT_REL]: "4ed23b5ce67d7a58d4a0db7e222e7055897b73db45c0b72333e39607c111b400",
};
const ctoSql = read(CTO_REL);
const ctSql = read(CT_REL);
const literal = (rel, name) => {
  const src = read(rel);
  const tok = `const ${name} = \``;
  const s0 = src.indexOf(tok);
  const text = src.slice(s0 + tok.length, src.indexOf("\n`;", s0));
  if (s0 < 0 || text.includes("\\") || text.includes("${")) {
    throw new Error(`${rel} ${name} is not a plain literal`);
  }
  return text;
};
const BASE_SCHEMA = literal("scripts/g7f4s4c4b4b2-financial-posting-verify.mjs", "BASE_SCHEMA");
const CONTACT_STAGING_SQL = literal(
  "scripts/g7f4ct-contact-task-tenant-attribution-verify.mjs",
  "CONTACT_STAGING_SQL",
);
const ROLES_SQL = "create role anon; create role authenticated; create role service_role bypassrls;";
if (!BASE_SCHEMA.trimStart().startsWith(ROLES_SQL)) throw new Error("BASE_SCHEMA role prelude changed");
const DB_SCHEMA = BASE_SCHEMA.replace(ROLES_SQL, "");

// Staging shape of interview_sessions on top of the B4b2 base (read-only staging catalogue):
// the progress columns, the (id, tenant_id) key with a composite finance FK, the G7D platform
// access helpers and the FOR ALL policy. anon and authenticated already hold every privilege.
const CASE_STAGING_SQL = `
alter table public.interview_sessions
  add column summary text,
  add column followup_count integer not null default 0,
  add column deleted_by uuid references auth.users(id) on delete set null,
  add constraint interview_sessions_id_tenant_key unique (id, tenant_id);
alter table public.finance_fee_lines
  add constraint finance_fee_lines_session_tenant_fkey foreign key (session_id, tenant_id)
    references public.interview_sessions(id, tenant_id) on update restrict on delete restrict;
create table public.verifier_platform_access (user_id uuid not null, tenant_id uuid not null, write boolean not null);
create function public.auth_has_platform_tenant_read_access(p_tenant_id uuid) returns boolean
  language sql stable security definer set search_path = public as
  $$ select p_tenant_id is not null and auth.uid() is not null and exists (
       select 1 from public.verifier_platform_access a where a.user_id = auth.uid() and a.tenant_id = p_tenant_id) $$;
create function public.auth_has_platform_tenant_write_access(p_tenant_id uuid) returns boolean
  language sql stable security definer set search_path = public as
  $$ select p_tenant_id is not null and auth.uid() is not null and exists (
       select 1 from public.verifier_platform_access a where a.user_id = auth.uid() and a.tenant_id = p_tenant_id and a.write) $$;
revoke all on function public.auth_has_platform_tenant_read_access(uuid) from public, anon;
revoke all on function public.auth_has_platform_tenant_write_access(uuid) from public, anon;
grant execute on function public.auth_has_platform_tenant_read_access(uuid) to authenticated, service_role;
grant execute on function public.auth_has_platform_tenant_write_access(uuid) to authenticated, service_role;
drop policy "Customer manages own sessions" on public.interview_sessions;
create policy "Customer manages own sessions" on public.interview_sessions
  for all to authenticated
  using ((customer_id = auth.uid()) or public.auth_is_tenant_staff(tenant_id) or public.auth_has_platform_tenant_read_access(tenant_id))
  with check ((customer_id = auth.uid()) or public.auth_is_tenant_staff(tenant_id) or public.auth_has_platform_tenant_write_access(tenant_id));
`;

// --- module stubs (the session server functions run unmodified) ---------------------------------
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
  return { sid: "SMcto" + outbox.length };
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
const hookSource = `
const STUBS = {
  start: ${JSON.stringify(dataUrl(stubStart))},
  startServer: ${JSON.stringify(dataUrl(stubStartServer))},
  platform: ${JSON.stringify(dataUrl(stubPlatform))},
  sms: ${JSON.stringify(dataUrl(stubSms))},
  mfa: ${JSON.stringify(dataUrl(stubMfa))},
  openai: ${JSON.stringify(dataUrl(stubOpenAi))},
};
export async function resolve(specifier, context, next) {
  const parent = String(context.parentURL ?? "");
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

const DATA_DIR = mkdtempSync(join(tmpdir(), "g7f4cto-pg-"));
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
      if (process.env.G7F4CTO_DEBUG) orig(...a);
    }
  };
}

// --- fake PostgREST over a pool (each request: own connection + transaction) ---------------------
const FAKE_HOST = "g7f4cto.invalid";
const PUBLISHABLE = "sb_publishable_g7f4cto_not_a_real_key";
process.env.SUPABASE_URL = `http://${FAKE_HOST}`;
process.env.VITE_SUPABASE_URL = `http://${FAKE_HOST}`;
process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_secret_g7f4cto_not_a_real_key";
process.env.SUPABASE_PUBLISHABLE_KEY = PUBLISHABLE;
process.env.VITE_SUPABASE_PUBLISHABLE_KEY = PUBLISHABLE;
const USER_HEADER = "x-g7f4cto-user";
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
  ctx.pool ??= new pg.Pool({ ...ctx.cfg, max: 16 });
  ctx.pool.on("error", () => {});
  served = ctx.pool;
}

// --- fixtures -----------------------------------------------------------------------------------
const idProxy = () =>
  new Proxy({}, { get: (o, k) => (typeof k === "string" ? (o[k] ??= randomUUID()) : o[k]) });
const U = idProxy();
const S = idProxy();
const T = { a: randomUUID(), b: randomUUID() };
const SLUG = { a: "tenant-a", b: "tenant-b" };
const LEGACY_AT = "2026-09-01T09:00:00.000Z";
const CHILD_TABLES = [
  "customer_contact_log",
  "session_contact_tracking",
  "staff_contact_tasks",
  "appointments",
  "session_advisors",
  "finance_fee_lines",
  "referrals",
];

async function buildDb(name, { sql = ctoSql, before = null } = {}) {
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
  await admin.query(CASE_STAGING_SQL);
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
  for (const [key, ms] of [
    ["ownerA", [[T.a, "owner"]]],
    ["advA", [[T.a, "adviser"]]],
    ["custA", [[T.a, "customer"]]],
    ["custNew", [[T.a, "customer"]]],
    ["custTl", [[T.a, "customer"]]],
    ["ownerB", [[T.b, "owner"]]],
    ["custB", [[T.b, "customer"]]],
    ["dualStaff", [[T.a, "adviser"], [T.b, "adviser"]]],
    ["platW", []],
    ["platR", []],
  ]) {
    await addUser(key);
    for (const [t, r] of ms) {
      await q(`insert into public.tenant_memberships (tenant_id, user_id, role) values ($1, $2, $3)`, [t, U[key], r]);
    }
  }
  await q(`insert into public.verifier_platform_access (user_id, tenant_id, write) values ($1,$3,true), ($2,$3,false)`, [
    U.platW,
    U.platR,
    T.a,
  ]);
  // Cases: S.a carries every kind of child record (and a fee line under the composite finance FK);
  // S.a2 is a plain tenant-A case; S.tl is a legacy tenantless case; S.del a binned tenant-A case.
  for (const [id, cust, tenant, extra] of [
    [S.a, "custA", T.a, {}],
    [S.a2, "custA", T.a, {}],
    [S.a3, "custA", T.a, {}],
    [S.b, "custB", T.b, {}],
    [S.tl, "custTl", null, {}],
    [S.del, "custA", T.a, { deleted: true }],
  ]) {
    await q(
      `insert into public.interview_sessions (id, customer_id, tenant_id, case_ref, status, created_at, deleted_at)
       values ($1,$2,$3,$4,'in_progress',$5,$6)`,
      [id, U[cust], tenant, `MG-CTO-${id.slice(0, 6)}`, LEGACY_AT, extra.deleted ? LEGACY_AT : null],
    );
  }
  const ct = await outcome(() => admin.query(ctSql));
  if (!ct.ok) throw new Error(`contact migration: ${ct.message}`);
  const svcSql = async (text, params = []) => {
    const k = await connect();
    try {
      await k.query("begin");
      await k.query("set local role service_role");
      const r = await k.query(text, params);
      await k.query("commit");
      return r.rows;
    } finally {
      await k.end();
    }
  };
  await svcSql(`insert into public.customer_contact_log (session_id, author_id, entry_type, body) values ($1,$2,'note','synthetic note')`, [S.a, U.advA]);
  await svcSql(`insert into public.session_contact_tracking (session_id, last_contacted_at, updated_by) values ($1, now(), $2)`, [S.a, U.advA]);
  await svcSql(`insert into public.staff_contact_tasks (session_id, task_type, due_at) values ($1,'welcome_call', now() + interval '1 day')`, [S.a]);
  await svcSql(
    `insert into public.appointments (advisor_id, session_id, customer_name, starts_at, tenant_id) values ($1,$2,'Synthetic Customer', now() + interval '1 day',$3)`,
    [U.advA, S.a, T.a],
  );
  await svcSql(`insert into public.session_advisors (session_id, advisor_id, tenant_id) values ($1,$2,$3)`, [S.a, U.advA, T.a]);
  await svcSql(
    `insert into public.finance_fee_lines (session_id, amount_pence, status, tenant_id) values ($1, 49900, 'draft', $2)`,
    [S.a, T.a],
  );
  await svcSql(
    `insert into public.referrals (referrer_user_id, referred_user_id, referred_email, status, bonus_status, tenant_id)
     values ($1,$2,'custa@example.test','signed_up','none',$3)`,
    [U.ownerA, U.custA, T.a],
  );
  if (before) await before({ q, admin });

  const caseState = async () =>
    JSON.stringify(await q(`select to_jsonb(s)::text j from public.interview_sessions s order by id`));
  const childState = async () =>
    JSON.stringify(
      await q(
        CHILD_TABLES.map((t) => `select '${t}' k, to_jsonb(x)::text j from public.${t} x`).join(" union all ") + " order by 1, 2",
      ),
    );
  const casesBefore = await caseState();
  const childrenBefore = await childState();
  const migration = sql === false ? null : await outcome(() => admin.query(sql));
  const ctx = { name, cfg, connect, admin, q, one, migration, caseState, childState, casesBefore, childrenBefore, pool: null };

  /** One transaction as `role` (authenticated carries the caller id). */
  ctx.as = async (role, user, text, params = []) => {
    const k = await connect();
    try {
      await k.query("begin");
      if (user) await k.query(`select set_config('request.jwt.claim.sub', $1, true)`, [user]);
      if (role !== "postgres") await k.query(`set local role ${role}`);
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
  ctx.svc = (text, params) => ctx.as("service_role", null, text, params);
  ctx.tenantOf = async (id) => (await one(`select tenant_id from public.interview_sessions where id = $1`, [id]))?.tenant_id ?? null;
  ctx.caseRow = (id) => one(`select * from public.interview_sessions where id = $1`, [id]);
  ctx.casesOf = async (customer) =>
    q(`select id, tenant_id from public.interview_sessions where customer_id = $1 order by id`, [U[customer]]);
  return ctx;
}

// --- modules under test -------------------------------------------------------------------------
const { createClient } = await import("@supabase/supabase-js");
const sf = await import("../src/lib/sessions.functions.ts");
const { withForcedTenantId } = await import("../src/lib/tenant-assert.server.ts");
const { supabaseAdminUntyped: svcClient } = await import("../src/integrations/supabase/client.server.ts");
const apiAs = (user) =>
  createClient(`http://${FAKE_HOST}`, PUBLISHABLE, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { [USER_HEADER]: user } },
  });
async function invoke(fn, data, actor, slug) {
  const d = fn.__def;
  const parsed = d.validator ? await d.validator(data) : data;
  globalThis.__B4C1_REQUEST = new Request("http://app.invalid/_serverFn/x", {
    headers: { referer: `http://app.invalid/${slug}/admin` },
  });
  return d.handler({ data: parsed, context: { userId: actor, claims: { sub: actor, email: null }, supabase: apiAs(actor) } });
}
const call = (fn, data, actor, slug = SLUG.a) => outcome(() => invoke(fn, data, actor, slug));
const refused = (r) => Boolean(r.error) || (r.ok === false);

// --- predicates (shared by tests and negative controls) -----------------------------------------
// Each returns { pass, effect, detail }: pass = the protection held; effect = the unsafe outcome.

/** A customer moving their own populated case to another tenant through their API client. */
async function customerMove(ctx) {
  const api = apiAs(U.custA);
  const patch = await api.from("interview_sessions").update({ tenant_id: T.b }).eq("id", S.a2).select("id");
  const raw = await ctx.as("authenticated", U.custA, `update public.interview_sessions set tenant_id = $2 where id = $1`, [S.a2, T.b]);
  const upsert = await api
    .from("interview_sessions")
    .upsert({ id: S.a2, customer_id: U.custA, tenant_id: T.b }, { onConflict: "id" });
  const tenant = await ctx.tenantOf(S.a2);
  return {
    pass: refused(patch) && !raw.ok && refused(upsert) && tenant === T.a,
    effect: tenant === T.b,
    detail: `patch=${patch.error?.code} raw=${raw.code} upsert=${upsert.error?.code} tenant=${tenant === T.a ? "A" : tenant}`,
  };
}
/** Populated tenant → NULL: the customer through the API, and the service role. */
async function moveToNull(ctx) {
  const patch = await apiAs(U.custA).from("interview_sessions").update({ tenant_id: null }).eq("id", S.a2).select("id");
  const svc = await ctx.svc(`update public.interview_sessions set tenant_id = null where id = $1`, [S.a3]);
  const t2 = await ctx.tenantOf(S.a2);
  const t3 = await ctx.tenantOf(S.a3);
  return {
    pass: refused(patch) && !svc.ok && svc.code === "42501" && t2 === T.a && t3 === T.a,
    effect: t2 === null || t3 === null,
    detail: `patch=${patch.error?.code} svc=${svc.code} ${t2 === T.a} ${t3 === T.a}`,
  };
}
/** Customer-chosen tenants: claim a tenant for a legacy tenantless case, create cases directly. */
async function customerArbitrary(ctx) {
  const before = await ctx.caseState();
  const claim = await apiAs(U.custTl).from("interview_sessions").update({ tenant_id: T.a }).eq("id", S.tl).select("id");
  const foreign = await apiAs(U.custA).from("interview_sessions").insert({ customer_id: U.custA, tenant_id: T.b, status: "in_progress" }).select("id");
  const own = await apiAs(U.custA).from("interview_sessions").insert({ customer_id: U.custA, tenant_id: T.a, status: "in_progress" }).select("id");
  const raw = await ctx.as("authenticated", U.custA, `insert into public.interview_sessions (customer_id, tenant_id, status) values ($1,$2,'in_progress')`, [U.custA, T.b]);
  const tl = await ctx.tenantOf(S.tl);
  const inB = (await ctx.casesOf("custA")).filter((c) => c.tenant_id === T.b).length;
  const unchanged = (await ctx.caseState()) === before;
  return {
    pass: refused(claim) && refused(foreign) && refused(own) && !raw.ok && tl === null && unchanged,
    effect: tl !== null || inB > 0 || !unchanged,
    detail: `claim=${claim.error?.code} foreign=${foreign.error?.code} own=${own.error?.code} raw=${raw.code} tl=${tl} inB=${inB}`,
  };
}
/** The customer's own progress writes: the real server functions and the interview-step shapes. */
async function customerProgress(ctx) {
  const pos = await call(sf.setSessionPosition, { sessionId: S.a2, section: "employment", index: 3 }, U.custA);
  const api = apiAs(U.custA);
  const summary = await api.from("interview_sessions").update({ summary: "Synthetic summary", updated_at: new Date().toISOString() }).eq("id", S.a2);
  const step = await api
    .from("interview_sessions")
    .update({ current_section: "property", current_question_index: 1, followup_count: 2, updated_at: new Date().toISOString() })
    .eq("id", S.a2);
  const submit = await call(sf.submitSession, { sessionId: S.a2 }, U.custA);
  const again = await api
    .from("interview_sessions")
    .update({ status: "submitted", submitted_at: new Date().toISOString() })
    .eq("id", S.a2)
    .neq("status", "submitted")
    .select("id");
  const row = await ctx.caseRow(S.a2);
  return {
    pass:
      pos.ok && !summary.error && !step.error && submit.ok && !again.error && (again.data ?? []).length === 0 &&
      row.status === "submitted" && row.submitted_at !== null && row.summary === "Synthetic summary" &&
      row.current_section === "property" && row.followup_count === 2 && row.tenant_id === T.a,
    effect: !pos.ok || !submit.ok || Boolean(summary.error) || Boolean(step.error),
    detail: `pos=${pos.message ?? "ok"} submit=${submit.message ?? "ok"} summary=${summary.error?.message ?? "ok"} step=${step.error?.message ?? "ok"}`,
  };
}
/** Server-only case columns and lifecycle through the customer's client. */
async function customerServerOnly(ctx) {
  const api = apiAs(U.custA);
  const undelete = await api.from("interview_sessions").update({ deleted_at: null }).eq("id", S.del).select("id");
  const ref = await api.from("interview_sessions").update({ case_ref: "MG-FORGED" }).eq("id", S.a2).select("id");
  const del = await api.from("interview_sessions").delete().eq("id", S.a2).select("id");
  const delRow = await ctx.caseRow(S.del);
  const a2 = await ctx.caseRow(S.a2);
  return {
    pass: refused(undelete) && refused(ref) && refused(del) && delRow.deleted_at !== null && a2 && a2.case_ref !== "MG-FORGED",
    effect: delRow.deleted_at === null || !a2 || a2.case_ref === "MG-FORGED",
    detail: `undelete=${undelete.error?.code} ref=${ref.error?.code} del=${del.error?.code}`,
  };
}
/** Tenantless INSERT by the service role (a server bug or a bypass of withForcedTenantId). */
async function tenantlessInsert(ctx) {
  const id = randomUUID();
  const r = await ctx.svc(`insert into public.interview_sessions (id, customer_id, status) values ($1,$2,'in_progress')`, [id, U.custNew]);
  const api = await svcClient.from("interview_sessions").insert({ customer_id: U.custNew, status: "in_progress" }).select("id");
  const made = await ctx.one(`select count(*)::int n from public.interview_sessions where customer_id = $1 and tenant_id is null`, [U.custNew]);
  return {
    pass: !r.ok && r.code === "23502" && Boolean(api.error) && made.n === 0,
    effect: made.n > 0,
    detail: `sql=${r.code} api=${api.error?.code}`,
  };
}
/** Staff through their own client: foreign tenant, own tenant, and a member of both tenants. */
async function staffMutation(ctx) {
  const before = await ctx.caseState();
  const foreign = await apiAs(U.ownerB).from("interview_sessions").update({ status: "submitted" }).eq("id", S.a3).select("id");
  const foreignMove = await apiAs(U.ownerB).from("interview_sessions").update({ tenant_id: T.b }).eq("id", S.a3).select("id");
  const ownMove = await apiAs(U.ownerA).from("interview_sessions").update({ tenant_id: T.b }).eq("id", S.a3).select("id");
  const dualMove = await apiAs(U.dualStaff).from("interview_sessions").update({ tenant_id: T.b }).eq("id", S.a3).select("id");
  const dualRaw = await ctx.as("authenticated", U.dualStaff, `update public.interview_sessions set tenant_id = $2 where id = $1`, [S.a3, T.b]);
  const dualCreate = await apiAs(U.dualStaff).from("interview_sessions").insert({ customer_id: U.custA, tenant_id: T.b, status: "in_progress" }).select("id");
  const staffDelete = await apiAs(U.ownerA).from("interview_sessions").delete().eq("id", S.a3).select("id");
  const t = await ctx.tenantOf(S.a3);
  const unchanged = (await ctx.caseState()) === before;
  return {
    pass:
      (foreign.data ?? []).length === 0 && !foreign.error && refused(foreignMove) && refused(ownMove) &&
      refused(dualMove) && !dualRaw.ok && refused(dualCreate) && refused(staffDelete) && t === T.a && unchanged,
    effect: t !== T.a || !unchanged,
    detail: `foreign=${(foreign.data ?? []).length} fmove=${foreignMove.error?.code} own=${ownMove.error?.code} dual=${dualMove.error?.code}/${dualRaw.code} create=${dualCreate.error?.code} del=${staffDelete.error?.code}`,
  };
}
/** Legacy tenantless case: no role assigns it a tenant; its customer's progress still saves. */
async function legacyTenantless(ctx) {
  const svc = await ctx.svc(`update public.interview_sessions set tenant_id = $2 where id = $1`, [S.tl, T.a]);
  const api = await svcClient.from("interview_sessions").update({ tenant_id: T.b }).eq("id", S.tl).select("id");
  const owner = await ctx.as("postgres", null, `update public.interview_sessions set tenant_id = $2 where id = $1`, [S.tl, T.a]);
  const progress = await apiAs(U.custTl).from("interview_sessions").update({ current_question_index: 4 }).eq("id", S.tl).select("id");
  const row = await ctx.caseRow(S.tl);
  return {
    pass:
      !svc.ok && svc.code === "42501" && Boolean(api.error) && !owner.ok && !progress.error && (progress.data ?? []).length === 1 &&
      row.tenant_id === null && row.current_question_index === 4,
    effect: row.tenant_id !== null,
    detail: `svc=${svc.code} api=${api.error?.code} owner=${owner.code} progress=${progress.error?.code ?? (progress.data ?? []).length}`,
  };
}
/** Binned case: no reassignment by anyone; server binning and restore still work. */
async function deletedCase(ctx) {
  const svc = await ctx.svc(`update public.interview_sessions set tenant_id = $2 where id = $1`, [S.del, T.b]);
  const svcRestoreMove = await ctx.svc(`update public.interview_sessions set tenant_id = $2, deleted_at = null where id = $1`, [S.del, T.b]);
  const cust = await apiAs(U.custA).from("interview_sessions").update({ tenant_id: T.b }).eq("id", S.del).select("id");
  const del = await ctx.caseRow(S.del);
  const bin = await call(sf.deleteSession, { sessionId: S.a3 }, U.ownerA);
  const binned = await ctx.caseRow(S.a3);
  const restore = await call(sf.restoreSession, { sessionId: S.a3 }, U.ownerA);
  const restored = await ctx.caseRow(S.a3);
  return {
    pass:
      !svc.ok && !svcRestoreMove.ok && refused(cust) && del.tenant_id === T.a && del.deleted_at !== null &&
      bin.ok && binned.deleted_at !== null && restore.ok && restored.deleted_at === null && restored.tenant_id === T.a,
    effect: del.tenant_id !== T.a || del.deleted_at === null,
    detail: `svc=${svc.code} restoreMove=${svcRestoreMove.code} cust=${cust.error?.code} bin=${bin.message ?? "ok"} restore=${restore.message ?? "ok"}`,
  };
}
/** Direct SQL / API by every applicable role. */
async function roleBypass(ctx) {
  const anon = {
    select: await ctx.as("anon", null, `select id from public.interview_sessions limit 1`),
    insert: await ctx.as("anon", null, `insert into public.interview_sessions (customer_id, tenant_id, status) values ($1,$2,'in_progress')`, [U.custA, T.b]),
    update: await ctx.as("anon", null, `update public.interview_sessions set tenant_id = $1`, [T.b]),
    del: await ctx.as("anon", null, `delete from public.interview_sessions`),
    truncate: await ctx.as("anon", null, `truncate public.interview_sessions cascade`),
  };
  const authTruncate = await ctx.as("authenticated", U.custA, `truncate public.interview_sessions cascade`);
  const svcMove = await ctx.svc(`update public.interview_sessions set tenant_id = $2 where id = $1`, [S.a3, T.b]);
  const svcApi = await svcClient.from("interview_sessions").update({ tenant_id: T.b }).eq("id", S.a3).select("id");
  const svcUpsert = await svcClient
    .from("interview_sessions")
    .upsert({ id: S.a3, customer_id: U.custA, tenant_id: T.b, status: "in_progress" }, { onConflict: "id" });
  const ownerMove = await ctx.as("postgres", null, `update public.interview_sessions set tenant_id = $2 where id = $1`, [S.a3, T.b]);
  const noop = await ctx.svc(`update public.interview_sessions set tenant_id = tenant_id, updated_at = now() where id = $1`, [S.a3]);
  const t = await ctx.tenantOf(S.a3);
  const anonDenied = Object.values(anon).every((r) => !r.ok && r.code === "42501");
  return {
    pass:
      anonDenied && !authTruncate.ok && !svcMove.ok && svcMove.code === "42501" && Boolean(svcApi.error) &&
      Boolean(svcUpsert.error) && !ownerMove.ok && noop.ok && noop.rowCount === 1 && t === T.a,
    effect: t !== T.a,
    detail: `anon=${Object.values(anon).map((r) => r.code ?? "ok").join(",")} trunc=${authTruncate.code} svc=${svcMove.code} api=${svcApi.error?.code} upsert=${svcUpsert.error?.code} owner=${ownerMove.code}`,
  };
}
/** Concurrent reassignment attempts while a progress update holds the row. */
async function concurrentReassign(ctx) {
  const holder = await ctx.connect();
  await holder.query("begin");
  await holder.query("set local role service_role");
  await holder.query(`update public.interview_sessions set updated_at = now() where id = $1`, [S.a2]);
  const attempts = [
    ...[T.b, null, T.b, null].map((t) => ctx.svc(`update public.interview_sessions set tenant_id = $2 where id = $1`, [S.a2, t])),
    ...[T.b, null].map((t) => ctx.as("authenticated", U.custA, `update public.interview_sessions set tenant_id = $2 where id = $1`, [S.a2, t])),
    ctx.as("authenticated", U.dualStaff, `update public.interview_sessions set tenant_id = $2 where id = $1`, [S.a2, T.b]),
    ...[1, 2, 3].map((i) =>
      ctx.as("authenticated", U.custA, `update public.interview_sessions set current_question_index = $2 where id = $1`, [S.a2, 10 + i]),
    ),
  ];
  await sleep(300);
  await holder.query("commit");
  await holder.end();
  const res = await Promise.all(attempts);
  const moves = res.slice(0, 7);
  const progress = res.slice(7);
  const t = await ctx.tenantOf(S.a2);
  return {
    pass: moves.every((r) => !r.ok && r.code === "42501") && progress.every((r) => r.ok && r.rowCount === 1) && t === T.a,
    effect: t !== T.a,
    detail: `moves=${moves.map((r) => r.code ?? "ok").join(",")} progress=${progress.map((r) => (r.ok ? r.rowCount : r.code)).join(",")}`,
  };
}
/** Contact, task, appointment, allocation, finance and referral records keep the case's tenant. */
async function childConsistency(ctx) {
  const mismatched = await ctx.q(
    CHILD_TABLES.filter((t) => t !== "referrals")
      .map(
        (t) => `select '${t}' k, x.session_id from public.${t} x join public.interview_sessions s on s.id = x.session_id
                where x.tenant_id is distinct from s.tenant_id`,
      )
      .join(" union all "),
  );
  const ref = await ctx.one(
    `select count(*)::int n from public.referrals r join public.interview_sessions s on s.customer_id = r.referred_user_id
     where s.id = $1 and r.tenant_id is distinct from s.tenant_id`,
    [S.a],
  );
  const unchanged = (await ctx.childState()) === ctx.childrenBefore;
  const caseA = await ctx.tenantOf(S.a);
  const feeMove = await ctx.svc(`update public.interview_sessions set tenant_id = $2 where id = $1`, [S.a, T.b]);
  return {
    pass: mismatched.length === 0 && ref.n === 0 && unchanged && caseA === T.a && !feeMove.ok,
    effect: mismatched.length > 0 || caseA !== T.a,
    detail: `mismatched=${JSON.stringify(mismatched)} ref=${ref.n} unchanged=${unchanged} fee=${feeMove.code}`,
  };
}
/** Platform Enter Company: no new privilege (progress update under a write session only). */
async function platformAccess(ctx) {
  const wProgress = await apiAs(U.platW).from("interview_sessions").update({ current_question_index: 7 }).eq("id", S.a3).select("id");
  const wMove = await apiAs(U.platW).from("interview_sessions").update({ tenant_id: T.b }).eq("id", S.a3).select("id");
  const wCreate = await apiAs(U.platW).from("interview_sessions").insert({ customer_id: U.custA, tenant_id: T.a, status: "in_progress" }).select("id");
  const wDelete = await apiAs(U.platW).from("interview_sessions").delete().eq("id", S.a3).select("id");
  const rProgress = await apiAs(U.platR).from("interview_sessions").update({ current_question_index: 9 }).eq("id", S.a3).select("id");
  const rRead = await apiAs(U.platR).from("interview_sessions").select("id").eq("id", S.a3);
  const wForeign = await apiAs(U.platW).from("interview_sessions").select("id").eq("id", S.b);
  const row = await ctx.caseRow(S.a3);
  return {
    pass:
      !wProgress.error && (wProgress.data ?? []).length === 1 && refused(wMove) && refused(wCreate) && refused(wDelete) &&
      (rProgress.data ?? []).length === 0 && (rRead.data ?? []).length === 1 && (wForeign.data ?? []).length === 0 &&
      row.current_question_index === 7 && row.tenant_id === T.a,
    effect: row.tenant_id !== T.a,
    detail: `wProgress=${wProgress.error?.code ?? (wProgress.data ?? []).length} move=${wMove.error?.code} create=${wCreate.error?.code} del=${wDelete.error?.code} rProgress=${(rProgress.data ?? []).length}`,
  };
}

// =============================================================================================
// RUN
// =============================================================================================
let exitCode = 1;
const keys = {};
try {
  await server.initialise();
  await server.start();
  serverStarted = true;
  {
    const c = new pg.Client({ ...baseCfg, database: "postgres" });
    await c.connect();
    await c.query(ROLES_SQL);
    await c.end();
  }

  const db = await buildDb("cto_main");
  useDb(db);
  const dml = ctoSql.match(/^\s*(update\s|insert\s+into\s|delete\s+from\s|truncate\s|alter\s+table\s)/gim) ?? [];
  ok(
    "CTO-00 fixture: the case tenant ownership migration applies over staging-shaped cases (tenant A/B, legacy tenantless, binned, a case with contact, task, appointment, allocation, fee and referral records), changes no row and contains no data or table-shape statement",
    db.migration.ok && (await db.caseState()) === db.casesBefore && (await db.childState()) === db.childrenBefore && dml.length === 0,
    db.migration.ok ? `dml=${dml.length}` : db.migration.message,
  );
  const cat = await db.one(`select
      (select count(*) from pg_trigger where tgrelid = 'public.interview_sessions'::regclass and not tgisinternal and tgenabled = 'O' and tgname = 'interview_sessions_tenant_guard')::int trg,
      (select string_agg(polname || '/' || polcmd::text, ',' order by polname) from pg_policy where polrelid = 'public.interview_sessions'::regclass) pols,
      has_any_column_privilege('anon','public.interview_sessions','SELECT,INSERT,UPDATE,REFERENCES') anon_any,
      has_table_privilege('authenticated','public.interview_sessions','INSERT') auth_ins,
      has_table_privilege('authenticated','public.interview_sessions','DELETE') auth_del,
      has_table_privilege('authenticated','public.interview_sessions','TRUNCATE') auth_trunc,
      has_column_privilege('authenticated','public.interview_sessions','tenant_id','UPDATE') auth_tenant,
      has_column_privilege('authenticated','public.interview_sessions','customer_id','UPDATE') auth_customer,
      has_column_privilege('authenticated','public.interview_sessions','deleted_at','UPDATE') auth_deleted,
      has_column_privilege('authenticated','public.interview_sessions','case_ref','UPDATE') auth_ref,
      has_column_privilege('authenticated','public.interview_sessions','status','UPDATE') auth_status,
      has_table_privilege('service_role','public.interview_sessions','SELECT,INSERT,UPDATE,DELETE') svc_dml,
      (select prosecdef from pg_proc where proname = 'interview_sessions_tenant_guard') definer,
      (select proconfig::text from pg_proc where proname = 'interview_sessions_tenant_guard') config`);
  ok(
    "CTO-01 catalogue: guard trigger enabled (SECURITY INVOKER, empty search_path); policies are SELECT + UPDATE only; anon holds nothing; authenticated cannot INSERT/DELETE/TRUNCATE or UPDATE tenant_id, customer_id, deleted_at or case_ref but can UPDATE progress; service_role keeps DML",
    cat.trg === 1 && cat.pols === "Read own or tenant sessions/r,Update own or tenant session progress/w" && !cat.anon_any &&
      !cat.auth_ins && !cat.auth_del && !cat.auth_trunc && !cat.auth_tenant && !cat.auth_customer && !cat.auth_deleted &&
      !cat.auth_ref && cat.auth_status && cat.svc_dml && cat.definer === false && cat.config === '{"search_path=\\"\\""}',
    JSON.stringify(cat),
  );

  const r02 = await customerMove(db);
  ok("CTO-02 a customer moving their populated case (tenant A) to tenant B through PATCH, upsert or SQL is refused; the case stays in tenant A", r02.pass, r02.detail);
  const r03 = await moveToNull(db);
  ok("CTO-03 a populated tenant cannot be cleared to NULL by the customer (API) or the service role (42501)", r03.pass, r03.detail);
  const r04 = await customerArbitrary(db);
  ok("CTO-04 customer-chosen tenants are refused: claiming a tenant for a legacy tenantless case, creating a case in another tenant or in their own tenant from the client (API and SQL); no case changes", r04.pass, r04.detail);
  const r05 = await customerProgress(db);
  ok("CTO-05 the customer's permitted writes still succeed: setSessionPosition and submitSession (real server functions on the user's client) and the interview-step summary, progress and submit-once shapes; tenant unchanged", r05.pass, r05.detail);
  const r06 = await customerServerOnly(db);
  ok("CTO-06 server-only case columns stay server-only for the customer: reactivating a binned case (deleted_at), rewriting case_ref and deleting the case are refused", r06.pass, r06.detail);

  // CTO-07: legitimate case creation through the real server paths.
  const created = await call(sf.createSession, { mode: "voice" }, U.custNew);
  const createdRow = created.ok ? await db.caseRow(created.value.id) : null;
  const viaBooking = await outcome(() => sf.createCaseSessionForCustomer(U.custNew, T.a));
  const bookingRow = viaBooking.ok ? await db.caseRow(viaBooking.value.id) : null;
  const foreignSlug = await call(sf.createSession, { mode: "voice", tenantSlug: SLUG.b }, U.custNew, SLUG.b);
  const custNewCases = await db.casesOf("custNew");
  ok(
    "CTO-07 legitimate case creation succeeds: createSession (sole-membership tenant) and createCaseSessionForCustomer (booking path) create cases in tenant A; createSession for a tenant slug without membership is refused and creates nothing",
    created.ok && createdRow?.tenant_id === T.a && createdRow?.customer_id === U.custNew && viaBooking.ok &&
      bookingRow?.tenant_id === T.a && !foreignSlug.ok && custNewCases.length === 2 && custNewCases.every((c) => c.tenant_id === T.a),
    `create=${created.message ?? "ok"} booking=${viaBooking.message ?? "ok"} foreign=${foreignSlug.message ?? "ok"} cases=${custNewCases.length}`,
  );
  const forced = withForcedTenantId({ customer_id: U.custNew, tenant_id: T.b }, T.a);
  const r08 = await tenantlessInsert(db);
  ok(
    "CTO-08 initial assignment happens only at server creation from the verified tenant: withForcedTenantId discards a client tenant_id; a tenantless INSERT (SQL or service API) is refused (23502) and creates nothing",
    forced.tenant_id === T.a && r08.pass,
    r08.detail,
  );
  const r09 = await staffMutation(db);
  ok("CTO-09 staff client writes: tenant B's Owner sees no tenant-A case to update; tenant A's Owner, and an adviser of both tenants, cannot move a case to tenant B (API or SQL), create a case or delete one; nothing changes", r09.pass, r09.detail);
  const r10 = await legacyTenantless(db);
  ok("CTO-10 the legacy tenantless case stays tenantless: service role (SQL and API) and the table owner cannot assign a tenant; its customer's progress update still saves", r10.pass, r10.detail);
  const r11 = await deletedCase(db);
  ok("CTO-11 binned case: reassignment by the service role (alone or with a restore) and by the customer is refused and it stays binned in tenant A; real deleteSession / restoreSession still bin and restore a case without touching its tenant", r11.pass, r11.detail);
  const r12 = await roleBypass(db);
  ok("CTO-12 direct bypass under every role fails: anon has no access at all; authenticated cannot TRUNCATE; service_role (SQL, API update, API upsert) and the table owner cannot change a tenant; a no-op write of the same tenant is accepted", r12.pass, r12.detail);
  const r13 = await concurrentReassign(db);
  ok("CTO-13 concurrency: seven reassignment attempts (service role, customer, dual-tenant adviser; to tenant B and to NULL) queued behind a row lock all fail with 42501 while concurrent progress updates succeed; the case stays in tenant A", r13.pass, r13.detail);
  const r14 = await platformAccess(db);
  ok("CTO-14 Platform Enter Company gains nothing: a write session can update progress of a tenant-A case but cannot move, create or delete cases; a read-only session can read but not update; no foreign-tenant visibility", r14.pass, r14.detail);
  const r15 = await childConsistency(db);
  ok("CTO-15 ownership consistency after every attempt: contact log, tracking, tasks, appointments, allocations, fee lines and referrals carry their case's tenant and are byte-identical; the fee-bearing case cannot be moved either", r15.pass, r15.detail);

  // CTO-16: fail-closed preconditions.
  const before16 = await db.caseState();
  const again = await outcome(() => db.admin.query(ctoSql));
  const drift = await buildDb("cto_drift_acl", {
    sql: false,
    before: async ({ q }) => q(`grant update (tenant_id) on public.interview_sessions to authenticated`),
  });
  const driftAcl = await outcome(() => drift.admin.query(ctoSql));
  const driftAclClean = (await drift.caseState()) === drift.casesBefore &&
    (await drift.one(`select to_regprocedure('public.interview_sessions_tenant_guard()') is null x`)).x;
  await drift.admin.end();
  const drift2 = await buildDb("cto_drift_policy", {
    sql: false,
    before: async ({ q }) => q(`create policy "Drift insert" on public.interview_sessions for insert to authenticated with check (true)`),
  });
  const driftPol = await outcome(() => drift2.admin.query(ctoSql));
  await drift2.admin.end();
  ok(
    "CTO-16 fail-closed: re-applying stops at objects_present; an explicit column grant stops at column_acl and an unexpected policy at policies, with no object created and no row changed",
    !again.ok && /objects_present/.test(again.message) && (await db.caseState()) === before16 &&
      !driftAcl.ok && /column_acl/.test(driftAcl.message) && driftAclClean && !driftPol.ok && /policies/.test(driftPol.message),
    `${again.message} | ${driftAcl.message} | ${driftPol.message}`,
  );
  const committed = Object.entries(COMMITTED).every(([rel, h]) => sha256(read(rel)) === h);
  ok(
    "CTO-17 scope: the committed B4c-1 and contact tenant attribution migrations are unchanged; the new migration contains no transfer, backfill or reconciliation facility",
    committed && !/transfer_case|reassign|backfill_tenant/i.test(ctoSql.replace(/^--.*$/gm, "")),
  );
  ok("CTO-18 no unexpected network or PostgREST call was made", unknownCalls.length === 0, unknownCalls.join(" | "));

  keys.update = r02.pass;
  keys.nul = r03.pass;
  keys.cross = r04.pass && r09.pass;
  keys.create = r05.pass;
  keys.legacy = r10.pass;
  keys.deleted = r11.pass && r06.pass;

  // --- negative controls ------------------------------------------------------------------------
  const noPost = (sql) => sql.slice(0, sql.indexOf("-- F. Postconditions."));
  const mutate = (sql, pairs) => {
    let out = sql;
    for (const [from, to] of pairs) {
      if (!out.includes(from)) return null;
      out = out.split(from).join(to);
    }
    return out;
  };
  const migrationNc = async (label, dbName, sql, run) => {
    let effect = false;
    let caught = false;
    let detail = "";
    if (sql !== null) {
      const m = await buildDb(dbName, { sql });
      if (sql === false || m.migration.ok) {
        useDb(m);
        ({ effect, caught, detail = "" } = await run(m));
        await m.pool.end();
      } else detail = m.migration.message;
      await m.admin.end();
      useDb(db);
    } else detail = "mutation anchor missing";
    nc(label, { effect, caught, detail });
  };
  const IMMUTABLE = "  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN\n    RAISE EXCEPTION 'case tenant is immutable'";
  const fromPredicate = (p) => async (m) => {
    const r = await p(m);
    return { effect: r.effect, caught: !r.pass, detail: r.detail };
  };

  await migrationNc(
    "NC01 without the migration → the customer moves their case to tenant B through their own client; CTO-02 rejects",
    "cto_nc_nomig",
    false,
    fromPredicate(customerMove),
  );
  await migrationNc(
    "NC02 guard without UPDATE immutability → the service role moves a case to tenant B; CTO-12 rejects",
    "cto_nc_mutable",
    mutate(ctoSql, [[IMMUTABLE, "  IF false THEN\n    RAISE EXCEPTION 'case tenant is immutable'"]]),
    fromPredicate(roleBypass),
  );
  await migrationNc(
    "NC03 trigger only, client privileges left as they were → the customer creates a case in tenant B; CTO-04 rejects",
    "cto_nc_grants",
    mutate(noPost(ctoSql), [
      [ctoSql.slice(ctoSql.indexOf("-- D. Client privileges"), ctoSql.indexOf("-- E. Policies")), ""],
      [ctoSql.slice(ctoSql.indexOf("-- E. Policies"), ctoSql.indexOf("COMMENT ON FUNCTION")), ""],
    ]),
    fromPredicate(customerArbitrary),
  );
  await migrationNc(
    "NC04 trigger only, client privileges left as they were → the customer reactivates a binned case and deletes a case; CTO-06 rejects",
    "cto_nc_grants2",
    mutate(noPost(ctoSql), [
      [ctoSql.slice(ctoSql.indexOf("-- D. Client privileges"), ctoSql.indexOf("-- E. Policies")), ""],
      [ctoSql.slice(ctoSql.indexOf("-- E. Policies"), ctoSql.indexOf("COMMENT ON FUNCTION")), ""],
    ]),
    fromPredicate(customerServerOnly),
  );
  await migrationNc(
    "NC05 guard allowing a first assignment (NULL → tenant) → the legacy tenantless case is silently assigned; CTO-10 rejects",
    "cto_nc_firstassign",
    mutate(ctoSql, [[IMMUTABLE, "  IF OLD.tenant_id IS NOT NULL AND NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN\n    RAISE EXCEPTION 'case tenant is immutable'"]]),
    fromPredicate(legacyTenantless),
  );
  await migrationNc(
    "NC06 guard allowing a move to NULL → the service role clears a populated tenant; CTO-03 rejects",
    "cto_nc_tonull",
    mutate(ctoSql, [[IMMUTABLE, "  IF NEW.tenant_id IS NOT NULL AND NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN\n    RAISE EXCEPTION 'case tenant is immutable'"]]),
    fromPredicate(moveToNull),
  );
  await migrationNc(
    "NC07 guard trusting the service role → a service-role connection transfers a case; CTO-12 rejects",
    "cto_nc_svctrust",
    mutate(ctoSql, [["BEGIN\n  IF TG_OP = 'INSERT' THEN", "BEGIN\n  IF current_user = 'service_role' THEN\n    RETURN NEW;\n  END IF;\n  IF TG_OP = 'INSERT' THEN"]]),
    fromPredicate(roleBypass),
  );
  await migrationNc(
    "NC08 guard without the INSERT tenant requirement → a tenantless case is created; CTO-08 rejects",
    "cto_nc_tenantless",
    mutate(ctoSql, [["    IF NEW.tenant_id IS NULL THEN\n      RAISE EXCEPTION 'case tenant is required'", "    IF false THEN\n      RAISE EXCEPTION 'case tenant is required'"]]),
    fromPredicate(tenantlessInsert),
  );
  await migrationNc(
    "NC09 guard skipping binned cases → the service role moves a binned case to tenant B; CTO-11 rejects",
    "cto_nc_binned",
    mutate(ctoSql, [[IMMUTABLE, "  IF OLD.deleted_at IS NULL AND NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN\n    RAISE EXCEPTION 'case tenant is immutable'"]]),
    fromPredicate(deletedCase),
  );
  await migrationNc(
    "NC10 guard without UPDATE immutability → concurrent reassignment moves the case; CTO-13 rejects",
    "cto_nc_race",
    mutate(ctoSql, [[IMMUTABLE, "  IF false THEN\n    RAISE EXCEPTION 'case tenant is immutable'"]]),
    fromPredicate(concurrentReassign),
  );
  await migrationNc(
    "NC11 over-strict client grant (progress columns without status/submitted_at) → the real submitSession breaks; CTO-05 rejects",
    "cto_nc_overstrict",
    mutate(noPost(ctoSql), [
      ["GRANT UPDATE (status, submitted_at, summary,", "GRANT UPDATE (summary,"],
    ]),
    fromPredicate(customerProgress),
  );

  await db.pool?.end();
  await db.admin.end();

  const ncPass = ncResults.filter((r) => r.pass).length;
  console.log(`CUSTOMER_TENANT_UPDATE_REFUSED=${keys.update ? "YES" : "NO"}`);
  console.log(`CUSTOMER_TENANT_NULL_REFUSED=${keys.nul ? "YES" : "NO"}`);
  console.log(`CROSS_TENANT_ASSIGNMENT_REFUSED=${keys.cross ? "YES" : "NO"}`);
  console.log(`LEGITIMATE_PROGRESS_WRITES_PRESERVED=${keys.create ? "YES" : "NO"}`);
  console.log(`LEGACY_TENANTLESS_CASES_PRESERVED=${keys.legacy ? "YES" : "NO"}`);
  console.log(`DELETED_CASE_PROTECTED=${keys.deleted ? "YES" : "NO"}`);
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
