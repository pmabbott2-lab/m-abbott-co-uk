import { createFileRoute } from "@tanstack/react-router";
import { TenantAuthenticatedApp } from "@/components/tenant/TenantAuthenticatedApp";
import { TextInterviewPage } from "@/routes/_authenticated/text.$sessionId";

export const Route = createFileRoute("/$tenantSlug/text/$sessionId")({
  component: () => (
    <TenantAuthenticatedApp>
      <TextInterviewPage />
    </TenantAuthenticatedApp>
  ),
});
