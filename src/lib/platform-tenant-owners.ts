/**
 * G7E-1 platform Tenant Owner management — pure helpers.
 * Authority: Super Owner only. Not Super Admin grants. Not tenant Owner.
 */
export type PlatformTenantOwnerRow = {
  email: string;
  fullName: string | null;
  status: "active" | "inactive";
  joinedAt: string | null;
};

export type PlatformPendingOwnerInvite = {
  email: string;
  displayName: string | null;
  expiresAt: string;
  createdAt: string;
};

export type PlatformCompanyOwnersView = {
  companyCode: string;
  companyName: string;
  tenantStatus: string;
  owners: PlatformTenantOwnerRow[];
  pendingInvites: PlatformPendingOwnerInvite[];
  hasActiveOwner: boolean;
  hasValidPendingInvite: boolean;
};

export const LAST_OWNER_USER_MESSAGE =
  "This company must have at least one active Owner. Add another Owner before removing this one.";

export function isLastOwnerProtectedError(message: string | null | undefined): boolean {
  if (!message) return false;
  return (
    message.includes("last_tenant_owner_protected") ||
    message.toLowerCase().includes("at least one active owner")
  );
}
