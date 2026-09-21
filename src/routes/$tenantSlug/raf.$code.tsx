import { createFileRoute, notFound } from "@tanstack/react-router";
import { resolveReferralCodeMeta } from "@/lib/referrals.functions";
import { useRequiredTenantUi } from "@/lib/tenant-ui";
import { RafLanding } from "@/routes/raf.$code";

export const Route = createFileRoute("/$tenantSlug/raf/$code")({
  loader: async ({ params }) => {
    const meta = await resolveReferralCodeMeta(params.code);
    return { meta };
  },
  component: TenantRafPage,
});

function TenantRafPage() {
  const { code, tenantSlug } = Route.useParams();
  const { meta } = Route.useLoaderData();
  const tenant = useRequiredTenantUi();
  if (meta?.tenantSlug && meta.tenantSlug !== tenantSlug) {
    throw notFound();
  }
  if (!meta?.tenantSlug) {
    throw notFound();
  }
  return (
    <RafLanding
      code={code}
      initialMeta={{
        referrer_name: meta.referrer_name,
        tenantSlug: tenant.slug,
      }}
    />
  );
}
