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
      <div className="space-y-3">
        <h2 className="text-xl font-semibold">Create company</h2>
        <p className="text-sm text-muted-foreground">
          Create Company requires Super Owner. Super Admin cannot provision tenants.
        </p>
      </div>
    );
  }
  return <CreateCompanyWizard cancelTo="/platform" />;
}
