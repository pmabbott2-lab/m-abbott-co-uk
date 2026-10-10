/**
 * G7F-4S4C4-B4c-1 — Refer a Friend security, authority and audit foundations: verification on a
 * real PostgreSQL server.
 *
 * A disposable local PostgreSQL 17 server (embedded-postgres) hosts databases built from the B4b2
 * verifier's staging-shaped base schema, the staging shapes of referrals, referral_codes,
 * tenant_features and feature_catalogue (constraints, RLS policies, client grants and the real
 * is_tenant_feature_enabled), the real G6B link policy and the B3, B4a, B4b1, B4b2 and F1
 * migrations, legacy referral rows, and then the B4c-1 migration. The real referral and session
 * server functions run unmodified through a fake PostgREST layer on a non-routable host that serves
 * every request (table, insert, delete and RPC) on its own pooled connection and transaction, as
 * service_role or as the authenticated user.
 *
 * Negative controls remove one protection each (a migration mutant, a dropped guard or a mutant of
 * the real referral source) and show the unsafe effect happening and the matching test predicate
 * rejecting it.
 *
 * Synthetic fixtures only: no network, no staging, no production, no real user, no real token.
 *
 * Dependencies: npm install --prefix /tmp/b4b2-conc embedded-postgres@17.6.0-beta.15 pg@8
 * Run: npm exec --yes --package=tsx -- tsx scripts/g7f4s4c4b4c1-raf-authority-verify.mjs
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { execFileSync } from "node:child_process";
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
const HOME_REL = "src/routes/_authenticated/home.tsx";
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
const atHead = (rel) => {
  try {
    return execFileSync("git", ["show", `HEAD:${rel}`], { cwd: root, encoding: "utf8", maxBuffer: 1 << 26 });
  } catch {
    return null;
  }
};

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
export async function sendSms() { throw new Error("SMS refused in verifier"); }
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
const mutantMark = "/*b4c1-mutant:referrals*/";
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

const DATA_DIR = mkdtempSync(join(tmpdir(), "g7f4s4c4b4c1-pg-"));
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
      if (process.env.G7F4S4C4B4C1_DEBUG) orig(...a);
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
const FAKE_HOST = "g7f4s4c4b4c1.invalid";
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
    throw new Error(`B4c-1 fetch stub refused host ${url.hostname}`);
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

// The home page's claim-cookie rule, evaluated exactly as written in home.tsx.
const homeSrc = read(HOME_REL);
const clearRule = homeSrc.match(/if \(!cancelled && \((result\.ok[^\n]*?)\)\) \{\s*clearRafCookie\(\);/)?.[1] ?? null;
const shouldClearCookie = clearRule ? new Function("result", `return (${clearRule});`) : () => true;

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
async function conflictingRace(ctx, mod) {
  const p = await ctx.provisional();
  const r = await decisionRace(ctx, mod, [
    [p.id, "rejected", "provisional", U.ownerA, { reason: "Owner: duplicate application" }],
    [p.id, "cancelled", "provisional", U.supA, { reason: "Supervisor: friend withdrew" }],
  ]);
  const outs = r.res.map(outcomeOf);
  const fin = await ctx.ref(p.id);
  const trans = (await ctx.transitions(p.id)).filter((t) => t.from_status === "provisional");
  const audits = (await ctx.audits(p.id)).filter((a) => a.audit_type === "raf_bonus_status_changed");
  const winner = outs[0] === "applied" ? "rejected" : outs[1] === "applied" ? "cancelled" : null;
  return {
    claims: r.res.filter((x) => x.ok).length,
    pass:
      outs.filter((o) => o === "applied").length === 1 &&
      outs.filter((o) => o === "conflict").length === 1 &&
      fin.bonus_status === winner &&
      trans.length === 1 &&
      audits.length === 1 &&
      r.pids === 2,
    note: `${outs.join(",")} final=${fin.bonus_status} transitions=${trans.length} audits=${audits.length} pids=${r.pids} lockWaits=${r.lockWaits}`,
  };
}
async function replayRace(ctx, mod) {
  const p = await ctx.provisional();
  const requestId = randomUUID();
  const args = [p.id, "rejected", "provisional", U.ownerA, { reason: "Same request", requestId }];
  const r = await decisionRace(ctx, mod, [args, args]);
  const outs = r.res.map(outcomeOf);
  const trans = (await ctx.transitions(p.id)).filter((t) => t.request_id === requestId);
  return {
    pass:
      outs.filter((o) => o === "applied").length === 1 &&
      outs.filter((o) => o === "already_applied").length === 1 &&
      trans.length === 1 &&
      (await ctx.ref(p.id)).bonus_status === "rejected",
    note: `${outs.join(",")} transitions=${trans.length} pids=${r.pids} lockWaits=${r.lockWaits}`,
  };
}
/** A late replay of an earlier request after the referral moved on must not re-apply it. */
async function lateReplay(ctx, mod) {
  const p = await ctx.provisional();
  const requestId = randomUUID();
  const first = await decide(mod, p.id, "rejected", "provisional", U.ownerA, { reason: "First rejection", requestId });
  const reopen = await decide(mod, p.id, "provisional", "rejected", U.supA, { reason: "Appeal upheld" });
  const replay = await decide(mod, p.id, "rejected", "provisional", U.ownerA, { reason: "First rejection", requestId });
  const fin = await ctx.ref(p.id);
  const trans = await ctx.transitions(p.id);
  return {
    pass:
      first.ok && first.value.outcome === "applied" &&
      reopen.ok && reopen.value.outcome === "applied" &&
      replay.ok && replay.value.outcome === "already_applied" &&
      fin.bonus_status === "provisional" &&
      trans.filter((t) => t.to_status === "rejected").length === 1,
    note: `${[first, reopen, replay].map(outcomeOf).join(",")} final=${fin.bonus_status} transitions=${trans.length}`,
  };
}

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

  // ---------------------------------------------------------------------------------------------
  // Migration discipline
  // ---------------------------------------------------------------------------------------------
  const db = await buildDb("b4c1_main");
  {
    const headB4b2 = atHead(B4B2_REL);
    const headF1 = atHead(F1_REL);
    ok(
      "B4C1-01 the B4c-1 migration applies on a real PostgreSQL server after B4b2 and F1 (both unchanged from HEAD) over staging-shaped RAF tables holding legacy rows",
      db.migration.b4b2.ok && db.migration.f1.ok && db.migration.b4c1.ok &&
        headB4b2 === b4b2Sql && headF1 === f1Sql,
      `PostgreSQL ${ver}; b4c1=${sha256(b4c1Sql).slice(0, 12)} ${db.migration.b4c1.message ?? ""}`,
    );
  }
  {
    const noB4b2 = await buildDb("b4c1_no_b4b2", { b4b2: false });
    const again = await outcome(() => db.admin.query(b4c1Sql));
    const shape = await buildDb("b4c1_shape", {
      after: async ({ q }) => {
        await q(`create function public.verifier_noop() returns trigger language plpgsql as $$ begin return new; end $$`);
        await q(`create trigger verifier_extra before update on public.referrals for each row execute function public.verifier_noop()`);
      },
    });
    const ledger = await buildDb("b4c1_policy_drift", {
      after: async ({ q }) => {
        await q(`create policy "Drift referral writes" on public.referrals for update to authenticated using (true)`);
      },
    });
    const none = async (ctx) =>
      (await ctx.one(`select to_regclass('public.referral_bonus_transitions') is null as t, to_regprocedure('public.set_referral_bonus_status(uuid, uuid, uuid, text, text, text, uuid)') is null as f`));
    const nb = await none(noB4b2);
    const sh = await none(shape);
    const lg = await none(ledger);
    ok(
      "B4C1-02 the migration fails closed and creates nothing without B4b2 (b4b2_missing), on an unexpected referral trigger (unexpected_trigger) or an unexpected referral policy (policies); re-applying it is refused (objects_present)",
      !noB4b2.migration.b4c1.ok && /b4b2_missing/.test(noB4b2.migration.b4c1.message) && nb.t && nb.f &&
        !shape.migration.b4c1.ok && /unexpected_trigger/.test(shape.migration.b4c1.message) && sh.t && sh.f &&
        !ledger.migration.b4c1.ok && /precondition:policies/.test(ledger.migration.b4c1.message) && lg.t && lg.f &&
        !again.ok && /objects_present/.test(again.message),
      [noB4b2.migration.b4c1.message, shape.migration.b4c1.message, ledger.migration.b4c1.message, again.message].join(" | "),
    );
    for (const c of [noB4b2, shape, ledger]) await c.admin.end();
  }
  {
    const after = await db.q(
      `select 'r' k, to_jsonb(t)::text j from public.referrals t union all
       select 'c', to_jsonb(t)::text from public.referral_codes t order by 1, 2`,
    );
    const elig = await db.ref(R.legElig);
    ok(
      "B4C1-03 legacy preservation: every legacy referral and referral code is byte-identical after the migration (statuses, notes, timestamps, tenantless attribution); no transition is backfilled; legacy eligible stays eligible",
      JSON.stringify(after) === JSON.stringify(db.legacyBefore) &&
        (await db.count("public.referral_bonus_transitions", "true")) === 0 &&
        elig.bonus_status === "eligible",
      `rows=${after.length}`,
    );
  }
  {
    const fn = await db.q(
      `select p.proname, p.prosecdef, p.proconfig::text cfg,
              has_function_privilege('anon', p.oid, 'EXECUTE') a, has_function_privilege('authenticated', p.oid, 'EXECUTE') u,
              has_function_privilege('service_role', p.oid, 'EXECUTE') s, p.prorettype = 'trigger'::regtype trg
       from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in
       ('raf_b4c1_writer','referral_effective_tenant','raf_programme_configured','referral_bonus_transitions_guard',
        'referrals_guard','referral_codes_guard','set_referral_bonus_status','record_referral_provisional_qualification')`,
    );
    const priv = await db.one(
      `select has_table_privilege('anon','public.referrals','SELECT,INSERT,UPDATE,DELETE,TRUNCATE') anon_r,
              has_table_privilege('anon','public.referral_codes','SELECT,INSERT,UPDATE,DELETE,TRUNCATE') anon_c,
              has_table_privilege('authenticated','public.referrals','INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') auth_r,
              has_table_privilege('authenticated','public.referral_codes','INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') auth_c,
              has_table_privilege('authenticated','public.referrals','SELECT') auth_sel,
              has_table_privilege('authenticated','public.referral_bonus_transitions','SELECT,INSERT,UPDATE,DELETE') auth_t,
              has_table_privilege('service_role','public.referrals','DELETE,TRUNCATE') svc_del_r,
              has_table_privilege('service_role','public.referral_codes','DELETE,TRUNCATE') svc_del_c,
              has_table_privilege('service_role','public.referral_bonus_transitions','UPDATE,DELETE,TRUNCATE') svc_t,
              (select relrowsecurity from pg_class where oid = 'public.referral_bonus_transitions'::regclass) rls_t`,
    );
    const pol = await db.q(`select tablename, policyname, cmd from pg_policies where tablename in ('referrals','referral_codes','referral_bonus_transitions') order by 1`);
    ok(
      "B4C1-04 catalog: 8 B4c-1 functions are SECURITY INVOKER with an empty search_path, executable by service_role only (triggers by nobody); anon has no access, authenticated read-only (RLS), service_role cannot delete or truncate referrals/codes nor alter history; referral codes have a SELECT-only staff policy; history has RLS and no policy",
      fn.length === 8 &&
        fn.every((f) => !f.prosecdef && f.cfg === '{"search_path=\\"\\""}' && !f.a && !f.u && (f.trg ? !f.s : f.s)) &&
        !priv.anon_r && !priv.anon_c && !priv.auth_r && !priv.auth_c && priv.auth_sel && !priv.auth_t &&
        !priv.svc_del_r && !priv.svc_del_c && !priv.svc_t && priv.rls_t &&
        JSON.stringify(pol) ===
          JSON.stringify([
            { tablename: "referral_codes", policyname: "Staff read referral codes", cmd: "SELECT" },
            { tablename: "referrals", policyname: "Staff view referrals", cmd: "SELECT" },
          ]),
      JSON.stringify(pol),
    );
  }

  useDb(db);

  // ---------------------------------------------------------------------------------------------
  // Fact-find submission: provisional qualification only, configuration-guarded
  // ---------------------------------------------------------------------------------------------
  {
    const c = await db.claim();
    const s = await db.submittedSession(c.friendId, T.a, "in_progress");
    const r = await call(sf.submitSession, { sessionId: s }, c.friendId);
    const ref = await db.ref(c.id);
    const trans = await db.transitions(c.id);
    const audits = await db.audits(c.id);
    ok(
      "B4C1-05 the real submitSession provisionally qualifies the customer's own referral: status qualified, bonus provisional (never earned/eligible), one transition by fact_find_submission with the session as evidence and one audit row, same transaction",
      r.ok && ref.status === "qualified" && ref.bonus_status === "provisional" &&
        trans.length === 1 && trans[0].from_status === "none" && trans[0].to_status === "provisional" &&
        trans[0].actor_role === "fact_find_submission" && trans[0].actor_user_id === c.friendId &&
        trans[0].evidence_ref.kind === "fact_find_submitted" && trans[0].evidence_ref.session_id === s &&
        audits.length === 1 && audits[0].audit_type === "raf_provisional_qualification" &&
        String(audits[0].tenant_id) === T.a,
      `${r.ok ? "ok" : r.message} status=${ref.status}/${ref.bonus_status} transitions=${trans.length} audits=${audits.length}`,
    );
    const again = await call(sf.submitSession, { sessionId: s }, c.friendId);
    ok(
      "B4C1-06 resubmitting the fact-find is idempotent (no second transition or audit row) and creates no RAF ledger accrual",
      again.ok && (await db.transitions(c.id)).length === 1 && (await db.audits(c.id)).length === 1 && (await db.rafLedger()) === 0,
    );
  }
  {
    const q1 = await db.claim();
    const s1 = await db.submittedSession(q1.friendId);
    await db.q(`update public.tenant_features set state = 'disabled' where tenant_id = $1`, [T.a]);
    const disabled = await db.svc(`select public.record_referral_provisional_qualification($1,$2,$3) r`, [T.a, q1.friendId, s1]);
    await db.q(`delete from public.tenant_features where tenant_id = $1`, [T.a]);
    const catalogueDefault = await db.svc(`select public.record_referral_provisional_qualification($1,$2,$3) r`, [T.a, q1.friendId, s1]);
    await db.q(`insert into public.tenant_features (tenant_id, feature_key, state) values ($1,'refer_a_friend','enabled')`, [T.a]);
    await db.q(`update public.finance_settings set num_value = 0 where tenant_id = $1 and key = 'raf_bonus_pence'`, [T.a]);
    const zero = await db.svc(`select public.record_referral_provisional_qualification($1,$2,$3) r`, [T.a, q1.friendId, s1]);
    await db.q(`update public.finance_settings set num_value = 5000 where tenant_id = $1 and key = 'raf_bonus_pence'`, [T.a]);
    const unchanged = await db.ref(q1.id);
    ok(
      "B4C1-07 no provisional qualification while Refer a Friend is disabled (explicitly, or by the catalogue default) or no positive bonus is configured: outcome programme_not_configured, nothing changes",
      [disabled, catalogueDefault, zero].every((x) => x.ok && x.rows[0].r.outcome === "programme_not_configured") &&
        unchanged.bonus_status === "none" && unchanged.status === "signed_up" && (await db.transitions(q1.id)).length === 0,
      [disabled, catalogueDefault, zero].map((x) => (x.ok ? x.rows[0].r.outcome : x.message)).join(","),
    );
    const notSubmitted = await db.submittedSession(q1.friendId, T.a, "in_progress");
    const r1 = await db.svc(`select public.record_referral_provisional_qualification($1,$2,$3) r`, [T.a, q1.friendId, notSubmitted]);
    const otherSession = await db.submittedSession(U.custA2);
    const r2 = await db.svc(`select public.record_referral_provisional_qualification($1,$2,$3) r`, [T.a, q1.friendId, otherSession]);
    const bSession = await db.submittedSession(q1.friendId, T.b);
    const r3 = await db.svc(`select public.record_referral_provisional_qualification($1,$2,$3) r`, [T.a, q1.friendId, bSession]);
    const staff = await call(sf.submitSession, { sessionId: s1 }, U.ownerA);
    ok(
      "B4C1-08 qualification needs the customer's own submitted session in that tenant: an unsubmitted session, another customer's session, a foreign-tenant session and a staff submission on the customer's behalf qualify nothing",
      [r1, r2, r3].every((x) => x.ok && x.rows[0].r.outcome === "session_not_submitted") &&
        (await db.ref(q1.id)).bonus_status === "none" && (await db.transitions(q1.id)).length === 0,
      `${[r1, r2, r3].map((x) => (x.ok ? x.rows[0].r.outcome : x.message)).join(",")} staff=${staff.ok ? "ok" : staff.message}`,
    );
  }

  // ---------------------------------------------------------------------------------------------
  // Database-enforced authority
  // ---------------------------------------------------------------------------------------------
  {
    const p = await db.provisional();
    const r = await decide(rf, p.id, "rejected", "provisional", U.ownerA, { reason: "Friend already a client" });
    const ref = await db.ref(p.id);
    const trans = await db.transitions(p.id);
    const decision = trans.find((t) => t.to_status === "rejected");
    const audit = (await db.audits(p.id)).find((a) => a.audit_type === "raf_bonus_status_changed");
    ok(
      "B4C1-09 Owner rejects with a reason: applied; one transition (tenant, referral, previous/new status, actor, role owner, reason, request id, timestamp) and one audit row written in the same transaction as the status change",
      r.ok && r.value.outcome === "applied" && ref.bonus_status === "rejected" && decision &&
        String(decision.tenant_id) === T.a && decision.from_status === "provisional" && decision.actor_user_id === U.ownerA &&
        decision.actor_role === "owner" && decision.reason === "Friend already a client" && decision.request_id &&
        decision.recorded_at && audit && audit.detail.transition_id === decision.id &&
        Number(decision.txid) ===
          Number((await db.one(`select xmin::text::bigint x from public.referrals where id = $1`, [p.id])).x) &&
        Number(decision.txid) ===
          Number((await db.one(`select xmin::text::bigint x from public.finance_audit_log where id = $1`, [audit.id])).x),
      outcomeOf(r),
    );
    const reopen = await decide(rf, p.id, "provisional", "rejected", U.supA, { reason: "Appeal upheld" });
    const t2 = (await db.transitions(p.id)).at(-1);
    ok(
      "B4C1-10 Supervisor reopens the rejection with a reason (back to provisional because the fact-find qualified it): applied, recorded with role supervisor",
      reopen.ok && reopen.value.outcome === "applied" && (await db.ref(p.id)).bonus_status === "provisional" &&
        t2.from_status === "rejected" && t2.to_status === "provisional" && t2.actor_role === "supervisor" && t2.reason === "Appeal upheld",
      outcomeOf(reopen),
    );
  }
  {
    const p = await db.provisional();
    const tries = [];
    for (const actor of [U.genA, U.advA, U.introA, U.custA, p.friendId]) {
      tries.push(await decide(rf, p.id, "rejected", "provisional", actor, { reason: "not allowed" }));
    }
    const direct = [];
    for (const actor of [U.genA, U.advA, U.introA, U.custA, U.superOwner]) {
      direct.push(await db.rpc(T.a, actor, p.id, "provisional", "rejected", "direct"));
    }
    ok(
      "B4C1-11 General Admin (with finance_raf amend), Adviser, Introducer and customers are refused by the server function, and the database RPC itself refuses them (finance_forbidden) even when called directly; nothing changes",
      tries.every((t) => !t.ok) &&
        direct.every((d) => !d.ok && /finance_forbidden/.test(d.message)) &&
        (await db.ref(p.id)).bonus_status === "provisional" && (await db.transitions(p.id)).length === 1,
      `${tries.map(outcomeOf).join(" | ")} || ${direct.map((d) => d.message).join(",")}`,
    );
  }
  {
    const p = await db.provisional();
    const foreignApp = await decide(rf, p.id, "rejected", "provisional", U.ownerB, { reason: "x", slug: SLUG.b });
    const wrongTenant = await db.rpc(T.b, U.ownerB, p.id, "provisional", "rejected", "x");
    const foreignActor = await db.rpc(T.a, U.ownerB, p.id, "provisional", "rejected", "x");
    const bRef = await db.rpc(T.a, U.ownerA, R.legB, "none", "rejected", "x");
    ok(
      "B4C1-12 cross-tenant refused: tenant B's Owner gets Not found through the app; the RPC refuses a referral outside p_tenant_id (raf_resource_not_found) and a non-member actor (finance_forbidden); tenant A's Owner cannot touch tenant B's referral",
      !foreignApp.ok && /not found/i.test(foreignApp.message) &&
        !wrongTenant.ok && /raf_resource_not_found/.test(wrongTenant.message) &&
        !foreignActor.ok && /finance_forbidden/.test(foreignActor.message) &&
        !bRef.ok && /raf_resource_not_found/.test(bRef.message) &&
        (await db.ref(p.id)).bonus_status === "provisional" && (await db.ref(R.legB)).bonus_status === "none",
      [outcomeOf(foreignApp), wrongTenant.message, foreignActor.message, bRef.message].join(" | "),
    );
  }
  {
    const p = await db.provisional();
    globalThis.__B4C1_PLATFORM = {
      [U.superOwner]: { tenantId: T.a, level: "operational_admin" },
      [U.ownerA]: { tenantId: T.a, level: "emergency" },
    };
    rest.rpcCalls = [];
    const plat = await decide(rf, p.id, "rejected", "provisional", U.superOwner, { reason: "platform" });
    const ownerInPlatform = await decide(rf, p.id, "rejected", "provisional", U.ownerA, { reason: "platform" });
    const reached = rest.rpcCalls.filter((c) => c.name === "set_referral_bonus_status").length;
    const link = await call(rf.createReferralLink, { referrerName: "Platform Person" }, U.superOwner);
    globalThis.__B4C1_PLATFORM = {};
    const direct = await db.rpc(T.a, U.superOwner, p.id, "provisional", "rejected", "platform");
    ok(
      "B4C1-13 Platform Enter Company is not membership: an operational/emergency platform session (even for a user who is also the Owner) is refused with an explicit message before the database is asked, cannot mint referral codes, and the RPC refuses the platform user (finance_forbidden)",
      !plat.ok && plat.message === PLATFORM && !ownerInPlatform.ok && ownerInPlatform.message === PLATFORM &&
        reached === 0 && !link.ok && /Platform access cannot create/.test(link.message) &&
        !direct.ok && /finance_forbidden/.test(direct.message) && (await db.ref(p.id)).bonus_status === "provisional",
      `${outcomeOf(plat)} | ${outcomeOf(ownerInPlatform)} | rpc=${reached} | ${outcomeOf(link)} | ${direct.message}`,
    );
  }
  {
    const p = await db.provisional();
    const attempts = {
      authPatch: await db.asClient("authenticated", U.ownerA, `update public.referrals set bonus_status = 'paid' where id = $1`, [p.id]),
      authInsert: await db.asClient("authenticated", U.ownerA,
        `insert into public.referrals (referral_code_id, code, referrer_user_id, referred_user_id, tenant_id) values ($1,$2,$3,$4,$5)`,
        [R.codeA1, CODE.a1, U.custA, U.custA2, T.a]),
      authDelete: await db.asClient("authenticated", U.ownerA, `delete from public.referrals where id = $1`, [p.id]),
      advCode: await db.asClient("authenticated", U.advA, `update public.referral_codes set active = false where id = $1`, [R.codeA1]),
      advCodeInsert: await db.asClient("authenticated", U.advA,
        `insert into public.referral_codes (code, referrer_user_id, created_by, tenant_id) values ('ADVMINT1', $1, $1, $2)`, [U.advA, T.a]),
      anonRead: await db.asClient("anon", null, `select * from public.referrals`),
      authHistory: await db.asClient("authenticated", U.ownerA, `select * from public.referral_bonus_transitions`),
      authRpc: await db.asClient("authenticated", U.ownerA, `select public.set_referral_bonus_status($1,$2,$3,'provisional','rejected','x',$4)`, [T.a, U.ownerA, p.id, randomUUID()]),
      svcPatch: await db.svc(`update public.referrals set bonus_status = 'paid', status = 'rewarded' where id = $1`, [p.id]),
      svcDelete: await db.svc(`delete from public.referrals where id = $1`, [p.id]),
      svcHistory: await db.svc(
        `insert into public.referral_bonus_transitions (tenant_id, referral_id, from_status, to_status, actor_user_id, actor_role, reason, request_id)
         values ($1,$2,'provisional','rejected',$3,'owner','forged',$4)`, [T.a, p.id, U.ownerA, randomUUID()]),
      svcIdentity: await db.svc(`update public.referrals set referrer_user_id = $2 where id = $1`, [p.id, U.custA2]),
    };
    const rest1 = Object.entries(attempts).filter(([, v]) => v.ok).map(([k]) => k);
    ok(
      "B4C1-14 no direct client bypass: authenticated/anon cannot insert, update or delete referrals or codes (even staff under the old manage policy), read history or execute the RPC; service_role cannot change a bonus status without the RPC (raf_referral_write_forbidden), delete referrals, forge history (raf_write_forbidden) or reassign the referrer",
      rest1.length === 0 &&
        /permission denied/.test(attempts.authPatch.message) && /permission denied/.test(attempts.advCode.message) &&
        /raf_referral_write_forbidden/.test(attempts.svcPatch.message) && /raf_write_forbidden/.test(attempts.svcHistory.message) &&
        /permission denied/.test(attempts.svcDelete.message) && /raf_referral_write_forbidden/.test(attempts.svcIdentity.message) &&
        (await db.ref(p.id)).bonus_status === "provisional" && (await db.one(`select active from public.referral_codes where id = $1`, [R.codeA1])).active,
      `succeeded=${JSON.stringify(rest1)}`,
    );
  }
  {
    const paidMsgs = [];
    for (const to of ["rejected", "cancelled", "none", "payment_approved"]) {
      paidMsgs.push(await decide(rf, R.legPaid, to, "paid", U.ownerA, { reason: "undo" }));
    }
    const c = await db.provisional();
    const cancel = await decide(rf, c.id, "cancelled", "provisional", U.ownerA, { reason: "Duplicate" });
    const afterCancel = await decide(rf, c.id, "provisional", "cancelled", U.ownerA, { reason: "revive" });
    const svcRevive = await db.svc(`update public.referrals set bonus_status = 'none' where id = $1`, [R.legPaid]);
    ok(
      "B4C1-15 paid is terminal (legacy paid cannot be rejected, cancelled, reopened or re-approved) and cancelled is terminal; the database refuses a direct revival",
      paidMsgs.every((m) => !m.ok && /paid or cancelled referral bonus cannot be changed/.test(m.message)) &&
        cancel.ok && !afterCancel.ok && /cannot be changed/.test(afterCancel.message) && !svcRevive.ok &&
        (await db.ref(R.legPaid)).bonus_status === "paid" && (await db.ref(c.id)).bonus_status === "cancelled",
      `${paidMsgs.map(outcomeOf).join(" | ")} | ${outcomeOf(afterCancel)}`,
    );
  }
  {
    const p = await db.provisional();
    const noReason = await decide(rf, p.id, "rejected", "provisional", U.ownerA, {});
    const blank = await decide(rf, p.id, "cancelled", "provisional", U.ownerA, { reason: "   " });
    const rej = await decide(rf, p.id, "rejected", "provisional", U.ownerA, { reason: "Not eligible" });
    const reopenBare = await decide(rf, p.id, "provisional", "rejected", U.ownerA, {});
    const e = await db.claim();
    await db.force(e.id, "payment_approved", "qualified");
    const withdrawBare = await decide(rf, e.id, "earned", "payment_approved", U.ownerA, {});
    const withdraw = await decide(rf, e.id, "earned", "payment_approved", U.supA, { reason: "Bank details wrong" });
    const dbBare = await db.rpc(T.a, U.ownerA, p.id, "rejected", "provisional", null);
    ok(
      "B4C1-16 reasons are required to reject, cancel, reopen and withdraw an approval (app and database: raf_reason_required); with a reason each applies",
      [noReason, blank, reopenBare, withdrawBare].every((x) => !x.ok && /reason is required/.test(x.message)) &&
        rej.ok && withdraw.ok && withdraw.value.outcome === "applied" &&
        !dbBare.ok && /raf_reason_required/.test(dbBare.message) &&
        (await db.ref(p.id)).bonus_status === "rejected" && (await db.ref(e.id)).bonus_status === "earned",
      [noReason, blank, reopenBare, withdrawBare, rej, withdraw].map(outcomeOf).join(" | ") + ` | ${dbBare.message}`,
    );
  }
  {
    const p = await db.provisional();
    const tries = [];
    for (const to of ["completion_verified", "earned", "payment_approved", "paid"]) {
      tries.push(await decide(rf, p.id, to, "provisional", U.ownerA, { reason: "Completed" }));
    }
    const legacy = await decide(rf, R.legElig, "paid", "eligible", U.ownerA, { reason: "Completed" });
    const legacyTenantless = await decide(rf, R.legTenantless, "earned", "eligible", U.ownerA, {});
    const direct = await db.rpc(T.a, U.ownerA, p.id, "provisional", "earned", "x");
    ok(
      "B4C1-17 no bonus is earned, approved or paid from a fact-find (or legacy eligible) alone: completion_verified/earned/payment_approved/paid are refused until a verified completion record exists (raf_completion_record_required)",
      tries.every((t) => !t.ok && /mortgage completion has been verified/.test(t.message)) &&
        !legacy.ok && /completion/.test(legacy.message) && !legacyTenantless.ok &&
        !direct.ok && /raf_completion_record_required/.test(direct.message) &&
        (await db.ref(p.id)).bonus_status === "provisional" && (await db.ref(R.legElig)).bonus_status === "eligible",
      tries.map(outcomeOf).join(" | "),
    );
  }
  {
    const legacy = await decide(rf, R.legTenantless, "rejected", "eligible", U.ownerA, { reason: "Legacy review" });
    const t = (await db.transitions(R.legTenantless)).at(-1);
    const row = await db.ref(R.legTenantless);
    ok(
      "B4C1-18 a legacy tenantless referral is decided through its code's tenant: the transition carries tenant A, the referral stays tenantless (attribution preserved, not reassigned)",
      legacy.ok && t && String(t.tenant_id) === T.a && t.from_status === "eligible" && row.tenant_id === null && row.bonus_status === "rejected",
      outcomeOf(legacy),
    );
  }
  {
    const p = await db.provisional();
    await db.q(`create function public.verifier_fail_audit() returns trigger language plpgsql as $$
      begin if new.detail->>'reason' = 'FAIL-AUDIT' then raise exception 'verifier audit failure'; end if; return new; end $$`);
    await db.q(`create trigger verifier_fail_audit before insert on public.finance_audit_log for each row execute function public.verifier_fail_audit()`);
    const r = await decide(rf, p.id, "rejected", "provisional", U.ownerA, { reason: "FAIL-AUDIT" });
    await db.q(`drop trigger verifier_fail_audit on public.finance_audit_log`);
    ok(
      "B4C1-19 atomic audit: when the audit write fails the whole decision rolls back (no transition, status unchanged)",
      !r.ok && (await db.ref(p.id)).bonus_status === "provisional" &&
        (await db.transitions(p.id)).filter((x) => x.to_status === "rejected").length === 0,
      outcomeOf(r),
    );
  }
  {
    const t = (await db.q(`select id from public.referral_bonus_transitions limit 1`))[0].id;
    const upd = await outcome(() => db.q(`update public.referral_bonus_transitions set reason = 'edited' where id = $1`, [t]));
    const del = await outcome(() => db.q(`delete from public.referral_bonus_transitions where id = $1`, [t]));
    const trunc = await outcome(() => db.q(`truncate public.referral_bonus_transitions`));
    const audUpd = await outcome(() => db.q(`update public.finance_audit_log set summary = 'edited' where audit_type like 'raf_%'`));
    const refDel = await outcome(() => db.q(`delete from public.referrals where id = $1`, [R.legNone]));
    const codeDel = await outcome(() => db.q(`delete from public.referral_codes where id = $1`, [R.codeA1]));
    const codeEdit = await outcome(() => db.q(`update public.referral_codes set code = 'RENAMED1' where id = $1`, [R.codeA1]));
    ok(
      "B4C1-20 immutable history: transitions refuse update, delete and truncate even for the table owner (raf_history_immutable); RAF audit rows stay immutable; referrals and codes are never deleted and a code's identity never changes",
      !upd.ok && /raf_history_immutable/.test(upd.message) && !del.ok && !trunc.ok && !audUpd.ok &&
        !refDel.ok && /raf_referral_immutable/.test(refDel.message) && !codeDel.ok && !codeEdit.ok,
      [upd, del, trunc, audUpd, refDel, codeDel, codeEdit].map((x) => (x.ok ? "ok" : x.message.slice(0, 40))).join(" | "),
    );
  }

  // ---------------------------------------------------------------------------------------------
  // Concurrency and idempotency (independent connections)
  // ---------------------------------------------------------------------------------------------
  const conflictRuns = [];
  for (let i = 0; i < 4; i += 1) conflictRuns.push(await conflictingRace(db, rf));
  ok(
    "B4C1-21 conflicting simultaneous decisions (Owner reject vs Supervisor cancel, both expecting provisional) on separate connections: exactly one applied, the other an explicit conflict; one transition and one audit row; the stored status is the winner's",
    conflictRuns.every((r) => r.pass),
    conflictRuns.map((r) => r.note).join(" | "),
  );
  const replayRuns = [];
  for (let i = 0; i < 3; i += 1) replayRuns.push(await replayRace(db, rf));
  ok(
    "B4C1-22 the same request submitted twice simultaneously: one applied, the other already_applied; exactly one transition",
    replayRuns.every((r) => r.pass),
    replayRuns.map((r) => r.note).join(" | "),
  );
  {
    const late = await lateReplay(db, rf);
    const p = await db.provisional();
    const requestId = randomUUID();
    await decide(rf, p.id, "rejected", "provisional", U.ownerA, { reason: "Original", requestId });
    const reused = await decide(rf, p.id, "cancelled", "provisional", U.ownerA, { reason: "Other", requestId });
    const sameTarget = await decide(rf, p.id, "rejected", "provisional", U.supA, { reason: "Original" });
    const otherReason = await decide(rf, p.id, "rejected", "provisional", U.supA, { reason: "A different reason" });
    ok(
      "B4C1-23 idempotent replay: a late replay of an applied request returns already_applied without re-applying it; reusing a request id for a different change is an explicit conflict; the same target with the recorded reason is already_applied, with a different reason a conflict",
      late.pass && !reused.ok && /already used for a different change/.test(reused.message) &&
        sameTarget.ok && sameTarget.value.outcome === "already_applied" && !otherReason.ok && otherReason.message === CONFLICT &&
        (await db.transitions(p.id)).filter((t) => t.to_status === "rejected").length === 1,
      `${late.note} | ${[reused, sameTarget, otherReason].map(outcomeOf).join(" | ")}`,
    );
  }

  // ---------------------------------------------------------------------------------------------
  // Lifecycle integrity
  // ---------------------------------------------------------------------------------------------
  {
    const friend = `${db.name}Multi`;
    await db.addUser(friend);
    await db.addMember(friend, T.a, "customer");
    const r1 = await call(rf.claimReferral, { code: CODE.a1 }, U[friend]);
    const r2 = await call(rf.claimReferral, { code: CODE.a2 }, U[friend]);
    const rows = await db.q(`select id, referrer_user_id from public.referrals where referred_user_id = $1 order by created_at`, [U[friend]]);
    const list = await call(rf.listAllReferrals, {}, U.ownerA);
    const mine = list.ok ? list.value.filter((r) => r.referred_user_id === U[friend]) : [];
    await db.force(rows[0].id, "earned", "qualified");
    await db.force(rows[1].id, "paid", "rewarded");
    const blocked = await decide(rf, rows[0].id, "payment_approved", "earned", U.ownerA, {});
    await db.force(rows[1].id, "provisional", "qualified");
    const allowed = await decide(rf, rows[0].id, "payment_approved", "earned", U.ownerA, {});
    ok(
      "B4C1-24 multiple referrers: both referrers' claims for one customer are recorded (attribution preserved) and flagged as competing in the staff list; only one referral per customer can be in a financial state (raf_competing_referral)",
      r1.ok && r2.ok && rows.length === 2 && rows[0].referrer_user_id !== rows[1].referrer_user_id &&
        mine.length === 2 && mine.every((m) => m.competingClaims === 1) &&
        !blocked.ok && /already progressing/.test(blocked.message) && allowed.ok && allowed.value.outcome === "applied",
      `${outcomeOf(r1)} | ${outcomeOf(r2)} | ${outcomeOf(blocked)} | ${outcomeOf(allowed)}`,
    );
  }
  {
    const friend = `${db.name}Claim`;
    await db.addUser(friend);
    await db.addMember(friend, T.a, "customer");
    const unresolved = await call(rf.claimReferral, { code: CODE.a1 }, U[friend], "unknown-firm");
    const invalid = await call(rf.claimReferral, { code: "NOSUCHCODE" }, U[friend]);
    const self = await call(rf.claimReferral, { code: CODE.a1 }, U.custA);
    await db.q(`update public.referral_codes set active = false where id = $1`, [R.codeA2]);
    const inactive = await call(rf.claimReferral, { code: CODE.a2 }, U[friend]);
    await db.q(`update public.referral_codes set active = true where id = $1`, [R.codeA2]);
    const recorded = await call(rf.claimReferral, { code: CODE.a1 }, U[friend]);
    const directs = [
      await db.svc(`insert into public.referrals (referral_code_id, code, referrer_user_id, referred_user_id, status, tenant_id) values ($1,$2,$3,$4,'signed_up',$5)`,
        [R.codeA1, CODE.a1, U.custA2, U.custB, T.a]),
      await db.svc(`insert into public.referrals (referral_code_id, code, referrer_user_id, referred_user_id, status, tenant_id) values ($1,$2,$3,$4,'signed_up',$5)`,
        [R.codeA1, CODE.a1, U.custA, U.custB, T.b]),
      await db.svc(`insert into public.referrals (referral_code_id, code, referrer_user_id, referred_user_id, status, tenant_id) values ($1,$2,$3,$3,'signed_up',$4)`,
        [R.codeA1, CODE.a1, U.custA, T.a]),
      await db.svc(`insert into public.referrals (referral_code_id, code, referrer_user_id, referred_user_id, status, bonus_status, tenant_id) values ($1,$2,$3,$4,'qualified','paid',$5)`,
        [R.codeA1, CODE.a1, U.custA, U.custB, T.a]),
    ];
    ok(
      "B4C1-25 claim cookie: an unresolved tenant returns tenant_unresolved and home.tsx keeps the cookie; recorded, invalid, inactive and self-referral outcomes clear it; the database refuses claims crediting another referrer, a foreign tenant, self-referral or a pre-decided bonus (raf_referral_invalid)",
      unresolved.ok && unresolved.value.reason === "tenant_unresolved" && !shouldClearCookie(unresolved.value) &&
        invalid.ok && invalid.value.reason === "invalid" && shouldClearCookie(invalid.value) &&
        self.ok && self.value.reason === "self" && shouldClearCookie(self.value) &&
        inactive.ok && inactive.value.reason === "invalid" && shouldClearCookie(inactive.value) &&
        recorded.ok && recorded.value.reason === "recorded" && shouldClearCookie(recorded.value) &&
        shouldClearCookie({ ok: false, reason: "not_ready" }) === false &&
        directs.every((d) => !d.ok && /raf_referral_invalid/.test(d.message)),
      `rule=${clearRule} | ${[unresolved, invalid, self, inactive, recorded].map((x) => (x.ok ? x.value.reason : x.message)).join(",")} | ${directs.map((d) => d.message).join(",")}`,
    );
  }
  {
    const byOwner = await call(rf.createReferralLink, { referrerUserId: U.custA2 }, U.ownerA);
    const byGeneral = await call(rf.createReferralLink, { referrerName: "Off System" }, U.genA);
    const byAdviser = await call(rf.createReferralLink, { referrerName: "Adviser Mint" }, U.advA);
    const foreignReferrer = await call(rf.createReferralLink, { referrerUserId: U.custB }, U.ownerA);
    const self = await call(rf.ensureMyReferralLink, {}, U.custA2);
    const directs = {
      adviserCreator: await db.svc(`insert into public.referral_codes (code, referrer_name, created_by, tenant_id) values ('ADVDIRECT', 'x', $1, $2)`, [U.advA, T.a]),
      foreignReferrer: await db.svc(`insert into public.referral_codes (code, referrer_user_id, created_by, tenant_id) values ('FOREIGNREF', $1, $2, $3)`, [U.custB, U.ownerA, T.a]),
      tenantless: await db.svc(`insert into public.referral_codes (code, referrer_name, created_by) values ('NOTENANT1', 'x', $1)`, [U.ownerA]),
      otherCustomer: await db.svc(`insert into public.referral_codes (code, referrer_user_id, created_by, tenant_id) values ('FORGED01', $1, $2, $3)`, [U.custA, U.custA2, T.a]),
      retarget: await db.svc(`update public.referral_codes set referrer_user_id = $2 where id = $1`, [R.codeA1, U.custA2]),
      retenant: await db.svc(`update public.referral_codes set tenant_id = $2 where id = $1`, [R.codeA1, T.b]),
      deactivate: await db.svc(`update public.referral_codes set active = false where id = $1 returning active`, [R.codeB1]),
    };
    await db.q(`update public.referral_codes set active = true where id = $1`, [R.codeB1]);
    ok(
      "B4C1-26 referral-code authority: Owner and General Admin members mint codes and a member mints their own; an Adviser, a foreign-tenant referrer, a tenantless code, a code minted for another customer and retargeting/retenanting a code are refused (app and database); deactivation stays possible",
      byOwner.ok && byGeneral.ok && !byAdviser.ok && !foreignReferrer.ok && self.ok &&
        !directs.adviserCreator.ok && /raf_referral_code_forbidden/.test(directs.adviserCreator.message) &&
        !directs.foreignReferrer.ok && /raf_referral_code_invalid/.test(directs.foreignReferrer.message) &&
        !directs.tenantless.ok && !directs.otherCustomer.ok && !directs.retarget.ok && !directs.retenant.ok &&
        directs.deactivate.ok,
      `${[byOwner, byGeneral, byAdviser, foreignReferrer, self].map((x) => (x.ok ? "ok" : x.message.slice(0, 40))).join(" | ")} | ${Object.entries(directs).map(([k, v]) => `${k}:${v.ok ? "ok" : v.message.slice(0, 30)}`).join(",")}`,
    );
  }
  {
    const act = await call(rf.listMyReferralActivity, {}, U.custA);
    const v = act.ok ? act.value : null;
    await db.q(`update public.tenant_features set state = 'disabled' where tenant_id = $1`, [T.a]);
    const off = await call(rf.listMyReferralActivity, {}, U.custA);
    await db.q(`update public.tenant_features set state = 'enabled' where tenant_id = $1`, [T.a]);
    const settingsA = await call(rf.getRafProgrammeSettings, {}, U.ownerA);
    const settingsB = await call(rf.getRafProgrammeSettings, {}, U.ownerB, SLUG.b);
    ok(
      "B4C1-27 customer activity works (no referred_phone): the referrer sees each friend's progress label and no friend email or phone; the bonus shown is the tenant's configured amount, and none while the programme is disabled; staff settings return each tenant's own configured amount",
      v && v.referrals.length >= 3 && v.referrals.every((r) => r.progressLabel && !("referredEmail" in r) && !("referredPhone" in r)) &&
        v.referrals.some((r) => r.progressLabel === "Bonus paid") && v.bonusPence === 5000 &&
        off.ok && off.value.bonusPence === null &&
        settingsA.ok && settingsA.value.bonusPence === 5000 && settingsA.value.enabled === true &&
        settingsB.ok && settingsB.value.bonusPence === 7550,
      `${act.ok ? `refs=${v.referrals.length} bonus=${v.bonusPence}` : act.message} | ${settingsA.ok ? JSON.stringify(settingsA.value) : settingsA.message}`,
    );
  }
  {
    const c = await db.claim();
    const del = await outcome(() => db.q(`delete from auth.users where id = $1`, [c.friendId]));
    const row = await db.one(`select referred_user_id, code, referrer_user_id from public.referrals where id = $1`, [c.id]);
    ok(
      "B4C1-28 the auth.users ON DELETE SET NULL action still works through the guard (identity otherwise unchanged)",
      del.ok && row.referred_user_id === null && row.code === CODE.a1 && row.referrer_user_id === U.custA,
      del.ok ? "" : del.message,
    );
  }
  {
    const staffSrc = read("src/components/staff/panels/staff-panels.tsx");
    const landing = read("src/components/customer/CustomerHomeLanding.tsx");
    const sessionsSrc = read("src/lib/sessions.functions.ts");
    ok(
      "B4C1-29 source: no hard-coded £75 in the customer or staff RAF UI; the staff decision select offers only database-allowed decisions; submitSession passes its session to qualification; the activity query no longer names referred_phone",
      !/£75/.test(homeSrc) && !/£75/.test(landing) && !/£75/.test(staffSrc) &&
        !/<option value="eligible">/.test(staffSrc) &&
        /markReferralQualified\(context\.userId, sessionTenantId, data\.sessionId\)/.test(sessionsSrc) &&
        !/referred_phone/.test(referralsSrc) && Boolean(clearRule),
    );
  }
  ok("B4C1-30 no RAF ledger accrual anywhere (finance_ledger holds no referral or referrer row)", (await db.rafLedger()) === 0);
  ok("B4C1-31 no unexpected network or API calls", unknownCalls.length === 0, JSON.stringify(unknownCalls.slice(0, 5)));

  // =============================================================================================
  // NEGATIVE CONTROLS
  // =============================================================================================
  const mutantDb = async (label, pairs, opts = {}) => {
    const text = mutate(b4c1Sql, pairs);
    if (!text) return { anchor: false };
    const ctx = await buildDb(label, { b4c1Text: text, ...opts });
    return { anchor: true, ctx, ok: ctx.migration.b4c1.ok, message: ctx.migration.b4c1.message };
  };
  {
    const m = await mutantDb("nc01_authority", [
      ["  v_role := public.finance_actor_role(p_tenant_id, p_actor_user_id, 'payout');\n", "  v_role := 'owner';\n"],
    ]);
    let effect = false;
    let caught = false;
    if (m.ok) {
      const p = await m.ctx.provisional();
      const r = await m.ctx.rpc(T.a, U.genA, p.id, "provisional", "rejected", "general admin");
      effect = r.ok;
      caught = !(!r.ok && /finance_forbidden/.test(r.message ?? ""));
      await m.ctx.admin.end();
    }
    nc("NC01 RPC without the membership role check → a General Admin's direct RPC rejects a bonus; B4C1-11 rejects", { effect, caught, detail: m.message ?? "" });
  }
  {
    const mod = await referralsMutant([["    assertRafDecisionMaker(view);\n", ""]]);
    let effect = false;
    let caught = false;
    if (mod) {
      useDb(db);
      const p = await db.provisional();
      globalThis.__B4C1_PLATFORM = { [U.superOwner]: { tenantId: T.a, level: "operational_admin" } };
      rest.rpcCalls = [];
      const r = await decide(mod, p.id, "rejected", "provisional", U.superOwner, { reason: "platform" });
      globalThis.__B4C1_PLATFORM = {};
      const reached = rest.rpcCalls.filter((c) => c.name === "set_referral_bonus_status").length;
      effect = reached > 0;
      caught = !(r.ok === false && r.message === PLATFORM && reached === 0);
    }
    nc("NC02 server function without the membership/platform guard → a platform session's decision reaches the database RPC; B4C1-13 rejects", { effect, caught });
  }
  {
    const m = await mutantDb("nc03_referrals_guard", [], {});
    let effect = false;
    let caught = false;
    if (m.ok) {
      await m.ctx.q(`drop trigger referrals_guard on public.referrals`);
      const p = await m.ctx.provisional();
      const r = await m.ctx.svc(`update public.referrals set bonus_status = 'paid', status = 'rewarded' where id = $1`, [p.id]);
      effect = r.ok && (await m.ctx.ref(p.id)).bonus_status === "paid";
      caught = !(!r.ok && /raf_referral_write_forbidden/.test(r.message ?? ""));
      await m.ctx.admin.end();
    }
    nc("NC03 referrals without the guard trigger → service_role marks a provisional referral paid with no transition; B4C1-14 rejects", { effect, caught });
  }
  {
    const m = await mutantDb("nc04_client_policy", [
      ['DROP POLICY "Staff manage referral codes" ON public.referral_codes;\nCREATE POLICY "Staff read referral codes" ON public.referral_codes\n  FOR SELECT TO authenticated USING (public.auth_is_tenant_staff(tenant_id));\n', ""],
      ["REVOKE ALL ON public.referrals, public.referral_codes, public.referral_bonus_transitions\n  FROM PUBLIC, anon, authenticated, service_role;\n",
       "REVOKE ALL ON public.referral_bonus_transitions FROM PUBLIC, anon, authenticated, service_role;\nREVOKE DELETE, TRUNCATE ON public.referrals, public.referral_codes FROM service_role;\n"],
      ["    RAISE EXCEPTION 'g7f4s4c4b4c1_postcondition:policies';", "    NULL;"],
      ["    RAISE EXCEPTION 'g7f4s4c4b4c1_postcondition:privileges';", "    NULL;"],
    ]);
    let effect = false;
    let caught = false;
    if (m.ok) {
      const r = await m.ctx.asClient("authenticated", U.advA, `update public.referral_codes set active = false where id = $1`, [R.codeA1]);
      effect = r.ok && r.rowCount === 1;
      caught = !(!r.ok && /permission denied/.test(r.message ?? ""));
      await m.ctx.admin.end();
    }
    nc("NC04 the old client write path kept (manage policy and client grants) → an Adviser deactivates a referral code directly from the client; B4C1-14 rejects", { effect, caught, detail: m.message ?? "" });
  }
  {
    const m = await mutantDb("nc05_history", [], {});
    let effect = false;
    let caught = false;
    if (m.ok) {
      const p = await m.ctx.provisional();
      await m.ctx.q(`drop trigger referral_bonus_transitions_append_only on public.referral_bonus_transitions`);
      const r = await outcome(() => m.ctx.q(`update public.referral_bonus_transitions set reason = 'rewritten' where referral_id = $1`, [p.id]));
      effect = r.ok && (await m.ctx.transitions(p.id))[0].reason === "rewritten";
      caught = !(!r.ok && /raf_history_immutable/.test(r.message ?? ""));
      await m.ctx.admin.end();
    }
    nc("NC05 history without the append-only trigger → a recorded transition is rewritten; B4C1-20 rejects", { effect, caught });
  }
  {
    const m = await mutantDb("nc06_concurrency", [
      ["  SELECT * INTO v_ref FROM public.referrals r WHERE r.id = p_referral_id FOR UPDATE;\n", "  SELECT * INTO v_ref FROM public.referrals r WHERE r.id = p_referral_id;\n"],
      ["  IF v_ref.referred_user_id IS NOT NULL THEN\n    PERFORM pg_advisory_xact_lock(hashtextextended(\n      'raf_referred:' || p_tenant_id::text || ':' || v_ref.referred_user_id::text, 0));\n  END IF;\n  SELECT", "  SELECT"],
      ["  IF v_ref.bonus_status IS DISTINCT FROM p_expected_status THEN\n    RAISE EXCEPTION 'raf_status_conflict';\n  END IF;\n", ""],
      ["  IF NOT EXISTS (\n    SELECT 1 FROM public.referral_bonus_transitions t\n    WHERE t.referral_id = NEW.id AND t.txid = txid_current()\n      AND t.from_status = OLD.bonus_status AND t.to_status = NEW.bonus_status) THEN\n    RAISE EXCEPTION 'raf_transition_missing';\n  END IF;\n", ""],
      ["     OR v_ref.bonus_status IS DISTINCT FROM NEW.from_status THEN\n    RAISE EXCEPTION 'raf_transition_invalid';", " THEN\n    RAISE EXCEPTION 'raf_transition_invalid';"],
    ]);
    let effect = false;
    let caught = false;
    if (m.ok) {
      useDb(m.ctx);
      const runs = [];
      for (let i = 0; i < 3; i += 1) runs.push(await conflictingRace(m.ctx, rf));
      effect = runs.some((r) => r.claims === 2);
      caught = runs.some((r) => !r.pass);
      await m.ctx.pool.end();
      await m.ctx.admin.end();
      useDb(db);
    }
    nc("NC06 decision without the row/customer locks, compare-and-set and transition match → both conflicting decisions apply; B4C1-21 rejects", { effect, caught, detail: m.message ?? "" });
  }
  {
    const m = await mutantDb("nc07_idempotency", [
      ["  IF FOUND THEN\n    IF v_prior.referral_id = p_referral_id", "  IF false THEN\n    IF v_prior.referral_id = p_referral_id"],
      ["  CONSTRAINT referral_bonus_transitions_request_key UNIQUE (tenant_id, request_id),\n", ""],
    ]);
    let effect = false;
    let caught = false;
    if (m.ok) {
      useDb(m.ctx);
      const late = await lateReplay(m.ctx, rf);
      effect = /final=rejected/.test(late.note);
      caught = !late.pass;
      await m.ctx.pool.end();
      await m.ctx.admin.end();
      useDb(db);
    }
    nc("NC07 no request-id replay check or uniqueness → a late replay re-applies an old rejection; B4C1-23 rejects", { effect, caught, detail: m.message ?? "" });
  }
  {
    const m = await mutantDb("nc08_eligibility", [
      ["  IF NOT public.raf_programme_configured(p_tenant_id) THEN\n    RETURN jsonb_build_object('outcome', 'programme_not_configured', 'qualified', 0);\n  END IF;\n", ""],
    ]);
    let effect = false;
    let caught = false;
    if (m.ok) {
      const c = await m.ctx.claim();
      const s = await m.ctx.submittedSession(c.friendId);
      await m.ctx.q(`update public.tenant_features set state = 'disabled' where tenant_id = $1`, [T.a]);
      const r = await m.ctx.svc(`select public.record_referral_provisional_qualification($1,$2,$3) r`, [T.a, c.friendId, s]);
      effect = (await m.ctx.ref(c.id)).bonus_status === "provisional";
      caught = !(r.ok && r.rows[0].r.outcome === "programme_not_configured");
      await m.ctx.admin.end();
    }
    nc("NC08 qualification without the programme guard → a referral is provisionally qualified while Refer a Friend is disabled; B4C1-07 rejects", { effect, caught, detail: m.message ?? "" });
  }
  {
    const m = await mutantDb("nc09_completion", [
      ["  IF p_to_status = 'completion_verified'\n     OR (p_to_status = 'earned' AND v_ref.bonus_status <> 'payment_approved')\n     OR (p_to_status IN ('payment_approved', 'paid')\n         AND v_ref.bonus_status NOT IN ('earned', 'payment_approved')) THEN\n    RAISE EXCEPTION 'raf_completion_record_required';\n  END IF;\n", ""],
      ["      'provisional>rejected', 'provisional>cancelled',", "      'provisional>rejected', 'provisional>cancelled', 'provisional>earned',"],
    ]);
    let effect = false;
    let caught = false;
    if (m.ok) {
      const p = await m.ctx.provisional();
      const r = await m.ctx.rpc(T.a, U.ownerA, p.id, "provisional", "earned", null);
      effect = r.ok && (await m.ctx.ref(p.id)).bonus_status === "earned";
      caught = !(!r.ok && /raf_completion_record_required/.test(r.message ?? ""));
      await m.ctx.admin.end();
    }
    nc("NC09 decision without the completion requirement → an Owner marks a fact-find-only referral earned; B4C1-17 rejects", { effect, caught, detail: m.message ?? "" });
  }
  {
    const m = await mutantDb("nc10_atomic", [
      ["  PERFORM public.network_finance_audit(\n    p_tenant_id, p_actor_user_id, v_role, 'raf_bonus_status_changed', NULL,", "  BEGIN PERFORM public.network_finance_audit(\n    p_tenant_id, p_actor_user_id, v_role, 'raf_bonus_status_changed', NULL,"],
      ["                       'request_id', p_request_id, 'referrer_user_id', v_ref.referrer_user_id));\n", "                       'request_id', p_request_id, 'referrer_user_id', v_ref.referrer_user_id));\n  EXCEPTION WHEN OTHERS THEN NULL; END;\n"],
    ]);
    let effect = false;
    let caught = false;
    if (m.ok) {
      const p = await m.ctx.provisional();
      await m.ctx.q(`create function public.verifier_fail_audit() returns trigger language plpgsql as $$
        begin if new.detail->>'reason' = 'FAIL-AUDIT' then raise exception 'verifier audit failure'; end if; return new; end $$`);
      await m.ctx.q(`create trigger verifier_fail_audit before insert on public.finance_audit_log for each row execute function public.verifier_fail_audit()`);
      const r = await m.ctx.rpc(T.a, U.ownerA, p.id, "provisional", "rejected", "FAIL-AUDIT");
      const st = (await m.ctx.ref(p.id)).bonus_status;
      effect = r.ok && st === "rejected" && (await m.ctx.audits(p.id)).filter((a) => a.audit_type === "raf_bonus_status_changed").length === 0;
      caught = !(!r.ok && st === "provisional");
      await m.ctx.admin.end();
    }
    nc("NC10 audit failure swallowed → a decision commits with no audit row; B4C1-19 rejects", { effect, caught, detail: m.message ?? "" });
  }
  {
    const m = await mutantDb("nc11_competing", [
      ["  IF NEW.bonus_status IN ('completion_verified', 'earned', 'payment_approved', 'paid')\n     AND NEW.referred_user_id IS NOT NULL THEN", "  IF false THEN"],
    ]);
    let effect = false;
    let caught = false;
    if (m.ok) {
      const a = await m.ctx.claim("a1");
      const code = await m.ctx.one(`select id, code, referrer_user_id from public.referral_codes where id = $1`, [R.codeA2]);
      const second = randomUUID();
      await m.ctx.svc(
        `insert into public.referrals (id, referral_code_id, code, referrer_user_id, referred_user_id, status, bonus_status, tenant_id) values ($1,$2,$3,$4,$5,'signed_up','none',$6)`,
        [second, code.id, code.code, code.referrer_user_id, a.friendId, T.a],
      );
      await m.ctx.force(a.id, "earned", "qualified");
      await m.ctx.force(second, "paid", "rewarded");
      const r = await m.ctx.rpc(T.a, U.ownerA, a.id, "earned", "payment_approved", null);
      effect = r.ok;
      caught = !(!r.ok && /raf_competing_referral/.test(r.message ?? ""));
      await m.ctx.admin.end();
    }
    nc("NC11 no competing-referral rule → a second referrer's referral for an already-paid customer is approved for payment; B4C1-24 rejects", { effect, caught, detail: m.message ?? "" });
  }
  {
    const m = await mutantDb("nc12_codes", [], {});
    let effect = false;
    let caught = false;
    if (m.ok) {
      await m.ctx.q(`drop trigger referral_codes_guard on public.referral_codes`);
      const r = await m.ctx.svc(`insert into public.referral_codes (code, referrer_user_id, created_by, tenant_id) values ('FORGED02', $1, $2, $3)`, [U.custA, U.advA, T.a]);
      effect = r.ok;
      caught = !(!r.ok && /raf_referral_code_forbidden/.test(r.message ?? ""));
      await m.ctx.admin.end();
    }
    nc("NC12 referral codes without the guard trigger → an Adviser-created code crediting another customer is stored; B4C1-26 rejects", { effect, caught });
  }
  {
    const mod = await referralsMutant([[".select(\"id, code, status, bonus_status, created_at\")", ".select(\"id, code, referred_phone, status, bonus_status, created_at\")"]]);
    let effect = false;
    let caught = false;
    if (mod) {
      const r = await call(mod.listMyReferralActivity, {}, U.custA);
      effect = !r.ok || r.value.referrals.length === 0;
      caught = !(r.ok && r.value.referrals.length >= 3);
    }
    nc("NC13 activity query naming the nonexistent referred_phone column → the referrer's activity fails (the original bug); B4C1-27 rejects", { effect, caught });
  }
  {
    const mod = await referralsMutant([['      return { ok: false, reason: "tenant_unresolved" as const };', '      return { ok: false, reason: "invalid" as const };']]);
    let effect = false;
    let caught = false;
    if (mod) {
      const friend = `${db.name}NcClaim`;
      await db.addUser(friend);
      await db.addMember(friend, T.a, "customer");
      const r = await call(mod.claimReferral, { code: CODE.a1 }, U[friend], "unknown-firm");
      effect = r.ok && shouldClearCookie(r.value);
      caught = !(r.ok && r.value.reason === "tenant_unresolved" && !shouldClearCookie(r.value));
    }
    nc("NC14 claim reporting an unresolved tenant as invalid → home.tsx clears the cookie after a failed claim (the original bug); B4C1-25 rejects", { effect, caught });
  }

  await db.pool?.end();
  await db.admin.end();

  const ncPass = ncResults.filter((r) => r.pass).length;
  console.log(`TEST_CASES=${total}`);
  console.log(`TESTS_PASS=${total - failures.length}`);
  console.log(`NEGATIVE_CONTROL_COUNT=${ncResults.length}`);
  console.log(`NEGATIVE_CONTROLS_PASS=${ncPass}`);
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
