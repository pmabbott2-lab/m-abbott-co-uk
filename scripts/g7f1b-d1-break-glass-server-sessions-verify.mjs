import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];
function ok(n, c, d=""){ if(c) console.log(`PASS  ${n}${d?` — ${d}`:""}`); else { console.error(`FAIL  ${n}`); failures.push(n);} }
function read(r){ return readFileSync(resolve(root,r),"utf8"); }
const MIG = "supabase/migrations/20260925091946_gate_g7f1b_d1_break_glass_server_sessions.sql";
ok("migration_exists", existsSync(resolve(root,MIG)));
const mig = read(MIG);
ok("table", mig.includes("platform_break_glass_sessions"));
ok("unique_open", mig.includes("platform_break_glass_sessions_one_open_per_user"));
ok("rpc_ensure", mig.includes("ensure_break_glass_platform_session"));
ok("rpc_touch", mig.includes("touch_break_glass_platform_session"));
ok("rpc_end", mig.includes("end_break_glass_platform_session"));
ok("revoke", mig.includes("FROM PUBLIC, anon, authenticated"));
ok("grant_service", mig.includes("TO service_role"));
ok("session_id_required", mig.includes("auth_session_id_required"));
ok("same_auth_locked", mig.includes("same_auth_session_locked"));
ok("no_iat_reopen", !/p_auth_iat.*>.*auth_iat|iat.*>.*previous/i.test(mig.split("same_auth_session_locked")[1]?.slice(0,400)||""));
ok("audit_in_rpc", mig.includes("BREAK_GLASS_LOGIN_SUCCEEDED") && mig.includes("BREAK_GLASS_PLATFORM_ACCESS"));
const server = read("src/lib/break-glass.server.ts");
ok("app_uses_ensure_rpc", server.includes('ensure_break_glass_platform_session'));
ok("app_uses_end_rpc", server.includes('end_break_glass_platform_session'));
ok("app_reads_session_id", server.includes("session_id") || server.includes("sessionId"));
ok("logout_ends_first", server.indexOf("endBreakGlassPlatformSession") < server.indexOf("BREAK_GLASS_LOGOUT"));
const entry = read("src/lib/platform-tenant-entry.server.ts");
ok("g7d_binds_platform", entry.includes("isBreakGlassPlatformSessionActive"));
ok("sql_harness", existsSync(resolve(root,"scripts/g7f1b-d1-break-glass-server-sessions-verify.sql")));
if(failures.length){ console.error("D1 static FAIL", failures.join(",")); process.exit(1);} 
console.log("\nG7F-1B-D1 static verify PASS");
