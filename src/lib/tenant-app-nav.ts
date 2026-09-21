/**
 * Map platform app paths onto tenant-scoped paths when a validated slug is present.
 * Slug is navigation/presentation only — never an access grant. Never defaults to 001.
 */
import { normalisePublicTenantSlug } from "./tenant-presentation.ts";

const PLATFORM_APP_TO = new Set([
  "/home",
  "/diary",
  "/cases",
  "/booking",
  "/introducer",
  "/companies",
  "/customers/$customerId",
  "/sessions/$sessionId",
  "/interview/$sessionId",
  "/chat/$sessionId",
  "/text/$sessionId",
]);

export type TenantAppNavInput = {
  to: string;
  params?: Record<string, string>;
  tenantSlug?: string | null;
};

export type TenantAppNavResult = {
  to: string;
  params?: Record<string, string>;
};

export function isPlatformAppTo(to: string): boolean {
  return PLATFORM_APP_TO.has(to);
}

/**
 * When tenantSlug is a validated public slug, rewrite platform app `to` values
 * to `/$tenantSlug/...`. Unknown/invalid/missing slug → unchanged (platform).
 * Never injects mortgageeasy / 001.
 */
export function remapAppNavigate(input: TenantAppNavInput): TenantAppNavResult {
  const slug = normalisePublicTenantSlug(input.tenantSlug);
  const to = input.to;
  if (!slug || to.startsWith("/$tenantSlug") || !isPlatformAppTo(to)) {
    return input.params ? { to, params: { ...input.params } } : { to };
  }
  return {
    to: `/$tenantSlug${to}`,
    params: { tenantSlug: slug, ...(input.params ?? {}) },
  };
}

/** Concrete href for full-page assigns. */
export function remapAppHref(input: TenantAppNavInput): string {
  const remapped = remapAppNavigate(input);
  if (!remapped.to.startsWith("/$tenantSlug")) {
    if (!input.params) return remapped.to;
    let href = remapped.to;
    for (const [key, value] of Object.entries(input.params)) {
      href = href.replace(`$${key}`, encodeURIComponent(value));
    }
    return href;
  }
  const slug = remapped.params?.tenantSlug;
  if (!slug) return "/";
  let path = remapped.to.replace("/$tenantSlug", `/${encodeURIComponent(slug)}`);
  for (const [key, value] of Object.entries(remapped.params ?? {})) {
    if (key === "tenantSlug") continue;
    path = path.replace(`$${key}`, encodeURIComponent(value));
  }
  return path;
}
