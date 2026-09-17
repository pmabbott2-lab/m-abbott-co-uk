import { useMemo } from "react";
import {
  formatPence,
  periodSummaryTitle,
  type PeriodSummaryMode,
} from "@/lib/commission-summary";
import { PAYOUT_STATUS_LABELS } from "@/lib/finance.functions";
import { Button } from "@/components/ui/button";
import { ReportExportBox } from "@/components/ReportExportBox";
import { ReportTableScroll } from "@/components/ReportTableScroll";
import {
  commissionAnnualBreakdownToSheet,
  commissionPeriodSummaryToSheet,
} from "@/lib/report-mappers";
import { useMyCommissionData } from "@/components/useMyCommissionData";

type MyCommissionSummaryPanelProps = {
  title?: string;
  viewAsUserId?: string;
};

export function MyCommissionSummaryPanel({
  title = "My commission",
  viewAsUserId,
}: MyCommissionSummaryPanelProps) {
  const data = useMyCommissionData(viewAsUserId);

  const periodExportSheet = commissionPeriodSummaryToSheet(data.periodTotals);
  const annualExportSheet = commissionAnnualBreakdownToSheet(data.annualBreakdown);

  const summaryPdfSections = useMemo(() => {
    const sections = [
      {
        title: periodSummaryTitle(
          data.summaryMode,
          data.summaryMode === "year" ? data.activeYear : data.monthYear,
          data.monthNum,
        ),
        headers: periodExportSheet.headers,
        rows: periodExportSheet.rows,
      },
    ];
    if (data.summaryMode === "year" && data.annualBreakdown.length > 0) {
      sections.push({
        title: `${data.activeYear} monthly breakdown`,
        headers: annualExportSheet.headers,
        rows: annualExportSheet.rows,
      });
    }
    return sections;
  }, [
    data.activeYear,
    data.annualBreakdown.length,
    data.monthNum,
    data.monthYear,
    data.summaryMode,
    annualExportSheet.headers,
    annualExportSheet.rows,
    periodExportSheet.headers,
    periodExportSheet.rows,
  ]);

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
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h4 className="font-medium">Monthly / annual summary</h4>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant={data.summaryMode === "month" ? "default" : "outline"}
              onClick={() => data.setSummaryMode("month")}
            >
              Monthly
            </Button>
            <Button
              type="button"
              size="sm"
              variant={data.summaryMode === "year" ? "default" : "outline"}
              onClick={() => data.setSummaryMode("year")}
            >
              Annual
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap gap-3 items-center">
          {data.summaryMode === "month" ? (
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Month
              <select
                className="h-9 rounded-md border bg-background px-3 text-sm min-w-[11rem]"
                value={data.activeMonth}
                onChange={(e) => data.setSelectedMonth(e.target.value)}
              >
                {data.monthOptions.map((opt) => (
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
                value={String(data.activeYear)}
                onChange={(e) => data.setSelectedYear(e.target.value)}
              >
                {data.yearOptions.map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {(["paid", "received", "rejected"] as const).map((status) => (
            <div key={status} className="rounded-xl border bg-muted/20 p-3">
              <p className="text-xs text-muted-foreground">{PAYOUT_STATUS_LABELS[status]}</p>
              <p className="text-lg font-semibold mt-1">
                {formatPence(data.periodTotals[status].amountPence)}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {data.periodTotals[status].count} row{data.periodTotals[status].count === 1 ? "" : "s"}
              </p>
            </div>
          ))}
        </div>

        {data.summaryMode === "year" && data.annualBreakdown.length > 0 && (
          <ReportTableScroll visibleRows={6}>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="p-2 font-medium sticky top-0 bg-muted/40">Month</th>
                  <th className="p-2 font-medium text-right sticky top-0 bg-muted/40">Paid</th>
                  <th className="p-2 font-medium text-right sticky top-0 bg-muted/40">Received</th>
                  <th className="p-2 font-medium text-right sticky top-0 bg-muted/40">Rejected</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {data.annualBreakdown.map((m) => (
                  <tr key={m.label}>
                    <td className="p-2">{m.label}</td>
                    <td className="p-2 text-right">{formatPence(m.totals.paid.amountPence)}</td>
                    <td className="p-2 text-right">{formatPence(m.totals.received.amountPence)}</td>
                    <td className="p-2 text-right">{formatPence(m.totals.rejected.amountPence)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ReportTableScroll>
        )}
      </div>

      <ReportExportBox
        filename={`my-commission-summary-${data.summaryMode === "year" ? data.activeYear : data.activeMonth}`}
        label="Export summary"
        sheets={
          data.summaryMode === "year"
            ? [periodExportSheet, annualExportSheet]
            : [periodExportSheet]
        }
        pdfTitle={`${title} — summary`}
        pdfSections={summaryPdfSections}
      />
    </div>
  );
}
