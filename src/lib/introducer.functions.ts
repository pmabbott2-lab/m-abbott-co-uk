import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { calculatorLeadInput } from "@/lib/introducer-calculator-lead.server";
import { z } from "zod";
import { normalisePublicTenantSlug } from "@/lib/tenant-presentation";

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
  .inputValidator((d: unknown) =>
    z
      .object({
        slug: z.string().min(1),
        /** When set, introducer must belong to this tenant slug. */
        tenantSlug: z.string().min(1).max(64).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const slug = data.slug.trim().toLowerCase();
    const { requireTenantFeature } = await import("@/lib/tenant-features.server");
    const { getTenantContextBySlug } = await import("@/lib/tenant-assert.server");

    let requiredTenantId: string | null = null;
    let tenantSlugOut: string | null = null;
    if (data.tenantSlug?.trim()) {
      const ctx = await getTenantContextBySlug(data.tenantSlug.trim());
      requiredTenantId = ctx.tenant.id;
      tenantSlugOut = ctx.tenant.slug;
      await requireTenantFeature(requiredTenantId, "appointment_booking");
      await requireTenantFeature(requiredTenantId, "introducer_journey");
    }

    // Prefer service-role (bypasses RLS). Fall back to public booking view so
    // /book/:slug still works if Azure SERVICE_ROLE_KEY is missing/mis-set.
    try {
      const { supabaseAdminUntyped: supabaseAdmin } = await import(
        "@/integrations/supabase/client.server"
      );
      let q = supabaseAdmin
        .from("introducers")
        .select("id, company_name, slug, tenant_id")
        .eq("slug", slug)
        .eq("active", true);
      if (requiredTenantId) q = q.eq("tenant_id", requiredTenantId);
      const { data: introducer, error } = await q.maybeSingle();
      if (!error && introducer) {
        if (!tenantSlugOut && introducer.tenant_id) {
          const { data: ten } = await supabaseAdmin
            .from("tenants")
            .select("slug, status")
            .eq("id", introducer.tenant_id)
            .eq("status", "active")
            .maybeSingle();
          tenantSlugOut = ten?.slug ?? null;
          if (introducer.tenant_id) {
            await requireTenantFeature(introducer.tenant_id, "appointment_booking");
          }
        }
        return {
          id: introducer.id,
          company_name: introducer.company_name,
          slug: introducer.slug,
          tenantId: introducer.tenant_id ?? null,
          tenantSlug: tenantSlugOut,
        };
      }
      if (requiredTenantId) return null;
    } catch (e) {
      console.error("resolveReferralSlug admin lookup failed", e);
    }

    if (requiredTenantId) return null;

    const { createClient } = await import("@supabase/supabase-js");
    const { getPublicSupabaseEnv } = await import("@/lib/supabase-public-env");
    const env = getPublicSupabaseEnv();
    if (!env.url || !env.publishableKey) {
      throw new Error("Supabase public env is not configured.");
    }
    const pub = createClient(env.url, env.publishableKey);
    const { data: row, error: pubErr } = await pub
      .from("introducer_public_booking")
      .select("id, company_name, slug")
      .eq("slug", slug)
      .maybeSingle();
    if (pubErr) throw new Error(pubErr.message);
    return row
      ? { ...row, tenantId: null as string | null, tenantSlug: null as string | null }
      : null;
  });

export const checkIsIntroducer = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        tenantSlug: z.string().min(1).max(64).optional(),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { resolveActingTenantRole } = await import("@/lib/tenant-role.server");
    const view = await resolveActingTenantRole(context.userId, data.tenantSlug ?? null);
    return { isIntroducer: view.isIntroducer };
  });

export type IntroducerListItem = {
  userId: string;
  full_name: string | null;
  email: string | null;
  company_name: string | null;
  slug: string | null;
  company_code: string | null;
};

/** Owner/supervisor — pick an introducer for Introducer view. */
export const listIntroducersForAdmin = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { resolveActingTenantRole, listTenantMemberUserIds } = await import(
      "@/lib/tenant-role.server"
    );
    const view = await resolveActingTenantRole(context.userId);
    if (!view.isOwner && !view.isSupervisor) throw new Error("Forbidden");
    if (!view.tenantId) return [] as IntroducerListItem[];

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const userIds = await listTenantMemberUserIds(view.tenantId, ["introducer"]);
    if (userIds.length === 0) return [] as IntroducerListItem[];

    const [{ data: profiles }, { data: introducers }] = await Promise.all([
      supabaseAdmin.from("profiles").select("id, full_name, email").in("id", userIds),
      supabaseAdmin
        .from("introducers")
        .select("user_id, company_name, slug, company_code")
        .in("user_id", userIds),
    ]);

    const introByUser = new Map((introducers ?? []).map((i) => [i.user_id, i]));

    return (profiles ?? [])
      .map((p) => {
        const intro = introByUser.get(p.id);
        return {
          userId: p.id,
          full_name: p.full_name,
          email: p.email,
          company_name: intro?.company_name ?? p.full_name,
          slug: intro?.slug ?? null,
          company_code: (intro as { company_code?: string | null } | undefined)?.company_code ?? null,
        };
      })
      .sort((a, b) =>
        (a.company_name || a.full_name || a.email || "").localeCompare(
          b.company_name || b.full_name || b.email || "",
        ),
      );
  });

async function assertIntroducerUser(userId: string, tenantId?: string | null): Promise<void> {
  const { resolveActingTenantRole, loadTenantRoleForTenantId } = await import(
    "@/lib/tenant-role.server"
  );
  const view = tenantId
    ? await loadTenantRoleForTenantId(userId, tenantId)
    : await resolveActingTenantRole(userId);
  if (!view.isIntroducer) {
    throw new Error("Not an introducer account");
  }
}

/** Owner/supervisor view-as introducer — returns target user id. */
export async function resolveViewAsIntroducer(
  actingUserId: string,
  email: string | null,
  viewAsIntroducerUserId?: string,
): Promise<{ targetUserId: string; viewAsMode: boolean }> {
  if (!viewAsIntroducerUserId) {
    return { targetUserId: actingUserId, viewAsMode: false };
  }
  const { resolveAdminAccess } = await import("@/lib/admin.functions");
  const access = await resolveAdminAccess(actingUserId, email);
  if (!access.isOwner && !access.isSupervisor) throw new Error("Forbidden");
  await assertIntroducerUser(viewAsIntroducerUserId);
  return { targetUserId: viewAsIntroducerUserId, viewAsMode: true };
}

async function activeTenantSlugForIntroducer(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: { from: (table: string) => any },
  introducer: { tenant_id?: string | null; user_id?: string | null } | null,
  fallbackUserId?: string,
): Promise<string | null> {
  const tenantId = introducer?.tenant_id ?? null;
  if (tenantId) {
    const { data: ten } = await admin
      .from("tenants")
      .select("slug, status")
      .eq("id", tenantId)
      .eq("status", "active")
      .maybeSingle();
    const slug = normalisePublicTenantSlug(ten?.slug);
    if (slug) return slug;
  }
  const userId = introducer?.user_id ?? fallbackUserId;
  if (!userId) return null;
  try {
    const { resolveSoleMembershipTenant } = await import("@/lib/tenant-assert.server");
    const authorised = await resolveSoleMembershipTenant(userId);
    return normalisePublicTenantSlug(authorised.tenant.slug);
  } catch {
    return null;
  }
}

export const getIntroducerProfile = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) =>
    z.object({ viewAsIntroducerUserId: z.string().uuid().optional() }).parse(d ?? {}),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    const {
      data: { user },
    } = await context.supabase.auth.getUser();
    const { resolveAdminAccess } = await import("@/lib/admin.functions");
    const access = await resolveAdminAccess(context.userId, user?.email ?? null);

    let targetUserId = context.userId;
    const viewAsMode = Boolean(data.viewAsIntroducerUserId);

    if (viewAsMode) {
      if (!access.isOwner && !access.isSupervisor) throw new Error("Forbidden");
      targetUserId = data.viewAsIntroducerUserId!;
      await assertIntroducerUser(targetUserId);
    } else {
      await assertIntroducerUser(context.userId);
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const client = viewAsMode ? supabaseAdmin : context.supabase;

    const { data: existing } = await client
      .from("introducers")
      .select("*")
      .eq("user_id", targetUserId)
      .maybeSingle();

    if (existing) {
      const existingCode = (existing as { company_code?: string | null }).company_code ?? null;
      if (!existingCode && !viewAsMode) {
        const code = await generateUniqueCompanyCode();
        const { error: codeErr } = await supabaseAdmin
          .from("introducers")
          .update({ company_code: code })
          .eq("id", existing.id);
        if (!codeErr) {
          const tenantSlug = await activeTenantSlugForIntroducer(supabaseAdmin, { ...existing, company_code: code }, targetUserId);
          return { ...existing, company_code: code, tenantSlug };
        }
      }
      const tenantSlug = await activeTenantSlugForIntroducer(supabaseAdmin, existing, targetUserId);
      return { ...existing, tenantSlug };
    }

    if (viewAsMode) {
      throw new Error("This introducer has no portal profile yet.");
    }

    const { data: profile } = await context.supabase
      .from("profiles")
      .select("full_name, email")
      .eq("id", targetUserId)
      .maybeSingle();

    const companyName = profile?.full_name?.trim() || profile?.email?.split("@")[0] || "Introducer";
    const slug = await uniqueSlug(companyName);
    const companyCode = await generateUniqueCompanyCode();

    const baseRecord = {
      user_id: targetUserId,
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
      if (isMissingColumnOrTable(error)) {
        const { data: fallback, error: fbErr } = await context.supabase
          .from("introducers")
          .insert(baseRecord)
          .select()
          .single();
        if (fbErr) throw new Error(fbErr.message);
        const tenantSlug = await activeTenantSlugForIntroducer(supabaseAdmin, fallback, targetUserId);
        return { ...fallback, tenantSlug };
      }
      throw new Error(error.message);
    }
    const tenantSlug = await activeTenantSlugForIntroducer(supabaseAdmin, created, targetUserId);
    return { ...created, tenantSlug };
  });

export const updateIntroducerProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        companyName: z.string().min(2).max(80),
        contactEmail: z.string().email().optional().or(z.literal("")),
        viewAsIntroducerUserId: z.string().uuid().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const {
      data: { user },
    } = await context.supabase.auth.getUser();
    const { targetUserId, viewAsMode } = await resolveViewAsIntroducer(
      context.userId,
      user?.email ?? null,
      data.viewAsIntroducerUserId,
    );

    if (!viewAsMode) {
      await assertIntroducerUser(context.userId);
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const client = viewAsMode ? supabaseAdmin : context.supabase;

    const { data: introducer, error: fetchErr } = await client
      .from("introducers")
      .select("id, company_name, contact_email")
      .eq("user_id", targetUserId)
      .single();
    if (fetchErr) throw new Error(fetchErr.message);

    const { data: updated, error } = await client
      .from("introducers")
      .update({
        company_name: data.companyName,
        contact_email: data.contactEmail || null,
      })
      .eq("id", introducer.id)
      .select()
      .single();
    if (error) throw new Error(error.message);

    if (viewAsMode) {
      const { logViewAsAudit } = await import("@/lib/view-as-audit.functions");
      await logViewAsAudit(supabaseAdmin, {
        viewType: "introducer",
        actingUserId: context.userId,
        targetUserId,
        action: "profile_update",
        summary: `Updated introducer profile: company "${data.companyName}"`,
        detail: {
          previousCompany: introducer.company_name,
          previousEmail: introducer.contact_email,
          newCompany: data.companyName,
          newEmail: data.contactEmail || null,
        },
      });
    }

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

const JOURNEY_ORDER = [
  "appointment_seen",
  "id_confirmed",
  "aip_completed",
  "offer_received",
  "completion",
] as const;
const JOURNEY_LABELS: Record<string, string> = {
  appointment_seen: "Appointment seen",
  id_confirmed: "Identity check",
  aip_completed: "AIP completed",
  offer_received: "Offer received",
  completion: "Completion",
};

function journeyStageLabel(completed: string[]): string {
  for (let i = JOURNEY_ORDER.length - 1; i >= 0; i -= 1) {
    if (completed.includes(JOURNEY_ORDER[i])) return JOURNEY_LABELS[JOURNEY_ORDER[i]];
  }
  return "Not started";
}

export const listIntroducerReferrals = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) =>
    z.object({ viewAsIntroducerUserId: z.string().uuid().optional() }).parse(d ?? {}),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    const {
      data: { user },
    } = await context.supabase.auth.getUser();
    const { resolveAdminAccess } = await import("@/lib/admin.functions");
    const access = await resolveAdminAccess(context.userId, user?.email ?? null);

    let targetUserId = context.userId;
    if (data.viewAsIntroducerUserId) {
      if (!access.isOwner && !access.isSupervisor) throw new Error("Forbidden");
      targetUserId = data.viewAsIntroducerUserId;
      await assertIntroducerUser(targetUserId);
    } else {
      await assertIntroducerUser(context.userId);
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: introducer, error: introErr } = await supabaseAdmin
      .from("introducers")
      .select("id, company_name, company_code")
      .eq("user_id", targetUserId)
      .single();
    if (introErr) throw new Error(introErr.message);

    const [{ data: leads, error: leadsErr }, { data: appointments, error: apptErr }] =
      await Promise.all([
        supabaseAdmin
          .from("introducer_leads")
          .select(
            "id, customer_name, customer_email, customer_phone, status, lead_source, channel, created_at, appointment_id",
          )
          .eq("introducer_id", introducer.id)
          .order("created_at", { ascending: false }),
        supabaseAdmin
          .from("appointments")
          .select(
            "id, status, lead_source, referral_channel, starts_at, customer_name, customer_email, customer_phone, session_id, advisor_id, created_at",
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
      customerPhone: string | null;
      customerEmail: string | null;
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
        customerPhone: lead.customer_phone ?? null,
        customerEmail: lead.customer_email ?? null,
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
        customerPhone: appt.customer_phone ?? null,
        customerEmail: appt.customer_email ?? null,
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

/** Public lead capture from MortgageEasy calculator embeds (no auth account created). */
export const captureIntroducerCalculatorLead = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => calculatorLeadInput.parse(d))
  .handler(async ({ data }) => {
    const { captureIntroducerCalculatorLead: capture } = await import(
      "@/lib/introducer-calculator-lead.server"
    );
    return capture(data);
  });
