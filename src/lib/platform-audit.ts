/**
 * Platform audit event types (pure). Writer lives in platform-audit.server.ts.
 */
export const PLATFORM_AUDIT_EVENT_TYPES = [
  "SUPER_OWNER_ROLE_GRANTED",
  "SUPER_OWNER_ROLE_REVOKED",
  "SUPER_ADMIN_ROLE_GRANTED",
  "SUPER_ADMIN_ROLE_REVOKED",
  "SUPER_ADMIN_TENANT_GRANTED",
  "SUPER_ADMIN_TENANT_REVOKED",
  "TENANT_CREATED",
] as const;

export type PlatformAuditEventType = (typeof PLATFORM_AUDIT_EVENT_TYPES)[number];

const SENSITIVE_META_KEYS = /password|secret|token|totp|service.?role|authorization|cookie/i;

export function sanitisePlatformAuditMetadata(
  metadata: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata ?? {})) {
    if (SENSITIVE_META_KEYS.test(key)) continue;
    if (typeof value === "string" && SENSITIVE_META_KEYS.test(value)) continue;
    out[key] = value;
  }
  return out;
}
