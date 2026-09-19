/**
 * Gate G6B — staging-only clean-project schema bootstrap.
 *
 * Historical production G2 remains immutable:
 *   supabase/migrations/20260917193000_gate_g2_tenant_ownership_and_memberships.sql
 *
 * This runner is NOT a production migration path. It:
 *   1. Applies clean-compatible migrations before G2 in original order
 *   2. Substitutes G2 identity seed/assertions with scripts/g6b-staging-g2-structural.sql
 *   3. Continues remaining migrations in original order through G6/G6A
 *   4. Records schema_migrations names aligned to original filenames
 *
 * Migration-history treatment:
 *   - Git history is unchanged (production G2 file never edited).
 *   - Staging schema_migrations uses the original timestamped filenames as version names.
 *   - For 20260917193000 the recorded version name matches production, but the SQL body
 *     applied on staging is the structural subset only (no Auth/membership seed).
 *   - After bootstrap, staging schema/security objects match the G6/G6A baseline.
 *   - Later shared migrations continue from supabase/migrations/ identically.
 *
 * Apply is fail-closed: APP_ENV=staging AND target ref fwgjtbeigpipvayytwlu only.
 *
 * Run:
 *   APP_ENV=staging SUPABASE_URL=https://fwgjtbeigpipvayytwlu.supabase.co \
 *     node scripts/g6b-staging-bootstrap.mjs
 */
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import {
  STAGING_SUPABASE_REF,
  PRODUCTION_SUPABASE_REF,
  STALE_LOCAL_SUPABASE_REF,
  ProductionGuardError,
  assertStagingTargetAllowed,
} from "./g6b-production-guard.mjs";

export const HISTORICAL_G2_FILENAME = "20260917193000_gate_g2_tenant_ownership_and_memberships.sql";
export const STAGING_G2_STRUCTURAL = "scripts/g6b-staging-g2-structural.sql";

function fail(message) {
  console.error(`REFUSED: ${message}`);
  process.exit(2);
}

function historicalG2Unchanged() {
  const path = resolve("supabase/migrations", HISTORICAL_G2_FILENAME);
  const working = spawnSync("git", ["hash-object", path], { encoding: "utf8" });
  const head = spawnSync("git", ["rev-parse", `HEAD:supabase/migrations/${HISTORICAL_G2_FILENAME}`], {
    encoding: "utf8",
  });
  if (working.status !== 0 || head.status !== 0) {
    return { ok: false, workingHash: "", headHash: "", detail: "git hash lookup failed" };
  }
  const workingHash = working.stdout.trim();
  const headHash = head.stdout.trim();
  return {
    ok: workingHash === headHash && workingHash.length === 40,
    workingHash,
    headHash,
    detail: workingHash === headHash ? "matches HEAD" : "working tree differs from HEAD",
  };
}

export function listBootstrapPlan() {
  const dir = resolve("supabase/migrations");
  const files = readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  return files.map((filename) => {
    const isG2 = filename === HISTORICAL_G2_FILENAME;
    return {
      filename,
      source: isG2 ? STAGING_G2_STRUCTURAL : `supabase/migrations/${filename}`,
      kind: isG2 ? "staging_g2_structural" : "historical",
      migrationName: filename.replace(/\.sql$/, "").replace(/-/g, "_").toLowerCase(),
    };
  });
}

function assertPlanIntegrity(plan) {
  const g2 = plan.filter((row) => row.filename === HISTORICAL_G2_FILENAME);
  if (g2.length !== 1) fail("expected exactly one historical G2 file in the plan");
  if (g2[0].kind !== "staging_g2_structural") fail("G2 must be substituted with staging structural SQL");
  if (g2[0].source !== STAGING_G2_STRUCTURAL) fail("G2 source is not the staging-only structural file");

  const g2Sql = readFileSync(resolve(STAGING_G2_STRUCTURAL), "utf8");
  if (g2Sql.includes("expected 6 retained auth users")) {
    fail("staging G2 SQL must not include production Auth assertions");
  }
  if (g2Sql.includes("pmabbott2@aol.com") && g2Sql.includes("INSERT INTO public.tenant_memberships")) {
    fail("staging G2 SQL must not seed production memberships");
  }
  if (!g2Sql.includes("expected 0 auth users on clean staging")) {
    fail("staging G2 SQL must refuse non-empty Auth");
  }

  const historical = readFileSync(resolve("supabase/migrations", HISTORICAL_G2_FILENAME), "utf8");
  if (!historical.includes("expected 6 retained auth users")) {
    fail("historical G2 unexpectedly lost production identity assertions");
  }
}

try {
  const target = assertStagingTargetAllowed();
  if (target.projectRef !== STAGING_SUPABASE_REF) {
    fail(`target ref ${target.projectRef} is not staging`);
  }
} catch (err) {
  if (err instanceof ProductionGuardError) {
    console.error(err.message);
    process.exit(2);
  }
  throw err;
}

const g2 = historicalG2Unchanged();
if (!g2.ok) {
  fail(`historical G2 must remain unchanged (${g2.detail})`);
}

const plan = listBootstrapPlan();
assertPlanIntegrity(plan);

console.log("G6B staging-only bootstrap (clean project)");
console.log(`STAGING TARGET = ${STAGING_SUPABASE_REF}`);
console.log(`PRODUCTION TARGET = ${PRODUCTION_SUPABASE_REF}`);
console.log(`STALE CONFIG REF = ${STALE_LOCAL_SUPABASE_REF} (rejected)`);
console.log(`HISTORICAL G2 HASH = ${g2.workingHash}`);
console.log(`PLAN STEPS = ${plan.length}`);
for (const row of plan) {
  const mark = row.kind === "staging_g2_structural" ? "SUBSTITUTE" : "APPLY";
  console.log(`  ${mark}  ${row.migrationName}  <- ${row.source}`);
}

if (process.argv.includes("--apply")) {
  fail(
    "direct SQL apply from this process is not enabled; apply only via the authorised staging MCP project_id after this plan PASSes",
  );
}

console.log("\nPASS  staging bootstrap plan is ready (no SQL executed by this script).");
console.log("STOP  synthetic seed, Azure secrets, deploy, and git commit remain unauthorised.");
