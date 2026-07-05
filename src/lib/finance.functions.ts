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

export const PAYOUT_STATUSES = ["pending", "paid", "rejected"] as const;
export type PayoutStatus = (typeof PAYOUT_STATUSES)[number];

export const PAYOUT_STATUS_LABELS: Record<PayoutStatus, string> = {
  pending: "Pending",
  paid: "Paid",
  rejected: "Rejected",
};

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
    const email = (context.claims as { email?: string }).email;
    const access = await resolveAdminAccess(context.userId, email);
    if (!canAmend(access, "finance_customer")) throw new Error("Forbidden");

    const amountPence = Math.round(data.amountPounds * 100);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    if (data.lineId) {
      const { data: existing } = await supabaseAdmin
        .from("finance_fee_lines")
        .select("status")
        .eq("id", data.lineId)
        .maybeSingle();
      if (!existing) throw new Error("Fee line not found");
      if (existing.status === "posted") {
        throw new Error("Posted fees must be amended via Amend (creates a red ledger entry).");
      }
      const { error } = await supabaseAdmin
        .from("finance_fee_lines")
        .update({
          amount_pence: amountPence,
          note: data.note ?? null,
          fee_type: data.feeType,
          updated_at: new Date().toISOString(),
        })
        .eq("id", data.lineId);
      if (error) throw new Error(error.message);
      return { id: data.lineId };
    }

    const { data: inserted, error } = await supabaseAdmin
      .from("finance_fee_lines")
      .insert({
        session_id: data.sessionId,
        fee_type: data.feeType,
        amount_pence: amountPence,
        note: data.note ?? null,
        status: "draft",
        created_by: context.userId,
      })
      .select("id")
      .single();
    if (error) {
      if (isMissingTable(error)) throw new Error("Run the admin/finance migration first.");
      throw new Error(error.message);
    }
    return { id: inserted.id };
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
    const { resolveIntroducerIdForCustomer } = await import("@/lib/introducer-attribution");
    const resolvedIntroducerId = feeSession?.customer_id
      ? await resolveIntroducerIdForCustomer(
          supabaseAdmin,
          feeSession.customer_id,
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
          payout_status: "pending",
          created_by: context.userId,
        });
      }

      // Introducer commission: case → customer → introducer (falls back to session leads).
      if (resolvedIntroducerId) {
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
                payout_status: "pending",
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
    return { rows: rows ?? [], migrationRequired: false };
  });

export const listCommissionStaff = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ role: z.enum(["advisor", "introducer"]), query: z.string().max(80).optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const email = (context.claims as { email?: string }).email;
    const access = await resolveAdminAccess(context.userId, email);
    const key = data.role === "advisor" ? "finance_advisor_pct" : "finance_introducer_pct";
    if (!canView(access, key)) throw new Error("Forbidden");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: roleRows } = await supabaseAdmin.from("user_roles").select("user_id, role");
    const ids = new Set(
      (roleRows ?? []).filter((r) => r.role === data.role).map((r) => r.user_id),
    );
    if (ids.size === 0) return [];

    const { data: profiles } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, email")
      .in("id", [...ids])
      .order("full_name", { ascending: true });

    const advisorCodeMap = new Map<string, string>();
    if (data.role === "advisor") {
      const { data: codes } = await supabaseAdmin.from("advisor_profiles").select("user_id, code");
      for (const c of codes ?? []) advisorCodeMap.set(c.user_id, c.code);
    }

    const introCodeMap = new Map<string, string>();
    if (data.role === "introducer") {
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
          data.role === "advisor"
            ? advisorCodeMap.get(p.id) ?? ""
            : introCodeMap.get(p.id) ?? "";
        const hay = [p.full_name, p.email, code].filter(Boolean).join(" ").toLowerCase();
        return hay.includes(q);
      })
      .map((p) => ({
        id: p.id,
        full_name: p.full_name,
        email: p.email,
        referenceCode:
          data.role === "advisor"
            ? advisorCodeMap.get(p.id) ?? null
            : introCodeMap.get(p.id) || null,
      }));
  });

export const listCommissionRateHistory = createServerFn({ method: "GET" })
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
    const { data: rows, error } = await supabaseAdmin
      .from("commission_rate_history")
      .select("fee_type, pct_from, pct_to, created_at, changed_by")
      .eq("user_id", data.userId)
      .eq("role", data.role)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error && !isMissingTable(error)) throw new Error(error.message);
    return rows ?? [];
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
      insurance_fee: data.pctInsuranceFee,
      other_fee: data.pctOtherFee,
    };

    const { error } = await supabaseAdmin.from("commission_rates").upsert(
      {
        user_id: data.userId,
        role: data.role,
        percentage: data.pctFee,
        pct_fee: data.pctFee,
        pct_mortgage_fee: data.pctMortgageFee,
        pct_insurance_fee: data.pctInsuranceFee,
        pct_other_fee: data.pctOtherFee,
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

/** Creates a pending RAF commission ledger row when a referral bonus becomes eligible. */
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
    payout_status: "pending",
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
      payoutStatus: (r.payout_status as PayoutStatus) ?? "pending",
      payoutNote: r.payout_note ?? null,
      payoutAt: r.payout_at ?? null,
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
        payoutStatus: z.enum(["pending", "paid", "rejected"]).optional(),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: eligibleRefs } = await supabaseAdmin
      .from("referrals")
      .select("id")
      .eq("referrer_user_id", context.userId)
      .eq("bonus_status", "eligible")
      .limit(100);
    for (const r of eligibleRefs ?? []) {
      await ensureRafCommissionLedgerEntry(r.id, context.userId);
    }

    let query = supabaseAdmin
      .from("finance_ledger")
      .select(
        "id, session_id, fee_type, amount_pence, commission_pct, beneficiary_user_id, beneficiary_role, referral_id, payout_status, payout_note, payout_at, created_at, note",
      )
      .eq("kind", "commission")
      .eq("beneficiary_user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(200);

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
        payoutStatus: z.enum(["pending", "paid", "rejected"]).optional(),
        beneficiaryUserId: z.string().uuid().optional(),
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

    let query = supabaseAdmin
      .from("finance_ledger")
      .select(
        "id, session_id, fee_type, amount_pence, commission_pct, beneficiary_user_id, beneficiary_role, referral_id, payout_status, payout_note, payout_at, created_at, note",
      )
      .eq("kind", "commission")
      .order("created_at", { ascending: false })
      .limit(500);

    if (data.beneficiaryRole) query = query.eq("beneficiary_role", data.beneficiaryRole);
    if (data.payoutStatus) query = query.eq("payout_status", data.payoutStatus);
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
        payoutStatus: z.enum(["pending", "paid", "rejected"]),
        payoutNote: z.string().max(500).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const email = (context.claims as { email?: string }).email;
    const access = await resolveAdminAccess(context.userId, email);
    if (!canAmendCommissionPayouts(access)) throw new Error("Forbidden");

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
      payout_at: data.payoutStatus === "pending" ? null : now,
      payout_by: data.payoutStatus === "pending" ? null : context.userId,
    };

    const { error } = await supabaseAdmin.from("finance_ledger").update(patch).eq("id", data.ledgerId);
    if (error) {
      if (isMissingTable(error)) {
        throw new Error("Run supabase/RUN_COMMISSION_PAYOUTS.sql in Supabase first.");
      }
      throw new Error(error.message);
    }

    if (row.referral_id && row.beneficiary_role === "referrer") {
      const bonusMap: Record<string, string> = {
        pending: "eligible",
        paid: "paid",
        rejected: "rejected",
      };
      await supabaseAdmin
        .from("referrals")
        .update({ bonus_status: bonusMap[data.payoutStatus], updated_at: now })
        .eq("id", row.referral_id);
    }

    return { ok: true };
  });
