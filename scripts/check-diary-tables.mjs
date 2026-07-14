#!/usr/bin/env node
/**
 * Checks diary-related Supabase tables without printing secrets.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function loadDotEnv(path) {
  const vars = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    vars[key] = value;
  }
  return vars;
}

const env = loadDotEnv(resolve(process.cwd(), ".env"));
const url = (env.SUPABASE_URL || "").replace(/\/$/, "");
const key = env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.log("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

async function headCount(path) {
  const res = await fetch(`${url}${path}`, {
    method: "HEAD",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Prefer: "count=exact",
    },
  });
  const range = res.headers.get("content-range");
  return { status: res.status, count: range ? range.split("/")[1] : "?" };
}

async function getJson(path) {
  const res = await fetch(`${url}${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  const text = await res.text();
  return { status: res.status, ok: res.ok, text, json: res.ok ? JSON.parse(text) : null };
}

console.log("Diary table check");
console.log("=================");

const tableChecks = [
  ["/rest/v1/appointments?select=id", "appointments"],
  ["/rest/v1/advisor_availability?select=advisor_id", "advisor_availability"],
  ["/rest/v1/advisor_profiles?select=user_id", "advisor_profiles"],
  ["/rest/v1/introducers?select=id", "introducers"],
];

for (const [path, name] of tableChecks) {
  const r = await headCount(path);
  console.log(`${name}: ${r.status === 200 ? `OK (${r.count} rows)` : `FAIL ${r.status}`}`);
}

const appts = await getJson(
  "/rest/v1/appointments?select=id,customer_name,starts_at,status,advisor_id,ms_join_url&order=starts_at.asc&limit=10",
);
if (appts.ok) {
  const now = Date.now();
  const upcoming = appts.json.filter((a) => new Date(a.starts_at).getTime() >= now && a.status === "confirmed");
  const withTeams = appts.json.filter((a) => a.ms_join_url);
  console.log(`upcoming confirmed appointments: ${upcoming.length}`);
  console.log(`appointments with Teams join URL: ${withTeams.length}`);
  for (const a of upcoming.slice(0, 5)) {
    console.log(`  - ${a.customer_name} @ ${a.starts_at}${a.ms_join_url ? " (Teams)" : ""}`);
  }
} else {
  console.log(`appointments detail: FAIL ${appts.status} ${appts.text.slice(0, 120)}`);
}

const avail = await getJson(
  "/rest/v1/advisor_availability?select=advisor_id,day_of_week,start_time,end_time,active&limit=20",
);
if (avail.ok) {
  const active = avail.json.filter((r) => r.active);
  const advisors = [...new Set(active.map((r) => r.advisor_id))];
  console.log(`active availability rows: ${active.length} across ${advisors.length} advisor(s)`);
} else {
  console.log(`availability detail: FAIL ${avail.status}`);
}

const profiles = await getJson(
  "/rest/v1/advisor_profiles?select=user_id,teams_calendar_enabled,ms_account_email,teams_calendar_linked_at&limit=20",
);
if (profiles.ok) {
  const linked = profiles.json.filter((p) => p.teams_calendar_enabled);
  console.log(`Teams-linked advisor profiles: ${linked.length}/${profiles.json.length}`);
  for (const p of linked) {
    console.log(`  - ${p.ms_account_email ?? p.user_id} (linked ${p.teams_calendar_linked_at ?? "?"})`);
  }
} else {
  console.log(`teams profiles: FAIL ${profiles.status} ${profiles.text.slice(0, 120)}`);
}

const advisors = await getJson("/rest/v1/user_roles?select=user_id,role&role=eq.advisor");
if (advisors.ok) {
  console.log(`advisor role assignments: ${advisors.json.length}`);
}

const allAppts = await getJson(
  "/rest/v1/appointments?select=customer_name,starts_at,status&order=starts_at.desc&limit=10",
);
if (allAppts.ok) {
  console.log("recent appointments:");
  for (const a of allAppts.json) {
    console.log(`  - ${a.status} ${a.customer_name} @ ${a.starts_at}`);
  }
}

const teamsConfigured = Boolean(
  env.TEAMS_CLIENT_ID?.trim() && env.TEAMS_CLIENT_SECRET?.trim() && env.TEAMS_TENANT_ID?.trim(),
);
console.log(`Teams env configured: ${teamsConfigured ? "yes" : "no"}`);
console.log(`APP_BASE_URL: ${env.APP_BASE_URL || env.VITE_APP_URL || "(missing)"}`);
