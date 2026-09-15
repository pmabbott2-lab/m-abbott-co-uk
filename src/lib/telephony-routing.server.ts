// Server-only: inbound routing rules for firm landline + cloneable agent mobiles.

import { findSessionForCallerPhone } from "@/lib/phone-lookup.server";
import { resolveAdvisorForSession } from "@/lib/inbound-voicemail.server";
import { normaliseUkPhone, getTwilioVoiceNumber } from "@/lib/sms.server";
import {
  inboundVoicemailTwiml,
  parseVoiceBrand,
  resolveVoicemailGreetingKey,
  twilioClient,
  voiceWebhookUrl,
  type VoiceBrandId,
  type VoicemailGreetingKey,
} from "@/lib/voice.server";

export type BusinessHours = Record<string, Array<{ start: string; end: string }>>;

export type TelephonyRoutingSettings = {
  timezone: string;
  businessHours: BusinessHours;
  voiceBrand: VoiceBrandId;
  outOfHoursAction: "voicemail" | "reroute_personal" | "ring_anyway";
  inAppointmentAction: "voicemail" | "reroute_personal" | "ring_anyway";
  noAnswerAction: "voicemail" | "reroute_personal";
  unownedCallerAction: "voicemail" | "ring_fallback_user";
  fallbackUserId: string | null;
  ringTimeoutSeconds: number;
};

export type AdvisorTelephonyProfile = {
  userId: string;
  enabled: boolean;
  ringSoftphone: boolean;
  ringAllocatedMobile: boolean;
  ringPersonalMobile: boolean;
  usePersonalRerouteAsFallback: boolean;
  respectOutlookBusy: boolean;
  respectHubAppointments: boolean;
  personalRerouteE164: string | null;
  allocatedMobileE164: string | null;
};

type RouteDecision =
  | { kind: "voicemail"; reason: string }
  | { kind: "ring"; reason: string; targets: DialTarget[]; noAnswer: "voicemail" | "reroute_personal"; personalReroute: string | null }
  | { kind: "reroute_personal"; reason: string; personalReroute: string };

export type DialTarget =
  | { type: "client"; identity: string }
  | { type: "number"; e164: string };

const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export async function loadTelephonyRoutingSettings(): Promise<TelephonyRoutingSettings> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("telephony_routing_settings")
    .select("*")
    .eq("id", 1)
    .maybeSingle();
  if (error) {
    if (error.code === "42P01" || error.code === "PGRST205") {
      return defaultSettings();
    }
    throw new Error(error.message);
  }
  if (!data) return defaultSettings();
  return {
    timezone: data.timezone ?? "Europe/London",
    businessHours: (data.business_hours ?? {}) as BusinessHours,
    voiceBrand: parseVoiceBrand(data.voice_brand),
    outOfHoursAction: data.out_of_hours_action,
    inAppointmentAction: data.in_appointment_action,
    noAnswerAction: data.no_answer_action,
    unownedCallerAction: data.unowned_caller_action,
    fallbackUserId: data.fallback_user_id ?? null,
    ringTimeoutSeconds: data.ring_timeout_seconds ?? 25,
  };
}

function defaultSettings(): TelephonyRoutingSettings {
  return {
    timezone: "Europe/London",
    businessHours: {
      mon: [{ start: "09:00", end: "17:30" }],
      tue: [{ start: "09:00", end: "17:30" }],
      wed: [{ start: "09:00", end: "17:30" }],
      thu: [{ start: "09:00", end: "17:30" }],
      fri: [{ start: "09:00", end: "17:30" }],
      sat: [],
      sun: [],
    },
    voiceBrand: "mortgage_easy",
    outOfHoursAction: "voicemail",
    inAppointmentAction: "voicemail",
    noAnswerAction: "voicemail",
    unownedCallerAction: "voicemail",
    fallbackUserId: null,
    ringTimeoutSeconds: 25,
  };
}

export function isWithinBusinessHours(now: Date, settings: TelephonyRoutingSettings): boolean {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: settings.timezone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const weekday = (parts.find((p) => p.type === "weekday")?.value ?? "Mon").slice(0, 3).toLowerCase();
  const hour = parts.find((p) => p.type === "hour")?.value ?? "00";
  const minute = parts.find((p) => p.type === "minute")?.value ?? "00";
  const hhmm = `${hour}:${minute}`;
  const dayKey =
    weekday === "mon" || weekday === "tue" || weekday === "wed" || weekday === "thu" || weekday === "fri" || weekday === "sat" || weekday === "sun"
      ? weekday
      : DAY_KEYS[now.getUTCDay()];
  const windows = settings.businessHours[dayKey] ?? [];
  return windows.some((w) => hhmm >= w.start && hhmm < w.end);
}

export async function loadAdvisorTelephony(userId: string): Promise<AdvisorTelephonyProfile | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("advisor_telephony")
    .select(
      "user_id, enabled, ring_softphone, ring_allocated_mobile, ring_personal_mobile, use_personal_reroute_as_fallback, respect_outlook_busy, respect_hub_appointments, personal_reroute_e164, allocated_mobile_number_id",
    )
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    if (error.code === "42P01" || error.code === "PGRST205") return null;
    throw new Error(error.message);
  }
  if (!data) return null;

  let allocatedMobileE164: string | null = null;
  if (data.allocated_mobile_number_id) {
    const { data: num } = await supabaseAdmin
      .from("telephony_numbers")
      .select("e164, active")
      .eq("id", data.allocated_mobile_number_id)
      .maybeSingle();
    if (num?.active) allocatedMobileE164 = num.e164;
  }

  return {
    userId: data.user_id,
    enabled: data.enabled,
    ringSoftphone: data.ring_softphone,
    ringAllocatedMobile: data.ring_allocated_mobile,
    ringPersonalMobile: data.ring_personal_mobile ?? true,
    usePersonalRerouteAsFallback: data.use_personal_reroute_as_fallback,
    respectOutlookBusy: data.respect_outlook_busy,
    respectHubAppointments: data.respect_hub_appointments,
    personalRerouteE164: data.personal_reroute_e164 ? normaliseUkPhone(data.personal_reroute_e164) : null,
    allocatedMobileE164,
  };
}

async function isBusyInHubDiary(advisorId: string, at: Date): Promise<boolean> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const iso = at.toISOString();
  const { data, error } = await supabaseAdmin
    .from("appointments")
    .select("id")
    .eq("advisor_id", advisorId)
    .lte("starts_at", iso)
    .gte("ends_at", iso)
    .limit(1);
  if (error) {
    console.error("hub diary busy check failed", error);
    return false;
  }
  return (data ?? []).length > 0;
}

async function isBusyInOutlook(advisorId: string, at: Date): Promise<boolean> {
  try {
    const { isAdvisorBusyInOutlookCalendar } = await import("@/lib/teams-calendar.server");
    return await isAdvisorBusyInOutlookCalendar(advisorId, at);
  } catch (e) {
    console.error("outlook busy check failed", e);
    return false;
  }
}

function buildDialTargets(profile: AdvisorTelephonyProfile): DialTarget[] {
  const targets: DialTarget[] = [];
  if (profile.ringSoftphone) targets.push({ type: "client", identity: profile.userId });
  // Optional: only if you explicitly want to dial the Twilio number itself (rare).
  if (profile.ringAllocatedMobile && profile.allocatedMobileE164) {
    targets.push({ type: "number", e164: profile.allocatedMobileE164 });
  }
  // Real handset — personal mobile sitting on the agent profile.
  if (profile.ringPersonalMobile && profile.personalRerouteE164) {
    targets.push({ type: "number", e164: profile.personalRerouteE164 });
  }
  return targets;
}

export async function decideInboundRoute(opts: {
  fromPhone: string;
  now?: Date;
}): Promise<RouteDecision> {
  const settings = await loadTelephonyRoutingSettings();
  const now = opts.now ?? new Date();
  const match = await findSessionForCallerPhone(opts.fromPhone);
  let advisorId: string | null = null;
  if (match?.sessionId) {
    advisorId = await resolveAdvisorForSession(match.sessionId);
  }
  if (!advisorId && settings.unownedCallerAction === "ring_fallback_user") {
    advisorId = settings.fallbackUserId;
  }
  if (!advisorId) {
    return { kind: "voicemail", reason: "unowned_caller" };
  }

  const profile = await loadAdvisorTelephony(advisorId);
  if (!profile?.enabled) {
    return { kind: "voicemail", reason: "advisor_telephony_disabled" };
  }

  const inHours = isWithinBusinessHours(now, settings);
  if (!inHours) {
    if (settings.outOfHoursAction === "voicemail") {
      return { kind: "voicemail", reason: "out_of_hours" };
    }
    if (settings.outOfHoursAction === "reroute_personal") {
      if (profile.personalRerouteE164) {
        return { kind: "reroute_personal", reason: "out_of_hours", personalReroute: profile.personalRerouteE164 };
      }
      return { kind: "voicemail", reason: "out_of_hours_no_personal" };
    }
    // ring_anyway continues
  }

  let busy = false;
  if (profile.respectHubAppointments) {
    busy = await isBusyInHubDiary(advisorId, now);
  }
  if (!busy && profile.respectOutlookBusy) {
    busy = await isBusyInOutlook(advisorId, now);
  }
  if (busy) {
    if (settings.inAppointmentAction === "voicemail") {
      return { kind: "voicemail", reason: "in_appointment" };
    }
    if (settings.inAppointmentAction === "reroute_personal") {
      if (profile.personalRerouteE164) {
        return { kind: "reroute_personal", reason: "in_appointment", personalReroute: profile.personalRerouteE164 };
      }
      return { kind: "voicemail", reason: "in_appointment_no_personal" };
    }
  }

  const targets = buildDialTargets(profile);
  if (targets.length === 0) {
    if (profile.usePersonalRerouteAsFallback && profile.personalRerouteE164) {
      return { kind: "reroute_personal", reason: "no_ring_targets", personalReroute: profile.personalRerouteE164 };
    }
    return { kind: "voicemail", reason: "no_ring_targets" };
  }

  return {
    kind: "ring",
    reason: match ? "owned_customer" : "fallback_user",
    targets,
    noAnswer: settings.noAnswerAction,
    personalReroute: profile.usePersonalRerouteAsFallback ? profile.personalRerouteE164 : null,
  };
}

export async function voicemailResponseTwiml(reason?: string | null): Promise<string> {
  const settings = await loadTelephonyRoutingSettings();
  const greetingKey: VoicemailGreetingKey = resolveVoicemailGreetingKey(reason);
  return inboundVoicemailTwiml({
    recordingCallback: voiceWebhookUrl("/api/twilio/voice/recording"),
    voicemailDoneUrl: voiceWebhookUrl("/api/twilio/voice/voicemail-done"),
    brand: settings.voiceBrand,
    greetingKey,
  });
}

export function dialTargetsTwiml(opts: {
  targets: DialTarget[];
  timeoutSeconds: number;
  actionUrl: string;
  callerId?: string;
  /** Avoid carrier voicemail answering as a “human” — hang up on machine. */
  detectMachineOnNumbers?: boolean;
}): string {
  const callerId = escapeXml(opts.callerId || getTwilioVoiceNumber());
  const action = escapeXml(opts.actionUrl);
  const timeout = Math.min(Math.max(opts.timeoutSeconds, 8), 60);
  const amd = opts.detectMachineOnNumbers !== false;
  const amdCb = escapeXml(voiceWebhookUrl("/api/twilio/voice/amd-status"));
  const legs = opts.targets
    .map((t) => {
      if (t.type === "client") return `<Client>${escapeXml(t.identity)}</Client>`;
      const num = escapeXml(normaliseUkPhone(t.e164));
      // Sync AMD + async callback: redirect parent to Hub Susan as soon as Vodafone VM is detected.
      return amd
        ? `<Number machineDetection="Enable" machineDetectionTimeout="4" amdStatusCallback="${amdCb}" amdStatusCallbackMethod="POST">${num}</Number>`
        : `<Number>${num}</Number>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial callerId="${callerId}" timeout="${timeout}" answerOnBridge="true" action="${action}" method="POST">${legs}</Dial>
</Response>`;
}

/** AMD callback: carrier voicemail answered the personal leg — send the caller to Hub Susan. */
export async function handleAmdStatusCallback(opts: {
  callSid: string | null;
  parentCallSid: string | null;
  answeredBy: string | null;
}): Promise<void> {
  if (!isMachineAnswer(opts.answeredBy)) return;
  const childSid = opts.callSid?.trim() || "";
  let parentSid = opts.parentCallSid?.trim() || "";
  const client = twilioClient();

  if (!parentSid && childSid) {
    try {
      const child = await client.calls(childSid).fetch();
      parentSid = child.parentCallSid || "";
    } catch (e) {
      console.error("[telephony] AMD fetch parent failed", e);
    }
  }

  console.info("[telephony] AMD machine → Hub voicemail", opts.answeredBy, { childSid, parentSid });

  const twiml = await voicemailResponseTwiml("no_answer");
  if (parentSid) {
    try {
      await client.calls(parentSid).update({ twiml });
    } catch (e) {
      console.error("[telephony] AMD redirect parent failed", e);
    }
  }
  if (childSid) {
    try {
      await client.calls(childSid).update({ status: "completed" });
    } catch {
      /* may already be ending */
    }
  }
}

export function dialNumberTwiml(opts: {
  e164: string;
  timeoutSeconds?: number;
  actionUrl: string;
  callerId?: string;
}): string {
  // Keep personal-handset rings short so network voicemail is less likely to pick up.
  const timeout = Math.min(opts.timeoutSeconds ?? 12, 14);
  return dialTargetsTwiml({
    targets: [{ type: "number", e164: opts.e164 }],
    timeoutSeconds: timeout,
    actionUrl: opts.actionUrl,
    callerId: opts.callerId,
    detectMachineOnNumbers: true,
  });
}

export async function buildInboundTwiml(fromPhone: string): Promise<string> {
  const settings = await loadTelephonyRoutingSettings();
  const decision = await decideInboundRoute({ fromPhone });
  const dialDone = voiceWebhookUrl("/api/twilio/voice/inbound-dial-done");

  if (decision.kind === "voicemail") {
    console.info("[telephony] inbound → voicemail", decision.reason, settings.voiceBrand);
    return voicemailResponseTwiml(decision.reason);
  }
  if (decision.kind === "reroute_personal") {
    console.info("[telephony] inbound → personal reroute", decision.reason);
    return dialNumberTwiml({
      e164: decision.personalReroute,
      actionUrl: `${dialDone}?fallback=voicemail&reason=no_answer`,
      timeoutSeconds: Math.min(settings.ringTimeoutSeconds, 18),
    });
  }

  const clients = decision.targets.filter((t) => t.type === "client");
  const numbers = decision.targets.filter((t) => t.type === "number");
  const qsBase: Record<string, string> = {
    noAnswer: decision.noAnswer,
    reason: "no_answer",
    ...(decision.personalReroute ? { personal: decision.personalReroute } : {}),
  };

  // Softphone first (never hits Vodafone VM). After miss:
  // - noAnswer=voicemail → Hub Susan (do not dial personal — carrier VM steals the call)
  // - noAnswer=reroute_personal → short AMD-protected personal ring, then Hub Susan
  if (clients.length > 0 && numbers.length > 0) {
    const qs = new URLSearchParams({
      ...qsBase,
      step: "after_softphone",
      ...(decision.noAnswer === "reroute_personal"
        ? {
            nextNumbers: numbers
              .map((n) => (n.type === "number" ? n.e164 : ""))
              .filter(Boolean)
              .join(","),
          }
        : {}),
    });
    console.info(
      "[telephony] inbound → softphone then",
      decision.noAnswer === "reroute_personal" ? "personal" : "Hub voicemail",
      decision.reason,
    );
    return dialTargetsTwiml({
      targets: clients,
      timeoutSeconds: Math.min(settings.ringTimeoutSeconds, 15),
      actionUrl: `${dialDone}?${qs.toString()}`,
      detectMachineOnNumbers: false,
    });
  }

  // Softphone only
  if (clients.length > 0 && numbers.length === 0) {
    const qs = new URLSearchParams(qsBase);
    console.info("[telephony] inbound → softphone only", decision.reason);
    return dialTargetsTwiml({
      targets: clients,
      timeoutSeconds: Math.min(settings.ringTimeoutSeconds, 20),
      actionUrl: `${dialDone}?${qs.toString()}`,
      detectMachineOnNumbers: false,
    });
  }

  // Personal / PSTN only — short ring + AMD so Vodafone VM cannot keep the caller.
  const qs = new URLSearchParams({ ...qsBase, fallback: "voicemail" });
  console.info("[telephony] inbound → ring PSTN with AMD", decision.reason, decision.targets);
  return dialTargetsTwiml({
    targets: decision.targets,
    timeoutSeconds: Math.min(settings.ringTimeoutSeconds, 12),
    actionUrl: `${dialDone}?${qs.toString()}`,
    detectMachineOnNumbers: true,
  });
}

function isMachineAnswer(answeredBy: string | null | undefined): boolean {
  const v = (answeredBy ?? "").toLowerCase();
  return v.startsWith("machine") || v === "fax";
}

export async function buildDialDoneTwiml(opts: {
  dialCallStatus: string | null;
  answeredBy?: string | null;
  noAnswer: string | null;
  personal: string | null;
  fallback: string | null;
  reason?: string | null;
  step?: string | null;
  nextNumbers?: string | null;
}): Promise<string> {
  const status = (opts.dialCallStatus ?? "").toLowerCase();
  console.info("[telephony] dial-done", {
    status,
    answeredBy: opts.answeredBy,
    step: opts.step,
    noAnswer: opts.noAnswer,
    fallback: opts.fallback,
  });

  // Bridged call finished (softphone or human on PSTN). Machine legs are handled below / via AMD callback.
  if (status === "completed" && !isMachineAnswer(opts.answeredBy)) {
    return `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`;
  }

  if (isMachineAnswer(opts.answeredBy)) {
    console.info("[telephony] dial-done machine → Hub voicemail", opts.answeredBy);
    return await voicemailResponseTwiml(opts.reason || "no_answer");
  }

  // Softphone missed → only dial personal when routing rule is explicitly "reroute_personal".
  if (opts.step === "after_softphone" && opts.nextNumbers && opts.noAnswer === "reroute_personal") {
    const nums = opts.nextNumbers
      .split(",")
      .map((n) => n.trim())
      .filter(Boolean);
    if (nums.length > 0) {
      const dialDone = voiceWebhookUrl("/api/twilio/voice/inbound-dial-done");
      const qs = new URLSearchParams({
        fallback: "voicemail",
        reason: "no_answer",
        noAnswer: "voicemail",
        step: "personal_tried",
        ...(opts.personal ? { personal: opts.personal } : {}),
      });
      console.info("[telephony] softphone miss → personal with AMD (explicit reroute)", nums);
      return dialTargetsTwiml({
        targets: nums.map((e164) => ({ type: "number" as const, e164 })),
        timeoutSeconds: 12,
        actionUrl: `${dialDone}?${qs.toString()}`,
        detectMachineOnNumbers: true,
      });
    }
  }

  // Softphone miss with Hub voicemail policy (default) — never touch personal PSTN / Vodafone VM.
  if (opts.step === "after_softphone") {
    console.info("[telephony] softphone miss → Hub voicemail (skip personal PSTN)");
    return await voicemailResponseTwiml(opts.reason || "no_answer");
  }

  const reason = opts.reason || "no_answer";
  if (
    status === "busy" ||
    status === "no-answer" ||
    status === "failed" ||
    status === "canceled" ||
    opts.fallback === "voicemail" ||
    opts.noAnswer === "voicemail" ||
    opts.step === "personal_tried"
  ) {
    console.info("[telephony] → Hub voicemail", status, opts.answeredBy);
    return await voicemailResponseTwiml(reason);
  }

  if (opts.noAnswer === "reroute_personal" && opts.personal && opts.step !== "personal_tried") {
    const dialDone = voiceWebhookUrl("/api/twilio/voice/inbound-dial-done");
    return dialNumberTwiml({
      e164: opts.personal,
      timeoutSeconds: 12,
      actionUrl: `${dialDone}?fallback=voicemail&reason=no_answer&step=personal_tried`,
    });
  }
  return await voicemailResponseTwiml(reason);
}
