import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  canAmend,
  canView,
  canViewFinanceReport,
  canViewCommissionPayouts,
  canAmendCommissionPayouts,
  type AdminAccess,
} from "@/lib/admin-access";
import {
  TenantContextError,
  assertRowBelongsToTenant,
  requireTenantMembership,
} from "@/lib/tenant-assert.server";
import {
  COMMISSION_FEE_TYPES,
  feeTypesForSubject,
  findTenantRateSubject,
  rateMutationErrorMessage,
  rateSubjectArgs,
  resolveCommissionRateAsOf,
  type CommissionFeeType,
  type CommissionRateSubject,
} from "@/lib/commission-rates.server";

const FEE_TYPES = COMMISSION_FEE_TYPES;

type UntypedAdmin =
  (typeof import("@/integrations/supabase/client.server"))["supabaseAdminUntyped"];

export const RAF_BONUS_NOT_CONFIGURED_MESSAGE =
  "The Refer a Friend bonus amount is not configured for this company.";

type FinanceActing = { tenantId: string; access: AdminAccess };

/**
 * Finance acts in one verified tenant (membership-verified route slug, else the sole membership)
 * as a member of that tenant. Platform entry carries no finance authority.
 */
async function actingFinanceTenant(userId: string): Promise<FinanceActing | null> {
  const { resolveActingTenantRole } = await import("@/lib/tenant-role.server");
  const view = await resolveActingTenantRole(userId);
  if (!view.tenantId || !view.member || view.accessContext !== "membership") return null;
  return { tenantId: view.tenantId, access: view.adminAccess };
}

async function resolveFinanceTenant(userId: string): Promise<FinanceActing> {
  const acting = await actingFinanceTenant(userId);
  if (!acting) {
    throw new TenantContextError("TENANT_DATA_ACCESS_DENIED", "Tenant access denied.");
  }
  return acting;
}

function isMissingTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const code = error.code ?? "";
  const msg = (error.message ?? "").toLowerCase();
  return (
    code === "42P01" ||
    code === "42703" ||
    code === "PGRST204" ||
    code === "PGRST205" ||
    msg.includes("does not exist") ||
    msg.includes("schema cache")
  );
}

export const FEE_TYPE_LABELS: Record<(typeof FEE_TYPES)[number], string> = {
  fee: "Fee",
  mortgage_fee: "Mortgage fee",
  insurance_fee: "Insurance fee",
  other_fee: "Other fee",
};

export const PAYOUT_STATUSES = ["received", "paid", "rejected", "reversed"] as const;
export type PayoutStatus = (typeof PAYOUT_STATUSES)[number];

export const PAYOUT_STATUS_LABELS: Record<PayoutStatus, string> = {
  received: "Received",
  paid: "Paid",
  rejected: "Rejected",
  reversed: "Reversed",
};

export const RECOVERY_STATUS_LABELS: Record<string, string> = {
  due: "Recovery due",
  settled: "Recovered",
  written_off: "Written off",
};

export const LEDGER_EVENT_LABELS: Record<string, string> = {
  fee_posted: "Fee posted",
  fee_reversed: "Fee reversed",
  commission_accrued: "Commission",
  commission_reversed: "Commission reversed",
  commission_reassigned: "Commission reassigned",
  clawback: "Clawback",
  clawback_settled: "Clawback recovered",
  clawback_written_off: "Clawback written off",
};

const FINANCE_RPC_MESSAGES: Array<[string, string]> = [
  ["finance_forbidden", "Forbidden"],
  ["finance_resource_not_found", "Not found"],
  ["finance_fee_selection_invalid", "Select draft fees on this case to post."],
  ["finance_fee_not_draft", "Only draft fees can be posted."],
  ["finance_fee_event_date_required", "This fee has no economic date and cannot be posted."],
  ["finance_statement_not_validated", "Validate the network statement before posting this fee."],
  ["finance_fee_source_invalid", "This fee's network source does not match; it cannot be posted."],
  ["finance_session_customer_invalid", "This fee's case and customer do not match."],
  ["finance_fee_amount_invalid", "Enter an amount greater than zero."],
  ["finance_fee_already_reversed", "This fee has already been reversed."],
  ["finance_fee_not_posted", "This fee is not posted (it may have been reversed); it cannot change."],
  ["finance_fee_not_reversed", "Reverse the posted fee before entering its correction."],
  ["finance_fee_already_corrected", "This reversed fee already has a correction."],
  ["finance_reason_required", "A reason is required."],
  ["finance_commission_paid", "Paid commission cannot be reversed or reassigned; use a clawback."],
  ["finance_commission_not_paid", "Only paid commission can be clawed back."],
  ["finance_commission_not_payable", "This commission is not payable."],
  ["finance_commission_already_adjusted", "This commission has already been adjusted."],
  ["finance_beneficiary_already_accrued", "That beneficiary already has commission on this fee."],
  ["finance_reassignment_invalid", "Choose a different introducer in this company."],
  ["finance_exception_already_resolved", "This exception is already resolved."],
  ["finance_resolution_invalid", "That resolution is not valid for this exception."],
  ["finance_payout_terminal", "Paid and reversed commission cannot change status."],
  ["finance_payout_transition_invalid", "That payout status change is not allowed."],
  ["finance_recovery_closed", "This clawback is already settled or written off."],
  ["finance_recovery_invalid", "Choose settled or written off."],
];

function financeRpcError(error: { message?: string; code?: string } | null): Error {
  const raw = error?.message ?? "";
  const hit = FINANCE_RPC_MESSAGES.find(([code]) => raw.includes(code));
  return new Error(hit ? hit[1] : raw || "The finance action failed.");
}

/** @deprecated Lost is no longer a payout status — kept only for reading legacy rows. */
export const LOST_COMMISSION_REASONS = [
  { value: "customer_not_proceeding", label: "Customer not proceeding" },
  { value: "application_declined", label: "Application declined / withdrawn" },
  { value: "remortgaged_elsewhere", label: "Customer remortgaged elsewhere" },
  { value: "duplicate_or_error", label: "Duplicate / error entry" },
] as const;

export type LostCommissionReason = (typeof LOST_COMMISSION_REASONS)[number]["value"];

function normalizePayoutStatus(raw: string | null | undefined): PayoutStatus {
  if (raw === "pending") return "received";
  if (raw === "lost") return "rejected";
  if (raw && PAYOUT_STATUSES.includes(raw as PayoutStatus)) return raw as PayoutStatus;
  return "received";
}

const PAYOUT_STATUS_Z = z.enum(["received", "paid", "rejected"]);
const PAYOUT_FILTER_Z = z.enum(PAYOUT_STATUSES);

export const BENEFICIARY_ROLE_LABELS: Record<string, string> = {
  advisor: "Advisor",
  introducer: "Introducer",
  referrer: "Refer a friend",
};

export type CommissionPayoutRow = {
  id: string;
  sessionId: string | null;
  caseRef: string | null;
  feeType: string | null;
  amountPence: number;
  commissionPct: number | null;
  beneficiaryRole: string;
  beneficiaryUserId: string | null;
  beneficiaryName: string;
  referralId: string | null;
  referredFriendLabel: string | null;
  payoutStatus: PayoutStatus;
  payoutNote: string | null;
  payoutAt: string | null;
  lostReason: string | null;
  createdAt: string;
  economicDate: string | null;
  beneficiaryCode: string | null;
};

/** A paid commission clawed back: linked negative event; the original payment stays paid. */
export type CommissionClawbackRow = {
  id: string;
  originalEventId: string;
  sessionId: string | null;
  caseRef: string | null;
  beneficiaryRole: string;
  beneficiaryUserId: string | null;
  beneficiaryName: string;
  amountPence: number;
  recoveryStatus: string;
  reason: string | null;
  createdAt: string;
  recoveryAt: string | null;
};

export type CommissionExceptionRow = {
  id: string;
  sessionId: string;
  caseRef: string | null;
  feeLineId: string;
  exceptionKind: string;
  beneficiaryRole: string;
  beneficiaryUserId: string | null;
  beneficiaryName: string | null;
  introducerId: string | null;
  feeType: string;
  basisPence: number;
  economicDate: string;
  status: string;
  resolution: string | null;
  resolutionReason: string | null;
  recordedAdviserIds: string[];
  unprovenReason: string | null;
  createdAt: string;
};

const COMMISSION_COLUMNS =
  "id, session_id, fee_type, amount_pence, commission_pct, beneficiary_user_id, beneficiary_role, beneficiary_name, beneficiary_code, referral_id, payout_status, payout_note, payout_at, lost_reason, created_at, note, economic_date";
const CLAWBACK_COLUMNS =
  "id, original_event_id, session_id, beneficiary_role, beneficiary_user_id, beneficiary_name, amount_pence, recovery_status, recovery_at, reason, created_at";

export const listSessionFees = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ sessionId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { tenantId, access } = await resolveFinanceTenant(context.userId);
    if (!canView(access, "finance_customer")) throw new Error("Forbidden");
    const { requireTenantFeature } = await import("@/lib/tenant-features.server");
    await requireTenantFeature(tenantId, "staff_finance");

    const { supabaseAdminUntyped: supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    await assertRowBelongsToTenant({
      table: "interview_sessions",
      id: data.sessionId,
      authorisedTenantId: tenantId,
      select: "id, tenant_id",
    });
    const { data: lines, error } = await supabaseAdmin
      .from("finance_fee_lines")
      .select("*")
      .eq("session_id", data.sessionId)
      .eq("tenant_id", tenantId)
      .neq("status", "deleted")
      .order("created_at", { ascending: true });
    if (error) {
      if (isMissingTable(error)) return { lines: [], migrationRequired: true };
      throw new Error(error.message);
    }
    return { lines: lines ?? [], migrationRequired: false };
  });

export const listSessionCommissions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ sessionId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { tenantId, access } = await resolveFinanceTenant(context.userId);
    if (!canView(access, "finance_customer")) throw new Error("Forbidden");

    const { supabaseAdminUntyped: supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    await assertRowBelongsToTenant({
      table: "interview_sessions",
      id: data.sessionId,
      authorisedTenantId: tenantId,
      select: "id, tenant_id",
    });
    const [{ data: rows, error }, { data: claws, error: clawErr }] = await Promise.all([
      supabaseAdmin
        .from("finance_ledger")
        .select(COMMISSION_COLUMNS)
        .eq("event_type", "commission_accrued")
        .eq("session_id", data.sessionId)
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: true }),
      supabaseAdmin
        .from("finance_ledger")
        .select(CLAWBACK_COLUMNS)
        .eq("event_type", "clawback")
        .eq("session_id", data.sessionId)
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: true }),
    ]);
    const err = error ?? clawErr;
    if (err) {
      if (isMissingTable(err)) {
        return {
          rows: [] as CommissionPayoutRow[],
          clawbacks: [] as CommissionClawbackRow[],
          migrationRequired: true,
        };
      }
      throw new Error(err.message);
    }
    const enriched = await enrichCommissionLedgerRows(
      supabaseAdmin,
      (rows ?? []) as RawCommissionLedgerRow[],
      tenantId,
    );
    return {
      rows: enriched,
      clawbacks: mapClawbackRows((claws ?? []) as RawClawbackRow[], enriched),
      migrationRequired: false,
    };
  });

export const listCommissionExceptions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        sessionId: z.string().uuid().optional(),
        status: z.enum(["open", "resolved", "all"]).default("open"),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ data, context }): Promise<{ rows: CommissionExceptionRow[] }> => {
    const { tenantId, access } = await resolveFinanceTenant(context.userId);
    if (!canView(access, "finance_customer")) throw new Error("Forbidden");
    const { supabaseAdminUntyped: supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    if (data.sessionId) {
      await assertRowBelongsToTenant({
        table: "interview_sessions",
        id: data.sessionId,
        authorisedTenantId: tenantId,
        select: "id, tenant_id",
      });
    }
    let q = supabaseAdmin
      .from("finance_commission_exceptions")
      .select(
        "id, session_id, fee_line_id, exception_kind, beneficiary_role, beneficiary_user_id, introducer_id, fee_type, commission_basis_pence, economic_date, status, resolution, resolution_reason, evidence, created_at",
      )
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: true })
      .limit(500);
    if (data.sessionId) q = q.eq("session_id", data.sessionId);
    if (data.status !== "all") q = q.eq("status", data.status);
    const { data: raw, error } = await q;
    if (error) {
      if (isMissingTable(error)) return { rows: [] };
      throw new Error(error.message);
    }
    const list = (raw ?? []) as Array<Record<string, unknown>>;
    const userIds = [
      ...new Set(list.map((r) => r.beneficiary_user_id as string | null).filter(Boolean) as string[]),
    ];
    const sessionIds = [...new Set(list.map((r) => r.session_id as string))];
    const names = new Map<string, string>();
    const caseRefs = new Map<string, string | null>();
    if (userIds.length > 0) {
      const { data: profiles } = await supabaseAdmin
        .from("profiles")
        .select("id, full_name, email")
        .in("id", userIds);
      for (const p of profiles ?? []) names.set(p.id, p.full_name || p.email || "Staff");
    }
    if (sessionIds.length > 0) {
      const { data: sessions } = await supabaseAdmin
        .from("interview_sessions")
        .select("id, case_ref")
        .eq("tenant_id", tenantId)
        .in("id", sessionIds);
      for (const s of sessions ?? []) caseRefs.set(s.id, s.case_ref ?? null);
    }
    return {
      rows: list.map((r) => ({
        id: r.id as string,
        sessionId: r.session_id as string,
        caseRef: caseRefs.get(r.session_id as string) ?? null,
        feeLineId: r.fee_line_id as string,
        exceptionKind: r.exception_kind as string,
        beneficiaryRole: r.beneficiary_role as string,
        beneficiaryUserId: (r.beneficiary_user_id as string | null) ?? null,
        beneficiaryName: r.beneficiary_user_id ? names.get(r.beneficiary_user_id as string) ?? null : null,
        introducerId: (r.introducer_id as string | null) ?? null,
        feeType: r.fee_type as string,
        basisPence: Number(r.commission_basis_pence) || 0,
        economicDate: r.economic_date as string,
        status: r.status as string,
        resolution: (r.resolution as string | null) ?? null,
        resolutionReason: (r.resolution_reason as string | null) ?? null,
        recordedAdviserIds: recordedAdvisers(r.evidence),
        unprovenReason:
          typeof (r.evidence as { reason?: unknown } | null)?.reason === "string"
            ? ((r.evidence as { reason: string }).reason)
            : null,
        createdAt: r.created_at as string,
      })),
    };
  });

function recordedAdvisers(evidence: unknown): string[] {
  const list = (evidence as { advisers?: Array<{ adviser_user_id?: unknown }> } | null)?.advisers;
  if (!Array.isArray(list)) return [];
  return list
    .map((a) => a?.adviser_user_id)
    .filter((id): id is string => typeof id === "string");
}

const REASON_Z = z.string().trim().min(1, "A reason is required.").max(500);

export const resolveCommissionException = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        exceptionId: z.string().uuid(),
        resolution: z.enum(["event_pct", "no_commission", "advisers_determined", "reinstate"]),
        pct: z.number().positive().max(100).optional(),
        adviserUserIds: z.array(z.string().uuid()).max(3).optional(),
        reason: REASON_Z,
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { tenantId, access } = await resolveFinanceTenant(context.userId);
    if (!access.isOwner) throw new Error("Only an Owner can resolve a commission exception.");
    await assertRowBelongsToTenant({
      table: "finance_commission_exceptions",
      id: data.exceptionId,
      authorisedTenantId: tenantId,
      select: "id, tenant_id",
    });
    const { supabaseAdminUntyped: supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    const { data: rows, error } = await supabaseAdmin.rpc("resolve_commission_exception", {
      p_tenant_id: tenantId,
      p_actor_user_id: context.userId,
      p_exception_id: data.exceptionId,
      p_resolution: data.resolution,
      p_pct: data.resolution === "event_pct" ? data.pct ?? null : null,
      p_adviser_user_ids:
        data.resolution === "advisers_determined" ? data.adviserUserIds ?? [] : null,
      p_reason: data.reason,
    });
    if (error) throw financeRpcError(error);
    return { ok: true as const, outcomes: ((rows ?? []) as Array<{ outcome: string }>).map((r) => r.outcome) };
  });

export const upsertDraftFee = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        sessionId: z.string().uuid(),
        feeType: z.enum(FEE_TYPES),
        amountPounds: z.number().min(0),
        note: z.string().max(500).optional(),
        lineId: z.string().uuid().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { tenantId, access } = await resolveFinanceTenant(context.userId);
    if (!canAmend(access, "finance_customer")) throw new Error("Forbidden");
    await assertRowBelongsToTenant({
      table: "interview_sessions",
      id: data.sessionId,
      authorisedTenantId: tenantId,
      select: "id, tenant_id",
    });

    // Case fees must come from Finance → Network statements → Allocate.
    // Manual draft create/edit is closed so commission only pull through from the network.
    throw new Error(
      "Manual fee entry is disabled. Allocate the fee from Finance → Network statements; it appears here as a draft to submit.",
    );
  });

export const submitSessionFees = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        sessionId: z.string().uuid(),
        feeLineIds: z.array(z.string().uuid()).min(1).max(50),
      })
      .parse(d),
  )
  .handler(
    async ({
      data,
      context,
    }): Promise<{ ok: true; count: number; posted: number; exceptions: number }> => {
      const { tenantId, access } = await resolveFinanceTenant(context.userId);
      if (!canAmend(access, "finance_customer")) throw new Error("Forbidden");
      await assertRowBelongsToTenant({
        table: "interview_sessions",
        id: data.sessionId,
        authorisedTenantId: tenantId,
        select: "id, tenant_id",
      });
      const { supabaseAdminUntyped: supabaseAdmin } = await import(
        "@/integrations/supabase/client.server"
      );
      const { data: rows, error } = await supabaseAdmin.rpc("post_session_fees", {
        p_tenant_id: tenantId,
        p_actor_user_id: context.userId,
        p_session_id: data.sessionId,
        p_fee_line_ids: data.feeLineIds,
      });
      if (error) throw financeRpcError(error);
      const list = (rows ?? []) as Array<{ created: boolean; exceptions: number | null }>;
      return {
        ok: true,
        count: list.length,
        posted: list.filter((r) => r.created).length,
        exceptions: list.reduce((n, r) => n + (r.exceptions ?? 0), 0),
      };
    },
  );

/** Owner-only typed adjustments: a posted fee is reversed, then optionally corrected as a new event. */
export const amendPostedFee = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .discriminatedUnion("action", [
        z.object({ action: z.literal("reverse"), lineId: z.string().uuid(), reason: REASON_Z }),
        z.object({
          action: z.literal("correct"),
          lineId: z.string().uuid(),
          amountPounds: z.number().positive().max(10_000_000),
          reason: REASON_Z,
          evidence: z.string().trim().min(1, "Evidence is required.").max(1000),
        }),
      ])
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { tenantId, access } = await resolveFinanceTenant(context.userId);
    if (!access.isOwner) throw new Error("Only an Owner can reverse or correct a posted fee.");
    await assertRowBelongsToTenant({
      table: "finance_fee_lines",
      id: data.lineId,
      authorisedTenantId: tenantId,
      select: "id, tenant_id",
    });
    const { supabaseAdminUntyped: supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    if (data.action === "reverse") {
      const { data: rows, error } = await supabaseAdmin.rpc("reverse_posted_fee", {
        p_tenant_id: tenantId,
        p_actor_user_id: context.userId,
        p_fee_line_id: data.lineId,
        p_reason: data.reason,
      });
      if (error) throw financeRpcError(error);
      const r = ((rows ?? []) as Array<{ commissions_reversed: number; clawbacks: number }>)[0];
      return {
        ok: true as const,
        action: "reverse" as const,
        commissionsReversed: r?.commissions_reversed ?? 0,
        clawbacks: r?.clawbacks ?? 0,
      };
    }
    const { data: rows, error } = await supabaseAdmin.rpc("post_fee_correction", {
      p_tenant_id: tenantId,
      p_actor_user_id: context.userId,
      p_reversed_fee_line_id: data.lineId,
      p_amount_pence: Math.round(data.amountPounds * 100),
      p_reason: data.reason,
      p_evidence: data.evidence,
    });
    if (error) throw financeRpcError(error);
    const r = ((rows ?? []) as Array<{ accrued: number; exceptions: number }>)[0];
    return {
      ok: true as const,
      action: "correct" as const,
      commissionsReversed: 0,
      clawbacks: 0,
      accrued: r?.accrued ?? 0,
      exceptions: r?.exceptions ?? 0,
    };
  });

async function resolveIntroducerIdByCode(tenantId: string, code: string | undefined) {
  if (!code) return null;
  const { supabaseAdminUntyped: supabaseAdmin } = await import(
    "@/integrations/supabase/client.server"
  );
  const { data, error } = await supabaseAdmin
    .from("introducers")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("company_code", code)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("No introducer with that code in this company.");
  return data.id as string;
}

export const reassignIntroducerCommission = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        ledgerId: z.string().uuid(),
        introducerCode: z.string().regex(/^\d{4}$/, "Enter the 4-digit introducer code."),
        reason: REASON_Z,
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { tenantId, access } = await resolveFinanceTenant(context.userId);
    if (!access.isOwner) throw new Error("Only an Owner can reassign posted commission.");
    await assertRowBelongsToTenant({
      table: "finance_ledger",
      id: data.ledgerId,
      authorisedTenantId: tenantId,
      select: "id, tenant_id",
    });
    const introducerId = await resolveIntroducerIdByCode(tenantId, data.introducerCode);
    const { supabaseAdminUntyped: supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    const { data: rows, error } = await supabaseAdmin.rpc("reassign_introducer_commission", {
      p_tenant_id: tenantId,
      p_actor_user_id: context.userId,
      p_accrual_id: data.ledgerId,
      p_new_introducer_id: introducerId,
      p_reason: data.reason,
    });
    if (error) throw financeRpcError(error);
    const r = ((rows ?? []) as Array<{ outcome: string }>)[0];
    return { ok: true as const, outcome: r?.outcome ?? null };
  });

export const clawBackCommission = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        ledgerId: z.string().uuid(),
        reason: REASON_Z,
        replacementIntroducerCode: z
          .string()
          .regex(/^\d{4}$/, "Enter the 4-digit introducer code.")
          .optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { tenantId, access } = await resolveFinanceTenant(context.userId);
    if (!access.isOwner) throw new Error("Only an Owner can claw back paid commission.");
    await assertRowBelongsToTenant({
      table: "finance_ledger",
      id: data.ledgerId,
      authorisedTenantId: tenantId,
      select: "id, tenant_id",
    });
    const replacementId = await resolveIntroducerIdByCode(tenantId, data.replacementIntroducerCode);
    const { supabaseAdminUntyped: supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    const { error } = await supabaseAdmin.rpc("claw_back_commission", {
      p_tenant_id: tenantId,
      p_actor_user_id: context.userId,
      p_accrual_id: data.ledgerId,
      p_reason: data.reason,
      p_replacement_introducer_id: replacementId,
    });
    if (error) throw financeRpcError(error);
    return { ok: true as const };
  });

export const settleCommissionClawback = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        ledgerId: z.string().uuid(),
        outcome: z.enum(["settled", "written_off"]),
        reason: REASON_Z,
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { tenantId, access } = await resolveFinanceTenant(context.userId);
    if (!access.isOwner) throw new Error("Only an Owner can settle or write off a clawback.");
    await assertRowBelongsToTenant({
      table: "finance_ledger",
      id: data.ledgerId,
      authorisedTenantId: tenantId,
      select: "id, tenant_id",
    });
    const { supabaseAdminUntyped: supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    const { error } = await supabaseAdmin.rpc("settle_commission_clawback", {
      p_tenant_id: tenantId,
      p_actor_user_id: context.userId,
      p_clawback_id: data.ledgerId,
      p_outcome: data.outcome,
      p_reason: data.reason,
    });
    if (error) throw financeRpcError(error);
    return { ok: true as const };
  });

export type EnrichedLedgerRow = {
  id: string;
  created_at: string;
  kind: string;
  fee_type?: string | null;
  amount_pence: number;
  note?: string | null;
  beneficiary_role?: string | null;
  commission_pct?: number | null;
  is_reversal?: boolean | null;
  session_id?: string | null;
  customerName?: string | null;
  caseRef?: string | null;
  receiverName?: string | null;
  receiverRef?: string | null;
  event_type?: string | null;
  economic_date?: string | null;
  reason?: string | null;
  payout_status?: string | null;
  recovery_status?: string | null;
  original_event_id?: string | null;
};

async function enrichFinanceLedgerRows(
  supabaseAdmin: Awaited<
    ReturnType<typeof import("@/integrations/supabase/client.server")>
  >["supabaseAdmin"],
  rows: Array<Record<string, unknown>>,
  tenantId: string,
): Promise<EnrichedLedgerRow[]> {
  const sessionIds = new Set<string>();
  const userIds = new Set<string>();
  for (const r of rows) {
    if (r.session_id) sessionIds.add(r.session_id as string);
    if (r.beneficiary_user_id) userIds.add(r.beneficiary_user_id as string);
  }

  const sessionMap = new Map<string, { caseRef: string | null; customerId: string | null }>();
  if (sessionIds.size > 0) {
    const { data: sessions } = await supabaseAdmin
      .from("interview_sessions")
      .select("id, case_ref, customer_id")
      .in("id", [...sessionIds])
      .eq("tenant_id", tenantId);
    for (const s of sessions ?? []) {
      sessionMap.set(s.id, { caseRef: s.case_ref ?? null, customerId: s.customer_id ?? null });
    }
  }

  const customerIds = new Set(
    [...sessionMap.values()].map((v) => v.customerId).filter(Boolean) as string[],
  );
  const customerNameMap = new Map<string, string>();
  if (customerIds.size > 0) {
    const { data: profiles } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, email")
      .in("id", [...customerIds]);
    for (const p of profiles ?? []) {
      customerNameMap.set(p.id, p.full_name || p.email || "Customer");
    }
  }

  const profileMap = new Map<string, string>();
  const advisorCodeMap = new Map<string, string>();
  const introCodeMap = new Map<string, string>();
  if (userIds.size > 0) {
    const { data: profiles } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, email")
      .in("id", [...userIds]);
    for (const p of profiles ?? []) profileMap.set(p.id, p.full_name || p.email || "Unknown");
    // Reference codes come only from this tenant's rows; a beneficiary with no row here shows none.
    const { data: adv } = await supabaseAdmin
      .from("advisor_profiles")
      .select("user_id, code")
      .in("user_id", [...userIds])
      .eq("tenant_id", tenantId);
    for (const a of adv ?? []) advisorCodeMap.set(a.user_id, a.code);
    const { data: intros } = await supabaseAdmin
      .from("introducers")
      .select("user_id, company_code")
      .in("user_id", [...userIds])
      .eq("tenant_id", tenantId);
    for (const i of intros ?? []) introCodeMap.set(i.user_id, (i as { company_code?: string }).company_code ?? "");
  }

  return rows.map((r) => {
    const sessionId = r.session_id as string | null;
    const sess = sessionId ? sessionMap.get(sessionId) : undefined;
    const customerName = sess?.customerId ? customerNameMap.get(sess.customerId) ?? null : null;
    const beneficiaryId = r.beneficiary_user_id as string | null;
    const role = r.beneficiary_role as string | null;
    let receiverRef: string | null = null;
    if (beneficiaryId && role === "advisor") receiverRef = advisorCodeMap.get(beneficiaryId) ?? null;
    if (beneficiaryId && role === "introducer") receiverRef = introCodeMap.get(beneficiaryId) ?? null;

    return {
      id: r.id as string,
      created_at: r.created_at as string,
      kind: r.kind as string,
      fee_type: r.fee_type as string | null,
      amount_pence: r.amount_pence as number,
      note: r.note as string | null,
      beneficiary_role: role,
      commission_pct: r.commission_pct as number | null,
      is_reversal: r.is_reversal as boolean | null,
      session_id: sessionId,
      customerName,
      caseRef: sess?.caseRef ?? null,
      receiverName:
        (r.beneficiary_name as string | null) ??
        (beneficiaryId ? profileMap.get(beneficiaryId) ?? null : null),
      receiverRef: (r.beneficiary_code as string | null) ?? receiverRef,
      event_type: (r.event_type as string | null) ?? null,
      economic_date: (r.economic_date as string | null) ?? null,
      reason: (r.reason as string | null) ?? null,
      payout_status: (r.payout_status as string | null) ?? null,
      recovery_status: (r.recovery_status as string | null) ?? null,
      original_event_id: (r.original_event_id as string | null) ?? null,
    };
  });
}

export const listFinanceLedger = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { tenantId, access } = await resolveFinanceTenant(context.userId);
    if (!canViewFinanceReport(access)) throw new Error("Forbidden — owner only");

    const { supabaseAdminUntyped: supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    const { data: rows, error } = await supabaseAdmin
      .from("finance_ledger")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) {
      if (isMissingTable(error)) return { rows: [], migrationRequired: true };
      throw new Error(error.message);
    }
    const enriched = await enrichFinanceLedgerRows(supabaseAdmin, rows ?? [], tenantId);
    return { rows: enriched, migrationRequired: false };
  });

export const listCommissionStaff = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        role: z.enum(["advisor", "introducer", "admin"]),
        query: z.string().max(80).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { tenantId, access } = await resolveFinanceTenant(context.userId);
    // Admin picker only needs introducer % permission (admins earn intro commission on bookings).
    const key =
      data.role === "advisor"
        ? "finance_advisor_pct"
        : "finance_introducer_pct";
    if (!canView(access, key)) throw new Error("Forbidden");

    const { supabaseAdminUntyped: supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    const { data: roleRows } = await supabaseAdmin
      .from("tenant_memberships")
      .select("user_id, role")
      .eq("tenant_id", tenantId)
      .eq("active", true);
    const byUser = new Map<string, Set<string>>();
    for (const r of roleRows ?? []) {
      const set = byUser.get(r.user_id) ?? new Set<string>();
      set.add(r.role);
      byUser.set(r.user_id, set);
    }

    const ids = new Set<string>();
    if (data.role === "advisor") {
      // Pure advisors (+ anyone with advisor role). Do not pull admins-only into this list.
      for (const [userId, roles] of byUser) {
        if (roles.has("adviser")) ids.add(userId);
      }
    } else if (data.role === "admin") {
      for (const [userId, roles] of byUser) {
        if (roles.has("owner") || roles.has("supervisor") || roles.has("general")) {
          ids.add(userId);
        }
      }
    } else {
      for (const [userId, roles] of byUser) {
        if (roles.has("introducer")) ids.add(userId);
      }
    }
    if (ids.size === 0) return [];

    const { data: profiles } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, email")
      .in("id", [...ids])
      .order("full_name", { ascending: true });

    const advisorCodeMap = new Map<string, string>();
    if (data.role === "advisor" || data.role === "admin") {
      const { data: codes } = await supabaseAdmin
        .from("advisor_profiles")
        .select("user_id, code")
        .eq("tenant_id", tenantId);
      for (const c of codes ?? []) advisorCodeMap.set(c.user_id, c.code);
    }

    const introCodeMap = new Map<string, string>();
    if (data.role === "introducer" || data.role === "admin") {
      const res = await supabaseAdmin
        .from("introducers")
        .select("user_id, company_code")
        .eq("tenant_id", tenantId);
      for (const r of res.data ?? []) {
        introCodeMap.set(r.user_id, (r as { company_code?: string }).company_code ?? "");
      }
    }

    const q = (data.query ?? "").trim().toLowerCase();
    return (profiles ?? [])
      .filter((p) => ids.has(p.id))
      .filter((p) => {
        if (!q) return true;
        const code =
          data.role === "introducer"
            ? introCodeMap.get(p.id) ?? ""
            : advisorCodeMap.get(p.id) ?? introCodeMap.get(p.id) ?? "";
        const hay = [p.full_name, p.email, code].filter(Boolean).join(" ").toLowerCase();
        return hay.includes(q);
      })
      .map((p) => ({
        id: p.id,
        full_name: p.full_name,
        email: p.email,
        referenceCode:
          data.role === "introducer"
            ? introCodeMap.get(p.id) || null
            : advisorCodeMap.get(p.id) ?? introCodeMap.get(p.id) ?? null,
      }));
  });

type RateVersionRow = {
  id: string;
  subject_kind: "introducer" | "adviser";
  introducer_id: string | null;
  adviser_user_id: string | null;
  fee_type: CommissionFeeType;
  percentage: number | string;
  effective_from: string;
  created_at: string;
  created_by: string | null;
  reason: string | null;
  source: string;
};

const RATE_VERSION_COLUMNS =
  "id, subject_kind, introducer_id, adviser_user_id, fee_type, percentage, effective_from, created_at, created_by, reason, source";

function rateSubjectKey(
  row: Pick<RateVersionRow, "subject_kind" | "introducer_id" | "adviser_user_id">,
) {
  return row.subject_kind === "introducer"
    ? `introducer:${row.introducer_id}`
    : `adviser:${row.adviser_user_id}`;
}

/** Version rows for one tenant, ordered by effective date (oldest first). */
async function loadTenantRateVersions(
  supabaseAdmin: UntypedAdmin,
  tenantId: string,
  filter: {
    subject?: CommissionRateSubject;
    subjectKind?: "introducer" | "adviser";
    feeType?: string;
  },
): Promise<RateVersionRow[]> {
  let query = supabaseAdmin
    .from("commission_rate_versions")
    .select(RATE_VERSION_COLUMNS)
    .eq("tenant_id", tenantId);
  if (filter.subject) {
    const args = rateSubjectArgs(filter.subject);
    query = query.eq("subject_kind", args.p_subject_kind);
    query =
      filter.subject.kind === "introducer"
        ? query.eq("introducer_id", filter.subject.introducerId)
        : query.eq("adviser_user_id", filter.subject.adviserUserId);
  } else if (filter.subjectKind) {
    query = query.eq("subject_kind", filter.subjectKind);
  }
  if (filter.feeType) query = query.eq("fee_type", filter.feeType);
  const { data, error } = await query
    .order("effective_from", { ascending: true })
    .order("id", { ascending: true })
    .limit(5000);
  if (error) throw new Error(error.message);
  return (data ?? []) as RateVersionRow[];
}

/** Introducer registration id → Auth user for this tenant only. */
async function tenantIntroducerUsers(
  supabaseAdmin: UntypedAdmin,
  tenantId: string,
  introducerIds: string[],
): Promise<Map<string, { userId: string; companyName: string | null }>> {
  const map = new Map<string, { userId: string; companyName: string | null }>();
  if (introducerIds.length === 0) return map;
  const { data, error } = await supabaseAdmin
    .from("introducers")
    .select("id, user_id, company_name")
    .eq("tenant_id", tenantId)
    .in("id", introducerIds);
  if (error) throw new Error(error.message);
  for (const r of data ?? []) {
    if (r.user_id) {
      map.set(r.id as string, {
        userId: r.user_id as string,
        companyName: (r.company_name as string | null) ?? null,
      });
    }
  }
  return map;
}

export type CommissionRateHistoryRow = {
  id: string;
  fee_type: CommissionFeeType;
  pct_from: number | null;
  pct_to: number;
  effective_from: string;
  created_at: string;
  changed_by: string | null;
  user_id: string | null;
  role: "advisor" | "introducer";
  user_name: string;
  reason: string | null;
  source: string;
};

export const listCommissionRateHistory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        userId: z.string().uuid().optional(),
        role: z.enum(["advisor", "introducer"]).optional(),
        from: z.string().optional(),
        to: z.string().optional(),
        feeType: z.enum(FEE_TYPES).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<CommissionRateHistoryRow[]> => {
    const { tenantId, access } = await resolveFinanceTenant(context.userId);
    if (!data.userId) {
      if (!canViewFinanceReport(access)) throw new Error("Forbidden");
    } else {
      const key = data.role === "introducer" ? "finance_introducer_pct" : "finance_advisor_pct";
      if (!canView(access, key)) throw new Error("Forbidden");
    }

    const { supabaseAdminUntyped: supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    let subject: CommissionRateSubject | undefined;
    if (data.userId) {
      const found = await findTenantRateSubject(
        supabaseAdmin,
        tenantId,
        data.role ?? "advisor",
        data.userId,
      );
      if (!found) return [];
      subject = found.subject;
    }
    const versions = await loadTenantRateVersions(supabaseAdmin, tenantId, {
      subject,
      subjectKind: data.role ? (data.role === "advisor" ? "adviser" : "introducer") : undefined,
      feeType: data.feeType,
    });

    const previous = new Map<string, number>();
    const withPrevious = versions.map((v) => {
      const key = `${rateSubjectKey(v)}:${v.fee_type}`;
      const pctFrom = previous.has(key) ? previous.get(key)! : null;
      previous.set(key, Number(v.percentage));
      return { v, pctFrom };
    });

    const fromMs = data.from ? Date.parse(data.from) : null;
    const toMs = data.to ? Date.parse(data.to) : null;
    const listed = withPrevious
      .filter(({ v }) => {
        const at = Date.parse(v.created_at);
        if (fromMs != null && !Number.isNaN(fromMs) && at < fromMs) return false;
        if (toMs != null && !Number.isNaN(toMs) && at > toMs) return false;
        return true;
      })
      .sort((a, b) =>
        a.v.created_at === b.v.created_at
          ? b.v.effective_from.localeCompare(a.v.effective_from)
          : b.v.created_at.localeCompare(a.v.created_at),
      )
      .slice(0, 100);

    const introducerUsers = await tenantIntroducerUsers(supabaseAdmin, tenantId, [
      ...new Set(listed.map(({ v }) => v.introducer_id).filter(Boolean)),
    ] as string[]);
    const userIdFor = (v: RateVersionRow) =>
      v.subject_kind === "adviser"
        ? v.adviser_user_id
        : (introducerUsers.get(v.introducer_id as string)?.userId ?? null);
    const userIds = [...new Set(listed.map(({ v }) => userIdFor(v)).filter(Boolean))] as string[];
    const nameById = new Map<string, string>();
    if (userIds.length > 0) {
      const { data: profiles } = await supabaseAdmin
        .from("profiles")
        .select("id, full_name, email")
        .in("id", userIds);
      for (const p of profiles ?? []) nameById.set(p.id, p.full_name || p.email || "Unknown");
    }

    return listed.map(({ v, pctFrom }) => {
      const userId = userIdFor(v);
      return {
        id: v.id,
        fee_type: v.fee_type,
        pct_from: pctFrom,
        pct_to: Number(v.percentage),
        effective_from: v.effective_from,
        created_at: v.created_at,
        changed_by: v.created_by,
        user_id: userId,
        role: v.subject_kind === "adviser" ? "advisor" : "introducer",
        user_name: (userId ? nameById.get(userId) : null) ?? "Unknown",
        reason: v.reason,
        source: v.source,
      };
    });
  });

export type CurrentRateValue = { pct: number; effectiveFrom: string; versionId: string } | null;

export const getCommissionRate = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ userId: z.string().uuid(), role: z.enum(["advisor", "introducer"]) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { tenantId, access } = await resolveFinanceTenant(context.userId);
    const key = data.role === "advisor" ? "finance_advisor_pct" : "finance_introducer_pct";
    if (!canView(access, key)) throw new Error("Forbidden");

    const { supabaseAdminUntyped: supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    const found = await findTenantRateSubject(supabaseAdmin, tenantId, data.role, data.userId);
    const current: Record<CommissionFeeType, CurrentRateValue> = {
      fee: null,
      mortgage_fee: null,
      insurance_fee: null,
      other_fee: null,
    };
    if (found) {
      const now = new Date();
      for (const feeType of feeTypesForSubject(found.subject)) {
        const version = await resolveCommissionRateAsOf(supabaseAdmin, {
          tenantId,
          subject: found.subject,
          feeType,
          eventAt: now,
        });
        current[feeType] = version
          ? {
              pct: version.percentage,
              effectiveFrom: version.effectiveFrom,
              versionId: version.versionId,
            }
          : null;
      }
    }
    return {
      subjectAvailable: Boolean(found),
      subjectUsable: Boolean(found?.usable),
      allowedFeeTypes: found ? [...feeTypesForSubject(found.subject)] : [],
      current,
      pctFee: current.fee?.pct ?? null,
      pctMortgageFee: current.mortgage_fee?.pct ?? null,
      pctInsuranceFee: current.insurance_fee?.pct ?? null,
      pctOtherFee: current.other_fee?.pct ?? null,
    };
  });

export const getRafBonusAmount = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { tenantId, access } = await resolveFinanceTenant(context.userId);
    if (!canView(access, "finance_raf")) throw new Error("Forbidden");

    const { supabaseAdminUntyped: supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    const amountPence = await getRafBonusPence(supabaseAdmin, tenantId);
    return { amountPence, configured: amountPence != null };
  });

const RATE_PCT_Z = z
  .number()
  .min(0)
  .max(100)
  .refine((n) => Math.abs(n * 1000 - Math.round(n * 1000)) < 1e-6, "At most three decimal places.");

export const setCommissionRate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        userId: z.string().uuid(),
        role: z.enum(["advisor", "introducer"]),
        rates: z
          .object({
            fee: RATE_PCT_Z.optional(),
            mortgage_fee: RATE_PCT_Z.optional(),
            insurance_fee: RATE_PCT_Z.optional(),
            other_fee: RATE_PCT_Z.optional(),
          })
          .strict(),
        effective: z.discriminatedUnion("mode", [
          z.object({ mode: z.literal("now") }),
          z.object({
            mode: z.literal("date"),
            effectiveFrom: z.string().datetime({ offset: true }),
            confirmBackdate: z.boolean().optional(),
          }),
        ]),
        reason: z.string().trim().max(500).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { tenantId, access } = await resolveFinanceTenant(context.userId);
    // Rates are commercial terms: the tenant Owner alone sets them (Supervisor, General Admin,
    // admin_access and platform roles view at most).
    if (!access.isOwner) throw new Error("Forbidden");

    const { supabaseAdminUntyped: supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    const found = await findTenantRateSubject(supabaseAdmin, tenantId, data.role, data.userId);
    if (!found || !found.usable) throw new Error("Not found.");

    const rates = Object.fromEntries(
      Object.entries(data.rates).filter(([, v]) => v !== undefined),
    ) as Partial<Record<CommissionFeeType, number>>;
    if (Object.keys(rates).length === 0) throw new Error("Enter at least one rate to change.");

    const { data: rows, error } = await supabaseAdmin.rpc("set_commission_rate_versions", {
      p_tenant_id: tenantId,
      p_actor_user_id: context.userId,
      ...rateSubjectArgs(found.subject),
      p_rates: rates,
      p_effective_now: data.effective.mode === "now",
      p_effective_from: data.effective.mode === "date" ? data.effective.effectiveFrom : null,
      p_backdate_confirmed:
        data.effective.mode === "date" ? Boolean(data.effective.confirmBackdate) : false,
      p_reason: data.reason ? data.reason : null,
    });
    if (error) throw new Error(rateMutationErrorMessage(String(error.message ?? "")));
    const created = (rows ?? []) as Array<{
      version_id: string;
      fee_type: CommissionFeeType;
      percentage: number | string;
      effective_from: string;
    }>;
    return {
      ok: true,
      versions: created.map((r) => ({
        versionId: r.version_id,
        feeType: r.fee_type,
        pct: Number(r.percentage),
        effectiveFrom: r.effective_from,
      })),
    };
  });

/** Commission totals for RAF referrers (admin finance_raf permission). */
export const listRafCommissionHighlights = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const acting = await actingFinanceTenant(context.userId);
    if (!acting || !canView(acting.access, "finance_raf")) {
      return { byUserId: {} as Record<string, number> };
    }
    const { tenantId } = acting;

    const { supabaseAdminUntyped: supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    const { data: rows, error } = await supabaseAdmin
      .from("finance_ledger")
      .select("beneficiary_user_id, amount_pence")
      .in("event_type", ["commission_accrued", "commission_reversed", "commission_reassigned", "clawback"])
      .eq("beneficiary_role", "introducer")
      .eq("tenant_id", tenantId);
    if (error) {
      if (isMissingTable(error)) return { byUserId: {} };
      throw new Error(error.message);
    }
    const byUserId: Record<string, number> = {};
    for (const r of rows ?? []) {
      if (!r.beneficiary_user_id) continue;
      byUserId[r.beneficiary_user_id] = (byUserId[r.beneficiary_user_id] ?? 0) + r.amount_pence;
    }
    return { byUserId };
  });

/** The tenant's configured RAF bonus in pence, or null when this tenant has not configured one. */
export async function getRafBonusPence(
  supabaseAdmin: UntypedAdmin,
  tenantId: string,
): Promise<number | null> {
  const { data, error } = await supabaseAdmin
    .from("finance_settings")
    .select("num_value")
    .eq("key", "raf_bonus_pence")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const value = data?.num_value;
  return typeof value === "number" ? value : null;
}

type RawCommissionLedgerRow = {
  id: string;
  session_id: string | null;
  fee_type: string | null;
  amount_pence: number;
  commission_pct: number | null;
  beneficiary_user_id: string | null;
  beneficiary_role: string | null;
  referral_id: string | null;
  payout_status: string | null;
  payout_note: string | null;
  payout_at: string | null;
  lost_reason: string | null;
  created_at: string;
  note?: string | null;
  beneficiary_name?: string | null;
  beneficiary_code?: string | null;
  economic_date?: string | null;
};

type RawClawbackRow = {
  id: string;
  original_event_id: string;
  session_id: string | null;
  beneficiary_role: string | null;
  beneficiary_user_id: string | null;
  beneficiary_name: string | null;
  amount_pence: number;
  recovery_status: string | null;
  recovery_at: string | null;
  reason: string | null;
  created_at: string;
};

function mapClawbackRows(
  rows: RawClawbackRow[],
  accruals: CommissionPayoutRow[],
): CommissionClawbackRow[] {
  const byId = new Map(accruals.map((a) => [a.id, a]));
  return rows.map((r) => {
    const original = byId.get(r.original_event_id);
    return {
      id: r.id,
      originalEventId: r.original_event_id,
      sessionId: r.session_id,
      caseRef: original?.caseRef ?? null,
      beneficiaryRole: r.beneficiary_role ?? original?.beneficiaryRole ?? "advisor",
      beneficiaryUserId: r.beneficiary_user_id,
      beneficiaryName: r.beneficiary_name ?? original?.beneficiaryName ?? "",
      amountPence: r.amount_pence,
      recoveryStatus: r.recovery_status ?? "due",
      reason: r.reason,
      createdAt: r.created_at,
      recoveryAt: r.recovery_at,
    };
  });
}

async function enrichCommissionLedgerRows(
  supabaseAdmin: Awaited<
    ReturnType<typeof import("@/integrations/supabase/client.server")>
  >["supabaseAdmin"],
  rows: RawCommissionLedgerRow[],
  tenantId: string,
): Promise<CommissionPayoutRow[]> {
  const userIds = new Set<string>();
  const sessionIds = new Set<string>();
  const referralIds = new Set<string>();
  for (const r of rows) {
    if (r.beneficiary_user_id) userIds.add(r.beneficiary_user_id);
    if (r.session_id) sessionIds.add(r.session_id);
    if (r.referral_id) referralIds.add(r.referral_id);
  }

  const profileMap = new Map<string, string>();
  if (userIds.size > 0) {
    const { data: profiles } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, email")
      .in("id", Array.from(userIds));
    for (const p of profiles ?? []) {
      profileMap.set(p.id, p.full_name || p.email || "Unknown");
    }
  }

  const caseRefMap = new Map<string, string>();
  if (sessionIds.size > 0) {
    const { data: sessions } = await supabaseAdmin
      .from("interview_sessions")
      .select("id, case_ref")
      .in("id", Array.from(sessionIds))
      .eq("tenant_id", tenantId);
    for (const s of sessions ?? []) {
      if (s.case_ref) caseRefMap.set(s.id, s.case_ref);
    }
  }

  const referralMap = new Map<string, string>();
  if (referralIds.size > 0) {
    const { data: refs } = await supabaseAdmin
      .from("referrals")
      .select("id, referred_email")
      .in("id", Array.from(referralIds))
      .eq("tenant_id", tenantId);
    for (const ref of refs ?? []) {
      referralMap.set(ref.id, ref.referred_email ?? "Friend");
    }
  }

  return rows.map((r) => {
    const role = r.beneficiary_role ?? "advisor";
    let beneficiaryName =
      r.beneficiary_name || (r.beneficiary_user_id && profileMap.get(r.beneficiary_user_id)) || "";
    if (!beneficiaryName && role === "referrer" && r.note) {
      const match = String(r.note).match(/referrer ([^·]+)/i);
      beneficiaryName = match?.[1]?.trim() ?? "RAF referrer";
    }
    if (!beneficiaryName) beneficiaryName = BENEFICIARY_ROLE_LABELS[role] ?? role;

    return {
      id: r.id,
      sessionId: r.session_id,
      caseRef: r.session_id ? caseRefMap.get(r.session_id) ?? null : null,
      feeType: r.fee_type,
      amountPence: r.amount_pence,
      commissionPct: r.commission_pct != null ? Number(r.commission_pct) : null,
      beneficiaryRole: role,
      beneficiaryUserId: r.beneficiary_user_id,
      beneficiaryName,
      referralId: r.referral_id,
      referredFriendLabel: r.referral_id ? referralMap.get(r.referral_id) ?? null : null,
      payoutStatus: normalizePayoutStatus(r.payout_status),
      payoutNote: r.payout_note ?? null,
      payoutAt: r.payout_at ?? null,
      lostReason: r.lost_reason ?? null,
      createdAt: r.created_at,
      economicDate: r.economic_date ?? null,
      beneficiaryCode: r.beneficiary_code ?? null,
    };
  });
}

/** Read-only commission statement for the signed-in user (advisor, introducer, or RAF referrer). */
export const listMyCommissionStatement = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        payoutStatus: PAYOUT_FILTER_Z.optional(),
        viewAsUserId: z.string().uuid().optional(),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdminUntyped: supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    const { tenantId, access } = await resolveFinanceTenant(context.userId);

    let beneficiaryUserId = context.userId;
    if (data.viewAsUserId) {
      if (!access.isOwner && !access.isSupervisor) throw new Error("Forbidden");
      await requireTenantMembership(data.viewAsUserId, tenantId);
      beneficiaryUserId = data.viewAsUserId;
    }

    let query = supabaseAdmin
      .from("finance_ledger")
      .select(COMMISSION_COLUMNS)
      .eq("event_type", "commission_accrued")
      .eq("beneficiary_user_id", beneficiaryUserId)
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(2000);

    if (data.payoutStatus) query = query.eq("payout_status", data.payoutStatus);

    const [{ data: rows, error }, { data: claws, error: clawErr }] = await Promise.all([
      query,
      supabaseAdmin
        .from("finance_ledger")
        .select(CLAWBACK_COLUMNS)
        .eq("event_type", "clawback")
        .eq("beneficiary_user_id", beneficiaryUserId)
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(500),
    ]);
    const err = error ?? clawErr;
    if (err) {
      if (isMissingTable(err)) {
        return {
          rows: [] as CommissionPayoutRow[],
          clawbacks: [] as CommissionClawbackRow[],
          migrationRequired: true,
        };
      }
      throw new Error(err.message);
    }

    const enriched = await enrichCommissionLedgerRows(
      supabaseAdmin,
      (rows ?? []) as RawCommissionLedgerRow[],
      tenantId,
    );
    return {
      rows: enriched,
      clawbacks: mapClawbackRows((claws ?? []) as RawClawbackRow[], enriched),
      migrationRequired: false,
    };
  });

export const listCommissionPayouts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        beneficiaryRole: z.enum(["advisor", "introducer", "referrer"]).optional(),
        payoutStatus: PAYOUT_FILTER_Z.optional(),
        beneficiaryUserId: z.string().uuid().optional(),
        caseRefQuery: z.string().max(64).optional(),
        sessionId: z.string().uuid().optional(),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { tenantId, access } = await resolveFinanceTenant(context.userId);
    if (!canViewCommissionPayouts(access)) throw new Error("Forbidden");

    const { supabaseAdminUntyped: supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );

    let sessionFilterIds: string[] | null = null;
    if (data.sessionId) {
      await assertRowBelongsToTenant({
        table: "interview_sessions",
        id: data.sessionId,
        authorisedTenantId: tenantId,
        select: "id, tenant_id",
      });
      sessionFilterIds = [data.sessionId];
    } else if (data.caseRefQuery?.trim()) {
      const q = data.caseRefQuery.trim();
      const { data: sessions, error: sessErr } = await supabaseAdmin
        .from("interview_sessions")
        .select("id")
        .ilike("case_ref", `%${q}%`)
        .eq("tenant_id", tenantId)
        .limit(100);
      if (sessErr) throw new Error(sessErr.message);
      sessionFilterIds = (sessions ?? []).map((s) => s.id);
      if (sessionFilterIds.length === 0) {
        return {
          rows: [] as CommissionPayoutRow[],
          clawbacks: [] as CommissionClawbackRow[],
          migrationRequired: false,
        };
      }
    }

    let query = supabaseAdmin
      .from("finance_ledger")
      .select(COMMISSION_COLUMNS)
      .eq("event_type", "commission_accrued")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(sessionFilterIds ? 200 : 500);
    let clawQuery = supabaseAdmin
      .from("finance_ledger")
      .select(CLAWBACK_COLUMNS)
      .eq("event_type", "clawback")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(200);

    if (sessionFilterIds) {
      query = query.in("session_id", sessionFilterIds);
      clawQuery = clawQuery.in("session_id", sessionFilterIds);
    }
    if (data.beneficiaryRole) {
      query = query.eq("beneficiary_role", data.beneficiaryRole);
      clawQuery = clawQuery.eq("beneficiary_role", data.beneficiaryRole);
    }
    if (data.payoutStatus && !sessionFilterIds) query = query.eq("payout_status", data.payoutStatus);
    if (data.beneficiaryUserId) {
      query = query.eq("beneficiary_user_id", data.beneficiaryUserId);
      clawQuery = clawQuery.eq("beneficiary_user_id", data.beneficiaryUserId);
    }

    const [{ data: rows, error }, { data: claws, error: clawErr }] = await Promise.all([
      query,
      clawQuery,
    ]);
    const err = error ?? clawErr;
    if (err) {
      if (isMissingTable(err)) {
        return {
          rows: [] as CommissionPayoutRow[],
          clawbacks: [] as CommissionClawbackRow[],
          migrationRequired: true,
        };
      }
      throw new Error(err.message);
    }

    const enriched = await enrichCommissionLedgerRows(
      supabaseAdmin,
      (rows ?? []) as RawCommissionLedgerRow[],
      tenantId,
    );

    return {
      rows: enriched,
      clawbacks: mapClawbackRows((claws ?? []) as RawClawbackRow[], enriched),
      migrationRequired: false,
    };
  });

export const updateCommissionPayoutStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        ledgerId: z.string().uuid(),
        payoutStatus: PAYOUT_STATUS_Z,
        payoutNote: z.string().max(500).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { tenantId, access } = await resolveFinanceTenant(context.userId);
    if (!canAmendCommissionPayouts(access)) throw new Error("Forbidden");
    await assertRowBelongsToTenant({
      table: "finance_ledger",
      id: data.ledgerId,
      authorisedTenantId: tenantId,
      select: "id, tenant_id",
    });

    return await applyCommissionPayoutStatusPatch(data, context.userId, tenantId);
  });

export const updateSessionCommissionPayoutStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        sessionId: z.string().uuid(),
        ledgerId: z.string().uuid(),
        payoutStatus: PAYOUT_STATUS_Z,
        payoutNote: z.string().max(500).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { tenantId, access } = await resolveFinanceTenant(context.userId);
    if (!canAmendCommissionPayouts(access)) throw new Error("Forbidden");
    await assertRowBelongsToTenant({
      table: "interview_sessions",
      id: data.sessionId,
      authorisedTenantId: tenantId,
      select: "id, tenant_id",
    });

    const { supabaseAdminUntyped: supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    const { data: row, error } = await supabaseAdmin
      .from("finance_ledger")
      .select("id, session_id, event_type")
      .eq("id", data.ledgerId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row || row.event_type !== "commission_accrued" || row.session_id !== data.sessionId) {
      throw new Error("Commission row not found for this case");
    }

    return await applyCommissionPayoutStatusPatch(data, context.userId, tenantId);
  });

/** RAF bonus payout decisions use the same recorded transition as every other commission. */
/** Every payout change is a recorded transition; paid is terminal and the DB enforces the order. */
async function applyCommissionPayoutStatusPatch(
  data: {
    ledgerId: string;
    payoutStatus: "received" | "paid" | "rejected";
    payoutNote?: string;
  },
  userId: string,
  tenantId: string,
) {
  const { supabaseAdminUntyped: supabaseAdmin } = await import(
    "@/integrations/supabase/client.server"
  );
  const { error } = await supabaseAdmin.rpc("set_commission_payout_status", {
    p_tenant_id: tenantId,
    p_actor_user_id: userId,
    p_event_id: data.ledgerId,
    p_to_status: data.payoutStatus,
    p_note: data.payoutNote?.trim() || null,
  });
  if (error) throw financeRpcError(error);
  return { ok: true };
}

export type FinanceAuditRow = {
  id: string;
  audit_type: string;
  summary: string;
  role: string | null;
  fee_type: string | null;
  created_at: string;
};

export const listFinanceAuditLog = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { tenantId, access } = await resolveFinanceTenant(context.userId);
    if (!canViewFinanceReport(access)) throw new Error("Forbidden");

    const { supabaseAdminUntyped: supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    const { data, error } = await supabaseAdmin
      .from("finance_audit_log")
      .select("id, audit_type, summary, role, fee_type, created_at")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error && !isMissingTable(error)) throw new Error(error.message);
    return (data ?? []) as FinanceAuditRow[];
  });

export type CommissionArrangementRow = {
  userId: string;
  name: string;
  role: "advisor" | "introducer";
  referenceCode: string | null;
  /** Null means no rate is set for that fee type (distinct from an explicit 0%). */
  pctFee: number | null;
  pctMortgageFee: number | null;
  pctInsuranceFee: number | null;
  pctOtherFee: number | null;
};

export const listCurrentCommissionArrangements = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ role: z.enum(["all", "advisor", "introducer"]).optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { tenantId, access } = await resolveFinanceTenant(context.userId);
    if (!canViewFinanceReport(access)) throw new Error("Forbidden");

    const roleFilter = data.role ?? "all";
    const { supabaseAdminUntyped: supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    const versions = await loadTenantRateVersions(supabaseAdmin, tenantId, {
      subjectKind:
        roleFilter === "all" ? undefined : roleFilter === "advisor" ? "adviser" : "introducer",
    });

    // Current = latest version effective now, per subject and fee type.
    const nowMs = Date.now();
    const currentBySubject = new Map<
      string,
      { row: RateVersionRow; pct: Partial<Record<CommissionFeeType, number>> }
    >();
    for (const v of versions) {
      if (Date.parse(v.effective_from) > nowMs) continue;
      const key = rateSubjectKey(v);
      const entry = currentBySubject.get(key) ?? { row: v, pct: {} };
      entry.pct[v.fee_type] = Number(v.percentage);
      currentBySubject.set(key, entry);
    }

    const introducerUsers = await tenantIntroducerUsers(supabaseAdmin, tenantId, [
      ...new Set([...currentBySubject.values()].map((e) => e.row.introducer_id).filter(Boolean)),
    ] as string[]);
    const userIdFor = (v: RateVersionRow) =>
      v.subject_kind === "adviser"
        ? v.adviser_user_id
        : (introducerUsers.get(v.introducer_id as string)?.userId ?? null);

    const userIds = [
      ...new Set([...currentBySubject.values()].map((e) => userIdFor(e.row)).filter(Boolean)),
    ] as string[];
    const nameMap = new Map<string, string>();
    if (userIds.length > 0) {
      const { data: profiles } = await supabaseAdmin
        .from("profiles")
        .select("id, full_name, email")
        .in("id", userIds);
      for (const p of profiles ?? []) nameMap.set(p.id, p.full_name || p.email || "Unknown");
    }

    const advisorCodes = new Map<string, string>();
    const introCodes = new Map<string, string>();
    const { data: adv } = await supabaseAdmin
      .from("advisor_profiles")
      .select("user_id, code")
      .eq("tenant_id", tenantId);
    for (const a of adv ?? []) advisorCodes.set(a.user_id, a.code);
    const { data: intros } = await supabaseAdmin
      .from("introducers")
      .select("id, company_code")
      .eq("tenant_id", tenantId);
    for (const i of intros ?? [])
      introCodes.set(i.id, (i as { company_code?: string }).company_code ?? "");

    const rows: CommissionArrangementRow[] = [];
    for (const { row, pct } of currentBySubject.values()) {
      const userId = userIdFor(row);
      if (!userId) continue;
      const role = row.subject_kind === "adviser" ? "advisor" : "introducer";
      rows.push({
        userId,
        name:
          nameMap.get(userId) ??
          (role === "introducer"
            ? introducerUsers.get(row.introducer_id as string)?.companyName
            : null) ??
          "Unknown",
        role,
        referenceCode:
          role === "advisor"
            ? (advisorCodes.get(userId) ?? null)
            : introCodes.get(row.introducer_id as string) || null,
        pctFee: pct.fee ?? null,
        pctMortgageFee: pct.mortgage_fee ?? null,
        pctInsuranceFee: pct.insurance_fee ?? null,
        pctOtherFee: pct.other_fee ?? null,
      });
    }
    return rows.sort((a, b) => a.name.localeCompare(b.name));
  });
