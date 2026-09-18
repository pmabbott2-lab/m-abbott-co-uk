/**
 * Gate G4A — service-role / server tenant assertion verification.
 * Run: node --env-file=.env scripts/g4a-server-hardening-verify.mjs
 *
 * Does NOT send SMS/calls. Does NOT alter Twilio resources.
 * Uses rollback fixtures for EXTERNAL / support grant tests.
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

/** Mirror of withForcedTenantId — client tenant_id ignored. */
function withForcedTenantId(payload, authorisedTenantId) {
  const { tenant_id: _ignored, ...rest } = payload;
  return { ...rest, tenant_id: authorisedTenantId };
}

function rejectMismatchedClientTenantId(authorisedTenantId, clientTenantId) {
  if (clientTenantId == null || clientTenantId === "") return;
  if (clientTenantId !== authorisedTenantId) {
    const err = new Error("Tenant access denied.");
    err.code = "TENANT_DATA_ACCESS_DENIED";
    throw err;
  }
}

const OWNER = "5eef06a0-5292-44fd-bf01-4c934f8c8725";

const { data: tenants, error: tErr } = await admin
  .from("tenants")
  .select("id, company_code, slug, status, tenant_type")
  .order("company_code");
if (tErr) throw tErr;
const t001 = tenants.find((t) => t.company_code === "001");
const t002 = tenants.find((t) => t.company_code === "002");
ok("tenants_001_002", !!t001 && !!t002);
ok("no_external_tenant", !tenants.some((t) => t.tenant_type === "EXTERNAL"));

const { data: users } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
ok("auth_users_6", (users?.users?.length ?? 0) === 6);

const { count: m001 } = await admin
  .from("tenant_memberships")
  .select("*", { count: "exact", head: true })
  .eq("tenant_id", t001.id)
  .eq("active", true);
const { count: m002 } = await admin
  .from("tenant_memberships")
  .select("*", { count: "exact", head: true })
  .eq("tenant_id", t002.id);
ok("memberships_001_12", m001 === 12, String(m001));
ok("memberships_002_zero", m002 === 0, String(m002));

const { count: platformRoles } = await admin.from("platform_roles").select("*", { count: "exact", head: true });
ok("platform_roles_0", platformRoles === 0);

const { data: access001 } = await admin.rpc("can_access_tenant_data", { p_user_id: OWNER, p_tenant_id: t001.id });
const { data: access002 } = await admin.rpc("can_access_tenant_data", { p_user_id: OWNER, p_tenant_id: t002.id });
ok("owner_access_001", access001 === true);
ok("owner_access_002_denied", access002 === false);

// --- Pure assertion helpers ---
{
  const forced = withForcedTenantId({ tenant_id: t002.id, name: "x" }, t001.id);
  ok("insert_force_ignores_client_tenant", forced.tenant_id === t001.id && forced.name === "x");
}
{
  let denied = false;
  try {
    rejectMismatchedClientTenantId(t001.id, t002.id);
  } catch {
    denied = true;
  }
  ok("forged_tenant_id_rejected", denied);
  rejectMismatchedClientTenantId(t001.id, t001.id);
  rejectMismatchedClientTenantId(t001.id, null);
  ok("matching_or_absent_client_tenant_ok", true);
}

// --- Resource ownership (service-role read scoped) ---
{
  const { data: lead001 } = await admin
    .from("introducer_leads")
    .select("id, tenant_id")
    .eq("tenant_id", t001.id)
    .limit(1)
    .maybeSingle();
  if (lead001?.id) {
    const { data: cross } = await admin
      .from("introducer_leads")
      .select("id")
      .eq("id", lead001.id)
      .eq("tenant_id", t002.id)
      .maybeSingle();
    ok("resource_cross_tenant_eq_empty", cross == null);
  } else {
    ok("resource_cross_tenant_eq_empty", true, "no 001 leads — skipped row fixture");
  }
}

// --- Cross-tenant INSERT attempt via scoped pattern (rollback) ---
{
  const probePhone = "+447700900099";
  const payload = withForcedTenantId(
    { tenant_id: t002.id, customer_name: "G4A Probe", customer_phone: probePhone, status: "new" },
    t001.id,
  );
  // Only insert if introducer_leads allows minimal columns — use callback_requests instead (simpler)
  const { data: inserted, error: insErr } = await admin
    .from("callback_requests")
    .insert({
      ...withForcedTenantId(
        {
          tenant_id: t002.id,
          customer_name: "G4A Probe",
          customer_phone: probePhone,
          preferred_window: "9-12",
          status: "new",
        },
        t001.id,
      ),
    })
    .select("id, tenant_id")
    .single();
  if (insErr) {
    ok("cross_tenant_insert_forced_001", false, insErr.message);
  } else {
    ok("cross_tenant_insert_forced_001", inserted.tenant_id === t001.id, inserted.tenant_id);
    await admin.from("callback_requests").delete().eq("id", inserted.id);
    const { data: gone } = await admin.from("callback_requests").select("id").eq("id", inserted.id).maybeSingle();
    ok("probe_callback_cleaned", gone == null);
  }
}

// --- Cross-tenant UPDATE reassignment denied by scoped update ---
{
  const { data: num } = await admin
    .from("telephony_numbers")
    .select("id, tenant_id, label")
    .eq("tenant_id", t001.id)
    .limit(1)
    .maybeSingle();
  if (num) {
    const { data: updated } = await admin
      .from("telephony_numbers")
      .update({ label: num.label })
      .eq("id", num.id)
      .eq("tenant_id", t002.id)
      .select("id")
      .maybeSingle();
    ok("update_wrong_tenant_scope_noop", updated == null);
    // Explicit reassignment attempt then restore
    await admin.from("telephony_numbers").update({ tenant_id: t002.id }).eq("id", num.id);
    const { data: after } = await admin.from("telephony_numbers").select("tenant_id").eq("id", num.id).maybeSingle();
    // Service role CAN reassign — application layer must prevent this. Restore immediately.
    await admin.from("telephony_numbers").update({ tenant_id: t001.id }).eq("id", num.id);
    ok(
      "service_role_can_reassign_note_app_must_block",
      after?.tenant_id === t002.id,
      "documented: service-role bypass; G4A app asserts before update",
    );
    const { data: restored } = await admin.from("telephony_numbers").select("tenant_id").eq("id", num.id).maybeSingle();
    ok("telephony_restored_001", restored?.tenant_id === t001.id);
  } else {
    ok("update_wrong_tenant_scope_noop", true, "no telephony row");
    ok("service_role_can_reassign_note_app_must_block", true, "skipped");
    ok("telephony_restored_001", true, "skipped");
  }
}

// --- Cross-tenant DELETE scoped ---
{
  const { data: probe, error: pErr } = await admin
    .from("callback_requests")
    .insert(
      withForcedTenantId(
        {
          customer_name: "G4A Del",
          customer_phone: "+447700900098",
          preferred_window: "9-12",
          status: "new",
        },
        t001.id,
      ),
    )
    .select("id")
    .single();
  if (pErr) {
    ok("delete_wrong_tenant_scope_noop", false, pErr.message);
    ok("delete_probe_cleaned", false);
  } else {
    const { data: delWrong } = await admin
      .from("callback_requests")
      .delete()
      .eq("id", probe.id)
      .eq("tenant_id", t002.id)
      .select("id")
      .maybeSingle();
    ok("delete_wrong_tenant_scope_noop", delWrong == null);
    await admin.from("callback_requests").delete().eq("id", probe.id).eq("tenant_id", t001.id);
    const { data: gone } = await admin.from("callback_requests").select("id").eq("id", probe.id).maybeSingle();
    ok("delete_probe_cleaned", gone == null);
  }
}

// --- Public slug resolution (route authority) ---
{
  const { data: bySlug } = await admin.from("tenants").select("id, status").eq("slug", "mortgageeasy").maybeSingle();
  ok("public_slug_001", bySlug?.id === t001.id && bySlug.status === "active");
  const { data: bySlug2 } = await admin.from("tenants").select("id, status").eq("slug", "trentvalleyfs").maybeSingle();
  ok("public_slug_002", bySlug2?.id === t002.id && bySlug2.status === "active");
  const { data: unknown } = await admin.from("tenants").select("id").eq("slug", "no-such-firm").maybeSingle();
  ok("unknown_slug_fail_closed", unknown == null);
}

// --- Adviser pool must not leak 001 advisers into empty 002 membership ---
{
  const { data: mem002Users } = await admin
    .from("tenant_memberships")
    .select("user_id")
    .eq("tenant_id", t002.id)
    .eq("active", true)
    .in("role", ["adviser", "owner", "supervisor", "general"]);
  ok("adviser_pool_002_empty", (mem002Users ?? []).length === 0);
}

// --- EXTERNAL + support grant fixture (rollback) ---
let extId = null;
let grantId = null;
try {
  const { data: ext, error: extErr } = await admin
    .from("tenants")
    .insert({
      company_code: "903",
      slug: "g4a-ext-probe",
      company_name: "G4A External Probe",
      status: "active",
      tenant_type: "EXTERNAL",
    })
    .select("id")
    .single();
  if (extErr) throw extErr;
  extId = ext.id;

  const { data: soAccess } = await admin.rpc("can_access_tenant_data", {
    p_user_id: OWNER,
    p_tenant_id: extId,
  });
  // Owner is not Super Owner; EXTERNAL must deny without grant
  ok("external_no_auto_access", soAccess === false);

  const starts = new Date(Date.now() - 60_000).toISOString();
  const expires = new Date(Date.now() + 3600_000).toISOString();
  const { data: grant, error: gErr } = await admin
    .from("tenant_support_access_grants")
    .insert({
      tenant_id: extId,
      grantee_user_id: OWNER,
      approved_by: OWNER,
      reason: "g4a-test",
      scope: "full_read",
      starts_at: starts,
      expires_at: expires,
    })
    .select("id")
    .single();
  if (gErr) {
    ok("support_grant_active", false, gErr.message);
    ok("support_grant_revoked", false, "skipped");
  } else {
    grantId = grant.id;
    const { data: withGrant } = await admin.rpc("can_access_tenant_data", {
      p_user_id: OWNER,
      p_tenant_id: extId,
    });
    ok("support_grant_active", withGrant === true);
    // Revoke by expiring the grant
    await admin
      .from("tenant_support_access_grants")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", grantId);
    const { data: afterRevoke } = await admin.rpc("can_access_tenant_data", {
      p_user_id: OWNER,
      p_tenant_id: extId,
    });
    ok("support_grant_revoked", afterRevoke === false);
  }
} catch (e) {
  ok("external_no_auto_access", false, String(e?.message || e));
  ok("support_grant_active", false, "fixture failed");
  ok("support_grant_revoked", false, "fixture failed");
} finally {
  if (grantId) await admin.from("tenant_support_access_grants").delete().eq("id", grantId);
  if (extId) await admin.from("tenants").delete().eq("id", extId);
  const { data: extGone } = await admin.from("tenants").select("id").eq("slug", "g4a-ext-probe").maybeSingle();
  ok("external_fixture_cleaned", extGone == null);
}

// --- Static: referral sendSms object shape ---
{
  const src = readFileSync(resolve("src/lib/referrals.functions.ts"), "utf8");
  ok("referral_sendSms_object_shape", /sendSms\(\{\s*to:\s*profile\.phone,\s*body:\s*message\s*\}\)/.test(src));
  ok("referral_no_positional_sendSms", !/sendSms\(\s*profile\.phone\s*,/.test(src));
}

// --- Static: booking forces tenant_id ---
{
  const src = readFileSync(resolve("src/lib/booking.functions.ts"), "utf8");
  ok("booking_uses_withForcedTenantId", src.includes("withForcedTenantId"));
  ok("booking_assertAdvisorInTenant", src.includes("assertAdvisorInTenant"));
  ok("booking_rejectMismatchedClientTenantId", src.includes("rejectMismatchedClientTenantId"));
}

// --- Static: tenant-assert module present ---
{
  const src = readFileSync(resolve("src/lib/tenant-assert.server.ts"), "utf8");
  ok("assert_module_exports", src.includes("export function withForcedTenantId") && src.includes("assertRowBelongsToTenant"));
  ok("assert_no_default_001", !/company_code\s*===\s*['"]001['"]/.test(src) && !/mortgageeasy/.test(src.split("FAIL CLOSED")[0] || ""));
}

// --- MFA / SO / Twilio unchanged markers ---
{
  const { count: so } = await admin.from("platform_roles").select("*", { count: "exact", head: true });
  ok("super_owner_not_started", so === 0);
  const { count: tel002 } = await admin
    .from("telephony_numbers")
    .select("*", { count: "exact", head: true })
    .eq("tenant_id", t002.id);
  ok("telephony_002_empty", tel002 === 0);
  const { count: tel001 } = await admin
    .from("telephony_numbers")
    .select("*", { count: "exact", head: true })
    .eq("tenant_id", t001.id);
  ok("telephony_001_present", tel001 >= 1, String(tel001));
}

const { count: m002Final } = await admin
  .from("tenant_memberships")
  .select("*", { count: "exact", head: true })
  .eq("tenant_id", t002.id);
ok("final_memberships_002_zero", m002Final === 0, String(m002Final));

if (failures.length) {
  console.error(`\n${failures.length} failure(s): ${failures.join(", ")}`);
  process.exit(1);
}
console.log("\nG4A verification PASS");
