/**
 * Server-side platform authority resolver.
 * Authenticated auth user + platform_roles only. Fail closed.
 * Client code must import getMyPlatformAuthority from platform-authority.functions.ts.
 *
 * Cookie/session enrichment lives in platform-authority.functions.ts so this
 * module stays import-protection safe for post-auth route graphs.
 */
import { supabaseAdminUntyped as db } from "@/integrations/supabase/client.server";
import {
  deniedPlatformAuthority,
  resolvePlatformAuthorityFromRoles,
  type PlatformAuthorityView,
  type PlatformRole,
} from "@/lib/platform-authority";
import {
  PRIVILEGED_MFA_ACTIONS,
  isVerifiedAuthContext,
  platformPrivilegedMfaRequired,
  type AuthAssuranceContext,
  type PrivilegedMfaAction,
} from "@/lib/privileged-mfa";

export class PlatformRouteDeniedError extends Error {
  readonly code = "PLATFORM_AUTHORITY_REQUIRED" as const;
  constructor(message = "Platform administration requires a platform role.") {
    super(message);
    this.name = "PlatformRouteDeniedError";
  }
}

async function loadPlatformRoles(userId: string): Promise<PlatformRole[]> {
  const { data: so, error: soErr } = await db.rpc("is_super_owner", { p_user_id: userId });
  if (soErr) throw new Error(soErr.message);
  const { data: sa, error: saErr } = await db.rpc("is_super_admin", { p_user_id: userId });
  if (saErr) throw new Error(saErr.message);
  const roles: PlatformRole[] = [];
  if (so === true) roles.push("super_owner");
  if (sa === true) roles.push("super_admin");
  return roles;
}

export type PlatformAuthContextState = "ok" | "locked" | "stale_auth_context";

export class SupersededAuthContextError extends Error {
  readonly code = "AUTH_CONTEXT_SUPERSEDED" as const;
  constructor() {
    super("Unauthorized: this sign-in predates an MFA recovery. Sign in again.");
    this.name = "SupersededAuthContextError";
  }
}

/**
 * G7F-3C3 recovery lock + G7F-3C3A post-recovery authentication boundary, mode-independent.
 * Only the caller's own getClaims-verified session_id / iat can satisfy the boundary; any other
 * context is sent as null and fails closed for users with a recovery history.
 * Errors propagate so callers fail closed.
 */
export async function resolvePlatformAuthContextState(
  userId: string,
  ctx?: AuthAssuranceContext | null,
): Promise<PlatformAuthContextState> {
  const assurance =
    ctx !== undefined
      ? ctx
      : (await import("@/lib/request-auth-context.server")).getRequestAuthAssurance();
  const own = isVerifiedAuthContext(assurance) && assurance.userId === userId ? assurance : null;
  const { data, error } = await db.rpc("platform_mfa_recovery_authority_state", {
    p_user_id: userId,
    p_session_id: own?.sessionId ?? null,
    p_iat: own?.issuedAt ?? null,
  });
  if (error) throw new Error(error.message);
  if (data === "ok" || data === "locked" || data === "stale_auth_context") return data;
  throw new Error("platform_mfa_recovery_authority_state returned an unexpected value");
}

/** Rejects an authenticated request whose Auth context predates the user's latest recovery. */
export async function assertAuthContextNotSuperseded(ctx: AuthAssuranceContext): Promise<void> {
  if (!ctx.userId) throw new SupersededAuthContextError();
  if ((await resolvePlatformAuthContextState(ctx.userId, ctx)) === "stale_auth_context") {
    throw new SupersededAuthContextError();
  }
}

export async function resolvePlatformAuthority(userId: string | null | undefined): Promise<PlatformAuthorityView> {
  const id = userId?.trim() || null;
  if (!id) return deniedPlatformAuthority();
  try {
    const state = await resolvePlatformAuthContextState(id);
    if (state === "locked") {
      return { ...deniedPlatformAuthority({ userId: id }), mfaRecoveryRequired: true };
    }
    if (state !== "ok") return deniedPlatformAuthority({ userId: id });
    const roles = await loadPlatformRoles(id);
    const { resolveBreakGlassStatus } = await import("@/lib/break-glass-registry.server");
    const bg = await resolveBreakGlassStatus(id);
    return resolvePlatformAuthorityFromRoles({
      userId: id,
      roles,
      isBreakGlass: bg.isBreakGlass,
    });
  } catch {
    return deniedPlatformAuthority({ userId: id });
  }
}

/**
 * Authentication assurance after authorization: platform_roles / BG registry decide whether
 * AAL2 is mandatory (legacy user_roles are not consulted). Denies only in enforce mode.
 */
async function requirePrivilegedPlatformAssurance(
  view: PlatformAuthorityView,
  action: PrivilegedMfaAction,
): Promise<void> {
  const platformRoles: PlatformRole[] = [];
  if (view.isSuperOwner) platformRoles.push("super_owner");
  if (view.isSuperAdmin) platformRoles.push("super_admin");
  if (!platformPrivilegedMfaRequired({ platformRoles, isBreakGlass: view.isBreakGlass })) return;
  const { requirePlatformAal2 } = await import("@/lib/privileged-mfa.server");
  await requirePlatformAal2(undefined, { action, userId: view.userId });
}

export async function requirePlatformRouteAccess(userId: string): Promise<PlatformAuthorityView> {
  const view = await resolvePlatformAuthority(userId);
  if (!view.canAccessPlatform) throw new PlatformRouteDeniedError();
  await requirePrivilegedPlatformAssurance(view, PRIVILEGED_MFA_ACTIONS.platformRouteAccess);
  return view;
}

export async function requireSuperOwner(userId: string): Promise<PlatformAuthorityView> {
  const view = await resolvePlatformAuthority(userId);
  if (!view.isSuperOwner) throw new PlatformRouteDeniedError();
  await requirePrivilegedPlatformAssurance(view, PRIVILEGED_MFA_ACTIONS.superOwnerAccess);
  return view;
}
