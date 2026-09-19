/**
 * Gate G6B — deterministic staging seed (synthetic 001/002 config only).
 * Refuses production. Does not copy production customers/cases/comms/finance.
 *
 * Run (staging project only):
 *   APP_ENV=staging SUPABASE_URL=https://<staging>.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=... node scripts/g6b-staging-seed.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { assertStagingTargetAllowed, ProductionGuardError } from "./g6b-production-guard.mjs";

const failures = [];
function ok(name, cond, detail = "") {
  if (cond) console.log(`PASS  ${name}${detail ? ` — ${detail}` : ""}`);
  else {
    console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
    failures.push(name);
  }
}

export const SYNTHETIC_PERSONAS = {
  "001": [
    { email: "staging-001-owner@example.test", role: "owner", label: "001 Owner" },
    { email: "staging-001-supervisor@example.test", role: "supervisor", label: "001 Supervisor" },
    { email: "staging-001-general@example.test", role: "general", label: "001 General Admin" },
    { email: "staging-001-adviser@example.test", role: "adviser", label: "001 Adviser" },
    { email: "staging-001-introducer@example.test", role: "introducer", label: "001 Introducer" },
    { email: "staging-001-customer@example.test", role: "customer", label: "001 Customer" },
  ],
  "002": [
    { email: "staging-002-owner@example.test", role: "owner", label: "002 Owner" },
    { email: "staging-002-supervisor@example.test", role: "supervisor", label: "002 Supervisor" },
    { email: "staging-002-general@example.test", role: "general", label: "002 General Admin" },
    { email: "staging-002-adviser@example.test", role: "adviser", label: "002 Adviser" },
    { email: "staging-002-introducer@example.test", role: "introducer", label: "002 Introducer" },
    { email: "staging-002-customer@example.test", role: "customer", label: "002 Customer" },
  ],
};

const TENANTS = [
  {
    company_code: "001",
    slug: "mortgageeasy",
    company_name: "Mortgage Easy",
    trading_name: "Mortgage Easy",
    legal_name: "Mortgage Easy",
    tenant_type: "GROUP",
    status: "active",
    website_url: "/mortgageeasy/",
    logo_path: "mortgageeasy/logo.png",
    primary_colour: "#1a2f4f",
    secondary_colour: "#3d9e47",
    from_name: "Mortgage Easy (STAGING)",
  },
  {
    company_code: "002",
    slug: "trentvalleyfs",
    company_name: "Trent Valley Financial Services",
    trading_name: "Trent Valley Financial Services",
    legal_name: "Trent Valley Financial Services",
    tenant_type: "GROUP",
    status: "active",
    website_url: null,
    logo_path: "trentvalleyfs/logo.png",
    primary_colour: "#0b1524",
    secondary_colour: "#6b93b0",
    from_name: "Trent Valley (STAGING)",
  },
];

try {
  assertStagingTargetAllowed();
} catch (err) {
  if (err instanceof ProductionGuardError) {
    console.error(err.message);
    process.exit(2);
  }
  throw err;
}

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!key) {
  console.error("REFUSED: SUPABASE_SERVICE_ROLE_KEY missing (staging secret required).");
  process.exit(2);
}

const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

async function upsertTenant(spec) {
  const { data: existing, error: findErr } = await admin
    .from("tenants")
    .select("id")
    .eq("company_code", spec.company_code)
    .maybeSingle();
  if (findErr) throw findErr;
  const row = {
    company_code: spec.company_code,
    slug: spec.slug,
    company_name: spec.company_name,
    trading_name: spec.trading_name,
    legal_name: spec.legal_name,
    tenant_type: spec.tenant_type,
    status: spec.status,
    website_url: spec.website_url,
  };
  let id = existing?.id;
  if (id) {
    const { error } = await admin.from("tenants").update({ ...row, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) throw error;
  } else {
    const { data, error } = await admin.from("tenants").insert(row).select("id").single();
    if (error) throw error;
    id = data.id;
  }
  await admin.from("tenant_branding").upsert({
    tenant_id: id,
    logo_path: spec.logo_path,
    primary_colour: spec.primary_colour,
    secondary_colour: spec.secondary_colour,
    updated_at: new Date().toISOString(),
  });
  await admin.from("tenant_comms_config").upsert({
    tenant_id: id,
    from_name: spec.from_name,
    email_footer: "TEST DATA — staging only. Not a live firm communication.",
    sms_footer: "TEST DATA staging",
    updated_at: new Date().toISOString(),
  });
  await admin.from("tenant_settings").upsert({ tenant_id: id, updated_at: new Date().toISOString() });
  return id;
}

async function seedFeatures(tenantId, companyCode) {
  const { data: catalogue, error } = await admin
    .from("feature_catalogue")
    .select("feature_key")
    .eq("active", true);
  if (error) throw error;
  if (companyCode === "001") {
    for (const row of catalogue ?? []) {
      if (row.feature_key === "password_recovery") continue;
      const { error: upErr } = await admin.from("tenant_features").upsert(
        { tenant_id: tenantId, feature_key: row.feature_key, state: "enabled" },
        { onConflict: "tenant_id,feature_key" },
      );
      if (upErr) throw upErr;
    }
    await admin.from("tenant_features").upsert(
      { tenant_id: tenantId, feature_key: "susan_ai_journey", state: "enabled" },
      { onConflict: "tenant_id,feature_key" },
    );
  } else {
    await admin.from("tenant_features").upsert(
      { tenant_id: tenantId, feature_key: "susan_ai_journey", state: "disabled" },
      { onConflict: "tenant_id,feature_key" },
    );
  }
}

const ids = {};
for (const spec of TENANTS) {
  ids[spec.company_code] = await upsertTenant(spec);
  await seedFeatures(ids[spec.company_code], spec.company_code);
  ok(`tenant_${spec.company_code}`, Boolean(ids[spec.company_code]));
}

const { data: susan } = await admin
  .from("tenant_features")
  .select("tenant_id, state")
  .eq("feature_key", "susan_ai_journey");
ok("susan_001_enabled", susan?.find((r) => r.tenant_id === ids["001"])?.state === "enabled");
ok("susan_002_disabled", susan?.find((r) => r.tenant_id === ids["002"])?.state === "disabled");

const { count: platformRoles } = await admin.from("platform_roles").select("*", { count: "exact", head: true });
ok("platform_roles_remain_0", platformRoles === 0, String(platformRoles));

console.log("\nSynthetic Auth personas are NOT created by this script (no passwords in Git).");
console.log("Create them in the staging Auth project after it exists:");
for (const group of Object.values(SYNTHETIC_PERSONAS)) {
  for (const p of group) console.log(`  ${p.email}  ${p.label}`);
}

if (failures.length) {
  console.error("\nG6B seed FAILED:", failures.join(", "));
  process.exit(1);
}
console.log("\nG6B staging config seed OK (no production data copied).");
