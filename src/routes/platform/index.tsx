import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  PlatformCompanyTable,
  PlatformRoleCounts,
  PlatformStatCards,
} from "@/components/platform/PlatformCompanyViews";
import { Button } from "@/components/ui/button";
import { getPlatformDashboardOverview } from "@/lib/platform-dashboard.server";
import { emptyDashboard } from "@/lib/platform-dashboard";
import { usePlatformAuthority } from "@/lib/platform-ui";

export const Route = createFileRoute("/platform/")({
  component: PlatformHomePage,
});

function PlatformHomePage() {
  const authority = usePlatformAuthority();
  const overviewFn = useServerFn(getPlatformDashboardOverview);
  const overviewQ = useQuery({
    queryKey: ["platform-dashboard-overview"],
    queryFn: () => overviewFn(),
    enabled: authority.canAccessPlatform,
  });
  const overview = overviewQ.data ?? emptyDashboard(authority.isSuperOwner ? "all" : "granted");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Overview</h2>
          <p className="text-sm text-muted-foreground">
            Mortgage Hub platform control centre. Tenant metadata and aggregate counts only.
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
          Super Admin visibility is grant-scoped. Companies without an explicit grant are not
          listed. There is no all-company authority.
        </p>
      ) : null}

      {overviewQ.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading platform overview…</p>
      ) : overviewQ.isError ? (
        <p className="text-sm text-destructive">Could not load platform overview.</p>
      ) : (
        <>
          <PlatformStatCards overview={overview} />
          <PlatformRoleCounts overview={overview} />
          <section className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className="font-medium">Companies</h3>
              <Button asChild size="sm" variant="outline">
                <Link to="/platform/companies">View all</Link>
              </Button>
            </div>
            <PlatformCompanyTable
              companies={overview.companies}
              emptyLabel={
                authority.isSuperAdmin
                  ? "No granted companies. Super Admin does not see the full estate."
                  : "No companies found."
              }
            />
          </section>
        </>
      )}
    </div>
  );
}
