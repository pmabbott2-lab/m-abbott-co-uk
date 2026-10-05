/**
 * G7F-4S4C4-B1c RAF / referral administration tenant boundary — offline verification.
 * Real referral server-function validators and handlers run against an in-memory PostgREST fake
 * on a non-routable host; SMS sending is replaced by an in-process recorder. Negative controls
 * load in-memory mutated copies of the module (nothing is written to disk). Synthetic fixtures
 * only: no database, no network, no production, no real customer, staff or privileged identity,
 * no phone numbers.
 * Run: npm exec --yes --package=tsx -- tsx scripts/g7f4s4c4b1c-raf-admin-boundary-verify.mjs
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
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_MESSAGING_SERVICE_SID",
  "TWILIO_SMS_SENDER_LABEL",
  "STAGING_TWILIO_ALLOW_LIVE",
  "APP_BASE_URL",
  "VITE_APP_URL",
  "APP_URL",
  "WEBSITE_SITE_NAME",
  "WEBSITE_HOSTNAME",
]) {
  delete process.env[k];
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REF_FILE = "src/lib/referrals.functions.ts";
// Baseline commit B1c was implemented against.
const BASE_REF = "80ad179";
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

// --- module stubs: createServerFn capture, request Referer, Enter Company, SMS recorder --------
const realStartUrl = import.meta.resolve("@tanstack/react-start");
const realStartServerUrl = import.meta.resolve("@tanstack/react-start/server");
const realSmsUrl = pathToFileURL(resolve(root, "src/lib/sms.server.ts")).href;
const realRefUrl = pathToFileURL(resolve(root, REF_FILE)).href;
const MUTANT_MARK = "/*b1c-mutant*/";
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
export function getRequest() { return globalThis.__B1C_REQUEST ?? null; }
export function getCookie() { return undefined; }
export function setCookie() {}
export function deleteCookie() {}
`;
const stubPlatform = `
export async function validatePlatformTenantAccessSession(input) {
  return globalThis.__B1C_PLATFORM?.get(input.userId + ":" + input.tenantId) ?? null;
}
export async function hasValidPlatformTenantAccess() { return false; }
export async function clearPlatformTenantEntryOnLogout() {}
`;
const stubSms = `
export * from ${JSON.stringify(realSmsUrl)};
export function isTwilioConfigured() { return true; }
export async function sendSms(opts) {
  const sid = "SMxB1C" + String((globalThis.__B1C_SMS ??= []).length + 1);
  globalThis.__B1C_SMS.push({ to: opts.to, body: opts.body, sid });
  return { sid };
}
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
  if (/(^|\\/)sms\\.server(\\.ts)?$/.test(specifier) && !fromData) {
    return { url: ${JSON.stringify(dataUrl(stubSms))}, shortCircuit: true };
  }
  return next(specifier, context);
}
`;
register(dataUrl(hookSource), import.meta.url);

// --- synthetic fixtures ------------------------------------------------------------------------
const FAKE_HOST = "g7f4s4c4b1c.invalid";
process.env.SUPABASE_URL = `http://${FAKE_HOST}`;
process.env.VITE_SUPABASE_URL = `http://${FAKE_HOST}`;
process.env.SUPABASE_SERVICE_ROLE_KEY = "synthetic_service_role_g7f4s4c4b1c_not_a_real_key";
process.env.SUPABASE_PUBLISHABLE_KEY = "synthetic_publishable_g7f4s4c4b1c_not_a_real_key";
process.env.VITE_SUPABASE_PUBLISHABLE_KEY = "synthetic_publishable_g7f4s4c4b1c_not_a_real_key";
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
const C = { a1: id("5", 1), b1: id("5", 2), nul: id("5", 3), a2: id("5", 4) };
const R = {
  a: id("6", 1),
  b: id("6", 2),
  legacyA: id("6", 3),
  legacyNull: id("6", 4),
  a2: id("6", 5),
  a3: id("6", 6),
};
const L = { a: id("7", 1), b: id("7", 2), xB: id("7", 3) };
const RANDOM = "9f9f9f9f-9f9f-4f9f-8f9f-9f9f9f9f9f9f";
const daysAgo = (d) => new Date(Date.now() - d * 86400000).toISOString();

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
  const code = (cid, tenant_id, codeStr, referrer_user_id, referrer_name, referrer_phone) => ({
    id: cid,
    tenant_id,
    code: codeStr,
    referrer_user_id,
    referrer_name,
    referrer_phone,
    active: true,
    created_by: null,
    created_at: daysAgo(10),
  });
  const referral = (rid, tenant_id, referral_code_id, codeStr) => ({
    id: rid,
    tenant_id,
    referral_code_id,
    code: codeStr,
    referrer_user_id: null,
    referred_user_id: null,
    referred_email: `friend-${rid.slice(0, 4)}@friend.example.test`,
    status: "signed_up",
    bonus_status: "none",
    notes: null,
    created_at: daysAgo(5),
    updated_at: daysAgo(5),
  });
  const ledger = (lid, tenant_id, referral_id) => ({
    id: lid,
    tenant_id,
    referral_id,
    kind: "commission",
    payout_status: "received",
    payout_at: null,
    payout_by: null,
    amount_pence: 5000,
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
      // A2 model: the same identity holds memberships in two tenants with different roles.
      mem(U.dual, T.a, "owner"),
      mem(U.dual, T.b, "introducer"),
      // Platform operator's home tenant is B; platform entry targets A.
      mem(U.platOp, T.b, "owner"),
      mem(U.custB, T.b, "customer"),
    ],
    admin_permissions: [
      { user_id: U.genA, tenant_id: T.a, permission_key: "raf", access: "none" },
      { user_id: U.genA, tenant_id: T.a, permission_key: "finance_raf", access: "none" },
    ],
    profiles: [
      {
        id: U.custA,
        full_name: "Alpha Customer",
        email: "customer@alpha.example.test",
        phone: "PROFILEPHONE-A",
      },
      {
        id: U.custB,
        full_name: "Bravo Customer",
        email: "customer@bravo.example.test",
        phone: "PROFILEPHONE-B",
      },
    ],
    interview_sessions: [
      { id: id("8", 1), customer_id: U.custA, tenant_id: T.a, deleted_at: null },
      { id: id("8", 2), customer_id: U.custB, tenant_id: T.b, deleted_at: null },
    ],
    referral_codes: [
      code(C.a1, T.a, "ALPHA111", U.custA, "Alpha Referrer", "REFPHONE-A1"),
      code(C.b1, T.b, "BRAVO111", U.custB, "Bravo Referrer", "REFPHONE-B1"),
      code(C.nul, null, "NULLC111", null, "Nullco Referrer", "REFPHONE-N1"),
      code(C.a2, T.a, "ALPHA222", null, "Alpha Nophone", null),
    ],
    referrals: [
      referral(R.a, T.a, C.a1, "ALPHA111"),
      referral(R.b, T.b, C.b1, "BRAVO111"),
      referral(R.legacyA, null, C.a1, "ALPHA111"),
      referral(R.legacyNull, null, C.nul, "NULLC111"),
      referral(R.a2, T.a, C.a1, "ALPHA111"),
      referral(R.a3, T.a, C.a1, "ALPHA111"),
    ],
    finance_ledger: [
      ledger(L.a, T.a, R.a),
      ledger(L.b, T.b, R.b),
      // Inconsistent row: tenant B ledger entry pointing at a tenant-A referral.
      ledger(L.xB, T.b, R.a2),
    ],
    finance_settings: [],
    sms_messages: [],
  };
  writes.length = 0;
  reads.length = 0;
  unknownCalls.length = 0;
  globalThis.__B1C_SMS = [];
}

globalThis.__B1C_PLATFORM = new Map([
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
    throw new Error(`G7F4S4C4B1C fetch stub refused host ${url.hostname}`);
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
        if (table === "referral_codes" && rows.some((r) => r.code === row.code))
          return json({ code: "23505", message: "duplicate key on referral_codes" }, 409);
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
const rf = await import("../src/lib/referrals.functions.ts");
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
  globalThis.__B1C_REQUEST = actor.slug
    ? new Request(`http://app.invalid/_serverFn/x`, {
        headers: { referer: `http://app.invalid/${actor.slug}/admin/refer-a-friend` },
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
const sms = () => globalThis.__B1C_SMS ?? [];
const RAF_TABLES = ["referral_codes", "referrals", "finance_ledger", "sms_messages"];
const snap = () => JSON.stringify(RAF_TABLES.map((t) => db[t]));
const rafWrites = () => writes.filter((w) => RAF_TABLES.includes(w.table));
const SECRETS = [
  "Alpha Customer",
  "Bravo Customer",
  "PROFILEPHONE-A",
  "PROFILEPHONE-B",
  "REFPHONE-A1",
  "REFPHONE-B1",
  "REFPHONE-N1",
  "Alpha Referrer",
  "Bravo Referrer",
  "Nullco Referrer",
  "tenant-a",
  "tenant-b",
  T.a,
  T.b,
];
const leakFree = (r) => !r.ok && !SECRETS.some((s) => r.message.includes(s));
/** Denied with no side effect: no RAF table change, no write, no SMS. */
async function deniedClean(run, expect) {
  const before = snap();
  const w0 = writes.length;
  const s0 = sms().length;
  const r = await run();
  return {
    r,
    clean:
      expect(r) && leakFree(r) && snap() === before && writes.length === w0 && sms().length === s0,
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
  const amendCap = blk("rafAmendCapability");
  const bonusCap = blk("rafBonusAmendCapability");
  const create = blk("createReferralLink");
  const text = blk("textReferralLink");
  const friend = blk("textRafInviteToFriend");
  const bonus = blk("updateReferralBonusStatus");
  const at = (s, needle) => (typeof needle === "string" ? s.indexOf(needle) : s.search(needle));
  const before = (s, a, b) => at(s, a) >= 0 && at(s, b) >= 0 && at(s, a) < at(s, b);
  const acting = (s, cap) =>
    new RegExp(`resolveActingTenantForList\\(\\s*context\\.userId,\\s*${cap}\\(\\),?\\s*\\)`).test(
      s,
    );
  const legacyAuthority =
    /requireRafAmend|requireAdmin\(|resolveAdminAccess|resolveSoleMembershipTenant/;
  const scopedCodeLoad =
    /\.from\("referral_codes"\)[\s\S]*?\.eq\("id", data\.id\)\s*\.eq\("tenant_id", tenantId\)\s*\.maybeSingle\(\)/;
  const NF_LINK = "if (!link) throw new Error(RESOURCE_NOT_FOUND_MESSAGE);";
  return {
    amendCapability:
      /mutate: true,/.test(amendCap) &&
      /allocation: "none"/.test(amendCap) &&
      /v\.adminAccess\.isOwner \|\|\s*v\.adminAccess\.isSupervisor \|\|\s*canAmend\(v\.adminAccess, "raf"\) \|\|\s*v\.isMainAdmin,/.test(
        amendCap,
      ),
    bonusCapability:
      /mutate: true,/.test(bonusCap) &&
      /allocation: "none"/.test(bonusCap) &&
      /canAmend\(v\.adminAccess, "finance_raf"\) \|\|\s*v\.adminAccess\.isOwner \|\|\s*v\.adminAccess\.isSupervisor \|\|\s*v\.isMainAdmin,/.test(
        bonusCap,
      ),
    createActingTenant:
      acting(create, "rafAmendCapability") &&
      !legacyAuthority.test(create) &&
      /withForcedTenantId\(\s*\{[\s\S]*?\},\s*tenantId,\s*\)/.test(create) &&
      /tenantSlug: view\.tenantSlug \?\? null/.test(create),
    createReferrerProof:
      before(
        create,
        "const people = await tenantPeopleIds(supabaseAdmin, tenantId);",
        '.from("profiles")',
      ) &&
      before(
        create,
        "if (!people.includes(data.referrerUserId)) throw new Error(RESOURCE_NOT_FOUND_MESSAGE);",
        '.from("profiles")',
      ),
    textScoped:
      acting(text, "rafAmendCapability") &&
      !legacyAuthority.test(text) &&
      scopedCodeLoad.test(text) &&
      before(text, NF_LINK, "if (!link.referrer_phone)") &&
      before(text, NF_LINK, "sendSms(") &&
      before(text, NF_LINK, '.from("sms_messages")'),
    friendScoped:
      acting(friend, "rafAmendCapability") &&
      !legacyAuthority.test(friend) &&
      scopedCodeLoad.test(friend) &&
      before(friend, NF_LINK, "sendSms(") &&
      before(friend, NF_LINK, '.from("sms_messages")'),
    bonusTenantProof:
      acting(bonus, "rafBonusAmendCapability") &&
      !legacyAuthority.test(bonus) &&
      /await scopeReferralRowsToTenant\(\s*supabaseAdmin,[\s\S]*?tenantId,\s*\)/.test(bonus) &&
      before(bonus, "if (!owned) throw new Error(RESOURCE_NOT_FOUND_MESSAGE);", ".update(patch)") &&
      /scopedUpdate\.eq\("tenant_id", tenantId\)/.test(bonus) &&
      /scopedUpdate\.is\("tenant_id", null\)\.eq\("referral_code_id", owned\.referral_code_id\)/.test(
        bonus,
      ),
    ledgerTenantScoped:
      /\.from\("finance_ledger"\)\s*\.select\("id"\)\s*\.eq\("referral_id", data\.id\)\s*\.eq\("tenant_id", tenantId\)\s*\.eq\("kind", "commission"\)/.test(
        bonus,
      ) &&
      /\.eq\("id", ledgerRow\.id\)\s*\.eq\("referral_id", data\.id\)\s*\.eq\("tenant_id", tenantId\);/.test(
        bonus,
      ) &&
      (bonus.match(/await ensureRafCommissionLedgerEntry\(data\.id, context\.userId\);/g) ?? [])
        .length === 1,
  };
}

// --- runtime boundary checks (shared by real module and negative controls) ---------------------
async function crossCreateSafe(mod) {
  resetDb();
  const checks = [];
  for (const [actor, foreign] of [
    [ownerA, U.custB],
    [ownerB, U.custA],
  ]) {
    const r0 = reads.length;
    const { clean } = await deniedClean(
      () => call(mod, "createReferralLink", { referrerUserId: foreign }, actor),
      notFound,
    );
    const profileRead = reads
      .slice(r0)
      .some((x) => x.table === "profiles" && x.filter.includes(foreign));
    checks.push(clean && !profileRead && !rafWrites().some((w) => w.table === "referral_codes"));
  }
  return checks.every(Boolean);
}
async function crossSmsSafe(mod, name) {
  resetDb();
  const payload = (cid) =>
    name === "textRafInviteToFriend" ? { id: cid, friendPhone: "FRIENDPHONE-X" } : { id: cid };
  const checks = [];
  for (const [actor, foreign] of [
    [ownerA, C.b1],
    [ownerB, C.a1],
    [ownerA, C.nul],
    [ownerB, C.nul],
  ]) {
    const { clean } = await deniedClean(() => call(mod, name, payload(foreign), actor), notFound);
    checks.push(clean && !writes.some((w) => w.table === "sms_messages"));
  }
  return checks.every(Boolean);
}
async function crossBonusSafe(mod) {
  resetDb();
  const checks = [];
  for (const [actor, foreign] of [
    [ownerA, R.b],
    [ownerB, R.a],
    [ownerB, R.legacyA],
    [ownerA, R.legacyNull],
  ]) {
    for (const bonusStatus of ["eligible", "paid", "rejected"]) {
      const { clean } = await deniedClean(
        () =>
          call(mod, "updateReferralBonusStatus", { id: foreign, bonusStatus, notes: "x" }, actor),
        notFound,
      );
      checks.push(clean);
    }
  }
  return checks.every(Boolean);
}
async function platformOperationalCreateSafe(mod) {
  resetDb();
  const r = await call(mod, "createReferralLink", { referrerName: "Operational Referrer" }, platOp);
  const inserted = writes.filter((w) => w.method === "INSERT" && w.table === "referral_codes");
  return (
    r.ok &&
    r.value.tenant_id === T.a &&
    r.value.tenantSlug === "tenant-a" &&
    inserted.length === 1 &&
    inserted[0].row.tenant_id === T.a &&
    !db.referral_codes.some(
      (c) => c.referrer_name === "Operational Referrer" && c.tenant_id === T.b,
    )
  );
}
async function ledgerScopeSafe(mod) {
  resetDb();
  const r = await call(mod, "updateReferralBonusStatus", { id: R.a2, bonusStatus: "paid" }, ownerA);
  const foreignLedger = db.finance_ledger.find((l) => l.id === L.xB);
  return (
    r.ok &&
    foreignLedger.payout_status === "received" &&
    foreignLedger.payout_by === null &&
    !writes.some((w) => w.table === "finance_ledger")
  );
}

// =============================================================================================
// B1C-01..03 static guards
// =============================================================================================
const G = staticGuards(REF_SRC);
ok(
  "B1C-01 rafAmendCapability / rafBonusAmendCapability use the ResourceCapability model (mutate, owner/supervisor/amend permission/main-admin)",
  G.amendCapability && G.bonusCapability,
);
ok(
  "B1C-02 all four RAF admin writers resolve one canonical acting tenant via resolveActingTenantForList; no requireRafAmend / resolveAdminAccess / requireAdmin / resolveSoleMembershipTenant authority remains in them",
  G.createActingTenant && G.textScoped && G.friendScoped && G.bonusTenantProof,
  JSON.stringify(G),
);
ok(
  "B1C-03 static tenant guards: referrer proof before profile read; referral_codes loaded by id AND tenant_id with Not found before phone/SMS/sms_messages; scopeReferralRowsToTenant before the referral UPDATE; ledger select/update tenant-scoped; ensureRafCommissionLedgerEntry call unchanged",
  G.createReferrerProof &&
    G.textScoped &&
    G.friendScoped &&
    G.bonusTenantProof &&
    G.ledgerTenantScoped,
);

// =============================================================================================
// B1C-04..09 same-tenant authorised writes (owner, supervisor)
// =============================================================================================
{
  resetDb();
  const r = await call(rf, "createReferralLink", { referrerUserId: U.custA }, ownerA);
  const ins = writes.filter((w) => w.method === "INSERT" && w.table === "referral_codes");
  ok(
    "B1C-04 owner A creates a link for a tenant-A customer (session customer): written to tenant A with the profile backfill",
    r.ok &&
      r.value.tenant_id === T.a &&
      r.value.tenantSlug === "tenant-a" &&
      r.value.referrer_name === "Alpha Customer" &&
      r.value.referrer_phone === "PROFILEPHONE-A" &&
      ins.length === 1 &&
      ins[0].row.tenant_id === T.a &&
      ins[0].row.created_by === U.ownerA,
    r.ok ? "" : r.message,
  );
}
{
  resetDb();
  const r1 = await call(rf, "createReferralLink", { referrerUserId: U.custB }, supB);
  const r2 = await call(
    rf,
    "createReferralLink",
    { referrerName: "Off System", referrerPhone: "OFFSYSTEM-PH" },
    supA,
  );
  ok(
    "B1C-05 supervisor B creates for a tenant-B member customer; supervisor A creates a name/phone link; each lands in its own acting tenant",
    r1.ok &&
      r1.value.tenant_id === T.b &&
      r1.value.referrer_name === "Bravo Customer" &&
      r2.ok &&
      r2.value.tenant_id === T.a &&
      r2.value.referrer_user_id === null &&
      r2.value.referrer_name === "Off System",
    [r1.message, r2.message].filter(Boolean).join(" | "),
  );
}
{
  resetDb();
  const r = await call(rf, "textReferralLink", { id: C.a1 }, ownerA);
  const r2 = await call(rf, "textReferralLink", { id: C.a1 }, supA);
  const log = writes.filter((w) => w.table === "sms_messages");
  ok(
    "B1C-06 owner/supervisor A text their own referrer: SMS to the stored referrer phone with the tenant-A RAF link; sms_messages logged",
    r.ok &&
      r2.ok &&
      sms().length === 2 &&
      sms()[0].to === "REFPHONE-A1" &&
      sms()[0].body.includes("http://app.invalid/") &&
      sms()[0].body.includes("tenant-a") &&
      sms()[0].body.includes("ALPHA111") &&
      log.length === 2 &&
      log[0].row.to_number === "REFPHONE-A1",
    [r.message, r2.message].filter(Boolean).join(" | "),
  );
}
{
  resetDb();
  const r = await call(rf, "textReferralLink", { id: C.a2 }, ownerA);
  ok(
    "B1C-07 own link without a referrer phone keeps its existing message (ownership proven first, no SMS)",
    !r.ok && /no phone number/.test(r.message) && sms().length === 0 && writes.length === 0,
  );
}
{
  resetDb();
  const r = await call(
    rf,
    "textRafInviteToFriend",
    { id: C.a1, friendPhone: "FRIENDPHONE-A" },
    ownerA,
  );
  const r2 = await call(
    rf,
    "textRafInviteToFriend",
    { id: C.b1, friendPhone: "FRIENDPHONE-B" },
    supB,
  );
  ok(
    "B1C-08 owner A / supervisor B text a friend from their own tenant's link; message carries the own tenant slug",
    r.ok &&
      r2.ok &&
      sms().length === 2 &&
      sms()[0].to === "FRIENDPHONE-A" &&
      sms()[0].body.includes("tenant-a") &&
      sms()[1].body.includes("tenant-b") &&
      writes.filter((w) => w.table === "sms_messages").length === 2,
    [r.message, r2.message].filter(Boolean).join(" | "),
  );
}
{
  resetDb();
  const e = await call(
    rf,
    "updateReferralBonusStatus",
    { id: R.a3, bonusStatus: "eligible", notes: "ok" },
    ownerA,
  );
  const ledgerIns = writes.filter((w) => w.method === "INSERT" && w.table === "finance_ledger");
  const p = await call(rf, "updateReferralBonusStatus", { id: R.a3, bonusStatus: "paid" }, supA);
  const ledgerUpd = writes.filter((w) => w.method === "UPDATE" && w.table === "finance_ledger");
  const ref = db.referrals.find((x) => x.id === R.a3);
  ok(
    "B1C-09 owner/supervisor A advance a tenant-A referral: referral UPDATE tenant-scoped; eligible creates the tenant-A ledger row; paid updates only that tenant-A row",
    e.ok &&
      p.ok &&
      ref.bonus_status === "paid" &&
      ref.notes === "ok" &&
      ledgerIns.length === 1 &&
      ledgerIns[0].row.tenant_id === T.a &&
      ledgerIns[0].row.referral_id === R.a3 &&
      ledgerUpd.length === 1 &&
      ledgerUpd[0].row.tenant_id === T.a &&
      ledgerUpd[0].row.payout_status === "paid" &&
      ledgerUpd[0].filter.includes(`tenant_id=eq.${T.a}`) &&
      ledgerUpd[0].filter.includes(`referral_id=eq.${R.a3}`) &&
      writes
        .filter((w) => w.method === "UPDATE" && w.table === "referrals")
        .every((w) => w.filter.includes(`tenant_id=eq.${T.a}`)),
    [e.message, p.message].filter(Boolean).join(" | "),
  );
}

// =============================================================================================
// B1C-10..14 cross-tenant denied in both directions for all four writers
// =============================================================================================
ok(
  "B1C-10 createReferralLink with a foreign referrerUserId (A→B, B→A): Not found., no foreign profile read, no name/phone leak, no code created",
  await crossCreateSafe(rf),
);
ok(
  "B1C-11 textReferralLink on a foreign or tenantless code (A→B, B→A, null-tenant): Not found., no phone inspection, no SMS, no sms_messages",
  await crossSmsSafe(rf, "textReferralLink"),
);
ok(
  "B1C-12 textRafInviteToFriend on a foreign or tenantless code (A→B, B→A, null-tenant): Not found., no SMS, no sms_messages",
  await crossSmsSafe(rf, "textRafInviteToFriend"),
);
ok(
  "B1C-13 updateReferralBonusStatus on a foreign referral (A→B, B→A, foreign-code legacy, null-tenant legacy) for eligible/paid/rejected: Not found., no referral mutation, no ledger insert or update",
  await crossBonusSafe(rf),
);
{
  resetDb();
  const before = snap();
  const r = await call(rf, "updateReferralBonusStatus", { id: R.a2, bonusStatus: "paid" }, ownerA);
  const xB = db.finance_ledger.find((l) => l.id === L.xB);
  ok(
    "B1C-14 payout UPDATE never touches another tenant's ledger row, even when it references an owned referral",
    r.ok &&
      xB.payout_status === "received" &&
      !writes.some((w) => w.table === "finance_ledger") &&
      snap() !== before,
  );
}

// =============================================================================================
// B1C-15 unknown-vs-foreign equivalence
// =============================================================================================
{
  const pairs = [];
  const probe = async (name, data) => {
    resetDb();
    const r = await call(rf, name, data, ownerA);
    return JSON.stringify([r.ok, r.message, writes.length, sms().length]);
  };
  pairs.push([
    await probe("createReferralLink", { referrerUserId: U.custB }),
    await probe("createReferralLink", { referrerUserId: RANDOM }),
  ]);
  pairs.push([
    await probe("textReferralLink", { id: C.b1 }),
    await probe("textReferralLink", { id: RANDOM }),
  ]);
  pairs.push([
    await probe("textRafInviteToFriend", { id: C.b1, friendPhone: "FRIENDPHONE-X" }),
    await probe("textRafInviteToFriend", { id: RANDOM, friendPhone: "FRIENDPHONE-X" }),
  ]);
  pairs.push([
    await probe("updateReferralBonusStatus", { id: R.b, bonusStatus: "paid" }),
    await probe("updateReferralBonusStatus", { id: RANDOM, bonusStatus: "paid" }),
  ]);
  ok(
    "B1C-15 unknown and foreign ids produce identical responses and side effects for all four writers",
    pairs.every(([a, b]) => a === b && a === JSON.stringify([false, NOT_FOUND, 0, 0])),
    pairs.map(([a, b]) => `${a}~${b}`).join(" "),
  );
}

// =============================================================================================
// B1C-16..18 legacy tenantless referral handling (no stamping)
// =============================================================================================
{
  resetDb();
  const e = await call(
    rf,
    "updateReferralBonusStatus",
    { id: R.legacyA, bonusStatus: "eligible", notes: "legacy" },
    ownerA,
  );
  const legacy = db.referrals.find((x) => x.id === R.legacyA);
  const upd = writes.filter((w) => w.method === "UPDATE" && w.table === "referrals");
  ok(
    "B1C-16 legacy tenantless referral whose code belongs to the acting tenant: update allowed, matched by id + tenant_id IS NULL + owned referral_code_id, tenant_id stays NULL (no stamping)",
    e.ok &&
      legacy.bonus_status === "eligible" &&
      legacy.notes === "legacy" &&
      legacy.tenant_id === null &&
      upd.length === 1 &&
      upd[0].filter.includes("tenant_id=is.null") &&
      upd[0].filter.includes(`referral_code_id=eq.${C.a1}`),
    e.ok ? "" : e.message,
  );
  ok(
    "B1C-17 legacy tenantless referral: eligible creates no ledger row (ensureRafCommissionLedgerEntry unchanged, returns for tenantless referrals — B4)",
    !writes.some((w) => w.table === "finance_ledger"),
  );
  const p = await call(
    rf,
    "updateReferralBonusStatus",
    { id: R.legacyA, bonusStatus: "paid" },
    ownerA,
  );
  ok(
    "B1C-18 legacy tenantless referral: paid updates the referral only; no tenantless or foreign ledger row is updated",
    p.ok &&
      db.referrals.find((x) => x.id === R.legacyA).bonus_status === "paid" &&
      !writes.some((w) => w.table === "finance_ledger"),
  );
}

// =============================================================================================
// B1C-19..21 platform entry
// =============================================================================================
{
  resetDb();
  const rs = [];
  for (const [name, data] of [
    ["createReferralLink", { referrerName: "Read Only" }],
    ["createReferralLink", { referrerUserId: U.custA }],
    ["textReferralLink", { id: C.a1 }],
    ["textRafInviteToFriend", { id: C.a1, friendPhone: "FRIENDPHONE-X" }],
    ["updateReferralBonusStatus", { id: R.a, bonusStatus: "paid" }],
  ]) {
    rs.push((await deniedClean(() => call(rf, name, data, platRO), forbidden)).clean);
  }
  ok(
    "B1C-19 platform read-only entry cannot mutate: all four writers Forbidden with no side effect",
    rs.every(Boolean),
  );
}
ok(
  "B1C-20 platform operational entry into tenant A (home tenant B) writes the code to the entered tenant A, never the home tenant",
  await platformOperationalCreateSafe(rf),
);
{
  resetDb();
  const t = await call(rf, "textReferralLink", { id: C.a1 }, platOp);
  const tf = await call(rf, "textReferralLink", { id: C.b1 }, platOp);
  const b = await call(rf, "updateReferralBonusStatus", { id: R.a, bonusStatus: "paid" }, platOp);
  const bf = await call(rf, "updateReferralBonusStatus", { id: R.b, bonusStatus: "paid" }, platOp);
  ok(
    "B1C-21 platform operational entry acts only on the entered tenant: tenant-A link/referral allowed; its home tenant-B link/referral Not found.",
    t.ok &&
      b.ok &&
      notFound(tf) &&
      notFound(bf) &&
      db.referrals.find((x) => x.id === R.b).bonus_status === "none",
  );
}

// =============================================================================================
// B1C-22..24 roles: adviser / introducer denied; General Admin fallback preserved (S4D)
// =============================================================================================
{
  resetDb();
  const rs = [];
  for (const actor of [advA, introA, outsider]) {
    for (const [name, data] of [
      ["createReferralLink", { referrerName: "Denied Role" }],
      ["textReferralLink", { id: C.a1 }],
      ["textRafInviteToFriend", { id: C.a1, friendPhone: "FRIENDPHONE-X" }],
      ["updateReferralBonusStatus", { id: R.a, bonusStatus: "paid" }],
    ]) {
      rs.push(
        (
          await deniedClean(
            () => call(rf, name, data, actor),
            (r) => !r.ok,
          )
        ).clean,
      );
    }
  }
  const adv = await call(rf, "createReferralLink", { referrerName: "Denied Role" }, advA);
  const intro = await call(
    rf,
    "updateReferralBonusStatus",
    { id: R.a, bonusStatus: "paid" },
    introA,
  );
  ok(
    "B1C-22 adviser and introducer (and a caller with no membership) are denied on all four writers with no side effect",
    rs.every(Boolean) && forbidden(adv) && forbidden(intro),
  );
}
{
  resetDb();
  const c = await call(rf, "createReferralLink", { referrerName: "General Admin Link" }, genA);
  const t = await call(rf, "textReferralLink", { id: C.a1 }, genA);
  const b = await call(rf, "updateReferralBonusStatus", { id: R.a, bonusStatus: "paid" }, genA);
  const cf = await call(rf, "textReferralLink", { id: C.b1 }, genA);
  ok(
    "B1C-23 General Admin with raf/finance_raf = none keeps its pre-B1c main-admin fallback inside its own tenant (intentionally unchanged — S4D debt)",
    c.ok && c.value.tenant_id === T.a && t.ok && b.ok && notFound(cf),
  );
  const prev = strip(git("show", `${BASE_REF}:${REF_FILE}`));
  ok(
    "B1C-24 General Admin fallback is the same rule as before B1c: pre-B1c requireRafAmend / bonus gate fell back to requireAdmin (isMainAdmin); the new capabilities keep isMainAdmin",
    /if \(access\.isOwner \|\| access\.isSupervisor \|\| canAmend\(access, "raf"\)\) return;\s*await requireAdmin\(userId\);/.test(
      prev,
    ) &&
      /if \(view\.isMainAdmin\) roles\.push\("admin"\);/.test(prev) &&
      G.amendCapability &&
      G.bonusCapability,
  );
}

// =============================================================================================
// B1C-25..26 A2 dual-membership model
// =============================================================================================
{
  resetDb();
  const a = await call(rf, "createReferralLink", { referrerName: "Dual Owner Link" }, dualA);
  const aText = await call(rf, "textReferralLink", { id: C.b1 }, dualA);
  ok(
    "B1C-25 dual-membership user acting in tenant A (owner) writes to tenant A only; tenant-B link Not found.",
    a.ok &&
      a.value.tenant_id === T.a &&
      a.value.tenantSlug === "tenant-a" &&
      notFound(aText) &&
      sms().length === 0,
  );
  const rs = [];
  for (const actor of [dualB, dualNone]) {
    for (const [name, data] of [
      ["createReferralLink", { referrerName: "Dual Denied" }],
      ["textReferralLink", { id: C.b1 }],
      ["textRafInviteToFriend", { id: C.b1, friendPhone: "FRIENDPHONE-X" }],
      ["updateReferralBonusStatus", { id: R.b, bonusStatus: "paid" }],
    ]) {
      rs.push(
        (
          await deniedClean(
            () => call(rf, name, data, actor),
            (r) => !r.ok,
          )
        ).clean,
      );
    }
  }
  ok(
    "B1C-26 the same user acting in tenant B (introducer) or with no verified tenant context is denied on all four writers; ambiguity fails closed",
    rs.every(Boolean),
  );
}

// =============================================================================================
// B1C-27..30 preservation (B2 / B4 / B3 surfaces), no migration / RLS / grants, no network
// =============================================================================================
const prevRef = git("show", `${BASE_REF}:${REF_FILE}`);
{
  const names = [
    "claimReferral",
    "markReferralQualified",
    "resolveReferralCode",
    "resolveReferralCodeMeta",
    "listMyReferralActivity",
    "ensureMyReferralLink",
    "sendMyReferralLink",
  ];
  const changed = names.filter((n) => {
    const a = topLevelDeclaration(prevRef, n);
    return a === null || a !== topLevelDeclaration(REF_SRC, n);
  });
  ok(
    "B1C-27 B2 functions byte-identical to the baseline (markReferralQualified untouched)",
    changed.length === 0,
    changed.join(","),
  );
}
{
  const reads2 = [
    [
      "src/lib/finance.functions.ts",
      [
        "ensureRafCommissionLedgerEntry",
        "listCommissionPayouts",
        "listMyCommissionStatement",
        "updateCommissionPayoutStatus",
        "updateSessionCommissionPayoutStatus",
        "applyCommissionPayoutStatusPatch",
      ],
    ],
    ["src/lib/introducer-customer.functions.ts", ["lookupIntroducerByCode"]],
  ];
  const changed = [];
  for (const [f, names] of reads2) {
    const a = git("show", `${BASE_REF}:${f}`);
    const b = readFileSync(resolve(root, f), "utf8");
    for (const n of names) {
      const x = topLevelDeclaration(a, n);
      if (x === null || x !== topLevelDeclaration(b, n)) changed.push(`${f}#${n}`);
    }
  }
  ok(
    "B1C-28 B4 finance functions and lookupIntroducerByCode (B3) byte-identical to the baseline",
    changed.length === 0,
    changed.join(","),
  );
}
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
  ok(
    "B1C-29 no migration, RLS, grant or schema change; canonical authority modules unchanged",
    migrationDiff === "" &&
      migrationNew === "" &&
      authorityDiff === "" &&
      !/\.rpc\(|grant |policy /i.test(strip(REF_SRC)),
    [migrationDiff, migrationNew, authorityDiff].filter(Boolean).join(","),
  );
}

// =============================================================================================
// B1C-NC negative controls: each mutated module must fail its runtime check and static guard,
// and must demonstrably produce the unsafe effect (not merely crash)
// =============================================================================================
/** The mutant still serves ordinary same-tenant traffic, so a failure is not a load error. */
async function mutantLive(mod) {
  resetDb();
  const c = await call(mod, "createReferralLink", { referrerName: "Live Check" }, ownerA);
  const t = await call(mod, "textReferralLink", { id: C.a1 }, ownerA);
  const b = await call(mod, "updateReferralBonusStatus", { id: R.a3, bonusStatus: "paid" }, ownerA);
  return c.ok && t.ok && b.ok;
}
const NEGATIVE_CONTROLS = [
  {
    label: "textReferralLink tenant filter removed",
    mutate: (s) => replaceInWriter(s, "textReferralLink", '\n      .eq("tenant_id", tenantId)', ""),
    guard: "textScoped",
    runtime: (m) => crossSmsSafe(m, "textReferralLink"),
    evidence: async (m) => {
      resetDb();
      await call(m, "textReferralLink", { id: C.b1 }, ownerA);
      return sms().some((x) => x.to === "REFPHONE-B1");
    },
  },
  {
    label: "textRafInviteToFriend tenant filter removed",
    mutate: (s) =>
      replaceInWriter(s, "textRafInviteToFriend", '\n      .eq("tenant_id", tenantId)', ""),
    guard: "friendScoped",
    runtime: (m) => crossSmsSafe(m, "textRafInviteToFriend"),
    evidence: async (m) => {
      resetDb();
      await call(m, "textRafInviteToFriend", { id: C.b1, friendPhone: "FRIENDPHONE-X" }, ownerA);
      return sms().some((x) => x.body.includes("BRAVO111"));
    },
  },
  {
    label: "createReferralLink referrerUserId proof removed",
    mutate: (s) =>
      replaceInWriter(
        s,
        "createReferralLink",
        "      if (!people.includes(data.referrerUserId)) throw new Error(RESOURCE_NOT_FOUND_MESSAGE);\n",
        "",
      ),
    guard: "createReferrerProof",
    runtime: crossCreateSafe,
    evidence: async (m) => {
      resetDb();
      const r = await call(m, "createReferralLink", { referrerUserId: U.custB }, ownerA);
      return r.ok && r.value.referrer_name === "Bravo Customer";
    },
  },
  {
    label: "createReferralLink reverts to resolveSoleMembershipTenant",
    mutate: (s) => {
      const step = replaceInWriter(
        s,
        "createReferralLink",
        "const { resolveActingTenantForList, RESOURCE_NOT_FOUND_MESSAGE, withForcedTenantId } =",
        "const { resolveActingTenantForList, RESOURCE_NOT_FOUND_MESSAGE, withForcedTenantId, resolveSoleMembershipTenant } =",
      );
      return step
        ? replaceInWriter(
            step,
            "createReferralLink",
            "          tenantId,\n        ),\n      )",
            "          (await resolveSoleMembershipTenant(context.userId)).tenant.id,\n        ),\n      )",
          )
        : null;
    },
    guard: "createActingTenant",
    runtime: platformOperationalCreateSafe,
    evidence: async (m) => {
      resetDb();
      await call(m, "createReferralLink", { referrerName: "Operational Referrer" }, platOp);
      return writes.some((w) => w.table === "referral_codes" && w.row.tenant_id === T.b);
    },
  },
  {
    label: "updateReferralBonusStatus tenant proof removed",
    mutate: (s) =>
      replaceInWriter(
        s,
        "updateReferralBonusStatus",
        /await scopeReferralRowsToTenant\([\s\S]*?\n {10}tenantId,\n {8}\)/,
        "[referralRow]",
      ),
    guard: "bonusTenantProof",
    runtime: crossBonusSafe,
    evidence: async (m) => {
      resetDb();
      const r = await call(
        m,
        "updateReferralBonusStatus",
        { id: R.b, bonusStatus: "paid" },
        ownerA,
      );
      return r.ok;
    },
  },
  {
    label: "finance_ledger tenant filter removed",
    mutate: (s) => {
      const step = replaceInWriter(
        s,
        "updateReferralBonusStatus",
        '        .eq("referral_id", data.id)\n        .eq("tenant_id", tenantId)\n',
        '        .eq("referral_id", data.id)\n',
      );
      return step
        ? replaceInWriter(
            step,
            "updateReferralBonusStatus",
            '          .eq("referral_id", data.id)\n          .eq("tenant_id", tenantId);',
            '          .eq("referral_id", data.id);',
          )
        : null;
    },
    guard: "ledgerTenantScoped",
    runtime: ledgerScopeSafe,
    evidence: async (m) => {
      resetDb();
      await call(m, "updateReferralBonusStatus", { id: R.a2, bonusStatus: "paid" }, ownerA);
      return db.finance_ledger.find((l) => l.id === L.xB).payout_status === "paid";
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
    const realSafe = await nc.runtime(rf);
    const realEffect = await nc.evidence(rf);
    const mod = await loadMutant(mutated);
    live = await mutantLive(mod);
    const mutantSafe = await outcome(() => nc.runtime(mod));
    runtimeCaught = realSafe && mutantSafe.ok && mutantSafe.value === false;
    effect = !realEffect && (await nc.evidence(mod));
    detail = `guard=${guardCaught} runtime=${runtimeCaught} unsafeEffect=${effect} mutantLive=${live}${mutantSafe.ok ? "" : ` (${mutantSafe.message})`}`;
  }
  const caught = Boolean(mutated) && guardCaught && runtimeCaught && effect && live;
  if (caught) ncPassed += 1;
  ok(`B1C-NC${i + 1} negative control fails as required: ${nc.label}`, caught, detail);
}

resetDb();
ok(
  "B1C-30 no network or unstubbed backend call; SMS only through the in-process recorder",
  unknownCalls.length === 0 && !logs.some((l) => /refused host|unstubbed/.test(l)),
  [...unknownCalls, ...logs.filter((l) => /refused host|unstubbed/.test(l))].join(" | "),
);

console.log("");
console.log(`NEGATIVE_CONTROL_COUNT=${NEGATIVE_CONTROLS.length}`);
console.log(
  `NEGATIVE_CONTROLS_PASS=${ncPassed === NEGATIVE_CONTROLS.length ? "yes" : "no"} (${ncPassed}/${NEGATIVE_CONTROLS.length})`,
);
console.log("GENERAL_ADMIN_FALLBACK=preserved (S4D)");
console.log("LEGACY_TENANTLESS_REFERRAL=allowed via owned code, not stamped, no ledger row (B4)");
if (failures.length) {
  console.log(`${total - failures.length}/${total} PASS`);
  console.log(`FAILED: ${failures.join("; ")}`);
  process.exit(1);
}
console.log(`${total - failures.length}/${total} PASS`);
