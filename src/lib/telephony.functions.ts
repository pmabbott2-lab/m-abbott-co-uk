import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { normaliseUkPhone } from "@/lib/sms.server";
import { isTwilioVoiceConfigured, getVoiceConfig } from "@/lib/voice.server";
import { createVoiceAccessToken, isTwilioClientVoiceConfigured } from "@/lib/voice-token.server";
import type { ContactHistoryEntry } from "@/lib/sessions.functions";
import type { ResourceCapability } from "@/lib/tenant-assert.server";

/** Call and voicemail reads: advisers and main admins of the verified acting tenant. */
const TELEPHONY_READ: ResourceCapability = {
  mutate: false,
  allocation: "none",
  allow: (v) => v.isAdvisor || v.isMainAdmin,
};

/** GDPR history export: as TELEPHONY_READ, and advisers must be allocated to the session. */
const GDPR_EXPORT: ResourceCapability = {
  mutate: false,
  allocation: "adviser_must_be_allocated",
  allow: (v) => v.isAdvisor || v.isMainAdmin,
};

const CALL_DETAIL_COLUMNS =
  "id, tenant_id, session_id, to_number, from_number, direction, call_kind, status, started_at, ended_at, duration_seconds, summary, transcript, ai_status, advisor_id";

type CallDetailRow = {
  id: string;
  tenant_id: string | null;
  session_id: string | null;
  to_number: string;
  from_number: string | null;
  direction: string;
  call_kind: string;
  status: string;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number | null;
  summary: string | null;
  transcript: string | null;
  ai_status: string;
  advisor_id: string | null;
};

async function toPhoneCallDetail(row: CallDetailRow): Promise<PhoneCallDetail> {
  const { supabaseAdminUntyped: supabaseAdmin } =
    await import("@/integrations/supabase/client.server");
  let advisorName: string | null = null;
  if (row.advisor_id) {
    const { data: prof } = await supabaseAdmin
      .from("profiles")
      .select("full_name")
      .eq("id", row.advisor_id)
      .maybeSingle();
    advisorName = (prof as { full_name?: string | null } | null)?.full_name ?? null;
  }
  return {
    id: row.id,
    sessionId: row.session_id as string,
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
}

async function staffRoles(userId: string): Promise<string[]> {
  const { resolveActingTenantRole } = await import("@/lib/tenant-role.server");
  const view = await resolveActingTenantRole(userId);
  const roles: string[] = [];
  if (view.isAdvisor) roles.push("advisor");
  if (view.isMainAdmin) roles.push("admin");
  return roles;
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
      throw new Error(
        "Voice calling is not configured. Check Twilio Voice env vars and APP_BASE_URL.",
      );
    }

    const { supabaseAdminUntyped: supabaseAdmin } =
      await import("@/integrations/supabase/client.server");
    const { assertStaffCanAccessCustomer, staffCustomerCapability } =
      await import("@/lib/sessions.functions");
    const { authoriseTenantResource } = await import("@/lib/tenant-assert.server");
    const { row: session, tenantId } = await authoriseTenantResource({
      userId: context.userId,
      kind: "session",
      id: data.sessionId,
      capability: { ...staffCustomerCapability(true), allocation: "none" },
    });
    if (!session.case_ref) {
      throw new Error(
        "Open the customer case before calling — calls are recorded against the case CRM tab.",
      );
    }
    if (session.customer_id) {
      await assertStaffCanAccessCustomer(context.userId, session.customer_id, {
        forMutation: true,
      });
    }

    const customerPhone = normaliseUkPhone(data.customerPhone);
    const { fromNumber } = getVoiceConfig();

    const { data: callRow, error: insertErr } = await supabaseAdmin
      .from("phone_calls")
      .insert({
        tenant_id: tenantId,
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
    const { authoriseTenantResource, scopeRowsToTenant } =
      await import("@/lib/tenant-assert.server");
    const { tenantId } = await authoriseTenantResource({
      userId: context.userId,
      kind: "session",
      id: data.sessionId,
      capability: TELEPHONY_READ,
    });

    const { supabaseAdminUntyped: supabaseAdmin } =
      await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin
      .from("phone_calls")
      .select("id, tenant_id, session_id, from_number, started_at, summary, ai_status")
      .eq("session_id", data.sessionId)
      .eq("call_kind", "inbound_voicemail")
      .order("started_at", { ascending: false });
    if (error) throw new Error(error.message);
    const owned = await scopeRowsToTenant(
      (rows ?? []) as Array<{
        id: string;
        tenant_id: string | null;
        session_id: string | null;
        from_number: string | null;
        started_at: string;
        summary: string | null;
        ai_status: string;
      }>,
      tenantId,
      { tenantOf: (r) => r.tenant_id, sessionOf: (r) => r.session_id },
    );

    return owned.map((r) => ({
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
    // Role in the acting tenant before the call is loaded; the call's tenant is its own
    // tenant_id, else its session's. Unknown, other-tenant, conflicting and tenantless calls
    // (unowned inbound voicemails) all fail with the same "Not found.".
    const { resolveActingTenantForList, scopeRowsToTenant, RESOURCE_NOT_FOUND_MESSAGE } =
      await import("@/lib/tenant-assert.server");
    const { tenantId } = await resolveActingTenantForList(context.userId, TELEPHONY_READ);

    const { supabaseAdminUntyped: supabaseAdmin } =
      await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
      .from("phone_calls")
      .select(CALL_DETAIL_COLUMNS)
      .eq("id", data.callId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const [owned] = row
      ? await scopeRowsToTenant([row as CallDetailRow], tenantId, {
          tenantOf: (r) => r.tenant_id,
          sessionOf: (r) => r.session_id,
        })
      : [];
    if (!owned) throw new Error(RESOURCE_NOT_FOUND_MESSAGE);
    return toPhoneCallDetail(owned);
  });

export const getGdprHistoryExport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ sessionId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<GdprHistoryExport> => {
    // Export covers this one session in the acting tenant only; the customer's relationships
    // with other tenants are neither read nor reported.
    const { authoriseTenantResource, scopeRowsToTenant } =
      await import("@/lib/tenant-assert.server");
    const {
      tenantId,
      view,
      row: session,
    } = await authoriseTenantResource({
      userId: context.userId,
      kind: "session",
      id: data.sessionId,
      capability: GDPR_EXPORT,
    });

    const { fetchContactHistoryEntries } = await import("@/lib/sessions.functions");
    const { supabaseAdminUntyped: supabaseAdmin } =
      await import("@/integrations/supabase/client.server");
    const entries = await fetchContactHistoryEntries(data.sessionId, { tenantId, view });

    let customerName = "Customer";
    let customerEmail: string | null = null;
    if (session.customer_id) {
      const { data: prof } = await supabaseAdmin
        .from("profiles")
        .select("full_name, email")
        .eq("id", session.customer_id)
        .maybeSingle();
      const p = prof as { full_name?: string | null; email?: string | null } | null;
      customerName = p?.full_name || p?.email || customerName;
      customerEmail = p?.email ?? null;
    }

    const { data: callRows } = await supabaseAdmin
      .from("phone_calls")
      .select(CALL_DETAIL_COLUMNS)
      .eq("session_id", data.sessionId)
      .order("started_at", { ascending: false });
    const ownedCalls = await scopeRowsToTenant((callRows ?? []) as CallDetailRow[], tenantId, {
      tenantOf: (r) => r.tenant_id,
      sessionOf: (r) => r.session_id,
    });

    const calls: PhoneCallDetail[] = [];
    for (const row of ownedCalls) calls.push(await toPhoneCallDetail(row));

    return {
      customerName,
      customerEmail,
      sessionId: data.sessionId,
      exportedAt: new Date().toISOString(),
      entries,
      calls,
    };
  });
