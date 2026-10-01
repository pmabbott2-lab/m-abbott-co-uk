/**
 * G7F-4S3B staff invite / verified identity binding — offline verification.
 *
 * The real server-function validators and handlers run against an in-process PostgreSQL
 * (PGlite, WASM) that holds a stub of the staging schema with the G7F-4S3B migration applied
 * verbatim. A fake PostgREST/Auth Admin layer on a non-routable host translates supabase-js
 * calls into SQL. Synthetic fixtures only: no network, no staging, no production, no real user,
 * no real token. Raw invite tokens stay in this process and are never printed.
 *
 * Stubbed (not under test): MFA freshness (requireFreshPrivilegedAuth / requirePlatformAal2)
 * and the Super Owner gate (requireSuperOwner) — both unrelated to identity binding.
 *
 * PGlite is loaded from outside the repository:
 *   npm install --prefix /tmp/g7f4s3b/pglite @electric-sql/pglite@0.5.8
 *   G7F4S3B_PGLITE_DIR=/tmp/g7f4s3b/pglite (default)
 * Run `npm run build` first (client-bundle checks read dist/client).
 * Run: npm exec --yes --package=tsx -- tsx scripts/g7f4s3b-staff-invite-binding-verify.mjs
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { createRequire, register } from "node:module";
import { resolve, dirname, join } from "node:path";
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
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const code = (rel) => strip(readFileSync(resolve(root, rel), "utf8"));
const sha256 = (s) => createHash("sha256").update(s, "utf8").digest("hex");

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
export async function requireFreshPrivilegedAuth() { globalThis.__g7f4s3bMfaCalls = (globalThis.__g7f4s3bMfaCalls ?? 0) + 1; }
export async function requirePlatformAal2() { globalThis.__g7f4s3bMfaCalls = (globalThis.__g7f4s3bMfaCalls ?? 0) + 1; }
`;
const authorityReal = pathToFileURL(resolve(root, "src/lib/platform-authority.server.ts")).href;
const authorityStub = `
export * from ${JSON.stringify(authorityReal)};
export async function requireSuperOwner(userId) {
  if (!(globalThis.__g7f4s3bSuperOwners ?? new Set()).has(userId)) throw new Error("Super Owner required.");
  return { isSuperOwner: true };
}
`;
const realStartServerUrl = import.meta.resolve("@tanstack/react-start/server");
const startServerStub = `
import * as real from ${JSON.stringify(realStartServerUrl)};
export * from ${JSON.stringify(realStartServerUrl)};
export function getRequest() {
  return globalThis.__g7f4s3bRequest !== undefined ? globalThis.__g7f4s3bRequest : real.getRequest();
}
`;
const mfaStubUrl = `data:text/javascript,${encodeURIComponent(mfaStub)}`;
const authorityStubUrl = `data:text/javascript,${encodeURIComponent(authorityStub)}`;
// tsx rewrites "@/…" aliases to absolute file URLs before resolution, so match both forms.
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
const pg = await PGlite.create();
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
create table public.introducers (
  id uuid primary key default gen_random_uuid(), user_id uuid not null unique references auth.users(id),
  company_name text not null, slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  contact_email text, active boolean not null default true,
  company_code text check (company_code is null or company_code ~ '^[0-9]{4}$'),
  tenant_id uuid, deleted_at timestamptz, created_at timestamptz not null default now()
);
create table public.platform_roles (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id),
  role public.platform_role not null, created_by uuid, created_at timestamptz not null default now(),
  unique (user_id, role)
);
create table public.platform_break_glass_identities (user_id uuid primary key);

-- pre-G7F-4S3B staff_invitations shape (plaintext uuid token, client RLS policy)
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
create index idx_staff_invitations_token on public.staff_invitations (token);

create or replace function public.has_role(_user_id uuid, _role public.app_role) returns boolean
  language sql stable security definer set search_path = public as
  $$ select exists (select 1 from public.user_roles where user_id = _user_id and role = _role) $$;
create or replace function public.auth_is_tenant_admin(p_tenant_id uuid) returns boolean
  language sql stable security definer set search_path = public as
  $$ select exists (select 1 from public.tenant_memberships m where m.user_id = auth.uid()
       and m.tenant_id = p_tenant_id and m.active and m.role in ('owner','supervisor','general')) $$;
create or replace function public.has_tenant_membership(p_user_id uuid, p_tenant_id uuid) returns boolean
  language sql stable security definer set search_path = public as
  $$ select exists (select 1 from public.tenant_memberships m where m.user_id = p_user_id
       and m.tenant_id = p_tenant_id and m.active) $$;

alter table public.staff_invitations enable row level security;
create policy "Staff manage invitations" on public.staff_invitations for all to authenticated
  using (public.auth_is_tenant_admin(tenant_id)
    or (tenant_id is null and (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'advisor'))))
  with check (public.auth_is_tenant_admin(tenant_id)
    or (tenant_id is null and (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'advisor'))));

-- Supabase default privileges for the API roles
grant all on all tables in schema public to anon, authenticated, service_role;
`;
await pg.exec(BASE_SCHEMA);

// platform invitations: the real G7E-2A table + claim function, verbatim
const g7e2a = readFileSync(
  resolve(root, "supabase/migrations/20260922190000_gate_g7e2a_platform_admins.sql"),
  "utf8",
);
await pg.exec(g7e2a.slice(0, g7e2a.indexOf("-- Last Super Owner concurrency")));

// --- synthetic fixtures ---------------------------------------------------------------------
const T = { a: randomUUID(), b: randomUUID(), s: randomUUID() };
await sql(
  `insert into public.tenants (id, company_code, slug, company_name, status) values
   ($1,'901','tenant-a','Tenant A Ltd','active'), ($2,'902','tenant-b','Tenant B Ltd','active'),
   ($3,'903','tenant-s','Tenant S Ltd','suspended')`,
  [T.a, T.b, T.s],
);
async function addUser(email, { confirmed = true, appMeta = {}, userMeta = {} } = {}) {
  const id = randomUUID();
  await sql(
    `insert into auth.users (id, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
     values ($1, $2, case when $3::boolean then now() else null end, $4::jsonb, $5::jsonb)`,
    [id, email, confirmed, JSON.stringify(appMeta), JSON.stringify(userMeta)],
  );
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
const U = {};
U.ownerA = await addUser("owner.a@example.test");
await addMember(U.ownerA, T.a, "owner", "admin");
U.supA = await addUser("supervisor.a@example.test");
await addMember(U.supA, T.a, "supervisor", "admin");
U.genA = await addUser("general.a@example.test");
await addMember(U.genA, T.a, "general", "admin");
U.advA = await addUser("adviser.a@example.test");
await addMember(U.advA, T.a, "adviser", "advisor");
U.ownerB = await addUser("owner.b@example.test");
await addMember(U.ownerB, T.b, "owner", "admin");
U.platform = await addUser("platform.owner@example.test");
await sql(`insert into public.platform_roles (user_id, role) values ($1,'super_owner')`, [
  U.platform,
]);
globalThis.__g7f4s3bSuperOwners = new Set([U.platform]);

// legacy rows written before the migration (plaintext uuid tokens)
const LEGACY = {
  open: randomUUID(),
  nullEmail: randomUUID(),
  mismatch: randomUUID(),
  used: randomUUID(),
};
await sql(
  `insert into public.staff_invitations (token, role, membership_role, email, tenant_id, used_at) values
   ($1,'advisor','adviser','legacy.adviser@example.test',$5,null),
   ($2,'advisor','adviser',null,$5,null),
   ($3,'advisor','general','legacy.mismatch@example.test',$5,null),
   ($4,'introducer','introducer','legacy.used@example.test',$5,now())`,
  [LEGACY.open, LEGACY.nullEmail, LEGACY.mismatch, LEGACY.used, T.a],
);

// --- RLS helper: statement as the authenticated API role -------------------------------------
async function asAuthenticated(userId, stmt, params = []) {
  await pg.query("begin");
  try {
    await pg.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId]);
    await pg.query("set local role authenticated");
    const r = await pg.query(stmt, params);
    return { ok: true, rows: r.rows, affected: r.affectedRows ?? r.rows.length };
  } catch (e) {
    return { ok: false, code: e.code, message: e.message };
  } finally {
    await pg.query("rollback");
  }
}

// pre-migration control: the old policy let a tenant admin read raw tokens and write rows
const preSelect = await asAuthenticated(
  U.ownerA,
  `select token from public.staff_invitations where tenant_id = $1`,
  [T.a],
);
const preInsert = await asAuthenticated(
  U.ownerA,
  `insert into public.staff_invitations (role, membership_role, email, tenant_id)
   values ('admin','owner','control@example.test',$1)`,
  [T.a],
);
ok(
  "00a control: pre-migration client RLS exposed raw tokens and allowed owner-invite INSERT",
  preSelect.ok && preSelect.rows.length >= 3 && preInsert.ok,
);

// --- apply the migration verbatim, twice -----------------------------------------------------
const MIGRATION_REL =
  "supabase/migrations/20260930210201_gate_g7f4s3b_staff_invite_identity_binding.sql";
const migration = readFileSync(resolve(root, MIGRATION_REL), "utf8");
const mig1 = await outcome(() => pg.exec(migration));
const mig2 = await outcome(() => pg.exec(migration));
ok(
  "00b migration applies cleanly and is re-runnable",
  mig1.ok && mig2.ok,
  mig1.message ?? mig2.message ?? "",
);
const cols = (
  await sql(
    `select column_name from information_schema.columns
     where table_schema='public' and table_name='staff_invitations'`,
  )
).map((r) => r.column_name);
ok(
  "00c plaintext token column dropped; token_hash present",
  !cols.includes("token") && cols.includes("token_hash"),
);
const legacyHashes = await sql(
  `select token_hash from public.staff_invitations order by created_at`,
);
ok(
  "00d legacy rows backfilled to sha256(lower(uuid))",
  legacyHashes.length === 4 &&
    [LEGACY.open, LEGACY.nullEmail, LEGACY.mismatch, LEGACY.used].every((t) =>
      legacyHashes.some((r) => r.token_hash === sha256(t.toLowerCase())),
    ),
);
const fnPriv = await one(
  `select has_function_privilege('anon', 'public.accept_staff_invite(text,uuid,text,text,text,text,text)', 'EXECUTE') as anon,
          has_function_privilege('authenticated', 'public.accept_staff_invite(text,uuid,text,text,text,text,text)', 'EXECUTE') as authd,
          has_function_privilege('service_role', 'public.accept_staff_invite(text,uuid,text,text,text,text,text)', 'EXECUTE') as svc,
          (select prosecdef from pg_proc where proname = 'accept_staff_invite') as secdef`,
);
ok(
  "00e accept_staff_invite is SECURITY DEFINER and executable by service_role only",
  fnPriv.secdef === true && !fnPriv.anon && !fnPriv.authd && fnPriv.svc,
);

// --- fake PostgREST + Auth Admin on PGlite ---------------------------------------------------
const FAKE_HOST = "g7f4s3b.invalid";
process.env.SUPABASE_URL = `http://${FAKE_HOST}`;
process.env.VITE_SUPABASE_URL = `http://${FAKE_HOST}`;
process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_secret_g7f4s3b_not_a_real_key";
process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_g7f4s3b_not_a_real_key";
process.env.VITE_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_g7f4s3b_not_a_real_key";

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
const calls = [];
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
const pkCache = new Map();
async function primaryKey(table) {
  if (!pkCache.has(table)) {
    const rows = await sql(
      `select a.attname from pg_index i join pg_attribute a on a.attrelid = i.indrelid
       and a.attnum = any(i.indkey) where i.indrelid = ('public.' || $1)::regclass and i.indisprimary`,
      [table],
    );
    pkCache.set(
      table,
      rows.map((r) => r.attname),
    );
  }
  return pkCache.get(table);
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
          `(${colset
            .map((c) => (c in r ? `$${args.push(cellValue(r[c]))}` : "default"))
            .join(", ")})`,
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
async function authAdmin(method, url, body) {
  const p = url.pathname;
  if (p === "/auth/v1/admin/users" && method === "GET") {
    const page = Number(url.searchParams.get("page") ?? 1);
    const perPage = Number(url.searchParams.get("per_page") ?? 50);
    const rows = await sql(`select * from auth.users order by created_at, id limit $1 offset $2`, [
      perPage,
      (page - 1) * perPage,
    ]);
    const n = (await one(`select count(*)::int as n from auth.users`)).n;
    return json({ users: rows.map(authUserJson), aud: "authenticated" }, 200, {
      "x-total-count": String(n),
    });
  }
  if (p === "/auth/v1/admin/users" && method === "POST") {
    const email = String(body?.email ?? "")
      .trim()
      .toLowerCase();
    if (await one(`select 1 from auth.users where lower(email) = $1`, [email])) {
      return json(
        { code: "email_exists", msg: "A user with this email address has already been registered" },
        422,
      );
    }
    const id = randomUUID();
    await sql(
      `insert into auth.users (id, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
       values ($1,$2, case when $3::boolean then now() else null end, $4::jsonb, $5::jsonb)`,
      [
        id,
        email,
        Boolean(body?.email_confirm),
        JSON.stringify(body?.app_metadata ?? {}),
        JSON.stringify(body?.user_metadata ?? {}),
      ],
    );
    return json(authUserJson(await one(`select * from auth.users where id = $1`, [id])));
  }
  const m = p.match(/^\/auth\/v1\/admin\/users\/([0-9a-f-]{36})$/);
  if (m && method === "GET") {
    const u = await one(`select * from auth.users where id = $1`, [m[1]]);
    return u ? json(authUserJson(u)) : json({ code: "user_not_found", msg: "User not found" }, 404);
  }
  if (p === "/auth/v1/admin/generate_link" && method === "POST") {
    const u = await one(`select * from auth.users where lower(email) = lower($1)`, [
      String(body?.email ?? ""),
    ]);
    if (!u) return json({ code: "user_not_found", msg: "User not found" }, 404);
    return json({
      ...authUserJson(u),
      action_link: `http://${FAKE_HOST}/verify`,
      email_otp: "000000",
      hashed_token: `synthetic-hash-${u.id}`,
      redirect_to: "",
      verification_type: "magiclink",
    });
  }
  unknownCalls.push(`${method} ${p}`);
  return json({ msg: `unexpected ${method} ${p}` }, 500);
}

globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === "string" ? input : (input.url ?? String(input)));
  if (url.hostname !== FAKE_HOST) {
    unknownCalls.push(`refused host ${url.hostname}`);
    throw new Error(`G7F4S3B fetch stub refused host ${url.hostname}`);
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
  calls.push({ method, path: url.pathname, search: url.search, body });
  try {
    if (url.pathname.startsWith("/rest/v1/rpc/")) {
      return await restRpc(url.pathname.slice("/rest/v1/rpc/".length), body);
    }
    if (url.pathname.startsWith("/rest/v1/")) {
      return await restTable(method, url.pathname.slice("/rest/v1/".length), url, headers, body);
    }
    if (url.pathname.startsWith("/auth/v1/")) return await authAdmin(method, url, body);
  } catch (e) {
    if (e?.code) return pgError(e);
    unknownCalls.push(String(e?.message ?? e));
    return json({ code: "XX000", message: String(e?.message ?? e) }, 500);
  }
  unknownCalls.push(`${method} ${url.pathname}`);
  return json({ message: "unexpected" }, 500);
};

// --- capture logs (raw tokens must never be logged) -----------------------------------------
const logs = [];
for (const level of ["log", "info", "warn", "error", "debug"]) {
  const orig = console[level].bind(console);
  console[level] = (...a) => {
    const line = a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ");
    if (!line.startsWith("PASS  ") && !line.startsWith("FAIL  ")) logs.push(line);
    if (level === "error" && line.startsWith("FAIL  ")) orig(...a);
    else if (level === "log" && line.startsWith("PASS  ")) orig(...a);
    else if (process.env.G7F4S3B_DEBUG) orig(...a);
  };
}

// --- modules under test ---------------------------------------------------------------------
const sf = await import("../src/lib/sessions.functions.ts");
const inviteSrv = await import("../src/lib/staff-invite.server.ts");
const contract = await import("../src/lib/staff-invite-contract.ts");
const signupMod = await import("../src/lib/appointment-signup.server.ts");
const platformAdmins = await import("../src/lib/platform-admins.server.ts");
const tenantOwners = await import("../src/lib/platform-tenant-owners.server.ts");
const identity = await import("../src/lib/auth-identity.server.ts");
const authFns = await import("../src/lib/auth.functions.ts");
const smsStore = await import("../src/lib/auth-sms.store.server.ts");
const { requireSupabaseAuth } = await import("../src/integrations/supabase/auth-middleware.ts");

const def = (fn) => fn.__def;
async function invoke(fn, data, context) {
  const d = def(fn);
  const parsed = d.validator ? await d.validator(data) : data;
  return d.handler({ data: parsed, context });
}
const ctx = (userId) => ({ userId, claims: { sub: userId } });
const issued = [];
async function create(actor, data) {
  const res = await invoke(sf.createStaffInvite, data, ctx(actor));
  issued.push(res.token);
  return res;
}
const accept = (userId, token) => invoke(sf.acceptStaffInvite, { token }, ctx(userId));
const preview = (token) => invoke(sf.getStaffInvite, { token });
const inviteRow = (token) =>
  one(`select * from public.staff_invitations where token_hash = $1`, [
    inviteSrv.hashStaffInviteToken(token),
  ]);
const memberships = (userId) =>
  sql(`select tenant_id, role, active from public.tenant_memberships where user_id = $1`, [userId]);
async function grantRows(userId) {
  const counts = await one(
    `select
      (select count(*) from public.user_roles where user_id = $1)::int as roles,
      (select count(*) from public.profiles where id = $1)::int as profiles,
      (select count(*) from public.tenant_memberships where user_id = $1)::int as memberships,
      (select count(*) from public.admin_profiles where user_id = $1)::int as admin,
      (select count(*) from public.advisor_profiles where user_id = $1)::int as advisor,
      (select count(*) from public.introducers where user_id = $1)::int as introducer`,
    [userId],
  );
  return counts;
}
const noGrants = (c) => Object.values(c).every((n) => n === 0);
const isZodUnrecognized = (r, key) =>
  !r.ok &&
  JSON.stringify(r.error?.issues ?? []).includes("unrecognized_keys") &&
  JSON.stringify(r.error?.issues ?? []).includes(key);

// =============================================================================================
// 01, 35 valid adviser onboarding
// =============================================================================================
U.newAdv = await addUser("new.adviser@example.test", { userMeta: { full_name: "New Adviser" } });
const inv01 = await create(U.ownerA, { role: "advisor", email: "New.Adviser@Example.test " });
const r01 = await outcome(() => accept(U.newAdv, inv01.token));
const row01 = await inviteRow(inv01.token);
const adv01 = await one(`select code, tenant_id from public.advisor_profiles where user_id = $1`, [
  U.newAdv,
]);
ok(
  "01 valid matching verified invite accepted",
  r01.ok &&
    r01.value.membershipRole === "adviser" &&
    row01.used_by === U.newAdv &&
    row01.used_at !== null,
  r01.message ?? "",
);
ok(
  "35 valid adviser onboarding preserved (membership, role, tenant-bound code)",
  (await memberships(U.newAdv)).some(
    (m) => m.tenant_id === T.a && m.role === "adviser" && m.active,
  ) &&
    (await one(`select 1 from public.user_roles where user_id=$1 and role='advisor'`, [
      U.newAdv,
    ])) &&
    adv01?.tenant_id === T.a &&
    /^[A-Z0-9]{5}$/.test(adv01?.code ?? "") &&
    row01.email === "new.adviser@example.test",
);

// 02 wrong email
U.someoneElse = await addUser("someone.else@example.test");
const inv02 = await create(U.ownerA, { role: "advisor", email: "intended.02@example.test" });
const r02 = await outcome(() => accept(U.someoneElse, inv02.token));
ok(
  "02 wrong email rejected",
  !r02.ok &&
    /different email/.test(r02.message) &&
    (await inviteRow(inv02.token)).used_at === null &&
    noGrants(await grantRows(U.someoneElse)),
);

// 03 unverified email
U.unconfirmed = await addUser("unconfirmed.03@example.test", { confirmed: false });
const inv03 = await create(U.ownerA, { role: "advisor", email: "unconfirmed.03@example.test" });
const r03 = await outcome(() => accept(U.unconfirmed, inv03.token));
ok(
  "03 unverified email rejected",
  !r03.ok &&
    /Confirm your email/.test(r03.message) &&
    (await inviteRow(inv03.token)).used_at === null &&
    noGrants(await grantRows(U.unconfirmed)),
);

// 04 userId injection
U.victim = await addUser("victim@example.test");
const inv04 = await create(U.ownerA, { role: "advisor", email: "victim@example.test" });
const r04 = await outcome(() =>
  invoke(sf.acceptStaffInvite, { token: inv04.token, userId: U.victim }, ctx(U.someoneElse)),
);
ok(
  "04 userId injection rejected (strict schema, actor from context only)",
  isZodUnrecognized(r04, "userId") &&
    (await inviteRow(inv04.token)).used_at === null &&
    noGrants(await grantRows(U.victim)),
);

// 05 no session
const acceptDef = def(sf.acceptStaffInvite);
const mwServer = requireSupabaseAuth?.options?.server;
let nextCalled = false;
const runMw = (headers) => {
  globalThis.__g7f4s3bRequest = new Request("https://app.invalid/_serverFn/x", {
    method: "POST",
    headers,
  });
  return outcome(() =>
    mwServer({
      next: async () => {
        nextCalled = true;
        return {};
      },
      context: {},
      data: {},
    }),
  );
};
const r05 = await runMw({});
const r05b = await runMw({ authorization: "Bearer not-a-jwt" });
globalThis.__g7f4s3bRequest = undefined;
ok(
  "05 no session rejected (requireSupabaseAuth on acceptStaffInvite; middleware refuses without bearer)",
  acceptDef.method === "POST" &&
    acceptDef.middleware.includes(requireSupabaseAuth) &&
    typeof mwServer === "function" &&
    !r05.ok &&
    /^Unauthorized: No authorization header/.test(r05.message) &&
    !r05b.ok &&
    /^Unauthorized: Invalid token/.test(r05b.message) &&
    !nextCalled,
);

// 06 existing matching account
U.existing = await addUser("existing.staff@example.test");
await sql(`insert into public.profiles (id, email, full_name) values ($1,$2,'Existing Staff')`, [
  U.existing,
  "existing.staff@example.test",
]);
await sql(`insert into public.user_roles (user_id, role) values ($1,'customer')`, [U.existing]);
const inv06 = await create(U.ownerA, {
  role: "introducer",
  email: "existing.staff@example.test",
  companyMode: "new",
});
const r06 = await outcome(() => accept(U.existing, inv06.token));
ok(
  "06 existing matching account accepted",
  r06.ok &&
    (await memberships(U.existing)).some((m) => m.role === "introducer" && m.tenant_id === T.a),
  r06.message ?? "",
);

// 07 existing different account
const before07 = await grantRows(U.ownerB);
const inv07 = await create(U.ownerA, { role: "advisor", email: "intended.07@example.test" });
const r07 = await outcome(() => accept(U.ownerB, inv07.token));
ok(
  "07 existing different account rejected (no change to that account)",
  !r07.ok &&
    JSON.stringify(await grantRows(U.ownerB)) === JSON.stringify(before07) &&
    (await inviteRow(inv07.token)).used_at === null,
);

// 08 expired
U.exp = await addUser("expired.08@example.test");
const inv08 = await create(U.ownerA, { role: "advisor", email: "expired.08@example.test" });
await sql(
  `update public.staff_invitations set expires_at = now() - interval '1 minute' where token_hash = $1`,
  [inviteSrv.hashStaffInviteToken(inv08.token)],
);
const r08 = await outcome(() => accept(U.exp, inv08.token));
const p08 = await outcome(() => preview(inv08.token));
ok(
  "08 expired invite rejected",
  !r08.ok && /expired/.test(r08.message) && !p08.ok && noGrants(await grantRows(U.exp)),
);

// 09 used
const r09 = await outcome(() => accept(U.newAdv, inv01.token));
ok("09 used invite rejected", !r09.ok && /already been used/.test(r09.message));

// 10 invalid token
const r10a = await outcome(() => accept(U.newAdv, randomBytes(32).toString("base64url")));
const r10b = await outcome(() => accept(U.newAdv, "not a token!"));
const r10c = await outcome(() => preview(randomBytes(32).toString("base64url")));
ok("10 invalid token rejected", !r10a.ok && /not valid/.test(r10a.message) && !r10b.ok && !r10c.ok);

// 11, 46 suspended tenant
U.susp = await addUser("suspended.11@example.test");
const tok11 = inviteSrv.newStaffInviteToken();
await sql(
  `insert into public.staff_invitations (token_hash, role, membership_role, email, tenant_id)
   values ($1,'advisor','adviser','suspended.11@example.test',$2)`,
  [tok11.hash, T.s],
);
const r11 = await outcome(() => accept(U.susp, tok11.raw));
const p11 = await outcome(() => preview(tok11.raw));
ok(
  "11 suspended tenant rejected",
  !r11.ok &&
    /not currently accepting/.test(r11.message) &&
    !p11.ok &&
    noGrants(await grantRows(U.susp)),
);
U.susp46 = await addUser("suspended.46@example.test");
const inv46 = await invoke(
  sf.createStaffInvite,
  { role: "advisor", email: "suspended.46@example.test" },
  ctx(U.ownerB),
);
issued.push(inv46.token);
await sql(`update public.tenants set status = 'suspended' where id = $1`, [T.b]);
const r46 = await outcome(() => accept(U.susp46, inv46.token));
await sql(`update public.tenants set status = 'active' where id = $1`, [T.b]);
ok(
  "46 invite for a tenant suspended after issue rejected",
  !r46.ok &&
    /not currently accepting/.test(r46.message) &&
    (await inviteRow(inv46.token)).used_at === null &&
    noGrants(await grantRows(U.susp46)),
);

// 12 null-email legacy invite
U.anyone = await addUser("anyone.12@example.test");
const r12 = await outcome(() => accept(U.anyone, LEGACY.nullEmail));
const p12 = await outcome(() => preview(LEGACY.nullEmail));
const c12 = await outcome(() =>
  sql(
    `insert into public.staff_invitations (token_hash, role, membership_role, email, tenant_id)
     values ($1,'advisor','adviser',null,$2)`,
    [sha256("c12"), T.a],
  ),
);
ok(
  "12 null-email invite rejected (legacy row unusable; new rows blocked by constraint)",
  !r12.ok && !p12.ok && noGrants(await grantRows(U.anyone)) && !c12.ok && c12.code === "23514",
);

// 13 client role injection
const r13a = await outcome(() =>
  invoke(sf.acceptStaffInvite, { token: inv02.token, role: "admin" }, ctx(U.someoneElse)),
);
const r13b = await outcome(() =>
  invoke(sf.acceptStaffInvite, { token: inv02.token, membershipRole: "owner" }, ctx(U.someoneElse)),
);
ok(
  "13 client role injection rejected",
  isZodUnrecognized(r13a, "role") && isZodUnrecognized(r13b, "membershipRole"),
);

// 14 client tenant injection
const r14a = await outcome(() =>
  invoke(sf.acceptStaffInvite, { token: inv02.token, tenantId: T.b }, ctx(U.someoneElse)),
);
const r14b = await outcome(() =>
  invoke(
    sf.createStaffInvite,
    { role: "advisor", email: "t14@example.test", tenant_id: T.b },
    ctx(U.ownerA),
  ),
);
ok(
  "14 client tenant injection rejected",
  isZodUnrecognized(r14a, "tenantId") && isZodUnrecognized(r14b, "tenant_id"),
);

// 15, 39 platform Owner invite: link returned once, only the matching verified identity
const r15a = await outcome(() =>
  tenantOwners.addPlatformTenantOwnerImpl({
    userId: U.platform,
    companyCode: "901",
    firstName: "New",
    lastName: "Owner",
    email: "new.owner@example.test",
  }),
);
const ownerTok = r15a.value?.inviteToken;
if (ownerTok) issued.push(ownerTok);
const ownerRow = ownerTok ? await inviteRow(ownerTok) : null;
const r15wrong = ownerTok ? await outcome(() => accept(U.someoneElse, ownerTok)) : { ok: true };
U.newOwner = await addUser("new.owner@example.test", { confirmed: false });
const r15unconf = ownerTok ? await outcome(() => accept(U.newOwner, ownerTok)) : { ok: true };
await sql(`update auth.users set email_confirmed_at = now() where id = $1`, [U.newOwner]);
const r15ok = ownerTok ? await outcome(() => accept(U.newOwner, ownerTok)) : { ok: false };
ok(
  "15 Owner invite accepted only by the matching verified identity",
  r15a.ok &&
    r15a.value.outcome === "invited" &&
    ownerRow?.membership_role === "owner" &&
    !r15wrong.ok &&
    !r15unconf.ok &&
    r15ok.ok &&
    r15ok.value.membershipRole === "owner",
  r15a.message ?? r15ok.message ?? "",
);
const adm39 = await one(`select level, tenant_id from public.admin_profiles where user_id = $1`, [
  U.newOwner,
]);
const list39 = await outcome(() =>
  tenantOwners.listPlatformCompanyOwnersImpl({ userId: U.platform, companyCode: "901" }),
);
ok(
  "39 valid platform Owner onboarding preserved (owner membership + level; link only in create response)",
  (await memberships(U.newOwner)).some((m) => m.role === "owner" && m.tenant_id === T.a) &&
    adm39?.level === "owner" &&
    adm39?.tenant_id === T.a &&
    typeof r15a.value?.inviteRegisterPath === "string" &&
    r15a.value.inviteRegisterPath.includes(encodeURIComponent(ownerTok)) &&
    list39.ok &&
    !JSON.stringify(list39.value).includes(ownerTok) &&
    !/token/i.test(JSON.stringify(list39.value)),
);

// 16 cannot target another account
const victimBefore = await grantRows(U.victim);
const r16 = await outcome(() => accept(U.someoneElse, inv04.token));
ok(
  "16 cannot target another account",
  !r16.ok &&
    JSON.stringify(await grantRows(U.victim)) === JSON.stringify(victimBefore) &&
    (await inviteRow(inv04.token)).used_at === null,
);

// 17 cannot target platform account
const platBefore = JSON.stringify([
  await grantRows(U.platform),
  await sql(`select role from public.platform_roles where user_id = $1`, [U.platform]),
]);
const inv17 = await create(U.ownerA, { role: "advisor", email: "platform.owner@example.test" });
const r17 = await outcome(() => accept(U.someoneElse, inv17.token));
ok(
  "17 cannot target platform account",
  !r17.ok &&
    JSON.stringify([
      await grantRows(U.platform),
      await sql(`select role from public.platform_roles where user_id = $1`, [U.platform]),
    ]) === platBefore,
);

// 18 other-tenant account not silently modified
U.tbAdmin = await addUser("tb.admin@example.test");
await addMember(U.tbAdmin, T.b, "general", "admin");
await sql(
  `insert into public.admin_profiles (user_id, level, tenant_id) values ($1,'general',$2)`,
  [U.tbAdmin, T.b],
);
const before18 = JSON.stringify([
  await grantRows(U.tbAdmin),
  await one(`select level, tenant_id from public.admin_profiles where user_id = $1`, [U.tbAdmin]),
]);
const inv18 = await create(U.supA, {
  role: "admin",
  membershipRole: "general",
  email: "tb.admin@example.test",
});
const r18 = await outcome(() => accept(U.tbAdmin, inv18.token));
ok(
  "18 other-tenant admin not silently modified (fails closed, nothing written)",
  !r18.ok &&
    /another company/.test(r18.message) &&
    JSON.stringify([
      await grantRows(U.tbAdmin),
      await one(`select level, tenant_id from public.admin_profiles where user_id = $1`, [
        U.tbAdmin,
      ]),
    ]) === before18 &&
    (await inviteRow(inv18.token)).used_at === null,
);

// 19 existing Owner level not downgraded
U.ownerLevel = await addUser("owner.level@example.test");
await addMember(U.ownerLevel, T.a, "owner", "admin");
await sql(`insert into public.admin_profiles (user_id, level, tenant_id) values ($1,'owner',$2)`, [
  U.ownerLevel,
  T.a,
]);
const inv19 = await create(U.supA, {
  role: "admin",
  membershipRole: "general",
  email: "owner.level@example.test",
});
const r19 = await outcome(() => accept(U.ownerLevel, inv19.token));
const m19 = await memberships(U.ownerLevel);
ok(
  "19 existing Owner level not downgraded",
  r19.ok &&
    (await one(`select level from public.admin_profiles where user_id = $1`, [U.ownerLevel]))
      .level === "owner" &&
    m19.some((m) => m.role === "owner" && m.active),
  r19.message ?? "",
);

// 20, 21 profile safety
U.keep = await addUser("keep.email@example.test", {
  userMeta: { full_name: "Meta Name", phone: "+447700900999" },
});
await sql(
  `insert into public.profiles (id, email, full_name, phone) values ($1,'contact.alias@example.test','Kept Name','+447700900123')`,
  [U.keep],
);
const inv20 = await create(U.ownerA, { role: "advisor", email: "keep.email@example.test" });
const r20 = await outcome(() => accept(U.keep, inv20.token));
const p20 = await one(`select email, full_name, phone from public.profiles where id = $1`, [
  U.keep,
]);
ok(
  "20 profile email not overwritten",
  r20.ok && p20.email === "contact.alias@example.test",
  r20.message ?? "",
);
U.blank = await addUser("blank.profile@example.test", {
  userMeta: { full_name: "Filled Name", phone: "+447700900555" },
});
await sql(`insert into public.profiles (id, email, full_name, phone) values ($1,$2,null,'')`, [
  U.blank,
  "blank.profile@example.test",
]);
const inv21 = await create(U.ownerA, { role: "advisor", email: "blank.profile@example.test" });
await accept(U.blank, inv21.token);
const p21 = await one(`select full_name, phone from public.profiles where id = $1`, [U.blank]);
ok(
  "21 profile name/phone not nulled or replaced; only empty fields filled",
  p20.full_name === "Kept Name" &&
    p20.phone === "+447700900123" &&
    p21.full_name === "Filled Name" &&
    p21.phone === "+447700900555",
);

// 22, 23, 50 failure → rollback
U.joiner = await addUser("joiner.22@example.test");
const introCode = (
  await one(`select company_code from public.introducers where user_id = $1`, [U.existing])
).company_code;
const inv22 = await create(U.ownerA, {
  role: "introducer",
  email: "joiner.22@example.test",
  companyMode: "join",
  companyCode: introCode,
});
await sql(`update public.introducers set company_code = null where user_id = $1`, [U.existing]);
const r22 = await outcome(() => accept(U.joiner, inv22.token));
await sql(`update public.introducers set company_code = $2 where user_id = $1`, [
  U.existing,
  introCode,
]);
ok(
  "22 failed grant leaves invite unconsumed",
  !r22.ok &&
    /no longer exists/.test(r22.message) &&
    (await inviteRow(inv22.token)).used_at === null,
);
ok(
  "23a partial failure leaves no stray grant rows (company missing)",
  noGrants(await grantRows(U.joiner)),
);

U.rollback = await addUser("rollback.50@example.test", { userMeta: { full_name: "Roll Back" } });
await pg.exec(`
  create or replace function public.g7f4s3b_fail_membership() returns trigger language plpgsql as $$
  begin
    if new.user_id = '${U.rollback}'::uuid then raise exception 'g7f4s3b injected failure'; end if;
    return new;
  end $$;
  create trigger g7f4s3b_fail_membership before insert on public.tenant_memberships
    for each row execute function public.g7f4s3b_fail_membership();
`);
const inv50 = await create(U.ownerA, { role: "advisor", email: "rollback.50@example.test" });
const r50 = await outcome(() => accept(U.rollback, inv50.token));
const rows50 = await grantRows(U.rollback);
const invite50 = await inviteRow(inv50.token);
await pg.exec(`drop trigger g7f4s3b_fail_membership on public.tenant_memberships;
               drop function public.g7f4s3b_fail_membership();`);
ok(
  "23b partial failure at the last grant step leaves no stray rows (profile/role/advisor rolled back)",
  !r50.ok && noGrants(rows50),
);
ok(
  "50 invite grant transaction rollback verified (consumption rolled back; retry succeeds)",
  !r50.ok &&
    invite50.used_at === null &&
    invite50.used_by === null &&
    (await outcome(() => accept(U.rollback, inv50.token))).ok,
);

// 24 replay
const r24 = await outcome(() => accept(U.someoneElse, inv01.token));
const r24b = await outcome(() => accept(U.newAdv, inv01.token));
ok(
  "24 replay rejected",
  !r24.ok &&
    !r24b.ok &&
    (await memberships(U.newAdv)).filter((m) => m.role === "adviser").length === 1,
);

// 25, 49 concurrency
U.race = await addUser("race.25@example.test");
const inv25 = await create(U.ownerA, { role: "advisor", email: "race.25@example.test" });
const race = await Promise.all([
  outcome(() => accept(U.race, inv25.token)),
  outcome(() => accept(U.race, inv25.token)),
  outcome(() => accept(U.race, inv25.token)),
]);
ok(
  "25 concurrent accepts produce one winner",
  race.filter((r) => r.ok).length === 1 &&
    race.filter((r) => !r.ok).every((r) => /already been used/.test(r.message)) &&
    (await grantRows(U.race)).advisor === 1,
);
U.race2 = await addUser("race.49@example.test");
const inv49 = await create(U.ownerA, { role: "advisor", email: "race.49@example.test" });
const race2 = await Promise.all([
  outcome(() => accept(U.someoneElse, inv49.token)),
  outcome(() => accept(U.race2, inv49.token)),
  outcome(() => accept(U.race2, inv49.token)),
]);
const migSrc = strip(migration);
ok(
  "49 concurrent acceptance atomic (advisory lock + FOR UPDATE + conditional consume; single grant set)",
  race2.filter((r) => r.ok).length === 1 &&
    (await grantRows(U.race2)).memberships === 1 &&
    noGrants(await grantRows(U.someoneElse)) &&
    /pg_advisory_xact_lock\(872014004, hashtext\(p_token_hash\)\)/.test(migSrc) &&
    /WHERE si\.token_hash = p_token_hash\s+FOR UPDATE/.test(migSrc) &&
    /WHERE si\.id = v_inv\.id AND si\.used_at IS NULL/.test(migSrc),
  "PGlite is single-connection: races serialize; DB locking verified statically",
);

// 26, 27 hierarchy
const r26 = await outcome(() =>
  create(U.genA, { role: "admin", membershipRole: "supervisor", email: "t26@example.test" }),
);
const r26b = await outcome(() =>
  create(U.genA, { role: "admin", membershipRole: "general", email: "t26b@example.test" }),
);
const r26c = await outcome(() => create(U.genA, { role: "advisor", email: "t26c@example.test" }));
const r26d = await outcome(() =>
  create(U.supA, { role: "admin", membershipRole: "supervisor", email: "t26d@example.test" }),
);
const r26e = await outcome(() => create(U.advA, { role: "advisor", email: "t26e@example.test" }));
ok(
  "26 General cannot create Supervisor (or General) invite; Supervisor cannot create Supervisor; non-admin cannot invite",
  !r26.ok && !r26b.ok && r26c.ok && !r26d.ok && !r26e.ok,
);
const r27 = await Promise.all(
  [U.genA, U.supA, U.ownerA].map((u) =>
    outcome(() =>
      invoke(
        sf.createStaffInvite,
        { role: "admin", membershipRole: "owner", email: "t27@example.test" },
        ctx(u),
      ),
    ),
  ),
);
ok(
  "27 General (and every tenant rank) cannot create Owner invite",
  r27.every((r) => !r.ok && r.error?.name === "ZodError") &&
    !(await one(`select 1 from public.staff_invitations where email = 't27@example.test'`)),
);
ok(
  "27b matrix: owner→{supervisor,general,adviser,introducer}; supervisor→{general,adviser,introducer}; general→{adviser,introducer}",
  JSON.stringify(contract.invitableMembershipRoles("owner")) ===
    JSON.stringify(["supervisor", "general", "adviser", "introducer"]) &&
    JSON.stringify(contract.invitableMembershipRoles("supervisor")) ===
      JSON.stringify(["general", "adviser", "introducer"]) &&
    JSON.stringify(contract.invitableMembershipRoles("general")) ===
      JSON.stringify(["adviser", "introducer"]) &&
    contract.invitableMembershipRoles("none").length === 0,
);
const inv27rev = await create(U.ownerA, {
  role: "admin",
  membershipRole: "supervisor",
  email: "t27rev@example.test",
});
const r27rev = await outcome(() => invoke(sf.revokeStaffInvite, { id: inv27rev.id }, ctx(U.genA)));
const pendingOwner = await tenantOwners.addPlatformTenantOwnerImpl({
  userId: U.platform,
  companyCode: "901",
  firstName: "Pending",
  lastName: "Owner",
  email: "pending.owner@example.test",
});
issued.push(pendingOwner.inviteToken);
const pendingOwnerRow = await inviteRow(pendingOwner.inviteToken);
const r27own = await outcome(() =>
  invoke(sf.revokeStaffInvite, { id: pendingOwnerRow.id }, ctx(U.ownerA)),
);
const r27ok = await outcome(() => invoke(sf.revokeStaffInvite, { id: inv27rev.id }, ctx(U.ownerA)));
ok(
  "27c revoke by id respects hierarchy (General cannot revoke Supervisor invite; no tenant rank revokes Owner invite)",
  !r27rev.ok &&
    /can't revoke/.test(r27rev.message) &&
    !r27own.ok &&
    /can't revoke/.test(r27own.message) &&
    (await inviteRow(pendingOwner.inviteToken)) !== null &&
    r27ok.ok,
);

// 28–31 direct REST / RLS
const invRls = await create(U.ownerA, { role: "advisor", email: "rls@example.test" });
const rlsIns = await asAuthenticated(
  U.ownerA,
  `insert into public.staff_invitations (token_hash, role, membership_role, email, tenant_id)
   values ($1,'admin','owner','rls.insert@example.test',$2)`,
  [sha256("rls"), T.a],
);
const rlsUpd = await asAuthenticated(
  U.ownerA,
  `update public.staff_invitations set used_at = null, email = 'x@example.test' where tenant_id = $1`,
  [T.a],
);
const rlsDel = await asAuthenticated(
  U.ownerA,
  `delete from public.staff_invitations where tenant_id = $1`,
  [T.a],
);
const rlsSel = await asAuthenticated(
  U.ownerA,
  `select token_hash, email from public.staff_invitations`,
);
const anonSel = await (async () => {
  await pg.query("begin");
  try {
    await pg.query("set local role anon");
    await pg.query(`select * from public.staff_invitations`);
    return { ok: true };
  } catch (e) {
    return { ok: false, code: e.code };
  } finally {
    await pg.query("rollback");
  }
})();
ok("28 direct REST INSERT staff_invitations denied", !rlsIns.ok && rlsIns.code === "42501");
ok("29 direct REST UPDATE staff_invitations denied", !rlsUpd.ok && rlsUpd.code === "42501");
ok("30 direct REST DELETE staff_invitations denied", !rlsDel.ok && rlsDel.code === "42501");
ok(
  "31 direct REST SELECT does not expose token (no client SELECT; no raw token column at all)",
  !rlsSel.ok &&
    rlsSel.code === "42501" &&
    !anonSel.ok &&
    anonSel.code === "42501" &&
    !cols.includes("token"),
);
const policies = await sql(
  `select policyname from pg_policies where schemaname='public' and tablename='staff_invitations'`,
);
ok("31b staff_invitations has RLS enabled and no client policies", policies.length === 0);

// 32, 33, 47 token handling
const list32 = await invoke(sf.listStaffInvites, undefined, ctx(U.ownerA));
const listJson = JSON.stringify(list32);
ok(
  "32 listStaffInvites does not return token",
  Array.isArray(list32) &&
    list32.length > 0 &&
    list32.every((r) => !("token" in r) && !("token_hash" in r)) &&
    issued.every((t) => !listJson.includes(t)) &&
    !listJson.includes(inviteSrv.hashStaffInviteToken(invRls.token)),
);
const row33 = await inviteRow(invRls.token);
const p33 = await preview(invRls.token);
ok(
  "33 createStaffInvite returns token/link only once (DB holds sha256 only; preview and list omit it)",
  typeof invRls.token === "string" &&
    invRls.token.length >= 43 &&
    invRls.registerPath === `/register?invite=${encodeURIComponent(invRls.token)}` &&
    row33.token_hash === sha256(invRls.token) &&
    !Object.values(row33).some((v) => v === invRls.token) &&
    !JSON.stringify(p33).includes(invRls.token) &&
    !("tenantId" in p33) &&
    p33.email === "rls@example.test",
);
const panels = code("src/components/staff/panels/staff-panels.tsx");
const inviteCard = panels.slice(
  panels.indexOf("export function InviteStaffCard"),
  panels.indexOf("// Refer a friend"),
);
ok(
  "47 raw token absent from management loader/UI (list rows metadata-only; no historical copy-link)",
  inviteCard.length > 0 &&
    !/inv\.token/.test(inviteCard) &&
    !/CopyLinkButton value=\{inviteUrl\(inv/.test(inviteCard) &&
    /created\.registerPath/.test(inviteCard) &&
    list39.ok,
);

// 34 role/membership mismatch
const r34a = await outcome(() =>
  create(U.ownerA, { role: "advisor", membershipRole: "general", email: "t34@example.test" }),
);
const r34b = await outcome(() =>
  create(U.ownerA, { role: "admin", membershipRole: "adviser", email: "t34b@example.test" }),
);
U.legacyMismatch = await addUser("legacy.mismatch@example.test");
const r34c = await outcome(() => accept(U.legacyMismatch, LEGACY.mismatch));
const r34d = await outcome(() =>
  sql(
    `insert into public.staff_invitations (token_hash, role, membership_role, email, tenant_id)
     values ($1,'introducer','supervisor','t34d@example.test',$2)`,
    [sha256("t34d"), T.a],
  ),
);
ok(
  "34 mismatched role/membership rejected (create, legacy accept, DB constraint)",
  !r34a.ok && !r34b.ok && !r34c.ok && noGrants(await grantRows(U.legacyMismatch)) && !r34d.ok,
);

// 36 introducer onboarding (new company + join)
const intro36 = await one(
  `select company_code, company_name, slug, contact_email, tenant_id from public.introducers where user_id = $1`,
  [U.existing],
);
U.joiner36 = await addUser("joiner.36@example.test");
const inv36 = await create(U.ownerA, {
  role: "introducer",
  email: "joiner.36@example.test",
  companyMode: "join",
  companyCode: intro36.company_code,
});
const r36 = await outcome(() => accept(U.joiner36, inv36.token));
const join36 = await one(
  `select company_code, company_name, tenant_id from public.introducers where user_id = $1`,
  [U.joiner36],
);
ok(
  "36 valid introducer onboarding preserved (new company + join existing)",
  /^[0-9]{4}$/.test(intro36.company_code ?? "") &&
    intro36.tenant_id === T.a &&
    intro36.contact_email === "existing.staff@example.test" &&
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(intro36.slug) &&
    r36.ok &&
    join36?.company_code === intro36.company_code &&
    join36?.company_name === intro36.company_name &&
    join36?.tenant_id === T.a,
  r36.message ?? "",
);

// 37 General, 38 Supervisor onboarding
U.gen37 = await addUser("general.37@example.test");
const inv37 = await create(U.supA, { role: "admin", email: "general.37@example.test" });
const r37 = await outcome(() => accept(U.gen37, inv37.token));
const a37 = await one(`select level, tenant_id from public.admin_profiles where user_id = $1`, [
  U.gen37,
]);
ok(
  "37 valid General onboarding preserved",
  r37.ok &&
    a37?.level === "general" &&
    a37?.tenant_id === T.a &&
    (await memberships(U.gen37)).some((m) => m.role === "general"),
  r37.message ?? "",
);
U.sup38 = await addUser("supervisor.38@example.test");
const inv38 = await create(U.ownerA, {
  role: "admin",
  membershipRole: "supervisor",
  email: "supervisor.38@example.test",
});
const r38 = await outcome(() => accept(U.sup38, inv38.token));
const a38 = await one(`select level from public.admin_profiles where user_id = $1`, [U.sup38]);
ok(
  "38 valid Supervisor onboarding preserved",
  r38.ok &&
    a38?.level === "supervisor" &&
    (await memberships(U.sup38)).some((m) => m.role === "supervisor"),
  r38.message ?? "",
);

// legacy uuid link still accepted by its verified addressee
U.legacyAdv = await addUser("legacy.adviser@example.test");
const rLegacy = await outcome(() => accept(U.legacyAdv, LEGACY.open.toUpperCase()));
ok(
  "38b legacy uuid link (backfilled hash) accepted by its verified addressee",
  rLegacy.ok,
  rLegacy.message ?? "",
);

// =============================================================================================
// 40–43 appointment signup identity (L) + S1B protections
// =============================================================================================
let sms = [];
let books = [];
const deps = () => {
  sms = [];
  books = [];
  return {
    book: async (booking, actingUserId) => {
      books.push({ booking, actingUserId });
      return { id: "appt" };
    },
    sendSms: async (o) => {
      sms.push(o);
      return { sid: "SMsynthetic" };
    },
    isTwilioConfigured: () => true,
  };
};
const SLOT = "2026-10-05T09:00:00.000Z";
const createUserCalls = () =>
  calls.filter((c) => c.path === "/auth/v1/admin/users" && c.method === "POST");
calls.length = 0;
const s40 = await signupMod.customerAppointmentSignupImpl(
  {
    customerName: "Booked Customer",
    customerPhone: "07700 900401",
    customerEmail: "Booked.Customer@example.test",
    startsAt: SLOT,
  },
  deps(),
);
const created40 = await one(
  `select u.id, u.email, u.email_confirmed_at, u.raw_app_meta_data, p.email as profile_email
   from auth.users u join public.profiles p on p.id = u.id where p.phone = '+447700900401'`,
);
const realEmailAuth = await one(
  `select 1 from auth.users where lower(email) = 'booked.customer@example.test'`,
);
const inv40 = await create(U.ownerA, { role: "advisor", email: "booked.customer@example.test" });
const r40 = await outcome(() => accept(created40.id, inv40.token));
ok(
  "40 customerAppointmentSignup does not create a confirmed Auth user at the caller-supplied real email",
  !realEmailAuth &&
    created40.email === "phone+447700900401@customers.mortgagehub.local" &&
    created40.raw_app_meta_data?.mh_identity === "appointment_customer" &&
    created40.raw_app_meta_data?.contact_email === "booked.customer@example.test" &&
    created40.profile_email === "booked.customer@example.test" &&
    !r40.ok &&
    (await inviteRow(inv40.token)).used_at === null,
);
const code41 = sms[0]?.body?.match(/Sign-in code: (\d{6})/)?.[1] ?? "";
calls.length = 0;
const v41 = await outcome(() =>
  signupMod.verifyAppointmentSignupSmsImpl({ phone: "07700 900401", code: code41 }),
);
const link41 = calls.find((c) => c.path === "/auth/v1/admin/generate_link");
ok(
  "41 S1B new customer flow preserved (created once, booking linked, SMS code, magic link for bound synthetic identity)",
  s40.needsSmsCode === true &&
    books[0]?.booking.customerId === created40.id &&
    sms[0]?.to === "+447700900401" &&
    v41.ok &&
    v41.value.tokenHash === `synthetic-hash-${created40.id}` &&
    link41?.body?.email === "phone+447700900401@customers.mortgagehub.local",
);
U.existingCust = await addUser("existing.customer@example.test");
await sql(
  `insert into public.profiles (id, email, phone) values ($1,'existing.customer@example.test','+447700900420')`,
  [U.existingCust],
);
calls.length = 0;
const s42 = await signupMod.customerAppointmentSignupImpl(
  {
    customerName: "Attacker",
    customerPhone: "07700 900499",
    customerEmail: "existing.customer@example.test",
    startsAt: SLOT,
  },
  deps(),
);
const cu42 = createUserCalls().length;
const sms42 = sms.length;
const book42 = books[0]?.booking.customerId;
calls.length = 0;
const s42b = await signupMod.customerAppointmentSignupImpl(
  {
    customerName: "Booked Again",
    customerPhone: "07700 900498",
    customerEmail: "booked.customer@example.test",
    startsAt: SLOT,
  },
  deps(),
);
U.spoof = await addUser("spoof.owner@example.test");
await sql(`insert into public.profiles (id, email) values ($1,'victim.profile@example.test')`, [
  U.spoof,
]);
calls.length = 0;
const s42c = await signupMod.customerAppointmentSignupImpl(
  {
    customerName: "Spoof",
    customerPhone: "07700 900497",
    customerEmail: "victim.profile@example.test",
    startsAt: SLOT,
  },
  deps(),
);
ok(
  "42 S1B email collision protection preserved (existing email: no account, no code; contact_email marker reuses; spoofed profile email ambiguous)",
  cu42 === 0 &&
    sms42 === 0 &&
    book42 === undefined &&
    s42.needsSmsCode === false &&
    s42b.needsSmsCode === false &&
    createUserCalls().length === 0 &&
    s42c.needsSmsCode === false &&
    books[0]?.booking.customerId === undefined,
);
calls.length = 0;
const s43 = await signupMod.customerAppointmentSignupImpl(
  { customerName: "Phone Match", customerPhone: "07700 900420", customerEmail: "", startsAt: SLOT },
  deps(),
);
ok(
  "43 S1B phone collision protection preserved",
  createUserCalls().length === 0 && s43.needsSmsCode === false && sms.length === 0,
);
const staffNew = await signupMod.resolveCustomerIdForStaffBooking({
  customerName: "Staff New",
  customerPhone: "07700 900430",
  customerEmail: "staff.new@example.test",
});
const staffNewUser = await one(`select email, raw_app_meta_data from auth.users where id = $1`, [
  staffNew,
]);
ok(
  "43b staff-created customers also get the synthetic identity (no unverified real-email Auth identity)",
  staffNewUser.email === "phone+447700900430@customers.mortgagehub.local" &&
    staffNewUser.raw_app_meta_data?.contact_email === "staff.new@example.test",
);

// =============================================================================================
// G7F-4S3D — customer re-entry, duplicate prevention, introducer business identity
// =============================================================================================
const s3dFailures = [];
let s3dTotal = 0;
function okD(name, cond, detail = "") {
  s3dTotal += 1;
  if (!cond) s3dFailures.push(name);
  ok(`S3D-${name}`, cond, detail);
}
{
  await pg.exec(`
  create table public.customer_introducer_links (
    customer_id uuid primary key references auth.users(id),
    introducer_id uuid not null references public.introducers(id),
    source text, created_at timestamptz not null default now()
  );
  create table public.commission_rates (
    id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id),
    role text not null, percentage numeric(6,3) not null, unique (user_id, role)
  );
  create table public.appointments (
    id uuid primary key default gen_random_uuid(), advisor_id uuid not null references auth.users(id),
    introducer_id uuid references public.introducers(id), customer_id uuid references auth.users(id),
    customer_phone text not null, starts_at timestamptz not null
  );
  create table public.interview_sessions (
    id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id),
    advisor_id uuid references auth.users(id)
  );
`);
  const lookupPriv = await one(
    `select
     has_function_privilege('anon', 'public.lookup_auth_identity_by_email(text)', 'EXECUTE') as a1,
     has_function_privilege('authenticated', 'public.lookup_auth_identity_by_email(text)', 'EXECUTE') as u1,
     has_function_privilege('service_role', 'public.lookup_auth_identity_by_email(text)', 'EXECUTE') as s1,
     has_function_privilege('anon', 'public.lookup_appointment_identities_by_contact_email(text)', 'EXECUTE') as a2,
     has_function_privilege('authenticated', 'public.lookup_appointment_identities_by_contact_email(text)', 'EXECUTE') as u2,
     has_function_privilege('service_role', 'public.lookup_appointment_identities_by_contact_email(text)', 'EXECUTE') as s2,
     (select bool_and(prosecdef) from pg_proc where proname in
       ('lookup_auth_identity_by_email','lookup_appointment_identities_by_contact_email')) as secdef`,
  );
  okD(
    "00 identity lookup functions are SECURITY DEFINER and service_role only",
    lookupPriv.secdef &&
      !lookupPriv.a1 &&
      !lookupPriv.u1 &&
      lookupPriv.s1 &&
      !lookupPriv.a2 &&
      !lookupPriv.u2 &&
      lookupPriv.s2,
  );

  let dSms = [];
  const reentryDeps = (twilio = true) => ({
    isTwilioConfigured: () => twilio,
    sendSms: async (o) => {
      dSms.push(o);
      return { sid: "SMsynthetic" };
    },
  });
  const dCode = (i = 0) => dSms[i]?.body?.match(/sign-in code is (\d{6})/)?.[1] ?? "";
  const allCodes = [];
  const startReentry = async (phone, twilio = true) => {
    dSms = [];
    const r = await outcome(() =>
      signupMod.startCustomerPhoneSignInImpl({ phone }, reentryDeps(twilio)),
    );
    for (let i = 0; i < dSms.length; i += 1) allCodes.push(dCode(i));
    return r;
  };
  const verifyReentry = (phone, codeValue) =>
    outcome(() => signupMod.verifyAppointmentSignupSmsImpl({ phone, code: codeValue }));
  const linkCallsNow = () => calls.filter((c) => c.path === "/auth/v1/admin/generate_link");
  const authUserCount = async () => (await one(`select count(*)::int as n from auth.users`)).n;
  async function bookedCustomer(localPhone, email) {
    await signupMod.customerAppointmentSignupImpl(
      {
        customerName: "Booked Reentry",
        customerPhone: localPhone,
        customerEmail: email,
        startsAt: SLOT,
      },
      { ...deps(), isTwilioConfigured: () => false },
    );
    const e164 = `+44${localPhone.replace(/\D/g, "").slice(1)}`;
    return (
      await one(`select id from auth.users where email = $1`, [
        `phone+${e164.slice(1)}@customers.mortgagehub.local`,
      ])
    ).id;
  }
  U.c1 = await bookedCustomer("07700 900501", "C1.Contact@example.test");
  U.c2 = await bookedCustomer("07700 900511", "c2.contact@example.test");
  U.c3 = await bookedCustomer("07700 900512", "c3.contact@example.test");
  U.c4 = await bookedCustomer("07700 900513", "c4.contact@example.test");
  U.c5 = await bookedCustomer("07700 900514", "c5.contact@example.test");

  // business relationships attached to the existing identities
  const introExisting = await one(
    `select id, company_code, company_name, slug, contact_email, tenant_id from public.introducers where user_id = $1`,
    [U.existing],
  );
  await sql(
    `insert into public.customer_introducer_links (customer_id, introducer_id, source) values ($1,$2,'referral')`,
    [U.c1, introExisting.id],
  );
  await sql(
    `insert into public.commission_rates (user_id, role, percentage) values ($1,'introducer',12.5), ($2,'advisor',30)`,
    [U.existing, U.newAdv],
  );
  await sql(
    `insert into public.appointments (advisor_id, introducer_id, customer_id, customer_phone, starts_at)
   values ($1,$2,$3,'+447700900501',$4)`,
    [U.newAdv, introExisting.id, U.c1, SLOT],
  );
  await sql(`insert into public.interview_sessions (user_id, advisor_id) values ($1,$2)`, [
    U.c1,
    U.newAdv,
  ]);
  const relSnapshot = async () =>
    JSON.stringify({
      links: await sql(
        `select customer_id, introducer_id, source from public.customer_introducer_links order by customer_id`,
      ),
      commission: await sql(
        `select user_id, role, percentage from public.commission_rates order by user_id, role`,
      ),
      appts: await sql(
        `select id, advisor_id, introducer_id, customer_id from public.appointments order by id`,
      ),
      cases: await sql(`select id, user_id, advisor_id from public.interview_sessions order by id`),
    });
  const adminSnapshot = async () =>
    JSON.stringify({
      m: await sql(
        `select user_id, tenant_id, role, active from public.tenant_memberships
       where user_id = any($1::uuid[]) order by user_id, tenant_id, role`,
        [[U.ownerA, U.supA, U.genA, U.ownerB]],
      ),
      a: await sql(
        `select user_id, level, tenant_id from public.admin_profiles where user_id = any($1::uuid[]) order by user_id`,
        [[U.ownerA, U.supA, U.genA, U.ownerB]],
      ),
      p: await sql(
        `select user_id, permission_key, access, tenant_id from public.admin_permissions order by user_id, permission_key`,
      ),
    });
  const advSnapshot = async () =>
    JSON.stringify(
      await sql(
        `select user_id, code, tenant_id, deleted_at from public.advisor_profiles order by user_id`,
      ),
    );
  const rel0 = await relSnapshot();
  const admin0 = await adminSnapshot();
  const adv0 = await advSnapshot();
  const c1Before = await one(`select id, email, raw_app_meta_data from auth.users where id = $1`, [
    U.c1,
  ]);

  // --- customer re-entry ---------------------------------------------------------------------
  calls.length = 0;
  const usersBefore = await authUserCount();
  const d1 = await startReentry("07700 900501");
  const code1 = dCode();
  okD(
    "01 booking-created customer can begin secure re-entry (code texted to the identity's phone)",
    d1.ok &&
      dSms.length === 1 &&
      dSms[0].to === "+447700900501" &&
      /^\d{6}$/.test(code1) &&
      d1.value.message === signupMod.CUSTOMER_PHONE_SIGN_IN_SENT &&
      !JSON.stringify(d1.value).includes(code1),
    d1.message ?? "",
  );
  const v2a = await outcome(() =>
    def(authFns.startCustomerPhoneSignIn).validator({ phone: "07700 900501", userId: U.ownerA }),
  );
  const v2b = await outcome(() =>
    def(authFns.verifyCustomerPhoneSignIn).validator({
      phone: "07700 900501",
      code: "123456",
      userId: U.ownerA,
    }),
  );
  okD(
    "02 browser cannot supply an actor userId (strict validators; no auth middleware trusts a body id)",
    isZodUnrecognized(v2a, "userId") &&
      isZodUnrecognized(v2b, "userId") &&
      def(authFns.startCustomerPhoneSignIn).middleware.length === 0 &&
      !/userId/.test(
        code("src/routes/auth.tsx").match(/startCustomerPhoneSignInFn\([\s\S]*?\}\)/)?.[0] ??
          "userId",
      ),
  );
  okD(
    "03 challenge binds to the server-resolved customer (lookup via Auth identity, not caller data)",
    calls.some((c) => c.path === "/rest/v1/rpc/lookup_auth_identity_by_email") &&
      calls.find((c) => c.path === "/rest/v1/rpc/lookup_auth_identity_by_email")?.body?.p_email ===
        "phone+447700900501@customers.mortgagehub.local",
  );
  // profiles.phone is user-editable: moving it elsewhere neither redirects nor disables re-entry
  await sql(`update public.profiles set phone = '+447700900599' where id = $1`, [U.c1]);
  const d4a = await startReentry("07700 900599");
  const sms4a = dSms.length;
  const v4extra = await outcome(() =>
    def(authFns.startCustomerPhoneSignIn).validator({ phone: "07700 900501", to: "+447700900599" }),
  );
  okD(
    "04 challenge uses the identity-bound phone only (profiles.phone edit ignored; no caller destination)",
    d4a.ok && sms4a === 0 && isZodUnrecognized(v4extra, "to"),
  );
  await sql(`update public.profiles set phone = '+447700900501' where id = $1`, [U.c1]);

  calls.length = 0;
  const v5 = await verifyReentry("07700 900501", code1 === "000001" ? "000002" : "000001");
  okD("05 wrong OTP rejected (no magic link)", !v5.ok && linkCallsNow().length === 0);

  const d6 = await startReentry("07700 900511");
  const code6 = dCode();
  const realNow = Date.now;
  Date.now = () => realNow() + 11 * 60 * 1000;
  const v6 = await verifyReentry("07700 900511", code6);
  Date.now = realNow;
  okD("06 expired OTP rejected", d6.ok && code6 && !v6.ok && linkCallsNow().length === 0);

  calls.length = 0;
  const v7a = await verifyReentry("07700 900501", code1);
  const v7b = await verifyReentry("07700 900501", code1);
  const link7Email = linkCallsNow()[0]?.body?.email;
  okD("07 used OTP rejected (single use)", v7a.ok && !v7b.ok && linkCallsNow().length === 1);

  const d8 = await startReentry("07700 900512");
  const code8 = dCode();
  for (let i = 0; i < 5; i += 1)
    await verifyReentry("07700 900512", code8 === "999999" ? "999998" : "999999");
  calls.length = 0;
  const v8 = await verifyReentry("07700 900512", code8);
  okD(
    "08 attempt limit enforced (correct code refused after 5 failures)",
    d8.ok && !v8.ok && linkCallsNow().length === 0,
  );

  const d9a = await startReentry("07700 900513");
  const d9b = await startReentry("07700 900513");
  const sms9b = dSms.length;
  const tPhone = "+447700900999";
  const t0 = 1_900_000_000_000;
  const windowResults = [0, 1, 2, 3, 4, 5].map((i) =>
    smsStore.reserveCustomerSmsSend(tPhone, t0 + i * 61_000),
  );
  const afterHour = smsStore.reserveCustomerSmsSend(tPhone, t0 + 61 * 60 * 1000);
  const tooSoon = smsStore.reserveCustomerSmsSend("+447700900998", t0);
  const tooSoon2 = smsStore.reserveCustomerSmsSend("+447700900998", t0 + 30_000);
  okD(
    "09 resend/rate control enforced (60s minimum, 5 per hour, per phone; throttled request sends nothing)",
    d9a.ok &&
      !d9b.ok &&
      /wait/i.test(d9b.message) &&
      sms9b === 0 &&
      JSON.stringify(windowResults) === JSON.stringify([true, true, true, true, true, false]) &&
      afterHour === true &&
      tooSoon === true &&
      tooSoon2 === false,
  );
  okD(
    "10 successful OTP returns the SAME Auth user identity (no new user, email and id unchanged)",
    v7a.ok &&
      v7a.value.tokenHash === `synthetic-hash-${U.c1}` &&
      link7Email === "phone+447700900501@customers.mortgagehub.local" &&
      (await authUserCount()) === usersBefore &&
      JSON.stringify(
        await one(`select id, email, raw_app_meta_data from auth.users where id = $1`, [U.c1]),
      ) === JSON.stringify(c1Before),
  );

  // privileged identities: marked synthetic identity with staff authority, and real-email staff
  U.privSynthetic = await addUser("phone+447700900503@customers.mortgagehub.local", {
    appMeta: { mh_identity: "appointment_customer", contact_email: "priv.contact@example.test" },
  });
  await addMember(U.privSynthetic, T.a, "general", "admin");
  U.privPlatform = await addUser("phone+447700900515@customers.mortgagehub.local", {
    appMeta: { mh_identity: "appointment_customer" },
  });
  await sql(`insert into public.platform_roles (user_id, role) values ($1,'super_admin')`, [
    U.privPlatform,
  ]);
  U.privReal = await addUser("priv.phone@example.test");
  await sql(
    `insert into public.profiles (id, email, phone) values ($1,'priv.phone@example.test','+447700900504')`,
    [U.privReal],
  );
  await addMember(U.privReal, T.a, "owner", "admin");
  const d11a = await startReentry("07700 900503");
  const s11a = dSms.length;
  const d11b = await startReentry("07700 900515");
  const s11b = dSms.length;
  const d11c = await startReentry("07700 900504");
  const s11c = dSms.length;
  smsStore.storeAppointmentSignupChallenge("+447700900503", U.privSynthetic, "424242");
  calls.length = 0;
  const v11 = await verifyReentry("07700 900503", "424242");
  okD(
    "11 privileged identity refused (no SMS, same generic response, forged challenge yields no link)",
    [d11a, d11b, d11c].every(
      (r) => r.ok && r.value.message === signupMod.CUSTOMER_PHONE_SIGN_IN_SENT,
    ) &&
      s11a + s11b + s11c === 0 &&
      !v11.ok &&
      linkCallsNow().length === 0,
  );

  await addUser("phone+447700900507@customers.mortgagehub.local", {
    appMeta: { mh_identity: "appointment_customer" },
  });
  await addUser("phone+447700900507@customers.mortgagehub.local", {
    appMeta: { mh_identity: "appointment_customer" },
  });
  const d12 = await startReentry("07700 900507");
  okD(
    "12 ambiguous customer match refused (no SMS, generic response)",
    d12.ok && dSms.length === 0,
  );

  const d13 = await startReentry("07700 900505");
  const v13 = await verifyReentry("07700 900505", "123456");
  const d13t = await startReentry("07700 900506", false);
  const d13bad = await startReentry("12345");
  okD(
    "13 unknown customer fails safely (identical response, no SMS, no challenge; Twilio absent fails closed)",
    d13.ok &&
      d13.value.message === d1.value.message &&
      dSms.length === 0 &&
      !v13.ok &&
      !d13t.ok &&
      /isn't available/.test(d13t.message) &&
      !d13bad.ok,
  );

  const d14 = await startReentry("07700 900514");
  const code14 = dCode();
  calls.length = 0;
  const v14a = await verifyReentry("07700 900599", code14);
  smsStore.storeAppointmentSignupChallenge("+447700900598", U.c5, "515151");
  const v14b = await verifyReentry("07700 900598", "515151");
  const v14c = await verifyReentry("07700 900514", code14);
  okD(
    "14 caller cannot substitute another phone (code bound to its phone; challenge on a foreign phone refused)",
    d14.ok && !v14a.ok && !v14b.ok && v14c.ok && v14c.value.tokenHash === `synthetic-hash-${U.c5}`,
  );

  calls.length = 0;
  const v15a = await outcome(() =>
    def(authFns.startCustomerPhoneSignIn).validator({
      phone: "07700 900501",
      email: "c1.contact@example.test",
    }),
  );
  const s15 = await signupMod.customerAppointmentSignupImpl(
    {
      customerName: "Taker",
      customerPhone: "07700 900520",
      customerEmail: "c1.contact@example.test",
      startsAt: SLOT,
    },
    deps(),
  );
  const chk15 = await signupMod.checkCustomerSignupEmailImpl({ email: "c1.contact@example.test" });
  okD(
    "15 caller cannot substitute another email to take over the identity",
    isZodUnrecognized(v15a, "email") &&
      s15.needsSmsCode === false &&
      sms.length === 0 &&
      books[0]?.booking.customerId === undefined &&
      JSON.stringify(chk15) === JSON.stringify({ status: "use_phone_sign_in" }) &&
      !calls.some((c) => /^\/auth\/v1\/admin\/users\//.test(c.path) && c.method === "PUT") &&
      !calls.some((c) => c.path === "/auth/v1/admin/generate_link") &&
      JSON.stringify(
        await one(`select id, email, raw_app_meta_data from auth.users where id = $1`, [U.c1]),
      ) === JSON.stringify(c1Before),
  );

  // --- duplicate prevention ------------------------------------------------------------------
  const chk16 = await signupMod.checkCustomerSignupEmailImpl({
    email: " C1.CONTACT@Example.test ",
  });
  okD(
    "16 booking-created customer's real contact email recognised",
    chk16.status === "use_phone_sign_in",
  );
  const authSrc = code("src/routes/auth.tsx");
  const signupBlock = authSrc.slice(authSrc.indexOf('if (mode === "signup")'));
  const preIdx = signupBlock.indexOf("checkCustomerSignupEmailFn(");
  const signUpIdx = signupBlock.indexOf("supabase.auth.signUp(");
  const usersBefore17 = await authUserCount();
  okD(
    "17 ordinary signup is routed to phone sign-in before any second identity is created",
    preIdx > 0 &&
      signUpIdx > preIdx &&
      /existing\.status === "use_phone_sign_in"\)\s*\{\s*switchMode\("phone"\);[\s\S]*?return;/.test(
        signupBlock.slice(preIdx, signUpIdx),
      ) &&
      (await authUserCount()) === usersBefore17,
  );
  await addUser("phone+447700900521@customers.mortgagehub.local", {
    appMeta: { mh_identity: "appointment_customer", contact_email: "shared.contact@example.test" },
  });
  await addUser("phone+447700900522@customers.mortgagehub.local", {
    appMeta: { mh_identity: "appointment_customer", contact_email: "shared.contact@example.test" },
  });
  calls.length = 0;
  const chk18 = await signupMod.checkCustomerSignupEmailImpl({
    email: "shared.contact@example.test",
  });
  okD(
    "18 ambiguous contact-email match fails closed (blocked, same answer, nothing merged or written)",
    JSON.stringify(chk18) === JSON.stringify(chk16) &&
      calls.every((c) => c.method === "GET" || c.path.startsWith("/rest/v1/rpc/")),
  );
  const chk19a = await signupMod.checkCustomerSignupEmailImpl({
    email: "priv.contact@example.test",
  });
  const chk19b = await signupMod.checkCustomerSignupEmailImpl({ email: "owner.a@example.test" });
  const chk20 = await signupMod.checkCustomerSignupEmailImpl({
    email: "brand.new.person@example.test",
  });
  okD(
    "19 privileged collision fails closed without exposure (marked staff identity blocked like any match; staff Auth email indistinguishable from unknown)",
    JSON.stringify(chk19a) === JSON.stringify(chk16) &&
      JSON.stringify(chk19b) === JSON.stringify(chk20),
  );
  const v20 = await outcome(() =>
    def(authFns.checkCustomerSignupEmail).validator({ email: "x@example.test", userId: U.ownerA }),
  );
  okD(
    "20 unrelated new customer can still register normally (pre-check returns ok; strict input)",
    chk20.status === "ok" && isZodUnrecognized(v20, "userId"),
  );

  // --- introducer business identity ----------------------------------------------------------
  const introRow = () =>
    one(
      `select id, company_code, company_name, slug, contact_email, tenant_id, active, deleted_at
     from public.introducers where user_id = $1`,
      [U.existing],
    );
  const intro0 = await introRow();
  await sql(`update public.introducers set active = false, deleted_at = now() where user_id = $1`, [
    U.existing,
  ]);
  const inv21 = await create(U.ownerA, {
    role: "introducer",
    email: "existing.staff@example.test",
    companyMode: "join",
    companyCode: intro0.company_code,
  });
  const r21 = await outcome(() => accept(U.existing, inv21.token));
  const intro21 = await introRow();
  const grants21 = await grantRows(U.existing);
  const mem21 = JSON.stringify(await memberships(U.existing));
  const inv21b = await create(U.ownerA, {
    role: "introducer",
    email: "existing.staff@example.test",
    companyMode: "new",
  });
  const r21b = await outcome(() => accept(U.existing, inv21b.token));
  const intro21b = await introRow();
  okD(
    "21 same-tenant re-invite preserves company_code (join reactivates; new-company re-invite fails closed)",
    r21.ok &&
      intro21.company_code === intro0.company_code &&
      intro21.company_name === intro0.company_name &&
      intro21.active === true &&
      intro21.deleted_at === null &&
      !r21b.ok &&
      r21b.code === "staff_invite_introducer_company_conflict" &&
      intro21b.company_code === intro0.company_code &&
      (await inviteRow(inv21b.token)).used_at === null,
    r21.message ?? r21b.message ?? "",
  );
  okD(
    "22 same-tenant re-invite preserves introducer id",
    intro21.id === intro0.id && intro21b.id === intro0.id,
  );
  okD(
    "23 referral slug and contact email unchanged",
    intro21.slug === intro0.slug &&
      intro21.contact_email === intro0.contact_email &&
      intro21b.slug === intro0.slug,
  );

  // a second introducer company in the same tenant
  U.introB = await addUser("intro.b@example.test");
  const invB = await create(U.ownerA, {
    role: "introducer",
    email: "intro.b@example.test",
    companyMode: "new",
  });
  const rB = await outcome(() => accept(U.introB, invB.token));
  const codeB = (
    await one(`select company_code from public.introducers where user_id = $1`, [U.introB])
  )?.company_code;
  const inv26 = await create(U.ownerA, {
    role: "introducer",
    email: "existing.staff@example.test",
    companyMode: "join",
    companyCode: codeB,
  });
  const r26 = await outcome(() => accept(U.existing, inv26.token));
  const intro26 = await introRow();
  okD(
    "26 different-company invite fails closed (no silent transfer, no duplicate)",
    rB.ok &&
      codeB &&
      codeB !== intro0.company_code &&
      !r26.ok &&
      r26.code === "staff_invite_introducer_company_conflict" &&
      intro26.company_code === intro0.company_code &&
      intro26.id === intro0.id &&
      (
        await one(`select count(*)::int as n from public.introducers where user_id = $1`, [
          U.existing,
        ])
      ).n === 1 &&
      (await inviteRow(inv26.token)).used_at === null,
    r26.message ?? "",
  );
  const inv27 = await create(U.ownerB, {
    role: "introducer",
    email: "existing.staff@example.test",
    companyMode: "new",
  });
  const r27 = await outcome(() => accept(U.existing, inv27.token));
  okD(
    "27 cross-tenant introducer invite fails closed",
    !r27.ok &&
      r27.code === "staff_invite_introducer_conflict" &&
      !(await memberships(U.existing)).some((m) => m.tenant_id === T.b) &&
      (await inviteRow(inv27.token)).used_at === null,
  );
  const intro28 = await introRow();
  okD(
    "28 failures cause no partial mutation (introducer row, grants and memberships unchanged)",
    JSON.stringify(intro28) === JSON.stringify(intro21) &&
      JSON.stringify(await grantRows(U.existing)) === JSON.stringify(grants21) &&
      JSON.stringify(await memberships(U.existing)) === mem21,
  );

  // adviser re-invite (same tenant) keeps the code
  const inv29 = await create(U.ownerA, { role: "advisor", email: "new.adviser@example.test" });
  const r29 = await outcome(() => accept(U.newAdv, inv29.token));

  const rel1 = await relSnapshot();
  okD(
    "24 customer_introducer_links unchanged",
    JSON.stringify(JSON.parse(rel1).links) === JSON.stringify(JSON.parse(rel0).links),
  );
  okD(
    "25 commission attribution unchanged (rates and appointment introducer attribution)",
    JSON.stringify(JSON.parse(rel1).commission) === JSON.stringify(JSON.parse(rel0).commission) &&
      JSON.stringify(JSON.parse(rel1).appts) === JSON.stringify(JSON.parse(rel0).appts),
  );

  // --- business identity ---------------------------------------------------------------------
  okD(
    "29 adviser_code unchanged (including same-tenant adviser re-invite)",
    r29.ok && (await advSnapshot()) === adv0,
    r29.message ?? "",
  );
  okD(
    "30 adviser allocations unchanged (appointments, cases, commission)",
    JSON.stringify(JSON.parse(rel1).appts) === JSON.stringify(JSON.parse(rel0).appts) &&
      JSON.stringify(JSON.parse(rel1).cases) === JSON.stringify(JSON.parse(rel0).cases),
  );
  okD("31 admin memberships, levels and allocations unchanged", (await adminSnapshot()) === admin0);
  okD(
    "32 customer appointment/case relationships unchanged and still on the same Auth user id",
    rel1 === rel0 &&
      (await one(`select id from auth.users where id = $1`, [U.c1]))?.id === U.c1 &&
      (
        await one(`select count(*)::int as n from public.appointments where customer_id = $1`, [
          U.c1,
        ])
      ).n === 1,
  );

  okD(
    "T1 OTPs never returned, logged or sent to an unexpected host",
    allCodes.length >= 5 &&
      allCodes.every((c) => /^\d{6}$/.test(c)) &&
      allCodes.every(
        (c) => !logs.some((l) => l.includes(`code is ${c}`) || l.includes(`"${c}"`)),
      ) &&
      allCodes.every((c) => !unknownCalls.some((l) => l.includes(c))),
  );
  okD(
    "T2 phone mode no longer uses Supabase phone OTP (cannot mint a separate phone-only Auth user)",
    !/signInWithOtp\(\{\s*phone/.test(authSrc) &&
      /type: "magiclink"/.test(authSrc) &&
      /verifyCustomerPhoneSignInFn\(/.test(authSrc),
  );
  okD(
    "T3 re-entry codes use node:crypto randomInt",
    /String\(randomInt\(100000, 1000000\)\)/.test(
      code("src/lib/appointment-signup.server.ts").slice(
        code("src/lib/appointment-signup.server.ts").indexOf("startCustomerPhoneSignInImpl"),
      ),
    ),
  );
}

// =============================================================================================
// 44, 45 platform invitation identity (M)
// =============================================================================================
async function platformInvite(email) {
  const raw = randomBytes(32).toString("base64url");
  issued.push(raw);
  await sql(
    `insert into public.platform_invitations (email, first_name, last_name, platform_role, expires_at, token_hash)
     values ($1,'P','I','super_admin', now() + interval '1 day', $2)`,
    [email, platformAdmins.hashPlatformInviteTokenForTests(raw)],
  );
  return raw;
}
U.spoofer = await addUser("spoofer@example.test");
await sql(`insert into public.profiles (id, email) values ($1,'invited.platform@example.test')`, [
  U.spoofer,
]);
const pTok44 = await platformInvite("invited.platform@example.test");
const r44 = await outcome(() =>
  platformAdmins.acceptPlatformInviteImpl({ userId: U.spoofer, rawToken: pTok44 }),
);
ok(
  "44 platform invite rejects profiles.email spoof",
  !r44.ok &&
    !(await one(`select 1 from public.platform_roles where user_id = $1`, [U.spoofer])) &&
    (
      await one(
        `select accepted_at from public.platform_invitations where email = 'invited.platform@example.test'`,
      )
    ).accepted_at === null,
);
U.platUnconf = await addUser("invited2.platform@example.test", { confirmed: false });
const pTok45 = await platformInvite("invited2.platform@example.test");
const r45a = await outcome(() =>
  platformAdmins.acceptPlatformInviteImpl({ userId: U.platUnconf, rawToken: pTok45 }),
);
await sql(`update auth.users set email_confirmed_at = now() where id = $1`, [U.platUnconf]);
const r45b = await outcome(() =>
  platformAdmins.acceptPlatformInviteImpl({ userId: U.platUnconf, rawToken: pTok45 }),
);
ok(
  "45 platform invite requires canonical confirmed Auth email (unconfirmed rejected; confirmed accepted)",
  !r45a.ok &&
    /Confirm your account email/.test(r45a.message) &&
    r45b.ok &&
    r45b.value.platformRole === "super_admin",
  r45b.message ?? "",
);
const unconfirmedLookup = await identity.findAuthUserByEmail("unconfirmed.03@example.test");
const spoofLookup = await identity.findAuthUserByEmail("invited.platform@example.test");
ok(
  "45b Auth-only email lookup: profiles.email never resolves an identity; confirmation reported",
  spoofLookup === null && unconfirmedLookup?.emailConfirmed === false,
);

// =============================================================================================
// 48 client bundle + static guards
// =============================================================================================
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(m?js|html|json)$/.test(name)) out.push(p);
  }
  return out;
}
const clientDir = resolve(root, "dist/client");
const bundle = existsSync(clientDir)
  ? walk(clientDir)
      .map((p) => readFileSync(p, "utf8"))
      .join("\n")
  : "";
ok(
  "48 raw token absent from client bundle/API listing (no staff_invitations table access, hash lookup, RPC or legacy consume in dist/client)",
  bundle.length > 0 &&
    // Bare "token_hash" is Supabase verifyOtp (S1B magic link); staff-invite markers are specific.
    !/staff_invitations|accept_staff_invite|p_token_hash|"token_hash",|markStaffInviteUsed|hashStaffInviteToken/.test(
      bundle,
    ) &&
    list32.every((r) => !("token" in r)),
  bundle.length ? "" : "dist/client missing — run npm run build",
);
const srcText = readdirSync(resolve(root, "src"), { recursive: true })
  .filter((n) => /\.(ts|tsx)$/.test(n))
  .map((n) => readFileSync(resolve(root, "src", n), "utf8"))
  .join("\n");
const registerSrc = code("src/routes/register.tsx");
ok(
  "S1 markStaffInviteUsed removed; register sends no userId; acceptance only via authenticated acceptStaffInvite",
  !/markStaffInviteUsed/.test(srcText) &&
    /acceptFn\(\{ data: \{ token \} \}\)/.test(registerSrc) &&
    !/userId/.test(registerSrc) &&
    /value=\{invite\.email\}/.test(registerSrc),
);
ok(
  "S2 no source selects or writes a plaintext staff invite token",
  !/\.eq\("token",/.test(srcText) &&
    !/select\("token[,"]/.test(srcText) &&
    !/invite\.token\b/.test(srcText),
);
const provisioning = code("src/lib/company-provisioning.server.ts");
ok(
  "S3 provisioning stores token_hash and returns the Owner link once to the platform operator",
  /token_hash: inviteToken\.hash/.test(provisioning) &&
    /inviteToken: inviteToken\.raw/.test(provisioning) &&
    /\.select\("expires_at"\)/.test(provisioning),
);
const platSrc =
  code("src/lib/platform-admins.server.ts") + code("src/lib/platform-tenant-owners.server.ts");
ok(
  "S4 platform identity helpers never consult profiles.email",
  !/from\("profiles"\)\s*\.select\("id"\)\s*\.eq\("email"/.test(platSrc) &&
    !/loadAuthEmail/.test(platSrc) &&
    /loadConfirmedAuthEmail\(input\.userId\)/.test(platSrc),
);
ok(
  "N raw invite tokens never appear in logs, errors or unexpected calls",
  issued.length > 10 &&
    issued.every((t) => !logs.some((l) => l.includes(t))) &&
    issued.every((t) => !unknownCalls.some((l) => l.includes(t))),
);
ok(
  "N2 no unexpected fake-backend calls",
  unknownCalls.length === 0,
  unknownCalls.slice(0, 3).join(" | "),
);
ok(
  "N3 SQL-level tests used PGlite with the migration applied verbatim",
  migration.includes("CREATE OR REPLACE FUNCTION public.accept_staff_invite") && mig1.ok,
);

if (process.env.G7F4S3B_DEBUG) process.stderr.write(`${logs.join("\n")}\n`);
process.stdout.write(`\nS3D ${s3dTotal - s3dFailures.length}/${s3dTotal} PASS\n`);
process.stdout.write(`${total - failures.length}/${total} PASS\n`);
if (failures.length) {
  process.stderr.write(`FAILED: ${failures.join(", ")}\n`);
  process.exit(1);
}
process.exit(0);
