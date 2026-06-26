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
    if (existing) return existing;

    const { data: profile } = await context.supabase
      .from("profiles")
      .select("full_name, email")
      .eq("id", context.userId)
      .maybeSingle();

    const companyName = profile?.full_name?.trim() || profile?.email?.split("@")[0] || "Introducer";
    const slug = await uniqueSlug(companyName);

    const { data: created, error } = await context.supabase
      .from("introducers")
      .insert({
        user_id: context.userId,
        company_name: companyName,
        slug,
        contact_email: profile?.email ?? null,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
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

export const listIntroducerReferrals = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: introducer, error: introErr } = await context.supabase
      .from("introducers")
      .select("id")
      .eq("user_id", context.userId)
      .single();
    if (introErr) throw new Error(introErr.message);

    const [{ data: leads, error: leadsErr }, { data: sessions, error: sessionsErr }] = await Promise.all([
      context.supabase
        .from("introducer_leads")
        .select("*")
        .eq("introducer_id", introducer.id)
        .order("created_at", { ascending: false }),
      context.supabase
        .from("interview_sessions")
        .select("id, status, lead_source, referral_channel, started_at, submitted_at")
        .eq("introducer_id", introducer.id)
        .order("started_at", { ascending: false }),
    ]);
    if (leadsErr) throw new Error(leadsErr.message);
    if (sessionsErr) throw new Error(sessionsErr.message);

    return { leads: leads ?? [], sessions: sessions ?? [] };
  });
