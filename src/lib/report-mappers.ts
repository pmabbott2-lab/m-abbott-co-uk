import { safeFormat } from "@/lib/safe-format";
import {
  BENEFICIARY_ROLE_LABELS,
  FEE_TYPE_LABELS,
  PAYOUT_STATUS_LABELS,
  type CommissionPayoutRow,
} from "@/lib/finance.functions";
import type {
  MonthlyBreakdownRow,
  PipelineWindow,
  StatusAmounts,
} from "@/lib/commission-summary";
import {
  statusLabel,
  summarizePipelineWindow,
} from "@/lib/commission-summary";
import type { ContactHistoryEntry } from "@/lib/sessions.functions";
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
  customerName?: string | null;
  caseRef?: string | null;
  receiverName?: string | null;
  receiverRef?: string | null;
};

export function ledgerRowsToSheet(rows: LedgerRow[]): ExportSheet {
  return {
    name: "Finance ledger",
    headers: [
      "When",
      "Kind",
      "Customer",
      "Case ref",
      "Fee type",
      "Amount (£)",
      "Receiver",
      "Ref",
      "Commission %",
      "Note",
    ],
    rows: rows.map((r) => [
      safeFormat(r.created_at, "yyyy-MM-dd HH:mm"),
      r.kind,
      r.customerName ?? "",
      r.caseRef ?? "",
      r.fee_type ?? "",
      penceToGbp(r.amount_pence),
      r.kind === "commission" ? r.receiverName ?? "" : "",
      r.kind === "commission" ? r.receiverRef ?? "" : "",
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
      safeFormat(r.createdAt, "yyyy-MM-dd"),
      BENEFICIARY_ROLE_LABELS[r.beneficiaryRole] ?? r.beneficiaryRole,
      r.beneficiaryName,
      r.caseRef ?? (r.sessionId ? "Case (no ref)" : ""),
      r.feeType ?? "",
      r.commissionPct != null ? String(r.commissionPct) : "",
      penceToGbp(r.amountPence),
      PAYOUT_STATUS_LABELS[r.payoutStatus],
      r.payoutAt ? safeFormat(r.payoutAt, "yyyy-MM-dd") : "",
    ]),
  };
}

export function commissionPeriodSummaryToSheet(
  totals: StatusAmounts,
): ExportSheet {
  return {
    name: "Period summary",
    headers: ["Status", "Count", "Amount (£)"],
    rows: (["received", "paid", "rejected"] as const).map((status) => [
      statusLabel(status),
      totals[status].count,
      penceToGbp(totals[status].amountPence),
    ]),
  };
}

export function commissionAnnualBreakdownToSheet(rows: MonthlyBreakdownRow[]): ExportSheet {
  return {
    name: "Monthly breakdown",
    headers: ["Month", "Received (£)", "Paid (£)", "Rejected (£)"],
    rows: rows.map((m) => [
      m.label,
      penceToGbp(m.totals.received.amountPence),
      penceToGbp(m.totals.paid.amountPence),
      penceToGbp(m.totals.rejected.amountPence),
    ]),
  };
}

export function commissionPipelineSummaryToSheet(
  rows: CommissionPayoutRow[],
  windows: PipelineWindow[] = ["month", "ytd", "l12m"],
): ExportSheet {
  return {
    name: "Pipeline summary",
    headers: ["Period", "Received (£)", "Total pipeline (£)", "Rows"],
    rows: windows.map((window) => {
      const summary = summarizePipelineWindow(rows, window);
      return [
        summary.label,
        penceToGbp(summary.receivedPence),
        penceToGbp(summary.totalPence),
        summary.count,
      ];
    }),
  };
}

export function commissionCaseSearchToSheet(rows: CommissionPayoutRow[], caseQuery: string): ExportSheet {
  const sheet = commissionRowsToSheet(rows);
  sheet.name = caseQuery.trim() ? `Case ${caseQuery.trim()}` : sheet.name;
  return sheet;
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
      "Received commission (£)",
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
  rows: Array<{
    created_at: string;
    fee_type: string;
    pct_from: number | null;
    pct_to: number;
    role?: string | null;
    user_name?: string | null;
  }>,
): ExportSheet {
  return {
    name: "Rate history",
    headers: ["When", "Name", "Role", "Fee type", "From %", "To %"],
    rows: rows.map((h) => [
      safeFormat(h.created_at, "yyyy-MM-dd HH:mm"),
      h.user_name ?? "",
      h.role ?? "",
      FEE_TYPE_LABELS[h.fee_type as keyof typeof FEE_TYPE_LABELS] ?? h.fee_type,
      h.pct_from != null ? String(h.pct_from) : "new",
      String(h.pct_to),
    ]),
  };
}

export function financeAuditToSheet(
  rows: Array<{ created_at: string; audit_type: string; summary: string; role?: string | null; fee_type?: string | null }>,
): ExportSheet {
  return {
    name: "Finance audit",
    headers: ["When", "Type", "Summary", "Role", "Fee type"],
    rows: rows.map((r) => [
      safeFormat(r.created_at, "yyyy-MM-dd HH:mm"),
      r.audit_type,
      r.summary,
      r.role ?? "",
      r.fee_type ?? "",
    ]),
  };
}

export function viewAsAuditToSheet(
  rows: Array<{ created_at: string; action: string; summary: string; view_type: string }>,
): ExportSheet {
  return {
    name: "View-as audit",
    headers: ["When", "View", "Action", "Summary"],
    rows: rows.map((r) => [
      safeFormat(r.created_at, "yyyy-MM-dd HH:mm"),
      r.view_type,
      r.action,
      r.summary,
    ]),
  };
}

export function introducerReferralsToSheet(
  rows: Array<{
    customerName: string;
    customerPhone?: string | null;
    customerEmail?: string | null;
    journeyStage: string;
    leadSource: string;
    advisorName?: string | null;
    daysAtStage: number | string;
    lastContactDate?: string | null;
  }>,
): ExportSheet {
  return {
    name: "Referrals",
    headers: [
      "Customer",
      "Phone",
      "Email",
      "Stage",
      "Lead source",
      "Advisor",
      "Days at stage",
      "Last contact",
    ],
    rows: rows.map((r) => [
      r.customerName || "",
      r.customerPhone ?? "",
      r.customerEmail ?? "",
      r.journeyStage,
      r.leadSource,
      r.advisorName ?? "",
      String(r.daysAtStage),
      r.lastContactDate ? safeFormat(r.lastContactDate, "yyyy-MM-dd") : "",
    ]),
  };
}

const CONTACT_HISTORY_TYPE_LABELS: Record<string, string> = {
  contact: "Contacted",
  note: "Note added",
  next_contact_set: "Next contact updated",
  history_amend: "History amended",
  finance: "Finance",
  appointment: "Appointment",
  callback: "Call-back",
  phone_call: "Phone call",
  sms: "SMS",
  fact_find: "Fact-find",
  journey_milestone: "Journey",
};

export function contactHistoryToSheet(
  entries: ContactHistoryEntry[],
  typeLabels: Record<string, string> = CONTACT_HISTORY_TYPE_LABELS,
): ExportSheet {
  return {
    name: "History",
    headers: ["When", "Type", "Entry"],
    rows: entries.map((e) => [
      safeFormat(e.occurredAt, "yyyy-MM-dd HH:mm"),
      typeLabels[e.type] ?? e.type,
      [
        e.body ?? "",
        e.deleted ? "(deleted)" : e.amended ? "(amended)" : "",
      ]
        .filter(Boolean)
        .join(" "),
    ]),
  };
}
