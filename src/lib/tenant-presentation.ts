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
  /** From tenant_features — read-only at G4; enforcement is G5. */
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
]);

export function isReservedTenantSlug(slug: string): boolean {
  return RESERVED_TENANT_SLUGS.has(slug.trim().toLowerCase());
}

export function buildTenantPageTitle(companyName: string): string {
  return `${companyName} | Mortgage Hub`;
}
