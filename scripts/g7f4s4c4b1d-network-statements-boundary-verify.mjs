/**
 * G7F-4S4C4-B1d network-commission statements tenant boundary — offline verification.
 * The real network-statement server-function validators and handlers run against an in-memory
 * PostgREST fake on a non-routable host; the OpenAI call is replaced by an in-process recorder.
 * Negative controls load in-memory mutated copies of the module (nothing is written to disk).
 * Synthetic fixtures only: no database, no network, no production, no real customer, staff or
 * privileged identity, no phone numbers, no secrets.
 * Run: npm exec --yes --package=tsx -- tsx scripts/g7f4s4c4b1d-network-statements-boundary-verify.mjs
 */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
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
  "APP_BASE_URL",
  "VITE_APP_URL",
  "APP_URL",
  "WEBSITE_SITE_NAME",
  "WEBSITE_HOSTNAME",
]) {
  delete process.env[k];
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REF_FILE = "src/lib/network-commission.functions.ts";
// Baseline commit B1d was implemented against (pre-B1d network functions).
const BASE_REF = "39f83692";
// Public, deliberately generic message for the global UNIQUE(period_month) B4 blocker.
const CONFLICT_MESSAGE =
  "This month can't be opened here yet. Please contact support if this continues.";

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

// --- module stubs: createServerFn capture, request Referer, Enter Company, OpenAI recorder ------
const realStartUrl = import.meta.resolve("@tanstack/react-start");
const realStartServerUrl = import.meta.resolve("@tanstack/react-start/server");
const realRefUrl = pathToFileURL(resolve(root, REF_FILE)).href;
const MUTANT_MARK = "/*b1d-mutant*/";
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
export function getRequest() { return globalThis.__B1D_REQUEST ?? null; }
export function getCookie() { return undefined; }
export function setCookie() {}
export function deleteCookie() {}
`;
const stubPlatform = `
export async function validatePlatformTenantAccessSession(input) {
  return globalThis.__B1D_PLATFORM?.get(input.userId + ":" + input.tenantId) ?? null;
}
export async function hasValidPlatformTenantAccess() { return false; }
export async function clearPlatformTenantEntryOnLogout() {}
`;
const stubOpenai = `
export async function chatCompletion() { return globalThis.__B1D_AI ?? "{}"; }
export const OPENAI_CHAT_MODEL = "gpt-4o-mini";
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
  if (/(^|\\/)openai\\.server(\\.ts)?$/.test(specifier) && !fromData) {
    return { url: ${JSON.stringify(dataUrl(stubOpenai))}, shortCircuit: true };
  }
  return next(specifier, context);
}
`;
register(dataUrl(hookSource), import.meta.url);

// --- synthetic fixtures ------------------------------------------------------------------------
const FAKE_HOST = "g7f4s4c4b1d.invalid";
process.env.SUPABASE_URL = `http://${FAKE_HOST}`;
process.env.VITE_SUPABASE_URL = `http://${FAKE_HOST}`;
process.env.SUPABASE_SERVICE_ROLE_KEY = "synthetic_service_role_g7f4s4c4b1d_not_a_real_key";
process.env.SUPABASE_PUBLISHABLE_KEY = "synthetic_publishable_g7f4s4c4b1d_not_a_real_key";
process.env.VITE_SUPABASE_PUBLISHABLE_KEY = "synthetic_publishable_g7f4s4c4b1d_not_a_real_key";
process.env.APP_BASE_URL = "http://app.invalid";

const id = (prefix, n) =>
  `${prefix}${String(n).repeat(7).slice(0, 7)}-0000-4000-8000-${String(n).padStart(12, "0")}`;
const T = { a: id("1", 1), b: id("1", 2) };
const U = {
  ownerA: id("2", 1),
  ownerB: id("2", 2),
  supA: id("2", 3),
  supB: id("2", 4),
  genA: id("2", 5),
  advA: id("2", 6),
  introA: id("2", 7),
  dual: id("2", 8),
  platRO: id("3", 1),
  platOp: id("3", 2),
  outsider: id("3", 3),
  custA: id("4", 1),
  custB: id("4", 2),
};
const SESS = { a: id("8", 1), b: id("8", 2) };
const ST = { a: id("9", 1), b: id("9", 2), nul: id("9", 3) };
const LN = { a: id("a", 1), b: id("a", 2), nul: id("a", 3) };
const RANDOM = "9f9f9f9f-9f9f-4f9f-8f9f-9f9f9f9f9f9f";
const EMAIL_A = "customer@alpha.example.test";
const EMAIL_B = "customer@bravo.example.test";
const MONTH_A = "2026-01-01";
const MONTH_B = "2026-02-01";
const MONTH_NUL = "2026-03-01";
const MONTH_FREE = "2026-09";
const daysAgo = (d) => new Date(Date.now() - d * 86400000).toISOString();
const RAW_TEXT = "Network statement extract: Alpha case, Bravo case, totals ignored padding.";
// The AI "extraction": one line resolvable only in tenant A, one only in tenant B.
const AI_CONTENT = JSON.stringify({
  lines: [
    {
      customerName: "Alpha",
      customerEmail: EMAIL_A,
      caseRef: "CASE-A",
      feeType: "fee",
      amountPounds: 100,
    },
    {
      customerName: "Bravo",
      customerEmail: EMAIL_B,
      caseRef: "CASE-B",
      feeType: "fee",
      amountPounds: 200,
    },
  ],
});
globalThis.__B1D_AI = AI_CONTENT;

let db;
const writes = [];
const reads = [];
const unknownCalls = [];
function resetDb() {
  const mem = (user_id, tenant_id, role) => ({
    id: randomUUID(),
    user_id,
    tenant_id,
    role,
    active: true,
  });
  const statement = (sid, tenant_id, period_month, status) => ({
    id: sid,
    tenant_id,
    period_month,
    status,
    notes: null,
    raw_source: null,
    validated_by: null,
    validated_at: null,
    created_by: tenant_id ? "seed" : null,
    created_at: daysAgo(10),
    updated_at: daysAgo(10),
  });
  const line = (lid, sid, tenant_id, case_ref) => ({
    id: lid,
    statement_id: sid,
    tenant_id,
    line_no: 1,
    customer_name: "Seed",
    customer_email: null,
    case_ref,
    fee_type: "fee",
    amount_received_pence: 10000,
    network_product: null,
    raw_json: {},
    matched_customer_id: null,
    matched_session_id: null,
    fee_line_id: null,
    allocation_status: "unmatched",
    allocated_by: null,
    allocated_at: null,
    annotation: null,
    created_at: daysAgo(9),
    updated_at: daysAgo(9),
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
      mem(U.ownerB, T.b, "owner"),
      mem(U.supA, T.a, "supervisor"),
      mem(U.supB, T.b, "supervisor"),
      mem(U.genA, T.a, "general"),
      mem(U.advA, T.a, "adviser"),
      mem(U.introA, T.a, "introducer"),
      // A2 model: one identity holds memberships in two tenants with different roles.
      mem(U.dual, T.a, "owner"),
      mem(U.dual, T.b, "introducer"),
      // Platform operator's home tenant is B; platform entry targets A.
      mem(U.platOp, T.b, "owner"),
    ],
    admin_permissions: [
      // General admin A: finance_network_statements amend (view+amend), no validate grant.
      {
        user_id: U.genA,
        tenant_id: T.a,
        permission_key: "finance_network_statements",
        access: "amend",
      },
    ],
    profiles: [
      { id: U.custA, full_name: "Alpha Customer", email: EMAIL_A, phone: "PROFILEPHONE-A" },
      { id: U.custB, full_name: "Bravo Customer", email: EMAIL_B, phone: "PROFILEPHONE-B" },
    ],
    interview_sessions: [
      {
        id: SESS.a,
        customer_id: U.custA,
        tenant_id: T.a,
        case_ref: "CASE-A",
        deleted_at: null,
        created_at: daysAgo(4),
      },
      {
        id: SESS.b,
        customer_id: U.custB,
        tenant_id: T.b,
        case_ref: "CASE-B",
        deleted_at: null,
        created_at: daysAgo(4),
      },
    ],
    network_commission_statements: [
      statement(ST.a, T.a, MONTH_A, "draft"),
      statement(ST.b, T.b, MONTH_B, "draft"),
      statement(ST.nul, null, MONTH_NUL, "draft"),
    ],
    network_commission_lines: [
      line(LN.a, ST.a, T.a, "CASE-A"),
      line(LN.b, ST.b, T.b, "CASE-B"),
      line(LN.nul, ST.nul, null, "CASE-NUL"),
    ],
    finance_fee_lines: [],
    session_advisors: [],
    appointments: [],
  };
  writes.length = 0;
  reads.length = 0;
  unknownCalls.length = 0;
}

globalThis.__B1D_PLATFORM = new Map([
  [`${U.platRO}:${T.a}`, { accessLevel: "read_only", basisLabel: "synthetic read-only" }],
  [`${U.platOp}:${T.a}`, { accessLevel: "operational_admin", basisLabel: "synthetic operational" }],
]);

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
  return out.slice(offset, limit ? offset + Number(limit) : undefined);
}
/** Minimal PostgREST embedded-resource support for network_commission_lines. */
function embedStatements(table, rows, select) {
  if (table !== "network_commission_lines" || !select.includes("network_commission_statements")) {
    return rows;
  }
  const inner = /network_commission_statements!inner/.test(select);
  return rows
    .map((r) => ({
      ...r,
      network_commission_statements:
        db.network_commission_statements.find((s) => s.id === r.statement_id) ?? null,
    }))
    .filter((r) => !inner || r.network_commission_statements);
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

globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === "string" ? input : (input.url ?? String(input)));
  if (url.hostname !== FAKE_HOST) {
    unknownCalls.push(`refused host ${url.hostname}`);
    throw new Error(`G7F4S4C4B1D fetch stub refused host ${url.hostname}`);
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
    unknownCalls.push(`rpc ${fn}`);
    return json(null);
  }

  if (p.startsWith("/rest/v1/")) {
    const table = p.slice("/rest/v1/".length);
    const rows = tableRows(table);
    if (method === "GET" || method === "HEAD") {
      reads.push({ table, filter: decodeURIComponent(url.search) });
      const select = url.searchParams.get("select") ?? "";
      return respondRows(embedStatements(table, applyFilters(rows, url), select), headers, method);
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
        // Global UNIQUE(period_month): same month in ANY tenant collides (B4 blocker).
        if (
          table === "network_commission_statements" &&
          rows.some((r) => String(r.period_month) === String(row.period_month))
        )
          return json(
            { code: "23505", message: "duplicate key value violates unique constraint" },
            409,
          );
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

// --- load real modules and in-memory mutants ---------------------------------------------------
resetDb();
const nf = await import("../src/lib/network-commission.functions.ts");
const ta = await import("../src/lib/tenant-assert.server.ts");
const REF_SRC = readFileSync(resolve(root, REF_FILE), "utf8");

async function loadMutant(src) {
  const js = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return import(dataUrl(`${MUTANT_MARK}\n${js}\n// ${randomUUID()}`));
}
function replaceInWriter(src, name, from, to) {
  const block = topLevelDeclaration(src, name);
  if (!block) return null;
  const changed = typeof from === "string" ? block.split(from).join(to) : block.replace(from, to);
  return changed === block ? null : src.replace(block, changed);
}

async function invoke(fn, data, context) {
  const d = fn.__def;
  const parsed = d.validator ? await d.validator(data) : data;
  return d.handler({ data: parsed, context });
}
/** Actor context; `slug` simulates the verified /$tenantSlug route carried in the Referer. */
function as(userId, slug = null) {
  return { userId, slug };
}
async function call(mod, name, data, actor) {
  globalThis.__B1D_REQUEST = actor.slug
    ? new Request(`http://app.invalid/_serverFn/x`, {
        headers: { referer: `http://app.invalid/${actor.slug}/admin/finance` },
      })
    : null;
  return outcome(() =>
    invoke(mod[name], data, {
      userId: actor.userId,
      claims: { sub: actor.userId },
      supabase: null,
    }),
  );
}
const NOT_FOUND = ta.RESOURCE_NOT_FOUND_MESSAGE;
const notFound = (r) => !r.ok && r.message === NOT_FOUND;
const forbidden = (r) => !r.ok && r.message === "Forbidden";
const NET_TABLES = [
  "network_commission_statements",
  "network_commission_lines",
  "finance_fee_lines",
];
const snap = () => JSON.stringify(NET_TABLES.map((t) => db[t]));
const SECRETS = [
  "Alpha Customer",
  "Bravo Customer",
  EMAIL_A,
  EMAIL_B,
  "tenant-a",
  "tenant-b",
  T.a,
  T.b,
  ST.a,
  ST.b,
];
const leakFree = (r) => !r.ok && !SECRETS.some((s) => r.message.includes(s));
/** Denied with no side effect: no network table change and no write. */
async function deniedClean(run, expect) {
  const before = snap();
  const w0 = writes.length;
  const r = await run();
  return {
    r,
    clean: expect(r) && leakFree(r) && snap() === before && writes.length === w0,
  };
}

const ownerA = as(U.ownerA, "tenant-a");
const ownerB = as(U.ownerB, "tenant-b");
const supA = as(U.supA, "tenant-a");
const supB = as(U.supB, "tenant-b");
const genA = as(U.genA, "tenant-a");
const advA = as(U.advA, "tenant-a");
const introA = as(U.introA, "tenant-a");
const dualA = as(U.dual, "tenant-a");
const dualB = as(U.dual, "tenant-b");
const dualNone = as(U.dual, null);
const platRO = as(U.platRO, "tenant-a");
const platOp = as(U.platOp, "tenant-a");
const outsider = as(U.outsider, null);

// --- static guards ------------------------------------------------------------------------------
function staticGuards(raw) {
  const blk = (n) => strip(topLevelDeclaration(raw, n) ?? "");
  const viewCap = blk("networkViewCapability");
  const amendCap = blk("networkAmendCapability");
  const validateCap = blk("networkValidateCapability");
  const list = blk("listNetworkStatementMonths");
  const create = blk("getOrCreateNetworkStatement");
  const detail = blk("getNetworkStatementDetail");
  const parse = blk("parseNetworkStatementWithAi");
  const allocate = blk("allocateNetworkLine");
  const annotate = blk("annotateNetworkLine");
  const validate = blk("validateNetworkStatement");
  const acting = (s, cap) =>
    new RegExp(`resolveActingTenantForList\\(\\s*context\\.userId,\\s*${cap}\\(\\),?\\s*\\)`).test(
      s,
    );
  const legacyAuthority = /resolveAdminAccess|requireAdmin\(|resolveSoleMembershipTenant/;
  const idTenantMaybe =
    /\.eq\("id", data\.statementId\)\s*\.eq\("tenant_id", tenantId\)\s*\.maybeSingle\(\)/;
  const lineIdTenantMaybe =
    /\.eq\("id", data\.lineId\)\s*\.eq\("tenant_id", tenantId\)\s*\.maybeSingle\(\)/;
  const stmtTenantGuard =
    /if \(!stmt \|\| stmt\.tenant_id !== tenantId\) throw new Error\(RESOURCE_NOT_FOUND_MESSAGE\);/;
  return {
    viewCapability:
      /mutate: false/.test(viewCap) &&
      /allocation: "none"/.test(viewCap) &&
      /canViewNetwork\(v\.adminAccess\)/.test(viewCap),
    amendCapability:
      /mutate: true/.test(amendCap) &&
      /allocation: "none"/.test(amendCap) &&
      /canAmendNetwork\(v\.adminAccess\)/.test(amendCap),
    validateCapability:
      /mutate: true/.test(validateCap) &&
      /allocation: "none"/.test(validateCap) &&
      /canValidateNetwork\(v\.adminAccess\)/.test(validateCap),
    allActing:
      acting(list, "networkViewCapability") &&
      acting(create, "networkAmendCapability") &&
      acting(detail, "networkViewCapability") &&
      acting(parse, "networkAmendCapability") &&
      acting(allocate, "networkAmendCapability") &&
      acting(annotate, "networkAmendCapability") &&
      acting(validate, "networkValidateCapability"),
    noLegacyAuthority: !legacyAuthority.test(strip(raw)),
    listScoped:
      acting(list, "networkViewCapability") &&
      !legacyAuthority.test(list) &&
      /\.from\("network_commission_statements"\)[\s\S]*?\.eq\("tenant_id", tenantId\)\s*\.order\("period_month"/.test(
        list,
      ),
    detailScoped:
      acting(detail, "networkViewCapability") &&
      idTenantMaybe.test(detail) &&
      /if \(!statement\) throw new Error\(RESOURCE_NOT_FOUND_MESSAGE\);/.test(detail) &&
      /\.eq\("statement_id", data\.statementId\)\s*\.eq\("tenant_id", tenantId\)/.test(detail),
    createScoped:
      acting(create, "networkAmendCapability") &&
      /\.eq\("tenant_id", tenantId\)\s*\.eq\("period_month", period\)/.test(create) &&
      /withForcedTenantId\(\s*\{[\s\S]*?period_month: period,[\s\S]*?\},\s*tenantId,\s*\)/.test(
        create,
      ) &&
      /isUniqueViolation\(error\)[\s\S]*?PERIOD_MONTH_UNAVAILABLE_MESSAGE/.test(create),
    parseStatementProof:
      acting(parse, "networkAmendCapability") &&
      idTenantMaybe.test(parse) &&
      /if \(!statement\) throw new Error\(RESOURCE_NOT_FOUND_MESSAGE\);/.test(parse),
    parseStampScoped: /rows\.map\(\(r\) => withForcedTenantId\(r, tenantId\)\)/.test(parse),
    parseMatchScoped:
      /\.eq\("customer_id", candidate\)\s*\.eq\("tenant_id", tenantId\)/.test(parse) &&
      /\.eq\("case_ref", line\.case_ref\)\s*\.eq\("tenant_id", tenantId\)/.test(parse) &&
      /\.eq\("customer_id", customerId\)\s*\.eq\("tenant_id", tenantId\)/.test(parse),
    allocateLineScoped:
      acting(allocate, "networkAmendCapability") &&
      lineIdTenantMaybe.test(allocate) &&
      /network_commission_statements!inner/.test(allocate) &&
      stmtTenantGuard.test(allocate) &&
      /\.eq\("id", data\.lineId\)\s*\.eq\("tenant_id", tenantId\);/.test(allocate),
    allocateSessionScoped:
      /\.eq\("id", sessionId\)\s*\.eq\("tenant_id", tenantId\)\s*\.maybeSingle\(\)/.test(allocate),
    financeStampScoped:
      /\.from\("finance_fee_lines"\)[\s\S]*?withForcedTenantId\(\s*\{[\s\S]*?session_id: sessionId,[\s\S]*?\},\s*tenantId,\s*\)/.test(
        allocate,
      ),
    annotateScoped:
      acting(annotate, "networkAmendCapability") &&
      lineIdTenantMaybe.test(annotate) &&
      stmtTenantGuard.test(annotate) &&
      /\.eq\("id", data\.lineId\)\s*\.eq\("tenant_id", tenantId\);/.test(annotate),
    validateScoped:
      acting(validate, "networkValidateCapability") &&
      idTenantMaybe.test(validate) &&
      (validate.match(/\.eq\("id", data\.statementId\)\s*\.eq\("tenant_id", tenantId\);/g) ?? [])
        .length === 2 &&
      /if \(!view\.adminAccess\.isOwner && !view\.adminAccess\.isSupervisor\)/.test(validate),
  };
}

// --- runtime boundary checks (shared by real module and negative controls) ---------------------
async function crossListSafe(mod) {
  resetDb();
  const checks = [];
  for (const [actor, own, ownMonth, foreign] of [
    [ownerA, ST.a, MONTH_A, [ST.b, ST.nul]],
    [ownerB, ST.b, MONTH_B, [ST.a, ST.nul]],
  ]) {
    const r = await call(mod, "listNetworkStatementMonths", {}, actor);
    const ids = r.ok ? r.value.months.map((m) => m.statementId) : [];
    checks.push(r.ok && ids.includes(own) && foreign.every((f) => !ids.includes(f)));
  }
  return checks.every(Boolean);
}
async function crossDetailSafe(mod) {
  resetDb();
  const checks = [];
  for (const [actor, foreign] of [
    [ownerA, ST.b],
    [ownerB, ST.a],
    [ownerA, ST.nul],
  ]) {
    const { clean } = await deniedClean(
      () => call(mod, "getNetworkStatementDetail", { statementId: foreign }, actor),
      notFound,
    );
    checks.push(clean);
  }
  return checks.every(Boolean);
}
async function crossParseSafe(mod) {
  resetDb();
  const checks = [];
  for (const [actor, foreign] of [
    [ownerA, ST.b],
    [ownerB, ST.a],
    [ownerA, ST.nul],
  ]) {
    const { clean } = await deniedClean(
      () =>
        call(
          mod,
          "parseNetworkStatementWithAi",
          { statementId: foreign, rawText: RAW_TEXT },
          actor,
        ),
      notFound,
    );
    checks.push(clean);
  }
  return checks.every(Boolean);
}
async function parseMatchSafe(mod) {
  resetDb();
  const r = await call(
    mod,
    "parseNetworkStatementWithAi",
    { statementId: ST.a, rawText: RAW_TEXT },
    ownerA,
  );
  const lines = db.network_commission_lines.filter((l) => l.statement_id === ST.a);
  const matchedA = lines.find((l) => l.customer_email === EMAIL_A);
  return (
    r.ok &&
    lines.every((l) => l.tenant_id === T.a) &&
    !lines.some((l) => l.matched_customer_id === U.custB) &&
    Boolean(matchedA) &&
    matchedA.matched_customer_id === U.custA &&
    matchedA.matched_session_id === SESS.a
  );
}
async function allocateForeignSessionSafe(mod) {
  resetDb();
  const { clean } = await deniedClean(
    () => call(mod, "allocateNetworkLine", { lineId: LN.a, sessionId: SESS.b }, ownerA),
    notFound,
  );
  return clean && !db.finance_fee_lines.some((f) => f.session_id === SESS.b);
}
async function allocateStampSafe(mod) {
  resetDb();
  const r = await call(mod, "allocateNetworkLine", { lineId: LN.a, sessionId: SESS.a }, ownerA);
  const fee = db.finance_fee_lines[0];
  return r.ok && Boolean(fee) && fee.tenant_id === T.a && fee.session_id === SESS.a;
}
async function crossAnnotateSafe(mod) {
  resetDb();
  const checks = [];
  for (const [actor, foreign] of [
    [ownerA, LN.b],
    [ownerB, LN.a],
    [ownerA, LN.nul],
  ]) {
    const { clean } = await deniedClean(
      () => call(mod, "annotateNetworkLine", { lineId: foreign, annotation: "x" }, actor),
      notFound,
    );
    checks.push(clean);
  }
  return checks.every(Boolean);
}
async function crossValidateSafe(mod) {
  resetDb();
  const checks = [];
  for (const [actor, foreign] of [
    [ownerA, ST.b],
    [ownerB, ST.a],
    [ownerA, ST.nul],
  ]) {
    const { clean } = await deniedClean(
      () =>
        call(mod, "validateNetworkStatement", { statementId: foreign, action: "validate" }, actor),
      notFound,
    );
    checks.push(clean);
  }
  return checks.every(Boolean);
}
async function createStampSafe(mod) {
  resetDb();
  const r = await call(mod, "getOrCreateNetworkStatement", { periodMonth: MONTH_FREE }, ownerA);
  const ins = writes.filter(
    (w) => w.method === "INSERT" && w.table === "network_commission_statements",
  );
  return r.ok && r.value.created === true && ins.length === 1 && ins[0].row.tenant_id === T.a;
}

// =============================================================================================
// B1D-01..03 static guards
// =============================================================================================
const G = staticGuards(REF_SRC);
ok(
  "B1D-01 networkViewCapability / networkAmendCapability / networkValidateCapability use the ResourceCapability model (mutate flag + canViewNetwork/canAmendNetwork/canValidateNetwork bound to the acting view)",
  G.viewCapability && G.amendCapability && G.validateCapability,
  JSON.stringify({ v: G.viewCapability, a: G.amendCapability, val: G.validateCapability }),
);
ok(
  "B1D-02 all seven network-statement entry points resolve one canonical acting tenant via resolveActingTenantForList; no resolveAdminAccess / requireAdmin / resolveSoleMembershipTenant authority remains",
  G.allActing && G.noLegacyAuthority,
  JSON.stringify({ allActing: G.allActing, noLegacy: G.noLegacyAuthority }),
);
ok(
  "B1D-03 static tenant guards across list/detail/create/parse/allocate/annotate/validate: tenant-scoped reads, Not found ordering, withForcedTenantId stamping, session bound to acting tenant, AI match acting-tenant-only, unique-violation fail-closed",
  G.listScoped &&
    G.detailScoped &&
    G.createScoped &&
    G.parseStatementProof &&
    G.parseStampScoped &&
    G.parseMatchScoped &&
    G.allocateLineScoped &&
    G.allocateSessionScoped &&
    G.financeStampScoped &&
    G.annotateScoped &&
    G.validateScoped,
  JSON.stringify(G),
);

// =============================================================================================
// B1D-04..09 same-tenant authorised operations (owner / supervisor)
// =============================================================================================
ok(
  "B1D-04 owner A / owner B list only their own tenant's statements; foreign and tenantless statements never appear",
  await crossListSafe(nf),
);
{
  resetDb();
  const existing = await call(
    nf,
    "getOrCreateNetworkStatement",
    { periodMonth: "2026-01" },
    ownerA,
  );
  const insExisting = writes.filter((w) => w.method === "INSERT");
  const created = await call(
    nf,
    "getOrCreateNetworkStatement",
    { periodMonth: MONTH_FREE },
    ownerA,
  );
  const insCreated = writes.filter(
    (w) => w.method === "INSERT" && w.table === "network_commission_statements",
  );
  ok(
    "B1D-05 getOrCreate returns the acting tenant's existing month without a write, and stamps new statements with the acting tenant",
    existing.ok &&
      existing.value.created === false &&
      existing.value.statement.id === ST.a &&
      insExisting.length === 0 &&
      created.ok &&
      created.value.created === true &&
      insCreated.length === 1 &&
      insCreated[0].row.tenant_id === T.a,
    [existing.message, created.message].filter(Boolean).join(" | "),
  );
}
{
  resetDb();
  const r = await call(nf, "getNetworkStatementDetail", { statementId: ST.a }, ownerA);
  const rb = await call(nf, "getNetworkStatementDetail", { statementId: ST.b }, supB);
  ok(
    "B1D-06 owner A / supervisor B read their own statement detail with only their own tenant's lines",
    r.ok &&
      r.value.statement.id === ST.a &&
      r.value.lines.every((l) => l.tenant_id === T.a) &&
      rb.ok &&
      rb.value.statement.id === ST.b &&
      rb.value.lines.every((l) => l.tenant_id === T.b),
    [r.message, rb.message].filter(Boolean).join(" | "),
  );
}
{
  resetDb();
  const r = await call(
    nf,
    "parseNetworkStatementWithAi",
    { statementId: ST.a, rawText: RAW_TEXT },
    ownerA,
  );
  const lines = db.network_commission_lines.filter((l) => l.statement_id === ST.a);
  const ins = writes.filter((w) => w.method === "INSERT" && w.table === "network_commission_lines");
  ok(
    "B1D-07 owner A parses its own statement: lines stamped tenant A; auto-match binds only the tenant-A customer/session; the tenant-B customer is never matched",
    r.ok &&
      r.value.lineCount === 2 &&
      ins.length === 2 &&
      ins.every((w) => w.row.tenant_id === T.a) &&
      lines.length === 2 &&
      lines.every((l) => l.tenant_id === T.a) &&
      lines.some((l) => l.matched_customer_id === U.custA && l.matched_session_id === SESS.a) &&
      !lines.some((l) => l.matched_customer_id === U.custB),
    r.ok ? "" : r.message,
  );
}
{
  resetDb();
  const r = await call(nf, "allocateNetworkLine", { lineId: LN.a, sessionId: SESS.a }, ownerA);
  const fee = db.finance_fee_lines[0];
  const ln = db.network_commission_lines.find((l) => l.id === LN.a);
  ok(
    "B1D-08 owner A allocates a tenant-A line to a tenant-A session: fee line stamped tenant A; line marked allocated and linked",
    r.ok &&
      Boolean(fee) &&
      fee.tenant_id === T.a &&
      fee.session_id === SESS.a &&
      ln.allocation_status === "allocated" &&
      ln.fee_line_id === fee.id,
    r.ok ? "" : r.message,
  );
}
{
  resetDb();
  const ann = await call(nf, "annotateNetworkLine", { lineId: LN.a, annotation: "hello" }, ownerA);
  const vr = await call(
    nf,
    "validateNetworkStatement",
    { statementId: ST.a, action: "validate" },
    ownerA,
  );
  const unlock = await call(
    nf,
    "validateNetworkStatement",
    { statementId: ST.a, action: "unlock" },
    ownerA,
  );
  const ln = db.network_commission_lines.find((l) => l.id === LN.a);
  const st = db.network_commission_statements.find((s) => s.id === ST.a);
  ok(
    "B1D-09 owner A annotates its own line, validates then unlocks its own statement; all scoped to tenant A",
    ann.ok &&
      ln.annotation === "hello" &&
      vr.ok &&
      vr.value.status === "validated" &&
      unlock.ok &&
      unlock.value.status === "draft" &&
      st.tenant_id === T.a,
    [ann.message, vr.message, unlock.message].filter(Boolean).join(" | "),
  );
}

// =============================================================================================
// B1D-10..15 cross-tenant denied in both directions for every operation
// =============================================================================================
ok(
  "B1D-10 list is tenant-isolated in both directions (A sees only A, B sees only B)",
  await crossListSafe(nf),
);
ok(
  "B1D-11 getNetworkStatementDetail on a foreign or tenantless statement (A→B, B→A, null-tenant): Not found., no leak, no write",
  await crossDetailSafe(nf),
);
ok(
  "B1D-12 parseNetworkStatementWithAi on a foreign or tenantless statement (A→B, B→A, null-tenant): Not found., no lines written",
  await crossParseSafe(nf),
);
{
  resetDb();
  const foreignLine = await deniedClean(
    () => call(nf, "allocateNetworkLine", { lineId: LN.b, sessionId: SESS.b }, ownerA),
    notFound,
  );
  const foreignSession = await allocateForeignSessionSafe(nf);
  ok(
    "B1D-13 allocateNetworkLine denies a foreign line and a foreign session id (both Not found., no fee line, no mutation)",
    foreignLine.clean && foreignSession,
    foreignLine.clean ? "" : foreignLine.r.message,
  );
}
ok(
  "B1D-14 annotateNetworkLine on a foreign or tenantless line (A→B, B→A, null-tenant): Not found., no mutation",
  await crossAnnotateSafe(nf),
);
ok(
  "B1D-15 validateNetworkStatement (validate + unlock) on a foreign or tenantless statement: Not found., no status change",
  (await crossValidateSafe(nf)) &&
    (
      await deniedClean(
        () => call(nf, "validateNetworkStatement", { statementId: ST.b, action: "unlock" }, ownerA),
        notFound,
      )
    ).clean,
);

// =============================================================================================
// B1D-16 unknown-vs-foreign equivalence
// =============================================================================================
{
  const probe = async (name, data) => {
    resetDb();
    const r = await call(nf, name, data, ownerA);
    return JSON.stringify([r.ok, r.message, writes.length]);
  };
  const pairs = [];
  pairs.push([
    await probe("getNetworkStatementDetail", { statementId: ST.b }),
    await probe("getNetworkStatementDetail", { statementId: RANDOM }),
  ]);
  pairs.push([
    await probe("parseNetworkStatementWithAi", { statementId: ST.b, rawText: RAW_TEXT }),
    await probe("parseNetworkStatementWithAi", { statementId: RANDOM, rawText: RAW_TEXT }),
  ]);
  pairs.push([
    await probe("allocateNetworkLine", { lineId: LN.b, sessionId: SESS.b }),
    await probe("allocateNetworkLine", { lineId: RANDOM, sessionId: SESS.b }),
  ]);
  pairs.push([
    await probe("annotateNetworkLine", { lineId: LN.b, annotation: "x" }),
    await probe("annotateNetworkLine", { lineId: RANDOM, annotation: "x" }),
  ]);
  pairs.push([
    await probe("validateNetworkStatement", { statementId: ST.b, action: "validate" }),
    await probe("validateNetworkStatement", { statementId: RANDOM, action: "validate" }),
  ]);
  ok(
    "B1D-16 foreign and unknown ids produce identical responses and side effects for every resource operation",
    pairs.every(([a, b]) => a === b && a === JSON.stringify([false, NOT_FOUND, 0])),
    pairs.map(([a, b]) => `${a}~${b}`).join(" "),
  );
}

// =============================================================================================
// B1D-17 existing tenantless statement fails closed (no inferred ownership, no backfill)
// =============================================================================================
{
  resetDb();
  const detail = await deniedClean(
    () => call(nf, "getNetworkStatementDetail", { statementId: ST.nul }, ownerA),
    notFound,
  );
  const parse = await deniedClean(
    () =>
      call(nf, "parseNetworkStatementWithAi", { statementId: ST.nul, rawText: RAW_TEXT }, ownerA),
    notFound,
  );
  const annotate = await deniedClean(
    () => call(nf, "annotateNetworkLine", { lineId: LN.nul, annotation: "x" }, ownerA),
    notFound,
  );
  const validate = await deniedClean(
    () => call(nf, "validateNetworkStatement", { statementId: ST.nul, action: "validate" }, ownerA),
    notFound,
  );
  const stillNull =
    db.network_commission_statements.find((s) => s.id === ST.nul).tenant_id === null;
  ok(
    "B1D-17 the existing tenantless statement/line is Not found. for every operation and is never stamped, inferred or backfilled",
    detail.clean && parse.clean && annotate.clean && validate.clean && stillNull,
  );
}

// =============================================================================================
// B1D-18 global UNIQUE(period_month) B4 blocker fails closed with a generic conflict
// =============================================================================================
{
  resetDb();
  const before = snap();
  const r = await call(nf, "getOrCreateNetworkStatement", { periodMonth: "2026-01" }, ownerB);
  const createdForB = db.network_commission_statements.some(
    (s) => s.tenant_id === T.b && String(s.period_month) === MONTH_A,
  );
  ok(
    "B1D-18 tenant B opening a month already held by tenant A fails closed with a generic conflict that never exposes the foreign statement id/tenant/creator; no row is created and no foreign row is altered",
    !r.ok &&
      r.message === CONFLICT_MESSAGE &&
      !r.message.includes(ST.a) &&
      !r.message.includes(T.a) &&
      !r.message.includes("seed") &&
      !createdForB &&
      snap() === before,
    r.ok ? "unexpected success" : r.message,
  );
}

// =============================================================================================
// B1D-19..20 platform entry: read-only cannot mutate; operational acts only in entered tenant
// =============================================================================================
{
  resetDb();
  const rs = [];
  for (const [name, data] of [
    ["getOrCreateNetworkStatement", { periodMonth: MONTH_FREE }],
    ["parseNetworkStatementWithAi", { statementId: ST.a, rawText: RAW_TEXT }],
    ["allocateNetworkLine", { lineId: LN.a, sessionId: SESS.a }],
    ["annotateNetworkLine", { lineId: LN.a, annotation: "x" }],
    ["validateNetworkStatement", { statementId: ST.a, action: "validate" }],
  ]) {
    rs.push(
      (
        await deniedClean(
          () => call(nf, name, data, platRO),
          (r) => !r.ok,
        )
      ).clean,
    );
  }
  ok(
    "B1D-19 platform read-only entry cannot mutate any network-statement operation (no finance_network grant; denied with no side effect)",
    rs.every(Boolean),
  );
}
{
  resetDb();
  const create = await call(nf, "getOrCreateNetworkStatement", { periodMonth: MONTH_FREE }, platOp);
  const ins = writes.filter(
    (w) => w.method === "INSERT" && w.table === "network_commission_statements",
  );
  const ownDetail = await call(nf, "getNetworkStatementDetail", { statementId: ST.a }, platOp);
  const homeDetail = await deniedClean(
    () => call(nf, "getNetworkStatementDetail", { statementId: ST.b }, platOp),
    notFound,
  );
  const homeValidate = await deniedClean(
    () => call(nf, "validateNetworkStatement", { statementId: ST.b, action: "validate" }, platOp),
    notFound,
  );
  ok(
    "B1D-20 platform operational entry into tenant A (home tenant B) writes only to the entered tenant A; the home tenant B's statement is Not found. (no home/sole-membership fallback)",
    create.ok &&
      ins.length === 1 &&
      ins[0].row.tenant_id === T.a &&
      ownDetail.ok &&
      ownDetail.value.statement.id === ST.a &&
      homeDetail.clean &&
      homeValidate.clean &&
      !db.network_commission_statements.some(
        (s) => s.tenant_id === T.b && String(s.period_month) === "2026-09-01",
      ),
    [create.message].filter(Boolean).join(" | "),
  );
}

// =============================================================================================
// B1D-21..22 roles: General Admin permission bound to tenant; adviser/introducer/outsider denied
// =============================================================================================
{
  resetDb();
  const create = await call(nf, "getOrCreateNetworkStatement", { periodMonth: MONTH_FREE }, genA);
  const detail = await call(nf, "getNetworkStatementDetail", { statementId: ST.a }, genA);
  const annotate = await call(nf, "annotateNetworkLine", { lineId: LN.a, annotation: "g" }, genA);
  const validateDenied = await call(
    nf,
    "validateNetworkStatement",
    { statementId: ST.a, action: "validate" },
    genA,
  );
  const crossDetail = await deniedClean(
    () => call(nf, "getNetworkStatementDetail", { statementId: ST.b }, genA),
    notFound,
  );
  ok(
    "B1D-21 General Admin A (finance_network_statements=amend) may view/amend within tenant A but is Not found. cross-tenant; validate still requires the finance_network_validate grant (Forbidden)",
    create.ok &&
      create.value.statement.tenant_id === T.a &&
      detail.ok &&
      annotate.ok &&
      forbidden(validateDenied) &&
      crossDetail.clean,
    [create.message, validateDenied.message].filter(Boolean).join(" | "),
  );
}
{
  resetDb();
  const rs = [];
  for (const actor of [advA, introA, outsider]) {
    for (const [name, data] of [
      ["getNetworkStatementDetail", { statementId: ST.a }],
      ["getOrCreateNetworkStatement", { periodMonth: MONTH_FREE }],
      ["allocateNetworkLine", { lineId: LN.a, sessionId: SESS.a }],
      ["validateNetworkStatement", { statementId: ST.a, action: "validate" }],
    ]) {
      rs.push(
        (
          await deniedClean(
            () => call(nf, name, data, actor),
            (r) => !r.ok,
          )
        ).clean,
      );
    }
  }
  ok(
    "B1D-22 adviser, introducer and a caller with no membership are denied on every network-statement operation with no side effect",
    rs.every(Boolean),
  );
}

// =============================================================================================
// B1D-23 A2 dual-membership model
// =============================================================================================
{
  resetDb();
  const a = await call(nf, "getOrCreateNetworkStatement", { periodMonth: MONTH_FREE }, dualA);
  const aDetailForeign = await deniedClean(
    () => call(nf, "getNetworkStatementDetail", { statementId: ST.b }, dualA),
    notFound,
  );
  const rs = [];
  for (const actor of [dualB, dualNone]) {
    for (const [name, data] of [
      ["getNetworkStatementDetail", { statementId: ST.a }],
      ["allocateNetworkLine", { lineId: LN.a, sessionId: SESS.a }],
      ["validateNetworkStatement", { statementId: ST.a, action: "validate" }],
    ]) {
      rs.push(
        (
          await deniedClean(
            () => call(nf, name, data, actor),
            (r) => !r.ok,
          )
        ).clean,
      );
    }
  }
  ok(
    "B1D-23 the dual-membership identity acting as owner in tenant A writes to tenant A only (tenant B Not found.); acting in tenant B (introducer) or with no verified tenant is denied — ambiguity fails closed",
    a.ok && a.value.statement.tenant_id === T.a && aDetailForeign.clean && rs.every(Boolean),
    a.ok ? "" : a.message,
  );
}

// =============================================================================================
// B1D-24 preservation: no migration/RLS/grant/schema change; authority modules & B4/S4E surfaces unchanged
// =============================================================================================
{
  const migrationDiff = git("diff", "--name-only", BASE_REF, "--", "supabase").trim();
  const migrationNew = git("ls-files", "--others", "--exclude-standard", "--", "supabase").trim();
  const authorityDiff = git(
    "diff",
    "--name-only",
    BASE_REF,
    "--",
    "src/lib/tenant-assert.server.ts",
    "src/lib/tenant-role.server.ts",
    "src/lib/tenant-role.ts",
    "src/lib/admin-access.ts",
    "src/lib/admin.functions.ts",
  ).trim();
  const changedFiles = git("diff", "--name-only", BASE_REF).trim().split("\n").filter(Boolean);
  // The approved B1d gate intentionally touches exactly two files: the network
  // functions (modified) and this verifier (added). Any third tracked change,
  // or any change to migrations/authority/schema, must still fail this guard.
  const VERIFIER_FILE = "scripts/g7f4s4c4b1d-network-statements-boundary-verify.mjs";
  const AUTHORISED_B1D_FILES = [REF_FILE, VERIFIER_FILE];
  const unauthorisedChanges = changedFiles.filter((f) => !AUTHORISED_B1D_FILES.includes(f));
  ok(
    "B1D-24 no migration, RLS, grant or schema change; canonical authority modules unchanged; tracked changes limited to exactly the two authorised B1d files (network functions + this verifier)",
    migrationDiff === "" &&
      migrationNew === "" &&
      authorityDiff === "" &&
      !/\.rpc\(|grant |policy /i.test(strip(REF_SRC)) &&
      changedFiles.includes(REF_FILE) &&
      unauthorisedChanges.length === 0,
    [migrationDiff, migrationNew, authorityDiff, `unauthorised=${unauthorisedChanges.join(",")}`]
      .filter((s) => s && s !== "unauthorised=")
      .join(" | "),
  );
}

// =============================================================================================
// B1D-NC negative controls: each mutant must fail its runtime check AND its static guard, and
// must demonstrably produce the unsafe cross-tenant effect (not merely crash)
// =============================================================================================
/** The mutant still serves ordinary same-tenant traffic, so a failure is not a load error. */
async function mutantLive(mod) {
  resetDb();
  const l = await call(mod, "listNetworkStatementMonths", {}, ownerA);
  const g = await call(mod, "getOrCreateNetworkStatement", { periodMonth: "2026-01" }, ownerA);
  const d = await call(mod, "getNetworkStatementDetail", { statementId: ST.a }, ownerA);
  return l.ok && g.ok && d.ok;
}
const NEGATIVE_CONTROLS = [
  {
    label: "listNetworkStatementMonths tenant filter removed",
    mutate: (s) =>
      replaceInWriter(s, "listNetworkStatementMonths", '\n      .eq("tenant_id", tenantId)', ""),
    guard: "listScoped",
    runtime: crossListSafe,
    evidence: async (m) => {
      resetDb();
      const r = await call(m, "listNetworkStatementMonths", {}, ownerA);
      return r.ok && r.value.months.some((x) => x.statementId === ST.b || x.statementId === ST.nul);
    },
  },
  {
    label: "getNetworkStatementDetail statement tenant filter removed",
    mutate: (s) =>
      replaceInWriter(
        s,
        "getNetworkStatementDetail",
        '.eq("id", data.statementId)\n      .eq("tenant_id", tenantId)\n      .maybeSingle();',
        '.eq("id", data.statementId)\n      .maybeSingle();',
      ),
    guard: "detailScoped",
    runtime: crossDetailSafe,
    evidence: async (m) => {
      resetDb();
      const r = await call(m, "getNetworkStatementDetail", { statementId: ST.b }, ownerA);
      return r.ok && r.value.statement.id === ST.b;
    },
  },
  {
    label: "getOrCreateNetworkStatement tenant stamping removed",
    mutate: (s) =>
      replaceInWriter(
        s,
        "getOrCreateNetworkStatement",
        /withForcedTenantId\(\s*\{\s*period_month: period,[\s\S]*?\},\s*tenantId,\s*\)/,
        '{ period_month: period, status: "draft", created_by: context.userId }',
      ),
    guard: "createScoped",
    runtime: createStampSafe,
    evidence: async (m) => {
      resetDb();
      const r = await call(m, "getOrCreateNetworkStatement", { periodMonth: MONTH_FREE }, ownerA);
      return r.ok && r.value.statement.tenant_id !== T.a;
    },
  },
  {
    label: "parseNetworkStatementWithAi auto-match reverts to a global case_ref lookup",
    mutate: (s) =>
      replaceInWriter(
        s,
        "parseNetworkStatementWithAi",
        '.eq("case_ref", line.case_ref)\n          .eq("tenant_id", tenantId)',
        '.eq("case_ref", line.case_ref)',
      ),
    guard: "parseMatchScoped",
    runtime: parseMatchSafe,
    evidence: async (m) => {
      resetDb();
      await call(
        m,
        "parseNetworkStatementWithAi",
        { statementId: ST.a, rawText: RAW_TEXT },
        ownerA,
      );
      return db.network_commission_lines.some(
        (l) => l.statement_id === ST.a && l.matched_customer_id === U.custB,
      );
    },
  },
  {
    label: "allocateNetworkLine accepts a globally resolved foreign session",
    mutate: (s) =>
      replaceInWriter(
        s,
        "allocateNetworkLine",
        '.eq("id", sessionId)\n      .eq("tenant_id", tenantId)\n      .maybeSingle();',
        '.eq("id", sessionId)\n      .maybeSingle();',
      ),
    guard: "allocateSessionScoped",
    runtime: allocateForeignSessionSafe,
    evidence: async (m) => {
      resetDb();
      await call(m, "allocateNetworkLine", { lineId: LN.a, sessionId: SESS.b }, ownerA);
      return db.finance_fee_lines.some((f) => f.session_id === SESS.b);
    },
  },
  {
    label: "allocateNetworkLine finance_fee_lines tenant stamping removed",
    mutate: (s) =>
      replaceInWriter(
        s,
        "allocateNetworkLine",
        /withForcedTenantId\(\s*\{\s*session_id: sessionId,[\s\S]*?\},\s*tenantId,\s*\)/,
        '{ session_id: sessionId, fee_type: feeType, amount_pence: amountPence, note: "x", status: "draft", created_by: context.userId }',
      ),
    guard: "financeStampScoped",
    runtime: allocateStampSafe,
    evidence: async (m) => {
      resetDb();
      await call(m, "allocateNetworkLine", { lineId: LN.a, sessionId: SESS.a }, ownerA);
      const fee = db.finance_fee_lines[0];
      return Boolean(fee) && fee.tenant_id !== T.a;
    },
  },
  {
    label: "annotateNetworkLine tenant ownership removed",
    mutate: (s) => {
      let step = replaceInWriter(
        s,
        "annotateNetworkLine",
        '.eq("id", data.lineId)\n      .eq("tenant_id", tenantId)\n      .maybeSingle();',
        '.eq("id", data.lineId)\n      .maybeSingle();',
      );
      if (step)
        step = replaceInWriter(
          step,
          "annotateNetworkLine",
          "if (!stmt || stmt.tenant_id !== tenantId) throw new Error(RESOURCE_NOT_FOUND_MESSAGE);",
          "if (!stmt) throw new Error(RESOURCE_NOT_FOUND_MESSAGE);",
        );
      if (step)
        step = replaceInWriter(
          step,
          "annotateNetworkLine",
          '.eq("id", data.lineId)\n      .eq("tenant_id", tenantId);',
          '.eq("id", data.lineId);',
        );
      return step;
    },
    guard: "annotateScoped",
    runtime: crossAnnotateSafe,
    evidence: async (m) => {
      resetDb();
      await call(m, "annotateNetworkLine", { lineId: LN.b, annotation: "pwned" }, ownerA);
      return db.network_commission_lines.find((l) => l.id === LN.b).annotation === "pwned";
    },
  },
  {
    label: "validateNetworkStatement tenant filter removed",
    mutate: (s) => {
      const block = topLevelDeclaration(s, "validateNetworkStatement");
      if (!block) return null;
      const changed = block.replace(/\n\s*\.eq\("tenant_id", tenantId\)/g, "");
      return changed === block ? null : s.replace(block, changed);
    },
    guard: "validateScoped",
    runtime: crossValidateSafe,
    evidence: async (m) => {
      resetDb();
      await call(m, "validateNetworkStatement", { statementId: ST.b, action: "validate" }, ownerA);
      return db.network_commission_statements.find((s) => s.id === ST.b).status === "validated";
    },
  },
  {
    label: "parseNetworkStatementWithAi statement ownership proof removed",
    mutate: (s) =>
      replaceInWriter(
        s,
        "parseNetworkStatementWithAi",
        '.eq("id", data.statementId)\n      .eq("tenant_id", tenantId)\n      .maybeSingle();',
        '.eq("id", data.statementId)\n      .maybeSingle();',
      ),
    guard: "parseStatementProof",
    runtime: crossParseSafe,
    evidence: async (m) => {
      resetDb();
      await call(
        m,
        "parseNetworkStatementWithAi",
        { statementId: ST.b, rawText: RAW_TEXT },
        ownerA,
      );
      return db.network_commission_lines.some(
        (l) => l.statement_id === ST.b && l.tenant_id === T.a,
      );
    },
  },
];
let ncPassed = 0;
for (const [i, nc] of NEGATIVE_CONTROLS.entries()) {
  const mutated = nc.mutate(REF_SRC);
  let runtimeCaught = false;
  let guardCaught = false;
  let effect = false;
  let live = false;
  let detail = "";
  if (!mutated) detail = "mutation did not apply";
  else {
    guardCaught = staticGuards(mutated)[nc.guard] === false;
    const realSafe = await nc.runtime(nf);
    const realEffect = await nc.evidence(nf);
    const mod = await loadMutant(mutated);
    live = await mutantLive(mod);
    const mutantSafe = await outcome(() => nc.runtime(mod));
    runtimeCaught = realSafe && mutantSafe.ok && mutantSafe.value === false;
    effect = !realEffect && (await nc.evidence(mod));
    detail = `guard=${guardCaught} runtime=${runtimeCaught} unsafeEffect=${effect} mutantLive=${live}${mutantSafe.ok ? "" : ` (${mutantSafe.message})`}`;
  }
  const caught = Boolean(mutated) && guardCaught && runtimeCaught && effect && live;
  if (caught) ncPassed += 1;
  ok(`B1D-NC${i + 1} negative control fails as required: ${nc.label}`, caught, detail);
}

resetDb();
ok(
  "B1D-25 no network or unstubbed backend call; the AI call goes only through the in-process recorder",
  unknownCalls.length === 0 && !logs.some((l) => /refused host|unstubbed/.test(l)),
  [...unknownCalls, ...logs.filter((l) => /refused host|unstubbed/.test(l))].join(" | "),
);

console.log("");
console.log(`NEGATIVE_CONTROL_COUNT=${NEGATIVE_CONTROLS.length}`);
console.log(
  `NEGATIVE_CONTROLS_PASS=${ncPassed === NEGATIVE_CONTROLS.length ? "yes" : "no"} (${ncPassed}/${NEGATIVE_CONTROLS.length})`,
);
console.log("SAME_MONTH_MULTI_TENANT_CREATION_SUPPORTED=no (generic conflict, DEFER_TO_B4=yes)");
console.log("EXISTING_TENANTLESS_STATEMENT=fails closed, not stamped/inferred/backfilled (B4)");
console.log(
  "PLATFORM_READ_ONLY=cannot mutate; PLATFORM_OPERATIONAL=entered tenant only, no home fallback",
);
if (failures.length) {
  console.log(`${total - failures.length}/${total} PASS`);
  console.log(`FAILED: ${failures.join("; ")}`);
  process.exit(1);
}
console.log(`${total - failures.length}/${total} PASS`);
