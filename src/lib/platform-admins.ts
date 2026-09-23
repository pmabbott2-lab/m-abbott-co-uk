/**
 * G7E-2A/B platform administrator identities & Super Admin grants — pure helpers.
 * Authority: Super Owner only. Not Super Admin. Not tenant Owner.
 */
import type { PlatformRole, SuperAdminAccessLevel } from "@/lib/platform-authority";
import { SUPER_ADMIN_ACCESS_LEVELS } from "@/lib/platform-authority";

export type PlatformAdminRow = {
  email: string;
  fullName: string | null;
  platformRole: PlatformRole;
  status: "active";
  createdAt: string | null;
};

export type PlatformPendingAdminInvite = {
  email: string;
  fullName: string;
  platformRole: PlatformRole;
  expiresAt: string;
  createdAt: string;
};

export type PlatformAdminsView = {
  superOwners: PlatformAdminRow[];
  superAdmins: PlatformAdminRow[];
  pendingInvites: PlatformPendingAdminInvite[];
};

export type SuperAdminGrantAccessOption = "none" | SuperAdminAccessLevel;

export type SuperAdminTenantGrantRow = {
  companyCode: string;
  companyName: string;
  tenantType: "GROUP" | "EXTERNAL";
  tenantStatus: string;
  accessLevel: SuperAdminGrantAccessOption;
  expiresAt: string | null;
  reason: string | null;
  isExpired: boolean;
};

export type SuperAdminTenantGrantsView = {
  adminEmail: string;
  adminName: string | null;
  grants: SuperAdminTenantGrantRow[];
};

export const LAST_SUPER_OWNER_USER_MESSAGE =
  "Mortgage Hub must have at least one Super Owner.";

export const ACCESS_LEVEL_DESCRIPTIONS: Record<SuperAdminAccessLevel, string> = {
  platform_admin:
    "Manage permitted platform-level configuration for this company. No operational customer-data access.",
  data_read: "Read permitted operational company data. No operational changes.",
  data_write: "Read and update permitted operational company data.",
  full: "Platform administration plus permitted operational read/write access.",
};

export function isSuperAdminAccessLevel(value: string): value is SuperAdminAccessLevel {
  return (SUPER_ADMIN_ACCESS_LEVELS as readonly string[]).includes(value);
}

export function accessLevelLabel(level: SuperAdminGrantAccessOption): string {
  if (level === "none") return "None";
  if (level === "platform_admin") return "Platform Admin";
  if (level === "data_read") return "Data Read";
  if (level === "data_write") return "Data Write";
  return "Full";
}

export function isLastSuperOwnerProtectedError(message: string | null | undefined): boolean {
  if (!message) return false;
  return (
    message.includes("last_super_owner_protected") ||
    message.toLowerCase().includes("at least one super owner")
  );
}

export function isPlatformInviteError(message: string | null | undefined): string | null {
  if (!message) return null;
  if (message.includes("platform_invite_expired")) return "This invitation has expired.";
  if (message.includes("platform_invite_revoked")) return "This invitation has been cancelled.";
  if (message.includes("platform_invite_used")) return "This invitation has already been used.";
  if (message.includes("platform_invite_email_mismatch")) {
    return "Sign in with the invited email address to accept this invitation.";
  }
  if (message.includes("platform_invite_invalid")) return "This invitation is not valid.";
  return null;
}

export function platformRoleLabel(role: PlatformRole): string {
  return role === "super_owner" ? "Super Owner" : "Super Admin";
}

/** Reason required for temporary, EXTERNAL, or Full grants. */
export function grantReasonRequired(input: {
  accessLevel: SuperAdminGrantAccessOption;
  tenantType: "GROUP" | "EXTERNAL";
  expiresAt: string | null;
}): boolean {
  if (input.accessLevel === "none") return false;
  if (input.accessLevel === "full") return true;
  if (input.tenantType === "EXTERNAL") return true;
  if (input.expiresAt) return true;
  return false;
}

export function isGrantCurrentlyActive(input: {
  revokedAt?: string | null;
  expiresAt?: string | null;
  now?: Date;
}): boolean {
  if (input.revokedAt) return false;
  if (!input.expiresAt) return true;
  const expires = new Date(input.expiresAt);
  if (Number.isNaN(expires.getTime())) return false;
  const now = input.now ?? new Date();
  return now.getTime() < expires.getTime();
}
