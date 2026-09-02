import { format } from "date-fns";
import { formatPence } from "@/lib/commission-summary";
import {
  BENEFICIARY_ROLE_LABELS,
  PAYOUT_STATUS_LABELS,
  type PayoutStatus,
} from "@/lib/finance.functions";
import { Button } from "@/components/ui/button";
import { ReportExportBox } from "@/components/ReportExportBox";
import { ReportTableScroll } from "@/components/ReportTableScroll";
import {
  commissionPipelineSummaryToSheet,
  commissionRowsToSheet,
} from "@/lib/report-mappers";
import { PayoutStatusBadge } from "@/components/PayoutStatusBadge";
import { useMyCommissionData } from "@/components/useMyCommissionData";

type MyCommissionPipelinePanelProps = {
  title?: string;
  viewAsUserId?: string;
};

export function MyCommissionPipelinePanel({
  title = "My commission",
  viewAsUserId,
}: MyCommissionPipelinePanelProps) {
  const data = useMyCommissionData(viewAsUserId);

  const detailExportSheet = commissionRowsToSheet(data.allRows);
  const pipelineExportSheet = commissionPipelineSummaryToSheet(data.allRows);

  if (data.migrationRequired) {
    return (
      <div className="rounded-2xl border bg-card p-6 text-sm text-muted-foreground">
        Commission tracking is being set up — check back after fees have been posted.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border bg-card p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="font-medium">Pipeline summary</h4>
          <div className="flex flex-wrap gap-2">
            {(
              [
                ["month", "This month"],
                ["ytd", "YTD"],
                ["l12m", "Last 12 months"],
              ] as const
            ).map(([value, label]) => (
              <Button
                key={value}
                type="button"
                size="sm"
                variant={data.pipelineWindow === value ? "secondary" : "ghost"}
                onClick={() => data.setPipelineWindow(value)}
              >
                {label}
              </Button>
            ))}
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Open commission (pending + received) created in{" "}
          {data.pipelineSummary.label.toLowerCase()}.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="rounded-xl border bg-muted/20 p-3">
            <p className="text-xs text-muted-foreground">Pending</p>
            <p className="text-lg font-semibold mt-1">{formatPence(data.pipelineSummary.pendingPence)}</p>
          </div>
          <div className="rounded-xl border bg-muted/20 p-3">
            <p className="text-xs text-muted-foreground">Received</p>
            <p className="text-lg font-semibold mt-1">{formatPence(data.pipelineSummary.receivedPence)}</p>
          </div>
          <div className="rounded-xl border bg-muted/20 p-3">
            <p className="text-xs text-muted-foreground">Total pipeline</p>
            <p className="text-lg font-semibold mt-1">{formatPence(data.pipelineSummary.totalPence)}</p>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {(
          [
            ["all", "All"],
            ["pending", "Pending"],
            ["received", "Received"],
            ["paid", "Paid"],
            ["rejected", "Rejected"],
            ["lost", "Lost"],
          ] as const
        ).map(([value, label]) => (
          <Button
            key={value}
            type="button"
            size="sm"
            variant={data.statusFilter === value ? "secondary" : "ghost"}
            onClick={() => data.setStatusFilter(value)}
          >
            {label}
          </Button>
        ))}
      </div>

      {data.statusFilter !== "all" && data.rows.length > 0 && (
        <p className="text-sm text-muted-foreground">
          Total ({PAYOUT_STATUS_LABELS[data.statusFilter as PayoutStatus]}): £
          {(data.rows.reduce((sum, r) => sum + r.amountPence, 0) / 100).toFixed(2)}
        </p>
      )}

      <ReportTableScroll visibleRows={10}>
        {data.isLoading && (
          <div className="p-6 text-sm text-muted-foreground">Loading your commission…</div>
        )}
        {!data.isLoading && data.rows.length === 0 && (
          <div className="p-6 text-sm text-muted-foreground">
            No commission yet. Rows appear when customer fees are posted on your cases, when you
            refer customers as an introducer, or when a Refer-a-Friend bonus becomes eligible.
          </div>
        )}
        {data.rows.length > 0 && (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="p-3 font-medium sticky top-0 bg-muted/40">When</th>
                <th className="p-3 font-medium sticky top-0 bg-muted/40">Type</th>
                <th className="p-3 font-medium sticky top-0 bg-muted/40">Case / context</th>
                <th className="p-3 font-medium text-right sticky top-0 bg-muted/40">Amount</th>
                <th className="p-3 font-medium sticky top-0 bg-muted/40">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {data.rows.map((row) => {
                const context =
                  row.beneficiaryRole === "referrer"
                    ? row.referredFriendLabel
                      ? `Friend: ${row.referredFriendLabel}`
                      : "RAF bonus"
                    : row.caseRef
                      ? row.caseRef
                      : row.sessionId
                        ? "Case (no ref)"
                        : "—";
                const pctLabel =
                  row.commissionPct != null && row.beneficiaryRole !== "referrer"
                    ? ` · ${row.commissionPct}%`
                    : "";
                const statusDate =
                  row.payoutStatus === "paid" && row.payoutAt
                    ? format(new Date(row.payoutAt), "d/M/yyyy")
                    : row.payoutStatus === "rejected" && row.payoutAt
                      ? format(new Date(row.payoutAt), "d/M/yyyy")
                      : null;

                return (
                  <tr
                    key={row.id}
                    className={row.payoutStatus === "rejected" ? "opacity-60" : undefined}
                  >
                    <td className="p-3 whitespace-nowrap text-muted-foreground">
                      {format(new Date(row.createdAt), "d MMM yyyy")}
                    </td>
                    <td className="p-3">
                      {BENEFICIARY_ROLE_LABELS[row.beneficiaryRole] ?? row.beneficiaryRole}
                      {row.feeType && row.beneficiaryRole !== "referrer" && (
                        <span className="block text-xs text-muted-foreground capitalize">
                          {row.feeType.replace(/_/g, " ")}
                          {pctLabel}
                        </span>
                      )}
                    </td>
                    <td className="p-3 text-muted-foreground">{context}</td>
                    <td className="p-3 text-right font-medium whitespace-nowrap">
                      £{(row.amountPence / 100).toFixed(2)}
                    </td>
                    <td className="p-3">
                      <PayoutStatusBadge status={row.payoutStatus} />
                      {statusDate && (
                        <span className="block text-muted-foreground text-xs font-normal mt-0.5">
                          {statusDate}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </ReportTableScroll>

      <div className="flex flex-wrap gap-3">
        <ReportExportBox
          filename={`my-commission-detail-${new Date().toISOString().slice(0, 10)}`}
          label="Export detail"
          sheets={[detailExportSheet]}
          pdfTitle={`${title} — detail`}
        />
        <ReportExportBox
          filename={`my-commission-pipeline-${new Date().toISOString().slice(0, 10)}`}
          label="Export pipeline"
          sheets={[pipelineExportSheet]}
          pdfTitle={`${title} — pipeline`}
        />
      </div>
    </div>
  );
}
