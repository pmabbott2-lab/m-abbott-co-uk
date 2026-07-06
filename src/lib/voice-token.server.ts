// Server-only Twilio Voice access tokens for browser softphone (Client SDK).

import twilio from "twilio";

export function isTwilioClientVoiceConfigured(): boolean {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID &&
      process.env.TWILIO_API_KEY_SID?.trim() &&
      process.env.TWILIO_API_KEY_SECRET?.trim() &&
      process.env.TWILIO_TWIML_APP_SID?.trim() &&
      process.env.APP_BASE_URL?.trim(),
  );
}

export function createVoiceAccessToken(identity: string): string {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const apiKeySid = process.env.TWILIO_API_KEY_SID?.trim();
  const apiKeySecret = process.env.TWILIO_API_KEY_SECRET?.trim();
  const twimlAppSid = process.env.TWILIO_TWIML_APP_SID?.trim();

  if (!accountSid || !apiKeySid || !apiKeySecret || !twimlAppSid) {
    throw new Error(
      "Browser calling is not configured. Set TWILIO_API_KEY_SID, TWILIO_API_KEY_SECRET, and TWILIO_TWIML_APP_SID.",
    );
  }

  const { AccessToken } = twilio.jwt;
  const { VoiceGrant } = AccessToken;

  const token = new AccessToken(accountSid, apiKeySid, apiKeySecret, {
    identity,
    ttl: 3600,
  });

  const grant = new VoiceGrant({
    outgoingApplicationSid: twimlAppSid,
    incomingAllow: true,
  });
  token.addGrant(grant);

  return token.toJwt();
}
