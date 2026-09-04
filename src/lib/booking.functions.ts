import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import {
  bookingConfirmationMessage,
  callbackConfirmationMessage,
  getAppBaseUrl,
  getSmsSenderLabel,
  isTwilioConfigured,
  normaliseUkPhone,
  sendSms,
  textChannelInviteMessage,
} from "@/lib/sms.server";
import { clearSessionAttention, assertStaffCanAccessCustomer } from "@/lib/sessions.functions";

const SLOT_MINUTES = 30;
const BOOKING_HORIZON_DAYS = 28;

/** Auth email for customers without an address — phone-only bookings. */
export function emailForCustomerAccount(email: string, phone: string): string {
  const trimmed = email.trim().toLowerCase();
  if (trimmed) return trimmed;
  const digits = phone.replace(/\D/g, "");
  return `phone+${digits}@customers.mortgagehub.local`;
}

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
  const { data: advisors, error } = await supabaseAdmin
    .from("user_roles")
    .select("user_id")
    .eq("role", "advisor");
  if (error) throw new Error(error.message);
  const ids = [...new Set((advisors ?? []).map((a) => a.user_id).filter(Boolean))];
  if (ids.length === 0) {
    throw new Error("No advisor configured. Add an advisor role in Supabase first.");
  }
  if (ids.length === 1) return ids[0]!;

  // Prefer ADMIN_EMAILS owners who also hold the advisor role (stable “home” diary).
  const adminEmails = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (adminEmails.length > 0) {
    const { data: profiles } = await supabaseAdmin
      .from("profiles")
      .select("id, email")
      .in("id", ids);
    const owner = (profiles ?? []).find(
      (p) => p.email && adminEmails.includes(p.email.trim().toLowerCase()),
    );
    if (owner?.id) return owner.id;
  }

  // Prefer an advisor with Teams calendar linked so bookings land where Outlook sync works.
  const { data: linked } = await supabaseAdmin
    .from("advisor_profiles")
    .select("user_id")
    .in("user_id", ids)
    .eq("teams_calendar_enabled", true)
    .order("teams_calendar_linked_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (linked?.user_id) return linked.user_id;

  // Deterministic fallback (Postgres limit(1) without ORDER BY is not stable).
  return [...ids].sort()[0]!;
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

function slugifyStaffName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

/** Introducer row for staff booking attribution (does not grant introducer portal role). */
async function ensureStaffIntroducerRecord(staffUserId: string): Promise<string> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: existing } = await supabaseAdmin
    .from("introducers")
    .select("id, active")
    .eq("user_id", staffUserId)
    .maybeSingle();
  if (existing?.id) {
    if (existing.active === false) {
      await supabaseAdmin.from("introducers").update({ active: true }).eq("id", existing.id);
    }
    return existing.id;
  }

  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("full_name, email")
    .eq("id", staffUserId)
    .maybeSingle();
  const ownName = profile?.full_name?.trim() || profile?.email?.split("@")[0] || "advisor";
  const root = slugifyStaffName(ownName) || "advisor";
  let slug = root;
  for (let i = 0; i < 100; i += 1) {
    const candidate = i === 0 ? root : `${root}-${i}`;
    const { data: clash } = await supabaseAdmin
      .from("introducers")
      .select("id")
      .eq("slug", candidate)
      .maybeSingle();
    if (!clash) {
      slug = candidate;
      break;
    }
  }

  const { data: inserted, error } = await supabaseAdmin
    .from("introducers")
    .insert({
      user_id: staffUserId,
      company_name: ownName,
      slug,
      contact_email: profile?.email ?? null,
      active: true,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return inserted.id;
}

async function resolveOrCreateCustomerProfile(data: {
  customerName: string;
  customerPhone: string;
  customerEmail: string;
}): Promise<string> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const phone = normaliseUkPhone(data.customerPhone);
  const email = data.customerEmail.trim().toLowerCase();
  const authEmail = emailForCustomerAccount(email, phone);

  if (email) {
    const { data: byEmail } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .ilike("email", email)
      .maybeSingle();
    if (byEmail?.id) {
      await supabaseAdmin
        .from("profiles")
        .update({ full_name: data.customerName, phone, email })
        .eq("id", byEmail.id);
      return byEmail.id;
    }
  }

  if (phone) {
    const { data: byPhone } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("phone", phone)
      .maybeSingle();
    if (byPhone?.id) {
      await supabaseAdmin
        .from("profiles")
        .update({ full_name: data.customerName, email: email || undefined })
        .eq("id", byPhone.id);
      return byPhone.id;
    }
  }

  const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
    email: authEmail,
    email_confirm: true,
    user_metadata: { full_name: data.customerName, phone },
  });
  if (error) throw new Error(error.message);

  const userId = created.user.id;
  await supabaseAdmin.from("profiles").upsert({
    id: userId,
    full_name: data.customerName,
    email: email || null,
    phone,
  });
  await supabaseAdmin
    .from("user_roles")
    .upsert({ user_id: userId, role: "customer" }, { onConflict: "user_id,role" });
  return userId;
}

async function sendBookingConfirmations(opts: {
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  startsAt: Date;
  advisorName: string;
  sessionId?: string | null;
  appointmentId?: string;
}) {
  const setupUrl = opts.sessionId
    ? `${getAppBaseUrl()}/sessions/${opts.sessionId}`
    : `${getAppBaseUrl()}/home`;
  const message = bookingConfirmationMessage({
    customerName: opts.customerName,
    startsAt: opts.startsAt,
    advisorName: opts.advisorName,
    bookingUrl: setupUrl,
  });

  if (isTwilioConfigured()) {
    try {
      const { sid } = await sendSms({ to: opts.customerPhone, body: message });
      await logSms({
        direction: "outbound",
        from: getSmsSenderLabel(),
        to: opts.customerPhone,
        body: message,
        twilioSid: sid,
        appointmentId: opts.appointmentId,
      });
    } catch (e) {
      console.error("SMS confirmation failed:", e);
    }
  }

  if (opts.customerEmail) {
    console.info(
      `[booking-email] To: ${opts.customerEmail} | ${opts.customerName} | ${setupUrl}`,
    );
  }
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
    } else if (
      (roles ?? []).some((r) => r.role === "advisor" || r.role === "admin") &&
      data.channel === "direct_booking"
    ) {
      // Staff booking: credit the acting advisor/admin as introducer on the case.
      leadSource = "introducer_portal";
      referralChannel = "manual";
      introducerId = await ensureStaffIntroducerRecord(actingUserId);
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
    try {
      const { ensureWelcomeCallTask } = await import("@/lib/staff-contact-tasks.server");
      await ensureWelcomeCallTask(supabaseAdmin, sessionForAlloc, actingUserId ?? advisorId);
    } catch (e) {
      console.error("welcome call task on booking failed", e);
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

  if (data.sendSms !== false || data.customerEmail) {
    try {
      const advisorName = await getAdvisorName(advisorId);
      await sendBookingConfirmations({
        customerName: data.customerName,
        customerPhone: data.customerPhone,
        customerEmail: data.customerEmail || "",
        startsAt,
        advisorName,
        sessionId: sessionForAlloc,
        appointmentId: appointment.id,
      });
    } catch (e) {
      console.error("booking confirmation failed:", e);
    }
  }

  if (sessionForAlloc && actingUserId) {
    await clearSessionAttention(sessionForAlloc, actingUserId, "appointment_booked");
  }

  try {
    const { syncAppointmentToTeams } = await import("@/lib/teams-calendar.server");
    await syncAppointmentToTeams({
      appointmentId: appointment.id,
      advisorId,
      customerName: data.customerName,
      customerEmail: data.customerEmail || null,
      customerPhone: data.customerPhone,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      notes: data.notes || null,
    });
  } catch (e) {
    console.error("Teams calendar sync failed", e);
  }

  return { ...appointment, session_id: linkedSessionId ?? appointment.session_id };
}

export const createAppointment = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => appointmentInput.parse(d))
  .handler(async ({ data }) => bookAppointment(data));

const customerAppointmentSignupInput = z.object({
  customerName: z.string().min(2),
  customerPhone: z.string().min(7),
  customerEmail: z.string().email().optional().or(z.literal("")),
  startsAt: z.string().datetime(),
  password: z.string().min(6).optional(),
  journey: z.enum(["voice", "chat", "book"]).optional(),
  slug: z.string().min(1).optional(),
});

export const customerAppointmentSignup = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => customerAppointmentSignupInput.parse(d))
  .handler(async ({ data }) => {
    const phone = normaliseUkPhone(data.customerPhone);
    const emailRaw = data.customerEmail?.trim().toLowerCase() || "";
    const password = data.password?.trim() || "";
    const authEmail = emailForCustomerAccount(emailRaw, phone);

    const userId = await resolveOrCreateCustomerProfile({
      customerName: data.customerName,
      customerPhone: data.customerPhone,
      customerEmail: emailRaw,
    });

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    if (password.length >= 6) {
      const { error: pwErr } = await supabaseAdmin.auth.admin.updateUserById(userId, { password });
      if (pwErr) throw new Error(pwErr.message);
    }

    const channel =
      data.journey === "voice"
        ? "voice"
        : data.journey === "chat"
          ? "text"
          : "direct_booking";

    await bookAppointment(
      {
        customerId: userId,
        customerName: data.customerName,
        customerPhone: data.customerPhone,
        customerEmail: emailRaw,
        startsAt: data.startsAt,
        channel,
        slug: data.slug,
      },
      userId,
    );

    let needsSmsCode = false;
    if (password.length < 6) {
      if (!isTwilioConfigured()) {
        throw new Error(
          "Appointment saved but SMS sign-in is not configured. Set a password or contact support.",
        );
      }
      const { storeLoginSmsCode } = await import("@/lib/auth-sms.store.server");
      const code = String(Math.floor(100000 + Math.random() * 900000));
      storeLoginSmsCode(userId, code);
      const when = new Date(data.startsAt);
      const whenLabel = when.toLocaleString("en-GB", {
        weekday: "short",
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      });
      await sendSms({
        to: phone,
        body: `Hi ${data.customerName}, your mortgage appointment is confirmed for ${whenLabel}. Sign-in code: ${code} (10 min).`,
      });
      needsSmsCode = true;
    }

    return {
      signInEmail: password.length >= 6 ? authEmail : undefined,
      needsSmsCode,
      bookedAt: data.startsAt,
    };
  });

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
        customerEmail: z.string().email(),
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

/** Book a follow-up into an advisor diary for an existing case (relationship renewals). */
export const bookCaseFollowUpAppointment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        sessionId: z.string().uuid(),
        customerId: z.string().uuid(),
        advisorId: z.string().uuid().optional(),
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
    const email = (context.claims as { email?: string }).email;
    const { resolveAdminAccess } = await import("@/lib/admin.functions");
    const { canViewRelationship } = await import("@/lib/admin-access");
    const access = await resolveAdminAccess(context.userId, email);
    if (!canViewRelationship(access)) {
      await assertStaffCanAccessCustomer(context.userId, data.customerId);
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: session, error } = await supabaseAdmin
      .from("interview_sessions")
      .select("id, customer_id, case_ref")
      .eq("id", data.sessionId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!session || session.customer_id !== data.customerId) {
      throw new Error("That case does not belong to this customer.");
    }
    if (!session.case_ref) {
      throw new Error("Open a case before booking a relationship follow-up.");
    }

    let advisorId = data.advisorId ?? null;
    if (!advisorId) {
      const { data: alloc } = await supabaseAdmin
        .from("session_advisors")
        .select("advisor_id")
        .eq("session_id", data.sessionId)
        .limit(1)
        .maybeSingle();
      advisorId = alloc?.advisor_id ?? null;
    }
    if (!advisorId) {
      advisorId = await resolveBookingAdvisorId(context.userId);
    }

    return bookAppointment(
      {
        sessionId: data.sessionId,
        customerId: data.customerId,
        advisorId,
        channel: "direct_booking",
        customerName: data.customerName,
        customerPhone: data.customerPhone,
        customerEmail: data.customerEmail || undefined,
        startsAt: data.startsAt,
        notes: data.notes ?? "Relationship renewal follow-up",
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
      if (cb && cb.status === "new") {
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
        from: getSmsSenderLabel(),
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
  kind: "appointment" | "callback" | "phone_call" | "staff_task" | "abandoned";
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
  /** Internal task type when kind === staff_task */
  taskType?: "welcome_call" | "next_contact";
  /** Due date for staff_task sorting and overdue styling */
  dueAt?: string | null;
  completedAt?: string | null;
  /** True when this row came from an inbound office-line voicemail. */
  isVoicemail?: boolean;
  /** No advisor assigned yet — owner/supervisor/admin only. */
  unallocated?: boolean;
  phoneCallId?: string | null;
  summary?: string | null;
  aiStatus?: string | null;
  /** Marked contacted — shown greyed until archive window expires. */
  contacted?: boolean;
  contactedAt?: string | null;
  customerId?: string | null;
  introducerCode?: string | null;
  introducerCompany?: string | null;
  /** Allocated / booking advisor — shown in Contacts summary. */
  advisorId?: string | null;
  advisorName?: string | null;
  /** Fact-find channel for abandoned leads. */
  channel?: string | null;
  /** Last interview section for abandoned leads. */
  lastSection?: string | null;
};

/** Items stay visible (greyed) for 24h after Contacted, then drop from Contacts/CRM. */
export const CONTACT_ARCHIVE_MS = 24 * 60 * 60 * 1000;

export function contactArchiveVisible(contactedAt: string | null | undefined): boolean {
  if (!contactedAt) return true;
  return Date.now() - new Date(contactedAt).getTime() < CONTACT_ARCHIVE_MS;
}

export function isContactArchived(contactedAt: string | null | undefined): boolean {
  return Boolean(contactedAt) && contactArchiveVisible(contactedAt);
}

export type SessionCrmContactItem = {
  contactType: "callback" | "phone_call";
  id: string;
  phoneCallId?: string | null;
  title: string;
  subtitle: string;
  summary?: string | null;
  aiStatus?: string | null;
  contacted: boolean;
  contactedAt?: string | null;
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
    const email = (context.claims as { email?: string }).email;
    const { resolveAdminAccess } = await import("@/lib/admin.functions");
    const adminAccess = await resolveAdminAccess(context.userId, email);
    const isStaffAdmin = adminAccess.isOwner || adminAccess.isSupervisor || adminAccess.isAdmin;

    const { data: roles } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    const isAdvisor = (roles ?? []).some((r) => r.role === "advisor");
    if (!isAdvisor && !isStaffAdmin) throw new Error("Forbidden");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const opened = new Set<string>();
    const contactedAtByKey = new Map<string, string>();
    {
      const { data, error } = await supabaseAdmin
        .from("advisor_contact_views")
        .select("contact_type, contact_id, contacted_at")
        .eq("advisor_id", context.userId);
      if (error && !isMissingContactTable(error)) throw new Error(error.message);
      for (const v of data ?? []) {
        const row = v as { contact_type: string; contact_id: string; contacted_at?: string | null };
        opened.add(`${row.contact_type}:${row.contact_id}`);
        if (row.contacted_at) contactedAtByKey.set(`${row.contact_type}:${row.contact_id}`, row.contacted_at);
      }
    }

    const allocatedSessionIds = new Set<string>();
    if (isAdvisor && !isStaffAdmin) {
      const { data: allocs } = await supabaseAdmin
        .from("session_advisors")
        .select("session_id")
        .eq("advisor_id", context.userId);
      for (const a of allocs ?? []) {
        if (a.session_id) allocatedSessionIds.add(a.session_id);
      }
    }

    const contacts: AdvisorContact[] = [];

    {
      let apptQuery = supabaseAdmin
        .from("appointments")
        .select("id, customer_name, customer_phone, customer_email, session_id, starts_at, status, created_at, advisor_id")
        .order("starts_at", { ascending: true });
      if (!isStaffAdmin) {
        apptQuery = apptQuery.eq("advisor_id", context.userId);
      }
      const { data: appts, error } = await apptQuery;
      if (error && !isMissingContactTable(error)) throw new Error(error.message);
      for (const a of appts ?? []) {
        const contactedAt = contactedAtByKey.get(`appointment:${a.id}`) ?? null;
        if (contactedAt && !contactArchiveVisible(contactedAt)) continue;

        let customerId: string | null = null;
        if (a.session_id) {
          const { data: sess } = await supabaseAdmin
            .from("interview_sessions")
            .select("customer_id")
            .eq("id", a.session_id)
            .maybeSingle();
          customerId = sess?.customer_id ?? null;
        }

        contacts.push({
          kind: "appointment",
          id: a.id,
          customerName: a.customer_name,
          customerPhone: a.customer_phone,
          customerEmail: a.customer_email ?? null,
          sessionId: a.session_id ?? null,
          customerId,
          startsAt: a.starts_at,
          window: null,
          status: a.status,
          createdAt: a.created_at,
          opened: opened.has(`appointment:${a.id}`),
          contacted: isContactArchived(contactedAt),
          contactedAt,
          advisorId: (a as { advisor_id?: string | null }).advisor_id ?? null,
        });
      }
    }

    const phoneCallMeta = new Map<string, { summary: string | null; aiStatus: string }>();
    {
      let cbQuery = supabaseAdmin
        .from("callback_requests")
        .select(
          "id, customer_name, customer_phone, customer_email, session_id, preferred_window, status, created_at, advisor_id, notes, phone_call_id",
        )
        .in("status", ["new", "contacted"])
        .order("created_at", { ascending: false });
      const { data: callbacks, error } = await cbQuery;
      if (error && !isMissingContactTable(error)) throw new Error(error.message);

      const callIds = (callbacks ?? [])
        .map((c) => (c as { phone_call_id?: string | null }).phone_call_id)
        .filter(Boolean) as string[];
      if (callIds.length > 0) {
        const { data: calls } = await supabaseAdmin
          .from("phone_calls")
          .select("id, summary, ai_status")
          .in("id", callIds);
        for (const call of calls ?? []) {
          phoneCallMeta.set(call.id, { summary: call.summary, aiStatus: call.ai_status });
        }
      }

      for (const c of callbacks ?? []) {
        const row = c as {
          id: string;
          customer_name: string;
          customer_phone: string;
          customer_email: string | null;
          session_id: string | null;
          preferred_window: string;
          status: string;
          created_at: string;
          advisor_id: string | null;
          notes: string | null;
          phone_call_id?: string | null;
        };

        const isVoicemail = (row.notes ?? "").toLowerCase().includes("voicemail");
        // Unallocated inbound: no advisor yet (unknown caller, or matched customer without advisor).
        const unallocated = row.advisor_id == null && (isVoicemail || row.session_id == null);

        if (!isStaffAdmin) {
          const mine =
            row.advisor_id === context.userId ||
            (row.session_id != null && allocatedSessionIds.has(row.session_id));
          if (!mine) continue;
          if (unallocated && row.advisor_id == null) continue;
        }

        const phoneCallId = row.phone_call_id ?? null;
        const meta = phoneCallId ? phoneCallMeta.get(phoneCallId) : undefined;
        const contactedAt = contactedAtByKey.get(`callback:${row.id}`) ?? null;
        if (contactedAt && !contactArchiveVisible(contactedAt)) continue;

        let customerId: string | null = null;
        if (row.session_id) {
          const { data: sess } = await supabaseAdmin
            .from("interview_sessions")
            .select("customer_id")
            .eq("id", row.session_id)
            .maybeSingle();
          customerId = sess?.customer_id ?? null;
        }

        contacts.push({
          kind: "callback",
          id: row.id,
          customerName: row.customer_name,
          customerPhone: row.customer_phone,
          customerEmail: row.customer_email,
          sessionId: row.session_id,
          customerId,
          startsAt: null,
          window: row.preferred_window,
          status: row.status,
          createdAt: row.created_at,
          opened: opened.has(`callback:${row.id}`),
          isVoicemail,
          unallocated: unallocated && isStaffAdmin,
          phoneCallId,
          summary: meta?.summary ?? null,
          aiStatus: meta?.aiStatus ?? null,
          contacted: isContactArchived(contactedAt),
          contactedAt,
          advisorId: row.advisor_id,
        });
      }
    }

    const callbackPhoneCallIds = new Set(
      contacts.map((c) => c.phoneCallId).filter(Boolean) as string[],
    );

    {
      let callQuery = supabaseAdmin
        .from("phone_calls")
        .select(
          "id, session_id, advisor_id, call_kind, direction, from_number, to_number, started_at, summary, ai_status, status",
        )
        .not("session_id", "is", null)
        .in("call_kind", ["outbound", "inbound_voicemail"])
        .order("started_at", { ascending: false })
        .limit(40);
      const { data: phoneCalls, error } = await callQuery;
      if (error && !isMissingContactTable(error)) throw new Error(error.message);

      for (const call of phoneCalls ?? []) {
        if (call.call_kind === "inbound_voicemail" && callbackPhoneCallIds.has(call.id)) continue;

        const sessionId = call.session_id as string;
        if (!isStaffAdmin && !allocatedSessionIds.has(sessionId)) continue;

        const contactedAt = contactedAtByKey.get(`phone_call:${call.id}`) ?? null;
        if (contactedAt && !contactArchiveVisible(contactedAt)) continue;

        const isVoicemail = call.call_kind === "inbound_voicemail";
        const phone = isVoicemail ? call.from_number : call.to_number;
        let customerName = "Customer";
        const { data: session } = await supabaseAdmin
          .from("interview_sessions")
          .select("customer_id, case_ref")
          .eq("id", sessionId)
          .maybeSingle();
        if (session?.customer_id) {
          const { data: prof } = await supabaseAdmin
            .from("profiles")
            .select("full_name")
            .eq("id", session.customer_id)
            .maybeSingle();
          customerName = prof?.full_name?.trim() || customerName;
        }

        contacts.push({
          kind: "phone_call",
          id: call.id,
          customerName,
          customerPhone: phone ?? "Unknown",
          customerEmail: null,
          sessionId,
          customerId: session?.customer_id ?? null,
          startsAt: null,
          window: null,
          status: call.status,
          createdAt: call.started_at,
          opened: opened.has(`phone_call:${call.id}`),
          isVoicemail,
          unallocated: false,
          phoneCallId: call.id,
          summary: call.summary,
          aiStatus: call.ai_status,
          contacted: isContactArchived(contactedAt),
          contactedAt,
          advisorId: (call as { advisor_id?: string | null }).advisor_id ?? null,
        });
      }
    }

    const activeSessionIds = new Set(
      contacts
        .filter((c) => c.sessionId && (c.kind === "appointment" || c.kind === "callback"))
        .map((c) => c.sessionId as string),
    );

    {
      // Abandoned leads: in-progress fact-finds with email and/or phone so staff can re-engage.
      let skipAbandoned = false;
      let sessQuery = supabaseAdmin
        .from("interview_sessions")
        .select("id, customer_id, status, started_at, updated_at, created_at, channel, current_section")
        .eq("status", "in_progress")
        .order("updated_at", { ascending: false })
        .limit(150);
      if (!isStaffAdmin) {
        const ids = [...allocatedSessionIds];
        if (ids.length === 0) skipAbandoned = true;
        else sessQuery = sessQuery.in("id", ids);
      }

      if (!skipAbandoned) {
        let { data: abandonedSessions, error: abandonedErr } = await sessQuery;
        if (abandonedErr && isMissingContactTable(abandonedErr)) {
          abandonedSessions = [];
        } else if (abandonedErr) {
          const fallback = await supabaseAdmin
            .from("interview_sessions")
            .select("id, customer_id, status, started_at, updated_at, created_at")
            .eq("status", "in_progress")
            .order("updated_at", { ascending: false })
            .limit(150);
          if (fallback.error && !isMissingContactTable(fallback.error)) throw new Error(fallback.error.message);
          abandonedSessions = (fallback.data ?? []).map((s) => ({
            ...s,
            channel: null,
            current_section: null,
          }));
        }

        const rows = (abandonedSessions ?? []).filter(
          (s) => s.customer_id && !activeSessionIds.has(s.id),
        );
        const abandonedCustomerIds = [
          ...new Set(rows.map((s) => s.customer_id).filter(Boolean)),
        ] as string[];
        const profileById = new Map<
          string,
          { full_name: string | null; email: string | null; phone: string | null }
        >();
        if (abandonedCustomerIds.length > 0) {
          const { data: profiles } = await supabaseAdmin
            .from("profiles")
            .select("id, full_name, email, phone")
            .in("id", abandonedCustomerIds);
          for (const p of profiles ?? []) {
            profileById.set(p.id, {
              full_name: p.full_name,
              email: p.email,
              phone: (p as { phone?: string | null }).phone ?? null,
            });
          }
        }

        const advisorBySession = new Map<string, string>();
        const abandonedIds = rows.map((r) => r.id);
        if (abandonedIds.length > 0) {
          const { data: allocs } = await supabaseAdmin
            .from("session_advisors")
            .select("session_id, advisor_id")
            .in("session_id", abandonedIds);
          for (const a of allocs ?? []) {
            if (!advisorBySession.has(a.session_id)) advisorBySession.set(a.session_id, a.advisor_id);
          }
        }

        for (const s of rows) {
          const prof = s.customer_id ? profileById.get(s.customer_id) : undefined;
          const emailRaw = (prof?.email ?? "").trim();
          const email =
            emailRaw && !emailRaw.toLowerCase().includes("@customers.mortgagehub.local")
              ? emailRaw
              : null;
          const phone = (prof?.phone ?? "").trim();
          if (!email && !phone) continue;

          const contactedAt = contactedAtByKey.get(`abandoned:${s.id}`) ?? null;
          if (contactedAt && !contactArchiveVisible(contactedAt)) continue;

          contacts.push({
            kind: "abandoned",
            id: s.id,
            customerName: prof?.full_name?.trim() || "Customer",
            customerPhone: phone || "—",
            customerEmail: email,
            sessionId: s.id,
            customerId: s.customer_id ?? null,
            startsAt: null,
            window: null,
            status: s.status,
            createdAt: (s as { updated_at?: string }).updated_at ?? s.started_at ?? s.created_at,
            opened: opened.has(`abandoned:${s.id}`),
            contacted: isContactArchived(contactedAt),
            contactedAt,
            advisorId: advisorBySession.get(s.id) ?? null,
            channel: (s as { channel?: string | null }).channel ?? null,
            lastSection: (s as { current_section?: string | null }).current_section ?? null,
          });
        }
      }
    }

    const customerIds = [...new Set(contacts.map((c) => c.customerId).filter(Boolean))] as string[];
    if (customerIds.length > 0) {
      const { data: links } = await supabaseAdmin
        .from("customer_introducer_links")
        .select("customer_id, introducer_id")
        .in("customer_id", customerIds);
      const introIds = [...new Set((links ?? []).map((l) => l.introducer_id))];
      const introMap = new Map<string, { code: string | null; name: string | null }>();
      if (introIds.length > 0) {
        const { data: intros } = await supabaseAdmin
          .from("introducers")
          .select("id, company_code, company_name")
          .in("id", introIds);
        for (const i of intros ?? []) {
          introMap.set(i.id, {
            code: (i as { company_code?: string | null }).company_code ?? null,
            name: (i as { company_name?: string | null }).company_name ?? null,
          });
        }
      }
      const linkByCustomer = new Map(
        (links ?? []).map((l) => [l.customer_id, l.introducer_id as string]),
      );
      for (const c of contacts) {
        if (!c.customerId) continue;
        const introId = linkByCustomer.get(c.customerId);
        if (!introId) continue;
        const meta = introMap.get(introId);
        c.introducerCode = meta?.code ?? null;
        c.introducerCompany = meta?.name ?? null;
      }
    }

    {
      const { backfillWelcomeCallsFromAppointments, listOpenStaffContactTasks } = await import(
        "@/lib/staff-contact-tasks.server"
      );
      const { STAFF_TASK_LABELS } = await import("@/lib/staff-contact-tasks");
      const taskSessionFilter =
        isAdvisor && !isStaffAdmin ? [...allocatedSessionIds] : undefined;
      // Ensure booked appointments have a welcome-call contact task (idempotent).
      try {
        await backfillWelcomeCallsFromAppointments(supabaseAdmin, taskSessionFilter);
      } catch (e) {
        console.error("welcome call backfill failed", e);
      }
      const tasks = await listOpenStaffContactTasks(supabaseAdmin, taskSessionFilter);
      const sessionIds = [...new Set(tasks.map((t) => t.session_id))];
      const sessionMeta = new Map<
        string,
        { customerId: string | null; name: string; phone: string; email: string | null }
      >();
      if (sessionIds.length > 0) {
        const { data: sessions } = await supabaseAdmin
          .from("interview_sessions")
          .select("id, customer_id")
          .in("id", sessionIds);
        const customerIds = [...new Set((sessions ?? []).map((s) => s.customer_id).filter(Boolean))] as string[];
        const profileMap = new Map<string, { full_name: string | null; email: string | null; phone: string | null }>();
        if (customerIds.length > 0) {
          const { data: profiles } = await supabaseAdmin
            .from("profiles")
            .select("id, full_name, email, phone")
            .in("id", customerIds);
          for (const p of profiles ?? []) {
            profileMap.set(p.id, {
              full_name: p.full_name,
              email: p.email,
              phone: (p as { phone?: string | null }).phone ?? null,
            });
          }
        }
        for (const s of sessions ?? []) {
          const prof = s.customer_id ? profileMap.get(s.customer_id) : undefined;
          sessionMeta.set(s.id, {
            customerId: s.customer_id ?? null,
            name: prof?.full_name?.trim() || "Customer",
            phone: prof?.phone ?? "",
            email: prof?.email ?? null,
          });
        }
      }

      for (const task of tasks) {
        if (isAdvisor && !isStaffAdmin && !allocatedSessionIds.has(task.session_id)) continue;
        const meta = sessionMeta.get(task.session_id);
        contacts.push({
          kind: "staff_task",
          id: task.id,
          taskType: task.task_type,
          customerName: meta?.name ?? "Customer",
          customerPhone: meta?.phone ?? "",
          customerEmail: meta?.email ?? null,
          sessionId: task.session_id,
          customerId: meta?.customerId ?? null,
          startsAt: null,
          window: null,
          status: STAFF_TASK_LABELS[task.task_type],
          createdAt: task.created_at,
          dueAt: task.due_at,
          completedAt: task.completed_at,
          opened: opened.has(`staff_task:${task.id}`),
          contacted: false,
          contactedAt: null,
        });
      }
    }

    // Resolve advisor for rows that only have a session (tasks, some phone calls).
    const sessionsNeedingAdvisor = [
      ...new Set(
        contacts
          .filter((c) => !c.advisorId && c.sessionId)
          .map((c) => c.sessionId as string),
      ),
    ];
    if (sessionsNeedingAdvisor.length > 0) {
      const { data: allocs } = await supabaseAdmin
        .from("session_advisors")
        .select("session_id, advisor_id")
        .in("session_id", sessionsNeedingAdvisor);
      const firstAdvisorBySession = new Map<string, string>();
      for (const row of allocs ?? []) {
        if (!firstAdvisorBySession.has(row.session_id)) {
          firstAdvisorBySession.set(row.session_id, row.advisor_id);
        }
      }
      for (const c of contacts) {
        if (c.advisorId || !c.sessionId) continue;
        c.advisorId = firstAdvisorBySession.get(c.sessionId) ?? null;
      }
    }

    const advisorIds = [...new Set(contacts.map((c) => c.advisorId).filter(Boolean))] as string[];
    if (advisorIds.length > 0) {
      const { data: advisorProfiles } = await supabaseAdmin
        .from("profiles")
        .select("id, full_name, email")
        .in("id", advisorIds);
      const nameById = new Map(
        (advisorProfiles ?? []).map((p) => [
          p.id,
          (p.full_name?.trim() || p.email || "Advisor") as string,
        ]),
      );
      for (const c of contacts) {
        if (!c.advisorId) continue;
        c.advisorName = nameById.get(c.advisorId) ?? null;
      }
    }

    contacts.sort((a, b) => {
      const aOpenTask = a.kind === "staff_task" && !a.completedAt;
      const bOpenTask = b.kind === "staff_task" && !b.completedAt;
      if (aOpenTask && bOpenTask) {
        return new Date(a.dueAt ?? 0).getTime() - new Date(b.dueAt ?? 0).getTime();
      }
      if (aOpenTask !== bOpenTask) return aOpenTask ? -1 : 1;

      if (a.contacted !== b.contacted) return a.contacted ? 1 : -1;
      if (a.unallocated !== b.unallocated) return a.unallocated ? -1 : 1;
      if (a.opened !== b.opened) return a.opened ? 1 : -1;
      const aSort = a.dueAt ?? a.startsAt ?? a.createdAt;
      const bSort = b.dueAt ?? b.startsAt ?? b.createdAt;
      return new Date(aSort).getTime() - new Date(bSort).getTime();
    });

    // Pure advisors: hide contacts for journeys marked complete with lender details entered.
    // Owner / supervisor / admin keep full visibility (Management View).
    if (isAdvisor && !isStaffAdmin) {
      const linkedIds = [
        ...new Set(contacts.map((c) => c.sessionId).filter(Boolean) as string[]),
      ];
      if (linkedIds.length > 0) {
        const archived = new Set<string>();
        const { data: milestones } = await supabaseAdmin
          .from("customer_journey_milestones")
          .select("session_id")
          .in("session_id", linkedIds)
          .eq("milestone_key", "completion");
        const completeIds = [...new Set((milestones ?? []).map((m) => m.session_id))];
        if (completeIds.length > 0) {
          const { data: details } = await supabaseAdmin
            .from("case_mortgage_details")
            .select("session_id, current_lender")
            .in("session_id", completeIds);
          for (const d of details ?? []) {
            if (String(d.current_lender ?? "").trim()) archived.add(d.session_id);
          }
        }
        if (archived.size > 0) {
          return contacts.filter((c) => !c.sessionId || !archived.has(c.sessionId));
        }
      }
    }

    return contacts;
  });

export const listSessionCrmContacts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ sessionId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<SessionCrmContactItem[]> => {
    const { data: roles } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    const isStaff = (roles ?? []).some((r) => r.role === "advisor" || r.role === "admin");
    if (!isStaff) throw new Error("Forbidden");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const contactedAtByKey = new Map<string, string>();
    {
      const { data: views, error } = await supabaseAdmin
        .from("advisor_contact_views")
        .select("contact_type, contact_id, contacted_at")
        .eq("advisor_id", context.userId);
      if (error && !isMissingContactTable(error)) throw new Error(error.message);
      for (const v of views ?? []) {
        const row = v as { contact_type: string; contact_id: string; contacted_at?: string | null };
        if (row.contacted_at) contactedAtByKey.set(`${row.contact_type}:${row.contact_id}`, row.contacted_at);
      }
    }

    const items: SessionCrmContactItem[] = [];

    const { data: callbacks, error: cbErr } = await supabaseAdmin
      .from("callback_requests")
      .select("id, preferred_window, status, created_at, notes, phone_call_id")
      .eq("session_id", data.sessionId)
      .in("status", ["new", "contacted"])
      .order("created_at", { ascending: false });
    if (cbErr && !isMissingContactTable(cbErr)) throw new Error(cbErr.message);

    const linkedCallIds = new Set<string>();
    for (const cb of callbacks ?? []) {
      const isVoicemail = (cb.notes ?? "").toLowerCase().includes("voicemail");
      const contactedAt = contactedAtByKey.get(`callback:${cb.id}`) ?? null;
      if (contactedAt && !contactArchiveVisible(contactedAt)) continue;
      if (cb.phone_call_id) linkedCallIds.add(cb.phone_call_id);
      items.push({
        contactType: "callback",
        id: cb.id,
        phoneCallId: cb.phone_call_id,
        title: isVoicemail ? "Inbound voicemail" : "Call-back request",
        subtitle: isVoicemail
          ? "Office line — call back requested"
          : `Preferred ${cb.preferred_window?.replace("-", "–") ?? "window"}`,
        contacted: isContactArchived(contactedAt),
        contactedAt,
      });
    }

    const { data: calls, error: callErr } = await supabaseAdmin
      .from("phone_calls")
      .select("id, call_kind, from_number, to_number, started_at, summary, ai_status")
      .eq("session_id", data.sessionId)
      .in("call_kind", ["outbound", "inbound_voicemail"])
      .order("started_at", { ascending: false })
      .limit(20);
    if (callErr && !isMissingContactTable(callErr)) throw new Error(callErr.message);

    for (const call of calls ?? []) {
      if (call.call_kind === "inbound_voicemail" && linkedCallIds.has(call.id)) continue;
      const contactedAt = contactedAtByKey.get(`phone_call:${call.id}`) ?? null;
      if (contactedAt && !contactArchiveVisible(contactedAt)) continue;
      const isVoicemail = call.call_kind === "inbound_voicemail";
      items.push({
        contactType: "phone_call",
        id: call.id,
        phoneCallId: call.id,
        title: isVoicemail ? "Inbound voicemail" : "Outbound call",
        subtitle: isVoicemail
          ? `From ${call.from_number ?? "unknown"} · ${new Date(call.started_at).toLocaleString("en-GB")}`
          : `To ${call.to_number ?? "unknown"} · ${new Date(call.started_at).toLocaleString("en-GB")}`,
        summary: call.summary,
        aiStatus: call.ai_status,
        contacted: isContactArchived(contactedAt),
        contactedAt,
      });
    }

    items.sort((a, b) => {
      if (a.contacted !== b.contacted) return a.contacted ? 1 : -1;
      return 0;
    });
    return items;
  });

/** Mark a contact item as handled — logs History, greys out for 24h, then drops from Contacts/CRM. */
export const markAdvisorContactHandled = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        contactType: z.enum(["appointment", "callback", "phone_call", "abandoned"]),
        contactId: z.string().uuid(),
        sessionId: z.string().uuid().optional(),
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
    if (!isStaff) {
      const email = (context.claims as { email?: string }).email;
      const { resolveAdminAccess } = await import("@/lib/admin.functions");
      const adminAccess = await resolveAdminAccess(context.userId, email);
      if (!adminAccess.isOwner && !adminAccess.isSupervisor && !adminAccess.isAdmin) {
        throw new Error("Forbidden");
      }
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const now = new Date().toISOString();

    const viewRow: Record<string, unknown> = {
      advisor_id: context.userId,
      contact_type: data.contactType,
      contact_id: data.contactId,
      opened_at: now,
      contacted_at: now,
    };

    const { error: viewErr } = await supabaseAdmin
      .from("advisor_contact_views")
      .upsert(viewRow, { onConflict: "advisor_id,contact_type,contact_id" });
    if (viewErr && !isMissingContactTable(viewErr)) throw new Error(viewErr.message);

    let sessionId = data.sessionId ?? null;
    let historyNote = data.note?.trim() || null;

    if (data.contactType === "callback") {
      await supabaseAdmin.from("callback_requests").update({ status: "contacted" }).eq("id", data.contactId);
      if (!sessionId) {
        const { data: cb } = await supabaseAdmin
          .from("callback_requests")
          .select("session_id, notes, phone_call_id")
          .eq("id", data.contactId)
          .maybeSingle();
        sessionId = cb?.session_id ?? null;
        if (!historyNote) {
          const vm = (cb?.notes ?? "").toLowerCase().includes("voicemail");
          historyNote = vm ? "Inbound voicemail — marked as contacted" : "Call-back — marked as contacted";
        }
        if (cb?.phone_call_id) {
          await supabaseAdmin.from("advisor_contact_views").upsert(
            {
              advisor_id: context.userId,
              contact_type: "phone_call",
              contact_id: cb.phone_call_id,
              opened_at: now,
              contacted_at: now,
            },
            { onConflict: "advisor_id,contact_type,contact_id" },
          );
        }
      }
    }

    if (data.contactType === "phone_call") {
      if (!sessionId) {
        const { data: call } = await supabaseAdmin
          .from("phone_calls")
          .select("session_id, call_kind")
          .eq("id", data.contactId)
          .maybeSingle();
        sessionId = call?.session_id ?? null;
        if (!historyNote) {
          historyNote =
            call?.call_kind === "inbound_voicemail"
              ? "Inbound voicemail — marked as contacted"
              : "Outbound call — marked as contacted";
        }
      }
    }

    if (data.contactType === "appointment" && !historyNote) {
      historyNote = "Appointment — marked as contacted";
    }

    if (data.contactType === "abandoned") {
      sessionId = sessionId ?? data.contactId;
      if (!historyNote) historyNote = "Abandoned lead — marked as contacted";
    }

    if (sessionId) {
      await appendContactLog(sessionId, context.userId, "contact", historyNote ?? "Marked as contacted");
      await clearSessionAttention(sessionId, context.userId, "contact_handled");
    }

    return { ok: true, contactedAt: now };
  });

export const listAssigneeAdvisors = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const email = (context.claims as { email?: string }).email;
    const { resolveAdminAccess } = await import("@/lib/admin.functions");
    const adminAccess = await resolveAdminAccess(context.userId, email);
    if (!adminAccess.isOwner && !adminAccess.isSupervisor && !adminAccess.isAdmin) {
      throw new Error("Forbidden");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: roleRows } = await supabaseAdmin.from("user_roles").select("user_id").eq("role", "advisor");
    const advisorIds = Array.from(new Set((roleRows ?? []).map((r) => r.user_id)));
    if (advisorIds.length === 0) return [] as Array<{ id: string; full_name: string | null; email: string | null }>;

    const { data: profiles } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, email")
      .in("id", advisorIds)
      .order("full_name", { ascending: true });

    return profiles ?? [];
  });

/** Assign an unallocated voicemail call-back to an advisor (and link to a case when the number matches). */
export const assignUnallocatedVoicemail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ callbackId: z.string().uuid(), advisorId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const email = (context.claims as { email?: string }).email;
    const { resolveAdminAccess } = await import("@/lib/admin.functions");
    const adminAccess = await resolveAdminAccess(context.userId, email);
    if (!adminAccess.isOwner && !adminAccess.isSupervisor && !adminAccess.isAdmin) {
      throw new Error("Forbidden");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { findSessionForCallerPhone } = await import("@/lib/phone-lookup.server");

    const { data: cb, error: cbErr } = await supabaseAdmin
      .from("callback_requests")
      .select("id, customer_phone, customer_name, customer_id, session_id, advisor_id, phone_call_id, notes")
      .eq("id", data.callbackId)
      .maybeSingle();
    if (cbErr) throw new Error(cbErr.message);
    if (!cb) throw new Error("Call-back not found");
    if (cb.advisor_id) throw new Error("This call-back is already assigned to an advisor.");

    const { data: advisor } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name")
      .eq("id", data.advisorId)
      .maybeSingle();
    if (!advisor) throw new Error("Advisor not found");

    const match = cb.session_id
      ? {
          sessionId: cb.session_id as string,
          customerId: (cb.customer_id as string | null) ?? null,
        }
      : await findSessionForCallerPhone(cb.customer_phone);

    const callbackPatch: Record<string, unknown> = {
      advisor_id: data.advisorId,
      notes: `${(cb.notes ?? "Inbound callback").replace(/\. Assign.*$/, "")} · Allocated to ${advisor.full_name ?? "advisor"} by admin.`,
    };
    if (match?.sessionId) {
      callbackPatch.session_id = match.sessionId;
      if (match.customerId) {
        callbackPatch.customer_id = match.customerId;
        const { data: prof } = await supabaseAdmin
          .from("profiles")
          .select("full_name")
          .eq("id", match.customerId)
          .maybeSingle();
        if (prof?.full_name) callbackPatch.customer_name = prof.full_name;
      }
    }

    const { error: updateErr } = await supabaseAdmin
      .from("callback_requests")
      .update(callbackPatch)
      .eq("id", data.callbackId);
    if (updateErr) throw new Error(updateErr.message);

    if (cb.phone_call_id) {
      const callPatch: Record<string, unknown> = { advisor_id: data.advisorId };
      if (match?.sessionId) {
        callPatch.session_id = match.sessionId;
        if (match.customerId) callPatch.customer_id = match.customerId;
      }
      await supabaseAdmin.from("phone_calls").update(callPatch).eq("id", cb.phone_call_id);
    }

    if (match?.sessionId) {
      try {
        await supabaseAdmin.from("session_advisors").upsert(
          { session_id: match.sessionId, advisor_id: data.advisorId, assigned_by: context.userId },
          { onConflict: "session_id,advisor_id" },
        );
      } catch (e) {
        console.error("assign voicemail session_advisors failed", e);
      }
      try {
        const { ensureWelcomeCallTask } = await import("@/lib/staff-contact-tasks.server");
        await ensureWelcomeCallTask(supabaseAdmin, match.sessionId, context.userId);
      } catch (e) {
        console.error("welcome call on allocate callback failed", e);
      }
    }

    return {
      ok: true,
      sessionId: match?.sessionId ?? null,
      advisorName: advisor.full_name,
    };
  });

export const markContactOpened = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        contactType: z.enum(["appointment", "callback", "phone_call", "staff_task", "abandoned"]),
        contactId: z.string().uuid(),
        viewAsAdvisorId: z.string().uuid().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const email = (context.claims as { email?: string }).email;
    const { resolveAdminAccess } = await import("@/lib/admin.functions");
    const adminAccess = await resolveAdminAccess(context.userId, email);

    let advisorId = context.userId;
    let viewAsMode = false;
    if (data.viewAsAdvisorId) {
      if (!adminAccess.isOwner && !adminAccess.isSupervisor) throw new Error("Forbidden");
      advisorId = data.viewAsAdvisorId;
      viewAsMode = true;
    } else {
      const { data: roles } = await context.supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", context.userId);
      if (!(roles ?? []).some((r) => r.role === "advisor")) {
        if (!adminAccess.isOwner && !adminAccess.isSupervisor && !adminAccess.isAdmin) {
          throw new Error("Forbidden");
        }
      }
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("advisor_contact_views")
      .upsert(
        { advisor_id: advisorId, contact_type: data.contactType, contact_id: data.contactId },
        { onConflict: "advisor_id,contact_type,contact_id" },
      );
    if (error && !isMissingContactTable(error)) throw new Error(error.message);

    if (viewAsMode) {
      const { logViewAsAudit } = await import("@/lib/view-as-audit.functions");
      await logViewAsAudit(supabaseAdmin, {
        viewType: "advisor",
        actingUserId: context.userId,
        targetUserId: advisorId,
        action: "contact_opened",
        summary: `Opened ${data.contactType} contact`,
        detail: { contactId: data.contactId, contactType: data.contactType },
      });
    }

    return { ok: true };
  });

export const listAdvisorAppointments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ viewAsAdvisorId: z.string().uuid().optional() }).parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    const email = (context.claims as { email?: string }).email;
    const { resolveAdminAccess } = await import("@/lib/admin.functions");
    const access = await resolveAdminAccess(context.userId, email);
    const { data: roles } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    const roleList = (roles ?? []).map((r) => r.role);

    let advisorId = context.userId;
    if (data.viewAsAdvisorId) {
      const { canView } = await import("@/lib/admin-access");
      const canViewAdvisorDiary =
        access.isOwner ||
        access.isSupervisor ||
        canView(access, "advisors") ||
        canView(access, "appointments");
      if (!canViewAdvisorDiary) throw new Error("Forbidden");
      advisorId = data.viewAsAdvisorId;
    } else if (!roleList.includes("advisor") && !access.isAdmin) {
      throw new Error("Forbidden");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: appts, error } = await supabaseAdmin
      .from("appointments")
      .select("*")
      .eq("advisor_id", advisorId)
      .gte("starts_at", new Date().toISOString())
      .eq("status", "confirmed")
      .order("starts_at", { ascending: true })
      .limit(50);
    if (error) throw new Error(error.message);
    return appts ?? [];
  });

/** All confirmed upcoming appointments (firm-wide diary grid). */
export const listAllUpcomingAppointments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const email = (context.claims as { email?: string }).email;
    const { resolveAdminAccess } = await import("@/lib/admin.functions");
    const access = await resolveAdminAccess(context.userId, email);
    const { canView } = await import("@/lib/admin-access");
    const canViewGrid =
      access.isOwner ||
      access.isSupervisor ||
      canView(access, "advisors") ||
      canView(access, "appointments");
    if (!canViewGrid) throw new Error("Forbidden");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: appts, error } = await supabaseAdmin
      .from("appointments")
      .select("*")
      .gte("starts_at", new Date().toISOString())
      .eq("status", "confirmed")
      .order("starts_at", { ascending: true })
      .limit(500);
    if (error) throw new Error(error.message);

    const advisorIds = [...new Set((appts ?? []).map((a) => a.advisor_id).filter(Boolean))] as string[];
    const profileMap = new Map<string, { full_name: string | null; email: string | null }>();
    const codeMap = new Map<string, string>();
    if (advisorIds.length > 0) {
      const { data: profiles } = await supabaseAdmin
        .from("profiles")
        .select("id, full_name, email")
        .in("id", advisorIds);
      for (const p of profiles ?? []) profileMap.set(p.id, p);

      const { data: codes } = await supabaseAdmin
        .from("advisor_profiles")
        .select("user_id, code")
        .in("user_id", advisorIds);
      for (const c of codes ?? []) codeMap.set(c.user_id, c.code);
    }

    return (appts ?? []).map((a) => {
      const profile = profileMap.get(a.advisor_id);
      return {
        ...a,
        advisor_name: profile?.full_name ?? profile?.email ?? null,
        advisor_code: codeMap.get(a.advisor_id) ?? null,
      };
    });
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
  .inputValidator((d: unknown) =>
    z
      .object({
        leadId: z.string().uuid(),
        viewAsIntroducerUserId: z.string().uuid().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    if (!isTwilioConfigured()) throw new Error("SMS is not configured yet. Add Twilio credentials to your server environment.");

    const {
      data: { user },
    } = await context.supabase.auth.getUser();
    const { resolveViewAsIntroducer } = await import("@/lib/introducer.functions");
    const { targetUserId, viewAsMode } = await resolveViewAsIntroducer(
      context.userId,
      user?.email ?? null,
      data.viewAsIntroducerUserId,
    );

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const introClient = viewAsMode ? supabaseAdmin : context.supabase;

    const { data: introducer, error: introErr } = await introClient
      .from("introducers")
      .select("id, company_name, slug")
      .eq("user_id", targetUserId)
      .single();
    if (introErr) throw new Error(introErr.message);

    const { data: lead, error: leadErr } = await introClient
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
      from: getSmsSenderLabel(),
      to: lead.customer_phone,
      body,
      twilioSid: sid,
      leadId: lead.id,
    });

    await introClient
      .from("introducer_leads")
      .update({ channel: "text", status: "contacted" })
      .eq("id", lead.id);

    if (viewAsMode) {
      const { logViewAsAudit } = await import("@/lib/view-as-audit.functions");
      await logViewAsAudit(supabaseAdmin, {
        viewType: "introducer",
        actingUserId: context.userId,
        targetUserId,
        action: "send_booking_sms",
        summary: `Sent booking link SMS to ${lead.customer_name ?? "customer"}`,
        detail: { leadId: lead.id, customerPhone: lead.customer_phone },
      });
    }

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

async function assertStaffBookingAccess(userId: string): Promise<void> {
  const { getRolesForUser } = await import("@/lib/sessions.functions");
  const roles = await getRolesForUser(userId);
  if (roles.includes("advisor")) return;
  const { resolveAdminAccess } = await import("@/lib/admin.functions");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("email")
    .eq("id", userId)
    .maybeSingle();
  const access = await resolveAdminAccess(userId, profile?.email ?? undefined);
  if (access.isAdmin) return;
  throw new Error("Forbidden");
}

export const bookNewCustomerAsStaff = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        customerName: z.string().min(2),
        customerPhone: z.string().min(7),
        customerEmail: z.string().email(),
        startsAt: z.string().datetime(),
        notes: z.string().max(500).optional(),
        sendSms: z.boolean().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertStaffBookingAccess(context.userId);
    const customerId = await resolveOrCreateCustomerProfile({
      customerName: data.customerName,
      customerPhone: data.customerPhone,
      customerEmail: data.customerEmail,
    });
    const advisorId = await resolveBookingAdvisorId(context.userId);
    return bookAppointment(
      {
        customerId,
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

export const sendStaffCustomerBookingLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        customerName: z.string().min(2),
        customerPhone: z.string().min(7),
        customerEmail: z.string().email(),
        sendSms: z.boolean().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertStaffBookingAccess(context.userId);
    if (data.sendSms !== false && !isTwilioConfigured()) {
      throw new Error("SMS is not configured — copy the booking link instead.");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const introducerId = await ensureStaffIntroducerRecord(context.userId);
    const { data: introducer, error: introErr } = await supabaseAdmin
      .from("introducers")
      .select("slug, company_name")
      .eq("id", introducerId)
      .single();
    if (introErr) throw new Error(introErr.message);

    const phone = normaliseUkPhone(data.customerPhone);
    const { data: lead, error: leadErr } = await supabaseAdmin
      .from("introducer_leads")
      .insert({
        introducer_id: introducerId,
        customer_name: data.customerName,
        customer_phone: phone,
        customer_email: data.customerEmail,
        status: "new",
        channel: "text",
      })
      .select("id")
      .single();
    if (leadErr) throw new Error(leadErr.message);

    const bookUrl = `${getAppBaseUrl()}/book/${introducer.slug}?lead=${lead.id}`;
    const body = textChannelInviteMessage({
      customerName: data.customerName,
      bookUrl,
      introducerName: introducer.company_name ?? "Your advisor",
    });

    if (data.sendSms !== false && isTwilioConfigured()) {
      const { sid } = await sendSms({ to: phone, body });
      await logSms({
        direction: "outbound",
        from: getSmsSenderLabel(),
        to: phone,
        body,
        twilioSid: sid,
        leadId: lead.id,
      });
      await supabaseAdmin
        .from("introducer_leads")
        .update({ status: "contacted" })
        .eq("id", lead.id);
    }

    console.info(`[booking-email] Invite to ${data.customerEmail}: ${bookUrl}`);

    return { ok: true as const, bookUrl, mailto: `mailto:${encodeURIComponent(data.customerEmail)}?subject=${encodeURIComponent("Book your mortgage appointment")}&body=${encodeURIComponent(`Hi ${data.customerName},\n\nPlease book a time using this link:\n\n${bookUrl}`)}` };
  });

async function assertIntroducerBookingAccess(userId: string): Promise<string> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: roles } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  if (!(roles ?? []).some((r) => r.role === "introducer")) {
    throw new Error("Forbidden");
  }
  const { data: introducer, error } = await supabaseAdmin
    .from("introducers")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!introducer) throw new Error("Introducer profile not set up yet.");
  return introducer.id;
}

export const bookNewCustomerAsIntroducer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        customerName: z.string().min(2),
        customerPhone: z.string().min(7),
        customerEmail: z.string().email(),
        startsAt: z.string().datetime(),
        advisorId: z.string().uuid().optional(),
        notes: z.string().max(500).optional(),
        sendSms: z.boolean().optional(),
        viewAsIntroducerUserId: z.string().uuid().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const {
      data: { user },
    } = await context.supabase.auth.getUser();
    const { resolveViewAsIntroducer } = await import("@/lib/introducer.functions");
    const { targetUserId, viewAsMode } = await resolveViewAsIntroducer(
      context.userId,
      user?.email ?? null,
      data.viewAsIntroducerUserId,
    );

    if (!viewAsMode) {
      await assertIntroducerBookingAccess(context.userId);
    } else {
      await assertIntroducerBookingAccess(targetUserId);
    }

    const customerId = await resolveOrCreateCustomerProfile({
      customerName: data.customerName,
      customerPhone: data.customerPhone,
      customerEmail: data.customerEmail,
    });
    const advisorId = data.advisorId ?? (await getPrimaryAdvisorId());
    const result = await bookAppointment(
      {
        customerId,
        advisorId,
        channel: "direct_booking",
        customerName: data.customerName,
        customerPhone: data.customerPhone,
        customerEmail: data.customerEmail,
        startsAt: data.startsAt,
        notes: data.notes,
        sendSms: data.sendSms ?? true,
      },
      targetUserId,
    );

    if (viewAsMode) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { logViewAsAudit } = await import("@/lib/view-as-audit.functions");
      await logViewAsAudit(supabaseAdmin, {
        viewType: "introducer",
        actingUserId: context.userId,
        targetUserId,
        action: "book_appointment",
        summary: `Booked appointment for ${data.customerName}`,
        detail: {
          customerName: data.customerName,
          startsAt: data.startsAt,
          appointmentId: (result as { appointment?: { id?: string } }).appointment?.id,
        },
      });
    }

    return result;
  });

export const sendIntroducerCustomerBookingLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        customerName: z.string().min(2),
        customerPhone: z.string().min(7),
        customerEmail: z.string().email(),
        sendSms: z.boolean().optional(),
        viewAsIntroducerUserId: z.string().uuid().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const {
      data: { user },
    } = await context.supabase.auth.getUser();
    const { resolveViewAsIntroducer } = await import("@/lib/introducer.functions");
    const { targetUserId, viewAsMode } = await resolveViewAsIntroducer(
      context.userId,
      user?.email ?? null,
      data.viewAsIntroducerUserId,
    );

    const introducerId = await assertIntroducerBookingAccess(targetUserId);
    if (data.sendSms !== false && !isTwilioConfigured()) {
      throw new Error("SMS is not configured — copy the booking link instead.");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: introducer, error: introErr } = await supabaseAdmin
      .from("introducers")
      .select("slug, company_name")
      .eq("id", introducerId)
      .single();
    if (introErr) throw new Error(introErr.message);

    const phone = normaliseUkPhone(data.customerPhone);
    const { data: lead, error: leadErr } = await supabaseAdmin
      .from("introducer_leads")
      .insert({
        introducer_id: introducerId,
        customer_name: data.customerName,
        customer_phone: phone,
        customer_email: data.customerEmail,
        status: "new",
        channel: "text",
      })
      .select("id")
      .single();
    if (leadErr) throw new Error(leadErr.message);

    const bookUrl = `${getAppBaseUrl()}/book/${introducer.slug}?lead=${lead.id}`;
    const body = textChannelInviteMessage({
      customerName: data.customerName,
      bookUrl,
      introducerName: introducer.company_name ?? "Your introducer",
    });

    if (data.sendSms !== false && isTwilioConfigured()) {
      const { sid } = await sendSms({ to: phone, body });
      await logSms({
        direction: "outbound",
        from: getSmsSenderLabel(),
        to: phone,
        body,
        twilioSid: sid,
        leadId: lead.id,
      });
      await supabaseAdmin
        .from("introducer_leads")
        .update({ status: "contacted" })
        .eq("id", lead.id);
    }

    if (viewAsMode) {
      const { logViewAsAudit } = await import("@/lib/view-as-audit.functions");
      await logViewAsAudit(supabaseAdmin, {
        viewType: "introducer",
        actingUserId: context.userId,
        targetUserId,
        action: "send_booking_link",
        summary: `Sent booking link to ${data.customerName}`,
        detail: { leadId: lead.id, customerEmail: data.customerEmail },
      });
    }

    console.info(`[booking-email] Invite to ${data.customerEmail}: ${bookUrl}`);

    return {
      ok: true as const,
      bookUrl,
      mailto: `mailto:${encodeURIComponent(data.customerEmail)}?subject=${encodeURIComponent("Book your mortgage appointment")}&body=${encodeURIComponent(`Hi ${data.customerName},\n\nPlease book a time using this link:\n\n${bookUrl}`)}`,
    };
  });

export const rescheduleAppointment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        appointmentId: z.string().uuid(),
        startsAt: z.string().datetime(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: appt, error: apptErr } = await supabaseAdmin
      .from("appointments")
      .select("*")
      .eq("id", data.appointmentId)
      .maybeSingle();
    if (apptErr) throw new Error(apptErr.message);
    if (!appt || appt.status !== "confirmed") throw new Error("Appointment not found");

    const email = (context.claims as { email?: string }).email;
    const { resolveAdminAccess } = await import("@/lib/admin.functions");
    const access = await resolveAdminAccess(context.userId, email);
    const { data: roles } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    const roleList = (roles ?? []).map((r) => r.role);
    const isAdvisor = roleList.includes("advisor");
    const isStaff = isAdvisor || access.isAdmin;

    let allowed = isStaff && appt.advisor_id === context.userId;
    if (!allowed && access.isOwner) allowed = true;
    if (!allowed && access.isSupervisor) allowed = true;
    if (!allowed && appt.session_id) {
      const { data: session } = await supabaseAdmin
        .from("interview_sessions")
        .select("customer_id")
        .eq("id", appt.session_id)
        .maybeSingle();
      if (session?.customer_id === context.userId) allowed = true;
    }
    if (!allowed) throw new Error("Forbidden");

    const startsAt = new Date(data.startsAt);
    const endsAt = new Date(startsAt.getTime() + SLOT_MINUTES * 60 * 1000);

    const { data: conflict } = await supabaseAdmin
      .from("appointments")
      .select("id")
      .eq("advisor_id", appt.advisor_id)
      .eq("status", "confirmed")
      .eq("starts_at", startsAt.toISOString())
      .neq("id", appt.id)
      .maybeSingle();
    if (conflict) throw new Error("That time slot is no longer available. Please choose another.");

    const { error: updErr } = await supabaseAdmin
      .from("appointments")
      .update({ starts_at: startsAt.toISOString(), ends_at: endsAt.toISOString() })
      .eq("id", appt.id);
    if (updErr) throw new Error(updErr.message);

    if (appt.customer_phone) {
      try {
        const advisorName = await getAdvisorName(appt.advisor_id);
        await sendBookingConfirmations({
          customerName: appt.customer_name,
          customerPhone: appt.customer_phone,
          customerEmail: appt.customer_email ?? "",
          startsAt,
          advisorName,
          sessionId: appt.session_id,
          appointmentId: appt.id,
        });
      } catch (e) {
        console.error("reschedule confirmation failed", e);
      }
    }

    try {
      const { syncAppointmentToTeams } = await import("@/lib/teams-calendar.server");
      await syncAppointmentToTeams({
        appointmentId: appt.id,
        advisorId: appt.advisor_id,
        customerName: appt.customer_name,
        customerEmail: appt.customer_email,
        customerPhone: appt.customer_phone,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        notes: appt.notes,
        existingEventId: (appt as { ms_event_id?: string | null }).ms_event_id ?? null,
      });
    } catch (e) {
      console.error("Teams calendar sync on reschedule failed", e);
    }

    return { ok: true as const };
  });
