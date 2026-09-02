import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { format } from "date-fns";
import { listRelationshipPipeline, refreshRelationshipActionableDates } from "@/lib/relationship.functions";
import { Button } from "@/components/ui/button";
import { ReportTableScroll } from "@/components/ReportTableScroll";
import { toast } from "sonner";

export function RelationshipManagementPanel({ canRefresh }: { canRefresh: boolean }) {
  const qc = useQueryClient();
  const listFn = useServerFn(listRelationshipPipeline);
  const refreshFn = useServerFn(refreshRelationshipActionableDates);

  const q = useQuery({
    queryKey: ["relationship-pipeline"],
    queryFn: () => listFn({ data: { withinDays: 365 } }),
  });

  const refresh = useMutation({
    mutationFn: () => refreshFn(),
    onSuccess: (r) => {
      toast.success(`Refreshed actionable dates for ${r.updated} case(s)`);
      qc.invalidateQueries({ queryKey: ["relationship-pipeline"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Refresh failed"),
  });

  const rows = q.data?.rows ?? [];

  if (q.data?.migrationRequired) {
    return (
      <div className="rounded-2xl border bg-card p-6 text-sm text-muted-foreground">
        Run <code className="text-xs">supabase/RUN_JOURNEY_FINANCE_CASE.sql</code> then add case details on
        customer cases.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-lg">Relationship management</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Renewals pipeline by product expiry. Actionable dates use lender lead times (OpenAI-assisted,
            refreshed weekly). Indicative only — confirm with lender.
          </p>
        </div>
        {canRefresh && (
          <Button
            variant="outline"
            size="sm"
            disabled={refresh.isPending}
            onClick={() => refresh.mutate()}
          >
            {refresh.isPending ? "Refreshing…" : "Refresh lender windows"}
          </Button>
        )}
      </div>

      <ReportTableScroll visibleRows={12}>
        {q.isLoading && <div className="p-6 text-sm text-muted-foreground">Loading…</div>}
        {!q.isLoading && rows.length === 0 && (
          <div className="p-6 text-sm text-muted-foreground">
            No cases with product expiry in the next 12 months. Add case details on customer cases.
          </div>
        )}
        {rows.length > 0 && (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="p-3 font-medium">Customer</th>
                <th className="p-3 font-medium">Case</th>
                <th className="p-3 font-medium">Lender</th>
                <th className="p-3 font-medium">Expiry</th>
                <th className="p-3 font-medium">Actionable from</th>
                <th className="p-3 font-medium">Journey</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((row) => (
                <tr key={row.sessionId}>
                  <td className="p-3 font-medium">{row.customerName}</td>
                  <td className="p-3">
                    <Link
                      to="/sessions/$sessionId"
                      params={{ sessionId: row.sessionId }}
                      className="text-primary hover:underline font-mono text-xs"
                    >
                      {row.caseRef}
                    </Link>
                  </td>
                  <td className="p-3">{row.currentLender ?? "—"}</td>
                  <td className="p-3 whitespace-nowrap">
                    {row.productExpiryDate
                      ? format(new Date(row.productExpiryDate), "d MMM yyyy")
                      : "—"}
                  </td>
                  <td className="p-3 whitespace-nowrap">
                    {row.actionableFromDate
                      ? format(new Date(row.actionableFromDate), "d MMM yyyy")
                      : "—"}
                  </td>
                  <td className="p-3 text-muted-foreground">{row.journeyStage}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </ReportTableScroll>
    </div>
  );
}
