/**
 * G7F-4S1B2 public booking slot context — unit + static verification.
 * Fetch stub bound to a non-routable host: synthetic fixtures only, no database,
 * no network, no production.
 * Run: npm exec --yes --package=tsx -- tsx scripts/g7f4s1b2-slot-context-verify.mjs
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

for (const k of ["SUPABASE_URL", "VITE_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) {
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
async function rejects(fn) {
  try {
    await fn();
    return false;
  } catch {
    return true;
  }
}
const code = (rel) =>
  readFileSync(resolve(root, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const FAKE_HOST = "g7f4s1b2.invalid";
process.env.SUPABASE_URL = `http://${FAKE_HOST}`;
process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_secret_g7f4s1b2_not_a_real_key";

const T = {
  a: "c1111111-1111-4111-8111-111111111111",
  b: "c2222222-2222-4222-8222-222222222222",
  suspended: "c3333333-3333-4333-8333-333333333333",
  noFeature: "c4444444-4444-4444-8444-444444444444",
};
const U = {
  advA: "d1111111-1111-4111-8111-111111111111",
  ownerA: "d2222222-2222-4222-8222-222222222222",
  customerA: "d3333333-3333-4333-8333-333333333333",
  inactiveA: "d4444444-4444-4444-8444-444444444444",
  advB: "d5555555-5555-4555-8555-555555555555",
  liveNoTeamsA: "d6666666-6666-4666-8666-666666666666",
};

const db = {
  failTable: null,
  tenants: [
    { id: T.a, slug: "tenant-a", status: "active", feature: true },
    { id: T.b, slug: "tenant-b", status: "active", feature: true },
    { id: T.suspended, slug: "tenant-suspended", status: "suspended", feature: true },
    { id: T.noFeature, slug: "tenant-nofeature", status: "active", feature: false },
  ],
  introducers: [
    { id: "i-a", slug: "intro-a", tenant_id: T.a, active: true, company_name: "Intro A" },
    { id: "i-b", slug: "intro-b", tenant_id: T.b, active: true, company_name: "Intro B" },
    { id: "i-off", slug: "intro-off", tenant_id: T.a, active: false, company_name: "Off" },
    {
      id: "i-susp",
      slug: "intro-susp",
      tenant_id: T.suspended,
      active: true,
      company_name: "Susp",
    },
    {
      id: "i-nof",
      slug: "intro-nofeature",
      tenant_id: T.noFeature,
      active: true,
      company_name: "NoF",
    },
    { id: "i-orph", slug: "intro-orphan", tenant_id: null, active: true, company_name: "Orphan" },
  ],
  memberships: [
    { user_id: U.advA, tenant_id: T.a, role: "adviser", active: true },
    { user_id: U.ownerA, tenant_id: T.a, role: "owner", active: true },
    { user_id: U.customerA, tenant_id: T.a, role: "customer", active: true },
    { user_id: U.inactiveA, tenant_id: T.a, role: "adviser", active: false },
    { user_id: U.liveNoTeamsA, tenant_id: T.a, role: "adviser", active: true },
    { user_id: U.advB, tenant_id: T.b, role: "adviser", active: true },
  ],
  profiles: [
    { id: U.advA, full_name: "Adviser A", email: "adviser.a@example.test" },
    { id: U.ownerA, full_name: "Owner A", email: "owner.a@example.test" },
    { id: U.customerA, full_name: "Customer A", email: "customer.a@example.test" },
    { id: U.inactiveA, full_name: "Inactive A", email: "inactive.a@example.test" },
    { id: U.liveNoTeamsA, full_name: "No Teams A", email: "noteams.a@example.test" },
    { id: U.advB, full_name: "Adviser B", email: "adviser.b@example.test" },
  ],
  advisorProfiles: [
    { user_id: U.advA, deleted_at: null, teams_calendar_enabled: true },
    { user_id: U.ownerA, deleted_at: null, teams_calendar_enabled: true },
    { user_id: U.customerA, deleted_at: null, teams_calendar_enabled: true },
    { user_id: U.inactiveA, deleted_at: null, teams_calendar_enabled: true },
    { user_id: U.liveNoTeamsA, deleted_at: null, teams_calendar_enabled: false },
    { user_id: U.advB, deleted_at: null, teams_calendar_enabled: true },
  ],
};

const calls = [];
const json = (v, status = 200) =>
  new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } });
const eqParam = (url, key) => {
  const v = url.searchParams.get(key);
  return v && v.startsWith("eq.") ? v.slice(3) : null;
};
const inParam = (url, key) => {
  const v = url.searchParams.get(key);
  if (!v || !v.startsWith("in.(")) return null;
  return v
    .slice(4, -1)
    .split(",")
    .map((s) => s.replace(/^"|"$/g, ""));
};

globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === "string" ? input : (input.url ?? String(input)));
  if (url.hostname !== FAKE_HOST)
    throw new Error(`G7F4S1B2 fetch stub refused host ${url.hostname}`);
  const method = String(
    init.method || (typeof input === "object" && input.method) || "GET",
  ).toUpperCase();
  let body = null;
  try {
    body = init.body ? JSON.parse(String(init.body)) : null;
  } catch {
    body = null;
  }
  const p = url.pathname;
  calls.push({ method, path: p, search: decodeURIComponent(url.search), body });
  const table = p.replace("/rest/v1/", "");
  if (db.failTable === table) return json({ message: "boom", code: "XX000" }, 500);

  if (p === "/rest/v1/introducers" && method === "GET") {
    const slug = eqParam(url, "slug");
    const active = eqParam(url, "active");
    let rows = db.introducers.filter((r) => r.slug === slug);
    if (active === "true") rows = rows.filter((r) => r.active);
    return json(rows.map(({ active: _a, ...r }) => r));
  }
  if (p === "/rest/v1/tenants" && method === "GET") {
    const id = eqParam(url, "id");
    const slug = eqParam(url, "slug");
    const rows = db.tenants.filter(
      (t) => (id ? t.id === id : true) && (slug ? t.slug === slug : true),
    );
    return json(
      rows.map((t) => ({
        id: t.id,
        company_code: "000",
        slug: t.slug,
        company_name: t.slug,
        status: t.status,
        tenant_type: "firm",
      })),
    );
  }
  if (p === "/rest/v1/rpc/is_tenant_feature_enabled" && method === "POST") {
    const t = db.tenants.find((x) => x.id === body?.p_tenant_id);
    return json(Boolean(t?.feature && body?.p_feature_key === "appointment_booking"));
  }
  if (p === "/rest/v1/tenant_memberships" && method === "GET") {
    const tenantId = eqParam(url, "tenant_id");
    const active = eqParam(url, "active");
    const roles = inParam(url, "role");
    const userIds = inParam(url, "user_id");
    let rows = db.memberships.filter((m) => m.tenant_id === tenantId);
    if (active === "true") rows = rows.filter((m) => m.active);
    if (roles) rows = rows.filter((m) => roles.includes(m.role));
    if (userIds) rows = rows.filter((m) => userIds.includes(m.user_id));
    return json(rows.map((m) => ({ user_id: m.user_id })));
  }
  if (p === "/rest/v1/profiles" && method === "GET") {
    const ids = inParam(url, "id");
    return json(ids ? db.profiles.filter((r) => ids.includes(r.id)) : db.profiles);
  }
  if (p === "/rest/v1/advisor_profiles" && method === "GET") {
    const ids = inParam(url, "user_id");
    return json(
      ids ? db.advisorProfiles.filter((r) => ids.includes(r.user_id)) : db.advisorProfiles,
    );
  }
  return json({ message: `unstubbed ${method} ${p}` }, 404);
};

const {
  resolveAvailabilityTenant,
  resolveActiveIntroducerBySlug,
  listBookableAdvisorsForTenant,
  filterAdvisorIdsToTenant,
} = await import("../src/lib/booking-availability.server.ts");

const ids = (pool) => pool.map((a) => a.id).sort();
const membershipCalls = () => calls.filter((c) => c.path === "/rest/v1/tenant_memberships");

// 1. Referral slug resolves the correct tenant for availability.
{
  const ctxA = await resolveAvailabilityTenant({ referralSlug: "intro-a" });
  ok("1a referral intro-a resolves tenant A", ctxA.kind === "tenant" && ctxA.tenantId === T.a);
  const ctxB = await resolveAvailabilityTenant({ referralSlug: "intro-b" });
  ok("1b referral intro-b resolves tenant B", ctxB.kind === "tenant" && ctxB.tenantId === T.b);
  const ctxPad = await resolveAvailabilityTenant({ referralSlug: "  intro-a  " });
  ok("1c referral slug is trimmed", ctxPad.kind === "tenant" && ctxPad.tenantId === T.a);
  const ctxRoute = await resolveAvailabilityTenant({
    tenantSlug: "tenant-a",
    referralSlug: "intro-a",
  });
  ok(
    "1d matching route tenant + referral resolves tenant A",
    ctxRoute.kind === "tenant" && ctxRoute.tenantId === T.a,
  );
  const intro = await resolveActiveIntroducerBySlug("intro-a");
  ok("1e canonical introducer resolver returns tenant_id", intro?.tenant_id === T.a);
  const introCall = calls.filter((c) => c.path === "/rest/v1/introducers").at(-1);
  ok(
    "1f introducer lookup filters slug and active=true",
    introCall?.search.includes("slug=eq.intro-a") && introCall?.search.includes("active=eq.true"),
  );
}

// 2. The correct tenant's adviser pool is queried.
{
  calls.length = 0;
  const ctx = await resolveAvailabilityTenant({ referralSlug: "intro-a" });
  const pool = await listBookableAdvisorsForTenant(ctx.tenantId);
  const mc = membershipCalls();
  ok(
    "2a pool query is scoped to tenant A",
    mc.length === 1 && mc[0].search.includes(`tenant_id=eq.${T.a}`),
    mc[0]?.search,
  );
  ok("2b pool query requires active membership", mc[0]?.search.includes("active=eq.true"));
  ok(
    "2c pool is tenant A bookable staff only",
    JSON.stringify(ids(pool)) === JSON.stringify([U.advA, U.ownerA].sort()),
    ids(pool).join(","),
  );
  ok("2d customer membership excluded", !ids(pool).includes(U.customerA));
  ok("2e inactive membership excluded", !ids(pool).includes(U.inactiveA));
  ok(
    "2f live adviser without Teams excluded (unchanged rule)",
    !ids(pool).includes(U.liveNoTeamsA),
  );
  const profileCall = calls.find((c) => c.path === "/rest/v1/profiles");
  ok("2g profile lookup restricted to member ids", profileCall?.search.includes("id=in.("));
}

// 3. Tenant A referral cannot enumerate tenant B advisers.
{
  const ctxA = await resolveAvailabilityTenant({ referralSlug: "intro-a" });
  const poolA = await listBookableAdvisorsForTenant(ctxA.tenantId);
  ok("3a tenant A referral pool has no tenant B adviser", !ids(poolA).includes(U.advB));
  const mixed = await resolveAvailabilityTenant({
    tenantSlug: "tenant-b",
    referralSlug: "intro-a",
  });
  ok("3b tenant B route + tenant A referral is denied", mixed.kind === "denied");
  const mixed2 = await resolveAvailabilityTenant({
    tenantSlug: "tenant-a",
    referralSlug: "intro-b",
  });
  ok("3c tenant A route + tenant B referral is denied", mixed2.kind === "denied");
  const allowed = await filterAdvisorIdsToTenant([U.advA, U.advB, U.customerA], T.a);
  ok(
    "3d test-diary fallback filter keeps only tenant A staff",
    allowed.has(U.advA) && !allowed.has(U.advB) && !allowed.has(U.customerA),
  );
  const allowedB = await filterAdvisorIdsToTenant([U.advA, U.advB], T.b);
  ok(
    "3e fallback filter for tenant B excludes tenant A",
    allowedB.has(U.advB) && !allowedB.has(U.advA),
  );
  ok("3f empty id list short-circuits", (await filterAdvisorIdsToTenant([], T.a)).size === 0);
}

// 4. Unknown / invalid referral fails safely.
{
  const cases = [
    ["4a unknown referral", "intro-missing"],
    ["4b inactive introducer", "intro-off"],
    ["4c introducer tenant suspended", "intro-susp"],
    ["4d introducer tenant booking feature off", "intro-nofeature"],
    ["4e introducer without tenant", "intro-orphan"],
  ];
  for (const [name, slug] of cases) {
    const ctx = await resolveAvailabilityTenant({ referralSlug: slug });
    ok(`${name} is denied`, ctx.kind === "denied", ctx.kind);
  }
  db.failTable = "introducers";
  const errCtx = await resolveAvailabilityTenant({ referralSlug: "intro-a" });
  ok("4f introducer lookup error is denied", errCtx.kind === "denied", errCtx.kind);
  db.failTable = "tenants";
  const errTenant = await resolveAvailabilityTenant({ referralSlug: "intro-a" });
  ok("4g tenant lookup error is denied", errTenant.kind === "denied", errTenant.kind);
  db.failTable = null;
  ok(
    "4h unknown route tenant slug still fails loudly",
    await rejects(() => resolveAvailabilityTenant({ tenantSlug: "tenant-missing" })),
  );
  ok(
    "4i route tenant with booking feature off still fails loudly",
    await rejects(() => resolveAvailabilityTenant({ tenantSlug: "tenant-nofeature" })),
  );
}

// 5. Tenant-less request does not restore global discovery.
{
  const none = await resolveAvailabilityTenant({});
  ok("5a no tenant and no referral → none", none.kind === "none");
  const blank = await resolveAvailabilityTenant({ tenantSlug: "  ", referralSlug: "" });
  ok("5b blank tenant and referral → none", blank.kind === "none");
  calls.length = 0;
  const poolNull = await listBookableAdvisorsForTenant(null);
  const poolUndef = await listBookableAdvisorsForTenant(undefined);
  ok("5c tenant-less pool is empty", poolNull.length === 0 && poolUndef.length === 0);
  ok("5d tenant-less pool makes no database query", calls.length === 0, `${calls.length} calls`);
}

// Static wiring guards.
{
  const bf = code("src/lib/booking.functions.ts");
  const start = bf.indexOf("export const getAvailableSlots");
  const end = bf.indexOf("const appointmentInput", start);
  const slots = bf.slice(start, end);
  ok(
    "S1 getAvailableSlots accepts a referral slug",
    /slug:\s*z\.string\(\)\.min\(1\)\.max\(128\)\.optional\(\)/.test(slots),
  );
  ok(
    "S2 getAvailableSlots resolves tenant via resolveAvailabilityTenant",
    slots.includes("resolveAvailabilityTenant({"),
  );
  ok(
    "S3 denied context returns before the pool is listed",
    slots.indexOf('tenantContext.kind === "denied"') > -1 &&
      slots.indexOf('tenantContext.kind === "denied"') <
        slots.indexOf("listBookableAdvisors(tenantId)"),
  );
  ok(
    "S4 test-diary fallback is tenant-filtered when tenant known",
    slots.includes("filterAdvisorIdsToTenant("),
  );
  ok(
    "S5 no caller-supplied tenant id accepted by getAvailableSlots",
    !/tenant_id:\s*z\./.test(slots) && !/tenantId:\s*z\./.test(slots),
  );
  ok(
    "S6 booking uses the same canonical introducer resolver",
    /async function resolveIntroducer[\s\S]{0,200}resolveActiveIntroducerBySlug\(slug\)/.test(bf),
  );
  ok(
    "S7 booking pool uses the same tenant-scoped pool",
    /async function listBookableAdvisors[\s\S]{0,200}listBookableAdvisorsForTenant\(tenantId\)/.test(
      bf,
    ),
  );
  ok(
    "S8 booking.functions no longer queries introducers by slug directly",
    !/from\("introducers"\)\s*\.select\("id, company_name, slug, tenant_id"\)\s*\.eq\("slug"/.test(
      bf,
    ),
  );

  const mod = code("src/lib/booking-availability.server.ts");
  ok("S9 pool has no tenant-less query branch", /\}\s*else\s*\{\s*ids = \[\];\s*\}/.test(mod));
  ok("S10 pool does not read user_roles globally", !mod.includes('from("user_roles")'));

  const ui = code("src/components/CustomerAppointmentSignup.tsx");
  ok(
    "S11 signup slot request sends referral slug",
    /slotsFn\(\{\s*data:\s*\{[^}]*slug:\s*referralSlug/.test(ui),
  );
  ok(
    "S12 referral slug read from the introducer_ref cookie helper",
    ui.includes("const referralSlug = getReferralSlug()"),
  );
  ok("S13 slot cache key includes the referral", /queryKey:\s*\[[^\]]*referralSlug/.test(ui));
  ok(
    "S14 signup booking still sends the same referral slug",
    /slug:\s*getReferralSlug\(\)\s*\?\?\s*undefined/.test(ui),
  );
}

console.log(`\n${total - failures.length}/${total} PASS`);
if (failures.length) {
  console.error(`FAILED: ${failures.join(", ")}`);
  process.exit(1);
}
