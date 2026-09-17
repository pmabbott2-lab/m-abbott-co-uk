// Server-only Twilio SMS helpers. Credentials stay in environment variables.

/** Branded alphanumeric sender shown to recipients (UK networks that support it). */
export const SMS_SENDER_LABEL = "MortgageHub";

export function getTwilioCredentials() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) {
    throw new Error("Twilio is not configured. Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN.");
  }
  return { accountSid, authToken };
}

export function getTwilioMessagingServiceSid(): string {
  const sid = process.env.TWILIO_MESSAGING_SERVICE_SID?.trim();
  if (!sid) {
    throw new Error("Twilio SMS is not configured. Set TWILIO_MESSAGING_SERVICE_SID.");
  }
  return sid;
}

/** Voice / landline caller ID — not used for outbound SMS. */
export function getTwilioVoiceNumber(): string {
  return process.env.TWILIO_VOICE_PHONE_NUMBER?.trim() || process.env.TWILIO_PHONE_NUMBER?.trim() || "";
}

/** Twilio credentials + voice number (recording download, click-to-call). */
export function getTwilioConfig() {
  const credentials = getTwilioCredentials();
  const fromNumber = getTwilioVoiceNumber();
  if (!fromNumber) {
    throw new Error("Voice number not configured. Set TWILIO_VOICE_PHONE_NUMBER or TWILIO_PHONE_NUMBER.");
  }
  return { ...credentials, fromNumber };
}

export function getSmsSenderLabel(): string {
  return process.env.TWILIO_SMS_SENDER_LABEL?.trim() || SMS_SENDER_LABEL;
}

export function isTwilioConfigured(): boolean {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID &&
      process.env.TWILIO_AUTH_TOKEN &&
      process.env.TWILIO_MESSAGING_SERVICE_SID?.trim(),
  );
}

export function isTwilioVoiceNumberConfigured(): boolean {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && getTwilioVoiceNumber(),
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
  const { accountSid, authToken } = getTwilioCredentials();
  const messagingServiceSid = getTwilioMessagingServiceSid();
  const to = normaliseUkPhone(opts.to);
  const auth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");

  const { withSmsRegulatoryFooter } = await import("@/lib/comms.server");
  const body = await withSmsRegulatoryFooter(opts.body);

  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      To: to,
      MessagingServiceSid: messagingServiceSid,
      Body: body,
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
  const fromEnv =
    process.env.APP_BASE_URL?.trim() ||
    process.env.VITE_APP_URL?.trim() ||
    process.env.APP_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  return "http://localhost:5173";
}

export async function bookingConfirmationMessage(opts: {
  customerName: string;
  startsAt: Date;
  advisorName?: string;
  bookingUrl?: string;
}): Promise<string> {
  const whenParts = opts.startsAt.toLocaleString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/London",
  });
  const dateOnly = opts.startsAt.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "Europe/London",
  });
  const timeOnly = opts.startsAt.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/London",
  });
  const advisor = opts.advisorName?.trim();
  const firstName = opts.customerName.trim().split(/\s+/)[0] || opts.customerName;
  const fallback = advisor
    ? `Hi ${firstName}, your mortgage appointment is confirmed — you will meet ${advisor} on ${whenParts}.\n${opts.bookingUrl ?? ""}\nWe look forward to speaking with you.`
    : `Hi ${firstName}, your mortgage appointment is confirmed for ${whenParts}.\n${opts.bookingUrl ?? ""}\nWe look forward to speaking with you.`;

  const { renderSmsFromTemplate } = await import("@/lib/comms.server");
  return renderSmsFromTemplate(
    "sms_appointment_confirmation",
    {
      customer_first_name: firstName,
      customer_full_name: opts.customerName,
      appointment_date: dateOnly,
      appointment_time: timeOnly,
      appointment_when: whenParts,
      adviser_name: advisor ?? "",
      adviser_clause: advisor ? ` — you will meet ${advisor}` : "",
      booking_url: opts.bookingUrl ?? "",
      company_name: "MortgageEasy",
    },
    fallback,
  );
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

export async function callbackConfirmationMessage(opts: {
  customerName: string;
  window: string;
  advisorName?: string;
}): Promise<string> {
  const advisor = opts.advisorName?.trim() || "your adviser";
  const firstName = opts.customerName.trim().split(/\s+/)[0] || opts.customerName;
  const fallback = [
    `Hi ${firstName}, thank you for completing your mortgage fact-find.`,
    `${advisor} will call you between ${callbackWindowLabel(opts.window)}.`,
  ].join("\n");
  const { renderSmsFromTemplate } = await import("@/lib/comms.server");
  return renderSmsFromTemplate(
    "sms_callback_confirmation",
    {
      customer_first_name: firstName,
      adviser_name: advisor,
      callback_window: callbackWindowLabel(opts.window),
      company_name: "MortgageEasy",
    },
    fallback,
  );
}

export async function interviewCompleteMessage(opts: {
  name: string;
  summaryUrl: string;
}): Promise<string> {
  const fallback = [
    `Hi ${opts.name}, thank you for completing your mortgage fact-find.`,
    `You can view your summary here: ${opts.summaryUrl}`,
  ].join("\n");
  const { renderSmsFromTemplate } = await import("@/lib/comms.server");
  return renderSmsFromTemplate(
    "sms_factfind_complete",
    {
      customer_first_name: opts.name,
      session_url: opts.summaryUrl,
      company_name: "MortgageEasy",
    },
    fallback,
  );
}

export async function textChannelInviteMessage(opts: {
  customerName: string;
  bookUrl: string;
  introducerName: string;
}): Promise<string> {
  const firstName = opts.customerName.trim().split(/\s+/)[0] || opts.customerName;
  const fallback = `Hi ${firstName}, ${opts.introducerName} has referred you for a mortgage appointment. Book a convenient time here: ${opts.bookUrl}`;
  const { renderSmsFromTemplate } = await import("@/lib/comms.server");
  return renderSmsFromTemplate(
    "sms_booking_invite",
    {
      customer_first_name: firstName,
      introducer_name: opts.introducerName,
      booking_url: opts.bookUrl,
      company_name: "MortgageEasy",
    },
    fallback,
  );
}

const JOURNEY_MILESTONE_KEYS: Record<string, string> = {
  appointment_seen: "sms_journey_appointment_seen",
  id_confirmed: "sms_journey_id_confirmed",
  aip_completed: "sms_journey_aip_completed",
  offer_received: "sms_journey_offer_received",
  completion: "sms_journey_completion",
};

const JOURNEY_MILESTONE_FALLBACK: Record<string, string> = {
  appointment_seen: "we have noted your appointment and look forward to speaking with you.",
  id_confirmed: "your identity check has been confirmed — thank you.",
  aip_completed: "great news — your Agreement in Principle (AIP) is complete.",
  offer_received: "great news — your mortgage offer has been received.",
  completion: "congratulations — your mortgage completion has been recorded.",
};

export async function sendJourneyMilestoneSms(
  customerId: string,
  sessionId: string,
  milestoneKey: string,
): Promise<void> {
  try {
    if (!isTwilioConfigured()) return;
    const templateKey = JOURNEY_MILESTONE_KEYS[milestoneKey];
    const line = JOURNEY_MILESTONE_FALLBACK[milestoneKey];
    if (!templateKey || !line) return;

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("full_name, phone")
      .eq("id", customerId)
      .maybeSingle();
    const phone = (profile as { phone?: string | null } | null)?.phone?.trim();
    if (!phone) return;

    const firstName = profile?.full_name?.trim().split(/\s+/)[0] || "there";
    const sessionUrl = `${getAppBaseUrl()}/sessions/${sessionId}`;
    const { renderSmsFromTemplate } = await import("@/lib/comms.server");
    const body = await renderSmsFromTemplate(
      templateKey,
      {
        customer_first_name: firstName,
        session_url: sessionUrl,
        company_name: "MortgageEasy",
      },
      `Hi ${firstName}, ${line}\nView your file: ${sessionUrl}`,
    );

    const { sid } = await sendSms({ to: phone, body });
    try {
      await supabaseAdmin.from("sms_messages").insert({
        direction: "outbound",
        from_number: getSmsSenderLabel(),
        to_number: phone,
        body,
        twilio_sid: sid,
      });
    } catch (e) {
      console.error("log journey milestone sms failed", e);
    }
  } catch (e) {
    console.error("sendJourneyMilestoneSms failed", e);
  }
}

// Best-effort SMS confirming the fact-find is complete, with a direct link to
// the summary page. Never throws into the caller's happy path.
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
    const body = await interviewCompleteMessage({ name: firstName, summaryUrl });

    const { sid } = await sendSms({ to: phone, body });
    try {
      await supabaseAdmin.from("sms_messages").insert({
        direction: "outbound",
        from_number: getSmsSenderLabel(),
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
