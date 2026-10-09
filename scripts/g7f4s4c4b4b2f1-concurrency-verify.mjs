/**
 * G7F-4S4C4-B4b2-F1 concurrency remediation — verification on a real PostgreSQL server.
 *
 * N1: set_commission_payout_status locked the accrual before the case while the Owner reversal,
 * clawback and reassignment RPCs lock the case before the accrual, so a payout change racing one of
 * them deadlocked (40P01). F1 (one forward-only migration) makes the payout RPC take the case lock
 * first. N2: updateReferralBonusStatus reported success when its conditional update matched no
 * row; it now reports "applied" only when it changed the row, "already_applied" only when every
 * requested value is already stored, and refuses a stale request.
 *
 * A disposable local PostgreSQL 17 server (embedded-postgres) hosts databases built from the B4b2
 * verifier's staging-shaped base schema and seed pattern plus the real G6B link policy and B3, B4a,
 * B4b1, B4b2 (and F1) migrations. Every concurrency scenario uses independent backend connections
 * (distinct server pids) released together, with lock waits observed in pg_stat_activity. The
 * referral server function runs unmodified through a fake PostgREST layer on a non-routable host
 * that serves every request on its own pooled connection and transaction.
 *
 * Negative controls: the same N1 scenarios against a database without F1 (the B4b2 payout RPC)
 * must deadlock / show the unsafe lock order; F1 without the case lock is refused by its own
 * postcondition; N2 mutants of the real referral source must let two conflicting requests both
 * claim success, and the corresponding predicates must reject them.
 *
 * Synthetic fixtures only: no network, no staging, no production, no real user, no real token.
 *
 * Dependencies: npm install --prefix /tmp/b4b2-conc embedded-postgres@17.6.0-beta.15 pg@8
 * Run: npm exec --yes --package=tsx -- tsx scripts/g7f4s4c4b4b2f1-concurrency-verify.mjs
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
const B4B2_SHA256 = "626dd41cdc15b5ef00f723f7581e9f93cc109829e0454cfbdb4be0161169fdfd";
const B4B2_BYTES = 131599;

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
// Roles are cluster-wide: created once per server, not per database.
const ROLES_SQL = "create role anon; create role authenticated; create role service_role bypassrls;";
if (!BASE_SCHEMA.trimStart().startsWith(ROLES_SQL)) throw new Error("BASE_SCHEMA role prelude changed");
const DB_SCHEMA = BASE_SCHEMA.replace(ROLES_SQL, "");
const sha256 = (s) => createHash("sha256").update(s, "utf8").digest("hex");

// The exact F1 change inside set_commission_payout_status (used for mutants and catalog checks).
const F1_LOCK_BLOCK = `  SELECT g.session_id INTO v_session FROM public.finance_ledger g
  WHERE g.id = p_event_id AND g.tenant_id = p_tenant_id AND g.event_type = 'commission_accrued';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'finance_resource_not_found' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_session IS NOT NULL THEN
    PERFORM 1 FROM public.interview_sessions s
    WHERE s.id = v_session AND s.tenant_id = p_tenant_id FOR UPDATE;
  END IF;
`;
const F1_DECL = "  v_session uuid;\n";

// --- module stubs (the referral server function runs unmodified) --------------------------------
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
export function getRequest() { return globalThis.__F1_REQUEST ?? null; }
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
export async function sendSms() { throw new Error("SMS refused in verifier"); }
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
const mutantMark = "/*b4b2f1-mutant:referrals*/";
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
const depDir = process.env.G7F4S4C4B4B2F1_PG_DIR || "/tmp/b4b2-conc";
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
// PostgREST returns int8 / numeric as JSON numbers and dates as YYYY-MM-DD.
pg.types.setTypeParser(20, Number);
pg.types.setTypeParser(1700, Number);
pg.types.setTypeParser(1082, (s) => s);

const DATA_DIR = mkdtempSync(join(tmpdir(), "g7f4s4c4b4b2f1-pg-"));
const PASSWORD = randomBytes(18).toString("hex");
const PORT = 56000 + Math.floor(Math.random() * 900);
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
      if (process.env.G7F4S4C4B4B2F1_DEBUG) orig(...a);
    }
  };
}

// --- fixtures (stable ids, the same subjects in every database) -------------------------------
const idProxy = () =>
  new Proxy({}, { get: (o, k) => (typeof k === "string" ? (o[k] ??= randomUUID()) : o[k]) });
const U = idProxy();
const I = idProxy();
const R = idProxy();
const T = { a: randomUUID(), b: randomUUID(), c: randomUUID() };
const SLUG = { a: "tenant-a", b: "tenant-b" };
const LEGACY_AT = "2026-09-01T09:00:00.000Z";
const LONG_AGO = "2020-01-01T00:00:00.000Z";
const WINTER = "2025-01-15";

/** A database at the staging post-B4b1 shape with the staging seed, then B4b2 and (optionally) F1. */
async function buildDb(name, { b4b2 = true, f1 = true, f1Text = f1Sql, fixtures = true } = {}) {
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
    await q(`insert into public.profiles (id, email, full_name) values ($1, $2, $3)`, [
      U[key],
      email,
      `${key} Person`,
    ]);
  };
  const addMember = (key, tenant, role) =>
    q(`insert into public.tenant_memberships (tenant_id, user_id, role) values ($1, $2, $3)`, [
      tenant,
      U[key],
      role,
    ]);
  const people = [
    ["ownerA", [[T.a, "owner"]]],
    ["ownerB", [[T.b, "owner"]]],
    ["supA", [[T.a, "supervisor"]]],
    ["genA", [[T.a, "general"]]],
    ["advA", [[T.a, "adviser"]]],
    ["advA2", [[T.a, "adviser"]]],
    ["advA3", [[T.a, "adviser"]]],
    ["advB", [[T.b, "adviser"]]],
    ["introDual", [[T.a, "introducer"], [T.b, "introducer"]]],
    ["intro2", [[T.a, "introducer"]]],
    ["custA", [[T.a, "customer"]]],
    ["custA2", [[T.a, "customer"]]],
    ["custB", [[T.b, "customer"]]],
    ["superOwner", []],
  ];
  for (const [key, ms] of people) {
    await addUser(key);
    for (const [t, r] of ms) await addMember(key, t, r);
  }
  await q(`insert into public.platform_roles (user_id, role) values ($1, 'super_owner')`, [U.superOwner]);
  for (const key of ["finance_network_statements", "finance_network_validate", "finance_customer", "finance_raf"]) {
    await q(
      `insert into public.admin_permissions (user_id, permission_key, access, tenant_id) values ($1,$2,'amend',$3)`,
      [U.genA, key, T.a],
    );
  }
  for (const [k, code, t] of [
    ["advA", "ADVA", T.a],
    ["advA2", "ADVA2", T.a],
    ["advA3", "ADVA3", T.a],
    ["advB", "ADVB", T.b],
  ]) {
    await q(`insert into public.advisor_profiles (user_id, code, tenant_id) values ($1,$2,$3)`, [U[k], code, t]);
  }
  const addIntroducer = (key, userKey, t, code, cname, slug) =>
    q(
      `insert into public.introducers (id, user_id, tenant_id, company_code, company_name, slug, active)
       values ($1,$2,$3,$4,$5,$6,true)`,
      [I[key], U[userKey], t, code, cname, slug],
    );
  await addIntroducer("dualA", "introDual", T.a, "1002", "Dual Alpha", "dual-a");
  await addIntroducer("dualB", "introDual", T.b, "2002", "Dual Bravo", "dual-b");
  for (const [id, cust, t, ref] of [
    [R.sessA1, "custA", T.a, "MG-B4B1-A1"],
    [R.sessB1, "custB", T.b, "MG-B4B1-B1"],
  ]) {
    await q(
      `insert into public.interview_sessions (id, customer_id, tenant_id, case_ref, created_at) values ($1,$2,$3,$4,$5)`,
      [id, U[cust], t, ref, LEGACY_AT],
    );
  }
  for (const [sess, adv, t] of [
    [R.sessA1, "advA", T.a],
    [R.sessB1, "advB", T.b],
  ]) {
    await q(
      `insert into public.session_advisors (id, session_id, advisor_id, assigned_by, created_at, tenant_id)
       values ($1,$2,$3,null,$4,$5)`,
      [randomUUID(), sess, U[adv], LEGACY_AT, t],
    );
  }
  await q(
    `insert into public.finance_fee_lines (id, session_id, fee_type, amount_pence, status, created_by, tenant_id, created_at, updated_at)
     values ($1,$2,'fee',50000,'draft',$3,$4,$5,$5)`,
    [R.draftA, R.sessA1, U.ownerA, T.a, LEGACY_AT],
  );
  await q(
    `insert into public.finance_audit_log (audit_type, summary, changed_by, created_at, tenant_id)
     values ('commission_rate','staging-synthetic',$1,$2,$3)`,
    [U.ownerA, LEGACY_AT, T.a],
  );
  await admin.query(b4aSql);
  await admin.query(b4b1Sql);
  const migration = { b4b2: null, f1: null };
  if (b4b2) migration.b4b2 = await outcome(() => admin.query(b4b2Sql));
  if (f1) migration.f1 = await outcome(() => admin.query(f1Text));

  const ctx = { name, cfg, connect, admin, q, one, migration };
  if (!fixtures || (b4b2 && !migration.b4b2.ok) || (f1 && !migration.f1.ok)) return ctx;

  await q(
    `insert into public.introducers (id, user_id, tenant_id, company_code, company_name, slug, active)
     values ($1,$2,$3,'1003','Second Intro','second-intro',true)`,
    [I.intro2, U.intro2, T.a],
  );
  await q(`update public.session_adviser_history_capture set started_at = $1`, [LONG_AGO]);
  await q(`insert into public.finance_settings (key, num_value, tenant_id) values ('raf_bonus_pence', 5000, $1)`, [T.a]);
  const fxTx = async (fn) => {
    const c = await connect();
    try {
      await c.query("begin");
      const r = await fn(c);
      await c.query("commit");
      return r;
    } catch (e) {
      await c.query("rollback");
      throw e;
    } finally {
      await c.end();
    }
  };
  const rate = (kind, subject, pct) =>
    fxTx(async (c) => {
      await c.query("set local session_replication_role = replica");
      await c.query(
        `insert into public.commission_rate_versions (tenant_id, subject_kind, introducer_id, adviser_user_id, adviser_role, fee_type, percentage, effective_from, created_by, source)
         values ($1,$2,$3,$4,$5,'fee',$6,$7,$8,'owner')`,
        [
          T.a,
          kind,
          kind === "introducer" ? I[subject] : null,
          kind === "adviser" ? U[subject] : null,
          kind === "adviser" ? "adviser" : null,
          pct,
          LONG_AGO,
          U.ownerA,
        ],
      );
    });
  await rate("adviser", "advA", 10);
  await rate("adviser", "advA2", 10);
  await rate("adviser", "advA3", 10);
  await rate("introducer", "dualA", 5);
  await rate("introducer", "intro2", 4);

  let caseN = 0;
  let monthN = 0;
  /** A tenant-A case with adviser history (advA, plus `extra`) and an introducer link. */
  ctx.newCase = async (introducer = "dualA", extra = []) => {
    caseN += 1;
    const cust = `${name}Cust${caseN}`;
    await addUser(cust);
    await addMember(cust, T.a, "customer");
    const id = randomUUID();
    await q(
      `insert into public.interview_sessions (id, customer_id, tenant_id, case_ref, created_at) values ($1,$2,$3,$4,$5)`,
      [id, U[cust], T.a, `MG-F1-${String(caseN).padStart(3, "0")}`, LEGACY_AT],
    );
    await fxTx(async (c) => {
      await c.query("set local session_replication_role = replica");
      for (const [k, cap] of [["advA", "adviser"], ...extra]) {
        await c.query(
          `insert into public.session_adviser_assignments (tenant_id, session_id, adviser_user_id, adviser_capacity, assigned_at, source)
           values ($1,$2,$3,$4,$5,'session_advisors_insert')`,
          [T.a, id, U[k], cap, LONG_AGO],
        );
      }
      if (introducer) {
        await c.query(
          `insert into public.customer_introducer_links (customer_id, introducer_id, source, created_at, effective_from, updated_at, tenant_id)
           values ($1,$2,'f1',$3,$3,$3,$4)`,
          [U[cust], I[introducer], LONG_AGO, T.a],
        );
      }
    });
    return { id, customer: U[cust] };
  };
  /** Validated statement with one allocated dated line per amount; fee lines through the B4b1 guard. */
  ctx.fees = (c, amounts, type = "fee") => {
    monthN += 1;
    const period = new Date(Date.UTC(2022, monthN, 1)).toISOString().slice(0, 10);
    return fxTx(async (x) => {
      const st = randomUUID();
      await x.query("set local session_replication_role = replica");
      await x.query(
        `insert into public.network_commission_statements (id, period_month, status, created_by, tenant_id) values ($1,$2,'draft',$3,$4)`,
        [st, period, U.ownerA, T.a],
      );
      const ids = [];
      let n = 0;
      for (const pence of amounts) {
        n += 1;
        const line = randomUUID();
        await x.query("set local session_replication_role = replica");
        await x.query(
          `insert into public.network_commission_lines (id, statement_id, line_no, case_ref, fee_type, amount_received_pence, allocation_status,
             matched_customer_id, matched_session_id, tenant_id, transaction_date, transaction_date_source, transaction_date_set_by, transaction_date_set_at)
           values ($1,$2,$3,'f1',$4,$5,'matched',$6,$7,$8,$9,'statement_parser',$10,now())`,
          [line, st, n, type, pence, c.customer, c.id, T.a, WINTER, U.ownerA],
        );
        await x.query("set local session_replication_role = origin");
        const fee = (
          await x.query(
            `insert into public.finance_fee_lines (session_id, fee_type, amount_pence, status, created_by, tenant_id, source_network_line_id)
             values ($1,$2,$3,'draft',$4,$5,$6) returning id, fee_event_date::text d`,
            [c.id, type, pence, U.ownerA, T.a, line],
          )
        ).rows[0];
        if (fee.d !== WINTER) throw new Error("guard did not derive the economic date");
        await x.query("set local session_replication_role = replica");
        await x.query(
          `update public.network_commission_lines set allocation_status='allocated', fee_line_id=$1, allocated_by=$2, allocated_at=now() where id=$3`,
          [fee.id, U.ownerA, line],
        );
        ids.push(fee.id);
      }
      await x.query(
        `update public.network_commission_statements set status='validated', validated_by=$1, validated_at=now() where id=$2`,
        [U.ownerA, st],
      );
      return ids;
    });
  };
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
  ctx.post = async (c, ids) => {
    const r = await ctx.svc(`select * from public.post_session_fees($1, $2, $3, $4::uuid[])`, [T.a, U.ownerA, c.id, ids]);
    if (!r.ok) throw new Error(`post: ${r.message}`);
  };
  ctx.accrualFor = (fee, role, user = null) =>
    one(
      `select * from public.finance_ledger where fee_line_id = $1 and event_type = 'commission_accrued'
         and beneficiary_role = $2 and ($3::uuid is null or beneficiary_user_id = $3) order by created_at desc limit 1`,
      [fee, role, user],
    );
  ctx.count = async (rel, where, params = []) =>
    Number((await one(`select count(*)::int n from ${rel} where ${where}`, params)).n);
  ctx.ledgerOf = (fee, type) => ctx.count("public.finance_ledger", "fee_line_id = $1 and event_type = $2", [fee, type]);
  ctx.payoutOf = async (id) => (await one(`select payout_status from public.finance_ledger where id = $1`, [id])).payout_status;
  /** A deadlock victim or refused call leaves no transition, audit or ledger trace of its own. */
  ctx.victimTrace = async (accId, feeId, rev) => {
    const pAudit = await ctx.count("public.finance_audit_log", "audit_type = 'payout_status_changed' and detail->>'event_id' = $1", [accId]);
    const pTrans = await ctx.count(
      "public.finance_payout_transitions",
      "ledger_event_id = $1 and from_status in ('received','rejected') and to_status in ('paid','rejected','received')",
      [accId],
    );
    const rAudit = await ctx.count("public.finance_audit_log", "audit_type = 'fee_reversed' and detail->>'fee_line_id' = $1", [feeId]);
    const cAudit = await ctx.count(
      "public.finance_audit_log",
      "audit_type in ('clawback','commission_reversed','commission_reassigned') and detail->>'accrual_event_id' = $1",
      [accId],
    );
    const cLedger = await ctx.count("public.finance_ledger", "original_event_id = $1", [accId]);
    return {
      clean: pAudit === pTrans && rAudit === rev && cAudit === cLedger,
      text: `payoutAudit=${pAudit}/${pTrans} reverseAudit=${rAudit}/${rev} cancelAudit=${cAudit}/${cLedger}`,
    };
  };
  /** A posted fee with a received adviser accrual (and introducer accrual when linked). */
  ctx.postedCase = async (introducer = null, pence = 70000) => {
    const c = await ctx.newCase(introducer);
    const [f] = await ctx.fees(c, [pence]);
    await ctx.post(c, [f]);
    return { c, f, adv: await ctx.accrualFor(f, "advisor"), intro: introducer ? await ctx.accrualFor(f, "introducer") : null };
  };
  return ctx;
}

// --- concurrency runners ------------------------------------------------------------------------
async function waitForLock(mon, pid, ms = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const r = await mon.query(`select wait_event_type from pg_stat_activity where pid = $1`, [pid]);
    if (r.rows[0]?.wait_event_type === "Lock") return true;
    await sleep(10);
  }
  return false;
}
/** Run each call in its own transaction on its own connection, committing as soon as it returns. */
function runTx(client, text, params) {
  return client.query(text, params).then(
    async (r) => {
      await client.query("commit");
      return { ok: true, rows: r.rows, rowCount: r.rowCount };
    },
    async (e) => {
      await client.query("rollback").catch(() => {});
      return { ok: false, code: e.code, message: e.message };
    },
  );
}
const stats = { rounds: 0, connections: 0, maxDistinct: 0, lockWaitRounds: 0, deadlocks: 0 };
/** N independent connections released together; optional hold before commit; lock waits monitored. */
async function race(ctx, calls, { hold = 0, account = true } = {}) {
  const clients = await Promise.all(calls.map(() => ctx.connect()));
  const pids = clients.map((c) => c.processID);
  const monitor = await ctx.connect();
  const waits = new Set();
  let monitoring = true;
  const mon = (async () => {
    while (monitoring) {
      const r = await monitor.query(
        `select pid, wait_event_type, wait_event from pg_stat_activity where pid = any($1)`,
        [pids],
      );
      for (const w of r.rows) if (w.wait_event_type === "Lock") waits.add(`${w.pid}:${w.wait_event}`);
      await sleep(5);
    }
  })();
  let release;
  const gate = new Promise((res) => (release = res));
  let ready = 0;
  const res = await Promise.all(
    clients.map(async (c, i) => {
      await c.query("begin");
      await c.query("set local role service_role");
      ready += 1;
      if (ready === clients.length) release();
      await gate;
      try {
        const r = await c.query(calls[i].sql, calls[i].params);
        if (hold) await c.query(`select pg_sleep($1)`, [hold / 1000]);
        await c.query("commit");
        return { ok: true, rows: r.rows, rowCount: r.rowCount };
      } catch (e) {
        await c.query("rollback").catch(() => {});
        return { ok: false, code: e.code, message: e.message };
      }
    }),
  );
  monitoring = false;
  await mon;
  await monitor.end();
  await Promise.all(clients.map((c) => c.end()));
  const r = {
    res,
    distinct: new Set(pids).size,
    lockWaits: waits.size,
    deadlocks: res.filter((x) => x.code === "40P01").length,
  };
  if (account) {
    stats.rounds += 1;
    stats.connections += r.distinct;
    stats.maxDistinct = Math.max(stats.maxDistinct, r.distinct);
    if (r.lockWaits > 0) stats.lockWaitRounds += 1;
    stats.deadlocks += r.deadlocks;
  }
  return r;
}
const short = (x) =>
  x.ok
    ? "ok"
    : x.code === "40P01"
      ? "DEADLOCK"
      : x.message.replace(/^.*?(finance_[a-z_]+|permission denied|duplicate key[^"]*"[^"]+").*$/s, "$1");
const summary = (r) => r.res.map(short).join(",");
const payoutCall = (event, to, actor = U.supA, note = null) => ({
  sql: `select public.set_commission_payout_status($1, $2, $3, $4, $5) as r`,
  params: [T.a, actor, event, to, note],
});
const reverseCall = (fee) => ({
  sql: `select * from public.reverse_posted_fee($1, $2, $3, 'f1 proof')`,
  params: [T.a, U.ownerA, fee],
});
const clawCall = (acc) => ({
  sql: `select * from public.claw_back_commission($1, $2, $3, 'f1 proof', null)`,
  params: [T.a, U.ownerA, acc],
});
const reassignCall = (acc, intro) => ({
  sql: `select * from public.reassign_introducer_commission($1, $2, $3, $4, 'f1 proof')`,
  params: [T.a, U.ownerA, acc, intro],
});
const MODES_FULL = [
  { hold: 400, rounds: 2 },
  { hold: 0, rounds: 4 },
];
const MODES_NC = [{ hold: 0, rounds: 4 }];
async function rounds(modes, fn) {
  let allPass = true;
  let deadlocks = 0;
  let lockWaitRounds = 0;
  let n = 0;
  const notes = [];
  for (const m of modes) {
    for (let i = 0; i < m.rounds; i += 1) {
      const r = await fn(m.hold);
      n += 1;
      deadlocks += r.race.deadlocks;
      if (r.race.lockWaits > 0) lockWaitRounds += 1;
      if (!r.pass) allPass = false;
      notes.push(`${m.hold ? "hold" : "free"}#${i + 1}[${r.race.distinct}conn,${r.race.lockWaits}waits]:${r.note}`);
    }
  }
  return { allPass, deadlocks, lockWaitRounds, n, note: notes.join(" | ") };
}

// --- N1 scenarios (run against the F1 database and, as negative controls, without F1) -----------
/** While the payout RPC waits for the accrual, does it already hold the case? (lock order probe) */
async function caseLockProbe(ctx) {
  const { c, adv } = await ctx.postedCase();
  const B = await ctx.connect();
  const P = await ctx.connect();
  const M = await ctx.connect();
  try {
    await B.query("begin");
    await B.query(`select 1 from public.finance_ledger where id = $1 for update`, [adv.id]);
    await P.query("begin");
    await P.query("set local role service_role");
    const pRun = runTx(P, payoutCall(adv.id, "paid").sql, payoutCall(adv.id, "paid").params);
    const waiting = await waitForLock(M, P.processID);
    await M.query("begin");
    const probe = await outcome(() =>
      M.query(`select 1 from public.interview_sessions where id = $1 for update nowait`, [c.id]),
    );
    await M.query("rollback");
    await B.query("rollback");
    const pr = await pRun;
    const st = await ctx.payoutOf(adv.id);
    return {
      waiting,
      caseLocked: !probe.ok && probe.code === "55P03",
      pr,
      st,
      pass: waiting && !probe.ok && probe.code === "55P03" && pr.ok && st === "paid",
    };
  } finally {
    await Promise.all([B.end(), P.end(), M.end()]);
  }
}
/**
 * Deterministic interleaving of the previously reproducible deadlock: the Owner reversal holds the
 * case and is parked on the fee line; the payout change then starts; the fee line is released.
 */
async function reverseInterleaving(ctx) {
  const { f, adv } = await ctx.postedCase();
  const B = await ctx.connect();
  const Rv = await ctx.connect();
  const P = await ctx.connect();
  const M = await ctx.connect();
  try {
    await B.query("begin");
    await B.query(`select 1 from public.finance_fee_lines where id = $1 for share`, [f]);
    await Rv.query("begin");
    await Rv.query("set local role service_role");
    const rRun = runTx(Rv, reverseCall(f).sql, reverseCall(f).params);
    const rWaiting = await waitForLock(M, Rv.processID);
    await P.query("begin");
    await P.query("set local role service_role");
    const pRun = runTx(P, payoutCall(adv.id, "paid").sql, payoutCall(adv.id, "paid").params);
    const pWaiting = await waitForLock(M, P.processID);
    await B.query("rollback");
    const [rr, pr] = await Promise.all([rRun, pRun]);
    const st = await ctx.payoutOf(adv.id);
    const cancels = await ctx.q(`select event_type from public.finance_ledger where original_event_id = $1`, [adv.id]);
    const rev = await ctx.ledgerOf(f, "fee_reversed");
    const trace = await ctx.victimTrace(adv.id, f, rev);
    const deadlock = rr.code === "40P01" || pr.code === "40P01";
    const consistent =
      (st === "reversed" && rev === 1 && cancels.length === 1 && cancels[0].event_type === "commission_reversed") ||
      (st === "paid" && rev === 1 && cancels.length === 1 && cancels[0].event_type === "clawback") ||
      (st === "paid" && rev === 0 && cancels.length === 0);
    return {
      deadlock,
      pass:
        rWaiting &&
        pWaiting &&
        !deadlock &&
        rr.ok &&
        !pr.ok &&
        /finance_payout_terminal/.test(pr.message ?? "") &&
        st === "reversed" &&
        consistent &&
        trace.clean,
      note: `reverse=${short(rr)} payout=${short(pr)} payout_status=${st} cancel=${cancels.map((x) => x.event_type).join(",")} ${trace.text}`,
    };
  } finally {
    await Promise.all([B.end(), Rv.end(), P.end(), M.end()]);
  }
}
async function paidVsReverse(ctx, hold) {
  const { f, adv } = await ctx.postedCase();
  const r = await race(ctx, [payoutCall(adv.id, "paid"), reverseCall(f)], { hold });
  const st = await ctx.payoutOf(adv.id);
  const cancels = await ctx.q(`select event_type from public.finance_ledger where original_event_id = $1`, [adv.id]);
  const rev = await ctx.ledgerOf(f, "fee_reversed");
  const okState =
    (st === "paid" && cancels.length === (rev ? 1 : 0) && (rev === 0 || cancels[0].event_type === "clawback")) ||
    (st === "reversed" && rev === 1 && cancels.length === 1 && cancels[0].event_type === "commission_reversed");
  const trace = await ctx.victimTrace(adv.id, f, rev);
  return { race: r, pass: okState && trace.clean && r.deadlocks === 0, note: `${summary(r)} payout=${st} fee_reversed=${rev} ${trace.text}` };
}
async function paidVsClawback(ctx, hold) {
  const { f, adv } = await ctx.postedCase();
  const r = await race(ctx, [payoutCall(adv.id, "paid"), clawCall(adv.id)], { hold });
  const st = await ctx.payoutOf(adv.id);
  const cb = await ctx.count("public.finance_ledger", "original_event_id = $1 and event_type = 'clawback'", [adv.id]);
  const trace = await ctx.victimTrace(adv.id, f, 0);
  const okState = (st === "paid" && cb <= 1) || (st === "received" && cb === 0);
  return { race: r, pass: okState && trace.clean && r.deadlocks === 0, note: `${summary(r)} payout=${st} clawbacks=${cb} ${trace.text}` };
}
async function rejectVsReassign(ctx, hold) {
  const { f, intro } = await ctx.postedCase("dualA", 60000);
  const r = await race(ctx, [payoutCall(intro.id, "rejected"), reassignCall(intro.id, I.intro2)], { hold });
  const st = await ctx.payoutOf(intro.id);
  const re = await ctx.count("public.finance_ledger", "original_event_id = $1 and event_type = 'commission_reassigned'", [intro.id]);
  const newAcc = await ctx.count(
    "public.finance_ledger",
    "fee_line_id = $1 and event_type = 'commission_accrued' and beneficiary_user_id = $2",
    [f, U.intro2],
  );
  const trace = await ctx.victimTrace(intro.id, f, 0);
  const okState = (st === "reversed" && re === 1 && newAcc === 1) || (st === "rejected" && re === 0 && newAcc === 0);
  return { race: r, pass: okState && trace.clean && r.deadlocks === 0, note: `${summary(r)} payout=${st} reassigned=${re} newAccrual=${newAcc} ${trace.text}` };
}
/** Owner clawback of a paid commission vs a payout change of the other accrual on the same case. */
async function crossAccrualMix(ctx, hold) {
  const { f, adv, intro } = await ctx.postedCase("dualA", 80000);
  await ctx.svc(payoutCall(adv.id, "paid", U.ownerA).sql, payoutCall(adv.id, "paid", U.ownerA).params);
  const r = await race(ctx, [clawCall(adv.id), payoutCall(intro.id, "paid"), reverseCall(f)], { hold });
  const advSt = await ctx.payoutOf(adv.id);
  const introSt = await ctx.payoutOf(intro.id);
  const cbAdv = await ctx.count("public.finance_ledger", "original_event_id = $1 and event_type = 'clawback'", [adv.id]);
  const introCancels = await ctx.count("public.finance_ledger", "original_event_id = $1", [intro.id]);
  const rev = await ctx.ledgerOf(f, "fee_reversed");
  const okState =
    advSt === "paid" &&
    cbAdv === 1 &&
    rev === 1 &&
    ((introSt === "reversed" && introCancels === 1) || (introSt === "paid" && introCancels === 1));
  return {
    race: r,
    pass: okState && r.deadlocks === 0,
    note: `${summary(r)} adviser=${advSt}/clawbacks=${cbAdv} introducer=${introSt}/cancels=${introCancels} fee_reversed=${rev}`,
  };
}
/** Owner settlement of a due clawback vs a payout change and a fee reversal on the same case. */
async function settleMix(ctx, hold) {
  const { f, adv, intro } = await ctx.postedCase("dualA", 80000);
  await ctx.svc(payoutCall(adv.id, "paid", U.ownerA).sql, payoutCall(adv.id, "paid", U.ownerA).params);
  const cb = (await ctx.svc(clawCall(adv.id).sql, clawCall(adv.id).params)).rows[0].clawback_event_id;
  const r = await race(
    ctx,
    [
      { sql: `select public.settle_commission_clawback($1, $2, $3, 'settled', 'f1 proof') as r`, params: [T.a, U.ownerA, cb] },
      payoutCall(intro.id, "rejected"),
      reverseCall(f),
    ],
    { hold },
  );
  const rec = await ctx.count("public.finance_ledger", "original_event_id = $1 and event_type = 'clawback_settled'", [cb]);
  const introSt = await ctx.payoutOf(intro.id);
  const rev = await ctx.ledgerOf(f, "fee_reversed");
  const advCancels = await ctx.count("public.finance_ledger", "original_event_id = $1", [adv.id]);
  const okState = rec === 1 && rev === 1 && advCancels === 1 && ["reversed", "rejected"].includes(introSt);
  return {
    race: r,
    pass: okState && r.deadlocks === 0 && r.res.every((x) => x.ok || /finance_payout_terminal|finance_fee_not_posted/.test(x.message)),
    note: `${summary(r)} settled=${rec} introducer=${introSt} fee_reversed=${rev} adviserCancels=${advCancels}`,
  };
}

// --- fake PostgREST over the pool (each request: own connection + transaction) -------------------
const FAKE_HOST = "g7f4s4c4b4b2f1.invalid";
const PUBLISHABLE = "sb_publishable_g7f4s4c4b4b2f1_not_a_real_key";
process.env.SUPABASE_URL = `http://${FAKE_HOST}`;
process.env.VITE_SUPABASE_URL = `http://${FAKE_HOST}`;
process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_secret_g7f4s4c4b4b2f1_not_a_real_key";
process.env.SUPABASE_PUBLISHABLE_KEY = PUBLISHABLE;
process.env.VITE_SUPABASE_PUBLISHABLE_KEY = PUBLISHABLE;
const USER_HEADER = "x-g7f4s4c4b4b2f1-user";
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
  if (method === "GET") {
    const where = whereClause(params, args);
    const limit = sp.get("limit") ? ` limit ${Number(sp.get("limit"))}` : "";
    rows = await rsql(`select ${selectList(sp.get("select"))} from ${t}${where}${orderClause(sp.get("order"))}${limit}`, args);
  } else if (method === "PATCH") {
    const sets = Object.entries(body)
      .map(([c, v]) => `${qi(c)} = $${args.push(cellValue(v))}`)
      .join(", ");
    rows = await rsql(`update ${t} set ${sets}${whereClause(params, args)}${returning}`, args);
  } else {
    throw new Error(`fake postgrest: method ${method} not served by the F1 verifier`);
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
  if (!returning && method !== "GET") return new Response(null, { status: 204 });
  return json(rows, 200, { "content-range": `0-${Math.max(rows.length - 1, 0)}/*` });
}
let served = null;
const rest = { patchHoldMs: 0, barrier: null, patchPids: new Set(), patches: 0 };
/** Release PATCH requests together once `n` have arrived (both requests read before either writes). */
function armPatchBarrier(n) {
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
    throw new Error(`F1 fetch stub refused host ${url.hostname}`);
  }
  const method = String(init.method || (typeof input === "object" && input.method) || "GET").toUpperCase();
  const headers = new Headers(init.headers || (typeof input === "object" ? input.headers : undefined));
  const rawBody = init.body ?? null;
  const body = rawBody ? JSON.parse(typeof rawBody === "string" ? rawBody : String(rawBody)) : null;
  const userId = headers.get(USER_HEADER);
  if (!url.pathname.startsWith("/rest/v1/") || url.pathname.startsWith("/rest/v1/rpc/")) {
    unknownCalls.push(`${method} ${url.pathname}`);
    return json({ message: "unexpected" }, 500);
  }
  const table = url.pathname.slice("/rest/v1/".length);
  const isReferralPatch = method === "PATCH" && table === "referrals";
  if (isReferralPatch && rest.barrier) await rest.barrier.arrive();
  const c = await served.pool.connect();
  try {
    await c.query("begin");
    if (userId) await c.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId]);
    await c.query(`set local role ${userId ? "authenticated" : "service_role"}`);
    const res = await reqClient.run(c, () => restTable(method, table, url, headers, body));
    if (isReferralPatch) {
      rest.patches += 1;
      rest.patchPids.add(c.processID);
      if (rest.patchHoldMs) await c.query(`select pg_sleep($1)`, [rest.patchHoldMs / 1000]);
    }
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

// --- module under test --------------------------------------------------------------------------
const { createClient } = await import("@supabase/supabase-js");
const rf = await import("../src/lib/referrals.functions.ts");
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
  globalThis.__F1_REQUEST = new Request("http://app.invalid/_serverFn/x", {
    headers: { referer: `http://app.invalid/${slug}/admin` },
  });
  const supabase = createClient(`http://${FAKE_HOST}`, PUBLISHABLE, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { [USER_HEADER]: actor } },
  });
  return d.handler({ data: parsed, context: { userId: actor, claims: { sub: actor }, supabase } });
}
const call = (fn, data, actor, slug = SLUG.a) => outcome(() => invoke(fn, data, actor, slug));
const CONFLICT = "This referral bonus was changed by someone else. Refresh and try again.";

// --- N2 scenarios -------------------------------------------------------------------------------
async function newReferral(ctx, bonus, notes = null, tenantId = T.a) {
  const id = randomUUID();
  await ctx.q(
    `insert into public.referrals (id, referrer_user_id, referred_email, status, bonus_status, notes, tenant_id)
     values ($1, $2, $3, 'qualified', $4, $5, $6)`,
    [id, U.custA, `friend-${id.slice(0, 6)}@example.invalid`, bonus, notes, tenantId],
  );
  return id;
}
const referralOf = (ctx, id) =>
  ctx.one(`select bonus_status, notes, updated_at::text as u from public.referrals where id = $1`, [id]);
/** Two requests that both read the same bonus status, then write together on separate connections. */
async function referralRace(ctx, mod, reqs, { hold = 300 } = {}) {
  rest.patchPids = new Set();
  rest.patches = 0;
  rest.patchHoldMs = hold;
  const mon = await ctx.connect();
  let waits = 0;
  let monitoring = true;
  const watch = (async () => {
    while (monitoring) {
      const r = await mon.query(
        `select count(*)::int n from pg_stat_activity where datname = current_database()
           and wait_event_type = 'Lock' and query ilike 'update "public"."referrals"%'`,
      );
      waits = Math.max(waits, r.rows[0].n);
      await sleep(5);
    }
  })();
  armPatchBarrier(reqs.length);
  const res = await Promise.all(reqs.map(([data, actor]) => call(mod.updateReferralBonusStatus, data, actor)));
  monitoring = false;
  await watch;
  await mon.end();
  rest.patchHoldMs = 0;
  return { res, pids: rest.patchPids.size, patches: rest.patches, lockWaits: waits };
}
const outcomeOf = (r) => (r.ok ? (r.value?.outcome ?? "ok-without-outcome") : r.message === CONFLICT ? "conflict" : `refused:${r.message}`);
async function conflictingRace(ctx, mod) {
  const id = await newReferral(ctx, "eligible");
  const r = await referralRace(ctx, mod, [
    [{ id, bonusStatus: "paid" }, U.ownerA],
    [{ id, bonusStatus: "rejected" }, U.supA],
  ]);
  const outs = r.res.map(outcomeOf);
  const claims = r.res.filter((x) => x.ok).length;
  const appliedIdx = outs.indexOf("applied");
  const fin = await referralOf(ctx, id);
  const rafLedger = await ctx.count("public.finance_ledger", "referral_id = $1", [id]);
  const winner = appliedIdx === 0 ? "paid" : appliedIdx === 1 ? "rejected" : null;
  return {
    r,
    claims,
    pass:
      claims === 1 &&
      outs.filter((o) => o === "applied").length === 1 &&
      outs.filter((o) => o === "conflict").length === 1 &&
      fin.bonus_status === winner &&
      rafLedger === 0 &&
      r.pids === 2 &&
      r.patches === 2,
    note: `${outs.join(",")} final=${fin.bonus_status} pids=${r.pids} lockWaits=${r.lockWaits}`,
  };
}
async function sameTargetRace(ctx, mod) {
  const id = await newReferral(ctx, "eligible");
  const r = await referralRace(ctx, mod, [
    [{ id, bonusStatus: "paid" }, U.ownerA],
    [{ id, bonusStatus: "paid" }, U.supA],
  ]);
  const outs = r.res.map(outcomeOf);
  const fin = await referralOf(ctx, id);
  return {
    r,
    pass:
      outs.filter((o) => o === "applied").length === 1 &&
      outs.filter((o) => o === "already_applied").length === 1 &&
      fin.bonus_status === "paid" &&
      r.pids === 2,
    note: `${outs.join(",")} final=${fin.bonus_status} pids=${r.pids} lockWaits=${r.lockWaits}`,
  };
}
async function reopenRace(ctx, mod) {
  const id = await newReferral(ctx, "rejected");
  const r = await referralRace(ctx, mod, [
    [{ id, bonusStatus: "eligible", notes: "Reason A: friend completed" }, U.ownerA],
    [{ id, bonusStatus: "eligible", notes: "Reason B: appeal upheld" }, U.supA],
  ]);
  const outs = r.res.map(outcomeOf);
  const claims = r.res.filter((x) => x.ok).length;
  const fin = await referralOf(ctx, id);
  const appliedIdx = outs.indexOf("applied");
  const winnerNotes = appliedIdx === 0 ? "Reason A: friend completed" : appliedIdx === 1 ? "Reason B: appeal upheld" : null;
  return {
    r,
    claims,
    pass:
      claims === 1 &&
      outs.filter((o) => o === "conflict").length === 1 &&
      fin.bonus_status === "eligible" &&
      fin.notes === winnerNotes,
    note: `${outs.join(",")} final=${fin.bonus_status} notes=${JSON.stringify(fin.notes)} pids=${r.pids}`,
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
  const fixed = await buildDb("f1_fixed");
  const noF1 = await buildDb("f1_without", { f1: false });
  ok(
    "F1-01 the approved B4b2 migration is unchanged (sha256 and bytes) and the F1 migration applies after it on a real PostgreSQL server",
    sha256(b4b2Sql) === B4B2_SHA256 &&
      Buffer.byteLength(b4b2Sql) === B4B2_BYTES &&
      fixed.migration.b4b2.ok &&
      fixed.migration.f1.ok &&
      noF1.migration.b4b2.ok,
    `PostgreSQL ${ver}; b4b2=${sha256(b4b2Sql).slice(0, 12)} f1=${sha256(f1Sql).slice(0, 12)} ${fixed.migration.f1.message ?? ""}`,
  );
  {
    const noB4b2 = await buildDb("f1_no_b4b2", { b4b2: false, fixtures: false });
    const again = await outcome(() => fixed.admin.query(f1Sql));
    ok(
      "F1-02 F1 fails closed without B4b2 (g7f4s4c4b4b2f1_precondition:b4b2_missing, no function created) and re-applying it is harmless",
      !noB4b2.migration.f1.ok &&
        /b4b2_missing/.test(noB4b2.migration.f1.message) &&
        (await noB4b2.one(`select to_regprocedure('public.set_commission_payout_status(uuid, uuid, uuid, text, text)') is null as gone`)).gone &&
        again.ok,
      `${noB4b2.migration.f1.message} | reapply=${again.ok ? "ok" : again.message}`,
    );
    await noB4b2.admin.end();
  }
  {
    const fnState = (ctx) =>
      ctx.q(
        `select p.proname, md5(p.prosrc) src, p.prosecdef, p.proconfig::text cfg, coalesce(p.proacl::text, '') acl, p.prosrc
         from pg_proc p where p.pronamespace = 'public'::regnamespace order by p.oid::regprocedure::text`,
      );
    const a = await fnState(fixed);
    const b = await fnState(noF1);
    const others = (rows) =>
      JSON.stringify(rows.filter((r) => r.proname !== "set_commission_payout_status").map(({ prosrc: _s, ...r }) => r));
    const fa = a.find((r) => r.proname === "set_commission_payout_status");
    const fb = b.find((r) => r.proname === "set_commission_payout_status");
    const stripped = fa.prosrc.replace(F1_LOCK_BLOCK, "").replace(F1_DECL, "");
    const catalog = (ctx) =>
      ctx.one(
        `select md5(coalesce(string_agg(x, '|' order by x), '')) h from (
           select c.relname || ':' || coalesce(c.relacl::text, '') || ':' || c.relrowsecurity::text x
             from pg_class c where c.relnamespace = 'public'::regnamespace
           union all select conrelid::regclass::text || ':' || conname || ':' || pg_get_constraintdef(oid)
             from pg_constraint where connamespace = 'public'::regnamespace
           union all select tablename || ':' || policyname || ':' || cmd || ':' || roles::text || ':' || coalesce(qual, '')
             from pg_policies where schemaname = 'public'
           union all select tgrelid::regclass::text || ':' || tgname || ':' || tgenabled::text
             from pg_trigger where not tgisinternal) s`,
      );
    ok(
      "F1-03 F1 replaces only set_commission_payout_status: identical SECURITY INVOKER, empty search_path and service_role-only ACL; its body differs from B4b2 only by the case lock; every other function and the table, constraint, policy and trigger catalog are byte-identical",
      !fa.prosecdef &&
        fa.cfg === fb.cfg &&
        fa.cfg === '{"search_path=\\"\\""}' &&
        fa.acl === fb.acl &&
        fa.src !== fb.src &&
        stripped === fb.prosrc &&
        others(a) === others(b) &&
        (await catalog(fixed)).h === (await catalog(noF1)).h,
      `cfg=${fa.cfg} acl=${fa.acl}`,
    );
  }

  // ---------------------------------------------------------------------------------------------
  // N1 — deadlock prevention
  // ---------------------------------------------------------------------------------------------
  const probe = await caseLockProbe(fixed);
  ok(
    "F1-04 lock order: while the payout RPC waits for the accrual it already holds the case (FOR UPDATE NOWAIT on the case is refused 55P03); the payout then completes",
    probe.pass,
    `waiting=${probe.waiting} caseLocked=${probe.caseLocked} payout=${short(probe.pr)} status=${probe.st}`,
  );
  const interleave = await reverseInterleaving(fixed);
  ok(
    "F1-05 the previously reproducible deadlock interleaving (Owner reversal holding the case, parked on the fee line; payout change started; fee line released) no longer deadlocks: the reversal commits, the payout is refused as terminal (reversed), no victim trace",
    interleave.pass,
    interleave.note,
  );
  const n1Races = [
    ["F1-06 payout paid vs Owner fee reversal (barrier races): no deadlock; paid→clawback or reversed (payout refused); victim leaves no trace", paidVsReverse],
    ["F1-07 payout paid vs Owner clawback of the same commission (barrier races): no deadlock; consistent outcome; victim leaves no trace", paidVsClawback],
    ["F1-08 payout rejected vs Owner introducer reassignment (barrier races): no deadlock; consistent outcome; victim leaves no trace", rejectVsReassign],
    ["F1-09 three-way mix on one case: Owner clawback of a paid adviser commission, payout of the introducer commission and fee reversal — no deadlock, one clawback, consistent", crossAccrualMix],
    ["F1-10 three-way mix on one case: Owner clawback settlement, payout change and fee reversal — no deadlock, one settlement, consistent", settleMix],
  ];
  let fixedN1Deadlocks = 0;
  for (const [label, fn] of n1Races) {
    const r = await rounds(MODES_FULL, (hold) => fn(fixed, hold));
    fixedN1Deadlocks += r.deadlocks;
    ok(label, r.allPass && r.deadlocks === 0 && r.lockWaitRounds > 0, `deadlocks=${r.deadlocks} lockWaitRounds=${r.lockWaitRounds}/${r.n} ${r.note}`);
  }

  // ---------------------------------------------------------------------------------------------
  // Preserved payout behaviour under F1
  // ---------------------------------------------------------------------------------------------
  {
    const { adv } = await fixed.postedCase();
    const gen = await fixed.svc(payoutCall(adv.id, "paid", U.genA).sql, payoutCall(adv.id, "paid", U.genA).params);
    const advr = await fixed.svc(payoutCall(adv.id, "paid", U.advA).sql, payoutCall(adv.id, "paid", U.advA).params);
    const other = await fixed.svc(`select public.set_commission_payout_status($1, $2, $3, 'paid', null) as r`, [T.b, U.ownerB, adv.id]);
    const otherOwner = await fixed.svc(payoutCall(adv.id, "paid", U.ownerB).sql, payoutCall(adv.id, "paid", U.ownerB).params);
    const asAuth = await outcome(async () => {
      const c = await fixed.connect();
      try {
        await c.query("begin");
        await c.query("set local role authenticated");
        return await c.query(payoutCall(adv.id, "paid", U.ownerA).sql, payoutCall(adv.id, "paid", U.ownerA).params);
      } finally {
        await c.query("rollback").catch(() => {});
        await c.end();
      }
    });
    const mid = await fixed.payoutOf(adv.id);
    const midTr = await fixed.count("public.finance_payout_transitions", "ledger_event_id = $1", [adv.id]);
    const sup = await fixed.svc(payoutCall(adv.id, "rejected", U.supA).sql, payoutCall(adv.id, "rejected", U.supA).params);
    const bare = await fixed.svc(payoutCall(adv.id, "received", U.ownerA).sql, payoutCall(adv.id, "received", U.ownerA).params);
    const reopen = await fixed.svc(
      payoutCall(adv.id, "received", U.ownerA, "Paperwork arrived").sql,
      payoutCall(adv.id, "received", U.ownerA, "Paperwork arrived").params,
    );
    const paid = await fixed.svc(payoutCall(adv.id, "paid", U.ownerA).sql, payoutCall(adv.id, "paid", U.ownerA).params);
    const back = await fixed.svc(payoutCall(adv.id, "received", U.ownerA, "undo").sql, payoutCall(adv.id, "received", U.ownerA, "undo").params);
    const rej = await fixed.svc(payoutCall(adv.id, "rejected", U.supA).sql, payoutCall(adv.id, "rejected", U.supA).params);
    const tr = await fixed.q(
      `select coalesce(from_status, '-') || '>' || to_status t, actor_role, reason from public.finance_payout_transitions
       where ledger_event_id = $1 order by recorded_at, txid`,
      [adv.id],
    );
    const fin = await fixed.payoutOf(adv.id);
    const upd = await fixed.svc(`update public.finance_payout_transitions set reason = 'x' where ledger_event_id = $1`, [adv.id]);
    const del = await fixed.svc(`delete from public.finance_payout_transitions where ledger_event_id = $1`, [adv.id]);
    const supUpd = await outcome(() => fixed.q(`update public.finance_payout_transitions set reason = 'x' where ledger_event_id = $1`, [adv.id]));
    ok(
      "F1-11 payout authority and tenant isolation preserved: General, adviser, another tenant's Owner and the authenticated role are refused with nothing written; Supervisor and Owner succeed",
      !gen.ok && /finance_forbidden/.test(gen.message) &&
        !advr.ok && /finance_forbidden/.test(advr.message) &&
        !other.ok && /finance_resource_not_found/.test(other.message) &&
        !otherOwner.ok && /finance_forbidden/.test(otherOwner.message) &&
        !asAuth.ok && /permission denied/.test(asAuth.message) &&
        mid === "received" && midTr === 1 && sup.ok && paid.ok,
      [gen, advr, other, otherOwner, asAuth].map((x) => (x.ok ? "ok" : short(x))).join(" | "),
    );
    ok(
      "F1-12 reopen reason, paid-terminal and immutable transition history preserved: rejected→received needs a reason; paid cannot move back or be rejected; transitions cannot be updated or deleted (service_role or superuser)",
      !bare.ok && /finance_reason_required/.test(bare.message) &&
        reopen.ok &&
        !back.ok && /finance_payout_terminal/.test(back.message) &&
        !rej.ok && /finance_payout_terminal/.test(rej.message) &&
        fin === "paid" &&
        tr.map((x) => x.t).join(",") === "->received,received>rejected,rejected>received,received>paid" &&
        tr[2].reason === "Paperwork arrived" &&
        !upd.ok && !del.ok && !supUpd.ok,
      `${tr.map((x) => `${x.t}(${x.actor_role})`).join(",")} | ${short(upd)} | ${short(del)} | ${supUpd.ok ? "ok" : supUpd.message}`,
    );
  }
  {
    const { adv } = await fixed.postedCase();
    const before = await fixed.count("public.finance_payout_transitions", "ledger_event_id = $1", [adv.id]);
    const auditBefore = await fixed.count("public.finance_audit_log", "audit_type = 'payout_status_changed'");
    await fixed.q(
      `alter table public.finance_audit_log add constraint f1_probe_refuse_payout_audit
         check (audit_type <> 'payout_status_changed') not valid`,
    );
    const r = await fixed.svc(payoutCall(adv.id, "paid").sql, payoutCall(adv.id, "paid").params);
    await fixed.q(`alter table public.finance_audit_log drop constraint f1_probe_refuse_payout_audit`);
    const st = await fixed.payoutOf(adv.id);
    const after = await fixed.count("public.finance_payout_transitions", "ledger_event_id = $1", [adv.id]);
    const auditAfter = await fixed.count("public.finance_audit_log", "audit_type = 'payout_status_changed'");
    const row = await fixed.one(`select payout_at, payout_by from public.finance_ledger where id = $1`, [adv.id]);
    ok(
      "F1-13 atomic rollback preserved: a failure at the final audit write rolls back the transition row and the ledger status change (still received, no payout_at/by, no audit)",
      !r.ok && r.code === "23514" && st === "received" && after === before && auditAfter === auditBefore && row.payout_at === null && row.payout_by === null,
      `${short(r)} status=${st} transitions=${before}->${after}`,
    );
  }

  // ---------------------------------------------------------------------------------------------
  // C1 regression on the F1 database (the B4b2 staging-gate scenarios, now with F1)
  // ---------------------------------------------------------------------------------------------
  const ctx = fixed;
  const c1 = [];
  c1.push([
    "same fee posted concurrently: one fee_posted, one accrual per beneficiary",
    async (hold) => {
      const c = await ctx.newCase();
      const [f1, f2] = await ctx.fees(c, [100000, 50000]);
      const p = (ids) => ({ sql: `select * from public.post_session_fees($1, $2, $3, $4::uuid[])`, params: [T.a, U.ownerA, c.id, ids] });
      const r = await race(ctx, [p([f1]), p([f1]), p([f1, f2]), p([f1])], { hold });
      const created = r.res.filter((x) => x.ok && x.rows.some((row) => row.fee_line_id === f1 && row.created)).length;
      const fp = await ctx.ledgerOf(f1, "fee_posted");
      const acc = await ctx.ledgerOf(f1, "commission_accrued");
      return { race: r, pass: created === 1 && fp === 1 && acc === 2 && r.deadlocks === 0, note: `${summary(r)} created=${created} fp=${fp} acc=${acc}` };
    },
  ]);
  c1.push([
    "same missing-rate exception resolved concurrently: one accrual",
    async (hold) => {
      const c = await ctx.newCase("intro2");
      const [f] = await ctx.fees(c, [80000], "mortgage_fee");
      await ctx.post(c, [f]);
      const exc = await ctx.one(`select id from public.finance_commission_exceptions where fee_line_id = $1 and status = 'open' order by created_at limit 1`, [f]);
      const x = { sql: `select * from public.resolve_commission_exception($1,$2,$3,'event_pct',7.5,null,'f1 proof')`, params: [T.a, U.ownerA, exc.id] };
      const r = await race(ctx, [x, x, x], { hold });
      const okN = r.res.filter((y) => y.ok).length;
      const accN = await ctx.count("public.finance_ledger", "exception_id = $1 and event_type = 'commission_accrued'", [exc.id]);
      return { race: r, pass: okN === 1 && accN === 1 && r.deadlocks === 0, note: `${summary(r)} accruals=${accN}` };
    },
  ]);
  c1.push([
    "same accrual reassigned concurrently: one reassignment, one new accrual",
    async (hold) => {
      const { f, intro } = await ctx.postedCase("dualA", 60000);
      const r = await race(ctx, [reassignCall(intro.id, I.intro2), reassignCall(intro.id, I.intro2), reassignCall(intro.id, I.intro2)], { hold });
      const re = await ctx.count("public.finance_ledger", "original_event_id = $1 and event_type = 'commission_reassigned'", [intro.id]);
      const na = await ctx.count("public.finance_ledger", "fee_line_id = $1 and event_type = 'commission_accrued' and beneficiary_user_id = $2", [f, U.intro2]);
      return { race: r, pass: r.res.filter((y) => y.ok).length === 1 && re === 1 && na === 1 && r.deadlocks === 0, note: `${summary(r)} reassigned=${re} new=${na}` };
    },
  ]);
  c1.push([
    "same posted fee reversed concurrently: one fee_reversed",
    async (hold) => {
      const { f } = await ctx.postedCase("dualA", 90000);
      const r = await race(ctx, [reverseCall(f), reverseCall(f), reverseCall(f)], { hold });
      const rev = await ctx.ledgerOf(f, "fee_reversed");
      const crev = await ctx.ledgerOf(f, "commission_reversed");
      return { race: r, pass: r.res.filter((y) => y.ok).length === 1 && rev === 1 && crev === 2 && r.deadlocks === 0, note: `${summary(r)} fee_reversed=${rev} commission_reversed=${crev}` };
    },
  ]);
  c1.push([
    "same reversed fee corrected concurrently: one correction inheriting the economic date",
    async (hold) => {
      const { f } = await ctx.postedCase(null, 90000);
      await ctx.svc(reverseCall(f).sql, reverseCall(f).params);
      const x = { sql: `select * from public.post_fee_correction($1,$2,$3,95000,'f1 proof','statement re-issue')`, params: [T.a, U.ownerA, f] };
      const r = await race(ctx, [x, x, x], { hold });
      const corr = await ctx.q(`select fee_event_date::text d, status::text s from public.finance_fee_lines where corrects_fee_line_id = $1`, [f]);
      return {
        race: r,
        pass: r.res.filter((y) => y.ok).length === 1 && corr.length === 1 && corr[0].d === WINTER && corr[0].s === "posted" && r.deadlocks === 0,
        note: `${summary(r)} corrections=${corr.length} date=${corr[0]?.d}`,
      };
    },
  ]);
  c1.push([
    "payout paid vs rejected vs paid concurrently (Owner/Supervisor): one transition from received",
    async (hold) => {
      const { adv } = await ctx.postedCase();
      const r = await race(ctx, [payoutCall(adv.id, "paid", U.ownerA), payoutCall(adv.id, "rejected"), payoutCall(adv.id, "paid")], { hold });
      const tr = await ctx.q(`select coalesce(from_status,'-') || '>' || to_status t from public.finance_payout_transitions where ledger_event_id = $1 order by recorded_at, txid`, [adv.id]);
      const st = await ctx.payoutOf(adv.id);
      return {
        race: r,
        pass: tr.length === 2 && tr[0].t === "->received" && tr[1].t.startsWith("received>") && tr[1].t.endsWith(st) && r.deadlocks === 0,
        note: `${summary(r)} ${tr.map((t) => t.t).join(";")} status=${st}`,
      };
    },
  ]);
  c1.push([
    "paid commission clawed back concurrently: one clawback, payment stays paid",
    async (hold) => {
      const { adv } = await ctx.postedCase();
      await ctx.svc(payoutCall(adv.id, "paid", U.ownerA).sql, payoutCall(adv.id, "paid", U.ownerA).params);
      const r = await race(ctx, [clawCall(adv.id), clawCall(adv.id), clawCall(adv.id)], { hold });
      const cb = await ctx.count("public.finance_ledger", "original_event_id = $1 and event_type = 'clawback'", [adv.id]);
      return { race: r, pass: cb === 1 && (await ctx.payoutOf(adv.id)) === "paid" && r.deadlocks === 0, note: `${summary(r)} clawbacks=${cb}` };
    },
  ]);
  c1.push([
    "clawback settled vs written off concurrently: one recovery outcome",
    async (hold) => {
      const { adv } = await ctx.postedCase();
      await ctx.svc(payoutCall(adv.id, "paid", U.ownerA).sql, payoutCall(adv.id, "paid", U.ownerA).params);
      const cb = (await ctx.svc(clawCall(adv.id).sql, clawCall(adv.id).params)).rows[0].clawback_event_id;
      const s = (o) => ({ sql: `select public.settle_commission_clawback($1,$2,$3,$4,'f1 proof') as r`, params: [T.a, U.ownerA, cb, o] });
      const r = await race(ctx, [s("settled"), s("written_off")], { hold });
      const rec = await ctx.count("public.finance_ledger", "original_event_id = $1 and event_type in ('clawback_settled','clawback_written_off')", [cb]);
      return { race: r, pass: rec === 1 && r.res.filter((y) => y.ok).length === 1 && r.deadlocks === 0, note: `${summary(r)} recovery=${rec}` };
    },
  ]);
  c1.push([
    "same exception: event % vs no commission concurrently — one resolution",
    async (hold) => {
      const c = await ctx.newCase("intro2");
      const [f] = await ctx.fees(c, [80000], "mortgage_fee");
      await ctx.post(c, [f]);
      const exc = await ctx.one(`select id from public.finance_commission_exceptions where fee_line_id = $1 and status = 'open' order by created_at limit 1`, [f]);
      const r = await race(ctx, [
        { sql: `select * from public.resolve_commission_exception($1,$2,$3,'event_pct',6,null,'f1 proof')`, params: [T.a, U.ownerA, exc.id] },
        { sql: `select * from public.resolve_commission_exception($1,$2,$3,'no_commission',null,null,'f1 proof')`, params: [T.a, U.ownerA, exc.id] },
      ], { hold });
      const e = await ctx.one(`select resolution from public.finance_commission_exceptions where id = $1`, [exc.id]);
      const accN = await ctx.count("public.finance_ledger", "exception_id = $1", [exc.id]);
      const consistent = (e.resolution === "event_pct" && accN === 1) || (e.resolution === "no_commission" && accN === 0);
      return { race: r, pass: r.res.filter((y) => y.ok).length === 1 && consistent && r.deadlocks === 0, note: `${summary(r)} ${e.resolution} accruals=${accN}` };
    },
  ]);
  c1.push([
    "unproven adviser entitlement determined concurrently with different adviser sets — one outcome",
    async (hold) => {
      const c = await ctx.newCase(null, [["advA2", "adviser"], ["advA3", "adviser"], ["ownerA", "owner"]]);
      const [f] = await ctx.fees(c, [80000]);
      await ctx.post(c, [f]);
      const exc = await ctx.one(`select id from public.finance_commission_exceptions where fee_line_id = $1 and exception_kind = 'adviser_entitlement_unproven'`, [f]);
      const d = (ids) => ({ sql: `select * from public.resolve_commission_exception($1,$2,$3,'advisers_determined',null,$4::uuid[],'f1 proof')`, params: [T.a, U.ownerA, exc?.id, ids] });
      const r = await race(ctx, [d([U.advA]), d([U.advA2, U.advA3])], { hold });
      const e = await ctx.one(`select status, cardinality(resolution_adviser_ids) n from public.finance_commission_exceptions where id = $1`, [exc?.id]);
      const dets = await ctx.count("public.finance_commission_determinations", "source_exception_id = $1", [exc?.id]);
      return { race: r, pass: Boolean(exc) && r.res.filter((y) => y.ok).length === 1 && e.status === "resolved" && dets === e.n && r.deadlocks === 0, note: `${summary(r)} advisers=${e?.n} dets=${dets}` };
    },
  ]);
  let c1Pass = true;
  const c1Notes = [];
  for (const [label, fn] of c1) {
    const r = await rounds(MODES_FULL, fn);
    if (!r.allPass) c1Pass = false;
    c1Notes.push(`${label}: ${r.allPass ? "pass" : `FAIL ${r.note}`} (deadlocks=${r.deadlocks})`);
  }
  ok("F1-14 C1 regression with F1 (posting, accrual, reassignment, reversal, correction, payout, clawback, recovery, exception resolution): one permitted outcome each, no deadlock", c1Pass, c1Notes.join(" | "));
  {
    const inv = await ctx.one(`select
      (select count(*) from (select fee_line_id from public.finance_ledger where event_type='fee_posted' group by 1 having count(*)>1) x)
      + (select count(*) from (select fee_line_id from public.finance_ledger where event_type='fee_reversed' group by 1 having count(*)>1) x)
      + (select count(*) from (select fee_line_id, beneficiary_role, beneficiary_user_id from public.finance_ledger where event_type='commission_accrued' group by 1,2,3 having count(*)>1) x)
      + (select count(*) from (select original_event_id from public.finance_ledger where event_type in ('commission_reversed','commission_reassigned','clawback') group by 1 having count(*)>1) x)
      + (select count(*) from (select original_event_id from public.finance_ledger where event_type in ('clawback_settled','clawback_written_off') group by 1 having count(*)>1) x) as duplicates,
      (select count(*) from public.finance_fee_lines f where f.status::text='posted' and not exists (select 1 from public.finance_ledger g where g.fee_line_id=f.id and g.event_type='fee_posted'))
      + (select count(*) from public.finance_fee_lines f where f.status::text='amended' and not exists (select 1 from public.finance_ledger g where g.fee_line_id=f.id and g.event_type='fee_reversed'))
      + (select count(*) from public.finance_ledger g where g.event_type='commission_accrued' and g.payout_status is distinct from (select t.to_status from public.finance_payout_transitions t where t.ledger_event_id=g.id and t.transition_kind='payout' order by t.recorded_at desc, t.txid desc limit 1))
      + (select count(*) from public.finance_ledger g where g.event_type='clawback' and exists (select 1 from public.finance_ledger a where a.id=g.original_event_id and a.payout_status<>'paid'))
      + (select count(*) from public.finance_ledger g where g.event_type='commission_accrued' and g.payout_status in ('paid','rejected')
           and not exists (select 1 from public.finance_audit_log a where a.audit_type='payout_status_changed' and a.detail->>'event_id'=g.id::text)) as partial,
      (select count(*) from public.finance_ledger where referral_id is not null or beneficiary_role='referrer') as raf_rows,
      (select count(*) from public.finance_ledger g join public.finance_fee_lines f on f.id=g.fee_line_id where g.tenant_id<>f.tenant_id) as cross_tenant`);
    ok(
      "F1-15 global invariants on the F1 database: no duplicate financial effect, no partial commit or lost payout transition, no RAF ledger row, no cross-tenant link, and no deadlock in any race",
      Number(inv.duplicates) === 0 && Number(inv.partial) === 0 && Number(inv.raf_rows) === 0 && Number(inv.cross_tenant) === 0 && stats.deadlocks === 0 && fixedN1Deadlocks === 0,
      `${JSON.stringify(inv)} deadlocks=${stats.deadlocks}`,
    );
  }
  const fixedStats = { ...stats };
  ok(
    "F1-16 genuine concurrency: independent backend connections (distinct server pids) with lock waits observed",
    fixedStats.maxDistinct >= 2 && fixedStats.lockWaitRounds > 0,
    JSON.stringify(fixedStats),
  );

  // ---------------------------------------------------------------------------------------------
  // N2 — honest RAF bonus update outcome (real server function, independent connections)
  // ---------------------------------------------------------------------------------------------
  served = { pool: new pg.Pool({ ...fixed.cfg, max: 12 }) };
  served.pool.on("error", () => {});
  {
    const runs = [];
    for (let i = 0; i < 4; i += 1) runs.push(await conflictingRace(fixed, rf));
    ok(
      "F1-17 conflicting simultaneous RAF updates (Owner paid vs Supervisor rejected, both read 'eligible', written together on separate connections): exactly one applied, the other refused as stale; the stored status is the winner's; no ledger row",
      runs.every((r) => r.pass),
      runs.map((r) => r.note).join(" | "),
    );
  }
  {
    const runs = [];
    for (let i = 0; i < 3; i += 1) runs.push(await sameTargetRace(fixed, rf));
    ok(
      "F1-18 identical simultaneous RAF updates (both paid): one applied, the other already_applied (never two applications)",
      runs.every((r) => r.pass),
      runs.map((r) => r.note).join(" | "),
    );
  }
  {
    const runs = [];
    for (let i = 0; i < 3; i += 1) runs.push(await reopenRace(fixed, rf));
    ok(
      "F1-19 simultaneous reopen of a rejected bonus with different reasons: one applied with its reason stored; the other refused as stale (its reason was not saved)",
      runs.every((r) => r.pass),
      runs.map((r) => r.note).join(" | "),
    );
  }
  {
    const id = await newReferral(fixed, "paid", "Paid by bank transfer");
    const before = await referralOf(fixed, id);
    const replay = await call(rf.updateReferralBonusStatus, { id, bonusStatus: "paid" }, U.ownerA);
    const after = await referralOf(fixed, id);
    const undo = await call(rf.updateReferralBonusStatus, { id, bonusStatus: "eligible", notes: "undo" }, U.ownerA);
    const noneId = await newReferral(fixed, "none");
    const first = await call(rf.updateReferralBonusStatus, { id: noneId, bonusStatus: "eligible" }, U.genA);
    const second = await call(rf.updateReferralBonusStatus, { id: noneId, bonusStatus: "eligible" }, U.genA);
    ok(
      "F1-20 explicit idempotent replay: re-requesting the stored status returns already_applied and writes nothing (updated_at unchanged); a real change returns applied; paid stays final",
      replay.ok && replay.value.outcome === "already_applied" && after.u === before.u &&
        !undo.ok && (await referralOf(fixed, id)).bonus_status === "paid" &&
        first.ok && first.value.outcome === "applied" && second.ok && second.value.outcome === "already_applied",
      `${outcomeOf(replay)} | ${outcomeOf(undo)} | ${outcomeOf(first)} | ${outcomeOf(second)}`,
    );
  }
  {
    const id = await newReferral(fixed, "eligible");
    const gPaid = await call(rf.updateReferralBonusStatus, { id, bonusStatus: "paid" }, U.genA);
    const gRej = await call(rf.updateReferralBonusStatus, { id, bonusStatus: "rejected" }, U.genA);
    const sRej = await call(rf.updateReferralBonusStatus, { id, bonusStatus: "rejected" }, U.supA);
    const bare = await call(rf.updateReferralBonusStatus, { id, bonusStatus: "eligible" }, U.ownerA);
    const gReopen = await call(rf.updateReferralBonusStatus, { id, bonusStatus: "eligible", notes: "General reopen" }, U.genA);
    const foreign = await call(rf.updateReferralBonusStatus, { id, bonusStatus: "paid" }, U.ownerB, SLUG.b);
    const fin = await referralOf(fixed, id);
    ok(
      "F1-21 RAF authority, reopen reason and tenant isolation preserved: General cannot mark paid/rejected or reopen; reopen needs a reason; another tenant's Owner gets Not found; nothing changes",
      !gPaid.ok && !gRej.ok && sRej.ok && sRej.value.outcome === "applied" && !bare.ok && /reason is required/.test(bare.message) &&
        !gReopen.ok && !foreign.ok && fin.bonus_status === "rejected",
      [gPaid, gRej, sRej, bare, gReopen, foreign].map(outcomeOf).join(" | "),
    );
  }
  ok("F1-22 no unexpected network or API calls", unknownCalls.length === 0, JSON.stringify(unknownCalls.slice(0, 5)));

  // =============================================================================================
  // NEGATIVE CONTROLS — each removes one F1 fix and shows the unsafe effect being caught
  // =============================================================================================
  {
    const r = await caseLockProbe(noF1);
    nc("NC01 without F1 the payout RPC waits for the accrual without holding the case (the deadlock-prone order); F1-04 rejects", {
      effect: r.waiting && !r.caseLocked,
      caught: r.pass === false,
      detail: `waiting=${r.waiting} caseLocked=${r.caseLocked}`,
    });
  }
  {
    const r = await reverseInterleaving(noF1);
    nc("NC02 without F1 the reversal / payout interleaving deadlocks (40P01); F1-05 rejects", {
      effect: r.deadlock,
      caught: r.pass === false,
      detail: r.note,
    });
  }
  {
    let deadlocks = 0;
    let anyFail = false;
    const notes = [];
    for (const [, fn] of n1Races.slice(0, 3)) {
      const r = await rounds(MODES_NC, (hold) => fn(noF1, hold));
      deadlocks += r.deadlocks;
      if (!(r.allPass && r.deadlocks === 0)) anyFail = true;
      notes.push(`deadlocks=${r.deadlocks}/${r.n}`);
    }
    nc("NC03 without F1 payout-vs-adjustment barrier races deadlock; F1-06/07/08 reject", {
      effect: deadlocks > 0,
      caught: anyFail,
      detail: notes.join(" "),
    });
  }
  {
    const mutantText = mutate(f1Sql, [[F1_LOCK_BLOCK, ""]]);
    const m = await buildDb("f1_mutant_postcondition", { f1Text: mutantText ?? "select 1/0", fixtures: false });
    const src = (await m.one(`select prosrc from pg_proc where oid = 'public.set_commission_payout_status(uuid, uuid, uuid, text, text)'::regprocedure`)).prosrc;
    nc("NC04 F1 without the case lock is refused by its own postcondition (case_lock_order) and leaves the B4b2 function in place; F1-01 rejects", {
      effect: Boolean(mutantText) && !m.migration.f1.ok,
      caught: /case_lock_order/.test(m.migration.f1.message ?? "") && !src.includes("v_session"),
      detail: m.migration.f1.message ?? "",
    });
    await m.admin.end();
  }
  {
    const mod = await referralsMutant([
      ['    if ((updated ?? []).length === 1) return { ok: true, outcome: "applied" as const };', '    return { ok: true, outcome: "applied" as const };'],
    ]);
    const r = mod ? await conflictingRace(fixed, mod) : null;
    nc("NC05 RAF row count ignored (the pre-F1 behaviour) → both conflicting requests claim success; F1-17 rejects", {
      effect: r?.claims === 2,
      caught: r?.pass === false,
      detail: r ? r.note : "anchor missing",
    });
  }
  {
    const mod = await referralsMutant([
      ["    throw new Error(REFERRAL_BONUS_CONFLICT_MESSAGE);\n  });", '    return { ok: true, outcome: "already_applied" as const };\n  });'],
    ]);
    const r = mod ? await conflictingRace(fixed, mod) : null;
    nc("NC06 stale request reported as already_applied → the losing conflicting request claims success; F1-17 rejects", {
      effect: r?.claims === 2,
      caught: r?.pass === false,
      detail: r ? r.note : "anchor missing",
    });
  }
  {
    const mod = await referralsMutant([
      ["    (patch.notes === undefined || (row.notes ?? null) === patch.notes)", "    true"],
    ]);
    const r = mod ? await reopenRace(fixed, mod) : null;
    nc("NC07 replay check ignores the reason → a reopen whose reason was never saved claims success; F1-19 rejects", {
      effect: r?.claims === 2,
      caught: r?.pass === false,
      detail: r ? r.note : "anchor missing",
    });
  }
  {
    const mod = await referralsMutant([
      [
        "    const unchanged = supabaseAdmin.from(\"referrals\").update(patch).eq(\"id\", data.id);\n    const scopedUpdate =\n      current === null ? unchanged.is(\"bonus_status\", null) : unchanged.eq(\"bonus_status\", current);",
        "    const scopedUpdate = supabaseAdmin.from(\"referrals\").update(patch).eq(\"id\", data.id);",
      ],
    ]);
    const r = mod ? await conflictingRace(fixed, mod) : null;
    nc("NC08 unconditional update (no bonus-status predicate) → both conflicting writes apply (last writer wins); F1-17 rejects", {
      effect: r?.claims === 2,
      caught: r?.pass === false,
      detail: r ? r.note : "anchor missing",
    });
  }

  await served.pool.end();
  await fixed.admin.end();
  await noF1.admin.end();

  const ncPass = ncResults.filter((r) => r.pass).length;
  console.log(`CONCURRENCY_STATS=${JSON.stringify(fixedStats)}`);
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
