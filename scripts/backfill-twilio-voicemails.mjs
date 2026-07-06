#!/usr/bin/env node
/**
 * Backfill inbound voicemails from Twilio that were missed (e.g. bad webhook URL).
 * Usage: node scripts/backfill-twilio-voicemails.mjs [hoursAgo=6]
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

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const appBaseUrl = (process.env.APP_BASE_URL ?? "").replace(/\/$/, "");
const voiceNumber =
  process.env.TWILIO_VOICE_PHONE_NUMBER?.trim() || process.env.TWILIO_PHONE_NUMBER?.trim();

if (!accountSid || !authToken || !appBaseUrl) {
  console.error("Missing TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, or APP_BASE_URL in .env");
  process.exit(1);
}

const hoursAgo = Number(process.argv[2] ?? 6);
const since = new Date(Date.now() - hoursAgo * 60 * 60 * 1000);
const auth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");

async function twilioGet(path) {
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}${path}`, {
    headers: { Authorization: `Basic ${auth}` },
  });
  if (!res.ok) throw new Error(`GET ${path} failed (${res.status})`);
  return res.json();
}

const calls = await twilioGet(
  `/Calls.json?To=${encodeURIComponent(voiceNumber ?? "")}&PageSize=50`,
);

let processed = 0;
for (const call of calls.calls ?? []) {
  if (call.direction !== "inbound") continue;
  const started = new Date(call.start_time);
  if (started < since) continue;

  const recs = await twilioGet(`/Calls/${call.sid}/Recordings.json`);
  const recording = (recs.recordings ?? []).find((r) => r.status === "completed") ?? recs.recordings?.[0];
  const recordingUrl = recording?.uri
    ? `https://api.twilio.com${recording.uri.replace(/\.json$/, "")}`
    : "";

  console.log(`Backfill ${call.sid} from ${call.from} (${call.start_time})`);

  const res = await fetch(`${appBaseUrl}/api/twilio/voice/voicemail-done`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      CallSid: call.sid,
      From: call.from,
      RecordingUrl: recordingUrl,
      RecordingSid: recording?.sid ?? "",
    }),
  });
  if (!res.ok) {
    console.error(`  webhook failed (${res.status})`);
    continue;
  }
  processed++;
}

console.log(`Done — processed ${processed} inbound call(s).`);
