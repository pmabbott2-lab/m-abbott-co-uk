/**
 * Break-glass registry + lifecycle (server-only, no cookies).
 * Safe for platform-authority / post-auth import graphs (import-protection).
 * Session cookies live in break-glass.server.ts.
 */
import { supabaseAdminUntyped as db } from "@/integrations/supabase/client.server";
import { deniedBreakGlassStatus, type BreakGlassStatus } from "@/lib/break-glass";

/**
 * Server-side BG classification. UUID + registry only.
 * Does NOT grant Super Owner authority.
 */
export async function resolveBreakGlassStatus(
  userId: string | null | undefined,
): Promise<BreakGlassStatus> {
  const id = userId?.trim() || null;
  if (!id) return deniedBreakGlassStatus();
  try {
    const { data, error } = await db.rpc("is_active_break_glass", { p_user_id: id });
    if (error) {
      console.error("is_active_break_glass", error.message);
      return deniedBreakGlassStatus();
    }
    return { isBreakGlass: data === true };
  } catch (err) {
    console.error("resolveBreakGlassStatus", err);
    return deniedBreakGlassStatus();
  }
}

export async function writeBreakGlassAuditBestEffort(input: {
  eventType:
    | "BREAK_GLASS_LOGIN_SUCCEEDED"
    | "BREAK_GLASS_PLATFORM_ACCESS"
    | "BREAK_GLASS_TENANT_ENTRY_STARTED"
    | "BREAK_GLASS_TENANT_ENTRY_ENDED"
    | "BREAK_GLASS_LOGOUT"
    | "BREAK_GLASS_IDENTITY_CREATED"
    | "BREAK_GLASS_IDENTITY_REPLACED"
    | "BREAK_GLASS_IDENTITY_DEACTIVATED";
  actingUserId: string;
  subjectUserId?: string | null;
  tenantId?: string | null;
  metadata?: Record<string, unknown> | null;
}): Promise<{ written: boolean }> {
  try {
    const { writePlatformAuditEvent } = await import("@/lib/platform-audit.server");
    await writePlatformAuditEvent({
      eventType: input.eventType as never,
      actingUserId: input.actingUserId,
      subjectUserId: input.subjectUserId ?? null,
      tenantId: input.tenantId ?? null,
      metadata: input.metadata ?? null,
    });
    return { written: true };
  } catch (err) {
    console.error("break_glass_audit_failed", input.eventType, err);
    return { written: false };
  }
}

export type EstablishBreakGlassIdentityResult = {
  outcome: "created" | "replaced" | "already_active";
  targetUserId: string;
  breakGlassId: string | null;
  previousUserId: string | null;
  roleInserted: boolean;
};

/**
 * Service-role RPC only. Caller must already have verified Super Owner.
 * Do not import platform-authority.server here (circular + import-protection).
 */
export async function establishBreakGlassIdentityRpc(input: {
  actingUserId: string;
  targetUserId: string;
  reason?: string | null;
}): Promise<EstablishBreakGlassIdentityResult> {
  const targetUserId = input.targetUserId?.trim();
  if (!targetUserId) {
    throw new Error("break_glass_lifecycle_target_required");
  }
  const actingUserId = input.actingUserId?.trim();
  if (!actingUserId) {
    throw new Error("break_glass_lifecycle_actor_required");
  }

  const reason = input.reason?.trim() || null;
  const { data, error } = await db.rpc("establish_break_glass_identity", {
    p_target_user_id: targetUserId,
    p_acting_user_id: actingUserId,
    p_reason: reason,
  });
  if (error) throw new Error(error.message);

  const row = (data ?? {}) as Record<string, unknown>;
  const outcome = String(row.outcome ?? "");
  if (outcome !== "created" && outcome !== "replaced" && outcome !== "already_active") {
    throw new Error(`break_glass_lifecycle_unexpected_outcome:${outcome || "empty"}`);
  }
  return {
    outcome,
    targetUserId: String(row.target_user_id ?? targetUserId),
    breakGlassId: row.break_glass_id ? String(row.break_glass_id) : null,
    previousUserId: row.previous_user_id ? String(row.previous_user_id) : null,
    roleInserted: row.role_inserted === true,
  };
}

/** @deprecated use establishBreakGlassIdentityRpc after requireSuperOwner in the functions bridge */
export async function establishBreakGlassIdentityImpl(input: {
  actingUserId: string;
  targetUserId: string;
  reason?: string | null;
}): Promise<EstablishBreakGlassIdentityResult> {
  return establishBreakGlassIdentityRpc(input);
}
