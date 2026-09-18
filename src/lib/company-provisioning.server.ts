/**
 * Gate G6 — company provisioning (future Super Owner).
 *
 * Live createServerFn requires is_super_owner — no current user qualifies.
 * Test/harness uses provisionTenantInternal via service role (no platform_roles row).
 */
import { z } from "zod";
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdminUntyped as db } from "@/integrations/supabase/client.server";
import { isReservedTenantSlug } from "@/lib/tenant-presentation";
import { withForcedTenantId } from "@/lib/tenant-assert.server";

export class PlatformAuthorityError extends Error {
  readonly code = "PLATFORM_AUTHORITY_REQUIRED" as const;
  constructor(message = "Platform authority required.") {
    super(message);
    this.name = "PlatformAuthorityError";
  }
}

export const provisionInputSchema = z.object({
  tenantType: z.enum(["GROUP", "EXTERNAL"]),
  companyName: z.string().trim().min(2).max(120),
  tradingName: z.string().trim().max(120).optional().nullable(),
  slug: z.string().trim().min(2).max(64),
  companyEmail: z.string().trim().email().optional().nullable().or(z.literal("")),
  telephone: z.string().trim().max(40).optional().nullable(),
  websiteUrl: z.string().trim().max(300).optional().nullable(),
  legalName: z.string().trim().max(200).optional().nullable(),
  fcaDetails: z.string().trim().max(2000).optional().nullable(),
  primaryColour: z.string().trim().max(32).optional().nullable(),
  secondaryColour: z.string().trim().max(32).optional().nullable(),
  logoPath: z.string().trim().max(300).optional().nullable(),
  /** Feature keys to enable; others stay catalogue default (usually off). */
  enabledFeatures: z.array(z.string().min(1)).default([]),
  fromName: z.string().trim().max(120).optional().nullable(),
  emailFooter: z.string().trim().max(4000).optional().nullable(),
  smsFooter: z.string().trim().max(1000).optional().nullable(),
  regulatoryFooter: z.string().trim().max(4000).optional().nullable(),
  regulatory: z
    .object({
      companyNumber: z.string().max(40).optional(),
      registeredOffice: z.string().max(500).optional(),
      fcaFrn: z.string().max(40).optional(),
      privacyPolicyUrl: z.string().max(400).optional(),
      termsUrl: z.string().max(400).optional(),
      complaintsUrl: z.string().max(400).optional(),
      dataControllerWording: z.string().max(2000).optional(),
    })
    .optional(),
  initialOwner: z.object({
    email: z.string().trim().email(),
    fullName: z.string().trim().min(2).max(120).optional().nullable(),
  }),
  activate: z.boolean().default(true),
});

export type ProvisionInput = z.infer<typeof provisionInputSchema>;

export type ProvisionResult = {
  tenantId: string;
  companyCode: string;
  slug: string;
  tenantType: "GROUP" | "EXTERNAL";
  status: string;
  inviteToken: string;
  inviteExpiresAt: string | null;
};

export function normaliseSlug(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

export async function assertValidSlug(slugRaw: string): Promise<string> {
  const slug = normaliseSlug(slugRaw);
  if (!slug || slug.length < 2) throw new Error("Slug is required.");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new Error("Invalid slug format.");
  if (isReservedTenantSlug(slug)) throw new Error("That slug is reserved.");
  const { data: clash } = await db.from("tenants").select("id").eq("slug", slug).maybeSingle();
  if (clash) throw new Error("That slug is already in use.");
  return slug;
}

export async function isSuperOwner(userId: string): Promise<boolean> {
  const { data, error } = await db.rpc("is_super_owner", { p_user_id: userId });
  if (error) throw new Error(error.message);
  return data === true;
}

export async function requirePlatformProvisioningAuthority(userId: string): Promise<void> {
  if (!(await isSuperOwner(userId))) {
    throw new PlatformAuthorityError();
  }
}

async function allocateCompanyCode(): Promise<string> {
  const { data, error } = await db.rpc("allocate_next_company_code");
  if (error) throw new Error(error.message);
  if (!data || typeof data !== "string") throw new Error("Failed to allocate company code.");
  return data;
}

/**
 * Service-role orchestration for Create Company.
 * Does NOT copy Mortgage Easy branding/regulatory/Twilio/features.
 */
export async function provisionTenantInternal(
  raw: ProvisionInput,
  opts?: { createdBy?: string | null },
): Promise<ProvisionResult> {
  const input = provisionInputSchema.parse(raw);
  const slug = await assertValidSlug(input.slug);
  const companyCode = await allocateCompanyCode();

  const status = input.activate ? "active" : "provisioning";
  const { data: tenant, error: tErr } = await db
    .from("tenants")
    .insert({
      company_code: companyCode,
      slug,
      company_name: input.companyName,
      trading_name: input.tradingName || null,
      tenant_type: input.tenantType,
      status,
      website_url: input.websiteUrl || null,
      company_email: input.companyEmail || null,
      telephone: input.telephone || null,
      legal_name: input.legalName || null,
      fca_details: input.fcaDetails || null,
    })
    .select("id, company_code, slug, tenant_type, status")
    .single();
  if (tErr || !tenant) {
    throw new Error(tErr?.message || "Tenant create failed.");
  }

  const tenantId = tenant.id as string;

  try {
    const { error: bErr } = await db.from("tenant_branding").insert({
      tenant_id: tenantId,
      logo_path: input.logoPath || null,
      primary_colour: input.primaryColour || null,
      secondary_colour: input.secondaryColour || null,
    });
    if (bErr) throw new Error(bErr.message);

    const { error: cErr } = await db.from("tenant_comms_config").insert({
      tenant_id: tenantId,
      from_name: input.fromName || null,
      email_footer: input.emailFooter || null,
      sms_footer: input.smsFooter || null,
      regulatory_footer: input.regulatoryFooter || null,
    });
    if (cErr) throw new Error(cErr.message);

    const { error: sErr } = await db.from("tenant_settings").insert({
      tenant_id: tenantId,
      feature_flags: {},
      diary_defaults: {},
      telephony_defaults: {},
      regulatory: input.regulatory ?? {},
    });
    if (sErr) throw new Error(sErr.message);

    // Neutral defaults: only explicitly selected features enabled.
    // Never copy 001 feature set.
    for (const key of input.enabledFeatures) {
      if (key === "password_recovery") continue;
      const { error: fErr } = await db.from("tenant_features").upsert(
        {
          tenant_id: tenantId,
          feature_key: key,
          state: "enabled",
        },
        { onConflict: "tenant_id,feature_key" },
      );
      if (fErr) throw new Error(fErr.message);
    }

    // Communication settings shell (tenant-scoped)
    try {
      await db.from("communication_settings").insert(
        withForcedTenantId(
          {
            email_regulatory_footer: input.regulatoryFooter || "",
            sms_regulatory_footer: input.smsFooter || "",
          },
          tenantId,
        ),
      );
    } catch {
      // table shape may vary — non-fatal if already covered by tenant_comms_config
    }

    const expires = new Date(Date.now() + 7 * 24 * 3600_000).toISOString();
    // app_role has no 'owner' — use admin + membership_role=owner (G6).
    const { data: invite, error: iErr } = await db
      .from("staff_invitations")
      .insert(
        withForcedTenantId(
          {
            role: "admin",
            membership_role: "owner",
            email: input.initialOwner.email.toLowerCase(),
            create_company: false,
            company_code: null,
            company_name: input.companyName,
            created_by: opts?.createdBy ?? null,
            expires_at: expires,
          },
          tenantId,
        ),
      )
      .select("token, expires_at")
      .single();
    if (iErr || !invite) throw new Error(iErr?.message || "Owner invite failed.");

    return {
      tenantId,
      companyCode: tenant.company_code,
      slug: tenant.slug,
      tenantType: tenant.tenant_type,
      status: tenant.status,
      inviteToken: invite.token,
      inviteExpiresAt: invite.expires_at ?? null,
    };
  } catch (e) {
    // Best-effort rollback of partial tenant
    await db.from("staff_invitations").delete().eq("tenant_id", tenantId);
    await db.from("tenant_features").delete().eq("tenant_id", tenantId);
    await db.from("tenant_settings").delete().eq("tenant_id", tenantId);
    await db.from("tenant_comms_config").delete().eq("tenant_id", tenantId);
    await db.from("tenant_branding").delete().eq("tenant_id", tenantId);
    await db.from("communication_settings").delete().eq("tenant_id", tenantId);
    await db.from("tenants").delete().eq("id", tenantId);
    throw e;
  }
}

export async function destroyProvisionedTenant(tenantId: string): Promise<void> {
  await db.from("staff_invitations").delete().eq("tenant_id", tenantId);
  await db.from("tenant_memberships").delete().eq("tenant_id", tenantId);
  await db.from("tenant_features").delete().eq("tenant_id", tenantId);
  await db.from("tenant_settings").delete().eq("tenant_id", tenantId);
  await db.from("tenant_comms_config").delete().eq("tenant_id", tenantId);
  await db.from("tenant_branding").delete().eq("tenant_id", tenantId);
  await db.from("communication_settings").delete().eq("tenant_id", tenantId);
  await db.from("tenant_support_access_grants").delete().eq("tenant_id", tenantId);
  await db.from("tenant_emergency_access_grants").delete().eq("tenant_id", tenantId);
  await db.from("tenants").delete().eq("id", tenantId);
}

/** Authenticated Super Owner only — DENY for all current users. */
export const provisionCompany = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => provisionInputSchema.parse(d))
  .handler(async ({ data, context }) => {
    await requirePlatformProvisioningAuthority(context.userId);
    return provisionTenantInternal(data, { createdBy: context.userId });
  });

export const canAccessPlatformCompanies = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const ok = await isSuperOwner(context.userId);
    return { ok };
  });

export const listPlatformCompanies = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requirePlatformProvisioningAuthority(context.userId);
    const { data, error } = await db
      .from("tenants")
      .select("id, company_code, slug, company_name, trading_name, tenant_type, status, website_url")
      .order("company_code");
    if (error) throw new Error(error.message);
    return data ?? [];
  });
