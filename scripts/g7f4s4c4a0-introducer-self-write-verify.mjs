/**
 * G7F-4S4C4-A0 introducer self-write boundary — offline verification.
 *
 * Static: the migration contains only the REVOKE / GRANT SELECT / column GRANT UPDATE and a
 * read-only postcondition for public.introducers; no RLS, uniqueness, invite, commission,
 * attribution, cookie or test-account change; every introducer write made with a user's own
 * JWT in application code is enumerated and classified.
 *
 * SQL (PGlite, in memory): Supabase's default privileges for schema public are reproduced, the
 * introducers table is created with the staging columns and constraints, and both introducer
 * RLS policies are applied verbatim from 20260917200200. The tenant helpers model the staging
 * definitions (active membership of any role; staff = owner/supervisor/general/adviser) with the
 * session-freshness check fixed to true. The vulnerable state is demonstrated on synthetic rows,
 * then the A0 migration is applied verbatim twice and the boundary is asserted from the catalog
 * (has_table_privilege / has_column_privilege / aclexplode) and by write attempts. Every write
 * attempt runs inside a rolled-back transaction.
 *
 * Synthetic fixtures only: no network, no staging, no production, no real user.
 *
 * PGlite is loaded from outside the repository:
 *   npm install --prefix /tmp/g7f4s3b/pglite @electric-sql/pglite@0.5.8
 *   G7F4S4C4A0_PGLITE_DIR=/tmp/g7f4s3b/pglite (default)
 * Run: npm exec --yes --package=tsx -- tsx scripts/g7f4s4c4a0-introducer-self-write-verify.mjs
 */
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";

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
const read = (rel) => readFileSync(resolve(root, rel), "utf8");
const stripSql = (src) => src.replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
const norm = (s) => s.replace(/\s+/g, " ").trim();

const TABLE = "public.introducers";
const MIGRATIONS_DIR = "supabase/migrations";
const MIGRATION_REL = `${MIGRATIONS_DIR}/20261003092928_gate_g7f4s4c4a0_introducer_self_write_boundary.sql`;
const POLICY_SOURCE_REL = `${MIGRATIONS_DIR}/20260917200200_gate_g3c_business_tenant_rls.sql`;
const ORIGINAL_VIEW_REL = `${MIGRATIONS_DIR}/20260917101000_public_booking_test_diary.sql`;
const URGENT_V_REL = `${MIGRATIONS_DIR}/20261002200350_gate_g7f4s4c4v_public_introducer_view_read_only.sql`;
const SELF_SERVICE_COLUMNS = ["company_name", "contact_email"];
const ALL_COLUMNS = [
  "id",
  "user_id",
  "company_name",
  "slug",
  "contact_email",
  "active",
  "created_at",
  "company_code",
  "deleted_at",
  "tenant_id",
];
const migration = read(MIGRATION_REL);

// =============================================================================================
// TEST 1–4 (static)
// =============================================================================================
{
  const body = stripSql(migration);
  const doBlocks = [...body.matchAll(/DO\s+\$\$([\s\S]*?)\$\$\s*;/g)];
  const outside = body.replace(/DO\s+\$\$[\s\S]*?\$\$\s*;/g, "");
  const statements = outside.split(";").map(norm).filter(Boolean);
  ok(
    "TEST_1 migration is exactly REVOKE ALL (PUBLIC, anon, authenticated) + GRANT SELECT (anon, authenticated) + GRANT UPDATE (company_name, contact_email) to authenticated",
    statements.length === 3 &&
      statements[0] === `REVOKE ALL ON TABLE ${TABLE} FROM PUBLIC, anon, authenticated` &&
      statements[1] === `GRANT SELECT ON TABLE ${TABLE} TO anon, authenticated` &&
      statements[2] ===
        `GRANT UPDATE (company_name, contact_email) ON TABLE ${TABLE} TO authenticated`,
    statements.join(" | "),
  );
  const doBody = doBlocks.map((m) => m[1]).join("\n");
  ok(
    "TEST_1b the only other statement is one read-only postcondition block (no DML / DDL / grants inside)",
    doBlocks.length === 1 &&
      /RAISE EXCEPTION/.test(doBody) &&
      !/\b(insert\s+into|update\s+[\w.]+\s+set|delete\s+from|truncate\s+(table\s+)?[\w.]|grant\s|revoke\s|create\s|drop\s|alter\s|security\s+definer)/i.test(
        doBody,
      ),
  );
  const objects = new Set(
    [...body.matchAll(/\bpublic\.([a-z_][a-z0-9_]*)/gi)].map((m) => m[1].toLowerCase()),
  );
  ok(
    "TEST_1c no object other than public.introducers is referenced",
    objects.size === 1 && objects.has("introducers"),
    [...objects].join(","),
  );
  ok(
    "TEST_1d out of scope untouched: service_role, RLS / policies, uniqueness, invites, commission, attribution, leads, cookies, test accounts",
    !/service_role/i.test(body) &&
      !/\b(policy|row\s+level\s+security|unique|constraint|index)\b/i.test(outside) &&
      !/accept_staff_invite|staff_invitations|commission|customer_introducer_links|introducer_leads|referral|cookie|test_account|tenant_memberships|auth\./i.test(
        body,
      ),
  );

  const later = readdirSync(resolve(root, MIGRATIONS_DIR))
    .filter((f) => f.endsWith(".sql") && `${MIGRATIONS_DIR}/${f}` > MIGRATION_REL)
    .filter((f) =>
      /(grant|revoke|create\s+table|policy)[\s\S]{0,200}\bpublic\.introducers\b/i.test(
        read(`${MIGRATIONS_DIR}/${f}`),
      ),
    );
  ok(
    "TEST_2 no later migration re-grants, recreates or re-policies public.introducers",
    later.length === 0,
    later.join(","),
  );

  // Every application write to introducers, grouped by the client that sends it.
  const writes = [];
  const walk = (dir) => {
    for (const e of readdirSync(resolve(root, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(rel);
      else if (/\.(ts|tsx|js|mjs)$/.test(e.name) && rel !== "src/integrations/supabase/types.ts") {
        const t = read(rel);
        for (const m of t.matchAll(
          /([\w.]+)\s*\.from\(["'`]introducers["'`]\)\s*\.(insert|update|upsert|delete)\(\s*(\{[^}]*\}|\w+)?/g,
        )) {
          writes.push({ rel, client: m[1], op: m[2], payload: m[3] ?? "" });
        }
      }
    }
  };
  walk("src");
  const userClient = writes.filter((w) => !/supabaseAdmin/.test(w.client));
  const userUpdates = userClient.filter((w) => w.op === "update" || w.op === "upsert");
  const userInserts = userClient.filter((w) => w.op === "insert");
  const keysOf = (payload) =>
    [...payload.matchAll(/\b([a-z_]+)\s*:/g)]
      .map((m) => m[1])
      .sort()
      .join(",");
  ok(
    "TEST_3 no browser component or route writes introducers directly",
    !writes.some((w) => /^src\/(components|routes|hooks)\//.test(w.rel)),
  );
  ok(
    "TEST_3b user-JWT introducer writes are exactly: profile update (company_name, contact_email), booking-link self-reactivation (active), getIntroducerProfile insert",
    userUpdates.length === 2 &&
      userUpdates.some(
        (w) =>
          w.rel === "src/lib/introducer.functions.ts" &&
          w.client === "client" &&
          keysOf(w.payload) === "company_name,contact_email",
      ) &&
      userUpdates.some(
        (w) =>
          w.rel === "src/lib/booking.functions.ts" &&
          w.client === "db" &&
          keysOf(w.payload) === "active",
      ) &&
      userInserts.length === 2 &&
      userInserts.every(
        (w) => w.rel === "src/lib/introducer.functions.ts" && w.client === "context.supabase",
      ) &&
      userClient.length === 4,
    userClient.map((w) => `${w.rel}:${w.client}.${w.op}(${keysOf(w.payload)})`).join(" ; "),
  );
  const booking = read("src/lib/booking.functions.ts");
  ok(
    "TEST_3c the booking-link self-reactivation (BR4-prohibited) ignores its result, so the A0 denial cannot break the request",
    /\n\s*await db\.from\("introducers"\)\.update\(\{ active: true \}\)\.eq\("id", introducerId\);\n/.test(
      booking,
    ),
  );
  const fns = read("src/lib/introducer.functions.ts");
  ok(
    "TEST_4 self-service profile edit writes only company_name and contact_email (updateIntroducerProfile)",
    /\.update\(\{\s*company_name: data\.companyName,\s*contact_email: data\.contactEmail \|\| null,\s*\}\)/.test(
      fns,
    ),
  );
  const policySrc = stripSql(read(POLICY_SOURCE_REL));
  ok(
    "TEST_4b introducers has no INSERT or DELETE policy for authenticated (the getIntroducerProfile insert is already refused by RLS)",
    !/CREATE POLICY[^;]*ON public\.introducers[^;]*FOR (INSERT|DELETE|ALL)/i.test(policySrc),
  );
}

// =============================================================================================
// TEST 5–14 (SQL, PGlite)
// =============================================================================================
const pgliteDir = process.env.G7F4S4C4A0_PGLITE_DIR || "/tmp/g7f4s3b/pglite";
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

await pg.exec(`
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth;
grant usage on schema auth to anon, authenticated, service_role;
create table auth.users (id uuid primary key);
create or replace function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;

create table public.tenants (id uuid primary key, slug text not null unique);
create table public.tenant_memberships (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null,
  active boolean not null default true,
  unique (user_id, tenant_id, role)
);
create function public.has_tenant_membership(p_user_id uuid, p_tenant_id uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select p_user_id is not null and exists (
    select 1 from public.tenant_memberships tm
    where tm.user_id = p_user_id and tm.tenant_id = p_tenant_id and tm.active = true) $$;
create function public.auth_can_access_tenant(p_tenant_id uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select p_tenant_id is not null and auth.uid() is not null
    and public.has_tenant_membership(auth.uid(), p_tenant_id) $$;
create function public.auth_is_tenant_staff(p_tenant_id uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select p_tenant_id is not null and auth.uid() is not null and exists (
    select 1 from public.tenant_memberships tm
    where tm.user_id = auth.uid() and tm.tenant_id = p_tenant_id and tm.active = true
      and tm.role in ('owner', 'supervisor', 'general', 'adviser')) $$;

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
alter table public.introducers enable row level security;

create table public.customer_introducer_links (
  customer_id uuid primary key references auth.users(id) on delete cascade,
  introducer_id uuid not null references public.introducers(id) on delete cascade,
  source text, tenant_id uuid references public.tenants(id)
);
alter table public.customer_introducer_links enable row level security;
create table public.introducer_leads (
  id uuid primary key default gen_random_uuid(),
  introducer_id uuid not null references public.introducers(id) on delete cascade,
  customer_name text not null default 'Synthetic Lead',
  tenant_id uuid references public.tenants(id)
);
alter table public.introducer_leads enable row level security;
create policy "Introducers manage own leads" on public.introducer_leads for all to authenticated
  using ((exists (select 1 from public.introducers i
                  where i.id = introducer_leads.introducer_id and i.user_id = auth.uid()))
         or public.auth_is_tenant_staff(tenant_id))
  with check ((exists (select 1 from public.introducers i
                       where i.id = introducer_leads.introducer_id and i.user_id = auth.uid()))
              or public.auth_is_tenant_staff(tenant_id));
`);

const policyBlock = read(POLICY_SOURCE_REL).match(
  /DROP POLICY IF EXISTS "Introducers view and update own profile" ON public\.introducers;[\s\S]*?WITH CHECK \(user_id = auth\.uid\(\) AND public\.auth_can_access_tenant\(tenant_id\)\);/,
);
const policyApplied = policyBlock
  ? await pg
      .exec(policyBlock[0])
      .then(() => ({ ok: true }))
      .catch((e) => ({ ok: false, message: e.message }))
  : { ok: false, message: "policy block not found in source migration" };
ok(
  "TEST_5_setup introducer RLS policies applied verbatim from 20260917200200",
  policyApplied.ok,
  policyApplied.message ?? "",
);
const policies = async () =>
  await sql(
    `select policyname, cmd, permissive, roles::text roles, qual, with_check
     from pg_policies where schemaname = 'public' and tablename = 'introducers' order by policyname`,
  );
{
  const p = await policies();
  ok(
    "TEST_5_setup_b local policies match the staging catalog (UPDATE and SELECT, USING / WITH CHECK text)",
    p.length === 2 &&
      p[0].policyname === "Introducers update own profile" &&
      p[0].cmd === "UPDATE" &&
      p[0].roles === "{authenticated}" &&
      p[0].qual === "((user_id = auth.uid()) AND auth_can_access_tenant(tenant_id))" &&
      p[0].with_check === "((user_id = auth.uid()) AND auth_can_access_tenant(tenant_id))" &&
      p[1].policyname === "Introducers view and update own profile" &&
      p[1].cmd === "SELECT" &&
      p[1].qual === "((user_id = auth.uid()) OR auth_is_tenant_staff(tenant_id))" &&
      p[1].with_check === null,
    p.map((x) => `${x.policyname}:${x.cmd}`).join(","),
  );
}

const T = { a: randomUUID(), b: randomUUID() };
const U = {
  intro: randomUUID(), // introducer in A, customer in B
  disabled: randomUUID(), // disabled introducer in A, membership still active
  lapsed: randomUUID(), // introducer row in A, membership inactive
  staffA: randomUUID(),
  outsider: randomUUID(),
  cust: randomUUID(),
};
const I = { intro: randomUUID(), disabled: randomUUID(), lapsed: randomUUID() };
for (const id of Object.values(U)) await sql(`insert into auth.users values ($1)`, [id]);
await sql(`insert into public.tenants values ($1, 'synthetic-a'), ($2, 'synthetic-b')`, [T.a, T.b]);
await sql(
  `insert into public.tenant_memberships (tenant_id, user_id, role, active) values
   ($1, $3, 'introducer', true), ($2, $3, 'customer', true),
   ($1, $4, 'introducer', true), ($1, $5, 'introducer', false), ($1, $6, 'adviser', true)`,
  [T.a, T.b, U.intro, U.disabled, U.lapsed, U.staffA],
);
await sql(
  `insert into public.introducers (id, user_id, company_name, slug, contact_email, company_code, tenant_id, active, deleted_at) values
   ($1, $4, 'Synthetic Intro Ltd', 'synthetic-intro', 'intro@example.test', '1111', $7, true, null),
   ($2, $5, 'Synthetic Disabled Ltd', 'synthetic-disabled', null, '2222', $7, false, now()),
   ($3, $6, 'Synthetic Lapsed Ltd', 'synthetic-lapsed', null, '3333', $7, true, null)`,
  [I.intro, I.disabled, I.lapsed, U.intro, U.disabled, U.lapsed, T.a],
);
await sql(
  `insert into public.customer_introducer_links (customer_id, introducer_id, source, tenant_id) values ($1, $2, 'synthetic', $3)`,
  [U.cust, I.intro, T.a],
);
await sql(`insert into public.introducer_leads (introducer_id, tenant_id) values ($1, $2)`, [
  I.intro,
  T.a,
]);

for (const [rel, label] of [
  [ORIGINAL_VIEW_REL, "original public booking view (20260917101000)"],
  [URGENT_V_REL, "URGENT-V view revoke (20261002200350)"],
]) {
  const r = await pg
    .exec(read(rel))
    .then(() => ({ ok: true }))
    .catch((e) => ({ ok: false, message: e.message }));
  ok(`TEST_5_setup_c ${label} applies verbatim`, r.ok, r.message ?? "");
}

async function tx(role, userId, statements) {
  const out = [];
  await pg.query("begin");
  try {
    await pg.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId ?? ""]);
    await pg.query(`set local role ${role}`);
    for (const [stmt, params = []] of statements) {
      await pg.query("savepoint s");
      try {
        const r = await pg.query(stmt, params);
        out.push({ ok: true, rows: r.rows, affected: r.affectedRows ?? 0 });
        await pg.query("release savepoint s");
      } catch (e) {
        out.push({ ok: false, code: e.code, message: e.message });
        await pg.query("rollback to savepoint s");
      }
    }
  } finally {
    await pg.query("rollback");
  }
  return out;
}
const PRIVS = [
  "SELECT",
  "INSERT",
  "UPDATE",
  "DELETE",
  "TRUNCATE",
  "REFERENCES",
  "TRIGGER",
  "MAINTAIN",
];
const tablePrivs = async (role) =>
  Object.fromEntries(
    await Promise.all(
      PRIVS.map(async (p) => [
        p,
        (await sql(`select has_table_privilege($1, $2, $3) v`, [role, TABLE, p]))[0].v,
      ]),
    ),
  );
const columnPrivs = async (role, priv) =>
  (
    await sql(
      `select coalesce(array_agg(a.attname::text order by a.attnum), '{}') cols from pg_attribute a
       where a.attrelid = $2::regclass and a.attnum > 0 and not a.attisdropped
         and has_column_privilege($1, $2, a.attname, $3)`,
      [role, TABLE, priv],
    )
  )[0].cols;
const tableAcl = async (grantee) =>
  (
    await sql(
      `select coalesce(array_agg(a.privilege_type::text order by a.privilege_type), '{}') p
       from pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
       where c.oid = $1::regclass
         and a.grantee = case when $2 = 'PUBLIC' then 0::oid else (select oid from pg_roles where rolname = $2) end`,
      [TABLE, grantee],
    )
  )[0].p;
const columnAcl = async () =>
  (
    await sql(
      `select coalesce(array_agg(att.attname::text || ':' || coalesce(r.rolname, 'PUBLIC') || ':' || a.privilege_type
                                 order by att.attname, a.privilege_type), '{}') e
       from pg_attribute att
       cross join lateral aclexplode(att.attacl) a
       left join pg_roles r on r.oid = a.grantee
       where att.attrelid = $1::regclass and att.attnum > 0 and not att.attisdropped`,
      [TABLE],
    )
  )[0].e;
const fingerprint = async () =>
  (
    await sql(`select
      (select md5(coalesce(string_agg(t::text, '|' order by t.id), '')) from public.introducers t) intro,
      (select md5(coalesce(string_agg(t::text, '|' order by t.customer_id), '')) from public.customer_introducer_links t) links,
      (select md5(coalesce(string_agg(t::text, '|' order by t.id), '')) from public.introducer_leads t) leads`)
  )[0];
const svcAcl = async () =>
  (await sql(`select relacl::text a from pg_class where oid = $1::regclass`, [TABLE]))[0].a.match(
    /service_role=[a-zA-Z]*\/\w+/,
  )?.[0];
const rlsState = async () =>
  (
    await sql(
      `select relrowsecurity r, relforcerowsecurity f from pg_class where oid = $1::regclass`,
      [TABLE],
    )
  )[0];

// --- control: the vulnerable pre-migration state (synthetic, rolled back) --------------------
{
  const a = await tablePrivs("anon");
  const u = await tablePrivs("authenticated");
  ok(
    "TEST_6_control pre-migration: default privileges give anon and authenticated every table privilege (matches staging arwdDxtm)",
    PRIVS.every((p) => a[p] && u[p]) &&
      JSON.stringify(await columnPrivs("authenticated", "UPDATE")) === JSON.stringify(ALL_COLUMNS),
  );
  const r = await tx("authenticated", U.disabled, [
    [`update ${TABLE} set active = true, deleted_at = null where id = $1`, [I.disabled]],
  ]);
  ok(
    "TEST_6_control_b pre-migration: a disabled introducer can reactivate their own row (active, deleted_at)",
    r[0].ok && r[0].affected === 1,
    r[0].code ?? `affected=${r[0].affected}`,
  );
  const m = await tx("authenticated", U.intro, [
    [`update ${TABLE} set tenant_id = $2 where id = $1`, [I.intro, T.b]],
    [
      `update ${TABLE} set company_code = '9999', slug = 'synthetic-hijack' where id = $1`,
      [I.intro],
    ],
  ]);
  ok(
    "TEST_6_control_c pre-migration: an introducer who is a customer of Tenant B can move their row into Tenant B and rewrite company_code / slug",
    m[0].ok && m[0].affected === 1 && m[1].ok && m[1].affected === 1,
    m.map((x) => x.code ?? `affected=${x.affected}`).join(","),
  );
}
const before = await fingerprint();
const policiesBefore = JSON.stringify(await policies());
const svcBefore = await svcAcl();
const svcPrivsBefore = await tablePrivs("service_role");

// --- apply A0 verbatim, twice -----------------------------------------------------------------
const run = async () =>
  pg
    .exec(migration)
    .then(() => ({ ok: true }))
    .catch((e) => ({ ok: false, message: e.message }));
const m1 = await run();
const m2 = await run();
ok(
  "TEST_7 A0 migration applies cleanly and is re-runnable",
  m1.ok && m2.ok,
  m1.message ?? m2.message ?? "",
);

// --- catalog: table and column privileges -------------------------------------------------------
{
  const a = await tablePrivs("anon");
  const u = await tablePrivs("authenticated");
  ok(
    "TEST_8_1 anon: has_table_privilege SELECT only (no INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER/MAINTAIN)",
    a.SELECT && PRIVS.filter((p) => p !== "SELECT").every((p) => a[p] === false),
    JSON.stringify(a),
  );
  ok(
    "TEST_8_2 authenticated: has_table_privilege SELECT only (no table-level UPDATE; no INSERT/DELETE/TRUNCATE/REFERENCES/TRIGGER/MAINTAIN)",
    u.SELECT && PRIVS.filter((p) => p !== "SELECT").every((p) => u[p] === false),
    JSON.stringify(u),
  );
  const authUpd = await columnPrivs("authenticated", "UPDATE");
  ok(
    "TEST_8_3 authenticated: has_column_privilege UPDATE is true for exactly company_name, contact_email",
    JSON.stringify(authUpd) === JSON.stringify(SELF_SERVICE_COLUMNS),
    authUpd.join(","),
  );
  const perColumn = [];
  for (const c of ALL_COLUMNS) {
    const v = (
      await sql(`select has_column_privilege('authenticated', $1, $2, 'UPDATE') v`, [TABLE, c])
    )[0].v;
    perColumn.push(`${c}=${v}`);
  }
  ok(
    "TEST_8_4 authenticated cannot UPDATE id, user_id, tenant_id, company_code, slug, active, deleted_at, created_at (checked column by column)",
    perColumn.every((e) => {
      const [c, v] = e.split("=");
      return v === String(SELF_SERVICE_COLUMNS.includes(c));
    }),
    perColumn.join(" "),
  );
  ok(
    "TEST_8_5 anon: has_column_privilege UPDATE / INSERT / REFERENCES false for every column",
    (await columnPrivs("anon", "UPDATE")).length === 0 &&
      (await columnPrivs("anon", "INSERT")).length === 0 &&
      (await columnPrivs("anon", "REFERENCES")).length === 0,
  );
  ok(
    "TEST_8_6 authenticated: has_column_privilege INSERT / REFERENCES false for every column; SELECT retained on every column",
    (await columnPrivs("authenticated", "INSERT")).length === 0 &&
      (await columnPrivs("authenticated", "REFERENCES")).length === 0 &&
      JSON.stringify(await columnPrivs("authenticated", "SELECT")) === JSON.stringify(ALL_COLUMNS),
  );
  const aAcl = await tableAcl("anon");
  const uAcl = await tableAcl("authenticated");
  const pAcl = await tableAcl("PUBLIC");
  const cAcl = await columnAcl();
  ok(
    "TEST_8_7 raw ACL: table entries are SELECT for anon and authenticated, nothing for PUBLIC; column ACL is only authenticated UPDATE on company_name and contact_email",
    JSON.stringify(aAcl) === '["SELECT"]' &&
      JSON.stringify(uAcl) === '["SELECT"]' &&
      pAcl.length === 0 &&
      JSON.stringify(cAcl) ===
        '["company_name:authenticated:UPDATE","contact_email:authenticated:UPDATE"]',
    `anon=${aAcl} authenticated=${uAcl} public=${pAcl} columns=${cAcl}`,
  );
  ok(
    "TEST_8_8 service_role privileges and ACL entry unchanged",
    (await svcAcl()) === svcBefore &&
      JSON.stringify(await tablePrivs("service_role")) === JSON.stringify(svcPrivsBefore) &&
      PRIVS.every((p) => svcPrivsBefore[p]),
    svcBefore ?? "",
  );
  const rls = await rlsState();
  ok(
    "TEST_8_9 RLS still enabled and both introducer policies byte-identical",
    rls.r === true && JSON.stringify(await policies()) === policiesBefore,
  );
}

// --- behaviour (rolled back) ------------------------------------------------------------------
const denied = (r) => !r.ok && r.code === "42501";
{
  const r = await tx("authenticated", U.intro, [
    [`update ${TABLE} set company_name = 'Synthetic Renamed Ltd' where id = $1`, [I.intro]],
    [`update ${TABLE} set contact_email = 'renamed@example.test' where id = $1`, [I.intro]],
    [
      `update ${TABLE} set company_name = 'Synthetic Both Ltd', contact_email = null where id = $1 returning *`,
      [I.intro],
    ],
  ]);
  ok(
    "TEST_9 authenticated introducer CAN update own company_name and contact_email (incl. RETURNING *, as PostgREST does)",
    r.every((x) => x.ok && x.affected === 1) &&
      r[2].rows[0]?.company_name === "Synthetic Both Ltd" &&
      r[2].rows[0]?.slug === "synthetic-intro",
    r.map((x) => x.code ?? `affected=${x.affected}`).join(","),
  );
}
{
  const attempts = [
    ["tenant_id", `update ${TABLE} set tenant_id = $2 where id = $1`, [I.intro, T.b]],
    ["user_id", `update ${TABLE} set user_id = $2 where id = $1`, [I.intro, U.outsider]],
    ["company_code", `update ${TABLE} set company_code = '9999' where id = $1`, [I.intro]],
    ["slug", `update ${TABLE} set slug = 'synthetic-hijack' where id = $1`, [I.intro]],
    ["active", `update ${TABLE} set active = false where id = $1`, [I.intro]],
    ["deleted_at", `update ${TABLE} set deleted_at = now() where id = $1`, [I.intro]],
    ["created_at", `update ${TABLE} set created_at = now() where id = $1`, [I.intro]],
    ["id", `update ${TABLE} set id = gen_random_uuid() where id = $1`, [I.intro]],
    [
      "company_name+tenant_id",
      `update ${TABLE} set company_name = 'X Ltd', tenant_id = $2 where id = $1`,
      [I.intro, T.b],
    ],
  ];
  const r = await tx(
    "authenticated",
    U.intro,
    attempts.map(([, s, p]) => [s, p]),
  );
  ok(
    "TEST_10 authenticated introducer CANNOT update tenant_id, user_id, company_code, slug, active, deleted_at, created_at, id, or a mix including one (42501)",
    r.every(denied),
    attempts.map(([c], i) => `${c}=${r[i].code ?? "ok"}`).join(" "),
  );
  const d = await tx("authenticated", U.disabled, [
    [`update ${TABLE} set active = true, deleted_at = null where id = $1`, [I.disabled]],
    [`update ${TABLE} set active = true where id = $1`, [I.disabled]],
  ]);
  ok(
    "TEST_10b a disabled introducer can no longer reactivate their own row (BR4)",
    d.every(denied),
    d.map((x) => x.code ?? "ok").join(","),
  );
  const w = await tx("authenticated", U.intro, [
    [
      `insert into ${TABLE} (user_id, company_name, slug) values ($1, 'Injected Ltd', 'injected')`,
      [U.intro],
    ],
    [`delete from ${TABLE} where id = $1`, [I.intro]],
    [`truncate ${TABLE} cascade`],
  ]);
  ok(
    "TEST_10c authenticated cannot INSERT, DELETE or TRUNCATE introducers (42501)",
    w.every(denied),
    w.map((x) => x.code ?? "ok").join(","),
  );
}
{
  const other = await tx("authenticated", U.intro, [
    [`update ${TABLE} set company_name = 'Other Ltd' where id = $1`, [I.disabled]],
    [`update ${TABLE} set contact_email = 'x@example.test' where id = $1`, [I.lapsed]],
  ]);
  ok(
    "TEST_11 authenticated cannot update another user's introducer row (RLS: 0 rows)",
    other.every((x) => x.ok && x.affected === 0),
    other.map((x) => x.code ?? `affected=${x.affected}`).join(","),
  );
  const staff = await tx("authenticated", U.staffA, [
    [`update ${TABLE} set company_name = 'Staff Edit Ltd' where id = $1`, [I.intro]],
  ]);
  const lapsed = await tx("authenticated", U.lapsed, [
    [`update ${TABLE} set company_name = 'Lapsed Edit Ltd' where id = $1`, [I.lapsed]],
  ]);
  const outsider = await tx("authenticated", U.outsider, [
    [`update ${TABLE} set company_name = 'Outsider Ltd' where id = $1`, [I.intro]],
    [`select id from ${TABLE}`],
  ]);
  ok(
    "TEST_11b tenant RLS remains effective: tenant staff, an owner without an active membership in the row's tenant, and an outsider update 0 rows",
    staff[0].ok &&
      staff[0].affected === 0 &&
      lapsed[0].ok &&
      lapsed[0].affected === 0 &&
      outsider[0].ok &&
      outsider[0].affected === 0 &&
      outsider[1].ok &&
      outsider[1].rows.length === 0,
  );
  const reads = await tx("authenticated", U.intro, [
    [`select id from ${TABLE}`],
    [`select id from public.introducer_leads`],
  ]);
  const staffRead = await tx("authenticated", U.staffA, [[`select id from ${TABLE}`]]);
  ok(
    "TEST_11c reads unchanged: introducer sees only own row; tenant staff see the tenant's rows; the leads policy subquery on introducers still works",
    reads[0].ok &&
      reads[0].rows.length === 1 &&
      reads[0].rows[0].id === I.intro &&
      reads[1].ok &&
      reads[1].rows.length === 1 &&
      staffRead[0].ok &&
      staffRead[0].rows.length === 3,
  );
}
{
  const r = await tx("anon", null, [
    ...ALL_COLUMNS.filter((c) => c !== "id" && c !== "user_id" && c !== "tenant_id").map((c) => [
      `update ${TABLE} set ${c} = ${c} where id = $1`,
      [I.intro],
    ]),
    [
      `update ${TABLE} set tenant_id = tenant_id, user_id = user_id, id = id where id = $1`,
      [I.intro],
    ],
    [
      `insert into ${TABLE} (user_id, company_name, slug) values ($1, 'Anon Ltd', 'anon-injected')`,
      [U.intro],
    ],
    [`delete from ${TABLE} where id = $1`, [I.intro]],
    [`truncate ${TABLE} cascade`],
  ]);
  const sel = await tx("anon", null, [[`select id from ${TABLE}`]]);
  ok(
    "TEST_12 anon cannot UPDATE any introducer column, INSERT, DELETE or TRUNCATE (42501); anon SELECT returns no rows under RLS",
    r.every(denied) && sel[0].ok && sel[0].rows.length === 0,
    r.map((x) => x.code ?? "ok").join(","),
  );
  const view = await tx("anon", null, [
    [
      `select id, company_name, slug from public.introducer_public_booking where slug = $1`,
      ["synthetic-intro"],
    ],
  ]);
  ok(
    "TEST_12b public referral lookup through introducer_public_booking still works for anon",
    view[0].ok && view[0].rows.length === 1 && view[0].rows[0].id === I.intro,
  );
}
{
  const r = await tx("service_role", null, [
    [`update ${TABLE} set active = false, deleted_at = now() where id = $1`, [I.intro]],
  ]);
  ok(
    "TEST_13 service-role administrative writes (e.g. disable) still work",
    r[0].ok && r[0].affected === 1,
    r[0].code ?? "",
  );
}
{
  const after = await fingerprint();
  ok(
    "TEST_14 no introducer data modified (fingerprint identical before and after migration and all attempts)",
    after.intro === before.intro,
  );
  ok(
    "TEST_14b no attribution data modified (customer_introducer_links and introducer_leads fingerprints identical)",
    after.links === before.links && after.leads === before.leads,
  );
}

console.log("");
if (failures.length) {
  console.error(`${total - failures.length}/${total} PASS — ${failures.length} failure(s)`);
  process.exit(1);
}
console.log(`${total}/${total} PASS`);
