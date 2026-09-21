/**
 * Client-importable createServerFn wrappers for tenant presentation.
 * Handlers dynamically import the impl so the browser never loads supabaseAdmin.
 * Fail closed: unknown/inactive/reserved slug → typed error. Never defaults to 001.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
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

export const checkTenantMembershipFn = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) =>
    z.object({ slug: z.string().min(1).max(64), userId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data }) => {
    const { checkTenantMembership } = await import("@/lib/tenant-presentation.impl.server");
    return checkTenantMembership(data.slug, data.userId);
  });

export const listActiveTenantSummariesFn = createServerFn({ method: "GET" }).handler(async () => {
  const { listActiveTenantSummaries } = await import("@/lib/tenant-presentation.impl.server");
  return listActiveTenantSummaries();
});
