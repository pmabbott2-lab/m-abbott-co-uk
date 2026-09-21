import { createFileRoute } from "@tanstack/react-router";
import { CreateCompanyWizard } from "@/components/company/CreateCompanyWizard";
import { usePlatformAuthority } from "@/lib/platform-ui";

export const Route = createFileRoute("/platform/tenants")({
  component: PlatformTenantsPage,
});

function PlatformTenantsPage() {
  const authority = usePlatformAuthority();
  if (!authority.canCreateCompany) {
    return (
      <p className="text-sm text-muted-foreground">
        Create Company requires Super Owner. Super Admin cannot provision tenants.
      </p>
    );
  }
  return <CreateCompanyWizard cancelTo="/platform" />;
}
