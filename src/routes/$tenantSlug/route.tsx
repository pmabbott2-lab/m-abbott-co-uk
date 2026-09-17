import { createFileRoute, Outlet, notFound } from "@tanstack/react-router";
import { TenantContextError } from "@/lib/tenant-context.server";
import {
  loadTenantPresentationBySlug,
  peekTenantBySlug,
} from "@/lib/tenant-presentation.server";
import { isReservedTenantSlug, type TenantPresentation } from "@/lib/tenant-presentation";
import { TenantUiProvider } from "@/lib/tenant-ui";

export type TenantSlugRouteContext = {
  tenant: TenantPresentation | null;
  inactive: boolean;
  inactiveName: string | null;
};

export const Route = createFileRoute("/$tenantSlug")({
  beforeLoad: async ({ params }): Promise<TenantSlugRouteContext> => {
    const slug = params.tenantSlug?.trim().toLowerCase() ?? "";
    if (!slug || isReservedTenantSlug(slug)) {
      throw notFound();
    }

    try {
      const record = await peekTenantBySlug(slug);
      if (record.status !== "active") {
        return {
          tenant: null,
          inactive: true,
          inactiveName: record.companyName,
        };
      }
      const tenant = await loadTenantPresentationBySlug(slug);
      return { tenant, inactive: false, inactiveName: null };
    } catch (e) {
      if (e instanceof TenantContextError && e.code === "TENANT_NOT_FOUND") {
        throw notFound();
      }
      throw e;
    }
  },
  component: TenantSlugLayout,
});

function TenantSlugLayout() {
  const ctx = Route.useRouteContext();

  if (ctx.inactive) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="max-w-md text-center">
          <h1 className="text-xl font-semibold text-foreground">Firm unavailable</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {ctx.inactiveName
              ? `${ctx.inactiveName} is not currently available on Mortgage Hub.`
              : "This firm is not currently available on Mortgage Hub."}
          </p>
          <p className="mt-4 text-sm">
            <a href="/" className="text-primary underline-offset-4 hover:underline">
              Return to Mortgage Hub
            </a>
          </p>
        </div>
      </div>
    );
  }

  if (!ctx.tenant) {
    throw notFound();
  }

  return (
    <TenantUiProvider value={ctx.tenant}>
      <Outlet />
    </TenantUiProvider>
  );
}
