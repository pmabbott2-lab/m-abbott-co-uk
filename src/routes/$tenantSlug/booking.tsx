import { createFileRoute } from "@tanstack/react-router";
import { TenantAuthenticatedApp } from "@/components/tenant/TenantAuthenticatedApp";
import { BookingPage } from "@/routes/_authenticated/booking";

export const Route = createFileRoute("/$tenantSlug/booking")({
  component: () => (
    <TenantAuthenticatedApp>
      <BookingPage />
    </TenantAuthenticatedApp>
  ),
});
