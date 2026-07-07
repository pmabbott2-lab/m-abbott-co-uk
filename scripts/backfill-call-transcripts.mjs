#!/usr/bin/env node
/**
 * Re-process outbound calls stuck without transcript/summary.
 * Usage: node scripts/backfill-call-transcripts.mjs [limit=20]
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

function loadEnv() {
  const envPath = resolve(process.cwd(), ".env");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq);
    let val = trimmed.slice(eq + 1);
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

loadEnv();

const url = process.env.VITE_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const appBaseUrl = (process.env.APP_BASE_URL ?? "").replace(/\/$/, "");

if (!url || !serviceKey || !accountSid || !authToken || !appBaseUrl) {
  console.error("Missing env (Supabase, Twilio, or APP_BASE_URL)");
  process.exit(1);
}

const limit = Number(process.argv[2] ?? 20);
const auth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");

const listRes = await fetch(
  `${url}/rest/v1/phone_calls?or=(ai_status.eq.pending,ai_status.eq.failed,ai_status.eq.processing)&direction=eq.outbound&order=started_at.desc&limit=${limit}&select=id,twilio_call_sid,ai_status`,
  { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } },
);
const rows = await listRes.json();
if (!Array.isArray(rows)) {
  console.error("Query failed", rows);
  process.exit(1);
}

let ok = 0;
for (const row of rows) {
  if (!row.twilio_call_sid) {
    console.log(`Skip ${row.id} — no Twilio CallSid`);
    continue;
  }

  const recRes = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Calls/${row.twilio_call_sid}/Recordings.json`,
    { headers: { Authorization: `Basic ${auth}` } },
  );
  const recJson = await recRes.json();
  const recording = (recJson.recordings ?? []).find((r) => r.status === "completed") ?? recJson.recordings?.[0];
  if (!recording?.sid) {
    console.log(`Skip ${row.id} — no Twilio recording`);
    continue;
  }

  const recordingUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Recordings/${recording.sid}`;
  console.log(`Processing ${row.id} (${row.ai_status})…`);

  const hookRes = await fetch(
    `${appBaseUrl}/api/twilio/voice/recording?callId=${encodeURIComponent(row.id)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        RecordingSid: recording.sid,
        RecordingUrl: recordingUrl,
        CallSid: row.twilio_call_sid,
        From: "client:backfill",
        RecordingStatus: "completed",
      }),
    },
  );
  if (!hookRes.ok) {
    console.error(`  ✗ webhook ${hookRes.status}`);
    continue;
  }
  console.log("  ✓ queued");
  ok++;
}

console.log(`Finished — reprocessed ${ok} of ${rows.length} call(s).`);
