/**
 * Gate G5 — enforce Susan feature on avatar/TTS/STT/interview APIs.
 */
import {
  featureErrorMessage,
  isTenantFeatureError,
  requireTenantFeature,
  resolveFeatureTenantId,
  TenantFeatureError,
} from "@/lib/tenant-features.server";
import { isTenantContextError, tenantErrorMessage } from "@/lib/tenant-assert.server";

export async function requireSusanApiAccess(opts: {
  actingUserId: string;
  tenantSlug?: string | null;
  tenantId?: string | null;
  sessionTenantId?: string | null;
  featureKey?: "susan_ai_journey" | "susan_chat_journey";
}): Promise<{ tenantId: string }> {
  const tenantId = await resolveFeatureTenantId({
    tenantSlug: opts.tenantSlug,
    tenantId: opts.tenantId,
    resourceTenantId: opts.sessionTenantId,
    actingUserId: opts.actingUserId,
  });
  await requireTenantFeature(tenantId, opts.featureKey ?? "susan_ai_journey");
  return { tenantId };
}

export function susanDeniedResponse(e: unknown): Response {
  if (isTenantFeatureError(e) || e instanceof TenantFeatureError) {
    return new Response(featureErrorMessage(e), { status: 403 });
  }
  if (isTenantContextError(e)) {
    return new Response(tenantErrorMessage(e), { status: 403 });
  }
  const msg = e instanceof Error ? e.message : "Forbidden";
  return new Response(msg, { status: 403 });
}

/** Read optional tenant hints from request (never authoritative alone). */
export function readTenantHints(request: Request, body?: Record<string, unknown> | null): {
  tenantSlug?: string;
  tenantId?: string;
} {
  const headerSlug = request.headers.get("x-tenant-slug")?.trim();
  const url = new URL(request.url);
  const qSlug = url.searchParams.get("tenant")?.trim() || undefined;
  const bodySlug = typeof body?.tenantSlug === "string" ? body.tenantSlug.trim() : undefined;
  const bodyTenantId = typeof body?.tenantId === "string" ? body.tenantId.trim() : undefined;
  const headerTenantId = request.headers.get("x-tenant-id")?.trim() || undefined;
  return {
    tenantSlug: headerSlug || bodySlug || qSlug || undefined,
    tenantId: bodyTenantId || headerTenantId || undefined,
  };
}
