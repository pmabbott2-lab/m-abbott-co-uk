import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { PlatformCompanyDetailCard } from "@/components/platform/PlatformCompanyViews";
import { getPlatformCompanyDetail } from "@/lib/platform-dashboard.server";
import { usePlatformAuthority } from "@/lib/platform-ui";

export const Route = createFileRoute("/platform/companies/$companyCode")({
  component: PlatformCompanyDetailPage,
});

function PlatformCompanyDetailPage() {
  const { companyCode } = Route.useParams();
  const authority = usePlatformAuthority();
  const detailFn = useServerFn(getPlatformCompanyDetail);
  const detailQ = useQuery({
    queryKey: ["platform-company-detail", companyCode],
    queryFn: () => detailFn({ companyCode }),
    enabled: authority.canAccessPlatform && Boolean(companyCode),
  });

  return (
    <div className="space-y-4">
      <Link
        to="/platform/companies"
        className="text-sm text-muted-foreground underline-offset-4 hover:underline"
      >
        ← Companies
      </Link>
      {detailQ.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading company…</p>
      ) : detailQ.isError ? (
        <p className="text-sm text-destructive">Could not load company.</p>
      ) : !detailQ.data ? (
        <p className="text-sm text-muted-foreground">Company not found or not in your platform scope.</p>
      ) : (
        <PlatformCompanyDetailCard company={detailQ.data} />
      )}
    </div>
  );
}
