/**
 * Gate G4 — tenant routing / presentation verification (server helpers).
 * Run: node --env-file=.env scripts/g4-routing-verify.mjs
 */
import { createClient } from "@supabase/supabase-js";

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

const { data: tenants, error: tErr } = await admin
  .from("tenants")
  .select("id, company_code, slug, company_name, trading_name, status, tenant_type, website_url")
  .order("company_code");
if (tErr) throw tErr;

const t001 = tenants.find((t) => t.company_code === "001");
const t002 = tenants.find((t) => t.company_code === "002");
ok("resolve_mortgageeasy", t001?.slug === "mortgageeasy" && t001.status === "active");
ok("resolve_trentvalleyfs", t002?.slug === "trentvalleyfs" && t002.status === "active");
ok("unknown_slug_absent", !tenants.some((t) => t.slug === "unknown-company"));

const { data: branding } = await admin.from("tenant_branding").select("*");
const b001 = branding?.find((b) => b.tenant_id === t001.id);
const b002 = branding?.find((b) => b.tenant_id === t002.id);
ok("branding_001_me_logo", b001?.logo_path?.includes("mortgageeasy"));
ok("branding_002_tvfs_logo", b002?.logo_path?.includes("trentvalleyfs"));
ok("branding_002_not_me", !b002?.logo_path?.includes("mortgageeasy"));
ok("website_001_set", t001.website_url === "/mortgageeasy/");
ok("website_002_null_no_guess", t002.website_url == null);

const ownerId = "5eef06a0-5292-44fd-bf01-4c934f8c8725";
const { data: admin001 } = await admin.rpc("can_administer_tenant", {
  p_user_id: ownerId,
  p_tenant_id: t001.id,
});
const { data: data002 } = await admin.rpc("can_access_tenant_data", {
  p_user_id: ownerId,
  p_tenant_id: t002.id,
});
ok("owner_admin_001", admin001 === true);
ok("owner_data_002_denied", data002 === false);

const { count: mem002 } = await admin
  .from("tenant_memberships")
  .select("*", { count: "exact", head: true })
  .eq("tenant_id", t002.id);
ok("mem_002_zero", mem002 === 0, String(mem002));

const { count: platformRoles } = await admin
  .from("platform_roles")
  .select("*", { count: "exact", head: true });
ok("platform_roles_0", platformRoles === 0);

const { data: features } = await admin
  .from("tenant_features")
  .select("tenant_id, state")
  .eq("feature_key", "susan_ai_journey");
ok("susan_001_enabled", features?.find((f) => f.tenant_id === t001.id)?.state === "enabled");
ok("susan_002_disabled", features?.find((f) => f.tenant_id === t002.id)?.state === "disabled");

const { data: users } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
ok("auth_users_6", (users?.users?.length ?? 0) === 6);

if (failures.length) {
  console.error(`\n${failures.length} failure(s)`);
  process.exit(1);
}
console.log("\nG4 routing/branding data checks PASS");
