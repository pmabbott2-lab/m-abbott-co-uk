/**
 * G7E-1 Tenant Owner management — client-callable server functions.
 */
import { z } from "zod";
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { PlatformCompanyOwnersView } from "@/lib/platform-tenant-owners";

export const listPlatformCompanyOwners = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ companyCode: z.string().trim().regex(/^[0-9]{3}$/) }).parse(d),
  )
  .handler(async ({ data, context }): Promise<PlatformCompanyOwnersView> => {
    const { listPlatformCompanyOwnersImpl } = await import("@/lib/platform-tenant-owners.server");
    return listPlatformCompanyOwnersImpl({
      userId: context.userId,
      companyCode: data.companyCode,
    });
  });

export const addPlatformTenantOwner = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        companyCode: z.string().trim().regex(/^[0-9]{3}$/),
        firstName: z.string().trim().min(1).max(80),
        lastName: z.string().trim().min(1).max(80),
        email: z.string().trim().email().max(254),
        confirmElevate: z.boolean().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { addPlatformTenantOwnerImpl } = await import("@/lib/platform-tenant-owners.server");
    return addPlatformTenantOwnerImpl({
      userId: context.userId,
      companyCode: data.companyCode,
      firstName: data.firstName,
      lastName: data.lastName,
      email: data.email,
      confirmElevate: data.confirmElevate,
    });
  });

export const removePlatformTenantOwner = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        companyCode: z.string().trim().regex(/^[0-9]{3}$/),
        ownerEmail: z.string().trim().email().max(254),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { removePlatformTenantOwnerImpl } = await import("@/lib/platform-tenant-owners.server");
    return removePlatformTenantOwnerImpl({
      userId: context.userId,
      companyCode: data.companyCode,
      ownerEmail: data.ownerEmail,
    });
  });

export const cancelPlatformOwnerInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        companyCode: z.string().trim().regex(/^[0-9]{3}$/),
        inviteEmail: z.string().trim().email().max(254),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { cancelPlatformOwnerInviteImpl } = await import("@/lib/platform-tenant-owners.server");
    return cancelPlatformOwnerInviteImpl({
      userId: context.userId,
      companyCode: data.companyCode,
      inviteEmail: data.inviteEmail,
    });
  });
