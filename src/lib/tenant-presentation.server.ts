/**
 * Client-importable createServerFn wrappers for tenant presentation.
 * Handlers dynamically import the impl so the browser never loads supabaseAdmin.
 * Fail closed: unknown/inactive/reserved slug → typed error. Never defaults to 001.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { TenantPresentation, TenantSlugLayoutResult } from "@/lib/tenant-presentation";

/**
 * Server-only layout load for `/$tenantSlug`.
 * Must be called via createServerFn so the browser never runs supabaseAdmin.
 */
export const getTenantSlugLayoutFn = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => z.object({ slug: z.string().min(1).max(64) }).parse(d))
  .handler(async ({ data }): Promise<TenantSlugLayoutResult> => {
    const { getTenantSlugLayout } = await import("@/lib/tenant-presentation.impl.server");
    return getTenantSlugLayout(data.slug);
  });

export const getTenantPresentationFn = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => z.object({ slug: z.string().min(1).max(64) }).parse(d))
  .handler(async ({ data }): Promise<TenantPresentation> => {
    const { loadTenantPresentationBySlug } = await import("@/lib/tenant-presentation.impl.server");
    return loadTenantPresentationBySlug(data.slug);
  });

/** Unknown keys (including any client-supplied userId) are stripped; the subject is the verified caller. */
export const checkTenantMembershipInput = z.object({ slug: z.string().min(1).max(64) });

export const checkTenantMembershipFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => checkTenantMembershipInput.parse(d))
  .handler(async ({ data, context }) => {
    const userId = (context as { userId?: string } | undefined)?.userId;
    if (!userId) throw new Error("Not authenticated");
    const { checkTenantMembership } = await import("@/lib/tenant-presentation.impl.server");
    return checkTenantMembership(data.slug, userId);
  });

export const listActiveTenantSummariesFn = createServerFn({ method: "GET" }).handler(async () => {
  const { listActiveTenantSummaries } = await import("@/lib/tenant-presentation.impl.server");
  return listActiveTenantSummaries();
});
