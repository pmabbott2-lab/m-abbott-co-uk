import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import {
  bookingConfirmationMessage,
  getAppBaseUrl,
  isTwilioConfigured,
  sendSms,
  textChannelInviteMessage,
} from "@/lib/sms.server";

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
    z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).parse(d),
  )
  .handler(async ({ data }) => {
    const advisorId = await getPrimaryAdvisorId();
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
  userId?: string,
) {
  const advisorId = await getPrimaryAdvisorId();
  const startsAt = new Date(data.startsAt);
  const endsAt = new Date(startsAt.getTime() + SLOT_MINUTES * 60 * 1000);

  const introducer = await resolveIntroducer(data.slug);
  let leadSource: "referral_link" | "introducer_portal" | "web" = "web";
  let referralChannel: "direct_booking" | "manual" = "direct_booking";
  let introducerId: string | null = introducer?.id ?? null;
  const leadId: string | null = data.leadId ?? null;

  if (userId) {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: roles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    if ((roles ?? []).some((r) => r.role === "introducer")) {
      leadSource = "introducer_portal";
      referralChannel = "manual";
      if (!introducerId) {
        const { data: ownIntro } = await supabaseAdmin
          .from("introducers")
          .select("id")
          .eq("user_id", userId)
          .maybeSingle();
        introducerId = ownIntro?.id ?? null;
      }
    }
  }

  if (introducer && !userId) {
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

  if (leadId) {
    await supabaseAdmin
      .from("introducer_leads")
      .update({ status: "booked", appointment_id: appointment.id })
      .eq("id", leadId);
  }

  if (data.sendSms !== false && isTwilioConfigured()) {
    try {
      const message = bookingConfirmationMessage({
        customerName: data.customerName,
        startsAt,
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

  return appointment;
}

export const createAppointment = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => appointmentInput.parse(d))
  .handler(async ({ data }) => bookAppointment(data));

export const createAppointmentAuth = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => appointmentInput.parse(d))
  .handler(async ({ data, context }) => bookAppointment(data, context.userId));

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
