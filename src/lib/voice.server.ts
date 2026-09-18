// Server-only Twilio Voice helpers (browser softphone + inbound voicemail).

import { createHmac, timingSafeEqual } from "node:crypto";
import twilio from "twilio";
import { getTwilioConfig, getTwilioVoiceNumber, isTwilioVoiceNumberConfigured, normaliseUkPhone } from "@/lib/sms.server";
import { isTwilioClientVoiceConfigured } from "@/lib/voice-token.server";
import { isTwilioLiveDeliveryAllowed } from "@/lib/app-environment.server";

export type VoiceBrandId = "mortgage_easy" | "trent_valley";

export type VoicemailGreetingKey =
  | "default"
  | "out_of_hours"
  | "in_appointment"
  | "no_answer"
  | "unowned_caller"
  | "advisor_unavailable";

const BRAND_LABEL: Record<VoiceBrandId, string> = {
  mortgage_easy: "MortgageEasy",
  trent_valley: "Trent Valley Financial Services",
};

function brandScripts(brand: VoiceBrandId): Record<VoicemailGreetingKey, string> {
  const name = BRAND_LABEL[brand];
  return {
    default: `Thank you for calling ${name}. Please leave a message after the tone, and an adviser will call you back.`,
    out_of_hours: `Thank you for calling ${name}. Our office is currently closed. Please leave a message after the tone, and an adviser will return your call when we reopen.`,
    in_appointment: `Thank you for calling ${name}. Your adviser is with a client at the moment. Please leave a message after the tone, and they will call you back as soon as they are free.`,
    no_answer: `Thank you for calling ${name}. We are unable to take your call just now. Please leave a message after the tone, and an adviser will call you back shortly.`,
    unowned_caller: `Thank you for calling ${name}. Please leave your name, number, and a short message after the tone, and a member of the team will call you back.`,
    advisor_unavailable: `Thank you for calling ${name}. Your adviser is unavailable right now. Please leave a message after the tone, and we will get back to you as soon as possible.`,
  };
}

export function isTwilioVoiceConfigured(): boolean {
  if (!isTwilioVoiceNumberConfigured()) return false;
  if (!isTwilioClientVoiceConfigured()) return false;
  return Boolean(process.env.APP_BASE_URL?.trim());
}

export function getVoiceConfig() {
  const base = getTwilioConfig();
  const voiceNumber = getTwilioVoiceNumber();
  if (!voiceNumber) {
    throw new Error("Voice number not configured. Set TWILIO_VOICE_PHONE_NUMBER or TWILIO_PHONE_NUMBER.");
  }
  const appBaseUrl = (process.env.APP_BASE_URL ?? "").replace(/\/$/, "");
  if (!appBaseUrl) throw new Error("APP_BASE_URL is required for voice calls.");
  return { ...base, fromNumber: voiceNumber, appBaseUrl };
}

export function twilioClient() {
  if (!isTwilioLiveDeliveryAllowed()) {
    throw new Error("Twilio voice is disabled or capture-only in this environment.");
  }
  const { accountSid, authToken } = getVoiceConfig();
  return twilio(accountSid, authToken);
}

export function voiceWebhookUrl(path: string): string {
  const { appBaseUrl } = getVoiceConfig();
  return `${appBaseUrl}${path}`;
}

/** TwiML for browser softphone outbound — dials the customer with office caller ID. */
export function clientDialCustomerTwiml(opts: {
  customerPhone: string;
  callId: string;
  callerId: string;
  recordCallback: string;
  statusCallback: string;
}): string {
  const customer = escapeXml(normaliseUkPhone(opts.customerPhone));
  const callerId = escapeXml(opts.callerId);
  const recordCb = escapeXml(`${opts.recordCallback}?callId=${encodeURIComponent(opts.callId)}`);
  const statusCb = escapeXml(`${opts.statusCallback}?callId=${encodeURIComponent(opts.callId)}`);

  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial callerId="${callerId}" record="record-from-answer-dual" recordingStatusCallback="${recordCb}" recordingStatusCallbackMethod="POST" action="${statusCb}" method="POST">
    <Number>${customer}</Number>
  </Dial>
</Response>`;
}

export function parseVoiceBrand(raw: string | null | undefined): VoiceBrandId {
  return raw === "trent_valley" ? "trent_valley" : "mortgage_easy";
}

export function resolveVoicemailGreetingKey(reason?: string | null): VoicemailGreetingKey {
  const r = (reason ?? "").toLowerCase();
  if (r.includes("out_of_hours")) return "out_of_hours";
  if (r.includes("in_appointment")) return "in_appointment";
  if (r.includes("no_answer") || r.includes("fallback")) return "no_answer";
  if (r.includes("unowned")) return "unowned_caller";
  if (
    r.includes("disabled") ||
    r.includes("no_ring") ||
    r.includes("no_personal") ||
    r.includes("unavailable")
  ) {
    return "advisor_unavailable";
  }
  return "default";
}

export function voicemailGreetingText(
  brand: VoiceBrandId,
  key: VoicemailGreetingKey,
): string {
  return brandScripts(brand)[key];
}

function susanPromptSecret(): string {
  return (
    process.env.TWILIO_AUTH_TOKEN?.trim() ||
    process.env.AZURE_SPEECH_KEY?.trim() ||
    "mortgage-hub-susan-prompt"
  );
}

export function signSusanPrompt(brand: VoiceBrandId, key: VoicemailGreetingKey): string {
  return createHmac("sha256", susanPromptSecret())
    .update(`${brand}|${key}`)
    .digest("hex")
    .slice(0, 24);
}

export function verifySusanPromptSig(
  brand: VoiceBrandId,
  key: VoicemailGreetingKey,
  sig: string | null | undefined,
): boolean {
  if (!sig) return false;
  const expected = signSusanPrompt(brand, key);
  try {
    const a = Buffer.from(expected);
    const b = Buffer.from(sig);
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/** Public Play URL — Twilio fetches Susan (Azure Sonia) audio for the greeting. */
export function susanVoicemailPlayUrl(brand: VoiceBrandId, key: VoicemailGreetingKey): string {
  const sig = signSusanPrompt(brand, key);
  const qs = new URLSearchParams({ brand, key, sig });
  return voiceWebhookUrl(`/api/twilio/voice/susan-prompt?${qs.toString()}`);
}

/**
 * Voicemail TwiML using Susan's Azure Sonia voice via &lt;Play&gt;.
 * Falls back to Polly.Amy only if a Play URL cannot be built.
 */
export function inboundVoicemailTwiml(opts: {
  recordingCallback: string;
  voicemailDoneUrl: string;
  brand?: VoiceBrandId;
  greetingKey?: VoicemailGreetingKey;
}): string {
  const recordCb = escapeXml(opts.recordingCallback);
  const doneUrl = escapeXml(opts.voicemailDoneUrl);
  const brand = opts.brand ?? "mortgage_easy";
  const key = opts.greetingKey ?? "default";
  const text = voicemailGreetingText(brand, key);

  try {
    const playUrl = escapeXml(susanVoicemailPlayUrl(brand, key));
    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Play>${playUrl}</Play>
  <Record maxLength="180" playBeep="true" recordingStatusCallback="${recordCb}" recordingStatusCallbackMethod="POST" action="${doneUrl}" method="POST" />
</Response>`;
  } catch {
    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Amy">${escapeXml(text)}</Say>
  <Record maxLength="180" playBeep="true" recordingStatusCallback="${recordCb}" recordingStatusCallbackMethod="POST" action="${doneUrl}" method="POST" />
</Response>`;
  }
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
