import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { format } from "date-fns";
import {
  listMyCommissionStatement,
  PAYOUT_STATUS_LABELS,
  BENEFICIARY_ROLE_LABELS,
  type PayoutStatus,
} from "@/lib/finance.functions";
import { Button } from "@/components/ui/button";
import { ResponsiveTableWrap } from "@/components/ResponsiveTableWrap";
import { PoundSterling } from "lucide-react";

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

  const statementQ = useQuery({
    queryKey: ["my-commission", statusFilter],
    queryFn: () =>
      listFn({
        data: {
          payoutStatus: statusFilter === "all" ? undefined : statusFilter,
        },
      }),
  });

  const rows = statementQ.data?.rows ?? [];
  const totals = rows.reduce(
    (acc, r) => {
      acc[r.payoutStatus] = (acc[r.payoutStatus] ?? 0) + r.amountPence;
      return acc;
    },
    {} as Record<string, number>,
  );

  if (statementQ.data?.migrationRequired) {
    return (
      <div className="rounded-2xl border bg-card p-6 text-sm text-muted-foreground">
        Commission tracking is being set up — check back after fees have been posted.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-semibold text-lg flex items-center gap-2">
          <PoundSterling className="w-5 h-5" />
          {title}
        </h3>
        <p className="text-sm text-muted-foreground mt-1">{description}</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {(
          [
            ["all", "All"],
            ["pending", "Pending"],
            ["paid", "Paid"],
            ["rejected", "Rejected"],
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
          {((totals[statusFilter] ?? 0) / 100).toFixed(2)}
        </p>
      )}

      <ResponsiveTableWrap>
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
                <th className="p-3 font-medium">When</th>
                <th className="p-3 font-medium">Type</th>
                <th className="p-3 font-medium">Case / context</th>
                <th className="p-3 font-medium text-right">Amount</th>
                <th className="p-3 font-medium">Status</th>
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
                    <td className="p-3 text-xs font-medium">
                      {PAYOUT_STATUS_LABELS[row.payoutStatus]}
                      {statusDate && (
                        <span className="block text-muted-foreground font-normal capitalize">
                          {row.payoutStatus} {statusDate}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </ResponsiveTableWrap>
    </div>
  );
}
