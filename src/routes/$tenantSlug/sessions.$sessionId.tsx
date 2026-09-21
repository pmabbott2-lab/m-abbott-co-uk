import { createFileRoute } from "@tanstack/react-router";
import { TenantAuthenticatedApp } from "@/components/tenant/TenantAuthenticatedApp";
import { SessionDetail } from "@/routes/_authenticated/sessions.$sessionId";

export const Route = createFileRoute("/$tenantSlug/sessions/$sessionId")({
  component: () => (
    <TenantAuthenticatedApp>
      <SessionDetail />
    </TenantAuthenticatedApp>
  ),
});
