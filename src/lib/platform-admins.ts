/**
 * G7E-2A platform administrator identities — pure helpers.
 * Authority: Super Owner only. Not Super Admin. Not tenant Owner.
 */
import type { PlatformRole } from "@/lib/platform-authority";

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

export const LAST_SUPER_OWNER_USER_MESSAGE =
  "Mortgage Hub must have at least one Super Owner.";

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
