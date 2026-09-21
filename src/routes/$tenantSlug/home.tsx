import { createFileRoute } from "@tanstack/react-router";
import { PhoneCaptureGate } from "@/components/PhoneCaptureGate";
import { TenantAuthenticatedGate } from "@/components/tenant/TenantAuthenticatedGate";
import { Home } from "@/routes/_authenticated/home";

export const Route = createFileRoute("/$tenantSlug/home")({
  pendingMs: 0,
  pendingMinMs: 0,
  head: ({ match }) => {
    const tenant = match.context.tenant;
    const name = tenant?.tradingName || tenant?.companyName;
    return {
      meta: [
        {
          title: name ? `${name} | Mortgage Hub` : "Workspace | Mortgage Hub",
        },
      ],
    };
  },
  component: TenantHome,
});

function TenantHome() {
  return (
    <TenantAuthenticatedGate>
      <PhoneCaptureGate>
        <Home />
      </PhoneCaptureGate>
    </TenantAuthenticatedGate>
  );
}
