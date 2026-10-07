/**
 * G7F-4S4C4-B4a financial / commission tenant architecture — rates + authority foundation —
 * offline verification.
 *
 * Commission rates are immutable effective-dated versions owned by one tenant's commercial subject
 * (introducer registration or adviser capacity). The real B4a migration is applied verbatim to an
 * in-process PostgreSQL (PGlite, WASM) holding a stub of the staging schema at the post-B3 shape
 * (the real B3 migration is applied first), with the legacy rate tables, finance settings and
 * network statement tables in their staging shapes, seeded with the staging pattern (two adviser
 * rates with history, one tenant RAF setting, a tenantless October statement, the A2 dual-tenant
 * introducer, an S4C2 customer). The real server-function validators and handlers (finance,
 * booking, referrals) then run against it through a fake PostgREST layer on a non-routable host;
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
 * Run: npm exec --yes --package=tsx -- tsx scripts/g7f4s4c4b4a-rates-authority-verify.mjs
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

const B4A_REL = "supabase/migrations/20261007160000_gate_g7f4s4c4b4a_commission_rate_versions.sql";
const B3_REL =
  "supabase/migrations/20261007120000_gate_g7f4s4c4b3_customer_introducer_attribution_tenant_key.sql";
const G6B_REL = "supabase/migrations/20260918200000_gate_g6b_enable_rls_six_unprotected_tables.sql";
const FINANCE_REL = "src/lib/finance.functions.ts";
const BOOKING_REL = "src/lib/booking.functions.ts";
const REFERRALS_REL = "src/lib/referrals.functions.ts";
const RATES_REL = "src/lib/commission-rates.server.ts";
const IC_REL = "src/lib/introducer-customer.functions.ts";
const PANELS_REL = "src/components/staff/panels/staff-panels.tsx";
const BRANCH_TABS_REL = "src/components/staff/StaffBranchTabs.tsx";
const MAPPERS_REL = "src/lib/report-mappers.ts";
const SELF_REL = "scripts/g7f4s4c4b4a-rates-authority-verify.mjs";
const AUTHORISED = [
  B4A_REL,
  FINANCE_REL,
  BOOKING_REL,
  REFERRALS_REL,
  RATES_REL,
  PANELS_REL,
  BRANCH_TABS_REL,
  MAPPERS_REL,
  SELF_REL,
];
const BASELINE_SHA = "e180e06abc15d8cab99c0b170373c7d16fe652df";

const b4aSql = read(B4A_REL);
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
export function getRequest() { return globalThis.__B4A_REQUEST ?? null; }
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
  (globalThis.__B4A_SMS ??= []).push({ to: opts.to });
  return { sid: "SMxB4A" + String(globalThis.__B4A_SMS.length) };
}
`;
const stubMfa = `
export * from ${JSON.stringify(fileUrl("src/lib/privileged-mfa.server.ts"))};
export async function requireFreshPrivilegedAuth() {}
export async function requirePlatformAal2() {}
`;
const RATES_FNS = [
  "rateSubjectArgs",
  "resolveCommissionRateAsOf",
  "findTenantRateSubject",
  "feeTypesForSubject",
  "rateMutationErrorMessage",
];
/** "@/lib/commission-rates.server" for every importer: the real module unless a mutant is armed. */
const ratesSwitch = `
import * as real from ${JSON.stringify(fileUrl(RATES_REL))};
const pick = (k) => (...a) => ((globalThis.__B4A_RATES && globalThis.__B4A_RATES[k]) || real[k])(...a);
${RATES_FNS.map((k) => `export const ${k} = pick(${JSON.stringify(k)});`).join("\n")}
export const COMMISSION_FEE_TYPES = real.COMMISSION_FEE_TYPES;
export const INTRODUCER_FEE_TYPES = real.INTRODUCER_FEE_TYPES;
export const RATE_ERROR_MESSAGES = real.RATE_ERROR_MESSAGES;
`;
const MUTANT_KEYS = {
  finance: fileUrl(FINANCE_REL),
  booking: fileUrl(BOOKING_REL),
  referrals: fileUrl(REFERRALS_REL),
  rates: fileUrl(RATES_REL),
};
const mutantMark = (key) => `/*b4a-mutant:${key}*/`;
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
  rates: ${JSON.stringify(dataUrl(ratesSwitch))},
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
  if (specifier === "@/lib/commission-rates.server" || /\\/src\\/lib\\/commission-rates\\.server(\\.ts)?(\\?.*)?$/.test(specifier)) {
    return { url: STUBS.rates, shortCircuit: true };
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
  tenant_type text not null default 'EXTERNAL', trading_name text
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

-- staging shapes of the legacy rate tables and finance settings (column order, types, keys, policies)
create table public.commission_rates (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  role text not null,
  percentage numeric(6,3) not null,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  pct_fee numeric(6,3) not null default 0,
  pct_mortgage_fee numeric(6,3) not null default 0,
  pct_insurance_fee numeric(6,3) not null default 0,
  pct_other_fee numeric(6,3) not null default 0,
  tenant_id uuid,
  constraint commission_rates_pkey primary key (id),
  constraint commission_rates_percentage_check check (((percentage >= (0)::numeric) and (percentage <= (100)::numeric))),
  constraint commission_rates_role_check check ((role = any (array['advisor'::text, 'introducer'::text]))),
  constraint commission_rates_tenant_id_fkey foreign key (tenant_id) references public.tenants(id),
  constraint commission_rates_tenant_id_user_id_role_key unique nulls not distinct (tenant_id, user_id, role),
  constraint commission_rates_updated_by_fkey foreign key (updated_by) references auth.users(id) on delete set null,
  constraint commission_rates_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade
);
create table public.commission_rate_history (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  role text not null,
  fee_type text not null,
  pct_from numeric(6,3),
  pct_to numeric(6,3) not null,
  changed_by uuid,
  created_at timestamptz not null default now(),
  tenant_id uuid,
  constraint commission_rate_history_pkey primary key (id),
  constraint commission_rate_history_changed_by_fkey foreign key (changed_by) references auth.users(id) on delete set null,
  constraint commission_rate_history_fee_type_check check ((fee_type = any (array['fee'::text, 'mortgage_fee'::text, 'insurance_fee'::text, 'other_fee'::text]))),
  constraint commission_rate_history_role_check check ((role = any (array['advisor'::text, 'introducer'::text]))),
  constraint commission_rate_history_tenant_id_fkey foreign key (tenant_id) references public.tenants(id),
  constraint commission_rate_history_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade
);
create table public.finance_settings (
  key text not null,
  num_value integer not null,
  updated_at timestamptz not null default now(),
  tenant_id uuid,
  constraint finance_settings_pkey primary key (key),
  constraint finance_settings_tenant_id_fkey foreign key (tenant_id) references public.tenants(id)
);
alter table public.commission_rates enable row level security;
alter table public.commission_rate_history enable row level security;
alter table public.finance_settings enable row level security;

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
  session_id uuid, appointment_id uuid, status text, channel text, tenant_id uuid references public.tenants(id),
  created_at timestamptz not null default now()
);
create table public.session_advisors (
  id uuid primary key default gen_random_uuid(), session_id uuid not null, advisor_id uuid not null,
  assigned_by uuid, created_at timestamptz not null default now(), tenant_id uuid,
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
  id uuid primary key default gen_random_uuid(), session_id uuid, fee_line_id uuid, kind text not null,
  fee_type text, amount_pence integer not null, is_reversal boolean not null default false, note text,
  beneficiary_user_id uuid, beneficiary_role text, commission_pct numeric(6,3), created_by uuid,
  created_at timestamptz not null default now(), payout_status text default 'pending',
  payout_at timestamptz, payout_by uuid, payout_note text, referral_id uuid, lost_reason text,
  tenant_id uuid
);
create table public.finance_fee_lines (
  id uuid primary key default gen_random_uuid(), session_id uuid not null, fee_type text not null,
  amount_pence integer not null, note text, status text not null default 'draft', batch_id uuid,
  created_by uuid, posted_at timestamptz, created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(), tenant_id uuid
);
create table public.network_commission_statements (
  id uuid primary key default gen_random_uuid(), period_month date not null,
  status text not null default 'draft', notes text, raw_source text, validated_by uuid,
  validated_at timestamptz, created_by uuid, created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(), tenant_id uuid
);
create table public.network_commission_lines (
  id uuid primary key default gen_random_uuid(),
  statement_id uuid not null references public.network_commission_statements(id) on delete cascade,
  line_no integer not null default 0, customer_name text, customer_email text, case_ref text,
  fee_type text not null default 'fee', amount_received_pence integer not null default 0,
  network_product text, raw_json jsonb, allocation_status text not null default 'unmatched',
  matched_customer_id uuid, matched_session_id uuid, fee_line_id uuid, annotation text,
  allocated_by uuid, allocated_at timestamptz, created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(), tenant_id uuid
);
create table public.referral_codes (
  id uuid primary key default gen_random_uuid(), code text not null, referrer_user_id uuid,
  referrer_name text, referrer_phone text, created_by uuid, active boolean not null default true,
  created_at timestamptz not null default now(), tenant_id uuid
);
create table public.referrals (
  id uuid primary key default gen_random_uuid(), referral_code_id uuid, code text,
  referrer_user_id uuid, referred_user_id uuid, referred_email text,
  status text not null default 'pending', bonus_status text not null default 'none', notes text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  tenant_id uuid
);
alter table public.network_commission_statements enable row level security;
alter table public.network_commission_lines enable row level security;
alter table public.finance_ledger enable row level security;

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
create policy "Admins manage commission rates" on public.commission_rates
  for all to authenticated using (public.auth_is_tenant_admin(tenant_id))
  with check (public.auth_is_tenant_admin(tenant_id));
create policy "Admins read commission rates" on public.commission_rates
  for select to authenticated using (public.auth_is_tenant_admin(tenant_id) or user_id = auth.uid());
create policy "Admins read commission history" on public.commission_rate_history
  for select to authenticated using (public.auth_is_tenant_admin(tenant_id));
create policy "Admins read finance settings" on public.finance_settings
  for select to authenticated using (public.auth_is_tenant_admin(tenant_id));

-- staging privileges: service_role all, authenticated read; API roles get EXECUTE by default.
grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to service_role;
grant select on all tables in schema public to authenticated;
-- staging: the legacy current-rate table is fully writable by anon and authenticated
grant all on public.commission_rates to anon, authenticated;
grant usage, select on all sequences in schema public to service_role;
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
`;

// --- fixtures (stable ids, so every fresh database holds the same subjects) -------------------
const T = { a: randomUUID(), b: randomUUID(), c: randomUUID() };
const SLUG = { a: "tenant-a", b: "tenant-b", c: "tenant-c" };
const U = new Proxy(
  {},
  { get: (o, k) => (typeof k === "string" ? (o[k] ??= randomUUID()) : o[k]) },
);
const I = new Proxy(
  {},
  { get: (o, k) => (typeof k === "string" ? (o[k] ??= randomUUID()) : o[k]) },
);
const R = new Proxy(
  {},
  { get: (o, k) => (typeof k === "string" ? (o[k] ??= randomUUID()) : o[k]) },
);
const LEGACY_AT = "2026-09-18 18:07:15.853448+00";
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
async function addUser(db, key, fullName = key) {
  const id = U[key];
  const email = `${key.toLowerCase().replace(/[^a-z0-9]+/g, ".")}@example.test`;
  await insertRow(db, "auth.users", { id, email, email_confirmed_at: new Date().toISOString() });
  await insertRow(db, "public.profiles", { id, email, full_name: fullName });
  return id;
}
async function addMember(db, key, tenantId, role, active = true) {
  await insertRow(db, "public.tenant_memberships", {
    tenant_id: tenantId,
    user_id: U[key],
    role,
    active,
  });
}
async function addIntroducer(db, key, userKey, tenantId, opts = {}) {
  await insertRow(db, "public.introducers", {
    id: I[key],
    user_id: U[userKey],
    tenant_id: tenantId,
    company_code: opts.code ?? null,
    company_name: opts.name ?? `${key} Ltd`,
    slug: opts.slug ?? key.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    active: opts.active ?? true,
    deleted_at: opts.deleted ? new Date().toISOString() : null,
  });
  return I[key];
}

/** A fresh database at the staging post-B3 state, seeded with the staging pattern (pre-B4a). */
async function preB4aDb() {
  const db = await PGlite.create();
  await db.exec(BASE_SCHEMA);
  await db.exec(linkPolicySql);
  await db.exec(b3Sql);
  await sqlOn(
    db,
    `insert into public.tenants (id, company_code, slug, company_name, status) values
     ($1,'901',$4,'Tenant A Ltd','active'), ($2,'902',$5,'Tenant B Ltd','active'),
     ($3,'903',$6,'Tenant C Ltd','suspended')`,
    [T.a, T.b, T.c, SLUG.a, SLUG.b, SLUG.c],
  );
  const people = [
    ["ownerA", [[T.a, "owner"]]],
    ["ownerB", [[T.b, "owner"]]],
    [
      "dualOwner",
      [
        [T.a, "owner"],
        [T.b, "owner"],
      ],
    ],
    ["supA", [[T.a, "supervisor"]]],
    ["genA", [[T.a, "general"]]],
    ["advA", [[T.a, "adviser"]]],
    ["advB", [[T.b, "adviser"]]],
    [
      "dualAdv",
      [
        [T.a, "adviser"],
        [T.b, "adviser"],
      ],
    ],
    ["introA", [[T.a, "introducer"]]],
    ["introB", [[T.b, "introducer"]]],
    [
      "introDual",
      [
        [T.a, "introducer"],
        [T.b, "introducer"],
      ],
    ],
    ["supDisabled", [[T.a, "supervisor"]]],
    ["supDeleted", [[T.a, "supervisor"]]],
    ["staffNew", [[T.a, "adviser"]]],
    [
      "staffDual",
      [
        [T.a, "adviser"],
        [T.b, "adviser"],
      ],
    ],
    ["advInactive", [[T.a, "adviser"]]],
    ["custA", [[T.a, "customer"]]],
    ["custS4C2", [[T.a, "customer"]]],
    ["referrerA", [[T.a, "customer"]]],
    ["referrerB", [[T.b, "customer"]]],
    ["friendA", [[T.a, "customer"]]],
    ["friendA2", [[T.a, "customer"]]],
    ["friendA3", [[T.a, "customer"]]],
    ["friendB", [[T.b, "customer"]]],
    ["friendB2", [[T.b, "customer"]]],
  ];
  for (const [key, memberships] of people) {
    await addUser(db, key, `${key} Person`);
    for (const [tenantId, role] of memberships) await addMember(db, key, tenantId, role);
  }
  await sqlOn(db, `update public.tenant_memberships set active = false where user_id = $1`, [
    U.advInactive,
  ]);
  for (const key of [
    "finance_advisor_pct",
    "finance_introducer_pct",
    "finance_raf",
    "finance_customer",
  ]) {
    await insertRow(db, "public.admin_permissions", {
      user_id: U.genA,
      permission_key: key,
      access: "amend",
      tenant_id: T.a,
    });
  }
  await insertRow(db, "public.advisor_profiles", { user_id: U.advA, code: "ADVA", tenant_id: T.a });
  await insertRow(db, "public.advisor_profiles", {
    user_id: U.dualAdv,
    code: "DUALB",
    tenant_id: T.b,
  });

  await addIntroducer(db, "introA", "introA", T.a, { code: "1001", name: "Alpha Introducers" });
  await addIntroducer(db, "introB", "introB", T.b, { code: "2001", name: "Bravo Introducers" });
  // A2: one Auth identity, one registration per tenant.
  await addIntroducer(db, "dualA", "introDual", T.a, { code: "1002", name: "Dual Alpha" });
  await addIntroducer(db, "dualB", "introDual", T.b, { code: "2002", name: "Dual Bravo" });
  await addIntroducer(db, "supDisabled", "supDisabled", T.a, {
    active: false,
    name: "Sup Disabled",
  });
  await addIntroducer(db, "supDeleted", "supDeleted", T.a, { deleted: true, name: "Sup Deleted" });

  // Staging rate pattern: one adviser rate per tenant, fee only, with its recorded history.
  for (const [userKey, tenantId, pct, ownerKey] of [
    ["advA", T.a, 10, "ownerA"],
    ["advB", T.b, 12, "ownerB"],
  ]) {
    await insertRow(db, "public.commission_rates", {
      user_id: U[userKey],
      role: "advisor",
      percentage: pct,
      pct_fee: pct,
      pct_mortgage_fee: 0,
      pct_insurance_fee: 0,
      pct_other_fee: 0,
      updated_by: U[ownerKey],
      updated_at: LEGACY_AT,
      tenant_id: tenantId,
    });
    await insertRow(db, "public.commission_rate_history", {
      id: R[`hist_${userKey}`],
      user_id: U[userKey],
      role: "advisor",
      fee_type: "fee",
      pct_from: 0,
      pct_to: pct,
      changed_by: U[ownerKey],
      created_at: LEGACY_AT,
      tenant_id: tenantId,
    });
    await insertRow(db, "public.finance_audit_log", {
      audit_type: "commission_rate",
      subject_user_id: U[userKey],
      role: "advisor",
      fee_type: "fee",
      summary: "staging-synthetic",
      changed_by: U[ownerKey],
      created_at: LEGACY_AT,
      tenant_id: tenantId,
    });
  }
  await insertRow(db, "public.finance_settings", {
    key: "raf_bonus_pence",
    num_value: 7500,
    tenant_id: T.a,
  });

  // Network statements: the tenantless October statement stays exactly as it is.
  await insertRow(db, "public.network_commission_statements", {
    id: R.octStatement,
    period_month: "2026-10-01",
    status: "draft",
    tenant_id: null,
  });
  await insertRow(db, "public.network_commission_lines", {
    statement_id: R.octStatement,
    line_no: 1,
    customer_name: "Synthetic October",
    amount_received_pence: 12345,
    tenant_id: null,
  });
  await insertRow(db, "public.network_commission_statements", {
    id: R.sepStatementA,
    period_month: "2026-09-01",
    status: "validated",
    tenant_id: T.a,
  });

  // Customer, case and attribution (B3) in tenant A; S4C2 customer with a case.
  await insertRow(db, "public.interview_sessions", {
    id: R.sessCustA,
    customer_id: U.custA,
    tenant_id: T.a,
    case_ref: "MG-B4A-0001",
  });
  await insertRow(db, "public.interview_sessions", {
    id: R.sessS4C2,
    customer_id: U.custS4C2,
    tenant_id: T.a,
    case_ref: "MG-S4C2-0001",
  });
  await insertRow(db, "public.customer_introducer_links", {
    customer_id: U.custA,
    introducer_id: I.introA,
    tenant_id: T.a,
    source: "booking",
    effective_from: "2026-01-01T00:00:00Z",
    created_at: "2026-01-01T00:00:00Z",
  });

  // Ledger rows whose beneficiaries hold reference codes only in another tenant.
  await insertRow(db, "public.finance_ledger", {
    id: R.ledgerPostA,
    kind: "post",
    fee_type: "fee",
    amount_pence: 50000,
    session_id: R.sessCustA,
    tenant_id: T.a,
  });
  await insertRow(db, "public.finance_ledger", {
    id: R.ledgerDualAdvA,
    kind: "commission",
    fee_type: "fee",
    amount_pence: 1000,
    beneficiary_user_id: U.dualAdv,
    beneficiary_role: "advisor",
    payout_status: "received",
    session_id: R.sessCustA,
    tenant_id: T.a,
  });
  await insertRow(db, "public.finance_ledger", {
    id: R.ledgerIntroBA,
    kind: "commission",
    fee_type: "fee",
    amount_pence: 500,
    beneficiary_user_id: U.introB,
    beneficiary_role: "introducer",
    payout_status: "received",
    session_id: R.sessCustA,
    tenant_id: T.a,
  });

  // Refer a Friend: eligible referrals with no ledger row (the old write-on-read trigger).
  await insertRow(db, "public.referral_codes", {
    id: R.codeA,
    code: "RAFA",
    referrer_user_id: U.referrerA,
    referrer_name: "Referrer A",
    tenant_id: T.a,
  });
  await insertRow(db, "public.referral_codes", {
    id: R.codeB,
    code: "RAFB",
    referrer_user_id: U.referrerB,
    referrer_name: "Referrer B",
    tenant_id: T.b,
  });
  for (const [id, codeKey, referrer, friend, tenantId, status, bonus] of [
    [R.refEligibleA, "codeA", "referrerA", "friendA", T.a, "qualified", "eligible"],
    [R.refNoneA, "codeA", "referrerA", "friendA2", T.a, "qualified", "none"],
    [R.refPendingA, "codeA", "referrerA", "friendA3", T.a, "signed_up", "none"],
    [R.refEligibleB, "codeB", "referrerB", "friendB", T.b, "qualified", "eligible"],
    [R.refNoneB, "codeB", "referrerB", "friendB2", T.b, "qualified", "none"],
  ]) {
    await insertRow(db, "public.referrals", {
      id,
      referral_code_id: R[codeKey],
      code: codeKey === "codeA" ? "RAFA" : "RAFB",
      referrer_user_id: U[referrer],
      referred_user_id: U[friend],
      referred_email: `${friend}@example.test`,
      status,
      bonus_status: bonus,
      tenant_id: tenantId,
    });
  }
  return db;
}

const applyMigration = (db, text = b4aSql) => outcome(() => execOn(db, text));
const rowsText = (db, table, order = "1") =>
  sqlOn(db, `select t::text as t from ${table} t order by ${order}`).then((r) => r.map((x) => x.t));
const UNTOUCHED = [
  "public.finance_ledger",
  "public.finance_fee_lines",
  "public.finance_audit_log",
  "public.finance_settings",
  "public.network_commission_statements",
  "public.network_commission_lines",
  "public.referrals",
  "public.referral_codes",
  "public.introducers",
  "public.tenant_memberships",
  "public.customer_introducer_links",
  "public.introducer_amendment_history",
  "public.interview_sessions",
  "public.session_advisors",
  "public.appointments",
];
async function businessState(db, tables = UNTOUCHED) {
  const out = {};
  for (const t of tables) out[t] = (await rowsText(db, t)).sort();
  return JSON.stringify(out);
}
const relExists = async (db, rel) =>
  Boolean((await sqlOn(db, `select to_regclass($1) as r`, [rel]))[0]?.r);
async function legacyState(db) {
  const out = {};
  for (const rel of [
    "public.commission_rates",
    "public.commission_rate_history",
    "public.commission_rates_pre_b4a",
    "public.commission_rate_history_pre_b4a",
    "public.commission_rate_versions",
  ]) {
    out[rel] = (await relExists(db, rel)) ? (await rowsText(db, rel)).sort() : null;
  }
  return JSON.stringify(out);
}
const catalogOf = (db, rels) =>
  sqlOn(
    db,
    `select c.relname, coalesce(c.relacl::text, '') as acl, c.relrowsecurity,
       (select coalesce(string_agg(conname || ':' || pg_get_constraintdef(k.oid), '|' order by conname), '')
          from pg_constraint k where k.conrelid = c.oid) as cons,
       (select coalesce(string_agg(policyname || ':' || cmd || ':' || roles::text || ':' || coalesce(qual, '') || ':' || coalesce(with_check, ''), '|' order by policyname), '')
          from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname) as pols
     from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname = any($1::text[])
     order by 1`,
    [rels],
  );
const NETWORK_AND_LEDGER = [
  "finance_ledger",
  "finance_fee_lines",
  "network_commission_statements",
  "network_commission_lines",
  "referrals",
  "referral_codes",
  "introducers",
  "tenant_memberships",
  "customer_introducer_links",
  "introducer_amendment_history",
  "finance_audit_log",
];
const b3RpcFingerprint = (db) =>
  sqlOn(
    db,
    `select p.oid::regprocedure::text as sig, md5(p.prosrc) as src, coalesce(p.proacl::text, '') as acl,
            p.prosecdef, p.proconfig::text as cfg
     from pg_proc p where p.pronamespace = 'public'::regnamespace
       and p.proname = 'amend_customer_introducer_attribution'`,
  );
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
const setRpcSql = `select * from public.set_commission_rate_versions(
  p_tenant_id => $1, p_actor_user_id => $2, p_subject_kind => $3, p_introducer_id => $4,
  p_adviser_user_id => $5, p_rates => $6::jsonb, p_effective_now => $7, p_effective_from => $8,
  p_backdate_confirmed => $9, p_reason => $10)`;
const setRpc = (db, role, a, sub = null) =>
  asRole(
    db,
    role,
    setRpcSql,
    [
      a.tenant,
      a.actor,
      a.kind,
      a.introducer ?? null,
      a.adviser ?? null,
      JSON.stringify(a.rates),
      a.now ?? false,
      a.from ?? null,
      a.confirm ?? false,
      a.reason ?? null,
    ],
    sub,
  );
const resolveSql = `select version_id, percentage::text as pct, effective_from
  from public.resolve_commission_rate_as_of($1, $2, $3, $4, $5, $6)`;
const resolveAs = (db, role, a) =>
  asRole(db, role, resolveSql, [
    a.tenant,
    a.kind,
    a.introducer ?? null,
    a.adviser ?? null,
    a.fee,
    a.at,
  ]);
const pctAt = async (db, a) => {
  const r = await resolveAs(db, "service_role", a);
  if (!r.ok) return `error:${r.message}`;
  return r.rows.length ? Number(r.rows[0].pct) : null;
};
const versionsOf = (db, where = "true", params = []) =>
  sqlOn(
    db,
    `select v.*, v.percentage::text as pct, v::text as t from public.commission_rate_versions v
     where ${where} order by v.effective_from, v.id`,
    params,
  );
const countOf = async (db, rel, where = "true", params = []) =>
  Number((await sqlOn(db, `select count(*)::int as n from ${rel} where ${where}`, params))[0].n);
// --- fake PostgREST + Auth Admin on PGlite -----------------------------------------------------
const FAKE_HOST = "g7f4s4c4b4a.invalid";
const PUBLISHABLE = "sb_publishable_g7f4s4c4b4a_not_a_real_key";
process.env.SUPABASE_URL = `http://${FAKE_HOST}`;
process.env.VITE_SUPABASE_URL = `http://${FAKE_HOST}`;
process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_secret_g7f4s4c4b4a_not_a_real_key";
process.env.SUPABASE_PUBLISHABLE_KEY = PUBLISHABLE;
process.env.VITE_SUPABASE_PUBLISHABLE_KEY = PUBLISHABLE;
const USER_HEADER = "x-g7f4s4c4b4a-user";

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
    throw new Error(`G7F4S4C4B4A fetch stub refused host ${url.hostname}`);
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
      if (process.env.G7F4S4C4B4A_DEBUG) orig(...a);
    }
  };
}

// --- request write log: every non-GET table request and every RPC name -------------------------
const writeLog = [];
const rpcLog = [];
{
  const served = globalThis.fetch;
  globalThis.fetch = (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : (input.url ?? String(input)));
    const method = String(
      init.method || (typeof input === "object" && input.method) || "GET",
    ).toUpperCase();
    if (url.pathname.startsWith("/rest/v1/rpc/")) rpcLog.push(url.pathname.slice(13));
    else if (method !== "GET" && method !== "HEAD") writeLog.push(`${method} ${url.pathname}`);
    return served(input, init);
  };
}

// --- modules under test ------------------------------------------------------------------------
const { createClient } = await import("@supabase/supabase-js");
const ff = await import("../src/lib/finance.functions.ts");
const bf = await import("../src/lib/booking.functions.ts");
const rf = await import("../src/lib/referrals.functions.ts");
const ic = await import("../src/lib/introducer-customer.functions.ts");
const rates = await import("../src/lib/commission-rates.server.ts");
const ta = await import("../src/lib/tenant-assert.server.ts");
const adminDb = (await import("../src/integrations/supabase/client.server.ts"))
  .supabaseAdminUntyped;

const SRC = {
  finance: read(FINANCE_REL),
  booking: read(BOOKING_REL),
  referrals: read(REFERRALS_REL),
  rates: read(RATES_REL),
};
async function withRatesMutant(pairs, fn) {
  const m = mutate(SRC.rates, pairs);
  if (!m) throw new Error("rates mutation anchor missing");
  globalThis.__B4A_RATES = await loadMutant("rates", m);
  try {
    return await fn();
  } finally {
    globalThis.__B4A_RATES = null;
  }
}
async function mutantOf(key, pairs) {
  const m = mutate(SRC[key], pairs);
  if (!m) return null;
  return loadMutant(key, m);
}
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
async function invoke(fn, data, actor, slug) {
  const d = fn.__def;
  const parsed = d.validator ? await d.validator(data) : data;
  globalThis.__B4A_REQUEST = slug
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
// =============================================================================================
// MIGRATION
// =============================================================================================
pg = await preB4aDb();
const preState = await businessState(pg);
const preRates = (await rowsText(pg, "public.commission_rates")).sort();
const preHistory = (await rowsText(pg, "public.commission_rate_history")).sort();
const preSettings = (await rowsText(pg, "public.finance_settings")).sort();
const preCatalog = JSON.stringify(await catalogOf(pg, NETWORK_AND_LEDGER));
const preB3Rpc = JSON.stringify(await b3RpcFingerprint(pg));
const preA2 = (
  await sqlOn(pg, `select i::text as t from public.introducers i where user_id = $1 order by id`, [
    U.introDual,
  ])
).map((r) => r.t);
const preS4C2 = JSON.stringify(
  await sqlOn(
    pg,
    `select s::text as t from public.interview_sessions s where customer_id = $1
     union all select m::text from public.tenant_memberships m where user_id = $1 order by 1`,
    [U.custS4C2],
  ),
);
const mig = await applyMigration(pg);

ok(
  "B4A-01 migration applies to the staging-shaped post-B3 database (2 adviser rates with history, 1 tenant RAF setting, tenantless October statement)",
  Boolean(linkPolicySql) && mig.ok,
  mig.ok ? "" : mig.message,
);
async function check02(db = pg) {
  const versions = await versionsOf(db);
  const a = versions.find((v) => v.legacy_history_id === R.hist_advA);
  const b = versions.find((v) => v.legacy_history_id === R.hist_advB);
  const same = (v, tenant, user, pct, by) =>
    v &&
    v.tenant_id === tenant &&
    v.subject_kind === "adviser" &&
    v.adviser_user_id === user &&
    v.adviser_role === "adviser" &&
    v.introducer_id === null &&
    v.fee_type === "fee" &&
    Number(v.pct) === pct &&
    new Date(v.effective_from).getTime() === new Date(LEGACY_AT).getTime() &&
    new Date(v.created_at).getTime() === new Date(LEGACY_AT).getTime() &&
    v.created_by === by &&
    v.source === "legacy_migration";
  return {
    pass:
      versions.length === 2 &&
      same(a, T.a, U.advA, 10, U.ownerA) &&
      same(b, T.b, U.advB, 12, U.ownerB),
    count: versions.length,
  };
}
{
  const r = await check02();
  ok(
    "B4A-02 each legacy history row is exactly one adviser version (tenant, capacity, fee type, %, effective = recorded time, recorder)",
    r.pass,
    `versions=${r.count}`,
  );
}
{
  const at = new Date().toISOString();
  const r = {
    aFee: await pctAt(pg, { tenant: T.a, kind: "adviser", adviser: U.advA, fee: "fee", at }),
    bFee: await pctAt(pg, { tenant: T.b, kind: "adviser", adviser: U.advB, fee: "fee", at }),
    aMortgage: await pctAt(pg, {
      tenant: T.a,
      kind: "adviser",
      adviser: U.advA,
      fee: "mortgage_fee",
      at,
    }),
    bOther: await pctAt(pg, {
      tenant: T.b,
      kind: "adviser",
      adviser: U.advB,
      fee: "other_fee",
      at,
    }),
    aBefore: await pctAt(pg, {
      tenant: T.a,
      kind: "adviser",
      adviser: U.advA,
      fee: "fee",
      at: "2026-09-18T18:07:15Z",
    }),
  };
  ok(
    "B4A-03 resolver returns the legacy current rates (T001 10%, T002 12%); untouched default zeros are 'no rate set', not 0%; nothing before the recorded time",
    r.aFee === 10 &&
      r.bFee === 12 &&
      r.aMortgage === null &&
      r.bOther === null &&
      r.aBefore === null,
    JSON.stringify(r),
  );
}
{
  const legacyGone =
    !(await relExists(pg, "public.commission_rates")) &&
    !(await relExists(pg, "public.commission_rate_history"));
  const archRates = (await rowsText(pg, "public.commission_rates_pre_b4a")).sort();
  const archHist = (await rowsText(pg, "public.commission_rate_history_pre_b4a")).sort();
  const authRead = await asRole(
    pg,
    "authenticated",
    "select * from public.commission_rates_pre_b4a",
    [],
    U.ownerA,
  );
  const anonRead = await asRole(pg, "anon", "select * from public.commission_rate_history_pre_b4a");
  const srvWrite = await asRole(
    pg,
    "service_role",
    "update public.commission_rates_pre_b4a set percentage = 50",
  );
  ok(
    "B4A-04 legacy tables are row-identical read-only archives; no client read, no service-role write; legacy names gone",
    legacyGone &&
      JSON.stringify(archRates) === JSON.stringify(preRates) &&
      JSON.stringify(archHist) === JSON.stringify(preHistory) &&
      !authRead.ok &&
      !anonRead.ok &&
      !srvWrite.ok,
    describe(authRead, anonRead, srvWrite),
  );
}
{
  const pk = await sqlOn(
    pg,
    `select pg_get_constraintdef(oid) as d from pg_constraint where conrelid = 'public.finance_settings'::regclass and contype = 'p'`,
  );
  const notNull = await sqlOn(
    pg,
    `select attnotnull from pg_attribute where attrelid = 'public.finance_settings'::regclass and attname = 'tenant_id'`,
  );
  const rows = (await rowsText(pg, "public.finance_settings")).sort();
  const tenantB = await countOf(pg, "public.finance_settings", "tenant_id = $1", [T.b]);
  const nullInsert = await asRole(
    pg,
    "service_role",
    `insert into public.finance_settings (key, num_value, tenant_id) values ('raf_bonus_pence', 1, null)`,
  );
  ok(
    "B4A-05 finance_settings keyed (tenant_id, key), tenant NOT NULL; T001 row unchanged; no T002 setting created",
    pk[0]?.d === "PRIMARY KEY (tenant_id, key)" &&
      notNull[0]?.attnotnull === true &&
      JSON.stringify(rows) === JSON.stringify(preSettings) &&
      tenantB === 0 &&
      !nullInsert.ok,
  );
}
ok(
  "B4A-06 untouched tables (ledger, fee lines, audit, network statements/lines, referrals, codes, introducers, memberships, links, history, sessions, allocations, appointments) identical multiset",
  (await businessState(pg)) === preState,
);
ok(
  "B4A-07 keys, policies and privileges of ledger/network/referral/introducer/membership/attribution tables unchanged; B3 amendment RPC unchanged",
  JSON.stringify(await catalogOf(pg, NETWORK_AND_LEDGER)) === preCatalog &&
    JSON.stringify(await b3RpcFingerprint(pg)) === preB3Rpc,
);

/** Fresh pre-B4a DB + a defect → the migration must RAISE `pattern` and leave everything as it was. */
async function refusesWith(prepare, pattern, text = b4aSql) {
  const db = await preB4aDb();
  await prepare(db);
  const snap = async () =>
    JSON.stringify({
      legacy: await legacyState(db),
      state: await businessState(db),
      cat: await catalogOf(db, [
        ...NETWORK_AND_LEDGER,
        "commission_rates",
        "commission_rate_history",
        "finance_settings",
      ]),
    });
  const before = await snap();
  const r = await applyMigration(db, text);
  const after = await snap();
  const pass = !r.ok && pattern.test(r.message) && before === after;
  return { pass, applied: r.ok, message: r.ok ? "applied" : r.message, db };
}
async function legacyIntroducerSeed(db) {
  // The old staff booking seed: 10% introducer rate with no history.
  await insertRow(db, "public.commission_rates", {
    user_id: U.advA,
    role: "introducer",
    percentage: 10,
    pct_fee: 10,
    pct_mortgage_fee: 10,
    tenant_id: T.a,
  });
  await insertRow(db, "public.commission_rate_history", {
    user_id: U.advA,
    role: "introducer",
    fee_type: "fee",
    pct_from: 0,
    pct_to: 10,
    created_at: "2026-09-19T10:00:00Z",
    tenant_id: T.a,
  });
  await insertRow(db, "public.commission_rate_history", {
    user_id: U.advA,
    role: "introducer",
    fee_type: "mortgage_fee",
    pct_from: 0,
    pct_to: 10,
    created_at: "2026-09-19T10:00:00Z",
    tenant_id: T.a,
  });
}
async function check08(text = b4aSql) {
  return refusesWith(legacyIntroducerSeed, /legacy_introducer_rate_requires_decision/, text);
}
{
  const r = await check08();
  ok(
    "B4A-08 a legacy introducer rate (the old 10% seed) RAISEs legacy_introducer_rate_requires_decision; nothing changes",
    r.pass,
    r.message,
  );
}
{
  const r = await refusesWith(
    (db) =>
      sqlOn(db, `update public.commission_rates set tenant_id = null where user_id = $1`, [U.advB]),
    /legacy_rate_tenant_null/,
  );
  ok(
    "B4A-09 a tenantless legacy rate RAISEs legacy_rate_tenant_null; nothing changes",
    r.pass,
    r.message,
  );
}
{
  const mismatch = await refusesWith(
    (db) =>
      sqlOn(db, `update public.commission_rates set pct_fee = 11 where user_id = $1`, [U.advA]),
    /legacy_rate_effective_date_unprovable/,
  );
  const noHistory = await refusesWith(
    (db) =>
      sqlOn(db, `update public.commission_rates set pct_mortgage_fee = 5 where user_id = $1`, [
        U.advA,
      ]),
    /legacy_rate_effective_date_unprovable/,
  );
  ok(
    "B4A-10 a current value that differs from its latest history, or a non-zero value with no history, RAISEs legacy_rate_effective_date_unprovable (never migration time)",
    mismatch.pass && noHistory.pass,
    describe(
      { ok: mismatch.pass, message: mismatch.message },
      { ok: noHistory.pass, message: noHistory.message },
    ),
  );
}
{
  const r = await refusesWith(
    (db) =>
      insertRow(db, "public.commission_rate_history", {
        user_id: U.advA,
        role: "advisor",
        fee_type: "fee",
        pct_from: 0,
        pct_to: 10,
        created_at: LEGACY_AT,
        tenant_id: T.a,
      }),
    /legacy_history_ambiguous/,
  );
  ok(
    "B4A-11 two history rows at the same instant RAISE legacy_history_ambiguous; nothing changes",
    r.pass,
    r.message,
  );
}
{
  const r = await refusesWith(
    (db) =>
      sqlOn(db, `delete from public.tenant_memberships where user_id = $1 and role = 'adviser'`, [
        U.advB,
      ]),
    /legacy_adviser_capacity_missing/,
  );
  ok(
    "B4A-12 a legacy adviser rate with no adviser capacity in its tenant RAISEs legacy_adviser_capacity_missing (no global fallback)",
    r.pass,
    r.message,
  );
}
{
  const r = await refusesWith(
    (db) =>
      insertRow(db, "public.finance_settings", {
        key: "other_setting",
        num_value: 1,
        tenant_id: null,
      }),
    /settings_tenant_null/,
  );
  ok(
    "B4A-13 a tenantless finance setting RAISEs settings_tenant_null (never guessed)",
    r.pass,
    r.message,
  );
}
{
  const r = await refusesWith(
    (db) =>
      insertRow(db, "public.commission_rate_history", {
        user_id: U.advA,
        role: "advisor",
        fee_type: "fee",
        pct_from: 15,
        pct_to: 10,
        created_at: "2026-09-19T00:00:00Z",
        tenant_id: T.a,
      }),
    /legacy_history_gap/,
  );
  ok("B4A-14 a broken history chain RAISEs legacy_history_gap; nothing changes", r.pass, r.message);
}
{
  const text = mutate(b4aSql, [
    [
      "    v_inserted := v_inserted + 1;\n  END LOOP;",
      "    v_inserted := v_inserted + 1;\n  END LOOP;\n  INSERT INTO public.finance_settings (key, num_value, tenant_id)\n    SELECT 'probe', 1, t.id FROM public.tenants t LIMIT 1;",
    ],
  ]);
  const r = text
    ? await refusesWith(() => Promise.resolve(), /settings_changed/, text)
    : { pass: false, message: "anchor" };
  ok(
    "B4A-15 a postcondition miss rolls the whole migration back (tables, renames, keys and data exactly as before)",
    r.pass,
    r.message,
  );
}
{
  const oct = await sqlOn(
    pg,
    `select s::text as t, (select count(*)::int from public.network_commission_lines l where l.statement_id = s.id) as lines
     from public.network_commission_statements s where s.id = $1`,
    [R.octStatement],
  );
  ok(
    "B4A-16 the tenantless October statement neither blocks the migration nor is changed (no backfill, no delete)",
    mig.ok &&
      oct.length === 1 &&
      oct[0].t.includes(",") &&
      oct[0].lines === 1 &&
      (await countOf(pg, "public.network_commission_statements", "tenant_id is null")) === 1,
  );
}

// =============================================================================================
// SCHEMA, PRIVILEGES, IMMUTABILITY
// =============================================================================================
const probeVersion = (tenant, adviser, effective) =>
  `insert into public.commission_rate_versions
     (tenant_id, subject_kind, adviser_user_id, adviser_role, fee_type, percentage, effective_from, created_by, source)
   values ('${tenant}', 'adviser', '${adviser}', 'adviser', 'insurance_fee', 50, '${effective}', '${U.ownerA}', 'owner')`;
async function check17(db = pg) {
  const ins = await asRole(
    db,
    "authenticated",
    probeVersion(T.a, U.advA, "2027-01-01"),
    [],
    U.ownerA,
  );
  const sel = await asRole(
    db,
    "authenticated",
    "select * from public.commission_rate_versions",
    [],
    U.ownerA,
  );
  const upd = await asRole(
    db,
    "authenticated",
    "update public.commission_rate_versions set percentage = 99",
    [],
    U.ownerA,
  );
  const written = await countOf(
    db,
    "public.commission_rate_versions",
    "percentage = 50 and fee_type = 'insurance_fee'",
  );
  return { pass: !ins.ok && !sel.ok && !upd.ok && written === 0, ins, sel, upd, written };
}
{
  const r = await check17();
  ok(
    "B4A-17 authenticated (even a tenant Owner) cannot read, insert or update versions directly",
    r.pass,
    describe(r.ins, r.sel, r.upd),
  );
}
{
  const ins = await asRole(pg, "anon", probeVersion(T.a, U.advA, "2027-01-02"));
  const sel = await asRole(pg, "anon", "select * from public.commission_rate_versions");
  const rpc = await setRpc(pg, "anon", {
    tenant: T.a,
    actor: U.ownerA,
    kind: "adviser",
    adviser: U.advA,
    rates: { fee: 99 },
    now: true,
  });
  ok(
    "B4A-18 anon cannot read or write versions or run the mutation RPC",
    !ins.ok && !sel.ok && !rpc.ok,
    describe(ins, sel, rpc),
  );
}
{
  const pub = await sqlOn(
    pg,
    `select c.relname from pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
     where c.oid in ('public.commission_rate_versions'::regclass, 'public.commission_rates_pre_b4a'::regclass,
                     'public.commission_rate_history_pre_b4a'::regclass) and a.grantee = 0
     union all
     select p.proname from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
     where p.pronamespace = 'public'::regnamespace and a.grantee = 0
       and p.proname in ('set_commission_rate_versions', 'resolve_commission_rate_as_of', 'commission_rate_versions_guard')`,
  );
  ok(
    "B4A-19 PUBLIC holds no privilege on versions, archives or the rate functions",
    pub.length === 0,
    JSON.stringify(pub),
  );
}
async function check20(db = pg) {
  const srvUpd = await asRole(
    db,
    "service_role",
    "update public.commission_rate_versions set percentage = 99",
  );
  const srvDel = await asRole(db, "service_role", "delete from public.commission_rate_versions");
  const ownerUpd = await outcome(() =>
    sqlOn(db, "update public.commission_rate_versions set percentage = 99"),
  );
  const ownerDel = await outcome(() => sqlOn(db, "delete from public.commission_rate_versions"));
  const ownerTrunc = await outcome(() => sqlOn(db, "truncate public.commission_rate_versions"));
  const changed = await countOf(db, "public.commission_rate_versions", "percentage = 99");
  const total = await countOf(db, "public.commission_rate_versions");
  return {
    pass:
      !srvUpd.ok &&
      !srvDel.ok &&
      !ownerUpd.ok &&
      !ownerDel.ok &&
      !ownerTrunc.ok &&
      changed === 0 &&
      total > 0,
    changed,
    total,
    detail: describe(srvUpd, srvDel, ownerUpd, ownerDel, ownerTrunc),
  };
}
{
  const r = await check20();
  ok(
    "B4A-20 versions are immutable: service_role has no UPDATE/DELETE and even the table owner's UPDATE/DELETE/TRUNCATE is refused",
    r.pass,
    r.detail,
  );
}
{
  const neg = await asRole(
    pg,
    "service_role",
    probeVersion(T.a, U.advInactive, "2027-02-01").replace("50,", "-1,"),
  );
  const over = await asRole(
    pg,
    "service_role",
    probeVersion(T.a, U.advInactive, "2027-02-02").replace("50,", "100.001,"),
  );
  const precise = await asRole(
    pg,
    "service_role",
    probeVersion(T.a, U.advInactive, "2027-02-03").replace("50,", "12.345,") +
      " returning percentage::text as p",
  );
  ok(
    "B4A-21 percentage stays 0..100 with three-decimal precision (negative and >100 refused; 12.345 kept exactly)",
    !neg.ok && !over.ok && precise.ok && precise.rows[0].p === "12.345",
    describe(neg, over, precise),
  );
}
{
  const foreign = await asRole(
    pg,
    "service_role",
    `insert into public.commission_rate_versions (tenant_id, subject_kind, introducer_id, fee_type, percentage, effective_from, created_by, source)
     values ('${T.b}', 'introducer', '${I.introA}', 'fee', 5, '2027-03-01', '${U.ownerB}', 'owner')`,
  );
  const insuranceForIntroducer = await asRole(
    pg,
    "service_role",
    `insert into public.commission_rate_versions (tenant_id, subject_kind, introducer_id, fee_type, percentage, effective_from, created_by, source)
     values ('${T.a}', 'introducer', '${I.introA}', 'insurance_fee', 5, '2027-03-01', '${U.ownerA}', 'owner')`,
  );
  ok(
    "B4A-22 an introducer version cannot point at another tenant's registration (composite FK) or carry insurance/other fee types",
    !foreign.ok && /foreign key/i.test(foreign.message) && !insuranceForIntroducer.ok,
    describe(foreign, insuranceForIntroducer),
  );
}
{
  const r = await asRole(pg, "service_role", probeVersion(T.b, U.advA, "2027-03-02"));
  ok(
    "B4A-23 an adviser version needs that user's adviser capacity in the same tenant (no global user rate)",
    !r.ok && /foreign key/i.test(r.message),
    r.message,
  );
}
{
  const fns = await sqlOn(
    pg,
    `select p.proname, p.prosecdef, p.proconfig::text as cfg,
            has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_x,
            has_function_privilege('anon', p.oid, 'EXECUTE') as anon_x,
            has_function_privilege('service_role', p.oid, 'EXECUTE') as srv_x
     from pg_proc p where p.pronamespace = 'public'::regnamespace
       and p.proname in ('set_commission_rate_versions', 'resolve_commission_rate_as_of', 'commission_rate_versions_guard')
     order by 1`,
  );
  const authRpc = await setRpc(
    pg,
    "authenticated",
    {
      tenant: T.a,
      actor: U.ownerA,
      kind: "adviser",
      adviser: U.advA,
      rates: { fee: 99 },
      now: true,
    },
    U.ownerA,
  );
  const good =
    fns.length === 3 &&
    fns.every(
      (f) => !f.prosecdef && f.cfg === '{"search_path=\\"\\""}' && !f.auth_x && !f.anon_x,
    ) &&
    fns.filter((f) => f.proname !== "commission_rate_versions_guard").every((f) => f.srv_x);
  ok(
    "B4A-24 rate functions are SECURITY INVOKER with an empty search_path; EXECUTE for service_role only (authenticated RPC refused)",
    good && !authRpc.ok,
    JSON.stringify(fns.map((f) => [f.proname, f.prosecdef, f.cfg, f.auth_x, f.srv_x])),
  );
}
{
  const r = await asRole(
    pg,
    "service_role",
    probeVersion(T.a, U.advA, "2026-01-01").replace("'insurance_fee'", "'fee'"),
  );
  ok(
    "B4A-25 the timeline is append-only: a version not after the latest one for its subject and fee type is refused",
    !r.ok && /commission_rate_effective_not_after_latest/.test(r.message),
    r.message,
  );
}

// =============================================================================================
// AS-OF RESOLUTION
// =============================================================================================
// Timeline for the A2 dual-tenant introducer: T002 registration first (foreign history), then two
// T001 versions.
const tl = [
  {
    tenant: T.b,
    actor: U.ownerB,
    introducer: I.dualB,
    rates: { fee: 50 },
    from: "2024-06-01T00:00:00Z",
  },
  {
    tenant: T.a,
    actor: U.ownerA,
    introducer: I.dualA,
    rates: { fee: 5 },
    from: "2025-01-01T00:00:00Z",
  },
  {
    tenant: T.a,
    actor: U.ownerA,
    introducer: I.dualA,
    rates: { fee: 8 },
    from: "2025-06-01T00:00:00Z",
  },
];
async function seedTimeline(db) {
  const out = [];
  if ((await countOf(db, "public.commission_rate_versions", "introducer_id = $1", [I.dualA])) > 0)
    return out;
  for (const v of tl) {
    out.push(
      await setRpc(db, "service_role", {
        ...v,
        kind: "introducer",
        confirm: true,
        reason: "Agreed terms",
      }),
    );
  }
  return out;
}
const tlResults = await seedTimeline(pg);
ok(
  "B4A-26a backdated Owner versions are written through the RPC with confirmation and a reason",
  tlResults.length === 3 && tlResults.every((r) => r.ok && r.rows.length === 1),
  describe(...tlResults),
);
async function check26(db = pg) {
  await seedTimeline(db);
  const q = (at) =>
    pctAt(db, { tenant: T.a, kind: "introducer", introducer: I.dualA, fee: "fee", at });
  const r = {
    mid: await q("2025-03-01T00:00:00Z"),
    after: await q("2025-07-01T00:00:00Z"),
    boundary: await q("2025-06-01T00:00:00Z"),
  };
  return { pass: r.mid === 5 && r.after === 8 && r.boundary === 8, r };
}
{
  const r = await check26();
  ok(
    "B4A-26 as-of returns the version effective at the event time (historical, boundary inclusive, latest)",
    r.pass,
    JSON.stringify(r.r),
  );
}
async function check27(db = pg) {
  await seedTimeline(db);
  const r = await pctAt(db, {
    tenant: T.a,
    kind: "introducer",
    introducer: I.dualA,
    fee: "fee",
    at: "2024-12-31T23:59:59Z",
  });
  return { pass: r === null, r };
}
{
  const r = await check27();
  ok(
    "B4A-27 as-of before the first version returns no rate (no earliest-version fallback)",
    r.pass,
    String(r.r),
  );
}
async function check28(db = pg) {
  await seedTimeline(db);
  const r = {
    beforeA: await pctAt(db, {
      tenant: T.a,
      kind: "introducer",
      introducer: I.dualA,
      fee: "fee",
      at: "2024-09-01T00:00:00Z",
    }),
    foreignSubjectInA: await pctAt(db, {
      tenant: T.a,
      kind: "introducer",
      introducer: I.dualB,
      fee: "fee",
      at: "2026-01-01T00:00:00Z",
    }),
    b: await pctAt(db, {
      tenant: T.b,
      kind: "introducer",
      introducer: I.dualB,
      fee: "fee",
      at: "2026-01-01T00:00:00Z",
    }),
  };
  return { pass: r.beforeA === null && r.foreignSubjectInA === null && r.b === 50, r };
}
{
  const r = await check28();
  ok(
    "B4A-28 foreign-tenant history is ignored: the same Auth identity's T002 registration rate never resolves in T001",
    r.pass,
    JSON.stringify(r.r),
  );
}
async function check28b(db = pg) {
  if (
    (await countOf(
      db,
      "public.commission_rate_versions",
      "tenant_id = $1 and adviser_user_id = $2",
      [T.b, U.dualAdv],
    )) === 0
  ) {
    await setRpc(db, "service_role", {
      tenant: T.b,
      actor: U.ownerB,
      kind: "adviser",
      adviser: U.dualAdv,
      rates: { fee: 25 },
      now: true,
    });
  }
  const r = {
    a: await pctAt(db, {
      tenant: T.a,
      kind: "adviser",
      adviser: U.dualAdv,
      fee: "fee",
      at: new Date(Date.now() + 60000).toISOString(),
    }),
    b: await pctAt(db, {
      tenant: T.b,
      kind: "adviser",
      adviser: U.dualAdv,
      fee: "fee",
      at: new Date(Date.now() + 60000).toISOString(),
    }),
  };
  return { pass: r.a === null && r.b === 25, r };
}
async function tieDb(text = b4aSql) {
  const db = await preB4aDb();
  const m = await applyMigration(db, text);
  if (!m.ok) throw new Error(`tie fixture migration failed: ${m.message}`);
  await sqlOn(
    db,
    "alter table public.commission_rate_versions disable trigger commission_rate_versions_append_only",
  );
  await sqlOn(
    db,
    "alter table public.commission_rate_versions drop constraint commission_rate_versions_subject_effective_key",
  );
  for (const pct of [20, 30]) {
    await sqlOn(
      db,
      `insert into public.commission_rate_versions (tenant_id, subject_kind, adviser_user_id, adviser_role, fee_type, percentage, effective_from, created_by, source)
       values ($1, 'adviser', $2, 'adviser', 'insurance_fee', $3, '2026-01-01T00:00:00Z', $4, 'owner')`,
      [T.a, U.advA, pct, U.ownerA],
    );
  }
  return db;
}
async function check29(text = b4aSql) {
  const db = await tieDb(text);
  const r = await resolveAs(db, "service_role", {
    tenant: T.a,
    kind: "adviser",
    adviser: U.advA,
    fee: "insurance_fee",
    at: "2026-02-01T00:00:00Z",
  });
  return { pass: !r.ok && /commission_rate_ambiguous/.test(r.message), r };
}
{
  const r = await check29();
  ok(
    "B4A-29 two versions at the same effective instant fail closed (commission_rate_ambiguous), never an arbitrary pick",
    r.pass,
    describe(r.r),
  );
}
async function check30(mod = ff) {
  // dualAdv holds an adviser capacity in both tenants; only T002 gets a rate.
  const set = await call(
    mod.setCommissionRate,
    { userId: U.dualAdv, role: "advisor", rates: { fee: 25 }, effective: { mode: "now" } },
    U.ownerB,
    SLUG.b,
  );
  const inA = await call(
    mod.getCommissionRate,
    { userId: U.dualAdv, role: "advisor" },
    U.ownerA,
    SLUG.a,
  );
  const inB = await call(
    mod.getCommissionRate,
    { userId: U.dualAdv, role: "advisor" },
    U.ownerB,
    SLUG.b,
  );
  return {
    pass:
      set.ok &&
      inA.ok &&
      inA.value.subjectAvailable === true &&
      inA.value.pctFee === null &&
      inB.ok &&
      inB.value.pctFee === 25,
    set,
    inA,
    inB,
  };
}
{
  const r = await check30();
  ok(
    "B4A-30 T001 and T002 adviser rates are independent for the same Auth identity (no global user_id fallback)",
    r.pass,
    describe(r.set, r.inA, r.inB) + (r.inA.ok ? ` inA=${r.inA.value.pctFee}` : ""),
  );
}
{
  const r = await check28b();
  ok(
    "B4A-28b an adviser capacity's rate in T002 never resolves for the same user's T001 capacity (resolver keyed by tenant)",
    r.pass,
    JSON.stringify(r.r),
  );
}
async function check30b(mod = ff) {
  if (
    (await countOf(pg, "public.commission_rate_versions", "introducer_id = $1", [I.introB])) === 0
  ) {
    await setRpc(pg, "service_role", {
      tenant: T.b,
      actor: U.ownerB,
      kind: "introducer",
      introducer: I.introB,
      rates: { fee: 40 },
      now: true,
    });
  }
  const inA = await call(
    mod.getCommissionRate,
    { userId: U.introB, role: "introducer" },
    U.ownerA,
    SLUG.a,
  );
  const histA = await call(
    mod.listCommissionRateHistory,
    { userId: U.introB, role: "introducer" },
    U.ownerA,
    SLUG.a,
  );
  return {
    pass:
      inA.ok &&
      inA.value.subjectAvailable === false &&
      inA.value.pctFee === null &&
      histA.ok &&
      histA.value.length === 0,
    inA,
    histA,
  };
}
{
  const r = await check30b();
  ok(
    "B4A-30b a T001 Owner sees no rate and no history for a user whose only introducer registration (and rate) is in T002",
    r.pass,
    describe(r.inA, r.histA) + (r.inA.ok ? ` ${JSON.stringify(r.inA.value)}` : ""),
  );
}
{
  const nullAt = await resolveAs(pg, "service_role", {
    tenant: T.a,
    kind: "adviser",
    adviser: U.advA,
    fee: "fee",
    at: null,
  });
  const badShape = await resolveAs(pg, "service_role", {
    tenant: T.a,
    kind: "adviser",
    adviser: U.advA,
    introducer: I.introA,
    fee: "fee",
    at: new Date().toISOString(),
  });
  const tsNull = await outcome(() =>
    rates.resolveCommissionRateAsOf(adminDb, {
      tenantId: T.a,
      subject: { kind: "adviser", adviserUserId: U.advA },
      feeType: "fee",
      eventAt: null,
    }),
  );
  ok(
    "B4A-31 a missing event time fails closed (never now()); ambiguous subject arguments are refused",
    !nullAt.ok &&
      /commission_rate_resolve_invalid/.test(nullAt.message) &&
      !badShape.ok &&
      !tsNull.ok &&
      /commission_rate_resolve_invalid/.test(tsNull.message),
    describe(nullAt, badShape, tsNull),
  );
}

// =============================================================================================
// RATE AUTHORITY AND ATOMIC MUTATION
// =============================================================================================
const advAVersions = () => versionsOf(pg, "tenant_id = $1 and adviser_user_id = $2", [T.a, U.advA]);
async function check32(mod = ff) {
  const before = (await advAVersions()).length;
  const auditBefore = await countOf(
    pg,
    "public.finance_audit_log",
    "audit_type = 'commission_rate_version' and tenant_id = $1 and subject_user_id = $2",
    [T.a, U.advA],
  );
  const r = await call(
    mod.setCommissionRate,
    {
      userId: U.advA,
      role: "advisor",
      rates: { fee: 11, mortgage_fee: 0 },
      effective: { mode: "now" },
      reason: "Annual review",
    },
    U.ownerA,
    SLUG.a,
  );
  const after = await advAVersions();
  const audit = await sqlOn(
    pg,
    `select a.*, a.detail::text as d from public.finance_audit_log a
     where audit_type = 'commission_rate_version' and tenant_id = $1 and subject_user_id = $2 order by fee_type`,
    [T.a, U.advA],
  );
  const fee = after.find((v) => v.fee_type === "fee" && Number(v.pct) === 11);
  const mortgage = after.find((v) => v.fee_type === "mortgage_fee");
  const feeAudit = audit.find((a) => a.fee_type === "fee");
  const detail = feeAudit ? JSON.parse(feeAudit.d) : {};
  return {
    pass:
      r.ok &&
      after.length === before + 2 &&
      fee?.created_by === U.ownerA &&
      fee?.reason === "Annual review" &&
      fee?.source === "owner" &&
      Number(mortgage?.pct) === 0 &&
      audit.length === auditBefore + 2 &&
      feeAudit?.changed_by === U.ownerA &&
      feeAudit?.role === "advisor" &&
      detail.version_id === fee?.id &&
      detail.previous_version_id === after.find((v) => v.legacy_history_id === R.hist_advA)?.id &&
      Number(detail.previous_percentage) === 10 &&
      Number(detail.percentage) === 11 &&
      detail.effective_mode === "now" &&
      detail.reason === "Annual review",
    r,
    detail,
  };
}
{
  const r = await check32();
  ok(
    "B4A-32 the tenant Owner changes rates: one immutable version per changed fee type plus a finance audit row (tenant, actor, subject, fee type, old/new version, effective, reason)",
    r.pass,
    describe(r.r) + ` ${JSON.stringify(r.detail)}`,
  );
}
{
  const legacyStill = await pctAt(pg, {
    tenant: T.a,
    kind: "adviser",
    adviser: U.advA,
    fee: "fee",
    at: "2026-10-01T00:00:00Z",
  });
  const current = await call(
    ff.getCommissionRate,
    { userId: U.advA, role: "advisor" },
    U.ownerA,
    SLUG.a,
  );
  const history = await call(
    ff.listCommissionRateHistory,
    { userId: U.advA, role: "advisor" },
    U.ownerA,
    SLUG.a,
  );
  const feeRows = history.ok ? history.value.filter((h) => h.fee_type === "fee") : [];
  ok(
    "B4A-33 the old version remains queryable: as-of before the change still returns 10%; history shows 10% → 11% and the migrated first rate",
    legacyStill === 10 &&
      current.ok &&
      current.value.pctFee === 11 &&
      current.value.pctMortgageFee === 0 &&
      current.value.pctInsuranceFee === null &&
      feeRows.length === 2 &&
      feeRows[0].pct_from === 10 &&
      feeRows[0].pct_to === 11 &&
      feeRows[1].pct_from === null &&
      feeRows[1].source === "legacy_migration",
    `legacy=${legacyStill} ${describe(current, history)} rows=${JSON.stringify(feeRows.map((h) => [h.pct_from, h.pct_to]))}`,
  );
}
async function deniedMutation(mod, actor, slug = SLUG.a, userId = U.advA, role = "advisor") {
  const before = await countOf(pg, "public.commission_rate_versions");
  const r = await call(
    mod.setCommissionRate,
    { userId, role, rates: { fee: 42 }, effective: { mode: "now" } },
    actor,
    slug,
  );
  const after = await countOf(pg, "public.commission_rate_versions");
  return { pass: !r.ok && after === before, r, written: after - before };
}
async function check34(mod = ff) {
  return deniedMutation(mod, U.supA);
}
{
  const r = await check34();
  ok("B4A-34 a Supervisor (full view authority) cannot change a rate", r.pass, describe(r.r));
}
{
  const r = await deniedMutation(ff, U.genA);
  const view = await call(
    ff.getCommissionRate,
    { userId: U.advA, role: "advisor" },
    U.genA,
    SLUG.a,
  );
  ok(
    "B4A-35 a General Admin holding amend on both commission % permissions still cannot change a rate (admin_access is not rate authority); can view",
    r.pass && view.ok,
    describe(r.r, view),
  );
}
{
  const r = await deniedMutation(ff, U.advA);
  ok("B4A-36 an adviser cannot change rates (not even their own)", r.pass, describe(r.r));
}
{
  const r = await deniedMutation(ff, U.introA, SLUG.a, U.introA, "introducer");
  ok("B4A-37 an introducer cannot change rates (not even their own)", r.pass, describe(r.r));
}
{
  const foreignOwner = await deniedMutation(ff, U.ownerB, SLUG.a);
  const ownerAInB = await deniedMutation(ff, U.ownerA, SLUG.b, U.advB);
  ok(
    "B4A-38 an Owner of another tenant cannot change this tenant's rates, from either tenant's route",
    foreignOwner.pass && ownerAInB.pass,
    describe(foreignOwner.r, ownerAInB.r),
  );
}
async function check39(db = pg) {
  const before = await countOf(db, "public.commission_rate_versions");
  const sup = await setRpc(db, "service_role", {
    tenant: T.a,
    actor: U.supA,
    kind: "adviser",
    adviser: U.advA,
    rates: { insurance_fee: 33 },
    now: true,
  });
  const foreign = await setRpc(db, "service_role", {
    tenant: T.a,
    actor: U.ownerB,
    kind: "adviser",
    adviser: U.advA,
    rates: { insurance_fee: 33 },
    now: true,
  });
  const after = await countOf(db, "public.commission_rate_versions");
  return {
    pass:
      !sup.ok &&
      /commission_rate_forbidden/.test(sup.message) &&
      !foreign.ok &&
      /commission_rate_forbidden/.test(foreign.message) &&
      after === before,
    sup,
    foreign,
    written: after - before,
  };
}
{
  const r = await check39();
  ok(
    "B4A-39 the RPC re-checks Owner membership in the tenant (Supervisor or foreign Owner as actor → commission_rate_forbidden)",
    r.pass,
    describe(r.sup, r.foreign),
  );
}
async function migratedDb(text = b4aSql) {
  const db = await preB4aDb();
  const m = await applyMigration(db, text);
  if (!m.ok) throw new Error(`migration failed: ${m.message}`);
  return db;
}
async function check40(text = b4aSql) {
  const db = await migratedDb(text);
  await sqlOn(
    db,
    "alter table public.finance_audit_log add constraint b4a_probe_audit_refuses check (audit_type <> 'commission_rate_version')",
  );
  const before = await countOf(db, "public.commission_rate_versions");
  const r = await setRpc(db, "service_role", {
    tenant: T.a,
    actor: U.ownerA,
    kind: "adviser",
    adviser: U.advA,
    rates: { fee: 15 },
    now: true,
  });
  const after = await countOf(db, "public.commission_rate_versions");
  return { pass: !r.ok && after === before, r, versionsWritten: after - before };
}
{
  const r = await check40();
  ok(
    "B4A-40 version and audit are atomic: when the audit row cannot be written, no version is written",
    r.pass,
    describe(r.r),
  );
}
{
  const future = await setRpc(pg, "service_role", {
    tenant: T.b,
    actor: U.ownerB,
    kind: "adviser",
    adviser: U.advB,
    rates: { mortgage_fee: 3 },
    from: "2030-01-01T00:00:00Z",
  });
  const before = JSON.stringify(await versionsOf(pg, "tenant_id = $1", [T.b]));
  const auditBefore = await countOf(pg, "public.finance_audit_log", "tenant_id = $1", [T.b]);
  const both = await setRpc(pg, "service_role", {
    tenant: T.b,
    actor: U.ownerB,
    kind: "adviser",
    adviser: U.advB,
    rates: { fee: 13, mortgage_fee: 4 },
    now: true,
  });
  const after = JSON.stringify(await versionsOf(pg, "tenant_id = $1", [T.b]));
  const auditAfter = await countOf(pg, "public.finance_audit_log", "tenant_id = $1", [T.b]);
  ok(
    "B4A-41 a failure on any fee type leaves no partial state (fee 13% not written when mortgage fee conflicts with a future version)",
    future.ok &&
      !both.ok &&
      /commission_rate_effective_not_after_latest/.test(both.message) &&
      before === after &&
      auditBefore === auditAfter,
    describe(future, both),
  );
}
{
  const same = await call(
    ff.setCommissionRate,
    { userId: U.advA, role: "advisor", rates: { fee: 11 }, effective: { mode: "now" } },
    U.ownerA,
    SLUG.a,
  );
  const empty = await outcome(() =>
    invoke(
      ff.setCommissionRate,
      { userId: U.advA, role: "advisor", rates: {}, effective: { mode: "now" } },
      U.ownerA,
      SLUG.a,
    ),
  );
  const unknownType = await outcome(() =>
    invoke(
      ff.setCommissionRate,
      { userId: U.advA, role: "advisor", rates: { bonus: 5 }, effective: { mode: "now" } },
      U.ownerA,
      SLUG.a,
    ),
  );
  ok(
    "B4A-42 an unchanged value creates nothing (no-change refused); empty or unknown fee types refused",
    !same.ok && /No rate changed/.test(same.message) && !empty.ok && !unknownType.ok,
    describe(same, empty, unknownType),
  );
}
async function check43(db = pg) {
  const base = { tenant: T.a, actor: U.ownerA, kind: "introducer", introducer: I.introA };
  const unconfirmed = await setRpc(db, "service_role", {
    ...base,
    rates: { fee: 6 },
    from: "2026-02-01T00:00:00Z",
    reason: "late paperwork",
  });
  const noReason = await setRpc(db, "service_role", {
    ...base,
    rates: { fee: 6 },
    from: "2026-02-01T00:00:00Z",
    confirm: true,
  });
  const both = await setRpc(db, "service_role", {
    ...base,
    rates: { fee: 6 },
    now: true,
    from: "2026-02-01T00:00:00Z",
  });
  const infinite = await setRpc(db, "service_role", {
    ...base,
    rates: { fee: 6 },
    from: "infinity",
  });
  const unset = await setRpc(db, "service_role", { ...base, rates: { fee: 6 } });
  const written = await countOf(db, "public.commission_rate_versions", "introducer_id = $1", [
    I.introA,
  ]);
  return {
    pass:
      !unconfirmed.ok &&
      /commission_rate_backdate_unconfirmed/.test(unconfirmed.message) &&
      !noReason.ok &&
      /commission_rate_backdate_reason_required/.test(noReason.message) &&
      !both.ok &&
      !infinite.ok &&
      !unset.ok &&
      written === 0,
    detail: describe(unconfirmed, noReason, both, infinite, unset),
  };
}
{
  const r = await check43();
  const viaFn = await call(
    ff.setCommissionRate,
    {
      userId: U.introA,
      role: "introducer",
      rates: { fee: 6 },
      effective: { mode: "date", effectiveFrom: "2026-02-01T00:00:00Z" },
      reason: "late paperwork",
    },
    U.ownerA,
    SLUG.a,
  );
  ok(
    "B4A-43 the effective date is explicit: backdating needs confirmation and a reason; now+date, infinity and no choice are refused",
    r.pass && !viaFn.ok && /Confirm the backdated rate/.test(viaFn.message),
    r.detail + " | " + describe(viaFn),
  );
}
{
  const futureOk = await call(
    ff.setCommissionRate,
    {
      userId: U.introA,
      role: "introducer",
      rates: { mortgage_fee: 7.5 },
      effective: { mode: "date", effectiveFrom: "2031-01-01T00:00:00Z" },
    },
    U.ownerA,
    SLUG.a,
  );
  const beforeLatest = await setRpc(pg, "service_role", {
    tenant: T.a,
    actor: U.ownerA,
    kind: "introducer",
    introducer: I.introA,
    rates: { mortgage_fee: 9 },
    from: "2030-12-31T00:00:00Z",
  });
  const nowBeforeFuture = await setRpc(pg, "service_role", {
    tenant: T.a,
    actor: U.ownerA,
    kind: "introducer",
    introducer: I.introA,
    rates: { mortgage_fee: 9 },
    now: true,
  });
  ok(
    "B4A-44 a future-dated version is allowed; nothing may be inserted before the latest version (no overlap, no silent reorder)",
    futureOk.ok &&
      !beforeLatest.ok &&
      /commission_rate_effective_not_after_latest/.test(beforeLatest.message) &&
      !nowBeforeFuture.ok,
    describe(futureOk, beforeLatest, nowBeforeFuture),
  );
}
async function check45(db = pg) {
  const base = { tenant: T.a, actor: U.ownerA, kind: "adviser", adviser: U.advA, now: true };
  const four = await setRpc(db, "service_role", { ...base, rates: { other_fee: 12.3456 } });
  const neg = await setRpc(db, "service_role", { ...base, rates: { other_fee: -1 } });
  const over = await setRpc(db, "service_role", { ...base, rates: { other_fee: 101 } });
  const text = await setRpc(db, "service_role", { ...base, rates: { other_fee: "12" } });
  const stored = await countOf(
    db,
    "public.commission_rate_versions",
    "adviser_user_id = $1 and fee_type = 'other_fee'",
    [U.advA],
  );
  return {
    pass:
      !four.ok &&
      /commission_rate_percentage_invalid/.test(four.message) &&
      !neg.ok &&
      !over.ok &&
      !text.ok &&
      stored === 0,
    detail: describe(four, neg, over, text),
    stored,
  };
}
{
  const r = await check45();
  const fnFour = await outcome(() =>
    invoke(
      ff.setCommissionRate,
      {
        userId: U.advA,
        role: "advisor",
        rates: { other_fee: 12.3456 },
        effective: { mode: "now" },
      },
      U.ownerA,
      SLUG.a,
    ),
  );
  const fnOver = await outcome(() =>
    invoke(
      ff.setCommissionRate,
      { userId: U.advA, role: "advisor", rates: { other_fee: 100.5 }, effective: { mode: "now" } },
      U.ownerA,
      SLUG.a,
    ),
  );
  ok(
    "B4A-45 percentages are never loosened or silently rounded: >3 decimals, negative, >100 and non-numbers refused by validator and RPC",
    r.pass && !fnFour.ok && !fnOver.ok,
    r.detail + " | " + describe(fnFour, fnOver),
  );
}
{
  const zero = await call(
    ff.setCommissionRate,
    { userId: U.introA, role: "introducer", rates: { fee: 0 }, effective: { mode: "now" } },
    U.ownerA,
    SLUG.a,
  );
  const intro = await call(
    ff.getCommissionRate,
    { userId: U.introA, role: "introducer" },
    U.ownerA,
    SLUG.a,
  );
  const unset = await call(
    ff.getCommissionRate,
    { userId: U.dualAdv, role: "advisor" },
    U.ownerA,
    SLUG.a,
  );
  const arrangements = await call(
    ff.listCurrentCommissionArrangements,
    { role: "all" },
    U.ownerA,
    SLUG.a,
  );
  const introRow = arrangements.ok ? arrangements.value.find((a) => a.userId === U.introA) : null;
  ok(
    "B4A-46 no rate set is distinct from an explicit 0%: 0% is stored and shown as 0; unset is null everywhere",
    zero.ok &&
      intro.ok &&
      intro.value.pctFee === 0 &&
      intro.value.pctMortgageFee === null &&
      unset.ok &&
      unset.value.subjectAvailable === true &&
      unset.value.pctFee === null &&
      introRow?.pctFee === 0 &&
      introRow?.pctMortgageFee === null,
    describe(zero, intro, unset, arrangements),
  );
}
async function check47(mod = ff) {
  // Posting reads the version effective at posting time: advA 11% (T001), dualAdv has no T001 rate
  // (only T002), the attributed introducer has an explicit 0% fee rate.
  await insertRow(pg, "public.session_advisors", {
    session_id: R.sessCustA,
    advisor_id: U.advA,
    tenant_id: T.a,
  });
  await insertRow(pg, "public.session_advisors", {
    session_id: R.sessCustA,
    advisor_id: U.dualAdv,
    tenant_id: T.a,
  });
  await insertRow(pg, "public.finance_fee_lines", {
    id: R.feeLine1,
    session_id: R.sessCustA,
    fee_type: "fee",
    amount_pence: 100000,
    status: "draft",
    tenant_id: T.a,
  });
  const r = await call(mod.submitSessionFees, { sessionId: R.sessCustA }, U.ownerA, SLUG.a);
  const rows = await sqlOn(
    pg,
    `select beneficiary_user_id, beneficiary_role, amount_pence, commission_pct::text as pct
     from public.finance_ledger where fee_line_id = $1 and kind = 'commission'`,
    [R.feeLine1],
  );
  return {
    pass:
      r.ok &&
      rows.length === 1 &&
      rows[0].beneficiary_user_id === U.advA &&
      rows[0].amount_pence === 11000 &&
      Number(rows[0].pct) === 11,
    r,
    rows,
  };
}
{
  const r = await check47();
  ok(
    "B4A-47 posting resolves each subject's version in the case tenant: 11% adviser row only; no row for a foreign-tenant-only adviser rate or an explicit 0% introducer rate; no default",
    r.pass,
    describe(r.r) + ` ${JSON.stringify(r.rows)}`,
  );
}

// =============================================================================================
// STAFF INTRODUCER REGISTRATION (no rate seed, no revival, one tenant)
// =============================================================================================
const linkInput = (label) => ({
  customerName: `Synthetic ${label}`,
  customerPhone: "01632960001",
  customerEmail: `synthetic.${label}@example.test`,
  sendSms: false,
});
const regOf = (userKey, tenantId) =>
  sqlOn(
    pg,
    `select i.*, i::text as t from public.introducers i where user_id = $1 and tenant_id = $2`,
    [U[userKey], tenantId],
  ).then((r) => r[0] ?? null);
async function check48(mod = bf) {
  const versionsBefore = await countOf(pg, "public.commission_rate_versions");
  const r = await call(mod.sendStaffCustomerBookingLink, linkInput("staffnew"), U.staffNew, SLUG.a);
  const reg = await regOf("staffNew", T.a);
  const versionsAfter = await countOf(pg, "public.commission_rate_versions");
  const rate = reg
    ? await pctAt(pg, {
        tenant: T.a,
        kind: "introducer",
        introducer: reg.id,
        fee: "fee",
        at: new Date(Date.now() + 86400000).toISOString(),
      })
    : "no-registration";
  return {
    pass: r.ok && reg?.active === true && versionsAfter === versionsBefore && rate === null,
    r,
    rate,
    versionsAfter,
    versionsBefore,
  };
}
{
  const r = await check48();
  ok(
    "B4A-48 a new staff introducer registration is created with NO RATE SET (no 10% seed, no tenant/global default, no version)",
    r.pass,
    describe(r.r) + ` rate=${r.rate}`,
  );
}
async function check49(mod = bf) {
  const before = await regOf("supDisabled", T.a);
  const r = await call(
    mod.sendStaffCustomerBookingLink,
    linkInput("supdisabled"),
    U.supDisabled,
    SLUG.a,
  );
  const after = await regOf("supDisabled", T.a);
  const regs = await countOf(pg, "public.introducers", "user_id = $1", [U.supDisabled]);
  return {
    pass: !r.ok && after?.t === before?.t && after?.active === false && regs === 1,
    r,
    reactivated: after?.active === true,
  };
}
{
  const r = await check49();
  ok(
    "B4A-49 sending a booking link never revives a disabled registration (refused; registration unchanged)",
    r.pass,
    describe(r.r),
  );
}
{
  const before = await regOf("supDeleted", T.a);
  const r = await call(
    bf.sendStaffCustomerBookingLink,
    linkInput("supdeleted"),
    U.supDeleted,
    SLUG.a,
  );
  const after = await regOf("supDeleted", T.a);
  ok(
    "B4A-50 sending a booking link never restores a deleted registration (refused; registration unchanged)",
    !r.ok &&
      after?.t === before?.t &&
      Boolean(after?.deleted_at) &&
      (await countOf(pg, "public.introducers", "user_id = $1", [U.supDeleted])) === 1,
    describe(r),
  );
}
{
  const before = await regOf("supDisabled", T.a);
  const r = await call(
    bf.bookCustomerAppointmentAsStaff,
    {
      customerId: U.custA,
      customerName: "Synthetic Customer",
      customerPhone: "01632960002",
      customerEmail: "synthetic.custa@example.test",
      startsAt: nextSlot(),
      advisorId: U.advA,
      sendSms: false,
    },
    U.supDisabled,
    SLUG.a,
  );
  const after = await regOf("supDisabled", T.a);
  const appt = r.ok
    ? await sqlOn(pg, `select introducer_id from public.appointments where id = $1`, [
        r.value?.appointmentId ?? r.value?.id ?? null,
      ])
    : [];
  const credited = await countOf(pg, "public.appointments", "introducer_id = $1", [I.supDisabled]);
  ok(
    "B4A-51 a staff booking by someone whose registration is disabled neither revives it nor credits it",
    after?.t === before?.t && credited === 0,
    describe(r) + ` appt=${JSON.stringify(appt)}`,
  );
}
{
  const aBefore = await regOf("staffDual", T.a);
  const r = await call(
    bf.sendStaffCustomerBookingLink,
    linkInput("staffdual"),
    U.staffDual,
    SLUG.b,
  );
  const inB = await regOf("staffDual", T.b);
  const aAfter = await regOf("staffDual", T.a);
  const noSlug = await call(
    bf.sendStaffCustomerBookingLink,
    linkInput("staffdual2"),
    U.staffDual,
    null,
  );
  const lead = inB
    ? await sqlOn(pg, `select tenant_id from public.introducer_leads where introducer_id = $1`, [
        inB.id,
      ])
    : [];
  ok(
    "B4A-52 a dual-tenant staff member's booking link registers and leads only in the acting tenant; no slug with two memberships is refused (no arbitrary membership)",
    r.ok &&
      inB?.tenant_id === T.b &&
      aBefore === null &&
      aAfter === null &&
      lead.length === 1 &&
      lead[0].tenant_id === T.b &&
      !noSlug.ok,
    describe(r, noSlug),
  );
}
{
  const fn = SRC.booking.slice(
    SRC.booking.indexOf("async function ensureStaffIntroducerRecord("),
    SRC.booking.indexOf("async function sendBookingConfirmations("),
  );
  ok(
    "B4A-53 ensureStaffIntroducerRecord reads and writes no rate table, never updates an existing registration, and takes the tenant from its caller",
    fn.length > 0 &&
      !/commission_rate|percentage|pct_fee|resolveSoleMembershipTenant/.test(fn) &&
      !/\.update\(/.test(fn) &&
      /staffUserId: string,\s*tenantId: string/.test(fn),
  );
}

// =============================================================================================
// FINANCE SETTINGS AND REFER A FRIEND
// =============================================================================================
{
  const a = await call(ff.getRafBonusAmount, {}, U.ownerA, SLUG.a);
  const b = await call(ff.getRafBonusAmount, {}, U.ownerB, SLUG.b);
  ok(
    "B4A-54 finance settings are per tenant: T001 7500 configured; T002 not configured (null), never T001's value",
    a.ok &&
      a.value.amountPence === 7500 &&
      a.value.configured === true &&
      b.ok &&
      b.value.amountPence === null &&
      b.value.configured === false,
    describe(a, b),
  );
}
async function check55(mod = rf) {
  const before = await sqlOn(pg, `select r::text as t from public.referrals r where id = $1`, [
    R.refNoneB,
  ]);
  const ledgerBefore = await countOf(pg, "public.finance_ledger", "tenant_id = $1", [T.b]);
  const r = await call(
    mod.updateReferralBonusStatus,
    { id: R.refNoneB, bonusStatus: "eligible" },
    U.ownerB,
    SLUG.b,
  );
  const after = await sqlOn(pg, `select r::text as t from public.referrals r where id = $1`, [
    R.refNoneB,
  ]);
  const rows = await sqlOn(
    pg,
    `select amount_pence from public.finance_ledger where tenant_id = $1 and referral_id = $2`,
    [T.b, R.refNoneB],
  );
  return {
    pass:
      !r.ok &&
      /not configured/.test(r.message) &&
      before[0]?.t === after[0]?.t &&
      rows.length === 0 &&
      (await countOf(pg, "public.finance_ledger", "tenant_id = $1", [T.b])) === ledgerBefore,
    r,
    rows,
  };
}
{
  const r = await check55();
  ok(
    "B4A-55 no £75 fallback: marking a T002 bonus eligible with no configured amount is refused; referral and ledger unchanged",
    r.pass,
    describe(r.r) + ` rows=${JSON.stringify(r.rows)}`,
  );
}
async function readWrites(fn) {
  const before = JSON.stringify({
    state: await businessState(pg),
    v: await rowsText(pg, "public.commission_rate_versions"),
  });
  writeLog.length = 0;
  const r = await fn();
  const writes = [...writeLog];
  const after = JSON.stringify({
    state: await businessState(pg),
    v: await rowsText(pg, "public.commission_rate_versions"),
  });
  return { r, writes, unchanged: before === after };
}
async function check56(mod = ff) {
  const x = await readWrites(() => call(mod.listCommissionPayouts, {}, U.ownerA, SLUG.a));
  const rafRows = await countOf(pg, "public.finance_ledger", "referral_id = $1", [R.refEligibleA]);
  return { pass: x.r.ok && x.writes.length === 0 && x.unchanged && rafRows === 0, ...x, rafRows };
}
{
  const r = await check56();
  ok(
    "B4A-56 listCommissionPayouts makes zero writes (eligible referral without a ledger row stays without one)",
    r.pass,
    describe(r.r) + ` writes=${JSON.stringify(r.writes)}`,
  );
}
async function check57(mod = ff) {
  const x = await readWrites(() => call(mod.listMyCommissionStatement, {}, U.referrerA, SLUG.a));
  const rafRows = await countOf(pg, "public.finance_ledger", "referral_id = $1", [R.refEligibleA]);
  return { pass: x.r.ok && x.writes.length === 0 && x.unchanged && rafRows === 0, ...x, rafRows };
}
{
  const r = await check57();
  ok(
    "B4A-57 listMyCommissionStatement makes zero writes for the referrer of an eligible referral",
    r.pass,
    describe(r.r) + ` writes=${JSON.stringify(r.writes)}`,
  );
}
{
  const x = await readWrites(async () => {
    const out = [];
    for (let i = 0; i < 3; i += 1) {
      out.push(await call(ff.listCommissionPayouts, {}, U.ownerA, SLUG.a));
      out.push(await call(ff.listMyCommissionStatement, {}, U.referrerA, SLUG.a));
      out.push(await call(ff.listCommissionPayouts, {}, U.ownerB, SLUG.b));
    }
    return { ok: out.every((o) => o.ok), out };
  });
  ok(
    "B4A-58 repeated reads in both tenants create no rows and no duplicates",
    x.r.ok && x.writes.length === 0 && x.unchanged,
    JSON.stringify(x.writes),
  );
}
{
  const first = await call(
    rf.updateReferralBonusStatus,
    { id: R.refNoneA, bonusStatus: "eligible" },
    U.ownerA,
    SLUG.a,
  );
  const again = await call(
    rf.updateReferralBonusStatus,
    { id: R.refNoneA, bonusStatus: "eligible" },
    U.ownerA,
    SLUG.a,
  );
  const rows = await sqlOn(
    pg,
    `select amount_pence, beneficiary_user_id, tenant_id from public.finance_ledger where referral_id = $1`,
    [R.refNoneA],
  );
  ok(
    "B4A-59 an explicit eligible action in T001 posts exactly one RAF row at T001's configured amount (repeat creates no duplicate)",
    first.ok &&
      again.ok &&
      rows.length === 1 &&
      rows[0].amount_pence === 7500 &&
      rows[0].tenant_id === T.a &&
      rows[0].beneficiary_user_id === U.referrerA,
    describe(first, again) + ` ${JSON.stringify(rows)}`,
  );
}

// =============================================================================================
// TENANT-SAFE ENRICHMENT AND DUAL-TENANT CONTEXT
// =============================================================================================
async function check60(mod = ff) {
  const r = await call(mod.listFinanceLedger, {}, U.ownerA, SLUG.a);
  const row = (id) => (r.ok ? r.value.rows.find((x) => x.id === id) : null);
  const adv = row(R.ledgerDualAdvA);
  const intro = row(R.ledgerIntroBA);
  return {
    pass: r.ok && adv && intro && adv.receiverRef === null && intro.receiverRef === null,
    r,
    adv,
    intro,
  };
}
{
  const r = await check60();
  ok(
    "B4A-60 ledger enrichment is tenant-scoped: T001 rows never show a beneficiary's T002 adviser or introducer code",
    r.pass,
    describe(r.r) + ` adv=${r.adv?.receiverRef} intro=${r.intro?.receiverRef}`,
  );
}
async function check61(mod = ff) {
  const setB = await call(
    mod.setCommissionRate,
    { userId: U.staffDual, role: "advisor", rates: { fee: 30 }, effective: { mode: "now" } },
    U.dualOwner,
    SLUG.b,
  );
  const inA = await call(
    mod.getCommissionRate,
    { userId: U.staffDual, role: "advisor" },
    U.dualOwner,
    SLUG.a,
  );
  const inB = await call(
    mod.getCommissionRate,
    { userId: U.staffDual, role: "advisor" },
    U.dualOwner,
    SLUG.b,
  );
  const arrA = await call(
    mod.listCurrentCommissionArrangements,
    { role: "advisor" },
    U.dualOwner,
    SLUG.a,
  );
  const arrB = await call(
    mod.listCurrentCommissionArrangements,
    { role: "advisor" },
    U.dualOwner,
    SLUG.b,
  );
  const stored = await versionsOf(pg, "adviser_user_id = $1", [U.staffDual]);
  return {
    pass:
      setB.ok &&
      inA.ok &&
      inA.value.pctFee === null &&
      inB.ok &&
      inB.value.pctFee === 30 &&
      arrA.ok &&
      !arrA.value.some((a) => a.userId === U.staffDual) &&
      arrB.ok &&
      arrB.value.some((a) => a.userId === U.staffDual && a.pctFee === 30) &&
      stored.length === 1 &&
      stored[0].tenant_id === T.b,
    detail: describe(setB, inA, inB, arrA, arrB),
  };
}
{
  const r = await check61();
  ok(
    "B4A-61 a dual-tenant Owner works per tenant: the route's tenant decides where the rate is written and what is read",
    r.pass,
    r.detail,
  );
}
async function check62(mod = ff) {
  const before = await countOf(pg, "public.commission_rate_versions", "adviser_user_id = $1", [
    U.staffDual,
  ]);
  const noSlugOwner = await call(
    mod.listCurrentCommissionArrangements,
    { role: "all" },
    U.dualOwner,
    null,
  );
  const noSlugSet = await call(
    mod.setCommissionRate,
    { userId: U.staffDual, role: "advisor", rates: { fee: 31 }, effective: { mode: "now" } },
    U.dualOwner,
    null,
  );
  const after = await countOf(pg, "public.commission_rate_versions", "adviser_user_id = $1", [
    U.staffDual,
  ]);
  const sole = await call(mod.listCurrentCommissionArrangements, { role: "all" }, U.ownerA, null);
  return {
    pass: !noSlugOwner.ok && !noSlugSet.ok && after === before && sole.ok,
    noSlugOwner,
    noSlugSet,
    sole,
    written: after - before,
  };
}
{
  const r = await check62();
  ok(
    "B4A-62 without a route tenant a dual-tenant user is refused (never first/arbitrary membership); a single-membership Owner resolves to that tenant",
    r.pass,
    describe(r.noSlugOwner, r.noSlugSet, r.sole),
  );
}
{
  const inactive = await setRpc(pg, "service_role", {
    tenant: T.a,
    actor: U.ownerA,
    kind: "adviser",
    adviser: U.advInactive,
    rates: { fee: 5 },
    now: true,
  });
  const disabledIntro = await setRpc(pg, "service_role", {
    tenant: T.a,
    actor: U.ownerA,
    kind: "introducer",
    introducer: I.supDisabled,
    rates: { fee: 5 },
    now: true,
  });
  const foreignIntro = await setRpc(pg, "service_role", {
    tenant: T.a,
    actor: U.ownerA,
    kind: "introducer",
    introducer: I.introB,
    rates: { fee: 5 },
    now: true,
  });
  ok(
    "B4A-63 no new version for a disabled registration, an inactive adviser capacity, or another tenant's registration (commission_rate_subject_not_found)",
    [inactive, disabledIntro, foreignIntro].every(
      (x) => !x.ok && /commission_rate_subject_not_found/.test(x.message),
    ),
    describe(inactive, disabledIntro, foreignIntro),
  );
}

// =============================================================================================
// PRESERVATION
// =============================================================================================
{
  const a2 = (
    await sqlOn(
      pg,
      `select i::text as t from public.introducers i where user_id = $1 order by id`,
      [U.introDual],
    )
  ).map((r) => r.t);
  const dualA = await call(
    ff.getCommissionRate,
    { userId: U.introDual, role: "introducer" },
    U.ownerA,
    SLUG.a,
  );
  const dualB = await call(
    ff.getCommissionRate,
    { userId: U.introDual, role: "introducer" },
    U.ownerB,
    SLUG.b,
  );
  ok(
    "B4A-64 A2 fixture preserved: the dual-tenant introducer keeps both registrations, each with its own independent rate (T001 8%, T002 50%)",
    JSON.stringify(a2) === JSON.stringify(preA2) &&
      dualA.ok &&
      dualA.value.pctFee === 8 &&
      dualB.ok &&
      dualB.value.pctFee === 50,
    describe(dualA, dualB),
  );
}
{
  const s4c2 = JSON.stringify(
    await sqlOn(
      pg,
      `select s::text as t from public.interview_sessions s where customer_id = $1
       union all select m::text from public.tenant_memberships m where user_id = $1 order by 1`,
      [U.custS4C2],
    ),
  );
  ok(
    "B4A-65 S4C2 fixture preserved: customer, case and membership rows unchanged",
    s4c2 === preS4C2,
  );
}
{
  const link = await sqlOn(
    pg,
    `select tenant_id, introducer_id from public.customer_introducer_links where customer_id = $1`,
    [U.custA],
  );
  ok(
    "B4A-66 B3 preserved: amendment RPC body/ACL unchanged and the tenant attribution still resolves",
    JSON.stringify(await b3RpcFingerprint(pg)) === preB3Rpc &&
      link.length === 1 &&
      link[0].tenant_id === T.a &&
      link[0].introducer_id === I.introA,
  );
}
{
  const before = await rowsText(pg, "public.finance_ledger");
  const r = await call(
    ic.refreshCustomerIntroducerCommission,
    { customerId: U.custA },
    U.ownerA,
    SLUG.a,
  );
  const after = await rowsText(pg, "public.finance_ledger");
  ok(
    "B4A-67 B3 refresh stays disabled (fails closed, no ledger change)",
    !r.ok &&
      r.message === ic.COMMISSION_REFRESH_DISABLED_MESSAGE &&
      JSON.stringify(before) === JSON.stringify(after),
    describe(r),
  );
}
async function check68(mod = rf) {
  const ledgerBefore = await countOf(pg, "public.finance_ledger");
  await mod.markReferralQualified(U.friendA3, T.a);
  const ref = await sqlOn(pg, `select status, bonus_status from public.referrals where id = $1`, [
    R.refPendingA,
  ]);
  const rafRows = await countOf(pg, "public.finance_ledger", "referral_id = $1", [R.refPendingA]);
  return {
    pass:
      ref[0]?.bonus_status === "eligible" &&
      (await countOf(pg, "public.finance_ledger")) === ledgerBefore,
    ref,
    rafRows,
  };
}
{
  const r = await check68();
  ok(
    "B4A-68 B2b qualification creates no ledger row even where the tenant has a configured RAF amount (status eligible, ledger count unchanged)",
    r.pass,
    JSON.stringify(r.ref),
  );
}
{
  const cat = await catalogOf(pg, [
    "network_commission_statements",
    "network_commission_lines",
    "finance_ledger",
  ]);
  ok(
    "B4A-69 network statement and ledger architecture unchanged (keys, policies, privileges identical; tenantless October intact)",
    JSON.stringify(cat) ===
      JSON.stringify(
        JSON.parse(preCatalog).filter((c) =>
          ["network_commission_statements", "network_commission_lines", "finance_ledger"].includes(
            c.relname,
          ),
        ),
      ) &&
      (await countOf(pg, "public.network_commission_statements", "id = $1 and tenant_id is null", [
        R.octStatement,
      ])) === 1,
  );
}

// =============================================================================================
// STRUCTURAL
// =============================================================================================
const srcFiles = git("ls-files", "src")
  .split("\n")
  .filter((f) => /\.(ts|tsx)$/.test(f));
const srcText = Object.fromEntries(srcFiles.map((f) => [f, read(f)]));
{
  const writers = srcFiles.filter(
    (f) =>
      f !== "src/lib/test-accounts.functions.ts" &&
      f !== "src/integrations/supabase/types.ts" &&
      /from\("commission_rates"\)|from\("commission_rate_history"\)/.test(srcText[f]),
  );
  ok(
    "B4A-70 no application code reads or writes the legacy rate tables (single source: commission_rate_versions)",
    writers.length === 0 && /from\("commission_rate_versions"\)/.test(SRC.finance),
    JSON.stringify(writers),
  );
}
{
  const fallback = srcFiles.filter((f) =>
    /RAF_BONUS_PENCE|RAF_BONUS_POUNDS|\?\? 7500|7500;/.test(srcText[f]),
  );
  const tenTen = /pct_fee: 10|percentage: 10/.test(SRC.booking);
  const uiDefaults = /useState\("10"\)/.test(read(PANELS_REL));
  ok(
    "B4A-71 no hard-coded RAF amount and no default rate anywhere (booking seed gone, UI inputs start blank)",
    fallback.length === 0 && !tenTen && !uiDefaults,
    JSON.stringify({ fallback, tenTen, uiDefaults }),
  );
}
{
  const body = (name) => {
    const start = SRC.finance.indexOf(`export const ${name} = createServerFn`);
    const end = SRC.finance.indexOf("export const ", start + 20);
    return SRC.finance.slice(start, end);
  };
  ok(
    "B4A-72 RAF read paths are pure reads in source (no ensureRafCommissionLedgerEntry in listCommissionPayouts / listMyCommissionStatement)",
    !/ensureRafCommissionLedgerEntry|\.insert\(|\.update\(|\.upsert\(/.test(
      body("listCommissionPayouts"),
    ) &&
      !/ensureRafCommissionLedgerEntry|\.insert\(|\.update\(|\.upsert\(/.test(
        body("listMyCommissionStatement"),
      ),
  );
}
{
  ok(
    "B4A-73 finance resolves the canonical acting tenant (no sole-membership tenant, no resolveAdminAccess pairing); platform entry excluded",
    !/resolveSoleMembershipTenant|resolveAdminAccess/.test(SRC.finance) &&
      /view\.accessContext !== "membership"/.test(SRC.finance) &&
      /if \(!access\.isOwner\) throw new Error\("Forbidden"\)/.test(SRC.finance),
  );
}
{
  const changed = git("diff", "--name-only", BASELINE_SHA).split("\n").filter(Boolean);
  const untracked = git("ls-files", "--others", "--exclude-standard")
    .split("\n")
    .filter(Boolean)
    .filter((f) => !f.startsWith("brand/") && !f.startsWith("docs/legal/"));
  const all = [...new Set([...changed, ...untracked])];
  const outside = all.filter((f) => !AUTHORISED.includes(f));
  const historic = all.filter((f) => f.startsWith("scripts/") && f !== SELF_REL);
  ok(
    "B4A-74 only authorised files changed; no historic verifier, Test Accounts, B3/B2b migration or ledger code edited",
    outside.length === 0 && historic.length === 0,
    JSON.stringify({ outside, historic }),
  );
}
{
  ok(
    "B4A-75 migration: SECURITY INVOKER only, explicit empty search_path, no SECURITY DEFINER, no finance_ledger / network statement DDL",
    !/SECURITY DEFINER/i.test(b4aSql) &&
      (b4aSql.match(/SET search_path = ''/g) ?? []).length === 3 &&
      !/ALTER TABLE public\.(finance_ledger|network_commission_statements|network_commission_lines|referral_codes)/.test(
        b4aSql,
      ) &&
      !/(UPDATE|DELETE FROM) public\.(finance_ledger|network_commission_statements|referrals|customer_introducer_links)/.test(
        b4aSql,
      ),
  );
}

// =============================================================================================
// NEGATIVE CONTROLS — each re-introduces one real defect, shows its unsafe effect, and shows the
// corresponding test predicate rejecting it.
// =============================================================================================
const ncResults = [];
function nc(label, { effect, caught, detail = "" }) {
  const pass = Boolean(effect) && Boolean(caught);
  ncResults.push({ label, pass });
  if (pass) console.log(`PASS  ${label}`);
  else
    console.error(`FAIL  ${label} (effect=${Boolean(effect)} caught=${Boolean(caught)}) ${detail}`);
}
/** Run `fn` with the fake PostgREST serving a fresh database migrated with `text`. */
async function onFreshDb(text, fn) {
  const db = await preB4aDb();
  const m = await applyMigration(db, text);
  if (!m.ok) return { migrationFailed: m.message };
  const saved = pg;
  await chain;
  pg = db;
  try {
    return await fn(db);
  } finally {
    await chain;
    pg = saved;
  }
}
async function ncSafe(label, fn) {
  try {
    await fn();
  } catch (e) {
    nc(label, { effect: false, caught: false, detail: e instanceof Error ? e.message : String(e) });
  }
}
const SQL_MUT = {
  resolverTenant: [
    "  WHERE v.tenant_id = p_tenant_id AND v.subject_kind = p_subject_kind\n    AND",
    "  WHERE v.subject_kind = p_subject_kind\n    AND",
  ],
  resolverAsOf: [
    "    AND v.fee_type = p_fee_type AND v.effective_from <= p_event_at;",
    "    AND v.fee_type = p_fee_type;",
  ],
  rpcOwner: [
    "    RAISE EXCEPTION 'commission_rate_forbidden' USING ERRCODE = 'insufficient_privilege';",
    "    NULL;",
  ],
  backdate: ["  IF v_backdated AND NOT p_backdate_confirmed THEN", "  IF false THEN"],
  precision: ["OR v_pct > 100 OR v_pct <> round(v_pct, 3) THEN", "OR v_pct > 100 THEN"],
  tie: [
    "  IF v_n <> 1 THEN\n    RAISE EXCEPTION 'commission_rate_ambiguous'",
    "  IF false THEN\n    RAISE EXCEPTION 'commission_rate_ambiguous'",
  ],
};
const tailSql = (extra) => `${b4aSql}\n${extra}\n`;

await ncSafe("NC01 resolver without its tenant predicate → B4A-28b", async () => {
  const text = mutate(b4aSql, [SQL_MUT.resolverTenant]);
  const db = await preB4aDb();
  const m = text ? await applyMigration(db, text) : { ok: false, message: "anchor" };
  const r = m.ok ? await check28b(db) : null;
  nc(
    "NC01 resolver without its tenant predicate: a user's T002 adviser rate resolves in T001 → B4A-28b rejects",
    {
      effect: r && r.r.a === 25,
      caught: r && !r.pass,
      detail: m.ok ? JSON.stringify(r?.r) : m.message,
    },
  );
});
await ncSafe("NC02 resolver ignores event time → B4A-26/27", async () => {
  const text = mutate(b4aSql, [SQL_MUT.resolverAsOf]);
  const db = await preB4aDb();
  const m = text ? await applyMigration(db, text) : { ok: false, message: "anchor" };
  const r26 = m.ok ? await check26(db) : null;
  const r27 = m.ok ? await check27(db) : null;
  nc(
    "NC02 resolver ignores the event time: an event before a version gets the latest rate → B4A-26/27 reject",
    {
      effect: r26 && r26.r.mid === 8 && r27.r === 8,
      caught: r26 && !r26.pass && !r27.pass,
      detail: m.ok ? JSON.stringify({ r26: r26?.r, r27: r27?.r }) : m.message,
    },
  );
});
await ncSafe("NC03 RPC owner check removed → B4A-39", async () => {
  const text = mutate(b4aSql, [SQL_MUT.rpcOwner]);
  const db = await preB4aDb();
  const m = text ? await applyMigration(db, text) : { ok: false, message: "anchor" };
  const r = m.ok ? await check39(db) : null;
  const written = m.ok
    ? await countOf(db, "public.commission_rate_versions", "created_by = $1", [U.supA])
    : 0;
  nc(
    "NC03 RPC without its Owner check: a Supervisor actor appends a rate version → B4A-39 rejects",
    {
      effect: written > 0,
      caught: r && !r.pass,
      detail: m.ok ? `written=${written}` : m.message,
    },
  );
});
await ncSafe("NC04 Owner gate relaxed to amend permission → B4A-34", async () => {
  const text = mutate(b4aSql, [SQL_MUT.rpcOwner]);
  const fin = await mutantOf("finance", [
    [
      '    if (!access.isOwner) throw new Error("Forbidden");',
      '    if (!canAmend(access, data.role === "advisor" ? "finance_advisor_pct" : "finance_introducer_pct")) throw new Error("Forbidden");',
    ],
  ]);
  const out =
    text && fin
      ? await onFreshDb(text, async (db) => {
          const r = await check34(fin);
          const written = await countOf(db, "public.commission_rate_versions", "created_by = $1", [
            U.supA,
          ]);
          return { r, written };
        })
      : { migrationFailed: "anchor" };
  nc(
    "NC04 rate mutation gated by amend permission (app and RPC): a Supervisor changes a rate → B4A-34 rejects",
    {
      effect: out.written > 0,
      caught: out.r && !out.r.pass,
      detail: out.migrationFailed ?? `written=${out.written}`,
    },
  );
});
await ncSafe("NC05 direct client write restored → B4A-17", async () => {
  const text = tailSql(
    "ALTER TABLE public.commission_rate_versions DISABLE ROW LEVEL SECURITY;\nGRANT ALL ON public.commission_rate_versions TO anon, authenticated;",
  );
  const db = await preB4aDb();
  const m = await applyMigration(db, text);
  const direct = m.ok
    ? await asRole(db, "authenticated", probeVersion(T.a, U.advA, "2027-01-01"), [], U.ownerA)
    : null;
  const r = m.ok ? await check17(db) : null;
  nc(
    "NC05 legacy-style client grants on versions: an authenticated user inserts a rate directly → B4A-17 rejects",
    {
      effect: direct?.ok === true,
      caught: r && !r.pass,
      detail: m.ok ? describe(direct) : m.message,
    },
  );
});
await ncSafe("NC06 append-only trigger removed → B4A-20", async () => {
  const text = mutate(b4aSql, [
    [
      "CREATE TRIGGER commission_rate_versions_append_only\n  BEFORE INSERT OR UPDATE OR DELETE ON public.commission_rate_versions\n  FOR EACH ROW EXECUTE FUNCTION public.commission_rate_versions_guard();\n",
      "",
    ],
    [
      "'commission_rate_versions_no_truncate')) <> 2 THEN",
      "'commission_rate_versions_no_truncate')) <> 1 THEN",
    ],
  ]);
  const db = await preB4aDb();
  const m = text ? await applyMigration(db, text) : { ok: false, message: "anchor" };
  const upd = m.ok
    ? await outcome(() => sqlOn(db, "update public.commission_rate_versions set percentage = 99"))
    : null;
  const changed = m.ok
    ? await countOf(db, "public.commission_rate_versions", "percentage = 99")
    : 0;
  const db2 = await preB4aDb();
  const m2 = text ? await applyMigration(db2, text) : { ok: false };
  const r = m2.ok ? await check20(db2) : null;
  nc("NC06 no append-only guard: an existing rate version is rewritten in place → B4A-20 rejects", {
    effect: upd?.ok && changed > 0,
    caught: r && !r.pass,
    detail: m.ok ? `changed=${changed}` : m.message,
  });
});
await ncSafe("NC07 audit failure swallowed → B4A-40", async () => {
  const text = mutate(b4aSql, [
    [
      "    INSERT INTO public.finance_audit_log (\n",
      "    BEGIN\n    INSERT INTO public.finance_audit_log (\n",
    ],
    [
      "      p_actor_user_id, p_tenant_id\n    );\n",
      "      p_actor_user_id, p_tenant_id\n    );\n    EXCEPTION WHEN others THEN NULL;\n    END;\n",
    ],
  ]);
  const r = text ? await check40(text) : null;
  nc(
    "NC07 audit insert failure swallowed: a version is written with no audit row → B4A-40 rejects",
    {
      effect: r && r.versionsWritten > 0,
      caught: r && !r.pass,
      detail: r ? JSON.stringify({ v: r.versionsWritten }) : "anchor",
    },
  );
});
await ncSafe("NC08 ensure revives a disabled registration → B4A-49", async () => {
  const bm = await mutantOf("booking", [
    [
      "    if (existing.active !== true || existing.deleted_at) return null;\n",
      '    if (existing.active !== true || existing.deleted_at) {\n      await supabaseAdmin.from("introducers").update({ active: true, deleted_at: null }).eq("id", existing.id).eq("tenant_id", tenantId);\n    }\n',
    ],
  ]);
  const out = bm ? await onFreshDb(b4aSql, () => check49(bm)) : { migrationFailed: "anchor" };
  nc("NC08 staff booking link revives a disabled introducer registration → B4A-49 rejects", {
    effect: out.reactivated === true,
    caught: out.pass === false,
    detail: out.migrationFailed ?? describe(out.r),
  });
});
await ncSafe("NC09 10% seed restored → B4A-48", async () => {
  const bm = await mutantOf("booking", [
    [
      "  if (error) throw new Error(error.message);\n  return inserted.id as string;\n}",
      `  if (error) throw new Error(error.message);
  const { data: owners } = await supabaseAdmin.from("tenant_memberships").select("user_id").eq("tenant_id", tenantId).eq("role", "owner").limit(1);
  await supabaseAdmin.rpc("set_commission_rate_versions", { p_tenant_id: tenantId, p_actor_user_id: owners[0].user_id, p_subject_kind: "introducer", p_introducer_id: inserted.id, p_adviser_user_id: null, p_rates: { fee: 10, mortgage_fee: 10 }, p_effective_now: true, p_effective_from: null, p_backdate_confirmed: false, p_reason: null });
  return inserted.id as string;
}`,
    ],
  ]);
  const out = bm ? await onFreshDb(b4aSql, () => check48(bm)) : { migrationFailed: "anchor" };
  nc("NC09 staff introducer registration seeded with a 10% rate → B4A-48 rejects", {
    effect: out.rate === 10,
    caught: out.pass === false,
    detail: out.migrationFailed ?? `rate=${out.rate}`,
  });
});
const RAF_LOOP_PAYOUTS = `    const { data: eligibleRefs } = await supabaseAdmin
      .from("referrals")
      .select("id")
      .eq("bonus_status", "eligible")
      .eq("tenant_id", tenantId)
      .limit(100);
    for (const r of eligibleRefs ?? []) {
      await ensureRafCommissionLedgerEntry(r.id, context.userId);
    }

    let sessionFilterIds: string[] | null = null;`;
await ncSafe("NC10 write-on-read in listCommissionPayouts → B4A-56", async () => {
  const fin = await mutantOf("finance", [
    ["    let sessionFilterIds: string[] | null = null;", RAF_LOOP_PAYOUTS],
  ]);
  const out = fin ? await onFreshDb(b4aSql, () => check56(fin)) : { migrationFailed: "anchor" };
  nc("NC10 listCommissionPayouts posts RAF rows on read → B4A-56 rejects", {
    effect: out.rafRows > 0,
    caught: out.pass === false,
    detail: out.migrationFailed ?? JSON.stringify(out.writes),
  });
});
await ncSafe("NC11 write-on-read in listMyCommissionStatement → B4A-57", async () => {
  const fin = await mutantOf("finance", [
    [
      '    let query = supabaseAdmin\n      .from("finance_ledger")\n      .select(\n        "id, session_id, fee_type, amount_pence, commission_pct, beneficiary_user_id, beneficiary_role, referral_id, payout_status, payout_note, payout_at, lost_reason, created_at, note",\n      )\n      .eq("kind", "commission")\n      .eq("beneficiary_user_id", beneficiaryUserId)',
      `    const { data: eligibleRefs } = await supabaseAdmin
      .from("referrals")
      .select("id")
      .eq("referrer_user_id", beneficiaryUserId)
      .eq("bonus_status", "eligible")
      .eq("tenant_id", tenantId)
      .limit(100);
    for (const r of eligibleRefs ?? []) {
      await ensureRafCommissionLedgerEntry(r.id, beneficiaryUserId);
    }

    let query = supabaseAdmin
      .from("finance_ledger")
      .select(
        "id, session_id, fee_type, amount_pence, commission_pct, beneficiary_user_id, beneficiary_role, referral_id, payout_status, payout_note, payout_at, lost_reason, created_at, note",
      )
      .eq("kind", "commission")
      .eq("beneficiary_user_id", beneficiaryUserId)`,
    ],
  ]);
  const out = fin ? await onFreshDb(b4aSql, () => check57(fin)) : { migrationFailed: "anchor" };
  nc("NC11 listMyCommissionStatement posts RAF rows on read → B4A-57 rejects", {
    effect: out.rafRows > 0,
    caught: out.pass === false,
    detail: out.migrationFailed ?? JSON.stringify(out.writes),
  });
});
await ncSafe("NC12 £75 fallback restored → B4A-55", async () => {
  const fin = await mutantOf("finance", [
    [
      '  return typeof value === "number" ? value : null;',
      '  return typeof value === "number" ? value : 7500;',
    ],
  ]);
  const refm = await mutantOf("referrals", [
    [
      '    const { ensureRafCommissionLedgerEntry } = await import("@/lib/finance.functions");',
      "    const { ensureRafCommissionLedgerEntry } = globalThis.__B4A_FIN;",
    ],
    [
      '      const { getRafBonusPence, RAF_BONUS_NOT_CONFIGURED_MESSAGE } =\n        await import("@/lib/finance.functions");',
      "      const { getRafBonusPence, RAF_BONUS_NOT_CONFIGURED_MESSAGE } = globalThis.__B4A_FIN;",
    ],
  ]);
  globalThis.__B4A_FIN = fin;
  const out =
    fin && refm ? await onFreshDb(b4aSql, () => check55(refm)) : { migrationFailed: "anchor" };
  globalThis.__B4A_FIN = null;
  nc("NC12 RAF amount falls back to £75 when unconfigured: T002 gets a 7500 row → B4A-55 rejects", {
    effect: out.rows?.length === 1 && out.rows[0].amount_pence === 7500,
    caught: out.pass === false,
    detail: out.migrationFailed ?? describe(out.r),
  });
});
await ncSafe("NC13 enrichment without tenant filter → B4A-60", async () => {
  const fin = await mutantOf("finance", [
    [
      '      .in("user_id", [...userIds])\n      .eq("tenant_id", tenantId);\n    for (const a of adv',
      '      .in("user_id", [...userIds]);\n    for (const a of adv',
    ],
    [
      '      .in("user_id", [...userIds])\n      .eq("tenant_id", tenantId);\n    for (const i of intros',
      '      .in("user_id", [...userIds]);\n    for (const i of intros',
    ],
  ]);
  const r = fin ? await check60(fin) : null;
  nc("NC13 ledger enrichment ignores the tenant: T001 rows show T002 codes → B4A-60 rejects", {
    effect: r && (r.adv?.receiverRef === "DUALB" || r.intro?.receiverRef === "2001"),
    caught: r && !r.pass,
    detail: r ? `adv=${r.adv?.receiverRef} intro=${r.intro?.receiverRef}` : "anchor",
  });
});
await ncSafe("NC14 rate subject lookup ignores the tenant → B4A-30b", async () => {
  const r = await withRatesMutant(
    [
      [
        '    .select("id, user_id, active, deleted_at")\n    .eq("tenant_id", tenantId)\n',
        '    .select("id, user_id, active, deleted_at")\n',
      ],
    ],
    () => check30b(ff),
  );
  nc(
    "NC14 introducer subject resolved without the tenant: a T001 Owner sees the T002 registration's rate → B4A-30b rejects",
    {
      effect: r.inA.ok && (r.inA.value.subjectAvailable === true || r.inA.value.pctFee !== null),
      caught: !r.pass,
      detail: describe(r.inA) + (r.inA.ok ? JSON.stringify(r.inA.value) : ""),
    },
  );
});
await ncSafe("NC15 migration stamps now() as effective date → B4A-02", async () => {
  const text = mutate(b4aSql, [
    [
      "      v_h.created_at, v_h.created_at, v_h.changed_by, 'legacy_migration', v_h.id",
      "      now(), v_h.created_at, v_h.changed_by, 'legacy_migration', v_h.id",
    ],
    ["     OR v.effective_from IS DISTINCT FROM b.created_at\n", ""],
  ]);
  const db = await preB4aDb();
  const m = text ? await applyMigration(db, text) : { ok: false, message: "anchor" };
  const v = m.ok ? await versionsOf(db, "legacy_history_id = $1", [R.hist_advA]) : [];
  const r = m.ok ? await check02(db) : null;
  nc("NC15 legacy versions take migration time as their effective date → B4A-02 rejects", {
    effect:
      v.length === 1 && new Date(v[0].effective_from).getTime() !== new Date(LEGACY_AT).getTime(),
    caught: r && !r.pass,
    detail: m.ok ? JSON.stringify(v[0]?.effective_from) : m.message,
  });
});
await ncSafe("NC16 legacy introducer rate migrated as an adviser rate → B4A-08", async () => {
  const text = mutate(b4aSql, [
    [
      "  IF EXISTS (SELECT 1 FROM public.commission_rates r WHERE r.role <> 'advisor')\n     OR EXISTS (SELECT 1 FROM public.commission_rate_history h WHERE h.role <> 'advisor') THEN\n    RAISE EXCEPTION 'g7f4s4c4b4a_precondition:legacy_introducer_rate_requires_decision';\n  END IF;\n",
      "",
    ],
    ["    RAISE EXCEPTION 'g7f4s4c4b4a_postcondition:current_rate_mismatch';", "    NULL;"],
  ]);
  const db = await preB4aDb();
  if (text) await legacyIntroducerSeed(db);
  const m = text ? await applyMigration(db, text) : { ok: false, message: "anchor" };
  const mort = m.ok
    ? await pctAt(db, {
        tenant: T.a,
        kind: "adviser",
        adviser: U.advA,
        fee: "mortgage_fee",
        at: new Date().toISOString(),
      })
    : null;
  const r = text ? await check08(text) : null;
  nc(
    "NC16 introducer precondition dropped: the old 10% introducer seed becomes an adviser mortgage rate → B4A-08 rejects",
    {
      effect: m.ok && mort === 10,
      caught: r && !r.pass,
      detail: m.ok ? `mortgage=${mort}` : m.message,
    },
  );
});
await ncSafe("NC17 backdate confirmation removed → B4A-43", async () => {
  const text = mutate(b4aSql, [SQL_MUT.backdate]);
  const db = await preB4aDb();
  const m = text ? await applyMigration(db, text) : { ok: false, message: "anchor" };
  const direct = m.ok
    ? await setRpc(db, "service_role", {
        tenant: T.a,
        actor: U.ownerA,
        kind: "introducer",
        introducer: I.introA,
        rates: { fee: 3 },
        from: "2025-01-01T00:00:00Z",
        confirm: false,
        reason: "Agreed",
      })
    : null;
  const db2 = await preB4aDb();
  const m2 = text ? await applyMigration(db2, text) : { ok: false };
  const r = m2.ok ? await check43(db2) : null;
  nc("NC17 backdating without confirmation is accepted → B4A-43 rejects", {
    effect: direct?.ok === true,
    caught: r && !r.pass,
    detail: m.ok ? describe(direct) : m.message,
  });
});
await ncSafe("NC18 precision check removed → B4A-45", async () => {
  const text = mutate(b4aSql, [SQL_MUT.precision]);
  const db = await preB4aDb();
  const m = text ? await applyMigration(db, text) : { ok: false, message: "anchor" };
  const direct = m.ok
    ? await setRpc(db, "service_role", {
        tenant: T.a,
        actor: U.ownerA,
        kind: "adviser",
        adviser: U.advA,
        rates: { insurance_fee: 1.2345 },
        now: true,
      })
    : null;
  const db2 = await preB4aDb();
  const m2 = text ? await applyMigration(db2, text) : { ok: false };
  const r = m2.ok ? await check45(db2) : null;
  nc("NC18 a four-decimal percentage is silently rounded and stored → B4A-45 rejects", {
    effect: direct?.ok === true,
    caught: r && !r.pass,
    detail: m.ok ? describe(direct) : m.message,
  });
});
await ncSafe("NC19 tie check removed → B4A-29", async () => {
  const text = mutate(b4aSql, [SQL_MUT.tie]);
  const r = text ? await check29(text) : null;
  nc("NC19 two versions at one instant resolve to arbitrary rows → B4A-29 rejects", {
    effect: r && r.r.ok && r.r.rows.length >= 1,
    caught: r && !r.pass,
    detail: r ? describe(r.r) : "anchor",
  });
});
await ncSafe("NC20 finance tenant = first membership → B4A-62", async () => {
  const fin = await mutantOf("finance", [
    [
      "  const view = await resolveActingTenantRole(userId);\n  if (!view.tenantId",
      `  const { supabaseAdminUntyped: fdb } = await import("@/integrations/supabase/client.server");
  const { data: firstRows } = await fdb.from("tenant_memberships").select("tenant_id").eq("user_id", userId).eq("active", true).order("created_at").limit(1);
  const first = firstRows?.[0]?.tenant_id;
  const { loadTenantRoleForTenantId } = await import("@/lib/tenant-role.server");
  const view = first ? await loadTenantRoleForTenantId(userId, first) : await resolveActingTenantRole(userId);
  if (!view.tenantId`,
    ],
  ]);
  const out = fin ? await onFreshDb(b4aSql, () => check62(fin)) : { migrationFailed: "anchor" };
  nc(
    "NC20 finance falls back to the first membership: a dual-tenant Owner with no route tenant writes a rate → B4A-62 rejects",
    {
      effect: out.written > 0,
      caught: out.pass === false,
      detail: out.migrationFailed ?? describe(out.noSlugOwner, out.noSlugSet),
    },
  );
});
await ncSafe("NC21 RAF auto-posting restored on qualification → B4A-68", async () => {
  const refm = await mutantOf("referrals", [
    [
      "    const { error } = await supabaseAdmin",
      "    const { data: updated, error } = await supabaseAdmin",
    ],
    [
      '      .in("status", ["pending", "signed_up"]);',
      '      .in("status", ["pending", "signed_up"])\n      .select("id");',
    ],
    [
      "    // B2b TEMPORARY FINANCIAL GUARD",
      '    const { ensureRafCommissionLedgerEntry } = await import("@/lib/finance.functions");\n    for (const row of updated ?? []) await ensureRafCommissionLedgerEntry(row.id);\n    // B2b TEMPORARY FINANCIAL GUARD',
    ],
  ]);
  const out = refm ? await onFreshDb(b4aSql, () => check68(refm)) : { migrationFailed: "anchor" };
  nc(
    "NC21 qualification auto-posts the RAF bonus in a tenant with a configured amount (the B2b NC03 defect) → B4A-68 rejects",
    {
      effect: out.rafRows === 1,
      caught: out.pass === false,
      detail: out.migrationFailed ?? JSON.stringify(out.ref),
    },
  );
});

// =============================================================================================
// SUMMARY
// =============================================================================================
const failedTests = failures;
const failedNcs = ncResults.filter((r) => !r.pass);
console.log("");
console.log(`TEST_CASES=${total}`);
console.log(`TESTS_PASS=${total - failedTests.length}`);
console.log(`NEGATIVE_CONTROL_COUNT=${ncResults.length}`);
console.log(`NEGATIVE_CONTROLS_PASS=${ncResults.length - failedNcs.length}`);
const allPass = failedTests.length === 0 && failedNcs.length === 0;
console.log(`RESULT=${allPass ? "PASS" : "FAIL"}`);
process.exit(allPass ? 0 : 1);
