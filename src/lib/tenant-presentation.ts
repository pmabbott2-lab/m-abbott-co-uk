/**
 * Gate G4 — safe public tenant presentation (shared types).
 * No secrets. Slug alone is not authorisation.
 */

export type TenantPresentation = {
  tenantId: string;
  companyCode: string;
  slug: string;
  companyName: string;
  tradingName: string | null;
  tenantType: "GROUP" | "EXTERNAL";
  status: string;
  websiteUrl: string | null;
  companyEmail: string | null;
  telephone: string | null;
  legalName: string | null;
  /** Public path or absolute URL; never a credential. */
  logoUrl: string | null;
  primaryColour: string | null;
  secondaryColour: string | null;
  /** Effective feature flags (G5). */
  features: Record<string, boolean>;
  /** Convenience: features.susan_ai_journey */
  susanEnabled: boolean;
  /** True when branding used platform-neutral fallback (not another tenant's brand). */
  usedNeutralFallback: boolean;
  pageTitle: string;
};

export type PlatformPresentation = {
  kind: "platform";
  productName: "Mortgage Hub";
  pageTitle: "Mortgage Hub";
};

/** Result of the tenant layout server fn — no secrets. */
export type TenantSlugLayoutResult =
  | { status: "not_found" }
  | { status: "inactive"; inactiveName: string | null }
  | { status: "ok"; tenant: TenantPresentation };

/** First-path segments reserved by the Hub SPA — never treat as tenant slugs. */
export const RESERVED_TENANT_SLUGS = new Set([
  "api",
  "auth",
  "register",
  "book",
  "go",
  "raf",
  "ref",
  "home",
  "diary",
  "cases",
  "booking",
  "introducer",
  "customers",
  "sessions",
  "interview",
  "chat",
  "text",
  "assets",
  "tenant-branding",
  "companies",
  "settings",
  "workspace",
  "login",
  "platform",
]);

export function isReservedTenantSlug(slug: string): boolean {
  return RESERVED_TENANT_SLUGS.has(slug.trim().toLowerCase());
}

/** Presentation/navigation slug only — never an access grant. */
export function normalisePublicTenantSlug(value: string | null | undefined): string | null {
  const slug = (value ?? "").trim().toLowerCase();
  if (!slug || !/^[a-z0-9-]{2,64}$/.test(slug) || isReservedTenantSlug(slug)) return null;
  return slug;
}

export function buildTenantPageTitle(companyName: string): string {
  return `${companyName} | Mortgage Hub`;
}
