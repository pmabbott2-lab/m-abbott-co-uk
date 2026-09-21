/**
 * Canonical public URL for Mortgage Hub (Azure).
 * Prefer this over legacy ngrok whenever we are serving production.
 */
import { normalisePublicTenantSlug } from "@/lib/tenant-presentation";
export const MMH_PUBLIC_URL = "https://mymortgagehub.uk";

function stripSlash(url: string): string {
  return url.replace(/\/$/, "");
}

function isNgrokUrl(url: string): boolean {
  return /ngrok/i.test(url);
}

function hostLooksLikeMmh(host: string | null | undefined): boolean {
  if (!host) return false;
  const h = host.split(":")[0]?.toLowerCase() ?? "";
  return h === "mymortgagehub.uk" || h.endsWith(".mymortgagehub.uk") || h.includes("mortgagehub-prod");
}

function isAzureWebApp(): boolean {
  return Boolean(process.env.WEBSITE_SITE_NAME?.trim() || process.env.WEBSITE_HOSTNAME?.trim());
}

/** Server-side canonical app URL for auth emails, SMS links, Teams OAuth. */
export function getServerAppOrigin(request?: Request): string {
  // Request host wins when the live Hub is hit (stops stale ngrok env leaking into emails).
  if (request) {
    const xfHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
    const host = xfHost || request.headers.get("host")?.trim();
    if (hostLooksLikeMmh(host)) return MMH_PUBLIC_URL;
  }

  const fromEnv =
    process.env.APP_BASE_URL?.trim() ||
    process.env.VITE_APP_URL?.trim() ||
    process.env.APP_URL?.trim();

  if (fromEnv) {
    const cleaned = stripSlash(fromEnv);
    // On Azure, never honour a leftover ngrok base URL.
    if (isAzureWebApp() && isNgrokUrl(cleaned)) return MMH_PUBLIC_URL;
    return cleaned;
  }

  if (isAzureWebApp()) return MMH_PUBLIC_URL;

  if (request) {
    const origin = request.headers.get("origin")?.trim();
    if (origin) {
      const cleaned = stripSlash(origin);
      if (!isNgrokUrl(cleaned) || !isAzureWebApp()) return cleaned;
    }
    const referer = request.headers.get("referer")?.trim();
    if (referer) {
      try {
        return stripSlash(new URL(referer).origin);
      } catch {
        /* ignore */
      }
    }
  }

  return "http://localhost:8080";
}

export function getServerPasswordResetUrl(request?: Request, tenantSlug?: string | null): string {
  const base = `${getServerAppOrigin(request)}/auth/reset`;
  const slug = normalisePublicTenantSlug(tenantSlug);
  if (!slug) return base;
  return `${base}?tenant=${encodeURIComponent(slug)}`;
}

export function getServerAuthCallbackUrl(request?: Request, tenantSlug?: string | null): string {
  const base = `${getServerAppOrigin(request)}/auth`;
  const slug = normalisePublicTenantSlug(tenantSlug);
  if (!slug) return base;
  return `${base}?tenant=${encodeURIComponent(slug)}`;
}
