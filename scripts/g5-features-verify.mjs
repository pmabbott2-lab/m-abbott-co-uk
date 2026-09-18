/**
 * Gate G5 — feature enforcement verification.
 * Run: node --env-file=.env scripts/g5-features-verify.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const failures = [];
function ok(name, cond, detail = "") {
  if (cond) console.log(`PASS  ${name}${detail ? ` — ${detail}` : ""}`);
  else {
    console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
    failures.push(name);
  }
}

const { data: tenants } = await admin.from("tenants").select("id, company_code, slug").order("company_code");
const t001 = tenants.find((t) => t.company_code === "001");
const t002 = tenants.find((t) => t.company_code === "002");
ok("tenants", !!t001 && !!t002);

const { data: cat } = await admin.from("feature_catalogue").select("feature_key").eq("active", true);
ok("catalogue_24", (cat ?? []).length === 24, String((cat ?? []).length));

async function enabled(tenantId, key) {
  const { data } = await admin.rpc("is_tenant_feature_enabled", {
    p_tenant_id: tenantId,
    p_feature_key: key,
  });
  return data === true;
}

ok("susan_001_enabled", await enabled(t001.id, "susan_ai_journey"));
ok("susan_002_disabled", !(await enabled(t002.id, "susan_ai_journey")));
ok("susan_chat_001", await enabled(t001.id, "susan_chat_journey"));
ok("susan_chat_002_off", !(await enabled(t002.id, "susan_chat_journey")));
ok("booking_001", await enabled(t001.id, "appointment_booking"));
ok("booking_002_off", !(await enabled(t002.id, "appointment_booking")));
ok("password_recovery_default", await enabled(t002.id, "password_recovery"));

const { count: f001 } = await admin
  .from("tenant_features")
  .select("*", { count: "exact", head: true })
  .eq("tenant_id", t001.id);
ok("001_feature_rows_seeded", (f001 ?? 0) >= 20, String(f001));

const { data: access001 } = await admin.rpc("can_access_tenant_data", {
  p_user_id: "5eef06a0-5292-44fd-bf01-4c934f8c8725",
  p_tenant_id: t001.id,
});
const { data: access002 } = await admin.rpc("can_access_tenant_data", {
  p_user_id: "5eef06a0-5292-44fd-bf01-4c934f8c8725",
  p_tenant_id: t002.id,
});
ok("owner_001", access001 === true);
ok("owner_002_denied", access002 === false);

const { count: mem002 } = await admin
  .from("tenant_memberships")
  .select("*", { count: "exact", head: true })
  .eq("tenant_id", t002.id);
ok("mem_002_zero", mem002 === 0);

const { count: pr } = await admin.from("platform_roles").select("*", { count: "exact", head: true });
ok("platform_roles_0", pr === 0);

const files = {
  interview: "src/routes/api/interview-step.ts",
  avatar: "src/routes/api/avatar-token.ts",
  tts: "src/routes/api/tts.ts",
  stt: "src/routes/api/stt.ts",
  features: "src/lib/tenant-features.server.ts",
  urls: "src/lib/tenant-url.ts",
  booking: "src/lib/booking.functions.ts",
};
for (const [name, path] of Object.entries(files)) {
  const src = readFileSync(resolve(path), "utf8");
  if (name === "urls") ok("url_builder", src.includes("buildTenantPath") && !src.includes("mortgageeasy"));
  else if (name === "features") ok("requireTenantFeature_export", src.includes("export async function requireTenantFeature"));
  else if (name === "booking") ok("booking_feature_gate", src.includes('requireTenantFeature(tenantId, "appointment_booking")'));
  else ok(`${name}_susan_guard`, src.includes("requireSusanApiAccess"));
}

ok("tenant_book_route", readFileSync(resolve("src/routes/$tenantSlug/book.$introducerSlug.tsx"), "utf8").includes("appointment_booking"));
ok("no_hardcoded_me_in_url_builder", !readFileSync(resolve("src/lib/tenant-url.ts"), "utf8").includes("mortgageeasy"));

let extId = null;
try {
  const { data: ext, error } = await admin
    .from("tenants")
    .insert({
      company_code: "904",
      slug: "g5-ext-probe",
      company_name: "G5 External Probe",
      status: "active",
      tenant_type: "EXTERNAL",
    })
    .select("id")
    .single();
  if (error) throw error;
  extId = ext.id;
  await admin.from("tenant_features").insert({
    tenant_id: extId,
    feature_key: "susan_ai_journey",
    state: "enabled",
  });
  const { data: featOn } = await admin.rpc("is_tenant_feature_enabled", {
    p_tenant_id: extId,
    p_feature_key: "susan_ai_journey",
  });
  const { data: dataDenied } = await admin.rpc("can_access_tenant_data", {
    p_user_id: "5eef06a0-5292-44fd-bf01-4c934f8c8725",
    p_tenant_id: extId,
  });
  ok("external_feature_on_not_data", featOn === true && dataDenied === false);
} catch (e) {
  ok("external_feature_on_not_data", false, String(e?.message || e));
} finally {
  if (extId) {
    await admin.from("tenant_features").delete().eq("tenant_id", extId);
    await admin.from("tenants").delete().eq("id", extId);
  }
  const { data: gone } = await admin.from("tenants").select("id").eq("slug", "g5-ext-probe").maybeSingle();
  ok("external_cleaned", gone == null);
}

const { count: mem002b } = await admin
  .from("tenant_memberships")
  .select("*", { count: "exact", head: true })
  .eq("tenant_id", t002.id);
ok("final_mem_002_zero", mem002b === 0);

if (failures.length) {
  console.error(`\n${failures.length} failure(s): ${failures.join(", ")}`);
  process.exit(1);
}
console.log("\nG5 verification PASS");
