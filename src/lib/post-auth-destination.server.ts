/**
 * Server post-auth destination. Platform authority from platform_roles only.
 * Tenant slug from requested context or sole active membership — never 001.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { resolvePlatformAuthority } from "@/lib/platform-authority.server";
import { normalisePublicTenantSlug } from "@/lib/tenant-presentation";
import { parsePostAuthStart } from "@/lib/post-auth-journey";
import {
  resolvePostAuthDestination,
  type PostAuthDestination,
} from "@/lib/post-auth-destination";

async function loadSoleMembershipSlug(userId: string): Promise<string | null> {
  const { supabaseAdminUntyped: db } = await import("@/integrations/supabase/client.server");
  const { data, error } = await db
    .from("tenant_memberships")
    .select("tenant_id")
    .eq("user_id", userId)
    .eq("active", true);
  if (error) throw new Error(error.message);
  const ids = [...new Set((data ?? []).map((row: { tenant_id: string }) => row.tenant_id))];
  if (ids.length !== 1) return null;

  const { data: tenant, error: tenantErr } = await db
    .from("tenants")
    .select("slug, status")
    .eq("id", ids[0])
    .maybeSingle();
  if (tenantErr) throw new Error(tenantErr.message);
  if (!tenant || tenant.status !== "active") return null;
  return normalisePublicTenantSlug(tenant.slug);
}

export async function resolvePostAuthDestinationForUser(input: {
  userId: string;
  requestedTenantSlug?: string | null;
  start?: string | null;
  platformIntent?: boolean;
}): Promise<PostAuthDestination> {
  const platform = await resolvePlatformAuthority(input.userId);
  const requested = normalisePublicTenantSlug(input.requestedTenantSlug);
  let soleMembershipSlug: string | null = null;
  if (!platform.canAccessPlatform && !requested) {
    soleMembershipSlug = await loadSoleMembershipSlug(input.userId);
  }
  return resolvePostAuthDestination({
    canAccessPlatform: platform.canAccessPlatform,
    requestedTenantSlug: requested,
    soleMembershipSlug,
    start: parsePostAuthStart(input.start),
    platformIntent: input.platformIntent === true,
  });
}

export const resolveMyPostAuthDestination = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        tenantSlug: z.string().min(1).max(64).optional(),
        start: z.enum(["voice", "chat", "book"]).optional(),
        platformIntent: z.boolean().optional(),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ data, context }): Promise<PostAuthDestination> => {
    const userId = (context as { userId?: string } | undefined)?.userId;
    if (!userId) {
      return resolvePostAuthDestination({
        canAccessPlatform: false,
        requestedTenantSlug: data.tenantSlug,
        start: data.start,
        platformIntent: data.platformIntent,
      });
    }
    return resolvePostAuthDestinationForUser({
      userId,
      requestedTenantSlug: data.tenantSlug,
      start: data.start,
      platformIntent: data.platformIntent,
    });
  });
