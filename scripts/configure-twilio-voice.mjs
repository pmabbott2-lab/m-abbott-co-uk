#!/usr/bin/env node
/**
 * Configure Twilio for Mortgage Hub browser softphone + inbound voicemail.
 * - Landline → inbound voicemail webhook
 * - TwiML App → browser outbound client-outbound webhook
 * - Creates API Key if missing (prints SID/secret for .env)
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
const phoneNumber = process.env.TWILIO_VOICE_PHONE_NUMBER?.trim() || process.env.TWILIO_PHONE_NUMBER;
const appBaseUrl = (process.env.APP_BASE_URL ?? "").replace(/\/$/, "");

if (!accountSid || !authToken || !phoneNumber || !appBaseUrl) {
  console.error(
    "Missing env. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, APP_BASE_URL, and TWILIO_VOICE_PHONE_NUMBER (or TWILIO_PHONE_NUMBER) in .env",
  );
  process.exit(1);
}

const auth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
const inboundUrl = `${appBaseUrl}/api/twilio/voice/inbound`;
const clientOutboundUrl = `${appBaseUrl}/api/twilio/voice/client-outbound`;

async function twilioPost(path, body) {
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${path} failed (${res.status}): ${text}`);
  }
  return res.json();
}

async function twilioGet(path) {
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}${path}`, {
    headers: { Authorization: `Basic ${auth}` },
  });
  if (!res.ok) throw new Error(`GET ${path} failed (${res.status})`);
  return res.json();
}

// ── TwiML App for browser outbound ───────────────────────────────────────────
let twimlAppSid = process.env.TWILIO_TWIML_APP_SID?.trim() ?? "";
const apps = await twilioGet("/Applications.json?PageSize=50");
const existingApp = (apps.applications ?? []).find(
  (a) => a.friendly_name === "Mortgage Hub Browser" || a.voice_url === clientOutboundUrl,
);
if (existingApp) {
  twimlAppSid = existingApp.sid;
  await twilioPost(`/Applications/${twimlAppSid}.json`, {
    FriendlyName: "Mortgage Hub Browser",
    VoiceUrl: clientOutboundUrl,
    VoiceMethod: "POST",
    StatusCallback: `${appBaseUrl}/api/twilio/voice/status`,
    StatusCallbackMethod: "POST",
  });
} else {
  const created = await twilioPost("/Applications.json", {
    FriendlyName: "Mortgage Hub Browser",
    VoiceUrl: clientOutboundUrl,
    VoiceMethod: "POST",
    StatusCallback: `${appBaseUrl}/api/twilio/voice/status`,
    StatusCallbackMethod: "POST",
  });
  twimlAppSid = created.sid;
}
console.log(`TwiML App: ${twimlAppSid}`);
console.log(`  Voice URL: ${clientOutboundUrl}`);
console.log(`  Add to .env: TWILIO_TWIML_APP_SID=${twimlAppSid}`);

// ── API Key for access tokens ────────────────────────────────────────────────
if (!process.env.TWILIO_API_KEY_SID?.trim() || !process.env.TWILIO_API_KEY_SECRET?.trim()) {
  const key = await twilioPost("/Keys.json", { FriendlyName: "Mortgage Hub Browser Voice" });
  console.log("Created API Key — add to .env (secret shown once):");
  console.log(`  TWILIO_API_KEY_SID=${key.sid}`);
  console.log(`  TWILIO_API_KEY_SECRET=${key.secret}`);
} else {
  console.log(`API Key: ${process.env.TWILIO_API_KEY_SID} (already in .env)`);
}

// ── Landline inbound voicemail ─────────────────────────────────────────────────
const list = await twilioGet(
  `/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(phoneNumber)}`,
);
const match = (list.incoming_phone_numbers ?? []).find(
  (n) => n.phone_number === phoneNumber || n.phone_number?.replace(/\s/g, "") === phoneNumber.replace(/\s/g, ""),
);
if (!match?.sid) {
  console.error(`Phone number ${phoneNumber} not found in this Twilio account.`);
  process.exit(1);
}

await twilioPost(`/IncomingPhoneNumbers/${match.sid}.json`, {
  VoiceUrl: inboundUrl,
  VoiceMethod: "POST",
  StatusCallback: `${appBaseUrl}/api/twilio/voice/status`,
  StatusCallbackMethod: "POST",
});

console.log(`Landline ${phoneNumber}`);
console.log(`  Inbound URL: ${inboundUrl}`);
