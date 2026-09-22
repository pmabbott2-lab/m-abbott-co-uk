import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { PlatformCompanyDetailCard } from "@/components/platform/PlatformCompanyViews";
import { getPlatformCompanyDetail } from "@/lib/platform-dashboard.server";
import {
  companyDetailFailureMessage,
  isValidCompanyCodeParam,
} from "@/lib/platform-dashboard";
import { usePlatformAuthority } from "@/lib/platform-ui";

export const Route = createFileRoute("/platform/companies/$companyCode")({
  component: PlatformCompanyDetailPage,
});

function PlatformCompanyDetailPage() {
  const { companyCode } = Route.useParams();
  const authority = usePlatformAuthority();
  const detailFn = useServerFn(getPlatformCompanyDetail);
  const codeOk = isValidCompanyCodeParam(companyCode);
  const detailQ = useQuery({
    queryKey: ["platform-company-detail", companyCode],
    // TanStack Start: validated input must be wrapped as { data: ... }.
    queryFn: () => detailFn({ data: { companyCode } }),
    enabled: authority.canAccessPlatform && codeOk,
  });

  const result = detailQ.data;
  const failureReason =
    !codeOk
      ? ("invalid_code" as const)
      : detailQ.isError
        ? ("query_failure" as const)
        : result && !result.ok
          ? result.reason
          : null;

  return (
    <div className="space-y-4">
      <Link
        to="/platform/companies"
        className="text-sm text-muted-foreground underline-offset-4 hover:underline"
      >
        ← Companies
      </Link>
      {detailQ.isLoading && codeOk ? (
        <p className="text-sm text-muted-foreground">Loading company…</p>
      ) : failureReason ? (
        <p className="text-sm text-destructive">{companyDetailFailureMessage(failureReason)}</p>
      ) : result?.ok ? (
        <PlatformCompanyDetailCard company={result.company} />
      ) : (
        <p className="text-sm text-muted-foreground">Loading company…</p>
      )}
    </div>
  );
}
