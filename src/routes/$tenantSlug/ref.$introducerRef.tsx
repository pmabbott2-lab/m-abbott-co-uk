import { createFileRoute, Link, notFound, redirect } from "@tanstack/react-router";
import { useRequiredTenantUi } from "@/lib/tenant-ui";
import { TenantPublicShell } from "@/components/tenant/TenantPublicShell";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const assertTenantIntroducerRef = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) =>
    z.object({ tenantSlug: z.string().min(1), introducerRef: z.string().min(1) }).parse(d),
  )
  .handler(async ({ data }) => {
    const { getTenantContextBySlug } = await import("@/lib/tenant-assert.server");
    const { requireTenantFeature } = await import("@/lib/tenant-features.server");
    const { supabaseAdminUntyped } = await import("@/integrations/supabase/client.server");
    const ctx = await getTenantContextBySlug(data.tenantSlug);
    await requireTenantFeature(ctx.tenant.id, "introducer_journey");
    const ref = data.introducerRef.trim().toLowerCase();
    const { data: intro } = await supabaseAdminUntyped
      .from("introducers")
      .select("id, slug, company_name, tenant_id")
      .eq("tenant_id", ctx.tenant.id)
      .eq("active", true)
      .or(`slug.eq.${ref},company_code.eq.${ref}`)
      .maybeSingle();
    if (!intro) {
      return { ok: false as const };
    }
    return {
      ok: true as const,
      companyName: intro.company_name as string,
      slug: intro.slug as string,
    };
  });

export const Route = createFileRoute("/$tenantSlug/ref/$introducerRef")({
  beforeLoad: async ({ params, context }) => {
    const tenant = context.tenant;
    if (!tenant) throw redirect({ to: "/" });
    if (!tenant.features?.introducer_journey) {
      throw redirect({ to: "/$tenantSlug", params: { tenantSlug: tenant.slug } });
    }
    const result = await assertTenantIntroducerRef({
      data: { tenantSlug: params.tenantSlug, introducerRef: params.introducerRef },
    });
    if (!result.ok) {
      throw notFound();
    }
    return { introducer: result };
  },
  component: TenantRefEntry,
});

function TenantRefEntry() {
  const tenant = useRequiredTenantUi();
  const { introducerRef } = Route.useParams();
  const { introducer } = Route.useRouteContext();

  return (
    <TenantPublicShell tenant={tenant}>
      <div className="mx-auto max-w-lg space-y-4">
        <h1 className="text-2xl font-semibold">Introducer link</h1>
        <p className="text-sm text-muted-foreground">
          Firm: <strong>{tenant.tradingName || tenant.companyName}</strong>. Introducer{" "}
          <strong>{introducer.companyName}</strong> (<code>{introducer.slug}</code>) verified for
          this tenant. Reference <code>{introducerRef}</code>.
        </p>
        {tenant.features?.appointment_booking ? (
          <Link
            to="/$tenantSlug/book/$introducerSlug"
            params={{ tenantSlug: tenant.slug, introducerSlug: introducer.slug }}
            className="text-sm text-primary underline-offset-4 hover:underline"
          >
            Book an appointment
          </Link>
        ) : null}
        <div>
          <Link
            to="/$tenantSlug/login"
            params={{ tenantSlug: tenant.slug }}
            className="text-sm text-primary underline-offset-4 hover:underline"
          >
            Continue to {tenant.tradingName || tenant.companyName} sign in
          </Link>
        </div>
      </div>
    </TenantPublicShell>
  );
}
