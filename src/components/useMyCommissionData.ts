import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { listMyCommissionStatement, type PayoutStatus } from "@/lib/finance.functions";
import {
  listMonthOptions,
  listYearOptions,
  monthlyBreakdownForYear,
  summarizeCalendarMonth,
  summarizeCalendarYear,
  summarizePipelineWindow,
  type PeriodSummaryMode,
  type PipelineWindow,
} from "@/lib/commission-summary";

export type CommissionStatusFilter = "all" | PayoutStatus;

export function useMyCommissionData(viewAsUserId?: string) {
  const listFn = useServerFn(listMyCommissionStatement);
  const viewAsPayload = viewAsUserId ? { viewAsUserId } : {};
  const [statusFilter, setStatusFilter] = useState<CommissionStatusFilter>("all");
  const [summaryMode, setSummaryMode] = useState<PeriodSummaryMode>("month");
  const [pipelineWindow, setPipelineWindow] = useState<PipelineWindow>("month");

  const allRowsQ = useQuery({
    queryKey: ["my-commission-all", viewAsUserId ?? "self"],
    queryFn: () => listFn({ data: viewAsPayload }),
  });

  const statementQ = useQuery({
    queryKey: ["my-commission", statusFilter, viewAsUserId ?? "self"],
    queryFn: () =>
      listFn({
        data: {
          payoutStatus: statusFilter === "all" ? undefined : statusFilter,
          ...viewAsPayload,
        },
      }),
  });

  const allRows = allRowsQ.data?.rows ?? [];
  const rows = statementQ.data?.rows ?? [];
  const monthOptions = useMemo(() => listMonthOptions(allRows), [allRows]);
  const yearOptions = useMemo(() => listYearOptions(allRows), [allRows]);

  const [selectedMonth, setSelectedMonth] = useState("");
  const [selectedYear, setSelectedYear] = useState(() => String(new Date().getFullYear()));

  const activeMonth =
    selectedMonth ||
    monthOptions[0]?.value ||
    `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
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

  const migrationRequired =
    Boolean(statementQ.data?.migrationRequired) || Boolean(allRowsQ.data?.migrationRequired);
  const isLoading = statementQ.isLoading || allRowsQ.isLoading;

  return {
    allRows,
    rows,
    monthOptions,
    yearOptions,
    activeMonth,
    activeYear,
    monthYear,
    monthNum,
    periodTotals,
    annualBreakdown,
    pipelineSummary,
    statusFilter,
    setStatusFilter,
    summaryMode,
    setSummaryMode,
    pipelineWindow,
    setPipelineWindow,
    setSelectedMonth,
    setSelectedYear,
    migrationRequired,
    isLoading,
  };
}
