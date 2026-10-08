/**
 * G7F-4S4C4-B4b1 statement / economic-date / adviser-history foundation — offline verification.
 *
 * Network statements and lines are owned by one tenant; a network fee's economic date is the line
 * transaction date, else the staff-confirmed statement received date; fee lines carry that date
 * from allocation; allocation is atomic and idempotent, deallocation voids drafts only, re-parse
 * supersedes, validation reconciles and freezes without posting, unlock is Owner-only with a
 * reason; adviser assignments are append-only history with an as-of resolver.
 *
 * The real B3, B4a and B4b1 migrations are applied verbatim to an in-process PostgreSQL (PGlite,
 * WASM) holding the staging shapes of the finance, network statement and assignment tables
 * (column order, enums, keys, grants, policies), seeded with the staging pattern (two undated
 * draft fee lines, one tenantless October draft statement with no lines, no network lines, no
 * ledger rows, three tenant-stamped and three tenantless session_advisors rows). The real server
 * functions (network statements, finance, sessions, booking) then run against it through a fake
 * PostgREST layer on a non-routable host; service-role requests execute as the `service_role`
 * database role and client requests as `authenticated`, so grants, RLS and triggers are enforced.
 *
 * Every negative control mutates real source or the real migration, demonstrates the unsafe
 * effect on the database, and shows the corresponding test predicate rejects the mutant.
 *
 * PGlite is one connection: concurrent allocation is exercised as interleaved requests plus a
 * forced second insert past the operation's own check (the row lock and the partial unique index
 * are what make real parallel calls safe).
 *
 * Synthetic fixtures only: no network, no staging, no production, no real user, no real token.
 * Stubbed (not under test): MFA freshness, Super Owner gate, platform Enter Company sessions,
 * SMS delivery, the AI statement extraction (returns fixed lines), welcome-call task creation.
 *
 * PGlite: npm install --prefix /tmp/g7f4s3b/pglite @electric-sql/pglite@0.5.8
 * Run: npm exec --yes --package=tsx -- tsx scripts/g7f4s4c4b4b1-statement-foundation-verify.mjs
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
const SELF_REL = "scripts/g7f4s4c4b4b1-statement-foundation-verify.mjs";
const AUTHORISED = [B4B1_REL, FINANCE_REL, NETWORK_REL, PANEL_REL, SELF_REL];
const BASELINE_SHA = "deb0a82fb12091ceb017cefc31d937fb7ae2764a";

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
export function getRequest() { return globalThis.__B4B1_REQUEST ?? null; }
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
  (globalThis.__B4B1_SMS ??= []).push({ to: opts.to });
  return { sid: "SMxB4B1" + String(globalThis.__B4B1_SMS.length) };
}
`;
const stubMfa = `
export * from ${JSON.stringify(fileUrl("src/lib/privileged-mfa.server.ts"))};
export async function requireFreshPrivilegedAuth() {}
export async function requirePlatformAal2() {}
`;
const stubOpenAi = `
export async function chatCompletion() {
  return JSON.stringify({ lines: globalThis.__B4B1_AI_LINES ?? [] });
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
const pick = (k) => (...a) => ((globalThis.__B4B1_RATES && globalThis.__B4B1_RATES[k]) || real[k])(...a);
${RATES_FNS.map((k) => `export const ${k} = pick(${JSON.stringify(k)});`).join("\n")}
export const COMMISSION_FEE_TYPES = real.COMMISSION_FEE_TYPES;
export const INTRODUCER_FEE_TYPES = real.INTRODUCER_FEE_TYPES;
export const RATE_ERROR_MESSAGES = real.RATE_ERROR_MESSAGES;
`;
const MUTANT_KEYS = {
  finance: fileUrl(FINANCE_REL),
  network: fileUrl(NETWORK_REL),
  rates: fileUrl(RATES_REL),
};
const mutantMark = (key) => `/*b4b1-mutant:${key}*/`;
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

const applyMigration = (db, text = b4b1Sql) => outcome(() => execOn(db, text));
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
const FAKE_HOST = "g7f4s4c4b4b1.invalid";
const PUBLISHABLE = "sb_publishable_g7f4s4c4b4b1_not_a_real_key";
process.env.SUPABASE_URL = `http://${FAKE_HOST}`;
process.env.VITE_SUPABASE_URL = `http://${FAKE_HOST}`;
process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_secret_g7f4s4c4b4b1_not_a_real_key";
process.env.SUPABASE_PUBLISHABLE_KEY = PUBLISHABLE;
process.env.VITE_SUPABASE_PUBLISHABLE_KEY = PUBLISHABLE;
const USER_HEADER = "x-g7f4s4c4b4b1-user";

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
    throw new Error(`G7F4S4C4B4B1 fetch stub refused host ${url.hostname}`);
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
      if (process.env.G7F4S4C4B4B1_DEBUG) orig(...a);
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

const SRC = {
  finance: read(FINANCE_REL),
  network: read(NETWORK_REL),
  panel: read(PANEL_REL),
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
  globalThis.__B4B1_REQUEST = slug
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
  globalThis.__B4B1_AI_LINES = lines;
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
  const db = await preB4b1Db(seedMutate);
  const m = await applyMigration(db, text);
  if (!m.ok) return { migrationFailed: m.message };
  return withDb(db, fn);
}

// --- reusable checks (each is self-contained and is also the negative-control predicate) ------
async function checkArchive(db, before) {
  const archived = (
    await sqlOn(
      db,
      `select a::text as t from public.network_commission_statements_unowned_pre_b4b1 a order by id`,
    )
  ).map((r) => r.t);
  const live = await sqlOn(
    db,
    `select id, tenant_id from public.network_commission_statements where id = $1`,
    [R.octTenantless],
  );
  const clientRead = await asRole(
    db,
    "authenticated",
    `select count(*) from public.network_commission_statements_unowned_pre_b4b1`,
    [],
    U.ownerA,
  );
  const svcRead = await asRole(
    db,
    "service_role",
    `select count(*)::int as n from public.network_commission_statements_unowned_pre_b4b1`,
  );
  const svcWrite = await asRole(
    db,
    "service_role",
    `update public.network_commission_statements_unowned_pre_b4b1 set notes = 'x'`,
  );
  return {
    pass:
      before.length === 1 &&
      JSON.stringify(archived) === JSON.stringify(before) &&
      live.length === 0 &&
      !clientRead.ok &&
      svcRead.ok &&
      svcRead.rows[0].n === 1 &&
      !svcWrite.ok,
    archived,
    live,
  };
}
async function checkDateRequired() {
  const s = await freshStatement([aiLine({ ref: "MG-B4B1-A1", pounds: 33 })]);
  const line = s.lines[0];
  const st = await stmtOf(s.id);
  const r = await allocate(line.id);
  const fees = await sqlOn(
    pg,
    `select fee_event_date::text as d, fee_event_source from public.finance_fee_lines
     where source_network_line_id = $1`,
    [line.id],
  );
  const after = await lineOf(line.id);
  return {
    pass:
      line.tx_date === null &&
      st.received_date === null &&
      !r.ok &&
      /no transaction date/.test(r.message) &&
      fees.length === 0 &&
      after.allocation_status === "matched",
    r,
    fees,
  };
}
async function checkUniqueActive() {
  const s = await freshStatement([
    aiLine({ ref: "MG-B4B1-A1", pounds: 44, date: winterDate }),
    aiLine({ name: "Race Two", pounds: 45, date: winterDate }),
  ]);
  const [l1, l2] = s.lines;
  const same = await Promise.all([
    allocate(l1.id, { sessionId: R.sessA1 }),
    allocate(l1.id, { sessionId: R.sessA1 }),
  ]);
  const diff = await Promise.all([
    allocate(l2.id, { sessionId: R.sessA1 }),
    allocate(l2.id, { sessionId: R.sessA2 }),
  ]);
  const forced = await svc(
    `insert into public.finance_fee_lines (session_id, fee_type, amount_pence, status, tenant_id,
       source_network_line_id) values ($1, 'fee', 4400, 'draft', $2, $3)`,
    [R.sessA1, T.a, l1.id],
  );
  const active1 = await activeFees(l1.id);
  const active2 = await activeFees(l2.id);
  const created = same
    .filter((x) => x.ok)
    .map((x) => x.value.created)
    .sort();
  return {
    pass:
      same.every((x) => x.ok) &&
      same[0].value.feeLineId === same[1].value.feeLineId &&
      JSON.stringify(created) === JSON.stringify([false, true]) &&
      diff.filter((x) => x.ok).length === 1 &&
      diff.some((x) => !x.ok && /already allocated to a different case/.test(x.message)) &&
      !forced.ok &&
      forced.code === "23505" &&
      active1 === 1 &&
      active2 === 1,
    forced,
    active1,
    active2,
    detail: describe(...same, ...diff),
  };
}
async function checkValidateNoPost() {
  const s = await reconciledStatement();
  const feesBefore = (await rowsText(pg, "public.finance_fee_lines")).sort();
  const ledgerBefore = await countOf(pg, "public.finance_ledger");
  const v = await call(
    nf.validateNetworkStatement,
    { statementId: s.id, action: "validate" },
    U.supA,
  );
  const st = await stmtOf(s.id);
  const fee = await feeOf(s.feeId);
  const feesAfter = (await rowsText(pg, "public.finance_fee_lines")).sort();
  const ledgerAfter = await countOf(pg, "public.finance_ledger");
  return {
    pass:
      v.ok &&
      st.status === "validated" &&
      st.validated_by === U.supA &&
      fee.st === "draft" &&
      fee.posted_at === null &&
      JSON.stringify(feesAfter) === JSON.stringify(feesBefore) &&
      ledgerAfter === ledgerBefore,
    v,
    fee,
    ledgerDelta: ledgerAfter - ledgerBefore,
  };
}
async function checkUnlockOwnerOnly(mod = nf) {
  const s = await validatedStatement();
  const tsSup = await call(
    mod.validateNetworkStatement,
    { statementId: s.id, action: "unlock", reason: "supervisor attempt" },
    U.supA,
  );
  const rpcSup = await unlockRpc(U.supA, s.id, "supervisor attempt");
  const rpcGen = await unlockRpc(U.genA, s.id, "general attempt");
  const st = await stmtOf(s.id);
  return {
    pass:
      !tsSup.ok &&
      /Only an Owner/.test(tsSup.message) &&
      !rpcSup.ok &&
      /network_finance_forbidden/.test(rpcSup.message) &&
      !rpcGen.ok &&
      st.status === "validated" &&
      st.last_unlocked_at === null,
    st,
    detail: describe(tsSup, rpcSup, rpcGen),
  };
}
async function checkUnlockReason(mod = nf) {
  const s = await validatedStatement();
  const none = await call(
    mod.validateNetworkStatement,
    { statementId: s.id, action: "unlock" },
    U.ownerA,
  );
  const blank = await call(
    mod.validateNetworkStatement,
    { statementId: s.id, action: "unlock", reason: "   " },
    U.ownerA,
  );
  const rpc = await unlockRpc(U.ownerA, s.id, "  ");
  const st = await stmtOf(s.id);
  return {
    pass:
      !none.ok &&
      !blank.ok &&
      !rpc.ok &&
      /network_unlock_reason_required/.test(rpc.message) &&
      st.status === "validated",
    st,
    detail: describe(none, blank, rpc),
  };
}
async function checkUnlockPostedFee() {
  const s = await validatedStatement();
  await asFixture(
    pg,
    `update public.finance_fee_lines set status = 'posted', posted_at = now() where id = $1`,
    [s.feeId],
  );
  const r = await call(
    nf.validateNetworkStatement,
    { statementId: s.id, action: "unlock", reason: "correction needed" },
    U.ownerA,
  );
  const direct = await svc(
    `update public.network_commission_statements set status = 'draft', validated_by = null,
       validated_at = null, last_unlocked_by = $2, last_unlocked_at = now(),
       last_unlock_reason = 'direct' where id = $1`,
    [s.id, U.ownerA],
  );
  const st = await stmtOf(s.id);
  return {
    pass:
      !r.ok &&
      /posted fees/.test(r.message) &&
      !direct.ok &&
      /network_unlock_posted_fee/.test(direct.message) &&
      st.status === "validated",
    st,
    detail: describe(r, direct),
  };
}
async function checkReparseSupersedes() {
  const s = await freshStatement([
    aiLine({ name: "Old One", pounds: 10 }),
    aiLine({ name: "Old Two", pounds: 20 }),
  ]);
  const oldIds = s.lines.map((l) => l.id);
  const oldBatch = s.lines[0].parse_batch_id;
  const p = await parseLines(s.id, [
    aiLine({ name: "New One", pounds: 11 }),
    aiLine({ name: "New Two", pounds: 21 }),
    aiLine({ name: "New Three", pounds: 31 }),
  ]);
  const all = await sqlOn(
    pg,
    `select id, superseded_at, superseded_by from public.network_commission_lines where statement_id = $1`,
    [s.id],
  );
  const cur = await currentLines(s.id);
  const detail = await call(nf.getNetworkStatementDetail, { statementId: s.id }, U.ownerA);
  return {
    pass:
      p.ok &&
      all.length === 5 &&
      oldIds.every((id) => {
        const r = all.find((x) => x.id === id);
        return r && r.superseded_at && r.superseded_by === U.ownerA;
      }) &&
      cur.length === 3 &&
      cur.map((l) => l.line_no).join(",") === "1,2,3" &&
      cur.every((l) => l.parse_batch_id && l.parse_batch_id !== oldBatch) &&
      detail.ok &&
      detail.value.lines.length === 3 &&
      detail.value.lines.every((l) => !oldIds.includes(l.id)),
    total: all.length,
    s,
    p,
  };
}
async function checkReparseActive() {
  const s = await freshStatement([
    aiLine({ ref: "MG-B4B1-A1", pounds: 15, date: winterDate }),
    aiLine({ name: "Other", pounds: 5 }),
  ]);
  const line = s.lines[0];
  const a = await allocate(line.id);
  const before = (await currentLines(s.id)).map((l) => l.id).join(",");
  const p = await parseLines(s.id, [aiLine({ name: "Replacement", pounds: 20 })]);
  const after = (await currentLines(s.id)).map((l) => l.id).join(",");
  const orphans = await countOf(
    pg,
    "public.finance_fee_lines f join public.network_commission_lines l on l.id = f.source_network_line_id",
    "l.statement_id = $1 and l.superseded_at is not null and f.status <> 'deleted'",
    [s.id],
  );
  return {
    pass:
      a.ok &&
      !p.ok &&
      /Deallocate every allocated line/.test(p.message) &&
      before === after &&
      orphans === 0,
    orphans,
    p,
  };
}
async function checkDeallocPosted() {
  const s = await freshStatement([
    aiLine({ ref: "MG-B4B1-A1", pounds: 16, date: winterDate }),
    aiLine({ ref: "MG-B4B1-A2", pounds: 17, date: winterDate }),
  ]);
  const [l1, l2] = s.lines;
  const a1 = await allocate(l1.id);
  const a2 = await allocate(l2.id);
  await asFixture(
    pg,
    `update public.finance_fee_lines set status = 'posted', posted_at = now() where id = $1`,
    [a1.value.feeLineId],
  );
  const ledger = await svc(
    `insert into public.finance_ledger (kind, session_id, fee_line_id, fee_type, amount_pence, tenant_id)
     values ('post', $1, $2, 'fee', 1700, $3) returning id`,
    [R.sessA2, a2.value.feeLineId, T.a],
  );
  const r1 = await call(
    nf.deallocateNetworkLine,
    { lineId: l1.id, reason: "try posted" },
    U.ownerA,
  );
  const r2 = await call(
    nf.deallocateNetworkLine,
    { lineId: l2.id, reason: "try ledger" },
    U.ownerA,
  );
  const f1 = await feeOf(a1.value.feeLineId);
  const f2 = await feeOf(a2.value.feeLineId);
  const line1 = await lineOf(l1.id);
  if (ledger.ok) await svc(`delete from public.finance_ledger where id = $1`, [ledger.rows[0].id]);
  return {
    pass:
      a1.ok &&
      a2.ok &&
      ledger.ok &&
      !r1.ok &&
      /no longer a draft/.test(r1.message) &&
      !r2.ok &&
      f1.st === "posted" &&
      f2.st === "draft" &&
      line1.allocation_status === "allocated",
    f1,
    detail: describe(r1, r2),
  };
}
async function checkTotalReconcile() {
  const s = await reconciledStatement();
  const d = await call(
    nf.setNetworkStatementDeclaredTotal,
    { statementId: s.id, declaredTotalPence: 11999 },
    U.ownerA,
  );
  const v = await call(
    nf.validateNetworkStatement,
    { statementId: s.id, action: "validate" },
    U.ownerA,
  );
  const st = await stmtOf(s.id);
  return {
    pass: d.ok && !v.ok && /do not add up/.test(v.message) && st.status !== "validated",
    st,
    v,
  };
}
async function checkFreeze() {
  const s = await freshStatement([
    aiLine({ ref: "MG-B4B1-A1", pounds: 30, date: winterDate }),
    aiLine({ name: "Skip Me", pounds: 7 }),
  ]);
  const [l1, l2] = s.lines;
  const a = await allocate(l1.id);
  await call(nf.setNetworkLineSkip, { lineId: l2.id, skip: true, reason: "not ours" }, U.ownerA);
  await call(
    nf.setNetworkStatementDeclaredTotal,
    { statementId: s.id, declaredTotalPence: 3700 },
    U.ownerA,
  );
  const v = await call(
    nf.validateNetworkStatement,
    { statementId: s.id, action: "validate" },
    U.ownerA,
  );
  const snap = async () =>
    JSON.stringify({
      st: (await stmtOf(s.id))?.t,
      lines: (
        await sqlOn(
          pg,
          `select l::text as t from public.network_commission_lines l where statement_id = $1 order by id`,
          [s.id],
        )
      ).map((r) => r.t),
      fee: (await feeOf(a.value.feeLineId))?.t,
    });
  const before = await snap();
  const attempts = {
    reparse: await parseLines(s.id, [aiLine({ name: "New", pounds: 1 })]),
    allocate: await allocate(l2.id, { sessionId: R.sessA2 }),
    deallocate: await call(nf.deallocateNetworkLine, { lineId: l1.id, reason: "frozen" }, U.ownerA),
    unskip: await call(nf.setNetworkLineSkip, { lineId: l2.id, skip: false }, U.ownerA),
    date: await call(
      nf.setNetworkLineTransactionDate,
      { lineId: l2.id, transactionDate: winterDate },
      U.ownerA,
    ),
    annotate: await call(
      nf.annotateNetworkLine,
      { lineId: l1.id, annotation: "late note" },
      U.ownerA,
    ),
    received: await call(
      nf.confirmNetworkStatementReceivedDate,
      { statementId: s.id, receivedDate: winterDate, confirmed: true },
      U.ownerA,
    ),
    declared: await call(
      nf.setNetworkStatementDeclaredTotal,
      { statementId: s.id, declaredTotalPence: 1 },
      U.ownerA,
    ),
    directAnnotation: await svc(
      `update public.network_commission_lines set annotation = 'direct' where id = $1`,
      [l1.id],
    ),
    directSkip: await svc(
      `update public.network_commission_lines set skip_reason = 'changed' where id = $1`,
      [l2.id],
    ),
    directDate: await svc(
      `update public.network_commission_lines set transaction_date = $2, transaction_date_source = 'staff_entry',
         transaction_date_set_by = $3, transaction_date_set_at = now() where id = $1`,
      [l2.id, winterDate, U.ownerA],
    ),
    directMatch: await svc(
      `update public.network_commission_lines set matched_session_id = $2 where id = $1`,
      [l2.id, R.sessA2],
    ),
    directVoid: await svc(
      `update public.finance_fee_lines set status = 'deleted', voided_at = now(), voided_by = $2,
         void_reason = 'direct' where id = $1`,
      [a.value.feeLineId, U.ownerA],
    ),
    directNotes: await svc(
      `update public.network_commission_statements set notes = 'direct' where id = $1`,
      [s.id],
    ),
  };
  const after = await snap();
  const allowed = Object.entries(attempts)
    .filter(([, r]) => r.ok)
    .map(([k]) => k);
  return {
    pass: a.ok && v.ok && allowed.length === 0 && before === after,
    allowed,
    changed: before !== after,
  };
}
async function checkResolverAsOf() {
  const resolve = (tenant, session, at) =>
    svc(
      `select resolution, adviser_user_id, history_complete
       from public.resolve_session_advisers_as_of($1, $2, $3)`,
      [tenant, session, at],
    );
  const shape = (x) =>
    x.ok
      ? x.rows
          .map((r) => `${r.resolution}:${r.adviser_user_id ?? "-"}:${r.history_complete}`)
          .join("|")
      : `error:${x.message}`;
  const capture = new Date(
    (await one(`select started_at from public.session_adviser_history_capture`)).started_at,
  );
  await sleep(10);
  const ins = await svc(
    `insert into public.session_advisors (session_id, advisor_id, assigned_by, tenant_id) values ($1, $2, $3, $4)`,
    [R.sessHist, U.advA2, U.ownerA, T.a],
  );
  await sleep(25);
  const del = await svc(
    `delete from public.session_advisors where session_id = $1 and advisor_id = $2`,
    [R.sessHist, U.advA2],
  );
  await sleep(25);
  const again = await svc(
    `insert into public.session_advisors (session_id, advisor_id, assigned_by, tenant_id) values ($1, $2, $3, $4)`,
    [R.sessHist, U.advA2, U.ownerA, T.a],
  );
  await sleep(10);
  const second = await svc(
    `insert into public.session_advisors (session_id, advisor_id, assigned_by, tenant_id) values ($1, $2, $3, $4)`,
    [R.sessHist, U.advA3, U.ownerA, T.a],
  );
  await sleep(10);
  const ivs = await sqlOn(
    pg,
    `select assigned_at, unassigned_at from public.session_adviser_assignments
     where session_id = $1 and adviser_user_id = $2 order by assigned_at`,
    [R.sessHist, U.advA2],
  );
  const first = ivs[0];
  const t1 = new Date(first?.assigned_at ?? 0).getTime();
  const t2 = new Date(first?.unassigned_at ?? 0).getTime();
  const t3 = new Date(ivs[1]?.assigned_at ?? 0).getTime();
  const iso = (ms) => new Date(ms).toISOString();
  const nowIso = new Date().toISOString();
  const r = {
    mid: shape(await resolve(T.a, R.sessHist, iso((t1 + t2) / 2))),
    before: shape(await resolve(T.a, R.sessHist, iso((capture.getTime() + t1) / 2))),
    gap: shape(await resolve(T.a, R.sessHist, iso((t2 + t3) / 2))),
    preCapture: shape(await resolve(T.a, R.sessHist, iso(capture.getTime() - DAY))),
    now: shape(await resolve(T.a, R.sessHist, nowIso)),
    foreign: shape(await resolve(T.b, R.sessHist, nowIso)),
    tenantless: shape(await resolve(T.a, R.sessTL1, nowIso)),
    nullAt: shape(await resolve(T.a, R.sessHist, null)),
    client: shape(
      await asRole(
        pg,
        "authenticated",
        `select * from public.resolve_session_advisers_as_of($1, $2, $3)`,
        [T.a, R.sessHist, nowIso],
        U.ownerA,
      ),
    ),
  };
  return {
    pass:
      ins.ok &&
      del.ok &&
      again.ok &&
      second.ok &&
      t1 < t2 &&
      t2 <= t3 &&
      r.mid === `assigned:${U.advA2}:true` &&
      r.before === "none_assigned:-:true" &&
      r.gap === "none_assigned:-:true" &&
      r.preCapture === "no_proof:-:false" &&
      r.now === `assigned:${U.advA2}:true|assigned:${U.advA3}:true` &&
      /session_adviser_resolve_not_found/.test(r.foreign) &&
      /session_adviser_resolve_not_found/.test(r.tenantless) &&
      /session_adviser_resolve_invalid/.test(r.nullAt) &&
      /permission denied/.test(r.client),
    r,
  };
}
async function checkHistoryDirect() {
  const before = await countOf(pg, "public.session_adviser_assignments");
  const forged = await svc(
    `insert into public.session_adviser_assignments (tenant_id, session_id, adviser_user_id,
       adviser_capacity, assigned_at, source)
     values ($1, $2, $3, 'adviser', '2026-01-01T00:00:00Z', 'session_advisors_insert')`,
    [T.a, R.sessS4C2, U.advA3],
  );
  const open = await one(
    `select id from public.session_adviser_assignments where unassigned_at is null order by recorded_at limit 1`,
  );
  const close = await svc(
    `update public.session_adviser_assignments set unassigned_at = now(), unassigned_recorded_at = now()
     where id = $1`,
    [open.id],
  );
  const backdate = await svc(
    `update public.session_adviser_assignments set assigned_at = assigned_at - interval '1 day' where id = $1`,
    [open.id],
  );
  const del = await svc(`delete from public.session_adviser_assignments where id = $1`, [open.id]);
  const superDel = await outcome(() =>
    sql(`delete from public.session_adviser_assignments where id = $1`, [open.id]),
  );
  const superTrunc = await outcome(() => sql(`truncate public.session_adviser_assignments`));
  const clientRead = await asRole(
    pg,
    "authenticated",
    `select count(*) from public.session_adviser_assignments`,
    [],
    U.ownerA,
  );
  const identity = await svc(`update public.session_advisors set advisor_id = $2 where id = $1`, [
    R.saB1,
    U.advA3,
  ]);
  const truncSa = await asRole(
    pg,
    "authenticated",
    `truncate public.session_advisors`,
    [],
    U.ownerA,
  );
  const after = await countOf(pg, "public.session_adviser_assignments");
  const saB1 = await countOf(pg, "public.session_advisors", "id = $1", [R.saB1]);
  return {
    pass:
      !forged.ok &&
      /session_adviser_history_direct_write_forbidden/.test(forged.message) &&
      !close.ok &&
      !backdate.ok &&
      !del.ok &&
      !superDel.ok &&
      !superTrunc.ok &&
      !clientRead.ok &&
      !identity.ok &&
      /session_adviser_identity_immutable/.test(identity.message) &&
      !truncSa.ok &&
      after === before &&
      saB1 === 1,
    forged,
    after,
    before,
    detail: describe(
      forged,
      close,
      backdate,
      del,
      superDel,
      superTrunc,
      clientRead,
      identity,
      truncSa,
    ),
  };
}
async function checkFeeImmutable() {
  const s = await freshStatement([aiLine({ ref: "MG-B4B1-A1", pounds: 18, date: winterDate })]);
  const a = await allocate(s.lines[0].id);
  const id = a.value.feeLineId;
  const core = async () =>
    (
      await one(
        `select (to_jsonb(f) - array['note', 'updated_at'])::text as j from public.finance_fee_lines f where id = $1`,
        [id],
      )
    ).j;
  const before = await core();
  const attempts = {
    amount: await svc(`update public.finance_fee_lines set amount_pence = 1 where id = $1`, [id]),
    date: await svc(
      `update public.finance_fee_lines set fee_event_date = fee_event_date - 1,
         fee_event_at = ((fee_event_date - 1)::timestamp at time zone 'Europe/London') where id = $1`,
      [id],
    ),
    session: await svc(`update public.finance_fee_lines set session_id = $2 where id = $1`, [
      id,
      R.sessA2,
    ]),
    source: await svc(
      `update public.finance_fee_lines set fee_event_source = 'network_statement_received_date' where id = $1`,
      [id],
    ),
    feeType: await svc(`update public.finance_fee_lines set fee_type = 'other_fee' where id = $1`, [
      id,
    ]),
    post: await svc(
      `update public.finance_fee_lines set status = 'posted', posted_at = now() where id = $1`,
      [id],
    ),
    insertNoSource: await svc(
      `insert into public.finance_fee_lines (session_id, fee_type, amount_pence, status, tenant_id)
       values ($1, 'fee', 100, 'draft', $2)`,
      [R.sessA1, T.a],
    ),
    insertMismatch: await svc(
      `insert into public.finance_fee_lines (session_id, fee_type, amount_pence, status, tenant_id,
         source_network_line_id) values ($1, 'fee', 99, 'draft', $2, $3)`,
      [R.sessA1, T.a, s.lines[0].id],
    ),
    svcDelete: await svc(`delete from public.finance_fee_lines where id = $1`, [id]),
    superDelete: await outcome(() =>
      sql(`delete from public.finance_fee_lines where id = $1`, [id]),
    ),
  };
  const note = await svc(`update public.finance_fee_lines set note = 'checked' where id = $1`, [
    id,
  ]);
  const after = await core();
  const allowed = Object.entries(attempts)
    .filter(([, r]) => r.ok)
    .map(([k]) => k);
  return {
    pass: a.ok && allowed.length === 0 && note.ok && before === after,
    allowed,
    before,
    after,
  };
}
async function checkReceivedConfirm(mod = nf) {
  const s = await freshStatement([aiLine({ ref: "MG-B4B1-A2", pounds: 9 })]);
  const date = londonDate(3);
  const attempt = (data) =>
    call(mod.confirmNetworkStatementReceivedDate, { statementId: s.id, ...data }, U.ownerA);
  const tsFalse = await attempt({ receivedDate: date, confirmed: false });
  const tsMissing = await attempt({ receivedDate: date });
  const tsFuture = await attempt({ receivedDate: londonDate(-3), confirmed: true });
  const rpc = (d, confirmed) =>
    svc(`select public.confirm_network_statement_received_date($1, $2, $3, $4, $5, $6) as r`, [
      T.a,
      U.ownerA,
      s.id,
      d,
      confirmed,
      null,
    ]);
  const rpcFalse = await rpc(date, false);
  const rpcNull = await rpc(date, null);
  const rpcFuture = await rpc(londonDate(-3), true);
  const mid = await stmtOf(s.id);
  const good = await attempt({ receivedDate: date, confirmed: true, evidence: "Network email" });
  const st = await stmtOf(s.id);
  return {
    pass:
      !tsFalse.ok &&
      !tsMissing.ok &&
      !tsFuture.ok &&
      !rpcFalse.ok &&
      /network_received_date_unconfirmed/.test(rpcFalse.message) &&
      !rpcNull.ok &&
      !rpcFuture.ok &&
      mid.received_date === null &&
      mid.received_date_confirmed_at === null &&
      good.ok &&
      st.rd === date &&
      st.received_date_confirmed_by === U.ownerA &&
      st.received_date_confirmed_at !== null &&
      st.received_date_evidence === "Network email",
    mid: { rd: mid.rd, by: mid.received_date_confirmed_by },
    detail: describe(tsFalse, tsMissing, tsFuture, rpcFalse, rpcNull, rpcFuture, good),
  };
}
const CLIENT_TABLES = [
  ["finance_fee_lines", "tenant_id"],
  ["finance_ledger", "tenant_id"],
  ["network_commission_statements", "tenant_id"],
  ["network_commission_lines", "tenant_id"],
  ["finance_audit_log", "tenant_id"],
  ["session_adviser_assignments", "tenant_id"],
  ["session_adviser_history_capture", "started_at"],
  ["network_commission_statements_unowned_pre_b4b1", "tenant_id"],
];
async function checkDirectReads() {
  const out = [];
  for (const [t] of CLIENT_TABLES) {
    for (const [role, sub] of [
      ["anon", null],
      ["authenticated", U.ownerA],
    ]) {
      const r = await asRole(pg, role, `select count(*)::int as n from public.${t}`, [], sub);
      out.push({ t, role, ok: r.ok, code: r.code });
    }
  }
  const leaked = out.filter((x) => x.ok || x.code !== "42501");
  return { pass: leaked.length === 0, leaked };
}
async function checkLegacySubmit(mod = ff) {
  const w0 = writeLog.length;
  const r0 = rpcLog.length;
  const fees0 = (await rowsText(pg, "public.finance_fee_lines")).sort().join("\n");
  const ledger0 = await countOf(pg, "public.finance_ledger");
  const audit0 = await countOf(pg, "public.finance_audit_log");
  const r = await call(mod.submitSessionFees, { sessionId: R.sessA1 }, U.ownerA);
  const fees1 = (await rowsText(pg, "public.finance_fee_lines")).sort().join("\n");
  const ledger1 = await countOf(pg, "public.finance_ledger");
  const audit1 = await countOf(pg, "public.finance_audit_log");
  const writes = writeLog.slice(w0);
  const rpcs = rpcLog.slice(r0);
  return {
    pass:
      !r.ok &&
      /Posting fees is not available yet/.test(r.message) &&
      writes.length === 0 &&
      rpcs.length === 0 &&
      fees0 === fees1 &&
      ledger1 === ledger0 &&
      audit1 === audit0,
    ledgerDelta: ledger1 - ledger0,
    writes,
    r,
  };
}
async function checkLegacyAmend(mod = ff) {
  const w0 = writeLog.length;
  const r0 = rpcLog.length;
  const fees0 = (await rowsText(pg, "public.finance_fee_lines")).sort().join("\n");
  const ledger0 = await countOf(pg, "public.finance_ledger");
  const amend = await call(mod.amendPostedFee, { lineId: R.draftA, amountPounds: 1 }, U.ownerA);
  const del = await call(mod.amendPostedFee, { lineId: R.draftA, delete: true }, U.ownerA);
  const fees1 = (await rowsText(pg, "public.finance_fee_lines")).sort().join("\n");
  const ledger1 = await countOf(pg, "public.finance_ledger");
  const writes = writeLog.slice(w0);
  const rpcs = rpcLog.slice(r0);
  return {
    pass:
      !amend.ok &&
      !del.ok &&
      /Amending or deleting posted fees is not available yet/.test(amend.message) &&
      /Amending or deleting posted fees is not available yet/.test(del.message) &&
      writes.length === 0 &&
      rpcs.length === 0 &&
      fees0 === fees1 &&
      ledger0 === ledger1,
    ledgerDelta: ledger1 - ledger0,
    writes,
  };
}
async function checkLegacyLinkUndated() {
  const fee = await one(
    `select f.*, f.fee_event_date::text as ed from public.finance_fee_lines f where id = $1`,
    [R.legacyFee],
  );
  const d = await call(
    nf.setNetworkStatementDeclaredTotal,
    { statementId: R.legacyStmt, declaredTotalPence: 7000 },
    U.ownerA,
  );
  const v = await call(
    nf.validateNetworkStatement,
    { statementId: R.legacyStmt, action: "validate" },
    U.ownerA,
  );
  const st = await stmtOf(R.legacyStmt);
  return {
    pass:
      fee?.source_network_line_id === R.legacyLine &&
      fee.ed === null &&
      fee.fee_event_source === null &&
      d.ok &&
      !v.ok &&
      /no economic date/.test(v.message) &&
      st.status !== "validated",
    st: st?.status,
    v,
  };
}
async function legacyAllocationSeed(db) {
  await insertRow(db, "public.network_commission_statements", {
    id: R.legacyStmt,
    period_month: "2026-06-01",
    status: "annotated",
    tenant_id: T.a,
    created_by: U.ownerA,
  });
  await insertRow(db, "public.finance_fee_lines", {
    id: R.legacyFee,
    session_id: R.sessA2,
    fee_type: "fee",
    amount_pence: 7000,
    status: "draft",
    tenant_id: T.a,
  });
  await insertRow(db, "public.network_commission_lines", {
    id: R.legacyLine,
    statement_id: R.legacyStmt,
    line_no: 1,
    fee_type: "fee",
    amount_received_pence: 7000,
    allocation_status: "allocated",
    matched_customer_id: U.custA2,
    matched_session_id: R.sessA2,
    fee_line_id: R.legacyFee,
    allocated_by: U.ownerA,
    allocated_at: LEGACY_AT,
    tenant_id: T.a,
  });
}

// =============================================================================================
// MIGRATION
// =============================================================================================
pg = await preB4b1Db();
const UNCHANGED_TABLES = [
  "public.interview_sessions",
  "public.session_advisors",
  "public.finance_ledger",
  "public.finance_audit_log",
  "public.tenant_memberships",
  "public.admin_permissions",
  "public.introducers",
  "public.customer_introducer_links",
  "public.commission_rate_versions",
];
async function tablesText(db) {
  const out = {};
  for (const t of UNCHANGED_TABLES) out[t] = (await rowsText(db, t)).sort();
  return JSON.stringify(out);
}
const FEE_NEW_COLS = [
  "source_network_line_id",
  "fee_event_date",
  "fee_event_at",
  "fee_event_source",
  "fee_event_evidence",
  "voided_at",
  "voided_by",
  "void_reason",
];
const feeCore = (db) =>
  sqlOn(
    db,
    `select (to_jsonb(f) - $1::text[])::text as j from public.finance_fee_lines f order by id`,
    [FEE_NEW_COLS],
  ).then((r) => r.map((x) => x.j));
const sessionsCat = async (db) => {
  const [c] = await catalogOf(db, ["interview_sessions"]);
  return JSON.stringify({
    acl: c.acl,
    rls: c.relrowsecurity,
    pols: c.pols,
    cons: c.cons
      .split("|")
      .filter((x) => !x.startsWith("interview_sessions_id_tenant_key:"))
      .join("|"),
    trg: c.trg,
  });
};
const B4A_FNS = ["set_commission_rate_versions", "resolve_commission_rate_as_of"];
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
      await sqlOn(
        db,
        `select i::text as t from public.introducers i where user_id = $1 order by id`,
        [U.introDual],
      )
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
    cat: await sessionsCat(db),
  });
const preTenantless = (
  await sql(
    `select s::text as t from public.network_commission_statements s where tenant_id is null`,
  )
).map((r) => r.t);
const preTables = await tablesText(pg);
const preFeeCore = await feeCore(pg);
const preB4a = await b4aState(pg);
const preB3 = await b3State(pg);
const preA2 = await a2State(pg);
const preS4C2 = await s4c2State(pg);
const preB4aFnCount = (await fnFingerprint(pg, B4A_FNS)).length;

const mig = await applyMigration(pg);
ok(
  "B4B1-01 migration applies to the staging-shaped post-B4a database (2 undated drafts, 1 tenantless October draft with 0 lines, 0 network lines, 0 ledger rows, 3 tenant-stamped + 3 tenantless adviser rows)",
  Boolean(linkPolicySql) && mig.ok && preB4aFnCount === 2,
  mig.ok ? "" : mig.message,
);
if (!mig.ok) {
  console.log(`TEST_CASES=${total}`);
  console.log("RESULT=FAIL");
  process.exit(1);
}
{
  const r = await checkArchive(pg, preTenantless);
  ok(
    "B4B1-02 the tenantless October statement is archived byte-identically to a service-role read-only archive, never assigned to a tenant (not inferred from its T001 creator) and not deleted from evidence",
    r.pass,
    JSON.stringify({ archived: r.archived.length, live: r.live }),
  );
}
{
  const ownTenantOct = await countOf(
    pg,
    "public.network_commission_statements",
    "period_month = '2026-10-01'",
  );
  const oa = await call(
    nf.getOrCreateNetworkStatement,
    { periodMonth: "2026-10" },
    U.ownerA,
    SLUG.a,
  );
  const ob = await call(
    nf.getOrCreateNetworkStatement,
    { periodMonth: "2026-10" },
    U.ownerB,
    SLUG.b,
  );
  const oa2 = await call(
    nf.getOrCreateNetworkStatement,
    { periodMonth: "2026-10" },
    U.supA,
    SLUG.a,
  );
  const dup = await svc(
    `insert into public.network_commission_statements (period_month, status, tenant_id) values ('2026-10-01', 'draft', $1)`,
    [T.a],
  );
  const tenantless = await svc(
    `insert into public.network_commission_statements (period_month, status) values ('2027-01-01', 'draft')`,
  );
  const keys = (
    await sql(
      `select pg_get_constraintdef(oid) as d from pg_constraint
       where conrelid = 'public.network_commission_statements'::regclass and contype = 'u' order by 1`,
    )
  ).map((r) => r.d);
  const cols = (
    await sql(
      `select attname from pg_attribute where attrelid = 'public.network_commission_statements'::regclass
       and attnum > 0 and not attisdropped`,
    )
  ).map((r) => r.attname);
  ok(
    "B4B1-03 one statement per tenant and month: T001 and T002 both open October (the archived month); a repeat open returns the same statement; a duplicate or tenantless insert is refused; no provider dimension",
    ownTenantOct === 0 &&
      oa.ok &&
      ob.ok &&
      oa.value.created &&
      ob.value.created &&
      oa.value.statement.tenant_id === T.a &&
      ob.value.statement.tenant_id === T.b &&
      oa.value.statement.id !== R.octTenantless &&
      oa2.ok &&
      !oa2.value.created &&
      oa2.value.statement.id === oa.value.statement.id &&
      !dup.ok &&
      dup.code === "23505" &&
      !tenantless.ok &&
      JSON.stringify(keys) ===
        JSON.stringify(["UNIQUE (id, tenant_id)", "UNIQUE (tenant_id, period_month)"]) &&
      !cols.some((c) => /provider|network_id/.test(c)),
    describe(oa, ob, oa2) + ` keys=${JSON.stringify(keys)}`,
  );
}
{
  const fks = await sql(
    `select conrelid::regclass::text as rel, conname, pg_get_constraintdef(oid) as d from pg_constraint
     where contype = 'f' and conrelid in ('public.finance_fee_lines'::regclass,
       'public.network_commission_lines'::regclass, 'public.session_adviser_assignments'::regclass)
     order by 1, 2`,
  );
  const want = [
    [
      "finance_fee_lines",
      "FOREIGN KEY (session_id, tenant_id) REFERENCES interview_sessions(id, tenant_id) ON UPDATE RESTRICT ON DELETE RESTRICT",
    ],
    [
      "finance_fee_lines",
      "FOREIGN KEY (source_network_line_id, tenant_id) REFERENCES network_commission_lines(id, tenant_id) ON UPDATE RESTRICT ON DELETE RESTRICT",
    ],
    [
      "network_commission_lines",
      "FOREIGN KEY (statement_id, tenant_id) REFERENCES network_commission_statements(id, tenant_id) ON UPDATE RESTRICT ON DELETE RESTRICT",
    ],
    [
      "network_commission_lines",
      "FOREIGN KEY (matched_session_id, tenant_id) REFERENCES interview_sessions(id, tenant_id) ON UPDATE RESTRICT ON DELETE RESTRICT",
    ],
    [
      "session_adviser_assignments",
      "FOREIGN KEY (session_id, tenant_id) REFERENCES interview_sessions(id, tenant_id) ON UPDATE RESTRICT ON DELETE RESTRICT",
    ],
  ];
  const norm = (d) => d.replace(/REFERENCES public\./, "REFERENCES ");
  const present = want.every(([rel, d]) => fks.some((f) => f.rel.endsWith(rel) && norm(f.d) === d));
  const cascades = fks.filter((f) => /CASCADE/.test(f.d) && !/auth\.users|tenants/.test(f.d));
  const ledgerFks = await countOf(
    pg,
    "pg_constraint",
    "contype = 'f' and confrelid = 'public.finance_ledger'::regclass",
  );
  const notNull = await sql(
    `select attrelid::regclass::text as rel from pg_attribute where attname = 'tenant_id' and attnotnull
     and attrelid in ('public.finance_fee_lines'::regclass, 'public.network_commission_lines'::regclass,
       'public.network_commission_statements'::regclass, 'public.session_adviser_assignments'::regclass)`,
  );
  ok(
    "B4B1-04 composite tenant FKs (RESTRICT) for fee line → session, fee line → network line, line → statement, line → matched session, assignment → session; no cascade; no ledger FK; tenant_id NOT NULL on statements, lines, fee lines, history",
    present && cascades.length === 0 && ledgerFks === 0 && notNull.length === 4,
    JSON.stringify({ fks: fks.map((f) => `${f.rel}:${f.conname}`), cascades }),
  );
}
{
  const fees = await sqlOn(
    pg,
    `select id, status::text as st, posted_at, fee_event_date, fee_event_at, fee_event_source,
            fee_event_evidence, source_network_line_id, voided_at from public.finance_fee_lines
     where id = any($1::uuid[]) order by id`,
    [[R.draftA, R.draftB]],
  );
  const core = await feeCore(pg);
  const post = await svc(
    `update public.finance_fee_lines set status = 'posted', posted_at = now() where id = $1`,
    [R.draftA],
  );
  const voidIt = await svc(
    `update public.finance_fee_lines set status = 'deleted', voided_at = now(), voided_by = $2,
       void_reason = 'auto' where id = $1`,
    [R.draftA, U.ownerA],
  );
  const dateIt = await svc(
    `update public.finance_fee_lines set fee_event_date = created_at::date,
       fee_event_at = (created_at::date::timestamp at time zone 'Europe/London'),
       fee_event_source = 'network_line_transaction_date', fee_event_evidence = '{}' where id = $1`,
    [R.draftB],
  );
  const del = await svc(`delete from public.finance_fee_lines where id = $1`, [R.draftA]);
  const after = await feeCore(pg);
  ok(
    "B4B1-05 the two undated staging drafts are preserved unchanged and unpostable: no date claimed, no created_at substitution, no auto-void, no delete, posting refused",
    fees.length === 2 &&
      fees.every(
        (f) =>
          f.st === "draft" &&
          f.posted_at === null &&
          f.fee_event_date === null &&
          f.fee_event_at === null &&
          f.fee_event_source === null &&
          f.fee_event_evidence === null &&
          f.source_network_line_id === null &&
          f.voided_at === null,
      ) &&
      JSON.stringify(core) === JSON.stringify(preFeeCore) &&
      !post.ok &&
      !voidIt.ok &&
      !dateIt.ok &&
      !del.ok &&
      JSON.stringify(after) === JSON.stringify(preFeeCore),
    describe(post, voidIt, dateIt, del),
  );
}
{
  const hist = await sql(
    `select a.*, a.adviser_capacity::text as cap from public.session_adviser_assignments a order by source_session_advisor_id`,
  );
  const capture = await one(`select started_at from public.session_adviser_history_capture`);
  const want = {
    [R.saA1]: [T.a, R.sessA1, U.advA, "adviser"],
    [R.saA2]: [T.a, R.sessA2, U.ownerA, "owner"],
    [R.saB1]: [T.b, R.sessB1, U.advB, "adviser"],
  };
  const exact =
    hist.length === 3 &&
    hist.every((h) => {
      const w = want[h.source_session_advisor_id];
      return (
        w &&
        h.tenant_id === w[0] &&
        h.session_id === w[1] &&
        h.adviser_user_id === w[2] &&
        h.cap === w[3] &&
        new Date(h.assigned_at).toISOString() === LEGACY_AT &&
        h.unassigned_at === null &&
        h.assigned_by === null &&
        h.source === "session_advisors_backfill"
      );
    });
  const tenantlessHist = await countOf(
    pg,
    "public.session_adviser_assignments",
    "source_session_advisor_id = any($1::uuid[]) or session_id = any($2::uuid[])",
    [
      [R.saTL1, R.saTL2, R.saTL3],
      [R.sessTL1, R.sessTL2, R.sessTL3],
    ],
  );
  ok(
    "B4B1-06 adviser history backfill: the 3 tenant-stamped assignments become open intervals from created_at (Owner capacity recorded as Owner); the 3 tenantless ones are excluded, tenant not guessed; capture starts after them",
    exact && tenantlessHist === 0 && new Date(capture.started_at) > new Date(LEGACY_AT),
    JSON.stringify(hist.map((h) => [h.cap, h.source])),
  );
}
ok(
  "B4B1-07 business rows on pre-existing columns are unchanged by the migration (sessions, assignments, ledger, audit, memberships, permissions, introducers, links, rate versions, fee lines)",
  (await tablesText(pg)) === preTables &&
    JSON.stringify(await feeCore(pg)) === JSON.stringify(preFeeCore),
);

// =============================================================================================
// ADVISER ASSIGNMENT HISTORY (live)
// =============================================================================================
const histOf = (session, adviser) =>
  sqlOn(
    pg,
    `select a.*, a.adviser_capacity::text as cap from public.session_adviser_assignments a
     where session_id = $1 and adviser_user_id = $2 order by assigned_at, recorded_at`,
    [session, adviser],
  );
const captureStart = new Date(
  (await one(`select started_at from public.session_adviser_history_capture`)).started_at,
);
{
  const r = await call(sf.allocateSession, { sessionId: R.sessA3, advisorId: U.advA2 }, U.ownerA);
  const sa = await one(
    `select id from public.session_advisors where session_id = $1 and advisor_id = $2`,
    [R.sessA3, U.advA2],
  );
  const h = await histOf(R.sessA3, U.advA2);
  ok(
    "B4B1-08 allocating a case to an adviser (real allocateSession) opens one history interval: tenant, session, adviser capacity, assigned_by = actor, recorded after capture start",
    r.ok &&
      h.length === 1 &&
      h[0].source === "session_advisors_insert" &&
      h[0].source_session_advisor_id === sa?.id &&
      h[0].assigned_by === U.ownerA &&
      h[0].cap === "adviser" &&
      h[0].tenant_id === T.a &&
      h[0].unassigned_at === null &&
      new Date(h[0].assigned_at) >= captureStart,
    describe(r),
  );
  const again = await call(
    sf.allocateSession,
    { sessionId: R.sessA3, advisorId: U.advA2 },
    U.ownerA,
  );
  ok(
    "B4B1-09 re-allocating the same adviser (upsert) adds no second interval",
    again.ok && (await histOf(R.sessA3, U.advA2)).length === 1,
    describe(again),
  );
  const un = await call(
    sf.unallocateSession,
    { sessionId: R.sessA3, advisorId: U.advA2 },
    U.ownerA,
  );
  const h2 = await histOf(R.sessA3, U.advA2);
  const gone = await countOf(pg, "public.session_advisors", "session_id = $1 and advisor_id = $2", [
    R.sessA3,
    U.advA2,
  ]);
  ok(
    "B4B1-10 unallocating closes the interval (row retained, append-only)",
    un.ok &&
      gone === 0 &&
      h2.length === 1 &&
      h2[0].unassigned_at !== null &&
      h2[0].unassigned_recorded_at !== null,
    describe(un),
  );
  const re = await call(sf.allocateSession, { sessionId: R.sessA3, advisorId: U.advA2 }, U.ownerA);
  const h3 = await histOf(R.sessA3, U.advA2);
  ok(
    "B4B1-11 re-assigning after unassignment opens a new interval; the closed one is untouched; intervals never overlap",
    re.ok &&
      h3.length === 2 &&
      h3[0].unassigned_at !== null &&
      h3[1].unassigned_at === null &&
      new Date(h3[0].unassigned_at) <= new Date(h3[1].assigned_at) &&
      JSON.stringify(h3[0]) === JSON.stringify(h2[0]),
    describe(re),
  );
}
let transferClosedAt = null;
{
  const r = await call(
    sf.transferSession,
    { sessionId: R.sessA1, fromAdvisorId: U.advA, toAdvisorId: U.advA3 },
    U.ownerA,
  );
  const from = await histOf(R.sessA1, U.advA);
  const to = await histOf(R.sessA1, U.advA3);
  transferClosedAt = from[0]?.unassigned_at ?? null;
  ok(
    "B4B1-12 transfer closes the previous adviser's interval and opens the new adviser's",
    r.ok &&
      from.length === 1 &&
      from[0].source === "session_advisors_backfill" &&
      from[0].unassigned_at !== null &&
      to.length === 1 &&
      to[0].unassigned_at === null &&
      to[0].assigned_by === U.ownerA,
    describe(r),
  );
}
{
  const r = await call(
    sf.bulkAllocateSessions,
    { sessionIds: [R.sessA2, R.sessA3], advisorCode: "ADVA" },
    U.ownerA,
  );
  const a2 = await histOf(R.sessA2, U.advA);
  const a3 = await histOf(R.sessA3, U.advA);
  ok(
    "B4B1-13 bulk allocation opens one interval per session",
    r.ok &&
      a2.length === 1 &&
      a3.length === 1 &&
      a2[0].unassigned_at === null &&
      a3[0].unassigned_at === null &&
      a2[0].source === "session_advisors_insert",
    describe(r),
  );
}
{
  const before = new Set(
    (await sql(`select id from public.session_advisors where advisor_id = $1`, [U.advA3])).map(
      (r) => r.id,
    ),
  );
  const r = await call(
    bf.bookCustomerAppointmentAsStaff,
    {
      customerId: U.custA2,
      customerName: "Synthetic A2",
      customerPhone: "01632960003",
      customerEmail: "custa2@example.test",
      startsAt: nextSlot(),
      advisorId: U.advA3,
      sendSms: false,
    },
    U.ownerA,
  );
  const added = (
    await sql(
      `select id, session_id, tenant_id from public.session_advisors where advisor_id = $1`,
      [U.advA3],
    )
  ).filter((x) => !before.has(x.id));
  const hist = added.length
    ? await sql(
        `select * from public.session_adviser_assignments where source_session_advisor_id = $1`,
        [added[0].id],
      )
    : [];
  ok(
    "B4B1-14 a staff booking's auto-allocation opens a history interval for the booked adviser in the booking tenant",
    r.ok &&
      added.length === 1 &&
      added[0].tenant_id === T.a &&
      hist.length === 1 &&
      hist[0].unassigned_at === null &&
      hist[0].tenant_id === T.a &&
      hist[0].assigned_by === U.ownerA,
    describe(r) + ` added=${added.length}`,
  );
}
{
  const mismatch = await svc(
    `insert into public.session_advisors (session_id, advisor_id, tenant_id) values ($1, $2, $3)`,
    [R.sessB1, U.advA2, T.a],
  );
  const notStaff = await svc(
    `insert into public.session_advisors (session_id, advisor_id, tenant_id) values ($1, $2, $3)`,
    [R.sessHist, U.custA, T.a],
  );
  const inactive = await svc(
    `insert into public.session_advisors (session_id, advisor_id, tenant_id) values ($1, $2, $3)`,
    [R.sessHist, U.advInactive, T.a],
  );
  const tl = await svc(
    `insert into public.session_advisors (session_id, advisor_id, tenant_id) values ($1, $2, null) returning id`,
    [R.sessTL1, U.advA3],
  );
  const tlHist = tl.ok
    ? await countOf(pg, "public.session_adviser_assignments", "source_session_advisor_id = $1", [
        tl.rows[0].id,
      ])
    : -1;
  const foreignSession = await call(
    sf.allocateSession,
    { sessionId: R.sessB1, advisorId: U.advA2 },
    U.ownerA,
  );
  const foreignAdviser = await call(
    sf.allocateSession,
    { sessionId: R.sessHist, advisorId: U.advB },
    U.ownerA,
  );
  const leaked = await countOf(
    pg,
    "public.session_advisors",
    "(session_id = $1 and advisor_id = $2) or (session_id = $3 and advisor_id = $4) or (session_id = $3 and advisor_id = any($5::uuid[]))",
    [R.sessB1, U.advA2, R.sessHist, U.advB, [U.custA, U.advInactive]],
  );
  ok(
    "B4B1-15 assignment writes are tenant-safe: a cross-tenant row, a non-staff or inactive adviser is refused; a legacy tenantless session records no history (excluded); foreign session / adviser allocation is refused",
    !mismatch.ok &&
      /session_adviser_tenant_mismatch/.test(mismatch.message) &&
      !notStaff.ok &&
      /session_adviser_not_tenant_staff/.test(notStaff.message) &&
      !inactive.ok &&
      tl.ok &&
      tlHist === 0 &&
      !foreignSession.ok &&
      !foreignAdviser.ok &&
      leaked === 0,
    describe(mismatch, notStaff, inactive, tl, foreignSession, foreignAdviser),
  );
}
{
  const r = await checkHistoryDirect();
  ok(
    "B4B1-16 history is append-only and trigger-written only: direct insert / close / backdate / delete / truncate refused (service role and superuser); session_advisors identity immutable and not truncatable by clients; clients cannot read history",
    r.pass,
    r.detail,
  );
}
{
  const r = await checkResolverAsOf();
  ok(
    "B4B1-17 as-of resolver: covered instant → assigned; uncovered instant after capture → none_assigned; before capture → no_proof (explicit, never empty); several advisers all returned; foreign / tenantless session and null instant refused; clients cannot execute",
    r.pass,
    JSON.stringify(r.r),
  );
}
{
  const resolve = (session, at) =>
    svc(
      `select resolution, adviser_user_id, adviser_capacity::text as cap, history_complete
       from public.resolve_session_advisers_as_of($1, $2, $3)`,
      [T.a, session, at],
    );
  const shape = (x) =>
    x.ok
      ? x.rows
          .map(
            (r) =>
              `${r.resolution}:${r.adviser_user_id ?? "-"}:${r.cap ?? "-"}:${r.history_complete}`,
          )
          .join("|")
      : `error:${x.message}`;
  const closed = transferClosedAt ? new Date(transferClosedAt).getTime() : 0;
  const between = new Date((captureStart.getTime() + closed) / 2).toISOString();
  const nowIso = new Date().toISOString();
  const legacyPlus = new Date(new Date(LEGACY_AT).getTime() + DAY).toISOString();
  const legacyMinus = new Date(new Date(LEGACY_AT).getTime() - DAY).toISOString();
  const r = {
    between: shape(await resolve(R.sessA1, between)),
    now: shape(await resolve(R.sessA1, nowIso)),
    legacyPlus: shape(await resolve(R.sessA1, legacyPlus)),
    legacyMinus: shape(await resolve(R.sessA1, legacyMinus)),
    multi: shape(await resolve(R.sessA2, nowIso)),
  };
  ok(
    "B4B1-18 resolver uses history, never the current assignment: before the transfer → the old adviser; now → the new one; covered pre-capture → assigned_history_incomplete; uncovered pre-capture → no_proof; Owner + adviser both returned (D1b)",
    closed > captureStart.getTime() &&
      r.between === `assigned:${U.advA}:adviser:true` &&
      r.now === `assigned:${U.advA3}:adviser:true` &&
      r.legacyPlus === `assigned_history_incomplete:${U.advA}:adviser:false` &&
      r.legacyMinus === "no_proof:-:-:false" &&
      r.multi === `assigned:${U.ownerA}:owner:true|assigned:${U.advA}:adviser:true`,
    JSON.stringify(r),
  );
}

// =============================================================================================
// NETWORK STATEMENTS: PARSE, DATES, ALLOCATION
// =============================================================================================
const S1 = await freshStatement([
  aiLine({ ref: "MG-B4B1-A1", pounds: 100, date: summerDate, name: "Alpha One" }),
  aiLine({ ref: "MG-B4B1-A2", pounds: 50, name: "Alpha Two" }),
  aiLine({ name: "Future Date", pounds: 25, date: londonDate(-5) }),
  aiLine({ name: "Bad Date", pounds: 10, date: "2026-02-30" }),
  aiLine({ ref: "MG-B4B1-B1", pounds: 5, name: "Foreign Ref" }),
  aiLine({ name: "Zero", pounds: 0 }),
]);
const [L1, L2, L3, L4, L5] = S1.lines;
{
  const lines = S1.lines;
  const batches = new Set(lines.map((l) => l.parse_batch_id));
  const audit = await countOf(
    pg,
    "public.finance_audit_log",
    "audit_type = 'network_lines_replaced' and tenant_id = $1 and detail->>'statement_id' = $2",
    [T.a, S1.id],
  );
  ok(
    "B4B1-19 parse inserts tenant-owned lines in one parse batch (line_no 1..n); a stated line date is kept as a provisional parser date; future / invalid dates are dropped, never replaced; auto-match stays in the acting tenant",
    lines.length === 5 &&
      lines.every((l) => l.tenant_id === T.a && l.superseded_at === null && l.raw_json) &&
      batches.size === 1 &&
      lines.map((l) => l.line_no).join(",") === "1,2,3,4,5" &&
      L1.tx_date === summerDate &&
      L1.transaction_date_source === "statement_parser" &&
      L1.transaction_date_set_by === U.ownerA &&
      [L2, L3, L4, L5].every((l) => l.tx_date === null && l.transaction_date_source === null) &&
      L1.matched_session_id === R.sessA1 &&
      L1.allocation_status === "matched" &&
      L2.matched_session_id === R.sessA2 &&
      L3.allocation_status === "unmatched" &&
      L5.allocation_status === "unmatched" &&
      L5.matched_session_id === null &&
      audit === 1,
    JSON.stringify(lines.map((l) => [l.line_no, l.tx_date, l.allocation_status])),
  );
}
{
  const ids = (await currentLines(S1.id)).map((l) => l.id).join(",");
  const rpc = (items) =>
    svc(`select * from public.replace_network_statement_lines($1, $2, $3, $4::jsonb, 'x')`, [
      T.a,
      U.ownerA,
      S1.id,
      JSON.stringify(items),
    ]);
  const bad = await rpc([
    { amount_received_pence: 100, fee_type: "fee", transaction_date: "2026-13-01" },
  ]);
  const future = await rpc([
    { amount_received_pence: 100, fee_type: "fee", transaction_date: londonDate(-2) },
  ]);
  const loose = await rpc([
    { amount_received_pence: 100, fee_type: "fee", transaction_date: "15/01/2026" },
  ]);
  const numeric = await rpc([
    { amount_received_pence: 100, fee_type: "fee", transaction_date: 20260115 },
  ]);
  const zero = await rpc([{ amount_received_pence: 0, fee_type: "fee" }]);
  ok(
    "B4B1-20 the re-parse operation itself refuses invalid, future, non-ISO or non-string transaction dates and non-positive amounts (nothing superseded)",
    [bad, future, loose, numeric].every(
      (r) => !r.ok && /network_line_date_invalid/.test(r.message),
    ) &&
      !zero.ok &&
      (await currentLines(S1.id)).map((l) => l.id).join(",") === ids,
    describe(bad, future, loose, numeric, zero),
  );
}
{
  const r = await checkDateRequired();
  const l2 = await allocate(L2.id);
  ok(
    "B4B1-21 a line with no transaction date and no confirmed received date cannot be allocated (fails closed; no fee line; never created_at / now())",
    r.pass && !l2.ok && (await activeFees(L2.id)) === 0,
    describe(r.r, l2) + ` ${JSON.stringify(r.fees)}`,
  );
}
let feeL1 = null;
{
  const ledger0 = await countOf(pg, "public.finance_ledger");
  const r = await allocate(L1.id);
  feeL1 = r.ok ? r.value.feeLineId : null;
  const fee = feeL1 ? await feeOf(feeL1) : null;
  const line = await lineOf(L1.id);
  const audit = await countOf(
    pg,
    "public.finance_audit_log",
    "audit_type = 'network_line_allocated' and detail->>'network_line_id' = $1",
    [L1.id],
  );
  ok(
    "B4B1-22 allocation copies the line transaction date: fee_event_date = line date, fee_event_at = start of that day Europe/London (BST), source network_line_transaction_date, evidence object; draft, unposted, no ledger row; line allocated; audited",
    r.ok &&
      r.value.created === true &&
      r.value.draft === true &&
      fee.st === "draft" &&
      fee.posted_at === null &&
      fee.batch_id === null &&
      fee.source_network_line_id === L1.id &&
      fee.session_id === R.sessA1 &&
      fee.tenant_id === T.a &&
      fee.amount_pence === 10000 &&
      fee.fee_type === "fee" &&
      fee.event_date === summerDate &&
      new Date(fee.fee_event_at).toISOString() === londonMidnight(summerDate) &&
      londonMidnight(summerDate).endsWith("T23:00:00.000Z") &&
      fee.fee_event_source === "network_line_transaction_date" &&
      fee.fee_event_evidence?.network_line_id === L1.id &&
      fee.fee_event_evidence?.date_source === "statement_parser" &&
      line.allocation_status === "allocated" &&
      line.fee_line_id === feeL1 &&
      line.allocated_by === U.ownerA &&
      (await countOf(pg, "public.finance_ledger")) === ledger0 &&
      audit === 1,
    describe(r) + ` ${fee?.event_date} ${fee?.fee_event_at}`,
  );
}
{
  const again = await allocate(L1.id, { sessionId: R.sessA1 });
  const implicit = await allocate(L1.id);
  const audit = await countOf(
    pg,
    "public.finance_audit_log",
    "audit_type = 'network_line_allocated' and detail->>'network_line_id' = $1",
    [L1.id],
  );
  ok(
    "B4B1-23 allocation retry is a no-op: same fee line returned (created = false), one active fee line, no second audit row",
    again.ok &&
      implicit.ok &&
      again.value.feeLineId === feeL1 &&
      implicit.value.feeLineId === feeL1 &&
      again.value.created === false &&
      (await activeFees(L1.id)) === 1 &&
      audit === 1,
    describe(again, implicit),
  );
  const other = await allocate(L1.id, { sessionId: R.sessA2 });
  ok(
    "B4B1-24 a line allocated to one case cannot be allocated to another (no duplicate active allocation)",
    !other.ok &&
      /already allocated to a different case/.test(other.message) &&
      (await activeFees(L1.id)) === 1,
    describe(other),
  );
}
{
  const r = await checkUniqueActive();
  const idx = await one(
    `select indexdef from pg_indexes where schemaname = 'public' and indexname = 'finance_fee_lines_active_network_source_key'`,
  );
  const body = (await one(`select prosrc from pg_proc where proname = 'allocate_network_line'`))
    .prosrc;
  ok(
    "B4B1-25 allocation is concurrency-safe: racing identical requests yield one fee line (one created, one no-op), racing different cases yield one winner; a second active fee line is refused by the partial unique index even past the operation's own check; the line row is locked FOR UPDATE",
    r.pass &&
      /UNIQUE INDEX/.test(idx?.indexdef ?? "") &&
      /WHERE \(\(source_network_line_id IS NOT NULL\) AND \(status <> 'deleted'::(public\.)?finance_line_status\)\)/.test(
        idx?.indexdef ?? "",
      ) &&
      /WHERE l\.id = p_line_id AND l\.tenant_id = p_tenant_id\s+FOR UPDATE;/.test(body),
    `${r.detail} forced=${r.forced.message ?? "ok"} idx=${idx?.indexdef}`,
  );
}
{
  const r = await checkReceivedConfirm();
  ok(
    "B4B1-26 the statement received date needs deliberate staff confirmation: unconfirmed / missing confirmation / future dates refused (validator and database); never inferred; confirmation records who, when and evidence",
    r.pass,
    r.detail,
  );
}
const receivedS1 = londonDate(10);
let feeL2 = null;
{
  const c = await call(
    nf.confirmNetworkStatementReceivedDate,
    { statementId: S1.id, receivedDate: receivedS1, confirmed: true, evidence: "Statement email" },
    U.supA,
  );
  const r = await allocate(L2.id);
  feeL2 = r.ok ? r.value.feeLineId : null;
  const fee = feeL2 ? await feeOf(feeL2) : null;
  ok(
    "B4B1-27 fallback: a dateless line allocated after confirmation takes the confirmed received date (source network_statement_received_date, evidence of who confirmed)",
    c.ok &&
      r.ok &&
      fee.event_date === receivedS1 &&
      new Date(fee.fee_event_at).toISOString() === londonMidnight(receivedS1) &&
      fee.fee_event_source === "network_statement_received_date" &&
      fee.fee_event_evidence?.received_date_confirmed_by === U.supA &&
      r.value.feeEventSource === "network_statement_received_date",
    describe(c, r),
  );
  const change = await call(
    nf.confirmNetworkStatementReceivedDate,
    { statementId: S1.id, receivedDate: londonDate(12), confirmed: true },
    U.ownerA,
  );
  ok(
    "B4B1-28 the received date cannot change while an active fee uses it",
    !change.ok &&
      /use the received date/.test(change.message) &&
      (await stmtOf(S1.id)).rd === receivedS1,
    describe(change),
  );
}
{
  const set = await call(
    nf.setNetworkLineTransactionDate,
    { lineId: L3.id, transactionDate: londonDate(40) },
    U.genA,
  );
  const l3 = await lineOf(L3.id);
  const future = await call(
    nf.setNetworkLineTransactionDate,
    { lineId: L3.id, transactionDate: londonDate(-1) },
    U.ownerA,
  );
  const rpcFuture = await svc(`select public.set_network_line_transaction_date($1, $2, $3, $4)`, [
    T.a,
    U.ownerA,
    L3.id,
    londonDate(-1),
  ]);
  const onAllocated = await call(
    nf.setNetworkLineTransactionDate,
    { lineId: L1.id, transactionDate: londonDate(41) },
    U.ownerA,
  );
  const direct = await svc(
    `update public.network_commission_lines set transaction_date = $2 where id = $1`,
    [L1.id, londonDate(42)],
  );
  const parserSpoof = await svc(
    `update public.network_commission_lines set transaction_date = $2, transaction_date_source = 'statement_parser',
       transaction_date_set_by = $3, transaction_date_set_at = now() where id = $1`,
    [L4.id, londonDate(43), U.ownerA],
  );
  ok(
    "B4B1-29 staff can enter a line transaction date (source staff_entry, who, when); future dates refused; an allocated line's date is immutable; a direct write cannot pretend to be a parser date",
    set.ok &&
      l3.tx_date === londonDate(40) &&
      l3.transaction_date_source === "staff_entry" &&
      l3.transaction_date_set_by === U.genA &&
      !future.ok &&
      !rpcFuture.ok &&
      !onAllocated.ok &&
      !direct.ok &&
      !parserSpoof.ok &&
      (await lineOf(L1.id)).tx_date === summerDate,
    describe(set, future, rpcFuture, onAllocated, direct, parserSpoof),
  );
}
const SB = await freshStatement([aiLine({ ref: "MG-B4B1-B1", pounds: 70, date: winterDate })], {
  actor: U.ownerB,
  slug: SLUG.b,
});
{
  const lb = SB.lines[0];
  const r = {
    foreignActor: await allocate(L3.id, {}, U.ownerB, SLUG.b),
    foreignSession: await allocate(L3.id, { sessionId: R.sessB1 }),
    foreignLine: await allocate(lb.id, { sessionId: R.sessA1 }),
    foreignDetail: await call(
      nf.getNetworkStatementDetail,
      { statementId: S1.id },
      U.ownerB,
      SLUG.b,
    ),
    foreignAnnotate: await call(
      nf.annotateNetworkLine,
      { lineId: lb.id, annotation: "x" },
      U.ownerA,
    ),
    foreignDealloc: await call(
      nf.deallocateNetworkLine,
      { lineId: L1.id, reason: "x" },
      U.ownerB,
      SLUG.b,
    ),
    foreignSkip: await call(
      nf.setNetworkLineSkip,
      { lineId: L3.id, skip: true, reason: "x" },
      U.ownerB,
      SLUG.b,
    ),
    foreignValidate: await call(
      nf.validateNetworkStatement,
      { statementId: S1.id, action: "validate" },
      U.ownerB,
      SLUG.b,
    ),
    rpcForeignLine: await svc(`select * from public.allocate_network_line($1, $2, $3, $4)`, [
      T.b,
      U.ownerB,
      L3.id,
      R.sessB1,
    ]),
  };
  const directFk = await svc(
    `update public.network_commission_lines set matched_session_id = $2 where id = $1`,
    [L3.id, R.sessB1],
  );
  const notFound = [
    "foreignActor",
    "foreignSession",
    "foreignLine",
    "foreignDetail",
    "foreignAnnotate",
    "foreignDealloc",
    "foreignSkip",
    "foreignValidate",
  ];
  ok(
    "B4B1-30 network statements are tenant-isolated: a foreign line, session or statement is 'Not found.' through every operation; the database operation re-proves the tenant; a cross-tenant match is refused by the composite FK; T002 lines are owned by T002",
    notFound.every((k) => !r[k].ok && r[k].message === "Not found.") &&
      !r.rpcForeignLine.ok &&
      /network_resource_not_found/.test(r.rpcForeignLine.message) &&
      !directFk.ok &&
      directFk.code === "23503" &&
      (await activeFees(L3.id)) === 0 &&
      (await activeFees(lb.id)) === 0 &&
      lb.tenant_id === T.b &&
      lb.matched_session_id === R.sessB1,
    JSON.stringify(
      Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v.ok ? "ok" : v.message])),
    ) + ` fk=${directFk.code}`,
  );
}
{
  const r = await allocate(L3.id, { sessionId: R.sessADeleted });
  ok(
    "B4B1-31 a deleted case cannot receive an allocation",
    !r.ok && r.message === "Not found." && (await activeFees(L3.id)) === 0,
    describe(r),
  );
}
{
  const noReason = await call(nf.setNetworkLineSkip, { lineId: L4.id, skip: true }, U.ownerA);
  const rpcNoReason = await svc(`select public.set_network_line_skip($1, $2, $3, true, null)`, [
    T.a,
    U.ownerA,
    L4.id,
  ]);
  const skip = await call(
    nf.setNetworkLineSkip,
    { lineId: L4.id, skip: true, reason: "duplicate of March" },
    U.ownerA,
  );
  const l4 = await lineOf(L4.id);
  const alloc = await allocate(L4.id, { sessionId: R.sessA1 });
  const unskip = await call(nf.setNetworkLineSkip, { lineId: L4.id, skip: false }, U.ownerA);
  const l4b = await lineOf(L4.id);
  const reskip = await call(
    nf.setNetworkLineSkip,
    { lineId: L4.id, skip: true, reason: "duplicate of March" },
    U.ownerA,
  );
  const skip5 = await call(
    nf.setNetworkLineSkip,
    { lineId: L5.id, skip: true, reason: "not our customer" },
    U.supA,
  );
  const blankDirect = await svc(
    `update public.network_commission_lines set allocation_status = 'skipped', skip_reason = ' ', skipped_by = $2,
       skipped_at = now() where id = $1`,
    [L3.id, U.ownerA],
  );
  ok(
    "B4B1-32 skipping needs a reason (validator, operation and CHECK); skip records who/when; a skipped line cannot be allocated; unskip clears the reason",
    !noReason.ok &&
      !rpcNoReason.ok &&
      /network_skip_reason_required/.test(rpcNoReason.message) &&
      skip.ok &&
      skip.value.status === "skipped" &&
      l4.skip_reason === "duplicate of March" &&
      l4.skipped_by === U.ownerA &&
      !alloc.ok &&
      /skipped/.test(alloc.message) &&
      unskip.ok &&
      l4b.allocation_status === "unmatched" &&
      l4b.skip_reason === null &&
      reskip.ok &&
      skip5.ok &&
      !blankDirect.ok,
    describe(noReason, rpcNoReason, skip, alloc, unskip, reskip, skip5, blankDirect),
  );
}
{
  const r = await checkFeeImmutable();
  ok(
    "B4B1-33 fee source facts are immutable: amount, economic date, session, source, fee type cannot change; posting is refused in the database; a fee line needs a matching network source; no delete (service role or superuser); a draft note may change",
    r.pass,
    JSON.stringify(r.allowed),
  );
}
{
  const amount = await svc(
    `update public.network_commission_lines set amount_received_pence = 1 where id = $1`,
    [L3.id],
  );
  const name = await svc(
    `update public.network_commission_lines set customer_name = 'Changed' where id = $1`,
    [L3.id],
  );
  const moved = await svc(
    `update public.network_commission_lines set statement_id = $2 where id = $1`,
    [L3.id, SB.id],
  );
  const superDel = await outcome(() =>
    sql(`delete from public.network_commission_lines where id = $1`, [L3.id]),
  );
  const superTrunc = await outcome(() => sql(`truncate public.network_commission_lines cascade`));
  const stmtDel = await outcome(() =>
    sql(`delete from public.network_commission_statements where id = $1`, [S1.id]),
  );
  ok(
    "B4B1-34 parsed line facts are immutable and lines / statements are never deleted or truncated",
    !amount.ok &&
      /network_line_source_immutable/.test(amount.message) &&
      !name.ok &&
      !moved.ok &&
      !superDel.ok &&
      !superTrunc.ok &&
      !stmtDel.ok &&
      (await countOf(pg, "public.network_commission_lines", "statement_id = $1", [S1.id])) === 5,
    describe(amount, name, moved, superDel, superTrunc, stmtDel),
  );
}
let feeL2b = null;
{
  const blank = await call(nf.deallocateNetworkLine, { lineId: L2.id, reason: "   " }, U.ownerA);
  const rpcNull = await svc(`select public.deallocate_network_line($1, $2, $3, null)`, [
    T.a,
    U.ownerA,
    L2.id,
  ]);
  const d = await call(nf.deallocateNetworkLine, { lineId: L2.id, reason: "wrong case" }, U.supA);
  const fee = await feeOf(feeL2);
  const line = await lineOf(L2.id);
  const audit = await countOf(
    pg,
    "public.finance_audit_log",
    "audit_type = 'network_line_deallocated' and detail->>'fee_line_id' = $1 and detail->>'reason' = 'wrong case'",
    [feeL2],
  );
  ok(
    "B4B1-35 deallocation voids the draft fee (status deleted + who / when / reason, row kept) and returns the line to matched; a reason is required; audited",
    !blank.ok &&
      !rpcNull.ok &&
      d.ok &&
      d.value.voidedFeeLineId === feeL2 &&
      fee.st === "deleted" &&
      fee.voided_by === U.supA &&
      fee.void_reason === "wrong case" &&
      fee.voided_at !== null &&
      fee.event_date === receivedS1 &&
      line.allocation_status === "matched" &&
      line.fee_line_id === null &&
      audit === 1,
    describe(blank, rpcNull, d),
  );
  const re = await allocate(L2.id, { sessionId: R.sessA2 });
  feeL2b = re.ok ? re.value.feeLineId : null;
  ok(
    "B4B1-36 reallocation after deallocation creates a new draft fee; the voided one stays voided; one active fee per line",
    re.ok &&
      re.value.created &&
      feeL2b !== feeL2 &&
      (await feeOf(feeL2)).st === "deleted" &&
      (await activeFees(L2.id)) === 1,
    describe(re),
  );
}
{
  const r = await checkDeallocPosted();
  ok(
    "B4B1-37 deallocation is draft-only: a posted fee or a fee with a ledger row is refused and left unchanged",
    r.pass,
    r.detail,
  );
}
{
  const r = await checkReparseActive();
  const s1 = await parseLines(S1.id, [aiLine({ name: "Replacement", pounds: 1 })]);
  ok(
    "B4B1-38 re-parse is refused while any line of the statement has an active fee (no orphaned allocations)",
    r.pass && !s1.ok && (await currentLines(S1.id)).length === 5,
    describe(r.p, s1) + ` orphans=${r.orphans}`,
  );
}
{
  const r = await checkReparseSupersedes();
  const old = r.s.lines[0];
  const allocOld = await svc(`select * from public.allocate_network_line($1, $2, $3, $4)`, [
    T.a,
    U.ownerA,
    old.id,
    R.sessA1,
  ]);
  const editOld = await svc(
    `update public.network_commission_lines set annotation = 'x' where id = $1`,
    [old.id],
  );
  const annotateOld = await call(
    nf.annotateNetworkLine,
    { lineId: old.id, annotation: "x" },
    U.ownerA,
  );
  ok(
    "B4B1-39 re-parse supersedes, never deletes: old lines kept with superseded_at / by, new current lines numbered 1..n in a new batch, detail shows current lines only; superseded lines cannot be allocated or edited",
    r.pass &&
      !allocOld.ok &&
      /network_line_superseded/.test(allocOld.message) &&
      !editOld.ok &&
      !annotateOld.ok,
    `total=${r.total} ${describe(allocOld, editOld, annotateOld)}`,
  );
}
{
  const s = await freshStatement([aiLine({ ref: "MG-B4B1-A1", pounds: 12, date: winterDate })]);
  const a = await allocate(s.lines[0].id);
  const d = await call(
    nf.deallocateNetworkLine,
    { lineId: s.lines[0].id, reason: "reparse" },
    U.ownerA,
  );
  const p = await parseLines(s.id, [aiLine({ ref: "MG-B4B1-A1", pounds: 13, date: winterDate })]);
  const fee = await feeOf(a.value.feeLineId);
  const oldLine = await lineOf(s.lines[0].id);
  const activeOnSuperseded = await countOf(
    pg,
    "public.finance_fee_lines f join public.network_commission_lines l on l.id = f.source_network_line_id",
    "l.superseded_at is not null and f.status <> 'deleted'",
  );
  ok(
    "B4B1-40 after deallocating everything a re-parse succeeds; the voided fee keeps its link to the superseded line; no active fee anywhere points at a superseded line",
    a.ok &&
      d.ok &&
      p.ok &&
      fee.st === "deleted" &&
      fee.source_network_line_id === s.lines[0].id &&
      oldLine.superseded_at !== null &&
      activeOnSuperseded === 0,
    describe(a, d, p),
  );
}

// =============================================================================================
// VALIDATION, FREEZE, UNLOCK
// =============================================================================================
{
  const v1 = await call(
    nf.validateNetworkStatement,
    { statementId: S1.id, action: "validate" },
    U.ownerA,
  );
  const a3 = await allocate(L3.id, { sessionId: R.sessA2 });
  const wrong = await call(
    nf.setNetworkStatementDeclaredTotal,
    { statementId: S1.id, declaredTotalPence: 18999 },
    U.ownerA,
  );
  const v2 = await call(
    nf.validateNetworkStatement,
    { statementId: S1.id, action: "validate" },
    U.ownerA,
  );
  const tr = await checkTotalReconcile();
  const empty = await freshStatement(null);
  const v3 = await call(
    nf.validateNetworkStatement,
    { statementId: empty.id, action: "validate" },
    U.ownerA,
  );
  ok(
    "B4B1-41 validation is real: unresolved lines, a missing or mismatched declared total and an empty statement each block it (with reasons); nothing changes",
    !v1.ok &&
      /every line must be allocated or skipped/.test(v1.message) &&
      /declared total/.test(v1.message) &&
      a3.ok &&
      a3.value.feeEventSource === "network_line_transaction_date" &&
      wrong.ok &&
      !v2.ok &&
      /do not add up/.test(v2.message) &&
      tr.pass &&
      !v3.ok &&
      /no lines/.test(v3.message) &&
      (await stmtOf(S1.id)).status !== "validated",
    describe(v1, a3, wrong, v2, v3),
  );
}
{
  const r = await checkValidateNoPost();
  const right = await call(
    nf.setNetworkStatementDeclaredTotal,
    { statementId: S1.id, declaredTotalPence: 19000 },
    U.ownerA,
  );
  const feesBefore = (await rowsText(pg, "public.finance_fee_lines")).sort().join("\n");
  const ledger0 = await countOf(pg, "public.finance_ledger");
  const v = await call(
    nf.validateNetworkStatement,
    { statementId: S1.id, action: "validate" },
    U.genA,
  );
  const st = await stmtOf(S1.id);
  const audit = await countOf(
    pg,
    "public.finance_audit_log",
    "audit_type = 'network_statement_validated' and detail->>'statement_id' = $1 and changed_by = $2",
    [S1.id, U.genA],
  );
  ok(
    "B4B1-42 a reconciled statement validates (skipped lines with reasons count toward the declared total) and validation posts nothing: fee lines byte-identical, still draft, no ledger row; audited",
    r.pass &&
      right.ok &&
      v.ok &&
      st.status === "validated" &&
      st.validated_by === U.genA &&
      (await rowsText(pg, "public.finance_fee_lines")).sort().join("\n") === feesBefore &&
      (await countOf(pg, "public.finance_ledger")) === ledger0 &&
      audit === 1,
    describe(r.v, right, v) + ` ledgerDelta=${r.ledgerDelta}`,
  );
}
{
  const r = await checkFreeze();
  ok(
    "B4B1-43 validation freezes the statement: re-parse, allocate, deallocate, skip/unskip, dates, annotation, received date, declared total and direct line / fee / statement edits are all refused; rows unchanged",
    r.pass,
    JSON.stringify(r),
  );
}
{
  const s = await reconciledStatement();
  const noPerm = await call(
    nf.validateNetworkStatement,
    { statementId: s.id, action: "validate" },
    U.genNoPerm,
  );
  const adviser = await call(
    nf.validateNetworkStatement,
    { statementId: s.id, action: "validate" },
    U.advA,
  );
  const rpcNoPerm = await svc(`select * from public.validate_network_statement($1, $2, $3)`, [
    T.a,
    U.genNoPerm,
    s.id,
  ]);
  const rpcInactive = await svc(`select * from public.validate_network_statement($1, $2, $3)`, [
    T.a,
    U.advInactive,
    s.id,
  ]);
  const rpcSuper = await svc(`select * from public.validate_network_statement($1, $2, $3)`, [
    T.a,
    U.superOwner,
    s.id,
  ]);
  const stillOpen = (await stmtOf(s.id)).status;
  const sup = await call(
    nf.validateNetworkStatement,
    { statementId: s.id, action: "validate" },
    U.supA,
  );
  const amendNoPerm = await call(nf.allocateNetworkLine, { lineId: L4.id }, U.genNoPerm);
  ok(
    "B4B1-44 validation authority: Owner, Supervisor, or General Admin with finance_network_validate = amend; a General Admin without it, an adviser, an inactive member and a platform Super Owner without membership are refused (server function and database)",
    !noPerm.ok &&
      !adviser.ok &&
      !rpcNoPerm.ok &&
      /network_finance_forbidden/.test(rpcNoPerm.message) &&
      !rpcInactive.ok &&
      !rpcSuper.ok &&
      /network_finance_forbidden/.test(rpcSuper.message) &&
      stillOpen !== "validated" &&
      sup.ok &&
      !amendNoPerm.ok,
    describe(noPerm, adviser, rpcNoPerm, rpcInactive, rpcSuper, sup, amendNoPerm),
  );
}
{
  const owner = await checkUnlockOwnerOnly();
  const reason = await checkUnlockReason();
  const u = await call(
    nf.validateNetworkStatement,
    { statementId: S1.id, action: "unlock", reason: "Declared total was mis-keyed" },
    U.ownerA,
  );
  const st = await stmtOf(S1.id);
  const audit = await countOf(
    pg,
    "public.finance_audit_log",
    "audit_type = 'network_statement_unlocked' and detail->>'statement_id' = $1 and detail->>'reason' = $2",
    [S1.id, "Declared total was mis-keyed"],
  );
  const notValidated = await unlockRpc(U.ownerA, S1.id, "again");
  const revalidate = await call(
    nf.validateNetworkStatement,
    { statementId: S1.id, action: "validate" },
    U.supA,
  );
  ok(
    "B4B1-45 unlock is Owner-only with a mandatory reason: Supervisor and General Admin refused (server function and database), empty reason refused; an Owner unlock clears validation, records who / when / reason and is audited",
    owner.pass &&
      reason.pass &&
      u.ok &&
      st.status === "draft" &&
      st.validated_at === null &&
      st.last_unlocked_by === U.ownerA &&
      st.last_unlock_reason === "Declared total was mis-keyed" &&
      audit === 1 &&
      !notValidated.ok &&
      /network_statement_not_validated/.test(notValidated.message) &&
      revalidate.ok,
    `${owner.detail} | ${reason.detail} | ${describe(u, notValidated, revalidate)}`,
  );
}
{
  const r = await checkUnlockPostedFee();
  ok(
    "B4B1-46 unlock is refused once any source fee is posted (server function and direct database update)",
    r.pass,
    r.detail,
  );
}
{
  const s = await reconciledStatement();
  const directValidateAs = (actor) =>
    svc(
      `update public.network_commission_statements set status = 'validated', validated_by = $2, validated_at = now()
       where id = $1`,
      [s.id, actor],
    );
  const wrongTotal = await call(
    nf.setNetworkStatementDeclaredTotal,
    { statementId: s.id, declaredTotalPence: 1 },
    U.ownerA,
  );
  const blockedDirect = await directValidateAs(U.ownerA);
  const rightTotal = await call(
    nf.setNetworkStatementDeclaredTotal,
    { statementId: s.id, declaredTotalPence: 12000 },
    U.ownerA,
  );
  const unauthorisedDirect = await directValidateAs(U.genNoPerm);
  const adviserDirect = await directValidateAs(U.advA);
  const directValidate = await directValidateAs(U.ownerA);
  const insertValidated = await svc(
    `insert into public.network_commission_statements (period_month, status, tenant_id, validated_by, validated_at)
     values ('2030-01-01', 'validated', $1, $2, now())`,
    [T.a, U.ownerA],
  );
  const v = await validatedStatement();
  const directUnlock = await svc(
    `update public.network_commission_statements set status = 'draft', validated_by = null, validated_at = null
     where id = $1`,
    [v.id],
  );
  const supUnlockDirect = await svc(
    `update public.network_commission_statements set status = 'draft', validated_by = null, validated_at = null,
       last_unlocked_by = $2, last_unlocked_at = now(), last_unlock_reason = 'sup' where id = $1`,
    [v.id, U.supA],
  );
  const tenantMove = await svc(
    `update public.network_commission_statements set tenant_id = $2 where id = $1`,
    [s.id, T.b],
  );
  ok(
    "B4B1-47 the statement guard holds without the server functions: validation only with zero blockers and by an authorised validator, no validated insert, no unlock without an Owner and reason, tenant / month identity immutable",
    wrongTotal.ok &&
      !blockedDirect.ok &&
      /network_validation_blocked/.test(blockedDirect.message) &&
      rightTotal.ok &&
      !unauthorisedDirect.ok &&
      /network_finance_forbidden/.test(unauthorisedDirect.message) &&
      !adviserDirect.ok &&
      directValidate.ok &&
      !insertValidated.ok &&
      !directUnlock.ok &&
      !supUnlockDirect.ok &&
      !tenantMove.ok,
    describe(
      wrongTotal,
      blockedDirect,
      rightTotal,
      unauthorisedDirect,
      adviserDirect,
      directValidate,
      insertValidated,
      directUnlock,
      supUnlockDirect,
      tenantMove,
    ),
  );
}
await withDb(
  await (async () => {
    const db = await preB4b1Db(legacyAllocationSeed);
    const m = await applyMigration(db);
    if (!m.ok) throw new Error(`legacy allocation variant: ${m.message}`);
    return db;
  })(),
  async () => {
    const r = await checkLegacyLinkUndated();
    ok(
      "B4B1-48 a pre-existing network allocation keeps its proven link but gets no invented date: validation refuses it (economic date missing), so it stays unpostable",
      r.pass,
      `${r.st} ${describe(r.v)}`,
    );
  },
);

// =============================================================================================
// ACCESS: client roles, service role, functions
// =============================================================================================
{
  const out = [];
  for (const [t, col] of CLIENT_TABLES) {
    for (const [role, sub] of [
      ["anon", null],
      ["authenticated", U.ownerA],
    ]) {
      for (const stmt of [
        `insert into public.${t} default values`,
        `update public.${t} set ${col} = ${col}`,
        `delete from public.${t}`,
        `truncate public.${t}`,
      ]) {
        const r = await asRole(pg, role, stmt, [], sub);
        out.push({ t, role, stmt: stmt.split(" ")[0], ok: r.ok, code: r.code });
      }
    }
  }
  const leaked = out.filter((x) => x.ok || x.code !== "42501");
  ok(
    "B4B1-49 direct client writes are denied: anon and authenticated (even an Owner) cannot insert / update / delete / truncate fee lines, ledger, statements, lines, finance audit, history, capture or archive",
    leaked.length === 0 && out.length === CLIENT_TABLES.length * 8,
    JSON.stringify(leaked),
  );
}
{
  const r = await checkDirectReads();
  ok(
    "B4B1-50 direct client reads are denied on the same tables (the old admin SELECT policies no longer grant access)",
    r.pass,
    JSON.stringify(r.leaked),
  );
}
{
  const months = await call(nf.listNetworkStatementMonths, {}, U.ownerA);
  const detail = await call(nf.getNetworkStatementDetail, { statementId: S1.id }, U.supA);
  const fees = await call(ff.listSessionFees, { sessionId: R.sessA1 }, U.ownerA);
  const foreignFees = await call(ff.listSessionFees, { sessionId: R.sessA1 }, U.ownerB, SLUG.b);
  const ownAlloc = await asRole(
    pg,
    "authenticated",
    `select count(*)::int as n from public.session_advisors where advisor_id = $1`,
    [U.advA3],
    U.advA3,
  );
  ok(
    "B4B1-51 legitimate reads still work through the server functions (months, statement detail, case fees incl. undated drafts) and advisers still see their own allocations; foreign reads refused",
    months.ok &&
      !months.value.migrationRequired &&
      detail.ok &&
      detail.value.lines.length === 5 &&
      fees.ok &&
      fees.value.lines.some((l) => l.id === R.draftA) &&
      fees.value.lines.some((l) => l.id === feeL1) &&
      !foreignFees.ok &&
      ownAlloc.ok &&
      ownAlloc.rows[0].n >= 1,
    describe(months, detail, fees, foreignFees, ownAlloc),
  );
}
{
  const privs = await one(
    `select has_table_privilege('service_role', 'public.finance_fee_lines', 'DELETE') as fd,
            has_table_privilege('service_role', 'public.finance_fee_lines', 'TRUNCATE') as ft,
            has_table_privilege('service_role', 'public.network_commission_statements', 'DELETE') as sd,
            has_table_privilege('service_role', 'public.network_commission_lines', 'DELETE') as ld,
            has_table_privilege('service_role', 'public.session_adviser_assignments', 'DELETE') as hd,
            has_table_privilege('service_role', 'public.session_adviser_history_capture', 'UPDATE') as cu,
            has_table_privilege('service_role', 'public.finance_fee_lines', 'SELECT,INSERT,UPDATE') as fw,
            has_table_privilege('service_role', 'public.finance_ledger', 'SELECT,INSERT') as lw`,
  );
  const rls = await sql(
    `select relname from pg_class where relnamespace = 'public'::regnamespace and not relrowsecurity
     and relname = any($1::text[])`,
    [CLIENT_TABLES.map(([t]) => t)],
  );
  ok(
    "B4B1-52 the service role reads and writes through the guards but cannot delete or truncate fee lines, statements, lines or history; capture is read-only; RLS enabled on every canonical table",
    !privs.fd &&
      !privs.ft &&
      !privs.sd &&
      !privs.ld &&
      !privs.hd &&
      !privs.cu &&
      privs.fw &&
      privs.lw &&
      rls.length === 0,
    JSON.stringify({ privs, rls }),
  );
}
const B4B1_FNS = [
  "session_adviser_history_on_insert",
  "session_adviser_history_on_delete",
  "session_adviser_identity_guard",
  "session_adviser_assignments_guard",
  "resolve_session_advisers_as_of",
  "finance_fee_lines_guard",
  "network_commission_lines_guard",
  "network_commission_statements_guard",
  "network_finance_actor_role",
  "network_finance_audit",
  "network_statement_validation_blockers",
  "allocate_network_line",
  "deallocate_network_line",
  "set_network_line_skip",
  "set_network_line_transaction_date",
  "confirm_network_statement_received_date",
  "set_network_statement_declared_total",
  "replace_network_statement_lines",
  "validate_network_statement",
  "unlock_network_statement",
];
{
  const fns = await sql(
    `select p.proname, p.prosecdef, p.proconfig = array['search_path=""'] as safe,
            has_function_privilege('anon', p.oid, 'EXECUTE') as anon_x,
            has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_x,
            has_function_privilege('service_role', p.oid, 'EXECUTE') as svc_x,
            p.prorettype = 'trigger'::regtype as trig
     from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = any($1::text[])`,
    [B4B1_FNS],
  );
  const clientRpc = await asRole(
    pg,
    "authenticated",
    `select * from public.allocate_network_line($1, $2, $3, $4)`,
    [T.a, U.ownerA, L4.id, R.sessA1],
    U.ownerA,
  );
  const actorSrc = (
    await one(`select prosrc from pg_proc where proname = 'network_finance_actor_role'`)
  ).prosrc;
  ok(
    "B4B1-53 all 20 B4b1 functions are SECURITY INVOKER with an empty search_path; clients cannot execute any; trigger functions are not callable; operations are service-role only; actor authority never consults platform roles (Super Owner not broadened)",
    fns.length === 20 &&
      fns.every(
        (f) => !f.prosecdef && f.safe && !f.anon_x && !f.auth_x && (f.trig ? !f.svc_x : f.svc_x),
      ) &&
      !clientRpc.ok &&
      clientRpc.code === "42501" &&
      !/platform/i.test(actorSrc),
    JSON.stringify(fns.filter((f) => f.prosecdef || !f.safe || f.anon_x || f.auth_x)),
  );
}

// =============================================================================================
// LEGACY SUBMIT / AMEND
// =============================================================================================
{
  const r = await checkLegacySubmit();
  ok(
    "B4B1-54 legacy submitSessionFees fails closed with a clear message and writes nothing (no table write, no RPC, fee lines / ledger / audit unchanged)",
    r.pass,
    describe(r.r) + ` writes=${JSON.stringify(r.writes)}`,
  );
}
{
  const r = await checkLegacyAmend();
  ok(
    "B4B1-55 legacy amendPostedFee (amend and delete) fails closed with a clear message and writes nothing",
    r.pass,
    JSON.stringify(r.writes),
  );
}

// =============================================================================================
// PRESERVATION (B4a, B3, A2, S4C2) AND AUDIT
// =============================================================================================
{
  const rate = await svc(
    `select * from public.resolve_commission_rate_as_of($1, 'adviser', null, $2, 'fee', now())`,
    [T.a, U.advA],
  );
  ok(
    "B4B1-56 B4a preserved: rate-version functions and the commission_rate_versions catalog are byte-identical; the resolver still runs; the migration has no rate DDL",
    (await b4aState(pg)) === preB4a && rate.ok && !/commission_rate/.test(b4b1Sql),
    describe(rate),
  );
}
ok(
  "B4B1-57 B3 preserved: attribution RPC and link / amendment-history catalogs unchanged",
  (await b3State(pg)) === preB3,
);
ok(
  "B4B1-58 A2 preserved: the dual-tenant introducer registrations and the introducers catalog are unchanged",
  (await a2State(pg)) === preA2,
);
ok(
  "B4B1-59 S4C2 preserved: the S4C2 customer's case and membership rows are unchanged; interview_sessions grants, RLS, policies and triggers unchanged (only the (id, tenant_id) key added)",
  (await s4c2State(pg)) === preS4C2,
);
{
  const types = [
    "network_lines_replaced",
    "network_line_allocated",
    "network_line_deallocated",
    "network_line_skipped",
    "network_line_unskipped",
    "network_line_date_set",
    "network_statement_received_date_confirmed",
    "network_statement_declared_total_set",
    "network_statement_validated",
    "network_statement_unlocked",
  ];
  const rows = await sql(
    `select audit_type, count(*)::int as n,
            bool_and(tenant_id is not null and changed_by is not null and detail ? 'statement_id') as complete
     from public.finance_audit_log where audit_type = any($1::text[]) group by 1`,
    [types],
  );
  const tb = await countOf(
    pg,
    "public.finance_audit_log",
    "detail->>'statement_id' = $1 and tenant_id <> $2",
    [SB.id, T.b],
  );
  ok(
    "B4B1-60 every statement operation is audited in the acting tenant with actor and statement",
    types.every((t) => rows.some((r) => r.audit_type === t && r.n > 0 && r.complete)) && tb === 0,
    JSON.stringify(rows),
  );
}

// =============================================================================================
// PRECONDITIONS (fresh databases)
// =============================================================================================
async function migrateVariant(seedMutate, text = b4b1Sql) {
  const db = await preB4b1Db(seedMutate);
  const snap = async () =>
    JSON.stringify({
      st: await rowsText(db, "public.network_commission_statements"),
      sa: await rowsText(db, "public.session_advisors"),
      fees: await rowsText(db, "public.finance_fee_lines"),
      lines: await rowsText(db, "public.network_commission_lines"),
      hist: await relExists(db, "public.session_adviser_assignments"),
      arch: await relExists(db, "public.network_commission_statements_unowned_pre_b4b1"),
    });
  const before = await snap();
  const m = await applyMigration(db, text);
  const after = await snap();
  return { m, unchanged: before === after };
}
const tStatement = (db, id, period, tenantId = T.a, status = "draft") =>
  insertRow(db, "public.network_commission_statements", {
    id,
    period_month: period,
    status,
    tenant_id: tenantId,
  });
const tLine = (db, o) =>
  insertRow(db, "public.network_commission_lines", {
    statement_id: o.statement,
    line_no: o.no ?? 1,
    fee_type: "fee",
    amount_received_pence: o.amount ?? 1000,
    allocation_status: o.status ?? "unmatched",
    matched_session_id: o.session ?? null,
    fee_line_id: o.fee ?? null,
    tenant_id: o.tenant === undefined ? T.a : o.tenant,
  });
const VARIANTS = [
  ["tenantless_statement_unexpected", (db) => tStatement(db, R.pcExtra, "2026-11-01", null)],
  [
    "tenantless_statement_has_lines",
    (db) => tLine(db, { statement: R.octTenantless, tenant: null }),
  ],
  [
    "tenantless_statement_financial_state",
    (db) =>
      sqlOn(
        db,
        `update public.network_commission_statements set status = 'validated' where id = $1`,
        [R.octTenantless],
      ),
  ],
  [
    "line_tenant_null",
    async (db) => {
      await tStatement(db, R.pcS1, "2026-05-01");
      await tLine(db, { statement: R.pcS1, tenant: null });
    },
  ],
  [
    "line_statement_tenant_mismatch",
    async (db) => {
      await tStatement(db, R.pcS1, "2026-05-01");
      await tLine(db, { statement: R.pcS1, tenant: T.b });
    },
  ],
  [
    "line_session_tenant_mismatch",
    async (db) => {
      await tStatement(db, R.pcS1, "2026-05-01");
      await tLine(db, { statement: R.pcS1, session: R.sessB1, status: "matched" });
    },
  ],
  [
    "duplicate_network_allocation",
    async (db) => {
      await tStatement(db, R.pcS1, "2026-05-01");
      await insertRow(db, "public.finance_fee_lines", {
        id: R.pcFee,
        session_id: R.sessA1,
        fee_type: "fee",
        amount_pence: 1000,
        status: "draft",
        tenant_id: T.a,
      });
      await tLine(db, {
        statement: R.pcS1,
        no: 1,
        session: R.sessA1,
        status: "allocated",
        fee: R.pcFee,
      });
      await tLine(db, {
        statement: R.pcS1,
        no: 2,
        session: R.sessA1,
        status: "allocated",
        fee: R.pcFee,
      });
    },
  ],
  [
    "line_fee_link_inconsistent",
    async (db) => {
      await tStatement(db, R.pcS1, "2026-05-01");
      await insertRow(db, "public.finance_fee_lines", {
        id: R.pcFee,
        session_id: R.sessA2,
        fee_type: "fee",
        amount_pence: 1000,
        status: "draft",
        tenant_id: T.a,
      });
      await tLine(db, { statement: R.pcS1, session: R.sessA1, status: "allocated", fee: R.pcFee });
    },
  ],
  [
    "session_adviser_tenant_mismatch",
    (db) =>
      insertRow(db, "public.session_advisors", {
        session_id: R.sessB1,
        advisor_id: U.advA,
        tenant_id: T.a,
      }),
  ],
  [
    "session_adviser_membership_unprovable",
    (db) =>
      insertRow(db, "public.session_advisors", {
        session_id: R.sessA3,
        advisor_id: U.custA,
        tenant_id: T.a,
      }),
  ],
  [
    "fee_line_tenant_null",
    (db) =>
      insertRow(db, "public.finance_fee_lines", {
        session_id: R.sessA1,
        fee_type: "fee",
        amount_pence: 100,
        status: "draft",
        tenant_id: null,
      }),
  ],
  [
    "fee_line_session_tenant_mismatch",
    (db) =>
      insertRow(db, "public.finance_fee_lines", {
        session_id: R.sessB1,
        fee_type: "fee",
        amount_pence: 100,
        status: "draft",
        tenant_id: T.a,
      }),
  ],
];
const variantResults = [];
for (const [reason, seed] of VARIANTS) {
  const r = await migrateVariant(seed);
  variantResults.push({
    reason,
    pass: !r.m.ok && r.m.message.includes(`g7f4s4c4b4b1_precondition:${reason}`) && r.unchanged,
    got: r.m.ok ? "applied" : r.m.message,
    unchanged: r.unchanged,
  });
}
ok(
  "B4B1-61 every structural contradiction fails the migration closed before any change (extra / line-bearing / validated tenantless statement, tenantless or cross-tenant lines, cross-tenant matches, duplicate or inconsistent allocations, cross-tenant or unprovable adviser rows, tenantless or cross-tenant fee lines)",
  variantResults.every((v) => v.pass),
  JSON.stringify(variantResults.filter((v) => !v.pass)),
);

// =============================================================================================
// STATIC: migration, server functions, panel, scope
// =============================================================================================
{
  const assigns = [...b4b1Sql.matchAll(/NEW\.fee_event_date := ([^;]+);/g)].map((m) => m[1].trim());
  const forbidden =
    /fee_event_(?:date|at)\s*:?=\s*[^;\n]*(?:created_at|updated_at|posted_at|allocated_at|validated_at|now\(\)|current_date|current_timestamp)/i;
  ok(
    "B4B1-62 migration: no SECURITY DEFINER; every function has an empty search_path; the economic date is assigned only from the line transaction date or the confirmed received date (never created_at / updated_at / posted_at / allocation / validation time / now()); no rate or ledger DDL; no deletes of lines, fee lines or assignments; tenantless statements never get a tenant",
    !/SECURITY DEFINER/i.test(b4b1Sql) &&
      (b4b1Sql.match(/SET search_path = ''/g) ?? []).length === 20 &&
      JSON.stringify(assigns) ===
        JSON.stringify(["v_line.transaction_date", "v_stmt.received_date"]) &&
      !forbidden.test(b4b1Sql) &&
      !/ALTER TABLE public\.finance_ledger(?! ENABLE ROW LEVEL SECURITY)/.test(b4b1Sql) &&
      !/DELETE FROM public\.(network_commission_lines|finance_fee_lines|session_advisors|session_adviser_assignments)/.test(
        b4b1Sql,
      ) &&
      !/SET tenant_id\s*=/.test(b4b1Sql),
    JSON.stringify(assigns),
  );
}
{
  const body = (src, name) => {
    const start = src.indexOf(`export const ${name} `);
    const next = src.indexOf("\nexport const ", start + 1);
    return start < 0 ? "" : src.slice(start, next < 0 ? undefined : next);
  };
  const rpcs = [
    "replace_network_statement_lines",
    "allocate_network_line",
    "deallocate_network_line",
    "set_network_line_skip",
    "set_network_line_transaction_date",
    "confirm_network_statement_received_date",
    "set_network_statement_declared_total",
    "validate_network_statement",
    "unlock_network_statement",
  ];
  const legacy = body(SRC.finance, "submitSessionFees") + body(SRC.finance, "amendPostedFee");
  ok(
    "B4B1-63 server functions: network operations go through the database operations (no line delete, no direct fee-line or ledger write, no posting flag, no replaceExisting); legacy submit / amend contain no write",
    !/\.delete\(/.test(SRC.network) &&
      !/from\("finance_fee_lines"\)|from\("finance_ledger"\)/.test(SRC.network) &&
      !/postFees|replaceExisting/.test(SRC.network) &&
      rpcs.every((r) => SRC.network.includes(`rpc("${r}"`)) &&
      legacy.length > 0 &&
      !/\.(insert|update|upsert|delete|rpc)\(/.test(legacy) &&
      !/commissionPctAsOf/.test(SRC.finance),
    `legacy=${legacy.length}`,
  );
}
ok(
  "B4B1-64 panel: no replaceExisting / postFees; unlock sends the Owner's reason; the received date needs an explicit confirmation checkbox and sends confirmed: true",
  !/replaceExisting|postFees/.test(SRC.panel) &&
    /reason: action === "unlock" \? unlockReason : undefined/.test(SRC.panel) &&
    /confirmed: true/.test(SRC.panel) &&
    /!receivedConfirmed/.test(SRC.panel) &&
    /unlockReason\.trim\(\)\.length === 0/.test(SRC.panel),
);
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
    "B4B1-65 only authorised files changed against the B4a baseline; no historic verifier, Test Accounts, generated types, session route or earlier migration edited",
    outside.length === 0 && historic.length === 0,
    JSON.stringify({ outside, historic }),
  );
}
ok(
  "B4B1-66 no unexpected network or Auth calls; no missing tables were hit",
  unknownCalls.length === 0 && missingTables.size === 0,
  JSON.stringify({ unknownCalls: unknownCalls.slice(0, 5), missing: [...missingTables] }),
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
  else
    console.error(`FAIL  ${label} (effect=${Boolean(effect)} caught=${Boolean(caught)}) ${detail}`);
}
async function ncSafe(label, fn) {
  try {
    await fn();
  } catch (e) {
    nc(label, { effect: false, caught: false, detail: e instanceof Error ? e.message : String(e) });
  }
}
const sqlMutant = (pairs) => mutate(b4b1Sql, pairs);
const tail = (text, extra) => (text ? `${text}\n${extra}\n` : null);
async function freshCheck(text, check, seedMutate = null) {
  if (!text) return { migrationFailed: "anchor missing" };
  return onFreshDb(text, check, seedMutate);
}

await ncSafe("NC01", async () => {
  const text = sqlMutant([
    [
      "CREATE UNIQUE INDEX finance_fee_lines_active_network_source_key\n  ON public.finance_fee_lines (source_network_line_id)\n  WHERE source_network_line_id IS NOT NULL AND status <> 'deleted';",
      "",
    ],
    [
      "  IF NOT EXISTS (SELECT 1 FROM pg_indexes i WHERE i.schemaname = 'public'\n                   AND i.indexname = 'finance_fee_lines_active_network_source_key')",
      "  IF false AND NOT EXISTS (SELECT 1 FROM pg_indexes i WHERE i.schemaname = 'public'\n                   AND i.indexname = 'finance_fee_lines_active_network_source_key')",
    ],
  ]);
  const r = await freshCheck(text, () => checkUniqueActive());
  nc(
    "NC01 no partial unique index on the active network source: a second active fee line for one network line is accepted → B4B1-25 rejects",
    {
      effect: r.forced?.ok === true && r.active1 === 2,
      caught: r.pass === false,
      detail: r.migrationFailed ?? JSON.stringify({ forced: r.forced, active1: r.active1 }),
    },
  );
});
await ncSafe("NC02", async () => {
  const text = sqlMutant([
    [
      "    ELSE\n      RAISE EXCEPTION 'network_allocation_date_required';\n    END IF;",
      "    ELSE\n      NEW.fee_event_date := (now() AT TIME ZONE 'Europe/London')::date;\n      NEW.fee_event_source := 'network_line_transaction_date';\n      NEW.fee_event_evidence := '{}'::jsonb;\n    END IF;",
    ],
    [
      "  IF v_line.transaction_date IS NULL\n     AND (v_stmt.received_date IS NULL OR v_stmt.received_date_confirmed_at IS NULL) THEN\n    RAISE EXCEPTION 'network_allocation_date_required';\n  END IF;",
      "",
    ],
  ]);
  const r = await freshCheck(text, () => checkDateRequired());
  nc("NC02 a dateless line is allocated with now() as its economic date → B4B1-21 rejects", {
    effect: r.fees?.length === 1 && r.fees[0].d !== null,
    caught: r.pass === false,
    detail: r.migrationFailed ?? JSON.stringify(r.fees),
  });
});
await ncSafe("NC03", async () => {
  const text = sqlMutant([
    [
      "  UPDATE public.network_commission_statements s\n  SET status = 'validated', validated_by = p_actor_user_id, validated_at = v_now, updated_at = v_now\n  WHERE s.id = v_stmt.id;",
      "  UPDATE public.network_commission_statements s\n  SET status = 'validated', validated_by = p_actor_user_id, validated_at = v_now, updated_at = v_now\n  WHERE s.id = v_stmt.id;\n  UPDATE public.finance_fee_lines f SET status = 'posted', posted_at = v_now\n  FROM public.network_commission_lines l\n  WHERE l.id = f.source_network_line_id AND l.statement_id = v_stmt.id AND f.status = 'draft';",
    ],
    ["  RAISE EXCEPTION 'finance_fee_line_transition_forbidden';", "  RETURN NEW;"],
  ]);
  const r = await freshCheck(text, () => checkValidateNoPost());
  nc("NC03 validation auto-posts the statement's fees → B4B1-42 rejects", {
    effect: r.fee?.st === "posted",
    caught: r.pass === false,
    detail: r.migrationFailed ?? JSON.stringify({ st: r.fee?.st, v: r.v?.message }),
  });
});
await ncSafe("NC04", async () => {
  const text = sqlMutant([
    [
      "      OR (p_capability <> 'unlock' AND m.role::text = 'supervisor')",
      "      OR (m.role::text = 'supervisor')",
    ],
    [
      "           AND m.role::text = 'owner' AND m.active",
      "           AND m.role::text IN ('owner', 'supervisor') AND m.active",
    ],
  ]);
  const mod = await mutantOf("network", [
    [
      '      if (!view.adminAccess.isOwner) {\n        throw new Error("Only an Owner can unlock a validated statement.");\n      }\n',
      "",
    ],
  ]);
  const r = mod
    ? await freshCheck(text, () => checkUnlockOwnerOnly(mod))
    : { migrationFailed: "ts anchor" };
  nc("NC04 Supervisor unlock allowed (server function and database) → B4B1-45 rejects", {
    effect: r.st?.status === "draft",
    caught: r.pass === false,
    detail: r.migrationFailed ?? r.detail,
  });
});
await ncSafe("NC05", async () => {
  const text = sqlMutant([
    [
      "  IF v_reason IS NULL OR char_length(v_reason) > 500 THEN\n    RAISE EXCEPTION 'network_unlock_reason_required'",
      "  IF false THEN\n    RAISE EXCEPTION 'network_unlock_reason_required'",
    ],
    ["       AND NULLIF(btrim(COALESCE(NEW.last_unlock_reason, '')), '') IS NOT NULL\n", ""],
    [
      "      AND char_length(btrim(COALESCE(last_unlock_reason, ''))) BETWEEN 1 AND 500)",
      "      )",
    ],
  ]);
  const mod = await mutantOf("network", [
    ['        (v) => v.action !== "unlock" || Boolean(v.reason),', "        () => true,"],
  ]);
  const r = mod
    ? await freshCheck(text, () => checkUnlockReason(mod))
    : { migrationFailed: "ts anchor" };
  nc("NC05 unlock without a reason accepted → B4B1-45 rejects", {
    effect: r.st?.status === "draft",
    caught: r.pass === false,
    detail: r.migrationFailed ?? r.detail,
  });
});
await ncSafe("NC06", async () => {
  const text = sqlMutant([
    [
      "    RAISE EXCEPTION 'network_unlock_posted_fee';\n  END IF;\n  UPDATE public.network_commission_statements s\n  SET status = 'draft'",
      "    NULL;\n  END IF;\n  UPDATE public.network_commission_statements s\n  SET status = 'draft'",
    ],
    ["        RAISE EXCEPTION 'network_unlock_posted_fee';", "        NULL;"],
  ]);
  const r = await freshCheck(text, () => checkUnlockPostedFee());
  nc("NC06 unlock ignores a posted source fee → B4B1-46 rejects", {
    effect: r.st?.status === "draft",
    caught: r.pass === false,
    detail: r.migrationFailed ?? r.detail,
  });
});
await ncSafe("NC07", async () => {
  const text = tail(
    sqlMutant([
      [
        "  UPDATE public.network_commission_lines l\n  SET superseded_at = now(), superseded_by = p_actor_user_id, updated_at = now()\n  WHERE l.statement_id = v_stmt.id AND l.superseded_at IS NULL;",
        "  DELETE FROM public.network_commission_lines l\n  WHERE l.statement_id = v_stmt.id AND l.superseded_at IS NULL;",
      ],
      [
        "  IF TG_OP IN ('DELETE', 'TRUNCATE') THEN\n    RAISE EXCEPTION 'network_line_delete_forbidden';\n  END IF;",
        "  IF TG_OP = 'DELETE' THEN\n    RETURN OLD;\n  END IF;",
      ],
    ]),
    "GRANT DELETE ON public.network_commission_lines TO service_role;",
  );
  const r = await freshCheck(text, () => checkReparseSupersedes());
  nc("NC07 re-parse deletes the previous lines instead of superseding them → B4B1-39 rejects", {
    effect: r.total === 3,
    caught: r.pass === false,
    detail: r.migrationFailed ?? `total=${r.total} ${describe(r.p)}`,
  });
});
await ncSafe("NC08", async () => {
  const text = sqlMutant([
    ["    RAISE EXCEPTION 'network_reparse_active_allocation';", "    NULL;"],
    [
      "    IF OLD.allocation_status = 'allocated'\n       OR NOT (v_changed <@ ARRAY['superseded_at', 'superseded_by', 'updated_at']) THEN",
      "    IF NOT (v_changed <@ ARRAY['superseded_at', 'superseded_by', 'updated_at']) THEN",
    ],
  ]);
  const r = await freshCheck(text, () => checkReparseActive());
  nc(
    "NC08 re-parse allowed with an active allocation: the fee is left on a superseded line → B4B1-38 rejects",
    {
      effect: r.orphans > 0,
      caught: r.pass === false,
      detail: r.migrationFailed ?? `orphans=${r.orphans}`,
    },
  );
});
await ncSafe("NC09", async () => {
  const text = sqlMutant([
    ["    RAISE EXCEPTION 'network_deallocation_fee_not_draft';", "    NULL;"],
    ["  IF v_fee.status::text = 'draft' THEN", "  IF true THEN"],
    [
      "  IF OLD.status::text = 'draft' AND NEW.status::text = 'deleted'",
      "  IF NEW.status::text = 'deleted'",
    ],
  ]);
  const r = await freshCheck(text, () => checkDeallocPosted());
  nc("NC09 deallocation voids a posted fee → B4B1-37 rejects", {
    effect: r.f1?.st === "deleted",
    caught: r.pass === false,
    detail: r.migrationFailed ?? r.detail,
  });
});
await ncSafe("NC10", async () => {
  const text = sqlMutant([
    [
      "  ELSIF v_stmt.declared_total_pence <> v_sum THEN\n    v_out := array_append(v_out, 'total_mismatch');\n",
      "",
    ],
  ]);
  const r = await freshCheck(text, () => checkTotalReconcile());
  nc("NC10 validation ignores a declared-total mismatch → B4B1-41 rejects", {
    effect: r.st?.status === "validated",
    caught: r.pass === false,
    detail: r.migrationFailed ?? describe(r.v),
  });
});
await ncSafe("NC11", async () => {
  const text = sqlMutant([
    [
      "  IF v_status IS NULL OR v_status NOT IN ('draft', 'annotated') THEN\n    RAISE EXCEPTION 'network_statement_frozen';\n  END IF;\n\n  IF NEW.superseded_at IS NOT NULL THEN",
      "  IF NEW.superseded_at IS NOT NULL THEN",
    ],
  ]);
  const r = await freshCheck(text, () => checkFreeze());
  nc("NC11 lines of a validated statement stay editable (no freeze) → B4B1-43 rejects", {
    effect: r.changed === true,
    caught: r.pass === false,
    detail: r.migrationFailed ?? JSON.stringify(r.allowed),
  });
});
await ncSafe("NC12", async () => {
  const text = sqlMutant([
    [
      "      AND a.assigned_at <= p_event_at\n      AND (a.unassigned_at IS NULL OR p_event_at < a.unassigned_at)",
      "      AND a.unassigned_at IS NULL",
    ],
  ]);
  const r = await freshCheck(text, () => checkResolverAsOf());
  nc("NC12 resolver returns the current assignment for a past instant → B4B1-17 rejects", {
    effect: typeof r.r?.mid === "string" && r.r.mid.includes(U.advA3),
    caught: r.pass === false,
    detail: r.migrationFailed ?? JSON.stringify(r.r),
  });
});
await ncSafe("NC13", async () => {
  const text = sqlMutant([["  IF NOT v_found THEN", "  IF false THEN"]]);
  const r = await freshCheck(text, () => checkResolverAsOf());
  nc(
    "NC13 resolver returns an empty set instead of an explicit no-proof / none result → B4B1-17 rejects",
    {
      effect: r.r?.before === "" && r.r?.preCapture === "",
      caught: r.pass === false,
      detail: r.migrationFailed ?? JSON.stringify(r.r),
    },
  );
});
await ncSafe("NC14", async () => {
  const text = sqlMutant([
    [
      "INSERT INTO public.network_commission_statements_unowned_pre_b4b1\nSELECT s.* FROM public.network_commission_statements s WHERE s.tenant_id IS NULL;\nDELETE FROM public.network_commission_statements s WHERE s.tenant_id IS NULL;",
      "UPDATE public.network_commission_statements s SET tenant_id = (\n  SELECT m.tenant_id FROM public.tenant_memberships m WHERE m.user_id = s.created_by ORDER BY m.created_at LIMIT 1)\nWHERE s.tenant_id IS NULL;",
    ],
    [
      "  IF EXISTS (SELECT 1 FROM public.network_commission_statements s WHERE s.tenant_id IS NULL)\n     OR EXISTS (",
      "  IF false AND EXISTS (",
    ],
    [
      "    to_jsonb(t) - ARRAY['received_date', 'received_date_confirmed_by', 'received_date_confirmed_at',\n                        'received_date_evidence', 'declared_total_pence', 'declared_total_set_by',\n                        'declared_total_set_at', 'last_unlocked_by', 'last_unlocked_at',\n                        'last_unlock_reason'] AS j\n  FROM public.network_commission_statements t\n",
      "    to_jsonb(t) - ARRAY['received_date', 'received_date_confirmed_by', 'received_date_confirmed_at',\n                        'received_date_evidence', 'declared_total_pence', 'declared_total_set_by',\n                        'declared_total_set_at', 'last_unlocked_by', 'last_unlocked_at',\n                        'last_unlock_reason'] AS j\n  FROM public.network_commission_statements t\n  WHERE t.id NOT IN (SELECT b.id FROM pg_temp.g7f4s4c4b4b1_tenantless_before b)\n",
    ],
  ]);
  if (!text) {
    nc("NC14 tenantless statement assigned to its creator's tenant", {
      effect: false,
      caught: false,
      detail: "anchor",
    });
    return;
  }
  const db = await preB4b1Db();
  const before = (
    await sqlOn(
      db,
      `select s::text as t from public.network_commission_statements s where tenant_id is null`,
    )
  ).map((r) => r.t);
  const m = await applyMigration(db, text);
  const r = m.ok ? await checkArchive(db, before) : null;
  nc(
    "NC14 the tenantless October statement is assigned to its creator's tenant instead of archived → B4B1-02 rejects",
    {
      effect: r?.live?.[0]?.tenant_id === T.a,
      caught: r?.pass === false,
      detail: m.ok ? JSON.stringify(r.live) : m.message,
    },
  );
});
await ncSafe("NC15", async () => {
  const text = sqlMutant([
    [
      "  IF (SELECT count(*) FROM public.network_commission_statements s WHERE s.tenant_id IS NULL) > 1 THEN",
      "  IF false THEN",
    ],
  ]);
  const r = text ? await migrateVariant(VARIANTS[0][1], text) : null;
  const archived = r?.m.ok ? "applied" : r?.m.message;
  nc(
    "NC15 the extra-tenantless-statement precondition removed: an unexpected tenantless statement is silently archived → B4B1-61 rejects",
    {
      effect: r?.m.ok === true,
      caught: Boolean(r) && !(!r.m.ok && r.m.message.includes("tenantless_statement_unexpected")),
      detail: String(archived),
    },
  );
});
await ncSafe("NC16", async () => {
  const text = tail(b4b1Sql, "GRANT SELECT ON public.finance_fee_lines TO authenticated;");
  const r = await freshCheck(text, async (db) => {
    const res = await checkDirectReads();
    const read = await asRole(
      db,
      "authenticated",
      `select count(*)::int as n from public.finance_fee_lines`,
      [],
      U.ownerA,
    );
    return { ...res, read };
  });
  nc(
    "NC16 direct authenticated SELECT on fee lines restored: an Owner reads fee lines directly → B4B1-50 rejects",
    {
      effect: r.read?.ok === true && r.read.rows[0].n > 0,
      caught: r.pass === false,
      detail: r.migrationFailed ?? JSON.stringify(r.read),
    },
  );
});
await ncSafe("NC17", async () => {
  const mod = await mutantOf("finance", [
    [
      '    throw new Error(\n      "Posting fees is not available yet. Draft fees stay on the case until economic-date posting is enabled.",\n    );',
      '    const { supabaseAdminUntyped: legacyDb } = await import("@/integrations/supabase/client.server");\n    await legacyDb.from("finance_ledger").insert({ kind: "post", session_id: data.sessionId, amount_pence: 50000, tenant_id: tenantId });\n    throw new Error("Posting fees is not available yet. Draft fees stay on the case until economic-date posting is enabled.");',
    ],
  ]);
  const r = mod
    ? await freshCheck(b4b1Sql, () => checkLegacySubmit(mod))
    : { migrationFailed: "ts anchor" };
  nc("NC17 legacy submitSessionFees writes a ledger row before failing → B4B1-54 rejects", {
    effect: r.ledgerDelta === 1,
    caught: r.pass === false,
    detail: r.migrationFailed ?? JSON.stringify(r.writes),
  });
});
await ncSafe("NC18", async () => {
  const mod = await mutantOf("finance", [
    [
      '    throw new Error(\n      "Amending or deleting posted fees is not available yet. Posted fees are unchanged.",\n    );',
      '    const { supabaseAdminUntyped: legacyDb } = await import("@/integrations/supabase/client.server");\n    await legacyDb.from("finance_ledger").insert({ kind: "amend", fee_line_id: data.lineId, amount_pence: -100, tenant_id: tenantId });\n    throw new Error("Amending or deleting posted fees is not available yet. Posted fees are unchanged.");',
    ],
  ]);
  const r = mod
    ? await freshCheck(b4b1Sql, () => checkLegacyAmend(mod))
    : { migrationFailed: "ts anchor" };
  nc("NC18 legacy amendPostedFee writes a ledger amendment before failing → B4B1-55 rejects", {
    effect: r.ledgerDelta >= 1,
    caught: r.pass === false,
    detail: r.migrationFailed ?? JSON.stringify(r.writes),
  });
});
await ncSafe("NC19", async () => {
  const text = sqlMutant([
    [
      "  IF p_confirmed IS NOT TRUE THEN\n    RAISE EXCEPTION 'network_received_date_unconfirmed'",
      "  IF false THEN\n    RAISE EXCEPTION 'network_received_date_unconfirmed'",
    ],
  ]);
  const mod = await mutantOf("network", [
    ["        confirmed: z.literal(true),", "        confirmed: z.boolean(),"],
  ]);
  const r = mod
    ? await freshCheck(text, () => checkReceivedConfirm(mod))
    : { migrationFailed: "ts anchor" };
  nc("NC19 received date accepted without staff confirmation → B4B1-26 rejects", {
    effect: Boolean(r.mid?.rd),
    caught: r.pass === false,
    detail: r.migrationFailed ?? JSON.stringify(r.mid),
  });
});
await ncSafe("NC20", async () => {
  const text = sqlMutant([
    [
      "  IF pg_trigger_depth() < 2 THEN\n    RAISE EXCEPTION 'session_adviser_history_direct_write_forbidden';\n  END IF;\n",
      "",
    ],
  ]);
  const r = await freshCheck(text, () => checkHistoryDirect());
  nc(
    "NC20 history accepts direct service-role writes: a backdated assignment is forged → B4B1-16 rejects",
    {
      effect: r.forged?.ok === true,
      caught: r.pass === false,
      detail: r.migrationFailed ?? r.detail,
    },
  );
});
await ncSafe("NC21", async () => {
  const text = sqlMutant([
    ["    RAISE EXCEPTION 'finance_fee_line_source_immutable';", "    RETURN NEW;"],
  ]);
  const r = await freshCheck(text, () => checkFeeImmutable());
  nc("NC21 fee source facts editable in place (amount / date / session) → B4B1-33 rejects", {
    effect: Array.isArray(r.allowed) && r.allowed.includes("amount"),
    caught: r.pass === false,
    detail: r.migrationFailed ?? JSON.stringify(r.allowed),
  });
});
await ncSafe("NC22", async () => {
  const text = sqlMutant([
    [
      "      AND l.allocation_status = 'allocated' AND f.fee_event_date IS NULL\n  ) THEN\n    v_out := array_append(v_out, 'economic_date_missing');",
      "      AND false\n  ) THEN\n    v_out := array_append(v_out, 'economic_date_missing');",
    ],
  ]);
  const r = await freshCheck(text, () => checkLegacyLinkUndated(), legacyAllocationSeed);
  nc("NC22 validation accepts an allocated fee with no economic date → B4B1-48 rejects", {
    effect: r.st === "validated",
    caught: r.pass === false,
    detail: r.migrationFailed ?? describe(r.v),
  });
});

await ncSafe("NC23", async () => {
  const text = sqlMutant([
    [
      "    PERFORM public.network_finance_actor_role(NEW.tenant_id, NEW.validated_by, 'validate');\n",
      "",
    ],
  ]);
  const r = await freshCheck(text, async () => {
    const s = await reconciledStatement();
    const direct = await svc(
      `update public.network_commission_statements set status = 'validated', validated_by = $2, validated_at = now()
       where id = $1`,
      [s.id, U.genNoPerm],
    );
    return { direct, st: await stmtOf(s.id) };
  });
  nc(
    "NC23 the statement guard accepts a direct validation recorded against a member without validate authority → B4B1-47 rejects",
    {
      effect:
        r.direct?.ok === true && r.st?.status === "validated" && r.st.validated_by === U.genNoPerm,
      caught: r.direct?.ok === true,
      detail: r.migrationFailed ?? describe(r.direct),
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
