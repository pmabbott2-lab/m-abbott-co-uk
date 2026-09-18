/**
 * Gate G5 — tenant feature resolution & enforcement.
 *
 * Resolution (matches public.is_tenant_feature_enabled):
 *   1. Explicit tenant_features.state if present
 *   2. Else feature_catalogue.default_enabled
 *   3. Else false (fail closed)
 *
 * Never trust a browser-supplied tenant UUID alone for authority.
 * Feature enabled does NOT replace membership / RLS / G4A assertions.
 */
import { supabaseAdminUntyped as db } from "@/integrations/supabase/client.server";
import { TenantContextError } from "@/lib/tenant-context.server";

export type FeatureState =
  | "disabled"
  | "enabled"
  | "entitlement_blocked"
  | "rollout_hidden";

export type FeatureKey =
  | "susan_ai_journey"
  | "susan_chat_journey"
  | "appointment_booking"
  | "request_callback"
  | "external_website_links"
  | "introducer_journey"
  | "refer_a_friend"
  | "customer_portal"
  | "telephone_voice"
  | "public_hub_landing"
  | "customer_case_hub"
  | "staff_diary"
  | "staff_crm"
  | "staff_cases"
  | "staff_finance"
  | "staff_marketing_scripts"
  | "journey_analytics"
  | "view_as"
  | "teams_calendar"
  | "mortgage_calculator_public"
  | "introducer_calculator_lead"
  | "password_recovery"
  | "sms_notifications"
  | "relationship_pipeline"
  | (string & {});

export class TenantFeatureError extends Error {
  readonly code = "FEATURE_NOT_ENABLED" as const;
  readonly featureKey: string;

  constructor(featureKey: string, message = "Feature not available.") {
    super(message);
    this.name = "TenantFeatureError";
    this.featureKey = featureKey;
  }
}

export function isTenantFeatureError(e: unknown): e is TenantFeatureError {
  return e instanceof TenantFeatureError;
}

/** Opaque public/API message — no entitlement detail leakage. */
export function featureErrorMessage(_e: unknown): string {
  return "Feature not available.";
}

export async function isTenantFeatureEnabled(
  tenantId: string,
  featureKey: string,
): Promise<boolean> {
  const { data, error } = await db.rpc("is_tenant_feature_enabled", {
    p_tenant_id: tenantId,
    p_feature_key: featureKey,
  });
  if (error) throw new Error(error.message);
  return data === true;
}

export async function requireTenantFeature(
  tenantId: string,
  featureKey: string,
): Promise<void> {
  if (!tenantId) {
    throw new TenantContextError("TENANT_CONTEXT_REQUIRED", "Tenant required.");
  }
  const ok = await isTenantFeatureEnabled(tenantId, featureKey);
  if (!ok) {
    throw new TenantFeatureError(featureKey);
  }
}

/** Resolve effective boolean map for UI (catalogue active features). */
export async function getTenantFeatureFlags(
  tenantId: string,
): Promise<Record<string, boolean>> {
  const { data: catalogue, error: cErr } = await db
    .from("feature_catalogue")
    .select("feature_key, default_enabled")
    .eq("active", true);
  if (cErr) throw new Error(cErr.message);

  const { data: overrides, error: oErr } = await db
    .from("tenant_features")
    .select("feature_key, state")
    .eq("tenant_id", tenantId);
  if (oErr) throw new Error(oErr.message);

  const overrideMap = new Map<string, string>(
    (overrides ?? []).map((r: { feature_key: string; state: string }) => [
      r.feature_key,
      r.state,
    ]),
  );

  const flags: Record<string, boolean> = {};
  for (const row of catalogue ?? []) {
    const key = row.feature_key as string;
    const state = overrideMap.get(key);
    if (state != null) {
      flags[key] = state === "enabled";
    } else {
      flags[key] = Boolean(row.default_enabled);
    }
  }
  return flags;
}

/**
 * Resolve operating tenant for a privileged/public feature call.
 * Prefer trusted server sources; never invent 001.
 */
export async function resolveFeatureTenantId(opts: {
  tenantId?: string | null;
  tenantSlug?: string | null;
  resourceTenantId?: string | null;
  actingUserId?: string | null;
}): Promise<string> {
  const {
    getTenantContextBySlug,
    resolveSoleMembershipTenant,
    resolveTenantById,
    TenantContextError: TErr,
  } = await import("@/lib/tenant-assert.server");

  if (opts.tenantSlug?.trim()) {
    const ctx = await getTenantContextBySlug(opts.tenantSlug.trim());
    if (opts.tenantId && opts.tenantId !== ctx.tenant.id) {
      throw new TErr("TENANT_DATA_ACCESS_DENIED", "Tenant access denied.");
    }
    return ctx.tenant.id;
  }

  if (opts.resourceTenantId) {
    await resolveTenantById(opts.resourceTenantId);
    if (opts.tenantId && opts.tenantId !== opts.resourceTenantId) {
      throw new TErr("TENANT_DATA_ACCESS_DENIED", "Tenant access denied.");
    }
    return opts.resourceTenantId;
  }

  if (opts.tenantId) {
    const t = await resolveTenantById(opts.tenantId);
    if (t.status !== "active") {
      throw new TErr("TENANT_INACTIVE", "Tenant unavailable.");
    }
    return t.id;
  }

  if (opts.actingUserId) {
    const auth = await resolveSoleMembershipTenant(opts.actingUserId);
    return auth.tenant.id;
  }

  throw new TErr("TENANT_CONTEXT_REQUIRED", "Tenant required.");
}
