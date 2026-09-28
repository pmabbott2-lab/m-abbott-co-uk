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
  platformPrivilegedMfaRequired,
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

export async function resolvePlatformAuthority(userId: string | null | undefined): Promise<PlatformAuthorityView> {
  const id = userId?.trim() || null;
  if (!id) return deniedPlatformAuthority();
  try {
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
