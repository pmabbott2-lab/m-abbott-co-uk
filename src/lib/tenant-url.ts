/**
 * Gate G5 — tenant-aware path / absolute URL builder.
 * Never hard-codes a firm slug. Never invents a default tenant.
 *
 * buildTenantPath is client-safe.
 * buildTenantUrl is server-oriented (pass baseUrl from caller or APP_BASE_URL).
 */
import { isReservedTenantSlug } from "@/lib/tenant-presentation";

export type TenantSlugSource = { slug: string };

function assertSlug(slug: string): string {
  const s = slug.trim().toLowerCase();
  if (!s || isReservedTenantSlug(s) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s)) {
    throw new Error("Invalid tenant slug for URL.");
  }
  return s;
}

function normalisePath(path: string): string {
  const p = path.trim();
  if (!p || p === "/") return "";
  return p.startsWith("/") ? p : `/${p}`;
}

/** Path only: /{slug}{path} */
export function buildTenantPath(tenant: TenantSlugSource | string, path = ""): string {
  const slug = assertSlug(typeof tenant === "string" ? tenant : tenant.slug);
  return `/${slug}${normalisePath(path)}`;
}

/** Absolute URL. Prefer passing baseUrl; falls back to env on server. */
export function buildTenantUrl(
  tenant: TenantSlugSource | string,
  path = "",
  baseUrl?: string,
): string {
  const raw =
    baseUrl?.trim() ||
    (typeof process !== "undefined"
      ? (process.env.APP_BASE_URL || process.env.VITE_APP_URL || "").trim()
      : "");
  const origin = raw.replace(/\/$/, "") || "";
  if (!origin) {
    return buildTenantPath(tenant, path);
  }
  return `${origin}${buildTenantPath(tenant, path)}`;
}

function withOrigin(path: string, origin?: string): string {
  if (!path) return "";
  const base = (origin ?? "").replace(/\/$/, "");
  return base ? `${base}${path}` : path;
}

function tryCanonical(
  build: () => string,
  origin?: string,
): string {
  try {
    return withOrigin(build(), origin);
  } catch {
    return "";
  }
}

export function buildCanonicalBookPath(
  tenantSlug: string,
  introducerSlug: string,
  query?: { lead?: string },
): string {
  const q = query?.lead ? `?lead=${encodeURIComponent(query.lead)}` : "";
  return `${buildTenantPath(tenantSlug, `/book/${encodeURIComponent(introducerSlug)}`)}${q}`;
}

export function buildCanonicalRafPath(tenantSlug: string, code: string): string {
  return buildTenantPath(tenantSlug, `/raf/${encodeURIComponent(code)}`);
}

export function buildCanonicalRefPath(tenantSlug: string, introducerRef: string): string {
  return buildTenantPath(tenantSlug, `/ref/${encodeURIComponent(introducerRef)}`);
}

/** Absolute canonical URLs. Empty when tenant slug is missing or invalid — never defaults to 001. */
export function tryBuildCanonicalRefUrl(
  tenantSlug: string | null | undefined,
  introducerRef: string,
  origin?: string,
): string {
  if (!tenantSlug?.trim() || !introducerRef.trim()) return "";
  return tryCanonical(() => buildCanonicalRefPath(tenantSlug, introducerRef), origin);
}

export function tryBuildCanonicalBookUrl(
  tenantSlug: string | null | undefined,
  introducerSlug: string,
  origin?: string,
  leadId?: string,
): string {
  if (!tenantSlug?.trim() || !introducerSlug.trim()) return "";
  return tryCanonical(
    () => buildCanonicalBookPath(tenantSlug, introducerSlug, leadId ? { lead: leadId } : undefined),
    origin,
  );
}

export function tryBuildCanonicalRafUrl(
  tenantSlug: string | null | undefined,
  code: string,
  origin?: string,
): string {
  if (!tenantSlug?.trim() || !code.trim()) return "";
  return tryCanonical(() => buildCanonicalRafPath(tenantSlug, code), origin);
}
