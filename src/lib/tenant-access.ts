/**
 * Tenant authenticated-entry decisions.
 * Membership OR valid platform tenant access session.
 * URL slug is never treated as a grant. Email is never consulted.
 */

export type TenantAuthenticatedEntry = "login" | "denied" | "ok";

export type TenantEntryAccessKind = "membership" | "platform_access" | "none";

export function resolveTenantAuthenticatedEntry(input: {
  userId: string | null | undefined;
  member: boolean;
  platformAccess?: boolean;
}): TenantAuthenticatedEntry {
  if (!input.userId) return "login";
  if (input.member || input.platformAccess) return "ok";
  return "denied";
}

export function resolveTenantEntryAccessKind(input: {
  member: boolean;
  platformAccess: boolean;
}): TenantEntryAccessKind {
  if (input.member) return "membership";
  if (input.platformAccess) return "platform_access";
  return "none";
}
