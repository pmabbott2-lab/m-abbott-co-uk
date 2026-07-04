import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import {
  bookingConfirmationMessage,
  callbackConfirmationMessage,
  getAppBaseUrl,
  isTwilioConfigured,
  normaliseUkPhone,
  sendSms,
  textChannelInviteMessage,
} from "@/lib/sms.server";
import { clearSessionAttention, assertStaffCanAccessCustomer } from "@/lib/sessions.functions";

const SLOT_MINUTES = 30;
const BOOKING_HORIZON_DAYS = 28;

function parseTimeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

function minutesToTime(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

async function getPrimaryAdvisorId(): Promise<string> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("user_roles")
    .select("user_id")
    .eq("role", "advisor")
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("No advisor configured. Add an advisor role in Supabase first.");
  return data.user_id;
}

async function resolveBookingAdvisorId(staffUserId?: string): Promise<string> {
  if (!staffUserId) return getPrimaryAdvisorId();
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: roles } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", staffUserId);
  if ((roles ?? []).some((r) => r.role === "advisor")) return staffUserId;
  return getPrimaryAdvisorId();
}

// Resolve a display name for the assigned advisor (used in confirmation SMS).
// Falls back to "your advisor" when no profile/name is available.
async function getAdvisorName(advisorId: string): Promise<string> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("profiles")
      .select("full_name")
      .eq("id", advisorId)
      .maybeSingle();
    const name = data?.full_name?.trim();
    return name || "your advisor";
  } catch {
    return "your advisor";
  }
}

async function ensureDefaultAvailability(advisorId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { count } = await supabaseAdmin
    .from("advisor_availability")
    .select("id", { count: "exact", head: true })
    .eq("advisor_id", advisorId);
  if ((count ?? 0) > 0) return;

  const weekdays = [1, 2, 3, 4, 5];
  await supabaseAdmin.from("advisor_availability").insert(
    weekdays.map((day) => ({
      advisor_id: advisorId,
      day_of_week: day,
      start_time: "09:00",
      end_time: "17:00",
      slot_minutes: SLOT_MINUTES,
      active: true,
    })),
  );
}

async function logSms(opts: {
  direction: "inbound" | "outbound";
  from: string;
  to: string;
  body: string;
  twilioSid?: string;
  appointmentId?: string;
  leadId?: string;
}) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  await supabaseAdmin.from("sms_messages").insert({
    direction: opts.direction,
    from_number: opts.from,
    to_number: opts.to,
    body: opts.body,
    twilio_sid: opts.twilioSid ?? null,
    appointment_id: opts.appointmentId ?? null,
    lead_id: opts.leadId ?? null,
  });
}

export const getAvailableSlots = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) =>
    z
      .object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        advisorId: z.string().uuid().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const advisorId = data.advisorId ?? (await getPrimaryAdvisorId());
    await ensureDefaultAvailability(advisorId);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const day = new Date(`${data.date}T12:00:00`);
    const dayOfWeek = day.getDay();

    const { data: availability, error: availErr } = await supabaseAdmin
      .from("advisor_availability")
      .select("*")
      .eq("advisor_id", advisorId)
      .eq("day_of_week", dayOfWeek)
      .eq("active", true)
      .maybeSingle();
    if (availErr) throw new Error(availErr.message);
    if (!availability) return { slots: [] as string[], advisorId };

    const dayStart = new Date(`${data.date}T00:00:00`);
    const dayEnd = new Date(`${data.date}T23:59:59`);
    const { data: booked, error: bookedErr } = await supabaseAdmin
      .from("appointments")
      .select("starts_at, ends_at")
      .eq("advisor_id", advisorId)
      .eq("status", "confirmed")
      .gte("starts_at", dayStart.toISOString())
      .lte("starts_at", dayEnd.toISOString());
    if (bookedErr) throw new Error(bookedErr.message);

    const bookedStarts = new Set((booked ?? []).map((b) => new Date(b.starts_at).toISOString()));

    const startMin = parseTimeToMinutes(availability.start_time.slice(0, 5));
    const endMin = parseTimeToMinutes(availability.end_time.slice(0, 5));
    const slotSize = availability.slot_minutes ?? SLOT_MINUTES;
    const now = new Date();
    const slots: string[] = [];

    for (let t = startMin; t + slotSize <= endMin; t += slotSize) {
      const time = minutesToTime(t);
      const startsAt = new Date(`${data.date}T${time}:00`);
      if (startsAt <= now) continue;
      const horizon = new Date();
      horizon.setDate(horizon.getDate() + BOOKING_HORIZON_DAYS);
      if (startsAt > horizon) continue;
      if (!bookedStarts.has(startsAt.toISOString())) {
        slots.push(startsAt.toISOString());
      }
    }

    return { slots, advisorId };
  });

const appointmentInput = z.object({
  slug: z.string().min(1).optional(),
  leadId: z.string().uuid().optional(),
  sessionId: z.string().uuid().optional(),
  customerId: z.string().uuid().optional(),
  advisorId: z.string().uuid().optional(),
  channel: z.enum(["voice", "text", "direct_booking"]).optional(),
  customerName: z.string().min(2),
  customerPhone: z.string().min(7),
  customerEmail: z.string().email().optional().or(z.literal("")),
  startsAt: z.string().datetime(),
  notes: z.string().max(500).optional(),
  sendSms: z.boolean().optional(),
});

async function resolveIntroducer(slug?: string) {
  if (!slug) return null;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("introducers")
    .select("id, company_name, slug")
    .eq("slug", slug)
    .eq("active", true)
    .maybeSingle();
  return data;
}

async function bookAppointment(
  data: z.infer<typeof appointmentInput>,
  actingUserId?: string,
) {
  const advisorId = data.advisorId ?? (await resolveBookingAdvisorId(actingUserId));
  const startsAt = new Date(data.startsAt);
  const endsAt = new Date(startsAt.getTime() + SLOT_MINUTES * 60 * 1000);

  const introducer = await resolveIntroducer(data.slug);
  let leadSource: "referral_link" | "introducer_portal" | "web" = "web";
  let referralChannel: "voice" | "text" | "direct_booking" | "manual" =
    data.channel ?? "direct_booking";
  let introducerId: string | null = introducer?.id ?? null;
  const leadId: string | null = data.leadId ?? null;

  if (actingUserId) {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: roles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", actingUserId);
    if ((roles ?? []).some((r) => r.role === "introducer")) {
      leadSource = "introducer_portal";
      referralChannel = "manual";
      if (!introducerId) {
        const { data: ownIntro } = await supabaseAdmin
          .from("introducers")
          .select("id")
          .eq("user_id", actingUserId)
          .maybeSingle();
        introducerId = ownIntro?.id ?? null;
      }
    }
  }

  if (introducer && !actingUserId) {
    leadSource = "referral_link";
    referralChannel = "direct_booking";
  }

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: conflict } = await supabaseAdmin
    .from("appointments")
    .select("id")
    .eq("advisor_id", advisorId)
    .eq("status", "confirmed")
    .eq("starts_at", startsAt.toISOString())
    .maybeSingle();
  if (conflict) throw new Error("That time slot is no longer available. Please choose another.");

  const { data: appointment, error } = await supabaseAdmin
    .from("appointments")
    .insert({
      advisor_id: advisorId,
      introducer_id: introducerId,
      lead_id: leadId,
      session_id: data.sessionId ?? null,
      customer_name: data.customerName,
      customer_phone: data.customerPhone,
      customer_email: data.customerEmail || null,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      status: "confirmed",
      lead_source: leadSource,
      referral_channel: referralChannel,
      notes: data.notes || null,
    })
    .select()
    .single();
  if (error) throw new Error(error.message);

  // A fresh appointment (no linked session) opens a new case for the customer.
  let linkedSessionId = data.sessionId ?? null;
  const targetCustomerId = data.customerId ?? actingUserId ?? null;
  if (!linkedSessionId && targetCustomerId) {
    try {
      const { createCaseSessionForCustomer } = await import("@/lib/sessions.functions");
      const newCase = await createCaseSessionForCustomer(targetCustomerId);
      linkedSessionId = newCase.id;
      await supabaseAdmin
        .from("appointments")
        .update({ session_id: linkedSessionId })
        .eq("id", appointment.id);
    } catch (e) {
      console.error("create case for appointment failed", e);
    }
  }

  // Auto-allocate: booking a fact-find with an advisor assigns that session to
  // them so it shows up on their dashboard. Swallow duplicate / missing-table
  // errors (the session_advisors table may not exist until the migration runs).
  const sessionForAlloc = linkedSessionId ?? data.sessionId;
  if (sessionForAlloc) {
    try {
      const { promoteSessionToCase } = await import("@/lib/sessions.functions");
      await promoteSessionToCase(sessionForAlloc);
    } catch (e) {
      console.error("promote session to case failed", e);
    }
    try {
      await supabaseAdmin
        .from("session_advisors")
        .upsert(
          { session_id: sessionForAlloc, advisor_id: advisorId, assigned_by: actingUserId ?? null },
          { onConflict: "session_id,advisor_id" },
        );
    } catch (e) {
      console.error("auto-allocate session failed", e);
    }
  }

  if (leadId) {
    await supabaseAdmin
      .from("introducer_leads")
      .update({ status: "booked", appointment_id: appointment.id })
      .eq("id", leadId);
  }

  let customerIdForIntro = targetCustomerId;
  if (!customerIdForIntro && sessionForAlloc) {
    const { data: sess } = await supabaseAdmin
      .from("interview_sessions")
      .select("customer_id")
      .eq("id", sessionForAlloc)
      .maybeSingle();
    customerIdForIntro = sess?.customer_id ?? null;
  }
  if (customerIdForIntro && introducerId) {
    const { ensureCustomerIntroducerLink } = await import("@/lib/introducer-attribution");
    await ensureCustomerIntroducerLink(
      supabaseAdmin,
      customerIdForIntro,
      introducerId,
      "booking",
    );
  }

  if (data.sendSms !== false && isTwilioConfigured()) {
    try {
      const advisorName = await getAdvisorName(advisorId);
      const message = bookingConfirmationMessage({
        customerName: data.customerName,
        startsAt,
        advisorName,
        bookingUrl: sessionForAlloc ? `${getAppBaseUrl()}/sessions/${sessionForAlloc}` : undefined,
      });
      const { sid } = await sendSms({ to: data.customerPhone, body: message });
      await logSms({
        direction: "outbound",
        from: process.env.TWILIO_PHONE_NUMBER!,
        to: data.customerPhone,
        body: message,
        twilioSid: sid,
        appointmentId: appointment.id,
        leadId: leadId ?? undefined,
      });
    } catch (e) {
      console.error("SMS confirmation failed:", e);
    }
  }

  if (sessionForAlloc && actingUserId) {
    await clearSessionAttention(sessionForAlloc, actingUserId, "appointment_booked");
  }

  return { ...appointment, session_id: linkedSessionId ?? appointment.session_id };
}

export const createAppointment = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => appointmentInput.parse(d))
  .handler(async ({ data }) => bookAppointment(data));

export const createAppointmentAuth = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => appointmentInput.parse(d))
  .handler(async ({ data, context }) => bookAppointment({ ...data, channel: data.channel ?? "direct_booking" }, context.userId));

export const bookSessionAppointment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        sessionId: z.string().uuid(),
        channel: z.enum(["voice", "text"]),
        customerName: z.string().min(2),
        customerPhone: z.string().min(7),
        customerEmail: z.string().email().optional().or(z.literal("")),
        startsAt: z.string().datetime(),
        // Referral slug captured from the introducer link (introducer_ref cookie).
        // Keeps the introducer attached to self-serve bookings.
        slug: z.string().min(1).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: session, error } = await context.supabase
      .from("interview_sessions")
      .select("id, customer_id")
      .eq("id", data.sessionId)
      .single();
    if (error) throw new Error(error.message);
    if (session.customer_id !== context.userId) throw new Error("Forbidden");

    return bookAppointment(
      {
        sessionId: data.sessionId,
        channel: data.channel,
        customerName: data.customerName,
        customerPhone: data.customerPhone,
        customerEmail: data.customerEmail,
        startsAt: data.startsAt,
        slug: data.slug,
      },
      context.userId,
    );
  });

export const getStaffBookingAdvisorId = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => ({
    advisorId: await resolveBookingAdvisorId(context.userId),
  }));

export const bookCustomerAppointmentAsStaff = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        customerId: z.string().uuid(),
        sessionId: z.string().uuid().optional(),
        customerName: z.string().min(2),
        customerPhone: z.string().min(7),
        customerEmail: z.string().email().optional().or(z.literal("")),
        startsAt: z.string().datetime(),
        notes: z.string().max(500).optional(),
        sendSms: z.boolean().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertStaffCanAccessCustomer(context.userId, data.customerId);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let sessionId = data.sessionId ?? null;

    if (sessionId) {
      const { data: session, error } = await supabaseAdmin
        .from("interview_sessions")
        .select("id, customer_id, case_ref")
        .eq("id", sessionId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!session || session.customer_id !== data.customerId) {
        throw new Error("That fact-find does not belong to this customer.");
      }
      if (session.case_ref) {
        throw new Error("This record is already a case — open it from the cases list.");
      }
      const { data: existingAppt } = await supabaseAdmin
        .from("appointments")
        .select("id")
        .eq("session_id", sessionId)
        .eq("status", "confirmed")
        .limit(1);
      if (existingAppt?.length) {
        throw new Error(
          "This fact-find already has an appointment — use Create case to assign a case reference.",
        );
      }
    } else {
      const { data: sessions } = await supabaseAdmin
        .from("interview_sessions")
        .select("id")
        .eq("customer_id", data.customerId)
        .is("deleted_at", null)
        .is("case_ref", null)
        .order("started_at", { ascending: false });
      const candidateIds = (sessions ?? []).map((s) => s.id);
      if (candidateIds.length > 0) {
        const { data: booked } = await supabaseAdmin
          .from("appointments")
          .select("session_id")
          .in("session_id", candidateIds)
          .eq("status", "confirmed");
        const bookedSet = new Set((booked ?? []).map((b) => b.session_id));
        sessionId = candidateIds.find((id) => !bookedSet.has(id)) ?? null;
      }
    }

    const advisorId = await resolveBookingAdvisorId(context.userId);

    return bookAppointment(
      {
        sessionId: sessionId ?? undefined,
        customerId: data.customerId,
        advisorId,
        channel: "direct_booking",
        customerName: data.customerName,
        customerPhone: data.customerPhone,
        customerEmail: data.customerEmail,
        startsAt: data.startsAt,
        notes: data.notes,
        sendSms: data.sendSms ?? true,
      },
      context.userId,
    );
  });

export const getAppointmentForSession = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ sessionId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: session, error: sErr } = await context.supabase
      .from("interview_sessions")
      .select("id, customer_id")
      .eq("id", data.sessionId)
      .single();
    if (sErr) throw new Error(sErr.message);

    const { data: roles } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    const isAdvisor = (roles ?? []).some((r) => r.role === "advisor");
    if (!isAdvisor && session.customer_id !== context.userId) throw new Error("Forbidden");

    const { data: appointment, error } = await context.supabase
      .from("appointments")
      .select("*")
      .eq("session_id", data.sessionId)
      .eq("status", "confirmed")
      .order("starts_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return appointment;
  });

// Advisor/admin-only: the appointment + call-back picture for a single session,
// used by the customer profile "Appointment & call-back" box. Reads via the
// service-role client (after a role check) and tolerates the callback table not
// existing yet. The appointment includes the assigned advisor's display name.
export type SessionBookingDetails = {
  appointment: {
    id: string;
    startsAt: string;
    status: string;
    advisorName: string;
    customerName: string;
    customerPhone: string;
  } | null;
  callback: {
    id: string;
    preferredWindow: string;
    status: string;
    createdAt: string;
  } | null;
};

export const getSessionBooking = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ sessionId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<SessionBookingDetails> => {
    const { data: roles } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    const isStaff = (roles ?? []).some((r) => r.role === "advisor" || r.role === "admin");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Customers may view booking/call-back status for their own session.
    if (!isStaff) {
      const { data: session } = await supabaseAdmin
        .from("interview_sessions")
        .select("customer_id")
        .eq("id", data.sessionId)
        .maybeSingle();
      if (!session || session.customer_id !== context.userId) throw new Error("Forbidden");
    }

    type ApptRow = {
      id: string;
      advisor_id: string | null;
      starts_at: string;
      status: string;
      customer_name: string;
      customer_phone: string;
      session_id: string | null;
    };
    const apptColumns = "id, advisor_id, starts_at, status, customer_name, customer_phone, session_id";

    let appointment: SessionBookingDetails["appointment"] = null;
    {
      // Prefer a session-linked appointment; otherwise fall back to one owned by
      // this customer (booked via the direct "/booking" link with no session
      // link) matched on phone/email, and backfill its session_id so it stays
      // linked and shows in History from then on. Mirrors the call-back fix.
      let appt: ApptRow | null = null;
      {
        const { data: bySession, error } = await supabaseAdmin
          .from("appointments")
          .select(apptColumns)
          .eq("session_id", data.sessionId)
          .order("starts_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (error && !isMissingContactTable(error)) throw new Error(error.message);
        appt = (bySession as ApptRow | null) ?? null;
      }

      if (!appt) {
        const { data: session } = await supabaseAdmin
          .from("interview_sessions")
          .select("customer_id")
          .eq("id", data.sessionId)
          .maybeSingle();
        if (session?.customer_id) {
          const { data: profile } = await supabaseAdmin
            .from("profiles")
            .select("phone, email")
            .eq("id", session.customer_id)
            .maybeSingle();
          const phone = (profile as { phone?: string | null } | null)?.phone ?? null;
          const email = (profile as { email?: string | null } | null)?.email ?? null;
          const variants = ukPhoneVariants(phone);

          const byId = new Map<string, ApptRow>();
          if (variants.length > 0) {
            const { data: byPhone, error } = await supabaseAdmin
              .from("appointments")
              .select(apptColumns)
              .in("customer_phone", variants);
            if (error && !isMissingContactTable(error)) throw new Error(error.message);
            for (const a of (byPhone as ApptRow[] | null) ?? []) byId.set(a.id, a);
          }
          if (email) {
            const { data: byEmail, error } = await supabaseAdmin
              .from("appointments")
              .select(apptColumns)
              .eq("customer_email", email);
            if (error && !isMissingContactTable(error)) throw new Error(error.message);
            for (const a of (byEmail as ApptRow[] | null) ?? []) byId.set(a.id, a);
          }

          appt =
            Array.from(byId.values()).sort(
              (a, b) => new Date(b.starts_at).getTime() - new Date(a.starts_at).getTime(),
            )[0] ?? null;

          // Backfill the session link so it surfaces directly (card + History)
          // going forward. Best-effort — never block the read.
          if (appt && !appt.session_id) {
            try {
              await supabaseAdmin
                .from("appointments")
                .update({ session_id: data.sessionId })
                .eq("id", appt.id);
            } catch (e) {
              console.error("backfill appointment session_id failed", e);
            }
          }
        }
      }

      if (appt) {
        const advisorName = appt.advisor_id ? await getAdvisorName(appt.advisor_id) : "your advisor";
        appointment = {
          id: appt.id,
          startsAt: appt.starts_at,
          status: appt.status,
          advisorName,
          customerName: appt.customer_name,
          customerPhone: appt.customer_phone,
        };
      }
    }

    let callback: SessionBookingDetails["callback"] = null;
    {
      const { data: cb, error } = await supabaseAdmin
        .from("callback_requests")
        .select("id, preferred_window, status, created_at")
        .eq("session_id", data.sessionId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error && !isMissingContactTable(error)) throw new Error(error.message);
      if (cb) {
        callback = {
          id: cb.id,
          preferredWindow: cb.preferred_window,
          status: cb.status,
          createdAt: cb.created_at,
        };
      }
    }

    return { appointment, callback };
  });

export const updateCallbackStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        callbackId: z.string().uuid(),
        status: z.enum(["new", "contacted", "closed"]),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: roles } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    const isStaff = (roles ?? []).some((r) => r.role === "advisor" || r.role === "admin");
    if (!isStaff) throw new Error("Forbidden");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("callback_requests")
      .update({ status: data.status })
      .eq("id", data.callbackId);
    if (error && !isMissingContactTable(error)) throw new Error(error.message);
    return { ok: true };
  });

// Advisor logs a contact ATTEMPT against a call-back (e.g. no answer). The
// call-back stays open ('new') so it keeps flagging as ready-to-review and the
// advisor can keep trying. Records a timestamped History entry only.
export const logCallbackAttempt = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ sessionId: z.string().uuid(), note: z.string().max(200).optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: roles } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    const isStaff = (roles ?? []).some((r) => r.role === "advisor" || r.role === "admin");
    if (!isStaff) throw new Error("Forbidden");

    await appendContactLog(
      data.sessionId,
      context.userId,
      "contact",
      data.note?.trim() || "Call attempted — no answer",
    );
    await clearSessionAttention(data.sessionId, context.userId, "callback_attempt");
    return { ok: true };
  });

// Advisor marks a call-back as handled after speaking to the customer: resolves
// it ('closed'), marks it opened (so it clears from the advisor's Contacts tab)
// and records a timestamped History entry. A 'closed' call-back no longer flags
// as ready-to-review in the advisor Customers list.
export const resolveCallback = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        callbackId: z.string().uuid(),
        sessionId: z.string().uuid(),
        note: z.string().max(200).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: roles } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    const isStaff = (roles ?? []).some((r) => r.role === "advisor" || r.role === "admin");
    if (!isStaff) throw new Error("Forbidden");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("callback_requests")
      .update({ status: "closed" })
      .eq("id", data.callbackId);
    if (error && !isMissingContactTable(error)) throw new Error(error.message);

    try {
      await supabaseAdmin
        .from("advisor_contact_views")
        .upsert(
          { advisor_id: context.userId, contact_type: "callback", contact_id: data.callbackId },
          { onConflict: "advisor_id,contact_type,contact_id" },
        );
    } catch (e) {
      console.error("mark callback opened on resolve failed", e);
    }

    await appendContactLog(
      data.sessionId,
      context.userId,
      "contact",
      data.note?.trim() || "Spoke to customer re: call-back",
    );
    await clearSessionAttention(data.sessionId, context.userId, "callback_resolved");
    return { ok: true };
  });

// ── Call-back requests ──────────────────────────────────────────────────────
// An alternative to booking a slot: the customer asks their advisor to call them
// back within a preferred window. Persists to callback_requests, auto-allocates
// the session to the advisor, logs a timeline entry and (best-effort) texts a
// confirmation. Tolerant of the migration not having been applied yet.

const callbackWindowEnum = z.enum(["9-12", "12-4", "4-8"]);

async function createCallbackRequest(
  data: {
    sessionId?: string;
    customerId?: string;
    customerName: string;
    customerPhone: string;
    customerEmail?: string;
    window: "9-12" | "12-4" | "4-8";
  },
): Promise<{ ok: true }> {
  const advisorId = await getPrimaryAdvisorId();
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  // Attach the request to a fact-find so it surfaces against the customer's
  // record in the advisor portal. The direct "/booking" path doesn't pass a
  // sessionId, so fall back to the customer's most recent fact-find.
  let sessionId = data.sessionId ?? null;
  if (!sessionId && data.customerId) {
    try {
      const { data: latest } = await supabaseAdmin
        .from("interview_sessions")
        .select("id")
        .eq("customer_id", data.customerId)
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      sessionId = latest?.id ?? null;
    } catch (e) {
      console.error("resolve customer session for callback failed", e);
    }
  }

  const { data: callback, error } = await supabaseAdmin
    .from("callback_requests")
    .insert({
      session_id: sessionId,
      customer_id: data.customerId ?? null,
      advisor_id: advisorId,
      customer_name: data.customerName,
      customer_phone: data.customerPhone,
      customer_email: data.customerEmail || null,
      preferred_window: data.window,
      status: "new",
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  // Auto-allocate the fact-find to the advisor so it surfaces on their
  // dashboard. Best-effort. The call-back itself is the History source (merged
  // from callback_requests), so we deliberately do NOT also write a
  // customer_contact_log row here — that double-logged it in History.
  if (sessionId) {
    try {
      await supabaseAdmin
        .from("session_advisors")
        .upsert(
          { session_id: sessionId, advisor_id: advisorId, assigned_by: data.customerId ?? null },
          { onConflict: "session_id,advisor_id" },
        );
    } catch (e) {
      console.error("auto-allocate session (callback) failed", e);
    }
  }

  if (isTwilioConfigured()) {
    try {
      const advisorName = await getAdvisorName(advisorId);
      const message = callbackConfirmationMessage({
        customerName: data.customerName,
        window: data.window,
        advisorName,
      });
      const { sid } = await sendSms({ to: data.customerPhone, body: message });
      await logSms({
        direction: "outbound",
        from: process.env.TWILIO_PHONE_NUMBER!,
        to: data.customerPhone,
        body: message,
        twilioSid: sid,
      });
    } catch (e) {
      console.error("callback confirmation SMS failed:", e);
    }
  }

  void callback;
  return { ok: true };
}

export const requestSessionCallback = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        sessionId: z.string().uuid(),
        customerName: z.string().min(2),
        customerPhone: z.string().min(7),
        customerEmail: z.string().email().optional().or(z.literal("")),
        window: callbackWindowEnum,
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: session, error } = await context.supabase
      .from("interview_sessions")
      .select("id, customer_id")
      .eq("id", data.sessionId)
      .single();
    if (error) throw new Error(error.message);
    if (session.customer_id !== context.userId) throw new Error("Forbidden");

    return createCallbackRequest({
      sessionId: data.sessionId,
      customerId: context.userId,
      customerName: data.customerName,
      customerPhone: data.customerPhone,
      customerEmail: data.customerEmail,
      window: data.window,
    });
  });

export const requestCallbackAuth = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        customerName: z.string().min(2),
        customerPhone: z.string().min(7),
        customerEmail: z.string().email().optional().or(z.literal("")),
        window: callbackWindowEnum,
      })
      .parse(d),
  )
  .handler(async ({ data, context }) =>
    createCallbackRequest({
      customerId: context.userId,
      customerName: data.customerName,
      customerPhone: data.customerPhone,
      customerEmail: data.customerEmail,
      window: data.window,
    }),
  );

// Advisor portal: appointments + call-backs surfaced together, each flagged with
// whether THIS advisor has opened it yet (so new/unopened contacts highlight).
// Degrades gracefully if the callback/views tables aren't present yet.
export type AdvisorContact = {
  kind: "appointment" | "callback";
  id: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string | null;
  sessionId: string | null;
  startsAt: string | null;
  window: string | null;
  status: string | null;
  createdAt: string;
  opened: boolean;
};

function isMissingContactTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const code = error.code ?? "";
  const msg = (error.message ?? "").toLowerCase();
  return (
    code === "42P01" ||
    code === "42703" ||
    code === "PGRST204" ||
    code === "PGRST205" ||
    msg.includes("does not exist") ||
    msg.includes("schema cache")
  );
}

// Candidate string forms a UK number might have been stored as. Appointments
// have no customer FK, so a direct-booking appointment is matched back to the
// fact-find's owning customer by phone (and email). Covers the raw value, the
// normalised +44 form and the 0-leading national form, with/without spaces.
function ukPhoneVariants(phone: string | null | undefined): string[] {
  const raw = (phone ?? "").trim();
  if (!raw) return [];
  const variants = new Set<string>([raw, raw.replace(/\s+/g, "")]);
  try {
    const normalised = normaliseUkPhone(raw);
    variants.add(normalised);
    if (normalised.startsWith("+44")) variants.add(`0${normalised.slice(3)}`);
  } catch {
    // ignore unparseable numbers
  }
  return Array.from(variants).filter(Boolean);
}

// Append a typed entry to the customer contact timeline (advisor-only History).
// Best-effort: silently degrades if the table isn't present yet.
async function appendContactLog(
  sessionId: string,
  authorId: string | null,
  entryType: "contact" | "note" | "next_contact_set" | "appointment" | "callback",
  body: string | null,
): Promise<void> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("customer_contact_log")
      .insert({ session_id: sessionId, author_id: authorId, entry_type: entryType, body });
    if (error && !isMissingContactTable(error)) throw new Error(error.message);
  } catch (e) {
    console.error("append contact log failed", e);
  }
}

export const listAdvisorContacts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AdvisorContact[]> => {
    const { data: roles } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    if (!(roles ?? []).some((r) => r.role === "advisor")) throw new Error("Forbidden");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Which appointments/callbacks has this advisor already opened?
    const opened = new Set<string>();
    {
      const { data, error } = await supabaseAdmin
        .from("advisor_contact_views")
        .select("contact_type, contact_id")
        .eq("advisor_id", context.userId);
      if (error && !isMissingContactTable(error)) throw new Error(error.message);
      for (const v of data ?? []) opened.add(`${v.contact_type}:${v.contact_id}`);
    }

    const contacts: AdvisorContact[] = [];

    {
      const { data: appts, error } = await supabaseAdmin
        .from("appointments")
        .select("id, customer_name, customer_phone, customer_email, session_id, starts_at, status, created_at")
        .eq("advisor_id", context.userId)
        .order("starts_at", { ascending: true });
      if (error && !isMissingContactTable(error)) throw new Error(error.message);
      for (const a of appts ?? []) {
        contacts.push({
          kind: "appointment",
          id: a.id,
          customerName: a.customer_name,
          customerPhone: a.customer_phone,
          customerEmail: a.customer_email ?? null,
          sessionId: a.session_id ?? null,
          startsAt: a.starts_at,
          window: null,
          status: a.status,
          createdAt: a.created_at,
          opened: opened.has(`appointment:${a.id}`),
        });
      }
    }

    {
      const { data: callbacks, error } = await supabaseAdmin
        .from("callback_requests")
        .select("id, customer_name, customer_phone, customer_email, session_id, preferred_window, status, created_at")
        .eq("advisor_id", context.userId)
        .order("created_at", { ascending: false });
      if (error && !isMissingContactTable(error)) throw new Error(error.message);
      for (const c of callbacks ?? []) {
        contacts.push({
          kind: "callback",
          id: c.id,
          customerName: c.customer_name,
          customerPhone: c.customer_phone,
          customerEmail: c.customer_email ?? null,
          sessionId: c.session_id ?? null,
          startsAt: null,
          window: c.preferred_window,
          status: c.status,
          createdAt: c.created_at,
          opened: opened.has(`callback:${c.id}`),
        });
      }
    }

    // Unopened first, then newest first.
    contacts.sort((a, b) => {
      if (a.opened !== b.opened) return a.opened ? 1 : -1;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
    return contacts;
  });

export const markContactOpened = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({ contactType: z.enum(["appointment", "callback"]), contactId: z.string().uuid() })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: roles } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    if (!(roles ?? []).some((r) => r.role === "advisor")) throw new Error("Forbidden");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("advisor_contact_views")
      .upsert(
        { advisor_id: context.userId, contact_type: data.contactType, contact_id: data.contactId },
        { onConflict: "advisor_id,contact_type,contact_id" },
      );
    if (error && !isMissingContactTable(error)) throw new Error(error.message);
    return { ok: true };
  });

export const listAdvisorAppointments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: roles } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    if (!(roles ?? []).some((r) => r.role === "advisor")) throw new Error("Forbidden");

    const { data, error } = await context.supabase
      .from("appointments")
      .select("*")
      .gte("starts_at", new Date().toISOString())
      .eq("status", "confirmed")
      .order("starts_at", { ascending: true })
      .limit(50);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const listIntroducerAppointments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: introducer, error: introErr } = await context.supabase
      .from("introducers")
      .select("id")
      .eq("user_id", context.userId)
      .single();
    if (introErr) throw new Error(introErr.message);

    const { data, error } = await context.supabase
      .from("appointments")
      .select("*")
      .eq("introducer_id", introducer.id)
      .order("starts_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const sendLeadBookingSms = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ leadId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    if (!isTwilioConfigured()) throw new Error("SMS is not configured yet. Add Twilio credentials to your server environment.");

    const { data: introducer, error: introErr } = await context.supabase
      .from("introducers")
      .select("id, company_name, slug")
      .eq("user_id", context.userId)
      .single();
    if (introErr) throw new Error(introErr.message);

    const { data: lead, error: leadErr } = await context.supabase
      .from("introducer_leads")
      .select("*")
      .eq("id", data.leadId)
      .eq("introducer_id", introducer.id)
      .single();
    if (leadErr) throw new Error(leadErr.message);
    if (!lead.customer_phone) throw new Error("Lead has no phone number.");

    const bookUrl = `${getAppBaseUrl()}/book/${introducer.slug}?lead=${lead.id}`;
    const body = textChannelInviteMessage({
      customerName: lead.customer_name,
      bookUrl,
      introducerName: introducer.company_name,
    });

    const { sid } = await sendSms({ to: lead.customer_phone, body });
    await logSms({
      direction: "outbound",
      from: process.env.TWILIO_PHONE_NUMBER!,
      to: lead.customer_phone,
      body,
      twilioSid: sid,
      leadId: lead.id,
    });

    await context.supabase
      .from("introducer_leads")
      .update({ channel: "text", status: "contacted" })
      .eq("id", lead.id);

    return { ok: true, bookUrl };
  });

export const getLeadForBooking = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) =>
    z.object({ leadId: z.string().uuid(), slug: z.string().min(1) }).parse(d),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: lead, error } = await supabaseAdmin
      .from("introducer_leads")
      .select("id, customer_name, customer_phone, customer_email, introducer_id")
      .eq("id", data.leadId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!lead) return null;

    const { data: introducer } = await supabaseAdmin
      .from("introducers")
      .select("slug")
      .eq("id", lead.introducer_id)
      .maybeSingle();
    if (!introducer || introducer.slug !== data.slug) return null;

    return {
      id: lead.id,
      customerName: lead.customer_name,
      customerPhone: lead.customer_phone ?? "",
      customerEmail: lead.customer_email ?? "",
    };
  });
