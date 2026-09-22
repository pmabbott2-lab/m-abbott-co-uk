import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { PlatformCompanyTable } from "@/components/platform/PlatformCompanyViews";
import { Button } from "@/components/ui/button";
import { getPlatformDashboardOverview } from "@/lib/platform-dashboard.server";
import { usePlatformAuthority } from "@/lib/platform-ui";

export const Route = createFileRoute("/platform/companies/")({
  component: PlatformCompaniesPage,
});

function PlatformCompaniesPage() {
  const authority = usePlatformAuthority();
  const overviewFn = useServerFn(getPlatformDashboardOverview);
  const overviewQ = useQuery({
    queryKey: ["platform-dashboard-overview"],
    queryFn: () => overviewFn(),
    enabled: authority.canAccessPlatform,
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Companies</h2>
          <p className="text-sm text-muted-foreground">
            Platform metadata for Mortgage Hub companies. GROUP and EXTERNAL are not the same
            operational relationship.
          </p>
        </div>
        {authority.canCreateCompany ? (
          <Button asChild size="sm">
            <Link to="/platform/tenants">Create company</Link>
          </Button>
        ) : null}
      </div>

      {!authority.isSuperOwner ? (
        <p className="text-sm text-muted-foreground">
          Super Admin sees only companies with an explicit grant.
        </p>
      ) : null}

      {overviewQ.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading companies…</p>
      ) : overviewQ.isError ? (
        <p className="text-sm text-destructive">Could not load companies.</p>
      ) : (
        <PlatformCompanyTable
          companies={overviewQ.data?.companies ?? []}
          emptyLabel={
            authority.isSuperAdmin
              ? "No granted companies. Super Admin does not see the full estate."
              : "No companies found."
          }
        />
      )}
    </div>
  );
}
