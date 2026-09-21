import { createFileRoute } from "@tanstack/react-router";
import { TenantAuthenticatedApp } from "@/components/tenant/TenantAuthenticatedApp";
import { CasesPage } from "@/routes/_authenticated/cases";

export const Route = createFileRoute("/$tenantSlug/cases")({
  component: () => (
    <TenantAuthenticatedApp>
      <CasesPage />
    </TenantAuthenticatedApp>
  ),
});
