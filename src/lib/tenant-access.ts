/**
 * Tenant authenticated-entry decisions.
 * Membership is established server-side; this only maps the result.
 * URL slug is never treated as a grant. Email is never consulted.
 */

export type TenantAuthenticatedEntry = "login" | "denied" | "ok";

export function resolveTenantAuthenticatedEntry(input: {
  userId: string | null | undefined;
  member: boolean;
}): TenantAuthenticatedEntry {
  if (!input.userId) return "login";
  if (input.member) return "ok";
  return "denied";
}
