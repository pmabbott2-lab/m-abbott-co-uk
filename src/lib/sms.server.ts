// Server-only Twilio SMS helpers. Credentials stay in environment variables.

export function getTwilioConfig() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_PHONE_NUMBER;
  if (!accountSid || !authToken || !fromNumber) {
    throw new Error("Twilio is not configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER.");
  }
  return { accountSid, authToken, fromNumber };
}

export function isTwilioConfigured(): boolean {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_PHONE_NUMBER,
  );
}

export function normaliseUkPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("44")) return `+${digits}`;
  if (digits.startsWith("0")) return `+44${digits.slice(1)}`;
  if (digits.length === 10) return `+44${digits}`;
  return phone.startsWith("+") ? phone : `+${digits}`;
}

export async function sendSms(opts: {
  to: string;
  body: string;
}): Promise<{ sid: string }> {
  const { accountSid, authToken, fromNumber } = getTwilioConfig();
  const to = normaliseUkPhone(opts.to);
  const auth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");

  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      To: to,
      From: fromNumber,
      Body: opts.body,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Twilio SMS failed (${res.status}): ${text}`);
  }

  const json = (await res.json()) as { sid: string };
  return { sid: json.sid };
}

export function getAppBaseUrl(): string {
  return process.env.APP_BASE_URL ?? "http://localhost:5173";
}

export function bookingConfirmationMessage(opts: {
  customerName: string;
  startsAt: Date;
  bookingUrl?: string;
}): string {
  const when = opts.startsAt.toLocaleString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/London",
  });
  const lines = [
    `Hi ${opts.customerName}, your mortgage appointment is confirmed for ${when}.`,
    "Reply HELP for assistance.",
  ];
  if (opts.bookingUrl) lines.splice(1, 0, opts.bookingUrl);
  return lines.join("\n");
}

export function interviewCompleteMessage(opts: {
  name: string;
  summaryUrl: string;
}): string {
  return [
    `Hi ${opts.name}, thanks for completing your mortgage fact-find.`,
    `View your summary here: ${opts.summaryUrl}`,
    "Reply HELP for assistance.",
  ].join("\n");
}

export function textChannelInviteMessage(opts: {
  customerName: string;
  bookUrl: string;
  introducerName: string;
}): string {
  return `Hi ${opts.customerName}, ${opts.introducerName} has referred you for a mortgage appointment. Book a time here: ${opts.bookUrl}`;
}
