/**
 * Gate G6 — tenant company settings (Owner / Supervisor).
 * Does NOT grant Create Company / platform provisioning.
 */
import { z } from "zod";
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdminUntyped as db } from "@/integrations/supabase/client.server";
import { resolveAdminAccess } from "@/lib/admin.functions";
import {
  resolveSoleMembershipTenant,
  requireAuthenticatedTenantAdmin,
  withForcedTenantId,
  TenantContextError,
} from "@/lib/tenant-assert.server";
import type { FeatureState } from "@/lib/tenant-features.server";

const FEATURE_DEPS: Record<string, { requires?: string[]; note?: string }> = {
  appointment_booking: {
    requires: ["teams_calendar"],
    note: "Booking works without Teams, but calendar sync needs teams_calendar.",
  },
  customer_case_hub: {
    requires: ["customer_portal"],
    note: "Case hub assumes customer portal access.",
  },
  telephone_voice: {
    note: "Requires dedicated telephony configuration (Twilio subaccount — later gate).",
  },
  sms_notifications: {
    note: "Requires SMS transport configuration (Twilio — later gate).",
  },
  susan_ai_journey: {
    note: "Requires avatar / TTS / STT services when enabled.",
  },
  susan_chat_journey: {
    note: "Typed chat; independent of avatar but still AI-backed.",
  },
};

export type CompanySettingsSection =
  | "overview"
  | "details"
  | "branding"
  | "regulatory"
  | "features"
  | "communications"
  | "staff"
  | "telephony";

async function requireCompanySettingsEditor(userId: string, email?: string) {
  const access = await resolveAdminAccess(userId, email);
  if (!access.isOwner && !access.isSupervisor) {
    throw new Error("Only Owner or Supervisor can edit company settings.");
  }
  const authorised = await resolveSoleMembershipTenant(userId);
  await requireAuthenticatedTenantAdmin(userId, authorised.tenant.id);
  return { access, authorised };
}

/** Owner-only for classification / status (platform fields). Tenant Owner cannot change tenant_type or status. */
async function requireOwnerSettings(userId: string, email?: string) {
  const ctx = await requireCompanySettingsEditor(userId, email);
  if (!ctx.access.isOwner) throw new Error("Owner only.");
  return ctx;
}

export const getCompanySettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const email = (context.claims as { email?: string }).email;
    const { access, authorised } = await requireCompanySettingsEditor(context.userId, email);
    const tenantId = authorised.tenant.id;

    const [
      { data: tenant },
      { data: branding },
      { data: comms },
      { data: settings },
      { data: features },
      { data: catalogue },
      { data: memberships },
      { data: legacyComms },
    ] = await Promise.all([
      db
        .from("tenants")
        .select(
          "id, company_code, slug, company_name, trading_name, tenant_type, status, website_url, company_email, telephone, legal_name, fca_details",
        )
        .eq("id", tenantId)
        .single(),
      db
        .from("tenant_branding")
        .select("logo_path, primary_colour, secondary_colour")
        .eq("tenant_id", tenantId)
        .maybeSingle(),
      db
        .from("tenant_comms_config")
        .select("from_name, email_footer, sms_footer, regulatory_footer")
        .eq("tenant_id", tenantId)
        .maybeSingle(),
      db
        .from("tenant_settings")
        .select("regulatory, telephony_defaults, feature_flags")
        .eq("tenant_id", tenantId)
        .maybeSingle(),
      db
        .from("tenant_features")
        .select("feature_key, state")
        .eq("tenant_id", tenantId),
      db
        .from("feature_catalogue")
        .select("feature_key, name, description, category, default_enabled, sort_order, active")
        .eq("active", true)
        .order("sort_order"),
      db
        .from("tenant_memberships")
        .select("id, user_id, role, active, created_at")
        .eq("tenant_id", tenantId)
        .order("created_at"),
      db
        .from("communication_settings")
        .select("email_regulatory_footer, sms_regulatory_footer")
        .eq("tenant_id", tenantId)
        .maybeSingle(),
    ]);

    if (!tenant) throw new Error("Tenant not found.");

    const userIds = [...new Set((memberships ?? []).map((m: { user_id: string }) => m.user_id))];
    const { data: profiles } =
      userIds.length > 0
        ? await db.from("profiles").select("id, full_name, email").in("id", userIds)
        : { data: [] };

    const profileMap = new Map(
      (profiles ?? []).map((p: { id: string; full_name: string | null; email: string | null }) => [
        p.id,
        p,
      ]),
    );

    const overrideMap = new Map(
      (features ?? []).map((f: { feature_key: string; state: string }) => [f.feature_key, f.state]),
    );

    const featureRows = (catalogue ?? []).map(
      (c: {
        feature_key: string;
        name: string;
        description: string | null;
        category: string;
        default_enabled: boolean;
        sort_order: number;
      }) => {
        const explicit = overrideMap.get(c.feature_key) as FeatureState | undefined;
        const effectiveEnabled =
          explicit != null ? explicit === "enabled" : Boolean(c.default_enabled);
        const dep = FEATURE_DEPS[c.feature_key];
        return {
          featureKey: c.feature_key,
          name: c.name,
          description: c.description,
          category: c.category,
          defaultEnabled: c.default_enabled,
          explicitState: explicit ?? null,
          effectiveEnabled,
          dependency: dep ?? null,
        };
      },
    );

    const regulatory = (settings?.regulatory ?? {}) as Record<string, string>;

    return {
      canEdit: true,
      isOwner: access.isOwner,
      isSupervisor: access.isSupervisor,
      // Platform-only fields — visible but not editable by tenant Owner
      platformFieldsReadOnly: true,
      tenant: {
        id: tenant.id,
        companyCode: tenant.company_code,
        slug: tenant.slug,
        companyName: tenant.company_name,
        tradingName: tenant.trading_name,
        tenantType: tenant.tenant_type,
        status: tenant.status,
        websiteUrl: tenant.website_url,
        companyEmail: tenant.company_email,
        telephone: tenant.telephone,
        legalName: tenant.legal_name,
        fcaDetails: tenant.fca_details,
      },
      branding: branding ?? {
        logo_path: null,
        primary_colour: null,
        secondary_colour: null,
      },
      regulatory: {
        companyNumber: regulatory.companyNumber ?? "",
        registeredOffice: regulatory.registeredOffice ?? "",
        fcaFrn: regulatory.fcaFrn ?? "",
        privacyPolicyUrl: regulatory.privacyPolicyUrl ?? "",
        termsUrl: regulatory.termsUrl ?? "",
        complaintsUrl: regulatory.complaintsUrl ?? "",
        dataControllerWording: regulatory.dataControllerWording ?? "",
        legalName: tenant.legal_name ?? "",
        tradingName: tenant.trading_name ?? "",
        fcaDetails: tenant.fca_details ?? "",
        notConfigured: !(
          tenant.legal_name ||
          tenant.fca_details ||
          regulatory.fcaFrn ||
          regulatory.privacyPolicyUrl ||
          tenant.website_url ||
          tenant.telephone ||
          tenant.company_email
        ),
      },
      communications: {
        fromName: comms?.from_name ?? null,
        emailFooter: comms?.email_footer ?? null,
        smsFooter: comms?.sms_footer ?? null,
        regulatoryFooter: comms?.regulatory_footer ?? null,
        legacyEmailFooter: legacyComms?.email_regulatory_footer ?? null,
        legacySmsFooter: legacyComms?.sms_regulatory_footer ?? null,
      },
      features: featureRows,
      staff: (memberships ?? []).map(
        (m: { id: string; user_id: string; role: string; active: boolean; created_at: string }) => {
          const p = profileMap.get(m.user_id) as
            | { full_name: string | null; email: string | null }
            | undefined;
          return {
            membershipId: m.id,
            userId: m.user_id,
            role: m.role,
            active: m.active,
            createdAt: m.created_at,
            fullName: p?.full_name ?? null,
            email: p?.email ?? null,
          };
        },
      ),
      telephony: {
        status: "placeholder",
        message:
          "Dedicated Twilio subaccount / numbers are provisioned in a later gate. No numbers or webhooks are changed here.",
        defaults: settings?.telephony_defaults ?? {},
      },
      routePreview: `mymortgagehub.uk/${tenant.slug}`,
    };
  });

const detailsSchema = z.object({
  companyName: z.string().trim().min(2).max(120),
  tradingName: z.string().trim().max(120).optional().nullable(),
  companyEmail: z.string().trim().email().optional().nullable().or(z.literal("")),
  telephone: z.string().trim().max(40).optional().nullable(),
  websiteUrl: z.string().trim().max(300).optional().nullable(),
  legalName: z.string().trim().max(200).optional().nullable(),
});

export const updateCompanyDetails = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => detailsSchema.parse(d))
  .handler(async ({ data, context }) => {
    const email = (context.claims as { email?: string }).email;
    const { authorised } = await requireCompanySettingsEditor(context.userId, email);
    const { error } = await db
      .from("tenants")
      .update({
        company_name: data.companyName,
        trading_name: data.tradingName || null,
        company_email: data.companyEmail || null,
        telephone: data.telephone || null,
        website_url: data.websiteUrl || null,
        legal_name: data.legalName || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", authorised.tenant.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const brandingSchema = z.object({
  logoPath: z.string().trim().max(300).optional().nullable(),
  primaryColour: z.string().trim().max(32).optional().nullable(),
  secondaryColour: z.string().trim().max(32).optional().nullable(),
});

export const updateCompanyBranding = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => brandingSchema.parse(d))
  .handler(async ({ data, context }) => {
    const email = (context.claims as { email?: string }).email;
    const { authorised } = await requireCompanySettingsEditor(context.userId, email);
    const tenantId = authorised.tenant.id;
    const { error } = await db.from("tenant_branding").upsert(
      {
        tenant_id: tenantId,
        logo_path: data.logoPath || null,
        primary_colour: data.primaryColour || null,
        secondary_colour: data.secondaryColour || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "tenant_id" },
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const regulatorySchema = z.object({
  legalName: z.string().trim().max(200).optional().nullable(),
  tradingName: z.string().trim().max(120).optional().nullable(),
  fcaDetails: z.string().trim().max(2000).optional().nullable(),
  companyNumber: z.string().trim().max(40).optional().nullable(),
  registeredOffice: z.string().trim().max(500).optional().nullable(),
  fcaFrn: z.string().trim().max(40).optional().nullable(),
  privacyPolicyUrl: z.string().trim().max(400).optional().nullable(),
  termsUrl: z.string().trim().max(400).optional().nullable(),
  complaintsUrl: z.string().trim().max(400).optional().nullable(),
  dataControllerWording: z.string().trim().max(2000).optional().nullable(),
});

export const updateCompanyRegulatory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => regulatorySchema.parse(d))
  .handler(async ({ data, context }) => {
    const email = (context.claims as { email?: string }).email;
    const { authorised } = await requireCompanySettingsEditor(context.userId, email);
    const tenantId = authorised.tenant.id;

    const { error: tErr } = await db
      .from("tenants")
      .update({
        legal_name: data.legalName || null,
        trading_name: data.tradingName || null,
        fca_details: data.fcaDetails || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", tenantId);
    if (tErr) throw new Error(tErr.message);

    const regulatory = {
      companyNumber: data.companyNumber || "",
      registeredOffice: data.registeredOffice || "",
      fcaFrn: data.fcaFrn || "",
      privacyPolicyUrl: data.privacyPolicyUrl || "",
      termsUrl: data.termsUrl || "",
      complaintsUrl: data.complaintsUrl || "",
      dataControllerWording: data.dataControllerWording || "",
    };

    const { data: existing } = await db
      .from("tenant_settings")
      .select("tenant_id")
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (existing) {
      const { error } = await db
        .from("tenant_settings")
        .update({ regulatory, updated_at: new Date().toISOString() })
        .eq("tenant_id", tenantId);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await db.from("tenant_settings").insert({
        tenant_id: tenantId,
        feature_flags: {},
        diary_defaults: {},
        telephony_defaults: {},
        regulatory,
      });
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

const featureToggleSchema = z.object({
  featureKey: z.string().min(1).max(80),
  enabled: z.boolean(),
});

/**
 * Owner/Supervisor: simple ON/OFF → enabled|disabled.
 * Does not expose entitlement_blocked / rollout_hidden (platform Super Owner later).
 * password_recovery cannot be forced off via this UI (retained-account safety).
 */
export const updateCompanyFeature = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => featureToggleSchema.parse(d))
  .handler(async ({ data, context }) => {
    const email = (context.claims as { email?: string }).email;
    const { authorised } = await requireCompanySettingsEditor(context.userId, email);
    if (data.featureKey === "password_recovery" && !data.enabled) {
      throw new Error("Password recovery cannot be disabled from company settings.");
    }
    const { data: cat } = await db
      .from("feature_catalogue")
      .select("feature_key")
      .eq("feature_key", data.featureKey)
      .eq("active", true)
      .maybeSingle();
    if (!cat) throw new Error("Unknown feature.");

    const state: FeatureState = data.enabled ? "enabled" : "disabled";
    const { error } = await db.from("tenant_features").upsert(
      {
        tenant_id: authorised.tenant.id,
        feature_key: data.featureKey,
        state,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "tenant_id,feature_key" },
    );
    if (error) throw new Error(error.message);
    return { ok: true, state };
  });

const commsSchema = z.object({
  fromName: z.string().trim().max(120).optional().nullable(),
  emailFooter: z.string().trim().max(4000).optional().nullable(),
  smsFooter: z.string().trim().max(1000).optional().nullable(),
  regulatoryFooter: z.string().trim().max(4000).optional().nullable(),
});

export const updateCompanyCommunications = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => commsSchema.parse(d))
  .handler(async ({ data, context }) => {
    const email = (context.claims as { email?: string }).email;
    const { authorised } = await requireCompanySettingsEditor(context.userId, email);
    const tenantId = authorised.tenant.id;
    const { error } = await db.from("tenant_comms_config").upsert(
      {
        tenant_id: tenantId,
        from_name: data.fromName || null,
        email_footer: data.emailFooter || null,
        sms_footer: data.smsFooter || null,
        regulatory_footer: data.regulatoryFooter || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "tenant_id" },
    );
    if (error) throw new Error(error.message);

    // Keep legacy communication_settings footers in sync when a row exists.
    await db
      .from("communication_settings")
      .update({
        email_regulatory_footer: data.regulatoryFooter || "",
        sms_regulatory_footer: data.smsFooter || "",
        updated_at: new Date().toISOString(),
        updated_by: context.userId,
      })
      .eq("tenant_id", tenantId);

    return { ok: true };
  });

/**
 * Remove tenant access only — never deletes Auth identity.
 * Soft-deactivates membership rows for this tenant.
 */
export const revokeTenantStaffAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ userId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const email = (context.claims as { email?: string }).email;
    const { authorised } = await requireOwnerSettings(context.userId, email);
    if (data.userId === context.userId) {
      throw new Error("You cannot remove your own tenant access.");
    }
    const tenantId = authorised.tenant.id;

    const { data: rows } = await db
      .from("tenant_memberships")
      .select("id, role, active")
      .eq("tenant_id", tenantId)
      .eq("user_id", data.userId);
    if (!rows?.length) throw new Error("Membership not found.");
    if (rows.some((r: { role: string }) => r.role === "owner")) {
      throw new Error("Cannot remove an Owner membership from company settings.");
    }

    const { error } = await db
      .from("tenant_memberships")
      .update({ active: false })
      .eq("tenant_id", tenantId)
      .eq("user_id", data.userId);
    if (error) throw new Error(error.message);
    return { ok: true, authIdentityPreserved: true };
  });

/** Explicit deny helpers for tests / future Super Owner gates. */
export async function assertTenantOwnerCannotProvision(userId: string): Promise<void> {
  const { isSuperOwner, PlatformAuthorityError } = await import(
    "@/lib/company-provisioning.server"
  );
  if (await isSuperOwner(userId)) return;
  throw new PlatformAuthorityError();
}

export function getFeatureDependencyInfo(featureKey: string) {
  return FEATURE_DEPS[featureKey] ?? null;
}

export { TenantContextError, withForcedTenantId };
