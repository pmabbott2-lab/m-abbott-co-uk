/**
 * G7F-4S4B emergency authority boundary hardening — offline verification.
 *
 * Covers: unverified-JWT fail-closed (real requireSupabaseAuth + real supabase-js getClaims
 * against a fake Auth host and locally generated keys), platform-only test-account tooling,
 * legacy setAdvisorRole / setIntroducerRole tenant binding, user_roles and global-template RLS
 * (PGlite with the S4B migration applied verbatim, twice), and tenant-only template mutation.
 *
 * Synthetic fixtures only: no network, no staging, no production, no real user, no real token.
 * Stubbed (not under test): getRequest, the Supabase service-role client (in-memory tables),
 * tenant role resolution (derived from in-memory memberships via the real resolveTenantRoleView),
 * requireSuperOwner (Super Owner set) and the superseded-session RPC check.
 *
 * PGlite is loaded from outside the repository:
 *   npm install --prefix /tmp/g7f4s3b/pglite @electric-sql/pglite@0.5.8
 *   G7F4S4B_PGLITE_DIR=/tmp/g7f4s3b/pglite (default)
 * Run: npm exec --yes --package=tsx -- tsx scripts/g7f4s4b-authority-boundary-verify.mjs
 */
import { readFileSync, readdirSync } from "node:fs";
import { createRequire, register } from "node:module";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { generateKeyPairSync, randomUUID, sign as cryptoSign } from "node:crypto";

for (const k of [
  "SUPABASE_URL",
  "VITE_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_PUBLISHABLE_KEY",
  "VITE_SUPABASE_PUBLISHABLE_KEY",
]) {
  delete process.env[k];
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// Last commit before S4B (G7F-4S3 closure): the pre-S4B control and the S3 byte-identity check.
const PRE_S4B_REF = "93c5b4c";
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
const read = (rel) => readFileSync(resolve(root, rel), "utf8");
const code = (rel) => strip(read(rel));
const fileUrl = (rel) => pathToFileURL(resolve(root, rel)).href;

// --- module stubs ---------------------------------------------------------------------------
const realStartUrl = import.meta.resolve("@tanstack/react-start");
const startStub = `
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
const realStartServerUrl = import.meta.resolve("@tanstack/react-start/server");
const startServerStub = `
import * as real from ${JSON.stringify(realStartServerUrl)};
export * from ${JSON.stringify(realStartServerUrl)};
export function getRequest() {
  return globalThis.__g7f4s4bRequest !== undefined ? globalThis.__g7f4s4bRequest : real.getRequest();
}
`;
const clientStub = `
const bind = (p) => {
  const db = globalThis.__g7f4s4bDb;
  const v = db[p];
  return typeof v === "function" ? v.bind(db) : v;
};
export const supabaseAdmin = new Proxy({}, { get: (_t, p) => bind(p) });
export const supabaseAdminUntyped = supabaseAdmin;
`;
const tenantRoleReal = fileUrl("src/lib/tenant-role.ts");
const tenantRoleServerReal = fileUrl("src/lib/tenant-role.server.ts");
const tenantRoleServerStub = `
export * from ${JSON.stringify(tenantRoleServerReal)};
import { resolveTenantRoleView } from ${JSON.stringify(tenantRoleReal)};
export async function resolveActingTenantRole(userId, _slug, tenantId) {
  const override = globalThis.__g7f4s4bViewOverride.get(userId);
  if (override) return override;
  const rows = globalThis.__g7f4s4bDb.tables.tenant_memberships.filter((r) => r.user_id === userId && r.active);
  const tenants = [...new Set(rows.map((r) => r.tenant_id))];
  const acting = tenantId ?? globalThis.__g7f4s4bActingTenant.get(userId) ?? (tenants.length === 1 ? tenants[0] : null);
  const roles = rows.filter((r) => r.tenant_id === acting).map((r) => r.role);
  return resolveTenantRoleView({ membershipRoles: roles, tenantId: acting });
}
`;
const tenantAssertReal = fileUrl("src/lib/tenant-assert.server.ts");
const tenantAssertStub = `
export * from ${JSON.stringify(tenantAssertReal)};
export async function resolveSoleMembershipTenant(userId) {
  const rows = globalThis.__g7f4s4bDb.tables.tenant_memberships.filter((r) => r.user_id === userId && r.active);
  const tenants = [...new Set(rows.map((r) => r.tenant_id))];
  if (tenants.length !== 1) throw new Error("Active tenant membership is required.");
  return { tenant: { id: tenants[0], slug: "t", status: "active" }, authority: "membership", userId };
}
`;
const authorityReal = fileUrl("src/lib/platform-authority.server.ts");
const authorityStub = `
export * from ${JSON.stringify(authorityReal)};
import { PlatformRouteDeniedError } from ${JSON.stringify(authorityReal)};
export async function requireSuperOwner(userId) {
  globalThis.__g7f4s4bSuperOwnerChecks.push(userId);
  if (!globalThis.__g7f4s4bSuperOwners.has(userId)) throw new PlatformRouteDeniedError();
  return { userId, isSuperOwner: true, canAccessPlatform: true };
}
export async function assertAuthContextNotSuperseded(ctx) {
  globalThis.__g7f4s4bSupersedeChecks.push(ctx);
}
`;
const dataUrl = (src) => `data:text/javascript,${encodeURIComponent(src)}`;
const stubs = {
  "@tanstack/react-start": dataUrl(startStub),
  "@tanstack/react-start/server": dataUrl(startServerStub),
};
for (const [alias, rel, src] of [
  [
    "@/integrations/supabase/client.server",
    "src/integrations/supabase/client.server.ts",
    clientStub,
  ],
  ["@/lib/tenant-role.server", "src/lib/tenant-role.server.ts", tenantRoleServerStub],
  ["@/lib/tenant-assert.server", "src/lib/tenant-assert.server.ts", tenantAssertStub],
  ["@/lib/platform-authority.server", "src/lib/platform-authority.server.ts", authorityStub],
]) {
  stubs[alias] = dataUrl(src);
  stubs[fileUrl(rel)] = stubs[alias];
}
register(
  dataUrl(`
const stubs = ${JSON.stringify(stubs)};
export async function resolve(specifier, context, next) {
  if (stubs[specifier] && !String(context.parentURL ?? "").startsWith("data:")) {
    return { url: stubs[specifier], shortCircuit: true };
  }
  return next(specifier, context);
}
`),
  import.meta.url,
);

globalThis.__g7f4s4bViewOverride = new Map();
globalThis.__g7f4s4bActingTenant = new Map();
globalThis.__g7f4s4bSuperOwners = new Set();
globalThis.__g7f4s4bSuperOwnerChecks = [];
globalThis.__g7f4s4bSupersedeChecks = [];

// --- in-memory service-role client ----------------------------------------------------------
class Query {
  constructor(db, table) {
    this.db = db;
    this.table = table;
    this.op = "select";
    this.filters = [];
    this.where = [];
    this.lim = null;
    this.mode = null;
  }
  rows() {
    return (this.db.tables[this.table] ??= []);
  }
  select() {
    return this;
  }
  insert(p) {
    this.op = "insert";
    this.payload = p;
    return this;
  }
  upsert(p) {
    this.op = "upsert";
    this.payload = p;
    return this;
  }
  update(p) {
    this.op = "update";
    this.payload = p;
    return this;
  }
  delete() {
    this.op = "delete";
    return this;
  }
  eq(c, v) {
    this.filters.push((r) => r[c] === v);
    this.where.push(`${c}=${v}`);
    return this;
  }
  neq(c, v) {
    this.filters.push((r) => r[c] !== v);
    this.where.push(`${c}!=${v}`);
    return this;
  }
  in(c, a) {
    this.filters.push((r) => a.includes(r[c]));
    this.where.push(`${c} in (${a.length})`);
    return this;
  }
  is(c, v) {
    this.filters.push((r) => (r[c] ?? null) === v);
    this.where.push(`${c} is ${v}`);
    return this;
  }
  not(c, op, v) {
    if (op === "is") this.filters.push((r) => (r[c] ?? null) !== v);
    this.where.push(`${c} not ${op} ${v}`);
    return this;
  }
  or(expr) {
    const parts = expr.split(",").map((s) => {
      const [c, op, ...rest] = s.split(".");
      const v = rest.join(".");
      if (op === "eq") return (r) => String(r[c]) === v;
      if (op === "is" && v === "null") return (r) => (r[c] ?? null) === null;
      return () => false;
    });
    this.filters.push((r) => parts.some((p) => p(r)));
    this.where.push(`or(${expr})`);
    return this;
  }
  order() {
    return this;
  }
  limit(n) {
    this.lim = n;
    return this;
  }
  maybeSingle() {
    this.mode = "maybe";
    return this.run();
  }
  single() {
    this.mode = "single";
    return this.run();
  }
  then(a, b) {
    return this.run().then(a, b);
  }
  async run() {
    const all = this.rows();
    const hit = all.filter((r) => this.filters.every((f) => f(r)));
    if (this.op === "select") {
      let data = hit.map((r) => ({ ...r }));
      if (this.lim != null) data = data.slice(0, this.lim);
      if (this.mode === "maybe") {
        if (data.length > 1) return { data: null, error: { message: "multiple rows" } };
        return { data: data[0] ?? null, error: null };
      }
      if (this.mode === "single") {
        if (data.length !== 1) return { data: null, error: { message: "not exactly one row" } };
        return { data: data[0], error: null };
      }
      return { data, error: null };
    }
    this.db.writes.push({
      table: this.table,
      op: this.op,
      where: [...this.where],
      payload: this.payload ?? null,
    });
    if (this.op === "insert" || this.op === "upsert") {
      for (const r of [].concat(this.payload)) all.push({ ...r });
    } else if (this.op === "update") {
      for (const r of hit) Object.assign(r, this.payload);
    } else if (this.op === "delete") {
      this.db.tables[this.table] = all.filter((r) => !hit.includes(r));
    }
    return { data: null, error: null };
  }
}
function makeDb(seed) {
  const db = {
    tables: structuredClone(seed),
    writes: [],
    authCalls: [],
    rpcCalls: [],
    from(table) {
      return new Query(db, table);
    },
    async rpc(name, args) {
      db.rpcCalls.push({ name, args });
      return { data: null, error: null };
    },
    auth: {
      admin: {
        async listUsers() {
          db.authCalls.push("listUsers");
          return { data: { users: [] }, error: null };
        },
        async createUser() {
          db.authCalls.push("createUser");
          return { data: null, error: { message: "blocked in verifier" } };
        },
        async updateUserById() {
          db.authCalls.push("updateUserById");
          return { data: null, error: { message: "blocked in verifier" } };
        },
        async deleteUser() {
          db.authCalls.push("deleteUser");
          return { data: null, error: { message: "blocked in verifier" } };
        },
      },
    },
  };
  return db;
}

// --- synthetic fixtures ---------------------------------------------------------------------
const T = { a: randomUUID(), b: randomUUID() };
const U = Object.fromEntries(
  [
    "ownerA",
    "supA",
    "genA",
    "advA",
    "advA2",
    "introA",
    "custA",
    "ownerB",
    "advB",
    "introB",
    "dual",
    "platform",
    "attacker",
  ].map((k) => [k, randomUUID()]),
);
const TPL = { global: randomUUID(), globalOnly: randomUUID(), a: randomUUID(), b: randomUUID() };
const INTRO = { a: randomUUID(), b: randomUUID() };
const m = (user_id, tenant_id, role) => ({
  id: randomUUID(),
  user_id,
  tenant_id,
  role,
  active: true,
});
const SEED = {
  tenant_memberships: [
    m(U.ownerA, T.a, "owner"),
    m(U.supA, T.a, "supervisor"),
    m(U.genA, T.a, "general"),
    m(U.advA, T.a, "adviser"),
    m(U.advA2, T.a, "adviser"),
    m(U.introA, T.a, "introducer"),
    m(U.custA, T.a, "customer"),
    m(U.ownerB, T.b, "owner"),
    m(U.advB, T.b, "adviser"),
    m(U.introB, T.b, "introducer"),
    m(U.dual, T.a, "adviser"),
    m(U.dual, T.b, "general"),
  ],
  user_roles: [
    { user_id: U.advA, role: "advisor" },
    { user_id: U.advA2, role: "advisor" },
    { user_id: U.advB, role: "advisor" },
    { user_id: U.dual, role: "advisor" },
    { user_id: U.introA, role: "introducer" },
    { user_id: U.introB, role: "introducer" },
    { user_id: U.custA, role: "customer" },
    { user_id: U.ownerA, role: "admin" },
  ],
  advisor_profiles: [
    { user_id: U.advA2, code: "ADV02", tenant_id: T.a, deleted_at: null },
    { user_id: U.advB, code: "ADVB1", tenant_id: T.b, deleted_at: null },
  ],
  introducers: [
    {
      id: INTRO.a,
      user_id: U.introA,
      company_code: "4101",
      company_name: "Intro A Co",
      slug: "intro-a-co",
      tenant_id: T.a,
      active: true,
    },
    {
      id: INTRO.b,
      user_id: U.introB,
      company_code: "4201",
      company_name: "Intro B Co",
      slug: "intro-b-co",
      tenant_id: T.b,
      active: true,
    },
  ],
  customer_introducer_links: [
    { id: randomUUID(), customer_id: U.custA, introducer_id: INTRO.a, tenant_id: T.a },
  ],
  session_advisors: [{ session_id: randomUUID(), advisor_id: U.advA2, tenant_id: T.a }],
  communication_templates: [
    {
      id: TPL.global,
      tenant_id: null,
      template_key: "shared_key",
      name: "Global",
      channel: "sms",
      subject: null,
      body: "GLOBAL BODY",
      active: true,
    },
    {
      id: TPL.globalOnly,
      tenant_id: null,
      template_key: "global_only",
      name: "Global only",
      channel: "sms",
      subject: null,
      body: "GLOBAL ONLY BODY",
      active: true,
    },
    {
      id: TPL.a,
      tenant_id: T.a,
      template_key: "tenant_a_key",
      name: "Tenant A",
      channel: "sms",
      subject: null,
      body: "TENANT A BODY",
      active: true,
    },
    {
      id: TPL.b,
      tenant_id: T.b,
      template_key: "tenant_b_key",
      name: "Tenant B",
      channel: "sms",
      subject: null,
      body: "TENANT B BODY",
      active: true,
    },
  ],
  communication_template_versions: [],
};
const freshDb = () => {
  globalThis.__g7f4s4bDb = makeDb(SEED);
  globalThis.__g7f4s4bViewOverride.clear();
  globalThis.__g7f4s4bActingTenant.clear();
  globalThis.__g7f4s4bSuperOwnerChecks.length = 0;
  return globalThis.__g7f4s4bDb;
};
freshDb();
globalThis.__g7f4s4bSuperOwners.add(U.platform);

const FAKE_HOST = "g7f4s4b.invalid";
process.env.SUPABASE_URL = `http://${FAKE_HOST}`;
process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_g7f4s4b_not_a_real_key";

// --- modules under test ---------------------------------------------------------------------
const { requireSupabaseAuth } = await import("../src/integrations/supabase/auth-middleware.ts");
const pure = await import("../src/lib/privileged-mfa.ts");
const tenantRole = await import("../src/lib/tenant-role.ts");
const adminAccessMod = await import("../src/lib/admin-access.ts");
const sf = await import("../src/lib/sessions.functions.ts");
const ta = await import("../src/lib/test-accounts.functions.ts");
const comms = await import("../src/lib/comms.functions.ts");
const commsServer = await import("../src/lib/comms.server.ts");

async function invoke(fn, data, userId) {
  const d = fn.__def;
  const parsed = d.validator ? await d.validator(data) : data;
  return d.handler({ data: parsed, context: { userId, claims: { sub: userId } } });
}

// =============================================================================================
// TEST 1–3: authentication fails closed without a verified signature
// =============================================================================================
const b64u = (v) =>
  Buffer.from(typeof v === "string" ? v : JSON.stringify(v)).toString("base64url");
const goodKeys = generateKeyPairSync("ec", { namedCurve: "P-256" });
const rogueKeys = generateKeyPairSync("ec", { namedCurve: "P-256" });
const KID = "g7f4s4b-kid";
const jwk = { ...goodKeys.publicKey.export({ format: "jwk" }), kid: KID, alg: "ES256", use: "sig" };
const now = Math.floor(Date.now() / 1000);
const claimsFor = (sub) => ({
  sub,
  exp: now + 3600,
  iat: now - 10,
  aal: "aal1",
  role: "authenticated",
  session_id: randomUUID(),
});
function es256(payload, privateKey, kid = KID) {
  const head = b64u({ alg: "ES256", typ: "JWT", kid });
  const body = b64u(payload);
  const sig = cryptoSign("sha256", Buffer.from(`${head}.${body}`), {
    key: privateKey,
    dsaEncoding: "ieee-p1363",
  });
  return `${head}.${body}.${sig.toString("base64url")}`;
}
const forgedHs256 = `${b64u({ alg: "HS256", typ: "JWT" })}.${b64u({ ...claimsFor(U.attacker), aal: "aal2" })}.${b64u("forged-signature")}`;
const unsignedNone = `${b64u({ alg: "none", typ: "JWT" })}.${b64u(claimsFor(U.attacker))}.${b64u("x")}`;

let authNetwork = "down";
const authRequests = [];
globalThis.fetch = async (input) => {
  const url = typeof input === "string" ? input : input.url;
  authRequests.push(url);
  if (!url.startsWith(`http://${FAKE_HOST}/`)) throw new Error(`unexpected network target ${url}`);
  if (authNetwork === "down") throw new TypeError("fetch failed");
  const json = (status, body) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  if (url.endsWith("/auth/v1/.well-known/jwks.json")) return json(200, { keys: [jwk] });
  if (url.endsWith("/auth/v1/user"))
    return json(401, { code: 401, error_code: "bad_jwt", msg: "invalid JWT" });
  return json(404, {});
};

const mwServer = requireSupabaseAuth.options.server;
async function runMw(token) {
  globalThis.__g7f4s4bRequest = new Request("https://app.invalid/_serverFn/x", {
    method: "POST",
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  globalThis.__g7f4s4bSupersedeChecks.length = 0;
  let nextCtx = null;
  const r = await outcome(() =>
    mwServer({
      next: async (opts) => {
        nextCtx = opts?.context ?? {};
        return {};
      },
      context: {},
      data: {},
    }),
  );
  globalThis.__g7f4s4bRequest = undefined;
  return { ...r, nextCtx };
}

// Network down first, before any JWKS is cached.
authNetwork = "down";
const t1Down = await runMw(forgedHs256);
const t1None = await runMw(unsignedNone);
const t2Es = await runMw(es256(claimsFor(U.ownerA), goodKeys.privateKey));
ok(
  "TEST_1a forged HS256 token with Auth unreachable: no identity, next() never called",
  !t1Down.ok && t1Down.nextCtx === null && /Auth service unavailable/.test(t1Down.message),
  t1Down.message,
);
ok(
  "TEST_1b alg=none token with Auth unreachable: no identity",
  !t1None.ok && t1None.nextCtx === null,
  t1None.message,
);
ok(
  "TEST_2 network failure while fetching the signing key fails authentication (even for a genuinely signed token)",
  !t2Es.ok && t2Es.nextCtx === null && /Auth service unavailable/.test(t2Es.message),
  t2Es.message,
);

authNetwork = "up";
const t1Rogue = await runMw(es256(claimsFor(U.attacker), rogueKeys.privateKey));
const t1Hs = await runMw(forgedHs256);
ok(
  "TEST_1c token signed by a foreign key is rejected as invalid",
  !t1Rogue.ok && t1Rogue.nextCtx === null && /Invalid token/.test(t1Rogue.message),
  t1Rogue.message,
);
ok(
  "TEST_1d forged HS256 token rejected when Auth answers 401",
  !t1Hs.ok && t1Hs.nextCtx === null && /Invalid token/.test(t1Hs.message),
  t1Hs.message,
);
const goodClaims = claimsFor(U.ownerA);
const t3 = await runMw(es256(goodClaims, goodKeys.privateKey));
ok(
  "TEST_3 valid verified token still authenticates (userId = verified sub, verified assurance, supersede check ran)",
  t3.ok &&
    t3.nextCtx?.userId === U.ownerA &&
    pure.isVerifiedAuthContext(t3.nextCtx?.authAssurance) &&
    t3.nextCtx.authAssurance.sessionId === goodClaims.session_id &&
    globalThis.__g7f4s4bSupersedeChecks.length === 1,
  t3.message ?? "",
);
authNetwork = "down";
const t3Cached = await runMw(es256(claimsFor(U.ownerA), goodKeys.privateKey));
const t1CachedRogue = await runMw(es256(claimsFor(U.attacker), rogueKeys.privateKey));
ok(
  "TEST_3b signature verified against the cached key still works while Auth is unreachable; a foreign signature does not",
  t3Cached.ok &&
    t3Cached.nextCtx?.userId === U.ownerA &&
    !t1CachedRogue.ok &&
    t1CachedRogue.nextCtx === null,
);
ok(
  "TEST_1e every network call went to the fake Auth host only",
  authRequests.length > 0 &&
    authRequests.every((u) => u.startsWith(`http://${FAKE_HOST}/auth/v1/`)),
  `${authRequests.length} requests`,
);

// Static inventory: no second unverified fallback.
const mw = code("src/integrations/supabase/auth-middleware.ts");
const srcFiles = readdirSync(resolve(root, "src"), { recursive: true })
  .map(String)
  .filter((f) => /\.(ts|tsx)$/.test(f));
const usersOf = (re) => srcFiles.filter((f) => re.test(strip(read(`src/${f}`)))).sort();
ok(
  "TEST_1f middleware has no unverified decode path and admits identity only from getClaims() without error",
  !/decodeJwtPayload|jwtPayloadUsable|fallback/.test(mw.replace(/^import .*$/gm, "")) &&
    /import \{ isNetworkAuthError \} from '@\/lib\/auth-jwt-fallback\.server'/.test(mw) &&
    /if \(!lastError && data\?\.claims\?\.sub\)/.test(mw) &&
    (mw.match(/runWithRequestAuthAssurance\(/g) ?? []).length === 1 &&
    (mw.match(/userId:/g) ?? []).length === 1 &&
    /userId: data!\.claims\.sub/.test(mw),
);
const getClaimsUsers = usersOf(/\.getClaims\(/);
ok(
  "TEST_1g getClaims() is called only by requireSupabaseAuth",
  JSON.stringify(getClaimsUsers) === JSON.stringify(["integrations/supabase/auth-middleware.ts"]),
  getClaimsUsers.join(","),
);
const decodeUsers = usersOf(/decodeJwtPayload\(/);
const bg = code("src/lib/break-glass.server.ts");
const rab = bg.slice(
  bg.indexOf("async function readAuthBinding"),
  bg.indexOf("async function rehydrateBgSessionCookies"),
);
ok(
  "TEST_1h only remaining unverified decode is break-glass session-binding metadata (never userId), after the verified-context return",
  JSON.stringify(decodeUsers) ===
    JSON.stringify(["lib/auth-jwt-fallback.server.ts", "lib/break-glass.server.ts"]) &&
    rab.indexOf("isVerifiedAuthContext(assurance)") < rab.indexOf("decodeJwtPayload(") &&
    !/userId|\.sub\b/.test(rab),
  decodeUsers.join(","),
);
const fallbackSrc = code("src/lib/auth-jwt-fallback.server.ts");
ok(
  "TEST_1i jwtPayloadUsable removed",
  !/jwtPayloadUsable/.test(fallbackSrc) && usersOf(/jwtPayloadUsable/).length === 0,
);
const headMw = execFileSync(
  "git",
  ["show", `${PRE_S4B_REF}:src/integrations/supabase/auth-middleware.ts`],
  {
    cwd: root,
    encoding: "utf8",
  },
);
ok(
  "TEST_1j control: the pre-S4B middleware admitted fallback!.sub from an unverified decode",
  /decodeJwtPayload\(token\)/.test(headMw) && /userId: fallback!\.sub/.test(headMw),
);

// =============================================================================================
// TEST 4–6: global test-account tooling requires platform Super Owner
// =============================================================================================
const TEST_FNS = {
  provisionTestAccounts: [ta.provisionTestAccounts, undefined],
  revokeTestAccounts: [ta.revokeTestAccounts, undefined],
  resetTestAccount: [ta.resetTestAccount, { email: "13@test.co.uk" }],
  listTestAccountStatus: [ta.listTestAccountStatus, undefined],
};
async function testAccountMatrix(actor) {
  const db = freshDb();
  const results = {};
  for (const [name, [fn, data]] of Object.entries(TEST_FNS)) {
    results[name] = await outcome(() => invoke(fn, data, actor));
  }
  const allDenied = Object.values(results).every(
    (r) => !r.ok && r.error?.name === "PlatformRouteDeniedError",
  );
  return {
    allDenied,
    authCalls: db.authCalls.length,
    writes: db.writes.length,
    checks: globalThis.__g7f4s4bSuperOwnerChecks.length,
  };
}
for (const [label, actor, test] of [
  ["Tenant Owner", U.ownerA, "TEST_4"],
  ["Supervisor", U.supA, "TEST_5"],
  ["General Admin", U.genA, "TEST_6"],
  ["Adviser", U.advA, "TEST_6b"],
  ["Introducer", U.introA, "TEST_6c"],
  ["Customer", U.custA, "TEST_6d"],
]) {
  const r = await testAccountMatrix(actor);
  ok(
    `${test} ${label} cannot list, provision, reset or revoke global test accounts (no Auth Admin call, no write)`,
    r.allDenied && r.authCalls === 0 && r.writes === 0 && r.checks === 4,
    `authCalls=${r.authCalls} writes=${r.writes}`,
  );
}
{
  const db = freshDb();
  const r = await outcome(() => invoke(ta.listTestAccountStatus, undefined, U.platform));
  ok(
    "TEST_6e control: platform Super Owner passes the gate (read-only status listing)",
    r.ok && Array.isArray(r.value) && db.authCalls.join() === "listUsers" && db.writes.length === 0,
  );
}
const taSrc = code("src/lib/test-accounts.functions.ts");
const handlers = taSrc.split("export const ").slice(1);
ok(
  "TEST_6f every exported test-account function runs the platform gate before any other work; tenant role is not consulted",
  handlers.length === 4 &&
    handlers.every((h) => {
      const body = h.slice(h.indexOf(".handler("));
      const gate = body.indexOf("await requireTestAccountAuthority(context.userId)");
      const firstAwait = body.indexOf("await ");
      return gate !== -1 && gate === firstAwait;
    }) &&
    /requireSuperOwner\(userId\)/.test(taSrc) &&
    !/resolveAdminAccess|resolveActingTenantRole|isOwner/.test(taSrc),
);
const authoritySrc = code("src/lib/platform-authority.server.ts");
ok(
  "TEST_6g requireSuperOwner derives from platform authority (platform_roles), with platform AAL2 assurance",
  /export async function requireSuperOwner[\s\S]{0,300}resolvePlatformAuthority\(userId\)[\s\S]{0,120}if \(!view\.isSuperOwner\) throw new PlatformRouteDeniedError\(\)[\s\S]{0,120}requirePrivilegedPlatformAssurance/.test(
    authoritySrc,
  ),
);

// =============================================================================================
// TEST 7–9: legacy role setters
// =============================================================================================
const snapshot = (db) => JSON.stringify(db.tables);
async function denied(fn, data, actor) {
  const db = freshDb();
  const before = snapshot(db);
  const r = await outcome(() => invoke(fn, data, actor));
  return {
    ok: r.ok,
    message: r.message,
    writes: db.writes.length,
    unchanged: snapshot(db) === before,
  };
}
const denyAll = (rs) => rs.every((r) => !r.ok && r.writes === 0 && r.unchanged);

const t7 = [
  await denied(sf.setAdvisorRole, { userId: U.custA, makeAdvisor: true }, U.advA),
  await denied(sf.setAdvisorRole, { userId: U.attacker, makeAdvisor: true }, U.advA),
  await denied(sf.setAdvisorRole, { userId: U.custA, makeAdvisor: true }, U.ownerA),
  await denied(sf.setAdvisorRole, { userId: U.advA2, makeAdvisor: false }, U.advA),
];
ok(
  "TEST_7 Adviser cannot grant Adviser to another user (grant path closed for every caller; adviser cannot revoke either)",
  denyAll(t7),
  t7.map((r) => r.message).join(" | "),
);
const t8 = [
  await denied(
    sf.setIntroducerRole,
    { userId: U.custA, makeIntroducer: true, companyMode: "new" },
    U.advA,
  ),
  await denied(
    sf.setIntroducerRole,
    { userId: U.introB, makeIntroducer: true, companyMode: "join", companyCode: "4101" },
    U.advA,
  ),
  await denied(
    sf.setIntroducerRole,
    { userId: U.introA, makeIntroducer: true, companyMode: "new" },
    U.ownerA,
  ),
  await denied(sf.setIntroducerRole, { userId: U.introA, makeIntroducer: false }, U.advA),
  await denied(sf.setIntroducerRole, { userId: U.introB, makeIntroducer: false }, U.advA),
];
ok(
  "TEST_8 Adviser cannot grant or revoke Introducer; no caller can re-point an introducer's company",
  denyAll(t8),
  t8.map((r) => r.message).join(" | "),
);
const t9 = [
  await denied(sf.setAdvisorRole, { userId: U.advB, makeAdvisor: false }, U.ownerA),
  await denied(sf.setIntroducerRole, { userId: U.introB, makeIntroducer: false }, U.ownerA),
  await denied(sf.setIntroducerRole, { userId: U.introA, makeIntroducer: false }, U.ownerB),
  await denied(sf.setAdvisorRole, { userId: U.advA2, makeAdvisor: false }, U.ownerB),
  await denied(sf.setAdvisorRole, { userId: U.dual, makeAdvisor: false }, U.ownerA),
  await denied(sf.setAdvisorRole, { userId: U.custA, makeAdvisor: false }, U.ownerA),
  await denied(sf.setIntroducerRole, { userId: U.custA, makeIntroducer: false }, U.ownerA),
  await denied(sf.setAdvisorRole, { userId: U.attacker, makeAdvisor: false }, U.supA),
];
ok(
  "TEST_9 tenant admin cannot role-mutate a target in another tenant, with staff standing elsewhere, or without the role here",
  denyAll(t9),
  t9.map((r) => r.message).join(" | "),
);
{
  const db = freshDb();
  globalThis.__g7f4s4bViewOverride.set(U.platform, {
    ...tenantRole.resolveTenantRoleView({ membershipRoles: ["supervisor"], tenantId: T.a }),
    accessContext: "platform_access",
    platformAccessLevel: "read_only",
  });
  const r = await outcome(() =>
    invoke(sf.setAdvisorRole, { userId: U.advA2, makeAdvisor: false }, U.platform),
  );
  ok(
    "TEST_9b platform read_only entry cannot mutate legacy roles",
    !r.ok && db.writes.length === 0,
  );
}
{
  const db = freshDb();
  const r = await outcome(() =>
    invoke(sf.setAdvisorRole, { userId: U.ownerA, makeAdvisor: false }, U.ownerA),
  );
  ok("TEST_9c self-removal still refused", !r.ok && db.writes.length === 0);
}
{
  const db = freshDb();
  const r = await outcome(() =>
    invoke(sf.setAdvisorRole, { userId: U.advA2, makeAdvisor: false }, U.ownerA),
  );
  const w = db.writes;
  ok(
    "TEST_9d control: Owner removes a same-tenant adviser's legacy role only; adviser_code and session_advisors untouched",
    r.ok &&
      w.length === 1 &&
      w[0].table === "user_roles" &&
      w[0].op === "delete" &&
      w[0].where.join("&") === `user_id=${U.advA2}&role=advisor` &&
      db.tables.advisor_profiles.find((p) => p.user_id === U.advA2)?.code === "ADV02" &&
      JSON.stringify(db.tables.session_advisors) === JSON.stringify(SEED.session_advisors) &&
      db.tables.user_roles.some((x) => x.user_id === U.advA && x.role === "advisor"),
    r.message ?? "",
  );
}
{
  const db = freshDb();
  const r = await outcome(() =>
    invoke(sf.setIntroducerRole, { userId: U.introA, makeIntroducer: false }, U.supA),
  );
  const w = db.writes;
  const ia = db.tables.introducers.find((x) => x.id === INTRO.a);
  const ib = db.tables.introducers.find((x) => x.id === INTRO.b);
  ok(
    "TEST_9e control: Supervisor deactivates only this tenant's introducer row; company identity and links preserved",
    r.ok &&
      w.length === 2 &&
      w[0].table === "introducers" &&
      w[0].op === "update" &&
      w[0].where.join("&") === `user_id=${U.introA}&tenant_id=${T.a}` &&
      JSON.stringify(w[0].payload) === JSON.stringify({ active: false }) &&
      w[1].table === "user_roles" &&
      w[1].op === "delete" &&
      ia.active === false &&
      ia.company_code === "4101" &&
      ia.company_name === "Intro A Co" &&
      ia.slug === "intro-a-co" &&
      JSON.stringify(ib) === JSON.stringify(SEED.introducers[1]) &&
      JSON.stringify(db.tables.customer_introducer_links) ===
        JSON.stringify(SEED.customer_introducer_links),
    r.message ?? "",
  );
}
const sfSrc = code("src/lib/sessions.functions.ts");
const setters = sfSrc.slice(
  sfSrc.indexOf("async function requireLegacyRoleTargetInActingTenant"),
  sfSrc.indexOf("type AssignedAdvisor"),
);
ok(
  "TEST_9f setters never upsert roles, mint codes, clear bins or touch company codes; grantIntroducerRole only reachable from test-account provisioning",
  !/upsert|ensureAdvisorCode|setAdvisorDeletedAt|grantIntroducerRole\(|company_code|deleted_at/.test(
    setters,
  ) &&
    (sfSrc.match(/grantIntroducerRole\(/g) ?? []).length === 2 &&
    /export async function grantIntroducerRoleForTestAccount[\s\S]{0,120}grantIntroducerRole\(userId, "new", undefined\)/.test(
      sfSrc,
    ) &&
    !/isAdvisor/.test(setters),
);

// =============================================================================================
// TEST 11–13 (server): templates
// =============================================================================================
const generalWithComms = () => ({
  ...tenantRole.resolveTenantRoleView({
    membershipRoles: ["general"],
    tenantId: T.a,
    generalPermissions: { ...adminAccessMod.DEFAULT_GENERAL_PERMISSIONS, comms_templates: "amend" },
  }),
});
async function saveTemplate(actor, templateId, { general = false } = {}) {
  const db = freshDb();
  if (general) globalThis.__g7f4s4bViewOverride.set(U.genA, generalWithComms());
  const before = JSON.stringify(db.tables.communication_templates);
  const r = await outcome(() =>
    invoke(
      comms.updateCommunicationTemplateFn,
      { templateId, body: "ATTACKER BODY", active: false },
      actor,
    ),
  );
  return { r, db, unchanged: JSON.stringify(db.tables.communication_templates) === before };
}
const t11 = [
  await saveTemplate(U.ownerA, TPL.global),
  await saveTemplate(U.supA, TPL.global),
  await saveTemplate(U.genA, TPL.global, { general: true }),
  await saveTemplate(U.ownerB, TPL.globalOnly),
];
ok(
  "TEST_11 Owner / Supervisor / General(comms_templates amend) cannot update or deactivate a tenant_id IS NULL template",
  t11.every(
    (x) =>
      !x.r.ok && x.db.writes.length === 0 && x.unchanged && /Platform templates/.test(x.r.message),
  ),
  t11.map((x) => x.r.message).join(" | "),
);
{
  const x = await saveTemplate(U.ownerA, TPL.b);
  ok(
    "TEST_11b another tenant's template is not found (no write)",
    !x.r.ok && x.db.writes.length === 0 && x.unchanged,
  );
}
{
  const own = await saveTemplate(U.ownerA, TPL.a);
  const gen = await saveTemplate(U.genA, TPL.a, { general: true });
  const ok12 = (x) => {
    const row = x.db.tables.communication_templates.find((t) => t.id === TPL.a);
    const ver = x.db.writes.find((w) => w.table === "communication_template_versions");
    const upd = x.db.writes.find((w) => w.table === "communication_templates");
    return (
      x.r.ok &&
      row.body === "ATTACKER BODY" &&
      ver?.op === "insert" &&
      ver.payload.tenant_id === T.a &&
      upd?.op === "update" &&
      upd.where.includes(`tenant_id=${T.a}`) &&
      x.db.tables.communication_templates.find((t) => t.id === TPL.global).body === "GLOBAL BODY"
    );
  };
  ok(
    "TEST_12 tenant-owned template mutation still works for Owner and General with comms_templates amend (tenant-scoped write + version)",
    ok12(own) && ok12(gen),
    `${own.r.message ?? ""} ${gen.r.message ?? ""}`,
  );
}
{
  freshDb();
  const ga = await commsServer.getCommunicationTemplate("global_only", T.a);
  const gb = await commsServer.getCommunicationTemplate("global_only", T.b);
  const gn = await commsServer.getCommunicationTemplate("global_only");
  const ta1 = await commsServer.getCommunicationTemplate("tenant_a_key", T.a);
  const tb1 = await commsServer.getCommunicationTemplate("tenant_a_key", T.b);
  ok(
    "TEST_13 global template still resolves as fallback for every tenant; tenant template stays tenant-private",
    ga?.body === "GLOBAL ONLY BODY" &&
      gb?.body === "GLOBAL ONLY BODY" &&
      gn?.body === "GLOBAL ONLY BODY" &&
      ta1?.body === "TENANT A BODY" &&
      tb1 === null,
  );
}
{
  freshDb();
  const r = await outcome(() => invoke(comms.listCommunicationTemplates, undefined, U.ownerA));
  const ids = r.ok ? r.value.templates.map((t) => t.id).sort() : [];
  ok(
    "TEST_13b template listing still shows tenant + global templates (and not other tenants')",
    r.ok && JSON.stringify(ids) === JSON.stringify([TPL.global, TPL.globalOnly, TPL.a].sort()),
  );
}

// =============================================================================================
// TEST 10–13 (SQL): user_roles + communication_templates RLS on PGlite, migration verbatim
// =============================================================================================
const pgliteDir = process.env.G7F4S4B_PGLITE_DIR || "/tmp/g7f4s3b/pglite";
let PGlite;
try {
  const req = createRequire(join(pgliteDir, "package.json"));
  ({ PGlite } = await import(pathToFileURL(req.resolve("@electric-sql/pglite")).href));
} catch (e) {
  console.error(`FAIL  PGlite not found in ${pgliteDir} (${e.message}). See header for install.`);
  process.exit(1);
}
const pg = await PGlite.create();
const sql = async (q, params = []) => (await pg.query(q, params)).rows;

await pg.exec(`
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth;
grant usage on schema auth to anon, authenticated, service_role;
create table auth.users (id uuid primary key);
create or replace function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;

create type public.app_role as enum ('customer','advisor','introducer','admin');
create type public.tenant_member_role as enum ('owner','supervisor','general','adviser','introducer','customer');
create table public.tenants (id uuid primary key);
create table public.tenant_memberships (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id),
  user_id uuid not null references auth.users(id), role public.tenant_member_role not null,
  active boolean not null default true
);
create table public.user_roles (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id),
  role public.app_role not null, unique (user_id, role)
);
create table public.communication_templates (
  id uuid primary key default gen_random_uuid(), tenant_id uuid references public.tenants(id),
  template_key text not null, body text not null, active boolean not null default true
);
create or replace function public.has_role(_user_id uuid, _role public.app_role) returns boolean
  language sql stable security definer set search_path = public as
  $$ select exists (select 1 from public.user_roles where user_id = _user_id and role = _role) $$;
create or replace function public.auth_is_tenant_admin(p_tenant_id uuid) returns boolean
  language sql stable security definer set search_path = public as
  $$ select exists (select 1 from public.tenant_memberships m where m.user_id = auth.uid()
       and m.tenant_id = p_tenant_id and m.active and m.role in ('owner','supervisor','general')) $$;
create or replace function public.auth_is_tenant_staff(p_tenant_id uuid) returns boolean
  language sql stable security definer set search_path = public as
  $$ select exists (select 1 from public.tenant_memberships m where m.user_id = auth.uid()
       and m.tenant_id = p_tenant_id and m.active and m.role in ('owner','supervisor','general','adviser')) $$;

-- live staging policies before S4B (pg_policies, verbatim)
alter table public.user_roles enable row level security;
create policy "Only advisors can delete user roles" on public.user_roles for delete to authenticated
  using (public.has_role(auth.uid(), 'advisor'::public.app_role));
create policy "Only advisors can insert user roles" on public.user_roles for insert to authenticated
  with check (public.has_role(auth.uid(), 'advisor'::public.app_role));
create policy "Only advisors can update user roles" on public.user_roles for update to authenticated
  using (public.has_role(auth.uid(), 'advisor'::public.app_role))
  with check (public.has_role(auth.uid(), 'advisor'::public.app_role));
create policy "Users view own roles" on public.user_roles for select to authenticated
  using ((auth.uid() = user_id) or public.has_role(auth.uid(), 'advisor'::public.app_role));
alter table public.communication_templates enable row level security;
create policy "Admins manage communication templates" on public.communication_templates for all to authenticated
  using (((tenant_id is null) and public.has_role(auth.uid(), 'admin'::public.app_role)) or public.auth_is_tenant_admin(tenant_id))
  with check (((tenant_id is null) and public.has_role(auth.uid(), 'admin'::public.app_role)) or public.auth_is_tenant_admin(tenant_id));
create policy "Staff read communication templates" on public.communication_templates for select to authenticated
  using ((tenant_id is null) or public.auth_is_tenant_staff(tenant_id));

grant all on all tables in schema public to anon, authenticated, service_role;
`);

const S = Object.fromEntries(
  ["owner", "sup", "gen", "adv", "intro", "cust", "legacyAdmin", "ownerB", "victim"].map((k) => [
    k,
    randomUUID(),
  ]),
);
const ST = { a: randomUUID(), b: randomUUID() };
const STPL = { global: randomUUID(), a: randomUUID(), b: randomUUID() };
await sql(`insert into public.tenants values ($1),($2)`, [ST.a, ST.b]);
for (const id of Object.values(S)) await sql(`insert into auth.users values ($1)`, [id]);
for (const [u, t, r] of [
  [S.owner, ST.a, "owner"],
  [S.sup, ST.a, "supervisor"],
  [S.gen, ST.a, "general"],
  [S.adv, ST.a, "adviser"],
  [S.intro, ST.a, "introducer"],
  [S.cust, ST.a, "customer"],
  [S.ownerB, ST.b, "owner"],
  [S.victim, ST.b, "adviser"],
]) {
  await sql(`insert into public.tenant_memberships (user_id, tenant_id, role) values ($1,$2,$3)`, [
    u,
    t,
    r,
  ]);
}
for (const [u, r] of [
  [S.owner, "admin"],
  [S.sup, "admin"],
  [S.gen, "admin"],
  [S.adv, "advisor"],
  [S.intro, "introducer"],
  [S.cust, "customer"],
  [S.legacyAdmin, "admin"],
  [S.victim, "advisor"],
]) {
  await sql(`insert into public.user_roles (user_id, role) values ($1,$2)`, [u, r]);
}
await sql(
  `insert into public.communication_templates (id, tenant_id, template_key, body) values
   ($1, null, 'shared', 'GLOBAL'), ($2, $4, 'a', 'TENANT A'), ($3, $5, 'b', 'TENANT B')`,
  [STPL.global, STPL.a, STPL.b, ST.a, ST.b],
);

async function as(role, userId, stmt, params = []) {
  await pg.query("begin");
  try {
    await pg.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId ?? ""]);
    await pg.query(`set local role ${role}`);
    const r = await pg.query(stmt, params);
    return { ok: true, rows: r.rows, affected: r.affectedRows ?? 0 };
  } catch (e) {
    return { ok: false, code: e.code, message: e.message };
  } finally {
    await pg.query("rollback");
  }
}
const authd = (u, s, p) => as("authenticated", u, s, p);

// controls: the pre-S4B policies allowed the escalation chain
const c1 = await authd(
  S.adv,
  `insert into public.user_roles (user_id, role) values ($1, 'admin')`,
  [S.adv],
);
const c2 = await authd(S.adv, `delete from public.user_roles where user_id = $1`, [S.victim]);
const c3 = await authd(
  S.legacyAdmin,
  `update public.communication_templates set body = 'X' where id = $1`,
  [STPL.global],
);
ok(
  "TEST_10_control pre-S4B: adviser self-grants admin and deletes another tenant's role; legacy admin edits the global template",
  c1.ok && c2.ok && c2.affected === 1 && c3.ok && c3.affected === 1,
);

const MIGRATION_REL =
  "supabase/migrations/20261001130752_gate_g7f4s4b_emergency_authority_boundary.sql";
const migration = read(MIGRATION_REL);
const mig1 = await outcome(() => pg.exec(migration));
const mig2 = await outcome(() => pg.exec(migration));
ok(
  "TEST_10a migration applies cleanly and is re-runnable",
  mig1.ok && mig2.ok,
  mig1.message ?? mig2.message ?? "",
);

const ordinary = [
  ["Customer", S.cust],
  ["Introducer", S.intro],
  ["Adviser", S.adv],
  ["General Admin", S.gen],
  ["Supervisor", S.sup],
  ["Tenant Owner", S.owner],
  ["legacy admin holder", S.legacyAdmin],
];
for (const [label, u] of ordinary) {
  const ins = await authd(u, `insert into public.user_roles (user_id, role) values ($1, 'admin')`, [
    u,
  ]);
  const insOther = await authd(
    u,
    `insert into public.user_roles (user_id, role) values ($1, 'advisor')`,
    [S.cust],
  );
  const upd = await authd(u, `update public.user_roles set role = 'admin' where user_id = $1`, [u]);
  const del = await authd(u, `delete from public.user_roles where user_id = $1`, [S.victim]);
  const denied42501 = (r) => !r.ok && r.code === "42501";
  ok(
    `TEST_10 ${label}: direct user_roles INSERT / UPDATE / DELETE denied`,
    denied42501(ins) && denied42501(insOther) && denied42501(upd) && denied42501(del),
  );
}
{
  const own = await authd(S.adv, `select user_id from public.user_roles`);
  const anonSel = await as("anon", null, `select 1 from public.user_roles`);
  const anonIns = await as(
    "anon",
    null,
    `insert into public.user_roles (user_id, role) values ($1, 'admin')`,
    [S.cust],
  );
  ok(
    "TEST_10b reads are own-row only (adviser no longer enumerates roles); anon has no access",
    own.ok && own.rows.length === 1 && own.rows[0].user_id === S.adv && !anonSel.ok && !anonIns.ok,
  );
  const svc = await as(
    "service_role",
    null,
    `insert into public.user_roles (user_id, role) values ($1, 'introducer') returning id`,
    [S.cust],
  );
  ok("TEST_10c service-role server writes still work", svc.ok && svc.rows.length === 1);
  const pols = await sql(
    `select tablename, policyname, cmd, coalesce(qual,'') || coalesce(with_check,'') as expr
     from pg_policies where schemaname = 'public' and tablename in ('user_roles','communication_templates')`,
  );
  ok(
    "TEST_10d no remaining policy on user_roles / communication_templates depends on legacy has_role(); user_roles has a single SELECT policy",
    pols.every((p) => !/has_role\(/.test(p.expr)) &&
      pols
        .filter((p) => p.tablename === "user_roles")
        .map((p) => p.cmd)
        .join() === "SELECT",
  );
  ok(
    "TEST_10e migration does not reintroduce has_role( (G6B-P2 invariant)",
    !migration.includes("has_role("),
  );
}
{
  const r = [];
  for (const u of [S.owner, S.sup, S.gen, S.legacyAdmin, S.adv]) {
    r.push(
      await authd(
        u,
        `update public.communication_templates set body = 'X', active = false where id = $1`,
        [STPL.global],
      ),
    );
    r.push(
      await authd(u, `delete from public.communication_templates where id = $1`, [STPL.global]),
    );
  }
  const ins = [];
  for (const u of [S.owner, S.legacyAdmin]) {
    ins.push(
      await authd(
        u,
        `insert into public.communication_templates (tenant_id, template_key, body) values (null, 'evil', 'X')`,
      ),
    );
  }
  ok(
    "TEST_11_sql no tenant role or legacy admin can update, deactivate, delete or insert a tenant_id IS NULL template directly",
    r.every((x) => x.ok && x.affected === 0) && ins.every((x) => !x.ok && x.code === "42501"),
  );
}
{
  const ownA = await authd(
    S.owner,
    `update public.communication_templates set body = 'OWN' where id = $1`,
    [STPL.a],
  );
  const crossB = await authd(
    S.owner,
    `update public.communication_templates set body = 'X' where id = $1`,
    [STPL.b],
  );
  const advA = await authd(
    S.adv,
    `update public.communication_templates set body = 'X' where id = $1`,
    [STPL.a],
  );
  const insA = await authd(
    S.sup,
    `insert into public.communication_templates (tenant_id, template_key, body) values ($1, 'new', 'N')`,
    [ST.a],
  );
  ok(
    "TEST_12_sql tenant admin still manages own-tenant templates; not another tenant's; adviser cannot",
    ownA.ok &&
      ownA.affected === 1 &&
      crossB.ok &&
      crossB.affected === 0 &&
      advA.ok &&
      advA.affected === 0 &&
      insA.ok,
  );
}
{
  const advRead = await authd(
    S.adv,
    `select id from public.communication_templates where tenant_id is null`,
  );
  const ownerRead = await authd(
    S.owner,
    `select id from public.communication_templates order by template_key`,
  );
  ok(
    "TEST_13_sql global templates remain readable as fallback; other tenants' templates are not",
    advRead.ok &&
      advRead.rows.length === 1 &&
      ownerRead.ok &&
      ownerRead.rows.length === 2 &&
      !ownerRead.rows.some((x) => x.id === STPL.b),
  );
}

// =============================================================================================
// TEST 14: S3 introducer / referral / commission preservation
// =============================================================================================
const S3_FILES = [
  "src/lib/staff-invite.server.ts",
  "src/lib/staff-invite-contract.ts",
  "src/lib/appointment-signup.server.ts",
  "src/lib/introducer-attribution.ts",
  "src/lib/introducer-customer.functions.ts",
  "src/lib/introducer.functions.ts",
  "src/lib/referrals.functions.ts",
  "src/lib/finance.functions.ts",
  "src/lib/booking.functions.ts",
  "supabase/migrations/20260930210201_gate_g7f4s3b_staff_invite_identity_binding.sql",
];
// Last S4B commit (S4B change + verifier baseline pin).
const S4B_REF = "517d68a";
// Attribution / referral / commission writers in S3 files that later authorised gates (from
// G7F-4S4C2) also edit for read-path tenant scoping. These must stay byte-identical.
const S3_WRITERS = {
  "src/lib/introducer-attribution.ts": [
    "ensureCustomerIntroducerLink",
    "resolveIntroducerIdForCustomerAtDate",
    "resolveIntroducerIdForCustomer",
    "findIntroducerIdForCustomer",
  ],
  "src/lib/referrals.functions.ts": [
    "resolveReferralCodeMeta",
    "resolveReferralCode",
    "claimReferral",
    "createReferralLink",
    "textReferralLink",
    "textRafInviteToFriend",
    "updateReferralBonusStatus",
    "listMyReferralActivity",
    "ensureMyReferralLink",
    "sendMyReferralLink",
  ],
  "src/lib/booking.functions.ts": [
    "resolveBookingTenantId",
    "bookAppointmentTrusted",
    "ensureStaffIntroducerRecord",
    "customerAppointmentSignup",
    "bookNewCustomerAsStaff",
    "bookNewCustomerAsIntroducer",
  ],
};
// G7F-4S4C3 rebinds bookAppointmentTrusted's tenant / session / adviser checks; for that writer
// only its attribution statements must stay identical (whitespace-normalised) to pre-S4B.
const S3_WRITER_STATEMENTS = {
  "src/lib/booking.functions.ts#bookAppointmentTrusted": [
    /introducerId = await ensureStaffIntroducerRecord\(actingUserId\);/g,
    /if \(customerIdForIntro && introducerId\) \{[\s\S]*?\n {2}\}/g,
    /\.from\("introducer_leads"\)\s*\.update\(\{ status: "booked"[\s\S]*?\.is\("appointment_id", null\);/g,
  ],
};
function sameStatements(a, b, patterns) {
  const norm = (s) => s.replace(/\s+/g, " ").trim();
  return patterns.every((p) => {
    const x = a.match(p) ?? [];
    const y = b.match(p) ?? [];
    return x.length === 1 && y.length === 1 && norm(x[0]) === norm(y[0]);
  });
}
function gitDiffers(args) {
  try {
    execFileSync("git", ["diff", "--quiet", ...args], { cwd: root });
    return false;
  } catch {
    return true;
  }
}
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
// 14a: the S4B change set itself never touched an S3 file.
const s4bTouchedS3 = S3_FILES.filter((f) => gitDiffers([PRE_S4B_REF, S4B_REF, "--", f]));
// 14b: in the working tree, S3 files without a writer list stay byte-identical, and every listed
// writer is byte-identical to its pre-S4B version.
const changedS3 = [];
for (const f of S3_FILES) {
  const writers = S3_WRITERS[f];
  if (!writers) {
    if (gitDiffers([PRE_S4B_REF, "--", f])) changedS3.push(f);
    continue;
  }
  const before = execFileSync("git", ["show", `${PRE_S4B_REF}:${f}`], {
    cwd: root,
    encoding: "utf8",
  });
  const now = readFileSync(resolve(root, f), "utf8");
  for (const name of writers) {
    const a = topLevelDeclaration(before, name);
    const b = topLevelDeclaration(now, name);
    const statements = S3_WRITER_STATEMENTS[`${f}#${name}`];
    const same = statements
      ? a !== null && b !== null && sameStatements(a, b, statements)
      : a !== null && a === b;
    if (!same) changedS3.push(`${f}#${name}`);
  }
}
ok(
  "TEST_14 S4B changed no S3 invite/introducer/referral/commission module or the S3B migration; S3 attribution/referral/commission writers are byte-identical to the pre-S4B commit",
  s4bTouchedS3.length === 0 && changedS3.length === 0,
  [...s4bTouchedS3.map((f) => `S4B:${f}`), ...changedS3].join(","),
);
ok(
  "TEST_14b no S4B path writes company_code, customer_introducer_links, referrals, finance or session_advisors (verified at runtime in TEST_8/9d/9e)",
  denyAll(t8) && !/customer_introducer_links|finance_|referral|session_advisors/.test(setters),
);

console.log("");
if (failures.length) {
  console.error(`${total - failures.length}/${total} PASS — ${failures.length} failure(s)`);
  process.exit(1);
}
console.log(`${total}/${total} PASS`);
