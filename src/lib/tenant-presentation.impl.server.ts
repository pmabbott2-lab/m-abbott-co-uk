/**
 * Server-only tenant presentation implementation.
 * Imported only from createServerFn handlers — never from client route modules.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  TenantContextError,
  getTenantContextBySlug,
  hasTenantMembership,
  resolveTenantBySlug,
} from "@/lib/tenant-context.server";
import {
  buildTenantPageTitle,
  isReservedTenantSlug,
  normalisePublicTenantSlug,
  type TenantPresentation,
  type TenantSlugLayoutResult,
} from "@/lib/tenant-presentation";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabaseAdmin as any;

function publicLogoUrl(logoPath: string | null | undefined): string | null {
  if (!logoPath?.trim()) return null;
  const p = logoPath.trim();
  if (p.startsWith("http://") || p.startsWith("https://") || p.startsWith("/")) return p;
  return `/tenant-branding/${p.replace(/^\/+/, "")}`;
}

export async function resolveActiveTenantPublicNav(
  tenantId: string | null | undefined,
): Promise<{ slug: string; displayName: string } | null> {
  if (!tenantId) return null;
  const { data } = await db
    .from("tenants")
    .select("slug, status, company_name, trading_name")
    .eq("id", tenantId)
    .maybeSingle();
  if (!data || data.status !== "active") return null;
  const slug = normalisePublicTenantSlug(data.slug);
  if (!slug) return null;
  const displayName = String(data.trading_name || data.company_name || "").trim();
  if (!displayName) return null;
  return { slug, displayName };
}

export async function loadTenantPresentationBySlug(slug: string): Promise<TenantPresentation> {
  const normalised = slug.trim().toLowerCase();
  if (!normalised || isReservedTenantSlug(normalised)) {
    throw new TenantContextError("TENANT_NOT_FOUND", `Unknown tenant slug '${normalised}'.`);
  }

  const ctx = await getTenantContextBySlug(normalised);
  const tenant = ctx.tenant;

  const { getTenantFeatureFlags } = await import("@/lib/tenant-features.server");
  const [{ data: full }, { data: branding }, features] = await Promise.all([
    db
      .from("tenants")
      .select(
        "id, company_code, slug, company_name, trading_name, status, tenant_type, website_url, company_email, telephone, legal_name",
      )
      .eq("id", tenant.id)
      .maybeSingle(),
    db
      .from("tenant_branding")
      .select("logo_path, primary_colour, secondary_colour")
      .eq("tenant_id", tenant.id)
      .maybeSingle(),
    getTenantFeatureFlags(tenant.id),
  ]);

  if (!full) {
    throw new TenantContextError("TENANT_NOT_FOUND", `Unknown tenant slug '${normalised}'.`);
  }

  const logoUrl = publicLogoUrl(branding?.logo_path ?? null);
  const primary = branding?.primary_colour ?? null;
  const secondary = branding?.secondary_colour ?? null;
  const usedNeutralFallback = !logoUrl && !primary && !secondary;

  return {
    tenantId: full.id,
    companyCode: full.company_code,
    slug: full.slug,
    companyName: full.company_name,
    tradingName: full.trading_name ?? null,
    tenantType: full.tenant_type,
    status: full.status,
    websiteUrl: full.website_url ?? null,
    companyEmail: full.company_email ?? null,
    telephone: full.telephone ?? null,
    legalName: full.legal_name ?? null,
    logoUrl,
    primaryColour: primary,
    secondaryColour: secondary,
    features,
    susanEnabled: features.susan_ai_journey === true,
    usedNeutralFallback,
    pageTitle: buildTenantPageTitle(full.trading_name || full.company_name),
  };
}

export async function peekTenantBySlug(slug: string) {
  const normalised = slug.trim().toLowerCase();
  if (!normalised || isReservedTenantSlug(normalised)) {
    throw new TenantContextError("TENANT_NOT_FOUND", `Unknown tenant slug '${normalised}'.`);
  }
  return resolveTenantBySlug(normalised);
}

export async function getTenantSlugLayout(slug: string): Promise<TenantSlugLayoutResult> {
  try {
    const record = await peekTenantBySlug(slug);
    if (record.status !== "active") {
      return { status: "inactive", inactiveName: record.companyName };
    }
    const tenant = await loadTenantPresentationBySlug(slug);
    return { status: "ok", tenant };
  } catch (e) {
    if (e instanceof TenantContextError && e.code === "TENANT_NOT_FOUND") {
      return { status: "not_found" };
    }
    throw e;
  }
}

export async function checkTenantMembership(slug: string, userId: string) {
  const presentation = await loadTenantPresentationBySlug(slug);
  const member = await hasTenantMembership(userId, presentation.tenantId);
  return { member, tenantId: presentation.tenantId, companyCode: presentation.companyCode };
}

export async function listActiveTenantSummaries() {
  const { data, error } = await db
    .from("tenants")
    .select("slug, company_name, trading_name, company_code, status")
    .eq("status", "active")
    .order("company_code");
  if (error) throw new Error(error.message);
  return (data ?? []).map(
    (t: {
      slug: string;
      company_name: string;
      trading_name: string | null;
      company_code: string;
      status: string;
    }) => ({
      slug: t.slug,
      companyName: t.trading_name || t.company_name,
      companyCode: t.company_code,
    }),
  );
}
