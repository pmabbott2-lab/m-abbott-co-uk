import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

// The introducers.company_code column only exists once the company/advisor codes
// migration has been applied. Treat "missing column/table" errors as "no code"
// so the portal keeps working before the user runs APPLY_NEW_FEATURES.sql.
function isMissingColumnOrTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const code = error.code ?? "";
  const msg = (error.message ?? "").toLowerCase();
  return (
    code === "42P01" ||
    code === "42703" ||
    code === "PGRST204" ||
    code === "PGRST205" ||
    msg.includes("does not exist") ||
    msg.includes("schema cache") ||
    msg.includes("company_code")
  );
}

// A company code is a shared 4-digit number: multiple introducer user accounts
// can belong to the same company by carrying the same code. Codes are shared, so
// generation only needs to avoid clashing with a DIFFERENT existing company.
export async function generateUniqueCompanyCode(): Promise<string> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  for (let i = 0; i < 200; i += 1) {
    const code = Math.floor(Math.random() * 10000).toString().padStart(4, "0");
    const { data, error } = await supabaseAdmin
      .from("introducers")
      .select("id")
      .eq("company_code", code)
      .limit(1)
      .maybeSingle();
    if (error && !isMissingColumnOrTable(error)) throw new Error(error.message);
    if (!data) return code;
  }
  return Math.floor(Math.random() * 10000).toString().padStart(4, "0");
}

async function uniqueSlug(base: string): Promise<string> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  let candidate = slugify(base) || "introducer";
  let suffix = 0;
  while (suffix < 100) {
    const slug = suffix === 0 ? candidate : `${candidate}-${suffix}`;
    const { data } = await supabaseAdmin.from("introducers").select("id").eq("slug", slug).maybeSingle();
    if (!data) return slug;
    suffix += 1;
  }
  return `${candidate}-${crypto.randomUUID().slice(0, 8)}`;
}

export const resolveReferralSlug = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => z.object({ slug: z.string().min(1) }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: introducer, error } = await supabaseAdmin
      .from("introducers")
      .select("id, company_name, slug")
      .eq("slug", data.slug)
      .eq("active", true)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return introducer;
  });

export const checkIsIntroducer = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: roles } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    return { isIntroducer: (roles ?? []).some((r) => r.role === "introducer") };
  });

export const getIntroducerProfile = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: roles } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    if (!(roles ?? []).some((r) => r.role === "introducer")) {
      throw new Error("Forbidden");
    }

    const { data: existing } = await context.supabase
      .from("introducers")
      .select("*")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (existing) {
      // Backfill a company code for introducers created before company codes
      // existed (e.g. self-created profiles). Shared code → identifies a company.
      const existingCode = (existing as { company_code?: string | null }).company_code ?? null;
      if (!existingCode) {
        const code = await generateUniqueCompanyCode();
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { error: codeErr } = await supabaseAdmin
          .from("introducers")
          .update({ company_code: code })
          .eq("id", existing.id);
        if (!codeErr) return { ...existing, company_code: code };
      }
      return existing;
    }

    const { data: profile } = await context.supabase
      .from("profiles")
      .select("full_name, email")
      .eq("id", context.userId)
      .maybeSingle();

    const companyName = profile?.full_name?.trim() || profile?.email?.split("@")[0] || "Introducer";
    const slug = await uniqueSlug(companyName);
    const companyCode = await generateUniqueCompanyCode();

    const baseRecord = {
      user_id: context.userId,
      company_name: companyName,
      slug,
      contact_email: profile?.email ?? null,
    };
    const { data: created, error } = await context.supabase
      .from("introducers")
      .insert({ ...baseRecord, company_code: companyCode })
      .select()
      .single();
    if (error) {
      // Column not present yet (migration not applied) — create without the code.
      if (isMissingColumnOrTable(error)) {
        const { data: fallback, error: fbErr } = await context.supabase
          .from("introducers")
          .insert(baseRecord)
          .select()
          .single();
        if (fbErr) throw new Error(fbErr.message);
        return fallback;
      }
      throw new Error(error.message);
    }
    return created;
  });

export const updateIntroducerProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        companyName: z.string().min(2).max(80),
        contactEmail: z.string().email().optional().or(z.literal("")),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: introducer, error: fetchErr } = await context.supabase
      .from("introducers")
      .select("id")
      .eq("user_id", context.userId)
      .single();
    if (fetchErr) throw new Error(fetchErr.message);

    const { data: updated, error } = await context.supabase
      .from("introducers")
      .update({
        company_name: data.companyName,
        contact_email: data.contactEmail || null,
      })
      .eq("id", introducer.id)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return updated;
  });

export const createManualLead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        customerName: z.string().min(2),
        customerPhone: z.string().min(7),
        customerEmail: z.string().email().optional().or(z.literal("")),
        notes: z.string().max(500).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: introducer, error: introErr } = await context.supabase
      .from("introducers")
      .select("id")
      .eq("user_id", context.userId)
      .single();
    if (introErr) throw new Error(introErr.message);

    const { data: lead, error } = await context.supabase
      .from("introducer_leads")
      .insert({
        introducer_id: introducer.id,
        lead_source: "introducer_portal",
        channel: "manual",
        customer_name: data.customerName,
        customer_phone: data.customerPhone,
        customer_email: data.customerEmail || null,
        notes: data.notes || null,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return lead;
  });

const JOURNEY_ORDER = ["appointment_seen", "id_confirmed", "aip_completed"] as const;
const JOURNEY_LABELS: Record<string, string> = {
  appointment_seen: "Appointment seen",
  id_confirmed: "ID confirmed",
  aip_completed: "AIP completed",
};

function journeyStageLabel(completed: string[]): string {
  for (let i = JOURNEY_ORDER.length - 1; i >= 0; i -= 1) {
    if (completed.includes(JOURNEY_ORDER[i])) return JOURNEY_LABELS[JOURNEY_ORDER[i]];
  }
  return "Not started";
}

export const listIntroducerReferrals = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: introducer, error: introErr } = await context.supabase
      .from("introducers")
      .select("id, company_name, company_code")
      .eq("user_id", context.userId)
      .single();
    if (introErr) throw new Error(introErr.message);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [{ data: leads, error: leadsErr }, { data: appointments, error: apptErr }] =
      await Promise.all([
        supabaseAdmin
          .from("introducer_leads")
          .select("id, customer_name, status, lead_source, channel, created_at, appointment_id")
          .eq("introducer_id", introducer.id)
          .order("created_at", { ascending: false }),
        supabaseAdmin
          .from("appointments")
          .select(
            "id, status, lead_source, referral_channel, starts_at, customer_name, session_id, advisor_id, created_at",
          )
          .eq("introducer_id", introducer.id)
          .order("starts_at", { ascending: false }),
      ]);
    if (leadsErr) throw new Error(leadsErr.message);
    if (apptErr) throw new Error(apptErr.message);

    const sessionIds = Array.from(
      new Set(
        (appointments ?? [])
          .map((a) => a.session_id)
          .filter(Boolean) as string[],
      ),
    );

    const milestoneMap = new Map<string, string[]>();
    const trackingMap = new Map<string, string | null>();
    const sessionCreatedMap = new Map<string, string>();

    if (sessionIds.length > 0) {
      const { data: sessions } = await supabaseAdmin
        .from("interview_sessions")
        .select("id, started_at")
        .in("id", sessionIds);
      for (const s of sessions ?? []) sessionCreatedMap.set(s.id, s.started_at);

      try {
        const { data: milestones } = await supabaseAdmin
          .from("customer_journey_milestones")
          .select("session_id, milestone_key, completed_at")
          .in("session_id", sessionIds);
        for (const m of milestones ?? []) {
          const list = milestoneMap.get(m.session_id) ?? [];
          list.push(m.milestone_key);
          milestoneMap.set(m.session_id, list);
        }
      } catch {
        /* table may not exist yet */
      }

      try {
        const { data: tracking } = await supabaseAdmin
          .from("session_contact_tracking")
          .select("session_id, last_contacted_at")
          .in("session_id", sessionIds);
        for (const t of tracking ?? []) {
          trackingMap.set(t.session_id, t.last_contacted_at);
        }
      } catch {
        /* table may not exist yet */
      }
    }

    const advisorIds = Array.from(
      new Set((appointments ?? []).map((a) => a.advisor_id).filter(Boolean) as string[]),
    );
    const advisorNames = new Map<string, string>();
    if (advisorIds.length > 0) {
      const { data: profiles } = await supabaseAdmin
        .from("profiles")
        .select("id, full_name, email")
        .in("id", advisorIds);
      for (const p of profiles ?? []) {
        advisorNames.set(p.id, p.full_name || p.email || "Advisor");
      }
    }


    type IntroducerReferralRow = {
      id: string;
      customerName: string;
      journeyStage: string;
      leadSource: string;
      advisorName: string | null;
      daysAtStage: number;
      lastContactDate: string | null;
      createdAt: string;
      kind: "lead" | "appointment";
      leadId?: string;
      appointmentId?: string;
    };

    const rows: IntroducerReferralRow[] = [];
    const seenNames = new Set<string>();

    const leadSourceLabel = (source: string | null, channel: string | null): string => {
      if (source === "introducer_portal" || channel === "manual") {
        return introducer.company_name || "Your company";
      }
      if (source === "referral_link") return "Direct link";
      return "Direct";
    };

    const daysSince = (iso: string) =>
      Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24)));

    for (const lead of leads ?? []) {
      const key = lead.customer_name.toLowerCase();
      if (seenNames.has(key)) continue;
      seenNames.add(key);
      rows.push({
        id: lead.id,
        kind: "lead",
        leadId: lead.id,
        customerName: lead.customer_name,
        journeyStage: lead.status === "booked" ? "Appointment booked" : "Not started",
        leadSource: leadSourceLabel(lead.lead_source, lead.channel),
        advisorName: null,
        daysAtStage: daysSince(lead.created_at),
        lastContactDate: null,
        createdAt: lead.created_at,
      });
    }

    for (const appt of appointments ?? []) {
      const sessionId = appt.session_id;
      const completed = sessionId ? (milestoneMap.get(sessionId) ?? []) : [];
      const stage = sessionId ? journeyStageLabel(completed) : "Appointment booked";
      const stageStart = sessionId
        ? sessionCreatedMap.get(sessionId) ?? appt.created_at
        : appt.created_at;

      rows.push({
        id: appt.id,
        kind: "appointment",
        appointmentId: appt.id,
        customerName: appt.customer_name,
        journeyStage: stage,
        leadSource: leadSourceLabel(appt.lead_source, appt.referral_channel),
        advisorName: appt.advisor_id ? advisorNames.get(appt.advisor_id) ?? null : null,
        daysAtStage: daysSince(stageStart),
        lastContactDate: sessionId ? trackingMap.get(sessionId) ?? null : null,
        createdAt: appt.created_at,
      });
    }

    rows.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return { referrals: rows };
  });
