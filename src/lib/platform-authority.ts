/**
 * Mortgage Hub platform authority (pure).
 * Source of truth: platform_roles.role only.
 * Never infers from email, tenant_memberships, user_roles, or admin_profiles.
 */
export const PLATFORM_ROLES = ["super_owner", "super_admin"] as const;
export type PlatformRole = (typeof PLATFORM_ROLES)[number];

export const SUPER_ADMIN_ACCESS_LEVELS = [
  "platform_admin",
  "data_read",
  "data_write",
  "full",
] as const;
export type SuperAdminAccessLevel = (typeof SUPER_ADMIN_ACCESS_LEVELS)[number];

export const SUPPORT_ACCESS_SCOPES = [
  "read_metadata",
  "read_cases",
  "read_comms",
  "read_finance",
  "write_limited",
  "full_read",
  "full_write",
] as const;
export type SupportAccessScope = (typeof SUPPORT_ACCESS_SCOPES)[number];

export type PlatformAuthorityView = {
  userId: string | null;
  isSuperOwner: boolean;
  isSuperAdmin: boolean;
  canAccessPlatform: boolean;
  canListPlatformTenants: boolean;
  canCreateCompany: boolean;
};

export function isPlatformRole(value: string): value is PlatformRole {
  return (PLATFORM_ROLES as readonly string[]).includes(value);
}

export function deniedPlatformAuthority(input?: {
  userId?: string | null;
}): PlatformAuthorityView {
  return {
    userId: input?.userId ?? null,
    isSuperOwner: false,
    isSuperAdmin: false,
    canAccessPlatform: false,
    canListPlatformTenants: false,
    canCreateCompany: false,
  };
}

/**
 * Map platform_roles rows for one user. Extra strings (user_roles.admin, owner,
 * emails) are ignored. Fail closed when userId is missing.
 */
export function resolvePlatformAuthorityFromRoles(input: {
  userId: string | null | undefined;
  roles: Iterable<string>;
}): PlatformAuthorityView {
  const userId = input.userId?.trim() || null;
  if (!userId) return deniedPlatformAuthority();

  const roles = [...new Set([...input.roles].filter(isPlatformRole))];
  const isSuperOwner = roles.includes("super_owner");
  const isSuperAdmin = roles.includes("super_admin");
  return {
    userId,
    isSuperOwner,
    isSuperAdmin,
    canAccessPlatform: isSuperOwner || isSuperAdmin,
    canListPlatformTenants: isSuperOwner,
    canCreateCompany: isSuperOwner,
  };
}

export function superAdminGrantAllowsVisibility(
  level: SuperAdminAccessLevel | null | undefined,
): boolean {
  return (
    level === "platform_admin" ||
    level === "data_read" ||
    level === "data_write" ||
    level === "full"
  );
}

export function superAdminGrantAllowsAdmin(
  level: SuperAdminAccessLevel | null | undefined,
): boolean {
  return level === "platform_admin" || level === "full";
}

export function superAdminGrantAllowsData(
  level: SuperAdminAccessLevel | null | undefined,
): boolean {
  return level === "data_read" || level === "data_write" || level === "full";
}

export function superAdminGrantAllowsDataWrite(
  level: SuperAdminAccessLevel | null | undefined,
): boolean {
  return level === "data_write" || level === "full";
}

export function supportScopeAllowsData(scope: SupportAccessScope | null | undefined): boolean {
  return (
    scope === "read_cases" ||
    scope === "read_comms" ||
    scope === "read_finance" ||
    scope === "write_limited" ||
    scope === "full_read" ||
    scope === "full_write"
  );
}

export type TenantTypeFlag = "GROUP" | "EXTERNAL";

/**
 * Synthetic mirror of G7A can_administer_tenant. Not a grant — tests only.
 */
export function canAdministerTenantFromFlags(input: {
  isSuperOwner: boolean;
  isSuperAdmin: boolean;
  tenantType: TenantTypeFlag;
  superAdminGrant: SuperAdminAccessLevel | null;
  membershipRole: "owner" | "supervisor" | null;
}): boolean {
  if (input.isSuperOwner && input.tenantType === "GROUP") return true;
  if (input.isSuperAdmin && superAdminGrantAllowsAdmin(input.superAdminGrant)) return true;
  return input.membershipRole === "owner" || input.membershipRole === "supervisor";
}

/**
 * Synthetic mirror of G7A can_access_tenant_data (membership / GROUP SO / data grant).
 * Support grants are a separate boolean.
 */
export function canAccessTenantDataFromFlags(input: {
  isSuperOwner: boolean;
  isSuperAdmin: boolean;
  tenantType: TenantTypeFlag;
  superAdminGrant: SuperAdminAccessLevel | null;
  hasMembership: boolean;
  supportDataAccess?: boolean;
}): boolean {
  if (input.hasMembership) return true;
  if (input.isSuperOwner && input.tenantType === "GROUP") return true;
  if (input.isSuperAdmin && superAdminGrantAllowsData(input.superAdminGrant)) return true;
  return input.supportDataAccess === true;
}

export type PlatformRoleRow = { id: string; userId: string; role: PlatformRole };

/** Last-SO predicate matching prevent_last_super_owner_loss. */
export function wouldRemoveLastSuperOwner(
  rows: readonly PlatformRoleRow[],
  mutation:
    | { op: "delete"; id: string }
    | { op: "update_role"; id: string; nextRole: PlatformRole },
): boolean {
  const target = rows.find((r) => r.id === mutation.id);
  if (!target || target.role !== "super_owner") return false;
  if (mutation.op === "update_role" && mutation.nextRole === "super_owner") return false;
  const remaining = rows.filter((r) => r.role === "super_owner" && r.id !== target.id);
  return remaining.length < 1;
}
