/**
 * Gate G6B — staging transactional reset. Refuses production.
 * Preserves schema, tenant configuration, and (when present) synthetic identities.
 *
 * Run (staging project only):
 *   APP_ENV=staging SUPABASE_URL=https://<staging>.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=... node scripts/g6b-staging-reset.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { assertStagingTargetAllowed, ProductionGuardError } from "./g6b-production-guard.mjs";

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

/** Transactional tables only. Never drop tenants / memberships / features / branding. */
const TRANSACTIONAL = [
  "staff_contact_tasks",
  "callbacks",
  "appointments",
  "cases",
  "commission_payouts",
  "referrals",
  "sms_messages",
  "phone_calls",
];

const { data: tenants, error: tErr } = await admin.from("tenants").select("id, company_code");
if (tErr) throw tErr;
const codes = new Set((tenants ?? []).map((t) => t.company_code));
if (!codes.has("001") || !codes.has("002")) {
  console.error("REFUSED: unexpected tenant set — aborting reset.");
  process.exit(1);
}

let skipped = [];
for (const table of TRANSACTIONAL) {
  const { error } = await admin.from(table).delete().neq("id", "00000000-0000-0000-0000-000000000000");
  if (error) {
    skipped.push(`${table}:${error.message}`);
    console.log(`SKIP  ${table} — ${error.message}`);
  } else {
    console.log(`CLEARED  ${table}`);
  }
}

const { count: platformRoles } = await admin.from("platform_roles").select("*", { count: "exact", head: true });
if (platformRoles !== 0) {
  console.error("FAIL  platform_roles is not 0 after reset — G7 must not start from this script.");
  process.exit(1);
}

console.log("\nG6B staging reset complete (tenant config preserved).");
if (skipped.length) console.log("Skipped tables:", skipped.join("; "));
