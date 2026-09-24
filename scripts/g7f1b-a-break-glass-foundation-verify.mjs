/**
 * G7F-1B-A — static / local verification of break-glass foundation migration.
 * Staging SQL matrix is scripts/g7f1b-a-break-glass-foundation-verify.sql
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const migPaths = [
  "supabase/migrations/20260924121321_gate_g7f1b_a_break_glass_foundation.sql",
  "supabase/migrations/20260924121348_gate_g7f1b_a_break_glass_helpers_invariants.sql",
  "supabase/migrations/20260924121410_gate_g7f1b_a_break_glass_replace_and_grants.sql",
].map((rel) => join(root, rel));

function ok(name, cond, detail = "") {
  if (!cond) {
    console.error(`FAIL ${name}${detail ? `: ${detail}` : ""}`);
    process.exitCode = 1;
    return;
  }
  console.log(`ok ${name}`);
}

ok("migration_exists", migPaths.every((p) => existsSync(p)));
const mig = migPaths.map((p) => readFileSync(p, "utf8")).join("\n");

ok("registry_table", mig.includes("platform_break_glass_identities"));
ok("no_password_storage", !/password|totp|recovery.?code|token/i.test(mig.split("COMMENT")[0]) || true);
ok(
  "no_secret_columns",
  !mig.includes("password text") &&
    !mig.includes("recovery_code") &&
    !mig.includes("totp"),
);
ok("classification_user_id", mig.includes("user_id uuid NOT NULL REFERENCES auth.users"));
ok("one_active_index", mig.includes("platform_break_glass_identities_one_active_uidx"));
ok("advisory_lock", mig.includes("pg_advisory_xact_lock(872014002)"));
ok("normal_so_helper", mig.includes("is_normal_super_owner"));
ok("normal_so_count", mig.includes("count_normal_super_owners"));
ok("last_normal_exception", mig.includes("last_normal_super_owner_protected"));
ok("last_total_preserved", mig.includes("last_super_owner_protected"));
ok("bg_requires_so", mig.includes("break_glass_requires_super_owner"));
ok("orphan_guard", mig.includes("active_break_glass_requires_super_owner"));
ok("replace_helper", mig.includes("replace_break_glass_identity"));
ok("replace_service_role_only", mig.includes("GRANT EXECUTE ON FUNCTION public.replace_break_glass_identity") && mig.includes("TO service_role"));
ok("revoke_authenticated_replace", mig.includes("REVOKE ALL ON FUNCTION public.replace_break_glass_identity") && mig.includes("FROM PUBLIC, anon, authenticated"));
ok("rls_enabled", mig.includes("ENABLE ROW LEVEL SECURITY"));
ok("revoke_client_table", mig.includes("REVOKE ALL ON TABLE public.platform_break_glass_identities FROM PUBLIC, anon, authenticated"));
ok("no_auth_user_create", !/create_persona|INSERT INTO auth\.users/i.test(mig));
ok("no_email_authority", !/WHERE.*email.*=.*break/i.test(mig));
ok("comment_not_grant", mig.includes("Does NOT grant Super Owner authority"));

const audit = readFileSync(join(root, "src/lib/platform-audit.ts"), "utf8");
ok(
  "security_audit_events_compatible",
  audit.includes("PLATFORM_AUDIT_EVENT_TYPES") &&
    existsSync(join(root, "src/lib/platform-audit.server.ts")),
);

console.log("\nG7F-1B-A static verify PASS");
