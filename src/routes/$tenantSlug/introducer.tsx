import { createFileRoute } from "@tanstack/react-router";
import { TenantAuthenticatedApp } from "@/components/tenant/TenantAuthenticatedApp";
import { IntroducerPortalPage } from "@/routes/_authenticated/introducer";

export const Route = createFileRoute("/$tenantSlug/introducer")({
  component: () => (
    <TenantAuthenticatedApp>
      <IntroducerPortalPage />
    </TenantAuthenticatedApp>
  ),
});
