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
  advisorName?: string;
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
  const advisor = opts.advisorName?.trim();
  const lines = [
    advisor
      ? `Hi ${opts.customerName}, your mortgage appointment is confirmed — you will meet ${advisor} on ${when}.`
      : `Hi ${opts.customerName}, your mortgage appointment is confirmed for ${when}.`,
    "Reply HELP for assistance.",
  ];
  if (opts.bookingUrl) lines.splice(1, 0, opts.bookingUrl);
  return lines.join("\n");
}

/** The three call-back windows, with their human wording for the SMS. */
export const CALLBACK_WINDOWS = {
  "9-12": "9am and 12pm",
  "12-4": "12pm and 4pm",
  "4-8": "4pm and 8pm",
} as const;

export type CallbackWindow = keyof typeof CALLBACK_WINDOWS;

export function callbackWindowLabel(window: string): string {
  return CALLBACK_WINDOWS[window as CallbackWindow] ?? window;
}

export function callbackConfirmationMessage(opts: {
  customerName: string;
  window: string;
  advisorName?: string;
}): string {
  const advisor = opts.advisorName?.trim() || "your advisor";
  return [
    `Hi ${opts.customerName}, thanks for completing your mortgage fact-find.`,
    `${advisor} will give you a call between ${callbackWindowLabel(opts.window)}.`,
    "Reply HELP for assistance.",
  ].join("\n");
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

// Best-effort SMS confirming the fact-find is complete, with a direct link to
// the summary page. Never throws into the caller's happy path: skips silently if
// Twilio is unconfigured or the customer has no phone, and logs on failure.
// Shared by both completion paths (natural completion in the interview-step API
// and the explicit submitSession) so the text fires whichever way the customer
// finishes.
export async function sendInterviewCompleteSms(customerId: string, sessionId: string): Promise<void> {
  try {
    if (!isTwilioConfigured()) return;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("full_name, phone")
      .eq("id", customerId)
      .maybeSingle();
    const phone = (profile as { phone?: string | null } | null)?.phone?.trim();
    if (!phone) return;

    const firstName = profile?.full_name?.trim().split(/\s+/)[0] || "there";
    const summaryUrl = `${getAppBaseUrl()}/sessions/${sessionId}`;
    const body = interviewCompleteMessage({ name: firstName, summaryUrl });

    const { sid } = await sendSms({ to: phone, body });
    try {
      await supabaseAdmin.from("sms_messages").insert({
        direction: "outbound",
        from_number: process.env.TWILIO_PHONE_NUMBER!,
        to_number: phone,
        body,
        twilio_sid: sid,
      });
    } catch (e) {
      console.error("log interview-complete sms failed", e);
    }
  } catch (e) {
    console.error("interview completion SMS failed:", e);
  }
}
