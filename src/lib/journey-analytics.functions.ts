import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { resolveAdminAccess } from "@/lib/admin.functions";

export type JourneyAnalyticsGenerator =
  | "direct"
  | "raf"
  | "introducer"
  | "google"
  | "unknown";

export type JourneyAnalyticsJourney = "voice" | "chat" | "book";

export type JourneyAnalyticsOutcome = "completed" | "booked" | "abandoned" | "in_progress";

export type JourneyAnalyticsStage =
  | "Started"
  | "Contact details"
  | "Fact-find mid"
  | "Fact-find done"
  | "Booked";

export type JourneyAnalyticsLead = {
  id: string;
  customerId: string | null;
  caseRef: string | null;
  generator: JourneyAnalyticsGenerator;
  journey: JourneyAnalyticsJourney;
  outcome: JourneyAnalyticsOutcome;
  stage: JourneyAnalyticsStage;
  name: string;
  contact: string;
  customerPhone: string | null;
  customerEmail: string | null;
};

function isMissingTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const code = error.code ?? "";
  const msg = (error.message ?? "").toLowerCase();
  return code === "42P01" || code === "42703" || msg.includes("does not exist") || msg.includes("schema cache");
}

function maskContact(email: string | null, phone: string | null): string {
  const bits: string[] = [];
  if (phone?.trim()) {
    const p = phone.trim();
    bits.push(p.length > 4 ? `${p.slice(0, 2)}…${p.slice(-2)}` : "07…");
  }
  if (email?.trim() && !email.toLowerCase().includes("@customers.mortgagehub.local")) {
    const e = email.trim();
    const at = e.indexOf("@");
    bits.push(at > 0 ? `${e[0]}@…` : "email…");
  }
  return bits.join(" · ") || "—";
}

function stageFromSession(opts: {
  hasAppointment: boolean;
  status: string;
  currentSection: string | null;
  questionIndex: number | null;
}): JourneyAnalyticsStage {
  if (opts.hasAppointment) return "Booked";
  if (opts.status === "submitted") return "Fact-find done";
  const section = (opts.currentSection ?? "").toLowerCase();
  if (
    section.includes("contact") ||
    section.includes("personal") ||
    section.includes("about_you") ||
    (opts.questionIndex != null && opts.questionIndex <= 2)
  ) {
    return "Contact details";
  }
  if (section || (opts.questionIndex != null && opts.questionIndex > 2)) {
    return "Fact-find mid";
  }
  return "Started";
}

function generatorFromSources(opts: {
  leadSource: string | null;
  hasRaf: boolean;
  hasIntroducer: boolean;
}): JourneyAnalyticsGenerator {
  if (opts.hasRaf) return "raf";
  if (opts.hasIntroducer || opts.leadSource === "introducer_portal") return "introducer";
  if (opts.leadSource === "referral_link") return "raf";
  const src = (opts.leadSource ?? "").toLowerCase();
  if (src.includes("google") || src.includes("paid") || src.includes("ads")) return "google";
  if (opts.leadSource === "web" || opts.leadSource === "telephone" || opts.leadSource === "mobile") {
    return "direct";
  }
  if (!opts.leadSource) return "direct";
  return "unknown";
}

function journeyFromSources(opts: {
  channel: string | null;
  referralChannel: string | null;
  bookFirst: boolean;
}): JourneyAnalyticsJourney {
  if (opts.bookFirst || opts.referralChannel === "direct_booking") return "book";
  if (opts.channel === "text" || opts.referralChannel === "text") return "chat";
  return "voice";
}

/** Live journey analytics for Management → Analytics (same shape as the layout mock). */
export const listJourneyAnalyticsLeads = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ leads: JourneyAnalyticsLead[]; live: boolean }> => {
    const email = (context.claims as { email?: string }).email;
    const access = await resolveAdminAccess(context.userId, email);
    if (!access.isAdmin && !access.isOwner && !access.isSupervisor) {
      throw new Error("Forbidden");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const since = new Date();
    since.setDate(since.getDate() - 90);

    let sessions: Array<{
      id: string;
      customer_id: string;
      status: string;
      started_at: string;
      updated_at?: string | null;
      submitted_at?: string | null;
      channel?: string | null;
      current_section?: string | null;
      current_question_index?: number | null;
      case_ref?: string | null;
      deleted_at?: string | null;
    }> = [];

    {
      const full = await supabaseAdmin
        .from("interview_sessions")
        .select(
          "id, customer_id, status, started_at, updated_at, submitted_at, channel, current_section, current_question_index, case_ref, deleted_at",
        )
        .gte("started_at", since.toISOString())
        .order("started_at", { ascending: false })
        .limit(800);
      if (full.error) {
        if (!isMissingTable(full.error)) {
          const basic = await supabaseAdmin
            .from("interview_sessions")
            .select("id, customer_id, status, started_at, updated_at, submitted_at")
            .gte("started_at", since.toISOString())
            .order("started_at", { ascending: false })
            .limit(800);
          if (basic.error) throw new Error(basic.error.message);
          sessions = (basic.data ?? []).map((s) => ({
            ...s,
            channel: null,
            current_section: null,
            current_question_index: null,
            case_ref: null,
            deleted_at: null,
          }));
        }
      } else {
        sessions = full.data ?? [];
      }
    }

    sessions = sessions.filter((s) => !s.deleted_at);
    if (!sessions.length) return { leads: [], live: true };

    const sessionIds = sessions.map((s) => s.id);
    const customerIds = [...new Set(sessions.map((s) => s.customer_id).filter(Boolean))];

    const profileMap = new Map<
      string,
      { full_name: string | null; email: string | null; phone: string | null }
    >();
    if (customerIds.length) {
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

    const appointmentBySession = new Map<
      string,
      { lead_source: string | null; referral_channel: string | null }
    >();
    {
      const { data: appts, error } = await supabaseAdmin
        .from("appointments")
        .select("session_id, lead_source, referral_channel, status, starts_at")
        .in("session_id", sessionIds)
        .eq("status", "confirmed");
      if (error && !isMissingTable(error)) throw new Error(error.message);
      for (const a of appts ?? []) {
        if (!a.session_id) continue;
        if (!appointmentBySession.has(a.session_id)) {
          appointmentBySession.set(a.session_id, {
            lead_source: a.lead_source ?? null,
            referral_channel: a.referral_channel ?? null,
          });
        }
      }
    }

    const rafCustomers = new Set<string>();
    {
      const { data: refs, error } = await supabaseAdmin
        .from("referrals")
        .select("referred_user_id, status")
        .in("referred_user_id", customerIds);
      if (error && !isMissingTable(error)) {
        /* referrals table shape may vary — ignore */
      } else {
        for (const r of refs ?? []) {
          if (r.referred_user_id) rafCustomers.add(r.referred_user_id);
        }
      }
    }

    const introducerCustomers = new Set<string>();
    {
      const { data: links, error } = await supabaseAdmin
        .from("customer_introducer_links")
        .select("customer_id")
        .in("customer_id", customerIds);
      if (error && !isMissingTable(error)) {
        /* ignore missing links table */
      } else {
        for (const l of links ?? []) {
          if (l.customer_id) introducerCustomers.add(l.customer_id);
        }
      }
    }

    const staleMs = 24 * 60 * 60 * 1000;
    const now = Date.now();

    const leads: JourneyAnalyticsLead[] = sessions.map((s) => {
      const profile = profileMap.get(s.customer_id);
      const appt = appointmentBySession.get(s.id) ?? null;
      const hasAppointment = Boolean(appt);
      const emailRaw = (profile?.email ?? "").trim();
      const email =
        emailRaw && !emailRaw.toLowerCase().includes("@customers.mortgagehub.local")
          ? emailRaw
          : null;
      const phone = (profile?.phone ?? "").trim() || null;
      const hasContact = Boolean(phone) || Boolean(email);

      const stage = stageFromSession({
        hasAppointment,
        status: s.status,
        currentSection: s.current_section ?? null,
        questionIndex: s.current_question_index ?? null,
      });

      const updatedAt = new Date(s.updated_at ?? s.started_at).getTime();
      const isStale = now - updatedAt > staleMs;

      let outcome: JourneyAnalyticsOutcome;
      if (hasAppointment) outcome = "booked";
      else if (s.status === "submitted") outcome = "completed";
      else if (s.status === "in_progress" && hasContact && isStale) outcome = "abandoned";
      else if (s.status === "in_progress") outcome = "in_progress";
      else outcome = "abandoned";

      // Book-first: case opened via appointment without a long fact-find channel, or direct booking.
      const bookFirst =
        hasAppointment &&
        (appt?.referral_channel === "direct_booking" ||
          (!s.channel && Boolean(s.case_ref)) ||
          (s.status === "in_progress" && hasAppointment && (s.current_question_index ?? 0) <= 1));

      return {
        id: s.id,
        customerId: s.customer_id ?? null,
        caseRef: s.case_ref ?? null,
        generator: generatorFromSources({
          leadSource: appt?.lead_source ?? null,
          hasRaf: rafCustomers.has(s.customer_id),
          hasIntroducer: introducerCustomers.has(s.customer_id),
        }),
        journey: journeyFromSources({
          channel: s.channel ?? null,
          referralChannel: appt?.referral_channel ?? null,
          bookFirst,
        }),
        outcome,
        stage,
        name: profile?.full_name?.trim() || "Customer",
        contact: maskContact(email, phone),
        customerPhone: phone,
        customerEmail: email,
      };
    });

    return { leads, live: true };
  });
