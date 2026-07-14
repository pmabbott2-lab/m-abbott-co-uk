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
    const { data: roles } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    const roleList = (roles ?? []).map((r) => r.role);
    const isAdvisor = roleList.includes("advisor");
    const email = (context.claims as { email?: string }).email;
    const { resolveAdminAccess } = await import("@/lib/admin.functions");
    const access = await resolveAdminAccess(context.userId, email);
    if (!isAdvisor && !access.isAdmin) {
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
