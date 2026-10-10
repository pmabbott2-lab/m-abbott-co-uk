/**
 * G7F-4S4C4-B4c-1 — regression coverage: targeted tests for the historic B1C, B2b, B4b2 and F1
 * invariants that the B4c-1 RAF model retired or reshaped, run on a real PostgreSQL server.
 *
 * Same harness as scripts/g7f4s4c4b4c1-raf-authority-verify.mjs: a disposable local PostgreSQL 17
 * server (embedded-postgres) with the B4b2 verifier's staging-shaped base schema, the staging RAF
 * shapes, the real G6B link policy and the B3, B4a, B4b1, B4b2, F1 and B4c-1 migrations (all read
 * unchanged from the working tree); the real referral and session server functions run unmodified
 * through a fake PostgREST layer on a non-routable host. SMS is recorded in memory, never sent.
 *
 * Negative controls remove one tenant protection each (a migration mutant or a mutant of the real
 * referral source) and show the unsafe effect happening and the matching test predicate rejecting
 * it.
 *
 * Synthetic fixtures only: no network, no staging, no production, no real user, phone or token.
 *
 * Dependencies: npm install --prefix /tmp/b4b2-conc embedded-postgres@17.6.0-beta.15 pg@8
 * Run: npm exec --yes --package=tsx -- tsx scripts/g7f4s4c4b4c1-regression-coverage-verify.mjs
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire, register } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
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
const read = (rel) => readFileSync(resolve(root, rel), "utf8");
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
const ncResults = [];
function nc(label, { effect, caught, detail = "" }) {
  const pass = Boolean(effect) && Boolean(caught);
  ncResults.push({ label, pass });
  if (pass) console.log(`PASS  ${label}`);
  else console.error(`FAIL  ${label} — effect=${Boolean(effect)} caught=${Boolean(caught)} ${detail}`);
}
async function outcome(fn) {
  try {
    return { ok: true, value: await fn() };
  } catch (e) {
    return { ok: false, error: e, message: String(e?.message ?? e), code: e?.code };
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const B4C1_REL = "supabase/migrations/20261009120000_gate_g7f4s4c4b4c1_raf_authority_audit.sql";
const B4B2_REL =
  "supabase/migrations/20261008120000_gate_g7f4s4c4b4b2_atomic_posting_ledger_adjustments.sql";
const F1_REL = "supabase/migrations/20261008190000_gate_g7f4s4c4b4b2f1_payout_case_lock_order.sql";
const B4B1_REL =
  "supabase/migrations/20261007200000_gate_g7f4s4c4b4b1_statement_economic_date_adviser_history.sql";
const B4A_REL = "supabase/migrations/20261007160000_gate_g7f4s4c4b4a_commission_rate_versions.sql";
const B3_REL =
  "supabase/migrations/20261007120000_gate_g7f4s4c4b3_customer_introducer_attribution_tenant_key.sql";
const G6B_REL = "supabase/migrations/20260918200000_gate_g6b_enable_rls_six_unprotected_tables.sql";
const REFERRALS_REL = "src/lib/referrals.functions.ts";
const B4B2_VERIFIER_REL = "scripts/g7f4s4c4b4b2-financial-posting-verify.mjs";

const b4c1Sql = read(B4C1_REL);
const b4b2Sql = read(B4B2_REL);
const f1Sql = read(F1_REL);
const b4b1Sql = read(B4B1_REL);
const b4aSql = read(B4A_REL);
const b3Sql = read(B3_REL);
const linkPolicySql = read(G6B_REL).match(
  /DROP POLICY IF EXISTS "Read customer introducer links"[\s\S]*?\n {2}\);/,
)?.[0];
const BASE_SCHEMA = (() => {
  const src = read(B4B2_VERIFIER_REL);
  const tok = "const BASE_SCHEMA = `";
  const s0 = src.indexOf(tok) + tok.length;
  const text = src.slice(s0, src.indexOf("\n`;", s0));
  if (s0 < tok.length || text.includes("\\") || text.includes("${")) {
    throw new Error("B4b2 verifier BASE_SCHEMA is not a plain literal");
  }
  return text;
})();
const ROLES_SQL = "create role anon; create role authenticated; create role service_role bypassrls;";
if (!BASE_SCHEMA.trimStart().startsWith(ROLES_SQL)) throw new Error("BASE_SCHEMA role prelude changed");
const DB_SCHEMA = BASE_SCHEMA.replace(ROLES_SQL, "");
const sha256 = (s) => createHash("sha256").update(s, "utf8").digest("hex");

// Staging shapes (read-only staging catalog inventory) of the RAF and feature tables that the
// B4b2 base schema carries only as bare columns.
const RAF_STAGING_SQL = `
alter table public.referral_codes
  add constraint referral_codes_code_key unique (code),
  add constraint referral_codes_code_format check ((code ~ '^[A-Za-z0-9]{4,16}$'::text)),
  add constraint referral_codes_created_by_fkey foreign key (created_by) references auth.users(id) on delete set null,
  add constraint referral_codes_referrer_user_id_fkey foreign key (referrer_user_id) references auth.users(id) on delete set null,
  add constraint referral_codes_tenant_id_fkey foreign key (tenant_id) references public.tenants(id);
alter table public.referrals
  add constraint referrals_bonus_status_check check ((bonus_status = any (array['none'::text, 'eligible'::text, 'paid'::text, 'rejected'::text]))),
  add constraint referrals_status_check check ((status = any (array['pending'::text, 'signed_up'::text, 'qualified'::text, 'rewarded'::text]))),
  add constraint referrals_code_referred_user_id_key unique (code, referred_user_id),
  add constraint referrals_referral_code_id_fkey foreign key (referral_code_id) references public.referral_codes(id) on delete set null,
  add constraint referrals_referred_user_id_fkey foreign key (referred_user_id) references auth.users(id) on delete set null,
  add constraint referrals_referrer_user_id_fkey foreign key (referrer_user_id) references auth.users(id) on delete set null,
  add constraint referrals_tenant_id_fkey foreign key (tenant_id) references public.tenants(id);
create index idx_referral_codes_referrer on public.referral_codes (referrer_user_id);
create index referral_codes_tenant_id_idx on public.referral_codes (tenant_id);
create index idx_referrals_referred on public.referrals (referred_user_id);
create index referrals_tenant_id_idx on public.referrals (tenant_id);
alter table public.referral_codes enable row level security;
alter table public.referrals enable row level security;
create policy "Staff manage referral codes" on public.referral_codes for all to authenticated
  using (public.auth_is_tenant_staff(tenant_id)) with check (public.auth_is_tenant_staff(tenant_id));
create policy "Staff view referrals" on public.referrals for select to authenticated
  using (public.auth_is_tenant_staff(tenant_id));
grant all on public.referrals, public.referral_codes to anon, authenticated;

create type public.feature_state as enum ('disabled','enabled','entitlement_blocked','rollout_hidden');
create table public.feature_catalogue (
  feature_key text primary key, name text not null, description text,
  default_enabled boolean not null default false, supports_config boolean not null default false,
  sort_order integer not null default 100, active boolean not null default true,
  created_at timestamptz not null default now()
);
create table public.tenant_features (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  feature_key text not null references public.feature_catalogue(feature_key),
  state public.feature_state not null default 'disabled',
  config jsonb not null default '{}'::jsonb, entitlement jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  constraint tenant_features_unique unique (tenant_id, feature_key)
);
create or replace function public.is_tenant_feature_enabled(p_tenant_id uuid, p_feature_key text)
  returns boolean language sql stable security definer set search_path = public as
  $$ SELECT COALESCE((SELECT tf.state = 'enabled'::public.feature_state FROM public.tenant_features tf
       WHERE tf.tenant_id = p_tenant_id AND tf.feature_key = p_feature_key),
     (SELECT fc.default_enabled FROM public.feature_catalogue fc
       WHERE fc.feature_key = p_feature_key AND fc.active = true), false) $$;
insert into public.feature_catalogue (feature_key, name, default_enabled) values
  ('refer_a_friend', 'Refer a friend', false);
`;

// --- module stubs (the referral and session server functions run unmodified) --------------------
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
export function getRequest() { return globalThis.__B4C1_REQUEST ?? null; }
export function getCookie() { return undefined; }
export function setCookie() {}
export function deleteCookie() {}
`;
// Platform Enter Company: an active session is simulated per (user, tenant) via a global table.
const stubPlatform = `
export async function validatePlatformTenantAccessSession(input) {
  const p = (globalThis.__B4C1_PLATFORM ?? {})[input.userId];
  return p && p.tenantId === input.tenantId ? { accessLevel: p.level, basisLabel: "verifier" } : null;
}
export async function hasValidPlatformTenantAccess() { return false; }
export async function clearPlatformTenantEntryOnLogout() {}
`;
const stubSms = `
export * from ${JSON.stringify(fileUrl("src/lib/sms.server.ts"))};
export function isTwilioConfigured() { return true; }
export async function sendSms(input) {
  const outbox = (globalThis.__COV_SMS ??= []);
  outbox.push({ to: input.to, body: input.body });
  return { sid: "SMcoverage" + outbox.length };
}
export async function sendInterviewCompleteSms() {}
`;
const stubMfa = `
export * from ${JSON.stringify(fileUrl("src/lib/privileged-mfa.server.ts"))};
export async function requireFreshPrivilegedAuth() {}
export async function requirePlatformAal2() {}
`;
const stubOpenAi = `
export async function chatCompletion() { throw new Error("AI refused in verifier"); }
`;
const stubTasks = `
export async function ensureWelcomeCallTask() { return null; }
`;
const mutantMark = "/*b4c1cov-mutant:referrals*/";
const hookSource = `
const MUTANTS = ${JSON.stringify({ [dataUrl(mutantMark)]: fileUrl(REFERRALS_REL) })};
const STUBS = {
  start: ${JSON.stringify(dataUrl(stubStart))},
  startServer: ${JSON.stringify(dataUrl(stubStartServer))},
  platform: ${JSON.stringify(dataUrl(stubPlatform))},
  sms: ${JSON.stringify(dataUrl(stubSms))},
  mfa: ${JSON.stringify(dataUrl(stubMfa))},
  openai: ${JSON.stringify(dataUrl(stubOpenAi))},
  tasks: ${JSON.stringify(dataUrl(stubTasks))},
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
  if (parent.startsWith("data:")) return next(specifier, context);
  if (specifier === "@tanstack/react-start") return { url: STUBS.start, shortCircuit: true };
  if (specifier === "@tanstack/react-start/server") return { url: STUBS.startServer, shortCircuit: true };
  if (/platform-tenant-entry\\.server(\\.ts)?$/.test(specifier)) return { url: STUBS.platform, shortCircuit: true };
  if (/(^|\\/)sms\\.server(\\.ts)?$/.test(specifier)) return { url: STUBS.sms, shortCircuit: true };
  if (/(^|\\/)privileged-mfa\\.server(\\.ts)?$/.test(specifier)) return { url: STUBS.mfa, shortCircuit: true };
  if (/(^|\\/)openai\\.server(\\.ts)?$/.test(specifier)) return { url: STUBS.openai, shortCircuit: true };
  if (/(^|\\/)staff-contact-tasks\\.server(\\.ts)?$/.test(specifier)) return { url: STUBS.tasks, shortCircuit: true };
  return next(specifier, context);
}
`;
register(dataUrl(hookSource), import.meta.url);

// --- real PostgreSQL server ---------------------------------------------------------------------
const depDir = process.env.G7F4S4C4B4C1_PG_DIR || process.env.G7F4S4C4B4B2F1_PG_DIR || "/tmp/b4b2-conc";
let EmbeddedPostgres;
let pg;
try {
  const req = createRequire(join(depDir, "package.json"));
  ({ default: EmbeddedPostgres } = await import(pathToFileURL(req.resolve("embedded-postgres")).href));
  ({ default: pg } = await import(pathToFileURL(req.resolve("pg")).href));
} catch (e) {
  console.error(`FAIL  embedded-postgres / pg not found in ${depDir} (${e.message}). See header.`);
  process.exit(1);
}
pg.types.setTypeParser(20, Number);
pg.types.setTypeParser(1700, Number);
pg.types.setTypeParser(1082, (s) => s);

const DATA_DIR = mkdtempSync(join(tmpdir(), "g7f4s4c4b4c1cov-pg-"));
const PASSWORD = randomBytes(18).toString("hex");
const PORT = 57000 + Math.floor(Math.random() * 900);
const server = new EmbeddedPostgres({
  databaseDir: DATA_DIR,
  user: "postgres",
  password: PASSWORD,
  port: PORT,
  persistent: false,
  initdbFlags: ["--locale=C", "--encoding=UTF8"],
  onLog: () => {},
  onError: () => {},
});
let serverStarted = false;
async function shutdown() {
  if (serverStarted) {
    serverStarted = false;
    await server.stop().catch(() => {});
  }
  rmSync(DATA_DIR, { recursive: true, force: true });
}
const baseCfg = { host: "127.0.0.1", port: PORT, user: "postgres", password: PASSWORD };

// --- quiet logs ---------------------------------------------------------------------------------
const logs = [];
for (const level of ["log", "info", "warn", "error", "debug"]) {
  const orig = console[level].bind(console);
  console[level] = (...a) => {
    const line = a
      .map((x) => (x instanceof Error ? x.message : typeof x === "string" ? x : JSON.stringify(x)))
      .join(" ");
    if (level === "error" && line.startsWith("FAIL  ")) orig(...a);
    else if (level === "log" && (line.startsWith("PASS  ") || /^[A-Z_0-9]+=/.test(line))) orig(...a);
    else {
      logs.push(`[${level}] ${line}`);
      if (process.env.G7F4S4C4B4C1COV_DEBUG) orig(...a);
    }
  };
}

// --- fixtures -----------------------------------------------------------------------------------
const idProxy = () =>
  new Proxy({}, { get: (o, k) => (typeof k === "string" ? (o[k] ??= randomUUID()) : o[k]) });
const U = idProxy();
const R = idProxy();
const T = { a: randomUUID(), b: randomUUID(), c: randomUUID() };
const SLUG = { a: "tenant-a", b: "tenant-b" };
const LEGACY_AT = "2026-09-01T09:00:00.000Z";
const CODE = { a1: "LEGACYA1", a2: "LEGACYA2", b1: "LEGACYB1" };

async function buildDb(name, { b4c1 = true, b4c1Text = b4c1Sql, b4b2 = true, legacy = true, after = null } = {}) {
  const admin0 = new pg.Client({ ...baseCfg, database: "postgres" });
  await admin0.connect();
  await admin0.query(`create database ${name}`);
  await admin0.query(`alter database ${name} set timezone to 'UTC'`);
  await admin0.end();
  const cfg = { ...baseCfg, database: name };
  const connect = async () => {
    const c = new pg.Client(cfg);
    c.on("error", () => {});
    await c.connect();
    await c.query(`set statement_timeout = '30s'`);
    return c;
  };
  const admin = await connect();
  const q = async (text, params = []) => (await admin.query(text, params)).rows;
  const one = async (text, params = []) => (await q(text, params))[0] ?? null;
  await admin.query(DB_SCHEMA);
  await admin.query(RAF_STAGING_SQL);
  await admin.query(linkPolicySql);
  await admin.query(b3Sql);
  await q(
    `insert into public.tenants (id, company_code, slug, company_name, status) values
     ($1,'901','tenant-a','Tenant A Ltd','active'), ($2,'902','tenant-b','Tenant B Ltd','active'),
     ($3,'903','tenant-c','Tenant C Ltd','suspended')`,
    [T.a, T.b, T.c],
  );
  const addUser = async (key) => {
    const email = `${key.toLowerCase()}@example.test`;
    await q(`insert into auth.users (id, email, email_confirmed_at) values ($1, $2, now())`, [U[key], email]);
    await q(`insert into public.profiles (id, email, full_name) values ($1, $2, $3)`, [U[key], email, `${key} Person`]);
  };
  const addMember = (key, tenant, role) =>
    q(`insert into public.tenant_memberships (tenant_id, user_id, role) values ($1, $2, $3)`, [tenant, U[key], role]);
  const people = [
    ["ownerA", [[T.a, "owner"]]],
    ["ownerB", [[T.b, "owner"]]],
    ["supA", [[T.a, "supervisor"]]],
    ["genA", [[T.a, "general"]]],
    ["advA", [[T.a, "adviser"]]],
    ["introA", [[T.a, "introducer"]]],
    ["custA", [[T.a, "customer"]]],
    ["custA2", [[T.a, "customer"]]],
    ["custB", [[T.b, "customer"]]],
    ["friendL1", [[T.a, "customer"]]],
    ["friendL2", [[T.a, "customer"]]],
    ["friendL3", [[T.a, "customer"]]],
    ["friendL4", [[T.a, "customer"]]],
    ["friendL5", [[T.a, "customer"]]],
    ["friendLB", [[T.b, "customer"]]],
    ["superOwner", []],
  ];
  for (const [key, ms] of people) {
    await addUser(key);
    for (const [t, r] of ms) await addMember(key, t, r);
  }
  await q(`insert into public.platform_roles (user_id, role) values ($1, 'super_owner')`, [U.superOwner]);
  for (const key of ["raf", "finance_raf", "finance_customer"]) {
    await q(
      `insert into public.admin_permissions (user_id, permission_key, access, tenant_id) values ($1,$2,'amend',$3)`,
      [U.genA, key, T.a],
    );
  }
  await q(`insert into public.advisor_profiles (user_id, code, tenant_id) values ($1,'ADVA',$2)`, [U.advA, T.a]);
  await q(
    `insert into public.introducers (id, user_id, tenant_id, company_code, company_name, slug, active)
     values ($1,$2,$3,'1001','Intro A','intro-a',true)`,
    [randomUUID(), U.introA, T.a],
  );
  await admin.query(b4aSql);
  await admin.query(b4b1Sql);
  const migration = { b4b2: null, f1: null, b4c1: null };
  if (b4b2) {
    migration.b4b2 = await outcome(() => admin.query(b4b2Sql));
    migration.f1 = await outcome(() => admin.query(f1Sql));
  }

  // Legacy RAF rows as they exist before B4c-1 (no guard yet): codes and referrals in every
  // legacy vocabulary value, a tenantless legacy referral attributed through its code, tenant B.
  if (legacy) {
    for (const [id, code, t, ref] of [
      [R.codeA1, CODE.a1, T.a, "custA"],
      [R.codeA2, CODE.a2, T.a, "custA2"],
      [R.codeB1, CODE.b1, T.b, "custB"],
    ]) {
      await q(
        `insert into public.referral_codes (id, code, referrer_user_id, referrer_name, created_by, active, created_at, tenant_id)
         values ($1,$2,$3,$4,$5,true,$6,$7)`,
        [id, code, U[ref], `${ref} Person`, U.ownerA, LEGACY_AT, t],
      );
    }
    for (const [id, codeId, code, ref, friend, status, bonus, t] of [
      [R.legNone, R.codeA1, CODE.a1, "custA", "friendL1", "signed_up", "none", T.a],
      [R.legElig, R.codeA1, CODE.a1, "custA", "friendL2", "qualified", "eligible", T.a],
      [R.legPaid, R.codeA1, CODE.a1, "custA", "friendL3", "rewarded", "paid", T.a],
      [R.legRej, R.codeA2, CODE.a2, "custA2", "friendL4", "qualified", "rejected", T.a],
      [R.legTenantless, R.codeA2, CODE.a2, "custA2", "friendL5", "qualified", "eligible", null],
      [R.legB, R.codeB1, CODE.b1, "custB", "friendLB", "signed_up", "none", T.b],
    ]) {
      await q(
        `insert into public.referrals (id, referral_code_id, code, referrer_user_id, referred_user_id, referred_email, status, bonus_status, notes, created_at, updated_at, tenant_id)
         values ($1,$2,$3,$4,$5,$6,$7,$8,'legacy note',$9,$9,$10)`,
        [id, codeId, code, U[ref], U[friend], `${friend.toLowerCase()}@example.test`, status, bonus, LEGACY_AT, t],
      );
    }
  }
  if (after) await after({ q, admin });
  const legacyBefore = await q(
    `select 'r' k, to_jsonb(t)::text j from public.referrals t union all
     select 'c', to_jsonb(t)::text from public.referral_codes t order by 1, 2`,
  );
  if (b4c1) migration.b4c1 = await outcome(() => admin.query(b4c1Text));

  const ctx = { name, cfg, connect, admin, q, one, migration, legacyBefore, addUser, addMember };
  if (!b4c1 || !migration.b4c1.ok) return ctx;

  await q(
    `insert into public.tenant_features (tenant_id, feature_key, state) values ($1,'refer_a_friend','enabled'), ($2,'refer_a_friend','enabled')`,
    [T.a, T.b],
  );
  await q(
    `insert into public.finance_settings (key, num_value, tenant_id) values ('raf_bonus_pence', 5000, $1), ('raf_bonus_pence', 7550, $2)`,
    [T.a, T.b],
  );

  /** One service-role transaction on its own connection. */
  ctx.svc = async (text, params = []) => {
    const k = await connect();
    try {
      await k.query("begin");
      await k.query("set local role service_role");
      const r = await k.query(text, params);
      await k.query("commit");
      return { ok: true, rows: r.rows };
    } catch (e) {
      await k.query("rollback").catch(() => {});
      return { ok: false, code: e.code, message: e.message };
    } finally {
      await k.end();
    }
  };
  /** One transaction as an API client role (authenticated with a user, or anon). */
  ctx.asClient = async (role, user, text, params = []) => {
    const k = await connect();
    try {
      await k.query("begin");
      if (user) await k.query(`select set_config('request.jwt.claim.sub', $1, true)`, [user]);
      await k.query(`set local role ${role}`);
      const r = await k.query(text, params);
      await k.query("commit");
      return { ok: true, rows: r.rows, rowCount: r.rowCount };
    } catch (e) {
      await k.query("rollback").catch(() => {});
      return { ok: false, code: e.code, message: e.message };
    } finally {
      await k.end();
    }
  };
  ctx.count = async (rel, where, params = []) =>
    Number((await one(`select count(*)::int n from ${rel} where ${where}`, params)).n);
  ctx.ref = (id) => one(`select status, bonus_status, updated_at::text u, tenant_id from public.referrals where id = $1`, [id]);
  ctx.transitions = (id) =>
    q(`select * from public.referral_bonus_transitions where referral_id = $1 order by recorded_at, txid`, [id]);
  ctx.audits = (id) =>
    q(`select * from public.finance_audit_log where audit_type like 'raf_%' and detail->>'referral_id' = $1 order by created_at`, [id]);
  ctx.rafLedger = () => ctx.count("public.finance_ledger", "referral_id is not null or beneficiary_role = 'referrer'");

  let friendN = 0;
  /** A new tenant-A friend with a recorded claim (service role, through the guard). */
  ctx.claim = async (codeKey = "a1", tenant = T.a) => {
    friendN += 1;
    const friend = `${name}F${friendN}`;
    await addUser(friend);
    await addMember(friend, tenant, "customer");
    const code = await one(`select id, code, referrer_user_id from public.referral_codes where code = $1`, [CODE[codeKey] ?? codeKey]);
    const id = randomUUID();
    const r = await ctx.svc(
      `insert into public.referrals (id, referral_code_id, code, referrer_user_id, referred_user_id, referred_email, status, bonus_status, tenant_id)
       values ($1,$2,$3,$4,$5,$6,'signed_up','none',$7)`,
      [id, code.id, code.code, code.referrer_user_id, U[friend], `${friend.toLowerCase()}@example.test`, tenant],
    );
    if (!r.ok) throw new Error(`claim: ${r.message}`);
    return { id, friend, friendId: U[friend] };
  };
  /** A submitted fact-find session of the friend in the tenant. */
  ctx.submittedSession = async (friendId, tenant = T.a, status = "submitted") => {
    const id = randomUUID();
    await q(
      `insert into public.interview_sessions (id, customer_id, tenant_id, case_ref, status, submitted_at) values ($1,$2,$3,$4,$5, now())`,
      [id, friendId, tenant, `MG-B4C1-${id.slice(0, 6)}`, status],
    );
    return id;
  };
  /** A claim provisionally qualified through the real qualification RPC. */
  ctx.provisional = async (codeKey = "a1") => {
    const c = await ctx.claim(codeKey);
    const s = await ctx.submittedSession(c.friendId);
    const r = await ctx.svc(`select public.record_referral_provisional_qualification($1,$2,$3) r`, [T.a, c.friendId, s]);
    if (!r.ok || r.rows[0].r.qualified !== 1) throw new Error(`provisional: ${r.message ?? JSON.stringify(r.rows)}`);
    return { ...c, session: s };
  };
  /** Fixture-only: force a bonus status with triggers disabled (states B4c-1 cannot reach). */
  ctx.force = async (id, bonus, status = null) => {
    const k = await connect();
    try {
      await k.query("begin");
      await k.query("set local session_replication_role = replica");
      await k.query(`update public.referrals set bonus_status = $2, status = coalesce($3, status) where id = $1`, [id, bonus, status]);
      await k.query("commit");
    } finally {
      await k.end();
    }
  };
  ctx.rpc = (tenant, actor, id, expected, to, reason = null, request = randomUUID()) =>
    ctx.svc(`select public.set_referral_bonus_status($1,$2,$3,$4,$5,$6,$7) r`, [tenant, actor, id, expected, to, reason, request]);
  ctx.pool = null;
  return ctx;
}

// --- fake PostgREST over a pool (each request: own connection + transaction) ---------------------
const FAKE_HOST = "g7f4s4c4b4c1cov.invalid";
const PUBLISHABLE = "sb_publishable_g7f4s4c4b4c1_not_a_real_key";
process.env.SUPABASE_URL = `http://${FAKE_HOST}`;
process.env.VITE_SUPABASE_URL = `http://${FAKE_HOST}`;
process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_secret_g7f4s4c4b4c1_not_a_real_key";
process.env.SUPABASE_PUBLISHABLE_KEY = PUBLISHABLE;
process.env.VITE_SUPABASE_PUBLISHABLE_KEY = PUBLISHABLE;
const USER_HEADER = "x-g7f4s4c4b4c1-user";
const IDENT = /^[a-z_][a-z0-9_]*$/;
const qi = (id) => {
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
const reqClient = new AsyncLocalStorage();
const rsql = async (text, args = []) => (await reqClient.getStore().query(text, args)).rows;
function selectList(raw) {
  if (!raw || raw === "*") return "*";
  return raw
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean)
    .map((c) => {
      if (c.includes("(")) throw new Error(`fake postgrest: embedded select unsupported (${c})`);
      return qi(c);
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
  const col = qi(key);
  let clause;
  if (op === "eq") clause = `${col} = $${args.push(v)}`;
  else if (op === "neq") clause = `${col} <> $${args.push(v)}`;
  else if (op === "gt") clause = `${col} > $${args.push(v)}`;
  else if (op === "gte") clause = `${col} >= $${args.push(v)}`;
  else if (op === "lt") clause = `${col} < $${args.push(v)}`;
  else if (op === "lte") clause = `${col} <= $${args.push(v)}`;
  else if (op === "ilike") clause = `${col}::text ilike $${args.push(v.replace(/\*/g, "%"))}`;
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
        return `${qi(col)} ${dir === "desc" ? "desc" : "asc"}${
          nulls === "nullsfirst" ? " nulls first" : nulls === "nullslast" ? " nulls last" : ""
        }`;
      })
      .join(", ")
  );
}
const cellValue = (v) => (v !== null && typeof v === "object" ? JSON.stringify(v) : v);
async function restTable(method, table, url, headers, body) {
  const params = [...url.searchParams.entries()];
  const sp = url.searchParams;
  const args = [];
  const t = `public.${qi(table)}`;
  const accept = headers.get("accept") ?? "";
  const prefer = headers.get("prefer") ?? "";
  const wantObject = accept.startsWith("application/vnd.pgrst.object+json");
  const returning = prefer.includes("return=representation") ? ` returning ${selectList(sp.get("select"))}` : "";
  let rows;
  if (method === "GET" || method === "HEAD") {
    const where = whereClause(params, args);
    const limit = sp.get("limit") ? ` limit ${Number(sp.get("limit"))}` : "";
    const offset = sp.get("offset") ? ` offset ${Number(sp.get("offset"))}` : "";
    rows = await rsql(`select ${selectList(sp.get("select"))} from ${t}${where}${orderClause(sp.get("order"))}${limit}${offset}`, args);
  } else if (method === "PATCH") {
    const sets = Object.entries(body)
      .map(([c, v]) => `${qi(c)} = $${args.push(cellValue(v))}`)
      .join(", ");
    rows = await rsql(`update ${t} set ${sets}${whereClause(params, args)}${returning}`, args);
  } else if (method === "POST") {
    const list = Array.isArray(body) ? body : [body];
    const cols = [...new Set(list.flatMap((o) => Object.keys(o)))];
    const values = list
      .map((o) => `(${cols.map((c) => (c in o ? `$${args.push(cellValue(o[c]))}` : "default")).join(", ")})`)
      .join(", ");
    rows = await rsql(`insert into ${t} (${cols.map(qi).join(", ")}) values ${values}${returning}`, args);
  } else if (method === "DELETE") {
    rows = await rsql(`delete from ${t}${whereClause(params, args)}${returning}`, args);
  } else {
    throw new Error(`fake postgrest: method ${method} not served`);
  }
  if (wantObject) {
    if (rows.length !== 1) {
      return json(
        { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned", details: `${rows.length} rows`, hint: null },
        406,
      );
    }
    return json(rows[0]);
  }
  if (!returning && method !== "GET" && method !== "HEAD") return new Response(null, { status: 201 });
  return json(rows, 200, { "content-range": `0-${Math.max(rows.length - 1, 0)}/*` });
}
async function restRpc(fn, body) {
  const keys = Object.keys(body ?? {});
  const args = keys.map((k) => cellValue(body[k]));
  const call = `public.${qi(fn)}(${keys.map((k, i) => `${qi(k)} => $${i + 1}`).join(", ")})`;
  const rows = await rsql(`select ${call} as r`, args);
  return json(rows[0]?.r ?? null);
}
let served = null;
const rest = { rpcHoldMs: 0, barrier: null, rpcPids: new Set(), rpcCalls: [] };
/** Release RPC requests together once `n` have arrived. */
function armRpcBarrier(n) {
  let release;
  const gate = new Promise((r) => (release = r));
  let arrived = 0;
  const timer = setTimeout(() => release(), 8000);
  rest.barrier = {
    async arrive() {
      arrived += 1;
      if (arrived === n) {
        clearTimeout(timer);
        rest.barrier = null;
        release();
      }
      await gate;
    },
  };
}
async function handle(input, init) {
  const url = new URL(typeof input === "string" ? input : (input.url ?? String(input)));
  if (url.hostname !== FAKE_HOST) {
    unknownCalls.push(`refused host ${url.hostname}`);
    throw new Error(`coverage fetch stub refused host ${url.hostname}`);
  }
  const method = String(init.method || (typeof input === "object" && input.method) || "GET").toUpperCase();
  const headers = new Headers(init.headers || (typeof input === "object" ? input.headers : undefined));
  const rawBody = init.body ?? null;
  const body = rawBody ? JSON.parse(typeof rawBody === "string" ? rawBody : String(rawBody)) : null;
  const userId = headers.get(USER_HEADER);
  if (!url.pathname.startsWith("/rest/v1/")) {
    unknownCalls.push(`${method} ${url.pathname}`);
    return json({ message: "unexpected" }, 500);
  }
  const isRpc = url.pathname.startsWith("/rest/v1/rpc/");
  const name = isRpc ? url.pathname.slice("/rest/v1/rpc/".length) : url.pathname.slice("/rest/v1/".length);
  const isDecision = isRpc && name === "set_referral_bonus_status";
  if (isRpc) rest.rpcCalls.push({ name, body, userId });
  if (isDecision && rest.barrier) await rest.barrier.arrive();
  const c = await served.connect();
  try {
    await c.query("begin");
    if (userId) await c.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId]);
    await c.query(`set local role ${userId ? "authenticated" : "service_role"}`);
    if (isDecision) rest.rpcPids.add(c.processID);
    const res = await reqClient.run(c, () => (isRpc ? restRpc(name, body) : restTable(method, name, url, headers, body)));
    if (isDecision && rest.rpcHoldMs) await c.query(`select pg_sleep($1)`, [rest.rpcHoldMs / 1000]);
    await c.query("commit");
    return res;
  } catch (e) {
    await c.query("rollback").catch(() => {});
    if (e?.code) return pgError(e);
    unknownCalls.push(String(e?.message ?? e));
    return json({ code: "XX000", message: String(e?.message ?? e) }, 500);
  } finally {
    c.release();
  }
}
globalThis.fetch = (input, init = {}) => handle(input, init);
function useDb(ctx) {
  ctx.pool ??= new pg.Pool({ ...ctx.cfg, max: 12 });
  ctx.pool.on("error", () => {});
  served = ctx.pool;
}

// --- modules under test -------------------------------------------------------------------------
const { createClient } = await import("@supabase/supabase-js");
const rf = await import("../src/lib/referrals.functions.ts");
const sf = await import("../src/lib/sessions.functions.ts");
const referralsSrc = read(REFERRALS_REL);
function mutate(src, pairs) {
  let out = src;
  for (const [from, to] of pairs) {
    if (!out.includes(from)) return null;
    out = out.split(from).join(to);
  }
  return out;
}
async function referralsMutant(pairs) {
  const src = mutate(referralsSrc, pairs);
  if (!src) return null;
  const js = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return import(dataUrl(`${mutantMark}\n${js}\n// ${randomUUID()}`));
}
async function invoke(fn, data, actor, slug) {
  const d = fn.__def;
  const parsed = d.validator ? await d.validator(data) : data;
  globalThis.__B4C1_REQUEST = new Request("http://app.invalid/_serverFn/x", {
    headers: { referer: `http://app.invalid/${slug}/admin` },
  });
  const supabase = createClient(`http://${FAKE_HOST}`, PUBLISHABLE, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { [USER_HEADER]: actor } },
  });
  return d.handler({ data: parsed, context: { userId: actor, claims: { sub: actor, email: null }, supabase } });
}
const call = (fn, data, actor, slug = SLUG.a) => outcome(() => invoke(fn, data, actor, slug));
const CONFLICT = "This referral bonus was changed by someone else. Refresh and try again.";
const FORBIDDEN = "Only an Owner or Supervisor of this company can make Refer a Friend bonus decisions.";
const PLATFORM = "Refer a Friend bonus decisions are made by the company's own Owner or Supervisor. Platform access cannot make them.";
const decide = (mod, id, to, expected, actor, { reason, requestId = randomUUID(), slug = SLUG.a } = {}) =>
  call(mod.updateReferralBonusStatus, { id, bonusStatus: to, expectedStatus: expected, reason, requestId }, actor, slug);
const outcomeOf = (r) =>
  r.ok ? (r.value?.outcome ?? "ok-without-outcome") : r.message === CONFLICT ? "conflict" : `refused:${r.message.slice(0, 70)}`;

/** Two decision requests that reach the database together on separate connections. */
async function decisionRace(ctx, mod, reqs, { hold = 300 } = {}) {
  rest.rpcPids = new Set();
  rest.rpcHoldMs = hold;
  const mon = await ctx.connect();
  let waits = 0;
  let monitoring = true;
  const watch = (async () => {
    while (monitoring) {
      const r = await mon.query(
        `select count(*)::int n from pg_stat_activity where datname = current_database()
           and wait_event_type = 'Lock' and query ilike '%set_referral_bonus_status%'`,
      );
      waits = Math.max(waits, r.rows[0].n);
      await sleep(5);
    }
  })();
  armRpcBarrier(reqs.length);
  const res = await Promise.all(reqs.map((args) => decide(mod, ...args)));
  monitoring = false;
  await watch;
  await mon.end();
  rest.rpcHoldMs = 0;
  return { res, pids: rest.rpcPids.size, lockWaits: waits };
}

// --- coverage helpers ---------------------------------------------------------------------------
const NOT_FOUND = "Not found.";
const TENANT_FORBIDDEN = "Forbidden";
const SMS = (globalThis.__COV_SMS = []);
const PHONE = (code) => `SYNTH-PHONE-${code}`;
const FRIEND_PHONE = "SYNTH-FRIEND-PHONE";
/** Pre-migration legacy extras: referrer phones and a tenantless referral attributed to tenant B. */
async function legacyExtras({ q }) {
  await q(`update public.referral_codes set referrer_phone = 'SYNTH-PHONE-' || code`);
  await q(`insert into auth.users (id, email, email_confirmed_at) values ($1, 'friendltb@example.test', now())`, [U.friendLTB]);
  await q(
    `insert into public.referrals (id, referral_code_id, code, referrer_user_id, referred_user_id, referred_email, status, bonus_status, notes, created_at, updated_at, tenant_id)
     values ($1,$2,$3,$4,$5,'friendltb@example.test','qualified','eligible','legacy note',$6,$6,null)`,
    [R.legTenantlessB, R.codeB1, CODE.b1, U.custB, U.friendLTB, LEGACY_AT],
  );
}
/** Every RAF and money row, byte for byte. */
const rafState = async (ctx) =>
  JSON.stringify(
    await ctx.q(
      `select 'r' k, to_jsonb(t)::text j from public.referrals t union all
       select 'c', to_jsonb(t)::text from public.referral_codes t union all
       select 't', to_jsonb(t)::text from public.referral_bonus_transitions t union all
       select 'a', to_jsonb(t)::text from public.finance_audit_log t union all
       select 'l', to_jsonb(t)::text from public.finance_ledger t order by 1, 2`,
    ),
  );
const MONEY_TABLES = [
  "finance_ledger",
  "finance_fee_lines",
  "customer_introducer_links",
  "network_commission_lines",
  "network_commission_statements",
  "commission_rates",
  "commission_rate_versions",
];
async function moneyState(ctx) {
  const out = {};
  for (const t of MONEY_TABLES) {
    if ((await ctx.one(`select to_regclass($1) is not null as e`, [`public.${t}`])).e) {
      out[t] = await ctx.count(`public.${t}`, "true");
    }
  }
  return JSON.stringify(out);
}
/** Runs a call and reports whether it left every RAF/money row and the SMS outbox untouched. */
async function quiet(ctx, fn) {
  const before = await rafState(ctx);
  const sms0 = SMS.length;
  const r = await fn();
  return { r, clean: (await rafState(ctx)) === before && SMS.length === sms0 };
}
const notFoundClean = (x) => !x.r.ok && x.r.message === NOT_FOUND && x.clean;
/** A customer referral inserted through the guard as the claim path does. */
async function referralFor(ctx, friendKey, codeKey, tenant, status = "signed_up") {
  const code = await ctx.one(`select id, code, referrer_user_id from public.referral_codes where code = $1`, [CODE[codeKey]]);
  const id = randomUUID();
  const r = await ctx.svc(
    `insert into public.referrals (id, referral_code_id, code, referrer_user_id, referred_user_id, referred_email, status, bonus_status, tenant_id)
     values ($1,$2,$3,$4,$5,$6,$7,'none',$8)`,
    [id, code.id, code.code, code.referrer_user_id, U[friendKey], `${friendKey.toLowerCase()}@example.test`, status, tenant],
  );
  if (!r.ok) throw new Error(`referral: ${r.message}`);
  return id;
}
/** A customer of both tenants holding one tenant-A and one tenant-B referral. */
async function dualCustomer(ctx, key) {
  await ctx.addUser(key);
  await ctx.addMember(key, T.a, "customer");
  await ctx.addMember(key, T.b, "customer");
  return { id: U[key], refA: await referralFor(ctx, key, "a1", T.a), refB: await referralFor(ctx, key, "b1", T.b) };
}
/** The dual-tenant customer submits a tenant-B fact-find; only the tenant-B referral may move. */
async function dualTenantSubmit(ctx, mod, key) {
  const d = await dualCustomer(ctx, key);
  const s = await ctx.submittedSession(d.id, T.b, "in_progress");
  const r = await call(mod.submitSession, { sessionId: s }, d.id, SLUG.b);
  const a = await ctx.ref(d.refA);
  const b = await ctx.ref(d.refB);
  const ta = await ctx.transitions(d.refA);
  const tb = await ctx.transitions(d.refB);
  return {
    d,
    r,
    pass:
      r.ok &&
      b.bonus_status === "provisional" && b.status === "qualified" &&
      tb.length === 1 && String(tb[0].tenant_id) === T.b && tb[0].evidence_ref.session_id === s &&
      a.bonus_status === "none" && a.status === "signed_up" && ta.length === 0 &&
      (await ctx.audits(d.refA)).length === 0,
    note: `${r.ok ? "ok" : r.message} A=${a.status}/${a.bonus_status} (${ta.length} transitions) B=${b.status}/${b.bonus_status} (${tb.length})`,
  };
}
/** Tenant-A Owner and Supervisor decisions on a foreign tenantless legacy referral, a tenant-B
 * referral and an unknown id: all must be the same "Not found." with nothing written. */
async function foreignDecisions(ctx, mod) {
  const tries = [];
  for (const [id, expected] of [
    [R.legTenantlessB, "eligible"],
    [R.legB, "none"],
    [randomUUID(), "none"],
  ]) {
    for (const actor of [U.ownerA, U.supA]) {
      tries.push(await quiet(ctx, () => decide(mod, id, "rejected", expected, actor, { reason: "Cross-tenant attempt" })));
    }
  }
  return { tries, pass: tries.every(notFoundClean) };
}
/** Tenant-A Owner texting tenant B's code or an unknown code: "Not found.", no SMS, no row. */
async function foreignTexts(ctx, mod) {
  const tries = [];
  for (const id of [R.codeB1, randomUUID()]) {
    tries.push(await quiet(ctx, () => call(mod.textReferralLink, { id }, U.ownerA)));
    tries.push(await quiet(ctx, () => call(mod.textRafInviteToFriend, { id, friendPhone: FRIEND_PHONE }, U.ownerA)));
  }
  return { tries, pass: tries.every(notFoundClean) };
}
const smsTo = (to) => SMS.filter((m) => m.to === to).length;

// =============================================================================================
// RUN
// =============================================================================================
let exitCode = 1;
try {
  await server.initialise();
  await server.start();
  serverStarted = true;
  const ver = await (async () => {
    const c = new pg.Client({ ...baseCfg, database: "postgres" });
    await c.connect();
    await c.query(ROLES_SQL);
    const r = (await c.query(`select current_setting('server_version') v`)).rows[0].v;
    await c.end();
    return r;
  })();

  const db = await buildDb("cov_main", { after: legacyExtras });
  ok(
    "COV-00 fixture: the B4c-1 migration (unchanged) applies after B4b2 and F1 over legacy rows that include a tenantless legacy referral attributed to tenant B through its code",
    db.migration.b4b2.ok && db.migration.f1.ok && db.migration.b4c1.ok,
    `PostgreSQL ${ver}; b4c1=${sha256(b4c1Sql)} ${db.migration.b4c1.message ?? ""}`,
  );
  if (!db.migration.b4c1.ok) throw new Error("fixture database did not build");
  useDb(db);
  await db.addUser("genN");
  await db.addMember("genN", T.a, "general");
  await db.addUser("outsider");
  const money0 = await moneyState(db);

  // ---------------------------------------------------------------------------------------------
  // B1C gaps: tenant isolation and authority of the RAF writers
  // ---------------------------------------------------------------------------------------------
  {
    const fd = await foreignDecisions(db, rf);
    const rpcForeign = await db.rpc(T.a, U.ownerA, R.legTenantlessB, "eligible", "rejected", "direct");
    const rpcUnknown = await db.rpc(T.a, U.ownerA, randomUUID(), "none", "rejected", "direct");
    const own = await decide(rf, R.legTenantlessB, "rejected", "eligible", U.ownerB, { reason: "Tenant B decision", slug: SLUG.b });
    const after = await db.ref(R.legTenantlessB);
    ok(
      "COV-01 [B1C-13/15/16/18] a tenantless legacy referral attributed to tenant B through its code is invisible to tenant A: A's Owner and Supervisor get the same \"Not found.\" as for a tenant-B referral and an unknown id with nothing written; the RPC answers raf_resource_not_found for both; tenant B's Owner can decide it (positive control)",
      fd.pass &&
        !rpcForeign.ok && /raf_resource_not_found/.test(rpcForeign.message) &&
        !rpcUnknown.ok && /raf_resource_not_found/.test(rpcUnknown.message) &&
        own.ok && own.value.outcome === "applied" && after.bonus_status === "rejected" && after.tenant_id === null,
      `${fd.tries.map((t) => (t.r.ok ? "applied" : t.r.message) + (t.clean ? "" : "+effect")).join(",")} own=${outcomeOf(own)}`,
    );
  }
  {
    const ft = await foreignTexts(db, rf);
    const sms0 = SMS.length;
    const link = await call(rf.textReferralLink, { id: R.codeA1 }, U.ownerA);
    const invite = await call(rf.textRafInviteToFriend, { id: R.codeA1, friendPhone: FRIEND_PHONE }, U.supA);
    const sent = SMS.slice(sms0);
    ok(
      "COV-02 [B1C-13/15] textReferralLink and textRafInviteToFriend on tenant B's code and on an unknown id answer the same \"Not found.\" with no SMS and no row written; on the caller's own code they text the own referrer / the friend with the own tenant's link",
      ft.pass && link.ok && invite.ok && sent.length === 2 &&
        sent[0].to === PHONE(CODE.a1) && sent[0].body.includes("/tenant-a/") && sent[0].body.includes(CODE.a1) &&
        sent[1].to === FRIEND_PHONE && sent[1].body.includes("/tenant-a/") && sent[1].body.includes(CODE.a1) &&
        smsTo(PHONE(CODE.b1)) === 0,
      `${ft.tries.map((t) => (t.r.ok ? "sent" : t.r.message) + (t.clean ? "" : "+effect")).join(",")} own=${[link, invite].map((x) => (x.ok ? "sent" : x.message)).join(",")}`,
    );
  }
  {
    const p = await db.provisional();
    globalThis.__B4C1_PLATFORM = { [U.superOwner]: { tenantId: T.a, level: "read_only" } };
    const tries = [
      await quiet(db, () => call(rf.createReferralLink, { referrerName: "Read Only" }, U.superOwner)),
      await quiet(db, () => call(rf.textReferralLink, { id: R.codeA1 }, U.superOwner)),
      await quiet(db, () => call(rf.textRafInviteToFriend, { id: R.codeA1, friendPhone: FRIEND_PHONE }, U.superOwner)),
      await quiet(db, () => decide(rf, p.id, "rejected", "provisional", U.superOwner, { reason: "read only" })),
    ];
    globalThis.__B4C1_PLATFORM = {};
    ok(
      "COV-03 [B1C-19] a platform read-only entry into tenant A cannot create a code, text a referrer or a friend, or decide a bonus: each refused before any effect",
      tries.every((t) => !t.r.ok && t.r.message === TENANT_FORBIDDEN && t.clean),
      tries.map((t) => (t.r.ok ? "ok" : t.r.message.slice(0, 40)) + (t.clean ? "" : "+effect")).join(" | "),
    );
  }
  {
    globalThis.__B4C1_PLATFORM = { [U.superOwner]: { tenantId: T.a, level: "operational_admin" } };
    const sms0 = SMS.length;
    const own = await call(rf.textReferralLink, { id: R.codeA1 }, U.superOwner);
    const sent = SMS.slice(sms0);
    const foreign = [
      await quiet(db, () => call(rf.textReferralLink, { id: R.codeB1 }, U.superOwner)),
      await quiet(db, () => call(rf.textRafInviteToFriend, { id: R.codeB1, friendPhone: FRIEND_PHONE }, U.superOwner)),
      await quiet(db, () => call(rf.textReferralLink, { id: R.codeA1 }, U.superOwner, SLUG.b)),
    ];
    globalThis.__B4C1_PLATFORM = {};
    ok(
      "COV-04 [B1C-21] a platform operational entry into tenant A acts only on tenant A: it may text A's referrer (existing operational authority, unchanged); B's code is \"Not found.\" with no SMS, and pointing the request at tenant B (no entry there) is refused with no SMS",
      own.ok && sent.length === 1 && sent[0].to === PHONE(CODE.a1) &&
        notFoundClean(foreign[0]) && notFoundClean(foreign[1]) && !foreign[2].r.ok && foreign[2].clean,
      `own=${own.ok ? "sent" : own.message} foreign=${foreign.map((t) => (t.r.ok ? "sent" : t.r.message.slice(0, 30)) + (t.clean ? "" : "+effect")).join(",")}`,
    );
  }
  {
    const p = await db.provisional();
    const tries = [];
    for (const actor of [U.advA, U.introA, U.custA, U.outsider]) {
      tries.push(await quiet(db, () => call(rf.createReferralLink, { referrerName: "Denied Role" }, actor)));
      tries.push(await quiet(db, () => call(rf.textReferralLink, { id: R.codeA1 }, actor)));
      tries.push(await quiet(db, () => call(rf.textRafInviteToFriend, { id: R.codeA1, friendPhone: FRIEND_PHONE }, actor)));
      tries.push(await quiet(db, () => decide(rf, p.id, "rejected", "provisional", actor, { reason: "Denied role" })));
    }
    ok(
      "COV-05 [B1C-22] Adviser, Introducer, Customer and a caller with no membership are refused on all four RAF writers with no SMS and no row written",
      tries.every((t) => !t.r.ok && t.clean),
      tries.map((t) => (t.r.ok ? "ok" : t.r.message.slice(0, 24)) + (t.clean ? "" : "+effect")).join(" | "),
    );
  }
  {
    const p = await db.provisional();
    const sms0 = SMS.length;
    const text = await call(rf.textReferralLink, { id: R.codeA1 }, U.genN);
    const create = await call(rf.createReferralLink, { referrerName: "General Admin Link" }, U.genN);
    const sent = SMS.slice(sms0);
    const foreign = await quiet(db, () => call(rf.textReferralLink, { id: R.codeB1 }, U.genN));
    const decisions = [
      await quiet(db, () => decide(rf, p.id, "rejected", "provisional", U.genN, { reason: "General" })),
      await quiet(db, () => decide(rf, p.id, "rejected", "provisional", U.genA, { reason: "General with amend" })),
    ];
    ok(
      "COV-06 [B1C-23/24] General Admin keeps its main-admin fallback for the link writers inside its own tenant (texts A's referrer, creates an A code; B's code \"Not found.\" with no SMS); bonus decisions are Owner/Supervisor only (B4c-1 business rule) so General Admin, with or without RAF amend, is refused with no effect",
      text.ok && sent.length === 1 && sent[0].to === PHONE(CODE.a1) &&
        create.ok && create.value.tenant_id === T.a &&
        notFoundClean(foreign) &&
        decisions.every((d) => !d.r.ok && d.r.message === FORBIDDEN && d.clean),
      `text=${text.ok ? "sent" : text.message} create=${create.ok ? "ok" : create.message} decisions=${decisions.map((d) => (d.r.ok ? "ok" : d.r.message.slice(0, 30))).join(",")}`,
    );
  }

  // ---------------------------------------------------------------------------------------------
  // B2b gaps: qualification is the submitted session's own tenant only
  // ---------------------------------------------------------------------------------------------
  {
    const one = await dualTenantSubmit(db, sf, "dualF1");
    const sA = await db.submittedSession(one.d.id, T.a, "in_progress");
    const second = await call(sf.submitSession, { sessionId: sA }, one.d.id, SLUG.a);
    const a = await db.ref(one.d.refA);
    const tb = await db.transitions(one.d.refB);
    const ta = await db.transitions(one.d.refA);
    ok(
      "COV-07 [B2B-04/31] a customer of both tenants submitting a tenant-B fact-find qualifies only the tenant-B referral (transition and audit in B); the tenant-A referral moves only when a tenant-A fact-find is submitted, and the B referral is not touched again",
      one.pass && second.ok && a.bonus_status === "provisional" && ta.length === 1 && String(ta[0].tenant_id) === T.a &&
        ta[0].evidence_ref.session_id === sA && tb.length === 1,
      `${one.note}; then A=${a.bonus_status} (${ta.length}) B transitions=${tb.length}`,
    );
  }
  {
    await db.addUser("tlF");
    await db.addMember("tlF", T.a, "customer");
    const ref = await referralFor(db, "tlF", "a1", T.a);
    const s = await db.submittedSession(U.tlF, null, "in_progress");
    const before = await rafState(db);
    const r = await call(sf.submitSession, { sessionId: s }, U.tlF);
    const afterSubmit = await rafState(db);
    const submitted = await db.submittedSession(U.tlF, null, "submitted");
    const direct = await db.svc(`select public.record_referral_provisional_qualification($1,$2,$3) r`, [T.a, U.tlF, submitted]);
    const fin = await db.ref(ref);
    ok(
      "COV-08 [B2B-NC11] a tenantless fact-find session qualifies nothing: submitting it leaves every RAF row unchanged, and the qualification RPC asked with tenant A answers session_not_submitted",
      afterSubmit === before && fin.bonus_status === "none" && fin.status === "signed_up" &&
        direct.ok && direct.rows[0].r.outcome === "session_not_submitted" && direct.rows[0].r.qualified === 0 &&
        (await db.transitions(ref)).length === 0,
      `submit=${r.ok ? "ok" : r.message} rpc=${direct.ok ? direct.rows[0].r.outcome : direct.message}`,
    );
  }
  {
    await db.addUser("pendF");
    await db.addMember("pendF", T.a, "customer");
    const ref = await referralFor(db, "pendF", "a1", T.a, "pending");
    const s = await db.submittedSession(U.pendF, T.a, "in_progress");
    const r = await call(sf.submitSession, { sessionId: s }, U.pendF);
    const fin = await db.ref(ref);
    const trans = await db.transitions(ref);
    ok(
      "COV-09 [B2B-05] a pending referral is provisionally qualified by the customer's fact-find exactly like a signed-up one (status qualified, bonus provisional, one transition)",
      r.ok && fin.status === "qualified" && fin.bonus_status === "provisional" && trans.length === 1 && trans[0].from_status === "none",
      `${r.ok ? "ok" : r.message} ${fin.status}/${fin.bonus_status} transitions=${trans.length}`,
    );
  }

  // ---------------------------------------------------------------------------------------------
  // F1 / B4b2 gaps: decision concurrency, replay, reopen and payment authority
  // ---------------------------------------------------------------------------------------------
  {
    const p = await db.provisional();
    const rej = await decide(rf, p.id, "rejected", "provisional", U.ownerA, { reason: "Initial rejection" });
    const reasons = ["Owner: appeal upheld", "Supervisor: new evidence received"];
    const race = await decisionRace(db, rf, [
      [p.id, "provisional", "rejected", U.ownerA, { reason: reasons[0] }],
      [p.id, "provisional", "rejected", U.supA, { reason: reasons[1] }],
    ]);
    const outs = race.res.map(outcomeOf);
    const reopen = (await db.transitions(p.id)).filter((t) => t.from_status === "rejected");
    const audits = (await db.audits(p.id)).filter((a) => a.audit_type === "raf_bonus_status_changed");
    const winner = outs[0] === "applied" ? 0 : outs[1] === "applied" ? 1 : -1;
    ok(
      "COV-10 [F1-19] two concurrent reopens of a rejected bonus with different reasons (Owner and Supervisor, separate connections): exactly one applies and its reason is the one recorded; the other is a conflict; one reopen transition and one decision audit row beside the rejection's",
      rej.ok && outs.filter((o) => o === "applied").length === 1 && outs.filter((o) => o === "conflict").length === 1 &&
        reopen.length === 1 && winner >= 0 && reopen[0].reason === reasons[winner] &&
        audits.length === 2 && (await db.ref(p.id)).bonus_status === "provisional" && race.pids === 2,
      `${outs.join(",")} reopen=${reopen.length} audits=${audits.length} pids=${race.pids} lockWaits=${race.lockWaits}`,
    );
  }
  {
    const p = await db.provisional();
    const requestId = randomUUID();
    const first = await decide(rf, p.id, "rejected", "provisional", U.ownerA, { reason: "Duplicate application", requestId });
    const snap = await rafState(db);
    await sleep(25);
    const replay = await decide(rf, p.id, "rejected", "provisional", U.ownerA, { reason: "Duplicate application", requestId });
    const same = await decide(rf, p.id, "rejected", "provisional", U.supA, { reason: "Duplicate application" });
    const altered = await decide(rf, p.id, "rejected", "provisional", U.ownerA, { reason: "A different reason", requestId });
    const after = await rafState(db);
    ok(
      "COV-11 [F1-20] a replayed decision and an identical decision by another approver report already_applied and write nothing (the referral row including updated_at, transitions and audit rows are byte-identical); the same request with a different reason is refused and writes nothing",
      first.ok && first.value.outcome === "applied" &&
        replay.ok && replay.value.outcome === "already_applied" &&
        same.ok && same.value.outcome === "already_applied" &&
        !altered.ok && after === snap,
      `${[first, replay, same, altered].map(outcomeOf).join(",")}`,
    );
  }
  {
    const c = await db.claim();
    const rej = await decide(rf, c.id, "rejected", "none", U.ownerA, { reason: "Not a genuine referral" });
    const noReason = await quiet(db, () => decide(rf, c.id, "none", "rejected", U.supA, {}));
    const back = await decide(rf, c.id, "none", "rejected", U.supA, { reason: "Referral confirmed genuine" });
    const fin = await db.ref(c.id);
    const trans = await db.transitions(c.id);
    ok(
      "COV-12 [B4B2-58/60] an unpaid rejected bonus returns to none only with a reason (Supervisor): no-reason attempt refused with no effect; the reopen applies with one transition and one audit row each",
      rej.ok && !noReason.r.ok && noReason.clean && back.ok && back.value.outcome === "applied" &&
        fin.bonus_status === "none" && trans.length === 2 && trans[1].reason === "Referral confirmed genuine" &&
        (await db.audits(c.id)).length === 2,
      `${outcomeOf(rej)},${noReason.r.ok ? "ok" : noReason.r.message},${outcomeOf(back)} final=${fin.bonus_status}`,
    );
  }
  {
    const p = await db.provisional();
    await db.force(p.id, "payment_approved");
    const general = [
      await quiet(db, () => decide(rf, p.id, "paid", "payment_approved", U.genA, {})),
      await quiet(db, () => decide(rf, p.id, "earned", "payment_approved", U.genA, { reason: "General withdraws approval" })),
    ];
    const generalRpc = await db.rpc(T.a, U.genA, p.id, "payment_approved", "paid");
    const paid = await decide(rf, p.id, "paid", "payment_approved", U.supA, {});
    const final = await quiet(db, () => decide(rf, p.id, "rejected", "paid", U.ownerA, { reason: "Undo payment" }));
    const trans = (await db.transitions(p.id)).filter((t) => t.to_status === "paid");
    ok(
      "COV-13 [B4B2-59 / NC33] General Admin (with RAF and finance amend) cannot mark a bonus paid or withdraw an approval, in the app and at the RPC; the Supervisor can mark it paid (one transition); paid is final for the Owner",
      general.every((g) => !g.r.ok && g.r.message === FORBIDDEN && g.clean) &&
        !generalRpc.ok && /finance_forbidden/.test(generalRpc.message) &&
        paid.ok && paid.value.outcome === "applied" && (await db.ref(p.id)).bonus_status === "paid" && trans.length === 1 &&
        !final.r.ok && final.clean,
      `general=${general.map((g) => (g.r.ok ? "ok" : g.r.message.slice(0, 30))).join(",")} rpc=${generalRpc.ok ? "ok" : generalRpc.message} paid=${outcomeOf(paid)} final=${final.r.ok ? "ok" : final.r.message.slice(0, 40)}`,
    );
  }
  {
    const money1 = await moneyState(db);
    ok(
      "COV-14 [B1C-14/18, B2B-08/09/10/34, B4B2-59] after every qualification, decision and payment above, no ledger, fee line, introducer link, network commission line or commission rate row was written",
      money1 === money0 && (await db.rafLedger()) === 0,
      money1,
    );
  }
  ok(
    "COV-15 every request stayed on the fake PostgREST host; no SMS reached tenant B's referrer",
    unknownCalls.length === 0 && smsTo(PHONE(CODE.b1)) === 0,
    unknownCalls.slice(0, 3).join(" | "),
  );

  // ---------------------------------------------------------------------------------------------
  // Negative controls
  // ---------------------------------------------------------------------------------------------
  {
    const mod = await referralsMutant([
      [
        `.select("id, code, referrer_name, referrer_phone, tenant_id")\n      .eq("id", data.id)\n      .eq("tenant_id", tenantId)`,
        `.select("id, code, referrer_name, referrer_phone, tenant_id")\n      .eq("id", data.id)`,
      ],
    ]);
    let effect = false;
    let caught = false;
    if (mod) {
      const before = smsTo(PHONE(CODE.b1));
      const ft = await foreignTexts(db, mod);
      effect = smsTo(PHONE(CODE.b1)) > before;
      caught = !ft.pass;
    }
    nc("NC01 textReferralLink without its tenant filter → tenant A's Owner texts tenant B's referrer; COV-02 rejects", { effect, caught });
  }
  {
    const mod = await referralsMutant([
      [
        `.select("id, code, referrer_name, tenant_id")\n      .eq("id", data.id)\n      .eq("tenant_id", tenantId)`,
        `.select("id, code, referrer_name, tenant_id")\n      .eq("id", data.id)`,
      ],
    ]);
    let effect = false;
    let caught = false;
    if (mod) {
      const sms0 = SMS.length;
      const ft = await foreignTexts(db, mod);
      effect = SMS.slice(sms0).some((m) => m.to === FRIEND_PHONE && m.body.includes(CODE.b1));
      caught = !ft.pass;
    }
    nc("NC02 textRafInviteToFriend without its tenant filter → tenant B's link is texted to a friend on tenant A's request; COV-02 rejects", { effect, caught });
  }

  const rpcNoTenant = mutate(b4c1Sql, [
    [
      "IF NOT FOUND OR public.referral_effective_tenant(p_referral_id) IS DISTINCT FROM p_tenant_id THEN",
      "IF NOT FOUND THEN",
    ],
    ["OR public.referral_effective_tenant(v_ref.id) IS DISTINCT FROM NEW.tenant_id", "OR false"],
  ]);
  {
    let effect = false;
    let caught = false;
    if (rpcNoTenant) {
      const m = await buildDb("cov_nc_rpc_tenant", { b4c1Text: rpcNoTenant, after: legacyExtras });
      if (m.migration.b4c1.ok) {
        useDb(m);
        const fd = await foreignDecisions(m, rf);
        effect = (await m.ref(R.legTenantlessB)).bonus_status === "rejected";
        caught = !fd.pass;
        await m.pool.end();
      }
      await m.admin.end();
      useDb(db);
    }
    nc("NC03 decision RPC and transition guard without the effective-tenant check → tenant A's Owner rejects tenant B's tenantless legacy referral; COV-01 rejects", { effect, caught });
  }
  const qualifyNoTenant = mutate(b4c1Sql, [
    ["WHERE r.tenant_id = p_tenant_id AND r.referred_user_id = p_customer_user_id", "WHERE r.referred_user_id = p_customer_user_id"],
    ["OR public.referral_effective_tenant(v_ref.id) IS DISTINCT FROM NEW.tenant_id", "OR false"],
  ]);
  {
    let effect = false;
    let caught = false;
    if (qualifyNoTenant) {
      const m = await buildDb("cov_nc_qualify_tenant", { b4c1Text: qualifyNoTenant, after: legacyExtras });
      if (m.migration.b4c1.ok) {
        useDb(m);
        const r = await dualTenantSubmit(m, sf, "ncDual");
        effect = (await m.ref(r.d.refA)).bonus_status === "provisional";
        caught = !r.pass;
        await m.pool.end();
      }
      await m.admin.end();
      useDb(db);
    }
    nc("NC04 qualification RPC and transition guard without the tenant predicate → a tenant-B fact-find qualifies the customer's tenant-A referral; COV-07 rejects", { effect, caught });
  }

  await db.pool?.end();
  await db.admin.end();

  const ncPass = ncResults.filter((r) => r.pass).length;
  console.log(`TEST_CASES=${total}`);
  console.log(`TESTS_PASS=${total - failures.length}`);
  console.log(`NEGATIVE_CONTROL_COUNT=${ncResults.length}`);
  console.log(`NEGATIVE_CONTROLS_PASS=${ncPass}`);
  console.log(`SMS_RECORDED=${SMS.length}`);
  const pass = failures.length === 0 && ncPass === ncResults.length;
  console.log(`RESULT=${pass ? "PASS" : "FAIL"}`);
  exitCode = pass ? 0 : 1;
} catch (e) {
  console.error(`FAIL  verifier aborted: ${e?.stack ?? e}`);
  exitCode = 1;
} finally {
  await shutdown();
}
process.exit(exitCode);
