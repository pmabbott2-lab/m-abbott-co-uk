import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { TenantAuthenticatedGate } from "@/components/tenant/TenantAuthenticatedGate";
import { useRequiredTenantUi } from "@/lib/tenant-ui";

export const Route = createFileRoute("/$tenantSlug/workspace")({
  head: ({ match }) => {
    const tenant = match.context.tenant;
    return {
      meta: [
        {
          title: tenant
            ? `${tenant.tradingName || tenant.companyName} workspace | Mortgage Hub`
            : "Workspace | Mortgage Hub",
        },
      ],
    };
  },
  component: TenantWorkspaceGate,
});

/**
 * Membership-gated entry, then tenant home.
 * Slug is presentation/navigation; membership + RLS remain the grant.
 */
function TenantWorkspaceGate() {
  return (
    <TenantAuthenticatedGate>
      <TenantWorkspaceRedirect />
    </TenantAuthenticatedGate>
  );
}

function TenantWorkspaceRedirect() {
  const tenant = useRequiredTenantUi();
  const navigate = useNavigate();

  useEffect(() => {
    void navigate({
      to: "/$tenantSlug/home",
      params: { tenantSlug: tenant.slug },
      replace: true,
    });
  }, [tenant.slug, navigate]);

  return (
    <p className="text-center text-sm text-muted-foreground">Opening your workspace…</p>
  );
}
