// Server-only: persist inbound voicemails, match callers to cases, run AI transcript.

import { findSessionForCallerPhone } from "@/lib/phone-lookup.server";
import { processPhoneCallRecording } from "@/lib/phone-call-recording.server";
import { getVoiceConfig } from "@/lib/voice.server";
import { normaliseUkPhone } from "@/lib/sms.server";

function isMissingTableError(err: { code?: string; message?: string }): boolean {
  const code = err.code ?? "";
  const msg = (err.message ?? "").toLowerCase();
  return (
    code === "42P01" ||
    code === "42703" ||
    code === "PGRST204" ||
    msg.includes("phone_calls") ||
    msg.includes("phone_call_id")
  );
}

/** Prefer the advisor allocated to the case, then the appointment holder. */
export async function resolveAdvisorForSession(sessionId: string): Promise<string | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: alloc } = await supabaseAdmin
    .from("session_advisors")
    .select("advisor_id")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (alloc?.advisor_id) return alloc.advisor_id;

  const { data: appt } = await supabaseAdmin
    .from("appointments")
    .select("advisor_id")
    .eq("session_id", sessionId)
    .order("starts_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return appt?.advisor_id ?? null;
}

async function ensureVoicemailCallback(opts: {
  sessionId: string | null;
  customerId: string | null;
  advisorId: string | null;
  customerPhone: string;
  customerName: string;
  customerEmail?: string | null;
  phoneCallId: string;
  unallocated: boolean;
}): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const baseRow = {
    session_id: opts.sessionId,
    customer_id: opts.customerId,
    advisor_id: opts.advisorId,
    customer_name: opts.customerName,
    customer_phone: opts.customerPhone,
    customer_email: opts.customerEmail ?? null,
    preferred_window: "9-12" as const,
    status: "new" as const,
    notes: opts.unallocated
      ? "Inbound voicemail — unallocated (unknown caller). Assign to an advisor from Contacts."
      : "Inbound voicemail — customer left a message on the office line.",
  };

  try {
    const { data: byCall } = await supabaseAdmin
      .from("callback_requests")
      .select("id")
      .eq("phone_call_id", opts.phoneCallId)
      .maybeSingle();
    if (byCall) return;

    const { error } = await supabaseAdmin.from("callback_requests").insert({
      ...baseRow,
      phone_call_id: opts.phoneCallId,
    });
    if (error) throw error;
  } catch (e) {
    const err = e as { code?: string; message?: string };
    if (!isMissingTableError(err)) throw e;

    const { data: existing } = await supabaseAdmin
      .from("callback_requests")
      .select("id")
      .ilike("notes", `%${opts.phoneCallId}%`)
      .maybeSingle();
    if (existing) return;

    await supabaseAdmin.from("callback_requests").insert({
      ...baseRow,
      notes: `${baseRow.notes} [phone_call:${opts.phoneCallId}]`,
    });
  }
}

async function insertPhoneCallRow(opts: {
  sessionId: string | null;
  customerId: string | null;
  callSid: string;
  callerNorm: string;
  fromNumber: string;
  recordingUrl: string | null;
  recordingSid: string | null;
}): Promise<string | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: existing } = await supabaseAdmin
    .from("phone_calls")
    .select("id")
    .eq("twilio_call_sid", opts.callSid)
    .maybeSingle();
  if (existing?.id) return existing.id;

  const row: Record<string, unknown> = {
    session_id: opts.sessionId,
    customer_id: opts.customerId,
    advisor_id: null,
    twilio_call_sid: opts.callSid,
    twilio_recording_sid: opts.recordingSid,
    direction: "inbound",
    call_kind: "inbound_voicemail",
    from_number: opts.callerNorm,
    to_number: opts.fromNumber,
    recording_url: opts.recordingUrl,
    status: "completed",
    ended_at: new Date().toISOString(),
    ai_status: opts.recordingUrl ? "processing" : "pending",
  };

  const { data: inserted, error } = await supabaseAdmin
    .from("phone_calls")
    .insert(row)
    .select("id")
    .single();

  if (error) {
    if (isMissingTableError(error)) {
      console.error("[voicemail] phone_calls table missing — run supabase/RUN_PHONE_CALLS.sql");
    } else if (opts.sessionId === null && error.message?.includes("session_id")) {
      console.error("[voicemail] run RUN_PHONE_CALLS.sql to allow unallocated voicemails (nullable session_id)");
    } else {
      console.error("[voicemail] insert failed", error.message);
    }
    return null;
  }
  return inserted?.id ?? null;
}

export async function upsertInboundVoicemail(opts: {
  callSid: string;
  from: string;
  recordingUrl?: string | null;
  recordingSid?: string | null;
}): Promise<{ callId: string | null; matched: boolean; unallocated: boolean }> {
  const callSid = opts.callSid.trim();
  const from = opts.from.trim();
  if (!callSid || !from) return { callId: null, matched: false, unallocated: false };

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { fromNumber } = getVoiceConfig();
  const callerNorm = normaliseUkPhone(from);
  const recordingUrl = opts.recordingUrl?.trim() || null;
  const recordingSid = opts.recordingSid?.trim() || null;

  const match = await findSessionForCallerPhone(from);

  if (!match) {
    console.warn(`[voicemail] unallocated caller ${callerNorm}`);
    let callId = await insertPhoneCallRow({
      sessionId: null,
      customerId: null,
      callSid,
      callerNorm,
      fromNumber,
      recordingUrl,
      recordingSid,
    });
    if (!callId) {
      const { data: existing } = await supabaseAdmin
        .from("phone_calls")
        .select("id")
        .eq("twilio_call_sid", callSid)
        .maybeSingle();
      callId = existing?.id ?? null;
    }
    if (callId) {
      try {
        await ensureVoicemailCallback({
          sessionId: null,
          customerId: null,
          advisorId: null,
          customerPhone: callerNorm,
          customerName: "Unknown caller",
          phoneCallId: callId,
          unallocated: true,
        });
      } catch (e) {
        console.error("[voicemail] unallocated callback insert failed", e);
      }
    }
    return { callId, matched: false, unallocated: true };
  }

  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("full_name, email")
    .eq("id", match.customerId)
    .maybeSingle();

  const advisorId = await resolveAdvisorForSession(match.sessionId);

  let callId = await insertPhoneCallRow({
    sessionId: match.sessionId,
    customerId: match.customerId,
    callSid,
    callerNorm,
    fromNumber,
    recordingUrl,
    recordingSid,
  });

  if (!callId) {
    const { data: existing } = await supabaseAdmin
      .from("phone_calls")
      .select("id")
      .eq("twilio_call_sid", callSid)
      .maybeSingle();
    callId = existing?.id ?? null;
  } else if (recordingUrl || recordingSid) {
    await supabaseAdmin
      .from("phone_calls")
      .update({
        recording_url: recordingUrl ?? undefined,
        twilio_recording_sid: recordingSid ?? undefined,
        ...(recordingUrl ? { ai_status: "processing" } : {}),
      })
      .eq("id", callId);
  }

  if (callId) {
    try {
      await ensureVoicemailCallback({
        sessionId: match.sessionId,
        customerId: match.customerId,
        advisorId,
        customerPhone: callerNorm,
        customerName: profile?.full_name?.trim() || "Customer",
        customerEmail: profile?.email,
        phoneCallId: callId,
        unallocated: false,
      });
    } catch (e) {
      console.error("[voicemail] callback_requests insert failed", e);
    }
  }

  return { callId, matched: true, unallocated: false };
}

export async function processVoicemailRecording(callId: string, recordingUrl: string, recordingSid?: string) {
  await processPhoneCallRecording(callId, recordingUrl, recordingSid);
}

export async function handleInboundVoicemailWebhook(opts: {
  callSid: string;
  from: string;
  recordingUrl?: string | null;
  recordingSid?: string | null;
}): Promise<void> {
  const { callId } = await upsertInboundVoicemail(opts);
  const recordingUrl = opts.recordingUrl?.trim();
  if (callId && recordingUrl) {
    try {
      await processVoicemailRecording(callId, recordingUrl, opts.recordingSid ?? undefined);
    } catch (e) {
      console.error("[voicemail] AI processing failed", e);
    }
  }
}
