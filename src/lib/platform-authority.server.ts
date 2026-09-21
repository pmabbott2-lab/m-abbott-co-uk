/**
 * Server-side platform authority resolver.
 * Authenticated auth user + platform_roles only. Fail closed.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdminUntyped as db } from "@/integrations/supabase/client.server";
import {
  deniedPlatformAuthority,
  resolvePlatformAuthorityFromRoles,
  type PlatformAuthorityView,
  type PlatformRole,
} from "@/lib/platform-authority";

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
    return resolvePlatformAuthorityFromRoles({ userId: id, roles });
  } catch {
    return deniedPlatformAuthority({ userId: id });
  }
}

export async function requirePlatformRouteAccess(userId: string): Promise<PlatformAuthorityView> {
  const view = await resolvePlatformAuthority(userId);
  if (!view.canAccessPlatform) throw new PlatformRouteDeniedError();
  return view;
}

export async function requireSuperOwner(userId: string): Promise<PlatformAuthorityView> {
  const view = await resolvePlatformAuthority(userId);
  if (!view.isSuperOwner) throw new PlatformRouteDeniedError();
  return view;
}

export const getMyPlatformAuthority = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PlatformAuthorityView> => {
    const userId = (context as { userId?: string } | undefined)?.userId;
    if (!userId) return deniedPlatformAuthority();
    return resolvePlatformAuthority(userId);
  });
