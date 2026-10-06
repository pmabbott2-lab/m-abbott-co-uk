import { createFileRoute, notFound } from "@tanstack/react-router";
import { resolveReferralCodeMetaForTenant } from "@/lib/referrals.functions";
import { useRequiredTenantUi } from "@/lib/tenant-ui";
import { RafLanding } from "@/routes/raf.$code";

export const Route = createFileRoute("/$tenantSlug/raf/$code")({
  loader: async ({ params }) => {
    // B2a: resolve the referrer identity ONLY when the URL tenant matches the code's owning tenant.
    // A mismatched / unknown tenant yields null → not-found, so the referrer name is never returned
    // to the client before tenant validation.
    const meta = await resolveReferralCodeMetaForTenant(params.code, params.tenantSlug);
    if (!meta) {
      throw notFound();
    }
    return { meta };
  },
  component: TenantRafPage,
});

function TenantRafPage() {
  const { code } = Route.useParams();
  const { meta } = Route.useLoaderData();
  const tenant = useRequiredTenantUi();
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
