/**
 * Public /{tenantSlug}/ref/{introducerRef} access contract.
 * Slug is presentation only. Entity tenant (introducer.tenant_id → tenants.slug) is authoritative.
 * Never defaults to mortgageeasy / 001.
 */
import { normalisePublicTenantSlug } from "@/lib/tenant-presentation";

export type PublicIntroducerRefDecision = "ok" | "not_found";

export function resolvePublicIntroducerRefAccess(input: {
  urlTenantSlug: string | null | undefined;
  introducerTenantSlug: string | null | undefined;
  introducerSlug: string | null | undefined;
  introducerRef: string | null | undefined;
  introducerActive?: boolean | null;
}): PublicIntroducerRefDecision {
  const url = normalisePublicTenantSlug(input.urlTenantSlug);
  const entity = normalisePublicTenantSlug(input.introducerTenantSlug);
  const slug = (input.introducerSlug ?? "").trim().toLowerCase();
  const ref = (input.introducerRef ?? "").trim().toLowerCase();
  if (!url || !entity || !slug || !ref) return "not_found";
  if (url !== entity) return "not_found";
  if (slug !== ref) return "not_found";
  if (input.introducerActive === false) return "not_found";
  return "ok";
}

/** Consume a generated canonical ref path: /{tenantSlug}/ref/{introducerSlug} */
export function parseCanonicalRefPath(path: string): { tenantSlug: string; introducerRef: string } | null {
  const clean = path.trim().replace(/^https?:\/\/[^/]+/i, "");
  const parts = clean.split("?")[0].split("#")[0].split("/").filter(Boolean);
  if (parts.length !== 3 || parts[1] !== "ref") return null;
  const tenantSlug = normalisePublicTenantSlug(parts[0]);
  const introducerRef = parts[2].trim().toLowerCase();
  if (!tenantSlug || !introducerRef) return null;
  return { tenantSlug, introducerRef };
}
