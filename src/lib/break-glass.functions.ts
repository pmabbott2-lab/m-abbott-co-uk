/**
 * Break-glass client-callable server functions.
 * Handlers dynamically import cookie/session impl (import-protection safe).
 */
import { z } from "zod";
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { BreakGlassStatus } from "@/lib/break-glass";

export const getMyBreakGlassStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<BreakGlassStatus> => {
    const { resolveBreakGlassStatus } = await import("@/lib/break-glass-registry.server");
    const userId = (context as { userId?: string } | undefined)?.userId;
    return resolveBreakGlassStatus(userId);
  });

export const touchBreakGlassPlatformSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const userId = (context as { userId?: string } | undefined)?.userId;
    if (!userId) return { active: false as const };
    const { resolvePlatformAuthority } = await import("@/lib/platform-authority.server");
    const { ensureBreakGlassPlatformSession } = await import("@/lib/break-glass.server");
    const authority = await resolvePlatformAuthority(userId);
    return ensureBreakGlassPlatformSession({
      userId,
      isBreakGlass: authority.isBreakGlass,
      isSuperOwner: authority.isSuperOwner,
      activity: "platform_navigation",
    });
  });

export const auditMyBreakGlassLogout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { auditBreakGlassLogoutBestEffort } = await import("@/lib/break-glass.server");
    const userId = (context as { userId?: string } | undefined)?.userId;
    await auditBreakGlassLogoutBestEffort(userId);
    return { ok: true as const };
  });

/**
 * Establish/replace active break-glass identity.
 * Actor is always the authenticated server user — clients cannot supply p_acting_user_id.
 */
export const establishBreakGlassIdentity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        targetUserId: z.string().uuid(),
        reason: z.string().trim().max(500).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const actingUserId = (context as { userId?: string } | undefined)?.userId;
    if (!actingUserId) throw new Error("Unauthorized");
    const { requireSuperOwner } = await import("@/lib/platform-authority.server");
    await requireSuperOwner(actingUserId);
    const { establishBreakGlassIdentityRpc } = await import("@/lib/break-glass-registry.server");
    return establishBreakGlassIdentityRpc({
      actingUserId,
      targetUserId: data.targetUserId,
      reason: data.reason ?? null,
    });
  });
