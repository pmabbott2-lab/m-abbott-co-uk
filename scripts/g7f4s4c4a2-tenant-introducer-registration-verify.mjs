/**
 * G7F-4S4C4-A2 tenant-specific introducer registrations — offline verification.
 *
 * One Auth identity holds an independent introducer registration per tenant. The real
 * server-function validators and handlers (staff invites, A1 registration resolver, B1b admin
 * management, finance commission rates, Test Account grant) run against an in-process
 * PostgreSQL (PGlite, WASM) holding a stub of the staging schema with the real migrations applied
 * verbatim: G7F-4S3B (accept_staff_invite), G7F-4S4C4-A0 (introducer self-write grants) and the
 * A2 migration. The introducer and commission RLS policies are applied verbatim from G3C/G3D.
 * A fake PostgREST/Auth Admin layer on a non-routable host translates supabase-js calls into SQL;
 * user-client requests run as the `authenticated` role under RLS with the caller's auth.uid().
 * ensureStaffIntroducerRecord (module-private) is executed from its byte-identical source.
 *
 * Synthetic fixtures only: no network, no staging, no production, no real user, no real token.
 * Stubbed (not under test): MFA freshness, the Super Owner gate, and the platform/support
 * branches of the tenant RLS helpers (membership only).
 *
 * PGlite: npm install --prefix /tmp/g7f4s3b/pglite @electric-sql/pglite@0.5.8
 * Run: npm exec --yes --package=tsx -- tsx scripts/g7f4s4c4a2-tenant-introducer-registration-verify.mjs
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire, register } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash, randomBytes, randomUUID } from "node:crypto";

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
let ncTotal = 0;
let ncPass = 0;
function ok(name, cond, detail = "") {
  total += 1;
  if (name.startsWith("NC-")) {
    ncTotal += 1;
    if (cond) ncPass += 1;
  }
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
const sha256 = (s) => createHash("sha256").update(s, "utf8").digest("hex");
const errText = (r) => `${r?.message ?? ""} ${r?.code ?? ""}`;

const S3B_REL = "supabase/migrations/20260930210201_gate_g7f4s3b_staff_invite_identity_binding.sql";
const A0_REL =
  "supabase/migrations/20261003092928_gate_g7f4s4c4a0_introducer_self_write_boundary.sql";
const A2_REL =
  "supabase/migrations/20261005100000_gate_g7f4s4c4a2_tenant_introducer_registrations.sql";
const G3C_REL = "supabase/migrations/20260917200200_gate_g3c_business_tenant_rls.sql";
const G3D_REL = "supabase/migrations/20260917200300_gate_g3d_telephony_comms_finance_rls.sql";
const G7E2A_REL = "supabase/migrations/20260922190000_gate_g7e2a_platform_admins.sql";
const S3B_VERIFIER = "scripts/g7f4s3b-staff-invite-binding-verify.mjs";

const s3bSql = read(S3B_REL);
const a0Sql = read(A0_REL);
const a2Sql = read(A2_REL);
const g7e2a = read(G7E2A_REL);
const introPolicySql = read(G3C_REL).match(
  /DROP POLICY IF EXISTS "Introducers view and update own profile" ON public\.introducers;[\s\S]*?WITH CHECK \(user_id = auth\.uid\(\) AND public\.auth_can_access_tenant\(tenant_id\)\);/,
)?.[0];
const commissionPolicySql = read(G3D_REL).match(
  /DROP POLICY IF EXISTS "Admins read commission rates" ON public\.commission_rates;[\s\S]*?WITH CHECK \(public\.auth_is_tenant_admin\(tenant_id\)\);/,
)?.[0];
const fnBlock = (src, endMarker) => {
  const start = src.indexOf("CREATE OR REPLACE FUNCTION public.accept_staff_invite(");
  const end = src.indexOf(endMarker, start);
  return start >= 0 && end > start ? src.slice(start, end) : "";
};
const a2Function = fnBlock(a2Sql, "-- N. Exact");
const s3bFunction = fnBlock(s3bSql, "REVOKE ALL ON FUNCTION public.accept_staff_invite");

// --- module stubs: createServerFn capture + unrelated privileged gates -----------------------
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
const mfaReal = pathToFileURL(resolve(root, "src/lib/privileged-mfa.server.ts")).href;
const mfaStub = `
export * from ${JSON.stringify(mfaReal)};
export async function requireFreshPrivilegedAuth() {}
export async function requirePlatformAal2() {}
`;
const authorityReal = pathToFileURL(resolve(root, "src/lib/platform-authority.server.ts")).href;
const authorityStub = `
export * from ${JSON.stringify(authorityReal)};
export async function requireSuperOwner() { throw new Error("Super Owner required."); }
`;
const realStartServerUrl = import.meta.resolve("@tanstack/react-start/server");
const startServerStub = `
import * as real from ${JSON.stringify(realStartServerUrl)};
export * from ${JSON.stringify(realStartServerUrl)};
export function getRequest() {
  return globalThis.__g7f4s4c4a2Request !== undefined ? globalThis.__g7f4s4c4a2Request : real.getRequest();
}
`;
const mfaStubUrl = `data:text/javascript,${encodeURIComponent(mfaStub)}`;
const authorityStubUrl = `data:text/javascript,${encodeURIComponent(authorityStub)}`;
const stubs = {
  "@tanstack/react-start": `data:text/javascript,${encodeURIComponent(startStub)}`,
  "@tanstack/react-start/server": `data:text/javascript,${encodeURIComponent(startServerStub)}`,
  "@/lib/privileged-mfa.server": mfaStubUrl,
  [mfaReal]: mfaStubUrl,
  "@/lib/platform-authority.server": authorityStubUrl,
  [authorityReal]: authorityStubUrl,
};
const hookSource = `
const stubs = ${JSON.stringify(stubs)};
export async function resolve(specifier, context, next) {
  if (stubs[specifier] && !String(context.parentURL ?? "").startsWith("data:")) {
    return { url: stubs[specifier], shortCircuit: true };
  }
  return next(specifier, context);
}
`;
register(`data:text/javascript,${encodeURIComponent(hookSource)}`, import.meta.url);

// --- PGlite ---------------------------------------------------------------------------------
const pgliteDir = process.env.G7F4S3B_PGLITE_DIR || "/tmp/g7f4s3b/pglite";
let PGlite;
try {
  const req = createRequire(join(pgliteDir, "package.json"));
  ({ PGlite } = await import(pathToFileURL(req.resolve("@electric-sql/pglite")).href));
} catch (e) {
  console.error(`FAIL  PGlite not found in ${pgliteDir} (${e.message}). See header for install.`);
  process.exit(1);
}
let pg = null;
const sql = async (q, params = []) => (await pg.query(q, params)).rows;
const one = async (q, params = []) => (await sql(q, params))[0] ?? null;

const BASE_SCHEMA = `
create role anon; create role authenticated; create role service_role;
create schema auth;
grant usage on schema auth to anon, authenticated, service_role;
create table auth.users (
  id uuid primary key, email text, email_confirmed_at timestamptz,
  raw_app_meta_data jsonb not null default '{}', raw_user_meta_data jsonb not null default '{}',
  banned_until timestamptz, deleted_at timestamptz, is_anonymous boolean not null default false,
  created_at timestamptz not null default clock_timestamp()
);
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
  id uuid primary key references auth.users(id), email text, full_name text, phone text,
  tenant_id uuid, address text, created_at timestamptz not null default now()
);
create table public.user_roles (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id),
  role public.app_role not null, created_at timestamptz not null default now(), unique (user_id, role)
);
create table public.tenant_memberships (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id),
  user_id uuid not null references auth.users(id), role public.tenant_member_role not null,
  active boolean not null default true, created_by uuid, created_at timestamptz not null default now(),
  constraint tenant_memberships_user_tenant_role_unique unique (user_id, tenant_id, role)
);
create table public.admin_profiles (
  user_id uuid primary key references auth.users(id), level public.admin_level not null default 'general',
  tenant_id uuid, granted_by uuid, created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.admin_permissions (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id),
  permission_key text not null, access text not null, tenant_id uuid
);
create table public.advisor_profiles (
  user_id uuid primary key references auth.users(id), code text not null unique check (code ~ '^[A-Z0-9]{5}$'),
  deleted_at timestamptz, tenant_id uuid, created_at timestamptz not null default now()
);
-- staging shape of public.introducers (pre-A2 keys)
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
  constraint introducers_user_id_key unique (user_id),
  constraint introducers_slug_key unique (slug),
  constraint introducers_slug_format check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  constraint introducers_company_code_format check (company_code is null or company_code ~ '^[0-9]{4}$')
);
create index idx_introducers_company_code on public.introducers (company_code);
create index introducers_slug_idx on public.introducers (slug) where active;
create index introducers_tenant_id_idx on public.introducers (tenant_id);
alter table public.introducers enable row level security;
-- staging shape of public.commission_rates (pre-A2 keys)
create table public.commission_rates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('advisor','introducer')),
  percentage numeric not null default 0,
  updated_by uuid, updated_at timestamptz not null default now(),
  pct_fee numeric, pct_mortgage_fee numeric, pct_insurance_fee numeric, pct_other_fee numeric,
  tenant_id uuid references public.tenants(id),
  constraint commission_rates_user_id_role_key unique (user_id, role)
);
create index idx_commission_rates_user on public.commission_rates (user_id);
create index commission_rates_tenant_id_idx on public.commission_rates (tenant_id);
alter table public.commission_rates enable row level security;
create table public.commission_rate_history (
  id uuid primary key default gen_random_uuid(), user_id uuid, role text, fee_type text,
  pct_from numeric, pct_to numeric, changed_by uuid, tenant_id uuid,
  created_at timestamptz not null default now()
);
create table public.finance_audit_log (
  id uuid primary key default gen_random_uuid(), audit_type text, subject_user_id uuid, role text,
  fee_type text, summary text, detail jsonb, changed_by uuid, tenant_id uuid,
  created_at timestamptz not null default now()
);
create table public.customer_introducer_links (
  customer_id uuid primary key references auth.users(id) on delete cascade,
  introducer_id uuid not null references public.introducers(id) on delete cascade,
  source text, tenant_id uuid references public.tenants(id), created_at timestamptz not null default now()
);
create table public.introducer_leads (
  id uuid primary key default gen_random_uuid(),
  introducer_id uuid not null references public.introducers(id) on delete cascade,
  customer_name text not null, tenant_id uuid references public.tenants(id),
  created_at timestamptz not null default now()
);
create table public.appointments (
  id uuid primary key default gen_random_uuid(), advisor_id uuid not null references auth.users(id),
  introducer_id uuid references public.introducers(id), customer_id uuid references auth.users(id),
  tenant_id uuid references public.tenants(id), starts_at timestamptz not null
);
create table public.platform_roles (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id),
  role public.platform_role not null, created_by uuid, created_at timestamptz not null default now(),
  unique (user_id, role)
);
create table public.platform_break_glass_identities (user_id uuid primary key);

-- pre-G7F-4S3B staff_invitations shape
create table public.staff_invitations (
  id uuid primary key default gen_random_uuid(), token uuid not null unique default gen_random_uuid(),
  role public.app_role not null, email text, company_code text, company_name text,
  create_company boolean not null default false, created_by uuid,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '14 days'),
  used_at timestamptz, used_by uuid, tenant_id uuid references public.tenants(id),
  membership_role public.tenant_member_role,
  constraint staff_invitations_role_chk check (role in ('advisor','introducer','admin'))
);

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
create or replace function public.auth_can_access_tenant(p_tenant_id uuid) returns boolean
  language sql stable security definer set search_path = public as
  $$ select p_tenant_id is not null and auth.uid() is not null
       and public.has_tenant_membership(auth.uid(), p_tenant_id) $$;
create or replace function public.auth_is_tenant_staff(p_tenant_id uuid) returns boolean
  language sql stable security definer set search_path = public as
  $$ select p_tenant_id is not null and auth.uid() is not null and exists (
       select 1 from public.tenant_memberships m where m.user_id = auth.uid()
       and m.tenant_id = p_tenant_id and m.active and m.role in ('owner','supervisor','general','adviser')) $$;

-- Supabase default privileges for the API roles
grant all on all tables in schema public to anon, authenticated, service_role;
`;

const T = { a: randomUUID(), b: randomUUID() };
const SLUG = { a: "tenant-a", b: "tenant-b" };

/** A fresh database at the staging pre-A2 state (G3C/G3D policies, S3B, A0). */
async function freshDb({ withA2 = false } = {}) {
  pg = await PGlite.create();
  await pg.exec(BASE_SCHEMA);
  await pg.exec(introPolicySql);
  await pg.exec(commissionPolicySql);
  await pg.exec(g7e2a.slice(0, g7e2a.indexOf("-- Last Super Owner concurrency")));
  await pg.exec(s3bSql);
  await pg.exec(a0Sql);
  await sql(
    `insert into public.tenants (id, company_code, slug, company_name) values
     ($1,'901',$3,'Tenant A Ltd'), ($2,'902',$4,'Tenant B Ltd')`,
    [T.a, T.b, SLUG.a, SLUG.b],
  );
  if (withA2) await pg.exec(a2Sql);
  return pg;
}
async function addUser(email, fullName = null) {
  const id = randomUUID();
  await sql(`insert into auth.users (id, email, email_confirmed_at) values ($1, $2, now())`, [
    id,
    email,
  ]);
  await sql(`insert into public.profiles (id, email, full_name) values ($1,$2,$3)`, [
    id,
    email,
    fullName,
  ]);
  return id;
}
async function addMember(userId, tenantId, role, appRole) {
  await sql(`insert into public.tenant_memberships (tenant_id, user_id, role) values ($1,$2,$3)`, [
    tenantId,
    userId,
    role,
  ]);
  if (appRole) {
    await sql(
      `insert into public.user_roles (user_id, role) values ($1,$2) on conflict do nothing`,
      [userId, appRole],
    );
  }
}

// --- fake PostgREST + Auth Admin on PGlite ---------------------------------------------------
const FAKE_HOST = "g7f4s4c4a2.invalid";
const PUBLISHABLE = "sb_publishable_g7f4s4c4a2_not_a_real_key";
process.env.SUPABASE_URL = `http://${FAKE_HOST}`;
process.env.VITE_SUPABASE_URL = `http://${FAKE_HOST}`;
process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_secret_g7f4s4c4a2_not_a_real_key";
process.env.SUPABASE_PUBLISHABLE_KEY = PUBLISHABLE;
process.env.VITE_SUPABASE_PUBLISHABLE_KEY = PUBLISHABLE;
const USER_HEADER = "x-g7f4s4c4a2-user";

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
    e.code === "23505" ? 409 : e.code === "42501" ? 403 : 400,
  );
const RESERVED = new Set(["select", "order", "limit", "offset", "on_conflict", "columns"]);
const unknownCalls = [];

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
function whereClause(params, args) {
  const parts = [];
  for (const [key, raw] of params) {
    if (RESERVED.has(key)) continue;
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
    else if (op === "ilike") clause = `${col} ilike $${args.push(v)}`;
    else if (op === "like") clause = `${col} like $${args.push(v)}`;
    else if (op === "is") {
      if (!["null", "true", "false"].includes(v)) throw new Error(`fake postgrest: is.${v}`);
      clause = `${col} is ${v}`;
    } else if (op === "in") {
      const list = v
        .replace(/^\(|\)$/g, "")
        .split(",")
        .map((s) => s.trim().replace(/^"|"$/g, ""));
      clause = `${col}::text = any($${args.push(list)}::text[])`;
    } else throw new Error(`fake postgrest: unsupported filter ${key}=${raw}`);
    parts.push(negate ? `not (${clause})` : clause);
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
    rows = await sql(
      `select ${selectList(sp.get("select"))} from ${t}${where}${orderClause(sp.get("order"))}${limit}`,
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

/** User-client request: one transaction as `authenticated` with auth.uid() = userId (RLS + grants). */
async function asUserTx(userId, fn) {
  await pg.query("begin");
  try {
    await pg.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId]);
    await pg.query("set local role authenticated");
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

let chain = Promise.resolve();
async function handle(input, init) {
  const url = new URL(typeof input === "string" ? input : (input.url ?? String(input)));
  if (url.hostname !== FAKE_HOST) {
    unknownCalls.push(`refused host ${url.hostname}`);
    throw new Error(`G7F4S4C4A2 fetch stub refused host ${url.hostname}`);
  }
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
      if (userId) throw Object.assign(new Error("user rpc not modelled"), { code: "42501" });
      return await restRpc(url.pathname.slice("/rest/v1/rpc/".length), body);
    }
    if (url.pathname.startsWith("/rest/v1/")) {
      const run = () =>
        restTable(method, url.pathname.slice("/rest/v1/".length), url, headers, body);
      return userId ? await asUserTx(userId, run) : await run();
    }
    if (url.pathname.startsWith("/auth/v1/")) return await authAdmin(method, url);
  } catch (e) {
    if (e?.code) return pgError(e);
    unknownCalls.push(String(e?.message ?? e));
    return json({ code: "XX000", message: String(e?.message ?? e) }, 500);
  }
  unknownCalls.push(`${method} ${url.pathname}`);
  return json({ message: "unexpected" }, 500);
}
globalThis.fetch = (input, init = {}) => {
  const p = chain.then(() => handle(input, init));
  chain = p.catch(() => {});
  return p;
};

// --- quiet logs ----------------------------------------------------------------------------
for (const level of ["log", "info", "warn", "error", "debug"]) {
  const orig = console[level].bind(console);
  console[level] = (...a) => {
    const line = a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ");
    if (level === "error" && line.startsWith("FAIL  ")) orig(...a);
    else if (level === "log" && (line.startsWith("PASS  ") || line.startsWith("SUMMARY")))
      orig(...a);
    else if (process.env.G7F4S4C4A2_DEBUG) orig(...a);
  };
}

// --- modules under test ---------------------------------------------------------------------
const { createClient } = await import("@supabase/supabase-js");
const sf = await import("../src/lib/sessions.functions.ts");
const introFns = await import("../src/lib/introducer.functions.ts");
const finance = await import("../src/lib/finance.functions.ts");
const regSrv = await import("../src/lib/introducer-registration.server.ts");
const adminSrv = await import("../src/lib/introducer-admin.server.ts");
const inviteSrv = await import("../src/lib/staff-invite.server.ts");

// ensureStaffIntroducerRecord is module-private: run its byte-identical source in isolation.
const BOOKING_REL = "src/lib/booking.functions.ts";
const bookingSrc = read(BOOKING_REL);
const ensureStart = bookingSrc.indexOf("function slugifyStaffName(");
const ensureEnd = bookingSrc.indexOf("async function sendBookingConfirmations(");
const ensureSrc = bookingSrc.slice(ensureStart, ensureEnd);
const ensureDir = mkdtempSync(join(tmpdir(), "g7f4s4c4a2-"));
const ensureFile = join(ensureDir, "ensure-staff-introducer.ts");
writeFileSync(
  ensureFile,
  ensureSrc
    .replaceAll(
      '"@/integrations/supabase/client.server"',
      JSON.stringify(
        pathToFileURL(resolve(root, "src/integrations/supabase/client.server.ts")).href,
      ),
    )
    .replaceAll(
      '"@/lib/tenant-assert.server"',
      JSON.stringify(pathToFileURL(resolve(root, "src/lib/tenant-assert.server.ts")).href),
    ) + "\nexport { ensureStaffIntroducerRecord };\n",
);
const { ensureStaffIntroducerRecord } = await import(pathToFileURL(ensureFile).href);

const def = (fn) => fn.__def;
const users = new Map();
async function invoke(fn, data, actor) {
  const d = def(fn);
  const parsed = d.validator ? await d.validator(data) : data;
  const email = users.get(actor) ?? null;
  const supabase = createClient(`http://${FAKE_HOST}`, PUBLISHABLE, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { [USER_HEADER]: actor } },
  });
  return d.handler({
    data: parsed,
    context: { userId: actor, claims: { sub: actor, email }, supabase },
  });
}
const inTenant = (slug) => {
  globalThis.__g7f4s4c4a2Request = new Request(`http://localhost/${slug}/dashboard`);
};
const noTenant = () => {
  globalThis.__g7f4s4c4a2Request = new Request("http://localhost/dashboard");
};
async function user(email, fullName) {
  const id = await addUser(email, fullName);
  users.set(id, email);
  return id;
}
async function createInvite(actor, slug, data) {
  inTenant(slug);
  return invoke(sf.createStaffInvite, data, actor);
}
async function accept(userId, token) {
  noTenant();
  return invoke(sf.acceptStaffInvite, { token }, userId);
}
/** A staff_invitations row written directly (bypasses the create-time UI validation). */
async function rawInvite({
  tenantId,
  email,
  companyCode = null,
  createCompany = false,
  createdBy,
}) {
  const token = randomBytes(32).toString("base64url");
  await sql(
    `insert into public.staff_invitations
       (token_hash, role, membership_role, email, tenant_id, company_code, create_company, created_by)
     values ($1,'introducer','introducer',$2,$3,$4,$5,$6)`,
    [inviteSrv.hashStaffInviteToken(token), email, tenantId, companyCode, createCompany, createdBy],
  );
  return token;
}
const inviteRow = (token) =>
  one(`select * from public.staff_invitations where token_hash = $1`, [
    inviteSrv.hashStaffInviteToken(token),
  ]);
const regText = (id) =>
  one(`select i::text as t from public.introducers i where id = $1`, [id]).then(
    (r) => r?.t ?? null,
  );
const regOf = (userId, tenantId) =>
  one(`select * from public.introducers where user_id = $1 and tenant_id is not distinct from $2`, [
    userId,
    tenantId,
  ]);
const regCount = async (userId) =>
  (await one(`select count(*)::int as n from public.introducers where user_id = $1`, [userId])).n;
const introducerRoleCount = async (userId) =>
  (
    await one(
      `select count(*)::int as n from public.user_roles where user_id = $1 and role = 'introducer'`,
      [userId],
    )
  ).n;
const commText = (userId, tenantId) =>
  one(
    `select c::text as t from public.commission_rates c where user_id = $1 and role = 'introducer' and tenant_id is not distinct from $2`,
    [userId, tenantId],
  ).then((r) => r?.t ?? null);
const commAll = async () =>
  JSON.stringify(await sql(`select c::text as t from public.commission_rates c order by id`));
const attribution = async () =>
  JSON.stringify({
    links: await sql(
      `select l::text as t from public.customer_introducer_links l order by customer_id`,
    ),
    leads: await sql(`select l::text as t from public.introducer_leads l order by id`),
    appts: await sql(`select a::text as t from public.appointments a order by id`),
  });
async function asAuthenticated(userId, stmt, params = [], { keep = false } = {}) {
  await pg.query("begin");
  try {
    await pg.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId]);
    await pg.query("set local role authenticated");
    const r = await pg.query(stmt, params);
    await pg.query(keep ? "commit" : "rollback");
    return { ok: true, rows: r.rows, affected: r.affectedRows ?? r.rows.length };
  } catch (e) {
    await pg.query("rollback");
    return { ok: false, code: e.code, message: e.message };
  }
}
const catalog = async () => ({
  cons: await sql(
    `select conrelid::regclass::text as rel, conname, pg_get_constraintdef(oid) as def from pg_constraint
     where conrelid in ('public.introducers'::regclass, 'public.commission_rates'::regclass,
                        'public.user_roles'::regclass, 'public.tenant_memberships'::regclass)
     order by 1, 2`,
  ),
  idx: await sql(
    `select indexrelid::regclass::text as name, pg_get_indexdef(indexrelid) as def from pg_index
     where indrelid in ('public.introducers'::regclass, 'public.commission_rates'::regclass) order by 1`,
  ),
  pol: await sql(
    `select tablename, policyname, cmd, roles::text, qual, with_check from pg_policies
     where schemaname = 'public' and tablename in ('introducers','commission_rates','introducer_leads') order by 1, 2`,
  ),
  acl: await sql(
    `select relname, relacl::text from pg_class where oid in ('public.introducers'::regclass, 'public.commission_rates'::regclass) order by 1`,
  ),
  colacl: await sql(
    `select attname, attacl::text from pg_attribute where attrelid = 'public.introducers'::regclass
     and attnum > 0 and not attisdropped order by 1`,
  ),
  fn: await one(
    `select prosrc, prosecdef, proconfig::text as cfg, proacl::text as acl from pg_proc
     where proname = 'accept_staff_invite' and pronamespace = 'public'::regnamespace`,
  ),
});
const fnPrivs = () =>
  one(
    `select has_function_privilege('anon', 'public.accept_staff_invite(text,uuid,text,text,text,text,text)', 'EXECUTE') as anon,
            has_function_privilege('authenticated', 'public.accept_staff_invite(text,uuid,text,text,text,text,text)', 'EXECUTE') as authd,
            has_function_privilege('service_role', 'public.accept_staff_invite(text,uuid,text,text,text,text,text)', 'EXECUTE') as svc,
            (select prosecdef from pg_proc where proname = 'accept_staff_invite') as secdef,
            (select proconfig::text from pg_proc where proname = 'accept_staff_invite') as cfg,
            (select count(*)::int from pg_proc where proname = 'accept_staff_invite') as n`,
  );

ok(
  "A2-00 fixtures: policy blocks and accept_staff_invite blocks extracted from the real migrations",
  Boolean(introPolicySql && commissionPolicySql && a2Function && s3bFunction) &&
    a2Function.includes("i.user_id = p_user_id AND i.tenant_id = v_inv.tenant_id") &&
    /WHERE i\.user_id = p_user_id FOR UPDATE/.test(s3bFunction),
);

// =============================================================================================
// Main database: staging pre-A2 state
// =============================================================================================
await freshDb();
const U = {};
U.ownerA = await user("owner.a@example.test", "Owner A");
await addMember(U.ownerA, T.a, "owner", "admin");
U.ownerB = await user("owner.b@example.test", "Owner B");
await addMember(U.ownerB, T.b, "owner", "admin");
U.advA = await user("adviser.a@example.test", "Adviser A");
await addMember(U.advA, T.a, "adviser", "advisor");
U.advB = await user("adviser.b@example.test", "Adviser B");
await addMember(U.advB, T.b, "adviser", "advisor");
U.x = await user("x.introducer@example.test", "Xavier Introducer");
U.w = await user("w.introducer@example.test", "Wendy Introducer");
U.z = await user("z.decoy@example.test", "Zed Decoy");
U.v = await user("v.newcomer@example.test", "Vera Newcomer");
U.c1 = await user("c1.customer@example.test", "Customer One");
await addMember(U.c1, T.a, "customer", "customer");

// Registration A for X and W: the real invite flow, pre-A2.
for (const who of [U.x, U.w]) {
  const inv = await createInvite(U.ownerA, SLUG.a, {
    role: "introducer",
    email: users.get(who),
    companyMode: "new",
  });
  await accept(who, inv.token);
}
const regA = await regOf(U.x, T.a);
const regWA = await regOf(U.w, T.a);
// Historical attribution and the Tenant A commission relationship for registration A.
await sql(
  `insert into public.customer_introducer_links (customer_id, introducer_id, source, tenant_id) values ($1,$2,'referral',$3)`,
  [U.c1, regA.id, T.a],
);
await sql(
  `insert into public.introducer_leads (introducer_id, customer_name, tenant_id) values ($1,'Lead One',$2)`,
  [regA.id, T.a],
);
await sql(
  `insert into public.appointments (advisor_id, introducer_id, customer_id, tenant_id, starts_at) values ($1,$2,$3,$4, now())`,
  [U.advA, regA.id, U.c1, T.a],
);
inTenant(SLUG.a);
const rateA = await outcome(() =>
  invoke(
    finance.setCommissionRate,
    {
      userId: U.x,
      role: "introducer",
      pctFee: 15,
      pctMortgageFee: 12,
      pctInsuranceFee: 0,
      pctOtherFee: 0,
    },
    U.ownerA,
  ),
);
// Existing tenant-stamped adviser rates (staging holds two).
const adviserRates = [];
for (const [adv, owner, slug] of [
  [U.advA, U.ownerA, SLUG.a],
  [U.advB, U.ownerB, SLUG.b],
]) {
  inTenant(slug);
  adviserRates.push(
    await outcome(() =>
      invoke(
        finance.setCommissionRate,
        {
          userId: adv,
          role: "advisor",
          pctFee: 30,
          pctMortgageFee: 25,
          pctInsuranceFee: 20,
          pctOtherFee: 10,
        },
        owner,
      ),
    ),
  );
}
const adviserRows = () =>
  sql(`select c::text as t from public.commission_rates c where role = 'advisor' order by id`);
const adviserRowsPre = JSON.stringify(await adviserRows());
ok(
  "A2-00b pre-A2 setup: registration A (X, W) via real invite flow; Tenant A introducer rate and tenant-stamped adviser rates via real setCommissionRate",
  regA?.tenant_id === T.a &&
    regWA?.tenant_id === T.a &&
    rateA.ok &&
    (await commText(U.x, T.a)) !== null &&
    adviserRates.every((r) => r.ok) &&
    JSON.parse(adviserRowsPre).length === 2,
  rateA.message ?? adviserRates.find((r) => !r.ok)?.message ?? "",
);

// --- negative controls on the pre-A2 state --------------------------------------------------
{
  const inv = await createInvite(U.ownerB, SLUG.b, {
    role: "introducer",
    email: users.get(U.x),
    companyMode: "new",
  });
  const r = await outcome(() => accept(U.x, inv.token));
  ok(
    "NC-1 pre-A2 global UNIQUE(user_id) + user-only lookup: a second-tenant invite is refused (staff_invite_introducer_conflict), nothing written",
    !r.ok &&
      r.code === "staff_invite_introducer_conflict" &&
      (await regCount(U.x)) === 1 &&
      (await inviteRow(inv.token)).used_at === null,
    r.message ?? "",
  );
  const c = await outcome(() =>
    sql(
      `insert into public.commission_rates (user_id, role, percentage, tenant_id) values ($1,'introducer',20,$2)`,
      [U.x, T.b],
    ),
  );
  ok(
    "NC-3 old commission key UNIQUE(user_id, role): a Tenant B introducer rate for X cannot coexist with the Tenant A rate",
    !c.ok && c.code === "23505" && /commission_rates_user_id_role_key/.test(c.message),
  );
}

// =============================================================================================
// Apply the A2 migration
// =============================================================================================
const preCatalog = await catalog();
const preBusiness = JSON.stringify({
  intro: await sql(`select i::text from public.introducers i order by id`),
  comm: await commAll(),
  roles: await sql(`select r::text from public.user_roles r order by id`),
  mem: await sql(`select m::text from public.tenant_memberships m order by id`),
  attr: await attribution(),
});
const mig = await outcome(() => pg.exec(a2Sql));
const postCatalog = await catalog();
const postBusiness = JSON.stringify({
  intro: await sql(`select i::text from public.introducers i order by id`),
  comm: await commAll(),
  roles: await sql(`select r::text from public.user_roles r order by id`),
  mem: await sql(`select m::text from public.tenant_memberships m order by id`),
  attr: await attribution(),
});
const consOf = (cat, rel) =>
  cat.cons.filter((c) => c.rel === rel).map((c) => `${c.conname}=${c.def}`);
const introCons = consOf(postCatalog, "introducers");
const commCons = consOf(postCatalog, "commission_rates");
const privs = await fnPrivs();
const nullable = await sql(
  `select attrelid::regclass::text as rel, attnotnull from pg_attribute
   where attrelid in ('public.introducers'::regclass, 'public.commission_rates'::regclass) and attname = 'tenant_id'`,
);
ok("A2-29a migration applies cleanly in one pass", mig.ok, mig.message ?? "");
ok(
  "A2-29b introducer keys: UNIQUE(user_id) gone; UNIQUE NULLS NOT DISTINCT (tenant_id, user_id); UNIQUE (id, tenant_id); btree INDEX (user_id); UNIQUE (slug) kept; tenant_id nullable",
  !introCons.some((c) => c.startsWith("introducers_user_id_key=")) &&
    !introCons.some((c) => c.endsWith("=UNIQUE (user_id)")) &&
    introCons.includes(
      "introducers_tenant_id_user_id_key=UNIQUE NULLS NOT DISTINCT (tenant_id, user_id)",
    ) &&
    introCons.includes("introducers_id_tenant_id_key=UNIQUE (id, tenant_id)") &&
    introCons.includes("introducers_slug_key=UNIQUE (slug)") &&
    postCatalog.idx.some(
      (i) =>
        i.name === "introducers_user_id_idx" &&
        /^CREATE INDEX .* USING btree \(user_id\)$/.test(i.def),
    ) &&
    nullable.every((n) => n.attnotnull === false) &&
    nullable.length === 2,
);
ok(
  "A2-29c commission keys: UNIQUE(user_id, role) gone; UNIQUE NULLS NOT DISTINCT (tenant_id, user_id, role)",
  !commCons.some((c) => c.startsWith("commission_rates_user_id_role_key=")) &&
    commCons.includes(
      "commission_rates_tenant_id_user_id_role_key=UNIQUE NULLS NOT DISTINCT (tenant_id, user_id, role)",
    ),
);
ok(
  "A2-29d user_roles and tenant_memberships keys unchanged (no DDL)",
  JSON.stringify(consOf(preCatalog, "user_roles")) ===
    JSON.stringify(consOf(postCatalog, "user_roles")) &&
    JSON.stringify(consOf(preCatalog, "tenant_memberships")) ===
      JSON.stringify(consOf(postCatalog, "tenant_memberships")),
);
ok(
  "A2-29e RLS policies, table ACLs and A0 column grants unchanged",
  JSON.stringify(preCatalog.pol) === JSON.stringify(postCatalog.pol) &&
    JSON.stringify(preCatalog.acl) === JSON.stringify(postCatalog.acl) &&
    JSON.stringify(preCatalog.colacl) === JSON.stringify(postCatalog.colacl),
);
ok(
  "A2-29f accept_staff_invite: single overload, SECURITY DEFINER, search_path='', EXECUTE service_role only (grants identical to S3B)",
  privs.n === 1 &&
    privs.secdef === true &&
    privs.cfg === '{"search_path=\\"\\""}' &&
    !privs.anon &&
    !privs.authd &&
    privs.svc &&
    preCatalog.fn.acl === postCatalog.fn.acl,
  privs.cfg,
);
ok(
  "A2-29g business data unchanged by the migration (introducers, commission incl. existing adviser rates, roles, memberships, attribution — full row text)",
  preBusiness === postBusiness && JSON.stringify(await adviserRows()) === adviserRowsPre,
);
const rerun = await outcome(() => pg.exec(a2Sql));
ok(
  "A2-29h re-running the migration fails closed (old keys absent) and changes nothing",
  !rerun.ok &&
    /g7f4s4c4a2_precondition:old_key_missing_or_changed/.test(rerun.message) &&
    JSON.stringify(await catalog()) === JSON.stringify(postCatalog),
);

// =============================================================================================
// Second-tenant registration
// =============================================================================================
const rowA0 = await regText(regA.id);
const commA0 = await commText(U.x, T.a);
const attr0 = await attribution();
const inv21 = await createInvite(U.ownerB, SLUG.b, {
  role: "introducer",
  email: users.get(U.x),
  companyMode: "new",
});
const r21 = await outcome(() => accept(U.x, inv21.token));
const regB = await regOf(U.x, T.b);
const memX = await sql(
  `select tenant_id, role, active from public.tenant_memberships where user_id = $1 and role = 'introducer' order by tenant_id`,
  [U.x],
);
ok(
  "A2-21 second-tenant invite succeeds (invite consumed, Tenant B registration created)",
  r21.ok && regB !== null && (await inviteRow(inv21.token)).used_at !== null,
  r21.message ?? "",
);
ok(
  "A2-01 the same Auth identity holds a Tenant A and a Tenant B registration",
  (await regCount(U.x)) === 2 && regA.user_id === U.x && regB?.user_id === U.x,
);
ok("A2-03 registration ids differ", Boolean(regB) && regB.id !== regA.id);
ok(
  "A2-04 tenant ids differ (A = Tenant A, B = Tenant B)",
  regB?.tenant_id === T.b && regA.tenant_id === T.a,
);
ok(
  "A2-05 company codes independent (B has its own globally new 4-digit code; A's code unchanged)",
  /^[0-9]{4}$/.test(regB?.company_code ?? "") &&
    regB.company_code !== regA.company_code &&
    (
      await one(`select count(*)::int as n from public.introducers where company_code = $1`, [
        regB.company_code,
      ])
    ).n === 1,
);
const slugClash = await outcome(() =>
  sql(
    `insert into public.introducers (user_id, company_name, slug, tenant_id) values ($1,'Clash',$2,$3)`,
    [U.z, regA.slug, T.b],
  ),
);
ok(
  "A2-06 slugs independent and still globally unique (B has its own slug; reusing A's slug in Tenant B is refused)",
  Boolean(regB?.slug) &&
    regB.slug !== regA.slug &&
    !slugClash.ok &&
    /introducers_slug_key/.test(slugClash.message),
);
ok(
  "A2-12 tenant memberships exist independently (active introducer membership in Tenant A and Tenant B)",
  memX.length === 2 &&
    memX.every((m) => m.active) &&
    new Set(memX.map((m) => m.tenant_id)).size === 2,
);
ok("A2-13 exactly one global introducer role retained", (await introducerRoleCount(U.x)) === 1);

// same-tenant duplicates
const inv22 = await createInvite(U.ownerB, SLUG.b, {
  role: "introducer",
  email: users.get(U.x),
  companyMode: "new",
});
const r22 = await outcome(() => accept(U.x, inv22.token));
const regBAfterRefuse = await regText(regB.id);
const inv22b = await createInvite(U.ownerB, SLUG.b, {
  role: "introducer",
  email: users.get(U.x),
  companyMode: "join",
  companyCode: regB.company_code,
});
const r22b = await outcome(() => accept(U.x, inv22b.token));
const dupInsert = await outcome(() =>
  sql(
    `insert into public.introducers (user_id, company_name, slug, tenant_id) values ($1,'Dup','dup-x-b',$2)`,
    [U.x, T.b],
  ),
);
ok(
  "A2-22 duplicate same-tenant invite: new-company refused (company conflict, invite unconsumed); join reuses registration B",
  !r22.ok &&
    r22.code === "staff_invite_introducer_company_conflict" &&
    (await inviteRow(inv22.token)).used_at === null &&
    r22b.ok &&
    (await regText(regB.id)) === regBAfterRefuse &&
    (await regCount(U.x)) === 2,
  r22b.message ?? "",
);
ok(
  "A2-02 same-tenant duplicate registration blocked by UNIQUE NULLS NOT DISTINCT (tenant_id, user_id)",
  !dupInsert.ok &&
    dupInsert.code === "23505" &&
    /introducers_tenant_id_user_id_key/.test(dupInsert.message),
);
ok(
  "A2-07 registration A byte-identical after registration B is created and re-invited",
  (await regText(regA.id)) === rowA0,
);

// W: registration A binned before B exists; creating B must not reactivate it.
inTenant(SLUG.a);
const binW = await outcome(() =>
  invoke(sf.softDeleteIntroducer, { introducerId: regWA.id }, U.ownerA),
);
const rowWA = await regText(regWA.id);
const invW = await createInvite(U.ownerB, SLUG.b, {
  role: "introducer",
  email: users.get(U.w),
  companyMode: "new",
});
const rW = await outcome(() => accept(U.w, invW.token));
const regWB = await regOf(U.w, T.b);
const regWAnow = await regOf(U.w, T.a);
ok(
  "A2-08 registration A's lifecycle state unchanged (X's active A stays active; W's binned A stays binned when B is created)",
  (await regOf(U.x, T.a)).active === true &&
    binW.ok &&
    rW.ok &&
    (await regText(regWA.id)) === rowWA &&
    regWAnow.active === false &&
    regWAnow.deleted_at !== null &&
    regWB?.active === true &&
    regWB.id !== regWA.id,
  binW.message ?? rW.message ?? "",
);
ok(
  "A2-09 registration A's historical attribution unchanged (links, leads, appointments)",
  (await attribution()) === attr0,
);
ok(
  "A2-10 registration A's commission relationship unchanged (Tenant A rate byte-identical)",
  (await commText(U.x, T.a)) === commA0,
);

// =============================================================================================
// Commission per tenant
// =============================================================================================
inTenant(SLUG.b);
const rateB = await outcome(() =>
  invoke(
    finance.setCommissionRate,
    {
      userId: U.x,
      role: "introducer",
      pctFee: 20,
      pctMortgageFee: 18,
      pctInsuranceFee: 0,
      pctOtherFee: 0,
    },
    U.ownerB,
  ),
);
const getB = await outcome(() =>
  invoke(finance.getCommissionRate, { userId: U.x, role: "introducer" }, U.ownerB),
);
inTenant(SLUG.a);
const getA = await outcome(() =>
  invoke(finance.getCommissionRate, { userId: U.x, role: "introducer" }, U.ownerA),
);
const commB = await one(
  `select * from public.commission_rates where user_id = $1 and role = 'introducer' and tenant_id = $2`,
  [U.x, T.b],
);
const dupRate = await outcome(() =>
  sql(
    `insert into public.commission_rates (user_id, role, percentage, tenant_id) values ($1,'introducer',1,$2)`,
    [U.x, T.a],
  ),
);
ok(
  "A2-11 Tenant B commission for X coexists independently (real setCommissionRate / getCommissionRate per tenant); a duplicate Tenant A introducer rate is refused",
  rateB.ok &&
    !dupRate.ok &&
    dupRate.code === "23505" &&
    /commission_rates_tenant_id_user_id_role_key/.test(dupRate.message) &&
    Number(commB?.pct_fee) === 20 &&
    (await commText(U.x, T.a)) === commA0 &&
    getA.ok &&
    getB.ok &&
    JSON.stringify(getA.value) !== JSON.stringify(getB.value) &&
    JSON.stringify(getB.value).includes("20") &&
    JSON.stringify(getA.value).includes("15"),
  rateB.message ?? getA.message ?? getB.message ?? "",
);
{
  const upd = await asAuthenticated(
    U.ownerB,
    `update public.commission_rates set percentage = 99 where user_id = $1 returning tenant_id`,
    [U.x],
  );
  const del = await asAuthenticated(
    U.ownerB,
    `delete from public.commission_rates where user_id = $1 returning tenant_id`,
    [U.x],
  );
  const insA = await asAuthenticated(
    U.ownerB,
    `insert into public.commission_rates (user_id, role, percentage, tenant_id) values ($1,'advisor',5,$2)`,
    [U.x, T.a],
  );
  inTenant(SLUG.b);
  const rateB2 = await outcome(() =>
    invoke(
      finance.setCommissionRate,
      {
        userId: U.x,
        role: "introducer",
        pctFee: 21,
        pctMortgageFee: 18,
        pctInsuranceFee: 0,
        pctOtherFee: 0,
      },
      U.ownerB,
    ),
  );
  ok(
    "A2-25 no cross-tenant commission mutation (Tenant B admin by user_id reaches only the Tenant B row under RLS; real setCommissionRate updates only Tenant B)",
    upd.ok &&
      upd.rows.length === 1 &&
      upd.rows[0].tenant_id === T.b &&
      del.ok &&
      del.rows.length === 1 &&
      del.rows[0].tenant_id === T.b &&
      !insA.ok &&
      rateB2.ok &&
      Number(
        (
          await one(
            `select pct_fee from public.commission_rates where user_id = $1 and tenant_id = $2`,
            [U.x, T.b],
          )
        ).pct_fee,
      ) === 21 &&
      (await commText(U.x, T.a)) === commA0,
    rateB2.message ?? insA.message ?? "",
  );
}

// =============================================================================================
// A1 resolver and B1b admin management in a real two-registration state
// =============================================================================================
{
  inTenant(SLUG.a);
  const ra = await outcome(() => regSrv.requireActingIntroducerRegistration({ actingUserId: U.x }));
  const va = await outcome(() =>
    regSrv.requireActingIntroducerRegistration({
      actingUserId: U.ownerA,
      viewAsIntroducerUserId: U.x,
    }),
  );
  const crossVa = await outcome(() =>
    regSrv.requireActingIntroducerRegistration({
      actingUserId: U.ownerA,
      viewAsIntroducerUserId: U.z,
    }),
  );
  inTenant(SLUG.b);
  const rb = await outcome(() => regSrv.requireActingIntroducerRegistration({ actingUserId: U.x }));
  const vb = await outcome(() =>
    regSrv.requireActingIntroducerRegistration({
      actingUserId: U.ownerB,
      viewAsIntroducerUserId: U.x,
    }),
  );
  const profB = await outcome(() => invoke(introFns.getIntroducerProfile, {}, U.x));
  inTenant(SLUG.a);
  const profA = await outcome(() => invoke(introFns.getIntroducerProfile, {}, U.x));
  noTenant();
  const ambiguous = await outcome(() =>
    regSrv.requireActingIntroducerRegistration({ actingUserId: U.x }),
  );
  ok(
    "A2-15 A1 resolver selects the registration of the acting tenant (self, view-as and getIntroducerProfile; no acting tenant fails closed)",
    ra.ok &&
      ra.value.id === regA.id &&
      rb.ok &&
      rb.value.id === regB.id &&
      va.ok &&
      va.value.id === regA.id &&
      vb.ok &&
      vb.value.id === regB.id &&
      !crossVa.ok &&
      profA.ok &&
      profA.value.id === regA.id &&
      profB.ok &&
      profB.value.id === regB.id &&
      profB.value.company_code === regB.company_code &&
      !ambiguous.ok,
    ra.message ?? rb.message ?? profA.message ?? profB.message ?? "",
  );

  inTenant(SLUG.a);
  const listA = await outcome(() => invoke(introFns.listIntroducersForAdmin, undefined, U.ownerA));
  const mA = await outcome(() =>
    adminSrv.requireManagedIntroducerRegistration({
      actingUserId: U.ownerA,
      introducerUserId: U.x,
    }),
  );
  const mAcross = await outcome(() =>
    adminSrv.requireManagedIntroducerRegistration({
      actingUserId: U.ownerA,
      introducerId: regB.id,
    }),
  );
  const rowB0 = await regText(regB.id);
  const binCross = await outcome(() =>
    invoke(sf.softDeleteIntroducer, { introducerId: regB.id }, U.ownerA),
  );
  inTenant(SLUG.b);
  const listB = await outcome(() => invoke(introFns.listIntroducersForAdmin, undefined, U.ownerB));
  const mB = await outcome(() =>
    adminSrv.requireManagedIntroducerRegistration({
      actingUserId: U.ownerB,
      introducerUserId: U.x,
    }),
  );
  const mBcross = await outcome(() =>
    adminSrv.requireManagedIntroducerRegistration({
      actingUserId: U.ownerB,
      introducerId: regA.id,
    }),
  );
  const xA = listA.ok ? listA.value.find((r) => r.userId === U.x) : null;
  const xB = listB.ok ? listB.value.find((r) => r.userId === U.x) : null;
  ok(
    "A2-16 B1b admin management selects the acting tenant's registration (list, managed lookup; other tenant's registration is Not found)",
    xA?.introducerId === regA.id &&
      xA.company_code === regA.company_code &&
      xB?.introducerId === regB.id &&
      xB.company_code === regB.company_code &&
      mA.ok &&
      mA.value.id === regA.id &&
      mB.ok &&
      mB.value.id === regB.id &&
      !mAcross.ok &&
      /Not found/.test(mAcross.message) &&
      !mBcross.ok &&
      !binCross.ok &&
      (await regText(regB.id)) === rowB0 &&
      (await regText(regA.id)) === rowA0,
    listA.message ?? listB.message ?? "",
  );
}

// email is not authority
{
  await sql(
    `insert into public.introducers (user_id, company_name, slug, contact_email, company_code, tenant_id)
     values ($1,'Decoy Co','decoy-z-b',$2,'7311',$3)`,
    [U.z, users.get(U.x), T.b],
  );
  await addMember(U.z, T.b, "introducer", "introducer");
  inTenant(SLUG.b);
  const rb = await outcome(() => regSrv.requireActingIntroducerRegistration({ actingUserId: U.x }));
  const rz = await outcome(() => regSrv.requireActingIntroducerRegistration({ actingUserId: U.z }));
  const decoyRow = await regText((await regOf(U.z, T.b)).id);
  const tok = await rawInvite({
    tenantId: T.b,
    email: users.get(U.x),
    createCompany: true,
    createdBy: U.ownerB,
  });
  const stolen = await outcome(() => accept(U.z, tok));
  const regSrc = read("src/lib/introducer-registration.server.ts");
  const admSrc = read("src/lib/introducer-admin.server.ts");
  ok(
    "A2-17 email is not authority (registration with X's contact email is not X's; X's invite cannot be redeemed by another identity; resolvers never filter by email)",
    rb.ok &&
      rb.value.id === regB.id &&
      rz.ok &&
      rz.value.id !== regB.id &&
      !stolen.ok &&
      stolen.code === "staff_invite_email_mismatch" &&
      (await regText((await regOf(U.z, T.b)).id)) === decoyRow &&
      (await inviteRow(tok)).used_at === null &&
      !/\.eq\("(contact_)?email"/.test(regSrc + admSrc),
    stolen.message ?? "",
  );
}

// company_code is not authority
{
  const createJoinA = await outcome(() =>
    createInvite(U.ownerB, SLUG.b, {
      role: "introducer",
      email: users.get(U.v),
      companyMode: "join",
      companyCode: regA.company_code,
    }),
  );
  const tokOther = await rawInvite({
    tenantId: T.b,
    email: users.get(U.v),
    companyCode: regA.company_code,
    createdBy: U.ownerB,
  });
  const rOther = await outcome(() => accept(U.v, tokOther));
  // ambiguous: one code, two company names inside Tenant B
  const amb = await user("amb.member@example.test", "Amb Member");
  await sql(
    `insert into public.introducers (user_id, company_name, slug, company_code, tenant_id) values ($1,'Other Name','amb-member-b','7311',$2)`,
    [amb, T.b],
  );
  const tokAmb = await rawInvite({
    tenantId: T.b,
    email: users.get(U.v),
    companyCode: "7311",
    createdBy: U.ownerB,
  });
  const rAmb = await outcome(() => accept(U.v, tokAmb));
  inTenant(SLUG.b);
  const rx = await outcome(() => regSrv.requireActingIntroducerRegistration({ actingUserId: U.x }));
  ok(
    "A2-18 company_code is not authority (a code that exists only in Tenant A cannot select Tenant A's company from a Tenant B invite; an ambiguous code fails closed; registration resolution ignores codes)",
    !createJoinA.ok &&
      !rOther.ok &&
      rOther.code === "staff_invite_company_missing" &&
      (await inviteRow(tokOther)).used_at === null &&
      !rAmb.ok &&
      rAmb.code === "staff_invite_company_missing" &&
      (await regCount(U.v)) === 0 &&
      rx.ok &&
      rx.value.id === regB.id &&
      !/company_code/.test(
        read("src/lib/introducer-registration.server.ts") +
          read("src/lib/introducer-admin.server.ts"),
      ),
    rOther.message ?? rAmb.message ?? "",
  );
}

// slug is not authority
{
  inTenant(regA.slug);
  const bySlug = await outcome(() =>
    regSrv.requireActingIntroducerRegistration({ actingUserId: U.x }),
  );
  const bySlugAdmin = await outcome(() =>
    adminSrv.requireManagedIntroducerRegistration({
      actingUserId: U.ownerA,
      introducerUserId: U.x,
    }),
  );
  ok(
    "A2-19 slug is not authority (a referral slug in the path selects no tenant or registration; resolvers never filter by slug)",
    !bySlug.ok &&
      !bySlugAdmin.ok &&
      !/\.eq\("slug"/.test(
        read("src/lib/introducer-registration.server.ts") +
          read("src/lib/introducer-admin.server.ts"),
      ),
    bySlug.message ?? "",
  );
}

// =============================================================================================
// Global role with two registrations
// =============================================================================================
{
  const rowA1 = await regText(regA.id);
  inTenant(SLUG.b);
  const binB = await outcome(() =>
    invoke(sf.softDeleteIntroducer, { introducerId: regB.id }, U.ownerB),
  );
  const afterBinB = {
    role: await introducerRoleCount(U.x),
    b: await regOf(U.x, T.b),
    a: await regText(regA.id),
  };
  const restoreB = await outcome(() =>
    invoke(sf.restoreIntroducer, { introducerId: regB.id }, U.ownerB),
  );
  inTenant(SLUG.a);
  const binA = await outcome(() => invoke(sf.softDeleteIntroducer, { userId: U.x }, U.ownerA));
  const afterBinA = { role: await introducerRoleCount(U.x), b: await regOf(U.x, T.b) };
  const restoreA = await outcome(() => invoke(sf.restoreIntroducer, { userId: U.x }, U.ownerA));
  const revoke = await outcome(() =>
    invoke(sf.setIntroducerRole, { userId: U.x, makeIntroducer: false }, U.ownerA),
  );
  ok(
    "A2-14 disabling one registration never removes the global role another registration needs (bin/restore B, bin/restore A; legacy revoke fails closed)",
    binB.ok &&
      afterBinB.role === 1 &&
      afterBinB.b.active === false &&
      afterBinB.b.deleted_at !== null &&
      afterBinB.a === rowA1 &&
      restoreB.ok &&
      binA.ok &&
      afterBinA.role === 1 &&
      afterBinA.b.active === true &&
      restoreA.ok &&
      !revoke.ok &&
      (await introducerRoleCount(U.x)) === 1 &&
      (await regText(regA.id)) === rowA1 &&
      (await regOf(U.x, T.b)).active === true,
    binB.message ?? restoreB.message ?? binA.message ?? restoreA.message ?? "",
  );
  // NC-6: the pre-B1b unguarded shape (bin + delete global role) in the same state
  await pg.query("begin");
  await pg.query(`update public.introducers set active = false, deleted_at = now() where id = $1`, [
    regA.id,
  ]);
  await pg.query(`delete from public.user_roles where user_id = $1 and role = 'introducer'`, [U.x]);
  const broken = await one(
    `select exists (select 1 from public.introducers where user_id = $1 and deleted_at is null) as live,
            exists (select 1 from public.user_roles where user_id = $1 and role = 'introducer') as role`,
    [U.x],
  );
  await pg.query("rollback");
  ok(
    "NC-6 global-role removal while another registration remains (unguarded bin + role delete leaves live registration B without the introducer role)",
    broken.live === true && broken.role === false && (await introducerRoleCount(U.x)) === 1,
  );
}

// =============================================================================================
// A0 self-write boundary with two registrations
// =============================================================================================
{
  const rowB1 = await regText(regB.id);
  inTenant(SLUG.a);
  const upd = await outcome(() =>
    invoke(
      introFns.updateIntroducerProfile,
      { companyName: "Xavier A Trading", contactEmail: "" },
      U.x,
    ),
  );
  const aAfter = await regOf(U.x, T.a);
  const bUntouched = (await regText(regB.id)) === rowB1;
  const protectedCols = [];
  for (const [col, val] of [
    ["active", "false"],
    ["deleted_at", "now()"],
    ["tenant_id", `'${T.a}'`],
    ["company_code", "'9999'"],
    ["slug", "'stolen-slug'"],
    ["user_id", `'${U.z}'`],
  ]) {
    protectedCols.push(
      await asAuthenticated(U.x, `update public.introducers set ${col} = ${val} where id = $1`, [
        regB.id,
      ]),
    );
  }
  const insertOwn = await asAuthenticated(
    U.x,
    `insert into public.introducers (user_id, company_name, slug, tenant_id) values ($1,'Self','self-x-a2',$2)`,
    [U.x, T.b],
  );
  const decoy = await regOf(U.z, T.b);
  const otherUser = await asAuthenticated(
    U.x,
    `update public.introducers set company_name = 'hijack' where id = $1`,
    [decoy.id],
  );
  await sql(
    `update public.tenant_memberships set active = false where user_id = $1 and tenant_id = $2`,
    [U.x, T.b],
  );
  const noMembership = await asAuthenticated(
    U.x,
    `update public.introducers set company_name = 'no membership' where id = $1 returning id`,
    [regB.id],
  );
  await sql(
    `update public.tenant_memberships set active = true where user_id = $1 and tenant_id = $2`,
    [U.x, T.b],
  );
  const withMembership = await asAuthenticated(
    U.x,
    `update public.introducers set company_name = 'own b' where id = $1 returning id`,
    [regB.id],
  );
  const commWrite = await asAuthenticated(
    U.x,
    `update public.commission_rates set percentage = 50 where user_id = $1 returning id`,
    [U.x],
  );
  ok(
    "A2-20 A0 self-write boundary preserved (self-service in Tenant A writes only registration A's company_name/contact_email; protected columns and INSERT refused; another user's row and a registration without valid tenant membership are unreachable; no self commission write)",
    upd.ok &&
      aAfter.company_name === "Xavier A Trading" &&
      aAfter.contact_email === null &&
      aAfter.active === true &&
      aAfter.company_code === regA.company_code &&
      aAfter.slug === regA.slug &&
      bUntouched &&
      protectedCols.every((r) => !r.ok && r.code === "42501") &&
      !insertOwn.ok &&
      insertOwn.code === "42501" &&
      otherUser.ok &&
      otherUser.affected === 0 &&
      noMembership.ok &&
      noMembership.rows.length === 0 &&
      withMembership.ok &&
      withMembership.rows.length === 1 &&
      commWrite.ok &&
      commWrite.rows.length === 0 &&
      (await regText(regB.id)) === rowB1,
    upd.message ?? "",
  );
}

// =============================================================================================
// ensureStaffIntroducerRecord legacy commission seed
// =============================================================================================
{
  const extractedIsReal =
    ensureStart > 0 &&
    ensureEnd > ensureStart &&
    git("show", `HEAD:${BOOKING_REL}`).includes(ensureSrc) &&
    git("status", "--porcelain", "--", BOOKING_REL).trim() === "";
  const s1 = await user("staff.one@example.test", "Staff One");
  const s2 = await user("staff.two@example.test", "Staff Two");
  const s3 = await user("staff.three@example.test", "Staff Three");
  for (const s of [s1, s2, s3]) await addMember(s, T.b, "adviser", "advisor");
  await sql(
    `insert into public.commission_rates (user_id, role, percentage, pct_fee, tenant_id) values
     ($1,'introducer',15,15,$3), ($2,'introducer',16,16,$3), ($2,'introducer',22,22,$4)`,
    [s1, s2, T.a, T.b],
  );
  const before = await commAll();
  const regXA = await regText(regA.id);
  const e1 = await outcome(() => ensureStaffIntroducerRecord(s1));
  const e2 = await outcome(() => ensureStaffIntroducerRecord(s2));
  const e3 = await outcome(() => ensureStaffIntroducerRecord(s3));
  const e1again = await outcome(() => ensureStaffIntroducerRecord(s1));
  const after = await commAll();
  const regs = await sql(
    `select user_id, tenant_id from public.introducers where user_id = any($1::uuid[])`,
    [[s1, s2, s3]],
  );
  ok(
    "A2-26 ensureStaffIntroducerRecord (byte-identical source) cannot overwrite, mutate or create another tenant's rate (Tenant A rates byte-identical; legacy tenantless seed is a no-op under the new key)",
    extractedIsReal &&
      e1.ok &&
      e2.ok &&
      e3.ok &&
      e1again.ok &&
      e1again.value === e1.value &&
      before === after &&
      regs.length === 3 &&
      regs.every((r) => r.tenant_id === T.b) &&
      (await one(`select count(*)::int as n from public.commission_rates where user_id = $1`, [s3]))
        .n === 0 &&
      (await regText(regA.id)) === regXA,
    e1.message ?? e2.message ?? e3.message ?? "",
  );
}

// =============================================================================================
// Tenantless Test Account rows
// =============================================================================================
{
  const y = await user("test.account.y@example.test", "Test Y");
  const g1 = await outcome(() => sf.grantIntroducerRoleForTestAccount(y));
  const first = await regOf(y, null);
  const g2 = await outcome(() => sf.grantIntroducerRoleForTestAccount(y));
  const second = await regOf(y, null);
  const dupNull = await outcome(() =>
    sql(
      `insert into public.introducers (user_id, company_name, slug) values ($1,'Second','test-y-second')`,
      [y],
    ),
  );
  const withTenant = await outcome(() =>
    sql(
      `insert into public.introducers (user_id, company_name, slug, tenant_id) values ($1,'Y in A','test-y-a',$2)`,
      [y, T.a],
    ),
  );
  const snapshot = JSON.stringify(
    await sql(`select i::text from public.introducers i where user_id = $1 order by id`, [y]),
  );
  const g3 = await outcome(() => sf.grantIntroducerRoleForTestAccount(y));
  ok(
    "A2-27 tenantless Test Account uniqueness (one tenantless row, re-grant reuses it; a second tenantless row fails; a tenant row coexists; the legacy user-only grant then fails closed without writing)",
    g1.ok &&
      first?.tenant_id === null &&
      g2.ok &&
      second?.id === first.id &&
      !dupNull.ok &&
      dupNull.code === "23505" &&
      /introducers_tenant_id_user_id_key/.test(dupNull.message) &&
      withTenant.ok &&
      !g3.ok &&
      JSON.stringify(
        await sql(`select i::text from public.introducers i where user_id = $1 order by id`, [y]),
      ) === snapshot &&
      (await regCount(y)) === 2,
    g3.message ?? "",
  );
}

ok(
  "A2-24 historical attribution not rewritten after every A2 operation (customer_introducer_links, leads, appointments byte-identical)",
  (await attribution()) === attr0,
);
{
  const s3bSrc = read(S3B_VERIFIER);
  ok(
    "A2-23 S3B test 27 represents the A2 behaviour (loads the A2 migration; two registrations, A byte-identical, own code/slug, memberships, one role, duplicate refused, join reuses B)",
    s3bSrc.includes(A2_REL) &&
      s3bSrc.includes(
        '"27 second-tenant introducer invite creates an independent Tenant B registration (A byte-identical; duplicate new-company refused; join reuses B)"',
      ) &&
      !s3bSrc.includes('"27 cross-tenant introducer invite fails closed"') &&
      /n27 === 2/.test(s3bSrc) &&
      /JSON\.stringify\(await fullIntro\(T\.a\)\) === introA27/.test(s3bSrc) &&
      /r27b\.code === "staff_invite_introducer_company_conflict"/.test(s3bSrc) &&
      /role27\.length === 1/.test(s3bSrc) &&
      /rel27after === rel27/.test(s3bSrc),
  );
}
ok(
  "A2-T no unexpected network/auth calls",
  unknownCalls.length === 0,
  unknownCalls.slice(0, 3).join("; "),
);
const mainPg = pg;

// =============================================================================================
// Migration preconditions fail closed (scratch databases)
// =============================================================================================
async function failsClosed(label, prepare, pattern) {
  await freshDb();
  const u = await addUser(`${label}@example.test`);
  await sql(
    `insert into public.introducers (user_id, company_name, slug, tenant_id) values ($1,'P','p-${label}',$2)`,
    [u, T.a],
  );
  await prepare(u);
  const before = JSON.stringify(await catalog());
  const data = JSON.stringify(await sql(`select i::text from public.introducers i order by id`));
  const r = await outcome(() => pg.exec(a2Sql));
  return (
    !r.ok &&
    pattern.test(r.message) &&
    JSON.stringify(await catalog()) === before &&
    JSON.stringify(await sql(`select i::text from public.introducers i order by id`)) === data &&
    (
      await one(
        `select to_regclass('pg_temp.g7f4s4c4a2_baseline') is null
            and to_regclass('pg_temp.g7f4s4c4a2_rows_before') is null
            and to_regclass('pg_temp.g7f4s4c4a2_rows_after') is null as gone`,
      )
    ).gone
  );
}
const pre = {
  dupIntro: await failsClosed(
    "dup",
    async (u) => {
      await pg.exec(`alter table public.introducers drop constraint introducers_user_id_key`);
      await sql(
        `insert into public.introducers (user_id, company_name, slug) values ($1,'N1','n-one'), ($1,'N2','n-two')`,
        [u],
      );
    },
    /g7f4s4c4a2_precondition:introducers_duplicate_tenant_user/,
  ),
  dupComm: await failsClosed(
    "dupcomm",
    async (u) => {
      await pg.exec(
        `alter table public.commission_rates drop constraint commission_rates_user_id_role_key`,
      );
      await sql(
        `insert into public.commission_rates (user_id, role, percentage) values ($1,'introducer',1), ($1,'introducer',2)`,
        [u],
      );
    },
    /g7f4s4c4a2_precondition:commission_rates_duplicate_tenant_user_role/,
  ),
  changedDef: await failsClosed(
    "def",
    async () => {
      await pg.exec(`alter table public.introducers drop constraint introducers_user_id_key;
        alter table public.introducers add constraint introducers_user_id_key unique (user_id, slug);`);
    },
    /g7f4s4c4a2_precondition:old_key_missing_or_changed:introducers_user_id_key/,
  ),
  commMissing: await failsClosed(
    "commmissing",
    async () => {
      await pg.exec(
        `alter table public.commission_rates drop constraint commission_rates_user_id_role_key`,
      );
    },
    /g7f4s4c4a2_precondition:old_key_missing_or_changed:commission_rates_user_id_role_key/,
  ),
  dependant: await failsClosed(
    "fk",
    async () => {
      await pg.exec(
        `create table public.g7f_dependant (intro_user uuid references public.introducers(user_id))`,
      );
    },
    /g7f4s4c4a2_precondition:old_key_has_dependants:introducers_user_id_key/,
  ),
  commDependant: await failsClosed(
    "commfk",
    async () => {
      await pg.exec(
        `create table public.g7f_comm_dependant (u uuid, r text,
           foreign key (u, r) references public.commission_rates(user_id, role))`,
      );
    },
    /g7f4s4c4a2_precondition:old_key_has_dependants:commission_rates_user_id_role_key/,
  ),
  nameInUse: await failsClosed(
    "name",
    async () => {
      await pg.exec(`create index introducers_user_id_idx on public.introducers (user_id)`);
    },
    /g7f4s4c4a2_precondition:new_key_name_in_use/,
  ),
  slugMissing: await failsClosed(
    "slug",
    async () => {
      await pg.exec(`alter table public.introducers drop constraint introducers_slug_key`);
    },
    /g7f4s4c4a2_precondition:slug_key_missing/,
  ),
  postRollback: await failsClosed(
    "post",
    async () => {
      await pg.exec(`grant insert on public.introducers to authenticated`);
    },
    /g7f4s4c4a2_postcondition:a0_table_privileges:authenticated/,
  ),
};
ok(
  "A2-28 migration preconditions fail closed with no change (duplicates under either new key, changed or missing old key, dependent FK on either old key, new name in use, slug key missing)",
  pre.dupIntro &&
    pre.dupComm &&
    pre.changedDef &&
    pre.commMissing &&
    pre.dependant &&
    pre.commDependant &&
    pre.nameInUse &&
    pre.slugMissing,
  JSON.stringify(pre),
);
// Postconditions are live checks: variants of the real migration that change business data or
// the function's security posture must raise and roll back; a physical row reorder must not.
const POST_MARKER = "-- O–U. Postconditions.";
const inject = (stmt) => a2Sql.replace(POST_MARKER, `${stmt}\n${POST_MARKER}`);
async function variant(label, text, pattern) {
  await freshDb();
  const u = await addUser(`${label}@example.test`);
  await sql(
    `insert into public.introducers (user_id, company_name, slug, tenant_id, company_code) values ($1,'V','v-${label}',$2,'4321')`,
    [u, T.a],
  );
  await sql(
    `insert into public.commission_rates (user_id, role, percentage, pct_fee, tenant_id) values
     ($1,'advisor',30,30,$2), ($3,'introducer',12.5,12.5,$4)`,
    [u, T.a, await addUser(`${label}.2@example.test`), T.b],
  );
  const rows = async () =>
    JSON.stringify({
      i: await sql(`select t::text from public.introducers t order by id`),
      c: await sql(`select t::text from public.commission_rates t order by id`),
    });
  const before = JSON.stringify(await catalog());
  const data = await rows();
  const r = await outcome(() => pg.exec(text));
  if (pattern === null) return r.ok && (await rows()) === data;
  return (
    text !== a2Sql &&
    !r.ok &&
    pattern.test(r.message) &&
    JSON.stringify(await catalog()) === before &&
    (await rows()) === data
  );
}
const GRANT_LINE =
  "GRANT EXECUTE ON FUNCTION public.accept_staff_invite(text, uuid, text, text, text, text, text)\n  TO service_role;";
const FN_HEADER = "SECURITY DEFINER\nSET search_path = ''";
const post = {
  introducerContent: await variant(
    "vintro",
    inject("UPDATE public.introducers SET contact_email = 'changed@example.test';"),
    /g7f4s4c4a2_postcondition:business_data_changed/,
  ),
  commissionNullColumn: await variant(
    "vcomm",
    inject("UPDATE public.commission_rates SET pct_other_fee = 1 WHERE role = 'advisor';"),
    /g7f4s4c4a2_postcondition:business_data_changed/,
  ),
  commissionRowDeleted: await variant(
    "vdel",
    inject("DELETE FROM public.commission_rates WHERE role = 'advisor';"),
    /g7f4s4c4a2_postcondition:business_row_count_changed/,
  ),
  physicalReorderAccepted: await variant(
    "vorder",
    inject(
      "UPDATE public.introducers SET company_name = company_name; UPDATE public.commission_rates SET role = role;",
    ),
    null,
  ),
  securityInvoker: await variant(
    "vinvoker",
    a2Sql.replace(FN_HEADER, "SECURITY INVOKER\nSET search_path = ''"),
    /g7f4s4c4a2_postcondition:accept_staff_invite_privileges/,
  ),
  noSearchPath: await variant(
    "vnopath",
    a2Sql.replace(FN_HEADER, "SECURITY DEFINER"),
    /g7f4s4c4a2_postcondition:accept_staff_invite_privileges/,
  ),
  publicSearchPath: await variant(
    "vpubpath",
    a2Sql.replace(FN_HEADER, "SECURITY DEFINER\nSET search_path = public"),
    /g7f4s4c4a2_postcondition:accept_staff_invite_privileges/,
  ),
  publicExecute: await variant(
    "vpublic",
    a2Sql.replace(GRANT_LINE, GRANT_LINE.replace("TO service_role;", "TO service_role, PUBLIC;")),
    /g7f4s4c4a2_postcondition:accept_staff_invite_privileges/,
  ),
  anonExecute: await variant(
    "vanon",
    a2Sql.replace(GRANT_LINE, GRANT_LINE.replace("TO service_role;", "TO service_role, anon;")),
    /g7f4s4c4a2_postcondition:accept_staff_invite_privileges/,
  ),
  authenticatedExecute: await variant(
    "vauthd",
    a2Sql.replace(
      GRANT_LINE,
      GRANT_LINE.replace("TO service_role;", "TO service_role, authenticated;"),
    ),
    /g7f4s4c4a2_postcondition:accept_staff_invite_privileges/,
  ),
};
ok(
  "A2-28b migration is atomic and its postconditions are live: a failure after the DDL rolls every key change and the function replacement back (A0 grant drift, changed or deleted business row, SECURITY INVOKER, missing/unsafe search_path, PUBLIC/anon/authenticated EXECUTE); a physical row reorder is accepted",
  pre.postRollback &&
    Object.values(post).every(Boolean) &&
    /server_version_num'\)::int < 150000/.test(a2Sql) &&
    /^LOCK TABLE public\.introducers, public\.commission_rates IN ACCESS EXCLUSIVE MODE;/m.test(
      a2Sql,
    ) &&
    !/^\s*(BEGIN|COMMIT|ROLLBACK)\s*;/im.test(a2Sql) &&
    !/\bCASCADE\b/i.test(a2Sql),
  JSON.stringify(post),
);

// =============================================================================================
// Negative controls on scratch databases
// =============================================================================================
async function secondTenantScenario() {
  const oa = await user(`oa.${randomUUID().slice(0, 8)}@example.test`, "Owner A");
  await addMember(oa, T.a, "owner", "admin");
  const ob = await user(`ob.${randomUUID().slice(0, 8)}@example.test`, "Owner B");
  await addMember(ob, T.b, "owner", "admin");
  const x = await user(`x.${randomUUID().slice(0, 8)}@example.test`, "Scenario X");
  const invA = await createInvite(oa, SLUG.a, {
    role: "introducer",
    email: users.get(x),
    companyMode: "new",
  });
  await accept(x, invA.token);
  const a = await regOf(x, T.a);
  return { oa, ob, x, a, aText: await regText(a.id) };
}

// NC-2: the new function with the old UNIQUE(user_id)
{
  await freshDb();
  await pg.exec(a2Function);
  const s = await secondTenantScenario();
  const inv = await createInvite(s.ob, SLUG.b, {
    role: "introducer",
    email: users.get(s.x),
    companyMode: "new",
  });
  const r = await outcome(() => accept(s.x, inv.token));
  ok(
    "NC-2 new tenant-scoped function with the old UNIQUE(user_id): the second registration is still impossible (unique violation), nothing written",
    !r.ok &&
      (await regCount(s.x)) === 1 &&
      (await regText(s.a.id)) === s.aText &&
      (await inviteRow(inv.token)).used_at === null,
    r.message ?? "",
  );
  // NC-8: legacy commission upsert under the old key overwrites another tenant's rate
  await sql(
    `insert into public.commission_rates (user_id, role, percentage, pct_fee, tenant_id) values ($1,'introducer',15,15,$2)`,
    [s.x, T.a],
  );
  const { supabaseAdminUntyped } = await import("../src/integrations/supabase/client.server.ts");
  await supabaseAdminUntyped
    .from("commission_rates")
    .upsert(
      { user_id: s.x, role: "introducer", percentage: 10, pct_fee: 10 },
      { onConflict: "user_id,role" },
    );
  const legacyRow = await one(
    `select percentage, tenant_id from public.commission_rates where user_id = $1`,
    [s.x],
  );
  ok(
    "NC-8 old commission key: the legacy ensureStaff upsert shape (onConflict user_id,role) overwrites another tenant's rate",
    Number(legacyRow.percentage) === 10 && legacyRow.tenant_id === T.a,
  );
}

// NC-4: the old user-only invite lookup on the A2 schema
{
  await freshDb({ withA2: true });
  await pg.exec(s3bFunction);
  const s = await secondTenantScenario();
  const inv = await createInvite(s.ob, SLUG.b, {
    role: "introducer",
    email: users.get(s.x),
    companyMode: "new",
  });
  const r = await outcome(() => accept(s.x, inv.token));
  ok(
    "NC-4a old user-only invite lookup on the A2 schema reads registration A and refuses the second tenant",
    !r.ok && r.code === "staff_invite_introducer_conflict" && (await regCount(s.x)) === 1,
    r.message ?? "",
  );

  // user-only lookup without the conflict raise: modifies another tenant's registration
  await freshDb({ withA2: true });
  const naive = a2Function.replace(
    "WHERE i.user_id = p_user_id AND i.tenant_id = v_inv.tenant_id",
    "WHERE i.user_id = p_user_id",
  );
  await pg.exec(naive);
  const n = await secondTenantScenario();
  inTenant(SLUG.a);
  await invoke(sf.softDeleteIntroducer, { introducerId: n.a.id }, n.oa);
  const binned = await regText(n.a.id);
  const dec = await user("legacy.collision@example.test", "Legacy Collision");
  await sql(
    `insert into public.introducers (user_id, company_name, slug, company_code, tenant_id) values ($1,'Collision Co','collision-b',$2,$3)`,
    [dec, n.a.company_code, T.b],
  );
  const tok = await rawInvite({
    tenantId: T.b,
    email: users.get(n.x),
    companyCode: n.a.company_code,
    createdBy: n.ob,
  });
  const rn = await outcome(() => accept(n.x, tok));
  const aNow = await regOf(n.x, T.a);
  ok(
    "NC-4b user-only lookup without the conflict check: a Tenant B invite reactivates Tenant A's registration and creates none in Tenant B",
    naive !== a2Function &&
      rn.ok &&
      (await regText(n.a.id)) !== binned &&
      aNow.active === true &&
      aNow.deleted_at === null &&
      (await regOf(n.x, T.b)) === null,
    rn.message ?? "",
  );

  // the real A2 function in the same legacy-collision state
  await freshDb({ withA2: true });
  const g = await secondTenantScenario();
  inTenant(SLUG.a);
  await invoke(sf.softDeleteIntroducer, { introducerId: g.a.id }, g.oa);
  const gBinned = await regText(g.a.id);
  const gd = await user("legacy.collision2@example.test", "Legacy Collision");
  await sql(
    `insert into public.introducers (user_id, company_name, slug, company_code, tenant_id) values ($1,'Collision Co','collision-b2',$2,$3)`,
    [gd, g.a.company_code, T.b],
  );
  const gt = await rawInvite({
    tenantId: T.b,
    email: users.get(g.x),
    companyCode: g.a.company_code,
    createdBy: g.ob,
  });
  const rg = await outcome(() => accept(g.x, gt));
  ok(
    "A2-22b real A2 function in the same state: Tenant A's binned registration untouched; Tenant B registration created in Tenant B's company",
    rg.ok &&
      (await regText(g.a.id)) === gBinned &&
      (await regOf(g.x, T.b))?.company_name === "Collision Co" &&
      (await regOf(g.x, T.b)).id !== g.a.id,
    rg.message ?? "",
  );
}

// NC-5: plain UNIQUE (tenant_id, user_id)
{
  await freshDb();
  const ddlOnly = a2Sql.replace(
    "ADD CONSTRAINT introducers_tenant_id_user_id_key UNIQUE NULLS NOT DISTINCT (tenant_id, user_id)",
    "ADD CONSTRAINT introducers_tenant_id_user_id_key UNIQUE (tenant_id, user_id)",
  );
  const rDdl = await outcome(() => pg.exec(ddlOnly));
  await freshDb();
  const plain = ddlOnly.replace(
    "pg_get_constraintdef(c.oid) = 'UNIQUE NULLS NOT DISTINCT (tenant_id, user_id)'",
    "pg_get_constraintdef(c.oid) = 'UNIQUE (tenant_id, user_id)'",
  );
  const rPlain = await outcome(() => pg.exec(plain));
  const u = await addUser("nc5@example.test");
  const twoNull = await outcome(() =>
    sql(
      `insert into public.introducers (user_id, company_name, slug) values ($1,'N1','nc5-one'), ($1,'N2','nc5-two')`,
      [u],
    ),
  );
  ok(
    "NC-5 plain UNIQUE (tenant_id, user_id) admits duplicate tenantless rows (and the real migration's postcondition rejects that key)",
    ddlOnly !== a2Sql &&
      !rDdl.ok &&
      /g7f4s4c4a2_postcondition:new_key_missing/.test(rDdl.message) &&
      plain !== ddlOnly &&
      rPlain.ok &&
      twoNull.ok,
    rPlain.message ?? "",
  );
}

// NC-7: company-code authority (join lookup without the tenant predicate)
{
  await freshDb({ withA2: true });
  const loose = a2Function.replace(
    "WHERE i.company_code = v_company_code AND i.tenant_id = v_inv.tenant_id;",
    "WHERE i.company_code = v_company_code;",
  );
  await pg.exec(loose);
  const s = await secondTenantScenario();
  const v = await user("nc7.newcomer@example.test", "NC7 Newcomer");
  const tok = await rawInvite({
    tenantId: T.b,
    email: users.get(v),
    companyCode: s.a.company_code,
    createdBy: s.ob,
  });
  const r = await outcome(() => accept(v, tok));
  const vb = await regOf(v, T.b);
  ok(
    "NC-7 company code as authority: without the invite-tenant predicate a Tenant B invite joins Tenant A's company by code",
    loose !== a2Function &&
      r.ok &&
      vb?.company_code === s.a.company_code &&
      vb.company_name === s.a.company_name,
    r.message ?? "",
  );
}

// =============================================================================================
// Static scope guards
// =============================================================================================
pg = mainPg;
const status = (...paths) => git("status", "--porcelain", "--", ...paths).trim();
ok(
  "A2-S1 no application source changed (finance, booking/ensureStaffIntroducerRecord, sessions/grantIntroducerRole, introducer/createManualLead, test accounts, tenant-assert)",
  status("src") === "",
);
ok(
  "A2-S2 exactly one new migration (the A2 migration) and no other migration changed",
  status("supabase") === `?? ${A2_REL}`,
  status("supabase"),
);
ok(
  "A2-S3 accept_staff_invite: tenant-scoped lookup behind a per-(user, tenant) advisory lock; the cross-tenant refusal is gone",
  /PERFORM pg_advisory_xact_lock\(872014005, hashtext\(p_user_id::text \|\| ':' \|\| v_inv\.tenant_id::text\)\);\s+SELECT \* INTO v_intro\s+FROM public\.introducers i\s+WHERE i\.user_id = p_user_id AND i\.tenant_id = v_inv\.tenant_id\s+FOR UPDATE;/.test(
    a2Function,
  ) &&
    !a2Function.includes("staff_invite_introducer_conflict") &&
    a2Function.includes("PERFORM pg_advisory_xact_lock(872014004, hashtext(p_token_hash));") &&
    /WHERE si\.id = v_inv\.id AND si\.used_at IS NULL/.test(a2Function),
);
ok(
  "A2-S4 migration writes no business data (no INSERT/UPDATE/DELETE outside the function body; no user_roles or tenant_memberships DDL)",
  !/^\s*(INSERT|UPDATE|DELETE|TRUNCATE)\b/im.test(a2Sql.replace(a2Function, "")) &&
    !/ALTER TABLE public\.(user_roles|tenant_memberships)/i.test(a2Sql),
);

console.log(`SUMMARY A2_NEGATIVE_CONTROLS ${ncPass}/${ncTotal}`);
process.stdout.write(`${total - failures.length}/${total} PASS\n`);
process.exit(failures.length ? 1 : 0);
