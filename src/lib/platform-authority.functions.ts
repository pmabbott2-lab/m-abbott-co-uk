/**
 * Platform authority client-callable server functions.
 * Handlers dynamically import server impl (keeps cookie/session code out of client graph).
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { PlatformAuthorityView } from "@/lib/platform-authority";
import { deniedPlatformAuthority } from "@/lib/platform-authority";

export const getMyPlatformAuthority = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PlatformAuthorityView> => {
    const { resolvePlatformAuthority } = await import("@/lib/platform-authority.server");
    const userId = (context as { userId?: string } | undefined)?.userId;
    if (!userId) return deniedPlatformAuthority();
    return resolvePlatformAuthority(userId);
  });
