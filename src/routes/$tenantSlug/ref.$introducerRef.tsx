import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useEffect } from "react";
import { useRequiredTenantUi } from "@/lib/tenant-ui";
import { TenantPublicShell } from "@/components/tenant/TenantPublicShell";
import { Button } from "@/components/ui/button";
import { resolveReferralSlug } from "@/lib/introducer.functions";
import { resolvePublicIntroducerRefAccess } from "@/lib/tenant-introducer-ref";
import { setReferralCookie } from "@/lib/referral";

export const Route = createFileRoute("/$tenantSlug/ref/$introducerRef")({
  beforeLoad: async ({ params, context }) => {
    const tenant = context.tenant;
    if (!tenant) throw notFound();
    if (!tenant.features?.introducer_journey) {
      throw notFound();
    }

    let intro: Awaited<ReturnType<typeof resolveReferralSlug>> = null;
    try {
      intro = await resolveReferralSlug({
        data: { slug: params.introducerRef, tenantSlug: params.tenantSlug },
      });
    } catch {
      throw notFound();
    }

    const access = resolvePublicIntroducerRefAccess({
      urlTenantSlug: params.tenantSlug,
      introducerTenantSlug: intro?.tenantSlug ?? null,
      introducerSlug: intro?.slug ?? null,
      introducerRef: params.introducerRef,
    });
    if (access !== "ok" || !intro) {
      throw notFound();
    }

    return {
      introducer: {
        companyName: intro.company_name as string,
        slug: intro.slug as string,
      },
    };
  },
  component: TenantRefEntry,
});

function TenantRefEntry() {
  const tenant = useRequiredTenantUi();
  const { introducer } = Route.useRouteContext();

  useEffect(() => {
    if (introducer.slug) setReferralCookie(introducer.slug);
  }, [introducer.slug]);

  const displayName = tenant.tradingName || tenant.companyName;

  return (
    <TenantPublicShell tenant={tenant} showSusanCta={tenant.susanEnabled}>
      <div className="mx-auto max-w-lg space-y-6">
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">Referred by</p>
          <h1 className="text-2xl font-semibold">{introducer.companyName}</h1>
          <p className="text-sm text-muted-foreground">
            Continue with {displayName}. Your introducer stays attached to this journey.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          {tenant.features?.appointment_booking ? (
            <Link
              to="/$tenantSlug/book/$introducerSlug"
              params={{ tenantSlug: tenant.slug, introducerSlug: introducer.slug }}
            >
              <Button size="lg">Book an appointment</Button>
            </Link>
          ) : null}
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
          ) : (
            <Link to="/$tenantSlug/login" params={{ tenantSlug: tenant.slug }} search={{ join: true } as never}>
              <Button size="lg" variant="outline">
                Continue
              </Button>
            </Link>
          )}
        </div>
      </div>
    </TenantPublicShell>
  );
}
