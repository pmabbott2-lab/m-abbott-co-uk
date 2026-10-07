/**
 * G7F-4S4C4-B3 customer introducer attribution tenant boundary — offline verification.
 *
 * Attribution is keyed by (tenant, customer). The real B3 migration is applied verbatim to an
 * in-process PostgreSQL (PGlite, WASM) holding a stub of the staging schema at the pre-B3 shape
 * (A2 introducer keys, the G6b link policy verbatim), seeded with the staging link pattern
 * (stamped rows plus provable tenantless legacy rows). The real server-function validators and
 * handlers (booking, introducer lookup/read/amend/refresh, customer hub, owner report, journey
 * analytics) then run against it through a fake PostgREST/Auth layer on a non-routable host;
 * service-role requests execute as the `service_role` database role, so grants are enforced.
 *
 * Every negative control mutates real source or the real migration, demonstrates the unsafe
 * effect on the database, and shows the corresponding test predicate rejects the mutant.
 *
 * Synthetic fixtures only: no network, no staging, no production, no real user, no real token.
 * Stubbed (not under test): MFA freshness, Super Owner gate, platform Enter Company sessions,
 * SMS delivery.
 *
 * PGlite: npm install --prefix /tmp/g7f4s3b/pglite @electric-sql/pglite@0.5.8
 * Run: npm exec --yes --package=tsx -- tsx scripts/g7f4s4c4b3-attribution-tenant-boundary-verify.mjs
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire, register } from "node:module";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
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
    return { ok: false, error: e, message: String(e?.message ?? e), code: e?.code };
  }
}
const read = (rel) => readFileSync(resolve(root, rel), "utf8");
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
const describe = (...rs) => rs.map((r) => (r?.ok ? "ok" : (r?.message ?? String(r)))).join(" | ");

const B3_REL =
  "supabase/migrations/20261007120000_gate_g7f4s4c4b3_customer_introducer_attribution_tenant_key.sql";
const G6B_REL = "supabase/migrations/20260918200000_gate_g6b_enable_rls_six_unprotected_tables.sql";
const BOOKING_REL = "src/lib/booking.functions.ts";
const ATTR_REL = "src/lib/introducer-attribution.ts";
const IC_REL = "src/lib/introducer-customer.functions.ts";
const SESS_REL = "src/lib/sessions.functions.ts";
const JOURNEY_REL = "src/lib/journey-analytics.functions.ts";
const FINANCE_REL = "src/lib/finance.functions.ts";
const REFERRALS_REL = "src/lib/referrals.functions.ts";
const B2B_VERIFIER = "scripts/g7f4s4c4b2b-lifecycle-tenant-boundary-verify.mjs";
const SELF_REL = "scripts/g7f4s4c4b3-attribution-tenant-boundary-verify.mjs";
const AUTHORISED = [B3_REL, ATTR_REL, IC_REL, BOOKING_REL, SESS_REL, JOURNEY_REL, SELF_REL];

const b3Sql = read(B3_REL);
const linkPolicySql = read(G6B_REL).match(
  /DROP POLICY IF EXISTS "Read customer introducer links"[\s\S]*?\n {2}\);/,
)?.[0];

// --- module stubs ------------------------------------------------------------------------------
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
export function getRequest() { return globalThis.__B3_REQUEST ?? null; }
export function getCookie() { return undefined; }
export function setCookie() {}
export function deleteCookie() {}
`;
const stubPlatform = `
export async function validatePlatformTenantAccessSession() { return null; }
export async function hasValidPlatformTenantAccess() { return false; }
export async function clearPlatformTenantEntryOnLogout() {}
`;
const stubSms = `
export * from ${JSON.stringify(fileUrl("src/lib/sms.server.ts"))};
export async function sendSms(opts) {
  (globalThis.__B3_SMS ??= []).push({ to: opts.to });
  return { sid: "SMxB3" + String(globalThis.__B3_SMS.length) };
}
`;
const stubMfa = `
export * from ${JSON.stringify(fileUrl("src/lib/privileged-mfa.server.ts"))};
export async function requireFreshPrivilegedAuth() {}
export async function requirePlatformAal2() {}
`;
const ATTR_EXPORTS = [
  "getTenantAttribution",
  "snapshotTenantCustomerState",
  "createTenantAttributionIfEligible",
  "resolveTenantIntroducerByCode",
  "resolveIntroducerIdForCustomerAtDate",
];
/** "@/lib/introducer-attribution" for every importer: the real module unless a mutant is armed. */
const attrSwitch = `
import * as real from ${JSON.stringify(fileUrl(ATTR_REL))};
const pick = (k) => (...a) => ((globalThis.__B3_ATTR && globalThis.__B3_ATTR[k]) || real[k])(...a);
${ATTR_EXPORTS.map((k) => `export const ${k} = pick(${JSON.stringify(k)});`).join("\n")}
export const NO_ACTIVE_INTRODUCER_FOR_CODE_MESSAGE = real.NO_ACTIVE_INTRODUCER_FOR_CODE_MESSAGE;
`;
const MUTANT_KEYS = {
  booking: fileUrl(BOOKING_REL),
  attr: fileUrl(ATTR_REL),
  ic: fileUrl(IC_REL),
};
const mutantMark = (key) => `/*b3-mutant:${key}*/`;
const hookSource = `
const MUTANTS = ${JSON.stringify(
  Object.fromEntries(Object.entries(MUTANT_KEYS).map(([k, v]) => [dataUrl(mutantMark(k)), v])),
)};
const STUBS = {
  start: ${JSON.stringify(dataUrl(stubStart))},
  startServer: ${JSON.stringify(dataUrl(stubStartServer))},
  platform: ${JSON.stringify(dataUrl(stubPlatform))},
  sms: ${JSON.stringify(dataUrl(stubSms))},
  mfa: ${JSON.stringify(dataUrl(stubMfa))},
  attr: ${JSON.stringify(dataUrl(attrSwitch))},
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
  const fromData = parent.startsWith("data:");
  if (fromData) return next(specifier, context);
  if (specifier === "@tanstack/react-start") return { url: STUBS.start, shortCircuit: true };
  if (specifier === "@tanstack/react-start/server") return { url: STUBS.startServer, shortCircuit: true };
  if (/platform-tenant-entry\\.server(\\.ts)?$/.test(specifier)) return { url: STUBS.platform, shortCircuit: true };
  if (/(^|\\/)sms\\.server(\\.ts)?$/.test(specifier)) return { url: STUBS.sms, shortCircuit: true };
  if (/(^|\\/)privileged-mfa\\.server(\\.ts)?$/.test(specifier)) return { url: STUBS.mfa, shortCircuit: true };
  // tsx rewrites "@/" aliases to absolute file URLs before this hook sees them.
  if (specifier === "@/lib/introducer-attribution" || /\\/src\\/lib\\/introducer-attribution(\\.ts)?(\\?.*)?$/.test(specifier)) {
    return { url: STUBS.attr, shortCircuit: true };
  }
  return next(specifier, context);
}
`;
register(dataUrl(hookSource), import.meta.url);

// --- PGlite ------------------------------------------------------------------------------------
const pgliteDir = process.env.G7F4S3B_PGLITE_DIR || "/tmp/g7f4s3b/pglite";
let PGlite;
try {
  const req = createRequire(join(pgliteDir, "package.json"));
  ({ PGlite } = await import(pathToFileURL(req.resolve("@electric-sql/pglite")).href));
} catch (e) {
  console.error(`FAIL  PGlite not found in ${pgliteDir} (${e.message}). See header for install.`);
  process.exit(1);
}
/** The database the fake PostgREST serves. */
let pg = null;
/** Requests run one at a time; direct test SQL on the served database queues behind them. */
const inRequest = new AsyncLocalStorage();
let chain = Promise.resolve();
function serial(fn) {
  const p = chain.then(fn);
  chain = p.catch(() => {});
  return p;
}
const onServed = (db, fn) => (db === pg && !inRequest.getStore() ? serial(fn) : fn());
const sqlOn = (db, q, params = []) => onServed(db, async () => (await db.query(q, params)).rows);
const execOn = (db, text) => onServed(db, () => db.exec(text));
const sql = (q, params = []) => sqlOn(pg, q, params);
const one = async (q, params = []) => (await sql(q, params))[0] ?? null;

const BASE_SCHEMA = `
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth;
grant usage on schema auth to anon, authenticated, service_role;
create table auth.users (
  id uuid primary key, email text, email_confirmed_at timestamptz,
  raw_app_meta_data jsonb not null default '{}', raw_user_meta_data jsonb not null default '{}',
  banned_until timestamptz, deleted_at timestamptz, is_anonymous boolean not null default false,
  created_at timestamptz not null default clock_timestamp()
);
grant select, delete on auth.users to service_role;
create or replace function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant execute on function auth.uid() to anon, authenticated, service_role;

create type public.app_role as enum ('customer','advisor','introducer','admin');
create type public.tenant_member_role as enum ('owner','supervisor','general','adviser','introducer','customer');
create type public.admin_level as enum ('owner','supervisor','general');
create type public.tenant_status as enum ('provisioning','active','suspended','archived');
create type public.platform_role as enum ('super_owner','super_admin');

create table public.tenants (
  id uuid primary key, company_code text not null unique, slug text not null unique,
  company_name text not null, status public.tenant_status not null default 'active',
  tenant_type text not null default 'EXTERNAL'
);
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade, email text, full_name text,
  phone text, tenant_id uuid, address text, date_of_birth date,
  created_at timestamptz not null default now()
);
create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.app_role not null, created_at timestamptz not null default now(), unique (user_id, role)
);
create table public.tenant_memberships (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id),
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.tenant_member_role not null,
  active boolean not null default true, created_by uuid, created_at timestamptz not null default now(),
  constraint tenant_memberships_user_tenant_role_unique unique (user_id, tenant_id, role)
);
create table public.admin_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  level public.admin_level not null default 'general',
  tenant_id uuid, granted_by uuid, created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.admin_permissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  permission_key text not null, access text not null, tenant_id uuid
);
create table public.advisor_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade, code text not null unique,
  deleted_at timestamptz, tenant_id uuid, teams_calendar_enabled boolean not null default false,
  created_at timestamptz not null default now()
);
create table public.platform_roles (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id),
  role public.platform_role not null, created_by uuid, created_at timestamptz not null default now(),
  unique (user_id, role)
);
create table public.platform_break_glass_identities (user_id uuid primary key);

-- staging shape of public.introducers after G7F-4S4C4-A2
create table public.introducers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  company_name text not null,
  slug text not null,
  contact_email text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  company_code text,
  deleted_at timestamptz,
  tenant_id uuid references public.tenants(id),
  constraint introducers_slug_key unique (slug),
  constraint introducers_slug_format check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  constraint introducers_company_code_format check (company_code is null or company_code ~ '^[0-9]{4}$'),
  constraint introducers_id_tenant_id_key unique (id, tenant_id),
  constraint introducers_tenant_id_user_id_key unique nulls not distinct (tenant_id, user_id)
);
create index idx_introducers_company_code on public.introducers (company_code);
create index introducers_user_id_idx on public.introducers (user_id);
alter table public.introducers enable row level security;
create policy "Introducers view own registration" on public.introducers
  for select to authenticated using (user_id = auth.uid());

create table public.commission_rates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('advisor','introducer')),
  percentage numeric not null default 0,
  updated_by uuid, updated_at timestamptz not null default now(),
  pct_fee numeric, pct_mortgage_fee numeric, pct_insurance_fee numeric, pct_other_fee numeric,
  tenant_id uuid references public.tenants(id),
  constraint commission_rates_tenant_id_user_id_role_key unique nulls not distinct (tenant_id, user_id, role)
);
create table public.commission_rate_history (
  id uuid primary key default gen_random_uuid(), user_id uuid, role text, fee_type text,
  pct_from numeric, pct_to numeric, changed_by uuid, tenant_id uuid,
  created_at timestamptz not null default now()
);

create table public.interview_sessions (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references auth.users(id) on delete cascade,
  tenant_id uuid references public.tenants(id),
  case_ref text, status text not null default 'in_progress', channel text,
  started_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  submitted_at timestamptz, deleted_at timestamptz, current_section text, current_question_index int
);
create table public.interview_answers (
  id uuid primary key default gen_random_uuid(), session_id uuid not null, question_id text, value jsonb
);
create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  advisor_id uuid not null references auth.users(id),
  introducer_id uuid references public.introducers(id) on delete set null,
  lead_id uuid, session_id uuid references public.interview_sessions(id) on delete set null,
  customer_name text not null, customer_phone text, customer_email text,
  starts_at timestamptz not null, ends_at timestamptz, status text not null default 'confirmed',
  lead_source text, referral_channel text, notes text,
  tenant_id uuid references public.tenants(id), created_at timestamptz not null default now()
);
create table public.introducer_leads (
  id uuid primary key default gen_random_uuid(),
  introducer_id uuid not null references public.introducers(id) on delete cascade,
  customer_name text not null default 'Lead', customer_email text, customer_phone text,
  session_id uuid, appointment_id uuid, status text, tenant_id uuid references public.tenants(id),
  created_at timestamptz not null default now()
);
create table public.session_advisors (
  id uuid primary key default gen_random_uuid(), session_id uuid not null, advisor_id uuid not null,
  assigned_by uuid, tenant_id uuid, created_at timestamptz not null default now(),
  unique (session_id, advisor_id)
);
create table public.customer_contact_log (
  id uuid primary key default gen_random_uuid(), session_id uuid not null, author_id uuid,
  entry_type text not null, body text, occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(), amended_at timestamptz, amended_by uuid,
  original_body text, is_deleted boolean not null default false, tenant_id uuid
);

create table public.finance_audit_log (
  id uuid primary key default gen_random_uuid(), audit_type text not null,
  subject_user_id uuid references auth.users(id) on delete set null,
  customer_id uuid references auth.users(id) on delete set null,
  session_id uuid references public.interview_sessions(id) on delete set null,
  role text, fee_type text, summary text not null, detail jsonb,
  changed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(), tenant_id uuid references public.tenants(id)
);
create table public.finance_ledger (
  id uuid primary key default gen_random_uuid(), session_id uuid, fee_line_id uuid, kind text,
  fee_type text, amount_pence int, is_reversal boolean not null default false,
  beneficiary_user_id uuid, beneficiary_role text, commission_pct numeric, payout_status text,
  note text, created_by uuid, tenant_id uuid, created_at timestamptz not null default now()
);
create table public.finance_fee_lines (
  id uuid primary key default gen_random_uuid(), session_id uuid, fee_type text, amount_pence int,
  tenant_id uuid, created_at timestamptz not null default now()
);
create table public.finance_settings (
  id uuid primary key default gen_random_uuid(), tenant_id uuid, settings jsonb
);
create table public.referral_codes (
  id uuid primary key default gen_random_uuid(), referrer_user_id uuid, code text, tenant_id uuid
);
create table public.referrals (
  id uuid primary key default gen_random_uuid(), referred_user_id uuid, status text,
  tenant_id uuid, referral_code_id uuid, created_at timestamptz not null default now()
);

-- staging shape of public.customer_introducer_links before B3 (column order as staging)
create table public.customer_introducer_links (
  customer_id uuid not null references auth.users(id) on delete cascade,
  introducer_id uuid not null,
  source text,
  created_at timestamptz not null default now(),
  effective_from timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  tenant_id uuid references public.tenants(id),
  constraint customer_introducer_links_pkey primary key (customer_id),
  constraint customer_introducer_links_introducer_id_fkey foreign key (introducer_id)
    references public.introducers(id) on delete cascade
);
create index idx_customer_introducer_links_introducer on public.customer_introducer_links (introducer_id);
create index customer_introducer_links_tenant_id_idx on public.customer_introducer_links (tenant_id);

-- staging shape of public.introducer_amendment_history before B3 (column order as staging)
create table public.introducer_amendment_history (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid references public.interview_sessions(id) on delete set null,
  previous_introducer_id uuid references public.introducers(id) on delete set null,
  new_introducer_id uuid references public.introducers(id) on delete set null,
  company_code text, company_name text,
  effective_from timestamptz not null default now(),
  commission_refreshed boolean not null default false,
  changed_by uuid references auth.users(id) on delete set null,
  note text,
  created_at timestamptz not null default now(),
  tenant_id uuid references public.tenants(id)
);
create index idx_introducer_amendment_customer on public.introducer_amendment_history (customer_id, effective_from desc);
create index introducer_amendment_history_tenant_id_idx on public.introducer_amendment_history (tenant_id);

create or replace function public.has_role(_user_id uuid, _role public.app_role) returns boolean
  language sql stable security definer set search_path = public as
  $$ select exists (select 1 from public.user_roles where user_id = _user_id and role = _role) $$;
create or replace function public.has_tenant_membership(p_user_id uuid, p_tenant_id uuid) returns boolean
  language sql stable security definer set search_path = public as
  $$ select p_user_id is not null and exists (select 1 from public.tenant_memberships m
       where m.user_id = p_user_id and m.tenant_id = p_tenant_id and m.active) $$;
create or replace function public.auth_is_tenant_admin(p_tenant_id uuid) returns boolean
  language sql stable security definer set search_path = public as
  $$ select p_tenant_id is not null and auth.uid() is not null and exists (
       select 1 from public.tenant_memberships m where m.user_id = auth.uid()
       and m.tenant_id = p_tenant_id and m.active and m.role in ('owner','supervisor','general')) $$;
create or replace function public.auth_is_tenant_staff(p_tenant_id uuid) returns boolean
  language sql stable security definer set search_path = public as
  $$ select p_tenant_id is not null and auth.uid() is not null and exists (
       select 1 from public.tenant_memberships m where m.user_id = auth.uid()
       and m.tenant_id = p_tenant_id and m.active and m.role in ('owner','supervisor','general','adviser')) $$;
create or replace function public.auth_is_tenant_introducer(p_tenant_id uuid) returns boolean
  language sql stable security definer set search_path = public as
  $$ select p_tenant_id is not null and auth.uid() is not null and exists (
       select 1 from public.tenant_memberships m where m.user_id = auth.uid()
       and m.tenant_id = p_tenant_id and m.active and m.role = 'introducer') $$;
create or replace function public.has_active_support_data_access(p_user_id uuid, p_tenant_id uuid)
  returns boolean language sql stable as $$ select false $$;
create or replace function public.is_tenant_feature_enabled(p_tenant_id uuid, p_feature_key text)
  returns boolean language sql stable security definer set search_path = public as
  $$ select exists (select 1 from public.tenants t where t.id = p_tenant_id and t.status = 'active') $$;
create sequence public.case_ref_seq;
create or replace function public.allocate_case_ref() returns text language sql as
  $$ select 'MG-B3-' || lpad(nextval('public.case_ref_seq')::text, 4, '0') $$;

alter table public.customer_introducer_links enable row level security;
alter table public.introducer_amendment_history enable row level security;
alter table public.finance_audit_log enable row level security;
create policy "Admins read introducer amendment history" on public.introducer_amendment_history
  for select to authenticated using (public.auth_is_tenant_admin(tenant_id));
create policy "Admins read finance audit" on public.finance_audit_log
  for select to authenticated using (public.auth_is_tenant_admin(tenant_id));

-- staging privileges: service_role all, authenticated read; API roles get EXECUTE by default.
grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to service_role;
grant select on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to service_role;
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
`;

// --- fixtures ----------------------------------------------------------------------------------
const T = { a: randomUUID(), b: randomUUID(), c: randomUUID() };
const SLUG = { a: "tenant-a", b: "tenant-b", c: "tenant-c" };
const U = {};
const I = {};
const L = {};
let userSeq = 0;
const now = Date.now();
let slotCounter = 0;
function nextSlot() {
  slotCounter += 1;
  const t = new Date(now + (20 + slotCounter) * 86400000);
  t.setUTCHours(10, 0, 0, 0);
  return t.toISOString();
}

async function insertRow(db, table, row) {
  const cols = Object.keys(row);
  const res = await sqlOn(
    db,
    `insert into ${table} (${cols.map((c) => `"${c}"`).join(", ")}) values (${cols
      .map((_, i) => `$${i + 1}`)
      .join(", ")}) returning *`,
    cols.map((c) =>
      row[c] !== null && typeof row[c] === "object" ? JSON.stringify(row[c]) : row[c],
    ),
  );
  return res[0];
}
async function addUser(db, label, fullName = label) {
  userSeq += 1;
  const id = randomUUID();
  const email = `${label.toLowerCase().replace(/[^a-z0-9]+/g, ".")}.${userSeq}@example.test`;
  await insertRow(db, "auth.users", { id, email, email_confirmed_at: new Date().toISOString() });
  await insertRow(db, "public.profiles", { id, email, full_name: fullName });
  return id;
}
async function addMember(db, userId, tenantId, role) {
  await insertRow(db, "public.tenant_memberships", { tenant_id: tenantId, user_id: userId, role });
}
async function addIntroducer(
  db,
  { tenantId, code = null, name, slug, active = true, deleted = false, userId },
) {
  const uid = userId ?? (await addUser(db, `intro ${slug}`));
  const row = await insertRow(db, "public.introducers", {
    user_id: uid,
    tenant_id: tenantId,
    company_code: code,
    company_name: name,
    slug,
    active,
    deleted_at: deleted ? new Date().toISOString() : null,
  });
  return row.id;
}
async function addSession(db, { customerId, tenantId, caseRef = null, deleted = false }) {
  const row = await insertRow(db, "public.interview_sessions", {
    customer_id: customerId,
    tenant_id: tenantId,
    case_ref: caseRef,
    deleted_at: deleted ? new Date().toISOString() : null,
  });
  return row.id;
}
async function addAppointment(db, { sessionId, tenantId, advisorId, introducerId = null }) {
  const row = await insertRow(db, "public.appointments", {
    session_id: sessionId,
    tenant_id: tenantId,
    advisor_id: advisorId,
    introducer_id: introducerId,
    customer_name: "Synthetic Customer",
    starts_at: nextSlot(),
  });
  return row.id;
}

/** A fresh database at the staging pre-B3 state, seeded with the staging link pattern. */
async function stagingDb() {
  const db = await PGlite.create();
  await db.exec(BASE_SCHEMA);
  await db.exec(linkPolicySql);
  await sqlOn(
    db,
    `insert into public.tenants (id, company_code, slug, company_name, status) values
     ($1,'901',$4,'Tenant A Ltd','active'), ($2,'902',$5,'Tenant B Ltd','active'),
     ($3,'903',$6,'Tenant C Ltd','suspended')`,
    [T.a, T.b, T.c, SLUG.a, SLUG.b, SLUG.c],
  );
  const adv = await addUser(db, "legacy adviser");
  await addMember(db, adv, T.a, "adviser");
  const ia = await addIntroducer(db, {
    tenantId: T.a,
    code: "1001",
    name: "Alpha Introducers",
    slug: "intro-a",
  });
  const ib = await addIntroducer(db, {
    tenantId: T.b,
    code: "2001",
    name: "Bravo Introducers",
    slug: "intro-b",
  });
  const cust = {};
  for (const k of ["l1", "l2", "l3", "l4", "l5"]) cust[k] = await addUser(db, `legacy ${k}`);
  await addMember(db, cust.l1, T.a, "customer");
  await addMember(db, cust.l2, T.b, "customer");
  await insertRow(db, "public.customer_introducer_links", {
    customer_id: cust.l1,
    introducer_id: ia,
    tenant_id: T.a,
    source: "staging-synthetic",
  });
  await insertRow(db, "public.customer_introducer_links", {
    customer_id: cust.l2,
    introducer_id: ib,
    tenant_id: T.b,
    source: "booking",
  });
  for (const k of ["l3", "l4", "l5"]) {
    await insertRow(db, "public.customer_introducer_links", {
      customer_id: cust[k],
      introducer_id: ia,
      tenant_id: null,
      source: "booking",
    });
    const s = await addSession(db, { customerId: cust[k], tenantId: null });
    await addAppointment(db, { sessionId: s, tenantId: T.a, advisorId: adv, introducerId: ia });
  }
  await insertRow(db, "public.introducer_amendment_history", {
    customer_id: cust.l2,
    new_introducer_id: ib,
    company_code: "2001",
    company_name: "Bravo Introducers",
    tenant_id: T.b,
  });
  await insertRow(db, "public.introducer_amendment_history", {
    customer_id: cust.l1,
    new_introducer_id: ia,
    company_code: "1001",
    company_name: "Alpha Introducers",
    tenant_id: T.a,
  });
  await insertRow(db, "public.finance_audit_log", {
    audit_type: "seed",
    summary: "seed",
    tenant_id: T.a,
  });
  await insertRow(db, "public.finance_ledger", {
    kind: "commission",
    amount_pence: 1000,
    tenant_id: T.a,
  });
  await insertRow(db, "public.finance_fee_lines", {
    fee_type: "mortgage",
    amount_pence: 50000,
    tenant_id: T.a,
  });
  await insertRow(db, "public.finance_settings", { tenant_id: T.a, settings: { vat: false } });
  await insertRow(db, "public.commission_rates", {
    user_id: adv,
    role: "advisor",
    percentage: 10,
    tenant_id: T.a,
  });
  await insertRow(db, "public.commission_rate_history", {
    user_id: adv,
    role: "advisor",
    tenant_id: T.a,
  });
  const code = await insertRow(db, "public.referral_codes", {
    referrer_user_id: cust.l1,
    code: "SEED",
    tenant_id: T.a,
  });
  await insertRow(db, "public.referrals", {
    referred_user_id: cust.l2,
    status: "pending",
    tenant_id: T.a,
    referral_code_id: code.id,
  });
  return { db, adv, ia, ib, cust };
}

const applyMigration = (db, text = b3Sql) => outcome(() => execOn(db, text));
const rowsText = (db, table, order = "1") =>
  sqlOn(db, `select t::text as t from ${table} t order by ${order}`).then((r) => r.map((x) => x.t));
const UNTOUCHED = [
  "public.introducers",
  "public.appointments",
  "public.introducer_leads",
  "public.interview_sessions",
  "public.tenant_memberships",
  "public.finance_ledger",
  "public.finance_fee_lines",
  "public.finance_audit_log",
  "public.finance_settings",
  "public.commission_rates",
  "public.commission_rate_history",
  "public.referrals",
  "public.referral_codes",
];
async function businessState(db, tables = UNTOUCHED) {
  const out = {};
  for (const t of tables) out[t] = (await rowsText(db, t)).sort();
  return JSON.stringify(out);
}
const constraintsOf = (db, rel) =>
  sqlOn(
    db,
    `select conname, contype, replace(pg_get_constraintdef(oid), 'REFERENCES public.', 'REFERENCES ') as def,
            confdeltype, confupdtype
     from pg_constraint where conrelid = $1::regclass order by conname`,
    [rel],
  );
const catalogFingerprint = async (db) =>
  JSON.stringify({
    links: await constraintsOf(db, "public.customer_introducer_links"),
    hist: await constraintsOf(db, "public.introducer_amendment_history"),
    intro: await constraintsOf(db, "public.introducers"),
    pol: await sqlOn(
      db,
      `select tablename, policyname, permissive, cmd, roles::text, qual, with_check from pg_policies
       where schemaname = 'public' and tablename in
         ('customer_introducer_links','introducer_amendment_history','introducers','finance_audit_log')
       order by 1, 2`,
    ),
    acl: await sqlOn(
      db,
      `select relname, relacl::text, relrowsecurity, relforcerowsecurity from pg_class where oid in
       ('public.customer_introducer_links'::regclass, 'public.introducer_amendment_history'::regclass,
        'public.introducers'::regclass, 'public.finance_audit_log'::regclass) order by 1`,
    ),
    colacl: await sqlOn(
      db,
      `select attrelid::regclass::text as rel, attname, attacl::text from pg_attribute
       where attrelid in ('public.customer_introducer_links'::regclass, 'public.introducer_amendment_history'::regclass)
         and attnum > 0 and not attisdropped order by 1, 2`,
    ),
  });
const policyAclFingerprint = async (db) => {
  const f = JSON.parse(await catalogFingerprint(db));
  return JSON.stringify({ pol: f.pol, acl: f.acl, colacl: f.colacl, intro: f.intro });
};
function asRole(db, role, stmt, params = [], sub = null) {
  return onServed(db, async () => {
    await db.query("begin");
    try {
      if (sub) await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [sub]);
      await db.query(`set local role ${role}`);
      const r = await db.query(stmt, params);
      await db.query("commit");
      return { ok: true, rows: r.rows };
    } catch (e) {
      await db.query("rollback");
      return { ok: false, code: e.code, message: e.message };
    }
  });
}
const rpcSql = `select * from public.amend_customer_introducer_attribution(
  p_tenant_id => $1, p_customer_id => $2, p_introducer_id => $3, p_changed_by => $4,
  p_session_id => $5, p_note => $6)`;
const rpcAs = (db, role, args, sub = null) =>
  asRole(
    db,
    role,
    rpcSql,
    [args.tenant, args.customer, args.introducer, args.by, args.session ?? null, args.note ?? null],
    sub,
  );

// --- fake PostgREST + Auth Admin on PGlite -----------------------------------------------------
const FAKE_HOST = "g7f4s4c4b3.invalid";
const PUBLISHABLE = "sb_publishable_g7f4s4c4b3_not_a_real_key";
process.env.SUPABASE_URL = `http://${FAKE_HOST}`;
process.env.VITE_SUPABASE_URL = `http://${FAKE_HOST}`;
process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_secret_g7f4s4c4b3_not_a_real_key";
process.env.SUPABASE_PUBLISHABLE_KEY = PUBLISHABLE;
process.env.VITE_SUPABASE_PUBLISHABLE_KEY = PUBLISHABLE;
const USER_HEADER = "x-g7f4s4c4b3-user";

const IDENT = /^[a-z_][a-z0-9_]*$/;
const q = (id) => {
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
const missingTables = new Set();
let requestCount = 0;

function selectList(raw) {
  if (!raw || raw === "*") return "*";
  return raw
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean)
    .map((c) => {
      if (c.includes("(")) throw new Error(`fake postgrest: embedded select unsupported (${c})`);
      return q(c);
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
  const col = q(key);
  let clause;
  if (op === "eq") clause = `${col} = $${args.push(v)}`;
  else if (op === "neq") clause = `${col} <> $${args.push(v)}`;
  else if (op === "gt") clause = `${col} > $${args.push(v)}`;
  else if (op === "gte") clause = `${col} >= $${args.push(v)}`;
  else if (op === "lt") clause = `${col} < $${args.push(v)}`;
  else if (op === "lte") clause = `${col} <= $${args.push(v)}`;
  else if (op === "ilike") clause = `${col}::text ilike $${args.push(v.replace(/\*/g, "%"))}`;
  else if (op === "like") clause = `${col}::text like $${args.push(v.replace(/\*/g, "%"))}`;
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
        return `${q(col)} ${dir === "desc" ? "desc" : "asc"}${
          nulls === "nullsfirst" ? " nulls first" : nulls === "nullslast" ? " nulls last" : ""
        }`;
      })
      .join(", ")
  );
}
async function primaryKey(table) {
  const rows = await sql(
    `select a.attname from pg_index i join pg_attribute a on a.attrelid = i.indrelid
     and a.attnum = any(i.indkey) where i.indrelid = ('public.' || $1)::regclass and i.indisprimary`,
    [table],
  );
  return rows.map((r) => r.attname);
}
function cellValue(v) {
  if (v !== null && typeof v === "object") return JSON.stringify(v);
  return v;
}
async function restTable(method, table, url, headers, body) {
  const params = [...url.searchParams.entries()];
  const sp = url.searchParams;
  const args = [];
  const t = `public.${q(table)}`;
  const accept = headers.get("accept") ?? "";
  const prefer = headers.get("prefer") ?? "";
  const wantObject = accept.startsWith("application/vnd.pgrst.object+json");
  const returning = prefer.includes("return=representation")
    ? ` returning ${selectList(sp.get("select"))}`
    : "";
  let rows;
  let countTotal = null;
  if (method === "GET" || method === "HEAD") {
    const where = whereClause(params, args);
    if (prefer.includes("count=exact")) {
      countTotal = Number((await one(`select count(*)::int as n from ${t}${where}`, args)).n);
    }
    if (method === "HEAD") {
      return new Response(null, {
        status: 200,
        headers: { "content-range": `*/${countTotal ?? 0}` },
      });
    }
    const limit = sp.get("limit") ? ` limit ${Number(sp.get("limit"))}` : "";
    const offset = sp.get("offset") ? ` offset ${Number(sp.get("offset"))}` : "";
    rows = await sql(
      `select ${selectList(sp.get("select"))} from ${t}${where}${orderClause(sp.get("order"))}${limit}${offset}`,
      args,
    );
  } else if (method === "POST") {
    const list = Array.isArray(body) ? body : [body];
    const colset = [...new Set(list.flatMap((r) => Object.keys(r)))];
    const values = list
      .map(
        (r) =>
          `(${colset.map((c) => (c in r ? `$${args.push(cellValue(r[c]))}` : "default")).join(", ")})`,
      )
      .join(", ");
    let conflict = "";
    if (prefer.includes("resolution=")) {
      const target = sp.get("on_conflict")
        ? sp.get("on_conflict").split(",")
        : await primaryKey(table);
      const targetSql = target.map((c) => q(c.trim())).join(", ");
      if (prefer.includes("resolution=ignore-duplicates")) {
        conflict = ` on conflict (${targetSql}) do nothing`;
      } else {
        const updates = colset.filter((c) => !target.includes(c));
        conflict = updates.length
          ? ` on conflict (${targetSql}) do update set ${updates
              .map((c) => `${q(c)} = excluded.${q(c)}`)
              .join(", ")}`
          : ` on conflict (${targetSql}) do nothing`;
      }
    }
    rows = await sql(
      `insert into ${t} (${colset.map(q).join(", ")}) values ${values}${conflict}${returning}`,
      args,
    );
  } else if (method === "PATCH") {
    const sets = Object.entries(body)
      .map(([c, v]) => `${q(c)} = $${args.push(cellValue(v))}`)
      .join(", ");
    rows = await sql(`update ${t} set ${sets}${whereClause(params, args)}${returning}`, args);
  } else if (method === "DELETE") {
    rows = await sql(`delete from ${t}${whereClause(params, args)}${returning}`, args);
  } else {
    throw new Error(`fake postgrest: method ${method}`);
  }
  if (wantObject) {
    if (rows.length !== 1) {
      return json(
        {
          code: "PGRST116",
          message: "JSON object requested, multiple (or no) rows returned",
          details: `The result contains ${rows.length} rows`,
          hint: null,
        },
        406,
      );
    }
    return json(rows[0], method === "POST" ? 201 : 200);
  }
  if (!returning && method !== "GET") return new Response(null, { status: 204 });
  return json(rows, method === "POST" ? 201 : 200, {
    "content-range": `0-${Math.max(rows.length - 1, 0)}/${countTotal ?? "*"}`,
  });
}
/** One transaction per request as the request's database role (service_role or authenticated). */
async function inRoleTx(role, userId, fn) {
  await pg.query("begin");
  try {
    if (userId) await pg.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId]);
    await pg.query(`set local role ${role}`);
    const r = await fn();
    await pg.query("commit");
    return r;
  } catch (e) {
    await pg.query("rollback");
    throw e;
  }
}
async function restRpc(fn, body) {
  if (!IDENT.test(fn)) throw new Error(`fake postgrest: bad rpc ${fn}`);
  const meta = await one(
    `select p.proretset from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = $1`,
    [fn],
  );
  if (!meta) return json({ code: "PGRST202", message: `function ${fn} not found` }, 404);
  const args = [];
  const named = Object.entries(body ?? {})
    .map(([k, v]) => `${q(k)} => $${args.push(cellValue(v))}`)
    .join(", ");
  if (meta.proretset) return json(await sql(`select * from public.${q(fn)}(${named})`, args));
  const row = await one(`select public.${q(fn)}(${named}) as v`, args);
  return json(row?.v ?? null);
}
function authUserJson(u) {
  return {
    id: u.id,
    aud: "authenticated",
    role: "authenticated",
    email: u.email,
    email_confirmed_at: u.email_confirmed_at,
    app_metadata: u.raw_app_meta_data ?? {},
    user_metadata: u.raw_user_meta_data ?? {},
    banned_until: u.banned_until,
    deleted_at: u.deleted_at,
    is_anonymous: u.is_anonymous,
    created_at: u.created_at,
    identities: [],
  };
}
async function authAdmin(method, url) {
  const m = url.pathname.match(/^\/auth\/v1\/admin\/users\/([0-9a-f-]{36})$/);
  if (m && method === "GET") {
    const u = await one(`select * from auth.users where id = $1`, [m[1]]);
    return u ? json(authUserJson(u)) : json({ code: "user_not_found", msg: "User not found" }, 404);
  }
  unknownCalls.push(`${method} ${url.pathname}`);
  return json({ msg: `unexpected ${method} ${url.pathname}` }, 500);
}
async function handle(input, init) {
  const url = new URL(typeof input === "string" ? input : (input.url ?? String(input)));
  if (url.hostname !== FAKE_HOST) {
    unknownCalls.push(`refused host ${url.hostname}`);
    throw new Error(`G7F4S4C4B3 fetch stub refused host ${url.hostname}`);
  }
  requestCount += 1;
  const method = String(
    init.method || (typeof input === "object" && input.method) || "GET",
  ).toUpperCase();
  const headers = new Headers(
    init.headers || (typeof input === "object" ? input.headers : undefined),
  );
  let body = null;
  const rawBody = init.body ?? null;
  if (rawBody) body = JSON.parse(typeof rawBody === "string" ? rawBody : String(rawBody));
  const userId = headers.get(USER_HEADER);
  try {
    if (url.pathname.startsWith("/rest/v1/rpc/")) {
      const fn = url.pathname.slice("/rest/v1/rpc/".length);
      return await inRoleTx(userId ? "authenticated" : "service_role", userId, () =>
        restRpc(fn, body),
      );
    }
    if (url.pathname.startsWith("/rest/v1/")) {
      const table = url.pathname.slice("/rest/v1/".length);
      return await inRoleTx(userId ? "authenticated" : "service_role", userId, () =>
        restTable(method, table, url, headers, body),
      );
    }
    if (url.pathname.startsWith("/auth/v1/")) return await authAdmin(method, url);
  } catch (e) {
    if (e?.code === "42P01") missingTables.add(url.pathname);
    if (e?.code) return pgError(e);
    unknownCalls.push(String(e?.message ?? e));
    return json({ code: "XX000", message: String(e?.message ?? e) }, 500);
  }
  unknownCalls.push(`${method} ${url.pathname}`);
  return json({ message: "unexpected" }, 500);
}
globalThis.fetch = (input, init = {}) =>
  serial(() => inRequest.run(true, () => handle(input, init)));

// --- quiet logs --------------------------------------------------------------------------------
const logs = [];
for (const level of ["log", "info", "warn", "error", "debug"]) {
  const orig = console[level].bind(console);
  console[level] = (...a) => {
    const line = a
      .map((x) => (x instanceof Error ? x.message : typeof x === "string" ? x : JSON.stringify(x)))
      .join(" ");
    if (level === "error" && line.startsWith("FAIL  ")) orig(...a);
    else if (
      level === "log" &&
      (line.startsWith("PASS  ") || /^[A-Z_]+=/.test(line) || line.startsWith("ALL "))
    )
      orig(...a);
    else {
      logs.push(`[${level}] ${line}`);
      if (process.env.G7F4S4C4B3_DEBUG) orig(...a);
    }
  };
}

// --- modules under test ------------------------------------------------------------------------
const { createClient } = await import("@supabase/supabase-js");
const bf = await import("../src/lib/booking.functions.ts");
const ic = await import("../src/lib/introducer-customer.functions.ts");
const sf = await import("../src/lib/sessions.functions.ts");
const jf = await import("../src/lib/journey-analytics.functions.ts");
const attr = await import("../src/lib/introducer-attribution.ts");
const ta = await import("../src/lib/tenant-assert.server.ts");
const NOT_FOUND = ta.RESOURCE_NOT_FOUND_MESSAGE;
const NO_CODE = attr.NO_ACTIVE_INTRODUCER_FOR_CODE_MESSAGE;

const SRC = {
  booking: read(BOOKING_REL),
  attr: read(ATTR_REL),
  ic: read(IC_REL),
};
async function loadMutant(key, src) {
  const js = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return import(dataUrl(`${mutantMark(key)}\n${js}\n// ${randomUUID()}`));
}
/** Apply exact text replacements; null when any anchor is missing (the NC then fails). */
function mutate(src, pairs) {
  let out = src;
  for (const [from, to] of pairs) {
    if (!out.includes(from)) return null;
    out = out.split(from).join(to);
  }
  return out;
}
async function withAttrMutant(pairs, fn) {
  const m = mutate(SRC.attr, pairs);
  if (!m) throw new Error("attribution mutation anchor missing");
  globalThis.__B3_ATTR = await loadMutant("attr", m);
  try {
    return await fn();
  } finally {
    globalThis.__B3_ATTR = null;
  }
}

async function invoke(fn, data, actor, slug) {
  const d = fn.__def;
  const parsed = d.validator ? await d.validator(data) : data;
  globalThis.__B3_REQUEST = slug
    ? new Request("http://app.invalid/_serverFn/x", {
        headers: { referer: `http://app.invalid/${slug}/admin` },
      })
    : null;
  const supabase = createClient(`http://${FAKE_HOST}`, PUBLISHABLE, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { [USER_HEADER]: actor } },
  });
  return d.handler({ data: parsed, context: { userId: actor, claims: { sub: actor }, supabase } });
}
const call = (fn, data, actor, slug = SLUG.a) => outcome(() => invoke(fn, data, actor, slug));

const linkOf = (tenantId, customerId) =>
  one(
    `select l.*, l::text as t from public.customer_introducer_links l where tenant_id = $1 and customer_id = $2`,
    [tenantId, customerId],
  );
const linksFor = (customerId) =>
  sql(
    `select l.*, l::text as t from public.customer_introducer_links l where customer_id = $1 order by tenant_id`,
    [customerId],
  );
const introRow = (id) =>
  one(`select i.*, i::text as t from public.introducers i where id = $1`, [id]);
const staffReg = (userId, tenantId) =>
  one(`select i.*, i::text as t from public.introducers i where user_id = $1 and tenant_id = $2`, [
    userId,
    tenantId,
  ]);
const ATTR_TABLES = [
  "public.customer_introducer_links",
  "public.introducer_amendment_history",
  "public.finance_audit_log",
  "public.finance_ledger",
  "public.customer_contact_log",
  "public.introducers",
  "public.appointments",
  "public.interview_sessions",
  "public.commission_rates",
  "public.tenant_memberships",
];
const allState = () => businessState(pg, ATTR_TABLES);

const bookInput = (customerId, extra = {}) => ({
  customerId,
  customerName: "Synthetic Customer",
  customerPhone: "SYNTHETIC",
  customerEmail: "synthetic.customer@example.test",
  startsAt: nextSlot(),
  advisorId: U.advA,
  sendSms: false,
  ...extra,
});
const bookAsStaff = (mod, actor, customerId, extra = {}) =>
  call(mod.bookCustomerAppointmentAsStaff, bookInput(customerId, extra), actor, SLUG.a);
const newCustomer = async (label, tenants = [T.a]) => {
  const id = await addUser(pg, label);
  for (const t of tenants) await addMember(pg, id, t, "customer");
  return id;
};

// =============================================================================================
// MIGRATION (01–20)
// =============================================================================================
const base = await stagingDb();
pg = base.db;
const preLinks = await rowsText(pg, "public.customer_introducer_links", "customer_id");
const preLinkRows = await sql(
  `select l.*, to_jsonb(l) as j from public.customer_introducer_links l`,
);
const preHistory = (await rowsText(pg, "public.introducer_amendment_history")).sort();
const preUntouched = await businessState(pg);
const prePolicyAcl = await policyAclFingerprint(pg);
const preTenantless = preLinkRows.filter((r) => !r.tenant_id).length;
const mig = await applyMigration(pg);
const postLinkRows = await sql(
  `select l.*, to_jsonb(l) as j, l::text as t from public.customer_introducer_links l`,
);

ok(
  "B3-01 migration applies to the staging-shaped pre-B3 database (2 stamped + 3 provable tenantless links)",
  Boolean(linkPolicySql) && mig.ok && preTenantless === 3 && preLinks.length === 5,
  mig.ok ? `tenantless=${preTenantless}` : mig.message,
);
{
  const stamped = postLinkRows.filter((r) =>
    [base.cust.l3, base.cust.l4, base.cust.l5].includes(r.customer_id),
  );
  ok(
    "B3-02 each proven legacy link is stamped with its introducer's tenant (count = tenantless baseline)",
    stamped.length === 3 &&
      stamped.every((r) => r.tenant_id === T.a) &&
      postLinkRows.every((r) => r.tenant_id),
  );
}
{
  const byCustomer = new Map(postLinkRows.map((r) => [r.customer_id, r]));
  const strip = (j) => {
    const { tenant_id: _t, ...rest } = j;
    return JSON.stringify(rest);
  };
  const stampedSame = preLinkRows
    .filter((r) => r.tenant_id)
    .every((r) => preLinks.includes(byCustomer.get(r.customer_id)?.t));
  const legacyOnlyTenant = preLinkRows
    .filter((r) => !r.tenant_id)
    .every((r) => strip(byCustomer.get(r.customer_id)?.j ?? {}) === strip(r.j));
  ok(
    "B3-03 stamped rows are byte-identical; backfilled rows differ only in tenant_id (created_at, effective_from, updated_at, source kept)",
    stampedSame && legacyOnlyTenant,
  );
}
ok(
  "B3-04 link and history row counts unchanged; history rows byte-identical",
  postLinkRows.length === preLinkRows.length &&
    JSON.stringify((await rowsText(pg, "public.introducer_amendment_history")).sort()) ===
      JSON.stringify(preHistory),
);
ok(
  "B3-05 untouched tables (introducers, appointments, leads, sessions, memberships, finance, commission, referrals) identical multiset",
  (await businessState(pg)) === preUntouched,
);

/** Fresh staging DB + a defect → the migration must RAISE `pattern` and leave everything as it was. */
async function refusesWith(prepare, pattern, text = b3Sql) {
  const fx = await stagingDb();
  await prepare(fx);
  const before = JSON.stringify({
    links: await rowsText(fx.db, "public.customer_introducer_links", "customer_id"),
    state: await businessState(fx.db),
    cat: await catalogFingerprint(fx.db),
  });
  const r = await applyMigration(fx.db, text);
  const after = JSON.stringify({
    links: await rowsText(fx.db, "public.customer_introducer_links", "customer_id"),
    state: await businessState(fx.db),
    cat: await catalogFingerprint(fx.db),
  });
  const pass = !r.ok && pattern.test(r.message) && before === after;
  return { pass, applied: r.ok, message: r.ok ? "applied" : r.message, fx };
}
const conflictingAppointment = async (fx) => {
  const s = await addSession(fx.db, { customerId: fx.cust.l3, tenantId: null });
  await addAppointment(fx.db, {
    sessionId: s,
    tenantId: T.b,
    advisorId: fx.adv,
    introducerId: fx.ia,
  });
};
const check06 = (text = b3Sql) =>
  refusesWith(
    conflictingAppointment,
    /g7f4s4c4b3_precondition:legacy_link_conflicting_evidence/,
    text,
  );
{
  const r = await check06();
  ok(
    "B3-06 legacy link whose appointment evidence names another tenant → RAISE, nothing stamped, catalog unchanged",
    r.pass,
    r.message,
  );
}
{
  const r = await refusesWith(async (fx) => {
    const orphanIntro = await addIntroducer(fx.db, {
      tenantId: null,
      name: "Tenantless Intro",
      slug: "tenantless-intro",
    });
    const c = await addUser(fx.db, "legacy orphan");
    await insertRow(fx.db, "public.customer_introducer_links", {
      customer_id: c,
      introducer_id: orphanIntro,
      tenant_id: null,
    });
  }, /g7f4s4c4b3_precondition:legacy_link_unprovable/);
  ok(
    "B3-07 legacy link whose introducer has no tenant → RAISE legacy_link_unprovable",
    r.pass,
    r.message,
  );
}
{
  const r = await refusesWith(async (fx) => {
    const c = await addUser(fx.db, "legacy mismatch");
    await insertRow(fx.db, "public.customer_introducer_links", {
      customer_id: c,
      introducer_id: fx.ia,
      tenant_id: T.b,
    });
  }, /g7f4s4c4b3_precondition:stamped_link_tenant_mismatch/);
  ok(
    "B3-08 stamped link whose tenant differs from its introducer's → RAISE stamped_link_tenant_mismatch",
    r.pass,
    r.message,
  );
}
{
  const r1 = await refusesWith(async (fx) => {
    await insertRow(fx.db, "public.introducer_amendment_history", {
      customer_id: fx.cust.l1,
      new_introducer_id: fx.ia,
      tenant_id: null,
    });
  }, /g7f4s4c4b3_precondition:history_tenant_null/);
  const r2 = await refusesWith(async (fx) => {
    await insertRow(fx.db, "public.introducer_amendment_history", {
      customer_id: fx.cust.l1,
      new_introducer_id: fx.ib,
      tenant_id: T.a,
    });
  }, /g7f4s4c4b3_precondition:history_introducer_tenant_mismatch/);
  ok(
    "B3-09 history with NULL tenant, or naming another tenant's introducer → RAISE",
    r1.pass && r2.pass,
    describe({ message: r1.message }, { message: r2.message }),
  );
}
{
  const r1 = await refusesWith(async (fx) => {
    const s = await addSession(fx.db, { customerId: fx.cust.l4, tenantId: null });
    await insertRow(fx.db, "public.introducer_leads", {
      introducer_id: fx.ia,
      session_id: s,
      tenant_id: T.b,
    });
  }, /legacy_link_conflicting_evidence/);
  const r2 = await refusesWith(async (fx) => {
    await insertRow(fx.db, "public.introducer_amendment_history", {
      customer_id: fx.cust.l5,
      previous_introducer_id: null,
      new_introducer_id: fx.ia,
      tenant_id: T.a,
    });
    await sqlOn(
      fx.db,
      `alter table public.introducer_amendment_history drop constraint introducer_amendment_history_new_introducer_id_fkey`,
    );
    await sqlOn(
      fx.db,
      `alter table public.introducer_amendment_history add constraint introducer_amendment_history_new_introducer_id_fkey foreign key (new_introducer_id) references public.introducers(id) on delete set null`,
    );
    await sqlOn(
      fx.db,
      `update public.introducer_amendment_history set tenant_id = $1 where customer_id = $2`,
      [T.b, fx.cust.l5],
    );
  }, /g7f4s4c4b3_precondition:(legacy_link_conflicting_evidence|history_introducer_tenant_mismatch)/);
  ok(
    "B3-10 conflicting evidence via an introducer lead, or via a history row in another tenant → RAISE",
    r1.pass && r2.pass,
    describe({ message: r1.message }, { message: r2.message }),
  );
}
{
  const r1 = await refusesWith(async (fx) => {
    await sqlOn(
      fx.db,
      `alter table public.customer_introducer_links drop constraint customer_introducer_links_introducer_id_fkey`,
    );
    await sqlOn(
      fx.db,
      `alter table public.customer_introducer_links add constraint customer_introducer_links_introducer_id_fkey foreign key (introducer_id) references public.introducers(id) on delete restrict`,
    );
  }, /g7f4s4c4b3_precondition:key_missing_or_changed:customer_introducer_links_introducer_id_fkey/);
  const r2 = await refusesWith(async (fx) => {
    await sqlOn(
      fx.db,
      `create index customer_introducer_links_customer_id_idx on public.customer_introducer_links (customer_id)`,
    );
  }, /g7f4s4c4b3_precondition:new_name_in_use/);
  ok(
    "B3-11 an altered old key or a pre-existing new name → RAISE before any DDL",
    r1.pass && r2.pass,
    describe({ message: r1.message }, { message: r2.message }),
  );
}

// Post-migration structural checks on the main database.
U.intA = await addUser(pg, "struct intro a");
const cX = await addUser(pg, "struct customer");
{
  const nullLink = await outcome(() =>
    sql(
      `insert into public.customer_introducer_links (customer_id, introducer_id) values ($1, $2)`,
      [cX, base.ia],
    ),
  );
  const nullHist = await outcome(() =>
    sql(
      `insert into public.introducer_amendment_history (customer_id, new_introducer_id) values ($1, $2)`,
      [cX, base.ia],
    ),
  );
  ok(
    "B3-12 tenant_id is NOT NULL on links and on history",
    nullLink.code === "23502" && nullHist.code === "23502",
    describe(nullLink, nullHist),
  );
}
{
  const a = await outcome(() =>
    sql(
      `insert into public.customer_introducer_links (tenant_id, customer_id, introducer_id) values ($1,$2,$3)`,
      [T.a, cX, base.ia],
    ),
  );
  const b = await outcome(() =>
    sql(
      `insert into public.customer_introducer_links (tenant_id, customer_id, introducer_id) values ($1,$2,$3)`,
      [T.b, cX, base.ib],
    ),
  );
  const dup = await outcome(() =>
    sql(
      `insert into public.customer_introducer_links (tenant_id, customer_id, introducer_id) values ($1,$2,$3)`,
      [T.a, cX, base.ia],
    ),
  );
  const pk = (await constraintsOf(pg, "public.customer_introducer_links")).find(
    (c) => c.contype === "p",
  );
  ok(
    "B3-13 key is (tenant_id, customer_id): one row per tenant per customer; same customer may hold rows in two tenants",
    a.ok &&
      b.ok &&
      dup.code === "23505" &&
      pk?.conname === "customer_introducer_links_pkey" &&
      pk?.def === "PRIMARY KEY (tenant_id, customer_id)",
    describe(a, b, dup),
  );
}
{
  const c2 = await addUser(pg, "struct customer two");
  const foreign = await outcome(() =>
    sql(
      `insert into public.customer_introducer_links (tenant_id, customer_id, introducer_id) values ($1,$2,$3)`,
      [T.a, c2, base.ib],
    ),
  );
  ok(
    "B3-14 a link naming another tenant's introducer is rejected by the composite FK",
    foreign.code === "23503",
    describe(foreign),
  );
}
{
  const c3 = await addUser(pg, "struct customer three");
  const bad = await outcome(() =>
    sql(
      `insert into public.introducer_amendment_history (tenant_id, customer_id, previous_introducer_id, new_introducer_id) values ($1,$2,$3,$4)`,
      [T.a, c3, base.ib, base.ia],
    ),
  );
  const good = await outcome(() =>
    sql(
      `insert into public.introducer_amendment_history (tenant_id, customer_id, previous_introducer_id, new_introducer_id) values ($1,$2,null,$3) returning id`,
      [T.a, c3, base.ia],
    ),
  );
  if (good.ok)
    await sql(`delete from public.introducer_amendment_history where id = $1`, [good.value[0].id]);
  ok(
    "B3-15 history rows must name introducers of their own tenant (previous may be NULL)",
    bad.code === "23503" && good.ok,
    describe(bad, good),
  );
}
/** RESTRICT: an attributed introducer cannot be deleted or re-keyed; the link survives. */
async function check16(db) {
  const iid = await addIntroducer(db, {
    tenantId: T.a,
    code: "1099",
    name: "Restrict Probe",
    slug: `restrict-probe-${randomUUID().slice(0, 8)}`,
  });
  const c = await addUser(db, "restrict customer");
  await insertRow(db, "public.customer_introducer_links", {
    tenant_id: T.a,
    customer_id: c,
    introducer_id: iid,
    source: "booking",
  });
  const del = await outcome(() => sqlOn(db, `delete from public.introducers where id = $1`, [iid]));
  const rekey = await outcome(() =>
    sqlOn(db, `update public.introducers set tenant_id = $2 where id = $1`, [iid, T.b]),
  );
  const link = (
    await sqlOn(
      db,
      `select introducer_id from public.customer_introducer_links where customer_id = $1`,
      [c],
    )
  )[0];
  return {
    pass: del.code === "23001" && rekey.code === "23001" && link?.introducer_id === iid,
    linkLost: !link,
    detail: describe(del, rekey),
  };
}
{
  const r = await check16(pg);
  ok(
    "B3-16 deleting or re-keying an attributed introducer fails (ON DELETE/UPDATE RESTRICT); the link survives",
    r.pass,
    r.detail,
  );
}
{
  const idx = await sql(
    `select indexrelid::regclass::text as n, pg_get_indexdef(indexrelid) as d from pg_index
     where indrelid in ('public.customer_introducer_links'::regclass, 'public.introducer_amendment_history'::regclass) order by 1`,
  );
  const names = idx.map((x) => x.n);
  ok(
    "B3-17 new indexes exist (links customer_id; history tenant_id, customer_id, effective_from DESC); existing indexes kept",
    [
      "customer_introducer_links_customer_id_idx",
      "introducer_amendment_history_tenant_customer_idx",
      "customer_introducer_links_tenant_id_idx",
      "idx_customer_introducer_links_introducer",
      "idx_introducer_amendment_customer",
      "introducer_amendment_history_tenant_id_idx",
    ].every((n) => names.includes(n)) &&
      idx.some(
        (x) =>
          x.n === "introducer_amendment_history_tenant_customer_idx" &&
          /\(tenant_id, customer_id, effective_from DESC\)/.test(x.d),
      ),
  );
}
ok(
  "B3-18 policies, table/column ACLs, RLS flags and introducer keys (A2) unchanged by the migration",
  (await policyAclFingerprint(pg)) === prePolicyAcl,
);
/** RPC privilege boundary as the database sees it; authenticated must not reach the body. */
async function check19(db, probe) {
  const fn = (
    await sqlOn(
      db,
      `select count(*)::int as n, bool_and(not prosecdef) as invoker, bool_and(proconfig = array['search_path=""']) as path,
              bool_and(has_function_privilege('anon', p.oid, 'EXECUTE')) as anon,
              bool_and(has_function_privilege('authenticated', p.oid, 'EXECUTE')) as authd,
              bool_and(has_function_privilege('service_role', p.oid, 'EXECUTE')) as svc,
              bool_or(exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0)) as public_grant
       from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'amend_customer_introducer_attribution'`,
    )
  )[0];
  const direct = await rpcAs(db, "authenticated", probe, probe.by);
  return {
    pass:
      fn.n === 1 &&
      fn.invoker &&
      fn.path &&
      !fn.anon &&
      !fn.authd &&
      fn.svc &&
      !fn.public_grant &&
      direct.code === "42501",
    direct,
    detail: `${JSON.stringify(fn)} direct=${direct.ok ? "ok" : direct.code}`,
  };
}
{
  const r = await check19(pg, {
    tenant: T.a,
    customer: base.cust.l2,
    introducer: base.ia,
    by: base.adv,
  });
  ok(
    "B3-19 amend RPC: one overload, SECURITY INVOKER, search_path='', no PUBLIC/anon/authenticated EXECUTE, service_role only",
    r.pass,
    r.detail,
  );
}
{
  const before = JSON.stringify({
    l: await rowsText(pg, "public.customer_introducer_links", "customer_id, tenant_id"),
    c: await catalogFingerprint(pg),
  });
  const rerun = await applyMigration(pg);
  const after = JSON.stringify({
    l: await rowsText(pg, "public.customer_introducer_links", "customer_id, tenant_id"),
    c: await catalogFingerprint(pg),
  });
  ok(
    "B3-20 re-applying the migration fails closed at the preconditions and changes nothing",
    !rerun.ok &&
      /g7f4s4c4b3_precondition:key_missing_or_changed:customer_introducer_links_pkey/.test(
        rerun.message,
      ) &&
      before === after,
    rerun.ok ? "applied twice" : rerun.message,
  );
}

// =============================================================================================
// Application fixtures (post-migration main database)
// =============================================================================================
U.ownerA = await addUser(pg, "Owner A", "Alpha Owner");
await addMember(pg, U.ownerA, T.a, "owner");
U.ownerB = await addUser(pg, "Owner B", "Bravo Owner");
await addMember(pg, U.ownerB, T.b, "owner");
U.supA = await addUser(pg, "Supervisor A", "Alpha Supervisor");
await addMember(pg, U.supA, T.a, "supervisor");
U.advA = await addUser(pg, "Adviser A", "Alpha Adviser");
await addMember(pg, U.advA, T.a, "adviser");
await insertRow(pg, "public.advisor_profiles", { user_id: U.advA, code: "ADVA1", tenant_id: T.a });
U.advB = await addUser(pg, "Adviser B", "Bravo Adviser");
await addMember(pg, U.advB, T.b, "adviser");
U.supInactive = await addUser(pg, "Supervisor Inactive Reg", "Inactive Reg Supervisor");
await addMember(pg, U.supInactive, T.a, "supervisor");
U.supDeleted = await addUser(pg, "Supervisor Deleted Reg", "Deleted Reg Supervisor");
await addMember(pg, U.supDeleted, T.a, "supervisor");
U.supFresh = await addUser(pg, "Supervisor Fresh", "Fresh Supervisor");
await addMember(pg, U.supFresh, T.a, "supervisor");
I.a = base.ia;
I.b = base.ib;
I.a2 = await addIntroducer(pg, {
  tenantId: T.a,
  code: "1002",
  name: "Alpha Two Introducers",
  slug: "intro-a2",
});
I.bSameCode = await addIntroducer(pg, {
  tenantId: T.b,
  code: "1001",
  name: "Bravo Same Code Ltd",
  slug: "intro-b-same",
});
I.bOnly = await addIntroducer(pg, {
  tenantId: T.b,
  code: "2002",
  name: "Bravo Only Ltd",
  slug: "intro-b-only",
});
I.aInactive = await addIntroducer(pg, {
  tenantId: T.a,
  code: "1003",
  name: "Alpha Dormant Ltd",
  slug: "intro-a-dormant",
  active: false,
});
I.aDeleted = await addIntroducer(pg, {
  tenantId: T.a,
  code: "1004",
  name: "Alpha Removed Ltd",
  slug: "intro-a-removed",
  deleted: true,
});
I.amb1 = await addIntroducer(pg, {
  tenantId: T.a,
  code: "1005",
  name: "Ambiguous One Ltd",
  slug: "intro-amb-one",
});
I.amb2 = await addIntroducer(pg, {
  tenantId: T.a,
  code: "1005",
  name: "Ambiguous Two Ltd",
  slug: "intro-amb-two",
});
I.c = await addIntroducer(pg, {
  tenantId: T.c,
  code: "3001",
  name: "Charlie Ltd",
  slug: "intro-c",
});
I.supInactiveReg = await addIntroducer(pg, {
  tenantId: T.a,
  name: "Inactive Reg Supervisor",
  slug: "inactive-reg-supervisor",
  active: false,
  userId: U.supInactive,
});
I.supDeletedReg = await addIntroducer(pg, {
  tenantId: T.a,
  name: "Deleted Reg Supervisor",
  slug: "deleted-reg-supervisor",
  deleted: true,
  userId: U.supDeleted,
});

// =============================================================================================
// BR6 / AUTOMATIC ATTRIBUTION (21–41)
// =============================================================================================
/** Staff booking for a customer whose only A session is an unbooked fact-find. */
async function check21(mod = bf) {
  const c = await newCustomer("br6 factfind");
  const ff = await addSession(pg, { customerId: c, tenantId: T.a });
  const r = await bookAsStaff(mod, U.supA, c);
  const reg = await staffReg(U.supA, T.a);
  const link = await linkOf(T.a, c);
  const sess = await one(`select case_ref from public.interview_sessions where id = $1`, [ff]);
  return {
    pass:
      r.ok &&
      r.value.session_id === ff &&
      Boolean(sess?.case_ref) &&
      link?.introducer_id === reg?.id &&
      link?.source === "booking",
    detail: describe(r),
  };
}
{
  const r = await check21();
  ok(
    "B3-21 staff booking for a customer new to the tenant (unbooked fact-find) creates the tenant's attribution to the crediting staff registration",
    r.pass,
    r.detail,
  );
}
async function check22(mod = bf) {
  const c = await newCustomer("br6 dual", [T.a, T.b]);
  await insertRow(pg, "public.customer_introducer_links", {
    tenant_id: T.b,
    customer_id: c,
    introducer_id: I.b,
    source: "booking",
  });
  const bRow = (await linkOf(T.b, c)).t;
  const r = await bookAsStaff(mod, U.supA, c);
  const aLink = await linkOf(T.a, c);
  return {
    pass: r.ok && Boolean(aLink) && (await linkOf(T.b, c))?.t === bRow,
    detail: describe(r),
    aLink,
  };
}
{
  const r = await check22();
  ok(
    "B3-22 another tenant's attribution neither blocks the booking nor prevents this tenant's own row; the other row is byte-identical",
    r.pass,
    r.detail,
  );
}
{
  const c = await newCustomer("br6 existing");
  await insertRow(pg, "public.customer_introducer_links", {
    tenant_id: T.a,
    customer_id: c,
    introducer_id: I.a2,
    source: "amended",
  });
  const before = (await linkOf(T.a, c)).t;
  const r = await bookAsStaff(bf, U.supA, c);
  ok(
    "B3-23 an existing attribution in the booking tenant is never modified by a booking",
    r.ok && (await linkOf(T.a, c))?.t === before,
    describe(r),
  );
}
async function referralBooking(mod, slug) {
  const c = await newCustomer("br6 referral");
  const ff = await addSession(pg, { customerId: c, tenantId: T.a });
  const r = await call(
    mod.bookSessionAppointment,
    {
      sessionId: ff,
      channel: "voice",
      customerName: "Synthetic Customer",
      customerPhone: "SYNTHETIC",
      startsAt: nextSlot(),
      advisorId: U.advA,
      slug,
    },
    c,
    null,
  );
  return { r, c, ff };
}
{
  const { r, c } = await referralBooking(bf, "intro-a");
  const link = await linkOf(T.a, c);
  ok(
    "B3-24 customer self-booking with a same-tenant referral slug creates the tenant's attribution to that introducer",
    r.ok && link?.introducer_id === I.a && link?.source === "booking",
    describe(r),
  );
}
{
  const { r, c } = await referralBooking(bf, "intro-b");
  const appt = r.ok
    ? await one(`select introducer_id, tenant_id from public.appointments where id = $1`, [
        r.value.id,
      ])
    : null;
  ok(
    "B3-25 a foreign-tenant referral slug is discarded (B2a): booking succeeds in the session tenant, no attribution anywhere",
    r.ok &&
      appt?.tenant_id === T.a &&
      appt?.introducer_id === null &&
      (await linksFor(c)).length === 0,
    describe(r),
  );
}
/** Race: the row appears between snapshot and write; ignoreDuplicates must keep the first row. */
async function check26() {
  const c = await newCustomer("br6 race");
  const snap = await attr.snapshotTenantCustomerState(
    (await import("../src/integrations/supabase/client.server.ts")).supabaseAdminUntyped,
    c,
    T.a,
  );
  await insertRow(pg, "public.customer_introducer_links", {
    tenant_id: T.a,
    customer_id: c,
    introducer_id: I.a2,
    source: "booking",
  });
  const before = (await linkOf(T.a, c)).t;
  const { createTenantAttributionIfEligible } = await import("@/lib/introducer-attribution");
  const { supabaseAdminUntyped } = await import("../src/integrations/supabase/client.server.ts");
  await createTenantAttributionIfEligible(supabaseAdminUntyped, {
    customerId: c,
    tenantId: T.a,
    introducerId: I.a,
    source: "booking",
    snapshot: snap,
  });
  const after = await linkOf(T.a, c);
  return {
    pass: snap.ok && !snap.hasTenantAttribution && after?.t === before,
    overwritten: after?.introducer_id === I.a,
  };
}
const { supabaseAdminUntyped: adminDb } =
  await import("../src/integrations/supabase/client.server.ts");
{
  const r = await check26();
  ok(
    "B3-26 a row created after the snapshot is never overwritten (insert-if-absent, ignoreDuplicates)",
    r.pass,
  );
}
{
  const c = await newCustomer("br6 b case", [T.a, T.b]);
  await addSession(pg, { customerId: c, tenantId: T.b, caseRef: "MG-B-CASE" });
  const r = await bookAsStaff(bf, U.supA, c);
  ok(
    "B3-27 a case in another tenant does not make the customer existing here: attribution created",
    r.ok && Boolean(await linkOf(T.a, c)),
    describe(r),
  );
}
{
  const c = await newCustomer("br6 binned case");
  await addSession(pg, { customerId: c, tenantId: T.a, caseRef: "MG-A-BINNED", deleted: true });
  const r = await bookAsStaff(bf, U.supA, c);
  ok(
    "B3-28 a binned case in the booking tenant still counts as existing: no attribution",
    r.ok && !(await linkOf(T.a, c)),
    describe(r),
  );
}
async function check29(mod = bf) {
  const c = await newCustomer("br6 membership only");
  const r = await bookAsStaff(mod, U.supA, c);
  return { pass: r.ok && Boolean(await linkOf(T.a, c)), detail: describe(r) };
}
{
  const r = await check29();
  ok(
    "B3-29 an active customer membership alone does not make the customer existing: attribution created",
    r.pass,
    r.detail,
  );
}
async function check30(mod = bf) {
  const c = await newCustomer("br6 factfind appt");
  const ff = await addSession(pg, { customerId: c, tenantId: T.a });
  await addAppointment(pg, { sessionId: ff, tenantId: T.a, advisorId: U.advA });
  const r = await bookAsStaff(mod, U.supA, c);
  return { pass: r.ok && !(await linkOf(T.a, c)), detail: describe(r), c };
}
{
  const r = await check30();
  ok(
    "B3-30 an earlier appointment in the booking tenant (fact-find, no case) makes the customer existing: no attribution",
    r.pass,
    r.detail,
  );
}
async function check31(mod = bf) {
  const c = await newCustomer("br6 case");
  await addSession(pg, { customerId: c, tenantId: T.a, caseRef: "MG-A-LIVE" });
  const r = await bookAsStaff(mod, U.supA, c);
  return { pass: r.ok && !(await linkOf(T.a, c)), detail: describe(r), c };
}
{
  const r = await check31();
  ok(
    "B3-31 a case in the booking tenant makes the customer existing: no attribution",
    r.pass,
    r.detail,
  );
}
{
  const c = await newCustomer("br6 tenantless");
  await addSession(pg, { customerId: c, tenantId: null, caseRef: "MG-NULL-1" });
  const r = await bookAsStaff(bf, U.supA, c);
  ok(
    "B3-32 tenantless sessions are not read by the snapshot: customer is new to the tenant, attribution created",
    r.ok && Boolean(await linkOf(T.a, c)),
    describe(r),
  );
}
async function check33(mod = bf) {
  const c = await newCustomer("br6 first booking");
  const r = await bookAsStaff(mod, U.supA, c);
  const sess = r.ok
    ? await one(`select case_ref, tenant_id from public.interview_sessions where id = $1`, [
        r.value.session_id,
      ])
    : null;
  const appts = await one(
    `select count(*)::int as n from public.appointments a join public.interview_sessions s on s.id = a.session_id where s.customer_id = $1`,
    [c],
  );
  return {
    pass:
      r.ok &&
      Boolean(sess?.case_ref) &&
      sess?.tenant_id === T.a &&
      appts.n === 1 &&
      Boolean(await linkOf(T.a, c)),
    detail: describe(r),
  };
}
{
  const r = await check33();
  ok(
    "B3-33 the booking's own appointment and new case never disqualify it: case, appointment and attribution all created",
    r.pass,
    r.detail,
  );
}
{
  const failing = {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({ limit: async () => ({ data: null, error: { message: "boom" } }) }),
        }),
      }),
    }),
  };
  const snap = await attr.snapshotTenantCustomerState(failing, randomUUID(), T.a);
  const m = requestCount;
  const created = await attr.createTenantAttributionIfEligible(adminDb, {
    customerId: snap.customerId,
    tenantId: T.a,
    introducerId: I.a,
    source: "booking",
    snapshot: snap,
  });
  ok(
    "B3-34 a snapshot read error yields ok:false and no attribution write (fails closed, never throws)",
    snap.ok === false && created === false && requestCount === m,
  );
}
{
  const c = await newCustomer("br6 mismatch");
  const snap = await attr.snapshotTenantCustomerState(adminDb, c, T.a);
  const other = await attr.createTenantAttributionIfEligible(adminDb, {
    customerId: randomUUID(),
    tenantId: T.a,
    introducerId: I.a,
    source: "booking",
    snapshot: snap,
  });
  const otherTenant = await attr.createTenantAttributionIfEligible(adminDb, {
    customerId: c,
    tenantId: T.b,
    introducerId: I.b,
    source: "booking",
    snapshot: snap,
  });
  const manual = await attr.createTenantAttributionIfEligible(adminDb, {
    customerId: c,
    tenantId: T.a,
    introducerId: I.a,
    source: "resolved",
    snapshot: snap,
  });
  ok(
    "B3-35 a snapshot for another customer/tenant, or a non-automatic source, writes nothing",
    !other && !otherTenant && !manual && (await linksFor(c)).length === 0,
  );
}
{
  const c = await newCustomer("br6 write error");
  const snap = await attr.snapshotTenantCustomerState(adminDb, c, T.a);
  const broken = new Proxy(adminDb, {
    get(target, prop) {
      if (prop !== "from") return target[prop];
      return (table) =>
        table === "customer_introducer_links"
          ? { upsert: async () => ({ data: null, error: { message: "synthetic write failure" } }) }
          : target.from(table);
    },
  });
  const res = await outcome(() =>
    attr.createTenantAttributionIfEligible(broken, {
      customerId: c,
      tenantId: T.a,
      introducerId: I.a,
      source: "booking",
      snapshot: snap,
    }),
  );
  ok(
    "B3-36 an attribution write failure never throws into the booking (returns false)",
    res.ok && res.value === false && !(await linkOf(T.a, c)),
  );
}
async function check37() {
  const out = {};
  for (const [k, iid] of [
    ["inactive", I.aInactive],
    ["deleted", I.aDeleted],
    ["active", I.a],
  ]) {
    const c = await newCustomer(`br6 intro ${k}`);
    const snap = await attr.snapshotTenantCustomerState(adminDb, c, T.a);
    const { createTenantAttributionIfEligible } = await import("@/lib/introducer-attribution");
    await createTenantAttributionIfEligible(adminDb, {
      customerId: c,
      tenantId: T.a,
      introducerId: iid,
      source: "booking",
      snapshot: snap,
    });
    out[k] = Boolean(await linkOf(T.a, c));
  }
  return { pass: !out.inactive && !out.deleted && out.active, out };
}
{
  const r = await check37();
  ok(
    "B3-37 only an active, not-deleted introducer of the booking tenant is attributed",
    r.pass,
    JSON.stringify(r.out),
  );
}
async function check38(mod = bf, actor = U.supInactive, regId = I.supInactiveReg) {
  const c = await newCustomer("br6 inactive staff");
  const regBefore = (await introRow(regId)).t;
  const r = await bookAsStaff(mod, actor, c);
  const appt = r.ok
    ? await one(`select introducer_id from public.appointments where id = $1`, [r.value.id])
    : null;
  const regAfter = await introRow(regId);
  return {
    pass:
      r.ok && appt?.introducer_id === null && regAfter.t === regBefore && !(await linkOf(T.a, c)),
    reactivated: regAfter.active === true && regAfter.t !== regBefore,
    linked: Boolean(await linkOf(T.a, c)),
    detail: describe(r),
  };
}
{
  const r = await check38();
  ok(
    "B3-38 staff whose registration here is deactivated: booking succeeds, registration not revived, no credit, no attribution",
    r.pass,
    r.detail,
  );
}
{
  const r = await check38(bf, U.supDeleted, I.supDeletedReg);
  ok(
    "B3-39 staff whose registration here is soft-deleted: same — never revived, never credited",
    r.pass,
    r.detail,
  );
}
{
  const c1 = await newCustomer("br6 fresh staff");
  const r1 = await bookAsStaff(bf, U.supFresh, c1);
  const reg = await staffReg(U.supFresh, T.a);
  const c2 = await newCustomer("br6 fresh staff again");
  const r2 = await bookAsStaff(bf, U.supFresh, c2);
  ok(
    "B3-40 staff without a registration gets one in the booking tenant (ensureStaffIntroducerRecord) and is credited; an active one is reused",
    r1.ok &&
      r2.ok &&
      reg?.active === true &&
      (await linkOf(T.a, c1))?.introducer_id === reg.id &&
      (await linkOf(T.a, c2))?.introducer_id === reg.id &&
      (
        await one(`select count(*)::int as n from public.introducers where user_id = $1`, [
          U.supFresh,
        ])
      ).n === 1,
    describe(r1, r2),
  );
}
{
  const files = git("ls-files", "src")
    .trim()
    .split("\n")
    .filter((f) => /\.(ts|tsx)$/.test(f));
  const writers = [];
  for (const f of files) {
    const src = read(f);
    const re = /\.from\("customer_introducer_links"\)\s*\.(insert|upsert|update)\(/g;
    let m;
    while ((m = re.exec(src))) writers.push(`${f}:${m[1]}`);
  }
  const rpcCallers = files.filter((f) =>
    read(f).includes('rpc("amend_customer_introducer_attribution"'),
  );
  ok(
    "B3-41 single automatic path: the only app writer of attribution rows is createTenantAttributionIfEligible; amendments only via the RPC",
    JSON.stringify(writers) === JSON.stringify([`${ATTR_REL}:upsert`]) &&
      JSON.stringify(rpcCallers) === JSON.stringify([IC_REL]) &&
      !SRC.attr.match(
        /ensureCustomerIntroducerLink|findIntroducerIdForCustomer|peekIntroducerIdForCustomer/,
      ),
    `${writers.join(", ")} | rpc: ${rpcCallers.join(", ")}`,
  );
}

// =============================================================================================
// LIFECYCLE (42–44)
// =============================================================================================
{
  const iid = await addIntroducer(pg, {
    tenantId: T.a,
    code: "1010",
    name: "Lifecycle Ltd",
    slug: "intro-lifecycle",
  });
  const c = await newCustomer("life deactivate");
  await insertRow(pg, "public.customer_introducer_links", {
    tenant_id: T.a,
    customer_id: c,
    introducer_id: iid,
    source: "booking",
  });
  const before = (await linkOf(T.a, c)).t;
  await sql(`update public.introducers set active = false where id = $1`, [iid]);
  const read1 = await call(ic.getCustomerIntroducer, { customerId: c }, U.ownerA);
  const c2 = await newCustomer("life deactivate new");
  const snap = await attr.snapshotTenantCustomerState(adminDb, c2, T.a);
  await attr.createTenantAttributionIfEligible(adminDb, {
    customerId: c2,
    tenantId: T.a,
    introducerId: iid,
    source: "booking",
    snapshot: snap,
  });
  ok(
    "B3-42 deactivating an introducer keeps existing attributions (still shown) but it attracts no new ones",
    (await linkOf(T.a, c))?.t === before &&
      read1.ok &&
      read1.value.introducerId === iid &&
      !(await linkOf(T.a, c2)),
    describe(read1),
  );
}
{
  const iid = await addIntroducer(pg, {
    tenantId: T.a,
    code: "1011",
    name: "Soft Delete Ltd",
    slug: "intro-soft-delete",
  });
  const c = await newCustomer("life soft delete");
  await insertRow(pg, "public.customer_introducer_links", {
    tenant_id: T.a,
    customer_id: c,
    introducer_id: iid,
    source: "booking",
  });
  const soft = await outcome(() =>
    sql(`update public.introducers set deleted_at = now(), active = false where id = $1`, [iid]),
  );
  const hard = await outcome(() => sql(`delete from public.introducers where id = $1`, [iid]));
  ok(
    "B3-43 soft-deleting an attributed introducer is allowed and keeps the link; hard delete is refused (RESTRICT)",
    soft.ok && hard.code === "23001" && Boolean(await linkOf(T.a, c)),
    describe(soft, hard),
  );
}
{
  const c = await newCustomer("life customer delete");
  await insertRow(pg, "public.customer_introducer_links", {
    tenant_id: T.a,
    customer_id: c,
    introducer_id: I.a2,
    source: "booking",
  });
  await insertRow(pg, "public.introducer_amendment_history", {
    tenant_id: T.a,
    customer_id: c,
    new_introducer_id: I.a2,
  });
  const delCustomer = await outcome(() => sql(`delete from auth.users where id = $1`, [c]));
  const introUser = (await introRow(I.a2)).user_id;
  const delIntroUser = await outcome(() =>
    sql(`delete from auth.users where id = $1`, [introUser]),
  );
  ok(
    "B3-44 deleting a customer's Auth user removes only their rows (CASCADE kept); deleting an attributed introducer's Auth user is refused (recorded Test Account regression)",
    delCustomer.ok &&
      (await linksFor(c)).length === 0 &&
      delIntroUser.code === "23001" &&
      Boolean(await introRow(I.a2)),
    describe(delCustomer, delIntroUser),
  );
}

// =============================================================================================
// COMPANY CODE LOOKUP (45–49)
// =============================================================================================
{
  const r = await call(ic.lookupIntroducerByCode, { companyCode: "1001" }, U.ownerA);
  ok(
    "B3-45 Owner looks up a code in their tenant: that tenant's company only, no introducer id returned",
    r.ok &&
      r.value.companyName === "Alpha Introducers" &&
      r.value.companyCode === "1001" &&
      !("introducerId" in r.value),
    describe(r),
  );
}
async function check46() {
  const foreign = await call(ic.lookupIntroducerByCode, { companyCode: "2002" }, U.ownerA);
  const unknown = await call(ic.lookupIntroducerByCode, { companyCode: "9999" }, U.ownerA);
  return {
    pass: !foreign.ok && foreign.message === NO_CODE && !unknown.ok && unknown.message === NO_CODE,
    foreign,
  };
}
{
  const r = await check46();
  ok(
    "B3-46 a code that exists only in another tenant is indistinguishable from an unknown code",
    r.pass,
    describe(r.foreign),
  );
}
async function check47() {
  const r = await call(ic.lookupIntroducerByCode, { companyCode: "1005" }, U.ownerA);
  return { pass: !r.ok && r.message === NO_CODE, r };
}
{
  const r = await check47();
  ok(
    "B3-47 two active introducers sharing a code in the tenant fail closed (no first-row pick)",
    r.pass,
    describe(r.r),
  );
}
{
  const inactive = await call(ic.lookupIntroducerByCode, { companyCode: "1003" }, U.ownerA);
  const deleted = await call(ic.lookupIntroducerByCode, { companyCode: "1004" }, U.ownerA);
  const sup = await call(ic.lookupIntroducerByCode, { companyCode: "1001" }, U.supA);
  const adv = await call(ic.lookupIntroducerByCode, { companyCode: "1001" }, U.advA);
  ok(
    "B3-48 inactive or soft-deleted codes are not found; Supervisor and adviser are refused (Owner only)",
    inactive.message === NO_CODE &&
      deleted.message === NO_CODE &&
      !sup.ok &&
      !adv.ok &&
      sup.message === "Forbidden" &&
      adv.message === "Forbidden",
    describe(inactive, deleted, sup, adv),
  );
}
{
  const bad = await call(ic.lookupIntroducerByCode, { companyCode: "12a4" }, U.ownerA);
  const dual = await addUser(pg, "dual owner");
  await addMember(pg, dual, T.a, "owner");
  await addMember(pg, dual, T.b, "owner");
  const noCtx = await call(ic.lookupIntroducerByCode, { companyCode: "1001" }, dual, null);
  const badTenant = await outcome(() =>
    attr.resolveTenantIntroducerByCode(adminDb, "not-a-uuid", "1001"),
  );
  ok(
    "B3-49 malformed codes, an ambiguous acting tenant and a malformed tenant id are all refused",
    !bad.ok && !noCtx.ok && !badTenant.ok && badTenant.message === NO_CODE,
    describe(bad, noCtx, badTenant),
  );
}

// =============================================================================================
// AMENDMENT (50–60)
// =============================================================================================
const tableCount = async (t, where = "true", params = []) =>
  (await one(`select count(*)::int as n from ${t} where ${where}`, params)).n;
{
  const c = await newCustomer("amend main");
  const s = await addSession(pg, { customerId: c, tenantId: T.a });
  await insertRow(pg, "public.customer_introducer_links", {
    tenant_id: T.a,
    customer_id: c,
    introducer_id: I.a,
    source: "booking",
    created_at: "2026-01-01T00:00:00Z",
    effective_from: "2026-01-01T00:00:00Z",
  });
  const r = await call(
    ic.amendCustomerIntroducer,
    { customerId: c, sessionId: s, companyCode: "1002", note: "Synthetic correction" },
    U.ownerA,
  );
  const link = await linkOf(T.a, c);
  const hist = await sql(
    `select * from public.introducer_amendment_history where customer_id = $1`,
    [c],
  );
  const audit = await sql(`select * from public.finance_audit_log where customer_id = $1`, [c]);
  const log = await sql(`select * from public.customer_contact_log where session_id = $1`, [s]);
  ok(
    "B3-50 Owner amendment: link repointed (source amended, effective_from now, created_at kept) + tenant history + tenant finance audit (no money) + tenant contact note",
    r.ok &&
      r.value.changed === true &&
      link?.introducer_id === I.a2 &&
      link?.source === "amended" &&
      new Date(link.created_at).toISOString() === "2026-01-01T00:00:00.000Z" &&
      new Date(link.effective_from) > new Date("2026-06-01") &&
      hist.length === 1 &&
      hist[0].tenant_id === T.a &&
      hist[0].previous_introducer_id === I.a &&
      hist[0].new_introducer_id === I.a2 &&
      hist[0].company_code === "1002" &&
      hist[0].commission_refreshed === false &&
      hist[0].session_id === s &&
      hist[0].note === "Synthetic correction" &&
      audit.length === 1 &&
      audit[0].tenant_id === T.a &&
      audit[0].audit_type === "introducer_amendment" &&
      !/pence|amount/.test(JSON.stringify(audit[0].detail)) &&
      log.length === 1 &&
      log[0].tenant_id === T.a &&
      /historical commission is unchanged/.test(log[0].body),
    describe(r),
  );
}
/** RPC structural invariant: a customer with no relationship to the tenant is never attributed. */
async function check51(db) {
  const c = await addUser(db, "rpc b only");
  await addMember(db, c, T.b, "customer");
  const owner = await addUser(db, "rpc owner");
  const ia = (
    await sqlOn(
      db,
      `select id from public.introducers where tenant_id = $1 and company_code = '1001' and active order by created_at limit 1`,
      [T.a],
    )
  )[0].id;
  const res = await rpcAs(db, "service_role", {
    tenant: T.a,
    customer: c,
    introducer: ia,
    by: owner,
  });
  const links = await sqlOn(
    db,
    `select * from public.customer_introducer_links where customer_id = $1`,
    [c],
  );
  return {
    pass: !res.ok && /attribution_customer_not_found/.test(res.message) && links.length === 0,
    created: links.length > 0,
    detail: res.ok ? "ok" : res.message,
  };
}
{
  const c = await newCustomer("amend b only", [T.b]);
  await insertRow(pg, "public.customer_introducer_links", {
    tenant_id: T.b,
    customer_id: c,
    introducer_id: I.b,
    source: "booking",
  });
  const before = await allState();
  const app = await call(
    ic.amendCustomerIntroducer,
    { customerId: c, companyCode: "1001" },
    U.ownerA,
  );
  const unchanged = (await allState()) === before;
  const rpc = await check51(pg);
  ok(
    "B3-51 a customer of another tenant only: Owner amendment → Not found, RPC refuses (customer_not_found), nothing written",
    !app.ok && app.message === NOT_FOUND && unchanged && rpc.pass,
    describe(app, { message: rpc.detail }),
  );
}
{
  const c = await newCustomer("amend foreign intro");
  await insertRow(pg, "public.customer_introducer_links", {
    tenant_id: T.a,
    customer_id: c,
    introducer_id: I.a,
    source: "booking",
  });
  const before = await allState();
  const app = await call(
    ic.amendCustomerIntroducer,
    { customerId: c, companyCode: "2002" },
    U.ownerA,
  );
  const rpc = await rpcAs(pg, "service_role", {
    tenant: T.a,
    customer: c,
    introducer: I.bOnly,
    by: U.ownerA,
  });
  const rpcInactive = await rpcAs(pg, "service_role", {
    tenant: T.a,
    customer: c,
    introducer: I.aInactive,
    by: U.ownerA,
  });
  ok(
    "B3-52 another tenant's (or an inactive) introducer is refused by both the app and the RPC; nothing written",
    !app.ok &&
      app.message === NO_CODE &&
      /attribution_introducer_not_found/.test(rpc.message) &&
      /attribution_introducer_not_found/.test(rpcInactive.message) &&
      (await allState()) === before,
    describe(app),
  );
}
/** Atomicity: a failing history insert must roll back the link change and the audit row. */
async function check53(db) {
  const c = await addUser(db, "rpc atomic");
  await addMember(db, c, T.a, "customer");
  const ia = (
    await sqlOn(
      db,
      `select id from public.introducers where tenant_id = $1 and company_code = '1001' and active order by created_at limit 1`,
      [T.a],
    )
  )[0].id;
  const ia2 = await addIntroducer(db, {
    tenantId: T.a,
    code: "1077",
    name: "Atomic Two",
    slug: `atomic-two-${randomUUID().slice(0, 8)}`,
  });
  await insertRow(db, "public.customer_introducer_links", {
    tenant_id: T.a,
    customer_id: c,
    introducer_id: ia,
    source: "booking",
  });
  const before = (
    await sqlOn(
      db,
      `select l::text as t from public.customer_introducer_links l where customer_id = $1`,
      [c],
    )
  )[0].t;
  const audits = (
    await sqlOn(
      db,
      `select count(*)::int as n from public.finance_audit_log where customer_id = $1`,
      [c],
    )
  )[0].n;
  await execOn(
    db,
    `
    create or replace function public.b3_fail_history() returns trigger language plpgsql as $f$
    begin raise exception 'synthetic history failure'; end $f$;
    create trigger b3_fail_history before insert on public.introducer_amendment_history
      for each row execute function public.b3_fail_history();`,
  );
  const res = await rpcAs(db, "service_role", { tenant: T.a, customer: c, introducer: ia2, by: c });
  await execOn(
    db,
    `drop trigger b3_fail_history on public.introducer_amendment_history; drop function public.b3_fail_history();`,
  );
  const after = (
    await sqlOn(
      db,
      `select l::text as t, introducer_id from public.customer_introducer_links l where customer_id = $1`,
      [c],
    )
  )[0];
  const auditsAfter = (
    await sqlOn(
      db,
      `select count(*)::int as n from public.finance_audit_log where customer_id = $1`,
      [c],
    )
  )[0].n;
  return {
    pass: !res.ok && after.t === before && auditsAfter === audits,
    changedWithoutHistory: after.introducer_id === ia2,
    detail: res.ok ? "ok" : res.message,
  };
}
{
  const r = await check53(pg);
  ok(
    "B3-53 amendment is atomic: a history failure rolls back the link change and writes no audit",
    r.pass,
    r.detail,
  );
}
{
  const c = await newCustomer("amend same");
  const s = await addSession(pg, { customerId: c, tenantId: T.a });
  await insertRow(pg, "public.customer_introducer_links", {
    tenant_id: T.a,
    customer_id: c,
    introducer_id: I.a2,
    source: "booking",
  });
  const before = await allState();
  const r = await call(
    ic.amendCustomerIntroducer,
    { customerId: c, sessionId: s, companyCode: "1002" },
    U.ownerA,
  );
  ok(
    "B3-54 amending to the current introducer is a no-op: changed=false, no history, audit or contact note",
    r.ok && r.value.changed === false && (await allState()) === before,
    describe(r),
  );
}
{
  const c = await newCustomer("amend insert");
  const r = await call(
    ic.amendCustomerIntroducer,
    { customerId: c, companyCode: "1001" },
    U.ownerA,
  );
  const link = await linkOf(T.a, c);
  const hist = await sql(
    `select * from public.introducer_amendment_history where customer_id = $1`,
    [c],
  );
  ok(
    "B3-55 a customer of the tenant with no attribution gets one (source amended); history previous is NULL",
    r.ok &&
      link?.introducer_id === I.a &&
      link?.source === "amended" &&
      hist.length === 1 &&
      hist[0].previous_introducer_id === null &&
      hist[0].tenant_id === T.a,
    describe(r),
  );
}
{
  const c = await newCustomer("amend session");
  const other = await newCustomer("amend session other");
  const sOther = await addSession(pg, { customerId: other, tenantId: T.a });
  const sBinned = await addSession(pg, { customerId: c, tenantId: T.a, deleted: true });
  const cb = await newCustomer("amend session b", [T.a, T.b]);
  const sB = await addSession(pg, { customerId: cb, tenantId: T.b });
  const before = await allState();
  const r1 = await call(
    ic.amendCustomerIntroducer,
    { customerId: c, sessionId: sOther, companyCode: "1001" },
    U.ownerA,
  );
  const r2 = await call(
    ic.amendCustomerIntroducer,
    { customerId: c, sessionId: sBinned, companyCode: "1001" },
    U.ownerA,
  );
  const r3 = await call(
    ic.amendCustomerIntroducer,
    { customerId: cb, sessionId: sB, companyCode: "1001" },
    U.ownerA,
  );
  const rpc = await rpcAs(pg, "service_role", {
    tenant: T.a,
    customer: cb,
    introducer: I.a,
    by: U.ownerA,
    session: sB,
  });
  ok(
    "B3-56 a session of another customer, a binned session or another tenant's session → Not found everywhere; nothing written",
    [r1, r2, r3].every((r) => !r.ok && r.message === NOT_FOUND) &&
      /attribution_session_not_found/.test(rpc.message) &&
      (await allState()) === before,
    describe(r1, r2, r3),
  );
}
{
  const c = await newCustomer("amend roles");
  await addSession(pg, { customerId: c, tenantId: T.a });
  const before = await allState();
  const sup = await call(
    ic.amendCustomerIntroducer,
    { customerId: c, companyCode: "1001" },
    U.supA,
  );
  const adv = await call(
    ic.amendCustomerIntroducer,
    { customerId: c, companyCode: "1001" },
    U.advA,
  );
  const ownerB = await call(
    ic.amendCustomerIntroducer,
    { customerId: c, companyCode: "1001" },
    U.ownerB,
    SLUG.b,
  );
  const ownerWrongSlug = await call(
    ic.amendCustomerIntroducer,
    { customerId: c, companyCode: "1001" },
    U.ownerB,
    SLUG.a,
  );
  ok(
    "B3-57 Supervisor, adviser, another tenant's Owner (own or forged slug) cannot amend; nothing written",
    [sup, adv, ownerB, ownerWrongSlug].every((r) => !r.ok) &&
      ownerB.message === NOT_FOUND &&
      (await allState()) === before,
    describe(sup, adv, ownerB, ownerWrongSlug),
  );
}
{
  const c = await newCustomer("amend two tenants", [T.a, T.b]);
  await insertRow(pg, "public.customer_introducer_links", {
    tenant_id: T.b,
    customer_id: c,
    introducer_id: I.b,
    source: "booking",
  });
  await insertRow(pg, "public.introducer_amendment_history", {
    tenant_id: T.b,
    customer_id: c,
    new_introducer_id: I.b,
  });
  const bLink = (await linkOf(T.b, c)).t;
  const bHist = JSON.stringify(
    await sql(
      `select h::text from public.introducer_amendment_history h where tenant_id = $1 and customer_id = $2`,
      [T.b, c],
    ),
  );
  const r = await call(
    ic.amendCustomerIntroducer,
    { customerId: c, companyCode: "1001" },
    U.ownerA,
  );
  ok(
    "B3-58 amending in one tenant leaves the other tenant's attribution and history byte-identical",
    r.ok &&
      (await linkOf(T.a, c))?.introducer_id === I.a &&
      (await linkOf(T.b, c))?.t === bLink &&
      JSON.stringify(
        await sql(
          `select h::text from public.introducer_amendment_history h where tenant_id = $1 and customer_id = $2`,
          [T.b, c],
        ),
      ) === bHist,
    describe(r),
  );
}
{
  const c = await newCustomer("rpc invalid");
  const nul = await rpcAs(pg, "service_role", {
    tenant: T.a,
    customer: c,
    introducer: null,
    by: U.ownerA,
  });
  const longNote = await rpcAs(pg, "service_role", {
    tenant: T.a,
    customer: c,
    introducer: I.a,
    by: U.ownerA,
    note: "x".repeat(501),
  });
  const cc = await newCustomer("rpc inactive tenant", [T.c]);
  const inactive = await rpcAs(pg, "service_role", {
    tenant: T.c,
    customer: cc,
    introducer: I.c,
    by: U.ownerA,
  });
  ok(
    "B3-59 RPC input invariants: NULL arguments or a note over 500 chars → attribution_invalid; inactive tenant → attribution_tenant_inactive",
    /attribution_invalid/.test(nul.message) &&
      /attribution_invalid/.test(longNote.message) &&
      /attribution_tenant_inactive/.test(inactive.message) &&
      (await linksFor(c)).length === 0,
  );
}
{
  const c = await newCustomer("rpc scope");
  const others = [
    "public.introducers",
    "public.appointments",
    "public.interview_sessions",
    "public.finance_ledger",
    "public.commission_rates",
    "public.tenant_memberships",
    "public.customer_contact_log",
    "public.introducer_leads",
    "public.referrals",
  ];
  const before = await businessState(pg, others);
  const counts = async () => [
    await tableCount("public.customer_introducer_links", "customer_id = $1", [c]),
    await tableCount("public.introducer_amendment_history", "customer_id = $1", [c]),
    await tableCount("public.finance_audit_log", "customer_id = $1", [c]),
  ];
  const res = await rpcAs(pg, "service_role", {
    tenant: T.a,
    customer: c,
    introducer: I.a,
    by: U.ownerA,
  });
  const errMsgs = [
    await call(ic.amendCustomerIntroducer, { customerId: c, companyCode: "2002" }, U.ownerA),
    await call(
      ic.amendCustomerIntroducer,
      { customerId: randomUUID(), companyCode: "1001" },
      U.ownerA,
    ),
  ];
  ok(
    "B3-60 the RPC writes only link, history and finance audit; app errors never name tenants, introducers or codes of others",
    res.ok &&
      JSON.stringify(await counts()) === "[1,1,1]" &&
      (await businessState(pg, others)) === before &&
      errMsgs.every(
        (r) =>
          !r.ok &&
          ![T.a, T.b, "Bravo", "tenant-b", "2002", I.bOnly].some((s) => r.message.includes(s)),
      ),
    describe(...errMsgs),
  );
}

// =============================================================================================
// READS (61–67)
// =============================================================================================
const readCustomers = {};
readCustomers.both = await newCustomer("read both", [T.a, T.b]);
await insertRow(pg, "public.customer_introducer_links", {
  tenant_id: T.a,
  customer_id: readCustomers.both,
  introducer_id: I.a,
  source: "booking",
});
await insertRow(pg, "public.customer_introducer_links", {
  tenant_id: T.b,
  customer_id: readCustomers.both,
  introducer_id: I.b,
  source: "booking",
});
readCustomers.bLinkOnly = await newCustomer("read b link only", [T.a, T.b]);
await insertRow(pg, "public.customer_introducer_links", {
  tenant_id: T.b,
  customer_id: readCustomers.bLinkOnly,
  introducer_id: I.b,
  source: "booking",
});
readCustomers.aOnly = await newCustomer("read a only", [T.a]);
await insertRow(pg, "public.customer_introducer_links", {
  tenant_id: T.a,
  customer_id: readCustomers.aOnly,
  introducer_id: I.a2,
  source: "booking",
});
async function check61(mod = ic) {
  const both = await call(mod.getCustomerIntroducer, { customerId: readCustomers.both }, U.ownerA);
  const bOnly = await call(
    mod.getCustomerIntroducer,
    { customerId: readCustomers.bLinkOnly },
    U.ownerA,
  );
  const foreign = await call(
    mod.getCustomerIntroducer,
    { customerId: readCustomers.aOnly },
    U.ownerB,
    SLUG.b,
  );
  const bView = await call(
    mod.getCustomerIntroducer,
    { customerId: readCustomers.both },
    U.ownerB,
    SLUG.b,
  );
  return {
    pass:
      both.ok &&
      both.value.introducerId === I.a &&
      both.value.companyName === "Alpha Introducers" &&
      bOnly.ok &&
      bOnly.value.introducerId === null &&
      !foreign.ok &&
      foreign.message === NOT_FOUND &&
      bView.ok &&
      bView.value.introducerId === I.b,
    foreign,
    detail: describe(both, bOnly, foreign, bView),
  };
}
{
  const r = await check61();
  ok(
    "B3-61 getCustomerIntroducer: authorised customer in the acting tenant; only that tenant's attribution; another tenant's customer → Not found",
    r.pass,
    r.detail,
  );
}
{
  const c = await newCustomer("read no writes");
  const s = await addSession(pg, { customerId: c, tenantId: T.a });
  await addAppointment(pg, { sessionId: s, tenantId: T.a, advisorId: U.advA, introducerId: I.a });
  await insertRow(pg, "public.introducer_leads", {
    introducer_id: I.b,
    tenant_id: T.b,
    customer_email: (await one(`select email from public.profiles where id = $1`, [c])).email,
  });
  const before = await allState();
  const r = await call(ic.getCustomerIntroducer, { customerId: c, sessionId: s }, U.ownerA);
  const wrongSession = await call(
    ic.getCustomerIntroducer,
    { customerId: readCustomers.aOnly, sessionId: s },
    U.ownerA,
  );
  ok(
    "B3-62 reads never write and never guess: appointment/lead/email evidence yields no attribution and no link; a session of another customer → Not found",
    r.ok &&
      r.value.introducerId === null &&
      (await allState()) === before &&
      !wrongSession.ok &&
      wrongSession.message === NOT_FOUND,
    describe(r, wrongSession),
  );
}
{
  const both = await call(sf.getCustomerHub, { customerId: readCustomers.both }, U.ownerA);
  const bOnly = await call(sf.getCustomerHub, { customerId: readCustomers.bLinkOnly }, U.ownerA);
  ok(
    "B3-63 customer hub shows only the acting tenant's introducer (another tenant's is never shown)",
    both.ok &&
      both.value.introducer?.id === I.a &&
      both.value.introducer?.tenantSlug === SLUG.a &&
      bOnly.ok &&
      bOnly.value.introducer === null,
    describe(both, bOnly),
  );
}
{
  const r = await call(sf.exportOwnerCustomerReport, undefined, U.ownerA);
  const rows = r.ok ? r.value.rows : [];
  const find = (id) => rows.find((x) => x.customerId === id);
  ok(
    "B3-64 Owner customer report names introducers from this tenant's attribution only",
    r.ok &&
      find(readCustomers.both)?.introducer === "Alpha Introducers" &&
      !rows.some((x) => /Bravo/.test(x.introducer ?? "")),
    describe(r),
  );
}
{
  const bookingSrc = SRC.booking;
  const block = bookingSrc.slice(
    bookingSrc.indexOf("export const listAdvisorContacts"),
    bookingSrc.indexOf("backfillWelcomeCallsFromAppointments, listOpenStaffContactTasks"),
  );
  const linkRead =
    block.match(
      /\.from\("customer_introducer_links"\)[\s\S]*?\.in\("customer_id", customerIds\);/,
    )?.[0] ?? "";
  const introRead =
    block.match(/\.from\("introducers"\)[\s\S]*?\.in\("id", introIds\);/)?.[0] ?? "";
  ok(
    "B3-65 adviser contacts read attribution and introducers with the acting tenant predicate only (no effective-tenant fallback)",
    /\.eq\("tenant_id", tenantId\)/.test(linkRead) &&
      /\.eq\("tenant_id", tenantId\)/.test(introRead) &&
      !/introTenant|tenant_id \?\?/.test(
        block.slice(block.indexOf('from("customer_introducer_links")')),
      ),
  );
}
{
  const c = await newCustomer("journey b link", [T.a, T.b]);
  await addSession(pg, { customerId: c, tenantId: T.a });
  await insertRow(pg, "public.customer_introducer_links", {
    tenant_id: T.b,
    customer_id: c,
    introducer_id: I.b,
    source: "booking",
  });
  const c2 = await newCustomer("journey a link");
  await addSession(pg, { customerId: c2, tenantId: T.a });
  await insertRow(pg, "public.customer_introducer_links", {
    tenant_id: T.a,
    customer_id: c2,
    introducer_id: I.a,
    source: "booking",
  });
  const r = await call(jf.listJourneyAnalyticsLeads, undefined, U.ownerA);
  const leads = r.ok ? r.value.leads : [];
  const leadFor = (id) => leads.find((l) => l.customerId === id);
  ok(
    "B3-66 journey analytics flags introducer customers from this tenant's attribution only",
    r.ok &&
      leadFor(c2)?.generator === "introducer" &&
      Boolean(leadFor(c)) &&
      leadFor(c).generator !== "introducer",
    describe(r, { message: JSON.stringify([leadFor(c)?.generator, leadFor(c2)?.generator]) }),
  );
  globalThis.__B3_JOURNEY = { c, c2, leads: [leadFor(c), leadFor(c2)] };
}
/** Commission resolver: tenant from the customer's own session; no other tenant; no guessing. */
async function check67(resolver = attr.resolveIntroducerIdForCustomerAtDate) {
  const c = await newCustomer("asof", [T.a, T.b]);
  const sA = await addSession(pg, { customerId: c, tenantId: T.a });
  const sNull = await addSession(pg, { customerId: c, tenantId: null });
  const email = (await one(`select email from public.profiles where id = $1`, [c])).email;
  await insertRow(pg, "public.introducer_leads", {
    introducer_id: I.b,
    tenant_id: T.b,
    customer_email: email,
  });
  const noLinkYet = await resolver(adminDb, c, new Date(), sA);
  await insertRow(pg, "public.customer_introducer_links", {
    tenant_id: T.b,
    customer_id: c,
    introducer_id: I.b,
    source: "booking",
  });
  const onlyForeign = await resolver(adminDb, c, new Date(), sA);
  await insertRow(pg, "public.customer_introducer_links", {
    tenant_id: T.a,
    customer_id: c,
    introducer_id: I.a,
    source: "booking",
    effective_from: "2026-01-01T00:00:00Z",
    created_at: "2026-01-01T00:00:00Z",
  });
  const current = await resolver(adminDb, c, new Date(), sA);
  await sql(
    `update public.customer_introducer_links set introducer_id = $3, effective_from = '2026-08-01T00:00:00Z' where tenant_id = $1 and customer_id = $2`,
    [T.a, c, I.a2],
  );
  await insertRow(pg, "public.introducer_amendment_history", {
    tenant_id: T.a,
    customer_id: c,
    previous_introducer_id: I.a,
    new_introducer_id: I.a2,
    effective_from: "2026-08-01T00:00:00Z",
  });
  const beforeAmend = await resolver(adminDb, c, new Date("2026-03-01T00:00:00Z"), sA);
  const afterAmend = await resolver(adminDb, c, new Date("2026-09-01T00:00:00Z"), sA);
  const tenantless = await resolver(adminDb, c, new Date(), sNull);
  const noSession = await resolver(adminDb, c, new Date(), null);
  const otherCustomersSession = await resolver(adminDb, readCustomers.aOnly, new Date(), sA);
  const results = {
    noLinkYet,
    onlyForeign,
    current,
    beforeAmend,
    afterAmend,
    tenantless,
    noSession,
    otherCustomersSession,
  };
  return {
    pass:
      noLinkYet === null &&
      onlyForeign === null &&
      current === I.a &&
      beforeAmend === I.a &&
      afterAmend === I.a2 &&
      tenantless === null &&
      noSession === null &&
      otherCustomersSession === null,
    results,
  };
}
{
  const r = await check67();
  ok(
    "B3-67 commission resolver: tenant from the session only; other tenants, tenantless sessions, email/phone leads never used; as-of history honoured",
    r.pass,
    JSON.stringify(r.results),
  );
}

// =============================================================================================
// FINANCE / PRESERVATION / SCOPE (68–72)
// =============================================================================================
async function check68(mod = ic) {
  const c = await newCustomer("refresh");
  const s = await addSession(pg, { customerId: c, tenantId: T.a });
  await insertRow(pg, "public.customer_introducer_links", {
    tenant_id: T.a,
    customer_id: c,
    introducer_id: I.a,
    source: "booking",
  });
  await insertRow(pg, "public.finance_ledger", {
    session_id: s,
    kind: "commission",
    beneficiary_role: "introducer",
    beneficiary_user_id: U.ownerB,
    amount_pence: 1234,
    fee_type: "mortgage",
    tenant_id: T.a,
  });
  const ledgerBefore = JSON.stringify((await rowsText(pg, "public.finance_ledger")).sort());
  const m = requestCount;
  const r = await call(
    mod.refreshCustomerIntroducerCommission,
    { customerId: c, sessionId: s },
    U.ownerA,
  );
  return {
    pass:
      !r.ok &&
      r.message === ic.COMMISSION_REFRESH_DISABLED_MESSAGE &&
      requestCount === m &&
      JSON.stringify((await rowsText(pg, "public.finance_ledger")).sort()) === ledgerBefore,
    ledgerWritten:
      JSON.stringify((await rowsText(pg, "public.finance_ledger")).sort()) !== ledgerBefore,
    detail: describe(r),
  };
}
{
  const r = await check68();
  ok(
    "B3-68 Refresh Commission fails closed before any database call; ledger untouched (UI and text unchanged)",
    r.pass,
    r.detail,
  );
}
{
  const b2b = spawnSync(process.execPath, [...process.execArgv, resolve(root, B2B_VERIFIER)], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, SUPABASE_URL: "", VITE_SUPABASE_URL: "" },
    timeout: 300000,
  });
  const out = `${b2b.stdout ?? ""}`;
  ok(
    "B3-69 the G7F-4S4C4-B2b verifier passes unchanged against this tree",
    b2b.status === 0 && /ALL B2B CHECKS PASSED/.test(out),
    (out.match(/RESULT=.*$/m) ?? [`exit ${b2b.status}`])[0],
  );
}
{
  const finance = read(FINANCE_REL);
  const call0 = finance.match(
    /resolveIntroducerIdForCustomerAtDate\(\s*supabaseAdmin,\s*session\.customer_id,\s*new Date\(now\),\s*data\.sessionId,?\s*\)/,
  );
  const sig = (s) =>
    s.match(
      /export async function resolveIntroducerIdForCustomerAtDate\([\s\S]*?\): Promise<string \| null> \{/,
    )?.[0] ?? null;
  const headSig = sig(git("show", `HEAD:${ATTR_REL}`));
  ok(
    "B3-70 finance.functions.ts byte-identical to HEAD; its resolver call (customer, asOf, sessionId) matches the kept export signature",
    git("diff", "--quiet", "HEAD", "--", FINANCE_REL) === "" &&
      Boolean(call0) &&
      Boolean(headSig) &&
      sig(SRC.attr) === headSig,
  );
}
{
  const base0 = git("show", `HEAD:${BOOKING_REL}`);
  const slice = (s) =>
    s.slice(
      s.indexOf("function slugifyStaffName("),
      s.indexOf("async function sendBookingConfirmations("),
    );
  const fnOf = (s) => {
    const i = s.indexOf("async function ensureStaffIntroducerRecord(");
    return s.slice(i, s.indexOf("\n}\n", i) + 3);
  };
  const constOf = (s, n) =>
    s.slice(s.indexOf(`export const ${n}`), s.indexOf("\n  });\n", s.indexOf(`export const ${n}`)));
  ok(
    "B3-71 ensureStaffIntroducerRecord, both booking-link senders and referrals (B2b qualification/finance guard) byte-identical to HEAD; 7 bookAppointmentTrusted call sites",
    fnOf(SRC.booking) === fnOf(base0) &&
      fnOf(SRC.booking).length > 1000 &&
      slice(SRC.booking) === slice(base0) &&
      ["sendStaffCustomerBookingLink", "sendIntroducerCustomerBookingLink"].every(
        (n) => constOf(SRC.booking, n) === constOf(base0, n),
      ) &&
      git("diff", "--quiet", "HEAD", "--", REFERRALS_REL) === "" &&
      SRC.booking.split("bookAppointmentTrusted(").length - 1 === 7 &&
      SRC.booking.includes("introducerId = await ensureStaffIntroducerRecord(actingUserId);"),
  );
}
{
  const changed = git(
    "status",
    "--porcelain",
    "--untracked-files=all",
    "--",
    ".",
    ":(exclude)brand",
    ":(exclude)docs/legal",
  )
    .split("\n")
    .filter(Boolean)
    .map((l) => l.slice(3));
  const stashes = git("stash", "list").trim().split("\n").filter(Boolean);
  const refused = unknownCalls.filter((x) => !x.startsWith("refused host"));
  ok(
    "B3-72 scope: only the 7 authorised files differ from HEAD; stash intact; no network; no unexpected backend calls",
    changed.every((f) => AUTHORISED.includes(f)) &&
      changed.length <= AUTHORISED.length &&
      stashes.length === 9 &&
      git("rev-parse", "stash@{0}").trim() === "bdb470fdf10aa42bc8fae5ab8928035d2e8836e9" &&
      unknownCalls.length === 0,
    `changed=${changed.join(",")} stashes=${stashes.length} unknown=${refused.slice(0, 3).join(";")}`,
  );
}

// =============================================================================================
// AS-OF RESOLVER (73–76) — real resolver, real amendment RPC, real migrated keys
// =============================================================================================
const pause = (ms = 15) => new Promise((r) => setTimeout(r, ms));
const ms = (t) => new Date(t).getTime();
const mid = (a, b) => new Date((ms(a) + ms(b)) / 2);
const shift = (t, delta) => new Date(ms(t) + delta);
const HOUR = 3_600_000;
const asOf = (customerId, at, sessionId, resolver = attr.resolveIntroducerIdForCustomerAtDate) =>
  resolver(adminDb, customerId, new Date(at), sessionId);
async function amendVia(tenant, customer, introducer, session) {
  const r = await rpcAs(pg, "service_role", {
    tenant,
    customer,
    introducer,
    by: U.ownerA,
    session,
  });
  if (!r.ok) throw new Error(`amend failed: ${r.message}`);
  return r.rows[0].effective_from;
}
const linkCreatedAt = async (tenant, customer) =>
  (
    await one(
      `select created_at from public.customer_introducer_links where tenant_id = $1 and customer_id = $2`,
      [tenant, customer],
    )
  )?.created_at ?? null;
{
  const c = await newCustomer("asof chain");
  const sA = await addSession(pg, { customerId: c, tenantId: T.a });
  const iC = await addIntroducer(pg, {
    tenantId: T.a,
    code: "1079",
    name: "Alpha Chain Three",
    slug: `alpha-chain-three-${randomUUID().slice(0, 8)}`,
  });
  await insertRow(pg, "public.customer_introducer_links", {
    tenant_id: T.a,
    customer_id: c,
    introducer_id: I.a,
    source: "booking",
  });
  const t0 = await linkCreatedAt(T.a, c);
  await pause();
  const t1 = await amendVia(T.a, c, I.a2, sA);
  await pause();
  const t2 = await amendVia(T.a, c, iC, sA);
  const hist = await sql(
    `select previous_introducer_id as p, new_introducer_id as n from public.introducer_amendment_history
      where tenant_id = $1 and customer_id = $2 order by effective_from`,
    [T.a, c],
  );
  const r = {
    beforeFirst: await asOf(c, shift(t0, -HOUR), sA),
    inA: await asOf(c, mid(t0, t1), sA),
    atB: await asOf(c, shift(t1, 1), sA),
    inB: await asOf(c, mid(t1, t2), sA),
    inC: await asOf(c, shift(t2, HOUR), sA),
  };
  ok(
    "B3-73 three-step chain A → B → C: each date inside a period resolves to that period's introducer; before the first attribution → null",
    hist.length === 2 &&
      hist[0].p === I.a &&
      hist[0].n === I.a2 &&
      hist[1].p === I.a2 &&
      hist[1].n === iC &&
      r.beforeFirst === null &&
      r.inA === I.a &&
      r.atB === I.a2 &&
      r.inB === I.a2 &&
      r.inC === iC,
    JSON.stringify(r),
  );
}
{
  const c = await newCustomer("asof first via rpc");
  const sA = await addSession(pg, { customerId: c, tenantId: T.a });
  const t1 = await amendVia(T.a, c, I.a, sA);
  const link = await one(
    `select source, created_at from public.customer_introducer_links where tenant_id = $1 and customer_id = $2`,
    [T.a, c],
  );
  const hist = await sql(
    `select previous_introducer_id as p from public.introducer_amendment_history where tenant_id = $1 and customer_id = $2`,
    [T.a, c],
  );
  const r = {
    dayBefore: await asOf(c, shift(t1, -24 * HOUR), sA),
    justBefore: await asOf(c, shift(t1, -5), sA),
    after: await asOf(c, shift(t1, HOUR), sA),
  };
  ok(
    "B3-74 first attribution created by the real RPC (no previous introducer): dates before it → null, after it → the introducer",
    link?.source === "amended" &&
      ms(link.created_at) === ms(t1) &&
      hist.length === 1 &&
      hist[0].p === null &&
      r.dayBefore === null &&
      r.justBefore === null &&
      r.after === I.a,
    JSON.stringify(r),
  );
}
{
  const c = await newCustomer("asof cross tenant", [T.a, T.b]);
  const sA = await addSession(pg, { customerId: c, tenantId: T.a });
  const sB = await addSession(pg, { customerId: c, tenantId: T.b });
  await insertRow(pg, "public.customer_introducer_links", {
    tenant_id: T.b,
    customer_id: c,
    introducer_id: I.b,
    source: "booking",
  });
  const tB0 = await linkCreatedAt(T.b, c);
  await pause();
  const tB1 = await amendVia(T.b, c, I.bOnly, sB);
  const onlyB = {
    earlier: await asOf(c, mid(tB0, tB1), sA),
    later: await asOf(c, shift(tB1, HOUR), sA),
  };
  await pause();
  await insertRow(pg, "public.customer_introducer_links", {
    tenant_id: T.a,
    customer_id: c,
    introducer_id: I.a,
    source: "booking",
  });
  const tA0 = await linkCreatedAt(T.a, c);
  const r = {
    onlyB,
    aEarlier: await asOf(c, mid(tB0, tB1), sA),
    aBetween: await asOf(c, mid(tB1, tA0), sA),
    aLater: await asOf(c, shift(tA0, HOUR), sA),
    bEarlier: await asOf(c, mid(tB0, tB1), sB),
    bLater: await asOf(c, shift(tA0, HOUR), sB),
  };
  ok(
    "B3-75 another tenant's attribution and history never influence resolution (earlier and later dates); the other tenant's session resolves only its own tenant",
    onlyB.earlier === null &&
      onlyB.later === null &&
      r.aEarlier === null &&
      r.aBetween === null &&
      r.aLater === I.a &&
      r.bEarlier === I.b &&
      r.bLater === I.bOnly,
    JSON.stringify(r),
  );
}
/** Pre-attribution boundary: as_of < link.created_at => null, even when a later amendment exists. */
async function check76(resolver = attr.resolveIntroducerIdForCustomerAtDate) {
  const c = await newCustomer("asof boundary");
  const sA = await addSession(pg, { customerId: c, tenantId: T.a });
  await insertRow(pg, "public.customer_introducer_links", {
    tenant_id: T.a,
    customer_id: c,
    introducer_id: I.a,
    source: "booking",
    created_at: "2026-02-01T00:00:00Z",
    effective_from: "2026-02-01T00:00:00Z",
  });
  const tAmend = await amendVia(T.a, c, I.a2, sA);
  const results = {
    jan15: await asOf(c, "2026-01-15T00:00:00Z", sA, resolver),
    atCreated: await asOf(c, "2026-02-01T00:00:00Z", sA, resolver),
    feb15: await asOf(c, "2026-02-15T00:00:00Z", sA, resolver),
    afterAmend: await asOf(c, shift(tAmend, HOUR), sA, resolver),
  };
  return {
    pass:
      results.jan15 === null &&
      results.atCreated === I.a &&
      results.feb15 === I.a &&
      results.afterAmend === I.a2,
    results,
  };
}
{
  const r = await check76();
  ok(
    "B3-76 pre-attribution boundary: as-of earlier than link.created_at → null (A from 1 Feb, A → B later, as-of 15 Jan); on/after created_at the holder is returned",
    r.pass,
    JSON.stringify(r.results),
  );
}

// =============================================================================================
// NEGATIVE CONTROLS — each mutates real source or the real migration, shows the unsafe effect
// on the database, and shows the corresponding test predicate rejects it.
// =============================================================================================
const POST_MARKER = "-- L. Postconditions.";
async function migratedDb(text) {
  const fx = await stagingDb();
  const r = await applyMigration(fx.db, text);
  if (!r.ok) throw new Error(`mutant migration failed: ${r.message}`);
  return fx;
}
const NEGATIVE_CONTROLS = [
  {
    name: "NC01 attribution read without tenant predicate → tenant A read returns tenant B's row (B3-61)",
    async detect() {
      return withAttrMutant(
        [
          [
            '    .select("introducer_id, effective_from, source")\n    .eq("tenant_id", tenantId)\n',
            '    .select("introducer_id, effective_from, source")\n',
          ],
        ],
        async () => {
          const leaked = await globalThis.__B3_ATTR.getTenantAttribution(
            adminDb,
            T.a,
            readCustomers.bLinkOnly,
          );
          const r = await check61();
          return { effect: leaked?.introducerId === I.b, caught: !r.pass };
        },
      );
    },
  },
  {
    name: "NC02 BR6 snapshot taken after the booking's writes → first booking self-disqualifies, attribution lost (B3-33)",
    async detect() {
      const snapDecl = `  const attributionSnapshot =
    customerIdForIntro && (introducerId || creditActingStaff)
      ? await snapshotTenantCustomerState(supabaseAdmin, customerIdForIntro, tenantId)
      : null;
`;
      const m = mutate(SRC.booking, [
        [snapDecl, "  let attributionSnapshot: any = null;\n"],
        [
          "  if (customerIdForIntro && introducerId && attributionSnapshot) {",
          "  if (customerIdForIntro && introducerId) attributionSnapshot = await snapshotTenantCustomerState(supabaseAdmin, customerIdForIntro, tenantId);\n  if (customerIdForIntro && introducerId && attributionSnapshot) {",
        ],
      ]);
      if (!m) return { effect: false, caught: false };
      const mod = await loadMutant("booking", m);
      const r = await check33(mod);
      return { effect: !r.pass, caught: !r.pass };
    },
  },
  {
    name: "NC03 case check removed → customer with an existing case is attributed (B3-31)",
    async detect() {
      return withAttrMutant(
        [["substantive: hasCase || hasAppointment,", "substantive: hasAppointment,"]],
        async () => {
          const r = await check31();
          return { effect: Boolean(await linkOf(T.a, r.c)), caught: !r.pass };
        },
      );
    },
  },
  {
    name: "NC04 appointment check removed → customer with an earlier appointment is attributed (B3-30)",
    async detect() {
      return withAttrMutant(
        [["substantive: hasCase || hasAppointment,", "substantive: hasCase,"]],
        async () => {
          const r = await check30();
          return { effect: Boolean(await linkOf(T.a, r.c)), caught: !r.pass };
        },
      );
    },
  },
  {
    name: "NC05 customer membership counted as existing → membership-only new customer loses attribution (B3-29)",
    async detect() {
      return withAttrMutant(
        [
          [
            "      substantive: hasCase || hasAppointment,",
            `      substantive: hasCase || hasAppointment || ((await db.from("tenant_memberships").select("id").eq("user_id", customerId).eq("tenant_id", tenantId).eq("active", true)).data ?? []).length > 0,`,
          ],
        ],
        async () => {
          const r = await check29();
          return { effect: !r.pass, caught: !r.pass };
        },
      );
    },
  },
  {
    name: "NC06 active check removed → inactive and deleted introducers are attributed (B3-37)",
    async detect() {
      return withAttrMutant(
        [
          [
            '      .eq("active", true)\n      .is("deleted_at", null)\n      .maybeSingle();',
            "      .maybeSingle();",
          ],
        ],
        async () => {
          const r = await check37();
          return { effect: r.out.inactive || r.out.deleted, caught: !r.pass };
        },
      );
    },
  },
  {
    name: "NC07 staff pre-check removed → deactivated staff registration revived and credited (B3-38)",
    async detect() {
      const m = mutate(SRC.booking, [
        ["      creditActingStaff = false;\n    }\n  }\n", "      void 0;\n    }\n  }\n"],
      ]);
      if (!m) return { effect: false, caught: false };
      const mod = await loadMutant("booking", m);
      const actor = await addUser(pg, "nc07 supervisor", "Nc Seven Supervisor");
      await addMember(pg, actor, T.a, "supervisor");
      const reg = await addIntroducer(pg, {
        tenantId: T.a,
        name: "Nc Seven",
        slug: `nc-seven-${randomUUID().slice(0, 8)}`,
        active: false,
        userId: actor,
      });
      const r = await check38(mod, actor, reg);
      return { effect: r.reactivated && r.linked, caught: !r.pass };
    },
  },
  {
    name: "NC08 overwriting insert (merge) → existing attribution overwritten by a later booking (B3-26)",
    async detect() {
      return withAttrMutant(
        [
          [
            '{ onConflict: "tenant_id,customer_id", ignoreDuplicates: true }',
            '{ onConflict: "tenant_id,customer_id" }',
          ],
        ],
        async () => {
          const r = await check26();
          return { effect: r.overwritten, caught: !r.pass };
        },
      );
    },
  },
  {
    name: "NC09 code lookup without tenant predicate → Owner A learns tenant B's company name (B3-46)",
    async detect() {
      return withAttrMutant(
        [
          [
            '    .eq("tenant_id", tenantId)\n    .eq("company_code", companyCode)',
            '    .eq("company_code", companyCode)',
          ],
        ],
        async () => {
          const r = await check46();
          return {
            effect: r.foreign.ok && r.foreign.value.companyName === "Bravo Only Ltd",
            caught: !r.pass,
          };
        },
      );
    },
  },
  {
    name: "NC10 first row taken on an ambiguous code → arbitrary introducer chosen (B3-47)",
    async detect() {
      return withAttrMutant(
        [["if (rows.length !== 1) throw", "if (rows.length === 0) throw"]],
        async () => {
          const r = await check47();
          return {
            effect: r.r.ok && /Ambiguous/.test(r.r.value.companyName ?? ""),
            caught: !r.pass,
          };
        },
      );
    },
  },
  {
    name: "NC11 EXECUTE granted to authenticated → a signed-in user runs the service-only amendment function body (B3-19)",
    async detect() {
      const text = `${b3Sql}\nGRANT EXECUTE ON FUNCTION public.amend_customer_introducer_attribution(uuid, uuid, uuid, uuid, uuid, text) TO authenticated;\n`;
      const fx = await migratedDb(text);
      const prober = await addUser(fx.db, "nc11 prober");
      const ran = await rpcAs(
        fx.db,
        "authenticated",
        { tenant: T.b, customer: null, introducer: randomUUID(), by: prober },
        prober,
      );
      const r = await check19(fx.db, {
        tenant: T.b,
        customer: fx.cust.l2,
        introducer: fx.ib,
        by: prober,
      });
      return { effect: !ran.ok && /attribution_invalid/.test(ran.message), caught: !r.pass };
    },
  },
  {
    name: "NC12 RPC customer-in-tenant check removed → tenant A attribution created for a customer of tenant B only (B3-51)",
    async detect() {
      const text = mutate(b3Sql, [
        [
          "    RAISE EXCEPTION 'attribution_customer_not_found' USING ERRCODE = 'no_data_found';\n  END IF;\n\n  IF p_session_id",
          "    NULL;\n  END IF;\n\n  IF p_session_id",
        ],
      ]);
      if (!text) return { effect: false, caught: false };
      const fx = await migratedDb(text);
      const r = await check51(fx.db);
      return { effect: r.created, caught: !r.pass };
    },
  },
  {
    name: "NC13 history failure swallowed → link changes with no history or audit trail (B3-53)",
    async detect() {
      const text = mutate(b3Sql, [
        [
          "  INSERT INTO public.introducer_amendment_history (",
          "  BEGIN\n  INSERT INTO public.introducer_amendment_history (",
        ],
        [
          "  RETURNING id INTO v_history;\n",
          "  RETURNING id INTO v_history;\n  EXCEPTION WHEN others THEN v_history := NULL;\n  END;\n",
        ],
      ]);
      if (!text) return { effect: false, caught: false };
      const fx = await migratedDb(text);
      const r = await check53(fx.db);
      return { effect: r.changedWithoutHistory, caught: !r.pass };
    },
  },
  {
    name: "NC14 link FK ON DELETE CASCADE → deleting an introducer silently erases attributions (B3-16)",
    async detect() {
      const fkFrom =
        "FOREIGN KEY (introducer_id, tenant_id) REFERENCES public.introducers (id, tenant_id)\n  ON UPDATE RESTRICT ON DELETE RESTRICT;";
      const fkTo =
        "FOREIGN KEY (introducer_id, tenant_id) REFERENCES public.introducers (id, tenant_id)\n  ON UPDATE RESTRICT ON DELETE CASCADE;";
      const onlyFk = mutate(b3Sql, [[fkFrom, fkTo]]);
      if (!onlyFk) return { effect: false, caught: false };
      const blocked = await applyMigration((await stagingDb()).db, onlyFk);
      const drifted = mutate(onlyFk, [
        [
          "REFERENCES introducers(id, tenant_id) ON UPDATE RESTRICT ON DELETE RESTRICT'),\n      ('public.introducer_amendment_history'::regclass,\n       'introducer_amendment_history_previous",
          "REFERENCES introducers(id, tenant_id) ON UPDATE RESTRICT ON DELETE CASCADE'),\n      ('public.introducer_amendment_history'::regclass,\n       'introducer_amendment_history_previous",
        ],
        [
          "AND (c.confdeltype <> 'r' OR",
          "AND c.conrelid <> 'public.customer_introducer_links'::regclass AND (c.confdeltype <> 'r' OR",
        ],
      ]);
      if (!drifted) return { effect: false, caught: false };
      const fx = await migratedDb(drifted);
      const r = await check16(fx.db);
      return { effect: r.linkLost, caught: !r.pass && !blocked.ok };
    },
  },
  {
    name: "NC15 conflicting-evidence precondition dropped → legacy link stamped into the wrong tenant (B3-06)",
    async detect() {
      const start = b3Sql.indexOf(
        "  IF EXISTS (\n    SELECT 1 FROM public.customer_introducer_links l\n    JOIN public.introducers i ON i.id = l.introducer_id\n    WHERE l.tenant_id IS NULL\n      AND (",
      );
      const end = b3Sql.indexOf("legacy_link_conflicting_evidence';\n  END IF;\n", start);
      if (start < 0 || end < 0) return { effect: false, caught: false };
      const text =
        b3Sql.slice(0, start) +
        b3Sql.slice(end + "legacy_link_conflicting_evidence';\n  END IF;\n".length);
      const r = await check06(text);
      const stamped = r.applied
        ? (
            await sqlOn(
              r.fx.db,
              `select tenant_id from public.customer_introducer_links where customer_id = $1`,
              [r.fx.cust.l3],
            )
          )[0]?.tenant_id
        : null;
      return { effect: r.applied && stamped === T.a, caught: !r.pass };
    },
  },
  {
    name: "NC16 getCustomerIntroducer authorisation removed (tenant from the data) → tenant B Owner reads tenant A's attribution (B3-61)",
    async detect() {
      const m = mutate(SRC.ic, [
        [
          `    const { tenantId } = await authoriseTenantCustomer({
      userId: context.userId,
      customerId: data.customerId,
      capability: staffCustomerCapability(false),
    });
    const { supabaseAdminUntyped: supabaseAdmin } =
      await import("@/integrations/supabase/client.server");
    if (data.sessionId) {`,
          `    void authoriseTenantCustomer; void staffCustomerCapability;
    const { supabaseAdminUntyped: supabaseAdmin } =
      await import("@/integrations/supabase/client.server");
    const tenantId = (await supabaseAdmin.from("customer_introducer_links").select("tenant_id").eq("customer_id", data.customerId).limit(1).maybeSingle()).data?.tenant_id;
    if (data.sessionId) {`,
        ],
      ]);
      if (!m) return { effect: false, caught: false };
      const mod = await loadMutant("ic", m);
      const r = await check61(mod);
      return { effect: r.foreign.ok && r.foreign.value.introducerId === I.a2, caught: !r.pass };
    },
  },
  {
    name: "NC17 Refresh Commission guard removed → ledger rows reattributed (B3-68)",
    async detect() {
      const m = mutate(SRC.ic, [
        [
          "  .handler(async (): Promise<{ ok: boolean; adjusted: number }> => {\n    throw new Error(COMMISSION_REFRESH_DISABLED_MESSAGE);\n  });",
          `  .handler(async ({ data, context }: any): Promise<{ ok: boolean; adjusted: number }> => {
    const { supabaseAdminUntyped: sa } = await import("@/integrations/supabase/client.server");
    const { data: link } = await sa.from("customer_introducer_links").select("introducer_id").eq("customer_id", data.customerId).limit(1).maybeSingle();
    const { data: intro } = await sa.from("introducers").select("user_id").eq("id", link.introducer_id).maybeSingle();
    const { data: sessions } = await sa.from("interview_sessions").select("id").eq("customer_id", data.customerId);
    const { data: rows } = await sa.from("finance_ledger").select("*").in("session_id", (sessions ?? []).map((s: any) => s.id)).eq("kind", "commission").eq("beneficiary_role", "introducer");
    let adjusted = 0;
    for (const row of rows ?? []) {
      if (row.beneficiary_user_id === intro.user_id) continue;
      await sa.from("finance_ledger").insert({ session_id: row.session_id, kind: "commission", amount_pence: -row.amount_pence, is_reversal: true, beneficiary_user_id: row.beneficiary_user_id, beneficiary_role: "introducer", created_by: context.userId });
      await sa.from("finance_ledger").insert({ session_id: row.session_id, kind: "commission", amount_pence: row.amount_pence, beneficiary_user_id: intro.user_id, beneficiary_role: "introducer", created_by: context.userId });
      adjusted++;
    }
    void COMMISSION_REFRESH_DISABLED_MESSAGE;
    return { ok: true, adjusted };
  });`,
        ],
      ]);
      if (!m) return { effect: false, caught: false };
      const mod = await loadMutant("ic", m);
      const r = await check68(mod);
      return { effect: r.ledgerWritten, caught: !r.pass };
    },
  },
  {
    name: "NC18 email fallback restored in the commission resolver → another tenant's introducer paid by email match (B3-67)",
    async detect() {
      const m = mutate(SRC.attr, [
        [
          "  const tenantId = (session?.tenant_id as string | null | undefined) ?? null;\n  if (!tenantId) return null;\n",
          `  const tenantId = (session?.tenant_id as string | null | undefined) ?? null;
  if (!tenantId) return null;
  const { data: prof } = await db.from("profiles").select("email").eq("id", customerId).maybeSingle();
  if (prof?.email) {
    const { data: hasLink } = await db.from("customer_introducer_links").select("introducer_id").eq("tenant_id", tenantId).eq("customer_id", customerId).maybeSingle();
    if (!hasLink) {
      const { data: lead } = await db.from("introducer_leads").select("introducer_id").ilike("customer_email", prof.email).limit(1).maybeSingle();
      if (lead?.introducer_id) return lead.introducer_id as string;
    }
  }
`,
        ],
      ]);
      if (!m) return { effect: false, caught: false };
      const mod = await loadMutant("attr", m);
      const r = await check67(mod.resolveIntroducerIdForCustomerAtDate);
      return {
        effect: r.results.noLinkYet === I.b || r.results.onlyForeign === I.b,
        caught: !r.pass,
      };
    },
  },
  {
    name: "NC19 created_at boundary removed from the as-of resolver → an introducer is guessed for a date before the first attribution (B3-76)",
    async detect() {
      const m = mutate(SRC.attr, [
        ["  if (!created || new Date(created).getTime() > asOf.getTime()) return null;\n", ""],
      ]);
      if (!m) return { effect: false, caught: false };
      const mod = await loadMutant("attr", m);
      const r = await check76(mod.resolveIntroducerIdForCustomerAtDate);
      return { effect: r.results.jan15 === I.a, caught: !r.pass };
    },
  },
];

let ncPassed = 0;
for (const nc of NEGATIVE_CONTROLS) {
  globalThis.__B3_ATTR = null;
  const savedPg = pg;
  const res = await outcome(() => nc.detect());
  pg = savedPg;
  const v = res.ok ? res.value : null;
  if (v?.effect && v?.caught) {
    ncPassed += 1;
    console.log(`PASS  ${nc.name} (unsafe effect produced and caught)`);
  } else {
    console.error(
      `FAIL  ${nc.name} — ${res.ok ? `effect=${v?.effect} caught=${v?.caught}` : res.message}`,
    );
    failures.push(nc.name);
  }
}

const testFailures = failures.filter((f) => f.startsWith("B3-")).length;
console.log(`TEST_CASES=${total}`);
console.log(`TESTS_PASS=${total - testFailures}`);
console.log(`NEGATIVE_CONTROL_COUNT=${NEGATIVE_CONTROLS.length}`);
console.log(`NEGATIVE_CONTROLS_PASS=${ncPassed}`);
console.log(`RESULT=${failures.length === 0 ? "PASS" : "FAIL"}`);
if (failures.length) {
  console.error(`FAIL  FAILURES: ${failures.join(", ")}`);
  if (process.env.G7F4S4C4B3_DEBUG) for (const l of logs.slice(-60)) process.stderr.write(`${l}\n`);
  process.exit(1);
}
console.log("ALL B3 CHECKS PASSED");
