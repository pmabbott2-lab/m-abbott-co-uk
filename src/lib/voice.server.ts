// Server-only Twilio Voice helpers (browser softphone + inbound voicemail).

import twilio from "twilio";
import { getTwilioConfig, getTwilioVoiceNumber, isTwilioVoiceNumberConfigured, normaliseUkPhone } from "@/lib/sms.server";
import { isTwilioClientVoiceConfigured } from "@/lib/voice-token.server";

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
  const statusCb = escapeXml(opts.statusCallback);

  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial callerId="${callerId}" record="record-from-answer-dual" recordingStatusCallback="${recordCb}" recordingStatusCallbackMethod="POST" action="${statusCb}" method="POST">
    <Number>${customer}</Number>
  </Dial>
</Response>`;
}

export function inboundVoicemailTwiml(opts: {
  recordingCallback: string;
  voicemailDoneUrl: string;
}): string {
  const recordCb = escapeXml(opts.recordingCallback);
  const doneUrl = escapeXml(opts.voicemailDoneUrl);
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Amy">Thank you for calling M Abbott mortgage services. Please leave a message after the tone and your advisor will call you back.</Say>
  <Record maxLength="180" playBeep="true" recordingStatusCallback="${recordCb}" recordingStatusCallbackMethod="POST" action="${doneUrl}" method="POST" />
</Response>`;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
