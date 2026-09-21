import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getTeamsCalendarStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { getTeamsLinkStatus } = await import("@/lib/teams-calendar.server");
    return getTeamsLinkStatus(context.userId);
  });

export const getTeamsCalendarConnectUrl = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { resolveActingTenantRole } = await import("@/lib/tenant-role.server");
    const view = await resolveActingTenantRole(context.userId);
    if (!view.isAdvisor && !view.isMainAdmin) {
      throw new Error("Only advisors can link a Teams diary");
    }

    const { buildTeamsAuthorizeUrl } = await import("@/lib/teams-calendar.server");
    return { url: buildTeamsAuthorizeUrl(context.userId) };
  });

export const disconnectTeamsCalendar = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { disconnectTeamsCalendar: disconnect } = await import(
      "@/lib/teams-calendar.server"
    );
    await disconnect(context.userId);
    return { ok: true as const };
  });
