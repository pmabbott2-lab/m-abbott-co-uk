/**
 * G7F-4S4C4-URGENT-V public introducer view write boundary — offline verification.
 *
 * Static: the migration contains only the REVOKE / GRANT / postcondition for
 * public.introducer_public_booking, no later migration recreates the view, and the public
 * referral lookup contract in resolveReferralSlug is unchanged.
 *
 * SQL (PGlite, in memory): Supabase's default privileges for schema public are reproduced,
 * the original view migration (20260917101000) is applied verbatim, the vulnerable state is
 * demonstrated, then the URGENT-V migration is applied verbatim twice. Privileges are asserted
 * from the catalog (has_table_privilege / aclexplode); write attempts run only against
 * synthetic local rows inside rolled-back transactions.
 *
 * Synthetic fixtures only: no network, no staging, no production, no real user.
 *
 * PGlite is loaded from outside the repository:
 *   npm install --prefix /tmp/g7f4s3b/pglite @electric-sql/pglite@0.5.8
 *   G7F4S4C4V_PGLITE_DIR=/tmp/g7f4s3b/pglite (default)
 * Run: npm exec --yes --package=tsx -- tsx scripts/g7f4s4c4v-public-introducer-view-verify.mjs
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

const VIEW = "public.introducer_public_booking";
const MIGRATIONS_DIR = "supabase/migrations";
const MIGRATION_REL = `${MIGRATIONS_DIR}/20261002200350_gate_g7f4s4c4v_public_introducer_view_read_only.sql`;
const ORIGINAL_VIEW_REL = `${MIGRATIONS_DIR}/20260917101000_public_booking_test_diary.sql`;
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
    "TEST_1 migration has exactly REVOKE ALL (PUBLIC, anon, authenticated) + GRANT SELECT (anon, authenticated) on the view",
    statements.length === 2 &&
      statements[0] === `REVOKE ALL ON TABLE ${VIEW} FROM PUBLIC, anon, authenticated` &&
      statements[1] === `GRANT SELECT ON TABLE ${VIEW} TO anon, authenticated`,
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
    "TEST_1c no object other than public.introducer_public_booking is referenced",
    objects.size === 1 && objects.has("introducer_public_booking"),
    [...objects].join(","),
  );
  ok(
    "TEST_1d service_role, the view definition and introducer data are not touched",
    !/service_role/i.test(body) &&
      !/\bVIEW\b/i.test(outside) &&
      !/\bintroducers\b/i.test(body) &&
      !/customer_introducer_links|introducer_leads|referral|commission|tenant_memberships|auth\./i.test(
        body,
      ),
  );

  const later = readdirSync(resolve(root, MIGRATIONS_DIR))
    .filter((f) => f.endsWith(".sql") && `${MIGRATIONS_DIR}/${f}` > MIGRATION_REL)
    .filter((f) => /introducer_public_booking/.test(read(`${MIGRATIONS_DIR}/${f}`)));
  ok(
    "TEST_2 no later migration recreates or re-grants the view (a DROP/CREATE would re-apply default privileges)",
    later.length === 0,
    later.join(","),
  );

  const original = stripSql(read(ORIGINAL_VIEW_REL));
  ok(
    "TEST_3 view definition source unchanged: id, company_name, slug from active, non-deleted introducers",
    /CREATE OR REPLACE VIEW public\.introducer_public_booking\s+WITH \(security_invoker = false\) AS\s+SELECT id, company_name, slug\s+FROM public\.introducers\s+WHERE COALESCE\(active, true\) = true\s+AND deleted_at IS NULL;/.test(
      original,
    ),
  );

  const fns = read("src/lib/introducer.functions.ts");
  ok(
    "TEST_4 public referral lookup contract intact: publishable-key client selects id, company_name, slug by slug",
    /createClient\(env\.url, env\.publishableKey\)/.test(fns) &&
      /\.from\("introducer_public_booking"\)\s*\.select\("id, company_name, slug"\)\s*\.eq\("slug", slug\)\s*\.maybeSingle\(\)/.test(
        fns,
      ),
  );
  const srcHits = [];
  const walk = (dir) => {
    for (const e of readdirSync(resolve(root, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(rel);
      else if (/\.(ts|tsx|js|mjs)$/.test(e.name) && rel !== "src/integrations/supabase/types.ts") {
        const t = read(rel);
        if (/introducer_public_booking/.test(t)) srcHits.push({ rel, t });
      }
    }
  };
  walk("src");
  const writers = srcHits.filter(({ t }) =>
    /introducer_public_booking"\)\s*\.(insert|update|upsert|delete)\(/.test(t),
  );
  ok(
    "TEST_4b application code only reads the view (no client or server writes depend on the revoked privileges)",
    srcHits.length === 1 &&
      srcHits[0].rel === "src/lib/introducer.functions.ts" &&
      writers.length === 0,
    srcHits.map((h) => h.rel).join(","),
  );
}

// =============================================================================================
// TEST 5–12 (SQL, PGlite)
// =============================================================================================
const pgliteDir = process.env.G7F4S4C4V_PGLITE_DIR || "/tmp/g7f4s3b/pglite";
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

// Supabase platform defaults for objects created by postgres in schema public (staging
// pg_default_acl: postgres / public / r = arwdDxtm to anon, authenticated, service_role).
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

create table public.introducers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id),
  company_name text not null,
  slug text not null unique,
  company_code text,
  tenant_id uuid,
  active boolean default true,
  deleted_at timestamptz
);
alter table public.introducers enable row level security;
create policy "Introducers view and update own profile" on public.introducers for select to authenticated
  using (user_id = auth.uid());
create policy "Introducers update own profile" on public.introducers for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create table public.customer_introducer_links (
  customer_id uuid primary key references auth.users(id) on delete cascade,
  introducer_id uuid not null references public.introducers(id) on delete cascade,
  source text, tenant_id uuid
);
alter table public.customer_introducer_links enable row level security;
create table public.introducer_leads (
  id uuid primary key default gen_random_uuid(),
  introducer_id uuid not null references public.introducers(id) on delete cascade,
  tenant_id uuid
);
alter table public.introducer_leads enable row level security;
`);

const U = { a: randomUUID(), b: randomUUID(), c: randomUUID(), cust: randomUUID() };
const I = { active: randomUUID(), inactive: randomUUID(), deleted: randomUUID() };
for (const id of Object.values(U)) await sql(`insert into auth.users values ($1)`, [id]);
await sql(
  `insert into public.introducers (id, user_id, company_name, slug, company_code, tenant_id, active, deleted_at) values
   ($1, $4, 'Synthetic Active Ltd', 'synthetic-active', '1111', gen_random_uuid(), true, null),
   ($2, $5, 'Synthetic Inactive Ltd', 'synthetic-inactive', '2222', gen_random_uuid(), false, null),
   ($3, $6, 'Synthetic Deleted Ltd', 'synthetic-deleted', '3333', gen_random_uuid(), true, now())`,
  [I.active, I.inactive, I.deleted, U.a, U.b, U.c],
);
await sql(
  `insert into public.customer_introducer_links (customer_id, introducer_id, source) values ($1, $2, 'synthetic')`,
  [U.cust, I.active],
);
await sql(`insert into public.introducer_leads (introducer_id) values ($1)`, [I.active]);

const original = read(ORIGINAL_VIEW_REL);
const origApplied = await pg
  .exec(original)
  .then(() => ({ ok: true }))
  .catch((e) => ({ ok: false, message: e.message }));
ok(
  "TEST_5_setup original view migration (20260917101000) applies verbatim",
  origApplied.ok,
  origApplied.message ?? "",
);

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
    await pg.query("reset role");
    out.links = (
      await pg.query(`select count(*)::int n from public.customer_introducer_links`)
    ).rows[0].n;
    out.leads = (await pg.query(`select count(*)::int n from public.introducer_leads`)).rows[0].n;
  } finally {
    await pg.query("rollback");
  }
  return out;
}
const writeAttempts = (role) => [
  [`update ${VIEW} set slug = 'hijacked', company_name = 'Hijacked' where id = $1`, [I.active]],
  [`delete from ${VIEW} where id = $1`, [I.active]],
  [
    `insert into ${VIEW} (id, company_name, slug) values (gen_random_uuid(), 'Injected', 'injected-${role}')`,
  ],
  [`truncate ${VIEW}`],
];
const privs = async (role) =>
  (
    await sql(
      `select has_table_privilege($1, $2, 'SELECT') s, has_table_privilege($1, $2, 'INSERT') i,
              has_table_privilege($1, $2, 'UPDATE') u, has_table_privilege($1, $2, 'DELETE') d,
              has_table_privilege($1, $2, 'TRUNCATE') t, has_table_privilege($1, $2, 'REFERENCES') r,
              has_table_privilege($1, $2, 'TRIGGER') g`,
      [role, VIEW],
    )
  )[0];
const aclFor = async (role) =>
  (
    await sql(
      `select coalesce(array_agg(a.privilege_type::text order by a.privilege_type), '{}') p
       from pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
       where c.oid = $1::regclass and a.grantee = (select oid from pg_roles where rolname = $2)`,
      [VIEW, role],
    )
  )[0].p;
const fingerprint = async () =>
  (
    await sql(`select
      (select md5(coalesce(string_agg(t::text, '|' order by t.id), '')) from public.introducers t) intro,
      (select md5(coalesce(string_agg(t::text, '|' order by t.customer_id), '')) from public.customer_introducer_links t) links,
      (select md5(coalesce(string_agg(t::text, '|' order by t.id), '')) from public.introducer_leads t) leads`)
  )[0];
const viewMeta = async () =>
  (
    await sql(
      `select pg_get_viewdef($1::regclass, true) def, c.reloptions::text opts, pg_get_userbyid(c.relowner) owner,
              pg_relation_is_updatable($1::regclass, false) upd,
              (select array_agg(attname::text order by attnum) from pg_attribute
                where attrelid = $1::regclass and attnum > 0 and not attisdropped) cols,
              (select relacl::text from pg_class where oid = 'public.introducers'::regclass) base_acl,
              (select array_agg(polname::text order by polname) from pg_policy where polrelid = 'public.introducers'::regclass) base_pol
       from pg_class c where c.oid = $1::regclass`,
      [VIEW],
    )
  )[0];

// --- control: the vulnerable pre-migration state ----------------------------------------------
const anonBefore = await privs("anon");
const authBefore = await privs("authenticated");
ok(
  "TEST_5_control pre-migration: default privileges give anon and authenticated INSERT/UPDATE/DELETE on the view",
  anonBefore.s &&
    anonBefore.i &&
    anonBefore.u &&
    anonBefore.d &&
    authBefore.i &&
    authBefore.u &&
    authBefore.d,
);
{
  const c = await tx("anon", null, writeAttempts("anon"));
  ok(
    "TEST_5_control_b pre-migration: anon renames and deletes an active introducer through the view; the delete cascades to links and leads (rolled back)",
    c[0].ok &&
      c[0].affected === 1 &&
      c[1].ok &&
      c[1].affected === 1 &&
      c.links === 0 &&
      c.leads === 0,
    `update=${c[0].ok}/${c[0].affected} delete=${c[1].ok}/${c[1].affected} links=${c.links} leads=${c.leads}`,
  );
  ok(
    "TEST_5_control_c pre-migration: anon INSERT is permitted by privilege but fails on introducers.user_id NOT NULL",
    !c[2].ok && c[2].code === "23502",
    c[2].code ?? "",
  );
}
const before = await fingerprint();
const metaBefore = await viewMeta();

// --- apply URGENT-V verbatim, twice ---------------------------------------------------------
const run = async () =>
  pg
    .exec(migration)
    .then(() => ({ ok: true }))
    .catch((e) => ({ ok: false, message: e.message }));
const m1 = await run();
const m2 = await run();
ok(
  "TEST_6 URGENT-V migration applies cleanly and is re-runnable",
  m1.ok && m2.ok,
  m1.message ?? m2.message ?? "",
);

const anon = await privs("anon");
const authd = await privs("authenticated");
const svc = await privs("service_role");
ok("TEST_7_1 anon can SELECT", anon.s === true);
ok("TEST_7_2 authenticated can SELECT", authd.s === true);
ok("TEST_7_3 anon cannot INSERT", anon.i === false);
ok("TEST_7_4 anon cannot UPDATE", anon.u === false);
ok("TEST_7_5 anon cannot DELETE", anon.d === false);
ok("TEST_7_6 authenticated cannot INSERT", authd.i === false);
ok("TEST_7_7 authenticated cannot UPDATE", authd.u === false);
ok("TEST_7_8 authenticated cannot DELETE", authd.d === false);
ok(
  "TEST_7_9 anon and authenticated: no TRUNCATE / REFERENCES / TRIGGER",
  !anon.t && !anon.r && !anon.g && !authd.t && !authd.r && !authd.g,
);
{
  const aAcl = await aclFor("anon");
  const uAcl = await aclFor("authenticated");
  const pub = (
    await sql(
      `select count(*)::int n from pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
       where c.oid = $1::regclass and a.grantee = 0`,
      [VIEW],
    )
  )[0].n;
  ok(
    "TEST_7_10 ACL entries are exactly SELECT for anon and authenticated (covers MAINTAIN); nothing for PUBLIC",
    JSON.stringify(aAcl) === '["SELECT"]' && JSON.stringify(uAcl) === '["SELECT"]' && pub === 0,
    `anon=${aAcl} authenticated=${uAcl} public=${pub}`,
  );
}
ok(
  "TEST_7_11 service_role privileges unchanged (server administration unaffected)",
  svc.s && svc.i && svc.u && svc.d,
);

const denied = (r) => !r.ok && r.code === "42501";
// TRUNCATE is rejected for every view with 42809 before privileges are checked; TEST_7_9
// covers the privilege itself.
const truncDenied = (r) => !r.ok && (r.code === "42501" || r.code === "42809");
for (const role of ["anon", "authenticated"]) {
  const r = await tx(role, role === "authenticated" ? U.a : null, writeAttempts(role));
  ok(
    `TEST_8 ${role}: UPDATE / DELETE / INSERT through the view denied with 42501, TRUNCATE refused; no cascade`,
    denied(r[0]) &&
      denied(r[1]) &&
      denied(r[2]) &&
      truncDenied(r[3]) &&
      r.links === 1 &&
      r.leads === 1,
    r.map((x) => x.code ?? "ok").join(","),
  );
}

{
  const metaAfter = await viewMeta();
  ok(
    "TEST_9 view still returns only id, company_name, slug; definition, owner, security_invoker unchanged",
    JSON.stringify(metaAfter.cols) === '["id","company_name","slug"]' &&
      metaAfter.def === metaBefore.def &&
      metaAfter.owner === metaBefore.owner &&
      metaAfter.opts === metaBefore.opts &&
      metaAfter.opts === "{security_invoker=false}",
    `${metaAfter.cols} owner=${metaAfter.owner} opts=${metaAfter.opts}`,
  );
  ok(
    "TEST_9b base table privileges and RLS policies on public.introducers unchanged by the migration",
    metaAfter.base_acl === metaBefore.base_acl &&
      JSON.stringify(metaAfter.base_pol) === JSON.stringify(metaBefore.base_pol),
  );
}

for (const role of ["anon", "authenticated"]) {
  const r = await tx(role, role === "authenticated" ? U.b : null, [
    [`select id, company_name, slug from ${VIEW} where slug = $1`, ["synthetic-active"]],
    [`select id from ${VIEW} where slug = $1`, ["synthetic-inactive"]],
    [`select id from ${VIEW} where slug = $1`, ["synthetic-deleted"]],
    [`select * from ${VIEW}`],
  ]);
  ok(
    `TEST_10 ${role}: public referral lookup by slug still works (active only; inactive and deleted hidden; 3 columns)`,
    r[0].ok &&
      r[0].rows.length === 1 &&
      r[0].rows[0].id === I.active &&
      r[0].rows[0].slug === "synthetic-active" &&
      r[1].ok &&
      r[1].rows.length === 0 &&
      r[2].ok &&
      r[2].rows.length === 0 &&
      r[3].ok &&
      JSON.stringify(Object.keys(r[3].rows[0] ?? {})) === '["id","company_name","slug"]',
  );
}

{
  const after = await fingerprint();
  ok(
    "TEST_11 no introducer data modified (introducers fingerprint identical before and after migration and denied writes)",
    after.intro === before.intro,
  );
  ok(
    "TEST_12 no attribution data modified (customer_introducer_links and introducer_leads fingerprints identical)",
    after.links === before.links && after.leads === before.leads,
  );
}

console.log("");
if (failures.length) {
  console.error(`${total - failures.length}/${total} PASS — ${failures.length} failure(s)`);
  process.exit(1);
}
console.log(`${total}/${total} PASS`);
