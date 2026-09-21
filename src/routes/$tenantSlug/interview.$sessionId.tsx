import { createFileRoute } from "@tanstack/react-router";
import { TenantAuthenticatedApp } from "@/components/tenant/TenantAuthenticatedApp";
import { InterviewPage } from "@/routes/_authenticated/interview.$sessionId";

export const Route = createFileRoute("/$tenantSlug/interview/$sessionId")({
  component: () => (
    <TenantAuthenticatedApp>
      <InterviewPage />
    </TenantAuthenticatedApp>
  ),
});
