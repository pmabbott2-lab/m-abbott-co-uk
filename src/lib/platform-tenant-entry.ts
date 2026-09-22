/**
 * G7D platform tenant entry — pure helpers.
 * Third authority context: not platform_roles alone, not tenant_memberships.
 */
export const PLATFORM_TENANT_ACCESS_COOKIE = "mh_platform_tenant_access";

export const PLATFORM_TENANT_ACCESS_MAX_HOURS = 4;

export const PLATFORM_TENANT_ACCESS_BASES = [
  "super_owner_group_access",
  "super_admin_grant",
  "support_grant",
  "emergency_grant",
] as const;

export type PlatformTenantAccessBasis = (typeof PLATFORM_TENANT_ACCESS_BASES)[number];

export const PLATFORM_TENANT_ACCESS_LEVELS = [
  "read_only",
  "operational_admin",
  "emergency",
] as const;

export type PlatformTenantAccessLevel = (typeof PLATFORM_TENANT_ACCESS_LEVELS)[number];

export type TenantAccessContextKind = "membership" | "platform_access";

export type PlatformTenantAccessSessionView = {
  sessionId: string;
  tenantId: string;
  tenantSlug: string;
  companyName: string;
  companyCode: string;
  authorityBasis: PlatformTenantAccessBasis;
  accessLevel: PlatformTenantAccessLevel;
  startedAt: string;
  expiresAt: string;
  basisLabel: string;
};

export function isPlatformTenantAccessBasis(value: string): value is PlatformTenantAccessBasis {
  return (PLATFORM_TENANT_ACCESS_BASES as readonly string[]).includes(value);
}

export function isPlatformTenantAccessLevel(value: string): value is PlatformTenantAccessLevel {
  return (PLATFORM_TENANT_ACCESS_LEVELS as readonly string[]).includes(value);
}

export function platformAccessBasisLabel(basis: PlatformTenantAccessBasis): string {
  if (basis === "super_owner_group_access") return "Super Owner access";
  if (basis === "super_admin_grant") return "Platform administrator access";
  if (basis === "support_grant") return "Support access";
  return "Emergency access";
}

export function platformAccessAllowsWrite(level: PlatformTenantAccessLevel): boolean {
  return level === "operational_admin" || level === "emergency";
}

export function platformAccessAllowsRead(level: PlatformTenantAccessLevel): boolean {
  return (
    level === "read_only" || level === "operational_admin" || level === "emergency"
  );
}

export function computePlatformAccessExpiresAt(
  startedAt: Date,
  grantExpiresAt?: string | null,
): Date {
  const absolute = new Date(startedAt.getTime() + PLATFORM_TENANT_ACCESS_MAX_HOURS * 60 * 60 * 1000);
  if (!grantExpiresAt) return absolute;
  const grant = new Date(grantExpiresAt);
  if (Number.isNaN(grant.getTime())) return absolute;
  return grant.getTime() < absolute.getTime() ? grant : absolute;
}

export function isSessionTemporallyActive(input: {
  endedAt?: string | null;
  revokedAt?: string | null;
  expiresAt: string;
  now?: Date;
}): boolean {
  if (input.endedAt || input.revokedAt) return false;
  const now = input.now ?? new Date();
  const expires = new Date(input.expiresAt);
  if (Number.isNaN(expires.getTime())) return false;
  return now.getTime() < expires.getTime();
}

/** Map SA grant level → permitted entry access level (or null = deny operational entry). */
export function superAdminGrantToEntryLevel(
  grantLevel: string | null | undefined,
): PlatformTenantAccessLevel | null {
  if (grantLevel === "data_read") return "read_only";
  if (grantLevel === "data_write" || grantLevel === "full") return "operational_admin";
  // platform_admin / visibility / null → no operational entry
  return null;
}

export function supportScopeToEntryLevel(
  scope: string | null | undefined,
): PlatformTenantAccessLevel | null {
  if (!scope || scope === "read_metadata") return null;
  if (
    scope === "read_cases" ||
    scope === "read_comms" ||
    scope === "read_finance" ||
    scope === "full_read"
  ) {
    return "read_only";
  }
  if (scope === "write_limited" || scope === "full_write") return "operational_admin";
  return null;
}

export function emergencyScopeToEntryLevel(
  scope: string | null | undefined,
): PlatformTenantAccessLevel | null {
  if (!scope || scope === "read_metadata") return null;
  if (
    scope === "read_cases" ||
    scope === "read_comms" ||
    scope === "read_finance" ||
    scope === "full_read" ||
    scope === "write_limited" ||
    scope === "full_write"
  ) {
    return "emergency";
  }
  return null;
}

export function resolveTenantAuthenticatedEntryWithPlatform(input: {
  userId: string | null | undefined;
  member: boolean;
  platformAccess: boolean;
}): "login" | "denied" | "ok" {
  if (!input.userId) return "login";
  if (input.member || input.platformAccess) return "ok";
  return "denied";
}
