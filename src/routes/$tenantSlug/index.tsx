import { createFileRoute, Link } from "@tanstack/react-router";
import { TenantPublicShell } from "@/components/tenant/TenantPublicShell";
import { useRequiredTenantUi } from "@/lib/tenant-ui";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/$tenantSlug/")({
  head: ({ match }) => {
    const tenant = match.context.tenant;
    const title = tenant?.pageTitle ?? "Mortgage Hub";
    return {
      meta: [
        { title },
        {
          name: "description",
          content: tenant
            ? `${tenant.tradingName || tenant.companyName} on Mortgage Hub`
            : "Mortgage Hub",
        },
      ],
    };
  },
  component: TenantLanding,
});

function TenantLanding() {
  const tenant = useRequiredTenantUi();
  const displayName = tenant.tradingName || tenant.companyName;

  return (
    <TenantPublicShell tenant={tenant} showSusanCta={tenant.susanEnabled}>
      <section className="space-y-6">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground md:text-4xl">
          Welcome to {displayName}
        </h1>
        <p className="max-w-2xl text-muted-foreground">
          Sign in to your {displayName} workspace on Mortgage Hub. Access is controlled by your
          firm membership — this address alone does not grant access to another company&apos;s
          data.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link to="/$tenantSlug/login" params={{ tenantSlug: tenant.slug }}>
            <Button size="lg">Sign in to {displayName}</Button>
          </Link>
          {tenant.susanEnabled ? (
            <Link
              to="/$tenantSlug/login"
              params={{ tenantSlug: tenant.slug }}
              search={{ join: true, start: "voice" } as never}
            >
              <Button size="lg" variant="outline">
                Start with Susan
              </Button>
            </Link>
          ) : null}
        </div>
        {!tenant.susanEnabled ? (
          <p className="text-sm text-muted-foreground">
            Guided Susan journeys are not enabled for this firm.
          </p>
        ) : null}
        {tenant.usedNeutralFallback ? (
          <p className="text-xs text-muted-foreground">
            Using Mortgage Hub neutral presentation until firm branding assets are configured.
          </p>
        ) : null}
      </section>
    </TenantPublicShell>
  );
}
