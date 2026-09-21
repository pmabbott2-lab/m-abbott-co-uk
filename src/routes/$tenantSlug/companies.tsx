import { createFileRoute } from "@tanstack/react-router";
import { TenantAuthenticatedApp } from "@/components/tenant/TenantAuthenticatedApp";
import { CompaniesPage } from "@/routes/_authenticated/companies";

export const Route = createFileRoute("/$tenantSlug/companies")({
  component: () => (
    <TenantAuthenticatedApp>
      <CompaniesPage />
    </TenantAuthenticatedApp>
  ),
});
