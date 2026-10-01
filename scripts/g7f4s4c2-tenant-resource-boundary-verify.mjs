/**
 * G7F-4S4C2 canonical tenant/resource boundary — offline verification.
 * Real server-function validators and handlers run against an in-memory PostgREST fake on a
 * non-routable host. Synthetic fixtures only: no database, no network, no production, no real
 * customer, staff or privileged identity, no phone numbers.
 * Run: npm exec --yes --package=tsx -- tsx scripts/g7f4s4c2-tenant-resource-boundary-verify.mjs
 */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { register } from "node:module";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";

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

// --- module stubs: createServerFn capture, request Referer, Enter Company sessions ------------
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
export function getRequest() { return globalThis.__S4C2_REQUEST ?? null; }
export function getCookie() { return undefined; }
export function setCookie() {}
export function deleteCookie() {}
`;
const stubPlatform = `
export async function validatePlatformTenantAccessSession(input) {
  return globalThis.__S4C2_PLATFORM?.get(input.userId + ":" + input.tenantId) ?? null;
}
export async function hasValidPlatformTenantAccess() { return false; }
export async function clearPlatformTenantEntryOnLogout() {}
`;
const dataUrl = (src) => `data:text/javascript,${encodeURIComponent(src)}`;
const hookSource = `
const fromData = (ctx) => String(ctx.parentURL ?? "").startsWith("data:");
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
  return next(specifier, context);
}
`;
register(dataUrl(hookSource), import.meta.url);

// --- synthetic fixtures ------------------------------------------------------------------------
const FAKE_HOST = "g7f4s4c2.invalid";
process.env.SUPABASE_URL = `http://${FAKE_HOST}`;
process.env.VITE_SUPABASE_URL = `http://${FAKE_HOST}`;
process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_secret_g7f4s4c2_not_a_real_key";
process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_g7f4s4c2_not_a_real_key";
process.env.VITE_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_g7f4s4c2_not_a_real_key";

const id = (prefix, n) =>
  `${prefix}${String(n).repeat(7).slice(0, 7)}-0000-4000-8000-${String(n).padStart(12, "0")}`;
const T = { a: id("1", 1), b: id("1", 2) };
const U = {
  ownerA: id("2", 1),
  ownerB: id("2", 2),
  supA: id("2", 3),
  advA: id("2", 4),
  advA2: id("2", 5),
  advB: id("2", 6),
  dual: id("2", 7),
  introUserA: id("2", 8),
  generalA: id("2", 9),
  platRO: id("3", 1),
  platOp: id("3", 2),
  outsider: id("3", 3),
  binAdvA: id("3", 4),
  binAdvB: id("3", 5),
  binIntroB: id("3", 6),
  custA: id("4", 1),
  custB: id("4", 2),
  custMulti: id("4", 3),
  custNull: id("4", 4),
  custA3: id("4", 5),
  custA4: id("4", 6),
};
const S = {
  a1: id("5", 1),
  a2: id("5", 2),
  aOther: id("5", 3),
  aDel: id("5", 4),
  b1: id("5", 5),
  bDel: id("5", 6),
  mA: id("5", 7),
  mB: id("5", 8),
  nul: id("5", 9),
  a3: id("6", 1),
  a3Null: id("6", 2),
};
const I = { a: id("7", 1), b: id("7", 2), binB: id("7", 3) };
const RANDOM = "9f9f9f9f-9f9f-4f9f-8f9f-9f9f9f9f9f9f";

const now = Date.now();
const daysAgo = (d) => new Date(now - d * 86400000).toISOString();
const daysAhead = (d) => new Date(now + d * 86400000).toISOString();

let db;
function resetDb() {
  const profile = (pid, full_name, email) => ({
    id: pid,
    full_name,
    email,
    phone: null,
    address: null,
  });
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
    started_at: daysAgo(5),
    updated_at: daysAgo(3),
    created_at: daysAgo(5),
    channel: null,
    current_section: null,
    current_question_index: null,
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
        company_code: "901",
      },
      {
        id: T.b,
        slug: "tenant-b",
        company_name: "Tenant B",
        status: "active",
        tenant_type: "firm",
        company_code: "902",
      },
    ],
    tenant_memberships: [
      mem(U.ownerA, T.a, "owner"),
      mem(U.ownerB, T.b, "owner"),
      mem(U.supA, T.a, "supervisor"),
      mem(U.advA, T.a, "adviser"),
      mem(U.advA2, T.a, "adviser"),
      mem(U.advB, T.b, "adviser"),
      mem(U.dual, T.a, "owner"),
      mem(U.dual, T.b, "owner"),
      mem(U.introUserA, T.a, "introducer"),
      mem(U.generalA, T.a, "general"),
      mem(U.custA, T.a, "customer"),
      mem(U.custB, T.b, "customer"),
      mem(U.custMulti, T.a, "customer"),
      mem(U.custMulti, T.b, "customer"),
      mem(U.custA3, T.a, "customer"),
      mem(U.custA4, T.a, "customer"),
    ],
    admin_permissions: [
      { user_id: U.generalA, tenant_id: T.a, permission_key: "customers", access: "none" },
    ],
    profiles: [
      profile(U.ownerA, "Alpha Owner", "owner@alpha.example.test"),
      profile(U.ownerB, "Bravo Owner", "owner@bravo.example.test"),
      profile(U.advA, "Alpha Adviser", "adviser@alpha.example.test"),
      profile(U.advA2, "Alpha Adviser Two", "adviser2@alpha.example.test"),
      profile(U.advB, "Bravo Adviser", "adviser@bravo.example.test"),
      profile(U.binAdvA, "Alpha Binned Adviser", "binned@alpha.example.test"),
      profile(U.binAdvB, "Bravo Binned Adviser", "binned@bravo.example.test"),
      profile(U.binIntroB, "Bravo Binned Introducer", "binned-intro@bravo.example.test"),
      profile(U.custA, "Alpha Customer", "customer@alpha.example.test"),
      profile(U.custB, "Bravo Customer", "customer@bravo.example.test"),
      profile(U.custMulti, "Multi Customer", "multi@shared.example.test"),
      profile(U.custNull, "Nullco Customer", "customer@nullco.example.test"),
      profile(U.custA3, "Alpha Three Customer", "three@alpha.example.test"),
      profile(U.custA4, "Alpha Four Customer", "four@alpha.example.test"),
    ],
    interview_sessions: [
      sess(S.a1, U.custA, T.a, "MG-A-0001"),
      sess(S.a2, U.custA, T.a, null),
      sess(S.aOther, U.custA4, T.a, "MG-A-0004"),
      sess(S.aDel, U.custA, T.a, "MG-A-0009", { deleted_at: daysAgo(1) }),
      sess(S.b1, U.custB, T.b, "MG-B-0001"),
      sess(S.bDel, U.custB, T.b, "MG-B-0009", { deleted_at: daysAgo(1) }),
      sess(S.mA, U.custMulti, T.a, "MG-M-000A"),
      sess(S.mB, U.custMulti, T.b, "MG-M-000B"),
      sess(S.nul, U.custNull, null, "MG-N-0001"),
      sess(S.a3, U.custA3, T.a, null),
      sess(S.a3Null, U.custA3, null, null),
    ],
    session_advisors: [
      { session_id: S.a1, advisor_id: U.advA },
      { session_id: S.mA, advisor_id: U.advA },
      { session_id: S.b1, advisor_id: U.advB },
    ],
    appointments: [
      {
        id: id("8", 1),
        tenant_id: T.a,
        session_id: S.a1,
        advisor_id: U.advA,
        introducer_id: null,
        lead_id: null,
        status: "confirmed",
        customer_name: "Alpha Customer",
        customer_phone: null,
        customer_email: "customer@alpha.example.test",
        starts_at: daysAhead(3),
        created_at: daysAgo(2),
        lead_source: "web",
        referral_channel: null,
      },
      {
        id: id("8", 2),
        tenant_id: T.a,
        session_id: S.aOther,
        advisor_id: U.advA,
        introducer_id: I.a,
        lead_id: null,
        status: "confirmed",
        customer_name: "Alpha Four Customer",
        customer_phone: null,
        customer_email: "four@alpha.example.test",
        starts_at: daysAhead(4),
        created_at: daysAgo(2),
        lead_source: "introducer_portal",
        referral_channel: null,
      },
      {
        id: id("8", 3),
        tenant_id: T.b,
        session_id: S.b1,
        advisor_id: U.advB,
        introducer_id: null,
        lead_id: null,
        status: "confirmed",
        customer_name: "Bravo Customer",
        customer_phone: null,
        customer_email: "customer@bravo.example.test",
        starts_at: daysAhead(3),
        created_at: daysAgo(2),
        lead_source: "web",
        referral_channel: null,
      },
      {
        id: id("8", 4),
        tenant_id: T.b,
        session_id: S.mB,
        advisor_id: U.advB,
        introducer_id: null,
        lead_id: null,
        status: "confirmed",
        customer_name: "Bravo Multi Booking",
        customer_phone: null,
        customer_email: null,
        starts_at: daysAhead(5),
        created_at: daysAgo(2),
        lead_source: "web",
        referral_channel: null,
      },
      {
        id: id("8", 5),
        tenant_id: null,
        session_id: null,
        advisor_id: U.advA,
        introducer_id: null,
        lead_id: null,
        status: "confirmed",
        customer_name: "Nullco Caller",
        customer_phone: null,
        customer_email: null,
        starts_at: daysAhead(6),
        created_at: daysAgo(2),
        lead_source: "web",
        referral_channel: null,
      },
    ],
    callback_requests: [
      {
        id: id("9", 1),
        tenant_id: T.a,
        session_id: S.a2,
        advisor_id: U.advA,
        customer_name: "Alpha Callback",
        customer_phone: null,
        customer_email: null,
        preferred_window: "am",
        status: "new",
        notes: null,
        phone_call_id: null,
        created_at: daysAgo(1),
      },
      {
        id: id("9", 2),
        tenant_id: T.b,
        session_id: S.b1,
        advisor_id: U.advB,
        customer_name: "Bravo Callback",
        customer_phone: null,
        customer_email: null,
        preferred_window: "am",
        status: "new",
        notes: null,
        phone_call_id: null,
        created_at: daysAgo(1),
      },
      {
        id: id("9", 3),
        tenant_id: null,
        session_id: null,
        advisor_id: null,
        customer_name: "Nullco Voicemail",
        customer_phone: null,
        customer_email: null,
        preferred_window: "any",
        status: "new",
        notes: "voicemail",
        phone_call_id: null,
        created_at: daysAgo(1),
      },
    ],
    phone_calls: [
      {
        id: id("a", 1),
        tenant_id: T.a,
        session_id: S.a1,
        advisor_id: U.advA,
        call_kind: "outbound",
        direction: "outbound",
        from_number: null,
        to_number: null,
        started_at: daysAgo(1),
        summary: "Alpha call summary",
        ai_status: "done",
        status: "completed",
      },
      {
        id: id("a", 2),
        tenant_id: T.b,
        session_id: S.b1,
        advisor_id: U.advB,
        call_kind: "outbound",
        direction: "outbound",
        from_number: null,
        to_number: null,
        started_at: daysAgo(1),
        summary: "Bravo call summary",
        ai_status: "done",
        status: "completed",
      },
    ],
    staff_contact_tasks: [
      {
        id: id("b", 1),
        tenant_id: T.b,
        session_id: S.b1,
        task_type: "welcome_call",
        due_at: daysAgo(1),
        completed_at: null,
        created_at: daysAgo(2),
      },
    ],
    case_mortgage_details: [
      {
        session_id: S.a1,
        tenant_id: null,
        current_lender: "Alpha Bank",
        product_expiry_date: daysAhead(60).slice(0, 10),
        actionable_from_date: null,
        actionable_note: null,
        monthly_payment_pence: 1000,
      },
      {
        session_id: S.b1,
        tenant_id: T.b,
        current_lender: "Bravo Bank",
        product_expiry_date: daysAhead(60).slice(0, 10),
        actionable_from_date: null,
        actionable_note: "bravo-untouched",
        monthly_payment_pence: 2000,
      },
      {
        session_id: S.nul,
        tenant_id: null,
        current_lender: "Nullco Bank",
        product_expiry_date: daysAhead(60).slice(0, 10),
        actionable_from_date: null,
        actionable_note: null,
        monthly_payment_pence: 3000,
      },
    ],
    lender_remortgage_policies: [],
    customer_journey_milestones: [],
    interview_answers: [],
    advisor_contact_views: [],
    customer_introducer_links: [
      { customer_id: U.custA, introducer_id: I.a, tenant_id: T.a, source: "seed" },
      { customer_id: U.custB, introducer_id: I.b, tenant_id: null, source: "seed" },
      { customer_id: U.custMulti, introducer_id: I.b, tenant_id: null, source: "seed" },
    ],
    introducer_leads: [],
    introducer_amendment_history: [],
    introducers: [
      {
        id: I.a,
        tenant_id: T.a,
        user_id: U.introUserA,
        company_code: "INT-A",
        company_name: "Alpha Introducer Co",
        slug: "intro-a",
        active: true,
        deleted_at: null,
      },
      {
        id: I.b,
        tenant_id: T.b,
        user_id: null,
        company_code: "INT-B",
        company_name: "Bravo Introducer Co",
        slug: "intro-b",
        active: true,
        deleted_at: null,
      },
      {
        id: I.binB,
        tenant_id: T.b,
        user_id: U.binIntroB,
        company_code: "INT-BX",
        company_name: "Bravo Binned Introducer Co",
        slug: "intro-bx",
        active: false,
        deleted_at: daysAgo(1),
      },
    ],
    advisor_profiles: [
      { user_id: U.advA, tenant_id: T.a, code: "ADV-A1", deleted_at: null },
      { user_id: U.advA2, tenant_id: T.a, code: "ADV-A2", deleted_at: null },
      { user_id: U.advB, tenant_id: T.b, code: "ADV-B1", deleted_at: null },
      { user_id: U.binAdvA, tenant_id: T.a, code: "ADV-AX", deleted_at: daysAgo(1) },
      { user_id: U.binAdvB, tenant_id: T.b, code: "ADV-BX", deleted_at: daysAgo(1) },
    ],
    referral_codes: [
      {
        id: id("c", 1),
        tenant_id: T.a,
        code: "ALPHA111",
        referrer_user_id: null,
        referrer_name: "Alpha Referrer",
        referrer_phone: null,
        active: true,
        created_at: daysAgo(9),
      },
      {
        id: id("c", 2),
        tenant_id: T.b,
        code: "BRAVO111",
        referrer_user_id: null,
        referrer_name: "Bravo Referrer",
        referrer_phone: null,
        active: true,
        created_at: daysAgo(9),
      },
      {
        id: id("c", 3),
        tenant_id: null,
        code: "NULLC111",
        referrer_user_id: null,
        referrer_name: "Nullco Referrer",
        referrer_phone: null,
        active: true,
        created_at: daysAgo(9),
      },
    ],
    referrals: [
      {
        id: id("d", 1),
        tenant_id: null,
        referral_code_id: id("c", 1),
        code: "ALPHA111",
        referrer_user_id: null,
        referred_user_id: U.custA4,
        referred_email: null,
        status: "pending",
        bonus_status: "none",
        notes: null,
        created_at: daysAgo(4),
        updated_at: daysAgo(4),
      },
      {
        id: id("d", 2),
        tenant_id: T.b,
        referral_code_id: id("c", 2),
        code: "BRAVO111",
        referrer_user_id: null,
        referred_user_id: U.custB,
        referred_email: null,
        status: "pending",
        bonus_status: "none",
        notes: null,
        created_at: daysAgo(4),
        updated_at: daysAgo(4),
      },
      {
        id: id("d", 3),
        tenant_id: null,
        referral_code_id: id("c", 3),
        code: "NULLC111",
        referrer_user_id: null,
        referred_user_id: U.custNull,
        referred_email: null,
        status: "pending",
        bonus_status: "none",
        notes: null,
        created_at: daysAgo(4),
        updated_at: daysAgo(4),
      },
    ],
    view_as_audit_log: [
      {
        id: id("e", 1),
        tenant_id: T.a,
        view_type: "customer",
        acting_user_id: U.ownerA,
        target_user_id: U.custA,
        action: "open",
        summary: "Alpha audit",
        detail: null,
        created_at: daysAgo(1),
      },
      {
        id: id("e", 2),
        tenant_id: T.b,
        view_type: "customer",
        acting_user_id: U.ownerB,
        target_user_id: U.custB,
        action: "open",
        summary: "Bravo audit",
        detail: null,
        created_at: daysAgo(1),
      },
      {
        id: id("e", 3),
        tenant_id: null,
        view_type: "customer",
        acting_user_id: U.ownerA,
        target_user_id: U.custNull,
        action: "open",
        summary: "Nullco audit",
        detail: null,
        created_at: daysAgo(1),
      },
    ],
    commission_ledger: [],
  };
  writes.length = 0;
  unknownCalls.length = 0;
}

globalThis.__S4C2_PLATFORM = new Map([
  [`${U.platRO}:${T.a}`, { accessLevel: "read_only", basisLabel: "synthetic read-only" }],
  [`${U.platOp}:${T.a}`, { accessLevel: "operational_admin", basisLabel: "synthetic operational" }],
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
function matchOr(row, v) {
  return splitTopLevel(v.replace(/^\(|\)$/g, "")).some((part) => {
    const dot = part.indexOf(".");
    return matchOp(row[part.slice(0, dot)], part.slice(dot + 1));
  });
}
function applyFilters(rows, url) {
  let out = rows;
  for (const [k, v] of url.searchParams.entries()) {
    if (RESERVED.has(k)) continue;
    if (k === "or") out = out.filter((r) => matchOr(r, v));
    else if (k === "and") throw new Error(`fake postgrest: unsupported and=${v}`);
    else out = out.filter((r) => matchOp(r[k], v));
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
    throw new Error(`G7F4S4C2 fetch stub refused host ${url.hostname}`);
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
      return respondRows(applyFilters(rows, url), headers, method);
    }
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
          : row.id
            ? rows.find((r) => r.id === row.id)
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
        if (row.id === undefined && !["advisor_profiles", "case_mortgage_details"].includes(table))
          row.id = randomUUID();
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
      if (table === "interview_sessions" && body?.case_ref) {
        const clash = rows.find((r) => r.case_ref === body.case_ref && !hit.includes(r));
        if (clash) return json({ code: "23505", message: "duplicate key value" }, 409);
      }
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

// --- load real modules ------------------------------------------------------------------------
resetDb();
const sf = await import("../src/lib/sessions.functions.ts");
const cd = await import("../src/lib/case-details.functions.ts");
const rel = await import("../src/lib/relationship.functions.ts");
const ja = await import("../src/lib/journey-analytics.functions.ts");
const bf = await import("../src/lib/booking.functions.ts");
const rf = await import("../src/lib/referrals.functions.ts");
const va = await import("../src/lib/view-as-audit.functions.ts");
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
  globalThis.__S4C2_REQUEST = actor.slug
    ? new Request(`http://app.invalid/_serverFn/x`, {
        headers: { referer: `http://app.invalid/${actor.slug}/admin` },
      })
    : null;
  return outcome(() =>
    invoke(fn, data, { userId: actor.userId, claims: { sub: actor.userId }, supabase: null }),
  );
}
const mutations = () => writes.filter((w) => w.method !== "UPDATE_NOOP");
const NOT_FOUND = ta.RESOURCE_NOT_FOUND_MESSAGE;
const notFound = (r) => !r.ok && r.message === NOT_FOUND;
const forbidden = (r) => !r.ok && r.message === "Forbidden";
const has = (v, s) => JSON.stringify(v ?? null).includes(s);
const leakFree = (r) =>
  !r.ok &&
  !["tenant-a", "tenant-b", "Bravo", "Alpha", "Nullco", T.a, T.b, U.custB, U.advB, I.b].some((s) =>
    r.message.includes(s),
  );

const ownerA = as(U.ownerA, "tenant-a");
const supA = as(U.supA, "tenant-a");
const advA = as(U.advA, "tenant-a");
const advA2 = as(U.advA2, "tenant-a");
const ownerB = as(U.ownerB, "tenant-b");
const dualA = as(U.dual, "tenant-a");
const dualB = as(U.dual, "tenant-b");
const dualNone = as(U.dual, null);
const outsider = as(U.outsider, null);
const introA = as(U.introUserA, "tenant-a");
const generalA = as(U.generalA, "tenant-a");
const platRO = as(U.platRO, "tenant-a");
const platOp = as(U.platOp, "tenant-a");

// Resource-bound S4C2 entry points: [label, fn, payload(resource)].
const sessionOps = [
  ["updateCaseRef", sf.updateCaseRef, (sid) => ({ sessionId: sid, caseRef: "MG-NEW-0001" })],
  ["deleteSession", sf.deleteSession, (sid) => ({ sessionId: sid })],
  ["restoreSession", sf.restoreSession, (sid) => ({ sessionId: sid })],
  ["getCaseMortgageDetails", cd.getCaseMortgageDetails, (sid) => ({ sessionId: sid })],
  [
    "upsertCaseMortgageDetails",
    cd.upsertCaseMortgageDetails,
    (sid) => ({ sessionId: sid, currentLender: "X", actionableFromDate: "2027-01-01" }),
  ],
];
const customerOps = [
  ["getCustomerHub", sf.getCustomerHub, (cid) => ({ customerId: cid })],
  [
    "updateCustomerContact",
    sf.updateCustomerContact,
    (cid) => ({ customerId: cid, fullName: "Changed Name" }),
  ],
  ["listMySessions(view-as)", sf.listMySessions, (cid) => ({ viewAsCustomerUserId: cid })],
  ["listMyCases(view-as)", sf.listMyCases, (cid) => ({ viewAsCustomerUserId: cid })],
];
const promote = (sid, cid) => ({ sessionId: sid, customerId: cid });

// --- fingerprint (T13) ------------------------------------------------------------------------
function fingerprint() {
  const pick = (rows, cols) =>
    (rows ?? [])
      .map((r) => cols.map((c) => r[c] ?? null))
      .map((x) => JSON.stringify(x))
      .sort();
  const material = {
    memberships: pick(db.tenant_memberships, ["user_id", "tenant_id", "role", "active"]),
    adviserCodes: pick(db.advisor_profiles, ["user_id", "tenant_id", "code"]),
    introducers: pick(db.introducers, ["id", "tenant_id", "user_id", "company_code", "slug"]),
    links: pick(db.customer_introducer_links, [
      "customer_id",
      "introducer_id",
      "tenant_id",
      "source",
    ]),
    sessionsOwnership: pick(db.interview_sessions, ["id", "customer_id", "tenant_id"]),
    allocations: pick(db.session_advisors, ["session_id", "advisor_id"]),
    appointments: pick(db.appointments, [
      "id",
      "tenant_id",
      "session_id",
      "advisor_id",
      "introducer_id",
      "lead_id",
      "lead_source",
    ]),
    referralCodes: pick(db.referral_codes, ["id", "tenant_id", "code", "referrer_user_id"]),
    referrals: pick(db.referrals, [
      "id",
      "referral_code_id",
      "referrer_user_id",
      "referred_user_id",
      "status",
      "bonus_status",
    ]),
    amendments: pick(db.introducer_amendment_history, ["customer_id", "new_introducer_id"]),
    commission: pick(db.commission_ledger, ["id"]),
    profilesIdentity: pick(db.profiles, ["id"]),
  };
  return createHash("sha256").update(JSON.stringify(material)).digest("hex");
}

// =============================================================================================
// T1 same-tenant authorised access passes
// =============================================================================================
{
  resetDb();
  const hub = await call(sf.getCustomerHub, { customerId: U.custA }, ownerA);
  const details = await call(cd.getCaseMortgageDetails, { sessionId: S.a1 }, ownerA);
  const ref = await call(sf.updateCaseRef, { sessionId: S.a1, caseRef: "MG-A-7777" }, ownerA);
  const hubAdv = await call(sf.getCustomerHub, { customerId: U.custA }, advA);
  const viewAs = await call(sf.listMySessions, { viewAsCustomerUserId: U.custA }, supA);
  ok(
    "T1 same-tenant authorised access passes",
    hub.ok &&
      hub.value.customer.full_name === "Alpha Customer" &&
      details.ok &&
      details.value.details?.currentLender === "Alpha Bank" &&
      ref.ok &&
      db.interview_sessions.find((s) => s.id === S.a1).case_ref === "MG-A-7777" &&
      hubAdv.ok &&
      viewAs.ok &&
      viewAs.value.length > 0,
    [hub, details, ref, hubAdv, viewAs].map((r) => (r.ok ? "ok" : r.message)).join(" | "),
  );
}

// =============================================================================================
// T2 / T3 cross-tenant denial (same role, higher role)
// =============================================================================================
{
  const results = [];
  for (const [label, fn, payload] of sessionOps) {
    resetDb();
    const target = label === "restoreSession" ? S.bDel : S.b1;
    results.push([label, await call(fn, payload(target), ownerA), mutations().length]);
  }
  for (const [label, fn, payload] of customerOps) {
    resetDb();
    results.push([label, await call(fn, payload(U.custB), ownerA), mutations().length]);
  }
  resetDb();
  results.push([
    "promote",
    await call(sf.promoteSessionToCaseAsStaff, promote(S.b1, U.custB), ownerA),
    mutations().length,
  ]);
  const bad = results.filter(([, r, m]) => !notFound(r) || m !== 0);
  ok(
    "T3 higher-role (Owner A) cross-tenant access denied on every resource entry point",
    bad.length === 0,
    bad.length
      ? bad.map(([l, r]) => `${l}:${r.ok ? "ALLOWED" : r.message}`).join(", ")
      : `${results.length} entry points`,
  );

  resetDb();
  const hub = await call(sf.getCustomerHub, { customerId: U.custB }, advA);
  const prom = await call(sf.promoteSessionToCaseAsStaff, promote(S.b1, U.custB), advA);
  resetDb();
  const hubOtherDir = await call(
    sf.getCustomerHub,
    { customerId: U.custA },
    as(U.advB, "tenant-b"),
  );
  ok(
    "T2 same-role (adviser) cross-tenant access denied",
    notFound(hub) && notFound(prom) && notFound(hubOtherDir) && mutations().length === 0,
    [hub, prom, hubOtherDir].map((r) => (r.ok ? "ALLOWED" : r.message)).join(" | "),
  );
}

// =============================================================================================
// T4 / T15 random UUID == cross-tenant == tenantless; errors carry no identity
// =============================================================================================
{
  const rows = [];
  for (const [label, fn, payload] of sessionOps) {
    resetDb();
    const cross = await call(fn, payload(label === "restoreSession" ? S.bDel : S.b1), ownerA);
    const random = await call(fn, payload(RANDOM), ownerA);
    const tenantless = await call(fn, payload(S.nul), ownerA);
    rows.push([label, cross, random, tenantless, mutations().length]);
  }
  for (const [label, fn, payload] of customerOps) {
    resetDb();
    const cross = await call(fn, payload(U.custB), ownerA);
    const random = await call(fn, payload(RANDOM), ownerA);
    const tenantless = await call(fn, payload(U.custNull), ownerA);
    rows.push([label, cross, random, tenantless, mutations().length]);
  }
  resetDb();
  rows.push([
    "promote",
    await call(sf.promoteSessionToCaseAsStaff, promote(S.b1, U.custB), ownerA),
    await call(sf.promoteSessionToCaseAsStaff, promote(RANDOM, U.custA), ownerA),
    await call(sf.promoteSessionToCaseAsStaff, promote(S.nul, U.custNull), ownerA),
    mutations().length,
  ]);
  const t4bad = rows.filter(([, c, r]) => !(notFound(c) && notFound(r) && c.message === r.message));
  ok(
    "T4 random UUID gives the same outcome as a cross-tenant id",
    t4bad.length === 0,
    t4bad.length
      ? t4bad.map(([l, c, r]) => `${l}: ${c.message} vs ${r.message}`).join(", ")
      : `${rows.length} entry points`,
  );
  const t15bad = rows.filter(
    ([, c, r, t, m]) =>
      !(
        [c, r, t].every((x) => notFound(x) && leakFree(x)) &&
        new Set([c.message, r.message, t.message]).size === 1 &&
        m === 0
      ),
  );
  ok(
    "T15 errors do not distinguish nonexistent / cross-tenant / tenantless and reveal no identity",
    t15bad.length === 0,
    t15bad.length ? t15bad.map(([l]) => l).join(", ") : `"${NOT_FOUND}" everywhere, no writes`,
  );
}

// =============================================================================================
// T5 multi-tenant actor acting in A cannot reach B; T6 ambiguous acting tenant denied
// =============================================================================================
{
  resetDb();
  const hubB = await call(sf.getCustomerHub, { customerId: U.custB }, dualA);
  const refB = await call(sf.updateCaseRef, { sessionId: S.b1, caseRef: "MG-X-0001" }, dualA);
  const delB = await call(sf.deleteSession, { sessionId: S.b1 }, dualA);
  const noWrite = mutations().length === 0;
  const hubBinB = await call(sf.getCustomerHub, { customerId: U.custB }, dualB);
  const hubAinA = await call(sf.getCustomerHub, { customerId: U.custA }, dualA);
  ok(
    "T5 multi-tenant actor acting in A cannot reach a B resource",
    notFound(hubB) && notFound(refB) && notFound(delB) && noWrite && hubBinB.ok && hubAinA.ok,
    [hubB, refB, delB, hubBinB, hubAinA].map((r) => (r.ok ? "ok" : r.message)).join(" | "),
  );

  resetDb();
  const amb = [
    await call(sf.getCustomerHub, { customerId: U.custA }, dualNone),
    await call(sf.updateCaseRef, { sessionId: S.a1, caseRef: "MG-X-0002" }, dualNone),
    await call(rel.listRelationshipPipeline, {}, dualNone),
    await call(bf.listAdvisorContacts, undefined, dualNone),
    await call(sf.getCustomerHub, { customerId: U.custA }, outsider),
    await call(sf.getCustomerHub, { customerId: U.custA }, as(U.ownerA, "tenant-b")),
  ];
  ok(
    "T6 ambiguous / missing / unverified acting tenant is denied (no silent tenant)",
    amb.every((r) => !r.ok && /Tenant (required|access denied)\./.test(r.message)) &&
      mutations().length === 0,
    amb.map((r) => (r.ok ? "ALLOWED" : r.message)).join(" | "),
  );
}

// =============================================================================================
// T7 insufficient role; T8 unallocated adviser
// =============================================================================================
{
  resetDb();
  const t7 = [
    await call(sf.getCustomerHub, { customerId: U.custA }, introA),
    await call(sf.updateCaseRef, { sessionId: S.a1, caseRef: "MG-X-0003" }, introA),
    await call(sf.deleteSession, { sessionId: S.a1 }, generalA),
    await call(sf.restoreSession, { sessionId: S.aDel }, generalA),
    await call(
      cd.upsertCaseMortgageDetails,
      { sessionId: S.a1, actionableFromDate: "2027-01-01" },
      advA,
    ),
    await call(sf.listMySessions, { viewAsCustomerUserId: U.custA }, advA),
    await call(ja.listJourneyAnalyticsLeads, undefined, advA),
    await call(rf.listAllReferrals, undefined, advA),
    await call(sf.listBinnedStaff, undefined, generalA),
    await call(va.listViewAsAuditLog, { viewType: "customer" }, generalA),
  ];
  ok(
    "T7 insufficient role is denied",
    t7.every(forbidden) && mutations().length === 0,
    t7.map((r) => (r.ok ? "ALLOWED" : r.message)).join(" | "),
  );

  resetDb();
  const hub = await call(sf.getCustomerHub, { customerId: U.custA }, advA2);
  const prom = await call(sf.promoteSessionToCaseAsStaff, promote(S.a2, U.custA), advA2);
  const contact = await call(
    sf.updateCustomerContact,
    { customerId: U.custA, fullName: "Nope" },
    advA2,
  );
  const noWrite = mutations().length === 0;
  const allocated = await call(sf.promoteSessionToCaseAsStaff, promote(S.a2, U.custA), advA);
  ok(
    "T8 unallocated adviser is denied; allocated adviser is allowed",
    [hub, prom, contact].every(
      (r) => !r.ok && r.message === "This customer is not allocated to you.",
    ) &&
      noWrite &&
      allocated.ok &&
      allocated.value.alreadyCase === false,
    [hub, prom, contact, allocated].map((r) => (r.ok ? "ok" : r.message)).join(" | "),
  );
}

// =============================================================================================
// T9 tenantless resource denied
// =============================================================================================
{
  resetDb();
  const t9 = [
    await call(sf.updateCaseRef, { sessionId: S.nul, caseRef: "MG-X-0004" }, ownerA),
    await call(sf.deleteSession, { sessionId: S.nul }, ownerA),
    await call(cd.getCaseMortgageDetails, { sessionId: S.nul }, ownerA),
    await call(sf.getCustomerHub, { customerId: U.custNull }, ownerA),
    await call(sf.promoteSessionToCaseAsStaff, promote(S.a3Null, U.custA3), ownerA),
  ];
  ok(
    "T9 tenantless resource is denied (never assigned a tenant)",
    t9.every(notFound) &&
      mutations().length === 0 &&
      db.interview_sessions.find((s) => s.id === S.nul).tenant_id === null,
    t9.map((r) => (r.ok ? "ALLOWED" : r.message)).join(" | "),
  );
}

// =============================================================================================
// T10 mixed bulk request rejected atomically
// =============================================================================================
{
  resetDb();
  const cap = { mutate: true, allocation: "none", allow: (v) => v.adminAccess.isOwner };
  async function bulkSoftDelete(ids, actor) {
    globalThis.__S4C2_REQUEST = new Request("http://app.invalid/_serverFn/x", {
      headers: { referer: `http://app.invalid/${actor.slug}/admin` },
    });
    const { rows } = await ta.authoriseTenantResources({
      userId: actor.userId,
      kind: "session",
      ids,
      capability: cap,
    });
    for (const r of rows) {
      const s = db.interview_sessions.find((x) => x.id === r.id);
      s.deleted_at = "bulk";
      writes.push({ method: "UPDATE", table: "interview_sessions", row: { id: r.id } });
    }
    return rows.length;
  }
  const mixed = await outcome(() => bulkSoftDelete([S.a1, S.a2, S.b1], ownerA));
  const mixedRandom = await outcome(() => bulkSoftDelete([S.a1, RANDOM], ownerA));
  const mixedNull = await outcome(() => bulkSoftDelete([S.a2, S.nul], ownerA));
  const untouched =
    mutations().length === 0 && !db.interview_sessions.some((s) => s.deleted_at === "bulk");
  const clean = await outcome(() => bulkSoftDelete([S.a1, S.a2], ownerA));
  ok(
    "T10 mixed bulk request is rejected atomically (no partial mutation)",
    [mixed, mixedRandom, mixedNull].every((r) => !r.ok && r.message === NOT_FOUND) &&
      untouched &&
      clean.ok &&
      clean.value === 2,
    [mixed, mixedRandom, mixedNull, clean]
      .map((r) => (r.ok ? `ok(${r.value})` : r.message))
      .join(" | "),
  );
}

// =============================================================================================
// T11 platform read-only cannot mutate
// =============================================================================================
{
  resetDb();
  const read = await call(sf.getCustomerHub, { customerId: U.custA }, platRO);
  const muts = [
    await call(sf.updateCustomerContact, { customerId: U.custA, fullName: "RO change" }, platRO),
    await call(sf.updateCaseRef, { sessionId: S.a1, caseRef: "MG-RO-0001" }, platRO),
    await call(sf.deleteSession, { sessionId: S.a1 }, platRO),
    await call(sf.restoreSession, { sessionId: S.aDel }, platRO),
    await call(sf.promoteSessionToCaseAsStaff, promote(S.a2, U.custA), platRO),
    await call(
      cd.upsertCaseMortgageDetails,
      { sessionId: S.a1, actionableFromDate: "2027-01-01" },
      platRO,
    ),
    await call(rel.refreshRelationshipActionableDates, undefined, platRO),
  ];
  const roClean = mutations().length === 0;
  const opRef = await call(sf.updateCaseRef, { sessionId: S.a1, caseRef: "MG-OP-0001" }, platOp);
  ok(
    "T11 platform read-only cannot mutate (operational platform entry still can)",
    read.ok && muts.every(forbidden) && roClean && opRef.ok,
    [read, ...muts, opRef].map((r) => (r.ok ? "ok" : r.message)).join(" | "),
  );
}

// =============================================================================================
// T12 every S4C2 list/search excludes other-tenant (and tenantless) data
// =============================================================================================
{
  const lists = [
    ["listAdvisorContacts(owner)", bf.listAdvisorContacts, undefined, ownerA, "Alpha Customer"],
    ["listAdvisorContacts(adviser)", bf.listAdvisorContacts, undefined, advA, "Alpha Customer"],
    ["searchCustomers", rf.searchCustomers, { query: "Customer" }, ownerA, "Alpha Customer"],
    ["listReferralLinks", rf.listReferralLinks, undefined, ownerA, "ALPHA111"],
    ["listAllReferrals", rf.listAllReferrals, undefined, ownerA, "Alpha Referrer"],
    ["listBinnedStaff", sf.listBinnedStaff, undefined, ownerA, "ADV-AX"],
    ["listViewAsAuditLog", va.listViewAsAuditLog, { viewType: "customer" }, ownerA, "Alpha audit"],
    ["listRelationshipPipeline", rel.listRelationshipPipeline, {}, ownerA, "Alpha Bank"],
    [
      "listJourneyAnalyticsLeads",
      ja.listJourneyAnalyticsLeads,
      undefined,
      ownerA,
      "Alpha Customer",
    ],
    [
      "listMySessions(view-as multi)",
      sf.listMySessions,
      { viewAsCustomerUserId: U.custMulti },
      ownerA,
      S.mA,
    ],
    [
      "listMyCases(view-as multi)",
      sf.listMyCases,
      { viewAsCustomerUserId: U.custMulti },
      ownerA,
      "MG-M-000A",
    ],
    ["getCustomerHub(multi)", sf.getCustomerHub, { customerId: U.custMulti }, ownerA, "MG-M-000A"],
  ];
  const foreign = [
    "Bravo",
    "bravo.example.test",
    "Nullco",
    "nullco.example.test",
    "BRAVO111",
    "NULLC111",
    "ADV-BX",
    "INT-BX",
    S.b1,
    S.bDel,
    S.mB,
    S.nul,
    "MG-M-000B",
    "MG-B-",
    "MG-N-",
  ];
  for (const [label, fn, data, actor, mustHave] of lists) {
    resetDb();
    const r = await call(fn, data, actor);
    const leaked = r.ok ? foreign.filter((f) => has(r.value, f)) : [];
    ok(
      `T12 ${label} excludes other-tenant and tenantless data`,
      r.ok && leaked.length === 0 && has(r.value, mustHave),
      r.ok ? (leaked.length ? `LEAKED ${leaked.join(",")}` : `contains ${mustHave}`) : r.message,
    );
  }

  resetDb();
  const contacts = await call(bf.listAdvisorContacts, undefined, ownerA);
  const taskInserts = writes.filter(
    (w) => w.table === "staff_contact_tasks" && w.method === "INSERT",
  );
  ok(
    "T12b listAdvisorContacts backfill only creates acting-tenant welcome tasks, stamped with that tenant",
    contacts.ok &&
      taskInserts.length === 2 &&
      taskInserts.every(
        (w) => [S.a1, S.aOther].includes(w.row.session_id) && w.row.tenant_id === T.a,
      ) &&
      !taskInserts.some((w) => w.row.session_id === S.mB),
    taskInserts
      .map(
        (w) => `${w.row.session_id.slice(0, 2)}:${w.row.tenant_id === T.a ? "A" : w.row.tenant_id}`,
      )
      .join(","),
  );

  resetDb();
  const refLinks = await call(rf.listReferralLinks, undefined, ownerA);
  ok(
    "T12c referral counts only include acting-tenant referrals",
    refLinks.ok && refLinks.value.length === 1 && refLinks.value[0].referralCount === 1,
  );
}

// =============================================================================================
// T14 BD-7a: single-tenant customer global edit permitted; multi-tenant / indeterminate blocked
// =============================================================================================
{
  resetDb();
  const single = await call(
    sf.updateCustomerContact,
    { customerId: U.custA, fullName: "Alpha Renamed" },
    ownerA,
  );
  const singleApplied = db.profiles.find((p) => p.id === U.custA).full_name === "Alpha Renamed";
  const multi = await call(
    sf.updateCustomerContact,
    { customerId: U.custMulti, email: "x@shared.example.test" },
    ownerA,
  );
  const indeterminate = await call(
    sf.updateCustomerContact,
    { customerId: U.custA3, fullName: "Three Changed" },
    ownerA,
  );
  const multiFromB = await call(
    sf.updateCustomerContact,
    { customerId: U.custMulti, fullName: "B change" },
    ownerB,
  );
  const untouched =
    db.profiles.find((p) => p.id === U.custMulti).email === "multi@shared.example.test" &&
    db.profiles.find((p) => p.id === U.custMulti).full_name === "Multi Customer" &&
    db.profiles.find((p) => p.id === U.custA3).full_name === "Alpha Three Customer";
  const lock = ta.GLOBAL_PROFILE_LOCKED_MESSAGE;
  ok(
    "T14 single-tenant customer global edit permitted; multi-tenant (and tenantless-footprint) blocked",
    single.ok &&
      singleApplied &&
      [multi, indeterminate, multiFromB].every((r) => !r.ok && r.message === lock) &&
      untouched &&
      leakFree(multi),
    [single, multi, indeterminate, multiFromB].map((r) => (r.ok ? "ok" : r.message)).join(" | "),
  );
}

// =============================================================================================
// Route-specific cases (S4C1 matrix)
// =============================================================================================
{
  resetDb();
  const wrongCustomer = await call(
    sf.promoteSessionToCaseAsStaff,
    promote(S.aOther, U.custA),
    ownerA,
  );
  ok(
    "R1 promote: session of another same-tenant customer → Not found",
    notFound(wrongCustomer) && mutations().length === 0,
  );

  resetDb();
  const hub4 = await call(sf.getCustomerHub, { customerId: U.custA4 }, ownerA);
  const hubMulti = await call(sf.getCustomerHub, { customerId: U.custMulti }, ownerA);
  const linkWrites = writes.filter((w) => w.table === "customer_introducer_links");
  ok(
    "R2 hub: introducer resolved read-only (no link write on read)",
    hub4.ok && hub4.value.introducer?.companyCode === "INT-A" && linkWrites.length === 0,
    hub4.ok
      ? `introducer=${hub4.value.introducer?.companyCode}; link writes=${linkWrites.length}`
      : hub4.message,
  );
  ok(
    "R3 hub: other-tenant introducer and sessions hidden for a multi-tenant customer",
    hubMulti.ok &&
      hubMulti.value.introducer === null &&
      hubMulti.value.cases.map((c) => c.caseRef).join() === "MG-M-000A",
  );

  resetDb();
  const restoreA = await call(sf.restoreSession, { sessionId: S.aDel }, ownerA);
  const restoreB = await call(sf.restoreSession, { sessionId: S.bDel }, ownerA);
  ok(
    "R4 restore: binned same-tenant session restored; other-tenant binned session Not found",
    restoreA.ok &&
      db.interview_sessions.find((s) => s.id === S.aDel).deleted_at === null &&
      notFound(restoreB) &&
      db.interview_sessions.find((s) => s.id === S.bDel).deleted_at !== null,
  );

  resetDb();
  const del = await call(sf.deleteSession, { sessionId: S.a2 }, supA);
  const delAgain = await call(sf.deleteSession, { sessionId: S.a2 }, supA);
  const delWrites = writes.filter((w) => w.table === "interview_sessions" && w.method === "UPDATE");
  ok(
    "R5 delete: same-tenant soft delete is tenant-filtered and idempotent",
    del.ok && delAgain.ok && delWrites.length === 1 && /tenant_id=eq\./.test(delWrites[0].filter),
  );

  resetDb();
  const dup = await call(sf.updateCaseRef, { sessionId: S.a1, caseRef: "MG-B-0001" }, ownerA);
  const factFind = await call(sf.updateCaseRef, { sessionId: S.a2, caseRef: "MG-A-5555" }, ownerA);
  ok(
    "R6 case ref: conflict error is generic (does not confirm another tenant's reference)",
    !dup.ok &&
      !/already in use/i.test(dup.message) &&
      leakFree(dup) &&
      !factFind.ok &&
      /fact-find/.test(factFind.message),
    dup.message,
  );

  resetDb();
  const ups = await call(
    cd.upsertCaseMortgageDetails,
    { sessionId: S.a1, currentLender: "Alpha Bank 2", actionableFromDate: "2027-02-01" },
    ownerA,
  );
  const row = db.case_mortgage_details.find((d) => d.session_id === S.a1);
  ok(
    "R7 case details upsert stamps the authorised session tenant",
    ups.ok && row.tenant_id === T.a && row.current_lender === "Alpha Bank 2",
  );

  resetDb();
  const refresh = await call(rel.refreshRelationshipActionableDates, undefined, ownerA);
  const bRow = db.case_mortgage_details.find((d) => d.session_id === S.b1);
  const nRow = db.case_mortgage_details.find((d) => d.session_id === S.nul);
  const aRow = db.case_mortgage_details.find((d) => d.session_id === S.a1);
  ok(
    "R8 relationship refresh only updates acting-tenant rows",
    refresh.ok &&
      refresh.value.updated === 1 &&
      aRow.actionable_from_date &&
      bRow.actionable_note === "bravo-untouched" &&
      !bRow.actionable_from_date &&
      !nRow.actionable_from_date,
    refresh.ok ? `updated=${refresh.value.updated}` : refresh.message,
  );

  resetDb();
  const viewAsB = await call(sf.listMySessions, { viewAsCustomerUserId: U.custB }, ownerA);
  const casesB = await call(sf.listMyCases, { viewAsCustomerUserId: U.custB }, ownerA);
  ok("R9 view-as: other-tenant customer Not found", notFound(viewAsB) && notFound(casesB));

  resetDb();
  globalThis.__S4C2_REQUEST = new Request("http://app.invalid/_serverFn/x", {
    headers: { referer: "http://app.invalid/tenant-a/admin" },
  });
  const legacyMulti = await outcome(() => sf.assertStaffCanAccessCustomer(U.ownerA, U.custMulti));
  const legacyNull = await outcome(() => sf.assertStaffCanAccessCustomer(U.ownerA, U.custNull));
  const legacyA = await outcome(() =>
    sf.assertStaffCanAccessCustomer(U.ownerA, U.custA, { forMutation: true }),
  );
  const legacyB = await outcome(() => sf.assertStaffCanAccessCustomer(U.ownerA, U.custB));
  ok(
    "R10 assertStaffCanAccessCustomer without a session (shared-row writers) refuses customers tied to another tenant; no fallback",
    legacyA.ok && forbidden(legacyMulti) && notFound(legacyNull) && notFound(legacyB),
    [legacyA, legacyMulti, legacyNull, legacyB].map((r) => (r.ok ? "ok" : r.message)).join(" | "),
  );

  resetDb();
  const ja1 = await call(ja.listJourneyAnalyticsLeads, undefined, ownerA);
  const four = ja1.ok ? ja1.value.leads.find((l) => l.id === S.aOther) : null;
  const multi = ja1.ok ? ja1.value.leads.find((l) => l.id === S.mA) : null;
  ok(
    "R11 journey analytics: RAF/introducer signals only from acting-tenant attribution",
    ja1.ok && four?.generator === "raf" && multi && multi.generator !== "introducer",
    ja1.ok ? `four=${four?.generator} multi=${multi?.generator}` : ja1.message,
  );

  resetDb();
  const adv = await call(bf.listAdvisorContacts, undefined, advA);
  ok(
    "R12 adviser contacts: tenantless appointment assigned to the adviser is not shown",
    adv.ok && !has(adv.value, "Nullco Caller") && has(adv.value, "Alpha Callback"),
  );
}

// =============================================================================================
// T16-T18 multi-tenant customer: tenant-specific operations (Rule B) vs shared rows (Rule A)
// =============================================================================================
const seedBravoNote = () =>
  db.advisor_notes.push({
    id: id("f", 2),
    session_id: S.mB,
    tenant_id: T.b,
    advisor_id: U.advB,
    note: "Bravo private note",
    created_at: daysAgo(1),
  });
const noteWrites = () => writes.filter((w) => w.table === "advisor_notes");
{
  resetDb();
  db.advisor_notes = [];
  seedBravoNote();
  const addOwner = await call(sf.addAdvisorNote, { sessionId: S.mA, note: "Alpha note" }, ownerA);
  const addAdv = await call(sf.addAdvisorNote, { sessionId: S.mA, note: "Adviser note" }, advA);
  const addUnalloc = await call(sf.addAdvisorNote, { sessionId: S.mA, note: "x" }, advA2);
  const listOwner = await call(sf.listNotes, { sessionId: S.mA }, ownerA);
  const inserted = noteWrites().filter((w) => w.method === "INSERT");
  ok(
    "T16 multi-tenant customer: Tenant A staff add/list notes on the customer's Tenant A session (allocation still enforced)",
    addOwner.ok &&
      addAdv.ok &&
      !addUnalloc.ok &&
      addUnalloc.message === "This customer is not allocated to you." &&
      listOwner.ok &&
      listOwner.value.length === 2 &&
      inserted.length === 2 &&
      inserted.every((w) => w.row.tenant_id === T.a && w.row.session_id === S.mA),
    [addOwner, addAdv, addUnalloc, listOwner].map((r) => (r.ok ? "ok" : r.message)).join(" | "),
  );

  resetDb();
  db.advisor_notes = [];
  seedBravoNote();
  const listA = await call(sf.listNotes, { sessionId: S.mA }, ownerA);
  const listB = await call(sf.listNotes, { sessionId: S.mB }, ownerA);
  const listRandom = await call(sf.listNotes, { sessionId: RANDOM }, ownerA);
  const listNull = await call(sf.listNotes, { sessionId: S.nul }, ownerA);
  const addB = await call(sf.addAdvisorNote, { sessionId: S.mB, note: "probe" }, ownerA);
  const hub = await call(sf.getCustomerHub, { customerId: U.custMulti }, ownerA);
  ok(
    "T17 multi-tenant customer's Tenant B relationship stays invisible while acting in Tenant A",
    listA.ok &&
      !has(listA.value, "Bravo private note") &&
      notFound(listB) &&
      notFound(addB) &&
      noteWrites().length === 0 &&
      hub.ok &&
      !has(hub.value, S.mB) &&
      !has(hub.value, "MG-M-000B") &&
      !has(hub.value, "Bravo") &&
      [listB, listRandom, listNull, addB].every((r) => notFound(r) && leakFree(r)),
    [listB, listRandom, listNull, addB].map((r) => (r.ok ? "ok" : r.message)).join(" | "),
  );

  resetDb();
  db.advisor_notes = [];
  const bListA = await call(sf.listNotes, { sessionId: S.mA }, ownerB);
  const bAddA = await call(sf.addAdvisorNote, { sessionId: S.a1, note: "probe" }, ownerB);
  const bHubA = await call(sf.getCustomerHub, { customerId: U.custA }, ownerB);
  const dualBListA = await call(sf.listNotes, { sessionId: S.mA }, dualB);
  const dualNoneList = await call(sf.listNotes, { sessionId: S.mA }, dualNone);
  const bListOwn = await call(sf.listNotes, { sessionId: S.mB }, ownerB);
  ok(
    "T18 a relationship in Tenant A is never an authority source in Tenant B (customer, owner or dual-tenant actor)",
    notFound(bListA) &&
      notFound(bAddA) &&
      notFound(bHubA) &&
      notFound(dualBListA) &&
      !dualNoneList.ok &&
      bListOwn.ok &&
      noteWrites().length === 0,
    [bListA, bAddA, bHubA, dualBListA, dualNoneList, bListOwn]
      .map((r) => (r.ok ? "ok" : r.message))
      .join(" | "),
  );

  resetDb();
  globalThis.__S4C2_REQUEST = new Request("http://app.invalid/_serverFn/x", {
    headers: { referer: "http://app.invalid/tenant-a/admin" },
  });
  const withA = await outcome(() =>
    sf.assertStaffCanAccessCustomer(U.ownerA, U.custMulti, { forMutation: true, sessionId: S.mA }),
  );
  const withB = await outcome(() =>
    sf.assertStaffCanAccessCustomer(U.ownerA, U.custMulti, { forMutation: true, sessionId: S.mB }),
  );
  const mismatch = await outcome(() =>
    sf.assertStaffCanAccessCustomer(U.ownerA, U.custMulti, { sessionId: S.a1 }),
  );
  const noSession = await outcome(() =>
    sf.assertStaffCanAccessCustomer(U.ownerA, U.custMulti, { forMutation: true }),
  );
  db.tenant_memberships.push({
    id: randomUUID(),
    user_id: U.custA4,
    tenant_id: T.b,
    role: "customer",
    active: true,
  });
  const membershipOnly = await outcome(() =>
    sf.assertStaffCanAccessCustomer(U.ownerA, U.custA4, { forMutation: true }),
  );
  const membershipOnlySession = await outcome(() =>
    sf.assertStaffCanAccessCustomer(U.ownerA, U.custA4, {
      forMutation: true,
      sessionId: S.aOther,
    }),
  );
  ok(
    "R13 session-proven staff access ignores other-tenant relationships; shared-row callers (no session) refuse any other-tenant tie incl. membership-only",
    withA.ok &&
      notFound(withB) &&
      notFound(mismatch) &&
      forbidden(noSession) &&
      leakFree(noSession) &&
      forbidden(membershipOnly) &&
      membershipOnlySession.ok,
    [withA, withB, mismatch, noSession, membershipOnly, membershipOnlySession]
      .map((r) => (r.ok ? "ok" : r.message))
      .join(" | "),
  );

  resetDb();
  db.advisor_notes = [];
  const roList = await call(sf.listNotes, { sessionId: S.a1 }, platRO);
  const roAdd = await call(sf.addAdvisorNote, { sessionId: S.a1, note: "probe" }, platRO);
  const opAdd = await call(sf.addAdvisorNote, { sessionId: S.a1, note: "ops" }, platOp);
  const roOtherTenant = await call(sf.listNotes, { sessionId: S.b1 }, platRO);
  ok(
    "R14 explicit platform entry: read-only lists notes, cannot add; operational can add; never beyond the entered tenant",
    roList.ok && !roAdd.ok && opAdd.ok && notFound(roOtherTenant),
    [roList, roAdd, opAdd, roOtherTenant].map((r) => (r.ok ? "ok" : r.message)).join(" | "),
  );
}

// =============================================================================================
// T13 business identity fingerprints unchanged across the whole battery
// =============================================================================================
{
  resetDb();
  const before = fingerprint();
  const battery = [];
  const actors = [
    ownerA,
    supA,
    advA,
    advA2,
    ownerB,
    dualA,
    dualNone,
    introA,
    generalA,
    platRO,
    platOp,
  ];
  for (const actor of actors) {
    for (const [, fn, payload] of sessionOps) {
      for (const sid of [S.a1, S.a2, S.aDel, S.b1, S.bDel, S.nul, RANDOM])
        battery.push(() => call(fn, payload(sid), actor));
    }
    for (const [, fn, payload] of customerOps) {
      for (const cid of [U.custA, U.custB, U.custMulti, U.custNull, U.custA3, RANDOM])
        battery.push(() => call(fn, payload(cid), actor));
    }
    for (const [sid, cid] of [
      [S.a2, U.custA],
      [S.b1, U.custB],
      [S.nul, U.custNull],
      [S.aOther, U.custA],
    ]) {
      battery.push(() => call(sf.promoteSessionToCaseAsStaff, promote(sid, cid), actor));
    }
    for (const sid of [S.a1, S.mA, S.mB, S.b1, S.nul, RANDOM]) {
      battery.push(() => call(sf.listNotes, { sessionId: sid }, actor));
      battery.push(() => call(sf.addAdvisorNote, { sessionId: sid, note: "battery" }, actor));
    }
    for (const [fn, data] of [
      [bf.listAdvisorContacts, undefined],
      [rf.searchCustomers, { query: "Customer" }],
      [rf.listReferralLinks, undefined],
      [rf.listAllReferrals, undefined],
      [sf.listBinnedStaff, undefined],
      [va.listViewAsAuditLog, { viewType: "customer" }],
      [rel.listRelationshipPipeline, {}],
      [rel.refreshRelationshipActionableDates, undefined],
      [ja.listJourneyAnalyticsLeads, undefined],
    ]) {
      battery.push(() => call(fn, data, actor));
    }
  }
  // call() sets a global request per invocation, so run sequentially.
  let n = 0;
  for (const run of battery) {
    await run();
    n += 1;
  }
  const after = fingerprint();
  ok(
    "T13 business identity fingerprints unchanged (Auth ids, memberships, adviser/introducer codes, ownership, attribution, referrals, commission)",
    before === after,
    `${n} calls; ${before.slice(0, 12)} → ${after.slice(0, 12)}`,
  );
}

// =============================================================================================
// Static: canonical layer used by every S4C2 entry point
// =============================================================================================
{
  const files = {
    sessions: code("src/lib/sessions.functions.ts"),
    caseDetails: code("src/lib/case-details.functions.ts"),
    relationship: code("src/lib/relationship.functions.ts"),
    journey: code("src/lib/journey-analytics.functions.ts"),
    booking: code("src/lib/booking.functions.ts"),
    referrals: code("src/lib/referrals.functions.ts"),
    viewAs: code("src/lib/view-as-audit.functions.ts"),
  };
  function exportBlock(src, name) {
    const start = src.indexOf(`export const ${name} = createServerFn`);
    if (start < 0) return "";
    const rest = src.slice(start + 1);
    const next = rest.search(/\n(?=[A-Za-z])/);
    return src.slice(start, next < 0 ? undefined : start + 1 + next);
  }
  const entries = [
    ["sessions", "listMySessions"],
    ["sessions", "listMyCases"],
    ["sessions", "updateCaseRef"],
    ["sessions", "deleteSession"],
    ["sessions", "restoreSession"],
    ["sessions", "promoteSessionToCaseAsStaff"],
    ["sessions", "getCustomerHub"],
    ["sessions", "updateCustomerContact"],
    ["caseDetails", "getCaseMortgageDetails"],
    ["caseDetails", "upsertCaseMortgageDetails"],
    ["relationship", "listRelationshipPipeline"],
    ["relationship", "refreshRelationshipActionableDates"],
    ["journey", "listJourneyAnalyticsLeads"],
    ["booking", "listAdvisorContacts"],
    ["referrals", "searchCustomers"],
    ["referrals", "listReferralLinks"],
    ["referrals", "listAllReferrals"],
    ["sessions", "listBinnedStaff"],
    ["viewAs", "listViewAsAuditLog"],
  ];
  const canonical =
    /\b(authoriseTenantResource|authoriseTenantResources|authoriseTenantCustomer|resolveActingTenantForList)\b/;
  const bad = entries.filter(([f, name]) => {
    const block = exportBlock(files[f], name);
    return (
      !block ||
      !canonical.test(block) ||
      /resolveAdminAccess|actingTenantStaffFlags|loadTenantRoleForTenantId|resolveActingTenantRole/.test(
        block,
      )
    );
  });
  ok(
    "S1 all 19 S4C2 entry points use the canonical helper layer (no legacy role resolution)",
    bad.length === 0,
    bad.length ? bad.map(([, n]) => n).join(",") : "19/19",
  );
  const taSrc = code("src/lib/tenant-assert.server.ts");
  ok(
    "S2 canonical helpers exported from tenant-assert.server.ts",
    [
      "authoriseTenantResource",
      "authoriseTenantResources",
      "requireTargetMemberInTenant",
      "resolveActingTenantForList",
      "authoriseTenantCustomer",
      "assertCustomerGlobalProfileEditable",
      "assertNoOtherTenantCustomerRelationship",
    ].every((n) => new RegExp(`export async function ${n}\\(`).test(taSrc)),
  );
  const section = taSrc.slice(taSrc.indexOf("export const RESOURCE_NOT_FOUND_MESSAGE"));
  ok(
    "S3 acting tenant resolved without any caller-supplied tenant id/slug",
    /resolveActingTenantRole\(userId\)/.test(section) &&
      !/resolveActingTenantRole\(userId,/.test(section),
  );
  const assertStaff =
    files.sessions
      .split("export async function assertStaffCanAccessCustomer(")[1]
      ?.split("\n}\n")[0] ?? "";
  ok(
    "S4 assertStaffCanAccessCustomer: canonical relationship check, session proof when given, shared-row guard otherwise; no tenant fallback",
    /authoriseTenantCustomer\(\{/.test(assertStaff) &&
      /authoriseTenantResource\(\{/.test(assertStaff) &&
      /assertNoOtherTenantCustomerRelationship\(/.test(assertStaff) &&
      !/resolveActingTenantRole|loadTenantRoleForTenantId/.test(assertStaff),
  );
  const notesBlocks = ["addAdvisorNote", "listNotes"].map((n) => exportBlock(files.sessions, n));
  ok(
    "S7 notes are authorised per session (tenant-specific), not by the customer-wide shared-row guard",
    notesBlocks.every((b) =>
      /assertStaffCanAccessCustomer\([\s\S]{0,160}sessionId: sess\.sessionId/.test(b),
    ),
  );
  const status = execFileSync("git", ["status", "--porcelain", "--", "supabase/migrations"], {
    cwd: root,
    encoding: "utf8",
  });
  ok("S5 no migration created", status.trim() === "");
}

// --- target member helper -----------------------------------------------------------------------
{
  resetDb();
  const inA = await outcome(() => ta.requireTargetMemberInTenant(U.advA, T.a, ["adviser"]));
  const inB = await outcome(() => ta.requireTargetMemberInTenant(U.advB, T.a, ["adviser"]));
  const wrongRole = await outcome(() => ta.requireTargetMemberInTenant(U.custA, T.a, ["adviser"]));
  ok(
    "S6 requireTargetMemberInTenant: same-tenant member passes; other-tenant / wrong role Not found",
    inA.ok && notFound(inB) && notFound(wrongRole),
  );
}

const refused = unknownCalls.filter(
  (c) => !c.startsWith("refused host") && !c.startsWith("rpc allocate_case_ref"),
);
ok("N1 no unstubbed backend calls", refused.length === 0, refused.slice(0, 5).join(", "));

if (process.env.G7F4S4C2_DEBUG) process.stderr.write(`${logs.join("\n")}\n`);
console.log(`\n${total - failures.length}/${total} PASS`);
if (failures.length) {
  process.stderr.write(`FAILED: ${failures.join(", ")}\n`);
  process.exit(1);
}
