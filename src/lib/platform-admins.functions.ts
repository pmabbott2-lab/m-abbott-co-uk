/**
 * G7E-2A Platform administrator management — client-callable server functions.
 */
import { z } from "zod";
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { PlatformAdminsView } from "@/lib/platform-admins";

export const listPlatformAdmins = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PlatformAdminsView> => {
    const { listPlatformAdminsImpl } = await import("@/lib/platform-admins.server");
    return listPlatformAdminsImpl({ userId: context.userId });
  });

export const addPlatformAdministrator = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        firstName: z.string().trim().min(1).max(80),
        lastName: z.string().trim().min(1).max(80),
        email: z.string().trim().email().max(254),
        platformRole: z.enum(["super_owner", "super_admin"]),
        confirmSuperOwner: z.boolean().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { addPlatformAdministratorImpl } = await import("@/lib/platform-admins.server");
    return addPlatformAdministratorImpl({
      userId: context.userId,
      firstName: data.firstName,
      lastName: data.lastName,
      email: data.email,
      platformRole: data.platformRole,
      confirmSuperOwner: data.confirmSuperOwner,
    });
  });

export const cancelPlatformAdminInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ inviteEmail: z.string().trim().email().max(254) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { cancelPlatformAdminInviteImpl } = await import("@/lib/platform-admins.server");
    return cancelPlatformAdminInviteImpl({
      userId: context.userId,
      inviteEmail: data.inviteEmail,
    });
  });

export const revokePlatformAdministrator = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        adminEmail: z.string().trim().email().max(254),
        confirm: z.literal(true),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { revokePlatformAdministratorImpl } = await import("@/lib/platform-admins.server");
    return revokePlatformAdministratorImpl({
      userId: context.userId,
      adminEmail: data.adminEmail,
      confirm: data.confirm,
    });
  });

/** Public: resolve invitation metadata by raw token (no authority granted). */
export const resolvePlatformInvite = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => z.object({ token: z.string().trim().min(16).max(200) }).parse(d))
  .handler(async ({ data }) => {
    const { resolvePlatformInviteImpl } = await import("@/lib/platform-admins.server");
    return resolvePlatformInviteImpl({ rawToken: data.token });
  });

/** Authenticated: accept invitation for the signed-in identity (email must match). */
export const acceptPlatformInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ token: z.string().trim().min(16).max(200) }).parse(d))
  .handler(async ({ data, context }) => {
    const { acceptPlatformInviteImpl } = await import("@/lib/platform-admins.server");
    return acceptPlatformInviteImpl({
      userId: context.userId,
      rawToken: data.token,
    });
  });
