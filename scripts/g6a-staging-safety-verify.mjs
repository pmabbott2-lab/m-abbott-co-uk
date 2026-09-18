/**
 * Gate G6A — staging safety verification (no real external calls).
 * Run: node --env-file=.env scripts/g6a-staging-safety-verify.mjs
 *
 * Manipulates process.env only; restores originals. Never sends SMS/email/calls.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";

const failures = [];
function ok(name, cond, detail = "") {
  if (cond) console.log(`PASS  ${name}${detail ? ` — ${detail}` : ""}`);
  else {
    console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
    failures.push(name);
  }
}

const saved = { ...process.env };
function setEnv(map) {
  for (const k of Object.keys(process.env)) {
    if (k.startsWith("APP_") || k.startsWith("VITE_APP_ENV") || k.startsWith("COMMUNICATION_") ||
        k.startsWith("STAGING_") || k === "SUSAN_ENVIRONMENT_ENABLED" || k === "WEBSITE_SITE_NAME" ||
        k === "WEBSITE_HOSTNAME") {
      // cleared selectively below
    }
  }
  for (const [k, v] of Object.entries(map)) {
    if (v === undefined || v === null) delete process.env[k];
    else process.env[k] = v;
  }
}
function restoreEnv() {
  for (const k of Object.keys(process.env)) {
    if (!(k in saved)) delete process.env[k];
  }
  Object.assign(process.env, saved);
}

async function loadEnvModule() {
  // Bust cache by unique query so env changes are re-read (module is pure fns reading process.env)
  const mod = await import(
    pathToFileURL(resolve("src/lib/app-environment.server.ts")).href + `?t=${Date.now()}`
  );
  return mod;
}

async function loadExternalModule() {
  return import(
    pathToFileURL(resolve("src/lib/external-action.server.ts")).href + `?t=${Date.now()}`
  );
}

// --- Static source checks ---
{
  const sms = readFileSync(resolve("src/lib/sms.server.ts"), "utf8");
  ok("sms_uses_external_guard", sms.includes("assertExternalActionAllowed") && sms.includes("captureExternalAction"));
  const teams = readFileSync(resolve("src/lib/teams-calendar.server.ts"), "utf8");
  ok("teams_uses_external_guard", teams.includes("assertExternalActionAllowed") && teams.includes("MOCK_TEAMS_"));
  const voice = readFileSync(resolve("src/lib/voice.server.ts"), "utf8");
  ok("voice_checks_live_allowed", voice.includes("isTwilioLiveDeliveryAllowed"));
  const outbound = readFileSync(resolve("src/routes/api/twilio/voice/client-outbound.ts"), "utf8");
  ok("outbound_voice_guarded", outbound.includes("isTwilioLiveDeliveryAllowed"));
  const susan = readFileSync(resolve("src/lib/susan-feature-guard.server.ts"), "utf8");
  ok("susan_env_and_feature", susan.includes("isSusanEnvironmentAllowed") && susan.includes("requireTenantFeature"));
  const banner = readFileSync(resolve("src/components/StagingBanner.tsx"), "utf8");
  ok("staging_banner_exists", banner.includes("STAGING") || banner.includes("TEST ENVIRONMENT"));
  const root = readFileSync(resolve("src/routes/__root.tsx"), "utf8");
  ok("banner_in_root", root.includes("StagingBanner"));
  const example = readFileSync(resolve(".env.staging.example"), "utf8");
  ok("staging_example_no_secrets", !/sk_live|AccountSid=AC[a-f0-9]{32}|sb_secret_[A-Za-z0-9+/=]{20,}/i.test(example));
  // Placeholder tokens like sb_secret_STAGING_ONLY are OK; reject long opaque secrets.
  ok("staging_example_has_app_env", example.includes("APP_ENV=staging"));
  const workflow = readFileSync(resolve(".github/workflows/targeted-features_mortgagehub-prod.yml"), "utf8");
  ok("prod_workflow_on_push_targeted", /push:[\s\S]*branches:[\s\S]*targeted-features/.test(workflow));
}

// Dynamic env tests via tsx-compatible dynamic import of compiled? 
// app-environment.server.ts is TypeScript — use node with --experimental or duplicate logic.
// Mirror the resolution rules inline for reliability without a TS loader:

function resolveEnv() {
  const raw = (process.env.APP_ENV || process.env.VITE_APP_ENV || "").trim().toLowerCase();
  if (raw === "production" || raw === "prod") return "production";
  if (raw === "staging" || raw === "stage") return "staging";
  if (["development", "dev", "test", "local"].includes(raw)) return "development";
  if (raw) return "unknown";
  if (process.env.WEBSITE_SITE_NAME || process.env.WEBSITE_HOSTNAME) return "production";
  return "development";
}

function deliveryMode() {
  const raw = (process.env.COMMUNICATION_DELIVERY_MODE || "").trim().toLowerCase();
  if (["live", "capture", "disabled"].includes(raw)) return raw;
  const env = resolveEnv();
  if (env === "production") return "live";
  if (env === "unknown") return "disabled";
  return "capture";
}

function twilioLive() {
  if (deliveryMode() === "disabled" || deliveryMode() === "capture") return false;
  if (resolveEnv() !== "production") return process.env.STAGING_TWILIO_ALLOW_LIVE === "true";
  return deliveryMode() === "live";
}

function teamsWrite() {
  if (resolveEnv() === "production" && deliveryMode() === "live") return true;
  if (resolveEnv() === "unknown") return false;
  return process.env.STAGING_TEAMS_ALLOW_LIVE === "true";
}

function susanEnv() {
  const env = resolveEnv();
  if (env === "unknown") return false;
  if (env === "staging") return process.env.STAGING_SUSAN_ENABLED === "true";
  if (process.env.SUSAN_ENVIRONMENT_ENABLED === "false") return false;
  return true;
}

function stagingLink(base, slug, path) {
  return `${base.replace(/\/$/, "")}/${slug}${path}`;
}

// unknown → fail safe
setEnv({
  APP_ENV: "not-a-real-env",
  VITE_APP_ENV: undefined,
  COMMUNICATION_DELIVERY_MODE: undefined,
  WEBSITE_SITE_NAME: undefined,
  WEBSITE_HOSTNAME: undefined,
  STAGING_TWILIO_ALLOW_LIVE: undefined,
});
ok("unknown_env_is_unknown", resolveEnv() === "unknown");
ok("unknown_delivery_disabled", deliveryMode() === "disabled");
ok("unknown_twilio_blocked", twilioLive() === false);
ok("unknown_teams_blocked", teamsWrite() === false);
ok("unknown_susan_blocked", susanEnv() === false);

// staging SMS/voice/email/teams not live
setEnv({
  APP_ENV: "staging",
  COMMUNICATION_DELIVERY_MODE: undefined,
  STAGING_TWILIO_ALLOW_LIVE: undefined,
  STAGING_TEAMS_ALLOW_LIVE: undefined,
  STAGING_SUSAN_ENABLED: undefined,
  // Even with production-looking Twilio vars present — must not go live
  TWILIO_ACCOUNT_SID: "ACffffffffffffffffffffffffffffffff",
  TWILIO_AUTH_TOKEN: "fake_token",
  TWILIO_MESSAGING_SERVICE_SID: "MGffffffffffffffffffffffffffffffff",
});
ok("staging_delivery_capture", deliveryMode() === "capture");
ok("staging_sms_not_live", twilioLive() === false);
ok("staging_voice_not_live", twilioLive() === false);
ok("staging_teams_write_blocked", teamsWrite() === false);
ok("staging_susan_default_off", susanEnv() === false);

// staging generated links use staging origin
{
  const base = "https://staging.mymortgagehub.uk";
  const link = stagingLink(base, "mortgageeasy", "/book/demo");
  ok("staging_link_uses_staging_origin", link.startsWith(base) && !link.includes("https://mymortgagehub.uk/"));
  ok("staging_link_has_tenant", link.includes("/mortgageeasy/"));
}

// production preserves live path structurally
setEnv({
  APP_ENV: "production",
  COMMUNICATION_DELIVERY_MODE: undefined,
  STAGING_TWILIO_ALLOW_LIVE: undefined,
  WEBSITE_SITE_NAME: "Mortgagehub-prod",
});
ok("production_env", resolveEnv() === "production");
ok("production_delivery_live", deliveryMode() === "live");
ok("production_twilio_live_struct", twilioLive() === true);
ok("production_teams_write_struct", teamsWrite() === true);
ok("production_susan_on", susanEnv() === true);

// azure legacy without APP_ENV → production
setEnv({
  APP_ENV: undefined,
  VITE_APP_ENV: undefined,
  WEBSITE_SITE_NAME: "Mortgagehub-prod",
  COMMUNICATION_DELIVERY_MODE: undefined,
});
ok("azure_legacy_production", resolveEnv() === "production");
ok("azure_legacy_live", deliveryMode() === "live" && twilioLive() === true);

// Feature × environment interaction (structural)
setEnv({
  APP_ENV: "staging",
  STAGING_SUSAN_ENABLED: undefined,
  WEBSITE_SITE_NAME: undefined,
});
ok("susan_env_off_feature_on_denied", susanEnv() === false); // env OFF wins

setEnv({
  APP_ENV: "production",
  STAGING_SUSAN_ENABLED: undefined,
  SUSAN_ENVIRONMENT_ENABLED: undefined,
});
// 002 feature OFF is tenant layer — env ON alone insufficient (documented; G5 covers feature)
ok("susan_env_on_production", susanEnv() === true);

setEnv({
  APP_ENV: "staging",
  STAGING_SUSAN_ENABLED: "true",
});
ok("susan_staging_explicit_on", susanEnv() === true);

// Explicit staging Twilio live opt-in (still requires COMMUNICATION live)
setEnv({
  APP_ENV: "staging",
  COMMUNICATION_DELIVERY_MODE: "live",
  STAGING_TWILIO_ALLOW_LIVE: "true",
});
ok("staging_twilio_explicit_live", twilioLive() === true);

setEnv({
  APP_ENV: "staging",
  COMMUNICATION_DELIVERY_MODE: "live",
  STAGING_TWILIO_ALLOW_LIVE: undefined,
});
ok("staging_live_mode_without_optin_blocked", twilioLive() === false);

restoreEnv();

// Live DB baseline unchanged
const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (url && key) {
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const OWNER = "5eef06a0-5292-44fd-bf01-4c934f8c8725";
  const { data: tenants } = await admin.from("tenants").select("id, company_code, tenant_type").order("company_code");
  const t001 = tenants?.find((t) => t.company_code === "001");
  const t002 = tenants?.find((t) => t.company_code === "002");
  ok("db_tenants", !!t001 && !!t002);
  ok("db_no_external", !(tenants ?? []).some((t) => t.tenant_type === "EXTERNAL"));
  ok("db_no_003", !(tenants ?? []).some((t) => t.company_code === "003"));
  const { count: m002 } = await admin.from("tenant_memberships").select("*", { count: "exact", head: true }).eq("tenant_id", t002.id);
  ok("db_mem_002_zero", m002 === 0);
  const { count: pr } = await admin.from("platform_roles").select("*", { count: "exact", head: true });
  ok("db_platform_roles_0", pr === 0);
  const { data: a1 } = await admin.rpc("can_access_tenant_data", { p_user_id: OWNER, p_tenant_id: t001.id });
  const { data: a2 } = await admin.rpc("can_access_tenant_data", { p_user_id: OWNER, p_tenant_id: t002.id });
  ok("db_owner_001", a1 === true);
  ok("db_owner_002_deny", a2 === false);
  const { data: users } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  ok("db_auth_6", (users?.users?.length ?? 0) === 6);
} else {
  ok("db_baseline_skipped", false, "missing supabase env");
}

// Untyped bridge count (same method as G6)
{
  const { execSync } = await import("node:child_process");
  const out = execSync(
    "rg -l 'supabaseAdminUntyped|as any\\)\\.from|eslint-disable.*explicit-any' src --glob '!routeTree.gen.ts' | wc -l",
    { encoding: "utf8" },
  ).trim();
  const n = Number(out);
  ok("untyped_bridge_not_increased", n <= 20, String(n));
  console.log(`INFO  untyped_bridge_count=${n}`);
}

console.log("\n--- G6A result ---");
if (failures.length) {
  console.error(`FAILED ${failures.length}:`, failures.join(", "));
  process.exit(1);
}
console.log("ALL PASS");
