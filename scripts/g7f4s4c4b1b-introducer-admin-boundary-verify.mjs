/**
 * G7F-4S4C4-B1b staff/admin introducer management tenant boundary — offline verification.
 *
 * Staff/admin management of introducers operates on the introducer registration of the
 * caller's canonical acting tenant only: listIntroducersForAdmin, listUsersWithRoles,
 * setIntroducerRole (revoke), softDeleteIntroducer, restoreIntroducer, listBinnedStaff and
 * the owner customer report's introducer names. A registration id, user id, email or company
 * code identifies nothing on its own; a target outside the acting tenant is "Not found.".
 *
 * Synthetic fixtures only: no network, no staging, no production, no real user, no real token.
 * Stubbed (not under test): the Supabase service-role client (in-memory tables) and tenant role
 * resolution (derived from in-memory memberships via the real resolveTenantRoleView; platform
 * entry via the real platformAccessTenantRoleView, standing in for an explicit Enter Company
 * acting tenant). The canonical tenant-assert helpers run unmodified.
 *
 * Negative controls replay the pre-B1b (ac7f804) query shapes against the same tables and
 * statically prove those shapes were the pre-B1b handlers.
 *
 * Run: npm exec --yes --package=tsx -- tsx scripts/g7f4s4c4b1b-introducer-admin-boundary-verify.mjs
 */
import { readFileSync } from "node:fs";
import { register } from "node:module";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

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
// A1 closure (deployed): the pre-B1b source for the negative controls and freeze checks.
const PRE_B1B_REF = "ac7f80413ac3caba156b0c04c10a5cbc71d7a3cf";
const NOT_FOUND = "Not found.";
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
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
function topLevelDeclaration(src, name) {
  const start = new RegExp(`^(?:export )?(?:async )?(?:function|const|type) ${name}\\b`, "m").exec(
    src,
  );
  if (!start) return null;
  const rest = src.slice(start.index);
  const end =
    /\n(?=export |async function |function |const |let |type |interface |\/\*\*|\/\/ )/.exec(
      rest.slice(start[0].length),
    );
  return (end ? rest.slice(0, start[0].length + end.index) : rest).trimEnd();
}

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
export * from ${JSON.stringify(realStartServerUrl)};
export function getRequest() { return null; }
`;
const clientStub = `
const bind = (p) => {
  const db = globalThis.__b1bDb;
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
  globalThis.__b1bResolverCalls.push({ userId, slug: _slug ?? null, tenantId: tenantId ?? null });
  const override = globalThis.__b1bViewOverride.get(userId);
  if (override) return override;
  const rows = globalThis.__b1bDb.tables.tenant_memberships.filter((r) => r.user_id === userId && r.active);
  const tenants = [...new Set(rows.map((r) => r.tenant_id))];
  const acting = tenantId ?? (tenants.length === 1 ? tenants[0] : null);
  const roles = rows.filter((r) => r.tenant_id === acting).map((r) => r.role);
  return resolveTenantRoleView({ membershipRoles: roles, tenantId: acting });
}
`;
const authorityReal = fileUrl("src/lib/platform-authority.server.ts");
const authorityStub = `
export * from ${JSON.stringify(authorityReal)};
import { PlatformRouteDeniedError } from ${JSON.stringify(authorityReal)};
export async function requireSuperOwner() { throw new PlatformRouteDeniedError(); }
export async function assertAuthContextNotSuperseded() {}
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

globalThis.__b1bViewOverride = new Map();
globalThis.__b1bResolverCalls = [];
const refusedHosts = [];
globalThis.fetch = async (input) => {
  refusedHosts.push(typeof input === "string" ? input : input.url);
  throw new TypeError("network disabled in verifier");
};

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
    this.filters.push((r) => (r[c] ?? null) !== null && r[c] !== v);
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
      for (const r of [].concat(this.payload)) {
        if (
          this.op === "upsert" &&
          this.table === "user_roles" &&
          all.some((x) => x.user_id === r.user_id && x.role === r.role)
        )
          continue;
        all.push({ ...r });
      }
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
    from(table) {
      return new Query(db, table);
    },
    async rpc() {
      return { data: null, error: { message: "rpc not available in verifier" } };
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
    "introA",
    "introA2",
    "custA",
    "custA2",
    "ownerB",
    "supB",
    "introB",
    "introB2",
    "x", // introducer in Tenant A AND Tenant B (future A2 same-user model)
    "w", // introducer member of A and B; registration only in Tenant B
    "platform",
    "attacker",
  ].map((k) => [k, randomUUID()]),
);
const I = {
  ia: randomUUID(),
  ia2Bin: randomUUID(),
  ib: randomUUID(),
  ib2Bin: randomUUID(),
  xa: randomUUID(),
  xb: randomUUID(),
  wb: randomUUID(),
};
const BIN_TS = "2026-09-01T00:00:00.000Z";
const m = (user_id, tenant_id, role) => ({
  id: randomUUID(),
  user_id,
  tenant_id,
  role,
  active: true,
});
const reg = (id, user_id, tenant_id, company_code, company_name, slug, deleted = false) => ({
  id,
  user_id,
  tenant_id,
  company_code,
  company_name,
  slug,
  active: !deleted,
  deleted_at: deleted ? BIN_TS : null,
});
const SEED = {
  tenant_memberships: [
    m(U.ownerA, T.a, "owner"),
    m(U.supA, T.a, "supervisor"),
    m(U.genA, T.a, "general"),
    m(U.advA, T.a, "adviser"),
    m(U.introA, T.a, "introducer"),
    m(U.introA2, T.a, "introducer"),
    m(U.custA, T.a, "customer"),
    m(U.custA2, T.a, "customer"),
    m(U.x, T.a, "introducer"),
    m(U.w, T.a, "introducer"),
    m(U.ownerB, T.b, "owner"),
    m(U.supB, T.b, "supervisor"),
    m(U.introB, T.b, "introducer"),
    m(U.introB2, T.b, "introducer"),
    m(U.x, T.b, "introducer"),
    m(U.w, T.b, "introducer"),
  ],
  user_roles: [
    { user_id: U.introA, role: "introducer" },
    { user_id: U.introB, role: "introducer" },
    { user_id: U.x, role: "introducer" },
    { user_id: U.w, role: "introducer" },
    { user_id: U.advA, role: "advisor" },
  ],
  profiles: Object.entries(U).map(([k, id]) => ({
    id,
    full_name: `Synthetic ${k}`,
    email: `${k.toLowerCase()}@example.test`,
    phone: null,
    address: null,
  })),
  introducers: [
    reg(I.ia, U.introA, T.a, "4101", "Intro A Co", "intro-a-co"),
    reg(I.ia2Bin, U.introA2, T.a, "4102", "Binned A Co", "binned-a-co", true),
    reg(I.xa, U.x, T.a, "5101", "X Alpha Ltd", "x-alpha"),
    reg(I.ib, U.introB, T.b, "4201", "Intro B Co", "intro-b-co"),
    reg(I.ib2Bin, U.introB2, T.b, "4202", "Binned B Co", "binned-b-co", true),
    reg(I.xb, U.x, T.b, "5201", "X Bravo Ltd", "x-bravo"),
    reg(I.wb, U.w, T.b, "6201", "W Bravo Ltd", "w-bravo"),
  ],
  advisor_profiles: [],
  interview_sessions: [],
  customer_introducer_links: [
    { customer_id: U.custA, introducer_id: I.ia, tenant_id: T.a, created_at: BIN_TS },
    { customer_id: U.custA2, introducer_id: I.ib, tenant_id: T.b, created_at: BIN_TS },
  ],
  finance_ledger: [
    { id: randomUUID(), introducer_id: I.ia, beneficiary_role: "introducer", amount_pence: 1000 },
    { id: randomUUID(), introducer_id: I.xb, beneficiary_role: "introducer", amount_pence: 2000 },
  ],
  commission_rates: [
    { id: randomUUID(), introducer_id: I.xa, rate_bps: 1000 },
    { id: randomUUID(), introducer_id: I.xb, rate_bps: 2000 },
  ],
  introducer_leads: [{ id: randomUUID(), introducer_id: I.xb, tenant_id: T.b }],
};
let db;
const reset = (mutateSeed) => {
  const seed = structuredClone(SEED);
  if (mutateSeed) mutateSeed(seed);
  db = globalThis.__b1bDb = makeDb(seed);
  globalThis.__b1bViewOverride.clear();
  globalThis.__b1bResolverCalls.length = 0;
  return db;
};
reset();
const regOf = (rid) => db.tables.introducers.find((r) => r.id === rid);
const seedRegOf = (rid) => SEED.introducers.find((r) => r.id === rid);
const sameAsSeed = (rid) => JSON.stringify(regOf(rid)) === JSON.stringify(seedRegOf(rid));
const HISTORY = [
  "customer_introducer_links",
  "finance_ledger",
  "commission_rates",
  "introducer_leads",
];
const historyFp = () => JSON.stringify(HISTORY.map((t) => db.tables[t]));
const SEED_HISTORY = JSON.stringify(HISTORY.map((t) => SEED[t]));
const introWrites = () => db.writes.filter((w) => w.table === "introducers");
const B_TEXT = [
  I.ib,
  I.ib2Bin,
  I.xb,
  I.wb,
  "Intro B Co",
  "Binned B Co",
  "X Bravo Ltd",
  "W Bravo Ltd",
  "intro-b-co",
  "x-bravo",
  "w-bravo",
];
const B_CODES = ["4201", "4202", "5201", "6201"];
const leafValues = (v, out = []) => {
  if (v === null || v === undefined) return out;
  if (typeof v === "object") {
    for (const x of Array.isArray(v) ? v : Object.values(v)) leafValues(x, out);
  } else out.push(String(v));
  return out;
};
// Four-digit codes also occur inside random UUIDs, so a code only counts as leaked
// when a returned value is exactly that code.
const leaksB = (v) => {
  const s = JSON.stringify(v ?? null);
  const leaves = leafValues(v);
  return [...B_TEXT.filter((x) => s.includes(x)), ...B_CODES.filter((c) => leaves.includes(c))];
};

// --- modules under test ---------------------------------------------------------------------
const tenantRole = await import("../src/lib/tenant-role.ts");
const sf = await import("../src/lib/sessions.functions.ts");
const inf = await import("../src/lib/introducer.functions.ts");
const admin = await import("../src/lib/introducer-admin.server.ts");

async function call(fn, data, userId) {
  return outcome(async () => {
    const d = fn.__def;
    const parsed = d.validator ? await d.validator(data) : data;
    return d.handler({ data: parsed, context: { userId, claims: { sub: userId } } });
  });
}
const describe = (...rs) => rs.map((r) => (r.ok ? "ok" : r.message)).join(" | ");
const notFound = (r) => !r.ok && r.message === NOT_FOUND;
const refused = (r) => !r.ok;
const platformView = (tenantId, accessLevel) =>
  tenantRole.platformAccessTenantRoleView({
    tenantId,
    tenantSlug: tenantId === T.a ? "tenant-a" : "tenant-b",
    accessLevel,
    basisLabel: "Synthetic platform entry",
  });

const SESSIONS = "src/lib/sessions.functions.ts";
const INTRO_FNS = "src/lib/introducer.functions.ts";
const HELPER = "src/lib/introducer-admin.server.ts";
const sessSrc = read(SESSIONS);
const introSrc = read(INTRO_FNS);
const helperSrc = strip(read(HELPER));
const headSess = git("show", `${PRE_B1B_REF}:${SESSIONS}`);
const headIntro = git("show", `${PRE_B1B_REF}:${INTRO_FNS}`);

// =============================================================================================
// B1B-01..03  admin lists are acting-tenant scoped
// =============================================================================================
reset();
{
  const lia = await call(inf.listIntroducersForAdmin, undefined, U.ownerA);
  const lua = await call(sf.listUsersWithRoles, undefined, U.ownerA);
  const lib = await call(inf.listIntroducersForAdmin, undefined, U.ownerB);
  const regIdsA = (lia.value ?? []).map((r) => r.introducerId).filter(Boolean);
  const uRegIdsA = (lua.value ?? []).map((r) => r.introducerId).filter(Boolean);
  const regIdsB = (lib.value ?? []).map((r) => r.introducerId).filter(Boolean);
  ok(
    "B1B-01 admin introducer lists resolve the acting tenant and return its registrations (view-as picker and Introducer access)",
    lia.ok &&
      lua.ok &&
      lib.ok &&
      regIdsA.includes(I.ia) &&
      regIdsA.includes(I.xa) &&
      uRegIdsA.includes(I.ia) &&
      uRegIdsA.includes(I.xa) &&
      regIdsB.includes(I.ib) &&
      regIdsB.includes(I.xb),
    describe(lia, lua, lib),
  );
  const aRegs = new Set(SEED.introducers.filter((r) => r.tenant_id === T.a).map((r) => r.id));
  ok(
    "B1B-02 Tenant A lists contain Tenant A registrations only",
    [...regIdsA, ...uRegIdsA].every((id) => aRegs.has(id)) &&
      (lia.value ?? []).find((r) => r.userId === U.x)?.company_code === "5101" &&
      (lua.value ?? []).find((r) => r.id === U.x)?.companyCode === "5101",
  );
  const leaks = [...leaksB(lia.value), ...leaksB(lua.value)];
  const wRow = (lia.value ?? []).find((r) => r.userId === U.w);
  ok(
    "B1B-03 no Tenant B registration (id, company code, company name, slug) appears in Tenant A's lists; a Tenant A member whose registration is in B shows no registration",
    leaks.length === 0 &&
      wRow?.introducerId === null &&
      wRow?.company_code === null &&
      wRow?.slug === null &&
      (lua.value ?? []).find((r) => r.id === U.w)?.introducerId === null &&
      !(lua.value ?? []).some((r) => r.id === U.introB || r.id === U.ownerB),
    leaks.join(",") || "no Tenant B data",
  );
}

// =============================================================================================
// B1B-04..07  ids, email and company code are not authority
// =============================================================================================
reset();
{
  const byId = [
    await call(sf.softDeleteIntroducer, { introducerId: I.ib }, U.ownerA),
    await call(sf.restoreIntroducer, { introducerId: I.ib2Bin }, U.ownerA),
    await call(sf.softDeleteIntroducer, { introducerId: I.xb }, U.ownerA),
    await call(sf.softDeleteIntroducer, { userId: U.introA, introducerId: I.ib }, U.ownerA),
    await call(sf.softDeleteIntroducer, { introducerId: I.ib, tenantId: T.b }, U.ownerA),
  ];
  ok(
    "B1B-04 a target registration id alone is not authority (foreign id, id paired with a local user, client tenantId ignored)",
    byId.every(notFound) && db.writes.length === 0,
    describe(...byId),
  );
  const byUser = [
    await call(sf.softDeleteIntroducer, { userId: U.introB }, U.ownerA),
    await call(sf.restoreIntroducer, { userId: U.introB2 }, U.ownerA),
    await call(sf.setIntroducerRole, { userId: U.introB, makeIntroducer: false }, U.ownerA),
  ];
  ok(
    "B1B-05 a target user_id alone is not authority (bin, restore, revoke)",
    byUser.every(refused) && db.writes.length === 0,
    describe(...byUser),
  );
  const byEmail = [
    await call(sf.softDeleteIntroducer, { email: "introb@example.test" }, U.ownerA),
    await call(sf.restoreIntroducer, { email: "introb2@example.test" }, U.ownerA),
  ];
  ok(
    "B1B-06 email is not authority: an email-only target is rejected and the helper never reads email",
    byEmail.every(refused) && db.writes.length === 0 && !/email/.test(helperSrc),
    describe(...byEmail),
  );
  const byCode = [
    await call(sf.softDeleteIntroducer, { companyCode: "4201" }, U.ownerA),
    await call(sf.restoreIntroducer, { companyCode: "4202" }, U.ownerA),
    await call(
      sf.setIntroducerRole,
      { userId: U.introB, makeIntroducer: false, companyCode: "4201" },
      U.ownerA,
    ),
  ];
  ok(
    "B1B-07 company code is not authority: a code-only target is rejected and the helper never reads company_code or slug",
    byCode.every(refused) &&
      db.writes.length === 0 &&
      !/company_code|companyCode|slug/.test(helperSrc),
    describe(...byCode),
  );
}

// =============================================================================================
// B1B-08..10  legitimate Tenant A management; Tenant B unreachable; generic Not found
// =============================================================================================
reset();
{
  const bin = await call(sf.softDeleteIntroducer, { introducerId: I.ia }, U.ownerA);
  const binnedOk = regOf(I.ia).active === false && regOf(I.ia).deleted_at !== null;
  const restore = await call(sf.restoreIntroducer, { userId: U.introA }, U.ownerA);
  const restoredOk = regOf(I.ia).active === true && regOf(I.ia).deleted_at === null;
  reset();
  const revoke = await call(
    sf.setIntroducerRole,
    { userId: U.introA, makeIntroducer: false },
    U.supA,
  );
  const w = db.writes;
  ok(
    "B1B-08 Tenant A admin manages a legitimate Tenant A registration (bin by registration id, restore by user id, revoke)",
    bin.ok &&
      binnedOk &&
      restore.ok &&
      restoredOk &&
      revoke.ok &&
      w.length === 2 &&
      w[0].table === "introducers" &&
      w[0].where.join("&") === `user_id=${U.introA}&tenant_id=${T.a}` &&
      JSON.stringify(w[0].payload) === JSON.stringify({ active: false }) &&
      w[1].table === "user_roles" &&
      regOf(I.ia).active === false,
    describe(bin, restore, revoke),
  );
  reset();
  const foreign = [
    await call(sf.softDeleteIntroducer, { introducerId: I.ib }, U.ownerA),
    await call(sf.softDeleteIntroducer, { userId: U.introB }, U.supA),
    await call(sf.restoreIntroducer, { introducerId: I.ib2Bin }, U.genA),
    await call(sf.restoreIntroducer, { userId: U.introB2 }, U.ownerA),
    await call(sf.softDeleteIntroducer, { introducerId: I.wb }, U.ownerA),
    await call(sf.setIntroducerRole, { userId: U.introB, makeIntroducer: false }, U.ownerA),
  ];
  ok(
    "B1B-09 Tenant A admin cannot manage a Tenant B registration (bin, restore, revoke); every Tenant B row byte-identical",
    foreign.every(refused) &&
      db.writes.length === 0 &&
      [I.ib, I.ib2Bin, I.xb, I.wb].every(sameAsSeed),
    describe(...foreign),
  );
  const unknown = [
    await call(sf.softDeleteIntroducer, { introducerId: randomUUID() }, U.ownerA),
    await call(sf.softDeleteIntroducer, { userId: randomUUID() }, U.ownerA),
    await call(sf.restoreIntroducer, { introducerId: randomUUID() }, U.ownerA),
    await call(sf.setIntroducerRole, { userId: randomUUID(), makeIntroducer: false }, U.ownerA),
  ];
  ok(
    "B1B-10 a cross-tenant target gets the generic Not found., identical to a non-existent target (no existence oracle)",
    notFound(foreign[0]) &&
      notFound(foreign[1]) &&
      notFound(foreign[2]) &&
      notFound(foreign[3]) &&
      notFound(foreign[4]) &&
      unknown.slice(0, 3).every(notFound) &&
      foreign[5].message === unknown[3].message &&
      db.writes.length === 0,
    describe(...foreign, ...unknown),
  );
}

// =============================================================================================
// B1B-11..16  registration-specific bin / restore; history untouched
// =============================================================================================
reset();
{
  const bin = await call(sf.softDeleteIntroducer, { introducerId: I.xa }, U.ownerA);
  const iw = introWrites();
  ok(
    "B1B-11 Tenant A soft delete changes registration A only (one introducers write keyed by registration id + acting tenant)",
    bin.ok &&
      iw.length === 1 &&
      iw[0].where.join("&") === `id=${I.xa}&tenant_id=${T.a}` &&
      iw[0].payload.active === false &&
      typeof iw[0].payload.deleted_at === "string" &&
      regOf(I.xa).active === false &&
      regOf(I.xa).deleted_at !== null,
    describe(bin),
  );
  ok(
    "B1B-12 Tenant B registration unchanged by Tenant A soft delete; the global introducer role is kept because Tenant B still relies on it",
    sameAsSeed(I.xb) &&
      db.tables.user_roles.some((r) => r.user_id === U.x && r.role === "introducer") &&
      !db.writes.some((w) => w.table === "user_roles"),
  );
  const fpAfterBin = historyFp();
  reset((s) => {
    for (const r of s.introducers)
      if (r.id === I.xa || r.id === I.xb) Object.assign(r, { active: false, deleted_at: BIN_TS });
  });
  const restore = await call(sf.restoreIntroducer, { introducerId: I.xa }, U.ownerA);
  const rw = introWrites();
  ok(
    "B1B-13 Tenant A restore changes registration A only (both A and B were binned)",
    restore.ok &&
      rw.length === 1 &&
      rw[0].where.join("&") === `id=${I.xa}&tenant_id=${T.a}` &&
      regOf(I.xa).active === true &&
      regOf(I.xa).deleted_at === null,
    describe(restore),
  );
  ok(
    "B1B-14 Tenant B registration stays binned after Tenant A restore (no cross-tenant reactivation)",
    regOf(I.xb).active === false && regOf(I.xb).deleted_at === BIN_TS,
  );
  const fpAfterRestore = historyFp();
  ok(
    "B1B-15 historical attribution not rewritten (customer_introducer_links byte-identical after bin and restore)",
    fpAfterBin === SEED_HISTORY && fpAfterRestore === SEED_HISTORY,
  );
  ok(
    "B1B-16 commission history not rewritten (finance_ledger, commission_rates, introducer_leads byte-identical; no write outside introducers/user_roles)",
    fpAfterRestore === SEED_HISTORY &&
      db.writes.every((w) => w.table === "introducers" || w.table === "user_roles"),
  );
}

// =============================================================================================
// B1B-17..18  people list and bin list do not disclose another tenant
// =============================================================================================
reset();
{
  const asOwner = await call(sf.listUsersWithRoles, undefined, U.ownerA);
  const asAdviser = await call(sf.listUsersWithRoles, undefined, U.advA);
  const noTenant = await call(sf.listUsersWithRoles, undefined, U.attacker);
  const leaks = [...leaksB(asOwner.value), ...leaksB(asAdviser.value)];
  ok(
    "B1B-17 listUsersWithRoles discloses no other-tenant registration (company code/name/id) for owner or adviser; no acting tenant fails closed",
    asOwner.ok &&
      asAdviser.ok &&
      leaks.length === 0 &&
      !noTenant.ok &&
      (asOwner.value ?? []).every((r) =>
        SEED.tenant_memberships.some((mm) => mm.user_id === r.id && mm.tenant_id === T.a),
      ),
    leaks.join(",") || describe(asOwner, asAdviser, noTenant),
  );
  const binA = await call(sf.listBinnedStaff, undefined, U.ownerA);
  const binB = await call(sf.listBinnedStaff, undefined, U.supB);
  const introsA = binA.value?.introducers ?? [];
  const introsB = binB.value?.introducers ?? [];
  ok(
    "B1B-18 listBinnedStaff is tenant-scoped and identifies each binned introducer by its registration",
    binA.ok &&
      binB.ok &&
      introsA.length === 1 &&
      introsA[0].introducerId === I.ia2Bin &&
      introsA[0].id === U.introA2 &&
      introsB.length === 1 &&
      introsB[0].introducerId === I.ib2Bin &&
      leaksB(binA.value).length === 0,
    describe(binA, binB),
  );
}

// =============================================================================================
// B1B-19  same user, two registrations (A2 compatibility model)
// =============================================================================================
reset();
{
  const steps = [];
  const la = await call(inf.listIntroducersForAdmin, undefined, U.ownerA);
  const lb = await call(inf.listIntroducersForAdmin, undefined, U.ownerB);
  steps.push(
    la.value?.find((r) => r.userId === U.x)?.introducerId === I.xa,
    lb.value?.find((r) => r.userId === U.x)?.introducerId === I.xb,
  );
  const aBins = await call(sf.softDeleteIntroducer, { introducerId: I.xa }, U.ownerA);
  const binB1 = await call(sf.listBinnedStaff, undefined, U.ownerB);
  steps.push(
    aBins.ok,
    regOf(I.xb).active === true,
    !(binB1.value?.introducers ?? []).some((r) => r.introducerId === I.xa),
  );
  const bBins = await call(sf.softDeleteIntroducer, { userId: U.x }, U.ownerB);
  steps.push(bBins.ok, regOf(I.xb).active === false);
  const aRestores = await call(sf.restoreIntroducer, { userId: U.x }, U.ownerA);
  steps.push(aRestores.ok, regOf(I.xa).active === true, regOf(I.xb).active === false);
  const aCannotB = await call(sf.restoreIntroducer, { introducerId: I.xb }, U.ownerA);
  const bCannotA = await call(sf.softDeleteIntroducer, { introducerId: I.xa }, U.ownerB);
  steps.push(notFound(aCannotB), notFound(bCannotA), regOf(I.xb).active === false);
  const bRestores = await call(sf.restoreIntroducer, { introducerId: I.xb }, U.ownerB);
  steps.push(bRestores.ok, regOf(I.xa).active === true, regOf(I.xb).active === true);
  const revokeA = await call(
    sf.setIntroducerRole,
    { userId: U.x, makeIntroducer: false },
    U.ownerA,
  );
  steps.push(!revokeA.ok);
  ok(
    "B1B-19 same-user two-registration model: each tenant lists, bins and restores only its own registration; legacy revoke fails closed (A2 boundary)",
    steps.every(Boolean) && historyFp() === SEED_HISTORY,
    `${steps.filter(Boolean).length}/${steps.length} steps; ${describe(aBins, bBins, aRestores, aCannotB, bCannotA, bRestores, revokeA)}`,
  );
}

// =============================================================================================
// B1B-20  platform authority only through an explicit acting tenant
// =============================================================================================
reset();
{
  const bare = [
    await call(sf.softDeleteIntroducer, { introducerId: I.ia }, U.platform),
    await call(sf.restoreIntroducer, { introducerId: I.ia2Bin }, U.platform),
    await call(sf.listUsersWithRoles, undefined, U.platform),
    await call(inf.listIntroducersForAdmin, undefined, U.platform),
  ];
  const bareClean = bare.every(refused) && db.writes.length === 0;
  globalThis.__b1bViewOverride.set(U.platform, platformView(T.a, "read_only"));
  const ro = await call(sf.softDeleteIntroducer, { introducerId: I.ia }, U.platform);
  const roClean = !ro.ok && db.writes.length === 0;
  globalThis.__b1bViewOverride.set(U.platform, platformView(T.a, "operational_admin"));
  const opForeign = await call(sf.softDeleteIntroducer, { introducerId: I.ib }, U.platform);
  const opForeignClean = notFound(opForeign) && db.writes.length === 0;
  const op = await call(sf.softDeleteIntroducer, { introducerId: I.ia }, U.platform);
  ok(
    "B1B-20 platform/Super Owner: no explicit acting tenant → refused; read_only entry cannot mutate; operational entry reaches only that tenant's registration",
    bareClean &&
      roClean &&
      opForeignClean &&
      op.ok &&
      regOf(I.ia).active === false &&
      sameAsSeed(I.ib),
    describe(...bare, ro, opForeign, op),
  );
}

// =============================================================================================
// B1B-21..22  no global user_id fallback; state is registration-specific
// =============================================================================================
reset();
{
  const wBin = await call(sf.softDeleteIntroducer, { userId: U.w }, U.ownerA);
  const wRestore = await call(sf.restoreIntroducer, { userId: U.w }, U.supA);
  const lia = await call(inf.listIntroducersForAdmin, undefined, U.ownerA);
  ok(
    "B1B-21 no global user_id fallback: a Tenant A member whose only registration is in Tenant B is Not found. for bin/restore and shows no registration in A",
    notFound(wBin) &&
      notFound(wRestore) &&
      db.writes.length === 0 &&
      sameAsSeed(I.wb) &&
      lia.value?.find((r) => r.userId === U.w)?.introducerId === null,
    describe(wBin, wRestore),
  );
  const bBin = await call(sf.softDeleteIntroducer, { introducerId: I.xb }, U.ownerB);
  const states = [regOf(I.xa).active, regOf(I.xa).deleted_at, regOf(I.xb).active];
  const read1 = await call(inf.listIntroducersForAdmin, undefined, U.ownerB);
  const read2 = await call(sf.listBinnedStaff, undefined, U.ownerB);
  const read3 = await call(sf.listUsersWithRoles, undefined, U.ownerB);
  ok(
    "B1B-22 active/deleted state is registration-specific (binning B leaves A active) and admin reads never reactivate",
    bBin.ok &&
      states[0] === true &&
      states[1] === null &&
      states[2] === false &&
      read1.ok &&
      read2.ok &&
      read3.ok &&
      regOf(I.xb).active === false &&
      introWrites().length === 1,
    describe(bBin, read1, read2, read3),
  );
}

// =============================================================================================
// Role ceiling preserved (no new powers; S3C General Admin breadth retained for S4D)
// =============================================================================================
reset();
{
  const denied = [
    await call(sf.softDeleteIntroducer, { introducerId: I.ia }, U.advA),
    await call(sf.restoreIntroducer, { introducerId: I.ia2Bin }, U.advA),
    await call(sf.softDeleteIntroducer, { introducerId: I.ia }, U.introA),
    await call(sf.softDeleteIntroducer, { introducerId: I.ia }, U.custA),
    await call(sf.listBinnedStaff, undefined, U.genA),
    await call(inf.listIntroducersForAdmin, undefined, U.genA),
    await call(sf.listUsersWithRoles, undefined, U.custA),
  ];
  const deniedClean = denied.every(refused) && db.writes.length === 0;
  const gen = await call(sf.softDeleteIntroducer, { introducerId: I.ia }, U.genA);
  ok(
    "B1B-R1 role ceiling unchanged: adviser/introducer/customer refused; bin list and view-as picker stay Owner/Supervisor; General Admin keeps its pre-B1b main-admin bin power (S4D)",
    deniedClean && gen.ok,
    describe(...denied, gen),
  );
}

// =============================================================================================
// Owner customer report names only this tenant's introducers
// =============================================================================================
reset();
{
  const rep = await call(sf.exportOwnerCustomerReport, undefined, U.ownerA);
  const rows = rep.value?.rows ?? [];
  const a1 = rows.find((r) => r.customerId === U.custA);
  const a2 = rows.find((r) => r.customerId === U.custA2);
  ok(
    "B1B-E1 owner customer report: Tenant A introducer named; another tenant's introducer is neither named nor hinted at",
    rep.ok && a1?.introducer === "Intro A Co" && a2?.introducer === "" && leaksB(rows).length === 0,
    describe(rep),
  );
}

// =============================================================================================
// Negative controls: pre-B1b global lookups expose or mutate the wrong registration
// =============================================================================================
{
  const hs = (n) => topLevelDeclaration(headSess, n) ?? "";
  const headBin = hs("softDeleteIntroducer");
  const headRestore = hs("restoreIntroducer");
  const headUsers = hs("listUsersWithRoles");
  const headList = topLevelDeclaration(headIntro, "listIntroducersForAdmin") ?? "";
  ok(
    "B1B-NC0 pre-B1b (ac7f804) handlers had the replayed shapes: bin/restore updated introducers by user_id alone; people list and view-as picker read introducers without a tenant filter",
    /\.update\(\{ active: false, deleted_at: new Date\(\)\.toISOString\(\) \}\)\s*\.eq\("user_id", data\.userId\);/.test(
      headBin,
    ) &&
      /\.update\(\{ active: true, deleted_at: null \}\)\s*\.eq\("user_id", data\.userId\);/.test(
        headRestore,
      ) &&
      !/tenant_id/.test(headBin + headRestore) &&
      /\.from\("introducers"\)\s*\.select\("user_id, company_code, company_name"\);/.test(
        headUsers,
      ) &&
      /\.select\("user_id, company_name, slug, company_code"\)\s*\.in\("user_id", userIds\)/.test(
        headList,
      ) &&
      !/tenant_id/.test(headList),
  );

  reset((s) => {
    for (const r of s.introducers)
      if (r.id === I.xa || r.id === I.xb) Object.assign(r, { active: false, deleted_at: BIN_TS });
  });
  await db.from("introducers").update({ active: true, deleted_at: null }).eq("user_id", U.x);
  const preRestoreHitB = regOf(I.xb).active === true;
  reset();
  await db
    .from("introducers")
    .update({ active: false, deleted_at: new Date().toISOString() })
    .eq("user_id", U.w);
  const preBinHitB = regOf(I.wb).active === false;
  ok(
    "B1B-NC1 negative control: the pre-B1b user_id-only restore reactivates Tenant B's registration from Tenant A, and the user_id-only bin bins a registration that exists only in Tenant B (B1b: B1B-13/14/21)",
    preRestoreHitB && preBinHitB,
  );

  reset();
  const all = (await db.from("introducers").select("user_id, company_code, company_name")).data;
  const companyMap = new Map(all.map((r) => [r.user_id, r.company_code]));
  ok(
    "B1B-NC2 negative control: the pre-B1b people-list company map keys every tenant's registration by user_id, so Tenant A sees X's Tenant B code and W's Tenant B code (B1b: B1B-02/17)",
    companyMap.get(U.x) === "5201" && companyMap.get(U.w) === "6201",
    `x→${companyMap.get(U.x)} w→${companyMap.get(U.w)}`,
  );
  const membersA = SEED.tenant_memberships
    .filter((mm) => mm.tenant_id === T.a && mm.role === "introducer")
    .map((mm) => mm.user_id);
  const pre = (
    await db
      .from("introducers")
      .select("user_id, company_name, slug, company_code")
      .in("user_id", membersA)
  ).data;
  ok(
    "B1B-NC3 negative control: the pre-B1b view-as picker query returns Tenant B registrations for Tenant A members (B1b: B1B-03)",
    leaksB(pre).length > 0,
    leaksB(pre).join(","),
  );
  const links = db.tables.customer_introducer_links;
  const preNames = (
    await db
      .from("introducers")
      .select("id, company_name")
      .in(
        "id",
        links.map((l) => l.introducer_id),
      )
  ).data;
  ok(
    "B1B-NC4 negative control: the pre-B1b report name lookup names Tenant B's introducer for a Tenant A customer (B1b: B1B-E1)",
    preNames.some((r) => r.company_name === "Intro B Co"),
  );
}

// =============================================================================================
// Static: helper and handler shapes
// =============================================================================================
{
  ok(
    "B1B-S1 helper: acting tenant from the canonical resolver with no caller-supplied tenant; introducers filtered by tenant_id first; ambiguity fails closed; no user_roles/email/code/slug",
    /resolveActingTenantRole\(input\.actingUserId\)/.test(helperSrc) &&
      !/resolveActingTenantRole\(input\.actingUserId,/.test(helperSrc) &&
      /\.select\("id, user_id, tenant_id, active, deleted_at"\)\s*\.eq\("tenant_id", tenantId\)/.test(
        helperSrc,
      ) &&
      /\.limit\(2\)/.test(helperSrc) &&
      /rows\.length === 1/.test(helperSrc) &&
      /RESOURCE_NOT_FOUND_MESSAGE/.test(helperSrc) &&
      /assertTenantViewMayMutate\(view\)/.test(helperSrc) &&
      !/user_roles|email|company_code|slug/.test(
        helperSrc.slice(
          0,
          helperSrc.indexOf("export async function introducerStandingOutsideTenant"),
        ),
      ),
  );
  const blk = (n) => strip(topLevelDeclaration(sessSrc, n) ?? "");
  const bin = blk("softDeleteIntroducer");
  const restore = blk("restoreIntroducer");
  const lifecycleShape = (b) =>
    b.indexOf("requireManagedIntroducerRegistration(") > -1 &&
    b.indexOf("requireManagedIntroducerRegistration(") < b.indexOf(".from(") &&
    !/\.eq\("user_id", data\.userId\)/.test(b) &&
    (b.match(/\.from\("introducers"\)/g) ?? []).length === 2 &&
    (b.match(/\.eq\("id", reg\.id\)\s*\.eq\("tenant_id", reg\.tenantId\)/g) ?? []).length === 2;
  ok(
    "B1B-S2 bin/restore prove the registration before any table access and write only by registration id + acting tenant",
    lifecycleShape(bin) && lifecycleShape(restore),
  );
  const users = blk("listUsersWithRoles");
  const list = strip(topLevelDeclaration(introSrc, "listIntroducersForAdmin") ?? "");
  const setRole = blk("setIntroducerRole");
  ok(
    "B1B-S3 people list, view-as picker and revoke are tenant-bound: introducer reads filter tenant_id; revoke proves the registration before its tenant-scoped write",
    (users.match(/\.from\("introducers"\)[\s\S]{0,120}?\.eq\("tenant_id", tenantId\)/g) ?? [])
      .length === 2 &&
      !/if \(view\.tenantId\)/.test(users) &&
      /\.eq\("tenant_id", view\.tenantId\)\s*\.in\("user_id", userIds\)/.test(list) &&
      setRole.indexOf("requireManagedIntroducerRegistration(") > -1 &&
      setRole.indexOf("requireManagedIntroducerRegistration(") < setRole.indexOf(".update("),
  );
}

// =============================================================================================
// B1B-23..25  A1 intact, no migration, A2 creation/invite unchanged; scope
// =============================================================================================
{
  const status = (...paths) => git("status", "--porcelain", "--", ...paths).trimEnd();
  const sameAsHead = (rel, names, headSrc) =>
    names.filter((n) => {
      const a = topLevelDeclaration(headSrc, n);
      const b = topLevelDeclaration(read(rel), n);
      return !(a !== null && a === b);
    });
  const introChanged = sameAsHead(
    INTRO_FNS,
    [
      "resolveViewAsIntroducer",
      "getIntroducerProfile",
      "updateIntroducerProfile",
      "createManualLead",
      "listIntroducerReferrals",
      "generateUniqueCompanyCode",
      "uniqueSlug",
      "resolveReferralSlug",
      "checkIsIntroducer",
      "activeTenantSlugForIntroducer",
      "captureIntroducerCalculatorLead",
    ],
    headIntro,
  );
  ok(
    "B1B-23 A1 intact: resolver module and booking portal untouched; every A1 introducer portal handler byte-identical to ac7f804",
    status("src/lib/introducer-registration.server.ts", "src/lib/booking.functions.ts") === "" &&
      introChanged.length === 0,
    introChanged.join(",") || "unchanged",
  );
  ok("B1B-24 no migration created or modified", status("supabase") === "");
  reset();
  const grant = await call(
    sf.setIntroducerRole,
    { userId: U.custA, makeIntroducer: true, companyMode: "new" },
    U.ownerA,
  );
  ok(
    "B1B-25 A2 creation/invite unchanged: invite modules, test accounts and migrations untouched; grant path still refused; grantIntroducerRole only reachable from test-account provisioning",
    status(
      "src/lib/staff-invite.server.ts",
      "src/lib/staff-invite-contract.ts",
      "src/lib/staff-invite.functions.ts",
      "src/lib/test-accounts.ts",
      "src/lib/test-accounts.functions.ts",
      "supabase/migrations",
    ) === "" &&
      !grant.ok &&
      grant.message === "Introducers are added with a staff invite link." &&
      db.writes.length === 0 &&
      (sessSrc.match(/grantIntroducerRole\(/g) ?? []).length === 2 &&
      topLevelDeclaration(sessSrc, "grantIntroducerRole") ===
        topLevelDeclaration(headSess, "grantIntroducerRole"),
    describe(grant),
  );
  const changed = status("src")
    .split("\n")
    .filter(Boolean)
    .map((l) => l.slice(3));
  const allowed = [SESSIONS, INTRO_FNS, HELPER, "src/components/staff/panels/staff-panels.tsx"];
  ok(
    "B1B-26 application changes limited to the admin helper, sessions/introducer admin functions and the staff panel; canonical tenant, attribution, commission, finance and schema-type sources untouched",
    changed.every((f) => allowed.includes(f)) &&
      status(
        "src/lib/tenant-assert.server.ts",
        "src/lib/tenant-role.server.ts",
        "src/lib/introducer-customer.functions.ts",
        "src/lib/introducer-attribution.ts",
        "src/lib/finance.functions.ts",
        "src/lib/referrals.functions.ts",
        "src/integrations/supabase/types.ts",
      ) === "",
    changed.join(", "),
  );
  const oldVerifiers = status("scripts")
    .split("\n")
    .filter(Boolean)
    .map((l) => l.slice(3))
    .filter((f) => f !== "scripts/g7f4s4c4b1b-introducer-admin-boundary-verify.mjs");
  ok("B1B-27 no existing verifier modified", oldVerifiers.length === 0, oldVerifiers.join(", "));
}

ok("B1B-28 no network", refusedHosts.length === 0, refusedHosts.join(","));

console.log("\nINFO  B1b authority per operation (unchanged ceilings):");
for (const [fn, auth] of [
  ["listIntroducersForAdmin", "membership Owner / Admin Supervisor (platform excluded)"],
  ["listUsersWithRoles", "Adviser or main admin in the acting tenant"],
  [
    "setIntroducerRole (revoke)",
    "main admin + target introducer membership here + registration here",
  ],
  [
    "softDeleteIntroducer",
    "main admin (Owner/Supervisor/General; platform operational) + registration here",
  ],
  [
    "restoreIntroducer",
    "main admin (Owner/Supervisor/General; platform operational) + registration here",
  ],
  ["listBinnedStaff", "Owner / Admin Supervisor (canonical list helper)"],
  ["exportOwnerCustomerReport", "Owner"],
])
  console.log(`INFO    ${fn.padEnd(30)} ${auth}`);

console.log(`\n${total - failures.length}/${total} PASS`);
if (failures.length) {
  console.log(`FAILED: ${failures.join("; ")}`);
  process.exit(1);
}
