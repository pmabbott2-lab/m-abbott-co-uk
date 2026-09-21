/**
 * Platform audit writer. Reuses public.security_audit_events.
 * Never store passwords, TOTP secrets, tokens, or service-role keys in metadata.
 */
import { supabaseAdminUntyped as db } from "@/integrations/supabase/client.server";
import {
  sanitisePlatformAuditMetadata,
  type PlatformAuditEventType,
} from "@/lib/platform-audit";

export {
  PLATFORM_AUDIT_EVENT_TYPES,
  sanitisePlatformAuditMetadata,
  type PlatformAuditEventType,
} from "@/lib/platform-audit";

export async function writePlatformAuditEvent(input: {
  eventType: PlatformAuditEventType;
  actingUserId?: string | null;
  subjectUserId?: string | null;
  tenantId?: string | null;
  metadata?: Record<string, unknown> | null;
}): Promise<void> {
  const { error } = await db.from("security_audit_events").insert({
    event_type: input.eventType,
    acting_user_id: input.actingUserId ?? null,
    subject_user_id: input.subjectUserId ?? null,
    tenant_id: input.tenantId ?? null,
    metadata: sanitisePlatformAuditMetadata(input.metadata),
  });
  if (error) {
    console.error("security_audit_events", error.message);
  }
}
