import { createFileRoute } from "@tanstack/react-router";
import { TenantAuthenticatedApp } from "@/components/tenant/TenantAuthenticatedApp";
import { ChatPage } from "@/routes/_authenticated/chat.$sessionId";

export const Route = createFileRoute("/$tenantSlug/chat/$sessionId")({
  component: () => (
    <TenantAuthenticatedApp>
      <ChatPage />
    </TenantAuthenticatedApp>
  ),
});
