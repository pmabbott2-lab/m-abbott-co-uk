import {
  endOfMonth,
  endOfYear,
  format,
  isWithinInterval,
  parseISO,
  startOfMonth,
  startOfYear,
  subMonths,
} from "date-fns";
import {
  PAYOUT_STATUS_LABELS,
  type CommissionPayoutRow,
  type PayoutStatus,
} from "@/lib/finance.functions";

export type StatusAmounts = Record<PayoutStatus, { count: number; amountPence: number }>;

export type PipelineWindow = "month" | "ytd" | "l12m";

export type PeriodSummaryMode = "month" | "year";

const ALL_STATUSES: PayoutStatus[] = ["received", "paid", "rejected"];

export function emptyStatusAmounts(): StatusAmounts {
  return {
    received: { count: 0, amountPence: 0 },
    paid: { count: 0, amountPence: 0 },
    rejected: { count: 0, amountPence: 0 },
  };
}

function addToTotals(totals: StatusAmounts, status: PayoutStatus, amountPence: number) {
  totals[status].count += 1;
  totals[status].amountPence += amountPence;
}

function inRange(date: Date, start: Date, end: Date): boolean {
  return isWithinInterval(date, { start, end });
}

/** Date used for paid / rejected activity in period reports. */
export function payoutActivityDate(row: CommissionPayoutRow): Date {
  if (row.payoutAt && (row.payoutStatus === "paid" || row.payoutStatus === "rejected")) {
    return parseISO(row.payoutAt);
  }
  return parseISO(row.createdAt);
}

export function filterRowsByCaseQuery(rows: CommissionPayoutRow[], query: string): CommissionPayoutRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((row) => {
    if (row.caseRef?.toLowerCase().includes(q)) return true;
    if (row.sessionId?.toLowerCase().includes(q)) return true;
    return false;
  });
}

/** Monthly activity: paid/rejected by payout date; received by created date. */
export function summarizeCalendarMonth(
  rows: CommissionPayoutRow[],
  year: number,
  month: number,
): StatusAmounts {
  const start = startOfMonth(new Date(year, month - 1, 1));
  const end = endOfMonth(start);
  const totals = emptyStatusAmounts();

  for (const row of rows) {
    const created = parseISO(row.createdAt);
    if (row.payoutStatus === "paid" || row.payoutStatus === "rejected") {
      const activity = payoutActivityDate(row);
      if (inRange(activity, start, end)) addToTotals(totals, row.payoutStatus, row.amountPence);
      continue;
    }
    if (row.payoutStatus === "received" && inRange(created, start, end)) {
      addToTotals(totals, row.payoutStatus, row.amountPence);
    }
  }

  return totals;
}

export function summarizeCalendarYear(rows: CommissionPayoutRow[], year: number): StatusAmounts {
  const start = startOfYear(new Date(year, 0, 1));
  const end = endOfYear(start);
  const totals = emptyStatusAmounts();

  for (const row of rows) {
    const created = parseISO(row.createdAt);
    if (row.payoutStatus === "paid" || row.payoutStatus === "rejected") {
      const activity = payoutActivityDate(row);
      if (inRange(activity, start, end)) addToTotals(totals, row.payoutStatus, row.amountPence);
      continue;
    }
    if (row.payoutStatus === "received" && inRange(created, start, end)) {
      addToTotals(totals, row.payoutStatus, row.amountPence);
    }
  }

  return totals;
}

export type MonthlyBreakdownRow = {
  year: number;
  month: number;
  label: string;
  totals: StatusAmounts;
};

export function monthlyBreakdownForYear(rows: CommissionPayoutRow[], year: number): MonthlyBreakdownRow[] {
  return Array.from({ length: 12 }, (_, i) => {
    const month = i + 1;
    const label = format(new Date(year, i, 1), "MMMM yyyy");
    return {
      year,
      month,
      label,
      totals: summarizeCalendarMonth(rows, year, month),
    };
  });
}

export function pipelineWindowRange(window: PipelineWindow, anchor = new Date()): { start: Date; end: Date; label: string } {
  if (window === "month") {
    const start = startOfMonth(anchor);
    return { start, end: endOfMonth(anchor), label: format(anchor, "MMMM yyyy") };
  }
  if (window === "ytd") {
    const start = startOfYear(anchor);
    return { start, end: anchor, label: `${format(anchor, "yyyy")} YTD` };
  }
  const start = startOfMonth(subMonths(anchor, 11));
  return { start, end: anchor, label: "Last 12 months" };
}

/** Open pipeline (received, not yet paid/rejected) by when commission was created. */
export function summarizePipelineWindow(
  rows: CommissionPayoutRow[],
  window: PipelineWindow,
  anchor = new Date(),
): { label: string; receivedPence: number; totalPence: number; count: number } {
  const { start, end, label } = pipelineWindowRange(window, anchor);
  let receivedPence = 0;
  let count = 0;

  for (const row of rows) {
    if (row.payoutStatus !== "received") continue;
    const created = parseISO(row.createdAt);
    if (!inRange(created, start, end)) continue;
    count += 1;
    receivedPence += row.amountPence;
  }

  return { label, receivedPence, totalPence: receivedPence, count };
}

export function listMonthOptions(rows: CommissionPayoutRow[], anchor = new Date()): { value: string; label: string; year: number; month: number }[] {
  const seen = new Set<string>();
  const options: { value: string; label: string; year: number; month: number }[] = [];

  const add = (year: number, month: number) => {
    const value = `${year}-${String(month).padStart(2, "0")}`;
    if (seen.has(value)) return;
    seen.add(value);
    options.push({
      value,
      label: format(new Date(year, month - 1, 1), "MMMM yyyy"),
      year,
      month,
    });
  };

  for (const row of rows) {
    const d = parseISO(row.createdAt);
    add(d.getFullYear(), d.getMonth() + 1);
    if (row.payoutAt) {
      const p = parseISO(row.payoutAt);
      add(p.getFullYear(), p.getMonth() + 1);
    }
  }

  add(anchor.getFullYear(), anchor.getMonth() + 1);

  return options.sort((a, b) => b.value.localeCompare(a.value));
}

export function listYearOptions(rows: CommissionPayoutRow[], anchor = new Date()): number[] {
  const years = new Set<number>([anchor.getFullYear()]);
  for (const row of rows) {
    years.add(parseISO(row.createdAt).getFullYear());
    if (row.payoutAt) years.add(parseISO(row.payoutAt).getFullYear());
  }
  return Array.from(years).sort((a, b) => b - a);
}

export function formatPence(pence: number): string {
  return `£${(pence / 100).toFixed(2)}`;
}

export function statusAmountsToRows(totals: StatusAmounts): { status: PayoutStatus; count: number; amount: string }[] {
  return ALL_STATUSES.map((status) => ({
    status,
    count: totals[status].count,
    amount: formatPence(totals[status].amountPence),
  }));
}

export function periodSummaryTitle(mode: PeriodSummaryMode, year: number, month?: number): string {
  if (mode === "year") return `Commission summary ${year}`;
  return `Commission summary ${format(new Date(year, (month ?? 1) - 1, 1), "MMMM yyyy")}`;
}

export function statusLabel(status: PayoutStatus): string {
  return PAYOUT_STATUS_LABELS[status];
}

export { ALL_STATUSES };
