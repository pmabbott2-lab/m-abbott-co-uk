import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { normaliseUkPhone } from "@/lib/sms.server";
import { isTwilioVoiceConfigured, getVoiceConfig } from "@/lib/voice.server";
import { createVoiceAccessToken, isTwilioClientVoiceConfigured } from "@/lib/voice-token.server";
import type { ContactHistoryEntry } from "@/lib/sessions.functions";

async function staffRoles(userId: string): Promise<string[]> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin.from("user_roles").select("role").eq("user_id", userId);
  return (data ?? []).map((r) => r.role);
}

function isStaffRole(roles: string[]): boolean {
  return roles.includes("advisor") || roles.includes("admin");
}

export type PhoneCallDetail = {
  id: string;
  sessionId: string;
  toNumber: string;
  fromNumber: string | null;
  direction: string;
  callKind: string;
  status: string;
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number | null;
  summary: string | null;
  transcript: string | null;
  aiStatus: string;
  advisorName: string | null;
};

export type SessionVoicemail = {
  id: string;
  fromNumber: string;
  startedAt: string;
  summary: string | null;
  aiStatus: string;
};

export type GdprHistoryExport = {
  customerName: string;
  customerEmail: string | null;
  sessionId: string;
  exportedAt: string;
  entries: ContactHistoryEntry[];
  calls: PhoneCallDetail[];
};

/** Issue a short-lived Twilio Voice token for the signed-in advisor's browser. */
export const getVoiceAccessToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const roles = await staffRoles(context.userId);
    if (!isStaffRole(roles)) throw new Error("Forbidden");
    if (!isTwilioClientVoiceConfigured()) {
      throw new Error(
        "Browser calling is not configured. Set TWILIO_API_KEY_SID, TWILIO_API_KEY_SECRET, and TWILIO_TWIML_APP_SID.",
      );
    }
    const token = createVoiceAccessToken(context.userId);
    return { token };
  });

/** Create a phone_calls row before the browser dials via the Voice SDK. */
export const prepareBrowserCall = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ sessionId: z.string().uuid(), customerPhone: z.string().min(5) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const roles = await staffRoles(context.userId);
    if (!isStaffRole(roles)) throw new Error("Forbidden");
    if (!isTwilioVoiceConfigured()) {
      throw new Error("Voice calling is not configured. Check Twilio Voice env vars and APP_BASE_URL.");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { assertStaffCanAccessCustomer } = await import("@/lib/sessions.functions");
    const { data: session } = await supabaseAdmin
      .from("interview_sessions")
      .select("customer_id, case_ref")
      .eq("id", data.sessionId)
      .maybeSingle();
    if (!session) throw new Error("Session not found");
    if (!session.case_ref) {
      throw new Error("Open the customer case before calling — calls are recorded against the case CRM tab.");
    }
    if (session.customer_id) {
      await assertStaffCanAccessCustomer(context.userId, session.customer_id);
    }

    const customerPhone = normaliseUkPhone(data.customerPhone);
    const { fromNumber } = getVoiceConfig();

    const { data: callRow, error: insertErr } = await supabaseAdmin
      .from("phone_calls")
      .insert({
        session_id: data.sessionId,
        customer_id: session.customer_id,
        advisor_id: context.userId,
        to_number: customerPhone,
        from_number: fromNumber,
        direction: "outbound",
        call_kind: "outbound",
        status: "initiated",
        ai_status: "pending",
      })
      .select("id")
      .single();
    if (insertErr) throw new Error(insertErr.message);

    return { callId: callRow.id, customerPhone, fromNumber };
  });

/** Attach the Twilio Call SID once the browser leg connects. */
export const attachBrowserCallSid = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ callId: z.string().uuid(), twilioCallSid: z.string().min(10) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const roles = await staffRoles(context.userId);
    if (!isStaffRole(roles)) throw new Error("Forbidden");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("phone_calls")
      .update({ twilio_call_sid: data.twilioCallSid, status: "in_progress" })
      .eq("id", data.callId)
      .eq("advisor_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Finalise call duration/status when the browser disconnects. */
export const finalizeBrowserCall = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        callId: z.string().uuid(),
        status: z.enum(["completed", "failed", "canceled", "no_answer"]).optional(),
        durationSeconds: z.number().int().min(0).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const roles = await staffRoles(context.userId);
    if (!isStaffRole(roles)) throw new Error("Forbidden");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const patch: Record<string, unknown> = {
      status: data.status ?? "completed",
      ended_at: new Date().toISOString(),
    };
    if (data.durationSeconds != null && data.durationSeconds > 0) {
      patch.duration_seconds = data.durationSeconds;
    }

    const { error } = await supabaseAdmin
      .from("phone_calls")
      .update(patch)
      .eq("id", data.callId)
      .eq("advisor_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** @deprecated Use prepareBrowserCall + BrowserSoftphone — kept for compatibility. */
export const initiatePhoneCall = prepareBrowserCall;

export const listSessionVoicemails = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ sessionId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<SessionVoicemail[]> => {
    const roles = await staffRoles(context.userId);
    if (!isStaffRole(roles)) throw new Error("Forbidden");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin
      .from("phone_calls")
      .select("id, from_number, started_at, summary, ai_status")
      .eq("session_id", data.sessionId)
      .eq("call_kind", "inbound_voicemail")
      .order("started_at", { ascending: false });
    if (error) throw new Error(error.message);

    return (rows ?? []).map((r) => ({
      id: r.id,
      fromNumber: r.from_number ?? "Unknown",
      startedAt: r.started_at,
      summary: r.summary,
      aiStatus: r.ai_status,
    }));
  });

export const getPhoneCall = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ callId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<PhoneCallDetail> => {
    const roles = await staffRoles(context.userId);
    if (!isStaffRole(roles)) throw new Error("Forbidden");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
      .from("phone_calls")
      .select(
        "id, session_id, to_number, from_number, direction, call_kind, status, started_at, ended_at, duration_seconds, summary, transcript, ai_status, advisor_id",
      )
      .eq("id", data.callId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Call not found");

    let advisorName: string | null = null;
    if (row.advisor_id) {
      const { data: prof } = await supabaseAdmin
        .from("profiles")
        .select("full_name")
        .eq("id", row.advisor_id)
        .maybeSingle();
      advisorName = prof?.full_name ?? null;
    }

    return {
      id: row.id,
      sessionId: row.session_id,
      toNumber: row.to_number,
      fromNumber: row.from_number,
      direction: row.direction,
      callKind: row.call_kind,
      status: row.status,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      durationSeconds: row.duration_seconds,
      summary: row.summary,
      transcript: row.transcript,
      aiStatus: row.ai_status,
      advisorName,
    };
  });

export const getGdprHistoryExport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ sessionId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<GdprHistoryExport> => {
    const roles = await staffRoles(context.userId);
    if (!isStaffRole(roles)) throw new Error("Forbidden");

    const { fetchContactHistoryEntries } = await import("@/lib/sessions.functions");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const email = (context.claims as { email?: string }).email;
    const entries = await fetchContactHistoryEntries(data.sessionId, {
      userId: context.userId,
      email,
    });

    const { data: session } = await supabaseAdmin
      .from("interview_sessions")
      .select("customer_id")
      .eq("id", data.sessionId)
      .maybeSingle();

    let customerName = "Customer";
    let customerEmail: string | null = null;
    if (session?.customer_id) {
      const { data: prof } = await supabaseAdmin
        .from("profiles")
        .select("full_name, email")
        .eq("id", session.customer_id)
        .maybeSingle();
      customerName = prof?.full_name || prof?.email || customerName;
      customerEmail = prof?.email ?? null;
    }

    const { data: callRows } = await supabaseAdmin
      .from("phone_calls")
      .select(
        "id, session_id, to_number, from_number, direction, call_kind, status, started_at, ended_at, duration_seconds, summary, transcript, ai_status, advisor_id",
      )
      .eq("session_id", data.sessionId)
      .order("started_at", { ascending: false });

    const calls: PhoneCallDetail[] = [];
    for (const row of callRows ?? []) {
      let advisorName: string | null = null;
      if (row.advisor_id) {
        const { data: prof } = await supabaseAdmin
          .from("profiles")
          .select("full_name")
          .eq("id", row.advisor_id)
          .maybeSingle();
        advisorName = prof?.full_name ?? null;
      }
      calls.push({
        id: row.id,
        sessionId: row.session_id,
        toNumber: row.to_number,
        fromNumber: row.from_number,
        direction: row.direction,
        callKind: row.call_kind,
        status: row.status,
        startedAt: row.started_at,
        endedAt: row.ended_at,
        durationSeconds: row.duration_seconds,
        summary: row.summary,
        transcript: row.transcript,
        aiStatus: row.ai_status,
        advisorName,
      });
    }

    return {
      customerName,
      customerEmail,
      sessionId: data.sessionId,
      exportedAt: new Date().toISOString(),
      entries,
      calls,
    };
  });
