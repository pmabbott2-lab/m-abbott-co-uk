/**
 * Gate G6B — local staging-safety checks (no Azure/Supabase create, no push).
 * Run: node --env-file=.env scripts/g6b-staging-safety-verify.mjs
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import {
  PRODUCTION_SUPABASE_REF,
  STAGING_SUPABASE_REF,
  STALE_LOCAL_SUPABASE_REF,
} from "./g6b-production-guard.mjs";

const failures = [];
function ok(name, cond, detail = "") {
  if (cond) console.log(`PASS  ${name}${detail ? ` — ${detail}` : ""}`);
  else {
    console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
    failures.push(name);
  }
}

const prodWf = readFileSync(resolve(".github/workflows/targeted-features_mortgagehub-prod.yml"), "utf8");
const stagingWf = readFileSync(resolve(".github/workflows/mortgagehub-staging.yml"), "utf8");
const example = readFileSync(resolve(".env.staging.example"), "utf8");
const seed = readFileSync(resolve("scripts/g6b-staging-seed.mjs"), "utf8");
const reset = readFileSync(resolve("scripts/g6b-staging-reset.mjs"), "utf8");
const guard = readFileSync(resolve("scripts/g6b-production-guard.mjs"), "utf8");

ok("prod_workflow_has_dispatch", prodWf.includes("workflow_dispatch"));
ok(
  "prod_workflow_no_push_trigger",
  !/^\s+push:\s*$/m.test(prodWf) && !/on:\s*\n\s+push:/m.test(prodWf),
);
ok("prod_workflow_targets_prod_app", prodWf.includes("app-name: Mortgagehub-prod") || prodWf.includes("app-name: 'Mortgagehub-prod'"));
ok("staging_workflow_dispatch_only", stagingWf.includes("workflow_dispatch") && !/^\s+push:\s*$/m.test(stagingWf));
ok(
  "staging_workflow_ref_guard",
  stagingWf.includes('github.ref') === false &&
    stagingWf.includes('refs/heads/targeted-features') &&
    stagingWf.includes("guard-targeted-features-ref") &&
    stagingWf.includes("needs: guard-targeted-features-ref"),
);
ok("staging_workflow_targets_staging_app", stagingWf.includes("Mortgagehub-staging"));
ok("staging_workflow_never_deploys_prod_app", !/app-name: ['"]?Mortgagehub-prod/.test(stagingWf));
ok(
  "staging_workflow_first_deploy_origin",
  stagingWf.includes("https://mortgagehub-staging-f4duc9h6ghhgfwhk.uksouth-01.azurewebsites.net"),
);
ok("staging_workflow_no_unready_custom_domain", !stagingWf.includes("https://staging.mymortgagehub.uk"));
ok("staging_workflow_app_env", stagingWf.includes("APP_ENV: staging") || stagingWf.includes('APP_ENV", "value": "staging"'));
ok("staging_workflow_vite_app_env", stagingWf.includes("VITE_APP_ENV: staging"));
ok("staging_workflow_project_id", stagingWf.includes("VITE_SUPABASE_PROJECT_ID: fwgjtbeigpipvayytwlu"));
ok("staging_workflow_skip_mfa_build", stagingWf.includes("VITE_SKIP_LOGIN_MFA: \"true\""));
ok("staging_workflow_avatar_off", stagingWf.includes('VITE_REALTIME_AVATAR: "false"'));
ok("staging_workflow_no_service_role_literal", !/SUPABASE_SERVICE_ROLE_KEY:\s*['\"]?eyJ/.test(stagingWf));
ok(
  "staging_workflow_no_prod_supabase_url",
  !stagingWf.includes(`https://${PRODUCTION_SUPABASE_REF}.supabase.co`),
);
ok(
  "staging_workflow_denies_prod_ref_in_dist",
  stagingWf.includes(`grep`) && stagingWf.includes(PRODUCTION_SUPABASE_REF),
);
ok(
  "staging_workflow_does_not_bake_supabase_url",
  !/VITE_SUPABASE_URL:\s+https:/.test(stagingWf) && !/VITE_SUPABASE_PUBLISHABLE_KEY:\s+sb_/.test(stagingWf),
);
ok("staging_workflow_capture", stagingWf.includes("COMMUNICATION_DELIVERY_MODE") && stagingWf.includes("capture"));
ok(
  "staging_workflow_smoke_max_time_20",
  stagingWf.includes("--max-time 20") && !stagingWf.includes("--max-time 3"),
);
ok(
  "staging_workflow_smoke_log_on_failure",
  stagingWf.includes("dump_smoke_log") && stagingWf.includes("/tmp/azure-deploy-smoke.log"),
);
ok("staging_example_app_env", example.includes("APP_ENV=staging"));
ok("guard_knows_prod_ref", guard.includes(PRODUCTION_SUPABASE_REF));
ok("guard_knows_staging_ref", guard.includes(STAGING_SUPABASE_REF));
ok("guard_rejects_stale_ref", guard.includes(STALE_LOCAL_SUPABASE_REF));
ok("seed_uses_guard", seed.includes("assertStagingTargetAllowed"));
ok("reset_uses_guard", reset.includes("assertStagingTargetAllowed"));
ok("seed_no_g7_platform_roles", seed.includes("platform_roles"));
ok("bootstrap_exists", existsSync(resolve("scripts/g6b-staging-bootstrap.mjs")));
ok("staging_g2_structural_exists", existsSync(resolve("scripts/g6b-staging-g2-structural.sql")));

const historicalG2 = readFileSync(
  resolve("supabase/migrations/20260917193000_gate_g2_tenant_ownership_and_memberships.sql"),
  "utf8",
);
ok("historical_g2_keeps_prod_auth_guard", historicalG2.includes("expected 6 retained auth users"));
const tenantCtx = readFileSync(resolve("src/lib/tenant-context.server.ts"), "utf8");
ok("no_implicit_001_fallback", tenantCtx.includes("never invents 001 fallback"));
ok(
  "historical_g2_unchanged_vs_head",
  spawnSync("git", ["diff", "--exit-code", "--", "supabase/migrations/20260917193000_gate_g2_tenant_ownership_and_memberships.sql"])
    .status === 0,
);

const stagingG2 = readFileSync(resolve("scripts/g6b-staging-g2-structural.sql"), "utf8");
ok("staging_g2_refuses_auth_users", stagingG2.includes("expected 0 auth users on clean staging"));
ok("staging_g2_no_membership_seed", !stagingG2.includes("INSERT INTO public.tenant_memberships"));

function runScript(file, extraEnv = {}, args = []) {
  return spawnSync(process.execPath, [file, ...args], {
    env: { ...process.env, ...extraEnv },
    encoding: "utf8",
  });
}

const seedVsProd = runScript("scripts/g6b-staging-seed.mjs");
ok(
  "seed_refuses_current_env",
  seedVsProd.status === 2,
  (seedVsProd.stderr || seedVsProd.stdout || "").split("\n")[0],
);
ok(
  "seed_refuses_even_if_app_env_staging_with_prod_url",
  runScript("scripts/g6b-staging-seed.mjs", { APP_ENV: "staging", VITE_APP_ENV: "staging" }).status === 2,
);

const resetVsProd = runScript("scripts/g6b-staging-reset.mjs");
ok(
  "reset_refuses_current_env",
  resetVsProd.status === 2,
  (resetVsProd.stderr || resetVsProd.stdout || "").split("\n")[0],
);
ok(
  "reset_refuses_even_if_app_env_staging_with_prod_url",
  runScript("scripts/g6b-staging-reset.mjs", { APP_ENV: "staging" }).status === 2,
);

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
ok("local_env_still_production_supabase", url.includes(PRODUCTION_SUPABASE_REF), "expected until staging project exists");

const guardEval = `
import { assertStagingTargetAllowed } from "./scripts/g6b-production-guard.mjs";
try {
  const r = assertStagingTargetAllowed();
  console.log(r.projectRef);
  process.exit(0);
} catch (e) {
  console.error(e.message);
  process.exit(2);
}
`;

function runGuard(extraEnv) {
  return spawnSync(process.execPath, ["--input-type=module", "-e", guardEval], {
    env: { ...process.env, ...extraEnv },
    encoding: "utf8",
  });
}

const clearedUrls = {
  VITE_SUPABASE_URL: "",
  DATABASE_URL: "",
  SUPABASE_DB_URL: "",
  VITE_APP_URL: "",
  SUPABASE_PROJECT_ID: "",
  SUPABASE_PROJECT_REF: "",
  VITE_SUPABASE_PROJECT_ID: "",
  G6B_TARGET_PROJECT_REF: "",
  WEBSITE_SITE_NAME: "Mortgagehub-staging",
  APP_BASE_URL: "https://mortgagehub-staging.azurewebsites.net",
  APP_ENV: "staging",
  VITE_APP_ENV: "staging",
};

const stagingAllowed = runGuard({
  ...clearedUrls,
  SUPABASE_URL: `https://${STAGING_SUPABASE_REF}.supabase.co`,
});
ok("guard_allows_exact_staging_ref", stagingAllowed.status === 0, (stagingAllowed.stdout || "").trim());

ok(
  "guard_denies_production_ref",
  runGuard({
    ...clearedUrls,
    SUPABASE_URL: `https://${PRODUCTION_SUPABASE_REF}.supabase.co`,
  }).status === 2,
);
ok(
  "guard_rejects_stale_config_ref",
  runGuard({
    ...clearedUrls,
    SUPABASE_URL: `https://${STALE_LOCAL_SUPABASE_REF}.supabase.co`,
  }).status === 2,
);
ok(
  "guard_rejects_unknown_ref",
  runGuard({
    ...clearedUrls,
    SUPABASE_URL: "https://kjjekwhfhfzrpwpbjqex.supabase.co",
  }).status === 2,
);
ok(
  "guard_rejects_missing_ref",
  runGuard({
    ...clearedUrls,
    SUPABASE_URL: "",
    VITE_SUPABASE_URL: "",
  }).status === 2,
);
ok(
  "guard_rejects_url_ref_mismatch",
  runGuard({
    ...clearedUrls,
    SUPABASE_URL: `https://${STAGING_SUPABASE_REF}.supabase.co`,
    SUPABASE_PROJECT_REF: PRODUCTION_SUPABASE_REF,
  }).status === 2,
);

const bootstrapVsProd = runScript("scripts/g6b-staging-bootstrap.mjs");
ok(
  "bootstrap_refuses_current_env",
  bootstrapVsProd.status === 2,
  (bootstrapVsProd.stderr || bootstrapVsProd.stdout || "").split("\n")[0],
);
const bootstrapStaging = runScript("scripts/g6b-staging-bootstrap.mjs", {
  ...clearedUrls,
  SUPABASE_URL: `https://${STAGING_SUPABASE_REF}.supabase.co`,
});
ok(
  "bootstrap_plan_passes_on_staging_env",
  bootstrapStaging.status === 0,
  (bootstrapStaging.stderr || "").split("\n")[0],
);
ok(
  "bootstrap_apply_flag_does_not_run_sql",
  runScript(
    "scripts/g6b-staging-bootstrap.mjs",
    { ...clearedUrls, SUPABASE_URL: `https://${STAGING_SUPABASE_REF}.supabase.co` },
    ["--apply"],
  ).status === 2,
);

console.log("\n--- G6B local result ---");
if (failures.length) {
  console.error("FAILED:", failures.join(", "));
  process.exit(1);
}
console.log("PASS  all local G6B protection checks");
console.log("STOP  Azure/Supabase provisioning is not authorised from this script.");
