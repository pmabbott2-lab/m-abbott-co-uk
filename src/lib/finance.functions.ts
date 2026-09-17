import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { resolveAdminAccess } from "@/lib/admin.functions";
import { canAmend, canView, canViewFinanceReport, canViewCommissionPayouts, canAmendCommissionPayouts } from "@/lib/admin-access";

const FEE_TYPES = ["fee", "mortgage_fee", "insurance_fee", "other_fee"] as const;

export const RAF_BONUS_PENCE = 7500;
export const RAF_BONUS_POUNDS = RAF_BONUS_PENCE / 100;

type CommissionRateRow = {
  percentage?: number | null;
  pct_fee?: number | null;
  pct_mortgage_fee?: number | null;
  pct_insurance_fee?: number | null;
  pct_other_fee?: number | null;
};

function pctForFeeType(rate: CommissionRateRow, feeType: string): number {
  switch (feeType) {
    case "mortgage_fee":
      return Number(rate.pct_mortgage_fee ?? rate.percentage ?? 0);
    case "insurance_fee":
      return Number(rate.pct_insurance_fee ?? rate.percentage ?? 0);
    case "other_fee":
      return Number(rate.pct_other_fee ?? rate.percentage ?? 0);
    default:
      return Number(rate.pct_fee ?? rate.percentage ?? 0);
  }
}

async function commissionPctForUser(
  supabaseAdmin: Awaited<ReturnType<typeof import("@/integrations/supabase/client.server")>>["supabaseAdmin"],
  userId: string,
  role: "advisor" | "introducer",
  feeType: string,
): Promise<number> {
  // Introducers (including staff attributed as introducer) earn on fee + mortgage fee only.
  // Insurance and other fee commission rates are advisor-exclusive.
  if (role === "introducer" && feeType !== "fee" && feeType !== "mortgage_fee") return 0;

  const { data: rate, error } = await supabaseAdmin
    .from("commission_rates")
    .select("percentage, pct_fee, pct_mortgage_fee, pct_insurance_fee, pct_other_fee")
    .eq("user_id", userId)
    .eq("role", role)
    .maybeSingle();
  if (error && !isMissingTable(error)) throw new Error(error.message);
  if (!rate) return 0;
  return pctForFeeType(rate as CommissionRateRow, feeType);
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

export const PAYOUT_STATUSES = ["received", "paid", "rejected"] as const;
export type PayoutStatus = (typeof PAYOUT_STATUSES)[number];

export const PAYOUT_STATUS_LABELS: Record<PayoutStatus, string> = {
  received: "Received",
  paid: "Paid",
  rejected: "Rejected",
};

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
};

export const listSessionFees = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ sessionId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const email = (context.claims as { email?: string }).email;
    const access = await resolveAdminAccess(context.userId, email);
    if (!canView(access, "finance_customer")) throw new Error("Forbidden");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: lines, error } = await supabaseAdmin
      .from("finance_fee_lines")
      .select("*")
      .eq("session_id", data.sessionId)
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
    const email = (context.claims as { email?: string }).email;
    const access = await resolveAdminAccess(context.userId, email);
    if (!canView(access, "finance_customer")) throw new Error("Forbidden");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin
      .from("finance_ledger")
      .select(
        "id, session_id, fee_type, amount_pence, commission_pct, beneficiary_user_id, beneficiary_role, referral_id, payout_status, payout_note, payout_at, lost_reason, created_at, note",
      )
      .eq("kind", "commission")
      .eq("session_id", data.sessionId)
      .order("created_at", { ascending: true });
    if (error) {
      if (isMissingTable(error)) return { rows: [] as CommissionPayoutRow[], migrationRequired: true };
      throw new Error(error.message);
    }
    const enriched = await enrichCommissionLedgerRows(
      supabaseAdmin,
      (rows ?? []) as RawCommissionLedgerRow[],
    );
    return { rows: enriched, migrationRequired: false };
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
  .handler(async ({ data: _data, context }) => {
    const email = (context.claims as { email?: string }).email;
    const access = await resolveAdminAccess(context.userId, email);
    if (!canAmend(access, "finance_customer")) throw new Error("Forbidden");

    // Case fees must come from Finance → Network statements → Allocate.
    // Manual draft create/edit is closed so commission only pull through from the network.
    throw new Error(
      "Manual fee entry is disabled. Allocate the fee from Finance → Network statements; it appears here as a draft to submit.",
    );
  });

export const submitSessionFees = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ sessionId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const email = (context.claims as { email?: string }).email;
    const access = await resolveAdminAccess(context.userId, email);
    if (!canAmend(access, "finance_customer")) throw new Error("Forbidden");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const batchId = crypto.randomUUID();
    const now = new Date().toISOString();

    const { data: drafts, error } = await supabaseAdmin
      .from("finance_fee_lines")
      .select("*")
      .eq("session_id", data.sessionId)
      .eq("status", "draft");
    if (error) throw new Error(error.message);
    if (!drafts?.length) throw new Error("No draft fees to submit.");

    const { data: feeSession } = await supabaseAdmin
      .from("interview_sessions")
      .select("customer_id")
      .eq("id", data.sessionId)
      .maybeSingle();
    const { resolveIntroducerIdForCustomerAtDate } = await import("@/lib/introducer-attribution");
    const resolvedIntroducerId = feeSession?.customer_id
      ? await resolveIntroducerIdForCustomerAtDate(
          supabaseAdmin,
          feeSession.customer_id,
          new Date(now),
          data.sessionId,
        )
      : null;

    for (const line of drafts) {
      await supabaseAdmin
        .from("finance_fee_lines")
        .update({ status: "posted", batch_id: batchId, posted_at: now, updated_at: now })
        .eq("id", line.id);

      await supabaseAdmin.from("finance_ledger").insert({
        session_id: data.sessionId,
        fee_line_id: line.id,
        kind: "post",
        fee_type: line.fee_type,
        amount_pence: line.amount_pence,
        is_reversal: false,
        note: line.note,
        created_by: context.userId,
      });

      // Commission pull-through for advisors allocated to this session.
      const allocRes = await supabaseAdmin
        .from("session_advisors")
        .select("advisor_id")
        .eq("session_id", data.sessionId);
      const allocations =
        allocRes.error && isMissingTable(allocRes.error) ? [] : (allocRes.data ?? []);
      for (const a of allocations) {
        const pct = await commissionPctForUser(
          supabaseAdmin,
          a.advisor_id,
          "advisor",
          line.fee_type,
        );
        if (pct <= 0) continue;
        const commissionPence = Math.round((line.amount_pence * pct) / 100);
        if (commissionPence <= 0) continue;
        await supabaseAdmin.from("finance_ledger").insert({
          session_id: data.sessionId,
          fee_line_id: line.id,
          kind: "commission",
          fee_type: line.fee_type,
          amount_pence: commissionPence,
          is_reversal: false,
          beneficiary_user_id: a.advisor_id,
          beneficiary_role: "advisor",
          commission_pct: pct,
          payout_status: "received",
          created_by: context.userId,
        });
      }

      // Introducer commission: case → customer → introducer (falls back to session leads).
      // Introducers earn on fee + mortgage fee only — never insurance/other.
      if (
        resolvedIntroducerId &&
        (line.fee_type === "fee" || line.fee_type === "mortgage_fee")
      ) {
        const { data: intro } = await supabaseAdmin
          .from("introducers")
          .select("user_id")
          .eq("id", resolvedIntroducerId)
          .maybeSingle();
        if (intro?.user_id) {
          const pct = await commissionPctForUser(
            supabaseAdmin,
            intro.user_id,
            "introducer",
            line.fee_type,
          );
          if (pct > 0) {
            const commissionPence = Math.round((line.amount_pence * pct) / 100);
            if (commissionPence > 0) {
              await supabaseAdmin.from("finance_ledger").insert({
                session_id: data.sessionId,
                fee_line_id: line.id,
                kind: "commission",
                fee_type: line.fee_type,
                amount_pence: commissionPence,
                is_reversal: false,
                beneficiary_user_id: intro.user_id,
                beneficiary_role: "introducer",
                commission_pct: pct,
                payout_status: "received",
                created_by: context.userId,
              });
            }
          }
        }
      }
    }

    return { ok: true, batchId, count: drafts.length };
  });

export const amendPostedFee = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        lineId: z.string().uuid(),
        amountPounds: z.number().min(0).optional(),
        note: z.string().max(500).optional(),
        delete: z.boolean().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const email = (context.claims as { email?: string }).email;
    const access = await resolveAdminAccess(context.userId, email);
    if (!canAmend(access, "finance_customer")) throw new Error("Forbidden");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: line, error } = await supabaseAdmin
      .from("finance_fee_lines")
      .select("*")
      .eq("id", data.lineId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!line || line.status !== "posted") throw new Error("Only posted fees can be amended.");

    // Red reversal of original.
    await supabaseAdmin.from("finance_ledger").insert({
      session_id: line.session_id,
      fee_line_id: line.id,
      kind: data.delete ? "delete" : "amend",
      fee_type: line.fee_type,
      amount_pence: -line.amount_pence,
      is_reversal: true,
      note: data.delete ? "Deleted posted fee" : "Amended posted fee (reversal)",
      created_by: context.userId,
    });

    if (data.delete) {
      await supabaseAdmin
        .from("finance_fee_lines")
        .update({ status: "deleted", updated_at: new Date().toISOString() })
        .eq("id", line.id);
      return { ok: true };
    }

    const newPence =
      data.amountPounds != null ? Math.round(data.amountPounds * 100) : line.amount_pence;
    await supabaseAdmin
      .from("finance_fee_lines")
      .update({
        amount_pence: newPence,
        note: data.note ?? line.note,
        status: "amended",
        updated_at: new Date().toISOString(),
      })
      .eq("id", line.id);

    await supabaseAdmin.from("finance_ledger").insert({
      session_id: line.session_id,
      fee_line_id: line.id,
      kind: "amend",
      fee_type: line.fee_type,
      amount_pence: newPence,
      is_reversal: false,
      note: data.note ?? "Amended posted fee",
      created_by: context.userId,
    });

    return { ok: true };
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
};

async function enrichFinanceLedgerRows(
  supabaseAdmin: Awaited<
    ReturnType<typeof import("@/integrations/supabase/client.server")>
  >["supabaseAdmin"],
  rows: Array<Record<string, unknown>>,
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
      .in("id", [...sessionIds]);
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
    const { data: adv } = await supabaseAdmin
      .from("advisor_profiles")
      .select("user_id, code")
      .in("user_id", [...userIds]);
    for (const a of adv ?? []) advisorCodeMap.set(a.user_id, a.code);
    const { data: intros } = await supabaseAdmin
      .from("introducers")
      .select("user_id, company_code")
      .in("user_id", [...userIds]);
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
      receiverName: beneficiaryId ? profileMap.get(beneficiaryId) ?? null : null,
      receiverRef,
    };
  });
}

export const listFinanceLedger = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const email = (context.claims as { email?: string }).email;
    const access = await resolveAdminAccess(context.userId, email);
    if (!canViewFinanceReport(access)) throw new Error("Forbidden — owner only");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin
      .from("finance_ledger")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) {
      if (isMissingTable(error)) return { rows: [], migrationRequired: true };
      throw new Error(error.message);
    }
    const enriched = await enrichFinanceLedgerRows(supabaseAdmin, rows ?? []);
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
    const email = (context.claims as { email?: string }).email;
    const access = await resolveAdminAccess(context.userId, email);
    // Admin picker only needs introducer % permission (admins earn intro commission on bookings).
    const key =
      data.role === "advisor"
        ? "finance_advisor_pct"
        : "finance_introducer_pct";
    if (!canView(access, key)) throw new Error("Forbidden");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: roleRows } = await supabaseAdmin.from("user_roles").select("user_id, role");
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
        if (roles.has("advisor")) ids.add(userId);
      }
    } else if (data.role === "admin") {
      for (const [userId, roles] of byUser) {
        if (roles.has("admin")) ids.add(userId);
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
      const { data: codes } = await supabaseAdmin.from("advisor_profiles").select("user_id, code");
      for (const c of codes ?? []) advisorCodeMap.set(c.user_id, c.code);
    }

    const introCodeMap = new Map<string, string>();
    if (data.role === "introducer" || data.role === "admin") {
      const res = await supabaseAdmin.from("introducers").select("user_id, company_code");
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
  .handler(async ({ data, context }) => {
    const email = (context.claims as { email?: string }).email;
    const access = await resolveAdminAccess(context.userId, email);
    if (!data.userId) {
      if (!canViewFinanceReport(access)) throw new Error("Forbidden");
    } else {
      const key = data.role === "introducer" ? "finance_introducer_pct" : "finance_advisor_pct";
      if (!canView(access, key)) throw new Error("Forbidden");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let query = supabaseAdmin
      .from("commission_rate_history")
      .select("fee_type, pct_from, pct_to, created_at, changed_by, user_id, role")
      .order("created_at", { ascending: false })
      .limit(100);
    if (data.userId) query = query.eq("user_id", data.userId);
    if (data.role) query = query.eq("role", data.role);
    if (data.feeType) query = query.eq("fee_type", data.feeType);
    if (data.from) query = query.gte("created_at", data.from);
    if (data.to) query = query.lte("created_at", data.to);
    const { data: rows, error } = await query;
    if (error && !isMissingTable(error)) throw new Error(error.message);
    const list = rows ?? [];
    const userIds = [...new Set(list.map((r) => r.user_id).filter(Boolean))] as string[];
    if (userIds.length === 0) return list;

    const { data: profiles } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, email")
      .in("id", userIds);
    const nameById = new Map(
      (profiles ?? []).map((p) => [p.id, p.full_name || p.email || "Unknown"]),
    );

    return list.map((r) => ({
      ...r,
      user_name: nameById.get(r.user_id) ?? "Unknown",
    }));
  });

export const getCommissionRate = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ userId: z.string().uuid(), role: z.enum(["advisor", "introducer"]) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const email = (context.claims as { email?: string }).email;
    const access = await resolveAdminAccess(context.userId, email);
    const key = data.role === "advisor" ? "finance_advisor_pct" : "finance_introducer_pct";
    if (!canView(access, key)) throw new Error("Forbidden");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rate, error } = await supabaseAdmin
      .from("commission_rates")
      .select(
        "percentage, pct_fee, pct_mortgage_fee, pct_insurance_fee, pct_other_fee",
      )
      .eq("user_id", data.userId)
      .eq("role", data.role)
      .maybeSingle();
    if (error && !isMissingTable(error)) throw new Error(error.message);

    const row = rate as CommissionRateRow | null;
    const legacy = row ? Number(row.percentage ?? 0) : 0;
    return {
      pctFee: row ? Number(row.pct_fee ?? legacy) : null,
      pctMortgageFee: row ? Number(row.pct_mortgage_fee ?? legacy) : null,
      pctInsuranceFee: row ? Number(row.pct_insurance_fee ?? legacy) : null,
      pctOtherFee: row ? Number(row.pct_other_fee ?? legacy) : null,
    };
  });

export const getRafBonusAmount = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const email = (context.claims as { email?: string }).email;
    const access = await resolveAdminAccess(context.userId, email);
    if (!canView(access, "finance_raf")) throw new Error("Forbidden");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("finance_settings")
      .select("num_value")
      .eq("key", "raf_bonus_pence")
      .maybeSingle();
    if (error && !isMissingTable(error)) throw new Error(error.message);
    return { amountPence: data?.num_value ?? RAF_BONUS_PENCE };
  });

export const setCommissionRate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        userId: z.string().uuid(),
        role: z.enum(["advisor", "introducer"]),
        pctFee: z.number().min(0).max(100),
        pctMortgageFee: z.number().min(0).max(100),
        pctInsuranceFee: z.number().min(0).max(100),
        pctOtherFee: z.number().min(0).max(100),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const email = (context.claims as { email?: string }).email;
    const access = await resolveAdminAccess(context.userId, email);
    const key = data.role === "advisor" ? "finance_advisor_pct" : "finance_introducer_pct";
    if (!canAmend(access, key)) throw new Error("Forbidden");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: existing } = await supabaseAdmin
      .from("commission_rates")
      .select("pct_fee, pct_mortgage_fee, pct_insurance_fee, pct_other_fee, percentage")
      .eq("user_id", data.userId)
      .eq("role", data.role)
      .maybeSingle();

    const prev = existing as CommissionRateRow | null;
    const legacy = prev ? Number(prev.percentage ?? 0) : 0;
    const prevByType: Record<string, number | null> = {
      fee: prev ? Number(prev.pct_fee ?? legacy) : null,
      mortgage_fee: prev ? Number(prev.pct_mortgage_fee ?? legacy) : null,
      insurance_fee: prev ? Number(prev.pct_insurance_fee ?? legacy) : null,
      other_fee: prev ? Number(prev.pct_other_fee ?? legacy) : null,
    };
    const nextByType: Record<string, number> = {
      fee: data.pctFee,
      mortgage_fee: data.pctMortgageFee,
      // Introducer rates: fee + mortgage only; insurance/other stay advisor-exclusive.
      insurance_fee: data.role === "introducer" ? 0 : data.pctInsuranceFee,
      other_fee: data.role === "introducer" ? 0 : data.pctOtherFee,
    };

    const { error } = await supabaseAdmin.from("commission_rates").upsert(
      {
        user_id: data.userId,
        role: data.role,
        percentage: data.pctFee,
        pct_fee: nextByType.fee,
        pct_mortgage_fee: nextByType.mortgage_fee,
        pct_insurance_fee: nextByType.insurance_fee,
        pct_other_fee: nextByType.other_fee,
        updated_by: context.userId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,role" },
    );
    if (error) {
      if (isMissingTable(error)) throw new Error("Run the commission-by-fee-type SQL migration first.");
      throw new Error(error.message);
    }

    for (const feeType of FEE_TYPES) {
      const from = prevByType[feeType];
      const to = nextByType[feeType];
      if (from === to) continue;
      await supabaseAdmin.from("commission_rate_history").insert({
        user_id: data.userId,
        role: data.role,
        fee_type: feeType,
        pct_from: from,
        pct_to: to,
        changed_by: context.userId,
      });
      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("full_name, email")
        .eq("id", data.userId)
        .maybeSingle();
      const who = profile?.full_name || profile?.email || data.userId;
      await supabaseAdmin.from("finance_audit_log").insert({
        audit_type: "commission_rate",
        subject_user_id: data.userId,
        role: data.role,
        fee_type: feeType,
        summary: `${data.role} ${who}: ${FEE_TYPE_LABELS[feeType]} ${from != null ? `${from}% → ` : ""}${to}%`,
        detail: { pct_from: from, pct_to: to },
        changed_by: context.userId,
      });
    }

    return { ok: true };
  });

/** Commission totals for RAF referrers (admin finance_raf permission). */
export const listRafCommissionHighlights = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const email = (context.claims as { email?: string }).email;
    const access = await resolveAdminAccess(context.userId, email);
    if (!canView(access, "finance_raf")) return { byUserId: {} as Record<string, number> };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin
      .from("finance_ledger")
      .select("beneficiary_user_id, amount_pence")
      .eq("kind", "commission")
      .eq("beneficiary_role", "introducer");
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

async function getRafBonusPence(
  supabaseAdmin: Awaited<ReturnType<typeof import("@/integrations/supabase/client.server")>>["supabaseAdmin"],
): Promise<number> {
  const { data } = await supabaseAdmin
    .from("finance_settings")
    .select("num_value")
    .eq("key", "raf_bonus_pence")
    .maybeSingle();
  return data?.num_value ?? RAF_BONUS_PENCE;
}

/** Creates a received RAF commission ledger row when a referral bonus becomes eligible. */
export async function ensureRafCommissionLedgerEntry(
  referralId: string,
  createdBy?: string,
): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: existing } = await supabaseAdmin
    .from("finance_ledger")
    .select("id")
    .eq("referral_id", referralId)
    .eq("kind", "commission")
    .maybeSingle();
  if (existing) return;

  const { data: referral, error: refErr } = await supabaseAdmin
    .from("referrals")
    .select("id, referrer_user_id, code, referred_email, referral_code_id")
    .eq("id", referralId)
    .maybeSingle();
  if (refErr || !referral) return;

  let referrerName: string | null = null;
  if (referral.referral_code_id) {
    const { data: codeRow } = await supabaseAdmin
      .from("referral_codes")
      .select("referrer_name, referrer_user_id")
      .eq("id", referral.referral_code_id)
      .maybeSingle();
    referrerName = codeRow?.referrer_name ?? null;
  }

  const amountPence = await getRafBonusPence(supabaseAdmin);
  const note = `RAF bonus · friend ${referral.referred_email ?? "unknown"} · code ${referral.code ?? ""}`;

  const { error } = await supabaseAdmin.from("finance_ledger").insert({
    kind: "commission",
    fee_type: "fee",
    amount_pence: amountPence,
    is_reversal: false,
    beneficiary_user_id: referral.referrer_user_id,
    beneficiary_role: "referrer",
    referral_id: referralId,
    payout_status: "received",
    note: referrerName ? `${note} · referrer ${referrerName}` : note,
    created_by: createdBy ?? null,
  });
  if (error && !isMissingTable(error)) {
    console.error("ensureRafCommissionLedgerEntry failed", error);
  }
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
};

async function enrichCommissionLedgerRows(
  supabaseAdmin: Awaited<
    ReturnType<typeof import("@/integrations/supabase/client.server")>
  >["supabaseAdmin"],
  rows: RawCommissionLedgerRow[],
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
      .in("id", Array.from(sessionIds));
    for (const s of sessions ?? []) {
      if (s.case_ref) caseRefMap.set(s.id, s.case_ref);
    }
  }

  const referralMap = new Map<string, string>();
  if (referralIds.size > 0) {
    const { data: refs } = await supabaseAdmin
      .from("referrals")
      .select("id, referred_email")
      .in("id", Array.from(referralIds));
    for (const ref of refs ?? []) {
      referralMap.set(ref.id, ref.referred_email ?? "Friend");
    }
  }

  return rows.map((r) => {
    const role = r.beneficiary_role ?? "advisor";
    let beneficiaryName =
      (r.beneficiary_user_id && profileMap.get(r.beneficiary_user_id)) || "";
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
    };
  });
}

/** Read-only commission statement for the signed-in user (advisor, introducer, or RAF referrer). */
export const listMyCommissionStatement = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        payoutStatus: PAYOUT_STATUS_Z.optional(),
        viewAsUserId: z.string().uuid().optional(),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    let beneficiaryUserId = context.userId;
    if (data.viewAsUserId) {
      const email = (context.claims as { email?: string }).email;
      const access = await resolveAdminAccess(context.userId, email);
      if (!access.isOwner && !access.isSupervisor) throw new Error("Forbidden");
      beneficiaryUserId = data.viewAsUserId;
    }

    const { data: eligibleRefs } = await supabaseAdmin
      .from("referrals")
      .select("id")
      .eq("referrer_user_id", beneficiaryUserId)
      .eq("bonus_status", "eligible")
      .limit(100);
    for (const r of eligibleRefs ?? []) {
      await ensureRafCommissionLedgerEntry(r.id, beneficiaryUserId);
    }

    let query = supabaseAdmin
      .from("finance_ledger")
      .select(
        "id, session_id, fee_type, amount_pence, commission_pct, beneficiary_user_id, beneficiary_role, referral_id, payout_status, payout_note, payout_at, lost_reason, created_at, note",
      )
      .eq("kind", "commission")
      .eq("beneficiary_user_id", beneficiaryUserId)
      .order("created_at", { ascending: false })
      .limit(2000);

    if (data.payoutStatus) query = query.eq("payout_status", data.payoutStatus);

    const { data: rows, error } = await query;
    if (error) {
      if (isMissingTable(error)) return { rows: [] as CommissionPayoutRow[], migrationRequired: true };
      throw new Error(error.message);
    }

    const enriched = await enrichCommissionLedgerRows(
      supabaseAdmin,
      (rows ?? []) as RawCommissionLedgerRow[],
    );
    return { rows: enriched, migrationRequired: false };
  });

export const listCommissionPayouts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        beneficiaryRole: z.enum(["advisor", "introducer", "referrer"]).optional(),
        payoutStatus: PAYOUT_STATUS_Z.optional(),
        beneficiaryUserId: z.string().uuid().optional(),
        caseRefQuery: z.string().max(64).optional(),
        sessionId: z.string().uuid().optional(),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    const email = (context.claims as { email?: string }).email;
    const access = await resolveAdminAccess(context.userId, email);
    if (!canViewCommissionPayouts(access)) throw new Error("Forbidden");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Sync eligible RAF referrals that pre-date the payout ledger.
    const { data: eligibleRefs } = await supabaseAdmin
      .from("referrals")
      .select("id")
      .eq("bonus_status", "eligible")
      .limit(100);
    for (const r of eligibleRefs ?? []) {
      await ensureRafCommissionLedgerEntry(r.id, context.userId);
    }

    let sessionFilterIds: string[] | null = null;
    if (data.sessionId) {
      sessionFilterIds = [data.sessionId];
    } else if (data.caseRefQuery?.trim()) {
      const q = data.caseRefQuery.trim();
      const { data: sessions, error: sessErr } = await supabaseAdmin
        .from("interview_sessions")
        .select("id")
        .ilike("case_ref", `%${q}%`)
        .limit(100);
      if (sessErr) throw new Error(sessErr.message);
      sessionFilterIds = (sessions ?? []).map((s) => s.id);
      if (sessionFilterIds.length === 0) {
        return { rows: [] as CommissionPayoutRow[], migrationRequired: false };
      }
    }

    let query = supabaseAdmin
      .from("finance_ledger")
      .select(
        "id, session_id, fee_type, amount_pence, commission_pct, beneficiary_user_id, beneficiary_role, referral_id, payout_status, payout_note, payout_at, lost_reason, created_at, note",
      )
      .eq("kind", "commission")
      .order("created_at", { ascending: false })
      .limit(sessionFilterIds ? 200 : 500);

    if (sessionFilterIds) query = query.in("session_id", sessionFilterIds);
    if (data.beneficiaryRole) query = query.eq("beneficiary_role", data.beneficiaryRole);
    if (data.payoutStatus && !sessionFilterIds) query = query.eq("payout_status", data.payoutStatus);
    if (data.beneficiaryUserId) query = query.eq("beneficiary_user_id", data.beneficiaryUserId);

    const { data: rows, error } = await query;
    if (error) {
      if (isMissingTable(error)) return { rows: [] as CommissionPayoutRow[], migrationRequired: true };
      throw new Error(error.message);
    }

    const enriched = await enrichCommissionLedgerRows(
      supabaseAdmin,
      (rows ?? []) as RawCommissionLedgerRow[],
    );

    return { rows: enriched, migrationRequired: false };
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
    const email = (context.claims as { email?: string }).email;
    const access = await resolveAdminAccess(context.userId, email);
    if (!canAmendCommissionPayouts(access)) throw new Error("Forbidden");

    return await applyCommissionPayoutStatusPatch(data, context.userId);
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
    const email = (context.claims as { email?: string }).email;
    const access = await resolveAdminAccess(context.userId, email);
    if (!canAmend(access, "finance_customer")) throw new Error("Forbidden");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
      .from("finance_ledger")
      .select("id, session_id, kind")
      .eq("id", data.ledgerId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row || row.kind !== "commission" || row.session_id !== data.sessionId) {
      throw new Error("Commission row not found for this case");
    }

    return await applyCommissionPayoutStatusPatch(data, context.userId);
  });

async function applyCommissionPayoutStatusPatch(
  data: {
    ledgerId: string;
    payoutStatus: PayoutStatus;
    payoutNote?: string;
  },
  userId: string,
) {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error: readErr } = await supabaseAdmin
      .from("finance_ledger")
      .select("id, kind, referral_id, beneficiary_role")
      .eq("id", data.ledgerId)
      .maybeSingle();
    if (readErr) throw new Error(readErr.message);
    if (!row || row.kind !== "commission") throw new Error("Commission row not found");

    const now = new Date().toISOString();
    const patch: Record<string, unknown> = {
      payout_status: data.payoutStatus,
      payout_note: data.payoutNote ?? null,
      lost_reason: null,
      payout_at: data.payoutStatus === "received" ? null : now,
      payout_by: data.payoutStatus === "received" ? null : userId,
    };

    const { error } = await supabaseAdmin.from("finance_ledger").update(patch).eq("id", data.ledgerId);
    if (error) {
      if (isMissingTable(error)) {
        throw new Error("Run supabase/RUN_COMMISSION_PAYOUTS.sql in Supabase first.");
      }
      throw new Error(error.message);
    }

    if (row.referral_id && row.beneficiary_role === "referrer") {
      const bonusMap: Record<PayoutStatus, string> = {
        received: "eligible",
        paid: "paid",
        rejected: "rejected",
      };
      await supabaseAdmin
        .from("referrals")
        .update({ bonus_status: bonusMap[data.payoutStatus], updated_at: now })
        .eq("id", row.referral_id);
    }

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
    const email = (context.claims as { email?: string }).email;
    const access = await resolveAdminAccess(context.userId, email);
    if (!canViewFinanceReport(access)) throw new Error("Forbidden");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("finance_audit_log")
      .select("id, audit_type, summary, role, fee_type, created_at")
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
  pctFee: number;
  pctMortgageFee: number;
  pctInsuranceFee: number;
  pctOtherFee: number;
};

export const listCurrentCommissionArrangements = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ role: z.enum(["all", "advisor", "introducer"]).optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const email = (context.claims as { email?: string }).email;
    const access = await resolveAdminAccess(context.userId, email);
    if (!canViewFinanceReport(access)) throw new Error("Forbidden");

    const roleFilter = data.role ?? "all";
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rates, error } = await supabaseAdmin.from("commission_rates").select("*");
    if (error && !isMissingTable(error)) throw new Error(error.message);

    const rows: CommissionArrangementRow[] = [];
    const userIds = [...new Set((rates ?? []).map((r) => r.user_id as string))];
    const { data: profiles } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, email")
      .in("id", userIds.length ? userIds : ["00000000-0000-0000-0000-000000000000"]);
    const nameMap = new Map((profiles ?? []).map((p) => [p.id, p.full_name || p.email || "Unknown"]));

    const advisorCodes = new Map<string, string>();
    const introCodes = new Map<string, string>();
    const { data: adv } = await supabaseAdmin.from("advisor_profiles").select("user_id, code");
    for (const a of adv ?? []) advisorCodes.set(a.user_id, a.code);
    const { data: intros } = await supabaseAdmin.from("introducers").select("user_id, company_code");
    for (const i of intros ?? []) introCodes.set(i.user_id, (i as { company_code?: string }).company_code ?? "");

    for (const r of rates ?? []) {
      const role = r.role as "advisor" | "introducer";
      if (roleFilter !== "all" && role !== roleFilter) continue;
      const legacy = Number(r.percentage ?? 0);
      rows.push({
        userId: r.user_id as string,
        name: nameMap.get(r.user_id as string) ?? "Unknown",
        role,
        referenceCode:
          role === "advisor"
            ? advisorCodes.get(r.user_id as string) ?? null
            : introCodes.get(r.user_id as string) || null,
        pctFee: Number(r.pct_fee ?? legacy),
        pctMortgageFee: Number(r.pct_mortgage_fee ?? legacy),
        pctInsuranceFee: Number(r.pct_insurance_fee ?? legacy),
        pctOtherFee: Number(r.pct_other_fee ?? legacy),
      });
    }
    return rows.sort((a, b) => a.name.localeCompare(b.name));
  });
