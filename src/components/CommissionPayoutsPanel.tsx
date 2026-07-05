import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { format } from "date-fns";
import {
  listCommissionPayouts,
  updateCommissionPayoutStatus,
  PAYOUT_STATUS_LABELS,
  BENEFICIARY_ROLE_LABELS,
  type PayoutStatus,
  type CommissionPayoutRow,
} from "@/lib/finance.functions";
import { Button } from "@/components/ui/button";
import { ReportExportBox } from "@/components/ReportExportBox";
import { ReportTableScroll } from "@/components/ReportTableScroll";
import { commissionRowsToSheet } from "@/lib/report-mappers";
import { PoundSterling } from "lucide-react";
import { toast } from "sonner";

type RoleFilter = "all" | "advisor" | "introducer" | "referrer";
type StatusFilter = "all" | PayoutStatus;

export function CommissionPayoutsPanel({ canAmend }: { canAmend: boolean }) {
  const qc = useQueryClient();
  const listFn = useServerFn(listCommissionPayouts);
  const updateFn = useServerFn(updateCommissionPayoutStatus);

  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("pending");

  const queryKey = ["commission-payouts", roleFilter, statusFilter];
  const payoutsQ = useQuery({
    queryKey,
    queryFn: () =>
      listFn({
        data: {
          beneficiaryRole: roleFilter === "all" ? undefined : roleFilter,
          payoutStatus: statusFilter === "all" ? undefined : statusFilter,
        },
      }),
  });

  const allExportQ = useQuery({
    queryKey: ["commission-export-all"],
    queryFn: () => listFn({ data: {} }),
  });

  const update = useMutation({
    mutationFn: (vars: { ledgerId: string; payoutStatus: PayoutStatus }) =>
      updateFn({ data: vars }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["commission-payouts"] });
      qc.invalidateQueries({ queryKey: ["commission-export-all"] });
      toast.success("Payout status updated");
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not update"),
  });

  const rows = payoutsQ.data?.rows ?? [];
  const exportSheet = commissionRowsToSheet(allExportQ.data?.rows ?? []);
  const totals = rows.reduce(
    (acc, r) => {
      acc[r.payoutStatus] = (acc[r.payoutStatus] ?? 0) + r.amountPence;
      return acc;
    },
    {} as Record<string, number>,
  );

  if (payoutsQ.data?.migrationRequired) {
    return (
      <div className="rounded-2xl border bg-card p-6 text-sm text-muted-foreground">
        Run <code className="text-xs">supabase/RUN_COMMISSION_PAYOUTS.sql</code> in Supabase to enable
        commission payout tracking.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="space-y-4 min-w-0">
      <div>
        <h3 className="font-semibold text-lg flex items-center gap-2">
          <PoundSterling className="w-5 h-5" />
          Commission mgmt
        </h3>
        <p className="text-sm text-muted-foreground mt-1">
          Commission from posted customer fees (advisor &amp; introducer %) and Refer-a-Friend bonuses.
          Customers generate their own RAF links from the portal — payouts are managed here.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {(
          [
            ["all", "All"],
            ["advisor", "Advisors"],
            ["introducer", "Introducers"],
            ["referrer", "Refer a friend"],
          ] as const
        ).map(([value, label]) => (
          <Button
            key={value}
            type="button"
            size="sm"
            variant={roleFilter === value ? "default" : "outline"}
            onClick={() => setRoleFilter(value)}
          >
            {label}
          </Button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        {(
          [
            ["all", "All statuses"],
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

      <ReportTableScroll visibleRows={10}>
        {payoutsQ.isLoading && (
          <div className="p-6 text-sm text-muted-foreground">Loading commission…</div>
        )}
        {!payoutsQ.isLoading && rows.length === 0 && (
          <div className="p-6 text-sm text-muted-foreground">
            No commission rows match these filters. Commission is created when customer fees are posted,
            or when a RAF bonus is marked eligible.
          </div>
        )}
        {rows.length > 0 && (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="p-3 font-medium sticky top-0 bg-muted/40">When</th>
                <th className="p-3 font-medium sticky top-0 bg-muted/40">Type</th>
                <th className="p-3 font-medium sticky top-0 bg-muted/40">Payee</th>
                <th className="p-3 font-medium sticky top-0 bg-muted/40">Case / context</th>
                <th className="p-3 font-medium text-right sticky top-0 bg-muted/40">Amount</th>
                <th className="p-3 font-medium sticky top-0 bg-muted/40">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((row) => (
                <PayoutRow
                  key={row.id}
                  row={row}
                  canAmend={canAmend}
                  pending={update.isPending && update.variables?.ledgerId === row.id}
                  onStatusChange={(payoutStatus) => update.mutate({ ledgerId: row.id, payoutStatus })}
                />
              ))}
            </tbody>
          </table>
        )}
      </ReportTableScroll>
      </div>
      <div className="self-start pt-1">
        <ReportExportBox
          filename={`commission-all-${new Date().toISOString().slice(0, 10)}`}
          label="Reports"
          sheets={[exportSheet]}
          pdfTitle="All commission"
        />
      </div>
    </div>
  );
}

function PayoutRow({
  row,
  canAmend,
  pending,
  onStatusChange,
}: {
  row: CommissionPayoutRow;
  canAmend: boolean;
  pending: boolean;
  onStatusChange: (status: PayoutStatus) => void;
}) {
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

  return (
    <tr className={row.payoutStatus === "rejected" ? "opacity-60" : undefined}>
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
      <td className="p-3 font-medium">{row.beneficiaryName}</td>
      <td className="p-3 text-muted-foreground">{context}</td>
      <td className="p-3 text-right font-medium whitespace-nowrap">
        £{(row.amountPence / 100).toFixed(2)}
      </td>
      <td className="p-3">
        {canAmend ? (
          <select
            className="h-8 rounded-md border bg-background px-2 text-xs"
            value={row.payoutStatus}
            disabled={pending}
            onChange={(e) => onStatusChange(e.target.value as PayoutStatus)}
            aria-label="Payout status"
          >
            {(["pending", "paid", "rejected"] as const).map((s) => (
              <option key={s} value={s}>
                {PAYOUT_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        ) : (
          <span className="text-xs font-medium">{PAYOUT_STATUS_LABELS[row.payoutStatus]}</span>
        )}
      </td>
    </tr>
  );
}
