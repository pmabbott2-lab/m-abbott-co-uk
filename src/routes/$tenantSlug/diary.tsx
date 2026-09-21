import { createFileRoute } from "@tanstack/react-router";
import { TenantAuthenticatedApp } from "@/components/tenant/TenantAuthenticatedApp";
import { DiaryPage } from "@/routes/_authenticated/diary";

export const Route = createFileRoute("/$tenantSlug/diary")({
  validateSearch: (search: Record<string, unknown>) => ({
    teams: typeof search.teams === "string" ? search.teams : undefined,
    reason: typeof search.reason === "string" ? search.reason : undefined,
  }),
  component: () => (
    <TenantAuthenticatedApp>
      <DiaryPage />
    </TenantAuthenticatedApp>
  ),
});
