import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { format } from "date-fns";
import {
  listMyCommissionStatement,
  PAYOUT_STATUS_LABELS,
  BENEFICIARY_ROLE_LABELS,
  type PayoutStatus,
} from "@/lib/finance.functions";
import {
  formatPence,
  listMonthOptions,
  listYearOptions,
  monthlyBreakdownForYear,
  periodSummaryTitle,
  summarizeCalendarMonth,
  summarizeCalendarYear,
  summarizePipelineWindow,
  type PeriodSummaryMode,
  type PipelineWindow,
} from "@/lib/commission-summary";
import { Button } from "@/components/ui/button";
import { ReportExportBox } from "@/components/ReportExportBox";
import { ReportTableScroll } from "@/components/ReportTableScroll";
import {
  commissionAnnualBreakdownToSheet,
  commissionPeriodSummaryToSheet,
  commissionPipelineSummaryToSheet,
  commissionRowsToSheet,
} from "@/lib/report-mappers";
import { PoundSterling } from "lucide-react";
import { PayoutStatusBadge } from "@/components/PayoutStatusBadge";

type StatusFilter = "all" | PayoutStatus;

/** Read-only commission statement for advisors, introducers, and RAF referrers. */
export function MyCommissionStatementPanel({
  title = "My commission",
  description = "Commission earned from cases you worked on, introducer referrals, or Refer-a-Friend bonuses.",
}: {
  title?: string;
  description?: string;
}) {
  const listFn = useServerFn(listMyCommissionStatement);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [summaryMode, setSummaryMode] = useState<PeriodSummaryMode>("month");
  const [pipelineWindow, setPipelineWindow] = useState<PipelineWindow>("month");

  const allRowsQ = useQuery({
    queryKey: ["my-commission-all"],
    queryFn: () => listFn({ data: {} }),
  });

  const statementQ = useQuery({
    queryKey: ["my-commission", statusFilter],
    queryFn: () =>
      listFn({
        data: {
          payoutStatus: statusFilter === "all" ? undefined : statusFilter,
        },
      }),
  });

  const allRows = allRowsQ.data?.rows ?? [];
  const monthOptions = useMemo(() => listMonthOptions(allRows), [allRows]);
  const yearOptions = useMemo(() => listYearOptions(allRows), [allRows]);

  const [selectedMonth, setSelectedMonth] = useState("");
  const [selectedYear, setSelectedYear] = useState(() => String(new Date().getFullYear()));

  const activeMonth = selectedMonth || monthOptions[0]?.value || `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
  const activeYear = Number(selectedYear || yearOptions[0] || new Date().getFullYear());
  const [monthYear, monthNum] = activeMonth.split("-").map(Number);

  const periodTotals = useMemo(() => {
    if (summaryMode === "year") return summarizeCalendarYear(allRows, activeYear);
    return summarizeCalendarMonth(allRows, monthYear, monthNum);
  }, [allRows, summaryMode, activeYear, monthYear, monthNum]);

  const annualBreakdown = useMemo(
    () => (summaryMode === "year" ? monthlyBreakdownForYear(allRows, activeYear) : []),
    [allRows, summaryMode, activeYear],
  );

  const pipelineSummary = useMemo(
    () => summarizePipelineWindow(allRows, pipelineWindow),
    [allRows, pipelineWindow],
  );

  const rows = statementQ.data?.rows ?? [];
  const detailExportSheet = commissionRowsToSheet(allRows);
  const periodExportSheet = commissionPeriodSummaryToSheet(periodTotals);
  const pipelineExportSheet = commissionPipelineSummaryToSheet(allRows);
  const annualExportSheet = commissionAnnualBreakdownToSheet(annualBreakdown);

  const summaryPdfSections = useMemo(() => {
    const sections = [
      {
        title: periodSummaryTitle(summaryMode, summaryMode === "year" ? activeYear : monthYear, monthNum),
        headers: periodExportSheet.headers,
        rows: periodExportSheet.rows,
      },
      {
        title: "Pipeline summary",
        headers: pipelineExportSheet.headers,
        rows: pipelineExportSheet.rows,
      },
    ];
    if (summaryMode === "year" && annualBreakdown.length > 0) {
      sections.push({
        title: `${activeYear} monthly breakdown`,
        headers: annualExportSheet.headers,
        rows: annualExportSheet.rows,
      });
    }
    return sections;
  }, [
    activeYear,
    annualBreakdown.length,
    annualExportSheet.headers,
    annualExportSheet.rows,
    monthNum,
    monthYear,
    periodExportSheet.headers,
    periodExportSheet.rows,
    pipelineExportSheet.headers,
    pipelineExportSheet.rows,
    summaryMode,
  ]);

  if (statementQ.data?.migrationRequired || allRowsQ.data?.migrationRequired) {
    return (
      <div className="rounded-2xl border bg-card p-6 text-sm text-muted-foreground">
        Commission tracking is being set up — check back after fees have been posted.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="space-y-4 min-w-0">
      <div>
        <h3 className="font-semibold text-lg flex items-center gap-2">
          <PoundSterling className="w-5 h-5" />
          {title}
        </h3>
        <p className="text-sm text-muted-foreground mt-1">{description}</p>
      </div>

      <div className="rounded-2xl border bg-card p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h4 className="font-medium">Summary</h4>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant={summaryMode === "month" ? "default" : "outline"}
              onClick={() => setSummaryMode("month")}
            >
              Monthly
            </Button>
            <Button
              type="button"
              size="sm"
              variant={summaryMode === "year" ? "default" : "outline"}
              onClick={() => setSummaryMode("year")}
            >
              Annual
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap gap-3 items-center">
          {summaryMode === "month" ? (
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Month
              <select
                className="h-9 rounded-md border bg-background px-3 text-sm min-w-[11rem]"
                value={activeMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
              >
                {monthOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Year
              <select
                className="h-9 rounded-md border bg-background px-3 text-sm min-w-[8rem]"
                value={String(activeYear)}
                onChange={(e) => setSelectedYear(e.target.value)}
              >
                {yearOptions.map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {(["paid", "pending", "received", "rejected", "lost"] as const).map((status) => (
            <div key={status} className="rounded-xl border bg-muted/20 p-3">
              <p className="text-xs text-muted-foreground">{PAYOUT_STATUS_LABELS[status]}</p>
              <p className="text-lg font-semibold mt-1">{formatPence(periodTotals[status].amountPence)}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {periodTotals[status].count} row{periodTotals[status].count === 1 ? "" : "s"}
              </p>
            </div>
          ))}
        </div>

        {summaryMode === "year" && annualBreakdown.length > 0 && (
          <ReportTableScroll visibleRows={6}>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="p-2 font-medium sticky top-0 bg-muted/40">Month</th>
                  <th className="p-2 font-medium text-right sticky top-0 bg-muted/40">Paid</th>
                  <th className="p-2 font-medium text-right sticky top-0 bg-muted/40">Pending</th>
                  <th className="p-2 font-medium text-right sticky top-0 bg-muted/40">Received</th>
                  <th className="p-2 font-medium text-right sticky top-0 bg-muted/40">Rejected</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {annualBreakdown.map((m) => (
                  <tr key={m.label}>
                    <td className="p-2">{m.label}</td>
                    <td className="p-2 text-right">{formatPence(m.totals.paid.amountPence)}</td>
                    <td className="p-2 text-right">{formatPence(m.totals.pending.amountPence)}</td>
                    <td className="p-2 text-right">{formatPence(m.totals.received.amountPence)}</td>
                    <td className="p-2 text-right">{formatPence(m.totals.rejected.amountPence)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ReportTableScroll>
        )}

        <div className="border-t pt-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="font-medium text-sm">Pipeline summary</h4>
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
                  variant={pipelineWindow === value ? "secondary" : "ghost"}
                  onClick={() => setPipelineWindow(value)}
                >
                  {label}
                </Button>
              ))}
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Open commission (pending + received) created in {pipelineSummary.label.toLowerCase()}.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="rounded-xl border bg-muted/20 p-3">
              <p className="text-xs text-muted-foreground">Pending</p>
              <p className="text-lg font-semibold mt-1">{formatPence(pipelineSummary.pendingPence)}</p>
            </div>
            <div className="rounded-xl border bg-muted/20 p-3">
              <p className="text-xs text-muted-foreground">Received</p>
              <p className="text-lg font-semibold mt-1">{formatPence(pipelineSummary.receivedPence)}</p>
            </div>
            <div className="rounded-xl border bg-muted/20 p-3">
              <p className="text-xs text-muted-foreground">Total pipeline</p>
              <p className="text-lg font-semibold mt-1">{formatPence(pipelineSummary.totalPence)}</p>
            </div>
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
            variant={statusFilter === value ? "secondary" : "ghost"}
            onClick={() => setStatusFilter(value)}
          >
            {label}
          </Button>
        ))}
      </div>

      {statusFilter !== "all" && rows.length > 0 && (
        <p className="text-sm text-muted-foreground">
          Total ({PAYOUT_STATUS_LABELS[statusFilter as PayoutStatus]}): £
          {((rows.reduce((sum, r) => sum + r.amountPence, 0)) / 100).toFixed(2)}
        </p>
      )}

      <ReportTableScroll visibleRows={10}>
        {statementQ.isLoading && (
          <div className="p-6 text-sm text-muted-foreground">Loading your commission…</div>
        )}
        {!statementQ.isLoading && rows.length === 0 && (
          <div className="p-6 text-sm text-muted-foreground">
            No commission yet. Rows appear when customer fees are posted on your cases, when you
            refer customers as an introducer, or when a Refer-a-Friend bonus becomes eligible.
          </div>
        )}
        {rows.length > 0 && (
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
              {rows.map((row) => {
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
      </div>

      <div className="flex flex-wrap gap-3 self-start pt-1">
        <ReportExportBox
          filename={`my-commission-detail-${new Date().toISOString().slice(0, 10)}`}
          label="Detail"
          sheets={[detailExportSheet]}
          pdfTitle={`${title} — detail`}
        />
        <ReportExportBox
          filename={`my-commission-summary-${summaryMode === "year" ? activeYear : activeMonth}`}
          label="Summary"
          sheets={
            summaryMode === "year"
              ? [periodExportSheet, annualExportSheet, pipelineExportSheet]
              : [periodExportSheet, pipelineExportSheet]
          }
          pdfTitle={`${title} — summary`}
          pdfSections={summaryPdfSections}
        />
        <ReportExportBox
          filename={`my-commission-pipeline-${new Date().toISOString().slice(0, 10)}`}
          label="Pipeline"
          sheets={[pipelineExportSheet]}
          pdfTitle={`${title} — pipeline`}
        />
      </div>
    </div>
  );
}
