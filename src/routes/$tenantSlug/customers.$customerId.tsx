import { createFileRoute } from "@tanstack/react-router";
import { TenantAuthenticatedApp } from "@/components/tenant/TenantAuthenticatedApp";
import { CustomerHubPage } from "@/routes/_authenticated/customers.$customerId";

export const Route = createFileRoute("/$tenantSlug/customers/$customerId")({
  component: () => (
    <TenantAuthenticatedApp>
      <CustomerHubPage />
    </TenantAuthenticatedApp>
  ),
});
