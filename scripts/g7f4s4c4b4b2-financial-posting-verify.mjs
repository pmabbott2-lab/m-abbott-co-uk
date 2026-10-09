/**
 * G7F-4S4C4-B4b2 atomic financial posting / ledger / adjustments / clawbacks — offline verification.
 *
 * Posting is one atomic, idempotent, authorised RPC per session at each fee's economic date
 * (fee_event_at), with adviser entitlement from the B4b1 history resolver, introducer attribution
 * from the DB resolver (parity with resolveIntroducerIdForCustomerAtDate) and rates from the B4a
 * resolver, all as of fee_event_at. finance_ledger is the canonical append-only typed ledger;
 * reversal, correction, reassignment, clawback, settlement and exception resolution are Owner-only;
 * payout status is Owner/Supervisor with immutable transition history; paid is terminal.
 *
 * The real B3, B4a, B4b1 and B4b2 migrations (B4b2 followed by its F1 payout lock-order
 * migration, as deployed) are applied verbatim to an in-process PostgreSQL
 * (PGlite, WASM) holding the staging shapes (column order, enums, keys, grants, policies), seeded
 * with the staging pattern. The real server functions (finance, network statements, referrals,
 * sessions) run against it through a fake PostgREST layer on a non-routable host; service-role
 * requests execute as the `service_role` database role and client requests as `authenticated`,
 * so grants, RLS and triggers are enforced.
 *
 * Every negative control mutates real source or the real migration, demonstrates the unsafe
 * effect on the database, and shows the corresponding test predicate rejects the mutant.
 *
 * PGlite is one connection: concurrent posting is exercised as interleaved requests plus forced
 * duplicate inserts past the operation's own checks (row locks and the unique indexes are what
 * make real parallel calls safe).
 *
 * Synthetic fixtures only: no network, no staging, no production, no real user, no real token.
 * Stubbed (not under test): MFA freshness, Super Owner gate, platform Enter Company sessions,
 * SMS delivery, the AI statement extraction (returns fixed lines), welcome-call task creation.
 *
 * PGlite: npm install --prefix /tmp/g7f4s3b/pglite @electric-sql/pglite@0.5.8
 * Run: npm exec --yes --package=tsx -- tsx scripts/g7f4s4c4b4b2-financial-posting-verify.mjs
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

const B4B2_REL =
  "supabase/migrations/20261008120000_gate_g7f4s4c4b4b2_atomic_posting_ledger_adjustments.sql";
const B4B1_REL =
  "supabase/migrations/20261007200000_gate_g7f4s4c4b4b1_statement_economic_date_adviser_history.sql";
const B4A_REL = "supabase/migrations/20261007160000_gate_g7f4s4c4b4a_commission_rate_versions.sql";
const B3_REL =
  "supabase/migrations/20261007120000_gate_g7f4s4c4b3_customer_introducer_attribution_tenant_key.sql";
const G6B_REL = "supabase/migrations/20260918200000_gate_g6b_enable_rls_six_unprotected_tables.sql";
const FINANCE_REL = "src/lib/finance.functions.ts";
const NETWORK_REL = "src/lib/network-commission.functions.ts";
const PANEL_REL = "src/components/staff/panels/finance/NetworkStatementsPanel.tsx";
const BOOKING_REL = "src/lib/booking.functions.ts";
const SESSIONS_REL = "src/lib/sessions.functions.ts";
const RATES_REL = "src/lib/commission-rates.server.ts";
const REFERRALS_REL = "src/lib/referrals.functions.ts";
const ATTRIBUTION_REL = "src/lib/introducer-attribution.ts";
const ADMIN_ACCESS_REL = "src/lib/admin-access.ts";
const SESSION_ROUTE_REL = "src/routes/_authenticated/sessions.$sessionId.tsx";
const SELF_REL = "scripts/g7f4s4c4b4b2-financial-posting-verify.mjs";
const F1_REL = "supabase/migrations/20261008190000_gate_g7f4s4c4b4b2f1_payout_case_lock_order.sql";
const F1_VERIFIER_REL = "scripts/g7f4s4c4b4b2f1-concurrency-verify.mjs";
const BASELINE_SHA = "bc5e29e767be96f157d5faf737f48a7f88be0359";
const AUTHORISED = [
  B4B2_REL,
  F1_REL,
  SELF_REL,
  F1_VERIFIER_REL,
  FINANCE_REL,
  REFERRALS_REL,
  SESSIONS_REL,
  ADMIN_ACCESS_REL,
  SESSION_ROUTE_REL,
  "src/lib/commission-summary.ts",
  "src/components/PayoutStatusBadge.tsx",
  "src/components/CommissionPayoutsPanel.tsx",
  "src/components/staff/panels/staff-panels.tsx",
];

const b4b2Sql = read(B4B2_REL);
/** What staging runs: B4b2, then the F1 forward-only replacement of set_commission_payout_status. */
const appliedSql = `${b4b2Sql}\n${read(F1_REL)}`;
const b4b1Sql = read(B4B1_REL);
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
export function getRequest() { return globalThis.__B4B2_REQUEST ?? null; }
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
  (globalThis.__B4B2_SMS ??= []).push({ to: opts.to });
  return { sid: "SMxB4B2" + String(globalThis.__B4B2_SMS.length) };
}
`;
const stubMfa = `
export * from ${JSON.stringify(fileUrl("src/lib/privileged-mfa.server.ts"))};
export async function requireFreshPrivilegedAuth() {}
export async function requirePlatformAal2() {}
`;
const stubOpenAi = `
export async function chatCompletion() {
  return JSON.stringify({ lines: globalThis.__B4B2_AI_LINES ?? [] });
}
`;
const stubTasks = `
export async function ensureWelcomeCallTask() { return null; }
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
const pick = (k) => (...a) => ((globalThis.__B4B2_RATES && globalThis.__B4B2_RATES[k]) || real[k])(...a);
${RATES_FNS.map((k) => `export const ${k} = pick(${JSON.stringify(k)});`).join("\n")}
export const COMMISSION_FEE_TYPES = real.COMMISSION_FEE_TYPES;
export const INTRODUCER_FEE_TYPES = real.INTRODUCER_FEE_TYPES;
export const RATE_ERROR_MESSAGES = real.RATE_ERROR_MESSAGES;
`;
const MUTANT_KEYS = {
  finance: fileUrl(FINANCE_REL),
  network: fileUrl(NETWORK_REL),
  rates: fileUrl(RATES_REL),
  referrals: fileUrl(REFERRALS_REL),
};
const mutantMark = (key) => `/*b4b2-mutant:${key}*/`;
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
  openai: ${JSON.stringify(dataUrl(stubOpenAi))},
  tasks: ${JSON.stringify(dataUrl(stubTasks))},
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
  if (/(^|\\/)openai\\.server(\\.ts)?$/.test(specifier)) return { url: STUBS.openai, shortCircuit: true };
  if (/(^|\\/)staff-contact-tasks\\.server(\\.ts)?$/.test(specifier)) return { url: STUBS.tasks, shortCircuit: true };
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
create type public.finance_fee_type as enum ('fee','mortgage_fee','insurance_fee','other_fee');
create type public.finance_line_status as enum ('draft','posted','amended','deleted');
create type public.finance_ledger_kind as enum ('post','amend','delete','commission');

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
-- Booking side tables (staging columns), touched best-effort by the staff booking path.
create table public.advisor_diary_settings (
  advisor_id uuid primary key, slot_minutes integer not null default 90,
  buffer_minutes integer not null default 0, min_notice_minutes integer not null default 60,
  max_horizon_days integer not null default 28, updated_at timestamptz not null default now(),
  updated_by uuid, tenant_id uuid
);
create table public.advisor_availability (
  id uuid primary key default gen_random_uuid(), advisor_id uuid not null,
  day_of_week integer not null, start_time time not null, end_time time not null,
  slot_minutes integer not null default 90, active boolean not null default true, tenant_id uuid
);
create table public.advisor_contact_views (
  id uuid primary key default gen_random_uuid(), advisor_id uuid not null, contact_type text not null,
  contact_id uuid not null, opened_at timestamptz not null default now(), tenant_id uuid,
  unique (advisor_id, contact_type, contact_id)
);
create table public.callback_requests (
  id uuid primary key default gen_random_uuid(), session_id uuid, customer_id uuid, advisor_id uuid,
  customer_name text not null, customer_phone text not null, customer_email text,
  preferred_window text not null, status text not null default 'new', notes text,
  created_at timestamptz not null default now(), tenant_id uuid
);
create table public.communication_settings (
  id integer primary key default 1, email_regulatory_footer text not null default '',
  sms_regulatory_footer text not null default '', updated_at timestamptz not null default now(),
  updated_by uuid, tenant_id uuid
);
create table public.communication_templates (
  id uuid primary key default gen_random_uuid(), template_key text not null, name text not null,
  description text not null default '', channel text not null, subject text, body text not null,
  active boolean not null default true, required_tokens text[] not null default '{}',
  sort_order integer not null default 100, updated_at timestamptz not null default now(),
  updated_by uuid, created_at timestamptz not null default now(), tenant_id uuid
);
create table public.session_contact_tracking (
  session_id uuid primary key, last_contacted_at timestamptz, next_contact_at timestamptz,
  updated_by uuid, updated_at timestamptz not null default now(),
  session_attention_cleared_at timestamptz, tenant_id uuid
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
  submitted_at timestamptz, deleted_at timestamptz, current_section text, current_question_index int,
  created_at timestamptz not null default now()
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
  id uuid primary key default gen_random_uuid(), session_id uuid, fee_line_id uuid,
  kind public.finance_ledger_kind not null,
  fee_type text, amount_pence integer not null, is_reversal boolean not null default false, note text,
  beneficiary_user_id uuid, beneficiary_role text, commission_pct numeric(6,3), created_by uuid,
  created_at timestamptz not null default now(), payout_status text default 'pending',
  payout_at timestamptz, payout_by uuid, payout_note text, referral_id uuid, lost_reason text,
  tenant_id uuid
);
-- staging shapes (column order, types, nullability, keys) of the B4b1 tables
create table public.finance_fee_lines (
  id uuid not null default gen_random_uuid(),
  session_id uuid not null,
  fee_type public.finance_fee_type not null default 'fee',
  amount_pence integer not null,
  note text,
  status public.finance_line_status not null default 'draft',
  batch_id uuid,
  created_by uuid,
  posted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  tenant_id uuid,
  constraint finance_fee_lines_pkey primary key (id),
  constraint finance_fee_lines_session_id_fkey foreign key (session_id)
    references public.interview_sessions(id) on delete cascade,
  constraint finance_fee_lines_created_by_fkey foreign key (created_by)
    references auth.users(id) on delete set null,
  constraint finance_fee_lines_tenant_id_fkey foreign key (tenant_id) references public.tenants(id)
);
create table public.network_commission_statements (
  id uuid not null default gen_random_uuid(),
  period_month date not null,
  status text not null default 'draft',
  notes text,
  raw_source text,
  validated_by uuid,
  validated_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  tenant_id uuid,
  constraint network_commission_statements_pkey primary key (id),
  constraint network_commission_statements_period_month_key unique (period_month),
  constraint network_commission_statements_status_check
    check (status = any (array['draft'::text, 'annotated'::text, 'validated'::text, 'locked'::text])),
  constraint network_commission_statements_tenant_id_fkey foreign key (tenant_id)
    references public.tenants(id)
);
create table public.network_commission_lines (
  id uuid not null default gen_random_uuid(),
  statement_id uuid not null,
  line_no integer not null,
  customer_name text,
  customer_email text,
  case_ref text,
  fee_type text not null default 'fee',
  amount_received_pence integer not null,
  network_product text,
  raw_json jsonb,
  allocation_status text not null default 'unmatched',
  matched_customer_id uuid,
  matched_session_id uuid,
  fee_line_id uuid,
  annotation text,
  allocated_by uuid,
  allocated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  tenant_id uuid,
  constraint network_commission_lines_pkey primary key (id),
  constraint network_commission_lines_statement_id_fkey foreign key (statement_id)
    references public.network_commission_statements(id) on delete cascade,
  constraint network_commission_lines_allocation_status_check check (allocation_status = any
    (array['unmatched'::text, 'matched'::text, 'allocated'::text, 'skipped'::text])),
  constraint network_commission_lines_fee_type_check check (fee_type = any
    (array['fee'::text, 'mortgage_fee'::text, 'insurance_fee'::text, 'other_fee'::text])),
  constraint network_commission_lines_matched_customer_id_fkey foreign key (matched_customer_id)
    references auth.users(id) on delete set null,
  constraint network_commission_lines_allocated_by_fkey foreign key (allocated_by)
    references auth.users(id) on delete set null,
  constraint network_commission_lines_tenant_id_fkey foreign key (tenant_id)
    references public.tenants(id)
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
-- staging keys of public.finance_ledger
alter table public.finance_ledger
  add constraint finance_ledger_beneficiary_user_id_fkey foreign key (beneficiary_user_id)
    references auth.users(id) on delete set null,
  add constraint finance_ledger_created_by_fkey foreign key (created_by)
    references auth.users(id) on delete set null,
  add constraint finance_ledger_fee_line_id_fkey foreign key (fee_line_id)
    references public.finance_fee_lines(id) on delete set null,
  add constraint finance_ledger_payout_by_fkey foreign key (payout_by)
    references auth.users(id) on delete set null,
  add constraint finance_ledger_referral_id_fkey foreign key (referral_id)
    references public.referrals(id) on delete set null,
  add constraint finance_ledger_session_id_fkey foreign key (session_id)
    references public.interview_sessions(id) on delete set null,
  add constraint finance_ledger_tenant_id_fkey foreign key (tenant_id) references public.tenants(id);

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

-- staging RLS and policies on the B4b1 tables; client roles hold every table privilege on them
alter table public.finance_fee_lines enable row level security;
alter table public.session_advisors enable row level security;
alter table public.interview_sessions enable row level security;
create policy "Admins read finance fee lines" on public.finance_fee_lines
  for select to authenticated using (public.auth_is_tenant_admin(tenant_id));
create policy "Admins read finance ledger" on public.finance_ledger
  for select to authenticated using (public.auth_is_tenant_admin(tenant_id));
create policy "Admins read network lines" on public.network_commission_lines
  for select to authenticated using (public.auth_is_tenant_admin(tenant_id));
create policy "Admins read network statements" on public.network_commission_statements
  for select to authenticated using (public.auth_is_tenant_admin(tenant_id));
create policy "Advisors view own allocations" on public.session_advisors
  for select to authenticated using ((advisor_id = auth.uid()) or public.auth_is_tenant_staff(tenant_id));
create policy "Customer manages own sessions" on public.interview_sessions
  for all to authenticated
  using ((customer_id = auth.uid()) or public.auth_is_tenant_staff(tenant_id))
  with check ((customer_id = auth.uid()) or public.auth_is_tenant_staff(tenant_id));
grant all on public.finance_fee_lines, public.finance_ledger, public.network_commission_statements,
  public.network_commission_lines, public.session_advisors, public.interview_sessions
  to anon, authenticated;
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
const DAY = 86400000;
/** YYYY-MM-DD in Europe/London, `daysAgo` days before now (negative = future). */
function londonDate(daysAgo = 0) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(Date.now() - daysAgo * DAY));
}
/** Start of a London calendar day as an instant (ISO). */
function londonMidnight(date) {
  for (const offset of [0, 1]) {
    const guess = new Date(`${date}T00:00:00Z`);
    guess.setUTCHours(guess.getUTCHours() - offset);
    const local = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London",
      hour: "2-digit",
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(guess);
    const get = (t) => local.find((p) => p.type === t)?.value;
    if (`${get("year")}-${get("month")}-${get("day")}` === date && get("hour") === "00") {
      return guess.toISOString();
    }
  }
  throw new Error(`londonMidnight(${date})`);
}
/** Tenant-stamped session_advisors rows predate the migration (staging pattern). */
const LEGACY_AT = "2026-09-01T09:00:00.000Z";
const now = Date.now();
let slotCounter = 0;
function nextSlot() {
  slotCounter += 1;
  const t = new Date(now + (20 + slotCounter) * DAY);
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
  });
  return I[key];
}

/**
 * A fresh database at the staging post-B4a state seeded with the staging pattern (pre-B4b1).
 * `mutate(db)` runs after the seed, to build precondition variants.
 */
async function preB4b1Db(mutate = null) {
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
    ["supA", [[T.a, "supervisor"]]],
    ["genA", [[T.a, "general"]]],
    ["genNoPerm", [[T.a, "general"]]],
    ["advA", [[T.a, "adviser"]]],
    ["advA2", [[T.a, "adviser"]]],
    ["advA3", [[T.a, "adviser"]]],
    ["advB", [[T.b, "adviser"]]],
    ["advInactive", [[T.a, "adviser"]]],
    [
      "introDual",
      [
        [T.a, "introducer"],
        [T.b, "introducer"],
      ],
    ],
    ["custA", [[T.a, "customer"]]],
    ["custA2", [[T.a, "customer"]]],
    ["custS4C2", [[T.a, "customer"]]],
    ["custB", [[T.b, "customer"]]],
    ["superOwner", []],
  ];
  for (const [key, memberships] of people) {
    await addUser(db, key, `${key} Person`);
    for (const [tenantId, role] of memberships) await addMember(db, key, tenantId, role);
  }
  await sqlOn(db, `update public.tenant_memberships set active = false where user_id = $1`, [
    U.advInactive,
  ]);
  await insertRow(db, "public.platform_roles", { user_id: U.superOwner, role: "super_owner" });
  for (const key of [
    "finance_network_statements",
    "finance_network_validate",
    "finance_customer",
  ]) {
    await insertRow(db, "public.admin_permissions", {
      user_id: U.genA,
      permission_key: key,
      access: "amend",
      tenant_id: T.a,
    });
  }
  for (const [userKey, code, tenantId] of [
    ["advA", "ADVA", T.a],
    ["advA2", "ADVA2", T.a],
    ["advA3", "ADVA3", T.a],
    ["advB", "ADVB", T.b],
  ]) {
    await insertRow(db, "public.advisor_profiles", {
      user_id: U[userKey],
      code,
      tenant_id: tenantId,
    });
  }
  // A2: one Auth identity, one introducer registration per tenant.
  await addIntroducer(db, "dualA", "introDual", T.a, { code: "1002", name: "Dual Alpha" });
  await addIntroducer(db, "dualB", "introDual", T.b, { code: "2002", name: "Dual Bravo" });

  for (const [id, customer, tenantId, ref, deleted] of [
    [R.sessA1, "custA", T.a, "MG-B4B1-A1", false],
    [R.sessA2, "custA2", T.a, "MG-B4B1-A2", false],
    [R.sessA3, "custA", T.a, "MG-B4B1-A3", false],
    [R.sessADeleted, "custA", T.a, "MG-B4B1-AD", true],
    [R.sessS4C2, "custS4C2", T.a, "MG-S4C2-0001", false],
    [R.sessHist, "custA2", T.a, "MG-B4B1-H1", false],
    [R.sessB1, "custB", T.b, "MG-B4B1-B1", false],
    [R.sessTL1, "custA", null, null, false],
    [R.sessTL2, "custB", null, null, false],
    [R.sessTL3, "custA2", null, null, false],
  ]) {
    await insertRow(db, "public.interview_sessions", {
      id,
      customer_id: U[customer],
      tenant_id: tenantId,
      case_ref: ref,
      created_at: LEGACY_AT,
      deleted_at: deleted ? LEGACY_AT : null,
    });
  }
  // Staging adviser assignments: three tenant-stamped (one held in Owner capacity), three on
  // legacy tenantless sessions.
  for (const [id, session, adviser, tenantId] of [
    [R.saA1, R.sessA1, "advA", T.a],
    [R.saA2, R.sessA2, "ownerA", T.a],
    [R.saB1, R.sessB1, "advB", T.b],
    [R.saTL1, R.sessTL1, "advA", null],
    [R.saTL2, R.sessTL2, "advB", null],
    [R.saTL3, R.sessTL3, "advA2", null],
  ]) {
    await insertRow(db, "public.session_advisors", {
      id,
      session_id: session,
      advisor_id: U[adviser],
      assigned_by: null,
      created_at: LEGACY_AT,
      tenant_id: tenantId,
    });
  }
  // Staging fee lines: two synthetic undated drafts, no network source, no ledger rows.
  await insertRow(db, "public.finance_fee_lines", {
    id: R.draftA,
    session_id: R.sessA1,
    fee_type: "fee",
    amount_pence: 50000,
    status: "draft",
    created_by: U.ownerA,
    tenant_id: T.a,
    created_at: LEGACY_AT,
    updated_at: LEGACY_AT,
  });
  await insertRow(db, "public.finance_fee_lines", {
    id: R.draftB,
    session_id: R.sessB1,
    fee_type: "mortgage_fee",
    amount_pence: 40000,
    status: "draft",
    created_by: U.ownerB,
    tenant_id: T.b,
    created_at: LEGACY_AT,
    updated_at: LEGACY_AT,
  });
  // The tenantless October draft statement: no lines, created by a T001 Owner (never authority).
  await insertRow(db, "public.network_commission_statements", {
    id: R.octTenantless,
    period_month: "2026-10-01",
    status: "draft",
    notes: "synthetic tenantless",
    created_by: U.ownerA,
    tenant_id: null,
    created_at: LEGACY_AT,
    updated_at: LEGACY_AT,
  });
  await insertRow(db, "public.finance_audit_log", {
    audit_type: "commission_rate",
    summary: "staging-synthetic",
    changed_by: U.ownerA,
    created_at: LEGACY_AT,
    tenant_id: T.a,
  });
  await db.exec(b4aSql);
  if (mutate) await mutate(db);
  return db;
}

const applyMigration = (db, text = appliedSql) => outcome(() => execOn(db, text));
/** A fresh database at the staging post-B4b1 state (the B4b2 baseline). */
async function preB4b2Db(mutate = null) {
  const db = await preB4b1Db();
  const m = await applyMigration(db, b4b1Sql);
  if (!m.ok) throw new Error(`B4b1 apply: ${m.message}`);
  if (mutate) await mutate(db);
  return db;
}
const rowsText = (db, table, order = "1") =>
  sqlOn(db, `select t::text as t from ${table} t order by ${order}`).then((r) => r.map((x) => x.t));
const relExists = async (db, rel) =>
  Boolean((await sqlOn(db, `select to_regclass($1) as r`, [rel]))[0]?.r);
const catalogOf = (db, rels) =>
  sqlOn(
    db,
    `select c.relname, coalesce(c.relacl::text, '') as acl, c.relrowsecurity,
       (select coalesce(string_agg(conname || ':' || pg_get_constraintdef(k.oid), '|' order by conname), '')
          from pg_constraint k where k.conrelid = c.oid) as cons,
       (select coalesce(string_agg(policyname || ':' || cmd || ':' || roles::text || ':' || coalesce(qual, '') || ':' || coalesce(with_check, ''), '|' order by policyname), '')
          from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname) as pols,
       (select coalesce(string_agg(tgname, ',' order by tgname), '') from pg_trigger t
          where t.tgrelid = c.oid and not t.tgisinternal) as trg
     from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname = any($1::text[])
     order by 1`,
    [rels],
  );
const fnFingerprint = (db, names) =>
  sqlOn(
    db,
    `select p.oid::regprocedure::text as sig, md5(p.prosrc) as src, coalesce(p.proacl::text, '') as acl,
            p.prosecdef, p.proconfig::text as cfg
     from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = any($1::text[])
     order by 1`,
    [names],
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
/** Superuser fixture writes that bypass the guards (simulates state B4b1 itself cannot create). */
const asFixture = (db, stmt, params = []) =>
  onServed(db, async () => {
    await db.query("begin");
    try {
      await db.query("set local session_replication_role = replica");
      const r = await db.query(stmt, params);
      await db.query("commit");
      return r.rows;
    } catch (e) {
      await db.query("rollback");
      throw e;
    }
  });
const countOf = async (db, rel, where = "true", params = []) =>
  Number((await sqlOn(db, `select count(*)::int as n from ${rel} where ${where}`, params))[0].n);
// --- fake PostgREST + Auth Admin on PGlite -----------------------------------------------------
const FAKE_HOST = "g7f4s4c4b4b2.invalid";
const PUBLISHABLE = "sb_publishable_g7f4s4c4b4b2_not_a_real_key";
process.env.SUPABASE_URL = `http://${FAKE_HOST}`;
process.env.VITE_SUPABASE_URL = `http://${FAKE_HOST}`;
process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_secret_g7f4s4c4b4b2_not_a_real_key";
process.env.SUPABASE_PUBLISHABLE_KEY = PUBLISHABLE;
process.env.VITE_SUPABASE_PUBLISHABLE_KEY = PUBLISHABLE;
const USER_HEADER = "x-g7f4s4c4b4b2-user";

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
const isScalarList = (v) => Array.isArray(v) && v.every((x) => x === null || typeof x !== "object");
/** Scalar lists go to array parameters (uuid[]); PGlite needs the array literal. */
function pgArray(list) {
  return `{${list
    .map((x) => (x === null ? "NULL" : `"${String(x).replace(/["\\]/g, (c) => `\\${c}`)}"`))
    .join(",")}}`;
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
    .map(([k, v]) => `${q(k)} => $${args.push(isScalarList(v) ? pgArray(v) : cellValue(v))}`)
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
    throw new Error(`G7F4S4C4B4B2 fetch stub refused host ${url.hostname}`);
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
      if (process.env.G7F4S4C4B4B2_DEBUG) orig(...a);
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
const nf = await import("../src/lib/network-commission.functions.ts");
const sf = await import("../src/lib/sessions.functions.ts");
const bf = await import("../src/lib/booking.functions.ts");
const rf = await import("../src/lib/referrals.functions.ts");
const ia = await import("../src/lib/introducer-attribution.ts");
const { supabaseAdminUntyped: adminClient } = await import(
  "../src/integrations/supabase/client.server.ts"
);

const SRC = {
  finance: read(FINANCE_REL),
  network: read(NETWORK_REL),
  panel: read(PANEL_REL),
  referrals: read(REFERRALS_REL),
};
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
  globalThis.__B4B2_REQUEST = slug
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

// --- scenario helpers --------------------------------------------------------------------------
function pastDate(month, day) {
  const today = londonDate(0);
  let y = Number(today.slice(0, 4));
  const mmdd = `${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  if (`${y}-${mmdd}` >= today) y -= 1;
  return `${y}-${mmdd}`;
}
const winterDate = pastDate(1, 15);
const summerDate = pastDate(7, 15);
const aiLine = (o) => ({
  customerName: o.name ?? null,
  customerEmail: o.email ?? null,
  caseRef: o.ref ?? null,
  feeType: o.type ?? "fee",
  amountPounds: o.pounds,
  transactionDate: o.date ?? null,
  networkProduct: null,
  notes: null,
});
const RAW = "Synthetic network commission statement extract for the B4b1 verifier.";
function parseLines(statementId, lines, actor = U.ownerA, slug = SLUG.a, mod = nf) {
  globalThis.__B4B2_AI_LINES = lines;
  return call(mod.parseNetworkStatementWithAi, { statementId, rawText: RAW }, actor, slug);
}
const LINE_COLS = `l.*, l.transaction_date::text as tx_date`;
const currentLines = (statementId) =>
  sqlOn(
    pg,
    `select ${LINE_COLS} from public.network_commission_lines l
     where statement_id = $1 and superseded_at is null order by line_no`,
    [statementId],
  );
const lineOf = (id) =>
  one(`select ${LINE_COLS}, l::text as t from public.network_commission_lines l where id = $1`, [
    id,
  ]);
const feeOf = (id) =>
  one(
    `select f.*, f.status::text as st, f.fee_event_date::text as event_date, f::text as t
     from public.finance_fee_lines f where id = $1`,
    [id],
  );
const stmtOf = (id) =>
  one(
    `select s.*, s.received_date::text as rd, s::text as t
     from public.network_commission_statements s where id = $1`,
    [id],
  );
const activeFees = (lineId) =>
  countOf(pg, "public.finance_fee_lines", "source_network_line_id = $1 and status <> 'deleted'", [
    lineId,
  ]);
const svc = (stmt, params = []) => asRole(pg, "service_role", stmt, params);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let periodN = 0;
function nextPeriod() {
  periodN += 1;
  return new Date(Date.UTC(2023, periodN, 1)).toISOString().slice(0, 7);
}
async function freshStatement(lines, { actor = U.ownerA, slug = SLUG.a } = {}) {
  const period = nextPeriod();
  const o = await call(nf.getOrCreateNetworkStatement, { periodMonth: period }, actor, slug);
  if (!o.ok) throw new Error(`open ${period}: ${o.message}`);
  const id = o.value.statement.id;
  if (lines) {
    const p = await parseLines(id, lines, actor, slug);
    if (!p.ok) throw new Error(`parse ${period}: ${p.message}`);
  }
  return { id, period, lines: lines ? await currentLines(id) : [] };
}
const allocate = (lineId, opts = {}, actor = U.ownerA, slug = SLUG.a) =>
  call(nf.allocateNetworkLine, { lineId, ...opts }, actor, slug);
/** One dated line allocated to a T001 case; declared total reconciles. */
async function reconciledStatement() {
  const s = await freshStatement([aiLine({ ref: "MG-B4B1-A1", pounds: 120, date: winterDate })]);
  const line = s.lines[0];
  const a = await allocate(line.id);
  if (!a.ok) throw new Error(`allocate: ${a.message}`);
  const d = await call(
    nf.setNetworkStatementDeclaredTotal,
    { statementId: s.id, declaredTotalPence: 12000 },
    U.ownerA,
  );
  if (!d.ok) throw new Error(`declared: ${d.message}`);
  return { ...s, line, feeId: a.value.feeLineId };
}
async function validatedStatement() {
  const s = await reconciledStatement();
  const v = await call(
    nf.validateNetworkStatement,
    { statementId: s.id, action: "validate" },
    U.ownerA,
  );
  if (!v.ok) throw new Error(`validate: ${v.message}`);
  return s;
}
const unlockRpc = (actor, statementId, reason) =>
  svc(`select public.unlock_network_statement($1, $2, $3, $4) as r`, [
    T.a,
    actor,
    statementId,
    reason,
  ]);
async function withDb(db, fn) {
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
/** Run `fn` with the fake PostgREST serving a fresh database migrated with `text`. */
async function onFreshDb(text, fn, seedMutate = null) {
  const db = await preB4b2Db(seedMutate);
  const m = await applyMigration(db, text);
  if (!m.ok) return { migrationFailed: m.message };
  return withDb(db, fn);
}



// --- B4b2 scenario helpers ---------------------------------------------------------------------
const HOUR = 3600000;
const iso = (ms) => new Date(ms).toISOString();
const feeAt = londonMidnight(winterDate);
const feeAtMs = Date.parse(feeAt);
const longAgo = "2020-01-01T00:00:00.000Z";
const dayBefore = iso(feeAtMs - DAY);
const dayAfter = iso(feeAtMs + DAY);
const fx = (stmt, params = []) => asFixture(pg, stmt, params);
/** Several statements in one service-role transaction (the marker is transaction-local). */
function svcTx(steps) {
  return onServed(pg, async () => {
    await pg.query("begin");
    try {
      await pg.query("set local role service_role");
      let r = { rows: [] };
      for (const [stmt, params = []] of steps) r = await pg.query(stmt, params);
      await pg.query("commit");
      return { ok: true, rows: r.rows };
    } catch (e) {
      await pg.query("rollback");
      return { ok: false, code: e.code, message: e.message };
    }
  });
}
/** Superuser statements in one transaction that is always rolled back. */
function probe(steps) {
  return onServed(pg, async () => {
    await pg.query("begin");
    try {
      let r = { rows: [] };
      for (const [stmt, params = []] of steps) r = await pg.query(stmt, params);
      return { ok: true, rows: r.rows };
    } catch (e) {
      return { ok: false, code: e.code, message: e.message };
    } finally {
      await pg.query("rollback");
    }
  });
}
const MARKER = [`select set_config('finance.b4b2_writer', 'on', true)`];
const FIN_TABLES = [
  "public.finance_ledger",
  "public.finance_payout_transitions",
  "public.finance_commission_exceptions",
  "public.finance_commission_determinations",
  "public.finance_audit_log",
  "public.finance_fee_lines",
  "public.referrals",
];
const finSnap = async () =>
  JSON.stringify(await Promise.all(FIN_TABLES.map((t) => rowsText(pg, t))));
const ledger = (where = "true", params = []) =>
  sql(
    `select g.*, g.economic_date::text as ed, g.economic_at::text as eat_text
     from public.finance_ledger g where ${where} order by g.created_at, g.event_type, g.id`,
    params,
  );
const accrualsOf = (feeId) =>
  ledger(`fee_line_id = $1 and event_type = 'commission_accrued'`, [feeId]);
const exceptionsOf = (feeId) =>
  sql(`select * from public.finance_commission_exceptions where fee_line_id = $1 order by created_at, id`, [
    feeId,
  ]);
const determinationsOf = (feeId) =>
  sql(
    `select * from public.finance_commission_determinations where fee_line_id = $1 order by created_at, id`,
    [feeId],
  );
const transitionsOf = (eventId) =>
  sql(
    `select * from public.finance_payout_transitions where ledger_event_id = $1 order by recorded_at, id`,
    [eventId],
  );
let personN = 0;
async function person(role, prefix = role) {
  personN += 1;
  const key = `${prefix}${personN}`;
  await addUser(pg, key, `${prefix} ${personN}`);
  if (role) await addMember(pg, key, T.a, role);
  return key;
}
let caseN = 0;
async function newCase(customerKey = null) {
  caseN += 1;
  const cust = customerKey ?? (await person("customer", "cust"));
  const id = randomUUID();
  const ref = `MG-B4B2-${String(caseN).padStart(3, "0")}`;
  await sql(
    `insert into public.interview_sessions (id, customer_id, tenant_id, case_ref, created_at)
     values ($1, $2, $3, $4, $5)`,
    [id, U[cust], T.a, ref, LEGACY_AT],
  );
  return { id, ref, cust };
}
/** Allocates one line per spec to its case and (by default) validates the statement. */
async function feesOn(specs, { validate = true } = {}) {
  const s = await freshStatement(
    specs.map((c) =>
      aiLine({ ref: c.ref, pounds: c.pounds, date: c.date ?? winterDate, type: c.type ?? "fee" }),
    ),
  );
  const feeIds = [];
  for (const line of s.lines) {
    const a = await allocate(line.id);
    if (!a.ok) throw new Error(`allocate: ${a.message}`);
    feeIds.push(a.value.feeLineId);
  }
  const total = specs.reduce((n, c) => n + Math.round(c.pounds * 100), 0);
  const d = await call(
    nf.setNetworkStatementDeclaredTotal,
    { statementId: s.id, declaredTotalPence: total },
    U.ownerA,
  );
  if (!d.ok) throw new Error(`declared: ${d.message}`);
  if (validate) {
    const v = await call(
      nf.validateNetworkStatement,
      { statementId: s.id, action: "validate" },
      U.ownerA,
    );
    if (!v.ok) throw new Error(`validate: ${v.message}`);
  }
  return { statementId: s.id, feeIds };
}
async function oneFee(c, pounds = 1000, opts = {}) {
  const r = await feesOn([{ ref: c.ref, pounds, ...opts }], opts);
  return r.feeIds[0];
}
const postTs = (sessionId, feeLineIds, actor = U.ownerA, slug = SLUG.a, mod = ff) =>
  call(mod.submitSessionFees, { sessionId, feeLineIds }, actor, slug);
const postRpc = (sessionId, ids, actor = U.ownerA, tenant = T.a) =>
  svc(`select * from public.post_session_fees($1, $2, $3, $4::uuid[])`, [
    tenant,
    actor,
    sessionId,
    ids,
  ]);
async function posted(c, pounds = 1000, opts = {}) {
  const feeId = await oneFee(c, pounds, opts);
  const p = await postTs(c.id, [feeId]);
  if (!p.ok) throw new Error(`post: ${p.message}`);
  const [fp] = await ledger(`fee_line_id = $1 and event_type = 'fee_posted'`, [feeId]);
  return { feeId, fp };
}
async function setCapture(at) {
  await fx(`update public.session_adviser_history_capture set started_at = $1`, [at]);
}
async function assign(sessionId, userKey, capacity, from = longAgo, to = null) {
  await fx(
    `insert into public.session_adviser_assignments (tenant_id, session_id, adviser_user_id,
       adviser_capacity, assigned_at, unassigned_at, unassigned_recorded_at, source)
     values ($1, $2, $3, $4, $5, $6, $6, 'session_advisors_insert')`,
    [T.a, sessionId, U[userKey], capacity, from, to],
  );
}
async function rate(kind, subjectKey, feeType, pct, from = longAgo) {
  const r = await fx(
    `insert into public.commission_rate_versions (tenant_id, subject_kind, introducer_id,
       adviser_user_id, adviser_role, fee_type, percentage, effective_from, created_by, source)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'owner') returning id`,
    [
      T.a,
      kind,
      kind === "introducer" ? I[subjectKey] : null,
      kind === "adviser" ? U[subjectKey] : null,
      kind === "adviser" ? "adviser" : null,
      feeType,
      pct,
      from,
      U.ownerA,
    ],
  );
  return r[0].id;
}
async function link(customerKey, introKey, created = longAgo, eff = created) {
  await fx(
    `insert into public.customer_introducer_links (customer_id, introducer_id, source, created_at,
       effective_from, updated_at, tenant_id)
     values ($1, $2, 'verifier', $3, $4, $4, $5)`,
    [U[customerKey], I[introKey], created, eff, T.a],
  );
}
async function amendment(customerKey, prevKey, newKey, eff) {
  await fx(
    `insert into public.introducer_amendment_history (customer_id, previous_introducer_id,
       new_introducer_id, effective_from, changed_by, tenant_id, created_at)
     values ($1, $2, $3, $4, $5, $6, $4)`,
    [U[customerKey], prevKey ? I[prevKey] : null, I[newKey], eff, U.ownerA, T.a],
  );
}
const payoutRpc = (eventId, to, actor = U.ownerA, note = null) =>
  svc(`select public.set_commission_payout_status($1, $2, $3, $4, $5) as r`, [
    T.a,
    actor,
    eventId,
    to,
    note,
  ]);
const reverseRpc = (feeId, actor = U.ownerA, reason = "Network reversed the fee") =>
  svc(`select * from public.reverse_posted_fee($1, $2, $3, $4)`, [T.a, actor, feeId, reason]);
const clawRpc = (eventId, actor = U.ownerA, reason = "Paid in error", replacement = null) =>
  svc(`select * from public.claw_back_commission($1, $2, $3, $4, $5)`, [
    T.a,
    actor,
    eventId,
    reason,
    replacement,
  ]);
const settleRpc = (eventId, outcome, actor = U.ownerA, reason = "Recovered from next payment") =>
  svc(`select public.settle_commission_clawback($1, $2, $3, $4, $5) as r`, [
    T.a,
    actor,
    eventId,
    outcome,
    reason,
  ]);
const resolveRpc = (excId, resolution, { pct = null, ids = null, actor = U.ownerA, reason = "Owner decision" } = {}) =>
  svc(`select * from public.resolve_commission_exception($1, $2, $3, $4, $5, $6::uuid[], $7)`, [
    T.a,
    actor,
    excId,
    resolution,
    pct,
    ids,
    reason,
  ]);

/**
 * Seed every B4b2 database (main and negative-control) identically: complete adviser history
 * from 2020, adviser rates of 10% on fees, three tenant introducers (two rated), extra advisers.
 */
async function seedB4b2() {
  await setCapture(longAgo);
  for (const k of ["advA", "advA2", "advA3"]) await rate("adviser", k, "fee", 10);
  await addUser(pg, "advA4", "advA4 Person");
  await addMember(pg, "advA4", T.a, "adviser");
  await rate("adviser", "advA4", "fee", 10);
  for (const [k, name] of [
    ["advNoRate", "No Rate Adviser"],
    ["advZero", "Zero Adviser"],
    ["advRound", "Round Adviser"],
    ["advE", "Export Adviser"],
  ]) {
    await addUser(pg, k, name);
    await addMember(pg, k, T.a, "adviser");
  }
  await rate("adviser", "advZero", "fee", 0);
  await rate("adviser", "advRound", "fee", 2.5);
  await rate("adviser", "advE", "fee", 10);
  for (const [key, user, code, name] of [
    ["introA1", "introU1", "1101", "Intro One Ltd"],
    ["introA2", "introU2", "1102", "Intro Two Ltd"],
    ["introA3", "introU3", "1103", "Intro Three Ltd"],
  ]) {
    await addUser(pg, user, `${user} Person`);
    await addMember(pg, user, T.a, "introducer");
    await addIntroducer(pg, key, user, T.a, { code, name });
  }
  await rate("introducer", "introA1", "fee", 2);
  await rate("introducer", "introA2", "fee", 3);
}

// --- reusable checks (each is also a negative-control predicate) -------------------------------
async function checkFeePostedUnique() {
  const c = await newCase();
  const { feeId } = await posted(c);
  const forced = await probe([
    [`set local session_replication_role = replica`],
    [
      `insert into public.finance_ledger (id, tenant_id, event_type, kind, idempotency_key, session_id,
         fee_line_id, customer_id, fee_type, amount_pence, is_reversal, economic_date, economic_at,
         created_by, actor_role, evidence)
       select gen_random_uuid(), tenant_id, event_type, kind, 'forced:' || gen_random_uuid(), session_id,
         fee_line_id, customer_id, fee_type, amount_pence, is_reversal, economic_date, economic_at,
         created_by, actor_role, evidence
       from public.finance_ledger where fee_line_id = $1 and event_type = 'fee_posted'`,
      [feeId],
    ],
    [
      `select count(*)::int as n from public.finance_ledger where fee_line_id = $1 and event_type = 'fee_posted'`,
      [feeId],
    ],
  ]);
  const viaGuard = await svcTx([
    MARKER,
    [
      `insert into public.finance_ledger (tenant_id, event_type, kind, idempotency_key, session_id,
         fee_line_id, customer_id, fee_type, amount_pence, is_reversal, economic_date, economic_at,
         created_by, actor_role)
       select tenant_id, event_type, kind, '-', session_id, fee_line_id, customer_id, fee_type,
         amount_pence, false, economic_date, economic_at, created_by, actor_role
       from public.finance_ledger where fee_line_id = $1 and event_type = 'fee_posted'`,
      [feeId],
    ],
  ]);
  return {
    forced,
    viaGuard,
    count: forced.rows?.[0]?.n ?? 1,
    pass: !forced.ok && forced.code === "23505" && !viaGuard.ok,
  };
}
async function checkAccrualUnique() {
  const c = await newCase();
  await assign(c.id, "advA", "adviser");
  const { feeId } = await posted(c);
  const other = await rate("adviser", "advA", "fee", 10, iso(Date.parse(longAgo) + HOUR));
  const forced = await probe([
    [`set local session_replication_role = replica`],
    [
      `insert into public.finance_ledger
       select (jsonb_populate_record(null::public.finance_ledger,
         to_jsonb(g) || jsonb_build_object('id', gen_random_uuid(), 'idempotency_key',
           'forced:' || gen_random_uuid(), 'rate_version_id', $2::uuid))).*
       from public.finance_ledger g where fee_line_id = $1 and event_type = 'commission_accrued'`,
      [feeId, other],
    ],
    [
      `select count(*)::int as n from public.finance_ledger where fee_line_id = $1 and event_type = 'commission_accrued'`,
      [feeId],
    ],
  ]);
  const def = (
    await sql(`select indexdef from pg_indexes where indexname = 'finance_ledger_accrual_key'`)
  )[0]?.indexdef;
  return {
    forced,
    def,
    pass: !forced.ok && forced.code === "23505" && Boolean(def) && !/rate_version_id/.test(def),
  };
}
async function checkPostAuthority() {
  const c = await newCase();
  const feeId = await oneFee(c);
  const before = await finSnap();
  const noPerm = await postRpc(c.id, [feeId], U.genNoPerm);
  const adviser = await postRpc(c.id, [feeId], U.advA);
  const foreign = await postRpc(c.id, [feeId], U.ownerB);
  const unchanged = (await finSnap()) === before;
  const gen = await postRpc(c.id, [feeId], U.genA);
  return {
    noPerm,
    adviser,
    foreign,
    gen,
    pass:
      !noPerm.ok &&
      /finance_forbidden/.test(noPerm.message) &&
      !adviser.ok &&
      !foreign.ok &&
      unchanged &&
      gen.ok,
  };
}
async function checkAdviserAsOf() {
  const c = await newCase();
  await assign(c.id, "advA", "adviser", longAgo, dayAfter);
  await assign(c.id, "advA2", "adviser", dayAfter);
  const { feeId } = await posted(c);
  const acc = await accrualsOf(feeId);
  return {
    acc: acc.map((a) => a.beneficiary_user_id),
    pass: acc.length === 1 && acc[0].beneficiary_user_id === U.advA,
  };
}
async function checkMaxThree() {
  const c = await newCase();
  for (const k of ["advA", "advA2", "advA3", "advA4"]) await assign(c.id, k, "adviser");
  const { feeId, fp } = await posted(c);
  const acc = await accrualsOf(feeId);
  const exc = await exceptionsOf(feeId);
  return {
    acc: acc.length,
    exc,
    fp,
    pass:
      Boolean(fp) &&
      acc.length === 0 &&
      exc.length === 1 &&
      exc[0].exception_kind === "adviser_entitlement_unproven" &&
      exc[0].evidence.reason === "more_than_three_advisers" &&
      exc[0].evidence.advisers.length === 4,
  };
}
async function checkIncompleteHeld() {
  await setCapture(new Date().toISOString());
  try {
    const c = await newCase();
    await assign(c.id, "advA", "adviser");
    const { feeId, fp } = await posted(c);
    const acc = await accrualsOf(feeId);
    const exc = await exceptionsOf(feeId);
    return {
      acc: acc.length,
      exc,
      feeId,
      pass:
        Boolean(fp) &&
        acc.length === 0 &&
        exc.length === 1 &&
        exc[0].exception_kind === "adviser_entitlement_unproven" &&
        exc[0].evidence.reason === "assigned_history_incomplete" &&
        exc[0].evidence.advisers.length === 1 &&
        exc[0].evidence.advisers[0].adviser_user_id === U.advA,
    };
  } finally {
    await setCapture(longAgo);
  }
}
async function checkIntroducerAsOf() {
  const c = await newCase();
  await link(c.cust, "introA2", longAgo, dayAfter);
  await amendment(c.cust, "introA1", "introA2", dayAfter);
  const { feeId } = await posted(c);
  const acc = (await accrualsOf(feeId)).filter((a) => a.beneficiary_role === "introducer");
  return {
    acc: acc.map((a) => a.introducer_id),
    pass: acc.length === 1 && acc[0].introducer_id === I.introA1 && acc[0].amount_pence === 2000,
  };
}
async function checkRateAsOf() {
  const c = await newCase();
  await assign(c.id, "advA3", "adviser");
  const v10 = await rate("adviser", "advA3", "mortgage_fee", 10);
  await rate("adviser", "advA3", "mortgage_fee", 20, dayAfter);
  const { feeId } = await posted(c, 1000, { type: "mortgage_fee" });
  const acc = await accrualsOf(feeId);
  return {
    acc: acc.map((a) => [a.amount_pence, a.commission_pct, a.rate_version_id === v10]),
    pass:
      acc.length === 1 &&
      acc[0].amount_pence === 10000 &&
      Number(acc[0].commission_pct) === 10 &&
      acc[0].rate_version_id === v10,
  };
}
async function checkNoRateException() {
  const c = await newCase();
  await assign(c.id, "advNoRate", "adviser");
  const { feeId, fp } = await posted(c);
  const acc = await accrualsOf(feeId);
  const exc = await exceptionsOf(feeId);
  const det = await determinationsOf(feeId);
  return {
    exc,
    det: det.map((d) => d.outcome),
    feeId,
    pass:
      Boolean(fp) &&
      acc.length === 0 &&
      exc.length === 1 &&
      exc[0].exception_kind === "missing_rate" &&
      exc[0].beneficiary_user_id === U.advNoRate &&
      exc[0].status === "open" &&
      det.some((d) => d.outcome === "exception" && d.exception_id === exc[0].id),
  };
}
async function checkUnvalidated() {
  const c = await newCase();
  const feeId = await oneFee(c, 1000, { validate: false });
  const before = await finSnap();
  const p = await postTs(c.id, [feeId]);
  return {
    p,
    pass:
      !p.ok &&
      /Validate the network statement/.test(p.message) &&
      (await finSnap()) === before &&
      (await feeOf(feeId)).st === "draft",
  };
}
async function checkLedgerImmutable() {
  const c = await newCase();
  const { fp } = await posted(c);
  const upd = await svcTx([
    MARKER,
    [`update public.finance_ledger set amount_pence = 1 where id = $1`, [fp.id]],
  ]);
  const updNoMarker = await svc(`update public.finance_ledger set note = 'x' where id = $1`, [fp.id]);
  const del = await svcTx([MARKER, [`delete from public.finance_ledger where id = $1`, [fp.id]]]);
  const delSuper = await probe([[`delete from public.finance_ledger where id = $1`, [fp.id]]]);
  const trunc = await probe([[`truncate public.finance_ledger cascade`]]);
  const [after] = await ledger(`id = $1`, [fp.id]);
  return {
    upd,
    del,
    after: after?.amount_pence,
    pass:
      !upd.ok &&
      !updNoMarker.ok &&
      !del.ok &&
      !delSuper.ok &&
      !trunc.ok &&
      after?.amount_pence === fp.amount_pence,
  };
}
async function paidAccrual() {
  const c = await newCase();
  await assign(c.id, "advA", "adviser");
  const { feeId } = await posted(c);
  const [acc] = await accrualsOf(feeId);
  const p = await payoutRpc(acc.id, "paid");
  if (!p.ok) throw new Error(`paid: ${p.message}`);
  return { c, feeId, acc };
}
async function checkPaidTerminal() {
  const { acc } = await paidAccrual();
  const back = await payoutRpc(acc.id, "received", U.ownerA, "reopen");
  const rej = await payoutRpc(acc.id, "rejected", U.ownerA, "nope");
  const [after] = await ledger(`id = $1`, [acc.id]);
  return {
    back,
    rej,
    status: after.payout_status,
    pass:
      !back.ok &&
      /finance_payout_terminal/.test(back.message) &&
      !rej.ok &&
      after.payout_status === "paid" &&
      (await transitionsOf(acc.id)).length === 2,
  };
}
async function checkPayoutAuthority() {
  const c = await newCase();
  await assign(c.id, "advA", "adviser");
  const { feeId } = await posted(c);
  const [acc] = await accrualsOf(feeId);
  const gen = await payoutRpc(acc.id, "paid", U.genA);
  const adv = await payoutRpc(acc.id, "paid", U.advA);
  const [after] = await ledger(`id = $1`, [acc.id]);
  const sup = await payoutRpc(acc.id, "rejected", U.supA);
  return {
    gen,
    status: after.payout_status,
    pass:
      !gen.ok &&
      /finance_forbidden/.test(gen.message) &&
      !adv.ok &&
      after.payout_status === "received" &&
      sup.ok,
  };
}
async function checkReversalOwnerOnly() {
  const c = await newCase();
  const { feeId } = await posted(c);
  const sup = await reverseRpc(feeId, U.supA);
  const gen = await reverseRpc(feeId, U.genA);
  return {
    sup,
    st: (await feeOf(feeId)).st,
    pass: !sup.ok && !gen.ok && (await feeOf(feeId)).st === "posted",
  };
}
async function reversalScenario() {
  const c = await newCase();
  for (const k of ["advA", "advA2", "advA3"]) await assign(c.id, k, "adviser");
  await link(c.cust, "introA3");
  const { feeId, fp } = await posted(c);
  const acc = await accrualsOf(feeId);
  const by = (k) => acc.find((a) => a.beneficiary_user_id === U[k]);
  const pPaid = await payoutRpc(by("advA").id, "paid");
  const pRej = await payoutRpc(by("advA2").id, "rejected", U.supA);
  if (!pPaid.ok || !pRej.ok) throw new Error(`payout: ${describe(pPaid, pRej)}`);
  return { c, feeId, fp, paid: by("advA"), rejected: by("advA2"), received: by("advA3") };
}
async function checkReversalClawsBackPaid() {
  const s = await reversalScenario();
  const r = await reverseRpc(s.feeId);
  const claws = await ledger(`original_event_id = $1 and event_type = 'clawback'`, [s.paid.id]);
  const [paidAfter] = await ledger(`id = $1`, [s.paid.id]);
  return {
    r,
    claws: claws.length,
    s,
    pass:
      r.ok &&
      claws.length === 1 &&
      claws[0].amount_pence === -s.paid.amount_pence &&
      claws[0].recovery_status === "due" &&
      paidAfter.payout_status === "paid",
  };
}
async function checkClawbackOnce() {
  const { acc } = await paidAccrual();
  const first = await clawRpc(acc.id);
  const second = await clawRpc(acc.id);
  const n = await countOf(pg, "public.finance_ledger", "original_event_id = $1 and event_type = 'clawback'", [
    acc.id,
  ]);
  return { first, second, n, pass: first.ok && !second.ok && n === 1 };
}
async function checkSettleOwnerOnly() {
  const { acc } = await paidAccrual();
  const cb = await clawRpc(acc.id);
  const clawId = cb.rows?.[0]?.clawback_event_id;
  const sup = await settleRpc(clawId, "settled", U.supA);
  const [after] = await ledger(`id = $1`, [clawId]);
  return {
    sup,
    status: after?.recovery_status,
    pass: cb.ok && !sup.ok && after?.recovery_status === "due",
  };
}
async function checkAuditImmutable() {
  const [row] = await sql(`select id, summary from public.finance_audit_log order by created_at desc limit 1`);
  const updSvc = await svc(`update public.finance_audit_log set summary = 'tampered' where id = $1`, [row.id]);
  const delSvc = await svc(`delete from public.finance_audit_log where id = $1`, [row.id]);
  const updSuper = await probe([
    [`update public.finance_audit_log set summary = 'tampered' where id = $1 returning summary`, [row.id]],
  ]);
  const delSuper = await probe([[`delete from public.finance_audit_log where id = $1`, [row.id]]]);
  return {
    updSuper,
    pass: !updSvc.ok && !delSvc.ok && !updSuper.ok && !delSuper.ok,
  };
}
async function checkCorrectionInheritsDate() {
  const c = await newCase();
  await assign(c.id, "advA", "adviser");
  const { feeId } = await posted(c);
  const rv = await reverseRpc(feeId);
  const corr = await svc(`select * from public.post_fee_correction($1, $2, $3, $4, $5, $6)`, [
    T.a,
    U.ownerA,
    feeId,
    90000,
    "Network corrected the amount",
    "Network email 2026-01-20",
  ]);
  const newId = corr.rows?.[0]?.fee_line_id;
  const orig = await feeOf(feeId);
  const cf = newId ? await feeOf(newId) : null;
  const [fp] = newId ? await ledger(`fee_line_id = $1 and event_type = 'fee_posted'`, [newId]) : [];
  return {
    corr,
    cf,
    orig,
    fp,
    newId,
    pass:
      rv.ok &&
      corr.ok &&
      cf?.event_date === orig.event_date &&
      cf?.fee_event_source === "owner_correction" &&
      cf?.corrects_fee_line_id === feeId &&
      cf?.st === "posted" &&
      fp?.ed === orig.event_date &&
      cf?.fee_event_evidence?.inherited_fee_event_evidence?.statement_id ===
        orig.fee_event_evidence?.statement_id &&
      cf?.fee_event_evidence?.correction?.evidence === "Network email 2026-01-20",
  };
}
async function checkIneligibleIntroducerFeeType() {
  const c = await newCase();
  await link(c.cust, "introA1");
  const { feeId } = await posted(c, 1000, { type: "insurance_fee" });
  const exc = await exceptionsOf(feeId);
  const det = (await determinationsOf(feeId)).filter((d) => d.beneficiary_role === "introducer");
  const acc = (await accrualsOf(feeId)).filter((a) => a.beneficiary_role === "introducer");
  return {
    det: det.map((d) => d.outcome),
    exc: exc.map((e) => e.exception_kind),
    pass:
      acc.length === 0 &&
      exc.filter((e) => e.beneficiary_role === "introducer").length === 0 &&
      det.length === 1 &&
      det[0].outcome === "not_eligible_fee_type" &&
      det[0].introducer_id === I.introA1,
  };
}
async function checkExceptionOwnerOnly() {
  const r = await checkNoRateException();
  const [exc] = r.exc;
  const sup = await resolveRpc(exc.id, "event_pct", { pct: 5, actor: U.supA });
  const [after] = await sql(`select status from public.finance_commission_exceptions where id = $1`, [exc.id]);
  return { sup, pass: !sup.ok && after.status === "open" && (await accrualsOf(r.feeId)).length === 0 };
}
async function checkReopenReason() {
  const c = await newCase();
  await assign(c.id, "advA", "adviser");
  const { feeId } = await posted(c);
  const [acc] = await accrualsOf(feeId);
  const rej = await payoutRpc(acc.id, "rejected", U.ownerA);
  const bare = await payoutRpc(acc.id, "received", U.ownerA, null);
  const [mid] = await ledger(`id = $1`, [acc.id]);
  const withReason = await payoutRpc(acc.id, "received", U.ownerA, "Network confirmed payment");
  const tr = await transitionsOf(acc.id);
  return {
    bare,
    mid: mid.payout_status,
    pass:
      rej.ok &&
      !bare.ok &&
      mid.payout_status === "rejected" &&
      withReason.ok &&
      tr.at(-1)?.from_status === "rejected" &&
      tr.at(-1)?.reason === "Network confirmed payment",
  };
}
async function checkLedgerTenantFk() {
  const c = await newCase();
  const { fp } = await posted(c);
  const r = await probe([
    [`alter table public.finance_ledger disable trigger finance_ledger_append_only`],
    [
      `insert into public.finance_ledger
       select (jsonb_populate_record(null::public.finance_ledger,
         to_jsonb(g) || jsonb_build_object('id', gen_random_uuid(), 'tenant_id', $2::uuid,
           'idempotency_key', 'cross:' || gen_random_uuid()))).*
       from public.finance_ledger g where id = $1`,
      [fp.id, T.b],
    ],
  ]);
  return { r, pass: !r.ok && r.code === "23503" };
}
async function checkPayoutQueue(mod = ff) {
  const s = await reversalScenario();
  const r = await reverseRpc(s.feeId);
  const listA = await call(mod.listCommissionPayouts, { sessionId: s.c.id }, U.ownerA);
  const listB = await call(mod.listCommissionPayouts, {}, U.ownerB, SLUG.b);
  const accrualIds = new Set(
    (await ledger(`event_type = 'commission_accrued' and tenant_id = $1`, [T.a])).map((g) => g.id),
  );
  const rowsA = listA.value?.rows ?? [];
  const rowsB = listB.value?.rows ?? [];
  return {
    r,
    listA,
    listB,
    rowsA,
    rowsB,
    s,
    typed:
      listA.ok &&
      rowsA.length === 3 &&
      rowsA.every((x) => accrualIds.has(x.id)) &&
      rowsA.find((x) => x.id === s.received.id)?.payoutStatus === "reversed" &&
      (listA.value?.clawbacks ?? []).length === 1,
    tenantSafe: listB.ok && rowsB.every((x) => !accrualIds.has(x.id)),
  };
}

// =============================================================================================
// MIGRATION — staging-shaped post-B4b1 database
// =============================================================================================
pg = await preB4b2Db();
const FEE_B4B2_COLS = ["corrects_fee_line_id", "reversed_at", "reversed_by", "reversal_reason"];
const feeCore = (db) =>
  sqlOn(
    db,
    `select (to_jsonb(f) - $1::text[])::text as j from public.finance_fee_lines f order by id`,
    [FEE_B4B2_COLS],
  ).then((r) => r.map((x) => x.j));
const B4A_FNS = ["set_commission_rate_versions", "resolve_commission_rate_as_of"];
const B4B1_FNS = [
  "resolve_session_advisers_as_of",
  "allocate_network_line",
  "validate_network_statement",
  "unlock_network_statement",
  "network_finance_audit",
];
const b4aState = async (db) =>
  JSON.stringify({
    fns: await fnFingerprint(db, B4A_FNS),
    cat: await catalogOf(db, ["commission_rate_versions"]),
  });
const b3State = async (db) =>
  JSON.stringify({
    fns: await fnFingerprint(db, ["amend_customer_introducer_attribution"]),
    cat: await catalogOf(db, ["customer_introducer_links", "introducer_amendment_history"]),
  });
const a2State = async (db) =>
  JSON.stringify({
    rows: (
      await sqlOn(db, `select i::text as t from public.introducers i where user_id = $1 order by id`, [
        U.introDual,
      ])
    ).map((r) => r.t),
    cat: await catalogOf(db, ["introducers"]),
  });
const s4c2State = async (db) =>
  JSON.stringify({
    rows: (
      await sqlOn(
        db,
        `select s::text as t from public.interview_sessions s where customer_id = $1
         union all select m::text from public.tenant_memberships m where user_id = $1 order by 1`,
        [U.custS4C2],
      )
    ).map((r) => r.t),
    cat: await catalogOf(db, ["interview_sessions", "tenant_memberships"]),
  });
const b4b1State = async (db) =>
  JSON.stringify({
    fns: await fnFingerprint(db, B4B1_FNS),
    cat: await catalogOf(db, [
      "session_adviser_assignments",
      "session_adviser_history_capture",
      "network_commission_statements",
      "network_commission_lines",
      "network_commission_statements_unowned_pre_b4b1",
    ]),
    rows: await Promise.all(
      [
        "public.session_adviser_assignments",
        "public.network_commission_statements",
        "public.network_commission_statements_unowned_pre_b4b1",
      ].map((t) => rowsText(db, t)),
    ),
  });
const fnList = async () =>
  (
    await sql(
      `select p.oid::regprocedure::text as sig from pg_proc p
       where p.pronamespace = 'public'::regnamespace order by 1`,
    )
  ).map((r) => r.sig);
const preFns = await fnList();
const preFeeCore = await feeCore(pg);
const preB4a = await b4aState(pg);
const preB3 = await b3State(pg);
const preA2 = await a2State(pg);
const preS4C2 = await s4c2State(pg);
const preB4b1 = await b4b1State(pg);
const preTables = JSON.stringify(
  await Promise.all(
    ["public.interview_sessions", "public.customer_introducer_links", "public.referrals"].map((t) =>
      rowsText(pg, t),
    ),
  ),
);
const mig = await applyMigration(pg);
const newFns = (await fnList()).filter((f) => !preFns.includes(f));
const B4B2_FNS = newFns.map((s) => s.replace(/\(.*$/, "").replace(/^public\./, ""));
ok(
  "B4B2-01 migration applies to the staging-shaped post-B4b1 database: no ledger, transition, exception or determination rows are created; fee lines, sessions, links and referrals unchanged",
  mig.ok &&
    (await countOf(pg, "public.finance_ledger")) === 0 &&
    (await countOf(pg, "public.finance_payout_transitions")) === 0 &&
    (await countOf(pg, "public.finance_commission_exceptions")) === 0 &&
    (await countOf(pg, "public.finance_commission_determinations")) === 0 &&
    JSON.stringify(await feeCore(pg)) === JSON.stringify(preFeeCore) &&
    JSON.stringify(
      await Promise.all(
        ["public.interview_sessions", "public.customer_introducer_links", "public.referrals"].map(
          (t) => rowsText(pg, t),
        ),
      ),
    ) === preTables,
  mig.ok ? `functions=${newFns.length}` : mig.message,
);
{
  const a = await postRpc(R.sessA1, [R.draftA], U.ownerA, T.a);
  const b = await postRpc(R.sessB1, [R.draftB], U.ownerB, T.b);
  ok(
    "B4B2-02 the two staging undated drafts stay unpostable (finance_fee_event_date_required); both remain draft with no ledger rows",
    !a.ok &&
      /finance_fee_event_date_required/.test(a.message) &&
      !b.ok &&
      /finance_fee_event_date_required/.test(b.message) &&
      (await feeOf(R.draftA)).st === "draft" &&
      (await feeOf(R.draftB)).st === "draft" &&
      (await countOf(pg, "public.finance_ledger")) === 0,
    describe(a, b),
  );
}
{
  const fks = await sql(
    `select c.conrelid::regclass::text as rel, c.conname, c.confdeltype, c.confupdtype,
            cardinality(c.conkey) as n, c.confrelid::regclass::text as ref
     from pg_constraint c
     where c.contype = 'f' and c.conrelid = any(array['public.finance_ledger',
       'public.finance_payout_transitions', 'public.finance_commission_exceptions',
       'public.finance_commission_determinations']::regclass[])`,
  );
  const composite = fks.filter((f) => f.rel === "finance_ledger" && f.n === 2);
  const [etc] = await sql(
    `select pg_get_constraintdef(oid) as d from pg_constraint where conname = 'finance_ledger_event_type_check'`,
  );
  const types = [
    "fee_posted",
    "fee_reversed",
    "commission_accrued",
    "commission_reversed",
    "commission_reassigned",
    "clawback",
    "clawback_settled",
    "clawback_written_off",
  ];
  ok(
    "B4B2-03 typed ledger: exactly the 8 event types; no financial FK cascades or nulls (CASCADE / SET NULL / SET DEFAULT); 5 RESTRICT composite (x, tenant_id) ledger FKs to sessions, fee lines, introducers, the original event and exceptions",
    fks.length > 0 &&
      fks.every((f) => !"cnd".includes(f.confdeltype) && !"cnd".includes(f.confupdtype)) &&
      composite.length === 5 &&
      composite.every((f) => f.confdeltype === "r" && f.confupdtype === "r") &&
      ["interview_sessions", "finance_fee_lines", "introducers", "finance_ledger", "finance_commission_exceptions"].every(
        (r) => composite.some((f) => f.ref === r),
      ) &&
      types.every((t) => etc.d.includes(`'${t}'`)) &&
      (etc.d.match(/'[a-z_]+'/g) ?? []).length === 8,
    JSON.stringify({
      composite: composite.map((f) => f.ref),
      loose: fks.filter((f) => f.confdeltype !== "r" || f.confupdtype !== "r").map((f) => `${f.rel}.${f.conname}:${f.confdeltype}${f.confupdtype}`),
      types: etc.d.match(/'[a-z_]+'/g)?.length,
    }),
  );
}
{
  const tables = [
    "finance_ledger",
    "finance_payout_transitions",
    "finance_commission_exceptions",
    "finance_commission_determinations",
    "finance_audit_log",
  ];
  const grants = await sql(
    `select t as tbl, r as role, p as priv, has_table_privilege(r, 'public.' || t, p) as g
     from unnest($1::text[]) t, unnest(array['anon','authenticated']) r,
          unnest(array['INSERT','UPDATE','DELETE','TRUNCATE']) p`,
    [tables],
  );
  const fns = await sql(
    `select p.proname, has_function_privilege('anon', p.oid, 'execute') as anon,
            has_function_privilege('authenticated', p.oid, 'execute') as auth,
            has_function_privilege('service_role', p.oid, 'execute') as svc
     from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = any($1::text[])`,
    [B4B2_FNS],
  );
  const RPCS = [
    "post_session_fees",
    "reverse_posted_fee",
    "post_fee_correction",
    "reassign_introducer_commission",
    "claw_back_commission",
    "resolve_commission_exception",
    "set_commission_payout_status",
    "settle_commission_clawback",
  ];
  ok(
    "B4B2-04 privileges: anon/authenticated hold no write privilege on the ledger, transitions, exceptions, determinations or audit; no B4b2 function is executable by anon/authenticated; every RPC is executable by service_role",
    grants.every((g) => !g.g) &&
      fns.length === B4B2_FNS.length &&
      fns.every((f) => !f.anon && !f.auth) &&
      RPCS.every((r) => fns.some((f) => f.proname === r && f.svc)),
    JSON.stringify({
      writes: grants.filter((g) => g.g).slice(0, 4),
      exec: fns.filter((f) => f.anon || f.auth).map((f) => f.proname),
    }),
  );
}
{
  const EMPTY_PATH = /search_path=(""|\\"\\"|'')/;
  const props = await sql(
    `select p.proname, p.prosecdef, coalesce(p.proconfig::text, '') as cfg
     from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = any($1::text[])`,
    [[...B4B2_FNS, "finance_fee_lines_guard"]],
  );
  ok(
    "B4B2-05 the 21 new B4b2 functions and the replaced fee-line guard (22) are SECURITY INVOKER with an empty search_path",
    newFns.length === 21 &&
      props.length === 22 &&
      props.every((p) => !p.prosecdef && EMPTY_PATH.test(p.cfg)),
    JSON.stringify(props.filter((p) => p.prosecdef || !EMPTY_PATH.test(p.cfg)).map((p) => [p.proname, p.cfg]).slice(0, 2)),
  );
}
await seedB4b2();
{
  const c = await newCase();
  const feeId = await oneFee(c);
  const authIns = await asRole(
    pg,
    "authenticated",
    `insert into public.finance_ledger (tenant_id, event_type, kind, idempotency_key, amount_pence,
       is_reversal, created_by, actor_role) values ($1, 'fee_posted', 'post', 'x', 1, false, $2, 'owner')`,
    [T.a, U.ownerA],
    U.ownerA,
  );
  const authRead = await asRole(pg, "authenticated", `select count(*)::int as n from public.finance_ledger`, [], U.ownerA);
  const svcIns = await svc(
    `insert into public.finance_ledger (tenant_id, event_type, kind, idempotency_key, session_id,
       fee_line_id, customer_id, fee_type, amount_pence, is_reversal, economic_date, economic_at,
       created_by, actor_role)
     values ($1, 'fee_posted', 'post', 'x', $2, $3, $4, 'fee', 100000, false, $5, $6, $7, 'owner')`,
    [T.a, c.id, feeId, U[c.cust], winterDate, feeAt, U.ownerA],
  );
  const svcFee = await svc(
    `update public.finance_fee_lines set status = 'posted', posted_at = now() where id = $1`,
    [feeId],
  );
  const authRpc = await asRole(
    pg,
    "authenticated",
    `select * from public.post_session_fees($1, $2, $3, $4::uuid[])`,
    [T.a, U.ownerA, c.id, [feeId]],
    U.ownerA,
  );
  ok(
    "B4B2-06 direct writes refused: authenticated cannot insert into the ledger or call the RPCs; service_role cannot insert a ledger row or flip a fee to posted outside the posting RPC",
    !authIns.ok &&
      !authRpc.ok &&
      !svcIns.ok &&
      !svcFee.ok &&
      (!authRead.ok || authRead.rows[0].n === 0) &&
      (await feeOf(feeId)).st === "draft" &&
      (await countOf(pg, "public.finance_ledger")) === 0,
    describe(authIns, authRpc, svcIns, svcFee),
  );
}

// =============================================================================================
// POSTING
// =============================================================================================
{
  const c = await newCase();
  await assign(c.id, "advA", "adviser");
  const feeId = await oneFee(c, 1000);
  const p = await postTs(c.id, [feeId]);
  const f = await feeOf(feeId);
  const [fp] = await ledger(`fee_line_id = $1 and event_type = 'fee_posted'`, [feeId]);
  const acc = await accrualsOf(feeId);
  ok(
    "B4B2-07 Owner posts through submitSessionFees → post_session_fees: fee posted and locked; one fee_posted event carrying the fee, customer, statement evidence and the economic date (winter: London midnight = UTC midnight)",
    p.ok &&
      p.value.count === 1 &&
      f.st === "posted" &&
      fp?.amount_pence === 100000 &&
      fp.customer_id === U[c.cust] &&
      fp.ed === winterDate &&
      Date.parse(fp.economic_at) === Date.parse(feeAt) &&
      fp.evidence?.fee_event_evidence?.statement_id &&
      acc.length === 1,
    describe(p),
  );
}
{
  const c = await newCase();
  const feeId = await oneFee(c, 500, { date: summerDate });
  await sleep(5);
  const p = await postTs(c.id, [feeId]);
  const f = await feeOf(feeId);
  const [fp] = await ledger(`fee_line_id = $1 and event_type = 'fee_posted'`, [feeId]);
  ok(
    "B4B2-08 the economic date is the fee's network transaction date (summer: London midnight = 23:00 UTC the day before), never posted_at / created_at / now()",
    p.ok &&
      fp.ed === summerDate &&
      Date.parse(fp.economic_at) === Date.parse(londonMidnight(summerDate)) &&
      Date.parse(fp.economic_at) === Date.parse(f.fee_event_at) &&
      Date.parse(fp.economic_at) !== Date.parse(f.posted_at) &&
      Date.parse(fp.economic_at) !== Date.parse(fp.created_at),
    `${fp?.economic_at} vs ${f.posted_at}`,
  );
}
{
  const c = await newCase();
  await assign(c.id, "advA", "adviser");
  await link(c.cust, "introA1");
  const feeId = await oneFee(c);
  const p1 = await postRpc(c.id, [feeId]);
  const snap = await finSnap();
  const p2 = await postRpc(c.id, [feeId]);
  const p3 = await postTs(c.id, [feeId]);
  ok(
    "B4B2-09 replay is idempotent: re-posting the same fee returns created=false and writes nothing (ledger, transitions, exceptions, determinations, audit unchanged)",
    p1.ok &&
      p1.rows[0].created === true &&
      p2.ok &&
      p2.rows[0].created === false &&
      p3.ok &&
      (await finSnap()) === snap,
    describe(p1, p2, p3),
  );
}
{
  const c = await newCase();
  for (const k of ["advA", "advA2"]) await assign(c.id, k, "adviser");
  const feeId = await oneFee(c);
  const [a, b] = await Promise.all([postTs(c.id, [feeId]), postTs(c.id, [feeId], U.supA)]);
  ok(
    "B4B2-10 two concurrent submissions of the same fee both succeed and produce exactly one fee_posted and one accrual per adviser",
    a.ok &&
      b.ok &&
      (await countOf(pg, "public.finance_ledger", "fee_line_id = $1 and event_type = 'fee_posted'", [feeId])) ===
        1 &&
      (await accrualsOf(feeId)).length === 2,
    describe(a, b),
  );
}
{
  const r = await checkFeePostedUnique();
  ok(
    "B4B2-11 concurrency backstop: a duplicate fee_posted forced past the RPC (and past the triggers) is rejected by the unique index (23505); the guarded path refuses it too",
    r.pass,
    describe(r.forced, r.viaGuard),
  );
}
{
  const r = await checkAccrualUnique();
  ok(
    "B4B2-12 accrual uniqueness is (tenant, fee line, role, beneficiary) — a duplicate under a different rate version is rejected (23505); the key has no rate_version_id",
    r.pass,
    `${describe(r.forced)} ${r.def}`,
  );
}
{
  const c = await newCase();
  const { feeIds } = await feesOn([
    { ref: c.ref, pounds: 100 },
    { ref: c.ref, pounds: 200 },
  ]);
  const p1 = await postTs(c.id, [feeIds[0]]);
  const mid = [(await feeOf(feeIds[0])).st, (await feeOf(feeIds[1])).st];
  const p2 = await postTs(c.id, [feeIds[1]]);
  ok(
    "B4B2-13 posting a subset posts only the selected fee lines; the others stay draft until posted",
    p1.ok && mid[0] === "posted" && mid[1] === "draft" && p2.ok && (await feeOf(feeIds[1])).st === "posted",
    describe(p1, p2),
  );
}
{
  const c = await newCase();
  const other = await newCase();
  const feeId = await oneFee(c);
  const otherFee = await oneFee(other);
  const before = await finSnap();
  const wrongSession = await postRpc(c.id, [otherFee]);
  const missing = await postRpc(c.id, [randomUUID()]);
  const empty = await postRpc(c.id, []);
  const dup = await postRpc(c.id, [feeId, feeId]);
  const foreign = await postRpc(c.id, [feeId], U.ownerB, T.b);
  const tsEmpty = await postTs(c.id, []);
  ok(
    "B4B2-14 invalid selections are refused with nothing written: another session's fee, an unknown id, an empty or duplicated list, another tenant's actor",
    !wrongSession.ok &&
      !missing.ok &&
      !empty.ok &&
      !dup.ok &&
      !foreign.ok &&
      !tsEmpty.ok &&
      (await finSnap()) === before &&
      (await feeOf(feeId)).st === "draft",
    describe(wrongSession, missing, empty, dup, foreign),
  );
}
{
  const c = await newCase();
  await assign(c.id, "advA", "adviser");
  const good = await oneFee(c, 300);
  const bad = await oneFee(c, 400, { validate: false });
  const before = await finSnap();
  const p = await postTs(c.id, [good, bad]);
  ok(
    "B4B2-15 posting is atomic: one invalid fee (unvalidated statement) rolls back the whole batch — the valid fee stays draft, no ledger/exception/determination/audit rows",
    !p.ok && (await feeOf(good)).st === "draft" && (await finSnap()) === before,
    describe(p),
  );
}
{
  const c = await newCase();
  const feeId = await oneFee(c);
  const gen = await postTs(c.id, [feeId], U.genNoPerm);
  const adv = await postTs(c.id, [feeId], U.advA);
  const unchanged = (await feeOf(feeId)).st === "draft";
  const sup = await postTs(c.id, [feeId], U.supA);
  const c2 = await newCase();
  const fee2 = await oneFee(c2);
  const genOk = await postTs(c2.id, [fee2], U.genA);
  const r = await checkPostAuthority();
  ok(
    "B4B2-16 posting authority: Owner, Supervisor, or General with finance_customer=amend — in the server function and again in the database; General without the permission, advisers and other tenants are refused",
    !gen.ok && !adv.ok && unchanged && sup.ok && genOk.ok && r.pass,
    describe(gen, adv, sup, genOk, r.noPerm, r.adviser, r.foreign, r.gen),
  );
}
{
  const r = await checkUnvalidated();
  ok(
    "B4B2-17 a fee from an unvalidated statement cannot be posted (friendly message; nothing written)",
    r.pass,
    describe(r.p),
  );
}

// =============================================================================================
// ADVISERS — B4b1 history at fee_event_at
// =============================================================================================
{
  const r = await checkAdviserAsOf();
  ok(
    "B4B2-18 adviser entitlement is resolved at fee_event_at: an adviser unassigned after the fee date earns; one assigned after it does not",
    r.pass,
    JSON.stringify(r.acc),
  );
}
{
  const c = await newCase();
  await assign(c.id, "advA", "adviser", longAgo, dayBefore);
  const { feeId } = await posted(c);
  const det = (await determinationsOf(feeId)).filter((d) => d.beneficiary_role === "advisor");
  ok(
    "B4B2-19 an adviser whose assignment ended before the fee date earns nothing; complete history records no_adviser_assigned (no exception)",
    (await accrualsOf(feeId)).length === 0 &&
      (await exceptionsOf(feeId)).length === 0 &&
      det.length === 1 &&
      det[0].outcome === "no_adviser_assigned",
    JSON.stringify(det.map((d) => d.outcome)),
  );
}
{
  const c = await newCase();
  for (const k of ["advA", "advA2", "advA3"]) await assign(c.id, k, "adviser");
  const { feeId } = await posted(c);
  const acc = await accrualsOf(feeId);
  const a = acc.find((x) => x.beneficiary_user_id === U.advA);
  ok(
    "B4B2-20 three advisers each earn their full percentage (no split): 3 × 10% of £1,000.00 = 3 × £100.00, with beneficiary name/code snapshots and capacity",
    acc.length === 3 &&
      acc.every((x) => x.amount_pence === 10000 && Number(x.commission_pct) === 10) &&
      acc.every((x) => x.beneficiary_capacity === "adviser" && x.payout_status === "received") &&
      a?.beneficiary_name === "advA Person" &&
      a?.beneficiary_code === "ADVA" &&
      acc.every((x) => x.ed === winterDate),
    JSON.stringify(acc.map((x) => [x.amount_pence, x.beneficiary_name, x.beneficiary_code])),
  );
}
{
  const r = await checkMaxThree();
  ok(
    "B4B2-21 more than three advisers: the fee posts, all adviser commission is held (D2) in one adviser_entitlement_unproven exception listing the four advisers",
    r.pass,
    JSON.stringify({ acc: r.acc, exc: r.exc.map((e) => e.evidence?.reason) }),
  );
}
{
  const r = await checkIncompleteHeld();
  ok(
    "B4B2-22 history incomplete at the fee date (capture started later): the recorded adviser is evidence only — commission held for Owner determination",
    r.pass,
    JSON.stringify({ acc: r.acc, exc: r.exc.map((e) => e.evidence?.reason) }),
  );
}
{
  await setCapture(new Date().toISOString());
  let r;
  try {
    const c = await newCase();
    const { feeId } = await posted(c);
    r = { exc: await exceptionsOf(feeId), acc: await accrualsOf(feeId) };
  } finally {
    await setCapture(longAgo);
  }
  ok(
    "B4B2-23 no proof at the fee date (no history, capture later): adviser commission is held with reason no_proof, never treated as none",
    r.acc.length === 0 &&
      r.exc.length === 1 &&
      r.exc[0].evidence.reason === "no_proof" &&
      r.exc[0].evidence.advisers.length === 0,
    JSON.stringify(r.exc.map((e) => e.evidence?.reason)),
  );
}
const d1 = {};
{
  const c = await newCase();
  await assign(c.id, "ownerA", "owner");
  const { feeId, fp } = await posted(c);
  const [exc] = await exceptionsOf(feeId);
  const tsSup = await call(
    ff.resolveCommissionException,
    { exceptionId: exc.id, resolution: "event_pct", pct: 5, reason: "Owner sold the case" },
    U.supA,
  );
  const r = await call(
    ff.resolveCommissionException,
    { exceptionId: exc.id, resolution: "event_pct", pct: 5, reason: "Owner sold the case" },
    U.ownerA,
  );
  const again = await resolveRpc(exc.id, "event_pct", { pct: 5 });
  const acc = await accrualsOf(feeId);
  const [after] = await sql(`select * from public.finance_commission_exceptions where id = $1`, [exc.id]);
  Object.assign(d1, { feeId, acc });
  ok(
    "B4B2-24 D1: a non-adviser assignee (Owner capacity) — fee posts, adviser_capacity_unrated exception; only the Owner resolves it with an event percentage (5% → £50.00, rate_source owner_event_pct); a second resolution is refused",
    Boolean(fp) &&
      exc?.exception_kind === "adviser_capacity_unrated" &&
      exc.beneficiary_user_id === U.ownerA &&
      exc.beneficiary_capacity === "owner" &&
      !tsSup.ok &&
      r.ok &&
      !again.ok &&
      acc.length === 1 &&
      acc[0].amount_pence === 5000 &&
      acc[0].rate_source === "owner_event_pct" &&
      acc[0].exception_id === exc.id &&
      acc[0].beneficiary_capacity === "owner" &&
      after.status === "resolved" &&
      after.resolution === "event_pct",
    describe(tsSup, r, again),
  );
}
{
  const r = await checkMaxThree();
  const [exc] = r.exc;
  const tooMany = await resolveRpc(exc.id, "advisers_determined", {
    ids: [U.advA, U.advA2, U.advA3, U.advA4],
  });
  const notAdviser = await resolveRpc(exc.id, "advisers_determined", { ids: [U.supA] });
  const tsTooMany = await call(
    ff.resolveCommissionException,
    {
      exceptionId: exc.id,
      resolution: "advisers_determined",
      adviserUserIds: [U.advA, U.advA2, U.advA3, U.advA4],
      reason: "x",
    },
    U.ownerA,
  );
  const good = await resolveRpc(exc.id, "advisers_determined", { ids: [U.advA, U.advA2] });
  const acc = await accrualsOf(r.fp.fee_line_id);
  const [after] = await sql(`select * from public.finance_commission_exceptions where id = $1`, [exc.id]);
  ok(
    "B4B2-25 D2: the Owner determines up to three advisers from the held exception; each accrues their own rate at the fee date (10% → £100.00 each); >3 or a non-adviser is refused",
    !tooMany.ok &&
      !notAdviser.ok &&
      !tsTooMany.ok &&
      good.ok &&
      acc.length === 2 &&
      acc.every((a) => a.amount_pence === 10000 && a.rate_source === "rate_version" && a.ed === winterDate) &&
      after.status === "resolved" &&
      after.resolution_adviser_ids.length === 2,
    describe(tooMany, notAdviser, tsTooMany, good),
  );
}
{
  const r1 = await checkNoRateException();
  const [e1] = r1.exc;
  const zeroPct = await resolveRpc(e1.id, "event_pct", { pct: 0 });
  const withIds = await resolveRpc(e1.id, "event_pct", { pct: 5, ids: [U.advA] });
  const pct = await resolveRpc(e1.id, "event_pct", { pct: 7.5 });
  const acc = await accrualsOf(r1.feeId);
  const r2 = await checkNoRateException();
  const [e2] = r2.exc;
  const none = await resolveRpc(e2.id, "no_commission");
  const det2 = await determinationsOf(r2.feeId);
  ok(
    "B4B2-26 D3: a missing-rate exception resolves only to an event percentage (7.5% → £75.00) or no commission (recorded owner_no_commission, nothing accrued)",
    !zeroPct.ok &&
      !withIds.ok &&
      pct.ok &&
      acc.length === 1 &&
      acc[0].amount_pence === 7500 &&
      Number(acc[0].commission_pct) === 7.5 &&
      none.ok &&
      (await accrualsOf(r2.feeId)).length === 0 &&
      det2.some((d) => d.outcome === "owner_no_commission" && d.source_exception_id === e2.id),
    describe(zeroPct, withIds, pct, none),
  );
}
{
  const r = await checkExceptionOwnerOnly();
  ok(
    "B4B2-27 exception resolution is Owner-only in the database (Supervisor refused; exception stays open, nothing accrued)",
    r.pass,
    describe(r.sup),
  );
}
{
  const ex = await call(ff.listCommissionExceptions, { status: "all" }, U.ownerA);
  const exB = await call(ff.listCommissionExceptions, { status: "all" }, U.ownerB, SLUG.b);
  const exAdv = await call(ff.listCommissionExceptions, {}, U.advA);
  const rows = ex.value?.rows ?? [];
  ok(
    "B4B2-28 listCommissionExceptions: tenant-scoped, typed (kind, basis, economic date, recorded advisers), open and resolved; another tenant sees none; advisers are refused",
    ex.ok &&
      rows.length >= 6 &&
      rows.some((r) => r.status === "resolved") &&
      rows.some((r) => r.status === "open") &&
      rows.every((r) => String(r.economicDate).slice(0, 10) === winterDate && r.basisPence > 0) &&
      rows.some((r) => r.exceptionKind === "adviser_entitlement_unproven" && r.recordedAdviserIds.length === 4) &&
      exB.ok &&
      exB.value.rows.length === 0 &&
      !exAdv.ok,
    JSON.stringify({
      n: rows.length,
      st: [...new Set(rows.map((r) => r.status))],
      dates: [...new Set(rows.map((r) => r.economicDate))],
      basis: rows.filter((r) => !(r.basisPence > 0)).length,
      rec: rows.map((r) => r.recordedAdviserIds?.length),
      b: exB.value?.rows?.length,
      adv: describe(exAdv),
    }),
  );
}

// =============================================================================================
// INTRODUCERS — DB resolver at fee_event_at, parity with resolveIntroducerIdForCustomerAtDate
// =============================================================================================
{
  const t0 = Date.parse("2024-01-01T00:00:00Z");
  const t1 = Date.parse("2024-06-01T00:00:00Z");
  const t2 = Date.parse("2025-01-01T00:00:00Z");
  const cases = [];
  const noLink = await newCase();
  cases.push(noLink);
  const plain = await newCase();
  await link(plain.cust, "introA1", iso(t0), iso(t0));
  cases.push(plain);
  const chain = await newCase();
  await link(chain.cust, "introA3", iso(t0), iso(t2));
  await amendment(chain.cust, "introA1", "introA2", iso(t1));
  await amendment(chain.cust, "introA2", "introA3", iso(t2));
  cases.push(chain);
  const lateEff = await newCase();
  await link(lateEff.cust, "introA2", iso(t0), iso(t1));
  await amendment(lateEff.cust, "introA1", "introA2", iso(t1));
  cases.push(lateEff);
  const lateCreated = await newCase();
  await link(lateCreated.cust, "introA1", iso(t2), iso(t2));
  cases.push(lateCreated);
  const dates = [t0 - DAY, t0, t0 + DAY, t1 - 1000, t1, t1 + DAY, t2 + DAY];
  const mismatches = [];
  let compared = 0;
  let nonNull = 0;
  for (const c of cases) {
    for (const at of dates) {
      const ts = await ia.resolveIntroducerIdForCustomerAtDate(adminClient, U[c.cust], new Date(at), c.id);
      const [db] = await sql(`select public.resolve_customer_introducer_as_of($1, $2, $3) as id`, [
        T.a,
        c.id,
        iso(at),
      ]);
      compared += 1;
      if (ts) nonNull += 1;
      if ((ts ?? null) !== (db.id ?? null)) mismatches.push({ ref: c.ref, at: iso(at), ts, db: db.id });
    }
  }
  const crossTenant = await sql(`select public.resolve_customer_introducer_as_of($1, $2, $3) as id`, [
    T.b,
    plain.id,
    iso(t2),
  ]);
  ok(
    "B4B2-29 introducer parity: the DB resolver matches resolveIntroducerIdForCustomerAtDate on 35 (customer, date) comparisons — no link, plain link, amendment chain, later-effective link, link created after the date — and resolves nothing across tenants",
    compared === 35 && nonNull >= 10 && mismatches.length === 0 && crossTenant[0].id === null,
    JSON.stringify({ compared, nonNull, mismatches: mismatches.slice(0, 3) }),
  );
}
{
  const c = await newCase();
  await link(c.cust, "introA1");
  const { feeId } = await posted(c);
  const [acc] = (await accrualsOf(feeId)).filter((a) => a.beneficiary_role === "introducer");
  ok(
    "B4B2-30 introducer commission accrues at the fee date (2% of £1,000.00 = £20.00) to the introducer's user with introducer id and company snapshots",
    acc?.amount_pence === 2000 &&
      acc.introducer_id === I.introA1 &&
      acc.beneficiary_user_id === U.introU1 &&
      acc.beneficiary_name === "Intro One Ltd" &&
      acc.beneficiary_code === "1101" &&
      acc.rate_source === "rate_version" &&
      acc.ed === winterDate,
    JSON.stringify(acc && [acc.amount_pence, acc.beneficiary_name, acc.beneficiary_code]),
  );
}
{
  const r = await checkIntroducerAsOf();
  ok(
    "B4B2-31 an attribution amended after the fee date does not move the commission: the introducer attributed at the fee date earns",
    r.pass,
    JSON.stringify(r.acc),
  );
}
{
  const r = await checkIneligibleIntroducerFeeType();
  ok(
    "B4B2-32 introducers earn only on fee and mortgage_fee: an insurance fee records not_eligible_fee_type for the attributed introducer (no accrual, no exception)",
    r.pass,
    JSON.stringify(r),
  );
}
{
  const c = await newCase();
  await link(c.cust, "introA3");
  const { feeId } = await posted(c);
  const exc = (await exceptionsOf(feeId)).filter((e) => e.beneficiary_role === "introducer");
  ok(
    "B4B2-33 an attributed introducer with no rate at the fee date: the fee posts and a missing_rate exception names the introducer",
    exc.length === 1 &&
      exc[0].exception_kind === "missing_rate" &&
      exc[0].introducer_id === I.introA3 &&
      exc[0].beneficiary_user_id === U.introU3,
    JSON.stringify(exc.map((e) => e.exception_kind)),
  );
}
{
  const before = JSON.stringify(
    await Promise.all(
      ["public.customer_introducer_links", "public.introducer_amendment_history"].map((t) => rowsText(pg, t)),
    ),
  );
  const c = await newCase();
  await link(c.cust, "introA1");
  const { feeId } = await posted(c);
  await reverseRpc(feeId);
  const after = JSON.stringify(
    await Promise.all(
      ["public.customer_introducer_links", "public.introducer_amendment_history"].map((t) => rowsText(pg, t)),
    ),
  );
  const linkRows = await sql(`select count(*)::int as n from public.customer_introducer_links where customer_id = $1`, [
    U[c.cust],
  ]);
  ok(
    "B4B2-34 posting and reversal never modify attribution (links / amendment history unchanged apart from the fixture); refreshCustomerIntroducerCommission stays disabled and is not called by finance code",
    before !== after &&
      linkRows[0].n === 1 &&
      /throw new Error\(COMMISSION_REFRESH_DISABLED_MESSAGE\)/.test(read("src/lib/introducer-customer.functions.ts")) &&
      !/refreshCustomerIntroducerCommission/.test(SRC.finance) &&
      !/from\("customer_introducer_links"\)\s*\.(insert|update|upsert|delete)/.test(SRC.finance) &&
      !/(UPDATE|INSERT INTO|DELETE FROM) public\.(customer_introducer_links|introducer_amendment_history)/.test(b4b2Sql),
  );
}

// =============================================================================================
// RATES — B4a resolver at fee_event_at
// =============================================================================================
{
  const r = await checkRateAsOf();
  ok(
    "B4B2-35 the rate is the B4a version in force at the fee date (10%), not a later version (20%); the accrual references that version",
    r.pass,
    JSON.stringify(r.acc),
  );
}
{
  const r = await checkNoRateException();
  ok(
    "B4B2-36 no rate at the fee date: the fee posts, a missing_rate exception is raised for the adviser and recorded as a determination",
    r.pass,
    JSON.stringify(r.det),
  );
}
{
  const c = await newCase();
  await assign(c.id, "advZero", "adviser");
  const { feeId } = await posted(c);
  const det = await determinationsOf(feeId);
  const z = det.find((d) => d.beneficiary_user_id === U.advZero);
  ok(
    "B4B2-37 an explicit 0% rate records explicit_zero evidence (rate version, 0%, £0) and creates no accrual and no exception",
    (await accrualsOf(feeId)).length === 0 &&
      (await exceptionsOf(feeId)).length === 0 &&
      z?.outcome === "explicit_zero" &&
      Number(z.commission_pct) === 0 &&
      z.amount_pence === 0 &&
      z.rate_source === "rate_version" &&
      Boolean(z.rate_version_id),
    JSON.stringify(z && [z.outcome, z.commission_pct, z.amount_pence]),
  );
}
{
  const c1 = await newCase();
  await assign(c1.id, "advRound", "adviser");
  const { feeId: f1 } = await posted(c1, 12.35);
  const c2 = await newCase();
  await assign(c2.id, "advA", "adviser");
  const { feeId: f2 } = await posted(c2, 0.04);
  const [a1] = await accrualsOf(f1);
  const d2 = await determinationsOf(f2);
  ok(
    "B4B2-38 rounding: 2.5% of £12.35 accrues 31p (half-up on 30.875p); 10% of £0.04 rounds to zero — recorded as rounded_to_zero, nothing accrued",
    a1?.amount_pence === 31 &&
      (await accrualsOf(f2)).length === 0 &&
      d2.some((d) => d.outcome === "rounded_to_zero" && d.amount_pence === 0 && Number(d.commission_pct) === 10),
    JSON.stringify([a1?.amount_pence, d2.map((d) => d.outcome)]),
  );
}

// =============================================================================================
// LEDGER AND AUDIT
// =============================================================================================
{
  const r = await checkLedgerImmutable();
  ok(
    "B4B2-39 the ledger is append-only: UPDATE (with or without the writer marker), DELETE and TRUNCATE are refused, even for the superuser",
    r.pass,
    describe(r.upd, r.del),
  );
}
{
  const r = await checkLedgerTenantFk();
  ok(
    "B4B2-40 tenant safety: a ledger row pointing at another tenant's session / fee line is rejected by the composite FKs (23503) even with the guard disabled",
    r.pass,
    describe(r.r),
  );
}
{
  const c = await newCase();
  await assign(c.id, "advA2", "adviser");
  const { feeId } = await posted(c);
  const delFee = await probe([[`delete from public.finance_fee_lines where id = $1`, [feeId]]]);
  const delSession = await probe([[`delete from public.interview_sessions where id = $1`, [c.id]]]);
  const delUser = await probe([[`delete from auth.users where id = $1`, [U.advA2]]]);
  ok(
    "B4B2-41 RESTRICT: a posted fee line, its case and a beneficiary's Auth user cannot be deleted while ledger rows reference them",
    !delFee.ok && !delSession.ok && !delUser.ok && ["23001", "23503"].includes(delUser.code),
    describe(delFee, delSession, delUser),
  );
}
{
  const c = await newCase();
  await assign(c.id, "advA3", "adviser");
  const { feeId } = await posted(c);
  await fx(`update public.profiles set full_name = 'Renamed Adviser' where id = $1`, [U.advA3]);
  await fx(`update public.advisor_profiles set code = 'NEWCODE' where user_id = $1`, [U.advA3]);
  const [acc] = await accrualsOf(feeId);
  const list = await call(ff.listCommissionPayouts, { sessionId: c.id }, U.ownerA);
  const row = list.value?.rows?.find((r) => r.id === acc.id);
  await fx(`update public.profiles set full_name = 'advA3 Person' where id = $1`, [U.advA3]);
  await fx(`update public.advisor_profiles set code = 'ADVA3' where user_id = $1`, [U.advA3]);
  ok(
    "B4B2-42 beneficiary snapshots persist: renaming the adviser or changing their code later does not change the ledger row or the payout queue's code",
    acc.beneficiary_name === "advA3 Person" &&
      acc.beneficiary_code === "ADVA3" &&
      row?.beneficiaryCode === "ADVA3",
    JSON.stringify([acc.beneficiary_name, row?.beneficiaryCode]),
  );
}
{
  const r = await checkAuditImmutable();
  ok(
    "B4B2-43 the finance audit log is immutable: UPDATE and DELETE refused for service_role and the superuser",
    r.pass,
    describe(r.updSuper),
  );
}

// =============================================================================================
// PAYOUT STATUS — transition history, paid terminal, Owner/Supervisor only
// =============================================================================================
{
  const c = await newCase();
  await assign(c.id, "advA", "adviser");
  const { feeId } = await posted(c);
  const [acc] = await accrualsOf(feeId);
  const s1 = await call(
    ff.updateSessionCommissionPayoutStatus,
    { sessionId: c.id, ledgerId: acc.id, payoutStatus: "rejected" },
    U.supA,
  );
  const s2 = await call(
    ff.updateCommissionPayoutStatus,
    { ledgerId: acc.id, payoutStatus: "received", payoutNote: "Network paid after all" },
    U.ownerA,
  );
  const s3 = await call(ff.updateCommissionPayoutStatus, { ledgerId: acc.id, payoutStatus: "paid" }, U.supA);
  const tr = await transitionsOf(acc.id);
  const [after] = await ledger(`id = $1`, [acc.id]);
  ok(
    "B4B2-44 payout transitions are recorded with actor, role and reason: received → rejected → received (reason) → paid; the accrual carries payout_at/by",
    s1.ok &&
      s2.ok &&
      s3.ok &&
      tr.map((t) => `${t.from_status ?? "-"}>${t.to_status}`).join(",") ===
        "->received,received>rejected,rejected>received,received>paid" &&
      tr[1].actor_role === "supervisor" &&
      tr[2].reason === "Network paid after all" &&
      after.payout_status === "paid" &&
      after.payout_by === U.supA &&
      Boolean(after.payout_at),
    describe(s1, s2, s3),
  );
}
{
  const r = await checkPaidTerminal();
  ok("B4B2-45 paid is terminal: no move back to received or to rejected", r.pass, describe(r.back, r.rej));
}
{
  const r = await checkPayoutAuthority();
  const c = await newCase();
  await assign(c.id, "advA", "adviser");
  const { feeId } = await posted(c);
  const [acc] = await accrualsOf(feeId);
  const ts = await call(ff.updateCommissionPayoutStatus, { ledgerId: acc.id, payoutStatus: "paid" }, U.genA);
  ok(
    "B4B2-46 D6: payout decisions are Owner/Supervisor only — General (even with finance permissions) and advisers are refused in the server function and the database",
    r.pass && !ts.ok && (await ledger(`id = $1`, [acc.id]))[0].payout_status === "received",
    describe(r.gen, ts),
  );
}
{
  const r = await checkReopenReason();
  ok("B4B2-47 D5: rejected → received requires a reason (refused without; recorded with)", r.pass, describe(r.bare));
}
{
  const c = await newCase();
  await assign(c.id, "advA", "adviser");
  const { feeId, fp } = await posted(c);
  const [acc] = await accrualsOf(feeId);
  const onFee = await payoutRpc(fp.id, "paid");
  const direct = await svcTx([
    MARKER,
    [`update public.finance_ledger set payout_status = 'paid', payout_at = now() where id = $1`, [acc.id]],
  ]);
  const tsFee = await call(
    ff.updateSessionCommissionPayoutStatus,
    { sessionId: c.id, ledgerId: fp.id, payoutStatus: "paid" },
    U.ownerA,
  );
  ok(
    "B4B2-48 payout status applies only to commission accruals and only through the RPC: a fee event is refused; a direct status update without a transition row is refused",
    !onFee.ok && !direct.ok && !tsFee.ok && (await ledger(`id = $1`, [acc.id]))[0].payout_status === "received",
    describe(onFee, direct, tsFee),
  );
}

// =============================================================================================
// ADJUSTMENTS — reversal, correction, reassignment (Owner only)
// =============================================================================================
{
  const s = await reversalScenario();
  const introExc = (await exceptionsOf(s.feeId)).find((e) => e.beneficiary_role === "introducer");
  const r = await call(ff.amendPostedFee, { action: "reverse", lineId: s.feeId, reason: "Network clawed the fee" }, U.ownerA);
  const f = await feeOf(s.feeId);
  const [fr] = await ledger(`fee_line_id = $1 and event_type = 'fee_reversed'`, [s.feeId]);
  const [rec] = await ledger(`id = $1`, [s.received.id]);
  const [rej] = await ledger(`id = $1`, [s.rejected.id]);
  const [paid] = await ledger(`id = $1`, [s.paid.id]);
  const cancels = await ledger(`original_event_id = any($1::uuid[])`, [[s.received.id, s.rejected.id, s.paid.id]]);
  const [excAfter] = await sql(`select * from public.finance_commission_exceptions where id = $1`, [introExc.id]);
  ok(
    "B4B2-49 Owner reversal: fee_reversed (−£1,000.00, reason, economic date of the fee); unpaid commission reversed (status reversed + commission_reversed); rejected commission preserved; paid commission clawed back (due); open exceptions closed as fee_reversed; fee line shows Reversed",
    r.ok &&
      f.st === "amended" &&
      f.reversal_reason === "Network clawed the fee" &&
      f.reversed_by === U.ownerA &&
      fr?.amount_pence === -100000 &&
      fr.original_event_id === s.fp.id &&
      fr.ed === winterDate &&
      fr.reason === "Network clawed the fee" &&
      rec.payout_status === "reversed" &&
      rej.payout_status === "rejected" &&
      paid.payout_status === "paid" &&
      cancels.length === 2 &&
      cancels.some((x) => x.event_type === "commission_reversed" && x.original_event_id === s.received.id && x.amount_pence === -10000) &&
      cancels.some((x) => x.event_type === "clawback" && x.original_event_id === s.paid.id && x.recovery_status === "due") &&
      excAfter.status === "resolved" &&
      excAfter.resolution === "fee_reversed" &&
      (await transitionsOf(s.received.id)).at(-1)?.to_status === "reversed",
    describe(r),
  );
}
{
  const c = await newCase();
  const { feeId } = await posted(c);
  const blank = await reverseRpc(feeId, U.ownerA, "   ");
  const tsBlank = await call(ff.amendPostedFee, { action: "reverse", lineId: feeId, reason: "" }, U.ownerA);
  const tsSup = await call(ff.amendPostedFee, { action: "reverse", lineId: feeId, reason: "x" }, U.supA);
  const o = await checkReversalOwnerOnly();
  const first = await reverseRpc(feeId);
  const second = await reverseRpc(feeId);
  ok(
    "B4B2-50 reversal needs a reason, is Owner-only (Supervisor/General refused in TS and DB) and cannot be repeated",
    !blank.ok &&
      /finance_reason_required/.test(blank.message) &&
      !tsBlank.ok &&
      !tsSup.ok &&
      o.pass &&
      first.ok &&
      !second.ok &&
      (await countOf(pg, "public.finance_ledger", "fee_line_id = $1 and event_type = 'fee_reversed'", [feeId])) === 1,
    describe(blank, tsSup, o.sup, second),
  );
}
{
  const r = await checkCorrectionInheritsDate();
  const acc = r.newId ? await accrualsOf(r.newId) : [];
  const again = await svc(`select * from public.post_fee_correction($1, $2, $3, $4, $5, $6)`, [
    T.a,
    U.ownerA,
    r.orig.id,
    50000,
    "again",
    "again",
  ]);
  const c = await newCase();
  const { feeId: live } = await posted(c);
  const notReversed = await svc(`select * from public.post_fee_correction($1, $2, $3, $4, $5, $6)`, [
    T.a,
    U.ownerA,
    live,
    50000,
    "x",
    "y",
  ]);
  const tsSup = await call(
    ff.amendPostedFee,
    { action: "correct", lineId: r.orig.id, amountPounds: 500, reason: "x", evidence: "y" },
    U.supA,
  );
  const tsNoEvidence = await call(
    ff.amendPostedFee,
    { action: "correct", lineId: r.orig.id, amountPounds: 500, reason: "x", evidence: " " },
    U.ownerA,
  );
  ok(
    "B4B2-51 D4 correction is a new posted event inheriting the reversed fee's economic date and evidence (plus the Owner's correction evidence); commission re-accrues at that date; one correction per reversal; only reversed fees; Owner-only; evidence required",
    r.pass &&
      acc.length === 1 &&
      acc[0].amount_pence === 9000 &&
      acc[0].ed === r.orig.event_date &&
      !again.ok &&
      !notReversed.ok &&
      !tsSup.ok &&
      !tsNoEvidence.ok,
    describe(r.corr, again, notReversed, tsSup),
  );
}
{
  const c = await newCase();
  await link(c.cust, "introA1");
  const { feeId } = await posted(c);
  const [acc] = (await accrualsOf(feeId)).filter((a) => a.beneficiary_role === "introducer");
  const tsSup = await call(
    ff.reassignIntroducerCommission,
    { ledgerId: acc.id, introducerCode: "1102", reason: "Wrong introducer" },
    U.supA,
  );
  const r = await call(
    ff.reassignIntroducerCommission,
    { ledgerId: acc.id, introducerCode: "1102", reason: "Wrong introducer" },
    U.ownerA,
  );
  const [orig] = await ledger(`id = $1`, [acc.id]);
  const [cancel] = await ledger(`original_event_id = $1`, [acc.id]);
  const repl = (await accrualsOf(feeId)).find((a) => a.introducer_id === I.introA2);
  const back = await svc(`select * from public.reassign_introducer_commission($1, $2, $3, $4, $5)`, [
    T.a,
    U.ownerA,
    repl?.id,
    I.introA1,
    "back",
  ]);
  ok(
    "B4B2-52 Owner reassigns unpaid introducer commission: the original is cancelled (commission_reassigned −£20.00, status reversed) and the new introducer accrues at their own rate at the fee date (3% → £30.00); Supervisor refused; reassigning back to an introducer already paid on this fee is refused",
    !tsSup.ok &&
      r.ok &&
      orig.payout_status === "reversed" &&
      cancel?.event_type === "commission_reassigned" &&
      cancel.amount_pence === -2000 &&
      repl?.amount_pence === 3000 &&
      repl.ed === winterDate &&
      repl.beneficiary_user_id === U.introU2 &&
      !back.ok,
    describe(tsSup, r, back),
  );
}
{
  const c = await newCase();
  await link(c.cust, "introA1");
  await assign(c.id, "advA", "adviser");
  const { feeId } = await posted(c);
  const acc = await accrualsOf(feeId);
  const intro = acc.find((a) => a.beneficiary_role === "introducer");
  const adv = acc.find((a) => a.beneficiary_role === "advisor");
  const advR = await svc(`select * from public.reassign_introducer_commission($1, $2, $3, $4, $5)`, [
    T.a,
    U.ownerA,
    adv.id,
    I.introA2,
    "x",
  ]);
  const same = await svc(`select * from public.reassign_introducer_commission($1, $2, $3, $4, $5)`, [
    T.a,
    U.ownerA,
    intro.id,
    I.introA1,
    "x",
  ]);
  const toUnrated = await svc(`select * from public.reassign_introducer_commission($1, $2, $3, $4, $5)`, [
    T.a,
    U.ownerA,
    intro.id,
    I.introA3,
    "Correct introducer has no rate yet",
  ]);
  const exc = (await exceptionsOf(feeId)).filter((e) => e.introducer_id === I.introA3);
  const c2 = await newCase();
  await link(c2.cust, "introA1");
  const { feeId: f2 } = await posted(c2);
  const [i2] = (await accrualsOf(f2)).filter((a) => a.beneficiary_role === "introducer");
  await payoutRpc(i2.id, "paid");
  const paidR = await svc(`select * from public.reassign_introducer_commission($1, $2, $3, $4, $5)`, [
    T.a,
    U.ownerA,
    i2.id,
    I.introA2,
    "x",
  ]);
  ok(
    "B4B2-53 reassignment rules: only introducer accruals; not to the same introducer; not once paid (use a clawback); to an introducer with no rate → the original is cancelled and a missing_rate exception is raised",
    !advR.ok &&
      !same.ok &&
      toUnrated.ok &&
      toUnrated.rows[0].outcome === "exception" &&
      Boolean(toUnrated.rows[0].exception_id) &&
      exc.length === 1 &&
      !paidR.ok,
    describe(advR, same, toUnrated, paidR),
  );
}
{
  const c = await newCase();
  await link(c.cust, "introA1");
  const { feeId } = await posted(c);
  const [intro] = (await accrualsOf(feeId)).filter((a) => a.beneficiary_role === "introducer");
  await reverseRpc(feeId);
  const r = await svc(`select * from public.reassign_introducer_commission($1, $2, $3, $4, $5)`, [
    T.a,
    U.ownerA,
    intro.id,
    I.introA2,
    "x",
  ]);
  ok(
    "B4B2-54 commission on a reversed fee cannot be reassigned or clawed back again",
    !r.ok && !(await clawRpc(intro.id)).ok,
    describe(r),
  );
}

// =============================================================================================
// CLAWBACKS
// =============================================================================================
{
  const c = await newCase();
  await link(c.cust, "introA1");
  const { feeId } = await posted(c);
  const [intro] = (await accrualsOf(feeId)).filter((a) => a.beneficiary_role === "introducer");
  const unpaid = await call(ff.clawBackCommission, { ledgerId: intro.id, reason: "x" }, U.ownerA);
  await payoutRpc(intro.id, "paid");
  const tsSup = await call(ff.clawBackCommission, { ledgerId: intro.id, reason: "x" }, U.supA);
  const r = await call(
    ff.clawBackCommission,
    { ledgerId: intro.id, reason: "Paid the wrong introducer", replacementIntroducerCode: "1102" },
    U.ownerA,
  );
  const [cb] = await ledger(`original_event_id = $1 and event_type = 'clawback'`, [intro.id]);
  const repl = (await accrualsOf(feeId)).find((a) => a.introducer_id === I.introA2);
  const [orig] = await ledger(`id = $1`, [intro.id]);
  ok(
    "B4B2-55 Owner claws back paid commission (−£20.00, due, reason) with an optional replacement introducer accruing at the fee date (£30.00); unpaid commission cannot be clawed back; Supervisor refused; the paid row stays paid",
    !unpaid.ok &&
      !tsSup.ok &&
      r.ok &&
      cb?.amount_pence === -2000 &&
      cb.recovery_status === "due" &&
      cb.reason === "Paid the wrong introducer" &&
      cb.beneficiary_user_id === U.introU1 &&
      repl?.amount_pence === 3000 &&
      repl.ed === winterDate &&
      orig.payout_status === "paid",
    describe(unpaid, tsSup, r),
  );
}
{
  const r = await checkClawbackOnce();
  const p = await paidAccrual();
  const cb = await clawRpc(p.acc.id);
  const rv = await reverseRpc(p.feeId);
  const n = await countOf(pg, "public.finance_ledger", "original_event_id = $1 and event_type = 'clawback'", [p.acc.id]);
  ok(
    "B4B2-56 a paid commission is clawed back at most once: a second clawback is refused and a later fee reversal does not claw it back again",
    r.pass && cb.ok && rv.ok && n === 1,
    describe(r.second, rv),
  );
}
{
  const o = await checkSettleOwnerOnly();
  const a = await paidAccrual();
  const cbA = (await clawRpc(a.acc.id)).rows[0].clawback_event_id;
  const tsSettle = await call(
    ff.settleCommissionClawback,
    { ledgerId: cbA, outcome: "settled", reason: "Deducted from next payment" },
    U.ownerA,
  );
  const again = await settleRpc(cbA, "written_off");
  const b = await paidAccrual();
  const cbB = (await clawRpc(b.acc.id)).rows[0].clawback_event_id;
  const wo = await settleRpc(cbB, "written_off", U.ownerA, "Uneconomic to recover");
  const [sa] = await ledger(`id = $1`, [cbA]);
  const [sb] = await ledger(`id = $1`, [cbB]);
  const evA = await ledger(`original_event_id = $1`, [cbA]);
  const evB = await ledger(`original_event_id = $1`, [cbB]);
  ok(
    "B4B2-57 Owner settles (clawback_settled) or writes off (clawback_written_off) a due clawback once, with a reason and a recovery transition; Supervisor refused",
    o.pass &&
      tsSettle.ok &&
      !again.ok &&
      wo.ok &&
      sa.recovery_status === "settled" &&
      sb.recovery_status === "written_off" &&
      evA.length === 1 &&
      evA[0].event_type === "clawback_settled" &&
      evA[0].amount_pence === 0 &&
      evB[0]?.event_type === "clawback_written_off" &&
      (await transitionsOf(cbA)).map((t) => `${t.from_status ?? "-"}>${t.to_status}`).join(",") === "->due,due>settled",
    describe(o.sup, tsSettle, again, wo),
  );
}

// =============================================================================================
// RAF — no undated ledger accrual (B4c); bonus status is the RAF record; payouts Owner/Supervisor
// =============================================================================================
async function rafSetup() {
  await insertRow(pg, "public.finance_settings", { key: "raf_bonus_pence", num_value: 5000, tenant_id: T.a });
  await insertRow(pg, "public.admin_permissions", {
    user_id: U.genA,
    permission_key: "finance_raf",
    access: "amend",
    tenant_id: T.a,
  });
}
await rafSetup();
const rafCode = randomUUID();
await insertRow(pg, "public.referral_codes", {
  id: rafCode,
  code: "RAFA1",
  referrer_user_id: U.custA,
  referrer_name: "Referrer Alpha",
  tenant_id: T.a,
});
async function newReferral(tenantId = T.a, codeId = null, referrer = U.custA) {
  const id = randomUUID();
  await insertRow(pg, "public.referrals", {
    id,
    referral_code_id: codeId,
    code: codeId ? "RAFA1" : null,
    referrer_user_id: referrer,
    referred_email: `friend-${id.slice(0, 6)}@example.invalid`,
    status: "qualified",
    tenant_id: tenantId,
  });
  return id;
}
const rafRows = (id) => ledger(`referral_id = $1`, [id]);
const bonusOf = async (id) => (await sql(`select bonus_status from public.referrals where id = $1`, [id]))[0].bonus_status;
async function checkRafPayoutAuthority(mod = rf) {
  const id = await newReferral();
  const gEl = await call(mod.updateReferralBonusStatus, { id, bonusStatus: "eligible" }, U.genA);
  const gPaid = await call(mod.updateReferralBonusStatus, { id, bonusStatus: "paid" }, U.genA);
  const gRej = await call(mod.updateReferralBonusStatus, { id, bonusStatus: "rejected" }, U.genA);
  const mid = await bonusOf(id);
  const sPaid = await call(mod.updateReferralBonusStatus, { id, bonusStatus: "paid" }, U.supA);
  return {
    gPaid,
    mid,
    pass: gEl.ok && !gPaid.ok && !gRej.ok && mid === "eligible" && sPaid.ok && (await bonusOf(id)) === "paid" && (await rafRows(id)).length === 0,
  };
}
async function checkRafPaidTerminal(mod = rf) {
  const id = await newReferral();
  await call(mod.updateReferralBonusStatus, { id, bonusStatus: "eligible" }, U.ownerA);
  const paid = await call(mod.updateReferralBonusStatus, { id, bonusStatus: "paid" }, U.ownerA);
  const back = await call(mod.updateReferralBonusStatus, { id, bonusStatus: "eligible", notes: "Undo" }, U.ownerA);
  const rej = await call(mod.updateReferralBonusStatus, { id, bonusStatus: "rejected", notes: "Undo" }, U.supA);
  const none = await call(mod.updateReferralBonusStatus, { id, bonusStatus: "none" }, U.ownerA);
  const bonus = await bonusOf(id);
  return {
    back,
    bonus,
    pass: paid.ok && !back.ok && !rej.ok && !none.ok && bonus === "paid" && (await rafRows(id)).length === 0,
  };
}
async function checkRafUndatedAccrual() {
  const id = await newReferral();
  const insert = (key) => [
    `insert into public.finance_ledger (tenant_id, event_type, kind, idempotency_key, fee_type,
       amount_pence, is_reversal, beneficiary_user_id, beneficiary_role, referral_id, payout_status,
       created_by, actor_role, evidence, note)
     values ($1, 'commission_accrued', 'commission', $2, 'fee', 5000, false, $3, 'referrer', $4,
       'received', $5, 'owner', '{}'::jsonb, 'RAF bonus') returning id`,
    [T.a, key, U.custA, id, U.ownerA],
  ];
  const ins = await svcTx([MARKER, insert("-")]);
  const forced = await probe([[`set local session_replication_role = replica`], insert(`raf:${id}`)]);
  const rows = await rafRows(id);
  return {
    ins,
    forced,
    rows,
    pass:
      !ins.ok &&
      /finance_raf_accrual_deferred/.test(ins.message) &&
      !forced.ok &&
      forced.code === "23514" &&
      rows.length === 0,
  };
}
{
  const id = await newReferral(T.a, rafCode);
  const e1 = await call(rf.updateReferralBonusStatus, { id, bonusStatus: "eligible" }, U.ownerA);
  const e2 = await call(rf.updateReferralBonusStatus, { id, bonusStatus: "eligible", notes: "again" }, U.ownerA);
  const rows = await rafRows(id);
  const audit = await countOf(pg, "public.finance_audit_log", "detail->>'referral_id' = $1", [id]);
  const midBonus = await bonusOf(id);
  const none = await call(rf.updateReferralBonusStatus, { id, bonusStatus: "none" }, U.ownerA);
  ok(
    "B4B2-58 H2 RAF eligible records the non-payable pending state on the referral only: no ledger accrual, transition or financial audit is created (no RAF economic date exists before B4c); repeating is harmless; an unpaid bonus can return to none",
    e1.ok && e2.ok && rows.length === 0 && audit === 0 && midBonus === "eligible" && none.ok && (await bonusOf(id)) === "none",
    describe(e1, e2, none),
  );
}
{
  const a = await checkRafPayoutAuthority();
  const t = await checkRafPaidTerminal();
  ok(
    "B4B2-59 H2 D6 for RAF: General with finance_raf=amend may mark eligible but not paid or rejected; Supervisor marks paid; paid is final (no reopen, reject or reset by Owner or Supervisor); no ledger row at any step",
    a.pass && t.pass,
    describe(a.gPaid, t.back),
  );
}
{
  const id = await newReferral();
  await call(rf.updateReferralBonusStatus, { id, bonusStatus: "eligible" }, U.ownerA);
  const rej = await call(rf.updateReferralBonusStatus, { id, bonusStatus: "rejected" }, U.ownerA);
  const midBonus = await bonusOf(id);
  const bare = await call(rf.updateReferralBonusStatus, { id, bonusStatus: "eligible" }, U.ownerA);
  const gen = await call(rf.updateReferralBonusStatus, { id, bonusStatus: "eligible", notes: "General reopen" }, U.genA);
  const withReason = await call(
    rf.updateReferralBonusStatus,
    { id, bonusStatus: "eligible", notes: "Friend completed after all" },
    U.ownerA,
  );
  ok(
    "B4B2-60 H2 RAF reopen: rejected → eligible needs an Owner/Supervisor and a reason (refused without a reason and for General); with one the bonus returns to eligible with no ledger row",
    rej.ok && midBonus === "rejected" && !bare.ok && !gen.ok && withReason.ok && (await bonusOf(id)) === "eligible" && (await rafRows(id)).length === 0,
    describe(rej, bare, gen, withReason),
  );
}
{
  const idB = await newReferral(T.b, null, U.custB);
  const notConfigured = await call(rf.updateReferralBonusStatus, { id: idB, bonusStatus: "eligible" }, U.ownerB, SLUG.b);
  const u = await checkRafUndatedAccrual();
  const fnGone = (await sql(`select count(*)::int as n from pg_proc where proname = 'accrue_raf_commission'`))[0].n === 0;
  const cap = await svcTx([MARKER, [`select public.finance_actor_role($1, $2, 'raf_accrue')`, [T.a, U.ownerA]]]);
  ok(
    "B4B2-61 H2 no undated payable RAF event: an unconfigured tenant cannot mark eligible (status unchanged); a direct undated referrer accrual is refused by the ledger guard (finance_raf_accrual_deferred) and by the dated-accrual check when the guard is bypassed (23514); accrue_raf_commission and the raf_accrue capability do not exist",
    !notConfigured.ok && (await bonusOf(idB)) === "none" && u.pass && fnGone && !cap.ok,
    describe(notConfigured, u.ins, u.forced, cap),
  );
}

// =============================================================================================
// READERS — pure, tenant-scoped, typed; Owner export
// =============================================================================================
{
  const q = await checkPayoutQueue();
  ok(
    "B4B2-62 the payout queue lists only commission accruals (reversed shown as reversed), with clawbacks listed separately",
    q.typed,
    JSON.stringify({ n: q.rowsA.length, st: q.rowsA.map((r) => r.payoutStatus), cb: q.listA.value?.clawbacks?.length }),
  );
  ok(
    "B4B2-63 readers are tenant-scoped: another tenant's Owner sees none of this tenant's accruals",
    q.tenantSafe,
    describe(q.listB),
  );
  const sc = await call(ff.listSessionCommissions, { sessionId: q.s.c.id }, U.ownerA);
  const mine = await call(ff.listMyCommissionStatement, {}, U.advA);
  const mineIds = new Set(
    (await ledger(`beneficiary_user_id = $1 and event_type = 'commission_accrued' and tenant_id = $2`, [U.advA, T.a])).map(
      (g) => g.id,
    ),
  );
  ok(
    "B4B2-64 session commissions and an adviser's own statement are typed and scoped: accruals only, clawbacks separate, the adviser sees only their own rows",
    sc.ok &&
      sc.value.rows.length === 3 &&
      sc.value.clawbacks.length === 1 &&
      mine.ok &&
      mine.value.rows.length > 0 &&
      mine.value.rows.every((r) => mineIds.has(r.id)),
    describe(sc, mine),
  );
}
{
  const READ_ONLY_RPCS = ["is_tenant_feature_enabled"];
  const snap = await finSnap();
  const writes = writeLog.length;
  const rpcs = rpcLog.length;
  const c = (await sql(`select id from public.interview_sessions where case_ref like 'MG-B4B2-%' order by case_ref limit 1`))[0];
  const reads = await Promise.all([
    call(ff.listSessionCommissions, { sessionId: c.id }, U.ownerA),
    call(ff.listSessionFees, { sessionId: c.id }, U.ownerA),
    call(ff.listCommissionPayouts, {}, U.ownerA),
    call(ff.listMyCommissionStatement, {}, U.advA),
    call(ff.listCommissionExceptions, { status: "all" }, U.ownerA),
    call(ff.listFinanceLedger, undefined, U.ownerA),
    call(ff.listRafCommissionHighlights, undefined, U.ownerA),
    call(sf.exportOwnerCustomerReport, undefined, U.ownerA),
  ]);
  ok(
    "B4B2-65 finance reads are pure: eight readers write nothing and call no writing RPC (only the read-only feature-flag check)",
    reads.every((r) => r.ok) &&
      writeLog.length === writes &&
      rpcLog.slice(rpcs).every((r) => READ_ONLY_RPCS.includes(r)) &&
      (await finSnap()) === snap,
    JSON.stringify({ w: writeLog.slice(writes), r: rpcLog.slice(rpcs), same: (await finSnap()) === snap }),
  );
}
{
  const c = await newCase();
  await assign(c.id, "advE", "adviser");
  const { feeId } = await posted(c, 100);
  const [acc] = await accrualsOf(feeId);
  await payoutRpc(acc.id, "paid");
  await reverseRpc(feeId, U.ownerA, "Network reversed");
  const corr = await svc(`select * from public.post_fee_correction($1, $2, $3, $4, $5, $6)`, [
    T.a,
    U.ownerA,
    feeId,
    8000,
    "Correct amount",
    "Statement note",
  ]);
  const ex = await call(sf.exportOwnerCustomerReport, undefined, U.ownerA);
  const row = ex.value?.rows?.find((r) => r.customerId === U[c.cust]);
  const exSup = await call(sf.exportOwnerCustomerReport, undefined, U.supA);
  const exB = await call(sf.exportOwnerCustomerReport, undefined, U.ownerB, SLUG.b);
  ok(
    "B4B2-66 Owner export nets correctly: £100 posted, adviser paid £10, fee reversed (clawback due), corrected to £80 → fees £80.00, adviser commission £8.00, pending £8.00, paid £10.00 (the original payment); Owner only; tenant-scoped",
    corr.ok &&
      row?.totalFeesGbp === "80.00" &&
      row.advisorCommissionGbp === "8.00" &&
      row.pendingCommissionGbp === "8.00" &&
      row.paidCommissionGbp === "10.00" &&
      row.introducerCommissionGbp === "0.00" &&
      !exSup.ok &&
      exB.ok &&
      !exB.value.rows.some((r) => r.customerId === U[c.cust]),
    JSON.stringify(row ?? describe(ex, corr)),
  );
}
{
  const types = (await sql(`select distinct audit_type from public.finance_audit_log`)).map((r) => r.audit_type);
  const need = [
    "fee_posted",
    "fee_reversed",
    "fee_correction_posted",
    "commission_accrued",
    "commission_not_accrued",
    "commission_exception_raised",
    "commission_exception_resolved",
    "payout_status_changed",
    "clawback_settled",
    "clawback_written_off",
  ];
  const tenantless = await countOf(pg, "public.finance_audit_log", "tenant_id is null");
  ok(
    "B4B2-67 every financial operation is audited (posting, reversal, correction, accrual / non-accrual, exceptions raised / resolved, payout changes, clawback settlement / write-off), each tenant-stamped",
    need.every((t) => types.includes(t)) && tenantless === 0,
    JSON.stringify(need.filter((t) => !types.includes(t))),
  );
}

// =============================================================================================
// HARDENING — H1 a correction never revives an earlier commission outcome; H2 RAF legacy; H3 the
// correction fee-line guard
// =============================================================================================
const corrRpc = (
  feeId,
  pence = 90000,
  actor = U.ownerA,
  reason = "Network corrected the amount",
  evidence = "Network email 2026-01-20",
  tenant = T.a,
) =>
  svc(`select * from public.post_fee_correction($1, $2, $3, $4, $5, $6)`, [
    tenant,
    actor,
    feeId,
    pence,
    reason,
    evidence,
  ]);
const corrIdOf = (r) => r?.rows?.[0]?.fee_line_id ?? null;
const heldOf = async (feeId) =>
  feeId ? (await exceptionsOf(feeId)).filter((e) => e.exception_kind === "prior_commission_held") : [];
const accFor = async (feeId, userKey) =>
  feeId ? (await accrualsOf(feeId)).filter((a) => a.beneficiary_user_id === U[userKey]) : [];
const correctionsOf = (feeId) =>
  countOf(pg, "public.finance_fee_lines", "corrects_fee_line_id = $1", [feeId]);
const historyOf = async (eventId, feeId) =>
  JSON.stringify([
    await sql(
      `select g::text as t from public.finance_ledger g
       where g.id = $1 or g.original_event_id = $1 order by g.id`,
      [eventId],
    ),
    await sql(
      `select t::text as t from public.finance_payout_transitions t
       where ledger_event_id = $1 order by recorded_at, id`,
      [eventId],
    ),
    await sql(
      `select d::text as t from public.finance_commission_determinations d
       where fee_line_id = $1 order by id`,
      [feeId],
    ),
  ]);
/** One fee for advA (10%) and introA1 (2%): £100.00 and £20.00 accrued. */
async function h1Case() {
  const c = await newCase();
  await assign(c.id, "advA", "adviser");
  await link(c.cust, "introA1");
  const { feeId, fp } = await posted(c);
  const acc = await accrualsOf(feeId);
  return {
    c,
    feeId,
    fp,
    adv: acc.find((a) => a.beneficiary_role === "advisor"),
    intro: acc.find((a) => a.beneficiary_role === "introducer"),
  };
}
async function checkH1Unpaid() {
  const s = await h1Case();
  const rv = await reverseRpc(s.feeId);
  const [rev] = await ledger(`original_event_id = $1 and event_type = 'commission_reversed'`, [s.adv.id]);
  const corr = await corrRpc(s.feeId);
  const id = corrIdOf(corr);
  const adv = await accFor(id, "advA");
  const intro = id ? (await accrualsOf(id)).filter((a) => a.beneficiary_role === "introducer") : [];
  const [orig] = await ledger(`id = $1`, [s.adv.id]);
  return {
    corr,
    adv,
    pass:
      rv.ok &&
      rev?.evidence?.cause === "fee_reversed" &&
      corr.ok &&
      adv.length === 1 &&
      adv[0].amount_pence === 9000 &&
      adv[0].rate_source === "rate_version" &&
      adv[0].eat_text === s.fp.eat_text &&
      intro.length === 1 &&
      intro[0].amount_pence === 1800 &&
      (await heldOf(id)).length === 0 &&
      orig.payout_status === "reversed",
  };
}
async function checkH1Paid() {
  const s = await h1Case();
  const paid = await payoutRpc(s.adv.id, "paid");
  const trBefore = JSON.stringify(await transitionsOf(s.adv.id));
  const rv = await reverseRpc(s.feeId);
  const claws = await ledger(`original_event_id = $1 and event_type = 'clawback'`, [s.adv.id]);
  const corr = await corrRpc(s.feeId);
  const id = corrIdOf(corr);
  const adv = await accFor(id, "advA");
  const [orig] = await ledger(`id = $1`, [s.adv.id]);
  const [net] = await sql(
    `select coalesce(sum(amount_pence), 0)::int as n from public.finance_ledger
     where session_id = $1 and beneficiary_user_id = $2
       and ((event_type = 'commission_accrued' and payout_status in ('received', 'paid'))
         or event_type = 'clawback')`,
    [s.c.id, U.advA],
  );
  return {
    corr,
    adv,
    net: net.n,
    pass:
      paid.ok &&
      rv.ok &&
      claws.length === 1 &&
      claws[0].evidence?.cause === "fee_reversed" &&
      corr.ok &&
      adv.length === 1 &&
      adv[0].amount_pence === 9000 &&
      (await heldOf(id)).length === 0 &&
      orig.payout_status === "paid" &&
      JSON.stringify(await transitionsOf(s.adv.id)) === trBefore &&
      net.n === 9000,
  };
}
async function checkH1Rejected() {
  const s = await h1Case();
  const rej = await payoutRpc(s.adv.id, "rejected", U.supA, "Adviser not entitled per Owner review");
  const rv = await reverseRpc(s.feeId);
  const before = await historyOf(s.adv.id, s.feeId);
  const corr = await corrRpc(s.feeId);
  const newId = corrIdOf(corr);
  const advAcc = await accFor(newId, "advA");
  const intro = newId ? (await accrualsOf(newId)).filter((a) => a.beneficiary_role === "introducer") : [];
  const held = await heldOf(newId);
  const dets = newId
    ? (await determinationsOf(newId)).filter((d) => d.beneficiary_user_id === U.advA)
    : [];
  const reopen = await payoutRpc(s.adv.id, "received", U.ownerA, "Reopen after correction");
  const after = await historyOf(s.adv.id, s.feeId);
  const [orig] = await ledger(`id = $1`, [s.adv.id]);
  return {
    s,
    corr,
    newId,
    advAcc,
    held,
    reopen,
    orig,
    pass:
      rej.ok &&
      rv.ok &&
      corr.ok &&
      advAcc.length === 0 &&
      held.length === 1 &&
      held[0].beneficiary_user_id === U.advA &&
      held[0].status === "open" &&
      held[0].evidence?.prior_commission?.prior_outcome === "rejected" &&
      held[0].evidence?.prior_commission?.prior_event_id === s.adv.id &&
      dets.length === 1 &&
      dets[0].outcome === "exception" &&
      intro.length === 1 &&
      intro[0].amount_pence === 1800 &&
      !reopen.ok &&
      /finance_fee_not_posted/.test(reopen.message) &&
      orig.payout_status === "rejected" &&
      before === after,
  };
}
async function checkH1HeldChain() {
  const r = await checkH1Rejected();
  const rv2 = await reverseRpc(r.newId);
  const corr2 = await corrRpc(r.newId, 80000);
  const id2 = corrIdOf(corr2);
  const advAcc = await accFor(id2, "advA");
  const held = await heldOf(id2);
  const [orig] = await ledger(`id = $1`, [r.s.adv.id]);
  return {
    corr2,
    advAcc,
    held,
    pass:
      r.pass &&
      rv2.ok &&
      corr2.ok &&
      advAcc.length === 0 &&
      held.length === 1 &&
      held[0].evidence?.prior_commission?.prior_outcome === "held_unresolved" &&
      orig.payout_status === "rejected",
  };
}
async function checkH1OwnerClawback() {
  const s = await h1Case();
  await payoutRpc(s.adv.id, "paid");
  const cb = await clawRpc(s.adv.id, U.ownerA, "Owner: adviser paid in error");
  const rv = await reverseRpc(s.feeId);
  const claws = await ledger(`original_event_id = $1 and event_type = 'clawback'`, [s.adv.id]);
  const corr = await corrRpc(s.feeId);
  const id = corrIdOf(corr);
  const advAcc = await accFor(id, "advA");
  const held = await heldOf(id);
  return {
    corr,
    advAcc,
    held,
    pass:
      cb.ok &&
      rv.ok &&
      claws.length === 1 &&
      claws[0].evidence?.cause === "owner_clawback" &&
      corr.ok &&
      advAcc.length === 0 &&
      held.length === 1 &&
      held[0].evidence?.prior_commission?.prior_outcome === "owner_clawback",
  };
}
async function checkCorrectionOnce() {
  const s = await h1Case();
  await reverseRpc(s.feeId);
  const c1 = await corrRpc(s.feeId);
  const c2 = await corrRpc(s.feeId, 85000);
  const [adv] = await sql(
    `select count(*)::int as n from public.finance_ledger g
     join public.finance_fee_lines f on f.id = g.fee_line_id
     where f.corrects_fee_line_id = $1 and g.event_type = 'commission_accrued'
       and g.beneficiary_user_id = $2`,
    [s.feeId, U.advA],
  );
  const n = await correctionsOf(s.feeId);
  return {
    c2,
    n,
    adv: adv.n,
    pass: c1.ok && !c2.ok && /finance_fee_already_corrected/.test(c2.message) && n === 1 && adv.n === 1,
  };
}
{
  const u = await checkH1Unpaid();
  ok(
    "B4B2-78 H1 unpaid: the fee reversal reverses the unpaid commission (cause fee_reversed); the Owner correction accrues afresh at the inherited economic date and the B4a rate (adviser 10% → £90.00, introducer 2% → £18.00); no hold",
    u.pass,
    describe(u.corr),
  );
}
{
  const p = await checkH1Paid();
  ok(
    "B4B2-79 H1 paid: the paid commission stays paid with its transition history unchanged and is clawed back once by the reversal (cause fee_reversed); the correction accrues the corrected entitlement once, so the adviser's live position is exactly £90.00 (no duplicate)",
    p.pass,
    describe(p.corr) + ` net=${p.net}`,
  );
}
{
  const r = await checkH1Rejected();
  ok(
    "B4B2-80 H1 rejected: the rejected commission stays rejected with its determination and payout history byte-identical; the correction accrues nothing for that adviser and raises a prior_commission_held exception (prior outcome rejected, prior event linked); the introducer accrues normally; reopening the rejected commission on the reversed fee is refused (finance_fee_not_posted)",
    r.pass,
    describe(r.corr, r.reopen) + JSON.stringify(r.held.map((h) => h.evidence?.prior_commission)),
  );
}
{
  const r = await checkH1Rejected();
  const exc = r.held[0];
  const sup = await resolveRpc(exc.id, "reinstate", { actor: U.supA, reason: "Supervisor reinstates" });
  const tsSup = await call(
    ff.resolveCommissionException,
    { exceptionId: exc.id, resolution: "reinstate", reason: "Supervisor reinstates" },
    U.supA,
  );
  const noReason = await resolveRpc(exc.id, "reinstate", { reason: "   " });
  const pct = await resolveRpc(exc.id, "event_pct", { pct: 50 });
  const mid = await accFor(r.newId, "advA");
  const done = await call(
    ff.resolveCommissionException,
    { exceptionId: exc.id, resolution: "reinstate", reason: "Owner reviewed: adviser entitled on the corrected fee" },
    U.ownerA,
  );
  const again = await resolveRpc(exc.id, "reinstate", { reason: "again" });
  const adv = await accFor(r.newId, "advA");
  const [excAfter] = await sql(`select * from public.finance_commission_exceptions where id = $1`, [exc.id]);
  const det = (await determinationsOf(r.newId)).filter((d) => d.source_exception_id === exc.id);
  const audit = await sql(
    `select * from public.finance_audit_log
     where audit_type = 'commission_exception_resolved' and detail->>'exception_id' = $1`,
    [exc.id],
  );
  const tamper = await svcTx([
    MARKER,
    [`update public.finance_commission_exceptions set resolution_reason = 'edited' where id = $1`, [exc.id]],
  ]);
  const [orig] = await ledger(`id = $1`, [r.s.adv.id]);
  ok(
    "B4B2-81 H1 Owner determination: only the Owner reinstates a held commission (Supervisor refused in TS and DB), with a reason, and not as an event percentage; reinstatement accrues once at the fee-date rate and inherited economic date (£90.00, rate_version); the exception records reinstate, reason and Owner; the determination and audit link the exception; the resolution is immutable; the original stays rejected",
    r.pass &&
      !sup.ok &&
      /finance_forbidden/.test(sup.message) &&
      !tsSup.ok &&
      !noReason.ok &&
      !pct.ok &&
      /finance_resolution_invalid/.test(pct.message) &&
      mid.length === 0 &&
      done.ok &&
      !again.ok &&
      adv.length === 1 &&
      adv[0].amount_pence === 9000 &&
      adv[0].rate_source === "rate_version" &&
      adv[0].eat_text === r.s.fp.eat_text &&
      excAfter.status === "resolved" &&
      excAfter.resolution === "reinstate" &&
      excAfter.resolved_by === U.ownerA &&
      /^Owner reviewed/.test(excAfter.resolution_reason) &&
      det.length === 1 &&
      det[0].outcome === "accrued" &&
      audit.length === 1 &&
      audit[0].detail?.resolution === "reinstate" &&
      !tamper.ok &&
      orig.payout_status === "rejected",
    describe(sup, noReason, pct, done, again, tamper),
  );
}
{
  // Reinstatement uses the rate in force on the economic date, not today's rate.
  const advH = await person("adviser", "advH");
  await rate("adviser", advH, "fee", 10, longAgo);
  const c = await newCase();
  await assign(c.id, advH, "adviser");
  const { feeId } = await posted(c);
  const [acc] = await accrualsOf(feeId);
  await payoutRpc(acc.id, "rejected", U.ownerA, "Not entitled");
  await rate("adviser", advH, "fee", 25, dayAfter);
  await reverseRpc(feeId);
  const corr = await corrRpc(feeId);
  const id = corrIdOf(corr);
  const [held] = await heldOf(id);
  const res = await resolveRpc(held?.id, "reinstate", { reason: "Owner confirms entitlement" });
  const after = await accFor(id, advH);
  // No-commission decline is remembered through a later correction of the correction.
  const r = await checkH1Rejected();
  const decline = await resolveRpc(r.held[0].id, "no_commission", { reason: "Owner: no commission on the corrected fee" });
  const declineDet = (await determinationsOf(r.newId)).filter((d) => d.source_exception_id === r.held[0].id);
  await reverseRpc(r.newId);
  const corr2 = await corrRpc(r.newId, 70000);
  const id2 = corrIdOf(corr2);
  const held2 = await heldOf(id2);
  ok(
    "B4B2-82 H1 replacement accruals use the economic-date rules: a reinstated commission takes the rate in force on the fee date (10% → £90.00, not the later 25%); an Owner no-commission decision records owner_no_commission and is not revived by a further correction (held again as owner_declined, nothing accrued)",
    corr.ok &&
      res.ok &&
      after.length === 1 &&
      after[0].amount_pence === 9000 &&
      Number(after[0].commission_pct) === 10 &&
      decline.ok &&
      declineDet.length === 1 &&
      declineDet[0].outcome === "owner_no_commission" &&
      (await accFor(r.newId, "advA")).length === 0 &&
      corr2.ok &&
      (await accFor(id2, "advA")).length === 0 &&
      held2.length === 1 &&
      held2[0].evidence?.prior_commission?.prior_outcome === "owner_declined",
    describe(corr, res, decline, corr2),
  );
}
{
  const s = await h1Case();
  const re = await svc(`select * from public.reassign_introducer_commission($1, $2, $3, $4, $5)`, [
    T.a,
    U.ownerA,
    s.intro.id,
    I.introA2,
    "Owner: introducer two made the introduction",
  ]);
  const rv = await reverseRpc(s.feeId);
  const corr = await corrRpc(s.feeId);
  const id = corrIdOf(corr);
  const introAcc = id ? (await accrualsOf(id)).filter((a) => a.beneficiary_role === "introducer") : [];
  const held = await heldOf(id);
  const oc = await checkH1OwnerClawback();
  ok(
    "B4B2-83 H1 reversed by Owner adjustment: a reassigned introducer commission and an Owner clawback (cause owner_clawback) are not revived by a correction — each is held for the Owner (prior outcome reassigned / owner_clawback), the clawback is not repeated, and the adviser accrues normally",
    re.ok &&
      rv.ok &&
      corr.ok &&
      introAcc.length === 0 &&
      held.length === 1 &&
      held[0].introducer_id === I.introA1 &&
      held[0].evidence?.prior_commission?.prior_outcome === "reassigned" &&
      (await accFor(id, "advA")).length === 1 &&
      oc.pass,
    describe(re, rv, corr, oc.corr),
  );
}
{
  const c = await newCase();
  await assign(c.id, "advA", "adviser");
  await link(c.cust, "introA3");
  const { feeId } = await posted(c);
  const [open1] = (await exceptionsOf(feeId)).filter((e) => e.exception_kind === "missing_rate");
  await reverseRpc(feeId);
  const [closed1] = await sql(`select * from public.finance_commission_exceptions where id = $1`, [open1?.id]);
  const corr = await corrRpc(feeId);
  const id = corrIdOf(corr);
  const exc = id ? await exceptionsOf(id) : [];
  const introAcc = id ? (await accrualsOf(id)).filter((a) => a.beneficiary_role === "introducer") : [];
  const chain = await checkH1HeldChain();
  ok(
    "B4B2-84 H1 unresolved: an exception left open at reversal is closed as fee_reversed and the correction raises a fresh Owner exception (missing_rate) instead of accruing; a held commission left unresolved at a further reversal is held again on the next correction (held_unresolved) and the original stays rejected",
    open1?.status === "open" &&
      closed1?.resolution === "fee_reversed" &&
      corr.ok &&
      exc.filter((e) => e.exception_kind === "missing_rate" && e.status === "open").length === 1 &&
      exc.filter((e) => e.exception_kind === "prior_commission_held").length === 0 &&
      introAcc.length === 0 &&
      chain.pass,
    describe(corr, chain.corr2),
  );
}
{
  const once = await checkCorrectionOnce();
  const s = await h1Case();
  const bad = await svcTx([
    MARKER,
    [
      `select public.finance_cancel_accrual($1, $2, 'owner', $3, 'commission_reversed', 'x', 'owner_clawback')`,
      [T.a, U.ownerA, s.adv.id],
    ],
  ]);
  const noCause = await svcTx([
    MARKER,
    [`select public.finance_cancel_accrual($1, $2, 'owner', $3, 'commission_reversed', 'x', null)`, [T.a, U.ownerA, s.adv.id]],
  ]);
  ok(
    "B4B2-85 H1 no silent duplicate: one correction per reversed fee (second refused, one adviser accrual across corrections); every commission cancellation records a valid cause (mismatched or missing cause refused)",
    once.pass && !bad.ok && /finance_adjustment_invalid/.test(bad.message) && !noCause.ok,
    describe(once.c2, bad, noCause),
  );
}

// --- H2: legacy RAF -----------------------------------------------------------------------------
{
  const legacyRef = randomUUID();
  const db = await preB4b2Db(async (d) => {
    await sqlOn(
      d,
      `insert into public.referrals (id, referrer_user_id, status, bonus_status, tenant_id)
       values ($1, $2, 'qualified', 'paid', $3)`,
      [legacyRef, U.custA, T.a],
    );
    await sqlOn(
      d,
      `insert into public.finance_ledger (kind, fee_type, amount_pence, is_reversal,
         beneficiary_user_id, beneficiary_role, referral_id, payout_status, payout_at, created_by,
         tenant_id)
       values ('commission', 'fee', 7500, false, $1, 'referrer', $2, 'paid', now(), $3, $4)`,
      [U.custA, legacyRef, U.ownerA, T.a],
    );
  });
  const before = JSON.stringify(
    await sqlOn(db, `select l::text as t from public.finance_ledger l union all select r::text from public.referrals r`),
  );
  const m = await applyMigration(db);
  const after = JSON.stringify(
    await sqlOn(db, `select l::text as t from public.finance_ledger l union all select r::text from public.referrals r`),
  );
  const guardOld = await relExists(db, "public.finance_payout_transitions");
  ok(
    "B4B2-86 H2 legacy RAF preserved: a pre-existing (undated, paid) RAF ledger row aborts the migration before any change (legacy classification deferred); the paid ledger row and the referral are byte-identical afterwards; the referral bonus status stays the visible RAF record",
    !m.ok && /ledger_not_empty/.test(m.message) && before === after && guardOld === false,
    m.message,
  );
}

// --- H3: correction fee-line guard --------------------------------------------------------------
/** A direct correction draft insert (service role, optionally with the writer marker). */
function corrInsert(origId, o = {}, { marker = true, rollback = false } = {}) {
  const p = {
    tenant: T.a,
    session: null,
    feeType: "fee",
    amount: 50000,
    date: null,
    at: null,
    source: null,
    evidence: { reason: "Network corrected the amount", evidence: "Network email" },
    line: null,
    createdBy: U.ownerA,
    ...o,
  };
  const steps = [
    ...(marker ? [MARKER] : []),
    [
      `insert into public.finance_fee_lines (tenant_id, session_id, fee_type, amount_pence, status,
         corrects_fee_line_id, fee_event_date, fee_event_at, fee_event_source, fee_event_evidence,
         source_network_line_id, created_by)
       values ($1, $2, $3::public.finance_fee_type, $4, 'draft', $5, $6, $7, $8, $9::jsonb, $10, $11)
       returning id, fee_event_date::text as ed, fee_event_source as src, fee_event_evidence as ev`,
      [
        p.tenant,
        p.session,
        p.feeType,
        p.amount,
        origId,
        p.date,
        p.at,
        p.source,
        p.evidence === null ? null : JSON.stringify(p.evidence),
        p.line,
        p.createdBy,
      ],
    ],
  ];
  if (!rollback) return svcTx(steps);
  return probe([[`set local role service_role`], ...steps]);
}
async function reversedFee() {
  const c = await newCase();
  const { feeId } = await posted(c);
  const rv = await reverseRpc(feeId);
  if (!rv.ok) throw new Error(`reverse: ${rv.message}`);
  return { c, feeId, orig: await feeOf(feeId) };
}
async function checkH3Authority() {
  const { c, feeId, orig } = await reversedFee();
  const noMarker = await corrInsert(feeId, { session: c.id }, { marker: false });
  const sup = await corrInsert(feeId, { session: c.id, createdBy: U.supA });
  const otherOwner = await corrInsert(feeId, { session: c.id, createdBy: U.ownerB });
  const supRpc = await corrRpc(feeId, 50000, U.supA);
  const genRpc = await corrRpc(feeId, 50000, U.genA);
  const good = await corrInsert(feeId, { session: c.id }, { rollback: true });
  return {
    sup,
    good,
    pass:
      !noMarker.ok &&
      !sup.ok &&
      /finance_fee_line_correction_owner_required/.test(sup.message) &&
      !otherOwner.ok &&
      !supRpc.ok &&
      /finance_forbidden/.test(supRpc.message) &&
      !genRpc.ok &&
      good.ok &&
      good.rows[0].ed === orig.event_date &&
      good.rows[0].src === "owner_correction" &&
      (await correctionsOf(feeId)) === 0,
  };
}
async function checkH3Reversed() {
  const c = await newCase();
  const { feeId } = await posted(c);
  const rpc = await corrRpc(feeId);
  const direct = await corrInsert(feeId, { session: c.id });
  const c2 = await newCase();
  const p2 = await posted(c2);
  const forged = await probe([
    [`set local session_replication_role = replica`],
    [
      `update public.finance_fee_lines set status = 'amended', reversed_at = now(), reversed_by = $2,
         reversal_reason = 'forged' where id = $1`,
      [p2.feeId, U.ownerA],
    ],
    [`set local session_replication_role = origin`],
    [`set local role service_role`],
    MARKER,
    [
      `insert into public.finance_fee_lines (tenant_id, session_id, fee_type, amount_pence, status,
         corrects_fee_line_id, fee_event_evidence, created_by)
       values ($1, $2, 'fee', 50000, 'draft', $3, '{"reason":"r","evidence":"e"}'::jsonb, $4)`,
      [T.a, c2.id, p2.feeId, U.ownerA],
    ],
  ]);
  const draftRpc = await corrRpc(R.draftA);
  const draftIns = await corrInsert(R.draftA, { session: R.sessA1 });
  const both = await sql(
    `select count(*)::int as n from public.finance_fee_lines
     where session_id = $1 and status::text = 'posted'`,
    [c.id],
  );
  return {
    rpc,
    both: both[0].n,
    pass:
      !rpc.ok &&
      /finance_fee_not_reversed/.test(rpc.message) &&
      !direct.ok &&
      !forged.ok &&
      !draftRpc.ok &&
      !draftIns.ok &&
      both[0].n === 1 &&
      (await feeOf(R.draftA)).st === "draft",
  };
}
async function checkH3Tenant() {
  const { c, feeId } = await reversedFee();
  const sessB = randomUUID();
  await sql(
    `insert into public.interview_sessions (id, customer_id, tenant_id, case_ref, created_at)
     values ($1, $2, $3, $4, $5)`,
    [sessB, U.custB, T.b, `MG-B4B2-B${caseN}`, LEGACY_AT],
  );
  const xt = await corrInsert(feeId, { tenant: T.b, session: sessB, createdBy: U.ownerB });
  const xtSame = await corrInsert(feeId, { tenant: T.b, session: c.id, createdBy: U.ownerB });
  const rpcB = await corrRpc(feeId, 50000, U.ownerB, "r", "e", T.b);
  const other = await newCase();
  const wrongSession = await corrInsert(feeId, { session: other.id });
  const wrongType = await corrInsert(feeId, { session: c.id, feeType: "insurance_fee" });
  return {
    xt,
    pass:
      !xt.ok &&
      !xtSame.ok &&
      !rpcB.ok &&
      !wrongSession.ok &&
      !wrongType.ok &&
      (await correctionsOf(feeId)) === 0,
  };
}
async function checkH3Override() {
  const { c, feeId, orig } = await reversedFee();
  const at = (d) => londonMidnight(d);
  const RB = { rollback: true };
  const sameDate = await corrInsert(feeId, { session: c.id, date: orig.event_date, at: at(orig.event_date) }, RB);
  const otherDate = await corrInsert(feeId, { session: c.id, date: "2025-06-02", at: at("2025-06-02") }, RB);
  const src = await corrInsert(feeId, { session: c.id, source: "network_line_transaction_date" }, RB);
  const extraKey = await corrInsert(feeId, {
    session: c.id,
    evidence: { reason: "r", evidence: "e", statement_id: randomUUID() },
  }, RB);
  const nonString = await corrInsert(feeId, { session: c.id, evidence: { reason: "r", evidence: { statement_id: "x" } } }, RB);
  const missing = await corrInsert(feeId, { session: c.id, evidence: { reason: "r" } }, RB);
  return {
    otherDate,
    pass:
      !sameDate.ok &&
      !otherDate.ok &&
      /finance_fee_line_correction_date_supplied/.test(otherDate.message) &&
      !src.ok &&
      !extraKey.ok &&
      /finance_fee_line_correction_invalid/.test(extraKey.message) &&
      !nonString.ok &&
      !missing.ok &&
      (await correctionsOf(feeId)) === 0,
  };
}
async function checkH3Immutable() {
  const { feeId } = await reversedFee();
  const corr = await corrRpc(feeId);
  const corrId = corrIdOf(corr);
  const before = (await feeOf(feeId)).t;
  const corrBefore = corrId ? (await feeOf(corrId)).t : null;
  const updAmt = await svc(`update public.finance_fee_lines set amount_pence = 1 where id = $1`, [feeId]);
  const updAmtMarker = await svcTx([
    MARKER,
    [`update public.finance_fee_lines set amount_pence = 1 where id = $1`, [feeId]],
  ]);
  const updDate = await svcTx([
    MARKER,
    [
      `update public.finance_fee_lines set fee_event_date = '2025-06-02',
         fee_event_at = ('2025-06-02'::timestamp at time zone 'Europe/London') where id = $1`,
      [feeId],
    ],
  ]);
  const updStatus = await svcTx([
    MARKER,
    [`update public.finance_fee_lines set status = 'posted' where id = $1`, [feeId]],
  ]);
  const updCorr = await svcTx([
    MARKER,
    [
      `update public.finance_fee_lines set fee_event_date = '2025-06-02',
         fee_event_at = ('2025-06-02'::timestamp at time zone 'Europe/London') where id = $1`,
      [corrId],
    ],
  ]);
  const del = await svc(`delete from public.finance_fee_lines where id = $1`, [feeId]);
  const after = await feeOf(feeId);
  return {
    updAmtMarker,
    amount: after.amount_pence,
    pass:
      corr.ok &&
      !updAmt.ok &&
      !updAmtMarker.ok &&
      !updDate.ok &&
      !updStatus.ok &&
      !updCorr.ok &&
      !del.ok &&
      after.t === before &&
      (await feeOf(corrId)).t === corrBefore,
  };
}
async function checkH3Network() {
  const { c, feeId, orig } = await reversedFee();
  const spare = await freshStatement([aiLine({ ref: c.ref, pounds: 500, date: winterDate, type: "fee" })]);
  const lineId = spare.lines[0].id;
  const withLine = await corrInsert(feeId, { session: c.id, line: lineId });
  const forced = await probe([
    [`set local session_replication_role = replica`],
    [
      `insert into public.finance_fee_lines (tenant_id, session_id, fee_type, amount_pence, status,
         corrects_fee_line_id, source_network_line_id, fee_event_date, fee_event_at,
         fee_event_source, fee_event_evidence, created_by)
       values ($1, $2, 'fee', 50000, 'draft', $3, $4, $5::date,
         ($5::date::timestamp at time zone 'Europe/London'), 'owner_correction', '{}'::jsonb, $6)`,
      [T.a, c.id, feeId, lineId, orig.event_date, U.ownerA],
    ],
  ]);
  const corr = await corrRpc(feeId);
  const cf = await feeOf(corrIdOf(corr));
  const ev = cf?.fee_event_evidence ?? {};
  return {
    withLine,
    pass:
      !withLine.ok &&
      !forced.ok &&
      forced.code === "23514" &&
      corr.ok &&
      cf.source_network_line_id === null &&
      JSON.stringify(Object.keys(ev).sort()) ===
        JSON.stringify(["correction", "corrects_fee_line_id", "inherited_fee_event_evidence", "inherited_fee_event_source"]) &&
      JSON.stringify(Object.keys(ev.correction ?? {}).sort()) === JSON.stringify(["evidence", "reason"]) &&
      JSON.stringify(ev.inherited_fee_event_evidence) === JSON.stringify(orig.fee_event_evidence) &&
      ev.inherited_fee_event_source === orig.fee_event_source,
  };
}
{
  const r = await checkH3Authority();
  ok(
    "B4B2-87 H3 only an Owner-authorised correction can inherit a reversed fee's date: direct inserts without the writer marker, by a Supervisor, or by another tenant's Owner are refused; Supervisor and General correction RPCs are refused; the guarded Owner shape inherits the date",
    r.pass,
    describe(r.sup, r.good),
  );
}
{
  const r = await checkH3Reversed();
  ok(
    "B4B2-88 H3 the original must be genuinely posted and reversed: a live posted fee, a fee forced to amended without a fee_reversed event, and an undated draft cannot be corrected (RPC and direct insert); no second live fee appears",
    r.pass,
    describe(r.rpc) + ` posted=${r.both}`,
  );
}
{
  const r = await checkH3Tenant();
  ok(
    "B4B2-89 H3 tenant isolation and exact reference: a correction in another tenant (own or the original's session) and the other tenant's RPC are refused; a different session or fee type is refused",
    r.pass,
    describe(r.xt),
  );
}
{
  const r = await checkH3Override();
  ok(
    "B4B2-90 H3 arbitrary date or evidence overrides are refused, not overwritten: any supplied fee_event_date / fee_event_at (even the original's) or fee_event_source is refused (finance_fee_line_correction_date_supplied); correction evidence must be exactly a string reason and evidence",
    r.pass,
    describe(r.otherDate),
  );
}
{
  const r = await checkH3Immutable();
  ok(
    "B4B2-91 H3 the reversed original stays immutable (amount, date, status, delete refused with or without the writer marker) and the posted correction's inherited date cannot be edited",
    r.pass,
    describe(r.updAmtMarker),
  );
}
{
  const r = await checkH3Network();
  ok(
    "B4B2-92 H3 a correction cannot fabricate network receipt or statement evidence: a correction carrying a network line is refused (guard) and the fee-event check refuses it even with triggers bypassed (23514); the correction's evidence is exactly the inherited source/evidence plus the Owner's reason and evidence",
    r.pass,
    describe(r.withLine),
  );
}
{
  const draftPost = await postRpc(R.sessA1, [R.draftA]);
  const dateDraft = await svcTx([
    MARKER,
    [
      `update public.finance_fee_lines set fee_event_date = '2025-06-02',
         fee_event_at = ('2025-06-02'::timestamp at time zone 'Europe/London'),
         fee_event_source = 'owner_correction' where id = $1`,
      [R.draftA],
    ],
  ]);
  const { c, feeId } = await reversedFee();
  const ledgerBefore = await countOf(pg, "public.finance_ledger", "session_id = $1", [c.id]);
  await fx(`update public.interview_sessions set deleted_at = now() where id = $1`, [c.id]);
  const failed = await corrRpc(feeId);
  const nMid = await correctionsOf(feeId);
  const ledgerMid = await countOf(pg, "public.finance_ledger", "session_id = $1", [c.id]);
  const auditMid = await countOf(
    pg,
    "public.finance_audit_log",
    "audit_type = 'fee_correction_posted' and detail->>'corrects_fee_line_id' = $1",
    [feeId],
  );
  await fx(`update public.interview_sessions set deleted_at = null where id = $1`, [c.id]);
  const done = await corrRpc(feeId);
  const audit = await sql(
    `select * from public.finance_audit_log
     where audit_type = 'fee_correction_posted' and detail->>'corrects_fee_line_id' = $1`,
    [feeId],
  );
  ok(
    "B4B2-93 H3 undated drafts stay unpostable and cannot be given a date; a correction is atomic (a failure inside posting leaves no correction line, ledger event or audit) and, when it succeeds, is audited once with the Owner, reason, evidence and inherited date",
    !draftPost.ok &&
      /finance_fee_event_date_required/.test(draftPost.message) &&
      !dateDraft.ok &&
      (await feeOf(R.draftA)).event_date === null &&
      !failed.ok &&
      /finance_session_customer_invalid/.test(failed.message) &&
      nMid === 0 &&
      ledgerMid === ledgerBefore &&
      auditMid === 0 &&
      done.ok &&
      audit.length === 1 &&
      audit[0].changed_by === U.ownerA &&
      audit[0].tenant_id === T.a &&
      Boolean(audit[0].detail?.reason) &&
      Boolean(audit[0].detail?.evidence) &&
      String(audit[0].detail?.fee_event_date ?? "").slice(0, 10) === (await feeOf(feeId)).event_date,
    describe(draftPost, dateDraft, failed, done),
  );
}

// =============================================================================================
// STATIC, FAIL-CLOSED, SCOPE AND REGRESSIONS
// =============================================================================================
{
  const fin = SRC.finance;
  const refs = read(REFERRALS_REL);
  const sess = read(SESSIONS_REL);
  const route = read(SESSION_ROUTE_REL);
  const panel = read("src/components/CommissionPayoutsPanel.tsx");
  const directWrite = /from\("finance_ledger"\)[\s\S]{0,80}?\.(insert|update|upsert|delete)\(/;
  const rpcs = [
    "post_session_fees",
    "reverse_posted_fee",
    "post_fee_correction",
    "reassign_introducer_commission",
    "claw_back_commission",
    "settle_commission_clawback",
    "resolve_commission_exception",
    "set_commission_payout_status",
  ];
  ok(
    "B4B2-68 static: no TypeScript writes to finance_ledger (finance, referrals, sessions); every financial mutation goes through its RPC; the export filters by tenant; payout UI gated by canAmendCommissionPayouts; posting sends explicit fee line ids; reopen prompts for a reason; no RAF ledger accrual path remains",
    !directWrite.test(fin) &&
      !/accrue_raf_commission|ensureRafCommissionLedgerEntry|updateRafAccrualPayout/.test(fin) &&
      !/accrue_raf_commission|updateRafAccrualPayout|from\("finance_ledger"\)/.test(refs) &&
      !directWrite.test(refs) &&
      !directWrite.test(sess) &&
      rpcs.every((r) => fin.includes(`rpc("${r}"`)) &&
      /from\("finance_ledger"\)\s*\.select\([^)]*\)\s*\.eq\("tenant_id", view\.tenantId\)/.test(sess) &&
      /canAmendCommissionPayouts\(adminAccess\)/.test(route) &&
      /feeLineIds/.test(route) &&
      /prompt\(/.test(panel) &&
      /isOwner \|\| access\.isSupervisor/.test(read(ADMIN_ACCESS_REL)),
  );
}
{
  const sqlCode = b4b2Sql.replace(/--[^\n]*/g, "").replace(/'(?:[^']|'')*'/g, "''");
  const ddlOnRates = /(ALTER TABLE|DROP TABLE|COMMENT ON TABLE|GRANT [^;]* ON|REVOKE [^;]* ON|CREATE (UNIQUE )?INDEX [^;]* ON|CREATE TRIGGER [^;]* ON)\s+(TABLE\s+)?public\.commission_rate_versions\b/i.test(
    b4b2Sql.replace(/--[^\n]*/g, ""),
  );
  ok(
    "B4B2-69 migration static: one runner transaction (no top-level BEGIN / COMMIT / ROLLBACK); no DDL on commission_rate_versions; no CASCADE or SET NULL; no rate_version_id in any accrual key; economic dates come from fee_event_at, never now()",
    !/^(BEGIN|COMMIT|ROLLBACK)\s*;/im.test(b4b2Sql) &&
      !ddlOnRates &&
      !/ON DELETE (CASCADE|SET NULL)/i.test(sqlCode) &&
      !/accrual_key[\s\S]{0,160}rate_version_id/.test(b4b2Sql) &&
      !/economic_at[^;\n]{0,40}now\(\)/.test(b4b2Sql),
    JSON.stringify([
      /^(BEGIN|COMMIT|ROLLBACK)\s*;/im.test(b4b2Sql),
      ddlOnRates,
      /ON DELETE (CASCADE|SET NULL)/i.test(sqlCode),
      /accrual_key[\s\S]{0,160}rate_version_id/.test(b4b2Sql),
      /economic_at[^;\n]{0,40}now\(\)/.test(b4b2Sql),
    ]),
  );
}
{
  const freshCheck = (text, check, seedMutate) => onFreshDb(text, check, seedMutate);
  const applied = async () => ({ applied: true });
  const withLedger = await freshCheck(b4b2Sql, applied, async (db) => {
    await sqlOn(
      db,
      `insert into public.finance_ledger (kind, amount_pence, is_reversal, created_by, tenant_id)
       values ('post', 100, false, $1, $2)`,
      [U.ownerA, T.a],
    );
  });
  const noB4b1 = await (async () => {
    const db = await preB4b1Db();
    const m = await applyMigration(db);
    return { m, t: await relExists(db, "public.finance_payout_transitions") };
  })();
  const withPosted = await freshCheck(b4b2Sql, applied, async (db) => {
    await sqlOn(db, `alter table public.finance_fee_lines disable trigger user`);
    await sqlOn(db, `update public.finance_fee_lines set status = 'posted' where id = $1`, [R.draftA]);
    await sqlOn(db, `alter table public.finance_fee_lines enable trigger user`);
  });
  ok(
    "B4B2-70 the migration fails closed: existing ledger rows (legacy classification deferred), B4b1 not applied, or an already-posted fee each abort it before any change",
    /ledger_not_empty/.test(withLedger.migrationFailed ?? "") &&
      !noB4b1.m.ok &&
      /b4b1_b4a_missing|"public\.session_adviser_assignments" does not exist/.test(noB4b1.m.message) &&
      noB4b1.t === false &&
      /posted_fee_present/.test(withPosted.migrationFailed ?? ""),
    JSON.stringify([withLedger.migrationFailed, noB4b1.m.message, withPosted.migrationFailed]),
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
  const historic = all.filter(
    (f) => f.startsWith("scripts/") && f !== SELF_REL && f !== F1_VERIFIER_REL,
  );
  const migrations = all.filter((f) => f.startsWith("supabase/migrations/")).sort();
  ok(
    "B4B2-71 only authorised files changed against the B4b1 baseline: exactly the B4b2 migration and its F1 lock-order migration, no historic verifier, generated types or earlier migration edited",
    outside.length === 0 &&
      historic.length === 0 &&
      migrations.length === 2 &&
      migrations[0] === B4B2_REL &&
      migrations[1] === F1_REL,
    JSON.stringify({ outside, historic, migrations }),
  );
}
ok(
  "B4B2-72 no unexpected network or Auth calls; no missing tables were hit",
  unknownCalls.length === 0 && missingTables.size === 0,
  JSON.stringify({ unknownCalls: unknownCalls.slice(0, 5), missing: [...missingTables] }),
);
{
  const s = await validatedStatement().catch(() => null);
  const sup = s ? await unlockRpc(U.supA, s.id, "fix") : null;
  const own = s ? await unlockRpc(U.ownerA, s.id, "Owner reopening") : null;
  const undated = await postRpc(R.sessA1, [R.draftA]);
  const st = await b4b1State(pg);
  const parsed = JSON.parse(st);
  const pre = JSON.parse(preB4b1);
  ok(
    "B4B2-73 B4b1 regression: adviser-history resolver, allocation, validation, unlock and audit functions byte-identical; history, statement and archive catalogs unchanged; Owner-only unlock still enforced; undated drafts still unpostable",
    JSON.stringify(parsed.fns) === JSON.stringify(pre.fns) &&
      JSON.stringify(parsed.cat) === JSON.stringify(pre.cat) &&
      JSON.stringify(parsed.rows[2]) === JSON.stringify(pre.rows[2]) &&
      s &&
      !sup.ok &&
      own.ok &&
      !undated.ok,
    describe(sup, own),
  );
}
{
  const rate = await svc(`select * from public.resolve_commission_rate_as_of($1, 'adviser', null, $2, 'fee', now())`, [
    T.a,
    U.advA,
  ]);
  ok(
    "B4B2-74 B4a regression: rate-version functions and the commission_rate_versions catalog are byte-identical; the resolver still runs",
    (await b4aState(pg)) === preB4a && rate.ok,
    describe(rate),
  );
}
ok("B4B2-75 B3 regression: attribution RPC and link / amendment-history catalogs unchanged", (await b3State(pg)) === preB3);
{
  const a = await sql(`select public.resolve_customer_introducer_as_of($1, $2, now()) as id`, [T.a, R.sessB1]);
  ok(
    "B4B2-76 A2 regression: dual-tenant introducer registrations and the introducers catalog unchanged; the resolver never crosses tenants",
    (await a2State(pg)) === preA2 && a[0].id === null,
  );
}
ok(
  "B4B2-77 S4C2 regression: the S4C2 customer's case and membership rows, and the sessions / memberships catalogs, unchanged",
  (await s4c2State(pg)) === preS4C2,
);

// =============================================================================================
// NEGATIVE CONTROLS — each re-introduces one real defect, shows its unsafe effect, and shows the
// corresponding test predicate rejecting it.
// =============================================================================================
const ncResults = [];
function nc(label, { effect, caught, detail = "" }) {
  const pass = Boolean(effect) && Boolean(caught);
  ncResults.push({ label, pass });
  if (pass) console.log(`PASS  ${label}`);
  else console.error(`FAIL  ${label} (effect=${Boolean(effect)} caught=${Boolean(caught)}) ${detail}`);
}
async function ncSafe(label, fn) {
  try {
    await fn();
  } catch (e) {
    nc(label, { effect: false, caught: false, detail: e instanceof Error ? e.message : String(e) });
  }
}
const sqlMutant = (pairs) => mutate(appliedSql, pairs);
/** Fresh post-B4b1 database migrated with the mutant, seeded like the main run, then `check`. */
async function onMutant(text, check) {
  if (!text) return { migrationFailed: "anchor missing" };
  return onFreshDb(text, async () => {
    await seedB4b2();
    return check();
  });
}
const ncDetail = (r) => (r?.migrationFailed ? `migration: ${r.migrationFailed}` : "");
const OWNER_GATE = (next) => [
  `v_role := public.finance_actor_role(p_tenant_id, p_actor_user_id, 'owner');\n  IF v_reason IS NULL OR char_length(v_reason) > 500 THEN\n    RAISE EXCEPTION 'finance_reason_required';\n  END IF;\n${next}`,
  `v_role := public.finance_actor_role(p_tenant_id, p_actor_user_id, 'payout');\n  IF v_reason IS NULL OR char_length(v_reason) > 500 THEN\n    RAISE EXCEPTION 'finance_reason_required';\n  END IF;\n${next}`,
];

await ncSafe("NC01", async () => {
  const r = await onMutant(
    sqlMutant([
      [
        "CREATE UNIQUE INDEX finance_ledger_fee_posted_key\n  ON public.finance_ledger (tenant_id, fee_line_id) WHERE event_type = 'fee_posted';",
        "",
      ],
    ]),
    checkFeePostedUnique,
  );
  nc("NC01 fee_posted unique index removed → a forced duplicate fee_posted lands; B4B2-11 rejects", { effect: r.forced?.ok && r.count === 2, caught: r.pass === false, detail: ncDetail(r) });
});
await ncSafe("NC02", async () => {
  const r = await onMutant(
    sqlMutant([
      [
        "ON public.finance_ledger (tenant_id, fee_line_id, beneficiary_role, beneficiary_user_id)\n  WHERE event_type = 'commission_accrued'",
        "ON public.finance_ledger (tenant_id, fee_line_id, beneficiary_role, beneficiary_user_id, rate_version_id)\n  WHERE event_type = 'commission_accrued'",
      ],
    ]),
    checkAccrualUnique,
  );
  nc("NC02 accrual key includes rate_version_id → a second accrual under another rate version lands; B4B2-12 rejects", {
    effect: r.forced?.ok,
    caught: r.pass === false,
    detail: ncDetail(r),
  });
});
await ncSafe("NC03", async () => {
  const r = await onMutant(
    sqlMutant([
      [
        "      OR (p_capability = 'post' AND m.role::text = 'general' AND EXISTS (\n        SELECT 1 FROM public.admin_permissions ap\n        WHERE ap.user_id = p_actor_user_id AND ap.tenant_id = p_tenant_id\n          AND ap.permission_key = 'finance_customer' AND ap.access = 'amend')))",
        "      OR (p_capability = 'post' AND m.role::text = 'general'))",
      ],
    ]),
    checkPostAuthority,
  );
  nc("NC03 DB posting authority ignores finance_customer=amend → General without permission posts; B4B2-16 rejects", {
    effect: r.noPerm?.ok,
    caught: r.pass === false,
    detail: ncDetail(r),
  });
});
await ncSafe("NC04", async () => {
  const text = appliedSql.replace(
    /(resolve_session_advisers_as_of\(p_tenant_id, v_fee\.session_id,\s*)v_fee\.fee_event_at\)/g,
    "$1now())",
  );
  const r = await onMutant(text === appliedSql ? null : text, checkAdviserAsOf);
  nc("NC04 advisers resolved at now() → the adviser assigned after the fee date earns; B4B2-18 rejects", {
    effect: r.acc?.includes(U.advA2),
    caught: r.pass === false,
    detail: ncDetail(r),
  });
});
await ncSafe("NC05", async () => {
  const r = await onMutant(
    sqlMutant([["ELSIF v_resolution = 'assigned' AND v_count <= 3 THEN", "ELSIF v_resolution = 'assigned' THEN"]]),
    checkMaxThree,
  );
  nc("NC05 three-adviser cap removed → four advisers accrue; B4B2-21 rejects", {
    effect: r.acc === 4,
    caught: r.pass === false,
    detail: ncDetail(r),
  });
});
await ncSafe("NC06", async () => {
  const r = await onMutant(
    sqlMutant([
      [
        "ELSIF v_resolution = 'assigned' AND v_count <= 3 THEN",
        "ELSIF v_resolution IN ('assigned', 'assigned_history_incomplete') AND v_count <= 3 THEN",
      ],
    ]),
    checkIncompleteHeld,
  );
  nc("NC06 incomplete history treated as proof → the recorded adviser accrues; B4B2-22 rejects", {
    effect: r.acc === 1,
    caught: r.pass === false,
    detail: ncDetail(r),
  });
});
await ncSafe("NC07", async () => {
  const r = await onMutant(
    sqlMutant([["    AND h.effective_from <= p_event_at\n  ORDER BY h.effective_from DESC", "  ORDER BY h.effective_from DESC"]]),
    checkIntroducerAsOf,
  );
  nc("NC07 introducer history ignores effective_from → the later introducer earns; B4B2-31 rejects", {
    effect: r.acc?.includes(I.introA2),
    caught: r.pass === false,
    detail: ncDetail(r),
  });
});
await ncSafe("NC08", async () => {
  const r = await onMutant(
    sqlMutant([
      ["      v_fp.fee_type, v_fp.economic_at) r;", "      v_fp.fee_type, now()) r;"],
      ["         OR v_rate.effective_from > NEW.economic_at\n", ""],
    ]),
    checkRateAsOf,
  );
  nc("NC08 rate resolved at now() → the later 20% version is applied; B4B2-35 rejects", {
    effect: r.acc?.[0]?.[0] === 20000,
    caught: r.pass === false,
    detail: ncDetail(r),
  });
});
await ncSafe("NC09", async () => {
  const r = await onMutant(
    sqlMutant([
      [
        "    IF v_stmt_status IS NULL OR v_stmt_status NOT IN ('validated', 'locked') THEN\n      RAISE EXCEPTION 'finance_statement_not_validated';\n    END IF;\n",
        "",
      ],
    ]),
    checkUnvalidated,
  );
  nc("NC09 statement-validated check removed → a fee from an unvalidated statement posts; B4B2-17 rejects", {
    effect: r.p?.ok,
    caught: r.pass === false,
    detail: ncDetail(r),
  });
});
await ncSafe("NC10", async () => {
  const r = await onMutant(
    sqlMutant([
      [
        "    IF v_version IS NULL THEN\n      v_kind := 'missing_rate';",
        "    IF v_version IS NULL THEN\n      v_pct := 0; v_rate_source := 'owner_event_pct';",
      ],
    ]),
    checkNoRateException,
  );
  nc("NC10 missing rate silently treated as 0% → no exception, explicit_zero recorded; B4B2-36 rejects", {
    effect: (r.exc?.length ?? 1) === 0 && r.det?.includes("explicit_zero"),
    caught: r.pass === false,
    detail: ncDetail(r),
  });
});
await ncSafe("NC11", async () => {
  const r = await onMutant(
    sqlMutant([
      [
        "    RAISE EXCEPTION 'finance_ledger_immutable';\n  END IF;\n\n  NEW.created_at := now();",
        "    RETURN NEW;\n  END IF;\n\n  NEW.created_at := now();",
      ],
    ]),
    checkLedgerImmutable,
  );
  nc("NC11 ledger UPDATE allowed → a posted amount is rewritten; B4B2-39 rejects", {
    effect: r.upd?.ok && r.after === 1,
    caught: r.pass === false,
    detail: ncDetail(r),
  });
});
await ncSafe("NC12", async () => {
  const r = await onMutant(
    sqlMutant([
      ["IF v_ev.payout_status IN ('paid', 'reversed') THEN", "IF v_ev.payout_status IN ('reversed') THEN"],
      [
        "(v_ev.payout_status = 'rejected' AND p_to_status = 'received')",
        "(v_ev.payout_status IN ('rejected', 'paid') AND p_to_status = 'received')",
      ],
      ["'received>reversed'))\n    OR (transition_kind = 'recovery'", "'received>reversed', 'paid>received'))\n    OR (transition_kind = 'recovery'"],
    ]),
    checkPaidTerminal,
  );
  nc("NC12 paid not terminal → a paid commission reopens and is then rejected; B4B2-45 rejects", {
    effect: r.back?.ok && r.rej?.ok,
    caught: r.pass === false,
    detail: ncDetail(r) || describe(r.back),
  });
});
await ncSafe("NC13", async () => {
  const r = await onMutant(
    sqlMutant([
      [
        "      OR (p_capability IN ('post', 'payout') AND m.role::text = 'supervisor')",
        "      OR (p_capability IN ('post', 'payout') AND m.role::text IN ('supervisor', 'general'))",
      ],
    ]),
    checkPayoutAuthority,
  );
  nc("NC13 payout authority allows General → General marks paid; B4B2-46 rejects", {
    effect: r.gen?.ok && r.status === "paid",
    caught: r.pass === false,
    detail: ncDetail(r),
  });
});
await ncSafe("NC14", async () => {
  const [from] = OWNER_GATE("  SELECT f.session_id INTO v_session");
  const r = await onMutant(
    sqlMutant([[from, from.replace("'owner'", "'post'")]]),
    checkReversalOwnerOnly,
  );
  nc("NC14 reversal gated by the posting capability → a Supervisor reverses a fee; B4B2-50 rejects", {
    effect: r.sup?.ok && r.st === "amended",
    caught: r.pass === false,
    detail: ncDetail(r),
  });
});
await ncSafe("NC15", async () => {
  const r = await onMutant(sqlMutant([["ELSIF v_acc.payout_status = 'paid' THEN", "ELSIF false THEN"]]), checkReversalClawsBackPaid);
  nc("NC15 reversal skips paid commission → no clawback, the payment stands unrecovered; B4B2-49 rejects", {
    effect: r.r?.ok && r.claws === 0,
    caught: r.pass === false,
    detail: ncDetail(r),
  });
});
await ncSafe("NC16", async () => {
  const r = await onMutant(
    sqlMutant([
      [
        "  IF EXISTS (SELECT 1 FROM public.finance_ledger c\n             WHERE c.tenant_id = p_tenant_id AND c.original_event_id = v_acc.id\n               AND c.event_type IN ('commission_reversed', 'commission_reassigned', 'clawback')) THEN\n    RAISE EXCEPTION 'finance_commission_already_adjusted';\n  END IF;\n",
        "",
      ],
      [
        "CREATE UNIQUE INDEX finance_ledger_cancellation_key\n  ON public.finance_ledger (tenant_id, original_event_id)\n  WHERE event_type IN ('commission_reversed', 'commission_reassigned', 'clawback');",
        "",
      ],
      ["NEW.idempotency_key := 'cancel:' || v_orig.id::text;", "NEW.idempotency_key := 'cancel:' || gen_random_uuid()::text;"],
    ]),
    checkClawbackOnce,
  );
  nc("NC16 clawback de-duplication removed → the same payment is clawed back twice; B4B2-56 rejects", {
    effect: r.second?.ok && r.n === 2,
    caught: r.pass === false,
    detail: ncDetail(r),
  });
});
await ncSafe("NC17", async () => {
  const [from, to] = OWNER_GATE("  IF p_outcome IS NULL OR p_outcome NOT IN ('settled', 'written_off')");
  const r = await onMutant(sqlMutant([[from, to]]), checkSettleOwnerOnly);
  nc("NC17 clawback settlement gated by payout capability → a Supervisor settles; B4B2-57 rejects", {
    effect: r.sup?.ok && r.status === "settled",
    caught: r.pass === false,
    detail: ncDetail(r),
  });
});
await ncSafe("NC18", async () => {
  const r = await onMutant(
    sqlMutant([["  RAISE EXCEPTION 'finance_audit_immutable';\nEND;", "  RETURN COALESCE(NEW, OLD);\nEND;"]]),
    async () => {
      const c = await newCase();
      await posted(c);
      return checkAuditImmutable();
    },
  );
  nc("NC18 audit guard lets rows through → an audit row is rewritten; B4B2-43 rejects", {
    effect: r.updSuper?.ok && r.updSuper.rows?.[0]?.summary === "tampered",
    caught: r.pass === false,
    detail: ncDetail(r),
  });
});
await ncSafe("NC19", async () => {
  const r = await onMutant(
    sqlMutant([
      [
        "      NEW.fee_event_date := v_corr.fee_event_date;\n      NEW.fee_event_at := v_corr.fee_event_at;",
        "      NEW.fee_event_date := (now() AT TIME ZONE 'Europe/London')::date;\n      NEW.fee_event_at := ((now() AT TIME ZONE 'Europe/London')::date)::timestamp AT TIME ZONE 'Europe/London';",
      ],
    ]),
    checkCorrectionInheritsDate,
  );
  nc("NC19 correction dated today → the corrected fee and its commission move to the correction date; B4B2-51 rejects", {
    effect: r.corr?.ok && r.cf?.event_date && r.cf.event_date !== r.orig?.event_date,
    caught: r.pass === false,
    detail: ncDetail(r),
  });
});
await ncSafe("NC20", async () => {
  const r = await onMutant(
    sqlMutant([
      [
        "ELSIF v_fee.fee_type::text NOT IN ('fee', 'mortgage_fee') THEN\n    PERFORM public.finance_record_determination(\n      p_tenant_id, p_actor_user_id, v_event, 'introducer', v_intro, 'not_eligible_fee_type', NULL,\n      jsonb_build_object('fee_event_at', v_fee.fee_event_at, 'fee_type', v_fee.fee_type));\n",
        "",
      ],
    ]),
    checkIneligibleIntroducerFeeType,
  );
  nc("NC20 introducer fee-type rule removed → an insurance fee raises an introducer commission claim; B4B2-32 rejects", {
    effect: (r.exc?.length ?? 0) > 0 || (r.det?.length ?? 0) > 0,
    caught: r.pass === false,
    detail: ncDetail(r) || JSON.stringify(r),
  });
});
await ncSafe("NC21", async () => {
  const [from, to] = OWNER_GATE("  SELECT * INTO v_exc FROM public.finance_commission_exceptions e");
  const r = await onMutant(sqlMutant([[from, to]]), checkExceptionOwnerOnly);
  nc("NC21 exception resolution gated by payout capability → a Supervisor sets a commission percentage; B4B2-27 rejects", {
    effect: r.sup?.ok,
    caught: r.pass === false,
    detail: ncDetail(r),
  });
});
await ncSafe("NC22", async () => {
  const r = await onMutant(
    sqlMutant([
      ["  IF v_ev.payout_status = 'rejected' AND v_note IS NULL THEN\n    RAISE EXCEPTION 'finance_reason_required';\n  END IF;\n", ""],
      [
        "CONSTRAINT finance_payout_transitions_reopen_reason_check CHECK (COALESCE(\n    COALESCE(from_status, '-') || '>' || to_status <> 'rejected>received'\n    OR char_length(btrim(COALESCE(reason, ''))) BETWEEN 1 AND 500, false)\n  )",
        "CONSTRAINT finance_payout_transitions_reopen_reason_check CHECK (true)",
      ],
    ]),
    checkReopenReason,
  );
  nc("NC22 reopen without a reason → rejected commission silently returns to received; B4B2-47 rejects", {
    effect: r.bare?.ok,
    caught: r.pass === false,
    detail: ncDetail(r),
  });
});
await ncSafe("NC23", async () => {
  const r = await onMutant(
    sqlMutant([
      [
        "ADD CONSTRAINT finance_ledger_session_tenant_fkey FOREIGN KEY (session_id, tenant_id)\n    REFERENCES public.interview_sessions (id, tenant_id)",
        "ADD CONSTRAINT finance_ledger_session_tenant_fkey FOREIGN KEY (session_id)\n    REFERENCES public.interview_sessions (id)",
      ],
      [
        "ADD CONSTRAINT finance_ledger_fee_tenant_fkey FOREIGN KEY (fee_line_id, tenant_id)\n    REFERENCES public.finance_fee_lines (id, tenant_id)",
        "ADD CONSTRAINT finance_ledger_fee_tenant_fkey FOREIGN KEY (fee_line_id)\n    REFERENCES public.finance_fee_lines (id)",
      ],
      ["AND cardinality(c.conkey) = 2) <> 5 THEN", "AND cardinality(c.conkey) = 2) <> 3 THEN"],
    ]),
    checkLedgerTenantFk,
  );
  nc("NC23 plain (non-tenant) session / fee FKs → a ledger row in another tenant points at this tenant's case; B4B2-40 rejects", {
    effect: r.r?.ok,
    caught: r.pass === false,
    detail: ncDetail(r) || describe(r.r),
  });
});
const PAYOUT_QUERY = `    let query = supabaseAdmin
      .from("finance_ledger")
      .select(COMMISSION_COLUMNS)
      .eq("event_type", "commission_accrued")
      .eq("tenant_id", tenantId)`;
await ncSafe("NC24", async () => {
  const mod = await mutantOf("finance", [
    [PAYOUT_QUERY, PAYOUT_QUERY.replace('\n      .eq("tenant_id", tenantId)', "")],
  ]);
  if (!mod) throw new Error("anchor missing");
  const q = await checkPayoutQueue(mod);
  nc("NC24 payout queue without the tenant filter → another tenant's Owner sees this tenant's commission; B4B2-63 rejects", {
    effect: q.rowsB.length > 0,
    caught: q.tenantSafe === false,
    detail: describe(q.listB),
  });
});
await ncSafe("NC25", async () => {
  const mod = await mutantOf("finance", [
    [PAYOUT_QUERY, PAYOUT_QUERY.replace('.eq("event_type", "commission_accrued")', '.eq("kind", "commission")')],
  ]);
  if (!mod) throw new Error("anchor missing");
  const q = await checkPayoutQueue(mod);
  nc("NC25 payout queue by kind instead of event type → reversal / clawback rows appear as payable commission; B4B2-62 rejects", {
    effect: q.rowsA.length > 3,
    caught: q.typed === false,
    detail: describe(q.listA),
  });
});

// --- Hardening negative controls (H1 / H2 / H3) -------------------------------------------------
await ncSafe("NC26", async () => {
  const r = await onMutant(
    sqlMutant([["  ELSIF v_hold IS NOT NULL THEN\n    v_kind := 'prior_commission_held';", "  ELSIF false THEN\n    v_kind := 'prior_commission_held';"]]),
    checkH1Rejected,
  );
  nc("NC26 prior-commission hold removed → a correction silently revives a rejected commission as a new payable accrual; B4B2-80 rejects", {
    effect: r.corr?.ok && r.advAcc?.length === 1 && r.advAcc[0].payout_status === "received",
    caught: r.pass === false,
    detail: ncDetail(r),
  });
});
await ncSafe("NC27", async () => {
  const r = await onMutant(
    sqlMutant([
      [
        "  IF v_ev.fee_line_id IS NULL OR EXISTS (\n    SELECT 1 FROM public.finance_fee_lines f\n    WHERE f.id = v_ev.fee_line_id AND f.tenant_id = p_tenant_id AND f.status::text <> 'posted') THEN\n    RAISE EXCEPTION 'finance_fee_not_posted';\n  END IF;\n",
        "",
      ],
    ]),
    checkH1Rejected,
  );
  nc("NC27 payout reopen ignores the fee status → a rejected commission on a reversed fee reopens to payable; B4B2-80 rejects", {
    effect: r.reopen?.ok && r.orig?.payout_status === "received",
    caught: r.pass === false,
    detail: ncDetail(r),
  });
});
await ncSafe("NC28", async () => {
  const r = await onMutant(
    sqlMutant([
      [
        "    SELECT * INTO v_exc FROM public.finance_commission_exceptions e\n    WHERE e.tenant_id = p_tenant_id AND e.fee_line_id = v_cur\n      AND e.exception_kind = 'prior_commission_held'",
        "    SELECT * INTO v_exc FROM public.finance_commission_exceptions e\n    WHERE false AND e.tenant_id = p_tenant_id AND e.fee_line_id = v_cur\n      AND e.exception_kind = 'prior_commission_held'",
      ],
      [
        "    SELECT f.corrects_fee_line_id INTO v_cur FROM public.finance_fee_lines f\n    WHERE f.id = v_cur AND f.tenant_id = p_tenant_id;\n  END LOOP;",
        "    v_cur := NULL;\n  END LOOP;",
      ],
    ]),
    checkH1HeldChain,
  );
  nc("NC28 correction chain walk removed → a correction of a correction revives the rejected commission; B4B2-84 rejects", {
    effect: r.corr2?.ok && r.advAcc?.length === 1,
    caught: r.pass === false,
    detail: ncDetail(r),
  });
});
await ncSafe("NC29", async () => {
  const r = await onMutant(
    sqlMutant([
      [
        "'clawback', v_reason, 'owner_clawback');",
        "'clawback', v_reason, 'fee_reversed');",
      ],
    ]),
    checkH1OwnerClawback,
  );
  nc("NC29 Owner clawback recorded as a reversal → the clawed-back commission is paid again on the correction; B4B2-83 rejects", {
    effect: r.corr?.ok && r.advAcc?.length === 1,
    caught: r.pass === false,
    detail: ncDetail(r),
  });
});
await ncSafe("NC30", async () => {
  const r = await onMutant(
    sqlMutant([
      ["CREATE UNIQUE INDEX finance_fee_lines_one_correction_key\n  ON public.finance_fee_lines (corrects_fee_line_id) WHERE corrects_fee_line_id IS NOT NULL;", ""],
      [
        "  IF EXISTS (SELECT 1 FROM public.finance_fee_lines f\n             WHERE f.tenant_id = p_tenant_id AND f.corrects_fee_line_id = v_orig.id) THEN\n    RAISE EXCEPTION 'finance_fee_already_corrected';\n  END IF;\n",
        "",
      ],
    ]),
    checkCorrectionOnce,
  );
  nc("NC30 one-correction rule removed → a second correction of the same reversed fee accrues the adviser twice; B4B2-85 rejects", {
    effect: r.c2?.ok && r.n === 2 && r.adv === 2,
    caught: r.pass === false,
    detail: ncDetail(r),
  });
});
await ncSafe("NC31", async () => {
  const r = await onMutant(
    sqlMutant([
      [
        "    IF NEW.beneficiary_role = 'referrer' OR NEW.referral_id IS NOT NULL THEN\n      RAISE EXCEPTION 'finance_raf_accrual_deferred';\n    END IF;",
        "    IF NEW.beneficiary_role = 'referrer' THEN\n      NEW.idempotency_key := 'raf:' || NEW.referral_id::text;\n      RETURN NEW;\n    END IF;",
      ],
      ["      AND beneficiary_role IS NOT NULL AND economic_at IS NOT NULL\n", "      AND beneficiary_role IS NOT NULL\n"],
    ]),
    checkRafUndatedAccrual,
  );
  nc("NC31 dated-accrual rule and RAF deferral removed → an undated payable RAF accrual enters the canonical ledger; B4B2-61 rejects", {
    effect: r.ins?.ok && r.rows?.length === 1 && r.rows[0].economic_at === null && r.rows[0].payout_status === "received",
    caught: r.pass === false,
    detail: ncDetail(r) || describe(r.ins),
  });
});
await ncSafe("NC32", async () => {
  const mod = await mutantOf("referrals", [['if (changing && current === "paid") {', "if (false) {"]]);
  if (!mod) throw new Error("anchor missing");
  const r = await checkRafPaidTerminal(mod);
  nc("NC32 RAF paid not final → an Owner reopens a paid referral bonus; B4B2-59 rejects", {
    effect: r.back?.ok && r.bonus !== "paid",
    caught: r.pass === false,
    detail: describe(r.back),
  });
});
await ncSafe("NC33", async () => {
  const mod = await mutantOf("referrals", [
    [
      '(data.bonusStatus === "paid" || data.bonusStatus === "rejected") && !payoutActor) {',
      '(data.bonusStatus === "paid" || data.bonusStatus === "rejected") && false) {',
    ],
  ]);
  if (!mod) throw new Error("anchor missing");
  const r = await checkRafPayoutAuthority(mod);
  nc("NC33 RAF payout gate removed → General marks a referral bonus paid; B4B2-59 rejects", {
    effect: r.gPaid?.ok,
    caught: r.pass === false,
    detail: describe(r.gPaid),
  });
});
await ncSafe("NC34", async () => {
  const r = await onMutant(
    sqlMutant([
      ["IF NOT FOUND OR v_corr.status::text <> 'amended' OR v_corr.fee_event_at IS NULL", "IF NOT FOUND OR v_corr.fee_event_at IS NULL"],
      [
        "         OR NOT EXISTS (SELECT 1 FROM public.finance_ledger g\n                        WHERE g.tenant_id = v_corr.tenant_id AND g.fee_line_id = v_corr.id\n                          AND g.event_type = 'fee_reversed') THEN",
        " THEN",
      ],
      ["  IF v_orig.status::text <> 'amended' THEN\n    RAISE EXCEPTION 'finance_fee_not_reversed';\n  END IF;\n", ""],
    ]),
    checkH3Reversed,
  );
  nc("NC34 reversed-original requirement removed → a live posted fee is 'corrected' and the same economic event is posted twice; B4B2-88 rejects", {
    effect: r.rpc?.ok && r.both === 2,
    caught: r.pass === false,
    detail: ncDetail(r) || describe(r.rpc),
  });
});
await ncSafe("NC35", async () => {
  const r = await onMutant(
    sqlMutant([
      [
        "      IF NEW.fee_event_date IS NOT NULL OR NEW.fee_event_at IS NOT NULL\n         OR NEW.fee_event_source IS NOT NULL THEN\n        RAISE EXCEPTION 'finance_fee_line_correction_date_supplied';\n      END IF;\n",
        "",
      ],
      [
        "      NEW.fee_event_date := v_corr.fee_event_date;\n      NEW.fee_event_at := v_corr.fee_event_at;",
        "      NEW.fee_event_date := COALESCE(NEW.fee_event_date, v_corr.fee_event_date);\n      NEW.fee_event_at := NEW.fee_event_date::timestamp AT TIME ZONE 'Europe/London';",
      ],
    ]),
    checkH3Override,
  );
  nc("NC35 supplied correction date honoured → a correction is dated to an arbitrary day; B4B2-90 rejects", {
    effect: r.otherDate?.ok && r.otherDate.rows?.[0]?.ed === "2025-06-02",
    caught: r.pass === false,
    detail: ncDetail(r) || describe(r.otherDate),
  });
});
await ncSafe("NC36", async () => {
  const r = await onMutant(
    sqlMutant([
      [
        "      IF NOT EXISTS (SELECT 1 FROM public.tenant_memberships m\n                     WHERE m.user_id = NEW.created_by AND m.tenant_id = NEW.tenant_id\n                       AND m.active AND m.role::text = 'owner') THEN\n        RAISE EXCEPTION 'finance_fee_line_correction_owner_required';\n      END IF;",
        "",
      ],
    ]),
    checkH3Authority,
  );
  nc("NC36 Owner proof removed from the guard → a Supervisor-created correction inherits the reversed fee's date; B4B2-87 rejects", {
    effect: r.sup?.ok,
    caught: r.pass === false,
    detail: ncDetail(r),
  });
});
await ncSafe("NC37", async () => {
  const r = await onMutant(
    sqlMutant([
      ["      WHERE f.id = NEW.corrects_fee_line_id AND f.tenant_id = NEW.tenant_id;", "      WHERE f.id = NEW.corrects_fee_line_id;"],
      ["         OR NEW.session_id IS DISTINCT FROM v_corr.session_id\n", ""],
      [
        "FOREIGN KEY (corrects_fee_line_id, tenant_id)\n    REFERENCES public.finance_fee_lines (id, tenant_id)",
        "FOREIGN KEY (corrects_fee_line_id)\n    REFERENCES public.finance_fee_lines (id)",
      ],
    ]),
    checkH3Tenant,
  );
  nc("NC37 tenant-scoped correction reference removed → another tenant's Owner creates a correction inheriting this tenant's fee date and evidence; B4B2-89 rejects", {
    effect: r.xt?.ok,
    caught: r.pass === false,
    detail: ncDetail(r),
  });
});
await ncSafe("NC38", async () => {
  const r = await onMutant(
    sqlMutant([
      [
        "    IF (OLD.status::text = 'draft' AND v_changed <@ ARRAY['note', 'updated_at'])\n       OR v_changed <@ ARRAY['updated_at'] THEN",
        "    IF (OLD.status::text = 'draft' AND v_changed <@ ARRAY['note', 'updated_at'])\n       OR v_changed <@ ARRAY['updated_at'] OR OLD.status::text = 'amended' THEN",
      ],
    ]),
    checkH3Immutable,
  );
  nc("NC38 reversed-fee immutability removed → the reversed original's amount is rewritten; B4B2-91 rejects", {
    effect: r.amount === 1,
    caught: r.pass === false,
    detail: ncDetail(r),
  });
});
await ncSafe("NC39", async () => {
  const r = await onMutant(
    sqlMutant([
      [
        "      IF NOT public.finance_b4b2_writer() OR NEW.source_network_line_id IS NOT NULL THEN\n        RAISE EXCEPTION 'finance_fee_line_correction_invalid';",
        "      IF NOT public.finance_b4b2_writer() THEN\n        RAISE EXCEPTION 'finance_fee_line_correction_invalid';",
      ],
      [
        "    OR (fee_event_date IS NOT NULL AND source_network_line_id IS NULL\n      AND corrects_fee_line_id IS NOT NULL AND fee_event_source = 'owner_correction'",
        "    OR (fee_event_date IS NOT NULL\n      AND corrects_fee_line_id IS NOT NULL AND fee_event_source = 'owner_correction'",
      ],
      ["num_nonnulls(source_network_line_id, corrects_fee_line_id) <= 1", "num_nonnulls(source_network_line_id, corrects_fee_line_id) <= 2"],
    ]),
    checkH3Network,
  );
  nc("NC39 network provenance allowed on a correction → a correction claims a network statement line it was never allocated from; B4B2-92 rejects", {
    effect: r.withLine?.ok,
    caught: r.pass === false,
    detail: ncDetail(r) || describe(r.withLine),
  });
});

// =============================================================================================
// SUMMARY
// =============================================================================================
const failedNcs = ncResults.filter((r) => !r.pass);
console.log("");
console.log(`TEST_CASES=${total}`);
console.log(`TESTS_PASS=${total - failures.length}`);
console.log(`NEGATIVE_CONTROL_COUNT=${ncResults.length}`);
console.log(`NEGATIVE_CONTROLS_PASS=${ncResults.length - failedNcs.length}`);
const allPass = failures.length === 0 && failedNcs.length === 0;
console.log(`RESULT=${allPass ? "PASS" : "FAIL"}`);
process.exit(allPass ? 0 : 1);
