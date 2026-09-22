/**
 * G7D platform tenant entry — client-callable server functions.
 * Handlers dynamically import server-only cookie/DB impl (import-protection safe).
 */
import { z } from "zod";
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { PlatformTenantAccessSessionView } from "@/lib/platform-tenant-entry";

export const startPlatformTenantEntry = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        companyCode: z.string().trim().regex(/^[0-9]{3}$/),
        confirmed: z.literal(true),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { startPlatformTenantEntryImpl } = await import("@/lib/platform-tenant-entry.server");
    return startPlatformTenantEntryImpl({
      userId: context.userId,
      companyCode: data.companyCode,
    });
  });

export const endPlatformTenantEntry = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { endPlatformTenantEntryImpl } = await import("@/lib/platform-tenant-entry.server");
    return endPlatformTenantEntryImpl(context.userId);
  });

export const getMyPlatformTenantAccess = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        tenantSlug: z.string().trim().min(1).max(64).optional(),
        companyCode: z.string().trim().regex(/^[0-9]{3}$/).optional(),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ data, context }): Promise<PlatformTenantAccessSessionView | null> => {
    const { getMyPlatformTenantAccessImpl } = await import("@/lib/platform-tenant-entry.server");
    return getMyPlatformTenantAccessImpl({
      userId: context.userId,
      tenantSlug: data.tenantSlug,
      companyCode: data.companyCode,
    });
  });
