import { format } from "date-fns";
import {
  BENEFICIARY_ROLE_LABELS,
  FEE_TYPE_LABELS,
  PAYOUT_STATUS_LABELS,
  type CommissionPayoutRow,
} from "@/lib/finance.functions";
import type { ExportSheet, OwnerCustomerExportRow } from "@/lib/report-export.types";
import { penceToGbp } from "@/lib/report-export.types";

export type { OwnerCustomerExportRow };

type LedgerRow = {
  created_at: string;
  kind: string;
  fee_type?: string | null;
  amount_pence: number;
  note?: string | null;
  beneficiary_role?: string | null;
  commission_pct?: number | null;
  is_reversal?: boolean | null;
};

export function ledgerRowsToSheet(rows: LedgerRow[]): ExportSheet {
  return {
    name: "Finance ledger",
    headers: ["When", "Kind", "Fee type", "Amount (£)", "Beneficiary", "Commission %", "Note"],
    rows: rows.map((r) => [
      format(new Date(r.created_at), "yyyy-MM-dd HH:mm"),
      r.kind,
      r.fee_type ?? "",
      penceToGbp(r.amount_pence),
      r.beneficiary_role ?? "",
      r.commission_pct != null ? String(r.commission_pct) : "",
      r.note ?? "",
    ]),
  };
}

export function commissionRowsToSheet(rows: CommissionPayoutRow[]): ExportSheet {
  return {
    name: "Commission",
    headers: [
      "When",
      "Role",
      "Payee",
      "Case",
      "Fee type",
      "Commission %",
      "Amount (£)",
      "Status",
      "Paid / updated",
    ],
    rows: rows.map((r) => [
      format(new Date(r.createdAt), "yyyy-MM-dd"),
      BENEFICIARY_ROLE_LABELS[r.beneficiaryRole] ?? r.beneficiaryRole,
      r.beneficiaryName,
      r.caseRef ?? (r.sessionId ? "Case (no ref)" : ""),
      r.feeType ?? "",
      r.commissionPct != null ? String(r.commissionPct) : "",
      penceToGbp(r.amountPence),
      PAYOUT_STATUS_LABELS[r.payoutStatus],
      r.payoutAt ? format(new Date(r.payoutAt), "yyyy-MM-dd") : "",
    ]),
  };
}

export function customerReportToSheet(rows: OwnerCustomerExportRow[]): ExportSheet {
  return {
    name: "Customers",
    headers: [
      "Name",
      "Email",
      "Phone",
      "Address",
      "Introducer",
      "Case refs",
      "Cases",
      "Fact-finds",
      "Latest status",
      "Advisors",
      "Fees posted (£)",
      "Advisor commission (£)",
      "Introducer commission (£)",
      "Pending commission (£)",
      "Paid commission (£)",
    ],
    rows: rows.map((r) => [
      r.fullName,
      r.email,
      r.phone,
      r.address,
      r.introducer,
      r.caseRefs,
      r.caseCount,
      r.factFindCount,
      r.latestStatus,
      r.assignedAdvisors,
      r.totalFeesGbp,
      r.advisorCommissionGbp,
      r.introducerCommissionGbp,
      r.pendingCommissionGbp,
      r.paidCommissionGbp,
    ]),
  };
}

export function rateHistoryToSheet(
  rows: Array<{ created_at: string; fee_type: string; pct_from: number | null; pct_to: number }>,
): ExportSheet {
  return {
    name: "Rate history",
    headers: ["When", "Fee type", "From %", "To %"],
    rows: rows.map((h) => [
      format(new Date(h.created_at), "yyyy-MM-dd HH:mm"),
      FEE_TYPE_LABELS[h.fee_type as keyof typeof FEE_TYPE_LABELS] ?? h.fee_type,
      h.pct_from != null ? String(h.pct_from) : "new",
      String(h.pct_to),
    ]),
  };
}
