import { PAYOUT_STATUS_LABELS, type PayoutStatus } from "@/lib/finance.functions";

const STATUS_STYLES: Record<PayoutStatus, string> = {
  received: "bg-sky-100 text-sky-900 dark:bg-sky-950/50 dark:text-sky-200",
  paid: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-200",
  rejected: "bg-red-100 text-red-900 dark:bg-red-950/50 dark:text-red-200",
};

export function PayoutStatusBadge({ status }: { status: PayoutStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[status]}`}
    >
      {PAYOUT_STATUS_LABELS[status]}
    </span>
  );
}

export function commissionPipelineTotals(rows: { payoutStatus: PayoutStatus; amountPence: number }[]) {
  const totals: Record<PayoutStatus, number> = {
    received: 0,
    paid: 0,
    rejected: 0,
  };
  for (const r of rows) {
    totals[r.payoutStatus] = (totals[r.payoutStatus] ?? 0) + r.amountPence;
  }
  return totals;
}
